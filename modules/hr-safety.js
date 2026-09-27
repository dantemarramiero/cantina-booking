// People — Fase 2, blocco 2B: sicurezza sul lavoro (D.Lgs. 81/08).
//   - formazione e abilitazioni (registro, periodicità per tipo), requisiti per mansione e per operazione;
//   - sorveglianza sanitaria: solo giudizio e limitazioni (livello "sanitario", ogni lettura registrata);
//   - DPI consegnati, infortuni e quasi-infortuni, deroghe motivate del responsabile sicurezza;
//   - controllo di assegnabilità (usato da presenze e squadre): blocchi e avvisi con messaggio chiaro;
//   - scadenze nello scadenzario HR; attività "visita per cambio mansione" dall'evento employee.role_changed.
// Livelli: formazione, DPI e infortuni = "personale"; idoneità = "sanitario". Il dipendente vede i propri
// dati, il suo responsabile vede scadenze di sicurezza e idoneità/limitazioni dei collaboratori.
const multer = require('multer');
const { HttpError, createRouter } = require('../lib/http');
const { DATE, addDays, addMonths } = require('../lib/calendar');

const CATEGORIES = ['sicurezza', 'abilitazione', 'alimentare'];
const VISIT_TYPES = { preassuntiva: 'Preassuntiva', preventiva: 'Preventiva', periodica: 'Periodica', cambio_mansione: 'Cambio mansione', rientro: 'Rientro dopo assenza per salute', su_richiesta: 'Su richiesta del lavoratore' };
const JUDGMENTS = { idoneo: 'Idoneo', idoneo_prescrizioni: 'Idoneo con prescrizioni o limitazioni', non_idoneo_temporaneo: 'Non idoneo temporaneo', non_idoneo: 'Non idoneo' };
const TASK_BY_VISIT = { cambio_mansione: 'visita_cambio_mansione', rientro: 'visita_rientro' };
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const text = v => (v == null ? null : String(v).trim() || null);
const intOrNull = v => (v === '' || v == null ? null : parseInt(v));
const itDate = d => d.split('-').reverse().join('/');
const ids = v => {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = v.split(','); } }
  return [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Number.isInteger))];
};

