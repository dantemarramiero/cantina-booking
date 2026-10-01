// Copia giornaliera su S3 (lib/offsite-backup.js): i file del volume già caricati nel bucket, per non
// ricaricarli ogni giorno. Un file con dimensione o data di modifica diverse si ricarica.
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE offsite_backup_files (
        path        TEXT PRIMARY KEY,
        size        INTEGER NOT NULL,
        mtime_ms    INTEGER NOT NULL,
        uploaded_at TEXT NOT NULL
      );
    `);
  },
  down(db) {
    db.exec('DROP TABLE offsite_backup_files');
  },
};
