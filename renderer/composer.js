'use strict';

/*
 * The composer, the queue and the outbox (#12, step 5): what is typed, what is waiting,
 * what was already sent and can be resent, and the retry behind a failed run.

 * Seventeen functions that were scattered across app.js rather than one block: the
 * boundary is the vocabulary, not the line numbers. Only whole functions moved - a
 * top-level statement that happened to sit below one of them stayed in app.js,
 * because step 2 proved that carried-over state changes what runs and when.

 * Loaded before app.js; nothing here runs at load time.
 */

function renderQueueBar(tab) {
  if (tab !== activeTab()) return; // the bars always describe the visible session
  const steering = (tab && tab.queued.steering) || [];
  const followUp = (tab && tab.queued.followUp) || [];
  const outbox = (tab && tab.outbox) || [];
  els.btnClearQueue.classList.toggle('hidden', !(steering.length || followUp.length));
  if (!steering.length && !followUp.length && !outbox.length) {
    els.queueBar.classList.add('hidden');
    els.queueBar.textContent = '';
    return;
  }
  els.queueBar.classList.remove('hidden');
  els.queueBar.textContent = '';

  const bits = [];
  if (steering.length) bits.push(tr('steering {n}', { n: steering.length }));
  if (followUp.length) bits.push(tr('follow-up {n}', { n: followUp.length }));
  if (outbox.length) bits.push(tr('outbox {n}', { n: outbox.length }));
  const head = el('div', 'qb-head');
  head.appendChild(el('span', 'qb-title', tr('not processed yet ({n})', { n: steering.length + followUp.length + outbox.length })));
  head.appendChild(el('span', 'qb-count', bits.join(' · ')));
  els.queueBar.appendChild(head);

  const addRow = (kind, text, note) => {
    const row = el('div', `qb-item ${kind}`);
    row.appendChild(el('span', 'qb-tag', kind === 'steer' ? tr('steering') : kind === 'follow' ? tr('follow-up') : tr('outbox')));
    const body = el('span', 'qb-text', oneLine(text));
    body.title = String(text);
    row.appendChild(body);
    if (note) row.appendChild(el('span', 'qb-note', note));
    els.queueBar.appendChild(row);
  };

  steering.forEach((text, index) => addRow('steer', text, index === 0 ? tr('next turn') : ''));
  followUp.forEach((text, index) => addRow('follow', text, index === 0 ? tr('after this run') : ''));
  outbox.forEach((item, index) => addRow('outbox', item.text || tr('(attachment only)'), tr('#{n} in serial queue', { n: index + 1 })));
}

// keeps the elapsed counter of the pinned request alive without re-rendering the whole bar
setInterval(() => {
  const bar = els.nowBar;
  if (!bar || bar.classList.contains('hidden') || !bar._req) return;
  paintRequestTime(bar.querySelector('.nb-time'), bar._req);
}, 1000);

function renderComposerState() {
  const tab = activeTab();
  const bashRunning = !!(tab && tab.bashRunning);
  els.btnAbort.classList.toggle('hidden', !(tab && (tab.isStreaming || bashRunning)));
  els.btnAbort.title = bashRunning ? tr('Stop the running bash command (Esc)') : tr('Stop the current run (Esc)');
  if (els.btnCompact) {
    els.btnCompact.disabled = !tab || !tab.alive || !!tab.compacting;
    els.btnCompact.title = tab && tab.compacting ? tr('Compaction in progress…') : tr('Compact the context now');
  }
  els.btnSend.disabled = !tab;
  els.input.disabled = !tab;
  // D8: a dead tab says "press Send to restart" in the placeholder, which is easy to miss and
  // destroys the draft; an explicit Restart does the same thing without touching the composer
  if (els.btnRestart) {
    const dead = !!(tab && !tab.alive && !tab.starting);
    els.btnRestart.classList.toggle('hidden', !dead);
    if (dead) els.btnRestart.title = tr('restart the pi process of this tab (cwd: {cwd})', { cwd: tab.cwd });
  }
  // a retry wait is the only moment "stop retrying" means anything: pi is sitting in the delay
  if (els.btnStopRetry) {
    const waiting = !!(tab && tab.retrying);
    els.btnStopRetry.classList.toggle('hidden', !waiting);
    if (waiting) {
      els.btnStopRetry.title = tr('pi is waiting {ms}ms before attempt {attempt}/{max} (RPC abort_retry)', { ms: tab.retrying.delayMs, attempt: tab.retrying.attempt, max: tab.retrying.maxAttempts });
    }
  }
  if (!tab) {
    els.input.placeholder = tr('Create a session first (Ctrl+T)');
  } else if (!tab.alive) {
    els.input.placeholder = tr('This session process ended \u2014 press Send to restart it in the same folder');
  } else {
    els.input.placeholder = tr('Enter = send \u00b7 Shift+Enter = newline \u00b7 !cmd = run bash \u00b7 / = commands \u00b7 drop or paste files to attach');
  }
  renderCwdChip(tab);
}

