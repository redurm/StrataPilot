'use strict';

/*
 * The chrome (#12, step 8): everything around the transcript that is not the transcript -
 * the tab strip, the env bar, the stats and the bars, the cwd chip, the attachments,
 * the open-sessions list, and the language switch that repaints all of it.

 * Moved out of app.js without touching a function body. Each function is delimited by
 * the brace that closes it at column 0, so nothing that merely sits below it comes
 * along: the pinned-bar table is built with i18nKey() while app.js loads, and taking
 * it here would be the same dead window step 2 shipped.

 * Loaded before app.js; nothing here runs at load time.
 */

/** Re-run the renderers that own chrome text, so a language change lands without a reload. */
function rerenderChrome() {
  const tab = activeTab();
  renderEnvBar();
  renderTabs();
  // the notes, the tool labels and the empty hints in the transcript are ours too, so the transcript is
  // rebuilt as well - pi's own text is untouched by a language change
  if (tab) renderAll(tab);
  renderComposerState();
  renderAttachments();
  if (tab) {
    renderSelectors(tab);
    renderStats(tab);
    renderPinnedBars(tab);
    renderNowBar(tab);
    renderQueueBar(tab);
    renderWidgets(tab);
    renderCwdChip(tab);
  }
  refreshSessions().catch(() => {});
  refreshStorage().catch(() => {});
  refreshUsageSummary().catch(() => {});
  // #30: the card titles, the state badges and the Decode/Prefill subs are baked in with tr() when the
  // cards are built, and buildMonitorCards() returns early once built. Invalidating that flag only
  // while the panel happens to be open meant a language change taken from Settings (panel closed) left
  // the monitor showing the language it was FIRST built in, forever. Invalidate unconditionally: open
  // panel rebuilds now, closed panel rebuilds on the next openMonitor().
  monitor.built = false;
  if (!els.monitorView.classList.contains('hidden')) {
    renderMonitorServers();
    // repaint from the last metrics payload (only fetch again if we never had one)
    buildMonitorCards();
    if (monitor.lastData) renderMonitor(monitor.lastData);
    else pollMonitor().catch(() => {});
  }
}

async function applyLanguageSwitch(pref) {
  if (pref === i18nInfo.pref) return null; // a queued switch got there first
  const payload = await api.i18nSet(pref);
  if (!payload) return null;
  installI18n(payload);
  rerenderChrome();
  return payload;
}

function renderTabs() {
  els.tabs.textContent = '';
  for (const tabId of state.order) {
    const tab = state.tabs.get(tabId);
    if (!tab) continue;
    const node = el('div', `tab${tabId === state.activeId ? ' active' : ''}`);
    node.dataset.tabId = tabId;
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(tabId === state.activeId));
    node.setAttribute('aria-label', tabLabel(tab));
    const running = !!tab.isStreaming || scheduler.runningTabId === tabId;
    if (running) node.classList.add('running');
    else if (tab.outbox.length) node.classList.add('queued');
    if (!tab.alive && !tab.starting) node.classList.add('dead');
    node.appendChild(el('span', 'tab-dot'));
    node.appendChild(el('span', 'tab-title', tabLabel(tab)));
    if (isWorking(tab)) {
      const position = scheduler.workingPosition(tabId);
      if (position) node.appendChild(el('span', 'tab-pos', `#${position}`));
    }
    if (tab.outbox.length) node.appendChild(el('span', 'tab-outbox', `+${tab.outbox.length}`));
    // D5: which model this tab is actually on - with several tabs open on different models the
    // dropdown alone does not tell you what the other tabs are doing
    const modelTag = tabModelTag(tab);
    if (modelTag) {
      const tag = el('span', 'tab-model', modelTag.text);
      tag.title = modelTag.title;
      node.appendChild(tag);
    }
    node.title = `${tabLabel(tab)}\n${tab.cwd}\n${running ? tr('running') : tab.outbox.length ? tr('queued ({n} pending)', { n: tab.outbox.length }) : tr('idle')}${modelTag ? `\n${tr('model')}: ${modelTag.title}` : ''}`;
    const close = el('button', 'tab-close', '×');
    close.title = tr('Close tab');
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab(tabId);
    });
    node.appendChild(close);
    node.addEventListener('click', () => activateTab(tabId));
    node.addEventListener('dblclick', () => renameActiveSession(tab));
    els.tabs.appendChild(node);
  }
  renderOpenSessions();
}

