// Fase 1 — People: sedi e festività, dipendenti, responsabile/delegato, squadre, livelli di riservatezza.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const emp = async (first, last, extra = {}) => {
  const r = await t.api('POST', '/api/admin/hr/employees', { first_name: first, last_name: last, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.id;
};
async function userWith(username, workspaces, access_levels = []) {
  const role = (await t.api('POST', '/api/admin/roles', { name: `R ${username}`, workspaces, access_levels })).data.id;
  await t.api('POST', '/api/admin/portal-users', { name: username, email: `${username}@x.it`, username, password: 'password-lunga', role_id: role });
  const token = (await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } })).data.key;
  return (method, p, body) => t.request(method, p, { token, body });
}

test('calendario della sede: patrono di Pescara, Pasquetta calcolata, nazionali e chiusure di sede', async () => {
  const site = (await t.api('GET', '/api/admin/hr/sites')).data[0];
  assert.equal(site.patron_day, '10-10');
  assert.equal((await t.api('POST', '/api/admin/hr/holidays', { site_id: site.id, name: 'Chiusura per vendemmia', date: '2026-09-21' })).status, 200);
  assert.equal((await t.api('POST', '/api/admin/hr/holidays', { name: 'Sbagliata', month_day: '13-40' })).status, 400);
  const cal = (await t.api('GET', `/api/admin/hr/holidays?year=2026&site_id=${site.id}`)).data.calendar;
  const on = d => cal.find(h => h.date === d);
  assert.equal(on('2026-10-10').kind, 'patrono');
  assert.equal(on('2026-04-06').name, "Lunedì dell'Angelo");
  assert.equal(on('2026-12-25').kind, 'nazionale');
  assert.equal(on('2026-09-21').kind, 'sede');
  const national = (await t.api('GET', '/api/admin/hr/holidays?year=2026')).data.calendar;
  assert.ok(!national.find(h => h.date === '2026-10-10'), 'senza sede niente patrono');
});

