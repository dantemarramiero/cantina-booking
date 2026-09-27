// Portale → Produzione → Vigneto → Interventi e trattamenti: elenco, modulo (bozza o conferma, con i controlli di
// legge del server), scheda con storno e «ripeti», stato delle parcelle oggi (carenze e rientri), registro dei
// trattamenti con CSV e stampa. Usa il nucleo di portal-prd.js.
const PRD_INT = { filter: { type: '', status: '', parcel_id: '' }, year: null };
const prdIntStatusColor = { draft: 'yellow', confirmed: 'green', reversed: 'grey' };
const prdLocalNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const prdFmtLocal = s => (s ? `${UI.date(s.slice(0, 10))} ${s.slice(11, 16)}` : '—');
const prdFmtIso = iso => (iso ? new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

Object.assign(PRD_PAGES, { 'prd-interventi': ['interventions', 'parcelStates', 'register'] });
Object.assign(PRD_SPECS, {
  interventions: { title: 'interventi', render: (body, sub) => prdRenderInterventions(body, sub) },
  parcelStates: { title: 'statoParcelle', render: body => prdRenderParcelStates(body) },
  register: { title: 'registro', render: body => prdRenderRegister(body) },
  employees: { url: '/api/admin/hr/directory', optionLabel: e => `${e.first_name} ${e.last_name}` },
});

async function prdRenderInterventions(body, sub) {
  await Promise.all([prdOptions('parcels')]);
  const f = PRD_INT.filter;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const rows = await api(`${PRD_API}/interventions?${qs}`);
  const types = Object.entries(PRD.catalog.labels.intervention_type).map(([id, name]) => ({ id, name }));
  const statuses = Object.entries(PRD.catalog.labels.intervention_status).map(([id, name]) => ({ id, name }));
  const toolbar = `<div class="mod-toolbar-fields">
      <select onchange="PRD_INT.filter.parcel_id=this.value; loadPrd('${sub}')">${UI.options(PRD.cache.parcels.map(p => ({ id: p.id, name: p.code })), f.parcel_id, { empty: 'Tutte le parcelle' })}</select>
      <select onchange="PRD_INT.filter.type=this.value; loadPrd('${sub}')">${UI.options(types, f.type, { empty: 'Tutti i tipi' })}</select>
      <select onchange="PRD_INT.filter.status=this.value; loadPrd('${sub}')">${UI.options(statuses, f.status, { empty: 'Tutti gli stati' })}</select></div>
    <a class="btn secondary small" href="/campo.html" target="_blank" rel="noopener" title="${UI.attr(T('msg.campoAiuto'))}">${esc(T('btn.campo'))}</a>
    ${prdCan('vineyard') ? `<button class="btn small" onclick="prdOpenIntervention()">${UI.icon.plus} ${esc(T('btn.nuovo'))}</button>` : ''}`;
  body.innerHTML = prdHead(PRD_SPECS.interventions, toolbar) + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr>
      <th>${esc(T('f.started_at'))}</th><th>${esc(T('f.type'))}</th><th>${esc(T('f.parcels'))}</th><th>${esc(T('f.products'))}</th><th>${esc(T('f.status'))}</th></tr></thead><tbody>
    ${rows.map(i => `<tr class="mod-clickable" onclick="prdShowIntervention(${i.id})"><td>${esc(prdFmtLocal(i.started_local))}</td><td><b>${esc(prdLabel('intervention_type', i.type))}</b>${i.bbch_stage ? ` <span class="mod-note" style="margin:0">BBCH ${esc(i.bbch_stage)}</span>` : ''}</td>
      <td>${esc(i.parcel_codes.join(', ') || '—')}</td><td>${esc(i.product_names.join(', '))}</td>
      <td>${prdBadge(prdLabel('intervention_status', i.status), prdIntStatusColor[i.status])}${i.registered_late ? ` ${prdBadge(T('msg.tardiva'), 'yellow')}` : ''}${i.equipment_noncompliant ? ` ${prdBadge(T('msg.nonConforme'), 'red')}` : ''}</td></tr>`).join('')
      || `<tr><td colspan="5" class="empty">${esc(T('msg.vuoto'))}</td></tr>`}
  </tbody></table></div>`;
}

// ── Modulo dell'intervento ──────────────────────────────────────────────────
async function prdOpenIntervention(existing = null) {
  await prdCatalog();
  await Promise.all(['parcels', 'employees', 'equipment', 'phyto'].map(prdOptions));
  const i = existing;
  const parcels = PRD.cache.parcels.filter(p => p.active || i?.parcels?.some(x => x.parcel_id === p.id));
  const chosen = new Map((i?.parcels || []).map(p => [p.parcel_id, p.area_m2]));
  const workers = new Map((i?.workers || []).map(w => [w.employee_id, w.minutes]));
  const equip = new Set((i?.equipment || []).map(q => q.id));
  const types = Object.entries(PRD.catalog.labels.intervention_type).map(([id, name]) => ({ id, name }));
  const check = (attr, id, on, label, extra = '') => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:3px 0"><input type="checkbox" style="width:auto" ${attr}="${id}" ${on ? 'checked' : ''}>${label}${extra}</label>`;
  const body = `<div class="field-row">
      <div class="field"><label>${esc(T('f.type'))}</label><select name="type" onchange="prdIntTypeChanged(this.closest('.modal-box'))">${UI.options(types, i?.type || 'trattamento')}</select></div>
      <div class="field"><label>${esc(T('f.started_at'))}</label><input type="datetime-local" name="started_at" value="${UI.attr(i?.started_local || prdLocalNow())}"></div>
      <div class="field"><label>${esc(T('f.ended_at'))}</label><input type="datetime-local" name="ended_at" value="${UI.attr(i?.ended_local || '')}"></div></div>
    <div class="field-row"><div class="field"><label>${esc(T('f.bbch_stage'))}</label><input name="bbch_stage" value="${UI.attr(i?.bbch_stage || '')}" placeholder="es. 57"></div>
      <div class="field"><label>${esc(T('f.harvest_year'))}</label><input name="harvest_year" inputmode="numeric" value="${UI.attr(i?.harvest_year || '')}" placeholder="dalla data"></div></div>
    <div class="mod-section-title">${esc(T('f.parcels'))} (${esc(prdUnit('area').s)})</div>
    <div class="mod-checklist" style="max-height:180px">${parcels.map(p => check('data-parcel', p.id, chosen.has(p.id), `<b>${esc(p.code)}</b> ${esc(p.name || '')} <span class="mod-note" style="margin:0">${esc(p.vineyard_name || '')}</span>`,
      ` <input data-parcel-area="${p.id}" inputmode="decimal" style="width:90px;margin-left:auto" value="${UI.attr(prdToInput('area', chosen.get(p.id) ?? p.vine_area_m2))}">`)).join('') || esc(T('msg.vuoto'))}</div>
    <div class="field-row" style="margin-top:10px">
      <div><div class="mod-section-title">${esc(T('f.workers'))}</div><div class="mod-checklist" style="max-height:150px">${PRD.cache.employees.map(e => check('data-worker', e.id, workers.has(e.id), esc(`${e.first_name} ${e.last_name}`))).join('') || esc(T('msg.vuoto'))}</div></div>
      <div><div class="mod-section-title">${esc(T('f.equipment'))}</div><div class="mod-checklist" style="max-height:150px">${PRD.cache.equipment.map(q => check('data-equip', q.id, equip.has(q.id), esc(q.name), q.inspection_expired ? ` ${prdBadge(T('msg.scaduto'), 'red')}` : '')).join('') || esc(T('msg.vuoto'))}</div></div></div>
    <div id="prd-int-treatment" style="margin-top:10px">
      <div class="mod-section-title">${esc(prdLabel('intervention_type', 'trattamento'))}</div>
      <div class="field-row"><div class="field"><label>${esc(T('f.target_pest'))}</label><input name="target_pest" value="${UI.attr(i?.treatment?.target_pest || '')}" placeholder="es. peronospora"></div>
        <div class="field"><label>${esc(T('f.water_volume'))}</label><input name="water_volume_l_per_ha" inputmode="numeric" value="${UI.attr(i?.treatment?.water_volume_l_per_ha ?? '')}"></div>
        <div class="field"><label>${esc(T('f.weather_notes'))}</label><input name="weather_notes" value="${UI.attr(i?.treatment?.weather_notes || '')}"></div></div>
      <div id="prd-int-products">${(i?.treatment?.products || []).map(prdIntProductRow).join('')}</div>
      <button class="btn secondary small" type="button" onclick="document.getElementById('prd-int-products').insertAdjacentHTML('beforeend', prdIntProductRow())">${esc(T('btn.aggiungiProdotto'))}</button>
      <span class="mod-note" style="margin-left:8px">${esc(T('msg.totaleAiuto'))}</span></div>
    <div id="prd-int-fert" style="margin-top:10px"><div class="mod-section-title">${esc(prdLabel('intervention_type', 'concimazione'))}</div>
      <div class="field-row"><div class="field"><label>${esc(T('f.product'))}</label><input name="fert_product" value="${UI.attr(i?.fertilization?.product || '')}"></div>
        <div class="field"><label>NPK</label><input name="fert_npk" value="${UI.attr(i?.fertilization?.npk || '')}" placeholder="es. 8-24-24"></div></div>
      <div class="field-row"><div class="field"><label>${esc(T('f.dose_ha'))}</label><input name="fert_dose" inputmode="decimal" value="${UI.attr(prdE4Input(i?.fertilization?.dose_per_ha_e4))}"></div>
        <div class="field"><label>${esc(T('f.total_quantity'))}</label><input name="fert_total" inputmode="decimal" value="${UI.attr(prdE4Input(i?.fertilization?.total_quantity_e4))}"></div>
        <div class="field"><label>${esc(T('f.unit'))}</label><input name="fert_unit" value="${UI.attr(i?.fertilization?.unit || 'kg/ha')}"></div></div></div>
    <div class="field" style="margin-top:10px"><label>${esc(T('f.notes'))}</label><textarea name="notes" rows="2">${esc(i?.notes || '')}</textarea></div>`;
  const box = UI.modal({
    id: 'prd-int', title: i ? `${prdLabel('intervention_type', i.type)} · ${T('msg.bozza')}` : T('title.nuovoIntervento'), width: 860, body,
    saveLabel: T('btn.salvaBozza'), onSave: b => prdSaveIntervention(b, i, false),
    extraButtons: `<button class="btn" type="button" onclick="prdSaveIntervention(this.closest('.modal-overlay'), ${i ? `{ id: ${i.id} }` : 'null'}, true)">${esc(T('btn.conferma'))}</button>`,
  });
  prdIntTypeChanged(box);
}
function prdIntProductRow(p = {}) {
  const opts = (PRD.cache.phyto || []).map(x => `<option value="${x.id}" data-unit="${UI.attr(x.dose_unit || '')}" data-max="${x.max_dose_per_ha_e4 ?? ''}" ${x.id === p.phyto_product_id ? 'selected' : ''}>${esc(x.commercial_name)} · ${esc(x.registration_number)}</option>`).join('');
  return `<div class="field-row prd-int-product" style="align-items:end">
    <div class="field"><label>${esc(T('f.product'))}</label><select data-prod="phyto_product_id"><option value="">—</option>${opts}</select></div>
    <div class="field"><label>${esc(T('f.dose_ha'))}</label><input data-prod="dose_per_ha" inputmode="decimal" value="${UI.attr(prdE4Input(p.dose_per_ha_e4))}" oninput="prdIntSuggestTotal(this)"></div>
    <div class="field"><label>${esc(T('f.total_quantity'))}</label><div style="display:flex;gap:6px"><input data-prod="total_quantity" inputmode="decimal" value="${UI.attr(prdE4Input(p.total_quantity_e4))}">
      <button class="btn-outline-pill" type="button" onclick="this.closest('.prd-int-product').remove()">${esc(T('btn.togli'))}</button></div></div></div>`;
}
// Quantità totale suggerita = dose per ettaro × ettari lavorati (modificabile).
function prdIntSuggestTotal(input) {
  const box = input.closest('.modal-box');
  const ha = [...box.querySelectorAll('[data-parcel]:checked')].reduce((s, c) => s + (prdFromInput('area', box.querySelector(`[data-parcel-area="${c.dataset.parcel}"]`).value) || 0), 0) / 10000;
  const dose = Number(UI.num(input.value).replace(',', '.'));
  const total = input.closest('.prd-int-product').querySelector('[data-prod="total_quantity"]');
  if (Number.isFinite(dose) && ha) total.value = String(+(dose * ha).toFixed(3)).replace('.', ',');
}
function prdIntTypeChanged(box) {
  const type = box.querySelector('[name="type"]').value;
  box.querySelector('#prd-int-treatment').style.display = type === 'trattamento' ? '' : 'none';
  box.querySelector('#prd-int-fert').style.display = type === 'concimazione' ? '' : 'none';
}
function prdIntCollect(box) {
  const v = n => box.querySelector(`[name="${n}"]`)?.value.trim() ?? '';
  const type = v('type');
  const body = {
    type, started_at: v('started_at'), ended_at: v('ended_at') || null, bbch_stage: v('bbch_stage'), notes: v('notes'), harvest_year: v('harvest_year') || null,
    parcels: [...box.querySelectorAll('[data-parcel]:checked')].map(c => ({ parcel_id: Number(c.dataset.parcel), area_m2: prdFromInput('area', box.querySelector(`[data-parcel-area="${c.dataset.parcel}"]`).value) })),
    workers: [...box.querySelectorAll('[data-worker]:checked')].map(c => ({ employee_id: Number(c.dataset.worker) })),
    equipment_ids: [...box.querySelectorAll('[data-equip]:checked')].map(c => Number(c.dataset.equip)),
  };
  if (type === 'trattamento') {
    body.treatment = { target_pest: v('target_pest'), water_volume_l_per_ha: v('water_volume_l_per_ha') || null, weather_notes: v('weather_notes'),
      products: [...box.querySelectorAll('.prd-int-product')].filter(r => r.querySelector('[data-prod="phyto_product_id"]').value).map(r => ({
        phyto_product_id: Number(r.querySelector('[data-prod="phyto_product_id"]').value),
        dose_per_ha: UI.num(r.querySelector('[data-prod="dose_per_ha"]').value), total_quantity: UI.num(r.querySelector('[data-prod="total_quantity"]').value) })) };
  }
  if (type === 'concimazione') body.fertilization = { product: v('fert_product'), npk: v('fert_npk'), dose_per_ha: UI.num(v('fert_dose')), total_quantity: UI.num(v('fert_total')), unit: v('fert_unit') };
  return body;
}
// Salva la bozza (o la conferma). Nel tempo di rientro il server chiede il motivo (DPI): lo si chiede e si riprova.
async function prdSaveIntervention(box, existing, confirmIt) {
  const body = { ...prdIntCollect(box), confirm: confirmIt };
  const send = () => (existing ? api(`${PRD_API}/interventions/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) }) : api(`${PRD_API}/interventions`, { method: 'POST', body: JSON.stringify(body) }));
  try {
    await send();
  } catch (e) {
    if (/tempo di rientro/.test(e.message)) {
      const reason = prompt(`${e.message}\n\n${T('msg.motivoDpi')}`, '');
      if (!reason) { UI.msg(box.querySelector('.ui-modal-msg'), e.message); if (!confirmIt) throw e; return; }
      body.reentry_override_reason = reason;
      try { await send(); } catch (e2) { UI.msg(box.querySelector('.ui-modal-msg'), e2.message); if (!confirmIt) throw e2; return; }
    } else {
      UI.msg(box.querySelector('.ui-modal-msg'), e.message);
      if (!confirmIt) throw e;
      return;
    }
  }
  box.remove();
  loadPrd('prd-interventi');
}

// ── Scheda ──────────────────────────────────────────────────────────────────
async function prdShowIntervention(id) {
  await prdCatalog();
  const i = await api(`${PRD_API}/interventions/${id}`);
  const can = prdCan('vineyard');
  const kv = (k, v) => (v == null || v === '' ? '' : `<dt>${esc(T(`f.${k}`))}</dt><dd>${v}</dd>`);
  const tr = i.treatment;
  const body = `<dl class="mod-kv">
      ${kv('status', prdBadge(prdLabel('intervention_status', i.status), prdIntStatusColor[i.status]))}${kv('started_at', esc(prdFmtLocal(i.started_local)))}${kv('ended_at', i.ended_local ? esc(prdFmtLocal(i.ended_local)) : '')}
      ${kv('harvest_year', esc(i.harvest_year))}${kv('bbch_stage', esc(i.bbch_stage || ''))}
      ${kv('parcels', i.parcels.map(p => `${esc(p.code)} · ${esc(prdFmt('area', p.area_m2))}`).join('<br>'))}${kv('workers', esc(i.workers.map(w => w.name).join(', ')))}
      ${kv('equipment', esc(i.equipment.map(q => q.name).join(', ')))}
      ${tr ? `${kv('target_pest', esc(tr.target_pest || ''))}${kv('products', tr.products.map(p => `${esc(p.commercial_name)} (${esc(p.registration_number)}) · ${esc(prdE4(p.dose_per_ha_e4))} ${esc(p.dose_unit || '')} · ${esc(T('f.total_quantity'))} ${esc(prdE4(p.total_quantity_e4))}`).join('<br>'))}
        ${kv('preharvest_ends_on', tr.preharvest_ends_on ? esc(UI.date(tr.preharvest_ends_on)) : '')}${kv('reentry_ends_at', tr.reentry_ends_at ? esc(prdFmtIso(tr.reentry_ends_at)) : '')}` : ''}
      ${i.fertilization ? kv('product', esc(`${i.fertilization.product || ''} ${i.fertilization.npk || ''} · ${prdE4(i.fertilization.dose_per_ha_e4)} ${i.fertilization.unit || ''}`)) : ''}
      ${kv('reentry_override_reason', esc(i.reentry_override_reason || ''))}${i.registered_late ? kv('status', prdBadge(`${T('msg.tardiva')} (${i.late_days} giorni)`, 'yellow')) : ''}
      ${i.equipment_noncompliant ? kv('equipment', prdBadge(T('msg.nonConforme'), 'red')) : ''}
      ${i.status === 'reversed' ? kv('status', esc(`${T('msg.stornato')} ${prdFmtIso(i.reversed_at)} · ${i.reversal_reason}`)) : ''}${kv('notes', esc(i.notes || ''))}</dl>`;
  const btn = (label, fn) => `<button class="btn secondary" type="button" onclick="${fn}">${esc(label)}</button>`;
  const buttons = can ? [
    i.status === 'draft' ? btn(T('btn.modifica'), `document.getElementById('prd-int-show').remove(); prdEditIntervention(${i.id})`) : '',
    i.status === 'draft' ? btn(T('btn.eliminaBozza'), `prdDeleteIntervention(${i.id})`) : '',
    i.status === 'confirmed' ? btn(T('btn.storna'), `prdReverseIntervention(${i.id})`) : '',
    btn(T('btn.ripeti'), `prdRepeatIntervention(${i.id})`),
  ].join('') : '';
  UI.modal({ id: 'prd-int-show', title: `${prdLabel('intervention_type', i.type)} · ${prdFmtLocal(i.started_local)}`, width: 680, body, extraButtons: buttons });
}
async function prdEditIntervention(id) { prdOpenIntervention(await api(`${PRD_API}/interventions/${id}`)); }
async function prdDeleteIntervention(id) {
  UI.confirmDo(T('msg.sicuro'), () => api(`${PRD_API}/interventions/${id}`, { method: 'DELETE' }), () => { document.getElementById('prd-int-show')?.remove(); loadPrd('prd-interventi'); });
}
async function prdReverseIntervention(id) {
  const reason = prompt(T('msg.motivoStorno'), '');
  if (!reason) return;
  try { await api(`${PRD_API}/interventions/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }); document.getElementById('prd-int-show')?.remove(); loadPrd('prd-interventi'); } catch (e) { alert(e.message); }
}
async function prdRepeatIntervention(id) {
  try {
    const r = await api(`${PRD_API}/interventions/${id}/repeat`, { method: 'POST', body: JSON.stringify({ started_at: prdLocalNow() }) });
    document.getElementById('prd-int-show')?.remove();
    await loadPrd('prd-interventi');
    prdOpenIntervention(r.intervention);
  } catch (e) { alert(e.message); }
}

