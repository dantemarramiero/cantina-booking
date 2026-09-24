// Finance — Fase 1: centri di costo (albero + livelli di cascata), oggetti di costo, driver,
// regole di ribaltamento, costi diretti e cascata per periodo (simula, conferma, annulla, riesegui).
// Tutte le API sono sotto /api/admin/finance (workspace "finance"; l'elenco dei centri è leggibile
// anche da People). Importi in centesimi, quote in ppm, quantità in millesimi (lib/money.js).
const { computeCascade, validateRuleTargets, LEVEL_NAMES } = require('../lib/cascade');
const { parseDecimal, formatDecimal, PPM } = require('../lib/money');
const { PERIOD, DATE } = require('../lib/calendar');

const OBJECT_TYPES = ['annata', 'lotto', 'sku', 'operazione', 'esperienza', 'fiera', 'progetto', 'evento'];
const NATURES = ['personale', 'materie', 'servizi', 'utenze', 'ammortamenti', 'altro'];
const BASE = '/api/admin/finance';

const { HttpError } = require('../lib/http');
const now = () => new Date().toISOString();
const intOrNull = v => (v === '' || v == null ? null : parseInt(v));

module.exports = function registerFinance(app, { db, authAdmin, audit, events }) {
  // Gestore comune: gli errori di validazione diventano risposte leggibili, gli altri 500.
  const route = handler => (req, res) => {
    try {
      const out = handler(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...e.extra });
      if (/UNIQUE constraint failed: cost_centers.code|cost_objects.code|allocation_drivers.code/.test(e.message)) return res.status(409).json({ error: 'Codice già usato.' });
      console.error(e);
      res.status(500).json({ error: 'Errore interno.' });
    }
  };
  const get = (p, h) => app.get(BASE + p, authAdmin, route(h));
  const post = (p, h) => app.post(BASE + p, authAdmin, route(h));
  const patch = (p, h) => app.patch(BASE + p, authAdmin, route(h));
  const put = (p, h) => app.put(BASE + p, authAdmin, route(h));
  const del = (p, h) => app.delete(BASE + p, authAdmin, route(h));

  function checkPeriod(p) {
    if (!PERIOD.test(p || '')) throw new HttpError(400, 'Periodo non valido: usa il formato AAAA-MM.');
    return p;
  }
  function confirmedRun(period) {
    return db.prepare("SELECT * FROM allocation_runs WHERE period = ? AND status = 'confermata'").get(period) || null;
  }
  // Dati di un periodo già ribaltato non si toccano: prima si annulla la cascata.
  function assertPeriodOpen(period, what) {
    if (confirmedRun(period)) throw new HttpError(409, `La cascata di ${period} è confermata: annullala prima di modificare ${what}.`);
  }

  // ── Centri di costo ──────────────────────────────────────────────────────────
  function loadCenters() {
    const rows = db.prepare('SELECT * FROM cost_centers ORDER BY code').all();
    const parents = new Set(rows.filter(r => r.parent_id != null).map(r => r.parent_id));
    return rows.map(r => ({ ...r, active: !!r.active, is_leaf: !parents.has(r.id) }));
  }
  function center(id) {
    const c = loadCenters().find(x => x.id === Number(id));
    if (!c) throw new HttpError(404, 'Centro di costo non trovato.');
    return c;
  }
  const label = c => `${c.code} ${c.name}`;
  // Cosa "usa" un centro: se c'è qualcosa, non si elimina e non può diventare un aggregato.
  function centerUsage(id) {
    const c = sql => db.prepare(sql).get(id, id).c;
    return c('SELECT COUNT(*) AS c FROM analytic_entries WHERE cost_center_id = ? OR cost_center_id = ?')
      + c('SELECT COUNT(*) AS c FROM driver_values WHERE target_center_id = ? OR target_center_id = ?')
      + c('SELECT COUNT(*) AS c FROM allocation_rules WHERE source_center_id = ? OR source_center_id = ?')
      + c('SELECT COUNT(*) AS c FROM allocation_rule_targets WHERE target_center_id = ? OR target_center_id = ?')
      + c('SELECT COUNT(*) AS c FROM allocation_entries WHERE source_center_id = ? OR target_center_id = ?')
      + c('SELECT COUNT(*) AS c FROM employees WHERE cost_center_id = ? OR cost_center_id = ?')
      + c('SELECT COUNT(*) AS c FROM timesheet_allocations WHERE cost_center_id = ? OR cost_center_id = ?');
  }
  // Un centro può ricevere costi (diretti, ore, quote) se è una foglia attiva, valida alla data.
  function assertImputable(id, date = null) {
    const c = center(id);
    if (!c.is_leaf) throw new HttpError(400, `${label(c)} è un aggregato: si imputano costi solo alle foglie.`);
    if (!c.active) throw new HttpError(400, `${label(c)} è disattivato.`);
    if (date && ((c.valid_from && date < c.valid_from) || (c.valid_to && date > c.valid_to))) {
      throw new HttpError(400, `${label(c)} non è valido alla data ${date}.`);
    }
    return c;
  }

  function centerFields(body, existing = null) {
    const f = {
      code: body.code !== undefined ? String(body.code).trim() : existing?.code,
      name: body.name !== undefined ? String(body.name).trim() : existing?.name,
      description: body.description !== undefined ? (String(body.description).trim() || null) : existing?.description ?? null,
      parent_id: body.parent_id !== undefined ? intOrNull(body.parent_id) : existing?.parent_id ?? null,
      cascade_level: body.cascade_level !== undefined ? intOrNull(body.cascade_level) : existing?.cascade_level ?? null,
      cascade_order: body.cascade_order !== undefined ? (parseInt(body.cascade_order) || 0) : existing?.cascade_order ?? 0,
      active: body.active !== undefined ? (body.active ? 1 : 0) : (existing ? (existing.active ? 1 : 0) : 1),
      valid_from: body.valid_from !== undefined ? (body.valid_from || null) : existing?.valid_from ?? null,
      valid_to: body.valid_to !== undefined ? (body.valid_to || null) : existing?.valid_to ?? null,
    };
    if (!f.code) throw new HttpError(400, 'Il codice è obbligatorio.');
    if (!f.name) throw new HttpError(400, 'Il nome è obbligatorio.');
    if (f.cascade_level != null && ![1, 2, 3, 4].includes(f.cascade_level)) throw new HttpError(400, 'Il livello di cascata va da 1 a 4.');
    for (const d of [f.valid_from, f.valid_to]) if (d && !DATE.test(d)) throw new HttpError(400, 'Date di validità nel formato AAAA-MM-GG.');
    if (f.valid_from && f.valid_to && f.valid_from > f.valid_to) throw new HttpError(400, 'La fine della validità è prima dell\'inizio.');
    if (f.parent_id != null) {
      const all = loadCenters();
      const parent = all.find(c => c.id === f.parent_id);
      if (!parent) throw new HttpError(400, 'Centro padre inesistente.');
      if (existing) {
        // Niente cicli nell'albero: il nuovo padre non può essere il centro stesso o un suo discendente.
        for (let p = parent; p; p = all.find(c => c.id === p.parent_id)) {
          if (p.id === existing.id) throw new HttpError(400, 'Il centro padre non può essere il centro stesso o un suo sotto-centro.');
        }
      }
      if (parent.is_leaf && (!existing || existing.parent_id !== parent.id) && centerUsage(parent.id)) {
        throw new HttpError(409, `${label(parent)} ha già movimenti: non può diventare un aggregato. Crea un nuovo centro padre.`);
      }
    }
    return f;
  }

  get('/cost-centers', () => loadCenters().map(c => ({ ...c, has_movements: centerUsage(c.id) > 0 })));

  post('/cost-centers', req => {
    const f = centerFields(req.body || {});
    const id = Number(db.prepare(`INSERT INTO cost_centers (code, name, description, parent_id, cascade_level, cascade_order, active, valid_from, valid_to, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.code, f.name, f.description, f.parent_id, f.cascade_level, f.cascade_order, f.active, f.valid_from, f.valid_to, now(), now()).lastInsertRowid);
    audit(req, 'cost_center.created', { entity: 'cost_center', entityId: id, after: f });
    return { success: true, id };
  });

  patch('/cost-centers/:id', req => {
    const before = center(req.params.id);
    const f = centerFields(req.body || {}, before);
    db.prepare(`UPDATE cost_centers SET code = ?, name = ?, description = ?, parent_id = ?, cascade_level = ?, cascade_order = ?, active = ?, valid_from = ?, valid_to = ?, updated_at = ? WHERE id = ?`)
      .run(f.code, f.name, f.description, f.parent_id, f.cascade_level, f.cascade_order, f.active, f.valid_from, f.valid_to, now(), before.id);
    audit(req, 'cost_center.updated', { entity: 'cost_center', entityId: before.id, before, after: f });
    return { success: true };
  });

  del('/cost-centers/:id', req => {
    const c = center(req.params.id);
    if (!c.is_leaf) throw new HttpError(409, `${label(c)} ha dei sotto-centri: eliminali o spostali prima.`);
    if (centerUsage(c.id)) throw new HttpError(409, `${label(c)} ha movimenti: non si elimina, disattivalo.`);
    db.prepare('DELETE FROM cost_centers WHERE id = ?').run(c.id);
    audit(req, 'cost_center.deleted', { entity: 'cost_center', entityId: c.id, before: c });
    return { success: true };
  });

  // ── Oggetti di costo ─────────────────────────────────────────────────────────
  function object(id) {
    const o = db.prepare('SELECT * FROM cost_objects WHERE id = ?').get(id);
    if (!o) throw new HttpError(404, 'Oggetto di costo non trovato.');
    return o;
  }
  function objectFields(body, existing = null) {
    const pick = (k, conv = v => v) => (body[k] !== undefined ? conv(body[k]) : existing?.[k] ?? null);
    const f = {
      type: pick('type', v => String(v)),
      code: pick('code', v => String(v).trim()),
      name: pick('name', v => String(v).trim()),
      status: pick('status', v => String(v)) || 'aperto',
      fair_id: pick('fair_id', intOrNull),
      experience_id: pick('experience_id', intOrNull),
      product_id: pick('product_id', intOrNull),
      vintage: pick('vintage', intOrNull),
      notes: pick('notes', v => (String(v).trim() || null)),
    };
    if (!OBJECT_TYPES.includes(f.type)) throw new HttpError(400, 'Tipo di oggetto di costo non valido.');
    if (!f.code || !f.name) throw new HttpError(400, 'Codice e nome sono obbligatori.');
    if (!['aperto', 'chiuso'].includes(f.status)) throw new HttpError(400, 'Stato non valido.');
    // Il collegamento vale solo per il tipo giusto e deve puntare a qualcosa che esiste.
    const links = { fair_id: ['fiera', 'fairs'], experience_id: ['esperienza', 'experiences'], product_id: ['sku', 'products'] };
    for (const [col, [type, table]] of Object.entries(links)) {
      if (f.type !== type) f[col] = null;
      else if (f[col] != null && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(f[col])) throw new HttpError(400, 'Il collegamento indicato non esiste.');
    }
    if (f.type !== 'annata' && f.type !== 'lotto') f.vintage = null;
    return f;
  }
  function objectUsage(id) {
    const c = sql => db.prepare(sql).get(id).c;
    return c('SELECT COUNT(*) AS c FROM analytic_entries WHERE cost_object_id = ?') + c('SELECT COUNT(*) AS c FROM driver_values WHERE target_cost_object_id = ?')
      + c('SELECT COUNT(*) AS c FROM allocation_rule_targets WHERE target_cost_object_id = ?') + c('SELECT COUNT(*) AS c FROM allocation_entries WHERE target_cost_object_id = ?');
  }

  get('/cost-objects', req => {
    let sql = `SELECT o.*, f.name AS fair_name, e.name_it AS experience_name, p.name AS product_name, p.vintage AS product_vintage
      FROM cost_objects o LEFT JOIN fairs f ON f.id = o.fair_id LEFT JOIN experiences e ON e.id = o.experience_id LEFT JOIN products p ON p.id = o.product_id WHERE 1=1`;
    const params = [];
    if (req.query.type) { sql += ' AND o.type = ?'; params.push(req.query.type); }
    if (req.query.status) { sql += ' AND o.status = ?'; params.push(req.query.status); }
    return db.prepare(sql + ' ORDER BY o.type, o.code').all(...params).map(o => ({ ...o, has_movements: objectUsage(o.id) > 0 }));
  });
  // Elenchi minimi per collegare un oggetto di costo a fiere, esperienze, bottiglie.
  get('/cost-objects/links', () => ({
    fairs: db.prepare('SELECT id, name, start_date FROM fairs ORDER BY start_date DESC, name').all(),
    experiences: db.prepare('SELECT id, name_it AS name, type FROM experiences ORDER BY name_it').all(),
    products: db.prepare('SELECT id, name, vintage FROM products ORDER BY name, vintage').all(),
  }));
  post('/cost-objects', req => {
    const f = objectFields(req.body || {});
    const id = Number(db.prepare(`INSERT INTO cost_objects (type, code, name, status, fair_id, experience_id, product_id, vintage, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.type, f.code, f.name, f.status, f.fair_id, f.experience_id, f.product_id, f.vintage, f.notes, now(), now()).lastInsertRowid);
    audit(req, 'cost_object.created', { entity: 'cost_object', entityId: id, after: f });
    return { success: true, id };
  });
  patch('/cost-objects/:id', req => {
    const before = object(req.params.id);
    const f = objectFields(req.body || {}, before);
    db.prepare(`UPDATE cost_objects SET type = ?, code = ?, name = ?, status = ?, fair_id = ?, experience_id = ?, product_id = ?, vintage = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(f.type, f.code, f.name, f.status, f.fair_id, f.experience_id, f.product_id, f.vintage, f.notes, now(), before.id);
    audit(req, 'cost_object.updated', { entity: 'cost_object', entityId: before.id, before, after: f });
    return { success: true };
  });
  del('/cost-objects/:id', req => {
    const o = object(req.params.id);
    if (objectUsage(o.id)) throw new HttpError(409, `${o.code} ha movimenti: non si elimina, chiudilo.`);
    db.prepare('DELETE FROM cost_objects WHERE id = ?').run(o.id);
    audit(req, 'cost_object.deleted', { entity: 'cost_object', entityId: o.id, before: o });
    return { success: true };
  });

  // ── Driver e loro valori ─────────────────────────────────────────────────────
  get('/drivers', () => db.prepare('SELECT * FROM allocation_drivers ORDER BY name').all().map(d => ({ ...d, active: !!d.active })));
  post('/drivers', req => {
    const { code, name, unit } = req.body || {};
    if (!code?.trim() || !name?.trim() || !unit?.trim()) throw new HttpError(400, 'Codice, nome e unità sono obbligatori.');
    const id = Number(db.prepare("INSERT INTO allocation_drivers (code, name, unit, source) VALUES (?, ?, ?, 'manuale')").run(code.trim(), name.trim(), unit.trim()).lastInsertRowid);
    audit(req, 'driver.created', { entity: 'driver', entityId: id, after: { code, name, unit } });
    return { success: true, id };
  });
  patch('/drivers/:id', req => {
    const d = db.prepare('SELECT * FROM allocation_drivers WHERE id = ?').get(req.params.id);
    if (!d) throw new HttpError(404, 'Driver non trovato.');
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : d.name;
    const unit = req.body?.unit !== undefined ? String(req.body.unit).trim() : d.unit;
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : d.active;
    if (!name || !unit) throw new HttpError(400, 'Nome e unità sono obbligatori.');
    db.prepare('UPDATE allocation_drivers SET name = ?, unit = ?, active = ? WHERE id = ?').run(name, unit, active, d.id);
    audit(req, 'driver.updated', { entity: 'driver', entityId: d.id, before: d, after: { name, unit, active } });
    return { success: true };
  });

  function rulesValidIn(period) {
    const rules = db.prepare('SELECT * FROM allocation_rules WHERE valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?) ORDER BY id').all(period, period);
    const targets = db.prepare('SELECT * FROM allocation_rule_targets WHERE rule_id = ? ORDER BY id');
    return rules.map(r => ({ ...r, targets: targets.all(r.id) }));
  }
  function targetLabel(t, centers, objects) {
    if (t.target_center_id != null) { const c = centers.get(t.target_center_id); return c ? label(c) : `centro ${t.target_center_id}`; }
    const o = objects.get(t.target_cost_object_id);
    return o ? `${o.code} ${o.name}` : `oggetto ${t.target_cost_object_id}`;
  }
  const centersMap = () => new Map(loadCenters().map(c => [c.id, c]));
  const objectsMap = () => new Map(db.prepare('SELECT * FROM cost_objects').all().map(o => [o.id, o]));

  // Valori di un driver in un periodo, con l'elenco delle destinazioni che li richiedono
  // (quelle delle regole valide nel periodo che usano quel driver).
  get('/driver-values', req => {
    const period = checkPeriod(req.query.period);
    const driverId = parseInt(req.query.driver_id);
    if (!driverId) throw new HttpError(400, 'Indica il driver.');
    const centers = centersMap(), objects = objectsMap();
    const values = db.prepare('SELECT * FROM driver_values WHERE driver_id = ? AND period = ?').all(driverId, period);
    const byKey = new Map(values.map(v => [v.target_center_id != null ? `c${v.target_center_id}` : `o${v.target_cost_object_id}`, v]));
    const destinations = new Map();
    for (const r of rulesValidIn(period).filter(r => r.driver_id === driverId)) {
      for (const t of r.targets) {
        const key = t.target_center_id != null ? `c${t.target_center_id}` : `o${t.target_cost_object_id}`;
        destinations.set(key, { target_center_id: t.target_center_id, target_cost_object_id: t.target_cost_object_id, label: targetLabel(t, centers, objects) });
      }
    }
    for (const [key, v] of byKey) if (!destinations.has(key)) destinations.set(key, { target_center_id: v.target_center_id, target_cost_object_id: v.target_cost_object_id, label: targetLabel(v, centers, objects) });
    return {
      period, driver_id: driverId, locked: !!confirmedRun(period),
      rows: [...destinations.entries()].map(([key, d]) => ({ ...d, quantity: byKey.has(key) ? formatDecimal(byKey.get(key).quantity_milli, 3) : null })),
    };
  });

  put('/driver-values', req => {
    const { driver_id, values } = req.body || {};
    const period = checkPeriod(req.body?.period);
    assertPeriodOpen(period, 'i valori dei driver');
    if (!db.prepare('SELECT 1 FROM allocation_drivers WHERE id = ?').get(driver_id)) throw new HttpError(400, 'Driver non trovato.');
    if (!Array.isArray(values)) throw new HttpError(400, 'Valori mancanti.');
    const rows = values.map(v => {
      const centerId = intOrNull(v.target_center_id), objectId = intOrNull(v.target_cost_object_id);
      if ((centerId == null) === (objectId == null)) throw new HttpError(400, 'Ogni valore è di un centro oppure di un oggetto di costo.');
      if (centerId != null) assertImputable(centerId);
      else object(objectId);
      let quantity;
      try { quantity = parseDecimal(v.quantity, 3); } catch (e) { throw new HttpError(400, e.message); }
      return { centerId, objectId, quantity };
    });
    const upsert = db.prepare(`INSERT INTO driver_values (driver_id, period, target_center_id, target_cost_object_id, quantity_milli, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (driver_id, period, COALESCE(target_center_id, 0), COALESCE(target_cost_object_id, 0)) DO UPDATE SET quantity_milli = excluded.quantity_milli, updated_at = excluded.updated_at`);
    const remove = db.prepare('DELETE FROM driver_values WHERE driver_id = ? AND period = ? AND COALESCE(target_center_id, 0) = ? AND COALESCE(target_cost_object_id, 0) = ?');
    events.transaction(() => {
      for (const r of rows) {
        if (r.quantity == null) remove.run(driver_id, period, r.centerId ?? 0, r.objectId ?? 0);
        else upsert.run(driver_id, period, r.centerId, r.objectId, r.quantity, now());
      }
    });
    audit(req, 'driver_values.saved', { entity: 'driver_values', entityId: `${driver_id}:${period}`, after: rows });
    return { success: true };
  });

  // ── Regole di ribaltamento ───────────────────────────────────────────────────
  // Ultimo periodo in cui una regola è stata usata da una cascata confermata.
  const lastUsedPeriod = ruleId => db.prepare(`SELECT MAX(r.period) AS p FROM allocation_entries e JOIN allocation_runs r ON r.id = e.run_id
    WHERE e.rule_id = ? AND r.status = 'confermata'`).get(ruleId).p;

  function ruleInput(body) {
    const sourceId = parseInt(body.source_center_id);
    const driverId = intOrNull(body.driver_id);
    const validFrom = checkPeriod(body.valid_from);
    const validTo = body.valid_to ? checkPeriod(body.valid_to) : null;
    if (validTo && validTo < validFrom) throw new HttpError(400, 'La fine della validità è prima dell\'inizio.');
    if (driverId != null && !db.prepare('SELECT 1 FROM allocation_drivers WHERE id = ?').get(driverId)) throw new HttpError(400, 'Driver non trovato.');
    const targets = (Array.isArray(body.targets) ? body.targets : []).map(t => {
      let share = null;
      if (driverId == null) {
        try { share = parseDecimal(t.share, 4); } catch (e) { throw new HttpError(400, e.message); }
        if (share == null || share <= 0) throw new HttpError(400, 'Con le percentuali fisse ogni destinazione ha una percentuale maggiore di zero.');
      }
      return { target_center_id: intOrNull(t.target_center_id), target_cost_object_id: intOrNull(t.target_cost_object_id), share_ppm: share };
    });
    const centers = centersMap();
    const errors = validateRuleTargets(centers.get(sourceId), targets, centers);
    for (const t of targets) if (t.target_cost_object_id != null && !db.prepare('SELECT 1 FROM cost_objects WHERE id = ?').get(t.target_cost_object_id)) errors.push('Oggetto di costo inesistente.');
    if (driverId == null && targets.length && targets.reduce((s, t) => s + t.share_ppm, 0) !== PPM) errors.push('Le percentuali devono fare esattamente 100%.');
    if (errors.length) throw new HttpError(400, errors.join(' '));
    return { sourceId, driverId, validFrom, validTo, note: body.note?.trim() || null, targets };
  }
  function assertNoOverlap({ sourceId, validFrom, validTo }, exceptId = 0) {
    const clash = db.prepare(`SELECT * FROM allocation_rules WHERE source_center_id = ? AND id != ?
      AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)`).get(sourceId, exceptId, validTo || '9999-12', validFrom);
    if (clash) throw new HttpError(409, `Esiste già una regola per questo centro valida da ${clash.valid_from}${clash.valid_to ? ` a ${clash.valid_to}` : ' senza fine'}: chiudila prima.`);
  }
  function saveTargets(ruleId, targets) {
    db.prepare('DELETE FROM allocation_rule_targets WHERE rule_id = ?').run(ruleId);
    const ins = db.prepare('INSERT INTO allocation_rule_targets (rule_id, target_center_id, target_cost_object_id, share_ppm) VALUES (?, ?, ?, ?)');
    for (const t of targets) ins.run(ruleId, t.target_center_id, t.target_cost_object_id, t.share_ppm);
  }

  get('/rules', req => {
    const centers = centersMap(), objects = objectsMap();
    const drivers = new Map(db.prepare('SELECT * FROM allocation_drivers').all().map(d => [d.id, d]));
    let rules = db.prepare('SELECT * FROM allocation_rules ORDER BY valid_from DESC, id').all();
    if (req.query.period) {
      const p = checkPeriod(req.query.period);
      rules = rules.filter(r => r.valid_from <= p && (!r.valid_to || r.valid_to >= p));
    }
    const targets = db.prepare('SELECT * FROM allocation_rule_targets WHERE rule_id = ? ORDER BY id');
    return rules.map(r => {
      const src = centers.get(r.source_center_id);
      return {
        ...r, source_label: src ? label(src) : String(r.source_center_id), source_level: src?.cascade_level ?? null,
        driver_name: r.driver_id ? drivers.get(r.driver_id)?.name : null, last_used_period: lastUsedPeriod(r.id),
        targets: targets.all(r.id).map(t => ({ ...t, label: targetLabel(t, centers, objects), share: t.share_ppm != null ? formatDecimal(t.share_ppm, 4) : null })),
      };
    }).sort((a, b) => (a.source_level ?? 9) - (b.source_level ?? 9) || a.source_label.localeCompare(b.source_label));
  });

  post('/rules', req => {
    const r = ruleInput(req.body || {});
    assertNoOverlap(r);
    const id = events.transaction(() => {
      const ruleId = Number(db.prepare('INSERT INTO allocation_rules (source_center_id, driver_id, valid_from, valid_to, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(r.sourceId, r.driverId, r.validFrom, r.validTo, r.note, now(), now()).lastInsertRowid);
      saveTargets(ruleId, r.targets);
      return ruleId;
    });
    audit(req, 'allocation_rule.created', { entity: 'allocation_rule', entityId: id, after: r });
    return { success: true, id };
  });

  patch('/rules/:id', req => {
    const before = db.prepare('SELECT * FROM allocation_rules WHERE id = ?').get(req.params.id);
    if (!before) throw new HttpError(404, 'Regola non trovata.');
    const used = lastUsedPeriod(before.id);
    if (used) {
      // Già usata da una cascata confermata: si può solo chiudere (data di fine), non cambiare.
      const keys = Object.keys(req.body || {}).filter(k => k !== 'valid_to');
      if (keys.length) throw new HttpError(409, `La regola è stata usata nella cascata di ${used}: puoi solo chiuderla con una data di fine e crearne una nuova.`);
      const validTo = req.body.valid_to ? checkPeriod(req.body.valid_to) : null;
      if (validTo && validTo < used) throw new HttpError(409, `La regola è stata usata fino a ${used}: la fine non può essere prima.`);
      assertNoOverlap({ sourceId: before.source_center_id, validFrom: before.valid_from, validTo }, before.id);
      db.prepare('UPDATE allocation_rules SET valid_to = ?, updated_at = ? WHERE id = ?').run(validTo, now(), before.id);
      audit(req, 'allocation_rule.closed', { entity: 'allocation_rule', entityId: before.id, before, after: { valid_to: validTo } });
      return { success: true };
    }
    const r = ruleInput({ source_center_id: before.source_center_id, driver_id: before.driver_id, valid_from: before.valid_from, valid_to: before.valid_to, note: before.note, ...req.body });
    assertNoOverlap(r, before.id);
    events.transaction(() => {
      db.prepare('UPDATE allocation_rules SET source_center_id = ?, driver_id = ?, valid_from = ?, valid_to = ?, note = ?, updated_at = ? WHERE id = ?')
        .run(r.sourceId, r.driverId, r.validFrom, r.validTo, r.note, now(), before.id);
      saveTargets(before.id, r.targets);
    });
    audit(req, 'allocation_rule.updated', { entity: 'allocation_rule', entityId: before.id, before, after: r });
    return { success: true };
  });

  del('/rules/:id', req => {
    const rule = db.prepare('SELECT * FROM allocation_rules WHERE id = ?').get(req.params.id);
    if (!rule) throw new HttpError(404, 'Regola non trovata.');
    const used = lastUsedPeriod(rule.id);
    if (used) throw new HttpError(409, `La regola è stata usata nella cascata di ${used}: chiudila con una data di fine invece di eliminarla.`);
    db.prepare('DELETE FROM allocation_rules WHERE id = ?').run(rule.id);
    audit(req, 'allocation_rule.deleted', { entity: 'allocation_rule', entityId: rule.id, before: rule });
    return { success: true };
  });

  // ── Costi diretti (movimenti analitici manuali) ──────────────────────────────
  get('/direct-costs', req => {
    const period = checkPeriod(req.query.period);
    const rows = db.prepare(`SELECT a.*, c.code AS center_code, c.name AS center_name, o.code AS object_code, o.name AS object_name
      FROM analytic_entries a JOIN cost_centers c ON c.id = a.cost_center_id LEFT JOIN cost_objects o ON o.id = a.cost_object_id
      WHERE a.period = ? ORDER BY a.entry_date, a.id`).all(period);
    return { period, locked: !!confirmedRun(period), total_cents: rows.reduce((s, r) => s + r.amount_cents, 0), rows };
  });
  post('/direct-costs', req => {
    const b = req.body || {};
    if (!DATE.test(b.entry_date || '')) throw new HttpError(400, 'Data nel formato AAAA-MM-GG.');
    const period = b.entry_date.slice(0, 7);
    assertPeriodOpen(period, 'i costi');
    assertImputable(b.cost_center_id, b.entry_date);
    const objectId = intOrNull(b.cost_object_id);
    if (objectId != null && object(objectId).status !== 'aperto') throw new HttpError(400, 'L\'oggetto di costo è chiuso.');
    if (!NATURES.includes(b.nature)) throw new HttpError(400, 'Natura del costo non valida.');
    let amount;
    try { amount = parseDecimal(b.amount, 2, { allowNegative: true }); } catch (e) { throw new HttpError(400, e.message); }
    if (!amount) throw new HttpError(400, 'Indica un importo diverso da zero.');
    const id = Number(db.prepare(`INSERT INTO analytic_entries (entry_date, period, amount_cents, cost_center_id, cost_object_id, nature, origin, description, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'manuale', ?, ?, ?)`).run(b.entry_date, period, amount, parseInt(b.cost_center_id), objectId, b.nature, b.description?.trim() || null, now(), actorName(req)).lastInsertRowid);
    audit(req, 'direct_cost.created', { entity: 'analytic_entry', entityId: id, after: { ...b, amount_cents: amount } });
    return { success: true, id };
  });
  del('/direct-costs/:id', req => {
    const e = db.prepare('SELECT * FROM analytic_entries WHERE id = ?').get(req.params.id);
    if (!e) throw new HttpError(404, 'Movimento non trovato.');
    assertPeriodOpen(e.period, 'i costi');
    db.prepare('DELETE FROM analytic_entries WHERE id = ?').run(e.id);
    audit(req, 'direct_cost.deleted', { entity: 'analytic_entry', entityId: e.id, before: e });
    return { success: true };
  });

  // ── Cascata ──────────────────────────────────────────────────────────────────
  function gather(period) {
    const centers = loadCenters();
    const objects = db.prepare('SELECT id, code, name, status FROM cost_objects').all();
    const rules = rulesValidIn(period);
    const drivers = db.prepare('SELECT id, code, name, unit FROM allocation_drivers').all();
    const driverValues = db.prepare('SELECT driver_id, target_center_id, target_cost_object_id, quantity_milli FROM driver_values WHERE period = ?').all(period);
    const directCosts = db.prepare('SELECT cost_center_id, cost_object_id, amount_cents FROM analytic_entries WHERE period = ?').all(period);
    return { centers, objects, rules, drivers, driverValues, directCosts };
  }
  // Report ad albero: ai centri aggregati si somma quanto hanno i loro sotto-centri (foglie).
  function aggregateCenters(rowsIn, input) {
    const byId = new Map(input.centers.map(c => [c.id, c]));
    const rows = new Map(rowsIn.map(r => [r.id, { ...r, received: { ...r.received }, parent_id: byId.get(r.id)?.parent_id ?? null }]));
    for (const leaf of rowsIn.filter(r => r.is_leaf)) {
      for (let p = byId.get(leaf.id)?.parent_id; p != null; p = byId.get(p)?.parent_id) {
        const agg = rows.get(p);
        if (!agg) break;
        agg.direct += leaf.direct; agg.full_cost += leaf.full_cost; agg.allocated += leaf.allocated; agg.final += leaf.final;
        for (const l of [1, 2, 3]) agg.received[l] += leaf.received[l];
      }
    }
    return [...rows.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
  function labelEntries(entries, input) {
    const centers = new Map(input.centers.map(c => [c.id, c]));
    const objects = new Map(input.objects.map(o => [o.id, o]));
    const drivers = new Map(input.drivers.map(d => [d.id, d]));
    return entries.map(e => ({
      ...e, source_label: label(centers.get(e.source_center_id)), target_label: targetLabel(e, centers, objects),
      driver_name: e.driver_id ? drivers.get(e.driver_id)?.name : null,
      source_level_name: LEVEL_NAMES[centers.get(e.source_center_id)?.cascade_level],
    }));
  }
  function simulate(period) {
    const input = gather(period);
    const raw = computeCascade(input);
    return { input, result: { ...raw, centers: aggregateCenters(raw.centers, input), entries: labelEntries(raw.entries, input) } };
  }
  function actorName(req) {
    return req.portalUser ? req.portalUser.name : req.isMasterKey ? 'Chiave master' : 'Sistema';
  }
  function confirm(period, req) {
    const { input, result } = simulate(period);
    if (result.blocking) throw new HttpError(422, 'La cascata ha anomalie bloccanti: risolvile prima di confermare.', { anomalies: result.anomalies });
    const snapshot = JSON.stringify({ input, result: { centers: result.centers, objects: result.objects, totals: result.totals } });
    const runId = Number(db.prepare(`INSERT INTO allocation_runs (period, status, total_direct_cents, total_allocated_cents, snapshot, created_at, created_by)
      VALUES (?, 'confermata', ?, ?, ?, ?, ?)`).run(period, result.totals.direct, result.totals.allocated, snapshot, now(), actorName(req)).lastInsertRowid);
    const ins = db.prepare(`INSERT INTO allocation_entries (run_id, step, source_center_id, target_center_id, target_cost_object_id, rule_id, driver_id, base_quantity_milli, share_ppm, amount_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of result.entries) ins.run(runId, e.step, e.source_center_id, e.target_center_id, e.target_cost_object_id, e.rule_id, e.driver_id, e.base_quantity_milli, e.share_ppm, e.amount_cents);
    events.emit('allocation.run_confirmed', { sourceTable: 'allocation_runs', sourceId: runId, payload: { period, run_id: runId, total_allocated_cents: result.totals.allocated } });
    return { runId, result };
  }
  function cancel(period, req) {
    const run = confirmedRun(period);
    if (!run) throw new HttpError(409, `Non c'è una cascata confermata per ${period}.`);
    db.prepare("UPDATE allocation_runs SET status = 'annullata', cancelled_at = ?, cancelled_by = ? WHERE id = ?").run(now(), actorName(req), run.id);
    events.emit('allocation.run_cancelled', { sourceTable: 'allocation_runs', sourceId: run.id, payload: { period, run_id: run.id } });
    return run;
  }

  get('/cascade/:period', req => {
    const period = checkPeriod(req.params.period);
    const runs = db.prepare('SELECT id, period, status, total_direct_cents, total_allocated_cents, created_at, created_by, cancelled_at, cancelled_by FROM allocation_runs WHERE period = ? ORDER BY id DESC').all(period);
    const run = confirmedRun(period);
    if (!run) return { period, confirmed: null, runs };
    // Il report di una cascata confermata viene dalla sua fotografia (centri già aggregati) e dalle
    // quote salvate: non cambia se nel frattempo cambiano regole o anagrafiche.
    const snap = JSON.parse(run.snapshot);
    const entries = labelEntries(db.prepare('SELECT * FROM allocation_entries WHERE run_id = ? ORDER BY step, id').all(run.id), snap.input);
    return {
      period, runs,
      confirmed: { id: run.id, created_at: run.created_at, created_by: run.created_by, centers: snap.result.centers, objects: snap.result.objects, totals: snap.result.totals, entries, anomalies: [], blocking: false },
    };
  });
  post('/cascade/:period/simulate', req => simulate(checkPeriod(req.params.period)).result);
  post('/cascade/:period/confirm', req => {
    const period = checkPeriod(req.params.period);
    if (confirmedRun(period)) throw new HttpError(409, `La cascata di ${period} è già confermata: usa "Riesegui" per rifarla.`);
    const { runId, result } = events.transaction(() => confirm(period, req));
    audit(req, 'cascade.confirmed', { entity: 'allocation_run', entityId: runId, after: { period, totals: result.totals } });
    events.dispatch();
    return { success: true, run_id: runId, totals: result.totals };
  });
  post('/cascade/:period/cancel', req => {
    const period = checkPeriod(req.params.period);
    const run = events.transaction(() => cancel(period, req));
    audit(req, 'cascade.cancelled', { entity: 'allocation_run', entityId: run.id, before: { period, status: 'confermata' }, after: { status: 'annullata' } });
    events.dispatch();
    return { success: true };
  });
  // Annulla (se c'è) e riesegue in un'unica transazione: se la nuova esecuzione ha anomalie,
  // resta valida quella di prima. Rieseguire due volte dà lo stesso risultato.
  post('/cascade/:period/rerun', req => {
    const period = checkPeriod(req.params.period);
    const { runId, result, previous } = events.transaction(() => {
      const prev = confirmedRun(period);
      if (prev) cancel(period, req);
      return { ...confirm(period, req), previous: prev?.id ?? null };
    });
    audit(req, 'cascade.rerun', { entity: 'allocation_run', entityId: runId, before: { run_id: previous }, after: { period, totals: result.totals } });
    events.dispatch();
    return { success: true, run_id: runId, previous_run_id: previous, totals: result.totals };
  });

  // Valori di un driver calcolati da un altro modulo (es. ore lavorate dalle presenze approvate):
  // sostituiscono quelli del periodo, salvo che la cascata del periodo sia confermata.
  // values: [{ centerId, quantityMilli }]. Restituisce { locked } se non si può scrivere.
  function setComputedDriverValues(code, period, values, source) {
    const driver = db.prepare('SELECT * FROM allocation_drivers WHERE code = ?').get(code);
    if (!driver) return { missing: true };
    if (confirmedRun(period)) return { locked: true };
    events.transaction(() => {
      db.prepare('DELETE FROM driver_values WHERE driver_id = ? AND period = ?').run(driver.id, period);
      const ins = db.prepare('INSERT INTO driver_values (driver_id, period, target_center_id, quantity_milli, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const v of values.filter(x => x.quantityMilli > 0)) ins.run(driver.id, period, v.centerId, v.quantityMilli, source, new Date().toISOString());
    });
    return { written: values.length };
  }

  return { loadCenters, assertImputable, confirmedRun, setComputedDriverValues };
};

module.exports.HttpError = HttpError;
