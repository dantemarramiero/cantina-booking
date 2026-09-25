// Produzione — Fase 2: vigneto. Regole PRD-V01…V11 (docs/produzione/regole.md), registro dei trattamenti,
// bozze offline, ore nelle presenze, scarico del fitofarmaco, analisi di maturazione e previsione.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const time = require('../lib/time');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const P = '/api/admin/prd';
let seq = 0;
const today = time.romeDate();
const year = Number(today.slice(0, 4));
const localPlusHours = h => time.romeDateTime(new Date(Date.now() + h * 3600000));
const dayOffset = d => time.addDays(today, d);
const yesterday = dayOffset(-1);

async function parcel({ organic = 'none', area = 10000 } = {}) {
  const n = ++seq;
  const v = (await t.api('POST', `${P}/vineyards`, { name: `Vigna ${n}`, organic_status: organic })).data.id;
  const cp = (await t.api('POST', `${P}/cadastral-parcels`, { municipality: 'Rosciano', sheet: '1', number: String(1000 + n), area_m2: area })).data.id;
  const res = await t.api('POST', `${P}/parcels`, { vineyard_id: v, code: `V2-${n}`, cadastral_links: [{ cadastral_parcel_id: cp, vine_area_m2: area }] });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return { id: res.data.id, code: `V2-${n}`, area };
}
const trainingId = code => t.db.prepare('SELECT id FROM training_types WHERE code = ?').get(code).id;
async function worker({ licensed = true, restricted = false } = {}) {
  const e = (await t.api('POST', '/api/admin/hr/employees', { first_name: `Operaio${++seq}`, last_name: 'Vigna' })).data.id;
  if (licensed) assert.equal((await t.api('POST', `/api/admin/hr/employees/${e}/trainings`, { training_type_id: trainingId('fitosanitari'), completed_on: '2025-01-15' })).status, 200);
  if (restricted) {
    const op = t.db.prepare("SELECT id FROM cost_objects WHERE code = 'OP-TRATT-FITO'").get().id;
    const v = await t.api('POST', `/api/admin/hr/employees/${e}/medical-visits`, { visit_type: 'periodica', visit_date: '2026-01-10', judgment: 'idoneo_prescrizioni', limitations: 'No esposizione a fitofarmaci', next_visit_on: '2027-01-10', restricted_cost_object_ids: [op] });
    assert.equal(v.status, 200, JSON.stringify(v.data));
  }
  return e;
}
const sprayer = async (last = '2025-06-01') => (await t.api('POST', `${P}/equipment`, { name: `Atomizzatore ${++seq}`, type: 'irroratrice', last_inspection_date: last })).data.id;
async function product(extra = {}) {
  const res = await t.api('POST', `${P}/phyto-products`, { commercial_name: `Prodotto ${++seq}`, registration_number: `R${1000 + seq}`, max_dose_per_ha_e4: '2', dose_unit: 'kg/ha',
    preharvest_interval_days: 21, reentry_hours: 48, max_applications_per_year: 2, organic_allowed: false, ...extra });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.id;
}
const treatment = (parcels, { workers, equipment, products, start = '2026-05-10T07:00', end = '2026-05-10T09:00', pest = 'Peronospora', confirm = true, ...extra } = {}) =>
  t.api('POST', `${P}/interventions`, {
    type: 'trattamento', started_at: start, ended_at: end, bbch_stage: '57', parcels: parcels.map(p => ({ parcel_id: p.id, area_m2: p.area })),
    workers: workers.map(w => ({ employee_id: w })), equipment_ids: equipment,
    treatment: { target_pest: pest, water_volume_l_per_ha: 300, products: products.map(([id, dose, total]) => ({ phyto_product_id: id, dose_per_ha: dose, total_quantity: total })) },
    confirm, ...extra,
  });

