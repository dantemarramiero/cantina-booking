// Portale → People (Fase 1): dipendenti con responsabile e delegato, orario contrattuale, costo
// orario (livello retributivo), squadre, sedi e festività. Il fascicolo completo arriva in Fase 2.
const PPL_WEEKDAYS = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Gio', 5: 'Ven', 6: 'Sab', 7: 'Dom' };
const HR = { employees: [], sites: [], teams: [], year: new Date().getFullYear(), siteId: null };

const hrName = e => `${e.first_name} ${e.last_name}`;
async function hrLoadBasics() {
  const [employees, sites, centers] = await Promise.all([api('/api/admin/hr/employees'), api('/api/admin/hr/sites'), api('/api/admin/finance/cost-centers')]);
  HR.employees = employees; HR.sites = sites; FIN.centers = centers;
}

// ── Dipendenti ─────────────────────────────────────────────────────────────────
async function loadHrEmployees() {
  const root = document.getElementById('people-dipendenti-root');
  await hrLoadBasics();
  const q = (document.getElementById('hr-emp-search')?.value || '').toLowerCase();
  const shown = HR.employees.filter(e => !q || `${hrName(e)} ${e.job_title || ''}`.toLowerCase().includes(q));
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="search-input"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="hr-emp-search" placeholder="Cerca dipendente" value="${UI.attr(q)}" oninput="loadHrEmployees()"></div>
      <div class="list-spacer"></div>
      <button class="btn-generate" onclick="openHrEmployeeModal()">${UI.icon.plus} Nuovo dipendente</button>
    </div>
    ${shown.map(e => `<div class="mod-row mod-clickable ${e.active ? '' : 'cc-inactive'}" onclick="openHrEmployeeDetail(${e.id})">
      <div class="mod-row-main">
        <div class="mod-row-title">${esc(hrName(e))}${e.job_title ? ` <span style="font-weight:400;color:var(--ink-soft)">· ${esc(e.job_title)}</span>` : ''}</div>
        <div class="mod-row-sub">${[e.site_name, e.cost_center_code ? `${e.cost_center_code} ${e.cost_center_name}` : null, e.manager_name ? `responsabile: ${e.manager_name}` : null].filter(Boolean).map(esc).join(' · ') || 'Dati organizzativi da completare'}</div>
      </div>
      ${e.portal_username ? `<span class="badge grey" title="Accede al portale">@${esc(e.portal_username)}</span>` : ''}
      ${e.active ? '' : '<span class="badge grey">Non attivo</span>'}
    </div>`).join('') || `<div class="mod-empty">${q ? 'Nessun dipendente trovato.' : 'Nessun dipendente. Inizia con «Nuovo dipendente».'}</div>`}
  </div>`;
}

async function openHrEmployeeModal(id) {
  if (!HR.employees.length || !HR.sites.length) await hrLoadBasics();
  const e = id ? await api(`/api/admin/hr/employees/${id}`) : null;
  const portalUsers = await api('/api/admin/hr/portal-users');
  const others = HR.employees.filter(x => x.id !== id && x.active);
  const leaves = FIN.centers.filter(c => c.is_leaf && c.active);
  UI.modal({
    id: 'hr-employee-modal', title: e ? `Modifica ${hrName(e)}` : 'Nuovo dipendente', width: 620,
    body: `
      <div class="field-row">
        <div class="field"><label>Nome</label><input name="first_name" value="${UI.attr(e?.first_name)}"></div>
        <div class="field"><label>Cognome</label><input name="last_name" value="${UI.attr(e?.last_name)}"></div>
      </div>
      <div class="field"><label>Ruolo / mansione</label><input name="job_title" value="${UI.attr(e?.job_title)}" placeholder="es. Cantiniere, Addetta accoglienza"></div>
      <div class="field-row">
        <div class="field"><label>Email aziendale</label><input name="work_email" type="email" value="${UI.attr(e?.work_email)}"></div>
        <div class="field"><label>Telefono aziendale</label><input name="work_phone" value="${UI.attr(e?.work_phone)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Sede</label><select name="site_id">${UI.options(HR.sites, e?.site_id ?? HR.sites[0]?.id, { empty: '— Nessuna —' })}</select></div>
        <div class="field"><label>Centro di costo</label><select name="cost_center_id">${UI.options(leaves, e?.cost_center_id, { empty: '— Nessuno —', label: c => `${c.code} ${c.name}` })}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Responsabile</label><select name="manager_id">${UI.options(others, e?.manager_id, { empty: '— Nessuno —', label: hrName })}</select></div>
        <div class="field"><label>Delegato (quando il responsabile manca)</label><select name="delegate_id">${UI.options(others, e?.delegate_id, { empty: '— Nessuno —', label: hrName })}</select></div>
      </div>
      <div class="field"><label>Accesso al portale (facoltativo)</label><select name="portal_user_id">${UI.options(portalUsers.filter(u => !u.employee_id || u.employee_id === id), e?.portal_user_id, { empty: '— Nessuno: non usa il portale —', label: u => `${u.name} (@${u.username})` })}</select></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="active" ${!e || e.active ? 'checked' : ''}> Attivo</label>
      <p class="mod-note">Gli stagionali possono non avere l'accesso al portale. Chi ha l'accesso compare anche tra gli operatori dell'Enoturismo, come oggi.</p>`,
    onSave: async b => {
      const body = {};
      for (const k of ['first_name', 'last_name', 'job_title', 'work_email', 'work_phone', 'site_id', 'cost_center_id', 'manager_id', 'delegate_id', 'portal_user_id', 'active']) body[k] = UI.val(b, k);
      const res = await api('/api/admin/hr/employees' + (e ? `/${e.id}` : ''), { method: e ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      await loadHrEmployees();
      openHrEmployeeDetail(e ? e.id : res.id);
    },
  });
}

