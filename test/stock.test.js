// Fase 3 — magazzino valorizzato: costo medio ponderato continuo, scarichi dai flussi (cassa, ritiri,
// B2B, degustazioni), storni, rettifiche, inventario, foglio dei costi, riconciliazione, eventi per Finance.
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

let seq = 0;
async function product(name, qty, extra = {}) {
  const sku = `SKU-${++seq}`;
  const id = (await t.api('POST', '/api/admin/products', { sku, name, vintage: '2023', ...extra })).data.id;
  if (qty !== null) assert.equal((await t.api('POST', '/api/admin/warehouse/finished', { product_id: id, quantity: qty, threshold: 0 })).status, 200);
  return id;
}
const wfQty = id => t.db.prepare('SELECT quantity FROM warehouse_finished WHERE product_id = ?').get(id)?.quantity;
const movements = id => t.db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id').all(id);
const last = id => movements(id).at(-1);
const load = (id, qty, cost) => t.api('POST', '/api/admin/stock/loads', { kind: 'carico_acquisto', product_id: id, quantity: qty, unit_cost: cost, doc_number: `F-${++seq}` });
const sale = (items, extra = {}) => t.api('POST', '/api/admin/shop-sales', { items, sale_context: 'negozio', payment_method: 'contanti', ...extra });

test('costo medio ponderato continuo: carichi, scarico proporzionale, azzeramento esatto, sotto zero', async () => {
  const p = await product('Montepulciano CMP', 0);
  await load(p, 10, '5,00');
  await load(p, 20, '8,00');
  let m = last(p);
  assert.deepEqual([m.balance_qty_milli, m.balance_value_cents], [30000, 21000]);
  assert.equal(t.stock.items().find(x => x.product_id === p).avg_cost_e4, 70000, 'medio 7,00 €');
  await sale([{ product_id: p, product_name: 'Montepulciano CMP', quantity: 7, unit_price_cents: 1500 }]);
  m = last(p);
  assert.deepEqual([m.kind, m.quantity_milli, m.value_cents, m.balance_value_cents], ['scarico_vendita', -7000, -4900, 16100]);
  // Tre carichi a costi che non si dividono bene: l'ultimo scarico porta via tutto il valore residuo.
  await load(p, 1, '3,3333');
  const bal = t.stock.balance({ productId: p });
  await sale([{ product_id: p, product_name: 'x', quantity: bal.qty / 1000, unit_price_cents: 1000 }]);
  m = last(p);
  assert.deepEqual([m.balance_qty_milli, m.balance_value_cents], [0, 0], 'a giacenza zero, valore zero al centesimo');
  const sum = movements(p).reduce((s, x) => s + x.value_cents, 0);
  assert.equal(sum, 0, 'il saldo è la somma esatta dei movimenti');
  // Vendita senza merce: ammessa, valorizzata all'ultimo costo medio, in anomalia.
  await sale([{ product_id: p, product_name: 'x', quantity: 2, unit_price_cents: 1000 }]);
  m = last(p);
  assert.equal(m.balance_qty_milli, -2000);
  assert.ok(m.value_cents < 0, 'anche sotto zero lo scarico ha un costo');
  assert.ok(t.stock.anomalies().negative.some(x => x.product_id === p));
  assert.equal(wfQty(p), -2, 'come oggi, la quantità può andare sotto zero');
});

