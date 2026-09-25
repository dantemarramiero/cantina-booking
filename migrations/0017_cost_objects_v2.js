// Oggetti di costo che mette a disposizione la Produzione (decisione DP3): parcella, ordine di lavoro,
// imbottigliamento. In SQLite il CHECK sui tipi non si modifica: la tabella si ricostruisce (nuova tabella,
// copia, eliminazione della vecchia, rinomina) con le chiavi esterne spente, così le tabelle che la
// usano (analitica, presenze, sicurezza, magazzino…) non perdono i collegamenti. Il runner controlla
// i riferimenti prima del commit. I collegamenti veri a parcelle, lotti, ordini di lavoro e
// imbottigliamenti si aggiungono nelle fasi che creano quelle tabelle.
const TYPES_V1 = ['annata', 'lotto', 'sku', 'operazione', 'esperienza', 'fiera', 'progetto', 'evento'];
const TYPES_V2 = [...TYPES_V1, 'parcella', 'ordine_lavoro', 'imbottigliamento'];
const quote = list => list.map(t => `'${t}'`).join(', ');

function rebuild(db, types) {
  db.exec(`
    CREATE TABLE cost_objects_new (
      id            INTEGER PRIMARY KEY,
      type          TEXT NOT NULL CHECK (type IN (${quote(types)})),
      code          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'aperto' CHECK (status IN ('aperto', 'chiuso')),
      fair_id       INTEGER REFERENCES fairs(id) ON DELETE SET NULL,
      experience_id INTEGER REFERENCES experiences(id) ON DELETE SET NULL,
      product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
      vintage       INTEGER,
      notes         TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    INSERT INTO cost_objects_new (id, type, code, name, status, fair_id, experience_id, product_id, vintage, notes, created_at, updated_at)
      SELECT id, type, code, name, status, fair_id, experience_id, product_id, vintage, notes, created_at, updated_at FROM cost_objects;
    DROP TABLE cost_objects;
    ALTER TABLE cost_objects_new RENAME TO cost_objects;
    CREATE INDEX idx_cost_objects_type ON cost_objects(type, status);
  `);
}

module.exports = {
  disableForeignKeys: true,
  up(db) {
    rebuild(db, TYPES_V2);
  },
  down(db) {
    const n = db.prepare(`SELECT COUNT(*) AS c FROM cost_objects WHERE type NOT IN (${quote(TYPES_V1)})`).get().c;
    if (n) throw new Error(`Ci sono ${n} oggetti di costo di Produzione (parcelle, ordini di lavoro, imbottigliamenti): non si torna indietro.`);
    rebuild(db, TYPES_V1);
  },
};