function queueRow(tab, position, workingCount) {
  const running = !!tab.isStreaming || scheduler.runningTabId === tab.id;
  const queued = !running && tab.outbox.length > 0;
  const classes = ['qrow', running ? 'running' : queued ? 'queued' : 'idle'];
  if (state.activeId === tab.id) classes.push('active');
  const row = el('div', classes.join(' '));
  row.dataset.tabId = tab.id;
  // D4: the queue is keyboard-reachable and reorderable, not mouse-drag only
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', describeQueueRow(tab, position, workingCount));
  row.setAttribute('aria-describedby', 'queueHelp');
  row.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const index = state.order.indexOf(tab.id);
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= state.order.length) return;
    moveTabTo(tab.id, target);
    const moved = els.queueList.querySelector(`[data-tab-id="${tab.id}"]`);
    if (moved) moved.focus();
  });
  row.draggable = true;
  row.title = `${tab.cwd}\n${tab.sessionPath || tr('unsaved session')}`;
  row.appendChild(el('span', 'qdot'));
  row.appendChild(el('span', 'qtitle', tabLabel(tab)));
  const leaf = pathParts(tab.cwd).leaf;
  if (leaf) {
    const qcwd = el('span', 'qcwd', leaf);
    qcwd.title = tab.cwd;
    row.appendChild(qcwd);
  }
  if (position) row.appendChild(el('span', 'qpos', `#${position}`));
  if (!tab.sessionPath) {
    const badge = el('span', `qbadge ${tab.ephemeral ? 'ephemeral' : 'unsaved'}`, tab.ephemeral ? tr('ephemeral') : tr('unsaved'));
    badge.title = tab.ephemeral
      ? tr('Ephemeral tab: never written to disk, so it will never appear in Session files')
      : tr('No session file yet (pi creates it after the first message), so it is not in Session files');
    row.appendChild(badge);
  }
  if (tab.outbox.length) {
    const badge = el('span', 'qbadge outbox', tr('outbox {n}', { n: tab.outbox.length }));
    badge.title = tr('Messages waiting for this session (click to inspect)');
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      openOutboxModal(tab);
    });
    row.appendChild(badge);
  }
  if (tab.pendingOutbox.length) {
    // B4: restored from the previous run, deliberately not in the outbox, so the queue will not
    // send it by itself
    const badge = el('span', 'qbadge pending', tr('pending {n}', { n: tab.pendingOutbox.length }));
    badge.title = tr('Queued when the app closed - never sent on its own (click to queue or drop)');
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      openPendingOutboxModal(tab);
    });
    row.appendChild(badge);
  }
  const actions = el('div', 'qactions');
  const top = el('button', '', tr('top'));
  top.title = tr('Move to front of the queue');
  top.addEventListener('click', (event) => {
    event.stopPropagation();
    moveTabTo(tab.id, 0);
  });
  const drop = el('button', '', tr('drop'));
  drop.title = tr('Drop queued messages for this session');
  drop.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!tab.outbox.length) {
      toast(tr('nothing queued for this session'));
      return;
    }
    tab.outbox = [];
    scheduleSave();
    renderOpenSessions();
    renderTabs();
    scheduler.pumpSoon(0);
  });
  actions.appendChild(top);
  actions.appendChild(drop);
  row.appendChild(actions);
  row.addEventListener('click', () => activateTab(tab.id));
  wireRowDrag(row, tab.id);
  return row;
}

