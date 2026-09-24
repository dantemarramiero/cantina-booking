// People — Fase 2, blocco 2E: servizi.
//   - self-service: il dipendente vede il proprio fascicolo (niente disciplinare), scarica i suoi documenti,
//     chiede modifiche ai dati personali, che si applicano solo dopo l'approvazione di HR (tracciate);
//   - beni assegnati (chiavi, badge, telefono, PC, auto, abbigliamento) con consegna e restituzione;
//   - checklist di onboarding/offboarding configurabili per tipo di contratto, con verifiche automatiche;
//     l'offboarding concluso disattiva accesso al portale e operatore (evento employee.offboarded);
//   - caricamento in blocco di cedolini e CU abbinati per codice fiscale (nome del file o contenuto);
//   - stagionali: campagne lavorate e chi richiamare;
//   - recruiting (modello dati): posizioni, candidati con consenso privacy e cancellazione automatica.
const zlib = require('zlib');
const multer = require('multer');
const { HttpError, createRouter } = require('../lib/http');
const { DATE, addMonths } = require('../lib/calendar');

const ASSET_KINDS = { chiavi: 'Chiavi', badge: 'Badge', telefono: 'Telefono', pc: 'PC', tablet: 'Tablet', auto: 'Auto aziendale', abbigliamento: 'Abbigliamento', altro: 'Altro' };
// Dati che il dipendente può chiedere di cambiare dal self-service (anagrafica e codice fiscale no: servono documenti).
const SELF_FIELDS = ['iban', 'residence_address', 'residence_postal_code', 'residence_city', 'residence_province', 'domicile', 'personal_email', 'personal_phone', 'size_shirt', 'size_pants', 'size_shoes'];
const CANDIDATE_STATUSES = ['nuovo', 'in_valutazione', 'colloquio', 'offerta', 'assunto', 'scartato', 'ritirato'];
const CF = /[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z]/g;
const SEASONAL = ['stagionale', 'OTD'];
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const text = v => (v == null ? null : String(v).trim() || null);
const intOrNull = v => (v === '' || v == null ? null : parseInt(v));
const itDate = d => d.split('-').reverse().join('/');

