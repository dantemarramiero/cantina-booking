// Assenze (Fase 2, blocco 2C): tipi configurabili, richieste con approvazione o comunicazione,
// contatori (maturato da spettanze annue, goduto/pianificato dalle assenze), periodi di blocco.
//
// Fonte di verità dei contatori: le assenze stesse. Non c'è un saldo memorizzato da tenere allineato:
// maturato = spettanza dell'anno (mensile o annuale), riporto = residuo dell'anno prima (o saldo
// iniziale indicato alla prima spettanza), goduto e pianificato = somma delle assenze valide.
// Unità: i tipi "giorni" consumano millesimi di giorno (mezza giornata = 500), quelli "ore" minuti.
// [codice, nome, flusso, contatore, unità, retribuita, protocollo, salute, mezza giornata, a ore]
const TYPES = [
  ['ferie', 'Ferie', 'approvazione', 'ferie', 'giorni', 1, 0, 0, 1, 0],
  ['rol', 'ROL (riduzione orario)', 'approvazione', 'rol', 'ore', 1, 0, 0, 1, 1],
  ['ex_festivita', 'Ex festività', 'approvazione', 'ex_festivita', 'ore', 1, 0, 0, 1, 1],
  ['malattia', 'Malattia', 'comunicazione', null, 'giorni', 1, 1, 1, 0, 0],
  ['infortunio', 'Infortunio', 'comunicazione', null, 'giorni', 1, 0, 1, 0, 0],
  ['legge_104', 'Permesso L. 104/92', 'approvazione', null, 'giorni', 1, 0, 0, 1, 1],
  ['congedo_parentale', 'Congedo parentale', 'approvazione', null, 'giorni', 0, 0, 0, 1, 1],
  ['maternita_paternita', 'Maternità / paternità', 'comunicazione', null, 'giorni', 1, 0, 0, 0, 0],
  ['lutto', 'Permesso per lutto', 'comunicazione', null, 'giorni', 1, 0, 0, 0, 0],
  ['matrimonio', 'Congedo matrimoniale', 'approvazione', null, 'giorni', 1, 0, 0, 0, 0],
  ['donazione_sangue', 'Donazione di sangue', 'comunicazione', null, 'giorni', 1, 0, 0, 0, 0],
  ['permesso_sindacale', 'Permesso sindacale', 'approvazione', null, 'ore', 1, 0, 0, 1, 1],
  ['non_retribuito', 'Permesso non retribuito', 'approvazione', null, 'giorni', 0, 0, 0, 1, 1],
];

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE absence_types (
        id                INTEGER PRIMARY KEY,
        code              TEXT NOT NULL UNIQUE,
        name              TEXT NOT NULL,
        -- approvazione: bozza → richiesta → approvata/rifiutata; comunicazione: comunicata → presa visione
        flow              TEXT NOT NULL CHECK (flow IN ('approvazione', 'comunicazione')),
        counter           TEXT CHECK (counter IN ('ferie', 'rol', 'ex_festivita')),
        unit              TEXT NOT NULL CHECK (unit IN ('giorni', 'ore')),
        paid              INTEGER NOT NULL DEFAULT 1,
        requires_protocol INTEGER NOT NULL DEFAULT 0,
        health            INTEGER NOT NULL DEFAULT 0,
        allow_half_day    INTEGER NOT NULL DEFAULT 1,
        allow_hours       INTEGER NOT NULL DEFAULT 0,
        active            INTEGER NOT NULL DEFAULT 1,
        sort_order        INTEGER NOT NULL DEFAULT 0
      );
      -- Periodi in cui le assenze a richiesta sono sconsigliate (avviso al responsabile) o vietate.
      CREATE TABLE absence_block_periods (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date   TEXT NOT NULL,
        site_id    INTEGER REFERENCES sites(id) ON DELETE CASCADE,
        team_id    INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        mode       TEXT NOT NULL DEFAULT 'avviso' CHECK (mode IN ('avviso', 'blocco')),
        note       TEXT,
        created_at TEXT NOT NULL,
        CHECK (end_date >= start_date)
      );
      CREATE TABLE absences (
        id                   INTEGER PRIMARY KEY,
        employee_id          INTEGER NOT NULL REFERENCES employees(id),
        absence_type_id      INTEGER NOT NULL REFERENCES absence_types(id),
        start_date           TEXT NOT NULL,
        end_date             TEXT NOT NULL,
        part                 TEXT NOT NULL DEFAULT 'giorno' CHECK (part IN ('giorno', 'mattina', 'pomeriggio', 'ore')),
        start_time           TEXT,
        end_time             TEXT,
        amount               INTEGER NOT NULL DEFAULT 0,  -- consumo: millesimi di giorno o minuti, secondo l'unità del tipo
        work_minutes         INTEGER NOT NULL DEFAULT 0,  -- minuti di orario contrattuale coperti
        status               TEXT NOT NULL CHECK (status IN ('bozza', 'richiesta', 'approvata', 'rifiutata', 'annullata', 'comunicata', 'presa_visione')),
        protocol             TEXT,
        note                 TEXT,
        approver_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        delegate_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        escalated_at         TEXT,
        block_period_id      INTEGER REFERENCES absence_block_periods(id) ON DELETE SET NULL,
        incident_id          INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
        inail_number         TEXT,
        requested_by         TEXT,
        requested_user_id    INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
        submitted_at         TEXT,
        decided_by           TEXT,
        decided_at           TEXT,
        decision_note        TEXT,
        cancelled_by         TEXT,
        cancelled_at         TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        CHECK (end_date >= start_date),
        CHECK (part = 'giorno' OR start_date = end_date),
        CHECK (part <> 'ore' OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
      );
      CREATE INDEX idx_absences_employee ON absences (employee_id, start_date);
      CREATE INDEX idx_absences_status ON absences (status, start_date);
      CREATE UNIQUE INDEX idx_absences_incident ON absences (incident_id) WHERE incident_id IS NOT NULL;
      -- Spettanza annua per contatore (es. 26 giorni di ferie, 72 ore di ROL) e saldo iniziale.
      CREATE TABLE absence_allowances (
        id              INTEGER PRIMARY KEY,
        employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        counter         TEXT NOT NULL CHECK (counter IN ('ferie', 'rol', 'ex_festivita')),
        year            INTEGER NOT NULL,
        annual_amount   INTEGER NOT NULL CHECK (annual_amount >= 0),
        accrual         TEXT NOT NULL DEFAULT 'mensile' CHECK (accrual IN ('mensile', 'annuale')),
        opening_balance INTEGER,  -- vuoto = riporto calcolato dall'anno precedente
        note            TEXT,
        UNIQUE (employee_id, counter, year)
      );
      -- Attività nate da job (es. visita di rientro): chiave per non crearle due volte.
      ALTER TABLE hr_tasks ADD COLUMN dedupe_key TEXT;
      CREATE UNIQUE INDEX idx_hr_tasks_dedupe ON hr_tasks (dedupe_key) WHERE dedupe_key IS NOT NULL;
    `);
    const ins = db.prepare(`INSERT INTO absence_types (code, name, flow, counter, unit, paid, requires_protocol, health, allow_half_day, allow_hours, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    TYPES.forEach((t, i) => ins.run(...t, i + 1));
  },
  down(db) {
    db.exec(`
      DROP INDEX idx_hr_tasks_dedupe;
      ALTER TABLE hr_tasks DROP COLUMN dedupe_key;
      DROP TABLE absence_allowances; DROP TABLE absences; DROP TABLE absence_block_periods; DROP TABLE absence_types;
    `);
  },
};