function openOutboxModal(tab) {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const modal = el('div', 'modal');
    modal.appendChild(el('h3', '', `Queued for: ${tabLabel(tab)}`));
    const list = el('div', 'modal-msg');
    const paint = () => {
      list.textContent = '';
      if (!tab.outbox.length) {
        list.appendChild(el('div', '', 'Nothing queued.'));
        return;
      }
      tab.outbox.forEach((item, index) => {
        const row = el('div', 'outbox-item');
        const text = item.text.length > 400 ? `${item.text.slice(0, 400)}…` : item.text;
        row.appendChild(el('div', 'outbox-text', `#${index + 1}  ${text}`));
        const controls = el('div', 'outbox-controls');
        const front = el('button', 'ghost', 'next');
        front.title = 'Send this one first';
        front.addEventListener('click', () => {
          const [moved] = tab.outbox.splice(index, 1);
          tab.outbox.unshift(moved);
          scheduleSave();
          paint();
          renderOpenSessions();
        });
        const remove = el('button', 'ghost', 'remove');
        remove.addEventListener('click', () => {
          tab.outbox.splice(index, 1);
          scheduleSave();
          paint();
          renderOpenSessions();
          renderTabs();
        });
        controls.appendChild(front);
        controls.appendChild(remove);
        row.appendChild(controls);
        list.appendChild(row);
      });
    };
    paint();
    modal.appendChild(list);
    const actions = el('div', 'modal-actions');
    const close = el('button', 'primary', 'Close');
    actions.appendChild(close);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);
    const finish = () => {
      backdrop.remove();
      modalOpen = null;
      resolve();
    };
    modalOpen = { finish, backdrop };
    close.addEventListener('click', finish);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish();
    });
  });
}

/**
 * B4: the outbox used to be memory-only, so a restart silently dropped whatever was waiting.
 * It is now stored in the settings file and comes back as "pending": visible, but never sent
 * until the user moves it into the queue (an auto-send after a crash would fire model requests
 * nobody asked for).
 */
function restorePendingOutbox(entry, tab) {
  const restored = [];
  for (const source of [entry.pendingOutbox, entry.outbox]) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      if (!item || typeof item.text !== 'string' || !item.text.trim()) continue;
      restored.push({ text: item.text, at: item.at || 0, images: Array.isArray(item.images) ? item.images : [], restored: true });
    }
  }
  if (!restored.length) return 0;
  tab.pendingOutbox = restored;
  const dropped = Number(entry.outboxImagesDropped || 0) + Number(entry.pendingImagesDropped || 0);
  pushNote(
    tab,
    restored.length === 1
      ? '{count} queued message from the previous run is held back and will NOT be sent on its own. Open the **pending** badge in the queue row to send it or drop it.'
      : '{count} queued messages from the previous run are held back and will NOT be sent on their own. Open the **pending** badge in the queue row to send them or drop them.',
    'warn',
    { count: restored.length },
  );
  if (dropped) {
    // #45: the dropped-image note used to be spliced onto the sentence above, which made both halves
    // impossible to translate as a unit. It is its own note now.
    pushNote(
      tab,
      dropped === 1
        ? '{count} message had an image too large to store; it was dropped.'
        : '{count} messages had images too large to store; they were dropped.',
      'warn',
      { count: dropped },
    );
  }
  return restored.length;
}

