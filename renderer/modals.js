'use strict';

/*
 * The dialog machinery (#12): one modal at a time, the focus trap, and the stack
 * that remembers who opened it.

 * Step 2 moved these three state declarations into storage.js by accident - they sat
 * between the usage functions. Nothing broke, because the names are global, but the
 * state of the modal system lived in a file about disk usage, which is exactly the
 * kind of thing a reader only finds after a bug. It belongs here with the functions
 * that use it.

 * Loaded before app.js. Nothing here runs at load time.
 */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let dialogOpener = null;
let dialogStack = [];

function openSimpleModal({ title, message, kind, options, prefill, placeholder, timeoutMs, okLabel = null, cancelLabel = null }) {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const modal = el('div', 'modal');
    modal.appendChild(el('h3', '', title || ''));
    if (message) modal.appendChild(el('div', 'modal-msg', message));

    let valueEl = null;
    if (kind === 'select') {
      const list = el('div', 'field');
      valueEl = document.createElement('select');
      for (const option of options) {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        valueEl.appendChild(opt);
      }
      list.appendChild(valueEl);
      modal.appendChild(list);
    } else if (kind === 'input') {
      valueEl = el('input');
      valueEl.type = 'text';
      valueEl.value = prefill || '';
      valueEl.placeholder = placeholder || '';
      modal.appendChild(valueEl);
    } else if (kind === 'editor') {
      valueEl = el('textarea');
      valueEl.value = prefill;
      modal.appendChild(valueEl);
    }

    const actions = el('div', 'modal-actions');
    // a confirm dialog says Yes/No unless the caller named the action, which is clearer for
    // destructive ones ("Delete for good", "Fork here"); the words come from the catalog so a
    // Chinese user gets 是 / 否 without every caller having to remember to translate
    const cancel = el('button', 'ghost', cancelLabel || (kind === 'confirm' ? tr('No') : tr('Cancel')));
    const ok = el('button', 'primary', okLabel || (kind === 'confirm' ? tr('Yes') : tr('OK')));
    actions.appendChild(cancel);
    actions.appendChild(ok);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let done = false;
    const finish = (response) => {
      if (done) return;
      done = true;
      backdrop.remove();
      modalOpen = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(response);
    };
    modalOpen = { finish, backdrop };

    const submit = () => {
      if (kind === 'confirm') finish({ confirmed: true });
      else if (kind === 'select') finish({ value: valueEl.value });
      else finish({ value: valueEl.value });
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish({ cancelled: true });
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || kind !== 'editor')) {
        if (kind !== 'confirm') {
          event.preventDefault();
          event.stopPropagation();
          submit();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);

    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => finish(kind === 'confirm' ? { confirmed: false } : { cancelled: true }));
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish({ cancelled: true });
    });

    setTimeout(() => (valueEl || ok).focus(), 30);
    if (timeoutMs) setTimeout(() => finish({ cancelled: true }), Math.max(500, timeoutMs - 200));
  });
}

function decorateDialog(backdrop, modal) {
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const heading = modal.querySelector('h3');
  if (heading) {
    if (!heading.id) heading.id = `dlg-${Date.now().toString(36)}`;
    modal.setAttribute('aria-labelledby', heading.id);
  }
  dialogStack.push(modal);
  if (!dialogOpener) dialogOpener = document.activeElement;

  modal.addEventListener('keydown', (event) => {
    if (dialogStack[dialogStack.length - 1] !== modal) return;
    if (event.key === 'Escape') {
      // every dialog has a Cancel / Close / Later button; reusing it means no dialog has to wire Esc
      // itself and the existing "done" guards keep the result consistent
      const cancel = [...modal.querySelectorAll('button')].find((button) => /^(cancel|close|later|dismiss|no)$/i.test(button.textContent.trim()));
      if (cancel) {
        event.preventDefault();
        cancel.click();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  modal.addEventListener('focusout', (event) => {
    if (event.relatedTarget === null && !modal.contains(document.activeElement)) {
      // focus left the dialog (clicked outside): bring it back while the dialog is still open
      if (backdrop.isConnected) (modal.querySelector(FOCUSABLE) || modal).focus();
    }
  });
}

function observeDialogs() {
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement) || !node.querySelector('.modal')) continue;
        dialogStack.pop();
        // the dialog is gone: hand focus back to whatever opened it (by now the removed nodes are
        // detached, so the document has already dropped focus to <body>)
        if (dialogOpener && dialogOpener.isConnected && (document.activeElement === document.body || document.activeElement === null)) {
          dialogOpener.focus();
          dialogOpener = null;
        }
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const modal = node.classList.contains('modal') ? node : node.querySelector('.modal');
        if (modal) decorateDialog(node, modal);
      }
    }
  }).observe(els.modalRoot, { childList: true });
}

function openModal(options) {
  if (options.kind === 'fields') return openFieldsModal(options);
  return openSimpleModal(options);
}

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* first-run check (C5)                                                */
/* ------------------------------------------------------------------ */

/*
 * A fresh machine used to open a window with `pi ?` in the corner and nothing else: the two things
 * that can actually be wrong on a first run (pi not installed / not on the managed path, Strata not
 * reachable) were only visible if you knew to look. The wizard checks both, shows what it found, and
 * fixes the two settings that matter (the Strata address and the working folder). It never installs
 * anything itself - it prints the command instead, because installing a tool from a GUI without being
 * asked is not this app's job.
 */

const PI_INSTALL_COMMAND = 'curl -fsSL https://pi.dev/install.sh | sh';
