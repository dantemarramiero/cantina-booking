// Permessi effettivi e resolver unico: can(req, codice, risorsa?) e scopeFilter(req, codice, colonne).
//
// Da dove arriva un permesso (effective_permissions.source):
//   - position:   persona → posizione (assegnazione valida oggi) → ruoli della posizione → permessi del ruolo;
//   - grant:      eccezione nominativa (un ruolo intero o un solo permesso), sempre con motivazione;
//   - delegation: delega a tempo da un utente a un altro, solo dei permessi che il delegante ha.
// I permessi sensibili non passano mai da un ruolo (lo impedisce un trigger su role_permissions) e
// non si delegano: arrivano solo da una concessione nominativa diretta.
//
// La tabella effective_permissions è materializzata: si ricalcola quando cambiano ruoli, posizioni,
// concessioni o deleghe, e ogni ora (concessioni e deleghe che iniziano o scadono). Il resolver legge
// da una cache in memoria per utente, svuotata a ogni ricalcolo e al login.
//
// Fase 1 (docs/audit_permessi.md): l'accesso lo decide ancora lib/security.js; questo modulo si tiene
// allineato ai ruoli di oggi (syncRole / syncUser) e il test di parità verifica che dica lo stesso.
const { API_WORKSPACES } = require('./security');
const P = require('./permissions');
const { romeDate } = require('./time');

const UNCLASSIFIED = 'DA_CLASSIFICARE';
const FULL_ACCESS_ROLE = 'Accesso completo';
const now = () => new Date().toISOString();
const parse = (s, fallback) => { try { return JSON.parse(s ?? ''); } catch { return fallback; } };
const activeOn = (row, day) => row.valid_from <= day && (row.valid_to == null || row.valid_to >= day);

let spDepth = 0;
function tx(db, fn) {
  const sp = `authz_${spDepth++}`;
  db.exec(`SAVEPOINT ${sp}`);
  try {
    const r = fn();
    db.exec(`RELEASE ${sp}`);
    return r;
  } catch (e) {
    db.exec(`ROLLBACK TO ${sp}`);
    db.exec(`RELEASE ${sp}`);
    throw e;
  } finally {
    spDepth--;
  }
}

// ── Catalogo e struttura ──────────────────────────────────────────────────────
// Copia il catalogo del codice nella tabella. Un codice tolto dal codice resta (per lo storico e le
// chiavi esterne) ma diventa inattivo e non concede più nulla.
function syncCatalog(db) {
  const upsert = db.prepare(`INSERT INTO permissions (code, module, description, is_sensitive, supports_scopes, active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT (code) DO UPDATE SET module = excluded.module, description = excluded.description,
      is_sensitive = excluded.is_sensitive, supports_scopes = excluded.supports_scopes, active = 1`);
  tx(db, () => {
    for (const p of P.CATALOG) upsert.run(p.code, p.module, p.description, p.is_sensitive ? 1 : 0, JSON.stringify(p.scopes));
    const codes = P.CATALOG.map(p => p.code);
    db.prepare(`UPDATE permissions SET active = 0 WHERE code NOT IN (${codes.map(() => '?').join(',')})`).run(...codes);
  });
}

// Closure table della gerarchia delle unità: ricostruita per intero (le unità sono poche decine).
// Un ciclo nei parent_id è un errore: le operazioni che spostano unità lo impediscono prima.
function rebuildOrgPaths(db) {
  const units = db.prepare('SELECT id, parent_id FROM org_units').all();
  const parent = new Map(units.map(u => [u.id, u.parent_id]));
  const ins = db.prepare('INSERT INTO org_unit_paths (ancestor_id, descendant_id, depth) VALUES (?, ?, ?)');
  tx(db, () => {
    db.exec('DELETE FROM org_unit_paths');
    for (const u of units) {
      const seen = new Set();
      for (let a = u.id, depth = 0; a != null; a = parent.get(a), depth++) {
        if (seen.has(a)) throw new Error(`Ciclo nella gerarchia delle unità (unità ${u.id}).`);
        seen.add(a);
        ins.run(a, u.id, depth);
      }
    }
  });
}

function unclassifiedUnitId(db) {
  const row = db.prepare('SELECT id FROM org_units WHERE code = ?').get(UNCLASSIFIED);
  if (row) return row.id;
  const id = Number(db.prepare(`INSERT INTO org_units (name, code, unit_type, valid_from, sort_order, active, created_at, updated_at)
    VALUES ('Da classificare', ?, 'permanente', ?, 9999, 1, ?, ?)`).run(UNCLASSIFIED, romeDate(), now(), now()).lastInsertRowid);
  rebuildOrgPaths(db);
  return id;
}

