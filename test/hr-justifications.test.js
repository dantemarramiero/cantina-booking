// Giustificativi delle assenze: catalogo sui tipi, caricamento dal dipendente, verifica dell'ufficio personale,
// riservatezza dei documenti sanitari, protocollo della malattia, autocertificazione, promemoria e scadenzario.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

let seq = 0;
const typeId = code => t.db.prepare('SELECT id FROM absence_types WHERE code = ?').get(code).id;
async function person(first, { manager = null, levels = [], workspaces = ['enoturismo'], last = 'Giust' } = {}) {
  const username = `${first.toLowerCase()}-g${++seq}`;
  const role = (await t.api('POST', '/api/admin/roles', { name: `R ${username}`, workspaces, access_levels: levels })).data.id;
  const u = (await t.api('POST', '/api/admin/portal-users', { name: `${first} ${last}`, email: `${username}@x.it`, username, password: 'password-lunga', role_id: role })).data.id;
  const token = (await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } })).data.key;
  const id = (await t.api('POST', '/api/admin/hr/employees', { first_name: first, last_name: last, portal_user_id: u, manager_id: manager })).data.id;
  return { id, userId: u, token, call: (method, p, body) => t.request(method, p, { token, body }) };
}
async function send(who, absenceId, { files = [], fields = {} } = {}) {
  const fd = new FormData();
  for (const [name, content, type = 'application/pdf'] of files) fd.append('files', new Blob([content], { type }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${t.base}/api/admin/hr/absences/${absenceId}/justification`, { method: 'POST', headers: { 'x-admin-key': who.token }, body: fd });
  return { status: res.status, data: await res.json() };
}
const mine = async who => (await who.call('GET', '/api/admin/hr/absences/justifications/mine')).data;

test('catalogo: categoria e giustificativo sui tipi di assenza, con i tipi che mancavano', () => {
  const row = code => t.db.prepare('SELECT * FROM absence_types WHERE code = ?').get(code);
  assert.deepEqual([row('ferie').category, row('ferie').doc_required], ['ferie', 0]);
  assert.deepEqual([row('malattia').category, row('malattia').doc_mode, row('malattia').doc_deadline_days], ['malattia', 'protocol', 2]);
  assert.deepEqual([row('matrimonio').category, row('matrimonio').doc_self_cert, row('matrimonio').doc_deadline_days], ['congedo', 1, 30]);
  assert.deepEqual([row('visita_medica').category, row('visita_medica').health, row('visita_medica').unit], ['permesso', 1, 'ore']);
  for (const code of ['diritto_studio', 'testimonianza', 'malattia_figlio', 'seggio']) assert.ok(row(code), code);
  assert.equal(t.db.prepare("SELECT level FROM hr_document_types WHERE code = 'giustificativo_sanitario'").get().level, 'sanitario');
});

test('giustificativo: da caricare → in verifica → da ricaricare → accettato; i file sanitari non li vede il responsabile', async () => {
  const boss = await person('Remo', { last: 'Capo', workspaces: ['people'] }); // workspace People ma senza il livello sanitario
  const w = await person('Lia', { manager: boss.id });
  const hr = await person('Ugo', { last: 'Personale', workspaces: ['people'], levels: ['personale', 'sanitario'] });
  const hrNoHealth = await person('Pia', { last: 'Personale', workspaces: ['people'], levels: ['personale'] });
  const req = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('visita_medica'), part: 'ore', start_date: '2031-03-04', end_date: '2031-03-04', start_time: '09:00', end_time: '11:00' });
  assert.equal(req.status, 200, JSON.stringify(req.data));
  let [d] = await mine(w);
  assert.deepEqual([d.absence_id, d.status, d.due_date, d.health], [req.data.id, 'todo', '2031-03-09', true], 'scadenza = fine assenza + 5 giorni');

  assert.equal((await send(w, req.data.id)).status, 400, 'serve almeno un file');
  assert.match((await send(w, req.data.id, { files: [['foto.exe', 'MZ', 'application/octet-stream']] })).data.error, /PDF, JPG, PNG o HEIC/);
  const other = await person('Oreste');
  assert.equal((await send(other, req.data.id, { files: [['a.pdf', 'X']] })).status, 403, 'solo chi ha fatto la richiesta');
  const first = await send(w, req.data.id, { files: [['ticket.pdf', 'PDF-1']], fields: { note: 'originale lunedì' } });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  [d] = await mine(w);
  assert.equal(d.status, 'review');
  assert.equal(d.files.length, 1);
  const docId = d.files[0].id;
  assert.equal(t.db.prepare('SELECT type_code FROM hr_documents WHERE id = ?').get(docId).type_code, 'giustificativo_sanitario');
  assert.ok(t.db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'hr.justification.submitted'").get(hr.userId), 'l\'ufficio personale è avvisato');

  const bossView = await boss.call('GET', `/api/admin/hr/absences/justifications?state=review`);
  assert.equal(bossView.status, 403, 'il responsabile senza livello personale non entra nella verifica');
  const signedBoss = await boss.call('GET', '/api/admin/signed-url?path=' + encodeURIComponent(`/api/admin/hr/documents/${docId}/download`));
  assert.equal((await fetch(t.base + signedBoss.data.url)).status, 403, 'il responsabile non apre il documento sanitario');
  const partial = (await hrNoHealth.call('GET', '/api/admin/hr/absences/justifications?state=review')).data.find(x => x.absence_id === req.data.id);
  assert.deepEqual([partial.files.length, partial.can_review], [0, false], 'senza il livello sanitario niente file');
  assert.equal((await hrNoHealth.call('POST', `/api/admin/hr/absences/${req.data.id}/justification/accept`)).status, 403);

  assert.equal((await hr.call('POST', `/api/admin/hr/absences/${req.data.id}/justification/reject`, {})).status, 400, 'il motivo è obbligatorio');
  assert.equal((await hr.call('POST', `/api/admin/hr/absences/${req.data.id}/justification/reject`, { note: 'Manca l\'orario' })).status, 200);
  [d] = await mine(w);
  assert.deepEqual([d.status, d.hr_note], ['ko', 'Manca l\'orario']);
  assert.equal(t.db.prepare("SELECT link FROM notifications WHERE user_id = ? AND kind = 'hr.justification.decided' ORDER BY id DESC").get(w.userId).link, '/portal.html?workspace=people&sub=people-timesheet&tab=giustificativi');

  assert.equal((await send(w, req.data.id, { files: [['ticket-orario.pdf', 'PDF-2'], ['foto.jpg', 'JPG', 'image/jpeg']] })).status, 200);
  [d] = await mine(w);
  assert.deepEqual([d.status, d.files.map(f => f.name)], ['review', ['ticket-orario.pdf', 'foto.jpg']]);
  assert.ok(!t.db.prepare('SELECT 1 FROM hr_documents WHERE id = ?').get(docId), 'il file di prima si cancella');
  const signedHr = await hr.call('GET', '/api/admin/signed-url?path=' + encodeURIComponent(`/api/admin/hr/documents/${d.files[0].id}/download`));
  assert.equal(await (await fetch(t.base + signedHr.data.url)).text(), 'PDF-2');
  assert.ok(t.db.prepare("SELECT 1 FROM sensitive_access_log WHERE what LIKE ?").get(`download documento ${d.files[0].id}%`), 'l\'apertura resta nel registro');
  assert.equal((await hr.call('POST', `/api/admin/hr/absences/${req.data.id}/justification/accept`)).status, 200);
  [d] = await mine(w);
  assert.equal(d.status, 'ok');
  assert.equal((await send(w, req.data.id, { files: [['x.pdf', 'X']] })).status, 409, 'accettato: non si cambia');
});

test('malattia: il protocollo della comunicazione basta (in verifica); si può correggere con sole cifre', async () => {
  const w = await person('Mara');
  const m = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('malattia'), start_date: '2031-04-07', end_date: '2031-04-08', protocol: '48213977' });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  let d = (await mine(w)).find(x => x.absence_id === m.data.id);
  assert.deepEqual([d.status, d.protocol, d.doc_mode], ['review', '48213977', 'protocol']);
  assert.match((await send(w, m.data.id, { fields: { protocol: '12AB' } })).data.error, /sole cifre/);
  assert.equal((await send(w, m.data.id, { fields: { protocol: '4821 3978' } })).status, 200, 'senza file: per la malattia basta il protocollo');
  d = (await mine(w)).find(x => x.absence_id === m.data.id);
  assert.equal(d.protocol, '48213978');
  assert.equal(t.db.prepare('SELECT protocol FROM absences WHERE id = ?').get(m.data.id).protocol, '48213978');
});

test('autocertificazione: modulo precompilato per i tipi che la ammettono; ferie senza giustificativo', async () => {
  const w = await person('Nino');
  const l = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('lutto'), start_date: '2031-05-05', end_date: '2031-05-06' });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  const signed = await w.call('GET', '/api/admin/signed-url?path=' + encodeURIComponent(`/api/admin/hr/absences/${l.data.id}/self-cert`));
  const html = await (await fetch(t.base + signed.data.url)).text();
  assert.match(html, /D\.P\.R\. 28 dicembre 2000, n\. 445/);
  assert.match(html, /Nino Giust/);
  await t.api('PUT', `/api/admin/hr/employees/${w.id}/allowances`, { counter: 'ferie', year: 2031, annual: '26', accrual: 'annuale' });
  const f = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('ferie'), start_date: '2031-06-02', end_date: '2031-06-03' });
  assert.equal(f.status, 200, JSON.stringify(f.data));
  assert.ok(!(await mine(w)).some(x => x.absence_id === f.data.id), 'le ferie non chiedono documenti');
  assert.equal((await send(w, f.data.id, { files: [['x.pdf', 'X']] })).status, 400);
  const sc = await w.call('GET', '/api/admin/signed-url?path=' + encodeURIComponent(`/api/admin/hr/absences/${f.data.id}/self-cert`));
  assert.equal((await fetch(t.base + sc.data.url)).status, 400);
});

test('promemoria e scadenzario: due giorni prima, il giorno stesso e il giorno dopo; lo scadenzario HR li elenca', async () => {
  const w = await person('Otto');
  const r = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('donazione_sangue'), start_date: '2031-07-01', end_date: '2031-07-01' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const count = () => t.db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'hr.justification.reminder'").get(w.userId).c;
  t.hrJustifications.remind(new Date('2031-07-02T09:00:00Z'));
  assert.equal(count(), 0, 'scade il 6: il 2 è presto');
  t.hrJustifications.remind(new Date('2031-07-04T09:00:00Z'));
  t.hrJustifications.remind(new Date('2031-07-04T15:00:00Z'));
  assert.equal(count(), 1, 'due giorni prima, una volta sola');
  t.hrJustifications.remind(new Date('2031-07-06T09:00:00Z'));
  t.hrJustifications.remind(new Date('2031-07-07T09:00:00Z'));
  assert.equal(count(), 3);
  const due = t.hrFile.deadlines({ within: 3650, kind: 'giustificativo' }).find(x => x.ref === `just:${r.data.id}`);
  assert.ok(due, 'nello scadenzario HR');
  assert.equal(due.due_date, '2031-07-06');
});

test('avvio: le assenze di prima non chiedono il giustificativo; assenza annullata: i file si cancellano', async () => {
  const w = await person('Vito');
  const old = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('donazione_sangue'), start_date: '2031-08-01', end_date: '2031-08-01' });
  t.db.prepare("UPDATE absences SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(old.data.id);
  assert.ok(!(await mine(w)).some(x => x.absence_id === old.data.id), 'inserita prima dell\'avvio');
  assert.equal((await send(w, old.data.id, { files: [['x.pdf', 'X']] })).status, 409);
  assert.ok(!t.hrFile.deadlines({ within: 3650, kind: 'giustificativo' }).some(x => x.ref === `just:${old.data.id}`));

  const r = await w.call('POST', '/api/admin/hr/absences', { absence_type_id: typeId('diritto_studio'), start_date: '2031-08-04', end_date: '2031-08-04' });
  assert.equal((await send(w, r.data.id, { files: [['esame.pdf', 'ESAME']] })).status, 200);
  const docId = (await mine(w)).find(x => x.absence_id === r.data.id).files[0].id;
  assert.equal((await w.call('POST', `/api/admin/hr/absences/${r.data.id}/cancel`, {})).status, 200);
  assert.ok(!(await mine(w)).some(x => x.absence_id === r.data.id), 'annullata: non si chiede più');
  assert.ok(t.hrJustifications.purgeUnneeded() >= 1);
  assert.ok(!t.db.prepare('SELECT 1 FROM hr_documents WHERE id = ?').get(docId), 'il file non resta in archivio');
});
