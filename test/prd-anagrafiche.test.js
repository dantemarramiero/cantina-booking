// Produzione — Fase 1: anagrafiche. Regole PRD-A01…A05 (docs/produzione/regole.md) e funzioni di base.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

let seq = 0;
const P = '/api/admin/prd';
const vineyard = async () => (await t.api('POST', `${P}/vineyards`, { name: `Vigna ${++seq}`, municipality: 'Rosciano', province: 'PE' })).data.id;
const cadastral = async (area_m2, number = String(++seq)) => (await t.api('POST', `${P}/cadastral-parcels`, { municipality: 'Rosciano', sheet: '7', number, area_m2 })).data.id;
const parcel = (vineyard_id, code, links, extra = {}) => t.api('POST', `${P}/parcels`, { vineyard_id, code, cadastral_links: links, ...extra });

test('PRD-A01 la somma delle superfici vitate sulla stessa particella non supera la superficie catastale (creazione e modifica)', async () => {
  const v = await vineyard();
  const cp = await cadastral(10000);
  const a = await parcel(v, `A01-${seq}-A`, [{ cadastral_parcel_id: cp, vine_area_m2: 6000 }]);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const over = await parcel(v, `A01-${seq}-B`, [{ cadastral_parcel_id: cp, vine_area_m2: 4500 }]);
  assert.equal(over.status, 409);
  assert.match(over.data.error, /10\.500 m².*10\.000 m²/);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM vineyard_parcels WHERE code = ?').get(`A01-${seq}-B`).c, 0, 'rifiutata per intero, senza parcella a metà');
  const b = await parcel(v, `A01-${seq}-C`, [{ cadastral_parcel_id: cp, vine_area_m2: 4000 }]);
  assert.equal(b.status, 200, 'fino alla superficie della particella sì');
  const grow = await t.api('PUT', `${P}/parcels/${a.data.id}/cadastral-links`, { links: [{ cadastral_parcel_id: cp, vine_area_m2: 6500 }] });
  assert.equal(grow.status, 409, 'anche modificando una parcella');
  assert.equal(t.db.prepare('SELECT vine_area_m2 FROM parcel_cadastral_links WHERE parcel_id = ?').get(a.data.id).vine_area_m2, 6000, 'la modifica rifiutata non tocca nulla');
  assert.equal((await t.api('PUT', `${P}/parcels/${a.data.id}/cadastral-links`, { links: [{ cadastral_parcel_id: cp, vine_area_m2: 5000 }] })).status, 200);
  const detail = (await t.api('GET', `${P}/parcels/${a.data.id}`)).data;
  assert.equal(detail.vine_area_m2, 5000);
  assert.match(detail.cadastral_links[0].label, /Rosciano fg\. 7 part\./);
});

test('PRD-A01 la superficie della particella non scende sotto le superfici vitate; le parcelle archiviate non contano, riattivate sì', async () => {
  const v = await vineyard();
  const cp = await cadastral(10000);
  const a = (await parcel(v, `A01R-${seq}-A`, [{ cadastral_parcel_id: cp, vine_area_m2: 7000 }])).data.id;
  const shrink = await t.api('PATCH', `${P}/cadastral-parcels/${cp}`, { area_m2: 6000 });
  assert.equal(shrink.status, 409);
  assert.match(shrink.data.error, /7\.000 m²/);
  assert.equal((await t.api('POST', `${P}/parcels/${a}/archive`)).status, 200);
  const b = await parcel(v, `A01R-${seq}-B`, [{ cadastral_parcel_id: cp, vine_area_m2: 5000 }]);
  assert.equal(b.status, 200, 'la parcella archiviata non occupa più la particella');
  const back = await t.api('POST', `${P}/parcels/${a}/restore`);
  assert.equal(back.status, 409, 'riattivarla supererebbe la particella: rifiutato');
  assert.ok(t.db.prepare('SELECT archived_at FROM vineyard_parcels WHERE id = ?').get(a).archived_at, 'resta archiviata');
  const twice = await parcel(v, `A01R-${seq}-C`, [{ cadastral_parcel_id: cp, vine_area_m2: 100 }, { cadastral_parcel_id: cp, vine_area_m2: 100 }]);
  assert.equal(twice.status, 400, 'la stessa particella due volte');
});

