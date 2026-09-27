// Portale → People: assenze. Pagina Assenze (da decidere, elenco, contatori), sezione Assenze della
// scheda (contatori, spettanze, storico) e configurazione (tipi, periodi di blocco, regole).
const ABS_STATUS = {
  bozza: ['grey', 'Bozza'], richiesta: ['yellow', 'Da approvare'], approvata: ['green', 'Approvata'], rifiutata: ['red', 'Rifiutata'],
  annullata: ['grey', 'Annullata'], comunicata: ['yellow', 'Comunicata'], presa_visione: ['green', 'Presa visione'],
};
const ABS_PARTS = { giorno: 'Giorno intero', mattina: 'Mattina', pomeriggio: 'Pomeriggio', ore: 'A ore' };
const ABS_COUNTERS = { ferie: 'Ferie', rol: 'ROL', ex_festivita: 'Ex festività' };
const ABS = { view: 'elenco', types: [], filter: { month: UI.thisMonth(), status: '', type_id: '' } };

const absAmount = (amount, unit) => `${(amount / (unit === 'giorni' ? 1000 : 60)).toLocaleString('it-IT', { maximumFractionDigits: 2 })} ${unit === 'giorni' ? 'gg' : 'h'}`;
const absWhen = a => (a.start_date === a.end_date ? UI.date(a.start_date) : `${UI.date(a.start_date)} → ${UI.date(a.end_date)}`) + (a.part === 'ore' ? ` · ${a.start_time}–${a.end_time}` : a.part !== 'giorno' ? ` · ${ABS_PARTS[a.part].toLowerCase()}` : '');
async function absTypes() {
  if (!ABS.types.length) ABS.types = await api('/api/admin/hr/absence-types');
  return ABS.types;
}
function absRow(a, { withName = true } = {}) {
  const [cls, label] = ABS_STATUS[a.status];
  const acts = [];
  // Le decisioni si prendono in Timesheet → Richieste del team: qui (registro e scheda) solo il rimando.
  if (a.can_decide && ['richiesta', 'comunicata'].includes(a.status)) acts.push(`<button class="btn small" onclick="event.stopPropagation(); tsOpenFor(null, null, 'team')">${a.status === 'richiesta' ? 'Decidi' : 'Prendi visione'} in Richieste del team</button>`);
  if (a.status === 'bozza') acts.push(`<button class="btn small" onclick="event.stopPropagation(); absAction(${a.id}, 'submit')">Invia</button>`);
  if (['bozza', 'richiesta', 'approvata', 'comunicata', 'presa_visione'].includes(a.status)) acts.push(`<button class="btn-outline-pill danger" onclick="event.stopPropagation(); cancelAbsence(${a.id}, '${a.status}')">${a.status === 'bozza' ? 'Elimina' : 'Annulla'}</button>`);
  return `<div class="mod-row">
    <div class="mod-row-main">
      <div class="mod-row-title">${withName ? `${esc(a.employee_name)} · ` : ''}${esc(a.type_name)} <span style="font-weight:400;color:var(--ink-soft)">${absWhen(a)}</span></div>
      <div class="mod-row-sub">${[a.amount ? absAmount(a.amount, a.unit) : null, a.protocol ? `protocollo ${esc(a.protocol)}` : null, a.inail_number ? `INAIL ${esc(a.inail_number)}` : null,
        a.status === 'richiesta' ? `decide ${esc(a.escalated_at && a.delegate_name ? `${a.delegate_name} (delegato)` : a.approver_name || 'l\'ufficio del personale')}` : a.decided_by ? `${esc(a.decided_by)}` : null,
        a.block_period_name ? `<span style="color:var(--warn)">periodo «${esc(a.block_period_name)}»</span>` : null, a.decision_note ? esc(a.decision_note) : null, a.note ? esc(a.note) : null].filter(Boolean).join(' · ')}</div>
    </div>
    <span class="badge ${cls}">${label}</span>
    ${acts.length ? `<div class="mod-row-actions">${acts.join('')}</div>` : ''}
  </div>`;
}
async function absAction(id, action) {
  try {
    const res = await api(`/api/admin/hr/absences/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
    if (res.warnings?.length) alert(res.warnings.join('\n'));
    absRefresh();
  } catch (e) { alert(e.message); }
}
function cancelAbsence(id, status) {
  if (status === 'bozza') return UI.confirmDo('Eliminare la bozza?', () => api(`/api/admin/hr/absences/${id}`, { method: 'DELETE' }), absRefresh);
  UI.confirmDo('Annullare questa assenza? Il contatore torna come prima.', () => api(`/api/admin/hr/absences/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) }), absRefresh);
}
// Dopo un'azione: ricarica la vista in cui si è (Timesheet, pagina Assenze o scheda del dipendente).
function absRefresh() {
  if (document.getElementById('module-people')?.classList.contains('active') && document.getElementById('sub-people-timesheet')?.classList.contains('active')) return loadHrTimesheet();
  if (document.getElementById('module-me')?.classList.contains('active')) return loadMySpace();
  if (REC.id) return openHrRecord(REC.id, 'assenze');
}

