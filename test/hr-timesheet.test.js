// Fase 2, blocco 2D — presenze: righe e ripartizione, controlli bloccanti, assenze → righe nella
// stessa transazione con conflitti, stati del mese e rettifiche, squadra, proposte, export, Finance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

let seq = 0;
const center = code => t.db.prepare('SELECT id FROM cost_centers WHERE code = ?').get(code).id;
const typeId = code => t.db.prepare('SELECT id FROM absence_types WHERE code = ?').get(code).id;
const trainingId = code => t.db.prepare('SELECT id FROM training_types WHERE code = ?').get(code).id;
const emp = async (first, last, extra = {}) => (await t.api('POST', '/api/admin/hr/employees', { first_name: first, last_name: last, cost_center_id: center('P101'), ...extra })).data.id;
async function person(first, { manager = null, levels = [], workspaces = ['enoturismo'], last = 'Test' } = {}) {
  const username = `${first.toLowerCase()}-${++seq}`;
  const role = (await t.api('POST', '/api/admin/roles', { name: `R ${username}`, workspaces, access_levels: levels })).data.id;
  const u = (await t.api('POST', '/api/admin/portal-users', { name: `${first} ${last}`, email: `${username}@x.it`, username, password: 'password-lunga', role_id: role })).data.id;
  const token = (await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } })).data.key;
  const id = await emp(first, last, { portal_user_id: u, manager_id: manager });
  return { id, userId: u, call: (method, p, body) => t.request(method, p, { token, body }) };
}
const add = (who, body) => (who ? who.call('POST', '/api/admin/hr/timesheet/entries', body) : t.api('POST', '/api/admin/hr/timesheet/entries', body));
const rows = (id, date) => t.db.prepare('SELECT * FROM timesheet_entries WHERE employee_id = ? AND work_date = ? AND voided_by_adjustment_id IS NULL ORDER BY start_time').all(id, date);

test('righe: passo degli orari, centro foglia e attivo, niente sovrapposizioni, ripartizione esatta', async () => {
  const e = await emp('Remo', 'Righe');
  const base = { employee_id: e, work_date: '2027-03-01', hour_type: 'ordinaria' };
  assert.match((await add(null, { ...base, start_time: '08:30', end_time: '12:00' })).data.error, /a passi di 60 minuti/);
  await t.api('PUT', '/api/admin/hr/timesheet/settings', { granularity: 30 });
  assert.equal((await add(null, { ...base, start_time: '08:30', end_time: '12:00' })).status, 200);
  assert.match((await add(null, { ...base, start_time: '14:00', end_time: '13:00' })).data.error, /passa la mezzanotte/);
  assert.match((await add(null, { ...base, start_time: '13:00', end_time: '14:00', cost_center_id: center('P') })).data.error, /è un aggregato/);
  assert.match((await add(null, { ...base, start_time: '11:00', end_time: '13:00' })).data.error, /già ore registrate il 01\/03\/2027 dalle 08:30 alle 12:00/);
  const split = { ...base, start_time: '13:00', end_time: '17:00', allocations: [{ cost_center_id: center('P101'), minutes: 150 }, { cost_center_id: center('P02'), minutes: 60 }] };
  assert.match((await add(null, split)).data.error, /non corrisponde alla durata/);
  split.allocations[1].minutes = 90;
  const ok = await add(null, split);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(t.db.prepare('SELECT minutes FROM timesheet_allocations WHERE entry_id = ? ORDER BY id').all(ok.data.id).map(x => x.minutes), [150, 90]);
  await t.api('PUT', '/api/admin/hr/timesheet/settings', { granularity: 60 });
});

