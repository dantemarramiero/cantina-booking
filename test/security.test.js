// Accessi: sessioni, chiavi non più accettate, permessi per modulo controllati dal server, link firmati.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { API_WORKSPACES, apiGroup, SESSION_IDLE_MS } = require('../lib/security');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

async function createUser(username, workspaces) {
  let roleId = null;
  if (workspaces) {
    const role = await t.api('POST', '/api/admin/roles', { name: `Ruolo ${username}`, workspaces });
    roleId = role.data.id;
  }
  const u = await t.api('POST', '/api/admin/portal-users', { name: username, email: `${username}@test.it`, username, password: 'password-lunga', role_id: roleId });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  const login = await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } });
  assert.equal(login.status, 200);
  return { id: u.data.id, token: login.data.key };
}
const as = token => (method, p, body) => t.request(method, p, { body, token });

test('la chiave master si scambia con una sessione e non vale più da sola', async () => {
  assert.ok(t.token && t.token !== t.MASTER_KEY);
  assert.equal((await t.api('GET', '/api/admin/me')).status, 200);
  assert.equal((await t.request('GET', '/api/admin/me', { headers: { 'x-admin-key': t.MASTER_KEY } })).status, 401, 'chiave master nell\'header');
  assert.equal((await t.request('GET', `/api/admin/me?key=${t.MASTER_KEY}`)).status, 401, 'chiave master nell\'URL');
  assert.equal((await t.request('POST', '/api/admin/session', { body: { key: 'sbagliata' } })).status, 401);
});

test('la chiave fissa di un utente non vale più: serve il login', async () => {
  const u = await createUser('fisso', null);
  const accessKey = t.db.prepare('SELECT access_key FROM portal_users WHERE id = ?').get(u.id).access_key;
  assert.equal((await t.request('GET', '/api/admin/me', { headers: { 'x-admin-key': accessKey } })).status, 401);
  assert.equal((await as(u.token)('GET', '/api/admin/me')).status, 200);
});

test('la sessione scade dopo il tempo di inattività e con il logout', async () => {
  const token = await t.loginMaster();
  const idle = new Date(Date.now() - SESSION_IDLE_MS - 1000).toISOString();
  t.db.prepare('UPDATE portal_sessions SET last_seen_at = ? WHERE id = (SELECT MAX(id) FROM portal_sessions)').run(idle);
  assert.equal((await as(token)('GET', '/api/admin/me')).status, 401, 'inattiva da più di 12 ore');
  const other = await t.loginMaster();
  assert.equal((await as(other)('POST', '/api/admin/logout')).status, 200);
  assert.equal((await as(other)('GET', '/api/admin/me')).status, 401, 'dopo il logout');
});

test('disattivare un utente chiude subito le sue sessioni', async () => {
  const u = await createUser('dadisattivare', null);
  await t.api('PATCH', `/api/admin/portal-users/${u.id}`, { active: 0 });
  assert.equal((await as(u.token)('GET', '/api/admin/me')).status, 401);
});

test('i permessi per modulo sono controllati dal server', async () => {
  const eno = await createUser('solo-eno', ['enoturismo']);
  const call = as(eno.token);
  assert.equal((await call('GET', '/api/admin/bookings')).status, 200, 'il suo modulo');
  assert.equal((await call('GET', '/api/admin/customers')).status, 403, 'CRM: no');
  assert.equal((await call('GET', '/api/admin/people')).status, 403, 'Contatti: no');
  assert.equal((await call('GET', '/api/admin/portal-users')).status, 403, 'utenti: no');
  assert.equal((await call('GET', '/api/admin/products')).status, 200, 'le bottiglie si leggono (servono alla cassa)');
  assert.equal((await call('POST', '/api/admin/products', { name: 'X' })).status, 403, 'ma non si creano');
  assert.equal((await call('GET', '/api/admin/settings')).status, 200, 'le impostazioni si leggono');
  assert.equal((await call('POST', '/api/admin/settings', { stale_customer_days: 30 })).status, 403, 'ma non si cambiano');

  const mag = await createUser('solo-mag', ['magazzino']);
  assert.equal((await as(mag.token)('GET', '/api/admin/orders')).status, 200, 'il magazzino legge gli ordini');
  assert.equal((await as(mag.token)('DELETE', '/api/admin/orders/999999')).status !== 403, true, 'e li aggiorna dal kanban');
  assert.equal((await as(mag.token)('GET', '/api/admin/bookings')).status, 403);

  const full = await createUser('completo', null);
  assert.equal((await as(full.token)('GET', '/api/admin/customers')).status, 200, 'senza ruolo = accesso completo, come oggi');
});

test('ogni API del portale ha un modulo assegnato', () => {
  const paths = t.app._router.stack.filter(l => l.route?.path?.startsWith('/api/admin/')).map(l => l.route.path);
  const unmapped = [...new Set(paths.map(apiGroup))].filter(g => g !== 'session' && !API_WORKSPACES[g]);
  assert.deepEqual(unmapped, [], `gruppi senza permessi: ${unmapped.join(', ')}`);
});

test('i download passano da link firmati che scadono e non si possono alterare', async () => {
  const signed = await t.api('GET', '/api/admin/signed-url?path=/api/admin/newsletter/export');
  assert.equal(signed.status, 200);
  const ok = await t.request('GET', signed.data.url);
  assert.equal(ok.status, 200, 'il link firmato funziona senza header');
  assert.equal((await t.request('GET', signed.data.url.replace('newsletter/export', 'export'))).status, 401, 'firma legata al percorso');
  assert.equal((await t.request('GET', signed.data.url.replace(/sig=[^&]+/, 'sig=abc'))).status, 401, 'firma alterata');
  const expired = signed.data.url.replace(/exp=\d+/, `exp=${Math.floor(Date.now() / 1000) - 5}`);
  assert.equal((await t.request('GET', expired)).status, 401, 'link scaduto');
  const eno = await createUser('firma-eno', ['enoturismo']);
  assert.equal((await as(eno.token)('GET', '/api/admin/signed-url?path=/api/admin/customers')).status, 403, 'non firma ciò che non puoi vedere');
});

test('troppi tentativi di login sbagliati vengono bloccati', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await t.request('POST', '/api/portal-users/login', { body: { username: 'nessuno', password: 'x' } });
  assert.equal(last.status, 429);
});

test('accessi e modifiche a utenti e ruoli finiscono nel registro attività', async () => {
  const log = (await t.api('GET', '/api/admin/audit-log?limit=500')).data;
  const actions = new Set(log.map(r => r.action));
  for (const a of ['login', 'login.failed', 'portal_user.created', 'portal_user.updated', 'role.created']) assert.ok(actions.has(a), `manca ${a}`);
  assert.ok(!JSON.stringify(log).includes('password_hash'), 'mai l\'hash della password nel registro');
  const upd = log.find(r => r.action === 'portal_user.updated');
  assert.equal(upd.before.active, 1);
  assert.equal(upd.after.active, 0);
});