// ── Stato delle parcelle oggi ───────────────────────────────────────────────
async function prdRenderParcelStates(body) {
  const rows = await api(`${PRD_API}/parcel-states`);
  body.innerHTML = prdHead(PRD_SPECS.parcelStates) + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>${esc(T('f.code'))}</th><th>${esc(T('f.vineyard_id'))}</th>
      <th>${esc(T('f.preharvest_ends_on'))}</th><th>${esc(T('f.reentry_ends_at'))}</th><th>${esc(T('f.last_treatment'))}</th><th>${esc(T('f.planned'))}</th></tr></thead><tbody>
    ${rows.map(p => `<tr class="mod-clickable" onclick="PRD_INT.filter.parcel_id='${p.id}'; PRD.view['prd-interventi']='interventions'; loadPrd('prd-interventi')">
      <td><b>${esc(p.code)}</b>${p.name ? ` · ${esc(p.name)}` : ''}</td><td>${esc(p.vineyard_name)}</td>
      <td>${p.preharvest_ends_on ? (p.preharvest_active ? prdBadge(`${T('msg.carenzaFino')} ${UI.date(p.preharvest_ends_on)}`, 'red') : esc(UI.date(p.preharvest_ends_on))) : '—'}</td>
      <td>${p.reentry_ends_at ? (p.reentry_active ? prdBadge(`${T('msg.rientroFino')} ${prdFmtIso(p.reentry_ends_at)}`, 'red') : esc(prdFmtIso(p.reentry_ends_at))) : '—'}</td>
      <td>${p.last_treatment ? esc(UI.date(p.last_treatment.work_date)) : '—'}</td>
      <td>${esc(p.planned.map(x => `${UI.date(x.work_date)} ${prdLabel('intervention_type', x.type)}`).join(', ') || '—')}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${esc(T('msg.vuoto'))}</td></tr>`}
  </tbody></table></div>`;
}

// ── Registro dei trattamenti ────────────────────────────────────────────────
const PRD_REG_COLS = ['data', 'inizio', 'fine', 'parcella', 'superficie_ha', 'fase_bbch', 'avversita', 'prodotto', 'n_registrazione', 'dose_ha', 'unita_dose', 'quantita_totale', 'fine_carenza', 'fine_rientro', 'esecutori', 'attrezzature'];
// A schermo e in stampa all'italiana; il CSV resta nel formato dei dati (punto decimale, date ISO).
function prdRegCell(r, c) {
  const v = r[c];
  if (v === '' || v == null) return '';
  if (c === 'data' || c === 'fine_carenza') return UI.date(v);
  if (c === 'fine_rientro') return `${UI.date(v.slice(0, 10))} ${v.slice(11)}`;
  if (['superficie_ha', 'dose_ha', 'quantita_totale'].includes(c)) return Number(v).toLocaleString('it-IT', { maximumFractionDigits: 4 });
  return v;
}
async function prdRenderRegister(body) {
  const year = PRD_INT.year || Number(PRD.catalog.today.slice(0, 4));
  const data = await api(`${PRD_API}/treatment-register?year=${year}`);
  PRD.cache.register = data.rows;
  const years = [0, 1, 2, 3].map(d => Number(PRD.catalog.today.slice(0, 4)) - d);
  const toolbar = `<div class="mod-toolbar-fields"><select onchange="PRD_INT.year=Number(this.value); loadPrd('prd-interventi')">${years.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    <button class="btn secondary small" onclick="UI.download('${PRD_API}/treatment-register?year=${year}&format=csv')">${esc(T('btn.scaricaCsv'))}</button>
    <button class="btn secondary small" onclick="prdPrintRegister(${year})">${esc(T('btn.stampa'))}</button>`;
  body.innerHTML = prdHead(PRD_SPECS.register, toolbar) + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr>${PRD_REG_COLS.map(c => `<th>${esc(T(`reg.${c}`))}</th>`).join('')}</tr></thead><tbody>
    ${data.rows.map(r => `<tr>${PRD_REG_COLS.map(c => `<td>${esc(prdRegCell(r, c))}${c === 'data' && r.registrazione_tardiva ? ` ${prdBadge(T('msg.tardiva'), 'yellow')}` : ''}${c === 'attrezzature' && r.attrezzatura_non_conforme ? ` ${prdBadge(T('msg.nonConforme'), 'red')}` : ''}</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${PRD_REG_COLS.length}" class="empty">${esc(T('msg.vuoto'))}</td></tr>`}</tbody></table></div>`;
}
function prdPrintRegister(year) {
  const rows = PRD.cache.register || [];
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Registro dei trattamenti ${year}</title><style>
    body{font-family:Arial,sans-serif;font-size:9pt;margin:10mm}h1{font-size:14pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 4px;text-align:left;vertical-align:top}
    th{background:#eee}@page{size:A4 landscape;margin:8mm}</style></head><body><h1>Registro dei trattamenti fitosanitari · ${year}</h1>
    <table><thead><tr>${PRD_REG_COLS.map(c => `<th>${esc(T(`reg.${c}`))}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr>${PRD_REG_COLS.map(c => `<td>${esc(prdRegCell(r, c))}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