function renderSelectors(tab) {
  els.modelSel.textContent = '';
  for (const model of tab.models) {
    const opt = document.createElement('option');
    opt.value = `${model.provider}/${model.id}`;
    opt.textContent = `${model.provider}/${model.id}`;
    if (tab.model && tab.model.id === model.id && tab.model.provider === model.provider) opt.selected = true;
    els.modelSel.appendChild(opt);
  }
  if (!tab.models.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = tr('no models');
    els.modelSel.appendChild(opt);
  }

  els.thinkingSel.textContent = '';
  const levels = tab.thinkingLevels && tab.thinkingLevels.length ? tab.thinkingLevels : ['off'];
  for (const level of levels) {
    const opt = document.createElement('option');
    opt.value = level;
    opt.textContent = tr('thinking: {level}', { level });
    if (level === tab.thinking) opt.selected = true;
    els.thinkingSel.appendChild(opt);
  }
}

function renderStats(tab) {
  els.stats.textContent = '';
  if (!tab) return;
  const add = (label, value, cls = '', title = '') => {
    if (!value) return;
    const span = el('span', cls);
    if (title) span.title = title;
    span.appendChild(el('b', '', `${label} `));
    span.appendChild(document.createTextNode(String(value)));
    els.stats.appendChild(span);
  };
  if (tab.model) add(tr('model'), `${tab.model.provider}/${tab.model.id}`);
  if (tab.stats && tab.stats.contextUsage) {
    const cu = tab.stats.contextUsage;
    const percent = cu.percent == null ? null : Math.round(cu.percent * 10) / 10;
    add(tr('ctx'), `${fmtTokens(cu.tokens)} / ${fmtTokens(cu.contextWindow)}${percent == null ? '' : ` (${percent}%)`}`);
    // auto-compact is forced on by bootstrap(), so this can only mean that force failed - and then
    // the warning is what stops an overflow from arriving blind
    if (tab.autoCompact === false && percent != null && percent >= 85) {
      add(tr('auto-compact off'), tr('compact before it overflows'), 'warn');
    }
  }
  if (tab.stats) {
    const t = tab.stats.tokens || {};
    // in / out separately: a single total cannot tell you whether the session is paying
    // for a long prompt read or for a long answer, and those need different fixes.
    add(tr('tok'), tokenLabel(t), '', usageTooltip({
      input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, total: t.total,
    }));
    if (tab.stats.cost) add(tr('cost'), `$${tab.stats.cost.toFixed(3)}`);
  }
  for (const [key, text] of tab.statuses) add(key, text);
  // B1: a way into the tree view. The label counts branch points, which is the number that makes
  // people wish they had seen it earlier.
  const treeButton = el('button', 'ghost stat-tree', tab.branchPoints ? tr(tab.branchPoints === 1 ? 'tree: {n} branch' : 'tree: {n} branches', { n: tab.branchPoints }) : tr('tree'));
  treeButton.title = tr('session tree: the branch you are on, the branches pi stopped following, and a fork from any earlier prompt');
  treeButton.addEventListener('click', () => openSessionTree(tab));
  els.stats.appendChild(treeButton);
}

async function refreshStats(tab) {
  if (!tab || !tab.alive) return;
  const res = await api.cmd(tab.id, 'get_session_stats');
  if (res.success && res.data) {
    tab.stats = res.data;
    // A brand-new session has no file when bootstrap() reads get_state: pi creates the file on the
    // FIRST message. Nothing else hands that path back, so tab.sessionPath stayed null for the whole
    // life of the tab and everything gated on it kept failing - /export insisted "this session has no
    // session file yet" forever, renaming had no target, and the sidebar / tree could never mark this
    // session as current (#35). get_session_stats already returns the path (that is what /stats
    // prints), so adopting it here costs no extra round trip.
    if (!tab.sessionPath && res.data.sessionFile) {
      tab.sessionPath = res.data.sessionFile;
      api.setSessionPath({ tabId: tab.id, sessionPath: res.data.sessionFile });
      renderTabs(); // the tab chip and the sidebar "current" marker both read sessionPath
    }
  }
  renderStats(tab);
}