test('vendita in cassa: scarico nella stessa transazione ed evento con il costo; annullo = storno, la vendita resta', async () => {
  const p = await product('Pecorino cassa', 12);
  const untracked = await product('Gadget non tracciato', null);
  await load(p, 12, '4,50'); // ora 24 a 2,25 € di media (12 aperti a costo zero + 12 a 4,50)
  const res = await sale([{ product_id: p, product_name: 'Pecorino', quantity: 2, unit_price_cents: 1200 }, { product_id: untracked, product_name: 'Gadget', quantity: 1, unit_price_cents: 500 }], { customer_email: 'cassa@x.it', customer_name: 'Cliente Cassa' });
  assert.equal(res.status, 200);
  assert.equal(wfQty(p), 22);
  assert.equal(movements(untracked).length, 0, 'i prodotti non tracciati restano fuori, come oggi');
  const out = last(p);
  assert.equal(out.value_cents, -450, '2 bottiglie × 2,25 €');
  const ev = t.db.prepare("SELECT payload FROM domain_events WHERE type = 'stock.issued' AND source_id = ?").get(out.id);
  const payload = JSON.parse(ev.payload);
  assert.deepEqual([payload.channel, payload.shop_sale_id, payload.value_cents, payload.revenue_cents], ['negozio', res.data.id, -450, 2400]);

  assert.equal((await t.api('DELETE', `/api/admin/shop-sales/${res.data.id}`, { reason: 'Errore di battitura' })).status, 200);
  const row = t.db.prepare('SELECT * FROM shop_sales WHERE id = ?').get(res.data.id);
  assert.ok(row.cancelled_at, 'la vendita resta, annullata');
  assert.equal(row.cancel_reason, 'Errore di battitura');
  assert.equal(wfQty(p), 24);
  const storno = last(p);
  assert.deepEqual([storno.quantity_milli, storno.value_cents, storno.reverses_id], [2000, 450, out.id], 'lo storno è l\'opposto esatto');
  assert.ok(t.db.prepare("SELECT 1 FROM domain_events WHERE type = 'stock.issue_reversed' AND source_id = ?").get(storno.id));
  assert.equal((await t.api('DELETE', `/api/admin/shop-sales/${res.data.id}`)).status, 409, 'non si annulla due volte');
  assert.ok((await t.api('GET', '/api/admin/shop-sales')).data.find(s => s.id === res.data.id).cancelled_at, 'nell\'elenco compare come annullata');
});

test('le vendite annullate non contano per il wine club', async () => {
  const p = await product('Rosato club', 50);
  await t.api('PUT', '/api/admin/wine-club/rule', { enabled: false, match: 'any', months: 12, shop: { enabled: true, min_eur: 30 }, visits: { enabled: false } });
  const before = (await t.api('GET', '/api/admin/wine-club/rule')).data.candidates;
  const s = await sale([{ product_id: p, product_name: 'Rosato', quantity: 4, unit_price_cents: 1000 }], { customer_email: 'club-annullo@x.it', customer_name: 'Cliente Club' });
  assert.equal((await t.api('GET', '/api/admin/wine-club/rule')).data.candidates, before + 1);
  await t.api('DELETE', `/api/admin/shop-sales/${s.data.id}`);
  assert.equal((await t.api('GET', '/api/admin/wine-club/rule')).data.candidates, before, 'annullata: la spesa non conta più');
});

test('ritiro online: impegno al pagamento (una volta sola), scarico al ritiro, rilascio se si elimina prima', async () => {
  const p = await product('Trebbiano ritiro', 10);
  const newOrder = qty => {
    const id = Number(t.db.prepare("INSERT INTO pickup_orders (customer_name, customer_email, status, amount_cents, pickup_token) VALUES ('Ritiro', 'r@x.it', 'in_attesa_pagamento', 3000, ?)").run(`tok-${++seq}`).lastInsertRowid);
    t.db.prepare('INSERT INTO pickup_order_items (order_id, product_id, product_name, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, 1000, ?)').run(id, p, 'Trebbiano', qty, qty * 1000);
    return id;
  };
  const o = newOrder(3);
  t.db.prepare("UPDATE pickup_orders SET status = 'da_ritirare' WHERE id = ?").run(o);
  t.stock.pickupReserved(o);
  t.stock.pickupReserved(o); // lo stesso evento consegnato due volte da Stripe
  assert.equal(wfQty(p), 7, 'disponibile sceso una volta sola');
  assert.equal(t.stock.balance({ productId: p }).qty, 10000, 'la giacenza del registro non scende finché non ritira');
  assert.equal(t.stock.items().find(x => x.product_id === p).difference_milli, 0, 'registro e quantità di oggi tornano (giacenza − impegni)');
  assert.equal((await t.api('POST', `/api/admin/pickup-orders/${o}/pickup`)).status, 200);
  const m = last(p);
  assert.deepEqual([m.kind, m.quantity_milli], ['scarico_vendita', -3000]);
  assert.equal(wfQty(p), 7, 'al ritiro la quantità di oggi non cambia di nuovo');
  assert.ok(JSON.parse(t.db.prepare("SELECT payload FROM domain_events WHERE type = 'stock.issued' AND source_id = ?").get(m.id).payload).pickup_order_id === o);

  const o2 = newOrder(2);
  t.db.prepare("UPDATE pickup_orders SET status = 'da_ritirare' WHERE id = ?").run(o2);
  t.stock.pickupReserved(o2);
  assert.equal(wfQty(p), 5);
  assert.equal((await t.api('DELETE', `/api/admin/pickup-orders/${o2}`)).status, 200);
  assert.equal(wfQty(p), 7, 'eliminato prima del ritiro: il disponibile torna');
  assert.equal(t.stock.items().find(x => x.product_id === p).difference_milli, 0);
});

