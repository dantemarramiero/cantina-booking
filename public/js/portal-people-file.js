// Portale → People: scheda del dipendente (fascicolo), scadenzario, configurazione (mansioni, soglie, oneri).
const HR_TABS = [['organizzazione', 'Organizzazione'], ['personali', 'Dati personali'], ['lavoro', 'Rapporto di lavoro'], ['competenze', 'Competenze'], ['sicurezza', 'Sicurezza'], ['assenze', 'Assenze'], ['presenze', 'Presenze'], ['percorso', 'Ingresso e uscita'], ['documenti', 'Documenti'], ['scadenze', 'Scadenze']];
const HR_CONTRACT_TYPES = { OTD: 'Operaio a tempo determinato', OTI: 'Operaio a tempo indeterminato', impiegato: 'Impiegato', quadro: 'Quadro', dirigente: 'Dirigente', apprendista: 'Apprendista', stagionale: 'Stagionale', somministrato: 'Somministrato', collaboratore: 'Collaboratore' };
const HR_ID_DOCS = { carta_identita: "Carta d'identità", passaporto: 'Passaporto', patente: 'Patente', permesso_soggiorno: 'Permesso di soggiorno' };
const HR_SKILL_KINDS = { lingua: 'Lingue', titolo_studio: 'Titoli di studio', esperienza: 'Esperienze precedenti', qualifica: 'Qualifiche di settore', competenza: 'Competenze operative' };
const HR_LANGUAGES = { it: 'Italiano', en: 'Inglese', de: 'Tedesco', fr: 'Francese', es: 'Spagnolo', pt: 'Portoghese', ru: 'Russo', zh: 'Cinese', ja: 'Giapponese', nl: 'Olandese' };
const HR_LEVELS = { base: 'Base', personale: 'Personale', retributivo: 'Retributivo', sanitario: 'Sanitario', disciplinare: 'Disciplinare' };
const REC = { id: null, tab: 'organizzazione', org: null, file: null, safety: null, jobRoles: [], docTypes: [] };

function hrDaysLabel(d) {
  if (d.missing) return { cls: 'scaduto', text: 'mancante' };
  if (d.days_left < 0) return { cls: 'scaduto', text: `scaduto da ${-d.days_left} gg` };
  if (d.days_left === 0) return { cls: 'scaduto', text: 'scade oggi' };
  return { cls: d.days_left <= 30 ? 'soon' : 'later', text: `tra ${d.days_left} gg` };
}
function hrDeadlineRow(d, withName = false) {
  const l = hrDaysLabel(d);
  return `<div class="dl-item">
    <span class="dl-days ${l.cls}">${l.text}</span>
    <div class="mod-row-main" style="min-width:160px"><div class="mod-row-title">${withName ? `${esc(d.employee_name)} · ` : ''}${esc(d.label)}</div><div class="mod-row-sub">${d.missing ? `richiesto dal ${UI.date(d.due_date)}` : UI.date(d.due_date)}${d.site_name && withName ? ' · ' + esc(d.site_name) : ''}</div></div>
    ${d.blocking && d.days_left < 0 ? '<span class="badge red">Blocca le ore</span>' : d.blocking ? '<span class="badge yellow">Bloccante alla scadenza</span>' : ''}
  </div>`;
}

