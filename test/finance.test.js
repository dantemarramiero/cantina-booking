// Fase 1 — Finance: centri di costo, regole, driver, costi diretti, cascata per periodo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const P = '2030-03';
const centers = async () => (await t.api('GET', '/api/admin/finance/cost-centers')).data;
const idOf = async code => (await centers()).find(c => c.code === code).id;
const cost = (code, amount, extra = {}) => idOf(code).then(id => t.api('POST', '/api/admin/finance/direct-costs', { entry_date: `${P}-15`, cost_center_id: id, nature: 'servizi', amount, ...extra }));

test('la struttura di partenza ha i quattro livelli, e gli aggregati non ricevono costi', async () => {
  const cs = await centers();
  assert.ok(cs.length >= 20);
  const levels = new Set(cs.filter(c => c.is_leaf).map(c => c.cascade_level));
  assert.deepEqual([...levels].sort(), [1, 2, 3, 4]);
  const agg = cs.find(c => c.code === 'G');
  assert.equal(agg.is_leaf, false);
  const r = await t.api('POST', '/api/admin/finance/direct-costs', { entry_date: `${P}-01`, cost_center_id: agg.id, nature: 'servizi', amount: '10' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /aggregato/);
});

test('QUANDO si imputa a un centro disattivato o fuori validità ALLORA rifiuto', async () => {
  const c = await t.api('POST', '/api/admin/finance/cost-centers', { code: 'C99', name: 'Prova', parent_id: await idOf('C'), cascade_level: 4, valid_from: '2031-01-01' });
  assert.equal(c.status, 200);
  const early = await t.api('POST', '/api/admin/finance/direct-costs', { entry_date: `${P}-01`, cost_center_id: c.data.id, nature: 'altro', amount: '5' });
  assert.match(early.data.error, /non è valido alla data/);
  await t.api('PATCH', `/api/admin/finance/cost-centers/${c.data.id}`, { active: 0, valid_from: null });
  const off = await t.api('POST', '/api/admin/finance/direct-costs', { entry_date: `${P}-01`, cost_center_id: c.data.id, nature: 'altro', amount: '5' });
  assert.match(off.data.error, /disattivato/);
});

test('regole: niente destinazioni dello stesso livello o precedenti, percentuali al 100%, niente sovrapposizioni', async () => {
  const back = await t.api('POST', '/api/admin/finance/rules', { source_center_id: await idOf('P02'), valid_from: P, targets: [{ target_center_id: await idOf('A01'), share: '100' }] });
  assert.equal(back.status, 400);
  assert.match(back.data.error, /livello successivo/);
  const not100 = await t.api('POST', '/api/admin/finance/rules', { source_center_id: await idOf('G01'), valid_from: P, targets: [{ target_center_id: await idOf('A01'), share: '60' }, { target_center_id: await idOf('C01'), share: '30' }] });
  assert.match(not100.data.error, /100%/);
  const objFromG = await t.api('POST', '/api/admin/finance/cost-objects', { type: 'progetto', code: 'PSR-TEST', name: 'Progetto' });
  const bad = await t.api('POST', '/api/admin/finance/rules', { source_center_id: await idOf('G02'), valid_from: P, targets: [{ target_cost_object_id: objFromG.data.id, share: '100' }] });
  assert.match(bad.data.error, /produttivi e commerciali/);
  const ok = await t.api('POST', '/api/admin/finance/rules', { source_center_id: await idOf('G02'), valid_from: '2029-01', valid_to: '2029-12', targets: [{ target_center_id: await idOf('C01'), share: '100' }] });
  assert.equal(ok.status, 200);
  const overlap = await t.api('POST', '/api/admin/finance/rules', { source_center_id: await idOf('G02'), valid_from: '2029-06', targets: [{ target_center_id: await idOf('C02'), share: '100' }] });
  assert.equal(overlap.status, 409);
});

test('cascata completa: anomalie, conferma, saldo zero, quadratura, blocco del periodo, riesecuzione idempotente', async () => {
  const sku = (await t.api('POST', '/api/admin/finance/cost-objects', { type: 'sku', code: 'SKU-INFERI', name: 'Inferi' })).data.id;
  const oreMacchina = (await t.api('GET', '/api/admin/finance/drivers')).data.find(d => d.code === 'ore_macchina').id;
  assert.equal((await cost('G01', '1000,01')).status, 200);
  assert.equal((await cost('A02', '500')).status, 200);
  assert.equal((await cost('C01', '12,34', { cost_object_id: sku })).status, 200);
  const g01 = await t.api('POST', '/api/admin/finance/rules', { source_center_id: await idOf('G01'), valid_from: '2030-01', targets: [
    { target_center_id: await idOf('A02'), share: '40' }, { target_center_id: await idOf('P02'), share: '30' }, { target_center_id: await idOf('C01'), share: '30' }] });
  assert.equal(g01.status, 200, JSON.stringify(g01.data));
  const a02 = await t.api('POST', '/api/admin/finance/rules', { source_center_id: await idOf('A02'), driver_id: oreMacchina, valid_from: '2030-01', targets: [{ target_center_id: await idOf('P02') }, { target_center_id: await idOf('P04') }] });
  assert.equal(a02.status, 200);
  assert.equal((await t.api('POST', '/api/admin/finance/rules', { source_center_id: await idOf('P02'), valid_from: '2030-01', targets: [{ target_cost_object_id: sku, share: '100' }] })).status, 200);

  // Senza i valori del driver: anomalia bloccante, niente conferma.
  let sim = (await t.api('POST', `/api/admin/finance/cascade/${P}/simulate`)).data;
  assert.equal(sim.blocking, true);
  assert.ok(sim.anomalies.some(a => /manca il valore del driver «Ore macchina»/.test(a.message)));
  const refused = await t.api('POST', `/api/admin/finance/cascade/${P}/confirm`);
  assert.equal(refused.status, 422);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM allocation_runs').get().c, 0, 'la simulazione e il rifiuto non scrivono');

  // I valori del driver arrivano dalla pagina dei driver.
  const dv = (await t.api('GET', `/api/admin/finance/driver-values?period=${P}&driver_id=${oreMacchina}`)).data;
  assert.equal(dv.rows.length, 2, 'le destinazioni della regola sono già elencate');
  assert.equal((await t.api('PUT', '/api/admin/finance/driver-values', { period: P, driver_id: oreMacchina, values: dv.rows.map((r, i) => ({ target_center_id: r.target_center_id, quantity: i === 0 ? '120,5' : '40' })) })).status, 200);

  sim = (await t.api('POST', `/api/admin/finance/cascade/${P}/simulate`)).data;
  assert.equal(sim.blocking, false, JSON.stringify(sim.anomalies));
  const row = code => sim.centers.find(c => c.code === code);
  for (const code of ['G01', 'A02', 'P02']) assert.equal(row(code).final, 0, `${code} chiude a zero`);
  assert.equal(sim.totals.direct, 100001 + 50000 + 1234);
  assert.equal(sim.totals.remaining_on_centers + sim.totals.on_objects, sim.totals.direct, 'quadratura al centesimo');
  const bySource = src => sim.entries.filter(e => e.source_label.startsWith(src)).reduce((s, e) => s + e.amount_cents, 0);
  assert.equal(bySource('G01'), 100001);
  assert.equal(bySource('A02'), 50000 + row('A02').received[1], 'il saldo ribaltato comprende le quote ricevute');
  assert.equal(row('P').direct, 0);
  assert.equal(row('P').full_cost, row('P02').full_cost + row('P04').full_cost + row('P03').full_cost + row('P101').full_cost, 'l\'aggregato somma i suoi sotto-centri');
  const skuRow = sim.objects.find(o => o.code === 'SKU-INFERI');
  assert.equal(skuRow.direct, 1234);
  assert.equal(skuRow.total, 1234 + row('P02').full_cost);

  const conf = await t.api('POST', `/api/admin/finance/cascade/${P}/confirm`);
  assert.equal(conf.status, 200, JSON.stringify(conf.data));
  assert.deepEqual(conf.data.totals, sim.totals);
  assert.equal((await t.api('POST', `/api/admin/finance/cascade/${P}/confirm`)).status, 409, 'una sola cascata confermata per periodo');
  const view = (await t.api('GET', `/api/admin/finance/cascade/${P}`)).data;
  assert.equal(view.confirmed.id, conf.data.run_id);
  assert.deepEqual(view.confirmed.totals, sim.totals);
  assert.equal(view.confirmed.centers.find(c => c.code === 'P').full_cost, row('P').full_cost, 'il report salvato non somma due volte gli aggregati');
  assert.equal(view.confirmed.entries.length, sim.entries.length);

  // Periodo confermato: i dati non si toccano più finché non si annulla.
  assert.equal((await cost('G01', '1')).status, 409);
  assert.equal((await t.api('PUT', '/api/admin/finance/driver-values', { period: P, driver_id: oreMacchina, values: [] })).status, 409);
  const rulePatch = await t.api('PATCH', `/api/admin/finance/rules/${g01.data.id}`, { targets: [{ target_center_id: await idOf('C01'), share: '100' }] });
  assert.equal(rulePatch.status, 409, 'una regola usata si chiude, non si cambia');
  assert.equal((await t.api('DELETE', `/api/admin/finance/rules/${g01.data.id}`)).status, 409);
  assert.equal((await t.api('PATCH', `/api/admin/finance/rules/${g01.data.id}`, { valid_to: '2030-02' })).status, 409, 'non si chiude prima dell\'ultimo uso');

  // Riesegui due volte: stesso risultato, sempre una sola cascata confermata.
  const r1 = await t.api('POST', `/api/admin/finance/cascade/${P}/rerun`);
  const r2 = await t.api('POST', `/api/admin/finance/cascade/${P}/rerun`);
  assert.deepEqual(r1.data.totals, sim.totals);
  assert.deepEqual(r2.data.totals, sim.totals);
  assert.equal(r2.data.previous_run_id, r1.data.run_id);
  const runs = t.db.prepare('SELECT status, COUNT(*) AS c FROM allocation_runs WHERE period = ? GROUP BY status').all(P);
  assert.deepEqual(Object.fromEntries(runs.map(r => [r.status, r.c])), { annullata: 2, confermata: 1 });

  // Annulla: il periodo si riapre.
  assert.equal((await t.api('POST', `/api/admin/finance/cascade/${P}/cancel`)).status, 200);
  assert.equal((await t.api('GET', `/api/admin/finance/cascade/${P}`)).data.confirmed, null);
  assert.equal((await cost('G01', '1')).status, 200);

  // Eventi e registro attività.
  const ev = t.db.prepare("SELECT type, COUNT(*) AS c FROM domain_events WHERE type LIKE 'allocation.%' GROUP BY type").all();
  assert.deepEqual(Object.fromEntries(ev.map(e => [e.type, e.c])), { 'allocation.run_confirmed': 3, 'allocation.run_cancelled': 3 });
  const actions = new Set((await t.api('GET', '/api/admin/audit-log?limit=500')).data.map(a => a.action));
  for (const a of ['cascade.confirmed', 'cascade.rerun', 'cascade.cancelled', 'allocation_rule.created', 'direct_cost.created']) assert.ok(actions.has(a), `manca ${a}`);
});

test('un centro con movimenti non si elimina e non diventa un aggregato; l\'albero non ha cicli', async () => {
  const g01 = await idOf('G01');
  assert.equal((await t.api('DELETE', `/api/admin/finance/cost-centers/${g01}`)).status, 409);
  assert.equal((await t.api('PATCH', `/api/admin/finance/cost-centers/${g01}`, { active: 0 })).status, 200, 'si disattiva');
  await t.api('PATCH', `/api/admin/finance/cost-centers/${g01}`, { active: 1 });
  const child = await t.api('POST', '/api/admin/finance/cost-centers', { code: 'G01A', name: 'Sotto direzione', parent_id: g01, cascade_level: 1 });
  assert.equal(child.status, 409);
  const gAgg = await idOf('G');
  const cycle = await t.api('PATCH', `/api/admin/finance/cost-centers/${gAgg}`, { parent_id: await idOf('G02') });
  assert.equal(cycle.status, 400);
  const fresh = await t.api('POST', '/api/admin/finance/cost-centers', { code: 'X1', name: 'Senza movimenti', cascade_level: 4 });
  assert.equal((await t.api('DELETE', `/api/admin/finance/cost-centers/${fresh.data.id}`)).status, 200);
});

test('oggetti di costo collegati: eliminare una fiera funziona come prima, l\'oggetto resta', async () => {
  const fair = await t.api('POST', '/api/admin/fairs', { name: 'Vinitaly Test', start_date: '2030-04-10' });
  assert.equal(fair.status, 200, JSON.stringify(fair.data));
  const obj = await t.api('POST', '/api/admin/finance/cost-objects', { type: 'fiera', code: 'FIERA-VIN', name: 'Vinitaly', fair_id: fair.data.id });
  assert.equal(obj.status, 200);
  assert.equal((await t.api('DELETE', `/api/admin/fairs/${fair.data.id}`)).status, 200);
  const o = (await t.api('GET', '/api/admin/finance/cost-objects')).data.find(x => x.code === 'FIERA-VIN');
  assert.equal(o.fair_id, null);
  const wrongType = await t.api('POST', '/api/admin/finance/cost-objects', { type: 'sku', code: 'SKU-X', name: 'X', fair_id: 999 });
  assert.equal(wrongType.status, 200, 'il collegamento a una fiera su uno SKU viene ignorato');
});

test('permessi: Finance solo col suo workspace, People legge solo l\'elenco dei centri', async () => {
  const mkUser = async (username, workspaces) => {
    const role = (await t.api('POST', '/api/admin/roles', { name: `R ${username}`, workspaces })).data.id;
    await t.api('POST', '/api/admin/portal-users', { name: username, email: `${username}@x.it`, username, password: 'password-lunga', role_id: role });
    return (await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } })).data.key;
  };
  const people = await mkUser('solo-people', ['people']);
  const as = token => p => t.request('GET', p, { token }).then(r => r.status);
  assert.equal(await as(people)('/api/admin/finance/cost-centers'), 200);
  assert.equal(await as(people)('/api/admin/finance/rules'), 403);
  assert.equal(await as(people)(`/api/admin/finance/direct-costs?period=${P}`), 403);
  const fin = await mkUser('solo-finance', ['finance']);
  assert.equal(await as(fin)('/api/admin/finance/rules'), 200);
  assert.equal(await as(fin)('/api/admin/hr/employees'), 403);
});
