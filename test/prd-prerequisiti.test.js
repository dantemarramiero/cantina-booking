// Produzione — prerequisiti: eventi v2, ora italiana, capacità per ruolo, oggetti di costo di Produzione,
// soglie da validare, unità a schermo, e il controllo che ogni regola consegnata abbia il suo test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startApp } = require('./helpers');
const time = require('../lib/time');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

let seq = 0;
async function user({ workspaces = ['produzione'], capabilities = [] } = {}) {
  const username = `prd-${++seq}`;
  const role = (await t.api('POST', '/api/admin/roles', { name: `Ruolo ${username}`, workspaces, capabilities })).data.id;
  await t.api('POST', '/api/admin/portal-users', { name: `Utente ${seq}`, email: `${username}@x.it`, username, password: 'password-lunga', role_id: role });
  const token = (await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } })).data.key;
  return { role, call: (method, p, body) => t.request(method, p, { token, body }) };
}

test('eventi v2: ogni evento porta la versione dello schema e chi ha fatto l\'azione; senza indicazioni è versione 1', () => {
  const id = t.events.transaction(() => t.events.emit('prova.evento', { payload: { a: 1 }, version: 2, actor: 'Mario Rossi' }));
  const old = t.events.transaction(() => t.events.emit('prova.evento', { payload: {} }));
  const row = t.db.prepare('SELECT schema_version, actor FROM domain_events WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { schema_version: 2, actor: 'Mario Rossi' });
  assert.deepEqual({ ...t.db.prepare('SELECT schema_version, actor FROM domain_events WHERE id = ?').get(old) }, { schema_version: 1, actor: null });
});

test('ora italiana: data operativa, campagna e anno a cavallo della mezzanotte; ora legale', () => {
  assert.equal(time.romeDate(new Date('2026-07-31T22:30:00Z')), '2026-08-01', 'in Italia è già il 1° agosto');
  assert.equal(time.campaignOf(time.romeDate(new Date('2026-07-31T22:30:00Z'))).label, '2026/2027');
  assert.equal(time.campaignOf('2026-07-31').label, '2025/2026');
  assert.equal(time.romeDate(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(time.romeToUtc('2026-01-15T13:00'), '2026-01-15T12:00:00.000Z', 'inverno: UTC+1');
  assert.equal(time.romeToUtc('2026-07-15T13:00'), '2026-07-15T11:00:00.000Z', 'estate: UTC+2');
  assert.equal(time.romeToUtc('2026-03-29T02:30'), '2026-03-29T01:30:00.000Z', "l'ora che manca va avanti di un'ora");
  const campaigns = t.db.prepare('SELECT label FROM wine_campaigns ORDER BY starts_on').all().map(x => x.label);
  assert.ok(campaigns.includes(time.campaignOf(time.romeDate()).label), 'la campagna in corso esiste');
});

test('capacità: senza ruolo tutto; sola lettura non scrive; l\'agronomo scrive il vigneto ma non la cantina; l\'enologo il contrario', async () => {
  const reader = await user({ capabilities: ['sola_lettura', 'agronomo'] });
  const agro = await user({ capabilities: ['agronomo'] });
  const eno = await user({ capabilities: ['enologo'] });
  const none = await user({ capabilities: [] });
  const outsider = await user({ workspaces: ['commerciale'], capabilities: ['enologo'] });
  const vineyard = { name: `Vigna ${seq}` };
  assert.equal((await reader.call('GET', '/api/admin/prd/vineyards')).status, 200, 'chi ha il workspace legge');
  const ro = await reader.call('POST', '/api/admin/prd/vineyards', vineyard);
  assert.equal(ro.status, 403);
  assert.match(ro.data.error, /sola lettura/);
  assert.equal((await none.call('POST', '/api/admin/prd/vineyards', vineyard)).status, 403, 'senza capacità si legge soltanto');
  assert.equal((await agro.call('POST', '/api/admin/prd/vineyards', vineyard)).status, 200);
  const noCellar = await agro.call('POST', '/api/admin/prd/vessels', { code: `VA-${seq}`, type: 'vasca_inox', capacity_ml: 1000000 });
  assert.equal(noCellar.status, 403);
  assert.match(noCellar.data.error, /Enologo/);
  assert.equal((await eno.call('POST', '/api/admin/prd/vessels', { code: `VE-${seq}`, type: 'vasca_inox', capacity_ml: 1000000 })).status, 200);
  assert.equal((await eno.call('POST', '/api/admin/prd/vineyards', { name: 'Altra' })).status, 403);
  assert.equal((await outsider.call('GET', '/api/admin/prd/vineyards')).status, 403, 'senza il workspace Produzione niente, anche con la capacità');
  assert.equal((await t.api('POST', '/api/admin/prd/vineyards', { name: 'Della chiave master' })).status, 200);
  const cat = await agro.call('GET', '/api/admin/prd/catalog');
  assert.deepEqual(cat.data.capabilities, ['agronomo']);
  assert.equal(cat.data.can.vineyard, true);
  assert.equal(cat.data.can.cellar, false);
});

test('capacità: si salvano sul ruolo (solo quelle ammesse), escono in /me e nel registro attività', async () => {
  const u = await user({ capabilities: ['cantiniere', 'inventata'] });
  const role = (await t.api('GET', '/api/admin/roles')).data.find(r => r.id === u.role);
  assert.deepEqual(role.capabilities, ['cantiniere']);
  assert.equal((await t.api('PATCH', `/api/admin/roles/${u.role}`, { capabilities: ['enologo', 'capo_squadra'] })).status, 200);
  assert.deepEqual((await u.call('GET', '/api/admin/me')).data.capabilities, ['enologo', 'capo_squadra']);
  const log = t.db.prepare("SELECT after_json FROM audit_log WHERE action = 'role.updated' ORDER BY id DESC LIMIT 1").get().after_json;
  assert.match(log, /capo_squadra/);
});

test('oggetti di costo: i tipi di Produzione esistono ma non si inseriscono a mano da Finance', async () => {
  const res = await t.api('POST', '/api/admin/finance/cost-objects', { type: 'parcella', code: 'P-1', name: 'Parcella 1' });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /li crea la Produzione/);
  const now = new Date().toISOString();
  for (const type of ['parcella', 'ordine_lavoro', 'imbottigliamento']) {
    t.db.prepare('INSERT INTO cost_objects (type, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(type, `T-${type}`, type, now, now);
  }
  assert.equal((await t.api('GET', '/api/admin/finance/cost-objects')).status, 200);
});

test('soglie: valori di partenza «da validare»; cambiare un valore lo rimette da validare; la convalida registra chi e quando', async () => {
  const list = (await t.api('GET', '/api/admin/prd/config')).data;
  const acid = list.find(x => x.key === 'acidification_max_g_l');
  assert.equal(acid.value, '4');
  assert.equal(acid.to_validate, true);
  assert.equal(acid.question_id, 'SOG-02', 'collegata al questionario per la cantina');
  assert.ok(list.every(x => x.to_validate), 'all\'inizio sono tutte da validare');
  assert.equal((await t.api('POST', '/api/admin/prd/config/acidification_max_g_l/validate')).status, 200);
  let row = t.db.prepare("SELECT * FROM prd_config WHERE key = 'acidification_max_g_l'").get();
  assert.equal(row.to_validate, 0);
  assert.equal(row.validated_by, 'Chiave master');
  assert.equal((await t.api('PATCH', '/api/admin/prd/config/acidification_max_g_l', { value: '3,5' })).status, 200);
  row = t.db.prepare("SELECT * FROM prd_config WHERE key = 'acidification_max_g_l'").get();
  assert.deepEqual([row.value, row.to_validate, row.validated_by], ['3.5', 1, null], 'valore nuovo, di nuovo da validare');
  assert.equal(t.prd.config('acidification_max_g_l'), 3.5);
  assert.equal((await t.api('PATCH', '/api/admin/prd/config/acidification_max_g_l', { value: 'tanto' })).status, 400);
  assert.equal((await t.api('PATCH', '/api/admin/prd/config/sian_deadlines', { value: '{non json' })).status, 400);
  assert.deepEqual(t.prd.config('fermentation_window'), { from: '07-15', to: '12-31' });
  const reader = await user({ capabilities: ['agronomo'] });
  assert.equal((await reader.call('PATCH', '/api/admin/prd/config/acidification_max_g_l', { value: '2' })).status, 403, 'le soglie le cambia l\'enologo o il responsabile qualità');
});

test('unità a schermo: si scelgono in Impostazioni, solo valori ammessi; il catalogo le restituisce', async () => {
  assert.equal((await t.api('GET', '/api/admin/settings')).data.prd_unit_volume, 'hl', 'partenza: ettolitri');
  assert.equal((await t.api('POST', '/api/admin/settings', { prd_unit_volume: 'l', prd_unit_sugar: 'brix' })).status, 200);
  assert.equal((await t.api('POST', '/api/admin/settings', { prd_unit_weight: 'tonnellate' })).status, 400);
  const cat = (await t.api('GET', '/api/admin/prd/catalog')).data;
  assert.deepEqual(cat.units, { volume: 'l', weight: 'q', area: 'ha', sugar: 'brix' });
  await t.api('POST', '/api/admin/settings', { prd_unit_volume: 'hl', prd_unit_sugar: 'babo' });
});

test('ogni regola PRD delle fasi consegnate ha un test con il suo ID nel nome', () => {
  // Fasi consegnate: si aggiorna alla consegna di ogni fase.
  const DELIVERED = ['Fase 1', 'Fase 2'];
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'produzione', 'regole.md'), 'utf8');
  const sections = doc.split(/\n## /).filter(s => DELIVERED.some(f => s.startsWith(f)));
  const ids = sections.flatMap(s => [...s.matchAll(/\|\s*(PRD-[A-Z]\d{2})\s*\|/g)].map(m => m[1]));
  assert.ok(ids.length >= 5, 'regole trovate nel catalogo');
  const tests = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  const missing = ids.filter(id => !new RegExp(`test\\(['"\`]${id}\\b`).test(tests));
  assert.deepEqual(missing, [], `regole senza test: ${missing.join(', ')}`);
});
