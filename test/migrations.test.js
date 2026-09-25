// Runner delle migrazioni: ordine, idempotenza, rollback, copia di sicurezza.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations, rollbackMigration, migrationStatus } = require('../lib/migrations');

const silent = () => {};

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantina-mig-'));
  const migDir = path.join(dir, 'migrations');
  fs.mkdirSync(migDir);
  fs.writeFileSync(path.join(migDir, '0001_prima.js'), `module.exports = {
    up(db) { db.exec('CREATE TABLE a (id INTEGER PRIMARY KEY, v TEXT)'); },
    down(db) { db.exec('DROP TABLE a'); },
  };`);
  fs.writeFileSync(path.join(migDir, '0002_seconda.js'), `module.exports = {
    up(db) { db.exec("CREATE TABLE b (id INTEGER PRIMARY KEY); INSERT INTO a (v) VALUES ('x')"); },
    down(db) { db.exec('DROP TABLE b'); },
  };`);
  const dbPath = path.join(dir, 'x.db');
  return { dir, migDir, dbPath, db: new DatabaseSync(dbPath) };
}
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);

test('applica le migrazioni in ordine e una sola volta', () => {
  const { db, migDir, dbPath } = setup();
  process.env.MIGRATION_BACKUPS = 'off';
  assert.deepEqual(runMigrations(db, { dir: migDir, dbPath, log: silent }), ['0001', '0002']);
  assert.deepEqual(tables(db), ['a', 'b', 'schema_migrations']);
  assert.deepEqual(runMigrations(db, { dir: migDir, dbPath, log: silent }), [], 'al secondo avvio non rifà nulla');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM a').get().c, 1);
  assert.ok(migrationStatus(db, migDir).every(m => m.applied_at));
});

test('una migrazione che fallisce non lascia modifiche a metà', () => {
  const { db, migDir, dbPath } = setup();
  process.env.MIGRATION_BACKUPS = 'off';
  fs.writeFileSync(path.join(migDir, '0003_rotta.js'), `module.exports = {
    up(db) { db.exec('CREATE TABLE c (id INTEGER PRIMARY KEY)'); db.exec('SELECT * FROM tabella_inesistente'); },
  };`);
  assert.throws(() => runMigrations(db, { dir: migDir, dbPath, log: silent }), /0003_rotta non applicata/);
  assert.ok(!tables(db).includes('c'), 'la tabella della migrazione fallita non esiste');
  assert.equal(migrationStatus(db, migDir).find(m => m.version === '0003').applied_at, null);
});

test('annulla solo l\'ultima migrazione, poi quella prima', () => {
  const { db, migDir, dbPath } = setup();
  process.env.MIGRATION_BACKUPS = 'off';
  runMigrations(db, { dir: migDir, dbPath, log: silent });
  assert.throws(() => rollbackMigration(db, { dir: migDir, dbPath, version: '0001', log: silent }), /solo l'ultima/);
  assert.equal(rollbackMigration(db, { dir: migDir, dbPath, log: silent }), '0002');
  assert.ok(!tables(db).includes('b'));
  assert.equal(rollbackMigration(db, { dir: migDir, dbPath, log: silent }), '0001');
  assert.deepEqual(tables(db), ['schema_migrations']);
});

test('prima di migrare fa una copia del database', () => {
  const { db, migDir, dbPath, dir } = setup();
  delete process.env.MIGRATION_BACKUPS;
  runMigrations(db, { dir: migDir, dbPath, log: silent });
  const backups = fs.readdirSync(path.join(dir, 'backups'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^x-\d{8}-\d{6}-before-0001\.db$/);
});

test('le migrazioni vere del progetto si applicano su un database vuoto e si annullano', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantina-mig-real-'));
  const db = new DatabaseSync(path.join(dir, 'real.db'));
  // Le migrazioni fanno riferimento a tabelle del bootstrap storico: qui bastano versioni minime.
  db.exec(`CREATE TABLE portal_users (id INTEGER PRIMARY KEY);
    CREATE TABLE roles (id INTEGER PRIMARY KEY, workspaces TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE fairs (id INTEGER PRIMARY KEY); CREATE TABLE experiences (id INTEGER PRIMARY KEY); CREATE TABLE products (id INTEGER PRIMARY KEY);
    CREATE TABLE shop_sales (id INTEGER PRIMARY KEY); CREATE TABLE experience_products (id INTEGER PRIMARY KEY);
    CREATE TABLE warehouse_finished (id INTEGER PRIMARY KEY, product_id INTEGER, quantity INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE warehouse_raw (id INTEGER PRIMARY KEY, quantity INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE suppliers (id INTEGER PRIMARY KEY); CREATE TABLE shop_sale_items (id INTEGER PRIMARY KEY); CREATE TABLE pickup_order_items (id INTEGER PRIMARY KEY);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY); CREATE TABLE bookings (id INTEGER PRIMARY KEY);`);
  process.env.MIGRATION_BACKUPS = 'off';
  const migDir = path.join(__dirname, '..', 'migrations');
  const applied = runMigrations(db, { dir: migDir, log: silent });
  assert.deepEqual(applied.slice(0, 2), ['0001', '0002']);
  for (const t of ['portal_sessions', 'domain_events', 'event_consumptions', 'event_failures', 'audit_log', 'notifications', 'job_runs']) {
    assert.ok(tables(db).includes(t), `manca ${t}`);
  }
  while (migrationStatus(db, migDir).filter(m => m.applied_at).length > 1) rollbackMigration(db, { dir: migDir, log: silent });
  assert.ok(!tables(db).includes('portal_sessions'), '0002 annullata');
  assert.throws(() => rollbackMigration(db, { dir: migDir, log: silent }), /baseline/);
});
