// People — Fase 2, blocco 2C: assenze.
//   - tipi configurabili; giorno intero, mezza giornata, ore; giorni lavorativi da orario e festività della sede;
//   - flussi: bozza → richiesta → approvata/rifiutata → (annullata); comunicata → presa visione (malattia, infortunio);
//   - approvatore = responsabile (sale di un livello se il richiedente è il responsabile), delegato dopo N giorni;
//   - contatori ferie/ROL/ex festività: maturato, riporto, goduto, pianificato, residuo; ferie arretrate in scadenza;
//   - periodi di blocco (avviso o divieto), visita di rientro dopo oltre 60 giorni di assenza per salute;
//   - infortunio registrato → assenza collegata; disponibilità degli operatori dell'Enoturismo.
// Diventare "valida" (approvata o comunicata) e l'annullamento passano da ganci registrati da altri moduli
// (le presenze generano e tolgono le righe) dentro la stessa transazione: se un gancio rifiuta, niente cambia.
const { HttpError, createRouter } = require('../lib/http');
const { DATE, addDays, weekday } = require('../lib/calendar');

const VALID = ['approvata', 'comunicata', 'presa_visione'];
const OPEN = ['bozza', 'richiesta', ...VALID];
const COUNTERS = { ferie: 'Ferie', rol: 'ROL', ex_festivita: 'Ex festività' };
const PARTS = { giorno: 'Giorno intero', mattina: 'Mattina', pomeriggio: 'Pomeriggio', ore: 'A ore' };
const LANGUAGES = { it: 'italiano', en: 'inglese', de: 'tedesco', fr: 'francese', es: 'spagnolo', pt: 'portoghese', ru: 'russo', zh: 'cinese', ja: 'giapponese', nl: 'olandese' };
const DEFAULT_DAY_MINUTES = 480; // senza orario contrattuale: lun-ven, 8 ore
const MIDDAY = '13:00';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const text = v => (v == null ? null : String(v).trim() || null);
const intOrNull = v => (v === '' || v == null ? null : parseInt(v));
const itDate = d => d.split('-').reverse().join('/');
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

