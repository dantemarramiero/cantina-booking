// Fase 2, blocco 2E — self-service e richieste di modifica, dotazioni, onboarding/offboarding,
// cedolini in blocco abbinati per codice fiscale, stagionali, recruiting (modello dati).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

let seq = 0;
const iso = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const emp = async (first, last, extra = {}) => (await t.api('POST', '/api/admin/hr/employees', { first_name: first, last_name: last, ...extra })).data.id;
// Dipendente con accesso al portale e un ruolo SENZA il workspace People (come un addetto all'Enoturismo).
async function person(first, { workspaces = ['enoturismo'], levels = [] } = {}) {
  const username = `${first.toLowerCase()}-${++seq}`;
  const role = (await t.api('POST', '/api/admin/roles', { name: `R ${username}`, workspaces, access_levels: levels })).data.id;
  const u = (await t.api('POST', '/api/admin/portal-users', { name: `${first} Test`, email: `${username}@x.it`, username, password: 'password-lunga', role_id: role })).data.id;
  const token = (await t.request('POST', '/api/portal-users/login', { body: { username, password: 'password-lunga' } })).data.key;
  const id = await emp(first, 'Test', { portal_user_id: u });
  return { id, userId: u, token, call: (method, p, body) => t.request(method, p, { token, body }) };
}
async function upload(url, fields, files, token = t.token) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [name, content] of files) fd.append('files', new Blob([content], { type: 'application/pdf' }), name);
  const res = await fetch(t.base + url, { method: 'POST', headers: { 'x-admin-key': token }, body: fd });
  return { status: res.status, data: await res.json() };
}

test('self-service: il dipendente vede il suo fascicolo e chiede modifiche, che valgono solo dopo l\'approvazione di HR', async () => {
  const p = await person('Paolo');
  await t.api('PUT', `/api/admin/hr/employees/${p.id}/personal`, { fiscal_code: 'PLATST80A01G482Z', iban: 'IT60X0542811101000000123456', residence_city: 'Pescara' });
  const mine = await p.call('GET', '/api/admin/hr/me');
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.equal(mine.data.file.personal.data.residence_city, 'Pescara');
  assert.equal((await p.call('GET', `/api/admin/hr/employees/${p.id}/file`)).status, 403, 'senza il workspace People passa solo dal self-service');
  assert.equal((await p.call('GET', '/api/admin/me')).data.employeeId, p.id, 'con la scheda collegata il portale gli mostra il Timesheet');
  assert.equal((await p.call('GET', `/api/admin/hr/timesheet/month?employee_id=${p.id}&period=2026-09`)).status, 200, 'e le API del Timesheet gli rispondono');
  assert.equal((await p.call('POST', '/api/admin/hr/me/change-requests', { iban: 'XX12' })).status, 400, 'IBAN controllato subito');
  const req = await p.call('POST', '/api/admin/hr/me/change-requests', { iban: 'IT02 L123 4512 3451 2345 6789 012', residence_city: 'Montesilvano', emergency_contacts: [{ name: 'Lucia', relationship: 'sorella', phone: '3331112222' }] });
  assert.equal(req.status, 200, JSON.stringify(req.data));
  assert.equal(t.db.prepare('SELECT residence_city FROM employee_personal WHERE employee_id = ?').get(p.id).residence_city, 'Pescara', 'non si applica prima dell\'approvazione');
  assert.equal((await p.call('POST', '/api/admin/hr/me/change-requests', { residence_city: 'Chieti' })).status, 409, 'una richiesta alla volta');
  assert.equal((await p.call('POST', `/api/admin/hr/change-requests/${req.data.id}/approve`)).status, 403);
  const list = (await t.api('GET', '/api/admin/hr/change-requests?status=richiesta')).data.find(c => c.id === req.data.id);
  assert.deepEqual(list.current, { iban: 'IT60X0542811101000000123456', residence_city: 'Pescara' }, 'HR vede prima e dopo');
  assert.equal((await t.api('POST', `/api/admin/hr/change-requests/${req.data.id}/approve`)).status, 200);
  const now = { ...t.db.prepare('SELECT iban, residence_city FROM employee_personal WHERE employee_id = ?').get(p.id) };
  assert.deepEqual(now, { iban: 'IT02L1234512345123456789012', residence_city: 'Montesilvano' });
  assert.equal(t.db.prepare('SELECT name FROM emergency_contacts WHERE employee_id = ?').get(p.id).name, 'Lucia');
  const decided = (await t.api('GET', '/api/admin/hr/change-requests')).data.find(c => c.id === req.data.id);
  assert.deepEqual(decided.current, { iban: 'IT60X0542811101000000123456', residence_city: 'Pescara' }, 'dopo l\'approvazione resta il prima → dopo');
  const log = t.db.prepare("SELECT after_json FROM audit_log WHERE action LIKE 'change_request.%'").all().map(x => x.after_json).join();
  assert.ok(!log.includes('IT02') && !log.includes('Montesilvano'), 'nel registro i campi, non i valori');
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'hr.change_request.decided'").get(p.userId).c, 1);
});

