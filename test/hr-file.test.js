// Fase 2.0 — fascicolo: dati personali, documenti d'identità, contratti versionati, retribuzione,
// competenze, documenti cifrati per livello, scadenzario e notifiche.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const iso = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const emp = async (first, last, extra = {}) => (await t.api('POST', '/api/admin/hr/employees', { first_name: first, last_name: last, ...extra })).data.id;
async function userWith(username, workspaces, access_levels = []) {
  const role = (await t.api('POST', '/api/admin/roles', { name: `R ${username}`, workspaces, access_levels })).data.id;
  const u = await t.api('POST', '/api/admin/portal-users', { name: username, email: `${username}@x.it`, username, password: 'password-lunga', role_id: role });
  const token = (await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } })).data.key;
  return { id: u.data.id, call: (method, p, body) => t.request(method, p, { token, body }), token };
}
async function uploadDoc(token, employeeId, typeCode, content, extra = {}) {
  const fd = new FormData();
  fd.append('type_code', typeCode);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  fd.append('file', new Blob([content], { type: 'application/pdf' }), `${typeCode}.pdf`);
  const res = await fetch(`${t.base}/api/admin/hr/employees/${employeeId}/documents`, { method: 'POST', headers: { 'x-admin-key': token }, body: fd });
  return { status: res.status, data: await res.json() };
}

test('dati personali: codice fiscale e IBAN validati, contatti di emergenza, livello "personale"', async () => {
  const a = await emp('Anna', 'Anagrafica');
  const b = await emp('Bruno', 'Doppione');
  assert.equal((await t.api('PUT', `/api/admin/hr/employees/${a}/personal`, { fiscal_code: 'ABC' })).status, 400);
  const ok = await t.api('PUT', `/api/admin/hr/employees/${a}/personal`, {
    fiscal_code: 'rssmra80a01g482x', iban: 'it60 x054 2811 1010 0000 0123 456', birth_date: '1980-01-01',
    emergency_contacts: [{ name: 'Marco', relationship: 'fratello', phone: '3331234567' }, { name: 'Lia', phone: '3339876543' }],
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const file = (await t.api('GET', `/api/admin/hr/employees/${a}/file`)).data;
  assert.equal(file.personal.data.fiscal_code, 'RSSMRA80A01G482X');
  assert.equal(file.personal.data.iban, 'IT60X0542811101000000123456');
  assert.equal(file.personal.emergency_contacts.length, 2);
  assert.equal((await t.api('PUT', `/api/admin/hr/employees/${b}/personal`, { fiscal_code: 'RSSMRA80A01G482X' })).status, 409, 'lo stesso CF non può essere di due dipendenti');
  const base = await userWith('hr-solo-base', ['people']);
  assert.equal((await base.call('PUT', `/api/admin/hr/employees/${a}/personal`, { birth_place: 'Pescara' })).status, 403);
  const seen = (await base.call('GET', `/api/admin/hr/employees/${a}/file`)).data;
  assert.equal(seen.personal, undefined, 'senza livello personale niente dati personali');
  assert.equal(seen.access.personale, false);
});

test('permesso di soggiorno: scadenza obbligatoria, nello scadenzario e bloccante quando scaduto', async () => {
  const s = await emp('Samir', 'Stagionale');
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${s}/identity-documents`, { doc_type: 'permesso_soggiorno', number: 'X1' })).status, 400);
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${s}/identity-documents`, { doc_type: 'permesso_soggiorno', number: 'X1', permit_type: 'lavoro stagionale', expires_on: iso(-2) })).status, 200);
  const file = (await t.api('GET', `/api/admin/hr/employees/${s}/file`)).data;
  const d = file.deadlines.find(x => x.kind === 'permesso_soggiorno');
  assert.equal(d.bucket, 'scaduto');
  assert.equal(d.blocking, true);
  assert.match(file.blocking_today.join(), /permesso di soggiorno scaduto/);
});

