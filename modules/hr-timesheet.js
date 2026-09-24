// People — Fase 2, blocco 2D: presenze (timesheet).
//   - righe: dipendente, giorno, inizio-fine (a passi configurabili 15/30/60 min), tipo d'ora, origine,
//     ripartizione su centri (foglie attive) e oggetti di costo; niente sovrapposizioni;
//   - inserimento a squadra dal caposquadra; righe proposte da prenotazioni e fiere (sempre da confermare);
//   - controlli bloccanti: permesso/contratto scaduti, non idoneità, abilitazione richiesta dall'operazione;
//   - mese per dipendente: aperto → inviato → approvato (chiuso); dopo, solo rettifiche tracciate;
//   - assenze valide → righe "assenza" nella stessa transazione (ganci del modulo assenze), con conflitti;
//   - export CSV per il consulente del lavoro; ore approvate → driver "Ore lavorate" di Finance.
const crypto = require('crypto');
const { HttpError, createRouter } = require('../lib/http');
const { DATE, PERIOD, addDays, weekday } = require('../lib/calendar');

const HOUR_TYPES = { ordinaria: 'Ordinaria', straordinaria: 'Straordinaria', notturna: 'Notturna', festiva: 'Festiva' };
const EXPORT_COLUMNS = {
  codice_fiscale: 'Codice fiscale', cognome: 'Cognome', nome: 'Nome', tipo_contratto: 'Tipo contratto', data: 'Data', giornata_lavorata: 'Giornata lavorata',
  ore_ordinarie: 'Ore ordinarie', ore_straordinarie: 'Ore straordinarie', ore_notturne: 'Ore notturne', ore_festive: 'Ore festive',
  assenza: 'Assenza', ore_assenza: 'Ore assenza', centri: 'Centri di costo',
};
const DEFAULT_EXPORT = ['codice_fiscale', 'cognome', 'nome', 'tipo_contratto', 'data', 'giornata_lavorata', 'ore_ordinarie', 'ore_straordinarie', 'ore_notturne', 'ore_festive', 'assenza', 'ore_assenza'];
const DEFAULT_DAY_MINUTES = 480;
const MIDDAY = 13 * 60;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const text = v => (v == null ? null : String(v).trim() || null);
const intOrNull = v => (v === '' || v == null ? null : parseInt(v));
const itDate = d => d.split('-').reverse().join('/');
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const periodOf = d => d.slice(0, 7);
const lastDay = p => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const monthLabel = p => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const hours = m => (m / 60).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const uniq = list => [...new Set(list)];
// Un centro è una foglia se non ha sotto-centri (come in Finance).
const LEAF_SQL = 'NOT EXISTS (SELECT 1 FROM cost_centers ch WHERE ch.parent_id = c.id)';
// Nomi confrontati senza maiuscole, accenti e spazi doppi.
const normName = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

