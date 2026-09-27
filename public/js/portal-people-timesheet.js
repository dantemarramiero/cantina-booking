// Portale → People. Due schermate sullo stesso foglio del mese (design: handoff MyWinery «Timesheet»):
//  - Timesheet: la schermata personale di ogni utente collegato a una scheda dipendente, con tre schede.
//      · Le mie ore: giorni per settimana, più fasce orarie al giorno su centro di costo (editor laterale),
//        riepilogo del mese, ore per centro, invio al responsabile e «Riapri» finché non è approvato.
//      · Ferie e permessi: saldi, nuova richiesta per categoria e motivo, le proprie richieste (modulo Assenze).
//      · Giustificativi: i documenti a supporto delle assenze che li richiedono (portal-people-justifications.js).
//      · Richieste del team: per responsabili, delegati e ufficio del personale, calendario delle assenze e
//        decisioni (approva, rifiuta con motivo, presa visione delle comunicazioni).
//      · Richieste del team: tutto ciò che si decide. Assenze (calendario e decisioni), Presenze (fogli dei
//        collaboratori in sola lettura, approvazione o rinvio del mese, rettifiche, export per il consulente)
//        e, per l'ufficio del personale, Modifiche dati (IBAN, residenza, contatti dal self-service).
//      · Registro (chi ha il workspace People): elenco di tutte le assenze, verifica dei giustificativi, contatori.
// Nel menu di People non ci sono più Assenze, Presenze e Richieste: sono queste sezioni.
// Le assenze entrano nel foglio solo da una richiesta approvata (o una comunicazione): nell'editor non si inseriscono.
const TS_STATUS = { aperto: ['neutral', 'Aperto'], inviato: ['warning', 'Inviato'], approvato: ['success', 'Approvato'] };
const TS_ORIGIN = { manuale: '', squadra: 'squadra', proposta: 'proposta', assenza: 'assenza', rettifica: 'rettifica' };
const TS_DN = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const TS_DNF = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const TS_MN = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
// mode: 'self' (Timesheet) o 'review' (Presenze, reviewId = il collaboratore aperto).
const TS = { period: UI.thisMonth(), mode: 'self', employeeId: null, reviewId: null, sheet: null, options: null, tab: 'ore', teamSeg: 'assenze',
  compact: true, openDays: new Set(), onlyMissing: false, counts: { mine: 0, team: 0 }, urlTab: null };

// Icone (Lucide, come nel design system).
const TSI_PATHS = {
  'chevron-right': '<path d="m9 18 6-6-6-6"/>', 'chevron-left': '<path d="m15 18-6-6 6-6"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>', x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-2.93 1.41-1.41M17.66 6.34l1.41-1.41M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>', 'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  rows: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M21 9H3M21 15H3"/>', list: '<path d="M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13"/>',
  expand: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>', collapse: '<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>', download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41a2 2 0 0 0-.59 1.42V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16m5 0H3v5"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>', 'chevron-up': '<path d="m18 15-6-6-6 6"/>',
};
const tsi = (name, size = 16) => `<svg class="ts-ic" style="width:${size}px;height:${size}px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TSI_PATHS[name] || ''}</svg>`;

