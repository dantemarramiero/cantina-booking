// People → giustificativi delle assenze (handoff MyWinery «Giustificativi»).
//
// Ogni assenza valida o in attesa (non bozza, rifiutata o annullata) il cui tipo richiede un documento ha
// un giustificativo: da caricare → in verifica → accettato, oppure da ricaricare con il motivo dell'ufficio
// personale. Scadenza = fine dell'assenza + i giorni previsti dal tipo.
//  - Il dipendente carica i file (PDF, JPG, PNG, HEIC, max 10 MB, fino a 5) o, per la malattia, indica il
//    numero di protocollo: l'azienda legge il certificato sul portale INPS, senza diagnosi. Per i tipi che
//    lo ammettono può usare l'autocertificazione (modulo precompilato da scaricare, firmare e caricare).
//  - I file vanno nell'archivio HR cifrato. Quelli dei tipi sanitari hanno il livello «sanitario»: li vede
//    solo chi ha quel livello (non il responsabile), e ogni apertura finisce nel registro degli accessi.
//  - L'ufficio personale (livello «personale», più «sanitario» per i tipi sanitari) accetta o chiede di
//    ricaricare. Ricaricando, i file di prima si cancellano: si tiene solo ciò che serve (minimizzazione).
//  - Promemoria al dipendente due giorni prima, il giorno della scadenza e dopo; lo scadenzario HR li elenca.
//  - Valgono per le assenze inserite dall'avvio (impostazione justifications_since, scritta dalla migrazione 0040).
//  - Se l'assenza è rifiutata o annullata i file non servono più: il job orario li cancella.
const multer = require('multer');
const { HttpError, createRouter } = require('../lib/http');
const { addDays, DATE } = require('../lib/calendar');
const { romeDate } = require('../lib/time');

const now = () => new Date().toISOString();
const text = v => (v == null ? null : String(v).trim() || null);
const itDate = d => d.split('-').reverse().join('/');
const LIVE = ['richiesta', 'approvata', 'comunicata', 'presa_visione'];
const MIME = /^(application\/pdf|image\/(jpeg|png|heic|heif))$/i;
const EXT = /\.(pdf|jpe?g|png|heic|heif)$/i;
const LINK_SELF = '/portal.html?workspace=people&sub=people-timesheet&tab=giustificativi';
const LINK_HR = '/portal.html?workspace=people&sub=people-assenze&view=giustificativi';