test('contratti versionati: mai sovrascritti, copia dei dati organizzativi, evento al cambio di mansione', async () => {
  const roles = (await t.api('GET', '/api/admin/hr/job-roles')).data;
  const cantiniere = roles.find(r => r.code === 'cantiniere').id, trattorista = roles.find(r => r.code === 'trattorista').id;
  const site = (await t.api('GET', '/api/admin/hr/sites')).data[0].id;
  const c = await emp('Carlo', 'Contratto', { site_id: site });
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${c}/contracts`, { effective_from: '2026-03-01', contract_type: 'OTD', job_role_id: cantiniere })).status, 400, 'a termine senza fine');
  const v1 = await t.api('POST', `/api/admin/hr/employees/${c}/contracts`, { effective_from: '2026-03-01', contract_type: 'OTD', hire_date: '2026-03-01', end_date: iso(25), probation_end: iso(5), job_role_id: cantiniere, ccnl: 'Agricoltura operai' });
  assert.equal(v1.status, 200, JSON.stringify(v1.data));
  assert.equal(v1.data.version, 1);
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${c}/contracts`, { effective_from: '2026-02-01', contract_type: 'OTD', end_date: iso(25) })).status, 400, 'decorrenza prima della versione in vigore');
  const v2 = await t.api('POST', `/api/admin/hr/employees/${c}/contracts`, { effective_from: '2026-06-01', contract_type: 'OTD', end_date: iso(25), job_role_id: trattorista });
  assert.equal(v2.data.version, 2);
  const list = (await t.api('GET', `/api/admin/hr/employees/${c}/contracts`)).data;
  assert.deepEqual(list.map(x => x.version), [2, 1], 'la versione 1 resta nello storico');
  assert.equal(list[0].site_id, site, 'la sede attuale è copiata nella versione');
  assert.equal(list[0].hire_date, '2026-03-01', 'la data di assunzione passa alla versione nuova');
  const ev = t.db.prepare("SELECT payload FROM domain_events WHERE type = 'employee.role_changed'").all().map(x => JSON.parse(x.payload));
  assert.ok(ev.some(p => p.employee_id === c && p.from_job_role_id === cantiniere && p.to_job_role_id === trattorista));
  const dl = (await t.api('GET', `/api/admin/hr/deadlines?employee_id=${c}`)).data;
  assert.deepEqual(dl.map(d => [d.kind, d.bucket]).sort(), [['contratto_termine', 30], ['periodo_prova', 7]]);
});

test('retribuzione: solo livello "retributivo"; proposta di costo orario esatta; niente importi nel registro', async () => {
  const r = await emp('Rosa', 'Retribuzione');
  await t.api('PUT', `/api/admin/hr/employees/${r}/schedule`, { valid_from: '2026-01-01', days: { 1: '8', 2: '8', 3: '8', 4: '8', 5: '8' } });
  const add = await t.api('POST', `/api/admin/hr/employees/${r}/compensations`, { effective_from: '2026-01-01', pay_type: 'ral', ral: '30000' });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  // 30.000 € × 1,30 / (40 h × 52) = 18,75 €/h
  assert.equal(add.data.proposal.cost_per_hour, '18.7500');
  const h = await emp('Ugo', 'Orario');
  await t.api('PUT', `/api/admin/hr/employees/${h}/schedule`, { valid_from: '2026-01-01', days: { 1: '8', 2: '8', 3: '8', 4: '8', 5: '8' } });
  const hourly = await t.api('POST', `/api/admin/hr/employees/${h}/compensations`, { effective_from: '2026-01-01', pay_type: 'oraria', hourly: '12,5' });
  assert.equal(hourly.data.proposal.cost_per_hour, '16.2500', '12,50 × 1,30');
  await t.api('PUT', '/api/admin/hr/settings', { employer_cost_pct: '35' });
  assert.equal((await t.api('GET', `/api/admin/hr/employees/${h}/compensations`)).data.proposal.cost_per_hour, '16.8750', 'gli oneri si configurano');
  const pers = await userWith('hr-personale', ['people'], ['personale']);
  assert.equal((await pers.call('GET', `/api/admin/hr/employees/${r}/compensations`)).status, 403);
  assert.equal((await pers.call('GET', `/api/admin/hr/employees/${r}/file`)).data.compensation, undefined);
  const log = (await t.api('GET', '/api/admin/audit-log?entity=employee&limit=500')).data.filter(a => a.action === 'compensation.added');
  assert.ok(log.length >= 2 && log.every(l => JSON.stringify(l.after) === JSON.stringify({ effective_from: '2026-01-01' })));
});