// Numeri e date
const tsHours = m => `${(m / 60).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`;
const tsH = m => { const h = m / 60; return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} h`; };
const tsToMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const tsFromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const tsToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const tsDate = s => new Date(`${s}T00:00:00`);
const tsAddDays = (s, n) => { const d = tsDate(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const tsIsoWeek = s => { const d = tsDate(s); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); };
const tsInitials = n => String(n || '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const tsShiftMonth = (p, n) => { const [y, m] = p.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

async function tsOptions(force = false) {
  if (!TS.options || force) TS.options = await api('/api/admin/hr/timesheet/options');
  TS.centers = Object.fromEntries(TS.options.centers.map(c => [c.id, c]));
  return TS.options;
}
const tsCenterOpts = (sel, empty = null) => UI.options(TS.options.centers, sel, { empty, label: c => `${c.code} ${c.name}` });
const tsObjectOpts = sel => UI.options(TS.options.objects, sel, { empty: '— Nessuno —', label: o => `${o.code} ${o.name} (${o.type})` });
const tsWarn = res => { if (res?.warnings?.length) tsToast('Da sapere', res.warnings.join(' '), 'warn'); };
const tsRoot = () => document.getElementById(TS.mode === 'review' ? 'people-presenze-root' : 'people-timesheet-root');
function tsToast(title, message = '', tone = '') {
  document.querySelector('.ts-toast')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="ts-toast ${tone === 'warn' ? 'is-warn' : ''}">${tsi(tone === 'warn' ? 'info' : 'check')}<div><b>${esc(title)}</b>${message ? `<span>${esc(message)}</span>` : ''}</div></div>`);
  const el = document.querySelector('.ts-toast');
  setTimeout(() => el?.remove(), tone === 'warn' ? 6000 : 2600);
}
function tsDialog({ title, text, buttons }) {
  document.querySelector('.ts-dialog-veil')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="ts-dialog-veil"><div class="ts-dialog" role="dialog" aria-label="${UI.attr(title)}"><h3>${esc(title)}</h3><p>${esc(text)}</p>
    <div class="ts-dbtns">${buttons.map((b, i) => `<button type="button" class="ts-btn ${b.variant || 'ghost'}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div></div>`);
  const veil = document.querySelector('.ts-dialog-veil');
  veil.addEventListener('click', ev => { if (ev.target === veil) veil.remove(); });
  veil.querySelectorAll('[data-i]').forEach(btn => btn.onclick = () => { veil.remove(); buttons[btn.dataset.i].onClick?.(); });
}

// ── Timesheet: la propria schermata ────────────────────────────────────────────
async function loadHrTimesheet() {
  TS.mode = 'self';
  if (TS.urlTab === null) {
    const q = new URLSearchParams(location.search);
    TS.urlTab = q.get('tab') || '';
    if (['ore', 'ferie', 'giustificativi', 'team', 'registro'].includes(TS.urlTab)) TS.tab = TS.urlTab;
    if (['assenze', 'straordinari', 'presenze', 'dati'].includes(q.get('seg'))) TS.teamSeg = q.get('seg');
  }
  await tsOptions(true);
  if (!TS.options.me) {
    tsRoot().innerHTML = '<div class="list-card"><div class="mod-empty">La tua utenza non è collegata a una scheda dipendente, quindi non hai un Timesheet. Chiedi di collegarla in Impostazioni → Utenti.</div></div>';
    return;
  }
  if (TS.tab === 'team' && !TS.options.supervises) TS.tab = 'ore';
  if (TS.tab === 'registro' && !tsHasPeople()) TS.tab = 'ore';
  if (TS.tab === 'team' && TS.teamSeg === 'dati' && !TS.options.hr) TS.teamSeg = 'assenze';
  TS.employeeId = TS.options.me.id;
  await tsLoadCounts();
  if (TS.tab === 'ferie') return tsRenderLeave();
  if (TS.tab === 'giustificativi') return tsRenderDocs();
  if (TS.tab === 'team') return TS.teamSeg === 'straordinari' ? tsRenderTeamOvertime() : TS.teamSeg === 'presenze' ? tsRenderTeamPresenze() : TS.teamSeg === 'dati' ? tsRenderTeamData() : tsRenderTeam();
  if (TS.tab === 'registro') return tsRenderRegistry();
  return loadTsSheet();
}
// Il workspace People completo (non solo il Timesheet): serve per il Registro.
const tsHasPeople = () => typeof PERMITTED_WORKSPACES === 'undefined' || PERMITTED_WORKSPACES === null || (PERMITTED_WORKSPACES.includes('people') && !window.PEOPLE_TIMESHEET_ONLY);
// Sezioni di «Richieste del team»: la barra sopra il contenuto.
function tsTeamSegs() {
  const segs = [['assenze', 'Assenze', TS.counts.teamAbs], ['straordinari', 'Straordinari', TS.counts.ot], ['presenze', 'Presenze', 0], ...(TS.options.hr ? [['dati', 'Modifiche dati', TS.counts.data]] : [])];
  return `<div class="rq-seg">${segs.map(([k, l, n]) => `<button type="button" class="${TS.teamSeg === k ? 'is-on' : ''}" onclick="TS.teamSeg = '${k}'; TS.reviewId = null; loadHrTimesheet()">${l}${n ? ` <b style="margin-left:4px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--mw-rame-500);color:#fff;font-size:11px;display:inline-grid;place-items:center">${n}</b>` : ''}</button>`).join('')}</div>`;
}
// Presenze e Modifiche dati, Registro: le schermate dell'ufficio del personale dentro il Timesheet.
async function tsRenderTeamPresenze() {
  document.getElementById('people-timesheet-root').innerHTML = `<div class="ts-page">${tsHead({})}${tsTeamSegs()}<div id="people-presenze-root"></div></div>`;
  return loadHrPresenze();
}
// Straordinari da approvare: valgono (mese, export, Finance) solo dopo l'approvazione.
async function tsRenderTeamOvertime() {
  TS.otView = TS.otView || 'da_approvare';
  const rows = await api(`/api/admin/hr/timesheet/overtime?state=${TS.otView === 'storico' ? 'all' : 'da_approvare'}`);
  const list = TS.otView === 'storico' ? rows.filter(x => x.status !== 'da_approvare') : rows;
  const tone = { da_approvare: ['warning', 'Da approvare'], approvato: ['success', 'Approvato'], rifiutato: ['danger', 'Non approvato'] };
  document.getElementById('people-timesheet-root').innerHTML = `<div class="ts-page">${tsHead({})}${tsTeamSegs()}
    <section class="ts-card rq-list">
      <div class="rq-listhead"><div class="rq-filter">
        <button type="button" class="${TS.otView !== 'storico' ? 'is-on' : ''}" onclick="TS.otView = 'da_approvare'; tsRenderTeamOvertime()">Da approvare${TS.counts.ot ? ` <b>${TS.counts.ot}</b>` : ''}</button>
        <button type="button" class="${TS.otView === 'storico' ? 'is-on' : ''}" onclick="TS.otView = 'storico'; tsRenderTeamOvertime()">Storico</button></div>
        <span class="ts-muted" style="font-size:12px">Finché non è approvato, lo straordinario non conta nel mese, nell'export e per Finance.</span></div>
      ${list.map(x => `<div class="rq-row"><span class="rq-avatar">${esc(tsInitials(x.employee_name))}</span>
        <div class="rq-main"><div class="rq-title"><b>${esc(x.employee_name)}</b>${x.employee_job_title ? `<span class="ts-muted">· ${esc(x.employee_job_title)}</span>` : ''}<span class="rq-typetag t-fer">Straordinario</span></div>
          <div class="rq-when">${rqShort(x.work_date)} · ${x.start_time}–${x.end_time} <span class="ts-muted">· ${tsH(x.minutes)}</span></div>
          <div class="ts-muted" style="font-size:13px">${x.allocations.map(a => esc(`${a.center_code} ${a.center_name}${a.object_name ? ` · ${a.object_name}` : ''}`)).join(', ')}</div>
          ${x.note ? `<div class="rq-note">“${esc(x.note)}”</div>` : ''}${x.status === 'rifiutato' && x.decision_note ? `<div class="rq-reason">${tsi('message', 14)}${esc(x.decision_note)}</div>` : ''}
          ${x.status === 'da_approvare' ? (x.month_status === 'approvato' ? '<div class="ts-muted" style="font-size:12px">Mese già approvato: si cambia con una rettifica.</div>' : `<div class="rq-actions" id="ot-dec-${x.id}">
            <button type="button" class="ts-btn primary sm" onclick="tsDecideOvertime(${x.id}, 'approve')">${tsi('check', 14)}Approva</button>
            <button type="button" class="ts-btn secondary sm" onclick="tsRejectOvertimeForm(${x.id})">${tsi('x', 14)}Rifiuta</button></div>`) : ''}
        </div>
        <div class="rq-side"><span class="ts-badge ${tone[x.status][0]}">${tone[x.status][1]}</span>${x.decided_by ? `<span class="ts-muted">${esc(x.decided_by)}</span>` : ''}</div></div>`).join('')
        || `<div class="rq-empty">${tsi('circle-check', 28)}<b>${TS.otView === 'storico' ? 'Nessuna decisione negli ultimi mesi' : 'Nessuno straordinario da approvare'}</b><span>Quando qualcuno segna ore di straordinario le trovi qui.</span></div>`}
    </section></div>`;
}
function tsRejectOvertimeForm(id) {
  document.getElementById(`ot-dec-${id}`).outerHTML = `<div class="rq-rej" id="ot-dec-${id}"><input class="ts-input" id="ot-reason-${id}" placeholder="Motivo (lo legge il dipendente)" oninput="document.getElementById('ot-rej-${id}').disabled = !this.value.trim()">
    <button type="button" class="ts-btn ghost sm" onclick="tsRenderTeamOvertime()">Annulla</button><button type="button" class="ts-btn danger sm" id="ot-rej-${id}" disabled onclick="tsDecideOvertime(${id}, 'reject')">Rifiuta</button></div>`;
  document.getElementById(`ot-reason-${id}`).focus();
}
async function tsDecideOvertime(id, action) {
  try {
    const note = action === 'reject' ? document.getElementById(`ot-reason-${id}`).value.trim() : undefined;
    await api(`/api/admin/hr/timesheet/entries/${id}/overtime/${action}`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) });
    tsToast(action === 'approve' ? 'Straordinario approvato' : 'Straordinario non approvato');
    await tsLoadCounts();
    tsRenderTeamOvertime();
  } catch (e) { alert(e.message); }
}
async function tsRenderTeamData() {
  document.getElementById('people-timesheet-root').innerHTML = `<div class="ts-page">${tsHead({})}${tsTeamSegs()}<div id="people-richieste-root"></div></div>`;
  return loadHrChangeRequests();
}
async function tsRenderRegistry() {
  document.getElementById('people-timesheet-root').innerHTML = `<div class="ts-page">${tsHead({})}<div id="people-assenze-root"></div></div>`;
  return loadHrAbsences();
}
async function tsLoadCounts() {
  const [mine, team, docs] = await Promise.all([
    api(`/api/admin/hr/absences?employee_id=${TS.employeeId}`).catch(() => []),
    TS.options.supervises ? api('/api/admin/hr/absences?to_decide=1').catch(() => []) : [],
    api('/api/admin/hr/absences/justifications/mine').catch(() => []),
    TS.options.hr ? api('/api/admin/hr/change-requests?status=richiesta').catch(() => []) : [],
    TS.options.supervises ? api('/api/admin/hr/timesheet/overtime').catch(() => []) : [],
  ]).then(([m, t, d, c, o]) => (TS.pendingData = c.filter(x => x.status === 'richiesta').length, TS.pendingOt = o.length, [m, t, d]));
  TS.myAbsences = mine;
  TS.myDocs = docs;
  TS.counts = { mine: mine.filter(a => a.status === 'richiesta').length, teamAbs: team.filter(a => a.employee_id !== TS.employeeId).length, data: TS.pendingData || 0, ot: TS.pendingOt || 0, team: team.filter(a => a.employee_id !== TS.employeeId).length + (TS.pendingData || 0) + (TS.pendingOt || 0), docs: docs.filter(d => ['todo', 'ko'].includes(d.status)).length };
}
function tsSetTab(t) { TS.tab = t; loadHrTimesheet(); }
function tsHead({ s = null, review = false }) {
  const who = review ? s.employee : { name: TS.options.me.name };
  const tabs = review ? '' : `<div class="ts-tabs" role="tablist">${[['ore', 'Le mie ore'], ['ferie', 'Ferie e permessi', TS.counts.mine], ['giustificativi', 'Giustificativi', TS.counts.docs], ...(TS.options.supervises ? [['team', 'Richieste del team', TS.counts.team]] : []), ...(tsHasPeople() ? [['registro', 'Registro']] : [])]
    .map(([k, l, n]) => `<button type="button" role="tab" class="${TS.tab === k ? 'is-on' : ''}" onclick="tsSetTab('${k}')">${l}${n ? `<b>${n}</b>` : ''}</button>`).join('')}</div>`;
  let actions = '';
  if (s) {
    const [tone, label] = TS_STATUS[s.status];
    const btns = [];
    if (s.can_submit) btns.push(`<button type="button" class="ts-btn accent" onclick="tsSubmitMonth()">${tsi('send')}Invia al responsabile</button>`);
    if (!review && s.status === 'inviato') btns.push(`<button type="button" class="ts-btn secondary" onclick="tsWithdrawMonth()">${tsi('undo')}Riapri</button>`);
    if (s.can_approve) btns.push(`<button type="button" class="ts-btn primary" onclick="tsMonthAction('approve')">${tsi('check')}Approva il mese</button>`, `<button type="button" class="ts-btn secondary" onclick="tsReturnMonth()">Rimanda indietro</button>`);
    if (s.can_adjust) btns.push(`<button type="button" class="ts-btn secondary" onclick="openTsAdjustModal()">Rettifica</button>`);
    actions = `<div class="ts-head-actions">
      <div class="ts-month"><button type="button" class="ts-icbtn" onclick="tsMoveMonth(-1)" aria-label="Mese precedente">${tsi('chevron-left', 18)}</button>
        <span>${esc(UI.monthLabel(s.period))}</span><button type="button" class="ts-icbtn" onclick="tsMoveMonth(1)" aria-label="Mese successivo">${tsi('chevron-right', 18)}</button></div>
      <span class="ts-badge ${tone}">${label}</span>${btns.join('')}</div>`;
  }
  return `<section class="ts-card ts-head">
    <div class="ts-head-top">
      <div class="ts-who">${review ? `<button type="button" class="ts-icbtn" onclick="TS.reviewId = null; loadHrPresenze()" aria-label="Torna a Presenze">${tsi('chevron-left', 18)}</button>` : ''}
        <span class="ts-avatar">${esc(tsInitials(who.name))}</span><div><h1>${esc(who.name)}</h1><div class="ts-sub">${review ? 'Presenze · sola lettura' : 'Timesheet'}</div></div></div>
      ${actions}
    </div>
    ${tabs}
    ${s ? tsStats(s) : '<div style="height:1px"></div>'}
  </section>`;
}
function tsMoveMonth(n) { TS.period = tsShiftMonth(TS.period, n); TS.openDays = new Set(); TS.onlyMissing = false; loadTsSheet(); }

