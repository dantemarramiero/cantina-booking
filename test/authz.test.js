// Organigramma e permessi, Fase 1 (docs/audit_permessi.md): modello dati, resolver can()/scopeFilter(),
// migrazione a parità. Il test di parità annulla la migrazione 0030, rimette i dati "come oggi" (ruoli
// con workspace, livelli e capacità; utenti senza ruolo), la riapplica e confronta, per ogni utente e
// ogni API del portale, il controllo di lib/security.js con quello nuovo.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startApp } = require('./helpers');
const { canAccess, ACCESS_LEVELS } = require('../lib/security');
const P = require('../lib/permissions');
const A = require('../lib/authz');
const { runMigrations, rollbackMigration, migrationStatus } = require('../lib/migrations');

const MIG_DIR = path.join(__dirname, '..', 'migrations');
const silent = () => {};
let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const now = () => new Date().toISOString();
const today = () => require('../lib/time').romeDate();
const as = id => ({ portalUser: { id } });
// Tutte le API del portale protette da authAdmin, per metodo (il login POST /api/admin/session non lo è).
const adminRoutes = () => t.app._router.stack
  .filter(l => l.route?.path?.startsWith('/api/admin/') && l.route.stack.some(s => s.name === 'authAdmin'))
  .flatMap(l => Object.keys(l.route.methods).map(m => [m.toUpperCase(), l.route.path]));

// Le regole di oggi, riscritte dal codice di server.js prima della Fase 1 (null = tutto).
const legacyLevel = (levels, level) => levels === null || ['base', ...levels].includes(level);
const legacyCap = (caps, cap) => caps === null || (!caps.includes('sola_lettura') && caps.includes(cap));

function insertUser(name, roleId, active = 1) {
  return Number(t.db.prepare(`INSERT INTO portal_users (name, email, username, password_hash, access_key, active, role_id)
    VALUES (?, ?, ?, 'x:y', ?, ?, ?)`).run(name, `${name}@parita.it`, name, `k-${name}`, active, roleId).lastInsertRowid);
}

