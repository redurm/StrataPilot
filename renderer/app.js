'use strict';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const api = window.piGui;
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* D10: language (English / 繁體中文 / 简体中文)                        */
/* ------------------------------------------------------------------ */

/*
 * The English source string is the key (see renderer/i18n.js), so this file stays readable in English
 * and tr() is a lookup: tr('New session') -> '新增工作階段'. main owns the catalog files (the renderer
 * has no fs) and the native menu; the renderer pulls the active catalog once at boot and again after a
 * change from Settings. A string with no entry stays English, so a missing translation is visible
 * instead of blank - and test/i18n.test.js is what keeps the catalogs from drifting.
 *
 * What is translated: the app's own chrome (menus, buttons, dialogs, chips, toasts). What is not: pi's
 * output, the log file and the diagnostics report - those are for reading in one language, and a bug
 * report should not depend on the UI language the reporter happened to pick.
 */
const I18N = window.StrataPilotI18n;
let T = I18N.makeT(null, 'en');
const i18nInfo = { pref: 'auto', lang: 'en', systemLocale: 'en', entries: 0 };

function tr(text, params) {
  return T.t(text, params);
}

/*
 * Declares a string as translatable without translating it here. Labels that live in a module-level
 * table (the monitor cards, the usage dropdowns) are stored in English and translated when they are
 * rendered, so the language can change while the app runs; without this the extractor cannot see the
 * string and the catalogs would never be asked for it.
 */
function i18nKey(text) {
  return text;
}

/** Install the catalog main sent and translate the static chrome (index.html). */
function installI18n(payload) {
  if (!payload) return;
  T = I18N.makeT(payload.catalog || null, payload.lang);
  i18nInfo.pref = payload.pref;
  i18nInfo.lang = payload.lang;
  i18nInfo.systemLocale = payload.systemLocale;
  i18nInfo.entries = T.size;
  document.documentElement.lang = payload.lang;
  const changed = I18N.applyDom($('app') || document.body, T);
  console.log(`[i18n] lang=${payload.lang} pref=${payload.pref} system=${payload.systemLocale} entries=${T.size} static_changed=${changed}`);
}

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

/**
 * Pick a language: main saves it and rebuilds its own menu, we re-translate and re-render. Switches are
 * queued, so a save that fires the change twice (applySettings and the submit handler both do) cannot
 * interleave two re-renders.
 */
let languageSwitch = Promise.resolve();

function setLanguage(pref) {
  const wanted = pref || 'auto';
  if (wanted !== i18nInfo.pref) {
    languageSwitch = languageSwitch
      .then(() => applyLanguageSwitch(wanted))
      .catch((err) => console.error('[i18n] language change failed', err));
  }
  return languageSwitch;
}

async function applyLanguageSwitch(pref) {
  if (pref === i18nInfo.pref) return null; // a queued switch got there first
  const payload = await api.i18nSet(pref);
  if (!payload) return null;
  installI18n(payload);
  rerenderChrome();
  return payload;
}

const els = {
  tabs: $('tabs'),
  transcript: $('transcript'),
  sessionList: $('sessionList'),
  sideFoot: $('sideFoot'),
  search: $('search'),
  input: $('input'),
  attachments: $('attachments'),
  modelSel: $('modelSel'),
  thinkingSel: $('thinkingSel'),
  busySel: $('busySel'),
  stats: $('stats'),
  cwdChip: $('cwdChip'),
  queueBar: $('queueBar'),
  nowBar: $('nowBar'),
  btnSend: $('btnSend'),
  btnAbort: $('btnAbort'),
  btnClearQueue: $('btnClearQueue'),
  btnCompact: $('btnCompact'),
  btnStopRetry: $('btnStopRetry'),
  btnRestart: $('btnRestart'),
  extWidgets: $('extWidgets'),
  dropOverlay: $('dropOverlay'),
  modalRoot: $('modalRoot'),
  toasts: $('toasts'),
  envInfo: $('envInfo'),
  body: $('body'),
  fileInput: $('fileInput'),
  queueList: $('queueList'),
  serialToggle: $('serialToggle'),
  btnMonitor: $('btnMonitor'),
  monitorView: $('monitorView'),
  monSrc: $('monSrc'),
  monServers: $('monServers'),
  monBadges: $('monBadges'),
  monStateLabel: $('monStateLabel'),
  monStateDetail: $('monStateDetail'),
  monStateBar: $('monStateBar'),
  monCards: $('monCards'),
  monCtxFill: $('monCtxFill'),
  monCtxPct: $('monCtxPct'),
  monCtxSub: $('monCtxSub'),
  monSlotsText: $('monSlotsText'),
  monSlotsBar: $('monSlotsBar'),
  monRamText: $('monRamText'),
  monRamBar: $('monRamBar'),
  monTempText: $('monTempText'),
  monTempBar: $('monTempBar'),
  monEngineText: $('monEngineText'),
  monReqAll: $('monReqAll'),
  monReqBody: $('monReqBody'),
  monTotals: $('monTotals'),
  monResizer: $('monResizer'),
  slashMenu: $('slashMenu'),
  btnDiag: $('btnDiag'),
  btnSettings: $('btnSettings'),
};

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// Anything bigger than this is too heavy for the RPC `images` payload (base64 JSON line).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// File extension for a clipboard image that arrives without a name (see pasteName()).
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/tiff': 'tiff' };

function fmtBytes(n) {
  if (n == null) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function toast(message, kind = 'info', timeoutMs = 6000) {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'info' ? '' : kind}`.trim();
  node.textContent = message;
  els.toasts.appendChild(node);
  setTimeout(() => node.remove(), timeoutMs);
}

function timeAgo(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (!then) return '';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return tr('just now');
  if (mins < 60) return tr('{n}m ago', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return tr('{n}h ago', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return tr('{n}d ago', { n: days });
  // D10: the bare date follows the UI language, so zh-TW gets 2026/10/19 and not Oct 19, 2026
  return new Date(then).toLocaleDateString(i18nInfo.lang === 'en' ? undefined : i18nInfo.lang);
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(2)}M`;
}

/**
 * The compact token label: `in` is the prompt read that missed the cache, `out` is what the
 * model generated, `cache` is the context re-read from prompt cache. pi defines
 * total = in + out + cache (see pi's `usage.input + usage.output + usage.cacheRead +
 * usage.cacheWrite`), so all three have to be on screen or the chip looks like it does not
 * add up: in a long session the total is mostly re-read context, not new work - one real
 * session reads in 36.5k / out 26.4k but totals 2.33M, because 2.26M of it is cache.
 * `cache` is left out when it is zero, which is exactly when in + out already equals total.
 */
function tokenLabel(u) {
  if (!u) return '';
  const cache = (u.cacheRead || 0) + (u.cacheWrite || 0);
  const label = tr('in {in} / out {out}', { in: fmtTokens(u.input || 0), out: fmtTokens(u.output || 0) });
  return cache ? tr('{label} / cache {cache}', { label, cache: fmtTokens(cache) }) : label;
}

/**
 * Hover text for a token chip: the exact figures behind the compact label, spelled out as
 * the sum so the numbers visibly add up.
 */
function usageTooltip(u) {
  if (!u) return '';
  const cache = (u.cacheRead || 0) + (u.cacheWrite || 0);
  const total = u.totalTokens != null ? u.totalTokens : u.total || 0;
  const lines = [
    tr('in    prompt read, uncached: {n}', { n: nfmt(u.input || 0) }),
    tr('out   generated: {n}', { n: nfmt(u.output || 0) }),
    tr('cache context re-read: {n} (read {read} + write {write})', { n: nfmt(cache), read: nfmt(u.cacheRead || 0), write: nfmt(u.cacheWrite || 0) }),
    tr('total in + out + cache: {n}', { n: nfmt(total) }),
  ];
  if (u.reasoning != null) lines.push(tr('thinking: {n} (included in out)', { n: nfmt(u.reasoning) }));
  return lines.join('\n');
}

function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Split a path so the folder name (the tail) survives truncation: the head shrinks
 * with an ellipsis, the leaf never does. Long Windows paths otherwise all look alike.
 */
function pathParts(value) {
  const text = String(value || '').replace(/\\/g, '/');
  const trimmed = text.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  if (cut <= 0) return { head: trimmed, leaf: '' };
  return { head: trimmed.slice(0, cut + 1), leaf: trimmed.slice(cut + 1) };
}

function appendPath(node, value) {
  const { head, leaf } = pathParts(value);
  const wrap = el('span', 'path-parts');
  if (head) wrap.appendChild(el('span', 'path-head', head));
  wrap.appendChild(el('span', 'path-leaf', leaf || head || '/'));
  node.appendChild(wrap);
}

/** Open a session's working folder in the OS file manager (session files may record a path
 *  that no longer exists, so report failures instead of failing silently). */
async function openFolder(folder) {
  if (!folder) {
    toast('no working folder recorded', 'warning');
    return;
  }
  const res = await api.openPath(folder, false);
  if (res && !res.ok) toast(`${folder}: ${res.error || 'could not open folder'}`, 'error');
}

function truncate(text, limit = 8000) {
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more chars)` : text;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Plain-text blocks (thinking, tool output, notes) keep their newlines but get
// clickable urls. Re-linkifying the whole buffer is cheap: innerHTML is only used
// when the text actually contains "http".
function setPreText(node, text) {
  node._raw = text == null ? '' : String(text);
  if (node._raw.includes('http')) node.innerHTML = window.linkify(node._raw);
  else node.textContent = node._raw;
}

function appendPreText(node, delta) {
  // O(1) per delta: append a text node instead of re-assigning the whole buffer.
  // Linkifying happens once at the end (setPreText), never during streaming.
  if (!delta) return;
  node._raw = (node._raw || '') + delta;
  const details = node.closest ? node.closest('details') : null;
  if (details && !details.open) return; // collapsed block: skip DOM work entirely
  node.appendChild(document.createTextNode(delta));
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

const state = {
  info: null,
  settings: {},
  tabs: new Map(),
  storage: null,
  usage: null,
  theme: 'dark',
  themeMode: 'dark',
  order: [],
  activeId: null,
  cwd: '',
  query: '',
  sessions: [],
  dragDepth: 0,
  tabSeq: 0,
  bashSeq: 0,
  saveTimer: null,
};

function activeTab() {
  return state.tabs.get(state.activeId) || null;
}

function makeTab({ tabId = '', cwd, sessionPath, name, ephemeral, extraArgs = [] }) {
  // A persisted tab id is what makes "Reload interface" cheap after a renderer crash: main.js
  // spawnTab() reuses the live pi process when the id is still the same, so the session, its
  // context and anything running survive the reload instead of being started twice.
  const id = tabId && !state.tabs.has(tabId) ? tabId : `tab-${Date.now().toString(36)}-${++state.tabSeq}`;
  const args = [];
  if (sessionPath) args.push('--session', sessionPath);
  if (ephemeral) args.push('--no-session');
  if (name) args.push('--name', name);
  args.push(...extraArgs);
  const tab = {
    id,
    cwd,
    sessionPath: sessionPath || null,
    sessionId: '',
    name: name || '',
    args,
    ephemeral: !!ephemeral,
    items: [], // {key, kind:'message'|'note'|'bash', ...}
    renderFrom: 0, // first item currently built into the DOM (see renderAll / B2)
    tools: new Map(), // toolCallId -> {name,args,status,result,isError,durationMs,el}
    bashes: new Map(), // bashId -> {command,output,exitCode,status,…} (`!` commands)
    bashRunning: null, // bashId of the command pi is running for this tab
    attachments: [], // {kind:'file'|'dir', path, name, size}
    images: [], // {kind:'image', name, mimeType, data, previewUrl, path}
    inlines: [], // {kind:'inline', name, text}
    outbox: [], // {text, images, at} messages waiting for the serial queue
    // B4: messages that were still queued when the app closed. They are restored as "pending",
    // never sent automatically - firing model requests by itself after a restart is exactly what
    // the user did not ask for - and move into the outbox only when the row says so.
    pendingOutbox: [],
    // pi's own automatic compaction and its own retry of transient provider errors. Both are
    // always on: bootstrap() forces them on through pi's RPC, and the composer has no switch for
    // them. get_state reports autoCompactionEnabled but not the retry policy, so autoRetry only
    // tracks what the GUI last asked for - /retry off is the only thing that can move it, and the
    // next restart puts it back on.
    autoCompact: true,
    autoRetry: true,
    retrying: null, // {attempt, maxAttempts, delayMs} while an auto_retry_start is waiting
    compacting: false, // a compaction (manual or auto) is in flight in this session
    compactStartedAt: 0,
    compactEventSeen: false, // pi already reported this compaction through compaction_end
    compactEventResult: undefined, // outcome carried by the compaction_end event
    exporting: false, // an export_html RPC is in flight for this tab
    exportStartedAt: 0,
    lastExport: null, // {ok, path|error} of the latest /export (also read by the smoke test)
    counters: 0,
    nodes: new Map(), // item key -> rendered node
    streaming: null,
    isStreaming: false,
    alive: false,
    starting: true,
    queued: { steering: [], followUp: [] },
    // the user request this session is working on right now (pinned at the top of the chat)
    currentRequest: null, // {key, text, at, startedAt, endedAt, source}
    // texts we queued through steer/follow_up, so a later message_start can label its source
    pendingQueued: [], // {text, source}
    models: [],
    commands: [], // slash commands pi knows about (get_commands)
    commandsLoaded: false,
    thinkingLevels: ['off'],
    model: null,
    thinking: 'medium',
    stats: null,
    statuses: new Map(),
    widgets: new Map(),
    pendingUserTexts: [],
  };
  state.tabs.set(id, tab);
  state.order.push(id);
  return tab;
}

function nextKey(tab) {
  return `k${++tab.counters}`;
}

/* ------------------------------------------------------------------ */
/* transcript rendering                                                */
/* ------------------------------------------------------------------ */

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function toolArgSummary(name, args) {
  if (!args || typeof args !== 'object') return '';
  const preferred = ['path', 'file', 'filePath', 'command', 'pattern', 'query', 'url', 'dir'];
  for (const key of preferred) {
    if (typeof args[key] === 'string' && args[key]) return `${key}: ${args[key]}`;
  }
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') return `${key}: ${value}`;
  }
  return '';
}

function buildToolCard(tab, toolCallId, toolName, args) {
  let entry = tab.tools.get(toolCallId);
  if (!entry) {
    entry = { name: toolName, args, status: 'pending', result: '', isError: false, durationMs: 0, el: null };
    tab.tools.set(toolCallId, entry);
  } else if (args && Object.keys(args).length) {
    entry.args = args;
  }

  const card = el('div', `tool-card ${entry.status}`);
  card.dataset.toolId = toolCallId;

  const head = el('div', 'tool-head');
  head.appendChild(el('span', 'tool-name', entry.name || toolName || 'tool'));
  const arg = el('span', 'tool-arg');
  head.appendChild(arg);
  const dur = el('span', 'tool-dur');
  head.appendChild(dur);
  card.appendChild(head);

  const body = el('div', 'tool-body hidden');
  card.appendChild(body);

  const paint = (incremental = false) => {
    card.className = `tool-card ${entry.status}`;
    const summary = toolArgSummary(entry.name, entry.args);
    if (summary !== entry._argSummary) {
      entry._argSummary = summary;
      arg.innerHTML = window.linkify(summary);
    }
    dur.textContent = entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : entry.status === 'running' ? 'running…' : '';
    const parts = [];
    if (entry.args && Object.keys(entry.args).length) parts.push(`args: ${JSON.stringify(entry.args, null, 1)}`);
    if (entry.result) parts.push(entry.isError ? `error:\n${entry.result}` : entry.result);
    const text = parts.join('\n\n');
    // partial tool output arrives many times per second: append only the new tail
    if (incremental && body._raw && text.startsWith(body._raw)) {
      const tail = text.slice(body._raw.length);
      body._raw = text;
      if (tail) body.appendChild(document.createTextNode(tail));
    } else {
      setPreText(body, text);
    }
    body.classList.toggle('hidden', parts.length === 0);
  };

  head.addEventListener('click', () => body.classList.toggle('hidden'));
  entry.el = card;
  entry.paint = paint;
  paint();
  return card;
}

function updateToolCard(tab, toolCallId, incremental = false) {
  const entry = tab.tools.get(toolCallId);
  if (!entry) return;
  if (entry.paint) entry.paint(incremental);
}

/* ------------------------------------------------------------------ */
/* bash cards (`!cmd` in the composer, or bashExecution messages)      */
/* ------------------------------------------------------------------ */

function bashEntryFromMessage(message) {
  const exitCode = message.exitCode === undefined ? null : message.exitCode;
  return {
    id: '',
    command: message.command || '',
    output: message.output || '',
    exitCode,
    cancelled: !!message.cancelled,
    truncated: !!message.truncated,
    fullOutputPath: message.fullOutputPath || '',
    excludeFromContext: !!message.excludeFromContext,
    error: '',
    status: message.cancelled ? 'cancelled' : exitCode ? 'error' : 'done',
    startedAt: 0,
    durationMs: 0,
    fromHistory: true,
    el: null,
  };
}

function bashFootText(entry) {
  const bits = [];
  if (entry.error) bits.push(entry.error);
  else if (entry.cancelled) bits.push('cancelled');
  else if (entry.exitCode) bits.push(`exit ${entry.exitCode}`);
  if (entry.truncated) {
    bits.push(entry.fullOutputPath ? `output truncated · full log: ${entry.fullOutputPath}` : 'output truncated');
  }
  if (!entry.fromHistory) {
    bits.push(entry.excludeFromContext ? '!! kept out of the model context' : 'output goes to the model with your next message');
  }
  return bits.join(' · ');
}

function buildBashCard(tab, entry) {
  const card = el('div', `bash-card ${entry.status}`);

  const head = el('div', 'tool-head');
  head.appendChild(el('span', 'tool-name bash-sign', entry.excludeFromContext ? '!!' : '$'));
  const cmd = el('span', 'tool-arg');
  cmd.innerHTML = window.linkify(entry.command);
  head.appendChild(cmd);
  const dur = el('span', 'tool-dur');
  head.appendChild(dur);
  card.appendChild(head);

  const body = el('pre', 'bash-out');
  card.appendChild(body);
  const foot = el('div', 'bash-foot');
  card.appendChild(foot);

  head.addEventListener('click', () => body.classList.toggle('hidden'));
  entry.el = card;
  entry._body = body;
  entry._dur = dur;
  entry._foot = foot;
  paintBashCard(entry);
  return card;
}

function paintBashCard(entry, incremental = false) {
  const card = entry.el;
  if (!card) return;
  card.className = `bash-card ${entry.status}`;
  entry._dur.textContent =
    entry.status === 'running' ? 'running…' : entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : '';

  const text = entry.output || (entry.status === 'running' ? '' : '(no output)');
  if (incremental && entry._body._raw != null && text.startsWith(entry._body._raw)) {
    const tail = text.slice(entry._body._raw.length);
    entry._body._raw = text;
    if (tail) appendPreText(entry._body, tail);
  } else if (entry._body._raw !== text) {
    setPreText(entry._body, text);
  }

  const foot = bashFootText(entry);
  if (foot) {
    entry._foot.classList.remove('hidden');
    if (entry._foot._raw !== foot) {
      entry._foot._raw = foot;
      entry._foot.innerHTML = window.linkify(foot);
    }
  } else {
    entry._foot.classList.add('hidden');
  }
}

function updateBashCard(tab, entry, incremental = false) {
  if (entry) paintBashCard(entry, incremental);
}

/**
 * Hover actions in the message head. `copy` always takes the raw markdown source
 * (contentToText), never the rendered HTML; `resend` is user-only. The wrapper carries
 * `data-key` so the delegated click handler can map a click back to the item.
 */
function buildMessageActions(item, role, text) {
  const actions = el('div', 'msg-actions');

  const copy = el('button', 'copy-btn msg-action', 'copy');
  copy.dataset.msgAction = 'copy';
  copy.dataset.key = item.key;
  copy.title = 'copy this message as raw markdown';
  actions.appendChild(copy);

  if (role === 'user') {
    const resend = el('button', 'copy-btn msg-action', 'resend');
    resend.dataset.msgAction = 'resend';
    resend.dataset.key = item.key;
    if (text) {
      resend.title = 'put this message back in the composer and send it (images are not re-attached)';
    } else {
      // an image-only message has nothing to send: do not offer an empty prompt
      resend.disabled = true;
      resend.title = 'this message has no text to resend';
    }
    actions.appendChild(resend);
  }
  return actions;
}

function buildMessageNode(tab, item) {
  const message = item.message;
  const role = message.role;

  if (role === 'system') return null;

  const wrap = el('div', `msg msg-${role}`);
  const head = el('div', 'msg-head');

  if (role === 'user') {
    head.appendChild(el('span', '', 'you'));
    const ts = message.timestamp ? new Date(message.timestamp) : null;
    if (ts) head.appendChild(el('span', '', ts.toLocaleTimeString()));
    wrap.dataset.key = item.key;
    head.appendChild(buildMessageActions(item, 'user', contentToText(message.content)));
    wrap.appendChild(head);
    const body = el('div', 'msg-body');
    if (typeof message.content === 'string') {
      body.innerHTML = window.linkify(message.content);
    } else {
      for (const block of message.content || []) {
        if (!block) continue;
        if (block.type === 'text') {
          const part = el('div');
          part.innerHTML = window.linkify(block.text);
          body.appendChild(part);
        } else if (block.type === 'image') {
          const img = document.createElement('img');
          img.src = `data:${block.mimeType};base64,${block.data}`;
          img.style.maxWidth = '260px';
          img.style.borderRadius = '6px';
          body.appendChild(img);
        }
      }
    }
    wrap.appendChild(body);
    return wrap;
  }

  if (role === 'assistant') {
    head.appendChild(el('span', '', message.model || 'assistant'));
    if (message.thinkingLevel && message.thinkingLevel !== 'off') head.appendChild(el('span', '', `thinking: ${message.thinkingLevel}`));
    if (message.usage && message.usage.totalTokens) {
      const u = message.usage;
      const tokChip = el('span', '', tokenLabel(u));
      tokChip.title = usageTooltip(u);
      head.appendChild(tokChip);
      const cost = message.usage.cost && message.usage.cost.total;
      if (cost) head.appendChild(el('span', '', `$${cost.toFixed(4)}`));
    }
    if (message.stopReason && message.stopReason !== 'stop' && message.stopReason !== 'toolUse') {
      head.appendChild(el('span', '', `stop: ${message.stopReason}`));
    }
    wrap.dataset.key = item.key;
    head.appendChild(buildMessageActions(item, 'assistant', contentToText(message.content)));
    wrap.appendChild(head);

    for (const block of message.content || []) {
      if (!block) continue;
      if (block.type === 'text') {
        if (!block.text) continue;
        const div = el('div', 'msg-body');
        div.innerHTML = window.mdToHtml(block.text);
        wrap.appendChild(div);
      } else if (block.type === 'thinking') {
        const details = document.createElement('details');
        details.className = 'thinking';
        const summary = document.createElement('summary');
        summary.textContent = block.redacted ? 'thinking (redacted)' : 'thinking';
        details.appendChild(summary);
        if (block.thinking) {
          const pre = el('pre');
          setPreText(pre, block.thinking);
          details.appendChild(pre);
        }
        wrap.appendChild(details);
      } else if (block.type === 'toolCall') {
        wrap.appendChild(buildToolCard(tab, block.id, block.name, block.arguments));
      }
    }
    if (message.errorMessage) {
      const note = el('div', 'note error', message.errorMessage);
      wrap.appendChild(note);
    }
    return wrap;
  }

  if (role === 'toolResult') {
    const entry = tab.tools.get(message.toolCallId);
    if (entry) {
      entry.result = truncate(contentToText(message.content), 12000);
      entry.isError = !!message.isError;
      entry.status = message.isError ? 'error' : 'done';
      updateToolCard(tab, message.toolCallId);
      return null;
    }
    const note = el('div', `note ${message.isError ? 'error' : ''}`.trim());
    setPreText(note, `${message.toolName || 'tool'}: ${truncate(contentToText(message.content), 2000)}`);
    return note;
  }

  if (role === 'bashExecution') {
    // pi stores every `!cmd` run as a bashExecution message, so the card survives a reopen
    return buildBashCard(tab, bashEntryFromMessage(message));
  }

  if (role === 'compactionSummary' || role === 'branchSummary') {
    const details = document.createElement('details');
    details.className = 'note compact';
    details.style.display = 'block';
    const summary = document.createElement('summary');
    summary.textContent = role === 'compactionSummary' ? `compacted ${fmtTokens(message.tokensBefore || 0)} tokens` : 'branch summary';
    details.appendChild(summary);
    details.appendChild(el('pre', '', message.summary || ''));
    details.querySelector('pre').style.whiteSpace = 'pre-wrap';
    details.querySelector('pre').style.fontFamily = 'inherit';
    return details;
  }

  if (role === 'custom') {
    if (message.display === false) return null;
    return el('div', 'note', `[${message.customType || 'custom'}] ${truncate(contentToText(message.content), 2000)}`);
  }

  return el('div', 'note', `[${role}] ${truncate(JSON.stringify(message.content ?? message), 1200)}`);
}

function buildNoteNode(item) {
  const node = el('div', `note ${item.noteType || ''}`.trim());
  setPreText(node, item.text);
  return node;
}

function buildItemNode(tab, item) {
  if (item.kind === 'note') return buildNoteNode(item);
  if (item.kind === 'tool') return buildToolCard(tab, item.toolCallId, item.toolName, item.args);
  if (item.kind === 'bash') {
    const entry = item.entry || tab.bashes.get(item.bashId) || bashEntryFromMessage(item.message || {});
    return buildBashCard(tab, entry);
  }
  return buildMessageNode(tab, item);
}

function appendItem(tab, item) {
  tab.items.push(item);
  if (state.activeId === tab.id) {
    const hint = els.transcript.querySelector('.empty-hint');
    if (hint) hint.remove();
    const node = buildItemNode(tab, item);
    if (node) {
      tab.nodes.set(item.key, node);
      els.transcript.appendChild(node);
      autoscroll();
    }
  }
}

function pushNote(tab, text, noteType = '') {
  appendItem(tab, { key: nextKey(tab), kind: 'note', noteType, text });
}

function isScrolledUp() {
  const t = els.transcript;
  return t.scrollHeight - t.scrollTop - t.clientHeight > 120;
}

let scrollScheduled = false;

/**
 * Transcript windowing (B2). A session can hold 600+ messages (the README's worst case is an 86 MB
 * file), and building every message node at once is what made opening such a session feel like a
 * freeze. Only the tail is rendered; a control at the top pulls in earlier pages on demand.
 *
 * tab.items always holds the whole conversation (search, jump and the pinned bars work on all of
 * it); tab.nodes only exists for what is on screen.
 */
const TRANSCRIPT_WINDOW = 120;
const TRANSCRIPT_PAGE = 150;

function transcriptMore(tab, start) {
  const row = el('div', 'transcript-more');
  row.appendChild(el('div', 'tm-note', `${start} earlier message${start === 1 ? '' : 's'} not shown`));
  const button = el('button', 'ghost', `show ${Math.min(TRANSCRIPT_PAGE, start)} earlier`);
  button.title = 'Rendering only the tail keeps big sessions fast; this adds the page above';
  button.addEventListener('click', () => showEarlierMessages(tab));
  row.appendChild(button);
  return row;
}

/** Prepend one page of history without moving the part of the transcript you are looking at. */
function showEarlierMessages(tab) {
  const anchorKey = tab.items[tab.renderFrom] ? tab.items[tab.renderFrom].key : '';
  const anchor = tab.nodes.get(anchorKey);
  const anchorTop = anchor ? anchor.offsetTop : 0;
  const from = Math.max(0, tab.renderFrom - TRANSCRIPT_PAGE);
  renderAll(tab, { from });
  const moved = tab.nodes.get(anchorKey);
  if (moved) els.transcript.scrollTop = Math.max(0, moved.offsetTop - anchorTop);
  else els.transcript.scrollTop = 0;
}

function autoscroll(force = false) {
  // reading scrollHeight forces a synchronous layout, and thinking/text deltas arrive
  // many times per second -> throttle to one layout read per animation frame
  if (force) {
    els.transcript.scrollTop = els.transcript.scrollHeight;
    return;
  }
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    scrollScheduled = false;
    if (!isScrolledUp()) els.transcript.scrollTop = els.transcript.scrollHeight;
  });
}

function renderAll(tab, { from = null } = {}) {
  els.transcript.textContent = '';
  tab.nodes.clear();
  if (!tab.items.length) {
    tab.renderFrom = 0;
    const hint = el('div', 'empty-hint');
    hint.innerHTML =
      `${tr('No messages yet.')}<br />${tr('Type a prompt, or drop files anywhere in the window to attach them.')}<br /><kbd>Ctrl</kbd> + <kbd>T</kbd> ${tr('new session')} &nbsp; <kbd>Ctrl</kbd> + <kbd>O</kbd> ${tr('open session')} &nbsp; <kbd>Ctrl</kbd> + <kbd>B</kbd> ${tr('sidebar')}`;
    els.transcript.appendChild(hint);
    return;
  }
  const start = from == null ? Math.max(0, tab.items.length - TRANSCRIPT_WINDOW) : Math.max(0, Math.min(from, tab.items.length - 1));
  tab.renderFrom = start;
  const frag = document.createDocumentFragment();
  if (start > 0) frag.appendChild(transcriptMore(tab, start));
  let built = 0;
  for (const item of tab.items.slice(start)) {
    const node = buildItemNode(tab, item);
    if (!node) continue;
    tab.nodes.set(item.key, node);
    frag.appendChild(node);
    built += 1;
  }
  els.transcript.appendChild(frag);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  if (start > 0) {
    console.log(`[transcript] ${tab.id}: rendered ${built} of ${tab.items.length} items (window from ${start})`);
  }
}

/* ------------------------------------------------------------------ */
/* streaming                                                           */
/* ------------------------------------------------------------------ */

function startStreamingMessage(tab, message) {
  const copy = { ...message, content: Array.isArray(message.content) ? [...message.content] : [] };
  const item = { key: nextKey(tab), kind: 'message', message: copy };
  tab.items.push(item);
  const live = { tab, item, messageNode: null, textEls: new Map() };
  tab.streaming = live;

  if (state.activeId === tab.id) {
    const node = buildMessageNode(tab, item) || el('div', 'msg msg-assistant');
    node.classList.add('streaming');
    tab.nodes.set(item.key, node);
    els.transcript.appendChild(node);
    live.messageNode = node;
    for (let i = 0; i < copy.content.length; i++) ensureBlockNode(message, i, live);
    autoscroll(true);
  }
  return live;
}

/** Create (or reuse) the live DOM node for content block `index`. */
function ensureBlockNode(message, index, live) {
  const block = message.content[index];
  if (!block || !live.messageNode) return null;
  const existing = live.textEls.get(index);
  if (existing) return existing;
  let node = null;
  if (block.type === 'text') {
    node = el('div', 'msg-body stream-text');
    node.textContent = block.text || '';
  } else if (block.type === 'thinking') {
    const details = document.createElement('details');
    details.className = 'thinking';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'thinking…';
    const pre = el('pre');
    setPreText(pre, block.thinking || '');
    details.appendChild(summary);
    details.appendChild(pre);
    node = details;
    node._pre = pre;
    // while collapsed we skip DOM writes; re-render the whole buffer when the user opens it
    details.addEventListener('toggle', () => {
      if (details.open) setPreText(pre, pre._raw || '');
    });
  } else if (block.type === 'toolCall') {
    node = buildToolCard(live.tab, block.id, block.name, block.arguments);
  }
  if (node) {
    live.messageNode.appendChild(node);
    live.textEls.set(index, node);
  }
  return node;
}

function applyUpdate(tab, update) {
  const live = tab.streaming;
  if (!live) return;
  const message = live.item.message;
  const ev = update.assistantMessageEvent || {};
  const idx = ev.contentIndex ?? 0;
  if (!Array.isArray(message.content)) message.content = [];

  const isActive = state.activeId === tab.id;
  const node = isActive ? live.textEls.get(idx) : null;
  const ensure = () => (isActive ? ensureBlockNode(message, idx, live) : null);

  switch (ev.type) {
    case 'text_start':
      message.content[idx] = { type: 'text', text: '' };
      if (!node) ensure();
      break;
    case 'text_delta': {
      const block = message.content[idx];
      if (!block || block.type !== 'text') message.content[idx] = { type: 'text', text: '' };
      message.content[idx].text += ev.delta || '';
      if (node && node.classList.contains('stream-text')) node.textContent += ev.delta || '';
      autoscroll();
      break;
    }
    case 'text_end': {
      const block = message.content[idx] || { type: 'text', text: '' };
      block.type = 'text';
      block.text = ev.content ?? block.text;
      message.content[idx] = block;
      if (node && node.classList.contains('stream-text')) node.textContent = block.text;
      break;
    }
    case 'thinking_start':
      message.content[idx] = { type: 'thinking', thinking: '' };
      if (!node) ensure();
      break;
    case 'thinking_delta': {
      const block = message.content[idx];
      if (!block || block.type !== 'thinking') message.content[idx] = { type: 'thinking', thinking: '' };
      message.content[idx].thinking += ev.delta || '';
      if (node && node._pre) {
        appendPreText(node._pre, ev.delta);
        autoscroll();
      }
      break;
    }
    case 'thinking_end': {
      const block = message.content[idx] || { type: 'thinking', thinking: '' };
      block.type = 'thinking';
      block.thinking = ev.content ?? block.thinking;
      message.content[idx] = block;
      if (node && node._pre) setPreText(node._pre, block.thinking);
      break;
    }
    case 'toolcall_start':
      message.content[idx] = { type: 'toolCall', id: ev.id, name: ev.toolName, arguments: {} };
      if (!node) ensure();
      break;
    case 'toolcall_delta': {
      const block = message.content[idx];
      if (block && block.type === 'toolCall') block._raw = (block._raw || '') + (ev.delta || '');
      break;
    }
    case 'toolcall_end': {
      if (ev.toolCall) {
        message.content[idx] = { ...ev.toolCall };
        updateToolCard(tab, ev.toolCall.id);
      }
      break;
    }
    default:
      break;
  }
  if (update.usage) message.usage = update.usage;
}

function finishStreaming(tab, message) {
  const live = tab.streaming;
  if (!live) {
    appendItem(tab, { key: nextKey(tab), kind: 'message', message });
    return;
  }
  live.item.message = message;
  tab.streaming = null;
  const node = tab.nodes.get(live.item.key);
  if (node) {
    const fresh = buildMessageNode(tab, live.item);
    node.replaceWith(fresh || document.createComment(''));
    tab.nodes.set(live.item.key, fresh);
  }
  autoscroll();
}

/* ------------------------------------------------------------------ */
/* RPC event handling                                                  */
/* ------------------------------------------------------------------ */

function handleRecord(tab, record) {
  switch (record.type) {
    case 'agent_start':
      tab.isStreaming = true;
      renderTabs();
      renderComposerState();
      renderPinnedBars(tab);
      scheduler.onAgentStart(tab);
      break;
    case 'agent_end':
      if (record.willRetry) pushNote(tab, 'retrying…', 'warn');
      break;
    case 'agent_settled':
      tab.isStreaming = false;
      tab.streaming = null;
      finishRequest(tab);
      if (record.aborted) pushNote(tab, 'run aborted', 'warn');
      renderTabs();
      renderComposerState();
      refreshStats(tab);
      refreshSessionsSoon();
      scheduleUsageSummary(); // D9: the run is over, so its tokens are in the session file now
      if (tab.pendingCompact != null) {
        // a compaction the user queued while this session was running: run it now (idle),
        // then let the scheduler start whatever this session still has queued
        const instructions = tab.pendingCompact;
        tab.pendingCompact = null;
        runCompact(tab, instructions).finally(() => scheduler.onSettled(tab));
      } else {
        scheduler.onSettled(tab);
      }
      break;
    case 'message_start': {
      const message = record.message;
      if (message.role === 'assistant') {
        startStreamingMessage(tab, message);
      } else if (message.role === 'user') {
        const text = contentToText(message.content);
        const at = tab.pendingUserTexts.indexOf(text);
        if (at >= 0) {
          // pi echoing back the prompt we already appended in deliverPrompt()
          tab.pendingUserTexts.splice(at, 1);
          if (!tab.currentRequest || tab.currentRequest.text !== text) {
            setCurrentRequest(tab, { text, at: message.timestamp, source: 'prompt' });
          }
        } else {
          // a user message we never appended: pi delivering a queued steering / follow-up
          // message, another client driving the same session, or an extension prompt
          const key = nextKey(tab);
          appendItem(tab, { key, kind: 'message', message });
          const queuedAt = tab.pendingQueued.findIndex((item) => item.text === text);
          const source = queuedAt >= 0 ? tab.pendingQueued.splice(queuedAt, 1)[0].source : 'prompt';
          setCurrentRequest(tab, { key, text, at: message.timestamp, source });
        }
      }
      break;
    }
    case 'message_update':
      applyUpdate(tab, record);
      break;
    case 'message_end':
      if (record.message.role === 'assistant') finishStreaming(tab, record.message);
      break;
    case 'tool_execution_start': {
      if (!tab.tools.get(record.toolCallId)) {
        appendItem(tab, { key: nextKey(tab), kind: 'tool', toolCallId: record.toolCallId, toolName: record.toolName, args: record.args });
      }
      const entry = tab.tools.get(record.toolCallId);
      entry.status = 'running';
      entry.args = record.args || entry.args;
      entry.name = record.toolName || entry.name;
      updateToolCard(tab, record.toolCallId);
      break;
    }
    case 'tool_execution_update': {
      const entry = tab.tools.get(record.toolCallId);
      if (entry) {
        const partial = record.partialResult && record.partialResult.content ? contentToText(record.partialResult.content) : '';
        if (partial) entry.result = truncate(partial, 4000);
        updateToolCard(tab, record.toolCallId, true);
      }
      break;
    }
    case 'tool_execution_end': {
      const entry = tab.tools.get(record.toolCallId);
      if (!entry) break;
      entry.status = record.isError ? 'error' : 'done';
      entry.isError = !!record.isError;
      entry.durationMs = record.durationMs || 0;
      entry.result = truncate(record.result && record.result.content ? contentToText(record.result.content) : '', 12000);
      updateToolCard(tab, record.toolCallId);
      break;
    }
    case 'queue_update':
      tab.queued = { steering: record.steering || [], followUp: record.followUp || [] };
      renderQueueBar(tab);
      break;
    case 'session_info_changed':
      tab.name = record.name || '';
      renderTabs();
      scheduleSave();
      break;
    case 'thinking_level_changed':
      tab.thinking = record.level;
      renderSelectors(tab);
      break;
    case 'compaction_start':
      // pi emits this for manual AND automatic compaction, so it is the authoritative
      // "this session is busy summarizing" signal: drive the queue from it.
      tab.compacting = true;
      tab.compactStartedAt = Date.now();
      tab.compactEventSeen = false;
      tab.compactEventResult = undefined;
      pushNote(tab, `compacting (${record.reason})…`, 'compact');
      renderTabs();
      renderOpenSessions();
      renderComposerState();
      renderPinnedBars(tab);
      break;
    case 'compaction_end':
      tab.compacting = false;
      tab.compactStartedAt = 0;
      tab.compactEventSeen = true;
      tab.compactEventResult = record.result || null;
      if (record.result) pushNote(tab, `compacted ${fmtTokens(record.result.tokensBefore)} → ~${fmtTokens(record.result.estimatedTokensAfter)} tokens`, 'compact');
      else if (record.aborted) pushNote(tab, 'compaction cancelled', 'warn');
      else if (record.errorMessage) pushNote(tab, `compaction failed: ${record.errorMessage}`, 'error');
      refreshStats(tab);
      refreshSessionsSoon();
      scheduleUsageSummary(); // a compaction is a model call: its usage belongs in the ledger too
      renderTabs();
      renderOpenSessions();
      renderComposerState();
      renderPinnedBars(tab);
      scheduler.pumpSoon(400); // a running compaction was holding the serial queue
      break;
    case 'auto_retry_start':
      tab.retrying = { attempt: record.attempt || 1, maxAttempts: record.maxAttempts || 0, delayMs: record.delayMs || 0 };
      pushNote(tab, `retry ${record.attempt}/${record.maxAttempts} in ${record.delayMs}ms: ${record.errorMessage}`, 'warn');
      renderComposerState();
      break;
    case 'auto_retry_end':
      tab.retrying = null;
      if (!record.success) pushNote(tab, `retry failed after ${record.attempt} attempts: ${record.finalError || ''}`, 'error');
      renderComposerState();
      break;
    case 'entry_appended':
      if (record.entry && record.entry.type === 'custom') pushNote(tab, `[${record.entry.customType}] ${truncate(JSON.stringify(record.entry.data ?? ''), 800)}`);
      break;
    case 'extension_error':
      pushNote(tab, `extension error (${record.event}): ${record.error}`, 'error');
      break;
    case 'extension_ui_request':
      handleExtensionUi(tab, record);
      break;
    case 'bash_execution_update': {
      // pi streams every output chunk of a running `!cmd`; the id matches the `bash` command
      // we sent (see runBash). Commands we did not start (an extension running bash) get a card too.
      let entry = record.id ? tab.bashes.get(record.id) : null;
      if (!entry) {
        const id = record.id || `ext${++state.bashSeq}`;
        entry = {
          id, command: '(bash started by an extension)', output: '', exitCode: null, cancelled: false,
          truncated: false, fullOutputPath: '', excludeFromContext: false, error: '', status: 'running',
          startedAt: Date.now(), durationMs: 0, fromHistory: false, el: null,
        };
        tab.bashes.set(id, entry);
        if (!tab.bashRunning) tab.bashRunning = id;
        appendItem(tab, { key: nextKey(tab), kind: 'bash', bashId: id });
        renderComposerState();
      }
      if (record.delta) {
        entry.output += record.delta;
        updateBashCard(tab, entry, true);
        autoscroll();
      }
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* extension UI                                                        */
/* ------------------------------------------------------------------ */

function handleExtensionUi(tab, req) {
  switch (req.method) {
    case 'select':
      openModal({
        title: req.title || 'Choose',
        message: req.message,
        kind: 'select',
        options: req.options || [],
        timeoutMs: req.timeout,
      }).then((response) => api.uiResponse(tab.id, { id: req.id, ...response }));
      break;
    case 'confirm':
      openModal({
        title: req.title || 'Confirm',
        message: req.message,
        kind: 'confirm',
        timeoutMs: req.timeout,
      }).then((response) => api.uiResponse(tab.id, { id: req.id, ...response }));
      break;
    case 'input':
      openModal({
        title: req.title || 'Input',
        message: req.message,
        kind: 'input',
        placeholder: req.placeholder,
        timeoutMs: req.timeout,
      }).then((response) => api.uiResponse(tab.id, { id: req.id, ...response }));
      break;
    case 'editor':
      openModal({
        title: req.title || 'Edit text',
        kind: 'editor',
        prefill: req.prefill || '',
        timeoutMs: req.timeout,
      }).then((response) => api.uiResponse(tab.id, { id: req.id, ...response }));
      break;
    case 'notify':
      toast(req.message || '', req.notifyType === 'info' ? 'info' : req.notifyType || 'info');
      break;
    case 'setStatus':
      if (req.statusText == null) tab.statuses.delete(req.statusKey);
      else tab.statuses.set(req.statusKey, req.statusText);
      renderStats(tab);
      break;
    case 'setWidget':
      if (!req.widgetLines) tab.widgets.delete(req.widgetKey);
      else tab.widgets.set(req.widgetKey, { lines: req.widgetLines, placement: req.widgetPlacement || 'aboveEditor' });
      renderWidgets(tab);
      break;
    case 'setTitle':
      document.title = req.title || 'StrataPilot';
      break;
    case 'set_editor_text':
      els.input.value = req.text || '';
      els.input.focus();
      break;
    default:
      break;
  }
}

let modalOpen = null;

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

/* ------------------------------------------------------------------ */
/* tabs UI                                                             */
/* ------------------------------------------------------------------ */

function tabLabel(tab) {
  if (tab.name) return tab.name;
  const meta = state.sessions.find((s) => samePath(s.path, tab.sessionPath));
  if (meta && meta.title && meta.messageCount) return meta.title;
  const firstUser = tab.items.find((item) => item.kind === 'message' && item.message && item.message.role === 'user');
  if (firstUser) {
    const text = contentToText(firstUser.message.content).split('\n')[0].trim();
    if (text) return text.length > 42 ? `${text.slice(0, 42)}…` : text;
  }
  if (tab.items.length && tab.sessionPath) {
    return tab.sessionPath.split(/[\\/]/).pop().replace(/\.jsonl$/, '').slice(0, 24);
  }
  return tab.starting ? 'starting…' : 'new session';
}

/**
 * D5: the model a tab is on, shortened for the tab strip. The thinking level is only shown when it
 * is not the pi default (medium), because that is the case people are surprised by.
 */
function tabModelTag(tab) {
  if (!tab.model || !tab.model.id) return null;
  const id = String(tab.model.id);
  const short = id.length > 16 ? `${id.slice(0, 15)}\u2026` : id;
  const level = tab.thinking && tab.thinking !== 'medium' ? ` \u00b7 ${tab.thinking}` : '';
  return { text: short, title: `${tab.model.provider ? `${tab.model.provider}/` : ''}${id}${level}${tab.model.baseUrl ? `\n${tab.model.baseUrl}` : ''}` };
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

/* ------------------------------------------------------------------ */
/* pinned request bars                                                 */
/*   top    (nowBar):   the user request this session is working on    */
/*   bottom (queueBar): everything pi/GUI still has to process         */
/* ------------------------------------------------------------------ */

const REQUEST_SOURCE_LABEL = {
  prompt: i18nKey('prompt'),
  steer: i18nKey('steering'),
  follow_up: i18nKey('follow-up'),
  bash: i18nKey('bash'),
  history: i18nKey('earlier'),
};

function toMillis(value) {
  if (!value) return 0;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function fmtDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`;
}