test('assenza approvata → righe dei giorni lavorativi nella stessa transazione; ore già registrate restano con un conflitto', async () => {
  const boss = await person('Bice');
  const w = await person('Walter', { manager: boss.id });
  await t.api('PUT', `/api/admin/hr/employees/${w.id}/allowances`, { counter: 'ferie', year: 2027, annual: '26', accrual: 'annuale' });
  assert.equal((await add(w, { work_date: '2027-12-23', start_time: '08:00', end_time: '12:00' })).status, 200);
  const req = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('ferie'), start_date: '2027-12-22', end_date: '2027-12-27' });
  assert.equal(req.status, 200, JSON.stringify(req.data));
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM timesheet_entries WHERE absence_id = ?').get(req.data.id).c, 0, 'la richiesta non genera righe');
  assert.equal((await boss.call('POST', `/api/admin/hr/absences/${req.data.id}/approve`)).status, 200);
  const gen = t.db.prepare('SELECT work_date, minutes FROM timesheet_entries WHERE absence_id = ? ORDER BY work_date').all(req.data.id);
  // 22, 23, 24 lavorativi; 25 Natale (sab), 26 S. Stefano (dom), 27 lun lavorativo.
  assert.deepEqual(gen.map(x => x.work_date), ['2027-12-22', '2027-12-23', '2027-12-24', '2027-12-27']);
  assert.ok(gen.every(x => x.minutes === 480));
  assert.equal(rows(w.id, '2027-12-23').filter(x => x.origin === 'manuale').length, 1, 'le ore già registrate restano');
  const conflicts = t.db.prepare('SELECT * FROM timesheet_conflicts WHERE absence_id = ?').all(req.data.id);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].work_date, '2027-12-23');
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'hr.timesheet.conflict'").get(boss.userId).c, 1);
  assert.match((await add(w, { work_date: '2027-12-22', start_time: '14:00', end_time: '16:00' })).data.error, /risulta assente \(Ferie\)/, 'sopra un giorno di ferie non si registrano ore');
  // Annullata prima del mese chiuso: righe tolte, contatore ripristinato.
  assert.equal((await w.call('POST', `/api/admin/hr/absences/${req.data.id}/cancel`)).status, 200);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM timesheet_entries WHERE absence_id = ?').get(req.data.id).c, 0);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM timesheet_conflicts WHERE absence_id = ?').get(req.data.id).c, 0);
  assert.equal(t.hrAbsences.balance(w.id, 'ferie', 2027, '2027-01-01').planned, 0);
});

test('se l\'inserimento delle righe fallisce, l\'approvazione non avviene', async () => {
  const boss = await person('Carla');
  const w = await person('Dino', { manager: boss.id });
  t.db.prepare("INSERT INTO timesheet_months (employee_id, period, status) VALUES (?, '2027-02', 'approvato')").run(w.id);
  const req = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('non_retribuito'), start_date: '2027-02-10' });
  const res = await boss.call('POST', `/api/admin/hr/absences/${req.data.id}/approve`);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /febbraio 2027 .* è già approvato/);
  assert.equal(t.db.prepare('SELECT status FROM absences WHERE id = ?').get(req.data.id).status, 'richiesta', 'tutto annullato');
});

test('malattia comunicata con protocollo: entra subito nelle presenze', async () => {
  const s = await person('Silvio');
  const m = await s.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('malattia'), start_date: '2027-04-05', end_date: '2027-04-06', protocol: 'INPS-9' });
  assert.equal(m.data.status, 'comunicata');
  assert.deepEqual(t.db.prepare('SELECT work_date FROM timesheet_entries WHERE absence_id = ? ORDER BY work_date').all(m.data.id).map(x => x.work_date), ['2027-04-05', '2027-04-06']);
});

