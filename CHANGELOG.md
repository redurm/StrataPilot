# Changelog

All notable changes to **StrataPilot** (earlier **Pi on Strata**, earlier still **pi_gui**) are
documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version in `package.json` is the one
that is shipped (`0.x` while the app has no packaging/installer yet).

## [Unreleased]

### Added

- **Packaging** - `electron-builder` configuration (`npm run dist`, `dist:win`, `dist:mac`, `dist:linux`), an
  app icon (a π over three Strata layers, used by the window and the taskbar), and a `Release build`
  workflow that packages on all three platforms and then starts the packaged Windows build in smoke mode
  before uploading it. Windows gets an NSIS per-user installer plus a portable zip; nothing is code-signed.
- **First-run check** - the first run opens a wizard (`/setup`, Help, First-run check): it reports the pi it
  resolved (with the install command to copy and a re-check button when pi is missing), checks the Strata
  address against `/health` with the latency, and lets you pick the folder new tabs start in. It records
  `firstRunSeen` so it stays out of the way afterwards, and never installs anything by itself.
- **Cross-platform CI (C7)** - a new `electron smoke` job installs the Electron binary and pi and starts a
  real window on Linux (under `xvfb-run`, must pass) and macOS (`continue-on-error`), asserting the window
  opened, the env bar reported, and no renderer error was logged. The `pi install smoke` job now runs on
  both POSIX runners, and the README has a **Linux and macOS** section stating what is proven and what is
  not.
- **Session tree and branching** - the stats row gets a **tree** chip (and `/tree` works) opening the entry
  tree from pi's `get_tree`: the branch you are on highlighted, entries pi stopped following dimmed, branch
  and leaf markers. **jump** scrolls the transcript to an entry, **fork here** moves the session back to an
  earlier user prompt (append-only, nothing is deleted), **clone branch** duplicates it into a new session
  file. Everything goes through pi's RPC, so the GUI still never writes a session file.
- **`@` path completion in the composer** - typing `@` opens the palette with the contents of the
  session's working folder (one level at a time, listed by the background process, never above that
  folder; `node_modules`/`.git`/`dist`/... are hidden unless typed on purpose). `Up`/`Down` then
  `Enter` or `Tab` inserts the path, and picking a folder keeps the menu open for the next level.
- **Several Strata servers in the Monitor** - a pill per address (`active tab`, every known server,
  `+ add server`, `x` to remove). Clicking one points the cards at that server, and each watched address
  carries its own `/health` dot (green with latency, red with the error), polled every 4 seconds. Extra
  addresses live in the new `strataUrls` setting.
- **Session storage dialog** - the sidebar footer now shows what the sessions folder costs
  (`Storage: 8.2 MB in 15 files`); clicking it lists every working-folder group by size and offers two
  cleanup rules (age, or keep the N newest per folder) with a mandatory preview and a second
  confirmation. A session that is open in a tab is filtered out by the main process, paths outside the
  sessions folder are refused, and a bulk delete invalidates the metadata cache in one pass.