test('28 · la migrazione dà a ogni utente esattamente gli accessi di prima (test di parità)', () => {
  // 1. Si torna a prima della 0030.
  while (migrationStatus(t.db, MIG_DIR).filter(m => m.applied_at).map(m => m.version).sort().pop() >= '0030') {
    rollbackMigration(t.db, { dir: MIG_DIR, log: silent });
  }
  assert.ok(!t.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'effective_permissions'").get(), '0030 annullata');

  // 2. Ruoli come si possono avere oggi: ogni workspace da solo, combinazioni, livelli, capacità.
  const WS = ['enoturismo', 'commerciale', 'produzione', 'magazzino', 'crm', 'people', 'finance', 'impostazioni'];
  const roleDefs = [
    ...WS.map(w => ({ name: `Solo ${w}`, workspaces: [w] })),
    { name: 'Vuoto', workspaces: [] },
    { name: 'Commerciale e CRM', workspaces: ['commerciale', 'crm'] },
    { name: 'Magazzino e Produzione', workspaces: ['magazzino', 'produzione'], capabilities: ['cantiniere'] },
    { name: 'HR completo', workspaces: ['people'], access_levels: ['personale', 'retributivo', 'sanitario', 'disciplinare'] },
    { name: 'HR base', workspaces: ['people', 'finance'], access_levels: ['personale'] },
    { name: 'Medico', workspaces: [], access_levels: ['sanitario'] },
    { name: 'Enologo', workspaces: ['produzione'], capabilities: ['enologo', 'responsabile_qualita'] },
    { name: 'Sola lettura PRD', workspaces: ['produzione'], capabilities: ['sola_lettura', 'enologo'] },
    { name: 'Tutto', workspaces: WS, access_levels: ['retributivo'], capabilities: ['agronomo', 'capo_squadra'] },
  ];
  const users = [];
  for (const r of roleDefs) {
    const id = Number(t.db.prepare('INSERT INTO roles (name, workspaces, access_levels, capabilities) VALUES (?, ?, ?, ?)')
      .run(r.name, JSON.stringify(r.workspaces), JSON.stringify(r.access_levels || []), JSON.stringify(r.capabilities || [])).lastInsertRowid);
    users.push({ id: insertUser(`parita-${id}`, id), ws: r.workspaces, levels: r.access_levels || [], caps: r.capabilities || [] });
  }
  // Senza ruolo (attivo e disattivato): oggi accesso completo.
  for (const [n, active] of [['parita-senza-ruolo', 1], ['parita-senza-ruolo-off', 0]]) {
    users.push({ id: insertUser(n, null, active), ws: null, levels: null, caps: null, roleless: true });
  }
  // Più gli utenti già presenti nel database dei test, calcolati allo stesso modo.
  const known = new Set(users.map(u => u.id));
  for (const u of t.db.prepare('SELECT id, role_id FROM portal_users').all()) {
    if (known.has(u.id)) continue;
    const r = u.role_id ? t.db.prepare('SELECT * FROM roles WHERE id = ?').get(u.role_id) : null;
    users.push(r ? { id: u.id, ws: JSON.parse(r.workspaces), levels: JSON.parse(r.access_levels || '[]'), caps: JSON.parse(r.capabilities || '[]') }
      : { id: u.id, ws: null, levels: null, caps: null, roleless: true });
  }

  // 3. Si riapplica la migrazione.
  assert.deepEqual(runMigrations(t.db, { dir: MIG_DIR, log: silent }), ['0030']);
  t.authz.invalidate();

  // 4. Stesso esito per ogni utente × ogni API, ogni livello di riservatezza e ogni capacità.
  const routes = adminRoutes();
  const diffs = [];
  let checks = 0;
  for (const u of users) {
    for (const [m, p] of routes) {
      checks++;
      if (canAccess(u.ws, m, p) !== t.authz.canRoute(as(u.id), m, p)) diffs.push(`utente ${u.id}: ${m} ${p}`);
    }
    for (const level of ACCESS_LEVELS) {
      checks++;
      const now_ = level === 'base' || t.authz.can(as(u.id), P.LEVEL_PERMISSIONS[level]);
      if (legacyLevel(u.levels, level) !== now_) diffs.push(`utente ${u.id}: livello ${level}`);
    }
    for (const [cap, code] of Object.entries(P.CAPABILITY_PERMISSIONS)) {
      checks++;
      if (legacyCap(u.caps, cap) !== t.authz.can(as(u.id), code)) diffs.push(`utente ${u.id}: capacità ${cap}`);
    }
  }
  assert.deepEqual(diffs, [], `${diffs.length} differenze su ${checks} controlli`);
  assert.ok(checks > users.length * 400, `controlli eseguiti: ${checks}`);

  // Chi non aveva un ruolo ora ha "Accesso completo", e i livelli sensibili come concessioni nominative.
  const full = t.db.prepare('SELECT * FROM roles WHERE is_system = 1 AND name = ?').get(A.FULL_ACCESS_ROLE);
  for (const u of users.filter(x => x.roleless)) {
    assert.equal(t.db.prepare('SELECT role_id FROM portal_users WHERE id = ?').get(u.id).role_id, full.id);
  }
  const grants = t.db.prepare('SELECT permission_code, reason FROM user_grants WHERE portal_user_id = ? ORDER BY permission_code').all(users.find(x => x.roleless).id);
  assert.deepEqual(grants.map(g => g.permission_code), ['people.disciplinare.leggi', 'people.idoneita.leggi', 'people.retribuzioni.leggi']);
  assert.ok(grants.every(g => g.reason === `Migrazione dal ruolo ${A.FULL_ACCESS_ROLE}`));
  // Ognuno ha la sua posizione nell'unità "Da classificare", con il suo ruolo.
  const unit = t.db.prepare('SELECT id FROM org_units WHERE code = ?').get(A.UNCLASSIFIED);
  const pos = t.db.prepare('SELECT p.org_unit_id, pr.role_id FROM positions p JOIN position_roles pr ON pr.position_id = p.id WHERE p.legacy_portal_user_id = ?').get(users[0].id);
  assert.equal(pos.org_unit_id, unit.id);
  // Idempotente: una seconda esecuzione della parte dati non cambia nulla.
  const snapshot = () => t.db.prepare('SELECT portal_user_id, permission_code, scope FROM effective_permissions ORDER BY 1, 2, 3').all();
  const before = snapshot();
  A.migrateLegacy(t.db);
  assert.deepEqual(snapshot(), before);
});

test('le modifiche a ruoli e utenti da Impostazioni restano allineate (parità dal vivo)', async () => {
  const role = (await t.api('POST', '/api/admin/roles', { name: 'Vivo', workspaces: ['crm'], access_levels: ['sanitario'] })).data.id;
  const u = (await t.api('POST', '/api/admin/portal-users', { name: 'Vivo', email: 'vivo@test.it', username: 'vivo', password: 'password-lunga', role_id: role })).data.id;
  const check = ws => {
    for (const [m, p] of adminRoutes()) assert.equal(t.authz.canRoute(as(u), m, p), canAccess(ws, m, p), `${m} ${p} con ${ws}`);
  };
  check(['crm']);
  assert.ok(t.authz.can(as(u), 'people.idoneita.leggi'), 'livello sensibile come concessione nominativa');
  await t.api('PATCH', `/api/admin/roles/${role}`, { workspaces: ['enoturismo', 'magazzino'], access_levels: [] });
  check(['enoturismo', 'magazzino']);
  assert.ok(!t.authz.can(as(u), 'people.idoneita.leggi'), 'tolto dal ruolo, tolta la concessione');
  const other = (await t.api('POST', '/api/admin/roles', { name: 'Altro', workspaces: ['finance'] })).data.id;
  await t.api('PATCH', `/api/admin/portal-users/${u}`, { role_id: other });
  check(['finance']);
  await t.api('PATCH', `/api/admin/portal-users/${u}`, { role_id: '' });
  check([]);
});

test('Q2 · un ruolo assegnato o di sistema non si cancella; un utente senza ruolo non ha moduli', async () => {
  const role = (await t.api('POST', '/api/admin/roles', { name: 'Da cancellare', workspaces: ['crm'] })).data.id;
  const u = (await t.api('POST', '/api/admin/portal-users', { name: 'Assegnato', email: 'assegnato@test.it', username: 'assegnato', password: 'password-lunga', role_id: role })).data.id;
  const del = await t.api('DELETE', `/api/admin/roles/${role}`);
  assert.equal(del.status, 409);
  assert.match(del.data.error, /Assegnato/);
  const full = t.db.prepare('SELECT id FROM roles WHERE is_system = 1').get();
  assert.equal((await t.api('DELETE', `/api/admin/roles/${full.id}`)).status, 409);
  await t.api('PATCH', `/api/admin/portal-users/${u}`, { role_id: '' });
  assert.equal((await t.api('DELETE', `/api/admin/roles/${role}`)).status, 200, 'senza utenti si cancella');
  const login = await t.request('POST', '/api/portal-users/login', { body: { username: 'assegnato', password: 'password-lunga' } });
  assert.equal((await t.request('GET', '/api/admin/customers', { token: login.data.key })).status, 403);
});

test('ogni API del portale ha un permesso nel catalogo, e il catalogo è nel database', () => {
  for (const [m, p] of adminRoutes()) {
    const code = P.permissionForRoute(m, p);
    assert.ok(code === P.ANY || P.BY_CODE.has(code), `${m} ${p} → ${code}`);
  }
  const rows = t.db.prepare('SELECT code, is_sensitive FROM permissions WHERE active = 1').all();
  assert.equal(rows.length, P.CATALOG.length);
  assert.deepEqual(rows.filter(r => r.is_sensitive).map(r => r.code).sort(),
    ['finance.paghe.leggi', 'people.disciplinare.leggi', 'people.documenti_personali.leggi', 'people.idoneita.leggi', 'people.retribuzioni.leggi']);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM sod_rules').get().c, 4);
});

test('10 · 12 · un permesso sensibile non si associa a un ruolo, con nessuno scope', () => {
  const role = Number(t.db.prepare("INSERT INTO roles (name, workspaces) VALUES ('Sensibile', '[]')").run().lastInsertRowid);
  for (const scope of ['all', 'unit_subtree']) {
    assert.throws(() => t.db.prepare('INSERT INTO role_permissions (role_id, permission_code, scope) VALUES (?, ?, ?)').run(role, 'people.idoneita.leggi', scope), /sensibile/);
  }
  t.db.prepare("INSERT INTO role_permissions (role_id, permission_code) VALUES (?, 'crm.clienti.leggi')").run(role);
  assert.throws(() => t.db.prepare("UPDATE role_permissions SET permission_code = 'finance.paghe.leggi' WHERE role_id = ?").run(role), /sensibile/);
});

test('17 · una concessione senza motivazione non si salva', () => {
  const u = insertUser('senza-motivo', null);
  const grant = reason => t.db.prepare(`INSERT INTO user_grants (portal_user_id, permission_code, reason, granted_by, valid_from, created_at)
    VALUES (?, 'crm.clienti.leggi', ?, 'test', ?, ?)`).run(u, reason, today(), now());
  assert.throws(() => grant('   '), /CHECK/);
  assert.throws(() => grant(null), /NOT NULL/);
  grant('Supporto al commerciale durante la fiera');
});

// Struttura di prova: Azienda > Vigneto > Vigneto Nord, e Cantina come unità sorella.
function orgFixture() {
  const unit = (name, code, parent) => Number(t.db.prepare(`INSERT INTO org_units (name, code, parent_id, valid_from, created_at, updated_at)
    VALUES (?, ?, ?, '2020-01-01', ?, ?)`).run(name, code, parent, now(), now()).lastInsertRowid);
  const root = unit('Azienda', `AZ-${Date.now()}`, null);
  const vig = unit('Vigneto', `VIG-${Date.now()}`, root);
  const nord = unit('Vigneto Nord', `VN-${Date.now()}`, vig);
  const cantina = unit('Cantina', `CAN-${Date.now()}`, root);
  t.authz.rebuildOrgPaths();
  return { root, vig, nord, cantina };
}
function position(unitId, title, roleId) {
  const id = Number(t.db.prepare('INSERT INTO positions (org_unit_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(unitId, title, now(), now()).lastInsertRowid);
  if (roleId) t.db.prepare('INSERT INTO position_roles (position_id, role_id) VALUES (?, ?)').run(id, roleId);
  return id;
}

test('9 · scope unit_subtree: il sottoalbero sì, le unità sorelle no (anche nei filtri SQL)', () => {
  const o = orgFixture();
  const role = Number(t.db.prepare("INSERT INTO roles (name, workspaces) VALUES ('Responsabile vigneto', '[]')").run().lastInsertRowid);
  t.db.prepare("INSERT INTO role_permissions (role_id, permission_code, scope) VALUES (?, 'people.ferie.approva', 'unit_subtree')").run(role);
  const u = insertUser('resp-vigneto', null);
  t.db.prepare("INSERT INTO position_assignments (position_id, portal_user_id, valid_from, created_at) VALUES (?, ?, '2020-01-01', ?)").run(position(o.vig, 'Responsabile vigneto', role), u, now());
  t.authz.recompute();
  assert.ok(t.authz.can(as(u), 'people.ferie.approva'), 'ha il permesso');
  assert.ok(t.authz.can(as(u), 'people.ferie.approva', { org_unit_id: o.vig }));
  assert.ok(t.authz.can(as(u), 'people.ferie.approva', { org_unit_id: o.nord }), 'sottoalbero');
  assert.ok(!t.authz.can(as(u), 'people.ferie.approva', { org_unit_id: o.cantina }), 'unità sorella');
  assert.ok(!t.authz.can(as(u), 'people.ferie.approva', { org_unit_id: o.root }), 'unità sopra');
  // 23 · lo stesso filtro in SQL: niente righe caricate e poi scartate in JavaScript.
  const f = t.authz.scopeFilter(as(u), 'people.ferie.approva', { unit: 'u.id' });
  const seen = t.db.prepare(`SELECT u.id FROM org_units u WHERE u.id IN (?, ?, ?, ?) AND ${f.sql} ORDER BY u.id`).all(o.root, o.vig, o.nord, o.cantina, ...f.params).map(r => r.id);
  assert.deepEqual(seen, [o.vig, o.nord]);
  assert.equal(t.authz.scopeFilter(as(u), 'crm.clienti.leggi', { unit: 'u.id' }).sql, '1 = 0', 'senza permesso nessuna riga');
  assert.equal(t.authz.scopeFilter({ isMasterKey: true }, 'crm.clienti.leggi').sql, '1 = 1');
  assert.deepEqual(t.authz.explain(u, 'people.ferie.approva').map(r => [r.source, r.detail]), [['position', 'Responsabile vigneto']]);
});

test('18 · un dipendente senza account compare nell\'organigramma ma non ha permessi', () => {
  const o = orgFixture();
  const role = Number(t.db.prepare("INSERT INTO roles (name, workspaces) VALUES ('Stagionale', '[\"produzione\"]')").run().lastInsertRowid);
  A.syncRole(t.db, role);
  const emp = Number(t.db.prepare("INSERT INTO employees (first_name, last_name, created_at, updated_at) VALUES ('Mario', 'Stagionale', ?, ?)").run(now(), now()).lastInsertRowid);
  const count = () => t.db.prepare('SELECT COUNT(*) AS c FROM effective_permissions').get().c;
  t.authz.recompute();
  const before = count();
  t.db.prepare("INSERT INTO position_assignments (position_id, employee_id, valid_from, created_at) VALUES (?, ?, '2020-01-01', ?)").run(position(o.nord, 'Vendemmiatore', role), emp, now());
  t.authz.recompute();
  assert.equal(count(), before, 'nessun permesso effettivo in più');
  assert.throws(() => t.db.prepare("INSERT INTO position_assignments (position_id, valid_from, created_at) VALUES (?, '2020-01-01', ?)").run(position(o.nord, 'Vuota'), now()), /CHECK/, 'un\'assegnazione ha sempre una persona');
  // 19 · quando gli si crea l'account, eredita i permessi della posizione (già pubblicata).
  const u = insertUser('mario-stagionale', null);
  t.db.prepare('UPDATE employees SET portal_user_id = ? WHERE id = ?').run(u, emp);
  t.authz.recompute(u);
  assert.ok(t.authz.can(as(u), 'produzione.prd.leggi'));
});

test('16 · concessioni e deleghe valgono solo nel loro periodo e scadono da sole', () => {
  const from = insertUser('delegante', null);
  const to = insertUser('delegato', null);
  const role = Number(t.db.prepare("INSERT INTO roles (name, workspaces, access_levels) VALUES ('Enoturismo resp', '[\"enoturismo\"]', '[\"sanitario\"]')").run().lastInsertRowid);
  t.db.prepare('UPDATE portal_users SET role_id = ? WHERE id = ?').run(role, from);
  A.syncRole(t.db, role);
  A.syncUser(t.db, from);
  t.db.prepare(`INSERT INTO delegations (from_user_id, to_user_id, permission_codes, valid_from, valid_to, reason, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 'Ferie di agosto', 'test', ?)`).run(from, to, JSON.stringify(['enoturismo.prenotazioni.scrivi', 'people.idoneita.leggi', 'finance.contabilita.leggi']), today(), today(), now());
  t.db.prepare(`INSERT INTO user_grants (portal_user_id, permission_code, reason, granted_by, valid_from, valid_to, created_at)
    VALUES (?, 'crm.clienti.leggi', 'Fiera Vinitaly', 'test', '2020-01-01', '2020-12-31', ?)`).run(to, now());
  t.authz.recompute();
  assert.ok(t.authz.can(as(to), 'enoturismo.prenotazioni.scrivi'), 'delega attiva');
  assert.ok(!t.authz.can(as(to), 'people.idoneita.leggi'), 'i permessi sensibili non si delegano');
  assert.ok(!t.authz.can(as(to), 'finance.contabilita.leggi'), 'si delega solo ciò che il delegante ha');
  assert.ok(!t.authz.can(as(to), 'crm.clienti.leggi'), 'concessione scaduta');
  A.recompute(t.db, null, '2999-01-01');
  t.authz.invalidate();
  assert.ok(!t.authz.can(as(to), 'enoturismo.prenotazioni.scrivi'), 'dopo la scadenza la delega non vale più');
  t.authz.recompute();
});

test('4 · la gerarchia delle unità non ammette cicli', () => {
  const o = orgFixture();
  t.db.prepare('UPDATE org_units SET parent_id = ? WHERE id = ?').run(o.nord, o.vig);
  assert.throws(() => A.rebuildOrgPaths(t.db), /Ciclo/);
  t.db.prepare('UPDATE org_units SET parent_id = ? WHERE id = ?').run(o.root, o.vig);
  A.rebuildOrgPaths(t.db);
  assert.throws(() => t.db.prepare('UPDATE org_units SET parent_id = id WHERE id = ?').run(o.root), /CHECK/);
});
