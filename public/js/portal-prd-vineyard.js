// Portale → Produzione → Vigneto: vigneti, parcelle (con particelle catastali e denominazioni),
// particelle catastali, attrezzature e fitofarmaci. Usa il nucleo di portal-prd.js.
Object.assign(PRD_SPECS, {
  vineyards: {
    path: '/vineyards', title: 'vigneti', area: 'vineyard',
    columns: [
      { key: 'name', render: r => `<b>${esc(r.name)}</b>${prdArchivedBadge(r)}` }, { key: 'municipality' },
      { key: 'organic_status', render: r => (r.organic_status !== 'none' ? prdBadge(prdLabel('organic_status', r.organic_status), 'green') : '') },
      { key: 'parcels', label: 'Parcelle', num: true }, { key: 'vine_area_m2', num: true, render: r => esc(prdFmt('area', r.vine_area_m2)) },
    ],
    fields: ['name', 'locality', 'municipality', 'province', { key: 'organic_status', type: 'enum', group: 'organic_status', required: true }, 'certification_body',
      { key: 'public_description', type: 'textarea' }, { key: 'notes', type: 'textarea' }],
  },
  parcels: {
    path: '/parcels', title: 'parcelle', area: 'vineyard', width: 780,
    prepare: () => prdOptions('appellations'),
    optionLabel: p => `${p.code}${p.name ? ` · ${p.name}` : ''}`,
    columns: [
      { key: 'code', render: r => `<b>${esc(r.code)}</b>${r.name ? ` · ${esc(r.name)}` : ''}${prdArchivedBadge(r)}${r.active ? '' : ` ${prdBadge('non attiva')}`}` },
      { key: 'vineyard_id', render: r => esc(r.vineyard_name || '—') }, { key: 'variety_id', render: r => esc(r.variety_name || '—') },
      { key: 'vine_area_m2', num: true, render: r => esc(prdFmt('area', r.vine_area_m2)) },
      { key: 'organic_status', render: r => (r.effective_organic_status !== 'none' ? prdBadge(prdLabel('organic_status', r.effective_organic_status), 'green') : '') },
      { key: 'appellation_ids', render: r => esc(r.appellation_ids.map(id => (PRD.cache.appellations || []).find(a => a.id === id)?.name || id).join(', ') || '—') },
    ],
    fields: [
      { key: 'vineyard_id', type: 'ref', source: 'vineyards' }, 'code', 'name', { key: 'variety_id', type: 'ref', source: 'varieties' }, 'clone', 'rootstock',
      { key: 'planting_year', type: 'int' }, { key: 'vines_count', type: 'int' }, { key: 'row_spacing_cm', type: 'int' }, { key: 'vine_spacing_cm', type: 'int' },
      'training_system', 'exposure', { key: 'altitude_m', type: 'int' }, { key: 'organic_status', type: 'enum', group: 'organic_status' }, { key: 'active', type: 'bool', default: true },
      { key: 'public_description', type: 'textarea' }, { key: 'notes', type: 'textarea' },
    ],
    extraForm: async full => {
      await Promise.all([prdOptions('cadastral'), prdOptions('appellations')]);
      const links = full?.cadastral_links || [];
      const dos = new Set(full?.appellation_ids || []);
      return `<div class="mod-section-title" style="margin-top:14px">${esc(T('f.cadastral_links'))}</div>
        <div id="prd-links">${links.map(prdLinkRow).join('')}</div>
        <button class="btn secondary small" type="button" onclick="document.getElementById('prd-links').insertAdjacentHTML('beforeend', prdLinkRow())">${esc(T('btn.aggiungiParticella'))}</button>
        <div class="mod-section-title" style="margin-top:14px">${esc(T('f.appellation_ids'))}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px">${(PRD.cache.appellations || []).map(a => `<label style="display:inline-flex;gap:5px;align-items:center;text-transform:none;letter-spacing:0;font-weight:400">
          <input type="checkbox" data-do value="${a.id}" ${dos.has(a.id) ? 'checked' : ''}>${esc(a.name)} <span class="mod-note" style="margin:0">${esc(prdLabel('appellation_type', a.type))}</span></label>`).join('')}</div>`;
    },
    collectExtra: box => ({
      cadastral_links: [...box.querySelectorAll('.prd-link')].filter(r => r.querySelector('[data-link="cadastral_parcel_id"]').value).map(r => ({
        cadastral_parcel_id: r.querySelector('[data-link="cadastral_parcel_id"]').value,
        vine_area_m2: prdFromInput('area', r.querySelector('[data-link="vine_area_m2"]').value),
        schedario_unit_code: r.querySelector('[data-link="schedario_unit_code"]').value.trim(),
      })),
      appellation_ids: [...box.querySelectorAll('[data-do]:checked')].map(x => Number(x.value)),
    }),
  },
  cadastral: {
    path: '/cadastral-parcels', title: 'catasto', area: 'vineyard',
    optionLabel: c => `${c.label} · ${prdFmt('area', c.area_m2)}`,
    columns: [
      { key: 'number', label: 'Particella', render: r => `<b>${esc(r.label)}</b>${prdArchivedBadge(r)}` },
      { key: 'area_m2', num: true, render: r => esc(prdFmt('area', r.area_m2)) },
      { key: 'used_m2', num: true, render: r => esc(prdFmt('area', r.used_m2)) },
      { key: 'free', label: T('msg.libera'), num: true, render: r => esc(prdFmt('area', r.area_m2 - r.used_m2)) },
    ],
    fields: ['municipality', 'sheet', 'number', 'subparcel', { key: 'area_m2', type: 'area' }, { key: 'notes', type: 'textarea' }],
  },
  equipment: {
    path: '/equipment', title: 'attrezzature', area: 'vineyard',
    columns: [
      { key: 'name', render: r => `<b>${esc(r.name)}</b>${prdArchivedBadge(r)}` }, { key: 'type', render: r => esc(prdLabel('equipment_type', r.type)) }, { key: 'plate_serial' },
      { key: 'last_inspection_date', render: r => UI.date(r.last_inspection_date) },
      { key: 'inspection_due', render: r => (r.inspection_due ? `${UI.date(r.inspection_due)}${r.inspection_expired ? ` ${prdBadge(T('msg.scaduto'), 'red')}` : ''}` : '—') },
    ],
    fields: ['name', { key: 'type', type: 'enum', group: 'equipment_type', required: true }, 'plate_serial', { key: 'last_inspection_date', type: 'date' }, { key: 'notes', type: 'textarea' }],
  },
  phyto: {
    path: '/phyto-products', title: 'fitofarmaci', area: 'vineyard',
    columns: [
      { key: 'commercial_name', render: r => `<b>${esc(r.commercial_name)}</b>${prdArchivedBadge(r)}${r.active_substances ? `<br><span class="mod-note" style="margin:0">${esc(r.active_substances)}</span>` : ''}` },
      { key: 'registration_number' }, { key: 'max_dose_per_ha_e4', num: true, render: r => (r.max_dose_per_ha_e4 == null ? '—' : `${esc(prdE4(r.max_dose_per_ha_e4))} ${esc(r.dose_unit || '')}`) },
      { key: 'preharvest_interval_days', num: true }, { key: 'reentry_hours', num: true },
      { key: 'organic_allowed', render: r => (r.organic_allowed ? prdBadge('bio', 'green') : '') },
    ],
    fields: ['commercial_name', 'registration_number', { key: 'active_substances', full: true }, { key: 'max_dose_per_ha_e4', type: 'decimal' }, { key: 'dose_unit', type: 'enum', group: 'dose_unit' },
      { key: 'preharvest_interval_days', type: 'int' }, { key: 'reentry_hours', type: 'int' }, { key: 'max_applications_per_year', type: 'int' }, { key: 'organic_allowed', type: 'bool' },
      { key: 'label_url', full: true }, { key: 'notes', type: 'textarea' }],
  },
});

// Riga dell'editor particelle ↔ parcella (superficie vitata nell'unità scelta, unità vitata dello schedario).
function prdLinkRow(l = {}) {
  const opts = (PRD.cache.cadastral || []).map(c => `<option value="${c.id}" ${c.id === l.cadastral_parcel_id ? 'selected' : ''}>${esc(prdOptionLabel('cadastral', c))}</option>`).join('');
  return `<div class="field-row prd-link" style="align-items:end">
    <div class="field"><label>${esc(T('f.number'))}</label><select data-link="cadastral_parcel_id"><option value="">—</option>${opts}</select></div>
    <div class="field"><label>${esc(T('f.vine_area_m2'))} (${esc(prdUnit('area').s)})</label><input data-link="vine_area_m2" inputmode="decimal" value="${UI.attr(prdToInput('area', l.vine_area_m2))}"></div>
    <div class="field"><label>${esc(T('f.schedario_unit_code'))}</label><div style="display:flex;gap:6px"><input data-link="schedario_unit_code" value="${UI.attr(l.schedario_unit_code || '')}">
      <button class="btn-outline-pill" type="button" onclick="this.closest('.prd-link').remove()">${esc(T('btn.togli'))}</button></div></div></div>`;
}
