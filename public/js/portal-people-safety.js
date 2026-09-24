// Portale → People: sicurezza sul lavoro (D.Lgs. 81/08). Sezione "Sicurezza" della scheda,
// pagina Sicurezza (conformità, infortuni) e configurazione (formazione, requisiti, DPI, responsabili).
const SAF_STATES = { valida: ['green', 'Valida'], in_scadenza: ['yellow', 'In scadenza'], scaduta: ['red', 'Scaduta'], mancante: ['red', 'Mancante'] };
const SAF_CATEGORIES = { sicurezza: 'Sicurezza', abilitazione: 'Abilitazioni', alimentare: 'Alimentare' };
const SAF_VISIT_TYPES = { preassuntiva: 'Preassuntiva', preventiva: 'Preventiva', periodica: 'Periodica', cambio_mansione: 'Cambio mansione', rientro: 'Rientro dopo assenza per salute', su_richiesta: 'Su richiesta del lavoratore' };
const SAF_JUDGMENTS = { idoneo: 'Idoneo', idoneo_prescrizioni: 'Idoneo con prescrizioni/limitazioni', non_idoneo_temporaneo: 'Non idoneo temporaneo', non_idoneo: 'Non idoneo' };
const SAF_FITNESS = { idoneo: ['green', 'Idoneo'], prescrizioni: ['yellow', 'Con limitazioni'], non_idoneo_temporaneo: ['red', 'Non idoneo temporaneo'], non_idoneo: ['red', 'Non idoneo'], da_rivalutare: ['yellow', 'Da rivalutare'] };
const SAF = { config: null, view: 'conformita', incFilter: { kind: '', year: String(new Date().getFullYear()) } };

async function safConfig(force = false) {
  if (!SAF.config || force) SAF.config = await api('/api/admin/hr/safety/config');
  return SAF.config;
}
const safBadge = ([cls, label]) => `<span class="badge ${cls}">${label}</span>`;
const safHours = min => (min == null ? '—' : `${UI.decimal(min / 60)} h`);
const safValidity = t => (t.validity_months ? (t.validity_months % 12 ? `ogni ${t.validity_months} mesi` : `ogni ${t.validity_months / 12} ${t.validity_months === 12 ? 'anno' : 'anni'}`) : 'non scade');
const safCheck = (name, list, selected, label = x => x.name) => `<div class="mod-checklist">${list.map(x => `<label><input type="checkbox" data-${name}="${x.id}" ${selected.includes(x.id) ? 'checked' : ''}> ${esc(label(x))}</label>`).join('') || '<span class="mod-note">Nessuna voce.</span>'}</div>`;
const safChecked = (box, name) => [...box.querySelectorAll(`[data-${name}]:checked`)].map(c => Number(c.getAttribute(`data-${name}`)));
const safToday = () => new Date().toISOString().slice(0, 10);

