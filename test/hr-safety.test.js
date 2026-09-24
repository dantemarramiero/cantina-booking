// Fase 2, blocco 2B — sicurezza sul lavoro: formazione e requisiti, abilitazioni per operazione e
// deroghe, idoneità (livello sanitario, accessi registrati), DPI, infortuni, cambio mansione.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const iso = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const emp = async (first, last, extra = {}) => (await t.api('POST', '/api/admin/hr/employees', { first_name: first, last_name: last, ...extra })).data.id;
const typeId = code => t.db.prepare('SELECT id FROM training_types WHERE code = ?').get(code).id;
const roleId = code => t.db.prepare('SELECT id FROM job_roles WHERE code = ?').get(code).id;
async function userWith(username, workspaces, access_levels = []) {
  const role = (await t.api('POST', '/api/admin/roles', { name: `R ${username}`, workspaces, access_levels })).data.id;
  const u = await t.api('POST', '/api/admin/portal-users', { name: username, email: `${username}@x.it`, username, password: 'password-lunga', role_id: role });
  const token = (await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } })).data.key;
  return { id: u.data.id, call: (method, p, body) => t.request(method, p, { token, body }), token };
}
const hire = (id, role, from = '2026-01-01', extra = {}) => t.api('POST', `/api/admin/hr/employees/${id}/contracts`, { effective_from: from, contract_type: 'OTI', hire_date: from, job_role_id: roleId(role), ...extra });
const train = (id, code, completed, extra = {}) => t.api('POST', `/api/admin/hr/employees/${id}/trainings`, { training_type_id: typeId(code), completed_on: completed, ...extra });
async function operation(code, name, trainings = []) {
  const id = (await t.api('POST', '/api/admin/finance/cost-objects', { type: 'operazione', code, name })).data.id;
  await t.api('PUT', `/api/admin/hr/operations/${id}/trainings`, { training_type_ids: trainings.map(typeId) });
  return id;
}

test('addMonths si ferma all\'ultimo giorno del mese', () => {
  const { addMonths } = require('../lib/calendar');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-03-15', 60), '2031-03-15');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
});

test('formazione: scadenza dalla periodicità del tipo (configurabile), niente date future, livello "personale"', async () => {
  const a = await emp('Aldo', 'Aula');
  const rec = await train(a, 'primo_soccorso', '2026-02-10', { hours: '12', provider: 'Croce Rossa' });
  assert.equal(rec.status, 200, JSON.stringify(rec.data));
  assert.equal(rec.data.expires_on, '2029-02-10', 'primo soccorso: 36 mesi di partenza');
  assert.equal((await train(a, 'generale', '2026-02-10')).data.expires_on, null, 'la formazione generale non scade');
  assert.equal((await train(a, 'antincendio', iso(3))).status, 400, 'un corso non si registra nel futuro');
  await t.api('PATCH', `/api/admin/hr/training-types/${typeId('primo_soccorso')}`, { validity_months: 24 });
  assert.equal((await train(a, 'primo_soccorso', '2026-03-01')).data.expires_on, '2028-03-01', 'la periodicità si cambia da Configurazione');
  await t.api('PATCH', `/api/admin/hr/training-types/${typeId('primo_soccorso')}`, { validity_months: 36 });
  const base = await userWith('sic-base', ['people']);
  assert.equal((await base.call('POST', `/api/admin/hr/employees/${a}/trainings`, { training_type_id: typeId('generale'), completed_on: '2026-01-01' })).status, 403);
});