test('self-service: il dipendente scarica i propri cedolini anche senza il workspace People, i colleghi no', async () => {
  const p = await person('Carla');
  const other = await person('Dario');
  const fd = new FormData();
  fd.append('type_code', 'cedolino');
  fd.append('file', new Blob(['CEDOLINO-CARLA'], { type: 'application/pdf' }), 'agosto.pdf');
  await fetch(`${t.base}/api/admin/hr/employees/${p.id}/documents`, { method: 'POST', headers: { 'x-admin-key': t.token }, body: fd });
  const doc = (await p.call('GET', '/api/admin/hr/me')).data.file.documents.find(d => d.type_code === 'cedolino');
  const signed = await p.call('GET', '/api/admin/signed-url?path=' + encodeURIComponent(`/api/admin/hr/documents/${doc.id}/download`));
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  assert.equal(await (await fetch(t.base + signed.data.url)).text(), 'CEDOLINO-CARLA');
  const theirs = await other.call('GET', '/api/admin/signed-url?path=' + encodeURIComponent(`/api/admin/hr/documents/${doc.id}/download`));
  const res = await fetch(t.base + theirs.data.url);
  assert.equal(res.status, 403, 'il collega ottiene il link ma il download è rifiutato');
});

test('dotazioni: consegna e restituzione; il dipendente le vede nel suo spazio', async () => {
  const p = await person('Elio');
  const a = await t.api('POST', `/api/admin/hr/employees/${p.id}/assets`, { kind: 'chiavi', description: 'Chiavi bottaia', delivered_on: '2026-03-01' });
  assert.equal(a.status, 200);
  assert.equal((await t.api('PATCH', `/api/admin/hr/assets/${a.data.id}`, { returned_on: '2026-02-01' })).status, 400);
  assert.equal((await p.call('GET', '/api/admin/hr/me')).data.assets[0].description, 'Chiavi bottaia');
  assert.equal((await p.call('POST', `/api/admin/hr/employees/${p.id}/assets`, { kind: 'pc', description: 'x', delivered_on: '2026-03-01' })).status, 403);
});