// ── Allineamento con i ruoli di oggi (Fase 1, finché decide lib/security.js) ─────
const legacyRole = r => ({
  workspaces: parse(r.workspaces, []), access_levels: parse(r.access_levels, []), capabilities: parse(r.capabilities, []),
});

// Permessi del ruolo ricavati da workspace, livello "personale" e capacità.
function syncRole(db, roleId) {
  const r = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId);
  if (!r) return;
  const codes = P.legacyRolePermissions(legacyRole(r));
  tx(db, () => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(r.id);
    const ins = db.prepare("INSERT INTO role_permissions (role_id, permission_code, scope) VALUES (?, ?, 'all')");
    for (const c of codes) ins.run(r.id, c);
    for (const u of db.prepare('SELECT id FROM portal_users WHERE role_id = ?').all(r.id)) syncUserGrants(db, u.id);
  });
}

// I livelli sensibili del ruolo (retributivo, sanitario, disciplinare) diventano concessioni
// nominative con la motivazione "Migrazione dal ruolo X" (decisione Q4). source_role_id le distingue
// dalle concessioni fatte a mano, che questo allineamento non tocca mai.
function syncUserGrants(db, userId) {
  const u = db.prepare('SELECT id, role_id FROM portal_users WHERE id = ?').get(userId);
  if (!u) return;
  const role = u.role_id ? db.prepare('SELECT * FROM roles WHERE id = ?').get(u.role_id) : null;
  const wanted = new Set(role ? P.legacySensitiveCodes(legacyRole(role).access_levels) : []);
  const existing = db.prepare('SELECT id, permission_code, source_role_id FROM user_grants WHERE portal_user_id = ? AND source_role_id IS NOT NULL').all(u.id);
  for (const g of existing) {
    if (g.source_role_id === role?.id && wanted.has(g.permission_code)) wanted.delete(g.permission_code);
    else db.prepare('DELETE FROM user_grants WHERE id = ?').run(g.id);
  }
  const ins = db.prepare(`INSERT INTO user_grants (portal_user_id, permission_code, scope, reason, granted_by, valid_from, source_role_id, created_at)
    VALUES (?, ?, 'all', ?, 'Migrazione', ?, ?, ?)`);
  for (const code of wanted) ins.run(u.id, code, `Migrazione dal ruolo ${role.name}`, romeDate(), role.id, now());
}

// Ogni utente ha una posizione "sua" nell'unità Da classificare, con il ruolo che ha oggi.
// positions.legacy_portal_user_id la identifica anche dopo che l'organigramma l'avrà spostata.
function syncUser(db, userId) {
  const u = db.prepare('SELECT * FROM portal_users WHERE id = ?').get(Number(userId));
  if (!u) return;
  tx(db, () => {
    let pos = db.prepare('SELECT * FROM positions WHERE legacy_portal_user_id = ?').get(u.id);
    if (!pos) {
      const id = Number(db.prepare(`INSERT INTO positions (org_unit_id, title, is_manager, headcount_planned, sort_order, active, legacy_portal_user_id, created_at, updated_at)
        VALUES (?, ?, 0, 1, 0, 1, ?, ?, ?)`).run(unclassifiedUnitId(db), u.name, u.id, now(), now()).lastInsertRowid);
      const emp = db.prepare('SELECT id FROM employees WHERE portal_user_id = ?').get(u.id);
      db.prepare(`INSERT INTO position_assignments (position_id, employee_id, portal_user_id, is_primary, is_interim, valid_from, created_by, created_at)
        VALUES (?, ?, ?, 1, 0, ?, 'Migrazione', ?)`).run(id, emp?.id ?? null, u.id, romeDate(), now());
      pos = { id };
    } else {
      db.prepare('UPDATE positions SET title = ?, updated_at = ? WHERE id = ?').run(u.name, now(), pos.id);
    }
    db.prepare('DELETE FROM position_roles WHERE position_id = ?').run(pos.id);
    if (u.role_id && db.prepare('SELECT 1 FROM roles WHERE id = ?').get(u.role_id)) {
      db.prepare('INSERT INTO position_roles (position_id, role_id) VALUES (?, ?)').run(pos.id, u.role_id);
    }
    syncUserGrants(db, u.id);
  });
}