async function openHrEmployeeDetail(id) {
  const e = await api(`/api/admin/hr/employees/${id}`);
  const s = e.schedule;
  const costs = e.hourly_costs || [];
  const today = new Date().toISOString().slice(0, 10);
  UI.modal({
    id: 'hr-detail-modal', title: hrName(e), width: 720,
    extraButtons: `<button class="btn secondary" type="button" onclick="document.getElementById('hr-detail-modal').remove(); openHrEmployeeModal(${e.id})">Modifica dati</button>`,
    body: `
      <div class="mod-section-title">Organizzazione</div>
      <dl class="mod-kv">
        <dt>Ruolo</dt><dd>${esc(e.job_title || '—')}</dd>
        <dt>Sede</dt><dd>${esc(e.site_name || '—')}</dd>
        <dt>Centro di costo</dt><dd>${e.cost_center_code ? `${esc(e.cost_center_code)} ${esc(e.cost_center_name)}` : '—'}</dd>
        <dt>Contatti aziendali</dt><dd>${esc([e.work_email, e.work_phone].filter(Boolean).join(' · ') || '—')}</dd>
        <dt>Accesso al portale</dt><dd>${e.portal_username ? '@' + esc(e.portal_username) : 'No'}</dd>
        <dt>Stato</dt><dd>${e.active ? 'Attivo' : 'Non attivo'}</dd>
      </dl>
      <div class="mod-section-title">Chi approva le sue richieste</div>
      <dl class="mod-kv">
        <dt>Responsabile</dt><dd>${e.approval.approver ? esc(e.approval.approver.name) : '<span style="color:var(--bad)">Nessuno</span>'}${e.approval.escalated ? ' <span class="badge yellow">salito di livello: il responsabile diretto non è attivo</span>' : ''}</dd>
        <dt>Delegato</dt><dd>${e.approval.delegate ? esc(e.approval.delegate.name) : '—'}</dd>
        <dt>Collaboratori</dt><dd>${e.reports.length ? e.reports.map(r => esc(r.name)).join(', ') : '—'}</dd>
        <dt>Squadre</dt><dd>${e.teams.length ? e.teams.map(t => `${esc(t.name)}${t.is_leader ? ' (caposquadra)' : ''}`).join(', ') : '—'}</dd>
      </dl>
      ${e.can_see_schedule ? `
        <div class="mod-section-title">Orario contrattuale (ore per giorno)</div>
        <div class="mod-week" id="hr-week">${Object.entries(PPL_WEEKDAYS).map(([d, l]) => `<div class="field" style="margin:0"><label>${l}</label><input inputmode="decimal" data-day="${d}" value="${s ? UI.decimal((s.days[d] || 0) / 60) : ''}" placeholder="0"></div>`).join('')}</div>
        <div class="field-row" style="margin-top:10px;align-items:end">
          <div class="field" style="margin:0"><label>In vigore dal</label><input type="date" id="hr-week-from" value="${today}"></div>
          <div><button class="btn secondary small" type="button" onclick="saveHrSchedule(${e.id})">Salva orario</button></div>
        </div>
        <p class="mod-note">${s ? `Orario attuale dal ${UI.date(s.valid_from)}: ${UI.decimal(s.weekly_minutes / 60)} ore a settimana.` : 'Nessun orario impostato.'} Un nuovo orario vale dalla data indicata; lo storico resta.</p>
        <div id="hr-week-msg"></div>` : ''}
      ${e.can_see_costs ? `
        <div class="mod-section-title">Costo orario standard <span class="badge grey">riservato</span></div>
        ${costs.length ? `<div class="mod-table-wrap"><table class="mod-table" style="min-width:0"><thead><tr><th>Dal</th><th>Al</th><th class="num">€ / ora</th><th></th></tr></thead><tbody>
          ${costs.map(c => `<tr><td>${UI.date(c.valid_from)}</td><td>${c.valid_to ? UI.date(c.valid_to) : 'in vigore'}</td><td class="num">€ ${UI.decimal(c.cost_per_hour)}</td>
            <td><button class="btn-outline-pill danger" type="button" title="Elimina" onclick="deleteHrCost(${c.id}, ${e.id})">${UI.icon.trash}</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="mod-note">Nessun costo orario: in Finance le sue ore andranno in anomalia finché non lo inserisci.</p>'}
        <div class="field-row" style="margin-top:10px;align-items:end">
          <div class="field" style="margin:0"><label>Dal</label><input type="date" id="hr-cost-from" value="${today}"></div>
          <div class="field" style="margin:0"><label>€ / ora (fino a 4 decimali)</label><input id="hr-cost-value" inputmode="decimal" placeholder="es. 23,4567"></div>
          <div><button class="btn secondary small" type="button" onclick="addHrCost(${e.id})">Aggiungi</button></div>
        </div>
        <div id="hr-cost-msg"></div>` : ''}`,
  });
}
async function saveHrSchedule(id) {
  const days = Object.fromEntries([...document.querySelectorAll('#hr-week [data-day]')].map(i => [i.dataset.day, i.value.trim() || '0']));
  try {
    await api(`/api/admin/hr/employees/${id}/schedule`, { method: 'PUT', body: JSON.stringify({ valid_from: document.getElementById('hr-week-from').value, days }) });
    openHrEmployeeDetail(id);
  } catch (err) { UI.msg(document.getElementById('hr-week-msg'), err.message); }
}
async function addHrCost(id) {
  try {
    await api(`/api/admin/hr/employees/${id}/hourly-costs`, { method: 'POST', body: JSON.stringify({ valid_from: document.getElementById('hr-cost-from').value, cost_per_hour: document.getElementById('hr-cost-value').value }) });
    openHrEmployeeDetail(id);
  } catch (err) { UI.msg(document.getElementById('hr-cost-msg'), err.message); }
}
function deleteHrCost(costId, employeeId) {
  UI.confirmDo('Eliminare questo costo orario?', () => api(`/api/admin/hr/hourly-costs/${costId}`, { method: 'DELETE' }), () => openHrEmployeeDetail(employeeId));
}

// ── Squadre ────────────────────────────────────────────────────────────────────
async function loadHrTeams() {
  const root = document.getElementById('people-squadre-root');
  const [teams] = await Promise.all([api('/api/admin/hr/teams'), hrLoadBasics()]);
  HR.teams = teams;
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Squadre</h3><p class="mod-intro">Gruppi di lavoro con un caposquadra (vendemmia, potatura, lavori in vigneto). Dalla Fase 2 il caposquadra registrerà le ore per tutta la squadra in un colpo solo.</p></div>
      <div class="list-spacer"></div>
      <button class="btn-generate" onclick="openHrTeamModal()">${UI.icon.plus} Nuova squadra</button>
    </div>
    ${teams.map(t => `<div class="mod-row">
      <div class="mod-row-main">
        <div class="mod-row-title">${esc(t.name)}</div>
        <div class="mod-row-sub">${t.leader_name ? `Caposquadra: ${esc(t.leader_name)} · ` : ''}${t.members.length} ${t.members.length === 1 ? 'persona' : 'persone'}: ${t.members.map(m => esc(m.name)).join(', ') || '—'}</div>
      </div>
      ${t.active ? '' : '<span class="badge grey">Non attiva</span>'}
      <div class="mod-row-actions">
        <button class="btn-outline-pill" onclick="openHrTeamModal(${t.id})">Modifica</button>
        <button class="btn-outline-pill danger" title="Elimina" onclick="deleteHrTeam(${t.id})">${UI.icon.trash}</button>
      </div>
    </div>`).join('') || '<div class="mod-empty">Nessuna squadra.</div>'}
  </div>`;
}
function openHrTeamModal(id) {
  const t = HR.teams.find(x => x.id === id) || null;
  const members = new Set((t?.members || []).map(m => m.id));
  const active = HR.employees.filter(e => e.active || members.has(e.id));
  UI.modal({
    id: 'hr-team-modal', title: t ? `Modifica ${t.name}` : 'Nuova squadra',
    body: `
      <div class="field"><label>Nome</label><input name="name" value="${UI.attr(t?.name)}" placeholder="es. Vendemmia 2026"></div>
      <div class="field"><label>Caposquadra</label><select name="leader_employee_id">${UI.options(active, t?.leader_employee_id, { empty: '— Nessuno —', label: hrName })}</select></div>
      <div class="field"><label>Membri</label><div class="mod-checklist">${active.map(e => `<label><input type="checkbox" data-member="${e.id}" ${members.has(e.id) ? 'checked' : ''}> ${esc(hrName(e))}${e.job_title ? ` · ${esc(e.job_title)}` : ''}</label>`).join('') || '<span class="mod-note">Nessun dipendente.</span>'}</div></div>
      ${t ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Attiva</label>` : ''}
      <p class="mod-note">Il caposquadra fa sempre parte della squadra.</p>`,
    onSave: async b => {
      const body = { name: UI.val(b, 'name'), leader_employee_id: UI.val(b, 'leader_employee_id') || null, member_ids: [...b.querySelectorAll('[data-member]:checked')].map(c => Number(c.dataset.member)) };
      if (t) body.active = UI.val(b, 'active');
      await api('/api/admin/hr/teams' + (t ? `/${t.id}` : ''), { method: t ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadHrTeams();
    },
  });
}
function deleteHrTeam(id) {
  UI.confirmDo('Eliminare questa squadra? I dipendenti restano.', () => api(`/api/admin/hr/teams/${id}`, { method: 'DELETE' }), loadHrTeams);
}

// ── Sedi e festività ───────────────────────────────────────────────────────────
const HR_HOLIDAY_KIND = { nazionale: 'Nazionale', sede: 'Della sede', patrono: 'Patrono', mobile: 'Calcolata' };
async function loadHrSites() {
  const root = document.getElementById('people-sedi-root');
  HR.sites = await api('/api/admin/hr/sites');
  HR.siteId = HR.siteId || HR.sites[0]?.id || null;
  const data = await api(`/api/admin/hr/holidays?year=${HR.year}${HR.siteId ? `&site_id=${HR.siteId}` : ''}`);
  const years = [HR.year - 1, HR.year, HR.year + 1, HR.year + 2].filter((v, i, a) => a.indexOf(v) === i);
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Sedi</h3><p class="mod-intro">Ogni sede ha il suo santo patrono e le sue chiusure; servono a calcolare i giorni lavorativi di presenze e assenze.</p></div>
      <div class="list-spacer"></div>
      <button class="btn-generate" onclick="openHrSiteModal()">${UI.icon.plus} Nuova sede</button>
    </div>
    ${HR.sites.map(s => `<div class="mod-row">
      <div class="mod-row-main"><div class="mod-row-title">${esc(s.name)}</div>
        <div class="mod-row-sub">${esc([s.city, s.province].filter(Boolean).join(' '))}${s.patron_day ? ` · patrono ${esc(s.patron_name || '')} il ${esc(s.patron_day.split('-').reverse().join('/'))}` : ' · patrono non indicato'}</div></div>
      <button class="btn-outline-pill" onclick="openHrSiteModal(${s.id})">Modifica</button>
    </div>`).join('')}
  </div>
  <div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Festività</h3><p class="mod-intro">Nazionali, della sede e patrono. Pasqua e Pasquetta si calcolano da sole ogni anno.</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields">
        <select onchange="HR.siteId = parseInt(this.value) || null; loadHrSites()">${UI.options(HR.sites, HR.siteId, { empty: 'Solo nazionali' })}</select>
        <select onchange="HR.year = parseInt(this.value); loadHrSites()">${years.map(y => `<option ${y === HR.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <button class="btn secondary small" onclick="openHrHolidayModal()">+ Aggiungi</button>
    </div>
    ${data.calendar.map(h => {
      const entry = data.entries.find(x => x.name === h.name && (x.month_day ? `${HR.year}-${x.month_day}` === h.date : x.date === h.date));
      return `<div class="mod-row">
        <div class="mod-row-main"><div class="mod-row-title">${new Date(`${h.date}T00:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' })}</div><div class="mod-row-sub">${esc(h.name)}</div></div>
        <span class="badge ${h.kind === 'sede' || h.kind === 'patrono' ? 'yellow' : 'grey'}">${esc(HR_HOLIDAY_KIND[h.kind])}</span>
        ${entry ? `<button class="btn-outline-pill danger" title="Elimina" onclick="deleteHrHoliday(${entry.id})">${UI.icon.trash}</button>` : '<span style="width:36px"></span>'}
      </div>`;
    }).join('')}
  </div>`;
}
function openHrSiteModal(id) {
  const s = HR.sites.find(x => x.id === id) || null;
  UI.modal({
    id: 'hr-site-modal', title: s ? `Modifica ${s.name}` : 'Nuova sede', width: 520,
    body: `
      <div class="field"><label>Nome</label><input name="name" value="${UI.attr(s?.name)}"></div>
      <div class="field"><label>Indirizzo</label><input name="address" value="${UI.attr(s?.address)}"></div>
      <div class="field-row">
        <div class="field"><label>Comune</label><input name="city" value="${UI.attr(s?.city)}"></div>
        <div class="field"><label>Provincia</label><input name="province" value="${UI.attr(s?.province)}" maxlength="2"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Santo patrono</label><input name="patron_name" value="${UI.attr(s?.patron_name)}" placeholder="es. San Cetteo"></div>
        <div class="field"><label>Giorno (MM-GG)</label><input name="patron_day" value="${UI.attr(s?.patron_day)}" placeholder="10-10"></div>
      </div>`,
    onSave: async b => {
      const body = {};
      for (const k of ['name', 'address', 'city', 'province', 'patron_name', 'patron_day']) body[k] = UI.val(b, k);
      await api('/api/admin/hr/sites' + (s ? `/${s.id}` : ''), { method: s ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadHrSites();
    },
  });
}
function openHrHolidayModal() {
  UI.modal({
    id: 'hr-holiday-modal', title: 'Nuova festività o chiusura', width: 480,
    body: `
      <div class="field"><label>Nome</label><input name="name" placeholder="es. Chiusura per vendemmia"></div>
      <div class="field"><label>Vale per</label><select name="site_id">${UI.options(HR.sites, HR.siteId, { empty: 'Tutte le sedi (nazionale)' })}</select></div>
      <div class="field-row">
        <div class="field"><label>Ogni anno il (MM-GG)</label><input name="month_day" placeholder="es. 08-14"></div>
        <div class="field"><label>Oppure solo il</label><input name="date" type="date"></div>
      </div>
      <p class="mod-note">Compila solo uno dei due: un giorno che si ripete ogni anno oppure una data precisa.</p>`,
    onSave: async b => {
      await api('/api/admin/hr/holidays', { method: 'POST', body: JSON.stringify({ name: UI.val(b, 'name'), site_id: UI.val(b, 'site_id') || null, month_day: UI.val(b, 'month_day') || null, date: UI.val(b, 'date') || null }) });
      loadHrSites();
    },
  });
}
function deleteHrHoliday(id) {
  UI.confirmDo('Eliminare questa festività?', () => api(`/api/admin/hr/holidays/${id}`, { method: 'DELETE' }), loadHrSites);
}
