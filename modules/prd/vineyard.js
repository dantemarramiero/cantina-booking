// Produzione — anagrafiche di vigneto: vigneti, particelle catastali, parcelle (con i collegamenti alle
// particelle e l'idoneità alle denominazioni), attrezzature, fitofarmaci.
//
// PRD-A01: su una particella catastale la somma delle superfici vitate delle parcelle attive non supera la
// superficie della particella. Si controlla dopo ogni scrittura, nella stessa transazione: parcella nuova o
// modificata, parcella riattivata, superficie della particella ridotta.
// PRD-A02: una parcella con interventi o conferimenti nella campagna aperta non si archivia. Gli interventi
// (Fase 2) e i conferimenti (Fase 3) registrano qui il loro controllo con registerParcelArchiveGuard.
const { HttpError } = require('../../lib/http');
const { addMonths, romeDate } = require('../../lib/time');
const { t } = require('./i18n');
const { CAN } = require('./common');

module.exports = function registerPrdVineyard(r, deps, c, cfg) {
  const { db, audit } = deps;
  const { now, actor, master, fail } = c;
  const parcelArchiveGuards = [];

  master(r, {
    path: '/vineyards', table: 'vineyards', what: 'Vigneto', cap: CAN.vineyard, order: 'name',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true, max: 120 },
      { key: 'locality', label: 'Località', type: 'text' },
      { key: 'municipality', label: 'Comune', type: 'text' },
      { key: 'province', label: 'Provincia', type: 'text', max: 2, upper: true },
      { key: 'organic_status', label: 'Biologico', type: 'enum', values: 'organic_status', default: 'none' },
      { key: 'certification_body', label: 'Ente certificatore', type: 'text' },
      { key: 'public_description', label: 'Descrizione per le visite', type: 'text', max: 4000 },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
    decorate: x => ({ ...x, ...db.prepare(`SELECT COUNT(*) AS parcels, COALESCE(SUM(l.vine_area_m2), 0) AS vine_area_m2 FROM vineyard_parcels p
      LEFT JOIN parcel_cadastral_links l ON l.parcel_id = p.id WHERE p.vineyard_id = ? AND p.archived_at IS NULL`).get(x.id) }),
  });

  // ── Particelle catastali ────────────────────────────────────────────────────
  const m2 = n => n.toLocaleString('it-IT', { useGrouping: 'always' });
  const cadastralLabel = x => `${x.municipality} fg. ${x.sheet} part. ${x.number}${x.subparcel ? ` sub ${x.subparcel}` : ''}`;
  const usedArea = id => db.prepare(`SELECT COALESCE(SUM(l.vine_area_m2), 0) AS s FROM parcel_cadastral_links l JOIN vineyard_parcels p ON p.id = l.parcel_id
    WHERE l.cadastral_parcel_id = ? AND p.archived_at IS NULL`).get(id).s;
  function checkCadastral(id) {
    const x = db.prepare('SELECT * FROM cadastral_parcels WHERE id = ?').get(id);
    const sum = usedArea(id);
    if (sum > x.area_m2) throw new HttpError(409, t('msg.cadastral_exceeded', { cadastral: cadastralLabel(x), sum: m2(sum), area: m2(x.area_m2) }));
  }
  master(r, {
    path: '/cadastral-parcels', table: 'cadastral_parcels', what: 'Particella', cap: CAN.vineyard, order: 'municipality, sheet, number, subparcel',
    fields: [
      { key: 'municipality', label: 'Comune', type: 'text', required: true },
      { key: 'sheet', label: 'Foglio', type: 'text', required: true, max: 20 },
      { key: 'number', label: 'Particella', type: 'text', required: true, max: 20 },
      { key: 'subparcel', label: 'Subalterno', type: 'text', max: 20 },
      { key: 'area_m2', label: 'Superficie catastale (m²)', type: 'int', required: true, min: 1 },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
    validate: (f, { existing }) => {
      if (existing && f.area_m2 !== undefined) {
        const sum = usedArea(existing.id);
        if (sum > f.area_m2) throw new HttpError(409, t('msg.cadastral_area_below', { sum: m2(sum), area: m2(f.area_m2) }));
      }
    },
    archiveGuard: x => (usedArea(x.id) ? 'la particella è collegata a parcelle attive' : null),
    decorate: x => ({ ...x, label: cadastralLabel(x), used_m2: usedArea(x.id) }),
  });

  // ── Parcelle ────────────────────────────────────────────────────────────────
  const linksOf = id => db.prepare(`SELECT l.cadastral_parcel_id, l.vine_area_m2, l.schedario_unit_code, cp.municipality, cp.sheet, cp.number, cp.subparcel, cp.area_m2
    FROM parcel_cadastral_links l JOIN cadastral_parcels cp ON cp.id = l.cadastral_parcel_id WHERE l.parcel_id = ? ORDER BY l.id`).all(id)
    .map(x => ({ ...x, label: cadastralLabel(x) }));
  const appellationsOf = id => db.prepare('SELECT appellation_id FROM parcel_appellation_eligibility WHERE parcel_id = ? ORDER BY appellation_id').all(id).map(x => x.appellation_id);
  function saveLinks(parcelId, links, req) {
    if (!Array.isArray(links)) fail('invalid_json', { field: 'Particelle' });
    const seen = new Set();
    const rows = links.map(l => {
      const cid = c.parseValue({ key: 'cadastral_parcel_id', label: 'Particella', type: 'ref', ref: 'cadastral_parcels', required: true }, l.cadastral_parcel_id);
      if (seen.has(cid)) throw new HttpError(400, t('msg.parcel_duplicate_link'));
      seen.add(cid);
      const cp = db.prepare('SELECT * FROM cadastral_parcels WHERE id = ?').get(cid);
      if (cp.archived_at) throw new HttpError(409, t('msg.cadastral_archived', { cadastral: cadastralLabel(cp) }));
      return {
        cid,
        area: c.parseValue({ label: 'Superficie vitata (m²)', type: 'int', required: true, min: 1 }, l.vine_area_m2),
        code: c.parseValue({ label: 'Unità vitata', type: 'text', max: 40 }, l.schedario_unit_code ?? null),
      };
    });
    const before = db.prepare('SELECT cadastral_parcel_id FROM parcel_cadastral_links WHERE parcel_id = ?').all(parcelId).map(x => x.cadastral_parcel_id);
    db.prepare('DELETE FROM parcel_cadastral_links WHERE parcel_id = ?').run(parcelId);
    const ins = db.prepare(`INSERT INTO parcel_cadastral_links (parcel_id, cadastral_parcel_id, vine_area_m2, schedario_unit_code, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const x of rows) ins.run(parcelId, x.cid, x.area, x.code, now(), actor(req), now(), actor(req));
    for (const cid of new Set([...before, ...rows.map(x => x.cid)])) checkCadastral(cid);
  }
  function saveAppellations(parcelId, ids, req) {
    if (!Array.isArray(ids)) fail('invalid_json', { field: 'Denominazioni' });
    db.prepare('DELETE FROM parcel_appellation_eligibility WHERE parcel_id = ?').run(parcelId);
    const ins = db.prepare('INSERT INTO parcel_appellation_eligibility (parcel_id, appellation_id, created_at, created_by) VALUES (?, ?, ?, ?)');
    for (const id of new Set(ids.map(x => c.parseValue({ label: 'Denominazione', type: 'ref', ref: 'appellations', required: true }, x)))) ins.run(parcelId, id, now(), actor(req));
  }
  const decorateParcel = x => {
    const links = linksOf(x.id);
    const v = db.prepare('SELECT name, organic_status FROM vineyards WHERE id = ?').get(x.vineyard_id);
    return {
      ...x, vineyard_name: v?.name, variety_name: x.variety_id ? db.prepare('SELECT name FROM grape_varieties WHERE id = ?').get(x.variety_id)?.name : null,
      vine_area_m2: links.reduce((s, l) => s + l.vine_area_m2, 0), cadastral_links: links, appellation_ids: appellationsOf(x.id),
      effective_organic_status: x.organic_status || v?.organic_status || 'none',
    };
  };
  const currentYear = Number(romeDate().slice(0, 4));
  master(r, {
    path: '/parcels', table: 'vineyard_parcels', what: 'Parcella', cap: CAN.vineyard, order: 'code', entity: 'vineyard_parcel',
    fields: [
      { key: 'vineyard_id', label: 'Vigneto', type: 'ref', ref: 'vineyards', required: true },
      { key: 'code', label: 'Codice', type: 'text', required: true, max: 40, upper: true },
      { key: 'name', label: 'Nome', type: 'text', max: 120 },
      { key: 'variety_id', label: 'Vitigno', type: 'ref', ref: 'grape_varieties' },
      { key: 'clone', label: 'Clone', type: 'text', max: 60 },
      { key: 'rootstock', label: 'Portinnesto', type: 'text', max: 60 },
      { key: 'planting_year', label: "Anno d'impianto", type: 'int', min: 1900, max: currentYear + 1 },
      { key: 'row_spacing_cm', label: 'Distanza tra i filari (cm)', type: 'int', min: 1 },
      { key: 'vine_spacing_cm', label: 'Distanza sulla fila (cm)', type: 'int', min: 1 },
      { key: 'vines_count', label: 'Numero di ceppi', type: 'int', min: 0 },
      { key: 'training_system', label: 'Forma di allevamento', type: 'text', max: 80 },
      { key: 'exposure', label: 'Esposizione', type: 'text', max: 40 },
      { key: 'altitude_m', label: 'Altitudine (m)', type: 'int', min: -100, max: 5000 },
      { key: 'geometry_geojson', label: 'Geometria', type: 'json', check: g => { if (!g || typeof g !== 'object' || !g.type) throw new HttpError(400, t('msg.geojson')); } },
      { key: 'organic_status', label: 'Biologico', type: 'enum', values: 'organic_status' },
      { key: 'active', label: 'Attiva', type: 'bool', default: 1 },
      { key: 'public_description', label: 'Descrizione per le visite', type: 'text', max: 4000 },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
    after: (id, { req, body }) => {
      if (body.cadastral_links !== undefined) saveLinks(id, body.cadastral_links, req);
      if (body.appellation_ids !== undefined) saveAppellations(id, body.appellation_ids, req);
    },
    auditSnapshot: id => ({ ...db.prepare('SELECT code, vineyard_id FROM vineyard_parcels WHERE id = ?').get(id), cadastral_links: linksOf(id).map(l => [l.cadastral_parcel_id, l.vine_area_m2]) }),
    archiveGuard: x => {
      for (const g of parcelArchiveGuards) { const reason = g(x); if (reason) return reason; }
      return null;
    },
    // Riattivata, la parcella torna a contare sulle sue particelle.
    afterRestore: id => { for (const l of linksOf(id)) checkCadastral(l.cadastral_parcel_id); },
    decorate: decorateParcel,
  });
  r.put('/parcels/:id/cadastral-links', req => {
    c.requireCap(req, CAN.vineyard);
    const p = db.prepare('SELECT * FROM vineyard_parcels WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, t('msg.not_found', { what: 'Parcella' }));
    if (p.archived_at) throw new HttpError(409, t('msg.archived', { what: 'La parcella' }));
    const before = linksOf(p.id).map(l => [l.cadastral_parcel_id, l.vine_area_m2]);
    c.tx(() => saveLinks(p.id, req.body?.links, req));
    audit(req, 'vineyard_parcel.cadastral_links', { entity: 'vineyard_parcel', entityId: p.id, before, after: linksOf(p.id).map(l => [l.cadastral_parcel_id, l.vine_area_m2]) });
    return decorateParcel({ ...db.prepare('SELECT * FROM vineyard_parcels WHERE id = ?').get(p.id) });
  });
  r.put('/parcels/:id/appellations', req => {
    c.requireCap(req, CAN.vineyard);
    const p = db.prepare('SELECT * FROM vineyard_parcels WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, t('msg.not_found', { what: 'Parcella' }));
    c.tx(() => saveAppellations(p.id, req.body?.appellation_ids, req));
    audit(req, 'vineyard_parcel.appellations', { entity: 'vineyard_parcel', entityId: p.id, after: appellationsOf(p.id) });
    return { success: true };
  });

  // ── Attrezzature ────────────────────────────────────────────────────────────
  master(r, {
    path: '/equipment', table: 'equipment', what: 'Attrezzatura', cap: CAN.vineyard, order: 'name',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true, max: 120 },
      { key: 'type', label: 'Tipo', type: 'enum', values: 'equipment_type', default: 'altro' },
      { key: 'plate_serial', label: 'Targa o matricola', type: 'text', max: 60 },
      { key: 'last_inspection_date', label: 'Ultimo controllo funzionale', type: 'date' },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
    // Scadenza del controllo funzionale dalla soglia configurata (da validare); una data scaduta rende il
    // trattamento «non conforme» (PRD-V09, Fase 2).
    decorate: x => {
      const months = cfg.config('equipment_inspection_valid_months');
      const due = x.last_inspection_date && months ? addMonths(x.last_inspection_date, months) : null;
      return { ...x, inspection_due: due, inspection_expired: !!due && due < romeDate() };
    },
  });

  // ── Fitofarmaci ─────────────────────────────────────────────────────────────
  master(r, {
    path: '/phyto-products', table: 'phyto_products', what: 'Fitofarmaco', cap: CAN.vineyard, order: 'commercial_name',
    fields: [
      { key: 'commercial_name', label: 'Nome commerciale', type: 'text', required: true, max: 160 },
      { key: 'registration_number', label: 'N. di registrazione', type: 'text', required: true, max: 40 },
      { key: 'active_substances', label: 'Sostanze attive', type: 'text', max: 500 },
      { key: 'organic_allowed', label: 'Ammesso in biologico', type: 'bool' },
      { key: 'max_dose_per_ha_e4', label: 'Dose massima per ettaro', type: 'e4', min: 0 },
      { key: 'dose_unit', label: 'Unità della dose', type: 'enum', values: 'dose_unit' },
      { key: 'preharvest_interval_days', label: 'Intervallo di carenza (giorni)', type: 'int', min: 0, max: 365 },
      { key: 'reentry_hours', label: 'Tempo di rientro (ore)', type: 'int', min: 0, max: 720 },
      { key: 'max_applications_per_year', label: "Applicazioni massime per anno", type: 'int', min: 1, max: 100 },
      { key: 'warehouse_raw_id', label: 'Articolo di magazzino', type: 'ref', ref: 'warehouse_raw' },
      { key: 'label_url', label: 'Etichetta (link)', type: 'text', max: 500 },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
  });

  return {
    registerParcelArchiveGuard: fn => parcelArchiveGuards.push(fn),
    checkCadastral,
    parcel: id => { const p = db.prepare('SELECT * FROM vineyard_parcels WHERE id = ?').get(id); return p ? decorateParcel({ ...p }) : null; },
  };
};
