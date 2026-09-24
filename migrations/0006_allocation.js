// Ribaltamenti a cascata.
// - allocation_drivers: le basi di ripartizione (m², ore lavorate, ore macchina, …).
// - allocation_rules + allocation_rule_targets: da un centro verso uno o più centri (di livello
//   successivo) od oggetti di costo, con percentuali fisse (driver_id NULL, quote in ppm) oppure
//   in proporzione ai valori di un driver. Validità per periodo 'YYYY-MM' (valid_to incluso).
// - driver_values: i valori dei driver per periodo e destinazione, a mano o da altri moduli.
// - allocation_runs + allocation_entries: le esecuzioni confermate, con la fotografia dei dati
//   usati e ogni quota (origine, destinazione, driver, base, percentuale, importo).
const DRIVERS = [
  ['m2', 'Superficie', 'm²', 'manuale'],
  ['ore_lavorate', 'Ore lavorate', 'ore', 'people'],
  ['ore_macchina', 'Ore macchina', 'ore', 'manuale'],
  ['analisi', 'Numero di analisi', 'analisi', 'manuale'],
  ['kg_uva', 'Uva lavorata', 'kg', 'manuale'],
  ['litri', 'Litri lavorati', 'l', 'manuale'],
  ['hl_mese', 'Ettolitri × mese in affinamento', 'hl × mese', 'manuale'],
  ['bottiglie', 'Bottiglie prodotte', 'bottiglie', 'manuale'],
  ['colli', 'Colli spediti', 'colli', 'manuale'],
  ['ordini', 'Ordini spediti', 'ordini', 'manuale'],
  ['fatturato', 'Fatturato', '€', 'manuale'],
];

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE allocation_drivers (
        id     INTEGER PRIMARY KEY,
        code   TEXT NOT NULL UNIQUE,
        name   TEXT NOT NULL,
        unit   TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manuale',
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE allocation_rules (
        id               INTEGER PRIMARY KEY,
        source_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
        driver_id        INTEGER REFERENCES allocation_drivers(id),
        valid_from       TEXT NOT NULL,
        valid_to         TEXT,
        note             TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX idx_allocation_rules_source ON allocation_rules(source_center_id);

      CREATE TABLE allocation_rule_targets (
        id                    INTEGER PRIMARY KEY,
        rule_id               INTEGER NOT NULL REFERENCES allocation_rules(id) ON DELETE CASCADE,
        target_center_id      INTEGER REFERENCES cost_centers(id),
        target_cost_object_id INTEGER REFERENCES cost_objects(id),
        share_ppm             INTEGER,
        CHECK ((target_center_id IS NULL) <> (target_cost_object_id IS NULL))
      );
      CREATE INDEX idx_allocation_rule_targets_rule ON allocation_rule_targets(rule_id);

      CREATE TABLE driver_values (
        id                    INTEGER PRIMARY KEY,
        driver_id             INTEGER NOT NULL REFERENCES allocation_drivers(id),
        period                TEXT NOT NULL,
        target_center_id      INTEGER REFERENCES cost_centers(id),
        target_cost_object_id INTEGER REFERENCES cost_objects(id),
        quantity_milli        INTEGER NOT NULL,
        source                TEXT NOT NULL DEFAULT 'manuale',
        updated_at            TEXT NOT NULL,
        CHECK ((target_center_id IS NULL) <> (target_cost_object_id IS NULL))
      );
      CREATE UNIQUE INDEX idx_driver_values_unique ON driver_values(driver_id, period, COALESCE(target_center_id, 0), COALESCE(target_cost_object_id, 0));

      CREATE TABLE allocation_runs (
        id                    INTEGER PRIMARY KEY,
        period                TEXT NOT NULL,
        status                TEXT NOT NULL CHECK (status IN ('confermata', 'annullata')),
        total_direct_cents    INTEGER NOT NULL,
        total_allocated_cents INTEGER NOT NULL,
        snapshot              TEXT NOT NULL,
        created_at            TEXT NOT NULL,
        created_by            TEXT,
        cancelled_at          TEXT,
        cancelled_by          TEXT
      );
      CREATE UNIQUE INDEX idx_allocation_runs_confirmed ON allocation_runs(period) WHERE status = 'confermata';

      CREATE TABLE allocation_entries (
        id                    INTEGER PRIMARY KEY,
        run_id                INTEGER NOT NULL REFERENCES allocation_runs(id) ON DELETE CASCADE,
        step                  INTEGER NOT NULL,
        source_center_id      INTEGER NOT NULL REFERENCES cost_centers(id),
        target_center_id      INTEGER REFERENCES cost_centers(id),
        target_cost_object_id INTEGER REFERENCES cost_objects(id),
        rule_id               INTEGER REFERENCES allocation_rules(id) ON DELETE SET NULL,
        driver_id             INTEGER REFERENCES allocation_drivers(id),
        base_quantity_milli   INTEGER,
        share_ppm             INTEGER NOT NULL,
        amount_cents          INTEGER NOT NULL
      );
      CREATE INDEX idx_allocation_entries_run ON allocation_entries(run_id);
    `);
    const insert = db.prepare('INSERT INTO allocation_drivers (code, name, unit, source) VALUES (?, ?, ?, ?)');
    for (const d of DRIVERS) insert.run(...d);
  },
  down(db) {
    db.exec(`
      DROP TABLE allocation_entries;
      DROP TABLE allocation_runs;
      DROP TABLE driver_values;
      DROP TABLE allocation_rule_targets;
      DROP TABLE allocation_rules;
      DROP TABLE allocation_drivers;
    `);
  },
};
