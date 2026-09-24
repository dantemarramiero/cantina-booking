// Portale → People (blocco 2E): «Il mio spazio» per ogni utente, richieste di modifica dei dati per HR,
// sezione «Ingresso e uscita» della scheda (checklist e dotazioni), cedolini in blocco, stagionali,
// configurazione delle checklist.
const SVC_ASSETS = { chiavi: 'Chiavi', badge: 'Badge', telefono: 'Telefono', pc: 'PC', tablet: 'Tablet', auto: 'Auto aziendale', abbigliamento: 'Abbigliamento', altro: 'Altro' };
const SVC_FIELDS = {
  iban: 'IBAN', residence_address: 'Indirizzo di residenza', residence_postal_code: 'CAP', residence_city: 'Comune', residence_province: 'Provincia', domicile: 'Domicilio',
  personal_email: 'Email personale', personal_phone: 'Telefono personale', size_shirt: 'Taglia maglia', size_pants: 'Taglia pantaloni', size_shoes: 'Numero di scarpe',
};
const SVC_ITEM_TYPES = { dati: 'Dati personali', documento: 'Documento', formazione: 'Formazione', visita: 'Visita medica', dpi: 'DPI', bene: 'Dotazioni', accesso: 'Accesso al portale',
  restituzione: 'Restituzione dotazioni', cessazione: 'Cessazione', saldi: 'Saldi', presenze: 'Presenze', altro: 'Altro' };
const SVC_REQ = { richiesta: ['yellow', 'In attesa'], approvata: ['green', 'Approvata'], rifiutata: ['red', 'Non accolta'], ritirata: ['grey', 'Ritirata'] };
const ME = { tab: 'dati', data: null };