test('PRD-V01 un trattamento si conferma solo con parcella, date, prodotto, avversità, dose, quantità, superficie, esecutore e attrezzatura', async () => {
  const p = await parcel();
  const draft = await t.api('POST', `${P}/interventions`, { type: 'trattamento', started_at: '2026-05-12T07:00', parcels: [{ parcel_id: p.id, area_m2: p.area }], treatment: { products: [] } });
  assert.equal(draft.status, 200, 'la bozza si salva anche incompleta');
  const res = await t.api('POST', `${P}/interventions/${draft.data.id}/confirm`);
  assert.equal(res.status, 409);
  for (const m of ['data e ora di fine', 'almeno un prodotto', "l'avversità", "l'esecutore", "l'attrezzatura"]) assert.ok(res.data.errors.some(e => e.includes(m)), `manca «${m}»: ${res.data.errors}`);
  const prod = await product();
  const noDose = await treatment([p], { workers: [await worker()], equipment: [await sprayer()], products: [[prod, null, null]], confirm: true });
  assert.equal(noDose.status, 409);
  assert.match(noDose.data.error, /dose per ettaro.*quantità totale/);
  const ok = await treatment([p], { workers: [await worker()], equipment: [await sprayer()], products: [[prod, '1,5', '1,5']] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.intervention.status, 'confirmed');
  assert.equal((await t.api('PATCH', `${P}/interventions/${ok.data.id}`, { notes: 'x' })).status, 409, 'confermato non si modifica');
});

test('PRD-V02 senza patentino fitosanitario valido alla data non si è esecutori; con il patentino sì', async () => {
  const p = await parcel();
  const prod = await product();
  const unlicensed = await worker({ licensed: false });
  const res = await treatment([p], { workers: [unlicensed], equipment: [await sprayer()], products: [[prod, '1', '1']] });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /abilitazione «Certificato di abilitazione all'uso dei prodotti fitosanitari»/);
  // Una deroga del responsabile sicurezza non vale per un'abilitazione di legge.
  t.db.prepare(`INSERT INTO safety_waivers (employee_id, training_type_id, cost_object_id, reason, valid_from, valid_to, granted_by, created_at)
    VALUES (?, ?, ?, 'Affiancamento', '2026-01-01', '2026-12-31', 'Responsabile sicurezza', ?)`)
    .run(unlicensed, trainingId('fitosanitari'), t.db.prepare("SELECT id FROM cost_objects WHERE code = 'OP-TRATT-FITO'").get().id, new Date().toISOString());
  assert.equal((await treatment([p], { workers: [unlicensed], equipment: [await sprayer()], products: [[prod, '1', '1']] })).status, 409, 'la deroga non basta');
  assert.equal((await treatment([p], { workers: [await worker()], equipment: [await sprayer()], products: [[prod, '1', '1']] })).status, 200);
  const op = t.db.prepare("SELECT id FROM cost_objects WHERE code = 'OP-TRATT-FITO'").get().id;
  const links = t.db.prepare('SELECT training_type_id FROM operation_trainings WHERE cost_object_id = ?').all(op).map(x => x.training_type_id);
  t.db.prepare('DELETE FROM operation_trainings WHERE cost_object_id = ?').run(op);
  assert.equal((await treatment([p], { workers: [unlicensed], equipment: [await sprayer()], products: [[prod, '1', '1']] })).status, 409, 'anche se in People si toglie il collegamento');
  for (const id of links) t.db.prepare('INSERT INTO operation_trainings (cost_object_id, training_type_id) VALUES (?, ?)').run(op, id);
  t.db.prepare("UPDATE cost_objects SET code = 'OP-TRATT-FITO-X' WHERE id = ?").run(op);
  const noOp = await treatment([p], { workers: [await worker()], equipment: [await sprayer()], products: [[prod, '1', '1']] });
  t.db.prepare("UPDATE cost_objects SET code = 'OP-TRATT-FITO' WHERE id = ?").run(op);
  assert.equal(noOp.status, 409);
  assert.match(noOp.data.error, /OP-TRATT-FITO/, 'senza l\'operazione i controlli non si saltano');
});

test('PRD-V03 la dose per ettaro non supera la massima del prodotto', async () => {
  const p = await parcel();
  const prod = await product({ max_dose_per_ha_e4: '2' });
  const res = await treatment([p], { workers: [await worker()], equipment: [await sprayer()], products: [[prod, '2,5', '2,5']] });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /la dose di 2,5 kg\/ha supera la massima di 2 kg\/ha/);
});