function openPendingOutboxModal(tab) {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const modal = el('div', 'modal');
    modal.appendChild(el('h3', '', `Pending from the previous run: ${tabLabel(tab)}`));
    const intro = el('div', 'modal-msg', 'These were still in the outbox when the app closed. Nothing is sent until you queue it.');
    modal.appendChild(intro);
    const list = el('div', 'modal-msg');
    const paint = () => {
      list.textContent = '';
      if (!tab.pendingOutbox.length) {
        list.appendChild(el('div', '', 'Nothing pending.'));
        return;
      }
      tab.pendingOutbox.forEach((item, index) => {
        const row = el('div', 'outbox-item');
        row.appendChild(el('div', 'outbox-text', `#${index + 1}  ${item.text.length > 400 ? `${item.text.slice(0, 400)}\u2026` : item.text}`));
        const controls = el('div', 'outbox-controls');
        const queue = el('button', 'ghost', 'queue it');
        queue.title = 'move this into the outbox: the serial queue will send it in turn';
        queue.addEventListener('click', () => {
          const [moved] = tab.pendingOutbox.splice(index, 1);
          tab.outbox.push(moved);
          scheduleSave();
          scheduler.pumpSoon(0);
          paint();
          renderOpenSessions();
        });
        const remove = el('button', 'ghost', 'drop');
        remove.addEventListener('click', () => {
          tab.pendingOutbox.splice(index, 1);
          scheduleSave();
          paint();
          renderOpenSessions();
        });
        controls.appendChild(queue);
        controls.appendChild(remove);
        row.appendChild(controls);
        list.appendChild(row);
      });
    };
    paint();
    modal.appendChild(list);
    const actions = el('div', 'modal-actions');
    const queueAll = el('button', '', 'queue all');
    queueAll.addEventListener('click', () => {
      if (!tab.pendingOutbox.length) return;
      tab.outbox.push(...tab.pendingOutbox);
      tab.pendingOutbox = [];
      scheduleSave();
      scheduler.pumpSoon(0);
      paint();
      renderOpenSessions();
    });
    const dropAll = el('button', 'ghost', 'drop all');
    dropAll.addEventListener('click', () => {
      tab.pendingOutbox = [];
      scheduleSave();
      paint();
      renderOpenSessions();
    });
    const close = el('button', 'primary', 'Close');
    actions.appendChild(queueAll);
    actions.appendChild(dropAll);
    actions.appendChild(close);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);
    const finish = () => {
      backdrop.remove();
      modalOpen = null;
      resolve();
    };
    modalOpen = { finish, backdrop };
    close.addEventListener('click', finish);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish();
    });
  });
}

/* drag & drop reordering of open sessions --------------------------- */


// A session that was idle but just got a message joins the BACK of the working
// queue, so it cannot cut in front of sessions that were queued earlier.
function queueBackOfWorking(tab) {
  if (!scheduler.enabled) return false;
  const working = state.order.map((id) => state.tabs.get(id)).filter((other) => other && other.id !== tab.id && isWorking(other));
  if (!working.length) return false;
  const last = working[working.length - 1];
  if (state.order.indexOf(tab.id) > state.order.indexOf(last.id)) return false;
  return moveTabBefore(tab.id, last.id, true, { silent: true });
}

/**
 * A short description a screen reader can read for a queue row (the visual state is colour only).
 * `position` is 0 for an idle row; `workingCount` is how many rows are in the working group, i.e.
 * what a position counts out of. The local is called `status`, never `state`: a local named `state`
 * hides the module-level `state` (the one holding `order`), and that typo took the whole queue out.
 */
function describeQueueRow(tab, position, workingCount) {
  const running = !!tab.isStreaming || scheduler.runningTabId === tab.id;
  const status = running ? tr('running') : tab.outbox.length ? tr('queued, {n} pending', { n: tab.outbox.length }) : tr('idle');
  const order = position ? tr('queue position {n} of {total}', { n: position, total: workingCount }) : tr('not in the queue');
  return `${tabLabel(tab)}, ${status}, ${order}. ${tr('Alt+Up or Alt+Down reorders it.')}`;
}

function clearComposer() {
  els.input.value = '';
  const tab = activeTab();
  if (tab) {
    tab.attachments = [];
    tab.images = [];
    tab.inlines = [];
  }
  renderAttachments();
}

/* ------------------------------------------------------------------ */
/* bash mode: `!cmd` runs in the session folder, `!!cmd` also keeps    */
/* the output out of the model context (same prefixes as pi's own TUI) */
/* ------------------------------------------------------------------ */

// pi's bash executor has no timeout of its own: it runs until the command exits or the
// user aborts it (Esc -> abort_bash), so the RPC must not give up early.

async function abortBash(tab) {
  const res = await api.cmd(tab.id, 'abort_bash');
  if (!res.success) toast(res.error || 'abort_bash failed', 'error');
  else toast('stopping the bash command…');
}

