// Regressione sugli automatismi che esistono già (CRM, magazzino, wine club, obiettivi, liste):
// People e Finance si agganciano qui, quindi devono restare corretti.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const person = email => t.db.prepare('SELECT * FROM people WHERE lower(email) = ?').get(email.toLowerCase());
const sale = (fields, items) => t.api('POST', '/api/admin/shop-sales', { ...fields, items });

async function newSlot() {
  const r = await t.api('POST', '/api/admin/slots', { experience_id: 1, date: '2030-06-01', time: `1${Math.floor(Math.random() * 9)}:00`, capacity: 20 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
}

test('una prenotazione e una vendita della stessa persona (email con maiuscole) fanno una sola Persona', async () => {
  const slot = await newSlot();
  const b = await t.api('POST', '/api/admin/bookings/manual', { experience_id: 1, slot_id: slot, customer_name: 'Mario Rossi', email: 'Mario.Rossi@Example.com', guests: 2, status: 'confermata' });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  await sale({ customer_name: 'Mario Rossi', customer_email: 'mario.rossi@example.com' }, [{ product_name: 'Vino', quantity: 1, unit_price_cents: 1000 }]);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM people WHERE lower(email) = 'mario.rossi@example.com'").get().c, 1);
  const p = person('mario.rossi@example.com');
  assert.deepEqual(JSON.parse(p.roles), ['cliente_finale']);
  assert.deepEqual(JSON.parse(p.source_channels).sort(), ['negozio_fisico', 'visita']);
});

test('chi compra solo col telefono e poi lascia l\'email resta la stessa Persona', async () => {
  await sale({ customer_name: 'Anna Bianchi', customer_phone: '3330001111' }, [{ product_name: 'Vino', quantity: 1, unit_price_cents: 500 }]);
  await sale({ customer_name: 'Anna Bianchi', customer_phone: '3330001111', customer_email: 'anna@example.com' }, [{ product_name: 'Vino', quantity: 1, unit_price_cents: 500 }]);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM people WHERE phone = '3330001111'").get().c, 1);
  assert.equal(person('anna@example.com').phone, '3330001111');
});

test('Contatti: una persona referente di due aziende, il ruolo Contatto segue i collegamenti', async () => {
  const c1 = (await t.api('POST', '/api/admin/customers', { name: 'Ristorante Uno' })).data.id;
  const c2 = (await t.api('POST', '/api/admin/customers', { name: 'Enoteca Due' })).data.id;
  const add = (cid, role) => t.api('POST', `/api/admin/crm/customer/${cid}/contacts`, { first_name: 'Luca', last_name: 'Verdi', email: 'luca@example.com', role });
  assert.equal((await add(c1, 'titolare')).status, 200);
  assert.equal((await add(c2, 'sommelier')).status, 200);
  const p = person('luca@example.com');
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM person_links WHERE person_id = ?').get(p.id).c, 2);
  assert.ok(JSON.parse(p.roles).includes('contatto'));
  await t.api('DELETE', `/api/admin/crm/customer/${c1}/contacts/${p.id}`);
  assert.ok(JSON.parse(person('luca@example.com').roles).includes('contatto'), 'resta contatto della seconda azienda');
  await t.api('DELETE', `/api/admin/crm/customer/${c2}/contacts/${p.id}`);
  assert.ok(!JSON.parse(person('luca@example.com').roles).includes('contatto'), 'tolto l\'ultimo collegamento, non è più contatto');
  assert.ok(person('luca@example.com'), 'la Persona resta');
});

test('la vendita in cassa scarica il magazzino e l\'eliminazione lo ricarica', async () => {
  const product = (await t.api('POST', '/api/admin/products', { name: 'Montepulciano Test', vintage: '2022' })).data.id;
  assert.equal((await t.api('POST', '/api/admin/warehouse/finished', { product_id: product, quantity: 10, threshold: 2 })).status, 200);
  const stock = () => t.db.prepare('SELECT quantity FROM warehouse_finished WHERE product_id = ?').get(product).quantity;
  const s = await sale({ customer_name: 'Cliente Cassa' }, [{ product_id: product, product_name: 'Montepulciano Test', quantity: 3, unit_price_cents: 1500 }]);
  assert.equal(stock(), 7);
  await t.api('DELETE', `/api/admin/shop-sales/${s.data.id}`);
  assert.equal(stock(), 10);
});

test('wine club automatico: entra chi supera la soglia, chi è tolto a mano non rientra', async () => {
  const rule = await t.api('PUT', '/api/admin/wine-club/rule', { enabled: true, match: 'any', months: 12, shop: { enabled: true, min_eur: 100 }, visits: { enabled: false } });
  assert.equal(rule.status, 200, JSON.stringify(rule.data));
  await sale({ customer_name: 'Grande Cliente', customer_email: 'grande@example.com' }, [{ product_name: 'Vino', quantity: 1, unit_price_cents: 12000 }]);
  const p = person('grande@example.com');
  assert.equal(p.wine_club, 1);
  assert.equal(p.wine_club_auto, 1);
  await t.api('PATCH', `/api/admin/people/${p.id}`, { wine_club: 0 });
  await sale({ customer_name: 'Grande Cliente', customer_email: 'grande@example.com' }, [{ product_name: 'Vino', quantity: 1, unit_price_cents: 12000 }]);
  assert.equal(person('grande@example.com').wine_club, 0);
  await t.api('PUT', '/api/admin/wine-club/rule', { enabled: false, match: 'any', months: 12, shop: { enabled: true, min_eur: 100 }, visits: { enabled: false } });
});

test('obiettivi: copia di un anno con crescita volumi e aumento prezzi', async () => {
  const areas = (await t.api('GET', '/api/admin/sales-target-areas')).data;
  const save = await t.api('PUT', '/api/admin/sales-targets/2031', {
    cantina: { bt: 1000, eur: 20000 },
    areas: [{ id: areas[0].id, sumMode: false, bt: 400, eur: 8000, monthMode: 'uniforme', manualPct: [], products: {} }],
  });
  assert.equal(save.status, 200);
  assert.equal((await t.api('POST', '/api/admin/sales-targets/2032/copy', { fromYear: 2031, volumePct: 10, pricePct: 5 })).status, 200);
  const y = (await t.api('GET', '/api/admin/sales-targets/2032')).data.targets;
  assert.deepEqual(y.cantina, { bt: 1100, eur: 23100 });
  assert.equal(y.areas[0].bt, 440);
  assert.equal(y.areas[0].eur, 9240);
});

test('liste modificabili: una voce in uso non si elimina, «Distributore» non si elimina mai', async () => {
  await t.api('POST', '/api/admin/customers', { name: 'Enoteca In Uso', business_type: 'enoteca' });
  const lists = (await t.api('GET', '/api/admin/option-lists')).data.customer_business_types;
  const without = key => lists.filter(i => i.key !== key).map(({ key: k, label }) => ({ key: k, label }));
  assert.equal((await t.api('PUT', '/api/admin/option-lists/customer_business_types', { items: without('enoteca') })).status, 409);
  assert.equal((await t.api('PUT', '/api/admin/option-lists/customer_business_types', { items: without('distributore') })).status, 400);
});

test('le foto dei prodotti finiscono sul volume dei dati, non nel container', () => {
  const path = require('path');
  const fs = require('fs');
  assert.ok(fs.existsSync(path.join(t.dir, 'uploads', 'products')), 'cartella uploads sul volume');
});
