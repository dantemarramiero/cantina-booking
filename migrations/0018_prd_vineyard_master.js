// Produzione, Fase 1 — anagrafiche di vigneto e di base:
//   vitigni, denominazioni con le regole di disciplinare (con validità), vigneti, particelle catastali,
//   parcelle con i collegamenti alle particelle (superficie vitata, unità vitata dello schedario) e
//   l'idoneità alle denominazioni, attrezzature, fitofarmaci, parametri di analisi.
// Ogni tabella ha created/updated (chi e quando); le anagrafiche si archiviano, non si cancellano.
// Superfici in m², dosi e valori in × 10.000 (interi): niente virgola mobile nei dati.
// Valori di partenza modificabili: vitigni e denominazioni confermati il 25/09/2026, parametri di analisi
// d'uso comune. Le regole di disciplinare non si precaricano: vanno prese dai testi ufficiali.
const AUDIT = `created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT`;
const ARCHIVE = `archived_at TEXT, archived_by TEXT`;

const VARIETIES = [
  ['Montepulciano', 'nera'], ['Trebbiano abruzzese', 'bianca'], ['Trebbiano toscano', 'bianca'],
  ['Pecorino', 'bianca'], ['Passerina', 'bianca'], ['Chardonnay', 'bianca'],
];
const APPELLATIONS = [
  ["Montepulciano d'Abruzzo", 'DOC'], ["Trebbiano d'Abruzzo", 'DOC'], ["Cerasuolo d'Abruzzo", 'DOC'], ['Abruzzo', 'DOC'],
  ['Vino varietale', 'varietale'], ['Vino', 'generico'],
];
// [codice, nome, unità, decimali, soggetti, chiave della soglia]
const PARAMETERS = [
  ['zuccheri_babo', 'Zuccheri (°Babo)', '°Babo', 1, ['parcel', 'lot', 'vessel'], null],
  ['zuccheri_brix', 'Zuccheri (°Brix)', '°Brix', 1, ['parcel', 'lot', 'vessel'], null],
  ['densita', 'Densità', 'g/ml', 4, ['lot', 'vessel'], null],
  ['acidita_totale', 'Acidità totale', 'g/l', 2, ['parcel', 'lot', 'vessel', 'bottling_lot'], null],
  ['ph', 'pH', 'pH', 2, ['parcel', 'lot', 'vessel', 'bottling_lot'], null],
  ['acido_malico', 'Acido malico', 'g/l', 2, ['parcel', 'lot', 'vessel'], null],
  ['acido_tartarico', 'Acido tartarico', 'g/l', 2, ['parcel', 'lot'], null],
  ['peso_acino', 'Peso medio dell\'acino', 'g', 2, ['parcel'], null],
  ['peso_grappolo', 'Peso medio del grappolo', 'g', 0, ['parcel'], null],
  ['apa', 'Azoto prontamente assimilabile (APA)', 'mg/l', 0, ['parcel', 'lot'], null],
  ['antociani_estraibili', 'Antociani estraibili', 'mg/l', 0, ['parcel'], null],
  ['polifenoli_totali', 'Indice dei polifenoli totali', 'indice', 1, ['parcel', 'lot'], null],
  ['stato_sanitario', 'Stato sanitario (botrite, marciume)', '%', 0, ['parcel'], null],
  ['alcol', 'Titolo alcolometrico effettivo', '% vol', 2, ['lot', 'vessel', 'bottling_lot'], null],
  ['zuccheri_residui', 'Zuccheri residui', 'g/l', 1, ['lot', 'vessel', 'stack', 'bottling_lot'], null],
  ['so2_libera', 'SO2 libera', 'mg/l', 0, ['lot', 'vessel', 'stack', 'bottling_lot'], null],
  ['so2_totale', 'SO2 totale', 'mg/l', 0, ['lot', 'vessel', 'stack', 'bottling_lot'], 'so2_total_limits'],
  ['acidita_volatile', 'Acidità volatile', 'g/l', 2, ['lot', 'vessel', 'bottling_lot'], 'volatile_acidity_limits'],
  ['temperatura', 'Temperatura', '°C', 1, ['lot', 'vessel'], null],
  ['pressione', 'Pressione', 'bar', 1, ['stack', 'bottling_lot'], 'sparkling_min_pressure_bar'],
];

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE grape_varieties (
        id        INTEGER PRIMARY KEY,
        name      TEXT NOT NULL,
        color     TEXT NOT NULL CHECK (color IN ('bianca', 'nera', 'rosata')),
        sian_code TEXT,
        notes     TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_grape_varieties_name ON grape_varieties (lower(name));

      CREATE TABLE appellations (
        id                  INTEGER PRIMARY KEY,
        name                TEXT NOT NULL,
        type                TEXT NOT NULL CHECK (type IN ('DOCG', 'DOC', 'IGT', 'varietale', 'generico')),
        sian_code           TEXT,
        requires_state_seal INTEGER NOT NULL DEFAULT 0,
        notes               TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_appellations_name ON appellations (lower(name));

      -- Regole di disciplinare: valgono per le operazioni con data nel periodo di validità; scadute restano per lo storico.
      CREATE TABLE appellation_rules (
        id             INTEGER PRIMARY KEY,
        appellation_id INTEGER NOT NULL REFERENCES appellations(id),
        rule_type      TEXT NOT NULL CHECK (rule_type IN ('max_yield_kg_ha', 'max_wine_yield_pct', 'min_variety_pct', 'max_variety_pct', 'min_alcohol_pct',
                         'min_aging_months', 'min_wood_months', 'min_bottle_months', 'min_lees_months')),
        mention        TEXT,
        variety_id     INTEGER REFERENCES grape_varieties(id),
        value_e4       INTEGER NOT NULL,
        valid_from     TEXT NOT NULL,
        valid_to       TEXT,
        source_note    TEXT,
        ${AUDIT}, ${ARCHIVE},
        CHECK (valid_to IS NULL OR valid_to >= valid_from)
      );
      CREATE INDEX idx_appellation_rules ON appellation_rules (appellation_id, rule_type);

      CREATE TABLE vineyards (
        id                 INTEGER PRIMARY KEY,
        name               TEXT NOT NULL,
        locality           TEXT,
        municipality       TEXT,
        province           TEXT,
        organic_status     TEXT NOT NULL DEFAULT 'none' CHECK (organic_status IN ('none', 'conversion', 'certified')),
        certification_body TEXT,
        public_description TEXT,
        notes              TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_vineyards_name ON vineyards (lower(name)) WHERE archived_at IS NULL;

      CREATE TABLE cadastral_parcels (
        id           INTEGER PRIMARY KEY,
        municipality TEXT NOT NULL,
        sheet        TEXT NOT NULL,
        number       TEXT NOT NULL,
        subparcel    TEXT,
        area_m2      INTEGER NOT NULL CHECK (area_m2 > 0),
        notes        TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_cadastral_parcels ON cadastral_parcels (lower(municipality), sheet, number, COALESCE(subparcel, '')) WHERE archived_at IS NULL;

      CREATE TABLE vineyard_parcels (
        id                 INTEGER PRIMARY KEY,
        vineyard_id        INTEGER NOT NULL REFERENCES vineyards(id),
        code               TEXT NOT NULL,
        name               TEXT,
        variety_id         INTEGER REFERENCES grape_varieties(id),
        clone              TEXT,
        rootstock          TEXT,
        planting_year      INTEGER,
        row_spacing_cm     INTEGER,
        vine_spacing_cm    INTEGER,
        vines_count        INTEGER,
        training_system    TEXT,
        exposure           TEXT,
        altitude_m         INTEGER,
        geometry_geojson   TEXT,
        organic_status     TEXT CHECK (organic_status IS NULL OR organic_status IN ('none', 'conversion', 'certified')), -- vuoto = come il vigneto
        active             INTEGER NOT NULL DEFAULT 1,
        public_description TEXT,
        notes              TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_vineyard_parcels_code ON vineyard_parcels (lower(code));

      -- Una parcella su una o più particelle, con la superficie vitata su ciascuna e l'unità vitata dello schedario.
      CREATE TABLE parcel_cadastral_links (
        id                  INTEGER PRIMARY KEY,
        parcel_id           INTEGER NOT NULL REFERENCES vineyard_parcels(id) ON DELETE CASCADE,
        cadastral_parcel_id INTEGER NOT NULL REFERENCES cadastral_parcels(id),
        vine_area_m2        INTEGER NOT NULL CHECK (vine_area_m2 > 0),
        schedario_unit_code TEXT,
        ${AUDIT},
        UNIQUE (parcel_id, cadastral_parcel_id)
      );
      CREATE INDEX idx_parcel_links_cadastral ON parcel_cadastral_links (cadastral_parcel_id);

      CREATE TABLE parcel_appellation_eligibility (
        parcel_id      INTEGER NOT NULL REFERENCES vineyard_parcels(id) ON DELETE CASCADE,
        appellation_id INTEGER NOT NULL REFERENCES appellations(id),
        created_at     TEXT NOT NULL,
        created_by     TEXT,
        PRIMARY KEY (parcel_id, appellation_id)
      );

      CREATE TABLE equipment (
        id                   INTEGER PRIMARY KEY,
        name                 TEXT NOT NULL,
        type                 TEXT NOT NULL DEFAULT 'altro' CHECK (type IN ('irroratrice', 'trattore', 'vendemmiatrice', 'attrezzo', 'pompa', 'altro')),
        plate_serial         TEXT,
        last_inspection_date TEXT, -- controllo funzionale (irroratrici)
        notes                TEXT,
        ${AUDIT}, ${ARCHIVE}
      );

      CREATE TABLE phyto_products (
        id                        INTEGER PRIMARY KEY,
        commercial_name           TEXT NOT NULL,
        registration_number       TEXT NOT NULL,
        active_substances         TEXT,
        organic_allowed           INTEGER NOT NULL DEFAULT 0,
        max_dose_per_ha_e4        INTEGER,
        dose_unit                 TEXT CHECK (dose_unit IS NULL OR dose_unit IN ('kg/ha', 'l/ha', 'g/ha', 'ml/ha')),
        preharvest_interval_days  INTEGER,
        reentry_hours             INTEGER,
        max_applications_per_year INTEGER,
        warehouse_raw_id          INTEGER REFERENCES warehouse_raw(id) ON DELETE SET NULL,
        label_url                 TEXT,
        notes                     TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_phyto_products_reg ON phyto_products (registration_number) WHERE archived_at IS NULL;

      CREATE TABLE analysis_parameters (
        id                     INTEGER PRIMARY KEY,
        code                   TEXT NOT NULL UNIQUE,
        name                   TEXT NOT NULL,
        unit                   TEXT NOT NULL,
        decimals               INTEGER NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 4),
        applies_to             TEXT NOT NULL DEFAULT '[]',
        legal_limit_config_key TEXT REFERENCES prd_config(key),
        sort_order             INTEGER NOT NULL DEFAULT 0,
        notes                  TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
    `);
    const now = new Date().toISOString();
    const v = db.prepare("INSERT INTO grape_varieties (name, color, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 'Migrazione', ?, 'Migrazione')");
    for (const [name, color] of VARIETIES) v.run(name, color, now, now);
    const a = db.prepare("INSERT INTO appellations (name, type, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 'Migrazione', ?, 'Migrazione')");
    for (const [name, type] of APPELLATIONS) a.run(name, type, now, now);
    const p = db.prepare(`INSERT INTO analysis_parameters (code, name, unit, decimals, applies_to, legal_limit_config_key, sort_order, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Migrazione', ?, 'Migrazione')`);
    PARAMETERS.forEach(([code, name, unit, dec, subj, key], i) => p.run(code, name, unit, dec, JSON.stringify(subj), key, (i + 1) * 10, now, now));
  },
  down(db) {
    db.exec(`
      DROP TABLE analysis_parameters; DROP TABLE phyto_products; DROP TABLE equipment;
      DROP TABLE parcel_appellation_eligibility; DROP TABLE parcel_cadastral_links; DROP TABLE vineyard_parcels;
      DROP TABLE cadastral_parcels; DROP TABLE vineyards; DROP TABLE appellation_rules; DROP TABLE appellations; DROP TABLE grape_varieties;
    `);
  },
};
