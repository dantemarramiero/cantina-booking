// Pagina da campo (smartphone e tablet in vigneto): interventi e trattamenti in pochi tocchi, anche senza rete.
// Senza rete si salva una bozza sul dispositivo con un identificativo unico (client_uuid): quando torna la rete
// parte da sola e il server la accetta una volta sola. La conferma avviene online, perché i controlli
// (patentino, dosi, carenze, biologico) hanno bisogno dei dati del server. Testi in prd-i18n.js (campo.*).
// L'accesso dura quanto l'app aperta (sessionStorage). Riaperta in vigneto senza rete, si lavora in bozza con i
// dati dell'ultimo aggiornamento e si invia dopo l'accesso. Ogni bozza porta chi l'ha scritta: parte solo con lui.
const C = {
  token: sessionStorage.getItem('campo_key') || null,
  user: localStorage.getItem('campo_user') || null,
  data: JSON.parse(localStorage.getItem('campo_data') || 'null'),
  queue: JSON.parse(localStorage.getItem('campo_queue') || '[]'),
  form: null,
};
const API = '/api/admin/prd';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const saveQueue = () => localStorage.setItem('campo_queue', JSON.stringify(C.queue));
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const ha = m2 => (m2 / 10000).toLocaleString('it-IT', { maximumFractionDigits: 4 });
// Numeri come li legge il server: la virgola è decimale; «1.250» (gruppi di tre) è milleduecentocinquanta; «0.5»
// (il punto delle tastiere dei telefoni) è mezzo.
const num = s => {
  const t = String(s ?? '').replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(/^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t);
};
const fromHa = s => Math.round(num(s) * 10000);
const isMine = q => !q.user || q.user === C.user;
const itDate = d => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('it-IT') : '');

