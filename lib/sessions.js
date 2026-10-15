'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_SCAN_BYTES = 12 * 1024 * 1024; // skip deep scanning huge sessions

function sessionsRoot() {
  const envDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (envDir) return path.resolve(envDir);
  return path.join(os.homedir(), '.pi', 'agent', 'sessions');
}

function normalizeCwd(value) {
  if (!value) return '';
  let out = String(value).replace(/\\/g, '/');
  out = out.replace(/\/+$/, '');
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

function iterSessionFiles(root) {
  const out = [];
  let groups;
  try {
    groups = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const dir = path.join(root, group.name);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Stream a JSONL file line by line, splitting on LF only. */
function forEachLine(filePath, onLine) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return;
  }
  try {
    const chunkSize = 256 * 1024;
    const buf = Buffer.alloc(chunkSize);
    let carry = '';
    let total = 0;
    for (;;) {
      const read = fs.readSync(fd, buf, 0, chunkSize, null);
      if (read <= 0) break;
      total += read;
      const text = carry + buf.toString('utf8', 0, read);
      const parts = text.split('\n');
      carry = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.endsWith('\r') ? part.slice(0, -1) : part;
        if (line.trim()) onLine(line);
      }
      if (total > MAX_SCAN_BYTES) break;
    }
    if (carry.trim()) onLine(carry.endsWith('\r') ? carry.slice(0, -1) : carry);
  } finally {
    fs.closeSync(fd);
  }
}

function textOfContent(content, limit = 400) {
  if (typeof content === 'string') return content.slice(0, limit);
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text' && block.text) parts.push(block.text);
    else if (block.type === 'image') parts.push('[image]');
    if (parts.join(' ').length > limit) break;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function readSessionMeta(filePath) {
  const stat = fs.statSync(filePath);
  const meta = {
    path: filePath,
    fileName: path.basename(filePath),
    id: '',
    cwd: '',
    groupDir: path.basename(path.dirname(filePath)),
    createdAt: '',
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    version: 0,
    parentSession: null,
    name: '',
    title: '',
    firstUserText: '',
    lastUserText: '',
    lastAssistantText: '',
    model: '',
    thinkingLevel: '',
    messageCount: 0,
    userCount: 0,
    assistantCount: 0,
    toolCallCount: 0,
    totalTokens: 0,
    cost: 0,
    sizeBytes: stat.size,
    truncatedScan: stat.size > MAX_SCAN_BYTES,
  };

  forEachLine(filePath, (line) => {
    if (line[0] !== '{') return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    switch (entry.type) {
      case 'session':
        meta.id = entry.id || '';
        meta.cwd = entry.cwd || '';
        meta.createdAt = entry.timestamp || '';
        meta.version = entry.version || 1;
        meta.parentSession = entry.parentSession || null;
        break;
      case 'session_info':
        if (entry.name) meta.name = entry.name;
        break;
      case 'model_change':
        meta.model = entry.modelId || meta.model;
        break;
      case 'thinking_level_change':
        meta.thinkingLevel = entry.thinkingLevel || meta.thinkingLevel;
        break;
      case 'usage':
        if (entry.usage) {
          meta.totalTokens += entry.usage.totalTokens || 0;
          meta.cost += (entry.usage.cost && entry.usage.cost.total) || 0;
        }
        break;
      case 'message': {
        const msg = entry.message;
        if (!msg) break;
        meta.messageCount += 1;
        if (msg.role === 'user') {
          meta.userCount += 1;
          const text = textOfContent(msg.content);
          if (!meta.firstUserText) meta.firstUserText = text;
          meta.lastUserText = text;
        } else if (msg.role === 'assistant') {
          meta.assistantCount += 1;
          if (msg.model) meta.model = msg.model;
          if (msg.thinkingLevel) meta.thinkingLevel = msg.thinkingLevel;
          meta.lastAssistantText = textOfContent(msg.content, 300);
          if (msg.usage) {
            meta.totalTokens += msg.usage.totalTokens || 0;
            meta.cost += (msg.usage.cost && msg.usage.cost.total) || 0;
          }
        } else if (msg.role === 'toolResult') {
          meta.toolCallCount += 1;
        }
        if (entry.timestamp) meta.updatedAt = entry.timestamp;
        break;
      }
      default:
        if (entry.timestamp) meta.updatedAt = entry.timestamp;
        break;
    }
  });

  meta.title = meta.name || meta.firstUserText || meta.fileName.replace(/\.jsonl$/, '');
  return meta;
}

function listSessions({ cwd = '', scope = 'project', query = '', limit = 300 } = {}) {
  const root = sessionsRoot();
  const wantCwd = normalizeCwd(cwd);
  const files = iterSessionFiles(root);
  const sessions = [];
  for (const file of files) {
    let meta;
    try {
      meta = readSessionMeta(file);
    } catch {
      continue;
    }
    if (scope !== 'all' && wantCwd && normalizeCwd(meta.cwd) !== wantCwd) continue;
    sessions.push(meta);
  }
  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter((s) =>
        [s.title, s.name, s.firstUserText, s.lastUserText, s.lastAssistantText, s.model, s.cwd, s.fileName]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    : sessions;
  filtered.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { root, total: sessions.length, sessions: filtered.slice(0, limit) };
}

function assertInsideRoot(filePath) {
  const root = sessionsRoot();
  const resolved = path.resolve(filePath);
  const rel = path.relative(path.resolve(root), resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing to touch path outside the sessions dir: ${filePath}`);
  }
  if (!resolved.endsWith('.jsonl')) throw new Error('only .jsonl session files can be modified');
  return resolved;
}

function deleteSession(filePath) {
  const target = assertInsideRoot(filePath);
  fs.rmSync(target, { force: true });
  return true;
}

/**
 * Rename an inactive session by appending a session_info entry.
 * Safe append-only edit; active sessions should use the RPC set_session_name.
 */
function renameSession(filePath, name) {
  const target = assertInsideRoot(filePath);
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('name is required');
  let leafId = null;
  forEachLine(target, (line) => {
    try {
      const entry = JSON.parse(line);
      if (entry && entry.id) leafId = entry.id;
    } catch {}
  });
  const id = Math.random().toString(16).slice(2, 10);
  const entry = {
    type: 'session_info',
    id,
    parentId: leafId,
    timestamp: new Date().toISOString(),
    name: trimmed,
  };
  fs.appendFileSync(target, JSON.stringify(entry) + '\n');
  return readSessionMeta(target);
}

module.exports = { sessionsRoot, listSessions, readSessionMeta, deleteSession, renameSession, normalizeCwd };
