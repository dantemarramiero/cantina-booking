// Fascicolo del dipendente (Fase 2.0): dati personali, contatti di emergenza, documenti d'identità
// e permessi di soggiorno, mansioni, contratti versionati, retribuzione, competenze e lingue,
// documenti HR cifrati con livello di riservatezza, log degli accessi ai dati sanitari.
//
// Fonte di verità: sede, centro di costo e responsabile *attuali* stanno in employees (scheda
// Organizzazione); ogni versione di contratto ne conserva una copia per lo storico. La mansione
// vive nel contratto. Un contratto non si sovrascrive mai: ogni variazione è una nuova versione.
const JOB_ROLES = [
  ['direttore', 'Direzione', 0], ['amministrativo', 'Impiegato amministrativo', 0], ['commerciale', 'Commerciale', 0],
  ['enologo', 'Enologo', 0], ['cantiniere', 'Cantiniere', 1], ['addetto_imbottigliamento', 'Addetto imbottigliamento', 1],
  ['magazziniere', 'Magazziniere', 1], ['operaio_agricolo', 'Operaio agricolo', 1], ['trattorista', 'Trattorista', 1],
  ['addetto_accoglienza', 'Addetto accoglienza enoturismo', 0], ['sommelier', 'Sommelier', 0],
];
// [codice, nome, livello di riservatezza, anni di conservazione, visibile al dipendente]
const DOC_TYPES = [
  ['contratto', 'Contratto firmato', 'personale', 10, 1],
  ['variazione', 'Lettera di variazione', 'personale', 10, 1],
  ['cedolino', 'Cedolino', 'retributivo', 10, 1],
  ['cu', 'Certificazione Unica', 'retributivo', 10, 1],
  ['privacy', 'Informativa privacy firmata', 'personale', 10, 1],
  ['regolamento', 'Regolamento aziendale', 'base', 10, 1],
  ['attestato', 'Attestato di formazione', 'personale', 10, 1],
  ['cv', 'Curriculum vitae', 'personale', 5, 1],
  ['documento_identita', 'Documento d\'identità', 'personale', 2, 1],
  ['permesso_soggiorno', 'Permesso di soggiorno', 'personale', 2, 1],
  ['idoneita', 'Giudizio di idoneità', 'sanitario', 10, 1],
  ['dpi', 'Verbale consegna DPI', 'personale', 10, 1],
  ['infortunio', 'Documentazione infortunio', 'sanitario', 10, 0],
  ['disciplinare', 'Provvedimento disciplinare', 'disciplinare', 5, 0],
  ['altro', 'Altro', 'personale', 5, 0],
];

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE job_roles (
        id            INTEGER PRIMARY KEY,
        code          TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        description   TEXT,
        allows_waiver INTEGER NOT NULL DEFAULT 0,
        active        INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE employee_personal (
        employee_id           INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
        fiscal_code           TEXT,
        birth_date            TEXT,
        birth_place           TEXT,
        sex                   TEXT CHECK (sex IN ('F', 'M', 'X')),
        citizenship           TEXT,
        residence_address     TEXT,
        residence_postal_code TEXT,
        residence_city        TEXT,
        residence_province    TEXT,
        domicile              TEXT,
        personal_email        TEXT,
        personal_phone        TEXT,
        iban                  TEXT,
        size_shirt            TEXT,
        size_pants            TEXT,
        size_shoes            TEXT,
        updated_at            TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_employee_personal_cf ON employee_personal(fiscal_code) WHERE fiscal_code IS NOT NULL;

      CREATE TABLE emergency_contacts (
        id           INTEGER PRIMARY KEY,
        employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        relationship TEXT,
        phone        TEXT NOT NULL,
        sort_order   INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE identity_documents (
        id          INTEGER PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        doc_type    TEXT NOT NULL CHECK (doc_type IN ('carta_identita', 'passaporto', 'patente', 'permesso_soggiorno')),
        number      TEXT,
        permit_type TEXT,
        issued_on   TEXT,
        expires_on  TEXT,
        notes       TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_identity_documents_employee ON identity_documents(employee_id);

      CREATE TABLE employment_contracts (
        id                 INTEGER PRIMARY KEY,
        employee_id        INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        version            INTEGER NOT NULL,
        effective_from     TEXT NOT NULL,
        contract_type      TEXT NOT NULL CHECK (contract_type IN ('OTD', 'OTI', 'impiegato', 'quadro', 'dirigente', 'apprendista', 'stagionale', 'somministrato', 'collaboratore')),
        ccnl               TEXT,
        level              TEXT,
        qualification      TEXT,
        job_role_id        INTEGER REFERENCES job_roles(id),
        hire_date          TEXT,
        end_date           TEXT,
        probation_end      TEXT,
        part_time_pct      INTEGER CHECK (part_time_pct BETWEEN 1 AND 100),
        site_id            INTEGER REFERENCES sites(id),
        cost_center_id     INTEGER REFERENCES cost_centers(id),
        manager_id         INTEGER REFERENCES employees(id),
        termination_date   TEXT,
        termination_reason TEXT,
        rehire_ok          INTEGER,
        notes              TEXT,
        created_at         TEXT NOT NULL,
        created_by         TEXT,
        UNIQUE (employee_id, version)
      );

      CREATE TABLE compensations (
        id               INTEGER PRIMARY KEY,
        employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        effective_from   TEXT NOT NULL,
        pay_type         TEXT NOT NULL CHECK (pay_type IN ('ral', 'oraria')),
        ral_cents        INTEGER,
        hourly_e4        INTEGER,
        superminimo_cents INTEGER NOT NULL DEFAULT 0,
        allowances_cents INTEGER NOT NULL DEFAULT 0,
        benefits         TEXT,
        notes            TEXT,
        created_at       TEXT NOT NULL,
        created_by       TEXT,
        UNIQUE (employee_id, effective_from)
      );

      CREATE TABLE employee_skills (
        id          INTEGER PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('lingua', 'titolo_studio', 'esperienza', 'qualifica', 'competenza')),
        name        TEXT NOT NULL,
        level       TEXT,
        issued_on   TEXT,
        expires_on  TEXT,
        notes       TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_employee_skills_employee ON employee_skills(employee_id, kind);

      CREATE TABLE hr_document_types (
        code             TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        level            TEXT NOT NULL CHECK (level IN ('base', 'personale', 'retributivo', 'sanitario', 'disciplinare')),
        retention_years  INTEGER NOT NULL,
        employee_visible INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE hr_documents (
        id            INTEGER PRIMARY KEY,
        employee_id   INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        type_code     TEXT NOT NULL REFERENCES hr_document_types(code),
        title         TEXT NOT NULL,
        storage_key   TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL,
        mime          TEXT,
        size_bytes    INTEGER NOT NULL,
        sha256        TEXT NOT NULL,
        version       INTEGER NOT NULL DEFAULT 1,
        supersedes_id INTEGER REFERENCES hr_documents(id),
        doc_date      TEXT,
        valid_until   TEXT,
        delete_after  TEXT NOT NULL,
        uploaded_at   TEXT NOT NULL,
        uploaded_by   TEXT
      );
      CREATE INDEX idx_hr_documents_employee ON hr_documents(employee_id, type_code);

      CREATE TABLE sensitive_access_log (
        id          INTEGER PRIMARY KEY,
        at          TEXT NOT NULL,
        user_id     INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
        actor       TEXT NOT NULL,
        employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        what        TEXT NOT NULL,
        ip          TEXT
      );
      CREATE INDEX idx_sensitive_access_employee ON sensitive_access_log(employee_id, at);
    `);
    const role = db.prepare('INSERT INTO job_roles (code, name, allows_waiver) VALUES (?, ?, ?)');
    for (const r of JOB_ROLES) role.run(...r);
    const type = db.prepare('INSERT INTO hr_document_types (code, name, level, retention_years, employee_visible) VALUES (?, ?, ?, ?, ?)');
    for (const t of DOC_TYPES) type.run(...t);
  },
  down(db) {
    db.exec(`
      DROP TABLE sensitive_access_log;
      DROP TABLE hr_documents;
      DROP TABLE hr_document_types;
      DROP TABLE employee_skills;
      DROP TABLE compensations;
      DROP TABLE employment_contracts;
      DROP TABLE identity_documents;
      DROP TABLE emergency_contacts;
      DROP TABLE employee_personal;
      DROP TABLE job_roles;
    `);
  },
};