test('PRD-A02 una parcella con attività nella campagna aperta non si archivia (controllo registrato dalle fasi successive)', async () => {
  const v = await vineyard();
  const cp = await cadastral(5000);
  const free = (await parcel(v, `A02-${seq}-A`, [{ cadastral_parcel_id: cp, vine_area_m2: 1000 }])).data.id;
  const busy = (await parcel(v, `A02-${seq}-B`, [{ cadastral_parcel_id: cp, vine_area_m2: 1000 }])).data.id;
  // Gli interventi (Fase 2) e i conferimenti (Fase 3) si agganciano qui: si simula un'attività sulla parcella.
  t.prd.registerParcelArchiveGuard(p => (p.id === busy ? 'ha interventi nella campagna 2026/2027' : null));
  assert.equal((await t.api('POST', `${P}/parcels/${free}/archive`)).status, 200, 'senza attività si archivia');
  const res = await t.api('POST', `${P}/parcels/${busy}/archive`);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /interventi nella campagna/);
  assert.equal(t.db.prepare('SELECT archived_at FROM vineyard_parcels WHERE id = ?').get(busy).archived_at, null);
  assert.equal((await t.api('GET', `${P}/parcels`)).data.some(p => p.id === free), false, 'le archiviate escono dall\'elenco');
  assert.equal((await t.api('GET', `${P}/parcels?archived=1`)).data.some(p => p.id === free), true, 'ma restano per lo storico');
});

test('PRD-A03 codice del vaso univoco, capacità maggiore di zero, codice QR generato; un vaso con contenuto non si dismette', async () => {
  const a = await t.api('POST', `${P}/vessels`, { code: 'ino-01', type: 'vasca_inox', capacity_ml: 5000000 });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.code, 'INO-01');
  assert.match(a.data.qr_token, /^[0-9a-f]{16}$/);
  const dup = await t.api('POST', `${P}/vessels`, { code: 'Ino-01', type: 'vasca_cemento', capacity_ml: 1000 });
  assert.equal(dup.status, 409, 'maiuscole e minuscole non contano');
  const zero = await t.api('POST', `${P}/vessels`, { code: 'ino-02', type: 'vasca_inox', capacity_ml: 0 });
  assert.equal(zero.status, 400);
  assert.match(zero.data.error, /maggiore di zero/);
  const b = (await t.api('POST', `${P}/vessels`, { code: 'ino-03', type: 'vasca_inox', capacity_ml: 1000 })).data;
  assert.notEqual(a.data.qr_token, b.qr_token);
  assert.equal((await t.api('GET', `${P}/vessels/by-token/${a.data.qr_token}`)).data.code, 'INO-01', 'dal QR si apre il vaso');
  assert.equal((await t.api('PATCH', `${P}/vessels/${a.data.id}`, { status: 'in_use' })).status, 400, 'lo stato «pieno» non si sceglie a mano');
  // Il giornale di cantina (Fase 3) segnerà il vaso come pieno: qui lo si simula.
  t.db.prepare("UPDATE vessels SET status = 'in_use' WHERE id = ?").run(a.data.id);
  const retire = await t.api('POST', `${P}/vessels/${a.data.id}/retire`, { reason: 'sostituita' });
  assert.equal(retire.status, 409);
  assert.match(retire.data.error, /non è vuoto/);
  assert.equal((await t.api('POST', `${P}/vessels/${b.id}/retire`, { reason: 'crepa' })).data.status, 'retired');
  assert.equal((await t.api('PATCH', `${P}/vessels/${b.id}`, { name: 'x' })).status, 409, 'un vaso dismesso non si modifica');
  assert.equal((await t.api('POST', `${P}/vessels/${b.id}/reactivate`)).data.status, 'empty_dirty', 'riattivato va lavato');
});

