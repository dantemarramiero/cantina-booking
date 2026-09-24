// Portale → Finance (Fase 1): centri di costo, oggetti di costo, ribaltamenti, driver, costi diretti, cascata.
const FIN_LEVELS = { 1: 'Generali', 2: 'Ausiliari', 3: 'Produttivi', 4: 'Commerciali' };
const FIN_OBJECT_TYPES = { annata: 'Annata', lotto: 'Lotto di vino', sku: 'Bottiglia (SKU)', operazione: 'Operazione colturale', esperienza: 'Esperienza', fiera: 'Fiera', progetto: 'Progetto / contributo', evento: 'Evento' };
const FIN_NATURES = { personale: 'Personale', materie: 'Materie', servizi: 'Servizi', utenze: 'Utenze', ammortamenti: 'Ammortamenti', altro: 'Altro' };
const FIN = { centers: [], objects: [], drivers: [], period: UI.thisMonth() };

const finLevelBadge = l => (l ? `<span class="cc-level l${l}">${l} · ${FIN_LEVELS[l]}</span>` : '');
const finLeaves = () => FIN.centers.filter(c => c.is_leaf && c.active);
const finCenterLabel = c => `${c.code} ${c.name}`;
async function finLoadCenters() { FIN.centers = await api('/api/admin/finance/cost-centers'); return FIN.centers; }
async function finLoadObjects() { FIN.objects = await api('/api/admin/finance/cost-objects'); return FIN.objects; }
async function finLoadDrivers() { FIN.drivers = await api('/api/admin/finance/drivers'); return FIN.drivers; }

function finPeriodPicker(onchange) {
  return `<input type="month" value="${FIN.period}" onchange="FIN.period = this.value || UI.thisMonth(); ${onchange}()" aria-label="Periodo">`;
}