test('lingue: codice di due lettere, niente doppioni; servono all\'Enoturismo', async () => {
  const l = await emp('Lara', 'Lingue');
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${l}/skills`, { kind: 'lingua', name: 'Inglese' })).status, 400);
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${l}/skills`, { kind: 'lingua', name: 'EN', level: 'C1' })).status, 200);
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${l}/skills`, { kind: 'lingua', name: 'en' })).status, 409);
  await t.api('POST', `/api/admin/hr/employees/${l}/skills`, { kind: 'qualifica', name: 'Sommelier AIS', issued_on: '2020-05-01' });
  assert.deepEqual(t.hrFile.languagesOf(l), ['en']);
});

test('documenti: cifrati sul disco, scaricabili solo con il livello del tipo, versioni, accessi sanitari registrati', async () => {
  const d = await emp('Dora', 'Documenti');
  const secret = 'CEDOLINO-SEGRETO-12345';
  const up = await uploadDoc(t.token, d, 'cedolino', secret, { title: 'Cedolino settembre', doc_date: '2026-09-30' });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const row = t.db.prepare('SELECT * FROM hr_documents WHERE id = ?').get(up.data.id);
  const onDisk = fs.readFileSync(path.join(t.dir, 'hr-files', `${row.storage_key}.bin`));
  assert.ok(!onDisk.toString('latin1').includes(secret), 'sul disco il contenuto è cifrato');
  let docs = (await t.api('GET', `/api/admin/hr/employees/${d}/file`)).data.documents;
  const down = await t.request('GET', docs[0].download_url);
  assert.equal(down.status, 200);
  assert.equal(down.data, secret);

  const pers = await userWith('hr-no-paghe', ['people'], ['personale']);
  const seen = (await pers.call('GET', `/api/admin/hr/employees/${d}/file`)).data.documents;
  assert.equal(seen.length, 0, 'il cedolino è retributivo: non compare');
  assert.equal((await pers.call('GET', `/api/admin/hr/documents/${up.data.id}/download`)).status, 403);
  assert.equal((await uploadDoc(pers.token, d, 'cedolino', 'x')).status, 403, 'e non si carica');

  const v2 = await uploadDoc(t.token, d, 'cedolino', 'CORRETTO', { supersedes_id: String(up.data.id) });
  docs = (await t.api('GET', `/api/admin/hr/employees/${d}/file`)).data.documents;
  assert.deepEqual(docs.map(x => [x.version, x.current]), [[2, true], [1, false]]);

  const san = await uploadDoc(t.token, d, 'idoneita', 'IDONEO');
  const sanDoc = (await t.api('GET', `/api/admin/hr/employees/${d}/file`)).data.documents.find(x => x.id === san.data.id);
  await t.request('GET', sanDoc.download_url);
  const log = (await t.api('GET', `/api/admin/hr/sensitive-access-log?employee_id=${d}`)).data;
  assert.equal(log.length, 1);
  assert.match(log[0].what, /idoneita/);
  assert.equal((await pers.call('GET', '/api/admin/hr/sensitive-access-log')).status, 403);

  // Un file alterato sul disco non si decifra (GCM autenticato).
  const f2 = path.join(t.dir, 'hr-files', `${t.db.prepare('SELECT storage_key FROM hr_documents WHERE id = ?').get(v2.data.id).storage_key}.bin`);
  const buf = fs.readFileSync(f2); buf[buf.length - 1] ^= 0xff; fs.writeFileSync(f2, buf);
  const tampered = docs.find(x => x.id === v2.data.id);
  assert.equal((await t.request('GET', tampered.download_url)).status, 500);

  const sanFile = path.join(t.dir, 'hr-files', `${t.db.prepare('SELECT storage_key FROM hr_documents WHERE id = ?').get(san.data.id).storage_key}.bin`);
  assert.equal((await t.api('DELETE', `/api/admin/hr/documents/${san.data.id}`)).status, 200);
  assert.ok(!fs.existsSync(sanFile), 'eliminando il documento si elimina anche il file cifrato');
});

test('il dipendente vede i propri dati e i documenti a lui visibili, ma non li modifica; quelli degli altri no', async () => {
  const me = await userWith('io-dipendente', ['people']);
  const mine = await emp('Ivo', 'Io', { portal_user_id: me.id });
  const other = await emp('Olga', 'Altra');
  await t.api('PUT', `/api/admin/hr/employees/${mine}/personal`, { birth_place: 'Chieti' });
  await t.api('PUT', `/api/admin/hr/employees/${other}/personal`, { birth_place: 'Teramo' });
  t.db.prepare("UPDATE hr_document_types SET employee_visible = 0 WHERE code = 'cv'").run();
  await uploadDoc(t.token, mine, 'cedolino', 'MIO-CEDOLINO');
  await uploadDoc(t.token, mine, 'cv', 'CV-INTERNO');
  const f = (await me.call('GET', `/api/admin/hr/employees/${mine}/file`)).data;
  assert.equal(f.access.self, true);
  assert.equal(f.personal.data.birth_place, 'Chieti');
  assert.deepEqual(f.access.edit, { personale: false, retributivo: false });
  assert.deepEqual(f.access.upload_types, []);
  assert.deepEqual(f.documents.map(d => d.type_code), ['cedolino'], 'il CV non è visibile al dipendente');
  assert.equal((await t.request('GET', f.documents[0].download_url, { token: me.token })).data, 'MIO-CEDOLINO');
  assert.equal((await me.call('PUT', `/api/admin/hr/employees/${mine}/personal`, { birth_place: 'Roma' })).status, 403);
  const theirs = (await me.call('GET', `/api/admin/hr/employees/${other}/file`)).data;
  assert.equal(theirs.personal, undefined, 'i dati personali degli altri no');
  assert.equal(theirs.access.self, false);
  t.db.prepare("UPDATE hr_document_types SET employee_visible = 1 WHERE code = 'cv'").run();
});

test('scadenzario: notifiche a HR, responsabile e dipendente alle soglie, una sola volta per soglia', async () => {
  const mgrUser = (await t.api('POST', '/api/admin/portal-users', { name: 'Capo Notifiche', email: 'capo@n.it', username: 'capo-n', password: 'password-lunga' })).data.id;
  const empUser = (await t.api('POST', '/api/admin/portal-users', { name: 'Nino Notifiche', email: 'nino@n.it', username: 'nino-n', password: 'password-lunga' })).data.id;
  const mgr = await emp('Capo', 'Notifiche', { portal_user_id: mgrUser });
  const n = await emp('Nino', 'Notifiche', { manager_id: mgr, portal_user_id: empUser });
  await t.api('POST', `/api/admin/hr/employees/${n}/identity-documents`, { doc_type: 'carta_identita', number: 'CA1', expires_on: iso(20) });
  const before = t.db.prepare('SELECT COUNT(*) AS c FROM notifications').get().c;
  const sent = t.hrFile.notifyDeadlines();
  assert.ok(sent >= 3);
  const mine = uid => t.db.prepare("SELECT title FROM notifications WHERE COALESCE(user_id, 0) = ? AND title LIKE 'Nino Notifiche:%'").all(uid ?? 0).map(x => x.title);
  assert.equal(mine(null).length, 1, 'HR (amministratori)');
  assert.equal(mine(mgrUser).length, 1, 'responsabile');
  assert.equal(mine(empUser).length, 1, 'dipendente');
  assert.match(mine(empUser)[0], /Carta d'identità scade tra 20 giorni/);
  const link = t.db.prepare("SELECT link FROM notifications WHERE user_id = ? AND title LIKE 'Nino Notifiche:%'").get(empUser).link;
  assert.equal(link, `/portal.html?workspace=people&employee=${n}&tab=scadenze`, 'la notifica apre la scheda');
  t.hrFile.notifyDeadlines();
  assert.equal(mine(empUser).length, 1, 'rieseguito: nessun doppione');
  assert.ok(t.db.prepare('SELECT COUNT(*) AS c FROM notifications').get().c > before);
});

test('soglie di preavviso configurabili e validate', async () => {
  assert.equal((await t.api('PUT', '/api/admin/hr/settings', { deadline_thresholds: [0] })).status, 400);
  const s = (await t.api('PUT', '/api/admin/hr/settings', { deadline_thresholds: [15, 90, 45] })).data;
  assert.deepEqual(s.deadline_thresholds, [90, 45, 15]);
  await t.api('PUT', '/api/admin/hr/settings', { deadline_thresholds: [60, 30, 7] });
});

test('conservazione: i documenti oltre il periodo vengono segnalati, non cancellati', async () => {
  const c = await emp('Cora', 'Conservazione');
  const up = await uploadDoc(t.token, c, 'cv', 'CV');
  t.db.prepare("UPDATE hr_documents SET delete_after = '2020-01-01' WHERE id = ?").run(up.data.id);
  t.scheduler.runDue(Date.now() + 40 * 24 * 60 * 60000);
  assert.ok(t.db.prepare("SELECT 1 FROM notifications WHERE dedupe_key = ?").get(`retention:${up.data.id}`));
  assert.ok(t.db.prepare('SELECT 1 FROM hr_documents WHERE id = ?').get(up.data.id), 'il documento resta finché HR non decide');
});
