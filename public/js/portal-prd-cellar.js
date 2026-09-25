// Portale → Produzione → Cantina: vasi e barrique (con codice QR, scheda, stampa delle etichette,
// dismissione), luoghi di cantina, protocolli di vinificazione con l'editor dei passi.
const PRD_WOOD = ['barrique', 'tonneau', 'botte'];
const PRD_VESSEL_FILTER = { location_id: '', type: '', retired: false, selected: new Set() };
const PRD_BARREL_FIELDS = [
  { key: 'cooper_supplier_id', type: 'ref', source: 'suppliers' }, 'cooper_name', 'oak_origin', 'forest', 'grain', 'toast',
  { key: 'purchase_date', type: 'date' }, { key: 'purchase_cost_cents', type: 'money' }, { key: 'useful_life_uses', type: 'int' }, { key: 'uses_count', type: 'int' },
];
const prdStatusColor = { empty_clean: 'green', empty_dirty: 'yellow', in_use: 'red', maintenance: 'grey', retired: 'grey' };
const prdVesselUrl = token => `${location.origin}/portal.html?workspace=produzione&vessel=${encodeURIComponent(token)}`;
function prdQrSvg(token, cell = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(prdVesselUrl(token));
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 2 });
}

Object.assign(PRD_SPECS, {
  locations: {
    path: '/locations', title: 'luoghi', area: 'cellar',
    columns: [{ key: 'name', render: r => `<b>${esc(r.name)}</b>${prdArchivedBadge(r)}` }, { key: 'kind', render: r => esc(prdLabel('location_kind', r.kind)) },
      { key: 'vessels', label: 'Vasi', num: true }],
    fields: ['name', { key: 'kind', type: 'enum', group: 'location_kind', required: true }, { key: 'establishment_id', type: 'ref', source: 'establishments' }, { key: 'notes', type: 'textarea' }],
  },
  vessels: {
    path: '/vessels', title: 'vasi', area: 'cellar', archive: false, width: 760, render: (body, sub) => prdRenderVessels(body, sub),
    fields: ['code', 'name', { key: 'type', type: 'enum', group: 'vessel_type', required: true }, 'material', { key: 'capacity_ml', type: 'volume' },
      { key: 'location_id', type: 'ref', source: 'locations' }, { key: 'status', type: 'enum', group: 'vessel_status', required: true, only: ['empty_clean', 'empty_dirty', 'maintenance'] },
      { key: 'has_temperature_control', type: 'bool' }, { key: 'confined_space', type: 'bool' }, { key: 'public_description', type: 'textarea' }, { key: 'notes', type: 'textarea' }],
    extraForm: async full => {
      await prdOptions('suppliers');
      return `<div id="prd-barrel" style="${PRD_WOOD.includes(full?.type) ? '' : 'display:none'}"><div class="mod-section-title" style="margin-top:14px">${esc(T('msg.legno'))}</div>${prdFormBody(PRD_BARREL_FIELDS, full?.barrel || {})}</div>`;
    },
    afterOpen: box => {
      const type = box.querySelector('[name="type"]');
      type.addEventListener('change', () => { box.querySelector('#prd-barrel').style.display = PRD_WOOD.includes(type.value) ? '' : 'none'; });
    },
    collectExtra: box => (PRD_WOOD.includes(box.querySelector('[name="type"]').value) ? { barrel: prdCollect(box.querySelector('#prd-barrel'), PRD_BARREL_FIELDS) } : {}),
  },
  suppliers: { url: '/api/admin/suppliers', optionLabel: s => s.name }, // tonnellerie (CRM → Fornitori)
  protocols: {
    path: '/protocols', title: 'protocolli', area: 'protocols',
    columns: [{ key: 'name', render: r => `<b>${esc(r.name)}</b>${prdArchivedBadge(r)}${r.active ? '' : ` ${prdBadge('non in uso')}`}` }, { key: 'style', render: r => esc(prdLabel('protocol_style', r.style)) },
      { key: 'steps_count', label: T('btn.passi'), num: true }],
    fields: ['name', { key: 'style', type: 'enum', group: 'protocol_style', required: true }, { key: 'active', type: 'bool', default: true }, { key: 'description', type: 'textarea' }, { key: 'notes', type: 'textarea' }],
    onRow: r => `prdOpenProtocol(${r.id})`,
  },
});