/** Single-line preview used by both pinned bars. */
function oneLine(text, limit = 240) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** Remember which user request this session is now working on (top bar). */
function setCurrentRequest(tab, { key = null, text, at = 0, source = 'prompt' }) {
  const clean = String(text == null ? '' : text).trim();
  if (!clean) return;
  tab.currentRequest = {
    key,
    text: clean,
    at: toMillis(at) || Date.now(),
    startedAt: Date.now(),
    endedAt: 0,
    source,
  };
  renderPinnedBars(tab);
}

function finishRequest(tab) {
  const req = tab.currentRequest;
  if (!req || req.endedAt) return;
  req.endedAt = Date.now();
  renderPinnedBars(tab);
}

function requestIsBusy(tab) {
  return !!(tab && (tab.isStreaming || tab.compacting || tab.bashRunning));
}

function renderPinnedBars(tab) {
  const target = tab || activeTab();
  renderNowBar(target);
  renderQueueBar(target);
}

function requestElapsed(req) {
  return req.startedAt ? (req.endedAt || Date.now()) - req.startedAt : 0;
}

function paintRequestTime(node, req) {
  if (!node || !req || !req.startedAt) return;
  node.textContent = req.endedAt ? fmtDuration(requestElapsed(req)) : `${fmtDuration(requestElapsed(req))}…`;
}

function jumpToItem(tab, key) {
  let node = tab.nodes.get(key);
  if (!node) {
    // the transcript is windowed (B2): the message we are jumping to may be above the rendered
    // page, so pull in exactly the page that contains it instead of building the whole session
    const index = tab.items.findIndex((item) => item.key === key);
    if (index < 0) return;
    renderAll(tab, { from: Math.max(0, index - 20) });
    node = tab.nodes.get(key);
    if (!node) return;
  }
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1400);
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

function activateTab(tabId) {
  state.activeId = tabId;
  const tab = activeTab();
  renderTabs();
  renderSelectors(tab);
  renderStats(tab);
  renderPinnedBars(tab);
  renderWidgets(tab);
  renderAttachments();
  renderComposerState();
  renderOpenSessions();
  if (tab) renderAll(tab);
  else {
    els.transcript.textContent = '';
  }
  closeSlashMenu();
  markCurrentSession();
  els.input.focus();
}

async function closeTab(tabId) {
  const closing = state.tabs.get(tabId);
  await api.dispose(tabId);
  if (closing) scheduler.onTabClosed(closing);
  state.tabs.delete(tabId);
  state.order = state.order.filter((id) => id !== tabId);
  if (state.activeId === tabId) {
    const next = state.order[state.order.length - 1] || null;
    activateTab(next);
  } else {
    renderTabs();
  }
  scheduleSave();
}

async function renameActiveSession(tab) {
  const target = tab || activeTab();
  if (!target) return;
  const response = await openModal({ title: 'Session name', kind: 'input', prefill: target.name || '', placeholder: 'my-feature-work' });
  if (response.cancelled) return;
  const name = String(response.value || '').trim();
  if (!name) return;
  if (target.alive) {
    const res = await api.cmd(target.id, 'set_session_name', { name });
    if (!res.success) toast(res.error || 'rename failed', 'error');
  } else if (target.sessionPath) {
    await api.sessionsRename(target.sessionPath, name);
  }
  target.name = name;
  renderTabs();
  refreshSessions();
}

/* ------------------------------------------------------------------ */
/* serial queue: one session at a time (strata is single-flight)       */
/* ------------------------------------------------------------------ */

const scheduler = {
  enabled: true,
  runningTabId: null,
  starting: false,
  timer: null,

  pumpSoon(delay = 200) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pump(), delay);
  },

  pump() {
    if (!this.enabled || this.starting) return;
    const tabs = () => state.order.map((id) => state.tabs.get(id));
    const streaming = tabs().find((tab) => tab && tab.alive && tab.isStreaming);
    if (streaming) {
      this.runningTabId = streaming.id;
      renderOpenSessions();
      renderTabs();
      return;
    }
    // compaction is a model call too: while any session is summarizing, the single-flight
    // provider is busy and pi refuses prompts in that session
    const compacting = tabs().find((tab) => tab && tab.alive && tab.compacting);
    if (compacting) {
      this.runningTabId = null;
      renderOpenSessions();
      renderTabs();
      return;
    }
    this.runningTabId = null;
    for (const tabId of state.order) {
      const tab = state.tabs.get(tabId);
      if (!tab || !tab.alive || !tab.outbox.length || tab.compacting) continue;
      this.startTab(tab);
      return;
    }
    renderOpenSessions();
    renderTabs();
  },

  async startTab(tab) {
    const item = tab.outbox.shift();
    if (!item) return { ok: false };
    scheduleSave(); // the outbox is the crash-recoverable part of the queue
    this.starting = true;
    this.runningTabId = tab.id;
    tab.isStreaming = true;
    renderTabs();
    renderOpenSessions();
    renderComposerState();
    const result = await deliverPrompt(tab, item);
    this.starting = false;
    if (!result.ok) {
      tab.isStreaming = false;
      tab.outbox.unshift(item);
      this.runningTabId = null;
      this.pumpSoon(result.deferred ? 5000 : 3000);
    }
    renderTabs();
    renderOpenSessions();
    return result;
  },

  onAgentStart(tab) {
    if (!this.enabled) return;
    if (!this.runningTabId) this.runningTabId = tab.id;
    renderOpenSessions();
    renderTabs();
  },

  onSettled(tab) {
    if (this.runningTabId === tab.id) this.runningTabId = null;
    renderOpenSessions();
    if (this.enabled) this.pumpSoon(200);
  },

  onTabClosed(tab) {
    if (this.runningTabId === tab.id) this.runningTabId = null;
    if (this.enabled) this.pumpSoon(0);
  },

  workingPosition(tabId) {
    const working = state.order.map((id) => state.tabs.get(id)).filter((tab) => tab && isWorking(tab));
    return working.findIndex((tab) => tab.id === tabId) + 1;
  },
};

function isWorking(tab) {
  if (!tab) return false;
  return !!tab.isStreaming || !!tab.compacting || tab.outbox.length > 0 || scheduler.runningTabId === tab.id;
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
    `${restored.length} queued message${restored.length === 1 ? '' : 's'} from the previous run ${restored.length === 1 ? 'is' : 'are'} held back and will NOT be sent on their own.` +
      ' Open the **pending** badge in the queue row to send them or drop them.' +
      (dropped ? ` ${dropped} message${dropped === 1 ? ' has' : 's'} image${dropped === 1 ? 's' : 's'} too large to store, they were dropped.` : ''),
    'warn',
  );
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

let dragTabId = null;

function clearDropMarkers() {
  for (const node of els.queueList.querySelectorAll('.drop-before, .drop-after')) {
    node.classList.remove('drop-before', 'drop-after');
  }
}