test('mese: inviato → approvato con evento e driver "Ore lavorate"; poi solo rettifiche tracciate', async () => {
  const boss = await person('Elena');
  const w = await person('Fulvio', { manager: boss.id });
  const period = '2027-05';
  await add(w, { work_date: '2027-05-03', start_time: '08:00', end_time: '12:00', cost_center_id: center('P02') });
  await add(w, { work_date: '2027-05-03', start_time: '13:00', end_time: '17:00', cost_center_id: center('P101') });
  assert.equal((await w.call('POST', '/api/admin/hr/timesheet/months/submit', { period })).status, 200);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'hr.timesheet.submitted'").get(boss.userId).c, 1);
  assert.match((await add(w, { work_date: '2027-05-04', start_time: '08:00', end_time: '12:00' })).data.error, /in approvazione/);
  assert.equal((await w.call('POST', '/api/admin/hr/timesheet/months/approve', { employee_id: w.id, period })).status, 403, 'mai il proprio mese');
  assert.equal((await boss.call('POST', '/api/admin/hr/timesheet/months/approve', { employee_id: w.id, period })).status, 200);
  const ev = t.db.prepare("SELECT payload FROM domain_events WHERE type = 'timesheet.month_approved' ORDER BY id DESC").get();
  assert.equal(JSON.parse(ev.payload).period, period);
  const driver = () => Object.fromEntries(t.db.prepare(`SELECT c.code, v.quantity_milli FROM driver_values v JOIN allocation_drivers d ON d.id = v.driver_id JOIN cost_centers c ON c.id = v.target_center_id
    WHERE d.code = 'ore_lavorate' AND v.period = ?`).all(period).map(x => [x.code, x.quantity_milli]));
  assert.deepEqual(driver(), { P02: 4000, P101: 4000 }, 'Finance riceve le ore approvate per centro');

  const [morning] = rows(w.id, '2027-05-03');
  assert.match((await boss.call('DELETE', `/api/admin/hr/timesheet/entries/${morning.id}`)).data.error, /serve una rettifica|con una rettifica/);
  assert.equal((await boss.call('POST', '/api/admin/hr/timesheet/adjustments', { employee_id: w.id, period, reason: 'corto', void_entry_ids: [morning.id] })).status, 400);
  const adj = await boss.call('POST', '/api/admin/hr/timesheet/adjustments', {
    employee_id: w.id, period, reason: 'Mattina in cantina, non in vinificazione', void_entry_ids: [morning.id],
    add_entries: [{ work_date: '2027-05-03', start_time: '08:00', end_time: '12:00', cost_center_id: center('P03') }],
  });
  assert.equal(adj.status, 200, JSON.stringify(adj.data));
  assert.equal(t.db.prepare('SELECT voided_by_adjustment_id FROM timesheet_entries WHERE id = ?').get(morning.id).voided_by_adjustment_id, adj.data.id, 'la riga resta, annullata');
  assert.equal(rows(w.id, '2027-05-03').find(x => x.origin === 'rettifica').adjustment_id, adj.data.id);
  assert.deepEqual(driver(), { P03: 4000, P101: 4000 }, 'la rettifica aggiorna il driver');
  // Cascata confermata: il driver non si tocca più, Finance è avvisata.
  t.db.prepare("INSERT INTO allocation_runs (period, status, total_direct_cents, total_allocated_cents, snapshot, created_at) VALUES (?, 'confermata', 0, 0, '{}', 'x')").run(period);
  const r2 = rows(w.id, '2027-05-03').find(x => x.origin === 'rettifica');
  await boss.call('POST', '/api/admin/hr/timesheet/adjustments', { employee_id: w.id, period, reason: 'Pomeriggio in affinamento', void_entry_ids: [r2.id], add_entries: [{ work_date: '2027-05-03', start_time: '08:00', end_time: '12:00', cost_center_id: center('P04') }] });
  assert.deepEqual(driver(), { P03: 4000, P101: 4000 });
  assert.ok(t.db.prepare("SELECT 1 FROM notifications WHERE kind = 'finance.driver_locked' AND title LIKE '%maggio 2027%'").get());
});

