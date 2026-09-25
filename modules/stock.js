// Magazzino valorizzato (Fase 3): registro dei movimenti a costo medio ponderato continuo.
//   - move(): l'unico punto che cambia una giacenza. Scrive il movimento con la fotografia del saldo
//     (quantità e valore) e, durante la transizione, aggiorna anche warehouse_finished / warehouse_raw;
//   - valore della giacenza tenuto per articolo: uno scarico porta via una quota proporzionale del
//     valore e, quando la giacenza si azzera, tutto il resto (i conti quadrano al centesimo);
//   - idempotenza con idem_key (lo stesso documento non muove due volte), storni al posto delle cancellazioni;
//   - eventi stock.issued / stock.issue_reversed / stock.received / stock.adjusted per Finance;
//   - impegni dei ritiri online, inventari, proposte di scarico in degustazione, foglio dei costi,
//     riconciliazione notturna tra registro e quantità di oggi.
const XLSX = require('xlsx');
const multer = require('multer');
const { HttpError, createRouter } = require('../lib/http');

const LOADS = ['apertura', 'carico_acquisto', 'carico_produzione'];
const ISSUES = ['scarico_vendita', 'scarico_degustazione', 'scarico_omaggio', 'consumo_produzione'];
const KIND_LABELS = {
  apertura: 'Apertura', carico_acquisto: 'Carico da acquisto', carico_produzione: 'Carico da produzione', scarico_vendita: 'Scarico per vendita',
  scarico_degustazione: 'Scarico per degustazione', scarico_omaggio: 'Omaggio', consumo_produzione: 'Consumo in produzione',
  rettifica_inventario: 'Rettifica inventariale', trasferimento: 'Trasferimento', rivalutazione: 'Valorizzazione',
};
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const text = v => (v == null ? null : String(v).trim() || null);
const intOrNull = v => (v === '' || v == null ? null : parseInt(v));
// Arrotondamento al più vicino, metà lontano da zero, su BigInt.
function divRound(n, d) {
  const neg = (n < 0n) !== (d < 0n);
  const a = n < 0n ? -n : n, b = d < 0n ? -d : d;
  const q = (a + b / 2n) / b;
  return Number(neg ? -q : q);
}
// quantità (millesimi) × costo unitario (€ × 10.000) → centesimi
const valueOf = (qtyMilli, costE4) => divRound(BigInt(qtyMilli) * BigInt(costE4), 100000n);
// valore (centesimi) ÷ quantità (millesimi) → costo unitario (€ × 10.000)
const costOf = (valueCents, qtyMilli) => (qtyMilli ? divRound(BigInt(valueCents) * 100000n, BigInt(qtyMilli)) : 0);
// "12,5" / "12.5" → millesimi; interi per bottiglie e pezzi
function milli(v, label = 'Quantità') {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!/^-?\d+(\.\d{1,3})?$/.test(s)) throw new HttpError(400, `${label} non valida.`);
  return Math.round(Number(s) * 1000);
}
function costE4(v) {
  if (v === '' || v == null) return null;
  const s = String(v).trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(s)) throw new HttpError(400, `Costo non valido: ${v} (fino a 4 decimali).`);
  const [i, f = ''] = s.split('.');
  return Number(i) * 10000 + Number(f.padEnd(4, '0'));
}