test('requisiti per mansione: mancante, valida, in scadenza, scaduta; nello scadenzario solo ciò che serve', async () => {
  const c = await emp('Carla', 'Cantina');
  await hire(c, 'cantiniere', '2026-02-01');
  await train(c, 'generale', '2026-02-01');
  await train(c, 'haccp', '2023-01-10'); // 36 mesi → scaduta a gennaio 2026
  await train(c, 'carrello', iso(-1800 + 20)); // 60 mesi → scade tra circa 20 giorni
  await train(c, 'antincendio', '2020-01-01'); // non richiesta e scaduta: fuori dallo scadenzario
  const st = t.hrSafety.requirementStatus(c);
  const by = Object.fromEntries(st.items.map(i => [i.code, i.state]));
  assert.equal(st.role.since, '2026-02-01');
  assert.deepEqual(by, { generale: 'valida', specifica_alto: 'mancante', spazi_confinati: 'mancante', haccp: 'scaduta', carrello: 'in_scadenza' });
  const dl = (await t.api('GET', `/api/admin/hr/deadlines?employee_id=${c}&within=365`)).data;
  const kinds = dl.map(d => `${d.kind}:${d.label}`);
  assert.ok(kinds.includes('formazione_mancante:Formazione specifica — rischio alto'));
  assert.ok(kinds.includes('formazione:Alimentarista / HACCP'), 'scaduta e richiesta: resta');
  assert.ok(kinds.includes('abilitazione:Abilitazione carrello elevatore'));
  assert.ok(!kinds.some(k => k.includes('antincendio')), 'scaduta ma non richiesta: esce');
  assert.ok(dl.find(d => d.kind === 'visita_medica').missing, 'il cantiniere è soggetto a sorveglianza sanitaria: manca la visita');
});

test('operazione con abilitazione: blocco se manca o è scaduta, deroga solo dal responsabile sicurezza e se la mansione la ammette', async () => {
  const op = await operation('OP-FITO', 'Trattamento fitosanitario', ['fitosanitari']);
  const o = await emp('Omar', 'Operaio');
  await hire(o, 'operaio_agricolo');
  let chk = (await t.api('GET', `/api/admin/hr/employees/${o}/assignment-check?cost_object_id=${op}`)).data;
  assert.equal(chk.ok, false);
  assert.match(chk.blocks[0], /manca l'abilitazione «Certificato di abilitazione all'uso dei prodotti fitosanitari» richiesta per «Trattamento fitosanitario»/);
  await train(o, 'fitosanitari', '2020-05-01', { expires_on: '2025-05-01' });
  chk = t.hrSafety.assignmentCheck(o, { costObjectId: op });
  assert.match(chk.blocks[0], /è scaduta il 01\/05\/2025/);

  // Deroga: solo il responsabile sicurezza, con motivo, e solo se la mansione lo consente.
  const officerUser = await userWith('rspp', ['people'], ['personale']);
  const officer = await emp('Rita', 'Rspp', { portal_user_id: officerUser.id });
  const other = await userWith('non-rspp', ['people'], ['personale']);
  const waiver = { training_type_id: typeId('fitosanitari'), cost_object_id: op, valid_from: iso(-1), valid_to: iso(30), reason: 'Rinnovo prenotato, corso il mese prossimo' };
  assert.equal((await other.call('POST', `/api/admin/hr/employees/${o}/waivers`, waiver)).status, 403);
  await t.api('PUT', '/api/admin/hr/safety/settings', { safety_officer_ids: [officer] });
  assert.equal((await officerUser.call('POST', `/api/admin/hr/employees/${o}/waivers`, { ...waiver, reason: 'breve' })).status, 400, 'motivo obbligatorio');
  const s = await emp('Sara', 'Sommelier');
  await hire(s, 'sommelier');
  const refused = await officerUser.call('POST', `/api/admin/hr/employees/${s}/waivers`, waiver);
  assert.equal(refused.status, 409, 'il sommelier non ammette deroghe');
  const w = await officerUser.call('POST', `/api/admin/hr/employees/${o}/waivers`, waiver);
  assert.equal(w.status, 200, JSON.stringify(w.data));
  chk = t.hrSafety.assignmentCheck(o, { costObjectId: op });
  assert.equal(chk.ok, true);
  assert.match(chk.warnings[0], /deroga del responsabile sicurezza/);
  await officerUser.call('POST', `/api/admin/hr/waivers/${w.data.id}/revoke`);
  assert.equal(t.hrSafety.assignmentCheck(o, { costObjectId: op }).ok, false, 'deroga revocata: di nuovo bloccato');
  await train(o, 'fitosanitari', iso(-2));
  assert.equal(t.hrSafety.assignmentCheck(o, { costObjectId: op }).ok, true, 'con il certificato rinnovato è assegnabile');
});

