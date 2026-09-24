// Stato e annullamento delle migrazioni dalla riga di comando.
//   npm run migrate -- status          elenco delle migrazioni e quando sono state applicate
//   npm run migrate -- down [NNNN]     annulla l'ultima migrazione applicata (con copia di sicurezza)
// Le migrazioni si applicano da sole all'avvio del server; qui non c'è "up".
// Usa lo stesso database del server (DB_PATH, oppure cantina.db nella cartella dei dati).
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { migrationStatus, rollbackMigration } = require('../lib/migrations');

const root = path.join(__dirname, '..');
const dbPath = process.env.DB_PATH || path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || root, 'cantina.db');
const dir = path.join(root, 'migrations');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

const [command, version] = process.argv.slice(2);
if (command === 'status' || !command) {
  console.log(`Database: ${dbPath}`);
  for (const m of migrationStatus(db, dir)) console.log(`${m.applied_at ? '✓' : '·'} ${m.version}_${m.name}${m.applied_at ? `  (${m.applied_at})` : '  da applicare'}`);
} else if (command === 'down') {
  rollbackMigration(db, { dir, dbPath, version: version || null });
} else {
  console.error(`Comando sconosciuto: ${command}. Usa "status" oppure "down [NNNN]".`);
  process.exit(1);
}
