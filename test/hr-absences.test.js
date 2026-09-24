// Fase 2, blocco 2C — assenze: giorni lavorativi, approvazioni e livelli, contatori e ferie arretrate,
// periodi di blocco, malattia comunicata, delegato, annullamento con ganci, visita di rientro,
// infortunio → assenza, disponibilità degli operatori dell'Enoturismo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const iso = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const typeId = code => t.db.prepare('SELECT id FROM absence_types WHERE code = ?').get(code).id;
const emp = async (first, last, extra = {}) => (await t.api('POST', '/api/admin/hr/employees', { first_name: first, last_name: last, ...extra })).data.id;
let seq = 0;
// Utente del portale (ruolo con i workspace indicati) collegato a un nuovo dipendente.
async function person(first, { workspaces = ['enoturismo'], levels = [], manager = null } = {}) {
  const username = `${first.toLowerCase()}-${++seq}`;
  const role = (await t.api('POST', '/api/admin/roles', { name: `R ${username}`, workspaces, access_levels: levels })).data.id;
  const u = (await t.api('POST', '/api/admin/portal-users', { name: `${first} Test`, email: `${username}@x.it`, username, password: 'password-lunga', role_id: role })).data.id;
  const token = (await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } })).data.key;
  const id = await emp(first, 'Test', { portal_user_id: u, manager_id: manager });
  return { id, userId: u, call: (method, p, body) => t.request(method, p, { token, body }) };
}
const request = (who, body) => who.call('POST', '/api/admin/hr/absences', body);
const notesFor = (userId, kind) => t.db.prepare('SELECT * FROM notifications WHERE user_id = ? AND kind = ? ORDER BY id').all(userId, kind);
const setAllowance = (id, counter, year, annual, extra = {}) => t.api('PUT', `/api/admin/hr/employees/${id}/allowances`, { counter, year, annual, ...extra });

test('giorni lavorativi: orario, weekend e festività; mezza giornata e ore', async () => {
  const e = await emp('Gino', 'Giorni', { site_id: 1 });
  const { measure } = t.hrAbsences;
  const E = t.db.prepare('SELECT * FROM employees WHERE id = ?').get(e);
  const T = code => t.db.prepare('SELECT * FROM absence_types WHERE code = ?').get(code);
  // 21-27/12/2026: lun-gio lavorativi, 25 Natale (ven), 26 S. Stefano (sab), 27 domenica.
  assert.equal(measure(E, T('ferie'), { start_date: '2026-12-21', end_date: '2026-12-27', part: 'giorno' }).amount, 4000);
  assert.equal(measure(E, T('ferie'), { start_date: '2026-12-22', end_date: '2026-12-22', part: 'mattina' }).amount, 500);
  const rol = measure(E, T('rol'), { start_date: '2026-12-22', end_date: '2026-12-22', part: 'ore', start_time: '09:00', end_time: '11:30' });
  assert.equal(rol.amount, 150, 'il ROL si conta in minuti');
  await t.api('PUT', `/api/admin/hr/employees/${e}/schedule`, { valid_from: '2026-01-01', days: { 1: '6', 2: '6', 3: '6', 4: '6', 5: '6', 6: '4' } });
  const withSaturday = measure(E, T('ferie'), { start_date: '2026-12-21', end_date: '2026-12-27', part: 'giorno' });
  assert.equal(withSaturday.amount, 4000, 'il sabato 26 è festivo anche con l\'orario del sabato');
  assert.equal(withSaturday.work_minutes, 4 * 360);
  assert.throws(() => measure(E, T('ferie'), { start_date: '2026-12-26', end_date: '2026-12-27', part: 'giorno' }), /non ci sono giorni lavorativi/);
});

