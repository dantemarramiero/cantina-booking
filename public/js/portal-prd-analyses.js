// Portale → Produzione → Vigneto → Analisi e maturazione: analisi delle parcelle (inserimento e import dal
// laboratorio con prova e anteprima degli errori), curve di maturazione per annata, previsione di vendemmia.
const PRD_AN = { parcel_id: '', parameter: '', year: null };
// Annate a confronto: colori categoriali in ordine fisso (validati sullo sfondo bianco); l'annata più
// recente prende sempre il primo. Le etichette sulle linee e la tabella danno il contrasto che manca.
const PRD_SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

Object.assign(PRD_PAGES, { 'prd-analisi': ['analyses', 'curves', 'forecast'] });
Object.assign(PRD_SPECS, {
  analyses: { title: 'analisi', render: body => prdRenderAnalyses(body) },
  curves: { title: 'curve', render: body => prdRenderCurves(body) },
  forecast: { title: 'previsione', render: body => prdRenderForecast(body) },
  analysisParams: { path: '/analysis-parameters' },
});
const prdResultText = r => `${r.qualifier !== '=' ? r.qualifier : ''}${(r.value_e4 / 10000).toLocaleString('it-IT', { maximumFractionDigits: r.decimals })}`;

async function prdRenderAnalyses(body) {
  await Promise.all([prdOptions('parcels')]);
  const rows = await api(`${PRD_API}/analyses?subject_type=parcel${PRD_AN.parcel_id ? `&subject_id=${PRD_AN.parcel_id}` : ''}`);
  const can = prdCan('analyses');
  const toolbar = `<div class="mod-toolbar-fields"><select onchange="PRD_AN.parcel_id=this.value; loadPrd('prd-analisi')">${UI.options(PRD.cache.parcels.map(p => ({ id: p.id, name: p.code })), PRD_AN.parcel_id, { empty: 'Tutte le parcelle' })}</select></div>
    <button class="btn secondary small" onclick="UI.download('${PRD_API}/analyses/template')">${esc(T('btn.modello'))}</button>
    ${can ? `<button class="btn secondary small" onclick="prdOpenImport()">${esc(T('btn.importa'))}</button><button class="btn small" onclick="prdOpenAnalysis()">${UI.icon.plus} ${esc(T('btn.nuovo'))}</button>` : ''}`;
  body.innerHTML = prdHead(PRD_SPECS.analyses, toolbar) + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>${esc(T('f.sample_date'))}</th><th>${esc(T('f.parcels'))}</th>
      <th>${esc(T('f.source'))}</th><th>${esc(T('f.results'))}</th><th></th></tr></thead><tbody>
    ${rows.map(a => `<tr><td>${esc(UI.date(a.sample_date))}</td><td><b>${esc(a.subject_label)}</b></td><td>${esc(prdLabel('analysis_source', a.source))}${a.report_number ? ` · ${esc(a.report_number)}` : ''}</td>
      <td>${a.results.map(r => `${esc(r.name)} <b>${esc(prdResultText(r))}</b> ${esc(r.unit)}`).join(' · ')}</td>
      <td>${can ? `<button class="btn-outline-pill" onclick="prdArchiveAnalysis(${a.id})">${esc(T('btn.archivia'))}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">${esc(T('msg.vuoto'))}</td></tr>`}
  </tbody></table></div>`;
}
async function prdOpenAnalysis() {
  await Promise.all([prdOptions('parcels'), prdOptions('analysisParams'), prdOptions('suppliers')]);
  const params = PRD.cache.analysisParams.filter(p => (p.applies_to || []).includes('parcel'));
  const sources = Object.entries(PRD.catalog.labels.analysis_source).map(([id, name]) => ({ id, name }));
  UI.modal({
    id: 'prd-an', title: T('title.nuovaAnalisi'), width: 760,
    body: `<div class="field-row"><div class="field"><label>${esc(T('f.parcels'))}</label><select name="subject_id">${UI.options(PRD.cache.parcels.map(p => ({ id: p.id, name: `${p.code}${p.name ? ` · ${p.name}` : ''}` })), PRD_AN.parcel_id)}</select></div>
        <div class="field"><label>${esc(T('f.sample_date'))}</label><input type="date" name="sampled_at" value="${UI.attr(PRD.catalog.today)}"></div></div>
      <div class="field-row"><div class="field"><label>${esc(T('f.source'))}</label><select name="source">${UI.options(sources, 'internal_lab')}</select></div>
        <div class="field"><label>${esc(T('f.supplier'))}</label><select name="supplier_id">${UI.options(PRD.cache.suppliers || [], '', { empty: '—' })}</select></div>
        <div class="field"><label>${esc(T('f.report_number'))}</label><input name="report_number"></div></div>
      <div class="mod-section-title">${esc(T('f.results'))}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px 12px">${params.map(p => `<div class="field"><label>${esc(p.name)} (${esc(p.unit)})</label><input data-param="${esc(p.code)}" inputmode="decimal" placeholder="—"></div>`).join('')}</div>
      <p class="mod-note">${esc(T('msg.qualificatore'))}</p>`,
    saveLabel: T('btn.salva'),
    onSave: async box => {
      const v = n => box.querySelector(`[name="${n}"]`).value;
      await api(`${PRD_API}/analyses`, { method: 'POST', body: JSON.stringify({ subject_type: 'parcel', subject_id: v('subject_id'), sampled_at: v('sampled_at'), source: v('source'), supplier_id: v('supplier_id') || null,
        report_number: v('report_number'), results: [...box.querySelectorAll('[data-param]')].filter(i => i.value.trim()).map(i => ({ parameter: i.dataset.param, value: i.value.trim() })) }) });
      loadPrd('prd-analisi');
    },
  });
}
async function prdArchiveAnalysis(id) {
  UI.confirmDo(T('msg.archiviaDomanda'), () => api(`${PRD_API}/analyses/${id}/archive`, { method: 'POST' }), () => loadPrd('prd-analisi'));
}
// Import: prima la prova (nessun dato scritto), poi l'import vero. Un errore in una riga ferma tutto.
function prdOpenImport() {
  UI.modal({
    id: 'prd-imp', title: T('title.importaAnalisi'), width: 620,
    body: `<p class="mod-note">${esc(T('msg.importAiuto'))}</p><div class="field"><input type="file" name="file" accept=".csv,.xlsx,.xls"></div><div id="prd-imp-result"></div>`,
    saveLabel: T('btn.importa'),
    extraButtons: `<button class="btn secondary" type="button" onclick="prdRunImport(this.closest('.modal-overlay'), true)">${esc(T('btn.prova'))}</button>`,
    onSave: box => prdRunImport(box, false),
  });
}
async function prdRunImport(box, dry) {
  const file = box.querySelector('[name="file"]').files[0];
  const out = box.querySelector('#prd-imp-result');
  if (!file) { UI.msg(box.querySelector('.ui-modal-msg'), T('msg.sceltaFile')); if (!dry) throw new Error(T('msg.sceltaFile')); return; }
  const fd = new FormData();
  fd.append('file', file);
  if (dry) fd.append('dry_run', '1');
  const res = await fetch(`${PRD_API}/analyses/import`, { method: 'POST', headers: { 'x-admin-key': ADMIN_KEY }, body: fd });
  const data = await res.json();
  const list = rows => rows.map(r => `<li>${esc(T('msg.riga'))} ${r.row}: ${esc(r.error || `${r.parcel} · ${UI.date(r.date)} · ${r.values || `${r.results} ${T('f.results').toLowerCase()}`}`)}</li>`).join('');
  if (!res.ok) {
    out.innerHTML = `<div class="msg error">${esc(data.error)}</div><ul class="mod-note">${list(data.errors || [])}</ul>`;
    if (!dry) throw new Error(data.error);
    return;
  }
  out.innerHTML = `<div class="msg success">${esc(dry ? T('msg.provaOk', { n: data.preview.length }) : T('msg.importOk', { n: data.imported }))}</div><ul class="mod-note">${list(data.preview)}</ul>`;
  if (!dry) loadPrd('prd-analisi');
}

// ── Curve di maturazione ────────────────────────────────────────────────────
async function prdRenderCurves(body) {
  await Promise.all([prdOptions('parcels'), prdOptions('analysisParams')]);
  const params = PRD.cache.analysisParams.filter(p => (p.applies_to || []).includes('parcel'));
  if (!PRD_AN.parcel_id && PRD.cache.parcels[0]) PRD_AN.parcel_id = String(PRD.cache.parcels[0].id);
  const toolbar = `<div class="mod-toolbar-fields">
    <select onchange="PRD_AN.parcel_id=this.value; loadPrd('prd-analisi')">${UI.options(PRD.cache.parcels.map(p => ({ id: p.id, name: p.code })), PRD_AN.parcel_id)}</select>
    <select onchange="PRD_AN.parameter=this.value; loadPrd('prd-analisi')">${UI.options(params.map(p => ({ id: p.code, name: p.name })), PRD_AN.parameter || (PRD.catalog.units.sugar === 'brix' ? 'zuccheri_brix' : 'zuccheri_babo'))}</select></div>`;
  if (!PRD_AN.parcel_id) { body.innerHTML = prdHead(PRD_SPECS.curves) + `<div class="mod-empty">${esc(T('msg.vuoto'))}</div>`; return; }
  const data = await api(`${PRD_API}/maturation?parcel_id=${PRD_AN.parcel_id}${PRD_AN.parameter ? `&parameter=${PRD_AN.parameter}` : ''}`);
  body.innerHTML = prdHead(PRD_SPECS.curves, toolbar) + `<div style="padding:0 22px 22px">${prdCurveChart(data)}</div>`;
}
// Grafico a linee: un asse (il parametro), giorni dell'anno in orizzontale, una linea per annata.
function prdCurveChart(data) {
  const series = data.series.filter(s => s.points.length);
  const unit = data.parameter.unit;
  if (!series.length) return `<div class="mod-empty">${esc(T('msg.nessunCampione'))}</div>`;
  const W = 760, H = 300, m = { l: 48, r: 64, t: 16, b: 34 };
  const all = series.flatMap(s => s.points);
  const x0 = Math.min(...all.map(p => p.doy)) - 3, x1 = Math.max(...all.map(p => p.doy)) + 3;
  // Asse verticale a passi tondi (1, 2, 5 × 10^n), che comprende tutti i valori.
  const lo = Math.min(...all.map(p => p.value)), hi = Math.max(...all.map(p => p.value));
  const raw = (hi - lo || Math.abs(hi) || 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(k => k * mag).find(s => s >= raw);
  const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step === y0 ? y0 + step : Math.ceil(hi / step) * step;
  const X = d => m.l + ((d - x0) / (x1 - x0)) * (W - m.l - m.r), Y = v => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const ticks = [];
  for (let v = y0; v <= y1 + step / 2; v += step) ticks.push(+v.toFixed(6));
  // Tacche orizzontali all'1 e al 15 di ogni mese (anno non bisestile: le annate si confrontano sullo stesso calendario).
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const monthStarts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335].flatMap((d, i) => [[d, `1 ${months[i]}`], [d + 14, `15 ${months[i]}`]]).filter(([d]) => d >= x0 && d <= x1);
  const fmt = v => v.toLocaleString('it-IT', { maximumFractionDigits: data.parameter.decimals });
  const lines = series.map((s, i) => {
    const c = PRD_SERIES[i % PRD_SERIES.length];
    const path = s.points.map((p, k) => `${k ? 'L' : 'M'}${X(p.doy).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
    const last = s.points[s.points.length - 1];
    return `<path d="${path}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${s.points.map(p => `<circle cx="${X(p.doy).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="4" fill="${c}" stroke="#fff" stroke-width="2"/>`).join('')}
      <text x="${(X(last.doy) + 8).toFixed(1)}" y="${(Y(last.value) + 4).toFixed(1)}" font-size="12" fill="var(--ink)">${s.year}</text>`;
  }).join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block;font-family:inherit" role="img" aria-label="${UI.attr(`${data.parameter.name} per annata`)}"
      onmousemove="prdCurveHover(event, this)" onmouseleave="prdCurveHover(null, this)">
    ${ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#ece7df"/><text x="${m.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--ink-soft)">${fmt(v)}</text>`).join('')}
    ${monthStarts.map(([d, n]) => `<line x1="${X(d).toFixed(1)}" x2="${X(d).toFixed(1)}" y1="${H - m.b}" y2="${H - m.b + 4}" stroke="#cfc6b8"/><text x="${X(d).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="var(--ink-soft)">${n}</text>`).join('')}
    <text x="${m.l}" y="${m.t - 4}" font-size="11" fill="var(--ink-soft)">${esc(unit)}</text>
    ${lines}<line data-cross x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-soft)" stroke-dasharray="3 3" style="display:none"/></svg>`;
  PRD.curve = { series, X, x0, x1, W, m, fmt, unit };
  const legend = `<div style="display:flex;gap:16px;flex-wrap:wrap;margin:8px 0;font-size:12.5px">${series.map((s, i) => `<span style="display:inline-flex;gap:6px;align-items:center"><span style="width:14px;height:3px;border-radius:2px;background:${PRD_SERIES[i]}"></span>${s.year}</span>`).join('')}</div>`;
  const table = `<details style="margin-top:8px"><summary class="mod-note" style="cursor:pointer">${esc(T('msg.mostraValori'))}</summary><table class="mod-table" style="min-width:0;margin-top:6px"><thead><tr><th>${esc(T('f.year'))}</th><th>${esc(T('f.sample_date'))}</th><th class="num">${esc(data.parameter.name)} (${esc(unit)})</th></tr></thead><tbody>
    ${series.flatMap(s => s.points.map(p => `<tr><td>${s.year}</td><td>${esc(UI.date(p.date))}</td><td class="num">${esc(fmt(p.value))}</td></tr>`)).join('')}</tbody></table></details>`;
  return `${legend}<div style="position:relative">${svg}<div id="prd-curve-tip" style="position:absolute;display:none;pointer-events:none;background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.08)"></div></div>${table}`;
}
// Passando sul grafico: linea verticale e, per ogni annata, il campione più vicino a quel giorno.
function prdCurveHover(ev, svg) {
  const tip = document.getElementById('prd-curve-tip');
  const cross = svg.querySelector('[data-cross]');
  const c = PRD.curve;
  if (!ev || !c) { tip.style.display = 'none'; cross.style.display = 'none'; return; }
  const rect = svg.getBoundingClientRect();
  const px = ((ev.clientX - rect.left) / rect.width) * c.W;
  const doy = c.x0 + ((px - c.m.l) / (c.W - c.m.l - c.m.r)) * (c.x1 - c.x0);
  const near = c.series.map((s, i) => ({ s, i, p: s.points.reduce((b, p) => (Math.abs(p.doy - doy) < Math.abs(b.doy - doy) ? p : b)) })).filter(x => Math.abs(x.p.doy - doy) <= 6);
  if (!near.length) { tip.style.display = 'none'; cross.style.display = 'none'; return; }
  const xs = c.X(near[0].p.doy);
  cross.setAttribute('x1', xs); cross.setAttribute('x2', xs); cross.style.display = '';
  tip.innerHTML = near.map(x => `<div style="display:flex;gap:6px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;background:${PRD_SERIES[x.i]}"></span>${x.s.year} · ${esc(UI.date(x.p.date))} · <b>${esc(c.fmt(x.p.value))}</b> ${esc(c.unit)}</div>`).join('');
  tip.style.display = 'block';
  tip.style.left = `${Math.min((xs / c.W) * rect.width + 12, rect.width - 220)}px`;
  tip.style.top = '8px';
}