function wireRowDrag(row, tabId) {
  row.addEventListener('dragstart', (event) => {
    dragTabId = tabId;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-stratapilot-tab', tabId);
    event.dataTransfer.setData('text/plain', tabLabel(state.tabs.get(tabId)));
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    clearDropMarkers();
    dragTabId = null;
  });
  row.addEventListener('dragover', (event) => {
    if (!dragTabId || dragTabId === tabId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
  row.addEventListener('drop', (event) => {
    if (!dragTabId) return;
    event.preventDefault();
    event.stopPropagation();
    const after = row.classList.contains('drop-after');
    const sourceId = dragTabId || event.dataTransfer.getData('text/x-stratapilot-tab');
    clearDropMarkers();
    moveTabBefore(sourceId, tabId, after);
  });
}

function moveTabTo(tabId, index) {
  const from = state.order.indexOf(tabId);
  if (from < 0) return;
  state.order.splice(from, 1);
  state.order.splice(Math.max(0, Math.min(index, state.order.length)), 0, tabId);
  renderTabs();
  renderOpenSessions();
  scheduler.pumpSoon(0);
  scheduleSave();
}

function moveTabBefore(sourceId, targetId, after, options = {}) {
  if (!sourceId || sourceId === targetId) return false;
  const from = state.order.indexOf(sourceId);
  if (from < 0) return false;
  state.order.splice(from, 1);
  let to = state.order.indexOf(targetId);
  if (to < 0) to = state.order.length - 1;
  state.order.splice(after ? to + 1 : to, 0, sourceId);
  renderTabs();
  renderOpenSessions();
  scheduler.pumpSoon(0);
  scheduleSave();
  if (!options.silent) toast(`reordered: ${tabLabel(state.tabs.get(sourceId))} is now #${state.order.indexOf(sourceId) + 1} in the tab list`);
  return true;
}

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

/* ------------------------------------------------------------------ */
/* session bootstrap                                                   */
/* ------------------------------------------------------------------ */

async function bootstrap(tab) {
  const stateRes = await api.cmd(tab.id, 'get_state');
  if (stateRes.success && stateRes.data) {
    const data = stateRes.data;
    tab.model = data.model || null;
    tab.thinking = data.thinkingLevel || tab.thinking;
    tab.sessionId = data.sessionId || '';
    tab.sessionPath = data.sessionFile || tab.sessionPath;
    tab.name = data.sessionName || tab.name;
    tab.isStreaming = !!data.isStreaming;
    tab.autoCompact = data.autoCompactionEnabled !== false;
  }
  await ensureAlwaysOn(tab);

  const modelsRes = await api.cmd(tab.id, 'get_available_models');
  if (modelsRes.success && modelsRes.data && modelsRes.data.models) {
    tab.models = modelsRes.data.models;
  }
  const levelsRes = await api.cmd(tab.id, 'get_available_thinking_levels');
  if (levelsRes.success && levelsRes.data && levelsRes.data.levels) {
    tab.thinkingLevels = levelsRes.data.levels;
  }
  await loadCommands(tab);

  const messagesRes = await api.cmd(tab.id, 'get_messages');
  if (messagesRes.success && messagesRes.data && messagesRes.data.messages) {
    // Pre-register tool results so cards render complete when rebuilt.
    for (const message of messagesRes.data.messages) {
      if (message.role === 'toolResult') {
        const entry = tab.tools.get(message.toolCallId) || { name: message.toolName, args: {}, status: 'done', result: '', isError: false, durationMs: 0 };
        entry.result = truncate(contentToText(message.content), 12000);
        entry.isError = !!message.isError;
        entry.status = message.isError ? 'error' : 'done';
        tab.tools.set(message.toolCallId, entry);
      }
    }
    tab.items = messagesRes.data.messages.map((message) =>
      message.role === 'bashExecution'
        ? { key: nextKey(tab), kind: 'bash', entry: bashEntryFromMessage(message) }
        : { key: nextKey(tab), kind: 'message', message },
    );
    // pin the last user request of the reopened session so the top bar is not empty
    for (let i = tab.items.length - 1; i >= 0; i--) {
      const item = tab.items[i];
      if (item.kind !== 'message' || item.message.role !== 'user') continue;
      const text = contentToText(item.message.content);
      if (!text) continue;
      tab.currentRequest = {
        key: item.key,
        text,
        at: toMillis(item.message.timestamp) || Date.now(),
        startedAt: toMillis(item.message.timestamp),
        endedAt: tab.isStreaming ? 0 : toMillis(item.message.timestamp),
        source: 'history',
      };
      break;
    }
  }

  await refreshStats(tab);
  tab.starting = false;
  tab.alive = true;
  renderTabs();
  renderSelectors(tab);
  renderComposerState();
  renderOpenSessions();
  if (state.activeId === tab.id) renderAll(tab);
  renderPinnedBars(tab);
  markCurrentSession();
  scheduleSave();
  scheduler.pumpSoon(400);
}

/**
 * auto-compact and auto-retry are always on in this GUI - the composer has no switch for either.
 * pi's own defaults are on too, but `"compaction": { "enabled": false }` or
 * `"retry": { "enabled": false }` in ~/.pi/agent/settings.json would leave a tab without them, so
 * every (re)start puts both back on through pi's RPC. get_state reports autoCompactionEnabled but
 * not the retry policy, so the retry call goes out every time; it is a no-op when pi already has it
 * on. A failure is left visible: tab.autoCompact stays false and the stats row warns about it.
 */
async function ensureAlwaysOn(tab) {
  if (tab.autoCompact === false) {
    const res = await api.cmd(tab.id, 'set_auto_compaction', { enabled: true });
    if (res.success) tab.autoCompact = true;
    else toast(res.error || 'set_auto_compaction failed', 'error');
  }
  const retry = await api.cmd(tab.id, 'set_auto_retry', { enabled: true });
  if (retry.success) tab.autoRetry = true;
  else toast(retry.error || 'set_auto_retry failed', 'error');
}

async function refreshStats(tab) {
  if (!tab || !tab.alive) return;
  const res = await api.cmd(tab.id, 'get_session_stats');
  if (res.success && res.data) tab.stats = res.data;
  renderStats(tab);
}

/* ------------------------------------------------------------------ */
/* session list                                                        */
/* ------------------------------------------------------------------ */

// Keeps the two sidebar lists consistent: every session file that is open in a tab
// gets an `open #n` badge (n = its position in the queue above), and the active tab's
// session stays highlighted.
function markCurrentSession() {
  const active = activeTab();
  for (const node of els.sessionList.querySelectorAll('.session-item')) {
    const matches = [];
    state.order.forEach((id, index) => {
      const tab = state.tabs.get(id);
      if (tab && tab.sessionPath && samePath(tab.sessionPath, node.dataset.path)) matches.push(index + 1);
    });
    node.classList.toggle('current', !!(active && active.sessionPath && samePath(active.sessionPath, node.dataset.path)));
    const here = !!(active && active.cwd && samePath(active.cwd, node.dataset.cwd));
    node.classList.toggle('here', here);
    const cwdNode = node.querySelector('.session-cwd');
    if (cwdNode && node.dataset.cwd) {
      cwdNode.title = here
        ? `${node.dataset.cwd}\nthe active tab runs in this folder \u00b7 click to open`
        : `${node.dataset.cwd}\nclick to open this folder`;
    }
    node.classList.toggle('is-open', matches.length > 0);
    let badge = node.querySelector('.open-badge');
    if (matches.length) {
      if (!badge) {
        badge = el('span', 'open-badge');
        node.querySelector('.session-meta').prepend(badge);
      }
      badge.textContent = matches.map((position) => `open #${position}`).join(' ');
      badge.title = `Already open in ${matches.length} tab(s). #n is its position in the Open sessions list above.`;
    } else if (badge) {
      badge.remove();
    }
  }
}

let sessionsTimer = null;
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

async function openSession(meta) {
  const existing = [...state.tabs.values()].find((tab) => samePath(tab.sessionPath, meta.path));
  if (existing) {
    activateTab(existing.id);
    return;
  }
  await createTab({ cwd: meta.cwd || state.cwd, sessionPath: meta.path, name: meta.name });
}

async function resetCurrentTab() {
  const tab = activeTab();
  if (!tab || !tab.alive) {
    await promptNewSession();
    return;
  }
  const response = await openModal({
    title: 'New session in this tab?',
    message: 'The current conversation stays on disk, but this tab starts fresh.',
    kind: 'confirm',
  });
  if (response.cancelled || !response.confirmed) return;
  const res = await api.cmd(tab.id, 'new_session');
  if (!res.success) {
    toast(res.error || 'new_session failed', 'error');
    return;
  }
  if (res.data && res.data.cancelled) {
    toast('new session cancelled by an extension', 'warning');
    return;
  }
  tab.items = [];
  tab.tools.clear();
  tab.streaming = null;
  tab.currentRequest = null;
  tab.pendingQueued = [];
  tab.name = '';
  tab.sessionPath = null;
  await bootstrap(tab);
  toast('started a new session in this tab');
  scheduleSave();
}

async function switchCurrentTabTo(meta) {
  const tab = activeTab();
  if (!tab) {
    await openSession(meta);
    return;
  }
  if (!tab.alive) {
    await openSession(meta);
    return;
  }
  const res = await api.cmd(tab.id, 'switch_session', { sessionPath: meta.path });
  if (!res.success) {
    toast(res.error || 'switch failed', 'error');
    return;
  }
  if (res.data && res.data.cancelled) {
    toast('session switch cancelled by an extension', 'warning');
    return;
  }
  tab.items = [];
  tab.tools.clear();
  tab.streaming = null;
  tab.currentRequest = null;
  tab.pendingQueued = [];
  tab.sessionPath = meta.path;
  api.setSessionPath({ tabId: tab.id, sessionPath: meta.path }); // D7: the cleanup must know what this tab is writing to
  tab.ephemeral = false; // the tab now points at a real session file (queue badge)
  tab.name = meta.name || '';
  await bootstrap(tab);
  toast(`switched to ${meta.title || meta.fileName}`);
  scheduleSave();
}

/* ------------------------------------------------------------------ */
/* new session                                                         */
/* ------------------------------------------------------------------ */

async function promptNewSession() {
  const response = await openModal({
    title: 'New session',
    kind: 'fields',
    fields: [
      { key: 'name', label: 'Session name (optional)', value: '' },
      { key: 'cwd', label: 'Working folder', value: state.cwd, folderPicker: true },
      { key: 'ephemeral', label: 'Ephemeral (do not save to disk)', type: 'checkbox', value: false },
    ],
  });
  if (response.cancelled) return;
  const cwd = String(response.values.cwd || state.cwd).trim();
  await createTab({ cwd, name: String(response.values.name || '').trim() || undefined, ephemeral: !!response.values.ephemeral });
}

async function createTab({ cwd, sessionPath, name, ephemeral }) {
  const tab = makeTab({ cwd: cwd || state.cwd, sessionPath, name, ephemeral });
  activateTab(tab.id);
  renderTabs();

  const res = await api.spawn({ tabId: tab.id, cwd: tab.cwd, args: tab.args });
  if (!res.ok) {
    tab.starting = false;
    tab.alive = false;
    pushNote(tab, `failed to start pi: ${res.error}`, 'error');
    renderTabs();
    renderComposerState();
    toast(res.error || 'failed to start pi', 'error');
    return tab;
  }
  tab.alive = true;
  state.cwd = res.cwd || tab.cwd;
  if (res.cwdFallback) {
    // the session file recorded a folder that no longer exists (renamed/moved project)
    pushNote(tab, `session 記錄的資料夾不存在：${res.cwdFallback}\n改用 ${state.cwd} 啟動這個 session`, 'warn');
    toast(`cwd 退到 ${state.cwd}`, 'warning');
    scheduleSave();
  }
  await bootstrap(tab);
  refreshSessionsSoon(300);
  scheduleSave();
  return tab;
}

/* ------------------------------------------------------------------ */
/* modal with fields (new session)                                     */
/* ------------------------------------------------------------------ */

function openFieldsModal(options) {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const modal = el('div', 'modal');
    modal.appendChild(el('h3', '', options.title || ''));
    const values = {};
    const inputs = [];
    for (const field of options.fields) {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', '', field.label));
      if (field.type === 'checkbox') {
        const row = el('div', 'field-row');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = !!field.value;
        row.appendChild(box);
        wrap.appendChild(row);
        inputs.push({ field, box, type: 'checkbox' });
      } else if (field.type === 'select') {
        const box = document.createElement('select');
        for (const option of field.options) {
          const opt = document.createElement('option');
          const value = typeof option === 'string' ? option : option.value;
          opt.value = value;
          opt.textContent = typeof option === 'string' ? option : option.label;
          if (field.value != null && String(field.value) === String(value)) opt.selected = true;
          box.appendChild(opt);
        }
        wrap.appendChild(box);
        inputs.push({ field, box, type: 'text' });
      } else if (field.folderPicker) {
        const row = el('div', 'field-row');
        const box = el('input');
        box.type = 'text';
        box.value = field.value || '';
        const browse = el('button', '', 'Browse…');
        browse.addEventListener('click', async () => {
          const picked = await api.chooseFolder();
          if (picked.ok) box.value = picked.path;
        });
        row.appendChild(box);
        row.appendChild(browse);
        wrap.appendChild(row);
        inputs.push({ field, box, type: 'text' });
      } else {
        const box = el('input');
        box.type = 'text';
        box.value = field.value || '';
        box.placeholder = field.placeholder || '';
        wrap.appendChild(box);
        inputs.push({ field, box, type: 'text' });
      }
      modal.appendChild(wrap);
    }
    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'ghost', 'Cancel');
    const ok = el('button', 'primary', options.okLabel || 'Create');
    actions.appendChild(cancel);
    actions.appendChild(ok);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      backdrop.remove();
      modalOpen = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    modalOpen = { finish, backdrop };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish({ cancelled: true });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    };
    const submit = () => {
      for (const entry of inputs) values[entry.field.key] = entry.type === 'checkbox' ? entry.box.checked : entry.box.value;
      finish({ values });
    };
    document.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => finish({ cancelled: true }));
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish({ cancelled: true });
    });
    setTimeout(() => inputs[0] && inputs[0].box.focus(), 30);
  });
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

function firstRunNeeded() {
  return !state.settings || state.settings.firstRunSeen !== true;
}

async function openFirstRunWizard() {
  const info = state.info || (await api.info());
  let strataUrl = state.settings && state.settings.strataUrl ? state.settings.strataUrl : strataBaseUrl();
  let cwd = (state.settings && state.settings.cwd) || info.defaultCwd || state.cwd;
  let piState = { version: info.piVersion, level: info.piVersionLevel, cli: info.cliPath, node: info.nodePath };
  let strataState = { checked: false };

  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop setup-backdrop');
    const modal = el('div', 'modal setup-modal');
    modal.appendChild(el('h3', '', 'First-run check'));
    modal.appendChild(
      el('div', 'set-hint', 'Two things have to be true before this GUI can talk to a model: the pi CLI has to be installed, and a Strata server has to be reachable. This checks both without sending a prompt.'),
    );

    const step = (title) => {
      const box = el('div', 'setup-step');
      box.appendChild(el('div', 'setup-title', title));
      const status = el('div', 'setup-status', 'checking\u2026');
      box.appendChild(status);
      modal.appendChild(box);
      return { box, status };
    };

    /* 1. pi */
    const piStep = step('1. pi CLI');
    const piActions = el('div', 'field-row');
    const recheck = el('button', 'ghost', 're-check pi');
    recheck.title = 'ask the background process again (the managed installer writes a version file, no restart needed)';
    piActions.appendChild(recheck);
    if (info.cliPath) {
      const reveal = el('button', 'ghost', 'show in folder');
      reveal.addEventListener('click', () => api.openPath(info.cliPath, true));
      piActions.appendChild(reveal);
    }
    piStep.box.appendChild(piActions);
    const copyInstall = el('button', 'ghost', 'copy the install command');
    const installLine = el('div', 'setup-code', PI_INSTALL_COMMAND);
    const paintPi = () => {
      if (!piState.version) {
        piStep.status.className = 'setup-status bad';
        piStep.status.textContent = `pi was not found (looked in ~/.pi/agent/install/current-version and STRATAPILOT_PI_CLI). Node used: ${piState.node || 'none'}.`;
        if (!piActions.contains(copyInstall)) {
          piStep.box.appendChild(installLine);
          piActions.appendChild(copyInstall);
        }
        return;
      }
      installLine.remove();
      copyInstall.remove();
      if (piState.level === 'ok') {
        piStep.status.className = 'setup-status good';
        piStep.status.textContent = `pi ${piState.version} - the version this GUI was tested against. CLI: ${piState.cli}`;
      } else if (piState.level === 'warn') {
        piStep.status.className = 'setup-status warn';
        piStep.status.textContent = `pi ${piState.version} is a different minor version than the tested ${info.testedPiVersion}: new RPC commands may exist, usually harmless.`;
      } else {
        piStep.status.className = 'setup-status bad';
        piStep.status.textContent = `pi ${piState.version} differs in major version from the tested ${info.testedPiVersion}: the RPC framing may have changed.`;
      }
    };
    paintPi();
    recheck.addEventListener('click', async () => {
      piStep.status.textContent = 'checking\u2026';
      const fresh = await api.info();
      state.info = fresh;
      piState = { version: fresh.piVersion, level: fresh.piVersionLevel, cli: fresh.cliPath, node: fresh.nodePath };
      paintPi();
      renderEnvBar();
    });
    copyInstall.addEventListener('click', async () => {
      await navigator.clipboard.writeText(PI_INSTALL_COMMAND);
      toast('install command copied - run it in a terminal, then re-check', 'info', 6000);
    });

    /* 2. Strata */
    const strataStep = step('2. Strata server');
    const urlRow = el('div', 'field-row');
    const urlBox = el('input');
    urlBox.type = 'text';
    urlBox.value = strataUrl;
    urlBox.setAttribute('aria-label', 'Strata base address');
    const check = el('button', '', 'check');
    const use = el('button', 'ghost', 'use this address');
    urlRow.appendChild(urlBox);
    urlRow.appendChild(check);
    urlRow.appendChild(use);
    strataStep.box.appendChild(urlRow);
    const paintStrata = () => {
      if (!strataState.checked) {
        strataStep.status.className = 'setup-status';
        strataStep.status.textContent = 'not checked yet.';
        return;
      }
      if (strataState.ok) {
        strataStep.status.className = 'setup-status good';
        strataStep.status.textContent = `${strataState.url} answered /health with HTTP ${strataState.status} in ${strataState.ms}ms${strataState.body ? ` - ${strataState.body.slice(0, 80)}` : ''}`;
      } else {
        strataStep.status.className = 'setup-status bad';
        strataStep.status.textContent = `${strataState.url}: ${strataState.error}. Start the engine, or change the address above. If the server needs a key, set STRATAPILOT_KEY (or STRATA_API_KEY) in the environment this app was started from.`;
      }
    };
    paintStrata();
    check.addEventListener('click', async () => {
      strataStep.status.textContent = 'checking\u2026';
      const res = await api.strataHealth({ baseUrl: urlBox.value.trim() });
      strataState = { checked: true, ok: res.ok, url: res.url || urlBox.value.trim(), status: res.status, ms: res.ms, body: res.body, error: res.error };
      paintStrata();
    });
    use.addEventListener('click', async () => {
      const merged = await api.settingsSet({ strataUrl: urlBox.value.trim() });
      state.settings = merged || { ...state.settings, strataUrl: urlBox.value.trim() };
      applySettings(state.settings);
      toast(`Monitor and diagnostics will use ${urlBox.value.trim()}`, 'info', 4000);
    });
    setTimeout(() => check.click(), 250);

    /* 3. working folder */
    const folderStep = step('3. working folder');
    const folderRow = el('div', 'field-row');
    const folderBox = el('input');
    folderBox.type = 'text';
    folderBox.value = cwd;
    folderBox.setAttribute('aria-label', 'Working folder for new sessions');
    const browse = el('button', '', 'browse\u2026');
    browse.addEventListener('click', async () => {
      const picked = await api.chooseFolder();
      if (picked.ok) folderBox.value = picked.path;
    });
    const saveFolder = el('button', 'ghost', 'use this folder');
    folderRow.appendChild(folderBox);
    folderRow.appendChild(browse);
    folderRow.appendChild(saveFolder);
    folderStep.box.appendChild(folderRow);
    folderStep.status.className = 'setup-status';
    folderStep.status.textContent = 'every new tab starts here, and a session file that records a missing folder falls back to it.';
    saveFolder.addEventListener('click', async () => {
      const merged = await api.settingsSet({ cwd: folderBox.value.trim() });
      state.settings = merged || { ...state.settings, cwd: folderBox.value.trim() };
      applySettings(state.settings);
      state.cwd = folderBox.value.trim();
      toast(`new tabs will start in ${state.cwd}`, 'info', 4000);
    });

    const actions = el('div', 'modal-actions');
    const diagnostics = el('button', 'ghost', 'copy diagnostics');
    diagnostics.addEventListener('click', () => copyDiagnostics());
    const done = el('button', 'primary', 'Start using it');
    actions.appendChild(diagnostics);
    actions.appendChild(done);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      const merged = await api.settingsSet({ firstRunSeen: true });
      state.settings = merged || { ...state.settings, firstRunSeen: true };
      backdrop.remove();
      modalOpen = null;
      resolve();
    };
    modalOpen = { finish, backdrop };
    done.addEventListener('click', finish);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish();
    });
  });
}

/* session tree / branching (B1)                                       */
/* ------------------------------------------------------------------ */

/*
 * A pi session is an append-only tree: every entry has an id and a parentId, and the conversation you
 * see is the path from a root to the current leaf. The GUI used to render only that path (get_messages
 * returns the active branch), so an abandoned branch was invisible and there was no way to go back to
 * an earlier prompt and take a different route. pi exposes get_tree / fork / clone over RPC, so the
 * tree view is a renderer feature: no session parsing here, and no second writer of the session file.
 */

const TREE_LABEL = {
  message: (entry) => (entry.message && entry.message.role ? entry.message.role : 'message'),
  model_change: () => 'model',
  thinking_level_change: () => 'thinking',
  usage: () => 'usage',
  session_info: () => 'name',
  compaction: () => 'compaction',
  session_before_fork: () => 'fork point',
};

function treeKind(entry) {
  if (TREE_LABEL[entry.type]) return TREE_LABEL[entry.type](entry);
  return entry.type || 'entry';
}

function treeText(entry) {
  if (entry.name) return String(entry.name);
  if (entry.summary) return String(entry.summary);
  if (entry.model) return `${entry.model.provider || ''}${entry.model.provider ? '/' : ''}${entry.model.id || ''}`;
  if (entry.thinkingLevel) return String(entry.thinkingLevel);
  if (entry.message && entry.message.content) return contentToText(entry.message.content);
  return '';
}

/** id -> node, and the id chain from a root down to the current leaf. */
function indexTree(tree, leafId) {
  const byId = new Map();
  const walk = (node) => {
    if (!node || !node.entry) return;
    byId.set(node.entry.id, node);
    for (const child of node.children || []) walk(child);
  };
  for (const root of tree || []) walk(root);
  const onPath = new Set();
  let cursor = leafId && byId.has(leafId) ? leafId : null;
  while (cursor) {
    onPath.add(cursor);
    cursor = byId.get(cursor).entry.parentId;
  }
  return { byId, onPath };
}

/**
 * Flatten the tree into display rows.
 *
 * pi's session tree is a chain: every entry's parent is the entry before it (model change, thinking
 * level, prompt, answer, tool result, ...). Indenting one level per entry therefore buried a 76-entry
 * session 76 levels deep - 8 + 76*14 = 1072px of padding inside a 900px modal, which pushed the text
 * and the time column off the row and gave the list a horizontal scrollbar. So indent one level per
 * *branch point* instead: a node with a single child keeps that child at the same level, and only a
 * node with several children nests what follows. A session with no branch points renders as a flat
 * list, which is what it actually is. `maxLevel` keeps a pathological fork storm inside the modal.
 */
function flattenTree(tree, onPath, maxLevel = 12) {
  const rows = [];
  const walk = (node, level, on) => {
    const children = node.children || [];
    rows.push({ node, level: Math.min(level, maxLevel), on, siblings: children.length });
    const childLevel = children.length > 1 ? level + 1 : level;
    const ordered = [...children].sort((a, b) => Number(onPath.has(b.entry.id)) - Number(onPath.has(a.entry.id)));
    for (const child of ordered) walk(child, childLevel, on && onPath.has(child.entry.id));
  };
  for (const root of tree || []) walk(root, 0, onPath.has(root.entry.id));
  return rows;
}

/** The transcript is built from messages, not entries, so a jump matches on text. */
function findItemForEntry(tab, entry) {
  const text = treeText(entry).trim();
  if (!text) return null;
  const needle = text.replace(/\s+/g, ' ').slice(0, 160);
  const match = [...tab.items].reverse().find((item) => {
    if (item.kind !== 'message' || !item.message) return false;
    if (item.message.role !== (entry.message && entry.message.role)) return false;
    return contentToText(item.message.content).replace(/\s+/g, ' ').startsWith(needle.slice(0, 60));
  });
  return match || null;
}

async function openSessionTree(tab) {
  if (!tab || !tab.alive) {
    toast('this tab is not running - restart it to read its tree', 'warning');
    return;
  }
  const res = await api.cmd(tab.id, 'get_tree');
  if (!res.success) {
    toast(`get_tree failed: ${res.error || 'unknown error'}`, 'error', 8000);
    return;
  }
  const tree = res.data.tree || [];
  const leafId = res.data.leafId || null;
  const { byId, onPath } = indexTree(tree, leafId);
  let branchPoints = 0;
  for (const node of byId.values()) if ((node.children || []).length > 1) branchPoints += 1;
  tab.branchPoints = branchPoints;
  renderStats(tab);

  const rows = flattenTree(tree, onPath);

  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop tree-backdrop');
    const modal = el('div', 'modal tree-modal');
    modal.appendChild(el('h3', '', `Session tree - ${tabLabel(tab)}`));
    modal.appendChild(
      el(
        'div',
        'set-hint',
        `${byId.size} entries, ${branchPoints} branch point${branchPoints === 1 ? '' : 's'}. The highlighted line is the branch you are on; dim rows are entries pi is no longer following. Forking moves the session back to an earlier prompt - the file is append-only, so nothing is deleted.`,
      ),
    );

    const list = el('div', 'tree-list');
    for (const row of rows) {
      const entry = row.node.entry;
      const siblings = row.siblings;
      const line = el('div', `tree-row${row.on ? ' on-path' : ' off-path'}${siblings > 1 ? ' branch' : ''}`);
      line.style.setProperty('--indent', `${8 + row.level * 14}px`);
      line.appendChild(el('span', 'tree-kind', treeKind(entry)));
      const text = treeText(entry);
      // css does the clipping (text-overflow), so the full text stays readable on hover instead of
      // being cut twice - a js slice plus a css ellipsis hid the js ellipsis
      const shown = el('span', 'tree-text', text || '(no text)');
      if (text) shown.title = text;
      line.appendChild(shown);
      if (siblings > 1) line.appendChild(el('span', 'tree-branch', `\u2295 ${siblings} branches`));
      if (entry.id === leafId) line.appendChild(el('span', 'tree-leaf', 'leaf'));
      if (entry.timestamp) line.appendChild(el('span', 'tree-time', new Date(entry.timestamp).toLocaleTimeString()));

      const actions = el('div', 'outbox-controls');
      const jump = el('button', 'ghost', 'jump');
      jump.disabled = !text;
      jump.title = 'scroll the transcript to this message';
      jump.addEventListener('click', () => {
        const item = findItemForEntry(tab, entry);
        if (!item) {
          toast('that entry is not in the rendered transcript (it may be pre-compaction history or another branch)', 'warning', 8000);
          return;
        }
        jumpToItem(tab, item.key);
      });
      actions.appendChild(jump);
      const canFork = entry.type === 'message' && entry.message && entry.message.role === 'user' && row.on;
      if (canFork) {
        const fork = el('button', 'ghost', 'fork here');
        fork.title = 'go back to this prompt and take a different route (pi forks in place; the current branch stays in the file)';
        fork.addEventListener('click', async () => {
          const answer = await openModal({
            kind: 'confirm',
            title: 'Fork from this prompt?',
            message: 'pi moves this session back to that user message and waits for a new prompt. The session file is append-only, so the answers you already got are not deleted, but they are no longer on the branch you are working on.',
            okLabel: 'Fork here',
          });
          if (!answer || !answer.confirmed) return;
          const done = await api.cmd(tab.id, 'fork', { entryId: entry.id });
          if (!done.success) {
            toast(`fork failed: ${done.error || 'unknown error'}`, 'error', 8000);
            return;
          }
          if (done.data && done.data.cancelled) {
            toast('fork cancelled by an extension', 'warning', 6000);
            return;
          }
          // pi may keep the same file or move to a forked one - ask it instead of guessing
          // (never call this `state`: that name belongs to the app state object)
          const afterFork = await api.cmd(tab.id, 'get_state');
          if (afterFork.success && afterFork.data && afterFork.data.sessionFile) {
            tab.sessionPath = afterFork.data.sessionFile;
            api.setSessionPath({ tabId: tab.id, sessionPath: afterFork.data.sessionFile });
            scheduleSave();
          }
          finish();
          tab.items = [];
          tab.nodes.clear();
          tab.tools.clear();
          tab.streaming = null;
          tab.currentRequest = null;
          await bootstrap(tab);
          pushNote(tab, `forked from: ${oneLine(text, 160)} - type the next prompt to take the other route`, 'info');
          renderAll(tab);
          renderTabs();
        });
        actions.appendChild(fork);
      }
      line.appendChild(actions);
      list.appendChild(line);
    }
    modal.appendChild(list);

    const actions = el('div', 'modal-actions');
    const clone = el('button', '', 'clone branch');
    clone.title = 'duplicate the branch you are on into a new session file (this tab keeps going here)';
    clone.addEventListener('click', async () => {
      const done = await api.cmd(tab.id, 'clone');
      if (!done.success) {
        toast(`clone failed: ${done.error || 'unknown error'}`, 'error', 8000);
        return;
      }
      if (done.data && done.data.cancelled) {
        toast('clone cancelled by an extension', 'warning', 6000);
        return;
      }
      const afterClone = await api.cmd(tab.id, 'get_state');
      if (afterClone.success && afterClone.data && afterClone.data.sessionFile) {
        tab.sessionPath = afterClone.data.sessionFile;
        api.setSessionPath({ tabId: tab.id, sessionPath: afterClone.data.sessionFile });
        scheduleSave();
      }
      await refreshSessions();
      toast('branch cloned into a new session file (the sidebar shows it)', 'info', 7000);
      finish();
    });
    const refresh = el('button', 'ghost', 'refresh');
    refresh.addEventListener('click', () => {
      finish();
      openSessionTree(tab);
    });
    const close = el('button', 'ghost', 'Close');
    actions.appendChild(clone);
    actions.appendChild(refresh);
    actions.appendChild(close);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
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

/* session storage (D7)                                                */
/* ------------------------------------------------------------------ */

/** 1.5 GB, 812 MB, 4.1 KB, 312 B - the sidebar footer and the storage dialog both need this. */
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

async function refreshStorage() {
  const res = await api.sessionsStats();
  if (!res || !res.ok) {
    console.error(`[storage] stats failed: ${(res && res.error) || 'unknown'}`);
    return null;
  }
  state.storage = res;
  renderOpenSessions();
  return res;
}

/**
 * What the sessions folder costs, and a cleanup that does not need the file manager. Two rules only
 * (age, and a per-folder cap), always previewed before anything is deleted, and a session that is
 * open in a tab is never in the list - the main process filters those out, not this dialog.
 */
async function openStorageModal() {
  const stats = (await refreshStorage()) || state.storage;
  if (!stats) {
    toast(tr('could not read the sessions folder'), 'error');
    return;
  }
  let plan = null;

  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop storage-backdrop');
    const modal = el('div', 'modal storage-modal');
    modal.appendChild(el('h3', '', tr('Session storage')));
    modal.appendChild(
      el('div', 'set-hint', tr('{files} session files, {size} in {root}. Deleting here is permanent - sessions do not go to a recycle bin.', { files: stats.totalFiles, size: formatBytes(stats.totalBytes), root: stats.root })),
    );

    const groups = el('div', 'job-list');
    for (const group of stats.groups.slice(0, 40)) {
      const row = el('div', 'job-row storage-row');
      const head = el('div', 'job-head');
      head.appendChild(el('span', 'job-name', group.group));
      head.appendChild(el('span', 'job-schedule', tr('{size} / {n} files', { size: formatBytes(group.bytes), n: group.files })));
      row.appendChild(head);
      row.appendChild(
        el('div', 'job-meta', tr('newest {newest} · oldest {oldest}', { newest: new Date(group.newestMs).toLocaleString(i18nInfo.lang === 'en' ? undefined : i18nInfo.lang), oldest: new Date(group.oldestMs).toLocaleString(i18nInfo.lang === 'en' ? undefined : i18nInfo.lang) })),
      );
      groups.appendChild(row);
    }
    if (stats.groups.length > 40) groups.appendChild(el('div', 'set-hint', tr('{n} more folders not shown', { n: stats.groups.length - 40 })));
    modal.appendChild(groups);

    const rules = el('div', 'field-row');
    const olderSel = document.createElement('select');
    for (const option of [
      { value: '', label: tr('any age') },
      { value: '30', label: tr('older than 30 days') },
      { value: '90', label: tr('older than 90 days') },
      { value: '180', label: tr('older than 180 days') },
      { value: '365', label: tr('older than a year') },
    ]) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      olderSel.appendChild(opt);
    }
    const keepSel = document.createElement('select');
    for (const option of [
      { value: '', label: tr('keep every session per folder') },
      { value: '5', label: tr('keep the 5 newest per folder') },
      { value: '10', label: tr('keep the 10 newest per folder') },
      { value: '20', label: tr('keep the 20 newest per folder') },
      { value: '50', label: tr('keep the 50 newest per folder') },
    ]) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      keepSel.appendChild(opt);
    }
    olderSel.setAttribute('aria-label', tr('Age rule'));
    keepSel.setAttribute('aria-label', tr('Per folder cap'));
    rules.appendChild(olderSel);
    rules.appendChild(keepSel);
    modal.appendChild(rules);

    const previewBox = el('div', 'storage-preview', tr('Pick a rule and preview - nothing is deleted until you say so.'));
    modal.appendChild(previewBox);

    const actions = el('div', 'modal-actions');
    const previewButton = el('button', '', tr('Preview'));
    const del = el('button', 'danger', tr('Delete'));
    del.disabled = true;
    const close = el('button', 'ghost', tr('Close'));
    actions.appendChild(previewButton);
    actions.appendChild(del);
    actions.appendChild(close);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      backdrop.remove();
      modalOpen = null;
      resolve();
    };
    modalOpen = { finish, backdrop };
    close.addEventListener('click', finish);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish();
    });

    previewButton.addEventListener('click', async () => {
      const olderThanDays = olderSel.value ? Number(olderSel.value) : null;
      const keepNewestPerGroup = keepSel.value ? Number(keepSel.value) : null;
      if (olderThanDays == null && keepNewestPerGroup == null) {
        previewBox.textContent = tr('Choose at least one rule first - otherwise nothing would be deleted.');
        del.disabled = true;
        return;
      }
      const res = await api.sessionsCleanupPlan({ olderThanDays, keepNewestPerGroup });
      if (!res.ok) {
        previewBox.textContent = tr('preview failed: {error}', { error: res.error });
        del.disabled = true;
        return;
      }
      plan = res;
      if (!res.candidates.length) {
        previewBox.textContent = tr('Nothing matches: {n} files scanned, 0 to delete.', { n: res.scannedFiles });
        del.disabled = true;
        return;
      }
      const sample = res.candidates
        .slice(0, 12)
        .map((entry) => `${pathParts(entry.path).leaf || entry.group} - ${formatBytes(entry.bytes)}, ${tr(entry.reason)}`)
        .join(' · ');
      previewBox.textContent = tr('{n} files, {size} to free: {sample}', { n: res.candidates.length, size: formatBytes(res.bytes), sample: `${sample}${res.candidates.length > 12 ? tr(' (+{n} more)', { n: res.candidates.length - 12 }) : ''}` });
      del.disabled = false;
      del.textContent = tr('Delete {n} files ({size})', { n: res.candidates.length, size: formatBytes(res.bytes) });
    });

    del.addEventListener('click', async () => {
      if (!plan || !plan.candidates.length) return;
      const paths = plan.candidates.map((entry) => entry.path);
      const answer = await openModal({
        kind: 'confirm',
        title: tr('Delete {n} session files?', { n: paths.length }),
        message: tr('{size} will be removed from {root}. This is permanent. Sessions open in a tab are never included.', { size: formatBytes(plan.bytes), root: stats.root }),
        okLabel: tr('Delete for good'),
      });
      if (!answer || !answer.confirmed) return;
      const res = await api.sessionsCleanupRun({ paths });
      if (!res.ok) {
        toast(tr('cleanup failed: {error}', { error: res.error }), 'error', 9000);
        return;
      }
      toast(
        tr('deleted {n} session files ({size}){skipped}{failed}', {
          n: res.deleted,
          size: formatBytes(res.bytes),
          skipped: res.skipped.length ? tr(', {n} skipped: open in a tab', { n: res.skipped.length }) : '',
          failed: res.failed.length ? tr(', {n} failed', { n: res.failed.length }) : '',
        }),
        'info',
        9000,
      );
      plan = null;
      del.disabled = true;
      del.textContent = tr('Delete');
      previewBox.textContent = tr('Done. The totals above are refreshed.');
      await refreshStorage();
      await refreshSessions();
      scheduleUsageSummary(0); // the ledger marks those entries as gone; the chip must follow at once
    });
  });
}

