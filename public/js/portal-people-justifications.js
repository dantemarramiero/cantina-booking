// Portale → giustificativi delle assenze (handoff MyWinery «Giustificativi»).
//  - Timesheet → Giustificativi: il dipendente carica i documenti a supporto delle proprie assenze (o il
//    numero di protocollo della malattia, o l'autocertificazione dove ammessa) e segue la verifica.
//  - People → Assenze → Giustificativi: l'ufficio personale verifica, accetta o chiede di ricaricare.
// I file stanno nell'archivio HR cifrato; quelli sanitari li vede solo chi ha il livello «sanitario».
const GD_STATUS = { todo: ['warning', 'Da caricare'], ko: ['danger', 'Da ricaricare'], review: ['neutral', 'In verifica'], ok: ['success', 'Accettato'] };
const GD = { filter: null, sel: null, files: [], protocol: '', note: '', selfCert: false, editing: false, hrState: 'review' };
const gdShort = s => { const d = tsDate(s); return `${d.getDate()} ${TS_MN[d.getMonth()].slice(0, 3)}`; };
const gdSize = b => (b > 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const gdCat = d => ({ ferie: 'Ferie', permesso: 'Permesso', malattia: 'Malattia', congedo: 'Congedo' }[d.category] || 'Assenza');
const gdClass = d => ({ ferie: 't-fer', malattia: 't-mal', congedo: 't-con' }[d.category] || 't-per');
const gdIcon = d => ({ ferie: 'plane', malattia: 'thermometer', congedo: 'heart' }[d.category] || 'clock');
const gdWhen = d => (d.part === 'ore' ? `${rqShort(d.start_date)} · ${d.start_time}–${d.end_time}` : d.start_date === d.end_date ? rqShort(d.start_date) : `${rqShort(d.start_date)} → ${rqShort(d.end_date)}`);
function gdDeadline(d) {
  if (['ok', 'review'].includes(d.status)) return { label: `Scadenza ${gdShort(d.due_date)}`, tone: 'muted' };
  const left = Math.round((tsDate(d.due_date) - tsDate(tsToday())) / 864e5);
  if (left < 0) return { label: `Scaduto il ${gdShort(d.due_date)}`, tone: 'danger' };
  if (left === 0) return { label: 'Scade oggi', tone: 'danger' };
  if (left <= 2) return { label: `Scade tra ${left} ${left === 1 ? 'giorno' : 'giorni'}`, tone: 'warning' };
  return { label: `Entro il ${gdShort(d.due_date)}`, tone: 'muted' };
}
async function gdOpenFile(id) { UI.download(`/api/admin/hr/documents/${id}/download`); }
async function gdOpenSelfCert(absenceId) {
  try { const { url } = await api('/api/admin/signed-url?path=' + encodeURIComponent(`/api/admin/hr/absences/${absenceId}/self-cert`)); window.open(url, '_blank', 'noopener'); } catch (e) { alert(e.message); }
}
const gdFileRow = (f, removable, i) => `<div class="gd-file"><span class="gd-file-ic">${tsi(/\.pdf$/i.test(f.name) ? 'file' : 'image', 18)}</span>
  <span class="gd-file-n">${f.id ? `<button type="button" class="ts-linkbtn" style="padding:0" onclick="gdOpenFile(${f.id})">${esc(f.name)}</button>` : esc(f.name)}<small>${gdSize(f.size)}</small></span>
  ${removable ? `<button type="button" class="ts-icbtn" onclick="GD.files.splice(${i}, 1); tsRenderDocs(false)" aria-label="Rimuovi file">${tsi('x')}</button>` : ''}</div>`;

// ── Timesheet → Giustificativi (il dipendente) ─────────────────────────────────
async function tsRenderDocs(reload = true) {
  if (reload) { TS.myDocs = await api('/api/admin/hr/absences/justifications/mine'); await absTypes(); }
  const rank = { ko: 0, todo: 1, review: 2, ok: 3 };
  const items = [...TS.myDocs].sort((a, b) => rank[a.status] - rank[b.status] || a.due_date.localeCompare(b.due_date));
  const counts = { todo: items.filter(x => ['todo', 'ko'].includes(x.status)).length, review: items.filter(x => x.status === 'review').length, ok: items.filter(x => x.status === 'ok').length };
  if (!GD.filter) GD.filter = counts.todo ? 'todo' : 'all';
  const shown = items.filter(x => GD.filter === 'all' || (GD.filter === 'todo' ? ['todo', 'ko'].includes(x.status) : x.status === GD.filter));
  let cur = items.find(x => x.absence_id === GD.sel) || shown[0] || null;
  if (cur && GD.curId !== cur.absence_id) { GD.curId = cur.absence_id; GD.files = []; GD.protocol = cur.protocol || ''; GD.note = ''; GD.selfCert = cur.self_cert; GD.editing = ['todo', 'ko'].includes(cur.status); }
  const urgent = items.filter(x => ['todo', 'ko'].includes(x.status) && ['danger', 'warning'].includes(gdDeadline(x).tone));
  tsRoot().innerHTML = `<div class="ts-page">
    ${tsHead({})}
    ${counts.todo ? `<div class="gd-alert">${tsi('paperclip', 18)}<span><b>${counts.todo} ${counts.todo === 1 ? 'giustificativo da caricare' : 'giustificativi da caricare'}</b>${urgent.length ? ` · ${esc(urgent[0].type_name)}: ${esc(gdDeadline(urgent[0]).label.toLowerCase())}` : ''}</span></div>` : ''}
    <div class="gd-layout">
      <section class="ts-card rq-list">
        <div class="rq-listhead"><div class="rq-filter">${[['todo', 'Da caricare', counts.todo], ['review', 'In verifica', counts.review], ['ok', 'Accettati', counts.ok], ['all', 'Tutti']]
          .map(([v, l, n]) => `<button type="button" class="${GD.filter === v ? 'is-on' : ''}" onclick="GD.filter = '${v}'; GD.sel = null; tsRenderDocs(false)">${l}${n && v === 'todo' ? ` <b>${n}</b>` : n ? ` <span class="ts-muted">${n}</span>` : ''}</button>`).join('')}</div></div>
        ${shown.map(d => { const dl = gdDeadline(d); const [tone, label] = GD_STATUS[d.status];
          return `<button type="button" class="gd-item${cur?.absence_id === d.absence_id ? ' is-sel' : ''}" onclick="GD.sel = ${d.absence_id}; tsRenderDocs(false)">
            <span class="rq-ticon ${gdClass(d)}">${tsi(gdIcon(d), 18)}</span>
            <span class="gd-item-m"><b>${esc(d.type_name)}</b><span>${gdWhen(d)}</span><span class="gd-due is-${dl.tone}">${esc(dl.label)}</span></span>
            <span class="ts-badge ${tone}">${label}</span></button>`; }).join('')
          || `<div class="rq-empty">${tsi('circle-check', 28)}<b>Niente da caricare</b><span>Tutti i giustificativi sono a posto.</span></div>`}
        <div class="gd-foot">Manca un'assenza? Prima fai la richiesta in <button type="button" class="ts-linkbtn" style="padding:0" onclick="tsSetTab('ferie')">Ferie e permessi</button>, poi il giustificativo compare qui.</div>
      </section>
      <div class="rq-col" style="gap:16px">${cur ? gdPanel(cur) : ''}${gdGuide()}</div>
    </div>
  </div>`;
}
function gdPanel(d) {
  const [tone, label] = GD_STATUS[d.status];
  const dl = gdDeadline(d), proto = d.doc_mode === 'protocol';
  const protoOk = /^\d{8,}$/.test(GD.protocol.replace(/\s/g, ''));
  const canSend = proto ? protoOk : GD.files.length > 0;
  const drop = (id) => `<div class="gd-drop" id="${id}" onclick="document.getElementById('${id}-in').click()" ondragover="event.preventDefault(); this.classList.add('is-over')" ondragleave="this.classList.remove('is-over')" ondrop="event.preventDefault(); this.classList.remove('is-over'); gdTake(event.dataTransfer.files)">
    <input id="${id}-in" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,image/*,application/pdf" hidden onchange="gdTake(this.files); this.value = ''">
    <span class="gd-drop-ic">${tsi('upload', 22)}</span><b>Trascina qui il file o <u>sfoglia</u></b><span>PDF, JPG, PNG o HEIC · max 10 MB · da telefono puoi scattare una foto</span></div>`;
  return `<section class="ts-card gd-panel">
    <header class="gd-phead"><span class="rq-ticon ${gdClass(d)}">${tsi(gdIcon(d), 20)}</span>
      <div style="flex:1;min-width:0"><h3>${esc(d.type_name)}</h3><div class="gd-psub">${gdCat(d)} · ${gdWhen(d)}${d.amount ? ` · ${absAmount(d.amount, d.unit)}` : ''}${['richiesta'].includes(d.absence_status) ? ' · richiesta in attesa' : ''}</div></div>
      <span class="ts-badge ${tone}">${label}</span></header>
    <div class="gd-pbody">
      <div class="gd-req"><div class="ts-eyebrow">Documento richiesto</div><b>${GD.selfCert ? 'Modulo di autocertificazione firmato' : esc(d.doc_label)}</b>${d.doc_hint && !GD.selfCert ? `<span>${esc(d.doc_hint)}</span>` : ''}
        <span class="gd-due is-${dl.tone}">${tsi('calendar', 14)}${esc(dl.label)}</span></div>
      ${d.status === 'ko' && d.hr_note ? `<div class="gd-ko">${tsi('message', 16)}<div><b>L'ufficio personale ha chiesto di ricaricarlo</b><span>${esc(d.hr_note)}</span></div></div>` : ''}
      ${!GD.editing ? `
        ${proto ? `<div class="gd-proto-ro"><span>Numero di protocollo</span><b>${esc(d.protocol || '—')}</b></div>` : ''}
        ${d.files.length ? `<div class="gd-files">${d.files.map(f => gdFileRow(f, false)).join('')}</div>` : ''}
        ${d.status === 'ok' ? `<div class="gd-okmsg">${tsi('circle-check', 18)}Documento verificato dall'ufficio personale. Non serve altro.</div>` : ''}
        ${d.status === 'review' ? `<div class="gd-info">${tsi('hourglass', 16)}L'ufficio personale lo sta verificando. Riceverai una notifica.</div>
          <button type="button" class="ts-linkbtn" onclick="GD.editing = true; GD.files = []; tsRenderDocs(false)">${tsi('refresh', 14)}Sostituisci documento</button>` : ''}`
      : `${proto ? `<label class="ts-field"><span>Numero di protocollo del certificato <b>*</b></span>
          <input class="ts-input gd-protoin" inputmode="numeric" placeholder="es. 48213977" value="${UI.attr(GD.protocol)}" oninput="GD.protocol = this.value; document.getElementById('gd-send').disabled = !/^\\d{8,}$/.test(this.value.replace(/\\s/g, ''))">
          <small class="ts-muted" style="font-weight:400">L'azienda consulta il certificato direttamente sul portale INPS: non serve caricare la diagnosi.</small></label>
          <details class="gd-opt"${GD.files.length ? ' open' : ''}><summary>Allega anche una copia (facoltativo)</summary>${drop('gd-drop2')}<div class="gd-files">${GD.files.map((f, i) => gdFileRow(f, true, i)).join('')}</div></details>`
        : `${d.doc_self_cert ? `<div class="gd-self"><label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" ${GD.selfCert ? 'checked' : ''} onchange="GD.selfCert = this.checked; tsRenderDocs(false)"> Preferisco usare l'autocertificazione</label>
            ${GD.selfCert ? `<button type="button" class="ts-linkbtn" onclick="gdOpenSelfCert(${d.absence_id})">${tsi('download', 14)}Scarica il modulo da compilare e firmare</button>` : ''}</div>` : ''}
          ${drop('gd-drop')}<div class="gd-files">${GD.files.map((f, i) => gdFileRow(f, true, i)).join('')}</div>`}
        <label class="ts-field"><span>Nota per l'ufficio personale <em class="ts-muted" style="font-style:normal;font-weight:400">(facoltativa)</em></span>
          <input class="ts-input" value="${UI.attr(GD.note)}" placeholder="es. L'originale lo consegno lunedì" oninput="GD.note = this.value"></label>
        <div id="gd-msg"></div>`}
      ${d.health ? `<div class="gd-privacy">${tsi('lock', 14)}I documenti sanitari sono visibili solo all'ufficio personale, non al tuo responsabile. Non caricare la diagnosi: basta l'attestazione.</div>` : `<div class="gd-privacy">${tsi('lock', 14)}Carica solo ciò che serve a giustificare l'assenza.</div>`}
    </div>
    ${GD.editing ? `<footer class="gd-pfoot">${d.status === 'review' ? '<button type="button" class="ts-btn ghost" onclick="GD.editing = false; GD.files = []; tsRenderDocs(false)">Annulla</button>' : ''}
      <button type="button" class="ts-btn accent" id="gd-send" ${canSend ? '' : 'disabled'} onclick="gdSubmit(${d.absence_id})">${tsi('send')}Invia per verifica</button></footer>` : ''}
  </section>`;
}
function gdTake(list) {
  const ok = [...list].filter(f => /pdf|jpe?g|png|hei[cf]/i.test(f.type || f.name) && f.size <= 10e6);
  const skipped = list.length - ok.length;
  GD.files.push(...ok);
  GD.files = GD.files.slice(0, 5);
  tsRenderDocs(false);
  if (skipped) tsToast('Alcuni file non sono stati aggiunti', 'Sono ammessi PDF, JPG, PNG o HEIC fino a 10 MB (al massimo 5 file).', 'warn');
}
async function gdSubmit(absenceId) {
  const fd = new FormData();
  for (const f of GD.files) fd.append('files', f, f.name);
  fd.append('protocol', GD.protocol.replace(/\s/g, ''));
  fd.append('self_cert', GD.selfCert ? '1' : '0');
  fd.append('note', GD.note);
  const btn = document.getElementById('gd-send');
  if (btn) btn.disabled = true;
  try {
    await api(`/api/admin/hr/absences/${absenceId}/justification`, { method: 'POST', body: fd });
    GD.curId = null; GD.sel = absenceId; GD.filter = 'all';
    tsToast('Giustificativo inviato', "L'ufficio personale lo verificherà a breve.");
    await tsLoadCounts();
    tsRenderDocs();
  } catch (e) { UI.msg(document.getElementById('gd-msg'), e.message); if (btn) btn.disabled = false; }
}
function gdGuide() {
  const open = GD.guideOpen;
  const groups = RQ_KINDS.map(([k, l, ic]) => ({ l, ic, rows: rqTypesOf(k) })).filter(g => g.rows.length);
  return `<section class="ts-card gd-guide"><button type="button" class="gd-guide-h" onclick="GD.guideOpen = !GD.guideOpen; tsRenderDocs(false)">${tsi('book', 18)}<span><b>Quali documenti servono</b><small>Tutti i casi, con i tempi di consegna</small></span>${tsi(open ? 'chevron-up' : 'chevron-down', 18)}</button>
    ${open ? `<div class="gd-guide-b">${groups.map(g => `<div class="gd-guide-t">${tsi(g.ic, 14)}${g.l}</div>${g.rows.map(t => `<div class="gd-guide-r"><span>${esc(t.name)}</span>
      <span class="ts-muted">${t.doc_required ? esc(t.doc_label) : 'Nessun documento'}${t.doc_self_cert ? ' · anche autocertificazione' : ''}</span><b>${t.doc_required ? (t.doc_mode === 'protocol' ? `entro ${t.doc_deadline_days} gg` : `entro ${t.doc_deadline_days} gg`) : '—'}</b></div>`).join('')}`).join('')}
      <p class="ts-muted" style="font-size:12px;margin:12px 0 0">I tempi decorrono dalla fine dell'assenza e li stabilisce l'azienda, in base al contratto collettivo.</p></div>` : ''}
  </section>`;
}

// ── People → Assenze → Giustificativi (l'ufficio personale) ────────────────────
async function loadHrJustifications(root, tabs, head) {
  let rows;
  try { rows = await api(`/api/admin/hr/absences/justifications?state=${GD.hrState}`); }
  catch (e) { root.innerHTML = `<div class="list-card">${tabs}<div class="mod-empty">${esc(e.message)}</div></div>`; return; }
  const states = [['review', 'Da verificare'], ['missing', 'Mancanti o da ricaricare'], ['ok', 'Accettati'], ['all', 'Tutti']];
  root.innerHTML = `<div class="list-card">${tabs}${head('Giustificativi', 'Si accettano o si chiede di ricaricarli, con un motivo che legge il dipendente. I sanitari li apre solo chi ha il livello «sanitario».',
    `<div class="mod-toolbar-fields"><select onchange="GD.hrState = this.value; loadHrAbsences()">${states.map(([v, l]) => `<option value="${v}" ${GD.hrState === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`)}
    ${rows.map(d => { const [tone, label] = GD_STATUS[d.status]; const dl = gdDeadline(d);
      return `<div class="mod-row" style="align-items:flex-start">
        <div class="mod-row-main"><div class="mod-row-title">${esc(d.employee_name)} · ${esc(d.type_name)} <span style="font-weight:400;color:var(--ink-soft)">${gdWhen(d)}</span></div>
          <div class="mod-row-sub">${esc(d.doc_label)} · <span style="color:${dl.tone === 'danger' ? 'var(--bad)' : dl.tone === 'warning' ? 'var(--warn)' : 'inherit'}">${esc(dl.label)}</span>${d.self_cert ? ' · autocertificazione' : ''}${d.health ? ' · sanitario' : ''}</div>
          ${d.protocol ? `<div class="mod-row-sub">Protocollo <b>${esc(d.protocol)}</b>${d.doc_mode === 'protocol' ? ' — da verificare sul portale INPS' : ''}</div>` : ''}
          ${d.employee_note ? `<div class="mod-row-sub">Nota: ${esc(d.employee_note)}</div>` : ''}${d.status === 'ko' && d.hr_note ? `<div class="mod-row-sub" style="color:var(--bad)">Chiesto di ricaricare: ${esc(d.hr_note)}</div>` : ''}
          ${d.files.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${d.files.map(f => `<button type="button" class="btn-outline-pill" onclick="gdOpenFile(${f.id})">${esc(f.name)} · ${gdSize(f.size)}</button>`).join('')}</div>`
            : !d.can_review && d.status === 'review' ? '<div class="mod-row-sub">I file sanitari li apre chi ha il livello «sanitario».</div>' : ''}
        </div>
        <span class="badge ${{ warning: 'yellow', danger: 'red', neutral: 'grey', success: 'green' }[tone]}">${label}</span>
        ${d.status === 'review' && d.can_review ? `<div class="mod-row-actions"><button class="btn small" onclick="gdDecide(${d.absence_id}, 'accept')">Accetta</button><button class="btn secondary small" onclick="gdDecide(${d.absence_id}, 'reject')">Chiedi di ricaricare</button></div>` : ''}
      </div>`; }).join('') || `<div class="mod-empty">${GD.hrState === 'review' ? 'Nessun giustificativo da verificare.' : 'Nessun giustificativo.'}</div>`}
  </div>`;
}
async function gdDecide(absenceId, action) {
  if (action === 'reject') {
    UI.modal({ id: 'gd-reject-modal', title: 'Chiedi di ricaricare', width: 460, saveLabel: 'Invia al dipendente', body: '<div class="field"><label>Cosa non va (lo legge il dipendente)</label><textarea name="note" rows="3" placeholder="es. La foto è sfocata e non si legge la data."></textarea></div>',
      onSave: async b => { await api(`/api/admin/hr/absences/${absenceId}/justification/reject`, { method: 'POST', body: JSON.stringify({ note: UI.val(b, 'note') }) }); loadHrAbsences(); } });
    return;
  }
  try { await api(`/api/admin/hr/absences/${absenceId}/justification/accept`, { method: 'POST', body: JSON.stringify({}) }); loadHrAbsences(); } catch (e) { alert(e.message); }
}