test('PRD-A04 una barrique si dismette solo vuota e la sua storia dei passaggi si chiude', async () => {
  const closed = [];
  t.prd.registerBarrelRetireHook(v => closed.push(v.id)); // occupazione dei legni (Fase 5)
  const create = await t.api('POST', `${P}/vessels`, { code: 'BQ-01', type: 'barrique', capacity_ml: 225000,
    barrel: { cooper_name: 'Tonnellerie Test', oak_origin: 'Francia', toast: 'media', purchase_date: '2024-03-01', purchase_cost_cents: '850,00', useful_life_uses: 5, uses_count: 2 } });
  assert.equal(create.status, 200, JSON.stringify(create.data));
  assert.equal(create.data.barrel.purchase_cost_cents, 85000);
  assert.equal(create.data.barrel.uses_count, 2);
  const full = (await t.api('POST', `${P}/vessels`, { code: 'BQ-02', type: 'barrique', capacity_ml: 225000 })).data;
  t.db.prepare("UPDATE vessels SET status = 'in_use' WHERE id = ?").run(full.id);
  assert.equal((await t.api('POST', `${P}/vessels/${full.id}/retire`)).status, 409, 'piena no');
  assert.deepEqual(closed, [], 'la storia di una barrique piena non si chiude');
  const done = await t.api('POST', `${P}/vessels/${create.data.id}/retire`, { reason: 'fine vita' });
  assert.equal(done.status, 200);
  assert.ok(done.data.barrel.retired_at, 'la barrique è dismessa');
  assert.deepEqual(closed, [create.data.id], 'e la sua storia dei passaggi si chiude');
  assert.equal((await t.api('POST', `${P}/vessels`, { code: 'INOX-X', type: 'vasca_inox', capacity_ml: 1000, barrel: { toast: 'forte' } })).status, 400, 'i dati da barrique valgono solo per i legni');
});

test('PRD-A05 una regola di disciplinare scaduta non vale per le operazioni successive ma resta per lo storico', async () => {
  const app = (await t.api('GET', `${P}/appellations`)).data.find(a => a.name === "Montepulciano d'Abruzzo").id;
  // «14.000» all'italiana: il punto è delle migliaia.
  const old = await t.api('POST', `${P}/appellations/${app}/rules`, { rule_type: 'max_yield_kg_ha', value_e4: '14.000', valid_from: '2015-01-01', valid_to: '2025-12-31', source_note: 'disciplinare di prova' });
  assert.equal(old.status, 200, JSON.stringify(old.data));
  await t.api('POST', `${P}/appellations/${app}/rules`, { rule_type: 'max_yield_kg_ha', value_e4: '13000', valid_from: '2026-01-01' });
  await t.api('POST', `${P}/appellations/${app}/rules`, { rule_type: 'min_aging_months', mention: 'Riserva', value_e4: '24', valid_from: '2015-01-01' });
  const at2025 = (await t.api('GET', `${P}/appellations/${app}/rules?date=2025-06-01`)).data;
  assert.deepEqual(at2025.map(r => [r.rule_type, r.value_e4 / 10000]), [['max_yield_kg_ha', 14000]], 'nel 2025 vale la regola di allora');
  const at2026 = (await t.api('GET', `${P}/appellations/${app}/rules?date=2026-06-01`)).data;
  assert.deepEqual(at2026.map(r => [r.rule_type, r.value_e4 / 10000]), [['max_yield_kg_ha', 13000]], 'dopo la scadenza vale solo la nuova');
  assert.equal(at2026[0].unit, 'kg/ha');
  const riserva = (await t.api('GET', `${P}/appellations/${app}/rules?date=2026-06-01&mention=Riserva`)).data.map(r => r.rule_type);
  assert.deepEqual(riserva.sort(), ['max_yield_kg_ha', 'min_aging_months'], 'con la menzione si aggiungono le sue regole');
  assert.equal((await t.api('GET', `${P}/appellations/${app}`)).data.rules.length, 3, 'lo storico resta');
  assert.equal((await t.api('POST', `${P}/appellations/${app}/rules`, { rule_type: 'min_lees_months', value_e4: 9, valid_from: '2026-01-01', valid_to: '2025-01-01' })).status, 400, 'fine prima dell\'inizio');
  assert.equal((await t.api('POST', `${P}/appellations/${app}/rules`, { rule_type: 'min_variety_pct', value_e4: 85, valid_from: '2026-01-01' })).status, 400, 'la quota del vitigno vuole il vitigno');
});

