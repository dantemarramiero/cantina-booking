// Produzione — configurazione e anagrafiche di base:
//   catalogo (valori ammessi, capacità dell'utente, unità a schermo), soglie normative da validare
//   (prd_config), campagne vitivinicole, stabilimenti, vitigni, denominazioni con le regole di
//   disciplinare, parametri di analisi, mappa delle operazioni SIAN.
const { HttpError } = require('../../lib/http');
const { romeDate, campaignOf } = require('../../lib/time');
const { t, IT, values } = require('./i18n');
const { CAN } = require('./common');

module.exports = function registerPrdConfig(r, deps, c) {
  const { db, audit, getSetting, capabilitiesFor } = deps;
  const { now, actor, requireCap, master, fail } = c;

  // ── Catalogo per le schermate ───────────────────────────────────────────────
  const UNITS = { volume: ['prd_unit_volume', 'hl'], weight: ['prd_unit_weight', 'q'], area: ['prd_unit_area', 'ha'], sugar: ['prd_unit_sugar', 'babo'] };
  const units = () => Object.fromEntries(Object.entries(UNITS).map(([k, [key, def]]) => [k, getSetting(key, def) || def]));
  r.get('/catalog', req => {
    const caps = capabilitiesFor(req);
    const canWrite = Object.fromEntries(Object.entries(CAN).map(([area, allowed]) => [area, c.can(req, allowed)]));
    return { labels: IT.labels, capabilities: caps, can: canWrite, units: units(), today: romeDate(), campaign: campaignOf(romeDate()) };
  });

  // ── Soglie e limiti configurabili (da validare) ─────────────────────────────
  const parseConfig = (row, raw) => {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    if (row.kind === 'number') {
      let s = String(raw).trim();
      if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
      if (!Number.isFinite(Number(s))) throw new HttpError(400, t('msg.config_value', { name: row.name, kind: 'numero' }));
      return String(Number(s));
    }
    if (row.kind === 'json') {
      try { return JSON.stringify(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { throw new HttpError(400, t('msg.config_value', { name: row.name, kind: 'JSON' })); }
    }
    return String(raw).trim();
  };
  const configRow = key => {
    const row = db.prepare('SELECT * FROM prd_config WHERE key = ?').get(key);
    if (!row) throw new HttpError(404, t('msg.not_found', { what: 'Soglia' }));
    return { ...row };
  };
  // Valore letto dagli altri moduli: numero, oggetto JSON o testo (null se non ancora impostato).
  function config(key) {
    const row = db.prepare('SELECT kind, value FROM prd_config WHERE key = ?').get(key);
    if (!row || row.value == null) return null;
    return row.kind === 'number' ? Number(row.value) : row.kind === 'json' ? JSON.parse(row.value) : row.value;
  }
  r.get('/config', () => db.prepare('SELECT * FROM prd_config ORDER BY question_id IS NULL, question_id, key').all().map(x => ({ ...x, to_validate: !!x.to_validate })));
  r.patch('/config/:key', req => {
    requireCap(req, CAN.compliance);
    const row = configRow(req.params.key);
    const b = req.body || {};
    const value = b.value !== undefined ? parseConfig(row, b.value) : row.value;
    const note = b.note !== undefined ? (String(b.note).trim() || null) : row.note;
    // Un valore cambiato torna da validare.
    const changed = value !== row.value;
    db.prepare(`UPDATE prd_config SET value = ?, note = ?, to_validate = ?, validated_by = ?, validated_at = ?, updated_at = ?, updated_by = ? WHERE key = ?`)
      .run(value, note, changed ? 1 : row.to_validate, changed ? null : row.validated_by, changed ? null : row.validated_at, now(), actor(req), row.key);
    audit(req, 'prd_config.updated', { entity: 'prd_config', before: { key: row.key, value: row.value }, after: { key: row.key, value } });
    return { success: true };
  });
  r.post('/config/:key/validate', req => {
    requireCap(req, CAN.compliance);
    const row = configRow(req.params.key);
    db.prepare('UPDATE prd_config SET to_validate = 0, validated_by = ?, validated_at = ?, updated_at = ?, updated_by = ? WHERE key = ?').run(actor(req), now(), now(), actor(req), row.key);
    audit(req, 'prd_config.validated', { entity: 'prd_config', after: { key: row.key, value: row.value } });
    return { success: true };
  });

  // ── Campagne vitivinicole (1/8–31/7, in ora italiana) ───────────────────────
  function ensureCampaign(date = romeDate()) {
    const cmp = campaignOf(date);
    let row = db.prepare('SELECT * FROM wine_campaigns WHERE label = ?').get(cmp.label);
    if (!row) {
      db.prepare('INSERT INTO wine_campaigns (label, starts_on, ends_on, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(cmp.label, cmp.starts_on, cmp.ends_on, now(), 'Sistema', now(), 'Sistema');
      row = db.prepare('SELECT * FROM wine_campaigns WHERE label = ?').get(cmp.label);
    }
    return { ...row };
  }
  r.get('/campaigns', () => {
    const current = ensureCampaign();
    return db.prepare('SELECT * FROM wine_campaigns ORDER BY starts_on DESC').all().map(x => ({ ...x, current: x.id === current.id }));
  });

  // ── Anagrafiche ─────────────────────────────────────────────────────────────
  master(r, {
    path: '/establishments', table: 'establishments', what: 'Stabilimento', cap: CAN.compliance, order: 'name',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'icqrf_code', label: 'Codice ICQRF', type: 'text', max: 40, upper: true },
      { key: 'address', label: 'Indirizzo', type: 'text' },
      { key: 'regime', label: 'Regime', type: 'enum', values: 'regime', default: 'ordinario' },
      { key: 'fiscal_warehouse', label: 'Deposito fiscale', type: 'bool' },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
  });

  master(r, {
    path: '/varieties', table: 'grape_varieties', what: 'Vitigno', cap: CAN.varieties, order: 'name',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true, max: 120 },
      { key: 'color', label: 'Colore della bacca', type: 'enum', values: 'grape_color', required: true },
      { key: 'sian_code', label: 'Codice SIAN', type: 'text', max: 40 },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
  });

  const RULE_FIELDS = [
    { key: 'rule_type', label: 'Regola', type: 'enum', values: 'rule_type', required: true, createOnly: true },
    { key: 'mention', label: 'Menzione', type: 'text', max: 60 },
    { key: 'variety_id', label: 'Vitigno', type: 'ref', ref: 'grape_varieties' },
    { key: 'value_e4', label: 'Valore', type: 'e4', required: true },
    { key: 'valid_from', label: 'Valida dal', type: 'date', required: true },
    { key: 'valid_to', label: 'Valida fino al', type: 'date' },
    { key: 'source_note', label: 'Fonte', type: 'text', max: 500 },
  ];
  const withUnit = x => ({ ...x, unit: IT.labels.rule_unit[x.rule_type] || null });
  // Regole di disciplinare valide a una data (PRD-A05): quelle scadute non valgono per le operazioni
  // successive ma restano per lo storico. Con una menzione si aggiungono le regole di quella menzione.
  function rulesAt(appellationId, date, { mention = null } = {}) {
    return db.prepare(`SELECT * FROM appellation_rules WHERE appellation_id = ? AND archived_at IS NULL AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)
      AND (mention IS NULL OR mention = ?) ORDER BY rule_type, mention IS NOT NULL, valid_from`).all(appellationId, date, date, mention).map(x => withUnit({ ...x }));
  }
  const appellations = master(r, {
    path: '/appellations', table: 'appellations', what: 'Denominazione', cap: CAN.compliance, order: 'type, name',
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true, max: 160 },
      { key: 'type', label: 'Tipo', type: 'enum', values: 'appellation_type', required: true },
      { key: 'sian_code', label: 'Codice SIAN', type: 'text', max: 40 },
      { key: 'requires_state_seal', label: 'Richiede i contrassegni di Stato', type: 'bool' },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
    detail: row => ({ ...row, rules: db.prepare('SELECT * FROM appellation_rules WHERE appellation_id = ? ORDER BY archived_at IS NOT NULL, rule_type, valid_from DESC').all(row.id).map(x => withUnit({ ...x })) }),
  });
  const checkRule = (f, existing) => {
    const from = f.valid_from ?? existing?.valid_from, to = f.valid_to !== undefined ? f.valid_to : existing?.valid_to;
    if (to && from && to < from) fail('rule_dates');
    const type = f.rule_type ?? existing?.rule_type;
    const variety = f.variety_id !== undefined ? f.variety_id : existing?.variety_id;
    if (['min_variety_pct', 'max_variety_pct'].includes(type) && !variety) fail('rule_variety_needed');
  };
  r.get('/appellations/:id/rules', req => {
    appellations.load(req.params.id);
    const date = req.query.date || romeDate();
    return rulesAt(Number(req.params.id), date, { mention: req.query.mention || null });
  });
  r.post('/appellations/:id/rules', req => {
    requireCap(req, CAN.compliance);
    const a = appellations.load(req.params.id);
    const f = c.parseFields(RULE_FIELDS, req.body || {});
    checkRule(f, null);
    const cols = ['appellation_id', ...Object.keys(f), 'created_at', 'created_by', 'updated_at', 'updated_by'];
    const id = Number(db.prepare(`INSERT INTO appellation_rules (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(a.id, ...Object.values(f), now(), actor(req), now(), actor(req)).lastInsertRowid);
    audit(req, 'appellation_rule.created', { entity: 'appellation_rule', entityId: id, after: { appellation_id: a.id, ...f } });
    return { id };
  });
  const ruleRow = id => {
    const row = db.prepare('SELECT * FROM appellation_rules WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, t('msg.not_found', { what: 'Regola' }));
    return { ...row };
  };
  r.patch('/appellation-rules/:id', req => {
    requireCap(req, CAN.compliance);
    const row = ruleRow(req.params.id);
    if (row.archived_at) throw new HttpError(409, t('msg.archived', { what: 'La regola' }));
    const f = c.parseFields(RULE_FIELDS.filter(x => !x.createOnly), req.body || {}, { partial: true });
    checkRule(f, row);
    const keys = Object.keys(f);
    db.prepare(`UPDATE appellation_rules SET ${[...keys.map(k => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'].join(', ')} WHERE id = ?`).run(...keys.map(k => f[k]), now(), actor(req), row.id);
    audit(req, 'appellation_rule.updated', { entity: 'appellation_rule', entityId: row.id, before: Object.fromEntries(keys.map(k => [k, row[k]])), after: f });
    return { success: true };
  });
  r.post('/appellation-rules/:id/archive', req => {
    requireCap(req, CAN.compliance);
    const row = ruleRow(req.params.id);
    db.prepare('UPDATE appellation_rules SET archived_at = ?, archived_by = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(now(), actor(req), now(), actor(req), row.id);
    audit(req, 'appellation_rule.archived', { entity: 'appellation_rule', entityId: row.id });
    return { success: true };
  });

  master(r, {
    path: '/analysis-parameters', table: 'analysis_parameters', what: 'Parametro', cap: CAN.compliance, order: 'sort_order, name',
    fields: [
      { key: 'code', label: 'Codice', type: 'text', required: true, max: 40, createOnly: true },
      { key: 'name', label: 'Nome', type: 'text', required: true, max: 120 },
      { key: 'unit', label: 'Unità', type: 'text', required: true, max: 20 },
      { key: 'decimals', label: 'Decimali', type: 'int', min: 0, max: 4, default: 2 },
      { key: 'applies_to', label: 'Si misura su', type: 'multi', values: 'analysis_subject' },
      { key: 'legal_limit_config_key', label: 'Soglia collegata', type: 'refkey', ref: 'prd_config', refKey: 'key' },
      { key: 'sort_order', label: 'Ordine', type: 'int', default: 0 },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
    validate: f => {
      if (f.code !== undefined && !/^[a-z0-9_]+$/.test(f.code)) throw new HttpError(400, 'Codice: solo lettere minuscole, cifre e trattino basso.');
    },
    decorate: x => ({ ...x, applies_to: JSON.parse(x.applies_to || '[]') }),
  });

  master(r, {
    path: '/sian-map', table: 'sian_operation_map', what: 'Voce della mappa SIAN', cap: CAN.compliance, order: 'operation_type',
    fields: [
      { key: 'operation_type', label: 'Operazione', type: 'enum', values: 'operation_type', required: true },
      { key: 'sian_code', label: 'Codice SIAN', type: 'text', required: true, max: 40 },
      { key: 'description', label: 'Descrizione', type: 'text', max: 500 },
      { key: 'required_fields', label: 'Campi richiesti', type: 'text', max: 500 },
      { key: 'requires_document', label: 'Serve un documento giustificativo', type: 'bool' },
      { key: 'notes', label: 'Note', type: 'text', max: 2000 },
    ],
    // Una voce cambiata va rivalidata dal consulente.
    after: (id, { existing }) => { if (existing) db.prepare('UPDATE sian_operation_map SET validated_by = NULL, validated_at = NULL WHERE id = ?').run(id); },
  });
  r.post('/sian-map/:id/validate', req => {
    requireCap(req, CAN.compliance);
    const row = db.prepare('SELECT * FROM sian_operation_map WHERE id = ?').get(req.params.id);
    if (!row) throw new HttpError(404, t('msg.not_found', { what: 'Voce della mappa SIAN' }));
    db.prepare('UPDATE sian_operation_map SET validated_by = ?, validated_at = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(actor(req), now(), now(), actor(req), row.id);
    audit(req, 'sian_map.validated', { entity: 'sian_operation_map', entityId: row.id });
    return { success: true };
  });

  return { config, ensureCampaign, rulesAt, units, values };
};
