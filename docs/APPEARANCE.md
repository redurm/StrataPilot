# Appearance, language and accessibility

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

## Theme (dark / light)

Pick it in **Settings ▸ Interface ▸ Theme**: `Dark` (the default), `Light`, or `Follow the system
theme` (keeps following `prefers-color-scheme` while the app runs).

| Thing | How |
|---|---|
| Storage | the `theme` key in the settings file - nothing else is touched |
| Implementation | every colour in `styles.css` goes through a CSS variable, so a theme is only a redefinition of those variables (`[data-theme="light"]`); there is no second stylesheet and no duplicated rule |
| No flash on start | the last applied theme is mirrored in `localStorage` and read by `renderer/theme-boot.js` before the first paint; the real setting (including `system`) is applied a moment later from the settings file |
| Screenshots | `STRATAPILOT_SMOKE_THEME=1` switches theme, prints the computed colours and writes both screenshots to the temp folder (the smoke scenarios are listed in [DEVELOP.md](DEVELOP.md#smoke-mode-for-development)) |

## Language (English / 繁體中文 / 简体中文)

Pick it in **Settings ▸ Interface ▸ Language**: `Auto (follow the system language)` (the default),
`English`, `繁體中文` or `简体中文`. The list shows each language in its own script, so it stays readable
whatever the interface currently says. Changing it takes effect immediately - no restart, no reload.

| Thing | How |
|---|---|
| Storage | the `language` key in the settings file (`auto` / `en` / `zh-TW` / `zh-CN`) |
| Catalogs | `locales/zh-TW.json` and `locales/zh-CN.json` - a flat `{ english: translation }` map, 444 entries each, kept in step by `npm run i18n` and `test/i18n.test.js` |
| Keys | the **English source string is the key** (`tr('New session')`), so a missing translation falls back to English instead of showing a blank or a `[[key]]` |
| `auto` | `zh-Hant` / `zh-HK` / `zh-MO` → `zh-TW`, `zh-Hans` / `zh-CN` / `zh-SG` → `zh-CN`, anything else → `en`; an explicit choice always beats the OS, including choosing English on a Chinese system |
| Static chrome | `I18N.applyDom()` walks `index.html` once per language change (text nodes, `title`, `placeholder`, `aria-label`) and skips the parts `app.js` renders itself - the transcript, the session and queue lists, the dialogs, the toasts, the footer |
| Dynamic chrome | the strings are wrapped in `tr()` and the renderers are re-run (`rerenderChrome()`): tabs, composer, stats, bars, Monitor cards and pills, session list, storage, usage, the slash menu, the empty hints |
| Native menu | rebuilt in main with the same catalog - one shared core (`renderer/i18n.js`, required by `main.js`) so there is no second implementation. Electron 40 has no `app.setLocale`, so the few Electron role items (**Quit**, **Zoom In**…) carry explicit translated labels, and `--lang` is set before ready for Chromium's own locale |
| Fonts | `--sans` gains CJK fallbacks, and `html[lang="zh-TW"]` / `html[lang="zh-CN"]` pick the Traditional or Simplified face, so a Simplified user does not get Traditional glyph forms (and vice versa) |
| Deliberately English | pi's own answers, the log file, the diagnostics report, session titles and message text, model / thinking values, device names and units (`NVIDIA GeForce RTX`, `MB/s`, `Gen5`), and the `in` / `out` token labels - they are data or protocol, not interface |
| Proof | `STRATAPILOT_SMOKE_I18N=1` drives the Settings dialog itself (dropdown + **Save**), checks the visible text really changes in both Chinese catalogs and comes back, and writes two screenshots; `npm test` checks every key the code asks for exists, that no translation changes a `{placeholder}`, and that `locales/**` is packaged |

Adding or fixing a string: wrap it in `tr('English source')` (or `i18nKey('label')` when it lives in a
table and is translated later at render time), then `npm run i18n:missing` prints exactly what the
catalogs still need. `npm run i18n:unwrapped` lists English strings that are not wrapped yet.

## Accessibility

The app was built without any, so D3 added it centrally instead of touching every widget:

| What | How |
|---|---|
| Dialogs | anything appended to `#modalRoot` is decorated by an observer: `role="dialog"`, `aria-modal`, a label taken from its own heading, focus moved inside, `Tab` wrapped at both ends, `Esc` mapped to its Cancel / Close button, and focus handed back to the control that opened it |
| Icon-only buttons | a button whose visible text is empty or a single glyph (the `x` of a tab, the `top` arrow, ...) gets its accessible name from the `title` it already carries; the observer only looks at the nodes that were actually added, so streaming is not slowed down |
| Queue rows | focusable (`tabIndex`), `role="button"`, and an `aria-label` that says what the colour says: `Halo Code review, queued, 2 pending, queue position 1 of 3. Alt+Up or Alt+Down reorders it.` |
| Regions | `role="tablist"` on the tab strip (`aria-selected` per tab), `role="list"` on both sidebar lists, `role="log"` on the transcript, `role="status"` + `aria-live="polite"` on the toast area, labels on the search box, the model / thinking selects and the composer |
| Focus and motion | `:focus-visible` outlines (visible for keyboard, not for mouse clicks) and a `prefers-reduced-motion` block that stops the streaming animations |

`STRATAPILOT_SMOKE_A11Y=1` proves it: it opens Settings and checks the role, the label, focus moving
in, `Tab` wrapping, `Esc` closing and focus coming back, then counts the buttons a screen reader would
not name (`nameless_buttons=0`). It also borrows the `running` flag for one render so the queue shows a
working row - the row that carries a queue position, and the one a plain idle queue never renders.