/* ------------------------------------------------------------------ */
/* slash commands: what the GUI runs itself; everything else is handed */
/* to pi, which expands extension commands, prompt templates, skills   */
/* ------------------------------------------------------------------ */

const GUI_COMMANDS = [
  { name: 'compact', args: '[instructions]', desc: 'compact this context (asks first if the session is running)' },
  { name: 'export', args: '[path]', desc: 'save this session as HTML' },
  { name: 'model', args: '[provider/id]', desc: 'pick a model, or set one by name' },
  { name: 'thinking', args: '[level]', desc: 'show or set the thinking level' },
  { name: 'new', args: '', desc: 'start a new session in this tab' },
  { name: 'clear', args: '', desc: 'same as /new' },
  { name: 'rename', args: '<name>', desc: 'name this session' },
  { name: 'abort', args: '', desc: 'stop the current run or bash command' },
  { name: 'resume', args: '', desc: 'search past sessions in the sidebar' },
  { name: 'monitor', args: '', desc: 'toggle the Strata monitor' },
  { name: 'stats', args: '', desc: 'print tokens, cost and context usage' },
  { name: 'retry', args: '[on|off|stop]', desc: 'retry transient model errors: on/off for this session, stop cancels a retry that is waiting' },
  { name: 'setup', args: '', desc: 'first-run check: is pi installed, is Strata reachable, which folder do new tabs start in' },
  { name: 'tree', args: '', desc: 'show the session tree: branches, abandoned branches, fork from an earlier prompt, clone the branch' },
  { name: 'jobs', args: '', desc: 'scheduled prompts: list, add, edit, run now (cron in the main process, prompts through the serial queue)' },
  { name: 'usage', args: '', desc: 'tokens used per day / week / month / year (in, out, cache), kept in a ledger that survives session deletion' },
  { name: 'settings', args: '', desc: 'open the settings dialog (working folder, serial queue, Strata address, Monitor, paths)' },
  { name: 'diagnostics', args: '', desc: 'copy a diagnostics report (versions, paths, Strata health, log tail, queue) for a bug report' },
  { name: 'commands', args: '', desc: 'list the slash commands available here' },
  { name: 'help', args: '', desc: 'show this list' },
];

async function send() {
  const tab = activeTab();
  if (!tab) {
    toast('no active session', 'warning');
    return;
  }
  if (!tab.alive && !(await respawnTab(tab))) return;

  // `!cmd` / `!!cmd` and the GUI's own slash commands never reach the model directly
  closeSlashMenu();
  const raw = els.input.value.trim();
  const hasExtras = tab.attachments.length || tab.images.length || tab.inlines.length;
  if (!hasExtras) {
    const bash = parseBashInput(raw);
    if (bash) {
      clearComposer();
      await runBash(tab, bash);
      return;
    }
    if (raw.startsWith('/') && (await runSlashCommand(tab, raw))) return;
  }

  const message = collectMessage(tab);
  if (!message) return;

  // This session is already running: use pi's own in-session queue.
  if (tab.isStreaming) {
    const type = els.busySel.value === 'followUp' ? 'follow_up' : 'steer';
    const payload = { message: message.text };
    if (message.images.length) payload.images = message.images;
    const res = await api.cmd(tab.id, type, payload);
    if (!res.success) {
      toast(res.error || `${type} failed`, 'error');
      return;
    }
    clearComposer();
    // pi will echo this back as a user message once it delivers it: remember the kind so the
    // pinned top bar can label it, and the bottom bar already lists it from queue_update
    tab.pendingQueued.push({ text: message.text, source: type });
    if (res.data && res.data.disposition === 'queued') toast(`queued as ${type === 'steer' ? 'steering' : 'follow-up'} in this session`);
    return;
  }

  // Serial mode: another session owns the single-flight provider, or this
  // session already has pending work -> keep FIFO inside the session outbox.
  const otherRunning = scheduler.enabled && scheduler.runningTabId && scheduler.runningTabId !== tab.id;
  if (tab.outbox.length || otherRunning || tab.compacting) {
    tab.outbox.push(message);
    scheduleSave(); // B4: a queued message must survive a crash, as "pending"
    const moved = queueBackOfWorking(tab);
    clearComposer();
    renderTabs();
    renderOpenSessions();
    const position = scheduler.workingPosition(tab.id);
    toast(position ? `queued: ${tabLabel(tab)} at #${position} in the working queue${moved ? ' (back of the line)' : ''}` : 'queued for this session');
    scheduler.pumpSoon(0);
    return;
  }

  clearComposer();
  scheduler.runningTabId = tab.id;
  tab.isStreaming = true;
  renderTabs();
  renderOpenSessions();
  renderComposerState();
  const result = await deliverPrompt(tab, message);
  if (!result.ok) {
    tab.isStreaming = false;
    scheduler.runningTabId = null;
    els.input.value = message.text;
    scheduler.pumpSoon(0);
  }
  renderTabs();
  renderOpenSessions();
}