// Migrazione a parità (0030). Chi oggi non ha un ruolo (o ha un ruolo che non esiste più) ha accesso
// completo: riceve il ruolo di sistema "Accesso completo", così nessuno perde nulla quando "senza
// ruolo" smette di voler dire "tutto" (decisione Q2).
function migrateLegacy(db) {
  syncCatalog(db);
  unclassifiedUnitId(db);
  const allWorkspaces = [...new Set(Object.values(API_WORKSPACES).flatMap(r => [r.read, r.write]).filter(Array.isArray).flat())];
  let full = db.prepare('SELECT id FROM roles WHERE is_system = 1 AND name = ?').get(FULL_ACCESS_ROLE);
  if (!full) {
    full = { id: Number(db.prepare(`INSERT INTO roles (name, workspaces, access_levels, capabilities, description, is_system, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)`).run(FULL_ACCESS_ROLE, JSON.stringify(allWorkspaces),
      JSON.stringify(['personale', 'retributivo', 'sanitario', 'disciplinare']),
      JSON.stringify(P.PRD_CAPABILITIES.filter(c => c !== 'sola_lettura')),
      'Tutti i moduli: assegnato dalla migrazione a chi prima non aveva un ruolo.', now()).lastInsertRowid) };
  }
  db.prepare('UPDATE portal_users SET role_id = ? WHERE role_id IS NULL OR role_id NOT IN (SELECT id FROM roles)').run(full.id);
  for (const r of db.prepare('SELECT id FROM roles').all()) syncRole(db, r.id);
  for (const u of db.prepare('SELECT id FROM portal_users').all()) syncUser(db, u.id);
  recompute(db);
  return full.id;
}