// ── Sezione Sicurezza della scheda ─────────────────────────────────────────────
function hrTabSafety() {
  const s = REC.safety;
  if (!s) return '<div class="rec-locked">I dati di sicurezza di questa persona non sono visibili con il tuo accesso.</div>';
  const req = s.requirements;
  const docUrl = id => REC.file.documents.find(d => d.id === id)?.download_url;
  const edit = s.access.edit;
  const stateBadge = i => {
    const [cls, label] = SAF_STATES[i.state];
    return `<span class="badge ${cls}">${label}${i.expires_on && i.state !== 'mancante' ? ` · ${UI.date(i.expires_on)}` : ''}</span>`;
  };
  const f = s.fitness;
  const lastVisit = f?.visits.find(v => v.visit_date <= safToday());
  return `
    <div class="mod-section-title">Formazione richiesta dalla mansione</div>
    ${req.role ? `<p class="mod-note" style="margin:0 0 8px">Mansione «${esc(req.role.name)}» dal ${UI.date(req.role.since)}${req.role.medical_surveillance ? ' · soggetta a sorveglianza sanitaria' : ''}${req.role.allows_waiver ? ' · ammette deroghe' : ''}.</p>
      ${req.items.map(i => `<div class="dl-item"><div class="mod-row-main"><div class="mod-row-title">${esc(i.name)}</div>${i.completed_on ? `<div class="mod-row-sub">Ultimo corso: ${UI.date(i.completed_on)}</div>` : ''}</div>${stateBadge(i)}</div>`).join('') || '<p class="mod-note">La mansione non richiede formazione specifica.</p>'}`
      : '<p class="mod-note" style="margin:0">Nessuna mansione nel contratto in vigore: i requisiti si calcolano dalla mansione (Rapporto di lavoro).</p>'}

    <div class="mod-section-title" style="margin-top:26px">Registro della formazione e abilitazioni</div>
    ${s.trainings.length ? `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Corso</th><th>Data</th><th class="num">Ore</th><th>Ente</th><th>Scadenza</th><th>Attestato</th><th></th></tr></thead><tbody>
      ${s.trainings.map(tr => `<tr><td>${esc(tr.type_name)}</td><td>${UI.date(tr.completed_on)}</td><td class="num">${safHours(tr.minutes)}</td><td>${esc(tr.provider || '—')}</td>
        <td>${tr.expires_on ? UI.date(tr.expires_on) : 'non scade'}</td><td>${tr.document_id && docUrl(tr.document_id) ? `<a class="plain" href="${UI.attr(docUrl(tr.document_id))}">Scarica</a>` : '—'}</td>
        <td>${edit ? `<button class="btn-outline-pill danger" title="Elimina" onclick="deleteSafTraining(${tr.id})">${UI.icon.trash}</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="mod-note">Nessun corso registrato.</p>'}
    ${edit ? '<button class="btn secondary small" style="margin-top:10px" onclick="openSafTrainingModal()">+ Registra corso</button>' : ''}

    ${s.access.fitness ? `
      <div class="mod-section-title" style="margin-top:26px">Idoneità alla mansione <span class="badge grey">sanitario</span></div>
      ${f.state ? `<div class="dl-item">${safBadge(SAF_FITNESS[f.state])}<div class="mod-row-main"><div class="mod-row-title">${esc(SAF_JUDGMENTS[lastVisit.judgment])}${lastVisit.unfit_until ? ` fino al ${UI.date(lastVisit.unfit_until)}` : ''}</div>
        <div class="mod-row-sub">Visita ${esc(SAF_VISIT_TYPES[lastVisit.visit_type].toLowerCase())} del ${UI.date(lastVisit.visit_date)}${lastVisit.doctor ? ` · ${esc(lastVisit.doctor)}` : ''}${lastVisit.next_visit_on ? ` · prossima entro il ${UI.date(lastVisit.next_visit_on)}` : ''}</div>
        ${lastVisit.limitations ? `<div class="mod-row-sub" style="color:var(--warn)">Limitazioni: ${esc(lastVisit.limitations)}${lastVisit.restrictions.length ? ` · incompatibile con ${lastVisit.restrictions.map(x => esc(x.cost_object_name || x.job_role_name)).join(', ')}` : ''}</div>` : ''}</div></div>` : '<p class="mod-note">Nessuna visita registrata.</p>'}
      ${f.visits.length > 1 ? `<details style="margin-top:8px"><summary class="mod-note" style="cursor:pointer">Storico delle visite (${f.visits.length})</summary>
        ${f.visits.map(v => `<div class="dl-item"><div class="mod-row-main"><div class="mod-row-title">${UI.date(v.visit_date)} · ${esc(SAF_VISIT_TYPES[v.visit_type])}</div><div class="mod-row-sub">${esc(SAF_JUDGMENTS[v.judgment])}${v.limitations ? ` · ${esc(v.limitations)}` : ''}</div></div>
          ${s.access.edit_fitness ? `<button class="btn-outline-pill danger" title="Elimina" onclick="deleteSafVisit(${v.id})">${UI.icon.trash}</button>` : ''}</div>`).join('')}</details>` : ''}
      ${s.access.edit_fitness ? '<button class="btn secondary small" style="margin-top:10px" onclick="openSafVisitModal()">+ Registra visita</button>' : ''}
      <p class="mod-note">Solo il giudizio e le limitazioni del medico competente: nessuna diagnosi va inserita nel sistema. Ogni lettura di questa sezione è registrata.</p>` : ''}

    <div class="mod-section-title" style="margin-top:26px">DPI consegnati</div>
    ${s.ppe.length ? `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>DPI</th><th>Consegna</th><th>Taglia</th><th class="num">Q.tà</th><th>Da sostituire</th><th>Verbale</th><th></th></tr></thead><tbody>
      ${s.ppe.map(p => `<tr style="${p.returned_on ? 'opacity:.55' : ''}"><td>${esc(p.type_name)}</td><td>${UI.date(p.delivered_on)}</td><td>${esc(p.size || '—')}</td><td class="num">${p.quantity}</td>
        <td>${p.returned_on ? `restituito il ${UI.date(p.returned_on)}` : p.replace_by ? UI.date(p.replace_by) : 'a usura'}</td><td>${p.document_id && docUrl(p.document_id) ? `<a class="plain" href="${UI.attr(docUrl(p.document_id))}">Scarica</a>` : '—'}</td>
        <td style="white-space:nowrap">${edit && !p.returned_on ? `<button class="btn-outline-pill" onclick="returnSafPpe(${p.id})">Restituito</button>` : ''}${edit ? `<button class="btn-outline-pill danger" title="Elimina" onclick="deleteSafPpe(${p.id})">${UI.icon.trash}</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="mod-note">Nessuna consegna registrata.</p>'}
    ${edit ? '<button class="btn secondary small" style="margin-top:10px" onclick="openSafPpeModal()">+ Consegna DPI</button>' : ''}

    ${s.waivers.length || s.access.waivers ? `
      <div class="mod-section-title" style="margin-top:26px">Deroghe del responsabile sicurezza</div>
      ${s.waivers.map(w => `<div class="dl-item" style="${w.revoked_at || w.valid_to < safToday() ? 'opacity:.55' : ''}"><div class="mod-row-main"><div class="mod-row-title">${esc(w.type_name)}${w.cost_object_name ? ` · solo per «${esc(w.cost_object_name)}»` : ''}</div>
        <div class="mod-row-sub">Dal ${UI.date(w.valid_from)} al ${UI.date(w.valid_to)} · ${esc(w.granted_by)} · ${esc(w.reason)}${w.revoked_at ? ' · revocata' : ''}</div></div>
        ${s.access.waivers && !w.revoked_at && w.valid_to >= safToday() ? `<button class="btn-outline-pill danger" onclick="revokeSafWaiver(${w.id})">Revoca</button>` : ''}</div>`).join('') || '<p class="mod-note" style="margin:0">Nessuna deroga.</p>'}
      ${s.access.waivers ? '<button class="btn secondary small" style="margin-top:10px" onclick="openSafWaiverModal()">+ Nuova deroga</button>' : ''}` : ''}

    ${s.tasks.length ? `
      <div class="mod-section-title" style="margin-top:26px">Attività</div>
      ${s.tasks.map(tk => `<div class="dl-item" style="${tk.done_at ? 'opacity:.55' : ''}"><div class="mod-row-main"><div class="mod-row-title">${esc(tk.title)}</div>
        <div class="mod-row-sub">${tk.done_at ? `Fatta il ${new Date(tk.done_at).toLocaleDateString('it-IT')} · ${esc(tk.done_by || '')}${tk.notes ? ` · ${esc(tk.notes)}` : ''}` : `Entro il ${UI.date(tk.due_date)}`}</div></div>
        ${edit && !tk.done_at ? `<button class="btn-outline-pill" onclick="doneSafTask(${tk.id})">Fatta</button>` : ''}</div>`).join('')}` : ''}

    ${s.access.incidents ? `
      <div class="mod-section-title" style="margin-top:26px">Infortuni</div>
      ${s.incidents.map(i => `<div class="dl-item"><div class="mod-row-main"><div class="mod-row-title">${UI.date(i.occurred_on)} · ${i.kind === 'infortunio' ? 'Infortunio' : 'Quasi-infortunio'}${i.prognosis_days != null ? ` · ${i.prognosis_days} gg di prognosi` : ''}</div>
        <div class="mod-row-sub">${esc(i.dynamics)}${i.inail_number ? ` · INAIL ${esc(i.inail_number)}` : ''}</div></div></div>`).join('') || '<p class="mod-note" style="margin:0">Nessun infortunio.</p>'}` : ''}`;
}
async function safReload() { await openHrRecord(REC.id, 'sicurezza'); }
function deleteSafTraining(id) { UI.confirmDo('Eliminare questo corso dal registro?', () => api(`/api/admin/hr/trainings/${id}`, { method: 'DELETE' }), safReload); }
function deleteSafVisit(id) { UI.confirmDo('Eliminare questa visita?', () => api(`/api/admin/hr/medical-visits/${id}`, { method: 'DELETE' }), safReload); }
function deleteSafPpe(id) { UI.confirmDo('Eliminare questa consegna?', () => api(`/api/admin/hr/ppe/${id}`, { method: 'DELETE' }), safReload); }
function revokeSafWaiver(id) { UI.confirmDo('Revocare la deroga? Da subito la persona non sarà più assegnabile a quell\'attività.', () => api(`/api/admin/hr/waivers/${id}/revoke`, { method: 'POST' }), safReload); }
function returnSafPpe(id) {
  UI.modal({ id: 'saf-return-modal', title: 'DPI restituito', width: 400, body: `<div class="field"><label>Restituito il</label><input type="date" name="returned_on" value="${safToday()}"></div>`,
    onSave: async b => { await api(`/api/admin/hr/ppe/${id}`, { method: 'PATCH', body: JSON.stringify({ returned_on: UI.val(b, 'returned_on') }) }); safReload(); } });
}
function doneSafTask(id) {
  UI.modal({ id: 'saf-task-modal', title: 'Attività fatta', width: 440, body: '<div class="field"><label>Nota (facoltativa)</label><input name="notes" placeholder="es. visita fatta il 12/10, giudizio caricato"></div>', saveLabel: 'Segna come fatta',
    onSave: async b => { await api(`/api/admin/hr/tasks/${id}/done`, { method: 'POST', body: JSON.stringify({ notes: UI.val(b, 'notes') }) }); safReload(); } });
}
// Invio con file facoltativo: FormData con i campi del modale.
async function safSubmit(url, box, fields, extra = {}) {
  const fd = new FormData();
  for (const k of fields) { const v = UI.val(box, k); if (v !== undefined && v !== '') fd.append(k, v); }
  for (const [k, v] of Object.entries(extra)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  const file = box.querySelector('[name="file"]')?.files[0];
  if (file) fd.append('file', file);
  return api(url, { method: 'POST', body: fd });
}
async function openSafTrainingModal() {
  const cfg = await safConfig();
  const types = cfg.training_types.filter(x => x.active);
  const groups = Object.entries(SAF_CATEGORIES).map(([k, l]) => `<optgroup label="${l}">${UI.options(types.filter(x => x.category === k), '', { label: x => `${x.name} (${safValidity(x)})` })}</optgroup>`).join('');
  UI.modal({
    id: 'saf-training-modal', title: 'Registra corso', width: 560,
    body: `
      <div class="field"><label>Corso</label><select name="training_type_id">${groups}</select></div>
      <div class="field-row">
        <div class="field"><label>Data del corso</label><input type="date" name="completed_on" value="${safToday()}"></div>
        <div class="field"><label>Ore</label><input name="hours" inputmode="decimal"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Ente formatore</label><input name="provider"></div>
        <div class="field"><label>Scadenza</label><input type="date" name="expires_on"></div>
      </div>
      <div class="field"><label>Attestato (facoltativo)</label><input type="file" name="file"></div>
      <p class="mod-note">Lascia vuota la scadenza per calcolarla dalla periodicità del corso (People → Configurazione).</p>`,
    onSave: async b => { await safSubmit(`/api/admin/hr/employees/${REC.id}/trainings`, b, ['training_type_id', 'completed_on', 'hours', 'provider', 'expires_on']); safReload(); },
  });
}
async function openSafVisitModal() {
  const cfg = await safConfig();
  UI.modal({
    id: 'saf-visit-modal', title: 'Registra visita medica', width: 620,
    body: `
      <div class="field-row">
        <div class="field"><label>Data della visita</label><input type="date" name="visit_date" value="${safToday()}"></div>
        <div class="field"><label>Tipo</label><select name="visit_type">${UI.options(Object.entries(SAF_VISIT_TYPES).map(([id, name]) => ({ id, name })), 'periodica')}</select></div>
      </div>
      <div class="field"><label>Medico competente</label><input name="doctor" value="${UI.attr(cfg.settings.doctor)}"></div>
      <div class="field"><label>Giudizio</label><select name="judgment" onchange="document.getElementById('saf-visit-limits').style.display = this.value === 'idoneo_prescrizioni' ? '' : 'none'; document.getElementById('saf-visit-until').style.display = this.value === 'non_idoneo_temporaneo' ? '' : 'none'">${UI.options(Object.entries(SAF_JUDGMENTS).map(([id, name]) => ({ id, name })), 'idoneo')}</select></div>
      <div id="saf-visit-until" style="display:none" class="field"><label>Non idoneo fino al</label><input type="date" name="unfit_until"></div>
      <div id="saf-visit-limits" style="display:none">
        <div class="field"><label>Prescrizioni o limitazioni (come scritte nel giudizio)</label><textarea name="limitations" rows="2"></textarea></div>
        <div class="field-row">
          <div class="field"><label>Mansioni incompatibili</label>${safCheck('rjob', cfg.job_roles.filter(j => j.active), [])}</div>
          <div class="field"><label>Operazioni incompatibili</label>${safCheck('rop', cfg.operations, [], o => `${o.code} ${o.name}`)}</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Prossima visita entro il</label><input type="date" name="next_visit_on"></div>
        <div class="field"><label>Giudizio firmato (facoltativo)</label><input type="file" name="file"></div>
      </div>
      <p class="mod-note">Non inserire diagnosi: solo il giudizio e le limitazioni. Chi assegna una persona a un'operazione incompatibile riceve un avviso; con un giudizio di non idoneità l'assegnazione è bloccata.</p>`,
    onSave: async b => {
      await safSubmit(`/api/admin/hr/employees/${REC.id}/medical-visits`, b, ['visit_date', 'visit_type', 'doctor', 'judgment', 'unfit_until', 'limitations', 'next_visit_on'],
        { restricted_job_role_ids: safChecked(b, 'rjob'), restricted_cost_object_ids: safChecked(b, 'rop') });
      safReload();
    },
  });
}
async function openSafPpeModal() {
  const cfg = await safConfig();
  UI.modal({
    id: 'saf-ppe-modal', title: 'Consegna DPI', width: 520,
    body: `
      <div class="field"><label>DPI</label><select name="ppe_type_id">${UI.options(cfg.ppe_types.filter(x => x.active), '', { label: x => `${x.name}${x.replacement_months ? ` (sostituzione ogni ${x.replacement_months} mesi)` : ''}` })}</select></div>
      <div class="field-row">
        <div class="field"><label>Consegnato il</label><input type="date" name="delivered_on" value="${safToday()}"></div>
        <div class="field"><label>Quantità</label><input name="quantity" type="number" min="1" value="1"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Taglia</label><input name="size" placeholder="vuota = dalla scheda"></div>
        <div class="field"><label>Da sostituire entro</label><input type="date" name="replace_by"></div>
      </div>
      <div class="field"><label>Verbale firmato (facoltativo)</label><input type="file" name="file"></div>
      <p class="mod-note">Taglia e sostituzione, se vuote, vengono dai dati personali e dalla periodicità del DPI.</p>`,
    onSave: async b => { await safSubmit(`/api/admin/hr/employees/${REC.id}/ppe`, b, ['ppe_type_id', 'delivered_on', 'quantity', 'size', 'replace_by']); safReload(); },
  });
}
async function openSafWaiverModal() {
  const cfg = await safConfig();
  const end = new Date(); end.setDate(end.getDate() + 30);
  UI.modal({
    id: 'saf-waiver-modal', title: 'Nuova deroga', width: 560,
    body: `
      <div class="field"><label>Formazione o abilitazione mancante</label><select name="training_type_id">${UI.options(cfg.training_types.filter(x => x.active), '')}</select></div>
      <div class="field"><label>Solo per l'operazione (facoltativo)</label><select name="cost_object_id">${UI.options(cfg.operations, '', { empty: '— Tutte le operazioni —', label: o => `${o.code} ${o.name}` })}</select></div>
      <div class="field-row">
        <div class="field"><label>Dal</label><input type="date" name="valid_from" value="${safToday()}"></div>
        <div class="field"><label>Al</label><input type="date" name="valid_to" value="${end.toISOString().slice(0, 10)}"></div>
      </div>
      <div class="field"><label>Motivo</label><textarea name="reason" rows="2" placeholder="es. corso di rinnovo già prenotato per il 15/11"></textarea></div>
      <p class="mod-note">Le deroghe sono ammesse solo se la mansione lo consente, durano al massimo 12 mesi e restano nel registro attività.</p>`,
    onSave: async b => {
      const body = {};
      for (const k of ['training_type_id', 'cost_object_id', 'valid_from', 'valid_to', 'reason']) body[k] = UI.val(b, k) || null;
      await api(`/api/admin/hr/employees/${REC.id}/waivers`, { method: 'POST', body: JSON.stringify(body) });
      safReload();
    },
  });
}

// ── Pagina Sicurezza: conformità e infortuni ───────────────────────────────────
async function loadHrSafety() {
  const root = document.getElementById('people-sicurezza-root');
  const tabs = `<div class="rec-tabs" style="padding:0 22px">${[['conformita', 'Conformità'], ['infortuni', 'Infortuni e quasi-infortuni']].map(([k, l]) => `<button class="${SAF.view === k ? 'active' : ''}" onclick="SAF.view='${k}'; loadHrSafety()">${l}</button>`).join('')}</div>`;
  if (SAF.view === 'infortuni') return loadHrIncidents(root, tabs);
  const sites = await api('/api/admin/hr/sites');
  const rows = await api(`/api/admin/hr/safety/compliance${SAF.siteId ? `?site_id=${SAF.siteId}` : ''}`);
  const withFitness = rows.some(r => r.fitness !== undefined);
  const cell = r => {
    const parts = [];
    if (r.missing) parts.push(`<span class="badge red">${r.missing} mancant${r.missing === 1 ? 'e' : 'i'}</span>`);
    if (r.expired) parts.push(`<span class="badge red">${r.expired} scadut${r.expired === 1 ? 'a' : 'e'}</span>`);
    if (r.expiring) parts.push(`<span class="badge yellow">${r.expiring} in scadenza</span>`);
    return parts.join(' ') || (r.required ? '<span class="badge green">In regola</span>' : '<span class="mod-note" style="margin:0">—</span>');
  };
  const visit = r => (r.visit_missing ? '<span class="badge red">Mancante</span>' : r.visit_expired ? `<span class="badge red">Scaduta ${UI.date(r.visit_due)}</span>` : r.visit_due ? UI.date(r.visit_due) : '—');
  root.innerHTML = `<div class="list-card">
    ${tabs}
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Conformità sicurezza</h3><p class="mod-intro">Per ogni persona: formazione richiesta dalla mansione, visita medica, attività aperte.</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields"><select onchange="SAF.siteId = parseInt(this.value) || null; loadHrSafety()">${UI.options(sites, SAF.siteId, { empty: 'Tutte le sedi' })}</select></div>
    </div>
    ${rows.length ? `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Dipendente</th><th>Mansione</th><th>Formazione</th><th>Visita medica</th>${withFitness ? '<th>Idoneità</th>' : ''}<th class="num">Attività</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="mod-clickable" onclick="openHrRecord(${r.employee_id}, 'sicurezza')"><td><b>${esc(r.name)}</b>${r.site_name ? `<br><span class="mod-note" style="margin:0">${esc(r.site_name)}</span>` : ''}</td>
        <td>${esc(r.job_role || '—')}</td><td>${cell(r)}</td><td>${visit(r)}</td>${withFitness ? `<td>${r.fitness ? safBadge(SAF_FITNESS[r.fitness]) : '—'}</td>` : ''}<td class="num">${r.open_tasks || '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="mod-empty">Nessun dipendente attivo.</div>'}
  </div>`;
}
async function loadHrIncidents(root, tabs) {
  const f = SAF.incFilter;
  const list = await api(`/api/admin/hr/incidents?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`).catch(e => ({ error: e.message }));
  const y = new Date().getFullYear();
  root.innerHTML = `<div class="list-card">
    ${tabs}
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Infortuni e quasi-infortuni</h3><p class="mod-intro">I quasi-infortuni servono all'analisi dei rischi: registrali anche quando nessuno si è fatto male.</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields">
        <select onchange="SAF.incFilter.kind = this.value; loadHrSafety()">${UI.options([{ id: 'infortunio', name: 'Infortuni' }, { id: 'quasi_infortunio', name: 'Quasi-infortuni' }], f.kind, { empty: 'Tutti' })}</select>
        <select onchange="SAF.incFilter.year = this.value; loadHrSafety()">${UI.options([y, y - 1, y - 2, y - 3].map(v => ({ id: String(v), name: String(v) })), f.year, { empty: 'Tutti gli anni' })}</select>
      </div>
      ${list.error ? '' : `<button class="btn-generate" onclick="openSafIncidentModal()">${UI.icon.plus} Registra</button>`}
    </div>
    ${list.error ? `<div class="mod-empty">${esc(list.error)}</div>` : list.map(i => `<div class="mod-row mod-clickable" onclick="openSafIncidentModal(${i.id})">
      <div class="mod-row-main"><div class="mod-row-title">${UI.date(i.occurred_on)}${i.occurred_time ? ` ${esc(i.occurred_time)}` : ''} · ${esc(i.employee_name || 'nessuna persona coinvolta')}${i.place ? ` · ${esc(i.place)}` : ''}</div>
        <div class="mod-row-sub">${esc(i.dynamics)}</div></div>
      ${i.kind === 'infortunio' ? `<span class="badge red">Infortunio${i.prognosis_days != null ? ` · ${i.prognosis_days} gg` : ''}</span>` : '<span class="badge yellow">Quasi-infortunio</span>'}
      ${i.kind === 'infortunio' ? (i.inail_number ? `<span class="badge grey">INAIL ${esc(i.inail_number)}</span>` : '<span class="badge grey">Senza denuncia INAIL</span>') : ''}
    </div>`).join('') || '<div class="mod-empty">Nessun evento registrato nel periodo.</div>'}
  </div>`;
  SAF.incidents = Array.isArray(list) ? list : [];
}
async function openSafIncidentModal(id) {
  const [cfg] = await Promise.all([safConfig(), HR.employees.length ? null : hrLoadBasics()]);
  const i = (SAF.incidents || []).find(x => x.id === id) || null;
  UI.modal({
    id: 'saf-incident-modal', title: i ? 'Modifica evento' : 'Registra infortunio o quasi-infortunio', width: 640,
    body: `
      <div class="field-row">
        <div class="field"><label>Tipo</label><select name="kind" ${i ? 'disabled' : ''}>${UI.options([{ id: 'infortunio', name: 'Infortunio' }, { id: 'quasi_infortunio', name: 'Quasi-infortunio' }], i?.kind || 'infortunio')}</select></div>
        <div class="field"><label>Persona</label><select name="employee_id" ${i ? 'disabled' : ''}>${UI.options(HR.employees.filter(e => e.active || e.id === i?.employee_id), i?.employee_id, { empty: '— Nessuna (solo quasi-infortunio) —', label: hrName })}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Data</label><input type="date" name="occurred_on" value="${UI.attr(i?.occurred_on || safToday())}"></div>
        <div class="field"><label>Ora</label><input name="occurred_time" placeholder="HH:MM" value="${UI.attr(i?.occurred_time)}"></div>
        <div class="field"><label>Luogo</label><input name="place" value="${UI.attr(i?.place)}" placeholder="es. bottaia, vigneto P101"></div>
      </div>
      <div class="field"><label>Operazione in corso (facoltativa)</label><select name="cost_object_id">${UI.options(cfg.operations, i?.cost_object_id, { empty: '—', label: o => `${o.code} ${o.name}` })}</select></div>
      <div class="field"><label>Dinamica</label><textarea name="dynamics" rows="3">${esc(i?.dynamics || '')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Giorni di prognosi</label><input name="prognosis_days" type="number" min="0" value="${UI.attr(i?.prognosis_days)}"></div>
        <div class="field"><label>Denuncia INAIL n.</label><input name="inail_number" value="${UI.attr(i?.inail_number)}"></div>
        <div class="field"><label>del</label><input type="date" name="inail_date" value="${UI.attr(i?.inail_date)}"></div>
      </div>
      <div class="field"><label>Misure adottate</label><textarea name="measures" rows="2">${esc(i?.measures || '')}</textarea></div>
      <p class="mod-note">Niente diagnosi: la documentazione sanitaria dell'infortunio va caricata nei Documenti (tipo «Documentazione infortunio», livello sanitario).</p>`,
    onSave: async b => {
      const body = {};
      for (const k of ['kind', 'employee_id', 'occurred_on', 'occurred_time', 'place', 'cost_object_id', 'dynamics', 'prognosis_days', 'inail_number', 'inail_date', 'measures']) body[k] = UI.val(b, k);
      if (i) { delete body.kind; delete body.employee_id; }
      await api('/api/admin/hr/incidents' + (i ? `/${i.id}` : ''), { method: i ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadHrSafety();
    },
  });
}

// ── Configurazione: formazione, requisiti, operazioni, DPI, responsabili ──────
async function loadHrSafetyConfig() {
  const box = document.getElementById('hr-safety-config-box');
  if (!box) return;
  const cfg = await safConfig(true);
  const tname = id => cfg.training_types.find(x => x.id === id)?.name;
  await (HR.employees.length ? null : hrLoadBasics());
  box.innerHTML = `
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>Formazione e abilitazioni</h3><p class="mod-intro">Tipi di corso con la loro periodicità di aggiornamento. Le durate di partenza vanno verificate con l'RSPP: la normativa cambia, qui si modificano senza toccare il programma.</p></div>
        <div class="list-spacer"></div><button class="btn-generate" onclick="openSafTypeModal()">${UI.icon.plus} Nuovo corso</button></div>
      ${cfg.training_types.map(x => `<div class="mod-row ${x.active ? '' : 'cc-inactive'}"><div class="mod-row-main"><div class="mod-row-title">${esc(x.name)}</div>
        <div class="mod-row-sub">${SAF_CATEGORIES[x.category]} · ${safValidity(x)}${x.initial_minutes ? ` · ${safHours(x.initial_minutes)} iniziali` : ''}${x.update_minutes ? `, ${safHours(x.update_minutes)} di aggiornamento` : ''}${x.legal_ref ? ` · ${esc(x.legal_ref)}` : ''}</div></div>
        <button class="btn-outline-pill" onclick="openSafTypeModal(${x.id})">Modifica</button></div>`).join('')}
    </div>
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>Operazioni che richiedono un'abilitazione</h3><p class="mod-intro">Chi non ha l'abilitazione valida non può essere assegnato né registrare ore sull'operazione. Le operazioni sono gli oggetti di costo di tipo «operazione» (Finance).</p></div></div>
      ${cfg.operations.map(o => `<div class="mod-row"><div class="mod-row-main"><div class="mod-row-title"><span class="mod-code">${esc(o.code)}</span>${esc(o.name)}</div>
        <div class="mod-row-sub">${o.training_type_ids.length ? o.training_type_ids.map(id => esc(tname(id))).join(', ') : 'Nessuna abilitazione richiesta'}</div></div>
        <button class="btn-outline-pill" onclick="openSafOperationModal(${o.id})">Modifica</button></div>`).join('') || '<div class="mod-empty">Nessuna operazione: creale in Finance → Oggetti di costo (tipo «operazione»), es. trattamento fitosanitario, pulizia vasche.</div>'}
    </div>
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>DPI</h3><p class="mod-intro">Dispositivi di protezione con la periodicità di sostituzione.</p></div>
        <div class="list-spacer"></div><button class="btn-generate" onclick="openSafPpeTypeModal()">${UI.icon.plus} Nuovo DPI</button></div>
      ${cfg.ppe_types.map(x => `<div class="mod-row ${x.active ? '' : 'cc-inactive'}"><div class="mod-row-main"><div class="mod-row-title">${esc(x.name)}</div>
        <div class="mod-row-sub">${x.replacement_months ? `Sostituzione ogni ${x.replacement_months} mesi` : 'Sostituzione a usura'}${x.sized ? ' · con taglia' : ''}</div></div>
        <button class="btn-outline-pill" onclick="openSafPpeTypeModal(${x.id})">Modifica</button></div>`).join('')}
    </div>
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>Responsabili della sicurezza e medico competente</h3></div></div>
      <div class="mod-body">
        <div class="field"><label>Responsabili sicurezza (possono concedere deroghe)</label>${safCheck('officer', HR.employees.filter(e => e.active), cfg.settings.safety_officer_ids, hrName)}</div>
        <div class="field"><label>Medico competente</label><input id="saf-doctor" value="${UI.attr(cfg.settings.doctor)}" placeholder="es. Dott.ssa Maria Bianchi"></div>
        <p class="mod-note">Per vedere i giudizi di idoneità di tutti, dai al loro ruolo il livello «sanitario» (Impostazioni → Ruoli e permessi). Il responsabile diretto vede quelli dei suoi collaboratori.</p>
        <button class="btn small" onclick="saveSafSettings()">Salva</button><div id="saf-settings-msg"></div>
      </div>
    </div>`;
}
async function saveSafSettings() {
  const box = document.getElementById('hr-safety-config-box');
  try {
    await api('/api/admin/hr/safety/settings', { method: 'PUT', body: JSON.stringify({ safety_officer_ids: safChecked(box, 'officer'), doctor: document.getElementById('saf-doctor').value }) });
    SAF.config = null;
    UI.msg(document.getElementById('saf-settings-msg'), 'Salvato.', 'success');
  } catch (e) { UI.msg(document.getElementById('saf-settings-msg'), e.message); }
}
function openSafTypeModal(id) {
  const x = SAF.config.training_types.find(t => t.id === id) || null;
  UI.modal({
    id: 'saf-type-modal', title: x ? `Modifica ${x.name}` : 'Nuovo corso', width: 540,
    body: `${x ? '' : '<div class="field"><label>Codice</label><input name="code" placeholder="es. motosega"></div>'}
      <div class="field"><label>Nome</label><input name="name" value="${UI.attr(x?.name)}"></div>
      <div class="field-row">
        <div class="field"><label>Categoria</label><select name="category">${UI.options(Object.entries(SAF_CATEGORIES).map(([id2, name]) => ({ id: id2, name })), x?.category || 'sicurezza')}</select></div>
        <div class="field"><label>Validità (mesi, vuota = non scade)</label><input name="validity_months" type="number" min="1" value="${UI.attr(x?.validity_months)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Ore iniziali</label><input name="initial_hours" inputmode="decimal" value="${x?.initial_minutes != null ? UI.attr(UI.decimal(x.initial_minutes / 60)) : ''}"></div>
        <div class="field"><label>Ore di aggiornamento</label><input name="update_hours" inputmode="decimal" value="${x?.update_minutes != null ? UI.attr(UI.decimal(x.update_minutes / 60)) : ''}"></div>
      </div>
      <div class="field"><label>Riferimento normativo</label><input name="legal_ref" value="${UI.attr(x?.legal_ref)}"></div>
      ${x ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Attivo</label>` : ''}
      <p class="mod-note">Cambiare la validità vale per i corsi registrati da ora in poi; le scadenze già calcolate restano.</p>`,
    onSave: async b => {
      const body = {};
      b.querySelectorAll('[name]').forEach(el => { body[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
      await api('/api/admin/hr/training-types' + (x ? `/${x.id}` : ''), { method: x ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadHrSafetyConfig();
    },
  });
}
function openSafOperationModal(id) {
  const o = SAF.config.operations.find(x => x.id === id);
  UI.modal({
    id: 'saf-op-modal', title: `Abilitazioni per ${o.name}`, width: 520,
    body: `${safCheck('otype', SAF.config.training_types.filter(t => t.active), o.training_type_ids)}<p class="mod-note">Es. trattamento fitosanitario → patentino fitosanitari; ingresso in vasca → spazi confinati; guida trattore → abilitazione trattori.</p>`,
    onSave: async b => {
      await api(`/api/admin/hr/operations/${o.id}/trainings`, { method: 'PUT', body: JSON.stringify({ training_type_ids: safChecked(b, 'otype') }) });
      loadHrSafetyConfig();
    },
  });
}
function openSafPpeTypeModal(id) {
  const x = SAF.config.ppe_types.find(t => t.id === id) || null;
  UI.modal({
    id: 'saf-ppetype-modal', title: x ? `Modifica ${x.name}` : 'Nuovo DPI', width: 480,
    body: `${x ? '' : '<div class="field"><label>Codice</label><input name="code" placeholder="es. visiera"></div>'}
      <div class="field"><label>Nome</label><input name="name" value="${UI.attr(x?.name)}"></div>
      <div class="field"><label>Sostituzione (mesi, vuota = a usura)</label><input name="replacement_months" type="number" min="1" value="${UI.attr(x?.replacement_months)}"></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="sized" ${x?.sized ? 'checked' : ''}> Ha la taglia</label>
      ${x ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:8px"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Attivo</label>` : ''}`,
    onSave: async b => {
      const body = {};
      b.querySelectorAll('[name]').forEach(el => { body[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
      await api('/api/admin/hr/ppe-types' + (x ? `/${x.id}` : ''), { method: x ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadHrSafetyConfig();
    },
  });
}