test('onboarding: checklist dal tipo di contratto, verifiche automatiche, non si chiude con voci obbligatorie aperte', async () => {
  const e = await emp('Nora', 'Nuova');
  await t.api('POST', `/api/admin/hr/employees/${e}/contracts`, { effective_from: '2026-09-01', contract_type: 'stagionale', end_date: '2026-11-30' });
  const spec = await t.api('POST', '/api/admin/hr/checklist-templates', { kind: 'onboarding', name: 'Ingresso stagionali', contract_types: ['stagionale'],
    items: [{ title: 'Dati personali', item_type: 'dati' }, { title: 'Formazione generale', item_type: 'formazione', ref: 'generale' }, { title: 'Scarpe', item_type: 'dpi', required: false }] });
  const start = await t.api('POST', `/api/admin/hr/employees/${e}/checklists`, { kind: 'onboarding' });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  let [c] = (await t.api('GET', `/api/admin/hr/employees/${e}/checklists`)).data;
  assert.equal(c.template_id, spec.data.id, 'la checklist specifica del contratto stagionale vince su quella generale');
  assert.deepEqual(c.items.map(i => i.auto), [false, false, false]);
  await t.api('PUT', `/api/admin/hr/employees/${e}/personal`, { fiscal_code: 'NRANVO90A41G482K', iban: 'IT60X0542811101000000123456', residence_address: 'Via Roma 1' });
  await t.api('POST', `/api/admin/hr/employees/${e}/trainings`, { training_type_id: t.db.prepare("SELECT id FROM training_types WHERE code = 'generale'").get().id, completed_on: '2026-09-01' });
  [c] = (await t.api('GET', `/api/admin/hr/employees/${e}/checklists`)).data;
  assert.deepEqual(c.items.map(i => i.auto), [true, true, false], 'le verifiche seguono i dati');
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${e}/checklists`, { kind: 'onboarding' })).status, 409, 'uno alla volta');
  const early = await t.api('POST', `/api/admin/hr/checklists/${c.id}/complete`);
  assert.equal(early.status, 409);
  assert.match(early.data.error, /Mancano ancora: Dati personali; Formazione generale/);
  for (const it of c.items.filter(i => i.required)) await t.api('POST', `/api/admin/hr/checklist-items/${it.id}`, { done: true });
  assert.equal((await t.api('POST', `/api/admin/hr/checklists/${c.id}/complete`)).status, 200, 'le voci facoltative non bloccano');
  assert.equal(t.db.prepare('SELECT active FROM employees WHERE id = ?').get(e).active, 1, 'l\'onboarding non disattiva nessuno');
});

test('offboarding concluso: accesso al portale e operatore disattivati (non cancellati), dipendente non attivo', async () => {
  const p = await person('Olga');
  await t.api('POST', `/api/admin/hr/employees/${p.id}/assets`, { kind: 'badge', description: 'Badge ingresso', delivered_on: '2026-01-10' });
  const start = await t.api('POST', `/api/admin/hr/employees/${p.id}/checklists`, { kind: 'offboarding' });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const [c] = (await t.api('GET', `/api/admin/hr/employees/${p.id}/checklists`)).data;
  assert.equal(c.items.find(i => i.item_type === 'restituzione').auto, false, 'il badge non è restituito');
  const asset = t.db.prepare('SELECT id FROM employee_assets WHERE employee_id = ?').get(p.id).id;
  await t.api('PATCH', `/api/admin/hr/assets/${asset}`, { returned_on: iso(0) });
  assert.equal((await t.api('GET', `/api/admin/hr/employees/${p.id}/checklists`)).data[0].items.find(i => i.item_type === 'restituzione').auto, true);
  for (const it of c.items) await t.api('POST', `/api/admin/hr/checklist-items/${it.id}`, { done: true });
  assert.equal((await p.call('GET', '/api/admin/hr/me')).status, 200, 'prima dell\'uscita accede');
  assert.equal((await t.api('POST', `/api/admin/hr/checklists/${c.id}/complete`)).status, 200);
  assert.equal(t.db.prepare('SELECT active FROM portal_users WHERE id = ?').get(p.userId).active, 0);
  const op = t.db.prepare('SELECT * FROM operators WHERE portal_user_id = ?').get(p.userId);
  assert.ok(op, 'l\'operatore resta');
  assert.equal(op.active, 0, 'ma non è più attivo');
  assert.equal(t.db.prepare('SELECT active FROM employees WHERE id = ?').get(p.id).active, 0);
  assert.equal((await p.call('GET', '/api/admin/hr/me')).status, 401, 'le sessioni sono revocate');
  assert.ok(t.db.prepare("SELECT 1 FROM domain_events WHERE type = 'employee.offboarded' AND source_id = ?").get(c.id));
});

test('cedolini in blocco: abbinati per codice fiscale nel nome o nel testo del PDF; gli altri restano da abbinare', async () => {
  const a = await person('Anna');
  const b = await emp('Bruno', 'Blocco');
  await t.api('PUT', `/api/admin/hr/employees/${a.id}/personal`, { fiscal_code: 'NNATST85M41G482P' });
  await t.api('PUT', `/api/admin/hr/employees/${b}/personal`, { fiscal_code: 'BRNBLC80A01G482Y' });
  const pdf = cf => Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj <</Filter /FlateDecode>>\nstream\n'), zlib.deflateSync(Buffer.from(`BT /F1 10 Tf (Codice fiscale: ${cf}) Tj ET`)), Buffer.from('\nendstream\nendobj\n%%EOF')]);
  const files = [
    ['cedolino_2026_09_nnatst85m41g482p.pdf', Buffer.from('%PDF-1.4 cedolino Anna')],
    ['busta-paga-003.pdf', pdf('BRNBLC80A01G482Y')],
    ['sconosciuto.pdf', pdf('ZZZZZZ80A01G482Z')],
    ['vuoto.pdf', Buffer.from('%PDF-1.4 niente')],
  ];
  const res = await upload('/api/admin/hr/documents/bulk', { type_code: 'cedolino', title: 'Cedolino settembre 2026', doc_date: '2026-09-30' }, files);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.stored.map(s => [s.file, s.employee_name, s.matched_by]), [
    ['cedolino_2026_09_nnatst85m41g482p.pdf', 'Anna Test', 'nome del file'],
    ['busta-paga-003.pdf', 'Bruno Blocco', 'contenuto'],
  ]);
  assert.deepEqual(res.data.unmatched.map(u => u.file), ['sconosciuto.pdf', 'vuoto.pdf']);
  const row = t.db.prepare("SELECT * FROM hr_documents WHERE employee_id = ? AND type_code = 'cedolino'").get(b);
  assert.equal(row.title, 'Cedolino settembre 2026');
  assert.ok(!fs.readFileSync(path.join(t.dir, 'hr-files', `${row.storage_key}.bin`)).toString('latin1').includes('BRNBLC'), 'cifrato sul disco');
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'hr.document.new'").get(a.userId).c, 1, 'il dipendente è avvisato');
  const again = await upload('/api/admin/hr/documents/bulk', { type_code: 'cedolino', title: 'Cedolino settembre 2026' }, [files[0]]);
  assert.match(again.data.unmatched[0].reason, /Già caricato/);
  const noLevel = await person('Nico', { workspaces: ['people'], levels: ['personale'] });
  assert.equal((await upload('/api/admin/hr/documents/bulk', { type_code: 'cedolino' }, [files[0]], noLevel.token)).status, 403, 'il cedolino è retributivo');
});

test('cedolini in blocco: nessun abbinamento se è ambiguo (familiari a carico, più cedolini, nome e contenuto discordi); codice del titolare escluso, omocodia accettata', async () => {
  const g = await emp('Giuseppe', 'Verdi');
  const l = await emp('Laura', 'Bianchi');
  const o = await emp('Omar', 'Omocodia');
  const boss = await emp('Titolare', 'Ditta');
  const GIUSEPPE = 'VRDGPP75C10G482K', LAURA = 'BNCLRA82D50G482W', MARIO = 'RSSMRA70E15G482T', OMAR = 'SNTLCU80A01G48NQ', OWNER = 'MRRDNT60H01G482R';
  await t.api('PUT', `/api/admin/hr/employees/${g}/personal`, { fiscal_code: GIUSEPPE });
  await t.api('PUT', `/api/admin/hr/employees/${l}/personal`, { fiscal_code: LAURA });
  assert.equal((await t.api('PUT', `/api/admin/hr/employees/${o}/personal`, { fiscal_code: OMAR })).status, 200, 'il codice omocodico è valido');
  await t.api('PUT', `/api/admin/hr/employees/${boss}/personal`, { fiscal_code: OWNER });
  // Ditta individuale: il codice fiscale dell'azienda è quello del titolare, stampato su ogni CU.
  t.db.prepare("INSERT INTO settings (key, value) VALUES ('company_fiscal_code', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(OWNER);
  const pdf = (...cfs) => Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj <</Filter /FlateDecode>>\nstream\n'),
    zlib.deflateSync(Buffer.from(cfs.map(cf => `BT (Codice fiscale: ${cf}) Tj ET`).join('\n'))), Buffer.from('\nendstream\nendobj\n%%EOF')]);
  const files = [
    ['cu-mario.pdf', pdf(OWNER, MARIO, LAURA)], // CU di Mario (codice non registrato) con Laura familiare a carico
    ['cu-mario-senza-titolare.pdf', pdf(MARIO, LAURA)], // prima andava a Laura: l'unico codice di un dipendente
    ['cedolini-settembre.pdf', pdf(GIUSEPPE, MARIO, 'ZZZZZZ80A01G482Z')], // più cedolini nello stesso PDF
    ['cu-giuseppe.pdf', pdf(OWNER, GIUSEPPE)], // il codice del titolare non conta
    [`X1${GIUSEPPE}ZZ.pdf`, Buffer.from('%PDF-1.4 niente')], // codice attaccato ad altri caratteri: non è un codice
    [`cedolino_${GIUSEPPE}.pdf`, pdf(LAURA)], // nome e contenuto discordi
    [`cedolino_${GIUSEPPE}_bis.pdf`, pdf(GIUSEPPE, LAURA)], // contiene anche un'altra dipendente
    [`cedolino_${OMAR}.pdf`, pdf(OMAR)],
    [`cu_${GIUSEPPE}_2025.pdf`, pdf(OWNER, GIUSEPPE, MARIO)], // familiare a carico non dipendente: il nome conferma
  ];
  const res = await upload('/api/admin/hr/documents/bulk', { type_code: 'cedolino', title: 'Prova abbinamenti' }, files);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.stored.map(s => [s.file, s.employee_name, s.matched_by]), [
    ['cu-giuseppe.pdf', 'Giuseppe Verdi', 'contenuto'],
    [`cedolino_${OMAR}.pdf`, 'Omar Omocodia', 'nome del file'],
    [`cu_${GIUSEPPE}_2025.pdf`, 'Giuseppe Verdi', 'nome del file'],
  ]);
  const why = Object.fromEntries(res.data.unmatched.map(u => [u.file, u.reason]));
  assert.match(why['cu-mario.pdf'], /più codici fiscali/);
  assert.match(why['cu-mario-senza-titolare.pdf'], /più codici fiscali/);
  assert.match(why['cedolini-settembre.pdf'], /più codici fiscali/);
  assert.match(why[`X1${GIUSEPPE}ZZ.pdf`], /Nessun codice fiscale/);
  assert.match(why[`cedolino_${GIUSEPPE}.pdf`], /non compare nel documento/);
  assert.match(why[`cedolino_${GIUSEPPE}_bis.pdf`], /altri dipendenti/);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM hr_documents WHERE employee_id IN (?, ?) AND title = 'Prova abbinamenti'").get(l, boss).c, 0, 'né Laura né il titolare ricevono documenti non loro');
  t.db.prepare("DELETE FROM settings WHERE key = 'company_fiscal_code'").run();
});

test('documenti: senza il workspace People si scaricano solo i propri, anche se il ruolo ha i livelli', async () => {
  const owner = await person('Sara');
  const nosy = await person('Ugo', { workspaces: ['enoturismo'], levels: ['personale', 'retributivo'] });
  const baseType = t.db.prepare("SELECT code FROM hr_document_types WHERE level = 'base' ORDER BY code LIMIT 1").get().code;
  const ids = [];
  for (const [type, body] of [['cedolino', 'CEDOLINO-SARA'], [baseType, 'BASE-SARA']]) {
    const fd = new FormData();
    fd.append('type_code', type);
    fd.append('file', new Blob([body], { type: 'application/pdf' }), `${type}.pdf`);
    const up = await fetch(`${t.base}/api/admin/hr/employees/${owner.id}/documents`, { method: 'POST', headers: { 'x-admin-key': t.token }, body: fd });
    assert.equal(up.status, 200, await up.text());
    ids.push(t.db.prepare('SELECT id FROM hr_documents WHERE employee_id = ? AND type_code = ?').get(owner.id, type).id);
  }
  for (const id of ids) {
    const signed = await nosy.call('GET', '/api/admin/signed-url?path=' + encodeURIComponent(`/api/admin/hr/documents/${id}/download`));
    assert.equal((await fetch(t.base + signed.data.url)).status, 403, `documento ${id}: i livelli del ruolo valgono solo con il workspace People`);
    assert.equal((await nosy.call('GET', `/api/admin/hr/documents/${id}/download`)).status, 403, 'anche con la sessione, senza link firmato');
  }
  const own = await owner.call('GET', '/api/admin/signed-url?path=' + encodeURIComponent(`/api/admin/hr/documents/${ids[0]}/download`));
  assert.equal(await (await fetch(t.base + own.data.url)).text(), 'CEDOLINO-SARA', 'i propri cedolini sì');
});

test('richieste di modifica: approvando i contatti di emergenza restano quelli di prima per il confronto', async () => {
  const p = await person('Rita');
  await t.api('PUT', `/api/admin/hr/employees/${p.id}/personal`, { emergency_contacts: [{ name: 'Marco', relationship: 'fratello', phone: '3330000001' }] });
  const req = await p.call('POST', '/api/admin/hr/me/change-requests', { emergency_contacts: [{ name: 'Elisa', relationship: 'madre', phone: '3330000002' }] });
  assert.equal(req.status, 200, JSON.stringify(req.data));
  assert.equal((await t.api('POST', `/api/admin/hr/change-requests/${req.data.id}/approve`)).status, 200);
  const decided = (await t.api('GET', '/api/admin/hr/change-requests')).data.find(c => c.id === req.data.id);
  assert.deepEqual(decided.current_contacts, [{ name: 'Marco', relationship: 'fratello', phone: '3330000001' }]);
  assert.equal(t.db.prepare('SELECT name FROM emergency_contacts WHERE employee_id = ?').get(p.id).name, 'Elisa');
});

test('stagionali: campagne lavorate e indicazione da richiamare', async () => {
  const s = await emp('Samir', 'Stagione');
  await t.api('POST', `/api/admin/hr/employees/${s}/contracts`, { effective_from: '2025-09-01', contract_type: 'stagionale', hire_date: '2025-09-01', end_date: '2025-10-31', job_role_id: t.db.prepare("SELECT id FROM job_roles WHERE code = 'operaio_agricolo'").get().id });
  await t.api('POST', `/api/admin/hr/employees/${s}/contracts`, { effective_from: '2026-09-01', contract_type: 'stagionale', hire_date: '2026-09-01', end_date: '2026-10-31', rehire_ok: '1' });
  const row = (await t.api('GET', '/api/admin/hr/seasonal')).data.find(x => x.employee_id === s);
  assert.deepEqual(row.campaigns.map(c => [c.year, c.from, c.to]), [[2025, '2025-09-01', '2025-10-31'], [2026, '2026-09-01', '2026-10-31']]);
  assert.equal(row.rehire_ok, 1);
  assert.equal(row.last_role, 'Operaio agricolo');
});

test('recruiting: consenso e cancellazione automatica; conversione in dipendente senza reinserire i dati', async () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ first_name: 'Ciro', last_name: 'Candidato', email: 'Ciro@x.it', fiscal_code: 'crccnd90a01g482u', privacy_consent_at: '2026-09-01' })) fd.append(k, v);
  fd.append('cv', new Blob(['CV DI CIRO'], { type: 'application/pdf' }), 'cv.pdf');
  const c = await (await fetch(`${t.base}/api/admin/hr/candidates`, { method: 'POST', headers: { 'x-admin-key': t.token }, body: fd })).json();
  assert.equal(c.delete_after, '2027-09-01', '12 mesi dal consenso');
  const conv = await t.api('POST', `/api/admin/hr/candidates/${c.id}/convert`, { job_title: 'Cantiniere' });
  assert.equal(conv.status, 200, JSON.stringify(conv.data));
  const e = conv.data.employee_id;
  assert.deepEqual({ ...t.db.prepare('SELECT fiscal_code, personal_email FROM employee_personal WHERE employee_id = ?').get(e) }, { fiscal_code: 'CRCCND90A01G482U', personal_email: 'ciro@x.it' });
  assert.equal(t.db.prepare("SELECT COUNT(*) AS c FROM hr_documents WHERE employee_id = ? AND type_code = 'cv'").get(e).c, 1, 'il CV passa al fascicolo');
  // Un candidato non assunto oltre la data si cancella da solo, con il suo CV.
  const fd2 = new FormData();
  for (const [k, v] of Object.entries({ first_name: 'Vito', last_name: 'Vecchio', privacy_consent_at: '2024-01-10', delete_after: '2025-01-10' })) fd2.append(k, v);
  fd2.append('cv', new Blob(['CV DI VITO'], { type: 'application/pdf' }), 'cv.pdf');
  const old = await (await fetch(`${t.base}/api/admin/hr/candidates`, { method: 'POST', headers: { 'x-admin-key': t.token }, body: fd2 })).json();
  const key = t.db.prepare('SELECT d.storage_key FROM candidate_documents cd JOIN hr_documents d ON d.id = cd.document_id WHERE cd.candidate_id = ?').get(old.id).storage_key;
  assert.equal(t.hrServices.purgeCandidates(), 1);
  assert.ok(!t.db.prepare('SELECT 1 FROM candidates WHERE id = ?').get(old.id));
  assert.ok(!fs.existsSync(path.join(t.dir, 'hr-files', `${key}.bin`)), 'anche il file del CV');
  assert.ok(t.db.prepare('SELECT 1 FROM candidates WHERE id = ?').get(c.id), 'chi è stato assunto resta');
});

test('un dipendente con dotazioni non si elimina', async () => {
  const d = await emp('Dora', 'Dotata');
  await t.api('POST', `/api/admin/hr/employees/${d}/assets`, { kind: 'telefono', description: 'Telefono', delivered_on: '2026-01-01' });
  assert.match((await t.api('DELETE', `/api/admin/hr/employees/${d}`)).data.error, /dotazioni/);
});