// ── Scheda ─────────────────────────────────────────────────────────────────────
// Mostra la sottosezione Dipendenti senza ricaricare l'elenco (la scheda si disegna al suo posto).
function hrShowEmployeesSub() {
  const nav = document.querySelector('[data-workspace-nav="people"]');
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.sub === 'people-dipendenti'));
  document.querySelectorAll('#module-people .subpanel').forEach(p => p.classList.toggle('active', p.id === 'sub-people-dipendenti'));
  if (typeof renderMobileSectionTabs === 'function') renderMobileSectionTabs('people');
}
async function openHrRecord(id, tab) {
  hrShowEmployeesSub();
  if (REC.id !== id) REC.tab = 'organizzazione';
  REC.id = id;
  if (tab) REC.tab = tab;
  const tok = HR.renderTok = (HR.renderTok || 0) + 1;
  const [org, file, jobRoles, docTypes] = await Promise.all([
    api(`/api/admin/hr/employees/${id}`), api(`/api/admin/hr/employees/${id}/file`),
    REC.jobRoles.length ? REC.jobRoles : api('/api/admin/hr/job-roles'), REC.docTypes.length ? REC.docTypes : api('/api/admin/hr/document-types'),
  ]);
  if (tok !== HR.renderTok) return;
  Object.assign(REC, { org, file, jobRoles, docTypes, safety: null, safetyFor: null, absences: null, timesheet: null, journey: null });
  if (REC.tab === 'sicurezza') await hrLoadSafety();
  if (REC.tab === 'assenze') await hrLoadAbsences();
  if (REC.tab === 'presenze') await hrLoadTimesheetSummary();
  if (REC.tab === 'percorso') await hrLoadJourney();
  renderHrRecord();
}
// La sezione sicurezza si carica solo quando la si apre: la lettura dell'idoneità viene registrata.
async function hrLoadSafety() {
  REC.safety = await api(`/api/admin/hr/employees/${REC.id}/safety`).catch(() => null);
  REC.safetyFor = REC.id;
}
async function hrSelectTab(k) {
  REC.tab = k;
  if (k === 'sicurezza' && REC.safetyFor !== REC.id) await hrLoadSafety();
  if (k === 'assenze' && REC.absences?.for !== REC.id) await hrLoadAbsences();
  if (k === 'presenze' && REC.timesheet?.for !== REC.id) await hrLoadTimesheetSummary();
  if (k === 'percorso' && REC.journey?.for !== REC.id) await hrLoadJourney();
  renderHrRecord();
}
function renderHrRecord() {
  const { org: e, file: f } = REC;
  const root = document.getElementById('people-dipendenti-root');
  const initials = `${e.first_name[0] || ''}${e.last_name[0] || ''}`.toUpperCase();
  const expiredBlocking = f.blocking_today.length;
  root.innerHTML = `<div class="list-card">
    <div class="rec-head">
      <button class="btn secondary small" onclick="REC.id = null; loadHrEmployees()">← Dipendenti</button>
      <div class="rec-avatar">${esc(initials)}</div>
      <div style="flex:1;min-width:180px">
        <div class="rec-name">${esc(hrName(e))}</div>
        <div class="rec-sub">${esc([e.job_title, f.current_contract ? (HR_CONTRACT_TYPES[f.current_contract.contract_type] || f.current_contract.contract_type) : null, f.current_contract?.job_role, e.site_name].filter(Boolean).join(' · ') || '—')}</div>
      </div>
      ${e.active ? '' : '<span class="badge grey">Non attivo</span>'}
      ${expiredBlocking ? `<span class="badge red" title="${UI.attr(f.blocking_today.join('; '))}">Ore bloccate</span>` : ''}
      <button class="btn-outline-pill" onclick="openHrEmployeeModal(${e.id})">Modifica dati</button>
    </div>
    <div class="rec-tabs">${HR_TABS.map(([k, l]) => `<button class="${REC.tab === k ? 'active' : ''}" onclick="hrSelectTab('${k}')">${l}${k === 'scadenze' && f.deadlines.length ? ` (${f.deadlines.length})` : ''}</button>`).join('')}</div>
    <div class="mod-body" id="hr-rec-body">${hrRecordTab()}</div>
  </div>`;
  if (REC.tab === 'competenze') hrSkillKindChanged();
  // Chi vede i dati solo perché sono i suoi (o senza il livello per modificarli) li legge e basta.
  if (['personali', 'competenze'].includes(REC.tab) && !f.access.edit.personale) hrReadOnly(document.getElementById('hr-rec-body'));
}
function hrReadOnly(box) {
  box.querySelectorAll('.hr-edit-only, button').forEach(el => el.remove());
  box.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
  box.insertAdjacentHTML('afterbegin', '<p class="mod-note" style="margin:0 0 14px">Sola lettura: per cambiare questi dati chiedi all\'ufficio del personale.</p>');
}
function hrRecordTab() {
  const { org: e, file: f } = REC;
  const locked = level => `<div class="rec-locked">Questi dati sono riservati: serve il livello di accesso «${HR_LEVELS[level]}».</div>`;
  switch (REC.tab) {
    case 'organizzazione': return hrTabOrganization(e);
    case 'personali': return f.access.personale ? hrTabPersonal(f) : locked('personale');
    case 'lavoro': return f.access.personale || f.access.retributivo ? hrTabWork(f) : locked('personale');
    case 'competenze': return f.access.personale ? hrTabSkills(f) : locked('personale');
    case 'sicurezza': return hrTabSafety();
    case 'assenze': return hrTabAbsences();
    case 'presenze': return hrTabTimesheet();
    case 'percorso': return hrTabJourney();
    case 'documenti': return hrTabDocuments(f);
    case 'scadenze': return f.deadlines.length ? f.deadlines.map(d => hrDeadlineRow(d)).join('') : '<div class="mod-empty">Nessuna scadenza nei prossimi 12 mesi.</div>';
    default: return '';
  }
}

