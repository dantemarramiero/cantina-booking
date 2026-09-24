// Servizi di People (Fase 2, blocco 2E): beni assegnati, richieste di modifica dei dati personali dal
// self-service, checklist di onboarding/offboarding configurabili, modello dati del recruiting.
//
// Le richieste di modifica non toccano i dati finché HR non le approva: la proposta resta nella
// richiesta, e all'approvazione passa dalla stessa validazione della scheda. I candidati hanno una
// data oltre la quale, se non assunti, vengono cancellati da soli (consenso privacy).
const ONBOARDING = [
  ['Dati personali completi (codice fiscale, IBAN, residenza)', 'dati', null, 1],
  ['Contratto firmato caricato', 'documento', 'contratto', 1],
  ['Informativa privacy firmata', 'documento', 'privacy', 1],
  ["Documento d'identità (e permesso di soggiorno, se serve)", 'documento', 'documento_identita', 1],
  ['Formazione generale lavoratori', 'formazione', 'generale', 1],
  ['Visita medica preassuntiva (se la mansione la prevede)', 'visita', null, 0],
  ['Consegna dei DPI', 'dpi', null, 0],
  ['Consegna di chiavi, badge e dotazioni', 'bene', null, 0],
  ['Accesso al portale (se serve)', 'accesso', null, 0],
];
const OFFBOARDING = [
  ['Restituzione di chiavi, badge e dotazioni', 'restituzione', null, 1],
  ['Cessazione registrata nel contratto', 'cessazione', null, 1],
  ['Saldi di ferie e permessi comunicati al consulente', 'saldi', null, 1],
  ['Presenze dell\'ultimo mese approvate', 'presenze', null, 1],
  ['Disattivazione dell\'accesso al portale', 'accesso', null, 0],
];

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE employee_assets (
        id           INTEGER PRIMARY KEY,
        employee_id  INTEGER NOT NULL REFERENCES employees(id),
        kind         TEXT NOT NULL CHECK (kind IN ('chiavi', 'badge', 'telefono', 'pc', 'tablet', 'auto', 'abbigliamento', 'altro')),
        description  TEXT NOT NULL,
        serial       TEXT,
        delivered_on TEXT NOT NULL,
        returned_on  TEXT,
        notes        TEXT,
        created_at   TEXT NOT NULL,
        created_by   TEXT,
        CHECK (returned_on IS NULL OR returned_on >= delivered_on)
      );
      CREATE INDEX idx_assets_employee ON employee_assets (employee_id);
      CREATE TABLE personal_change_requests (
        id                INTEGER PRIMARY KEY,
        employee_id       INTEGER NOT NULL REFERENCES employees(id),
        changes           TEXT NOT NULL,           -- JSON: campi proposti (e contatti di emergenza)
        status            TEXT NOT NULL DEFAULT 'richiesta' CHECK (status IN ('richiesta', 'approvata', 'rifiutata', 'ritirata')),
        note              TEXT,
        requested_at      TEXT NOT NULL,
        requested_user_id INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
        decided_at        TEXT,
        decided_by        TEXT,
        decision_note     TEXT
      );
      CREATE TABLE checklist_templates (
        id             INTEGER PRIMARY KEY,
        kind           TEXT NOT NULL CHECK (kind IN ('onboarding', 'offboarding')),
        name           TEXT NOT NULL,
        contract_types TEXT,                       -- JSON: tipi di contratto a cui si applica; vuoto = tutti
        active         INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE checklist_template_items (
        id          INTEGER PRIMARY KEY,
        template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        item_type   TEXT NOT NULL,
        ref         TEXT,
        required    INTEGER NOT NULL DEFAULT 1,
        sort_order  INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE employee_checklists (
        id           INTEGER PRIMARY KEY,
        employee_id  INTEGER NOT NULL REFERENCES employees(id),
        template_id  INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL,
        kind         TEXT NOT NULL CHECK (kind IN ('onboarding', 'offboarding')),
        name         TEXT NOT NULL,
        due_date     TEXT,
        started_at   TEXT NOT NULL,
        started_by   TEXT,
        completed_at TEXT,
        completed_by TEXT
      );
      CREATE UNIQUE INDEX idx_checklists_open ON employee_checklists (employee_id, kind) WHERE completed_at IS NULL;
      CREATE TABLE employee_checklist_items (
        id           INTEGER PRIMARY KEY,
        checklist_id INTEGER NOT NULL REFERENCES employee_checklists(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        item_type    TEXT NOT NULL,
        ref          TEXT,
        required     INTEGER NOT NULL DEFAULT 1,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        done_at      TEXT,
        done_by      TEXT,
        note         TEXT
      );
      -- Recruiting (solo modello dati): posizioni aperte e candidati.
      CREATE TABLE job_positions (
        id          INTEGER PRIMARY KEY,
        title       TEXT NOT NULL,
        job_role_id INTEGER REFERENCES job_roles(id) ON DELETE SET NULL,
        site_id     INTEGER REFERENCES sites(id) ON DELETE SET NULL,
        status      TEXT NOT NULL DEFAULT 'aperta' CHECK (status IN ('aperta', 'chiusa')),
        opened_on   TEXT NOT NULL,
        closed_on   TEXT,
        notes       TEXT
      );
      CREATE TABLE candidates (
        id                 INTEGER PRIMARY KEY,
        position_id        INTEGER REFERENCES job_positions(id) ON DELETE SET NULL,
        first_name         TEXT NOT NULL,
        last_name          TEXT NOT NULL,
        email              TEXT,
        phone              TEXT,
        fiscal_code        TEXT,
        source             TEXT,
        status             TEXT NOT NULL DEFAULT 'nuovo' CHECK (status IN ('nuovo', 'in_valutazione', 'colloquio', 'offerta', 'assunto', 'scartato', 'ritirato')),
        privacy_consent_at TEXT NOT NULL,
        delete_after       TEXT NOT NULL,
        employee_id        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        notes              TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      -- Il CV del candidato è un documento HR cifrato (senza dipendente); con l'assunzione passa al fascicolo.
      CREATE TABLE candidate_documents (
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        document_id  INTEGER NOT NULL REFERENCES hr_documents(id) ON DELETE CASCADE,
        PRIMARY KEY (candidate_id, document_id)
      );
    `);
    const tpl = db.prepare('INSERT INTO checklist_templates (kind, name, contract_types) VALUES (?, ?, NULL)');
    const item = db.prepare('INSERT INTO checklist_template_items (template_id, title, item_type, ref, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    const on = Number(tpl.run('onboarding', 'Ingresso in azienda').lastInsertRowid);
    ONBOARDING.forEach(([t, type, ref, req], i) => item.run(on, t, type, ref, req, i + 1));
    const off = Number(tpl.run('offboarding', 'Uscita dall\'azienda').lastInsertRowid);
    OFFBOARDING.forEach(([t, type, ref, req], i) => item.run(off, t, type, ref, req, i + 1));
  },
  down(db) {
    db.exec(`
      DROP TABLE candidate_documents; DROP TABLE candidates; DROP TABLE job_positions;
      DROP TABLE employee_checklist_items; DROP TABLE employee_checklists; DROP TABLE checklist_template_items; DROP TABLE checklist_templates;
      DROP TABLE personal_change_requests; DROP TABLE employee_assets;
    `);
  },
};
