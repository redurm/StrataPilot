'use strict';

/*
 * The external Markdown Viewer handoff (docs/COMPOSER.md, "Handing a block to another app").
 *
 * The transcript deliberately cannot draw Mermaid diagrams or typeset maths - that would mean several MB
 * of renderer dependencies and a build step this repo does not have. The sibling app
 * `C:\Git\MarkdownViewer` (WinUI 3 + WebView2, all rendering dependencies bundled, offline) can. So the
 * GUI writes the block out as a real .md file and hands it over.
 *
 * Everything here is pure enough to test without Electron: a name, a file, a decision about which program
 * opens it. Electron-specific work (spawning, shell.openPath) stays in main.js.
 */

const fs = require('node:fs');
const path = require('node:path');

/** One message is not a novel; a transcript answer above this is truncated rather than written whole. */
const MAX_BYTES = 512 * 1024;
/** Viewer windows show the file name in their title, so a name longer than this is a worse UX than a cut. */
const NAME_MAX = 64;
/** How long a handed-over file may sit in the temp folder before the next handoff cleans it up. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Make ONE file name out of whatever the caller suggested: no directory part (a message's first line is
 * user-controlled text, and `..\\..\\x` must not become a path), no characters Windows refuses, CJK and
 * spaces kept, `.md` added by us so nothing else can be written.
 */
function viewerFileName(suggested, fallback = 'message') {
  const base = String(suggested == null ? '' : suggested)
    .replace(/\s+/g, ' ')
    // the characters Windows refuses in a name; `#` and `+` are legal there and carry meaning in a
    // title, and a separator here is the traversal attempt
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    // leading dots or spaces would make the name look like a navigation attempt (or hide it in Explorer)
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, NAME_MAX)
    // a name may not END in a dot or a space either: Windows drops those silently, so the file the
    // viewer is handed is not the file it can find
    .replace(/[.\s]+$/, '')
    .trim();
  const safe = /^\.+$/.test(base) ? '' : base; // `...` is not a name, it is a navigation attempt
  return `${safe || fallback}.md`;
}

/** `- 2`, `- 3` ... before the extension: opening a second message with the same title must not reuse a file. */
/**
 * A name in the folder that is not taken. Two answers with the same title (or the same message
 * opened twice) must not collide, or the viewer shows a stale copy of a different answer.
 *
 * The stamp path keeps the attempt counter: Date.now() alone can repeat inside the same millisecond,
 * and a repeated name here silently overwrites the file the previous viewer window is reading.
 */
function uniqueName(dir, name, existsSync) {
  if (!existsSync(path.join(dir, name))) return name;
  const stem = name.slice(0, -3);
  for (let attempt = 2; attempt <= 40; attempt++) {
    const plain = `${stem}-${attempt}.md`;
    if (!existsSync(path.join(dir, plain))) return plain;
  }
  const stamp = Date.now().toString(36);
  for (let attempt = 41; attempt <= 80; attempt++) {
    const marked = `${stem}-${stamp}-${attempt}.md`;
    if (!existsSync(path.join(dir, marked))) return marked;
  }
  return `message-${stamp}-${process.pid}.md`; // a name this folder cannot already hold
}

/**
 * Drop handoff files older than keepMs. The viewer keeps them open, so deletion is best-effort and the
 * age is measured from the mtime; a file still in use simply survives the attempt.
 */
function pruneOld(dir, { keepMs = KEEP_MS, now = Date.now(), existsSync = fs.existsSync, statSync = fs.statSync, unlinkSync = fs.unlinkSync } = {}) {
  if (!existsSync(dir)) return { removed: 0, kept: 0 };
  let removed = 0;
  let kept = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { removed: 0, kept: 0 };
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const full = path.join(dir, entry);
    let stat = null;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (now - stat.mtimeMs <= keepMs) {
      kept++;
      continue;
    }
    try {
      unlinkSync(full);
      removed++;
    } catch {
      // the viewer still has it open, or another process does: the next handoff tries again
      kept++;
    }
  }
  return { removed, kept };
}

/**
 * Write the document into the app's own handoff folder. The directory is not chosen by the caller's text,
 * only the name inside it, and that name is sanitised.
 */
function writeDocument({ dir, name, text, capBytes = MAX_BYTES, keepMs = KEEP_MS, now = Date.now() } = {}) {
  if (!dir) return { ok: false, error: 'no handoff folder' };
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'nothing to open' };
  let body = text;
  let truncated = false;
  if (Buffer.byteLength(body, 'utf8') > capBytes) {
    body = Buffer.from(body, 'utf8').subarray(0, capBytes).toString('utf8');
    // cutting at a byte boundary can split a multi-byte character; the replacement char it leaves is noise
    if (body.endsWith('\uFFFD')) body = body.slice(0, -1);
    truncated = true;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    pruneOld(dir, { keepMs, now });
    const file = path.join(dir, uniqueName(dir, viewerFileName(name), (target) => fs.existsSync(target)));
    fs.writeFileSync(file, `${body}\n`, 'utf8');
    return { ok: true, path: file, bytes: Buffer.byteLength(body, 'utf8'), truncated };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Which program opens the file: the settings entry first, then the environment, then the OS default for
 * .md. A configured path that does not exist is REPORTED rather than quietly ignored - a viewer that was
 * moved or renamed is exactly the case where "it opened Notepad instead" reads like a mystery.
 */
function resolveViewer({ setting, env, exists = () => false } = {}) {
  const candidates = [
    { from: 'markdownViewerPath', value: setting },
    { from: 'STRATAPILOT_MD_VIEWER', value: env },
  ];
  for (const candidate of candidates) {
    const value = String(candidate.value == null ? '' : candidate.value).trim();
    if (!value) continue;
    if (!exists(value)) return { kind: 'missing', path: value, from: candidate.from };
    return { kind: 'exe', path: value, from: candidate.from };
  }
  return { kind: 'default' };
}

module.exports = {
  viewerFileName,
  uniqueName,
  pruneOld,
  writeDocument,
  resolveViewer,
  MAX_BYTES,
  NAME_MAX,
  KEEP_MS,
};
