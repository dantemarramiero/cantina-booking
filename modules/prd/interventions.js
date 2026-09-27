// Produzione — Fase 2: interventi in vigneto e trattamenti fitosanitari.
//
// Un intervento nasce bozza (anche da smartphone offline, con client_uuid: lo stesso invio due volte non
// crea due bozze), si conferma con tutti i controlli e da lì non si modifica: si storna e si ricrea (V11).
//   PRD-V01 campi obbligatori del trattamento          PRD-V02 patentino valido dell'esecutore (People)
//   PRD-V03 dose per ettaro ≤ massima del prodotto      PRD-V04 applicazioni massime nel periodo configurato
//   PRD-V05 prodotto ammesso sulle parcelle bio         PRD-V06 fine carenza e fine rientro
//   PRD-V07 intervento durante il rientro: conferma con motivo (DPI)
//   PRD-V08 registrazione tardiva segnalata             PRD-V09 attrezzatura non controllata: non conforme
//   PRD-V10 limitazione del medico sull'operazione: non può essere esecutore (People, modalità bloccante)
// Date: si salva in UTC; la data del lavoro, le carenze e i periodi si calcolano in ora italiana.
const { HttpError } = require('../../lib/http');
const { romeDate, romeDateTime, romeToUtc, campaignOf, addDays, addMonths, daysBetween } = require('../../lib/time');
const { t, labels } = require('./i18n');
const { CAN } = require('./common');

