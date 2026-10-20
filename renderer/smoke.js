/* Smoke scenarios - test scaffolding, not product code (#12).

   These ~1 000 lines used to be the tail of renderer/app.js. Two problems: every user parsed them on
   startup, and the file that holds the real UI code grew past 8 500 lines, which is how a reviewer
   lost the ability to tell a real defect from a scenario. They live here now, and app.js only fetches
   this file when the app is actually started with STRATAPILOT_SMOKE=1 - a normal launch never loads
   or parses it.

   This is a classic script, NOT a module: it reads app.js's top-level bindings (state, els, api, tr,
   el, toast, send, activeTab, ...) out of the shared global scope. That works only because app.js
   loads it after app.js has finished its top level. Keep it a classic script, and keep it lazy.
*/

async function runSmokeScenarios() {

if (state.info.smoke && state.info.smokeSession) {
  const res = await api.sessionsRead(state.info.smokeSession);
  if (!res.ok) {
    console.error(`[smoke] session read failed: ${res.error}`);
  } else {
    await switchCurrentTabTo(res.meta);
    const tab = activeTab();
    const actions = els.transcript.querySelectorAll('[data-msg-action]');
    const copies = els.transcript.querySelectorAll('[data-msg-action="copy"]').length;
    const resends = els.transcript.querySelectorAll('[data-msg-action="resend"]:not([disabled])').length;
    const moreBtn = els.transcript.querySelector('.transcript-more button');
    const windowed = tab ? tab.nodes.size : 0;
    if (moreBtn) moreBtn.click();
    const afterMore = tab ? tab.nodes.size : 0;
    console.log(
      `[smoke] switched session; rendered items=${tab ? tab.items.length : 0} msg_actions=${actions.length} copy=${copies} resend=${resends}`,
    );
    console.log(
      `[smoke-window] nodes=${windowed} of ${tab ? tab.items.length : 0} renderFrom=${tab ? tab.renderFrom : 0} more_button=${!!moreBtn} after_click=${afterMore} scrolled=${els.transcript.scrollTop > 0}`,
    );
    // token chips must read "in N / out M", never a single blended total
    const tokChips = [...els.transcript.querySelectorAll('.msg-head span[title]')]
      .map((n) => n.textContent)
      .filter((t) => t.startsWith('in '));
    const barChip = [...els.stats.querySelectorAll('span[title]')]
      .map((n) => n.textContent)
      .find((t) => t.startsWith('tok '));
    console.log(
      `[smoke-tokens] bar=${JSON.stringify(barChip || '')} message_chips=${tokChips.length} first=${JSON.stringify(tokChips[0] || '')} tooltip=${JSON.stringify((tokChips[0] ? els.transcript.querySelector('.msg-head span[title]').title : '').replace(/\n/g, '|'))}`,
    );
  }
}

if (state.info.smoke) {
  // Verify the preload bridge for dropped/selected files (webUtils.getPathForFile).
  try {
    const probe = new File(['hello'], 'probe.txt', { type: 'text/plain' });
    const resolved = api.pathForFile(probe);
    console.log(`[smoke] pathForFile probe -> ${JSON.stringify(resolved)}`);
    await addFiles([probe]);
    const tab = activeTab();
    console.log(`[smoke] addFiles fallback inlines=${tab ? tab.inlines.length : 0} attachments=${tab ? tab.attachments.length : 0}`);
    if (tab) {
      tab.inlines = [];
      tab.attachments = [];
      renderAttachments();
    }
  } catch (err) {
    console.error(`[smoke] file bridge failed: ${err.message}`);
  }
}

applyMonitorWidth();
if (state.info.smoke) {
  if (state.info.smokeMonitor) openMonitor();
} else if (state.settings.monitorOpen !== false) {
  openMonitor();
}

if (state.info.smoke && state.info.smokeQueue) {
  setTimeout(() => smokeQueueScenario().catch((err) => console.error('[smoke] queue scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokeCompact) {
  setTimeout(() => smokeCompactScenario().catch((err) => console.error('[smoke] compact scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokeOrder) {
  setTimeout(() => smokeOrderScenario().catch((err) => console.error('[smoke] order scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokeAutoCompact) {
  setTimeout(() => smokeAutoCompactScenario().catch((err) => console.error('[smoke] auto-compact scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokeBash) {
  setTimeout(() => smokeBashScenario().catch((err) => console.error('[smoke] bash scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokeBars) {
  setTimeout(() => smokeBarsScenario().catch((err) => console.error('[smoke] bars scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokePaste) {
  setTimeout(() => smokePasteScenario().catch((err) => console.error('[smoke] paste scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokeCopy) {
  setTimeout(() => smokeCopyScenario().catch((err) => console.error('[smoke] copy scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokeExport) {
  setTimeout(() => smokeExportScenario().catch((err) => console.error('[smoke] export scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokeSetup) {
  setTimeout(() => smokeSetupScenario().catch((err) => console.error('[smoke] setup scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeFork) {
  setTimeout(() => smokeForkScenario().catch((err) => console.error('[smoke] fork scenario failed', err)), 2500);
}

if (state.info.smoke && state.info.smokeTree) {
  setTimeout(() => smokeTreeScenario().catch((err) => console.error('[smoke] tree scenario failed', err)), 2500);
}

if (state.info.smoke && state.info.smokePath) {
  setTimeout(() => smokePathScenario().catch((err) => console.error('[smoke] path scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeServers) {
  setTimeout(() => smokeServersScenario().catch((err) => console.error('[smoke] servers scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeStorage) {
  setTimeout(() => smokeStorageScenario().catch((err) => console.error('[smoke] storage scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeUsage) {
  setTimeout(() => smokeUsageScenario().catch((err) => console.error('[smoke] usage scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeI18n) {
  setTimeout(() => smokeI18nScenario().catch((err) => console.error('[smoke] i18n scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeA11y) {
  setTimeout(() => smokeA11yScenario().catch((err) => console.error('[smoke] a11y scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeTheme) {
  setTimeout(() => smokeThemeScenario().catch((err) => console.error('[smoke] theme scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeTabTag) {
  setTimeout(() => smokeTabTagScenario().catch((err) => console.error('[smoke] tab tag scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeCron) {
  setTimeout(() => smokeCronScenario().catch((err) => console.error('[smoke] cron scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeOutbox) {
  setTimeout(() => smokeOutboxScenario().catch((err) => console.error('[smoke] outbox scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeRetry) {
  setTimeout(() => smokeRetryScenario().catch((err) => console.error('[smoke] retry scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokeSettings) {
  setTimeout(() => smokeSettingsScenario().catch((err) => console.error('[smoke] settings scenario failed', err)), 1200);
}

if (state.info.smoke && state.info.smokeDiag) {
  setTimeout(() => smokeDiagScenario().catch((err) => console.error('[smoke] diagnostics scenario failed', err)), 1500);
}

if (state.info.smoke && state.info.smokePrompt) {
  els.input.value = state.info.smokePrompt;
  setTimeout(() => {
    send().catch((err) => console.error('[smoke] send failed', err));
  }, 800);
  if (state.info.smokeSteer) {
    setTimeout(() => {
      els.input.value = 'Ignore the previous instruction and reply with exactly: STEER-OK';
      send()
        .then(() => console.log('[smoke] second message sent (busy path)'))
        .catch((err) => console.error('[smoke] steer send failed', err));
    }, 2000);
  }
}
}


/**
 * STRATAPILOT_SMOKE_AUTO_COMPACT=1: auto-compaction is always on. bootstrap() must have left the
 * session with it on, and ensureAlwaysOn() must put it back after pi turned it off (which is what a
 * `"compaction": { "enabled": false }` in ~/.pi/agent/settings.json would hand the tab). The
 * scenario ends with it on, because the composer has no switch that could put it back.
 */
async function smokeAutoCompactScenario() {
  const tab = activeTab();
  const boot = await api.cmd(tab.id, 'get_state');
  const off = await api.cmd(tab.id, 'set_auto_compaction', { enabled: false });
  const afterOff = await api.cmd(tab.id, 'get_state');
  tab.autoCompact = afterOff.success ? afterOff.data.autoCompactionEnabled !== false : true;
  await ensureAlwaysOn(tab);
  const afterOn = await api.cmd(tab.id, 'get_state');
  console.log(
    `[smoke-autocompact] boot=${boot.success ? boot.data.autoCompactionEnabled : 'n/a'} setOff=${off.success} now=${afterOff.success && afterOff.data.autoCompactionEnabled} ensureOn=${afterOn.success && afterOn.data.autoCompactionEnabled} tab.autoCompact=${tab.autoCompact}`,
  );
}

/**
 * `!cmd` / `!!cmd` and the slash palette: the bash card must stream its output,
 * settle with the right status, and `/commands` must land as a note.
 */
async function smokeBashScenario() {
  const tab = activeTab();
  if (!tab) {
    console.log('[smoke-bash] no active tab');
    return;
  }
  els.input.value = '!echo pi-bash-ok && echo second-line';
  await send();
  const cardText = (card) => (card ? (card.querySelector('.bash-out') || {}).textContent : '');
  const cards = () => [...els.transcript.querySelectorAll('.bash-card')];
  console.log(`[smoke-bash] after run: cards=${cards().length} class=${cards().map((c) => c.className).join('|')} bashRunning=${tab.bashRunning} output=${JSON.stringify(cardText(cards()[cards().length - 1]))}`);

  els.input.value = '!!echo excluded-from-context';
  await send();
  const last = cards()[cards().length - 1];
  console.log(`[smoke-bash] !! card: sign=${last && last.querySelector('.bash-sign').textContent} foot=${last && JSON.stringify((last.querySelector('.bash-foot') || {}).textContent)}`);

  els.input.value = '!exit 3';
  await send();
  const failing = cards()[cards().length - 1];
  console.log(`[smoke-bash] exit 3: class=${failing && failing.className} foot=${failing && JSON.stringify((failing.querySelector('.bash-foot') || {}).textContent)}`);

  els.input.value = '/commands';
  await send();
  const notes = [...els.transcript.querySelectorAll('.note')];
  const help = notes[notes.length - 1];
  console.log(`[smoke-bash] /commands note lines=${help ? help.textContent.split('\n').length : 0}`);

  // palette: typing a partial command word must open the list, Tab completes it
  els.input.value = '/co';
  els.input.dispatchEvent(new Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const rows = [...els.slashMenu.children];
  console.log(`[smoke-bash] palette "/co": open=${slashMenu.open} rows=${rows.length} first=${rows[0] ? JSON.stringify(rows[0].textContent) : ''}`);
  els.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  console.log(`[smoke-bash] after Tab: value=${JSON.stringify(els.input.value)} menuOpen=${slashMenu.open}`);
  els.input.value = '';
  els.input.dispatchEvent(new Event('input'));

  console.log(`[smoke-bash] composer empty=${els.input.value === ''} items=${tab.items.length} bashItems=${tab.items.filter((i) => i.kind === 'bash').length}`);
}

async function smokeOrderScenario() {
  const a = activeTab();
  const b = await createTab({ cwd: state.cwd, ephemeral: true });
  const c = await createTab({ cwd: state.cwd, ephemeral: true });
  const tag = (tab) => (tab === a ? 'A' : tab === b ? 'B' : 'C');
  const snap = () =>
    state.order
      .map((id) => {
        const tab = state.tabs.get(id);
        return `${tag(tab)}:${isWorking(tab) ? 'W' : 'I'}${tab.outbox.length ? `(${tab.outbox.length})` : ''}`;
      })
      .join(' ');
  activateTab(b.id);
  els.input.value = 'List the numbers 1 to 250, one per line, with no other text. Do not use tools.';
  await send();
  activateTab(c.id);
  els.input.value = 'Reply with exactly: C-OK';
  await send();
  activateTab(a.id);
  els.input.value = 'Reply with exactly: A-OK';
  await send();
  console.log(`[smoke-order] after-sends: ${snap()} (expect B C A, all W)`);
  let ticks = 0;
  const interval = setInterval(() => {
    ticks++;
    const running = state.order.map((id) => state.tabs.get(id)).find((tab) => tab.isStreaming);
    console.log(`[smoke-order] t=${ticks * 3}s running=${running ? tag(running) : 'none'} ${snap()}`);
    if (ticks >= 20) clearInterval(interval);
  }, 3000);
}

async function smokeCompactScenario() {
  els.input.value = 'List the numbers 1 to 400, one per line, with no other text. Do not use tools.';
  send().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 9000));
  const tab = activeTab();
  tab.pendingCompact = 'smoke instruction';
  console.log(`[smoke-compact] t=9s busy=${tab.isStreaming} queued=true (compaction should only run after agent_settled)`);
  let ticks = 0;
  const interval = setInterval(() => {
    ticks++;
    console.log(`[smoke-compact] t=${9 + ticks * 3}s streaming=${tab.isStreaming} pending=${tab.pendingCompact != null} compacting=${!!tab.compacting}`);
    if (ticks >= 24) clearInterval(interval);
  }, 3000);
}

async function smokeQueueScenario() {
  const first = activeTab();
  els.input.value = 'List the numbers 1 to 250, one per line, with no other text. Do not use tools.';
  await send();
  const second = await createTab({ cwd: state.cwd, ephemeral: true });
  els.input.value = 'Reply with exactly: SECOND-OK';
  await send();
  const third = await createTab({ cwd: state.cwd, ephemeral: true });
  els.input.value = 'Reply with exactly: THIRD-OK';
  await send();
  const fourth = await createTab({ cwd: state.cwd, ephemeral: true });
  console.log(
    `[smoke-queue] sent: first.streaming=${first.isStreaming} second.outbox=${second.outbox.length} third.outbox=${third.outbox.length} fourth.working=${isWorking(fourth)} running=${scheduler.runningTabId === first.id ? 'first' : 'other'}`,
  );
  let ticks = 0;
  const interval = setInterval(() => {
    ticks++;
    const running = scheduler.runningTabId === first.id ? 'first' : scheduler.runningTabId === second.id ? 'second' : scheduler.runningTabId === third.id ? 'third' : 'none';
    const groups = state.order.map((id) => (isWorking(state.tabs.get(id)) ? 'W' : 'I')).join('');
    console.log(
      `[smoke-queue] t=${ticks * 2}s running=${running} first(s=${first.isStreaming},q=${first.outbox.length}) second(s=${second.isStreaming},q=${second.outbox.length}) third(s=${third.isStreaming},q=${third.outbox.length}) groups=${groups}`,
    );
    if (ticks >= 20) clearInterval(interval);
  }, 2000);
}

// The two pinned bars: the request being worked on stays pinned on top of the chat, the steering
// message waits at the bottom, and once pi delivers it that message becomes the pinned one.
async function smokeBarsScenario() {
  const tab = activeTab();
  const snap = (label) => {
    const top = els.nowBar.classList.contains('hidden') ? '(hidden)' : els.nowBar.textContent.replace(/\s+/g, ' ').trim();
    const bottom = els.queueBar.classList.contains('hidden') ? '(hidden)' : els.queueBar.textContent.replace(/\s+/g, ' ').trim();
    console.log(`[smoke-bars] ${label}: top="${top}" bottom="${bottom}"`);
  };

  els.input.value = 'List the numbers 1 to 150, one per line, with no other text. Do not use tools.';
  await send();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  els.input.value = 'Ignore the previous instruction and reply with exactly: STEER-OK';
  await send(); // busy path -> steer, so it must show up in the bottom bar
  snap('busy+steer');

  let ticks = 0;
  const interval = setInterval(() => {
    ticks++;
    snap(`t=${2.5 + ticks * 3}s streaming=${tab.isStreaming} steerQueue=${tab.queued.steering.length} src=${tab.currentRequest && tab.currentRequest.source}`);
    if (ticks === 5) {
      clearInterval(interval);
      const jump = els.nowBar.querySelector('.nb-jump');
      const node = tab.currentRequest ? tab.nodes.get(tab.currentRequest.key) : null;
      els.transcript.scrollTop = els.transcript.scrollHeight;
      if (jump) jump.click();
      setTimeout(() => {
        console.log(
          `[smoke-bars] jump: present=${!!jump} node=${!!node} flashed=${!!(node && node.classList.contains('flash'))} scrollTop=${els.transcript.scrollTop}/${els.transcript.scrollHeight - els.transcript.clientHeight}`,
        );
        snap('after-jump');
      }, 400);
    }
  }, 3000);
}

// STRATAPILOT_SMOKE_COPY=1 — the per-message hover actions. `copy` must hand over the raw markdown
// source (never innerHTML), and `resend` must go through send(): while another tab owns the
// single-flight provider the resent text has to land in this tab's outbox, not reach the model.
async function smokeCopyScenario() {
  const tab = activeTab();
  const prompt = 'Reply with exactly: COPY-OK';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (fn, ms = 30000) => {
    for (let i = 0; i < Math.ceil(ms / 250) && !fn(); i++) await sleep(250);
    return fn();
  };
  // capture what copy puts on the clipboard (reading the real clipboard needs focus + permission)
  const copied = [];
  const realWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
  navigator.clipboard.writeText = (value) => {
    copied.push(value);
    return Promise.resolve();
  };
  const button = (key, action) => {
    const node = tab.nodes.get(key);
    return node && node.querySelector(`[data-msg-action="${action}"][data-key="${key}"]`);
  };
  const snap = () =>
    state.order
      .map((id) => {
        const t = state.tabs.get(id);
        return `${id === tab.id ? 'A' : 'B'}:${isWorking(t) ? 'W' : 'I'}${t.outbox.length ? `(${t.outbox.length})` : ''}`;
      })
      .join(' ');

  try {
    els.input.value = prompt;
    await send();
    await waitFor(() => !tab.isStreaming);

    // another tab takes the single-flight provider, so a resend here must be queued
    const other = await createTab({ cwd: state.cwd, ephemeral: true });
    els.input.value = 'List the numbers 1 to 250, one per line, with no other text. Do not use tools.';
    await send();
    activateTab(tab.id);

    const userItem = tab.items.find((it) => it.kind === 'message' && it.message.role === 'user');
    const asstItem = [...tab.items].reverse().find((it) => it.kind === 'message' && it.message.role === 'assistant');
    if (!userItem || !asstItem) {
      console.log(`[smoke-copy] skipped: another smoke scenario took this tab over, so the copy targets are gone (user=${!!userItem} assistant=${!!asstItem})`);
      return;
    }
    const userKey = userItem.key;
    const asstKey = asstItem.key;

    const copyBtn = button(userKey, 'copy');
    if (copyBtn) copyBtn.click();
    await waitFor(() => copied.length >= 1, 3000);
    const labelCopied = !!copyBtn && copyBtn.textContent === 'copied';

    const asstBtn = button(asstKey, 'copy');
    if (asstBtn) asstBtn.click();
    await waitFor(() => copied.length >= 2, 3000);

    const resendBtn = button(userKey, 'resend');
    if (resendBtn) resendBtn.click();
    await waitFor(() => tab.outbox.length > 0 || tab.isStreaming, 5000);
    const composer = els.input.value;
    const queued = tab.outbox.length;

    console.log(
      `[smoke-copy] copy_ok=${copied[0] === prompt} resend_ok=${composer === '' && queued >= 1} composer="${composer}" queued=${queued} label_copied=${labelCopied} assistant_copy_ok=${!!(copied[1] || '').trim()} assistant_copy="${(copied[1] || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`,
    );
    console.log(
      `[smoke-copy] queue: running=${scheduler.runningTabId === other.id ? 'other' : scheduler.runningTabId === tab.id ? 'self' : 'none'} working=${isWorking(tab)} position=${scheduler.workingPosition(tab.id)} tabs=${snap()} outbox_text="${(tab.outbox[0] && tab.outbox[0].text) || ''}"`,
    );

    // a draft in the composer must be asked about, not overwritten
    const before = queued;
    els.input.value = 'draft that must survive';
    const resendAgain = button(userKey, 'resend');
    if (resendAgain) resendAgain.click();
    await sleep(400);
    const modalShown = !!modalOpen;
    if (modalOpen) modalOpen.finish({ cancelled: true });
    await sleep(300);
    console.log(
      `[smoke-copy] draft guard: modal=${modalShown} composer="${els.input.value}" queued=${tab.outbox.length} (was ${before})`,
    );

    // renderAll() rebuilds every node: the actions must come back with their data-key
    activateTab(other.id);
    activateTab(tab.id);
    console.log(
      `[smoke-copy] after renderAll: copy=${!!button(userKey, 'copy')} resend=${!!button(userKey, 'resend')} assistant_copy=${!!button(asstKey, 'copy')}`,
    );
  } finally {
    navigator.clipboard.writeText = realWrite;
  }
}

/**
 * STRATAPILOT_SMOKE_EXPORT=1 (with STRATAPILOT_SMOKE_SESSION=<path>): `/export <abs>.html`
 * must skip the dialog, let pi write the file (export_html) and print the returned path;
 * the file is then stat'd from the renderer through the read-only fs:stat-paths.
 */
async function smokeExportScenario() {
  const tab = activeTab();
  if (!tab) {
    console.log('[smoke-export] no active tab');
    return;
  }
  const out = state.info.smokeExportOut || '';
  if (!out) {
    console.log('[smoke-export] no export output path (smokeExportOut empty)');
    return;
  }
  if (tab.ephemeral) {
    // the default smoke tab runs pi with --no-session, so there is no file to export; run with
    // STRATAPILOT_SMOKE_PERSIST=1 to exercise this path for real
    console.log('[smoke-export] SKIP ephemeral tab, no session file to export (use STRATAPILOT_SMOKE_PERSIST=1)');
    return;
  }
  // runExport refuses to export while the tab runs or compacts (pi is still writing the session file,
  // and a mid-write export is racy) - and the prompt scenario keeps this tab busy for seconds. Waiting
  // for idle is what makes this scenario exercise the export path at all; before that it logged
  // ok=false error="no export result recorded", which reads like a product failure but was a refusal,
  // and the export feature went untested in every run.
  const idle = Date.now() + 90000;
  while (Date.now() < idle && (tab.compacting || isWorking(tab) || !tab.sessionPath)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!tab.sessionPath) {
    console.log('[smoke-export] FAIL no session file after 90s, so there is nothing to export');
    return;
  }
  if (tab.compacting || isWorking(tab)) {
    console.log('[smoke-export] FAIL still busy after 90s, so the export path was never exercised');
    return;
  }
  els.input.value = `/export ${out}`;
  await send(); // send() awaits runSlashCommand, so the RPC is done when it returns
  const result = tab.lastExport || { ok: false, error: 'no export result recorded' };
  let exists = false;
  let bytes = 0;
  if (result.ok && result.path) {
    const [stat] = await api.statPaths([result.path]);
    exists = !!(stat && !stat.error && !stat.isDirectory);
    bytes = exists ? stat.size : 0;
  }
  const fail = !result.ok || !exists || bytes < 1024;
  console.log(
    `[smoke-export] ok=${result.ok} path=${result.path || ''} exists=${exists} bytes=${bytes}${result.error ? ` error=${JSON.stringify(result.error)}` : ''}${fail ? ' FAIL the exported HTML is missing or empty' : ''}`,
  );
}

/**
 * STRATAPILOT_SMOKE_DIAG=1: the "Diagnostics" button must build the report, hand it to the
 * clipboard and save a copy. Asserts the five TROUBLESHOOTING items are present and that no
 * key from ~/.pi/agent/models.json leaks into the text.
 */
async function smokeDiagScenario() {
  const copied = [];
  const realWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
  navigator.clipboard.writeText = (value) => {
    copied.push(value);
    return Promise.resolve();
  };
  try {
    await copyDiagnostics();
    const text = copied.join('');
    const sections = ['[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]'];
    const missing = sections.filter((s) => !text.includes(s));
    const unredacted = (text.match(/"(?:api[_-]?key|apikey)"\s*:\s*"(?![*]{3})/g) || []).length;
    console.log(
      `[smoke-diag] copied=${copied.length} chars=${text.length} lines=${text.split('\n').length} missing_sections=${missing.join(',') || 'none'} unredacted_apikeys=${unredacted} toast=${JSON.stringify(lastToastText())}`,
    );
  } finally {
    navigator.clipboard.writeText = realWrite;
  }
}

function lastToastText() {
  const nodes = [...els.toasts.children];
  const last = nodes[nodes.length - 1];
  return last ? last.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

/**
 * STRATAPILOT_SMOKE_SETTINGS=1: the Settings dialog must expose every key that used to need a
 * hand edit of the JSON file, save it through app:settings-set and apply it live.
 */
async function smokeSettingsScenario() {
  const wanted = ['cwd', 'serialQueue', 'restoreTabs', 'strataUrl', 'strataConfigPath', 'monitorOpen', 'monitorWidth', 'sidebarHidden'];
  const opening = openSettingsModal();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const present = wanted.filter((key) => !!document.querySelector(`[data-setting="${key}"]`));
  const prefilled = ['cwd', 'monitorWidth', 'strataUrl'].filter((key) => {
    const box = document.querySelector(`[data-setting="${key}"]`);
    return box && String(box.value).length > 0;
  });
  const widthBox = document.querySelector('[data-setting="monitorWidth"]');
  if (widthBox) widthBox.value = '520';
  const urlBox = document.querySelector('[data-setting="strataUrl"]');
  if (urlBox) urlBox.value = 'http://127.0.0.1:8081/v1';
  const save = [...document.querySelectorAll('.settings-modal .modal-actions button')].find((b) => b.textContent === tr('Save'));
  if (save) save.click();
  await opening;
  const merged = await api.settingsGet();
  console.log(
    `[smoke-settings] fields=${wanted.length} rendered=${present.length} prefilled=${prefilled.length} missing=${wanted.filter((k) => !present.includes(k)).join(',') || 'none'} saved_monitorWidth=${merged && merged.monitorWidth} saved_strataUrl=${merged && merged.strataUrl} css=${document.documentElement.style.getPropertyValue('--mon-w')} serial=${scheduler.enabled} restoreTabs=${state.settings.restoreTabs}`,
  );
}

/**
 * STRATAPILOT_SMOKE_RETRY=1: auto-retry is on when the session starts (bootstrap() forces it), the
 * two retry RPCs must answer, and the two events pi already renders as notes must also drive the
 * composer ("stop retry" only appears while a retry is waiting; auto_retry_end takes it away
 * again). The scenario leaves auto-retry on.
 */
async function smokeRetryScenario() {
  const tab = activeTab();
  if (!tab) {
    console.log('[smoke-retry] no active tab');
    return;
  }
  const bootOn = tab.autoRetry !== false;
  const off = await setAutoRetry(tab, false);
  const afterOff = tab.autoRetry === false;
  const on = await setAutoRetry(tab, true);
  handleRecord(tab, { type: 'auto_retry_start', attempt: 2, maxAttempts: 4, delayMs: 60000, errorMessage: 'simulated overload' });
  const shown = !els.btnStopRetry.classList.contains('hidden');
  const note = [...els.transcript.querySelectorAll('.note')].pop();
  const stop = await api.cmd(tab.id, 'abort_retry');
  handleRecord(tab, { type: 'auto_retry_end', success: false, attempt: 2, finalError: 'simulated' });
  console.log(
    `[smoke-retry] bootOn=${bootOn} setOff=${off} tabOff=${afterOff} setOn=${on} tabOn=${tab.autoRetry !== false} stop_shown=${shown} stop_hidden_after_end=${els.btnStopRetry.classList.contains('hidden')} abort=${stop.success} retrying=${tab.retrying} note=${note ? note.textContent.slice(0, 40) : ''}`,
  );
}

/**
 * STRATAPILOT_SMOKE_OUTBOX=1: B4 - a queued message must survive the restart as "pending" and
 * must never be sent by itself. Nothing is pushed into tab.outbox here, so no prompt reaches the
 * model during this scenario.
 */
async function smokeOutboxScenario() {
  const tab = activeTab();
  const bigImage = 'A'.repeat(600000);
  const packed = persistedOutbox({
    outbox: [{ text: 'queued before the crash', at: Date.now(), images: [{ mimeType: 'image/png', data: bigImage }] }],
    pendingOutbox: [{ text: 'second held message', at: Date.now(), images: [] }],
  });
  const restored = restorePendingOutbox({ outbox: packed.outbox, outboxImagesDropped: packed.outboxImagesDropped, pendingOutbox: packed.pendingOutbox }, tab);
  renderOpenSessions();
  const badge = els.queueList.querySelector('.qbadge.pending');
  const note = [...els.transcript.querySelectorAll('.note')].pop();
  scheduler.pumpSoon(0);
  await new Promise((resolve) => setTimeout(resolve, 700));
  console.log(
    `[smoke-outbox] packed=${(packed.outbox || []).length + (packed.pendingOutbox || []).length} images_dropped=${packed.outboxImagesDropped || 0} restored=${restored} pending=${tab.pendingOutbox.length} badge=${badge ? badge.textContent : 'none'} outbox=${tab.outbox.length} auto_sent=${tab.outbox.length > 0} note=${note ? note.textContent.slice(0, 60) : ''}`,
  );
  tab.pendingOutbox = [];
  renderOpenSessions();
}

/**
 * STRATAPILOT_SMOKE_CRON=1: the job round trip - save through the main process, read it back with
 * a computed nextRun, preview a schedule, reject a bad one, and fire one "run now" so the prompt
 * lands in a tab's outbox. The serial queue is switched off for the scenario so nothing is actually
 * sent to the model.
 */
async function smokeCronScenario() {
  const wasEnabled = scheduler.enabled;
  scheduler.enabled = false;
  try {
    const saved = await api.cronSave([{ id: 'smoke-job', name: 'smoke job', schedule: '*/5 * * * *', prompt: 'SMOKE-CRON-MUST-NOT-BE-SENT', target: 'new-tab', cwd: state.cwd, ephemeral: true, enabled: true }]);
    const listed = await api.cronList();
    const preview = await api.cronPreview('30 9 * * 1-5');
    const bad = await api.cronPreview('nope');
    const before = state.order.length;
    await api.cronRunNow('smoke-job');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const target = [...state.tabs.values()].find((tab) => tab.outbox.some((item) => /SMOKE-CRON/.test(item.text || '')));
    const badges = els.queueList.querySelectorAll('.qbadge.outbox').length;

    // the dialog itself: the list must say what the schedule means in words, and the builder must
    // write the cron expression by itself (nobody should have to type "30 9 * * 1-5")
    const dialog = openJobsModal();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const described = [...document.querySelectorAll('.jobs-modal .job-when')].map((node) => node.textContent.trim());
    await api.smokeShot('jobs-list');
    const add = [...document.querySelectorAll('.jobs-modal .modal-actions button')].find((button) => button.textContent === 'Add job');
    if (add) add.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const shot = await api.smokeShot('jobs-editor'); // layout check for the schedule builder
    const editor = document.querySelector('.jobs-editor');
    const lineOf = () => (editor && editor.querySelector('.job-cron-line') ? editor.querySelector('.job-cron-line').textContent.trim() : '');
    const presetSel = editor ? editor.querySelector('.job-preset') : null;
    const defaultLine = lineOf();
    let stepLine = '';
    let weeklyChipsShown = 'none';
    if (presetSel) {
      presetSel.value = 'minutes';
      presetSel.dispatchEvent(new Event('change'));
      stepLine = lineOf();
      presetSel.value = 'weekly';
      presetSel.dispatchEvent(new Event('change'));
      weeklyChipsShown = editor.querySelector('.job-day-chips') ? getComputedStyle(editor.querySelector('.job-day-chips')).display : 'missing';
      await api.smokeShot('jobs-editor-weekly');
    }
    const chips = editor ? editor.querySelectorAll('.job-chip').length : 0;
    const cancel = editor ? [...editor.querySelectorAll('.modal-actions button')].find((button) => button.textContent === tr('Cancel')) : null;
    if (cancel) cancel.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const close = [...document.querySelectorAll('.jobs-modal .modal-actions button')].find((button) => button.textContent === tr('Close'));
    if (close) close.click();
    await dialog;

    console.log(
      `[smoke-cron] saved=${saved.ok} jobs=${listed.jobs.length} nextRun=${listed.jobs[0] && listed.jobs[0].nextRun ? 'set' : 'none'} preview=${JSON.stringify(preview.description)} has_next=${!!preview.nextRun} invalid_rejected=${bad.ok && !bad.valid} new_tab=${state.order.length > before} queued=${!!target} outbox_badges=${badges} tabs_before=${before} list_words=${JSON.stringify(described[0] || '')} builder_default=${JSON.stringify(defaultLine)} builder_step=${JSON.stringify(stepLine)} weekday_chips=${chips} weekly_chips_shown=${weeklyChipsShown} shot=${JSON.stringify(shot.file || shot.error)}`,
    );
    await api.cronSave([]);
    if (target) {
      target.outbox = [];
      renderOpenSessions();
    }
  } finally {
    scheduler.enabled = wasEnabled;
  }
}

/**
 * STRATAPILOT_SMOKE_TABTAG=1: D5 (which model a tab is on, in the tab strip) and D8 (an explicit
 * Restart button that only appears while that tab's pi process is dead).
 */
async function smokeTabTagScenario() {
  const tab = activeTab();
  const tagNode = () => els.tabs.querySelector(`.tab[data-tab-id="${tab.id}"] .tab-model`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const tag = tagNode();
  const before = !els.btnRestart.classList.contains('hidden');
  tab.alive = false;
  tab.starting = false;
  renderComposerState();
  const shown = !els.btnRestart.classList.contains('hidden');
  tab.alive = true;
  renderComposerState();
  const hidden = els.btnRestart.classList.contains('hidden');
  console.log(
    `[smoke-tabtag] model_tag=${tag ? tag.textContent : 'none'} tag_title=${tag ? JSON.stringify(String(tag.title).split('\n')[0]) : 'none'} shown_when_alive=${before} shown_when_dead=${shown} hidden_when_alive_again=${hidden}`,
  );
}

/**
 * STRATAPILOT_SMOKE_THEME=1: D2. Switches to the light theme, prints the computed colours (a theme
 * that only changed a class would leave the body background dark), screenshots both themes, and
 * switches back.
 */
async function smokeThemeScenario() {
  const read = () => {
    const body = getComputedStyle(document.body);
    const panel = getComputedStyle(document.querySelector('.transcript'));
    const btn = getComputedStyle(els.btnSend);
    return `html=${document.documentElement.dataset.theme} body=${body.backgroundColor}/${body.color} panel=${panel.backgroundColor} send=${btn.backgroundColor}/${btn.color}`;
  };
  const dark = read();
  applyTheme('light');
  renderTabs();
  renderOpenSessions();
  renderAll(activeTab());
  const light = read();
  console.log(`[smoke-theme] dark: ${dark}`);
  console.log(`[smoke-theme] light: ${light}`);
  console.log(`[smoke-theme] changed=${dark !== light} mode=${state.themeMode}`);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); // capturePage() paints the previous frame
  const lightShot = await api.smokeShot('light-theme');
  applyTheme('dark');
  renderAll(activeTab());
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); // capturePage() paints the previous frame
  const darkShot = await api.smokeShot('dark-theme');
  console.log(`[smoke-theme] shots light=${lightShot.ok ? lightShot.file : lightShot.error} dark=${darkShot.ok ? darkShot.file : darkShot.error}`);
}

/**
 * STRATAPILOT_SMOKE_A11Y=1: D3. Opens the settings dialog and checks what the accessibility layer
 * adds by itself (role, label from the heading, focus moved in, Tab wrapped, Esc closing through the
 * Cancel button, focus handed back), then counts buttons that a screen reader would not name.
 */
async function smokeA11yScenario() {
  const opener = document.activeElement;
  const done = openSettingsModal();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const modal = els.modalRoot.querySelector('.modal');
  const heading = modal && modal.querySelector('h3');
  const labelledBy = modal && modal.getAttribute('aria-labelledby');
  const labelOk = !!(heading && labelledBy && heading.id === labelledBy && heading.textContent.trim());
  const focusInside = !!(modal && modal.contains(document.activeElement));
  const focusables = modal ? [...modal.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null) : [];
  let wrapped = false;
  if (focusables.length > 1) {
    focusables[focusables.length - 1].focus();
    focusables[0].focus();
    focusables[focusables.length - 1].focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    wrapped = document.activeElement === focusables[0];
  }
  const rowLabel = (() => {
    const row = els.queueList.querySelector('.qrow');
    return row ? row.getAttribute('aria-label') : null;
  })();
  // The row that carries a queue position only exists while a tab is working, and that is the branch
  // that used to throw (a local named `state` hid the global one, taking the queue and the send with
  // it). Borrow the running flag for one render so the scenario covers it without a model.
  const probe = activeTab();
  let workingLabel = null;
  if (probe) {
    const wasRunning = scheduler.runningTabId;
    scheduler.runningTabId = probe.id;
    try {
      renderOpenSessions();
      const workingRow = els.queueList.querySelector('.qrow.running');
      workingLabel = workingRow ? workingRow.getAttribute('aria-label') : null;
    } finally {
      scheduler.runningTabId = wasRunning;
      renderOpenSessions();
    }
  }
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const closed = !els.modalRoot.querySelector('.modal');
  const restored = document.activeElement === opener;
  const nameless = [...document.querySelectorAll('button')].filter((button) => !button.getAttribute('aria-label') && !button.textContent.trim()).length;
  console.log(
    `[smoke-a11y] dialog=${!!modal} role=${modal ? modal.getAttribute('role') : 'none'} aria_modal=${modal ? modal.getAttribute('aria-modal') : 'none'} labelled_by_heading=${labelOk} focus_inside=${focusInside} tab_wraps=${wrapped} esc_closes=${closed} focus_restored=${restored} nameless_buttons=${nameless} queue_row_label=${JSON.stringify(rowLabel)} working_row_label=${JSON.stringify(workingLabel)} toasts_live=${document.getElementById('toasts').getAttribute('aria-live')} tabs_role=${document.getElementById('tabs').getAttribute('role')}`,
  );
  await done;
}


/**
 * STRATAPILOT_SMOKE_STORAGE=1: D7. Reads the totals, asks for two plans that must match nothing
 * (an absurd age, an absurd cap) and one that matches everything, and checks the session open in this
 * tab is filtered out by the main process. Nothing is ever deleted by this scenario.
 */
async function smokeStorageScenario() {
  const stats = await api.sessionsStats();
  const none = await api.sessionsCleanupPlan({ olderThanDays: 100000 });
  const alsoNone = await api.sessionsCleanupPlan({ keepNewestPerGroup: 100000 });
  const everything = await api.sessionsCleanupPlan({ olderThanDays: 0 });
  const tab = activeTab();
  const openPath = tab && tab.sessionPath ? tab.sessionPath : null;
  const normalised = (value) => String(value || '').replace(/[\/]+/g, '\\').toLowerCase();
  const openListed = openPath ? everything.candidates.some((entry) => normalised(entry.path) === normalised(openPath)) : false;
  const footer = els.sideFoot.textContent;
  const opened = openStorageModal();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const modal = els.modalRoot.querySelector('.storage-modal');
  const closeBox = modal ? [...modal.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Close') : null;
  if (closeBox) closeBox.click();
  await opened;
  const closed = !els.modalRoot.querySelector('.modal');
  console.log(
    `[smoke-storage] ok=${stats.ok} files=${stats.totalFiles} bytes=${stats.totalBytes} groups=${stats.groups.length} none=${none.candidates.length} also_none=${alsoNone.candidates.length} everything=${everything.candidates.length} scanned=${everything.scannedFiles} open_in_list=${openListed} footer=${JSON.stringify(footer)} dialog=${!!modal} dialog_closed=${!els.modalRoot.querySelector('.modal')}`,
  );
}

/**
 * STRATAPILOT_SMOKE_USAGE=1: D9. Reads the ledger through IPC (day and month), opens the Usage
 * dialog, counts the columns it drew, clicks one (the breakdown line must follow), switches the
 * granularity to month and counts again, then closes it. Read-only: nothing is deleted, and the
 * smoke profile's ledger file is separate from the real one.
 */
async function smokeUsageScenario() {
  const day = await api.usageSeries({ unit: 'day', limit: 30 });
  const month = await api.usageSeries({ unit: 'month' });
  const sums = await api.usageSummary();
  /*
   * The reported bug: the on-screen Usage total only moved after an app restart. The settle / focus /
   * cleanup path pulls a fresh summary, so the chip must follow the ledger the main process just
   * computed - with no restart anywhere in sight.
   */
  const chipNode = els.sideFoot.querySelector('.foot-usage');
  const chipBefore = chipNode ? chipNode.textContent : '';
  scheduleUsageSummary(0);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const chipAfter = chipNode ? chipNode.textContent : '';
  const chipFollowsLedger = !!chipNode && chipAfter === usageFootLabel() && chipAfter.includes('Usage:');
  const opened = openUsageModal();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const modal = els.modalRoot.querySelector('.usage-modal');
  const columns = modal ? modal.querySelectorAll('.uc-col').length : 0;
  const firstColumn = modal ? modal.querySelector('.uc-col') : null;
  if (firstColumn) firstColumn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const detail = modal ? modal.querySelector('.usage-detail').textContent : '';
  if (modal) await api.smokeShot('usage-chart'); // the chart is the part a screenshot can actually check
  const axisLabels = (node) => (node ? [...node.querySelectorAll('.uc-ylab')].map((label) => label.textContent).join('|') : '');
  const axisWithCache = axisLabels(modal);
  const cacheBox = modal ? modal.querySelector('input[type="checkbox"]') : null;
  if (cacheBox) {
    cacheBox.checked = false;
    cacheBox.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const axisWithoutCache = axisLabels(modal);
  if (modal) await api.smokeShot('usage-chart-nocache'); // still per day, now scaled to in / out only

  /*
   * The money side: rates are typed into the settings file by the user, so the scenario writes them
   * through the same IPC the dialog uses, switches the columns to USD, checks the axis became money,
   * then puts the settings back. The smoke profile's settings file is not the real one.
   */
  const ratesBefore = (state.settings && state.settings.usagePrices) || null;
  const merged = await api.settingsSet({ usagePrices: { unit: 'usd_per_million', default: { in: 1, out: 2, cacheRead: 0.1, cacheWrite: 0.5 }, byModel: {} } });
  state.settings = merged || { ...state.settings, usagePrices: { unit: 'usd_per_million', default: { in: 1, out: 2, cacheRead: 0.1, cacheWrite: 0.5 }, byModel: {} } };
  const metricSel = modal ? modal.querySelector('select[aria-label="What the columns measure"]') : null;
  if (metricSel) {
    metricSel.value = 'cost';
    metricSel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const costAxis = axisLabels(modal);
  const rateRows = modal ? modal.querySelectorAll('.usage-rate-row').length : 0;
  const rateInputs = modal ? modal.querySelectorAll('.usage-rate-row input[type="number"]').length : 0;
  const moneyShown = /\$/.test(modal ? modal.querySelector('.set-hint').textContent : '');
  const moneyOf = () => {
    const match = /\$([\d,.]+) =/.exec(modal ? modal.querySelector('.set-hint').textContent : '');
    return match ? match[1] : '';
  };
  const moneyBefore = moneyOf();
  if (modal) await api.smokeShot('usage-chart-cost');

  /*
   * Typing a rate must go through the dialog's own save path, not straight into the settings file:
   * that is where an all-empty model row is dropped again so it keeps falling back to the default
   * rate instead of silently making that model free.
   */
  const modelIn = modal ? modal.querySelector('.usage-rate-row input[data-model]:not([data-model="default"])') : null;
  const modelKey = modelIn ? modelIn.dataset.model : '';
  if (modelIn) {
    modelIn.value = '4';
    modelIn.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const savedPrices = (state.settings && state.settings.usagePrices) || {};
  const savedByModel = Object.keys(savedPrices.byModel || {});
  const moneyAfter = moneyOf();
  const refilled = modal ? Array.from(modal.querySelectorAll('.usage-rate-row input[type="number"]')).filter((input) => input.value !== '').length : 0;

  const restored = await api.settingsSet({ usagePrices: ratesBefore || { unit: 'usd_per_million', default: {}, byModel: {} } });
  state.settings = restored || state.settings;
  if (metricSel) {
    metricSel.value = 'tokens';
    metricSel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 800));

  const unitSel = modal ? modal.querySelector('select[aria-label="Column size"]') : null;
  if (unitSel) {
    unitSel.value = 'month';
    unitSel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const monthColumns = modal ? modal.querySelectorAll('.uc-col').length : 0;
  const footer = els.sideFoot.textContent;
  const closeBox = modal ? [...modal.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Close') : null;
  if (closeBox) closeBox.click();
  await opened;
  console.log(
    `[smoke-usage] ok=${day.ok && month.ok && sums.ok} ipc_day=${day.buckets.length} ipc_month=${month.buckets.length} chart_columns=${columns} after_unit=${monthColumns} entries=${day.entries} chip_before=${JSON.stringify(chipBefore)} chip_after=${JSON.stringify(chipAfter)} chip_follows_ledger=${chipFollowsLedger} gone=${day.gone} dedupe_missed=${day.dedupeMissed} ledger=${JSON.stringify(String(day.ledgerFile || '').split(/[\\/]/).pop())} total=${sums.all ? sums.all.total : 0} cache_read=${sums.all ? sums.all.cacheRead : 0} answers=${sums.all ? sums.all.answers : 0} compactions=${sums.all ? sums.all.compactions : 0} branches=${sums.all ? sums.all.branches : 0} axis_with_cache=${JSON.stringify(axisWithCache)} axis_without_cache=${JSON.stringify(axisWithoutCache)} rescaled=${axisWithCache !== axisWithoutCache} cost_axis=${JSON.stringify(costAxis)} cost_is_money=${costAxis.includes('$')} rate_rows=${rateRows} rate_inputs=${rateInputs} money_in_header=${moneyShown} money_before=${JSON.stringify(moneyBefore)} typed_model_rate=${JSON.stringify(modelKey)} saved_by_model=${JSON.stringify(savedByModel)} money_after=${JSON.stringify(moneyAfter)} money_changed=${moneyBefore !== moneyAfter && !!moneyAfter} money_up=${parseFloat(moneyAfter) > parseFloat(moneyBefore)} refilled_boxes=${refilled} detail=${JSON.stringify(detail.slice(0, 70))} footer=${JSON.stringify(footer.slice(-46))} dialog=${!!modal} dialog_closed=${!els.modalRoot.querySelector('.modal')}`,
  );
}

/**
 * STRATAPILOT_SMOKE_I18N=1: D10. The language switch must work through the same path the Settings dialog
 * uses (open the dialog, pick the dropdown, press Save) and must not need a restart: the static chrome is
 * translated by walking index.html, the dynamic parts by re-running the renderers. So the check is "does
 * the visible text change to Chinese, and does it come back to English". The catalogs themselves - every
 * key present, every {placeholder} intact - are covered by test/i18n.test.js.
 */
async function smokeI18nScenario() {
  const sideNew = $('btnNewSide');
  const read = () => ({
    lang: document.documentElement.lang,
    newSession: sideNew ? sideNew.textContent : '',
    settings: els.btnSettings ? els.btnSettings.textContent : '',
    foot: (els.sideFoot.querySelector('.foot-usage') || {}).textContent || '',
    sendTitle: els.btnSend.title,
    placeholder: els.input.placeholder,
    storage: (els.sideFoot.querySelector('.foot-storage') || {}).textContent || '',
    monitor: [...document.querySelectorAll('.mcard .mcard-head')].map((head) => head.textContent).join(','),
  });
  const before = read();

  // the same path the user takes: open Settings, pick the dropdown, press Save
  const pick = async (value) => {
    const opening = openSettingsModal();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const sel = document.querySelector('[data-setting="language"]');
    const options = sel ? [...sel.options].map((option) => option.value) : [];
    if (sel) sel.value = value;
    const save = [...document.querySelectorAll('.settings-modal .modal-actions button')].find((button) => button.textContent === tr('Save'));
    if (save) save.click();
    await opening;
    await new Promise((resolve) => setTimeout(resolve, 1200)); // applySettings -> setLanguage is async
    return options;
  };

  // #30: the path this scenario has to cover is a language change taken while the monitor is CLOSED.
  // The card titles are baked in with tr() when the cards are built, and a closed panel used to never
  // have that build invalidated - so the labels stayed in whatever language the monitor happened to be
  // first opened in. Close it before switching, reopen it before reading.
  const monitorWasOpen = !els.monitorView.classList.contains('hidden');
  if (monitorWasOpen) closeMonitor();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const reopenMonitor = async () => {
    if (els.monitorView.classList.contains('hidden')) openMonitor();
    await new Promise((resolve) => setTimeout(resolve, 400));
  };

  const options = await pick('zh-TW');
  await reopenMonitor();
  const tw = read();
  await api.smokeShot('i18n-zh-TW');
  await pick('zh-CN');
  await reopenMonitor();
  const cn = read();
  await api.smokeShot('i18n-zh-CN');
  await pick('en'); // and back, so switching is not a one-way door
  await reopenMonitor();
  const back = read();
  if (!monitorWasOpen) closeMonitor();
  const saved = await api.settingsGet();

  const cjk = /[\u3400-\u9fff]/;
  // the scenario used to only RECORD this: a monitor stuck in the wrong language was visible in the
  // log line and nothing failed on it (#30)
  const monitorTranslated = cjk.test(tw.monitor) && cjk.test(cn.monitor);
  if (!monitorTranslated) {
    console.log(`[smoke-i18n] FAIL the monitor kept its old labels after a language change taken while the panel was closed: tw=${JSON.stringify(tw.monitor.slice(0, 60))} cn=${JSON.stringify(cn.monitor.slice(0, 60))} (#30)`);
  }
  console.log(
    `[smoke-i18n] start_lang=${before.lang} options=${options.join(',')} tw_lang=${tw.lang} tw_newSession=${JSON.stringify(tw.newSession)} tw_settings=${JSON.stringify(tw.settings)} tw_storage=${JSON.stringify(tw.storage)} tw_foot=${JSON.stringify(tw.foot)} tw_sendTitle=${JSON.stringify(tw.sendTitle)} tw_placeholder=${JSON.stringify(tw.placeholder.slice(0, 40))} tw_monitor=${JSON.stringify(tw.monitor.slice(0, 60))} cn_lang=${cn.lang} cn_newSession=${JSON.stringify(cn.newSession)} cn_foot=${JSON.stringify(cn.foot)} cn_monitor=${JSON.stringify(cn.monitor.slice(0, 60))} switched=${tw.lang === 'zh-TW' && cn.lang === 'zh-CN'} cjk=${cjk.test(tw.newSession) && cjk.test(tw.settings) && cjk.test(tw.placeholder) && cjk.test(cn.newSession)} monitor_translated=${monitorTranslated} restored=${back.lang === 'en' && back.newSession === before.newSession && back.sendTitle === before.sendTitle && back.monitor === before.monitor} saved_pref=${saved && saved.language} entries=${i18nInfo.entries} pref=${i18nInfo.pref} system=${i18nInfo.systemLocale}`,
  );
}

/**
 * STRATAPILOT_SMOKE_SERVERS=1: D6. Adds a second (unreachable) Strata address through Settings,
 * checks the Monitor gives it a pill with a health dot that turns red, points the cards at it, then
 * removes it again through the pill's x - so the settings round trip is proven both ways.
 */
async function smokeServersScenario() {
  const before = Array.isArray(state.settings.strataUrls) ? [...state.settings.strataUrls] : [];
  const bogus = 'http://127.0.0.1:9/v1';
  const merged = await api.settingsSet({ strataUrls: [...before, bogus] });
  state.settings = merged || { ...state.settings, strataUrls: [...before, bogus] };
  openMonitor();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const pills = [...els.monServers.querySelectorAll('.mon-server')];
  const bogusPill = pills.find((pill) => pill.dataset.url === bogus);
  const dotBefore = bogusPill ? bogusPill.querySelector('.mon-dot').className : 'none';
  if (bogusPill) bogusPill.click();
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const dotAfter = bogusPill ? bogusPill.querySelector('.mon-dot').className : 'none';
  const activePill = els.monServers.querySelector('.mon-server.active');
  const removeBox = bogusPill ? bogusPill.querySelector('.mon-server-x') : null;
  if (removeBox) removeBox.click();
  await new Promise((resolve) => setTimeout(resolve, 800));
  const after = Array.isArray(state.settings.strataUrls) ? state.settings.strataUrls : [];
  const pillsAfter = els.monServers.querySelectorAll('.mon-server').length;
  const src = els.monSrc.textContent;
  closeMonitor();
  console.log(
    `[smoke-servers] pills=${pills.length} bogus_pill=${!!bogusPill} dot_before=${JSON.stringify(dotBefore)} dot_after=${JSON.stringify(dotAfter)} target=${monitorTargetUrl()} active=${activePill ? activePill.textContent.trim() : 'none'} removed=${!after.includes(bogus)} pills_after=${pillsAfter} src=${JSON.stringify(src.slice(0, 70))}`,
  );
}

/**
 * STRATAPILOT_SMOKE_PATH=1: D1. Types `@lib/d` in the composer, waits for the completion list, presses
 * Enter and checks the path was inserted instead of the prompt being sent.
 */
async function smokePathScenario() {
  const tab = activeTab();
  els.input.focus();
  els.input.value = 'read @lib/d';
  els.input.setSelectionRange(els.input.value.length, els.input.value.length);
  els.input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 900));
  const rows = [...els.slashMenu.querySelectorAll('.slash-item')];
  const first = rows.length ? rows[0].textContent : '';
  const outboxBefore = tab.outbox.length;
  els.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 700));
  const value = els.input.value;
  const sent = tab.outbox.length > outboxBefore;
  console.log(
    `[smoke-path] cwd=${tab.cwd} rows=${rows.length} first=${JSON.stringify(first.slice(0, 40))} inserted=${JSON.stringify(value)} menu_open_after=${pathMenu.open} sent_instead=${sent}`,
  );
  closePathMenu();
  closeSlashMenu();
  els.input.value = '';
  els.input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * STRATAPILOT_SMOKE_TREE=1: B1. Opens the session tree of a loaded session and counts what it found:
 * entries, the active path, branch points and the fork buttons offered. Nothing is forked.
 */
async function smokeTreeScenario() {
  const tab = activeTab();
  const opened = openSessionTree(tab);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const modal = els.modalRoot.querySelector('.tree-modal');
  const rows = modal ? [...modal.querySelectorAll('.tree-row')] : [];
  const onPath = rows.filter((row) => row.classList.contains('on-path')).length;
  const offPath = rows.filter((row) => row.classList.contains('off-path')).length;
  const forks = modal ? modal.querySelectorAll('button[title^="go back to this prompt"]').length : 0;
  const heads = modal ? modal.querySelectorAll('.tree-branch').length : 0;
  const closeBox = modal ? [...modal.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Close') : null;
  if (closeBox) closeBox.click();
  await opened;
  console.log(
    `[smoke-tree] modal=${!!modal} rows=${rows.length} on_path=${onPath} off_path=${offPath} branch_heads=${heads} fork_buttons=${forks} chip=${JSON.stringify(els.stats.querySelector('.stat-tree') ? els.stats.querySelector('.stat-tree').textContent : 'none')} messages=${tab.items.length}`,
  );
}

/**
 * STRATAPILOT_SMOKE_FORK=1: B1 for real. The fixture session has one branch point (two answers to the
 * same prompt). This forks from the FIRST user message, which must abandon everything after it, then
 * re-reads the tree and counts what moved off the active path. Run it against the fixture only.
 */
async function smokeForkScenario() {
  const tab = activeTab();
  const itemsBefore = tab.items.length;
  const opened = openSessionTree(tab);
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const modal = els.modalRoot.querySelector('.tree-modal');
  const rows = modal ? [...modal.querySelectorAll('.tree-row')] : [];
  const offBefore = rows.filter((row) => row.classList.contains('off-path')).length;
  const heads = modal ? modal.querySelectorAll('.tree-branch').length : 0;
  const targetRow = rows.find((row) => row.querySelector('.tree-kind') && row.querySelector('.tree-kind').textContent === 'user');
  const forkButton = targetRow ? [...targetRow.querySelectorAll('button')].find((button) => button.textContent.trim() === 'fork here') : null;
  if (forkButton) forkButton.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const backdrops = [...els.modalRoot.querySelectorAll('.modal-backdrop')];
  const confirmModal = backdrops.length ? backdrops[backdrops.length - 1].querySelector('.modal') : null;
  const confirmButton = confirmModal ? [...confirmModal.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Fork here') : null;
  if (confirmButton) confirmButton.click();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  for (const box of [...els.modalRoot.querySelectorAll('.tree-modal')]) {
    const closeAny = [...box.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Close');
    if (closeAny) closeAny.click();
  }
  await opened;
  const reopened = openSessionTree(tab);
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const last = els.modalRoot.lastElementChild;
  const modal2 = last ? last.querySelector('.tree-modal') : null;
  const rows2 = modal2 ? [...modal2.querySelectorAll('.tree-row')] : [];
  const offAfter = rows2.filter((row) => row.classList.contains('off-path')).length;
  const closeBox = modal2 ? [...modal2.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Close') : null;
  if (closeBox) closeBox.click();
  await reopened;
  console.log(
    `[smoke-fork] rows_before=${rows.length} off_before=${offBefore} branch_heads=${heads} fork_button=${!!forkButton} confirm=${!!confirmButton} rows_after=${rows2.length} off_after=${offAfter} items_before=${itemsBefore} items_after=${tab.items.length} chip=${JSON.stringify(els.stats.querySelector('.stat-tree') ? els.stats.querySelector('.stat-tree').textContent : 'none')}`,
  );
}

/**
 * STRATAPILOT_SMOKE_SETUP=1: C5. Opens the first-run wizard, reads what the two checks reported, and
 * closes it through the primary button (which is what records firstRunSeen).
 */
async function smokeSetupScenario() {
  await api.settingsSet({ firstRunSeen: false });
  applySettings({ ...state.settings, firstRunSeen: false });
  const opened = openFirstRunWizard();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const modal = els.modalRoot.querySelector('.setup-modal');
  const statuses = modal ? [...modal.querySelectorAll('.setup-status')].map((node) => node.textContent.trim()) : [];
  const classes = modal ? [...modal.querySelectorAll('.setup-status')].map((node) => node.className) : [];
  const done = modal ? [...modal.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Start using it') : null;
  if (done) done.click();
  await opened;
  const merged = await api.settingsGet();
  console.log(
    `[smoke-setup] modal=${!!modal} steps=${statuses.length} pi=${JSON.stringify((statuses[0] || '').slice(0, 60))} strata=${JSON.stringify((statuses[1] || '').slice(0, 70))} classes=${JSON.stringify(classes)} closed=${!els.modalRoot.querySelector('.setup-modal')} first_run_seen=${merged && merged.firstRunSeen}`,
  );
}

// STRATAPILOT_SMOKE_PASTE=1 — Ctrl+V of an image must attach it like a drop: chip + tab.images.
// A 1x1 PNG is built in JS (clipboard images have no filesystem path, so pathForFile() -> '').
const PNG_1X1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

function makeImageFile(name, type, bytes) {
  return new File([bytes], name, { type });
}

function pngBytes() {
  const bin = atob(PNG_1X1_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Synthesise a paste event: clipboardData is read-only, so shadow it on the instance. */
function makePasteEvent(files, text = '') {
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
  const data = {
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: files.length ? ['Files'] : ['text/plain'],
    getData: (kind) => (kind === 'text/plain' ? text : ''),
  };
  Object.defineProperty(event, 'clipboardData', { value: data });
  return event;
}

async function smokePasteScenario() {
  const tab = activeTab();
  const chips = () => els.attachments.querySelectorAll('.chip').length;
  const lastToast = () => {
    // skip addFiles' "attached: ..." summary and report the warning that matters here
    const nodes = [...els.toasts.children];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const text = nodes[i].textContent.replace(/\s+/g, ' ').trim();
      if (!/^attached: \d+ file/.test(text)) return text;
    }
    return '';
  };
  const settle = async (expectedImages) => {
    for (let i = 0; i < 60 && tab.images.length < expectedImages; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 200));
  };
  const png = pngBytes();

  const first = makePasteEvent([makeImageFile('image.png', 'image/png', png)]);
  document.dispatchEvent(first);
  await settle(1);
  console.log(
    `[smoke-paste] paste=1 files=1 images=${tab.images.length} chips=${chips()} first=${tab.images[0] ? tab.images[0].name : ''} size=${png.length}b prevented=${first.defaultPrevented}`,
  );

  const second = makePasteEvent([makeImageFile('image.png', 'image/png', png)]);
  document.dispatchEvent(second);
  await settle(2);
  console.log(
    `[smoke-paste] paste=2 files=1 images=${tab.images.length} chips=${chips()} first=${tab.images[1] ? tab.images[1].name : ''} size=${png.length}b prevented=${second.defaultPrevented}`,
  );

  // two images in one paste
  const multi = makePasteEvent([makeImageFile('image.png', 'image/png', png), makeImageFile('image.png', 'image/png', png)]);
  document.dispatchEvent(multi);
  await settle(4);
  console.log(`[smoke-paste] multi: files=2 images=${tab.images.length} chips=${chips()} names=${tab.images.map((i) => i.name).join(',')}`);

  // unsupported type (bmp) must toast, not inline garbage
  const bmp = makePasteEvent([makeImageFile('image.bmp', 'image/bmp', png)]);
  document.dispatchEvent(bmp);
  await settle(4);
  console.log(`[smoke-paste] bmp: images=${tab.images.length} chips=${chips()} inlines=${tab.inlines.length} toast="${lastToast()}"`);

  // oversized image: rejected with its size named, the others untouched
  const big = makePasteEvent([makeImageFile('image.png', 'image/png', new Uint8Array(MAX_IMAGE_BYTES + 1))]);
  document.dispatchEvent(big);
  await settle(4);
  console.log(`[smoke-paste] oversize: images=${tab.images.length} chips=${chips()} toast="${lastToast()}"`);

  // plain text paste must stay untouched (no preventDefault, no attachment)
  const text = makePasteEvent([], 'hello clipboard');
  document.dispatchEvent(text);
  await settle(4);
  console.log(`[smoke-paste] text: prevented=${text.defaultPrevented} images=${tab.images.length} chips=${chips()}`);

  // while a modal is open the paste must be ignored entirely
  const modal = openModal({ title: 'paste guard', message: 'paste while this is open', kind: 'confirm' });
  await new Promise((r) => setTimeout(r, 200));
  const guarded = makePasteEvent([makeImageFile('image.png', 'image/png', png)]);
  document.dispatchEvent(guarded);
  await new Promise((r) => setTimeout(r, 400));
  console.log(`[smoke-paste] modal-guard: modalOpen=${!!modalOpen} prevented=${guarded.defaultPrevented} images=${tab.images.length} chips=${chips()}`);
  if (modalOpen) modalOpen.finish({ cancelled: true });
  await modal;
}
