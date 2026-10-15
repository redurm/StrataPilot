# TODO

Working backlog for Pi on Strata. Feature and design documentation is in the parent
[`README.md`](../README.md); known limitations are listed at the end of that file.

Status legend: `todo` (not started) · `doing` · `done` · `wontfix`
Effort: `S` (< half a day) · `M` (half a day – 1 day) · `L` (> 1 day)
Priority: `P0` (do next) · `P1` (worth doing) · `P2` (nice to have)

## A. Input / output loop still open

Cheap to close, and used every day.

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

## B. Structural gaps (already acknowledged in the README, but they need a slot)

| # | Item | What is missing today | Where | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| B1 | Session tree / branching | pi sessions are a DAG, the GUI renders only the active branch (`get_messages`); there is no way in the GUI to branch off an earlier message | `renderer/app.js` `renderAll()`, new panel | L | P1 | todo |
| B2 | Lazy transcript rendering | Listed in the README as the "one big item still untouched": opening an 86 MB / 600+ message session builds the whole transcript into the DOM at once | `renderer/app.js` `renderAll()` (~L603) | M | P1 | todo |
| B3 | Session list cache | `listSessions()` re-reads every `.jsonl` from the beginning (capped at 12 MB each) on every refresh, synchronously in the main process; with hundreds of sessions this stalls the UI. Add a `path → {mtimeMs, size, meta}` cache and re-read only what changed (or move it to a utilityProcess) | `lib/sessions.js` ~L170 | M | P1 | todo |
| B4 | Persist the outbox | The outbox lives in memory and is silently lost on restart. Minimum: store it in settings and show it as "pending, not sent" after relaunch (never auto-send) | `renderer/app.js` `scheduler`, `main.js` settings | M | P2 | todo |
| B5 | Cron jobs (scheduled prompts) | No way to run a prompt on a schedule (e.g. daily 09:30). Agreed design: scheduler lives in a new `lib/cron.js` (main process, hand-written 5-field parser, no new dependency), job definitions persist in settings (`settings.jobs[]`), and on fire the main process sends `cron:fire` to the renderer, which pushes the prompt into the target tab's **outbox** and calls `scheduler.pumpSoon(0)` — the existing serial queue stays the only prompt entry point, so Strata single-flight is never violated. Target is `new-tab` / `tab:<id>` / `session:<path>` (respawn a dead tab via `pi --session`). Recompute `nextRun` on `powerMonitor resume` + a 5-min heartbeat (sleep drift); missed runs only toast a notice, never auto-run. Management UI: modal list + add/edit form; `cron:run-now` IPC for testing. See design notes below | new `lib/cron.js`, `main.js`, `preload.js`, `renderer/app.js` | M | P1 | todo |

### B5 design notes (from the 2026 research pass)

- Rejected: main process spawning its own headless `PiRpcProcess` — the renderer `scheduler` would not know about it and two prompts could hit Strata at once; fixing that means moving the scheduler to main (too big).
- Rejected for the mainline: Windows Task Scheduler + `pi -p` — reliable across sleep/shutdown but bypasses the GUI and the serial queue; could be a later "run even when the app is closed" option.
- Risks: a scheduled prompt runs with full read/edit/bash rights (the UI must say so and pin `cwd`); `new-tab` jobs pile up session files (offer `ephemeral` / auto-close after `agent_settled`); a cron prompt sitting in the outbox is lost on crash — same gap as B4, do them together.
- Testing: `test/cron.test.js` for `parseCron`/`nextRun` (month rollover, weekday field, recompute after sleep); `PI_ON_STRATA_SMOKE_CRON` fires one echo job at startup and checks the outbox badge appears.

## C. Delivery and maintainability (required before handing this to anyone else)