- **Token usage ledger and chart** - the sidebar footer gained a second chip (`Usage: 41.3M tok`) and
  **Usage** (`/usage`) opens a stacked column chart of **in / out / cache read / cache write** per
  **day / week / month / year** over the last 7 / 30 / 90 / 365 days or everything, with the per-model
  breakdown under it. pi already writes usage per message, but only into the session file - so a storage
  cleanup deleted the history along with it. `lib/usage-ledger.js` keeps its own rollup in
  `%APPDATA%\StrataPilot\token_usage.json`: one entry per session file (keyed by the file *name*, which
  embeds the session uuid, so moving a session to another folder group keeps its history instead of
  double counting), day buckets, and the same `(mtime, size)` stamp cache as the session list so an
  unchanged file is never opened again. Because cache reads dwarf everything else (39.9M against 1.0M
  real prompt reads here), a checkbox takes cache out of the stack so in / out can be compared. The
  chart is inline SVG - no dependency, no CSP change.
  The ledger's rule is that **tokens are never written off**: day buckets are only ever added to, so a
  session file being rewritten (`SessionManager._rewriteFile()` reopens it with `"w"`) or truncated
  cannot subtract what was banked, and a watermark (`countedCount` + `lastRecordId`) makes the re-scan
  add only records it has not seen. Every usage-bearing entry is counted, not just replies: pi stamps
  usage on `message`, `usage`, **`compaction`** and **`branch_summary`**, and those summaries are real
  model calls (one compaction here cost 72,124 tokens by itself), so compacting and switching branches
  are charged for what they spend. Forks and clones are deduplicated by entry id, because pi copies the
  parent's entries verbatim - ids included - into the new file; a fork whose parent file is already gone
  is reported rather than quietly double counted. Deleted sessions stay in the chart until **Recount
  from files** (which asks first - it is the one action that can lower the totals); buckets older than
  3 years are pruned; a session over the 12 MB scan cap is reported rather than silently undercounted.
  33 unit tests on a temp sessions root - including "a rewritten session file cannot write off banked
  tokens", "a compaction entry's usage is counted" and "a fork's copied entries are not counted twice"
  - plus `STRATAPILOT_SMOKE_USAGE=1` (read-only for sessions, three screenshots). The **Diagnostics**
  report now carries the ledger summary (totals, how many calls were compaction / branch summaries, and
  the deleted-session / scan-cap / fork-dedup flags), so a "the numbers look wrong" ticket arrives with
  the data attached.
- **What it costs** (same dialog): Strata reports no prices - pi's `usage.cost` is `0` for every call
  here - so the Usage dialog carries a **rate table**: **USD per 1,000,000 tokens**, one row per model
  plus a **default rate** row, saved into `usagePrices` in the settings file as soon as a box loses
  focus. Picking **cost (USD)** turns the columns into money, split into the same four stacked parts and
  rescaled; the totals line spells the sum out (`$6.91 = $1.17 in + $0.99 out + $4.75 cache read + $0
  cache write`), each model row shows its own money, and the sidebar chip gains the total. The ledger
  keeps storing only token counts, so changing a rate re-prices every past day instantly and never
  rewrites what was banked. `test/usage-cost.test.js` (11 tests) covers rate lookup (bare model id vs
  provider-qualified, both directions), per-model pricing, the four priced fields adding up to the priced
  total, and `$0` instead of `NaN` when no rates are set. A model row is a **patch** over the default row
  - filling in only `in` does not make that model's output and cache free - and an all-empty model row is
  not stored at all (`pruneRateRows()`), so it keeps falling back to the default instead of quietly making
  that model free; each box's placeholder shows the value that currently applies. The **Diagnostics**
  report carries the rates as well (`ledger rates` with the default row, `rate rows` with every model row
  that has one), or says plainly that no rates were entered.
