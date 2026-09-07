// DOM helpers, icons, toasts and modal dialogs.

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Build a single element from an HTML string. */
export function node(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Event delegation: on(root, 'click', '[data-act="x"]', handler). */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (ev) => {
    const target = ev.target.closest(selector);
    if (target && root.contains(target)) handler(ev, target);
  });
}

// ---------------------------------------------------------------- icons

const ICONS = {
  dumbbell: '<path d="M6.5 6.5v11M3 9v6M17.5 6.5v11M21 9v6M6.5 12h11"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4M12 2v14"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  pause: '<path d="M7 4v16M17 4v16"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  whatsapp: '<path d="M3 21l1.65-4.5A8.5 8.5 0 1 1 8 19.3L3 21Z"/><path d="M8.6 9.2c.2 1.9 2.3 4 4.2 4.2l1-1.1 1.9.9-.3 1.3c-2.9.5-6.6-3.2-6.1-6.1l1.3-.3.9 1.9-.9 1.2"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.5 0-4.5-4-6-4-10.5 0 0-3 1.5-3 5 0 1.5-1 2-1.5 1.2C10 10 9.5 9 9.5 7.5 7 9.5 5 12 5 15.5 5 19.3 8 22 12 22Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8Z"/>',
};

export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS.info;
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// ---------------------------------------------------------------- toast

let toastTimer = null;

export function toast(message, { kind = 'info', duration = 2600, action = null } = {}) {
  let host = $('#toast-host');
  if (!host) {
    host = node('<div id="toast-host" class="toast-host" role="status" aria-live="polite"></div>');
    document.body.appendChild(host);
  }
  host.innerHTML = '';
  const el = node(`
    <div class="toast toast-${kind}">
      <span class="toast-msg">${esc(message)}</span>
      ${action ? `<button class="toast-action" type="button">${esc(action.label)}</button>` : ''}
    </div>`);
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', () => {
      action.onClick();
      el.remove();
    });
  }
  host.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), duration);
}

// ---------------------------------------------------------------- modal

function openModal(contentHtml, { onMount, dismissible = true } = {}) {
  const overlay = node(`
    <div class="modal-overlay">
      <div class="modal" role="dialog" aria-modal="true">${contentHtml}</div>
    </div>`);
  const close = () => {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 140);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape' && dismissible) close();
  };
  if (dismissible) {
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close();
    });
  }
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  const modal = overlay.querySelector('.modal');
  onMount?.(modal, close);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return { overlay, modal, close };
}

export function confirmDialog({
  title,
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
}) {
  return new Promise((resolve) => {
    openModal(
      `<h2 class="modal-title">${esc(title)}</h2>
       ${message ? `<p class="modal-body">${esc(message)}</p>` : ''}
       <div class="modal-actions">
         <button class="btn btn-ghost" data-a="cancel" type="button">${esc(cancelText)}</button>
         <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-a="ok" type="button">${esc(confirmText)}</button>
       </div>`,
      {
        onMount(modal, close) {
          modal.querySelector('[data-a="ok"]').addEventListener('click', () => {
            close();
            resolve(true);
          });
          modal.querySelector('[data-a="cancel"]').addEventListener('click', () => {
            close();
            resolve(false);
          });
          modal.querySelector('[data-a="ok"]').focus();
        },
      }
    );
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '', multiline = false, confirmText = 'Save' }) {
  return new Promise((resolve) => {
    const field = multiline
      ? `<textarea class="input" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
    openModal(
      `<h2 class="modal-title">${esc(title)}</h2>
       ${label ? `<label class="field-label">${esc(label)}</label>` : ''}
       ${field}
       <div class="modal-actions">
         <button class="btn btn-ghost" data-a="cancel" type="button">Cancel</button>
         <button class="btn btn-primary" data-a="ok" type="button">${esc(confirmText)}</button>
       </div>`,
      {
        onMount(modal, close) {
          const input = modal.querySelector('.input');
          const ok = () => {
            close();
            resolve(input.value);
          };
          modal.querySelector('[data-a="ok"]').addEventListener('click', ok);
          modal.querySelector('[data-a="cancel"]').addEventListener('click', () => {
            close();
            resolve(null);
          });
          if (!multiline) {
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') ok();
            });
          }
          input.focus();
          input.select?.();
        },
      }
    );
  });
}

/** A bottom sheet for richer content (exercise picker, share preview). */
export function sheet({ title, bodyHtml, onMount, wide = false }) {
  const overlay = node(`
    <div class="sheet-overlay">
      <div class="sheet ${wide ? 'sheet-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="sheet-head">
          <h2>${esc(title)}</h2>
          <button class="icon-btn" data-a="close" type="button" aria-label="Close">${icon('x')}</button>
        </header>
        <div class="sheet-body">${bodyHtml}</div>
      </div>
    </div>`);
  const close = () => {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 160);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => ev.key === 'Escape' && close();
  overlay.addEventListener('click', (ev) => ev.target === overlay && close());
  overlay.querySelector('[data-a="close"]').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  onMount?.(overlay.querySelector('.sheet-body'), close);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return { close, root: overlay };
}

export function emptyState({ iconName = 'info', title, message = '', actionLabel = null, actionHref = null }) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon(iconName)}</div>
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ''}
      ${actionLabel ? `<a class="btn btn-primary" href="${esc(actionHref || '#')}">${esc(actionLabel)}</a>` : ''}
    </div>`;
}
