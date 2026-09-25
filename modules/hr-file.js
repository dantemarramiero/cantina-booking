// People — Fase 2.0: fascicolo del dipendente.
//   2.0.1 dati personali, contatti di emergenza, documenti d'identità e permessi di soggiorno  (personale)
//   2.0.2 contratti versionati (personale) e retribuzione con proposta di costo orario        (retributivo)
//   2.0.3 competenze, titoli, lingue, qualifiche                                            (personale)
//   2.0.6 documenti HR cifrati, ciascuno col livello del suo tipo; accessi ai sanitari registrati
//   2.0.10 scadenzario HR con soglie di preavviso e notifiche
// Le API stanno sotto /api/admin/hr (workspace People). I controlli di livello sono qui, sul server.
const multer = require('multer');
const { HttpError, createRouter } = require('../lib/http');
const { parseDecimal, formatDecimal } = require('../lib/money');
const { DATE, addDays } = require('../lib/calendar');

const CONTRACT_TYPES = ['OTD', 'OTI', 'impiegato', 'quadro', 'dirigente', 'apprendista', 'stagionale', 'somministrato', 'collaboratore'];
const FIXED_TERM = ['OTD', 'stagionale', 'somministrato', 'collaboratore'];
const ID_DOC_TYPES = { carta_identita: "Carta d'identità", passaporto: 'Passaporto', patente: 'Patente', permesso_soggiorno: 'Permesso di soggiorno' };
const SKILL_KINDS = ['lingua', 'titolo_studio', 'esperienza', 'qualifica', 'competenza'];
const DEFAULT_THRESHOLDS = [60, 30, 7];
const DEFAULT_EMPLOYER_COST_E2 = 3000; // oneri a carico azienda, in centesimi di punto (30,00%)
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const text = v => (v == null ? null : String(v).trim() || null);
const intOrNull = v => (v === '' || v == null ? null : parseInt(v));
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