test('assenza di un mese chiuso: l\'annullamento è bloccato e si fa con una rettifica', async () => {
  const boss = await person('Gina');
  const w = await person('Guido', { manager: boss.id });
  const req = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('non_retribuito'), start_date: '2027-06-07' });
  await boss.call('POST', `/api/admin/hr/absences/${req.data.id}/approve`);
  await w.call('POST', '/api/admin/hr/timesheet/months/submit', { period: '2027-06' });
  await boss.call('POST', '/api/admin/hr/timesheet/months/approve', { employee_id: w.id, period: '2027-06' });
  const blocked = await boss.call('POST', `/api/admin/hr/absences/${req.data.id}/cancel`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /serve una rettifica/);
  const adj = await boss.call('POST', '/api/admin/hr/timesheet/adjustments', { employee_id: w.id, period: '2027-06', reason: 'Il permesso non è stato preso', cancel_absence_id: req.data.id,
    add_entries: [{ work_date: '2027-06-07', start_time: '08:00', end_time: '16:00' }] });
  assert.equal(adj.status, 200, JSON.stringify(adj.data));
  assert.equal(t.db.prepare('SELECT status FROM absences WHERE id = ?').get(req.data.id).status, 'annullata');
  assert.ok(t.db.prepare('SELECT voided_by_adjustment_id FROM timesheet_entries WHERE absence_id = ?').get(req.data.id).voided_by_adjustment_id, 'la riga di assenza resta, annullata');
  assert.ok(t.db.prepare("SELECT 1 FROM domain_events WHERE type = 'absence.cancelled' AND source_id = ?").get(req.data.id));
});

test('i conflitti vanno risolti prima di approvare il mese', async () => {
  const boss = await person('Ilde');
  const w = await person('Italo', { manager: boss.id });
  await add(w, { work_date: '2027-07-05', start_time: '08:00', end_time: '10:00' });
  await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('malattia'), start_date: '2027-07-05', protocol: 'P-3' });
  await w.call('POST', '/api/admin/hr/timesheet/months/submit', { period: '2027-07' });
  const res = await boss.call('POST', '/api/admin/hr/timesheet/months/approve', { employee_id: w.id, period: '2027-07' });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /1 conflitti/);
  const c = t.db.prepare('SELECT id FROM timesheet_conflicts WHERE employee_id = ?').get(w.id);
  await boss.call('POST', `/api/admin/hr/timesheet/conflicts/${c.id}/resolve`, { note: 'ha lavorato due ore prima di sentirsi male' });
  assert.equal((await boss.call('POST', '/api/admin/hr/timesheet/months/approve', { employee_id: w.id, period: '2027-07' })).status, 200);
});

test('controlli bloccanti sulle ore: abilitazione, deroga, permesso scaduto, non idoneità, limitazioni al responsabile', async () => {
  const op = (await t.api('POST', '/api/admin/finance/cost-objects', { type: 'operazione', code: 'OP-TS-FITO', name: 'Trattamento fitosanitario' })).data.id;
  await t.api('PUT', `/api/admin/hr/operations/${op}/trainings`, { training_type_ids: [trainingId('fitosanitari')] });
  const boss = await person('Lorena');
  const w = await person('Luca', { manager: boss.id });
  const row = { employee_id: w.id, work_date: '2027-08-02', start_time: '07:00', end_time: '11:00', cost_center_id: center('P101'), cost_object_id: op };
  const blocked = await add(null, row);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /manca l'abilitazione «Certificato di abilitazione all'uso dei prodotti fitosanitari» richiesta per «Trattamento fitosanitario»/);
  const roleId = t.db.prepare("SELECT id FROM job_roles WHERE code = 'operaio_agricolo'").get().id;
  await t.api('POST', `/api/admin/hr/employees/${w.id}/contracts`, { effective_from: '2027-01-01', contract_type: 'OTI', job_role_id: roleId });
  await t.api('POST', `/api/admin/hr/employees/${w.id}/waivers`, { training_type_id: trainingId('fitosanitari'), cost_object_id: op, valid_from: '2027-07-01', valid_to: '2027-08-31', reason: 'Corso prenotato per settembre, affiancato' });
  const ok = await add(null, row);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.match(ok.data.warnings.join(), /deroga del responsabile sicurezza/);

  await t.api('POST', `/api/admin/hr/employees/${w.id}/identity-documents`, { doc_type: 'permesso_soggiorno', number: 'PS1', expires_on: '2027-08-10' });
  const permit = await add(null, { ...row, work_date: '2027-08-16', cost_object_id: null });
  assert.equal(permit.status, 409);
  assert.match(permit.data.error, /permesso di soggiorno scaduto il 2027-08-10/);

  const f = await person('Mirko', { manager: boss.id });
  const op2 = (await t.api('POST', '/api/admin/finance/cost-objects', { type: 'operazione', code: 'OP-TS-VASCHE', name: 'Pulizia vasche' })).data.id;
  await t.api('POST', `/api/admin/hr/employees/${f.id}/medical-visits`, { visit_type: 'periodica', visit_date: '2026-09-01', judgment: 'idoneo_prescrizioni', limitations: 'No sollevamento carichi oltre 15 kg', restricted_cost_object_ids: [op2] });
  const lim = await add(null, { employee_id: f.id, work_date: '2027-08-03', start_time: '08:00', end_time: '10:00', cost_center_id: center('P02'), cost_object_id: op2 });
  assert.equal(lim.status, 200);
  assert.match(lim.data.warnings.join(), /limitazioni incompatibili con «Pulizia vasche»/);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'hr.timesheet.limitations'").get(boss.userId).c, 1, 'il responsabile è avvisato');
  await t.api('POST', `/api/admin/hr/employees/${f.id}/medical-visits`, { visit_type: 'su_richiesta', visit_date: '2026-09-10', judgment: 'non_idoneo' });
  const unfit = await add(null, { employee_id: f.id, work_date: '2027-08-04', start_time: '08:00', end_time: '10:00', cost_center_id: center('P02') });
  assert.equal(unfit.status, 409);
  assert.match(unfit.data.error, /non è assegnabile: giudizio di non idoneità/);
});