test('patrono automatico dal comune; la sede principale prende il comune dai dati aziendali', async () => {
  const other = (await t.api('POST', '/api/admin/hr/sites', { name: 'Cantina di Bolzano', city: 'Bolzano', province: 'bz' })).data.id;
  let s = (await t.api('GET', '/api/admin/hr/sites')).data.find(x => x.id === other);
  assert.deepEqual([s.patron.source, s.patron.name], ['automatico', 'Maria Santissima Assunta']);
  const cal = (await t.api('GET', `/api/admin/hr/holidays?year=2027&site_id=${other}`)).data.calendar;
  assert.equal(cal.find(h => h.kind === 'patrono').date, '2027-05-17', 'lunedì di Pentecoste, che cambia ogni anno');
  assert.equal((await t.api('PATCH', `/api/admin/hr/sites/${other}`, { patron_day: '08-15', patron_name: 'Assunta' })).status, 200);
  s = (await t.api('GET', '/api/admin/hr/sites')).data.find(x => x.id === other);
  assert.deepEqual([s.patron.source, s.patron.date.slice(5)], ['manuale', '08-15'], 'quello indicato a mano vince');
  await t.api('PATCH', `/api/admin/hr/sites/${other}`, { city: 'Comune inventato' , patron_day: '', patron_name: '' });
  s = (await t.api('GET', '/api/admin/hr/sites')).data.find(x => x.id === other);
  assert.equal(s.patron.source, 'mancante');

  const main = (await t.api('GET', '/api/admin/hr/sites')).data.find(x => x.main);
  const before = { patron_day: main.patron_day, patron_name: main.patron_name };
  await t.api('PATCH', `/api/admin/hr/sites/${main.id}`, { patron_day: '', patron_name: '' });
  t.db.prepare("INSERT INTO settings (key, value) VALUES ('company_city', 'Rosciano'), ('company_province', 'PE') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  const m = (await t.api('GET', '/api/admin/hr/sites')).data.find(x => x.main);
  assert.deepEqual([m.location.city, m.location.from_company, m.patron.name, m.patron.date], ['Rosciano', true, "Sant'Eurosia", `${new Date().getFullYear()}-05-24`]);
  t.db.prepare("UPDATE settings SET value = '' WHERE key IN ('company_city', 'company_province')").run();
  await t.api('PATCH', `/api/admin/hr/sites/${main.id}`, before);
  await t.api('PATCH', `/api/admin/hr/sites/${other}`, { active: 0 });
});

test('responsabile e delegato: si sale di livello se il responsabile non è attivo', async () => {
  const dir = await emp('Dario', 'Direttore');
  const capo = await emp('Carla', 'Capo', { manager_id: dir });
  const vice = await emp('Vittorio', 'Vice');
  const oper = await emp('Olga', 'Operaia', { manager_id: capo, delegate_id: vice });
  let a = (await t.api('GET', `/api/admin/hr/employees/${oper}/approver`)).data;
  assert.equal(a.approver.id, capo);
  assert.equal(a.delegate.id, vice);
  assert.equal(a.escalated, false);
  await t.api('PATCH', `/api/admin/hr/employees/${capo}`, { active: 0 });
  a = (await t.api('GET', `/api/admin/hr/employees/${oper}/approver`)).data;
  assert.equal(a.approver.id, dir, 'responsabile disattivato: si sale al suo responsabile');
  assert.equal(a.escalated, true);
  await t.api('PATCH', `/api/admin/hr/employees/${capo}`, { active: 1 });
  const cap = (await t.api('GET', `/api/admin/hr/employees/${capo}/approver`)).data;
  assert.equal(cap.approver.id, dir, 'quando chiede il responsabile, approva il livello sopra');
  const cycle = await t.api('PATCH', `/api/admin/hr/employees/${dir}`, { manager_id: oper });
  assert.equal(cycle.status, 400);
  assert.match(cycle.data.error, /ciclo/);
  assert.equal((await t.api('PATCH', `/api/admin/hr/employees/${dir}`, { manager_id: dir })).status, 400, 'non è responsabile di sé stesso');
  assert.equal((await t.api('DELETE', `/api/admin/hr/employees/${capo}`)).status, 409, 'ha collaboratori: si disattiva');
});

test('il centro di costo del dipendente dev\'essere una foglia; l\'utente del portale è di un solo dipendente', async () => {
  const cs = (await t.api('GET', '/api/admin/finance/cost-centers')).data;
  const agg = cs.find(c => c.code === 'P');
  const leaf = cs.find(c => c.code === 'P101');
  const r = await t.api('POST', '/api/admin/hr/employees', { first_name: 'A', last_name: 'B', cost_center_id: agg.id });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /aggregato/);
  await emp('Paola', 'Potatrice', { cost_center_id: leaf.id });
  const u = await t.api('POST', '/api/admin/portal-users', { name: 'Utente Uno', email: 'uno@x.it', username: 'uno', password: 'password-lunga' });
  await emp('Uno', 'Primo', { portal_user_id: u.data.id });
  const dup = await t.api('POST', '/api/admin/hr/employees', { first_name: 'Due', last_name: 'Secondo', portal_user_id: u.data.id });
  assert.equal(dup.status, 409);
});

