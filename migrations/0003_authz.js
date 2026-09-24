// Livelli di riservatezza per ruolo (regola 11 del documento People/Finance).
// Un ruolo, oltre ai workspace, ha l'elenco dei livelli di dati HR che può vedere:
// base (sempre), personale, retributivo, sanitario, disciplinare.
// Gli utenti senza ruolo e la chiave master vedono tutto, come oggi per i workspace.
// I nuovi workspace "people" e "finance" si aggiungono all'elenco del codice (ALL_WORKSPACES):
// nel database i workspace di un ruolo sono già una lista JSON, non serve cambiare lo schema.
module.exports = {
  up(db) {
    db.exec("ALTER TABLE roles ADD COLUMN access_levels TEXT NOT NULL DEFAULT '[]'");
  },
  down(db) {
    db.exec('ALTER TABLE roles DROP COLUMN access_levels');
  },
};
