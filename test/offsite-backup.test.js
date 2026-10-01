// Copia giornaliera su S3: firma delle richieste, caricamento del database e dei file, job asincrono.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');
const { startApp } = require('./helpers');
const { signV4, configFromEnv, createS3Client, createOffsiteBackup } = require('../lib/offsite-backup');

let t;
let s3; // finto S3: registra le PUT e risponde con lo stato in s3.status
test.before(async () => {
  t = await startApp();
  s3 = { puts: [], status: 200 };
  s3.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      s3.puts.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.statusCode = s3.status;
      res.end(s3.status === 200 ? '' : '<Error><Code>AccessDenied</Code></Error>');
    });
  });
  await new Promise(resolve => s3.server.listen(0, '127.0.0.1', resolve));
  s3.endpoint = `http://127.0.0.1:${s3.server.address().port}`;
});
test.after(async () => { await t.close(); await new Promise(resolve => s3.server.close(resolve)); });

const client = () => createS3Client({ bucket: 'cantina-backup', region: 'eu-south-1', accessKeyId: 'AKIDTEST', secretAccessKey: 'segreto', endpoint: s3.endpoint });

test('la firma V4 coincide con il caso di prova pubblicato da AWS (get-vanilla)', () => {
  const auth = signV4({
    method: 'GET', path: '/', query: '',
    headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
    payloadHash: crypto.createHash('sha256').update('').digest('hex'),
    region: 'us-east-1', service: 'service', amzDate: '20150830T123600Z',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  });
  assert.equal(auth, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});

test('senza S3_BUCKET la copia è spenta; con il bucket ma senza chiavi è un errore chiaro', () => {
  assert.equal(configFromEnv({}), null);
  assert.throws(() => configFromEnv({ S3_BUCKET: 'b' }), /AWS_ACCESS_KEY_ID/);
  assert.deepEqual(configFromEnv({ S3_BUCKET: 'b', AWS_REGION: 'eu-central-1', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's' }),
    { bucket: 'b', region: 'eu-central-1', accessKeyId: 'a', secretAccessKey: 's', prefix: 'cantina/', endpoint: null });
});

test('carica una copia leggibile del database e i file nuovi o cambiati, una volta sola', async () => {
  s3.puts.length = 0;
  const photo = path.join(t.dir, 'uploads', 'products', 'bottiglia uno.jpg');
  fs.mkdirSync(path.dirname(photo), { recursive: true });
  fs.writeFileSync(photo, 'JPG-1');
  const backup = createOffsiteBackup({ db: t.db, dataDir: t.dir, client: client(), prefix: 'cantina/' });

  const detail = await backup.run(new Date('2026-10-01T02:00:00Z'));
  assert.match(detail, /cantina\/db\/2026\/10\/cantina-20261001-020000\.db\.gz, \d+ file caricati/);
  const dbPut = s3.puts.find(p => p.url.includes('/db/'));
  assert.equal(dbPut.url, '/cantina-backup/cantina/db/2026/10/cantina-20261001-020000.db.gz');
  assert.match(dbPut.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/eu-south-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-server-side-encryption, Signature=[0-9a-f]{64}$/);
  assert.equal(dbPut.headers['x-amz-content-sha256'], crypto.createHash('sha256').update(dbPut.body).digest('hex'));
  assert.equal(dbPut.headers['x-amz-server-side-encryption'], 'AES256');

  // La copia è un database SQLite vero, con le tabelle dell'app.
  const restored = path.join(t.dir, 'ripristino.db');
  fs.writeFileSync(restored, zlib.gunzipSync(dbPut.body));
  const copy = new DatabaseSync(restored);
  assert.ok(copy.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get().c > 0);
  copy.close();

  const photoPut = s3.puts.find(p => p.url.endsWith('/files/uploads/products/bottiglia%20uno.jpg'));
  assert.ok(photoPut, 'la foto è caricata con il nome codificato');
  assert.equal(photoPut.body.toString(), 'JPG-1');

  // Il giorno dopo: solo il database, la foto non è cambiata.
  s3.puts.length = 0;
  await backup.run(new Date('2026-10-02T02:00:00Z'));
  assert.deepEqual(s3.puts.map(p => p.url.includes('/db/') ? 'db' : p.url), ['db']);

  // Foto sostituita: si ricarica.
  s3.puts.length = 0;
  fs.writeFileSync(photo, 'JPG-2-più-lunga');
  await backup.run(new Date('2026-10-03T02:00:00Z'));
  assert.equal(s3.puts.find(p => p.url.includes('bottiglia')).body.toString(), 'JPG-2-più-lunga');
});

test('un rifiuto di S3 fa fallire il job con il codice di errore, registrato in job_runs', async () => {
  s3.status = 403;
  try {
    const backup = createOffsiteBackup({ db: t.db, dataDir: t.dir, client: client(), prefix: '' });
    let settle;
    const done = new Promise(resolve => { settle = resolve; });
    t.scheduler.register('test.offsite', 24 * 60, () => backup.run().finally(() => setImmediate(settle)));
    assert.ok(t.scheduler.runDue(Date.now() + 20 * 24 * 60 * 60000).includes('test.offsite'));
    assert.equal(t.db.prepare("SELECT status FROM job_runs WHERE job = 'test.offsite'").get().status, 'running');
    await done;
    const run = t.db.prepare("SELECT status, detail FROM job_runs WHERE job = 'test.offsite'").get();
    assert.equal(run.status, 'error');
    assert.match(run.detail, /^S3 403 AccessDenied su db\/\d{4}\/\d{2}\/cantina-\d{8}-\d{6}\.db\.gz$/);
  } finally {
    s3.status = 200;
  }
});

test('un job asincrono riuscito passa da running a ok con il suo dettaglio', async () => {
  t.scheduler.register('test.async_ok', 24 * 60, () => Promise.resolve('fatto dopo'));
  t.scheduler.runDue(Date.now() + 30 * 24 * 60 * 60000);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual({ ...t.db.prepare("SELECT status, detail FROM job_runs WHERE job = 'test.async_ok'").get() }, { status: 'ok', detail: 'fatto dopo' });
});
