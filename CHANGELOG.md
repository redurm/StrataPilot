# Changelog

All notable changes to **Pi on Strata** are documented here. The format follows
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

### Changed

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