module.exports = function registerHrSafety(app, deps) {
  const { db, authAdmin, audit, events, hasAccessLevel, notifications, getSetting, setSetting, hr, hrFile } = deps;
  const r = createRouter(app, '/api/admin/hr', authAdmin, [
    [/training_types.code/, 'Codice già usato da un altro tipo di formazione.'],
    [/ppe_types.code/, 'Codice già usato da un altro DPI.'],
  ]);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
  const { actor, isSelf, isManagerOf, viewerEmployee, logSensitive, contractAt } = hrFile;

  const employee = id => {
    const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!e) throw new HttpError(404, 'Dipendente non trovato.');
    return e;
  };
  const fullName = e => `${e.first_name} ${e.last_name}`;
  const need = (req, level, msg) => { if (!hasAccessLevel(req, level)) throw new HttpError(403, msg || `Serve il livello di accesso "${level}".`); };
  const checkDate = (d, label, required = false) => {
    if (d == null || d === '') { if (required) throw new HttpError(400, `Indica ${label}.`); return null; }
    if (!DATE.test(d)) throw new HttpError(400, `${label}: data nel formato AAAA-MM-GG.`);
    return d;
  };
  const trainingType = id => {
    const t = db.prepare('SELECT * FROM training_types WHERE id = ?').get(id);
    if (!t) throw new HttpError(400, 'Tipo di formazione non trovato.');
    return t;
  };
  const operation = id => {
    const o = db.prepare('SELECT * FROM cost_objects WHERE id = ?').get(id);
    if (!o) throw new HttpError(400, 'Operazione non trovata.');
    return o;
  };

  // Chi vede cosa (oltre ai livelli): il dipendente per sé, il responsabile per i collaboratori.
  const canSeeSafety = (req, e) => hasAccessLevel(req, 'personale') || isSelf(req, e) || isManagerOf(req, e);
  const canSeeFitness = (req, e) => hasAccessLevel(req, 'sanitario') || isSelf(req, e) || isManagerOf(req, e);
  // Il caposquadra assegna le persone della sua squadra: può chiedere se sono assegnabili.
  const isTeamLeaderOf = (req, e) => {
    const me = viewerEmployee(req);
    return !!me && !!db.prepare('SELECT 1 FROM teams t JOIN team_members m ON m.team_id = t.id WHERE t.leader_employee_id = ? AND m.employee_id = ? AND t.active = 1').get(me.id, e.id);
  };

  // ── Impostazioni: responsabili della sicurezza e medico competente ──────────
  function safetySettings() {
    let officers = [];
    try { officers = JSON.parse(getSetting('hr_safety_officers', '[]')); } catch {}
    return { safety_officer_ids: Array.isArray(officers) ? officers : [], doctor: getSetting('hr_medical_doctor', '') || '' };
  }
  // Responsabile sicurezza (RSPP o delegato): registra le deroghe. La chiave master può sempre.
  const isSafetyOfficer = req => req.isMasterKey || (() => { const me = viewerEmployee(req); return !!me && safetySettings().safety_officer_ids.includes(me.id); })();
  r.get('/safety/settings', () => safetySettings());
  r.put('/safety/settings', req => {
    need(req, 'personale');
    const b = req.body || {};
    if (b.safety_officer_ids !== undefined) {
      const list = ids(b.safety_officer_ids);
      for (const id of list) employee(id);
      setSetting('hr_safety_officers', JSON.stringify(list));
    }
    if (b.doctor !== undefined) setSetting('hr_medical_doctor', text(b.doctor) || '');
    audit(req, 'hr_safety_settings.updated', { entity: 'hr_settings', after: safetySettings() });
    return safetySettings();
  });

  // ── Tipi di formazione (periodicità configurabili) ──────────────────────────
  function trainingTypeFields(b, existing = null) {
    const pick = (k, conv) => (b[k] !== undefined ? conv(b[k]) : existing?.[k] ?? null);
    const hoursToMin = v => (v === '' || v == null ? null : Math.round(Number(String(v).replace(',', '.')) * 60));
    const f = {
      name: pick('name', text), category: pick('category', v => v),
      initial_minutes: b.initial_hours !== undefined ? hoursToMin(b.initial_hours) : existing?.initial_minutes ?? null,
      validity_months: pick('validity_months', intOrNull),
      update_minutes: b.update_hours !== undefined ? hoursToMin(b.update_hours) : existing?.update_minutes ?? null,
      legal_ref: pick('legal_ref', text), active: b.active !== undefined ? (b.active ? 1 : 0) : existing?.active ?? 1,
    };
    if (!f.name) throw new HttpError(400, 'Il nome è obbligatorio.');
    if (!CATEGORIES.includes(f.category)) throw new HttpError(400, 'Categoria: sicurezza, abilitazione o alimentare.');
    if (f.validity_months != null && !(f.validity_months > 0 && f.validity_months <= 240)) throw new HttpError(400, 'Validità: mesi tra 1 e 240, oppure vuota se non scade.');
    for (const k of ['initial_minutes', 'update_minutes']) if (f[k] != null && !(f[k] >= 0)) throw new HttpError(400, 'Ore non valide.');
    return f;
  }
  r.get('/training-types', () => db.prepare('SELECT * FROM training_types ORDER BY category, name').all());
  r.post('/training-types', req => {
    need(req, 'personale');
    const b = req.body || {};
    const code = text(b.code)?.toLowerCase();
    if (!code || !/^[a-z0-9_]+$/.test(code)) throw new HttpError(400, 'Codice: lettere minuscole, numeri e trattini bassi.');
    const f = trainingTypeFields(b);
    const id = Number(db.prepare('INSERT INTO training_types (code, name, category, initial_minutes, validity_months, update_minutes, legal_ref, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(code, f.name, f.category, f.initial_minutes, f.validity_months, f.update_minutes, f.legal_ref, f.active).lastInsertRowid);
    audit(req, 'training_type.created', { entity: 'training_type', entityId: id, after: { code, ...f } });
    return { success: true, id };
  });
  r.patch('/training-types/:id', req => {
    need(req, 'personale');
    const t = trainingType(req.params.id);
    const f = trainingTypeFields(req.body || {}, t);
    db.prepare('UPDATE training_types SET name = ?, category = ?, initial_minutes = ?, validity_months = ?, update_minutes = ?, legal_ref = ?, active = ? WHERE id = ?')
      .run(f.name, f.category, f.initial_minutes, f.validity_months, f.update_minutes, f.legal_ref, f.active, t.id);
    audit(req, 'training_type.updated', { entity: 'training_type', entityId: t.id, before: t, after: f });
    return { success: true };
  });

  // ── Requisiti: mansione → formazioni; operazione → abilitazioni ─────────────
  r.get('/safety/config', () => ({
    training_types: db.prepare('SELECT * FROM training_types ORDER BY category, name').all(),
    ppe_types: db.prepare('SELECT * FROM ppe_types ORDER BY name').all(),
    job_roles: db.prepare('SELECT * FROM job_roles ORDER BY name').all().map(j => ({
      ...j, training_type_ids: db.prepare('SELECT training_type_id FROM job_role_trainings WHERE job_role_id = ?').all(j.id).map(x => x.training_type_id),
    })),
    operations: db.prepare("SELECT id, code, name, status FROM cost_objects WHERE type = 'operazione' ORDER BY code").all().map(o => ({
      ...o, training_type_ids: db.prepare('SELECT training_type_id FROM operation_trainings WHERE cost_object_id = ?').all(o.id).map(x => x.training_type_id),
    })),
    settings: safetySettings(),
  }));
  r.put('/job-roles/:id/safety', req => {
    need(req, 'personale');
    const jr = db.prepare('SELECT * FROM job_roles WHERE id = ?').get(req.params.id);
    if (!jr) throw new HttpError(404, 'Mansione non trovata.');
    const b = req.body || {};
    const list = ids(b.training_type_ids);
    list.forEach(trainingType);
    events.transaction(() => {
      db.prepare('DELETE FROM job_role_trainings WHERE job_role_id = ?').run(jr.id);
      const ins = db.prepare('INSERT INTO job_role_trainings (job_role_id, training_type_id) VALUES (?, ?)');
      for (const t of list) ins.run(jr.id, t);
      if (b.medical_surveillance !== undefined) db.prepare('UPDATE job_roles SET medical_surveillance = ? WHERE id = ?').run(b.medical_surveillance ? 1 : 0, jr.id);
    });
    audit(req, 'job_role.safety_updated', { entity: 'job_role', entityId: jr.id, after: { training_type_ids: list, medical_surveillance: b.medical_surveillance } });
    return { success: true };
  });
  r.put('/operations/:id/trainings', req => {
    need(req, 'personale');
    const o = operation(req.params.id);
    if (o.type !== 'operazione') throw new HttpError(400, 'Le abilitazioni si richiedono sugli oggetti di costo di tipo "operazione".');
    const list = ids(req.body?.training_type_ids);
    list.forEach(trainingType);
    events.transaction(() => {
      db.prepare('DELETE FROM operation_trainings WHERE cost_object_id = ?').run(o.id);
      const ins = db.prepare('INSERT INTO operation_trainings (cost_object_id, training_type_id) VALUES (?, ?)');
      for (const t of list) ins.run(o.id, t);
    });
    audit(req, 'operation.trainings_updated', { entity: 'cost_object', entityId: o.id, after: { training_type_ids: list } });
    return { success: true };
  });

  // ── Stato della formazione di un dipendente ─────────────────────────────────
  // Ultimo corso di un tipo concluso entro la data. Vale fino a expires_on (vuota = non scade).
  const latestTraining = (employeeId, typeId, date = today()) => db.prepare(`SELECT * FROM trainings WHERE employee_id = ? AND training_type_id = ? AND completed_on <= ?
    ORDER BY completed_on DESC, id DESC LIMIT 1`).get(employeeId, typeId, date) || null;
  const validAt = (rec, date) => !!rec && (!rec.expires_on || rec.expires_on >= date);
  // Mansione in vigore a una data e da quando la persona la svolge senza interruzioni.
  function roleAt(employeeId, date = today()) {
    const c = contractAt(employeeId, date);
    if (!c?.job_role_id) return null;
    const versions = db.prepare('SELECT * FROM employment_contracts WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, version DESC').all(employeeId, date);
    let since = c.effective_from;
    for (const v of versions) { if (v.job_role_id !== c.job_role_id) break; since = v.effective_from; }
    return { ...db.prepare('SELECT * FROM job_roles WHERE id = ?').get(c.job_role_id), since };
  }
  // Per ogni formazione richiesta dalla mansione: valida, in scadenza, scaduta o mancante.
  function requirementStatus(employeeId, date = today()) {
    const role = roleAt(employeeId, date);
    if (!role) return { role: null, items: [] };
    const soon = addDays(date, Math.max(...hrFile.settings().deadline_thresholds));
    const items = db.prepare('SELECT t.* FROM job_role_trainings r JOIN training_types t ON t.id = r.training_type_id WHERE r.job_role_id = ? AND t.active = 1 ORDER BY t.category, t.name')
      .all(role.id).map(t => {
        const rec = latestTraining(employeeId, t.id, date);
        const state = !rec ? 'mancante' : !validAt(rec, date) ? 'scaduta' : rec.expires_on && rec.expires_on <= soon ? 'in_scadenza' : 'valida';
        return { training_type_id: t.id, code: t.code, name: t.name, category: t.category, state, completed_on: rec?.completed_on ?? null, expires_on: rec?.expires_on ?? null };
      });
    return { role: { id: role.id, name: role.name, since: role.since, allows_waiver: !!role.allows_waiver, medical_surveillance: !!role.medical_surveillance }, items };
  }

  // ── Idoneità ────────────────────────────────────────────────────────────────
  const latestVisit = (employeeId, date = today()) => db.prepare('SELECT * FROM medical_visits WHERE employee_id = ? AND visit_date <= ? ORDER BY visit_date DESC, id DESC LIMIT 1').get(employeeId, date) || null;
  function fitnessState(v, date = today()) {
    if (!v) return null;
    if (v.judgment === 'non_idoneo') return 'non_idoneo';
    if (v.judgment === 'non_idoneo_temporaneo') return !v.unfit_until || v.unfit_until >= date ? 'non_idoneo_temporaneo' : 'da_rivalutare';
    return v.judgment === 'idoneo_prescrizioni' ? 'prescrizioni' : 'idoneo';
  }
  const restrictionsOf = visitId => db.prepare(`SELECT mr.*, j.name AS job_role_name, co.code AS cost_object_code, co.name AS cost_object_name FROM medical_restrictions mr
    LEFT JOIN job_roles j ON j.id = mr.job_role_id LEFT JOIN cost_objects co ON co.id = mr.cost_object_id WHERE mr.visit_id = ?`).all(visitId);

  // ── Controllo di assegnabilità ──────────────────────────────────────────────
  // Può questa persona lavorare, a questa data, su questa operazione (oggetto di costo) o mansione?
  //   blocchi: permesso/contratto scaduti, giudizio "non idoneo", abilitazione richiesta mancante o scaduta;
  //   avvisi: limitazioni del giudizio incompatibili con l'operazione o la mansione, deroghe in uso.
  // Se il giudizio sanitario contribuisce alla risposta, la lettura è registrata (req facoltativo).
  function activeWaiver(employeeId, typeId, costObjectId, date) {
    return db.prepare(`SELECT * FROM safety_waivers WHERE employee_id = ? AND training_type_id = ? AND revoked_at IS NULL AND valid_from <= ? AND valid_to >= ?
      AND (cost_object_id IS NULL OR cost_object_id = ?) ORDER BY valid_to DESC LIMIT 1`).get(employeeId, typeId, date, date, costObjectId ?? -1) || null;
  }
  // strict: per le abilitazioni di legge (patentino fitosanitario, spazi confinati) una deroga non vale e
  // una limitazione del giudizio collegata all'operazione blocca invece di avvisare (Produzione, PRD-V02/V10).
  // requiredTrainingCodes: abilitazioni richieste comunque, anche se il collegamento all'operazione cambia.
  function assignmentCheck(employeeId, { date = today(), costObjectId = null, jobRoleId = null, req = null, strict = false, requiredTrainingCodes = [] } = {}) {
    const e = employee(employeeId);
    const blocks = hrFile.blockingIssues(e.id, date).map(m => `${fullName(e)}: ${m}.`);
    const warnings = [];
    const waivers = [];
    const op = costObjectId ? operation(costObjectId) : null;
    const required = op ? db.prepare('SELECT t.* FROM operation_trainings ot JOIN training_types t ON t.id = ot.training_type_id WHERE ot.cost_object_id = ? AND t.active = 1').all(op.id) : [];
    for (const code of requiredTrainingCodes) {
      const t = db.prepare('SELECT * FROM training_types WHERE code = ?').get(code);
      if (!t) blocks.push(`${fullName(e)}: manca il tipo di formazione «${code}» richiesto per legge.`);
      else if (!required.some(x => x.id === t.id)) required.push(t);
    }
    if (op || required.length) {
      const opName = op ? op.name : 'questa attività';
      for (const t of required) {
        const rec = latestTraining(e.id, t.id, date);
        if (validAt(rec, date)) continue;
        const w = strict ? null : activeWaiver(e.id, t.id, op?.id ?? null, date);
        if (w) {
          waivers.push(w.id);
          warnings.push(`${fullName(e)} lavora su «${opName}» con una deroga del responsabile sicurezza per «${t.name}» fino al ${itDate(w.valid_to)}: ${w.reason}`);
        } else {
          blocks.push(rec
            ? `${fullName(e)}: l'abilitazione «${t.name}» richiesta per «${opName}» è scaduta il ${itDate(rec.expires_on)}.`
            : `${fullName(e)}: manca l'abilitazione «${t.name}» richiesta per «${opName}».`);
        }
      }
    }
    const v = latestVisit(e.id, date);
    const state = fitnessState(v, date);
    let fitnessUsed = false;
    if (state === 'non_idoneo' || state === 'non_idoneo_temporaneo') {
      fitnessUsed = true;
      blocks.push(`${fullName(e)} non è assegnabile: giudizio di non idoneità del medico competente${state === 'non_idoneo_temporaneo' && v.unfit_until ? ` fino al ${itDate(v.unfit_until)}` : ''}.`);
    } else if (state === 'prescrizioni' && (op || jobRoleId)) {
      const hit = restrictionsOf(v.id).filter(x => (op && x.cost_object_id === op.id) || (jobRoleId && x.job_role_id === Number(jobRoleId)));
      if (hit.length) {
        fitnessUsed = true;
        (strict ? blocks : warnings).push(`${fullName(e)} ha limitazioni incompatibili con ${hit.map(x => `«${x.cost_object_name || x.job_role_name}»`).join(', ')}${v.limitations ? `: ${v.limitations}` : ''}.`);
      }
    } else if (state === 'da_rivalutare') {
      fitnessUsed = true;
      warnings.push(`${fullName(e)}: l'inidoneità temporanea è terminata, manca la nuova visita del medico competente.`);
    }
    if (fitnessUsed && req) logSensitive(req, e, `controllo idoneità per assegnazione${op ? ` (${op.code})` : ''}`);
    return { ok: blocks.length === 0, blocks, warnings, waiver_ids: waivers };
  }
  r.get('/employees/:id/assignment-check', req => {
    const e = employee(req.params.id);
    if (!canSeeSafety(req, e) && !isTeamLeaderOf(req, e)) throw new HttpError(403, "Non puoi controllare l'assegnabilità di questa persona.");
    return assignmentCheck(e.id, {
      date: checkDate(req.query.date, 'Data') || today(), costObjectId: intOrNull(req.query.cost_object_id), jobRoleId: intOrNull(req.query.job_role_id), req,
    });
  });

  // ── Sezione sicurezza della scheda ──────────────────────────────────────────
  r.get('/employees/:id/safety', req => {
    const e = employee(req.params.id);
    if (!canSeeSafety(req, e)) throw new HttpError(403, 'Non puoi vedere i dati di sicurezza di questa persona.');
    const out = {
      requirements: requirementStatus(e.id),
      trainings: db.prepare(`SELECT tr.*, t.name AS type_name, t.category FROM trainings tr JOIN training_types t ON t.id = tr.training_type_id WHERE tr.employee_id = ? ORDER BY tr.completed_on DESC, tr.id DESC`).all(e.id),
      ppe: db.prepare('SELECT p.*, t.name AS type_name FROM ppe_deliveries p JOIN ppe_types t ON t.id = p.ppe_type_id WHERE p.employee_id = ? ORDER BY p.delivered_on DESC, p.id DESC').all(e.id),
      waivers: db.prepare(`SELECT w.*, t.name AS type_name, co.name AS cost_object_name FROM safety_waivers w JOIN training_types t ON t.id = w.training_type_id
        LEFT JOIN cost_objects co ON co.id = w.cost_object_id WHERE w.employee_id = ? ORDER BY w.valid_to DESC`).all(e.id),
      tasks: db.prepare('SELECT * FROM hr_tasks WHERE employee_id = ? ORDER BY done_at IS NOT NULL, due_date').all(e.id),
      access: {
        fitness: canSeeFitness(req, e), incidents: hasAccessLevel(req, 'personale') || isSelf(req, e),
        edit: hasAccessLevel(req, 'personale'), edit_fitness: hasAccessLevel(req, 'sanitario'), waivers: isSafetyOfficer(req),
      },
    };
    if (out.access.fitness) {
      const visits = db.prepare('SELECT * FROM medical_visits WHERE employee_id = ? ORDER BY visit_date DESC, id DESC').all(e.id).map(v => ({ ...v, restrictions: restrictionsOf(v.id) }));
      out.fitness = { state: fitnessState(visits.find(v => v.visit_date <= today()) || null), visits };
      if (visits.length) logSensitive(req, e, 'lettura idoneità e limitazioni');
    }
    if (out.access.incidents) out.incidents = db.prepare('SELECT * FROM incidents WHERE employee_id = ? ORDER BY occurred_on DESC').all(e.id);
    return out;
  });

  // ── Registro della formazione ───────────────────────────────────────────────
  r.post('/employees/:id/trainings', upload.single('file'), req => {
    const e = employee(req.params.id);
    need(req, 'personale', 'La formazione la registra l\'ufficio del personale.');
    const b = req.body || {};
    const t = trainingType(b.training_type_id);
    const completed = checkDate(b.completed_on, 'la data del corso', true);
    if (completed > today()) throw new HttpError(400, 'La data del corso non può essere nel futuro.');
    // Scadenza: quella indicata, altrimenti dalla periodicità del tipo (vuota = non scade).
    const expires = checkDate(b.expires_on, 'Scadenza') || (t.validity_months ? addMonths(completed, t.validity_months) : null);
    if (expires && expires <= completed) throw new HttpError(400, 'La scadenza è prima del corso.');
    const minutes = b.hours === undefined || b.hours === '' ? null : Math.round(Number(String(b.hours).replace(',', '.')) * 60);
    if (minutes != null && !(minutes > 0)) throw new HttpError(400, 'Ore del corso non valide.');
    const id = events.transaction(() => {
      const docId = req.file ? hrFile.storeDocument(req, { employeeId: e.id, type: 'attestato', file: req.file, title: `Attestato: ${t.name}`, docDate: completed }) : null;
      return Number(db.prepare('INSERT INTO trainings (employee_id, training_type_id, completed_on, minutes, provider, expires_on, document_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(e.id, t.id, completed, minutes, text(b.provider), expires, docId, text(b.notes), now(), actor(req)).lastInsertRowid);
    });
    audit(req, 'training.recorded', { entity: 'employee', entityId: e.id, after: { training_id: id, type: t.code, completed_on: completed, expires_on: expires } });
    return { success: true, id, expires_on: expires };
  });
  r.delete('/trainings/:id', req => {
    need(req, 'personale');
    const tr = db.prepare('SELECT * FROM trainings WHERE id = ?').get(req.params.id);
    if (!tr) throw new HttpError(404, 'Corso non trovato.');
    db.prepare('DELETE FROM trainings WHERE id = ?').run(tr.id);
    audit(req, 'training.deleted', { entity: 'employee', entityId: tr.employee_id, before: tr });
    return { success: true };
  });

  // ── Sorveglianza sanitaria (sanitario) ──────────────────────────────────────
  r.post('/employees/:id/medical-visits', upload.single('file'), req => {
    const e = employee(req.params.id);
    need(req, 'sanitario', 'Le visite mediche le registra chi ha il livello "sanitario".');
    const b = req.body || {};
    const f = {
      visit_date: checkDate(b.visit_date, 'la data della visita', true), visit_type: b.visit_type, judgment: b.judgment,
      doctor: text(b.doctor) || safetySettings().doctor || null, limitations: text(b.limitations),
      unfit_until: checkDate(b.unfit_until, 'Fine inidoneità'), next_visit_on: checkDate(b.next_visit_on, 'Prossima visita'),
    };
    if (!VISIT_TYPES[f.visit_type]) throw new HttpError(400, 'Tipo di visita non valido.');
    if (!JUDGMENTS[f.judgment]) throw new HttpError(400, 'Giudizio non valido.');
    if (f.judgment === 'idoneo_prescrizioni' && !f.limitations) throw new HttpError(400, 'Riporta le prescrizioni o limitazioni del giudizio.');
    if (f.judgment === 'non_idoneo_temporaneo' && !f.unfit_until) throw new HttpError(400, 'Per la non idoneità temporanea indica fino a quando.');
    if (f.next_visit_on && f.next_visit_on <= f.visit_date) throw new HttpError(400, 'La prossima visita è prima di questa.');
    const restrictions = [...ids(b.restricted_job_role_ids).map(id => ['job', id]), ...ids(b.restricted_cost_object_ids).map(id => ['op', id])];
    if (restrictions.length && f.judgment !== 'idoneo_prescrizioni') throw new HttpError(400, 'Mansioni e operazioni incompatibili si indicano solo con un giudizio con prescrizioni.');
    if (f.visit_date > today()) throw new HttpError(400, 'La data della visita non può essere nel futuro.');
    for (const [kind, rid] of restrictions) {
      if (kind === 'job' && !db.prepare('SELECT 1 FROM job_roles WHERE id = ?').get(rid)) throw new HttpError(400, 'Mansione non trovata.');
      if (kind === 'op') operation(rid);
    }
    const id = events.transaction(() => {
      const docId = req.file ? hrFile.storeDocument(req, { employeeId: e.id, type: 'idoneita', file: req.file, title: `Giudizio di idoneità ${itDate(f.visit_date)}`, docDate: f.visit_date }) : null;
      const vid = Number(db.prepare(`INSERT INTO medical_visits (employee_id, visit_date, visit_type, doctor, judgment, limitations, unfit_until, next_visit_on, document_id, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.id, f.visit_date, f.visit_type, f.doctor, f.judgment, f.limitations, f.unfit_until, f.next_visit_on, docId, now(), actor(req)).lastInsertRowid);
      const ins = db.prepare('INSERT INTO medical_restrictions (visit_id, job_role_id, cost_object_id) VALUES (?, ?, ?)');
      for (const [kind, rid] of restrictions) ins.run(vid, kind === 'job' ? rid : null, kind === 'op' ? rid : null);
      // La visita chiude l'attività corrispondente aperta (cambio mansione, rientro).
      if (TASK_BY_VISIT[f.visit_type]) {
        db.prepare('UPDATE hr_tasks SET done_at = ?, done_by = ?, notes = COALESCE(notes, ?) WHERE employee_id = ? AND kind = ? AND done_at IS NULL')
          .run(now(), actor(req), `Visita del ${itDate(f.visit_date)}`, e.id, TASK_BY_VISIT[f.visit_type]);
      }
      return vid;
    });
    logSensitive(req, e, `registrazione visita medica ${id}`);
    audit(req, 'medical_visit.recorded', { entity: 'employee', entityId: e.id, after: { visit_id: id, visit_type: f.visit_type } }); // niente giudizio nel registro attività
    return { success: true, id };
  });
  r.delete('/medical-visits/:id', req => {
    need(req, 'sanitario');
    const v = db.prepare('SELECT * FROM medical_visits WHERE id = ?').get(req.params.id);
    if (!v) throw new HttpError(404, 'Visita non trovata.');
    db.prepare('DELETE FROM medical_visits WHERE id = ?').run(v.id);
    logSensitive(req, employee(v.employee_id), `eliminazione visita medica ${v.id}`);
    audit(req, 'medical_visit.deleted', { entity: 'employee', entityId: v.employee_id, before: { visit_id: v.id, visit_date: v.visit_date } });
    return { success: true };
  });

  // ── DPI ─────────────────────────────────────────────────────────────────────
  const ppeType = id => {
    const t = db.prepare('SELECT * FROM ppe_types WHERE id = ?').get(id);
    if (!t) throw new HttpError(400, 'Tipo di DPI non trovato.');
    return t;
  };
  r.post('/ppe-types', req => {
    need(req, 'personale');
    const b = req.body || {};
    const code = text(b.code)?.toLowerCase();
    if (!code || !/^[a-z0-9_]+$/.test(code) || !text(b.name)) throw new HttpError(400, 'Codice (lettere minuscole, numeri, trattini bassi) e nome sono obbligatori.');
    const months = intOrNull(b.replacement_months);
    if (months != null && !(months > 0)) throw new HttpError(400, 'Sostituzione: mesi maggiori di zero, oppure vuota.');
    const id = Number(db.prepare('INSERT INTO ppe_types (code, name, replacement_months, sized) VALUES (?, ?, ?, ?)').run(code, text(b.name), months, b.sized ? 1 : 0).lastInsertRowid);
    audit(req, 'ppe_type.created', { entity: 'ppe_type', entityId: id, after: b });
    return { success: true, id };
  });
  r.patch('/ppe-types/:id', req => {
    need(req, 'personale');
    const t = ppeType(req.params.id);
    const b = req.body || {};
    const f = { name: b.name !== undefined ? text(b.name) : t.name, replacement_months: b.replacement_months !== undefined ? intOrNull(b.replacement_months) : t.replacement_months,
      sized: b.sized !== undefined ? (b.sized ? 1 : 0) : t.sized, active: b.active !== undefined ? (b.active ? 1 : 0) : t.active };
    if (!f.name) throw new HttpError(400, 'Il nome è obbligatorio.');
    if (f.replacement_months != null && !(f.replacement_months > 0)) throw new HttpError(400, 'Sostituzione: mesi maggiori di zero, oppure vuota.');
    db.prepare('UPDATE ppe_types SET name = ?, replacement_months = ?, sized = ?, active = ? WHERE id = ?').run(f.name, f.replacement_months, f.sized, f.active, t.id);
    audit(req, 'ppe_type.updated', { entity: 'ppe_type', entityId: t.id, before: t, after: f });
    return { success: true };
  });
  r.post('/employees/:id/ppe', upload.single('file'), req => {
    const e = employee(req.params.id);
    need(req, 'personale', 'Le consegne dei DPI le registra l\'ufficio del personale.');
    const b = req.body || {};
    const t = ppeType(b.ppe_type_id);
    const delivered = checkDate(b.delivered_on, 'la data di consegna', true);
    const qty = b.quantity === undefined || b.quantity === '' ? 1 : parseInt(b.quantity);
    if (!(qty > 0)) throw new HttpError(400, 'Quantità non valida.');
    const size = text(b.size) || (t.sized ? db.prepare('SELECT * FROM employee_personal WHERE employee_id = ?').get(e.id)?.[{ scarpe: 'size_shoes', stivali: 'size_shoes' }[t.code] || 'size_shirt'] ?? null : null);
    const replaceBy = checkDate(b.replace_by, 'Sostituzione') || (t.replacement_months ? addMonths(delivered, t.replacement_months) : null);
    const id = events.transaction(() => {
      const docId = req.file ? hrFile.storeDocument(req, { employeeId: e.id, type: 'dpi', file: req.file, title: `Consegna DPI: ${t.name}`, docDate: delivered }) : null;
      return Number(db.prepare('INSERT INTO ppe_deliveries (employee_id, ppe_type_id, delivered_on, size, quantity, replace_by, document_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(e.id, t.id, delivered, size, qty, replaceBy, docId, text(b.notes), now(), actor(req)).lastInsertRowid);
    });
    audit(req, 'ppe.delivered', { entity: 'employee', entityId: e.id, after: { delivery_id: id, type: t.code, quantity: qty } });
    return { success: true, id, replace_by: replaceBy, size };
  });
  r.patch('/ppe/:id', req => {
    need(req, 'personale');
    const p = db.prepare('SELECT * FROM ppe_deliveries WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'Consegna non trovata.');
    const returned = req.body?.returned_on === null ? null : checkDate(req.body?.returned_on, 'la data di restituzione', true);
    if (returned && returned < p.delivered_on) throw new HttpError(400, 'La restituzione è prima della consegna.');
    db.prepare('UPDATE ppe_deliveries SET returned_on = ? WHERE id = ?').run(returned, p.id);
    audit(req, 'ppe.returned', { entity: 'employee', entityId: p.employee_id, after: { delivery_id: p.id, returned_on: returned } });
    return { success: true };
  });
  r.delete('/ppe/:id', req => {
    need(req, 'personale');
    const p = db.prepare('SELECT * FROM ppe_deliveries WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'Consegna non trovata.');
    db.prepare('DELETE FROM ppe_deliveries WHERE id = ?').run(p.id);
    audit(req, 'ppe.deleted', { entity: 'employee', entityId: p.employee_id, before: p });
    return { success: true };
  });

  // ── Deroghe motivate (responsabile sicurezza, solo se la mansione lo consente) ─
  r.post('/employees/:id/waivers', req => {
    const e = employee(req.params.id);
    if (!isSafetyOfficer(req)) throw new HttpError(403, 'Le deroghe le registra solo il responsabile sicurezza (People → Configurazione).');
    const b = req.body || {};
    const t = trainingType(b.training_type_id);
    const op = b.cost_object_id ? operation(b.cost_object_id) : null;
    const from = checkDate(b.valid_from, 'l\'inizio della deroga', true);
    const to = checkDate(b.valid_to, 'la fine della deroga', true);
    if (to < from) throw new HttpError(400, 'La deroga finisce prima di iniziare.');
    if (to > addMonths(from, 12)) throw new HttpError(400, 'Una deroga dura al massimo 12 mesi.');
    const reason = text(b.reason);
    if (!reason || reason.length < 10) throw new HttpError(400, 'Scrivi il motivo della deroga (almeno 10 caratteri).');
    const role = roleAt(e.id, from);
    if (!role) throw new HttpError(409, `${fullName(e)} non ha una mansione in vigore il ${itDate(from)}: senza mansione non si concedono deroghe.`);
    if (!role.allows_waiver) throw new HttpError(409, `La mansione «${role.name}» non ammette deroghe: serve la formazione.`);
    const id = Number(db.prepare(`INSERT INTO safety_waivers (employee_id, training_type_id, cost_object_id, reason, valid_from, valid_to, granted_by, granted_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.id, t.id, op?.id ?? null, reason, from, to, actor(req), req.portalUser?.id ?? null, now()).lastInsertRowid);
    audit(req, 'safety_waiver.granted', { entity: 'employee', entityId: e.id, after: { waiver_id: id, type: t.code, cost_object_id: op?.id ?? null, valid_from: from, valid_to: to, reason } });
    return { success: true, id };
  });
  r.post('/waivers/:id/revoke', req => {
    if (!isSafetyOfficer(req)) throw new HttpError(403, 'Solo il responsabile sicurezza revoca le deroghe.');
    const w = db.prepare('SELECT * FROM safety_waivers WHERE id = ?').get(req.params.id);
    if (!w) throw new HttpError(404, 'Deroga non trovata.');
    if (w.revoked_at) throw new HttpError(409, 'Deroga già revocata.');
    db.prepare('UPDATE safety_waivers SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(now(), actor(req), w.id);
    audit(req, 'safety_waiver.revoked', { entity: 'employee', entityId: w.employee_id, after: { waiver_id: w.id } });
    return { success: true };
  });

  // ── Infortuni e quasi-infortuni (personale) ─────────────────────────────────
  function incidentFields(b, existing = null) {
    const pick = (k, conv) => (b[k] !== undefined ? conv(b[k]) : existing?.[k] ?? null);
    const f = {
      kind: pick('kind', v => v), employee_id: pick('employee_id', intOrNull), site_id: pick('site_id', intOrNull), cost_object_id: pick('cost_object_id', intOrNull),
      occurred_on: pick('occurred_on', v => checkDate(v, 'la data', true)), occurred_time: pick('occurred_time', text), place: pick('place', text), dynamics: pick('dynamics', text),
      prognosis_days: pick('prognosis_days', intOrNull), inail_number: pick('inail_number', text), inail_date: pick('inail_date', v => checkDate(v, 'Data della denuncia INAIL')), measures: pick('measures', text),
    };
    if (!['infortunio', 'quasi_infortunio'].includes(f.kind)) throw new HttpError(400, 'Tipo: infortunio o quasi-infortunio.');
    if (!f.occurred_on) throw new HttpError(400, "Indica la data dell'evento.");
    if (f.kind === 'infortunio' && !f.employee_id) throw new HttpError(400, 'Per un infortunio indica il dipendente.');
    if (f.employee_id) employee(f.employee_id);
    if (f.cost_object_id) operation(f.cost_object_id);
    if (!f.dynamics) throw new HttpError(400, 'Descrivi la dinamica.');
    if (f.occurred_on > today()) throw new HttpError(400, 'La data è nel futuro.');
    if (f.occurred_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.occurred_time)) throw new HttpError(400, 'Ora nel formato HH:MM.');
    if (f.prognosis_days != null && !(f.prognosis_days >= 0)) throw new HttpError(400, 'Giorni di prognosi non validi.');
    if (f.kind === 'quasi_infortunio') f.prognosis_days = null;
    if (f.inail_number && !f.inail_date) throw new HttpError(400, 'Indica anche la data della denuncia INAIL.');
    if (!f.site_id && f.employee_id) f.site_id = db.prepare('SELECT site_id FROM employees WHERE id = ?').get(f.employee_id)?.site_id ?? null;
    return f;
  }
  const incidentPayload = (id, f) => ({ incident_id: id, kind: f.kind, employee_id: f.employee_id, occurred_on: f.occurred_on, prognosis_days: f.prognosis_days, inail_number: f.inail_number });
  r.get('/incidents', req => {
    need(req, 'personale');
    const q = req.query;
    return db.prepare(`SELECT i.*, e.first_name || ' ' || e.last_name AS employee_name, s.name AS site_name, co.name AS cost_object_name FROM incidents i
      LEFT JOIN employees e ON e.id = i.employee_id LEFT JOIN sites s ON s.id = i.site_id LEFT JOIN cost_objects co ON co.id = i.cost_object_id
      WHERE (? IS NULL OR i.kind = ?) AND (? IS NULL OR substr(i.occurred_on, 1, 4) = ?) ORDER BY i.occurred_on DESC, i.id DESC`)
      .all(q.kind || null, q.kind || null, q.year || null, q.year ? String(q.year) : null);
  });
  r.post('/incidents', req => {
    need(req, 'personale');
    const f = incidentFields(req.body || {});
    const id = events.transaction(() => {
      const iid = Number(db.prepare(`INSERT INTO incidents (kind, employee_id, site_id, cost_object_id, occurred_on, occurred_time, place, dynamics, prognosis_days, inail_number, inail_date, measures, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.kind, f.employee_id, f.site_id, f.cost_object_id, f.occurred_on, f.occurred_time, f.place, f.dynamics, f.prognosis_days, f.inail_number, f.inail_date, f.measures, now(), actor(req)).lastInsertRowid);
      events.emit('incident.recorded', { sourceTable: 'incidents', sourceId: iid, payload: incidentPayload(iid, f) });
      return iid;
    });
    events.dispatch();
    audit(req, 'incident.recorded', { entity: 'incident', entityId: id, after: { kind: f.kind, employee_id: f.employee_id, occurred_on: f.occurred_on } });
    return { success: true, id };
  });
  r.patch('/incidents/:id', req => {
    need(req, 'personale');
    const before = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
    if (!before) throw new HttpError(404, 'Evento non trovato.');
    const f = incidentFields(req.body || {}, before);
    if (f.kind !== before.kind || f.employee_id !== before.employee_id) throw new HttpError(400, 'Tipo e dipendente non si cambiano: elimina e registra di nuovo.');
    events.transaction(() => {
      db.prepare(`UPDATE incidents SET site_id = ?, cost_object_id = ?, occurred_on = ?, occurred_time = ?, place = ?, dynamics = ?, prognosis_days = ?, inail_number = ?, inail_date = ?, measures = ? WHERE id = ?`)
        .run(f.site_id, f.cost_object_id, f.occurred_on, f.occurred_time, f.place, f.dynamics, f.prognosis_days, f.inail_number, f.inail_date, f.measures, before.id);
      events.emit('incident.updated', { sourceTable: 'incidents', sourceId: before.id, payload: incidentPayload(before.id, f) });
    });
    events.dispatch();
    audit(req, 'incident.updated', { entity: 'incident', entityId: before.id, before: { prognosis_days: before.prognosis_days, inail_number: before.inail_number }, after: { prognosis_days: f.prognosis_days, inail_number: f.inail_number } });
    return { success: true };
  });

  // ── Attività HR ─────────────────────────────────────────────────────────────
  r.post('/tasks/:id/done', req => {
    need(req, 'personale');
    const t = db.prepare('SELECT * FROM hr_tasks WHERE id = ?').get(req.params.id);
    if (!t) throw new HttpError(404, 'Attività non trovata.');
    if (t.done_at) throw new HttpError(409, 'Attività già chiusa.');
    db.prepare('UPDATE hr_tasks SET done_at = ?, done_by = ?, notes = ? WHERE id = ?').run(now(), actor(req), text(req.body?.notes), t.id);
    audit(req, 'hr_task.done', { entity: 'employee', entityId: t.employee_id, after: { task_id: t.id, kind: t.kind } });
    return { success: true };
  });

  // ── Conformità: riepilogo per dipendente ────────────────────────────────────
  r.get('/safety/compliance', req => {
    const visible = hrFile.visibleEmployeeIds(req);
    const people = db.prepare(`SELECT e.*, s.name AS site_name FROM employees e LEFT JOIN sites s ON s.id = e.site_id WHERE e.active = 1
      AND (? IS NULL OR e.site_id = ?) ORDER BY e.last_name, e.first_name`).all(req.query.site_id || null, req.query.site_id || null)
      .filter(e => !visible || visible.has(e.id));
    const withFitness = hasAccessLevel(req, 'sanitario');
    const t = today();
    const rows = people.map(e => {
      const st = requirementStatus(e.id);
      const count = s => st.items.filter(i => i.state === s).length;
      const v = latestVisit(e.id);
      const row = { employee_id: e.id, name: fullName(e), site_name: e.site_name, job_role: st.role?.name ?? null, required: st.items.length,
        valid: count('valida'), expiring: count('in_scadenza'), expired: count('scaduta'), missing: count('mancante'),
        visit_due: v?.next_visit_on ?? null, visit_missing: !!st.role?.medical_surveillance && !v, visit_expired: !!v?.next_visit_on && v.next_visit_on < t,
        open_tasks: db.prepare('SELECT COUNT(*) AS c FROM hr_tasks WHERE employee_id = ? AND done_at IS NULL').get(e.id).c };
      // Il giudizio compare solo a chi può vederlo: livello sanitario, oppure il responsabile per i suoi collaboratori.
      if (withFitness || (visible && (isManagerOf(req, e) || isSelf(req, e)))) row.fitness = fitnessState(v);
      return row;
    });
    const seen = rows.filter(x => x.fitness !== undefined && x.fitness !== null);
    if (seen.length) logSensitive(req, null, `conformità sicurezza: idoneità di ${seen.length} dipendenti`);
    return rows;
  });

  // ── Scadenzario: formazione, idoneità, DPI, attività ────────────────────────
  hrFile.registerDeadlineSource(() => {
    const out = [];
    const t = today();
    for (const e of db.prepare('SELECT id FROM employees WHERE active = 1').all()) {
      const st = requirementStatus(e.id);
      const required = new Set(st.items.map(i => i.training_type_id));
      for (const i of st.items.filter(x => x.state === 'mancante')) {
        out.push({ employee_id: e.id, kind: 'formazione_mancante', label: i.name, due_date: st.role.since, ref: `req:${e.id}:${st.role.id}:${i.training_type_id}`, blocking: false, missing: true });
      }
      // Ultimo corso per tipo: le scadenze future sempre, quelle passate solo se la mansione lo richiede ancora.
      const latest = db.prepare(`SELECT tr.*, tt.name, tt.category FROM trainings tr JOIN training_types tt ON tt.id = tr.training_type_id
        WHERE tr.employee_id = ? AND tr.expires_on IS NOT NULL AND tr.id = (SELECT t2.id FROM trainings t2 WHERE t2.employee_id = tr.employee_id AND t2.training_type_id = tr.training_type_id ORDER BY t2.completed_on DESC, t2.id DESC LIMIT 1)`).all(e.id);
      for (const rec of latest) {
        if (rec.expires_on < t && !required.has(rec.training_type_id)) continue;
        out.push({ employee_id: e.id, kind: rec.category === 'abilitazione' ? 'abilitazione' : 'formazione', label: rec.name, due_date: rec.expires_on, ref: `training:${rec.id}`, blocking: false });
      }
      // Visita medica: la prossima indicata dal medico; se la mansione è soggetta a sorveglianza e non c'è visita, manca.
      const v = latestVisit(e.id);
      const due = v ? v.next_visit_on || (v.judgment === 'non_idoneo_temporaneo' ? v.unfit_until : null) : null;
      if (due) out.push({ employee_id: e.id, kind: 'visita_medica', label: 'Visita medica', due_date: due, ref: `visit:${v.id}`, blocking: false });
      else if (!v && st.role?.medical_surveillance) out.push({ employee_id: e.id, kind: 'visita_medica', label: 'Visita medica preventiva', due_date: st.role.since, ref: `visitreq:${e.id}:${st.role.id}`, blocking: false, missing: true });
    }
    // DPI da sostituire: l'ultima consegna non restituita per tipo.
    for (const p of db.prepare(`SELECT p.*, t.name FROM ppe_deliveries p JOIN ppe_types t ON t.id = p.ppe_type_id JOIN employees e ON e.id = p.employee_id
      WHERE e.active = 1 AND p.returned_on IS NULL AND p.replace_by IS NOT NULL
        AND p.id = (SELECT p2.id FROM ppe_deliveries p2 WHERE p2.employee_id = p.employee_id AND p2.ppe_type_id = p.ppe_type_id ORDER BY p2.delivered_on DESC, p2.id DESC LIMIT 1)`).all()) {
      out.push({ employee_id: p.employee_id, kind: 'dpi', label: `DPI da sostituire: ${p.name}`, due_date: p.replace_by, ref: `ppe:${p.id}`, blocking: false });
    }
    for (const task of db.prepare('SELECT h.* FROM hr_tasks h JOIN employees e ON e.id = h.employee_id WHERE e.active = 1 AND h.done_at IS NULL').all()) {
      out.push({ employee_id: task.employee_id, kind: 'attivita', label: task.title, due_date: task.due_date, ref: `task:${task.id}`, blocking: false });
    }
    return out;
  });

  // Un dipendente con dati di sicurezza non si elimina.
  hr.registerDeleteGuard(id => (db.prepare(`SELECT (SELECT COUNT(*) FROM trainings WHERE employee_id = ?) + (SELECT COUNT(*) FROM medical_visits WHERE employee_id = ?)
    + (SELECT COUNT(*) FROM ppe_deliveries WHERE employee_id = ?) + (SELECT COUNT(*) FROM incidents WHERE employee_id = ?) + (SELECT COUNT(*) FROM safety_waivers WHERE employee_id = ?) AS c`)
    .get(id, id, id, id, id).c ? 'dati di sicurezza (formazione, visite, DPI o infortuni)' : null));

  // ── Consumer: cambio di mansione ────────────────────────────────────────────
  // QUANDO cambia la mansione ALLORA si ricalcolano i requisiti (la formazione mancante per la nuova
  // mansione entra nello scadenzario) e, se la mansione è soggetta a sorveglianza sanitaria, si crea
  // l'attività "visita per cambio mansione". HR e responsabile ricevono l'elenco di ciò che manca.
  events.on('employee.role_changed', 'hr-safety.role-changed', event => {
    const p = event.payload;
    const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(p.employee_id);
    const role = db.prepare('SELECT * FROM job_roles WHERE id = ?').get(p.to_job_role_id);
    if (!e || !role) return;
    const st = requirementStatus(e.id, p.effective_from);
    const gaps = st.items.filter(i => i.state === 'mancante' || i.state === 'scaduta');
    if (role.medical_surveillance) {
      db.prepare('INSERT OR IGNORE INTO hr_tasks (employee_id, kind, title, due_date, source_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(e.id, 'visita_cambio_mansione', `Visita medica per cambio mansione (${role.name})`, p.effective_from, event.id, now());
    }
    const approver = hr.resolveApprover(e.id)?.approver;
    const managerUser = approver ? db.prepare('SELECT portal_user_id FROM employees WHERE id = ?').get(approver.id)?.portal_user_id : null;
    const body = [gaps.length ? `Formazione da fare: ${gaps.map(g => g.name).join(', ')}.` : 'La formazione richiesta è completa.',
      role.medical_surveillance ? 'Da programmare la visita medica per cambio mansione.' : null].filter(Boolean).join(' ');
    for (const userId of new Set([...hrFile.hrRecipients(), managerUser].filter(x => x !== undefined))) {
      notifications.notify({ userId, kind: 'hr.role_changed', title: `${fullName(e)}: nuova mansione ${role.name} dal ${itDate(p.effective_from)}`, body,
        link: `/portal.html?workspace=people&employee=${e.id}&tab=sicurezza`, dedupeKey: `role_changed:${event.id}` });
    }
  });

  return { assignmentCheck, requirementStatus, latestVisit, fitnessState, latestTraining, roleAt, isSafetyOfficer, safetySettings };
};
