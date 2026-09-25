// Migrazioni versionate dello schema.
//
// Ogni file in migrations/ si chiama NNNN_nome.js ed esporta up(db) e down(db). Le migrazioni si
// applicano in ordine all'avvio, ciascuna in una transazione, e vengono registrate in
// schema_migrations. Prima di applicarne su un database su file se ne fa una copia in backups/
// (VACUUM INTO, copia coerente anche a server acceso), tenendo le ultime KEEP_BACKUPS.
//
// Portabilità verso Postgres: la DDL delle migrazioni è nel dialetto SQLite (le colonne
// "INTEGER PRIMARY KEY" andranno tradotte in IDENTITY al passaggio), mentre dati e query restano
// portabili: date in ISO 8601 calcolate in JavaScript, niente funzioni di data di SQLite.
const fs = require('fs');
const path = require('path');

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.js$/;
const KEEP_BACKUPS = 10;

function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
}

function listMigrations(dir) {
  const abs = path.resolve(dir);
  return fs.readdirSync(abs)
    .map(file => {
      const m = file.match(MIGRATION_FILE);
      return m && { version: m[1], name: m[2], file: path.join(abs, file) };
    })
    .filter(Boolean)
    .sort((a, b) => a.version.localeCompare(b.version));
}

function appliedVersions(db) {
  ensureTable(db);
  return new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
}

function backupDatabase(db, dbPath, label) {
  if (!dbPath || dbPath === ':memory:' || process.env.MIGRATION_BACKUPS === 'off') return null;
  const dir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const target = path.join(dir, `${path.basename(dbPath, path.extname(dbPath))}-${stamp}-${label}.db`);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(dir, f));
  return target;
}

// Esegue fn in una transazione. Una migrazione che ricostruisce una tabella (in SQLite cambiare un CHECK
// vuol dire crearne una nuova, copiare i dati, eliminare la vecchia e rinominare) dichiara
// disableForeignKeys: le chiavi esterne si spengono prima della transazione, altrimenti l'eliminazione
// della vecchia tabella azzererebbe i collegamenti delle altre (ON DELETE SET NULL). Prima del commit si
// controlla che tutti i riferimenti siano ancora validi, poi si riaccendono.
function inTransaction(db, mod, fn) {
  const fkOff = mod.disableForeignKeys === true;
  const fkBefore = fkOff ? db.prepare('PRAGMA foreign_keys').get().foreign_keys : null;
  if (fkOff) db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    fn();
    if (fkOff) {
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`${broken.length} riferimenti non validi dopo la ricostruzione (tabella ${broken[0].table})`);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    if (fkOff) db.exec(`PRAGMA foreign_keys = ${fkBefore ? 'ON' : 'OFF'}`);
  }
}

function runMigrations(db, { dir, dbPath = null, log = console.log } = {}) {
  const applied = appliedVersions(db);
  const pending = listMigrations(dir).filter(m => !applied.has(m.version));
  if (!pending.length) return [];
  const backup = backupDatabase(db, dbPath, `before-${pending[0].version}`);
  if (backup) log(`Copia del database prima delle migrazioni: ${backup}`);
  for (const m of pending) {
    const mod = require(m.file);
    try {
      inTransaction(db, mod, () => {
        mod.up(db);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(m.version, m.name, new Date().toISOString());
      });
      log(`Migrazione applicata: ${m.version}_${m.name}`);
    } catch (e) {
      throw new Error(`Migrazione ${m.version}_${m.name} non applicata: ${e.message}`);
    }
  }
  return pending.map(m => m.version);
}

// Annulla l'ultima migrazione applicata (solo l'ultima: si torna indietro un passo alla volta).
function rollbackMigration(db, { dir, dbPath = null, version = null, log = console.log } = {}) {
  const applied = [...appliedVersions(db)].sort();
  const latest = applied[applied.length - 1];
  if (!latest) throw new Error('Nessuna migrazione applicata.');
  const target = version || latest;
  if (target !== latest) throw new Error(`Si può annullare solo l'ultima migrazione applicata (${latest}).`);
  const m = listMigrations(dir).find(x => x.version === target);
  if (!m) throw new Error(`File della migrazione ${target} non trovato.`);
  const mod = require(m.file);
  if (typeof mod.down !== 'function') throw new Error(`La migrazione ${target} non è reversibile.`);
  const backup = backupDatabase(db, dbPath, `before-down-${target}`);
  if (backup) log(`Copia del database prima dell'annullamento: ${backup}`);
  try {
    inTransaction(db, mod, () => {
      mod.down(db);
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(target);
    });
    log(`Migrazione annullata: ${m.version}_${m.name}`);
  } catch (e) {
    throw new Error(`Annullamento di ${m.version}_${m.name} non riuscito: ${e.message}`);
  }
  return target;
}

function migrationStatus(db, dir) {
  const applied = new Map(appliedRows(db).map(r => [r.version, r.applied_at]));
  return listMigrations(dir).map(m => ({ version: m.version, name: m.name, applied_at: applied.get(m.version) || null }));
}
function appliedRows(db) {
  ensureTable(db);
  return db.prepare('SELECT version, applied_at FROM schema_migrations').all();
}

module.exports = { runMigrations, rollbackMigration, migrationStatus, backupDatabase, listMigrations };