// ── Il mio spazio ──────────────────────────────────────────────────────────────
function openMySpace(tab) {
  document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
  document.getElementById('module-me').classList.add('active');
  document.getElementById('topbar-title').textContent = 'Il mio spazio';
  document.getElementById('mobile-section-tabs').innerHTML = '';
  if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
  if (tab) ME.tab = tab;
  loadMySpace();
}
async function loadMySpace() {
  const root = document.getElementById('me-root');
  try { ME.data = await api('/api/admin/hr/me'); } catch (e) {
    root.innerHTML = `<div class="list-card"><div class="mod-empty">${esc(e.message)}</div></div>`;
    return;
  }
  const d = ME.data;
  const tabs = [['dati', 'I miei dati'], ['documenti', 'Documenti'], ['assenze', 'Ferie e permessi'], ['presenze', 'Presenze'], ['dotazioni', 'Dotazioni']];
  root.innerHTML = `<div class="list-card">
    <div class="rec-head"><div class="rec-avatar">${esc(d.employee.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase())}</div>
      <div style="flex:1"><div class="rec-name">${esc(d.employee.name)}</div><div class="rec-sub">Il tuo fascicolo, i tuoi documenti, le tue ferie e le tue ore.</div></div></div>
    <div class="rec-tabs">${tabs.map(([k, l]) => `<button class="${ME.tab === k ? 'active' : ''}" onclick="ME.tab='${k}'; loadMySpace()">${l}</button>`).join('')}</div>
    <div class="mod-body" id="me-body"></div>
  </div>`;
  const body = document.getElementById('me-body');
  if (ME.tab === 'dati') body.innerHTML = meTabData(d);
  if (ME.tab === 'documenti') body.innerHTML = d.file.documents.length ? d.file.documents.filter(x => x.current).map(x => `<div class="dl-item">
      <div class="mod-row-main"><div class="mod-row-title">${esc(x.title)}</div><div class="mod-row-sub">${esc(x.type_name)}${x.doc_date ? ` · ${UI.date(x.doc_date)}` : ''}</div></div>
      <a class="btn secondary small" href="${UI.attr(x.download_url)}">Scarica</a></div>`).join('') : '<div class="mod-empty">Nessun documento per ora.</div>';
  if (ME.tab === 'dotazioni') body.innerHTML = d.assets.map(a => `<div class="dl-item" style="${a.returned_on ? 'opacity:.55' : ''}"><div class="mod-row-main"><div class="mod-row-title">${esc(a.description)}</div>
      <div class="mod-row-sub">${esc(SVC_ASSETS[a.kind])} · consegnata il ${UI.date(a.delivered_on)}${a.returned_on ? ` · restituita il ${UI.date(a.returned_on)}` : ''}</div></div></div>`).join('') || '<div class="mod-empty">Nessuna dotazione.</div>';
  if (ME.tab === 'assenze') {
    const [bal, list] = await Promise.all([api('/api/admin/hr/absences/balances'), api(`/api/admin/hr/absences?employee_id=${d.employee.id}`)]);
    body.innerHTML = `<div class="mod-section-title">Saldi ${bal.year}</div>
      ${bal.balances.filter(b => b.annual || b.opening || b.taken || b.planned).map(b => `<div class="dl-item"><div class="mod-row-main"><div class="mod-row-title">${esc(ABS_COUNTERS[b.counter])}: ${absAmount(b.remaining, b.unit)} residui</div>
        <div class="mod-row-sub">goduti ${absAmount(b.taken, b.unit)} · pianificati ${absAmount(b.planned, b.unit)}${b.pending ? ` · in attesa ${absAmount(b.pending, b.unit)}` : ''}</div></div></div>`).join('') || '<p class="mod-note">Nessuna spettanza impostata.</p>'}
      ${bal.arrears.length ? `<div class="mod-warn" style="margin-top:10px">Ferie arretrate: ${bal.arrears.map(v => `${v.year} — ${absAmount(v.amount, 'giorni')} entro il ${UI.date(v.due_date)}`).join('; ')}.</div>` : ''}
      <div class="mod-section-title" style="margin-top:22px">Le mie richieste</div>
      <div class="list-card" style="margin:0;box-shadow:none">${list.map(a => absRow(a, { withName: false })).join('') || '<div class="mod-empty">Nessuna assenza.</div>'}</div>
      <button class="btn small" style="margin-top:10px" onclick="openAbsenceModal(ME.data.employee.id)">+ Chiedi ferie o permesso</button>`;
  }
  if (ME.tab === 'presenze') {
    body.innerHTML = '<div id="me-presenze-root"></div>';
    TS.root = 'me-presenze-root';
    TS.employeeId = d.employee.id;
    await tsOptions(true);
    loadTsSheet();
  }
}
function meTabData(d) {
  const p = d.file.personal?.data || {};
  const pending = d.change_requests.find(c => c.status === 'richiesta');
  const row = (label, v) => `<dt>${label}</dt><dd>${esc(v || '—')}</dd>`;
  return `<dl class="mod-kv">
      ${row('Codice fiscale', p.fiscal_code)}${row('Data di nascita', p.birth_date ? UI.date(p.birth_date) : null)}
      ${row('Residenza', [p.residence_address, p.residence_postal_code, p.residence_city, p.residence_province].filter(Boolean).join(', '))}${row('Domicilio', p.domicile)}
      ${row('Email personale', p.personal_email)}${row('Telefono personale', p.personal_phone)}${row('IBAN', p.iban)}
      ${row('Taglie', [p.size_shirt && `maglia ${p.size_shirt}`, p.size_pants && `pantaloni ${p.size_pants}`, p.size_shoes && `scarpe ${p.size_shoes}`].filter(Boolean).join(' · '))}
      <dt>Contatti di emergenza</dt><dd>${(d.file.personal?.emergency_contacts || []).map(c => `${esc(c.name)}${c.relationship ? ` (${esc(c.relationship)})` : ''} ${esc(c.phone)}`).join('<br>') || '—'}</dd>
    </dl>
    ${pending ? `<div class="mod-warn" style="margin-top:16px">Hai una richiesta di modifica in attesa dell'ufficio del personale (${Object.keys(pending.changes.fields || {}).map(k => SVC_FIELDS[k] || k).concat(pending.changes.emergency_contacts ? ['contatti di emergenza'] : []).join(', ')}).
      <button class="btn secondary small" style="margin-left:8px" onclick="withdrawChangeRequest(${pending.id})">Ritira</button></div>`
      : '<button class="btn small" style="margin-top:16px" onclick="openChangeRequestModal()">Chiedi una modifica</button>'}
    <p class="mod-note">Le modifiche valgono dopo l'approvazione dell'ufficio del personale. Per codice fiscale e dati di nascita serve un documento: chiedi direttamente.</p>
    ${d.change_requests.filter(c => c.status !== 'richiesta').slice(0, 5).map(c => `<div class="dl-item"><span class="badge ${SVC_REQ[c.status][0]}">${SVC_REQ[c.status][1]}</span>
      <div class="mod-row-main"><div class="mod-row-sub">${new Date(c.requested_at).toLocaleDateString('it-IT')} · ${Object.keys(c.changes.fields || {}).map(k => SVC_FIELDS[k] || k).join(', ')}${c.decision_note ? ` · ${esc(c.decision_note)}` : ''}</div></div></div>`).join('')}`;
}
function openChangeRequestModal() {
  const p = ME.data.file.personal?.data || {};
  const contacts = ME.data.file.personal?.emergency_contacts || [];
  UI.modal({
    id: 'me-change-modal', title: 'Chiedi una modifica dei tuoi dati', width: 620, saveLabel: 'Invia la richiesta',
    body: `<div class="field-row">${['iban', 'personal_email', 'personal_phone'].map(k => `<div class="field"><label>${SVC_FIELDS[k]}</label><input name="${k}" value="${UI.attr(p[k])}"></div>`).join('')}</div>
      <div class="field-row">${['residence_address', 'residence_postal_code', 'residence_city', 'residence_province'].map(k => `<div class="field"><label>${SVC_FIELDS[k]}</label><input name="${k}" value="${UI.attr(p[k])}"></div>`).join('')}</div>
      <div class="field"><label>${SVC_FIELDS.domicile}</label><input name="domicile" value="${UI.attr(p.domicile)}"></div>
      <div class="field-row">${['size_shirt', 'size_pants', 'size_shoes'].map(k => `<div class="field"><label>${SVC_FIELDS[k]}</label><input name="${k}" value="${UI.attr(p[k])}"></div>`).join('')}</div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:8px 0"><input type="checkbox" id="me-change-contacts"> Cambia anche i contatti di emergenza</label>
      <div class="mod-edit-rows" id="me-contacts">${(contacts.length ? contacts : [{}]).map(hrEmergencyRow).join('')}</div>
      <div class="field" style="margin-top:10px"><label>Nota per l'ufficio del personale</label><input name="note"></div>`,
    onSave: async b => {
      const body = { note: UI.val(b, 'note') };
      for (const k of Object.keys(SVC_FIELDS)) body[k] = UI.val(b, k);
      if (b.querySelector('#me-change-contacts').checked) body.emergency_contacts = [...b.querySelectorAll('#me-contacts .mod-edit-row')].map(r2 => Object.fromEntries([...r2.querySelectorAll('[data-ec]')].map(i => [i.dataset.ec, i.value.trim()])));
      await api('/api/admin/hr/me/change-requests', { method: 'POST', body: JSON.stringify(body) });
      loadMySpace();
    },
  });
}
function withdrawChangeRequest(id) { UI.confirmDo('Ritirare la richiesta?', () => api(`/api/admin/hr/me/change-requests/${id}/withdraw`, { method: 'POST' }), loadMySpace); }

