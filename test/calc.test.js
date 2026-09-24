// Unit test dei calcoli: ripartizioni al centesimo, decimali esatti, calendario, cascata.
const test = require('node:test');
const assert = require('node:assert/strict');
const { allocate, sharePpm, parseDecimal, formatDecimal, PPM } = require('../lib/money');
const { easterSunday, holidaysForYear, weekday } = require('../lib/calendar');
const { computeCascade, validateRuleTargets } = require('../lib/cascade');

test('allocate: le quote sommano sempre al totale, il resto va all\'ultima', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [33, 33, 34]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-33, -33, -34], 'anche con importi negativi (storni)');
  assert.deepEqual(allocate(1, [1, 1]), [0, 1]);
  assert.deepEqual(allocate(0, [5, 7]), [0, 0]);
  for (let i = 0; i < 200; i++) {
    const total = Math.floor(Math.random() * 1e11) - 1e10;
    const weights = Array.from({ length: 1 + Math.floor(Math.random() * 7) }, () => Math.floor(Math.random() * 1e12));
    if (weights.every(w => w === 0)) weights[0] = 1;
    assert.equal(allocate(total, weights).reduce((s, x) => s + x, 0), total);
  }
  assert.throws(() => allocate(100, [0, 0]), /positiva/);
  assert.throws(() => allocate(100, [1.5]), /interi/);
});

test('allocate non perde precisione con importi e pesi grandi (BigInt)', () => {
  const parts = allocate(9_000_000_000_000, [999_999_999_999, 1]);
  assert.equal(parts[0] + parts[1], 9_000_000_000_000);
  assert.equal(parts[1], 9_000_000_000_000 - parts[0]);
});

test('sharePpm arrotonda al più vicino', () => {
  assert.equal(sharePpm(1, 3), 333333);
  assert.equal(sharePpm(2, 3), 666667);
  assert.equal(sharePpm(5, 5), PPM);
});

test('parseDecimal: decimali esatti, niente float, niente arrotondamenti silenziosi', () => {
  assert.equal(parseDecimal('23,4567', 4), 234567);
  assert.equal(parseDecimal('23.45', 4), 234500);
  assert.equal(parseDecimal(12, 2), 1200);
  assert.equal(parseDecimal('0,1', 2), 10);
  assert.equal(parseDecimal('', 2), null);
  assert.throws(() => parseDecimal('1,23456', 4), /Troppi decimali/);
  assert.throws(() => parseDecimal('-5', 2), /negativo/);
  assert.equal(parseDecimal('-5', 2, { allowNegative: true }), -500);
  assert.throws(() => parseDecimal('12a', 2), /non valido/);
  assert.equal(formatDecimal(234567, 4), '23.4567');
  assert.equal(formatDecimal(-5, 2), '-0.05');
});

test('calendario: Pasqua e Pasquetta calcolate, patrono di sede, festività nazionali', () => {
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
  const h = holidaysForYear(2026, {
    entries: [{ site_id: null, month_day: '12-25', name: 'Natale' }, { site_id: 1, date: '2026-08-14', name: 'Chiusura estiva' }, { site_id: 1, date: '2027-08-14', name: 'Altro anno' }],
    patronDay: '10-10', patronName: 'San Cetteo',
  });
  const byDate = Object.fromEntries(h.map(x => [x.date, x]));
  assert.equal(byDate['2026-04-06'].name, "Lunedì dell'Angelo");
  assert.equal(byDate['2026-10-10'].kind, 'patrono');
  assert.equal(byDate['2026-12-25'].kind, 'nazionale');
  assert.equal(byDate['2026-08-14'].kind, 'sede');
  assert.ok(!byDate['2027-08-14'], 'le date di un altro anno non entrano');
  assert.equal(weekday('2026-09-28'), 1, 'lunedì = 1');
  assert.equal(weekday('2026-09-27'), 7, 'domenica = 7');
});

// Centri di prova: G1 generale, A1 ausiliario, P1/P2 produttivi, C1 commerciale, più un aggregato.
const centers = [
  { id: 1, code: 'G01', name: 'Direzione', cascade_level: 1, cascade_order: 0, active: 1, is_leaf: true },
  { id: 2, code: 'A01', name: 'Manutenzione', cascade_level: 2, cascade_order: 0, active: 1, is_leaf: true },
  { id: 3, code: 'P01', name: 'Vinificazione', cascade_level: 3, cascade_order: 0, active: 1, is_leaf: true },
  { id: 4, code: 'P02', name: 'Imbottigliamento', cascade_level: 3, cascade_order: 1, active: 1, is_leaf: true },
  { id: 5, code: 'C01', name: 'Horeca', cascade_level: 4, cascade_order: 0, active: 1, is_leaf: true },
  { id: 6, code: 'P', name: 'Produttivi', cascade_level: null, cascade_order: 0, active: 1, is_leaf: false },
];
const objects = [{ id: 100, code: 'SKU-1', name: 'Inferi', status: 'aperto' }];
const drivers = [{ id: 10, code: 'ore_macchina', name: 'Ore macchina', unit: 'ore' }];