/* ------------------------------------------------------------------ */
/* token usage ledger (D9): persisted in / out / cache + column chart    */
/* ------------------------------------------------------------------ */

/*
 * pi writes the usage of every assistant message into the session JSONL, and lib/usage-ledger.js
 * rolls that up into day buckets in %APPDATA%\StrataPilot\token_usage.json. This section is only the
 * viewer: a stacked column chart per day / week / month / year, built as inline SVG (no canvas, no
 * dependency, and the CSP stays at default-src 'self').
 *
 * The stack order is deliberate: cacheRead is usually two orders of magnitude bigger than the rest
 * (this machine: 29.5M cache reads against 842k real prompt reads), so it goes at the bottom and the
 * interesting in / out sit on top of it where they stay readable.
 */

const USAGE_UNITS = [
  { value: 'day', label: i18nKey('per day') },
  { value: 'week', label: i18nKey('per week') },
  { value: 'month', label: i18nKey('per month') },
  { value: 'year', label: i18nKey('per year') },
];

const USAGE_RANGES = [
  { value: '0', label: i18nKey('everything') },
  { value: '7', label: i18nKey('last 7 days') },
  { value: '30', label: i18nKey('last 30 days') },
  { value: '90', label: i18nKey('last 90 days') },
  { value: '365', label: i18nKey('last year') },
];

/** bottom -> top */
const USAGE_STACK = [
  { key: 'cacheRead', cls: 'uc-cr', label: 'cache read' },
  { key: 'cacheWrite', cls: 'uc-cw', label: 'cache write' },
  { key: 'in', cls: 'uc-in', label: 'in' },
  { key: 'out', cls: 'uc-out', label: 'out' },
];

function usageStackTotal(bucket) {
  return (bucket.cacheRead || 0) + (bucket.cacheWrite || 0) + (bucket.in || 0) + (bucket.out || 0);
}

/*
 * What it costs. Strata reports no prices (pi's `usage.cost.total` is 0 for every call here), so the
 * money side has to be computed from rates the user enters: USD per 1,000,000 tokens, per model, with
 * a default row for models that have no row yet. The ledger deliberately stores only token counts -
 * prices change over time, and re-pricing old days must not need a re-scan.
 */
const PRICE_FIELDS = ['in', 'out', 'cacheRead', 'cacheWrite'];
const PRICE_LABELS = { in: i18nKey('in'), out: i18nKey('out'), cacheRead: i18nKey('cache read'), cacheWrite: i18nKey('cache write') };
const TOKENS_PER_MILLION = 1000000;

function priceNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizePrice(price) {
  if (!price || typeof price !== 'object') return { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  const out = {};
  for (const field of PRICE_FIELDS) out[field] = priceNumber(price[field]);
  return out;
}

/**
 * Rate row for one model. Settings may key a row by the bare id (`qwen3.8-flash-next-iq3_s`) or the
 * provider-qualified one (`strata/qwen3.8-flash-next-iq3_s`); the ledger records the bare id, so both
 * spellings are accepted rather than making the user guess which one pi writes.
 *
 * A model row is a PATCH over the default row, not a replacement: filling in only `in` must not
 * silently make that model's output and cache free.
 */
function priceForModel(usagePrices, model) {
  const table = usagePrices && usagePrices.byModel ? usagePrices.byModel : {};
  const merged = normalizePrice(usagePrices && usagePrices.default);
  const name = String(model || '');
  let row = table[name] || null;
  if (!row) {
    for (const key of Object.keys(table)) {
      if (!key) continue;
      if (key.endsWith(`/${name}`) || name.endsWith(`/${key}`)) {
        row = table[key];
        break;
      }
    }
  }
  if (!row) return merged;
  for (const field of PRICE_FIELDS) {
    const value = Number(row[field]);
    if (Number.isFinite(value) && value > 0) merged[field] = value;
  }
  return merged;
}

function hasPrices(usagePrices) {
  if (!usagePrices) return false;
  const rows = [usagePrices.default].concat(Object.values((usagePrices.byModel || {})));
  return rows.some((row) => row && PRICE_FIELDS.some((field) => priceNumber(row[field]) > 0));
}

function costOf(tokens, price) {
  const p = normalizePrice(price);
  return (
    ((tokens.in || 0) / TOKENS_PER_MILLION) * p.in +
    ((tokens.out || 0) / TOKENS_PER_MILLION) * p.out +
    ((tokens.cacheRead || 0) / TOKENS_PER_MILLION) * p.cacheRead +
    ((tokens.cacheWrite || 0) / TOKENS_PER_MILLION) * p.cacheWrite
  );
}

/**
 * An all-empty model row means "the default rate applies", not "this model is free": keeping the
 * zeros would shadow the default row and make the whole chart read $0.
 */
function pruneRateRows(byModel) {
  const kept = {};
  for (const model of Object.keys(byModel || {})) {
    const row = byModel[model];
    if (row && PRICE_FIELDS.some((field) => priceNumber(row[field]) > 0)) kept[model] = normalizePrice(row);
  }
  return kept;
}

/** What one field (in / out / cacheRead / cacheWrite) costs, so the stack can be split by field. */
function fieldCost(tokens, price, field) {
  return ((tokens[field] || 0) / TOKENS_PER_MILLION) * normalizePrice(price)[field];
}

/**
 * Dollar split of one column, priced per model (a cheap model's cache reads and an expensive model's
 * output must not be averaged into one rate). Falls back to the bucket totals with the default rate
 * when the ledger entry has no model split.
 */
function bucketCostParts(bucket, usagePrices) {
  const parts = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const models = (bucket && bucket.models) || [];
  if (models.length) {
    for (const model of models) {
      const price = priceForModel(usagePrices, model.model);
      for (const field of PRICE_FIELDS) parts[field] += fieldCost(model, price, field);
    }
  } else {
    const price = priceForModel(usagePrices, '');
    for (const field of PRICE_FIELDS) parts[field] += fieldCost(bucket, price, field);
  }
  parts.total = parts.in + parts.out + parts.cacheRead + parts.cacheWrite;
  return parts;
}

function fmtMoney(value) {
  const amount = Number(value) || 0;
  if (amount === 0) return '$0';
  if (amount < 0.01) return `<$0.01`;
  if (amount < 1000) return `$${amount.toFixed(2)}`;
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: amount < 10000 ? 1 : 0 })}`;
}

function usageValueText(value, mode) {
  return mode === 'cost' ? fmtMoney(value) : fmtTokens(value);
}

/** What one column stacks into, in tokens or in dollars. */
function usageSegmentValues(bucket, mode, usagePrices) {
  if (mode === 'cost') {
    const parts = bucketCostParts(bucket, usagePrices);
    return { cacheRead: parts.cacheRead, cacheWrite: parts.cacheWrite, in: parts.in, out: parts.out, total: parts.total };
  }
  return { cacheRead: bucket.cacheRead || 0, cacheWrite: bucket.cacheWrite || 0, in: bucket.in || 0, out: bucket.out || 0, total: usageStackTotal(bucket) };
}

function usageCostOfSummary(usage, usagePrices) {
  const models = (usage && usage.allModels) || [];
  if (models.length) return models.reduce((sum, model) => sum + costOf(model, priceForModel(usagePrices, model.model)), 0);
  return usage && usage.all ? costOf(usage.all, priceForModel(usagePrices, '')) : 0;
}

function usageFootLabel() {
  const usage = state.usage;
  if (!usage || !usage.all || !usage.all.total) return tr('Usage');
  const prices = state.settings && state.settings.usagePrices;
  const cost = hasPrices(prices) ? usageCostOfSummary(usage, prices) : 0;
  const money = cost ? ` \u00b7 ${fmtMoney(cost)}` : usage.all.cost ? ` \u00b7 ${fmtMoney(usage.all.cost)}` : '';
  return tr('Usage: {tok} tok', { tok: fmtTokens(usage.all.total) }) + money;
}

function updateUsageFoot() {
  const button = els.sideFoot.querySelector('.foot-usage');
  if (button) button.textContent = usageFootLabel();
}

async function refreshUsageSummary() {
  const res = await api.usageSummary();
  if (!res || !res.ok) return null;
  state.usage = res;
  updateUsageFoot();
  return res;
}

/*
 * The footer chip and an open Usage dialog must not need an app restart to show what the last run
 * cost. Every run that settles - and every compaction, which is a model call of its own - re-reads
 * the ledger a moment later, once pi has flushed the session file. The scan is incremental, so
 * unchanged session files are never opened again and this stays cheap.
 */
let usageSummaryTimer = null;
let usageDialogDraw = null; // set while the Usage dialog is open, so a settle can redraw it too

function scheduleUsageSummary(delayMs = 1500) {
  clearTimeout(usageSummaryTimer);
  usageSummaryTimer = setTimeout(() => {
    const before = state.usage && state.usage.all ? state.usage.all.total : 0;
    refreshUsageSummary()
      .then((res) => {
        if (!res || !res.ok) return;
        const moved = res.all && res.all.total !== before;
        if (moved) console.log(`[usage-live] ledger total ${before} \u2192 ${res.all.total} (the chip follows without a restart)`);
        // redraw an open dialog only when the numbers actually moved, so hovering a column is not
        // yanked away every time some other tab settles
        if (moved && usageDialogDraw) usageDialogDraw();
      })
      .catch((err) => console.error('[usage] summary refresh failed', err));
  }, delayMs);
}

function usageRangeFrom(rangeValue) {
  const days = Number(rangeValue);
  if (!Number.isFinite(days) || days <= 0) return null;
  return Date.now() - days * 86400000;
}

function usageTotalsLine(totals, extra, costParts) {
  if (!totals) return tr('no usage recorded');
  const parts = [
    tr('in {n}', { n: fmtTokens(totals.in || 0) }),
    tr('out {n}', { n: fmtTokens(totals.out || 0) }),
    tr('cache read {n}', { n: fmtTokens(totals.cacheRead || 0) }),
    tr('cache write {n}', { n: fmtTokens(totals.cacheWrite || 0) }),
    tr('total {n}', { n: fmtTokens(totals.total || 0) }),
    tr('{n} model calls', { n: totals.msgs || 0 }),
  ];
  // compact and branch-switch summaries are model calls too - saying so is what makes it obvious
  // that their tokens were not written off
  const extraCalls = [];
  if (totals.compactions) extraCalls.push(tr('{n} compact', { n: totals.compactions }));
  if (totals.branches) extraCalls.push(tr('{n} branch summary', { n: totals.branches }));
  if (extraCalls.length) parts.push(tr('({list})', { list: extraCalls.join(', ') }));
  if (costParts && costParts.total) {
    parts.push(tr('{total} = {in} in + {out} out + {cacheRead} cache read + {cacheWrite} cache write', {
      total: fmtMoney(costParts.total),
      in: fmtMoney(costParts.in),
      out: fmtMoney(costParts.out),
      cacheRead: fmtMoney(costParts.cacheRead),
      cacheWrite: fmtMoney(costParts.cacheWrite),
    }));
  } else if (totals.cost) {
    parts.push(tr('reported {cost}', { cost: `$${Number(totals.cost).toFixed(4)}` }));
  }
  if (extra) parts.push(extra);
  return parts.join(' \u00b7 ');
}

function usageBucketLine(bucket, mode, usagePrices) {
  const models = (bucket.models || []).slice(0, 3).map((model) => `${model.model} ${fmtTokens(model.total)}`).join(', ');
  const money = mode === 'cost' || hasPrices(usagePrices) ? bucketCostParts(bucket, usagePrices) : null;
  return [
    bucket.full || bucket.key,
    usageTotalsLine(bucket, '', money),
    tr(bucket.sessions === 1 ? '{n} session' : '{n} sessions', { n: bucket.sessions || 0 }),
    models ? tr('models: {list}', { list: models }) : '',
  ].filter(Boolean).join(' \u00b7 ');
}

/**
 * Axis maximum: a round number at least as big as the tallest column, chosen so the four gridlines
 * land on readable values (22.69M -> 24M, so the lines are 6M / 12M / 18M / 24M). The headroom also
 * keeps a column's own number from colliding with the top gridline.
 */
function usageAxisMax(maxValue) {
  if (!(maxValue > 0)) return 1;
  const quarter = maxValue / 4;
  const base = 10 ** Math.floor(Math.log10(quarter));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (quarter <= step * base) return step * base * 4;
  }
  return 40 * base;
}

/**
 * One stacked column per bucket, as SVG sized in pixels (the wrapper scrolls sideways when the range
 * is wide, which keeps the axis labels readable instead of shrinking them into illegibility).
 */
function buildUsageChart(container, report, onSelect, showCache = true, mode = 'tokens', usagePrices = null) {
  container.textContent = '';
  const buckets = (report && report.buckets) || [];
  if (!buckets.length) {
    container.appendChild(el('div', 'empty-hint', tr('No usage recorded in this range yet. The ledger fills in as sessions run.')));
    return 0;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const colW = buckets.length > 40 ? 16 : buckets.length > 20 ? 24 : 34;
  const gap = buckets.length > 40 ? 6 : 10;
  const padLeft = 56;
  const padRight = 10;
  const padTop = 16;
  const padBottom = 30;
  const height = 250;
  const innerH = height - padTop - padBottom;
  const width = padLeft + padRight + buckets.length * (colW + gap);
  const maxRaw = Math.max(1, ...buckets.map((bucket) => {
    const values = usageSegmentValues(bucket, mode, usagePrices);
    return showCache ? values.total : values.in + values.out;
  }));
  const max = usageAxisMax(maxRaw);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'usage-chart');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', tr('token usage per {unit}: {n} columns', { unit: tr(report.unit), n: buckets.length }));

  const mk = (tag, attrs, text) => {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs || {})) node.setAttribute(name, value);
    if (text != null) node.textContent = text;
    return node;
  };

  // grid + y axis: the scale is the tallest column, not the total, so a cache-heavy day does not
  // flatten every other one
  for (let step = 0; step <= 4; step += 1) {
    const ratio = step / 4;
    const y = padTop + innerH - ratio * innerH;
    svg.appendChild(mk('line', { x1: padLeft - 6, y1: y, x2: width - padRight, y2: y, class: 'uc-grid' }));
    svg.appendChild(mk('text', { x: padLeft - 10, y: y + 4, class: 'uc-ylab', 'text-anchor': 'end' }, usageValueText(max * ratio, mode)));
  }

  const labelEvery = Math.max(1, Math.ceil(buckets.length / 16));
  buckets.forEach((bucket, index) => {
    const x = padLeft + index * (colW + gap);
    const values = usageSegmentValues(bucket, mode, usagePrices);
    const group = mk('g', { class: 'uc-col', tabindex: 0, role: 'button', 'aria-label': usageBucketLine(bucket, mode, usagePrices) });
    let acc = 0;
    for (const segment of USAGE_STACK) {
      if (!showCache && segment.key !== 'in' && segment.key !== 'out') continue;
      const value = values[segment.key] || 0;
      if (!value) continue;
      const top = padTop + innerH - ((acc + value) / max) * innerH;
      const h = (value / max) * innerH;
      group.appendChild(mk('rect', { x, y: top, width: colW, height: Math.max(1, h), class: `uc-seg ${segment.cls}` }));
      acc += value;
    }
    const total = showCache ? values.total : values.in + values.out;
    // a number above the column only fits when there are few of them
    if (buckets.length <= 16 && total) {
      group.appendChild(mk('text', { x: x + colW / 2, y: padTop + innerH - (total / max) * innerH - 5, class: 'uc-val', 'text-anchor': 'middle' }, usageValueText(total, mode)));
    }
    if (index % labelEvery === 0) {
      group.appendChild(mk('text', { x: x + colW / 2, y: height - 10, class: 'uc-xlab', 'text-anchor': 'middle' }, bucket.label));
    }
    // hit area: a thin column with a tiny value still has to be clickable
    group.appendChild(mk('rect', { x, y: padTop, width: colW, height: innerH, class: 'uc-hit' }));
    group.appendChild(mk('title', {}, usageBucketLine(bucket, mode, usagePrices)));
    const select = () => onSelect(bucket, group);
    group.addEventListener('mouseenter', select);
    group.addEventListener('click', select);
    group.addEventListener('focus', select);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    svg.appendChild(group);
  });

  container.appendChild(svg);
  return buckets.length;
}

async function openUsageModal() {
  let unit = 'day';
  let range = '90';
  let mode = 'tokens';
  let report = null;
  const currentPrices = () => (state.settings && state.settings.usagePrices) || null;

  const backdrop = el('div', 'modal-backdrop usage-backdrop');
  const modal = el('div', 'modal usage-modal');
  modal.appendChild(el('h3', '', tr('Token usage')));

  const hint = el('div', 'set-hint', tr('reading the usage ledger\u2026'));
  modal.appendChild(hint);

  const controls = el('div', 'field-row usage-controls');
  const unitSel = document.createElement('select');
  unitSel.setAttribute('aria-label', tr('Column size'));
  for (const option of USAGE_UNITS) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = tr(option.label);
    unitSel.appendChild(opt);
  }
  const rangeSel = document.createElement('select');
  rangeSel.setAttribute('aria-label', tr('Time range'));
  for (const option of USAGE_RANGES) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = tr(option.label);
    rangeSel.appendChild(opt);
  }
  const metricSel = document.createElement('select');
  metricSel.setAttribute('aria-label', tr('What the columns measure'));
  for (const option of [
    { value: 'tokens', label: tr('tokens') },
    { value: 'cost', label: tr('cost (USD)') },
  ]) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    metricSel.appendChild(opt);
  }
  controls.appendChild(unitSel);
  controls.appendChild(rangeSel);
  controls.appendChild(metricSel);
  modal.appendChild(controls);

  const legend = el('div', 'usage-legend');
  for (const segment of [...USAGE_STACK].reverse()) {
    const chip = el('span', 'usage-legend-item');
    chip.appendChild(el('span', `usage-swatch ${segment.cls}`));
    chip.appendChild(el('span', '', tr(segment.label)));
    legend.appendChild(chip);
  }
  modal.appendChild(legend);

  /*
   * Cache reads are usually two orders of magnitude bigger than in/out (this machine: 32.4M against
   * 850k), which makes the interesting part of the stack a one-pixel cap. The toggle takes cache out
   * of the scale so in/out can actually be compared between days.
   */
  const cacheRow = el('label', 'usage-cache-toggle');
  const cacheBox = document.createElement('input');
  cacheBox.type = 'checkbox';
  cacheBox.checked = true;
  cacheBox.setAttribute('aria-label', tr('Include cache read and cache write in the stack'));
  cacheRow.appendChild(cacheBox);
  cacheRow.appendChild(el('span', '', tr('stack cache read / write (off: the columns show only in and out)')));
  modal.appendChild(cacheRow);

  const chartWrap = el('div', 'usage-chart-wrap');
  modal.appendChild(chartWrap);

  const detail = el('div', 'usage-detail', tr('Hover or click a column for the breakdown.'));
  modal.appendChild(detail);

  const totalsLine = el('div', 'usage-totals', '');
  modal.appendChild(totalsLine);

  const models = el('div', 'usage-models');
  modal.appendChild(models);

  /*
   * Strata reports no prices (pi's usage.cost is 0 for every call), so the money side is computed
   * from rates typed here: USD per 1,000,000 tokens, one row per model plus a default row. They live
   * in the settings file, and the ledger deliberately stores only token counts - re-pricing an old
   * day must not need a re-scan, and a rate change must not rewrite history.
   */
  const rates = el('div', 'usage-rates');
  rates.appendChild(el('div', 'set-hint', tr('rates (USD per 1,000,000 tokens) - Strata reports no prices, so these numbers are what the money side uses. Saved as soon as you leave a box. A model row only overrides the fields you fill in, the rest come from the default rate (its placeholder shows them); to make one model free, set the default row to 0 and give the others their own rows.')));
  const ratesGrid = el('div', 'usage-rates-grid');
  rates.appendChild(ratesGrid);
  modal.appendChild(rates);

  const actions = el('div', 'modal-actions');
  const recountButton = el('button', '', tr('Recount from files'));
  recountButton.title = tr('rebuild the ledger from the session files that exist right now - the only action that can lower the totals (sessions a cleanup deleted leave with their files)');
  const openButton = el('button', 'ghost', tr('Open ledger folder'));
  openButton.title = tr('reveal token_usage.json in the file manager');
  const closeButton = el('button', 'ghost', tr('Close'));
  actions.appendChild(recountButton);
  actions.appendChild(openButton);
  actions.appendChild(closeButton);
  modal.appendChild(actions);
  backdrop.appendChild(modal);
  els.modalRoot.appendChild(backdrop);

  let done = false;
  const opened = new Promise((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      usageDialogDraw = null;
      backdrop.remove();
      modalOpen = null;
      resolve(report);
    };
    modalOpen = { finish, backdrop };
    closeButton.addEventListener('click', finish);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish();
    });
  });

  const selectBucket = (bucket, group) => {
    for (const node of chartWrap.querySelectorAll('.uc-col.selected')) node.classList.remove('selected');
    if (group) group.classList.add('selected');
    detail.textContent = usageBucketLine(bucket, mode, currentPrices());
  };

  function renderRates() {
    ratesGrid.textContent = '';
    const prices = currentPrices() || {};
    const head = el('div', 'usage-rate-row usage-rate-head');
    head.appendChild(el('span', 'usage-rate-model', tr('model')));
    for (const field of PRICE_FIELDS) head.appendChild(el('span', 'usage-rate-cell', tr(PRICE_LABELS[field])));
    ratesGrid.appendChild(head);

    const rows = [{ key: 'default', label: tr('default rate') }];
    for (const model of (report && report.models) || []) {
      if (!rows.some((row) => row.key === model.model)) rows.push({ key: model.model, label: model.model });
    }
    const fallback = normalizePrice(prices.default);
    for (const row of rows) {
      const line = el('div', 'usage-rate-row');
      const name = el('span', 'usage-rate-model', row.label);
      name.title = row.key === 'default' ? tr('used for any model that has no row of its own') : tr('rate for {model}', { model: row.key });
      line.appendChild(name);
      const source = row.key === 'default' ? prices.default : (prices.byModel || {})[row.key];
      for (const field of PRICE_FIELDS) {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '0.01';
        input.value = source && source[field] != null && Number(source[field]) !== 0 ? String(source[field]) : '';
        // an empty model row means "the default rate applies", so show what that is
        input.placeholder = row.key === 'default' ? '0' : String(fallback[field] || 0);
        input.dataset.field = field;
        input.dataset.model = row.key;
        input.setAttribute('aria-label', tr('{label} {field} in USD per million tokens', { label: row.label, field: tr(PRICE_LABELS[field]) }));
        input.addEventListener('change', () => saveRates());
        line.appendChild(input);
      }
      ratesGrid.appendChild(line);
    }
  }

  async function saveRates() {
    const previous = (state.settings && state.settings.usagePrices) || {};
    const next = {
      unit: 'usd_per_million',
      default: { ...normalizePrice(previous.default) },
      byModel: {},
    };
    for (const [model, row] of Object.entries(previous.byModel || {})) next.byModel[model] = { ...normalizePrice(row) };
    for (const input of ratesGrid.querySelectorAll('input[type="number"]')) {
      const field = input.dataset.field;
      const modelKey = input.dataset.model;
      if (!PRICE_FIELDS.includes(field)) continue;
      const value = input.value === '' ? 0 : Number(input.value);
      const target = modelKey === 'default' ? next.default : next.byModel[modelKey] || (next.byModel[modelKey] = normalizePrice(null));
      target[field] = Number.isFinite(value) && value >= 0 ? value : 0;
    }
    // an all-empty model row must mean "the default rate applies", not "this model is free"
    next.byModel = pruneRateRows(next.byModel);
    const merged = await api.settingsSet({ usagePrices: next });
    state.settings = merged || { ...state.settings, usagePrices: next };
    updateUsageFoot();
    await draw();
    toast(hasPrices(next) ? tr('rates saved - {money} for this range', { money: fmtMoney(bucketCostParts({ models: (report && report.models) || [] }, next).total) }) : tr('rates cleared - the money side reads $0'), 'info', 6000);
  }

  function renderModels() {
    models.textContent = '';
    const list = (report && report.models) || [];
    if (!list.length) return;
    const prices = currentPrices();
    const priced = hasPrices(prices);
    models.appendChild(el('div', 'set-hint', priced ? tr('models in this range (priced at the rates below)') : tr('models in this range')));
    for (const model of list.slice(0, 8)) {
      const row = el('div', 'usage-model-row');
      row.appendChild(el('span', 'usage-model-name', model.model));
      const money = priced ? costOf(model, priceForModel(prices, model.model)) : 0;
      row.appendChild(
        el(
          'span',
          'usage-model-totals',
          tr('in {in} \u00b7 out {out} \u00b7 cache {cache} \u00b7 total {total}', {
            in: fmtTokens(model.in),
            out: fmtTokens(model.out),
            cache: fmtTokens((model.cacheRead || 0) + (model.cacheWrite || 0)),
            total: fmtTokens(model.total),
          }) + (money ? ` \u00b7 ${fmtMoney(money)}` : ''),
        ),
      );
      row.appendChild(el('span', 'usage-model-msgs', tr('{n} ans', { n: model.msgs })));
      models.appendChild(row);
    }
    if (list.length > 8) models.appendChild(el('div', 'set-hint', tr('{n} more models not shown', { n: list.length - 8 })));
  }

  async function draw() {
    const res = await api.usageSeries({ unit, fromMs: usageRangeFrom(range), limit: 0 });
    if (!res || !res.ok) {
      hint.textContent = tr('usage ledger failed: {error}', { error: (res && res.error) || tr('unknown error') });
      chartWrap.textContent = '';
      chartWrap.appendChild(el('div', 'note error', tr('could not read the usage ledger')));
      return;
    }
    report = res;
    const prices = currentPrices();
    const priced = hasPrices(prices);
    const costParts = bucketCostParts({ models: res.models || [] }, prices);
    // the footer chip is the ALL-TIME total, so a narrowed range in this dialog must not overwrite it -
    // only the `everything` range feeds the chip
    state.usage = {
      ...(state.usage || {}),
      ...(range === 'all' ? { all: res.totals, allModels: res.models } : {}),
      entries: res.entries,
      gone: res.gone,
      truncated: res.truncated,
      dedupeMissed: res.dedupeMissed,
      ledgerFile: res.ledgerFile,
    };
    updateUsageFoot();
    const notes = [];
    if (res.entries) notes.push(tr('{n} session in the ledger', { n: res.entries }));
    if (res.gone) notes.push(tr('{n} of them no longer exist on disk \u2014 their history is kept', { n: res.gone }));
    if (res.truncated) notes.push(tr('{n} session(s) were bigger than the 12 MB scan cap, so those are counted only up to that point', { n: res.truncated }));
    if (res.dedupeMissed) notes.push(tr('{n} fork(s) could not be deduplicated because their parent session file is gone, so their copied tokens may be counted twice', { n: res.dedupeMissed }));
    if (!priced) notes.push(tr('no rates entered below, so the money side is $0'));
    hint.textContent = `${usageTotalsLine(res.totals, '', costParts)} \u00b7 ${notes.join(' \u00b7 ') || tr('nothing recorded yet')} \u00b7 ${tr('ledger: {path}', { path: res.ledgerFile || tr('not set') })}`;
    totalsLine.textContent = [tr(USAGE_UNITS.find((entry) => entry.value === unit).label), tr('{n} columns', { n: res.buckets.length }), tr(USAGE_RANGES.find((entry) => entry.value === range).label), mode === 'cost' ? tr('columns in USD') : tr('columns in tokens')].join(' \u00b7 ');
    if (mode === 'cost' && !priced) {
      chartWrap.textContent = '';
      chartWrap.appendChild(el('div', 'empty-hint', tr('Enter the rates below (USD per 1,000,000 tokens) and the columns will show what each period cost.')));
    } else {
      buildUsageChart(chartWrap, res, selectBucket, cacheBox.checked, mode, prices);
    }
    renderModels();
    renderRates();
  }
  usageDialogDraw = draw;

  cacheBox.addEventListener('change', () => {
    if (report) buildUsageChart(chartWrap, report, selectBucket, cacheBox.checked, mode, currentPrices());
  });
  metricSel.addEventListener('change', () => {
    mode = metricSel.value === 'cost' ? 'cost' : 'tokens';
    draw();
  });
  unitSel.addEventListener('change', () => {
    unit = unitSel.value;
    draw();
  });
  rangeSel.addEventListener('change', () => {
    range = rangeSel.value;
    draw();
  });
  recountButton.addEventListener('click', async () => {
    // the one action that can lower the numbers: it rebuilds from the files on disk, so sessions a
    // cleanup already deleted leave the chart with it. Asking first is deliberate.
    const answer = await openModal({
      kind: 'confirm',
      title: tr('Recount the usage ledger from the files on disk?'),
      message: tr('Everything currently banked stays unless it comes from a session file that no longer exists. Sessions a cleanup already deleted leave the chart with their files - that is the point of this button, and it cannot be undone.'),
      okLabel: tr('Recount'),
    });
    if (!answer || !answer.confirmed) return;
    recountButton.disabled = true;
    const res = await api.usageRecount();
    recountButton.disabled = false;
    if (!res || !res.ok) {
      toast(tr('recount failed: {error}', { error: (res && res.error) || tr('unknown') }), 'error', 8000);
      return;
    }
    toast(tr('recounted: {parsed} session files read, {dropped} entries of deleted sessions dropped{deduped}', {
      parsed: res.parsed,
      dropped: res.droppedGone || 0,
      deduped: res.deduped ? tr(', {n} copied records recognised as forks', { n: res.deduped }) : '',
    }), 'info', 9000);
    await draw();
  });
  openButton.addEventListener('click', async () => {
    const file = report && report.ledgerFile;
    if (!file) {
      toast(tr('the ledger file is not set'), 'warning');
      return;
    }
    await api.openPath(file, true);
  });

  rangeSel.value = range;
  unitSel.value = unit;
  metricSel.value = mode;
  await draw();
  return opened;
}

/* accessibility (D3)                                                  */
/* ------------------------------------------------------------------ */

/*
 * The app grew without any accessibility work, so instead of touching every dialog and every icon
 * button by hand, two observers do it centrally:
 *
 *  - dialogs: whatever gets appended to #modalRoot becomes a real dialog (role, aria-modal, a label
 *    taken from its heading, focus moved in, Tab kept inside, Esc mapped to its Cancel/Close button,
 *    focus given back to the element that opened it);
 *  - controls: a button whose visible text is empty or a single glyph (the "x" of a tab, the "top"
 *    arrow, ...) gets an accessible name from its title, which every one of them already has.
 *
 * Both are cheap: the observers only look at the nodes that were actually added.
 */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let dialogOpener = null;
let dialogStack = [];

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

/** Buttons that only show a glyph get their accessible name from the title they already carry. */
/**
 * Buttons that only show a glyph get their accessible name from the title they already carry.
 * The work is scoped to the nodes that were actually added (streaming appends a lot of DOM, and a
 * document-wide query every frame would show up in the TPS numbers).
 */
function observeControlNames() {
  let pending = [];
  const glyphish = (text) => text.length <= 2 && !/[p{L}p{N}]/.test(text);
  const name = (button) => {
    if (button.hasAttribute('aria-label') || !button.hasAttribute('title')) return;
    const text = button.textContent.trim();
    if (text && !glyphish(text)) return;
    const label = String(button.title).split('\n')[0].trim();
    if (label) button.setAttribute('aria-label', label);
  };
  const run = () => {
    const roots = pending;
    pending = [];
    for (const root of roots) {
      if (root.matches && root.matches('button[title]')) name(root);
      if (!root.querySelectorAll) continue;
      for (const button of root.querySelectorAll('button[title]')) name(button);
    }
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) pending.push(node);
      }
    }
    if (pending.length === 1) requestAnimationFrame(run); // one pass per frame, however many adds
  }).observe(document.body, { childList: true, subtree: true });
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


/* ------------------------------------------------------------------ */
/* settings dialog (A5)                                               */
/* ------------------------------------------------------------------ */

/**
 * D2: dark is the default (the app grew that way); light is a redefinition of the CSS variables, so
 * no rule is duplicated. "system" follows prefers-color-scheme and keeps following it while running.
 */
function applyTheme(theme) {
  const wanted = theme === 'light' || theme === 'dark' ? theme : 'system';
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const resolved = wanted === 'system' ? (media.matches ? 'light' : 'dark') : wanted;
  document.documentElement.dataset.theme = resolved;
  state.theme = resolved;
  state.themeMode = wanted;
  try {
    localStorage.setItem('stratapilot_theme', resolved); // read by theme-boot.js on the next start
  } catch {
    // the mirror is a nicety: without it the app simply starts dark and corrects itself
  }
}

/**
 * Everything that used to need a hand edit of
 * `%APPDATA%\StrataPilot\stratapilot_settings.json`. The keys are the same ones the app
 * already reads (cwd / serialQueue / strataUrl / monitorOpen / monitorWidth / sidebarHidden),
 * plus `restoreTabs`, which the app now honours as well.
 *
 * The dialog is deliberately a plain form over `app:settings-set`: no new settings store, so a
 * hand-edited file keeps working and the README's table stays the reference.
 */
function openSettingsModal() {
  return new Promise((resolve) => {
    const s = state.settings || {};
    const backdrop = el('div', 'modal-backdrop settings-backdrop');
    const modal = el('div', 'modal settings-modal');
    modal.appendChild(el('h3', '', tr('Settings')));

    const controls = [];
    const group = (title) => modal.appendChild(el('div', 'set-group', title));
    const textRow = (key, label, hint, options = {}) => {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', '', label));
      const row = el('div', 'field-row');
      const box = el('input');
      box.type = options.number ? 'number' : 'text';
      if (options.number) {
        box.min = String(options.min);
        box.max = String(options.max);
        box.step = '10';
      }
      box.value = s[key] == null ? '' : String(s[key]);
      box.placeholder = options.placeholder || '';
      box.dataset.setting = key;
      row.appendChild(box);
      if (options.folderPicker) {
        const browse = el('button', '', tr('Browse…'));
        browse.addEventListener('click', async () => {
          const picked = await api.chooseFolder();
          if (picked.ok) box.value = picked.path;
        });
        row.appendChild(browse);
      }
      if (options.filePicker) {
        const browse = el('button', '', tr('Browse…'));
        browse.addEventListener('click', async () => {
          const picked = await api.chooseFile({ title: options.fileTitle || 'Choose a file', filters: options.filters });
          if (picked.ok) box.value = picked.path;
        });
        row.appendChild(browse);
      }
      if (options.clear) {
        const clear = el('button', 'ghost', tr('clear'));
        clear.title = tr('remove this key from the settings file');
        clear.addEventListener('click', () => {
          box.value = '';
        });
        row.appendChild(clear);
      }
      wrap.appendChild(row);
      if (hint) wrap.appendChild(el('div', 'set-hint', hint));
      modal.appendChild(wrap);
      controls.push({ key, box, kind: options.number ? 'number' : 'text', emptyMeansUnset: !!options.clear, min: options.min, max: options.max });
    };
    const checkRow = (key, label, hint, options = {}) => {
      const wrap = el('div', 'field');
      const row = el('div', 'field-row set-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = options.defaultTrue ? s[key] !== false : !!s[key];
      box.dataset.setting = key;
      row.appendChild(box);
      row.appendChild(el('label', '', label));
      wrap.appendChild(row);
      if (hint) wrap.appendChild(el('div', 'set-hint', hint));
      modal.appendChild(wrap);
      controls.push({ key, box, kind: 'checkbox', defaultTrue: !!options.defaultTrue });
    };
    const selectRow = (key, label, options, hint, defaults) => {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', '', label));
      const box = document.createElement('select');
      box.dataset.setting = key;
      for (const option of options) {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        const current = s[key] == null ? (defaults && defaults[key]) : s[key];
        if (String(current) === String(option.value)) opt.selected = true;
        box.appendChild(opt);
      }
      wrap.appendChild(box);
      if (hint) wrap.appendChild(el('div', 'set-hint', hint));
      modal.appendChild(wrap);
      controls.push({ key, box, kind: 'select' });
    };
    // D6: a list setting (one entry per line) - the extra Strata servers to watch
    const listRow = (key, label, hint, options = {}) => {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', '', label));
      const box = el('textarea');
      box.dataset.setting = key;
      box.rows = 3;
      box.value = (Array.isArray(s[key]) ? s[key] : []).join(String.fromCharCode(10));
      box.placeholder = options.placeholder || '';
      wrap.appendChild(box);
      if (hint) wrap.appendChild(el('div', 'set-hint', hint));
      modal.appendChild(wrap);
      controls.push({ key, box, kind: 'list' });
    };

    group(tr('Sessions and queue'));
    textRow('cwd', tr('Default working folder for new tabs'), tr('used when a session file records a folder that no longer exists, and for every new tab'), { folderPicker: true });
    checkRow('serialQueue', tr('Serial queue: run one session at a time (Strata is single-flight)'), tr('off = all tabs may call the model at the same time'), { defaultTrue: true });
    checkRow('restoreTabs', tr('Reopen the tabs from the previous run (up to 4)'), tr('off = always start with a single new tab'), { defaultTrue: true });

    group(tr('Scheduled prompts'));
    const jobsRow = el('div', 'field-row');
    const jobsButton = el('button', '', tr('Manage scheduled jobs\u2026'));
    jobsButton.addEventListener('click', async () => {
      finish(false);
      await openJobsModal();
    });
    jobsRow.appendChild(jobsButton);
    jobsRow.appendChild(el('span', 'set-hint', tr('cron runs in the background process; a due prompt is queued into a session, never sent behind the queue\u2019s back')));
    modal.appendChild(jobsRow);

    group(tr('Strata server'));
    textRow('strataUrl', tr('Fixed Strata address (Monitor and diagnostics)'), tr('leave empty to derive it from the active tab model baseUrl, e.g. http://127.0.0.1:8081/v1'), { placeholder: 'http://127.0.0.1:8081/v1', clear: true });
    textRow('strataConfigPath', tr('Strata engine config (only for the diagnostics report)'), tr('e.g. C:\\Strata\\strata-src\\strata-<model>.json \u2014 copied into the report with keys redacted'), { filePicker: true, fileTitle: tr('Strata engine config'), filters: [{ name: 'JSON', extensions: ['json'] }], clear: true });
    listRow('strataUrls', tr('Other Strata servers to watch (one address per line)'), tr('D6: the Monitor gets a button per address, so two servers on two ports can be compared; the first entry is still the one the cards show unless you pick another)'), { placeholder: 'http://127.0.0.1:8082/v1' });

    group(tr('Interface'))
    ;
    checkRow('monitorOpen', tr('Open the Strata Monitor at startup'), '', { defaultTrue: true });
    textRow('monitorWidth', tr('Monitor panel width (px)'), tr('340 \u2013 900; you can also drag the divider in the Monitor'), { number: true, min: 340, max: 900 });
    checkRow('sidebarHidden', tr('Start with the sidebar hidden'), '');
    selectRow('theme', tr('Theme'), [
      { value: 'dark', label: tr('Dark (default)') },
      { value: 'light', label: tr('Light') },
      { value: 'system', label: tr('Follow the system theme') },
    ], tr('applies as soon as you save; only the colours change, nothing is written anywhere else'), { theme: 'dark' });
    // D10: the language names are written in their own script on purpose - that is the one row that
    // works even when the rest of the dialog is in a language the user cannot read
    selectRow('language', tr('Language'), [
      { value: 'auto', label: `${tr('Auto (follow the system)')} (${i18nInfo.systemLocale})` },
      { value: 'en', label: 'English' },
      { value: 'zh-TW', label: '繁體中文' },
      { value: 'zh-CN', label: '简体中文' },
    ], tr('the app\u2019s own words (menus, buttons, dialogs, chips) follow this right away; pi answers in the language you prompt it in, and the log file and the diagnostics report stay English'), { language: 'auto' });

    group(tr('Files'))
    ;
    const paths = el('div', 'set-paths');
    const pathRow = (label, target) => {
      const row = el('div', 'set-path-row');
      row.appendChild(el('span', 'set-path-label', label));
      const value = el('button', 'ghost set-path-value', target || tr('(not available)'));
      value.disabled = !target;
      value.title = target ? tr('open {path}', { path: target }) : '';
      value.addEventListener('click', () => api.openPath(target, false));
      row.appendChild(value);
      paths.appendChild(row);
    };
    pathRow(tr('settings file'), state.info && state.info.settingsPath);
    pathRow(tr('log file'), state.info && state.info.logPath);
    pathRow(tr('sessions folder'), state.info && state.info.sessionsRoot);
    modal.appendChild(paths);
    modal.appendChild(
      el(
        'div',
        'set-hint',
        tr('Deleting the settings file resets everything (open tabs, window size, Monitor state). pi model settings live in ~/.pi/agent/settings.json and are not touched here.'),
      ),
    );

    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'ghost', tr('Cancel'));
    const ok = el('button', 'primary', tr('Save'));
    actions.appendChild(cancel);
    actions.appendChild(ok);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let done = false;
    const finish = (saved) => {
      if (done) return;
      done = true;
      backdrop.remove();
      modalOpen = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(saved);
    };
    modalOpen = { finish, backdrop };

    const collect = () => {
      const patch = {};
      for (const control of controls) {
        if (control.kind === 'list') {
          patch[control.key] = [...new Set(control.box.value.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean))];
        } else if (control.kind === 'checkbox') {
          // write only real changes for the default-true keys, so the file stays close to its old shape
          patch[control.key] = control.box.checked;
        } else if (control.kind === 'number') {
          const value = Number(control.box.value);
          if (!Number.isFinite(value)) continue;
          patch[control.key] = Math.min(Math.max(value, control.min), control.max);
        } else {
          const value = control.box.value.trim();
          if (!value && control.emptyMeansUnset) patch[control.key] = '';
          else if (value) patch[control.key] = value;
        }
      }
      return patch;
    };

    const submit = async () => {
      const patch = collect();
      const merged = await api.settingsSet(patch);
      state.settings = merged || patch;
      applySettings(state.settings);
      // D10: the language is switched before the confirmation, so the toast the user reads after
      // pressing Save is already in the language they just picked
      await setLanguage(merged.language || 'auto');
      toast(tr('settings saved'), 'info', 3000);
      finish(true);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === 'Enter' && event.target && event.target.tagName !== 'TEXTAREA') {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    };
    document.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => finish(false));
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish(false);
    });
    setTimeout(() => {
      const first = modal.querySelector('input');
      if (first) first.focus();
    }, 30);
  });
}

/**
 * Push the saved settings into the live UI. Called after the dialog saves and after a manual
 * edit of the file plus a reload, so "edit the JSON by hand" keeps working too.
 */
function applySettings(settings) {
  state.settings = settings || state.settings || {};
  const s = state.settings;
  applyTheme(s.theme);
  if (s.cwd && s.cwd !== state.cwd) state.cwd = s.cwd;
  scheduler.enabled = s.serialQueue !== false;
  els.serialToggle.checked = scheduler.enabled;
  els.body.classList.toggle('sidebar-hidden', !!s.sidebarHidden);
  applyMonitorWidth();
  if (els.monitorView.classList.contains('hidden') && s.monitorOpen !== false) openMonitor();
  if (s.monitorOpen === false && !els.monitorView.classList.contains('hidden')) closeMonitor();
  if (scheduler.enabled) scheduler.pumpSoon(0);
  // D10: the Settings dialog saves through here, so a language change arrives this way too - including
  // when the file was edited by hand and the app was reloaded
  const pref = s.language || 'auto';
  if (pref !== i18nInfo.pref) setLanguage(pref).catch((err) => console.error('[i18n] language change failed', err));
  renderOpenSessions();
}

/* ------------------------------------------------------------------ */
/* strata server monitor (ported from strata-src serve/web/app.js)     */
/* ------------------------------------------------------------------ */

const MON_CARDS = [
  { key: 'speed', label: i18nKey('Speed') },
  { key: 'gpu', label: i18nKey('GPU load') },
  { key: 'vram', label: i18nKey('VRAM') },
  { key: 'temp', label: i18nKey('GPU temp'), tone: 'amber' },
  { key: 'power', label: i18nKey('Power'), tone: 'amber' },
  { key: 'pcie', label: i18nKey('PCIe'), tone: 'blue' },
  { key: 'cpu', label: i18nKey('CPU'), tone: 'blue' },
  { key: 'disk', label: i18nKey('Disk read'), tone: 'blue' },
];
const MON_STATES = ['idle', 'reading', 'generating', 'queued', 'error'];
// the badges are built from MON_STATES, so the words have to be spelled out for the catalogs
const MON_STATE_BADGE_LABELS = {
  idle: i18nKey('Idle'),
  reading: i18nKey('Reading'),
  generating: i18nKey('Generating'),
  queued: i18nKey('Queued'),
  error: i18nKey('Error'),
};
const RING_R = 37.5;
const RING_C = 2 * Math.PI * RING_R;

const monitor = {
  open: false,
  timer: null,
  showAll: false,
  built: false,
  failures: 0,
  lastData: null,
  baseUrl: '', // D6: which server the cards follow ('' = the active tab's)
  health: new Map(), // serverKey -> { ok, ms } or { ok: false, error }
  serversSignature: null,
  tick: 0,
};

const nfmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const kfmt = (n) => (n == null ? '–' : n >= 1000 ? `${nfmt(n / 1000, n >= 10000 ? 0 : 1)}k` : nfmt(n));
const ctxfmt = (n) => (n && n % 1024 === 0 ? `${nfmt(n / 1024)}K` : kfmt(n));
const gb = (bytes, d = 1) => (bytes == null ? '–' : nfmt(bytes / 1073741824, d));

function strataBaseUrl() {
  if (state.settings.strataUrl) return state.settings.strataUrl;
  const active = activeTab();
  if (active && active.model && active.model.baseUrl) return active.model.baseUrl;
  for (const tab of state.tabs.values()) {
    if (tab.model && tab.model.baseUrl) return tab.model.baseUrl;
  }
  return 'http://127.0.0.1:8081/v1';
}

function setMonSrc(text, isError = false) {
  els.monSrc.textContent = text;
  els.monSrc.classList.toggle('err', isError);
}

/*
 * D6: more than one Strata server. The Monitor used to show whatever strataBaseUrl() derived from the
 * active tab, which made two servers on two ports impossible to compare. Now every known address gets a
 * pill: click it to point the cards at that server, and each pill carries its own /health dot so the
 * reachability of all of them is visible at once.
 */
function serverKey(url) {
  return String(url || '').replace(/\/+$/, '').replace(/\/v1$/i, '').toLowerCase();
}

/** The address the cards should follow: the picked one, or the active tab's model server. */
function monitorTargetUrl() {
  return monitor.baseUrl || strataBaseUrl();
}

/** Every address worth a pill: the derived one, the ones from Settings, and the ones the tabs use. */
function monitorServerUrls() {
  const out = [strataBaseUrl()];
  const extras = Array.isArray(state.settings.strataUrls) ? state.settings.strataUrls : [];
  const fromTabs = [...state.tabs.values()].map((tab) => tab.model && tab.model.baseUrl).filter(Boolean);
  for (const url of [...extras, ...fromTabs]) {
    if (!out.some((entry) => serverKey(entry) === serverKey(url))) out.push(url);
  }
  return out;
}

function renderMonitorServers() {
  if (!els.monServers) return;
  const urls = monitorServerUrls();
  const signature = `${urls.join('|')}#${monitor.baseUrl || ''}`;
  if (signature === monitor.serversSignature) return;
  monitor.serversSignature = signature;
  els.monServers.textContent = '';

  const follow = el('button', `mon-server${monitor.baseUrl ? '' : ' active'}`, tr('active tab'));
  follow.title = tr("follow the active tab's server ({url})", { url: strataBaseUrl() });
  follow.dataset.url = '';
  follow.addEventListener('click', () => {
    monitor.baseUrl = '';
    monitor.serversSignature = null;
    renderMonitorServers();
    pollMonitor();
  });
  els.monServers.appendChild(follow);

  for (const url of urls) {
    const pill = el('button', `mon-server${monitor.baseUrl && serverKey(monitor.baseUrl) === serverKey(url) ? ' active' : ''}`, serverLabel(url));
    pill.title = url;
    pill.dataset.url = url;
    const dot = el('span', 'mon-dot unknown');
    dot.title = tr('health unknown');
    pill.appendChild(dot);
    pill.addEventListener('click', () => {
      monitor.baseUrl = url;
      monitor.serversSignature = null;
      renderMonitorServers();
      pollMonitor();
    });
    if (serverKey(url) !== serverKey(strataBaseUrl())) {
      const remove = el('span', 'mon-server-x', '×');
      remove.title = tr('stop watching {url} (removes it from Settings)', { url });
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        const kept = (Array.isArray(state.settings.strataUrls) ? state.settings.strataUrls : []).filter((entry) => serverKey(entry) !== serverKey(url));
        const merged = await api.settingsSet({ strataUrls: kept });
        state.settings = merged || { ...state.settings, strataUrls: kept };
        if (monitor.baseUrl && serverKey(monitor.baseUrl) === serverKey(url)) monitor.baseUrl = '';
        monitor.serversSignature = null;
        renderMonitorServers();
        pollMonitor();
      });
      pill.appendChild(remove);
    }
    els.monServers.appendChild(pill);
    applyHealthDot(pill, url);
  }

  const add = el('button', 'mon-server mon-server-add', tr('+ add server'));
  add.title = tr('watch another Strata address (saved in Settings)');
  add.addEventListener('click', async () => {
    const answer = await openModal({ kind: 'input', title: tr('Add a Strata server'), message: tr('Base address, e.g. http://127.0.0.1:8082/v1'), placeholder: 'http://127.0.0.1:8082/v1', okLabel: tr('Watch it') });
    if (!answer || answer.cancelled || !String(answer.value || '').trim()) return;
    const url = String(answer.value).trim();
    const current = Array.isArray(state.settings.strataUrls) ? state.settings.strataUrls : [];
    const merged = await api.settingsSet({ strataUrls: [...new Set([...current, url])] });
    state.settings = merged || { ...state.settings, strataUrls: [...current, url] };
    monitor.baseUrl = url;
    monitor.serversSignature = null;
    renderMonitorServers();
    pollMonitor();
    toast(tr('watching {url}', { url }), 'info', 3000);
  });
  els.monServers.appendChild(add);
}

function serverLabel(url) {
  const text = String(url).replace(/\/+$/, '').replace(/\/v1$/i, '');
  const match = text.match(/^https?:\/\/([^/]+)/i);
  return match ? match[1] : text;
}

function applyHealthDot(pill, url) {
  const dot = pill.querySelector('.mon-dot');
  if (!dot) return;
  const health = monitor.health.get(serverKey(url));
  if (!health) {
    dot.className = 'mon-dot unknown';
    dot.title = tr('health not checked yet');
    return;
  }
  if (health.ok) {
    dot.className = 'mon-dot ok';
    dot.title = tr('reachable in {ms}ms', { ms: health.ms });
  } else {
    dot.className = 'mon-dot bad';
    dot.title = health.error ? tr(health.error) : tr('not reachable');
  }
}

async function pollServerHealth() {
  const urls = monitorServerUrls();
  const results = await Promise.all(urls.map((url) => api.strataHealth({ baseUrl: url })));
  urls.forEach((url, index) => {
    const result = results[index];
    monitor.health.set(serverKey(url), result.ok ? { ok: true, ms: result.ms } : { ok: false, error: result.error || `HTTP ${result.status}` });
  });
  for (const pill of els.monServers.querySelectorAll('.mon-server')) {
    if (pill.dataset.url) applyHealthDot(pill, pill.dataset.url);
  }
}

function buildMonitorCards() {
  if (monitor.built) return;
  els.monBadges.textContent = '';
  for (const s of MON_STATES) {
    const badge = el('span', 'st-badge', tr(MON_STATE_BADGE_LABELS[s] || s));
    badge.dataset.s = s;
    els.monBadges.appendChild(badge);
  }
  els.monCards.textContent = '';
  for (const card of MON_CARDS) {
    const node = el('div', 'mcard');
    node.appendChild(el('div', 'mcard-head', tr(card.label)));
    node.innerHTML +=
      card.key === 'speed'
        ? `<div class="m-pair">
             <div><span class="m-value" id="mv-speed">&ndash;</span><span class="m-sub" id="ms-speed">${tr('Decode')}</span></div>
             <div><span class="m-value" id="mv-prefill">&ndash;</span><span class="m-sub" id="ms-prefill">${tr('Prefill')}</span></div>
           </div>
           <svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none">
             <g id="sp-prefill" class="pair2"><path class="area" fill="currentColor" opacity=".12"/><path class="line" fill="none" stroke="currentColor" stroke-width="1.4"/></g>
             <g id="sp-speed"><path class="area" fill="currentColor" opacity=".12"/><path class="line" fill="none" stroke="currentColor" stroke-width="1.6"/></g>
           </svg>`
        : `<span class="m-value" id="mv-${card.key}">&ndash;</span>
           <span class="m-sub" id="ms-${card.key}"></span>
           <svg class="spark" id="sp-${card.key}" data-tone="${card.tone || ''}" viewBox="0 0 100 32" preserveAspectRatio="none">
             <path class="area" fill="currentColor" opacity=".12"/><path class="line" fill="none" stroke="currentColor" stroke-width="1.6"/>
           </svg>`;
    els.monCards.appendChild(node);
  }
  monitor.built = true;
}

function setMetric(key, value, unit, sub) {
  const valueEl = document.getElementById(`mv-${key}`);
  const subEl = document.getElementById(`ms-${key}`);
  if (!valueEl || !subEl) return;
  const html = value == null ? '–' : `${window.escapeHtml(String(value))}${unit ? `<small>${window.escapeHtml(unit)}</small>` : ''}`;
  if (valueEl.innerHTML !== html) valueEl.innerHTML = html;
  if (subEl.textContent !== (sub || '')) subEl.textContent = sub || '';
}

function drawSpark(id, values, max) {
  const node = document.getElementById(id);
  if (!node) return;
  const line = node.querySelector('.line');
  const area = node.querySelector('.area');
  if (!line || !area) return;
  const data = (values || []).map((x) => (x == null ? 0 : x));
  if (data.length < 2) {
    line.setAttribute('d', '');
    area.setAttribute('d', '');
    return;
  }
  const top = Math.max(max || 0, ...data, 1);
  const points = data.map((x, i) => [(i / (data.length - 1)) * 100, 30 - (x / top) * 26]);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('');
  line.setAttribute('d', d);
  area.setAttribute('d', `${d}L100,32L0,32Z`);
}