test('PRD-V04 le applicazioni di un prodotto su una parcella non superano il massimo nel periodo (anno solare di partenza)', async () => {
  const p = await parcel();
  const prod = await product({ max_applications_per_year: 2 });
  const who = { workers: [await worker()], equipment: [await sprayer()], products: [[prod, '1', '1']] };
  assert.equal((await treatment([p], { ...who, start: '2026-05-01T07:00', end: '2026-05-01T08:00' })).status, 200);
  assert.equal((await treatment([p], { ...who, start: '2026-05-15T07:00', end: '2026-05-15T08:00' })).status, 200);
  const third = await treatment([p], { ...who, start: '2026-06-01T07:00', end: '2026-06-01T08:00' });
  assert.equal(third.status, 409);
  assert.match(third.data.error, /applicazione n\. 3, il massimo è 2 per il 2026/);
  assert.equal((await treatment([p], { ...who, start: '2025-05-01T07:00', end: '2025-05-01T08:00' })).status, 200, 'un altro anno conta a parte');
  assert.equal((await treatment([await parcel()], { ...who, start: '2026-06-01T07:00', end: '2026-06-01T08:00' })).status, 200, 'si conta per parcella');
});

test('PRD-V05 su una parcella biologica o in conversione si usano solo prodotti ammessi in biologico', async () => {
  const bio = await parcel({ organic: 'conversion' });
  const who = { workers: [await worker()], equipment: [await sprayer()] };
  const res = await treatment([bio], { ...who, products: [[await product({ organic_allowed: false }), '1', '1']] });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /è in conversione e .* non è ammesso in biologico/);
  assert.equal((await treatment([bio], { ...who, products: [[await product({ organic_allowed: true }), '1', '1']] })).status, 200);
});

test('PRD-V06 fine carenza = data del trattamento + giorni; fine rientro = fine + ore; con più trattamenti vale la data più lontana', async () => {
  const p = await parcel();
  const who = { workers: [await worker()], equipment: [await sprayer()] };
  const a = await treatment([p], { ...who, start: '2026-06-10T06:00', end: '2026-06-10T08:30', products: [[await product({ preharvest_interval_days: 21, reentry_hours: 48 }), '1', '1']] });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.intervention.treatment.preharvest_ends_on, '2026-07-01');
  assert.equal(a.data.intervention.treatment.reentry_ends_at, time.romeToUtc('2026-06-12T08:30'));
  const mix = await treatment([p], { ...who, start: '2026-06-05T06:00', end: '2026-06-05T07:00',
    products: [[await product({ preharvest_interval_days: 10, reentry_hours: 6 }), '1', '1'], [await product({ preharvest_interval_days: 35, reentry_hours: 24 }), '1', '1']] });
  assert.equal(mix.data.intervention.treatment.preharvest_ends_on, '2026-07-10', 'in miscela decide il prodotto con la carenza più lunga');
  const s = (await t.api('GET', `${P}/parcels/${p.id}/state`)).data;
  assert.equal(s.preharvest_ends_on, '2026-07-10', 'sulla parcella vale la data più lontana');
  assert.equal(s.reentry_ends_at, time.romeToUtc('2026-06-12T08:30'));
});