test('ordine B2B evaso: scarico con cliente e agente, niente doppioni, storno se torna indietro; righe senza prodotto in anomalia', async () => {
  const p = await product('Cerasuolo B2B', 100);
  const customer = t.db.prepare("INSERT INTO customers (name) VALUES ('Enoteca Test')").run().lastInsertRowid;
  const orderId = Number(t.db.prepare("INSERT INTO orders (customer_id, status, channel) VALUES (?, 'nuovo', 'horeca')").run(customer).lastInsertRowid);
  t.db.prepare('INSERT INTO order_items (order_id, product_id, product_name_raw, quantity, unit_price_cents) VALUES (?, ?, ?, 12, 900)').run(orderId, p, 'Cerasuolo');
  t.db.prepare('INSERT INTO order_items (order_id, product_id, product_name_raw, quantity, unit_price_cents) VALUES (?, NULL, ?, 6, 900)').run(orderId, 'Vino misterioso da Excel');
  const status = s => t.api('PATCH', `/api/admin/orders/${orderId}`, { status: s });
  await status('in_lavorazione');
  assert.equal(wfQty(p), 100, 'in lavorazione non scarica');
  await status('evaso');
  assert.equal(wfQty(p), 88);
  const m = last(p);
  const payload = JSON.parse(t.db.prepare("SELECT payload FROM domain_events WHERE type = 'stock.issued' AND source_id = ?").get(m.id).payload);
  assert.deepEqual([payload.order_id, payload.customer_id, payload.channel, payload.revenue_cents], [orderId, Number(customer), 'horeca', 10800]);
  await status('evaso');
  assert.equal(wfQty(p), 88, 'di nuovo evaso: niente doppio scarico');
  assert.ok(t.stock.anomalies().unmatched_order_lines.some(l => l.order_id === orderId && l.product_name_raw === 'Vino misterioso da Excel'));
  await status('sospeso');
  assert.equal(wfQty(p), 100, 'tolto da evaso: storno');
  assert.equal(last(p).reverses_id, m.id);
  await status('evaso');
  assert.equal(wfQty(p), 88, 'rievaso: nuovo scarico');
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE order_item_id IS NOT NULL AND product_id = ? AND reverses_id IS NULL").get(p).c, 2);
});

test('modifica manuale della quantità: diventa una rettifica per la differenza, con il motivo', async () => {
  const p = await product('Passito rettifica', 20);
  const row = t.db.prepare('SELECT id FROM warehouse_finished WHERE product_id = ?').get(p).id;
  assert.equal((await t.api('PATCH', `/api/admin/warehouse/finished/${row}`, { quantity: 17, reason: 'Tre bottiglie rotte' })).status, 200);
  const m = last(p);
  assert.deepEqual([m.kind, m.quantity_milli, m.reason], ['rettifica_inventario', -3000, 'Tre bottiglie rotte']);
  assert.equal(wfQty(p), 17);
  assert.equal(t.stock.balance({ productId: p }).qty, 17000);
  await t.api('PATCH', `/api/admin/warehouse/finished/${row}`, { threshold: 5 });
  assert.equal(movements(p).length, 2, 'cambiare solo la soglia non crea movimenti');
});

test('inventario: la conferma crea le rettifiche per le differenze con la giacenza del momento', async () => {
  const a = await product('Inventario A', 30);
  const b = await product('Inventario B', 8);
  const c = (await t.api('POST', '/api/admin/stock/counts', { note: 'Fine vendemmia' })).data.id;
  assert.equal((await t.api('POST', '/api/admin/stock/counts', {})).status, 409, 'uno alla volta');
  const lines = (await t.api('GET', `/api/admin/stock/counts/${c}`)).data.lines;
  const la = lines.find(l => l.product_id === a), lb = lines.find(l => l.product_id === b);
  await t.api('PUT', `/api/admin/stock/counts/${c}/lines`, { lines: [{ id: la.id, counted: 28, reason: 'Cartone danneggiato' }, { id: lb.id, counted: 8 }] });
  await sale([{ product_id: a, product_name: 'A', quantity: 1, unit_price_cents: 1000 }]); // venduta dopo il conteggio iniziale
  const res = await t.api('POST', `/api/admin/stock/counts/${c}/confirm`);
  assert.equal(res.data.adjusted, 1);
  assert.deepEqual([last(a).kind, last(a).quantity_milli, last(a).reason], ['rettifica_inventario', -1000, 'Cartone danneggiato'], 'differenza rispetto a 29, non a 30');
  assert.equal(wfQty(a), 28);
  assert.equal(movements(b).length, 1, 'contato uguale: nessuna rettifica');
});

