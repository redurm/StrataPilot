# TODO

Working backlog for Pi on Strata. Feature and design documentation is in the parent
[`README.md`](../README.md); known limitations are listed at the end of that file.

Status legend: `todo` (not started) · `doing` · `done` · `wontfix`
Effort: `S` (< half a day) · `M` (half a day – 1 day) · `L` (> 1 day)
Priority: `P0` (do next) · `P1` (worth doing) · `P2` (nice to have)

**Every item in this backlog is implemented (28/28 done).** New findings go in the section that fits them,
with the same columns; each one was committed separately and is verified by a unit test or a
`PI_ON_STRATA_SMOKE_*` scenario named in its row.

## A. Input / output loop

Cheap to close, and used every day - all shipped.

| # | Item | What is missing today | Where | RPC / source | Effort | Priority | Status |
|---|---|---|---|---|---|---|---|
| A1 | Paste an image with `Ctrl+V` | Only drag & drop and the `Attach files` button exist; pasting a screenshot does nothing | `renderer/app.js` drop handler (~L3343), attachment pipeline (~L3286) | reuse the existing `images` payload path | S | P0 | done |
| A2 | Per-message `copy` / `resend` | Only fenced code blocks have a copy button; no "copy this message (raw markdown)", no "resend the last request" | `renderer/app.js` ~L3553 | `get_last_assistant_text` | S | P0 | done |
| A3 | `/export` a session to HTML | RPC command exists, no UI, no palette entry | `renderer/app.js` slash palette | `export_html` | S | P0 | done |
| A4 | Retry controls | done: `auto-retry` checkbox (`set_auto_retry`, per session), a `stop retry` button that only appears while a retry is sitting in its delay (`abort_retry`), and `/retry [on\|off\|stop]`; the two events now also drive the composer | `renderer/app.js` `setAutoRetry()`/`abortRetry()`, `renderer/index.html` | `set_auto_retry`, `abort_retry` | S | P1 | done |
| A5 | Settings dialog | `strataUrl`, default `cwd`, `serialQueue`, `monitorWidth` all required hand-editing `%APPDATA%\Pi on Strata\pi_on_strata_settings.json` — now a form over `app:settings-set`: topbar **Settings**, `Ctrl+,`, `/settings`, plus `restoreTabs` and one-click access to the settings/log/sessions paths | `renderer/app.js` `openSettingsModal()`/`applySettings()`, `main.js` `fs:choose-file` + Settings menu, `renderer/styles.css` | `app:settings-get/set` already existed | M | P0 | done |
| A6 | `Copy diagnostics` button | `docs/TROUBLESHOOTING.md` "What to include when reporting an issue" asked for 5 items the user had to collect by hand (smoke-rpc first four lines, pi version, `/health`, both model configs) — now one click: topbar **Diagnostics** button, `/diagnostics`, and menu **Help ▸ Copy Diagnostics**; report is copied and saved to `userData/diagnostics/`, keys redacted | `lib/diagnostics.js`, `main.js` `app:diagnostics`, `renderer/app.js` `copyDiagnostics()`, `test/diagnostics.test.js` | pairs with TROUBLESHOOTING | S | P0 | done |

### RPC commands that exist in pi but are not used at all