// ── Previsione di vendemmia ─────────────────────────────────────────────────
async function prdRenderForecast(body) {
  const year = PRD_AN.year || Number(PRD.catalog.today.slice(0, 4));
  const data = await api(`${PRD_API}/harvest-forecast?year=${year}`);
  const can = prdCan('analyses');
  const years = [0, 1, 2].map(d => Number(PRD.catalog.today.slice(0, 4)) - d);
  const toolbar = `<div class="mod-toolbar-fields"><select onchange="PRD_AN.year=Number(this.value); loadPrd('prd-analisi')">${years.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>`;
  body.innerHTML = prdHead(PRD_SPECS.forecast, toolbar)
    + (data.targets_set ? '' : `<p class="mod-note" style="margin:0 22px 10px">${esc(T('msg.obiettiviMancano'))}</p>`)
    + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>${esc(T('f.parcels'))}</th><th>${esc(T('f.destination'))}</th><th class="num">${esc(T('f.samples'))}</th>
      <th>${esc(T('f.computed'))}</th><th>${esc(T('f.manual_date'))}</th><th>${esc(T('f.notes'))}</th><th></th></tr></thead><tbody>
    ${data.rows.map(r => `<tr data-fc="${r.parcel_id}|${r.destination}"><td><b>${esc(r.code)}</b></td><td>${esc(prdLabel('harvest_destination', r.destination))}</td><td class="num">${r.samples}</td>
      <td>${r.computed_from ? `${esc(T('msg.dal'))} ${esc(UI.date(r.computed_from))}${r.computed_by ? ` · ${esc(T('msg.entro'))} ${esc(UI.date(r.computed_by))}` : ''}` : `<span class="mod-note" style="margin:0" title="${UI.attr(r.basis.join(' · '))}">${esc(r.basis[r.basis.length - 1] || '—')}</span>`}</td>
      <td>${can ? `<input type="date" data-fc-date value="${UI.attr(r.manual_date || '')}">` : esc(UI.date(r.manual_date))}</td><td>${can ? `<input data-fc-note value="${UI.attr(r.note || '')}">` : esc(r.note || '')}</td>
      <td>${can ? `<button class="btn-outline-pill" onclick="prdSaveForecast(this, ${year})">${esc(T('btn.salva'))}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">${esc(T('msg.vuoto'))}</td></tr>`}
  </tbody></table></div>`;
}
async function prdSaveForecast(btn, year) {
  const tr = btn.closest('tr');
  const [parcel_id, destination] = tr.dataset.fc.split('|');
  try {
    await api(`${PRD_API}/harvest-forecast`, { method: 'PUT', body: JSON.stringify({ parcel_id, harvest_year: year, destination, manual_date: tr.querySelector('[data-fc-date]').value || null, note: tr.querySelector('[data-fc-note]').value }) });
    loadPrd('prd-analisi');
  } catch (e) { alert(e.message); }
}