function renderPinnedBars(tab) {
  const target = tab || activeTab();
  renderNowBar(target);
  renderQueueBar(target);
}

function renderNowBar(tab) {
  if (tab !== activeTab()) return; // the bars always describe the visible session
  const bar = els.nowBar;
  const req = tab && tab.currentRequest;
  bar.textContent = '';
  delete bar._req;
  if (!req) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const busy = requestIsBusy(tab);
  bar.classList.toggle('busy', busy);

  const label = busy ? (tab.bashRunning ? tr('running bash') : tab.compacting ? tr('compacting') : tr('working on')) : tr('last request');
  bar.appendChild(el('span', `nb-state ${busy ? 'busy' : 'idle'}`, label));
  bar.appendChild(el('span', `nb-src ${req.source}`, tr(REQUEST_SOURCE_LABEL[req.source] || req.source)));

  const text = el('span', 'nb-text', oneLine(req.text));
  text.title = `${req.text}\n\n${tr(REQUEST_SOURCE_LABEL[req.source] || req.source)} · ${new Date(req.at).toLocaleString(i18nInfo.lang === 'en' ? undefined : i18nInfo.lang)}`;
  bar.appendChild(text);

  const time = el('span', 'nb-time');
  paintRequestTime(time, req);
  bar.appendChild(time);

  if (req.key) {
    const jump = el('button', 'nb-jump', tr('↓ jump'));
    jump.title = tr('Scroll to this request in the transcript');
    jump.addEventListener('click', (event) => {
      event.stopPropagation();
      jumpToItem(tab, req.key);
    });
    bar.appendChild(jump);
  }
  bar._req = req;
}

function renderWidgets(tab) {
  els.extWidgets.textContent = '';
  if (!tab) return;
  for (const [key, widget] of tab.widgets) {
    if (widget.placement !== 'aboveEditor') continue;
    const node = el('div', 'ext-widget', widget.lines.join('\n'));
    node.title = key;
    els.extWidgets.appendChild(node);
  }
}

/** Working folder of the visible session. The sidebar now lists every project, so the chat
 *  pane has to say which folder this conversation runs in; clicking the chip opens it. */
function renderCwdChip(tab) {
  const chip = els.cwdChip;
  if (!chip) return;
  chip.textContent = '';
  if (!tab || !tab.cwd) {
    chip.classList.add('hidden');
    return;
  }
  chip.classList.remove('hidden');
  chip.appendChild(el('span', 'cwd-label', tr('folder')));
  appendPath(chip, tab.cwd);
  chip.title = `${tab.cwd}\n${tab.sessionPath || tr('unsaved session')}\n${tr('click to open this folder')}`;
}

function renderAttachments() {
  const tab = activeTab();
  els.attachments.textContent = '';
  if (!tab) return;
  const addChip = (name, removeFn, previewUrl, title) => {
    const chip = el('div', 'chip');
    if (previewUrl) {
      const img = document.createElement('img');
      img.src = previewUrl;
      chip.appendChild(img);
    }
    chip.appendChild(el('span', 'chip-name', name));
    const x = el('button', '', '×');
    x.addEventListener('click', () => {
      removeFn();
      renderAttachments();
    });
    chip.appendChild(x);
    chip.title = title || name;
    els.attachments.appendChild(chip);
  };
  tab.attachments.forEach((item, index) =>
    addChip(item.isDirectory ? `${item.name}/` : item.name, () => tab.attachments.splice(index, 1), undefined, item.path),
  );
  tab.inlines.forEach((item, index) => addChip(`${item.name} (inline)`, () => tab.inlines.splice(index, 1)));
  tab.images.forEach((item, index) => addChip(item.name, () => tab.images.splice(index, 1), item.previewUrl, item.path || item.name));
}