test('squadra: il caposquadra registra per tutti; se qualcuno è bloccato non si registra nulla e si dice chi', async () => {
  const leader = await person('Nerio');
  const a = await emp('Aldo', 'Squadra');
  const b = await emp('Bruno', 'Squadra');
  const team = (await t.api('POST', '/api/admin/hr/teams', { name: 'Vendemmia 2027', leader_employee_id: leader.id, member_ids: [a, b] })).data.id;
  const op = (await t.api('POST', '/api/admin/finance/cost-objects', { type: 'operazione', code: 'OP-TS-TRATT', name: 'Guida trattore' })).data.id;
  await t.api('PUT', `/api/admin/hr/operations/${op}/trainings`, { training_type_ids: [trainingId('trattori')] });
  await t.api('POST', `/api/admin/hr/employees/${a}/trainings`, { training_type_id: trainingId('trattori'), completed_on: '2026-01-10' });
  const body = { team_id: team, work_date: '2027-09-13', start_time: '07:00', end_time: '12:00', cost_center_id: center('P101'), cost_object_id: op };
  const refused = await leader.call('POST', '/api/admin/hr/timesheet/team', body);
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.data.members.map(m => m.name).sort(), ['Bruno Squadra', 'Nerio Test'], "il caposquadra è nella squadra e non ha l'abilitazione");
  assert.equal(rows(a, '2027-09-13').length, 0, 'tutto o niente');
  const ok = await leader.call('POST', '/api/admin/hr/timesheet/team', { ...body, member_ids: [a] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.ids.length, 1);
  assert.equal(rows(a, '2027-09-13')[0].origin, 'squadra');
  const outsider = await person('Oreste');
  assert.equal((await outsider.call('POST', '/api/admin/hr/timesheet/team', { ...body, member_ids: [a] })).status, 403);
});

