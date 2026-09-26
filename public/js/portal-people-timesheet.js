// Portale → People → Timesheet: l'unico posto dove si registrano le ore. Riepilogo del mese, foglio del
// dipendente (righe su centro di costo, assenze, proposte, conflitti, stati del mese, rettifiche), ore di
// squadra, export e configurazione. Chi non ha il workspace People vede solo questa sezione, con il proprio foglio.
const TS_STATUS = { aperto: ['grey', 'Aperto'], inviato: ['yellow', 'Inviato'], approvato: ['green', 'Approvato'] };
const TS_ORIGIN = { manuale: '', squadra: 'squadra', proposta: 'proposta', assenza: 'assenza', rettifica: 'rettifica' };
const TS_WEEKDAYS = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const TS = { period: UI.thisMonth(), employeeId: null, sheet: null, options: null, selfOnly: false };

const tsHours = m => `${(m / 60).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`;
async function tsOptions(force = false) {
  if (!TS.options || force) TS.options = await api('/api/admin/hr/timesheet/options');
  return TS.options;
}
const tsCenterOpts = (sel, empty = null) => UI.options(TS.options.centers, sel, { empty, label: c => `${c.code} ${c.name}` });
const tsObjectOpts = sel => UI.options(TS.options.objects, sel, { empty: '— Nessuno —', label: o => `${o.code} ${o.name} (${o.type})` });
const tsWarn = res => { if (res?.warnings?.length) alert(res.warnings.join('\n')); };

