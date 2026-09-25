// Produzione — Fase 2: analisi (oggi sulle parcelle: maturazione; dalla Fase 3 anche su lotti e vasi),
// import da CSV o Excel del laboratorio, curve di maturazione per parcella con il confronto tra annate,
// previsione della vendemmia dai valori obiettivo per destinazione (soglia «harvest_targets»), sempre
// sostituibile a mano. Una correzione è un'analisi nuova: la vecchia si archivia.
const multer = require('multer');
const XLSX = require('xlsx');
const { HttpError } = require('../../lib/http');
const { romeDate, romeToUtc, daysBetween, addDays } = require('../../lib/time');
const { t, labels } = require('./i18n');
const { CAN } = require('./common');

const SUBJECT_TABLE = { parcel: 'vineyard_parcels', vessel: 'vessels' }; // lotti e cataste arrivano con le Fasi 3 e 5

module.exports = function registerPrdAnalyses(r, deps, c, cfg, interventions) {
  const { db, audit, getSetting } = deps;
  const { now, actor, requireCap, parseValue, fail, tx } = c;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  const params = () => db.prepare('SELECT * FROM analysis_parameters WHERE archived_at IS NULL').all().map(p => ({ ...p, applies_to: JSON.parse(p.applies_to || '[]') }));
  function findParam(key, list = params()) {
    const k = String(key).trim().toLowerCase();
    return list.find(p => String(p.id) === k || p.code.toLowerCase() === k || p.name.toLowerCase() === k) || null;
  }
  const pad = n => String(n).padStart(2, '0');
  const dateToUtc = (v, label) => {
    // Le celle data arrivano come Date a mezzanotte (locale da Excel, UTC dai CSV): a mezzogiorno UTC
    // si legge il giorno giusto in entrambi i casi.
    const noon = v instanceof Date ? new Date(v.getTime() + 12 * 3600000) : null;
    const s = noon ? `${noon.getUTCFullYear()}-${pad(noon.getUTCMonth() + 1)}-${pad(noon.getUTCDate())}` : String(v || '').trim();
    const it = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const iso = it ? `${it[3]}-${it[2].padStart(2, '0')}-${it[1].padStart(2, '0')}` : s;
    try { return romeToUtc(iso.length === 10 ? `${iso}T12:00` : iso); } catch { return fail('invalid_date', { field: label }); }
  };

  function validate(b, list = params()) {
    const subject_type = parseValue({ label: 'Oggetto', type: 'enum', values: Object.keys(SUBJECT_TABLE), required: true }, b.subject_type ?? 'parcel');
    const subject_id = parseValue({ label: 'Oggetto', type: 'int', required: true }, b.subject_id);
    if (!db.prepare(`SELECT 1 FROM ${SUBJECT_TABLE[subject_type]} WHERE id = ?`).get(subject_id)) throw new HttpError(400, t('msg.analysis_subject_missing'));
    const sampled_at = dateToUtc(b.sampled_at, 'Data del campione');
    const sample_date = romeDate(new Date(sampled_at));
    const f = {
      subject_type, subject_id, sampled_at, sample_date,
      harvest_year: subject_type === 'parcel' ? interventions.harvestYearOf(sample_date) : null,
      source: parseValue({ label: 'Origine', type: 'enum', values: Object.keys(labels('analysis_source')) }, b.source ?? 'internal_lab') || 'internal_lab',
      supplier_id: b.supplier_id ? parseValue({ label: 'Laboratorio', type: 'ref', ref: 'suppliers' }, b.supplier_id) : null,
      report_number: parseValue({ label: 'N. referto', type: 'text', max: 60 }, b.report_number ?? null),
      notes: parseValue({ label: 'Note', type: 'text', max: 2000 }, b.notes ?? null),
    };
    const results = (b.results || []).filter(x => x && x.value !== '' && x.value != null).map(x => {
      const p = findParam(x.parameter_id ?? x.parameter ?? x.code, list);
      if (!p) throw new HttpError(400, t('msg.analysis_param_unknown', { param: x.parameter_id ?? x.parameter ?? x.code }));
      if (!p.applies_to.includes(subject_type)) throw new HttpError(400, t('msg.analysis_param_subject', { param: p.name, subject: labels('analysis_subject')[subject_type].toLowerCase() }));
      let raw = x.value, qualifier = x.qualifier || '=';
      const m = typeof raw === 'string' ? raw.trim().match(/^([<>])\s*(.+)$/) : null; // «<0,5» dal referto
      if (m) { qualifier = m[1]; raw = m[2]; }
      return { parameter_id: p.id, value_e4: parseValue({ label: p.name, type: 'e4' }, raw), qualifier: parseValue({ label: 'Qualificatore', type: 'enum', values: ['<', '=', '>'] }, qualifier) };
    });
    if (!results.length) throw new HttpError(400, t('msg.analysis_results'));
    if (new Set(results.map(x => x.parameter_id)).size !== results.length) throw new HttpError(400, 'Lo stesso parametro compare due volte.');
    return { f, results };
  }
  function insert(req, { f, results }, importBatch = null) {
    const cols = [...Object.keys(f), 'import_batch', 'created_at', 'created_by', 'updated_at', 'updated_by'];
    const id = Number(db.prepare(`INSERT INTO analyses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(f), importBatch, now(), actor(req), now(), actor(req)).lastInsertRowid);
    const ins = db.prepare('INSERT INTO analysis_results (analysis_id, parameter_id, value_e4, qualifier) VALUES (?, ?, ?, ?)');
    for (const x of results) ins.run(id, x.parameter_id, x.value_e4, x.qualifier);
    return id;
  }
  const subjectLabel = (type, id) => {
    if (type === 'parcel') { const p = db.prepare('SELECT code, name FROM vineyard_parcels WHERE id = ?').get(id); return p ? `${p.code}${p.name ? ` · ${p.name}` : ''}` : `#${id}`; }
    if (type === 'vessel') return db.prepare('SELECT code FROM vessels WHERE id = ?').get(id)?.code || `#${id}`;
    return `#${id}`;
  };
  const withResults = a => ({ ...a, subject_label: subjectLabel(a.subject_type, a.subject_id), results: db.prepare(`SELECT r.parameter_id, r.value_e4, r.qualifier, p.code, p.name, p.unit, p.decimals
    FROM analysis_results r JOIN analysis_parameters p ON p.id = r.parameter_id WHERE r.analysis_id = ? ORDER BY p.sort_order`).all(a.id).map(x => ({ ...x })) });

  r.get('/analyses', req => {
    const q = req.query;
    return db.prepare(`SELECT * FROM analyses WHERE (? = '1' OR archived_at IS NULL) AND (? IS NULL OR subject_type = ?) AND (? IS NULL OR subject_id = ?) AND (? IS NULL OR harvest_year = ?)
      ORDER BY sample_date DESC, id DESC LIMIT 500`).all(q.archived || '0', q.subject_type || null, q.subject_type || null, q.subject_id || null, q.subject_id || null, q.year || null, q.year || null)
      .map(a => withResults({ ...a }));
  });
  r.get('/analyses/:id(\\d+)', req => {
    const a = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id);
    if (!a) throw new HttpError(404, t('msg.not_found', { what: 'Analisi' }));
    return withResults({ ...a });
  });
  r.post('/analyses', req => {
    requireCap(req, CAN.analyses);
    const v = validate(req.body || {});
    const id = tx(() => insert(req, v));
    audit(req, 'analysis.created', { entity: 'analysis', entityId: id, after: { subject_type: v.f.subject_type, subject_id: v.f.subject_id, results: v.results.length } });
    return { id };
  });
  r.post('/analyses/:id/archive', req => {
    requireCap(req, CAN.analyses);
    const a = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id);
    if (!a) throw new HttpError(404, t('msg.not_found', { what: 'Analisi' }));
    db.prepare('UPDATE analyses SET archived_at = ?, archived_by = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(now(), actor(req), now(), actor(req), a.id);
    audit(req, 'analysis.archived', { entity: 'analysis', entityId: a.id });
    return { success: true };
  });

  // ── Import dal laboratorio: una riga per campione, una colonna per parametro (codice o nome) ─────────
  // Colonne fisse: parcella (codice), data (AAAA-MM-GG o GG/MM/AAAA), facoltative referto, origine, note.
  // Si controlla tutto; se una riga ha un errore non si importa niente e si risponde con l'elenco.
  const FIXED = ['parcella', 'data', 'referto', 'origine', 'note'];
  // Valore di un referto: un numero di Excel resta com'è; nel testo la virgola è decimale («14,5», «1.234,5»),
  // senza virgola lo è il punto («1.092» è una densità, non mille). «<0,5» porta il qualificatore.
  function labValue(v, param) {
    if (typeof v === 'number') return { value: v };
    const m = String(v).trim().match(/^([<>])?\s*(.+)$/);
    const txt = m[2].replace(/\s/g, '');
    const n = Number(txt.includes(',') ? txt.replace(/\./g, '').replace(',', '.') : txt);
    if (!Number.isFinite(n)) throw new HttpError(400, `«${param}»: «${String(v).trim()}» non è un numero`);
    return { value: n, qualifier: m[1] || '=' };
  }
  r.get('/analyses/template', (req, res) => {
    const cols = [...FIXED, ...params().filter(p => p.applies_to.includes('parcel')).map(p => p.code)];
    const ws = XLSX.utils.aoa_to_sheet([cols, ['PAR-01', romeDate(), 'R-123', 'external_lab', '', ...cols.slice(FIXED.length).map(() => '')]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analisi');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modello-analisi-maturazione.xlsx"');
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  });
  // Il permesso si controlla prima di ricevere il file.
  const canImport = (req, res, next) => { try { requireCap(req, CAN.analyses); next(); } catch (e) { res.status(e.status || 403).json({ error: e.message }); } };
  r.post('/analyses/import', canImport, upload.single('file'), req => {
    if (!req.file) throw new HttpError(400, 'Carica il file del laboratorio (CSV o Excel).');
    // Excel: numeri e date arrivano già tipizzati. CSV: tutto resta testo (raw), altrimenti SheetJS legge
    // «14,5» come 145 e «09/10/2026» all'americana; numeri e date si leggono qui sotto, all'italiana.
    const buf = req.file.buffer;
    const isSheet = (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf); // xlsx (zip) o xls
    const wb = XLSX.read(buf, isSheet ? { type: 'buffer', cellDates: true } : { type: 'buffer', raw: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
    if (!rows.length) throw new HttpError(400, t('msg.import_empty'));
    const list = params();
    const key = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [String(k).trim().toLowerCase(), v]));
    const parsed = [], errors = [];
    rows.forEach((raw, i) => {
      const row = key(raw);
      try {
        const code = String(row.parcella || '').trim().toUpperCase();
        const parcel = db.prepare('SELECT id FROM vineyard_parcels WHERE upper(code) = ? AND archived_at IS NULL').get(code);
        if (!parcel) throw new HttpError(400, `parcella «${code || '—'}» non trovata`);
        const results = Object.entries(row).filter(([k, v]) => !FIXED.includes(k) && String(v).trim() !== '').map(([k, v]) => {
          const p = findParam(k, list);
          if (!p) throw new HttpError(400, t('msg.analysis_param_unknown', { param: k }));
          return { parameter_id: p.id, ...labValue(v, p.name) };
        });
        parsed.push({ row: i + 2, v: validate({ subject_type: 'parcel', subject_id: parcel.id, sampled_at: row.data, report_number: row.referto || null, source: row.origine || 'external_lab', notes: row.note || null, results }, list) });
      } catch (e) {
        errors.push({ row: i + 2, error: e.message });
      }
    });
    // Nell'anteprima i valori letti, così un file letto male si vede prima di importarlo.
    const byId = new Map(list.map(p => [p.id, p]));
    const shown = x => `${byId.get(x.parameter_id).name} ${x.qualifier === '=' ? '' : `${x.qualifier} `}${(x.value_e4 / 10000).toLocaleString('it-IT', { maximumFractionDigits: 4 })}`;
    const preview = parsed.map(p => ({ row: p.row, parcel: subjectLabel('parcel', p.v.f.subject_id), date: p.v.f.sample_date, results: p.v.results.length, values: p.v.results.map(shown).join(' · ') }));
    if (errors.length) throw new HttpError(400, t('msg.import_errors', { n: errors.length }), { errors, preview });
    if (req.body?.dry_run === '1' || req.body?.dry_run === 'true') return { dry_run: true, preview };
    const batch = `import-${now()}`;
    const ids = tx(() => parsed.map(p => insert(req, p.v, batch)));
    audit(req, 'analysis.imported', { entity: 'analysis', after: { rows: ids.length, file: req.file.originalname } });
    return { imported: ids.length, preview };
  });

  // ── Curve di maturazione: un parametro, una parcella, più annate a confronto (per giorno dell'anno) ─
  const doy = d => daysBetween(`${d.slice(0, 4)}-01-01`, d) + 1;
  const sugarCode = () => (getSetting('prd_unit_sugar', 'babo') === 'brix' ? 'zuccheri_brix' : 'zuccheri_babo');
  function series(parcelId, code, year) {
    return db.prepare(`SELECT a.sample_date AS date, r.value_e4 FROM analyses a JOIN analysis_results r ON r.analysis_id = a.id JOIN analysis_parameters p ON p.id = r.parameter_id
      WHERE a.subject_type = 'parcel' AND a.subject_id = ? AND a.archived_at IS NULL AND p.code = ? AND a.harvest_year = ? ORDER BY a.sample_date`).all(parcelId, code, year)
      .map(x => ({ date: x.date, doy: doy(x.date), value: x.value_e4 / 10000 }));
  }
  r.get('/maturation', req => {
    const parcelId = Number(req.query.parcel_id);
    const code = req.query.parameter || sugarCode();
    const p = findParam(code);
    if (!p) throw new HttpError(400, t('msg.analysis_param_unknown', { param: code }));
    const years = String(req.query.years || '').split(',').map(Number).filter(Boolean);
    const all = years.length ? years : db.prepare(`SELECT DISTINCT harvest_year AS y FROM analyses WHERE subject_type = 'parcel' AND subject_id = ? AND archived_at IS NULL ORDER BY y DESC LIMIT 4`).all(parcelId).map(x => x.y);
    return { parameter: { code: p.code, name: p.name, unit: p.unit, decimals: p.decimals }, series: all.map(y => ({ year: y, points: series(parcelId, p.code, y) })) };
  });

  // ── Previsione della vendemmia ──────────────────────────────────────────────
  // Per ogni parametro obiettivo si traccia la retta dei campioni dell'annata (almeno 2): il giorno in cui
  // il valore entra nell'intervallo obiettivo è il «dal»; se il valore ne uscirà (es. l'acidità che scende
  // sotto il minimo per la base spumante) quel giorno è l'«entro». Una stima semplice: la data a mano vince.
  function fit(points) {
    const pts = points.slice(-5);
    if (pts.length < 2) return null;
    const n = pts.length, mx = pts.reduce((s, p) => s + p.doy, 0) / n, my = pts.reduce((s, p) => s + p.value, 0) / n;
    const sxx = pts.reduce((s, p) => s + (p.doy - mx) ** 2, 0);
    if (!sxx) return null;
    const b = pts.reduce((s, p) => s + (p.doy - mx) * (p.value - my), 0) / sxx;
    return { a: my - b * mx, b, last: pts[pts.length - 1] };
  }
  // Arrotondamento al giorno con una tolleranza: 241,99999… è il giorno 242, non il 243.
  const up = x => Math.ceil(x - 1e-6), down = x => Math.floor(x + 1e-6);
  function forecast(parcelId, year, target) {
    let from = null, by = null;
    const basis = [];
    for (const [code, tg] of Object.entries(target)) {
      const pts = series(parcelId, code, year);
      const l = fit(pts);
      if (!l) return { from: null, by: null, basis: [...basis, `${code}: servono almeno 2 campioni`] };
      const cur = l.last.value;
      const inside = (tg.min == null || cur >= tg.min) && (tg.max == null || cur <= tg.max);
      let enter = null;
      if (inside) enter = l.last.doy;
      else if (tg.min != null && cur < tg.min && l.b > 0) enter = up((tg.min - l.a) / l.b);
      else if (tg.max != null && cur > tg.max && l.b < 0) enter = up((tg.max - l.a) / l.b);
      else return { from: null, by: null, basis: [...basis, `${code}: l'andamento non va verso l'obiettivo`] };
      let leave = null;
      if (tg.max != null && l.b > 0) leave = down((tg.max - l.a) / l.b);
      if (tg.min != null && l.b < 0) leave = down((tg.min - l.a) / l.b);
      from = Math.max(from ?? 0, enter);
      if (leave != null) by = Math.min(by ?? Infinity, leave);
      basis.push(`${code}: ${l.b >= 0 ? '+' : ''}${l.b.toFixed(3)} al giorno, ultimo ${cur}`);
    }
    const date = d => (d == null ? null : addDays(`${year}-01-01`, d - 1));
    return { from: date(from), by: by === Infinity ? null : date(by), basis };
  }
  r.get('/harvest-forecast', req => {
    const year = Number(req.query.year) || Number(romeDate().slice(0, 4));
    const targets = cfg.config('harvest_targets') || {};
    const parcels = db.prepare('SELECT p.id, p.code, p.name FROM vineyard_parcels p WHERE p.archived_at IS NULL AND p.active = 1 ORDER BY p.code').all();
    const out = [];
    for (const p of parcels) {
      const sampled = db.prepare("SELECT COUNT(*) AS c FROM analyses WHERE subject_type = 'parcel' AND subject_id = ? AND harvest_year = ? AND archived_at IS NULL").get(p.id, year).c;
      for (const dest of Object.keys(labels('harvest_destination'))) {
        const manual = db.prepare('SELECT manual_date, note FROM harvest_forecasts WHERE parcel_id = ? AND harvest_year = ? AND destination = ?').get(p.id, year, dest);
        if (!targets[dest] && !manual) continue;
        const f = targets[dest] ? forecast(p.id, year, targets[dest]) : { from: null, by: null, basis: [] };
        out.push({ parcel_id: p.id, code: p.code, name: p.name, destination: dest, samples: sampled, computed_from: f.from, computed_by: f.by, basis: f.basis,
          manual_date: manual?.manual_date || null, note: manual?.note || null, date: manual?.manual_date || f.from });
      }
    }
    return { year, targets_set: Object.keys(targets).length > 0, rows: out };
  });
  r.put('/harvest-forecast', req => {
    requireCap(req, CAN.analyses);
    const b = req.body || {};
    const parcelId = parseValue({ label: 'Parcella', type: 'ref', ref: 'vineyard_parcels', required: true }, b.parcel_id);
    const year = parseValue({ label: 'Annata', type: 'int', required: true, min: 1990, max: 2100 }, b.harvest_year);
    const dest = parseValue({ label: 'Destinazione', type: 'enum', values: Object.keys(labels('harvest_destination')), required: true }, b.destination);
    const manual = parseValue({ label: 'Data prevista', type: 'date' }, b.manual_date ?? null);
    const note = parseValue({ label: 'Note', type: 'text', max: 500 }, b.note ?? null);
    db.prepare(`INSERT INTO harvest_forecasts (parcel_id, harvest_year, destination, manual_date, note, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (parcel_id, harvest_year, destination) DO UPDATE SET manual_date = excluded.manual_date, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(parcelId, year, dest, manual, note, now(), actor(req), now(), actor(req));
    audit(req, 'harvest_forecast.set', { entity: 'vineyard_parcel', entityId: parcelId, after: { year, dest, manual } });
    return { success: true };
  });

  return { forecast, series };
};
