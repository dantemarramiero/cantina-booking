// Centri di costo: un'unica anagrafica con due strutture.
// - Albero (padre/figlio) per aggregare nei report: solo le foglie ricevono costi.
// - Livello di cascata sulle foglie: 1 generali, 2 ausiliari, 3 produttivi, 4 commerciali/finali.
// Un centro con movimenti non si elimina: si disattiva.
// Il seed è la struttura di partenza proposta nel documento, tutta modificabile.
const SEED = [
  // [codice, nome, codice padre, livello (solo foglie), ordine]
  ['G', 'Generali', null, null, 1],
  ['G01', 'Direzione', 'G', 1, 1],
  ['G02', 'Amministrazione', 'G', 1, 2],
  ['G03', 'Fabbricati e utenze', 'G', 1, 3],
  ['A', 'Ausiliari', null, null, 2],
  ['A01', 'Manutenzione', 'A', 2, 1],
  ['A02', 'Parco macchine e trattori', 'A', 2, 2],
  ['A03', 'Laboratorio analisi', 'A', 2, 3],
  ['A04', 'Magazzino materie prime', 'A', 2, 4],
  ['P', 'Produttivi', null, null, 3],
  ['P1', 'Vigneto', 'P', null, 1],
  ['P101', 'Vigneto — particella 1', 'P1', 3, 1],
  ['P02', 'Vinificazione', 'P', 3, 2],
  ['P03', 'Affinamento', 'P', 3, 3],
  ['P04', 'Imbottigliamento', 'P', 3, 4],
  ['C', 'Commerciali', null, null, 4],
  ['C01', 'Horeca', 'C', 4, 1],
  ['C02', 'GDO', 'C', 4, 2],
  ['C03', 'Export', 'C', 4, 3],
  ['C04', 'E-commerce', 'C', 4, 4],
  ['C05', 'Enoturismo — visite', 'C', 4, 5],
  ['C06', 'Enoturismo — eventi', 'C', 4, 6],
  ['C07', 'Marketing', 'C', 4, 7],
  ['C08', 'Fiere', 'C', 4, 8],
];

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE cost_centers (
        id            INTEGER PRIMARY KEY,
        code          TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        description   TEXT,
        parent_id     INTEGER REFERENCES cost_centers(id),
        cascade_level INTEGER CHECK (cascade_level BETWEEN 1 AND 4),
        cascade_order INTEGER NOT NULL DEFAULT 0,
        active        INTEGER NOT NULL DEFAULT 1,
        valid_from    TEXT,
        valid_to      TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_cost_centers_parent ON cost_centers(parent_id);
    `);
    const now = new Date().toISOString();
    const ids = new Map();
    const insert = db.prepare(`INSERT INTO cost_centers (code, name, parent_id, cascade_level, cascade_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const [code, name, parent, level, order] of SEED) {
      ids.set(code, Number(insert.run(code, name, parent ? ids.get(parent) : null, level, order, now, now).lastInsertRowid));
    }
  },
  down(db) {
    db.exec('DROP TABLE cost_centers');
  },
};
