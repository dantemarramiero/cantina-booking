// Movimenti analitici: i costi (e più avanti i ricavi) imputati a un centro di costo foglia,
// con oggetto di costo facoltativo. In Fase 1 l'unica origine è "manuale" (costi diretti inseriti
// a mano, che alimentano la cascata); le origini automatiche (timesheet, magazzino, contabilità,
// provvigioni) arriveranno nelle fasi successive con la loro FK al documento, non con un
// collegamento generico tipo/id.
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE analytic_entries (
        id             INTEGER PRIMARY KEY,
        entry_date     TEXT NOT NULL,
        period         TEXT NOT NULL,
        amount_cents   INTEGER NOT NULL,
        cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
        cost_object_id INTEGER REFERENCES cost_objects(id),
        nature         TEXT NOT NULL CHECK (nature IN ('personale', 'materie', 'servizi', 'utenze', 'ammortamenti', 'altro')),
        origin         TEXT NOT NULL DEFAULT 'manuale' CHECK (origin IN ('manuale')),
        description    TEXT,
        created_at     TEXT NOT NULL,
        created_by     TEXT
      );
      CREATE INDEX idx_analytic_entries_period ON analytic_entries(period, cost_center_id);
      CREATE INDEX idx_analytic_entries_object ON analytic_entries(cost_object_id);
    `);
  },
  down(db) {
    db.exec('DROP TABLE analytic_entries');
  },
};