| Command | What it would unlock | Priority |
|---|---|---|
| `export_html` | A3 — export a session as HTML | P0 |
| `get_last_assistant_text` | A2 — copy the last reply (not needed: A2's per-message `copy` covers it) | P0 |
| `set_auto_retry`, `abort_retry` | A4 — retry policy per session | P1 |
| `get_tree`, `get_entries` | B1 — session tree / branch switching | P1 |
| `fork`, `clone`, `get_fork_messages` | B1 — branch from an earlier message, "redo from here" | P1 |
| `cycle_model`, `cycle_thinking_level` | keyboard model / thinking cycling (dropdowns already cover it) | P2 |
| `set_steering_mode`, `set_follow_up_mode` | pi-side queue mode (the GUI sends `steer` / `follow_up` directly, so mostly redundant) | P2 |

## B. Structural gaps

| # | Item | What is missing today | Where | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| B1 | Session tree / branching | done: **tree** chip in the stats row + `/tree`, tree built from pi's `get_tree` (no second writer of the file): depth-indented entries with kind / preview / time, active path highlighted, off-path entries dimmed, branch and leaf markers, **jump** (text match into the windowed transcript), **fork here** on user messages of the active branch (RPC `fork`, then re-bootstrap and `get_state` to adopt any new session file), **clone branch** (RPC `clone`), **refresh**. Checked by `PI_ON_STRATA_SMOKE_TREE=1` (read-only) and `PI_ON_STRATA_SMOKE_FORK=1` on a throwaway session (`items_before=5 items_after=1`) | `renderer/app.js` (session tree section), `renderer/styles.css` | L | P1 | done |
| B2 | Lazy transcript rendering | done: `renderAll()` builds only the last 120 items; a `show 150 earlier` control prepends pages and keeps the scroll anchor, and `jumpToItem` renders the page containing the target. `tab.items` still holds everything, so search / pinned bars / jump are unaffected (319-message session: 61 nodes instead of 319) | `renderer/app.js` `renderAll()`/`showEarlierMessages()`/`jumpToItem()` | M | P1 | done |
| B3 | Session list cache | done: `listSessions()` keeps `path -> {mtimeMs, size, meta}` in the main process and only re-parses files whose stat changed; renames/deletes drop the entry, vanished files are evicted, and the cache is capped at 4000 entries. Tests count `fs.openSync` calls to prove an unchanged file is never opened again | `lib/sessions.js`, `test/sessions.test.js` | M | P1 | done |
| B4 | Persist the outbox | done: the outbox is written to the settings file (`openTabs[].outbox` / `pendingOutbox`, images only while under ~400 KB) and comes back as a **pending** badge plus a transcript note; it is never auto-sent - the modal offers `queue it` / `queue all` / `drop`. Smoke: `PI_ON_STRATA_SMOKE_OUTBOX=1` | `renderer/app.js` `persistedOutbox()`/`restorePendingOutbox()`/`openPendingOutboxModal()` | M | P2 | done |
| B5 | Cron jobs (scheduled prompts) | done: `lib/cron.js` (hand-written 5-field parser, `nextRun`, `describeCron`; 18 unit tests), scheduler in `main.js` (30 s tick, `settings.jobs[]`, re-arm on `powerMonitor resume`/`unlock-screen`, missed runs reported not replayed), `cron:fire` to the renderer which queues the prompt into the target tab outbox (`new-tab` / `tab:<id>` / `session:<path>`), Jobs dialog with add/edit/enable/run-now (`/jobs`, Settings). Pairs with B4: a queued cron prompt is crash-recoverable | `lib/cron.js`, `main.js`, `preload.js`, `renderer/app.js`, `test/cron.test.js` | M | P1 | done |

### B5 design notes (from the 2026 research pass)

- Rejected: main process spawning its own headless `PiRpcProcess` — the renderer `scheduler` would not know about it and two prompts could hit Strata at once; fixing that means moving the scheduler to main (too big).
- Rejected for the mainline: Windows Task Scheduler + `pi -p` — reliable across sleep/shutdown but bypasses the GUI and the serial queue; could be a later "run even when the app is closed" option.
- Risks: a scheduled prompt runs with full read/edit/bash rights (the UI must say so and pin `cwd`); `new-tab` jobs pile up session files (offer `ephemeral` / auto-close after `agent_settled`); a cron prompt sitting in the outbox is lost on crash — same gap as B4, do them together.
- Testing: `test/cron.test.js` for `parseCron`/`nextRun` (month rollover, weekday field, recompute after sleep); `PI_ON_STRATA_SMOKE_CRON` fires one echo job at startup and checks the outbox badge appears.

## C. Delivery and maintainability

| # | Item | What is missing today | Where | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| C1 | Unit tests for the hand-written parsers | Zero tests that run without pi + Strata. The three riskiest hand-written pieces are untested: `renderer/markdown.js` (GFM table alignment, `\|` escaping, `linkify()` CJK boundaries), `lib/sessions.js` (JSONL parsing, `assertInsideRoot()` path guard), `lib/pi-process.js` (LF-only framing, partial lines, response pairing). `node --test`, no new dependency, no Electron needed | new `test/*.test.js` | M | P0 | done |
| C2 | `LICENSE`, `CHANGELOG.md`, issue template | done: MIT `LICENSE` (matching pi's own license), `CHANGELOG.md` in Keep a Changelog form covering 0.1.0 and everything since, `.github/ISSUE_TEMPLATE/bug_report.yml` (leads with the Diagnostics report), `feature_request.yml`, `config.yml`, and a PR template that asks whether the change touches the serial queue | repo root, `.github/` | S | P1 | done |
| C3 | `package.json` hygiene | No `test` script (the README tells people to run `node test/smoke-rpc.js` by hand), no `engines: { "node": ">=22.19" }` even though the README calls 22.19 a hard requirement | `package.json` | S | P1 | done |
| C4 | CI | done: `.github/workflows/ci.yml` - unit tests on Windows/Linux/macOS with Node 22.19 + current Node (Electron binary download skipped), `node --check` over every source file, and a `pi-install` job that runs `test/smoke-rpc.js` against a real pi with no model. Smoke scenarios stay manual (they need Strata) | `.github/workflows/ci.yml` | S | P1 | done |
| C5 | Packaging + first-run wizard | done. **First-run wizard**: `/setup` and Help ▸ First-run check run a three-step check (pi resolved + version colour, Strata `/health` with latency and a save-as-`strataUrl` button, working-folder picker), printing the pi install command with a copy button and a re-check button instead of installing anything, and recording `firstRunSeen`. **Packaging**: `electron-builder` config in `package.json` (`build`), icons in `build/` (π over three Strata layers, wired into the BrowserWindow), scripts `dist` / `dist:win` / `dist:mac` / `dist:linux`; verified locally - `npx electron-builder --win` produced `pi-on-strata-0.1.0-win-x64-setup.exe` (NSIS, per-user) and `-win-x64.zip` (portable folder), and the unpacked `Pi on Strata.exe` was started in smoke mode and resolved pi 1.2.0 like `npm start` does. A `Release build` workflow builds on all three OSes (tag `v*` or manual) and smoke-starts the packaged Windows artifact before uploading. Nothing is code-signed, and the README says so | `package.json`, `build/`, `.github/workflows/release.yml`, `main.js` (`appIconPath`), `renderer/app.js` | L | P1 | done |
| C6 | pi version compatibility guard | done: `piVersionStatus()` compares the resolved pi with `TESTED_PI_VERSION`; the env bar turns amber (different minor) or red (different major / pi missing) with a hover explanation, a startup toast points at it, and the report prints both versions. `PI_ON_STRATA_SMOKE_PI_VERSION` fakes it for testing | `lib/pi-launch.js`, `renderer/app.js` `renderEnvBar()`, `test/pi-launch.test.js` | S | P1 | done |
| C7 | Cross-platform check | done (as far as it can be from a Windows box): CI gained an **`electron smoke`** job that installs the Electron binary and pi and starts a real window on `ubuntu-latest` (under `xvfb-run --no-sandbox`, hard failure) and `macos-latest` (`continue-on-error`), asserting `[smoke] window` + `[smoke-env]` present and no `renderer error`; the `pi install smoke` job now runs on both POSIX runners. Audited the code: settings/sessions/logs all go through `app.getPath`/`os.homedir`, pi is resolved from the managed install's `package.json` bin and run with `node` (no `.cmd`/`.exe` assumption), the menu has a `darwin` branch. README gained a **Linux and macOS** section saying exactly what is proven and what is not (`scripts/*.ps1` stay Windows-only) | `.github/workflows/ci.yml`, README | M | P2 | done |
| C8 | Crash diagnosis (file log) | Was: nothing was written to disk, so a crash left no evidence at all (no crash dump, no WER report, nothing in Event Viewer) and `console.*` only reached the terminal that ran `npm start`. Now: `lib/log.js` mirrors the console to `%APPDATA%\Pi on Strata\logs\pi_on_strata.log` (rotate ~2 MB, keep 2), records a startup banner, pi spawn/exit/stderr, `uncaughtException`/`unhandledRejection`, `child-process-gone`, `render-process-gone`, `unresponsive`, `did-fail-load`, `preload-error`, and `renderer/error-report.js` forwards renderer `error`/`unhandledrejection` over `app:client-error`; Help ▸ Open Log Folder opens it | `lib/log.js`, `main.js`, `preload.js`, `renderer/error-report.js`, `test/log.test.js` | S | P0 | done |
| C9 | Crash recovery UX | done: `render-process-gone` / `unresponsive` / `did-fail-load` now open a dialog offering **Reload interface** (tab ids are persisted in `openTabs[].id`, so `spawnTab` re-attaches to the live pi process instead of starting a second one); a toast reports when the renderer came back on its own, and a restore logs how many tabs re-used a live process | `main.js` `recoverInterface()`, `renderer/app.js` `api.on('recovery')` | S | P1 | done |

## D. Smaller experience gaps (all closed)

| # | Item | What is missing today | Where | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| D1 | `@` path completion in the composer | done: `atQuery()` finds the `@token` under the caret, `fs:complete` in main lists one level inside the session folder (hides `node_modules`/`.git`/`dist`/... unless typed), the existing palette shows folders first, `Up`/`Down` + `Enter`/`Tab` inserts the path (a folder keeps the menu open), `Esc` closes; the first Enter completes and only the second sends | `renderer/app.js` (`pathMenu`), `main.js` `fs:complete`, `preload.js` | M | P2 | done |
| D2 | Light / dark theme | done: `theme` setting (`dark` default / `light` / `system`), `[data-theme="light"]` variable block in `styles.css` (all hardcoded shades were lifted into variables first, so a theme is only a redefinition), `renderer/theme-boot.js` mirrors the last theme in `localStorage` to avoid a dark flash, and `PI_ON_STRATA_SMOKE_THEME=1` screenshots both themes | `renderer/styles.css`, `renderer/theme-boot.js`, `renderer/app.js` `applyTheme()` | M | P2 | done |
| D3 | Accessibility pass | done: two observers do it centrally instead of touching every widget - dialogs get `role=dialog`/`aria-modal`/label-from-heading/focus-in/Tab-trap/Esc-via-Cancel/focus-restore, glyph buttons get a name from their `title` (scoped to added nodes, so streaming stays fast), queue rows are focusable with a spoken state, regions got roles and labels, plus `:focus-visible` and `prefers-reduced-motion`. Verified by `PI_ON_STRATA_SMOKE_A11Y=1` (`nameless_buttons=0`) | `renderer/app.js` (accessibility section), `renderer/index.html`, `renderer/styles.css` | M | P2 | done |
| D4 | Keyboard queue reordering | done: `Alt+Up` / `Alt+Down` moves the active session in the queue from anywhere (composer included), and a focused queue row reacts to plain `Up` / `Down`; rows are focusable now, which is also the first step of D3 | `renderer/app.js` `queueRow()` + a document keydown handler | S | P2 | done |
| D5 | Model / thinking in the tab label | done: each tab shows a model tag (id, truncated; full `provider/id` + server url on hover) and the thinking level when it is not the pi default | `renderer/app.js` `tabModelTag()` in `renderTabs()` | S | P2 | done |
| D6 | Multiple Strata servers | done: `strataUrls` setting (textarea, one per line) + a pill per address in the Monitor header (`active tab`, each known server, `+ add server`, `x` to remove). Clicking a pill points the cards at that server; every watched address gets a `/health` dot polled every 4 s (`strata:health` in main). Known addresses = derived + settings + the open tabs' model servers | `renderer/app.js` (monitor switcher), `main.js` `strata:health`, `preload.js`, `renderer/index.html` | M | P2 | done |
| D7 | Session storage usage / cleanup | done: footer shows size + count (`Storage: 8.2 MB in 15 files`), dialog with per-folder totals, two rules (age / keep the N newest per folder), mandatory preview + confirm, `stat()`-only scan, sessions owned by a live pi process filtered out in main, paths outside the root refused, cache dropped once per bulk delete. `storageStats`/`cleanupPlan`/`deleteSessions` in `lib/sessions.js` + 4 unit tests on a temp root; `PI_ON_STRATA_SMOKE_STORAGE=1` never deletes | `lib/sessions.js`, `main.js`, `preload.js`, `renderer/app.js` | M | P2 | done |
| D8 | Restart a dead tab explicitly | done: an explicit **Restart** button appears in the composer only while that tab's pi process is dead, so the editor draft survives (the placeholder hint still works as before) | `renderer/app.js` `renderComposerState()` + `btnRestart` | S | P2 | done |

## Deliberately not doing

| Item | Why |
|---|---|
| pi TUI `custom()` components, theme switching inside pi | RPC mode does not support them (see the pi docs); nothing we can implement on our side |
| Expanding a dropped folder into multiple attachments | A folder path is what pi's `read`/`bash` tools want; expanding would blow up the context |
| Auto-sending a persisted outbox after restart | Would fire model requests by accident; B4 only restores them as "pending" |
| pi TUI built-in slash commands (`/settings`, `/hotkeys`, …) | They do not exist in RPC mode; `get_commands` only reports extension commands, prompt templates and skills |

## Suggested order

1. **A1 + A2 + A3** — closes the input/output loop, smallest diff, immediately felt
2. **A5 + A6** — removes the two "hand-edit a JSON file / hand-copy diagnostics" debts
3. **C1 + C2 + C3** — safety net for everything after this; the later it lands, the more expensive it is
4. **B3** — cheapest of the structural items, and it gets worse on its own over time
5. **B1** — the biggest remaining functional hole, needs a design pass first
