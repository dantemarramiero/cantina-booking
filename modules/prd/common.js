// Strumenti comuni della Produzione:
//   - capacità per ruolo (DP4): la chiave master e gli utenti senza ruolo possono tutto; «sola lettura» non
//     scrive mai; le altre capacità abilitano le scritture elencate in CAN;
//   - lettura e controllo dei campi (testo, interi, decimali × 10.000, importi, date, valori ammessi,
//     collegamenti) con messaggi del dizionario;
//   - anagrafica generica: elenco, dettaglio, creazione, modifica, archiviazione (mai cancellazione),
//     con created/updated/archived e il registro attività.
const { HttpError } = require('../../lib/http');
const { t, labels, values } = require('./i18n');

// Chi scrive cosa (le letture sono di chiunque abbia il workspace Produzione).
const CAN = {
  vineyard: ['agronomo'],
  varieties: ['agronomo', 'enologo'],
  cellar: ['enologo'],
  protocols: ['enologo'],
  compliance: ['enologo', 'responsabile_qualita'],
  analyses: ['agronomo', 'enologo', 'responsabile_qualita'],
};

function createCommon({ db, audit, events, capabilitiesFor }) {
  const now = () => new Date().toISOString();
  const actor = req => (req?.portalUser ? req.portalUser.name : req?.isMasterKey ? 'Chiave master' : 'Sistema');
  const tx = fn => events.transaction(fn);

  function can(req, allowed) {
    const caps = capabilitiesFor(req);
    if (caps === null) return true;
    if (caps.includes('sola_lettura')) return false;
    return allowed.some(c => caps.includes(c));
  }
  function requireCap(req, allowed) {
    if (can(req, allowed)) return;
    const caps = capabilitiesFor(req) || [];
    if (caps.includes('sola_lettura')) throw new HttpError(403, t('msg.read_only'));
    const names = labels('capability');
    throw new HttpError(403, t('msg.no_capability', { roles: allowed.map(c => names[c]).join(' o ') }));
  }

  // ── Campi ───────────────────────────────────────────────────────────────────
  const fail = (key, params) => { throw new HttpError(400, t(`msg.${key}`, params)); };
  // Decimali all'italiana: virgola decimale, punto delle migliaia («14.000» = 14000, «1.234,5» = 1234,5).
  // Un numero JSON arriva già come numero e resta com'è.
  function decimal(v, label) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('invalid_number', { field: label });
      return v;
    }
    let s = String(v).trim().replace(/\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    if (s === '' || !Number.isFinite(n)) fail('invalid_number', { field: label });
    return n;
  }
  function integer(v, label) {
    let s = String(v).trim().replace(/\s/g, '');
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    if (!Number.isInteger(n)) fail('invalid_int', { field: label });
    return n;
  }
  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const x = new Date(Date.UTC(y, m - 1, d));
    return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
  }
  const allowedValues = f => (Array.isArray(f.values) ? f.values : values(f.values));
  function parseValue(f, raw) {
    const label = f.label;
    if (raw === undefined) return undefined;
    const empty = raw === null || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && !raw.length && f.type !== 'multi');
    if (empty) {
      if (f.required) fail('required', { field: label });
      return f.type === 'bool' ? 0 : f.type === 'multi' ? '[]' : null;
    }
    let v;
    switch (f.type) {
      case 'text':
        v = String(raw).trim();
        if (v.length > (f.max || 200)) fail('too_long', { field: label, max: f.max || 200 });
        if (f.upper) v = v.toUpperCase();
        return v;
      case 'int':
        v = integer(raw, label);
        break;
      case 'e4':
        v = Math.round(decimal(raw, label) * 10000);
        break;
      case 'money':
        v = Math.round(decimal(raw, label) * 100);
        break;
      case 'bool':
        return raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on' ? 1 : 0;
      case 'date':
        v = String(raw).trim();
        if (!validDate(v)) fail('invalid_date', { field: label });
        return v;
      case 'enum':
        v = String(raw);
        if (!allowedValues(f).includes(v)) fail('invalid_enum', { field: label });
        return v;
      case 'multi': {
        const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map(s => s.trim()).filter(Boolean);
        if (list.some(x => !allowedValues(f).includes(x))) fail('invalid_enum', { field: label });
        return JSON.stringify([...new Set(list)]);
      }
      case 'ref':
        v = integer(raw, label);
        if (!db.prepare(`SELECT 1 FROM ${f.ref} WHERE ${f.refKey || 'id'} = ?`).get(v)) fail('ref_missing', { field: label });
        return v;
      case 'refkey':
        v = String(raw).trim();
        if (!db.prepare(`SELECT 1 FROM ${f.ref} WHERE ${f.refKey} = ?`).get(v)) fail('ref_missing', { field: label });
        return v;
      case 'json':
        try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { fail('invalid_json', { field: label }); }
        if (f.check) f.check(v);
        return JSON.stringify(v);
      default:
        throw new Error(`Tipo di campo sconosciuto: ${f.type}`);
    }
    if (f.min != null && v < f.min) {
      if (f.minMessage) throw new HttpError(400, t(f.minMessage));
      fail('min', { field: label, min: f.min });
    }
    if (f.max != null && v > f.max) fail('max', { field: label, max: f.max });
    return v;
  }
  // partial: si leggono solo i campi presenti (modifica); altrimenti anche gli obbligatori mancanti fanno errore.
  function parseFields(fields, body, { partial = false } = {}) {
    const out = {};
    for (const f of fields) {
      if (f.readOnly) continue;
      const raw = body[f.key];
      if (raw === undefined) {
        if (!partial && f.required) fail('required', { field: f.label });
        if (!partial && f.default !== undefined) out[f.key] = f.default;
        continue;
      }
      out[f.key] = parseValue(f, raw);
    }
    return out;
  }

  // ── Anagrafica generica ─────────────────────────────────────────────────────
  function master(r, spec) {
    const { path, table, what, cap, fields } = spec;
    const entity = spec.entity || table;
    const load = id => {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      if (!row) throw new HttpError(404, t('msg.not_found', { what }));
      return { ...row };
    };
    const out = row => (spec.decorate ? spec.decorate(row) : row);
    r.get(path, req => {
      const where = req.query.archived === '1' ? '' : 'WHERE archived_at IS NULL';
      return db.prepare(`SELECT * FROM ${table} ${where} ORDER BY ${spec.order || 'id'}`).all().map(x => out({ ...x }));
    });
    r.get(`${path}/:id`, req => (spec.detail ? spec.detail(load(req.params.id), req) : out(load(req.params.id))));
    r.post(path, req => {
      requireCap(req, cap);
      const body = req.body || {};
      const f = parseFields(fields, body);
      if (spec.validate) spec.validate(f, { req, body, existing: null });
      const id = tx(() => {
        const keys = Object.keys(f);
        const cols = [...keys, 'created_at', 'created_by', 'updated_at', 'updated_by'];
        const newId = Number(db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...keys.map(k => f[k]), now(), actor(req), now(), actor(req)).lastInsertRowid);
        if (spec.after) spec.after(newId, { req, body, existing: null });
        return newId;
      });
      audit(req, `${entity}.created`, { entity, entityId: id, after: spec.auditSnapshot ? spec.auditSnapshot(id) : f });
      return { id, ...(spec.returnCreated ? spec.returnCreated(id) : {}) };
    });
    r.patch(`${path}/:id`, req => {
      requireCap(req, cap);
      const existing = load(req.params.id);
      if (existing.archived_at) throw new HttpError(409, t('msg.archived', { what }));
      const body = req.body || {};
      const f = parseFields(fields.filter(x => !x.createOnly), body, { partial: true });
      if (spec.validate) spec.validate(f, { req, body, existing });
      tx(() => {
        const keys = Object.keys(f);
        db.prepare(`UPDATE ${table} SET ${[...keys.map(k => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'].join(', ')} WHERE id = ?`)
          .run(...keys.map(k => f[k]), now(), actor(req), existing.id);
        if (spec.after) spec.after(existing.id, { req, body, existing });
      });
      const before = Object.fromEntries(Object.keys(f).map(k => [k, existing[k]]));
      audit(req, `${entity}.updated`, { entity, entityId: existing.id, before, after: f });
      return { success: true };
    });
    if (spec.archive !== false) {
      r.post(`${path}/:id/archive`, req => {
        requireCap(req, cap);
        const row = load(req.params.id);
        if (row.archived_at) return { success: true };
        const reason = spec.archiveGuard ? spec.archiveGuard(row) : null;
        if (reason) throw new HttpError(409, t('msg.archive_blocked', { reason }));
        db.prepare(`UPDATE ${table} SET archived_at = ?, archived_by = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(now(), actor(req), now(), actor(req), row.id);
        audit(req, `${entity}.archived`, { entity, entityId: row.id });
        return { success: true };
      });
      r.post(`${path}/:id/restore`, req => {
        requireCap(req, cap);
        const row = load(req.params.id);
        tx(() => {
          db.prepare(`UPDATE ${table} SET archived_at = NULL, archived_by = NULL, updated_at = ?, updated_by = ? WHERE id = ?`).run(now(), actor(req), row.id);
          if (spec.afterRestore) spec.afterRestore(row.id, req);
        });
        audit(req, `${entity}.restored`, { entity, entityId: row.id });
        return { success: true };
      });
    }
    return { load };
  }

  return { now, actor, tx, can, requireCap, parseFields, parseValue, master, fail };
}

module.exports = { createCommon, CAN };