function renderOpenSessions() {
  els.queueList.textContent = '';
  const tabs = state.order.map((id) => state.tabs.get(id)).filter(Boolean);
  if (!tabs.length) {
    els.queueList.appendChild(el('div', 'queue-hint', tr('No open sessions.')));
    return;
  }
  const working = tabs.filter((tab) => isWorking(tab));
  const idle = tabs.filter((tab) => !isWorking(tab));
  if (working.length) {
    els.queueList.appendChild(el('div', 'qgroup', scheduler.runningTabId ? tr('Working ({n}) - running: 1', { n: working.length }) : tr('Working ({n})', { n: working.length })));
    // the position is inside the working group, so the total has to be the working count too
    working.forEach((tab, index) => els.queueList.appendChild(queueRow(tab, index + 1, working.length)));
  }
  if (idle.length) {
    els.queueList.appendChild(el('div', 'qgroup idle', tr('Idle ({n})', { n: idle.length })));
    idle.forEach((tab) => els.queueList.appendChild(queueRow(tab, 0, working.length)));
  }
  renderPinnedBars(); // the bottom bar mirrors the outbox, so it refreshes with the queue
  markCurrentSession();
}

function refreshSessionsSoon(delay = 1200) {
  clearTimeout(sessionsTimer);
  sessionsTimer = setTimeout(() => refreshSessions(), delay);
}

async function refreshSessions() {
  const res = await api.sessionsList({ query: state.query, limit: 400 });
  if (!res.ok) {
    els.sessionList.textContent = '';
    els.sessionList.appendChild(el('div', 'note error', res.error || tr('failed to list sessions')));
    return;
  }
  state.sessions = res.sessions;
  els.sideFoot.textContent = tr('{shown} / {total} sessions', { shown: res.sessions.length, total: res.total });
  // D7: the footer used to show only the session count; the size of the folder is the number
  // that makes people go looking for a cleanup
  const storageButton = el('button', 'ghost foot-storage', state.storage ? tr('Storage: {size} in {n} files', { size: formatBytes(state.storage.totalBytes), n: state.storage.totalFiles }) : tr('Storage'));
  storageButton.title = tr('what the sessions folder costs, and a way to clear old sessions without opening the file manager');
  storageButton.addEventListener('click', () => openStorageModal());
  els.sideFoot.appendChild(storageButton);
  // D9: the same footer spot also reaches the token ledger - the number there is the whole history,
  // including sessions a cleanup already deleted from disk
  const usageButton = el('button', 'ghost foot-usage', usageFootLabel());
  usageButton.title = tr('tokens used per day / week / month / year (in, out, cache read, cache write), kept in token_usage.json');
  usageButton.addEventListener('click', () => openUsageModal());
  els.sideFoot.appendChild(usageButton);
  els.sessionList.textContent = '';

  if (!res.sessions.length) {
    els.sessionList.appendChild(el('div', 'empty-hint', tr('No sessions found.')));
    return;
  }

  for (const meta of res.sessions) {
    const item = el('div', 'session-item');
    item.dataset.path = meta.path;
    item.dataset.cwd = meta.cwd || '';
    item.appendChild(el('div', 'session-title', meta.title || meta.fileName));
    const cwdRow = el('div', 'session-cwd');
    appendPath(cwdRow, meta.cwd);
    cwdRow.title = meta.cwd ? `${meta.cwd}\n${tr('Click to open this folder')}` : tr('no working folder recorded in this session file');
    cwdRow.addEventListener('click', async (event) => {
      event.stopPropagation();
      await openFolder(meta.cwd);
    });
    item.appendChild(cwdRow);
    const snippet = el('div', 'session-snippet', meta.lastAssistantText || meta.lastUserText || '');
    item.appendChild(snippet);
    const metaRow = el('div', 'session-meta');
    metaRow.appendChild(el('span', '', timeAgo(meta.updatedAt)));
    metaRow.appendChild(el('span', '', tr('{n} msg', { n: meta.messageCount })));
    if (meta.model) metaRow.appendChild(el('span', '', meta.model));
    if (meta.inputTokens || meta.outputTokens || meta.cacheReadTokens || meta.cacheWriteTokens) {
      const chip = el('span', '', tokenLabel({
        input: meta.inputTokens, output: meta.outputTokens,
        cacheRead: meta.cacheReadTokens, cacheWrite: meta.cacheWriteTokens,
      }));
      chip.title = usageTooltip({
        input: meta.inputTokens, output: meta.outputTokens, cacheRead: meta.cacheReadTokens,
        cacheWrite: meta.cacheWriteTokens, total: meta.totalTokens,
      });
      metaRow.appendChild(chip);
    } else if (meta.totalTokens) {
      metaRow.appendChild(el('span', '', fmtTokens(meta.totalTokens)));
    }
    if (meta.parentSession) metaRow.appendChild(el('span', '', tr('fork')));
    item.appendChild(metaRow);

    const actions = el('div', 'session-actions');
    const mk = (label, title, fn) => {
      const button = el('button', '', label);
      button.title = title;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        fn();
      });
      actions.appendChild(button);
    };
    mk(tr('this tab'), tr('Load into the current session tab'), () => switchCurrentTabTo(meta));
    mk(tr('name'), tr('Rename session'), async () => {
      const response = await openModal({ title: tr('Session name'), kind: 'input', prefill: meta.name || meta.title });
      if (response.cancelled) return;
      const name = String(response.value || '').trim();
      if (!name) return;
      const openTab = [...state.tabs.values()].find((t) => t.alive && samePath(t.sessionPath, meta.path));
      if (openTab) {
        const res = await api.cmd(openTab.id, 'set_session_name', { name });
        if (!res.success) toast(res.error || tr('rename failed'), 'error');
        else openTab.name = name;
      } else {
        const result = await api.sessionsRename(meta.path, name);
        if (!result.ok) toast(result.error || tr('rename failed'), 'error');
      }
      refreshSessions();
      renderTabs();
    });
    mk(tr('del'), tr('Delete session file'), async () => {
      const open = [...state.tabs.values()].some((t) => samePath(t.sessionPath, meta.path));
      if (open) {
        toast(tr('session is open in a tab'), 'warning');
        return;
      }
      const response = await openModal({ title: tr('Delete session?'), message: meta.title, kind: 'confirm' });
      if (response.cancelled || !response.confirmed) return;
      const result = await api.sessionsDelete(meta.path);
      if (!result.ok) toast(result.error || tr('delete failed'), 'error');
      refreshSessions();
    });
    item.appendChild(actions);

    item.addEventListener('click', () => openSession(meta));
    els.sessionList.appendChild(item);
  }
  markCurrentSession();
  renderTabs();
}

