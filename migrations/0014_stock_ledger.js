// Magazzino valorizzato (Fase 3): registro dei movimenti con costo medio ponderato, impegni dei ritiri
// online, inventari, proposte di scarico in degustazione, vendite in cassa annullate (non più cancellate).
//
// Il registro non si modifica mai: le correzioni sono storni. Ogni movimento porta la fotografia del
// saldo dell'articolo (quantità e valore) dopo di sé, così giacenza e costo medio si leggono senza ricalcoli.
// Durante la transizione (passo A) warehouse_finished.quantity resta la quantità usata da cassa e shop:
// il registro la segue nella stessa transazione e un job notturno verifica che coincidano.
// Unità: quantità in millesimi (bottiglie e pezzi sono multipli di 1000), costi unitari in € × 10.000,
// valori in centesimi. L'apertura usa la giacenza attuale a costo zero: il foglio dei costi la valorizza.
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE stock_locations (
        id     INTEGER PRIMARY KEY,
        code   TEXT NOT NULL UNIQUE,
        name   TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO stock_locations (code, name) VALUES ('cantina', 'Cantina');
      CREATE TABLE stock_counts (
        id           INTEGER PRIMARY KEY,
        location_id  INTEGER NOT NULL REFERENCES stock_locations(id),
        counted_on   TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'bozza' CHECK (status IN ('bozza', 'confermato', 'annullato')),
        note         TEXT,
        created_at   TEXT NOT NULL,
        created_by   TEXT,
        confirmed_at TEXT,
        confirmed_by TEXT
      );
      CREATE TABLE stock_count_lines (
        id                INTEGER PRIMARY KEY,
        count_id          INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
        product_id        INTEGER REFERENCES products(id),
        raw_item_id       INTEGER REFERENCES warehouse_raw(id),
        expected_qty_milli INTEGER,
        counted_qty_milli INTEGER,
        reason            TEXT,
        CHECK ((product_id IS NULL) <> (raw_item_id IS NULL))
      );
      -- Proposte di scarico dei vini in degustazione, nate dal check-in di una prenotazione.
      CREATE TABLE stock_tasting_lines (
        id              INTEGER PRIMARY KEY,
        booking_id      INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        product_id      INTEGER NOT NULL REFERENCES products(id),
        suggested_milli INTEGER NOT NULL,
        confirmed_milli INTEGER,
        status          TEXT NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta', 'confermata', 'scartata')),
        decided_at      TEXT,
        decided_by      TEXT,
        created_at      TEXT NOT NULL,
        UNIQUE (booking_id, product_id)
      );
      CREATE TABLE stock_movements (
        id                   INTEGER PRIMARY KEY,
        product_id           INTEGER REFERENCES products(id),
        raw_item_id          INTEGER REFERENCES warehouse_raw(id),
        location_id          INTEGER NOT NULL REFERENCES stock_locations(id),
        occurred_on          TEXT NOT NULL,
        kind                 TEXT NOT NULL CHECK (kind IN ('apertura', 'carico_acquisto', 'carico_produzione', 'scarico_vendita', 'scarico_degustazione',
                               'scarico_omaggio', 'consumo_produzione', 'rettifica_inventario', 'trasferimento', 'rivalutazione')),
        quantity_milli       INTEGER NOT NULL,
        unit_cost_e4         INTEGER NOT NULL DEFAULT 0,
        value_cents          INTEGER NOT NULL DEFAULT 0,
        balance_qty_milli    INTEGER NOT NULL,
        balance_value_cents  INTEGER NOT NULL,
        -- Documento di origine: un collegamento vero per tipo (se il documento viene eliminato resta la descrizione).
        shop_sale_item_id    INTEGER REFERENCES shop_sale_items(id) ON DELETE SET NULL,
        pickup_order_item_id INTEGER REFERENCES pickup_order_items(id) ON DELETE SET NULL,
        order_item_id        INTEGER REFERENCES order_items(id) ON DELETE SET NULL,
        booking_id           INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        tasting_line_id      INTEGER REFERENCES stock_tasting_lines(id) ON DELETE SET NULL,
        stock_count_line_id  INTEGER REFERENCES stock_count_lines(id) ON DELETE SET NULL,
        supplier_id          INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        doc_number           TEXT,
        doc_date             TEXT,
        cost_object_id       INTEGER REFERENCES cost_objects(id) ON DELETE SET NULL,
        reverses_id          INTEGER REFERENCES stock_movements(id),
        transfer_group       TEXT,
        idem_key             TEXT,                    -- chiave di idempotenza: lo stesso evento non muove due volte
        source_label         TEXT,
        reason               TEXT,
        created_at           TEXT NOT NULL,
        created_by           TEXT,
        CHECK ((product_id IS NULL) <> (raw_item_id IS NULL)),
        CHECK (quantity_milli <> 0 OR kind = 'rivalutazione')
      );
      CREATE UNIQUE INDEX idx_stock_mov_idem ON stock_movements (idem_key) WHERE idem_key IS NOT NULL;
      CREATE UNIQUE INDEX idx_stock_mov_reverses ON stock_movements (reverses_id) WHERE reverses_id IS NOT NULL;
      CREATE INDEX idx_stock_mov_product ON stock_movements (product_id, id);
      CREATE INDEX idx_stock_mov_raw ON stock_movements (raw_item_id, id);
      CREATE INDEX idx_stock_mov_date ON stock_movements (occurred_on);
      -- Impegni: merce pagata online in attesa di ritiro (il disponibile scende, la giacenza no).
      CREATE TABLE stock_reservations (
        id                   INTEGER PRIMARY KEY,
        product_id           INTEGER NOT NULL REFERENCES products(id),
        pickup_order_item_id INTEGER REFERENCES pickup_order_items(id) ON DELETE SET NULL UNIQUE,
        quantity_milli       INTEGER NOT NULL CHECK (quantity_milli > 0),
        created_at           TEXT NOT NULL,
        released_at          TEXT,
        consumed_at          TEXT,
        consumed_movement_id INTEGER REFERENCES stock_movements(id)
      );
      -- Righe d'ordine B2B evase senza prodotto (es. importate da Excel senza abbinamento): non escono dal
      -- magazzino e restano in anomalia finché non si abbina il prodotto.
      CREATE TABLE stock_unmatched_lines (
        order_item_id INTEGER PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
        order_id      INTEGER NOT NULL,
        detected_at   TEXT NOT NULL
      );
      -- Vendite in cassa annullate: restano (servono ai corrispettivi), con lo storno del magazzino.
      ALTER TABLE shop_sales ADD COLUMN cancelled_at TEXT;
      ALTER TABLE shop_sales ADD COLUMN cancelled_by TEXT;
      ALTER TABLE shop_sales ADD COLUMN cancel_reason TEXT;
      -- Degustazioni: quanti ospiti per bottiglia di ciascun vino (per la quantità proposta).
      ALTER TABLE experience_products ADD COLUMN guests_per_bottle INTEGER NOT NULL DEFAULT 6;
    `);
    // Apertura: la giacenza di oggi a costo zero (il foglio dei costi la valorizza con una rivalutazione).
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const loc = db.prepare("SELECT id FROM stock_locations WHERE code = 'cantina'").get().id;
    const ins = db.prepare(`INSERT INTO stock_movements (product_id, raw_item_id, location_id, occurred_on, kind, quantity_milli, unit_cost_e4, value_cents,
      balance_qty_milli, balance_value_cents, idem_key, source_label, created_at, created_by) VALUES (?, ?, ?, ?, 'apertura', ?, 0, 0, ?, 0, ?, ?, ?, 'Migrazione')`);
    const label = "Giacenza all'avvio del registro";
    for (const w of db.prepare('SELECT product_id, quantity FROM warehouse_finished WHERE quantity <> 0').all()) {
      ins.run(w.product_id, null, loc, today, w.quantity * 1000, w.quantity * 1000, `apertura:prodotto:${w.product_id}`, label, now);
    }
    for (const w of db.prepare('SELECT id, quantity FROM warehouse_raw WHERE quantity <> 0').all()) {
      ins.run(null, w.id, loc, today, w.quantity * 1000, w.quantity * 1000, `apertura:materia:${w.id}`, label, now);
    }
  },
  down(db) {
    db.exec(`
      ALTER TABLE experience_products DROP COLUMN guests_per_bottle;
      ALTER TABLE shop_sales DROP COLUMN cancel_reason;
      ALTER TABLE shop_sales DROP COLUMN cancelled_by;
      ALTER TABLE shop_sales DROP COLUMN cancelled_at;
      DROP TABLE stock_unmatched_lines; DROP TABLE stock_reservations; DROP TABLE stock_movements; DROP TABLE stock_tasting_lines;
      DROP TABLE stock_count_lines; DROP TABLE stock_counts; DROP TABLE stock_locations;
    `);
  },
};
