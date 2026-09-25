// Portale → Magazzino → Registro (Fase 3): giacenze e valore a costo medio ponderato, movimenti, carichi e
// scarichi, degustazioni da confermare, inventario, foglio dei costi, controlli (anomalie e riconciliazione).
const STK = { view: 'giacenze', items: [], filter: '', movFilter: null };
const STK_VIEWS = [['giacenze', 'Giacenze e valore'], ['movimenti', 'Movimenti'], ['degustazioni', 'Degustazioni'], ['inventario', 'Inventario'], ['costi', 'Foglio dei costi'], ['controlli', 'Controlli']];
const STK_KIND_BADGE = { apertura: 'grey', carico_acquisto: 'green', carico_produzione: 'green', scarico_vendita: 'yellow', scarico_degustazione: 'yellow', scarico_omaggio: 'yellow',
  consumo_produzione: 'yellow', rettifica_inventario: 'red', trasferimento: 'grey', rivalutazione: 'grey' };
const stkQty = m => (m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 });
const stkCost = e4 => `€ ${(e4 / 10000).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const stkItemLabel = x => `${x.name}${x.vintage ? ` ${x.vintage}` : ''}`;
const stkItemKey = x => (x.product_id ? `p${x.product_id}` : `r${x.raw_item_id}`);

async function loadStockLedger() {
  const root = document.getElementById('mag-registro-root');
  const tabs = `<div class="rec-tabs" style="padding:0 22px">${STK_VIEWS.map(([k, l]) => `<button class="${STK.view === k ? 'active' : ''}" onclick="STK.view='${k}'; loadStockLedger()">${l}</button>`).join('')}</div>`;
  const head = (title, intro, extra = '') => `<div class="list-toolbar"><div class="list-toolbar-title"><h3>${title}</h3><p class="mod-intro">${intro}</p></div><div class="list-spacer"></div>${extra}</div>`;
  const actions = `<button class="btn secondary small" onclick="openStockLoadModal()">+ Carico</button><button class="btn secondary small" onclick="openStockIssueModal()">− Scarico</button>`;
  STK.items = await api('/api/admin/stock/items');
  let body = '';
  if (STK.view === 'giacenze') {
    const q = STK.filter.toLowerCase();
    const rows = STK.items.filter(x => !q || stkItemLabel(x).toLowerCase().includes(q) || (x.sku || '').toLowerCase().includes(q));
    const total = STK.items.reduce((s, x) => s + x.value_cents, 0);
    body = head('Giacenze e valore', `Valore delle rimanenze a costo medio ponderato: <b>${UI.euro(total)}</b>. Il disponibile è la giacenza meno la merce pagata online e non ancora ritirata.`,
      `<div class="mod-toolbar-fields"><input placeholder="Cerca articolo" value="${UI.attr(STK.filter)}" oninput="STK.filter = this.value; clearTimeout(STK.t); STK.t = setTimeout(loadStockLedger, 300)"></div>${actions}`)
      + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Articolo</th><th class="num">Giacenza</th><th class="num">Impegnata</th><th class="num">Disponibile</th><th class="num">Costo medio</th><th class="num">Valore</th><th></th></tr></thead><tbody>
        ${rows.map(x => `<tr class="mod-clickable" onclick="STK.view='movimenti'; STK.movFilter='${stkItemKey(x)}'; loadStockLedger()">
          <td><b>${esc(stkItemLabel(x))}</b>${x.sku ? `<br><span class="mod-note" style="margin:0">${esc(x.sku)}${x.kind === 'materia' ? ' · materia prima' : ''}</span>` : x.kind === 'materia' ? '<br><span class="mod-note" style="margin:0">materia prima</span>' : ''}</td>
          <td class="num" style="${x.qty_milli < 0 ? 'color:var(--bad);font-weight:600' : ''}">${stkQty(x.qty_milli)}</td><td class="num">${x.reserved_milli ? stkQty(x.reserved_milli) : '—'}</td>
          <td class="num">${stkQty(x.available_milli)}</td><td class="num">${x.qty_milli > 0 ? stkCost(x.avg_cost_e4) : '—'}</td><td class="num">${UI.euro(x.value_cents)}</td>
          <td>${x.qty_milli > 0 && !x.value_cents ? '<span class="badge yellow">senza costo</span>' : ''}${x.difference_milli ? ' <span class="badge red">non torna</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nessun articolo tracciato.</td></tr>'}
      </tbody></table></div>`;
  }
  if (STK.view === 'movimenti') {
    const [kind, id] = STK.movFilter ? [STK.movFilter[0], STK.movFilter.slice(1)] : [null, null];
    const rows = await api(`/api/admin/stock/movements${kind ? `?${kind === 'p' ? 'product_id' : 'raw_item_id'}=${id}` : ''}`);
    body = head('Movimenti', 'Il registro non si modifica: le correzioni sono storni. Ogni riga porta la giacenza e il valore dell\'articolo dopo il movimento.',
      `<div class="mod-toolbar-fields"><select onchange="STK.movFilter = this.value || null; loadStockLedger()"><option value="">Tutti gli articoli</option>${STK.items.map(x => `<option value="${stkItemKey(x)}" ${STK.movFilter === stkItemKey(x) ? 'selected' : ''}>${esc(stkItemLabel(x))}</option>`).join('')}</select></div>${actions}`)
      + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Data</th><th>Articolo</th><th>Movimento</th><th class="num">Quantità</th><th class="num">Costo unitario</th><th class="num">Valore</th><th class="num">Giacenza</th><th class="num">Valore giacenza</th><th></th></tr></thead><tbody>
        ${rows.map(m => `<tr style="${m.reverses_id ? 'opacity:.7' : ''}"><td>${UI.date(m.occurred_on)}</td><td>${esc(m.product_name ? `${m.product_name}${m.vintage ? ` ${m.vintage}` : ''}` : m.raw_name)}</td>
          <td><span class="badge ${STK_KIND_BADGE[m.kind]}">${esc(m.kind_label)}</span><br><span class="mod-note" style="margin:0">${esc([m.source_label, m.supplier_name, m.cost_object_code, m.reason].filter(Boolean).join(' · '))}</span></td>
          <td class="num" style="${m.quantity_milli < 0 ? 'color:var(--bad)' : ''}">${m.quantity_milli > 0 ? '+' : ''}${stkQty(m.quantity_milli)}</td><td class="num">${stkCost(m.unit_cost_e4)}</td>
          <td class="num">${UI.euro(m.value_cents)}</td><td class="num">${stkQty(m.balance_qty_milli)}</td><td class="num">${UI.euro(m.balance_value_cents)}</td>
          <td>${!m.reverses_id && ['carico_acquisto', 'carico_produzione', 'scarico_omaggio', 'scarico_degustazione', 'consumo_produzione'].includes(m.kind) && !m.tasting_line_id && !m.booking_id ? `<button class="btn-outline-pill" onclick="reverseStockMovement(${m.id})">Storna</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nessun movimento.</td></tr>'}
      </tbody></table></div>`;
  }
  if (STK.view === 'degustazioni') {
    const rows = await api('/api/admin/stock/tastings?status=proposta');
    body = head('Degustazioni da confermare', 'Al check-in di una visita si propongono i vini in degustazione (1 bottiglia per vino ogni 6 ospiti, modificabile per esperienza). Conferma le bottiglie aperte davvero: lo scarico va a costo dell\'esperienza.')
      + (rows.map(x => `<div class="mod-row"><div class="mod-row-main"><div class="mod-row-title">${esc(x.product_name)}${x.vintage ? ` ${esc(x.vintage)}` : ''} · ${esc(x.experience_name)}</div>
          <div class="mod-row-sub">${UI.date(x.date)} ${esc(x.time)} · ${esc(x.customer_name)} · ${x.guests} ospiti · proposte ${stkQty(x.suggested_milli)}</div></div>
          <input type="number" min="0" step="1" value="${x.suggested_milli / 1000}" id="stk-tasting-${x.id}" style="width:70px;height:34px;border:1px solid var(--line-strong);border-radius:4px;padding:0 8px">
          <div class="mod-row-actions"><button class="btn small" onclick="confirmTasting(${x.id})">Conferma</button><button class="btn secondary small" onclick="dismissTasting(${x.id})">Nessuna</button></div></div>`).join('')
        || '<div class="mod-empty">Nessuna degustazione da confermare.</div>');
  }
  if (STK.view === 'inventario') body = await stockCountView(head);
  if (STK.view === 'costi') {
    body = head('Foglio dei costi', 'Scarica il foglio con tutti gli articoli e la giacenza attuale, compila la colonna «Nuovo costo unitario (€)» e ricaricalo: la giacenza di oggi viene valorizzata a quel costo. I carichi successivi aggiornano il costo medio da soli.')
      + `<div class="mod-body"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn secondary small" onclick="UI.download('/api/admin/stock/cost-sheet')">Scarica il foglio</button>
          <input type="file" id="stk-cost-file" accept=".xlsx"><button class="btn small" onclick="uploadCostSheet()">Carica il foglio compilato</button></div>
        <div id="stk-cost-result" style="margin-top:14px"></div></div>`;
  }
  if (STK.view === 'controlli') {
    const [an, rec] = await Promise.all([api('/api/admin/stock/anomalies'), api('/api/admin/stock/reconciliation')]);
    const list = (title, rows, fmt) => `<div class="mod-section-title">${title} (${rows.length})</div>${rows.map(fmt).join('') || '<p class="mod-note" style="margin:0 0 8px">Nessuna.</p>'}`;
    body = head('Controlli', 'Durante la transizione il registro affianca le quantità di sempre: ogni notte si controlla che coincidano. Per passare al registro come unica fonte serve un periodo senza differenze.')
      + `<div class="mod-body">
        ${list('Differenze tra registro e quantità di oggi', rec.differences, d => `<div class="mod-anomaly">${esc(stkItemLabel(d))}: quantità ${d.warehouse_qty}, registro ${stkQty(d.available_milli)} disponibili</div>`)}
        ${list('Giacenze sotto zero', an.negative, d => `<div class="mod-anomaly">${esc(stkItemLabel(d))}: ${stkQty(d.qty_milli)}</div>`)}
        ${list('Articoli con giacenza ma senza costo', an.without_cost, d => `<div class="mod-warn" style="margin:0 0 6px">${esc(stkItemLabel(d))}: ${stkQty(d.qty_milli)} a costo zero (compila il foglio dei costi)</div>`)}
        ${list('Righe d\'ordine evase senza prodotto', an.unmatched_order_lines, l => `<div class="mod-warn" style="margin:0 0 6px">Ordine ${esc(l.order_number || `n. ${l.order_id}`)}: ${l.quantity}× «${esc(l.product_name_raw || '—')}» non è uscito dal magazzino</div>`)}
      </div>`;
  }
  root.innerHTML = `<div class="list-card">${tabs}${body}</div>`;
}
// Scelta dell'articolo: prodotti tracciati e materie prime insieme.
const stkItemOptions = () => STK.items.map(x => `<option value="${stkItemKey(x)}">${esc(stkItemLabel(x))}${x.kind === 'materia' ? ' (materia prima)' : ''}</option>`).join('');
const stkItemBody = key => (key[0] === 'p' ? { product_id: Number(key.slice(1)) } : { raw_item_id: Number(key.slice(1)) });
async function stkCostObjects() {
  try { return (await api('/api/admin/hr/timesheet/options')).objects; } catch { return []; }
}
async function openStockLoadModal() {
  if (!STK.items.length) STK.items = await api('/api/admin/stock/items');
  const suppliers = await api('/api/admin/suppliers').catch(() => []);
  UI.modal({
    id: 'stk-load-modal', title: 'Carico di magazzino', width: 580,
    body: `<div class="field-row"><div class="field"><label>Tipo</label><select name="kind"><option value="carico_acquisto">Acquisto</option><option value="carico_produzione">Produzione (imbottigliamento)</option></select></div>
        <div class="field"><label>Articolo</label><select name="item">${stkItemOptions()}</select></div></div>
      <div class="field-row"><div class="field"><label>Quantità</label><input name="quantity" inputmode="decimal"></div><div class="field"><label>Costo unitario (€)</label><input name="unit_cost" inputmode="decimal" placeholder="es. 4,35"></div></div>
      <div class="field-row"><div class="field"><label>Fornitore</label><select name="supplier_id"><option value="">—</option>${(Array.isArray(suppliers) ? suppliers : suppliers.items || []).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>N. documento</label><input name="doc_number"></div><div class="field"><label>Data documento</label><input type="date" name="doc_date"></div></div>
      <div class="field"><label>Nota</label><input name="note" placeholder="es. imbottigliamento lotto 24/03"></div>
      <p class="mod-note">Il costo del carico entra nel costo medio. Per la produzione, finché non c'è il costo del lotto (Fase 4), indica il costo per bottiglia che conosci.</p>`,
    onSave: async b => {
      const body = { ...stkItemBody(UI.val(b, 'item')) };
      for (const k of ['kind', 'quantity', 'unit_cost', 'supplier_id', 'doc_number', 'doc_date', 'note']) body[k] = UI.val(b, k) || null;
      await api('/api/admin/stock/loads', { method: 'POST', body: JSON.stringify(body) });
      loadStockLedger();
    },
  });
}
async function openStockIssueModal() {
  if (!STK.items.length) STK.items = await api('/api/admin/stock/items');
  const objects = await stkCostObjects();
  UI.modal({
    id: 'stk-issue-modal', title: 'Scarico di magazzino', width: 560,
    body: `<div class="field-row"><div class="field"><label>Tipo</label><select name="kind"><option value="scarico_omaggio">Omaggio</option><option value="scarico_degustazione">Degustazione (fuori dalle visite)</option><option value="consumo_produzione">Consumo in produzione</option></select></div>
        <div class="field"><label>Articolo</label><select name="item">${stkItemOptions()}</select></div></div>
      <div class="field-row"><div class="field"><label>Quantità</label><input name="quantity" inputmode="decimal"></div>
        <div class="field"><label>A carico di (facoltativo)</label><select name="cost_object_id"><option value="">—</option>${objects.map(o => `<option value="${o.id}">${esc(o.code)} ${esc(o.name)} (${esc(o.type)})</option>`).join('')}</select></div></div>
      <div class="field"><label>Motivo</label><input name="reason" placeholder="es. omaggio al buyer in fiera, bottiglia rotta"></div>
      <p class="mod-note">Le vendite (cassa, ritiri, B2B) scaricano da sole. Per rotture e differenze di conteggio usa l'inventario o la rettifica in Prodotti finiti.</p>`,
    onSave: async b => {
      const body = { ...stkItemBody(UI.val(b, 'item')) };
      for (const k of ['kind', 'quantity', 'cost_object_id', 'reason']) body[k] = UI.val(b, k) || null;
      await api('/api/admin/stock/issues', { method: 'POST', body: JSON.stringify(body) });
      loadStockLedger();
    },
  });
}
function reverseStockMovement(id) {
  UI.modal({ id: 'stk-rev-modal', title: 'Storna il movimento', width: 440, saveLabel: 'Storna', body: '<div class="field"><label>Motivo</label><input name="reason"></div>',
    onSave: async b => { await api(`/api/admin/stock/movements/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason: UI.val(b, 'reason') }) }); loadStockLedger(); } });
}
async function confirmTasting(id) {
  try { await api(`/api/admin/stock/tastings/${id}/confirm`, { method: 'POST', body: JSON.stringify({ quantity: document.getElementById(`stk-tasting-${id}`).value }) }); loadStockLedger(); } catch (e) { alert(e.message); }
}
async function dismissTasting(id) {
  try { await api(`/api/admin/stock/tastings/${id}/dismiss`, { method: 'POST', body: JSON.stringify({}) }); loadStockLedger(); } catch (e) { alert(e.message); }
}
async function uploadCostSheet() {
  const f = document.getElementById('stk-cost-file').files[0];
  const out = document.getElementById('stk-cost-result');
  if (!f) { out.innerHTML = '<div class="msg error">Scegli il foglio compilato.</div>'; return; }
  const fd = new FormData();
  fd.append('file', f);
  try {
    const res = await api('/api/admin/stock/cost-sheet', { method: 'POST', body: fd });
    out.innerHTML = `<div class="mod-ok">${res.done.length} articoli valorizzati.</div>${res.skipped.length ? `<div class="mod-warn">${res.skipped.map(s => `Riga ${s.row} (${esc(s.name)}): ${esc(s.reason)}`).join('<br>')}</div>` : ''}`;
  } catch (e) { out.innerHTML = `<div class="msg error">${esc(e.message)}</div>`; }
}

// ── Inventario ─────────────────────────────────────────────────────────────────
async function stockCountView(head) {
  const counts = await api('/api/admin/stock/counts');
  const open = counts.find(c => c.status === 'bozza');
  if (!open) {
    return head('Inventario', 'Si contano le bottiglie e le materie prime; alla conferma il sistema crea le rettifiche per le differenze con la giacenza di quel momento.',
      '<button class="btn small" onclick="startStockCount()">Inizia un inventario</button>')
      + (counts.map(c => `<div class="mod-row"><div class="mod-row-main"><div class="mod-row-title">Inventario del ${UI.date(c.counted_on)}</div><div class="mod-row-sub">${c.lines} articoli · ${esc(c.confirmed_by || c.created_by || '')}${c.note ? ` · ${esc(c.note)}` : ''}</div></div>
        <span class="badge ${c.status === 'confermato' ? 'green' : 'grey'}">${c.status}</span></div>`).join('') || '<div class="mod-empty">Nessun inventario.</div>');
  }
  const c = await api(`/api/admin/stock/counts/${open.id}`);
  return head(`Inventario del ${UI.date(c.counted_on)} — in corso`, 'Scrivi le quantità contate (lascia vuoto ciò che non hai contato). Alla conferma, la differenza con la giacenza di quel momento diventa una rettifica con il motivo.',
    `<button class="btn secondary small" onclick="saveStockCount(${c.id}, false)">Salva</button><button class="btn small" onclick="saveStockCount(${c.id}, true)">Conferma</button><button class="btn-outline-pill danger" onclick="cancelStockCount(${c.id})">Annulla</button>`)
    + `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Articolo</th><th class="num">Giacenza ora</th><th class="num">Contato</th><th>Motivo della differenza</th></tr></thead><tbody>
      ${c.lines.map(l => `<tr><td>${esc(l.product_name ? `${l.product_name}${l.vintage ? ` ${l.vintage}` : ''}` : l.raw_name)}</td><td class="num">${stkQty(l.current_milli)}</td>
        <td class="num"><input data-count="${l.id}" inputmode="decimal" value="${l.counted_qty_milli != null ? l.counted_qty_milli / 1000 : ''}" style="width:80px;text-align:right"></td>
        <td><input data-reason="${l.id}" value="${UI.attr(l.reason)}" placeholder="es. rotture, cali" style="width:100%"></td></tr>`).join('')}
    </tbody></table></div>`;
}
async function startStockCount() {
  try { await api('/api/admin/stock/counts', { method: 'POST', body: JSON.stringify({}) }); loadStockLedger(); } catch (e) { alert(e.message); }
}
async function saveStockCount(id, confirmIt) {
  const lines = [...document.querySelectorAll('[data-count]')].map(i => ({ id: Number(i.dataset.count), counted: UI.num(i.value), reason: document.querySelector(`[data-reason="${i.dataset.count}"]`).value }));
  try {
    await api(`/api/admin/stock/counts/${id}/lines`, { method: 'PUT', body: JSON.stringify({ lines }) });
    if (confirmIt) {
      if (!confirm('Confermare l\'inventario? Le differenze diventano rettifiche di magazzino.')) return;
      const res = await api(`/api/admin/stock/counts/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
      alert(`Inventario confermato: ${res.adjusted} ${res.adjusted === 1 ? 'rettifica' : 'rettifiche'}.`);
    }
    loadStockLedger();
  } catch (e) { alert(e.message); }
}
function cancelStockCount(id) { UI.confirmDo('Annullare l\'inventario in corso?', () => api(`/api/admin/stock/counts/${id}/cancel`, { method: 'POST' }), loadStockLedger); }
