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
  async confirmDo(question, fn, onDone) {
    if (!confirm(question)) return;
    try { await fn(); if (onDone) await onDone(); } catch (e) { alert(e.message); }
  },
  icon: {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  },
};