test('costo orario: solo con il livello "retributivo", con storico di validità e senza importi nel registro', async () => {
  const id = await emp('Rita', 'Retribuita');
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${id}/hourly-costs`, { valid_from: '2026-01-01', cost_per_hour: '21,5' })).status, 200);
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${id}/hourly-costs`, { valid_from: '2026-07-01', cost_per_hour: '23,4567' })).status, 200);
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${id}/hourly-costs`, { valid_from: '2026-07-01', cost_per_hour: '24' })).status, 409);
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${id}/hourly-costs`, { valid_from: '2026-08-01', cost_per_hour: '1,23456' })).status, 400, 'massimo 4 decimali');
  const costs = (await t.api('GET', `/api/admin/hr/employees/${id}/hourly-costs`)).data;
  assert.deepEqual(costs.map(c => [c.valid_from, c.valid_to, c.cost_per_hour]), [['2026-07-01', null, '23.4567'], ['2026-01-01', '2026-06-30', '21.5000']]);

  const hr = await userWith('hr-base', ['people']);
  const detail = (await hr('GET', `/api/admin/hr/employees/${id}`)).data;
  assert.equal(detail.can_see_costs, false);
  assert.equal(detail.hourly_costs, undefined, 'senza livello retributivo non arrivano nemmeno nel dettaglio');
  assert.equal((await hr('GET', `/api/admin/hr/employees/${id}/hourly-costs`)).status, 403);
  assert.equal((await hr('POST', `/api/admin/hr/employees/${id}/hourly-costs`, { valid_from: '2027-01-01', cost_per_hour: '30' })).status, 403);
  const pay = await userWith('hr-paghe', ['people'], ['retributivo']);
  assert.equal((await pay('GET', `/api/admin/hr/employees/${id}/hourly-costs`)).status, 200);

  const log = (await t.api('GET', '/api/admin/audit-log?entity=employee&limit=500')).data.filter(a => a.action === 'employee.hourly_cost_added');
  assert.equal(log.length, 2);
  assert.deepEqual(log.map(l => l.after), [{ valid_from: '2026-07-01' }, { valid_from: '2026-01-01' }], 'nel registro solo la decorrenza, nessun importo');
});

test('orario contrattuale: livello "personale", ore con decimali convertite in minuti', async () => {
  const id = await emp('Sara', 'Stagionale');
  const days = { 1: '8', 2: '8', 3: '8', 4: '8', 5: '7,5', 6: '0', 7: '0' };
  assert.equal((await t.api('PUT', `/api/admin/hr/employees/${id}/schedule`, { valid_from: '2026-09-01', days })).status, 200);
  const d = (await t.api('GET', `/api/admin/hr/employees/${id}`)).data;
  assert.equal(d.schedule.weekly_minutes, 8 * 60 * 4 + 450);
  assert.equal(d.schedule.days[5], 450);
  const hr = await userWith('hr-senza-personale', ['people']);
  assert.equal((await hr('PUT', `/api/admin/hr/employees/${id}/schedule`, { valid_from: '2026-10-01', days })).status, 403);
  assert.equal((await hr('GET', `/api/admin/hr/employees/${id}`)).data.schedule, undefined);
  assert.equal((await t.api('PUT', `/api/admin/hr/employees/${id}/schedule`, { valid_from: '2026-10-01', days: { 1: '25' } })).status, 400);
});

test('squadre: il caposquadra è sempre anche membro', async () => {
  const leader = await emp('Luca', 'Caposquadra');
  const m1 = await emp('Mario', 'Vendemmiatore');
  const r = await t.api('POST', '/api/admin/hr/teams', { name: 'Vendemmia 2026', leader_employee_id: leader, member_ids: [m1] });
  assert.equal(r.status, 200);
  const team = (await t.api('GET', '/api/admin/hr/teams')).data.find(x => x.name === 'Vendemmia 2026');
  assert.deepEqual(team.members.map(m => m.id).sort(), [leader, m1].sort());
  assert.equal((await t.api('POST', '/api/admin/hr/teams', { name: 'Vendemmia 2026' })).status, 409);
});

test('elenco essenziale (livello base) visibile a tutti; il resto di People solo al suo workspace', async () => {
  const eno = await userWith('solo-eno', ['enoturismo']);
  const dir = await eno('GET', '/api/admin/hr/directory');
  assert.equal(dir.status, 200);
  assert.ok(dir.data.length > 0);
  assert.deepEqual(Object.keys(dir.data[0]).sort(), ['first_name', 'id', 'job_title', 'last_name', 'site_name', 'work_email', 'work_phone'], 'solo i dati di livello base');
  assert.equal((await eno('GET', '/api/admin/hr/employees')).status, 403);
  assert.equal((await eno('GET', '/api/admin/hr/teams')).status, 403);
});