test('PRD-V07 un intervento durante il tempo di rientro richiede la conferma esplicita con il motivo (DPI), che resta registrato', async () => {
  const p = await parcel();
  const who = { workers: [await worker()], equipment: [await sprayer()] };
  assert.equal((await treatment([p], { ...who, start: localPlusHours(-3), end: localPlusHours(-2), products: [[await product({ reentry_hours: 48 }), '1', '1']] })).status, 200);
  const earlier = await t.api('POST', `${P}/interventions`, { type: 'potatura_verde', started_at: localPlusHours(-5), parcels: [{ parcel_id: p.id, area_m2: p.area }] });
  assert.equal(earlier.status, 200, 'il lavoro fatto prima del trattamento non è nel rientro');
  const plan = { type: 'potatura_verde', started_at: localPlusHours(-1), parcels: [{ parcel_id: p.id, area_m2: p.area }] };
  const blocked = await t.api('POST', `${P}/interventions`, plan);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'reentry');
  assert.match(blocked.data.error, /tempo di rientro dura fino al/);
  const ok = await t.api('POST', `${P}/interventions`, { ...plan, reentry_override_reason: 'Squadra con tuta, guanti e maschera' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.intervention.reentry_override_reason, 'Squadra con tuta, guanti e maschera');
  assert.equal((await t.api('POST', `${P}/interventions/${ok.data.id}/confirm`)).status, 200);
  const later = await t.api('POST', `${P}/interventions`, { ...plan, started_at: localPlusHours(60) });
  assert.equal(later.status, 200, 'finito il rientro non serve');
  const future = await t.api('POST', `${P}/interventions/${later.data.id}/confirm`);
  assert.equal(future.status, 409);
  assert.match(future.data.error, /non è ancora iniziato/, 'un lavoro futuro si pianifica, non si conferma');
});

test('PRD-V08 un trattamento registrato oltre N giorni dall\'esecuzione è segnalato come registrazione tardiva', async () => {
  const p = await parcel();
  const who = { workers: [await worker()], equipment: [await sprayer()], products: [[await product(), '1', '1']] };
  const old = await treatment([p], { ...who, start: `${dayOffset(-40)}T07:00`, end: `${dayOffset(-40)}T08:00` });
  assert.equal(old.status, 200, JSON.stringify(old.data));
  assert.equal(old.data.intervention.registered_late, 1);
  assert.equal(old.data.intervention.late_days, 40);
  const fresh = await treatment([await parcel()], { ...who, start: `${dayOffset(-2)}T07:00`, end: `${dayOffset(-2)}T08:00` });
  assert.equal(fresh.data.intervention.registered_late, 0);
});

test('PRD-V09 con l\'irroratrice senza controllo funzionale valido il trattamento si conferma ma è non conforme', async () => {
  const p = await parcel();
  const base = { workers: [await worker()], products: [[await product(), '1', '1']], start: '2026-06-20T07:00', end: '2026-06-20T08:00' };
  const expired = await treatment([p], { ...base, equipment: [await sprayer('2022-01-10')] });
  assert.equal(expired.status, 200);
  assert.equal(expired.data.intervention.equipment_noncompliant, 1);
  const ok = await treatment([await parcel()], { ...base, equipment: [await sprayer('2025-10-01')] });
  assert.equal(ok.data.intervention.equipment_noncompliant, 0);
});

test('PRD-V10 con la limitazione del medico sull\'operazione «Trattamento fitosanitario» non si è esecutori, anche con il patentino', async () => {
  const p = await parcel();
  const w = await worker({ restricted: true });
  const logged = () => t.db.prepare('SELECT COUNT(*) AS c FROM sensitive_access_log WHERE employee_id = ?').get(w).c;
  const before = logged();
  const res = await treatment([p], { workers: [w], equipment: [await sprayer()], products: [[await product(), '1', '1']] });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /limitazioni incompatibili con «Trattamento fitosanitario»/);
  assert.equal(logged(), before + 1, 'la consultazione dell\'idoneità resta nel registro anche se la conferma è rifiutata');
});

