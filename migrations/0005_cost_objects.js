// Oggetti di costo: ciò a cui si vuole attribuire un costo pieno (annata, lotto, SKU, operazione
// colturale, esperienza, fiera, progetto/contributo, evento). Quando esiste un'entità di origine
// nel gestionale il collegamento è una FK vera. ON DELETE SET NULL: eliminare una fiera,
// un'esperienza o una bottiglia continua a funzionare come oggi, l'oggetto di costo resta.
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE cost_objects (
        id            INTEGER PRIMARY KEY,
        type          TEXT NOT NULL CHECK (type IN ('annata', 'lotto', 'sku', 'operazione', 'esperienza', 'fiera', 'progetto', 'evento')),
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
      CREATE INDEX idx_cost_objects_type ON cost_objects(type, status);
    `);
  },
  down(db) {
    db.exec('DROP TABLE cost_objects');
  },
};