test('righe proposte: prenotazioni assegnate e fiere del responsabile; si accettano o si scartano, mai da sole', async () => {
  const op = await person('Paola', { last: 'Proposte' });
  const operatorId = t.db.prepare('SELECT id FROM operators WHERE portal_user_id = ?').get(op.userId).id;
  const slot = (await t.api('POST', '/api/admin/slots', { experience_id: 1, date: '2027-10-04', time: '10:00', capacity: 10 })).data.id;
  const bk = (await t.api('POST', '/api/admin/bookings/manual', { experience_id: 1, slot_id: slot, customer_name: 'Ospite', email: 'ospite-ts@x.it', guests: 2, status: 'confermata' })).data.id;
  await t.api('PATCH', `/api/admin/bookings/${bk}`, { operator_id: operatorId });
  const expObj = (await t.api('POST', '/api/admin/finance/cost-objects', { type: 'esperienza', code: 'ESP-1', name: 'Visita classica', experience_id: 1 })).data.id;
  const fair = t.db.prepare("INSERT INTO fairs (name, location, start_date, end_date, responsible_name, status) VALUES ('Vinitaly', 'Verona', '2027-10-06', '2027-10-07', 'proposte  PAOLA', 'confermata')").run().lastInsertRowid;
  const view = (await op.call('GET', '/api/admin/hr/timesheet/month?period=2027-10')).data;
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM timesheet_entries WHERE employee_id = ?').get(op.id).c, 0, 'nessuna riga automatica');
  const visit = view.proposals.find(p => p.source === 'prenotazione');
  assert.deepEqual([visit.work_date, visit.start_time, visit.end_time, visit.cost_center, visit.cost_object_id], ['2027-10-04', '10:00', '12:00', 'C05 Enoturismo — visite', expObj]);
  assert.deepEqual(view.proposals.filter(p => p.source === 'fiera').map(p => p.work_date), ['2027-10-06', '2027-10-07'], 'responsabile abbinato per nome, senza badare a ordine e maiuscole');
  const acc = await op.call('POST', '/api/admin/hr/timesheet/proposals/accept', { source: 'prenotazione', source_id: bk, work_date: '2027-10-04' });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(rows(op.id, '2027-10-04')[0].origin, 'proposta');
  await op.call('POST', '/api/admin/hr/timesheet/proposals/dismiss', { source: 'fiera', source_id: Number(fair), work_date: '2027-10-07' });
  const after = (await op.call('GET', '/api/admin/hr/timesheet/month?period=2027-10')).data.proposals;
  assert.deepEqual(after.map(p => `${p.source}:${p.work_date}`), ['fiera:2027-10-06']);
  // Omonimi: nessun abbinamento.
  await emp('Paola', 'Proposte');
  assert.equal(t.hrTimesheet.matchEmployeeByName('Paola Proposte'), null);
});

test('export per il consulente: solo mesi approvati, giornate lavorate, virgola decimale; serve il livello personale', async () => {
  const boss = await person('Quinto');
  const w = await person('Rosa', { manager: boss.id, last: 'Export' });
  await t.api('PUT', `/api/admin/hr/employees/${w.id}/personal`, { fiscal_code: 'RSSRSO80A41G482Q' });
  await t.api('POST', `/api/admin/hr/employees/${w.id}/contracts`, { effective_from: '2027-01-01', contract_type: 'OTD', end_date: '2027-12-31' });
  await add(w, { work_date: '2027-11-02', start_time: '08:00', end_time: '12:30', hour_type: 'ordinaria' }).then(r => assert.equal(r.status, 400, 'passo di 60 minuti'));
  await add(w, { work_date: '2027-11-02', start_time: '08:00', end_time: '12:00' });
  await add(w, { work_date: '2027-11-02', start_time: '13:00', end_time: '19:00', hour_type: 'straordinaria' });
  await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('malattia'), start_date: '2027-11-03', protocol: 'P-4' });
  const csv = () => t.hrTimesheet.exportRows('2027-11', false).map(l => l.join(';'));
  assert.ok(!csv().some(l => l.includes('RSSRSO80A41G482Q')), 'mese non approvato: fuori');
  await w.call('POST', '/api/admin/hr/timesheet/months/submit', { period: '2027-11' });
  await boss.call('POST', '/api/admin/hr/timesheet/months/approve', { employee_id: w.id, period: '2027-11' });
  const lines = csv();
  assert.equal(lines[0], 'Codice fiscale;Cognome;Nome;Tipo contratto;Data;Giornata lavorata;Ore ordinarie;Ore straordinarie;Ore notturne;Ore festive;Assenza;Ore assenza');
  assert.ok(lines.includes('RSSRSO80A41G482Q;Export;Rosa;OTD;02/11/2027;1;4;6;0;0;;0'));
  assert.ok(lines.includes('RSSRSO80A41G482Q;Export;Rosa;OTD;03/11/2027;0;0;0;0;0;Malattia;8'));
  assert.equal((await boss.call('GET', '/api/admin/hr/timesheet/export/2027-11')).status, 403);
  const signed = (await t.api('GET', '/api/admin/signed-url?path=' + encodeURIComponent('/api/admin/hr/timesheet/export/2027-11'))).data.url;
  const res = await fetch(t.base + signed);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /presenze-2027-11\.csv/);
});