module.exports = function registerHrTimesheet(app, deps) {
  const { db, authAdmin, audit, events, hasAccessLevel, notifications, getSetting, setSetting, hr, hrFile, hrSafety, hrAbsences, finance } = deps;
  const r = createRouter(app, '/api/admin/hr', authAdmin);
  const { actor, isSelf, isManagerOf, viewerEmployee } = hrFile;

  const employee = id => {
    const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!e) throw new HttpError(404, 'Dipendente non trovato.');
    return e;
  };
  const fullName = e => `${e.first_name} ${e.last_name}`;
  const checkDate = (d, label, required = false) => {
    if (d == null || d === '') { if (required) throw new HttpError(400, `Indica ${label}.`); return null; }
    if (!DATE.test(d)) throw new HttpError(400, `${label}: data nel formato AAAA-MM-GG.`);
    return d;
  };
  const checkPeriod = p => { if (!PERIOD.test(p || '')) throw new HttpError(400, 'Mese nel formato AAAA-MM.'); return p; };
  const userOfEmployee = id => (id ? db.prepare('SELECT portal_user_id FROM employees WHERE id = ?').get(id)?.portal_user_id ?? null : null);
  const notifyAll = (userIds, n) => { for (const u of new Set(userIds.filter(x => x !== undefined))) notifications.notify({ userId: u, ...n }); };
  const managerUsers = e => { const a = hr.resolveApprover(e.id)?.approver; const u = userOfEmployee(a?.id); return u ? [u] : hrFile.hrRecipients(); };
  const LINK = '/portal.html?workspace=people&sub=people-presenze';

  // ── Impostazioni ────────────────────────────────────────────────────────────
  function tsSettings() {
    const g = parseInt(getSetting('timesheet_granularity', '60'));
    let cols = null;
    try { cols = JSON.parse(getSetting('timesheet_export_columns', 'null')); } catch {}
    return {
      granularity: [15, 30, 60].includes(g) ? g : 60,
      booking_center: getSetting('timesheet_booking_center', 'C05'), event_center: getSetting('timesheet_event_center', 'C06'), fair_center: getSetting('timesheet_fair_center', 'C08'),
      export_columns: Array.isArray(cols) && cols.filter(c => EXPORT_COLUMNS[c]).length ? cols.filter(c => EXPORT_COLUMNS[c]) : DEFAULT_EXPORT,
    };
  }
  r.get('/timesheet/settings', () => ({ ...tsSettings(), available_columns: EXPORT_COLUMNS }));
  r.put('/timesheet/settings', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello "personale".');
    const b = req.body || {};
    if (b.granularity !== undefined) {
      if (![15, 30, 60].includes(Number(b.granularity))) throw new HttpError(400, 'Passo: 15, 30 o 60 minuti.');
      setSetting('timesheet_granularity', String(Number(b.granularity)));
    }
    for (const k of ['booking_center', 'event_center', 'fair_center']) {
      if (b[k] === undefined) continue;
      const c = db.prepare('SELECT c.* FROM cost_centers c WHERE c.code = ? AND '+LEAF_SQL).get(String(b[k]).trim());
      if (!c) throw new HttpError(400, `Centro «${b[k]}» non trovato o non è una foglia.`);
      setSetting(`timesheet_${k}`, c.code);
    }
    if (b.export_columns !== undefined) {
      const cols = (Array.isArray(b.export_columns) ? b.export_columns : []).filter(c => EXPORT_COLUMNS[c]);
      if (!cols.length) throw new HttpError(400, 'Scegli almeno una colonna.');
      setSetting('timesheet_export_columns', JSON.stringify(cols));
    }
    audit(req, 'timesheet_settings.updated', { entity: 'hr_settings', after: tsSettings() });
    return tsSettings();
  });
  // Centri (foglie attive) e oggetti di costo aperti da scegliere nelle righe: servono a chi inserisce ore.
  // Squadre: tutte per l'ufficio del personale, altrimenti quelle di cui si è caposquadra.
  r.get('/timesheet/options', req => {
    const me = viewerEmployee(req);
    const all = hasAccessLevel(req, 'personale');
    const teams = db.prepare('SELECT id, name, leader_employee_id FROM teams WHERE active = 1 ORDER BY name').all()
      .filter(t => all || (me && t.leader_employee_id === me.id))
      .map(t => ({ ...t, members: db.prepare(`SELECT e.id, e.first_name || ' ' || e.last_name AS name FROM team_members m JOIN employees e ON e.id = m.employee_id
        WHERE m.team_id = ? AND e.active = 1 ORDER BY e.last_name, e.first_name`).all(t.id) }));
    return {
      centers: db.prepare(`SELECT c.id, c.code, c.name, c.cascade_level FROM cost_centers c WHERE c.active = 1 AND ${LEAF_SQL} ORDER BY c.code`).all(),
      objects: db.prepare("SELECT id, type, code, name FROM cost_objects WHERE status = 'aperto' ORDER BY type, code").all(),
      hour_types: HOUR_TYPES, granularity: tsSettings().granularity, teams, me: me ? { id: me.id, name: fullName(me) } : null, hr: all,
    };
  });

  // ── Mese ────────────────────────────────────────────────────────────────────
  const monthRow = (employeeId, period) => db.prepare('SELECT * FROM timesheet_months WHERE employee_id = ? AND period = ?').get(employeeId, period) || null;
  const monthStatus = (employeeId, period) => monthRow(employeeId, period)?.status || 'aperto';
  const ensureMonth = (employeeId, period) => { db.prepare('INSERT OR IGNORE INTO timesheet_months (employee_id, period) VALUES (?, ?)').run(employeeId, period); return monthRow(employeeId, period); };
  const canEditFor = (req, e) => hasAccessLevel(req, 'personale') || isSelf(req, e) || isManagerOf(req, e);
  function canApproveMonth(req, e, m = monthRow(e.id, null)) {
    if (req.isMasterKey) return true;
    const me = viewerEmployee(req);
    if (me && me.id === e.id) return false; // mai il proprio mese
    if (hasAccessLevel(req, 'personale')) return true;
    return !!me && (m?.approver_employee_id === me.id || isManagerOf(req, e, me));
  }
  function assertWritable(req, e, date) {
    const p = periodOf(date);
    const m = monthRow(e.id, p);
    if (m?.status === 'approvato') throw new HttpError(409, `Il mese di ${monthLabel(p)} di ${fullName(e)} è approvato: le correzioni si fanno con una rettifica.`);
    if (m?.status === 'inviato' && !canApproveMonth(req, e, m)) throw new HttpError(409, `Il mese di ${monthLabel(p)} di ${fullName(e)} è in approvazione: può correggerlo solo chi lo approva.`);
  }

  // ── Righe: validazione ──────────────────────────────────────────────────────
  const dayRows = (employeeId, date) => db.prepare('SELECT * FROM timesheet_entries WHERE employee_id = ? AND work_date = ? AND voided_by_adjustment_id IS NULL ORDER BY start_time').all(employeeId, date);
  const scheduledMinutes = (e, date) => {
    const s = hr.currentSchedule(e.id, date);
    return s ? s.days[weekday(date)] || 0 : weekday(date) <= 5 ? DEFAULT_DAY_MINUTES : 0;
  };
  function entryInput(e, b) {
    const g = tsSettings().granularity;
    const f = { work_date: checkDate(b.work_date, 'la data', true), start_time: text(b.start_time), end_time: text(b.end_time), hour_type: b.hour_type || 'ordinaria', note: text(b.note) };
    if (!TIME.test(f.start_time || '') || !TIME.test(f.end_time || '')) throw new HttpError(400, 'Indica inizio e fine (HH:MM).');
    const start = toMin(f.start_time), end = toMin(f.end_time);
    if (end <= start) throw new HttpError(400, 'La fine è prima dell\'inizio: un turno che passa la mezzanotte va diviso su due giorni.');
    if (start % g || end % g) throw new HttpError(400, `Gli orari vanno a passi di ${g} minuti.`);
    if (!HOUR_TYPES[f.hour_type]) throw new HttpError(400, 'Tipo d\'ora: ordinaria, straordinaria, notturna o festiva.');
    f.minutes = end - start;
    const raw = Array.isArray(b.allocations) && b.allocations.length ? b.allocations
      : [{ cost_center_id: b.cost_center_id || e.cost_center_id, cost_object_id: b.cost_object_id, minutes: f.minutes }];
    f.allocations = raw.map(a => {
      const minutes = a.minutes != null && a.minutes !== '' ? parseInt(a.minutes) : a.hours != null ? Math.round(Number(String(a.hours).replace(',', '.')) * 60) : f.minutes;
      const centerId = intOrNull(a.cost_center_id);
      if (!centerId) throw new HttpError(400, 'Indica il centro di costo (per il vigneto, la particella).');
      finance.assertImputable(centerId, f.work_date);
      const objectId = intOrNull(a.cost_object_id);
      if (objectId) {
        const o = db.prepare('SELECT * FROM cost_objects WHERE id = ?').get(objectId);
        if (!o) throw new HttpError(400, 'Oggetto di costo non trovato.');
        if (o.status !== 'aperto') throw new HttpError(400, `L'oggetto di costo «${o.code} ${o.name}» è chiuso.`);
      }
      if (!(minutes > 0) || minutes % g) throw new HttpError(400, `Ogni quota della ripartizione va a passi di ${g} minuti.`);
      return { cost_center_id: centerId, cost_object_id: objectId, minutes };
    });
    const sum = f.allocations.reduce((s, a) => s + a.minutes, 0);
    if (sum !== f.minutes) throw new HttpError(400, `La ripartizione (${hours(sum)} h) non corrisponde alla durata del blocco (${hours(f.minutes)} h).`);
    return f;
  }
  // Sovrapposizioni con altre ore e con le assenze del giorno; avviso se si supera l'orario.
  function absenceBlocks(a, start, end) {
    if (a.part === 'giorno') return true;
    if (a.part === 'ore') return toMin(a.start_time) < end && toMin(a.end_time) > start;
    return a.part === 'mattina' ? start < MIDDAY : end > MIDDAY;
  }
  function clashCheck(e, f, exclude = new Set()) {
    const rows = dayRows(e.id, f.work_date).filter(x => !exclude.has(x.id));
    const start = toMin(f.start_time), end = toMin(f.end_time);
    const clash = rows.find(x => x.origin !== 'assenza' && toMin(x.start_time) < end && toMin(x.end_time) > start);
    if (clash) throw new HttpError(409, `${fullName(e)} ha già ore registrate il ${itDate(f.work_date)} dalle ${clash.start_time} alle ${clash.end_time}.`);
    for (const row of rows.filter(x => x.origin === 'assenza')) {
      const a = db.prepare('SELECT a.*, t.name AS type_name FROM absences a JOIN absence_types t ON t.id = a.absence_type_id WHERE a.id = ?').get(row.absence_id);
      if (a && absenceBlocks(a, start, end)) throw new HttpError(409, `Il ${itDate(f.work_date)} ${fullName(e)} risulta assente (${a.type_name}): annulla l'assenza o, se il mese è chiuso, registra una rettifica.`);
    }
    const planned = scheduledMinutes(e, f.work_date);
    const total = rows.reduce((s, x) => s + x.minutes, 0) + f.minutes;
    return f.hour_type === 'ordinaria' && total > planned
      ? [`Il ${itDate(f.work_date)} ${fullName(e)} arriva a ${hours(total)} h contro ${hours(planned)} h di orario: se è straordinario, indicalo come tipo d'ora.`] : [];
  }
  // Controlli di sicurezza per ogni operazione della riga (e comunque permesso, contratto, idoneità).
  function safetyCheck(req, e, f) {
    const objs = uniq(f.allocations.map(a => a.cost_object_id).filter(Boolean));
    const checks = (objs.length ? objs : [null]).map(o => hrSafety.assignmentCheck(e.id, { date: f.work_date, costObjectId: o, req }));
    const blocks = uniq(checks.flatMap(c => c.blocks));
    if (blocks.length) throw new HttpError(409, blocks.join(' '), { blocks });
    return uniq(checks.flatMap(c => c.warnings));
  }
  function notifyLimitations(e, warnings, entryId) {
    const hits = warnings.filter(w => w.includes('limitazioni'));
    if (hits.length) notifyAll(managerUsers(e), { kind: 'hr.timesheet.limitations', title: `${fullName(e)}: ore su un'attività incompatibile con le limitazioni`, body: hits.join(' '), link: LINK, dedupeKey: `ts-limit:${entryId}` });
  }
  function insertEntry(req, e, f, extra = {}) {
    const id = Number(db.prepare(`INSERT INTO timesheet_entries (employee_id, work_date, start_time, end_time, minutes, hour_type, origin, team_id, batch_id, source_booking_id, source_fair_id,
      adjustment_id, note, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.id, f.work_date, f.start_time, f.end_time, f.minutes, f.hour_type,
      extra.origin || 'manuale', extra.team_id ?? null, extra.batch_id ?? null, extra.source_booking_id ?? null, extra.source_fair_id ?? null, extra.adjustment_id ?? null, f.note, now(), actor(req), now()).lastInsertRowid);
    const ins = db.prepare('INSERT INTO timesheet_allocations (entry_id, cost_center_id, cost_object_id, minutes) VALUES (?, ?, ?, ?)');
    for (const a of f.allocations) ins.run(id, a.cost_center_id, a.cost_object_id, a.minutes);
    return id;
  }
  const entry = id => {
    const x = db.prepare('SELECT * FROM timesheet_entries WHERE id = ?').get(id);
    if (!x) throw new HttpError(404, 'Riga non trovata.');
    return x;
  };

  // ── Righe: inserimento, modifica, eliminazione ──────────────────────────────
  r.post('/timesheet/entries', req => {
    const b = req.body || {};
    const e = employee(b.employee_id || viewerEmployee(req)?.id || 0);
    if (!canEditFor(req, e)) throw new HttpError(403, 'Puoi registrare ore solo per te o per i tuoi collaboratori.');
    const f = entryInput(e, b);
    assertWritable(req, e, f.work_date);
    const warnings = [...clashCheck(e, f), ...safetyCheck(req, e, f)];
    const id = events.transaction(() => { const eid = insertEntry(req, e, f, { origin: 'manuale' }); notifyLimitations(e, warnings, eid); return eid; });
    audit(req, 'timesheet.entry_added', { entity: 'employee', entityId: e.id, after: { entry_id: id, work_date: f.work_date, minutes: f.minutes } });
    return { success: true, id, warnings };
  });
  r.patch('/timesheet/entries/:id', req => {
    const x = entry(req.params.id);
    if (x.origin === 'assenza') throw new HttpError(409, 'Le righe di assenza si cambiano dall\'assenza.');
    if (x.voided_by_adjustment_id) throw new HttpError(409, 'Riga annullata da una rettifica.');
    const e = employee(x.employee_id);
    if (!canEditFor(req, e)) throw new HttpError(403, 'Non puoi modificare queste ore.');
    assertWritable(req, e, x.work_date);
    const b = req.body || {};
    const current = db.prepare('SELECT cost_center_id, cost_object_id, minutes FROM timesheet_allocations WHERE entry_id = ?').all(x.id);
    const merged = { work_date: x.work_date, start_time: x.start_time, end_time: x.end_time, hour_type: x.hour_type, note: x.note, ...b };
    if (!b.allocations && b.cost_center_id === undefined) {
      if (current.length > 1 && (merged.start_time !== x.start_time || merged.end_time !== x.end_time)) throw new HttpError(400, 'La riga è ripartita su più centri: rifai la ripartizione con i nuovi orari.');
      if (current.length === 1) Object.assign(merged, { cost_center_id: current[0].cost_center_id, cost_object_id: b.cost_object_id !== undefined ? b.cost_object_id : current[0].cost_object_id });
      else merged.allocations = current;
    }
    const f = entryInput(e, merged);
    assertWritable(req, e, f.work_date);
    const warnings = [...clashCheck(e, f, new Set([x.id])), ...safetyCheck(req, e, f)];
    events.transaction(() => {
      db.prepare('UPDATE timesheet_entries SET work_date = ?, start_time = ?, end_time = ?, minutes = ?, hour_type = ?, note = ?, updated_at = ? WHERE id = ?')
        .run(f.work_date, f.start_time, f.end_time, f.minutes, f.hour_type, f.note, now(), x.id);
      db.prepare('DELETE FROM timesheet_allocations WHERE entry_id = ?').run(x.id);
      const ins = db.prepare('INSERT INTO timesheet_allocations (entry_id, cost_center_id, cost_object_id, minutes) VALUES (?, ?, ?, ?)');
      for (const a of f.allocations) ins.run(x.id, a.cost_center_id, a.cost_object_id, a.minutes);
      notifyLimitations(e, warnings, x.id);
    });
    audit(req, 'timesheet.entry_updated', { entity: 'employee', entityId: e.id, before: { entry_id: x.id, work_date: x.work_date, start_time: x.start_time, end_time: x.end_time }, after: { work_date: f.work_date, start_time: f.start_time, end_time: f.end_time } });
    return { success: true, warnings };
  });
  r.delete('/timesheet/entries/:id', req => {
    const x = entry(req.params.id);
    if (x.origin === 'assenza') throw new HttpError(409, 'Le righe di assenza si tolgono annullando l\'assenza.');
    if (x.voided_by_adjustment_id) throw new HttpError(409, 'Riga già annullata da una rettifica.');
    const e = employee(x.employee_id);
    if (!canEditFor(req, e)) throw new HttpError(403, 'Non puoi eliminare queste ore.');
    assertWritable(req, e, x.work_date);
    events.transaction(() => {
      db.prepare('DELETE FROM timesheet_proposal_decisions WHERE entry_id = ?').run(x.id); // la proposta torna disponibile
      db.prepare('DELETE FROM timesheet_entries WHERE id = ?').run(x.id);
    });
    audit(req, 'timesheet.entry_deleted', { entity: 'employee', entityId: e.id, before: { entry_id: x.id, work_date: x.work_date, start_time: x.start_time, end_time: x.end_time } });
    return { success: true };
  });

  // ── Inserimento a squadra ───────────────────────────────────────────────────
  // Il caposquadra registra ore, particella (centro) e operazione per tutti i membri in un colpo solo.
  // Tutto o niente: se per qualcuno c'è un blocco, non si registra nulla e si dice chi e perché.
  r.post('/timesheet/team', req => {
    const b = req.body || {};
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(b.team_id);
    if (!team || !team.active) throw new HttpError(404, 'Squadra non trovata.');
    const members = db.prepare(`SELECT e.* FROM team_members m JOIN employees e ON e.id = m.employee_id WHERE m.team_id = ? AND e.active = 1 ORDER BY e.last_name, e.first_name`).all(team.id);
    const wanted = Array.isArray(b.member_ids) && b.member_ids.length ? new Set(b.member_ids.map(Number)) : null;
    const chosen = members.filter(m => !wanted || wanted.has(m.id));
    if (!chosen.length) throw new HttpError(400, 'Scegli almeno una persona della squadra.');
    const me = viewerEmployee(req);
    const allowed = hasAccessLevel(req, 'personale') || (me && team.leader_employee_id === me.id) || chosen.every(m => isManagerOf(req, m, me));
    if (!allowed) throw new HttpError(403, 'Le ore di squadra le registra il caposquadra (o l\'ufficio del personale).');
    const prepared = [];
    const errors = [];
    for (const m of chosen) {
      try {
        const f = entryInput(m, b);
        assertWritable(req, m, f.work_date);
        const warnings = [...clashCheck(m, f), ...safetyCheck(req, m, f)];
        prepared.push({ m, f, warnings });
      } catch (err) {
        if (!err.status) throw err;
        errors.push({ employee_id: m.id, name: fullName(m), error: err.message });
      }
    }
    if (errors.length) throw new HttpError(409, `Nessuna ora registrata: ${errors.map(x => x.error).join(' ')}`, { members: errors });
    const batch = crypto.randomUUID();
    const ids = events.transaction(() => prepared.map(p => {
      const id = insertEntry(req, p.m, p.f, { origin: 'squadra', team_id: team.id, batch_id: batch });
      notifyLimitations(p.m, p.warnings, id);
      return id;
    }));
    audit(req, 'timesheet.team_entry', { entity: 'team', entityId: team.id, after: { batch, members: chosen.map(m => m.id), work_date: b.work_date } });
    return { success: true, ids, warnings: uniq(prepared.flatMap(p => p.warnings)) };
  });

  // ── Righe proposte (prenotazioni assegnate, fiere di cui si è responsabili) ──
  // Le fiere hanno il responsabile come testo: lo si abbina al dipendente per nome e cognome
  // (in entrambi gli ordini), solo se l'abbinamento è unico.
  function matchEmployeeByName(name) {
    const n = normName(name);
    if (!n) return null;
    const hits = db.prepare('SELECT * FROM employees WHERE active = 1').all().filter(e => [`${e.first_name} ${e.last_name}`, `${e.last_name} ${e.first_name}`].map(normName).includes(n));
    return hits.length === 1 ? hits[0] : null;
  }
  const centerByCode = code => db.prepare('SELECT c.id, c.code, c.name FROM cost_centers c WHERE c.code = ? AND c.active = 1 AND '+LEAF_SQL).get(code) || null;
  function proposals(e, period) {
    const s = tsSettings();
    const g = s.granularity;
    const first = `${period}-01`, last = lastDay(period);
    const decided = new Set(db.prepare('SELECT source, source_id, work_date FROM timesheet_proposal_decisions WHERE employee_id = ?').all(e.id).map(d => `${d.source}:${d.source_id}:${d.work_date}`));
    const used = db.prepare('SELECT source_booking_id, source_fair_id, work_date FROM timesheet_entries WHERE employee_id = ? AND voided_by_adjustment_id IS NULL AND (source_booking_id IS NOT NULL OR source_fair_id IS NOT NULL)').all(e.id);
    for (const u of used) decided.add(u.source_booking_id ? `prenotazione:${u.source_booking_id}:${u.work_date}` : `fiera:${u.source_fair_id}:${u.work_date}`);
    const round = m => Math.min(Math.ceil(m / g) * g, 24 * 60 - g);
    const out = [];
    if (e.portal_user_id) {
      const bookings = db.prepare(`SELECT b.id, s.date, s.time, x.id AS experience_id, x.name_it, x.type, x.duration_minutes FROM bookings b JOIN slots s ON s.id = b.slot_id
        JOIN experiences x ON x.id = b.experience_id JOIN operators o ON o.id = b.operator_id WHERE o.portal_user_id = ? AND b.status = 'confermata' AND s.date BETWEEN ? AND ? ORDER BY s.date, s.time`)
        .all(e.portal_user_id, first, last);
      for (const bk of bookings) {
        if (decided.has(`prenotazione:${bk.id}:${bk.date}`)) continue;
        const start = Math.floor(toMin(bk.time) / g) * g;
        const end = round(toMin(bk.time) + (bk.duration_minutes || 60));
        const center = centerByCode(bk.type === 'evento' ? s.event_center : s.booking_center);
        const object = db.prepare("SELECT id, code, name FROM cost_objects WHERE type = 'esperienza' AND experience_id = ? AND status = 'aperto' ORDER BY id LIMIT 1").get(bk.experience_id);
        out.push({ source: 'prenotazione', source_id: bk.id, work_date: bk.date, start_time: fromMin(start), end_time: fromMin(Math.max(end, start + g)), hour_type: 'ordinaria',
          cost_center_id: center?.id ?? null, cost_center: center ? `${center.code} ${center.name}` : null, cost_object_id: object?.id ?? null, cost_object: object ? `${object.code} ${object.name}` : null,
          label: `${bk.type === 'evento' ? 'Evento' : 'Visita'} «${bk.name_it}» delle ${bk.time}` });
      }
    }
    const fairs = db.prepare('SELECT * FROM fairs WHERE start_date IS NOT NULL AND start_date <= ? AND COALESCE(end_date, start_date) >= ? AND responsible_name IS NOT NULL').all(last, first)
      .filter(f => matchEmployeeByName(f.responsible_name)?.id === e.id);
    for (const fair of fairs) {
      const center = centerByCode(s.fair_center);
      const object = db.prepare("SELECT id, code, name FROM cost_objects WHERE type = 'fiera' AND fair_id = ? AND status = 'aperto' ORDER BY id LIMIT 1").get(fair.id);
      const to = (fair.end_date || fair.start_date) < last ? fair.end_date || fair.start_date : last;
      for (let d = fair.start_date > first ? fair.start_date : first; d <= to; d = addDays(d, 1)) {
        if (decided.has(`fiera:${fair.id}:${d}`)) continue;
        const minutes = scheduledMinutes(e, d) || DEFAULT_DAY_MINUTES;
        out.push({ source: 'fiera', source_id: fair.id, work_date: d, start_time: '09:00', end_time: fromMin(round(9 * 60 + minutes)), hour_type: 'ordinaria',
          cost_center_id: center?.id ?? null, cost_center: center ? `${center.code} ${center.name}` : null, cost_object_id: object?.id ?? null, cost_object: object ? `${object.code} ${object.name}` : null,
          label: `Fiera «${fair.name}»${fair.location ? ` (${fair.location})` : ''}` });
      }
    }
    // Le operazioni di Produzione si aggiungeranno quando il modulo le registrerà per persona.
    return out.sort((a, b) => a.work_date.localeCompare(b.work_date) || a.start_time.localeCompare(b.start_time));
  }
  function findProposal(e, b) {
    const p = proposals(e, periodOf(checkDate(b.work_date, 'la data', true))).find(x => x.source === b.source && x.source_id === Number(b.source_id) && x.work_date === b.work_date);
    if (!p) throw new HttpError(404, 'Proposta non trovata (già decisa o non più valida).');
    return p;
  }
  r.post('/timesheet/proposals/accept', req => {
    const b = req.body || {};
    const e = employee(b.employee_id || viewerEmployee(req)?.id || 0);
    if (!canEditFor(req, e)) throw new HttpError(403, 'Non puoi registrare ore per questa persona.');
    const p = findProposal(e, b);
    const input = { ...p, ...Object.fromEntries(['start_time', 'end_time', 'hour_type', 'cost_center_id', 'cost_object_id', 'note'].filter(k => b[k] !== undefined && b[k] !== '').map(k => [k, b[k]])) };
    const f = entryInput(e, input);
    assertWritable(req, e, f.work_date);
    const warnings = [...clashCheck(e, f), ...safetyCheck(req, e, f)];
    const id = events.transaction(() => {
      const eid = insertEntry(req, e, f, { origin: 'proposta', source_booking_id: p.source === 'prenotazione' ? p.source_id : null, source_fair_id: p.source === 'fiera' ? p.source_id : null });
      db.prepare('INSERT INTO timesheet_proposal_decisions (employee_id, source, source_id, work_date, decision, entry_id, decided_at, decided_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(e.id, p.source, p.source_id, p.work_date, 'accettata', eid, now(), actor(req));
      notifyLimitations(e, warnings, eid);
      return eid;
    });
    audit(req, 'timesheet.proposal_accepted', { entity: 'employee', entityId: e.id, after: { entry_id: id, source: p.source, source_id: p.source_id } });
    return { success: true, id, warnings };
  });
  r.post('/timesheet/proposals/dismiss', req => {
    const b = req.body || {};
    const e = employee(b.employee_id || viewerEmployee(req)?.id || 0);
    if (!canEditFor(req, e)) throw new HttpError(403, 'Non puoi decidere per questa persona.');
    const p = findProposal(e, b);
    db.prepare('INSERT INTO timesheet_proposal_decisions (employee_id, source, source_id, work_date, decision, decided_at, decided_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(e.id, p.source, p.source_id, p.work_date, 'scartata', now(), actor(req));
    return { success: true };
  });

  // ── Vista del mese ──────────────────────────────────────────────────────────
  function monthView(req, e, period) {
    const first = `${period}-01`, last = lastDay(period);
    const holidays = new Map(hr.calendar(Number(period.slice(0, 4)), e.site_id).map(h => [h.date, h.name]));
    const rows = db.prepare(`SELECT t.*, a.part AS absence_part, at.name AS absence_type, at.code AS absence_code FROM timesheet_entries t LEFT JOIN absences a ON a.id = t.absence_id
      LEFT JOIN absence_types at ON at.id = a.absence_type_id WHERE t.employee_id = ? AND t.work_date BETWEEN ? AND ? ORDER BY t.work_date, t.start_time`).all(e.id, first, last);
    const allocs = db.prepare(`SELECT al.*, c.code AS center_code, c.name AS center_name, o.code AS object_code, o.name AS object_name FROM timesheet_allocations al
      JOIN cost_centers c ON c.id = al.cost_center_id LEFT JOIN cost_objects o ON o.id = al.cost_object_id WHERE al.entry_id IN (SELECT id FROM timesheet_entries WHERE employee_id = ? AND work_date BETWEEN ? AND ?)`).all(e.id, first, last);
    for (const x of rows) x.allocations = allocs.filter(a => a.entry_id === x.id);
    const t = today();
    const days = [];
    const totals = { ordinaria: 0, straordinaria: 0, notturna: 0, festiva: 0, absences: {}, worked_days: 0, scheduled: 0, centers: {} };
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const holiday = holidays.get(d) || null;
      const scheduled = holiday ? 0 : scheduledMinutes(e, d);
      const list = rows.filter(x => x.work_date === d);
      const live = list.filter(x => !x.voided_by_adjustment_id);
      const worked = live.filter(x => x.origin !== 'assenza').reduce((s, x) => s + x.minutes, 0);
      const absent = live.filter(x => x.origin === 'assenza').reduce((s, x) => s + x.minutes, 0);
      for (const x of live) {
        if (x.origin === 'assenza') totals.absences[x.absence_type] = (totals.absences[x.absence_type] || 0) + x.minutes;
        else {
          totals[x.hour_type] += x.minutes;
          for (const a of x.allocations) totals.centers[`${a.center_code} ${a.center_name}`] = (totals.centers[`${a.center_code} ${a.center_name}`] || 0) + a.minutes;
        }
      }
      if (worked) totals.worked_days++;
      totals.scheduled += scheduled;
      const diff = worked + absent - scheduled;
      days.push({ date: d, weekday: weekday(d), holiday, scheduled, worked, absent, diff, entries: list, flag: scheduled && d <= t && diff < 0 ? 'mancano' : diff > 0 ? 'oltre' : null });
    }
    const m = monthRow(e.id, period);
    const status = m?.status || 'aperto';
    const editable = canEditFor(req, e) && (status === 'aperto' || (status === 'inviato' && canApproveMonth(req, e, m)));
    return {
      employee: { id: e.id, name: fullName(e), site_id: e.site_id, cost_center_id: e.cost_center_id }, period, status, month: m, days, totals,
      can_edit: editable, can_submit: canEditFor(req, e) && status === 'aperto', can_approve: status === 'inviato' && canApproveMonth(req, e, m),
      can_adjust: status === 'approvato' && (hasAccessLevel(req, 'personale') || canApproveMonth(req, e, m)),
      proposals: editable ? proposals(e, period) : [],
      conflicts: db.prepare(`SELECT c.*, at.name AS absence_type FROM timesheet_conflicts c LEFT JOIN absences a ON a.id = c.absence_id LEFT JOIN absence_types at ON at.id = a.absence_type_id
        WHERE c.employee_id = ? AND c.work_date BETWEEN ? AND ? AND c.resolved_at IS NULL ORDER BY c.work_date`).all(e.id, first, last),
      adjustments: db.prepare('SELECT * FROM timesheet_adjustments WHERE employee_id = ? AND period = ? ORDER BY id').all(e.id, period),
    };
  }
  r.get('/timesheet/month', req => {
    const e = employee(req.query.employee_id || viewerEmployee(req)?.id || 0);
    if (!canEditFor(req, e)) throw new HttpError(403, 'Non puoi vedere le presenze di questa persona.');
    return monthView(req, e, checkPeriod(req.query.period));
  });
  // Riepilogo del mese per chi gestisce: stato, ore, giorni scoperti, conflitti, proposte.
  r.get('/timesheet/overview', req => {
    const period = checkPeriod(req.query.period);
    const visible = hrFile.visibleEmployeeIds(req);
    return db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY last_name, first_name').all()
      .filter(e => !visible || visible.has(e.id))
      .map(e => {
        const v = monthView(req, e, period);
        return { employee_id: e.id, name: fullName(e), status: v.status, worked: v.days.reduce((s, d) => s + d.worked, 0), absent: v.days.reduce((s, d) => s + d.absent, 0),
          scheduled: v.totals.scheduled, missing_days: v.days.filter(d => d.flag === 'mancano').length, conflicts: v.conflicts.length, proposals: v.proposals.length, can_approve: v.can_approve };
      });
  });
  r.post('/timesheet/conflicts/:id/resolve', req => {
    const c = db.prepare('SELECT * FROM timesheet_conflicts WHERE id = ?').get(req.params.id);
    if (!c) throw new HttpError(404, 'Conflitto non trovato.');
    if (!canEditFor(req, employee(c.employee_id))) throw new HttpError(403, 'Non puoi gestire questo conflitto.');
    db.prepare('UPDATE timesheet_conflicts SET resolved_at = ?, resolved_by = ? WHERE id = ?').run(now(), actor(req), c.id);
    audit(req, 'timesheet.conflict_resolved', { entity: 'employee', entityId: c.employee_id, after: { conflict_id: c.id, note: text(req.body?.note) } });
    return { success: true };
  });

  // ── Stati del mese ──────────────────────────────────────────────────────────
  r.post('/timesheet/months/submit', req => {
    const b = req.body || {};
    const e = employee(b.employee_id || viewerEmployee(req)?.id || 0);
    const period = checkPeriod(b.period);
    if (!canEditFor(req, e)) throw new HttpError(403, 'Non puoi inviare questo mese.');
    const m = ensureMonth(e.id, period);
    if (m.status !== 'aperto') throw new HttpError(409, `Il mese è già ${m.status}.`);
    const approver = hrAbsences.approverFor(e.id, viewerEmployee(req)).approver;
    events.transaction(() => {
      db.prepare("UPDATE timesheet_months SET status = 'inviato', approver_employee_id = ?, submitted_at = ?, submitted_by = ?, return_note = NULL WHERE id = ?").run(approver, now(), actor(req), m.id);
      const u = userOfEmployee(approver);
      notifyAll(u ? [u] : hrFile.hrRecipients(), { kind: 'hr.timesheet.submitted', title: `Presenze di ${monthLabel(period)} da approvare: ${fullName(e)}`, body: `Inviate da ${actor(req)}.`, link: LINK, dedupeKey: `ts-month:${m.id}:submitted:${now()}` });
    });
    audit(req, 'timesheet.month_submitted', { entity: 'employee', entityId: e.id, after: { period } });
    return { success: true };
  });
  r.post('/timesheet/months/approve', req => {
    const b = req.body || {};
    const e = employee(b.employee_id);
    const period = checkPeriod(b.period);
    const m = monthRow(e.id, period);
    if (m?.status !== 'inviato') throw new HttpError(409, 'Si approva un mese inviato.');
    if (!canApproveMonth(req, e, m)) throw new HttpError(403, 'Questo mese non lo puoi approvare tu.');
    const open = db.prepare("SELECT COUNT(*) AS c FROM timesheet_conflicts WHERE employee_id = ? AND substr(work_date, 1, 7) = ? AND resolved_at IS NULL").get(e.id, period).c;
    if (open) throw new HttpError(409, `Ci sono ${open} conflitti tra ore e assenze da risolvere prima di approvare.`);
    const byCenter = db.prepare(`SELECT al.cost_center_id, SUM(al.minutes) AS minutes FROM timesheet_allocations al JOIN timesheet_entries t ON t.id = al.entry_id
      WHERE t.employee_id = ? AND substr(t.work_date, 1, 7) = ? AND t.voided_by_adjustment_id IS NULL GROUP BY al.cost_center_id`).all(e.id, period);
    events.transaction(() => {
      db.prepare("UPDATE timesheet_months SET status = 'approvato', approved_at = ?, approved_by = ? WHERE id = ?").run(now(), actor(req), m.id);
      events.emit('timesheet.month_approved', { sourceTable: 'timesheet_months', sourceId: m.id, payload: { employee_id: e.id, period, minutes_by_center: byCenter } });
      notifyAll([userOfEmployee(e.id)].filter(Boolean), { kind: 'hr.timesheet.approved', title: `Presenze di ${monthLabel(period)} approvate`, body: `Da ${actor(req)}.`, link: LINK, dedupeKey: `ts-month:${m.id}:approved` });
    });
    events.dispatch();
    audit(req, 'timesheet.month_approved', { entity: 'employee', entityId: e.id, after: { period } });
    return { success: true };
  });
  r.post('/timesheet/months/return', req => {
    const b = req.body || {};
    const e = employee(b.employee_id);
    const period = checkPeriod(b.period);
    const m = monthRow(e.id, period);
    if (m?.status !== 'inviato') throw new HttpError(409, 'Si rimanda indietro un mese inviato.');
    if (!canApproveMonth(req, e, m)) throw new HttpError(403, 'Questo mese non lo puoi rimandare tu.');
    const note = text(b.note);
    if (!note) throw new HttpError(400, 'Scrivi cosa va corretto.');
    events.transaction(() => {
      db.prepare("UPDATE timesheet_months SET status = 'aperto', return_note = ? WHERE id = ?").run(note, m.id);
      notifyAll([userOfEmployee(e.id)].filter(Boolean), { kind: 'hr.timesheet.returned', title: `Presenze di ${monthLabel(period)} da correggere`, body: note, link: LINK, dedupeKey: `ts-month:${m.id}:returned:${now()}` });
    });
    audit(req, 'timesheet.month_returned', { entity: 'employee', entityId: e.id, after: { period, note } });
    return { success: true };
  });

  // ── Rettifiche (mese approvato) ─────────────────────────────────────────────
  // Annulla righe (restano visibili come annullate), ne aggiunge di nuove con origine "rettifica",
  // oppure annulla un'assenza del mese chiuso togliendone le righe. Motivo obbligatorio, tutto tracciato.
  r.post('/timesheet/adjustments', req => {
    const b = req.body || {};
    const e = employee(b.employee_id);
    const period = checkPeriod(b.period);
    const m = monthRow(e.id, period);
    if (m?.status !== 'approvato') throw new HttpError(409, 'Le rettifiche servono per i mesi approvati: negli altri si correggono le righe.');
    if (!(hasAccessLevel(req, 'personale') || canApproveMonth(req, e, m))) throw new HttpError(403, 'Le rettifiche le registra il responsabile o l\'ufficio del personale.');
    const reason = text(b.reason);
    if (!reason || reason.length < 10) throw new HttpError(400, 'Scrivi il motivo della rettifica (almeno 10 caratteri).');
    const voids = uniq((Array.isArray(b.void_entry_ids) ? b.void_entry_ids : []).map(Number)).map(id => {
      const x = entry(id);
      if (x.employee_id !== e.id || periodOf(x.work_date) !== period) throw new HttpError(400, 'Si annullano solo righe di questo mese e di questa persona.');
      if (x.voided_by_adjustment_id) throw new HttpError(409, 'Riga già annullata.');
      if (x.origin === 'assenza') throw new HttpError(400, 'Le righe di assenza si tolgono annullando l\'assenza nella rettifica.');
      return x;
    });
    let absence = null;
    if (b.cancel_absence_id) {
      absence = db.prepare('SELECT * FROM absences WHERE id = ?').get(b.cancel_absence_id);
      if (!absence || absence.employee_id !== e.id || !hrAbsences.VALID.includes(absence.status)) throw new HttpError(400, 'Assenza non trovata o non valida.');
    }
    const exclude = new Set(voids.map(x => x.id));
    if (absence) for (const x of db.prepare('SELECT id FROM timesheet_entries WHERE absence_id = ?').all(absence.id)) exclude.add(x.id);
    const adds = (Array.isArray(b.add_entries) ? b.add_entries : []).map(a => {
      const f = entryInput(e, a);
      if (periodOf(f.work_date) !== period) throw new HttpError(400, 'Le righe aggiunte devono essere dello stesso mese.');
      return { f, warnings: [...clashCheck(e, f, exclude), ...safetyCheck(req, e, f)] };
    });
    for (let i = 0; i < adds.length; i++) for (let j = i + 1; j < adds.length; j++) {
      const a = adds[i].f, c = adds[j].f;
      if (a.work_date === c.work_date && a.start_time < c.end_time && a.end_time > c.start_time) throw new HttpError(400, 'Le righe aggiunte si sovrappongono tra loro.');
    }
    if (!voids.length && !adds.length && !absence) throw new HttpError(400, 'La rettifica non cambia nulla.');
    const id = events.transaction(() => {
      const aid = Number(db.prepare('INSERT INTO timesheet_adjustments (employee_id, period, reason, absence_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(e.id, period, reason, absence?.id ?? null, now(), actor(req)).lastInsertRowid);
      for (const x of voids) db.prepare('UPDATE timesheet_entries SET voided_by_adjustment_id = ?, updated_at = ? WHERE id = ?').run(aid, now(), x.id);
      for (const a of adds) insertEntry(req, e, a.f, { origin: 'rettifica', adjustment_id: aid });
      if (absence) {
        // Righe dell'assenza: nei mesi chiusi restano annullate dalla rettifica, negli altri si tolgono.
        for (const x of db.prepare('SELECT * FROM timesheet_entries WHERE absence_id = ? AND voided_by_adjustment_id IS NULL').all(absence.id)) {
          if (monthStatus(e.id, periodOf(x.work_date)) === 'approvato') db.prepare('UPDATE timesheet_entries SET voided_by_adjustment_id = ?, updated_at = ? WHERE id = ?').run(aid, now(), x.id);
          else db.prepare('DELETE FROM timesheet_entries WHERE id = ?').run(x.id);
        }
        db.prepare('DELETE FROM timesheet_conflicts WHERE absence_id = ?').run(absence.id);
        db.prepare("UPDATE absences SET status = 'annullata', cancelled_by = ?, cancelled_at = ?, decision_note = ?, updated_at = ? WHERE id = ?").run(actor(req), now(), `Rettifica: ${reason}`, now(), absence.id);
        events.emit('absence.cancelled', { sourceTable: 'absences', sourceId: absence.id, payload: { absence_id: absence.id, employee_id: e.id, start_date: absence.start_date, end_date: absence.end_date, by_adjustment: aid } });
      }
      events.emit('timesheet.adjusted', { sourceTable: 'timesheet_adjustments', sourceId: aid, payload: { employee_id: e.id, period, adjustment_id: aid } });
      notifyAll([userOfEmployee(e.id)].filter(Boolean), { kind: 'hr.timesheet.adjusted', title: `Rettifica alle presenze di ${monthLabel(period)}`, body: reason, link: LINK, dedupeKey: `ts-adj:${aid}` });
      return aid;
    });
    events.dispatch();
    audit(req, 'timesheet.adjusted', { entity: 'employee', entityId: e.id, after: { adjustment_id: id, period, voided: voids.map(x => x.id), added: adds.length, cancelled_absence: absence?.id ?? null, reason } });
    return { success: true, id, warnings: uniq(adds.flatMap(a => a.warnings)) };
  });

  // ── Ganci delle assenze: righe generate nella stessa transazione dell'approvazione ─
  hrAbsences.registerEffectHook({
    apply(a) {
      const e = employee(a.employee_id);
      const type = db.prepare('SELECT name FROM absence_types WHERE id = ?').get(a.absence_type_id)?.name || 'assenza';
      for (const d of hrAbsences.coverage(a)) {
        const p = periodOf(d.date);
        if (monthStatus(e.id, p) === 'approvato') throw new HttpError(409, `Il mese di ${monthLabel(p)} di ${fullName(e)} è già approvato: l'assenza non può entrare nelle presenze senza una rettifica.`);
        const work = dayRows(e.id, d.date).filter(x => x.origin !== 'assenza' && absenceBlocks(a, toMin(x.start_time), toMin(x.end_time)));
        db.prepare(`INSERT INTO timesheet_entries (employee_id, work_date, start_time, end_time, minutes, origin, absence_id, created_at, created_by, updated_at)
          VALUES (?, ?, ?, ?, ?, 'assenza', ?, ?, ?, ?)`).run(e.id, d.date, d.start_time || null, d.end_time || null, d.minutes, a.id, now(), 'Assenze', now());
        // Le ore già registrate restano: si segnala il conflitto a chi gestisce.
        for (const w of work) {
          db.prepare('INSERT INTO timesheet_conflicts (employee_id, work_date, absence_id, entry_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(e.id, d.date, a.id, w.id, `Il ${itDate(d.date)} risultano ore dalle ${w.start_time} alle ${w.end_time} ma anche ${type}.`, now());
        }
        if (work.length) notifyAll(managerUsers(e), { kind: 'hr.timesheet.conflict', title: `${fullName(e)}: ore e ${type.toLowerCase()} lo stesso giorno`, body: `Il ${itDate(d.date)} ci sono già ore registrate: controlla le presenze.`, link: LINK, dedupeKey: `ts-conflict:${a.id}:${d.date}` });
      }
    },
    revert(a) {
      const e = employee(a.employee_id);
      const rows = db.prepare('SELECT * FROM timesheet_entries WHERE absence_id = ? AND voided_by_adjustment_id IS NULL').all(a.id);
      const closed = rows.find(x => monthStatus(e.id, periodOf(x.work_date)) === 'approvato');
      if (closed) throw new HttpError(409, `Il mese di ${monthLabel(periodOf(closed.work_date))} di ${fullName(e)} è approvato: per annullare l'assenza serve una rettifica (Presenze → Rettifica).`);
      db.prepare('DELETE FROM timesheet_entries WHERE absence_id = ? AND voided_by_adjustment_id IS NULL').run(a.id);
      db.prepare('DELETE FROM timesheet_conflicts WHERE absence_id = ?').run(a.id);
    },
  });

  // ── Finance: driver "Ore lavorate" dalle presenze approvate ─────────────────
  function syncHoursDriver(period, eventId) {
    const rows = db.prepare(`SELECT al.cost_center_id AS centerId, SUM(al.minutes) AS minutes FROM timesheet_allocations al JOIN timesheet_entries t ON t.id = al.entry_id
      JOIN timesheet_months m ON m.employee_id = t.employee_id AND m.period = ? WHERE m.status = 'approvato' AND substr(t.work_date, 1, 7) = ? AND t.voided_by_adjustment_id IS NULL
      GROUP BY al.cost_center_id`).all(period, period);
    const res = finance.setComputedDriverValues('ore_lavorate', period, rows.map(x => ({ centerId: x.centerId, quantityMilli: Math.round(x.minutes * 1000 / 60) })), 'people');
    if (res.locked) {
      notifications.notify({ userId: null, kind: 'finance.driver_locked', title: `Ore di ${monthLabel(period)} cambiate dopo la cascata confermata`,
        body: 'Il driver «Ore lavorate» non è stato aggiornato: annulla o riesegui la cascata del mese in Finance.', link: '/portal.html?workspace=finance', dedupeKey: `ore-driver-locked:${period}:${eventId}` });
    }
  }
  events.on('timesheet.month_approved', 'finance.ore-lavorate', ev => syncHoursDriver(ev.payload.period, ev.id));
  events.on('timesheet.adjusted', 'finance.ore-lavorate-adjusted', ev => syncHoursDriver(ev.payload.period, ev.id));

  // ── Export per il consulente del lavoro ─────────────────────────────────────
  // CSV (separatore ";" e virgola decimale, per Excel) una riga per persona e giorno con ore o assenze.
  // Solo i mesi approvati, salvo /tutti. Contiene il codice fiscale: serve il livello "personale".
  function exportRows(period, all) {
    const cols = tsSettings().export_columns;
    const first = `${period}-01`, last = lastDay(period);
    const people = db.prepare(`SELECT e.*, p.fiscal_code FROM employees e LEFT JOIN employee_personal p ON p.employee_id = e.id ORDER BY e.last_name, e.first_name`).all()
      .filter(e => all || monthStatus(e.id, period) === 'approvato');
    const lines = [cols.map(c => EXPORT_COLUMNS[c])];
    for (const e of people) {
      const contract = hrFile.contractAt(e.id, last);
      const rows = db.prepare(`SELECT t.*, at.name AS absence_type FROM timesheet_entries t LEFT JOIN absences a ON a.id = t.absence_id LEFT JOIN absence_types at ON at.id = a.absence_type_id
        WHERE t.employee_id = ? AND t.work_date BETWEEN ? AND ? AND t.voided_by_adjustment_id IS NULL ORDER BY t.work_date`).all(e.id, first, last);
      for (const d of uniq(rows.map(x => x.work_date))) {
        const day = rows.filter(x => x.work_date === d);
        const work = day.filter(x => x.origin !== 'assenza');
        const sum = type => work.filter(x => x.hour_type === type).reduce((s, x) => s + x.minutes, 0);
        const abs = day.filter(x => x.origin === 'assenza');
        const centers = db.prepare(`SELECT c.code, SUM(al.minutes) AS m FROM timesheet_allocations al JOIN cost_centers c ON c.id = al.cost_center_id
          WHERE al.entry_id IN (${work.map(() => '?').join(',') || 'NULL'}) GROUP BY c.code ORDER BY c.code`).all(...work.map(x => x.id));
        const val = {
          codice_fiscale: e.fiscal_code || '', cognome: e.last_name, nome: e.first_name, tipo_contratto: contract?.contract_type || '', data: itDate(d),
          giornata_lavorata: work.length ? '1' : '0', ore_ordinarie: hours(sum('ordinaria')), ore_straordinarie: hours(sum('straordinaria')), ore_notturne: hours(sum('notturna')),
          ore_festive: hours(sum('festiva')), assenza: uniq(abs.map(x => x.absence_type)).join(', '), ore_assenza: hours(abs.reduce((s, x) => s + x.minutes, 0)),
          centri: centers.map(c => `${c.code} ${hours(c.m)}`).join('; '),
        };
        lines.push(cols.map(c => val[c]));
      }
    }
    return lines;
  }
  const csvCell = v => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function sendExport(req, res, all) {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'L\'export delle presenze contiene dati personali: serve il livello "personale".');
    const period = checkPeriod(req.params.period);
    const csv = '﻿' + exportRows(period, all).map(l => l.map(csvCell).join(';')).join('\r\n') + '\r\n';
    audit(req, 'timesheet.exported', { entity: 'timesheet', after: { period, all } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="presenze-${period}${all ? '-tutte' : ''}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }
  r.get('/timesheet/export/:period', (req, res) => sendExport(req, res, false));
  r.get('/timesheet/export/:period/tutti', (req, res) => sendExport(req, res, true));

  // Un dipendente con presenze registrate non si elimina.
  hr.registerDeleteGuard(id => (db.prepare('SELECT COUNT(*) AS c FROM timesheet_entries WHERE employee_id = ?').get(id).c ? 'presenze registrate' : null));

  return { monthView, proposals, matchEmployeeByName, exportRows, syncHoursDriver, monthStatus };
};