/**
 * Resend = put the original text back into the composer and call send(), so attachments,
 * busy mode (steer/follow_up) and the serial queue behave exactly as for a normal send.
 * Never call api.cmd('prompt') from here: that would break the single-flight guarantee.
 * The original images are not re-attached (their base64 blobs may be gone from memory).
 */
async function resendMessage(tab, item) {
  const text = contentToText(item.message.content);
  if (!text) {
    toast('this message has no text to resend', 'warning');
    return;
  }
  if (els.input.value.trim()) {
    const answer = await openModal({
      kind: 'input',
      title: 'Resend this message',
      message: 'The composer already has text. Replace it with the original message (edit it here first if you want), or cancel to keep your draft.',
      prefill: text,
      okLabel: 'Replace and send',
    });
    if (!answer || answer.cancelled) return;
    if (!(answer.value || '').trim()) {
      toast('nothing to resend', 'warning');
      return;
    }
    els.input.value = answer.value;
  } else {
    els.input.value = text;
  }
  els.input.dispatchEvent(new Event('input'));
  await send();
}

async function abortRun() {
  const tab = activeTab();
  if (!tab) return;
  await api.cmd(tab.id, 'abort');
}

async function clearQueue() {
  const tab = activeTab();
  if (!tab) return;
  const res = await api.cmd(tab.id, 'clear_queue');
  if (!res.success) return;
  const parts = [...(res.data.steering || []), ...(res.data.followUp || [])];
  if (parts.length) els.input.value = `${els.input.value}${els.input.value ? '\n' : ''}${parts.join('\n')}`;
}

/**
 * `/retry on|off` only: there is no auto-retry switch in the composer any more, and bootstrap()
 * turns it on with every (re)start, so this is the escape hatch for one bad stretch in one session.
 * `set_auto_retry` is per session (like auto-compaction) and get_state does not report the current
 * value, so tab.autoRetry is just what the GUI last asked for.
 */
async function setAutoRetry(tab, enabled) {
  const res = await api.cmd(tab.id, 'set_auto_retry', { enabled });
  if (!res.success) {
    toast(res.error || 'set_auto_retry failed', 'error');
    renderComposerState();
    return false;
  }
  tab.autoRetry = enabled;
  toast(`auto-retry ${enabled ? 'on' : 'off'} \u00b7 ${tabLabel(tab)}`);
  renderComposerState();
  return true;
}

/** Cancel the delay of a running retry and stop retrying (the request then fails normally). */
async function abortRetry(tab) {
  const res = await api.cmd(tab.id, 'abort_retry');
  if (!res.success) {
    toast(res.error || 'abort_retry failed', 'error');
    return;
  }
  pushNote(tab, 'retry stopped (abort_retry): the request will fail instead of retrying', 'warn');
  toast('retry stopped', 'info');
  // pi does not emit a matching auto_retry_end for an aborted retry
  tab.retrying = null;
  renderComposerState();
}

/* ------------------------------------------------------------------ */
/* /export — session -> HTML via pi's export_html RPC                  */
/* ------------------------------------------------------------------ */

// export_html never calls the model, but pi re-reads the whole session JSONL and rewrites
// it as HTML (the same cost as the JSONL rewrite during compaction: minutes for an 86 MB
// session), so give the RPC the same grace period as compaction.

