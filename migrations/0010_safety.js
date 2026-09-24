// Sicurezza sul lavoro (D.Lgs. 81/08), Fase 2 blocco 2B.
//   - tipi di formazione e abilitazione con periodicità configurabile (nessuna durata cablata nel codice);
//   - requisiti: mansione → formazioni obbligatorie; operazione (oggetto di costo) → abilitazioni necessarie;
//   - registro formazione; sorveglianza sanitaria (solo giudizio e limitazioni, mai diagnosi);
//   - DPI consegnati; infortuni e quasi-infortuni; deroghe motivate; attività HR (es. visita da fare).
//
// Le periodicità di partenza seguono gli accordi Stato-Regioni più diffusi ma vanno verificate con
// l'RSPP: sono dati, modificabili da People → Configurazione.
// [codice, nome, categoria, ore iniziali, validità in mesi (null = non scade), ore di aggiornamento, riferimento]
const TRAINING_TYPES = [
  ['generale', 'Formazione generale lavoratori', 'sicurezza', 4, null, null, 'art. 37 D.Lgs. 81/08'],
  ['specifica_basso', 'Formazione specifica — rischio basso', 'sicurezza', 4, 60, 6, 'art. 37 D.Lgs. 81/08'],
  ['specifica_medio', 'Formazione specifica — rischio medio', 'sicurezza', 8, 60, 6, 'art. 37 D.Lgs. 81/08'],
  ['specifica_alto', 'Formazione specifica — rischio alto', 'sicurezza', 12, 60, 6, 'art. 37 D.Lgs. 81/08'],
  ['preposto', 'Preposto', 'sicurezza', 12, 24, 6, 'art. 37 c.7 D.Lgs. 81/08'],
  ['dirigente', 'Dirigente per la sicurezza', 'sicurezza', 12, 60, 6, 'art. 37 c.7 D.Lgs. 81/08'],
  ['rls', 'Rappresentante dei lavoratori (RLS)', 'sicurezza', 32, 12, 4, 'art. 37 c.10-11 D.Lgs. 81/08'],
  ['primo_soccorso', 'Addetto primo soccorso', 'sicurezza', 12, 36, 4, 'D.M. 388/2003'],
  ['antincendio', 'Addetto antincendio', 'sicurezza', 8, 60, 5, 'D.M. 2/9/2021'],
  ['trattori', 'Abilitazione trattori agricoli', 'abilitazione', 8, 60, 4, 'Accordo Stato-Regioni 22/2/2012'],
  ['carrello', 'Abilitazione carrello elevatore', 'abilitazione', 12, 60, 4, 'Accordo Stato-Regioni 22/2/2012'],
  ['spazi_confinati', 'Lavori in spazi confinati (vasche, serbatoi, CO2)', 'abilitazione', 8, 60, 4, 'DPR 177/2011'],
  ['fitosanitari', 'Certificato di abilitazione all\'uso dei prodotti fitosanitari', 'abilitazione', 20, 60, 12, 'D.Lgs. 150/2012'],
  ['haccp', 'Alimentarista / HACCP', 'alimentare', 4, 36, 4, 'Reg. CE 852/2004 e norme regionali'],
  ['ple', 'Piattaforme di lavoro elevabili (PLE)', 'abilitazione', 10, 60, 4, 'Accordo Stato-Regioni 22/2/2012'],
  ['lavori_quota', 'Lavori in quota e DPI anticaduta', 'sicurezza', 8, 60, 4, 'art. 77 D.Lgs. 81/08'],
];
// Formazioni obbligatorie di partenza per mansione (modificabili).
const ROLE_REQUIREMENTS = {
  cantiniere: ['generale', 'specifica_alto', 'spazi_confinati', 'haccp', 'carrello'],
  addetto_imbottigliamento: ['generale', 'specifica_alto', 'haccp'],
  magazziniere: ['generale', 'specifica_medio', 'carrello'],
  operaio_agricolo: ['generale', 'specifica_alto'],
  trattorista: ['generale', 'specifica_alto', 'trattori'],
  enologo: ['generale', 'specifica_alto', 'spazi_confinati', 'haccp'],
  addetto_accoglienza: ['generale', 'specifica_basso', 'haccp'],
  sommelier: ['generale', 'specifica_basso', 'haccp'],
  amministrativo: ['generale', 'specifica_basso'],
  commerciale: ['generale', 'specifica_basso'],
  direttore: ['generale', 'dirigente'],
};
// Mansioni soggette a sorveglianza sanitaria di partenza (dipende dal documento di valutazione dei rischi).
const MEDICAL_ROLES = ['cantiniere', 'addetto_imbottigliamento', 'magazziniere', 'operaio_agricolo', 'trattorista', 'enologo'];
// [codice, nome, sostituzione in mesi (null = a usura), ha la taglia]
const PPE_TYPES = [
  ['scarpe', 'Scarpe antinfortunistiche', 12, 1],
  ['stivali', 'Stivali di sicurezza', 12, 1],
  ['guanti', 'Guanti di protezione', 3, 1],
  ['guanti_chimici', 'Guanti per prodotti chimici', 3, 1],
  ['occhiali', 'Occhiali di protezione', 24, 0],
  ['otoprotettori', 'Otoprotettori', 12, 0],
  ['maschera_fitosanitari', 'Maschera con filtri per fitosanitari', 12, 0],
  ['tuta_fitosanitari', 'Tuta per trattamenti fitosanitari', 6, 1],
  ['giacca_alta_visibilita', 'Giacca ad alta visibilità', 24, 1],
  ['rilevatore_co2', 'Rilevatore personale di CO2', 24, 0],
  ['imbracatura', 'Imbracatura anticaduta', 60, 1],
  ['casco', 'Elmetto di protezione', 60, 0],
];

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE training_types (
        id                INTEGER PRIMARY KEY,
        code              TEXT NOT NULL UNIQUE,
        name              TEXT NOT NULL,
        category          TEXT NOT NULL CHECK (category IN ('sicurezza', 'abilitazione', 'alimentare')),
        initial_minutes   INTEGER,
        validity_months   INTEGER CHECK (validity_months IS NULL OR validity_months > 0),
        update_minutes    INTEGER,
        legal_ref         TEXT,
        active            INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE job_role_trainings (
        job_role_id      INTEGER NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE,
        training_type_id INTEGER NOT NULL REFERENCES training_types(id) ON DELETE CASCADE,
        PRIMARY KEY (job_role_id, training_type_id)
      );
      -- Abilitazioni necessarie per un'operazione (oggetto di costo di tipo "operazione"):
      -- chi non le ha valide non può essere assegnato né registrare ore su quell'operazione.
      CREATE TABLE operation_trainings (
        cost_object_id   INTEGER NOT NULL REFERENCES cost_objects(id) ON DELETE CASCADE,
        training_type_id INTEGER NOT NULL REFERENCES training_types(id) ON DELETE CASCADE,
        PRIMARY KEY (cost_object_id, training_type_id)
      );
      CREATE TABLE trainings (
        id               INTEGER PRIMARY KEY,
        employee_id      INTEGER NOT NULL REFERENCES employees(id),
        training_type_id INTEGER NOT NULL REFERENCES training_types(id),
        completed_on     TEXT NOT NULL,
        minutes          INTEGER,
        provider         TEXT,
        expires_on       TEXT,
        document_id      INTEGER REFERENCES hr_documents(id) ON DELETE SET NULL,
        notes            TEXT,
        created_at       TEXT NOT NULL,
        created_by       TEXT
      );
      CREATE INDEX idx_trainings_employee ON trainings (employee_id, training_type_id, completed_on);
      -- Sorveglianza sanitaria: solo giudizio e limitazioni del medico competente, nessuna diagnosi.
      CREATE TABLE medical_visits (
        id            INTEGER PRIMARY KEY,
        employee_id   INTEGER NOT NULL REFERENCES employees(id),
        visit_date    TEXT NOT NULL,
        visit_type    TEXT NOT NULL CHECK (visit_type IN ('preassuntiva', 'preventiva', 'periodica', 'cambio_mansione', 'rientro', 'su_richiesta')),
        doctor        TEXT,
        judgment      TEXT NOT NULL CHECK (judgment IN ('idoneo', 'idoneo_prescrizioni', 'non_idoneo_temporaneo', 'non_idoneo')),
        limitations   TEXT,
        unfit_until   TEXT,
        next_visit_on TEXT,
        document_id   INTEGER REFERENCES hr_documents(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL,
        created_by    TEXT
      );
      CREATE INDEX idx_medical_visits_employee ON medical_visits (employee_id, visit_date);
      -- Mansioni e operazioni incompatibili con le limitazioni di un giudizio.
      CREATE TABLE medical_restrictions (
        id             INTEGER PRIMARY KEY,
        visit_id       INTEGER NOT NULL REFERENCES medical_visits(id) ON DELETE CASCADE,
        job_role_id    INTEGER REFERENCES job_roles(id) ON DELETE CASCADE,
        cost_object_id INTEGER REFERENCES cost_objects(id) ON DELETE CASCADE,
        CHECK ((job_role_id IS NULL) <> (cost_object_id IS NULL))
      );
      CREATE TABLE ppe_types (
        id                 INTEGER PRIMARY KEY,
        code               TEXT NOT NULL UNIQUE,
        name               TEXT NOT NULL,
        replacement_months INTEGER CHECK (replacement_months IS NULL OR replacement_months > 0),
        sized              INTEGER NOT NULL DEFAULT 0,
        active             INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE ppe_deliveries (
        id           INTEGER PRIMARY KEY,
        employee_id  INTEGER NOT NULL REFERENCES employees(id),
        ppe_type_id  INTEGER NOT NULL REFERENCES ppe_types(id),
        delivered_on TEXT NOT NULL,
        size         TEXT,
        quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
        replace_by   TEXT,
        returned_on  TEXT,
        document_id  INTEGER REFERENCES hr_documents(id) ON DELETE SET NULL,
        notes        TEXT,
        created_at   TEXT NOT NULL,
        created_by   TEXT
      );
      CREATE INDEX idx_ppe_employee ON ppe_deliveries (employee_id, ppe_type_id, delivered_on);
      -- Infortuni (con dipendente) e quasi-infortuni (per l'analisi dei rischi, anche senza persona).
      CREATE TABLE incidents (
        id             INTEGER PRIMARY KEY,
        kind           TEXT NOT NULL CHECK (kind IN ('infortunio', 'quasi_infortunio')),
        employee_id    INTEGER REFERENCES employees(id),
        site_id        INTEGER REFERENCES sites(id) ON DELETE SET NULL,
        cost_object_id INTEGER REFERENCES cost_objects(id) ON DELETE SET NULL,
        occurred_on    TEXT NOT NULL,
        occurred_time  TEXT,
        place          TEXT,
        dynamics       TEXT NOT NULL,
        prognosis_days INTEGER CHECK (prognosis_days IS NULL OR prognosis_days >= 0),
        inail_number   TEXT,
        inail_date     TEXT,
        measures       TEXT,
        created_at     TEXT NOT NULL,
        created_by     TEXT,
        CHECK (kind = 'quasi_infortunio' OR employee_id IS NOT NULL)
      );
      -- Deroga motivata del responsabile sicurezza a una formazione/abilitazione mancante,
      -- ammessa solo se la mansione lo consente, con validità limitata.
      CREATE TABLE safety_waivers (
        id               INTEGER PRIMARY KEY,
        employee_id      INTEGER NOT NULL REFERENCES employees(id),
        training_type_id INTEGER NOT NULL REFERENCES training_types(id),
        cost_object_id   INTEGER REFERENCES cost_objects(id) ON DELETE CASCADE,
        reason           TEXT NOT NULL,
        valid_from       TEXT NOT NULL,
        valid_to         TEXT NOT NULL,
        granted_by       TEXT NOT NULL,
        granted_user_id  INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
        created_at       TEXT NOT NULL,
        revoked_at       TEXT,
        revoked_by       TEXT,
        CHECK (valid_to >= valid_from)
      );
      -- Attività HR da svolgere (es. visita per cambio mansione, visita di rientro), nate da eventi.
      CREATE TABLE hr_tasks (
        id              INTEGER PRIMARY KEY,
        employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        kind            TEXT NOT NULL,
        title           TEXT NOT NULL,
        due_date        TEXT NOT NULL,
        source_event_id INTEGER REFERENCES domain_events(id) ON DELETE SET NULL,
        done_at         TEXT,
        done_by         TEXT,
        notes           TEXT,
        created_at      TEXT NOT NULL,
        UNIQUE (source_event_id, kind)
      );
      ALTER TABLE job_roles ADD COLUMN medical_surveillance INTEGER NOT NULL DEFAULT 0;
    `);
    const tt = db.prepare('INSERT INTO training_types (code, name, category, initial_minutes, validity_months, update_minutes, legal_ref) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [code, name, cat, h, months, upd, ref] of TRAINING_TYPES) tt.run(code, name, cat, h * 60, months, upd == null ? null : upd * 60, ref);
    const typeId = code => db.prepare('SELECT id FROM training_types WHERE code = ?').get(code).id;
    const req = db.prepare('INSERT INTO job_role_trainings (job_role_id, training_type_id) VALUES (?, ?)');
    for (const [role, codes] of Object.entries(ROLE_REQUIREMENTS)) {
      const jr = db.prepare('SELECT id FROM job_roles WHERE code = ?').get(role);
      if (jr) for (const c of codes) req.run(jr.id, typeId(c));
    }
    for (const role of MEDICAL_ROLES) db.prepare('UPDATE job_roles SET medical_surveillance = 1 WHERE code = ?').run(role);
    const pt = db.prepare('INSERT INTO ppe_types (code, name, replacement_months, sized) VALUES (?, ?, ?, ?)');
    for (const [code, name, months, sized] of PPE_TYPES) pt.run(code, name, months, sized);
  },
  down(db) {
    db.exec(`
      DROP TABLE hr_tasks; DROP TABLE safety_waivers; DROP TABLE incidents; DROP TABLE ppe_deliveries; DROP TABLE ppe_types;
      DROP TABLE medical_restrictions; DROP TABLE medical_visits; DROP TABLE trainings; DROP TABLE operation_trainings;
      DROP TABLE job_role_trainings; DROP TABLE training_types;
      ALTER TABLE job_roles DROP COLUMN medical_surveillance;
    `);
  },
};