test('idoneità: "non idoneo" blocca, limitazioni incompatibili avvisano, la lettura è registrata', async () => {
  const op = await operation('OP-VASCHE', 'Pulizia vasche', []);
  const op2 = await operation('OP-ETICH', 'Etichettatura', []);
  const f = await emp('Fabio', 'Fitness');
  await hire(f, 'cantiniere');
  const visit = body => t.api('POST', `/api/admin/hr/employees/${f}/medical-visits`, { visit_type: 'periodica', ...body });
  assert.equal((await visit({ visit_date: iso(-10), judgment: 'idoneo_prescrizioni' })).status, 400, 'le prescrizioni vanno riportate');
  assert.equal((await visit({ visit_date: iso(-10), judgment: 'non_idoneo_temporaneo' })).status, 400, 'fino a quando');
  const ok = await visit({ visit_date: iso(-10), judgment: 'idoneo_prescrizioni', limitations: 'Evitare sollevamento carichi oltre 15 kg', next_visit_on: iso(355), restricted_cost_object_ids: [op] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  let chk = t.hrSafety.assignmentCheck(f, { costObjectId: op });
  assert.equal(chk.ok, true, 'con limitazioni non si blocca');
  assert.match(chk.warnings[0], /limitazioni incompatibili con «Pulizia vasche»: Evitare sollevamento/);
  assert.deepEqual(t.hrSafety.assignmentCheck(f, { costObjectId: op2 }).warnings, [], 'le altre operazioni sono compatibili');

  await visit({ visit_date: iso(-1), judgment: 'non_idoneo_temporaneo', unfit_until: iso(20), next_visit_on: iso(21) });
  chk = t.hrSafety.assignmentCheck(f, { costObjectId: op2 });
  assert.equal(chk.ok, false);
  assert.match(chk.blocks[0], /non è assegnabile: giudizio di non idoneità del medico competente fino al/);
  assert.equal(t.hrSafety.assignmentCheck(f, { costObjectId: op2, date: iso(25) }).blocks.length, 0, 'finita l\'inidoneità temporanea non blocca più');
  assert.match(t.hrSafety.assignmentCheck(f, { costObjectId: op2, date: iso(25) }).warnings[0], /manca la nuova visita/);

  const before = t.db.prepare('SELECT COUNT(*) AS c FROM sensitive_access_log WHERE employee_id = ?').get(f).c;
  await t.api('GET', `/api/admin/hr/employees/${f}/assignment-check?cost_object_id=${op2}`);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS c FROM sensitive_access_log WHERE employee_id = ?').get(f).c, before + 1, 'il controllo che usa il giudizio è registrato');
  const audit = t.db.prepare("SELECT after_json FROM audit_log WHERE action = 'medical_visit.recorded'").all().map(a => a.after_json).join();
  assert.ok(!/non_idoneo|idoneo_prescrizioni|sollevamento/.test(audit), 'il giudizio non finisce nel registro attività');
});

test('chi vede l\'idoneità: sanitario, il dipendente, il responsabile (registrato); non l\'HR senza sanitario né i colleghi', async () => {
  const mgrUser = await userWith('capo-idon', ['people']);
  const selfUser = await userWith('io-idon', ['people']);
  const mgr = await emp('Mario', 'Capo', { portal_user_id: mgrUser.id });
  const w = await emp('Walter', 'Lavoratore', { manager_id: mgr, portal_user_id: selfUser.id });
  await t.api('POST', `/api/admin/hr/employees/${w}/medical-visits`, { visit_type: 'preventiva', visit_date: iso(-5), judgment: 'idoneo', next_visit_on: iso(360) });
  const hrOnly = await userWith('hr-no-san', ['people'], ['personale']);
  const colleague = await userWith('collega', ['people']);
  const colleagueEmp = await emp('Carlo', 'Collega', { portal_user_id: colleague.id });
  assert.ok(colleagueEmp);

  const asHr = (await hrOnly.call('GET', `/api/admin/hr/employees/${w}/safety`)).data;
  assert.equal(asHr.fitness, undefined, 'HR senza livello sanitario: niente giudizio');
  assert.equal((await colleague.call('GET', `/api/admin/hr/employees/${w}/safety`)).status, 403);
  const logBefore = t.db.prepare('SELECT COUNT(*) AS c FROM sensitive_access_log WHERE employee_id = ?').get(w).c;
  const asMgr = (await mgrUser.call('GET', `/api/admin/hr/employees/${w}/safety`)).data;
  assert.equal(asMgr.fitness.state, 'idoneo');
  assert.equal(asMgr.incidents, undefined, 'il responsabile non vede gli infortuni');
  assert.equal((await selfUser.call('GET', `/api/admin/hr/employees/${w}/safety`)).data.fitness.state, 'idoneo');
  const log = t.db.prepare('SELECT * FROM sensitive_access_log WHERE employee_id = ? ORDER BY id').all(w).slice(logBefore);
  assert.deepEqual(log.map(l => l.actor), ['capo-idon', 'io-idon']);
  assert.equal((await mgrUser.call('POST', `/api/admin/hr/employees/${w}/medical-visits`, { visit_type: 'periodica', visit_date: iso(-1), judgment: 'idoneo' })).status, 403, 'vedere non è registrare');

  // Scadenzario e conformità: il responsabile vede i collaboratori, il collega no.
  assert.ok((await mgrUser.call('GET', '/api/admin/hr/deadlines?within=365')).data.some(d => d.employee_id === w));
  assert.ok(!(await colleague.call('GET', '/api/admin/hr/deadlines?within=365')).data.some(d => d.employee_id === w));
  const comp = (await mgrUser.call('GET', '/api/admin/hr/safety/compliance')).data;
  assert.deepEqual(comp.map(x => x.employee_id).sort(), [mgr, w].sort(), 'il responsabile vede sé e i suoi collaboratori');
  assert.equal(comp.find(x => x.employee_id === w).fitness, 'idoneo');
});

test('visita scaduta: in anomalia nello scadenzario e notifica al responsabile', async () => {
  const mgrUser = (await t.api('POST', '/api/admin/portal-users', { name: 'Resp Visite', email: 'rv@x.it', username: 'resp-visite', password: 'password-lunga' })).data.id;
  const mgr = await emp('Resp', 'Visite', { portal_user_id: mgrUser });
  const v = await emp('Vito', 'Visita', { manager_id: mgr });
  await t.api('POST', `/api/admin/hr/employees/${v}/medical-visits`, { visit_type: 'periodica', visit_date: '2025-01-10', judgment: 'idoneo', next_visit_on: iso(-3) });
  const d = (await t.api('GET', `/api/admin/hr/deadlines?employee_id=${v}`)).data.find(x => x.kind === 'visita_medica');
  assert.equal(d.bucket, 'scaduto');
  t.hrFile.notifyDeadlines();
  const n = t.db.prepare("SELECT title FROM notifications WHERE user_id = ? AND title LIKE 'Vito Visita:%'").all(mgrUser);
  assert.equal(n.length, 1);
  assert.match(n[0].title, /Visita medica scaduto/);
});

test('cambio mansione: nuovi requisiti, attività "visita per cambio mansione" (una sola), chiusa dalla visita', async () => {
  const mgrUser = (await t.api('POST', '/api/admin/portal-users', { name: 'Capo Mansioni', email: 'cm@x.it', username: 'capo-mansioni', password: 'password-lunga' })).data.id;
  const mgr = await emp('Capo', 'Mansioni', { portal_user_id: mgrUser });
  const m = await emp('Marco', 'Mansione', { manager_id: mgr });
  await hire(m, 'addetto_accoglienza', '2026-01-01');
  await train(m, 'generale', '2026-01-02');
  await hire(m, 'trattorista', iso(-2)); // nuova versione: cambia mansione
  t.events.dispatch();
  const tasks = t.db.prepare("SELECT * FROM hr_tasks WHERE employee_id = ? AND kind = 'visita_cambio_mansione'").all(m);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].due_date, iso(-2));
  const n = t.db.prepare("SELECT * FROM notifications WHERE user_id = ? AND kind = 'hr.role_changed'").all(mgrUser);
  assert.equal(n.length, 1);
  assert.match(n[0].body, /Formazione da fare: .*Abilitazione trattori agricoli/);
  assert.ok(!/Formazione generale lavoratori/.test(n[0].body), 'quella già fatta non è nell\'elenco');
  assert.ok((await t.api('GET', `/api/admin/hr/deadlines?employee_id=${m}&within=365`)).data.some(d => d.kind === 'attivita'));
  t.events.dispatch();
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM hr_tasks WHERE employee_id = ?").get(m).c, 1, 'idempotente');
  await t.api('POST', `/api/admin/hr/employees/${m}/medical-visits`, { visit_type: 'cambio_mansione', visit_date: iso(-1), judgment: 'idoneo', next_visit_on: iso(364) });
  assert.ok(t.db.prepare('SELECT done_at FROM hr_tasks WHERE id = ?').get(tasks[0].id).done_at, 'la visita chiude l\'attività');
});