// ── Richieste di modifica (HR) ─────────────────────────────────────────────────
async function loadHrChangeRequests() {
  const root = document.getElementById('people-richieste-root');
  let rows;
  try { rows = await api('/api/admin/hr/change-requests'); } catch (e) { root.innerHTML = `<div class="list-card"><div class="mod-empty">${esc(e.message)}</div></div>`; return; }
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar"><div class="list-toolbar-title"><h3>Richieste di modifica dei dati</h3><p class="mod-intro">I dipendenti chiedono di aggiornare IBAN, residenza, contatti e taglie dal loro spazio: i dati cambiano solo quando approvi.</p></div></div>
    ${rows.map(c => `<div class="mod-row">
      <div class="mod-row-main"><div class="mod-row-title">${esc(c.employee_name)} <span style="font-weight:400;color:var(--ink-soft)">· ${new Date(c.requested_at).toLocaleDateString('it-IT')}</span></div>
        <div class="mod-row-sub">${Object.entries(c.changes.fields || {}).map(([k, v]) => `${esc(SVC_FIELDS[k] || k)}: ${c.current ? `<s>${esc(c.current[k] || '—')}</s> → ` : ''}<b>${esc(v || '—')}</b>`).join('<br>')}
          ${c.changes.emergency_contacts ? `<br>Contatti di emergenza → ${c.changes.emergency_contacts.map(x => `${esc(x.name)} ${esc(x.phone)}`).join(', ')}` : ''}${c.note ? `<br><i>${esc(c.note)}</i>` : ''}${c.decision_note ? `<br>${esc(c.decision_note)}` : ''}</div></div>
      <span class="badge ${SVC_REQ[c.status][0]}">${SVC_REQ[c.status][1]}</span>
      ${c.status === 'richiesta' ? `<div class="mod-row-actions"><button class="btn small" onclick="decideChangeRequest(${c.id}, true)">Approva</button><button class="btn secondary small" onclick="decideChangeRequest(${c.id}, false)">Non accogliere</button></div>` : ''}
    </div>`).join('') || '<div class="mod-empty">Nessuna richiesta.</div>'}
  </div>`;
}
function decideChangeRequest(id, ok) {
  if (ok) return UI.confirmDo('Applicare le modifiche ai dati del dipendente?', () => api(`/api/admin/hr/change-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({}) }), loadHrChangeRequests);
  UI.modal({ id: 'cr-reject-modal', title: 'Non accogliere la richiesta', width: 440, saveLabel: 'Conferma', body: '<div class="field"><label>Motivo (lo vede il dipendente)</label><textarea name="note" rows="2"></textarea></div>',
    onSave: async b => { await api(`/api/admin/hr/change-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ note: UI.val(b, 'note') }) }); loadHrChangeRequests(); } });
}

// ── Scheda: Ingresso e uscita (checklist e dotazioni) ──────────────────────────
async function hrLoadJourney() {
  const [lists, assets] = await Promise.all([api(`/api/admin/hr/employees/${REC.id}/checklists`).catch(() => null), api(`/api/admin/hr/employees/${REC.id}/assets`).catch(() => null)]);
  REC.journey = { for: REC.id, lists, assets };
}
function hrTabJourney() {
  const j = REC.journey;
  if (!j?.lists && !j?.assets) return '<div class="rec-locked">Non visibile con il tuo accesso.</div>';
  const edit = REC.file.access.edit.personale;
  const open = kind => (j.lists || []).find(c => c.kind === kind && !c.completed_at);
  const autoBadge = a => (a === true ? '<span class="badge green">risulta fatto</span>' : a === false ? '<span class="badge yellow">da fare</span>' : a === 'non_necessaria' ? '<span class="badge grey">non necessaria</span>' : '');
  return `
    ${(j.lists || []).map(c => `<div class="mod-section-title">${c.kind === 'onboarding' ? 'Ingresso' : 'Uscita'}: ${esc(c.name)} ${c.completed_at ? `<span class="badge green">conclusa il ${new Date(c.completed_at).toLocaleDateString('it-IT')}</span>` : ''}</div>
      ${c.items.map(it => `<div class="dl-item">
        ${edit && !c.completed_at ? `<input type="checkbox" ${it.done_at ? 'checked' : ''} onchange="toggleChecklistItem(${it.id}, this.checked)">` : `<span>${it.done_at ? '✓' : '·'}</span>`}
        <div class="mod-row-main"><div class="mod-row-title" style="${it.done_at ? 'text-decoration:line-through;color:var(--ink-soft)' : ''}">${esc(it.title)}${it.required ? '' : ' <span class="mod-note" style="margin:0">(facoltativa)</span>'}</div>
          ${it.done_at ? `<div class="mod-row-sub">${esc(it.done_by || '')} · ${new Date(it.done_at).toLocaleDateString('it-IT')}</div>` : ''}</div>
        ${c.completed_at ? '' : autoBadge(it.auto)}
      </div>`).join('')}
      ${edit && !c.completed_at ? `<button class="btn small" style="margin-top:10px" onclick="completeChecklist(${c.id}, '${c.kind}')">Concludi ${c.kind === 'onboarding' ? "l'ingresso" : "l'uscita"}</button>` : ''}`).join('') || '<p class="mod-note" style="margin:0">Nessun percorso di ingresso o uscita.</p>'}
    ${edit ? `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${open('onboarding') ? '' : '<button class="btn secondary small" onclick="startChecklist(\'onboarding\')">Avvia l\'ingresso</button>'}${open('offboarding') ? '' : '<button class="btn secondary small" onclick="startChecklist(\'offboarding\')">Avvia l\'uscita</button>'}</div>
      <p class="mod-note">«Risulta fatto» viene dai dati del fascicolo; la spunta la metti tu. Concludere l'uscita disattiva il dipendente, il suo accesso al portale e il suo operatore dell'Enoturismo.</p>` : ''}
    <div class="mod-section-title" style="margin-top:26px">Dotazioni</div>
    ${(j.assets || []).map(a => `<div class="dl-item" style="${a.returned_on ? 'opacity:.55' : ''}"><div class="mod-row-main"><div class="mod-row-title">${esc(a.description)}${a.serial ? ` · ${esc(a.serial)}` : ''}</div>
      <div class="mod-row-sub">${esc(SVC_ASSETS[a.kind])} · consegnata il ${UI.date(a.delivered_on)}${a.returned_on ? ` · restituita il ${UI.date(a.returned_on)}` : ''}${a.notes ? ` · ${esc(a.notes)}` : ''}</div></div>
      ${edit ? `<div class="mod-row-actions">${a.returned_on ? '' : `<button class="btn-outline-pill" onclick="returnAsset(${a.id})">Restituita</button>`}<button class="btn-outline-pill danger" title="Elimina" onclick="deleteAsset(${a.id})">${UI.icon.trash}</button></div>` : ''}</div>`).join('') || '<p class="mod-note" style="margin:0">Nessuna dotazione.</p>'}
    ${edit ? '<button class="btn secondary small" style="margin-top:10px" onclick="openAssetModal()">+ Consegna dotazione</button>' : ''}`;
}
async function journeyReload() { await openHrRecord(REC.id, 'percorso'); }
async function startChecklist(kind) {
  try { await api(`/api/admin/hr/employees/${REC.id}/checklists`, { method: 'POST', body: JSON.stringify({ kind }) }); journeyReload(); } catch (e) { alert(e.message); }
}
async function toggleChecklistItem(id, done) {
  try { await api(`/api/admin/hr/checklist-items/${id}`, { method: 'POST', body: JSON.stringify({ done }) }); journeyReload(); } catch (e) { alert(e.message); }
}
function completeChecklist(id, kind) {
  UI.confirmDo(kind === 'offboarding' ? 'Concludere l\'uscita? Il dipendente, il suo accesso al portale e il suo operatore saranno disattivati (non cancellati).' : 'Concludere l\'ingresso?',
    () => api(`/api/admin/hr/checklists/${id}/complete`, { method: 'POST', body: JSON.stringify({}) }), journeyReload);
}
function openAssetModal() {
  UI.modal({
    id: 'asset-modal', title: 'Consegna dotazione', width: 520,
    body: `<div class="field-row"><div class="field"><label>Tipo</label><select name="kind">${UI.options(Object.entries(SVC_ASSETS).map(([id, name]) => ({ id, name })), 'chiavi')}</select></div>
        <div class="field"><label>Consegnata il</label><input type="date" name="delivered_on" value="${new Date().toISOString().slice(0, 10)}"></div></div>
      <div class="field"><label>Descrizione</label><input name="description" placeholder="es. Chiavi bottaia, badge n. 12, iPhone 13"></div>
      <div class="field-row"><div class="field"><label>Matricola / targa</label><input name="serial"></div><div class="field"><label>Note</label><input name="notes"></div></div>`,
    onSave: async b => {
      const body = {};
      for (const k of ['kind', 'delivered_on', 'description', 'serial', 'notes']) body[k] = UI.val(b, k);
      await api(`/api/admin/hr/employees/${REC.id}/assets`, { method: 'POST', body: JSON.stringify(body) });
      journeyReload();
    },
  });
}
function returnAsset(id) {
  UI.modal({ id: 'asset-return-modal', title: 'Dotazione restituita', width: 400, body: `<div class="field"><label>Restituita il</label><input type="date" name="returned_on" value="${new Date().toISOString().slice(0, 10)}"></div><div class="field"><label>Note (stato)</label><input name="notes"></div>`,
    onSave: async b => { await api(`/api/admin/hr/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ returned_on: UI.val(b, 'returned_on'), notes: UI.val(b, 'notes') }) }); journeyReload(); } });
}
function deleteAsset(id) { UI.confirmDo('Eliminare questa dotazione?', () => api(`/api/admin/hr/assets/${id}`, { method: 'DELETE' }), journeyReload); }