function hrTabOrganization(e) {
  const s = e.schedule, costs = e.hourly_costs || [];
  const today = new Date().toISOString().slice(0, 10);
  return `
    <dl class="mod-kv">
      <dt>Ruolo</dt><dd>${esc(e.job_title || '—')}</dd>
      <dt>Sede</dt><dd>${esc(e.site_name || '—')}</dd>
      <dt>Centro di costo</dt><dd>${e.cost_center_code ? `${esc(e.cost_center_code)} ${esc(e.cost_center_name)}` : '—'}</dd>
      <dt>Contatti aziendali</dt><dd>${esc([e.work_email, e.work_phone].filter(Boolean).join(' · ') || '—')}</dd>
      <dt>Accesso al portale</dt><dd>${e.portal_username ? '@' + esc(e.portal_username) : 'No'}</dd>
      <dt>Responsabile</dt><dd>${e.approval.approver ? esc(e.approval.approver.name) : '<span style="color:var(--bad)">Nessuno</span>'}${e.approval.escalated ? ' <span class="badge yellow">salito di livello</span>' : ''}</dd>
      <dt>Delegato</dt><dd>${e.approval.delegate ? esc(e.approval.delegate.name) : '—'}</dd>
      <dt>Collaboratori</dt><dd>${e.reports.length ? e.reports.map(r => esc(r.name)).join(', ') : '—'}</dd>
      <dt>Squadre</dt><dd>${e.teams.length ? e.teams.map(t => `${esc(t.name)}${t.is_leader ? ' (caposquadra)' : ''}`).join(', ') : '—'}</dd>
    </dl>
    ${e.can_see_schedule ? `
      <div class="mod-section-title" style="margin-top:24px">Orario contrattuale (ore per giorno)</div>
      <div class="mod-week" id="hr-week">${Object.entries(PPL_WEEKDAYS).map(([d, l]) => `<div class="field" style="margin:0"><label>${l}</label><input inputmode="decimal" data-day="${d}" value="${s ? UI.decimal((s.days[d] || 0) / 60) : ''}" placeholder="0"></div>`).join('')}</div>
      <div class="field-row" style="margin-top:10px;align-items:end">
        <div class="field" style="margin:0"><label>In vigore dal</label><input type="date" id="hr-week-from" value="${today}"></div>
        <div><button class="btn secondary small" type="button" onclick="saveHrSchedule(${e.id})">Salva orario</button></div>
      </div>
      <p class="mod-note">${s ? `Orario attuale dal ${UI.date(s.valid_from)}: ${UI.decimal(s.weekly_minutes / 60)} ore a settimana.` : 'Nessun orario impostato.'} Un nuovo orario vale dalla data indicata; lo storico resta.</p>
      <div id="hr-week-msg"></div>` : ''}
    ${e.can_see_costs ? `
      <div class="mod-section-title" style="margin-top:24px">Costo orario standard <span class="badge grey">riservato</span></div>
      ${costs.length ? `<div class="mod-table-wrap"><table class="mod-table" style="min-width:0"><thead><tr><th>Dal</th><th>Al</th><th class="num">€ / ora</th><th></th></tr></thead><tbody>
        ${costs.map(c => `<tr><td>${UI.date(c.valid_from)}</td><td>${c.valid_to ? UI.date(c.valid_to) : 'in vigore'}</td><td class="num">€ ${UI.decimal(c.cost_per_hour)}</td>
          <td><button class="btn-outline-pill danger" type="button" title="Elimina" onclick="deleteHrCost(${c.id}, ${e.id})">${UI.icon.trash}</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="mod-note">Nessun costo orario: in Finance le sue ore andranno in anomalia finché non lo inserisci.</p>'}
      <div class="field-row" style="margin-top:10px;align-items:end">
        <div class="field" style="margin:0"><label>Dal</label><input type="date" id="hr-cost-from" value="${today}"></div>
        <div class="field" style="margin:0"><label>€ / ora (fino a 4 decimali)</label><input id="hr-cost-value" inputmode="decimal" placeholder="es. 23,4567"></div>
        <div><button class="btn secondary small" type="button" onclick="addHrCost(${e.id})">Aggiungi</button></div>
      </div>
      <div id="hr-cost-msg"></div>` : ''}`;
}

function hrTabPersonal(f) {
  const p = f.personal.data || {};
  const field = (name, label, type = 'text', extra = '') => `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${UI.attr(p[name])}" ${extra}></div>`;
  const contacts = f.personal.emergency_contacts.length ? f.personal.emergency_contacts : [{}];
  return `<div id="hr-personal-form">
    <div class="mod-section-title">Anagrafica</div>
    <div class="field-row">${field('fiscal_code', 'Codice fiscale', 'text', 'style="text-transform:uppercase"')}${field('birth_date', 'Data di nascita', 'date')}${field('birth_place', 'Luogo di nascita')}</div>
    <div class="field-row">
      <div class="field"><label>Sesso</label><select name="sex">${UI.options([{ id: 'F', name: 'F' }, { id: 'M', name: 'M' }, { id: 'X', name: 'X' }], p.sex, { empty: '—' })}</select></div>
      ${field('citizenship', 'Cittadinanza')}${field('iban', 'IBAN')}
    </div>
    <div class="mod-section-title">Residenza e contatti personali</div>
    <div class="field-row">${field('residence_address', 'Indirizzo di residenza')}${field('residence_postal_code', 'CAP')}${field('residence_city', 'Comune')}</div>
    <div class="field-row">${field('residence_province', 'Provincia', 'text', 'maxlength="2"')}${field('domicile', 'Domicilio (se diverso)')}</div>
    <div class="field-row">${field('personal_email', 'Email personale', 'email')}${field('personal_phone', 'Telefono personale')}</div>
    <div class="mod-section-title">Taglie (DPI e abbigliamento)</div>
    <div class="field-row">${field('size_shirt', 'Maglia / giacca')}${field('size_pants', 'Pantaloni')}${field('size_shoes', 'Scarpe')}</div>
    <div class="mod-section-title">Contatti di emergenza</div>
    <div class="mod-edit-rows" id="hr-emergency">${contacts.map(hrEmergencyRow).join('')}</div>
    <button class="btn secondary small" style="margin-top:8px" type="button" onclick="document.getElementById('hr-emergency').insertAdjacentHTML('beforeend', hrEmergencyRow({}))">+ Aggiungi contatto</button>
    <div style="margin-top:16px"><button class="btn" type="button" onclick="saveHrPersonal()">Salva dati personali</button></div>
    <div id="hr-personal-msg"></div>
  </div>
  <div class="mod-section-title" style="margin-top:28px">Documenti d'identità e permessi di soggiorno</div>
  ${f.personal.identity_documents.map(d => `<div class="dl-item">
    <div class="mod-row-main"><div class="mod-row-title">${esc(HR_ID_DOCS[d.doc_type])}${d.number ? ` · ${esc(d.number)}` : ''}${d.permit_type ? ` · ${esc(d.permit_type)}` : ''}</div>
      <div class="mod-row-sub">${d.expires_on ? `scade il ${UI.date(d.expires_on)}` : 'senza scadenza indicata'}</div></div>
    <button class="btn-outline-pill danger" title="Elimina" onclick="deleteHrIdDoc(${d.id})">${UI.icon.trash}</button>
  </div>`).join('') || '<p class="mod-note">Nessun documento inserito.</p>'}
  <div class="field-row hr-edit-only" style="margin-top:10px;align-items:end">
    <div class="field" style="margin:0"><label>Tipo</label><select id="hr-id-type" onchange="document.getElementById('hr-id-permit').style.display = this.value === 'permesso_soggiorno' ? '' : 'none'">${UI.options(Object.entries(HR_ID_DOCS).map(([id, name]) => ({ id, name })), 'carta_identita')}</select></div>
    <div class="field" style="margin:0"><label>Numero</label><input id="hr-id-number"></div>
    <div class="field" style="margin:0;display:none" id="hr-id-permit"><label>Tipo di permesso</label><input id="hr-id-permit-type" placeholder="es. lavoro stagionale"></div>
    <div class="field" style="margin:0"><label>Scadenza</label><input type="date" id="hr-id-expires"></div>
    <div><button class="btn secondary small" type="button" onclick="addHrIdDoc()">Aggiungi</button></div>
  </div>
  <p class="mod-note">Un permesso di soggiorno scaduto blocca l'inserimento delle ore e viene segnalato al responsabile.</p>
  <div id="hr-id-msg"></div>`;
}
function hrEmergencyRow(c) {
  return `<div class="mod-edit-row" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) auto">
    <input data-ec="name" placeholder="Nome" value="${UI.attr(c.name)}"><input data-ec="relationship" placeholder="Relazione" value="${UI.attr(c.relationship)}">
    <input data-ec="phone" placeholder="Telefono" value="${UI.attr(c.phone)}"><button type="button" class="btn-outline-pill danger" onclick="this.parentElement.remove()">×</button>
  </div>`;
}
async function saveHrPersonal() {
  const form = document.getElementById('hr-personal-form');
  const body = {};
  form.querySelectorAll('[name]').forEach(el => { body[el.name] = el.value.trim(); });
  body.emergency_contacts = [...form.querySelectorAll('#hr-emergency .mod-edit-row')].map(row => Object.fromEntries([...row.querySelectorAll('[data-ec]')].map(i => [i.dataset.ec, i.value.trim()])));
  try {
    await api(`/api/admin/hr/employees/${REC.id}/personal`, { method: 'PUT', body: JSON.stringify(body) });
    await openHrRecord(REC.id);
    UI.msg(document.getElementById('hr-personal-msg'), 'Dati salvati.', 'success');
  } catch (e) { UI.msg(document.getElementById('hr-personal-msg'), e.message); }
}
async function addHrIdDoc() {
  const type = document.getElementById('hr-id-type').value;
  try {
    await api(`/api/admin/hr/employees/${REC.id}/identity-documents`, { method: 'POST', body: JSON.stringify({
      doc_type: type, number: document.getElementById('hr-id-number').value, permit_type: document.getElementById('hr-id-permit-type').value, expires_on: document.getElementById('hr-id-expires').value || null,
    }) });
    openHrRecord(REC.id);
  } catch (e) { UI.msg(document.getElementById('hr-id-msg'), e.message); }
}
function deleteHrIdDoc(id) { UI.confirmDo('Eliminare questo documento?', () => api(`/api/admin/hr/identity-documents/${id}`, { method: 'DELETE' }), () => openHrRecord(REC.id)); }

function hrTabWork(f) {
  const cs = f.contracts || [];
  const comp = f.compensation;
  return `${f.access.personale ? `
    <div class="mod-section-title">Contratto — storico delle versioni</div>
    ${cs.length ? `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Ver.</th><th>Dal</th><th>Tipo</th><th>Mansione</th><th>CCNL · livello</th><th>Fine / prova</th><th>Part-time</th><th>Sede · centro</th></tr></thead><tbody>
      ${cs.map(c => `<tr><td>${c.version}</td><td>${UI.date(c.effective_from)}</td><td>${esc(HR_CONTRACT_TYPES[c.contract_type] || c.contract_type)}${c.termination_date ? `<br><span class="badge red">Cessato ${UI.date(c.termination_date)}</span>` : ''}</td>
        <td>${esc(c.job_role_name || '—')}</td><td>${esc([c.ccnl, c.level].filter(Boolean).join(' · ') || '—')}</td>
        <td>${c.end_date ? `fine ${UI.date(c.end_date)}` : '—'}${c.probation_end ? `<br>prova fino al ${UI.date(c.probation_end)}` : ''}</td>
        <td>${c.part_time_pct ? c.part_time_pct + '%' : 'no'}</td><td>${esc([c.site_name, c.cost_center_code].filter(Boolean).join(' · ') || '—')}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="mod-note">Nessun contratto registrato.</p>'}
    ${f.access.edit.personale ? `<button class="btn secondary small" style="margin-top:10px" onclick="openHrContractModal()">${cs.length ? '+ Nuova versione (proroga, trasformazione, variazione, cessazione)' : '+ Primo contratto'}</button>` : ''}
    <p class="mod-note">Un contratto non si modifica mai: ogni cambiamento è una nuova versione con la sua decorrenza. Sede, centro e responsabile vengono copiati dalla scheda Organizzazione.</p>` : ''}
  ${comp ? `
    <div class="mod-section-title" style="margin-top:26px">Retribuzione <span class="badge grey">riservato</span></div>
    ${comp.items.length ? `<div class="mod-table-wrap"><table class="mod-table" style="min-width:0"><thead><tr><th>Dal</th><th>Tipo</th><th class="num">Importo</th><th class="num">Superminimo</th><th class="num">Indennità</th><th>Benefit</th></tr></thead><tbody>
      ${comp.items.map(c => `<tr><td>${UI.date(c.effective_from)}</td><td>${c.pay_type === 'ral' ? 'RAL annua' : 'Paga oraria'}</td><td class="num">${c.pay_type === 'ral' ? UI.euro(c.ral_cents) : `€ ${UI.decimal(c.hourly)} / h`}</td>
        <td class="num">${UI.euro(c.superminimo_cents)}</td><td class="num">${UI.euro(c.allowances_cents)}</td><td>${esc(c.benefits || '—')}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="mod-note">Nessuna retribuzione registrata.</p>'}
    ${comp.proposal ? `<div class="mod-ok" style="margin-top:12px">Costo orario standard proposto: <b>€ ${UI.decimal(comp.proposal.cost_per_hour)} / h</b> (oneri ${UI.decimal(comp.proposal.employer_cost_pct)}%, ${UI.decimal(comp.proposal.weekly_minutes / 60)} h a settimana).
      ${f.access.edit.retributivo ? `<button class="btn small" style="margin-left:8px" onclick="useHrCostProposal('${comp.proposal.cost_per_hour}')">Usa come costo orario</button>` : ''}</div>` : ''}
    ${f.access.edit.retributivo ? '<button class="btn secondary small" style="margin-top:10px" onclick="openHrCompensationModal()">+ Nuova retribuzione</button>' : ''}
    <p class="mod-note">La proposta è solo un suggerimento: il costo orario usato da Finance è quello confermato nella scheda Organizzazione.</p>` : ''}`;
}
function openHrContractModal() {
  const prev = (REC.file.contracts || [])[0] || {};
  UI.modal({
    id: 'hr-contract-modal', title: prev.version ? `Versione ${prev.version + 1} del contratto` : 'Primo contratto', width: 660,
    body: `
      <div class="field-row">
        <div class="field"><label>In vigore dal</label><input type="date" name="effective_from" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Tipo di contratto</label><select name="contract_type">${UI.options(Object.entries(HR_CONTRACT_TYPES).map(([id, name]) => ({ id, name })), prev.contract_type || 'OTI')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Mansione</label><select name="job_role_id">${UI.options(REC.jobRoles.filter(j => j.active), prev.job_role_id, { empty: '— Nessuna —' })}</select></div>
        <div class="field"><label>CCNL</label><input name="ccnl" value="${UI.attr(prev.ccnl)}" placeholder="es. Operai agricoli e florovivaisti"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Livello</label><input name="level" value="${UI.attr(prev.level)}"></div>
        <div class="field"><label>Qualifica</label><input name="qualification" value="${UI.attr(prev.qualification)}"></div>
        <div class="field"><label>Part-time (%)</label><input name="part_time_pct" type="number" min="1" max="100" value="${UI.attr(prev.part_time_pct)}" placeholder="vuoto = tempo pieno"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Data di assunzione</label><input type="date" name="hire_date" value="${UI.attr(prev.hire_date)}"></div>
        <div class="field"><label>Fine contratto (a termine)</label><input type="date" name="end_date" value="${UI.attr(prev.end_date)}"></div>
        <div class="field"><label>Fine periodo di prova</label><input type="date" name="probation_end" value="${UI.attr(prev.probation_end)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Cessazione (data)</label><input type="date" name="termination_date"></div>
        <div class="field"><label>Motivo della cessazione</label><input name="termination_reason"></div>
        <div class="field"><label>Da richiamare?</label><select name="rehire_ok">${UI.options([{ id: '1', name: 'Sì' }, { id: '0', name: 'No' }], prev.rehire_ok == null ? '' : String(prev.rehire_ok), { empty: '—' })}</select></div>
      </div>
      <div class="field"><label>Note</label><input name="notes"></div>
      <p class="mod-note">I campi sono precompilati con la versione in vigore: cambia solo ciò che cambia. Per gli stagionali, «Da richiamare» serve a ritrovarli per la campagna successiva.</p>`,
    onSave: async b => {
      const body = {};
      b.querySelectorAll('[name]').forEach(el => { body[el.name] = el.value.trim(); });
      await api(`/api/admin/hr/employees/${REC.id}/contracts`, { method: 'POST', body: JSON.stringify(body) });
      openHrRecord(REC.id);
    },
  });
}
function openHrCompensationModal() {
  UI.modal({
    id: 'hr-comp-modal', title: 'Nuova retribuzione', width: 560,
    body: `
      <div class="field-row">
        <div class="field"><label>Dal</label><input type="date" name="effective_from" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Tipo</label><select name="pay_type" onchange="const b=this.closest('.modal-box'); b.querySelector('[data-ral]').style.display = this.value === 'ral' ? '' : 'none'; b.querySelector('[data-hourly]').style.display = this.value === 'oraria' ? '' : 'none'">${UI.options([{ id: 'ral', name: 'RAL annua' }, { id: 'oraria', name: 'Paga oraria' }], 'ral')}</select></div>
      </div>
      <div class="field" data-ral><label>RAL (€ lordi annui)</label><input name="ral" inputmode="decimal"></div>
      <div class="field" data-hourly style="display:none"><label>Paga oraria (€, fino a 4 decimali)</label><input name="hourly" inputmode="decimal"></div>
      <div class="field-row">
        <div class="field"><label>Superminimo (€ annui)</label><input name="superminimo" inputmode="decimal"></div>
        <div class="field"><label>Indennità (€ annue)</label><input name="allowances" inputmode="decimal"></div>
      </div>
      <div class="field"><label>Benefit</label><input name="benefits" placeholder="es. auto aziendale, buoni pasto"></div>`,
    onSave: async b => {
      const body = {};
      b.querySelectorAll('[name]').forEach(el => { body[el.name] = el.value.trim(); });
      for (const k of ['ral', 'hourly', 'superminimo', 'allowances']) body[k] = UI.num(body[k]);
      await api(`/api/admin/hr/employees/${REC.id}/compensations`, { method: 'POST', body: JSON.stringify(body) });
      openHrRecord(REC.id);
    },
  });
}
function useHrCostProposal(cost) {
  UI.modal({
    id: 'hr-cost-proposal-modal', title: 'Conferma il costo orario standard', width: 460, saveLabel: 'Conferma',
    body: `
      <div class="field-row">
        <div class="field"><label>Vale dal</label><input type="date" name="valid_from" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>€ / ora</label><input name="cost_per_hour" inputmode="decimal" value="${UI.attr(UI.decimal(cost))}"></div>
      </div>
      <p class="mod-note">Il costo precedente si chiude il giorno prima. Finance userà questo valore per le ore lavorate da questa data.</p>`,
    onSave: async b => {
      await api(`/api/admin/hr/employees/${REC.id}/hourly-costs`, { method: 'POST', body: JSON.stringify({ valid_from: UI.val(b, 'valid_from'), cost_per_hour: UI.num(UI.val(b, 'cost_per_hour')), note: 'Dalla proposta sulla retribuzione' }) });
      openHrRecord(REC.id, 'organizzazione');
    },
  });
}

function hrTabSkills(f) {
  const by = Object.keys(HR_SKILL_KINDS).map(k => [k, f.skills.filter(s => s.kind === k)]);
  return `${by.map(([k, list]) => `<div class="mod-section-title">${HR_SKILL_KINDS[k]}</div>
    ${list.map(s => `<div class="dl-item"><div class="mod-row-main"><div class="mod-row-title">${esc(k === 'lingua' ? (HR_LANGUAGES[s.name] || s.name.toUpperCase()) : s.name)}${s.level ? ` · ${esc(s.level)}` : ''}</div>
      ${s.issued_on || s.expires_on || s.notes ? `<div class="mod-row-sub">${[s.issued_on ? `dal ${UI.date(s.issued_on)}` : null, s.expires_on ? `scade il ${UI.date(s.expires_on)}` : null, s.notes].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</div>
      <button class="btn-outline-pill danger" title="Elimina" onclick="deleteHrSkill(${s.id})">${UI.icon.trash}</button></div>`).join('') || '<p class="mod-note" style="margin:0 0 6px">—</p>'}`).join('')}
    <div class="hr-edit-only">
    <div class="mod-section-title" style="margin-top:24px">Aggiungi</div>
    <div class="field-row" style="align-items:end">
      <div class="field" style="margin:0"><label>Tipo</label><select id="hr-skill-kind" onchange="hrSkillKindChanged()">${UI.options(Object.entries(HR_SKILL_KINDS).map(([id, name]) => ({ id, name })), 'lingua')}</select></div>
      <div class="field" style="margin:0" id="hr-skill-name-box"></div>
      <div class="field" style="margin:0"><label>Livello</label><input id="hr-skill-level" placeholder="es. C1, madrelingua"></div>
      <div class="field" style="margin:0"><label>Scadenza (se c'è)</label><input type="date" id="hr-skill-expires"></div>
      <div><button class="btn secondary small" onclick="addHrSkill()">Aggiungi</button></div>
    </div>
    <p class="mod-note">Le lingue serviranno all'Enoturismo per assegnare le visite nella lingua giusta.</p>
    <div id="hr-skill-msg"></div>
    </div>`;
}
function hrSkillKindChanged() {
  const box = document.getElementById('hr-skill-name-box');
  if (!box) return;
  box.innerHTML = document.getElementById('hr-skill-kind').value === 'lingua'
    ? `<label>Lingua</label><select id="hr-skill-name">${UI.options(Object.entries(HR_LANGUAGES).map(([id, name]) => ({ id, name })), 'en')}</select>`
    : '<label>Nome</label><input id="hr-skill-name" placeholder="es. Sommelier AIS, patente C, potatura">';
}
async function addHrSkill() {
  try {
    await api(`/api/admin/hr/employees/${REC.id}/skills`, { method: 'POST', body: JSON.stringify({
      kind: document.getElementById('hr-skill-kind').value, name: document.getElementById('hr-skill-name').value, level: document.getElementById('hr-skill-level').value, expires_on: document.getElementById('hr-skill-expires').value || null,
    }) });
    openHrRecord(REC.id);
  } catch (e) { UI.msg(document.getElementById('hr-skill-msg'), e.message); }
}
function deleteHrSkill(id) { UI.confirmDo('Eliminare questa voce?', () => api(`/api/admin/hr/skills/${id}`, { method: 'DELETE' }), () => openHrRecord(REC.id)); }

function hrTabDocuments(f) {
  const docs = f.documents;
  return `${docs.length ? `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Tipo</th><th>Titolo</th><th>Versione</th><th>Data</th><th>Scadenza</th><th>Caricato</th><th>Livello</th><th></th></tr></thead><tbody>
    ${docs.map(d => `<tr style="${d.current ? '' : 'opacity:.55'}"><td>${esc(d.type_name)}</td><td><a class="plain" href="${UI.attr(d.download_url)}">${esc(d.title)}</a></td><td>${d.version}${d.current ? '' : ' (superata)'}</td>
      <td>${UI.date(d.doc_date)}</td><td>${d.valid_until ? UI.date(d.valid_until) : '—'}</td><td>${esc(new Date(d.uploaded_at).toLocaleDateString('it-IT'))} · ${esc(d.uploaded_by || '')}</td>
      <td><span class="badge grey">${esc(HR_LEVELS[d.level])}</span></td>
      <td style="white-space:nowrap">${!f.access.upload_types.includes(d.type_code) ? '' : `${d.current ? `<button class="btn-outline-pill" title="Carica una nuova versione" onclick="openHrDocModal('${d.type_code}', ${d.id})">Nuova versione</button>` : ''}<button class="btn-outline-pill danger" title="Elimina" onclick="deleteHrDoc(${d.id})">${UI.icon.trash}</button>`}</td></tr>`).join('')}
  </tbody></table></div>` : '<div class="mod-empty">Nessun documento che tu possa vedere.</div>'}
  ${f.access.upload_types.length ? '<button class="btn secondary small" style="margin-top:12px" onclick="openHrDocModal()">+ Carica documento</button>' : ''}
  <p class="mod-note">I file sono cifrati e si aprono con un link che scade dopo pochi minuti. Ogni tipo di documento ha il suo livello di riservatezza; le aperture dei documenti sanitari sono registrate.</p>`;
}
function openHrDocModal(type, supersedes) {
  UI.modal({
    id: 'hr-doc-modal', title: supersedes ? 'Nuova versione del documento' : 'Carica documento', width: 520,
    body: `
      <div class="field"><label>Tipo</label><select name="type_code" ${supersedes ? 'disabled' : ''}>${UI.options(REC.docTypes.filter(t => REC.file.access.upload_types.includes(t.code)), type || 'contratto', { value: t => t.code, label: t => `${t.name} (${HR_LEVELS[t.level]})` })}</select></div>
      <div class="field"><label>Titolo</label><input name="title" placeholder="es. Cedolino settembre 2026"></div>
      <div class="field-row">
        <div class="field"><label>Data del documento</label><input type="date" name="doc_date"></div>
        <div class="field"><label>Scadenza (se c'è)</label><input type="date" name="valid_until"></div>
      </div>
      <div class="field"><label>File</label><input type="file" name="file"></div>`,
    saveLabel: 'Carica',
    onSave: async b => {
      const file = b.querySelector('[name="file"]').files[0];
      if (!file) throw new Error('Scegli un file.');
      const fd = new FormData();
      fd.append('type_code', b.querySelector('[name="type_code"]').value);
      for (const k of ['title', 'doc_date', 'valid_until']) fd.append(k, b.querySelector(`[name="${k}"]`).value);
      if (supersedes) fd.append('supersedes_id', supersedes);
      fd.append('file', file);
      await api(`/api/admin/hr/employees/${REC.id}/documents`, { method: 'POST', body: fd });
      openHrRecord(REC.id, 'documenti');
    },
  });
}
function deleteHrDoc(id) { UI.confirmDo('Eliminare definitivamente questo documento?', () => api(`/api/admin/hr/documents/${id}`, { method: 'DELETE' }), () => openHrRecord(REC.id, 'documenti')); }

// ── Scadenzario ────────────────────────────────────────────────────────────────
const HR_DL_KINDS = { permesso_soggiorno: 'Permessi di soggiorno', documento_identita: "Documenti d'identità", contratto_termine: 'Contratti a termine', periodo_prova: 'Periodi di prova', documento_hr: 'Documenti HR',
  formazione: 'Formazione', abilitazione: 'Abilitazioni', formazione_mancante: 'Formazione mancante', visita_medica: 'Visite mediche', dpi: 'DPI', attivita: 'Attività', ferie_arretrate: 'Ferie arretrate' };
async function loadHrDeadlines() {
  const root = document.getElementById('people-scadenze-root');
  const f = HR.dlFilter || (HR.dlFilter = { within: 90, site_id: '', team_id: '', kind: '' });
  const [items, sites, teams] = await Promise.all([
    api(`/api/admin/hr/deadlines?within=${f.within}${f.site_id ? `&site_id=${f.site_id}` : ''}${f.team_id ? `&team_id=${f.team_id}` : ''}${f.kind ? `&kind=${f.kind}` : ''}`),
    api('/api/admin/hr/sites'), api('/api/admin/hr/teams'),
  ]);
  const set = (k, v) => `HR.dlFilter.${k} = ${v}; loadHrDeadlines()`;
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Scadenzario HR</h3><p class="mod-intro">Tutte le scadenze del personale in un'unica vista. Le notifiche partono da sole alle soglie di preavviso (Configurazione).</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields">
        <select onchange="${set('within', 'parseInt(this.value)')}">${[30, 60, 90, 180, 365].map(d => `<option value="${d}" ${d === f.within ? 'selected' : ''}>entro ${d} giorni</option>`).join('')}</select>
        <select onchange="${set('kind', 'this.value')}">${UI.options(Object.entries(HR_DL_KINDS).map(([id, name]) => ({ id, name })), f.kind, { empty: 'Tutti i tipi' })}</select>
        <select onchange="${set('site_id', 'this.value')}">${UI.options(sites, f.site_id, { empty: 'Tutte le sedi' })}</select>
        <select onchange="${set('team_id', 'this.value')}">${UI.options(teams, f.team_id, { empty: 'Tutte le squadre' })}</select>
      </div>
    </div>
    <div class="mod-body">${items.length ? items.map(d => `<div class="mod-clickable" onclick="openHrRecord(${d.employee_id}, 'scadenze')">${hrDeadlineRow(d, true)}</div>`).join('') : '<div class="mod-empty">Nessuna scadenza nel periodo scelto.</div>'}</div>
  </div>`;
}

// ── Configurazione di People ───────────────────────────────────────────────────
async function loadHrConfig() {
  const root = document.getElementById('people-sedi-root');
  root.innerHTML = '<div id="hr-sites-box"></div><div id="hr-config-box"></div><div id="hr-safety-config-box"></div><div id="hr-absence-config-box"></div><div id="hr-timesheet-config-box"></div><div id="hr-checklist-config-box"></div>';
  await loadHrSites();
  const [roles, settings] = await Promise.all([api('/api/admin/hr/job-roles'), api('/api/admin/hr/settings'), safConfig(true)]);
  REC.jobRoles = roles;
  document.getElementById('hr-config-box').innerHTML = `
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>Mansioni</h3><p class="mod-intro">Le mansioni dei contratti, con la formazione obbligatoria e la sorveglianza sanitaria di ciascuna.</p></div>
        <div class="list-spacer"></div><button class="btn-generate" onclick="openHrJobRoleModal()">${UI.icon.plus} Nuova mansione</button></div>
      ${roles.map(j => `<div class="mod-row ${j.active ? '' : 'cc-inactive'}"><div class="mod-row-main"><div class="mod-row-title">${esc(j.name)}</div><div class="mod-row-sub">${esc(j.code)} · ${hrRoleSafetySummary(j.id)}${j.allows_waiver ? ' · ammette deroghe' : ''}</div></div>
        <button class="btn-outline-pill" onclick="openHrJobRoleModal(${j.id})">Modifica</button></div>`).join('')}
    </div>
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>Scadenzario e costo del lavoro</h3></div></div>
      <div class="mod-body">
        <div class="field-row">
          <div class="field"><label>Soglie di preavviso (giorni, separate da virgola)</label><input id="hr-set-thresholds" value="${UI.attr(settings.deadline_thresholds.join(', '))}"></div>
          <div class="field"><label>Oneri a carico azienda (%)</label><input id="hr-set-cost" inputmode="decimal" value="${UI.attr(UI.decimal(settings.employer_cost_pct))}"></div>
        </div>
        <p class="mod-note">Le soglie decidono quando parte una notifica (a HR, al responsabile e al dipendente). Gli oneri servono solo a proporre il costo orario dalla retribuzione.</p>
        <button class="btn small" onclick="saveHrSettings()">Salva</button><div id="hr-set-msg"></div>
      </div>
    </div>`;
  loadHrSafetyConfig();
  loadHrAbsenceConfig();
  loadHrTimesheetConfig();
  loadHrChecklistConfig();
}
async function saveHrSettings() {
  try {
    await api('/api/admin/hr/settings', { method: 'PUT', body: JSON.stringify({
      deadline_thresholds: document.getElementById('hr-set-thresholds').value.split(/[,\s]+/).filter(Boolean).map(Number),
      employer_cost_pct: document.getElementById('hr-set-cost').value,
    }) });
    UI.msg(document.getElementById('hr-set-msg'), 'Salvato.', 'success');
  } catch (e) { UI.msg(document.getElementById('hr-set-msg'), e.message); }
}
function hrRoleSafetySummary(id) {
  const r = SAF.config?.job_roles.find(x => x.id === id);
  if (!r) return '';
  const n = r.training_type_ids.length;
  return `${n ? `${n} ${n === 1 ? 'corso obbligatorio' : 'corsi obbligatori'}` : 'nessun corso obbligatorio'}${r.medical_surveillance ? ' · sorveglianza sanitaria' : ''}`;
}
async function openHrJobRoleModal(id) {
  const j = REC.jobRoles.find(x => x.id === id) || null;
  const cfg = await safConfig();
  const sj = cfg.job_roles.find(x => x.id === id);
  UI.modal({
    id: 'hr-jobrole-modal', title: j ? `Modifica ${j.name}` : 'Nuova mansione', width: 480,
    body: `${j ? '' : '<div class="field"><label>Codice</label><input name="code" placeholder="es. potatore"></div>'}
      <div class="field"><label>Nome</label><input name="name" value="${UI.attr(j?.name)}"></div>
      <div class="field"><label>Descrizione</label><input name="description" value="${UI.attr(j?.description)}"></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="allows_waiver" ${j?.allows_waiver ? 'checked' : ''}> Ammette deroghe motivate del responsabile sicurezza</label>
      ${j ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:8px"><input type="checkbox" name="active" ${j.active ? 'checked' : ''}> Attiva</label>` : ''}
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:8px"><input type="checkbox" data-medical ${sj?.medical_surveillance ? 'checked' : ''}> Soggetta a sorveglianza sanitaria (visita medica obbligatoria)</label>
      <div class="field" style="margin-top:14px"><label>Formazione obbligatoria</label>${safCheck('rtype', cfg.training_types.filter(t => t.active), sj?.training_type_ids || [])}</div>`,
    onSave: async b => {
      const body = {};
      b.querySelectorAll('[name]').forEach(el => { body[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
      const res = await api('/api/admin/hr/job-roles' + (j ? `/${j.id}` : ''), { method: j ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      await api(`/api/admin/hr/job-roles/${j ? j.id : res.id}/safety`, { method: 'PUT', body: JSON.stringify({ training_type_ids: safChecked(b, 'rtype'), medical_surveillance: b.querySelector('[data-medical]').checked }) });
      REC.jobRoles = [];
      loadHrConfig();
    },
  });
}
