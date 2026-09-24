// People — Fase 1: organigramma e dipendenti (nucleo minimo), sedi e festività, squadre, orario
// contrattuale, costo orario standard. API sotto /api/admin/hr (workspace "people"); l'elenco
// essenziale dei dipendenti (/hr/directory, livello "base") è visibile a tutti gli utenti interni.
// Livelli di riservatezza: l'orario contrattuale è "personale", il costo orario "retributivo".
const { parseDecimal, formatDecimal } = require('../lib/money');
const { holidaysForYear, MONTH_DAY, DATE } = require('../lib/calendar');
const { HttpError } = require('./finance');

const BASE = '/api/admin/hr';
const now = () => new Date().toISOString();
const intOrNull = v => (v === '' || v == null ? null : parseInt(v));
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

module.exports = function registerHr(app, { db, authAdmin, audit, hasAccessLevel, finance }) {
  const route = handler => (req, res) => {
    try {
      const out = handler(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      if (/UNIQUE constraint failed: employees.portal_user_id/.test(e.message)) return res.status(409).json({ error: 'Questo utente del portale è già collegato a un altro dipendente.' });
      if (/UNIQUE constraint failed: (sites.name|teams.name)/.test(e.message)) return res.status(409).json({ error: 'Nome già usato.' });
      if (/UNIQUE constraint failed: employee_hourly_costs/.test(e.message)) return res.status(409).json({ error: 'Esiste già un costo orario con questa decorrenza.' });
      console.error(e);
      res.status(500).json({ error: 'Errore interno.' });
    }
  };
  const get = (p, h) => app.get(BASE + p, authAdmin, route(h));
  const post = (p, h) => app.post(BASE + p, authAdmin, route(h));
  const patch = (p, h) => app.patch(BASE + p, authAdmin, route(h));
  const put = (p, h) => app.put(BASE + p, authAdmin, route(h));
  const del = (p, h) => app.delete(BASE + p, authAdmin, route(h));
  const requireLevel = (req, level) => {
    if (!hasAccessLevel(req, level)) throw new HttpError(403, `Serve il livello di accesso "${level}" per questi dati.`);
  };

  // ── Sedi e festività ─────────────────────────────────────────────────────────
  function siteFields(body, existing = {}) {
    const pick = k => (body[k] !== undefined ? (String(body[k]).trim() || null) : existing[k] ?? null);
    const f = { name: pick('name'), address: pick('address'), city: pick('city'), province: pick('province'), patron_day: pick('patron_day'), patron_name: pick('patron_name') };
    if (!f.name) throw new HttpError(400, 'Il nome della sede è obbligatorio.');
    if (f.patron_day && !MONTH_DAY.test(f.patron_day)) throw new HttpError(400, 'Giorno del patrono nel formato MM-GG (es. 10-10).');
    f.active = body.active !== undefined ? (body.active ? 1 : 0) : existing.active ?? 1;
    return f;
  }
  get('/sites', () => db.prepare('SELECT * FROM sites ORDER BY name').all());
  post('/sites', req => {
    const f = siteFields(req.body || {});
    const id = Number(db.prepare('INSERT INTO sites (name, address, city, province, patron_day, patron_name, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.name, f.address, f.city, f.province, f.patron_day, f.patron_name, f.active, now()).lastInsertRowid);
    audit(req, 'site.created', { entity: 'site', entityId: id, after: f });
    return { success: true, id };
  });
  patch('/sites/:id', req => {
    const before = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
    if (!before) throw new HttpError(404, 'Sede non trovata.');
    const f = siteFields(req.body || {}, before);
    db.prepare('UPDATE sites SET name = ?, address = ?, city = ?, province = ?, patron_day = ?, patron_name = ?, active = ? WHERE id = ?')
      .run(f.name, f.address, f.city, f.province, f.patron_day, f.patron_name, f.active, before.id);
    audit(req, 'site.updated', { entity: 'site', entityId: before.id, before, after: f });
    return { success: true };
  });

  // Calendario di un anno per una sede: nazionali + della sede + patrono + Pasqua/Pasquetta.
  function calendar(year, siteId) {
    const site = siteId ? db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId) : null;
    const entries = db.prepare(`SELECT * FROM holidays WHERE site_id IS NULL ${site ? 'OR site_id = ?' : ''}`).all(...(site ? [site.id] : []));
    return holidaysForYear(year, { entries, patronDay: site?.patron_day, patronName: site?.patron_name ? `Santo patrono (${site.patron_name})` : 'Santo patrono' });
  }
  get('/holidays', req => {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const siteId = intOrNull(req.query.site_id);
    const entries = db.prepare(`SELECT * FROM holidays WHERE site_id IS NULL ${siteId ? 'OR site_id = ?' : ''} ORDER BY site_id IS NOT NULL, COALESCE(month_day, date)`).all(...(siteId ? [siteId] : []));
    return { year, site_id: siteId, entries, calendar: calendar(year, siteId) };
  });
  post('/holidays', req => {
    const { site_id, name, month_day, date } = req.body || {};
    if (!name?.trim()) throw new HttpError(400, 'Il nome della festività è obbligatorio.');
    if (!!month_day === !!date) throw new HttpError(400, 'Indica un giorno che si ripete ogni anno (MM-GG) oppure una data precisa.');
    if (month_day && !MONTH_DAY.test(month_day)) throw new HttpError(400, 'Giorno nel formato MM-GG.');
    if (date && !DATE.test(date)) throw new HttpError(400, 'Data nel formato AAAA-MM-GG.');
    const siteId = intOrNull(site_id);
    if (siteId && !db.prepare('SELECT 1 FROM sites WHERE id = ?').get(siteId)) throw new HttpError(400, 'Sede non trovata.');
    const id = Number(db.prepare('INSERT INTO holidays (site_id, name, month_day, date) VALUES (?, ?, ?, ?)').run(siteId, name.trim(), month_day || null, date || null).lastInsertRowid);
    audit(req, 'holiday.created', { entity: 'holiday', entityId: id, after: { site_id: siteId, name, month_day, date } });
    return { success: true, id };
  });
  del('/holidays/:id', req => {
    const h = db.prepare('SELECT * FROM holidays WHERE id = ?').get(req.params.id);
    if (!h) throw new HttpError(404, 'Festività non trovata.');
    db.prepare('DELETE FROM holidays WHERE id = ?').run(h.id);
    audit(req, 'holiday.deleted', { entity: 'holiday', entityId: h.id, before: h });
    return { success: true };
  });

  // ── Dipendenti ───────────────────────────────────────────────────────────────
  const employeeRow = id => db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  function employee(id) {
    const e = employeeRow(id);
    if (!e) throw new HttpError(404, 'Dipendente non trovato.');
    return e;
  }
  const fullName = e => (e ? `${e.first_name} ${e.last_name}` : null);

  // Chi approva per un dipendente: il suo responsabile se attivo, altrimenti si sale di livello
  // lungo la catena dei responsabili. Il delegato è quello del dipendente, altrimenti quello del
  // responsabile trovato. (Base per le approvazioni di assenze e timesheet della Fase 2.)
  function resolveApprover(employeeId) {
    const e = employeeRow(employeeId);
    if (!e) return null;
    const seen = new Set([e.id]);
    const skipped = [];
    let m = e.manager_id ? employeeRow(e.manager_id) : null;
    while (m && !m.active) {
      skipped.push(m.id);
      if (seen.has(m.id)) { m = null; break; }
      seen.add(m.id);
      m = m.manager_id ? employeeRow(m.manager_id) : null;
    }
    const candidates = [e.delegate_id, m?.delegate_id].filter(Boolean).map(employeeRow);
    const delegate = candidates.find(d => d && d.active && d.id !== e.id && d.id !== m?.id) || null;
    return {
      approver: m ? { id: m.id, name: fullName(m) } : null,
      delegate: delegate ? { id: delegate.id, name: fullName(delegate) } : null,
      escalated: skipped.length > 0, skipped,
    };
  }

  function employeeFields(body, existing = null) {
    const pick = (k, conv = v => v) => (body[k] !== undefined ? conv(body[k]) : existing?.[k] ?? null);
    const text = v => (String(v ?? '').trim() || null);
    const f = {
      first_name: pick('first_name', text), last_name: pick('last_name', text), job_title: pick('job_title', text),
      work_email: pick('work_email', v => text(v)?.toLowerCase() ?? null), work_phone: pick('work_phone', text),
      portal_user_id: pick('portal_user_id', intOrNull), site_id: pick('site_id', intOrNull), cost_center_id: pick('cost_center_id', intOrNull),
      manager_id: pick('manager_id', intOrNull), delegate_id: pick('delegate_id', intOrNull),
      active: body.active !== undefined ? (body.active ? 1 : 0) : existing ? existing.active : 1,
    };
    if (!f.first_name || !f.last_name) throw new HttpError(400, 'Nome e cognome sono obbligatori.');
    if (f.site_id && !db.prepare('SELECT 1 FROM sites WHERE id = ?').get(f.site_id)) throw new HttpError(400, 'Sede non trovata.');
    if (f.portal_user_id && !db.prepare('SELECT 1 FROM portal_users WHERE id = ?').get(f.portal_user_id)) throw new HttpError(400, 'Utente del portale non trovato.');
    if (f.cost_center_id && (!existing || existing.cost_center_id !== f.cost_center_id)) finance.assertImputable(f.cost_center_id);
    for (const [k, what] of [['manager_id', 'Il responsabile'], ['delegate_id', 'Il delegato']]) {
      if (f[k] == null) continue;
      if (existing && f[k] === existing.id) throw new HttpError(400, `${what} non può essere il dipendente stesso.`);
      if (!employeeRow(f[k])) throw new HttpError(400, `${what} indicato non esiste.`);
    }
    // Niente cicli: risalendo dai responsabili non si deve tornare al dipendente.
    if (existing && f.manager_id) {
      for (let m = employeeRow(f.manager_id), guard = 0; m && guard < 100; m = m.manager_id ? employeeRow(m.manager_id) : null, guard++) {
        if (m.id === existing.id) throw new HttpError(400, 'Il responsabile scelto dipende (direttamente o no) da questo dipendente: si creerebbe un ciclo.');
      }
    }
    return f;
  }

  const LIST_SQL = `SELECT e.*, s.name AS site_name, c.code AS cost_center_code, c.name AS cost_center_name,
      m.first_name || ' ' || m.last_name AS manager_name, pu.username AS portal_username
    FROM employees e LEFT JOIN sites s ON s.id = e.site_id LEFT JOIN cost_centers c ON c.id = e.cost_center_id
    LEFT JOIN employees m ON m.id = e.manager_id LEFT JOIN portal_users pu ON pu.id = e.portal_user_id`;

  // Livello "base": visibile a chiunque abbia accesso al portale.
  get('/directory', () => db.prepare(`SELECT e.id, e.first_name, e.last_name, e.job_title, e.work_email, e.work_phone, s.name AS site_name
    FROM employees e LEFT JOIN sites s ON s.id = e.site_id WHERE e.active = 1 ORDER BY e.last_name, e.first_name`).all());

  get('/employees', () => db.prepare(`${LIST_SQL} ORDER BY e.active DESC, e.last_name, e.first_name`).all());

  get('/employees/:id', req => {
    const e = db.prepare(`${LIST_SQL} WHERE e.id = ?`).get(req.params.id);
    if (!e) throw new HttpError(404, 'Dipendente non trovato.');
    e.delegate_name = fullName(e.delegate_id ? employeeRow(e.delegate_id) : null);
    e.teams = db.prepare('SELECT t.id, t.name, t.leader_employee_id = ? AS is_leader FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.employee_id = ? ORDER BY t.name').all(e.id, e.id);
    e.reports = db.prepare("SELECT id, first_name || ' ' || last_name AS name, active FROM employees WHERE manager_id = ? ORDER BY last_name").all(e.id);
    e.approval = resolveApprover(e.id);
    e.can_see_schedule = hasAccessLevel(req, 'personale');
    e.can_see_costs = hasAccessLevel(req, 'retributivo');
    if (e.can_see_schedule) e.schedule = currentSchedule(e.id);
    if (e.can_see_costs) e.hourly_costs = hourlyCosts(e.id);
    return e;
  });

  post('/employees', req => {
    const f = employeeFields(req.body || {});
    const id = Number(db.prepare(`INSERT INTO employees (first_name, last_name, job_title, work_email, work_phone, portal_user_id, site_id, cost_center_id, manager_id, delegate_id, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.first_name, f.last_name, f.job_title, f.work_email, f.work_phone, f.portal_user_id, f.site_id, f.cost_center_id, f.manager_id, f.delegate_id, f.active, now(), now()).lastInsertRowid);
    audit(req, 'employee.created', { entity: 'employee', entityId: id, after: f });
    return { success: true, id };
  });

  patch('/employees/:id', req => {
    const before = employee(req.params.id);
    const f = employeeFields(req.body || {}, before);
    db.prepare(`UPDATE employees SET first_name = ?, last_name = ?, job_title = ?, work_email = ?, work_phone = ?, portal_user_id = ?, site_id = ?, cost_center_id = ?,
      manager_id = ?, delegate_id = ?, active = ?, updated_at = ? WHERE id = ?`)
      .run(f.first_name, f.last_name, f.job_title, f.work_email, f.work_phone, f.portal_user_id, f.site_id, f.cost_center_id, f.manager_id, f.delegate_id, f.active, now(), before.id);
    audit(req, 'employee.updated', { entity: 'employee', entityId: before.id, before, after: f });
    return { success: true };
  });

  del('/employees/:id', req => {
    const e = employee(req.params.id);
    const refs = db.prepare(`SELECT
      (SELECT COUNT(*) FROM employees WHERE manager_id = ? OR delegate_id = ?) +
      (SELECT COUNT(*) FROM teams WHERE leader_employee_id = ?) +
      (SELECT COUNT(*) FROM employee_hourly_costs WHERE employee_id = ?) AS c`).get(e.id, e.id, e.id, e.id).c;
    if (refs) throw new HttpError(409, `${fullName(e)} ha collaboratori, squadre o costi orari collegati: non si elimina, disattivalo.`);
    db.prepare('DELETE FROM employees WHERE id = ?').run(e.id);
    audit(req, 'employee.deleted', { entity: 'employee', entityId: e.id, before: e });
    return { success: true };
  });

  get('/employees/:id/approver', req => { employee(req.params.id); return resolveApprover(parseInt(req.params.id)); });

  // Utenti del portale da collegare ai dipendenti (solo i dati che servono a sceglierli).
  get('/portal-users', () => db.prepare(`SELECT pu.id, pu.name, pu.username, pu.active, e.id AS employee_id
    FROM portal_users pu LEFT JOIN employees e ON e.portal_user_id = pu.id ORDER BY pu.name`).all());

  // ── Orario contrattuale (livello "personale") ────────────────────────────────
  function currentSchedule(employeeId, date = new Date().toISOString().slice(0, 10)) {
    const from = db.prepare('SELECT MAX(valid_from) AS v FROM work_schedules WHERE employee_id = ? AND valid_from <= ?').get(employeeId, date).v;
    if (!from) return null;
    const rows = db.prepare('SELECT weekday, minutes FROM work_schedules WHERE employee_id = ? AND valid_from = ?').all(employeeId, from);
    const days = Object.fromEntries(WEEKDAYS.map(d => [d, rows.find(r => r.weekday === d)?.minutes ?? 0]));
    return { valid_from: from, days, weekly_minutes: Object.values(days).reduce((s, m) => s + m, 0) };
  }
  put('/employees/:id/schedule', req => {
    requireLevel(req, 'personale');
    const e = employee(req.params.id);
    const { valid_from, days } = req.body || {};
    if (!DATE.test(valid_from || '')) throw new HttpError(400, 'Decorrenza nel formato AAAA-MM-GG.');
    const minutes = WEEKDAYS.map(d => {
      let m;
      try { m = parseDecimal(days?.[d] ?? '0', 2); } catch (err) { throw new HttpError(400, err.message); }
      m = Math.round(((m ?? 0) * 60) / 100); // ore con due decimali → minuti
      if (m > 1440) throw new HttpError(400, 'Un giorno non può avere più di 24 ore.');
      return [d, m];
    });
    const ins = db.prepare('INSERT INTO work_schedules (employee_id, valid_from, weekday, minutes) VALUES (?, ?, ?, ?)');
    db.exec('SAVEPOINT schedule');
    try {
      db.prepare('DELETE FROM work_schedules WHERE employee_id = ? AND valid_from = ?').run(e.id, valid_from);
      for (const [d, m] of minutes) ins.run(e.id, valid_from, d, m);
      db.exec('RELEASE schedule');
    } catch (err) { db.exec('ROLLBACK TO schedule'); db.exec('RELEASE schedule'); throw err; }
    audit(req, 'employee.schedule_set', { entity: 'employee', entityId: e.id, after: { valid_from, minutes: Object.fromEntries(minutes) } });
    return { success: true };
  });

  // ── Costo orario standard (livello "retributivo") ────────────────────────────
  function hourlyCosts(employeeId) {
    const rows = db.prepare('SELECT * FROM employee_hourly_costs WHERE employee_id = ? ORDER BY valid_from DESC').all(employeeId);
    return rows.map((r, i) => ({ ...r, cost_per_hour: formatDecimal(r.cost_per_hour_e4, 4), valid_to: i > 0 ? prevDay(rows[i - 1].valid_from) : null }));
  }
  const prevDay = d => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  get('/employees/:id/hourly-costs', req => { requireLevel(req, 'retributivo'); employee(req.params.id); return hourlyCosts(parseInt(req.params.id)); });
  post('/employees/:id/hourly-costs', req => {
    requireLevel(req, 'retributivo');
    const e = employee(req.params.id);
    const { valid_from, cost_per_hour, note } = req.body || {};
    if (!DATE.test(valid_from || '')) throw new HttpError(400, 'Decorrenza nel formato AAAA-MM-GG.');
    let e4;
    try { e4 = parseDecimal(cost_per_hour, 4); } catch (err) { throw new HttpError(400, err.message); }
    if (e4 == null) throw new HttpError(400, 'Indica il costo orario.');
    const id = Number(db.prepare('INSERT INTO employee_hourly_costs (employee_id, cost_per_hour_e4, valid_from, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.id, e4, valid_from, note?.trim() || null, now(), req.portalUser ? req.portalUser.name : 'Chiave master').lastInsertRowid);
    // Nel registro non si scrive l'importo: il registro è consultabile anche da chi non ha il livello retributivo.
    audit(req, 'employee.hourly_cost_added', { entity: 'employee', entityId: e.id, after: { valid_from } });
    return { success: true, id };
  });
  del('/hourly-costs/:id', req => {
    requireLevel(req, 'retributivo');
    const r = db.prepare('SELECT * FROM employee_hourly_costs WHERE id = ?').get(req.params.id);
    if (!r) throw new HttpError(404, 'Costo orario non trovato.');
    db.prepare('DELETE FROM employee_hourly_costs WHERE id = ?').run(r.id);
    audit(req, 'employee.hourly_cost_deleted', { entity: 'employee', entityId: r.employee_id, before: { valid_from: r.valid_from } });
    return { success: true };
  });

  // ── Squadre ──────────────────────────────────────────────────────────────────
  function teamInput(body) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Il nome della squadra è obbligatorio.');
    const leader = intOrNull(body.leader_employee_id);
    const members = [...new Set((Array.isArray(body.member_ids) ? body.member_ids : []).map(Number).filter(Boolean))];
    for (const id of [leader, ...members].filter(Boolean)) if (!employeeRow(id)) throw new HttpError(400, 'Dipendente non trovato.');
    if (leader && !members.includes(leader)) members.push(leader);
    return { name, leader, members, active: body.active !== undefined ? (body.active ? 1 : 0) : 1 };
  }
  function saveMembers(teamId, members) {
    db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId);
    const ins = db.prepare('INSERT INTO team_members (team_id, employee_id) VALUES (?, ?)');
    for (const m of members) ins.run(teamId, m);
  }
  get('/teams', () => {
    const teams = db.prepare("SELECT t.*, l.first_name || ' ' || l.last_name AS leader_name FROM teams t LEFT JOIN employees l ON l.id = t.leader_employee_id ORDER BY t.name").all();
    const members = db.prepare("SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.active FROM team_members tm JOIN employees e ON e.id = tm.employee_id WHERE tm.team_id = ? ORDER BY e.last_name");
    return teams.map(t => ({ ...t, members: members.all(t.id) }));
  });
  post('/teams', req => {
    const t = teamInput(req.body || {});
    db.exec('SAVEPOINT team');
    let id;
    try {
      id = Number(db.prepare('INSERT INTO teams (name, leader_employee_id, active, created_at) VALUES (?, ?, ?, ?)').run(t.name, t.leader, t.active, now()).lastInsertRowid);
      saveMembers(id, t.members);
      db.exec('RELEASE team');
    } catch (err) { db.exec('ROLLBACK TO team'); db.exec('RELEASE team'); throw err; }
    audit(req, 'team.created', { entity: 'team', entityId: id, after: t });
    return { success: true, id };
  });
  patch('/teams/:id', req => {
    const before = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!before) throw new HttpError(404, 'Squadra non trovata.');
    const current = db.prepare('SELECT employee_id FROM team_members WHERE team_id = ?').all(before.id).map(r => r.employee_id);
    const t = teamInput({ name: before.name, leader_employee_id: before.leader_employee_id, member_ids: current, active: before.active, ...req.body });
    db.exec('SAVEPOINT team');
    try {
      db.prepare('UPDATE teams SET name = ?, leader_employee_id = ?, active = ? WHERE id = ?').run(t.name, t.leader, t.active, before.id);
      saveMembers(before.id, t.members);
      db.exec('RELEASE team');
    } catch (err) { db.exec('ROLLBACK TO team'); db.exec('RELEASE team'); throw err; }
    audit(req, 'team.updated', { entity: 'team', entityId: before.id, before: { ...before, members: current }, after: t });
    return { success: true };
  });
  del('/teams/:id', req => {
    const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!t) throw new HttpError(404, 'Squadra non trovata.');
    db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
    audit(req, 'team.deleted', { entity: 'team', entityId: t.id, before: t });
    return { success: true };
  });

  return { resolveApprover, calendar, currentSchedule };
};
