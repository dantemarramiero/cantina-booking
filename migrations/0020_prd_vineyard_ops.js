// Produzione, Fase 2 — vigneto: interventi (su una o più parcelle, con esecutori e mezzi), trattamenti
// fitosanitari (anche con più prodotti in miscela), concimazioni, analisi con i risultati, previsioni di
// vendemmia modificabili a mano.
//
// Un intervento nasce bozza (anche da offline: client_uuid), si conferma con tutti i controlli e non si
// modifica più: si storna e si ricrea (PRD-V11). Carenza e rientro si calcolano alla conferma su ogni
// trattamento; lo stato della parcella è il massimo tra i trattamenti confermati non stornati.
//
// Collegamenti con gli altri moduli con tabelle di collegamento, senza colonne nuove nelle loro tabelle:
//   - parcel_cost_objects: l'oggetto di costo (Finance) di una parcella per annata agraria;
//   - timesheet_intervention_links: la riga di presenze (People) nata dalla proposta di un intervento.
// Unica tabella esistente toccata: timesheet_proposal_decisions (People), ricostruita per ammettere
// l'origine «intervento» tra le proposte decise.
// L'operazione «Trattamento fitosanitario» è un oggetto di costo di tipo operazione che richiede il
// patentino (corso «fitosanitari» di People): lo usano i controlli sull'esecutore (PRD-V02, PRD-V10).
const AUDIT = `created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT`;
const TYPES = ['potatura_secca', 'legatura', 'lavorazione_suolo', 'sfalcio', 'concimazione', 'trattamento', 'potatura_verde', 'sfogliatura',
  'diradamento', 'irrigazione', 'monitoraggio', 'campionamento', 'vendemmia', 'altro'];
const CONFIG = [
  ['phyto_applications_period', 'Periodo in cui si contano le applicazioni massime di un fitofarmaco', 'text', 'anno_solare', 'anno_solare | annata_agraria | campagna', 'PRD-V04', 'VIG-11',
    'Proposta approvata il 25/09/2026 (DP13), da confermare con l\'agronomo'],
  ['harvest_year_start', "Da quando un intervento conta per l'annata successiva", 'text', '11-01', 'mese-giorno', 'DP13', 'VIG-11',
    "Es. dall'1/11 i lavori servono la vendemmia dell'anno dopo; si può correggere su ogni intervento"],
  ['harvest_targets', 'Valori obiettivo di vendemmia per destinazione', 'json', null, 'per destinazione: parametro → min / max', 'PRD-V (previsione)', 'VIG-13', "Da definire con l'enologo"],
];

// Le decisioni sulle righe proposte (People) ammettevano solo prenotazioni e fiere: si aggiunge «intervento».
// In SQLite il CHECK non si modifica: la tabella si ricostruisce (vedi disableForeignKeys nel runner).
function rebuildDecisions(db, sources) {
  db.exec(`
    CREATE TABLE timesheet_proposal_decisions_new (
      id          INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      source      TEXT NOT NULL CHECK (source IN (${sources.map(s => `'${s}'`).join(', ')})),
      source_id   INTEGER NOT NULL,
      work_date   TEXT NOT NULL,
      decision    TEXT NOT NULL CHECK (decision IN ('accettata', 'scartata')),
      entry_id    INTEGER REFERENCES timesheet_entries(id) ON DELETE SET NULL,
      decided_at  TEXT NOT NULL,
      decided_by  TEXT,
      UNIQUE (employee_id, source, source_id, work_date)
    );
    INSERT INTO timesheet_proposal_decisions_new SELECT id, employee_id, source, source_id, work_date, decision, entry_id, decided_at, decided_by FROM timesheet_proposal_decisions;
    DROP TABLE timesheet_proposal_decisions;
    ALTER TABLE timesheet_proposal_decisions_new RENAME TO timesheet_proposal_decisions;
  `);
}

