'use strict';

/*
 * D10: the language layer (English / 繁體中文 / 简体中文).
 *
 * The English source string is the key, so the catalogs are a plain { english: translation } map and a
 * missing entry falls back to English instead of breaking. That convenience is only safe if the catalogs
 * are kept in step with the code, which is exactly what these tests enforce:
 *
 *   - every string the code asks for exists in every catalog (the same extraction `npm run i18n` uses),
 *   - every translation keeps the same {placeholders} as its key (a dropped placeholder silently prints
 *     "{n}" in the UI, and an invented one prints "undefined"),
 *   - nothing is "translated" to the English text unless it is on the leave-English list,
 *   - the packaged app ships the catalogs (a missing locales/** in build.files means the installed app
 *     quietly loses Chinese - the kind of bug that only appears for the users who need it).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const i18n = require(path.join('..', 'renderer', 'i18n.js'));
const { collect, CATALOGS } = require(path.join('..', 'scripts', 'i18n-extract.js'));

const ROOT = path.join(__dirname, '..');

function catalog(lang) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${lang}.json`), 'utf8'));
}

/** Entries deliberately left in English: brand marks, hardware abbreviations and the in / out token labels. */
const LEAVE_ENGLISH = new Set([
  'CPU',
  'DevTools',
  'GPU',
  'PCIe',
  'Pilot',
  'Strata',
  'StrataPilot',
  'VRAM',
  'bash',
  'in {in} / out {out}',
  'in {n}',
  'in',
  'out {n}',
  'out',
  'tok',

  '?' // a bare question mark is the same in every language,
  // and the toast that uses it is a placeholder for an unknown model name
]);

/* ---- language resolution ---- */