test('DPI: sostituzione dalla periodicità, taglia dalla scheda, restituito = fuori dallo scadenzario', async () => {
  const d = await emp('Dino', 'Dpi');
  await t.api('PUT', `/api/admin/hr/employees/${d}/personal`, { size_shoes: '43' });
  const scarpe = t.db.prepare("SELECT id FROM ppe_types WHERE code = 'scarpe'").get().id;
  const res = await t.api('POST', `/api/admin/hr/employees/${d}/ppe`, { ppe_type_id: scarpe, delivered_on: iso(-340) });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.size, '43');
  assert.equal(res.data.replace_by, require('../lib/calendar').addMonths(iso(-340), 12));
  assert.ok((await t.api('GET', `/api/admin/hr/deadlines?employee_id=${d}`)).data.some(x => x.kind === 'dpi'));
  await t.api('PATCH', `/api/admin/hr/ppe/${res.data.id}`, { returned_on: iso(-1) });
  assert.ok(!(await t.api('GET', `/api/admin/hr/deadlines?employee_id=${d}`)).data.some(x => x.kind === 'dpi'));
});

test('infortuni: dipendente obbligatorio, evento di dominio, INAIL con data; quasi-infortuni anche senza persona', async () => {
  const i = await emp('Ivo', 'Infortunio');
  assert.equal((await t.api('POST', '/api/admin/hr/incidents', { kind: 'infortunio', occurred_on: iso(-2), dynamics: 'Scivolato in cantina' })).status, 400);
  assert.equal((await t.api('POST', '/api/admin/hr/incidents', { kind: 'infortunio', employee_id: i, occurred_on: iso(-2), dynamics: 'Scivolato', inail_number: '123' })).status, 400, 'INAIL senza data');
  const inf = await t.api('POST', '/api/admin/hr/incidents', { kind: 'infortunio', employee_id: i, occurred_on: iso(-2), occurred_time: '10:30', place: 'Bottaia', dynamics: 'Scivolato sul pavimento bagnato', prognosis_days: 7 });
  assert.equal(inf.status, 200, JSON.stringify(inf.data));
  const ev = t.db.prepare("SELECT payload FROM domain_events WHERE type = 'incident.recorded' AND source_id = ?").get(inf.data.id);
  assert.deepEqual(JSON.parse(ev.payload), { incident_id: inf.data.id, kind: 'infortunio', employee_id: i, occurred_on: iso(-2), prognosis_days: 7, inail_number: null });
  await t.api('PATCH', `/api/admin/hr/incidents/${inf.data.id}`, { inail_number: 'INAIL-2026-99', inail_date: iso(-1) });
  assert.equal(t.db.prepare('SELECT inail_number FROM incidents WHERE id = ?').get(inf.data.id).inail_number, 'INAIL-2026-99');
  assert.equal((await t.api('POST', '/api/admin/hr/incidents', { kind: 'quasi_infortunio', occurred_on: iso(-1), place: 'Linea di imbottigliamento', dynamics: 'Bottiglia esplosa vicino all\'operatore' })).status, 200);
  const base = await userWith('inf-base', ['people']);
  assert.equal((await base.call('GET', '/api/admin/hr/incidents')).status, 403);
});

test('un dipendente con fascicolo o dati di sicurezza non si elimina; senza dati sì', async () => {
  const a = await emp('Anna', 'Archivio');
  await train(a, 'generale', '2026-01-01');
  const del = await t.api('DELETE', `/api/admin/hr/employees/${a}`);
  assert.equal(del.status, 409);
  assert.match(del.data.error, /dati di sicurezza/);
  const b = await emp('Bea', 'Contratto');
  await hire(b, 'amministrativo');
  assert.match((await t.api('DELETE', `/api/admin/hr/employees/${b}`)).data.error, /un fascicolo/);
  const c = await emp('Ciro', 'Errore');
  assert.equal((await t.api('DELETE', `/api/admin/hr/employees/${c}`)).status, 200);
});