function monitorTotalsLine(totals) {
  if (!totals || !totals.requests) return '';
  const since = new Date(totals.since * 1000).toLocaleString(i18nInfo.lang === 'en' ? [] : i18nInfo.lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const read = totals.prompt_tokens - totals.reused;
  const prefill = totals.prompt_ms > 0 && read > 0 ? tr(' at {n} tok/s', { n: nfmt(read / (totals.prompt_ms / 1000)) }) : '';
  const decode = totals.decode_ms > 0 && totals.output_tokens > 0 ? tr(' at {n} tok/s', { n: nfmt(totals.output_tokens / (totals.decode_ms / 1000), 1) }) : '';
  return tr('Since {since}: {requests} requests · {read} prompt tokens read{prefill} ({reused} reused) · {written} written{decode}', {
    since,
    requests: nfmt(totals.requests),
    read: nfmt(read),
    prefill,
    reused: nfmt(totals.reused),
    written: nfmt(totals.output_tokens),
    decode,
  });
}

function renderMonitor(data) {
  const live = data.live || {};
  const hw = data.hardware || {};
  const st = data.hardware_static || {};
  const eng = data.engine || {};
  const history = data.history || {};
  const requests = data.requests || [];
  const last = requests[0];

  // model state
  const on = live.queued > 0 ? 'queued' : live.state;
  for (const badge of els.monBadges.children) {
    badge.classList.toggle('on', badge.dataset.s === on || badge.dataset.s === live.state);
  }
  let label = tr('Waiting for a request');
  let detail = '';
  let pct = 0;
  if (live.state === 'reading') {
    label = tr('Reading prompt');
    if (live.prompt_total) {
      pct = (100 * live.prompt_read) / live.prompt_total;
      detail = tr('{read} / {total} tokens · {pct}%', { read: nfmt(live.prompt_read), total: nfmt(live.prompt_total), pct: nfmt(pct) });
    } else {
      detail = tr('{n} tokens', { n: nfmt(live.prompt_tokens) });
    }
  } else if (live.state === 'generating') {
    label = live.phase ? tr(live.phase[0].toUpperCase() + live.phase.slice(1)) : tr('Generating');
    pct = live.max_tokens ? Math.min(100, (100 * live.generated) / live.max_tokens) : 0;
    detail = tr('{n} tokens · {rate} tok/s', { n: nfmt(live.generated), rate: nfmt(live.tok_s, 1) });
  } else if (last) {
    detail = tr('last: {n} tokens{at}', { n: nfmt(last.output_tokens), at: last.decode_tok_s ? tr(' at {rate} tok/s', { rate: nfmt(last.decode_tok_s, 1) }) : '' });
  }
  els.monStateLabel.textContent = live.queued > 0 ? tr('{label} · {n} queued', { label, n: live.queued }) : label;
  els.monStateDetail.textContent = detail;
  els.monStateBar.style.width = `${pct}%`;
  els.monStateBar.classList.toggle('info', live.state === 'reading');

  // metric cards
  const speed = live.state === 'generating' ? live.tok_s : last ? last.decode_tok_s : null;
  setMetric('speed', speed == null ? null : nfmt(speed, 1), 't/s', live.state === 'generating' ? tr('Decode now') : last ? tr('Decode last request') : tr('Decode'));
  const prefill =
    live.state !== 'idle' ? live.prefill_tok_s_mean : last && last.prompt_ms > 0 ? Math.max(0, last.prompt_tokens - (last.reused || 0)) / (last.prompt_ms / 1000) : null;
  setMetric('prefill', prefill == null ? null : nfmt(prefill), 't/s', live.state === 'reading' ? tr('Prefill now') : live.state === 'generating' ? tr('Prefill this request') : last ? tr('Prefill last request') : tr('Prefill'));
  drawSpark('sp-speed', history.tok_s);
  drawSpark('sp-prefill', history.prefill_tok_s_mean);

  const gpus = hw.gpus || [];
  const multi = gpus.length > 1;
  const perGpu = (fn) => gpus.map((g) => `${tr('GPU')} ${g.index} ${fn(g)}`).join(' · ');
  setMetric('gpu', hw.gpu_util == null ? null : nfmt(hw.gpu_util), '%', multi ? perGpu((g) => (g.util == null ? '–' : `${nfmt(g.util)}%`)) : st.gpu_name || (st.gpu_note ? tr('not available') : ''));
  drawSpark('sp-gpu', history.gpu_util, 100);
  setMetric(
    'vram',
    hw.gpu_mem_used == null ? null : gb(hw.gpu_mem_used),
    hw.gpu_mem_total ? `/ ${gb(hw.gpu_mem_total, 0)} GB` : 'GB',
    multi ? perGpu((g) => (g.mem_used == null ? '–' : `${gb(g.mem_used)} GB`)) : eng.expert_slots ? tr('{n} experts cached', { n: nfmt(eng.expert_slots) }) : st.gpu_note ? tr('not available on Windows AMD yet') : '',
  );
  drawSpark('sp-vram', history.gpu_mem_used, hw.gpu_mem_total);
  setMetric('temp', hw.gpu_temp == null ? null : nfmt(hw.gpu_temp), '°C', multi ? perGpu((g) => (g.temp == null ? '–' : `${nfmt(g.temp)}°`)) : '');
  drawSpark('sp-temp', history.gpu_temp, 90);
  setMetric('power', hw.gpu_power == null ? null : nfmt(hw.gpu_power), 'W', hw.gpu_power_limit ? tr('of {n} W limit', { n: nfmt(hw.gpu_power_limit) }) : '');
  drawSpark('sp-power', history.gpu_power, hw.gpu_power_limit);
  const gen = hw.gpu_pcie_gen_max || hw.gpu_pcie_gen;
  setMetric(
    'pcie',
    gen ? `Gen${gen}` : null,
    hw.gpu_pcie_width ? `x${hw.gpu_pcie_width}` : '',
    hw.gpu_pcie_rx_mb == null
      ? ''
      : `${tr('to GPU')} ${nfmt(hw.gpu_pcie_rx_mb, hw.gpu_pcie_rx_mb < 10 ? 1 : 0)} MB/s` + (hw.gpu_pcie_gen && gen && hw.gpu_pcie_gen < gen ? ` · ${tr('idle')} Gen${hw.gpu_pcie_gen}` : ''),
  );
  drawSpark('sp-pcie', history.gpu_pcie_rx_mb);
  setMetric('cpu', hw.cpu == null ? null : nfmt(hw.cpu), '%', st.threads ? `${st.cores ? `${st.cores} ${tr('cores')} · ` : ''}${st.threads} ${tr('threads')}` : '');
  drawSpark('sp-cpu', history.cpu, 100);
  if (hw.disk_read_mb == null) {
    setMetric('disk', null, '', st.psutil ? '' : tr('needs psutil'));
  } else {
    const big = hw.disk_read_mb >= 1000;
    setMetric(
      'disk',
      big ? nfmt(hw.disk_read_mb / 1024, 2) : nfmt(hw.disk_read_mb, hw.disk_read_mb < 10 ? 1 : 0),
      big ? 'GB/s' : 'MB/s',
      hw.disk_write_mb == null ? '' : `${tr('write')} ${nfmt(hw.disk_write_mb, 1)} MB/s`,
    );
  }
  drawSpark('sp-disk', history.disk_read_mb);

  // context fill ring
  const ctx = eng.max_context || 0;
  let used = 0;
  if (live.state !== 'idle') used = (live.prompt_tokens || 0) + (live.generated || 0);
  else if (last) used = (last.prompt_tokens || 0) + (last.output_tokens || 0);
  const frac = ctx ? Math.min(1, used / ctx) : 0;
  const arc = RING_C * frac;
  // inline style, NOT setAttribute: `.ring-fill { stroke-dasharray: 0 ... }` in the
  // stylesheet is a real CSS declaration, so it overrode the presentation attribute
  // and the arc stayed zero-length (a lone round dot while the label said 50%)
  els.monCtxFill.style.strokeDasharray = `${arc.toFixed(1)} ${RING_C.toFixed(1)}`;
  els.monCtxFill.style.opacity = arc >= 3 ? '1' : '0';
  els.monCtxFill.classList.toggle('warn', frac >= 0.75 && frac < 0.9);
  els.monCtxFill.classList.toggle('crit', frac >= 0.9);
  els.monCtxPct.textContent = `${Math.round(frac * 100)}%`;
  els.monCtxSub.textContent = ctx ? `${kfmt(used)} / ${ctxfmt(ctx)}` : '–';

  const cacheBytes = (eng.expert_cache_mib || 0) * 1048576;
  els.monSlotsText.textContent = eng.expert_slots ? `${nfmt(eng.expert_slots)} · ${gb(cacheBytes)} GB` : '–';
  els.monSlotsBar.style.width = hw.gpu_mem_total ? `${Math.min(100, (100 * cacheBytes) / hw.gpu_mem_total)}%` : '0%';
  els.monRamText.textContent = hw.ram_total ? `${gb(hw.ram_used)} / ${gb(hw.ram_total, 0)} GB` : '–';
  els.monRamBar.style.width = hw.ram_total ? `${Math.min(100, (100 * hw.ram_used) / hw.ram_total)}%` : '0%';
  els.monTempText.textContent = hw.gpu_temp == null ? '–' : `${nfmt(hw.gpu_temp)} °C`;
  els.monTempBar.style.width = hw.gpu_temp == null ? '0%' : `${Math.min(100, hw.gpu_temp)}%`;
  els.monEngineText.textContent = `${eng.model || '?'} · ctx ${ctxfmt(eng.max_context)} · kv ${eng.kv || '?'}${eng.version ? ` · ${eng.version}` : ''}`;

  // recent requests
  if (!requests.length) {
    els.monReqBody.innerHTML = `<tr><td colspan="9" class="muted">${tr('No requests yet')}</td></tr>`;
  } else {
    const badge = {
      stop: ['ok', tr('Done')],
      length: ['warn', tr('Max tokens')],
      cancel: ['warn', tr('Stopped')],
      disconnect: ['warn', tr('Closed')],
      error: ['error', tr('Error')],
    };
    const MON_MAX_ROWS = 150;
    const shown = monitor.showAll ? requests.slice(0, MON_MAX_ROWS) : requests.slice(0, 12);
    els.monReqBody.innerHTML = shown
      .map((r) => {
        const [cls, text] = badge[r.finish] || ['', r.finish || '–'];
        const time = new Date(r.time * 1000).toLocaleTimeString(i18nInfo.lang === 'en' ? [] : i18nInfo.lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const hit =
          r.hit_rate == null
            ? '–'
            : `${(r.hit_rate * 100).toFixed(1)}%` +
              (r.pcie_share
                ? ` <span class="muted" title="${tr('routed experts the GPU read over PCIe (--pcie-frac) or another GPU computed')}">+${(r.pcie_share * 100).toFixed(1)}%P</span>`
                : '');
        const fresh = r.prompt_tokens == null ? null : Math.max(0, r.prompt_tokens - (r.reused || 0));
        const prefillRate = fresh > 0 && r.prompt_ms > 0 ? fresh / (r.prompt_ms / 1000) : null;
        return `<tr><td>${window.escapeHtml(time)}</td><td><span class="req-badge ${cls}">${window.escapeHtml(text)}</span></td><td class="num">${nfmt(r.prompt_tokens)}</td><td class="num">${nfmt(r.reused)}</td><td class="num">${nfmt(r.output_tokens)}</td><td class="num">${nfmt(prefillRate)}</td><td class="num">${nfmt(r.decode_tok_s, 1)}</td><td class="num">${hit}</td><td class="num">${nfmt(r.duration_s, 1)} s</td></tr>`;
      })
      .join('');
    if (monitor.showAll && requests.length > shown.length) {
      els.monReqBody.insertAdjacentHTML(
        'beforeend',
        `<tr><td colspan="9" class="muted">${tr('newest {shown} of {total} shown (the rest are hidden to keep the UI light)', { shown: shown.length, total: requests.length })}</td></tr>`,
      );
    }
  }
  const kept = data.requests_kept == null ? requests.length : data.requests_kept;
  els.monReqAll.hidden = kept <= 12;
  els.monReqAll.textContent = monitor.showAll ? tr('Show fewer') : tr('Show all ({n})', { n: kept });
  els.monReqBody.closest('.req-wrap').classList.toggle('all', monitor.showAll);
  els.monTotals.textContent = monitorTotalsLine(data.totals);
}

async function pollMonitor() {
  if (!monitor.open) return;
  monitor.tick += 1;
  renderMonitorServers();
  if (monitor.tick % 4 === 1) pollServerHealth(); // D6: health of every watched server, once every 4s
  const target = monitorTargetUrl();
  const result = await api.strataMetrics({ baseUrl: target, all: monitor.showAll });
  if (!monitor.open) return;
  if (!result.ok) {
    monitor.failures++;
    setMonSrc(`${result.url || target} · ${result.error}${monitor.failures === 3 ? ' (server not reachable)' : ''}`, true);
    return;
  }
  monitor.failures = 0;
  monitor.lastData = result.data;
  // #6: the key only goes to a local/LAN address or to a server listed in Settings. When it was
  // withheld the cards still render, but the line says so instead of letting the user wonder why an
  // authenticated endpoint answered like an unauthenticated one.
  setMonSrc(`${result.url} · live${result.keyWithheld ? ' · key withheld (add this server in Settings)' : ''} · updated ${new Date().toLocaleTimeString()}`);
  renderMonitor(result.data);
}

function applyMonitorWidth() {
  const width = Math.min(900, Math.max(340, Number(state.settings.monitorWidth) || 500));
  document.documentElement.style.setProperty('--mon-w', `${width}px`);
}

function openMonitor() {
  monitor.open = true;
  els.monitorView.classList.remove('hidden');
  els.body.classList.add('monitor-open');
  els.btnMonitor.classList.add('monitor-on');
  buildMonitorCards();
  monitor.serversSignature = null;
  renderMonitorServers();
  clearInterval(monitor.timer);
  monitor.timer = setInterval(pollMonitor, 1000);
  pollMonitor();
  api.settingsSet({ monitorOpen: true });
}

function closeMonitor() {
  monitor.open = false;
  els.monitorView.classList.add('hidden');
  els.body.classList.remove('monitor-open');
  els.btnMonitor.classList.remove('monitor-on');
  clearInterval(monitor.timer);
  monitor.timer = null;
  api.settingsSet({ monitorOpen: false });
}

function toggleMonitor() {
  if (monitor.open) closeMonitor();
  else openMonitor();
}

/* ------------------------------------------------------------------ */
/* sending                                                             */
/* ------------------------------------------------------------------ */

async function respawnTab(tab) {
  pushNote(tab, 'restarting pi process for this tab…', 'warn');
  const res = await api.spawn({ tabId: tab.id, cwd: tab.cwd, args: tab.args });
  if (!res.ok) {
    pushNote(tab, `failed to restart pi: ${res.error}`, 'error');
    toast(res.error || 'restart failed', 'error');
    return false;
  }
  tab.items = [];
  tab.tools.clear();
  tab.streaming = null;
  tab.currentRequest = null;
  tab.pendingQueued = [];
  tab.alive = true;
  tab.starting = true;
  await bootstrap(tab);
  return true;
}

/** Build a message from the composer + attachments (does not clear them). */
function collectMessage(tab) {
  const raw = els.input.value.trim();
  if (!raw && !tab.attachments.length && !tab.images.length && !tab.inlines.length) return null;

  let text = raw;
  if (tab.attachments.length) {
    const lines = tab.attachments.map((item) => `- ${item.path}${item.isDirectory ? ' (directory)' : ''}`);
    text = `${text}${text ? '\n\n' : ''}[attached files]\n${lines.join('\n')}\n(use the read tool on these paths)`;
  }
  if (tab.inlines.length) {
    for (const item of tab.inlines) {
      text = `${text}${text ? '\n\n' : ''}[${item.name}]\n\`\`\`\n${item.text}\n\`\`\``;
    }
  }
  if (!text && tab.images.length) text = 'Look at the attached image(s).';
  const images = tab.images.map((image) => ({ type: 'image', data: image.data, mimeType: image.mimeType }));
  return { text, images, at: Date.now() };
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
const BASH_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function parseBashInput(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('!')) return null;
  const excludeFromContext = trimmed.startsWith('!!');
  const command = trimmed.slice(excludeFromContext ? 2 : 1).trim();
  if (!command) return null;
  return { command, excludeFromContext };
}

async function runBash(tab, info) {
  if (tab.bashRunning) {
    toast('a bash command is already running in this session — Esc stops it', 'warning');
    return false;
  }
  const bashId = `b${Date.now().toString(36)}${++state.bashSeq}`;
  const entry = {
    id: bashId,
    command: info.command,
    output: '',
    exitCode: null,
    cancelled: false,
    truncated: false,
    fullOutputPath: '',
    excludeFromContext: info.excludeFromContext,
    error: '',
    status: 'running',
    startedAt: Date.now(),
    durationMs: 0,
    fromHistory: false,
    el: null,
  };
  tab.bashes.set(bashId, entry);
  tab.bashRunning = bashId;
  const bashKey = nextKey(tab);
  appendItem(tab, { key: bashKey, kind: 'bash', bashId });
  // a model run in this tab keeps the pin: `!cmd` does not interrupt it
  const trackRequest = !tab.isStreaming;
  if (trackRequest) setCurrentRequest(tab, { key: bashKey, text: info.command, source: 'bash' });
  renderComposerState();
  autoscroll(true);

  // bash never touches the model, so it deliberately skips the serial queue: it runs while
  // another tab is generating. pi records the output in the session and feeds it to the
  // model with the NEXT prompt (unless `!!`).
  const res = await api.cmd(tab.id, 'bash', { command: info.command, excludeFromContext: info.excludeFromContext, id: bashId }, BASH_TIMEOUT_MS);
  if (tab.bashRunning === bashId) tab.bashRunning = null;
  entry.durationMs = Date.now() - entry.startedAt;
  if (res.success) {
    const data = res.data || {};
    // the response carries truncated output while the events streamed everything: keep the longer one
    if (typeof data.output === 'string' && data.output.length > entry.output.length) entry.output = data.output;
    entry.exitCode = data.exitCode === undefined ? null : data.exitCode;
    entry.cancelled = !!data.cancelled;
    entry.truncated = !!data.truncated;
    entry.fullOutputPath = data.fullOutputPath || '';
    entry.status = entry.cancelled ? 'cancelled' : entry.exitCode ? 'error' : 'done';
  } else {
    entry.status = 'error';
    entry.error = res.error || 'bash failed';
  }
  updateBashCard(tab, entry);
  if (trackRequest) finishRequest(tab);
  renderComposerState();
  refreshSessionsSoon();
  return true;
}

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

async function loadCommands(tab) {
  if (!tab || !tab.alive) return;
  const res = await api.cmd(tab.id, 'get_commands');
  if (res.success && res.data && Array.isArray(res.data.commands)) {
    tab.commands = res.data.commands;
    tab.commandsLoaded = true;
  }
}

function slashCatalog(tab) {
  const out = GUI_COMMANDS.map((c) => ({ name: c.name, args: c.args, desc: c.desc, source: 'app' }));
  for (const c of (tab && tab.commands) || []) {
    if (out.some((existing) => existing.name === c.name)) continue;
    out.push({ name: c.name, args: '', desc: c.description || '', source: c.source });
  }
  return out;
}

async function setModelByKey(tab, key) {
  const [provider, ...rest] = String(key).split('/');
  const res = await api.cmd(tab.id, 'set_model', { provider, modelId: rest.join('/') });
  if (!res.success) {
    toast(res.error || 'model switch failed', 'error');
    renderSelectors(tab);
    return;
  }
  tab.model = res.data || tab.model;
  const levels = await api.cmd(tab.id, 'get_available_thinking_levels');
  if (levels.success && levels.data && levels.data.levels) tab.thinkingLevels = levels.data.levels;
  renderSelectors(tab);
  renderStats(tab);
  toast(`model: ${provider}/${rest.join('/')}`);
}

/** Returns true when the GUI consumed the command (input already handled). */
async function runSlashCommand(tab, text) {
  const body = text.slice(1).trim();
  const space = body.search(/\s/);
  const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const arg = space === -1 ? '' : body.slice(space + 1).trim();

  switch (name) {
    case 'compact': {
      if (tab.compacting) {
        const secs = tab.compactStartedAt ? Math.round((Date.now() - tab.compactStartedAt) / 1000) : 0;
        toast(`compaction already running in ${tabLabel(tab)} (${secs}s)`, 'warning');
        return true;
      }
      if (!arg) {
        await compactNow(); // the modal also covers the "session is running" choice
        clearComposer();
        return true;
      }
      if (isWorking(tab)) {
        tab.pendingCompact = arg;
        pushNote(tab, `compaction queued — runs when this session goes idle: ${arg}`, 'compact');
        clearComposer();
        return true;
      }
      clearComposer();
      await runCompact(tab, arg);
      return true;
    }
    case 'export':
      await runExport(tab, arg);
      return true;
    case 'model': {
      const keys = tab.models.map((m) => `${m.provider}/${m.id}`);
      if (!keys.length) {
        toast('no models loaded for this session', 'warning');
        return true;
      }
      if (!arg) {
        const response = await openModal({ kind: 'select', title: 'Model for this session', options: keys });
        if (response.cancelled) return true;
        await setModelByKey(tab, response.value);
        clearComposer();
        return true;
      }
      const needle = arg.toLowerCase();
      const match = keys.find((k) => k.toLowerCase() === needle) || keys.find((k) => k.toLowerCase().includes(needle));
      if (!match) {
        toast(`no model matches "${arg}"`, 'warning');
        return true;
      }
      await setModelByKey(tab, match);
      clearComposer();
      return true;
    }
    case 'thinking': {
      const levels = tab.thinkingLevels || [];
      if (!arg) {
        toast(`thinking: ${tab.thinking} — levels: ${levels.join(', ')}`, 'info', 8000);
        return true;
      }
      const level = levels.find((l) => l.toLowerCase() === arg.toLowerCase());
      if (!level) {
        toast(`unknown thinking level. available: ${levels.join(', ')}`, 'warning');
        return true;
      }
      const res = await api.cmd(tab.id, 'set_thinking_level', { level });
      if (!res.success) {
        toast(res.error || 'thinking level change failed', 'error');
        return true;
      }
      tab.thinking = level;
      renderSelectors(tab);
      clearComposer();
      return true;
    }
    case 'new':
    case 'clear':
      await resetCurrentTab();
      return true;
    case 'rename': {
      let wanted = arg;
      if (!wanted) {
        const response = await openModal({ kind: 'input', title: 'Name this session', prefill: tab.name, placeholder: 'session name' });
        if (response.cancelled) return true;
        wanted = String(response.value || '').trim();
      }
      if (!wanted) return true;
      const res = await api.cmd(tab.id, 'set_session_name', { name: wanted });
      if (!res.success) {
        toast(res.error || 'rename failed', 'error');
        return true;
      }
      tab.name = wanted;
      renderTabs();
      scheduleSave();
      clearComposer();
      return true;
    }
    case 'abort':
    case 'stop':
      if (tab.bashRunning) await abortBash(tab);
      else await abortRun();
      clearComposer();
      return true;
    case 'resume':
      els.search.focus();
      els.search.select();
      clearComposer();
      return true;
    case 'monitor':
      toggleMonitor();
      clearComposer();
      return true;
    case 'stats': {
      const res = await api.cmd(tab.id, 'get_session_stats');
      if (!res.success) {
        toast(res.error || 'get_session_stats failed', 'error');
        return true;
      }
      const d = res.data || {};
      const t = d.tokens || {};
      const ctx = d.contextUsage || {};
      pushNote(
        tab,
        `stats — user ${d.userMessages || 0}, assistant ${d.assistantMessages || 0}, tool calls ${d.toolCalls || 0}\n`
          + `tokens ${tokenLabel(t)} · total (in+out+cache) ${fmtTokens(t.total || 0)}\n`
          + `cost $${Number(d.cost || 0).toFixed(4)} · context ${ctx.percent || 0}% (${fmtTokens(ctx.tokens || 0)} / ${fmtTokens(ctx.contextWindow || 0)})\n`
          + `session: ${d.sessionFile || '(ephemeral)'}`,
      );
      clearComposer();
      return true;
    }
    case 'setup':
      clearComposer();
      await openFirstRunWizard();
      return true;
    case 'tree':
      clearComposer();
      await openSessionTree(activeTab());
      return true;
    case 'jobs':
      clearComposer();
      await openJobsModal();
      return true;
    case 'usage':
      clearComposer();
      await openUsageModal();
      return true;
    case 'retry': {
      const what = arg.toLowerCase();
      if (what === 'stop') {
        await abortRetry(tab);
        return true;
      }
      if (what === 'on' || what === 'off') {
        await setAutoRetry(tab, what === 'on');
        clearComposer();
        return true;
      }
      if (what) {
        toast('retry: expected on, off or stop', 'warning');
        return true;
      }
      const waiting = tab.retrying ? `waiting ${tab.retrying.delayMs}ms before attempt ${tab.retrying.attempt}/${tab.retrying.maxAttempts}` : 'not retrying';
      pushNote(tab, `auto-retry is ${tab.autoRetry === false ? 'off' : 'on'} for this session (a restarted session is always on) \u00b7 ${waiting}\n/retry on | /retry off | /retry stop (cancels a retry that is waiting)`, 'info');
      clearComposer();
      return true;
    }
    case 'settings':
      clearComposer();
      await openSettingsModal();
      return true;
    case 'diagnostics':
      clearComposer();
      await copyDiagnostics();
      return true;
    case 'commands':
    case 'help': {
      const lines = slashCatalog(tab).map((c) => `/${c.name}${c.args ? ` ${c.args}` : ''} — ${c.desc} [${c.source}]`);
      pushNote(tab, `slash commands\n${lines.join('\n')}\n\n!command runs a shell command in this folder (!! keeps it out of the model context)`);
      clearComposer();
      return true;
    }
    default:
      // not a GUI command: pi expands /extension-command, /template and /skill:name, and
      // anything else simply reaches the model as text
      if (tab.commandsLoaded && name && !tab.commands.some((c) => c.name.toLowerCase() === name)) {
        toast(`/${name} is not a GUI command — sending it to pi as written`, 'info', 5000);
      }
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* slash command palette                                               */
/* ------------------------------------------------------------------ */

const slashMenu = { open: false, items: [], index: 0 };

function closeSlashMenu() {
  if (!slashMenu.open) return;
  slashMenu.open = false;
  els.slashMenu.classList.add('hidden');
  els.slashMenu.textContent = '';
  slashMenu.items = [];
}

/** null = not a command word; '' = bare "/" (list everything). */
function slashQuery() {
  const value = els.input.value;
  if (!value.startsWith('/')) return null;
  if (/\s/.test(value)) return null;
  return value.slice(1).toLowerCase();
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

function moveSlashSelection(delta) {
  const rows = [...els.slashMenu.children];
  if (!rows.length) return;
  slashMenu.index = (slashMenu.index + delta + rows.length) % rows.length;
  rows.forEach((row, i) => row.classList.toggle('active', i === slashMenu.index));
  rows[slashMenu.index].scrollIntoView({ block: 'nearest' });
}

function acceptSlashItem(item) {
  els.input.value = `/${item.name}${item.args ? ' ' : ''}`;
  closeSlashMenu();
  els.input.focus();
}

function acceptSlashSelection() {
  const item = slashMenu.items[slashMenu.index];
  if (!item) return false;
  acceptSlashItem(item);
  return true;
}

/*
 * D1: `@path` completion. The composer had a command palette but no way to name a file without
 * dragging it in or typing the whole path from memory. Typing `@` next to whitespace opens the same
 * palette with the folder contents of the session's working folder; the listing is done by the main
 * process and never leaves that folder.
 */
const pathMenu = { open: false, items: [], index: 0, requestId: 0 };

/** The `@token` under the caret: null when the caret is not inside one. */
function atQuery() {
  const caret = els.input.selectionStart == null ? els.input.value.length : els.input.selectionStart;
  const upto = els.input.value.slice(0, caret);
  const match = /(?:^|\s)@([^\s]*)$/.exec(upto);
  if (!match) return null;
  return { fragment: match[1], start: caret - match[1].length - 1, end: caret };
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

function closePathMenu() {
  if (!pathMenu.open) return;
  pathMenu.open = false;
  pathMenu.items = [];
  els.slashMenu.classList.add('hidden');
  els.slashMenu.textContent = '';
}

function movePathSelection(delta) {
  const rows = [...els.slashMenu.children];
  if (!rows.length) return;
  pathMenu.index = (pathMenu.index + delta + rows.length) % rows.length;
  rows.forEach((row, index) => row.classList.toggle('active', index === pathMenu.index));
  rows[pathMenu.index].scrollIntoView({ block: 'nearest' });
}

/** Replace the `@token` with the chosen path; a folder keeps the menu open for the next level. */
function acceptPathItem(entry) {
  const query = atQuery();
  if (!query) return;
  const insert = `@${entry.path}${entry.isDirectory ? '/' : ''}`;
  els.input.value = `${els.input.value.slice(0, query.start)}${insert}${els.input.value.slice(query.end)}`;
  const caret = query.start + insert.length;
  els.input.setSelectionRange(caret, caret);
  closePathMenu();
  els.input.focus();
  if (entry.isDirectory) refreshPathMenu();
}

function acceptPathSelection() {
  const entry = pathMenu.items[pathMenu.index];
  if (!entry) return false;
  acceptPathItem(entry);
  return true;
}

/** Send one prompt straight to the session (bypasses the queue). */
async function deliverPrompt(tab, item) {
  if (tab.compacting) {
    // pi refuses prompts while a compaction is running; keep it queued, do not spam notes
    return { ok: false, deferred: true, error: 'compaction in progress' };
  }
  const payload = { message: item.text };
  if (item.images && item.images.length) payload.images = item.images;
  const res = await api.cmd(tab.id, 'prompt', payload);
  if (!res.success) {
    if (/compaction is in progress/i.test(res.error || '')) {
      // trust pi's own state: compaction_end will release the queue again
      tab.compacting = true;
      if (!tab.compactStartedAt) tab.compactStartedAt = Date.now();
      renderOpenSessions();
      renderComposerState();
      return { ok: false, deferred: true, error: res.error };
    }
    pushNote(tab, `send failed: ${res.error}`, 'error');
    return { ok: false, error: res.error };
  }
  const key = nextKey(tab);
  appendItem(tab, { key, kind: 'message', message: { role: 'user', content: item.text, timestamp: item.at || Date.now() } });
  tab.pendingUserTexts.push(item.text);
  setCurrentRequest(tab, { key, text: item.text, at: item.at, source: 'prompt' });
  autoscroll(true);
  const disposition = res.data && res.data.disposition;
  if (disposition === 'handled') {
    // An extension consumed the prompt; no run will start for it.
    tab.isStreaming = false;
    scheduler.pumpSoon(0);
  }
  return { ok: true, disposition };
}

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

/** The Stop button / Esc: a running bash command takes priority over an agent run. */
async function stopActive() {
  const tab = activeTab();
  if (!tab) return;
  if (tab.bashRunning) await abortBash(tab);
  else await abortRun();
}

async function clearQueue() {
  const tab = activeTab();
  if (!tab) return;
  const res = await api.cmd(tab.id, 'clear_queue');
  if (!res.success) return;
  const parts = [...(res.data.steering || []), ...(res.data.followUp || [])];
  if (parts.length) els.input.value = `${els.input.value}${els.input.value ? '\n' : ''}${parts.join('\n')}`;
}

async function compactNow() {
  const tab = activeTab();
  if (!tab) return;
  if (tab.compacting) {
    const secs = tab.compactStartedAt ? Math.round((Date.now() - tab.compactStartedAt) / 1000) : 0;
    toast(`compaction already running in ${tabLabel(tab)} (${secs}s) — big sessions take minutes`, 'warning');
    return;
  }
  // pi's AgentSession.compact() starts with `await this.abort()`: pressing compact while
  // this session is generating will cancel the in-flight request (Strata logs it as
  // "disconnect"), so ask what the user wants instead of silently killing the answer.
  const busy = isWorking(tab);
  const fields = [];
  if (busy) {
    fields.push({
      key: 'when',
      label: '這個 session 正在跑 — compact 會先中止進行中的請求（Strata 會看到 disconnect）',
      type: 'select',
      options: [
        { value: 'wait', label: '等它跑完再壓縮（建議）' },
        { value: 'now', label: '立刻中止，現在壓縮' },
      ],
      value: 'wait',
    });
  }
  fields.push({ key: 'instructions', label: '摘要指示（可留空）', placeholder: 'focus on code changes…' });
  const response = await openModal({ kind: 'fields', title: 'Compact context', fields, okLabel: 'Compact' });
  if (response.cancelled) return;
  const instructions = String(response.values.instructions || '').trim();
  if (busy && response.values.when === 'wait') {
    tab.pendingCompact = instructions;
    pushNote(tab, 'compaction queued — 這個 session 空下來時會自動壓縮', 'compact');
    return;
  }
  await runCompact(tab, instructions);
}

// pi answers the `compact` RPC only after the WHOLE compaction is done (rpc-mode does
// `await session.compact(...)`), and a 250k-token session needs minutes: the summarizing
// model call plus rewriting a huge session file. A short timeout therefore reports a
// failure that never happened, so keep the RPC patient and let compaction_end decide.
const COMPACT_TIMEOUT_MS = 30 * 60 * 1000;

async function runCompact(tab, instructions) {
  if (!state.tabs.has(tab.id)) return;
  if (tab.compacting) {
    const secs = tab.compactStartedAt ? Math.round((Date.now() - tab.compactStartedAt) / 1000) : 0;
    toast(`compaction already running in ${tabLabel(tab)} (${secs}s)`, 'warning');
    return;
  }
  const startedAt = Date.now(); // local: compaction_end resets tab.compactStartedAt first
  tab.compacting = true; // set before the RPC so the queue defers prompts for this session
  tab.compactStartedAt = startedAt;
  tab.compactEventSeen = false;
  tab.compactEventResult = undefined;
  let stillRunning = false;
  console.log(`[compact] tab=${tab.id} instructions=${instructions ? 'yes' : 'no'}`);
  try {
    const res = await api.cmd(tab.id, 'compact', instructions ? { customInstructions: instructions } : {}, COMPACT_TIMEOUT_MS);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (res.success) {
      console.log(`[compact] tab=${tab.id} ok after ${elapsed}s tokensBefore=${res.data && res.data.tokensBefore}`);
    } else if (res.timeout) {
      // a timeout is NOT proof of failure: ask pi whether the compaction is still running
      const st = await api.cmd(tab.id, 'get_state');
      if (st.success && st.data.isCompacting) {
        pushNote(tab, `compaction still running after ${elapsed}s (big session) — 這不是失敗，完成時會自動顯示結果`, 'warn');
        stillRunning = true;
        console.log(`[compact] tab=${tab.id} rpc timeout after ${elapsed}s but pi reports isCompacting=true`);
      } else {
        pushNote(tab, `compaction failed: ${res.error} (after ${elapsed}s)`, 'error');
        console.log(`[compact] tab=${tab.id} failed: ${res.error} after ${elapsed}s`);
      }
    } else if (tab.compactEventSeen) {
      console.log(`[compact] tab=${tab.id} RPC error already reported by compaction_end: ${res.error}`);
    } else {
      // pi reports compaction failures through compaction_end too, sometimes a few ms after
      // the RPC error response -> wait briefly so the user never sees the same error twice
      const reason = res.error;
      console.log(`[compact] tab=${tab.id} failed: ${reason}`);
      setTimeout(() => {
        if (tab.compactEventSeen) return; // compaction_end already showed it
        pushNote(tab, `compaction failed: ${reason}`, 'error');
      }, 500);
    }
  } finally {
    // while pi is still summarizing, compaction_end owns the flag (not this function)
    if (!stillRunning && !tab.compactEventSeen) {
      tab.compacting = false;
      tab.compactStartedAt = 0;
    }
    refreshStats(tab); // the ctx footer must not stay stale after a compaction
    renderTabs();
    renderOpenSessions();
    renderComposerState();
  }
}

/* ------------------------------------------------------------------ */
/* retry controls (A4) — pi's own retry of transient provider errors   */
/* ------------------------------------------------------------------ */

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
const EXPORT_TIMEOUT_MS = 30 * 60 * 1000;

/** tab.name / the session file name / the session id, sanitised for Windows file names. */
function exportBaseName(tab) {
  let base = tab.name || '';
  if (!base && tab.sessionPath) {
    base = String(tab.sessionPath).split(/[\\/]+/).pop().replace(/\.jsonl$/i, '');
  }
  if (!base) base = tab.sessionId ? `session-${tab.sessionId}` : 'session';
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'session';
}

/**
 * `/export [path]`: pi writes the HTML file itself and returns the path it used, the GUI
 * only picks the path. An argument must be an absolute `*.html`, otherwise the native Save
 * dialog is shown (cancelling it is silent). Like `!` bash, export is model-free, so it
 * deliberately skips the serial queue.
 */
async function runExport(tab, arg) {
  if (tab.exporting) {
    const secs = tab.exportStartedAt ? Math.round((Date.now() - tab.exportStartedAt) / 1000) : 0;
    toast(`export already running in ${tabLabel(tab)} (${secs}s) — big sessions take minutes`, 'warning');
    return;
  }
  // pi has no session file to export: unsaved (no message yet) or ephemeral (--no-session)
  if (tab.ephemeral || !tab.sessionPath) {
    toast('this session has no session file yet (unsaved or ephemeral) — send a message first, or open a saved session', 'warning', 8000);
    return;
  }
  // pi appends to the session file while it runs or compacts: exporting mid-write is racy
  if (tab.compacting || isWorking(tab)) {
    toast('cannot export while this session is running or compacting — try again when it is idle', 'warning');
    return;
  }
  let outputPath = '';
  if (arg) {
    if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(arg) && /\.html$/i.test(arg)) outputPath = arg;
    else toast('export path must be absolute and end with .html — opening the Save dialog instead', 'warning', 8000);
  }
  if (!outputPath) {
    const sep = tab.cwd.includes('\\') ? '\\' : '/';
    const defaultPath = `${String(tab.cwd).replace(/[\\/]+$/, '')}${sep}${exportBaseName(tab)}.html`;
    const dialogRes = await api.saveFile({ defaultPath, title: 'Export session as HTML' });
    if (!dialogRes.ok) {
      // cancelling the dialog is the normal silent case
      if (!dialogRes.cancelled) toast(dialogRes.error || 'save dialog failed', 'error');
      return;
    }
    outputPath = dialogRes.path;
  }
  tab.exporting = true;
  tab.exportStartedAt = Date.now();
  tab.lastExport = null;
  clearComposer();
  console.log(`[export] tab=${tab.id} path=${outputPath}`);
  try {
    const res = await api.cmd(tab.id, 'export_html', { outputPath }, EXPORT_TIMEOUT_MS);
    const elapsed = Math.round((Date.now() - tab.exportStartedAt) / 1000);
    if (res.success && res.data && res.data.path) {
      tab.lastExport = { ok: true, path: res.data.path };
      pushNote(tab, `exported this session to ${res.data.path} (${elapsed}s)`, 'compact');
      toast(`exported: ${res.data.path}`, 'info', 8000);
      api.openPath(res.data.path, true); // reveal the file in the file manager
      console.log(`[export] tab=${tab.id} ok after ${elapsed}s path=${res.data.path}`);
    } else {
      // pi's own error text only (unwritable path, RPC error): never a stack trace
      tab.lastExport = { ok: false, error: res.error || 'export_html failed' };
      toast(res.error || 'export failed', 'error', 8000);
      console.log(`[export] tab=${tab.id} failed: ${res.error}`);
    }
  } catch (err) {
    tab.lastExport = { ok: false, error: err.message };
    toast(err.message || 'export failed', 'error', 8000);
  } finally {
    tab.exporting = false;
    tab.exportStartedAt = 0;
  }
}

/* ------------------------------------------------------------------ */
/* diagnostics report (A6) — pairs with docs/TROUBLESHOOTING.md        */
/* ------------------------------------------------------------------ */

let diagnosticsBusy = false;

/**
 * The part only the renderer knows: which tabs are open, what the queue is doing, and the
 * Strata address + key the active tab's model uses. lib/diagnostics.js redacts the key before
 * the text is built, it is passed only so /health and /v1/models can be fetched at all.
 */
function diagnosticsSnapshot() {
  const active = activeTab();
  const rows = state.order
    .map((id) => state.tabs.get(id))
    .filter(Boolean)
    .map((tab) => ({
      label: tabLabel(tab),
      state: tab.isStreaming ? 'streaming' : tab.compacting ? 'compacting' : tab.outbox.length ? 'queued' : tab.alive ? 'idle' : 'dead',
      cwd: tab.cwd || '',
      sessionPath: tab.sessionPath || '',
      outbox: tab.outbox.length,
      model: tab.model ? `${tab.model.provider ? `${tab.model.provider}/` : ''}${tab.model.id || ''}` : '',
    }));
  const model = active && active.model ? active.model : null;
  return {
    rows,
    serial: scheduler.enabled,
    active: active ? tabLabel(active) : '(none)',
    baseUrl: strataBaseUrl(),
    apiKey: (model && model.apiKey) || '',
  };
}

/**
 * Build the report in main, put it on the clipboard, and say where it was saved. The report is
 * always written to userData/diagnostics/ as well, so a blocked clipboard never loses it.
 */
async function copyDiagnostics() {
  if (diagnosticsBusy) return;
  diagnosticsBusy = true;
  els.btnDiag.disabled = true;
  els.btnDiag.textContent = tr('Building\u2026');
  try {
    const res = await api.diagnostics(diagnosticsSnapshot());
    if (!res || !res.ok) {
      toast((res && res.error) || 'could not build the diagnostics report', 'error');
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(res.text);
      copied = true;
    } catch {
      copied = false; // clipboard permission denied (window not focused): the file is still there
    }
    if (copied) toast(res.path ? `diagnostics copied to the clipboard \u00b7 also saved to ${res.path}` : 'diagnostics copied to the clipboard', 'info', 9000);
    else toast(`clipboard blocked \u00b7 report saved to ${res.path}`, 'warning', 12000);
    console.log(`[diagnostics] copied=${copied} saved=${res.path || '(not saved)'} lines=${String(res.text || '').split('\n').length}`);
  } catch (err) {
    toast(`diagnostics failed: ${err.message}`, 'error', 9000);
  } finally {
    diagnosticsBusy = false;
    els.btnDiag.disabled = false;
    els.btnDiag.textContent = tr('Diagnostics');
  }
}

/* ------------------------------------------------------------------ */
/* scheduled prompts (B5) - the renderer half                          */
/* ------------------------------------------------------------------ */

/**
 * A due job arrives as an event from the main-process scheduler. The prompt is pushed into the
 * target tab's outbox, which keeps the serial queue as the only thing that ever sends a prompt -
 * that is why the scheduler does not own a pi process of its own.
 */
async function resolveJobTarget(job) {
  const target = String(job.target || 'new-tab');
  if (target.startsWith('tab:')) {
    const tab = state.tabs.get(target.slice(4));
    if (!tab) {
      toast(`scheduled job "${job.name}": that tab is closed - edit the job to point at a session file`, 'warning', 9000);
      return null;
    }
    return tab;
  }
  if (target.startsWith('session:')) {
    const sessionPath = target.slice(8);
    const existing = [...state.tabs.values()].find((tab) => samePath(tab.sessionPath, sessionPath));
    if (existing) return existing;
    const read = await api.sessionsRead(sessionPath);
    if (!read.ok) {
      toast(`scheduled job "${job.name}": cannot open ${sessionPath} (${read.error})`, 'error', 9000);
      return null;
    }
    return createTab({ cwd: read.meta.cwd || job.cwd || state.cwd, sessionPath, name: read.meta.name });
  }
  // new-tab: a fresh session every run. Ephemeral by default so they do not pile up session files.
  return createTab({ cwd: job.cwd || state.cwd, ephemeral: job.ephemeral !== false });
}

async function handleCronFire({ job, firedAt, manual, key }) {
  const name = job.name || job.schedule || 'job';
  // #9: main.js writes lastRun only after this ack. Acking here means the prompt is genuinely in a
  // tab's outbox - if the window reloaded before the event arrived, we never get here and the run is
  // reported as undelivered instead of silently marked as done.
  const ack = () => {
    if (key) api.cronAck(key);
  };
  try {
    const tab = await resolveJobTarget(job);
    if (!tab) return;
    if (!tab.alive && !(await respawnTab(tab))) {
      toast(`scheduled job "${name}": the session process could not be started`, 'error', 9000);
      return;
    }
    tab.outbox.push({ text: job.prompt, at: Date.now(), images: [], source: `job:${name}` });
    scheduleSave(); // a cron prompt sitting in the outbox is recoverable like any other (B4)
    renderOpenSessions();
    renderTabs();
    pushNote(tab, `scheduled job "${name}" (${job.schedule}) queued${manual ? ' now (manual run)' : ''}: ${oneLine(job.prompt, 200)}`, 'info');
    scheduler.pumpSoon(0);
    toast(`scheduled job "${name}" queued in ${tabLabel(tab)}`, 'info', 6000);
    console.log(`[cron] fired job=${job.id} name=${JSON.stringify(name)} target_tab=${tab.id} outbox=${tab.outbox.length} manual=${!!manual} firedAt=${firedAt} acked=${!!key}`);
    ack();
  } catch (err) {
    console.error(`[cron] firing "${name}" failed: ${err.stack || err}`);
    toast(`scheduled job "${name}" failed: ${err.message}`, 'error', 9000);
  }
}

/** The job list (Settings dialog ▸ Scheduled jobs, or /jobs). */
async function openJobsModal() {
  const listed = await api.cronList();
  if (!listed || !listed.ok) {
    toast((listed && listed.error) || 'cron:list failed', 'error');
    return;
  }
  let jobs = listed.jobs.map((job) => ({ ...job }));

  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop jobs-backdrop');
    const modal = el('div', 'modal jobs-modal');
    modal.appendChild(el('h3', '', 'Scheduled prompts'));
    modal.appendChild(
      el(
        'div',
        'set-hint',
        'A job sends its prompt to a session at the given time. Pick "when" from the dropdown - you do not need to know cron. The prompt goes through the serial queue like any typed message, so it never collides with a running session - and it runs with full read/edit/bash rights in the folder it targets.',
      ),
    );
    const list = el('div', 'job-list');
    modal.appendChild(list);

    const paint = () => {
      list.textContent = '';
      if (!jobs.length) {
        list.appendChild(el('div', 'modal-msg', 'No jobs yet. Add one to run a prompt every morning, before standup, …'));
        return;
      }
      jobs.forEach((job, index) => {
        const row = el('div', `job-row${job.enabled === false ? ' off' : ''}`);
        const head = el('div', 'job-head');
        const toggle = el('input');
        toggle.type = 'checkbox';
        toggle.checked = job.enabled !== false;
        toggle.title = 'enable / disable this job';
        toggle.addEventListener('change', async () => {
          job.enabled = toggle.checked;
          const saved = await api.cronSave(jobs);
          if (!saved.ok) {
            toast(saved.error, 'error');
            return;
          }
          jobs = saved.jobs.map((entry) => ({ ...entry }));
          paint();
          toast(`job "${job.name}" ${job.enabled ? 'enabled' : 'disabled'}`);
        });
        head.appendChild(toggle);
        head.appendChild(el('span', 'job-name', job.name));
        head.appendChild(el('span', 'job-schedule', job.schedule));
        row.appendChild(head);
        if (job.description) row.appendChild(el('div', 'job-when', `${job.description}${job.nextRun ? ` \u00b7 next ${new Date(job.nextRun).toLocaleString()}` : ''}`));
        row.appendChild(el('div', 'job-prompt', job.prompt.length > 220 ? `${job.prompt.slice(0, 220)}\u2026` : job.prompt));
        const meta = el('div', 'job-meta');
        meta.appendChild(el('span', '', `target: ${job.target || 'new-tab'}`));
        if (!job.description) meta.appendChild(el('span', '', `next: ${job.nextRun ? new Date(job.nextRun).toLocaleString() : 'never'}`));
        if (job.lastRun) meta.appendChild(el('span', '', `last: ${new Date(job.lastRun).toLocaleString()}`));
        if (job.cwd) meta.appendChild(el('span', '', `cwd: ${job.cwd}`));
        row.appendChild(meta);

        const actions = el('div', 'outbox-controls');
        const edit = el('button', 'ghost', 'edit');
        edit.addEventListener('click', async () => {
          const result = await openJobEditor(job);
          if (result.cancelled) return;
          jobs[index] = { ...job, ...result.job };
          const saved = await api.cronSave(jobs);
          if (!saved.ok) {
            toast(saved.error, 'error', 9000);
            return;
          }
          jobs = saved.jobs.map((entry) => ({ ...entry }));
          paint();
        });
        const run = el('button', 'ghost', 'run now');
        run.title = 'queue this prompt right now (tests the target and the prompt)';
        run.addEventListener('click', () => api.cronRunNow(job.id));
        const del = el('button', 'ghost', 'del');
        del.addEventListener('click', async () => {
          jobs.splice(index, 1);
          const saved = await api.cronSave(jobs);
          if (!saved.ok) {
            toast(saved.error, 'error');
            return;
          }
          jobs = saved.jobs.map((entry) => ({ ...entry }));
          paint();
        });
        actions.appendChild(edit);
        actions.appendChild(run);
        actions.appendChild(del);
        row.appendChild(actions);
        list.appendChild(row);
      });
    };
    paint();

    const actions = el('div', 'modal-actions');
    const add = el('button', 'primary', 'Add job');
    add.addEventListener('click', async () => {
      const result = await openJobEditor(null);
      if (result.cancelled) return;
      jobs.push(result.job);
      const saved = await api.cronSave(jobs);
      if (!saved.ok) {
        toast(saved.error, 'error', 9000);
        return;
      }
      jobs = saved.jobs.map((entry) => ({ ...entry }));
      paint();
    });
    const close = el('button', 'ghost', 'Close');
    actions.appendChild(add);
    actions.appendChild(close);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
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

/* ------------------------------------------------------------------ */
/* schedule builder                                                    */
/*                                                                     */
/* Cron syntax is the part people get wrong, so the editor asks "when  */
/* should it run?" in plain words and builds the 5-field expression    */
/* itself. The raw expression is only editable under "custom cron",    */
/* and is otherwise echoed read-only so the user can still learn it.   */
/* ------------------------------------------------------------------ */

const SCHEDULE_PRESETS = [
  { value: 'weekdays', label: 'every weekday (Mon-Fri)' },
  { value: 'daily', label: 'every day' },
  { value: 'weekly', label: 'on chosen weekdays' },
  { value: 'monthly', label: 'on one day each month' },
  { value: 'hours', label: 'every N hours' },
  { value: 'minutes', label: 'every N minutes' },
  { value: 'custom', label: 'custom cron (advanced)' },
];

const DOW_CHOICES = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

/** Add / edit one job. The schedule is built from plain words; the preview says what it means. */
async function openJobEditor(existing) {
  const job = existing ? { ...existing } : { name: '', schedule: '30 9 * * 1-5', prompt: '', target: 'new-tab', cwd: state.cwd, ephemeral: true, enabled: true };
  // ask the main process which preset this expression came from (lib/cron.js owns that reading,
  // so the builder and the parser can never disagree about what "30 9 * * 1-5" means)
  const probed = await api.cronPreview(job.schedule || '');
  const initial = probed && probed.valid && probed.preset ? probed.preset : { preset: 'custom' };
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const modal = el('div', 'modal jobs-editor');
    modal.appendChild(el('h3', '', existing ? `Edit job: ${job.name}` : 'New scheduled prompt'));

    const field = (label, control, hint) => {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', '', label));
      wrap.appendChild(control);
      if (hint) wrap.appendChild(el('div', 'set-hint', hint));
      modal.appendChild(wrap);
      return wrap;
    };
    const input = (value, placeholder) => {
      const box = el('input');
      box.type = 'text';
      box.value = value == null ? '' : String(value);
      box.placeholder = placeholder || '';
      return box;
    };
    const numberBox = (value, min, max) => {
      const box = el('input');
      box.type = 'number';
      box.min = String(min);
      box.max = String(max);
      box.step = '1';
      box.value = String(value);
      box.className = 'job-num';
      return box;
    };
    const clampNum = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.round(n)));
    };

    const nameBox = input(job.name, 'morning standup prep');
    field('Name', nameBox, 'optional - only what you see in the job list');

    /* --- when should it run? ------------------------------------------------ */
    const presetSel = document.createElement('select');
    presetSel.className = 'job-preset';
    presetSel.setAttribute('aria-label', 'run when');
    for (const preset of SCHEDULE_PRESETS) presetSel.appendChild(new Option(preset.label, preset.value));
    presetSel.value = initial.preset;

    const timeBox = el('input');
    timeBox.type = 'time';
    timeBox.step = '60';
    timeBox.value = initial.time || '09:30';
    timeBox.setAttribute('aria-label', 'at what time');
    const dayOfMonthBox = numberBox(initial.dayOfMonth || 1, 1, 31);
    dayOfMonthBox.setAttribute('aria-label', 'day of month');
    const stepHoursBox = numberBox(initial.preset === 'hours' ? initial.step : 3, 1, 23);
    stepHoursBox.setAttribute('aria-label', 'every how many hours');
    const stepMinutesBox = numberBox(initial.preset === 'minutes' ? initial.step : 30, 1, 59);
    stepMinutesBox.setAttribute('aria-label', 'every how many minutes');
    const minuteOfHourBox = numberBox(initial.minute != null ? initial.minute : 0, 0, 59);
    minuteOfHourBox.setAttribute('aria-label', 'at which minute of the hour');
    const cronBox = input(job.schedule, '30 9 * * 1-5');
    cronBox.className = 'job-cron';
    cronBox.dataset.setting = 'schedule';
    cronBox.setAttribute('aria-label', 'cron expression: minute hour day-of-month month day-of-week');

    const part = (text, control, unit) => {
      const wrap = el('span', 'job-part');
      wrap.appendChild(el('span', 'job-part-label', text));
      wrap.appendChild(control);
      if (unit) wrap.appendChild(el('span', 'job-part-label', unit));
      return wrap;
    };
    const timeWrap = part('at', timeBox);
    const dayWrap = part('on day', dayOfMonthBox, 'of the month');
    const hoursWrap = part('every', stepHoursBox, 'hours');
    hoursWrap.appendChild(el('span', 'job-part-label', 'at minute'));
    hoursWrap.appendChild(minuteOfHourBox);
    const minutesWrap = part('every', stepMinutesBox, 'minutes');

    const builderRow = el('div', 'field-row job-builder');
    builderRow.appendChild(presetSel);
    builderRow.appendChild(timeWrap);
    builderRow.appendChild(dayWrap);
    builderRow.appendChild(hoursWrap);
    builderRow.appendChild(minutesWrap);

    const chipsWrap = el('div', 'job-day-chips');
    const dayChecks = DOW_CHOICES.map((choice) => {
      const box = el('input');
      box.type = 'checkbox';
      box.checked = initial.days ? initial.days.includes(choice.value) : choice.value >= 1 && choice.value <= 5;
      const chip = el('label', 'job-chip');
      chip.appendChild(box);
      chip.appendChild(el('span', '', choice.label));
      box.setAttribute('aria-label', `run on ${choice.label}`);
      chipsWrap.appendChild(chip);
      box.addEventListener('change', () => syncSchedule());
      return { box, value: choice.value };
    });

    const cronWrap = el('div', 'field-row');
    cronWrap.appendChild(cronBox);
    const cronLine = el('div', 'job-cron-line', '');
    const preview = el('div', 'set-hint', '');
    const scheduleWrap = field('Run', builderRow, 'pick when it should fire - the cron expression is written for you');
    scheduleWrap.appendChild(chipsWrap);
    scheduleWrap.appendChild(cronWrap);
    scheduleWrap.appendChild(cronLine);
    scheduleWrap.appendChild(preview);
    scheduleWrap.appendChild(
      el('div', 'set-hint', 'cron fields are minute hour day-of-month month day-of-week (local time); \u00b7 30 9 * * 1-5 = weekdays 09:30, \u00b7 0 */2 * * * = every 2 hours, \u00b7 0 9 1 * * = the 1st at 09:00'),
    );

    const promptBox = el('textarea');
    promptBox.value = job.prompt || '';
    promptBox.placeholder = 'the prompt to send, e.g. Summarise what changed in this folder since yesterday';
    field('Prompt', promptBox, 'runs with the same rights as a typed message: pi can read, edit and run commands in the target folder');

    const currentSchedule = () => {
      const preset = presetSel.value;
      if (preset === 'custom') return cronBox.value.trim();
      const clock = /^(\d{1,2}):(\d{2})$/.exec(String(timeBox.value || '').trim());
      const hour = clampNum(clock && clock[1], 0, 23, 9);
      const minute = clampNum(clock && clock[2], 0, 59, 30);
      if (preset === 'minutes') return `*/${clampNum(stepMinutesBox.value, 1, 59, 30)} * * * *`;
      if (preset === 'hours') return `${clampNum(minuteOfHourBox.value, 0, 59, 0)} */${clampNum(stepHoursBox.value, 1, 23, 3)} * * *`;
      if (preset === 'monthly') return `${minute} ${hour} ${clampNum(dayOfMonthBox.value, 1, 31, 1)} * *`;
      if (preset === 'weekly') {
        const days = dayChecks.filter((entry) => entry.box.checked).map((entry) => entry.value).sort((a, b) => a - b);
        return days.length ? `${minute} ${hour} * * ${days.join(',')}` : '';
      }
      if (preset === 'daily') return `${minute} ${hour} * * *`;
      return `${minute} ${hour} * * 1-5`;
    };

    let previewToken = 0;
    const refreshPreview = async () => {
      const expression = currentSchedule();
      const token = ++previewToken;
      if (!expression) {
        preview.className = 'set-hint bad';
        preview.textContent = 'tick at least one weekday';
        return;
      }
      preview.textContent = 'checking\u2026';
      const res = await api.cronPreview(expression);
      if (token !== previewToken) return; // a slower answer must not overwrite a newer one
      if (!res.valid) {
        preview.className = 'set-hint bad';
        preview.textContent = `not a valid schedule: ${res.error}`;
        return;
      }
      preview.className = 'set-hint good';
      preview.textContent = `${res.description} \u00b7 next: ${res.nextRun ? new Date(res.nextRun).toLocaleString() : 'never (this expression can never fire)'}`;
    };

    const syncSchedule = () => {
      const preset = presetSel.value;
      const usesTime = ['weekdays', 'daily', 'weekly', 'monthly'].includes(preset);
      timeWrap.style.display = usesTime ? '' : 'none';
      dayWrap.style.display = preset === 'monthly' ? '' : 'none';
      hoursWrap.style.display = preset === 'hours' ? '' : 'none';
      minutesWrap.style.display = preset === 'minutes' ? '' : 'none';
      chipsWrap.style.display = preset === 'weekly' ? '' : 'none';
      cronWrap.style.display = preset === 'custom' ? '' : 'none';
      cronLine.style.display = preset === 'custom' ? 'none' : '';
      if (preset !== 'custom') cronBox.value = currentSchedule(); // so switching to "custom" keeps it
      cronLine.textContent = `cron: ${cronBox.value}`;
      refreshPreview();
    };
    presetSel.addEventListener('change', () => syncSchedule());
    [timeBox, dayOfMonthBox, stepHoursBox, stepMinutesBox, minuteOfHourBox].forEach((box) => box.addEventListener('input', () => syncSchedule()));
    cronBox.addEventListener('input', () => refreshPreview());

    /* --- where does the prompt go? ------------------------------------------ */
    const targetSel = document.createElement('select');
    targetSel.className = 'job-target-kind';
    targetSel.setAttribute('aria-label', 'send the prompt to');
    for (const option of [
      { value: 'new-tab', label: 'a new tab (fresh session each run)' },
      { value: 'session:', label: 'a saved session (keeps talking in it)' },
      { value: 'tab:', label: 'an open tab' },
    ]) {
      targetSel.appendChild(new Option(option.label, option.value));
    }
    const chosen = String(job.target || 'new-tab');
    targetSel.value = chosen === 'new-tab' ? 'new-tab' : chosen.split(':')[0] + ':';
    const valueBox = input(chosen.startsWith('new-tab') ? '' : chosen.split(':').slice(1).join(':'), 'filled in by the picker next to it');
    valueBox.setAttribute('aria-label', 'session path or tab id');
    const picker = document.createElement('select');
    picker.className = 'job-picker';
    picker.setAttribute('aria-label', 'pick an open tab or a recent session');
    const folderName = (path) => String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(path || '');
    const fillPicker = () => {
      picker.textContent = '';
      if (targetSel.value === 'tab:') {
        picker.appendChild(new Option('pick an open tab\u2026', ''));
        for (const id of state.order) {
          const tab = state.tabs.get(id);
          if (!tab) continue;
          picker.appendChild(new Option(`${tabLabel(tab)}  (${folderName(tab.cwd)})`, id));
        }
      } else if (targetSel.value === 'session:') {
        picker.appendChild(new Option('pick a recent session\u2026', ''));
        for (const meta of state.sessions.slice(0, 60)) {
          picker.appendChild(new Option(`${meta.title || meta.fileName}  (${meta.messageCount} msgs, ${folderName(meta.cwd)})`, meta.path));
        }
      }
      picker.value = '';
    };
    picker.addEventListener('change', () => {
      if (picker.value) valueBox.value = picker.value;
    });
    const targetRow = el('div', 'field-row');
    targetRow.appendChild(targetSel);
    targetRow.appendChild(picker);
    const targetValueWrap = el('div', 'field');
    targetValueWrap.appendChild(valueBox);
    const targetWrap = field('Send the prompt to', targetRow, 'a new tab starts a fresh conversation; a session file is reused, so the conversation keeps growing');
    targetWrap.appendChild(targetValueWrap);
    const targetHint = el('div', 'set-hint', '');
    targetWrap.appendChild(targetHint);
    const paintTargetHint = () => {
      if (targetSel.value === 'session:') {
        targetHint.textContent = 'session path (the picker fills it in): session:<path> - the job opens the file if no tab has it';
      } else if (targetSel.value === 'tab:') {
        targetHint.textContent = 'tab id (the picker fills it in): tab:<id> - an open tab only exists while the app runs, so this job stops working after a restart';
      } else {
        targetHint.textContent = 'nothing else to fill in: each run opens a new tab in the folder picked below';
      }
    };
    targetSel.addEventListener('change', () => {
      fillPicker();
      paintTargetHint();
      valueBox.style.display = targetSel.value === 'new-tab' ? 'none' : '';
      picker.style.display = targetSel.value === 'new-tab' ? 'none' : '';
    });
    fillPicker();
    paintTargetHint();
    valueBox.style.display = targetSel.value === 'new-tab' ? 'none' : '';
    picker.style.display = targetSel.value === 'new-tab' ? 'none' : '';

    const cwdRow = el('div', 'field-row');
    const cwdBox = input(job.cwd || state.cwd);
    const browse = el('button', '', 'Browse\u2026');
    browse.addEventListener('click', async () => {
      const picked = await api.chooseFolder();
      if (picked.ok) cwdBox.value = picked.path;
    });
    cwdRow.appendChild(cwdBox);
    cwdRow.appendChild(browse);
    field('Working folder (new-tab jobs)', cwdRow, 'ignored when the target is a session file (that session already records its folder)');

    const ephemeralWrap = el('div', 'field');
    const ephemeralRow = el('div', 'field-row set-check');
    const ephemeralBox = el('input');
    ephemeralBox.type = 'checkbox';
    ephemeralBox.checked = job.ephemeral !== false;
    ephemeralRow.appendChild(ephemeralBox);
    ephemeralRow.appendChild(el('label', '', 'ephemeral new-tab jobs (write no session file)'));
    ephemeralWrap.appendChild(ephemeralRow);
    modal.appendChild(ephemeralWrap);

    syncSchedule();

    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'ghost', 'Cancel');
    const ok = el('button', 'primary', 'Save job');
    actions.appendChild(cancel);
    actions.appendChild(ok);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      backdrop.remove();
      modalOpen = null;
      resolve(result);
    };
    modalOpen = { finish, backdrop };
    const submit = () => {
      const schedule = currentSchedule();
      if (!schedule) {
        toast('pick at least one weekday', 'warning');
        return;
      }
      const target = targetSel.value === 'new-tab' ? 'new-tab' : `${targetSel.value}${valueBox.value.trim()}`;
      if (target !== 'new-tab' && !valueBox.value.trim()) {
        toast('the target needs a session path or a tab id (use the picker)', 'warning');
        return;
      }
      finish({
        cancelled: false,
        job: {
          id: job.id || `job-${Date.now().toString(36)}`,
          name: nameBox.value.trim() || schedule,
          schedule,
          prompt: promptBox.value,
          target,
          cwd: cwdBox.value.trim(),
          ephemeral: ephemeralBox.checked,
          enabled: job.enabled !== false,
          createdAt: job.createdAt || new Date().toISOString(),
          lastRun: job.lastRun || null,
          nextRun: job.nextRun || null,
        },
      });
    };
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => finish({ cancelled: true }));
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish({ cancelled: true });
    });
    setTimeout(() => nameBox.focus(), 30);
  });
}

