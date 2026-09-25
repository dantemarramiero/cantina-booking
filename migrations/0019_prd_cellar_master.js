// Produzione, Fase 1 — anagrafiche di cantina e di compliance:
//   stabilimenti (un registro SIAN per stabilimento), campagne vitivinicole (1/8–31/7), luoghi di cantina,
//   vasi vinari con il codice QR, barrique (estensione 1:1 dei vasi in legno), protocolli di vinificazione
//   come modelli modificabili, mappa delle operazioni SIAN (vuota: la popola il consulente).
// Capacità dei vasi in ml. Lo stato «pieno» e «dismesso» di un vaso lo scrive il sistema, non l'utente.
const { romeDate, campaignOf } = require('../lib/time');
const AUDIT = `created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT`;
const ARCHIVE = `archived_at TEXT, archived_by TEXT`;

// Protocolli di partenza, dai processi descritti nella specifica (§ 4.3–4.6). I parametri obiettivo
// restano vuoti: li inserisce l'enologo. [tipo di operazione, titolo, fase, facoltativo]
const PROTOCOLS = [
  ['Vinificazione in bianco', 'bianco', [
    ['diraspatura', 'Diraspatura', 'Pigiatura e pressatura', 1],
    ['pressatura', 'Pigiatura o pressatura a grappolo intero', 'Pigiatura e pressatura', 0],
    ['macerazione', 'Macerazione pellicolare a freddo', 'Pigiatura e pressatura', 1],
    ['pressatura', 'Pressatura soffice con frazionamento dei mosti (fiore, seconda, torchiato come lotti separati)', 'Pigiatura e pressatura', 0],
    ['solfitazione', 'Solfitazione', 'Mosto', 0],
    ['chiarifica_mosto', 'Chiarifica statica o flottazione', 'Mosto', 0],
    ['travaso', 'Travaso del mosto limpido e gestione delle fecce', 'Mosto', 0],
    ['correzione', 'Correzioni (acidificazione; arricchimento solo con dichiarazione preventiva)', 'Mosto', 1],
    ['inoculo', 'Inoculo di lieviti o pied de cuve, nutrienti', 'Fermentazione', 0],
    ['fermentazione_inizio', 'Fermentazione alcolica a temperatura controllata, con letture di densità e temperatura', 'Fermentazione', 0],
    ['fermentazione_fine', 'Fine della fermentazione alcolica', 'Fermentazione', 0],
    ['batonnage', 'Bâtonnage sulle fecce fini', 'Affinamento', 1],
    ['malolattica_inizio', 'Fermentazione malolattica (spesso bloccata nei bianchi)', 'Affinamento', 1],
    ['travaso', 'Travasi', 'Affinamento', 0],
    ['stabilizzazione_proteica', 'Stabilizzazione proteica', 'Stabilizzazione', 0],
    ['stabilizzazione_tartarica', 'Stabilizzazione tartarica', 'Stabilizzazione', 0],
    ['chiarifica', 'Chiarifiche', 'Stabilizzazione', 1],
    ['filtrazione', 'Filtrazione', 'Stabilizzazione', 0],
    ['imbottigliamento', 'Imbottigliamento, tiraggio o affinamento', 'Imbottigliamento', 0],
  ]],
  ['Vinificazione in rosso', 'rosso', [
    ['diraspatura', 'Diraspapigiatura', 'Pigiatura', 0],
    ['riempimento', 'Riempimento della vasca con solfitazione', 'Pigiatura', 0],
    ['macerazione', 'Macerazione prefermentativa a freddo', 'Macerazione', 1],
    ['inoculo', 'Inoculo', 'Fermentazione', 0],
    ['fermentazione_inizio', 'Fermentazione alcolica', 'Fermentazione', 0],
    ['gestione_cappello', 'Gestione del cappello: rimontaggi, follature, délestage', 'Fermentazione', 0],
    ['macerazione', 'Macerazione post-fermentativa', 'Macerazione', 1],
    ['svinatura', 'Svinatura: vino fiore e vino di torchio come lotti separati, vinacce come sottoprodotto', 'Svinatura', 0],
    ['malolattica_inizio', 'Fermentazione malolattica: inoculo dei batteri', 'Malolattica', 0],
    ['malolattica_fine', "Fine della malolattica (acido malico esaurito)", 'Malolattica', 0],
    ['travaso', 'Travasi', 'Affinamento', 0],
    ['affinamento_legno', 'Affinamento in acciaio, cemento o legno', 'Affinamento', 0],
    ['assemblaggio', 'Assemblaggi', 'Affinamento', 1],
    ['stabilizzazione_tartarica', 'Stabilizzazione', 'Stabilizzazione', 0],
    ['filtrazione', 'Filtrazione', 'Stabilizzazione', 1],
    ['imbottigliamento', 'Imbottigliamento', 'Imbottigliamento', 0],
  ]],
  ['Vinificazione in rosato', 'rosato', [
    ['diraspatura', 'Diraspapigiatura', 'Pigiatura', 0],
    ['macerazione', 'Breve macerazione', 'Macerazione', 1],
    ['salasso', 'Salasso', 'Macerazione', 1],
    ['pressatura', 'Pressatura', 'Pressatura', 0],
    ['solfitazione', 'Solfitazione', 'Mosto', 0],
    ['chiarifica_mosto', 'Chiarifica del mosto', 'Mosto', 0],
    ['inoculo', 'Inoculo', 'Fermentazione', 0],
    ['fermentazione_inizio', 'Fermentazione alcolica a temperatura controllata', 'Fermentazione', 0],
    ['travaso', 'Travasi', 'Affinamento', 0],
    ['stabilizzazione_proteica', 'Stabilizzazione proteica', 'Stabilizzazione', 0],
    ['stabilizzazione_tartarica', 'Stabilizzazione tartarica', 'Stabilizzazione', 0],
    ['filtrazione', 'Filtrazione', 'Stabilizzazione', 0],
    ['imbottigliamento', 'Imbottigliamento', 'Imbottigliamento', 0],
  ]],
  ['Base spumante', 'base_spumante', [
    ['pressatura', 'Pressatura soffice a grappolo intero (anche uve a bacca nera vinificate in bianco)', 'Pressatura', 0],
    ['pressatura', 'Frazionamento dei mosti come lotti separati', 'Pressatura', 0],
    ['solfitazione', 'Solfitazione', 'Mosto', 0],
    ['chiarifica_mosto', 'Chiarifica statica', 'Mosto', 0],
    ['inoculo', 'Inoculo', 'Fermentazione', 0],
    ['fermentazione_inizio', 'Fermentazione alcolica a temperatura controllata', 'Fermentazione', 0],
    ['malolattica_inizio', 'Fermentazione malolattica: da decidere per ogni base', 'Affinamento', 1],
    ['travaso', 'Travasi', 'Affinamento', 0],
    ['stabilizzazione_tartarica', 'Stabilizzazione', 'Stabilizzazione', 0],
    ['tiraggio', 'Pronto per la cuvée e il tiraggio', 'Tiraggio', 0],
  ]],
  ['Metodo classico', 'metodo_classico', [
    ['assemblaggio', 'Cuvée dai vini base, anche con vini di riserva di annate diverse', 'Cuvée', 0],
    ['aggiunta', 'Liqueur de tirage: vino, zucchero, lieviti, nutrienti, coadiuvanti di remuage', 'Tiraggio', 0],
    ['tiraggio', 'Tiraggio in bottiglia con tappo a corona e bidule: nascono le cataste', 'Tiraggio', 0],
    ['affinamento_bottiglia', 'Presa di spuma e affinamento sui lieviti (tempo minimo da disciplinare)', 'Sui lieviti', 0],
    ['campionamento', 'Controlli di pressione (afrometro); rotture registrate come perdite', 'Sui lieviti', 0],
    ['remuage', 'Remuage (pupitre o giropallet)', 'Remuage', 0],
    ['sboccatura', 'Sboccatura (à la glace o à la volée)', 'Sboccatura', 0],
    ['dosaggio', "Dosaggio con la liqueur d'expédition", 'Sboccatura', 0],
    ['etichettatura', 'Tappatura definitiva, affinamento dopo la sboccatura, etichettatura', 'Finitura', 0],
  ]],
];

