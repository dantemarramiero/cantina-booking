// Baseline: lo schema esistente quando sono state introdotte le migrazioni (settembre 2026).
//
// Le tabelle storiche sono ancora create all'avvio da server.js (CREATE TABLE IF NOT EXISTS e
// ALTER TABLE in try/catch), quindi questa migrazione non crea nulla: segna il punto di partenza.
// La fotografia completa dello schema a quella data è in 0001_baseline.sql.
// Da qui in avanti ogni nuova tabella o colonna passa da una migrazione.
module.exports = {
  up() {},
  down() {
    throw new Error('La baseline rappresenta lo schema esistente e non si annulla.');
  },
};