test('auto follows the OS locale, splitting Traditional from Simplified', () => {
  assert.equal(i18n.resolveLanguage('auto', 'zh-TW'), 'zh-TW');
  assert.equal(i18n.resolveLanguage('auto', 'zh-Hant'), 'zh-TW');
  assert.equal(i18n.resolveLanguage('auto', 'zh-HK'), 'zh-TW');
  assert.equal(i18n.resolveLanguage('auto', 'zh-CN'), 'zh-CN');
  assert.equal(i18n.resolveLanguage('auto', 'zh-Hans-CN'), 'zh-CN');
  assert.equal(i18n.resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(i18n.resolveLanguage('auto', 'fr-FR'), 'en'); // an unsupported system language is English
  assert.equal(i18n.resolveLanguage('auto', ''), 'en');
  assert.equal(i18n.resolveLanguage('auto', undefined), 'en');
});

test('an explicit choice beats the system, including choosing English', () => {
  assert.equal(i18n.resolveLanguage('zh-TW', 'en-US'), 'zh-TW');
  assert.equal(i18n.resolveLanguage('zh-CN', 'zh-TW'), 'zh-CN');
  assert.equal(i18n.resolveLanguage('en', 'zh-TW'), 'en');
  assert.equal(i18n.resolveLanguage('zh-tw', 'en'), 'zh-TW'); // case does not matter
  assert.equal(i18n.resolveLanguage('zh_TW', 'en'), 'zh-TW'); // nor does the separator
});

test('normalizeLang maps the codes Electron and the browser hand out', () => {
  assert.equal(i18n.normalizeLang('zh_Hant_HK'), 'zh-TW');
  assert.equal(i18n.normalizeLang('zh-SG'), 'zh-CN');
  assert.equal(i18n.normalizeLang('en-GB'), 'en');
  assert.equal(i18n.normalizeLang('de'), null);
  assert.equal(i18n.normalizeLang(null), null);
});

/* ---- the translator ---- */

test('a string with no entry stays English rather than going blank', () => {
  const t = i18n.makeT({ Save: '儲存' }, 'zh-TW');
  assert.equal(t.t('Save'), '儲存');
  assert.equal(t.t('a brand new label'), 'a brand new label');
  assert.equal(t.has('Save'), true);
  assert.equal(t.has('a brand new label'), false);
});

test('an empty translation is ignored, so a half-filled catalog falls back instead of showing nothing', () => {
  const t = i18n.makeT({ Save: '', Cancel: '   ', Close: '關閉' }, 'zh-TW');
  assert.equal(t.t('Save'), 'Save');
  assert.equal(t.t('Cancel'), 'Cancel');
  assert.equal(t.t('Close'), '關閉');
  assert.equal(t.size, 1);
});

test('{placeholders} are filled from the params, and an unknown one is left visible', () => {
  const t = i18n.makeT(null, 'en');
  assert.equal(t.t('{shown} / {total} sessions', { shown: 4, total: 9 }), '4 / 9 sessions');
  assert.equal(t.t('ledger: {path}', { path: 'C:\\x\\token_usage.json' }), 'ledger: C:\\x\\token_usage.json');
  assert.equal(t.t('queue position {n} of {total}', { n: 1 }), 'queue position 1 of {total}');
  assert.equal(t.t('no params here {n}'), 'no params here {n}');
});

test('the English translator still interpolates, which is what the extracted-function tests rely on', () => {
  const t = i18n.makeT(null, 'en');
  assert.equal(t.t('queued, {n} pending', { n: 2 }), 'queued, 2 pending');
  assert.equal(t.lang, 'en');
  assert.equal(t.size, 0);
});

/* ---- catalog integrity ---- */

test('every string the code asks for has an entry in every catalog', () => {
  const keys = [...collect()];
  assert.ok(keys.length > 300, `expected hundreds of UI strings, found ${keys.length} - did the extraction break?`);
  for (const lang of CATALOGS) {
    const table = catalog(lang);
    const missing = keys.filter((key) => typeof table[key] !== 'string' || !table[key].trim());
    assert.deepEqual(
      missing,
      [],
      `${lang} is missing ${missing.length} entry/entries, first few: ${missing.slice(0, 5).map((k) => JSON.stringify(k.slice(0, 60))).join(', ')}`,
    );
  }
});

test('no catalog carries an entry the code never asks for (a stale key is a translation nobody sees)', () => {
  const keys = new Set(collect());
  for (const lang of CATALOGS) {
    const stale = Object.keys(catalog(lang)).filter((key) => !keys.has(key));
    assert.deepEqual(stale, [], `${lang} has stale entries: ${stale.slice(0, 5).join(', ')}`);
  }
});

test('every translation keeps exactly the {placeholders} of its key', () => {
  for (const lang of CATALOGS) {
    for (const [key, value] of Object.entries(catalog(lang))) {
      const want = i18n.tokensOf(key).sort();
      const got = i18n.tokensOf(value).sort();
      assert.deepEqual(got, want, `${lang}: ${JSON.stringify(key)} -> ${JSON.stringify(value)} changes the placeholders`);
    }
  }
});

test('keys stay English and values are real translations (unless deliberately left alone)', () => {
  for (const lang of CATALOGS) {
    for (const [key, value] of Object.entries(catalog(lang))) {
      assert.ok(!/[\u3400-\u9fff]/.test(key), `key is not English: ${JSON.stringify(key)}`);
      if (value === key) {
        assert.ok(LEAVE_ENGLISH.has(key), `${lang}: ${JSON.stringify(key)} is "translated" to itself but is not on the leave-English list`);
      }
    }
  }
});

test('the leave-English list only names entries that really are identical', () => {
  for (const lang of CATALOGS) {
    const table = catalog(lang);
    for (const key of LEAVE_ENGLISH) {
      assert.ok(Object.prototype.hasOwnProperty.call(table, key), `${lang} has no entry for ${key}`);
      assert.equal(table[key], key, `${lang}: ${key} is on the leave-English list but was translated`);
    }
  }
});

test('a catalog is valid UTF-8 JSON with no BOM and no duplicate keys lost', () => {
  for (const lang of CATALOGS) {
    const raw = fs.readFileSync(path.join(ROOT, 'locales', `${lang}.json`));
    assert.ok(raw[0] !== 0xef, `${lang}.json starts with a BOM, which JSON.parse keeps as \ufeff`);
    const text = raw.toString('utf8');
    const parsed = JSON.parse(text);
    const keyCount = (text.match(/^ {2}"/gm) || []).length;
    assert.equal(Object.keys(parsed).length, keyCount, `${lang}.json has duplicate keys`);
  }
});

/* ---- packaging and wiring ---- */

test('the packaged app ships the catalogs (an installed app must not lose Chinese)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok((pkg.build.files || []).includes('locales/**'), 'build.files must include "locales/**"');
});

test('the renderer loads i18n.js before app.js, and only one i18n core exists', () => {
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  const i18nAt = html.indexOf('src="i18n.js"');
  const appAt = html.indexOf('src="app.js"');
  assert.notEqual(i18nAt, -1, 'index.html does not load i18n.js');
  assert.ok(i18nAt < appAt, 'i18n.js must load before app.js');
  assert.ok(fs.existsSync(path.join(ROOT, 'renderer', 'i18n.js')), 'renderer/i18n.js is the shared core');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  assert.match(main, /require\('\.\/renderer\/i18n'\)/, 'main.js must use the same core, not a second implementation');
});

test('the language setting is saved through main and the catalog is handed over by IPC', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('i18n:get'/);
  assert.match(main, /ipcMain\.handle\('i18n:set'/);
  assert.match(preload, /i18nGet: \(\) => ipcRenderer\.invoke\('i18n:get'\)/);
  assert.match(preload, /i18nSet: \(language\) => ipcRenderer\.invoke\('i18n:set', \{ language \}\)/);
});

test('the static chrome is walked once per language change, with the dynamic parts skipped', () => {
  // the transcript, the dialogs and the lists are built by app.js with tr(); translating them again
  // from the DOM walk would fight with the renderers
  const core = fs.readFileSync(path.join(ROOT, 'renderer', 'i18n.js'), 'utf8');
  for (const skip of ['.transcript', '#modalRoot', '#toasts', '.session-list', '.side-foot']) {
    assert.ok(i18n.SKIP_SELECTOR.includes(skip), `SKIP_SELECTOR must skip ${skip}`);
  }
  assert.match(core, /applyDom\(rootEl, t, options\)/);
});

test('transcript notes are catalog keys, not interpolated strings (#45)', () => {
  const app = ['app.js', 'transcript.js', 'composer.js', 'storage.js', 'settings.js', 'tree.js', 'modals.js', 'monitor.js', 'chrome.js']
    .map((f) => fs.readFileSync(path.join(ROOT, 'renderer', f), 'utf8'))
    .join(String.fromCharCode(10));
  // pushNote() translates its text argument, so a template literal there can never be looked up: the
  // note would read correctly in English and stay English forever for a Chinese user. 30 of them used
  // to be exactly that.
  const templates = [...app.matchAll(/pushNote\(\s*\w+,\s*`/g)];
  assert.deepEqual(templates.map((m) => m[0]), [], 'pass a {placeholder} key plus the values instead of a template literal');
  const calls = (app.match(/pushNote\(/g) || []).length;
  assert.ok(calls >= 25, `the transcript notes are expected to go through pushNote, found ${calls} call sites`);
  // and the translation itself lives in one place, not in 30 call sites
  assert.match(app, /text: tokens \? tr\(text, tokens\) : tr\(text\)/);
});