/* ------------------------------------------------------------------ */
/* attachments / drag & drop                                           */
/* ------------------------------------------------------------------ */

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function addFiles(files) {
  const tab = activeTab();
  if (!tab) {
    await createTab({ cwd: state.cwd });
  }
  const target = activeTab();
  const list = Array.from(files || []);
  if (!list.length) return;

  const pathList = [];
  for (const file of list) {
    const filePath = api.pathForFile(file);
    if (filePath) pathList.push(filePath);
  }
  const stats = pathList.length ? await api.statPaths(pathList) : [];
  const statByPath = new Map(stats.map((s) => [s.path, s]));

  let images = 0;
  let paths = 0;
  let inlined = 0;
  for (const file of list) {
    const filePath = api.pathForFile(file);
    const stat = filePath ? statByPath.get(filePath) : null;
    const isImage = IMAGE_TYPES.has(file.type) && (!stat || !stat.isDirectory);
    if (isImage && file.size <= MAX_IMAGE_BYTES) {
      try {
        const dataUrl = await readFileAsDataURL(file);
        const comma = dataUrl.indexOf(',');
        target.images.push({
          name: file.name,
          mimeType: file.type || 'image/png',
          data: dataUrl.slice(comma + 1),
          previewUrl: dataUrl,
          path: filePath,
        });
        images++;
        continue;
      } catch {
        // A clipboard image has no path to fall back on, so say so instead of inlining bytes.
        if (!filePath) {
          toast(`could not read image ${file.name}`, 'warning');
          continue;
        }
      }
    }
    if (filePath) {
      target.attachments.push({
        path: filePath,
        name: file.name || filePath.split(/[\\/]/).pop(),
        isDirectory: !!(stat && stat.isDirectory),
        size: file.size,
      });
      paths++;
      continue;
    }
    // No absolute path available (a clipboard paste, or a synthetic File): decide from
    // type/size alone. Inlining an image would only produce garbage, so reject it clearly.
    if (isImage) {
      toast(`image too large: ${file.name} is ${fmtBytes(file.size)} (${file.size} bytes, max ${fmtBytes(MAX_IMAGE_BYTES)})`, 'warning');
      continue;
    }
    if (String(file.type || '').startsWith('image/')) {
      toast(`unsupported image type: ${file.name} (${file.type}) — use png/jpg/gif/webp`, 'warning');
      continue;
    }
    try {
      const text = await file.text();
      target.inlines.push({ name: file.name, text: truncate(text, 60000) });
      inlined++;
    } catch {
      toast(`could not read ${file.name}`, 'warning');
    }
  }
  renderAttachments();
  toast(`attached: ${paths} file(s), ${images} image(s), ${inlined} inline`, 'info', 3000);
  els.input.focus();
}

