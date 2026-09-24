// Presenze (Fase 2, blocco 2D): righe di ore con ripartizione su centri e oggetti di costo, stati del
// mese per dipendente (aperto → inviato → approvato), rettifiche tracciate dopo la chiusura,
// conflitti con le assenze, decisioni sulle righe proposte (prenotazioni, fiere).
//
// Una riga è un blocco di tempo di un giorno (inizio-fine, niente sovrapposizioni) oppure la quota di
// un'assenza valida (origine "assenza", solo minuti). La ripartizione sta in timesheet_allocations:
// ogni riga di lavoro ha almeno una quota, la somma delle quote è la durata della riga.
// Dopo l'approvazione del mese le righe non si toccano più: una rettifica le annulla (voided) e ne
// aggiunge di nuove, e resta registrata con il motivo.
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE timesheet_months (
        id                   INTEGER PRIMARY KEY,
        employee_id          INTEGER NOT NULL REFERENCES employees(id),
        period               TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'aperto' CHECK (status IN ('aperto', 'inviato', 'approvato')),
        approver_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        submitted_at         TEXT,
        submitted_by         TEXT,
        approved_at          TEXT,
        approved_by          TEXT,
        return_note          TEXT,
        UNIQUE (employee_id, period)
      );
      CREATE TABLE timesheet_adjustments (
        id          INTEGER PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        period      TEXT NOT NULL,
        reason      TEXT NOT NULL,
        absence_id  INTEGER REFERENCES absences(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL,
        created_by  TEXT
      );
      CREATE TABLE timesheet_entries (
        id                      INTEGER PRIMARY KEY,
        employee_id             INTEGER NOT NULL REFERENCES employees(id),
        work_date               TEXT NOT NULL,
        start_time              TEXT,
        end_time                TEXT,
        minutes                 INTEGER NOT NULL CHECK (minutes > 0),
        hour_type               TEXT CHECK (hour_type IN ('ordinaria', 'straordinaria', 'notturna', 'festiva')),
        origin                  TEXT NOT NULL CHECK (origin IN ('manuale', 'squadra', 'proposta', 'assenza', 'rettifica')),
        absence_id              INTEGER REFERENCES absences(id),
        team_id                 INTEGER REFERENCES teams(id) ON DELETE SET NULL,
        batch_id                TEXT,
        source_booking_id       INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        source_fair_id          INTEGER REFERENCES fairs(id) ON DELETE SET NULL,
        adjustment_id           INTEGER REFERENCES timesheet_adjustments(id),
        voided_by_adjustment_id INTEGER REFERENCES timesheet_adjustments(id),
        note                    TEXT,
        created_at              TEXT NOT NULL,
        created_by              TEXT,
        updated_at              TEXT NOT NULL,
        CHECK ((origin = 'assenza') = (absence_id IS NOT NULL)),
        CHECK (origin = 'assenza' OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time AND hour_type IS NOT NULL)),
        CHECK (origin <> 'rettifica' OR adjustment_id IS NOT NULL)
      );
      CREATE INDEX idx_ts_employee_date ON timesheet_entries (employee_id, work_date);
      CREATE INDEX idx_ts_absence ON timesheet_entries (absence_id) WHERE absence_id IS NOT NULL;
      CREATE TABLE timesheet_allocations (
        id             INTEGER PRIMARY KEY,
        entry_id       INTEGER NOT NULL REFERENCES timesheet_entries(id) ON DELETE CASCADE,
        cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
        cost_object_id INTEGER REFERENCES cost_objects(id),
        minutes        INTEGER NOT NULL CHECK (minutes > 0)
      );
      CREATE INDEX idx_ts_alloc_entry ON timesheet_allocations (entry_id);
      CREATE INDEX idx_ts_alloc_center ON timesheet_allocations (cost_center_id);
      -- Righe di assenza generate su un giorno che aveva già ore registrate: le ore restano, si segnala.
      CREATE TABLE timesheet_conflicts (
        id          INTEGER PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        work_date   TEXT NOT NULL,
        absence_id  INTEGER REFERENCES absences(id) ON DELETE CASCADE,
        entry_id    INTEGER REFERENCES timesheet_entries(id) ON DELETE CASCADE,
        message     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );
      -- Righe proposte (mai inserite da sole): chi le accetta o le scarta, una volta per giorno.
      CREATE TABLE timesheet_proposal_decisions (
        id          INTEGER PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        source      TEXT NOT NULL CHECK (source IN ('prenotazione', 'fiera')),
        source_id   INTEGER NOT NULL,
        work_date   TEXT NOT NULL,
        decision    TEXT NOT NULL CHECK (decision IN ('accettata', 'scartata')),
        entry_id    INTEGER REFERENCES timesheet_entries(id) ON DELETE SET NULL,
        decided_at  TEXT NOT NULL,
        decided_by  TEXT,
        UNIQUE (employee_id, source, source_id, work_date)
      );
    `);
  },
  down(db) {
    db.exec(`
      DROP TABLE timesheet_proposal_decisions; DROP TABLE timesheet_conflicts; DROP TABLE timesheet_allocations;
      DROP TABLE timesheet_entries; DROP TABLE timesheet_adjustments; DROP TABLE timesheet_months;
    `);
  },
};