test('PRD-V11 un intervento confermato si corregge stornandolo (con motivo) e ricreandolo; lo storno ricalcola carenza e rientro', async () => {
  const p = await parcel();
  const who = { workers: [await worker()], equipment: [await sprayer()] };
  const first = await treatment([p], { ...who, start: '2026-07-01T07:00', end: '2026-07-01T08:00', products: [[await product({ preharvest_interval_days: 7, max_applications_per_year: 5 }), '1', '1']] });
  const wrong = await treatment([p], { ...who, start: '2026-07-05T07:00', end: '2026-07-05T08:00', products: [[await product({ preharvest_interval_days: 30, max_applications_per_year: 5 }), '1', '1']] });
  assert.equal((await t.api('GET', `${P}/parcels/${p.id}/state`)).data.preharvest_ends_on, '2026-08-04');
  assert.equal((await t.api('POST', `${P}/interventions/${wrong.data.id}/reverse`, {})).status, 400, 'serve il motivo');
  const rev = await t.api('POST', `${P}/interventions/${wrong.data.id}/reverse`, { reason: 'prodotto sbagliato' });
  assert.equal(rev.data.status, 'reversed');
  assert.equal((await t.api('GET', `${P}/parcels/${p.id}/state`)).data.preharvest_ends_on, '2026-07-08', 'torna a valere il trattamento rimasto');
  assert.equal((await t.api('POST', `${P}/interventions/${wrong.data.id}/reverse`, { reason: 'di nuovo' })).status, 409);
  const reg = (await t.api('GET', `${P}/treatment-register?year=2026`)).data.rows;
  assert.ok(reg.some(r => r.id_intervento === first.data.id), 'nel registro il trattamento valido');
  assert.ok(!reg.some(r => r.id_intervento === wrong.data.id), 'lo stornato no');
  assert.ok(t.db.prepare("SELECT 1 FROM domain_events WHERE type = 'phyto.treatment_reversed' AND source_id = ?").get(wrong.data.id));
});

test('conferma: solo lavori fatti, niente prodotti o attrezzature archiviati; cambiando tipo i prodotti della bozza non restano', async () => {
  const p = await parcel();
  const who = { workers: [await worker()], equipment: [await sprayer()] };
  const running = await treatment([p], { ...who, start: localPlusHours(-1), end: localPlusHours(2), products: [[await product(), '1', '1']] });
  assert.equal(running.status, 409);
  assert.match(running.data.error, /non è ancora finito/);
  const old = await product();
  assert.equal((await t.api('POST', `${P}/phyto-products/${old}/archive`)).status, 200);
  const archived = await treatment([p], { ...who, products: [[old, '1', '1']] });
  assert.equal(archived.status, 409);
  assert.match(archived.data.error, /è archiviato/);
  const gone = await sprayer();
  assert.equal((await t.api('POST', `${P}/equipment/${gone}/archive`)).status, 200);
  assert.match((await treatment([p], { ...who, equipment: [gone], products: [[await product(), '1', '1']] })).data.error, /attrezzatura .* è archiviata/);
  // Una bozza di trattamento con il prodotto X (massimo 1 all'anno) diventa uno sfalcio: X non conta.
  const x = await product({ max_applications_per_year: 1 });
  const draft = await treatment([p], { ...who, products: [[x, '1', '1']], start: '2026-05-20T07:00', end: '2026-05-20T08:00', confirm: false });
  const changed = await t.api('PATCH', `${P}/interventions/${draft.data.id}`, { type: 'sfalcio', confirm: true });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.intervention.treatment, null);
  const real = await treatment([p], { ...who, products: [[x, '1', '1']], start: '2026-05-25T07:00', end: '2026-05-25T08:00' });
  assert.equal(real.status, 200, JSON.stringify(real.data));
});

test('registro dei trattamenti: una riga per parcella e prodotto con i dati di legge; CSV scaricabile', async () => {
  const p = await parcel({ area: 25000 });
  const w = await worker();
  await treatment([p], { workers: [w], equipment: [await sprayer()], start: '2026-04-20T06:30', end: '2026-04-20T09:00', products: [[await product(), '1,5', '3,75'], [await product(), '0,5', '1,25']] });
  await treatment([p], { workers: [w], equipment: [await sprayer()], start: '2026-04-21T06:30', end: '2026-04-21T07:00', pest: '=SOMMA(1;2)', products: [[await product(), '1', '1']] });
  const rows = (await t.api('GET', `${P}/treatment-register?year=2026`)).data.rows.filter(r => r.parcella === p.code && r.data === '2026-04-20');
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].data, rows[0].inizio, rows[0].fine, rows[0].superficie_ha, rows[0].avversita, rows[0].dose_ha, rows[0].quantita_totale], ['2026-04-20', '06:30', '09:00', '2.5000', 'Peronospora', '1.5', '3.75']);
  assert.match(rows[0].catasto, /Rosciano 1\//);
  assert.match(rows[0].esecutori, /Operaio/);
  const csv = await t.request('GET', `${P}/treatment-register?year=2026&format=csv`, { token: t.token });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(String(csv.data), /n_registrazione/);
  assert.match(String(csv.data), /"'=SOMMA\(1;2\)"/, 'un testo che inizia con = non diventa una formula in Excel');
});