// ── Le mie ore (e, in sola lettura, il foglio di un collaboratore in Presenze) ─
const tsLive = d => d.entries.filter(x => !x.voided_by_adjustment_id);
function tsStats(s) {
  const today = tsToday();
  const past = s.days.filter(d => d.date <= today);
  const exp = past.reduce((t, d) => t + d.scheduled, 0);
  const work = past.reduce((t, d) => t + d.worked + d.absent, 0);
  const abs = s.days.reduce((t, d) => t + d.absent, 0);
  const missing = s.days.filter(d => d.flag === 'mancano');
  const diff = work - exp;
  return `<div class="ts-stats">
    <div class="ts-stat"><span>Ore previste</span><b>${tsH(exp)}</b><small>fino a oggi</small></div>
    <div class="ts-stat"><span>Ore registrate</span><b>${tsH(work)}</b><small>di cui ${tsH(abs)} assenze${s.totals.straordinaria || s.totals.overtime_pending ? ` · straord. ${tsH(s.totals.straordinaria)}${s.totals.overtime_pending ? ` (+${tsH(s.totals.overtime_pending)} da approvare)` : ''}` : ''}</small></div>
    <div class="ts-stat"><span>Differenza</span><b class="${diff < 0 ? 'ts-neg' : diff > 0 ? 'ts-pos' : ''}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${tsH(Math.abs(diff))}</b><small>${diff < 0 ? 'ore mancanti' : 'in pari'}</small></div>
    <button type="button" class="ts-stat is-btn ${TS.onlyMissing ? 'is-on' : ''}" onclick="TS.onlyMissing = !TS.onlyMissing; tsRenderSheet()" ${missing.length ? '' : 'disabled'}>
      <span>Da completare</span><b class="${missing.length ? 'ts-neg' : ''}">${missing.length} ${missing.length === 1 ? 'giorno' : 'giorni'}</b><small>${missing.length ? (TS.onlyMissing ? 'Mostra tutti' : 'Mostra solo questi') : 'Tutto compilato'}</small></button>
  </div>`;
}
async function loadTsSheet() {
  if (!TS.options) await tsOptions();
  const review = TS.mode === 'review';
  TS.sheet = await api(`/api/admin/hr/timesheet/month?employee_id=${review ? TS.reviewId : TS.employeeId}&period=${TS.period}`);
  tsRenderSheet();
}
function tsRenderSheet() {
  if (TS.mode === 'review' && !document.getElementById('people-presenze-root')) return tsRenderTeamPresenze();
  const s = TS.sheet, review = TS.mode === 'review', locked = !s.can_edit;
  const today = tsToday();
  const shown = TS.onlyMissing ? s.days.filter(d => d.flag === 'mancano') : s.days;
  const weeks = [];
  for (const d of shown) { const w = tsIsoWeek(d.date); let g = weeks.at(-1); if (!g || g.w !== w) { g = { w, days: [] }; weeks.push(g); } g.days.push(d); }
  const notices = [];
  if (review) notices.push(`<div class="ts-notice info">${tsi('info')}<span>Sola lettura: le ore le inserisce ${esc(s.employee.name)} nel suo Timesheet.</span></div>`);
  if (s.status === 'inviato' && !review) notices.push(`<div class="ts-notice info">${tsi('info')}<span>Il mese è inviato al responsabile: il foglio è in sola lettura. Se devi correggere qualcosa, usa «Riapri».</span></div>`);
  if (s.totals.overtime_pending) notices.push(`<div class="ts-notice warn">${tsi('clock')}<span><b>${tsH(s.totals.overtime_pending)} di straordinario da approvare.</b> ${review ? 'Si decidono in Richieste del team → Straordinari.' : 'Il responsabile le deve approvare: fino ad allora non contano.'}</span></div>`);
  if (s.totals.overtime_rejected) notices.push(`<div class="ts-notice bad">${tsi('alert')}<span><b>${tsH(s.totals.overtime_rejected)} di straordinario non approvate.</b> Sono barrate nei giorni: correggile o eliminale.</span></div>`);
  if (s.month?.return_note && s.status === 'aperto') notices.push(`<div class="ts-notice warn">${tsi('message')}<span>Rimandato indietro: ${esc(s.month.return_note)}</span></div>`);
  if (s.conflicts.length) notices.push(`<div class="ts-notice bad">${tsi('alert')}<div class="ts-grow"><b>Conflitti tra ore e assenze</b>${s.conflicts.map(c => `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>${esc(c.message)}</span>
    ${s.can_edit || s.can_approve ? `<button type="button" class="ts-btn secondary sm" onclick="tsResolveConflict(${c.id})">Risolto</button>` : ''}</div>`).join('')}</div></div>`);
  if (s.proposals.length) notices.push(`<section class="ts-card" style="padding:16px 20px"><div class="ts-eyebrow" style="margin-bottom:6px">Proposte da confermare</div><div class="ts-proplist">
    ${s.proposals.map((p, i) => `<div class="ts-prop"><div class="ts-grow"><b>${esc(UI.date(p.work_date))} · ${p.start_time}–${p.end_time}</b> · ${esc(p.label)}<div class="ts-muted" style="font-size:13px">${esc([p.cost_center, p.cost_object].filter(Boolean).join(' · ') || 'Centro da scegliere')}</div></div>
      <button type="button" class="ts-btn primary sm" onclick="tsProposal(${i}, 'accept')">${tsi('check', 14)}Conferma</button><button type="button" class="ts-btn secondary sm" onclick="tsProposal(${i}, 'dismiss')">Scarta</button></div>`).join('')}
    </div><p class="ts-muted" style="font-size:12px;margin:8px 0 0">Vengono dalle visite assegnate, dalle fiere di cui sei responsabile e dagli interventi in vigneto: diventano ore solo se le confermi.</p></section>`);
  tsRoot().innerHTML = `<div class="ts-page">
    ${tsHead({ s, review })}
    ${notices.join('')}
    <div class="ts-layout">
      <section class="ts-card ts-table">
        <div class="ts-tools"><div class="rq-seg sm">${[[true, 'Sintetica', 'rows'], [false, 'Dettagliata', 'list']].map(([v, l, ic]) => `<button type="button" class="${TS.compact === v ? 'is-on' : ''}" onclick="TS.compact = ${v}; TS.openDays = new Set(); tsRenderSheet()">${tsi(ic, 14)}${l}</button>`).join('')}</div>
          <div class="ts-tools-r"><button type="button" class="ts-linkbtn" onclick="TS.openDays = new Set(TS.sheet.days.filter(d => tsLive(d).length).map(d => d.date)); tsRenderSheet()">${tsi('expand', 14)}Espandi tutti</button>
          ${TS.openDays.size ? `<button type="button" class="ts-linkbtn" onclick="TS.openDays = new Set(); tsRenderSheet()">${tsi('collapse', 14)}Chiudi tutti</button>` : ''}</div></div>
        <div class="ts-thead"><span>Giorno</span><span>Attività e centri di costo</span><span>Ore</span><span>Diff.</span><span></span></div>
        ${weeks.map(w => {
          const wexp = w.days.filter(d => d.date <= today).reduce((t, d) => t + d.scheduled, 0), wwork = w.days.reduce((t, d) => t + d.worked + d.absent, 0);
          const d0 = tsDate(w.days[0].date), d1 = tsDate(w.days.at(-1).date);
          return `<div><div class="ts-week"><span>Settimana ${w.w} · ${d0.getDate()}–${d1.getDate()} ${TS_MN[d1.getMonth()]}</span><span>${tsH(wwork)}${wexp ? ` / ${tsH(wexp)}` : ''}</span></div>
            ${w.days.map(d => tsDayRow(d, locked, today)).join('')}</div>`;
        }).join('')}
        ${shown.length ? '' : '<div class="ts-muted" style="padding:32px;text-align:center">Nessun giorno da completare.</div>'}
      </section>
      ${tsCenterSummary(s)}
    </div>
    ${s.adjustments.length ? `<section class="ts-card" style="padding:16px 20px"><div class="ts-eyebrow" style="margin-bottom:6px">Rettifiche</div>${s.adjustments.map(a => `<div class="ts-prop"><div class="ts-grow"><b>${esc(a.reason)}</b><div class="ts-muted" style="font-size:13px">${new Date(a.created_at).toLocaleString('it-IT')} · ${esc(a.created_by || '')}</div></div></div>`).join('')}</section>` : ''}
  </div>`;
}
function tsChip(x) {
  const voided = x.voided_by_adjustment_id || x.overtime_status === 'rifiutato' ? ' is-void' : '';
  if (x.origin === 'assenza') return `<span class="ts-chip is-abs${voided}">${tsi('plane', 13)}${esc(x.absence_type)} · ${tsH(x.minutes)}</span>`;
  const a = x.allocations[0], c = a && TS.centers[a.cost_center_id];
  const where = x.allocations.length > 1 ? `${x.allocations.length} centri` : `${c ? c.name : a ? `${a.center_code} ${a.center_name}` : 'Senza centro'}${a?.object_name ? ` · ${a.object_name}` : ''}`;
  return `<span class="ts-chip${voided}"><i style="background:${c ? c.group_color : 'var(--mw-grigio-300)'}"></i><b>${x.start_time.replace(':00', '')}–${x.end_time.replace(':00', '')}</b><span>${esc(where)}</span>${x.overtime_status === 'da_approvare' ? '<em class="ts-ot-wait">Straord. da approvare</em>' : x.overtime_status === 'rifiutato' ? '<em class="ts-ot-ko">Straord. rifiutato</em>' : x.hour_type !== 'ordinaria' ? `<em>${esc(TS.options.hour_types[x.hour_type].slice(0, 7))}.</em>` : ''}</span>`;
}
function tsSummary(list) {
  const names = [...new Set(list.map(x => x.origin === 'assenza' ? x.absence_type : (TS.centers[x.allocations[0]?.cost_center_id]?.name || x.allocations[0]?.center_name || 'Senza centro')))];
  return `<div class="ts-sum"><span class="ts-sumbar">${list.map(x => `<span style="flex:${x.minutes};background:${x.origin === 'assenza' ? 'var(--mw-warning-600)' : TS.centers[x.allocations[0]?.cost_center_id]?.group_color || 'var(--mw-grigio-300)'}"></span>`).join('')}</span>
    <span class="ts-sumtxt">${list.length} ${list.length === 1 ? 'fascia' : 'fasce'} · ${esc(names.join(', '))}</span></div>`;
}
function tsDiff(d, today) {
  if (d.date > today) return '<span class="ts-muted">—</span>';
  const worked = d.worked + d.absent, diff = worked - d.scheduled;
  if (!d.scheduled && !worked) return '<span class="ts-muted">—</span>';
  if (diff === 0) return `<span class="ts-ok">${tsi('check')}</span>`;
  return `<span class="${diff < 0 ? 'ts-neg' : 'ts-pos'}">${diff > 0 ? '+' : '−'}${tsH(Math.abs(diff))}</span>`;
}
function tsDayRow(d, locked, today) {
  const list = d.entries, live = tsLive(d), has = list.length > 0;
  const rest = !d.scheduled, future = d.date > today, isToday = d.date === today, missing = d.flag === 'mancano', open = TS.openDays.has(d.date);
  const dt = tsDate(d.date);
  const click = has ? `tsToggleDay('${d.date}')` : locked ? '' : `tsOpenDay('${d.date}')`;
  return `<div class="ts-row${rest ? ' is-weekend' : ''}${future ? ' is-future' : ''}${isToday ? ' is-today' : ''}${missing ? ' is-missing' : ''}${open ? ' is-open' : ''}${!has && locked ? ' is-locked' : ''}" ${click ? `onclick="${click}"` : ''}>
    <div class="ts-day"><span class="ts-caret${open ? ' is-open' : ''}">${has ? tsi('chevron-right') : ''}</span><span class="ts-dn">${TS_DN[dt.getDay()]}</span><span class="ts-dd">${dt.getDate()}</span>${isToday ? '<span class="ts-todaytag">Oggi</span>' : ''}</div>
    <div class="ts-acts">${has ? (TS.compact && !open ? tsSummary(live.length ? live : list) : list.map(tsChip).join('')) : `<span class="ts-muted">${d.holiday ? esc(d.holiday) : rest ? 'Riposo' : future ? '' : 'Nessuna ora inserita'}</span>`}</div>
    <div class="ts-hours">${d.scheduled || d.worked || d.absent ? `<span class="ts-hnum"><b>${tsH(d.worked + d.absent)}</b>${d.scheduled ? `<span> / ${tsH(d.scheduled)}</span>` : ''}</span>${d.scheduled ? `<span class="ts-bar"><span style="width:${Math.min(100, (d.worked + d.absent) / d.scheduled * 100)}%"></span></span>` : ''}` : '<span class="ts-muted">—</span>'}</div>
    <div class="ts-diff">${tsDiff(d, today)}</div>
    <div class="ts-rowact" onclick="event.stopPropagation()">
      ${!locked && missing && !live.some(x => x.origin !== 'assenza') && tsPrevFilled(d.date) ? `<button type="button" class="ts-linkbtn" onclick="tsCopyTo('${d.date}')" title="Copia le ore dell'ultimo giorno compilato">${tsi('copy', 14)}Copia</button>` : ''}
      ${locked ? '' : `<button type="button" class="ts-btn sm ${missing ? 'accent' : 'secondary'}" onclick="tsOpenDay('${d.date}')">${tsi(live.some(x => x.origin !== 'assenza') ? 'pencil' : 'plus', 14)}${live.some(x => x.origin !== 'assenza') ? 'Modifica' : 'Ore'}</button>`}
    </div>
  </div>${open && has ? tsDetail(d, locked) : ''}`;
}
function tsDetail(d, locked) {
  return `<div class="ts-detail" onclick="event.stopPropagation()">
    <div class="ts-dt ts-dt-h"><span>Orario</span><span>Tipo</span><span>Centro di costo</span><span>Attività / lotto</span><span>Nota</span><span>Ore</span></div>
    ${d.entries.map(x => {
      const style = x.voided_by_adjustment_id ? ' style="text-decoration:line-through;opacity:.5"' : '';
      if (x.origin === 'assenza') return `<div class="ts-dt"${style}><span class="ts-dt-time">${x.start_time ? `${x.start_time}–${x.end_time}` : 'Giornata'}</span><span><span class="ts-abstag">${esc(x.absence_type)}</span></span><span class="ts-muted">—</span><span class="ts-muted">—</span><span class="ts-dt-note ts-muted">da richiesta approvata</span><b>${tsH(x.minutes)}</b></div>`;
      return x.allocations.map((a, i) => { const c = TS.centers[a.cost_center_id];
        return `<div class="ts-dt"${style}><span class="ts-dt-time">${i ? '' : `${x.start_time}–${x.end_time}`}</span><span>${esc(TS.options.hour_types[x.hour_type])}${x.overtime_status === 'da_approvare' ? ' <span class="ts-origin" style="color:var(--mw-warning-600)">da approvare</span>' : x.overtime_status === 'rifiutato' ? ` <span class="ts-origin" style="color:var(--mw-danger-600)" title="${UI.attr(x.overtime_note || '')}">rifiutato</span>` : ''}${TS_ORIGIN[x.origin] ? ` <span class="ts-origin">${TS_ORIGIN[x.origin]}</span>` : ''}</span>
          <span class="ts-dt-cc"><i style="background:${c?.group_color || 'var(--mw-grigio-300)'}"></i><span>${esc(`${a.center_code} ${a.center_name}`)}<small>${esc(c?.group_name || '')}</small></span></span>
          <span>${a.object_name ? esc(`${a.object_code} ${a.object_name}`) : '<span class="ts-muted">—</span>'}</span><span class="ts-dt-note">${x.note && !i ? esc(x.note) : '<span class="ts-muted">—</span>'}</span><b>${tsH(a.minutes)}</b></div>`; }).join('');
    }).join('')}
    ${locked ? '' : `<button type="button" class="ts-linkbtn" onclick="tsOpenDay('${d.date}')">${tsi('pencil', 14)}Modifica le ore di questo giorno</button>`}
  </div>`;
}
function tsToggleDay(date) { TS.openDays.has(date) ? TS.openDays.delete(date) : TS.openDays.add(date); tsRenderSheet(); }
function tsCenterSummary(s) {
  const by = new Map(); let tot = 0;
  for (const d of s.days) for (const x of tsLive(d)) if (x.origin !== 'assenza') for (const a of x.allocations) { by.set(a.cost_center_id, (by.get(a.cost_center_id) || 0) + a.minutes); tot += a.minutes; }
  const groups = new Map();
  for (const [id, m] of by) { const c = TS.centers[id]; const k = c?.group_id ?? 'x'; const g = groups.get(k) || { name: c?.group_name || 'Altri', color: c?.group_color || 'var(--mw-grigio-300)', m: 0 }; g.m += m; groups.set(k, g); }
  const rows = [...by].sort((a, b) => b[1] - a[1]);
  const label = id => { const c = TS.centers[id]; if (c) return `${c.code} ${c.name}`; const a = s.days.flatMap(d => d.entries).flatMap(x => x.allocations || []).find(x => x.cost_center_id === id); return a ? `${a.center_code} ${a.center_name}` : '—'; };
  return `<section class="ts-card ts-side">
    <div class="ts-eyebrow">Ore per centro di costo</div>
    <div class="ts-seg">${[...groups.values()].map(g => `<span style="flex:${g.m};background:${g.color}" title="${UI.attr(`${g.name} · ${tsH(g.m)}`)}"></span>`).join('')}</div>
    <div class="ts-legend">${[...groups.values()].map(g => `<span><i style="background:${g.color}"></i>${esc(g.name)}<b>${Math.round(g.m / tot * 100)}%</b></span>`).join('')}</div>
    ${rows.length ? `<div class="ts-cclist">${rows.map(([id, m]) => `<div class="ts-ccrow"><i style="background:${TS.centers[id]?.group_color || 'var(--mw-grigio-300)'}"></i><span>${esc(label(id))}</span><b>${tsH(m)}</b></div>`).join('')}</div>`
      : '<div class="ts-muted" style="font-size:13px">Nessuna ora imputata questo mese.</div>'}
    <div class="ts-muted" style="font-size:12px">Le assenze non si imputano ai centri di costo.</div>
  </section>`;
}

