// Eventi di dominio, versione 2 della busta (Produzione, decisione DP2): ogni evento porta la versione
// dello schema del suo payload e chi ha fatto l'azione. Gli eventi già scritti restano versione 1,
// senza autore; nessun consumer cambia.
module.exports = {
  up(db) {
    db.exec(`
      ALTER TABLE domain_events ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE domain_events ADD COLUMN actor TEXT;
    `);
  },
  down(db) {
    db.exec(`
      ALTER TABLE domain_events DROP COLUMN actor;
      ALTER TABLE domain_events DROP COLUMN schema_version;
    `);
  },
};