test('degustazione: al check-in si propone lo scarico (1 bottiglia ogni 6 ospiti), si conferma con la quantità vera, costo all\'esperienza', async () => {
  const p = await product('Rosso degustazione', 40);
  await load(p, 10, '6,00');
  await t.api('PUT', '/api/admin/experiences/1/products', { product_ids: [p] });
  const obj = (await t.api('POST', '/api/admin/finance/cost-objects', { type: 'esperienza', code: 'ESP-DEG', name: 'Visita classica', experience_id: 1 })).data.id;
  const slot = (await t.api('POST', '/api/admin/slots', { experience_id: 1, date: '2030-05-10', time: '11:00', capacity: 30 })).data.id;
  const booking = (await t.api('POST', '/api/admin/bookings/manual', { experience_id: 1, slot_id: slot, customer_name: 'Gruppo', email: 'gruppo@x.it', guests: 13, status: 'confermata' })).data.id;
  await t.api('POST', `/api/admin/bookings/checkin/${booking}`);
  const [line] = (await t.api('GET', '/api/admin/stock/tastings?status=proposta')).data.filter(x => x.booking_id === booking);
  assert.equal(line.suggested_milli, 3000, '13 ospiti → 3 bottiglie');
  assert.equal(movements(p).length, 2, 'la proposta non scarica da sola');
  assert.equal((await t.api('POST', `/api/admin/stock/tastings/${line.id}/confirm`, { quantity: 2 })).status, 200);
  const m = last(p);
  assert.deepEqual([m.kind, m.quantity_milli, m.cost_object_id, m.booking_id], ['scarico_degustazione', -2000, obj, booking]);
  assert.equal(wfQty(p), 48, '40 + 10 caricate − 2 in degustazione');
  assert.equal(JSON.parse(t.db.prepare("SELECT payload FROM domain_events WHERE type = 'stock.issued' AND source_id = ?").get(m.id).payload).channel, 'degustazione');
  assert.equal((await t.api('POST', `/api/admin/stock/tastings/${line.id}/confirm`, { quantity: 2 })).status, 409, 'confermata una volta sola');
  // Check-in tolto prima di confermare: la proposta sparisce.
  const b2 = (await t.api('POST', '/api/admin/bookings/manual', { experience_id: 1, slot_id: slot, customer_name: 'Coppia', email: 'coppia@x.it', guests: 2, status: 'confermata' })).data.id;
  await t.api('POST', `/api/admin/bookings/checkin/${b2}`);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM stock_tasting_lines WHERE booking_id = ?').get(b2).c, 1);
  await t.api('POST', `/api/admin/bookings/checkin/${b2}`);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM stock_tasting_lines WHERE booking_id = ?').get(b2).c, 0);
});