module.exports = {
  TYPES,
  disableForeignKeys: true,
  rebuilds: ['timesheet_proposal_decisions'],
  up(db) {
    rebuildDecisions(db, ['prenotazione', 'fiera', 'intervento']);
    db.exec(`
      CREATE TABLE parcel_interventions (
        id                      INTEGER PRIMARY KEY,
        type                    TEXT NOT NULL CHECK (type IN (${TYPES.map(x => `'${x}'`).join(', ')})),
        status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'reversed')),
        started_at              TEXT NOT NULL,  -- UTC
        ended_at                TEXT,           -- UTC
        work_date               TEXT NOT NULL,  -- data italiana dell'inizio
        harvest_year            INTEGER NOT NULL,
        campaign_id             INTEGER REFERENCES wine_campaigns(id),
        bbch_stage              TEXT,
        notes                   TEXT,
        confirmed_at            TEXT,
        confirmed_by            TEXT,
        registered_late         INTEGER NOT NULL DEFAULT 0,  -- PRD-V08
        late_days               INTEGER,
        equipment_noncompliant  INTEGER NOT NULL DEFAULT 0,  -- PRD-V09
        reentry_override_reason TEXT,                        -- PRD-V07
        reversed_at             TEXT,
        reversed_by             TEXT,
        reversal_reason         TEXT,
        replaced_by_id          INTEGER REFERENCES parcel_interventions(id),
        repeated_from_id        INTEGER REFERENCES parcel_interventions(id),
        client_uuid             TEXT UNIQUE,
        ${AUDIT},
        CHECK (ended_at IS NULL OR ended_at >= started_at),
        CHECK (status <> 'reversed' OR (reversed_at IS NOT NULL AND reversal_reason IS NOT NULL))
      );
      CREATE INDEX idx_interventions_date ON parcel_interventions (work_date, status);
      CREATE TABLE parcel_intervention_parcels (
        intervention_id INTEGER NOT NULL REFERENCES parcel_interventions(id) ON DELETE CASCADE,
        parcel_id       INTEGER NOT NULL REFERENCES vineyard_parcels(id),
        area_m2         INTEGER NOT NULL CHECK (area_m2 > 0),
        PRIMARY KEY (intervention_id, parcel_id)
      );
      CREATE INDEX idx_intervention_parcels ON parcel_intervention_parcels (parcel_id);
      CREATE TABLE parcel_intervention_workers (
        intervention_id INTEGER NOT NULL REFERENCES parcel_interventions(id) ON DELETE CASCADE,
        employee_id     INTEGER NOT NULL REFERENCES employees(id),
        minutes         INTEGER CHECK (minutes IS NULL OR minutes > 0), -- stima; le ore vere stanno nelle presenze
        PRIMARY KEY (intervention_id, employee_id)
      );
      CREATE TABLE parcel_intervention_equipment (
        intervention_id INTEGER NOT NULL REFERENCES parcel_interventions(id) ON DELETE CASCADE,
        equipment_id    INTEGER NOT NULL REFERENCES equipment(id),
        PRIMARY KEY (intervention_id, equipment_id)
      );
      CREATE TABLE phyto_treatment_details (
        intervention_id       INTEGER PRIMARY KEY REFERENCES parcel_interventions(id) ON DELETE CASCADE,
        target_pest           TEXT,
        water_volume_l_per_ha INTEGER,
        weather_notes         TEXT,
        preharvest_ends_on    TEXT,  -- calcolata alla conferma (PRD-V06), data italiana
        reentry_ends_at       TEXT   -- calcolata alla conferma (PRD-V06), UTC
      );
      CREATE TABLE phyto_treatment_products (
        intervention_id   INTEGER NOT NULL REFERENCES parcel_interventions(id) ON DELETE CASCADE,
        phyto_product_id  INTEGER NOT NULL REFERENCES phyto_products(id),
        dose_per_ha_e4    INTEGER,
        total_quantity_e4 INTEGER,
        dose_unit         TEXT,
        PRIMARY KEY (intervention_id, phyto_product_id)
      );
      CREATE TABLE fertilization_details (
        intervention_id   INTEGER PRIMARY KEY REFERENCES parcel_interventions(id) ON DELETE CASCADE,
        product           TEXT,
        npk               TEXT,
        dose_per_ha_e4    INTEGER,
        total_quantity_e4 INTEGER,
        unit              TEXT
      );

      CREATE TABLE analyses (
        id            INTEGER PRIMARY KEY,
        subject_type  TEXT NOT NULL CHECK (subject_type IN ('parcel', 'lot', 'vessel', 'stack', 'bottling_lot')),
        subject_id    INTEGER NOT NULL,
        sampled_at    TEXT NOT NULL,  -- UTC
        sample_date   TEXT NOT NULL,  -- data italiana
        harvest_year  INTEGER,
        source        TEXT NOT NULL DEFAULT 'internal_lab' CHECK (source IN ('internal_lab', 'external_lab', 'instrument', 'estimate')),
        supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        report_number TEXT,
        import_batch  TEXT,
        notes         TEXT,
        ${AUDIT}, archived_at TEXT, archived_by TEXT
      );
      CREATE INDEX idx_analyses_subject ON analyses (subject_type, subject_id, sample_date);
      CREATE TABLE analysis_results (
        id           INTEGER PRIMARY KEY,
        analysis_id  INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        parameter_id INTEGER NOT NULL REFERENCES analysis_parameters(id),
        value_e4     INTEGER NOT NULL,
        qualifier    TEXT NOT NULL DEFAULT '=' CHECK (qualifier IN ('<', '=', '>')),
        UNIQUE (analysis_id, parameter_id)
      );
      -- Previsione della vendemmia per parcella, annata e destinazione: la data calcolata si sostituisce a mano.
      CREATE TABLE harvest_forecasts (
        parcel_id    INTEGER NOT NULL REFERENCES vineyard_parcels(id),
        harvest_year INTEGER NOT NULL,
        destination  TEXT NOT NULL CHECK (destination IN ('base_spumante', 'bianco', 'rosato', 'rosso')),
        manual_date  TEXT,
        note         TEXT,
        ${AUDIT},
        PRIMARY KEY (parcel_id, harvest_year, destination)
      );

      CREATE TABLE parcel_cost_objects (
        cost_object_id INTEGER PRIMARY KEY REFERENCES cost_objects(id) ON DELETE CASCADE,
        parcel_id      INTEGER NOT NULL REFERENCES vineyard_parcels(id),
        harvest_year   INTEGER NOT NULL,
        UNIQUE (parcel_id, harvest_year)
      );
      CREATE TABLE timesheet_intervention_links (
        entry_id        INTEGER PRIMARY KEY REFERENCES timesheet_entries(id) ON DELETE CASCADE,
        intervention_id INTEGER NOT NULL REFERENCES parcel_interventions(id),
        work_date       TEXT NOT NULL
      );
      CREATE INDEX idx_ts_intervention ON timesheet_intervention_links (intervention_id);
    `);
    const now = new Date().toISOString();
    const cfg = db.prepare(`INSERT INTO prd_config (key, name, kind, value, default_value, unit, rule_ids, question_id, source_note, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Migrazione', ?, 'Migrazione')`);
    for (const [key, name, kind, value, unit, rules, q, src] of CONFIG) cfg.run(key, name, kind, value, value, unit, rules, q, src, now, now);
    // Operazione «Trattamento fitosanitario»: richiede il patentino (People → corso «fitosanitari»).
    let op = db.prepare("SELECT id FROM cost_objects WHERE code = 'OP-TRATT-FITO'").get();
    if (!op) {
      op = { id: Number(db.prepare("INSERT INTO cost_objects (type, code, name, status, notes, created_at, updated_at) VALUES ('operazione', 'OP-TRATT-FITO', 'Trattamento fitosanitario', 'aperto', ?, ?, ?)")
        .run('Creato dalla Produzione: richiede il patentino fitosanitario valido', now, now).lastInsertRowid) };
    }
    const training = db.prepare("SELECT id FROM training_types WHERE code = 'fitosanitari'").get();
    if (training) db.prepare('INSERT OR IGNORE INTO operation_trainings (cost_object_id, training_type_id) VALUES (?, ?)').run(op.id, training.id);
  },
  down(db) {
    db.exec(`
      DROP TABLE timesheet_intervention_links; DROP TABLE parcel_cost_objects; DROP TABLE harvest_forecasts;
      DROP TABLE analysis_results; DROP TABLE analyses; DROP TABLE fertilization_details; DROP TABLE phyto_treatment_products;
      DROP TABLE phyto_treatment_details; DROP TABLE parcel_intervention_equipment; DROP TABLE parcel_intervention_workers;
      DROP TABLE parcel_intervention_parcels; DROP TABLE parcel_interventions;
      DELETE FROM prd_config WHERE key IN ('phyto_applications_period', 'harvest_year_start', 'harvest_targets');
      DELETE FROM timesheet_proposal_decisions WHERE source = 'intervento';
    `);
    rebuildDecisions(db, ['prenotazione', 'fiera']);
  },
};