module.exports = function registerHrServices(app, deps) {
  const { db, authAdmin, audit, events, hasAccessLevel, notifications, scheduler, getSetting, setSetting, hr, hrFile, hrSafety, hrTimesheet, secureStore } = deps;
  const r = createRouter(app, '/api/admin/hr', authAdmin);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 300 } });
  const { actor, isSelf, isManagerOf, viewerEmployee } = hrFile;

  const employee = id => {
    const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!e) throw new HttpError(404, 'Dipendente non trovato.');
    return e;
  };
  const fullName = e => `${e.first_name} ${e.last_name}`;
  const need = (req, level = 'personale', msg = null) => { if (!hasAccessLevel(req, level)) throw new HttpError(403, msg || `Serve il livello di accesso "${level}".`); };
  const checkDate = (d, label, required = false) => {
    if (d == null || d === '') { if (required) throw new HttpError(400, `Indica ${label}.`); return null; }
    if (!DATE.test(d)) throw new HttpError(400, `${label}: data nel formato AAAA-MM-GG.`);
    return d;
  };
  const userOfEmployee = id => (id ? db.prepare('SELECT portal_user_id FROM employees WHERE id = ?').get(id)?.portal_user_id ?? null : null);
  const notifyAll = (userIds, n) => { for (const u of new Set(userIds.filter(x => x !== undefined))) notifications.notify({ userId: u, ...n }); };
  const me = req => {
    const e = viewerEmployee(req);
    if (!e) throw new HttpError(404, 'Il tuo utente non è collegato a una scheda dipendente: chiedi all\'ufficio del personale.');
    return e;
  };

  // ── Beni assegnati ──────────────────────────────────────────────────────────
  const canSeeAssets = (req, e) => hasAccessLevel(req, 'personale') || isSelf(req, e) || isManagerOf(req, e);
  const assetsOf = employeeId => db.prepare('SELECT * FROM employee_assets WHERE employee_id = ? ORDER BY returned_on IS NOT NULL, delivered_on DESC').all(employeeId);
  r.get('/employees/:id/assets', req => {
    const e = employee(req.params.id);
    if (!canSeeAssets(req, e)) throw new HttpError(403, 'Non puoi vedere le dotazioni di questa persona.');
    return assetsOf(e.id);
  });
  r.post('/employees/:id/assets', req => {
    need(req, 'personale', 'Le dotazioni le registra l\'ufficio del personale.');
    const e = employee(req.params.id);
    const b = req.body || {};
    if (!ASSET_KINDS[b.kind]) throw new HttpError(400, 'Tipo di dotazione non valido.');
    const f = { description: text(b.description), serial: text(b.serial), delivered_on: checkDate(b.delivered_on, 'la data di consegna', true), notes: text(b.notes) };
    if (!f.description) throw new HttpError(400, 'Descrivi la dotazione (es. «Chiavi cantina», «iPhone 13»).');
    const id = Number(db.prepare('INSERT INTO employee_assets (employee_id, kind, description, serial, delivered_on, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.id, b.kind, f.description, f.serial, f.delivered_on, f.notes, now(), actor(req)).lastInsertRowid);
    audit(req, 'asset.delivered', { entity: 'employee', entityId: e.id, after: { asset_id: id, kind: b.kind, description: f.description } });
    return { success: true, id };
  });
  r.patch('/assets/:id', req => {
    need(req);
    const a = db.prepare('SELECT * FROM employee_assets WHERE id = ?').get(req.params.id);
    if (!a) throw new HttpError(404, 'Dotazione non trovata.');
    const returned = req.body?.returned_on === null ? null : checkDate(req.body?.returned_on, 'la data di restituzione', true);
    if (returned && returned < a.delivered_on) throw new HttpError(400, 'La restituzione è prima della consegna.');
    db.prepare('UPDATE employee_assets SET returned_on = ?, notes = COALESCE(?, notes) WHERE id = ?').run(returned, text(req.body?.notes), a.id);
    audit(req, 'asset.returned', { entity: 'employee', entityId: a.employee_id, after: { asset_id: a.id, returned_on: returned } });
    return { success: true };
  });
  r.delete('/assets/:id', req => {
    need(req);
    const a = db.prepare('SELECT * FROM employee_assets WHERE id = ?').get(req.params.id);
    if (!a) throw new HttpError(404, 'Dotazione non trovata.');
    db.prepare('DELETE FROM employee_assets WHERE id = ?').run(a.id);
    audit(req, 'asset.deleted', { entity: 'employee', entityId: a.employee_id, before: a });
    return { success: true };
  });

  // ── Self-service ────────────────────────────────────────────────────────────
  r.get('/me', req => {
    const e = me(req);
    return {
      employee: { id: e.id, name: fullName(e) }, file: hrFile.file(req, e), assets: assetsOf(e.id),
      change_requests: db.prepare('SELECT * FROM personal_change_requests WHERE employee_id = ? ORDER BY id DESC LIMIT 20').all(e.id).map(c => ({ ...c, changes: JSON.parse(c.changes) })),
      editable_fields: SELF_FIELDS,
    };
  });
  // Richiesta di modifica: si valida subito (così l'errore arriva al dipendente), si applica solo con l'approvazione di HR.
  r.post('/me/change-requests', req => {
    const e = me(req);
    const b = req.body || {};
    if (db.prepare("SELECT 1 FROM personal_change_requests WHERE employee_id = ? AND status = 'richiesta'").get(e.id)) throw new HttpError(409, 'Hai già una richiesta in attesa: ritirala o aspetta la risposta.');
    const proposed = {};
    for (const k of SELF_FIELDS) if (b[k] !== undefined) proposed[k] = b[k];
    const f = hrFile.validatePersonal(proposed);
    const current = db.prepare('SELECT * FROM employee_personal WHERE employee_id = ?').get(e.id) || {};
    const changes = Object.fromEntries(Object.entries(f).filter(([k, v]) => (current[k] ?? null) !== v));
    let contacts;
    if (Array.isArray(b.emergency_contacts)) {
      contacts = b.emergency_contacts.map(c => ({ name: text(c.name), relationship: text(c.relationship), phone: text(c.phone) })).filter(c => c.name || c.phone);
      if (contacts.some(c => !c.name || !c.phone)) throw new HttpError(400, 'Ogni contatto di emergenza ha nome e telefono.');
    }
    if (!Object.keys(changes).length && !contacts) throw new HttpError(400, 'Non hai cambiato nulla.');
    const payload = { fields: changes, ...(contacts ? { emergency_contacts: contacts } : {}) };
    const id = events.transaction(() => {
      const cid = Number(db.prepare('INSERT INTO personal_change_requests (employee_id, changes, note, requested_at, requested_user_id) VALUES (?, ?, ?, ?, ?)')
        .run(e.id, JSON.stringify(payload), text(b.note), now(), req.portalUser?.id ?? null).lastInsertRowid);
      notifyAll(hrFile.hrRecipients(), { kind: 'hr.change_request', title: `${fullName(e)} chiede di aggiornare i propri dati`, body: [...Object.keys(changes), ...(contacts ? ['contatti di emergenza'] : [])].join(', '),
        link: '/portal.html?workspace=people&sub=people-richieste', dedupeKey: `change-request:${cid}` });
      return cid;
    });
    audit(req, 'change_request.created', { entity: 'employee', entityId: e.id, after: { request_id: id, fields: Object.keys(changes), emergency_contacts: !!contacts } }); // niente valori (IBAN) nel registro
    return { success: true, id };
  });
  r.post('/me/change-requests/:id/withdraw', req => {
    const e = me(req);
    const c = db.prepare('SELECT * FROM personal_change_requests WHERE id = ?').get(req.params.id);
    if (!c || c.employee_id !== e.id) throw new HttpError(404, 'Richiesta non trovata.');
    if (c.status !== 'richiesta') throw new HttpError(409, 'La richiesta è già stata decisa.');
    db.prepare("UPDATE personal_change_requests SET status = 'ritirata', decided_at = ? WHERE id = ?").run(now(), c.id);
    return { success: true };
  });
  // Lato HR: elenco, approvazione (applica i dati con la stessa validazione della scheda), rifiuto.
  r.get('/change-requests', req => {
    need(req);
    return db.prepare(`SELECT c.*, e.first_name || ' ' || e.last_name AS employee_name FROM personal_change_requests c JOIN employees e ON e.id = c.employee_id
      WHERE (? IS NULL OR c.status = ?) ORDER BY c.status = 'richiesta' DESC, c.id DESC LIMIT 200`).all(req.query.status || null, req.query.status || null)
      .map(c => {
        const changes = JSON.parse(c.changes);
        // In attesa: i valori di oggi. Approvata: quelli di prima, salvati all'approvazione. Altrimenti niente confronto.
        if (c.status !== 'richiesta') return { ...c, changes, current: changes.previous || null };
        const current = db.prepare('SELECT * FROM employee_personal WHERE employee_id = ?').get(c.employee_id) || {};
        return { ...c, changes, current: Object.fromEntries(Object.keys(changes.fields || {}).map(k => [k, current[k] ?? null])),
          current_contacts: changes.emergency_contacts ? db.prepare('SELECT name, relationship, phone FROM emergency_contacts WHERE employee_id = ? ORDER BY sort_order, id').all(c.employee_id) : undefined };
      });
  });
  r.post('/change-requests/:id/approve', req => {
    need(req, 'personale', 'Le modifiche le approva l\'ufficio del personale.');
    const c = db.prepare('SELECT * FROM personal_change_requests WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'Richiesta non trovata.');
    if (c.status !== 'richiesta') throw new HttpError(409, 'La richiesta è già stata decisa.');
    const e = employee(c.employee_id);
    if (isSelf(req, e)) throw new HttpError(403, 'Non puoi approvare una richiesta sui tuoi dati.');
    const changes = JSON.parse(c.changes);
    const f = hrFile.validatePersonal(changes.fields || {});
    const before = db.prepare('SELECT * FROM employee_personal WHERE employee_id = ?').get(e.id) || {};
    const previous = Object.fromEntries(Object.keys(f).map(k => [k, before[k] ?? null]));
    events.transaction(() => {
      hrFile.savePersonal(e.id, f, changes.emergency_contacts);
      db.prepare("UPDATE personal_change_requests SET status = 'approvata', changes = ?, decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?")
        .run(JSON.stringify({ ...changes, previous }), now(), actor(req), text(req.body?.note), c.id);
      notifyAll([userOfEmployee(e.id)].filter(Boolean), { kind: 'hr.change_request.decided', title: 'I tuoi dati sono stati aggiornati', body: `Approvato da ${actor(req)}.`, link: '/portal.html?me=1', dedupeKey: `change-request:${c.id}:decided` });
    });
    audit(req, 'change_request.approved', { entity: 'employee', entityId: e.id, after: { request_id: c.id, fields: Object.keys(f), emergency_contacts: !!changes.emergency_contacts } });
    return { success: true };
  });
  r.post('/change-requests/:id/reject', req => {
    need(req, 'personale', 'Le richieste le decide l\'ufficio del personale.');
    const c = db.prepare('SELECT * FROM personal_change_requests WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'Richiesta non trovata.');
    if (c.status !== 'richiesta') throw new HttpError(409, 'La richiesta è già stata decisa.');
    const note = text(req.body?.note);
    if (!note) throw new HttpError(400, 'Scrivi il motivo.');
    db.prepare("UPDATE personal_change_requests SET status = 'rifiutata', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?").run(now(), actor(req), note, c.id);
    notifyAll([userOfEmployee(c.employee_id)].filter(Boolean), { kind: 'hr.change_request.decided', title: 'Richiesta di modifica dei dati non accolta', body: note, link: '/portal.html?me=1', dedupeKey: `change-request:${c.id}:decided` });
    audit(req, 'change_request.rejected', { entity: 'employee', entityId: c.employee_id, after: { request_id: c.id, note } });
    return { success: true };
  });

  // ── Checklist di onboarding e offboarding ───────────────────────────────────
  const templates = () => db.prepare('SELECT * FROM checklist_templates ORDER BY kind, name').all().map(t => ({
    ...t, contract_types: t.contract_types ? JSON.parse(t.contract_types) : [], items: db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order, id').all(t.id),
  }));
  r.get('/checklist-templates', () => templates());
  function templateFields(b, existing = null) {
    const f = { kind: b.kind ?? existing?.kind, name: b.name !== undefined ? text(b.name) : existing?.name, active: b.active !== undefined ? (b.active ? 1 : 0) : existing?.active ?? 1,
      contract_types: b.contract_types !== undefined ? (Array.isArray(b.contract_types) ? b.contract_types.filter(Boolean) : []) : existing ? (existing.contract_types ? JSON.parse(existing.contract_types) : []) : [] };
    if (!['onboarding', 'offboarding'].includes(f.kind)) throw new HttpError(400, 'Tipo: onboarding oppure offboarding.');
    if (!f.name) throw new HttpError(400, 'Dai un nome alla checklist.');
    return f;
  }
  function saveItems(templateId, items) {
    if (!Array.isArray(items)) return;
    db.prepare('DELETE FROM checklist_template_items WHERE template_id = ?').run(templateId);
    const ins = db.prepare('INSERT INTO checklist_template_items (template_id, title, item_type, ref, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    items.forEach((it, i) => {
      if (!text(it.title)) throw new HttpError(400, 'Ogni voce della checklist ha un titolo.');
      ins.run(templateId, text(it.title), text(it.item_type) || 'altro', text(it.ref), it.required === false || it.required === 0 ? 0 : 1, i + 1);
    });
  }
  r.post('/checklist-templates', req => {
    need(req);
    const f = templateFields(req.body || {});
    const id = events.transaction(() => {
      const tid = Number(db.prepare('INSERT INTO checklist_templates (kind, name, contract_types, active) VALUES (?, ?, ?, ?)').run(f.kind, f.name, f.contract_types.length ? JSON.stringify(f.contract_types) : null, f.active).lastInsertRowid);
      saveItems(tid, req.body?.items || []);
      return tid;
    });
    audit(req, 'checklist_template.created', { entity: 'checklist_template', entityId: id, after: f });
    return { success: true, id };
  });
  r.patch('/checklist-templates/:id', req => {
    need(req);
    const t = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(req.params.id);
    if (!t) throw new HttpError(404, 'Checklist non trovata.');
    const f = templateFields(req.body || {}, t);
    events.transaction(() => {
      db.prepare('UPDATE checklist_templates SET name = ?, contract_types = ?, active = ? WHERE id = ?').run(f.name, f.contract_types.length ? JSON.stringify(f.contract_types) : null, f.active, t.id);
      saveItems(t.id, req.body?.items);
    });
    audit(req, 'checklist_template.updated', { entity: 'checklist_template', entityId: t.id, after: f });
    return { success: true };
  });

  // Verifica automatica di una voce: dice se risulta fatta dai dati (l'utente la spunta comunque).
  function autoCheck(e, it, kind) {
    const has = sql => !!db.prepare(sql).get(e.id);
    switch (it.item_type) {
      case 'dati': { const p = db.prepare('SELECT * FROM employee_personal WHERE employee_id = ?').get(e.id); return !!(p?.fiscal_code && p?.iban && p?.residence_address); }
      case 'documento':
        if (it.ref === 'documento_identita') return has('SELECT 1 FROM identity_documents WHERE employee_id = ?') || !!db.prepare("SELECT 1 FROM hr_documents WHERE employee_id = ? AND type_code = 'documento_identita'").get(e.id);
        return !!it.ref && !!db.prepare('SELECT 1 FROM hr_documents WHERE employee_id = ? AND type_code = ?').get(e.id, it.ref);
      case 'formazione': {
        const t = it.ref && db.prepare('SELECT id FROM training_types WHERE code = ?').get(it.ref);
        return !!t && !!db.prepare('SELECT 1 FROM trainings WHERE employee_id = ? AND training_type_id = ? AND (expires_on IS NULL OR expires_on >= ?)').get(e.id, t.id, today());
      }
      case 'visita': {
        const role = hrSafety.roleAt(e.id);
        return role && !role.medical_surveillance ? 'non_necessaria' : has('SELECT 1 FROM medical_visits WHERE employee_id = ?');
      }
      case 'dpi': return has('SELECT 1 FROM ppe_deliveries WHERE employee_id = ?');
      case 'bene': return has('SELECT 1 FROM employee_assets WHERE employee_id = ?');
      case 'accesso': {
        const u = e.portal_user_id && db.prepare('SELECT active FROM portal_users WHERE id = ?').get(e.portal_user_id);
        return kind === 'onboarding' ? !!u : !u || !u.active;
      }
      case 'restituzione': return !has('SELECT 1 FROM employee_assets WHERE employee_id = ? AND returned_on IS NULL');
      case 'cessazione': return !!db.prepare('SELECT termination_date FROM employment_contracts WHERE employee_id = ? ORDER BY version DESC LIMIT 1').get(e.id)?.termination_date;
      case 'presenze': {
        const end = db.prepare('SELECT termination_date FROM employment_contracts WHERE employee_id = ? ORDER BY version DESC LIMIT 1').get(e.id)?.termination_date || today();
        return hrTimesheet.monthStatus(e.id, end.slice(0, 7)) === 'approvato';
      }
      default: return null;
    }
  }
  function checklistsOf(e) {
    return db.prepare('SELECT * FROM employee_checklists WHERE employee_id = ? ORDER BY completed_at IS NOT NULL, started_at DESC').all(e.id).map(c => ({
      ...c, items: db.prepare('SELECT * FROM employee_checklist_items WHERE checklist_id = ? ORDER BY sort_order, id').all(c.id).map(it => ({ ...it, auto: c.completed_at ? null : autoCheck(e, it, c.kind) })),
    }));
  }
  const canSeeChecklists = (req, e) => hasAccessLevel(req, 'personale') || isManagerOf(req, e);
  r.get('/employees/:id/checklists', req => {
    const e = employee(req.params.id);
    if (!canSeeChecklists(req, e)) throw new HttpError(403, 'Non puoi vedere le checklist di questa persona.');
    return checklistsOf(e);
  });
  // Avvio: la checklist del tipo di contratto in vigore (se c'è una specifica), altrimenti quella generale.
  r.post('/employees/:id/checklists', req => {
    need(req, 'personale', 'Onboarding e offboarding li avvia l\'ufficio del personale.');
    const e = employee(req.params.id);
    const b = req.body || {};
    if (!['onboarding', 'offboarding'].includes(b.kind)) throw new HttpError(400, 'Tipo: onboarding oppure offboarding.');
    if (db.prepare('SELECT 1 FROM employee_checklists WHERE employee_id = ? AND kind = ? AND completed_at IS NULL').get(e.id, b.kind)) throw new HttpError(409, `C'è già un ${b.kind} in corso per ${fullName(e)}.`);
    const contractType = hrFile.contractAt(e.id)?.contract_type || null;
    const all = templates().filter(t => t.kind === b.kind && t.active);
    const t = b.template_id ? all.find(x => x.id === Number(b.template_id))
      : all.find(x => contractType && x.contract_types.includes(contractType)) || all.find(x => !x.contract_types.length);
    if (!t) throw new HttpError(400, `Nessuna checklist di ${b.kind} attiva${contractType ? ` per il contratto ${contractType}` : ''}: creala in Configurazione.`);
    const id = events.transaction(() => {
      const cid = Number(db.prepare('INSERT INTO employee_checklists (employee_id, template_id, kind, name, due_date, started_at, started_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(e.id, t.id, b.kind, t.name, checkDate(b.due_date, 'Scadenza'), now(), actor(req)).lastInsertRowid);
      const ins = db.prepare('INSERT INTO employee_checklist_items (checklist_id, title, item_type, ref, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
      for (const it of t.items) ins.run(cid, it.title, it.item_type, it.ref, it.required, it.sort_order);
      return cid;
    });
    audit(req, `${b.kind}.started`, { entity: 'employee', entityId: e.id, after: { checklist_id: id, template: t.name } });
    return { success: true, id };
  });
  r.post('/checklist-items/:id', req => {
    need(req);
    const it = db.prepare('SELECT i.*, c.completed_at, c.employee_id FROM employee_checklist_items i JOIN employee_checklists c ON c.id = i.checklist_id WHERE i.id = ?').get(req.params.id);
    if (!it) throw new HttpError(404, 'Voce non trovata.');
    if (it.completed_at) throw new HttpError(409, 'La checklist è già conclusa.');
    const done = !!req.body?.done;
    db.prepare('UPDATE employee_checklist_items SET done_at = ?, done_by = ?, note = COALESCE(?, note) WHERE id = ?').run(done ? now() : null, done ? actor(req) : null, text(req.body?.note), it.id);
    return { success: true };
  });
  // Conclusione: tutte le voci obbligatorie fatte. L'offboarding concluso disattiva il dipendente e,
  // con l'evento employee.offboarded, accesso al portale e operatore dell'Enoturismo (non li cancella).
  r.post('/checklists/:id/complete', req => {
    need(req);
    const c = db.prepare('SELECT * FROM employee_checklists WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'Checklist non trovata.');
    if (c.completed_at) throw new HttpError(409, 'Già conclusa.');
    const open = db.prepare('SELECT title FROM employee_checklist_items WHERE checklist_id = ? AND required = 1 AND done_at IS NULL ORDER BY sort_order').all(c.id);
    if (open.length) throw new HttpError(409, `Mancano ancora: ${open.map(x => x.title).join('; ')}.`);
    const e = employee(c.employee_id);
    events.transaction(() => {
      db.prepare('UPDATE employee_checklists SET completed_at = ?, completed_by = ? WHERE id = ?').run(now(), actor(req), c.id);
      if (c.kind === 'offboarding') {
        db.prepare('UPDATE employees SET active = 0, updated_at = ? WHERE id = ?').run(now(), e.id);
        events.emit('employee.offboarded', { sourceTable: 'employee_checklists', sourceId: c.id, payload: { employee_id: e.id, portal_user_id: e.portal_user_id } });
      }
    });
    events.dispatch();
    audit(req, `${c.kind}.completed`, { entity: 'employee', entityId: e.id, after: { checklist_id: c.id } });
    return { success: true };
  });

  // ── Caricamento in blocco di cedolini e CU ──────────────────────────────────
  // Il codice fiscale si cerca nel nome del file e, se non c'è, nel testo del PDF (anche nei flussi
  // compressi). Un file si abbina solo se trova un unico codice fiscale di un dipendente.
  function textsOf(buffer) {
    const raw = buffer.toString('latin1');
    const out = [raw];
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(raw))) {
      const end = raw.indexOf('endstream', m.index);
      if (end < 0) break;
      const chunk = buffer.subarray(m.index + m[0].length, end);
      try { out.push(zlib.inflateSync(chunk).toString('latin1')); } catch { /* flusso non compresso o non leggibile */ }
      re.lastIndex = end;
    }
    return out;
  }
  const employeeByCf = cf => db.prepare('SELECT e.* FROM employee_personal p JOIN employees e ON e.id = p.employee_id WHERE p.fiscal_code = ?').get(cf) || null;
  function matchFile(file) {
    const fromName = [...new Set((file.originalname.toUpperCase().match(CF) || []))];
    if (fromName.length === 1) {
      const e = employeeByCf(fromName[0]);
      return e ? { e, by: 'nome del file' } : { reason: `Il codice fiscale ${fromName[0]} del nome del file non è di nessun dipendente.` };
    }
    const found = [...new Set(textsOf(file.buffer).flatMap(t => t.toUpperCase().match(CF) || []))].filter(employeeByCf);
    if (found.length === 1) return { e: employeeByCf(found[0]), by: 'contenuto' };
    if (found.length > 1) return { reason: 'Nel file ci sono i codici fiscali di più dipendenti: caricalo a mano.' };
    return { reason: 'Nessun codice fiscale di un dipendente nel nome o nel testo del file.' };
  }
  r.post('/documents/bulk', upload.array('files', 300), req => {
    const b = req.body || {};
    const type = db.prepare('SELECT * FROM hr_document_types WHERE code = ?').get(b.type_code);
    if (!type) throw new HttpError(400, 'Tipo di documento non valido.');
    need(req, 'personale', 'I documenti li carica l\'ufficio del personale.');
    need(req, type.level, `Per caricare «${type.name}» serve il livello "${type.level}".`);
    if (!req.files?.length) throw new HttpError(400, 'Scegli i file da caricare.');
    const title = text(b.title) || type.name;
    const docDate = checkDate(b.doc_date, 'Data del documento');
    const stored = [], unmatched = [];
    for (const file of req.files) {
      const m = matchFile(file);
      if (!m.e) { unmatched.push({ file: file.originalname, reason: m.reason }); continue; }
      const sha = require('crypto').createHash('sha256').update(file.buffer).digest('hex');
      if (db.prepare('SELECT 1 FROM hr_documents WHERE employee_id = ? AND type_code = ? AND sha256 = ?').get(m.e.id, type.code, sha)) {
        unmatched.push({ file: file.originalname, reason: `Già caricato per ${fullName(m.e)}.` });
        continue;
      }
      const id = hrFile.storeDocument(req, { employeeId: m.e.id, type: type.code, file, title, docDate });
      stored.push({ file: file.originalname, document_id: id, employee_id: m.e.id, employee_name: fullName(m.e), matched_by: m.by });
      if (type.employee_visible) notifyAll([userOfEmployee(m.e.id)].filter(Boolean), { kind: 'hr.document.new', title: `Nuovo documento: ${title}`, body: 'Lo trovi nel tuo spazio.', link: '/portal.html?me=1', dedupeKey: `doc:${id}` });
    }
    audit(req, 'hr_documents.bulk_upload', { entity: 'hr_documents', after: { type: type.code, stored: stored.length, unmatched: unmatched.length } });
    return { stored, unmatched };
  });

  // ── Stagionali: campagne lavorate e chi richiamare ──────────────────────────
  r.get('/seasonal', req => {
    need(req);
    const rows = db.prepare(`SELECT e.id, e.first_name, e.last_name, e.active FROM employees e
      WHERE EXISTS (SELECT 1 FROM employment_contracts c WHERE c.employee_id = e.id AND c.contract_type IN ('${SEASONAL.join("','")}')) ORDER BY e.last_name, e.first_name`).all();
    return rows.map(e => {
      const versions = db.prepare(`SELECT c.*, j.name AS job_role FROM employment_contracts c LEFT JOIN job_roles j ON j.id = c.job_role_id WHERE c.employee_id = ? ORDER BY c.version`).all(e.id);
      // Una campagna = un periodo di assunzione (stessa data di assunzione), con la mansione e la fine.
      const campaigns = [];
      for (const v of versions.filter(x => SEASONAL.includes(x.contract_type))) {
        const key = v.hire_date || v.effective_from;
        const cur = campaigns.find(c => c.from === key);
        const to = v.termination_date || v.end_date;
        if (cur) Object.assign(cur, { to: to || cur.to, job_role: v.job_role || cur.job_role });
        else campaigns.push({ year: Number(key.slice(0, 4)), from: key, to, job_role: v.job_role });
      }
      const last = versions[versions.length - 1];
      return { employee_id: e.id, name: `${e.first_name} ${e.last_name}`, active: !!e.active, campaigns, rehire_ok: last?.rehire_ok ?? null, last_role: last ? versions.filter(v => v.job_role).at(-1)?.job_role ?? null : null };
    });
  });

  // ── Recruiting (modello dati) ───────────────────────────────────────────────
  const candidateRetentionMonths = () => { const m = parseInt(getSetting('hr_candidate_retention_months', '12')); return m > 0 ? m : 12; };
  r.get('/positions', req => { need(req); return db.prepare('SELECT * FROM job_positions ORDER BY status, opened_on DESC').all(); });
  r.post('/positions', req => {
    need(req);
    const b = req.body || {};
    if (!text(b.title)) throw new HttpError(400, 'Indica la posizione.');
    const id = Number(db.prepare('INSERT INTO job_positions (title, job_role_id, site_id, opened_on, notes) VALUES (?, ?, ?, ?, ?)')
      .run(text(b.title), intOrNull(b.job_role_id), intOrNull(b.site_id), checkDate(b.opened_on, 'Apertura') || today(), text(b.notes)).lastInsertRowid);
    audit(req, 'position.created', { entity: 'job_position', entityId: id, after: { title: text(b.title) } });
    return { success: true, id };
  });
  r.patch('/positions/:id', req => {
    need(req);
    const p = db.prepare('SELECT * FROM job_positions WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'Posizione non trovata.');
    const status = req.body?.status ?? p.status;
    if (!['aperta', 'chiusa'].includes(status)) throw new HttpError(400, 'Stato: aperta o chiusa.');
    db.prepare('UPDATE job_positions SET title = ?, status = ?, closed_on = ?, notes = ? WHERE id = ?')
      .run(text(req.body?.title) || p.title, status, status === 'chiusa' ? p.closed_on || today() : null, req.body?.notes !== undefined ? text(req.body.notes) : p.notes, p.id);
    return { success: true };
  });
  r.get('/candidates', req => {
    need(req);
    return db.prepare(`SELECT c.*, p.title AS position_title FROM candidates c LEFT JOIN job_positions p ON p.id = c.position_id ORDER BY c.created_at DESC`).all();
  });
  r.post('/candidates', upload.single('cv'), req => {
    need(req);
    const b = req.body || {};
    const f = { first_name: text(b.first_name), last_name: text(b.last_name), email: text(b.email)?.toLowerCase() || null, phone: text(b.phone), fiscal_code: text(b.fiscal_code)?.toUpperCase() || null,
      position_id: intOrNull(b.position_id), source: text(b.source), notes: text(b.notes), consent: checkDate(b.privacy_consent_at, 'la data del consenso privacy', true) };
    if (!f.first_name || !f.last_name) throw new HttpError(400, 'Nome e cognome sono obbligatori.');
    if (f.consent > today()) throw new HttpError(400, 'Il consenso non può essere nel futuro.');
    const deleteAfter = checkDate(b.delete_after, 'Cancellazione') || addMonths(f.consent, candidateRetentionMonths());
    const id = events.transaction(() => {
      const cid = Number(db.prepare(`INSERT INTO candidates (position_id, first_name, last_name, email, phone, fiscal_code, source, privacy_consent_at, delete_after, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.position_id, f.first_name, f.last_name, f.email, f.phone, f.fiscal_code, f.source, f.consent, deleteAfter, f.notes, now(), now()).lastInsertRowid);
      if (req.file) {
        const docId = hrFile.storeDocument(req, { employeeId: null, type: 'cv', file: req.file, title: `CV ${f.first_name} ${f.last_name}`, docDate: today() });
        db.prepare('INSERT INTO candidate_documents (candidate_id, document_id) VALUES (?, ?)').run(cid, docId);
      }
      return cid;
    });
    audit(req, 'candidate.created', { entity: 'candidate', entityId: id, after: { position_id: f.position_id } }); // niente dati personali nel registro
    return { success: true, id, delete_after: deleteAfter };
  });
  r.patch('/candidates/:id', req => {
    need(req);
    const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'Candidato non trovato.');
    const status = req.body?.status ?? c.status;
    if (!CANDIDATE_STATUSES.includes(status) || status === 'assunto') throw new HttpError(400, 'Stato non valido (per assumere usa «Converti in dipendente»).');
    db.prepare('UPDATE candidates SET status = ?, notes = ?, position_id = ?, updated_at = ? WHERE id = ?')
      .run(status, req.body?.notes !== undefined ? text(req.body.notes) : c.notes, req.body?.position_id !== undefined ? intOrNull(req.body.position_id) : c.position_id, now(), c.id);
    audit(req, 'candidate.updated', { entity: 'candidate', entityId: c.id, after: { status } });
    return { success: true };
  });
  // Conversione in dipendente senza reinserire i dati: nome, contatti, codice fiscale e CV passano al fascicolo.
  r.post('/candidates/:id/convert', req => {
    need(req);
    const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'Candidato non trovato.');
    if (c.employee_id) throw new HttpError(409, 'Candidato già assunto.');
    const b = req.body || {};
    const position = c.position_id ? db.prepare('SELECT * FROM job_positions WHERE id = ?').get(c.position_id) : null;
    const personal = hrFile.validatePersonal({ fiscal_code: c.fiscal_code, personal_email: c.email, personal_phone: c.phone });
    const id = events.transaction(() => {
      const eid = Number(db.prepare(`INSERT INTO employees (first_name, last_name, job_title, site_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`)
        .run(c.first_name, c.last_name, text(b.job_title) || position?.title || null, intOrNull(b.site_id) ?? position?.site_id ?? null, now(), now()).lastInsertRowid);
      hrFile.savePersonal(eid, personal);
      db.prepare('UPDATE hr_documents SET employee_id = ? WHERE id IN (SELECT document_id FROM candidate_documents WHERE candidate_id = ?)').run(eid, c.id);
      db.prepare("UPDATE candidates SET status = 'assunto', employee_id = ?, updated_at = ? WHERE id = ?").run(eid, now(), c.id);
      return eid;
    });
    audit(req, 'candidate.converted', { entity: 'employee', entityId: id, after: { candidate_id: c.id } });
    return { success: true, employee_id: id };
  });
  // Job: candidati non assunti oltre la data di cancellazione → si cancellano, CV compreso.
  function purgeCandidates(date = today()) {
    const due = db.prepare('SELECT * FROM candidates WHERE employee_id IS NULL AND delete_after < ?').all(date);
    for (const c of due) {
      const docs = db.prepare('SELECT d.id, d.storage_key FROM candidate_documents cd JOIN hr_documents d ON d.id = cd.document_id WHERE cd.candidate_id = ?').all(c.id);
      events.transaction(() => {
        for (const d of docs) db.prepare('DELETE FROM hr_documents WHERE id = ?').run(d.id);
        db.prepare('DELETE FROM candidates WHERE id = ?').run(c.id);
        audit(null, 'candidate.purged', { entity: 'candidate', entityId: c.id, actor: 'Sistema', after: { delete_after: c.delete_after, documents: docs.length } });
      });
      for (const d of docs) secureStore.remove(d.storage_key);
    }
    return due.length;
  }
  scheduler.register('hr.candidates-retention', 24 * 60, () => `${purgeCandidates()} candidati cancellati`);

  // Un dipendente con dotazioni o checklist non si elimina.
  hr.registerDeleteGuard(id => (db.prepare('SELECT (SELECT COUNT(*) FROM employee_assets WHERE employee_id = ?) + (SELECT COUNT(*) FROM employee_checklists WHERE employee_id = ?) + (SELECT COUNT(*) FROM personal_change_requests WHERE employee_id = ?) AS c').get(id, id, id).c
    ? 'dotazioni, checklist o richieste registrate' : null));

  return { matchFile, purgeCandidates, autoCheck, checklistsOf, ASSET_KINDS };
};