- Fixed on the way: `.modal input { width: 100% }` stretched every checkbox in a dialog across its row -
  the Usage dialog's cache toggle showed up as a stray white square with its label 300px away. `.field-row
  input[type="checkbox"]` now gets `width: auto`, the way `.set-check` already did.
- **Fixed: the Usage total needed an app restart to move.** The ledger was only re-scanned at startup and
  when a pi process exited, so a session that was still running never showed up in the footer chip. Now a
  settled run, a compaction, the window regaining focus, a storage cleanup and a process exit all refresh
  it: the renderer pulls a fresh summary 1.5 s after the settle (the chip follows, and an open dialog is
  redrawn only when the numbers actually moved, so hovering a column is not yanked away), and the main
  process re-scans 2.5 s later so the ledger file on disk is current for the diagnostics report too. It
  logs `[usage-live] ledger total X → Y` when that happens. Proven end to end against a throwaway
  sessions root with records being appended while the app ran:
  `[usage-live] ledger total 100378346 → 100448046` and `chip_before="Usage: 100.36M tok" chip_after="Usage: 100.38M tok"`.
  A unit test covers the ledger half: a session file that is still being written is picked up by the next
  refresh with every record counted exactly once, and an idle refresh re-reads nothing.
- **Accessibility pass** - dialogs are now real dialogs (`role="dialog"`, labelled by their heading,
  focus moved in, `Tab` wrapped, `Esc` closing through the Cancel button, focus returned to the
  opener), icon-only buttons get an accessible name from their `title`, queue rows are focusable and
  describe their state in words (`queued, 2 pending, queue position 1 of 3`), the tab strip / lists /
  transcript / toasts carry roles and live regions, keyboard focus is visible (`:focus-visible`) and
  the animations stop under `prefers-reduced-motion`. Checked by
  `PI_ON_STRATA_SMOKE_A11Y=1`.
- **Light theme** - Settings, Theme: `Dark` (default), `Light`, or follow the system theme. Every
  colour in `styles.css` now goes through a variable, so the light theme is one variable block
  (`[data-theme="light"]`) rather than a second stylesheet, and `renderer/theme-boot.js` mirrors the
  last theme in `localStorage` so a light start does not flash dark. `PI_ON_STRATA_SMOKE_THEME=1`
  checks the computed colours and writes a screenshot of each theme.
- **Smoke-only screenshot hook** (`app:smoke-shot`, registered only when `PI_ON_STRATA_SMOKE` is set)
  so a scenario can prove what the interface actually looks like.
- **Tab strip shows the model** each tab is on (plus the thinking level when it is not the default),
  next to the queue position and outbox count.
- **Restart button** for a tab whose pi process died - the draft in the editor survives, instead of
  the old "press Send to restart" hint.
- **Keyboard queue reordering** - `Alt+Up` / `Alt+Down` moves the active session in the serial queue,
  and a focused queue row answers to plain `Up` / `Down` (rows are focusable now).
- **Scheduled prompts (cron)** - `/jobs` or Settings, Manage scheduled jobs: 5-field cron jobs
  (`minute hour day month weekday`, local time) stored in the settings file and armed by the
  background process. A due job never sends anything itself: it emits `cron:fire` and the renderer
  queues the prompt into the target session's outbox, so the serial queue stays the only sender.
  Targets `new-tab` (ephemeral by default), `session:<path>` or `tab:<id>`; there is a **run now**
  button, runs missed while the machine slept are reported instead of replayed, and `powerMonitor
  resume` re-arms the schedule. Parser in `lib/cron.js`, no new dependency, 18 unit tests.

- **Diagnostics report** — topbar **Diagnostics** button, `/diagnostics`, and menu
  Help ▸ Copy Diagnostics: one pasteable block with versions and paths, the pi install, Strata
  `/health` and `/v1/models`, both model configurations, every open tab's queue state and the log
  tail, with keys redacted. The same text is saved under
  `%APPDATA%\Pi on Strata\diagnostics\`. (`lib/diagnostics.js`)
- **Settings dialog** — topbar **Settings**, `Ctrl+,`, `/settings`: working folder, serial queue,
  `restoreTabs`, fixed Strata address, Strata config path for the report, Monitor open/width and
  sidebar, plus one-click access to the settings file, the log file and the sessions folder. Nothing
  needs a hand edit of the JSON file any more.
- **Retry controls** — `auto-retry` checkbox per session (`set_auto_retry`), a **stop retry** button
  that only appears while a retry is sitting in its delay (`abort_retry`), and
  `/retry [on|off|stop]`. The `auto_retry_start` / `auto_retry_end` notes now also drive the composer.
- **Crash recovery** — a renderer crash, a >30 s hang or a failed page load now opens a dialog
  offering **Reload interface** instead of leaving a white window; tab ids are persisted, so a reload
  re-attaches to the pi processes that are still running instead of starting a second pi per session.
  A toast reports when the interface starts answering again by itself.
- **pi version guard** — the env bar shows the pi version first and turns amber (different minor) or
  red (different major, or pi not resolved) when it is not the version this GUI was tested against
  (`TESTED_PI_VERSION` in `lib/pi-launch.js`).
- **File logging** — everything the main process prints is mirrored to
  `%APPDATA%\Pi on Strata\logs\pi_on_strata.log` (rotates at ~2 MB, keeps two generations): startup
  banner, pi spawn/exit/stderr, `uncaughtException` / `unhandledRejection`, `child-process-gone`,
  `render-process-gone`, `unresponsive`, `did-fail-load`, `preload-error`, and renderer
  `error` / `unhandledrejection` forwarded from `renderer/error-report.js`. Menu
  Help ▸ Open Log Folder.
- **Paste an image with `Ctrl+V`** — a screenshot on the clipboard is attached exactly like a drag &
  drop (thumbnail chip, sent as RPC `images`); plain-text paste is untouched.
- **Per-message actions** — hovering a message reveals `copy` (raw markdown source of that message,
  never the rendered HTML) and, on user messages, `resend` (back through the normal Send path, so
  busy mode and the serial queue behave as for a typed message).
- **`/export [path]`** — save the session as HTML through pi's `export_html`; no argument opens the
  native Save dialog, an argument must be an absolute `*.html`.
- **Unit tests** — `npm test` runs `node --test` over the three hand-written parsers
  (`renderer/markdown.js`, `lib/sessions.js`, `lib/pi-process.js`), the log writer, the diagnostics
  report and the pi version guard, with no Electron, pi or Strata needed.

- **Session list cache** - `listSessions()` no longer re-parses every session file on every
  sidebar refresh: metadata is cached per file and only re-read when the file's `mtimeMs`/`size`
  changed (an 86 MB session used to be re-scanned after almost every message).

- **Windowed transcript** - opening a big session renders only the last 120 messages instead of
  building every node at once; `show 150 earlier` at the top pulls in older pages without moving the
  part you are looking at, and jumping to an older message renders the page that holds it.

- **The outbox survives a restart** - messages that were still queued when the app closed are
  stored in the settings file and come back as a **pending** badge (plus a transcript note). They are
  never sent on their own: the modal offers `queue it` / `queue all` / `drop`. Images are only stored
  while the whole outbox stays under ~400 KB, otherwise they are dropped and the note says so.

- **Interface language - English, 繁體中文, 简体中文** - **Settings ▸ Interface ▸ Language** (`/settings`)
  switches the whole interface while the app runs, no restart. `Auto (follow the system language)` is the
  default; `zh-Hant` / `zh-HK` / `zh-MO` resolve to `zh-TW`, `zh-Hans` / `zh-CN` / `zh-SG` to `zh-CN`, and
  an explicit choice always beats the OS. The English source string is the key (`tr('New session')`), so a
  missing entry falls back to English rather than printing a blank or a `[[key]]`; the catalogs are flat
  JSON maps (`locales/zh-TW.json`, `locales/zh-CN.json`, 444 entries each). Static chrome is translated by
  one DOM walk (`I18N.applyDom()` - text nodes plus `title` / `placeholder` / `aria-label`, skipping the
  regions `app.js` renders), dynamic chrome by wrapping the strings in `tr()` and re-running the renderers,
  and the native menu is rebuilt in the main process from the same catalog (`renderer/i18n.js` is required
  by `main.js`, so there is no second implementation). Electron 40 has no `app.setLocale`, so the handful of
  Electron role items (**Quit**, **Zoom In**, **Zoom Out**, **Reset Zoom**) carry explicit translated labels
  and `--lang` is set before ready for Chromium's own locale. `html[lang]` picks the Traditional or
  Simplified font fallback so a Simplified reader does not get Traditional glyph forms. Deliberately left
  English: pi's answers, the log file, the diagnostics report, session titles and message text, model and
  thinking values, device names and units. Helpers: `npm run i18n` (coverage), `npm run i18n:missing`
  (what the catalogs still need), `npm run i18n:unwrapped` (English strings not wrapped yet). Proven by
  `test/i18n.test.js` (every key the code asks for exists, no translation changes a `{placeholder}`, no
  entry is "translated" to itself unless it is on the leave-English list, `locales/**` is packaged) and by
  `STRATAPILOT_SMOKE_I18N=1`, which drives the Settings dialog itself and checks the visible text changes
  in both Chinese catalogs and comes back (`switched=true cjk=true monitor_translated=true restored=true`).

### Fixed

- **Sending a prompt broke the whole interface** (`TypeError: Cannot read properties of undefined
  (reading 'length')`) - the queue row's screen-reader text declared its status word in a local named
  `state`, which hid the module-level `state` object, so `state.order.length` read a property of a
  string. It threw on every row in the **Working** group, i.e. on the first prompt you send: the tab
  strip and the queue were left empty, the message was lost before it reached pi, and the stuck
  `running` flag made every later render throw as well. The status word is now `status`, and the row is
  told how many tabs are working so the label reads `queue position 1 of 3` (the working group, not the
  tab list). Covered by `test/queue-label.test.js` and by a working row in
  `PI_ON_STRATA_SMOKE_A11Y=1` (`working_row_label=...`); the two `get_state` results that were also
  called `state` were renamed for the same reason.
- **A tab that switched sessions is protected from the storage cleanup** - `switch_session` is an RPC the
  background process never sees, so the tab now reports its new session file (`pi:session-path`) and a
  cleanup can no longer delete the file a live process is writing to. The same reporting happens after
  a fork or clone, which may hand the process a different file.
- **The session tree was unreadable on a long session** - pi's tree is a chain (every entry's parent is the
  entry before it), and the view indented one level per entry. A 76-entry session was 76 levels deep:
  `8 + 76 * 14 = 1072px` of padding inside a 900px modal, so the row's content box collapsed, the text and
  the time column spilled over the edge, the time drifted further right the deeper the row was, and the list
  grew a horizontal scrollbar. The indent now grows one level per **branch point** instead of one per entry
  (a single child keeps its parent's level), capped at 12, so a session with no branch points renders as the
  flat list it is and the time column lines up again. The **branch you are on** marker moved from a
  `border-left` - which sits outside the indent, so it drew one unbroken stripe down the whole list, detached
  from the rows it marked - to a tick drawn at the row's own indent, stepping with the tree and breaking where
  the branch does. The list no longer scrolls sideways, and entry text is clipped by css alone with the full
  text on hover (the old js slice plus css ellipsis meant the js `…` was itself hidden). Covered by
  `test/tree-depth.test.js`.

- **Session titles came out garbled for CJK sessions** - `forEachLine()` in `lib/sessions.js` read session
  files in 256 KB chunks and decoded each chunk on its own (`buf.toString('utf8')`), so a multi-byte
  character that straddled a chunk boundary decoded as `U+FFFD` and the tail bytes of it were gone. With
  CJK text (3 bytes per character) a 12 MB session has ~48 boundaries, so the sidebar title, the first/last
  user and assistant previews and the search index all carried replacement characters - and
  `lib/usage-ledger.js` scans through the same helper, so the ledger was reading the same damaged text.
  The decoder is now kept across reads (`decoder.decode(chunk, { stream: true })` plus a final flush), the
  same rule `splitRecords()` in `lib/pi-process.js` already follows for stdout. Note: the review also
  claimed such a line fails `JSON.parse` and that the usage records on it were therefore never banked -
  that did not reproduce: the broken sequence decodes to `U+FFFD` *inside a JSON string*, which is still
  valid JSON, and the tokens were banked. The new `test/usage-ledger.test.js` case pins both halves
  anyway (tokens banked, text undamaged) because the two scanners share this one helper.

- **A tab whose pi never started looked alive, and the UI said `unknown error` when pi died** - two
  separate holes in `lib/pi-process.js`, both about what happens when the child is gone.
  - A spawn failure (`ENOENT`, `EACCES`) fires `'error'` and **not** `'exit'`, and the old handler only
    logged. `exited` stayed false, so `alive` kept answering `true` for a process that never started:
    `spawnTab()` returned `{ ok: true }`, the renderer believed the tab was live, and every `pi:cmd`
    then waited the **full 120 s default timeout** - the interface looked frozen rather than broken. The
    zombie also stayed in the `processes` map, so `pi:alive` reported it and a storage cleanup refused
    to delete a session file nothing was writing to, and the **Restart** button never appeared because
    it only shows while the tab's process is known to be dead. The handler now marks the process
    exited, settles every in-flight command, and emits `exit` (once - `emitExit()`), so `main.js`
    removes the tab and the renderer can offer Restart.
  - Pending commands were stored with `reject` aliased to `resolve`, so the exit path "rejected" by
    resolving with an **`Error` instance** - a value with `message` and no `success`, no `error`, no
    `command`. `main.js` forwards it verbatim, and all 34 `res.error || '...'` call sites in the
    renderer therefore printed `unknown error` for the single most common real failure, the pi process
    dying mid-session, while the log line right above said exactly why. There is now one
    `settlePending()` producing the same envelope every other failure in the file uses
    (`{ success:false, error, exited:true }`), and the `reject` alias is gone.
  The exit note in the transcript distinguishes the two cases (`pi process failed to start: …` vs
  `pi process exited (code=… signal=…)`), the `[pi exit tab=…]` log line carries the spawn error, and
  `stdout`/`stderr` got `'error'` listeners - they had none, so a stream error was an uncaught
  exception. Covered by four cases in `test/pi-process.test.js`, including one that asserts a command
  on a dead process answers in well under the timeout instead of waiting it out.

### Changed

- **The README now starts from a fresh clone instead of from the feature list.** A first-time user used to
  read ~300 lines of prose before learning that Node.js 22.19+ has to be installed at all. Added:
  **What you are installing (three moving parts)** (Strata / pi / this GUI, who installs what, how to prove
  each one is there), a nine-step **Set up from a fresh clone** (machine requirements, the toolchain per
  platform, Strata, pi, the provider config, `npm ci` - what it really downloads, where the Electron binary
  is cached, proxy and mirror settings, no build step - `npm start`, a verification table covering every
  layer, the first run in the window, and where the app keeps its files plus how to reset or uninstall),
  and **When the install itself fails** (blocked Electron download, TLS-intercepting proxy, the wrong Node
  on PATH, the Linux system libraries and `--no-sandbox`, SmartScreen and Gatekeeper, a locked
  `node_modules` on Windows). Also: a table of contents, the old numbered "Installation, configuration and
  first run" chapter became **Configuration reference** (its prerequisites and install steps moved up into
  the new walkthrough), the Quick start's "single devDependency: Electron (~100 MB)" corrected to what is
  actually installed (`electron` + `electron-builder`, 422 MB of `node_modules`), `npm install` replaced by
  `npm ci` throughout, eight smoke-scenario rows that had been pasted into the wrong tables moved back to
  the smoke table, and the pipes inside the Usage scenario's axis strings escaped so that table renders.
- **Auto-compact and auto-retry are always on: the two composer checkboxes are gone.** Both were off
  switches nobody asked for, and leaving them off only produced avoidable context overflows and
  failed requests. `bootstrap()` now calls `ensureAlwaysOn()` at every (re)start of a tab: it reads
  `get_state.autoCompactionEnabled` and, if pi came up without it (a `"compaction": { "enabled": false }`
  in `~/.pi/agent/settings.json`), sends `set_auto_compaction {enabled:true}`; `set_auto_retry
  {enabled:true}` goes out every time, because `get_state` does not report the retry policy. What is
  left in the composer is the **`stop retry`** button (`abort_retry`, only while a retry waits) and
  `/retry [on|off|stop]` as the per-session escape hatch; a restarted session is always on again. If
  the force-on RPC fails, the amber `auto-compact off · compact before it overflows` warning is still
  what stops an overflow from arriving blind. `STRATAPILOT_SMOKE_AUTO_COMPACT=1` and
  `STRATAPILOT_SMOKE_RETRY=1` now assert the always-on behaviour instead of the checkboxes
  (`boot=true … now=false … ensureOn=true`, `bootOn=true setOff=true tabOff=true setOn=true tabOn=true`).
- **The project is renamed `Pi on Strata` -> `StrataPilot`.** Everything that carried the old name
  moved with it: `package.json` `name` (`stratapilot`) / `productName` (`StrataPilot`), the
  `appId` (`com.pionstrata.app` -> `com.stratapilot.app`), the artifact names
  (`stratapilot-<version>-<os>-<arch>…`), the window title, the diagnostics header, the log file
  (`logs/stratapilot.log`), the settings file (`stratapilot_settings.json`), the diagnostics file
  (`stratapilot_diagnostics_<timestamp>.txt`), the smoke profile (`%TEMP%/stratapilot_smoke_profile`)
  and the environment prefix (`PI_ON_STRATA_*` -> `STRATAPILOT_*`).
  Nothing is left behind on an existing install: `migrateSettings()` in `main.js` also looks for
  `%APPDATA%\Pi on Strata\pi_on_strata_settings.json` (and the older `pi-gui` file) and copies it to
  the new folder, and `migrateEnv()` mirrors any `PI_ON_STRATA_*` variable onto its `STRATAPILOT_*`
  name, so old shells, CI run blocks and IDE launch configs keep working - the new name always wins.
  The **project folder** rename is a separate, manual step (`..\rename_to_stratapilot.ps1`) because
  Windows refuses it while a live process holds the folder; that script also fixes the pi sessions
  folder name, the `cwd` recorded in session headers and the paths stored in the app settings.
  Renderer-only state (the `localStorage` theme mirror) does not survive the userData move - the
  theme itself does, it lives in the settings file.
  Entries below keep the name they shipped under, so older rows still say `Pi on Strata` and
  `PI_ON_STRATA_*`.
- `package.json` gained a `test` script and `engines: { "node": ">=22.19" }`, the version the README
  already called a hard requirement.
- Smoke mode grew scenarios for each of the above (`PI_ON_STRATA_SMOKE_PASTE / _COPY / _EXPORT /
  _DIAG / _SETTINGS / _RETRY`), and `PI_ON_STRATA_SMOKE_PI_VERSION` fakes the pi version to exercise
  the guard.
- **The Jobs dialog no longer asks for a cron expression.** The schedule field is now a builder: pick
  *every weekday / every day / on chosen weekdays (chips) / on one day each month / every N hours /
  every N minutes*, set a time, and the expression is written for you - the raw cron box only appears
  under **custom cron (advanced)**, and the expression in use is always echoed above the preview line.
  Reading an expression back into the builder lives in `lib/cron.js` (`schedulePreset`, unit-tested,
  served by `cron:preview`) so the builder and the parser cannot disagree. The target field got pickers
  too (**pick an open tab…** / **pick a recent session…**) instead of asking for a `tab:<id>` or a
  session path, and the job list now spells each schedule out ("every weekday, at 09:30 · next …")
  instead of showing only `30 9 * * 1-5`. `describeCron` says "every 15 minutes" rather than listing
  the 60 minutes a step expands to.

- **Token counts are shown as *in*, *out* and *cache*, never as one blended total.** The stats row
  chip is now `tok in 36.5k / out 26.4k / cache 2.3M` instead of `tok 2.3M`, each assistant message
  header shows `in 2.2k / out 99 / cache 60.9k` instead of `62.5k tok`, and the session list spells
  the same triple out. A single total could not tell you *where* a session was spending, and worse,
  it was mostly *not* new work: pi defines `total = input + output + cacheRead + cacheWrite`, so the
  total is dominated by the context every tool round re-reads from prompt cache. One real session
  reads `in 36.5k / out 26.4k` but totals `2.33M` - 2.26M of it is cache, and its last turn had only
  156 uncached prompt tokens against 60,934 re-read ones. Showing all three makes the chip add up and
  matches the Monitor panel's `read / reused / written` wording; `cache` is left out when it is zero,
  which is exactly when in + out already equals total. The exact figures (uncached prompt read,
  generated, cache read/write, total, and thinking tokens when the provider reports them) sit in the
  chip's tooltip, spelled out as the sum. `tokenLabel()` and `usageTooltip()` keep the stats row, the
  message headers, the session list and `/stats` on one wording. `lib/sessions.js` accumulates
  `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` alongside the existing
  `totalTokens`, so old session files (which only carry a total) still render.
  `STRATAPILOT_SMOKE_SESSION` now also prints
  `[smoke-tokens] bar="tok in … / out … / cache …" message_chips=N first="in … / out …" tooltip="…"`.

- **The README is an index now: the reference is split into eleven topic files under `docs/`.** It had
  grown to 1 400 lines / 109 KB, so a first-time reader scrolled past the Monitor, the token ledger and
  the streaming notes before learning that Node.js 22.19+ has to be installed at all, and every section
  had to be found by anchor inside one page. Kept in the README: the intro, a **Documentation** table,
  a short **Quick start** (three commands plus the four "prove this layer" checks), the feature list,
  **Known limitations** and the licence. Moved: `docs/INSTALL.md` (the three moving parts, the nine
  steps, install failures), `docs/CONFIGURE.md` (`/setup`, pi ↔ Strata, the environment variables, the
  settings file), `docs/SESSIONS.md` (the two sidebar lists, export, the serial queue, the tree and
  branching, storage), `docs/COMPOSER.md` (`!`, `/`, `@`, links, shortcuts), `docs/TOKENS.md` (the
  ledger, the chart, the rates, in / out / cache), `docs/MODEL.md` (auto-compaction, retry, compaction
  while a request is in flight, the fake-timeout note, streaming performance), `docs/MONITOR.md`,
  `docs/SCHEDULER.md`, `docs/APPEARANCE.md` (theme, language, accessibility), `docs/LOGS.md` (the log
  file, crash recovery, the diagnostics report) and `docs/DEVELOP.md` (architecture, CI, smoke mode,
  packaging, Linux and macOS). Text was moved verbatim; what changed is the plumbing - every `#anchor`
  and relative path rewritten for its new home - and the split caught two things out on the way: the
  cross-links had been written in lower case (`install.md` against `INSTALL.md`, a 404 on Linux and
  nothing on Windows), and the troubleshooting list ended with a duplicated item 5. The architecture map
  in `docs/DEVELOP.md` also finally lists what the last months added (`lib/usage-ledger.js`,
  `lib/cron.js`, `lib/diagnostics.js`, `renderer/i18n.js`, `locales/`, `scripts/i18n-extract.js`).
  `test/docs-links.test.js` (5 tests) keeps it honest: every relative link names a file that exists,
  every `#anchor` names a heading, using GitHub's own slug rules (CJK letters are kept - the Language
  heading is the one that proves the slugger right), the README index links every docs page and no
  phantom one, and README.md stays under 320 lines so it cannot grow back into one long file. Links
  inside fenced blocks and inline code are skipped, because the links section quotes `[text](url)` as
  an example rather than meaning it.

## [0.1.0] - 2026-10-15

First version of the app, replacing the `pi_gui` prototype (the app name, the settings file
`pi_on_strata_settings.json` and the `PI_ON_STRATA_*` environment prefix all moved; the old settings
file is migrated on first launch).

### Added

- **Multi-session tabs**, each one a real `pi --mode rpc` process: new session (`Ctrl+T`), new session
  inside the current tab (`Ctrl+Shift+N`), rename (`F2`), close (`Ctrl+W`), restore up to 4 tabs on
  the next launch.
- **Serial queue** — Strata answers one request at a time, so the sidebar's
  `OPEN SESSIONS (QUEUE)` splits open tabs into Working / Idle and runs one session at a time in list
  order (drag to reorder, `top`, per-tab outbox, `serial` switch).
- **Session switcher** — every saved session of every project in one list, each row showing the
  working folder it was started in; open in a new tab, load into this tab (`switch_session`), rename
  or delete from the row.
- **Strata Monitor** (`Ctrl+M`) — model state, speed, GPU/VRAM/temperature/power/PCIe/CPU/disk,
  context fill and recent requests, read from `/metrics` by the main process (no CSP/CORS problems).
- **Streaming output** — assistant text, collapsible thinking, tool call cards with live partial
  output, plus `!command` / `!!command` bash cards with streaming output.
- **`/` command palette** — app commands (`/compact`, `/model`, `/thinking`, `/stats`, `/new`,
  `/rename`, `/abort`, `/resume`, `/monitor`, `/commands`) plus pi's own extension commands, prompt
  templates and skills from `get_commands`.
- **Pinned request bars** — the request pi is working on right now at the top of the chat (`↓ jump`
  scrolls to it), everything not processed yet above the editor.
- **Markdown rendering with no dependencies** (`renderer/markdown.js`) — headings, lists, quotes,
  code blocks with a copy button, and GFM tables with `:---:` alignment, `\|` escaping and column
  count repair, taking shape while streaming.
- **Model / thinking dropdowns**, **steer / follow-up while busy**, **manual and automatic
  compaction** with a per-session `auto-compact` switch, context usage / tokens / cost in the status
  bar.
- **Extension UI bridging** — `select` / `confirm` / `input` / `editor` become in-window dialogs,
  `notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text` are shown.
- **File drag & drop** anywhere on the window: images go to the RPC `images` payload, everything else
  becomes a list of absolute paths pi can `read`.

### Fixed (relative to the `pi_gui` prototype)

- Compaction no longer reports a fake timeout: the RPC waits on pi's own `compaction_end` event
  instead of a short timer (an 86 MB session really does take minutes).
- Links in chat output open in the default browser; they can no longer open a second Electron window
  or navigate the app away.