// ── Timesheet: riepilogo del mese ──────────────────────────────────────────────
async function loadHrTimesheet() {
  const root = document.getElementById('people-timesheet-root');
  await tsOptions(true);
  if (TS.employeeId) return loadTsSheet();
  const rows = await api(`/api/admin/hr/timesheet/overview?period=${TS.period}`);
  // Chi vede solo sé stesso va dritto al proprio foglio (e lì non c'è il ritorno al riepilogo).
  TS.selfOnly = rows.length === 1 && !!TS.options.me && rows[0].employee_id === TS.options.me.id && !TS.options.hr;
  if (TS.selfOnly) { TS.employeeId = rows[0].employee_id; return loadTsSheet(); }
  root.innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Timesheet di ${esc(UI.monthLabel(TS.period))}</h3><p class="mod-intro">Ore registrate e assenze contro l'orario. Ogni mese si invia al responsabile, che lo approva: dopo, le correzioni si fanno con una rettifica.</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields"><input type="month" value="${TS.period}" onchange="TS.period = this.value || UI.thisMonth(); loadHrTimesheet()"></div>
      ${TS.options.teams.length ? `<button class="btn secondary small" onclick="openTsTeamModal()">Ore di squadra</button>` : ''}
      ${TS.options.hr ? `<button class="btn secondary small" onclick="UI.download('/api/admin/hr/timesheet/export/${TS.period}')">Esporta CSV</button>` : ''}
    </div>
    ${rows.length ? `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Dipendente</th><th>Stato</th><th class="num">Lavorate</th><th class="num">Assenze</th><th class="num">Orario</th><th class="num">Giorni scoperti</th><th class="num">Conflitti</th><th class="num">Proposte</th></tr></thead><tbody>
      ${rows.map(x => `<tr class="mod-clickable" onclick="TS.employeeId = ${x.employee_id}; loadTsSheet()"><td><b>${esc(x.name)}</b></td>
        <td><span class="badge ${TS_STATUS[x.status][0]}">${TS_STATUS[x.status][1]}</span>${x.can_approve ? ' <span class="badge yellow">da approvare</span>' : ''}</td>
        <td class="num">${tsHours(x.worked)}</td><td class="num">${tsHours(x.absent)}</td><td class="num">${tsHours(x.scheduled)}</td>
        <td class="num" style="${x.missing_days ? 'color:var(--warn);font-weight:600' : ''}">${x.missing_days || '—'}</td>
        <td class="num" style="${x.conflicts ? 'color:var(--bad);font-weight:600' : ''}">${x.conflicts || '—'}</td><td class="num">${x.proposals || '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="mod-empty">Nessun dipendente da mostrare.</div>'}
  </div>`;
}

// ── Foglio del mese di un dipendente ───────────────────────────────────────────
async function loadTsSheet() {
  const root = document.getElementById('people-timesheet-root');
  if (!TS.options) await tsOptions();
  const s = TS.sheet = await api(`/api/admin/hr/timesheet/month?employee_id=${TS.employeeId}&period=${TS.period}`);
  const [cls, label] = TS_STATUS[s.status];
  const actions = [];
  if (s.can_submit) actions.push('<button class="btn small" onclick="tsMonthAction(\'submit\')">Invia al responsabile</button>');
  if (s.can_approve) actions.push('<button class="btn small" onclick="tsMonthAction(\'approve\')">Approva il mese</button>', '<button class="btn secondary small" onclick="tsReturnMonth()">Rimanda indietro</button>');
  if (s.can_adjust) actions.push('<button class="btn secondary small" onclick="openTsAdjustModal()">Rettifica</button>');
  if (TS.selfOnly && TS.options.teams.length) actions.push('<button class="btn secondary small" onclick="openTsTeamModal()">Ore di squadra</button>');
  const t = s.totals;
  root.innerHTML = `<div class="list-card">
    <div class="rec-head">
      ${TS.selfOnly ? '' : '<button class="btn secondary small" onclick="TS.employeeId = null; loadHrTimesheet()">← Timesheet</button>'}
      <div style="flex:1;min-width:200px"><div class="rec-name">${esc(s.employee.name)}</div><div class="rec-sub">${esc(UI.monthLabel(s.period))}</div></div>
      <input type="month" value="${s.period}" onchange="TS.period = this.value || UI.thisMonth(); loadTsSheet()" style="height:34px;border:1px solid var(--line-strong);border-radius:4px;padding:0 8px">
      <span class="badge ${cls}">${label}</span>
      ${actions.join('')}
    </div>
    <div class="mod-body">
      ${s.month?.return_note && s.status === 'aperto' ? `<div class="mod-warn">Rimandato indietro: ${esc(s.month.return_note)}</div>` : ''}
      ${s.conflicts.length ? `<div class="mod-section-title">Conflitti tra ore e assenze</div>${s.conflicts.map(c => `<div class="mod-anomaly" style="display:flex;gap:10px;align-items:center;justify-content:space-between">
        <span>${esc(c.message)}</span>${s.can_edit ? `<button class="btn-outline-pill" onclick="tsResolveConflict(${c.id})">Risolto</button>` : ''}</div>`).join('')}` : ''}
      ${s.proposals.length ? `<div class="mod-section-title">Proposte da confermare</div>${s.proposals.map((p, i) => `<div class="dl-item">
        <div class="mod-row-main"><div class="mod-row-title">${UI.date(p.work_date)} · ${p.start_time}–${p.end_time} · ${esc(p.label)}</div>
          <div class="mod-row-sub">${esc([p.cost_center, p.cost_object].filter(Boolean).join(' · ') || 'Centro da scegliere')}</div></div>
        <div class="mod-row-actions"><button class="btn small" onclick="tsProposal(${i}, 'accept')">Conferma</button><button class="btn secondary small" onclick="tsProposal(${i}, 'dismiss')">Scarta</button></div></div>`).join('')}
        <p class="mod-note">Le proposte vengono dalle prenotazioni assegnate e dalle fiere di cui la persona è responsabile: non diventano ore finché qualcuno non le conferma.</p>` : ''}
      <div class="mod-section-title">Giorni</div>
      <div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Giorno</th><th class="num">Orario</th><th>Ore e assenze</th><th class="num">Differenza</th><th></th></tr></thead><tbody>
        ${s.days.map(d => `<tr style="${d.holiday || !d.scheduled ? 'background:var(--cream)' : ''}">
          <td style="white-space:nowrap"><b>${TS_WEEKDAYS[d.weekday]} ${Number(d.date.slice(8))}</b>${d.holiday ? `<br><span class="mod-note" style="margin:0">${esc(d.holiday)}</span>` : ''}</td>
          <td class="num">${d.scheduled ? tsHours(d.scheduled) : '—'}</td>
          <td>${d.entries.map(x => tsEntryLine(x, s)).join('') || '<span class="mod-note" style="margin:0">—</span>'}</td>
          <td class="num" style="${d.flag === 'mancano' ? 'color:var(--warn);font-weight:600' : d.flag === 'oltre' ? 'color:var(--ok)' : ''}">${d.diff ? `${d.diff > 0 ? '+' : '−'}${tsHours(Math.abs(d.diff))}` : ''}</td>
          <td>${s.can_edit ? `<button class="btn-outline-pill" title="Aggiungi ore" onclick="openTsEntryModal('${d.date}')">+ ore</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="mod-section-title" style="margin-top:22px">Totali del mese</div>
      <dl class="mod-kv">
        <dt>Ore ordinarie</dt><dd>${tsHours(t.ordinaria)}</dd>
        ${t.straordinaria ? `<dt>Straordinarie</dt><dd>${tsHours(t.straordinaria)}</dd>` : ''}${t.notturna ? `<dt>Notturne</dt><dd>${tsHours(t.notturna)}</dd>` : ''}${t.festiva ? `<dt>Festive</dt><dd>${tsHours(t.festiva)}</dd>` : ''}
        <dt>Giornate lavorate</dt><dd>${t.worked_days}</dd>
        <dt>Orario del mese</dt><dd>${tsHours(t.scheduled)}</dd>
        ${Object.entries(t.absences).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${tsHours(v)}</dd>`).join('')}
        ${Object.keys(t.centers).length ? `<dt>Per centro</dt><dd>${Object.entries(t.centers).map(([k, v]) => `${esc(k)}: ${tsHours(v)}`).join('<br>')}</dd>` : ''}
      </dl>
      ${s.adjustments.length ? `<div class="mod-section-title" style="margin-top:22px">Rettifiche</div>${s.adjustments.map(a => `<div class="dl-item"><div class="mod-row-main"><div class="mod-row-title">${esc(a.reason)}</div>
        <div class="mod-row-sub">${new Date(a.created_at).toLocaleString('it-IT')} · ${esc(a.created_by || '')}</div></div></div>`).join('')}` : ''}
    </div>
  </div>`;
}
function tsEntryLine(x, s) {
  const dead = x.voided_by_adjustment_id ? 'text-decoration:line-through;opacity:.5' : '';
  if (x.origin === 'assenza') return `<div style="${dead}"><span class="badge grey">${esc(x.absence_type)}</span> ${tsHours(x.minutes)}${x.start_time ? ` · ${x.start_time}–${x.end_time}` : ''}</div>`;
  const where = x.allocations.map(a => `${esc(a.center_code)}${a.object_code ? ` · ${esc(a.object_code)}` : ''}${x.allocations.length > 1 ? ` (${tsHours(a.minutes)})` : ''}`).join(', ');
  const editable = s.can_edit && !x.voided_by_adjustment_id;
  return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:2px 0;${dead}">
    <b>${x.start_time}–${x.end_time}</b> <span>${where}</span>
    ${x.hour_type !== 'ordinaria' ? `<span class="badge yellow">${esc(TS.options.hour_types[x.hour_type])}</span>` : ''}
    ${TS_ORIGIN[x.origin] ? `<span class="badge grey">${TS_ORIGIN[x.origin]}</span>` : ''}
    ${x.note ? `<span class="mod-note" style="margin:0">${esc(x.note)}</span>` : ''}
    ${editable ? `<button class="btn-outline-pill" onclick="openTsEntryModal('${x.work_date}', ${x.id})">Modifica</button><button class="btn-outline-pill danger" title="Elimina" onclick="tsDeleteEntry(${x.id})">${UI.icon.trash}</button>` : ''}
  </div>`;
}
async function tsMonthAction(action) {
  try {
    await api(`/api/admin/hr/timesheet/months/${action}`, { method: 'POST', body: JSON.stringify({ employee_id: TS.employeeId, period: TS.period }) });
    loadTsSheet();
  } catch (e) { alert(e.message); }
}
function tsReturnMonth() {
  UI.modal({ id: 'ts-return-modal', title: 'Rimanda indietro il mese', width: 460, saveLabel: 'Rimanda', body: '<div class="field"><label>Cosa va corretto</label><textarea name="note" rows="3"></textarea></div>',
    onSave: async b => { await api('/api/admin/hr/timesheet/months/return', { method: 'POST', body: JSON.stringify({ employee_id: TS.employeeId, period: TS.period, note: UI.val(b, 'note') }) }); loadTsSheet(); } });
}
async function tsResolveConflict(id) {
  try { await api(`/api/admin/hr/timesheet/conflicts/${id}/resolve`, { method: 'POST', body: JSON.stringify({}) }); loadTsSheet(); } catch (e) { alert(e.message); }
}
async function tsProposal(i, action) {
  const p = TS.sheet.proposals[i];
  try {
    const res = await api(`/api/admin/hr/timesheet/proposals/${action}`, { method: 'POST', body: JSON.stringify({ employee_id: TS.employeeId, source: p.source, source_id: p.source_id, work_date: p.work_date }) });
    tsWarn(res);
    loadTsSheet();
  } catch (e) { alert(e.message); }
}
function tsDeleteEntry(id) { UI.confirmDo('Eliminare queste ore?', () => api(`/api/admin/hr/timesheet/entries/${id}`, { method: 'DELETE' }), loadTsSheet); }

// Riga di ore: un centro e un oggetto, oppure la ripartizione del blocco su più centri.
function tsAllocRow(a = {}) {
  return `<div class="mod-edit-row" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1.3fr) 80px auto">
    <select data-al="cost_center_id">${tsCenterOpts(a.cost_center_id, '— Centro —')}</select>
    <select data-al="cost_object_id">${tsObjectOpts(a.cost_object_id)}</select>
    <input data-al="hours" inputmode="decimal" placeholder="ore" value="${a.minutes ? UI.attr(String(a.minutes / 60).replace('.', ',')) : ''}">
    <button type="button" class="btn-outline-pill danger" onclick="this.parentElement.remove()">×</button>
  </div>`;
}
function openTsEntryModal(date, entryId) {
  const x = entryId ? TS.sheet.days.flatMap(d => d.entries).find(e => e.id === entryId) : null;
  const allocs = x?.allocations || [];
  const split = allocs.length > 1;
  UI.modal({
    id: 'ts-entry-modal', title: x ? 'Modifica ore' : `Ore del ${UI.date(date)}`, width: 620,
    body: `
      <div class="field-row">
        <div class="field"><label>Giorno</label><input type="date" name="work_date" value="${x?.work_date || date}"></div>
        <div class="field"><label>Dalle</label><input name="start_time" placeholder="08:00" value="${UI.attr(x?.start_time)}"></div>
        <div class="field"><label>Alle</label><input name="end_time" placeholder="12:00" value="${UI.attr(x?.end_time)}"></div>
        <div class="field"><label>Tipo</label><select name="hour_type">${UI.options(Object.entries(TS.options.hour_types).map(([id, name]) => ({ id, name })), x?.hour_type || 'ordinaria')}</select></div>
      </div>
      <div id="ts-single" style="${split ? 'display:none' : ''}" class="field-row">
        <div class="field"><label>Centro di costo (per il vigneto, la particella)</label><select name="cost_center_id">${tsCenterOpts(allocs[0]?.cost_center_id ?? TS.sheet.employee.cost_center_id, '— Centro —')}</select></div>
        <div class="field"><label>Oggetto di costo (operazione, lotto…)</label><select name="cost_object_id">${tsObjectOpts(allocs[0]?.cost_object_id)}</select></div>
      </div>
      <div id="ts-split" style="${split ? '' : 'display:none'}">
        <label style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-faint)">Ripartizione del blocco</label>
        <div class="mod-edit-rows" id="ts-alloc-rows">${(split ? allocs : [{}, {}]).map(tsAllocRow).join('')}</div>
        <button type="button" class="btn secondary small" style="margin-top:6px" onclick="document.getElementById('ts-alloc-rows').insertAdjacentHTML('beforeend', tsAllocRow())">+ Centro</button>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:10px 0"><input type="checkbox" id="ts-split-toggle" ${split ? 'checked' : ''}
        onchange="document.getElementById('ts-split').style.display = this.checked ? '' : 'none'; document.getElementById('ts-single').style.display = this.checked ? 'none' : ''"> Dividi su più centri</label>
      <div class="field"><label>Nota</label><input name="note" value="${UI.attr(x?.note)}"></div>
      <p class="mod-note">Orari a passi di ${TS.options.granularity} minuti. Un turno che passa la mezzanotte va diviso su due giorni.</p>`,
    onSave: async b => {
      const body = { employee_id: TS.employeeId };
      for (const k of ['work_date', 'start_time', 'end_time', 'hour_type', 'note']) body[k] = UI.val(b, k);
      if (b.querySelector('#ts-split-toggle').checked) {
        body.allocations = [...b.querySelectorAll('#ts-alloc-rows .mod-edit-row')].map(row => ({
          cost_center_id: row.querySelector('[data-al="cost_center_id"]').value, cost_object_id: row.querySelector('[data-al="cost_object_id"]').value || null, hours: UI.num(row.querySelector('[data-al="hours"]').value),
        })).filter(a => a.cost_center_id);
      } else {
        body.cost_center_id = UI.val(b, 'cost_center_id');
        body.cost_object_id = UI.val(b, 'cost_object_id') || null;
      }
      const res = await api('/api/admin/hr/timesheet/entries' + (x ? `/${x.id}` : ''), { method: x ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      tsWarn(res);
      loadTsSheet();
    },
  });
}

// ── Ore di squadra ─────────────────────────────────────────────────────────────
const tsTeamMembers = t => (t?.members || []).map(m => `<label><input type="checkbox" data-member="${m.id}" checked> ${esc(m.name)}</label>`).join('');
function tsTeamChanged(sel) {
  document.getElementById('ts-team-members').innerHTML = tsTeamMembers(TS.options.teams.find(t => String(t.id) === sel.value));
}
async function openTsTeamModal() {
  await tsOptions();
  const teams = TS.options.teams;
  UI.modal({
    id: 'ts-team-modal', title: 'Ore di squadra', width: 620, saveLabel: 'Registra per tutti',
    body: `
      <div class="field"><label>Squadra</label><select name="team_id" onchange="tsTeamChanged(this)">${UI.options(teams, teams[0]?.id)}</select></div>
      <div class="field-row">
        <div class="field"><label>Giorno</label><input type="date" name="work_date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>Dalle</label><input name="start_time" placeholder="07:00"></div>
        <div class="field"><label>Alle</label><input name="end_time" placeholder="12:00"></div>
        <div class="field"><label>Tipo</label><select name="hour_type">${UI.options(Object.entries(TS.options.hour_types).map(([id, name]) => ({ id, name })), 'ordinaria')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Particella / centro</label><select name="cost_center_id">${tsCenterOpts('', '— Centro —')}</select></div>
        <div class="field"><label>Operazione</label><select name="cost_object_id">${tsObjectOpts('')}</select></div>
      </div>
      <div class="field"><label>Chi c'era</label><div class="mod-checklist" id="ts-team-members">${tsTeamMembers(teams[0])}</div></div>
      <div class="field"><label>Nota</label><input name="note"></div>
      <p class="mod-note">Se per qualcuno c'è un blocco (abilitazione mancante, permesso scaduto, giorno di assenza…) non si registra nulla: togli la spunta a chi è bloccato e riprova.</p>`,
    onSave: async b => {
      const body = { member_ids: [...b.querySelectorAll('[data-member]:checked')].map(c => Number(c.dataset.member)) };
      for (const k of ['team_id', 'work_date', 'start_time', 'end_time', 'hour_type', 'cost_center_id', 'cost_object_id', 'note']) body[k] = UI.val(b, k) || null;
      const res = await api('/api/admin/hr/timesheet/team', { method: 'POST', body: JSON.stringify(body) });
      tsWarn(res);
      alert(`Ore registrate per ${res.ids.length} ${res.ids.length === 1 ? 'persona' : 'persone'}.`);
      loadHrTimesheet();
    },
  });
}

// ── Rettifica (mese approvato) ─────────────────────────────────────────────────
async function openTsAdjustModal() {
  const s = TS.sheet;
  const work = s.days.flatMap(d => d.entries).filter(x => x.origin !== 'assenza' && !x.voided_by_adjustment_id);
  const absences = await api(`/api/admin/hr/absences?employee_id=${s.employee.id}&from=${s.period}-01&to=${s.days.at(-1).date}`).then(l => l.filter(a => ['approvata', 'comunicata', 'presa_visione'].includes(a.status))).catch(() => []);
  UI.modal({
    id: 'ts-adjust-modal', title: `Rettifica di ${UI.monthLabel(s.period)}`, width: 660, saveLabel: 'Registra la rettifica',
    body: `
      <div class="field"><label>Motivo</label><textarea name="reason" rows="2" placeholder="es. ore della mattina imputate al centro sbagliato"></textarea></div>
      <div class="field"><label>Righe da annullare</label><div class="mod-checklist">${work.map(x => `<label><input type="checkbox" data-void="${x.id}"> ${UI.date(x.work_date)} · ${x.start_time}–${x.end_time} · ${x.allocations.map(a => esc(a.center_code)).join(', ')}</label>`).join('') || '<span class="mod-note">Nessuna riga.</span>'}</div></div>
      ${absences.length ? `<div class="field"><label>Assenza da annullare (facoltativa)</label><select name="cancel_absence_id">${UI.options(absences, '', { empty: '— Nessuna —', label: a => `${a.type_name} ${UI.date(a.start_date)}${a.end_date !== a.start_date ? ` → ${UI.date(a.end_date)}` : ''}` })}</select></div>` : ''}
      <div class="field"><label>Righe da aggiungere</label><div class="mod-edit-rows" id="ts-adj-rows"></div>
        <button type="button" class="btn secondary small" style="margin-top:6px" onclick="document.getElementById('ts-adj-rows').insertAdjacentHTML('beforeend', tsAdjRow())">+ Riga</button></div>
      <p class="mod-note">Le righe annullate restano visibili, barrate. La rettifica resta nel registro con il motivo e aggiorna le ore passate a Finance.</p>`,
    onSave: async b => {
      const body = { employee_id: s.employee.id, period: s.period, reason: UI.val(b, 'reason'), void_entry_ids: [...b.querySelectorAll('[data-void]:checked')].map(c => Number(c.dataset.void)),
        cancel_absence_id: UI.val(b, 'cancel_absence_id') || null,
        add_entries: [...b.querySelectorAll('#ts-adj-rows .mod-edit-row')].map(row => Object.fromEntries([...row.querySelectorAll('[data-adj]')].map(i => [i.dataset.adj, i.value || null]))).filter(r2 => r2.work_date) };
      const res = await api('/api/admin/hr/timesheet/adjustments', { method: 'POST', body: JSON.stringify(body) });
      tsWarn(res);
      loadTsSheet();
    },
  });
}
function tsAdjRow() {
  const s = TS.sheet;
  return `<div class="mod-edit-row" style="grid-template-columns:130px 70px 70px minmax(0,1fr) minmax(0,1fr) auto">
    <input type="date" data-adj="work_date" min="${s.period}-01" max="${s.days.at(-1).date}" value="${s.period}-01"><input data-adj="start_time" placeholder="08:00"><input data-adj="end_time" placeholder="12:00">
    <select data-adj="cost_center_id">${tsCenterOpts(s.employee.cost_center_id, '— Centro —')}</select><select data-adj="cost_object_id">${tsObjectOpts('')}</select>
    <button type="button" class="btn-outline-pill danger" onclick="this.parentElement.remove()">×</button>
  </div>`;
}

// Apre il foglio di una persona da un altro punto (scheda del dipendente, Il mio spazio).
function tsOpenFor(employeeId, period) {
  TS.employeeId = employeeId;
  if (period) TS.period = period;
  if (!document.getElementById('module-people').classList.contains('active')) switchWorkspace('people');
  clickSidebarSub('people-timesheet');
}

// ── Configurazione ─────────────────────────────────────────────────────────────
async function loadHrTimesheetConfig() {
  const box = document.getElementById('hr-timesheet-config-box');
  if (!box) return;
  const [s, opts] = await Promise.all([api('/api/admin/hr/timesheet/settings'), tsOptions(true)]);
  const centerSel = (name, code) => `<select id="ts-set-${name}">${UI.options(opts.centers, code, { value: c => c.code, label: c => `${c.code} ${c.name}` })}</select>`;
  box.innerHTML = `<div class="list-card">
    <div class="list-toolbar"><div class="list-toolbar-title"><h3>Timesheet</h3><p class="mod-intro">Passo degli orari, centri usati per le righe proposte e colonne dell'export per il consulente del lavoro.</p></div></div>
    <div class="mod-body">
      <div class="field-row">
        <div class="field"><label>Passo degli orari</label><select id="ts-set-granularity">${[15, 30, 60].map(g => `<option value="${g}" ${g === s.granularity ? 'selected' : ''}>${g} minuti</option>`).join('')}</select></div>
        <div class="field"><label>Centro per le visite</label>${centerSel('booking_center', s.booking_center)}</div>
      </div>
      <div class="field-row">
        <div class="field"><label>Centro per gli eventi</label>${centerSel('event_center', s.event_center)}</div>
        <div class="field"><label>Centro per le fiere</label>${centerSel('fair_center', s.fair_center)}</div>
      </div>
      <div class="field-row">
        <div class="field"><label>Centro per le ore di vigneto</label>${centerSel('vineyard_center', s.vineyard_center)}</div>
        <div class="field"></div>
      </div>
      <div class="field"><label>Colonne dell'export</label><div class="mod-checklist">${Object.entries(s.available_columns).map(([k, l]) => `<label><input type="checkbox" data-col="${k}" ${s.export_columns.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>
      <button class="btn small" onclick="saveTsSettings()">Salva</button><div id="ts-set-msg"></div>
    </div>
  </div>`;
}
async function saveTsSettings() {
  try {
    await api('/api/admin/hr/timesheet/settings', { method: 'PUT', body: JSON.stringify({
      granularity: Number(document.getElementById('ts-set-granularity').value),
      booking_center: document.getElementById('ts-set-booking_center').value, event_center: document.getElementById('ts-set-event_center').value, fair_center: document.getElementById('ts-set-fair_center').value,
      vineyard_center: document.getElementById('ts-set-vineyard_center').value,
      export_columns: [...document.querySelectorAll('#hr-timesheet-config-box [data-col]:checked')].map(c => c.dataset.col),
    }) });
    TS.options = null;
    UI.msg(document.getElementById('ts-set-msg'), 'Salvato.', 'success');
  } catch (e) { UI.msg(document.getElementById('ts-set-msg'), e.message); }
}