test('bozze da campo: lo stesso invio offline non crea due bozze; «ripeti» ricrea la bozza con gli stessi dati; una bozza si elimina', async () => {
  const p = await parcel();
  const body = { type: 'sfogliatura', started_at: '2026-07-10T07:00', parcels: [{ parcel_id: p.id, area_m2: 5000 }], client_uuid: `uuid-${seq}` };
  const a = await t.api('POST', `${P}/interventions`, body);
  const b = await t.api('POST', `${P}/interventions`, body);
  assert.equal(b.data.id, a.data.id);
  assert.equal(b.data.duplicate, true);
  const rep = await t.api('POST', `${P}/interventions/${a.data.id}/repeat`, { started_at: '2026-07-20T07:00' });
  assert.equal(rep.data.intervention.status, 'draft');
  assert.deepEqual(rep.data.intervention.parcels.map(x => x.area_m2), [5000]);
  assert.equal((await t.api('DELETE', `${P}/interventions/${a.data.id}`)).status, 200, 'si elimina anche la bozza da cui ne è nata un\'altra');
  assert.equal(t.db.prepare('SELECT repeated_from_id FROM parcel_interventions WHERE id = ?').get(rep.data.id).repeated_from_id, null);
  assert.equal((await t.api('POST', `${P}/interventions/${rep.data.id}/confirm`)).status, 200);
  assert.equal((await t.api('DELETE', `${P}/interventions/${rep.data.id}`)).status, 409, 'un intervento confermato non si cancella');
});

test('PRD-A02 con interventi confermati nella campagna aperta la parcella non si archivia', async () => {
  const p = await parcel();
  await t.api('POST', `${P}/interventions`, { type: 'potatura_secca', started_at: `${yesterday}T08:00`, parcels: [{ parcel_id: p.id, area_m2: 1000 }], confirm: true });
  const res = await t.api('POST', `${P}/parcels/${p.id}/archive`);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /1 intervento nella campagna aperta/);
});

test('ore: l\'intervento confermato propone la riga nelle presenze dell\'esecutore, con l\'oggetto di costo della parcella per annata', async () => {
  const p = await parcel();
  const w = await worker();
  const res = await t.api('POST', `${P}/interventions`, { type: 'potatura_verde', started_at: `${yesterday}T07:00`, ended_at: `${yesterday}T11:00`,
    parcels: [{ parcel_id: p.id, area_m2: 4000 }], workers: [{ employee_id: w }], confirm: true });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const co = t.db.prepare('SELECT c.* FROM parcel_cost_objects l JOIN cost_objects c ON c.id = l.cost_object_id WHERE l.parcel_id = ?').get(p.id);
  assert.equal(co.type, 'parcella');
  assert.equal(co.vintage, res.data.intervention.harvest_year);
  const period = yesterday.slice(0, 7);
  const month = (await t.api('GET', `/api/admin/hr/timesheet/month?employee_id=${w}&period=${period}`)).data;
  const prop = month.proposals.find(x => x.source === 'intervento' && x.source_id === res.data.id);
  assert.ok(prop, JSON.stringify(month.proposals));
  assert.deepEqual([prop.start_time, prop.end_time, prop.cost_object_id], ['07:00', '11:00', co.id]);
  const acc = await t.api('POST', '/api/admin/hr/timesheet/proposals/accept', { employee_id: w, source: 'intervento', source_id: res.data.id, work_date: yesterday });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.ok(t.db.prepare('SELECT 1 FROM timesheet_intervention_links WHERE entry_id = ? AND intervention_id = ?').get(acc.data.id, res.data.id));
  const proposals = async () => (await t.api('GET', `/api/admin/hr/timesheet/month?employee_id=${w}&period=${period}`)).data.proposals.filter(x => x.source === 'intervento');
  assert.equal((await proposals()).length, 0, 'accettata non si ripropone');
  // Stornato e rifatto: le ore sono già nelle presenze e non si propongono di nuovo.
  await t.api('POST', `${P}/interventions/${res.data.id}/reverse`, { reason: 'parcella sbagliata' });
  const redo = await t.api('POST', `${P}/interventions`, { type: 'potatura_verde', started_at: `${yesterday}T07:00`, ended_at: `${yesterday}T11:00`,
    parcels: [{ parcel_id: p.id, area_m2: 3000 }], workers: [{ employee_id: w }], confirm: true });
  assert.equal(redo.status, 200, JSON.stringify(redo.data));
  assert.equal((await proposals()).length, 0, 'rifatto dopo lo storno non si ripropone');
});