| # | Item | What is missing today | Where | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| C1 | Unit tests for the hand-written parsers | Zero tests that run without pi + Strata. The three riskiest hand-written pieces are untested: `renderer/markdown.js` (GFM table alignment, `\|` escaping, `linkify()` CJK boundaries), `lib/sessions.js` (JSONL parsing, `assertInsideRoot()` path guard), `lib/pi-process.js` (LF-only framing, partial lines, response pairing). `node --test`, no new dependency, no Electron needed | new `test/*.test.js` | M | P0 | done |
| C2 | `LICENSE`, `CHANGELOG.md`, issue template | None exist; the repo is README + TROUBLESHOOTING only | repo root, `.github/` | S | P1 | todo |
| C3 | `package.json` hygiene | No `test` script (the README tells people to run `node test/smoke-rpc.js` by hand), no `engines: { "node": ">=22.19" }` even though the README calls 22.19 a hard requirement | `package.json` | S | P1 | done |
| C4 | CI | No CI at all; smoke tests need a real pi + Strata, so only C1's unit tests can run headless | `.github/workflows/` | S | P1 | todo |
| C5 | Packaging + first-run wizard | No packaging script (the README says so): no icon, no installer, no portable exe. Also no first-run check that Strata and pi are installed — a fresh machine just shows `pi ?` in the env bar | `package.json`, `main.js`, new wizard | L | P1 | todo |
| C6 | pi version compatibility guard | done: `piVersionStatus()` compares the resolved pi with `TESTED_PI_VERSION`; the env bar turns amber (different minor) or red (different major / pi missing) with a hover explanation, a startup toast points at it, and the report prints both versions. `PI_ON_STRATA_SMOKE_PI_VERSION` fakes it for testing | `lib/pi-launch.js`, `renderer/app.js` `renderEnvBar()`, `test/pi-launch.test.js` | S | P1 | done |
| C7 | Cross-platform check | `scripts/*.ps1` and the whole README are Windows-only; Linux/macOS should at least be smoke-tested once (`os.homedir()` and Electron `appData` are already portable) | `scripts/`, README | M | P2 | todo |
| C8 | Crash diagnosis (file log) | Was: nothing was written to disk, so a crash left no evidence at all (no crash dump, no WER report, nothing in Event Viewer) and `console.*` only reached the terminal that ran `npm start`. Now: `lib/log.js` mirrors the console to `%APPDATA%\Pi on Strata\logs\pi_on_strata.log` (rotate ~2 MB, keep 2), records a startup banner, pi spawn/exit/stderr, `uncaughtException`/`unhandledRejection`, `child-process-gone`, `render-process-gone`, `unresponsive`, `did-fail-load`, `preload-error`, and `renderer/error-report.js` forwards renderer `error`/`unhandledrejection` over `app:client-error`; Help ▸ Open Log Folder opens it | `lib/log.js`, `main.js`, `preload.js`, `renderer/error-report.js`, `test/log.test.js` | S | P0 | done |
| C9 | Crash recovery UX | done: `render-process-gone` / `unresponsive` / `did-fail-load` now open a dialog offering **Reload interface** (tab ids are persisted in `openTabs[].id`, so `spawnTab` re-attaches to the live pi process instead of starting a second one); a toast reports when the renderer came back on its own, and a restore logs how many tabs re-used a live process | `main.js` `recoverInterface()`, `renderer/app.js` `api.on('recovery')` | S | P1 | done |

## D. Smaller experience gaps

| # | Item | What is missing today | Where | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| D1 | `@` path completion in the composer | The composer has a `/` palette but no path/file completion; attachments rely on drag & drop or the button | `renderer/app.js` slash palette | M | P2 | todo |
| D2 | Light / dark theme | One `styles.css`, no switch (pi's TUI has themes) | `renderer/styles.css` | M | P2 | todo |
| D3 | Accessibility | `renderer/index.html` has a single `aria-` attribute, `app.js` has none; the session list and queue rows cannot be navigated by keyboard, reordering is mouse-drag only | `renderer/index.html`, `app.js` | M | P2 | todo |
| D4 | Keyboard queue reordering | Only mouse drag plus the `top` button | `renderer/app.js` queue rows | S | P2 | todo |
| D5 | Model / thinking in the tab label | The tab strip shows title, queue position and outbox count, but not which model that tab is on | `renderer/app.js` `renderTabs()` (~L1125) | S | P2 | todo |
| D6 | Multiple Strata servers | The Monitor derives one address from the active tab (or `strataUrl`); running two servers on different ports is not viewable | `renderer/app.js` monitor, `main.js` `strata:metrics` | M | P2 | todo |
| D7 | Session storage usage / cleanup | The sidebar footer shows the sessions root path only; no size, no bulk cleanup (an 86 MB session can currently only be deleted from the file manager) | `lib/sessions.js`, sidebar footer | M | P2 | todo |
| D8 | Restart a dead tab explicitly | A dead pi process prints a note and changes the placeholder to "press Send to restart"; there is no explicit Restart button | `renderer/app.js` ~L1405, ~L2598 | S | P2 | todo |

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