// ── Permessi effettivi ────────────────────────────────────────────────────────
// userId assente = tutti gli utenti. Tutto in una transazione: chi legge vede il prima o il dopo.
function recompute(db, userId = null, day = romeDate()) {
  // Gli id arrivano anche dai parametri delle URL (testo): COALESCE non ha affinità e '21' <> 21.
  userId = userId == null ? null : Number(userId);
  const sensitive = new Set(db.prepare('SELECT code FROM permissions WHERE is_sensitive = 1').all().map(r => r.code));
  const activeCodes = new Set(db.prepare('SELECT code FROM permissions WHERE active = 1').all().map(r => r.code));
  const rolePerms = new Map();
  for (const rp of db.prepare('SELECT role_id, permission_code, scope FROM role_permissions').all()) {
    if (!rolePerms.has(rp.role_id)) rolePerms.set(rp.role_id, []);
    rolePerms.get(rp.role_id).push(rp);
  }
  const rows = new Map(); // uid → Map(chiave → riga)
  const add = (uid, code, scope, unit, source, sourceId) => {
    if (uid == null || !activeCodes.has(code)) return;
    if (!rows.has(uid)) rows.set(uid, new Map());
    const key = `${code}|${scope}|${unit ?? ''}`;
    if (!rows.get(uid).has(key)) rows.get(uid).set(key, { code, scope, unit, source, sourceId });
  };
  const forUser = userId == null ? '' : ' AND COALESCE(pa.portal_user_id, e.portal_user_id) = ?';
  const assignments = db.prepare(`
    SELECT COALESCE(pa.portal_user_id, e.portal_user_id) AS uid, pa.valid_from, pa.valid_to,
           p.id AS position_id, p.org_unit_id, u.valid_from AS unit_from, u.valid_to AS unit_to
    FROM position_assignments pa
    JOIN positions p ON p.id = pa.position_id AND p.active = 1
    JOIN org_units u ON u.id = p.org_unit_id AND u.active = 1
    LEFT JOIN employees e ON e.id = pa.employee_id
    WHERE 1 = 1${forUser}`).all(...(userId == null ? [] : [userId]));
  const positionRoles = db.prepare('SELECT role_id FROM position_roles WHERE position_id = ?');
  for (const a of assignments) {
    if (!activeOn(a, day) || !activeOn({ valid_from: a.unit_from || day, valid_to: a.unit_to }, day)) continue;
    for (const { role_id } of positionRoles.all(a.position_id)) {
      for (const rp of rolePerms.get(role_id) || []) {
        if (!sensitive.has(rp.permission_code)) add(a.uid, rp.permission_code, rp.scope, a.org_unit_id, 'position', a.position_id);
      }
    }
  }
  const grants = db.prepare(`SELECT * FROM user_grants${userId == null ? '' : ' WHERE portal_user_id = ?'}`).all(...(userId == null ? [] : [userId]));
  for (const g of grants) {
    if (!activeOn(g, day)) continue;
    if (g.permission_code) add(g.portal_user_id, g.permission_code, g.scope, null, 'grant', g.id);
    else for (const rp of rolePerms.get(g.role_id) || []) {
      if (!sensitive.has(rp.permission_code)) add(g.portal_user_id, rp.permission_code, rp.scope === 'all' ? 'all' : g.scope, null, 'grant', g.id);
    }
  }
  // Deleghe: solo i permessi che il delegante ha da posizione o concessione (niente catene di deleghe),
  // mai quelli sensibili. Con un solo utente da ricalcolare servono comunque i permessi del delegante.
  const delegations = db.prepare(`SELECT * FROM delegations${userId == null ? '' : ' WHERE to_user_id = ?'}`).all(...(userId == null ? [] : [userId]));
  for (const d of delegations) {
    if (!activeOn(d, day)) continue;
    const own = userId == null ? rows.get(d.from_user_id) : ownRows(db, d.from_user_id);
    for (const code of parse(d.permission_codes, [])) {
      if (sensitive.has(code)) continue;
      for (const r of (own ? [...own.values()] : []).filter(x => x.code === code && x.source !== 'delegation')) {
        add(d.to_user_id, code, r.scope, r.unit, 'delegation', d.id);
      }
    }
  }
  tx(db, () => {
    if (userId == null) db.exec('DELETE FROM effective_permissions');
    else db.prepare('DELETE FROM effective_permissions WHERE portal_user_id = ?').run(userId);
    const ins = db.prepare(`INSERT INTO effective_permissions (portal_user_id, permission_code, scope, org_unit_id, source, source_id, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const at = now();
    for (const [uid, m] of rows) {
      if (!db.prepare('SELECT 1 FROM portal_users WHERE id = ?').get(uid)) continue;
      for (const r of m.values()) ins.run(uid, r.code, r.scope, r.unit, r.source, r.sourceId, at);
    }
  });
}
function ownRows(db, uid) {
  const m = new Map();
  for (const r of db.prepare("SELECT permission_code AS code, scope, org_unit_id AS unit, source FROM effective_permissions WHERE portal_user_id = ? AND source != 'delegation'").all(uid)) {
    m.set(`${r.code}|${r.scope}|${r.unit ?? ''}`, r);
  }
  return m;
}

// ── Resolver ──────────────────────────────────────────────────────────────────
function createAuthz(db) {
  const cache = new Map(); // uid → Map(code → [{scope, unit}])
  function entriesFor(uid) {
    if (!cache.has(uid)) {
      const m = new Map();
      for (const r of db.prepare('SELECT permission_code, scope, org_unit_id FROM effective_permissions WHERE portal_user_id = ?').all(uid)) {
        if (!m.has(r.permission_code)) m.set(r.permission_code, []);
        m.get(r.permission_code).push({ scope: r.scope, unit: r.org_unit_id });
      }
      cache.set(uid, m);
    }
    return cache.get(uid);
  }
  const invalidate = (uid = null) => (uid == null ? cache.clear() : cache.delete(uid));
  const userIdOf = subject => subject?.portalUser?.id ?? subject?.id ?? null;
  const isMaster = subject => !!subject?.isMasterKey;
  const inSubtree = (ancestor, unit) => ancestor != null && unit != null
    && !!db.prepare('SELECT 1 FROM org_unit_paths WHERE ancestor_id = ? AND descendant_id = ?').get(ancestor, unit);

  // resource (facoltativa): { org_unit_id, owner_user_id, assigned_user_ids: [] }.
  // Senza risorsa basta avere il permesso con uno scope qualsiasi (controllo della route); le liste
  // poi si filtrano con scopeFilter.
  function can(subject, code, resource) {
    if (isMaster(subject)) return true;
    const uid = userIdOf(subject);
    if (uid == null) return false;
    if (code === P.ANY) return true;
    const entries = entriesFor(uid).get(code);
    if (!entries?.length) return false;
    if (resource === undefined) return true;
    return entries.some(e => {
      switch (e.scope) {
        case 'all': return true;
        case 'own': return resource.owner_user_id === uid;
        case 'assigned': return (resource.assigned_user_ids || []).includes(uid);
        case 'unit': return e.unit != null && resource.org_unit_id === e.unit;
        case 'unit_subtree': return inSubtree(e.unit, resource.org_unit_id);
        default: return false;
      }
    });
  }
  // Stesso esito di lib/security.js → canAccess per una chiamata HTTP.
  function canRoute(subject, method, pathname) {
    const code = P.permissionForRoute(method, pathname);
    return code != null && can(subject, code);
  }
  // Frammento SQL per filtrare una lista secondo lo scope, da mettere in un WHERE. cols indica le colonne
  // della query: { unit: 'x.org_unit_id', owner: 'x.created_by_user_id', assigned: 'x.operator_user_id' }.
  // Uno scope senza la colonna corrispondente non concede righe.
  function scopeFilter(subject, code, cols = {}) {
    if (isMaster(subject)) return { sql: '1 = 1', params: [] };
    const uid = userIdOf(subject);
    const entries = uid == null ? [] : entriesFor(uid).get(code) || [];
    if (entries.some(e => e.scope === 'all')) return { sql: '1 = 1', params: [] };
    const parts = [], params = [];
    for (const e of entries) {
      if (e.scope === 'own' && cols.owner) { parts.push(`${cols.owner} = ?`); params.push(uid); }
      if (e.scope === 'assigned' && cols.assigned) { parts.push(`${cols.assigned} = ?`); params.push(uid); }
      if (e.scope === 'unit' && cols.unit && e.unit != null) { parts.push(`${cols.unit} = ?`); params.push(e.unit); }
      if (e.scope === 'unit_subtree' && cols.unit && e.unit != null) {
        parts.push(`${cols.unit} IN (SELECT descendant_id FROM org_unit_paths WHERE ancestor_id = ?)`); params.push(e.unit);
      }
    }
    return parts.length ? { sql: `(${parts.join(' OR ')})`, params } : { sql: '1 = 0', params: [] };
  }
  // Perché un utente ha (o non ha) un permesso: le righe con la loro origine (Fase 4, "Perché posso?").
  function explain(userId, code) {
    return db.prepare(`SELECT ep.scope, ep.org_unit_id, ep.source, ep.source_id,
        CASE ep.source WHEN 'position' THEN (SELECT title FROM positions WHERE id = ep.source_id)
                       WHEN 'grant' THEN (SELECT reason FROM user_grants WHERE id = ep.source_id)
                       ELSE (SELECT reason FROM delegations WHERE id = ep.source_id) END AS detail
      FROM effective_permissions ep WHERE ep.portal_user_id = ? AND ep.permission_code = ?`).all(userId, code);
  }
  // Ruoli che un utente ha oggi: dalle posizioni con un'assegnazione valida e dalle concessioni di un ruolo
  // intero. Servono all'interfaccia (quali moduli mostrare); i controlli passano sempre da can().
  function rolesOf(subject) {
    const uid = userIdOf(subject);
    if (uid == null) return [];
    return db.prepare(`SELECT DISTINCT r.* FROM roles r WHERE r.id IN (
        SELECT pr.role_id FROM position_roles pr JOIN position_assignments pa ON pa.position_id = pr.position_id
        JOIN positions p ON p.id = pa.position_id AND p.active = 1
        LEFT JOIN employees e ON e.id = pa.employee_id
        WHERE COALESCE(pa.portal_user_id, e.portal_user_id) = ? AND pa.valid_from <= ? AND (pa.valid_to IS NULL OR pa.valid_to >= ?)
        UNION
        SELECT role_id FROM user_grants WHERE portal_user_id = ? AND role_id IS NOT NULL AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)
      ) ORDER BY r.name`).all(uid, romeDate(), romeDate(), uid, romeDate(), romeDate());
  }
  const after = fn => (...args) => { const r = fn(db, ...args); invalidate(); return r; };
  return {
    can, canRoute, scopeFilter, explain, invalidate, rolesOf,
    recompute: after(recompute),
    syncRole: roleId => { syncRole(db, roleId); recompute(db); invalidate(); },
    syncUser: userId => { syncUser(db, userId); recompute(db, userId); invalidate(Number(userId)); },
    syncCatalog: () => syncCatalog(db),
    rebuildOrgPaths: after(rebuildOrgPaths),
  };
}

module.exports = { createAuthz, migrateLegacy, recompute, syncCatalog, rebuildOrgPaths, syncRole, syncUser, UNCLASSIFIED, FULL_ACCESS_ROLE };