test('magazzino: il fitofarmaco gestito a magazzino (in grammi) si scarica per parcella in proporzione alla superficie; lo storno lo rimette', async () => {
  const raw = await t.api('POST', '/api/admin/warehouse/raw', { sku: 'FITO-1', name: 'Rame in magazzino', unit: 'g', quantity: 10000, threshold: 0 });
  assert.equal(raw.status, 200, JSON.stringify(raw.data));
  const rawId = raw.data.id;
  const prod = await product({ warehouse_raw_id: rawId, max_applications_per_year: 5 });
  const a = await parcel({ area: 6000 }), b = await parcel({ area: 4000 });
  const res = await treatment([a, b], { workers: [await worker()], equipment: [await sprayer()], products: [[prod, '2', '2']], start: '2026-06-02T07:00', end: '2026-06-02T08:00' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const moves = t.db.prepare("SELECT quantity_milli, cost_object_id FROM stock_movements WHERE raw_item_id = ? AND kind = 'consumo_produzione' ORDER BY id").all(rawId).map(x => ({ ...x }));
  assert.deepEqual(moves.map(m => m.quantity_milli), [-1200000, -800000], '2 kg divisi 60/40 in grammi');
  assert.ok(moves.every(m => m.cost_object_id), 'a carico della parcella');
  assert.equal(t.db.prepare('SELECT quantity FROM warehouse_raw WHERE id = ?').get(rawId).quantity, 8000);
  await t.api('POST', `${P}/interventions/${res.data.id}/reverse`, { reason: 'errore' });
  assert.equal(t.db.prepare('SELECT quantity FROM warehouse_raw WHERE id = ?').get(rawId).quantity, 10000, 'lo storno rimette il prodotto');
  // 2 g su quattro parcelle uguali: le quote arrotondate sommano sempre il totale.
  const grams = await product({ warehouse_raw_id: rawId, dose_unit: 'g/ha', max_dose_per_ha_e4: '10', max_applications_per_year: 5 });
  const four = [await parcel({ area: 1000 }), await parcel({ area: 1000 }), await parcel({ area: 1000 }), await parcel({ area: 1000 })];
  const small = await treatment(four, { workers: [await worker()], equipment: [await sprayer()], products: [[grams, '5', '2']], start: '2026-06-03T07:00', end: '2026-06-03T08:00' });
  assert.equal(small.status, 200, JSON.stringify(small.data));
  assert.equal(t.db.prepare('SELECT quantity FROM warehouse_raw WHERE id = ?').get(rawId).quantity, 9998, 'scaricati 2 g, non 3');
});

test('analisi: import dal laboratorio controllato riga per riga (niente a metà), curve per annata, previsione di vendemmia dai valori obiettivo', async () => {
  const p = await parcel();
  const upload = async (csv, dry) => {
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'referti.csv');
    if (dry) fd.append('dry_run', '1');
    const res = await fetch(`${t.base}${P}/analyses/import`, { method: 'POST', headers: { 'x-admin-key': t.token }, body: fd });
    return { status: res.status, data: await res.json() };
  };
  const bad = await upload(`parcella,data,zuccheri_babo,acidita_totale\n${p.code},2026-08-10,14,10\nNON-ESISTE,2026-08-10,14,10\n`);
  assert.equal(bad.status, 400);
  assert.equal(bad.data.errors[0].row, 3);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM analyses WHERE subject_id = ? AND subject_type = 'parcel'").get(p.id).c, 0, 'con un errore non si importa nulla');
  const csv = `parcella,data,zuccheri_babo,acidita_totale,peso_acino\n${p.code},2026-08-10,14,10,1.234\n${p.code},20/08/2026,16,8.5,1.318\n`;
  const dry = await upload(csv, true);
  assert.equal(dry.data.dry_run, true, JSON.stringify(dry.data));
  const ok = await upload(csv);
  assert.equal(ok.data.imported, 2, JSON.stringify(ok.data));
  const berry = t.db.prepare("SELECT r.value_e4 FROM analysis_results r JOIN analysis_parameters p ON p.id = r.parameter_id WHERE p.code = 'peso_acino' ORDER BY r.id LIMIT 1").get().value_e4;
  assert.equal(berry, 12340, 'nel file del laboratorio 1.234 è un grammo e un quarto, non mille');
  await t.api('POST', `${P}/analyses`, { subject_type: 'parcel', subject_id: p.id, sampled_at: '2025-08-18', results: [{ parameter: 'zuccheri_babo', value: '15,5' }] });
  const curve = (await t.api('GET', `${P}/maturation?parcel_id=${p.id}&parameter=zuccheri_babo`)).data;
  assert.deepEqual(curve.series.map(s => [s.year, s.points.map(x => x.value)]), [[2026, [14, 16]], [2025, [15.5]]], 'annate a confronto');
  assert.equal((await t.api('POST', `${P}/analyses`, { subject_type: 'parcel', subject_id: p.id, sampled_at: '2026-08-25', results: [{ parameter: 'pressione', value: 5 }] })).status, 400, 'la pressione non si misura su una parcella');
  // Obiettivo per il bianco: almeno 18 °Babo e acidità al massimo 7 g/l.
  await t.api('PATCH', `${P}/config/harvest_targets`, { value: { bianco: { zuccheri_babo: { min: 18 }, acidita_totale: { max: 7 } } } });
  const fc = (await t.api('GET', `${P}/harvest-forecast?year=2026`)).data.rows.find(r => r.parcel_id === p.id && r.destination === 'bianco');
  assert.equal(fc.computed_from, '2026-08-30', 'zuccheri +0,2 al giorno e acidità −0,15 al giorno: entrambi il 30/8');
  await t.api('PUT', `${P}/harvest-forecast`, { parcel_id: p.id, harvest_year: 2026, destination: 'bianco', manual_date: '2026-09-02', note: 'dopo la pioggia' });
  const again = (await t.api('GET', `${P}/harvest-forecast?year=2026`)).data.rows.find(r => r.parcel_id === p.id && r.destination === 'bianco');
  assert.equal(again.date, '2026-09-02', 'la data scritta a mano vince');
  // CSV all'italiana (punto e virgola, virgola decimale, giorno/mese): si legge com'è scritto.
  const it = await upload(`parcella;data;zuccheri_babo;acidita_totale\n${p.code};09/10/2026;14,5;<7,2\n`, true);
  assert.equal(it.status, 200, JSON.stringify(it.data));
  assert.equal(it.data.preview[0].date, '2026-10-09', '09/10 è il 9 ottobre');
  assert.match(it.data.preview[0].values, /Zuccheri \(°Babo\) 14,5 · Acidità totale < 7,2/);
  const wrong = await upload(`parcella;data;zuccheri_babo\n${p.code};10/09/2026;tanti\n`, true);
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.errors[0].error, /non è un numero/);
});