// Invio, riapertura, decisioni sul mese
function tsSubmitMonth() {
  const missing = TS.sheet.days.filter(d => d.flag === 'mancano');
  const send = async () => { try { await api('/api/admin/hr/timesheet/months/submit', { method: 'POST', body: JSON.stringify({ period: TS.sheet.period }) }); tsToast('Timesheet inviato', 'Il responsabile riceverà una notifica.'); loadTsSheet(); } catch (e) { alert(e.message); } };
  if (!missing.length) return send();
  tsDialog({ title: 'Inviare con giorni incompleti?', text: `${missing.length} ${missing.length === 1 ? 'giorno ha' : 'giorni hanno'} meno ore del previsto: ${missing.map(d => Number(d.date.slice(8))).join(', ')} ${TS_MN[Number(TS.sheet.period.slice(5)) - 1]}.`,
    buttons: [{ label: 'Completa prima', onClick: () => { TS.onlyMissing = true; tsRenderSheet(); } }, { label: 'Invia comunque', variant: 'accent', onClick: send }] });
}
async function tsWithdrawMonth() {
  try { await api('/api/admin/hr/timesheet/months/withdraw', { method: 'POST', body: JSON.stringify({ period: TS.sheet.period }) }); tsToast('Timesheet riaperto', 'Correggi e invialo di nuovo quando è completo.'); loadTsSheet(); } catch (e) { alert(e.message); }
}
async function tsMonthAction(action) {
  try {
    await api(`/api/admin/hr/timesheet/months/${action}`, { method: 'POST', body: JSON.stringify({ employee_id: TS.sheet.employee.id, period: TS.sheet.period }) });
    if (action === 'approve') tsToast('Mese approvato', `${TS.sheet.employee.name} · ${UI.monthLabel(TS.sheet.period)}`);
    loadTsSheet();
  } catch (e) { alert(e.message); }
}
function tsReturnMonth() {
  UI.modal({ id: 'ts-return-modal', title: 'Rimanda indietro il mese', width: 460, saveLabel: 'Rimanda', body: '<div class="field"><label>Cosa va corretto</label><textarea name="note" rows="3"></textarea></div>',
    onSave: async b => { await api('/api/admin/hr/timesheet/months/return', { method: 'POST', body: JSON.stringify({ employee_id: TS.sheet.employee.id, period: TS.sheet.period, note: UI.val(b, 'note') }) }); loadTsSheet(); } });
}
async function tsResolveConflict(id) {
  try { await api(`/api/admin/hr/timesheet/conflicts/${id}/resolve`, { method: 'POST', body: JSON.stringify({}) }); loadTsSheet(); } catch (e) { alert(e.message); }
}
async function tsProposal(i, action) {
  const p = TS.sheet.proposals[i];
  try {
    const res = await api(`/api/admin/hr/timesheet/proposals/${action}`, { method: 'POST', body: JSON.stringify({ source: p.source, source_id: p.source_id, work_date: p.work_date }) });
    tsWarn(res);
    loadTsSheet();
  } catch (e) { alert(e.message); }
}

// ── Editor del giorno (pannello laterale) ──────────────────────────────────────
let TSE = null; // { date, slots, tried }
let tsSlotSeq = 0;
const tsWorkRows = d => tsLive(d).filter(x => x.origin !== 'assenza');
const tsSlotFrom = x => (x.allocations.length > 1
  ? { key: ++tsSlotSeq, id: x.id, fixed: true, start_time: x.start_time, end_time: x.end_time, hour_type: x.hour_type, cost_center_id: '', cost_object_id: '', note: x.note || '', label: x.allocations.map(a => `${a.center_code} ${tsH(a.minutes)}`).join(', ') }
  : { key: ++tsSlotSeq, id: x.id, start_time: x.start_time, end_time: x.end_time, hour_type: x.hour_type, cost_center_id: String(x.allocations[0]?.cost_center_id || ''), cost_object_id: String(x.allocations[0]?.cost_object_id || ''), note: x.note || '' });
