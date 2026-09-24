// Aiuti condivisi dai moduli People e Finance del portale. Usano api(), esc(), openModal()/closeModal()
// e le classi CSS del portale (list-card, list-toolbar, field, modal-box, badge, btn...).
const UI = {
  // Escape per valori dentro attributi HTML (esc() del portale tratta solo "<").
  attr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
  euro(cents) {
    return '€ ' + ((cents || 0) / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  },
  // "120.500" (stringa con punto) → "120,5"
  decimal(s) {
    if (s == null || s === '') return '';
    return Number(s).toLocaleString('it-IT', { maximumFractionDigits: 4, useGrouping: 'always' });
  },
  // Importo scritto all'italiana → stringa per il server: "30.000" → "30000", "1.234,56" → "1234,56".
  num(s) {
    const v = String(s ?? '').trim().replace(/\s|€/g, '');
    if (v.includes(',')) return v.replace(/\./g, '');
    return /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replace(/\./g, '') : v;
  },
  date(d) {
    return d ? new Date(`${d}T00:00:00`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  },
  thisMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },
  monthLabel(p) {
    const [y, m] = p.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  },
  options(list, selected, { empty = null, value = o => o.id, label = o => o.name } = {}) {
    return (empty != null ? `<option value="">${esc(empty)}</option>` : '')
      + list.map(o => `<option value="${UI.attr(value(o))}" ${String(value(o)) === String(selected ?? '') ? 'selected' : ''}>${esc(label(o))}</option>`).join('');
  },
  // Finestra modale costruita al volo. onSave(box) può lanciare un errore: il messaggio compare nella finestra.
  modal({ id, title, body, saveLabel = 'Salva', onSave, width = 560, extraButtons = '' }) {
    document.getElementById(id)?.remove();
    const el = document.createElement('div');
    el.className = 'modal-overlay open';
    el.id = id;
    el.innerHTML = `<div class="modal-box" style="max-width:${width}px">
      <h3>${esc(title)}</h3>
      <div class="ui-modal-msg"></div>
      <div class="ui-modal-body">${body}</div>
      <div class="modal-actions">${extraButtons}
        <button class="btn secondary" type="button" data-ui="cancel">Annulla</button>
        ${onSave ? `<button class="btn" type="button" data-ui="save">${esc(saveLabel)}</button>` : ''}
      </div>
    </div>`;
    document.body.appendChild(el);
    el.querySelector('[data-ui="cancel"]').onclick = () => el.remove();
    const save = el.querySelector('[data-ui="save"]');
    if (save) {
      save.onclick = async () => {
        save.disabled = true;
        try {
          await onSave(el);
          el.remove();
        } catch (e) {
          UI.msg(el.querySelector('.ui-modal-msg'), e.message);
        } finally {
          save.disabled = false;
        }
      };
    }
    return el;
  },
  msg(box, text, kind = 'error') {
    box.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : '';
  },
  val(root, name) {
    const el = root.querySelector(`[name="${name}"]`);
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    return el.value.trim();
  },
  // Scarica un export attraverso un link firmato (le API di download non accettano la sessione in chiaro).
  async download(path) {
    try {
      const { url } = await api('/api/admin/signed-url?path=' + encodeURIComponent(path));
      window.location.href = url;
    } catch (e) { alert(e.message); }
  },
  async confirmDo(question, fn, onDone) {
    if (!confirm(question)) return;
    try { await fn(); if (onDone) await onDone(); } catch (e) { alert(e.message); }
  },
  icon: {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  },
  // Etichetta relativa per le date recenti ("5 min fa", "ieri").
  ago(iso) {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'adesso';
    if (s < 3600) return `${Math.floor(s / 60)} min fa`;
    if (s < 86400) return `${Math.floor(s / 3600)} h fa`;
    if (s < 172800) return 'ieri';
    return new Date(iso).toLocaleDateString('it-IT');
  },
};

// ── Campanella delle notifiche (barra in alto del portale) ─────────────────────
const BELL = { timer: null, items: [] };
async function refreshBell() {
  try {
    const data = await api('/api/admin/notifications');
    BELL.items = data.items;
    const badge = document.getElementById('bell-count');
    if (badge) { badge.textContent = data.unread > 99 ? '99+' : data.unread; badge.style.display = data.unread ? '' : 'none'; }
    if (document.getElementById('bell-panel')?.classList.contains('open')) renderBell();
  } catch {}
}
function renderBell() {
  const panel = document.getElementById('bell-panel');
  panel.innerHTML = `<div class="bell-head"><b>Notifiche</b>${BELL.items.some(n => !n.read_at) ? '<button type="button" onclick="markAllBellRead()">Segna tutte come lette</button>' : ''}</div>
    ${BELL.items.map(n => `<button type="button" class="bell-item ${n.read_at ? '' : 'unread'}" onclick="openBellItem(${n.id})">
      <span class="bell-title">${esc(n.title)}</span>${n.body ? `<span class="bell-body">${esc(n.body)}</span>` : ''}<span class="bell-time">${esc(UI.ago(n.created_at))}</span>
    </button>`).join('') || '<div class="bell-empty">Nessuna notifica.</div>'}`;
}
function toggleBell(e) {
  e?.stopPropagation();
  const panel = document.getElementById('bell-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) renderBell();
}
async function openBellItem(id) {
  const n = BELL.items.find(x => x.id === id);
  await api('/api/admin/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [id] }) }).catch(() => {});
  document.getElementById('bell-panel').classList.remove('open');
  refreshBell();
  if (n?.link) openPortalLink(n.link);
}
// Apre un link interno del portale (?workspace=…&employee=…&tab=…) senza ricaricare la pagina.
function openPortalLink(link) {
  const url = new URL(link, location.origin);
  if (url.pathname !== '/portal.html') { location.href = url.pathname + url.search; return; } // es. l'admin dell'Enoturismo
  const q = url.searchParams;
  if (q.get('me') && typeof openMySpace === 'function') return openMySpace();
  const ws = q.get('workspace');
  if (ws && typeof switchWorkspace === 'function') switchWorkspace(ws);
  if (q.get('sub') && typeof clickSidebarSub === 'function') clickSidebarSub(q.get('sub'));
  if (ws === 'people' && q.get('employee') && typeof openHrRecord === 'function') openHrRecord(parseInt(q.get('employee')), q.get('tab') || undefined);
}
async function markAllBellRead() {
  await api('/api/admin/notifications/read', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
  refreshBell();
}
function initBell() {
  refreshBell();
  clearInterval(BELL.timer);
  BELL.timer = setInterval(refreshBell, 60000);
  document.addEventListener('click', e => {
    const panel = document.getElementById('bell-panel');
    if (panel && !panel.contains(e.target) && !e.target.closest('#bell-btn')) panel.classList.remove('open');
  });
}