// ── Vasi ────────────────────────────────────────────────────────────────────
async function prdRenderVessels(body, sub) {
  await Promise.all([prdOptions('locations')]);
  const f = PRD_VESSEL_FILTER;
  const qs = new URLSearchParams({ ...(f.location_id ? { location_id: f.location_id } : {}), ...(f.type ? { type: f.type } : {}), retired: f.retired ? '1' : '0' });
  const rows = await api(`${PRD_API}/vessels?${qs}`);
  PRD.cache.vesselRows = rows;
  const canEdit = prdCan('cellar');
  const typeOpts = Object.entries(PRD.catalog.labels.vessel_type).map(([id, name]) => ({ id, name }));
  const toolbar = `<div class="mod-toolbar-fields">
      <select onchange="PRD_VESSEL_FILTER.location_id=this.value; loadPrd('${sub}')">${UI.options(PRD.cache.locations || [], f.location_id, { empty: 'Tutti i luoghi' })}</select>
      <select onchange="PRD_VESSEL_FILTER.type=this.value; loadPrd('${sub}')">${UI.options(typeOpts, f.type, { empty: 'Tutti i tipi' })}</select>
      <label style="display:inline-flex;gap:5px;align-items:center;font-size:12.5px"><input type="checkbox" ${f.retired ? 'checked' : ''} onchange="PRD_VESSEL_FILTER.retired=this.checked; loadPrd('${sub}')">${esc(prdLabel('vessel_status', 'retired'))}</label></div>
    <button class="btn secondary small" onclick="prdPrintQr([...PRD_VESSEL_FILTER.selected])">${esc(T('btn.stampaSel'))}</button>
    ${canEdit ? `<button class="btn small" onclick="prdOpenForm('vessels', null, '${sub}')">${UI.icon.plus} ${esc(T('btn.nuovo'))}</button>` : ''}`;
  const total = rows.filter(v => v.status !== 'retired').reduce((s, v) => s + v.capacity_ml, 0);
  body.innerHTML = prdHead(PRD_SPECS.vessels, toolbar)
    + `<p class="mod-note" style="margin:0 22px 8px">${rows.length} ${rows.length === 1 ? 'vaso' : 'vasi'} · capacità totale ${esc(prdFmt('volume', total))} · ${esc(T('msg.unitaNota'))}</p>`
    + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th><input type="checkbox" onchange="document.querySelectorAll('[data-vsel]').forEach(c => { c.checked = this.checked; c.onchange(); })"></th>
      <th>${esc(T('f.code'))}</th><th>${esc(T('f.type'))}</th><th class="num">${esc(T('f.capacity_ml'))}</th><th>${esc(T('f.location_id'))}</th><th>${esc(T('f.status'))}</th><th></th></tr></thead><tbody>
      ${rows.map(v => `<tr>
        <td><input type="checkbox" data-vsel value="${v.id}" ${f.selected.has(v.id) ? 'checked' : ''} onchange="this.checked ? PRD_VESSEL_FILTER.selected.add(${v.id}) : PRD_VESSEL_FILTER.selected.delete(${v.id})"></td>
        <td class="mod-clickable" onclick="prdOpenVessel(${v.id})"><b>${esc(v.code)}</b>${v.name ? ` · ${esc(v.name)}` : ''}${v.confined_space ? ` ${prdBadge('spazio confinato', 'yellow')}` : ''}</td>
        <td>${esc(prdLabel('vessel_type', v.type))}${v.barrel?.cooper_display ? `<br><span class="mod-note" style="margin:0">${esc(v.barrel.cooper_display)}${v.barrel.toast ? ` · ${esc(v.barrel.toast)}` : ''}</span>` : ''}</td>
        <td class="num">${esc(prdFmt('volume', v.capacity_ml))}</td><td>${esc(v.location_name || '—')}</td>
        <td>${prdBadge(prdLabel('vessel_status', v.status), prdStatusColor[v.status])}</td>
        <td><button class="btn-outline-pill" onclick="prdOpenVessel(${v.id})">${esc(T('btn.apri'))}</button></td></tr>`).join('') || `<tr><td colspan="7" class="empty">${esc(T('msg.vuoto'))}</td></tr>`}
    </tbody></table></div>`;
}
// Scheda del vaso: dati, barrique, codice QR e azioni. Si apre anche dal QR (?vessel=token).
async function prdOpenVessel(id, { byToken = null } = {}) {
  await prdCatalog();
  const v = byToken ? await api(`${PRD_API}/vessels/by-token/${encodeURIComponent(byToken)}`) : await api(`${PRD_API}/vessels/${id}`);
  const canEdit = prdCan('cellar');
  const b = v.barrel;
  const row = (k, val) => (val == null || val === '' ? '' : `<dt>${esc(T(`f.${k}`))}</dt><dd>${val}</dd>`);
  const body = `<div style="display:grid;grid-template-columns:1fr auto;gap:18px;align-items:start">
      <dl class="mod-kv">${row('type', esc(prdLabel('vessel_type', v.type)))}${row('capacity_ml', esc(prdFmt('volume', v.capacity_ml)))}${row('location_id', esc(v.location_name || ''))}
        ${row('status', prdBadge(prdLabel('vessel_status', v.status), prdStatusColor[v.status]))}${row('material', esc(v.material || ''))}
        ${row('has_temperature_control', v.has_temperature_control ? '✓' : '')}${row('confined_space', v.confined_space ? '✓' : '')}
        ${b ? `${row('cooper_name', esc(b.cooper_display || ''))}${row('oak_origin', esc(b.oak_origin || ''))}${row('toast', esc(b.toast || ''))}${row('purchase_date', b.purchase_date ? UI.date(b.purchase_date) : '')}
          ${row('uses_count', esc(b.uses_count))}${row('useful_life_uses', esc(b.useful_life_uses ?? ''))}` : ''}
        ${v.retired_at ? row('status', `${esc(UI.date(v.retired_at.slice(0, 10)))} · ${esc(v.retire_reason || '')}`) : ''}${row('notes', esc(v.notes || ''))}</dl>
      <div style="text-align:center">${prdQrSvg(v.qr_token, 4)}<div class="mod-note" style="margin:4px 0 0">${esc(v.code)}</div></div></div>
    ${byToken ? `<p class="mod-note">${esc(T('msg.vasoDaQr'))}</p>` : ''}`;
  const buttons = [
    `<button class="btn secondary" type="button" onclick="prdPrintQr([${v.id}])">${esc(T('btn.stampaQr'))}</button>`,
    canEdit && v.status !== 'retired' ? `<button class="btn secondary" type="button" onclick="document.getElementById('prd-vessel').remove(); prdOpenForm('vessels', { id: ${v.id} }, 'prd-vasi')">${esc(T('btn.modifica'))}</button>` : '',
    canEdit ? (v.status === 'retired' ? `<button class="btn secondary" type="button" onclick="prdVesselAction(${v.id}, 'reactivate')">${esc(T('btn.riattivaVaso'))}</button>`
      : `<button class="btn secondary" type="button" onclick="prdVesselAction(${v.id}, 'retire', '${UI.attr(v.code)}')">${esc(T('btn.dismetti'))}</button>`) : '',
  ].join('');
  UI.modal({ id: 'prd-vessel', title: `${v.code}${v.name ? ` · ${v.name}` : ''}`, width: 620, body, extraButtons: buttons });
}
async function prdVesselAction(id, action, code) {
  let reason = null;
  if (action === 'retire') {
    if (!confirm(T('msg.dismettiDomanda', { code }))) return;
    reason = prompt(T('msg.motivo'), '');
    if (reason === null) return;
  }
  try {
    await api(`${PRD_API}/vessels/${id}/${action}`, { method: 'POST', body: JSON.stringify({ reason }) });
    document.getElementById('prd-vessel')?.remove();
    loadPrd('prd-vasi');
  } catch (e) { alert(e.message); }
}
// Etichette da stampare (o salvare come PDF): QR, codice, tipo, capacità, luogo.
async function prdPrintQr(ids) {
  if (!ids.length) { alert(T('msg.selezionaVasi')); return; }
  const rows = await Promise.all(ids.map(id => api(`${PRD_API}/vessels/${id}`)));
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Etichette vasi</title><style>
    body{font-family:Arial,sans-serif;margin:10mm}.grid{display:grid;grid-template-columns:repeat(3,62mm);gap:6mm}
    .lab{border:1px solid #999;border-radius:3mm;padding:3mm;display:flex;gap:3mm;align-items:center;break-inside:avoid;height:34mm}
    .lab svg{width:28mm;height:28mm}.code{font-size:16pt;font-weight:bold}.sub{font-size:8.5pt;color:#333;line-height:1.35}
    @media print{body{margin:6mm}}</style></head><body><div class="grid">${rows.map(v => `<div class="lab">${prdQrSvg(v.qr_token, 3)}
    <div><div class="code">${esc(v.code)}</div><div class="sub">${esc(v.name || '')}<br>${esc(prdLabel('vessel_type', v.type))} · ${esc(prdFmt('volume', v.capacity_ml))}<br>${esc(v.location_name || '')}</div></div></div>`).join('')}
    </div><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ── Protocolli: passi ───────────────────────────────────────────────────────
const prdParamsToText = o => Object.entries(o || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('-') : typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
function prdTextToParams(text) {
  const out = {};
  for (const line of String(text || '').split('\n').map(s => s.trim()).filter(Boolean)) {
    const i = line.indexOf(':');
    if (i < 1) throw new Error(`Parametri obiettivo: «${line}» non è nella forma «nome: valore».`);
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    const n = Number(v.replace(',', '.'));
    out[k] = v !== '' && Number.isFinite(n) ? n : v;
  }
  return out;
}
const PRD_STEPS = { protocol: null, steps: [] };
async function prdOpenProtocol(id) {
  const p = await api(`${PRD_API}/protocols/${id}`);
  PRD_STEPS.protocol = p;
  PRD_STEPS.steps = p.steps.map(s => ({ ...s }));
  const canEdit = prdCan('protocols');
  UI.modal({
    id: 'prd-protocol', title: `${p.name} · ${prdLabel('protocol_style', p.style)}`, width: 900,
    body: `${prdFormBody(PRD_SPECS.protocols.fields, p)}<div class="mod-section-title" style="margin-top:14px">${esc(T('btn.passi'))}</div><div id="prd-steps"></div>
      ${canEdit ? `<button class="btn secondary small" type="button" onclick="prdStepsSync(); PRD_STEPS.steps.push({ operation_type: 'travaso', title: '', optional: false, target_params: {} }); prdRenderSteps()">${esc(T('btn.aggiungiPasso'))}</button>` : ''}`,
    saveLabel: T('btn.salva'),
    onSave: canEdit ? async box => {
      prdStepsSync();
      await api(`${PRD_API}/protocols/${p.id}`, { method: 'PATCH', body: JSON.stringify(prdCollect(box, PRD_SPECS.protocols.fields)) });
      await api(`${PRD_API}/protocols/${p.id}/steps`, { method: 'PUT', body: JSON.stringify({ steps: PRD_STEPS.steps }) });
      loadPrd('prd-protocolli');
    } : null,
    extraButtons: canEdit ? `<button class="btn secondary" type="button" onclick="prdDuplicateProtocol(${p.id}, '${UI.attr(p.name)}')">${esc(T('btn.duplica'))}</button>
      <button class="btn secondary" type="button" onclick="document.getElementById('prd-protocol').remove(); prdArchive('protocols', ${p.id}, ${p.archived_at ? 'true' : 'false'})">${esc(T(p.archived_at ? 'btn.riattiva' : 'btn.archivia'))}</button>` : '',
  });
  prdRenderSteps();
}
function prdRenderSteps() {
  const ops = Object.entries(PRD.catalog.labels.operation_type).map(([id, name]) => ({ id, name }));
  const n = PRD_STEPS.steps.length;
  document.getElementById('prd-steps').innerHTML = `<div class="mod-table-wrap"><table class="mod-table" style="min-width:0"><thead><tr><th>#</th><th>${esc(T('f.phase'))}</th><th>${esc(T('f.operation_type'))}</th><th>${esc(T('f.title'))}</th><th>${esc(T('f.target_params'))}</th><th>${esc(T('f.optional'))}</th><th></th></tr></thead><tbody>
    ${PRD_STEPS.steps.map((s, i) => `<tr data-step="${i}"><td>${i + 1}</td>
      <td><input data-s="phase" value="${UI.attr(s.phase || '')}" style="width:110px"></td>
      <td><select data-s="operation_type">${UI.options(ops, s.operation_type)}</select></td>
      <td><input data-s="title" value="${UI.attr(s.title || '')}" style="min-width:220px"></td>
      <td><textarea data-s="target_params" rows="1" title="${UI.attr(T('msg.parametriAiuto'))}" placeholder="${UI.attr(T('msg.parametriAiuto'))}" style="width:160px">${esc(prdParamsToText(s.target_params))}</textarea></td>
      <td style="text-align:center"><input type="checkbox" data-s="optional" ${s.optional ? 'checked' : ''}></td>
      <td style="white-space:nowrap"><button class="btn-outline-pill" type="button" ${i === 0 ? 'disabled' : ''} onclick="prdMoveStep(${i}, -1)">${T('btn.su')}</button>
        <button class="btn-outline-pill" type="button" ${i === n - 1 ? 'disabled' : ''} onclick="prdMoveStep(${i}, 1)">${T('btn.giu')}</button>
        <button class="btn-outline-pill" type="button" onclick="prdStepsSync(); PRD_STEPS.steps.splice(${i}, 1); prdRenderSteps()">${esc(T('btn.togli'))}</button></td></tr>`).join('')}
  </tbody></table></div>`;
}
// Riporta nei dati quello che è scritto nella tabella (prima di riordinare, aggiungere o salvare).
function prdStepsSync() {
  document.querySelectorAll('#prd-steps [data-step]').forEach(tr => {
    const s = PRD_STEPS.steps[Number(tr.dataset.step)];
    s.phase = tr.querySelector('[data-s="phase"]').value.trim();
    s.operation_type = tr.querySelector('[data-s="operation_type"]').value;
    s.title = tr.querySelector('[data-s="title"]').value.trim();
    s.target_params = prdTextToParams(tr.querySelector('[data-s="target_params"]').value);
    s.optional = tr.querySelector('[data-s="optional"]').checked;
  });
}
function prdMoveStep(i, d) {
  prdStepsSync();
  const s = PRD_STEPS.steps;
  [s[i], s[i + d]] = [s[i + d], s[i]];
  prdRenderSteps();
}
async function prdDuplicateProtocol(id, name) {
  const newName = prompt(T('msg.nuovoNome'), `${name} (copia)`);
  if (!newName) return;
  try {
    const r = await api(`${PRD_API}/protocols/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ name: newName }) });
    document.getElementById('prd-protocol')?.remove();
    await loadPrd('prd-protocolli');
    prdOpenProtocol(r.id);
  } catch (e) { alert(e.message); }
}