module.exports = function registerStock(app, deps) {
  const { db, authAdmin, audit, events, notifications, scheduler, getSetting, checkStockThreshold, roleUsers } = deps;
  const r = createRouter(app, '/api/admin/stock', authAdmin);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  const actor = req => (req?.portalUser ? req.portalUser.name : req?.isMasterKey ? 'Chiave master' : 'Sistema');
  const locationId = () => db.prepare("SELECT id FROM stock_locations WHERE code = 'cantina'").get().id;
  const lastOf = ({ productId, rawItemId }) => db.prepare(`SELECT * FROM stock_movements WHERE ${productId ? 'product_id' : 'raw_item_id'} = ? ORDER BY id DESC LIMIT 1`).get(productId || rawItemId) || null;
  const balance = item => { const l = lastOf(item); return { qty: l?.balance_qty_milli ?? 0, value: l?.balance_value_cents ?? 0 }; };
  const tracked = productId => !!db.prepare('SELECT 1 FROM warehouse_finished WHERE product_id = ?').get(productId);
  // Ultimo costo medio conosciuto (per valorizzare uno scarico quando la giacenza è a zero o sotto).
  function lastAvg(item) {
    const row = db.prepare(`SELECT balance_qty_milli, balance_value_cents, unit_cost_e4, quantity_milli FROM stock_movements WHERE ${item.productId ? 'product_id' : 'raw_item_id'} = ?
      AND (balance_qty_milli > 0 OR (quantity_milli > 0 AND unit_cost_e4 > 0)) ORDER BY id DESC LIMIT 1`).get(item.productId || item.rawItemId);
    if (!row) return 0;
    return row.balance_qty_milli > 0 ? costOf(row.balance_value_cents, row.balance_qty_milli) : row.unit_cost_e4;
  }

  // Avvisi di scorta: dopo la transazione (mandano email), una volta per articolo toccato.
  let pendingChecks = new Map();
  let depth = 0;
  function tx(fn) {
    depth++;
    let result;
    try { result = events.transaction(fn); } catch (e) { if (depth === 1) pendingChecks = new Map(); throw e; } finally { depth--; }
    // Fuori da ogni transazione: avvisi di scorta ed eventi partono adesso. Dentro una transazione di chi
    // ci ha chiamato (es. un consumer) ci pensa lui a fine giro.
    if (depth === 0 && !events.inTransaction()) {
      const checks = [...pendingChecks.values()];
      pendingChecks = new Map();
      for (const c of checks) checkStockThreshold(c).catch(console.error);
      events.dispatch();
    }
    return result;
  }
  function syncWarehouse(item, deltaMilli) {
    const units = Math.round(deltaMilli / 1000);
    if (item.productId) {
      const wf = db.prepare('SELECT wf.*, p.name AS product_name FROM warehouse_finished wf JOIN products p ON p.id = wf.product_id WHERE wf.product_id = ?').get(item.productId);
      if (!wf) return;
      const q = wf.quantity + units;
      db.prepare("UPDATE warehouse_finished SET quantity = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(q, wf.id);
      pendingChecks.set(`f${wf.id}`, { table: 'warehouse_finished', id: wf.id, name: wf.product_name, quantity: q, threshold: wf.threshold, alertEmail: wf.alert_email, defaultEmailKey: 'commercial_alert_email', kind: 'finished' });
    } else {
      const w = db.prepare('SELECT * FROM warehouse_raw WHERE id = ?').get(item.rawItemId);
      if (!w) return;
      const q = w.quantity + units;
      db.prepare("UPDATE warehouse_raw SET quantity = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(q, w.id);
      pendingChecks.set(`r${w.id}`, { table: 'warehouse_raw', id: w.id, name: w.name, quantity: q, threshold: w.threshold, alertEmail: w.alert_email, defaultEmailKey: 'procurement_alert_email', kind: 'raw' });
    }
  }

  // ── Il movimento ────────────────────────────────────────────────────────────
  // qtyMilli con segno. Carichi: costo indicato (o l'ultimo medio). Scarichi e rettifiche in meno: quota
  // proporzionale del valore. Rivalutazione: quantità zero, valore indicato. Storno: l'opposto esatto.
  function move({ productId = null, rawItemId = null, kind, qtyMilli, unitCostE4 = null, valueCents = null, source = {}, costObjectId = null, reason = null, label = null,
    idemKey = null, reversesId = null, by = 'Sistema', sync = true, context = {} }) {
    const item = { productId, rawItemId };
    if (!productId === !rawItemId) throw new HttpError(400, 'Indica un prodotto oppure una materia prima.');
    if (!KIND_LABELS[kind]) throw new HttpError(400, 'Tipo di movimento non valido.');
    if (!qtyMilli && kind !== 'rivalutazione') throw new HttpError(400, 'Quantità zero.');
    return tx(() => {
      if (idemKey) {
        const done = db.prepare('SELECT * FROM stock_movements WHERE idem_key = ?').get(idemKey);
        if (done) return done; // già registrato: lo stesso evento non muove due volte
      }
      const bal = balance(item);
      let value;
      if (reversesId) {
        const orig = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(reversesId);
        value = -orig.value_cents;
      } else if (kind === 'rivalutazione') value = valueCents;
      else if (qtyMilli > 0) {
        const cost = unitCostE4 ?? lastAvg(item);
        value = valueOf(qtyMilli, cost);
      } else {
        const out = -qtyMilli;
        if (bal.qty > 0 && out <= bal.qty) value = -(out === bal.qty ? bal.value : divRound(BigInt(bal.value) * BigInt(out), BigInt(bal.qty)));
        else {
          const avg = bal.qty > 0 ? costOf(bal.value, bal.qty) : lastAvg(item);
          value = -((bal.qty > 0 ? bal.value : 0) + valueOf(out - Math.max(bal.qty, 0), avg));
        }
      }
      const unit = kind === 'rivalutazione' ? (unitCostE4 ?? 0) : costOf(Math.abs(value), Math.abs(qtyMilli));
      const id = Number(db.prepare(`INSERT INTO stock_movements (product_id, raw_item_id, location_id, occurred_on, kind, quantity_milli, unit_cost_e4, value_cents, balance_qty_milli, balance_value_cents,
        shop_sale_item_id, pickup_order_item_id, order_item_id, booking_id, tasting_line_id, stock_count_line_id, supplier_id, doc_number, doc_date, cost_object_id, reverses_id,
        idem_key, source_label, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(productId, rawItemId, locationId(), today(), kind, qtyMilli, unit, value, bal.qty + qtyMilli, bal.value + value,
          source.shopSaleItemId ?? null, source.pickupOrderItemId ?? null, source.orderItemId ?? null, source.bookingId ?? null, source.tastingLineId ?? null, source.stockCountLineId ?? null,
          source.supplierId ?? null, source.docNumber ?? null, source.docDate ?? null, costObjectId, reversesId, idemKey, label, reason, now(), by).lastInsertRowid);
      if (sync && qtyMilli) syncWarehouse(item, qtyMilli);
      const payload = { movement_id: id, product_id: productId, raw_item_id: rawItemId, kind, quantity_milli: qtyMilli, value_cents: value, unit_cost_e4: unit, cost_object_id: costObjectId, ...context };
      const type = reversesId ? 'stock.issue_reversed' : ISSUES.includes(kind) ? 'stock.issued' : LOADS.includes(kind) ? 'stock.received' : 'stock.adjusted';
      events.emit(type, { sourceTable: 'stock_movements', sourceId: id, payload });
      return db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(id);
    });
  }
  // Storna tutti i movimenti non ancora stornati che rispondono al filtro (es. le righe di una vendita).
  function reverseWhere(where, params, { by, reason, sync = true, context = {} }) {
    const rows = db.prepare(`SELECT m.* FROM stock_movements m WHERE ${where} AND m.reverses_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM stock_movements x WHERE x.reverses_id = m.id)`).all(...params);
    return rows.map(m => move({ productId: m.product_id, rawItemId: m.raw_item_id, kind: m.kind, qtyMilli: -m.quantity_milli, reversesId: m.id, by, reason, sync,
      label: `Storno: ${m.source_label || KIND_LABELS[m.kind]}`, idemKey: `storno:${m.id}`, context,
      source: { shopSaleItemId: m.shop_sale_item_id, pickupOrderItemId: m.pickup_order_item_id, orderItemId: m.order_item_id, bookingId: m.booking_id } }));
  }

  // ── Punti di aggancio dei flussi esistenti (chiamati da server.js) ───────────
  // Vendita in cassa: uno scarico per riga con prodotto tracciato.
  function saleIssued(saleId, by) {
    const sale = db.prepare('SELECT * FROM shop_sales WHERE id = ?').get(saleId);
    for (const it of db.prepare('SELECT * FROM shop_sale_items WHERE sale_id = ?').all(saleId)) {
      if (!it.product_id || !tracked(it.product_id)) continue;
      move({ productId: it.product_id, kind: 'scarico_vendita', qtyMilli: -it.quantity * 1000, source: { shopSaleItemId: it.id }, idemKey: `vendita:${it.id}`, by,
        label: `Vendita in cassa n. ${saleId}`, context: { channel: sale.sale_context, shop_sale_id: saleId, person_id: sale.person_id, revenue_cents: it.line_total_cents } });
    }
  }
  function saleCancelled(saleId, by, reason) {
    reverseWhere('m.shop_sale_item_id IN (SELECT id FROM shop_sale_items WHERE sale_id = ?)', [saleId], { by, reason, context: { shop_sale_id: saleId } });
  }
  // Ritiro online pagato: impegno (il disponibile scende come oggi, la giacenza del registro no).
  function pickupReserved(orderId) {
    tx(() => {
      for (const it of db.prepare('SELECT * FROM pickup_order_items WHERE order_id = ?').all(orderId)) {
        if (!it.product_id || !tracked(it.product_id)) continue;
        const res = db.prepare('INSERT OR IGNORE INTO stock_reservations (product_id, pickup_order_item_id, quantity_milli, created_at) VALUES (?, ?, ?, ?)').run(it.product_id, it.id, it.quantity * 1000, now());
        if (res.changes) syncWarehouse({ productId: it.product_id }, -it.quantity * 1000);
      }
    });
  }
  // Ritirato: lo scarico valorizzato (la quantità di oggi era già scesa con l'impegno).
  function pickupCollected(orderId, by) {
    tx(() => {
      const order = db.prepare('SELECT * FROM pickup_orders WHERE id = ?').get(orderId);
      for (const it of db.prepare('SELECT * FROM pickup_order_items WHERE order_id = ?').all(orderId)) {
        const resv = db.prepare('SELECT * FROM stock_reservations WHERE pickup_order_item_id = ? AND released_at IS NULL AND consumed_at IS NULL').get(it.id);
        if (!resv) continue;
        const m = move({ productId: it.product_id, kind: 'scarico_vendita', qtyMilli: -resv.quantity_milli, source: { pickupOrderItemId: it.id }, idemKey: `ritiro:${it.id}`, by, sync: false,
          label: `Ritiro online n. ${orderId}`, context: { channel: 'ritiro_online', pickup_order_id: orderId, person_id: order?.person_id, revenue_cents: it.line_total_cents } });
        db.prepare('UPDATE stock_reservations SET consumed_at = ?, consumed_movement_id = ? WHERE id = ?').run(now(), m.id, resv.id);
      }
    });
  }
  // Ritiro eliminato prima del ritiro: l'impegno si libera e il disponibile torna.
  function pickupReleased(orderId) {
    tx(() => {
      for (const resv of db.prepare(`SELECT r.* FROM stock_reservations r JOIN pickup_order_items i ON i.id = r.pickup_order_item_id WHERE i.order_id = ? AND r.released_at IS NULL AND r.consumed_at IS NULL`).all(orderId)) {
        db.prepare('UPDATE stock_reservations SET released_at = ? WHERE id = ?').run(now(), resv.id);
        syncWarehouse({ productId: resv.product_id }, resv.quantity_milli);
      }
    });
  }
  // Ordine B2B evaso: uno scarico per riga con prodotto; tolto da evaso: storno. Le righe senza prodotto
  // restano fuori e compaiono tra le anomalie.
  function orderStatusChanged(orderId, from, to, by) {
    if (from === to || (from !== 'evaso' && to !== 'evaso')) return;
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    tx(() => {
      if (to === 'evaso') {
        for (const it of db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId)) {
          if (!it.product_id) { db.prepare('INSERT OR IGNORE INTO stock_unmatched_lines (order_item_id, order_id, detected_at) VALUES (?, ?, ?)').run(it.id, orderId, now()); continue; }
          if (!tracked(it.product_id)) continue;
          const cycle = db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE order_item_id = ? AND kind = 'scarico_vendita' AND reverses_id IS NULL").get(it.id).c;
          move({ productId: it.product_id, kind: 'scarico_vendita', qtyMilli: -it.quantity * 1000, source: { orderItemId: it.id }, idemKey: `ordine:${it.id}:${cycle}`, by,
            label: `Ordine B2B n. ${orderId}`, context: { channel: order?.channel || 'b2b', order_id: orderId, customer_id: order?.customer_id, agent_id: order?.agent_id, revenue_cents: it.quantity * (it.unit_price_cents || 0) } });
        }
      } else {
        reverseWhere('m.order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)', [orderId], { by, reason: `Ordine tolto da «evaso» (ora «${to}»)`, context: { order_id: orderId } });
      }
    });
  }
  // Modifica manuale della quantità in Magazzino: diventa una rettifica per la differenza.
  function manualSet(item, newQty, by, reason) {
    const current = item.productId ? db.prepare('SELECT quantity FROM warehouse_finished WHERE product_id = ?').get(item.productId)?.quantity
      : db.prepare('SELECT quantity FROM warehouse_raw WHERE id = ?').get(item.rawItemId)?.quantity;
    const delta = (newQty - (current ?? 0)) * 1000;
    if (!delta) return null;
    return move({ ...item, kind: 'rettifica_inventario', qtyMilli: delta, by, reason: reason || 'Modifica manuale della quantità', label: 'Modifica in Magazzino' });
  }
  function opening(item, qty, by) {
    if (!qty) return null;
    return move({ ...item, kind: 'apertura', qtyMilli: qty * 1000, unitCostE4: 0, by, sync: false, label: 'Nuovo articolo in magazzino' }); // la riga di magazzino ha già la quantità
  }
  const hasMovements = item => !!lastOf(item);

  // Check-in di una prenotazione: proposta di scarico dei vini in degustazione (1 bottiglia ogni N ospiti).
  function tastingProposed(bookingId) {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!b) return 0;
    let n = 0;
    for (const ep of db.prepare('SELECT * FROM experience_products WHERE experience_id = ?').all(b.experience_id)) {
      if (!tracked(ep.product_id)) continue;
      const bottles = Math.max(1, Math.ceil((b.guests || 1) / (ep.guests_per_bottle || 6)));
      n += db.prepare('INSERT OR IGNORE INTO stock_tasting_lines (booking_id, product_id, suggested_milli, created_at) VALUES (?, ?, ?, ?)').run(b.id, ep.product_id, bottles * 1000, now()).changes;
    }
    return n;
  }
  function tastingWithdrawn(bookingId) {
    db.prepare("DELETE FROM stock_tasting_lines WHERE booking_id = ? AND status = 'proposta'").run(bookingId);
  }

  // ── Letture ─────────────────────────────────────────────────────────────────
  const reservedOf = productId => db.prepare('SELECT COALESCE(SUM(quantity_milli), 0) AS q FROM stock_reservations WHERE product_id = ? AND released_at IS NULL AND consumed_at IS NULL').get(productId).q;
  function items() {
    const out = [];
    for (const p of db.prepare('SELECT wf.product_id, wf.quantity, wf.threshold, p.name, p.sku, p.vintage FROM warehouse_finished wf JOIN products p ON p.id = wf.product_id ORDER BY p.name, p.vintage').all()) {
      const b = balance({ productId: p.product_id });
      const reserved = reservedOf(p.product_id);
      out.push({ kind: 'prodotto', product_id: p.product_id, name: p.name, sku: p.sku, vintage: p.vintage, qty_milli: b.qty, value_cents: b.value, avg_cost_e4: b.qty > 0 ? costOf(b.value, b.qty) : 0,
        reserved_milli: reserved, available_milli: b.qty - reserved, warehouse_qty: p.quantity, difference_milli: p.quantity * 1000 - (b.qty - reserved), threshold: p.threshold });
    }
    for (const w of db.prepare('SELECT * FROM warehouse_raw ORDER BY name').all()) {
      const b = balance({ rawItemId: w.id });
      out.push({ kind: 'materia', raw_item_id: w.id, name: w.name, sku: w.sku, unit: w.unit, qty_milli: b.qty, value_cents: b.value, avg_cost_e4: b.qty > 0 ? costOf(b.value, b.qty) : 0,
        reserved_milli: 0, available_milli: b.qty, warehouse_qty: w.quantity, difference_milli: w.quantity * 1000 - b.qty, threshold: w.threshold });
    }
    return out;
  }
  r.get('/items', () => items());
  r.get('/movements', req => {
    const q = req.query;
    return db.prepare(`SELECT m.*, p.name AS product_name, p.vintage, w.name AS raw_name, s.name AS supplier_name, co.code AS cost_object_code, co.name AS cost_object_name
      FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id LEFT JOIN warehouse_raw w ON w.id = m.raw_item_id LEFT JOIN suppliers s ON s.id = m.supplier_id
      LEFT JOIN cost_objects co ON co.id = m.cost_object_id
      WHERE (? IS NULL OR m.product_id = ?) AND (? IS NULL OR m.raw_item_id = ?) AND (? IS NULL OR m.kind = ?) AND (? IS NULL OR m.occurred_on >= ?) AND (? IS NULL OR m.occurred_on <= ?)
      ORDER BY m.id DESC LIMIT 500`).all(q.product_id || null, q.product_id || null, q.raw_item_id || null, q.raw_item_id || null, q.kind || null, q.kind || null, q.from || null, q.from || null, q.to || null, q.to || null)
      .map(m => ({ ...m, kind_label: KIND_LABELS[m.kind] }));
  });
  // Valore delle rimanenze a una data: il saldo dell'ultimo movimento entro quella data, per articolo.
  function valuation(date = today()) {
    const rows = db.prepare(`SELECT m.product_id, m.raw_item_id, m.balance_qty_milli, m.balance_value_cents, p.name AS product_name, p.vintage, w.name AS raw_name
      FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id LEFT JOIN warehouse_raw w ON w.id = m.raw_item_id
      WHERE m.id IN (SELECT MAX(id) FROM stock_movements WHERE occurred_on <= ? GROUP BY product_id, raw_item_id)`).all(date);
    const list = rows.map(x => ({ ...x, name: x.product_name ? `${x.product_name}${x.vintage ? ` ${x.vintage}` : ''}` : x.raw_name, avg_cost_e4: x.balance_qty_milli > 0 ? costOf(x.balance_value_cents, x.balance_qty_milli) : 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { date, items: list, total_cents: list.reduce((s, x) => s + x.balance_value_cents, 0) };
  }
  r.get('/valuation', req => valuation(req.query.date || today()));
  // Anomalie: giacenze sotto zero, articoli con giacenza ma senza valore, righe B2B evase senza prodotto, differenze.
  function anomalies() {
    const it = items();
    return {
      negative: it.filter(x => x.qty_milli < 0),
      without_cost: it.filter(x => x.qty_milli > 0 && x.value_cents === 0),
      differences: it.filter(x => x.difference_milli !== 0),
      unmatched_order_lines: db.prepare(`SELECT oi.id, oi.order_id, oi.product_name_raw, oi.quantity, o.status, o.order_number, u.detected_at FROM stock_unmatched_lines u
        JOIN order_items oi ON oi.id = u.order_item_id JOIN orders o ON o.id = oi.order_id WHERE oi.product_id IS NULL AND o.status = 'evaso' ORDER BY u.detected_at DESC LIMIT 200`).all(),
    };
  }
  r.get('/anomalies', () => anomalies());

  // ── Carichi, scarichi manuali, storni ───────────────────────────────────────
  const itemFrom = b => {
    const productId = intOrNull(b.product_id), rawItemId = intOrNull(b.raw_item_id);
    if (!productId === !rawItemId) throw new HttpError(400, 'Scegli un prodotto oppure una materia prima.');
    if (productId && !tracked(productId)) throw new HttpError(400, 'Il prodotto non è tracciato in magazzino: aggiungilo in Magazzino → Prodotti finiti.');
    if (rawItemId && !db.prepare('SELECT 1 FROM warehouse_raw WHERE id = ?').get(rawItemId)) throw new HttpError(400, 'Materia prima non trovata.');
    return { productId, rawItemId };
  };
  r.post('/loads', req => {
    const b = req.body || {};
    if (!['carico_acquisto', 'carico_produzione'].includes(b.kind)) throw new HttpError(400, 'Tipo di carico: acquisto oppure produzione.');
    const item = itemFrom(b);
    const q = milli(b.quantity);
    if (q <= 0) throw new HttpError(400, 'La quantità del carico è maggiore di zero.');
    const cost = costE4(b.unit_cost);
    if (cost == null) throw new HttpError(400, 'Indica il costo unitario (anche 0 se ancora da definire).');
    if (b.supplier_id && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(b.supplier_id)) throw new HttpError(400, 'Fornitore non trovato.');
    const m = move({ ...item, kind: b.kind, qtyMilli: q, unitCostE4: cost, by: actor(req), reason: text(b.note),
      source: { supplierId: intOrNull(b.supplier_id), docNumber: text(b.doc_number), docDate: text(b.doc_date) }, costObjectId: intOrNull(b.cost_object_id),
      label: b.kind === 'carico_acquisto' ? `Acquisto${b.doc_number ? ` doc. ${text(b.doc_number)}` : ''}` : `Produzione${b.note ? `: ${text(b.note)}` : ''}` });
    audit(req, 'stock.loaded', { entity: 'stock_movement', entityId: m.id, after: { kind: b.kind, quantity_milli: q, unit_cost_e4: cost } });
    return { success: true, id: m.id };
  });
  r.post('/issues', req => {
    const b = req.body || {};
    if (!['scarico_omaggio', 'scarico_degustazione', 'consumo_produzione'].includes(b.kind)) throw new HttpError(400, 'Tipo di scarico non valido.');
    const item = itemFrom(b);
    const q = milli(b.quantity);
    if (q <= 0) throw new HttpError(400, 'La quantità è maggiore di zero.');
    const reason = text(b.reason);
    if (!reason) throw new HttpError(400, 'Scrivi il motivo (es. omaggio al cliente Rossi, bottiglia rotta in degustazione).');
    const m = move({ ...item, kind: b.kind, qtyMilli: -q, by: actor(req), reason, costObjectId: intOrNull(b.cost_object_id), label: KIND_LABELS[b.kind], context: { channel: b.kind === 'scarico_omaggio' ? 'omaggio' : b.kind } });
    audit(req, 'stock.issued_manual', { entity: 'stock_movement', entityId: m.id, after: { kind: b.kind, quantity_milli: q } });
    return { success: true, id: m.id };
  });
  // Storno di un movimento inserito a mano (quelli dei documenti si stornano dal documento).
  r.post('/movements/:id/reverse', req => {
    const m = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(req.params.id);
    if (!m) throw new HttpError(404, 'Movimento non trovato.');
    if (m.reverses_id || db.prepare('SELECT 1 FROM stock_movements WHERE reverses_id = ?').get(m.id)) throw new HttpError(409, 'Movimento già stornato o è esso stesso uno storno.');
    if (m.shop_sale_item_id || m.pickup_order_item_id || m.order_item_id || m.tasting_line_id || m.stock_count_line_id || m.kind === 'apertura')
      throw new HttpError(409, 'Questo movimento viene da un documento: si annulla dal documento (vendita, ordine, ritiro, degustazione o inventario).');
    const reason = text(req.body?.reason);
    if (!reason) throw new HttpError(400, 'Scrivi il motivo dello storno.');
    const s = reverseWhere('m.id = ?', [m.id], { by: actor(req), reason })[0];
    audit(req, 'stock.reversed', { entity: 'stock_movement', entityId: m.id, after: { reversal_id: s.id, reason } });
    return { success: true, id: s.id };
  });

  // ── Degustazioni: proposte dal check-in, confermate con le quantità vere ────
  r.get('/tastings', req => db.prepare(`SELECT t.*, p.name AS product_name, p.vintage, b.customer_name, b.guests, s.date, s.time, e.name_it AS experience_name, b.experience_id
    FROM stock_tasting_lines t JOIN products p ON p.id = t.product_id JOIN bookings b ON b.id = t.booking_id JOIN slots s ON s.id = b.slot_id JOIN experiences e ON e.id = b.experience_id
    WHERE (? IS NULL OR t.status = ?) ORDER BY s.date DESC, s.time DESC, t.id LIMIT 300`).all(req.query.status || null, req.query.status || null));
  r.post('/tastings/:id/confirm', req => {
    const t = db.prepare('SELECT * FROM stock_tasting_lines WHERE id = ?').get(req.params.id);
    if (!t) throw new HttpError(404, 'Proposta non trovata.');
    if (t.status !== 'proposta') throw new HttpError(409, 'Proposta già decisa.');
    const q = req.body?.quantity !== undefined && req.body.quantity !== '' ? milli(req.body.quantity) : t.suggested_milli;
    if (q < 0) throw new HttpError(400, 'Quantità non valida.');
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(t.booking_id);
    // Il costo va all'esperienza, se c'è il suo oggetto di costo.
    const obj = db.prepare("SELECT id FROM cost_objects WHERE type = 'esperienza' AND experience_id = ? AND status = 'aperto' ORDER BY id LIMIT 1").get(b.experience_id);
    tx(() => {
      let movementId = null;
      if (q > 0) movementId = move({ productId: t.product_id, kind: 'scarico_degustazione', qtyMilli: -q, source: { bookingId: b.id, tastingLineId: t.id }, costObjectId: obj?.id ?? null,
        idemKey: `degustazione:${t.id}`, by: actor(req), label: `Degustazione prenotazione n. ${b.id}`, context: { channel: 'degustazione', booking_id: b.id, experience_id: b.experience_id } }).id;
      db.prepare("UPDATE stock_tasting_lines SET status = 'confermata', confirmed_milli = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(q, now(), actor(req), t.id);
      return movementId;
    });
    return { success: true };
  });
  r.post('/tastings/:id/dismiss', req => {
    const t = db.prepare('SELECT * FROM stock_tasting_lines WHERE id = ?').get(req.params.id);
    if (!t) throw new HttpError(404, 'Proposta non trovata.');
    if (t.status !== 'proposta') throw new HttpError(409, 'Proposta già decisa.');
    db.prepare("UPDATE stock_tasting_lines SET status = 'scartata', decided_at = ?, decided_by = ? WHERE id = ?").run(now(), actor(req), t.id);
    return { success: true };
  });

  // ── Inventario ──────────────────────────────────────────────────────────────
  const countOf = id => {
    const c = db.prepare('SELECT * FROM stock_counts WHERE id = ?').get(id);
    if (!c) throw new HttpError(404, 'Inventario non trovato.');
    return c;
  };
  r.get('/counts', () => db.prepare('SELECT c.*, (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.id) AS lines FROM stock_counts c ORDER BY c.id DESC LIMIT 50').all());
  r.get('/counts/:id', req => {
    const c = countOf(req.params.id);
    const lines = db.prepare(`SELECT l.*, p.name AS product_name, p.vintage, w.name AS raw_name FROM stock_count_lines l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN warehouse_raw w ON w.id = l.raw_item_id
      WHERE l.count_id = ? ORDER BY COALESCE(p.name, w.name)`).all(c.id)
      .map(l => ({ ...l, current_milli: balance({ productId: l.product_id, rawItemId: l.raw_item_id }).qty }));
    return { ...c, lines };
  });
  r.post('/counts', req => {
    const b = req.body || {};
    if (db.prepare("SELECT 1 FROM stock_counts WHERE status = 'bozza'").get()) throw new HttpError(409, 'C\'è già un inventario in corso: concludilo o annullalo.');
    const id = tx(() => {
      const cid = Number(db.prepare("INSERT INTO stock_counts (location_id, counted_on, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)").run(locationId(), text(b.counted_on) || today(), text(b.note), now(), actor(req)).lastInsertRowid);
      const ins = db.prepare('INSERT INTO stock_count_lines (count_id, product_id, raw_item_id, expected_qty_milli) VALUES (?, ?, ?, ?)');
      for (const x of items()) ins.run(cid, x.product_id ?? null, x.raw_item_id ?? null, x.qty_milli);
      return cid;
    });
    audit(req, 'stock.count_started', { entity: 'stock_count', entityId: id });
    return { success: true, id };
  });
  r.put('/counts/:id/lines', req => {
    const c = countOf(req.params.id);
    if (c.status !== 'bozza') throw new HttpError(409, 'Inventario già concluso.');
    const upd = db.prepare('UPDATE stock_count_lines SET counted_qty_milli = ?, reason = ? WHERE id = ? AND count_id = ?');
    tx(() => { for (const l of req.body?.lines || []) upd.run(l.counted === '' || l.counted == null ? null : milli(l.counted, 'Quantità contata'), text(l.reason), l.id, c.id); });
    return { success: true };
  });
  // Conferma: per ogni riga contata, la rettifica per la differenza con la giacenza di questo momento.
  r.post('/counts/:id/confirm', req => {
    const c = countOf(req.params.id);
    if (c.status !== 'bozza') throw new HttpError(409, 'Inventario già concluso.');
    const lines = db.prepare('SELECT * FROM stock_count_lines WHERE count_id = ? AND counted_qty_milli IS NOT NULL').all(c.id);
    if (!lines.length) throw new HttpError(400, 'Nessuna quantità contata.');
    let adjusted = 0;
    tx(() => {
      for (const l of lines) {
        const item = { productId: l.product_id, rawItemId: l.raw_item_id };
        const cur = balance(item).qty - (l.product_id ? reservedOf(l.product_id) : 0);
        const delta = l.counted_qty_milli - cur;
        db.prepare('UPDATE stock_count_lines SET expected_qty_milli = ? WHERE id = ?').run(cur, l.id);
        if (!delta) continue;
        move({ ...item, kind: 'rettifica_inventario', qtyMilli: delta, source: { stockCountLineId: l.id }, idemKey: `inventario:${l.id}`, by: actor(req),
          reason: l.reason || 'Differenza d\'inventario', label: `Inventario del ${c.counted_on.split('-').reverse().join('/')}` });
        adjusted++;
      }
      db.prepare("UPDATE stock_counts SET status = 'confermato', confirmed_at = ?, confirmed_by = ? WHERE id = ?").run(now(), actor(req), c.id);
    });
    audit(req, 'stock.count_confirmed', { entity: 'stock_count', entityId: c.id, after: { adjusted } });
    return { success: true, adjusted };
  });
  r.post('/counts/:id/cancel', req => {
    const c = countOf(req.params.id);
    if (c.status !== 'bozza') throw new HttpError(409, 'Inventario già concluso.');
    db.prepare("UPDATE stock_counts SET status = 'annullato' WHERE id = ?").run(c.id);
    return { success: true };
  });

  // ── Foglio dei costi (Excel): scarica, compila, ricarica ────────────────────
  // Ricaricandolo, ogni costo compilato valorizza la giacenza di oggi con una "rivalutazione":
  // valore = quantità × costo; il movimento porta la differenza, così il registro resta una somma esatta.
  function costSheet() {
    const rows = items().map(x => ({
      Tipo: x.kind === 'prodotto' ? 'Prodotto' : 'Materia prima', ID: x.product_id ?? x.raw_item_id, Codice: x.sku || '', Nome: x.name, Annata: x.vintage || '',
      Giacenza: x.qty_milli / 1000, 'Costo unitario attuale (€)': x.avg_cost_e4 / 10000, 'Nuovo costo unitario (€)': '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 12 }, { wch: 36 }, { wch: 8 }, { wch: 10 }, { wch: 22 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Costi');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
  r.get('/cost-sheet', (req, res) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="costi-magazzino-${today()}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(costSheet());
  });
  function importCosts(buffer, by) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const done = [], skipped = [];
    tx(() => {
      for (const [i, row] of rows.entries()) {
        const raw = row['Nuovo costo unitario (€)'];
        if (raw === '' || raw == null) continue;
        const kind = String(row.Tipo).toLowerCase().startsWith('materia') ? 'materia' : 'prodotto';
        const id = parseInt(row.ID);
        const item = kind === 'prodotto' ? { productId: id } : { rawItemId: id };
        const name = row.Nome || `riga ${i + 2}`;
        if (!id || (kind === 'prodotto' ? !tracked(id) : !db.prepare('SELECT 1 FROM warehouse_raw WHERE id = ?').get(id))) { skipped.push({ row: i + 2, name, reason: 'Articolo non trovato in magazzino.' }); continue; }
        let cost;
        try { cost = typeof raw === 'number' ? Math.round(raw * 10000) : costE4(raw); } catch (e) { skipped.push({ row: i + 2, name, reason: e.message }); continue; }
        if (cost < 0) { skipped.push({ row: i + 2, name, reason: 'Costo negativo.' }); continue; }
        const b = balance(item);
        if (b.qty <= 0) { skipped.push({ row: i + 2, name, reason: 'Giacenza zero: il costo entrerà con il prossimo carico.' }); continue; }
        const delta = valueOf(b.qty, cost) - b.value;
        if (!delta) { skipped.push({ row: i + 2, name, reason: 'Costo invariato.' }); continue; }
        move({ ...item, kind: 'rivalutazione', qtyMilli: 0, valueCents: delta, unitCostE4: cost, by, label: 'Valorizzazione dal foglio dei costi', reason: 'Costo unitario da foglio Excel' });
        done.push({ row: i + 2, name, unit_cost_e4: cost });
      }
    });
    return { done, skipped };
  }
  r.post('/cost-sheet', upload.single('file'), req => {
    if (!req.file) throw new HttpError(400, 'Carica il foglio compilato.');
    const res = importCosts(req.file.buffer, actor(req));
    audit(req, 'stock.costs_imported', { entity: 'stock', after: { valued: res.done.length, skipped: res.skipped.length } });
    return res;
  });

  // ── Riconciliazione notturna (passo B della transizione) ────────────────────
  // Confronta la quantità di oggi (warehouse_finished / warehouse_raw) con il registro: disponibile =
  // giacenza − impegni. Ogni differenza è una notifica: per cambiare fonte di verità ne servono zero.
  function reconcile() {
    const diffs = items().filter(x => x.difference_milli !== 0);
    if (diffs.length) {
      for (const u of roleUsers('magazzino')) {
        notifications.notify({ userId: u, kind: 'stock.reconcile', title: `Magazzino: ${diffs.length} ${diffs.length === 1 ? 'articolo non torna' : 'articoli non tornano'} con il registro`,
          body: diffs.slice(0, 5).map(d => `${d.name}: ${d.warehouse_qty} contro ${d.available_milli / 1000}`).join('; '), link: '/portal.html?workspace=magazzino&sub=mag-registro', dedupeKey: `stock-reconcile:${today()}` });
      }
    }
    return diffs;
  }
  scheduler.register('stock.reconcile', 24 * 60, () => `${reconcile().length} differenze`);
  r.get('/reconciliation', () => ({ date: today(), differences: reconcile() }));

  return { move, reverseWhere, saleIssued, saleCancelled, pickupReserved, pickupCollected, pickupReleased, orderStatusChanged, manualSet, opening, hasMovements,
    tastingProposed, tastingWithdrawn, items, valuation, anomalies, reconcile, importCosts, costSheet, balance, tx, KIND_LABELS };
};
