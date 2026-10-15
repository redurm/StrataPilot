'use strict';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const api = window.piGui;
const $ = (id) => document.getElementById(id);

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
  queueBar: $('queueBar'),
  btnSend: $('btnSend'),
  btnAbort: $('btnAbort'),
  btnClearQueue: $('btnClearQueue'),
  btnCompact: $('btnCompact'),
  autoCompactToggle: $('autoCompactToggle'),
  autoCompactWrap: $('autoCompactWrap'),
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
};

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

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
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(2)}M`;
}

function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
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
  order: [],
  activeId: null,
  cwd: '',
  scope: 'project',
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

function makeTab({ cwd, sessionPath, name, ephemeral, extraArgs = [] }) {
  const id = `tab-${Date.now().toString(36)}-${++state.tabSeq}`;
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
    tools: new Map(), // toolCallId -> {name,args,status,result,isError,durationMs,el}
    bashes: new Map(), // bashId -> {command,output,exitCode,status,…} (`!` commands)
    bashRunning: null, // bashId of the command pi is running for this tab
    attachments: [], // {kind:'file'|'dir', path, name, size}
    images: [], // {kind:'image', name, mimeType, data, previewUrl, path}
    inlines: [], // {kind:'inline', name, text}
    outbox: [], // {text, images, at} messages waiting for the serial queue
    autoCompact: true, // pi's own automatic compaction (read back from get_state)
    compacting: false, // a compaction (manual or auto) is in flight in this session
    compactStartedAt: 0,
    compactEventSeen: false, // pi already reported this compaction through compaction_end
    compactEventResult: undefined, // outcome carried by the compaction_end event
    counters: 0,
    nodes: new Map(), // item key -> rendered node
    streaming: null,
    isStreaming: false,
    alive: false,
    starting: true,
    queued: { steering: [], followUp: [] },
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
      head.appendChild(el('span', '', `${fmtTokens(message.usage.totalTokens)} tok`));
      const cost = message.usage.cost && message.usage.cost.total;
      if (cost) head.appendChild(el('span', '', `$${cost.toFixed(4)}`));
    }
    if (message.stopReason && message.stopReason !== 'stop' && message.stopReason !== 'toolUse') {
      head.appendChild(el('span', '', `stop: ${message.stopReason}`));
    }
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

function renderAll(tab) {
  els.transcript.textContent = '';
  tab.nodes.clear();
  if (!tab.items.length) {
    const hint = el('div', 'empty-hint');
    hint.innerHTML =
      'No messages yet.<br />Type a prompt, or drop files anywhere in the window to attach them.<br /><kbd>Ctrl</kbd> + <kbd>T</kbd> new session &nbsp; <kbd>Ctrl</kbd> + <kbd>O</kbd> open session &nbsp; <kbd>Ctrl</kbd> + <kbd>B</kbd> sidebar';
    els.transcript.appendChild(hint);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of tab.items) {
    const node = buildItemNode(tab, item);
    if (!node) continue;
    tab.nodes.set(item.key, node);
    frag.appendChild(node);
  }
  els.transcript.appendChild(frag);
  els.transcript.scrollTop = els.transcript.scrollHeight;
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
      scheduler.onAgentStart(tab);
      break;
    case 'agent_end':
      if (record.willRetry) pushNote(tab, 'retrying…', 'warn');
      break;
    case 'agent_settled':
      tab.isStreaming = false;
      tab.streaming = null;
      if (record.aborted) pushNote(tab, 'run aborted', 'warn');
      renderTabs();
      renderComposerState();
      refreshStats(tab);
      refreshSessionsSoon();
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
          tab.pendingUserTexts.splice(at, 1);
        } else {
          appendItem(tab, { key: nextKey(tab), kind: 'message', message });
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
      renderTabs();
      renderOpenSessions();
      renderComposerState();
      scheduler.pumpSoon(400); // a running compaction was holding the serial queue
      break;
    case 'auto_retry_start':
      pushNote(tab, `retry ${record.attempt}/${record.maxAttempts} in ${record.delayMs}ms: ${record.errorMessage}`, 'warn');
      break;
    case 'auto_retry_end':
      if (!record.success) pushNote(tab, `retry failed after ${record.attempt} attempts: ${record.finalError || ''}`, 'error');
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
      document.title = req.title || 'Pi on Strata';
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

function openSimpleModal({ title, message, kind, options, prefill, placeholder, timeoutMs, okLabel = 'OK', cancelLabel = 'Cancel' }) {
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
      valueEl.placeholder = placeholder || '';
      modal.appendChild(valueEl);
    } else if (kind === 'editor') {
      valueEl = el('textarea');
      valueEl.value = prefill;
      modal.appendChild(valueEl);
    }

    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'ghost', kind === 'confirm' ? 'No' : cancelLabel);
    const ok = el('button', 'primary', kind === 'confirm' ? 'Yes' : okLabel);
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

function renderTabs() {
  els.tabs.textContent = '';
  for (const tabId of state.order) {
    const tab = state.tabs.get(tabId);
    if (!tab) continue;
    const node = el('div', `tab${tabId === state.activeId ? ' active' : ''}`);
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
    node.title = `${tabLabel(tab)}\n${tab.cwd}\n${running ? 'running' : tab.outbox.length ? `queued (${tab.outbox.length} pending)` : 'idle'}`;
    const close = el('button', 'tab-close', '×');
    close.title = 'Close tab';
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
    opt.textContent = 'no models';
    els.modelSel.appendChild(opt);
  }

  els.thinkingSel.textContent = '';
  const levels = tab.thinkingLevels && tab.thinkingLevels.length ? tab.thinkingLevels : ['off'];
  for (const level of levels) {
    const opt = document.createElement('option');
    opt.value = level;
    opt.textContent = `thinking: ${level}`;
    if (level === tab.thinking) opt.selected = true;
    els.thinkingSel.appendChild(opt);
  }
}

function renderStats(tab) {
  els.stats.textContent = '';
  if (!tab) return;
  const add = (label, value, cls = '') => {
    if (!value) return;
    const span = el('span', cls);
    span.appendChild(el('b', '', `${label} `));
    span.appendChild(document.createTextNode(String(value)));
    els.stats.appendChild(span);
  };
  if (tab.model) add('model', `${tab.model.provider}/${tab.model.id}`);
  if (tab.stats && tab.stats.contextUsage) {
    const cu = tab.stats.contextUsage;
    const percent = cu.percent == null ? null : Math.round(cu.percent * 10) / 10;
    add('ctx', `${fmtTokens(cu.tokens)} / ${fmtTokens(cu.contextWindow)}${percent == null ? '' : ` (${percent}%)`}`);
    if (tab.autoCompact === false && percent != null && percent >= 85) {
      add('auto-compact off', 'compact before it overflows', 'warn');
    }
  }
  if (tab.stats) {
    add('tok', fmtTokens(tab.stats.tokens && tab.stats.tokens.total));
    if (tab.stats.cost) add('cost', `$${tab.stats.cost.toFixed(3)}`);
  }
  for (const [key, text] of tab.statuses) add(key, text);
}

function renderQueueBar(tab) {
  const steering = (tab && tab.queued.steering) || [];
  const followUp = (tab && tab.queued.followUp) || [];
  if (!steering.length && !followUp.length) {
    els.queueBar.classList.add('hidden');
    els.btnClearQueue.classList.add('hidden');
    return;
  }
  els.queueBar.classList.remove('hidden');
  els.btnClearQueue.classList.remove('hidden');
  els.queueBar.textContent = `queued — steer: ${steering.length} | follow-up: ${followUp.length}`;
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

function renderComposerState() {
  const tab = activeTab();
  const bashRunning = !!(tab && tab.bashRunning);
  els.btnAbort.classList.toggle('hidden', !(tab && (tab.isStreaming || bashRunning)));
  els.btnAbort.title = bashRunning ? 'Stop the running bash command (Esc)' : 'Stop the current run (Esc)';
  if (els.btnCompact) {
    els.btnCompact.disabled = !tab || !tab.alive || !!tab.compacting;
    els.btnCompact.title = tab && tab.compacting ? 'Compaction in progress…' : 'Compact the context now';
  }
  els.btnSend.disabled = !tab;
  els.input.disabled = !tab;
  const autoOn = !(tab && tab.autoCompact === false);
  els.autoCompactToggle.checked = autoOn;
  els.autoCompactToggle.disabled = !tab || !tab.alive;
  els.autoCompactWrap.classList.toggle('off', !autoOn);
  if (!tab) {
    els.input.placeholder = 'Create a session first (Ctrl+T)';
  } else if (!tab.alive) {
    els.input.placeholder = 'This session process ended — press Send to restart it in the same folder';
  } else {
    els.input.placeholder = 'Enter = send · Shift+Enter = newline · !cmd = run bash · / = commands · drop files to attach';
  }
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
  renderQueueBar(tab);
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

function queueRow(tab, position) {
  const running = !!tab.isStreaming || scheduler.runningTabId === tab.id;
  const queued = !running && tab.outbox.length > 0;
  const classes = ['qrow', running ? 'running' : queued ? 'queued' : 'idle'];
  if (state.activeId === tab.id) classes.push('active');
  const row = el('div', classes.join(' '));
  row.dataset.tabId = tab.id;
  row.draggable = true;
  row.title = `${tab.cwd}\n${tab.sessionPath || 'unsaved session'}`;
  row.appendChild(el('span', 'qdot'));
  row.appendChild(el('span', 'qtitle', tabLabel(tab)));
  if (position) row.appendChild(el('span', 'qpos', `#${position}`));
  if (!tab.sessionPath) {
    const badge = el('span', `qbadge ${tab.ephemeral ? 'ephemeral' : 'unsaved'}`, tab.ephemeral ? 'ephemeral' : 'unsaved');
    badge.title = tab.ephemeral
      ? 'Ephemeral tab: never written to disk, so it will never appear in Session files'
      : 'No session file yet (pi creates it after the first message), so it is not in Session files';
    row.appendChild(badge);
  }
  if (tab.outbox.length) {
    const badge = el('span', 'qbadge outbox', `outbox ${tab.outbox.length}`);
    badge.title = 'Messages waiting for this session (click to inspect)';
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      openOutboxModal(tab);
    });
    row.appendChild(badge);
  }
  const actions = el('div', 'qactions');
  const top = el('button', '', 'top');
  top.title = 'Move to front of the queue';
  top.addEventListener('click', (event) => {
    event.stopPropagation();
    moveTabTo(tab.id, 0);
  });
  const drop = el('button', '', 'drop');
  drop.title = 'Drop queued messages for this session';
  drop.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!tab.outbox.length) {
      toast('nothing queued for this session');
      return;
    }
    tab.outbox = [];
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
    els.queueList.appendChild(el('div', 'queue-hint', 'No open sessions.'));
    return;
  }
  const working = tabs.filter((tab) => isWorking(tab));
  const idle = tabs.filter((tab) => !isWorking(tab));
  if (working.length) {
    els.queueList.appendChild(el('div', 'qgroup', `Working (${working.length})${scheduler.runningTabId ? ' - running: 1' : ''}`));
    working.forEach((tab, index) => els.queueList.appendChild(queueRow(tab, index + 1)));
  }
  if (idle.length) {
    els.queueList.appendChild(el('div', 'qgroup idle', `Idle (${idle.length})`));
    idle.forEach((tab) => els.queueList.appendChild(queueRow(tab, 0)));
  }
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
          paint();
          renderOpenSessions();
        });
        const remove = el('button', 'ghost', 'remove');
        remove.addEventListener('click', () => {
          tab.outbox.splice(index, 1);
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
    event.dataTransfer.setData('text/x-pi-on-strata-tab', tabId);
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
    const sourceId = dragTabId || event.dataTransfer.getData('text/x-pi-on-strata-tab');
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
  }

  await refreshStats(tab);
  tab.starting = false;
  tab.alive = true;
  renderTabs();
  renderSelectors(tab);
  renderComposerState();
  renderOpenSessions();
  if (state.activeId === tab.id) renderAll(tab);
  markCurrentSession();
  scheduleSave();
  scheduler.pumpSoon(400);
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
  const res = await api.sessionsList({ cwd: state.cwd, scope: state.scope, query: state.query, limit: 400 });
  if (!res.ok) {
    els.sessionList.textContent = '';
    els.sessionList.appendChild(el('div', 'note error', res.error || 'failed to list sessions'));
    return;
  }
  state.sessions = res.sessions;
  els.sideFoot.textContent = `${res.sessions.length} / ${res.total} sessions`;
  els.sessionList.textContent = '';

  if (!res.sessions.length) {
    els.sessionList.appendChild(el('div', 'empty-hint', 'No sessions found.'));
    return;
  }

  for (const meta of res.sessions) {
    const item = el('div', 'session-item');
    item.dataset.path = meta.path;
    item.appendChild(el('div', 'session-title', meta.title || meta.fileName));
    const snippet = el('div', 'session-snippet', meta.lastAssistantText || meta.lastUserText || '');
    item.appendChild(snippet);
    const metaRow = el('div', 'session-meta');
    metaRow.appendChild(el('span', '', timeAgo(meta.updatedAt)));
    metaRow.appendChild(el('span', '', `${meta.messageCount} msg`));
    if (meta.model) metaRow.appendChild(el('span', '', meta.model));
    if (meta.totalTokens) metaRow.appendChild(el('span', '', fmtTokens(meta.totalTokens)));
    if (meta.parentSession) metaRow.appendChild(el('span', '', 'fork'));
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
    mk('this tab', 'Load into the current session tab', () => switchCurrentTabTo(meta));
    mk('name', 'Rename session', async () => {
      const response = await openModal({ title: 'Session name', kind: 'input', prefill: meta.name || meta.title });
      if (response.cancelled) return;
      const name = String(response.value || '').trim();
      if (!name) return;
      const openTab = [...state.tabs.values()].find((t) => t.alive && samePath(t.sessionPath, meta.path));
      if (openTab) {
        const res = await api.cmd(openTab.id, 'set_session_name', { name });
        if (!res.success) toast(res.error || 'rename failed', 'error');
        else openTab.name = name;
      } else {
        const result = await api.sessionsRename(meta.path, name);
        if (!result.ok) toast(result.error || 'rename failed', 'error');
      }
      refreshSessions();
      renderTabs();
    });
    mk('del', 'Delete session file', async () => {
      const open = [...state.tabs.values()].some((t) => samePath(t.sessionPath, meta.path));
      if (open) {
        toast('session is open in a tab', 'warning');
        return;
      }
      const response = await openModal({ title: 'Delete session?', message: meta.title, kind: 'confirm' });
      if (response.cancelled || !response.confirmed) return;
      const result = await api.sessionsDelete(meta.path);
      if (!result.ok) toast(result.error || 'delete failed', 'error');
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
  tab.sessionPath = meta.path;
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
/* strata server monitor (ported from strata-src serve/web/app.js)     */
/* ------------------------------------------------------------------ */

const MON_CARDS = [
  { key: 'speed', label: 'Speed' },
  { key: 'gpu', label: 'GPU load' },
  { key: 'vram', label: 'VRAM' },
  { key: 'temp', label: 'GPU temp', tone: 'amber' },
  { key: 'power', label: 'Power', tone: 'amber' },
  { key: 'pcie', label: 'PCIe', tone: 'blue' },
  { key: 'cpu', label: 'CPU', tone: 'blue' },
  { key: 'disk', label: 'Disk read', tone: 'blue' },
];
const MON_STATES = ['idle', 'reading', 'generating', 'queued', 'error'];
const RING_R = 37.5;
const RING_C = 2 * Math.PI * RING_R;

const monitor = {
  open: false,
  timer: null,
  showAll: false,
  built: false,
  failures: 0,
  lastData: null,
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

function buildMonitorCards() {
  if (monitor.built) return;
  els.monBadges.textContent = '';
  for (const s of MON_STATES) {
    const badge = el('span', 'st-badge', s[0].toUpperCase() + s.slice(1));
    badge.dataset.s = s;
    els.monBadges.appendChild(badge);
  }
  els.monCards.textContent = '';
  for (const card of MON_CARDS) {
    const node = el('div', 'mcard');
    node.appendChild(el('div', 'mcard-head', card.label));
    node.innerHTML +=
      card.key === 'speed'
        ? `<div class="m-pair">
             <div><span class="m-value" id="mv-speed">&ndash;</span><span class="m-sub" id="ms-speed">Decode</span></div>
             <div><span class="m-value" id="mv-prefill">&ndash;</span><span class="m-sub" id="ms-prefill">Prefill</span></div>
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
  const since = new Date(totals.since * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const read = totals.prompt_tokens - totals.reused;
  const prefill = totals.prompt_ms > 0 && read > 0 ? ` at ${nfmt(read / (totals.prompt_ms / 1000))} tok/s` : '';
  const decode = totals.decode_ms > 0 && totals.output_tokens > 0 ? ` at ${nfmt(totals.output_tokens / (totals.decode_ms / 1000), 1)} tok/s` : '';
  return `Since ${since}: ${nfmt(totals.requests)} requests · ${nfmt(read)} prompt tokens read${prefill} (${nfmt(totals.reused)} reused) · ${nfmt(totals.output_tokens)} written${decode}`;
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
  let label = 'Waiting for a request';
  let detail = '';
  let pct = 0;
  if (live.state === 'reading') {
    label = 'Reading prompt';
    if (live.prompt_total) {
      pct = (100 * live.prompt_read) / live.prompt_total;
      detail = `${nfmt(live.prompt_read)} / ${nfmt(live.prompt_total)} tokens · ${nfmt(pct)}%`;
    } else {
      detail = `${nfmt(live.prompt_tokens)} tokens`;
    }
  } else if (live.state === 'generating') {
    label = live.phase ? live.phase[0].toUpperCase() + live.phase.slice(1) : 'Generating';
    pct = live.max_tokens ? Math.min(100, (100 * live.generated) / live.max_tokens) : 0;
    detail = `${nfmt(live.generated)} tokens · ${nfmt(live.tok_s, 1)} tok/s`;
  } else if (last) {
    detail = `last: ${nfmt(last.output_tokens)} tokens${last.decode_tok_s ? ` at ${nfmt(last.decode_tok_s, 1)} tok/s` : ''}`;
  }
  els.monStateLabel.textContent = live.queued > 0 ? `${label} · ${live.queued} queued` : label;
  els.monStateDetail.textContent = detail;
  els.monStateBar.style.width = `${pct}%`;
  els.monStateBar.classList.toggle('info', live.state === 'reading');

  // metric cards
  const speed = live.state === 'generating' ? live.tok_s : last ? last.decode_tok_s : null;
  setMetric('speed', speed == null ? null : nfmt(speed, 1), 't/s', live.state === 'generating' ? 'Decode now' : last ? 'Decode last request' : 'Decode');
  const prefill =
    live.state !== 'idle' ? live.prefill_tok_s_mean : last && last.prompt_ms > 0 ? Math.max(0, last.prompt_tokens - (last.reused || 0)) / (last.prompt_ms / 1000) : null;
  setMetric('prefill', prefill == null ? null : nfmt(prefill), 't/s', live.state === 'reading' ? 'Prefill now' : live.state === 'generating' ? 'Prefill this request' : last ? 'Prefill last request' : 'Prefill');
  drawSpark('sp-speed', history.tok_s);
  drawSpark('sp-prefill', history.prefill_tok_s_mean);

  const gpus = hw.gpus || [];
  const multi = gpus.length > 1;
  const perGpu = (fn) => gpus.map((g) => `GPU ${g.index} ${fn(g)}`).join(' · ');
  setMetric('gpu', hw.gpu_util == null ? null : nfmt(hw.gpu_util), '%', multi ? perGpu((g) => (g.util == null ? '–' : `${nfmt(g.util)}%`)) : st.gpu_name || (st.gpu_note ? 'not available' : ''));
  drawSpark('sp-gpu', history.gpu_util, 100);
  setMetric(
    'vram',
    hw.gpu_mem_used == null ? null : gb(hw.gpu_mem_used),
    hw.gpu_mem_total ? `/ ${gb(hw.gpu_mem_total, 0)} GB` : 'GB',
    multi ? perGpu((g) => (g.mem_used == null ? '–' : `${gb(g.mem_used)} GB`)) : eng.expert_slots ? `${nfmt(eng.expert_slots)} experts cached` : st.gpu_note ? 'not available on Windows AMD yet' : '',
  );
  drawSpark('sp-vram', history.gpu_mem_used, hw.gpu_mem_total);
  setMetric('temp', hw.gpu_temp == null ? null : nfmt(hw.gpu_temp), '°C', multi ? perGpu((g) => (g.temp == null ? '–' : `${nfmt(g.temp)}°`)) : '');
  drawSpark('sp-temp', history.gpu_temp, 90);
  setMetric('power', hw.gpu_power == null ? null : nfmt(hw.gpu_power), 'W', hw.gpu_power_limit ? `of ${nfmt(hw.gpu_power_limit)} W limit` : '');
  drawSpark('sp-power', history.gpu_power, hw.gpu_power_limit);
  const gen = hw.gpu_pcie_gen_max || hw.gpu_pcie_gen;
  setMetric(
    'pcie',
    gen ? `Gen${gen}` : null,
    hw.gpu_pcie_width ? `x${hw.gpu_pcie_width}` : '',
    hw.gpu_pcie_rx_mb == null
      ? ''
      : `to GPU ${nfmt(hw.gpu_pcie_rx_mb, hw.gpu_pcie_rx_mb < 10 ? 1 : 0)} MB/s` + (hw.gpu_pcie_gen && gen && hw.gpu_pcie_gen < gen ? ` · idle Gen${hw.gpu_pcie_gen}` : ''),
  );
  drawSpark('sp-pcie', history.gpu_pcie_rx_mb);
  setMetric('cpu', hw.cpu == null ? null : nfmt(hw.cpu), '%', st.threads ? `${st.cores ? `${st.cores} cores · ` : ''}${st.threads} threads` : '');
  drawSpark('sp-cpu', history.cpu, 100);
  if (hw.disk_read_mb == null) {
    setMetric('disk', null, '', st.psutil ? '' : 'needs psutil');
  } else {
    const big = hw.disk_read_mb >= 1000;
    setMetric(
      'disk',
      big ? nfmt(hw.disk_read_mb / 1024, 2) : nfmt(hw.disk_read_mb, hw.disk_read_mb < 10 ? 1 : 0),
      big ? 'GB/s' : 'MB/s',
      hw.disk_write_mb == null ? '' : `write ${nfmt(hw.disk_write_mb, 1)} MB/s`,
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
    els.monReqBody.innerHTML = '<tr><td colspan="9" class="muted">No requests yet</td></tr>';
  } else {
    const badge = {
      stop: ['ok', 'Done'],
      length: ['warn', 'Max tokens'],
      cancel: ['warn', 'Stopped'],
      disconnect: ['warn', 'Closed'],
      error: ['error', 'Error'],
    };
    const MON_MAX_ROWS = 150;
    const shown = monitor.showAll ? requests.slice(0, MON_MAX_ROWS) : requests.slice(0, 12);
    els.monReqBody.innerHTML = shown
      .map((r) => {
        const [cls, text] = badge[r.finish] || ['', r.finish || '–'];
        const time = new Date(r.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const hit =
          r.hit_rate == null
            ? '–'
            : `${(r.hit_rate * 100).toFixed(1)}%` +
              (r.pcie_share
                ? ` <span class="muted" title="routed experts the GPU read over PCIe (--pcie-frac) or another GPU computed">+${(r.pcie_share * 100).toFixed(1)}%P</span>`
                : '');
        const fresh = r.prompt_tokens == null ? null : Math.max(0, r.prompt_tokens - (r.reused || 0));
        const prefillRate = fresh > 0 && r.prompt_ms > 0 ? fresh / (r.prompt_ms / 1000) : null;
        return `<tr><td>${window.escapeHtml(time)}</td><td><span class="req-badge ${cls}">${window.escapeHtml(text)}</span></td><td class="num">${nfmt(r.prompt_tokens)}</td><td class="num">${nfmt(r.reused)}</td><td class="num">${nfmt(r.output_tokens)}</td><td class="num">${nfmt(prefillRate)}</td><td class="num">${nfmt(r.decode_tok_s, 1)}</td><td class="num">${hit}</td><td class="num">${nfmt(r.duration_s, 1)} s</td></tr>`;
      })
      .join('');
    if (monitor.showAll && requests.length > shown.length) {
      els.monReqBody.insertAdjacentHTML(
        'beforeend',
        `<tr><td colspan="9" class="muted">newest ${shown.length} of ${requests.length} shown (the rest are hidden to keep the UI light)</td></tr>`,
      );
    }
  }
  const kept = data.requests_kept == null ? requests.length : data.requests_kept;
  els.monReqAll.hidden = kept <= 12;
  els.monReqAll.textContent = monitor.showAll ? 'Show fewer' : `Show all (${kept})`;
  els.monReqBody.closest('.req-wrap').classList.toggle('all', monitor.showAll);
  els.monTotals.textContent = monitorTotalsLine(data.totals);
}

async function pollMonitor() {
  if (!monitor.open) return;
  const result = await api.strataMetrics({ baseUrl: strataBaseUrl(), all: monitor.showAll });
  if (!monitor.open) return;
  if (!result.ok) {
    monitor.failures++;
    setMonSrc(`${result.url || strataBaseUrl()} · ${result.error}${monitor.failures === 3 ? ' (server not reachable)' : ''}`, true);
    return;
  }
  monitor.failures = 0;
  monitor.lastData = result.data;
  setMonSrc(`${result.url} · live · updated ${new Date().toLocaleTimeString()}`);
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
  appendItem(tab, { key: nextKey(tab), kind: 'bash', bashId });
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
  { name: 'model', args: '[provider/id]', desc: 'pick a model, or set one by name' },
  { name: 'thinking', args: '[level]', desc: 'show or set the thinking level' },
  { name: 'new', args: '', desc: 'start a new session in this tab' },
  { name: 'clear', args: '', desc: 'same as /new' },
  { name: 'rename', args: '<name>', desc: 'name this session' },
  { name: 'abort', args: '', desc: 'stop the current run or bash command' },
  { name: 'resume', args: '', desc: 'search past sessions in the sidebar' },
  { name: 'monitor', args: '', desc: 'toggle the Strata monitor' },
  { name: 'stats', args: '', desc: 'print tokens, cost and context usage' },
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
          + `tokens in ${fmtTokens(t.input || 0)} / out ${fmtTokens(t.output || 0)} / cache read ${fmtTokens(t.cacheRead || 0)} / total ${fmtTokens(t.total || 0)}\n`
          + `cost $${Number(d.cost || 0).toFixed(4)} · context ${ctx.percent || 0}% (${fmtTokens(ctx.tokens || 0)} / ${fmtTokens(ctx.contextWindow || 0)})\n`
          + `session: ${d.sessionFile || '(ephemeral)'}`,
      );
      clearComposer();
      return true;
    }
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
  appendItem(tab, { key: nextKey(tab), kind: 'message', message: { role: 'user', content: item.text, timestamp: item.at || Date.now() } });
  tab.pendingUserTexts.push(item.text);
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
    if (res.data && res.data.disposition === 'queued') toast(`queued as ${type === 'steer' ? 'steering' : 'follow-up'} in this session`);
    return;
  }

  // Serial mode: another session owns the single-flight provider, or this
  // session already has pending work -> keep FIFO inside the session outbox.
  const otherRunning = scheduler.enabled && scheduler.runningTabId && scheduler.runningTabId !== tab.id;
  if (tab.outbox.length || otherRunning || tab.compacting) {
    tab.outbox.push(message);
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
    if (isImage && file.size <= 8 * 1024 * 1024) {
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
      } catch {}
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
    // No absolute path available: inline the text content.
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
/* persistence                                                         */
/* ------------------------------------------------------------------ */

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    const openTabs = [...state.tabs.values()]
      .filter((tab) => tab.sessionPath && !tab.ephemeral)
      .map((tab) => ({ cwd: tab.cwd, sessionPath: tab.sessionPath, name: tab.name }));
    api.settingsSet({ cwd: state.cwd, openTabs, scope: state.scope, serialQueue: scheduler.enabled });
  }, 800);
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

  els.autoCompactToggle.addEventListener('change', async () => {
    const tab = activeTab();
    if (!tab) return;
    const enabled = els.autoCompactToggle.checked;
    const res = await api.cmd(tab.id, 'set_auto_compaction', { enabled });
    if (!res.success) {
      toast(res.error || 'set_auto_compaction failed', 'error');
      els.autoCompactToggle.checked = tab.autoCompact !== false;
      return;
    }
    tab.autoCompact = enabled;
    toast(`auto-compact ${enabled ? 'on' : 'off'} · ${tabLabel(tab)}`);
    renderComposerState();
    renderStats(tab);
  });
  $('btnClearQueue').addEventListener('click', clearQueue);
  $('btnAttach').addEventListener('click', () => els.fileInput.click());
  els.btnMonitor.addEventListener('click', toggleMonitor);

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

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    refreshSessions();
  });
  for (const radio of document.querySelectorAll('input[name=scope]')) {
    radio.addEventListener('change', () => {
      state.scope = radio.value;
      refreshSessions();
      scheduleSave();
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
    refreshSlashMenu();
  });
  els.input.addEventListener('blur', () => closeSlashMenu());

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
      default:
        break;
    }
  });

  api.on('pi:record', ({ tabId, record }) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    if (state.info && state.info.smoke) console.log(`[record ${tabId}] ${record.type}${record.assistantMessageEvent ? `:${record.assistantMessageEvent.type}` : ''}`);
    handleRecord(tab, record);
  });

  api.on('pi:exit', ({ tabId, code, signal, stderr }) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    tab.alive = false;
    tab.isStreaming = false;
    tab.starting = false;
    tab.compacting = false; // a dead process must not stall the serial queue
    tab.compactStartedAt = 0;
    pushNote(tab, `pi process exited (code=${code} signal=${signal})${stderr ? `\n${stderr.slice(-1500)}` : ''}`, 'error');
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

async function init() {
  state.info = await api.info();
  state.settings = (await api.settingsGet()) || {};
  state.cwd = state.settings.cwd && state.settings.cwd !== '' ? state.settings.cwd : state.info.defaultCwd;
  state.scope = state.settings.scope || 'project';
  scheduler.enabled = state.settings.serialQueue !== false;
  els.serialToggle.checked = scheduler.enabled;
  document.querySelectorAll('input[name=scope]').forEach((radio) => (radio.checked = radio.value === state.scope));
  if (state.settings.sidebarHidden) els.body.classList.add('sidebar-hidden');

  els.envInfo.textContent = `pi ${state.info.piVersion || '?'} · electron ${state.info.electronVersion} · ${state.info.sessionsRoot}`;

  wireUi();
  wireDragAndDrop();
  renderComposerState();
  await refreshSessions();

  const restore = state.info.smoke ? [] : (state.settings.openTabs || []).filter((t) => t && t.sessionPath).slice(0, 4);
  if (restore.length) {
    for (const entry of restore) {
      const tab = makeTab({ cwd: entry.cwd || state.cwd, sessionPath: entry.sessionPath, name: entry.name });
      const res = await api.spawn({ tabId: tab.id, cwd: tab.cwd, args: tab.args });
      if (res.ok) {
        tab.alive = true;
        await bootstrap(tab);
      } else {
        tab.starting = false;
        pushNote(tab, `failed to restore: ${res.error}`, 'error');
      }
    }
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
      console.log(`[smoke] switched session; rendered items=${tab ? tab.items.length : 0}`);
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

async function smokeAutoCompactScenario() {
  const tab = activeTab();
  const before = await api.cmd(tab.id, 'get_state');
  const initial = before.success ? before.data.autoCompactionEnabled : 'n/a';
  const off = await api.cmd(tab.id, 'set_auto_compaction', { enabled: false });
  const after1 = await api.cmd(tab.id, 'get_state');
  const back = await api.cmd(tab.id, 'set_auto_compaction', { enabled: true });
  const after2 = await api.cmd(tab.id, 'get_state');
  console.log(
    `[smoke-autocompact] initial=${initial} tab.autoCompact=${tab.autoCompact} setOff=${off.success} now=${after1.success && after1.data.autoCompactionEnabled} setOn=${back.success} now=${after2.success && after2.data.autoCompactionEnabled} checkbox=${els.autoCompactToggle.checked}`,
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

init().catch((err) => {
  toast(`startup failed: ${err.message}`, 'error', 20000);
  console.error(err);
});