// ── Centri di costo ────────────────────────────────────────────────────────────
function finTreeOrder(centers) {
  const children = new Map();
  for (const c of centers) {
    const k = c.parent_id ?? 0;
    if (!children.has(k)) children.set(k, []);
    children.get(k).push(c);
  }
  const out = [];
  const walk = (parent, depth) => {
    for (const c of (children.get(parent) || []).sort((a, b) => (a.cascade_order - b.cascade_order) || a.code.localeCompare(b.code))) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}

async function loadFinCenters() {
  const root = document.getElementById('fin-centri-root');
  const centers = await finLoadCenters();
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Centri di costo</h3><p class="mod-intro">L'albero serve ai report; il livello di cascata sulle foglie decide l'ordine dei ribaltamenti. Solo le foglie ricevono costi.</p></div>
      <div class="list-spacer"></div>
      <button class="btn-generate" onclick="openFinCenterModal()">${UI.icon.plus} Nuovo centro</button>
    </div>
    <div class="cc-legend">Livelli: ${[1, 2, 3, 4].map(finLevelBadge).join(' ')} <span>· si ribalta solo verso i livelli successivi</span></div>
    ${finTreeOrder(centers).map(c => `
      <div class="mod-row ${c.is_leaf ? '' : 'cc-aggregate'} ${c.active ? '' : 'cc-inactive'}" style="padding-left:${22 + c.depth * 24}px">
        <div class="mod-row-main">
          <div class="mod-row-title"><span class="mod-code">${esc(c.code)}</span>${esc(c.name)}</div>
          ${c.description ? `<div class="mod-row-sub">${esc(c.description)}</div>` : ''}
        </div>
        ${c.is_leaf ? finLevelBadge(c.cascade_level) || '<span class="badge yellow">Livello mancante</span>' : ''}
        ${c.active ? '' : '<span class="badge grey">Disattivato</span>'}
        ${c.has_movements ? '<span class="badge grey" title="Ha costi, regole o dipendenti collegati">In uso</span>' : ''}
        <div class="mod-row-actions">
          <button class="btn-outline-pill" onclick="openFinCenterModal(${c.id})">Modifica</button>
          ${!c.has_movements && c.is_leaf ? `<button class="btn-outline-pill danger" title="Elimina" onclick="deleteFinCenter(${c.id})">${UI.icon.trash}</button>` : ''}
        </div>
      </div>`).join('') || '<div class="mod-empty">Nessun centro di costo.</div>'}
  </div>`;
}

function openFinCenterModal(id) {
  const c = FIN.centers.find(x => x.id === id) || null;
  // Il padre non può essere il centro stesso né un suo discendente.
  const excluded = new Set();
  if (c) {
    const walk = pid => { excluded.add(pid); FIN.centers.filter(x => x.parent_id === pid).forEach(x => walk(x.id)); };
    walk(c.id);
  }
  const parents = finTreeOrder(FIN.centers).filter(x => !excluded.has(x.id));
  UI.modal({
    id: 'fin-center-modal', title: c ? `Modifica ${c.code}` : 'Nuovo centro di costo',
    body: `
      <div class="field-row">
        <div class="field"><label>Codice</label><input name="code" value="${UI.attr(c?.code)}" placeholder="es. P105"></div>
        <div class="field"><label>Nome</label><input name="name" value="${UI.attr(c?.name)}"></div>
      </div>
      <div class="field"><label>Descrizione</label><input name="description" value="${UI.attr(c?.description)}"></div>
      <div class="field-row">
        <div class="field"><label>Sotto</label><select name="parent_id">${UI.options(parents, c?.parent_id, { empty: '— Nessuno (primo livello) —', label: x => `${'  '.repeat(x.depth)}${x.code} ${x.name}` })}</select></div>
        <div class="field"><label>Livello di cascata</label><select name="cascade_level">${UI.options([1, 2, 3, 4].map(l => ({ id: l, name: `${l} · ${FIN_LEVELS[l]}` })), c?.cascade_level, { empty: '— Solo per le foglie —' })}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Ordine nello stesso livello</label><input name="cascade_order" type="number" value="${UI.attr(c?.cascade_order ?? 0)}"></div>
        <div class="field"><label>Valido dal</label><input name="valid_from" type="date" value="${UI.attr(c?.valid_from)}"></div>
        <div class="field"><label>Valido fino al</label><input name="valid_to" type="date" value="${UI.attr(c?.valid_to)}"></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> Attivo</label>
      <p class="mod-note">Un centro con movimenti non si elimina: si disattiva. Un centro che ha già costi non può diventare un aggregato (sotto-centri): creane uno nuovo come padre.</p>`,
    onSave: async box => {
      const body = {};
      for (const k of ['code', 'name', 'description', 'parent_id', 'cascade_level', 'cascade_order', 'valid_from', 'valid_to', 'active']) body[k] = UI.val(box, k);
      await api('/api/admin/finance/cost-centers' + (c ? `/${c.id}` : ''), { method: c ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadFinCenters();
    },
  });
}
function deleteFinCenter(id) {
  UI.confirmDo('Eliminare questo centro di costo?', () => api(`/api/admin/finance/cost-centers/${id}`, { method: 'DELETE' }), loadFinCenters);
}

// ── Oggetti di costo ───────────────────────────────────────────────────────────
let FIN_LINKS = null;
async function loadFinObjects() {
  const root = document.getElementById('fin-oggetti-root');
  const filter = document.getElementById('fin-obj-type')?.value || '';
  const objects = await finLoadObjects();
  const shown = objects.filter(o => !filter || o.type === filter);
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Oggetti di costo</h3><p class="mod-intro">Ciò di cui vuoi conoscere il costo pieno: annate, lotti, bottiglie, esperienze, fiere, progetti. Ricevono costi diretti e quote dai centri produttivi e commerciali.</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields"><select id="fin-obj-type" onchange="loadFinObjects()">${UI.options(Object.entries(FIN_OBJECT_TYPES).map(([id, name]) => ({ id, name })), filter, { empty: 'Tutti i tipi' })}</select></div>
      <button class="btn-generate" onclick="openFinObjectModal()">${UI.icon.plus} Nuovo oggetto</button>
    </div>
    ${shown.map(o => {
      const link = o.fair_name || o.experience_name || (o.product_name ? `${o.product_name}${o.product_vintage ? ' ' + o.product_vintage : ''}` : null) || (o.vintage ? `Annata ${o.vintage}` : null);
      return `<div class="mod-row">
        <div class="mod-row-main">
          <div class="mod-row-title"><span class="mod-code">${esc(o.code)}</span>${esc(o.name)}</div>
          <div class="mod-row-sub">${esc(FIN_OBJECT_TYPES[o.type])}${link ? ' · ' + esc(link) : ''}</div>
        </div>
        <span class="badge ${o.status === 'aperto' ? 'green' : 'grey'}">${o.status === 'aperto' ? 'Aperto' : 'Chiuso'}</span>
        <div class="mod-row-actions">
          <button class="btn-outline-pill" onclick="openFinObjectModal(${o.id})">Modifica</button>
          ${!o.has_movements ? `<button class="btn-outline-pill danger" title="Elimina" onclick="deleteFinObject(${o.id})">${UI.icon.trash}</button>` : ''}
        </div>
      </div>`;
    }).join('') || '<div class="mod-empty">Nessun oggetto di costo.</div>'}
  </div>`;
}
async function openFinObjectModal(id) {
  const o = FIN.objects.find(x => x.id === id) || null;
  FIN_LINKS = FIN_LINKS || await api('/api/admin/finance/cost-objects/links');
  const box = UI.modal({
    id: 'fin-object-modal', title: o ? `Modifica ${o.code}` : 'Nuovo oggetto di costo',
    body: `
      <div class="field-row">
        <div class="field"><label>Tipo</label><select name="type" onchange="finObjectLinkField(this.closest('.modal-box'))">${UI.options(Object.entries(FIN_OBJECT_TYPES).map(([k, name]) => ({ id: k, name })), o?.type || 'sku')}</select></div>
        <div class="field"><label>Stato</label><select name="status">${UI.options([{ id: 'aperto', name: 'Aperto' }, { id: 'chiuso', name: 'Chiuso' }], o?.status || 'aperto')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Codice</label><input name="code" value="${UI.attr(o?.code)}" placeholder="es. SKU-INFERI-22"></div>
        <div class="field"><label>Nome</label><input name="name" value="${UI.attr(o?.name)}"></div>
      </div>
      <div class="field" data-link="fiera"><label>Fiera</label><select name="fair_id">${UI.options(FIN_LINKS.fairs, o?.fair_id, { empty: '— Nessuna —', label: f => `${f.name}${f.start_date ? ' · ' + UI.date(f.start_date) : ''}` })}</select></div>
      <div class="field" data-link="esperienza"><label>Esperienza</label><select name="experience_id">${UI.options(FIN_LINKS.experiences, o?.experience_id, { empty: '— Nessuna —' })}</select></div>
      <div class="field" data-link="sku"><label>Bottiglia</label><select name="product_id">${UI.options(FIN_LINKS.products, o?.product_id, { empty: '— Nessuna —', label: p => `${p.name}${p.vintage ? ' ' + p.vintage : ''}` })}</select></div>
      <div class="field" data-link="annata lotto"><label>Annata</label><input name="vintage" type="number" value="${UI.attr(o?.vintage)}" placeholder="es. 2024"></div>
      <div class="field"><label>Note</label><input name="notes" value="${UI.attr(o?.notes)}"></div>`,
    onSave: async b => {
      const body = {};
      for (const k of ['type', 'status', 'code', 'name', 'fair_id', 'experience_id', 'product_id', 'vintage', 'notes']) body[k] = UI.val(b, k);
      await api('/api/admin/finance/cost-objects' + (o ? `/${o.id}` : ''), { method: o ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadFinObjects();
    },
  });
  finObjectLinkField(box.querySelector('.modal-box'));
}
function finObjectLinkField(box) {
  const type = box.querySelector('[name="type"]').value;
  box.querySelectorAll('[data-link]').forEach(f => { f.style.display = f.dataset.link.split(' ').includes(type) ? '' : 'none'; });
}
function deleteFinObject(id) {
  UI.confirmDo('Eliminare questo oggetto di costo?', () => api(`/api/admin/finance/cost-objects/${id}`, { method: 'DELETE' }), loadFinObjects);
}

// ── Ribaltamenti (regole) ──────────────────────────────────────────────────────
async function loadFinRules() {
  const root = document.getElementById('fin-regole-root');
  const [rules] = await Promise.all([api('/api/admin/finance/rules'), finLoadCenters(), finLoadObjects(), finLoadDrivers()]);
  const byLevel = [1, 2, 3, 4].map(l => ({ l, rules: rules.filter(r => r.source_level === l) })).filter(g => g.rules.length);
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Ribaltamenti</h3><p class="mod-intro">Da quale centro, verso quali centri od oggetti, con che base. Ogni regola vale per un intervallo di mesi; una regola già usata da una cascata confermata si chiude e se ne crea una nuova.</p></div>
      <div class="list-spacer"></div>
      <button class="btn-generate" onclick="openFinRuleModal()">${UI.icon.plus} Nuova regola</button>
    </div>
    ${byLevel.map(g => `<div class="mod-body" style="padding-bottom:0"><div class="mod-section-title">${esc(FIN_LEVELS[g.l])}</div></div>
      ${g.rules.map(r => `<div class="mod-row">
        <div class="mod-row-main">
          <div class="mod-row-title">${esc(r.source_label)}</div>
          <div class="mod-row-sub">${r.driver_name ? `In base a: <b>${esc(r.driver_name)}</b>` : 'Percentuali fisse'} · da ${esc(r.valid_from)}${r.valid_to ? ` a ${esc(r.valid_to)}` : ' senza fine'}</div>
          <div class="mod-row-sub">→ ${r.targets.map(t => `${esc(t.label)}${t.share ? ` <b>${UI.decimal(t.share)}%</b>` : ''}`).join(' · ')}</div>
        </div>
        ${r.last_used_period ? `<span class="badge grey" title="Usata da una cascata confermata">Usata fino a ${esc(r.last_used_period)}</span>` : ''}
        <div class="mod-row-actions">
          ${r.last_used_period
            ? `<button class="btn-outline-pill" onclick="closeFinRule(${r.id}, '${r.last_used_period}')">Chiudi</button>`
            : `<button class="btn-outline-pill" onclick="openFinRuleModal(${r.id})">Modifica</button><button class="btn-outline-pill danger" title="Elimina" onclick="deleteFinRule(${r.id})">${UI.icon.trash}</button>`}
        </div>
      </div>`).join('')}`).join('') || '<div class="mod-empty">Nessuna regola di ribaltamento.</div>'}
  </div>`;
  FIN.rules = rules;
}

function finTargetOptions(sourceLevel, selected) {
  const centers = finLeaves().filter(c => c.cascade_level && sourceLevel && c.cascade_level > sourceLevel);
  const objects = sourceLevel >= 3 ? FIN.objects.filter(o => o.status === 'aperto') : [];
  return '<option value="">— Scegli —</option>'
    + (centers.length ? `<optgroup label="Centri di livello successivo">${centers.map(c => `<option value="c${c.id}" ${selected === `c${c.id}` ? 'selected' : ''}>${esc(finCenterLabel(c))} (${FIN_LEVELS[c.cascade_level]})</option>`).join('')}</optgroup>` : '')
    + (objects.length ? `<optgroup label="Oggetti di costo">${objects.map(o => `<option value="o${o.id}" ${selected === `o${o.id}` ? 'selected' : ''}>${esc(o.code)} ${esc(o.name)}</option>`).join('')}</optgroup>` : '');
}
function finRuleTargetRow(sourceLevel, t = {}) {
  const sel = t.target_center_id ? `c${t.target_center_id}` : t.target_cost_object_id ? `o${t.target_cost_object_id}` : '';
  return `<div class="mod-edit-row" style="grid-template-columns:minmax(0,1fr) 110px auto">
    <select data-target oninput="finRuleSum(this.closest('.modal-box'))">${finTargetOptions(sourceLevel, sel)}</select>
    <input data-share inputmode="decimal" placeholder="%" value="${UI.attr(t.share ? UI.decimal(t.share) : '')}" oninput="finRuleSum(this.closest('.modal-box'))">
    <button type="button" class="btn-outline-pill danger" onclick="const b=this.closest('.modal-box'); this.parentElement.remove(); finRuleSum(b)">×</button>
  </div>`;
}
function finRuleSourceLevel(box) {
  const src = FIN.centers.find(c => String(c.id) === box.querySelector('[name="source_center_id"]').value);
  return src?.cascade_level || null;
}
function finRuleSum(box) {
  const fixed = !box.querySelector('[name="driver_id"]').value;
  box.querySelectorAll('[data-share]').forEach(i => { i.style.display = fixed ? '' : 'none'; });
  const sum = [...box.querySelectorAll('[data-share]')].reduce((s, i) => s + (Number(i.value.replace(',', '.')) || 0), 0);
  const el = box.querySelector('.mod-sum');
  el.textContent = fixed ? `Totale: ${sum.toLocaleString('it-IT', { maximumFractionDigits: 4 })}% (deve fare 100%)` : 'Le quote si calcolano dai valori del driver nel periodo (pagina Driver).';
  el.classList.toggle('bad', fixed && Math.abs(sum - 100) > 0.00001);
}
function openFinRuleModal(id) {
  const r = (FIN.rules || []).find(x => x.id === id) || null;
  const sources = finLeaves().filter(c => c.cascade_level && c.cascade_level < 4);
  const box = UI.modal({
    id: 'fin-rule-modal', title: r ? 'Modifica regola' : 'Nuova regola di ribaltamento', width: 640,
    body: `
      <div class="field"><label>Centro da ribaltare</label><select name="source_center_id" onchange="const b=this.closest('.modal-box'); b.querySelectorAll('[data-target]').forEach(s => { s.innerHTML = finTargetOptions(finRuleSourceLevel(b), s.value); })">${UI.options(sources, r?.source_center_id, { empty: '— Scegli —', label: c => `${finCenterLabel(c)} (${FIN_LEVELS[c.cascade_level]})` })}</select></div>
      <div class="field-row">
        <div class="field"><label>Valida da (mese)</label><input name="valid_from" type="month" value="${UI.attr(r?.valid_from || FIN.period)}"></div>
        <div class="field"><label>Fino a (facoltativo)</label><input name="valid_to" type="month" value="${UI.attr(r?.valid_to)}"></div>
      </div>
      <div class="field"><label>Base di ripartizione</label><select name="driver_id" onchange="finRuleSum(this.closest('.modal-box'))">${UI.options(FIN.drivers.filter(d => d.active), r?.driver_id, { empty: 'Percentuali fisse', label: d => `${d.name} (${d.unit})` })}</select></div>
      <div class="field"><label>Destinazioni</label>
        <div class="mod-edit-rows" data-rows>${(r?.targets?.length ? r.targets : [{}, {}]).map(t => finRuleTargetRow(r?.source_level, t)).join('')}</div>
        <button type="button" class="btn secondary small" style="margin-top:8px" onclick="const b=this.closest('.modal-box'); b.querySelector('[data-rows]').insertAdjacentHTML('beforeend', finRuleTargetRow(finRuleSourceLevel(b))); finRuleSum(b)">+ Aggiungi destinazione</button>
        <div class="mod-sum"></div>
      </div>
      <div class="field"><label>Nota</label><input name="note" value="${UI.attr(r?.note)}"></div>
      <p class="mod-note">Si ribalta solo verso centri di livello successivo (nessun ciclo possibile). Solo i centri produttivi e commerciali possono ribaltare su oggetti di costo.</p>`,
    onSave: async b => {
      const fixed = !UI.val(b, 'driver_id');
      const targets = [...b.querySelectorAll('[data-rows] .mod-edit-row')].map(row => {
        const v = row.querySelector('[data-target]').value;
        if (!v) return null;
        const id2 = parseInt(v.slice(1));
        return { [v[0] === 'c' ? 'target_center_id' : 'target_cost_object_id']: id2, share: fixed ? row.querySelector('[data-share]').value.trim() : null };
      }).filter(Boolean);
      const body = { source_center_id: UI.val(b, 'source_center_id'), valid_from: UI.val(b, 'valid_from'), valid_to: UI.val(b, 'valid_to') || null, driver_id: UI.val(b, 'driver_id') || null, note: UI.val(b, 'note'), targets };
      await api('/api/admin/finance/rules' + (r ? `/${r.id}` : ''), { method: r ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadFinRules();
    },
  });
  finRuleSum(box.querySelector('.modal-box'));
}
function closeFinRule(id, lastUsed) {
  const to = prompt(`Ultimo mese di validità (AAAA-MM). La regola è stata usata fino a ${lastUsed}: la fine non può essere prima.`, lastUsed);
  if (!to) return;
  api(`/api/admin/finance/rules/${id}`, { method: 'PATCH', body: JSON.stringify({ valid_to: to }) }).then(loadFinRules).catch(e => alert(e.message));
}
function deleteFinRule(id) {
  UI.confirmDo('Eliminare questa regola?', () => api(`/api/admin/finance/rules/${id}`, { method: 'DELETE' }), loadFinRules);
}

// ── Driver e valori del periodo ────────────────────────────────────────────────
async function loadFinDrivers() {
  const root = document.getElementById('fin-driver-root');
  const drivers = await finLoadDrivers();
  const current = FIN.driverId || drivers.find(d => d.active)?.id;
  FIN.driverId = current;
  const values = current ? await api(`/api/admin/finance/driver-values?period=${FIN.period}&driver_id=${current}`) : null;
  const d = drivers.find(x => x.id === current);
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Valori dei driver</h3><p class="mod-intro">Le quantità del mese per ogni destinazione (m², ore macchina, bottiglie…). Le righe sono le destinazioni delle regole che usano il driver.</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields">
        ${finPeriodPicker('loadFinDrivers')}
        <select onchange="FIN.driverId = parseInt(this.value); loadFinDrivers()">${UI.options(drivers.filter(x => x.active), current, { label: x => `${x.name} (${x.unit})` })}</select>
      </div>
    </div>
    <div class="mod-body">
      ${values?.locked ? `<div class="mod-warn">La cascata di ${esc(UI.monthLabel(FIN.period))} è confermata: per cambiare i valori annullala dalla pagina Cascata.</div>` : ''}
      ${values && values.rows.length ? `
        <div class="mod-edit-rows" id="fin-dv-rows">${values.rows.map(r => `
          <div class="mod-edit-row" style="grid-template-columns:minmax(0,1fr) 160px" data-center="${r.target_center_id ?? ''}" data-object="${r.target_cost_object_id ?? ''}">
            <span style="font-size:13px">${esc(r.label)}</span>
            <input inputmode="decimal" value="${UI.attr(r.quantity != null ? UI.decimal(r.quantity) : '')}" placeholder="${UI.attr(d?.unit)}" ${values.locked ? 'disabled' : ''}>
          </div>`).join('')}</div>
        ${values.locked ? '' : '<button class="btn" style="margin-top:14px" onclick="saveFinDriverValues()">Salva valori</button>'}
        <div id="fin-dv-msg"></div>`
        : '<div class="mod-empty">Nessuna regola valida in questo mese usa questo driver.</div>'}
      <div class="mod-section-title" style="margin-top:26px">Driver disponibili</div>
      ${drivers.map(x => `<div class="mod-row" style="padding-left:0;padding-right:0"><div class="mod-row-main"><div class="mod-row-title">${esc(x.name)}</div><div class="mod-row-sub">${esc(x.unit)} · ${x.source === 'people' ? 'calcolato da People (dalla Fase 2)' : 'inserito a mano'}</div></div>${x.active ? '' : '<span class="badge grey">Disattivato</span>'}<button class="btn-outline-pill" onclick="openFinDriverModal(${x.id})">Modifica</button></div>`).join('')}
      <button class="btn secondary small" style="margin-top:10px" onclick="openFinDriverModal()">+ Nuovo driver</button>
    </div>
  </div>`;
}
async function saveFinDriverValues() {
  const values = [...document.querySelectorAll('#fin-dv-rows .mod-edit-row')].map(row => ({
    target_center_id: row.dataset.center || null, target_cost_object_id: row.dataset.object || null, quantity: row.querySelector('input').value.trim(),
  }));
  try {
    await api('/api/admin/finance/driver-values', { method: 'PUT', body: JSON.stringify({ period: FIN.period, driver_id: FIN.driverId, values }) });
    UI.msg(document.getElementById('fin-dv-msg'), 'Valori salvati.', 'success');
  } catch (e) {
    UI.msg(document.getElementById('fin-dv-msg'), e.message);
  }
}
function openFinDriverModal(id) {
  const d = FIN.drivers.find(x => x.id === id) || null;
  UI.modal({
    id: 'fin-driver-modal', title: d ? `Modifica ${d.name}` : 'Nuovo driver', width: 460,
    body: `
      ${d ? '' : '<div class="field"><label>Codice</label><input name="code" placeholder="es. ettari"></div>'}
      <div class="field"><label>Nome</label><input name="name" value="${UI.attr(d?.name)}"></div>
      <div class="field"><label>Unità</label><input name="unit" value="${UI.attr(d?.unit)}" placeholder="es. ha"></div>
      ${d ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Attivo</label>` : ''}`,
    onSave: async b => {
      const body = d ? { name: UI.val(b, 'name'), unit: UI.val(b, 'unit'), active: UI.val(b, 'active') } : { code: UI.val(b, 'code'), name: UI.val(b, 'name'), unit: UI.val(b, 'unit') };
      await api('/api/admin/finance/drivers' + (d ? `/${d.id}` : ''), { method: d ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadFinDrivers();
    },
  });
}

// ── Costi diretti ──────────────────────────────────────────────────────────────
async function loadFinCosts() {
  const root = document.getElementById('fin-costi-root');
  const [data] = await Promise.all([api(`/api/admin/finance/direct-costs?period=${FIN.period}`), finLoadCenters(), finLoadObjects()]);
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Costi diretti</h3><p class="mod-intro">I costi del mese imputati a un centro (e, se serve, a un oggetto di costo). Per ora si inseriscono a mano; dalle fasi successive arriveranno da ore lavorate, magazzino e contabilità.</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields">${finPeriodPicker('loadFinCosts')}</div>
      ${data.locked ? '' : `<button class="btn-generate" onclick="openFinCostModal()">${UI.icon.plus} Nuovo costo</button>`}
    </div>
    ${data.locked ? `<div class="mod-body" style="padding-bottom:0"><div class="mod-warn">La cascata di ${esc(UI.monthLabel(FIN.period))} è confermata: per aggiungere o togliere costi annullala dalla pagina Cascata.</div></div>` : ''}
    ${data.rows.length ? `<div class="mod-table-wrap"><table class="mod-table">
      <thead><tr><th>Data</th><th>Centro</th><th>Oggetto</th><th>Natura</th><th>Descrizione</th><th class="num">Importo</th><th></th></tr></thead>
      <tbody>${data.rows.map(r => `<tr>
        <td>${UI.date(r.entry_date)}</td><td><span class="mod-code">${esc(r.center_code)}</span>${esc(r.center_name)}</td>
        <td>${r.object_code ? `${esc(r.object_code)} ${esc(r.object_name)}` : '—'}</td><td>${esc(FIN_NATURES[r.nature])}</td><td>${esc(r.description || '')}</td>
        <td class="num">${UI.euro(r.amount_cents)}</td>
        <td>${data.locked ? '' : `<button class="btn-outline-pill danger" title="Elimina" onclick="deleteFinCost(${r.id})">${UI.icon.trash}</button>`}</td>
      </tr>`).join('')}
      <tr class="total"><td colspan="5">Totale ${esc(UI.monthLabel(FIN.period))}</td><td class="num">${UI.euro(data.total_cents)}</td><td></td></tr></tbody>
    </table></div>` : `<div class="mod-empty">Nessun costo in ${esc(UI.monthLabel(FIN.period))}.</div>`}
  </div>`;
}
function openFinCostModal() {
  const today = new Date().toISOString().slice(0, 10);
  const date = today.startsWith(FIN.period) ? today : `${FIN.period}-01`;
  UI.modal({
    id: 'fin-cost-modal', title: 'Nuovo costo diretto',
    body: `
      <div class="field-row">
        <div class="field"><label>Data</label><input name="entry_date" type="date" value="${date}"></div>
        <div class="field"><label>Importo (€)</label><input name="amount" inputmode="decimal" placeholder="es. 1250,00"></div>
      </div>
      <div class="field"><label>Centro di costo</label><select name="cost_center_id">${UI.options(finLeaves(), null, { empty: '— Scegli —', label: c => `${finCenterLabel(c)}${c.cascade_level ? ' · ' + FIN_LEVELS[c.cascade_level] : ''}` })}</select></div>
      <div class="field"><label>Oggetto di costo (facoltativo)</label><select name="cost_object_id">${UI.options(FIN.objects.filter(o => o.status === 'aperto'), null, { empty: '— Nessuno —', label: o => `${o.code} ${o.name}` })}</select></div>
      <div class="field-row">
        <div class="field"><label>Natura</label><select name="nature">${UI.options(Object.entries(FIN_NATURES).map(([id, name]) => ({ id, name })), 'servizi')}</select></div>
        <div class="field"><label>Descrizione</label><input name="description"></div>
      </div>
      <p class="mod-note">Un importo negativo registra uno storno. Un costo con oggetto di costo è già alla sua destinazione finale e non si ribalta.</p>`,
    onSave: async b => {
      const body = {};
      for (const k of ['entry_date', 'amount', 'cost_center_id', 'cost_object_id', 'nature', 'description']) body[k] = UI.val(b, k);
      await api('/api/admin/finance/direct-costs', { method: 'POST', body: JSON.stringify(body) });
      if (body.entry_date.slice(0, 7) !== FIN.period) FIN.period = body.entry_date.slice(0, 7);
      loadFinCosts();
    },
  });
}
function deleteFinCost(id) {
  UI.confirmDo('Eliminare questo costo?', () => api(`/api/admin/finance/direct-costs/${id}`, { method: 'DELETE' }), loadFinCosts);
}

// ── Cascata ────────────────────────────────────────────────────────────────────
async function loadFinCascade(simulation = null) {
  const root = document.getElementById('fin-cascata-root');
  const state = await api(`/api/admin/finance/cascade/${FIN.period}`);
  const view = simulation || state.confirmed;
  const confirmed = state.confirmed;
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Cascata</h3><p class="mod-intro">Ribalta i costi del mese livello per livello: ogni centro ribaltato chiude a zero, e il totale quadra al centesimo. Prima simula, poi conferma.</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields">${finPeriodPicker('loadFinCascade')}</div>
      <button class="btn secondary small" onclick="runFinCascade('simulate')">Simula</button>
      ${confirmed
        ? `<button class="btn small" onclick="runFinCascade('rerun')">Riesegui</button><button class="btn-outline-pill danger" onclick="runFinCascade('cancel')">Annulla cascata</button>`
        : `<button class="btn small" onclick="runFinCascade('confirm')" ${simulation && !simulation.blocking ? '' : 'disabled title="Simula prima, senza anomalie bloccanti"'}>Conferma</button>`}
    </div>
    <div class="mod-body">
      <div id="fin-cascade-msg"></div>
      ${confirmed ? `<div class="mod-ok">Cascata di ${esc(UI.monthLabel(FIN.period))} confermata il ${esc(new Date(confirmed.created_at).toLocaleString('it-IT'))} da ${esc(confirmed.created_by || '—')}. I dati del mese sono bloccati finché non la annulli.</div>` : ''}
      ${simulation ? `<div class="mod-section-title">Simulazione (non salvata)</div>` : ''}
      ${view ? finCascadeReport(view) : `<div class="mod-empty">Nessuna cascata per ${esc(UI.monthLabel(FIN.period))}. Premi «Simula» per vedere il risultato.</div>`}
      ${state.runs.length ? `<div class="mod-section-title" style="margin-top:26px">Storico esecuzioni</div>
        ${state.runs.map(r => `<div class="mod-row-sub">#${r.id} · ${r.status === 'confermata' ? 'confermata' : 'annullata'} · ${esc(new Date(r.created_at).toLocaleString('it-IT'))} da ${esc(r.created_by || '—')} · ribaltati ${UI.euro(r.total_allocated_cents)}${r.cancelled_at ? ` · annullata il ${esc(new Date(r.cancelled_at).toLocaleString('it-IT'))}` : ''}</div>`).join('')}` : ''}
    </div>
  </div>`;
}
function finCascadeReport(v) {
  const anomalies = (v.anomalies || []).map(a => `<div class="mod-anomaly">${esc(a.message)}</div>`).join('');
  const centers = finTreeOrder(v.centers.map(c => ({ ...c, cascade_order: FIN.centers.find(x => x.id === c.id)?.cascade_order ?? 0 })))
    .filter(c => c.direct || c.full_cost || c.final || c.allocated);
  const n = x => (x ? UI.euro(x) : '—');
  return `${anomalies}
    <div class="mod-section-title">Centri: costo diretto + quote ricevute = costo pieno</div>
    <div class="mod-table-wrap"><table class="mod-table">
      <thead><tr><th>Centro</th><th>Livello</th><th class="num">Diretto</th><th class="num">Da generali</th><th class="num">Da ausiliari</th><th class="num">Da produttivi</th><th class="num">Costo pieno</th><th class="num">Ribaltato</th><th class="num">Resta</th></tr></thead>
      <tbody>${centers.map(c => `<tr class="${c.is_leaf ? '' : 'agg'}">
        <td style="padding-left:${12 + c.depth * 18}px"><span class="mod-code">${esc(c.code)}</span>${esc(c.name)}</td>
        <td>${c.is_leaf ? finLevelBadge(c.cascade_level) : ''}</td>
        <td class="num">${n(c.direct)}</td><td class="num">${n(c.received[1])}</td><td class="num">${n(c.received[2])}</td><td class="num">${n(c.received[3])}</td>
        <td class="num"><b>${n(c.full_cost)}</b></td><td class="num">${n(c.allocated)}</td><td class="num">${n(c.final)}</td>
      </tr>`).join('') || '<tr><td colspan="9">Nessun costo nel periodo.</td></tr>'}</tbody>
    </table></div>
    ${v.objects.length ? `<div class="mod-section-title" style="margin-top:22px">Oggetti di costo</div>
    <div class="mod-table-wrap"><table class="mod-table">
      <thead><tr><th>Oggetto</th><th class="num">Diretto</th><th class="num">Da produttivi</th><th class="num">Da commerciali</th><th class="num">Costo pieno</th></tr></thead>
      <tbody>${v.objects.map(o => `<tr><td><span class="mod-code">${esc(o.code)}</span>${esc(o.name)}</td><td class="num">${n(o.direct)}</td><td class="num">${n(o.received[3])}</td><td class="num">${n(o.received[4])}</td><td class="num"><b>${n(o.total)}</b></td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    <div class="mod-table-wrap" style="margin-top:14px"><table class="mod-table" style="min-width:0">
      <tbody>
        <tr><td>Costi diretti del periodo</td><td class="num">${UI.euro(v.totals.direct)}</td></tr>
        <tr><td>Quote ribaltate <span style="color:var(--ink-faint)">(somma di tutti i passaggi tra livelli: può superare i costi)</span></td><td class="num">${UI.euro(v.totals.allocated)}</td></tr>
        <tr><td>Restano sui centri finali</td><td class="num">${UI.euro(v.totals.remaining_on_centers)}</td></tr>
        <tr><td>Arrivati agli oggetti di costo</td><td class="num">${UI.euro(v.totals.on_objects)}</td></tr>
        <tr class="total"><td>Controllo quadratura</td><td class="num">${v.totals.remaining_on_centers + v.totals.on_objects === v.totals.direct ? '✓ quadra al centesimo' : '✗ non quadra'}</td></tr>
      </tbody>
    </table></div>
    ${v.entries.length ? `<details style="margin-top:18px"><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--ink)">Dettaglio delle ${v.entries.length} quote</summary>
    <div class="mod-table-wrap" style="margin-top:10px"><table class="mod-table">
      <thead><tr><th>Passo</th><th>Da</th><th>A</th><th>Base</th><th class="num">Quantità</th><th class="num">Quota</th><th class="num">Importo</th></tr></thead>
      <tbody>${v.entries.map(e => `<tr><td>${e.step}</td><td>${esc(e.source_label)}</td><td>${esc(e.target_label)}</td><td>${esc(e.driver_name || 'percentuale fissa')}</td>
        <td class="num">${e.base_quantity_milli != null ? (e.base_quantity_milli / 1000).toLocaleString('it-IT') : '—'}</td>
        <td class="num">${(e.share_ppm / 10000).toLocaleString('it-IT', { maximumFractionDigits: 4 })}%</td><td class="num">${UI.euro(e.amount_cents)}</td></tr>`).join('')}</tbody>
    </table></div></details>` : ''}`;
}
async function runFinCascade(action) {
  const msg = document.getElementById('fin-cascade-msg');
  if (action === 'cancel' && !confirm(`Annullare la cascata di ${UI.monthLabel(FIN.period)}? Il mese si riapre e le quote non valgono più (restano nello storico).`)) return;
  if (action === 'rerun' && !confirm('Rieseguire la cascata con i dati attuali? Quella di adesso viene annullata e sostituita.')) return;
  try {
    const res = await api(`/api/admin/finance/cascade/${FIN.period}/${action}`, { method: 'POST' });
    if (action === 'simulate') { await finLoadCenters(); return loadFinCascade(res); }
    await loadFinCascade();
    UI.msg(document.getElementById('fin-cascade-msg'), action === 'cancel' ? 'Cascata annullata: il mese è di nuovo modificabile.' : 'Cascata confermata.', 'success');
  } catch (e) {
    UI.msg(msg, e.message);
  }
}