// ── Nuova assenza (con anteprima di quantità, approvatore e avvisi) ────────────
async function openAbsenceModal(employeeId) {
  const types = (await absTypes()).filter(x => x.active);
  if (!HR.employees.length) await hrLoadBasics().catch(() => {});
  const people = HR.employees.filter(e => e.active);
  UI.modal({
    id: 'abs-modal', title: 'Nuova assenza', width: 580,
    extraButtons: '<button class="btn secondary" type="button" data-draft>Salva come bozza</button>',
    saveLabel: 'Invia',
    body: `
      ${people.length ? `<div class="field"><label>Dipendente</label><select name="employee_id">${UI.options(people, employeeId, { label: hrName })}</select></div>` : ''}
      <div class="field"><label>Tipo</label><select name="absence_type_id">${UI.options(types, types[0]?.id, { label: x => `${x.name}${x.flow === 'comunicazione' ? ' (comunicazione)' : ''}` })}</select></div>
      <div class="field"><label>Durata</label><select name="part">${UI.options(Object.entries(ABS_PARTS).map(([id, name]) => ({ id, name })), 'giorno')}</select></div>
      <div class="field-row">
        <div class="field"><label>Dal</label><input type="date" name="start_date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field" data-abs-end><label>Al</label><input type="date" name="end_date"></div>
        <div class="field" data-abs-hours style="display:none"><label>Dalle</label><input name="start_time" placeholder="09:00"></div>
        <div class="field" data-abs-hours style="display:none"><label>Alle</label><input name="end_time" placeholder="11:00"></div>
      </div>
      <div class="field" data-abs-protocol style="display:none"><label>Protocollo del certificato</label><input name="protocol" placeholder="numero di protocollo INPS"></div>
      <div class="field"><label>Nota</label><input name="note"></div>
      <div id="abs-preview" class="mod-note"></div>`,
    onSave: b => saveAbsence(b, true),
  });
  const box = document.getElementById('abs-modal');
  box.querySelector('[data-draft]').onclick = async () => { try { await saveAbsence(box, false); box.remove(); } catch (e) { UI.msg(box.querySelector('.ui-modal-msg'), e.message); } };
  box.querySelectorAll('select, input').forEach(el => el.addEventListener('change', () => absFormChanged(box)));
  absFormChanged(box);
}
function absBody(b) {
  const body = {};
  for (const k of ['employee_id', 'absence_type_id', 'part', 'start_date', 'end_date', 'start_time', 'end_time', 'protocol', 'note']) body[k] = UI.val(b, k) || undefined;
  if (body.part !== 'giorno') body.end_date = body.start_date;
  return body;
}
async function absFormChanged(box) {
  const t = ABS.types.find(x => String(x.id) === UI.val(box, 'absence_type_id'));
  const part = box.querySelector('[name="part"]');
  [...part.options].forEach(o => { o.disabled = (o.value === 'ore' && !t?.allow_hours) || (['mattina', 'pomeriggio'].includes(o.value) && !t?.allow_half_day); });
  if (part.selectedOptions[0]?.disabled) part.value = 'giorno';
  box.querySelector('[data-abs-end]').style.display = part.value === 'giorno' ? '' : 'none';
  box.querySelectorAll('[data-abs-hours]').forEach(el => { el.style.display = part.value === 'ore' ? '' : 'none'; });
  box.querySelector('[data-abs-protocol]').style.display = t?.requires_protocol ? '' : 'none';
  box.querySelector('[data-draft]').style.display = t?.flow === 'comunicazione' ? 'none' : '';
  box.querySelector('[data-ui="save"]').textContent = t?.flow === 'comunicazione' ? 'Comunica' : 'Invia';
  const prev = document.getElementById('abs-preview');
  try {
    const p = await api('/api/admin/hr/absences/preview', { method: 'POST', body: JSON.stringify(absBody(box)) });
    prev.innerHTML = `${p.work_days} ${p.work_days === 1 ? 'giorno lavorativo' : 'giorni lavorativi'} · ${esc(p.amount_label)}${t?.flow === 'approvazione' ? ` · decide ${esc(p.approver || 'l\'ufficio del personale')}` : ''}
      ${p.warnings.map(w => `<div style="color:var(--warn);margin-top:4px">${esc(w)}</div>`).join('')}`;
  } catch (e) { prev.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
}
async function saveAbsence(box, submit) {
  const res = await api('/api/admin/hr/absences', { method: 'POST', body: JSON.stringify({ ...absBody(box), submit }) });
  if (res.warnings?.length) alert(res.warnings.join('\n'));
  absRefresh();
}

// ── Pagina Assenze ─────────────────────────────────────────────────────────────
async function loadHrAbsences() {
  const root = document.getElementById('people-assenze-root');
  // Le richieste da decidere sono in Timesheet → Richieste del team: qui il registro (elenco e contatori).
  const views = [['elenco', 'Elenco'], ['giustificativi', 'Giustificativi'], ['contatori', 'Contatori']];
  if (!ABS.urlChecked) { ABS.urlChecked = true; const v = new URLSearchParams(location.search).get('view'); if (views.some(([k]) => k === v)) ABS.view = v; }
  const tabs = `<div class="rec-tabs" style="padding:0 22px">${views.map(([k, l]) => `<button class="${ABS.view === k ? 'active' : ''}" onclick="ABS.view='${k}'; loadHrAbsences()">${l}</button>`).join('')}</div>`;
  const types = await absTypes();
  const head = (title, intro, extra = '') => `<div class="list-toolbar"><div class="list-toolbar-title"><h3>${title}</h3><p class="mod-intro">${intro}</p></div><div class="list-spacer"></div>${extra}
    <button class="btn-generate" onclick="openAbsenceModal()">${UI.icon.plus} Nuova assenza</button></div>`;
  const toDecide = (await api('/api/admin/hr/absences?to_decide=1').catch(() => [])).length;
  const decideNote = toDecide ? `<div class="mod-warn" style="margin:0 22px 12px">${toDecide === 1 ? '1 richiesta da decidere' : `${toDecide} richieste da decidere`}: si gestiscono nel <a href="#" onclick="tsOpenFor(null, null, 'team'); return false">Timesheet → Richieste del team</a>.</div>` : '';
  if (ABS.view === 'contatori') return loadHrAbsenceCounters(root, tabs, head);
  if (ABS.view === 'giustificativi') return loadHrJustifications(root, tabs, head);
  const f = ABS.filter;
  const [y, m] = f.month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const q = new URLSearchParams({ from: `${f.month}-01`, to: `${f.month}-${String(last).padStart(2, '0')}`, ...(f.status ? { status: f.status } : {}), ...(f.type_id ? { type_id: f.type_id } : {}) });
  const rows = await api(`/api/admin/hr/absences?${q}`);
  root.innerHTML = `<div class="list-card">${tabs}${decideNote}${head('Assenze del mese', 'Le proprie, quelle dei collaboratori e, per l\'ufficio del personale, tutte.',
    `<div class="mod-toolbar-fields"><input type="month" value="${f.month}" onchange="ABS.filter.month = this.value || UI.thisMonth(); loadHrAbsences()">
      <select onchange="ABS.filter.type_id = this.value; loadHrAbsences()">${UI.options(types, f.type_id, { empty: 'Tutti i tipi' })}</select>
      <select onchange="ABS.filter.status = this.value; loadHrAbsences()">${UI.options(Object.entries(ABS_STATUS).map(([id, [, name]]) => ({ id, name })), f.status, { empty: 'Tutti gli stati' })}</select></div>`)}
    ${rows.map(a => absRow(a)).join('') || '<div class="mod-empty">Nessuna assenza nel mese.</div>'}</div>`;
}
async function loadHrAbsenceCounters(root, tabs, head) {
  if (!HR.employees.length) await hrLoadBasics().catch(() => {});
  const year = ABS.year || new Date().getFullYear();
  const people = HR.employees.filter(e => e.active);
  const data = await Promise.all(people.map(e => api(`/api/admin/hr/absences/balances?employee_id=${e.id}&year=${year}`).then(d => ({ e, d })).catch(() => null)));
  const cell = b => (b && (b.annual || b.opening || b.taken || b.planned) ? `${b.to_align ? '<span class="badge yellow" title="Saldo da allineare al cedolino">da allineare</span><br>' : ''}<b style="${b.remaining < 0 ? 'color:var(--bad)' : ''}">${absAmount(b.remaining, b.unit)}</b><br><span class="mod-note" style="margin:0">goduti ${absAmount(b.taken, b.unit)}${b.planned ? ` · pian. ${absAmount(b.planned, b.unit)}` : ''}</span>` : '—');
  root.innerHTML = `<div class="list-card">${tabs}${head('Contatori', 'Residuo ad oggi: riporto + maturato − goduto. Sotto, goduto e pianificato. Le spettanze si impostano nella scheda del dipendente.',
    `<div class="mod-toolbar-fields"><select onchange="ABS.year = parseInt(this.value); loadHrAbsences()">${[year - 1, year, year + 1].map(v => `<option ${v === year ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`)}
    <div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Dipendente</th>${Object.values(ABS_COUNTERS).map(l => `<th>${l}</th>`).join('')}<th>Ferie arretrate</th></tr></thead><tbody>
      ${data.filter(Boolean).map(({ e, d }) => `<tr class="mod-clickable" onclick="openHrRecord(${e.id}, 'assenze')"><td><b>${esc(hrName(e))}</b></td>
        ${Object.keys(ABS_COUNTERS).map(c => `<td>${cell(d.balances.find(b => b.counter === c))}</td>`).join('')}
        <td>${d.arrears.length ? d.arrears.map(v => `<span class="badge ${v.due_date < new Date().toISOString().slice(0, 10) ? 'red' : 'yellow'}">${v.year}: ${absAmount(v.amount, 'giorni')} entro ${UI.date(v.due_date)}</span>`).join(' ') : '—'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

// ── Sezione Assenze della scheda ───────────────────────────────────────────────
async function hrLoadAbsences() {
  const year = new Date().getFullYear();
  const [allow, list] = await Promise.all([
    api(`/api/admin/hr/employees/${REC.id}/allowances?year=${year}`).catch(() => null),
    api(`/api/admin/hr/absences?employee_id=${REC.id}`).catch(() => []),
  ]);
  REC.absences = { allow, list, for: REC.id };
}
function hrTabAbsences() {
  const s = REC.absences;
  if (!s?.allow) return '<div class="rec-locked">Le assenze di questa persona non sono visibili con il tuo accesso.</div>';
  const canEdit = REC.file.access.edit.personale;
  const bal = s.allow.balances;
  return `
    <div class="mod-section-title">Contatori ${s.allow.year}</div>
    <div class="mod-table-wrap"><table class="mod-table" style="min-width:0"><thead><tr><th></th><th class="num">Spettanza</th><th class="num">Riporto</th><th class="num">Maturato</th><th class="num">Goduto</th><th class="num">Pianificato</th><th class="num">In attesa</th><th class="num">Residuo</th><th></th></tr></thead><tbody>
      ${bal.map(b => `<tr><td><b>${ABS_COUNTERS[b.counter]}</b><br><span class="mod-note" style="margin:0">${b.source === 'persona' ? 'spettanza della persona' : b.source === 'standard' ? `standard: ${esc(b.plan)}` : 'nessuna spettanza'}${b.accrual ? ` · ${b.accrual}` : ''}${b.anchor ? ` · saldo al ${UI.date(b.anchor.as_of)}` : ''}</span></td><td class="num">${absAmount(b.annual, b.unit)}</td><td class="num">${absAmount(b.opening, b.unit)}</td>
        <td class="num">${absAmount(b.accrued, b.unit)}</td><td class="num">${absAmount(b.taken, b.unit)}</td><td class="num">${absAmount(b.planned, b.unit)}</td><td class="num">${absAmount(b.pending, b.unit)}</td>
        <td class="num"><b style="${b.remaining < 0 ? 'color:var(--bad)' : ''}">${absAmount(b.remaining, b.unit)}</b></td>
        <td>${canEdit ? `<button class="btn-outline-pill" onclick="openAllowanceModal('${b.counter}', ${s.allow.year})">Spettanza</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${s.allow.arrears.length ? `<div class="mod-warn" style="margin-top:12px">Ferie arretrate: ${s.allow.arrears.map(v => `${v.year} — ${absAmount(v.amount, 'giorni')} da godere entro il ${UI.date(v.due_date)}`).join('; ')}.</div>` : ''}
    ${!s.allow.contract ? '<div class="mod-warn" style="margin-top:12px">Manca il contratto: le spettanze standard si applicano quando inserisci CCNL e tipo di contratto in Rapporto di lavoro.</div>'
      : !s.allow.plan && bal.every(b => b.source !== 'persona') ? `<div class="mod-warn" style="margin-top:12px">Il CCNL del contratto («${esc(s.allow.contract.ccnl || 'non indicato')}») non corrisponde a una spettanza standard: indica agricoltura o commercio, oppure imposta la spettanza della persona.</div>` : ''}
    <p class="mod-note">Residuo = partenza (riporto o saldo al cedolino) + maturato − goduto. I ratei maturano a fine mese nei mesi con almeno 15 giorni di servizio. Le ferie si consumano dalle più vecchie; quelle di un anno vanno godute entro il 30 giugno del secondo anno successivo.</p>
    ${bal.some(b => b.to_align) ? '<div class="mod-warn" style="margin:0 0 10px">Saldo da allineare al cedolino: la persona era già in forza prima dell&#39;avvio del conteggio, e le ferie godute prima non sono qui. Indica il residuo dell&#39;ultimo cedolino.</div>' : ''}
    ${canEdit ? `<button class="btn secondary small" onclick="openBalanceAnchorModal()">Allinea al cedolino</button>` : ''}
    ${s.allow.anchors.length ? `<div class="mod-section-title" style="margin-top:18px">Saldi dal cedolino</div>${s.allow.anchors.map(x => `<div class="dl-item"><div class="mod-row-main"><div class="mod-row-title">${ABS_COUNTERS[x.counter]}: ${absAmount(x.amount, x.counter === 'ferie' ? 'giorni' : 'ore')} al ${UI.date(x.as_of)}</div>
      <div class="mod-row-sub">${esc(x.note || '')}${x.created_by ? ` · ${esc(x.created_by)}` : ''}</div></div>${canEdit ? `<button class="btn-outline-pill danger" title="Elimina" onclick="deleteBalanceAnchor(${x.id})">${UI.icon.trash}</button>` : ''}</div>`).join('')}` : ''}
    <div class="mod-section-title" style="margin-top:26px">Assenze</div>
    <div class="list-card" style="margin:0;box-shadow:none">${s.list.map(a => absRow(a, { withName: false })).join('') || '<div class="mod-empty">Nessuna assenza.</div>'}</div>
    <button class="btn secondary small" style="margin-top:10px" onclick="openAbsenceModal(${REC.id})">+ Nuova assenza</button>`;
}
function openBalanceAnchorModal() {
  UI.modal({
    id: 'abs-anchor-modal', title: 'Allinea al cedolino', width: 520, saveLabel: 'Salva il residuo',
    body: `<div class="field-row">
        <div class="field"><label>Residuo al</label><input type="date" name="as_of" value="${hrLastMonthEnd()}"></div>
        <div class="field"><label>Ferie (giorni)</label><input name="ferie" inputmode="decimal"></div>
        <div class="field"><label>ROL (ore)</label><input name="rol" inputmode="decimal"></div>
        <div class="field"><label>Ex festività (ore)</label><input name="ex_festivita" inputmode="decimal"></div>
      </div>
      <div class="field"><label>Nota</label><input name="note" placeholder="es. cedolino di agosto"></div>
      <p class="mod-note">Indica i residui come li riporta il cedolino a quella data (lascia vuoto quello che non cambi). Dal giorno dopo il saldo prosegue con i ratei e le assenze registrate qui.</p>`,
    onSave: async b => {
      const body = { as_of: UI.val(b, 'as_of'), note: UI.val(b, 'note') };
      for (const k of ['ferie', 'rol', 'ex_festivita']) body[k] = UI.val(b, k);
      await api(`/api/admin/hr/employees/${REC.id}/balance-anchors`, { method: 'POST', body: JSON.stringify(body) });
      openHrRecord(REC.id, 'assenze');
    },
  });
}
function deleteBalanceAnchor(id) {
  UI.confirmDo('Eliminare questo saldo? Il conteggio torna a quello di prima.', () => api(`/api/admin/hr/balance-anchors/${id}`, { method: 'DELETE' }), () => openHrRecord(REC.id, 'assenze'));
}
function openAllowanceModal(counter, year) {
  const b = REC.absences.allow.balances.find(x => x.counter === counter);
  const row = REC.absences.allow.allowances.find(x => x.counter === counter && x.year === year);
  const unit = b.unit, k = unit === 'giorni' ? 1000 : 60;
  UI.modal({
    id: 'abs-allow-modal', title: `Spettanza ${ABS_COUNTERS[counter]} ${year}`, width: 480,
    body: `
      <div class="field-row">
        <div class="field"><label>Spettanza annua (${unit})</label><input name="annual" inputmode="decimal" value="${row ? UI.attr(UI.decimal(row.annual_amount / k)) : ''}"></div>
        <div class="field"><label>Maturazione</label><select name="accrual">${UI.options([{ id: 'mensile', name: 'Mensile (a fine mese)' }, { id: 'annuale', name: 'Tutta a inizio anno' }], row?.accrual || 'mensile')}</select></div>
      </div>
      <div class="field"><label>Saldo iniziale (${unit}, vuoto = riporto calcolato dall'anno prima)</label><input name="opening" inputmode="decimal" value="${row?.opening_balance != null ? UI.attr(UI.decimal(row.opening_balance / k)) : ''}"></div>
      <p class="mod-note">Il saldo iniziale serve la prima volta (residuo alla data di avvio). Negli anni dopo il riporto si calcola da solo.</p>`,
    onSave: async bx => {
      await api(`/api/admin/hr/employees/${REC.id}/allowances`, { method: 'PUT', body: JSON.stringify({ counter, year, annual: UI.num(UI.val(bx, 'annual')), accrual: UI.val(bx, 'accrual'), opening: UI.num(UI.val(bx, 'opening')) }) });
      openHrRecord(REC.id, 'assenze');
    },
  });
}

// ── Configurazione: tipi, periodi di blocco, regole ────────────────────────────
async function loadHrAbsenceConfig() {
  const box = document.getElementById('hr-absence-config-box');
  if (!box) return;
  ABS.types = [];
  const [types, periods, settings, sites, teams] = await Promise.all([absTypes(), api('/api/admin/hr/absence-block-periods'), api('/api/admin/hr/absence-settings'), api('/api/admin/hr/sites'), api('/api/admin/hr/teams')]);
  ABS.periods = periods; ABS.sites = sites; ABS.teams = teams;
  ABS.plans = await api('/api/admin/hr/absence-plans').catch(() => []);
  const gg = v => UI.decimal(v / 1000), hh = v => UI.decimal(v / 60);
  box.innerHTML = `
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>Spettanze standard</h3><p class="mod-intro">Ferie, ROL ed ex festività per CCNL e tipo di contratto: valgono per ogni dipendente, anno per anno, dalla data di assunzione (ratei a fine mese, con almeno 15 giorni di servizio nel mese). ROL ed ex festività in proporzione al part-time. Vince la prima per priorità; la spettanza della singola persona resta come eccezione. Valori da verificare con il consulente del lavoro.</p></div>
        <div class="list-spacer"></div><button class="btn-generate" onclick="openAbsPlanModal()">${UI.icon.plus} Nuova</button></div>
      ${ABS.plans.map(x => `<div class="mod-row ${x.active ? '' : 'cc-inactive'}"><div class="mod-row-main"><div class="mod-row-title">${esc(x.name)}</div>
        <div class="mod-row-sub">${x.ccnl ? `CCNL ${x.ccnl}` : 'Qualsiasi CCNL'} · ${x.contract_types ? x.contract_types.map(c => HR_CONTRACT_TYPES[c] || c).join(', ') : 'tutti i contratti'} · ferie ${gg(x.ferie)} gg · ROL ${hh(x.rol)} h · ex festività ${hh(x.ex_festivita)} h · maturazione ${x.accrual}${x.note ? ` · ${esc(x.note)}` : ''}</div></div>
        <button class="btn-outline-pill" onclick="openAbsPlanModal(${x.id})">Modifica</button></div>`).join('') || '<div class="mod-empty">Nessuna spettanza standard.</div>'}
    </div>
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>Tipi di assenza</h3><p class="mod-intro">Con approvazione (bozza → richiesta → approvata) o con comunicazione (comunicata → presa visione). Il contatore indica cosa consumano.</p></div>
        <div class="list-spacer"></div><button class="btn-generate" onclick="openAbsTypeModal()">${UI.icon.plus} Nuovo tipo</button></div>
      ${types.map(x => `<div class="mod-row ${x.active ? '' : 'cc-inactive'}"><div class="mod-row-main"><div class="mod-row-title">${esc(x.name)}</div>
        <div class="mod-row-sub">${x.flow === 'approvazione' ? 'Con approvazione' : 'Con comunicazione'} · in ${x.unit}${x.counter ? ` · consuma ${ABS_COUNTERS[x.counter]}` : ''}${x.paid ? ' · retribuita' : ' · non retribuita'}${x.requires_protocol ? ' · protocollo obbligatorio' : ''}${x.health ? ' · motivi di salute' : ''}${x.allow_half_day ? ' · mezza giornata' : ''}${x.allow_hours ? ' · a ore' : ''}</div></div>
        <button class="btn-outline-pill" onclick="openAbsTypeModal(${x.id})">Modifica</button></div>`).join('')}
    </div>
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>Periodi di blocco</h3><p class="mod-intro">Es. vendemmia: le richieste di ferie e permessi arrivano al responsabile con un avviso, oppure non sono ammesse. Malattia e comunicazioni non sono toccate.</p></div>
        <div class="list-spacer"></div><button class="btn-generate" onclick="openAbsPeriodModal()">${UI.icon.plus} Nuovo periodo</button></div>
      ${periods.map(p => `<div class="mod-row"><div class="mod-row-main"><div class="mod-row-title">${esc(p.name)}</div>
        <div class="mod-row-sub">${UI.date(p.start_date)} → ${UI.date(p.end_date)}${p.site_name ? ` · sede ${esc(p.site_name)}` : ''}${p.team_name ? ` · squadra ${esc(p.team_name)}` : ''}</div></div>
        <span class="badge ${p.mode === 'blocco' ? 'red' : 'yellow'}">${p.mode === 'blocco' ? 'Divieto' : 'Avviso'}</span>
        <div class="mod-row-actions"><button class="btn-outline-pill" onclick="openAbsPeriodModal(${p.id})">Modifica</button><button class="btn-outline-pill danger" title="Elimina" onclick="deleteAbsPeriod(${p.id})">${UI.icon.trash}</button></div></div>`).join('') || '<div class="mod-empty">Nessun periodo.</div>'}
    </div>
    <div class="list-card">
      <div class="list-toolbar"><div class="list-toolbar-title"><h3>Regole delle assenze</h3></div></div>
      <div class="mod-body">
        <div class="field-row">
          <div class="field"><label>Giorni di attesa prima che la richiesta passi al delegato</label><input id="abs-set-days" type="number" min="1" max="30" value="${settings.escalation_days}"></div>
          <div class="field"><label>Richieste oltre il residuo</label><select id="abs-set-over">${UI.options([{ id: 'blocca', name: 'Non ammesse' }, { id: 'avvisa', name: 'Ammesse con avviso' }], settings.over_balance)}</select></div>
        </div>
        <button class="btn small" onclick="saveAbsSettings()">Salva</button><div id="abs-set-msg"></div>
      </div>
    </div>`;
}
async function saveAbsSettings() {
  try {
    await api('/api/admin/hr/absence-settings', { method: 'PUT', body: JSON.stringify({ escalation_days: document.getElementById('abs-set-days').value, over_balance: document.getElementById('abs-set-over').value }) });
    UI.msg(document.getElementById('abs-set-msg'), 'Salvato.', 'success');
  } catch (e) { UI.msg(document.getElementById('abs-set-msg'), e.message); }
}
function openAbsPlanModal(id) {
  const x = (ABS.plans || []).find(p => p.id === id) || null;
  const types = Object.entries(HR_CONTRACT_TYPES);
  UI.modal({
    id: 'abs-plan-modal', title: x ? `Modifica ${x.name}` : 'Nuova spettanza standard', width: 560,
    body: `<div class="field"><label>Nome</label><input name="name" value="${UI.attr(x?.name)}"></div>
      <div class="field-row">
        <div class="field"><label>CCNL</label><select name="ccnl">${UI.options([{ id: 'agricoltura', name: 'Agricoltura' }, { id: 'commercio', name: 'Commercio e terziario' }], x?.ccnl, { empty: 'Qualsiasi' })}</select></div>
        <div class="field"><label>Maturazione</label><select name="accrual">${UI.options([{ id: 'mensile', name: 'Mensile (a fine mese)' }, { id: 'annuale', name: 'Tutta a inizio anno' }], x?.accrual || 'mensile')}</select></div>
        <div class="field"><label>Priorità</label><input name="priority" type="number" value="${UI.attr(x?.priority ?? 100)}"></div>
      </div>
      <div class="field"><label>Tipi di contratto (nessuno = tutti)</label><div class="mod-checklist">${types.map(([k, l]) => `<label><input type="checkbox" data-ct="${k}" ${x?.contract_types?.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>
      <div class="field-row">
        <div class="field"><label>Ferie (giorni l'anno)</label><input name="ferie" inputmode="decimal" value="${x ? UI.attr(UI.decimal(x.ferie / 1000)) : ''}"></div>
        <div class="field"><label>ROL (ore l'anno)</label><input name="rol" inputmode="decimal" value="${x ? UI.attr(UI.decimal(x.rol / 60)) : ''}"></div>
        <div class="field"><label>Ex festività (ore l'anno)</label><input name="ex_festivita" inputmode="decimal" value="${x ? UI.attr(UI.decimal(x.ex_festivita / 60)) : ''}"></div>
      </div>
      <div class="field"><label>Nota</label><input name="note" value="${UI.attr(x?.note)}"></div>
      ${x ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Attiva</label>` : ''}
      <p class="mod-note">I giorni di ferie si contano sui giorni lavorativi dell'orario del dipendente: con una settimana di 5 giorni, 4 settimane sono 20 giorni.</p>`,
    onSave: async b => {
      const body = { contract_types: [...b.querySelectorAll('[data-ct]:checked')].map(c => c.dataset.ct) };
      for (const k of ['name', 'ccnl', 'accrual', 'priority', 'ferie', 'rol', 'ex_festivita', 'note']) body[k] = UI.val(b, k);
      if (x) body.active = UI.val(b, 'active');
      await api('/api/admin/hr/absence-plans' + (x ? `/${x.id}` : ''), { method: x ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadHrAbsenceConfig();
    },
  });
}
function openAbsTypeModal(id) {
  const x = ABS.types.find(t => t.id === id) || null;
  const chk = (name, label) => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:4px 0"><input type="checkbox" name="${name}" ${x?.[name] ? 'checked' : ''}> ${label}</label>`;
  UI.modal({
    id: 'abs-type-modal', title: x ? `Modifica ${x.name}` : 'Nuovo tipo di assenza', width: 520,
    body: `${x ? '' : '<div class="field"><label>Codice</label><input name="code" placeholder="es. studio"></div>'}
      <div class="field"><label>Nome</label><input name="name" value="${UI.attr(x?.name)}"></div>
      <div class="field-row">
        <div class="field"><label>Flusso</label><select name="flow">${UI.options([{ id: 'approvazione', name: 'Richiede approvazione' }, { id: 'comunicazione', name: 'Si comunica (presa visione)' }], x?.flow || 'approvazione')}</select></div>
        <div class="field"><label>Unità</label><select name="unit">${UI.options([{ id: 'giorni', name: 'Giorni' }, { id: 'ore', name: 'Ore' }], x?.unit || 'giorni')}</select></div>
        <div class="field"><label>Contatore</label><select name="counter">${UI.options(Object.entries(ABS_COUNTERS).map(([id2, name]) => ({ id: id2, name })), x?.counter, { empty: 'Nessuno' })}</select></div>
      </div>
      ${chk('paid', 'Retribuita')}${chk('requires_protocol', 'Serve il protocollo del certificato')}${chk('health', 'Per motivi di salute (conta per la visita di rientro dopo 60 giorni)')}
      ${chk('allow_half_day', 'Si può prendere a mezza giornata')}${chk('allow_hours', 'Si può prendere a ore')}${x ? chk('active', 'Attivo') : ''}
      <div class="field" style="margin-top:12px"><label>Categoria (il pulsante nella richiesta del dipendente)</label><select name="category">${UI.options([{ id: 'ferie', name: 'Ferie' }, { id: 'permesso', name: 'Permesso' }, { id: 'malattia', name: 'Malattia' }, { id: 'congedo', name: 'Congedo' }], x?.category || 'permesso')}</select></div>
      <div class="mod-section-title" style="margin-top:14px">Giustificativo</div>
      ${chk('doc_required', 'Serve un giustificativo')}
      <div class="field"><label>Documento richiesto</label><input name="doc_label" value="${UI.attr(x?.doc_label)}" placeholder="es. Attestazione della struttura sanitaria con data e orario"></div>
      <div class="field"><label>Suggerimento per il dipendente</label><input name="doc_hint" value="${UI.attr(x?.doc_hint)}" placeholder="es. Non serve la diagnosi: basta l'attestazione"></div>
      <div class="field-row">
        <div class="field"><label>Entro quanti giorni dalla fine</label><input name="doc_deadline_days" inputmode="numeric" value="${UI.attr(x?.doc_deadline_days ?? '')}"></div>
        <div class="field"><label>Si giustifica con</label><select name="doc_mode">${UI.options([{ id: 'file', name: 'Un documento (file)' }, { id: 'protocol', name: 'Il numero di protocollo (INPS)' }], x?.doc_mode || 'file')}</select></div>
      </div>
      ${chk('doc_self_cert', "Si accetta l'autocertificazione (DPR 445/2000)")}
      <p class="mod-note">Tempi e documenti da verificare con il contratto collettivo e il consulente del lavoro. Chiedi solo ciò che giustifica l'assenza, mai la diagnosi.</p>`,
    onSave: async b => {
      const body = {};
      b.querySelectorAll('[name]').forEach(el => { body[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
      await api('/api/admin/hr/absence-types' + (x ? `/${x.id}` : ''), { method: x ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadHrAbsenceConfig();
    },
  });
}
function openAbsPeriodModal(id) {
  const p = (ABS.periods || []).find(x => x.id === id) || null;
  UI.modal({
    id: 'abs-period-modal', title: p ? `Modifica ${p.name}` : 'Nuovo periodo di blocco', width: 520,
    body: `
      <div class="field"><label>Nome</label><input name="name" value="${UI.attr(p?.name)}" placeholder="es. Vendemmia 2026"></div>
      <div class="field-row">
        <div class="field"><label>Dal</label><input type="date" name="start_date" value="${UI.attr(p?.start_date)}"></div>
        <div class="field"><label>Al</label><input type="date" name="end_date" value="${UI.attr(p?.end_date)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Sede</label><select name="site_id">${UI.options(ABS.sites, p?.site_id, { empty: 'Tutte' })}</select></div>
        <div class="field"><label>Squadra</label><select name="team_id">${UI.options(ABS.teams, p?.team_id, { empty: 'Tutte' })}</select></div>
      </div>
      <div class="field"><label>Modalità</label><select name="mode">${UI.options([{ id: 'avviso', name: 'Avviso al responsabile' }, { id: 'blocco', name: 'Richieste non ammesse' }], p?.mode || 'avviso')}</select></div>
      <div class="field"><label>Nota</label><input name="note" value="${UI.attr(p?.note)}"></div>`,
    onSave: async b => {
      const body = {};
      for (const k of ['name', 'start_date', 'end_date', 'site_id', 'team_id', 'mode', 'note']) body[k] = UI.val(b, k);
      await api('/api/admin/hr/absence-block-periods' + (p ? `/${p.id}` : ''), { method: p ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      loadHrAbsenceConfig();
    },
  });
}
function deleteAbsPeriod(id) { UI.confirmDo('Eliminare questo periodo?', () => api(`/api/admin/hr/absence-block-periods/${id}`, { method: 'DELETE' }), loadHrAbsenceConfig); }