// ── Cedolini in blocco e stagionali (dalla pagina Dipendenti) ──────────────────
async function openBulkDocsModal() {
  const types = (await api('/api/admin/hr/document-types')).filter(t => ['cedolino', 'cu'].includes(t.code) || t.employee_visible);
  UI.modal({
    id: 'bulk-docs-modal', title: 'Carica cedolini o CU in blocco', width: 620, saveLabel: 'Carica e abbina',
    body: `<div class="field-row"><div class="field"><label>Tipo</label><select name="type_code">${UI.options(types, 'cedolino', { value: t => t.code })}</select></div>
        <div class="field"><label>Data</label><input type="date" name="doc_date"></div></div>
      <div class="field"><label>Titolo per tutti</label><input name="title" placeholder="es. Cedolino settembre 2026"></div>
      <div class="field"><label>File (anche molti insieme)</label><input type="file" name="files" multiple accept=".pdf,application/pdf"></div>
      <p class="mod-note">Ogni file si abbina al dipendente con il codice fiscale scritto nel nome del file o, se manca, nel testo del PDF. Quelli non abbinati restano fuori: caricali dalla scheda della persona.</p>`,
    onSave: async b => {
      const files = b.querySelector('[name="files"]').files;
      if (!files.length) throw new Error('Scegli i file.');
      const fd = new FormData();
      for (const k of ['type_code', 'doc_date', 'title']) fd.append(k, UI.val(b, k));
      for (const f of files) fd.append('files', f);
      const res = await api('/api/admin/hr/documents/bulk', { method: 'POST', body: fd });
      setTimeout(() => UI.modal({
        id: 'bulk-result-modal', title: 'Esito del caricamento', width: 620,
        body: `<div class="mod-ok">${res.stored.length} ${res.stored.length === 1 ? 'caricato' : 'caricati'}${res.stored.length ? `:<br>${res.stored.map(s => `${esc(s.employee_name)} — ${esc(s.file)} (da ${esc(s.matched_by)})`).join('<br>')}` : ''}</div>
          ${res.unmatched.length ? `<div class="mod-warn">${res.unmatched.length} da abbinare a mano:<br>${res.unmatched.map(u => `${esc(u.file)} — ${esc(u.reason)}`).join('<br>')}</div>` : ''}`,
      }), 0);
    },
  });
}
async function openSeasonalModal() {
  const rows = await api('/api/admin/hr/seasonal').catch(e => { alert(e.message); return null; });
  if (!rows) return;
  UI.modal({
    id: 'seasonal-modal', title: 'Stagionali e campagne lavorate', width: 680,
    body: rows.length ? `<div class="mod-table-wrap"><table class="mod-table" style="min-width:0"><thead><tr><th>Persona</th><th>Campagne</th><th>Ultima mansione</th><th>Da richiamare</th></tr></thead><tbody>
      ${rows.map(x => `<tr class="mod-clickable" onclick="document.getElementById('seasonal-modal').remove(); openHrRecord(${x.employee_id}, 'lavoro')"><td><b>${esc(x.name)}</b>${x.active ? '' : ' <span class="badge grey">non attivo</span>'}</td>
        <td>${x.campaigns.map(c => `${c.year} (${UI.date(c.from)}${c.to ? ` → ${UI.date(c.to)}` : ''})`).join('<br>')}</td><td>${esc(x.last_role || '—')}</td>
        <td>${x.rehire_ok === 1 ? '<span class="badge green">Sì</span>' : x.rehire_ok === 0 ? '<span class="badge red">No</span>' : '—'}</td></tr>`).join('')}
    </tbody></table></div><p class="mod-note">«Da richiamare» si indica nella versione del contratto (Rapporto di lavoro).</p>` : '<div class="mod-empty">Nessun contratto stagionale o a termine.</div>',
  });
}

