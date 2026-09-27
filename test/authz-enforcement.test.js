// Organigramma e permessi, Fase 2 (docs/audit_permessi.md): ogni API passa da can(); route chiuse
// (cataloghi, conferma del ritiro), sessioni degli agenti, utenti disattivati invece che cancellati,
// visibilità delle assenze nella query, operatori selezionabili per permesso.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const now = () => new Date().toISOString();
const today = () => require('../lib/time').romeDate();
let seq = 0;
async function user(workspaces) {
  const n = `enf${++seq}`;
  const role = workspaces ? (await t.api('POST', '/api/admin/roles', { name: `Ruolo ${n}`, workspaces })).data.id : '';
  const id = (await t.api('POST', '/api/admin/portal-users', { name: `Utente ${n}`, email: `${n}@test.it`, username: n, password: 'password-lunga', role_id: role })).data.id;
  const token = (await t.request('POST', '/api/portal-users/login', { body: { username: n, password: 'password-lunga' } })).data.key;
  return { id, token, call: (m, p, body) => t.request(m, p, { body, token }) };
}
function grant(userId, code, extra = {}) {
  t.db.prepare(`INSERT INTO user_grants (portal_user_id, permission_code, scope, reason, granted_by, valid_from, valid_to, created_at)
    VALUES (?, ?, 'all', ?, 'test', ?, ?, ?)`).run(userId, code, extra.reason || 'Prova', extra.from || '2020-01-01', extra.to || null, now());
  t.authz.recompute(userId);
}

test('il server decide con can(): una concessione nominativa apre la sola API concessa', async () => {
  const u = await user(null);
  assert.equal((await u.call('GET', '/api/admin/customers')).status, 403, 'senza ruolo niente');
  grant(u.id, 'crm.clienti.leggi', { reason: 'Supporto al CRM per la fiera' });
  assert.equal((await u.call('GET', '/api/admin/customers')).status, 200, 'la concessione vale per la lettura');
  assert.equal((await u.call('POST', '/api/admin/customers', { name: 'X' })).status, 403, 'ma non per la scrittura');
  assert.equal((await u.call('GET', '/api/admin/bookings')).status, 403, 'né per altri moduli');
});

test('22 · senza permesso: 403 e nessun dato parziale', async () => {
  const u = await user(['magazzino']);
  const r = await u.call('GET', '/api/admin/bookings');
  assert.equal(r.status, 403);
  assert.deepEqual(Object.keys(r.data), ['error']);
});

