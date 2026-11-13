'use strict';

/*
 * What a `Ctrl+V` is worth attaching (#61) - kept out of app.js so it can be tested without a window.
 *
 * `clipboardData.files` being non-empty does NOT mean "the user copied a file". Chromium puts an entry
 * there for every *rendering* the clipboard carries as well: a screenshot (CF_DIB on Windows: no name
 * worth having, no path), the picture a browser hands over on "Copy image", and - the case this file
 * exists for - the bitmap that Word, PowerPoint, Acrobat and Excel write **next to the text** of a
 * selection (Excel does it for every cell copy, so that Word's "Paste as picture" works there).
 * Measured on Windows with the Electron 40 this repo pins: the clipboard was filled with raw Win32
 * `SetClipboardData` (and with `webContents.copy()` / `copyImageAt()`), then pasted into a `<textarea>`
 * with `webContents.paste()`:
 *
 *   clipboard                      paste event
 *   ----------------------------   ---------------------------------------------------------
 *   CF_UNICODETEXT + CF_DIB        types ["text/plain","Files"]  files [image.png 286 B path ""]
 *                                  text "hello from word"                    <-- the #61 shape
 *   CF_DIB alone (a screenshot)    types ["Files"]               files [image.png 286 B path ""]
 *                                  text ""
 *   copyImageAt (browser "Copy     types ["text/html","Files"]   files [image.png 286 B path ""]
 *   image")                        text ""
 *   a copied file (CF_HDROP)       types ["Files"]               files [the file - path resolves]
 *   a browser page copy            types ["text/plain","text/html"]  files []   text the selection
 *                                  (Chromium does not turn an HTML <img> into paste files at all)
 *
 * So the question is never "is there a file", it is "is that file only obtainable from the clipboard,
 * and is there text the composer can actually take". A clipboard rendering has **no filesystem path**
 * (`api.pathForFile()` -> `''`, the same probe `renderer/smoke.js` prints), a copied file has one, and
 * that is what tells the two apart.
 */

// File extension for a clipboard image that arrives without a name (see pasteName()).
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/tiff': 'tiff' };

/**
 * Decide what the paste means. `pathOf` is the caller's way to resolve a File to disk
 * (`api.pathForFile` in the app, a plain lookup in a test), because only the caller knows what the
 * platform can answer.
 *
 * Returns `{ action: 'attach' | 'text', reason, files }`:
 *
 *   no-files                     nothing but text; the browser's own paste does the job
 *   file-on-disk                 the clipboard carries a real file - a file copy from Explorer or VS
 *                                Code. That is what was copied, text on the clipboard or not.
 *   text-with-clipboard-image    a rendering plus prose (#61): the prose is the only thing a composer
 *                                can accept, and the bitmap is a *picture of that prose*, so the text
 *                                wins and the caller says out loud why no chip appeared.
 *   clipboard-image-only         a screenshot, or a browser's "Copy image": attach it, which is the
 *                                behaviour the 0.1 release documented.
 */
function pasteIntent(clipboardData, pathOf) {
  const files = pastedFiles(clipboardData);
  if (!files.length) return { action: 'text', reason: 'no-files', files };
  if (files.some((file) => !!pathOf(file))) return { action: 'attach', reason: 'file-on-disk', files };
  const text = String(typeof clipboardData.getData === 'function' ? clipboardData.getData('text/plain') || '' : '').trim();
  if (text) return { action: 'text', reason: 'text-with-clipboard-image', files };
  return { action: 'attach', reason: 'clipboard-image-only', files };
}

/** Files carried by a paste event: `files` first, `items` as a fallback for the
 *  (rare) case where only items is populated. */
function pastedFiles(clipboardData) {
  const out = [];
  for (const file of Array.from((clipboardData && clipboardData.files) || [])) {
    if (file) out.push(file);
  }
  if (!out.length) {
    for (const item of Array.from((clipboardData && clipboardData.items) || [])) {
      if (!item || item.kind !== 'file') continue;
      const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
      if (file) out.push(file);
    }
  }
  return out;
}

/* Clipboard images carry no filesystem path (api.pathForFile() returns ''), and Chromium names them
   "image.png" for every screenshot, so pastes get a name of their own: pasted-1.png, pasted-2.png, …
   (never clashing with an existing chip). */
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

if (typeof window !== 'undefined') {
  window.pasteIntent = pasteIntent;
  window.pastedFiles = pastedFiles;
  window.pasteName = pasteName;
}

// dual export: the browser gets the window.* assignments above (index.html loads this file as a plain
// <script> under CSP script-src 'self'); Node (unit tests) gets module.exports instead.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pasteIntent, pastedFiles, pasteName };
}