test('parcelle: vitigno, idoneità alle denominazioni, biologico ereditato dal vigneto, anno d\'impianto controllato', async () => {
  const v = (await t.api('POST', `${P}/vineyards`, { name: 'Vigna Bio', organic_status: 'conversion' })).data.id;
  const variety = (await t.api('GET', `${P}/varieties`)).data.find(x => x.name === 'Montepulciano').id;
  const doc = (await t.api('GET', `${P}/appellations`)).data.filter(a => a.type === 'DOC').slice(0, 2).map(a => a.id);
  const cp = await cadastral(20000);
  const p = await parcel(v, 'BIO-1', [{ cadastral_parcel_id: cp, vine_area_m2: 12500, schedario_unit_code: 'UV-123' }], { variety_id: variety, appellation_ids: doc, planting_year: 2004, vines_count: '4.500' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const d = (await t.api('GET', `${P}/parcels/${p.data.id}`)).data;
  assert.equal(d.variety_name, 'Montepulciano');
  assert.deepEqual(d.appellation_ids, [...doc].sort((a, b) => a - b));
  assert.equal(d.effective_organic_status, 'conversion');
  assert.equal(d.vines_count, 4500, 'il punto delle migliaia si legge');
  assert.equal(d.cadastral_links[0].schedario_unit_code, 'UV-123');
  assert.equal((await parcel(v, 'BIO-2', [], { planting_year: 1850 })).status, 400);
  assert.equal((await parcel(v, 'bio-1', [])).status, 409, 'codice di parcella univoco');
  const list = (await t.api('GET', `${P}/vineyards`)).data.find(x => x.id === v);
  assert.equal(list.vine_area_m2, 12500);
});

test('protocolli di partenza modificabili: passi riordinati, duplicazione; operazioni dal catalogo', async () => {
  const list = (await t.api('GET', `${P}/protocols`)).data;
  assert.deepEqual(list.map(x => x.style).sort(), ['base_spumante', 'bianco', 'metodo_classico', 'rosato', 'rosso']);
  const bianco = list.find(x => x.style === 'bianco');
  const d = (await t.api('GET', `${P}/protocols/${bianco.id}`)).data;
  assert.ok(d.steps.length > 10);
  const steps = [d.steps[1], d.steps[0], { operation_type: 'filtrazione', title: 'Microfiltrazione', target_params: { micron: 0.45 } }];
  const upd = await t.api('PUT', `${P}/protocols/${bianco.id}/steps`, { steps });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));
  assert.deepEqual(upd.data.steps.map(s => s.sequence), [1, 2, 3]);
  assert.deepEqual(upd.data.steps[2].target_params, { micron: 0.45 });
  assert.equal((await t.api('PUT', `${P}/protocols/${bianco.id}/steps`, { steps: [{ operation_type: 'danza', title: 'x' }] })).status, 400);
  const copy = await t.api('POST', `${P}/protocols/${bianco.id}/duplicate`, { name: 'Bianco macerato' });
  assert.equal((await t.api('GET', `${P}/protocols/${copy.data.id}`)).data.steps.length, 3);
});

test('attrezzature e fitofarmaci: scadenza del controllo funzionale dalla soglia; numero di registrazione univoco; mappa SIAN da validare', async () => {
  const eq = (await t.api('POST', `${P}/equipment`, { name: 'Atomizzatore', type: 'irroratrice', last_inspection_date: '2022-03-10' })).data.id;
  const e = (await t.api('GET', `${P}/equipment/${eq}`)).data;
  assert.equal(e.inspection_due, '2025-03-10', '36 mesi di partenza, da validare');
  assert.equal(e.inspection_expired, true);
  const ph = await t.api('POST', `${P}/phyto-products`, { commercial_name: 'Rame Prova', registration_number: '12345', max_dose_per_ha_e4: '2,5', dose_unit: 'kg/ha', preharvest_interval_days: 21, reentry_hours: 48, organic_allowed: true });
  assert.equal(ph.status, 200, JSON.stringify(ph.data));
  assert.equal((await t.api('GET', `${P}/phyto-products/${ph.data.id}`)).data.max_dose_per_ha_e4, 25000);
  const dup = await t.api('POST', `${P}/phyto-products`, { commercial_name: 'Altro', registration_number: '12345' });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /numero di registrazione/);
  const map = await t.api('POST', `${P}/sian-map`, { operation_type: 'travaso', sian_code: 'XX' });
  assert.equal(map.status, 200);
  await t.api('POST', `${P}/sian-map/${map.data.id}/validate`);
  assert.ok((await t.api('GET', `${P}/sian-map/${map.data.id}`)).data.validated_at);
  await t.api('PATCH', `${P}/sian-map/${map.data.id}`, { sian_code: 'YY' });
  assert.equal((await t.api('GET', `${P}/sian-map/${map.data.id}`)).data.validated_at, null, 'cambiata, torna da validare');
  const logged = t.db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE entity = 'phyto_products'").get().c;
  assert.ok(logged >= 1, 'nel registro attività');
});