test('Q7 · i cataloghi non si scaricano più senza accesso; portale con link firmato, agenti con la sessione', async () => {
  const dir = path.join(t.dir, 'catalogs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'listino.pdf'), '%PDF-1.4 prova');
  const id = Number(t.db.prepare("INSERT INTO catalogs (name, filename, active) VALUES ('Listino agenti', 'listino.pdf', 1)").run().lastInsertRowid);
  assert.equal((await t.request('GET', `/api/catalogs/${id}/download`)).status, 404, 'il vecchio link pubblico non esiste più');
  assert.equal((await t.request('GET', `/api/admin/catalogs/${id}/download`)).status, 401, 'senza sessione no');
  const signed = (await t.api('GET', `/api/admin/signed-url?path=${encodeURIComponent(`/api/admin/catalogs/${id}/download`)}`)).data.url;
  const dl = await t.request('GET', signed);
  assert.equal(dl.status, 200);
  assert.match(String(dl.data), /PDF/);
  const noCat = await user(['enoturismo']);
  assert.equal((await noCat.call('GET', `/api/admin/signed-url?path=${encodeURIComponent(`/api/admin/catalogs/${id}/download`)}`)).status, 403, 'senza il permesso sui cataloghi niente link');
  const agent = (await t.api('POST', '/api/admin/agents', { name: 'Agente Cataloghi' })).data;
  const session = (await t.request('POST', '/api/agent/login', { body: { username: agent.username, password: agent.password } })).data.token;
  assert.equal((await t.request('GET', `/api/agent/${session}/catalogs/${id}/download`)).status, 200);
});

test('21 · agenti: sessione con scadenza al posto del token fisso; vedono solo i propri clienti', async () => {
  const a = (await t.api('POST', '/api/admin/agents', { name: 'Agente Uno' })).data;
  const b = (await t.api('POST', '/api/admin/agents', { name: 'Agente Due' })).data;
  const login = async ag => (await t.request('POST', '/api/agent/login', { body: { username: ag.username, password: ag.password } })).data.token;
  const sa = await login(a);
  assert.notEqual(sa, a.token, 'il login restituisce una sessione, non il token fisso');
  assert.equal((await t.request('GET', `/api/agent/${a.token}`)).status, 401, 'il token fisso non vale più');
  assert.equal((await t.request('GET', `/api/agent/${sa}`)).status, 200);
  const exp = t.db.prepare('SELECT expires_at FROM agent_sessions WHERE user_id = ?').get(a.id).expires_at;
  assert.ok(Date.parse(exp) > Date.now() && Date.parse(exp) <= Date.now() + 7 * 24 * 3600e3 + 1000, 'scade entro 7 giorni');
  await t.request('POST', `/api/agent/${sa}/customers`, { body: { name: 'Cliente di Uno' } });
  const sb = await login(b);
  await t.request('POST', `/api/agent/${sb}/customers`, { body: { name: 'Cliente di Due' } });
  const mine = (await t.request('GET', `/api/agent/${sa}/customers`)).data.map(c => c.name);
  assert.ok(mine.includes('Cliente di Uno') && !mine.includes('Cliente di Due'));
  // Nuova password o token rigenerato: le sessioni aperte finiscono. Anche il logout.
  await t.api('POST', `/api/admin/agents/${a.id}/regenerate-password`);
  assert.equal((await t.request('GET', `/api/agent/${sa}`)).status, 401);
  assert.equal((await t.request('POST', `/api/agent/${sb}/logout`)).status, 200);
  assert.equal((await t.request('GET', `/api/agent/${sb}`)).status, 401);
});

test('la conferma del ritiro con QR la fa solo il personale con il permesso sui ritiri', async () => {
  const tokenQr = `qr-${Date.now()}`;
  const id = Number(t.db.prepare("INSERT INTO pickup_orders (customer_name, customer_email, status, amount_cents, pickup_token) VALUES ('Cliente', 'c@test.it', 'da_ritirare', 1000, ?)").run(tokenQr).lastInsertRowid);
  const url = `/api/pickup-orders/verify/${tokenQr}/pickup`;
  assert.equal((await t.request('GET', `/api/pickup-orders/verify/${tokenQr}`)).status, 200, 'il cliente vede il suo ordine');
  assert.equal((await t.request('POST', url)).status, 401, 'ma non lo segna come ritirato');
  const crm = await user(['crm']);
  assert.equal((await crm.call('POST', url)).status, 403);
  assert.equal(t.db.prepare('SELECT status FROM pickup_orders WHERE id = ?').get(id).status, 'da_ritirare');
  const shop = await user(['enoturismo']);
  assert.equal((await shop.call('POST', url)).status, 200);
  assert.equal(t.db.prepare('SELECT status FROM pickup_orders WHERE id = ?').get(id).status, 'ritirato');
});

test('20 · "elimina utente" lo disattiva: l\'operatore e lo storico restano', async () => {
  const u = await user(['enoturismo']);
  const op = t.db.prepare('SELECT id FROM operators WHERE portal_user_id = ?').get(u.id);
  assert.ok(op);
  const del = await t.api('DELETE', `/api/admin/portal-users/${u.id}`);
  assert.equal(del.status, 200);
  assert.equal(t.db.prepare('SELECT active FROM portal_users WHERE id = ?').get(u.id).active, 0, 'la riga resta, disattivata');
  const opAfter = t.db.prepare('SELECT * FROM operators WHERE id = ?').get(op.id);
  assert.equal(opAfter.active, 0);
  assert.equal(opAfter.portal_user_id, u.id, 'l\'operatore punta ancora al suo utente');
  assert.equal((await u.call('GET', '/api/admin/bookings')).status, 401, 'le sessioni sono chiuse');
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'portal_user.deactivated' AND entity_id = ?").get(String(u.id)));
});

test('23 · assenze: la visibilità è nella query, il responsabile vede i suoi anche con molte altre righe', async () => {
  const mgr = await user(null);
  const emp = (first, extra = {}) => Number(t.db.prepare(`INSERT INTO employees (first_name, last_name, portal_user_id, manager_id, created_at, updated_at)
    VALUES (?, 'Prova', ?, ?, ?, ?)`).run(first, extra.user ?? null, extra.manager ?? null, now(), now()).lastInsertRowid);
  const me = emp('Responsabile', { user: mgr.id });
  const report = emp('Collaboratore', { manager: me });
  const other = emp('Estraneo');
  const type = t.db.prepare('SELECT id FROM absence_types ORDER BY id LIMIT 1').get().id;
  const ins = t.db.prepare(`INSERT INTO absences (employee_id, absence_type_id, start_date, end_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'approvata', ?, ?)`);
  t.db.exec('BEGIN'); // in un colpo solo: 520 scritture una per una bloccano il server per secondi
  for (let i = 0; i < 520; i++) ins.run(other, type, '2030-01-01', '2030-01-01', now(), now()); // più recenti: prima del LIMIT
  t.db.exec('COMMIT');
  const mine = Number(ins.run(report, type, '2026-01-10', '2026-01-10', now(), now()).lastInsertRowid);
  const list = await mgr.call('GET', '/api/admin/hr/absences');
  assert.equal(list.status, 200);
  const ids = list.data.map(a => a.id);
  assert.ok(ids.includes(mine), 'l\'assenza del collaboratore c\'è');
  assert.ok(!list.data.some(a => a.employee_id === other), 'quelle di un estraneo no');
});

test('operatori: di default tutti gli utenti attivi; con l\'opzione, solo chi conduce le visite', async () => {
  const a = await user(['enoturismo']);
  const b = await user(['enoturismo']);
  const selectable = async id => (await t.api('GET', '/api/admin/operators')).data.find(o => o.portal_user_id === id).selectable;
  assert.equal(await selectable(a.id), true);
  assert.equal((await t.api('POST', '/api/admin/settings', { operators_selection: 'permesso' })).status, 200);
  assert.equal(await selectable(a.id), false);
  grant(b.id, 'enoturismo.visite.conduce', { reason: 'Guida delle visite' });
  assert.equal(await selectable(b.id), true);
  await t.api('POST', '/api/admin/settings', { operators_selection: 'tutti' });
});

test('"Accesso completo" comprende sempre tutto e non si modifica; le capacità di altri moduli passano dai ruoli', async () => {
  const full = t.db.prepare('SELECT id FROM roles WHERE is_system = 1').get().id;
  assert.equal((await t.api('PATCH', `/api/admin/roles/${full}`, { workspaces: ['crm'] })).status, 409);
  const u = await user(null);
  await t.api('PATCH', `/api/admin/portal-users/${u.id}`, { role_id: full });
  const me = (await u.call('GET', '/api/admin/me')).data;
  assert.equal(me.permittedWorkspaces.length, 8, 'tutti i moduli');
  assert.ok(me.capabilities.includes('enologo'));
  // Una capacità che il catalogo non traduce (es. di un modulo nuovo) resta valida se il ruolo ce l'ha.
  const other = await user(['finance']);
  const roleId = t.db.prepare('SELECT role_id FROM portal_users WHERE id = ?').get(other.id).role_id;
  t.db.prepare(`UPDATE roles SET capabilities = '["coge_contabile"]' WHERE id = ?`).run(roleId);
  assert.deepEqual((await other.call('GET', '/api/admin/me')).data.capabilities, ['coge_contabile']);
});

test('un utente rimosso non si ricrea con la stessa email: il messaggio dice di riattivarlo', async () => {
  const u = await user(['crm']);
  await t.api('DELETE', `/api/admin/portal-users/${u.id}`);
  const again = await t.api('POST', '/api/admin/portal-users', { name: 'Di nuovo', email: `enf${seq}@test.it`, username: `nuovo${seq}`, password: 'password-lunga' });
  assert.equal(again.status, 400);
  assert.match(again.data.error, /disattivato: riattivalo/);
});
