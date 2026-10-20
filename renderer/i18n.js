/*
  i18n core - shared by the main process (require) and the renderer (plain script tag, CSP 'self').

  The English source string IS the key: tr('New session') looks the string up in the active catalog and
  falls back to English when there is no entry, so a missing translation is a visible English word rather
  than a blank label or a crash. That also means adding a string to the UI cannot break another language,
  and the catalogs stay readable ("what does this button say in Chinese?" is one grep away).

  Catalogs live in locales/<lang>.json and are read by the main process only; the renderer gets the parsed
  object over IPC (preload -> api.i18nGet), so there is one copy of each translation and no fetch/CSP change.

  Placeholders are {braces}: tr('{n} of {total} files', { n: 2, total: 7 }). test/i18n.test.js fails if a
  translation drops, renames or invents a placeholder, which is the usual way half-translated strings rot.
*/

(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.StrataPilotI18n = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LANGS = ['en', 'zh-TW', 'zh-CN'];
  const PREFS = ['auto'].concat(LANGS);
  const LANG_LABELS = { en: 'English', 'zh-TW': '繁體中文', 'zh-CN': '简体中文' };

  // zh-Hant / zh-HK / zh-MO -> Traditional, zh-Hans / zh-SG -> Simplified. Anything else -> English.
  function normalizeLang(code) {
    if (!code) return null;
    const c = String(code).replace(/_/g, '-').toLowerCase();
    if (c === 'zh' || c.startsWith('zh-hant') || c === 'zh-tw' || c === 'zh-hk' || c === 'zh-mo') return 'zh-TW';
    if (c.startsWith('zh-hans') || c === 'zh-cn' || c === 'zh-sg' || c === 'zh-my') return 'zh-CN';
    if (c.startsWith('en')) return 'en';
    return null;
  }

  // pref: 'auto' | 'en' | 'zh-TW' | 'zh-CN'. systemLocale: app.getLocale() / navigator.language.
  function resolveLanguage(pref, systemLocale) {
    if (pref && pref !== 'auto') {
      const exact = LANGS.find((l) => String(l).toLowerCase() === String(pref).toLowerCase());
      if (exact) return exact;
      const byNormal = normalizeLang(pref);
      if (byNormal) return byNormal;
    }
    return normalizeLang(systemLocale) || 'en';
  }

  const TOKEN_RE = /\{([a-zA-Z0-9_]+)\}/g;

  function tokensOf(text) {
    const out = [];
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(String(text)))) out.push(m[1]);
    return out;
  }

  function fill(text, params) {
    if (!params) return text;
    return String(text).replace(TOKEN_RE, (whole, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
    );
  }

  /*
   * makeT(catalog) -> { lang, t(text, params), has(text), size }
   * The catalog is a plain { english: translation } object; empty translations are ignored so a half
   * filled catalog falls back instead of showing nothing.
   */
  function makeT(catalog, lang) {
    const map = new Map();
    if (catalog) {
      for (const key of Object.keys(catalog)) {
        const value = catalog[key];
        if (typeof value === 'string' && value.trim()) map.set(key, value);
      }
    }
    return {
      lang: lang || 'en',
      size: map.size,
      has(text) {
        return map.has(String(text));
      },
      t(text, params) {
        const key = String(text);
        const hit = map.get(key);
        return fill(hit === undefined ? key : hit, params);
      },
    };
  }

  // The renderer walks the static HTML once per language change. Dynamic parts are built with t() in app.js.
  const DOM_ATTRS = ['title', 'placeholder', 'aria-label'];
  const SKIP_SELECTOR = [
    '.transcript',
    '#modalRoot',
    '#toasts',
    '.slash-menu',
    '.session-list',
    '.queue-list',
    '.tabs',
    '.side-foot',
    '.stats',
    '.env',
    '.ext-widgets',
    '.attachments',
    '.mon-servers',
    '.mon-grid',
    '.mon-reqs tbody',
    '.now-bar',
    '.queue-bar',
    '.mon-state-detail',
    '.mon-totals',
  ].join(', ');

  function inSkip(el, skipNodes) {
    let node = el;
    while (node) {
      if (skipNodes.has(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /*
   * applyDom(rootEl, t) - translate the static chrome. The original English is remembered per node /
   * attribute, so switching zh-TW -> zh-CN -> en restores the source text instead of translating a
   * translation. Returns how many strings changed, which the smoke asserts on.
   */
  function applyDom(rootEl, t, options) {
    if (typeof document === 'undefined' || !rootEl) return 0;
    const opts = options || {};
    const attrs = opts.attrs || DOM_ATTRS;
    const skipSelector = opts.skip === undefined ? SKIP_SELECTOR : opts.skip;
    const skipNodes = skipSelector
      ? new Set(Array.from(rootEl.querySelectorAll(skipSelector)))
      : new Set();
    if (!rootEl.__i18nOrigText) rootEl.__i18nOrigText = new Map();
    const store = rootEl.__i18nOrigText;
    let changed = 0;

    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (inSkip(node.parentElement, skipNodes)) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement && node.parentElement.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);
    for (const node of textNodes) {
      const original = store.has(node) ? store.get(node) : node.nodeValue;
      if (!store.has(node)) store.set(node, node.nodeValue);
      const lead = original.slice(0, original.length - original.trimStart().length);
      const trail = original.slice(original.trimEnd().length);
      const key = original.trim();
      if (!key) continue;
      const next = lead + t.t(key) + trail;
      if (next !== node.nodeValue) {
        node.nodeValue = next;
        changed += 1;
      }
    }

    const allEls = Array.from(rootEl.querySelectorAll('[' + attrs.join('],[') + ']'));
    if (rootEl.getAttribute && attrs.some((a) => rootEl.hasAttribute(a))) allEls.push(rootEl);
    for (const el of allEls) {
      if (inSkip(el, skipNodes)) continue;
      if (!el.__i18nOrigAttr) el.__i18nOrigAttr = {};
      for (const attr of attrs) {
        if (!el.hasAttribute(attr)) continue;
        const original = el.__i18nOrigAttr[attr] === undefined ? el.getAttribute(attr) : el.__i18nOrigAttr[attr];
        if (el.__i18nOrigAttr[attr] === undefined) el.__i18nOrigAttr[attr] = el.getAttribute(attr);
        const key = String(original).trim();
        if (!key) continue;
        const next = t.t(key);
        if (next !== el.getAttribute(attr)) {
          el.setAttribute(attr, next);
          changed += 1;
        }
      }
    }
    return changed;
  }

  return {
    LANGS,
    PREFS,
    LANG_LABELS,
    normalizeLang,
    resolveLanguage,
    makeT,
    tokensOf,
    fill,
    applyDom,
    DOM_ATTRS,
    SKIP_SELECTOR,
  };
});
