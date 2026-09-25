// Portale → Produzione (Fase 1): anagrafiche di vigneto, cantina e configurazione.
// Qui il nucleo: catalogo (valori ammessi, capacità, unità), conversioni delle unità a schermo,
// anagrafica generica (elenco con ricerca e archiviati + modulo) e le pagine di Configurazione.
// Vigneto in portal-prd-vineyard.js, cantina in portal-prd-cellar.js. Testi in prd-i18n.js.
const PRD = { catalog: null, view: {}, archived: {}, search: {}, cache: {} };
const PRD_API = '/api/admin/prd';

async function prdCatalog(force = false) {
  if (!PRD.catalog || force) PRD.catalog = await api(`${PRD_API}/catalog`);
  return PRD.catalog;
}
const prdLabel = (group, key) => (PRD.catalog?.labels?.[group] || {})[key] ?? key ?? '—';
const prdCan = area => !!PRD.catalog?.can?.[area];

// ── Unità a schermo (nel database: ml, g, m²) ─────────────────────────────────
const PRD_UNITS = {
  volume: { hl: { f: 100000, d: 2, s: 'hl' }, l: { f: 1000, d: 0, s: 'L' } },
  weight: { q: { f: 100000, d: 2, s: 'q' }, kg: { f: 1000, d: 0, s: 'kg' } },
  area: { ha: { f: 10000, d: 4, s: 'ha' }, m2: { f: 1, d: 0, s: 'm²' } },
};
const prdUnit = kind => PRD_UNITS[kind][PRD.catalog?.units?.[kind]] || Object.values(PRD_UNITS[kind])[0];
function prdFmt(kind, base) {
  if (base == null || base === '') return '—';
  const u = prdUnit(kind);
  return `${(base / u.f).toLocaleString('it-IT', { maximumFractionDigits: u.d, useGrouping: 'always' })} ${u.s}`;
}
const prdToInput = (kind, base) => (base == null ? '' : String(+(base / prdUnit(kind).f).toFixed(prdUnit(kind).d)).replace('.', ','));
function prdFromInput(kind, text) {
  const s = UI.num(text);
  if (s === '') return null;
  const n = Number(String(s).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Numero non valido: ${text}`);
  return Math.round(n * prdUnit(kind).f);
}
const prdE4 = v => (v == null ? '' : (v / 10000).toLocaleString('it-IT', { maximumFractionDigits: 4, useGrouping: 'always' }));
const prdE4Input = v => (v == null ? '' : String(v / 10000).replace('.', ','));

// ── Pagine ──────────────────────────────────────────────────────────────────
const PRD_PAGES = {
  'prd-vigneti': ['vineyards', 'parcels', 'cadastral'],
  'prd-mezzi': ['equipment', 'phyto'],
  'prd-vasi': ['vessels', 'locations'],
  'prd-protocolli': ['protocols'],
  'prd-config': ['varieties', 'appellations', 'parameters', 'establishments', 'campaigns', 'sianmap', 'thresholds'],
};
async function loadPrd(sub) {
  const root = document.getElementById(`${sub}-root`);
  if (!root) return;
  try { await prdCatalog(true); } catch (e) { root.innerHTML = `<div class="list-card"><div class="mod-empty">${esc(e.message)}</div></div>`; return; }
  const views = PRD_PAGES[sub];
  const view = PRD.view[sub] && views.includes(PRD.view[sub]) ? PRD.view[sub] : views[0];
  PRD.view[sub] = view;
  const tabs = views.length > 1 ? `<div class="rec-tabs">${views.map(v => `<button class="${v === view ? 'active' : ''}" onclick="PRD.view['${sub}']='${v}'; loadPrd('${sub}')">${esc(T(`title.${PRD_SPECS[v].title}`))}</button>`).join('')}</div>` : '';
  root.innerHTML = `<div class="list-card">${tabs}<div id="${sub}-body"><div class="mod-empty">…</div></div></div>`;
  const body = document.getElementById(`${sub}-body`);
  try {
    const spec = PRD_SPECS[view];
    if (spec.render) await spec.render(body, sub);
    else await prdRenderMaster(body, view, sub);
  } catch (e) { body.innerHTML = `<div class="mod-empty">${esc(e.message)}</div>`; }
}
const prdHead = (spec, extra = '') => `<div class="list-toolbar"><div class="list-toolbar-title"><h3>${esc(T(`title.${spec.title}`))}</h3><p class="mod-intro">${esc(T(`intro.${spec.title}`))}</p></div><div class="list-spacer"></div>${extra}</div>`;

// ── Anagrafica generica ─────────────────────────────────────────────────────
// Un campo: 'chiave' (testo) oppure { key, type, group, source, full }. Tipi: text, textarea, int, decimal
// (× 10.000 sul server), money, bool, date, enum (group del catalogo), ref (source), multi (group), area, volume.
const prdField = f => (typeof f === 'string' ? { key: f, type: 'text' } : { type: 'text', ...f });
async function prdOptions(source) {
  const spec = PRD_SPECS[source];
  if (!PRD.cache[source]) PRD.cache[source] = await api(spec?.url || `${PRD_API}${spec?.path || source}`);
  return PRD.cache[source];
}
const prdOptionLabel = (source, o) => (PRD_SPECS[source]?.optionLabel ? PRD_SPECS[source].optionLabel(o) : o.name ?? o.label ?? o.code ?? o.id);
function prdFieldInput(f, row) {
  const v = row ? row[f.key] : undefined;
  const label = `<label>${esc(T(`f.${f.key}`))}${f.suffix ? ` ${esc(f.suffix())}` : ''}</label>`;
  const name = `name="${f.key}"`;
  switch (f.type) {
    case 'textarea': return `<div class="field">${label}<textarea ${name} rows="3">${esc(v ?? '')}</textarea></div>`;
    // Fuori da .field: lì gli input prendono tutta la larghezza.
    case 'bool': return `<div style="padding-top:22px"><label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" style="width:auto" ${name} ${(row ? v : f.default) ? 'checked' : ''}>${esc(T(`f.${f.key}`))}</label></div>`;
    case 'date': return `<div class="field">${label}<input type="date" ${name} value="${UI.attr(v ?? '')}"></div>`;
    case 'int': return `<div class="field">${label}<input ${name} inputmode="numeric" value="${UI.attr(v ?? '')}"></div>`;
    case 'decimal': return `<div class="field">${label}<input ${name} inputmode="decimal" value="${UI.attr(prdE4Input(v))}"></div>`;
    case 'money': return `<div class="field">${label}<input ${name} inputmode="decimal" value="${UI.attr(v == null ? '' : String(v / 100).replace('.', ','))}"></div>`;
    case 'area': case 'volume': return `<div class="field"><label>${esc(T(`f.${f.key}`))} (${esc(prdUnit(f.type).s)})</label><input ${name} inputmode="decimal" value="${UI.attr(prdToInput(f.type, v))}"></div>`;
    case 'enum': {
      const opts = Object.entries(PRD.catalog.labels[f.group] || {}).filter(([k]) => !f.only || f.only.includes(k) || k === v).map(([id, n]) => ({ id, name: n }));
      return `<div class="field">${label}<select ${name}>${UI.options(opts, v ?? f.default ?? '', { empty: f.required ? null : '—' })}</select></div>`;
    }
    case 'ref': {
      const opts = (PRD.cache[f.source] || []).map(o => ({ id: o.id, name: prdOptionLabel(f.source, o) }));
      return `<div class="field">${label}<select ${name}>${UI.options(opts, v ?? '', { empty: '—' })}</select></div>`;
    }
    case 'multi': {
      const sel = Array.isArray(v) ? v : [];
      return `<div class="field">${label}<div style="display:flex;flex-wrap:wrap;gap:6px 14px">${Object.entries(PRD.catalog.labels[f.group] || {}).map(([k, n]) =>
        `<label style="display:inline-flex;gap:5px;align-items:center;text-transform:none;letter-spacing:0;font-weight:400"><input type="checkbox" style="width:auto" data-multi="${f.key}" value="${UI.attr(k)}" ${sel.includes(k) ? 'checked' : ''}>${esc(n)}</label>`).join('')}</div></div>`;
    }
    default: return `<div class="field">${label}<input ${name} value="${UI.attr(v ?? '')}"></div>`;
  }
}
function prdCollect(box, fields) {
  const out = {};
  for (const f of fields.map(prdField)) {
    if (f.readOnly) continue;
    if (f.type === 'multi') { out[f.key] = [...box.querySelectorAll(`[data-multi="${f.key}"]:checked`)].map(x => x.value); continue; }
    const el = box.querySelector(`[name="${f.key}"]`);
    if (!el) continue;
    if (f.type === 'bool') out[f.key] = el.checked;
    else if (f.type === 'area' || f.type === 'volume') out[f.key] = prdFromInput(f.type, el.value);
    else if (['int', 'decimal', 'money'].includes(f.type)) out[f.key] = UI.num(el.value);
    else out[f.key] = el.value.trim();
  }
  return out;
}
// Campi a coppie per righe, i testi lunghi da soli.
function prdFormBody(fields, row) {
  const list = fields.map(prdField);
  const rows = [];
  let pair = [];
  for (const f of list) {
    if (f.readOnly) continue;
    if (f.full || ['textarea', 'multi'].includes(f.type)) { if (pair.length) rows.push(pair); pair = []; rows.push([f]); continue; }
    pair.push(f);
    if (pair.length === 2) { rows.push(pair); pair = []; }
  }
  if (pair.length) rows.push(pair);
  return rows.map(r => (r.length > 1 ? `<div class="field-row">${r.map(f => prdFieldInput(f, row)).join('')}</div>` : prdFieldInput(r[0], row))).join('');
}
async function prdPrepareRefs(fields) {
  for (const f of fields.map(prdField)) if (f.type === 'ref') await prdOptions(f.source);
}
async function prdOpenForm(specKey, row = null, sub = null) {
  const spec = PRD_SPECS[specKey];
  const full = row ? await api(`${PRD_API}${spec.path}/${row.id}`) : null;
  await prdPrepareRefs(spec.fields);
  const extra = spec.extraForm ? await spec.extraForm(full) : '';
  const readOnly = !prdCan(spec.area);
  UI.modal({
    id: 'prd-form', title: `${T(`title.${spec.title}`)}${full ? ` · ${full.code || full.name || full.label || ''}` : ''}`, width: spec.width || 640,
    body: prdFormBody(spec.fields, full) + extra + (readOnly ? `<p class="mod-note">${esc(T('msg.soloLettura'))}</p>` : ''),
    saveLabel: T('btn.salva'),
    onSave: readOnly ? null : async box => {
      const body = { ...prdCollect(box, spec.fields), ...(spec.collectExtra ? spec.collectExtra(box, full) : {}) };
      if (full) await api(`${PRD_API}${spec.path}/${full.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api(`${PRD_API}${spec.path}`, { method: 'POST', body: JSON.stringify(body) });
      delete PRD.cache[specKey];
      loadPrd(sub || prdSubOf(specKey));
    },
    extraButtons: full && !readOnly && spec.archive !== false ? `<button class="btn secondary" type="button" onclick="prdArchive('${specKey}', ${full.id}, ${full.archived_at ? 'true' : 'false'})">${esc(T(full.archived_at ? 'btn.riattiva' : 'btn.archivia'))}</button>` : '',
  });
  if (spec.afterOpen) spec.afterOpen(document.getElementById('prd-form'), full);
}
const prdSubOf = specKey => Object.keys(PRD_PAGES).find(s => PRD_PAGES[s].includes(specKey));
async function prdArchive(specKey, id, restore) {
  const spec = PRD_SPECS[specKey];
  if (!restore && !confirm(T('msg.archiviaDomanda'))) return;
  try {
    await api(`${PRD_API}${spec.path}/${id}/${restore ? 'restore' : 'archive'}`, { method: 'POST' });
    document.getElementById('prd-form')?.remove();
    delete PRD.cache[specKey];
    loadPrd(prdSubOf(specKey));
  } catch (e) { alert(e.message); }
}
async function prdRenderMaster(body, specKey, sub) {
  const spec = PRD_SPECS[specKey];
  const showArchived = !!PRD.archived[specKey];
  await prdPrepareRefs(spec.fields);
  if (spec.prepare) await spec.prepare();
  const rows = await api(`${PRD_API}${spec.path}${spec.archive === false ? '' : showArchived ? '?archived=1' : ''}`);
  const q = (PRD.search[specKey] || '').toLowerCase();
  const shown = rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
  const actions = `<div class="mod-toolbar-fields"><input placeholder="${UI.attr(T('btn.cerca'))}" value="${UI.attr(PRD.search[specKey] || '')}" oninput="PRD.search['${specKey}']=this.value; clearTimeout(PRD.t); PRD.t=setTimeout(()=>loadPrd('${sub}'),300)">
    ${spec.archive === false ? '' : `<label style="display:inline-flex;gap:5px;align-items:center;font-size:12.5px"><input type="checkbox" ${showArchived ? 'checked' : ''} onchange="PRD.archived['${specKey}']=this.checked; loadPrd('${sub}')">${esc(T('btn.archiviati'))}</label>`}</div>
    ${spec.toolbar ? spec.toolbar() : ''}${prdCan(spec.area) && spec.create !== false ? `<button class="btn small" onclick="prdOpenForm('${specKey}', null, '${sub}')">${UI.icon.plus} ${esc(T('btn.nuovo'))}</button>` : ''}`;
  body.innerHTML = prdHead(spec, actions) + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr>${spec.columns.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label || T(`f.${c.key}`))}</th>`).join('')}</tr></thead><tbody>
    ${shown.map(r => `<tr class="mod-clickable" style="${r.archived_at ? 'opacity:.55' : ''}" onclick="${spec.onRow ? spec.onRow(r) : `prdOpenForm('${specKey}', { id: ${r.id} }, '${sub}')`}">${spec.columns.map(c => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${spec.columns.length}" class="empty">${esc(T('msg.vuoto'))}</td></tr>`}
  </tbody></table></div>`;
}
const prdBadge = (text, color = 'grey') => `<span class="badge ${color}">${esc(text)}</span>`;
const prdArchivedBadge = r => (r.archived_at ? ` ${prdBadge(T('msg.archiviato'))}` : '');

// ── Specifiche delle anagrafiche ────────────────────────────────────────────
const PRD_SPECS = {
  varieties: {
    path: '/varieties', title: 'vitigni', area: 'varieties',
    columns: [{ key: 'name', render: r => `<b>${esc(r.name)}</b>${prdArchivedBadge(r)}` }, { key: 'color', render: r => esc(prdLabel('grape_color', r.color)) }, { key: 'sian_code' }],
    fields: ['name', { key: 'color', type: 'enum', group: 'grape_color', required: true }, 'sian_code', { key: 'notes', type: 'textarea' }],
  },
  appellations: {
    path: '/appellations', title: 'denominazioni', area: 'compliance',
    columns: [{ key: 'name', render: r => `<b>${esc(r.name)}</b>${prdArchivedBadge(r)}` }, { key: 'type', render: r => esc(prdLabel('appellation_type', r.type)) },
      { key: 'requires_state_seal', render: r => (r.requires_state_seal ? prdBadge('contrassegni', 'yellow') : '') }, { key: 'sian_code' }],
    fields: ['name', { key: 'type', type: 'enum', group: 'appellation_type', required: true }, 'sian_code', { key: 'requires_state_seal', type: 'bool' }, { key: 'notes', type: 'textarea' }],
    extraForm: async full => { if (!full) return ''; await prdOptions('varieties'); return prdRulesBlock(full); },
    width: 760,
  },
  parameters: {
    path: '/analysis-parameters', title: 'parametri', area: 'compliance',
    columns: [{ key: 'name', render: r => `<b>${esc(r.name)}</b>${prdArchivedBadge(r)}` }, { key: 'code' }, { key: 'unit' }, { key: 'decimals', num: true },
      { key: 'applies_to', render: r => esc((r.applies_to || []).map(x => prdLabel('analysis_subject', x)).join(', ')) }],
    fields: ['code', 'name', 'unit', { key: 'decimals', type: 'int' }, { key: 'sort_order', type: 'int' }, { key: 'legal_limit_config_key' },
      { key: 'applies_to', type: 'multi', group: 'analysis_subject' }, { key: 'notes', type: 'textarea' }],
  },
  establishments: {
    path: '/establishments', title: 'stabilimenti', area: 'compliance',
    columns: [{ key: 'name', render: r => `<b>${esc(r.name)}</b>${prdArchivedBadge(r)}` }, { key: 'icqrf_code' }, { key: 'regime', render: r => esc(prdLabel('regime', r.regime)) },
      { key: 'fiscal_warehouse', render: r => (r.fiscal_warehouse ? '✓' : '') }],
    fields: ['name', 'icqrf_code', { key: 'address', full: true }, { key: 'regime', type: 'enum', group: 'regime', required: true }, { key: 'fiscal_warehouse', type: 'bool' }, { key: 'notes', type: 'textarea' }],
  },
  campaigns: {
    path: '/campaigns', title: 'campagne', area: 'compliance', archive: false, create: false,
    columns: [{ key: 'label', render: r => `<b>${esc(r.label)}</b>${r.current ? ` ${prdBadge(T('msg.campagnaInCorso'), 'green')}` : ''}` }, { key: 'starts_on', render: r => UI.date(r.starts_on) }, { key: 'ends_on', render: r => UI.date(r.ends_on) }],
    fields: [], onRow: () => '',
  },
  sianmap: {
    path: '/sian-map', title: 'sian', area: 'compliance',
    columns: [{ key: 'operation_type', render: r => `<b>${esc(prdLabel('operation_type', r.operation_type))}</b>${prdArchivedBadge(r)}` }, { key: 'sian_code' },
      { key: 'requires_document', render: r => (r.requires_document ? '✓' : '') }, { key: 'validated', label: T('f.validated'), render: r => (r.validated_at ? prdBadge(T('msg.validataDa', { who: r.validated_by, when: UI.date(r.validated_at.slice(0, 10)) }), 'green') : prdBadge(T('msg.daValidare'), 'yellow')) }],
    fields: [{ key: 'operation_type', type: 'enum', group: 'operation_type', required: true }, 'sian_code', { key: 'description', full: true }, { key: 'required_fields', full: true },
      { key: 'requires_document', type: 'bool' }, { key: 'notes', type: 'textarea' }],
    extraForm: async full => (full && prdCan('compliance') && !full.validated_at ? `<p><button class="btn secondary small" type="button" onclick="prdValidateSian(${full.id})">${esc(T('btn.convalida'))}</button></p>` : ''),
  },
  thresholds: { title: 'soglie', render: (body, sub) => prdRenderThresholds(body, sub) },
};

// ── Denominazioni: regole del disciplinare ──────────────────────────────────
function prdRulesBlock(a) {
  const rules = a.rules || [];
  const canEdit = prdCan('compliance');
  const row = r => `<tr style="${r.archived_at ? 'opacity:.5' : ''}"><td>${esc(prdLabel('rule_type', r.rule_type))}${r.mention ? ` · <i>${esc(r.mention)}</i>` : ''}</td>
    <td class="num">${esc(prdE4(r.value_e4))} ${esc(r.unit || '')}</td><td>${UI.date(r.valid_from)} → ${r.valid_to ? UI.date(r.valid_to) : '…'}</td><td>${esc(r.source_note || '')}</td>
    <td>${canEdit && !r.archived_at ? `<button class="btn-outline-pill" type="button" onclick="prdArchiveRule(${r.id}, ${a.id})">${esc(T('btn.togli'))}</button>` : ''}</td></tr>`;
  const varieties = (PRD.cache.varieties || []).map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  return `<div class="mod-section-title" style="margin-top:14px">${esc(T('btn.regole'))}</div>
    <div class="mod-table-wrap"><table class="mod-table" style="min-width:0"><tbody>${rules.map(row).join('') || `<tr><td class="empty">${esc(T('msg.nessunaRegola'))}</td></tr>`}</tbody></table></div>
    ${canEdit ? `<div id="prd-rule-new" style="margin-top:10px"><div class="field-row">
        <div class="field"><label>${esc(T('f.rule_type'))}</label><select data-rule="rule_type">${Object.entries(PRD.catalog.labels.rule_type).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select></div>
        <div class="field"><label>${esc(T('f.value_e4'))}</label><input data-rule="value_e4" inputmode="decimal"></div>
        <div class="field"><label>${esc(T('f.mention'))}</label><input data-rule="mention" placeholder="es. Riserva"></div></div>
      <div class="field-row"><div class="field"><label>${esc(T('f.valid_from'))}</label><input type="date" data-rule="valid_from"></div>
        <div class="field"><label>${esc(T('f.valid_to'))}</label><input type="date" data-rule="valid_to"></div>
        <div class="field"><label>${esc(T('f.variety_id'))}</label><select data-rule="variety_id"><option value="">—</option>${varieties}</select></div></div>
      <div class="field"><label>${esc(T('f.source_note'))}</label><input data-rule="source_note" placeholder="es. disciplinare DM …, art. 4"></div>
      <button class="btn secondary small" type="button" onclick="prdAddRule(${a.id})">${esc(T('btn.aggiungiRegola'))}</button></div>` : ''}`;
}
async function prdAddRule(appellationId) {
  const box = document.getElementById('prd-rule-new');
  const body = Object.fromEntries([...box.querySelectorAll('[data-rule]')].map(el => [el.dataset.rule, el.dataset.rule === 'value_e4' ? UI.num(el.value) : el.value.trim()]));
  try {
    await api(`${PRD_API}/appellations/${appellationId}/rules`, { method: 'POST', body: JSON.stringify(body) });
    prdOpenForm('appellations', { id: appellationId }, 'prd-config');
  } catch (e) { alert(e.message); }
}
async function prdArchiveRule(id, appellationId) {
  if (!confirm(T('msg.sicuro'))) return;
  try { await api(`${PRD_API}/appellation-rules/${id}/archive`, { method: 'POST' }); prdOpenForm('appellations', { id: appellationId }, 'prd-config'); } catch (e) { alert(e.message); }
}
async function prdValidateSian(id) {
  try { await api(`${PRD_API}/sian-map/${id}/validate`, { method: 'POST' }); document.getElementById('prd-form')?.remove(); loadPrd('prd-config'); } catch (e) { alert(e.message); }
}

// ── Soglie da validare ──────────────────────────────────────────────────────
async function prdRenderThresholds(body) {
  const rows = await api(`${PRD_API}/config`);
  const canEdit = prdCan('compliance');
  const shown = v => (v == null ? '<span class="mod-note" style="margin:0">da definire</span>' : esc(v));
  body.innerHTML = prdHead({ title: 'soglie' }) + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>${esc(T('f.name'))}</th><th>${esc(T('f.value'))}</th><th>${esc(T('f.unit'))}</th><th>${esc(T('f.rule_ids'))}</th><th>${esc(T('f.source_note'))}</th><th>${esc(T('f.validated'))}</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.name)}</b>${r.question_id ? `<br><span class="mod-note" style="margin:0">${esc(r.question_id)} del questionario</span>` : ''}</td><td>${shown(r.value)}</td><td>${esc(r.unit || '')}</td>
      <td>${esc(r.rule_ids || '')}</td><td>${esc(r.source_note || '')}</td>
      <td>${r.to_validate ? prdBadge(T('msg.daValidare'), 'yellow') : prdBadge(T('msg.validataDa', { who: r.validated_by, when: UI.date((r.validated_at || '').slice(0, 10)) }), 'green')}</td>
      <td style="white-space:nowrap">${canEdit ? `<button class="btn-outline-pill" onclick="prdEditThreshold('${r.key}')">${esc(T('btn.modifica'))}</button> ${r.to_validate ? `<button class="btn-outline-pill" onclick="prdValidateThreshold('${r.key}')">${esc(T('btn.convalida'))}</button>` : ''}` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
  PRD.cache.thresholds = rows;
}
async function prdEditThreshold(key) {
  const r = (PRD.cache.thresholds || []).find(x => x.key === key);
  const value = prompt(T('msg.nuovoValore', { name: r.name, unit: r.unit || r.kind }), r.value ?? '');
  if (value === null) return;
  try { await api(`${PRD_API}/config/${key}`, { method: 'PATCH', body: JSON.stringify({ value }) }); loadPrd('prd-config'); } catch (e) { alert(e.message); }
}
async function prdValidateThreshold(key) {
  try { await api(`${PRD_API}/config/${key}/validate`, { method: 'POST' }); loadPrd('prd-config'); } catch (e) { alert(e.message); }
}