module.exports = function registerHrAbsences(app, deps) {
  const { db, authAdmin, audit, events, hasAccessLevel, notifications, scheduler, getSetting, setSetting, hr, hrFile, hrSafety } = deps;
  const r = createRouter(app, '/api/admin/hr', authAdmin, [[/absence_types.code/, 'Codice già usato da un altro tipo di assenza.']]);
  const { actor, isSelf, isManagerOf, viewerEmployee } = hrFile;

  const employee = id => {
    const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!e) throw new HttpError(404, 'Dipendente non trovato.');
    return e;
  };
  const fullName = e => `${e.first_name} ${e.last_name}`;
  const typeById = id => {
    const t = db.prepare('SELECT * FROM absence_types WHERE id = ?').get(id);
    if (!t) throw new HttpError(400, 'Tipo di assenza non trovato.');
    return t;
  };
  const absence = id => {
    const a = db.prepare('SELECT * FROM absences WHERE id = ?').get(id);
    if (!a) throw new HttpError(404, 'Assenza non trovata.');
    return a;
  };
  const checkDate = (d, label, required = false) => {
    if (d == null || d === '') { if (required) throw new HttpError(400, `Indica ${label}.`); return null; }
    if (!DATE.test(d)) throw new HttpError(400, `${label}: data nel formato AAAA-MM-GG.`);
    return d;
  };
  const userOfEmployee = id => (id ? db.prepare('SELECT portal_user_id FROM employees WHERE id = ?').get(id)?.portal_user_id ?? null : null);
  const notifyAll = (userIds, n) => { for (const u of new Set(userIds.filter(x => x !== undefined))) notifications.notify({ userId: u, ...n }); };
  // Le richieste si decidono nel Timesheet (scheda «Richieste del team»); il dipendente le segue in «Ferie e permessi».
  const LINK = '/portal.html?workspace=people&sub=people-timesheet&tab=team';
  const LINK_SELF = '/portal.html?workspace=people&sub=people-timesheet&tab=ferie';

  // ── Impostazioni ────────────────────────────────────────────────────────────
  function absenceSettings() {
    const days = parseInt(getSetting('absence_escalation_days', '3'));
    const policy = getSetting('absence_over_balance', 'blocca');
    return { escalation_days: Number.isInteger(days) && days > 0 ? days : 3, over_balance: ['blocca', 'avvisa'].includes(policy) ? policy : 'blocca' };
  }
  r.get('/absence-settings', () => absenceSettings());
  r.put('/absence-settings', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello "personale".');
    const b = req.body || {};
    if (b.escalation_days !== undefined) {
      const d = parseInt(b.escalation_days);
      if (!(d >= 1 && d <= 30)) throw new HttpError(400, 'Giorni di attesa prima del delegato: tra 1 e 30.');
      setSetting('absence_escalation_days', String(d));
    }
    if (b.over_balance !== undefined) {
      if (!['blocca', 'avvisa'].includes(b.over_balance)) throw new HttpError(400, 'Oltre il residuo: "blocca" oppure "avvisa".');
      setSetting('absence_over_balance', b.over_balance);
    }
    audit(req, 'absence_settings.updated', { entity: 'hr_settings', after: absenceSettings() });
    return absenceSettings();
  });

  // ── Tipi di assenza ─────────────────────────────────────────────────────────
  r.get('/absence-types', () => db.prepare('SELECT * FROM absence_types ORDER BY sort_order, name').all());
  function typeFields(b, existing = null) {
    const pick = (k, conv = v => v) => (b[k] !== undefined ? conv(b[k]) : existing?.[k] ?? null);
    const flag = k => (b[k] !== undefined ? (b[k] ? 1 : 0) : existing?.[k] ?? 0);
    const f = {
      name: pick('name', text), flow: pick('flow'), counter: pick('counter', v => v || null), unit: pick('unit'),
      paid: flag('paid'), requires_protocol: flag('requires_protocol'), health: flag('health'), allow_half_day: flag('allow_half_day'), allow_hours: flag('allow_hours'),
      active: b.active !== undefined ? (b.active ? 1 : 0) : existing?.active ?? 1,
      // Categoria (i pulsanti della richiesta) e giustificativo richiesto (vedi migrazione 0040).
      category: pick('category', v => v || 'permesso'), doc_required: flag('doc_required'), doc_label: pick('doc_label', text), doc_hint: pick('doc_hint', text),
      doc_deadline_days: pick('doc_deadline_days', v => (v === '' || v == null ? null : parseInt(v))), doc_mode: pick('doc_mode', v => v || 'file'), doc_self_cert: flag('doc_self_cert'),
    };
    if (!f.name) throw new HttpError(400, 'Il nome è obbligatorio.');
    if (!['ferie', 'permesso', 'malattia', 'congedo'].includes(f.category)) throw new HttpError(400, 'Categoria: ferie, permesso, malattia o congedo.');
    if (!['file', 'protocol'].includes(f.doc_mode)) throw new HttpError(400, 'Giustificativo: file oppure numero di protocollo.');
    if (f.doc_required && !f.doc_label) throw new HttpError(400, 'Indica quale documento serve come giustificativo.');
    if (f.doc_required && !(f.doc_deadline_days >= 0 && f.doc_deadline_days <= 365)) throw new HttpError(400, 'Indica entro quanti giorni dalla fine dell\'assenza va consegnato il giustificativo (0–365).');
    if (!['approvazione', 'comunicazione'].includes(f.flow)) throw new HttpError(400, 'Flusso: approvazione oppure comunicazione.');
    if (!['giorni', 'ore'].includes(f.unit)) throw new HttpError(400, 'Unità: giorni oppure ore.');
    if (f.counter && !COUNTERS[f.counter]) throw new HttpError(400, 'Contatore non valido.');
    if (f.counter) {
      const other = db.prepare('SELECT name, unit FROM absence_types WHERE counter = ? AND id <> ?').get(f.counter, existing?.id ?? -1);
      if (other && other.unit !== f.unit) throw new HttpError(400, `Il contatore ${COUNTERS[f.counter]} è in ${other.unit} (come «${other.name}»): usa la stessa unità.`);
    }
    return f;
  }
  r.post('/absence-types', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello "personale".');
    const code = text(req.body?.code)?.toLowerCase();
    if (!code || !/^[a-z0-9_]+$/.test(code)) throw new HttpError(400, 'Codice: lettere minuscole, numeri e trattini bassi.');
    const f = typeFields(req.body || {});
    const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM absence_types').get().n;
    const id = Number(db.prepare(`INSERT INTO absence_types (code, name, flow, counter, unit, paid, requires_protocol, health, allow_half_day, allow_hours, active, sort_order,
      category, doc_required, doc_label, doc_hint, doc_deadline_days, doc_mode, doc_self_cert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, f.name, f.flow, f.counter, f.unit, f.paid, f.requires_protocol, f.health, f.allow_half_day, f.allow_hours, f.active, order, f.category, f.doc_required, f.doc_label, f.doc_hint, f.doc_deadline_days, f.doc_mode, f.doc_self_cert).lastInsertRowid);
    audit(req, 'absence_type.created', { entity: 'absence_type', entityId: id, after: { code, ...f } });
    return { success: true, id };
  });
  r.patch('/absence-types/:id', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello "personale".');
    const t = typeById(req.params.id);
    const f = typeFields(req.body || {}, t);
    const used = db.prepare('SELECT COUNT(*) AS c FROM absences WHERE absence_type_id = ?').get(t.id).c;
    if (used && (f.unit !== t.unit || f.counter !== t.counter)) throw new HttpError(409, 'Tipo già usato: unità e contatore non si cambiano (crea un tipo nuovo).');
    db.prepare(`UPDATE absence_types SET name = ?, flow = ?, counter = ?, unit = ?, paid = ?, requires_protocol = ?, health = ?, allow_half_day = ?, allow_hours = ?, active = ?,
      category = ?, doc_required = ?, doc_label = ?, doc_hint = ?, doc_deadline_days = ?, doc_mode = ?, doc_self_cert = ? WHERE id = ?`)
      .run(f.name, f.flow, f.counter, f.unit, f.paid, f.requires_protocol, f.health, f.allow_half_day, f.allow_hours, f.active, f.category, f.doc_required, f.doc_label, f.doc_hint, f.doc_deadline_days, f.doc_mode, f.doc_self_cert, t.id);
    audit(req, 'absence_type.updated', { entity: 'absence_type', entityId: t.id, before: t, after: f });
    return { success: true };
  });

  // ── Periodi di blocco ───────────────────────────────────────────────────────
  r.get('/absence-block-periods', () => db.prepare(`SELECT p.*, s.name AS site_name, t.name AS team_name FROM absence_block_periods p
    LEFT JOIN sites s ON s.id = p.site_id LEFT JOIN teams t ON t.id = p.team_id ORDER BY p.start_date DESC`).all());
  function periodFields(b) {
    const f = { name: text(b.name), start_date: checkDate(b.start_date, 'l\'inizio', true), end_date: checkDate(b.end_date, 'la fine', true),
      site_id: intOrNull(b.site_id), team_id: intOrNull(b.team_id), mode: b.mode || 'avviso', note: text(b.note) };
    if (!f.name) throw new HttpError(400, 'Dai un nome al periodo (es. Vendemmia 2026).');
    if (f.end_date < f.start_date) throw new HttpError(400, 'Il periodo finisce prima di iniziare.');
    if (!['avviso', 'blocco'].includes(f.mode)) throw new HttpError(400, 'Modalità: avviso oppure blocco.');
    return f;
  }
  r.post('/absence-block-periods', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello "personale".');
    const f = periodFields(req.body || {});
    const id = Number(db.prepare('INSERT INTO absence_block_periods (name, start_date, end_date, site_id, team_id, mode, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.name, f.start_date, f.end_date, f.site_id, f.team_id, f.mode, f.note, now()).lastInsertRowid);
    audit(req, 'absence_block_period.created', { entity: 'absence_block_period', entityId: id, after: f });
    return { success: true, id };
  });
  r.patch('/absence-block-periods/:id', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello "personale".');
    const p = db.prepare('SELECT * FROM absence_block_periods WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'Periodo non trovato.');
    const f = periodFields({ ...p, ...req.body });
    db.prepare('UPDATE absence_block_periods SET name = ?, start_date = ?, end_date = ?, site_id = ?, team_id = ?, mode = ?, note = ? WHERE id = ?')
      .run(f.name, f.start_date, f.end_date, f.site_id, f.team_id, f.mode, f.note, p.id);
    audit(req, 'absence_block_period.updated', { entity: 'absence_block_period', entityId: p.id, before: p, after: f });
    return { success: true };
  });
  r.delete('/absence-block-periods/:id', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello "personale".');
    const p = db.prepare('SELECT * FROM absence_block_periods WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'Periodo non trovato.');
    db.prepare('DELETE FROM absence_block_periods WHERE id = ?').run(p.id);
    audit(req, 'absence_block_period.deleted', { entity: 'absence_block_period', entityId: p.id, before: p });
    return { success: true };
  });
  function blockPeriodsFor(e, start, end) {
    return db.prepare(`SELECT * FROM absence_block_periods WHERE start_date <= ? AND end_date >= ? AND (site_id IS NULL OR site_id = ?)
      AND (team_id IS NULL OR team_id IN (SELECT team_id FROM team_members WHERE employee_id = ?)) ORDER BY mode = 'blocco' DESC, start_date`).all(end, start, e.site_id ?? -1, e.id);
  }

  // ── Giorni lavorativi e quantità ────────────────────────────────────────────
  // Giorni con orario contrattuale > 0 che non sono festività della sede del dipendente.
  function workDays(e, start, end) {
    const holidays = new Map();
    const isHoliday = d => {
      const y = Number(d.slice(0, 4));
      if (!holidays.has(y)) holidays.set(y, new Set(hr.calendar(y, e.site_id).map(h => h.date)));
      return holidays.get(y).has(d);
    };
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const s = hr.currentSchedule(e.id, d);
      const minutes = s ? s.days[weekday(d)] || 0 : weekday(d) <= 5 ? DEFAULT_DAY_MINUTES : 0;
      if (minutes > 0 && !isHoliday(d)) out.push({ date: d, minutes });
    }
    return out;
  }
  // Consumo nell'unità del tipo (millesimi di giorno o minuti) e minuti di orario coperti, giorno per giorno.
  function measure(e, t, f, { allowEmpty = false } = {}) {
    if (daysBetween(f.start_date, f.end_date) > 366) throw new HttpError(400, 'Un\'assenza dura al massimo un anno: dividila in più periodi.');
    const days = workDays(e, f.start_date, f.end_date);
    if (!days.length) {
      if (allowEmpty) return { amount: 0, work_minutes: 0, days: [] };
      throw new HttpError(400, 'Nel periodo scelto non ci sono giorni lavorativi (orario e festività della sede).');
    }
    let perDay;
    if (f.part === 'giorno') perDay = days.map(d => ({ ...d, amount: t.unit === 'giorni' ? 1000 : d.minutes }));
    else if (f.part === 'ore') {
      const minutes = toMin(f.end_time) - toMin(f.start_time);
      if (minutes > days[0].minutes) throw new HttpError(400, `Più ore dell'orario di quel giorno (${days[0].minutes / 60} h).`);
      perDay = [{ ...days[0], minutes, start_time: f.start_time, end_time: f.end_time, amount: t.unit === 'giorni' ? Math.round(minutes * 1000 / days[0].minutes) : minutes }];
    } else {
      const minutes = Math.round(days[0].minutes / 2);
      perDay = [{ ...days[0], minutes, amount: t.unit === 'giorni' ? 500 : minutes }];
    }
    return { amount: perDay.reduce((s, d) => s + d.amount, 0), work_minutes: perDay.reduce((s, d) => s + d.minutes, 0), days: perDay };
  }
  // Giorni e minuti coperti da un'assenza già registrata (per le presenze): stesso calcolo.
  const coverage = a => measure(employee(a.employee_id), typeById(a.absence_type_id), a, { allowEmpty: true }).days;

  // ── Contatori ───────────────────────────────────────────────────────────────
  const counterUnit = counter => db.prepare('SELECT unit FROM absence_types WHERE counter = ? LIMIT 1').get(counter)?.unit || (counter === 'ferie' ? 'giorni' : 'ore');
  const allowance = (employeeId, counter, year) => db.prepare('SELECT * FROM absence_allowances WHERE employee_id = ? AND counter = ? AND year = ?').get(employeeId, counter, year) || null;
  const usageRows = (employeeId, counter, year) => db.prepare(`SELECT a.* FROM absences a JOIN absence_types t ON t.id = a.absence_type_id
    WHERE a.employee_id = ? AND t.counter = ? AND substr(a.start_date, 1, 4) = ? AND a.status IN ('richiesta', 'approvata', 'comunicata', 'presa_visione')`).all(employeeId, counter, String(year));
  // ── Spettanze: della persona (absence_allowances) o standard del contratto (absence_plans) ──
  // Come negli altri software HR: la spettanza standard dipende dal contratto in vigore (CCNL e tipo), matura
  // a fine mese nei mesi con almeno 15 giorni di servizio (assunzione e cessazione comprese) e, per ROL ed ex
  // festività, in proporzione al part-time. Un «saldo alla data» (dal cedolino) fa da punto di partenza.
  const pad2 = n => String(n).padStart(2, '0');
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
  const ccnlKey = v => { const t = String(v || '').toLowerCase(); return /agric/.test(t) ? 'agricoltura' : /commerc|terziar/.test(t) ? 'commercio' : null; };
  const contractFor = (employeeId, year) => db.prepare('SELECT * FROM employment_contracts WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, version DESC LIMIT 1').get(employeeId, `${year}-12-31`) || null;
  function planFor(employeeId, year) {
    const c = contractFor(employeeId, year);
    if (!c) return null;
    const key = ccnlKey(c.ccnl);
    const plan = db.prepare('SELECT * FROM absence_plans WHERE active = 1 ORDER BY priority, id').all()
      .find(x => (x.ccnl == null || x.ccnl === key) && (!x.contract_types || JSON.parse(x.contract_types).includes(c.contract_type)));
    return plan ? { ...plan, contract: c } : null;
  }
  function entitlement(employeeId, counter, year) {
    const al = allowance(employeeId, counter, year);
    if (al) return { annual: al.annual_amount, accrual: al.accrual, opening: al.opening_balance, source: 'persona', plan: null };
    const pl = planFor(employeeId, year);
    if (!pl) return { annual: 0, accrual: null, opening: null, source: null, plan: null };
    const pct = counter !== 'ferie' && pl.contract.part_time_pct ? pl.contract.part_time_pct / 100 : 1;
    return { annual: Math.round(pl[counter] * pct), accrual: pl.accrual, opening: null, source: 'standard', plan: pl.name };
  }
  // Mesi dell'anno con almeno 15 giorni di servizio (senza contratto registrato: tutto l'anno).
  function serviceMonths(employeeId, year) {
    const c = contractFor(employeeId, year);
    const from = c?.hire_date || null;
    const until = [c?.termination_date, c?.end_date].filter(Boolean).sort()[0] || null;
    return Array.from({ length: 12 }, (_, i) => {
      const first = `${year}-${pad2(i + 1)}-01`, last = `${year}-${pad2(i + 1)}-${pad2(daysIn(year, i + 1))}`;
      const a = from && from > first ? from : first, b = until && until < last ? until : last;
      return a <= b && dayDiff(a, b) + 1 >= 15;
    });
  }
  const anchorIn = (employeeId, counter, year, date) => db.prepare(`SELECT * FROM absence_balance_anchors WHERE employee_id = ? AND counter = ? AND substr(as_of, 1, 4) = ? AND as_of <= ?
    ORDER BY as_of DESC, id DESC LIMIT 1`).get(employeeId, counter, String(year), date < `${year}-12-31` ? date : `${year}-12-31`) || null;
  // Primo anno che si conta: il primo saldo alla data o la prima spettanza della persona; altrimenti
  // l'avvio delle spettanze standard (o l'assunzione, se dopo). Prima non si calcolano riporti.
  function startYear(employeeId, counter) {
    const years = [db.prepare('SELECT MIN(year) AS y FROM absence_allowances WHERE employee_id = ? AND counter = ?').get(employeeId, counter).y,
      Number(db.prepare('SELECT MIN(substr(as_of, 1, 4)) AS y FROM absence_balance_anchors WHERE employee_id = ? AND counter = ?').get(employeeId, counter).y) || null].filter(Boolean);
    if (years.length) return Math.min(...years);
    const since = Number((db.prepare("SELECT value FROM settings WHERE key = 'absence_plans_since'").get()?.value || today()).slice(0, 4));
    const hire = Number(db.prepare('SELECT MIN(hire_date) AS d FROM employment_contracts WHERE employee_id = ?').get(employeeId).d?.slice(0, 4)) || 0;
    return Math.max(since, hire);
  }
  function balance(employeeId, counter, year, date = today(), depth = 0) {
    const ent = entitlement(employeeId, counter, year);
    const y = Number(date.slice(0, 4)), dm = Number(date.slice(5, 7));
    const svc = serviceMonths(employeeId, year);
    const done = m => year < y || (year === y && m < dm); // la quota del mese matura a fine mese
    const anchor = anchorIn(employeeId, counter, year, date);
    const am = anchor ? Number(anchor.as_of.slice(5, 7)) : 0;
    const months = pred => svc.filter((on, i) => on && i + 1 > am && pred(i + 1)).length;
    const accruedMonths = months(done), yearMonths = months(() => true);
    let accrued, projected;
    if (ent.accrual === 'annuale') {
      const whole = anchor ? 0 : svc.every(Boolean) ? ent.annual : Math.floor(ent.annual * yearMonths / 12);
      accrued = year <= y ? whole : 0; projected = whole;
    } else {
      accrued = Math.floor(ent.annual * accruedMonths / 12); projected = Math.floor(ent.annual * yearMonths / 12);
    }
    let opening;
    if (anchor) opening = anchor.amount;
    else if (ent.opening != null) opening = ent.opening;
    // Riporto = residuo di fine anno precedente (valutato al 1° gennaio), se quell'anno si contava.
    else opening = depth < 30 && year - 1 >= startYear(employeeId, counter) ? balance(employeeId, counter, year - 1, `${year}-01-01`, depth + 1).remaining : 0;
    const rows = usageRows(employeeId, counter, year).filter(a => !anchor || a.start_date > anchor.as_of);
    const sum = pred => rows.filter(pred).reduce((t, a) => t + a.amount, 0);
    const taken = sum(a => VALID.includes(a.status) && a.start_date <= date);
    const planned = sum(a => VALID.includes(a.status) && a.start_date > date);
    const pending = sum(a => a.status === 'richiesta');
    // Da allineare: spettanza standard, assunto prima dell'avvio e nessun saldo dal cedolino (il goduto di prima non è qui).
    const hire = db.prepare('SELECT MIN(hire_date) AS d FROM employment_contracts WHERE employee_id = ?').get(employeeId).d;
    const since = db.prepare("SELECT value FROM settings WHERE key = 'absence_plans_since'").get()?.value || '';
    const toAlign = ent.source === 'standard' && !!hire && hire < since && !db.prepare('SELECT 1 FROM absence_balance_anchors WHERE employee_id = ? AND counter = ?').get(employeeId, counter);
    return { counter, label: COUNTERS[counter], unit: counterUnit(counter), year, annual: ent.annual, accrual: ent.accrual, source: ent.source, plan: ent.plan, to_align: toAlign,
      anchor: anchor ? { as_of: anchor.as_of, amount: anchor.amount } : null, opening, accrued, projected, taken, planned, pending,
      remaining: opening + accrued - taken, available: opening + projected - taken - planned - pending };
  }
  const balances = (employeeId, year) => Object.keys(COUNTERS).map(c => balance(employeeId, c, year)).filter(b => b.annual || b.opening || b.taken || b.planned || b.pending);
  const fmtAmount = (amount, unit) => (unit === 'giorni' ? `${(amount / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 })} gg` : `${(amount / 60).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`);

  // Ferie arretrate: si consumano dalla più vecchia; quelle dell'anno Y vanno godute entro il 30/06 dell'anno Y+2.
  // Le «vasche» sono il saldo di partenza (saldo alla data o riporto iniziale) e il maturato di ogni anno.
  function vacationArrears(employeeId, date = today()) {
    const cur = Number(date.slice(0, 4));
    const anchor = db.prepare("SELECT * FROM absence_balance_anchors WHERE employee_id = ? AND counter = 'ferie' AND as_of <= ? ORDER BY as_of DESC, id DESC LIMIT 1").get(employeeId, date) || null;
    const first = anchor ? Number(anchor.as_of.slice(0, 4)) : startYear(employeeId, 'ferie');
    if (first > cur) return [];
    const pools = [{ year: anchor ? first : first - 1, amount: anchor ? Math.max(0, anchor.amount) : (entitlement(employeeId, 'ferie', first).opening || 0) }];
    for (let yr = first; yr <= cur; yr++) pools.push({ year: yr, amount: balance(employeeId, 'ferie', yr, `${yr}-12-31`).projected });
    let used = db.prepare(`SELECT COALESCE(SUM(a.amount), 0) AS s FROM absences a JOIN absence_types t ON t.id = a.absence_type_id
      WHERE a.employee_id = ? AND t.counter = 'ferie' AND a.status IN ('approvata', 'comunicata', 'presa_visione') AND a.start_date > ?`).get(employeeId, anchor ? anchor.as_of : `${first - 1}-12-31`).s;
    const out = [];
    for (const pl of pools) {
      const take = Math.min(pl.amount, used);
      used -= take;
      const left = pl.amount - take;
      if (left > 0 && pl.year < cur) out.push({ year: pl.year, amount: left, due_date: `${pl.year + 2}-06-30` });
    }
    return out;
  }
  hrFile.registerDeadlineSource(() => db.prepare('SELECT id FROM employees WHERE active = 1').all().flatMap(e => vacationArrears(e.id).map(v => ({
    employee_id: e.id, kind: 'ferie_arretrate', label: `Ferie ${v.year} da godere (${fmtAmount(v.amount, 'giorni')})`, due_date: v.due_date, ref: `ferie:${e.id}:${v.year}`, blocking: false,
  }))));

  r.get('/employees/:id/allowances', req => {
    const e = employee(req.params.id);
    if (!canSeeAbsences(req, e)) throw new HttpError(403, 'Non puoi vedere i contatori di questa persona.');
    const year = parseInt(req.query.year) || Number(today().slice(0, 4));
    return { year, anchors: db.prepare('SELECT * FROM absence_balance_anchors WHERE employee_id = ? ORDER BY as_of DESC, id DESC').all(e.id), plan: planFor(e.id, year)?.name || null, contract: contractFor(e.id, year),
      allowances: db.prepare('SELECT * FROM absence_allowances WHERE employee_id = ? ORDER BY year DESC, counter').all(e.id), balances: Object.keys(COUNTERS).map(c => balance(e.id, c, year)), arrears: vacationArrears(e.id) };
  });
  r.put('/employees/:id/allowances', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Le spettanze le imposta l\'ufficio del personale.');
    const e = employee(req.params.id);
    const b = req.body || {};
    if (!COUNTERS[b.counter]) throw new HttpError(400, 'Contatore non valido.');
    const year = parseInt(b.year);
    if (!(year >= 2000 && year <= 2100)) throw new HttpError(400, 'Anno non valido.');
    const unit = counterUnit(b.counter);
    const conv = v => {
      if (v === '' || v == null) return null;
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < -1000) throw new HttpError(400, `Valore non valido: ${v}`);
      return Math.round(n * (unit === 'giorni' ? 1000 : 60));
    };
    const annual = conv(b.annual);
    if (annual == null || annual < 0) throw new HttpError(400, `Indica la spettanza annua in ${unit}.`);
    const accrual = b.accrual || 'mensile';
    if (!['mensile', 'annuale'].includes(accrual)) throw new HttpError(400, 'Maturazione: mensile oppure annuale.');
    const opening = conv(b.opening);
    db.prepare(`INSERT INTO absence_allowances (employee_id, counter, year, annual_amount, accrual, opening_balance, note) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (employee_id, counter, year) DO UPDATE SET annual_amount = excluded.annual_amount, accrual = excluded.accrual, opening_balance = excluded.opening_balance, note = excluded.note`)
      .run(e.id, b.counter, year, annual, accrual, opening, text(b.note));
    audit(req, 'absence_allowance.set', { entity: 'employee', entityId: e.id, after: { counter: b.counter, year, annual_amount: annual, accrual, opening_balance: opening } });
    return { success: true, balance: balance(e.id, b.counter, year) };
  });

  // Saldo alla data (dal cedolino): alla registrazione di chi è già in forza e per riallineare quando serve.
  r.post('/employees/:id/balance-anchors', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'I saldi li imposta l\'ufficio del personale.');
    const e = employee(req.params.id);
    const b = req.body || {};
    if (!DATE.test(b.as_of || '')) throw new HttpError(400, 'Indica la data del saldo (di solito l\'ultimo giorno del mese del cedolino).');
    if (b.as_of > today()) throw new HttpError(400, 'La data del saldo non può essere nel futuro.');
    const conv = (v, unit) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n) || Math.abs(n) > 1000) throw new HttpError(400, `Valore non valido: ${v}`); return Math.round(n * (unit === 'giorni' ? 1000 : 60)); };
    const rows = Object.keys(COUNTERS).map(c => ({ counter: c, amount: conv(b[c], counterUnit(c)) })).filter(x => x.amount != null);
    if (!rows.length) throw new HttpError(400, 'Indica almeno un residuo (ferie, ROL o ex festività).');
    const ins = db.prepare('INSERT INTO absence_balance_anchors (employee_id, counter, as_of, amount, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
    events.transaction(() => { for (const x of rows) ins.run(e.id, x.counter, b.as_of, x.amount, text(b.note), now(), actor(req)); });
    audit(req, 'absence_balance.anchored', { entity: 'employee', entityId: e.id, after: { as_of: b.as_of, counters: rows.map(x => x.counter), note: text(b.note) } });
    return { success: true, balances: Object.keys(COUNTERS).map(c => balance(e.id, c, Number(b.as_of.slice(0, 4)))) };
  });
  r.delete('/balance-anchors/:id', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'I saldi li imposta l\'ufficio del personale.');
    const x = db.prepare('SELECT * FROM absence_balance_anchors WHERE id = ?').get(req.params.id);
    if (!x) throw new HttpError(404, 'Saldo non trovato.');
    db.prepare('DELETE FROM absence_balance_anchors WHERE id = ?').run(x.id);
    audit(req, 'absence_balance.anchor_deleted', { entity: 'employee', entityId: x.employee_id, before: { counter: x.counter, as_of: x.as_of, amount: x.amount } });
    return { success: true };
  });
  // Spettanze standard per contratto (People → Configurazione).
  r.get('/absence-plans', () => db.prepare('SELECT * FROM absence_plans ORDER BY priority, id').all().map(x => ({ ...x, contract_types: x.contract_types ? JSON.parse(x.contract_types) : null })));
  function planFields(b, existing = {}) {
    const pick = k => (b[k] !== undefined ? b[k] : existing[k]);
    const conv = (v, k) => { if (v === '' || v == null) return 0; const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n) || n < 0 || n > 1000) throw new HttpError(400, `Valore non valido: ${v}`); return Math.round(n * k); };
    const f = { name: text(pick('name')), ccnl: pick('ccnl') || null, contract_types: Array.isArray(pick('contract_types')) && pick('contract_types').length ? JSON.stringify(pick('contract_types')) : null,
      ferie: b.ferie !== undefined ? conv(b.ferie, 1000) : existing.ferie ?? 0, rol: b.rol !== undefined ? conv(b.rol, 60) : existing.rol ?? 0, ex_festivita: b.ex_festivita !== undefined ? conv(b.ex_festivita, 60) : existing.ex_festivita ?? 0,
      accrual: pick('accrual') || 'mensile', priority: parseInt(pick('priority')) || 100, active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active ?? 1, note: text(pick('note')) };
    if (!f.name) throw new HttpError(400, 'Il nome è obbligatorio.');
    if (f.ccnl && !['agricoltura', 'commercio'].includes(f.ccnl)) throw new HttpError(400, 'CCNL: agricoltura o commercio.');
    if (!['mensile', 'annuale'].includes(f.accrual)) throw new HttpError(400, 'Maturazione: mensile oppure annuale.');
    return f;
  }
  r.post('/absence-plans', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello "personale".');
    const f = planFields(req.body || {});
    const id = Number(db.prepare('INSERT INTO absence_plans (name, ccnl, contract_types, ferie, rol, ex_festivita, accrual, priority, active, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.name, f.ccnl, f.contract_types, f.ferie, f.rol, f.ex_festivita, f.accrual, f.priority, f.active, f.note).lastInsertRowid);
    audit(req, 'absence_plan.created', { entity: 'absence_plan', entityId: id, after: f });
    return { success: true, id };
  });
  r.patch('/absence-plans/:id', req => {
    if (!hasAccessLevel(req, 'personale')) throw new HttpError(403, 'Serve il livello "personale".');
    const x = db.prepare('SELECT * FROM absence_plans WHERE id = ?').get(req.params.id);
    if (!x) throw new HttpError(404, 'Spettanza non trovata.');
    const f = planFields(req.body || {}, x);
    db.prepare('UPDATE absence_plans SET name = ?, ccnl = ?, contract_types = ?, ferie = ?, rol = ?, ex_festivita = ?, accrual = ?, priority = ?, active = ?, note = ? WHERE id = ?')
      .run(f.name, f.ccnl, f.contract_types, f.ferie, f.rol, f.ex_festivita, f.accrual, f.priority, f.active, f.note, x.id);
    audit(req, 'absence_plan.updated', { entity: 'absence_plan', entityId: x.id, before: x, after: f });
    return { success: true };
  });

  // ── Chi vede e chi decide ───────────────────────────────────────────────────
  const canSeeAbsences = (req, e) => hasAccessLevel(req, 'personale') || isSelf(req, e) || isManagerOf(req, e);
  const canRequestFor = canSeeAbsences;
  function canDecide(req, a) {
    if (req.isMasterKey) return true;
    const me = viewerEmployee(req);
    if (me && me.id === a.employee_id) return false; // mai sulla propria assenza
    if (hasAccessLevel(req, 'personale')) return true;
    return !!me && (me.id === a.approver_employee_id || (!!a.escalated_at && me.id === a.delegate_employee_id));
  }
  // Approvatore: il responsabile del dipendente; se a chiedere è proprio il responsabile, si sale di un livello.
  function approverFor(employeeId, requester) {
    const a = hr.resolveApprover(employeeId);
    let approver = a?.approver?.id ?? null, delegate = a?.delegate?.id ?? null;
    if (requester && approver === requester.id) {
      const up = hr.resolveApprover(approver);
      approver = up?.approver?.id ?? null;
      delegate = up?.delegate?.id ?? null;
    }
    return { approver, delegate };
  }
  // Destinatari di una decisione: l'approvatore (o, se non ha accesso al portale o non c'è, HR).
  const approverUsers = a => {
    const u = userOfEmployee(a.approver_employee_id);
    return u ? [u] : hrFile.hrRecipients();
  };

  // ── Ganci: le presenze generano/tolgono le righe dentro la stessa transazione ─
  const effectHooks = [];
  const registerEffectHook = hook => effectHooks.push(hook);
  const applyEffects = a => { for (const h of effectHooks) h.apply?.(a); };
  const revertEffects = a => { for (const h of effectHooks) h.revert?.(a); };

  // ── Richieste ───────────────────────────────────────────────────────────────
  function overlapping(e, f, excludeId = null) {
    return db.prepare(`SELECT a.*, t.name AS type_name FROM absences a JOIN absence_types t ON t.id = a.absence_type_id WHERE a.employee_id = ? AND a.id <> ?
      AND a.status IN ('bozza', 'richiesta', 'approvata', 'comunicata', 'presa_visione') AND a.start_date <= ? AND a.end_date >= ?`).all(e.id, excludeId ?? -1, f.end_date, f.start_date)
      .filter(x => {
        if (x.part === 'giorno' || f.part === 'giorno') return true;
        if (x.part === 'ore' && f.part === 'ore') return x.start_time < f.end_time && x.end_time > f.start_time;
        return x.part === f.part; // mattina + pomeriggio dello stesso giorno sono compatibili
      });
  }
  function balanceCheck(e, t, f, excludeId = null) {
    if (!t.counter) return null;
    const year = Number(f.start_date.slice(0, 4));
    const b = balance(e.id, t.counter, year);
    const already = excludeId ? (db.prepare('SELECT amount, status FROM absences WHERE id = ?').get(excludeId) || {}) : {};
    const counted = ['richiesta', ...VALID].includes(already.status) ? already.amount : 0;
    const available = b.available + counted;
    if (f.amount <= available) return null;
    return `Residuo ${COUNTERS[t.counter]} ${year} insufficiente: disponibili ${fmtAmount(available, b.unit)}, richiesti ${fmtAmount(f.amount, b.unit)}.`;
  }
  function absenceInput(e, b, t) {
    const f = {
      start_date: checkDate(b.start_date, 'la data di inizio', true), end_date: checkDate(b.end_date || b.start_date, 'la data di fine', true),
      part: b.part || 'giorno', start_time: text(b.start_time), end_time: text(b.end_time), protocol: text(b.protocol), note: text(b.note),
    };
    if (!PARTS[f.part]) throw new HttpError(400, 'Scegli giorno intero, mattina, pomeriggio oppure a ore.');
    if (f.end_date < f.start_date) throw new HttpError(400, 'L\'assenza finisce prima di iniziare.');
    if (f.part !== 'giorno' && f.end_date !== f.start_date) throw new HttpError(400, 'Mezza giornata e ore valgono per un solo giorno.');
    if ((f.part === 'mattina' || f.part === 'pomeriggio') && !t.allow_half_day) throw new HttpError(400, `«${t.name}» non si prende a mezza giornata.`);
    if (f.part === 'ore') {
      if (!t.allow_hours) throw new HttpError(400, `«${t.name}» non si prende a ore.`);
      if (!TIME.test(f.start_time || '') || !TIME.test(f.end_time || '') || f.end_time <= f.start_time) throw new HttpError(400, 'Indica le ore dalle / alle (HH:MM).');
    } else { f.start_time = null; f.end_time = null; }
    if (t.requires_protocol && !f.protocol && !b.from_incident) throw new HttpError(400, `Per «${t.name}» serve il numero di protocollo del certificato.`);
    return f;
  }
  const decorate = a => a && ({ ...a, ...db.prepare(`SELECT t.name AS type_name, t.code AS type_code, t.unit, t.flow, t.counter, t.health, e.first_name || ' ' || e.last_name AS employee_name, e.job_title AS employee_job_title,
    ap.first_name || ' ' || ap.last_name AS approver_name, dl.first_name || ' ' || dl.last_name AS delegate_name, bp.name AS block_period_name
    FROM absences x JOIN absence_types t ON t.id = x.absence_type_id JOIN employees e ON e.id = x.employee_id LEFT JOIN employees ap ON ap.id = x.approver_employee_id
    LEFT JOIN employees dl ON dl.id = x.delegate_employee_id LEFT JOIN absence_block_periods bp ON bp.id = x.block_period_id WHERE x.id = ?`).get(a.id) });
  const describe = (a, t) => `${t.name} ${a.start_date === a.end_date ? `il ${itDate(a.start_date)}` : `dal ${itDate(a.start_date)} al ${itDate(a.end_date)}`}${a.part === 'ore' ? ` dalle ${a.start_time} alle ${a.end_time}` : a.part !== 'giorno' ? ` (${PARTS[a.part].toLowerCase()})` : ''}`;

  // Crea un'assenza (anche dal consumer degli infortuni). Restituisce { id, status, warnings }.
  function createAbsence({ req = null, e, t, b, requester = null, submit = true, source = null, dispatch = true }) {
    const f = absenceInput(e, b, t);
    const m = measure(e, t, f, { allowEmpty: !!source });
    Object.assign(f, { amount: m.amount, work_minutes: m.work_minutes });
    const clash = overlapping(e, f);
    if (clash.length) throw new HttpError(409, `${fullName(e)} ha già un'assenza nello stesso periodo: ${describe(clash[0], { name: clash[0].type_name })}.`);
    const warnings = [];
    let blockPeriod = null;
    if (t.flow === 'approvazione') {
      const periods = blockPeriodsFor(e, f.start_date, f.end_date);
      const hard = periods.find(p => p.mode === 'blocco');
      if (hard) throw new HttpError(409, `Periodo bloccato: «${hard.name}» dal ${itDate(hard.start_date)} al ${itDate(hard.end_date)}. Le richieste in questo periodo non sono ammesse.`);
      blockPeriod = periods[0] || null;
      if (blockPeriod) warnings.push(`La richiesta cade nel periodo «${blockPeriod.name}» (dal ${itDate(blockPeriod.start_date)} al ${itDate(blockPeriod.end_date)}): il responsabile ne sarà avvisato.`);
      if (submit) {
        const over = balanceCheck(e, t, f);
        if (over && absenceSettings().over_balance === 'blocca') throw new HttpError(409, over);
        if (over) warnings.push(over);
      }
    }
    const { approver, delegate } = approverFor(e.id, requester);
    const status = t.flow === 'comunicazione' ? 'comunicata' : submit ? 'richiesta' : 'bozza';
    const id = events.transaction(() => {
      const aid = Number(db.prepare(`INSERT INTO absences (employee_id, absence_type_id, start_date, end_date, part, start_time, end_time, amount, work_minutes, status, protocol, note,
        approver_employee_id, delegate_employee_id, block_period_id, incident_id, inail_number, requested_by, requested_user_id, submitted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.id, t.id, f.start_date, f.end_date, f.part, f.start_time, f.end_time, f.amount, f.work_minutes, status,
        f.protocol, f.note, approver, delegate, blockPeriod?.id ?? null, source?.incident_id ?? null, source?.inail_number ?? null,
        req ? actor(req) : source?.by || 'Sistema', req?.portalUser?.id ?? null, status === 'bozza' ? null : now(), now(), now()).lastInsertRowid);
      const a = db.prepare('SELECT * FROM absences WHERE id = ?').get(aid);
      if (status === 'comunicata') {
        applyEffects(a);
        events.emit('absence.communicated', { sourceTable: 'absences', sourceId: aid, payload: { absence_id: aid, employee_id: e.id, start_date: a.start_date, end_date: a.end_date, type: t.code } });
        notifyAll([...approverUsers(a), ...hrFile.hrRecipients()], { kind: 'hr.absence.communicated', title: `${fullName(e)}: ${describe(a, t)}`,
          body: `${f.protocol ? `Protocollo ${f.protocol}. ` : ''}${source ? 'Registrata dal registro infortuni.' : 'Comunicata, da prendere in visione.'}`, link: LINK, dedupeKey: `absence:${aid}:communicated` });
      } else if (status === 'richiesta') {
        notifyAll(approverUsers(a), { kind: 'hr.absence.requested', title: `${fullName(e)} chiede ${describe(a, t)}`,
          body: [blockPeriod ? `Attenzione: periodo «${blockPeriod.name}».` : null, ...warnings.filter(w => w.startsWith('Residuo'))].filter(Boolean).join(' ') || 'Da approvare.', link: LINK, dedupeKey: `absence:${aid}:requested` });
      }
      return aid;
    });
    if (dispatch) events.dispatch(); // dal consumer degli infortuni no: siamo già dentro dispatch()
    return { id, status, warnings };
  }

  r.post('/absences', req => {
    const b = req.body || {};
    const me = viewerEmployee(req);
    const e = employee(b.employee_id || me?.id || 0);
    if (!canRequestFor(req, e)) throw new HttpError(403, 'Puoi inserire assenze solo per te o per i tuoi collaboratori.');
    const t = typeById(b.absence_type_id);
    if (!t.active) throw new HttpError(400, `«${t.name}» non è più in uso.`);
    const res = createAbsence({ req, e, t, b, requester: me, submit: b.submit !== false && b.submit !== 'false' });
    audit(req, 'absence.created', { entity: 'employee', entityId: e.id, after: { absence_id: res.id, type: t.code, status: res.status } });
    return { success: true, ...res };
  });
  r.post('/absences/:id/submit', req => {
    const a = absence(req.params.id);
    const e = employee(a.employee_id);
    if (!canRequestFor(req, e)) throw new HttpError(403, 'Non puoi inviare questa richiesta.');
    if (a.status !== 'bozza') throw new HttpError(409, 'Solo una bozza si invia.');
    const t = typeById(a.absence_type_id);
    const over = balanceCheck(e, t, a, a.id);
    if (over && absenceSettings().over_balance === 'blocca') throw new HttpError(409, over);
    const { approver, delegate } = approverFor(e.id, viewerEmployee(req));
    events.transaction(() => {
      db.prepare("UPDATE absences SET status = 'richiesta', submitted_at = ?, approver_employee_id = ?, delegate_employee_id = ?, updated_at = ? WHERE id = ?").run(now(), approver, delegate, now(), a.id);
      const fresh = absence(a.id);
      notifyAll(approverUsers(fresh), { kind: 'hr.absence.requested', title: `${fullName(e)} chiede ${describe(fresh, t)}`, body: over || 'Da approvare.', link: LINK, dedupeKey: `absence:${a.id}:requested` });
    });
    audit(req, 'absence.submitted', { entity: 'employee', entityId: e.id, after: { absence_id: a.id } });
    return { success: true, warnings: over ? [over] : [] };
  });
  r.delete('/absences/:id', req => {
    const a = absence(req.params.id);
    if (a.status !== 'bozza') throw new HttpError(409, 'Si eliminano solo le bozze: le altre si annullano.');
    if (!canRequestFor(req, employee(a.employee_id))) throw new HttpError(403, 'Non puoi eliminare questa bozza.');
    db.prepare('DELETE FROM absences WHERE id = ?').run(a.id);
    audit(req, 'absence.draft_deleted', { entity: 'employee', entityId: a.employee_id, before: { absence_id: a.id } });
    return { success: true };
  });

  function notifyRequester(a, t, title, body) {
    notifyAll([userOfEmployee(a.employee_id), a.requested_user_id].filter(Boolean), { kind: 'hr.absence.decided', title, body, link: LINK_SELF, dedupeKey: `absence:${a.id}:${a.status}` });
  }
  r.post('/absences/:id/approve', req => {
    const a = absence(req.params.id);
    if (!canDecide(req, a)) throw new HttpError(403, 'Questa richiesta non la puoi approvare tu.');
    if (a.status !== 'richiesta') throw new HttpError(409, 'Si approvano solo le richieste in attesa.');
    const e = employee(a.employee_id), t = typeById(a.absence_type_id);
    // Quantità ricalcolata (l'orario può essere cambiato) e residuo ricontrollato al momento della decisione.
    const m = measure(e, t, a);
    const over = balanceCheck(e, t, { ...a, amount: m.amount }, a.id);
    if (over && absenceSettings().over_balance === 'blocca') throw new HttpError(409, over);
    events.transaction(() => {
      db.prepare("UPDATE absences SET status = 'approvata', amount = ?, work_minutes = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ?")
        .run(m.amount, m.work_minutes, actor(req), now(), text(req.body?.note), now(), a.id);
      const fresh = absence(a.id);
      applyEffects(fresh);
      events.emit('absence.approved', { sourceTable: 'absences', sourceId: a.id, payload: { absence_id: a.id, employee_id: e.id, start_date: a.start_date, end_date: a.end_date, type: t.code } });
      notifyRequester(fresh, t, `Approvata: ${describe(fresh, t)}`, `Approvata da ${actor(req)}.${req.body?.note ? ` ${text(req.body.note)}` : ''}`);
    });
    events.dispatch();
    audit(req, 'absence.approved', { entity: 'employee', entityId: e.id, after: { absence_id: a.id, amount: m.amount } });
    return { success: true, warnings: over ? [over] : [] };
  });
  r.post('/absences/:id/reject', req => {
    const a = absence(req.params.id);
    if (!canDecide(req, a)) throw new HttpError(403, 'Questa richiesta non la puoi rifiutare tu.');
    if (a.status !== 'richiesta') throw new HttpError(409, 'Si rifiutano solo le richieste in attesa.');
    const note = text(req.body?.note);
    if (!note) throw new HttpError(400, 'Scrivi il motivo del rifiuto.');
    const t = typeById(a.absence_type_id);
    events.transaction(() => {
      db.prepare("UPDATE absences SET status = 'rifiutata', decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ?").run(actor(req), now(), note, now(), a.id);
      notifyRequester(absence(a.id), t, `Non approvata: ${describe(a, t)}`, note);
    });
    audit(req, 'absence.rejected', { entity: 'employee', entityId: a.employee_id, after: { absence_id: a.id, note } });
    return { success: true };
  });
  r.post('/absences/:id/acknowledge', req => {
    const a = absence(req.params.id);
    if (!canDecide(req, a)) throw new HttpError(403, 'Non puoi prendere in visione questa comunicazione.');
    if (a.status !== 'comunicata') throw new HttpError(409, 'Si prendono in visione solo le assenze comunicate.');
    db.prepare("UPDATE absences SET status = 'presa_visione', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(actor(req), now(), now(), a.id);
    audit(req, 'absence.acknowledged', { entity: 'employee', entityId: a.employee_id, after: { absence_id: a.id } });
    return { success: true };
  });
  // Annullamento: il richiedente finché non è iniziata; responsabile e HR sempre. Se era valida, i ganci
  // tolgono ciò che avevano generato (le presenze rifiutano se il mese è chiuso: serve una rettifica).
  r.post('/absences/:id/cancel', req => {
    const a = absence(req.params.id);
    const e = employee(a.employee_id);
    if (!OPEN.includes(a.status)) throw new HttpError(409, 'Questa assenza non è annullabile.');
    const own = canRequestFor(req, e) && (['bozza', 'richiesta'].includes(a.status) || a.start_date > today());
    if (!own && !canDecide(req, a)) throw new HttpError(403, 'Un\'assenza già iniziata la annulla il responsabile o l\'ufficio del personale.');
    const t = typeById(a.absence_type_id);
    events.transaction(() => {
      db.prepare("UPDATE absences SET status = 'annullata', cancelled_by = ?, cancelled_at = ?, decision_note = COALESCE(?, decision_note), updated_at = ? WHERE id = ?")
        .run(actor(req), now(), text(req.body?.note), now(), a.id);
      if (VALID.includes(a.status)) {
        revertEffects(a);
        events.emit('absence.cancelled', { sourceTable: 'absences', sourceId: a.id, payload: { absence_id: a.id, employee_id: e.id, start_date: a.start_date, end_date: a.end_date, type: t.code } });
      }
      if (a.status !== 'bozza') notifyAll([...approverUsers(a), userOfEmployee(e.id)], { kind: 'hr.absence.cancelled', title: `Annullata: ${fullName(e)}, ${describe(a, t)}`, body: `Da ${actor(req)}.`, link: LINK, dedupeKey: `absence:${a.id}:cancelled` });
    });
    events.dispatch();
    audit(req, 'absence.cancelled', { entity: 'employee', entityId: e.id, after: { absence_id: a.id, was: a.status } });
    return { success: true };
  });

  // Elenco: HR vede tutto, gli altri le proprie, quelle dei collaboratori e quelle da decidere.
  // La visibilità è nella query, prima del LIMIT: prima si caricavano 500 righe e poi si toglievano quelle non
  // visibili, e con molti dati un responsabile poteva non vedere le assenze dei suoi (regola 23, rischio R4).
  r.get('/absences', req => {
    const q = req.query;
    const me = viewerEmployee(req);
    const visible = hrFile.visibleEmployeeIds(req); // null = tutti (livello "personale")
    const ids = visible === null ? [] : [...visible];
    const scope = visible === null ? '1 = 1'
      : `(${ids.length ? `a.employee_id IN (${ids.map(() => '?').join(', ')})` : '1 = 0'} OR a.approver_employee_id = ? OR a.delegate_employee_id = ?)`;
    const scopeParams = visible === null ? [] : [...ids, me?.id ?? 0, me?.id ?? 0];
    const rows = db.prepare(`SELECT a.* FROM absences a JOIN employees e ON e.id = a.employee_id
      WHERE (? IS NULL OR a.employee_id = ?) AND (? IS NULL OR a.status = ?) AND (? IS NULL OR a.absence_type_id = ?)
        AND (? IS NULL OR a.end_date >= ?) AND (? IS NULL OR a.start_date <= ?) AND (? IS NULL OR e.site_id = ?)
        AND (? IS NULL OR a.employee_id IN (SELECT employee_id FROM team_members WHERE team_id = ?))
        AND ${scope}
      ORDER BY a.start_date DESC, a.id DESC LIMIT 500`).all(q.employee_id || null, q.employee_id || null, q.status || null, q.status || null, q.type_id || null, q.type_id || null,
      q.from || null, q.from || null, q.to || null, q.to || null, q.site_id || null, q.site_id || null, q.team_id || null, q.team_id || null, ...scopeParams);
    return rows.filter(a => !q.to_decide || (['richiesta', 'comunicata'].includes(a.status) && canDecide(req, a))).map(a => ({ ...decorate(a), can_decide: canDecide(req, a) }));
  });
  r.get('/absences/balances', req => {
    const me = viewerEmployee(req);
    const e = employee(req.query.employee_id || me?.id || 0);
    if (!canSeeAbsences(req, e)) throw new HttpError(403, 'Non puoi vedere i contatori di questa persona.');
    const year = parseInt(req.query.year) || Number(today().slice(0, 4));
    return { employee_id: e.id, year, balances: Object.keys(COUNTERS).map(c => balance(e.id, c, year)), arrears: vacationArrears(e.id) };
  });
  // Anteprima: quanto consuma e cosa succede, prima di inviare.
  r.post('/absences/preview', req => {
    const b = req.body || {};
    const me = viewerEmployee(req);
    const e = employee(b.employee_id || me?.id || 0);
    if (!canRequestFor(req, e)) throw new HttpError(403, 'Non puoi inserire assenze per questa persona.');
    const t = typeById(b.absence_type_id);
    const f = absenceInput(e, { ...b, protocol: b.protocol || 'anteprima' }, t);
    const m = measure(e, t, f);
    const warnings = [];
    const over = balanceCheck(e, t, { ...f, amount: m.amount });
    if (over) warnings.push(over);
    for (const p of t.flow === 'approvazione' ? blockPeriodsFor(e, f.start_date, f.end_date) : []) warnings.push(`${p.mode === 'blocco' ? 'Periodo bloccato' : 'Periodo sconsigliato'}: «${p.name}».`);
    const { approver } = approverFor(e.id, me);
    return { amount: m.amount, unit: t.unit, amount_label: fmtAmount(m.amount, t.unit), work_days: m.days.length, approver: approver ? fullName(employee(approver)) : null, warnings };
  });

  // ── Job: al delegato dopo N giorni di attesa ────────────────────────────────
  function escalatePending(nowMs = Date.now()) {
    const limit = new Date(nowMs - absenceSettings().escalation_days * 86400000).toISOString();
    let n = 0;
    for (const a of db.prepare("SELECT * FROM absences WHERE status = 'richiesta' AND escalated_at IS NULL AND submitted_at <= ?").all(limit)) {
      const e = employee(a.employee_id), t = typeById(a.absence_type_id);
      const delegate = a.delegate_employee_id && a.delegate_employee_id !== a.approver_employee_id ? a.delegate_employee_id : null;
      events.transaction(() => {
        const changed = db.prepare("UPDATE absences SET escalated_at = ?, updated_at = ? WHERE id = ? AND escalated_at IS NULL").run(now(), now(), a.id).changes;
        if (!changed) return;
        const to = delegate && userOfEmployee(delegate) ? [userOfEmployee(delegate)] : hrFile.hrRecipients();
        notifyAll(to, { kind: 'hr.absence.escalated', title: `In attesa da ${absenceSettings().escalation_days} giorni: ${fullName(e)}, ${describe(a, t)}`,
          body: delegate ? 'Passata a te come delegato: puoi approvarla o rifiutarla.' : 'Nessun delegato: decide l\'ufficio del personale.', link: LINK, dedupeKey: `absence:${a.id}:escalated` });
        n++;
      });
    }
    return n;
  }
  scheduler.register('hr.absence-escalation', 60, () => `${escalatePending()} richieste passate al delegato`);

  // ── Job: visita di rientro dopo oltre 60 giorni continuativi di assenza per salute ─
  function healthSpans(employeeId) {
    const rows = db.prepare(`SELECT a.start_date, a.end_date FROM absences a JOIN absence_types t ON t.id = a.absence_type_id
      WHERE a.employee_id = ? AND t.health = 1 AND a.status IN ('approvata', 'comunicata', 'presa_visione') ORDER BY a.start_date`).all(employeeId);
    const spans = [];
    for (const x of rows) {
      const last = spans[spans.length - 1];
      if (last && x.start_date <= addDays(last.end, 1)) { if (x.end_date > last.end) last.end = x.end_date; }
      else spans.push({ start: x.start_date, end: x.end_date });
    }
    return spans.map(s => ({ ...s, days: daysBetween(s.start, s.end) + 1 }));
  }
  function createReturnVisits(date = today()) {
    let n = 0;
    for (const e of db.prepare('SELECT * FROM employees WHERE active = 1').all()) {
      for (const s of healthSpans(e.id).filter(x => x.days > 60 && x.end < date)) {
        const back = addDays(s.end, 1);
        const role = hrSafety.roleAt(e.id, back);
        if (!role?.medical_surveillance) continue; // la visita di rientro fa parte della sorveglianza sanitaria
        const res = db.prepare('INSERT OR IGNORE INTO hr_tasks (employee_id, kind, title, due_date, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(e.id, 'visita_rientro', `Visita medica di rientro (assenza per salute di ${s.days} giorni)`, back, `rientro:${e.id}:${s.start}:${s.end}`, now());
        if (res.changes) {
          n++;
          const approver = hr.resolveApprover(e.id)?.approver;
          notifyAll([...hrFile.hrRecipients(), userOfEmployee(approver?.id)], { kind: 'hr.return_visit', title: `${fullName(e)}: visita medica di rientro da fare`,
            body: `Rientro il ${itDate(back)} dopo ${s.days} giorni di assenza per motivi di salute.`, link: `/portal.html?workspace=people&employee=${e.id}&tab=sicurezza`, dedupeKey: `rientro:${e.id}:${s.start}` });
        }
      }
    }
    return n;
  }
  scheduler.register('hr.return-visits', 24 * 60, () => `${createReturnVisits()} visite di rientro create`);

  // ── Consumer: infortunio registrato → assenza "Infortunio" collegata ────────
  // La prognosi decorre dal giorno successivo all'evento; il numero INAIL resta sull'assenza.
  function syncIncidentAbsence(p) {
    if (p.kind !== 'infortunio' || !p.employee_id) return;
    const t = db.prepare("SELECT * FROM absence_types WHERE code = 'infortunio'").get();
    if (!t) return;
    const e = employee(p.employee_id);
    const existing = db.prepare('SELECT * FROM absences WHERE incident_id = ?').get(p.incident_id);
    if (!p.prognosis_days) {
      if (existing && existing.inail_number !== (p.inail_number || null)) db.prepare('UPDATE absences SET inail_number = ?, updated_at = ? WHERE id = ?').run(p.inail_number || null, now(), existing.id);
      return;
    }
    const start = addDays(p.occurred_on, 1), end = addDays(start, p.prognosis_days - 1);
    if (!existing) {
      createAbsence({ e, t, b: { start_date: start, end_date: end, part: 'giorno', from_incident: true, note: 'Dal registro infortuni' }, source: { incident_id: p.incident_id, inail_number: p.inail_number || null, by: 'Registro infortuni' }, dispatch: false });
      return;
    }
    if (existing.status === 'annullata') return;
    if (existing.start_date === start && existing.end_date === end) {
      db.prepare('UPDATE absences SET inail_number = ?, updated_at = ? WHERE id = ?').run(p.inail_number || null, now(), existing.id);
      return;
    }
    // Prognosi cambiata: si aggiornano date e quantità; le presenze rigenerano le righe.
    const m = measure(e, t, { ...existing, start_date: start, end_date: end }, { allowEmpty: true });
    revertEffects(existing);
    db.prepare('UPDATE absences SET start_date = ?, end_date = ?, amount = ?, work_minutes = ?, inail_number = ?, updated_at = ? WHERE id = ?').run(start, end, m.amount, m.work_minutes, p.inail_number || null, now(), existing.id);
    applyEffects(absence(existing.id));
  }
  events.on('incident.recorded', 'hr-absences.incident-absence', ev => syncIncidentAbsence(ev.payload));
  events.on('incident.updated', 'hr-absences.incident-absence-update', ev => syncIncidentAbsence(ev.payload));

  // ── Enoturismo: disponibilità degli operatori ───────────────────────────────
  const employeeForOperator = operatorId => db.prepare('SELECT e.* FROM operators o JOIN employees e ON e.portal_user_id = o.portal_user_id WHERE o.id = ?').get(operatorId) || null;
  const bookingWindow = bookingId => db.prepare(`SELECT b.id, b.language, b.status, b.operator_id, s.date, s.time, e.duration_minutes, e.name_it AS experience_name
    FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN experiences e ON e.id = b.experience_id WHERE b.id = ?`).get(bookingId) || null;
  function absenceCovers(a, date, start, end) {
    if (a.start_date > date || a.end_date < date) return false;
    if (a.part === 'giorno') return true;
    if (a.part === 'ore') return a.start_time < end && a.end_time > start;
    return a.part === 'mattina' ? start < MIDDAY : end > MIDDAY;
  }
  // Blocchi (assenza valida nello stesso orario) e avvisi (lingua non parlata) per un operatore su una prenotazione.
  // Il motivo dell'assenza non si mostra: all'Enoturismo basta sapere che la persona è assente.
  function operatorCheck(operatorId, bookingId) {
    const out = { blocks: [], warnings: [] };
    const e = operatorId ? employeeForOperator(operatorId) : null;
    const bk = bookingWindow(bookingId);
    if (!e || !bk) return out;
    const start = bk.time, end = fromMin(Math.min(toMin(bk.time) + (bk.duration_minutes || 60), 24 * 60 - 1));
    const absent = db.prepare(`SELECT * FROM absences WHERE employee_id = ? AND status IN ('approvata', 'comunicata', 'presa_visione') AND start_date <= ? AND end_date >= ?`).all(e.id, bk.date, bk.date)
      .find(a => absenceCovers(a, bk.date, start, end));
    if (absent) out.blocks.push(`${fullName(e)} è assente il ${itDate(bk.date)}${absent.part === 'giorno' ? '' : absent.part === 'ore' ? ` dalle ${absent.start_time} alle ${absent.end_time}` : ` di ${absent.part}`}: non è assegnabile a questa visita.`);
    const langs = hrFile.languagesOf(e.id);
    if (langs.length && bk.language && !langs.includes(bk.language)) out.warnings.push(`${fullName(e)} non parla ${LANGUAGES[bk.language] || bk.language}: la visita è in ${LANGUAGES[bk.language] || bk.language}.`);
    return out;
  }
  // Per l'elenco prenotazioni: segnala le assegnazioni in conflitto con un'assenza valida.
  function bookingFlags(rows) {
    return rows.map(b => {
      if (!b.operator_id || b.status === 'annullata') return b;
      const chk = operatorCheck(b.operator_id, b.id);
      return chk.blocks.length || chk.warnings.length ? { ...b, operator_conflict: chk.blocks[0] || null, operator_warning: chk.warnings[0] || null } : b;
    });
  }
  // Quando un'assenza diventa valida: le prenotazioni già assegnate a quella persona in quelle date vanno segnalate all'Enoturismo.
  function enoturismoUsers() {
    const roles = db.prepare('SELECT id, workspaces FROM roles').all().filter(ro => { try { return JSON.parse(ro.workspaces).includes('enoturismo'); } catch { return false; } }).map(ro => ro.id);
    const users = roles.length ? db.prepare(`SELECT id FROM portal_users WHERE active = 1 AND role_id IN (${roles.map(() => '?').join(',')})`).all(...roles).map(u => u.id) : [];
    return [null, ...users];
  }
  function flagBookingConflicts(ev) {
    const a = db.prepare('SELECT * FROM absences WHERE id = ?').get(ev.payload.absence_id);
    if (!a || !VALID.includes(a.status)) return;
    const e = employee(a.employee_id);
    if (!e.portal_user_id) return;
    const rows = db.prepare(`SELECT b.id, b.operator_id, s.date, s.time, x.name_it AS experience_name FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN experiences x ON x.id = b.experience_id
      JOIN operators o ON o.id = b.operator_id WHERE o.portal_user_id = ? AND b.status <> 'annullata' AND s.date BETWEEN ? AND ?`).all(e.portal_user_id, a.start_date, a.end_date);
    for (const bk of rows.filter(x => operatorCheck(x.operator_id, x.id).blocks.length)) {
      notifyAll(enoturismoUsers(), { kind: 'enoturismo.operator_absent', title: `Conflitto: ${fullName(e)} è assente il ${itDate(bk.date)}`,
        body: `È assegnato a «${bk.experience_name}» delle ${bk.time}: scegli un altro operatore.`, link: '/admin.html', dedupeKey: `absence-conflict:${a.id}:${bk.id}` });
    }
  }
  events.on('absence.approved', 'enoturismo.absence-conflicts', flagBookingConflicts);
  events.on('absence.communicated', 'enoturismo.absence-conflicts-communicated', flagBookingConflicts);

  // Disponibilità per il menu degli operatori di una prenotazione (workspace Enoturismo).
  const ops = createRouter(app, '/api/admin/operators', authAdmin);
  ops.get('/availability', req => {
    const bk = bookingWindow(req.query.booking_id);
    if (!bk) throw new HttpError(404, 'Prenotazione non trovata.');
    return db.prepare('SELECT id FROM operators WHERE active = 1').all().map(o => ({ operator_id: o.id, ...operatorCheck(o.id, bk.id) }));
  });

  // Un dipendente con assenze registrate non si elimina.
  hr.registerDeleteGuard(id => (db.prepare('SELECT COUNT(*) AS c FROM absences WHERE employee_id = ?').get(id).c ? 'assenze registrate' : null));

  return { balance, balances, vacationArrears, workDays, measure, coverage, operatorCheck, bookingFlags, escalatePending, createReturnVisits, healthSpans, registerEffectHook, approverFor, canDecide, VALID };
};