test('cascata: ogni centro ribaltato chiude a zero e il totale quadra al centesimo', () => {
  const r = computeCascade({
    centers, objects, drivers,
    rules: [
      { id: 1, source_center_id: 1, driver_id: null, targets: [{ target_center_id: 2, share_ppm: 333333 }, { target_center_id: 3, share_ppm: 333333 }, { target_center_id: 5, share_ppm: 333334 }] },
      { id: 2, source_center_id: 2, driver_id: 10, targets: [{ target_center_id: 3 }, { target_center_id: 4 }] },
      { id: 3, source_center_id: 3, driver_id: null, targets: [{ target_cost_object_id: 100, share_ppm: PPM }] },
    ],
    driverValues: [{ driver_id: 10, target_center_id: 3, quantity_milli: 7000 }, { driver_id: 10, target_center_id: 4, quantity_milli: 3000 }],
    directCosts: [
      { cost_center_id: 1, amount_cents: 100001 }, { cost_center_id: 2, amount_cents: 5000 },
      { cost_center_id: 3, amount_cents: 20000 }, { cost_center_id: 5, cost_object_id: 100, amount_cents: 999 },
    ],
  });
  assert.equal(r.blocking, false, JSON.stringify(r.anomalies));
  const row = code => r.centers.find(c => c.code === code);
  for (const code of ['G01', 'A01', 'P01']) assert.equal(row(code).final, 0, `${code} chiude a zero`);
  assert.equal(r.totals.direct, 126000);
  assert.equal(r.totals.remaining_on_centers + r.totals.on_objects, r.totals.direct, 'conservazione al centesimo');
  // G01: 100001 in tre quote → 33333 + 33333 + 33335 (resto all'ultima)
  const g = r.entries.filter(e => e.source_center_id === 1).map(e => e.amount_cents);
  assert.deepEqual(g, [33333, 33333, 33335]);
  // A01 riceve 33333 + 5000 = 38333 e lo divide 70/30 con il driver
  const a = r.entries.filter(e => e.source_center_id === 2);
  assert.deepEqual(a.map(e => e.amount_cents), [26833, 11500]);
  assert.deepEqual(a.map(e => e.base_quantity_milli), [7000, 3000]);
  assert.equal(row('P01').full_cost, 20000 + 33333 + 26833, 'costo pieno = diretto + quote ricevute per livello');
  assert.deepEqual(row('P01').received, { 1: 33333, 2: 26833, 3: 0 });
  const sku = r.objects.find(o => o.code === 'SKU-1');
  assert.equal(sku.total, 999 + 20000 + 33333 + 26833);
  assert.equal(row('P02').final, 11500, 'un produttivo senza regola tiene il suo costo');
  assert.deepEqual(r.entries.map(e => e.step), [1, 1, 1, 2, 2, 3], 'ordine: livello, poi ordine, poi codice');
});

test('cascata: driver mancante o a zero blocca il centro, senza quote silenziose', () => {
  const base = {
    centers, objects, drivers,
    rules: [{ id: 2, source_center_id: 2, driver_id: 10, targets: [{ target_center_id: 3 }, { target_center_id: 4 }] }],
    directCosts: [{ cost_center_id: 2, amount_cents: 5000 }],
  };
  const missing = computeCascade({ ...base, driverValues: [{ driver_id: 10, target_center_id: 3, quantity_milli: 5 }] });
  assert.equal(missing.blocking, true);
  assert.match(missing.anomalies[0].message, /manca il valore del driver «Ore macchina» per P02/);
  assert.equal(missing.entries.length, 0);
  assert.equal(missing.centers.find(c => c.code === 'A01').final, 5000, 'il costo resta sul centro');
  const zero = computeCascade({ ...base, driverValues: [{ driver_id: 10, target_center_id: 3, quantity_milli: 0 }, { driver_id: 10, target_center_id: 4, quantity_milli: 0 }] });
  assert.match(zero.anomalies[0].message, /vale zero/);
});

test('cascata: un generale o ausiliario con costi e senza regola è un\'anomalia bloccante', () => {
  const r = computeCascade({ centers, objects, drivers, rules: [], directCosts: [{ cost_center_id: 1, amount_cents: 100 }, { cost_center_id: 5, amount_cents: 50 }] });
  assert.equal(r.blocking, true);
  assert.equal(r.anomalies.length, 1, 'il commerciale senza regola va bene: è finale');
  assert.equal(r.anomalies[0].code, 'non_ribaltato');
});

test('cascata: percentuali fisse che non fanno 100% bloccano', () => {
  const r = computeCascade({ centers, objects, drivers, rules: [{ id: 1, source_center_id: 1, driver_id: null, targets: [{ target_center_id: 2, share_ppm: 500000 }, { target_center_id: 3, share_ppm: 400000 }] }], directCosts: [{ cost_center_id: 1, amount_cents: 100 }] });
  assert.match(r.anomalies[0].message, /90%/);
});

test('regole: solo verso livelli successivi (niente cicli), solo foglie, oggetti solo da produttivi/commerciali', () => {
  const byId = new Map(centers.map(c => [c.id, c]));
  assert.deepEqual(validateRuleTargets(byId.get(1), [{ target_center_id: 2 }, { target_center_id: 5 }], byId), []);
  assert.match(validateRuleTargets(byId.get(3), [{ target_center_id: 2 }], byId).join(), /livello successivo/, 'un produttivo non torna a un ausiliario');
  assert.match(validateRuleTargets(byId.get(3), [{ target_center_id: 4 }], byId).join(), /livello successivo/, 'nemmeno allo stesso livello');
  assert.match(validateRuleTargets(byId.get(1), [{ target_center_id: 6 }], byId).join(), /foglie/, 'un aggregato non riceve costi');
  assert.match(validateRuleTargets(byId.get(2), [{ target_cost_object_id: 100 }], byId).join(), /produttivi e commerciali/);
  assert.deepEqual(validateRuleTargets(byId.get(3), [{ target_cost_object_id: 100 }], byId), []);
  assert.match(validateRuleTargets(byId.get(1), [{ target_center_id: 2 }, { target_center_id: 2 }], byId).join(), /due volte/);
});