function tsPrevFilled(date) {
  for (let i = 1; i < 14; i++) { const d = TS.sheet.days.find(x => x.date === tsAddDays(date, -i)); if (d && tsWorkRows(d).length && !tsWorkRows(d).some(x => x.allocations.length > 1)) return d; }
  return null;
}
function tsTimes() {
  const g = TS.options.granularity || 60, out = [];
  for (let m = 5 * 60; m <= 22 * 60; m += g) out.push(tsFromMin(m));
  for (const s of TSE?.slots || []) for (const t of [s.start_time, s.end_time]) if (t && !out.includes(t)) out.push(t);
  return out.sort();
}
function tsOpenDay(date) {
  const d = TS.sheet.days.find(x => x.date === date);
  if (!d || !TS.sheet.can_edit) return;
  const rows = tsWorkRows(d);
  const first = tsDaySlots(date)[0];
  TSE = { date, tried: false, slots: rows.length ? rows.map(tsSlotFrom) : [{ key: ++tsSlotSeq, start_time: first.start, end_time: first.end, hour_type: 'ordinaria', cost_center_id: String(TS.sheet.recent[0]?.cost_center_id || TS.sheet.employee.cost_center_id || ''), cost_object_id: String(TS.sheet.recent[0]?.cost_object_id || ''), note: '' }] };
  tsRenderEditor();
}
function tsCloseEditor() { TSE = null; document.querySelector('.ts-veil')?.remove(); document.removeEventListener('keydown', tsEditorKeys); }
function tsEditorKeys(ev) { if (ev.key === 'Escape' && TSE) tsCloseEditor(); }
function tsValidate(slots) {
  const errs = {};
  slots.forEach((s, i) => {
    if (tsToMin(s.end_time) <= tsToMin(s.start_time)) errs[s.key] = "L'orario di fine deve essere dopo l'inizio.";
    else if (!s.fixed && !s.cost_center_id) errs[s.key] = 'Scegli un centro di costo.';
    else slots.forEach((o, j) => { if (j !== i && tsToMin(s.start_time) < tsToMin(o.end_time) && tsToMin(o.start_time) < tsToMin(s.end_time)) errs[s.key] = `Si sovrappone alla fascia ${j + 1}.`; });
  });
  return errs;
}
function tsCenterSelect(s, invalid) {
  const groups = [];
  for (const c of TS.options.centers) { let g = groups.find(x => x.id === c.group_id); if (!g) groups.push(g = { id: c.group_id, name: c.group_name, list: [] }); g.list.push(c); }
  return `<select class="ts-select${invalid ? ' is-invalid' : ''}" onchange="tsSlotSet(${s.key}, { cost_center_id: this.value })"><option value="">Scegli centro di costo…</option>
    ${groups.map(g => `<optgroup label="${UI.attr(g.name)}">${g.list.map(c => `<option value="${c.id}" ${String(c.id) === s.cost_center_id ? 'selected' : ''}>${esc(`${c.code} ${c.name}`)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
function tsObjectSelect(s) {
  const types = [...new Set(TS.options.objects.map(o => o.type))];
  return `<select class="ts-select" ${s.cost_center_id ? '' : 'disabled'} onchange="tsSlotSet(${s.key}, { cost_object_id: this.value })"><option value="">${s.cost_center_id ? 'Nessuna' : 'Prima scegli il centro'}</option>
    ${types.map(t => `<optgroup label="${UI.attr(t)}">${TS.options.objects.filter(o => o.type === t).map(o => `<option value="${o.id}" ${String(o.id) === s.cost_object_id ? 'selected' : ''}>${esc(`${o.code} ${o.name}`)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
function tsSlotHtml(s, i, err) {
  const times = tsTimes();
  const dur = Math.max(0, tsToMin(s.end_time) - tsToMin(s.start_time));
  const del = TSE.slots.length > 1 || s.id ? `<button type="button" class="ts-icbtn" onclick="tsSlotRemove(${s.key})" aria-label="Elimina fascia" title="Elimina fascia">${tsi('trash')}</button>` : '';
  if (s.fixed) return `<div class="ts-slot is-fixed"><div class="ts-slot-head"><span class="ts-slot-n">${i + 1}</span><div class="ts-time"><b>${s.start_time} → ${s.end_time}</b><span class="ts-dur">${tsH(dur)}</span></div>${del}</div>
    <div class="ts-absnote">${tsi('info', 14)}Ripartita su più centri (${esc(s.label)}): resta com'è. Per cambiarla, eliminala e inserisci una fascia per centro.</div></div>`;
  const recents = TS.sheet.recent.filter(r => TS.centers[r.cost_center_id]);
  return `<div class="ts-slot${err ? ' has-err' : ''}">
    <div class="ts-slot-head"><span class="ts-slot-n">${i + 1}</span>
      <div class="ts-time"><select class="ts-select sm" aria-label="Dalle" onchange="tsSlotSet(${s.key}, { start_time: this.value })">${times.map(t => `<option ${t === s.start_time ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <span class="ts-muted">→</span><select class="ts-select sm" aria-label="Alle" onchange="tsSlotSet(${s.key}, { end_time: this.value })">${times.map(t => `<option ${t === s.end_time ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <span class="ts-dur">${tsH(dur)}</span></div>
      <select class="ts-select sm ts-type" aria-label="Tipo d'ora" onchange="tsSlotSet(${s.key}, { hour_type: this.value })">${Object.entries(TS.options.hour_types).map(([k, l]) => `<option value="${k}" ${k === s.hour_type ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      ${del}</div>
    ${recents.length ? `<div class="ts-recents"><span>Recenti</span>${recents.map(r => { const c = TS.centers[r.cost_center_id], o = TS.options.objects.find(x => x.id === r.cost_object_id);
      return `<button type="button" class="ts-recent${String(r.cost_center_id) === s.cost_center_id && String(r.cost_object_id || '') === s.cost_object_id ? ' is-on' : ''}" onclick="tsSlotSet(${s.key}, { cost_center_id: '${r.cost_center_id}', cost_object_id: '${r.cost_object_id || ''}' })"><i style="background:${c.group_color}"></i>${esc(c.name)}${o ? ` · ${esc(o.name)}` : ''}</button>`; }).join('')}</div>` : ''}
    <div class="ts-ccgrid"><label class="ts-field"><span>Centro di costo <b>*</b></span>${tsCenterSelect(s, err && !s.cost_center_id)}</label>
      <label class="ts-field"><span>Attività / lotto</span>${tsObjectSelect(s)}</label></div>
    ${s.showNote || s.note ? `<input class="ts-input" placeholder="Nota (facoltativa)" value="${UI.attr(s.note)}" oninput="tsSlotSet(${s.key}, { note: this.value }, false)">` : `<button type="button" class="ts-linkbtn" onclick="tsSlotSet(${s.key}, { showNote: true })">${tsi('plus', 14)}Aggiungi nota</button>`}
    ${tsCoveredBreaks(s, TSE.date).map(b => `<div class="ts-absnote">${tsi('info', 14)}<span>Copre la pausa ${b.start}–${b.end}: al salvataggio la tolgo e divido la fascia.
      <label style="display:inline-flex;gap:6px;align-items:center;margin-left:6px"><input type="checkbox" ${s.keepBreak ? 'checked' : ''} onchange="tsSlotSet(${s.key}, { keepBreak: this.checked })"> ho lavorato anche in pausa</label></span></div>`).join('')}
    ${s.hour_type === 'straordinaria' ? `<div class="ts-absnote">${tsi('clock', 14)}Lo straordinario va approvato dal responsabile: fino ad allora non conta.</div>` : ''}
    ${err ? `<div class="ts-err">${tsi('alert', 14)}${esc(err)}</div>` : ''}
  </div>`;
}
function tsRenderEditor() {
  const d = TS.sheet.days.find(x => x.date === TSE.date);
  const dt = tsDate(TSE.date);
  const errs = tsValidate(TSE.slots);
  const tot = TSE.slots.reduce((t, s) => t + Math.max(0, tsToMin(s.end_time) - tsToMin(s.start_time)), 0) + d.absent;
  const prev = tsPrevFilled(TSE.date);
  const absences = tsLive(d).filter(x => x.origin === 'assenza');
  const html = `<div class="ts-veil" onmousedown="if (event.target === this) tsCloseEditor()"><aside class="ts-drawer" role="dialog" aria-label="Ore del giorno">
    <header class="ts-dhead"><div><div class="ts-eyebrow">Ore del giorno</div><h2>${TS_DNF[dt.getDay()]} ${dt.getDate()} ${TS_MN[dt.getMonth()]}</h2>${d.holiday ? `<div class="ts-muted" style="font-size:13px">${esc(d.holiday)}</div>` : ''}</div>
      <div class="ts-dnav"><button type="button" class="ts-icbtn" onclick="tsEditorNav(-1)" aria-label="Giorno precedente">${tsi('chevron-left', 18)}</button>
        <button type="button" class="ts-icbtn" onclick="tsEditorNav(1)" aria-label="Giorno successivo">${tsi('chevron-right', 18)}</button>
        <button type="button" class="ts-icbtn" onclick="tsCloseEditor()" aria-label="Chiudi">${tsi('x', 18)}</button></div></header>
    <div class="ts-quick">
      <button type="button" class="ts-qbtn" onclick="tsStandardDay()">${tsi('sun', 15)}Giornata tipo<small>${tsDaySlots(TSE.date).map(x => `${x.start.replace(':00', '')}–${x.end.replace(':00', '')}`).join(' · ')}${d.slots_standard ? '' : ' (proposta)'}</small></button>
      <button type="button" class="ts-qbtn" onclick="tsCopyPrevIntoEditor()" ${prev ? '' : 'disabled'}>${tsi('copy', 15)}Copia ultimo giorno<small>${prev ? `${TS_DN[tsDate(prev.date).getDay()]} ${Number(prev.date.slice(8))} · ${tsH(tsWorkRows(prev).reduce((t, x) => t + x.minutes, 0))}` : 'nessuno'}</small></button>
    </div>
    <div class="ts-dbody">
      ${absences.map(x => `<div class="ts-absnote">${tsi('plane', 14)}${esc(x.absence_type)} · ${tsH(x.minutes)}${x.start_time ? ` (${x.start_time}–${x.end_time})` : ''}: da una richiesta approvata, non si modifica qui.</div>`).join('')}
      ${TSE.slots.map((s, i) => tsSlotHtml(s, i, TSE.tried ? errs[s.key] : null)).join('')}
      <button type="button" class="ts-add" onclick="tsSlotAdd()">${tsi('plus')}Aggiungi fascia oraria<small>per un altro centro di costo o attività</small></button>
      <div class="ts-muted" style="font-size:12px;display:flex;gap:6px;align-items:center">${tsi('info', 14)}<span>Ferie, permesso o malattia? Non si inseriscono qui: <button type="button" class="ts-linkbtn" style="padding:0" onclick="tsCloseEditor(); tsSetTab('ferie')">chiedili in «Ferie e permessi»</button>.</span></div>
    </div>
    <footer class="ts-dfoot">
      <div class="ts-total"><div class="ts-total-row"><span>Totale giorno</span><b class="${d.scheduled && tot < d.scheduled ? 'ts-neg' : ''}">${tsH(tot)}${d.scheduled ? `<span class="ts-muted"> di ${tsH(d.scheduled)}</span>` : ''}</b></div>
        ${d.scheduled ? `<span class="ts-bar lg"><span style="width:${Math.min(100, tot / d.scheduled * 100)}%"></span></span>` : ''}</div>
      <div id="ts-editor-msg"></div>
      <div class="ts-dbtns"><button type="button" class="ts-btn ghost" onclick="tsCloseEditor()">Annulla</button>
        <button type="button" class="ts-btn secondary" onclick="tsSaveDay(false)">Salva</button>
        <button type="button" class="ts-btn accent" onclick="tsSaveDay(true)">Salva e avanti${tsi('arrow-right')}</button></div>
    </footer></aside></div>`;
  const old = document.querySelector('.ts-veil');
  const scroll = old?.querySelector('.ts-dbody')?.scrollTop || 0;
  if (old) old.outerHTML = html; else { document.body.insertAdjacentHTML('beforeend', html); document.addEventListener('keydown', tsEditorKeys); }
  const body = document.querySelector('.ts-veil .ts-dbody');
  if (body) body.scrollTop = scroll;
}
function tsSlotSet(key, patch, rerender = true) {
  const s = TSE.slots.find(x => x.key === key);
  Object.assign(s, patch);
  if (patch.cost_center_id !== undefined && !patch.cost_object_id && patch.cost_center_id === '') s.cost_object_id = '';
  if (rerender) tsRenderEditor();
}
function tsSlotRemove(key) { TSE.slots = TSE.slots.filter(x => x.key !== key); tsRenderEditor(); }
function tsSlotAdd() {
  const last = TSE.slots.at(-1), times = tsTimes();
  const from = last ? last.end_time : '08:00';
  const to = times[Math.min(times.length - 1, times.indexOf(from) + Math.round(240 / (TS.options.granularity || 60)))] || from;
  TSE.slots.push({ key: ++tsSlotSeq, start_time: from, end_time: to, hour_type: 'ordinaria', cost_center_id: last?.cost_center_id || '', cost_object_id: last?.cost_object_id || '', note: '' });
  tsRenderEditor();
}
// Le fasce dell'orario di quel giorno (impostate da HR, o proposte dalle 8 con la pausa alle 12).
const tsDaySlots = date => { const d = TS.sheet.days.find(x => x.date === date); return d?.slots?.length ? d.slots : [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }]; };
// Pause dell'orario: gli spazi tra una fascia e l'altra.
const tsBreaks = date => { const sl = TS.sheet.days.find(x => x.date === date)?.slots || []; return sl.slice(1).map((x, i) => ({ start: sl[i].end, end: x.start })).filter(b => b.start < b.end); };
const tsCoveredBreaks = (s, date) => tsBreaks(date).filter(b => s.start_time <= b.start && b.end <= s.end_time); // la pausa sta per intero dentro la fascia
// Al salvataggio: le fasce che coprono la pausa si dividono (salvo «ho lavorato anche in pausa»).
function tsSplitBreaks(slots, date) {
  const out = [];
  let removed = [];
  for (const s of slots) {
    const cover = s.fixed || s.keepBreak ? [] : tsCoveredBreaks(s, date);
    if (!cover.length) { out.push(s); continue; }
    let from = s.start_time;
    cover.forEach((b, i) => { out.push({ ...s, key: i ? ++tsSlotSeq : s.key, id: i ? null : s.id, start_time: from, end_time: b.start }); from = b.end; removed.push(b); });
    out.push({ ...s, key: ++tsSlotSeq, id: null, start_time: from, end_time: s.end_time });
  }
  return { slots: out, removed };
}
function tsStandardDay() {
  const r = TS.sheet.recent[0] || {};
  const c = String(r.cost_center_id || TS.sheet.employee.cost_center_id || ''), o = String(r.cost_object_id || '');
  // Sostituisce le fasce del giorno (anche quelle già salvate, che al salvataggio si tolgono) con l'orario della persona.
  TSE.slots = tsDaySlots(TSE.date).map(x => ({ key: ++tsSlotSeq, start_time: x.start, end_time: x.end, hour_type: 'ordinaria', cost_center_id: c, cost_object_id: o, note: '' }));
  tsRenderEditor();
}
function tsCopyPrevIntoEditor() {
  const p = tsPrevFilled(TSE.date);
  if (!p) return;
  TSE.slots = tsWorkRows(p).map(x => ({ ...tsSlotFrom(x), id: null }));
  tsRenderEditor();
}
async function tsSaveDay(next) {
  TSE.tried = true;
  const split = tsSplitBreaks(TSE.slots, TSE.date);
  const errs = tsValidate(split.slots);
  if (Object.keys(errs).length) return tsRenderEditor();
  TSE.slots = split.slots;
  const date = TSE.date;
  try {
    const res = await api('/api/admin/hr/timesheet/day', { method: 'PUT', body: JSON.stringify({ work_date: date, slots: TSE.slots.map(s => (s.fixed ? { id: s.id, unchanged: true }
      : { id: s.id || null, start_time: s.start_time, end_time: s.end_time, hour_type: s.hour_type, cost_center_id: s.cost_center_id, cost_object_id: s.cost_object_id || null, note: s.note })) }) });
    const dt = tsDate(date);
    await loadTsSheet();
    const breakMsg = split.removed.length ? ` · pausa ${split.removed.map(b => `${b.start}–${b.end}`).join(', ')} tolta` : '';
    if (res.warnings?.length) tsWarn(res); else tsToast('Ore salvate', `${TS_DNF[dt.getDay()]} ${dt.getDate()}: ${tsH(TSE.slots.reduce((t, s) => t + tsToMin(s.end_time) - tsToMin(s.start_time), 0))}${breakMsg}`);
    if (next) tsEditorNav(1, true); else tsCloseEditor();
  } catch (e) { UI.msg(document.getElementById('ts-editor-msg'), e.message); }
}
function tsEditorNav(dir, afterSave = false) {
  const n = tsAddDays(TSE.date, dir);
  if (!TS.sheet.days.some(d => d.date === n)) { if (afterSave) tsCloseEditor(); return; }
  tsOpenDay(n);
}
async function tsCopyTo(date) {
  const p = tsPrevFilled(date);
  if (!p) return;
  try {
    const res = await api('/api/admin/hr/timesheet/day', { method: 'PUT', body: JSON.stringify({ work_date: date, slots: tsWorkRows(p).map(x => ({ start_time: x.start_time, end_time: x.end_time, hour_type: x.hour_type, cost_center_id: x.allocations[0].cost_center_id, cost_object_id: x.allocations[0].cost_object_id, note: x.note })) }) });
    await loadTsSheet();
    const dt = tsDate(date);
    if (res.warnings?.length) tsWarn(res); else tsToast('Ore copiate', `${TS_DNF[dt.getDay()]} ${dt.getDate()}: ${tsH(tsWorkRows(p).reduce((t, x) => t + x.minutes, 0))}`);
  } catch (e) { alert(e.message); }
}

// ── Ferie e permessi (le proprie richieste, dal modulo Assenze) ─────────────────
const RQ_STATUS = { bozza: ['neutral', 'Bozza'], richiesta: ['warning', 'In attesa'], approvata: ['success', 'Approvata'], rifiutata: ['danger', 'Rifiutata'],
  annullata: ['neutral', 'Annullata'], comunicata: ['warning', 'Comunicata'], presa_visione: ['success', 'Presa visione'] };
// kind = categoria del tipo (ferie, permesso, malattia, congedo); typeId = il motivo scelto dentro la categoria.
const RQ = { kind: 'ferie', typeId: null, form: {}, preview: null, previewTok: 0, teamView: 'pending' };
const RQ_KINDS = [['ferie', 'Ferie', 'plane'], ['permesso', 'Permesso', 'clock'], ['malattia', 'Malattia', 'thermometer'], ['congedo', 'Congedo', 'heart']];
const rqTypesOf = kind => ABS.types.filter(t => t.active && (t.category || 'permesso') === kind);
const rqCat = a => a.category || ABS.types.find(t => t.id === a.absence_type_id || t.code === a.type_code)?.category || (a.type_code === 'ferie' ? 'ferie' : 'permesso');
const rqClass = a => ({ ferie: 't-fer', malattia: 't-mal', congedo: 't-con' }[rqCat(a)] || 't-per');
const rqIcon = a => ({ ferie: 'plane', malattia: 'thermometer', congedo: 'heart' }[rqCat(a)] || 'clock');
const rqShort = s => { const d = tsDate(s); return `${TS_DN[d.getDay()]} ${d.getDate()} ${TS_MN[d.getMonth()].slice(0, 3)}`; };
const rqWhen = a => (a.part === 'ore' ? `${rqShort(a.start_date)} · ${a.start_time}–${a.end_time}` : a.start_date === a.end_date ? rqShort(a.start_date) + (a.part !== 'giorno' ? ` · ${ABS_PARTS[a.part].toLowerCase()}` : '') : `${rqShort(a.start_date)} → ${rqShort(a.end_date)}`);
function rqType() {
  const list = rqTypesOf(RQ.kind);
  return list.find(t => t.id === RQ.typeId) || list[0];
}
async function tsRenderLeave() {
  await absTypes();
  const [bal, mine] = await Promise.all([api('/api/admin/hr/absences/balances').catch(() => null), Promise.resolve(TS.myAbsences || [])]);
  const t = rqType();
  if (!RQ.form.start_date) { const tomorrow = tsAddDays(tsToday(), 1); RQ.form = { start_date: tomorrow, end_date: tomorrow, start_time: '09:00', end_time: '13:00', note: '', protocol: '' }; }
  const f = RQ.form, byHours = t?.unit === 'ore';
  const balances = (bal?.balances || []).filter(b => b.annual || b.opening || b.taken || b.planned || b.counter === 'ferie');
  const list = [...mine].sort((a, b) => (b.submitted_at || b.created_at || '').localeCompare(a.submitted_at || a.created_at || ''));
  const kinds = RQ_KINDS.filter(([k]) => rqTypesOf(k).length);
  const docsByAbsence = new Map((TS.myDocs || []).map(d => [d.absence_id, d]));
  tsRoot().innerHTML = `<div class="ts-page">
    ${tsHead({})}
    <div class="rq-layout">
      <div class="rq-col">
        <div class="rq-balances">${balances.map(b => `<div class="ts-card rq-bal"><span>${esc(ABS_COUNTERS[b.counter])} ${b.counter === 'ferie' ? 'residue' : 'residui'} ${bal.year}</span>
          <b class="${b.available < 0 ? 'ts-neg' : ''}">${absAmount(b.available, b.unit).replace(/ (gg|h)$/, '')} <small>${b.unit === 'giorni' ? 'giorni' : 'ore'}</small></b>
          <small>${absAmount(b.taken, b.unit)} usati${b.planned ? ` · ${absAmount(b.planned, b.unit)} pianificati` : ''}${b.pending ? ` · ${absAmount(b.pending, b.unit)} in attesa` : ''} su ${absAmount((b.opening || 0) + b.annual, b.unit)}</small></div>`).join('') || '<div class="ts-card rq-bal"><span>Saldi</span><small>Nessuna spettanza impostata: chiedi all\'ufficio del personale.</small></div>'}</div>
        ${bal?.arrears?.length ? `<div class="ts-notice warn">${tsi('info')}<span>Ferie arretrate: ${bal.arrears.map(v => `${v.year} — ${absAmount(v.amount, 'giorni')} entro il ${UI.date(v.due_date)}`).join('; ')}.</span></div>` : ''}
        <section class="ts-card rq-new" id="rq-new">
          <div class="ts-eyebrow">Nuova richiesta</div>
          <div class="rq-seg">${kinds.map(([k, l, ic]) => `<button type="button" class="${RQ.kind === k ? 'is-on' : ''}" onclick="RQ.kind = '${k}'; RQ.typeId = null; tsRenderLeave()">${tsi(ic, 15)}${l}</button>`).join('')}</div>
          ${rqTypesOf(RQ.kind).length > 1 ? `<label class="ts-field"><span>Motivo</span><select class="ts-select" onchange="RQ.typeId = Number(this.value); tsRenderLeave()">${rqTypesOf(RQ.kind).map(x => `<option value="${x.id}" ${x.id === t?.id ? 'selected' : ''}>${esc(x.name)}${x.flow === 'comunicazione' ? ' (comunicazione)' : ''}</option>`).join('')}</select></label>` : ''}
          ${!t ? '<div class="ts-err">Tipo di assenza non configurato: chiedi all\'ufficio del personale.</div>' : byHours ? `<div class="rq-grid3">
            <label class="ts-field"><span>Giorno</span><input class="ts-input" type="date" value="${f.start_date}" onchange="rqSet({ start_date: this.value, end_date: this.value })"></label>
            <label class="ts-field"><span>Dalle</span><input class="ts-input" type="time" step="1800" value="${f.start_time}" onchange="rqSet({ start_time: this.value })"></label>
            <label class="ts-field"><span>Alle</span><input class="ts-input" type="time" step="1800" value="${f.end_time}" onchange="rqSet({ end_time: this.value })"></label></div>` : `<div class="rq-grid2">
            <label class="ts-field"><span>Dal</span><input class="ts-input" type="date" value="${f.start_date}" onchange="rqSet({ start_date: this.value, end_date: this.value > RQ.form.end_date ? this.value : RQ.form.end_date }, true)"></label>
            <label class="ts-field"><span>Al</span><input class="ts-input" type="date" value="${f.end_date}" onchange="rqSet({ end_date: this.value })"></label></div>`}
          ${t?.requires_protocol ? `<label class="ts-field"><span>Numero di protocollo del certificato <b>*</b></span><input class="ts-input" value="${UI.attr(f.protocol)}" placeholder="es. 48213977" oninput="RQ.form.protocol = this.value"></label>` : ''}
          <label class="ts-field"><span>Nota per il responsabile <em class="ts-muted" style="font-style:normal;font-weight:400">(facoltativa)</em></span><input class="ts-input" value="${UI.attr(f.note)}" placeholder="es. Viaggio già prenotato" oninput="RQ.form.note = this.value"></label>
          ${t?.doc_required ? `<div class="rq-dochint">${tsi('paperclip', 15)}<div><b>Giustificativo richiesto</b><span>${esc(t.doc_label)}${t.doc_mode === 'protocol' ? '' : `, entro ${t.doc_deadline_days} ${t.doc_deadline_days === 1 ? 'giorno' : 'giorni'} dalla fine dell'assenza`}. ${t.doc_mode === 'protocol' ? 'Il numero lo indichi qui sopra.' : 'Lo carichi in «Giustificativi».'}</span></div></div>` : ''}
          <div id="rq-msg"></div>
          <div class="rq-submit"><div class="rq-amount" id="rq-amount"><b>…</b><span></span></div>
            <button type="button" class="ts-btn accent" onclick="rqSubmit()" ${t ? '' : 'disabled'}>${tsi('send')}${t?.flow === 'comunicazione' ? `Comunica ${esc(t.name.toLowerCase())}` : 'Invia richiesta'}</button></div>
        </section>
      </div>
      <section class="ts-card rq-list">
        <div class="rq-listhead"><div class="ts-eyebrow">Le mie richieste</div></div>
        ${list.map(a => rqRow(a, false, docChip(docsByAbsence.get(a.id)))).join('') || '<div class="ts-muted" style="padding:24px">Non hai ancora fatto richieste.</div>'}
      </section>
    </div>
  </div>`;
  rqPreview();
}
// Stato del giustificativo sulla richiesta: porta alla scheda Giustificativi, sulla voce.
function docChip(d) {
  if (!d) return '';
  const label = { todo: 'Giustificativo da caricare', review: 'Giustificativo in verifica', ok: 'Giustificativo accettato', ko: 'Giustificativo da ricaricare' }[d.status];
  return `<button type="button" class="rq-docchip s-${d.status}" onclick="GD.sel = ${d.absence_id}; GD.filter = 'all'; tsSetTab('giustificativi')">${tsi('paperclip', 13)}${label}</button>`;
}
function rqSet(patch, rerender = false) { Object.assign(RQ.form, patch); if (rerender) tsRenderLeave(); else rqPreview(); }
function rqBody() {
  const t = rqType(), f = RQ.form, byHours = t?.unit === 'ore';
  return { absence_type_id: t?.id, part: byHours ? 'ore' : 'giorno', start_date: f.start_date, end_date: byHours ? f.start_date : f.end_date,
    start_time: byHours ? f.start_time : undefined, end_time: byHours ? f.end_time : undefined, protocol: f.protocol || undefined, note: f.note || undefined };
}
async function rqPreview() {
  const box = document.getElementById('rq-amount');
  const t = rqType();
  if (!box || !t) return;
  const tok = ++RQ.previewTok;
  try {
    const p = await api('/api/admin/hr/absences/preview', { method: 'POST', body: JSON.stringify(rqBody()) });
    if (tok !== RQ.previewTok) return;
    box.innerHTML = `<b>${t.unit === 'ore' ? esc(p.amount_label) : `${p.work_days} ${p.work_days === 1 ? 'giorno lavorativo' : 'giorni lavorativi'}`}</b>
      <span>${t.flow === 'comunicazione' ? 'Il responsabile ne prende visione' : `Va in approvazione a ${esc(p.approver || "l'ufficio del personale")}`}</span>${p.warnings.map(w => `<span class="rq-warn">${esc(w)}</span>`).join('')}`;
  } catch (e) { if (tok === RQ.previewTok) box.innerHTML = `<b>—</b><span class="ts-err">${esc(e.message)}</span>`; }
}
async function rqSubmit() {
  const t = rqType();
  const f = RQ.form;
  const msg = document.getElementById('rq-msg');
  if (t.unit !== 'ore' && f.end_date < f.start_date) return UI.msg(msg, 'La data di fine deve essere uguale o successiva all\'inizio.');
  if (t.unit === 'ore' && tsToMin(f.end_time) <= tsToMin(f.start_time)) return UI.msg(msg, "L'orario di fine deve essere dopo l'inizio.");
  if (t.requires_protocol && !f.protocol?.trim()) return UI.msg(msg, 'Indica il numero di protocollo del certificato.');
  try {
    const res = await api('/api/admin/hr/absences', { method: 'POST', body: JSON.stringify({ ...rqBody(), submit: true }) });
    RQ.form = {};
    tsToast(t.flow === 'comunicazione' ? 'Comunicazione inviata' : 'Richiesta inviata', t.flow === 'comunicazione' ? 'Il responsabile ne prende visione.' : 'Riceverai una notifica quando il responsabile risponde.');
    if (res.warnings?.length) setTimeout(() => tsWarn(res), 2700);
    loadHrTimesheet();
  } catch (e) { UI.msg(msg, e.message); }
}
function rqRow(a, showWho, extra = '') {
  const [tone, label] = RQ_STATUS[a.status];
  const own = !showWho;
  const canCancel = own && (['bozza', 'richiesta'].includes(a.status) || (['approvata', 'comunicata', 'presa_visione'].includes(a.status) && a.start_date > tsToday()));
  return `<div class="rq-row">
    ${showWho ? `<span class="rq-avatar">${esc(tsInitials(a.employee_name))}</span>` : `<span class="rq-ticon ${rqClass(a)}">${tsi(rqIcon(a), 18)}</span>`}
    <div class="rq-main">
      <div class="rq-title">${showWho ? `<b>${esc(a.employee_name)}</b>${a.employee_job_title ? `<span class="ts-muted">· ${esc(a.employee_job_title)}</span>` : ''}<span class="rq-typetag ${rqClass(a)}">${esc(a.type_name)}</span>` : `<b>${esc(a.type_name)}</b>`}</div>
      <div class="rq-when">${rqWhen(a)} <span class="ts-muted">· ${a.amount ? absAmount(a.amount, a.unit) : ''}</span></div>
      ${a.note ? `<div class="rq-note">“${esc(a.note)}”</div>` : ''}${a.protocol && a.protocol !== 'anteprima' ? `<div class="rq-note">Protocollo ${esc(a.protocol)}</div>` : ''}
      ${a.status === 'rifiutata' && a.decision_note ? `<div class="rq-reason">${tsi('message', 14)}${esc(a.decision_note)}</div>` : ''}
      ${a.status === 'richiesta' && own ? `<div class="ts-muted" style="font-size:12px">Decide ${esc(a.escalated_at && a.delegate_name ? `${a.delegate_name} (delegato)` : a.approver_name || "l'ufficio del personale")}</div>` : ''}
      ${extra}
      ${canCancel ? `<button type="button" class="ts-linkbtn" onclick="rqCancel(${a.id}, '${a.status}')">${tsi('x', 14)}${a.status === 'bozza' ? 'Elimina la bozza' : 'Annulla richiesta'}</button>` : ''}
    </div>
    <div class="rq-side"><span class="ts-badge ${tone}">${label}</span><span class="ts-muted">${a.submitted_at || a.created_at ? `inviata ${rqShort((a.submitted_at || a.created_at).slice(0, 10))}` : ''}</span></div>
  </div>`;
}
function rqCancel(id, status) {
  const done = () => { tsToast(status === 'bozza' ? 'Bozza eliminata' : 'Richiesta annullata'); loadHrTimesheet(); };
  if (status === 'bozza') return UI.confirmDo('Eliminare la bozza?', () => api(`/api/admin/hr/absences/${id}`, { method: 'DELETE' }), done);
  UI.confirmDo('Annullare questa richiesta? Il contatore torna come prima.', () => api(`/api/admin/hr/absences/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) }), done);
}

// ── Richieste del team (responsabili, delegati, ufficio del personale) ──────────
async function tsRenderTeam() {
  await absTypes();
  const start = (() => { const d = tsDate(tsToday()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const end = tsAddDays(start, 27);
  const since = tsAddDays(tsToday(), -120);
  const [pending, around, history] = await Promise.all([
    api('/api/admin/hr/absences?to_decide=1'),
    api(`/api/admin/hr/absences?from=${start}&to=${end}`),
    api(`/api/admin/hr/absences?from=${since}`),
  ]);
  const me = TS.employeeId;
  const todo = pending.filter(a => a.employee_id !== me).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const live = ['richiesta', 'approvata', 'comunicata', 'presa_visione'];
  const cal = around.filter(a => a.employee_id !== me && live.includes(a.status));
  const done = history.filter(a => a.employee_id !== me && !['richiesta', 'comunicata', 'bozza'].includes(a.status)).sort((a, b) => (b.decided_at || b.updated_at || '').localeCompare(a.decided_at || a.updated_at || '')).slice(0, 60);
  const list = RQ.teamView === 'pending' ? todo : done;
  TS.teamCal = cal;
  tsRoot().innerHTML = `<div class="ts-page">
    ${tsHead({})}
    ${tsTeamSegs()}
    ${tsTeamCalendar(cal, start)}
    <section class="ts-card rq-list">
      <div class="rq-listhead"><div class="rq-filter">
        <button type="button" class="${RQ.teamView === 'pending' ? 'is-on' : ''}" onclick="RQ.teamView = 'pending'; tsRenderTeam()">Da gestire${todo.length ? ` <b>${todo.length}</b>` : ''}</button>
        <button type="button" class="${RQ.teamView === 'done' ? 'is-on' : ''}" onclick="RQ.teamView = 'done'; tsRenderTeam()">Storico</button></div>
        <span class="ts-muted" style="font-size:12px">${RQ.teamView === 'pending' ? 'Dopo alcuni giorni di attesa le richieste passano al delegato.' : 'Ultimi 4 mesi.'}</span></div>
      ${list.map(a => rqRow(a, true, a.can_decide && ['richiesta', 'comunicata'].includes(a.status) ? rqDecision(a, cal) : '')).join('')
        || `<div class="rq-empty">${tsi('circle-check', 28)}<b>${RQ.teamView === 'pending' ? 'Nessuna richiesta da gestire' : 'Nessuna decisione negli ultimi mesi'}</b><span>Quando il team invia una richiesta la trovi qui.</span></div>`}
    </section>
  </div>`;
}
function rqDecision(a, cal) {
  const clash = cal.filter(o => o.id !== a.id && o.employee_id !== a.employee_id && o.start_date <= a.end_date && a.start_date <= o.end_date);
  const names = [...new Map(clash.map(o => [o.id, `${o.employee_name.split(' ')[0]} (${o.type_name.toLowerCase()}${o.status === 'richiesta' ? ', in attesa' : ''})`])).values()];
  return `${names.length ? `<div class="rq-clash">${tsi('users', 14)}Negli stessi giorni: ${esc(names.join(', '))}</div>` : ''}
    <div class="rq-actions" id="rq-dec-${a.id}">${a.status === 'comunicata'
      ? `<button type="button" class="ts-btn primary sm" onclick="rqDecide(${a.id}, 'acknowledge')">${tsi('check', 14)}Presa visione</button>`
      : `<button type="button" class="ts-btn primary sm" onclick="rqDecide(${a.id}, 'approve')">${tsi('check', 14)}Approva</button><button type="button" class="ts-btn secondary sm" onclick="rqRejectForm(${a.id})">${tsi('x', 14)}Rifiuta</button>`}</div>`;
}
function rqRejectForm(id) {
  document.getElementById(`rq-dec-${id}`).outerHTML = `<div class="rq-rej" id="rq-dec-${id}"><input class="ts-input" id="rq-reason-${id}" placeholder="Motivo del rifiuto (lo vedrà il dipendente)" oninput="document.getElementById('rq-rej-btn-${id}').disabled = !this.value.trim()">
    <button type="button" class="ts-btn ghost sm" onclick="tsRenderTeam()">Annulla</button><button type="button" class="ts-btn danger sm" id="rq-rej-btn-${id}" disabled onclick="rqDecide(${id}, 'reject')">Rifiuta</button></div>`;
  document.getElementById(`rq-reason-${id}`).focus();
}
async function rqDecide(id, action) {
  try {
    const note = action === 'reject' ? document.getElementById(`rq-reason-${id}`).value.trim() : undefined;
    const res = await api(`/api/admin/hr/absences/${id}/${action}`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) });
    const a = (TS.teamCal || []).find(x => x.id === id);
    tsToast({ approve: 'Richiesta approvata', reject: 'Richiesta rifiutata', acknowledge: 'Presa visione registrata' }[action], a?.employee_name || '');
    if (res.warnings?.length) setTimeout(() => tsWarn(res), 2700);
    await tsLoadCounts();
    tsRenderTeam();
  } catch (e) { alert(e.message); }
}
function tsTeamCalendar(cal, start) {
  const days = Array.from({ length: 28 }, (_, i) => tsAddDays(start, i));
  const today = tsToday();
  const people = [...new Map(cal.map(a => [a.employee_id, a.employee_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cell = (pid, d) => cal.find(a => a.employee_id === pid && d >= a.start_date && d <= a.end_date);
  const we = d => [0, 6].includes(tsDate(d).getDay());
  return `<section class="ts-card rq-cal">
    <div class="rq-listhead"><div class="ts-eyebrow">Assenze del team · prossime 4 settimane</div>
      <div class="rq-calleg"><span><i class="t-fer"></i>Ferie</span><span><i class="t-per"></i>Permessi e altro</span><span><i class="t-mal"></i>Malattia</span><span><i class="is-pend"></i>In attesa</span></div></div>
    ${people.length ? `<div class="rq-calgrid" style="grid-template-columns:150px repeat(${days.length},minmax(0,1fr))">
      <span></span>${days.map((d, i) => `<span class="rq-calday${we(d) ? ' is-we' : ''}${d === today ? ' is-today' : ''}">${i === 0 || d.endsWith('-01') ? TS_MN[tsDate(d).getMonth()].slice(0, 3) : ''}<b>${Number(d.slice(8))}</b></span>`).join('')}
      ${people.map(([pid, name]) => `<span class="rq-calname">${esc(name)}</span>${days.map(d => { const a = cell(pid, d);
        return `<span class="rq-calcell${we(d) ? ' is-we' : ''}">${a && !we(d) ? `<i class="${rqClass(a)}${a.status === 'richiesta' ? ' is-pend' : ''}" title="${UI.attr(`${a.type_name} · ${RQ_STATUS[a.status][1]}`)}"></i>` : ''}</span>`; }).join('')}`).join('')}
    </div>` : '<div class="ts-muted" style="padding:20px">Nessuna assenza nel team nelle prossime 4 settimane.</div>'}
  </section>`;
}

// ── Presenze: i fogli dei collaboratori (HR e responsabili) ─────────────────────
async function loadHrPresenze() {
  TS.mode = 'review';
  await tsOptions(true);
  if (TS.reviewId) return loadTsSheet();
  // Il proprio foglio sta nel Timesheet: qui solo quelli degli altri.
  const rows = (await api(`/api/admin/hr/timesheet/overview?period=${TS.period}`)).filter(x => x.employee_id !== TS.options.me?.id);
  tsRoot().innerHTML = `<div class="list-card">
    <div class="list-toolbar">
      <div class="list-toolbar-title"><h3>Presenze di ${esc(UI.monthLabel(TS.period))}</h3><p class="mod-intro">I fogli dei collaboratori, in sola lettura: ognuno inserisce le proprie ore nel suo Timesheet e invia il mese. Qui si controlla, si approva o si rimanda indietro con una nota; dopo l'approvazione le correzioni si fanno con una rettifica.</p></div>
      <div class="list-spacer"></div>
      <div class="mod-toolbar-fields"><input type="month" value="${TS.period}" onchange="TS.period = this.value || UI.thisMonth(); loadHrPresenze()"></div>
      ${TS.options.hr ? `<button class="btn secondary small" onclick="UI.download('/api/admin/hr/timesheet/export/${TS.period}')">Esporta CSV</button>` : ''}
    </div>
    ${rows.length ? `<div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>Dipendente</th><th>Stato</th><th class="num">Lavorate</th><th class="num">Assenze</th><th class="num">Orario</th><th class="num">Giorni scoperti</th><th class="num">Conflitti</th><th class="num">Straord. da approvare</th></tr></thead><tbody>
      ${rows.map(x => `<tr class="mod-clickable" onclick="TS.reviewId = ${x.employee_id}; TS.openDays = new Set(); loadTsSheet()"><td><b>${esc(x.name)}</b></td>
        <td><span class="badge ${{ aperto: 'grey', inviato: 'yellow', approvato: 'green' }[x.status]}">${TS_STATUS[x.status][1]}</span>${x.can_approve ? ' <span class="badge yellow">da approvare</span>' : ''}</td>
        <td class="num">${tsHours(x.worked)}</td><td class="num">${tsHours(x.absent)}</td><td class="num">${tsHours(x.scheduled)}</td>
        <td class="num" style="${x.missing_days ? 'color:var(--warn);font-weight:600' : ''}">${x.missing_days || '—'}</td>
        <td class="num" style="${x.conflicts ? 'color:var(--bad);font-weight:600' : ''}">${x.conflicts || '—'}</td><td class="num" style="${x.overtime_pending ? 'color:var(--warn);font-weight:600' : ''}">${x.overtime_pending ? tsHours(x.overtime_pending) : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="mod-empty">Nessun collaboratore da mostrare.</div>'}
  </div>`;
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

// Apre un foglio da un altro punto: il proprio nel Timesheet, quello di un collaboratore in Presenze.
function tsOpenFor(employeeId, period, tab) {
  if (period) TS.period = period;
  const mine = !employeeId || (typeof ME !== 'undefined' && ME.data?.employee?.id === employeeId) || TS.options?.me?.id === employeeId;
  if (!mine) { TS.reviewId = employeeId; TS.tab = 'team'; TS.teamSeg = 'presenze'; }
  else if (tab) { TS.tab = tab; if (tab === 'team') TS.teamSeg = 'assenze'; }
  TS.urlTab = '';
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
    <div class="list-toolbar"><div class="list-toolbar-title"><h3>Timesheet</h3><p class="mod-intro">Passo degli orari, centri usati per le righe proposte e colonne dell'export per il consulente del lavoro. I colori dei centri nel Timesheet seguono il loro aggregato (Vigneto, Produttivi, Commerciali…).</p></div></div>
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