test('richiesta → approvazione del responsabile: contatore aggiornato, notifiche, nessuno approva la propria', async () => {
  const boss = await person('Bruna');
  const worker = await person('Walter', { manager: boss.id });
  const colleague = await person('Cesare', { manager: boss.id });
  await setAllowance(worker.id, 'ferie', 2027, '26', { accrual: 'annuale' });
  const res = await request(worker, { absence_type_id: typeId('ferie'), start_date: '2027-08-09', end_date: '2027-08-13' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.status, 'richiesta');
  const a = t.db.prepare('SELECT * FROM absences WHERE id = ?').get(res.data.id);
  assert.equal(a.approver_employee_id, boss.id);
  assert.equal(a.amount, 5000);
  assert.equal(notesFor(boss.userId, 'hr.absence.requested').length, 1, 'il responsabile è avvisato');
  assert.equal(t.hrAbsences.balance(worker.id, 'ferie', 2027, '2027-01-10').pending, 5000);

  assert.equal((await worker.call('POST', `/api/admin/hr/absences/${a.id}/approve`)).status, 403, 'mai la propria');
  assert.equal((await colleague.call('POST', `/api/admin/hr/absences/${a.id}/approve`)).status, 403, 'un collega no');
  assert.equal((await boss.call('POST', `/api/admin/hr/absences/${a.id}/reject`, {})).status, 400, 'il rifiuto vuole un motivo');
  assert.equal((await boss.call('POST', `/api/admin/hr/absences/${a.id}/approve`)).status, 200);
  const b = t.hrAbsences.balance(worker.id, 'ferie', 2027, '2027-01-10');
  assert.deepEqual([b.pending, b.planned, b.available], [0, 5000, 21000]);
  assert.equal(notesFor(worker.userId, 'hr.absence.decided').length, 1, 'il dipendente sa che è approvata');
  // Visibilità: il collega non vede le assenze degli altri, il responsabile sì.
  assert.ok(!(await colleague.call('GET', '/api/admin/hr/absences')).data.some(x => x.id === a.id));
  assert.ok((await boss.call('GET', '/api/admin/hr/absences')).data.some(x => x.id === a.id));
});

test('quando il richiedente è il responsabile, l\'approvazione sale di un livello', async () => {
  const top = await person('Tina');
  const mid = await person('Mauro', { manager: top.id });
  const low = await person('Lia', { manager: mid.id });
  const own = await request(mid, { absence_type_id: typeId('non_retribuito'), start_date: '2027-03-01' });
  assert.equal(t.db.prepare('SELECT approver_employee_id FROM absences WHERE id = ?').get(own.data.id).approver_employee_id, top.id);
  const forReport = await request(mid, { employee_id: low.id, absence_type_id: typeId('non_retribuito'), start_date: '2027-03-02' });
  assert.equal(forReport.status, 200, JSON.stringify(forReport.data));
  assert.equal(t.db.prepare('SELECT approver_employee_id FROM absences WHERE id = ?').get(forReport.data.id).approver_employee_id, top.id, 'chi inserisce per un collaboratore non si approva da solo');
  assert.equal((await mid.call('POST', `/api/admin/hr/absences/${forReport.data.id}/approve`)).status, 403);
  assert.equal((await top.call('POST', `/api/admin/hr/absences/${forReport.data.id}/approve`)).status, 200);
  const stranger = await person('Sandro');
  assert.equal((await request(stranger, { employee_id: low.id, absence_type_id: typeId('non_retribuito'), start_date: '2027-03-03' })).status, 403, 'per gli altri no');
});

test('contatori: maturazione mensile, riporto dall\'anno prima, blocco oltre il residuo configurabile', async () => {
  const p = await person('Paola');
  await setAllowance(p.id, 'ferie', 2026, '24');
  await setAllowance(p.id, 'ferie', 2027, '24');
  const { balance } = t.hrAbsences;
  assert.equal(balance(p.id, 'ferie', 2026, '2026-07-15').accrued, 12000, '6 mesi maturati su 24 giorni l\'anno');
  assert.equal(balance(p.id, 'ferie', 2027, '2027-01-05').opening, 24000, 'riporto: tutte le ferie 2026 non godute');
  await setAllowance(p.id, 'rol', 2027, '2'); // 2 ore
  const over = await request(p, { absence_type_id: typeId('rol'), start_date: '2027-02-03', part: 'ore', start_time: '09:00', end_time: '12:00' });
  assert.equal(over.status, 409);
  assert.match(over.data.error, /Residuo ROL 2027 insufficiente: disponibili 2 h, richiesti 3 h/);
  await t.api('PUT', '/api/admin/hr/absence-settings', { over_balance: 'avvisa' });
  const warned = await request(p, { absence_type_id: typeId('rol'), start_date: '2027-02-03', part: 'ore', start_time: '09:00', end_time: '12:00' });
  assert.equal(warned.status, 200);
  assert.match(warned.data.warnings.join(), /insufficiente/);
  await t.api('PUT', '/api/admin/hr/absence-settings', { over_balance: 'blocca' });
});

test('ferie arretrate: si consumano dalla più vecchia e scadono il 30/06 del secondo anno successivo', async () => {
  const f = await emp('Fede', 'Ferie');
  await setAllowance(f, 'ferie', 2024, '26', { accrual: 'annuale', opening: '0' });
  await setAllowance(f, 'ferie', 2025, '26', { accrual: 'annuale' });
  t.db.prepare(`INSERT INTO absences (employee_id, absence_type_id, start_date, end_date, amount, status, created_at, updated_at) VALUES (?, ?, '2025-07-01', '2025-07-28', 20000, 'approvata', 'x', 'x')`).run(f, typeId('ferie'));
  const arrears = t.hrAbsences.vacationArrears(f, '2026-01-15');
  assert.deepEqual(arrears, [{ year: 2024, amount: 6000, due_date: '2026-06-30' }, { year: 2025, amount: 26000, due_date: '2027-06-30' }]);
});

test('periodo di blocco: avviso al responsabile oppure divieto; non vale per le comunicazioni', async () => {
  const boss = await person('Vera');
  const w = await person('Ugo', { manager: boss.id });
  await setAllowance(w.id, 'ferie', 2027, '26', { accrual: 'annuale' });
  await t.api('POST', '/api/admin/hr/absence-block-periods', { name: 'Vendemmia 2027', start_date: '2027-09-01', end_date: '2027-10-15', mode: 'avviso' });
  const warned = await request(w, { absence_type_id: typeId('ferie'), start_date: '2027-09-06', end_date: '2027-09-07' });
  assert.equal(warned.status, 200);
  assert.match(warned.data.warnings[0], /Vendemmia 2027/);
  assert.match(notesFor(boss.userId, 'hr.absence.requested').at(-1).body, /periodo «Vendemmia 2027»/);
  await t.api('POST', '/api/admin/hr/absence-block-periods', { name: 'Imbottigliamento', start_date: '2027-11-02', end_date: '2027-11-05', mode: 'blocco' });
  const blocked = await request(w, { absence_type_id: typeId('ferie'), start_date: '2027-11-03' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /Periodo bloccato: «Imbottigliamento»/);
  assert.equal((await request(w, { absence_type_id: typeId('malattia'), start_date: '2027-11-03', protocol: 'INPS-1' })).status, 200, 'la malattia si comunica comunque');
});

test('malattia: protocollo obbligatorio, subito valida (ganci) e il responsabile è avvisato; poi presa visione', async () => {
  const calls = [];
  t.hrAbsences.registerEffectHook({ apply: a => calls.push(['apply', a.id, a.status]), revert: a => calls.push(['revert', a.id]) });
  const boss = await person('Marta');
  const s = await person('Sergio', { manager: boss.id });
  assert.equal((await request(s, { absence_type_id: typeId('malattia'), start_date: iso(0), end_date: iso(2) })).status, 400);
  const m = await request(s, { absence_type_id: typeId('malattia'), start_date: iso(0), end_date: iso(2), protocol: '2026-123456' });
  assert.equal(m.data.status, 'comunicata');
  assert.deepEqual(calls.find(c => c[1] === m.data.id), ['apply', m.data.id, 'comunicata'], 'entra subito nelle presenze');
  const n = notesFor(boss.userId, 'hr.absence.communicated');
  assert.equal(n.length, 1);
  assert.match(n[0].body, /Protocollo 2026-123456/);
  assert.equal((await boss.call('POST', `/api/admin/hr/absences/${m.data.id}/acknowledge`)).status, 200);
  assert.equal(t.db.prepare('SELECT status FROM absences WHERE id = ?').get(m.data.id).status, 'presa_visione');
});

test('richiesta in attesa oltre N giorni: passa al delegato una volta sola, e il delegato può decidere', async () => {
  const boss = await person('Olga');
  const deputy = await person('Dario');
  const w = await person('Nina', { manager: boss.id });
  await t.api('PATCH', `/api/admin/hr/employees/${w.id}`, { delegate_id: deputy.id });
  const res = await request(w, { absence_type_id: typeId('non_retribuito'), start_date: '2027-05-10' });
  assert.equal((await deputy.call('POST', `/api/admin/hr/absences/${res.data.id}/approve`)).status, 403, 'prima dell\'attesa decide il responsabile');
  t.db.prepare('UPDATE absences SET submitted_at = ? WHERE id = ?').run(new Date(Date.now() - 4 * 86400000).toISOString(), res.data.id);
  assert.equal(t.hrAbsences.escalatePending(), 1);
  assert.equal(t.hrAbsences.escalatePending(), 0, 'idempotente');
  assert.equal(notesFor(deputy.userId, 'hr.absence.escalated').length, 1);
  assert.equal((await deputy.call('POST', `/api/admin/hr/absences/${res.data.id}/approve`)).status, 200);
});

test('annullamento di un\'assenza approvata: contatore ripristinato, ganci; se un gancio rifiuta non cambia nulla', async () => {
  const boss = await person('Rita');
  const w = await person('Aldo', { manager: boss.id });
  await setAllowance(w.id, 'ferie', 2027, '26', { accrual: 'annuale' });
  const res = await request(w, { absence_type_id: typeId('ferie'), start_date: '2027-04-12', end_date: '2027-04-13' });
  await boss.call('POST', `/api/admin/hr/absences/${res.data.id}/approve`);
  assert.equal(t.hrAbsences.balance(w.id, 'ferie', 2027, '2027-01-01').planned, 2000);
  let refuse = true;
  t.hrAbsences.registerEffectHook({ revert: a => { if (refuse && a.id === res.data.id) throw Object.assign(new Error('Mese chiuso: serve una rettifica.'), { status: 409 }); } });
  const blocked = await boss.call('POST', `/api/admin/hr/absences/${res.data.id}/cancel`);
  assert.equal(blocked.status, 409);
  assert.equal(t.db.prepare('SELECT status FROM absences WHERE id = ?').get(res.data.id).status, 'approvata', 'la transazione è annullata');
  refuse = false;
  assert.equal((await w.call('POST', `/api/admin/hr/absences/${res.data.id}/cancel`)).status, 200, 'non ancora iniziata: la annulla anche il dipendente');
  assert.equal(t.hrAbsences.balance(w.id, 'ferie', 2027, '2027-01-01').planned, 0);
  assert.ok(t.db.prepare("SELECT 1 FROM domain_events WHERE type = 'absence.cancelled' AND source_id = ?").get(res.data.id));
});

test('assenze sovrapposte rifiutate; mattina e pomeriggio dello stesso giorno sì', async () => {
  const p = await person('Piero');
  await setAllowance(p.id, 'ferie', 2027, '26', { accrual: 'annuale' });
  assert.equal((await request(p, { absence_type_id: typeId('ferie'), start_date: '2027-06-07', part: 'mattina' })).status, 200);
  assert.equal((await request(p, { absence_type_id: typeId('ferie'), start_date: '2027-06-07', part: 'pomeriggio' })).status, 200);
  const clash = await request(p, { absence_type_id: typeId('ferie'), start_date: '2027-06-07', end_date: '2027-06-08' });
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /già un'assenza nello stesso periodo/);
});

test('oltre 60 giorni continuativi di assenza per salute: attività "visita di rientro", una volta sola', async () => {
  const roleId = t.db.prepare("SELECT id FROM job_roles WHERE code = 'cantiniere'").get().id;
  const c = await emp('Carmine', 'Rientro');
  await t.api('POST', `/api/admin/hr/employees/${c}/contracts`, { effective_from: '2025-01-01', contract_type: 'OTI', job_role_id: roleId });
  const ins = (s, e2) => t.db.prepare(`INSERT INTO absences (employee_id, absence_type_id, start_date, end_date, amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'comunicata', 'x', 'x')`).run(c, typeId('malattia'), s, e2);
  ins(iso(-80), iso(-41));
  ins(iso(-40), iso(-5)); // certificati consecutivi: un solo periodo di 76 giorni
  assert.equal(t.hrAbsences.createReturnVisits(), 1);
  assert.equal(t.hrAbsences.createReturnVisits(), 0, 'idempotente');
  const task = t.db.prepare("SELECT * FROM hr_tasks WHERE employee_id = ? AND kind = 'visita_rientro'").get(c);
  assert.equal(task.due_date, iso(-4));
  assert.match(task.title, /76 giorni/);
  const short = await emp('Sonia', 'Breve');
  await t.api('POST', `/api/admin/hr/employees/${short}/contracts`, { effective_from: '2025-01-01', contract_type: 'OTI', job_role_id: roleId });
  t.db.prepare(`INSERT INTO absences (employee_id, absence_type_id, start_date, end_date, amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'comunicata', 'x', 'x')`).run(short, typeId('malattia'), iso(-50), iso(-5));
  t.hrAbsences.createReturnVisits();
  assert.ok(!t.db.prepare("SELECT 1 FROM hr_tasks WHERE employee_id = ? AND kind = 'visita_rientro'").get(short), '46 giorni: niente visita');
});

test('infortunio registrato: assenza Infortunio collegata dal giorno dopo, con il numero INAIL; la prognosi aggiorna le date', async () => {
  const i = await emp('Ivan', 'Infortunato');
  const inc = await t.api('POST', '/api/admin/hr/incidents', { kind: 'infortunio', employee_id: i, occurred_on: iso(-3), dynamics: 'Taglio alla mano in vendemmia', prognosis_days: 5 });
  assert.equal(inc.status, 200, JSON.stringify(inc.data));
  let a = t.db.prepare('SELECT * FROM absences WHERE incident_id = ?').get(inc.data.id);
  assert.ok(a, 'assenza creata');
  assert.deepEqual([a.status, a.start_date, a.end_date], ['comunicata', iso(-2), iso(2)]);
  assert.equal(a.absence_type_id, typeId('infortunio'));
  await t.api('PATCH', `/api/admin/hr/incidents/${inc.data.id}`, { prognosis_days: 8, inail_number: 'INAIL-77', inail_date: iso(-1) });
  a = t.db.prepare('SELECT * FROM absences WHERE incident_id = ?').get(inc.data.id);
  assert.deepEqual([a.end_date, a.inail_number], [iso(5), 'INAIL-77']);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM absences WHERE incident_id = ?').get(inc.data.id).c, 1);
});

test('Enoturismo: operatore assente non assegnabile, conflitto segnalato, avviso sulla lingua', async () => {
  const op = await person('Olivia');
  await t.api('POST', `/api/admin/hr/employees/${op.id}/skills`, { kind: 'lingua', name: 'it' });
  const operatorId = t.db.prepare('SELECT id FROM operators WHERE portal_user_id = ?').get(op.userId).id;
  const day = '2030-07-15';
  const slot = (await t.api('POST', '/api/admin/slots', { experience_id: 1, date: day, time: '10:00', capacity: 20 })).data.id;
  const book = async lang => {
    const id = (await t.api('POST', '/api/admin/bookings/manual', { experience_id: 1, slot_id: slot, customer_name: 'Cliente', email: `c${++seq}@x.it`, guests: 2 })).data.id;
    t.db.prepare('UPDATE bookings SET language = ? WHERE id = ?').run(lang, id);
    return id;
  };
  const english = await book('en');
  const warn = await t.api('PATCH', `/api/admin/bookings/${english}`, { operator_id: operatorId });
  assert.equal(warn.status, 200);
  assert.match(warn.data.warnings[0], /non parla inglese/);
  const assignedBefore = await book('it');
  await t.api('PATCH', `/api/admin/bookings/${assignedBefore}`, { operator_id: operatorId });

  await t.api('POST', '/api/admin/hr/absences', { employee_id: op.id, absence_type_id: typeId('malattia'), start_date: day, protocol: 'P-1' });
  const n = t.db.prepare("SELECT * FROM notifications WHERE kind = 'enoturismo.operator_absent' AND user_id IS NULL").all();
  assert.ok(n.some(x => /Olivia Test è assente il 15\/07\/2030/.test(x.title)), 'le prenotazioni già assegnate sono segnalate');
  assert.ok(!n.some(x => /malattia/i.test(x.title + x.body)), 'senza dire il motivo');
  const list = (await t.api('GET', `/api/admin/bookings?from=${day}&to=${day}`)).data;
  assert.match(list.find(b => b.id === assignedBefore).operator_conflict, /è assente/);
  const later = await book('it');
  const refused = await t.api('PATCH', `/api/admin/bookings/${later}`, { operator_id: operatorId });
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /non è assegnabile a questa visita/);
  const avail = (await t.api('GET', `/api/admin/operators/availability?booking_id=${later}`)).data.find(x => x.operator_id === operatorId);
  assert.equal(avail.blocks.length, 1);
  assert.equal((await t.api('PATCH', `/api/admin/bookings/${later}`, { operator_id: '' })).status, 200, 'togliere l\'operatore resta possibile');
});

test('un dipendente con assenze non si elimina', async () => {
  const d = await person('Duilio');
  await request(d, { absence_type_id: typeId('malattia'), start_date: '2027-01-11', protocol: 'P-2' });
  const del = await t.api('DELETE', `/api/admin/hr/employees/${d.id}`);
  assert.equal(del.status, 409);
  assert.match(del.data.error, /assenze registrate/);
});