function hasFiles(event) {
  const types = event.dataTransfer && event.dataTransfer.types;
  return !!types && Array.from(types).includes('Files');
}

function setDropOverlay(show) {
  els.dropOverlay.classList.toggle('hidden', !show);
}

function wireDragAndDrop() {
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    state.dragDepth++;
    setDropOverlay(true);
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) setDropOverlay(false);
  });
  window.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth = 0;
    setDropOverlay(false);
    await addFiles(event.dataTransfer.files);
  });
}

/* ------------------------------------------------------------------ */
/* paste (Ctrl+V / right-click)                                        */
/* ------------------------------------------------------------------ */

/* Clipboard images carry no filesystem path (api.pathForFile() returns ''), and
   Chromium names them "image.png" for every screenshot, so pastes get a name of
   their own: pasted-1.png, pasted-2.png, … (never clashing with an existing chip). */
let pasteSeq = 0;
const GENERIC_PASTE_NAME = /^(image\d*|blob|clipboard|screenshot|screen[ -]?shot|未命名|untitled)(\.(png|jpe?g|gif|webp|bmp|tiff))?$/i;

function pasteName(tab, file) {
  const given = String(file.name || '').trim();
  if (given && !GENERIC_PASTE_NAME.test(given)) return given;
  const ext = IMAGE_EXT[file.type] || String(given).split('.').pop() || 'png';
  const taken = new Set([
    ...(tab ? tab.images.map((i) => i.name) : []),
    ...(tab ? tab.attachments.map((a) => a.name) : []),
    ...(tab ? tab.inlines.map((i) => i.name) : []),
  ]);
  let name;
  do {
    pasteSeq += 1;
    name = `pasted-${pasteSeq}.${ext}`;
  } while (taken.has(name));
  return name;
}

/** Files carried by a paste event: `files` first, `items` as a fallback for the
 *  (rare) case where only items is populated. */
function pastedFiles(clipboardData) {
  const out = [];
  for (const file of Array.from(clipboardData.files || [])) {
    if (file) out.push(file);
  }
  if (!out.length) {
    for (const item of Array.from(clipboardData.items || [])) {
      if (!item || item.kind !== 'file') continue;
      const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
      if (file) out.push(file);
    }
  }
  return out;
}

async function handlePaste(event) {
  // Never hijack a paste while a dialog (including the extension UI modals) or the
  // slash palette owns the keyboard.
  if (modalOpen || slashMenu.open || pathMenu.open) return;
  const data = event.clipboardData;
  if (!data) return;
  const files = pastedFiles(data);
  if (!files.length) return; // plain text (or nothing): leave the default paste alone
  event.preventDefault();
  const tab = activeTab();
  const named = files.map((file) => {
    const name = pasteName(tab, file);
    if (name === file.name) return file;
    try {
      return new File([file], name, { type: file.type, lastModified: file.lastModified });
    } catch {
      return file;
    }
  });
  await addFiles(named);
}

function wirePaste() {
  document.addEventListener('paste', (event) => {
    handlePaste(event).catch((err) => toast(`paste failed: ${err.message}`, 'warning'));
  });
}

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    const openTabs = [...state.tabs.values()]
      .filter((tab) => tab.sessionPath && !tab.ephemeral)
      .map((tab) => ({ id: tab.id, cwd: tab.cwd, sessionPath: tab.sessionPath, name: tab.name, ...persistedOutbox(tab) }));
    api.settingsSet({ cwd: state.cwd, openTabs, serialQueue: scheduler.enabled });
  }, 800);
}

// A queued image is base64 in the settings file; a screenshot is ~1 MB, which would make the file
// huge. Text is always kept, images only while the whole outbox stays small.
const OUTBOX_IMAGE_BUDGET = 400000;

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

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

function wireUi() {
  $('btnNew').addEventListener('click', promptNewSession);
  $('btnNewSide').addEventListener('click', promptNewSession);
  $('btnRefresh').addEventListener('click', refreshSessions);
  $('btnSend').addEventListener('click', send);
  $('btnAbort').addEventListener('click', stopActive);
  $('btnCompact').addEventListener('click', compactNow);

  els.btnRestart.addEventListener('click', async () => {
    const tab = activeTab();
    if (!tab) return;
    if (tab.alive) {
      toast('this tab is already running', 'info', 3000);
      return;
    }
    await respawnTab(tab);
    renderTabs();
    renderComposerState();
  });
  els.btnStopRetry.addEventListener('click', async () => {
    const tab = activeTab();
    if (tab) await abortRetry(tab);
  });
  $('btnClearQueue').addEventListener('click', clearQueue);
  $('btnAttach').addEventListener('click', () => els.fileInput.click());
  els.btnMonitor.addEventListener('click', toggleMonitor);
  els.btnDiag.addEventListener('click', copyDiagnostics);
  els.btnSettings.addEventListener('click', openSettingsModal);

  // Help \u25b8 Copy Diagnostics runs in main (works even if this window is wedged); it already put
  // the text on the clipboard, the renderer only reports where the copy came from.
  api.on('diagnostics', (report) => {
    if (!report || !report.ok) {
      toast((report && report.error) || 'could not build the diagnostics report', 'error');
      return;
    }
    toast(`diagnostics copied from the menu \u00b7 also saved to ${report.path || '(not saved)'}`, 'info', 9000);
  });

  // chat output contains markdown links and bare urls: route them to the default
  // browser instead of letting Electron navigate or open a second window
  document.addEventListener('click', (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    api.openExternal(href).then((result) => {
      if (!result.ok) toast(result.error || 'could not open link', 'error');
    });
  });
  els.monReqAll.addEventListener('click', () => {
    monitor.showAll = !monitor.showAll;
    if (monitor.lastData) renderMonitor(monitor.lastData);
    pollMonitor();
  });
  els.monSrc.addEventListener('click', () => api.openExternal(strataBaseUrl().replace(/\/v1$/i, '')));

  let resizeStartX = 0;
  let resizeStartW = 0;
  const resizing = () => els.monResizer.classList.contains('dragging');
  els.monResizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    els.monResizer.setPointerCapture(event.pointerId);
    els.monResizer.classList.add('dragging');
    resizeStartX = event.clientX;
    resizeStartW = els.monitorView.getBoundingClientRect().width;
  });
  els.monResizer.addEventListener('pointermove', (event) => {
    if (!resizing()) return;
    const width = Math.min(900, Math.max(340, Math.round(resizeStartW - (event.clientX - resizeStartX))));
    document.documentElement.style.setProperty('--mon-w', `${width}px`);
  });
  const endResize = () => {
    if (!resizing()) return;
    els.monResizer.classList.remove('dragging');
    state.settings.monitorWidth = Math.round(els.monitorView.getBoundingClientRect().width);
    api.settingsSet({ monitorWidth: state.settings.monitorWidth });
  };
  els.monResizer.addEventListener('pointerup', endResize);
  els.monResizer.addEventListener('pointercancel', endResize);
  els.serialToggle.addEventListener('change', () => {
    scheduler.enabled = els.serialToggle.checked;
    api.settingsSet({ serialQueue: scheduler.enabled });
    toast(scheduler.enabled ? 'serial queue on: one session runs at a time, top of the list first' : 'serial queue off: sessions run in parallel');
    renderTabs();
    renderOpenSessions();
    if (scheduler.enabled) scheduler.pumpSoon(0);
  });
  els.fileInput.addEventListener('change', async () => {
    await addFiles(els.fileInput.files);
    els.fileInput.value = '';
  });

  // D4: Alt+Arrow moves the active tab in the serial queue (works whatever has focus, including the
  // composer, because Alt+Arrow is never typed text)
  document.addEventListener('keydown', (event) => {
    if (modalOpen || !event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const tab = activeTab();
    if (!tab) return;
    const index = state.order.indexOf(tab.id);
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= state.order.length) return;
    event.preventDefault();
    moveTabTo(tab.id, target);
    toast(`${tabLabel(tab)} \u2192 queue position ${target + 1} (Alt+Arrow)`, 'info', 2500);
  });

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    refreshSessions();
  });
  if (els.cwdChip) {
    els.cwdChip.addEventListener('click', () => {
      const tab = activeTab();
      openFolder(tab && tab.cwd);
    });
  }

  els.modelSel.addEventListener('change', async () => {
    const tab = activeTab();
    if (!tab) return;
    const [provider, ...rest] = els.modelSel.value.split('/');
    const modelId = rest.join('/');
    const res = await api.cmd(tab.id, 'set_model', { provider, modelId });
    if (!res.success) {
      toast(res.error || 'model switch failed', 'error');
      renderSelectors(tab);
      return;
    }
    tab.model = res.data || tab.model;
    const levels = await api.cmd(tab.id, 'get_available_thinking_levels');
    if (levels.success && levels.data && levels.data.levels) tab.thinkingLevels = levels.data.levels;
    renderSelectors(tab);
    renderStats(tab);
  });

  els.thinkingSel.addEventListener('change', async () => {
    const tab = activeTab();
    if (!tab) return;
    const res = await api.cmd(tab.id, 'set_thinking_level', { level: els.thinkingSel.value });
    if (!res.success) {
      toast(res.error || 'thinking level change failed', 'error');
      renderSelectors(tab);
      return;
    }
    tab.thinking = els.thinkingSel.value;
  });

  els.input.addEventListener('keydown', (event) => {
    if (pathMenu.open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        movePathSelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        movePathSelection(-1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePathMenu();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        // first Enter completes the path, the next one sends the prompt
        if (acceptPathSelection()) {
          event.preventDefault();
          return;
        }
      }
    }
    if (slashMenu.open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSlashSelection(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSlashSelection(-1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation(); // do not let it reach the abort handler
        closeSlashMenu();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        // first Enter completes the command name, the next one sends it
        if (acceptSlashSelection()) {
          event.preventDefault();
          return;
        }
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      send();
    }
  });

  els.input.addEventListener('input', () => {
    els.input.classList.toggle('bash-mode', els.input.value.trimStart().startsWith('!'));
    if (els.input.value.startsWith('/')) refreshSlashMenu();
    else refreshPathMenu();
  });
  els.input.addEventListener('blur', () => {
    closeSlashMenu();
    closePathMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modalOpen) {
      const tab = activeTab();
      if (tab && tab.bashRunning) {
        // a running `!cmd` is not an agent run: abort_bash, not abort
        event.preventDefault();
        abortBash(tab);
      } else if (tab && tab.isStreaming) {
        event.preventDefault();
        abortRun();
      }
    }
  });

  els.transcript.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const pre = button.closest('pre.code');
    const code = pre && pre.querySelector('code');
    if (code) {
      navigator.clipboard.writeText(code.textContent).then(() => {
        button.textContent = 'copied';
        setTimeout(() => (button.textContent = 'copy'), 1500);
      });
    }
  });

  // Per-message hover actions (copy / resend). Delegated like the code-block button above:
  // the node carries data-key, so it also works for messages rebuilt by renderAll().
  els.transcript.addEventListener('click', (event) => {
    const button = event.target.closest('[data-msg-action]');
    if (!button || button.disabled) return;
    const tab = activeTab();
    if (!tab) return;
    const item = tab.items.find((it) => it.key === button.dataset.key && it.kind === 'message');
    if (!item) return;
    if (button.dataset.msgAction === 'copy') {
      const text = contentToText(item.message.content); // raw source, never innerHTML
      if (!text) {
        toast('this message has no text to copy', 'warning');
        return;
      }
      navigator.clipboard
        .writeText(text)
        .then(() => {
          button.textContent = 'copied';
          setTimeout(() => (button.textContent = 'copy'), 1500);
        })
        .catch((err) => toast(`copy failed: ${err.message}`, 'error'));
      return;
    }
    if (button.dataset.msgAction === 'resend') {
      resendMessage(tab, item).catch((err) => toast(`resend failed: ${err.message}`, 'error'));
    }
  });

  // menu accelerators come from the main process
  api.on('menu', async (action) => {
    switch (action) {
      case 'new-session':
        promptNewSession();
        break;
      case 'reset-tab':
        resetCurrentTab();
        break;
      case 'open-session':
        els.search.focus();
        els.search.select();
        break;
      case 'rename-tab':
        renameActiveSession();
        break;
      case 'close-tab':
        if (state.activeId) closeTab(state.activeId);
        break;
      case 'next-tab': {
        if (!state.order.length) break;
        const index = state.order.indexOf(state.activeId);
        activateTab(state.order[(index + 1) % state.order.length]);
        break;
      }
      case 'prev-tab': {
        if (!state.order.length) break;
        const index = state.order.indexOf(state.activeId);
        activateTab(state.order[(index - 1 + state.order.length) % state.order.length]);
        break;
      }
      case 'toggle-monitor':
        toggleMonitor();
        break;
      case 'toggle-sidebar':
        els.body.classList.toggle('sidebar-hidden');
        api.settingsSet({ sidebarHidden: els.body.classList.contains('sidebar-hidden') });
        break;
      case 'settings':
        openSettingsModal();
        break;
      default:
        break;
    }
  });

  // C9: the main process noticed the renderer died / hung / came back
  api.on('first-run', () => {
    openFirstRunWizard().catch((err) => console.error('[setup] wizard failed', err));
  });
  api.on('recovery', (event) => {
    const info = event && typeof event === 'object' ? event : {};
    if (info.kind === 'recovered') toast(info.cause || 'The interface answered again', 'info', 8000);
    else if (info.kind === 'declined') toast('reload declined \u2014 the window stays broken; sessions keep running in the background', 'warning', 9000);
  });

  // B5: the main-process scheduler never sends a prompt itself, it tells us and we queue it
  api.on('cron:fire', (event) => {
    handleCronFire(event || {}).catch((err) => console.error(`[cron] fire handler failed: ${err.stack || err}`));
  });
  api.on('cron:notice', (event) => {
    const info = event && typeof event === 'object' ? event : {};
    const names = (info.jobs || []).map((job) => job.name).join(', ');
    if (info.kind === 'missed') toast(`scheduled job${info.jobs.length > 1 ? 's' : ''} missed its run while the machine slept: ${names} \u2014 not replayed, next run is scheduled`, 'warning', 12000);
    else if (info.kind === 'undelivered') toast(`scheduled job${info.jobs.length > 1 ? 's' : ''} ${names} could not be delivered (${info.reason || 'the interface was not there to take it'}) \u2014 it did NOT run, next run is scheduled`, 'warning', 12000);
    else if (info.kind === 'invalid') toast(`scheduled job ${names} has an invalid schedule: ${(info.jobs[0] || {}).error || ''}`, 'error', 12000);
    console.log(`[cron] notice kind=${info.kind} reason=${info.reason || ''} jobs=${names}`);
  });

  api.on('pi:record', ({ tabId, record }) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    if (state.info && state.info.smoke) console.log(`[record ${tabId}] ${record.type}${record.assistantMessageEvent ? `:${record.assistantMessageEvent.type}` : ''}`);
    handleRecord(tab, record);
  });

  api.on('pi:exit', ({ tabId, code, signal, stderr, error }) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    tab.alive = false;
    tab.isStreaming = false;
    tab.starting = false;
    tab.compacting = false; // a dead process must not stall the serial queue
    tab.retrying = null;
    tab.compactStartedAt = 0;
    pushNote(
      tab,
      error
        ? `pi process failed to start: ${error}`
        : `pi process exited (code=${code} signal=${signal})${stderr ? `\n${stderr.slice(-1500)}` : ''}`,
      'error',
    );
    renderTabs();
    renderComposerState();
    renderOpenSessions();
    if (state.activeId === tabId) renderAll(tab);
    scheduler.onTabClosed(tab);
  });

  api.on('pi:stderr', ({ tabId, text }) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!tab.starting) return; // keep runtime stderr out of the transcript
    pushNote(tab, `stderr: ${trimmed.slice(0, 1500)}`, 'warn');
  });

  api.on('pi:log', ({ tabId, text }) => {
    const tab = state.tabs.get(tabId);
    if (tab) pushNote(tab, text, 'warn');
  });
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

async function init() {
  state.info = await api.info();
  state.settings = (await api.settingsGet()) || {};
  // D10: the catalog has to be in place before anything renders, or the first paint is English
  // whatever the setting says
  try {
    installI18n(await api.i18nGet());
  } catch (err) {
    console.error('[i18n] catalog load failed, staying in English:', err);
  }
  state.cwd = state.settings.cwd && state.settings.cwd !== '' ? state.settings.cwd : state.info.defaultCwd;
  applyTheme(state.settings.theme);
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (state.themeMode === 'system') applyTheme('system');
    });
  } catch {
    // older Electron builds without addEventListener on MediaQueryList: the theme simply stays put
  }
  scheduler.enabled = state.settings.serialQueue !== false;
  els.serialToggle.checked = scheduler.enabled;
  if (state.settings.sidebarHidden) els.body.classList.add('sidebar-hidden');

  renderEnvBar();
  if (state.info.smoke) {
    const node = els.envInfo.firstChild;
    console.log(`[smoke-env] text=${JSON.stringify(els.envInfo.textContent.trim().slice(0, 60))} pi_class=${node ? node.className : ''} level=${state.info.piVersionLevel} tested=${state.info.testedPiVersion}`);
  }

  wireUi();
  observeDialogs(); // D3: every dialog becomes a real dialog without touching its creator
  refreshStorage().catch(() => {}); // D7: the footer shows the folder size once this lands
  refreshUsageSummary().catch(() => {}); // D9: and the token ledger total
  // coming back to the window is when a stale chip is noticed, so make it current then; the scan is
  // incremental, so an idle app re-reads nothing
  window.addEventListener('focus', () => scheduleUsageSummary(0));
  // the wizard is for a human first run; smoke scenarios open it explicitly when they want it
  if (firstRunNeeded() && !(state.info && state.info.smoke)) openFirstRunWizard().catch((err) => console.error('[setup] first-run wizard failed', err));
  observeControlNames();
  wireDragAndDrop();
  wirePaste();
  renderComposerState();
  await refreshSessions();

  const restore = state.info.smoke || state.settings.restoreTabs === false ? [] : (state.settings.openTabs || []).filter((t) => t && t.sessionPath).slice(0, 4);
  if (restore.length) {
    for (const entry of restore) {
      const tab = makeTab({ tabId: entry.id || '', cwd: entry.cwd || state.cwd, sessionPath: entry.sessionPath, name: entry.name });
      restorePendingOutbox(entry, tab);
      const res = await api.spawn({ tabId: tab.id, cwd: tab.cwd, args: tab.args });
      if (res.ok) {
        tab.alive = true;
        await bootstrap(tab);
      } else {
        tab.starting = false;
        pushNote(tab, `failed to restore: ${res.error}`, 'error');
      }
    }
    // A reload after a renderer crash reuses the persisted tab ids, so main hands back the pi
    // processes that survived instead of starting duplicates; anything that died in the meantime
    // was respawned by spawnTab, and this is the sanity check that says which is which.
    const aliveMap = await api.alive(restore.map((entry) => entry.id).filter(Boolean));
    const reused = Object.values(aliveMap).filter(Boolean).length;
    if (reused) console.log(`[restore] ${reused}/${restore.length} tabs re-used a live pi process`);
    activateTab(state.order[state.order.length - 1]);
  } else {
    await createTab({ cwd: state.cwd, ephemeral: !!state.info.smoke });
  }

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
  console.log(
    `[smoke-export] ok=${result.ok} path=${result.path || ''} exists=${exists} bytes=${bytes}${result.error ? ` error=${JSON.stringify(result.error)}` : ''}`,
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

init().catch((err) => {
  toast(`startup failed: ${err.message}`, 'error', 20000);
  console.error(err);
});
