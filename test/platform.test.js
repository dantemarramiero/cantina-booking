// Infrastruttura: eventi di dominio (outbox, idempotenza, errori), job periodici, notifiche.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

test('un evento emesso in una transazione annullata non esiste', () => {
  assert.throws(() => t.events.transaction(() => {
    t.events.emit('test.annullato', { payload: { x: 1 } });
    throw new Error('errore del documento');
  }));
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM domain_events WHERE type = 'test.annullato'").get().c, 0);
});

test('ogni consumer elabora un evento una sola volta, anche se il dispatch gira più volte', () => {
  const seen = [];
  t.events.on('test.creato', 'test.consumer_a', e => seen.push(['a', e.payload.n]));
  t.events.on('test.creato', 'test.consumer_b', e => seen.push(['b', e.payload.n]));
  t.events.transaction(() => { t.events.emit('test.creato', { sourceTable: 'x', sourceId: 1, payload: { n: 1 } }); });
  t.events.dispatch();
  t.events.dispatch();
  t.events.dispatch();
  assert.deepEqual(seen, [['a', 1], ['b', 1]]);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM event_consumptions WHERE consumer LIKE 'test.consumer_%'").get().c, 2);
});

test('se un consumer fallisce si annulla solo il suo lavoro e si riprova al giro dopo', () => {
  let attempts = 0;
  t.events.on('test.fragile', 'test.fragile_consumer', () => {
    attempts++;
    t.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(`test_fragile_${attempts}`, 'x');
    if (attempts === 1) throw new Error('servizio non disponibile');
  });
  const other = [];
  t.events.on('test.fragile', 'test.robusto', e => other.push(e.id));
  t.events.emit('test.fragile');
  t.events.dispatch();
  assert.equal(other.length, 1, 'l\'altro consumer non si blocca');
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM settings WHERE key = 'test_fragile_1'").get().c, 0, 'scrittura del tentativo fallito annullata');
  assert.equal(t.db.prepare("SELECT attempts FROM event_failures WHERE consumer = 'test.fragile_consumer'").get().attempts, 1);
  t.events.dispatch();
  assert.equal(attempts, 2);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM settings WHERE key = 'test_fragile_2'").get().c, 1);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM event_failures WHERE consumer = 'test.fragile_consumer'").get().c, 0);
});

test('un consumer può emettere altri eventi, elaborati nello stesso dispatch', () => {
  const chain = [];
  t.events.on('test.primo', 'test.primo_consumer', (e, { emit }) => { chain.push('primo'); emit('test.secondo'); });
  t.events.on('test.secondo', 'test.secondo_consumer', () => chain.push('secondo'));
  t.events.emit('test.primo');
  t.events.dispatch();
  assert.deepEqual(chain, ['primo', 'secondo']);
});

test('dispatch dentro una transazione aperta è un errore di programmazione', () => {
  assert.throws(() => t.events.transaction(() => t.events.dispatch()), /dopo il commit/);
});

test('i job girano quando sono scaduti e registrano l\'esito', () => {
  let runs = 0;
  t.scheduler.register('test.job', 60, () => { runs++; return 'fatto'; });
  const now = Date.now();
  assert.ok(t.scheduler.runDue(now).includes('test.job'));
  assert.ok(!t.scheduler.runDue(now + 30 * 60000).includes('test.job'), 'dopo 30 minuti non è ancora ora');
  assert.ok(t.scheduler.runDue(now + 61 * 60000).includes('test.job'), 'dopo un\'ora sì');
  assert.equal(runs, 2);
  assert.equal(t.db.prepare("SELECT detail FROM job_runs WHERE job = 'test.job' ORDER BY id DESC").get().detail, 'fatto');
});

test('un job fallito si riprova dopo 15 minuti, non a ogni tick', () => {
  t.scheduler.register('test.job_rotto', 24 * 60, () => { throw new Error('rotto'); });
  const count = () => t.db.prepare("SELECT COUNT(*) AS c FROM job_runs WHERE job = 'test.job_rotto'").get().c;
  const start = Date.now() + 10 * 24 * 60 * 60000; // nel futuro, lontano dagli altri test
  t.scheduler.runDue(start);
  assert.equal(count(), 1);
  const last = t.db.prepare("SELECT status, detail FROM job_runs WHERE job = 'test.job_rotto' ORDER BY id DESC").get();
  assert.deepEqual({ ...last }, { status: 'error', detail: 'rotto' });
  t.scheduler.runDue(start + 5 * 60000);
  assert.equal(count(), 1, 'dopo 5 minuti no');
  t.scheduler.runDue(start + 16 * 60000);
  assert.equal(count(), 2, 'dopo 15 minuti sì, anche se l\'intervallo normale è un giorno');
});

test('la pulizia delle sessioni scadute è un job registrato', () => {
  t.db.prepare(`INSERT INTO portal_sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
    VALUES ('scaduta', NULL, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2020-01-08T00:00:00.000Z')`).run();
  t.scheduler.runDue(Date.now() + 30 * 24 * 60 * 60000); // dopo tutti gli orari usati dagli altri test
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM portal_sessions WHERE token_hash = 'scaduta'").get().c, 0);
  assert.ok(t.db.prepare("SELECT 1 FROM job_runs WHERE job = 'sessions.cleanup' AND status = 'ok'").get());
});

test('notifiche: arrivano al destinatario giusto, senza doppioni, e si segnano come lette', async () => {
  t.notifications.notify({ kind: 'test', title: 'Scadenza vicina', dedupeKey: 'scad-1' });
  t.notifications.notify({ kind: 'test', title: 'Scadenza vicina', dedupeKey: 'scad-1' });
  t.notifications.notify({ userId: null, kind: 'test', title: 'Altro avviso' });
  let list = (await t.api('GET', '/api/admin/notifications')).data;
  assert.equal(list.unread, 2, 'il doppione non arriva');
  await t.api('POST', '/api/admin/notifications/read', { ids: [list.items[0].id] });
  list = (await t.api('GET', '/api/admin/notifications')).data;
  assert.equal(list.unread, 1);
  await t.api('POST', '/api/admin/notifications/read', {});
  assert.equal((await t.api('GET', '/api/admin/notifications?unread=1')).data.items.length, 0);
});