module.exports = function registerHrFile(app, deps) {
  const { db, authAdmin, audit, events, hasAccessLevel, hasWorkspace, notifications, scheduler, signer, secureStore, getSetting, setSetting, hr, finance } = deps;
  const r = createRouter(app, '/api/admin/hr', authAdmin, [
    [/employee_personal.fiscal_code|idx_employee_personal_cf/, 'Questo codice fiscale è già di un altro dipendente.'],
    [/compensations/, 'Esiste già una retribuzione con questa decorrenza.'],
    [/job_roles.code/, 'Codice mansione già usato.'],
  ]);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

  const employee = id => {
    const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!e) throw new HttpError(404, 'Dipendente non trovato.');
    return e;
  };
  const fullName = e => `${e.first_name} ${e.last_name}`;
  const actor = req => (req.portalUser ? req.portalUser.name : req.isMasterKey ? 'Chiave master' : 'Sistema');
  const isSelf = (req, e) => !!(req.portalUser && e.portal_user_id === req.portalUser.id);
  // Chi può vedere un livello di dati di un dipendente: chi ha il livello, oppure il dipendente
  // stesso per i propri dati (tranne i disciplinari).
  const canSee = (req, e, level) => level === 'base' || hasAccessLevel(req, level) || (isSelf(req, e) && level !== 'disciplinare');
  const requireSee = (req, e, level) => {
    if (!canSee(req, e, level)) throw new HttpError(403, `Serve il livello di accesso "${level}" per questi dati.`);
  };
  // Il responsabile (diretto, quello che approva al suo posto o il delegato) vede dei suoi
  // collaboratori solo ciò che serve alla gestione: scadenze, sicurezza, idoneità e limitazioni.
  const viewerEmployee = req => (req.portalUser ? db.prepare('SELECT * FROM employees WHERE portal_user_id = ?').get(req.portalUser.id) || null : null);
  function isManagerOf(req, e, me = viewerEmployee(req)) {
    if (!me || me.id === e.id) return false;
    if (e.manager_id === me.id) return true;
    const a = hr.resolveApprover(e.id);
    return a?.approver?.id === me.id || a?.delegate?.id === me.id;
  }
  // Dipendenti di cui chi chiede vede le scadenze: tutti con il livello "personale", altrimenti sé stesso e i collaboratori.
  function visibleEmployeeIds(req) {
    if (hasAccessLevel(req, 'personale')) return null;
    const me = viewerEmployee(req);
    if (!me) return new Set();
    return new Set(db.prepare('SELECT * FROM employees').all().filter(e => e.id === me.id || isManagerOf(req, e, me)).map(e => e.id));
  }
  function logSensitive(req, e, what) {
    db.prepare('INSERT INTO sensitive_access_log (at, user_id, actor, employee_id, what, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(now(), req.portalUser?.id ?? null, actor(req), e?.id ?? null, what, req.ip || null);
  }
  const checkDate = (d, label) => {
    if (d != null && d !== '' && !DATE.test(d)) throw new HttpError(400, `${label}: data nel formato AAAA-MM-GG.`);
    return d || null;
  };

  // Un dipendente con un fascicolo non si elimina (conservazione di legge; i file cifrati resterebbero orfani).
  hr.registerDeleteGuard(id => (db.prepare(`SELECT (SELECT COUNT(*) FROM employment_contracts WHERE employee_id = ?) + (SELECT COUNT(*) FROM compensations WHERE employee_id = ?)
    + (SELECT COUNT(*) FROM hr_documents WHERE employee_id = ?) + (SELECT COUNT(*) FROM identity_documents WHERE employee_id = ?) AS c`).get(id, id, id, id).c
    ? 'un fascicolo (contratti, retribuzioni o documenti)' : null));

  // ── Impostazioni del fascicolo ───────────────────────────────────────────────
  function settings() {
    let thresholds = DEFAULT_THRESHOLDS;
    try { const t = JSON.parse(getSetting('hr_deadline_thresholds', 'null')); if (Array.isArray(t) && t.length) thresholds = t; } catch {}
    const cost = parseInt(getSetting('hr_employer_cost_e2', ''));
    return { deadline_thresholds: [...thresholds].sort((a, b) => b - a), employer_cost_pct: formatDecimal(Number.isFinite(cost) ? cost : DEFAULT_EMPLOYER_COST_E2, 2) };
  }
  r.get('/settings', () => settings());
  r.put('/settings', req => {
    const b = req.body || {};
    if (b.deadline_thresholds !== undefined) {
      const t = [...new Set((Array.isArray(b.deadline_thresholds) ? b.deadline_thresholds : []).map(Number))];
      if (!t.length || t.some(x => !Number.isInteger(x) || x < 1 || x > 365)) throw new HttpError(400, 'Le soglie di preavviso sono giorni interi tra 1 e 365.');
      setSetting('hr_deadline_thresholds', JSON.stringify(t.sort((x, y) => y - x)));
    }
    if (b.employer_cost_pct !== undefined) {
      let e2;
      try { e2 = parseDecimal(b.employer_cost_pct, 2); } catch (e) { throw new HttpError(400, e.message); }
      if (e2 == null || e2 > 10000) throw new HttpError(400, 'Oneri tra 0 e 100%.');
      setSetting('hr_employer_cost_e2', String(e2));
    }
    audit(req, 'hr_settings.updated', { entity: 'hr_settings', after: settings() });
    return settings();
  });

  // ── Mansioni ─────────────────────────────────────────────────────────────────
  r.get('/job-roles', () => db.prepare('SELECT * FROM job_roles ORDER BY name').all());
  r.post('/job-roles', req => {
    const { code, name, description, allows_waiver } = req.body || {};
    if (!text(code) || !text(name)) throw new HttpError(400, 'Codice e nome della mansione sono obbligatori.');
    const id = Number(db.prepare('INSERT INTO job_roles (code, name, description, allows_waiver) VALUES (?, ?, ?, ?)').run(text(code), text(name), text(description), allows_waiver ? 1 : 0).lastInsertRowid);
    audit(req, 'job_role.created', { entity: 'job_role', entityId: id, after: req.body });
    return { success: true, id };
  });
  r.patch('/job-roles/:id', req => {
    const jr = db.prepare('SELECT * FROM job_roles WHERE id = ?').get(req.params.id);
    if (!jr) throw new HttpError(404, 'Mansione non trovata.');
    const b = req.body || {};
    const f = { name: b.name !== undefined ? text(b.name) : jr.name, description: b.description !== undefined ? text(b.description) : jr.description,
      allows_waiver: b.allows_waiver !== undefined ? (b.allows_waiver ? 1 : 0) : jr.allows_waiver, active: b.active !== undefined ? (b.active ? 1 : 0) : jr.active };
    if (!f.name) throw new HttpError(400, 'Il nome è obbligatorio.');
    db.prepare('UPDATE job_roles SET name = ?, description = ?, allows_waiver = ?, active = ? WHERE id = ?').run(f.name, f.description, f.allows_waiver, f.active, jr.id);
    audit(req, 'job_role.updated', { entity: 'job_role', entityId: jr.id, before: jr, after: f });
    return { success: true };
  });

  // ── Contratti (versionati) ───────────────────────────────────────────────────
  const contracts = employeeId => db.prepare(`SELECT c.*, j.name AS job_role_name, s.name AS site_name, cc.code AS cost_center_code, m.first_name || ' ' || m.last_name AS manager_name
    FROM employment_contracts c LEFT JOIN job_roles j ON j.id = c.job_role_id LEFT JOIN sites s ON s.id = c.site_id
    LEFT JOIN cost_centers cc ON cc.id = c.cost_center_id LEFT JOIN employees m ON m.id = c.manager_id
    WHERE c.employee_id = ? ORDER BY c.version DESC`).all(employeeId);
  // Il contratto in vigore a una data: l'ultima versione con decorrenza entro quella data.
  const contractAt = (employeeId, date = today()) => db.prepare('SELECT * FROM employment_contracts WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, version DESC LIMIT 1').get(employeeId, date) || null;

  r.get('/employees/:id/contracts', req => { const e = employee(req.params.id); requireSee(req, e, 'personale'); return contracts(e.id); });
  r.post('/employees/:id/contracts', req => {
    const e = employee(req.params.id);
    requireSee(req, e, 'personale');
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'I contratti li registra l\'ufficio del personale.');
    const b = req.body || {};
    const prev = db.prepare('SELECT * FROM employment_contracts WHERE employee_id = ? ORDER BY version DESC LIMIT 1').get(e.id);
    // Una nuova versione eredita dalla precedente i campi non indicati; un campo inviato vuoto si azzera.
    const pick = (k, conv) => (b[k] !== undefined ? conv(b[k]) : prev?.[k] ?? null);
    const f = {
      effective_from: checkDate(b.effective_from, 'Decorrenza'), contract_type: pick('contract_type', v => v),
      ccnl: pick('ccnl', text), level: pick('level', text), qualification: pick('qualification', text), job_role_id: pick('job_role_id', intOrNull),
      hire_date: pick('hire_date', v => checkDate(v, 'Data di assunzione')), end_date: pick('end_date', v => checkDate(v, 'Fine contratto')),
      probation_end: pick('probation_end', v => checkDate(v, 'Fine periodo di prova')), part_time_pct: pick('part_time_pct', intOrNull),
      termination_date: pick('termination_date', v => checkDate(v, 'Cessazione')), termination_reason: pick('termination_reason', text),
      rehire_ok: pick('rehire_ok', v => (v === null || v === '' ? null : (v ? 1 : 0))), notes: text(b.notes),
    };
    if (!f.effective_from) throw new HttpError(400, 'Indica la decorrenza della versione.');
    if (!CONTRACT_TYPES.includes(f.contract_type)) throw new HttpError(400, 'Tipo di contratto non valido.');
    if (FIXED_TERM.includes(f.contract_type) && !f.end_date && !f.termination_date) throw new HttpError(400, 'Per un contratto a termine indica la data di fine.');
    if (f.end_date && f.hire_date && f.end_date < f.hire_date) throw new HttpError(400, 'La fine del contratto è prima dell\'assunzione.');
    if (f.part_time_pct != null && !(f.part_time_pct >= 1 && f.part_time_pct <= 100)) throw new HttpError(400, 'Part-time: percentuale tra 1 e 100.');
    if (f.job_role_id && !db.prepare('SELECT 1 FROM job_roles WHERE id = ?').get(f.job_role_id)) throw new HttpError(400, 'Mansione non trovata.');
    if (prev && f.effective_from < prev.effective_from) throw new HttpError(400, `La decorrenza non può essere prima della versione in vigore (${prev.effective_from}).`);
    if (f.termination_date && !f.termination_reason) throw new HttpError(400, 'Indica il motivo della cessazione.');
    const version = (prev?.version || 0) + 1;
    const id = events.transaction(() => {
      // Sede, centro e responsabile sono quelli attuali della scheda Organizzazione: copiati per lo storico.
      const cid = Number(db.prepare(`INSERT INTO employment_contracts (employee_id, version, effective_from, contract_type, ccnl, level, qualification, job_role_id, hire_date, end_date,
        probation_end, part_time_pct, site_id, cost_center_id, manager_id, termination_date, termination_reason, rehire_ok, notes, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.id, version, f.effective_from, f.contract_type, f.ccnl, f.level, f.qualification, f.job_role_id,
        f.hire_date, f.end_date, f.probation_end, f.part_time_pct, e.site_id, e.cost_center_id, e.manager_id, f.termination_date, f.termination_reason, f.rehire_ok, f.notes, now(), actor(req)).lastInsertRowid);
      if (prev && prev.job_role_id !== f.job_role_id && f.job_role_id) {
        events.emit('employee.role_changed', { sourceTable: 'employment_contracts', sourceId: cid, payload: { employee_id: e.id, from_job_role_id: prev.job_role_id, to_job_role_id: f.job_role_id, effective_from: f.effective_from } });
      }
      return cid;
    });
    events.dispatch();
    audit(req, 'contract.version_added', { entity: 'employee', entityId: e.id, after: { version, ...f } });
    return { success: true, id, version };
  });

  // ── Retribuzione (retributivo) e proposta di costo orario ────────────────────
  function compensations(employeeId) {
    return db.prepare('SELECT * FROM compensations WHERE employee_id = ? ORDER BY effective_from DESC').all(employeeId).map(c => ({
      ...c, ral: c.ral_cents != null ? formatDecimal(c.ral_cents, 2) : null, hourly: c.hourly_e4 != null ? formatDecimal(c.hourly_e4, 4) : null,
      superminimo: formatDecimal(c.superminimo_cents, 2), allowances: formatDecimal(c.allowances_cents, 2),
    }));
  }
  // Costo orario standard proposto (va confermato da HR/Finance): costo annuo × (1 + oneri) / ore annue.
  // Ore annue = orario settimanale contrattuale × 52 (in mancanza: 40 ore × part-time).
  function hourlyCostProposal(employeeId) {
    const c = db.prepare('SELECT * FROM compensations WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1').get(employeeId, today());
    if (!c) return null;
    const onere = BigInt(10000 + parseInt(getSetting('hr_employer_cost_e2', String(DEFAULT_EMPLOYER_COST_E2))));
    const sched = hr.currentSchedule(employeeId);
    const contract = contractAt(employeeId);
    const weeklyMin = sched?.weekly_minutes || Math.round(2400 * (contract?.part_time_pct || 100) / 100);
    if (!weeklyMin) return null;
    const annualMin = BigInt(weeklyMin * 52);
    let e4;
    if (c.pay_type === 'oraria') {
      const extraCents = BigInt(c.superminimo_cents + c.allowances_cents); // importi annui aggiuntivi
      const extraE4PerHour = (extraCents * 100n * 60n) / annualMin;
      e4 = ((BigInt(c.hourly_e4) + extraE4PerHour) * onere) / 10000n;
    } else {
      const annualCents = BigInt((c.ral_cents || 0) + c.superminimo_cents + c.allowances_cents);
      e4 = (annualCents * 100n * 60n * onere) / (annualMin * 10000n);
    }
    return { cost_per_hour: formatDecimal(Number(e4), 4), cost_per_hour_e4: Number(e4), weekly_minutes: weeklyMin, employer_cost_pct: settings().employer_cost_pct, from_compensation: c.effective_from };
  }
  r.get('/employees/:id/compensations', req => {
    const e = employee(req.params.id);
    requireSee(req, e, 'retributivo');
    return { items: compensations(e.id), proposal: hourlyCostProposal(e.id) };
  });
  r.post('/employees/:id/compensations', req => {
    const e = employee(req.params.id);
    if (!hasAccessLevel(req, 'retributivo')) throw new HttpError(403, 'Serve il livello di accesso "retributivo" per questi dati.');
    const b = req.body || {};
    const from = checkDate(b.effective_from, 'Decorrenza');
    if (!from) throw new HttpError(400, 'Indica la decorrenza.');
    if (!['ral', 'oraria'].includes(b.pay_type)) throw new HttpError(400, 'Scegli RAL annua oppure paga oraria.');
    let ral = null, hourly = null, sup = 0, allow = 0;
    try {
      if (b.pay_type === 'ral') ral = parseDecimal(b.ral, 2); else hourly = parseDecimal(b.hourly, 4);
      sup = parseDecimal(b.superminimo, 2) || 0;
      allow = parseDecimal(b.allowances, 2) || 0;
    } catch (err) { throw new HttpError(400, err.message); }
    if (b.pay_type === 'ral' ? !ral : !hourly) throw new HttpError(400, b.pay_type === 'ral' ? 'Indica la RAL.' : 'Indica la paga oraria.');
    const id = Number(db.prepare(`INSERT INTO compensations (employee_id, effective_from, pay_type, ral_cents, hourly_e4, superminimo_cents, allowances_cents, benefits, notes, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.id, from, b.pay_type, ral, hourly, sup, allow, text(b.benefits), text(b.notes), now(), actor(req)).lastInsertRowid);
    audit(req, 'compensation.added', { entity: 'employee', entityId: e.id, after: { effective_from: from } }); // niente importi nel registro
    return { success: true, id, proposal: hourlyCostProposal(e.id) };
  });

  // ── Dati personali (personale) ───────────────────────────────────────────────
  const PERSONAL_FIELDS = ['fiscal_code', 'birth_date', 'birth_place', 'sex', 'citizenship', 'residence_address', 'residence_postal_code', 'residence_city', 'residence_province',
    'domicile', 'personal_email', 'personal_phone', 'iban', 'size_shirt', 'size_pants', 'size_shoes'];
  function personal(employeeId) {
    return {
      data: db.prepare('SELECT * FROM employee_personal WHERE employee_id = ?').get(employeeId) || null,
      emergency_contacts: db.prepare('SELECT * FROM emergency_contacts WHERE employee_id = ? ORDER BY sort_order, id').all(employeeId),
      identity_documents: db.prepare('SELECT * FROM identity_documents WHERE employee_id = ? ORDER BY expires_on IS NULL, expires_on').all(employeeId),
    };
  }
  function validatePersonal(b) {
    const f = {};
    for (const k of PERSONAL_FIELDS) if (b[k] !== undefined) f[k] = text(b[k]);
    if (f.fiscal_code) {
      f.fiscal_code = f.fiscal_code.toUpperCase().replace(/\s/g, '');
      // Anche omocodico: in caso di omonimia l'Agenzia sostituisce alcune cifre con lettere (0→L … 9→V).
      if (!/^[A-Z]{6}[0-9LMNP-V]{2}[ABCDEHLMPRST][0-9LMNP-V]{2}[A-Z][0-9LMNP-V]{3}[A-Z]$/.test(f.fiscal_code) && !/^\d{11}$/.test(f.fiscal_code)) throw new HttpError(400, 'Codice fiscale non valido.');
    }
    if (f.iban) {
      f.iban = f.iban.toUpperCase().replace(/\s/g, '');
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(f.iban)) throw new HttpError(400, 'IBAN non valido.');
    }
    if (f.sex && !['F', 'M', 'X'].includes(f.sex)) throw new HttpError(400, 'Sesso: F, M oppure X.');
    checkDate(f.birth_date, 'Data di nascita');
    if (f.personal_email) f.personal_email = f.personal_email.toLowerCase();
    return f;
  }
  function savePersonal(employeeId, f, contacts) {
    events.transaction(() => {
      const existing = db.prepare('SELECT employee_id FROM employee_personal WHERE employee_id = ?').get(employeeId);
      if (!existing) db.prepare('INSERT INTO employee_personal (employee_id, updated_at) VALUES (?, ?)').run(employeeId, now());
      const keys = Object.keys(f);
      if (keys.length) db.prepare(`UPDATE employee_personal SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE employee_id = ?`).run(...keys.map(k => f[k]), now(), employeeId);
      if (Array.isArray(contacts)) {
        db.prepare('DELETE FROM emergency_contacts WHERE employee_id = ?').run(employeeId);
        const ins = db.prepare('INSERT INTO emergency_contacts (employee_id, name, relationship, phone, sort_order) VALUES (?, ?, ?, ?, ?)');
        contacts.forEach((c, i) => {
          if (!text(c.name) && !text(c.phone)) return;
          if (!text(c.name) || !text(c.phone)) throw new HttpError(400, 'Ogni contatto di emergenza ha nome e telefono.');
          ins.run(employeeId, text(c.name), text(c.relationship), text(c.phone), i);
        });
      }
    });
  }
  r.put('/employees/:id/personal', req => {
    const e = employee(req.params.id);
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello di accesso "personale" per questi dati.');
    const f = validatePersonal(req.body || {});
    savePersonal(e.id, f, req.body?.emergency_contacts);
    audit(req, 'employee.personal_updated', { entity: 'employee', entityId: e.id, after: { fields: Object.keys(f), emergency_contacts: Array.isArray(req.body?.emergency_contacts) } });
    return { success: true };
  });

  // Documenti d'identità e permessi di soggiorno (con scadenza nello scadenzario).
  function idDocInput(b) {
    if (!ID_DOC_TYPES[b.doc_type]) throw new HttpError(400, 'Tipo di documento non valido.');
    const f = { doc_type: b.doc_type, number: text(b.number), permit_type: b.doc_type === 'permesso_soggiorno' ? text(b.permit_type) : null,
      issued_on: checkDate(b.issued_on, 'Rilascio'), expires_on: checkDate(b.expires_on, 'Scadenza'), notes: text(b.notes) };
    if (b.doc_type === 'permesso_soggiorno' && !f.expires_on) throw new HttpError(400, 'Per il permesso di soggiorno la scadenza è obbligatoria.');
    return f;
  }
  r.post('/employees/:id/identity-documents', req => {
    const e = employee(req.params.id);
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello di accesso "personale" per questi dati.');
    const f = idDocInput(req.body || {});
    const id = Number(db.prepare('INSERT INTO identity_documents (employee_id, doc_type, number, permit_type, issued_on, expires_on, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.id, f.doc_type, f.number, f.permit_type, f.issued_on, f.expires_on, f.notes, now()).lastInsertRowid);
    audit(req, 'identity_document.added', { entity: 'employee', entityId: e.id, after: { doc_type: f.doc_type, expires_on: f.expires_on } });
    return { success: true, id };
  });
  r.delete('/identity-documents/:id', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello di accesso "personale" per questi dati.');
    const d = db.prepare('SELECT * FROM identity_documents WHERE id = ?').get(req.params.id);
    if (!d) throw new HttpError(404, 'Documento non trovato.');
    db.prepare('DELETE FROM identity_documents WHERE id = ?').run(d.id);
    audit(req, 'identity_document.deleted', { entity: 'employee', entityId: d.employee_id, before: { doc_type: d.doc_type, expires_on: d.expires_on } });
    return { success: true };
  });

  // ── Competenze, titoli, lingue ───────────────────────────────────────────────
  // Per le lingue "name" è il codice (it, en, de, fr, es…): serve all'Enoturismo per le visite.
  const skills = employeeId => db.prepare('SELECT * FROM employee_skills WHERE employee_id = ? ORDER BY kind, name').all(employeeId);
  r.post('/employees/:id/skills', req => {
    const e = employee(req.params.id);
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello di accesso "personale" per questi dati.');
    const b = req.body || {};
    if (!SKILL_KINDS.includes(b.kind)) throw new HttpError(400, 'Tipo di competenza non valido.');
    const name = b.kind === 'lingua' ? text(b.name)?.toLowerCase() : text(b.name);
    if (!name) throw new HttpError(400, b.kind === 'lingua' ? 'Scegli la lingua.' : 'Indica il nome.');
    if (b.kind === 'lingua' && !/^[a-z]{2}$/.test(name)) throw new HttpError(400, 'Lingua: codice di due lettere (it, en, de…).');
    if (b.kind === 'lingua' && db.prepare("SELECT 1 FROM employee_skills WHERE employee_id = ? AND kind = 'lingua' AND name = ?").get(e.id, name)) throw new HttpError(409, 'Lingua già inserita.');
    const id = Number(db.prepare('INSERT INTO employee_skills (employee_id, kind, name, level, issued_on, expires_on, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.id, b.kind, name, text(b.level), checkDate(b.issued_on, 'Conseguimento'), checkDate(b.expires_on, 'Scadenza'), text(b.notes), now()).lastInsertRowid);
    audit(req, 'skill.added', { entity: 'employee', entityId: e.id, after: { kind: b.kind, name } });
    return { success: true, id };
  });
  r.delete('/skills/:id', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello di accesso "personale" per questi dati.');
    const s = db.prepare('SELECT * FROM employee_skills WHERE id = ?').get(req.params.id);
    if (!s) throw new HttpError(404, 'Voce non trovata.');
    db.prepare('DELETE FROM employee_skills WHERE id = ?').run(s.id);
    audit(req, 'skill.deleted', { entity: 'employee', entityId: s.employee_id, before: { kind: s.kind, name: s.name } });
    return { success: true };
  });
  // Lingue parlate (per l'assegnazione delle visite in Enoturismo).
  const languagesOf = employeeId => db.prepare("SELECT name FROM employee_skills WHERE employee_id = ? AND kind = 'lingua'").all(employeeId).map(x => x.name);

  // ── Documenti HR cifrati ─────────────────────────────────────────────────────
  const docType = code => {
    const t = db.prepare('SELECT * FROM hr_document_types WHERE code = ?').get(code);
    if (!t) throw new HttpError(400, 'Tipo di documento non valido.');
    return t;
  };
  // Caricare ed eliminare documenti del fascicolo è compito dell'ufficio del personale: serve il livello
  // "personale" e, in più, quello del tipo di documento (es. "sanitario" per l'idoneità).
  const canManageDocType = (req, level) => hasAccessLevel(req, 'personale') && hasAccessLevel(req, level);
  r.get('/document-types', () => db.prepare('SELECT * FROM hr_document_types ORDER BY name').all());
  // Elenco dei documenti di un dipendente che chi chiede può vedere (per livello del tipo).
  function documentsFor(req, e) {
    const rows = db.prepare(`SELECT d.*, t.name AS type_name, t.level, t.employee_visible FROM hr_documents d JOIN hr_document_types t ON t.code = d.type_code
      WHERE d.employee_id = ? ORDER BY d.uploaded_at DESC`).all(e.id);
    const superseded = new Set(rows.map(r2 => r2.supersedes_id).filter(Boolean));
    return rows
      .filter(d => canSee(req, e, d.level) && (!isSelf(req, e) || hasAccessLevel(req, d.level) || d.employee_visible))
      .map(d => ({ ...d, storage_key: undefined, current: !superseded.has(d.id), download_url: signer.signUrl(`/api/admin/hr/documents/${d.id}/download`, req.portalSession.id, 600) }));
  }
  function storeDocument(req, { employeeId, type, file, title, docDate, validUntil, supersedesId }) {
    if (!file) throw new HttpError(400, 'Carica un file.');
    const t = docType(type);
    let version = 1;
    if (supersedesId) {
      const prev = db.prepare('SELECT * FROM hr_documents WHERE id = ?').get(supersedesId);
      if (!prev || prev.employee_id !== employeeId || prev.type_code !== t.code) throw new HttpError(400, 'La versione precedente indicata non corrisponde.');
      version = prev.version + 1;
    }
    const saved = secureStore.save(file.buffer);
    const deleteAfter = addDays(today(), Math.round(t.retention_years * 365.25));
    try {
      return Number(db.prepare(`INSERT INTO hr_documents (employee_id, type_code, title, storage_key, original_name, mime, size_bytes, sha256, version, supersedes_id, doc_date, valid_until, delete_after, uploaded_at, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(employeeId, t.code, text(title) || file.originalname, saved.storageKey, file.originalname, file.mimetype || null, saved.size, saved.sha256,
        version, supersedesId || null, checkDate(docDate, 'Data del documento'), checkDate(validUntil, 'Scadenza'), deleteAfter, now(), actor(req)).lastInsertRowid);
    } catch (e) {
      secureStore.remove(saved.storageKey);
      throw e;
    }
  }
  r.post('/employees/:id/documents', upload.single('file'), req => {
    const e = employee(req.params.id);
    const t = docType(req.body?.type_code);
    if (!canManageDocType(req, t.level)) throw new HttpError(403, `Per caricare "${t.name}" servono i livelli "personale"${t.level === 'personale' || t.level === 'base' ? '' : ` e "${t.level}"`}.`);
    const id = storeDocument(req, { employeeId: e.id, type: t.code, file: req.file, title: req.body.title, docDate: req.body.doc_date, validUntil: req.body.valid_until, supersedesId: intOrNull(req.body.supersedes_id) });
    audit(req, 'hr_document.uploaded', { entity: 'employee', entityId: e.id, after: { document_id: id, type: t.code } });
    return { success: true, id };
  });
  // Download: risposta binaria, quindi route diretta (non il router JSON). Si apre da un link firmato.
  app.get('/api/admin/hr/documents/:id/download', authAdmin, (req, res) => downloadDocument(req, res));
  function downloadDocument(req, res) {
    try {
      const d = db.prepare('SELECT d.*, t.level, t.employee_visible FROM hr_documents d JOIN hr_document_types t ON t.code = d.type_code WHERE d.id = ?').get(req.params.id);
      if (!d) throw new HttpError(404, 'Documento non trovato.');
      const e = d.employee_id ? employee(d.employee_id) : null;
      // Senza il workspace People si scaricano solo i propri documenti visibili al dipendente (self-service):
      // né i documenti dei colleghi, neppure quelli di livello «base», né quelli dei livelli del ruolo.
      const allowed = !hasWorkspace(req, 'people')
        ? !!e && isSelf(req, e) && !!d.employee_visible && d.level !== 'disciplinare'
        : e ? canSee(req, e, d.level) && (!isSelf(req, e) || hasAccessLevel(req, d.level) || d.employee_visible) : hasAccessLevel(req, d.level);
      if (!allowed) throw new HttpError(403, 'Non puoi aprire questo documento.');
      if (d.level === 'sanitario') logSensitive(req, e, `download documento ${d.id} (${d.type_code})`);
      const buf = secureStore.read(d.storage_key);
      res.setHeader('Content-Type', d.mime || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(d.original_name)}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buf);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Errore interno.' });
      if (!e.status) console.error(e);
    }
  }
  r.delete('/documents/:id', req => {
    const d = db.prepare('SELECT d.*, t.level FROM hr_documents d JOIN hr_document_types t ON t.code = d.type_code WHERE d.id = ?').get(req.params.id);
    if (!d) throw new HttpError(404, 'Documento non trovato.');
    if (!canManageDocType(req, d.level)) throw new HttpError(403, 'Non puoi eliminare questo documento.');
    events.transaction(() => {
      db.prepare('UPDATE hr_documents SET supersedes_id = NULL WHERE supersedes_id = ?').run(d.id);
      db.prepare('DELETE FROM hr_documents WHERE id = ?').run(d.id);
    });
    secureStore.remove(d.storage_key);
    audit(req, 'hr_document.deleted', { entity: 'employee', entityId: d.employee_id, before: { document_id: d.id, type: d.type_code, title: d.title } });
    return { success: true };
  });

  // ── Scadenzario HR ───────────────────────────────────────────────────────────
  // Ogni fonte restituisce voci { employee_id, kind, label, due_date, ref, blocking }.
  // Il fascicolo registra le sue; sicurezza (formazione, visite, DPI) aggiunge le sue.
  const deadlineSources = [];
  function registerDeadlineSource(fn) { deadlineSources.push(fn); }
  registerDeadlineSource(() => db.prepare(`SELECT d.id, d.employee_id, d.doc_type, d.expires_on FROM identity_documents d JOIN employees e ON e.id = d.employee_id
    WHERE e.active = 1 AND d.expires_on IS NOT NULL`).all().map(d => ({
    employee_id: d.employee_id, kind: d.doc_type === 'permesso_soggiorno' ? 'permesso_soggiorno' : 'documento_identita',
    label: ID_DOC_TYPES[d.doc_type], due_date: d.expires_on, ref: `identity:${d.id}`, blocking: d.doc_type === 'permesso_soggiorno',
  })));
  registerDeadlineSource(() => {
    const out = [];
    for (const e of db.prepare('SELECT id FROM employees WHERE active = 1').all()) {
      const c = db.prepare('SELECT * FROM employment_contracts WHERE employee_id = ? ORDER BY version DESC LIMIT 1').get(e.id);
      if (!c || c.termination_date) continue;
      if (c.end_date) out.push({ employee_id: e.id, kind: 'contratto_termine', label: `Fine contratto ${c.contract_type}`, due_date: c.end_date, ref: `contract:${c.id}:end`, blocking: true });
      if (c.probation_end) out.push({ employee_id: e.id, kind: 'periodo_prova', label: 'Fine periodo di prova', due_date: c.probation_end, ref: `contract:${c.id}:probation`, blocking: false });
    }
    return out;
  });
  registerDeadlineSource(() => {
    const rows = db.prepare(`SELECT d.id, d.employee_id, d.title, d.valid_until, d.supersedes_id FROM hr_documents d JOIN employees e ON e.id = d.employee_id
      WHERE e.active = 1 AND d.valid_until IS NOT NULL`).all();
    const superseded = new Set(db.prepare('SELECT supersedes_id FROM hr_documents WHERE supersedes_id IS NOT NULL').all().map(x => x.supersedes_id));
    return rows.filter(d => !superseded.has(d.id)).map(d => ({ employee_id: d.employee_id, kind: 'documento_hr', label: d.title, due_date: d.valid_until, ref: `hrdoc:${d.id}`, blocking: false }));
  });

  function deadlines({ within = 90, employeeId = null, siteId = null, teamId = null, managerId = null, kind = null } = {}) {
    const t = today();
    const people = new Map(db.prepare(`SELECT e.id, e.first_name, e.last_name, e.site_id, e.manager_id, s.name AS site_name FROM employees e LEFT JOIN sites s ON s.id = e.site_id`).all().map(e => [e.id, e]));
    const team = teamId ? new Set(db.prepare('SELECT employee_id FROM team_members WHERE team_id = ?').all(teamId).map(x => x.employee_id)) : null;
    const thresholds = settings().deadline_thresholds;
    return deadlineSources.flatMap(fn => fn())
      .filter(d => (!employeeId || d.employee_id === Number(employeeId)) && (!kind || d.kind === kind))
      .map(d => {
        const e = people.get(d.employee_id);
        const daysLeft = daysBetween(t, d.due_date);
        const bucket = daysLeft < 0 ? 'scaduto' : [...thresholds].sort((a, b) => a - b).find(x => daysLeft <= x) ?? null;
        return { ...d, employee_name: e ? fullName(e) : '?', site_id: e?.site_id ?? null, site_name: e?.site_name ?? null, manager_id: e?.manager_id ?? null, days_left: daysLeft, bucket };
      })
      .filter(d => d.days_left <= within && (!siteId || d.site_id === Number(siteId)) && (!managerId || d.manager_id === Number(managerId)) && (!team || team.has(d.employee_id)))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }
  r.get('/deadlines', req => {
    const visible = visibleEmployeeIds(req);
    return deadlines({ within: parseInt(req.query.within) || 90, employeeId: req.query.employee_id, siteId: req.query.site_id, teamId: req.query.team_id, managerId: req.query.manager_id, kind: req.query.kind || null })
      .filter(d => !visible || visible.has(d.employee_id));
  });

  // Problemi bloccanti di un dipendente a una data (usati dall'inserimento ore, Fase 2.1):
  // permesso di soggiorno scaduto, contratto a termine finito. La sicurezza aggiunge i suoi.
  const blockingChecks = [];
  function registerBlockingCheck(fn) { blockingChecks.push(fn); }
  registerBlockingCheck((employeeId, date) => {
    const out = [];
    const permit = db.prepare("SELECT MAX(expires_on) AS e FROM identity_documents WHERE employee_id = ? AND doc_type = 'permesso_soggiorno'").get(employeeId).e;
    if (permit && permit < date) out.push(`permesso di soggiorno scaduto il ${permit}`);
    const c = contractAt(employeeId, date);
    if (c?.termination_date && c.termination_date < date) out.push(`rapporto cessato il ${c.termination_date}`);
    else if (c?.end_date && c.end_date < date) out.push(`contratto a termine finito il ${c.end_date}`);
    return out;
  });
  const blockingIssues = (employeeId, date) => blockingChecks.flatMap(fn => fn(employeeId, date));

  // Job quotidiano: notifiche alle soglie di preavviso (una volta per voce e soglia) a HR,
  // al responsabile e al dipendente (se hanno accesso al portale).
  function hrRecipients() {
    const roles = db.prepare('SELECT id, workspaces FROM roles').all().filter(ro => { try { return JSON.parse(ro.workspaces).includes('people'); } catch { return false; } }).map(ro => ro.id);
    const users = roles.length ? db.prepare(`SELECT id FROM portal_users WHERE active = 1 AND role_id IN (${roles.map(() => '?').join(',')})`).all(...roles).map(u => u.id) : [];
    return [null, ...users];
  }
  function notifyDeadlines() {
    let sent = 0;
    const hrUsers = hrRecipients();
    for (const d of deadlines({ within: Math.max(...settings().deadline_thresholds) })) {
      if (d.bucket == null) continue;
      const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(d.employee_id);
      const approver = hr.resolveApprover(d.employee_id)?.approver;
      const managerUser = approver ? db.prepare('SELECT portal_user_id FROM employees WHERE id = ?').get(approver.id)?.portal_user_id : null;
      const recipients = new Set([...hrUsers, managerUser, emp?.portal_user_id].filter(x => x !== undefined));
      const expired = d.bucket === 'scaduto';
      for (const userId of recipients) {
        if (userId === undefined) continue;
        const id = notifications.notify({
          userId, kind: `hr.deadline.${d.kind}`,
          title: `${d.employee_name}: ${d.label} ${d.missing ? 'mancante' : expired ? 'scaduto' : `scade tra ${d.days_left} ${d.days_left === 1 ? 'giorno' : 'giorni'}`}`,
          body: `${d.missing ? 'Richiesto dal' : expired ? 'Scaduto il' : 'Scadenza:'} ${d.due_date.split('-').reverse().join('/')}${d.blocking && expired ? ' · blocca l\'inserimento delle ore' : ''}`,
          link: `/portal.html?workspace=people&employee=${d.employee_id}&tab=scadenze`, dedupeKey: `${d.ref}:${d.bucket}`,
        });
        if (id) sent++;
      }
    }
    return sent;
  }
  scheduler.register('hr.deadlines', 24 * 60, () => `${notifyDeadlines()} notifiche inviate`);

  // Conservazione: segnala ad HR i documenti oltre il periodo di conservazione (la cancellazione resta manuale).
  function flagRetention() {
    const due = db.prepare(`SELECT d.id, d.employee_id, d.title, d.delete_after, e.first_name, e.last_name FROM hr_documents d LEFT JOIN employees e ON e.id = d.employee_id WHERE d.delete_after <= ?`).all(today());
    for (const d of due) notifications.notify({ userId: null, kind: 'hr.retention', title: `Conservazione scaduta: ${d.title}`, body: `${d.first_name ? `${d.first_name} ${d.last_name} · ` : ''}da valutare la cancellazione (oltre il ${d.delete_after.split('-').reverse().join('/')})`, link: `/portal.html?workspace=people${d.employee_id ? `&employee=${d.employee_id}&tab=documenti` : ''}`, dedupeKey: `retention:${d.id}` });
    return `${due.length} documenti oltre la conservazione`;
  }
  scheduler.register('hr.retention', 24 * 60, flagRetention);

  // ── Fascicolo completo di un dipendente (solo ciò che chi chiede può vedere) ──
  function file(req, e) {
    const out = {
      employee: db.prepare(`SELECT e.*, s.name AS site_name, c.code AS cost_center_code, c.name AS cost_center_name FROM employees e LEFT JOIN sites s ON s.id = e.site_id
        LEFT JOIN cost_centers c ON c.id = e.cost_center_id WHERE e.id = ?`).get(e.id),
      access: {
        personale: canSee(req, e, 'personale'), retributivo: canSee(req, e, 'retributivo'), sanitario: canSee(req, e, 'sanitario'), self: isSelf(req, e),
        // Il dipendente vede i propri dati ma non li modifica (le richieste di modifica arrivano col self-service).
        edit: { personale: hasAccessLevel(req, 'personale'), retributivo: hasAccessLevel(req, 'retributivo') },
        upload_types: db.prepare('SELECT code, level FROM hr_document_types').all().filter(t => canManageDocType(req, t.level)).map(t => t.code),
      },
      current_contract: null, manager_view: isManagerOf(req, e),
    };
    // Scadenze e blocchi: a chi ha il livello "personale", al dipendente e al suo responsabile.
    const seeDeadlines = canSee(req, e, 'personale') || out.manager_view;
    Object.assign(out, { deadlines: seeDeadlines ? deadlines({ within: 365, employeeId: e.id }) : [], blocking_today: seeDeadlines ? blockingIssues(e.id, today()) : [] });
    const c = contractAt(e.id);
    if (c) out.current_contract = { contract_type: c.contract_type, job_role: c.job_role_id ? db.prepare('SELECT name FROM job_roles WHERE id = ?').get(c.job_role_id)?.name : null, end_date: c.end_date };
    if (out.access.personale) {
      Object.assign(out, { personal: personal(e.id), contracts: contracts(e.id), skills: skills(e.id) });
    }
    if (out.access.retributivo) out.compensation = { items: compensations(e.id), proposal: hourlyCostProposal(e.id) };
    out.documents = documentsFor(req, e);
    return out;
  }
  r.get('/employees/:id/file', req => file(req, employee(req.params.id)));

  r.get('/sensitive-access-log', req => {
    if (!hasAccessLevel(req, 'sanitario')) throw new HttpError(403, 'Serve il livello "sanitario".');
    return db.prepare(`SELECT l.*, e.first_name || ' ' || e.last_name AS employee_name FROM sensitive_access_log l LEFT JOIN employees e ON e.id = l.employee_id
      ${req.query.employee_id ? 'WHERE l.employee_id = ?' : ''} ORDER BY l.id DESC LIMIT 500`).all(...(req.query.employee_id ? [req.query.employee_id] : []));
  });

  return { file, deadlines, notifyDeadlines, hrRecipients, isManagerOf, viewerEmployee, visibleEmployeeIds, actor, registerDeadlineSource, registerBlockingCheck, blockingIssues, contractAt, languagesOf, canSee, isSelf, logSensitive, storeDocument, documentsFor, personal, validatePersonal, savePersonal, skills, settings };
};