test('foglio dei costi: si scarica, si compila e ricaricandolo valorizza la giacenza di oggi', async () => {
  const p = await product('Riserva da valorizzare', 24);
  const raw = (await t.api('POST', '/api/admin/warehouse/raw', { name: 'Tappi sughero', quantity: 1000 })).data.id;
  const sheet = XLSX.read(t.stock.costSheet(), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(sheet.Sheets.Costi);
  const rp = rows.find(x => x.Tipo === 'Prodotto' && x.ID === p);
  assert.equal(rp.Giacenza, 24);
  rp['Nuovo costo unitario (€)'] = '7,25';
  const rr = rows.find(x => x.Tipo === 'Materia prima' && x.ID === raw);
  rr['Nuovo costo unitario (€)'] = 0.18;
  rows.push({ Tipo: 'Prodotto', ID: 999999, Nome: 'Inesistente', 'Nuovo costo unitario (€)': '3' });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Costi');
  const res = t.stock.importCosts(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'Test');
  assert.ok(res.done.some(d => d.name === 'Riserva da valorizzare'));
  assert.ok(res.skipped.some(s => s.name === 'Inesistente'));
  assert.deepEqual([last(p).kind, last(p).balance_value_cents], ['rivalutazione', 17400], '24 × 7,25 €');
  assert.equal(t.stock.balance({ rawItemId: raw }).value, 18000, '1000 tappi × 0,18 €');
  await sale([{ product_id: p, product_name: 'Riserva', quantity: 4, unit_price_cents: 2500 }]);
  assert.equal(last(p).value_cents, -2900, 'gli scarichi successivi escono al nuovo costo');
  assert.ok(!t.stock.anomalies().without_cost.some(x => x.product_id === p));
});

test('carichi e scarichi manuali: costo obbligatorio, motivo per gli omaggi, storno solo per i movimenti manuali', async () => {
  const p = await product('Spumante manuale', 0);
  assert.equal((await t.api('POST', '/api/admin/stock/loads', { kind: 'carico_produzione', product_id: p, quantity: 60 })).status, 400, 'costo obbligatorio');
  const l = await t.api('POST', '/api/admin/stock/loads', { kind: 'carico_produzione', product_id: p, quantity: 60, unit_cost: '4,1' });
  assert.equal(l.status, 200);
  assert.equal(wfQty(p), 60);
  assert.equal((await t.api('POST', '/api/admin/stock/issues', { kind: 'scarico_omaggio', product_id: p, quantity: 2 })).status, 400, 'motivo obbligatorio');
  const o = await t.api('POST', '/api/admin/stock/issues', { kind: 'scarico_omaggio', product_id: p, quantity: 2, reason: 'Omaggio a un buyer in fiera' });
  assert.equal(o.status, 200);
  assert.equal(wfQty(p), 58);
  const rev = await t.api('POST', `/api/admin/stock/movements/${o.data.id}/reverse`, { reason: 'Omaggio non consegnato' });
  assert.equal(rev.status, 200);
  assert.equal(wfQty(p), 60);
  const s = await sale([{ product_id: p, product_name: 'Spumante', quantity: 1, unit_price_cents: 1500 }]);
  const saleMove = last(p);
  assert.equal((await t.api('POST', `/api/admin/stock/movements/${saleMove.id}/reverse`, { reason: 'x' })).status, 409, 'si annulla dalla vendita');
  assert.ok(s.data.id);
  const val = (await t.api('GET', '/api/admin/stock/valuation')).data;
  assert.ok(val.items.some(x => x.product_id === p));
  assert.equal(val.total_cents, val.items.reduce((sum, x) => sum + x.balance_value_cents, 0));
});

test('riconciliazione notturna: registro e quantità di oggi coincidono; una modifica fuori registro viene segnalata', async () => {
  assert.deepEqual(t.stock.reconcile().map(d => d.name), [], 'dopo tutti i flussi dei test, nessuna differenza');
  const p = await product('Fuori registro', 10);
  t.db.prepare('UPDATE warehouse_finished SET quantity = 9 WHERE product_id = ?').run(p); // scrittura diretta, senza registro
  const diffs = t.stock.reconcile();
  assert.deepEqual(diffs.map(d => [d.name, d.difference_milli]), [['Fuori registro', -1000]]);
  assert.ok(t.db.prepare("SELECT 1 FROM notifications WHERE kind = 'stock.reconcile' AND user_id IS NULL").get());
  t.db.prepare('UPDATE warehouse_finished SET quantity = 10 WHERE product_id = ?').run(p);
});

test('prodotti e materie prime con movimenti non si eliminano', async () => {
  const p = await product('Da non eliminare', 5);
  assert.equal((await t.api('DELETE', `/api/admin/products/${p}`)).status, 409);
  const raw = (await t.api('POST', '/api/admin/warehouse/raw', { name: 'Capsule', quantity: 50 })).data.id;
  assert.equal((await t.api('DELETE', `/api/admin/warehouse/raw/${raw}`)).status, 409);
  const empty = (await t.api('POST', '/api/admin/warehouse/raw', { name: 'Etichette nuove', quantity: 0 })).data.id;
  assert.equal((await t.api('DELETE', `/api/admin/warehouse/raw/${empty}`)).status, 200, 'senza movimenti sì');
});