// ── Configurazione: checklist di ingresso e uscita ─────────────────────────────
async function loadHrChecklistConfig() {
  const box = document.getElementById('hr-checklist-config-box');
  if (!box) return;
  SVC_TPL = await api('/api/admin/hr/checklist-templates');
  box.innerHTML = `<div class="list-card">
    <div class="list-toolbar"><div class="list-toolbar-title"><h3>Checklist di ingresso e uscita</h3><p class="mod-intro">Voci da completare quando entra o esce una persona. Una checklist può valere solo per alcuni tipi di contratto (es. stagionali); altrimenti vale per tutti.</p></div>
      <div class="list-spacer"></div><button class="btn-generate" onclick="openChecklistTemplateModal()">${UI.icon.plus} Nuova checklist</button></div>
    ${SVC_TPL.map(t => `<div class="mod-row ${t.active ? '' : 'cc-inactive'}"><div class="mod-row-main"><div class="mod-row-title">${t.kind === 'onboarding' ? 'Ingresso' : 'Uscita'} · ${esc(t.name)}</div>
      <div class="mod-row-sub">${t.items.length} voci · ${t.contract_types.length ? `solo ${t.contract_types.map(c => esc(HR_CONTRACT_TYPES[c] || c)).join(', ')}` : 'tutti i contratti'}</div></div>
      <button class="btn-outline-pill" onclick="openChecklistTemplateModal(${t.id})">Modifica</button></div>`).join('')}
  </div>`;
}
let SVC_TPL = [];
function tplItemRow(it = {}) {
  return `<div class="mod-edit-row" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr) 110px 90px auto">
    <input data-it="title" placeholder="Voce" value="${UI.attr(it.title)}">
    <select data-it="item_type">${UI.options(Object.entries(SVC_ITEM_TYPES).map(([id, name]) => ({ id, name })), it.item_type || 'altro')}</select>
    <input data-it="ref" placeholder="codice (facolt.)" value="${UI.attr(it.ref)}">
    <label style="font-size:12px;display:flex;gap:4px;align-items:center"><input type="checkbox" data-it="required" ${it.required === 0 ? '' : 'checked'}> obblig.</label>
    <button type="button" class="btn-outline-pill danger" onclick="this.parentElement.remove()">×</button>
  </div>`;
}
function openChecklistTemplateModal(id) {
  const t = SVC_TPL.find(x => x.id === id) || null;
  UI.modal({
    id: 'tpl-modal', title: t ? `Modifica ${t.name}` : 'Nuova checklist', width: 720,
    body: `<div class="field-row">
        <div class="field"><label>Tipo</label><select name="kind" ${t ? 'disabled' : ''}>${UI.options([{ id: 'onboarding', name: 'Ingresso' }, { id: 'offboarding', name: 'Uscita' }], t?.kind || 'onboarding')}</select></div>
        <div class="field"><label>Nome</label><input name="name" value="${UI.attr(t?.name)}"></div>
      </div>
      <div class="field"><label>Vale solo per i contratti (nessuna spunta = tutti)</label><div class="mod-checklist">${Object.entries(HR_CONTRACT_TYPES).map(([k, l]) => `<label><input type="checkbox" data-ct="${k}" ${t?.contract_types.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>
      <div class="field"><label>Voci</label><div class="mod-edit-rows" id="tpl-items">${(t?.items || [{}]).map(tplItemRow).join('')}</div>
        <button type="button" class="btn secondary small" style="margin-top:6px" onclick="document.getElementById('tpl-items').insertAdjacentHTML('beforeend', tplItemRow())">+ Voce</button></div>
      ${t ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Attiva</label>` : ''}
      <p class="mod-note">Il codice serve alle verifiche automatiche: per «Documento» il tipo di documento (es. contratto, privacy), per «Formazione» il corso (es. generale).</p>`,
    onSave: async b => {
      const body = { kind: UI.val(b, 'kind'), name: UI.val(b, 'name'), contract_types: [...b.querySelectorAll('[data-ct]:checked')].map(c => c.dataset.ct),
        items: [...b.querySelectorAll('#tpl-items .mod-edit-row')].map(r2 => ({ title: r2.querySelector('[data-it="title"]').value.trim(), item_type: r2.querySelector('[data-it="item_type"]').value,
          ref: r2.querySelector('[data-it="ref"]').value.trim() || null, required: r2.querySelector('[data-it="required"]').checked })).filter(i => i.title) };
      if (t) body.active = UI.val(b, 'active');
      await api('/api/admin/hr/checklist-templates' + (t ? `/${t.id}` : ''), { method: t ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadHrChecklistConfig();
    },
  });
}