module.exports = function registerHrJustifications(app, deps) {
  const { db, authAdmin, audit, events, hasAccessLevel, notifications, scheduler, hrFile, secureStore } = deps;
  const r = createRouter(app, '/api/admin/hr', authAdmin);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
  const { viewerEmployee, isSelf, actor } = hrFile;
  const fullName = e => `${e.first_name} ${e.last_name}`;
  const today = () => romeDate();
  const notifyAll = (users, n) => { for (const u of new Set(users)) notifications.notify({ userId: u, ...n }); };

  const absenceRow = id => {
    const a = db.prepare(`SELECT a.*, t.code AS type_code, t.name AS type_name, t.category, t.health, t.unit, t.doc_required, t.doc_label, t.doc_hint, t.doc_deadline_days, t.doc_mode, t.doc_self_cert,
      e.first_name, e.last_name, e.portal_user_id, e.job_title FROM absences a JOIN absence_types t ON t.id = a.absence_type_id JOIN employees e ON e.id = a.employee_id WHERE a.id = ?`).get(id);
    if (!a) throw new HttpError(404, 'Assenza non trovata.');
    return a;
  };
  const dueOf = a => addDays(a.end_date, a.doc_deadline_days || 0);
  const docTypeOf = a => (a.health ? 'giustificativo_sanitario' : 'giustificativo');
  // Stato: la riga salvata, altrimenti «da caricare» (o «in verifica» se il protocollo c'è già dalla comunicazione).
  function stateOf(a) {
    const row = db.prepare('SELECT * FROM absence_justifications WHERE absence_id = ?').get(a.id);
    if (row) return row;
    if (a.doc_mode === 'protocol' && a.protocol) return { absence_id: a.id, status: 'review', protocol: a.protocol, self_cert: 0, from_request: true };
    return { absence_id: a.id, status: 'todo', self_cert: 0 };
  }
  const filesOf = absenceId => db.prepare(`SELECT d.id, d.original_name AS name, d.size_bytes AS size, d.mime, d.uploaded_at, d.storage_key FROM absence_justification_files f
    JOIN hr_documents d ON d.id = f.document_id WHERE f.absence_id = ? ORDER BY d.id`).all(absenceId);
  // Chi verifica: l'ufficio personale; per i tipi sanitari serve anche il livello «sanitario».
  const canReview = (req, a) => hasAccessLevel(req, 'personale') && (!a.health || hasAccessLevel(req, 'sanitario'));
  function view(req, a, { withFiles = true } = {}) {
    const st = stateOf(a);
    return {
      absence_id: a.id, employee_id: a.employee_id, employee_name: fullName(a), employee_job_title: a.job_title,
      absence_status: a.status, type_id: a.absence_type_id, type_code: a.type_code, type_name: a.type_name, category: a.category, health: !!a.health, unit: a.unit,
      start_date: a.start_date, end_date: a.end_date, part: a.part, start_time: a.start_time, end_time: a.end_time, amount: a.amount,
      doc_label: a.doc_label, doc_hint: a.doc_hint, doc_mode: a.doc_mode, doc_self_cert: !!a.doc_self_cert, due_date: dueOf(a),
      status: st.status, protocol: st.protocol || null, self_cert: !!st.self_cert, employee_note: st.employee_note || null, hr_note: st.hr_note || null,
      submitted_at: st.submitted_at || null, reviewed_at: st.reviewed_at || null, reviewed_by: st.reviewed_by || null,
      files: withFiles ? filesOf(a.id).map(({ storage_key, ...f }) => f) : [], can_review: canReview(req, a),
    };
  }
  const since = () => db.prepare("SELECT value FROM settings WHERE key = 'justifications_since'").get()?.value || '';
  const pendingAbsences = where => db.prepare(`SELECT a.id FROM absences a JOIN absence_types t ON t.id = a.absence_type_id JOIN employees e ON e.id = a.employee_id
    WHERE t.doc_required = 1 AND a.status IN (${LIVE.map(() => '?').join(',')}) AND a.created_at >= ? ${where.sql} ORDER BY a.end_date DESC`).all(...LIVE, since(), ...where.params).map(x => absenceRow(x.id));

  // I propri giustificativi (scheda «Giustificativi» del Timesheet).
  r.get('/absences/justifications/mine', req => {
    const me = viewerEmployee(req);
    if (!me) throw new HttpError(403, 'La tua utenza non è collegata a una scheda dipendente.');
    return pendingAbsences({ sql: 'AND a.employee_id = ?', params: [me.id] }).map(a => view(req, a));
  });
  // Ufficio personale: da verificare, mancanti (da caricare o da ricaricare) o tutti. I file dei tipi sanitari
  // solo a chi ha il livello «sanitario».
  r.get('/absences/justifications', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'I giustificativi li verifica l\'ufficio del personale (livello «personale»).');
    const state = req.query.state || 'review';
    return pendingAbsences({ sql: '', params: [] })
      .map(a => view(req, a, { withFiles: canReview(req, a) }))
      .filter(v => state === 'all' || (state === 'review' ? v.status === 'review' : state === 'missing' ? ['todo', 'ko'].includes(v.status) : v.status === state))
      .sort((x, y) => (x.status === 'review' ? x.submitted_at || '' : x.due_date).localeCompare(y.status === 'review' ? y.submitted_at || '' : y.due_date));
  });

  // Invio (o sostituzione) del giustificativo da parte del dipendente.
  app.post('/api/admin/hr/absences/:id/justification', authAdmin, (req, res, next) => upload.array('files', 5)(req, res, err => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Ogni file può essere al massimo di 10 MB.' : err.code === 'LIMIT_FILE_COUNT' ? 'Al massimo 5 file.' : 'Caricamento non riuscito.';
    res.status(400).json({ error: msg });
  }));
  r.post('/absences/:id/justification', req => {
    const a = absenceRow(req.params.id);
    if (!isSelf(req, { id: a.employee_id, portal_user_id: a.portal_user_id })) throw new HttpError(403, 'Il giustificativo lo carica chi ha fatto la richiesta.');
    if (!a.doc_required) throw new HttpError(400, `«${a.type_name}» non richiede un giustificativo.`);
    if (!LIVE.includes(a.status)) throw new HttpError(409, 'Per un\'assenza rifiutata o annullata non serve il giustificativo.');
    if (a.created_at < since()) throw new HttpError(409, 'Per le assenze inserite prima dell\'avvio dei giustificativi non serve caricarlo qui.');
    const st = stateOf(a);
    if (st.status === 'ok') throw new HttpError(409, 'Il giustificativo è già stato accettato.');
    const b = req.body || {};
    const files = req.files || [];
    for (const f of files) if (!MIME.test(f.mimetype || '') && !EXT.test(f.originalname || '')) throw new HttpError(400, `«${f.originalname}»: sono ammessi PDF, JPG, PNG o HEIC.`);
    let protocol = null;
    if (a.doc_mode === 'protocol') {
      protocol = String(b.protocol || '').replace(/\s/g, '');
      if (!/^\d{8,}$/.test(protocol)) throw new HttpError(400, 'Il numero di protocollo è fatto di sole cifre (almeno 8).');
    } else if (!files.length) throw new HttpError(400, 'Carica almeno un file.');
    const selfCert = a.doc_self_cert && (b.self_cert === true || b.self_cert === '1' || b.self_cert === 'true') ? 1 : 0;
    const old = filesOf(a.id);
    const saved = events.transaction(() => {
      const ids = files.map(f => hrFile.storeDocument(req, { employeeId: a.employee_id, type: docTypeOf(a), file: f, title: `Giustificativo · ${a.type_name} ${itDate(a.start_date)}`, docDate: today() }));
      db.prepare(`INSERT INTO absence_justifications (absence_id, status, protocol, self_cert, employee_note, hr_note, submitted_at, submitted_by, reviewed_at, reviewed_by, updated_at)
        VALUES (?, 'review', ?, ?, ?, NULL, ?, ?, NULL, NULL, ?) ON CONFLICT (absence_id) DO UPDATE SET status = 'review', protocol = excluded.protocol, self_cert = excluded.self_cert,
        employee_note = excluded.employee_note, hr_note = NULL, submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by, reviewed_at = NULL, reviewed_by = NULL, updated_at = excluded.updated_at`)
        .run(a.id, protocol, selfCert, text(b.note), now(), actor(req), now());
      if (protocol && a.doc_mode === 'protocol') db.prepare('UPDATE absences SET protocol = ?, updated_at = ? WHERE id = ?').run(protocol, now(), a.id);
      // Si tengono solo i file dell'ultimo invio (con la sostituzione i precedenti non servono più).
      for (const d of old) db.prepare('DELETE FROM hr_documents WHERE id = ?').run(d.id);
      const ins = db.prepare('INSERT INTO absence_justification_files (absence_id, document_id) VALUES (?, ?)');
      for (const id of ids) ins.run(a.id, id);
      notifyAll(hrFile.hrRecipients(), { kind: 'hr.justification.submitted', title: `Giustificativo da verificare: ${fullName(a)}`, body: `${a.type_name} ${a.start_date === a.end_date ? `del ${itDate(a.start_date)}` : `dal ${itDate(a.start_date)} al ${itDate(a.end_date)}`}.`, link: LINK_HR, dedupeKey: `just:${a.id}:submitted:${now()}` });
      return ids;
    });
    for (const d of old) { try { secureStore.remove(d.storage_key); } catch {} } // i file cifrati sostituiti
    audit(req, 'absence.justification_submitted', { entity: 'employee', entityId: a.employee_id, after: { absence_id: a.id, files: saved.length, protocol: !!protocol, self_cert: !!selfCert, replaced: old.length } });
    return { success: true, status: 'review' };
  });

  function decide(req, status) {
    const a = absenceRow(req.params.id);
    if (!a.doc_required) throw new HttpError(400, 'Questa assenza non ha un giustificativo.');
    if (!canReview(req, a)) throw new HttpError(403, a.health ? 'I giustificativi sanitari li verifica chi ha i livelli «personale» e «sanitario».' : 'I giustificativi li verifica l\'ufficio del personale.');
    const st = stateOf(a);
    if (st.status !== 'review') throw new HttpError(409, st.status === 'ok' ? 'Il giustificativo è già accettato.' : 'Non c\'è un giustificativo da verificare.');
    const note = text(req.body?.note);
    if (status === 'ko' && !note) throw new HttpError(400, 'Scrivi cosa non va: lo legge il dipendente.');
    events.transaction(() => {
      db.prepare(`INSERT INTO absence_justifications (absence_id, status, protocol, self_cert, employee_note, hr_note, submitted_at, submitted_by, reviewed_at, reviewed_by, updated_at)
        VALUES (?, ?, ?, 0, NULL, ?, NULL, NULL, ?, ?, ?) ON CONFLICT (absence_id) DO UPDATE SET status = excluded.status, hr_note = excluded.hr_note, reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by, updated_at = excluded.updated_at`)
        .run(a.id, status, st.protocol || null, status === 'ko' ? note : null, now(), actor(req), now());
      if (a.portal_user_id) notifications.notify({ userId: a.portal_user_id, kind: 'hr.justification.decided',
        title: status === 'ok' ? `Giustificativo accettato: ${a.type_name} del ${itDate(a.start_date)}` : `Giustificativo da ricaricare: ${a.type_name} del ${itDate(a.start_date)}`,
        body: status === 'ok' ? 'Non serve altro.' : note, link: LINK_SELF, dedupeKey: `just:${a.id}:${status}:${now()}` });
    });
    if (a.health) hrFile.logSensitive(req, { id: a.employee_id }, `verifica giustificativo sanitario assenza ${a.id} (${status})`);
    audit(req, `absence.justification_${status === 'ok' ? 'accepted' : 'rejected'}`, { entity: 'employee', entityId: a.employee_id, after: { absence_id: a.id } });
    return { success: true, status };
  }
  r.post('/absences/:id/justification/accept', req => decide(req, 'ok'));
  r.post('/absences/:id/justification/reject', req => decide(req, 'ko'));

  // Modulo di autocertificazione (DPR 445/2000) precompilato, da stampare e firmare. Pagina HTML da un link firmato.
  app.get('/api/admin/hr/absences/:id/self-cert', authAdmin, (req, res) => {
    try {
      const a = absenceRow(req.params.id);
      if (!isSelf(req, { id: a.employee_id, portal_user_id: a.portal_user_id }) && !hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Non puoi aprire questo modulo.');
      if (!a.doc_self_cert) throw new HttpError(400, `Per «${a.type_name}» l'autocertificazione non è prevista.`);
      const personal = db.prepare('SELECT birth_date, birth_place, fiscal_code, residence_address, residence_city FROM employee_personal WHERE employee_id = ?').get(a.employee_id) || {};
      const company = db.prepare("SELECT value FROM settings WHERE key = 'company_name'").get()?.value || 'l\'azienda';
      const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const line = v => (v ? esc(v) : '<span class="blank"></span>');
      const period = a.start_date === a.end_date ? `il giorno ${itDate(a.start_date)}` : `dal ${itDate(a.start_date)} al ${itDate(a.end_date)}`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Autocertificazione — ${esc(a.type_name)}</title>
<style>body{font:15px/1.7 Georgia,serif;max-width:720px;margin:40px auto;padding:0 24px;color:#222}h1{font-size:20px;text-align:center;margin-bottom:4px}h2{font-size:14px;text-align:center;font-weight:400;margin-top:0}
.blank{display:inline-block;min-width:220px;border-bottom:1px solid #444}.sig{margin-top:56px;display:flex;justify-content:space-between}.sig div{width:45%;border-top:1px solid #444;padding-top:4px;font-size:13px;text-align:center}
.note{font-size:12px;color:#555;margin-top:40px}@media print{.noprint{display:none}}</style></head><body>
<p class="noprint" style="font:13px sans-serif;background:#f6f0e6;padding:10px 14px;border-radius:6px">Stampa il modulo, compilalo dove manca, firmalo e caricalo in «Giustificativi» (una foto nitida va bene). <button onclick="print()">Stampa</button></p>
<h1>Dichiarazione sostitutiva di certificazione</h1><h2>(art. 46 D.P.R. 28 dicembre 2000, n. 445)</h2>
<p>Il/La sottoscritto/a <b>${esc(fullName(a))}</b>, nato/a a ${line(personal.birth_place)} il ${line(personal.birth_date ? itDate(personal.birth_date) : '')},
codice fiscale ${line(personal.fiscal_code)}, residente a ${line(personal.residence_city)} in ${line(personal.residence_address)},
consapevole delle sanzioni penali previste dall'art. 76 del D.P.R. 445/2000 in caso di dichiarazioni mendaci,</p>
<p style="text-align:center"><b>DICHIARA</b></p>
<p>ai fini della giustificazione dell'assenza dal lavoro presso ${esc(company)} per <b>${esc(a.type_name.toLowerCase())}</b> ${period}, che
${{ matrimonio: 'in data <span class="blank"></span> ha contratto matrimonio presso il Comune di <span class="blank"></span>.', lutto: 'in data <span class="blank"></span> è deceduto/a (o è affetto/a da grave infermità) il/la proprio/a <span class="blank"></span> (grado di parentela), sig./sig.ra <span class="blank"></span>.', maternita_paternita: 'in data <span class="blank"></span> è nato/a a <span class="blank"></span> il/la figlio/a <span class="blank"></span>.' }[a.type_code] || '<span class="blank" style="min-width:100%"></span>'}</p>
<p>Dichiara inoltre di essere informato/a che i dati raccolti sono trattati esclusivamente per la gestione del rapporto di lavoro.</p>
<div class="sig"><div>Luogo e data</div><div>Firma del dichiarante</div></div>
<p class="note">La dichiarazione non richiede autenticazione della firma. L'azienda può effettuare controlli sulla veridicità (art. 71 D.P.R. 445/2000).</p></body></html>`);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Errore interno.' });
      if (!e.status) console.error(e);
    }
  });

  // Scadenzario HR: i giustificativi mancanti con la loro scadenza.
  hrFile.registerDeadlineSource(() => pendingAbsences({ sql: 'AND e.active = 1', params: [] })
    .map(a => ({ a, st: stateOf(a) })).filter(x => ['todo', 'ko'].includes(x.st.status))
    .map(({ a, st }) => ({ employee_id: a.employee_id, kind: 'giustificativo', label: `Giustificativo ${st.status === 'ko' ? 'da ricaricare' : 'da caricare'}: ${a.type_name} del ${itDate(a.start_date)}`, due_date: dueOf(a), ref: `just:${a.id}`, blocking: false })));

  // Promemoria al dipendente: due giorni prima, il giorno della scadenza e il giorno dopo (una volta ciascuno).
  function remind(at = new Date()) {
    const t = romeDate(at);
    let sent = 0;
    for (const a of pendingAbsences({ sql: 'AND e.active = 1 AND e.portal_user_id IS NOT NULL', params: [] })) {
      const st = stateOf(a);
      if (!['todo', 'ko'].includes(st.status)) continue;
      const due = dueOf(a);
      const left = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / 864e5);
      const step = left === 2 ? 'prima' : left === 0 ? 'oggi' : left === -1 ? 'scaduto' : null;
      if (!step) continue;
      const title = { prima: `Giustificativo da caricare entro il ${itDate(due)}`, oggi: 'Giustificativo: scade oggi', scaduto: `Giustificativo scaduto il ${itDate(due)}` }[step];
      if (notifications.notify({ userId: a.portal_user_id, kind: 'hr.justification.reminder', title, body: `${a.type_name} ${a.start_date === a.end_date ? `del ${itDate(a.start_date)}` : `dal ${itDate(a.start_date)} al ${itDate(a.end_date)}`}: ${a.doc_label}.`, link: LINK_SELF, dedupeKey: `just:${a.id}:${st.status}:${step}` })) sent++;
    }
    return sent;
  }
  // Assenza rifiutata o annullata: i file del giustificativo si cancellano (minimizzazione); lo stato resta.
  function purgeUnneeded() {
    const rows = db.prepare(`SELECT f.absence_id, d.id, d.storage_key FROM absence_justification_files f JOIN hr_documents d ON d.id = f.document_id
      JOIN absences a ON a.id = f.absence_id WHERE a.status IN ('rifiutata', 'annullata')`).all();
    for (const x of rows) {
      db.prepare('DELETE FROM hr_documents WHERE id = ?').run(x.id);
      try { secureStore.remove(x.storage_key); } catch {}
    }
    return rows.length;
  }
  if (scheduler) scheduler.register('hr.justification-reminders', 60, () => `${remind()} promemoria, ${purgeUnneeded()} file cancellati`);

  return { stateOf: id => stateOf(absenceRow(id)), remind, purgeUnneeded };
};