function persistedOutbox(tab) {
  const pack = (list) => {
    const items = (list || []).map((item) => ({ text: item.text, at: item.at || 0, source: item.source || '' }));
    const size = items.reduce((sum, item) => sum + (item.text || '').length, 0);
    const images = (list || []).map((item) => (item.images || []).length);
    const withImages = (list || []).map((item) => ({ text: item.text, at: item.at || 0, source: item.source || '', images: item.images || [] }));
    const imageBytes = withImages.reduce((sum, item) => sum + item.images.reduce((s, image) => s + (image.data || '').length, 0), 0);
    if (imageBytes && size + imageBytes > OUTBOX_IMAGE_BUDGET) {
      return { items, imagesDropped: images.filter((n) => n > 0).length };
    }
    return { items: withImages };
  };
  const outbox = pack(tab.outbox);
  const pending = pack(tab.pendingOutbox);
  const entry = {};
  if (outbox.items.length) entry.outbox = outbox.items;
  if (outbox.imagesDropped) entry.outboxImagesDropped = outbox.imagesDropped;
  if (pending.items.length) entry.pendingOutbox = pending.items;
  if (pending.imagesDropped) entry.pendingImagesDropped = pending.imagesDropped;
  return entry;
}

async function refreshSlashMenu() {
  const query = slashQuery();
  if (query === null) {
    closeSlashMenu();
    return;
  }
  const tab = activeTab();
  if (tab && tab.alive && !tab.commandsLoaded) {
    await loadCommands(tab);
    if (slashQuery() !== query) return; // the user kept typing while pi answered
  }
  const catalog = slashCatalog(tab);
  const matches = catalog
    .filter((c) => {
      if (!query) return true;
      const n = c.name.toLowerCase();
      return n.startsWith(query) || n.includes(query) || (c.desc || '').toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const rank = (c) => (c.name.toLowerCase().startsWith(query) ? 0 : 1);
      return rank(a) - rank(b) || a.name.length - b.name.length;
    })
    .slice(0, 12);
  if (!matches.length) {
    closeSlashMenu();
    return;
  }
  slashMenu.items = matches;
  slashMenu.index = 0;
  slashMenu.open = true;
  els.slashMenu.classList.remove('hidden');
  els.slashMenu.textContent = '';
  matches.forEach((item, index) => {
    const row = el('div', `slash-item${index === 0 ? ' active' : ''}`);
    row.appendChild(el('span', 'slash-name', `/${item.name}${item.args ? ` ${item.args}` : ''}`));
    if (item.desc) row.appendChild(el('span', 'slash-desc', item.desc));
    row.appendChild(el('span', 'slash-src', item.source));
    row.addEventListener('mousedown', (event) => {
      event.preventDefault(); // keep the caret in the textarea
      acceptSlashItem(item);
    });
    els.slashMenu.appendChild(row);
  });
}

async function refreshPathMenu() {
  const query = atQuery();
  if (!query) {
    if (pathMenu.open) closePathMenu();
    return;
  }
  const tab = activeTab();
  if (!tab) return;
  const request = ++pathMenu.requestId;
  const res = await api.fsComplete({ cwd: tab.cwd, fragment: query.fragment });
  if (request !== pathMenu.requestId) return; // a faster typist won
  const fresh = atQuery();
  if (!fresh || fresh.fragment !== query.fragment) return; // the caret moved while the list was built
  if (!res.ok || !res.entries.length) {
    closePathMenu();
    return;
  }
  pathMenu.items = res.entries;
  pathMenu.index = 0;
  pathMenu.open = true;
  els.slashMenu.classList.remove('hidden');
  els.slashMenu.textContent = '';
  res.entries.forEach((entry, index) => {
    const row = el('div', `slash-item${index === 0 ? ' active' : ''}`);
    row.appendChild(el('span', 'slash-name', `@${entry.path}${entry.isDirectory ? '/' : ''}`));
    row.appendChild(el('span', 'slash-desc', entry.isDirectory ? 'folder' : 'file'));
    row.appendChild(el('span', 'slash-src', res.total > res.entries.length ? `${res.entries.length} of ${res.total}` : tab.cwd.split(/[\/]/).pop() || ''));
    row.addEventListener('mousedown', (event) => {
      event.preventDefault(); // keep the caret in the textarea
      acceptPathItem(entry);
    });
    els.slashMenu.appendChild(row);
  });
}
