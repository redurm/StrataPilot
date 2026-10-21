'use strict';

/*
 * The transcript (#12, step 6): how a session log line becomes DOM - the message node,
 * the tool card, the bash card, the system note, and the append/renderAll that keep the
 * view in step with the log.

 * Moved out of app.js without touching a function body. Whole functions only: a
 * top-level statement that sits near one of them stays in app.js (step 2 and step 5
 * both proved that carried-over state changes what runs, and when).

 * Loaded before app.js; nothing here runs at load time.
 */

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

function appendPath(node, value) {
  const { head, leaf } = pathParts(value);
  const wrap = el('span', 'path-parts');
  if (head) wrap.appendChild(el('span', 'path-head', head));
  wrap.appendChild(el('span', 'path-leaf', leaf || head || '/'));
  node.appendChild(wrap);
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

function pushNote(tab, text, noteType = '', tokens = null) {
  // #45: these notes are the app's own words, so they are translated here, once - the same shape #32
  // used for toast(). Callers pass a catalog key plus the values that fill its {placeholders}; tr()
  // falls back to the key itself, so a key with no catalog entry still reads correctly in English.
  // What stays untranslated is pi's own output (stderr, tool payloads): that is one language on purpose.
  appendItem(tab, { key: nextKey(tab), kind: 'note', noteType, text: tokens ? tr(text, tokens) : tr(text) });
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