module.exports = function registerPrdInterventions(r, deps, c, cfg) {
  const { db, audit, events, hrSafety, hrTimesheet, stock } = deps;
  const { now, actor, requireCap, parseValue, fail } = c;
  const TYPES = Object.keys(labels('intervention_type'));
  // Operazione su cui People controlla patentino e idoneità. Se manca, niente trattamenti: i controlli di
  // legge non si saltano mai (il patentino si richiede comunque, anche se in People il collegamento cambia).
  const PHYTO_TRAINING = ['fitosanitari'];
  const phytoOperation = () => {
    const op = db.prepare("SELECT id FROM cost_objects WHERE code = 'OP-TRATT-FITO'").get();
    if (!op) throw new HttpError(409, t('msg.phyto_operation_missing'));
    return op.id;
  };
  const executorCheck = (employeeId, date, req) => hrSafety.assignmentCheck(employeeId, { date, costObjectId: phytoOperation(), req, strict: true, requiredTrainingCodes: PHYTO_TRAINING });
  // Chi consulta l'idoneità resta nel registro degli accessi anche se la conferma poi fallisce: il controllo
  // con il registro si fa fuori dalla transazione, quello dentro la transazione non registra di nuovo.
  function logExecutorChecks({ type, work_date, workerIds }, req) {
    if (type !== 'trattamento' || !workerIds.length) return;
    for (const id of workerIds) executorCheck(id, work_date, req);
  }
  const commit = fn => { const out = events.transaction(fn); if (!events.inTransaction()) events.dispatch(); return out; };

  // ── Date ────────────────────────────────────────────────────────────────────
  // Accetta l'ora italiana scritta nel modulo («2026-06-12T07:30») o un istante ISO con fuso.
  function toUtc(v, label) {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) fail('invalid_date', { field: label });
      return d.toISOString();
    }
    try { return romeToUtc(s); } catch { return fail('invalid_date', { field: label }); }
  }
  // Annata agraria (DP13): dal giorno configurato (predefinito 1/11) i lavori servono la vendemmia dell'anno dopo.
  function harvestYearOf(workDate) {
    const start = cfg.config('harvest_year_start') || '11-01';
    const [y, m, d] = workDate.split('-');
    return `${m}-${d}` >= start ? Number(y) + 1 : Number(y);
  }
  function campaignId(workDate) {
    cfg.ensureCampaign(workDate);
    return db.prepare('SELECT id FROM wine_campaigns WHERE label = ?').get(campaignOf(workDate).label).id;
  }

  // ── Lettura ─────────────────────────────────────────────────────────────────
  const intRow = id => {
    const row = db.prepare('SELECT * FROM parcel_interventions WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, t('msg.not_found', { what: 'Intervento' }));
    return { ...row };
  };
  function detail(id) {
    const i = intRow(id);
    i.parcels = db.prepare(`SELECT ip.parcel_id, ip.area_m2, p.code, p.name, v.name AS vineyard_name FROM parcel_intervention_parcels ip JOIN vineyard_parcels p ON p.id = ip.parcel_id
      JOIN vineyards v ON v.id = p.vineyard_id WHERE ip.intervention_id = ? ORDER BY p.code`).all(id).map(x => ({ ...x }));
    i.workers = db.prepare(`SELECT w.employee_id, w.minutes, e.first_name || ' ' || e.last_name AS name FROM parcel_intervention_workers w JOIN employees e ON e.id = w.employee_id
      WHERE w.intervention_id = ? ORDER BY e.last_name`).all(id).map(x => ({ ...x }));
    i.equipment = db.prepare(`SELECT q.id, q.name, q.type, q.plate_serial, q.last_inspection_date, q.archived_at FROM parcel_intervention_equipment ie JOIN equipment q ON q.id = ie.equipment_id
      WHERE ie.intervention_id = ? ORDER BY q.name`).all(id).map(x => ({ ...x }));
    const tr = db.prepare('SELECT * FROM phyto_treatment_details WHERE intervention_id = ?').get(id);
    i.treatment = tr ? { ...tr, products: db.prepare(`SELECT tp.*, p.commercial_name, p.registration_number, p.active_substances, p.preharvest_interval_days, p.reentry_hours, p.archived_at AS product_archived_at
      FROM phyto_treatment_products tp JOIN phyto_products p ON p.id = tp.phyto_product_id WHERE tp.intervention_id = ? ORDER BY p.commercial_name`).all(id).map(x => ({ ...x })) } : null;
    const fe = db.prepare('SELECT * FROM fertilization_details WHERE intervention_id = ?').get(id);
    i.fertilization = fe ? { ...fe } : null;
    i.started_local = romeDateTime(new Date(i.started_at));
    i.ended_local = i.ended_at ? romeDateTime(new Date(i.ended_at)) : null;
    return i;
  }

  // ── Stato della parcella (PRD-V06): il massimo tra i trattamenti confermati non stornati, iniziati entro «at» ─
  function parcelState(parcelId, at = new Date()) {
    const rows = db.prepare(`SELECT i.id, i.work_date, i.started_at, i.ended_at, d.preharvest_ends_on, d.reentry_ends_at FROM parcel_interventions i
      JOIN parcel_intervention_parcels ip ON ip.intervention_id = i.id JOIN phyto_treatment_details d ON d.intervention_id = i.id
      WHERE ip.parcel_id = ? AND i.type = 'trattamento' AND i.status = 'confirmed' AND i.started_at <= ? ORDER BY i.started_at DESC`).all(parcelId, at.toISOString());
    const today = romeDate(at);
    const preharvest = rows.reduce((m, x) => (x.preharvest_ends_on && (!m || x.preharvest_ends_on > m) ? x.preharvest_ends_on : m), null);
    const reentry = rows.reduce((m, x) => (x.reentry_ends_at && (!m || x.reentry_ends_at > m) ? x.reentry_ends_at : m), null);
    const last = rows[0] || null;
    const planned = db.prepare(`SELECT i.id, i.type, i.work_date FROM parcel_interventions i JOIN parcel_intervention_parcels ip ON ip.intervention_id = i.id
      WHERE ip.parcel_id = ? AND i.status = 'draft' AND i.work_date >= ? ORDER BY i.work_date LIMIT 5`).all(parcelId, today).map(x => ({ ...x }));
    return {
      parcel_id: parcelId,
      preharvest_ends_on: preharvest, preharvest_active: !!preharvest && preharvest > today,
      reentry_ends_at: reentry, reentry_active: !!reentry && reentry > at.toISOString(),
      last_treatment: last ? { id: last.id, work_date: last.work_date } : null, planned,
    };
  }

  // ── Scrittura della bozza ───────────────────────────────────────────────────
  function parseInput(b, existing) {
    const f = {};
    if (b.type !== undefined || !existing) f.type = parseValue({ label: 'Tipo di intervento', type: 'enum', values: TYPES, required: true }, b.type);
    if (b.started_at !== undefined || !existing) {
      f.started_at = toUtc(b.started_at, "Inizio") || fail('required', { field: 'Inizio' });
      f.work_date = romeDate(new Date(f.started_at));
    }
    if (b.ended_at !== undefined) f.ended_at = toUtc(b.ended_at, 'Fine');
    const start = f.started_at || existing?.started_at, end = f.ended_at !== undefined ? f.ended_at : existing?.ended_at;
    if (end && start && end < start) throw new HttpError(400, t('msg.int_end_before'));
    const workDate = f.work_date || existing.work_date;
    f.harvest_year = b.harvest_year != null && b.harvest_year !== '' ? parseValue({ label: 'Annata', type: 'int', min: 1990, max: 2100 }, b.harvest_year) : (f.work_date ? harvestYearOf(workDate) : existing.harvest_year);
    if (f.work_date) f.campaign_id = campaignId(workDate);
    for (const [k, label, max] of [['bbch_stage', 'Fase fenologica (BBCH)', 20], ['notes', 'Note', 2000], ['reentry_override_reason', 'Motivo (DPI)', 500]]) {
      if (b[k] !== undefined) f[k] = parseValue({ label, type: 'text', max }, b[k]);
    }
    const lists = {};
    const type = f.type || existing?.type;
    if (b.parcels !== undefined) {
      if (!Array.isArray(b.parcels)) fail('invalid_json', { field: 'Parcelle' });
      lists.parcels = b.parcels.map(p => ({
        parcel_id: parseValue({ label: 'Parcella', type: 'ref', ref: 'vineyard_parcels', required: true }, p.parcel_id),
        area_m2: parseValue({ label: 'Superficie lavorata (m²)', type: 'int', required: true, min: 1 }, p.area_m2),
      }));
    }
    if (b.workers !== undefined) {
      if (!Array.isArray(b.workers)) fail('invalid_json', { field: 'Esecutori' });
      lists.workers = b.workers.map(w => ({
        employee_id: parseValue({ label: 'Esecutore', type: 'ref', ref: 'employees', required: true }, typeof w === 'object' ? w.employee_id : w),
        minutes: typeof w === 'object' && w.minutes != null && w.minutes !== '' ? parseValue({ label: 'Minuti', type: 'int', min: 1, max: 1440 }, w.minutes) : null,
      }));
    }
    if (b.equipment_ids !== undefined) {
      if (!Array.isArray(b.equipment_ids)) fail('invalid_json', { field: 'Attrezzature' });
      lists.equipment = [...new Set(b.equipment_ids.map(x => parseValue({ label: 'Attrezzatura', type: 'ref', ref: 'equipment', required: true }, x)))];
    }
    if (type === 'trattamento' && b.treatment !== undefined && b.treatment !== null) {
      const tr = b.treatment;
      lists.treatment = {
        target_pest: parseValue({ label: 'Avversità', type: 'text', max: 200 }, tr.target_pest ?? null),
        water_volume_l_per_ha: tr.water_volume_l_per_ha != null && tr.water_volume_l_per_ha !== '' ? parseValue({ label: 'Volume d\'acqua (l/ha)', type: 'int', min: 0 }, tr.water_volume_l_per_ha) : null,
        weather_notes: parseValue({ label: 'Meteo', type: 'text', max: 500 }, tr.weather_notes ?? null),
        products: (tr.products || []).map(p => {
          const id = parseValue({ label: 'Prodotto', type: 'ref', ref: 'phyto_products', required: true }, p.phyto_product_id);
          const prod = db.prepare('SELECT dose_unit FROM phyto_products WHERE id = ?').get(id);
          return {
            phyto_product_id: id,
            dose_per_ha_e4: p.dose_per_ha != null && p.dose_per_ha !== '' ? parseValue({ label: 'Dose per ettaro', type: 'e4', min: 0 }, p.dose_per_ha) : null,
            total_quantity_e4: p.total_quantity != null && p.total_quantity !== '' ? parseValue({ label: 'Quantità totale', type: 'e4', min: 0 }, p.total_quantity) : null,
            dose_unit: prod.dose_unit,
          };
        }),
      };
    }
    if (type === 'concimazione' && b.fertilization !== undefined && b.fertilization !== null) {
      const fe = b.fertilization;
      lists.fertilization = {
        product: parseValue({ label: 'Concime', type: 'text', max: 160 }, fe.product ?? null),
        npk: parseValue({ label: 'Titolo NPK', type: 'text', max: 40 }, fe.npk ?? null),
        dose_per_ha_e4: fe.dose_per_ha != null && fe.dose_per_ha !== '' ? parseValue({ label: 'Dose per ettaro', type: 'e4', min: 0 }, fe.dose_per_ha) : null,
        total_quantity_e4: fe.total_quantity != null && fe.total_quantity !== '' ? parseValue({ label: 'Quantità totale', type: 'e4', min: 0 }, fe.total_quantity) : null,
        unit: parseValue({ label: 'Unità', type: 'text', max: 20 }, fe.unit ?? null),
      };
    }
    return { f, lists };
  }
  function saveLists(id, lists) {
    if (lists.parcels) {
      db.prepare('DELETE FROM parcel_intervention_parcels WHERE intervention_id = ?').run(id);
      const ins = db.prepare('INSERT INTO parcel_intervention_parcels (intervention_id, parcel_id, area_m2) VALUES (?, ?, ?)');
      const seen = new Set();
      for (const p of lists.parcels) { if (!seen.has(p.parcel_id)) ins.run(id, p.parcel_id, p.area_m2); seen.add(p.parcel_id); }
    }
    if (lists.workers) {
      db.prepare('DELETE FROM parcel_intervention_workers WHERE intervention_id = ?').run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO parcel_intervention_workers (intervention_id, employee_id, minutes) VALUES (?, ?, ?)');
      for (const w of lists.workers) ins.run(id, w.employee_id, w.minutes);
    }
    if (lists.equipment) {
      db.prepare('DELETE FROM parcel_intervention_equipment WHERE intervention_id = ?').run(id);
      const ins = db.prepare('INSERT INTO parcel_intervention_equipment (intervention_id, equipment_id) VALUES (?, ?)');
      for (const e of lists.equipment) ins.run(id, e);
    }
    if (lists.treatment) {
      const tr = lists.treatment;
      db.prepare(`INSERT INTO phyto_treatment_details (intervention_id, target_pest, water_volume_l_per_ha, weather_notes) VALUES (?, ?, ?, ?)
        ON CONFLICT (intervention_id) DO UPDATE SET target_pest = excluded.target_pest, water_volume_l_per_ha = excluded.water_volume_l_per_ha, weather_notes = excluded.weather_notes`)
        .run(id, tr.target_pest, tr.water_volume_l_per_ha, tr.weather_notes);
      db.prepare('DELETE FROM phyto_treatment_products WHERE intervention_id = ?').run(id);
      const ins = db.prepare('INSERT OR REPLACE INTO phyto_treatment_products (intervention_id, phyto_product_id, dose_per_ha_e4, total_quantity_e4, dose_unit) VALUES (?, ?, ?, ?, ?)');
      for (const p of tr.products) ins.run(id, p.phyto_product_id, p.dose_per_ha_e4, p.total_quantity_e4, p.dose_unit);
    }
    if (lists.fertilization) {
      const fe = lists.fertilization;
      db.prepare(`INSERT INTO fertilization_details (intervention_id, product, npk, dose_per_ha_e4, total_quantity_e4, unit) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (intervention_id) DO UPDATE SET product = excluded.product, npk = excluded.npk, dose_per_ha_e4 = excluded.dose_per_ha_e4,
        total_quantity_e4 = excluded.total_quantity_e4, unit = excluded.unit`).run(id, fe.product, fe.npk, fe.dose_per_ha_e4, fe.total_quantity_e4, fe.unit);
    }
  }

  // PRD-V07: un intervento (non di trattamento) su una parcella nel tempo di rientro richiede la conferma
  // esplicita con il motivo (DPI), che resta sull'intervento.
  function checkReentry(i) {
    if (i.type === 'trattamento' || i.reentry_override_reason) return;
    for (const p of i.parcels) {
      const s = parcelState(p.parcel_id, new Date(i.started_at));
      const until = s.reentry_ends_at && s.reentry_ends_at > i.started_at ? s.reentry_ends_at : null;
      if (until) {
        throw new HttpError(409, t('msg.int_reentry', { code: p.code, until: romeDateTime(new Date(until)).replace('T', ' alle ') }),
          { code: 'reentry', parcel_id: p.parcel_id, reentry_ends_at: until });
      }
    }
  }

  // ── Controlli della conferma ────────────────────────────────────────────────
  function periodBounds(i) {
    const period = cfg.config('phyto_applications_period') || 'anno_solare';
    if (period === 'annata_agraria') return { period, where: 'i.harvest_year = ?', param: i.harvest_year, label: `l'annata ${i.harvest_year}` };
    if (period === 'campagna') return { period, where: 'i.campaign_id = ?', param: i.campaign_id, label: 'la campagna' };
    const y = i.work_date.slice(0, 4);
    return { period: 'anno_solare', where: "i.work_date BETWEEN ? AND ?", params: [`${y}-01-01`, `${y}-12-31`], label: `il ${y}` };
  }
  // Confermare vuol dire «è stato fatto»: niente conferme di lavori futuri (5 minuti di margine per l'orologio del telefono).
  const SKEW_MS = 5 * 60000;
  function confirmChecks(i) {
    const errors = [];
    const flags = { registered_late: 0, late_days: null, equipment_noncompliant: 0 };
    const nowLimit = new Date(Date.now() + SKEW_MS).toISOString();
    if (i.started_at > nowLimit) errors.push(t('msg.int_not_started'));
    if (!i.parcels.length) errors.push(t('msg.int_parcels'));
    for (const p of i.parcels) {
      const parcel = db.prepare('SELECT * FROM vineyard_parcels WHERE id = ?').get(p.parcel_id);
      if (parcel.archived_at) errors.push(t('msg.int_parcel_archived', { code: parcel.code }));
      const vine = db.prepare('SELECT COALESCE(SUM(vine_area_m2), 0) AS s FROM parcel_cadastral_links WHERE parcel_id = ?').get(p.parcel_id).s;
      if (vine && p.area_m2 > vine) errors.push(t('msg.int_parcel_area', { code: parcel.code, area: p.area_m2, max: vine }));
    }
    if (i.type !== 'trattamento') {
      if (errors.length) throw new HttpError(409, t('msg.int_confirm_failed', { list: errors.join('; ') }), { errors });
      checkReentry(i);
      return { flags, treatment: null };
    }
    // PRD-V01: campi di legge del trattamento.
    const tr = i.treatment || { products: [] };
    if (!i.ended_at) errors.push(t('msg.int_end'));
    else if (i.started_at <= nowLimit && i.ended_at > nowLimit) errors.push(t('msg.int_not_ended', { end: romeDateTime(new Date(i.ended_at)).slice(11) }));
    if (!tr.products.length) errors.push(t('msg.int_products'));
    if (!tr.target_pest) errors.push(t('msg.int_target_pest'));
    for (const p of tr.products) {
      if (p.dose_per_ha_e4 == null) errors.push(t('msg.int_dose', { product: p.commercial_name }));
      if (p.total_quantity_e4 == null) errors.push(t('msg.int_total', { product: p.commercial_name }));
      if (p.product_archived_at) errors.push(t('msg.int_product_archived', { product: p.commercial_name }));
    }
    if (!i.workers.length) errors.push(t('msg.int_workers'));
    if (!i.equipment.length) errors.push(t('msg.int_equipment'));
    for (const q of i.equipment) if (q.archived_at) errors.push(t('msg.int_equipment_archived', { name: q.name }));
    if (errors.length) throw new HttpError(409, t('msg.int_confirm_failed', { list: errors.join('; ') }), { errors });

    const product = id => db.prepare('SELECT * FROM phyto_products WHERE id = ?').get(id);
    const fmt = v => (v / 10000).toLocaleString('it-IT', { maximumFractionDigits: 4 });
    for (const line of tr.products) {
      const p = product(line.phyto_product_id);
      // PRD-V03: dose per ettaro entro la massima del prodotto.
      if (p.max_dose_per_ha_e4 != null && line.dose_per_ha_e4 > p.max_dose_per_ha_e4) {
        errors.push(t('msg.int_dose_max', { product: p.commercial_name, dose: fmt(line.dose_per_ha_e4), max: fmt(p.max_dose_per_ha_e4), unit: p.dose_unit || '' }));
      }
      for (const parcel of i.parcels) {
        const par = db.prepare('SELECT p.code, COALESCE(p.organic_status, v.organic_status) AS organic FROM vineyard_parcels p JOIN vineyards v ON v.id = p.vineyard_id WHERE p.id = ?').get(parcel.parcel_id);
        // PRD-V05: prodotto ammesso sulle parcelle biologiche o in conversione.
        if (par.organic !== 'none' && !p.organic_allowed) errors.push(t('msg.int_organic', { code: par.code, status: labels('organic_status')[par.organic].toLowerCase(), product: p.commercial_name }));
        // PRD-V04: applicazioni massime del prodotto sulla parcella nel periodo (DP13: anno solare di partenza).
        if (p.max_applications_per_year) {
          const b = periodBounds(i);
          const n = db.prepare(`SELECT COUNT(DISTINCT i.id) AS c FROM parcel_interventions i JOIN parcel_intervention_parcels ip ON ip.intervention_id = i.id
            JOIN phyto_treatment_products tp ON tp.intervention_id = i.id WHERE i.type = 'trattamento' AND i.status = 'confirmed' AND i.id <> ? AND ip.parcel_id = ? AND tp.phyto_product_id = ? AND ${b.where}`)
            .get(i.id, parcel.parcel_id, p.id, ...(b.params || [b.param])).c;
          if (n + 1 > p.max_applications_per_year) errors.push(t('msg.int_max_apps', { product: p.commercial_name, code: par.code, n: n + 1, max: p.max_applications_per_year, period: b.label }));
        }
      }
    }
    // PRD-V02 e PRD-V10: patentino valido alla data e nessuna limitazione del medico sull'operazione (People, bloccante).
    // Senza req: l'accesso all'idoneità è già nel registro (logExecutorChecks, fuori dalla transazione).
    for (const w of i.workers) {
      const check = executorCheck(w.employee_id, i.work_date, null);
      for (const m of check.blocks) errors.push(t('msg.int_executor', { msg: m }));
    }
    if (errors.length) throw new HttpError(409, t('msg.int_confirm_failed', { list: errors.join('; ') }), { errors });

    // PRD-V06: fine carenza (data del trattamento + giorni) e fine rientro (fine del trattamento + ore); il prodotto più lungo decide.
    const endLocal = romeDate(new Date(i.ended_at));
    const preDays = Math.max(0, ...tr.products.map(l => product(l.phyto_product_id).preharvest_interval_days || 0));
    const reHours = Math.max(0, ...tr.products.map(l => product(l.phyto_product_id).reentry_hours || 0));
    const treatment = {
      preharvest_ends_on: preDays ? addDays(endLocal, preDays) : null,
      reentry_ends_at: reHours ? new Date(new Date(i.ended_at).getTime() + reHours * 3600000).toISOString() : null,
    };
    // PRD-V08: registrazione tardiva (segnalata, non bloccante).
    const lateDays = daysBetween(endLocal, romeDate());
    const limit = cfg.config('phyto_late_registration_days');
    if (limit != null && lateDays > limit) { flags.registered_late = 1; flags.late_days = lateDays; }
    // PRD-V09: irroratrice senza controllo funzionale valido alla data: si conferma ma è non conforme.
    const months = cfg.config('equipment_inspection_valid_months');
    for (const q of i.equipment) {
      if (q.type !== 'irroratrice') continue;
      if (!q.last_inspection_date || (months && addMonths(q.last_inspection_date, months) < i.work_date)) flags.equipment_noncompliant = 1;
    }
    return { flags, treatment };
  }

  // Oggetto di costo della parcella per annata agraria (Finance): nasce alla prima conferma.
  function parcelCostObject(parcelId, year) {
    const link = db.prepare('SELECT cost_object_id FROM parcel_cost_objects WHERE parcel_id = ? AND harvest_year = ?').get(parcelId, year);
    if (link) return link.cost_object_id;
    const p = db.prepare('SELECT code, name FROM vineyard_parcels WHERE id = ?').get(parcelId);
    let code = `PAR-${p.code}-${year}`;
    for (let n = 2; db.prepare('SELECT 1 FROM cost_objects WHERE code = ?').get(code); n++) code = `PAR-${p.code}-${year}-${n}`;
    const id = Number(db.prepare("INSERT INTO cost_objects (type, code, name, status, vintage, notes, created_at, updated_at) VALUES ('parcella', ?, ?, 'aperto', ?, ?, ?, ?)")
      .run(code, `Parcella ${p.code}${p.name ? ` ${p.name}` : ''} · annata ${year}`, year, 'Creato dalla Produzione', now(), now()).lastInsertRowid);
    db.prepare('INSERT INTO parcel_cost_objects (cost_object_id, parcel_id, harvest_year) VALUES (?, ?, ?)').run(id, parcelId, year);
    return id;
  }

  // ── API ─────────────────────────────────────────────────────────────────────
  r.get('/interventions', req => {
    const q = req.query;
    const rows = db.prepare(`SELECT DISTINCT i.* FROM parcel_interventions i LEFT JOIN parcel_intervention_parcels ip ON ip.intervention_id = i.id
      WHERE (? IS NULL OR ip.parcel_id = ?) AND (? IS NULL OR i.type = ?) AND (? IS NULL OR i.status = ?) AND (? IS NULL OR i.work_date >= ?) AND (? IS NULL OR i.work_date <= ?)
      ORDER BY i.started_at DESC LIMIT 500`).all(q.parcel_id || null, q.parcel_id || null, q.type || null, q.type || null, q.status || null, q.status || null,
      q.from || null, q.from || null, q.to || null, q.to || null);
    return rows.map(x => {
      const parcels = db.prepare('SELECT p.code FROM parcel_intervention_parcels ip JOIN vineyard_parcels p ON p.id = ip.parcel_id WHERE ip.intervention_id = ? ORDER BY p.code').all(x.id).map(p => p.code);
      const products = db.prepare('SELECT p.commercial_name FROM phyto_treatment_products tp JOIN phyto_products p ON p.id = tp.phyto_product_id WHERE tp.intervention_id = ?').all(x.id).map(p => p.commercial_name);
      return { ...x, parcel_codes: parcels, product_names: products, started_local: romeDateTime(new Date(x.started_at)) };
    });
  });
  r.get('/interventions/:id', req => detail(req.params.id));
  r.post('/interventions', req => {
    requireCap(req, CAN.vineyard);
    const b = req.body || {};
    if (b.client_uuid) {
      const same = db.prepare('SELECT id FROM parcel_interventions WHERE client_uuid = ?').get(String(b.client_uuid));
      if (same) return { id: same.id, duplicate: true, intervention: detail(same.id) }; // stessa bozza inviata due volte (offline)
    }
    const { f, lists } = parseInput(b, null);
    if (b.confirm) logExecutorChecks({ type: f.type, work_date: f.work_date, workerIds: (lists.workers || []).map(w => w.employee_id) }, req);
    const id = commit(() => {
      const cols = [...Object.keys(f), 'status', 'client_uuid', 'created_at', 'created_by', 'updated_at', 'updated_by'];
      const newId = Number(db.prepare(`INSERT INTO parcel_interventions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...Object.values(f), 'draft', b.client_uuid ? String(b.client_uuid) : null, now(), actor(req), now(), actor(req)).lastInsertRowid);
      saveLists(newId, lists);
      checkReentry(detail(newId)); // PRD-V07 già in pianificazione
      if (b.confirm) confirm(newId, req);
      return newId;
    });
    audit(req, 'parcel_intervention.created', { entity: 'parcel_intervention', entityId: id, after: { type: f.type, work_date: f.work_date } });
    return { id, intervention: detail(id) };
  });
  r.patch('/interventions/:id', req => {
    requireCap(req, CAN.vineyard);
    const i = intRow(req.params.id);
    if (i.status !== 'draft') throw new HttpError(409, t('msg.int_not_draft'));
    const b = req.body || {};
    const { f, lists } = parseInput(b, i);
    const type = f.type || i.type;
    if (b.confirm) logExecutorChecks({ type, work_date: f.work_date || i.work_date, workerIds: (lists.workers || detail(i.id).workers).map(w => w.employee_id) }, req);
    commit(() => {
      const keys = Object.keys(f);
      db.prepare(`UPDATE parcel_interventions SET ${[...keys.map(k => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'].join(', ')} WHERE id = ?`).run(...keys.map(k => f[k]), now(), actor(req), i.id);
      // Cambiato il tipo, i dettagli dell'altro tipo non restano appesi (non devono contare nelle applicazioni).
      if (type !== 'trattamento') {
        db.prepare('DELETE FROM phyto_treatment_products WHERE intervention_id = ?').run(i.id);
        db.prepare('DELETE FROM phyto_treatment_details WHERE intervention_id = ?').run(i.id);
      }
      if (type !== 'concimazione') db.prepare('DELETE FROM fertilization_details WHERE intervention_id = ?').run(i.id);
      saveLists(i.id, lists);
      checkReentry(detail(i.id));
      if (b.confirm) confirm(i.id, req);
    });
    audit(req, 'parcel_intervention.updated', { entity: 'parcel_intervention', entityId: i.id });
    return { id: i.id, intervention: detail(i.id) };
  });
  function confirm(id, req) {
    const i = detail(id);
    if (i.status !== 'draft') throw new HttpError(409, t('msg.int_not_draft'));
    const { flags, treatment } = confirmChecks(i);
    db.prepare(`UPDATE parcel_interventions SET status = 'confirmed', confirmed_at = ?, confirmed_by = ?, registered_late = ?, late_days = ?, equipment_noncompliant = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
      .run(now(), actor(req), flags.registered_late, flags.late_days, flags.equipment_noncompliant, now(), actor(req), id);
    if (treatment) db.prepare('UPDATE phyto_treatment_details SET preharvest_ends_on = ?, reentry_ends_at = ? WHERE intervention_id = ?').run(treatment.preharvest_ends_on, treatment.reentry_ends_at, id);
    const parcels = i.parcels.map(p => ({ parcel_id: p.parcel_id, area_m2: p.area_m2, cost_object_id: parcelCostObject(p.parcel_id, i.harvest_year) }));
    const base = { operation_id: id, intervention_id: id, type: i.type, work_date: i.work_date, effective_at: i.started_at, harvest_year: i.harvest_year, parcels,
      workers: i.workers.map(w => ({ employee_id: w.employee_id, minutes: w.minutes })), equipment_ids: i.equipment.map(q => q.id) };
    events.emit('parcel.intervention_confirmed', { sourceTable: 'parcel_interventions', sourceId: id, payload: base, actor: actor(req) });
    if (treatment) {
      events.emit('phyto.treatment_confirmed', { sourceTable: 'parcel_interventions', sourceId: id, actor: actor(req), payload: {
        ...base, ended_at: i.ended_at, target_pest: i.treatment.target_pest, ...treatment,
        products: i.treatment.products.map(p => ({ phyto_product_id: p.phyto_product_id, registration_number: p.registration_number, dose_per_ha_e4: p.dose_per_ha_e4,
          total_quantity_e4: p.total_quantity_e4, dose_unit: p.dose_unit })),
      } });
    }
    audit(req, 'parcel_intervention.confirmed', { entity: 'parcel_intervention', entityId: id, after: { ...flags, ...(treatment || {}) } });
  }
  r.post('/interventions/:id/confirm', req => {
    requireCap(req, CAN.vineyard);
    const d = detail(req.params.id);
    const b = req.body || {};
    if (d.status === 'draft') logExecutorChecks({ type: d.type, work_date: d.work_date, workerIds: d.workers.map(w => w.employee_id) }, req);
    commit(() => {
      if (b.reentry_override_reason) db.prepare('UPDATE parcel_interventions SET reentry_override_reason = ? WHERE id = ?').run(parseValue({ label: 'Motivo (DPI)', type: 'text', max: 500 }, b.reentry_override_reason), req.params.id);
      confirm(Number(req.params.id), req);
    });
    return detail(req.params.id);
  });
  // PRD-V11: si storna con il motivo; carenza e rientro si ricalcolano da soli (contano solo i confermati).
  r.post('/interventions/:id/reverse', req => {
    requireCap(req, CAN.vineyard);
    const i = intRow(req.params.id);
    if (i.status !== 'confirmed') throw new HttpError(409, t('msg.int_not_confirmed'));
    const reason = String(req.body?.reason || '').trim();
    if (!reason) throw new HttpError(400, t('msg.int_reason'));
    commit(() => {
      db.prepare("UPDATE parcel_interventions SET status = 'reversed', reversed_at = ?, reversed_by = ?, reversal_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?")
        .run(now(), actor(req), reason, now(), actor(req), i.id);
      const payload = { operation_id: i.id, intervention_id: i.id, reversed_event_type: i.type === 'trattamento' ? 'phyto.treatment_confirmed' : 'parcel.intervention_confirmed', reason };
      events.emit(i.type === 'trattamento' ? 'phyto.treatment_reversed' : 'parcel.intervention_reversed', { sourceTable: 'parcel_interventions', sourceId: i.id, payload, actor: actor(req) });
    });
    audit(req, 'parcel_intervention.reversed', { entity: 'parcel_intervention', entityId: i.id, after: { reason } });
    return detail(i.id);
  });
  // «Ripeti il trattamento del 12/6 su queste parcelle»: una bozza nuova con gli stessi dati e la data di oggi.
  r.post('/interventions/:id/repeat', req => {
    requireCap(req, CAN.vineyard);
    const src = detail(req.params.id);
    const startLocal = req.body?.started_at || romeDateTime();
    const body = {
      type: src.type, started_at: startLocal, bbch_stage: src.bbch_stage, notes: src.notes,
      parcels: src.parcels.map(p => ({ parcel_id: p.parcel_id, area_m2: p.area_m2 })), workers: src.workers.map(w => ({ employee_id: w.employee_id, minutes: w.minutes })),
      equipment_ids: src.equipment.map(q => q.id),
      treatment: src.treatment ? { target_pest: src.treatment.target_pest, water_volume_l_per_ha: src.treatment.water_volume_l_per_ha,
        products: src.treatment.products.map(p => ({ phyto_product_id: p.phyto_product_id, dose_per_ha: p.dose_per_ha_e4 == null ? null : p.dose_per_ha_e4 / 10000, total_quantity: p.total_quantity_e4 == null ? null : p.total_quantity_e4 / 10000 })) } : undefined,
      fertilization: src.fertilization ? { product: src.fertilization.product, npk: src.fertilization.npk, unit: src.fertilization.unit,
        dose_per_ha: src.fertilization.dose_per_ha_e4 == null ? null : src.fertilization.dose_per_ha_e4 / 10000, total_quantity: src.fertilization.total_quantity_e4 == null ? null : src.fertilization.total_quantity_e4 / 10000 } : undefined,
    };
    const { f, lists } = parseInput(body, null);
    const id = commit(() => {
      const cols = [...Object.keys(f), 'status', 'repeated_from_id', 'created_at', 'created_by', 'updated_at', 'updated_by'];
      const newId = Number(db.prepare(`INSERT INTO parcel_interventions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...Object.values(f), 'draft', src.id, now(), actor(req), now(), actor(req)).lastInsertRowid);
      saveLists(newId, lists);
      return newId;
    });
    audit(req, 'parcel_intervention.repeated', { entity: 'parcel_intervention', entityId: id, after: { from: src.id } });
    return { id, intervention: detail(id) };
  });
  // Una bozza (non ancora un'operazione) si può eliminare.
  r.delete('/interventions/:id', req => {
    requireCap(req, CAN.vineyard);
    const i = intRow(req.params.id);
    if (i.status !== 'draft') throw new HttpError(409, t('msg.int_not_draft'));
    commit(() => {
      // Chi era nato da questa bozza con «ripeti» resta, senza il riferimento.
      db.prepare('UPDATE parcel_interventions SET repeated_from_id = NULL WHERE repeated_from_id = ?').run(i.id);
      db.prepare('UPDATE parcel_interventions SET replaced_by_id = NULL WHERE replaced_by_id = ?').run(i.id);
      db.prepare('DELETE FROM parcel_interventions WHERE id = ?').run(i.id);
    });
    audit(req, 'parcel_intervention.draft_deleted', { entity: 'parcel_intervention', entityId: i.id });
    return { success: true };
  });

  r.get('/parcels/:id/state', req => parcelState(Number(req.params.id)));
  r.get('/parcel-states', () => db.prepare('SELECT p.id, p.code, p.name, v.name AS vineyard_name FROM vineyard_parcels p JOIN vineyards v ON v.id = p.vineyard_id WHERE p.archived_at IS NULL ORDER BY p.code').all()
    .map(p => ({ ...p, ...parcelState(p.id) })));

  // ── Registro dei trattamenti (anno solare): una riga per trattamento × parcella × prodotto ──────
  function registerRows(year) {
    const rows = db.prepare(`SELECT i.*, d.target_pest, d.water_volume_l_per_ha, d.weather_notes, d.preharvest_ends_on, d.reentry_ends_at FROM parcel_interventions i
      JOIN phyto_treatment_details d ON d.intervention_id = i.id WHERE i.type = 'trattamento' AND i.status = 'confirmed' AND i.work_date BETWEEN ? AND ? ORDER BY i.started_at`)
      .all(`${year}-01-01`, `${year}-12-31`);
    const out = [];
    for (const i of rows) {
      const det = detail(i.id);
      for (const p of det.parcels) {
        const par = db.prepare(`SELECT p.code, p.name, g.name AS variety FROM vineyard_parcels p LEFT JOIN grape_varieties g ON g.id = p.variety_id WHERE p.id = ?`).get(p.parcel_id);
        const cad = db.prepare(`SELECT cp.municipality, cp.sheet, cp.number, cp.subparcel FROM parcel_cadastral_links l JOIN cadastral_parcels cp ON cp.id = l.cadastral_parcel_id WHERE l.parcel_id = ?`).all(p.parcel_id)
          .map(x => `${x.municipality} ${x.sheet}/${x.number}${x.subparcel ? `/${x.subparcel}` : ''}`).join('; ');
        for (const pr of det.treatment.products) {
          out.push({
            data: i.work_date, inizio: det.started_local.slice(11), fine: det.ended_local ? det.ended_local.slice(11) : '', parcella: par.code, nome_parcella: par.name || '', catasto: cad,
            coltura: `vite${par.variety ? ` (${par.variety})` : ''}`, superficie_ha: (p.area_m2 / 10000).toFixed(4), fase_bbch: i.bbch_stage || '', avversita: det.treatment.target_pest || '',
            prodotto: pr.commercial_name, n_registrazione: pr.registration_number, sostanze_attive: pr.active_substances || '',
            dose_ha: pr.dose_per_ha_e4 == null ? '' : String(pr.dose_per_ha_e4 / 10000), unita_dose: pr.dose_unit || '',
            quantita_totale: pr.total_quantity_e4 == null ? '' : String(pr.total_quantity_e4 / 10000), volume_acqua_l_ha: det.treatment.water_volume_l_per_ha ?? '',
            carenza_giorni: pr.preharvest_interval_days ?? '', fine_carenza: det.treatment.preharvest_ends_on || '', rientro_ore: pr.reentry_hours ?? '',
            fine_rientro: det.treatment.reentry_ends_at ? romeDateTime(new Date(det.treatment.reentry_ends_at)).replace('T', ' ') : '',
            esecutori: det.workers.map(w => w.name).join('; '), attrezzature: det.equipment.map(q => `${q.name}${q.plate_serial ? ` (${q.plate_serial})` : ''}`).join('; '),
            meteo: det.treatment.weather_notes || '', registrazione_tardiva: i.registered_late ? `sì (${i.late_days} giorni)` : '', attrezzatura_non_conforme: i.equipment_noncompliant ? 'sì' : '',
            note: i.notes || '', id_intervento: i.id,
          });
        }
      }
    }
    return out;
  }
  // Un testo che inizia con = + - @ in Excel diventerebbe una formula: si antepone l'apostrofo (i numeri restano numeri).
  const csvCell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  r.get('/treatment-register', (req, res) => {
    const year = Number(req.query.year) || Number(romeDate().slice(0, 4));
    const rows = registerRows(year);
    if (req.query.format !== 'csv') return { year, rows };
    const cols = rows.length ? Object.keys(rows[0]) : ['data'];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="registro-trattamenti-${year}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send('﻿' + [cols.join(';'), ...rows.map(x => cols.map(k => csvCell(x[k])).join(';'))].join('\r\n'));
  });

  // ── Ore: proposte nelle presenze dagli interventi confermati (oggetto di costo = parcella e annata) ──
  const minutesOf = iso => { const [h, m] = romeDateTime(new Date(iso)).slice(11).split(':').map(Number); return h * 60 + m; };
  // Le ore già prese da un altro intervento (per esempio quello stornato e poi rifatto) non si propongono di nuovo.
  const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
  const coveredByIntervention = (employeeId, p) => db.prepare(`SELECT t.start_time, t.end_time FROM timesheet_entries t JOIN timesheet_intervention_links l ON l.entry_id = t.id
    WHERE t.employee_id = ? AND t.work_date = ? AND t.voided_by_adjustment_id IS NULL AND t.start_time IS NOT NULL AND t.end_time IS NOT NULL`).all(employeeId, p.work_date)
    .some(x => hm(x.start_time) < p.end_min && p.start_min < hm(x.end_time));
  hrTimesheet.registerProposalSource({
    name: 'intervento',
    list: (e, first, last) => db.prepare(`SELECT i.*, w.minutes FROM parcel_interventions i JOIN parcel_intervention_workers w ON w.intervention_id = i.id
      WHERE w.employee_id = ? AND i.status = 'confirmed' AND i.work_date BETWEEN ? AND ?`).all(e.id, first, last).map(i => {
      const parcels = db.prepare('SELECT ip.parcel_id, p.code FROM parcel_intervention_parcels ip JOIN vineyard_parcels p ON p.id = ip.parcel_id WHERE ip.intervention_id = ?').all(i.id);
      const start = minutesOf(i.started_at);
      const sameDay = i.ended_at && romeDate(new Date(i.ended_at)) === i.work_date;
      const end = i.minutes ? start + i.minutes : sameDay ? minutesOf(i.ended_at) : start + 60;
      const object = parcels.length === 1 ? db.prepare('SELECT cost_object_id FROM parcel_cost_objects WHERE parcel_id = ? AND harvest_year = ?').get(parcels[0].parcel_id, i.harvest_year)?.cost_object_id : null;
      return { source_id: i.id, work_date: i.work_date, start_min: start, end_min: Math.max(end, start + 1), center_key: 'vineyard_center', cost_object_id: object ?? null,
        label: `${labels('intervention_type')[i.type]} · ${parcels.map(p => p.code).join(', ')}` };
    }).filter(p => !coveredByIntervention(e.id, p)),
    used: e => db.prepare(`SELECT l.intervention_id AS source_id, l.work_date FROM timesheet_intervention_links l JOIN timesheet_entries t ON t.id = l.entry_id
      WHERE t.employee_id = ? AND t.voided_by_adjustment_id IS NULL`).all(e.id),
    onAccept: (entryId, p) => db.prepare('INSERT INTO timesheet_intervention_links (entry_id, intervention_id, work_date) VALUES (?, ?, ?)').run(entryId, p.source_id, p.work_date),
  });

  // ── Magazzino: scarico del fitofarmaco se è un articolo di magazzino ─────────
  // Si scarica per parcella, in proporzione alla superficie, con l'oggetto di costo della parcella. Il registro
  // conta in unità intere: si scarica solo se l'articolo è in grammi o millilitri (vedi decisione DP5).
  const TO_BASE = { 'kg/ha': ['g', 1000], 'g/ha': ['g', 1], 'l/ha': ['ml', 1000], 'ml/ha': ['ml', 1] };
  events.on('phyto.treatment_confirmed', 'magazzino.scarico-fitofarmaci', ev => {
    const pl = ev.payload;
    const totalArea = pl.parcels.reduce((s, p) => s + p.area_m2, 0);
    for (const line of pl.products) {
      const prod = db.prepare('SELECT p.commercial_name, p.warehouse_raw_id, w.unit FROM phyto_products p LEFT JOIN warehouse_raw w ON w.id = p.warehouse_raw_id WHERE p.id = ?').get(line.phyto_product_id);
      if (!prod?.warehouse_raw_id || line.total_quantity_e4 == null || !TO_BASE[line.dose_unit]) continue;
      const [base, factor] = TO_BASE[line.dose_unit];
      if (String(prod.unit || '').toLowerCase() !== base) continue;
      const totalUnits = Math.round((line.total_quantity_e4 / 10000) * factor);
      // Arrotondamento cumulativo: la somma delle quote è sempre il totale, senza scarichi in più o in meno.
      let areaSoFar = 0, issued = 0;
      pl.parcels.forEach(p => {
        areaSoFar += p.area_m2;
        const upTo = Math.round(totalUnits * areaSoFar / totalArea);
        const units = upTo - issued;
        issued = upTo;
        if (units <= 0) return;
        stock.move({ rawItemId: prod.warehouse_raw_id, kind: 'consumo_produzione', qtyMilli: -units * 1000, costObjectId: p.cost_object_id, by: ev.actor || 'Sistema',
          reason: `Trattamento del ${pl.work_date}`, label: `Trattamento fitosanitario n. ${pl.intervention_id}`, idemKey: `fito:${pl.intervention_id}:${line.phyto_product_id}:${p.parcel_id}` });
      });
    }
  });
  events.on('phyto.treatment_reversed', 'magazzino.storno-fitofarmaci', ev => {
    stock.reverseWhere('m.idem_key LIKE ?', [`fito:${ev.payload.intervention_id}:%`], { by: ev.actor || 'Sistema', reason: `Trattamento n. ${ev.payload.intervention_id} stornato` });
  });

  return { parcelState, interventionDetail: detail, parcelCostObject, harvestYearOf };
};