/**
 * The env bar: pi version first, because it is the one thing that changes underneath the GUI
 * (pi is resolved through ~/.pi/agent/install/current-version, so an automatic pi upgrade moves
 * the RPC contract without anyone touching this repo). Amber when the minor version differs from
 * the one this GUI was tested against, red when the major version does.
 */
function renderEnvBar() {
  const info = state.info || {};
  const level = info.piVersionLevel || 'ok';
  els.envInfo.textContent = '';
  const piNode = el('span', `env-pi${level === 'ok' ? '' : ` ${level}`}`, `pi ${info.piVersion || '?'}${level === 'ok' ? '' : ' \u26a0'}`);
  if (level === 'warn') {
    piNode.title =
      tr('pi {pi} is not the version this GUI was tested against ({tested}).\nA minor pi upgrade normally only adds RPC commands, but if prompts, streaming or compaction start misbehaving,\npin pi back to {tested} (or update TESTED_PI_VERSION in lib/pi-launch.js after testing).', { pi: info.piVersion, tested: info.testedPiVersion });
  } else if (level === 'differ') {
    piNode.title = tr('pi {pi} differs from the tested {tested} in its major version, or pi could not be resolved.\nThe RPC framing and the event names may have changed: expect parts of the GUI to be wrong until this repo is updated.', { pi: info.piVersion || tr('(not found)'), tested: info.testedPiVersion });
  } else {
    piNode.title = tr('pi {pi} \u2014 the version this GUI is tested against', { pi: info.piVersion });
  }
  els.envInfo.appendChild(piNode);
  els.envInfo.appendChild(el('span', '', ` \u00b7 electron ${info.electronVersion} \u00b7 ${info.sessionsRoot}`));
  if (level !== 'ok') toast(tr('pi {pi} differs from the tested {tested} \u2014 hover the env bar', { pi: info.piVersion || '?', tested: info.testedPiVersion }), 'warning', 10000);
}