test('un dipendente con presenze non si elimina, e nemmeno un centro con ore imputate', async () => {
  const d = await emp('Zeno', 'Presenze');
  await add(null, { employee_id: d, work_date: '2027-12-01', start_time: '08:00', end_time: '12:00' });
  assert.match((await t.api('DELETE', `/api/admin/hr/employees/${d}`)).data.error, /presenze registrate/);
  const parent = t.db.prepare("SELECT id FROM cost_centers WHERE code = 'P'").get().id;
  const c = (await t.api('POST', '/api/admin/finance/cost-centers', { code: 'P09', name: 'Centro ore', parent_id: parent, cascade_level: 3 })).data.id;
  const e2 = await emp('Ugo', 'Centro', { cost_center_id: null });
  await add(null, { employee_id: e2, work_date: '2027-12-02', start_time: '08:00', end_time: '12:00', cost_center_id: c });
  const del = await t.api('DELETE', `/api/admin/finance/cost-centers/${c}`);
  assert.equal(del.status, 409);
  assert.match(del.data.error, /ha movimenti/);
});

test('utenza e scheda dipendente: da Impostazioni si crea insieme o si collega; tutto o niente', async () => {
  const mk = (username, employee) => t.api('POST', '/api/admin/portal-users', { name: 'Giulia Nuova Assunta', email: `${username}@x.it`, username, password: 'password-lunga', employee });
  const created = await mk('giulia-ts', { mode: 'create' });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const e = t.db.prepare('SELECT * FROM employees WHERE id = ?').get(created.data.employee_id);
  assert.deepEqual([e.first_name, e.last_name, e.work_email, e.portal_user_id], ['Giulia', 'Nuova Assunta', 'giulia-ts@x.it', created.data.id], 'nome, cognome ed email dall\'utenza');
  assert.ok(e.site_id, 'nella sede principale');
  const listed = (await t.api('GET', '/api/admin/portal-users')).data.find(u => u.id === created.data.id);
  assert.equal(listed.employee_name, 'Giulia Nuova Assunta');

  const other = await emp('Ivo', 'Esistente');
  const linked = await mk('ivo-ts', { mode: 'existing', employee_id: other });
  assert.equal(t.db.prepare('SELECT portal_user_id FROM employees WHERE id = ?').get(other).portal_user_id, linked.data.id);
  const taken = await mk('ivo-bis', { mode: 'existing', employee_id: other });
  assert.equal(taken.status, 409, 'la scheda ha già un\'utenza');
  assert.ok(!t.db.prepare("SELECT 1 FROM portal_users WHERE username = 'ivo-bis'").get(), 'se la scheda non si collega, l\'utenza non nasce');

  assert.equal((await t.api('PATCH', `/api/admin/portal-users/${linked.data.id}`, { employee: { mode: 'none' } })).status, 200);
  assert.equal(t.db.prepare('SELECT portal_user_id FROM employees WHERE id = ?').get(other).portal_user_id, null, 'scollegata, la scheda resta');
  assert.equal((await t.api('PATCH', `/api/admin/portal-users/${linked.data.id}`, { employee: { mode: 'existing', employee_id: other } })).status, 200);
  const opts = (await t.api('GET', '/api/admin/portal-users/employee-options')).data;
  assert.equal(opts.find(o => o.id === other).portal_user_id, linked.data.id);
  const noUser = (await mk('esterno-ts')).data.id;
  assert.ok(!t.db.prepare('SELECT 1 FROM employees WHERE portal_user_id = ?').get(noUser), 'senza scelta via API non si crea nulla');
});