async function call(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(C.token ? { 'x-admin-key': C.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { C.token = null; sessionStorage.removeItem('campo_key'); showLogin(); throw Object.assign(new Error(T('campo.sessione')), { status: 401 }); }
  if (!res.ok) throw Object.assign(new Error(data.error || `Errore ${res.status}`), { status: res.status, data });
  return data;
}

// ── Rete, dati sul dispositivo, invio delle bozze ─────────────────────────────
function netBadge() {
  const on = navigator.onLine;
  $('campo-net').className = `net${on ? '' : ' off'}`;
  const mine = C.queue.filter(isMine).length;
  $('campo-net').textContent = `${on ? T('campo.online') : T('campo.offline')}${mine ? ` · ${mine} ${T('campo.daInviare')}` : ''}`;
  document.querySelectorAll('[data-online]').forEach(b => { b.disabled = !on; });
}
async function refreshData() {
  if (!navigator.onLine || !C.token) return;
  const [catalog, parcels, states, equipment, phyto, people, recent] = await Promise.all([
    call('GET', `${API}/catalog`), call('GET', `${API}/parcels`), call('GET', `${API}/parcel-states`), call('GET', `${API}/equipment`),
    call('GET', `${API}/phyto-products`), call('GET', '/api/admin/hr/directory'), call('GET', `${API}/interventions?status=confirmed`),
  ]);
  C.data = { catalog, parcels: parcels.filter(p => p.active), states, equipment, phyto, people, last: recent.slice(0, 5), updated_at: new Date().toISOString() };
  localStorage.setItem('campo_data', JSON.stringify(C.data));
}
async function syncQueue() {
  if (!navigator.onLine || !C.token || !C.queue.length) return;
  for (const item of C.queue.filter(isMine)) {
    try {
      await call('POST', `${API}/interventions`, { ...item.body, client_uuid: item.client_uuid });
      C.queue = C.queue.filter(x => x.client_uuid !== item.client_uuid);
    } catch (e) {
      // Sessione scaduta o rete di nuovo giù: le bozze restano in coda per il prossimo giro.
      if (e.status === 401 || !e.status) return;
      item.error = e.message;
    }
    saveQueue();
  }
  netBadge();
}
window.addEventListener('online', async () => {
  netBadge();
  if (!C.token) { if (!C.form) showLogin(C.queue.some(isMine) ? T('campo.accediPerInviare') : '', 'warn'); return; }
  await syncQueue();
  await refreshData().catch(() => {});
  if (!C.form) showHome();
});
window.addEventListener('offline', netBadge);

// ── Accesso ─────────────────────────────────────────────────────────────────
function showLogin(msg = '', kind = 'error') {
  $('campo').innerHTML = `<div class="card"><h2>${esc(T('campo.accedi'))}</h2>${msg ? `<div class="msg ${kind}">${esc(msg)}</div>` : ''}
    <label>${esc(T('campo.utente'))}</label><input id="l-user" autocomplete="username">
    <label>${esc(T('campo.password'))}</label><input id="l-pass" type="password" autocomplete="current-password">
    <div style="margin-top:14px"><button class="big" onclick="login()">${esc(T('campo.entra'))}</button></div>
    <p class="muted">${esc(T('campo.accessoAiuto'))}</p></div>`;
}
async function login() {
  try {
    const username = $('l-user').value.trim();
    const r = await call('POST', '/api/portal-users/login', { username, password: $('l-pass').value });
    // Un'altra persona sullo stesso telefono: i dati dell'ultimo utente non restano; le sue bozze sì, ma partono solo con lui.
    if (C.user && C.user !== username.toLowerCase()) { C.data = null; localStorage.removeItem('campo_data'); }
    C.user = username.toLowerCase();
    localStorage.setItem('campo_user', C.user);
    C.token = r.key;
    sessionStorage.setItem('campo_key', r.key);
    await start();
  } catch (e) { showLogin(e.message); }
}
// Uscendo, le anagrafiche (persone comprese) non restano sul telefono; le bozze non inviate sì, per il prossimo accesso.
async function logout() {
  const mine = C.queue.filter(isMine).length;
  if (mine && !confirm(T('campo.esciConBozze', { n: mine }))) return;
  if (navigator.onLine) await call('POST', '/api/admin/logout').catch(() => {});
  C.token = null;
  sessionStorage.removeItem('campo_key');
  C.data = null;
  localStorage.removeItem('campo_data');
  showLogin();
}

// ── Home ────────────────────────────────────────────────────────────────────
const QUICK = ['trattamento', 'potatura_verde', 'sfogliatura', 'diradamento', 'lavorazione_suolo', 'sfalcio', 'concimazione', 'campionamento', 'vendemmia', 'potatura_secca', 'monitoraggio', 'altro'];
function typeLabel(t) { return C.data?.catalog?.labels?.intervention_type?.[t] || t; }
function showHome(message = '') {
  C.form = null;
  netBadge();
  if (!C.data) { $('campo').innerHTML = `<div class="card"><div class="msg warn">${esc(T('campo.nessunDato'))}</div></div>`; return; }
  const last = C.data.last?.[0];
  $('campo').innerHTML = `${message}
    ${C.queue.length ? `<div class="card"><h2>${esc(T('campo.bozzeInCoda'))}</h2>${C.queue.map(q => `<div class="muted">• ${esc(typeLabel(q.body.type))} ${esc(q.body.started_at.replace('T', ' '))}${isMine(q) ? '' : ` · ${esc(T('campo.diAltri', { user: q.user }))}`}${q.error && isMine(q) ? ` <span class="badge red">${esc(q.error)}</span>
      <div class="row" style="margin:6px 0 10px"><button class="sec" onclick="editQueued('${esc(q.client_uuid)}')">${esc(T('campo.correggi'))}</button><button class="sec" onclick="dropQueued('${esc(q.client_uuid)}')">${esc(T('campo.scarta'))}</button></div>` : ''}</div>`).join('')}
      <div style="margin-top:10px"><button class="sec big" onclick="syncQueue().then(() => showHome())" data-online ${navigator.onLine ? '' : 'disabled'}>${esc(T('campo.inviaOra'))}</button></div></div>` : ''}
    ${last ? `<button class="sec big" style="margin-bottom:14px" onclick="repeatLast(${last.id})">${esc(T('campo.ripeti'))}: ${esc(typeLabel(last.type))} · ${esc(itDate(last.work_date))} · ${esc(last.parcel_codes.join(', '))}</button>` : ''}
    <div class="grid">${QUICK.map(t => `<button class="tile" onclick="openForm('${t}')">${esc(typeLabel(t))}</button>`).join('')}</div>
    <p class="muted" style="margin-top:16px">${esc(T('campo.aggiornato'))} ${esc(new Date(C.data.updated_at).toLocaleString('it-IT'))}</p>
    ${C.token ? `<button class="sec" onclick="logout()">${esc(T('campo.esci'))}</button>` : ''}`;
}

// ── Modulo ──────────────────────────────────────────────────────────────────
function openForm(type, prefill = null) {
  const f = prefill || { type, started_at: nowLocal(), parcels: [], workers: [], equipment_ids: [], treatment: { target_pest: '', products: [] } };
  C.form = f;
  const states = new Map((C.data.states || []).map(s => [s.id, s]));
  const chosen = new Map(f.parcels.map(p => [p.parcel_id, p.area_m2]));
  const isTreat = f.type === 'trattamento';
  const parcelRows = C.data.parcels.map(p => {
    const s = states.get(p.id) || {};
    const badges = `${s.preharvest_active ? `<span class="badge red">${esc(T('campo.carenza'))} ${esc(itDate(s.preharvest_ends_on))}</span>` : ''}${s.reentry_active ? `<span class="badge red">${esc(T('campo.rientro'))}</span>` : ''}`;
    return `<div class="pick ${chosen.has(p.id) ? 'on' : ''}" data-name="${esc(`${p.code} ${p.name || ''} ${p.vineyard_name || ''}`.toLowerCase())}">
      <input type="checkbox" data-parcel="${p.id}" ${chosen.has(p.id) ? 'checked' : ''} onchange="this.closest('.pick').classList.toggle('on', this.checked)">
      <div class="grow"><b>${esc(p.code)}</b> ${esc(p.name || '')}${badges}<div class="muted">${esc(p.vineyard_name || '')} · ${esc(ha(p.vine_area_m2))} ha</div></div>
      <input class="area" data-area="${p.id}" inputmode="decimal" value="${esc(ha(chosen.get(p.id) ?? p.vine_area_m2))}" aria-label="ettari"></div>`;
  }).join('');
  const people = C.data.people.map(e => `<label class="pick"><input type="checkbox" data-worker="${e.id}" ${f.workers.some(w => w.employee_id === e.id) ? 'checked' : ''}><span class="grow">${esc(`${e.first_name} ${e.last_name}`)}</span></label>`).join('');
  const equipment = C.data.equipment.map(q => `<label class="pick"><input type="checkbox" data-equip="${q.id}" ${f.equipment_ids.includes(q.id) ? 'checked' : ''}><span class="grow">${esc(q.name)}${q.inspection_expired ? ` <span class="badge red">${esc(T('campo.controlloScaduto'))}</span>` : ''}</span></label>`).join('');
  $('campo').innerHTML = `<div class="card"><h2>${esc(typeLabel(f.type))}</h2>
      <div class="row"><div><label>${esc(T('f.started_at'))}</label><input type="datetime-local" id="f-start" value="${esc(f.started_at)}"></div>
        <div><label>${esc(T('f.ended_at'))}</label><input type="datetime-local" id="f-end" value="${esc(f.ended_at || '')}"></div></div>
      ${isTreat ? `<label>${esc(T('f.bbch_stage'))}</label><input id="f-bbch" inputmode="numeric" value="${esc(f.bbch_stage || '')}">` : ''}</div>
    <div class="card"><h2>${esc(T('f.parcels'))} <span class="muted">(ha)</span></h2><input placeholder="${esc(T('btn.cerca'))}" oninput="filterParcels(this.value)" style="margin-bottom:10px">${parcelRows}</div>
    <div class="card"><h2>${esc(T('f.workers'))}</h2>${people || `<p class="muted">${esc(T('msg.vuoto'))}</p>`}</div>
    ${isTreat ? `<div class="card"><h2>${esc(T('f.equipment'))}</h2>${equipment || `<p class="muted">${esc(T('msg.vuoto'))}</p>`}</div>
      <div class="card"><h2>${esc(T('f.products'))}</h2><label>${esc(T('f.target_pest'))}</label><input id="f-pest" value="${esc(f.treatment?.target_pest || '')}">
        <div id="f-products">${(f.treatment?.products || []).map(productRow).join('')}</div>
        <button class="sec big" style="margin-top:10px" onclick="$('f-products').insertAdjacentHTML('beforeend', productRow())">${esc(T('btn.aggiungiProdotto'))}</button></div>` : ''}
    <div class="card"><label>${esc(T('f.notes'))}</label><textarea id="f-notes" rows="2">${esc(f.notes || '')}</textarea></div>
    <div id="f-msg"></div>
    <div class="sticky-actions"><button class="sec" onclick="showHome()">${esc(T('campo.annulla'))}</button><button class="sec" onclick="saveForm(false)">${esc(T('btn.salvaBozza'))}</button>
      <button onclick="saveForm(true)" data-online ${navigator.onLine ? '' : 'disabled'} title="${esc(T('campo.confermaOnline'))}">${esc(T('btn.conferma'))}</button></div>`;
  window.scrollTo(0, 0);
}
// Una bozza in coda rifiutata dal portale (es. rientro in corso, dati mancanti) si riapre nel modulo:
// salvandola, quella vecchia esce dalla coda. Non essendo arrivata al portale, si può anche scartare.
function editQueued(uuid) {
  const q = C.queue.find(x => x.client_uuid === uuid);
  if (!q) return;
  openForm(q.body.type, { parcels: [], workers: [], equipment_ids: [], treatment: { target_pest: '', products: [] }, ...q.body, queued: uuid });
}
function dropQueued(uuid) {
  if (!confirm(T('campo.scartaConferma'))) return;
  C.queue = C.queue.filter(x => x.client_uuid !== uuid);
  saveQueue();
  showHome();
}
function productRow(p = {}) {
  const opts = C.data.phyto.map(x => `<option value="${x.id}" ${x.id === p.phyto_product_id ? 'selected' : ''}>${esc(x.commercial_name)} · ${esc(x.registration_number)}</option>`).join('');
  return `<div class="card" style="padding:10px;margin:10px 0 0" data-prodrow><select data-p="id"><option value="">—</option>${opts}</select>
    <div class="row"><div><label>${esc(T('f.dose_ha'))}</label><input data-p="dose" inputmode="decimal" value="${esc(p.dose_per_ha ?? '')}"></div>
      <div><label>${esc(T('f.total_quantity'))}</label><input data-p="total" inputmode="decimal" value="${esc(p.total_quantity ?? '')}" placeholder="${esc(T('campo.totaleAuto'))}"></div></div></div>`;
}
function filterParcels(q) {
  const s = q.trim().toLowerCase();
  document.querySelectorAll('.pick[data-name]').forEach(el => { el.style.display = !s || el.dataset.name.includes(s) ? '' : 'none'; });
}
function collect() {
  const f = C.form;
  const parcels = [...document.querySelectorAll('[data-parcel]:checked')].map(c => ({ parcel_id: Number(c.dataset.parcel), area_m2: fromHa(document.querySelector(`[data-area="${c.dataset.parcel}"]`).value) }));
  const body = { type: f.type, started_at: $('f-start').value, ended_at: $('f-end').value || null, notes: $('f-notes').value.trim(), parcels,
    workers: [...document.querySelectorAll('[data-worker]:checked')].map(c => ({ employee_id: Number(c.dataset.worker) })) };
  if (f.type === 'trattamento') {
    const areaHa = parcels.reduce((s, p) => s + p.area_m2, 0) / 10000;
    body.bbch_stage = $('f-bbch').value.trim();
    body.equipment_ids = [...document.querySelectorAll('[data-equip]:checked')].map(c => Number(c.dataset.equip));
    body.treatment = { target_pest: $('f-pest').value.trim(), products: [...document.querySelectorAll('[data-prodrow]')].filter(r => r.querySelector('[data-p="id"]').value).map(r => {
      const dose = r.querySelector('[data-p="dose"]').value.trim();
      const total = r.querySelector('[data-p="total"]').value.trim();
      // Quantità totale non scritta = dose × ettari lavorati.
      const auto = dose && areaHa && Number.isFinite(num(dose)) ? String(+(num(dose) * areaHa).toFixed(3)).replace('.', ',') : '';
      return { phyto_product_id: Number(r.querySelector('[data-p="id"]').value), dose_per_ha: dose, total_quantity: total || auto };
    }) };
  }
  return body;
}
async function saveForm(confirmIt) {
  const body = collect();
  const client_uuid = uuid();
  const msg = $('f-msg');
  const queued = C.form?.queued;
  const leaveQueue = () => { if (queued) { C.queue = C.queue.filter(x => x.client_uuid !== queued); saveQueue(); } };
  const keepOnDevice = () => {
    leaveQueue();
    C.queue.push({ client_uuid, body, user: C.user, created_at: new Date().toISOString() });
    saveQueue();
    return showHome(`<div class="msg warn">${esc(T('campo.salvataOffline'))}</div>`);
  };
  if (!navigator.onLine) return keepOnDevice();
  try {
    try {
      await call('POST', `${API}/interventions`, { ...body, client_uuid, confirm: confirmIt });
    } catch (e) {
      if (e.data?.code !== 'reentry') throw e;
      const reason = prompt(`${e.message}\n\n${T('msg.motivoDpi')}`, '');
      if (!reason) throw e;
      // Il primo invio è stato rifiutato (niente salvato): stesso client_uuid; il motivo resta anche se la bozza va in coda.
      body.reentry_override_reason = reason;
      await call('POST', `${API}/interventions`, { ...body, client_uuid, confirm: confirmIt });
    }
    leaveQueue();
    await refreshData().catch(() => {});
    showHome(`<div class="msg ok">${esc(confirmIt ? T('campo.confermato') : T('campo.salvataBozza'))}</div>`);
  } catch (e) {
    if (e.status === 401) { keepOnDevice(); return showLogin(T('campo.sessioneBozza'), 'warn'); }
    // Rete caduta durante l'invio: resta sul dispositivo; stesso client_uuid, quindi niente doppioni se era arrivata.
    if (!e.status) return keepOnDevice();
    msg.innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
    msg.scrollIntoView({ behavior: 'smooth' });
  }
}
async function repeatLast(id) {
  if (!navigator.onLine) return;
  try {
    const i = await call('GET', `${API}/interventions/${id}`);
    openForm(i.type, { type: i.type, started_at: nowLocal(), bbch_stage: i.bbch_stage, notes: '', parcels: i.parcels.map(p => ({ parcel_id: p.parcel_id, area_m2: p.area_m2 })),
      workers: i.workers.map(w => ({ employee_id: w.employee_id })), equipment_ids: i.equipment.map(q => q.id),
      treatment: i.treatment ? { target_pest: i.treatment.target_pest, products: i.treatment.products.map(p => ({ phyto_product_id: p.phyto_product_id,
        dose_per_ha: p.dose_per_ha_e4 == null ? '' : String(p.dose_per_ha_e4 / 10000).replace('.', ','), total_quantity: '' })) } : null });
  } catch (e) { alert(e.message); }
}

async function start() {
  $('campo-title').textContent = T('campo.titolo');
  netBadge();
  if (!C.token) {
    if (!navigator.onLine && C.data && C.user) return showHome(`<div class="msg warn">${esc(T('campo.senzaAccesso'))}</div>`);
    return showLogin(C.queue.some(isMine) ? T('campo.accediPerInviare') : '', 'warn');
  }
  try { await syncQueue(); await refreshData(); } catch (e) { if (e.status === 401) return; }
  showHome();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw-campo.js', { scope: '/campo' }).catch(() => {});
start();
