// Organigramma e matrice permessi — Fase 1 (docs/audit_permessi.md): modello dati e migrazione a parità.
//
// Struttura: org_units (con closure table org_unit_paths), positions, position_assignments. Una persona
// è un dipendente (employees) oppure solo un utente del portale: l'account è facoltativo, un
// dipendente senza account compare nell'organigramma ma non ha permessi.
// Permessi: permissions (catalogo copiato dal codice, lib/permissions.js), role_permissions con scope,
// position_roles, user_grants (eccezioni nominative con motivazione obbligatoria), delegations (a
// tempo), effective_permissions (materializzata), sod_rules.
// Vincoli nel database:
//   - un permesso sensibile non si associa a un ruolo (trigger): arriva solo da una concessione nominativa;
//   - una concessione senza motivazione non si salva; una delega ha sempre una scadenza.
// Dati: ogni ruolo riceve i permessi equivalenti ai suoi workspace; chi non aveva un ruolo riceve
// "Accesso completo"; ogni utente ha una posizione nell'unità "Da classificare" (lib/authz.js).
// Il numero 0030 lascia liberi 0020-0029 alle migrazioni della Produzione in corso.
const { migrateLegacy } = require('../lib/authz');

const SCOPE = "CHECK (scope IN ('all', 'unit', 'unit_subtree', 'own', 'assigned'))";
const SOD = [
  ['finance.fornitori.crea', 'finance.pagamenti.approva', 0, 'Chi crea un fornitore non approva i pagamenti.'],
  ['people.presenze.inserisci_squadra', 'people.presenze.approva', 1, 'Chi inserisce le ore non approva le proprie (vincolo sulla risorsa).'],
  ['commerciale.ordini.crea', 'commerciale.sconti_extra.approva', 0, 'Chi crea un ordine non approva gli sconti fuori listino.'],
  ['magazzino.rettifiche.crea', 'magazzino.rettifiche.approva', 0, 'Chi registra una rettifica non la approva.'],
];