test('promemoria: giorno di ieri scoperto al dipendente, fine mese da inviare, mese precedente non inviato al responsabile', async () => {
  const capo = await person('Rita', { last: 'Responsabile' });
  const p = await person('Otto', { manager: capo.id, last: 'Promemoria' });
  await t.api('PUT', `/api/admin/hr/employees/${p.id}/schedule`, { valid_from: '2028-01-01', days: { 1: '8', 2: '8', 3: '8', 4: '8', 5: '8' } });
  t.db.prepare("INSERT INTO settings (key, value) VALUES ('timesheet_reminders_since', '2028-05-01') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  const notes = (u, kind) => t.db.prepare('SELECT * FROM notifications WHERE user_id = ? AND kind = ? ORDER BY id').all(u, kind);

  t.hrTimesheet.sendReminders(new Date('2028-06-07T05:00:00Z')); // 7:00 in Italia: troppo presto
  assert.equal(notes(p.userId, 'hr.timesheet.missing-day').length, 0);
  await add(null, { employee_id: p.id, work_date: '2028-06-06', start_time: '08:00', end_time: '12:00', hour_type: 'ordinaria', cost_center_id: center('P101') });
  t.hrTimesheet.sendReminders(new Date('2028-06-07T08:00:00Z'));
  t.hrTimesheet.sendReminders(new Date('2028-06-07T09:00:00Z'));
  const missing = notes(p.userId, 'hr.timesheet.missing-day');
  assert.equal(missing.length, 1, 'una volta sola');
  assert.match(missing[0].title, /06\/06\/2028/);
  assert.match(missing[0].body, /4 h su 8 h/);
  const late = notes(capo.userId, 'hr.timesheet.late').find(n => /maggio 2028/.test(n.title));
  assert.ok(late && late.body.includes('Otto Promemoria'), 'il responsabile vede chi non ha inviato maggio');
  assert.equal(notes(capo.userId, 'hr.timesheet.missing-day').length, 1, 'anche senza orario contrattuale: vale quello standard');

  t.hrTimesheet.sendReminders(new Date('2028-06-30T14:00:00Z')); // ultimo giorno del mese, 16:00
  assert.ok(notes(p.userId, 'hr.timesheet.submit-reminder').some(n => /giugno 2028/.test(n.title)));
  await p.call('POST', '/api/admin/hr/timesheet/months/submit', { employee_id: p.id, period: '2028-07' });
  await add(null, { employee_id: p.id, work_date: '2028-07-03', start_time: '08:00', end_time: '16:00', hour_type: 'ordinaria', cost_center_id: center('P101') }).catch(() => {});
  const before = notes(p.userId, 'hr.timesheet.missing-day').length;
  t.hrTimesheet.sendReminders(new Date('2028-07-04T08:00:00Z'));
  assert.equal(notes(p.userId, 'hr.timesheet.missing-day').length, before, 'giorno coperto: nessun avviso');
});

test('promemoria: al primo avvio non si avvisa per il passato', () => {
  t.db.prepare("DELETE FROM settings WHERE key = 'timesheet_reminders_since'").run();
  const before = t.db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE kind LIKE 'hr.timesheet.%'").get().c;
  t.hrTimesheet.sendReminders(new Date('2029-03-05T09:00:00Z'));
  assert.equal(t.db.prepare("SELECT value FROM settings WHERE key = 'timesheet_reminders_since'").get().value, '2029-03-05');
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE kind LIKE 'hr.timesheet.%'").get().c, before, "né ieri né febbraio: prima dell'avvio");
});