module.exports = {
  PROTOCOLS,
  up(db) {
    db.exec(`
      CREATE TABLE establishments (
        id               INTEGER PRIMARY KEY,
        name             TEXT NOT NULL,
        icqrf_code       TEXT,
        address          TEXT,
        regime           TEXT NOT NULL DEFAULT 'ordinario' CHECK (regime IN ('ordinario', 'deroga_sotto_1000hl')),
        fiscal_warehouse INTEGER NOT NULL DEFAULT 0,
        notes            TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_establishments_icqrf ON establishments (icqrf_code) WHERE icqrf_code IS NOT NULL;

      CREATE TABLE wine_campaigns (
        id         INTEGER PRIMARY KEY,
        label      TEXT NOT NULL UNIQUE,
        starts_on  TEXT NOT NULL,
        ends_on    TEXT NOT NULL,
        closed_at  TEXT,
        closed_by  TEXT,
        ${AUDIT}
      );

      CREATE TABLE cellar_locations (
        id               INTEGER PRIMARY KEY,
        name             TEXT NOT NULL,
        kind             TEXT NOT NULL DEFAULT 'altro' CHECK (kind IN ('tinaia', 'bottaia', 'cantina_spumanti', 'magazzino', 'esterno', 'altro')),
        establishment_id INTEGER REFERENCES establishments(id),
        notes            TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_cellar_locations_name ON cellar_locations (lower(name)) WHERE archived_at IS NULL;

      CREATE TABLE vessels (
        id                      INTEGER PRIMARY KEY,
        code                    TEXT NOT NULL,
        name                    TEXT,
        type                    TEXT NOT NULL CHECK (type IN ('vasca_inox', 'vasca_cemento', 'vasca_vetroresina', 'tino', 'barrique', 'tonneau', 'botte',
                                  'anfora', 'uovo', 'autoclave', 'fusto', 'catasta')),
        material                TEXT,
        capacity_ml             INTEGER NOT NULL CHECK (capacity_ml > 0),
        location_id             INTEGER REFERENCES cellar_locations(id),
        status                  TEXT NOT NULL DEFAULT 'empty_clean' CHECK (status IN ('empty_clean', 'empty_dirty', 'in_use', 'maintenance', 'retired')),
        has_temperature_control INTEGER NOT NULL DEFAULT 0,
        confined_space          INTEGER NOT NULL DEFAULT 0,
        qr_token                TEXT NOT NULL UNIQUE,
        public_description      TEXT,
        notes                   TEXT,
        retired_at              TEXT,
        retired_by              TEXT,
        retire_reason           TEXT,
        ${AUDIT}
      );
      CREATE UNIQUE INDEX idx_vessels_code ON vessels (lower(code));

      CREATE TABLE barrels (
        vessel_id           INTEGER PRIMARY KEY REFERENCES vessels(id) ON DELETE CASCADE,
        cooper_supplier_id  INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        cooper_name         TEXT,
        oak_origin          TEXT,
        forest              TEXT,
        grain               TEXT,
        toast               TEXT,
        purchase_date       TEXT,
        purchase_cost_cents INTEGER,
        useful_life_uses    INTEGER,
        uses_count          INTEGER NOT NULL DEFAULT 0,
        retired_at          TEXT,
        notes               TEXT,
        ${AUDIT}
      );

      CREATE TABLE winemaking_protocols (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        style       TEXT NOT NULL CHECK (style IN ('bianco', 'rosso', 'rosato', 'base_spumante', 'metodo_classico', 'altro')),
        description TEXT,
        active      INTEGER NOT NULL DEFAULT 1,
        notes       TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_protocols_name ON winemaking_protocols (lower(name)) WHERE archived_at IS NULL;

      CREATE TABLE protocol_steps (
        id             INTEGER PRIMARY KEY,
        protocol_id    INTEGER NOT NULL REFERENCES winemaking_protocols(id) ON DELETE CASCADE,
        sequence       INTEGER NOT NULL,
        phase          TEXT,
        operation_type TEXT NOT NULL,
        title          TEXT NOT NULL,
        target_params  TEXT NOT NULL DEFAULT '{}',
        checks         TEXT,
        optional       INTEGER NOT NULL DEFAULT 0,
        ${AUDIT},
        UNIQUE (protocol_id, sequence)
      );

      -- Tipo di operazione interno → codice operazione del registro telematico, dai documenti ufficiali e validato dal consulente.
      CREATE TABLE sian_operation_map (
        id                INTEGER PRIMARY KEY,
        operation_type    TEXT NOT NULL,
        sian_code         TEXT NOT NULL,
        description       TEXT,
        required_fields   TEXT,
        requires_document INTEGER NOT NULL DEFAULT 0,
        notes             TEXT,
        validated_by      TEXT,
        validated_at      TEXT,
        ${AUDIT}, ${ARCHIVE}
      );
      CREATE UNIQUE INDEX idx_sian_map_operation ON sian_operation_map (operation_type) WHERE archived_at IS NULL;
    `);
    const now = new Date().toISOString();
    const current = campaignOf(romeDate());
    const [y] = current.starts_on.split('-').map(Number);
    const c = db.prepare("INSERT INTO wine_campaigns (label, starts_on, ends_on, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, 'Migrazione', ?, 'Migrazione')");
    c.run(`${y - 1}/${y}`, `${y - 1}-08-01`, `${y}-07-31`, now, now);
    c.run(current.label, current.starts_on, current.ends_on, now, now);
    const p = db.prepare("INSERT INTO winemaking_protocols (name, style, description, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, 'Migrazione', ?, 'Migrazione')");
    const s = db.prepare(`INSERT INTO protocol_steps (protocol_id, sequence, phase, operation_type, title, optional, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Migrazione', ?, 'Migrazione')`);
    for (const [name, style, steps] of PROTOCOLS) {
      const id = Number(p.run(name, style, 'Modello di partenza: passi e parametri obiettivo si modificano.', now, now).lastInsertRowid);
      steps.forEach(([op, title, phase, optional], i) => s.run(id, i + 1, phase, op, title, optional, now, now));
    }
  },
  down(db) {
    db.exec(`
      DROP TABLE sian_operation_map; DROP TABLE protocol_steps; DROP TABLE winemaking_protocols;
      DROP TABLE barrels; DROP TABLE vessels; DROP TABLE cellar_locations; DROP TABLE wine_campaigns; DROP TABLE establishments;
    `);
  },
};