module.exports = {
  up(db) {
    db.exec(`
      ALTER TABLE roles ADD COLUMN description TEXT;
      ALTER TABLE roles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE roles ADD COLUMN updated_at TEXT;

      CREATE TABLE permissions (
        code            TEXT PRIMARY KEY,
        module          TEXT NOT NULL,
        description     TEXT NOT NULL,
        is_sensitive    INTEGER NOT NULL DEFAULT 0,
        supports_scopes TEXT NOT NULL DEFAULT '["all"]',
        active          INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE org_units (
        id             INTEGER PRIMARY KEY,
        name           TEXT NOT NULL,
        code           TEXT NOT NULL UNIQUE,
        parent_id      INTEGER REFERENCES org_units(id),
        cost_center_id INTEGER REFERENCES cost_centers(id),
        unit_type      TEXT NOT NULL DEFAULT 'permanente' CHECK (unit_type IN ('permanente', 'squadra_temporanea')),
        team_id        INTEGER UNIQUE REFERENCES teams(id) ON DELETE SET NULL,
        valid_from     TEXT,
        valid_to       TEXT,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        active         INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        CHECK (parent_id IS NULL OR parent_id <> id),
        CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
      );
      CREATE INDEX idx_org_units_parent ON org_units(parent_id);
      CREATE TABLE org_unit_paths (
        ancestor_id   INTEGER NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
        descendant_id INTEGER NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
        depth         INTEGER NOT NULL CHECK (depth >= 0),
        PRIMARY KEY (ancestor_id, descendant_id)
      );
      CREATE INDEX idx_org_unit_paths_descendant ON org_unit_paths(descendant_id);

      CREATE TABLE positions (
        id                     INTEGER PRIMARY KEY,
        org_unit_id            INTEGER NOT NULL REFERENCES org_units(id),
        title                  TEXT NOT NULL,
        reports_to_position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
        is_manager             INTEGER NOT NULL DEFAULT 0,
        headcount_planned      INTEGER NOT NULL DEFAULT 1 CHECK (headcount_planned >= 0),
        sort_order             INTEGER NOT NULL DEFAULT 0,
        active                 INTEGER NOT NULL DEFAULT 1,
        legacy_portal_user_id  INTEGER UNIQUE REFERENCES portal_users(id) ON DELETE SET NULL,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL,
        CHECK (reports_to_position_id IS NULL OR reports_to_position_id <> id)
      );
      CREATE INDEX idx_positions_unit ON positions(org_unit_id);

      CREATE TABLE position_assignments (
        id             INTEGER PRIMARY KEY,
        position_id    INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
        employee_id    INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        portal_user_id INTEGER REFERENCES portal_users(id) ON DELETE CASCADE,
        is_primary     INTEGER NOT NULL DEFAULT 1,
        is_interim     INTEGER NOT NULL DEFAULT 0,
        valid_from     TEXT NOT NULL,
        valid_to       TEXT,
        created_by     TEXT,
        created_at     TEXT NOT NULL,
        CHECK (employee_id IS NOT NULL OR portal_user_id IS NOT NULL),
        CHECK (valid_to IS NULL OR valid_to >= valid_from)
      );
      CREATE INDEX idx_position_assignments_position ON position_assignments(position_id);
      CREATE INDEX idx_position_assignments_employee ON position_assignments(employee_id);
      CREATE INDEX idx_position_assignments_user ON position_assignments(portal_user_id);

      CREATE TABLE role_permissions (
        role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_code TEXT NOT NULL REFERENCES permissions(code),
        scope           TEXT NOT NULL DEFAULT 'all' ${SCOPE},
        PRIMARY KEY (role_id, permission_code)
      );
      CREATE TRIGGER role_permissions_no_sensitive_insert BEFORE INSERT ON role_permissions
        WHEN (SELECT is_sensitive FROM permissions WHERE code = NEW.permission_code) = 1
        BEGIN SELECT RAISE(ABORT, 'Un permesso sensibile non si associa a un ruolo: serve una concessione nominativa.'); END;
      CREATE TRIGGER role_permissions_no_sensitive_update BEFORE UPDATE ON role_permissions
        WHEN (SELECT is_sensitive FROM permissions WHERE code = NEW.permission_code) = 1
        BEGIN SELECT RAISE(ABORT, 'Un permesso sensibile non si associa a un ruolo: serve una concessione nominativa.'); END;

      CREATE TABLE position_roles (
        position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
        role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (position_id, role_id)
      );

      CREATE TABLE user_grants (
        id              INTEGER PRIMARY KEY,
        portal_user_id  INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        role_id         INTEGER REFERENCES roles(id) ON DELETE CASCADE,
        permission_code TEXT REFERENCES permissions(code),
        scope           TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'own', 'assigned')),
        reason          TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        granted_by      TEXT NOT NULL,
        valid_from      TEXT NOT NULL,
        valid_to        TEXT,
        source_role_id  INTEGER REFERENCES roles(id) ON DELETE CASCADE,
        created_at      TEXT NOT NULL,
        CHECK ((role_id IS NULL) <> (permission_code IS NULL)),
        CHECK (valid_to IS NULL OR valid_to >= valid_from)
      );
      CREATE INDEX idx_user_grants_user ON user_grants(portal_user_id);

      CREATE TABLE delegations (
        id               INTEGER PRIMARY KEY,
        from_user_id     INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        to_user_id       INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        permission_codes TEXT NOT NULL,
        valid_from       TEXT NOT NULL,
        valid_to         TEXT NOT NULL,
        reason           TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        created_by       TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        CHECK (from_user_id <> to_user_id),
        CHECK (valid_to >= valid_from)
      );
      CREATE INDEX idx_delegations_to ON delegations(to_user_id);

      CREATE TABLE effective_permissions (
        id              INTEGER PRIMARY KEY,
        portal_user_id  INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        permission_code TEXT NOT NULL REFERENCES permissions(code),
        scope           TEXT NOT NULL ${SCOPE},
        org_unit_id     INTEGER REFERENCES org_units(id) ON DELETE CASCADE,
        source          TEXT NOT NULL CHECK (source IN ('position', 'grant', 'delegation')),
        source_id       INTEGER NOT NULL,
        computed_at     TEXT NOT NULL
      );
      CREATE INDEX idx_effective_permissions_user ON effective_permissions(portal_user_id, permission_code);

      CREATE TABLE sod_rules (
        id             INTEGER PRIMARY KEY,
        permission_a   TEXT NOT NULL REFERENCES permissions(code),
        permission_b   TEXT NOT NULL REFERENCES permissions(code),
        resource_bound INTEGER NOT NULL DEFAULT 0,
        description    TEXT NOT NULL,
        active         INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL,
        CHECK (permission_a <> permission_b),
        UNIQUE (permission_a, permission_b)
      );
    `);
    migrateLegacy(db);
    const ins = db.prepare('INSERT INTO sod_rules (permission_a, permission_b, resource_bound, description, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const [a, b, bound, d] of SOD) ins.run(a, b, bound, d, new Date().toISOString());
  },
  // Torna allo schema di prima. Gli utenti a cui la migrazione ha dato "Accesso completo" lo tengono
  // (come ruolo normale, con tutti i workspace): con le regole di prima avevano comunque accesso completo.
  down(db) {
    db.exec(`
      DROP TABLE sod_rules;
      DROP TABLE effective_permissions;
      DROP TABLE delegations;
      DROP TABLE user_grants;
      DROP TABLE position_roles;
      DROP TRIGGER role_permissions_no_sensitive_update;
      DROP TRIGGER role_permissions_no_sensitive_insert;
      DROP TABLE role_permissions;
      DROP TABLE position_assignments;
      DROP TABLE positions;
      DROP TABLE org_unit_paths;
      DROP TABLE org_units;
      DROP TABLE permissions;
      ALTER TABLE roles DROP COLUMN updated_at;
      ALTER TABLE roles DROP COLUMN is_system;
      ALTER TABLE roles DROP COLUMN description;
    `);
  },
};
