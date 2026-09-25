// Produzione — anagrafiche di cantina: luoghi, vasi vinari (con il codice QR), barrique (estensione 1:1
// dei vasi in legno), protocolli di vinificazione con i loro passi.
//
// PRD-A03: il codice del vaso è univoco, la capacità è maggiore di zero, il codice QR nasce con il vaso;
// un vaso con contenuto non si dismette.
// PRD-A04: una barrique si dismette solo vuota e la sua storia dei passaggi si chiude.
// Il contenuto dei vasi lo scrive il giornale di cantina (Fase 3): lo stato «pieno» (in_use) e «dismesso»
// non si scelgono a mano. Le fasi successive aggiungono i loro controlli con registerVesselRetireGuard e
// le chiusure con registerBarrelRetireHook (occupazione dei legni, Fase 5).
const crypto = require('crypto');
const { HttpError } = require('../../lib/http');
const { t } = require('./i18n');
const { CAN } = require('./common');

const WOOD = ['barrique', 'tonneau', 'botte'];
const MANUAL_STATUSES = ['empty_clean', 'empty_dirty', 'maintenance'];

module.exports = function registerPrdCellar(r, deps, c) {
  const { db, audit } = deps;
  const { now, actor, master, parseFields, requireCap, tx } = c;
  const retireGuards = [];
  const barrelRetireHooks = [];

  master(r, {
    path: '/locations', table: 'cellar_locations', what: 'Luogo', cap: CAN.cellar, order: 'name',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true, max: 120 },
      { key: 'kind', label: 'Tipo', type: 'enum', values: 'location_kind', default: 'altro' },
      { key: 'establishment_id', label: 'Stabilimento', type: 'ref', ref: 'establishments' },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
    archiveGuard: x => (db.prepare("SELECT COUNT(*) AS c FROM vessels WHERE location_id = ? AND status != 'retired'").get(x.id).c ? 'nel luogo ci sono ancora vasi' : null),
    decorate: x => ({ ...x, vessels: db.prepare("SELECT COUNT(*) AS c FROM vessels WHERE location_id = ? AND status != 'retired'").get(x.id).c }),
  });

  // ── Vasi e barrique ─────────────────────────────────────────────────────────
  const VESSEL_FIELDS = [
    { key: 'code', label: 'Codice', type: 'text', required: true, max: 40, upper: true },
    { key: 'name', label: 'Nome', type: 'text', max: 120 },
    { key: 'type', label: 'Tipo', type: 'enum', values: 'vessel_type', required: true },
    { key: 'material', label: 'Materiale', type: 'text', max: 80 },
    { key: 'capacity_ml', label: 'Capacità', type: 'int', required: true, min: 1, minMessage: 'msg.capacity_positive' },
    { key: 'location_id', label: 'Luogo', type: 'ref', ref: 'cellar_locations' },
    { key: 'status', label: 'Stato', type: 'enum', values: 'vessel_status', default: 'empty_clean' },
    { key: 'has_temperature_control', label: 'Termocondizionato', type: 'bool' },
    { key: 'confined_space', label: 'Spazio confinato', type: 'bool' },
    { key: 'public_description', label: 'Descrizione per le visite', type: 'text', max: 4000 },
    { key: 'notes', label: 'Note', type: 'text', max: 2000 },
  ];
  const BARREL_FIELDS = [
    { key: 'cooper_supplier_id', label: 'Tonnelleria (fornitore)', type: 'ref', ref: 'suppliers' },
    { key: 'cooper_name', label: 'Tonnelleria', type: 'text', max: 120 },
    { key: 'oak_origin', label: 'Origine del rovere', type: 'text', max: 80 },
    { key: 'forest', label: 'Foresta', type: 'text', max: 80 },
    { key: 'grain', label: 'Grana', type: 'text', max: 40 },
    { key: 'toast', label: 'Tostatura', type: 'text', max: 40 },
    { key: 'purchase_date', label: "Data d'acquisto", type: 'date' },
    { key: 'purchase_cost_cents', label: "Costo d'acquisto", type: 'money', min: 0 },
    { key: 'useful_life_uses', label: 'Vita utile (passaggi)', type: 'int', min: 1, max: 50 },
    { key: 'uses_count', label: 'Passaggi già fatti', type: 'int', min: 0, max: 100 },
    { key: 'notes', label: 'Note sulla barrique', type: 'text', max: 2000 },
  ];
  const vesselRow = id => {
    const v = db.prepare('SELECT * FROM vessels WHERE id = ?').get(id);
    if (!v) throw new HttpError(404, t('msg.not_found', { what: 'Vaso' }));
    return { ...v };
  };
  const decorateVessel = v => {
    const b = WOOD.includes(v.type) ? db.prepare('SELECT * FROM barrels WHERE vessel_id = ?').get(v.id) : null;
    const loc = v.location_id ? db.prepare('SELECT name FROM cellar_locations WHERE id = ?').get(v.location_id) : null;
    const cooper = b?.cooper_supplier_id ? db.prepare('SELECT name FROM suppliers WHERE id = ?').get(b.cooper_supplier_id) : null;
    return { ...v, location_name: loc?.name || null, is_wood: WOOD.includes(v.type), barrel: b ? { ...b, cooper_display: cooper?.name || b.cooper_name || null } : null };
  };
  const newToken = () => {
    for (;;) {
      const tok = crypto.randomBytes(8).toString('hex');
      if (!db.prepare('SELECT 1 FROM vessels WHERE qr_token = ?').get(tok)) return tok;
    }
  };
  function saveBarrel(vesselId, type, raw, req, { creating }) {
    const wood = WOOD.includes(type);
    if (!wood) {
      if (raw && Object.values(raw).some(v => v != null && v !== '')) throw new HttpError(400, t('msg.barrel_only_wood'));
      return;
    }
    const exists = db.prepare('SELECT 1 FROM barrels WHERE vessel_id = ?').get(vesselId);
    const f = parseFields(BARREL_FIELDS, raw || {}, { partial: !creating && !!exists });
    if (!exists) {
      const cols = ['vessel_id', ...Object.keys(f), 'created_at', 'created_by', 'updated_at', 'updated_by'];
      db.prepare(`INSERT INTO barrels (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(vesselId, ...Object.values(f), now(), actor(req), now(), actor(req));
    } else if (Object.keys(f).length) {
      db.prepare(`UPDATE barrels SET ${[...Object.keys(f).map(k => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'].join(', ')} WHERE vessel_id = ?`).run(...Object.values(f), now(), actor(req), vesselId);
    }
  }
  const checkManualStatus = status => {
    if (status && !MANUAL_STATUSES.includes(status)) throw new HttpError(400, t('msg.vessel_status_manual', { status: t(`labels.vessel_status.${status}`) }));
  };

  r.get('/vessels', req => {
    const q = req.query;
    const rows = db.prepare(`SELECT * FROM vessels WHERE (? IS NULL OR location_id = ?) AND (? IS NULL OR type = ?) AND (? = '1' OR status != 'retired') ORDER BY code`)
      .all(q.location_id || null, q.location_id || null, q.type || null, q.type || null, q.retired || '0');
    return rows.map(v => decorateVessel({ ...v }));
  });
  r.get('/vessels/by-token/:token', req => {
    const v = db.prepare('SELECT * FROM vessels WHERE qr_token = ?').get(req.params.token);
    if (!v) throw new HttpError(404, t('msg.not_found', { what: 'Vaso' }));
    return decorateVessel({ ...v });
  });
  r.get('/vessels/:id', req => decorateVessel(vesselRow(req.params.id)));
  r.post('/vessels', req => {
    requireCap(req, CAN.cellar);
    const b = req.body || {};
    const f = parseFields(VESSEL_FIELDS, b);
    checkManualStatus(f.status);
    const id = tx(() => {
      const cols = [...Object.keys(f), 'qr_token', 'created_at', 'created_by', 'updated_at', 'updated_by'];
      const newId = Number(db.prepare(`INSERT INTO vessels (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...Object.values(f), newToken(), now(), actor(req), now(), actor(req)).lastInsertRowid);
      saveBarrel(newId, f.type, b.barrel, req, { creating: true });
      return newId;
    });
    audit(req, 'vessel.created', { entity: 'vessel', entityId: id, after: f });
    return decorateVessel(vesselRow(id));
  });
  r.patch('/vessels/:id', req => {
    requireCap(req, CAN.cellar);
    const v = vesselRow(req.params.id);
    if (v.status === 'retired') throw new HttpError(409, t('msg.vessel_retired', { code: v.code }));
    const b = req.body || {};
    const f = parseFields(VESSEL_FIELDS, b, { partial: true });
    // Da pieno lo stato cambia solo con il giornale; da vuoto a mano solo tra vuoto, da lavare, manutenzione.
    if (f.status !== undefined) {
      if (v.status === 'in_use' && f.status !== 'in_use') throw new HttpError(409, t('msg.vessel_status_manual', { status: t('labels.vessel_status.in_use') }));
      if (f.status !== v.status) checkManualStatus(f.status);
    }
    // Con il giornale di cantina (Fase 3) arriverà anche il controllo che la capacità non scenda sotto il contenuto.
    tx(() => {
      const keys = Object.keys(f);
      if (keys.length) db.prepare(`UPDATE vessels SET ${[...keys.map(k => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'].join(', ')} WHERE id = ?`).run(...keys.map(k => f[k]), now(), actor(req), v.id);
      const type = f.type || v.type;
      if (b.barrel !== undefined || (WOOD.includes(type) && !WOOD.includes(v.type))) saveBarrel(v.id, type, b.barrel, req, { creating: false });
      if (!WOOD.includes(type) && WOOD.includes(v.type)) db.prepare('DELETE FROM barrels WHERE vessel_id = ?').run(v.id);
    });
    audit(req, 'vessel.updated', { entity: 'vessel', entityId: v.id, before: Object.fromEntries(Object.keys(f).map(k => [k, v[k]])), after: f });
    return decorateVessel(vesselRow(v.id));
  });
  // Contenuto del vaso: dal giornale di cantina (Fase 3). Oggi un vaso pieno è quello marcato «in_use».
  function contentReason(v) {
    if (v.status === 'in_use') return t('msg.vessel_has_content', { code: v.code });
    for (const g of retireGuards) { const reason = g(v); if (reason) return reason; }
    return null;
  }
  r.post('/vessels/:id/retire', req => {
    requireCap(req, CAN.cellar);
    const v = vesselRow(req.params.id);
    if (v.status === 'retired') return decorateVessel(v);
    const reason = contentReason(v);
    if (reason) throw new HttpError(409, reason);
    const why = String(req.body?.reason || '').trim() || null;
    tx(() => {
      db.prepare("UPDATE vessels SET status = 'retired', retired_at = ?, retired_by = ?, retire_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(now(), actor(req), why, now(), actor(req), v.id);
      if (WOOD.includes(v.type)) {
        db.prepare('UPDATE barrels SET retired_at = ?, updated_at = ?, updated_by = ? WHERE vessel_id = ?').run(now(), now(), actor(req), v.id);
        for (const h of barrelRetireHooks) h(v, req); // chiude la storia dei passaggi (Fase 5)
      }
    });
    audit(req, 'vessel.retired', { entity: 'vessel', entityId: v.id, after: { reason: why } });
    return decorateVessel(vesselRow(v.id));
  });
  // Un vaso riattivato va lavato prima di essere riempito.
  r.post('/vessels/:id/reactivate', req => {
    requireCap(req, CAN.cellar);
    const v = vesselRow(req.params.id);
    if (v.status !== 'retired') return decorateVessel(v);
    tx(() => {
      db.prepare("UPDATE vessels SET status = 'empty_dirty', retired_at = NULL, retired_by = NULL, retire_reason = NULL, updated_at = ?, updated_by = ? WHERE id = ?").run(now(), actor(req), v.id);
      db.prepare('UPDATE barrels SET retired_at = NULL WHERE vessel_id = ?').run(v.id);
    });
    audit(req, 'vessel.reactivated', { entity: 'vessel', entityId: v.id });
    return decorateVessel(vesselRow(v.id));
  });

  // ── Protocolli di vinificazione ─────────────────────────────────────────────
  const stepsOf = id => db.prepare('SELECT * FROM protocol_steps WHERE protocol_id = ? ORDER BY sequence').all(id).map(s => ({ ...s, target_params: JSON.parse(s.target_params || '{}'), optional: !!s.optional }));
  function saveSteps(protocolId, steps, req) {
    if (!Array.isArray(steps)) c.fail('invalid_json', { field: 'Passi' });
    const rows = steps.map(s => {
      const op = c.parseValue({ label: 'Operazione', type: 'enum', values: 'operation_type', required: true }, s.operation_type);
      const title = c.parseValue({ label: 'Titolo', type: 'text', required: true, max: 300 }, s.title);
      if (!op || !title) throw new HttpError(400, t('msg.steps_sequence'));
      return {
        op, title,
        phase: c.parseValue({ label: 'Fase', type: 'text', max: 80 }, s.phase ?? null),
        params: c.parseValue({ label: 'Parametri obiettivo', type: 'json' }, s.target_params ?? {}) || '{}',
        checks: c.parseValue({ label: 'Controlli', type: 'text', max: 1000 }, s.checks ?? null),
        optional: c.parseValue({ label: 'Facoltativo', type: 'bool' }, s.optional ?? false),
      };
    });
    db.prepare('DELETE FROM protocol_steps WHERE protocol_id = ?').run(protocolId);
    const ins = db.prepare(`INSERT INTO protocol_steps (protocol_id, sequence, phase, operation_type, title, target_params, checks, optional, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    rows.forEach((s, i) => ins.run(protocolId, i + 1, s.phase, s.op, s.title, s.params, s.checks, s.optional, now(), actor(req), now(), actor(req)));
  }
  const protocols = master(r, {
    path: '/protocols', table: 'winemaking_protocols', what: 'Protocollo', cap: CAN.protocols, order: 'style, name', entity: 'protocol',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true, max: 120 },
      { key: 'style', label: 'Tipologia', type: 'enum', values: 'protocol_style', required: true },
      { key: 'description', label: 'Descrizione', type: 'text', max: 2000 },
      { key: 'active', label: 'In uso', type: 'bool', default: 1 },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
    after: (id, { req, body }) => { if (body.steps !== undefined) saveSteps(id, body.steps, req); },
    decorate: x => ({ ...x, steps_count: db.prepare('SELECT COUNT(*) AS c FROM protocol_steps WHERE protocol_id = ?').get(x.id).c }),
    detail: x => ({ ...x, steps: stepsOf(x.id) }),
  });
  r.put('/protocols/:id/steps', req => {
    requireCap(req, CAN.protocols);
    const p = protocols.load(req.params.id);
    if (p.archived_at) throw new HttpError(409, t('msg.archived', { what: 'Il protocollo' }));
    tx(() => saveSteps(p.id, req.body?.steps, req));
    audit(req, 'protocol.steps_updated', { entity: 'protocol', entityId: p.id, after: { steps: (req.body?.steps || []).length } });
    return { ...p, steps: stepsOf(p.id) };
  });
  r.post('/protocols/:id/duplicate', req => {
    requireCap(req, CAN.protocols);
    const p = protocols.load(req.params.id);
    const name = c.parseValue({ label: 'Nome', type: 'text', required: true, max: 120 }, req.body?.name || `${p.name} (copia)`);
    const id = tx(() => {
      const newId = Number(db.prepare('INSERT INTO winemaking_protocols (name, style, description, active, notes, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)')
        .run(name, p.style, p.description, p.notes, now(), actor(req), now(), actor(req)).lastInsertRowid);
      saveSteps(newId, stepsOf(p.id), req);
      return newId;
    });
    audit(req, 'protocol.duplicated', { entity: 'protocol', entityId: id, after: { from: p.id } });
    return { id };
  });

  return {
    registerVesselRetireGuard: fn => retireGuards.push(fn),
    registerBarrelRetireHook: fn => barrelRetireHooks.push(fn),
    vessel: id => { const v = db.prepare('SELECT * FROM vessels WHERE id = ?').get(id); return v ? decorateVessel({ ...v }) : null; },
    WOOD,
  };
};
