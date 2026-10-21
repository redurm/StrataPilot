'use strict';

/*
 * The session tree (#12, step 3): the fork/branch view of a session and the dialog
 * that renders it. Moved out of app.js without touching a function body.

 * Loaded before app.js. Anything evaluated at load time that calls app.js helpers
 * (i18nKey and friends) has to stay in app.js: step 2 died on exactly that, and
 * only the smoke log noticed - the unit suite was green while the window was not.
 */

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
          pushNote(tab, 'forked from: {text} - type the next prompt to take the other route', 'info', { text: oneLine(text, 160) });
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
