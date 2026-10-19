# Troubleshooting

Common problems with StrataPilot and how to fix them. Feature and design documentation is in the
parent [`README.md`](../README.md).

## Startup / environment

| Symptom | Cause / fix |
|---|---|
| `pi CLI not found; set STRATAPILOT_PI_CLI` | pi is not installed, or not a managed install (`~/.pi/agent/install/current-version` unreadable) → set `STRATAPILOT_PI_CLI` (pointing at `.../pi-coding-agent/dist/bundle/cli.js`) or `PI_MANAGED_INSTALL_ROOT` |
| `node runtime not found; set STRATAPILOT_NODE` | No `node` on PATH and the `electron.exe` + `ELECTRON_RUN_AS_NODE=1` fallback also failed → set `STRATAPILOT_NODE` to a node executable |
| `npm install` hangs / cannot fetch Electron | Corporate proxy / TLS interception: set `npm config set proxy/https-proxy`, or point `ELECTRON_MIRROR` at a mirror |
| Nothing happens on the second `npm start` | Expected: the window has a single-instance lock (`requestSingleInstanceLock`), so re-running only focuses the window that is already open. Close it first if you really want a fresh start |
| Want to verify the environment without the UI | `node test/smoke-rpc.js C:/some/project` → check the `cli:` / `node:` / `pi version:` / `sessions root:` lines; `cli: null` means pi was not found |
| No error output visible at all | Everything is mirrored to `%APPDATA%\StrataPilot\logs\stratapilot.log` (menu **Help ▸ Open Log Folder**); for live output also start it from a terminal with `npm start` — stderr prints `[renderer …]` plus pi's spawn output (`[stderr]` / `[log]`) |

## Crash / white window / the app disappears

| Symptom | Cause / fix |
|---|---|
| The window goes white or the app disappears | Open the log file (**Help ▸ Open Log Folder**) and read the **last** lines. `[renderer error] …` + stack = a renderer exception; `[crash] renderer gone reason=crashed exitCode=…` = the renderer process died; `[fatal] uncaughtException` = the main process crashed and quit; `[pi exit tab=…] code=…` = only that tab's pi process died (the window survives, the tab goes dead) |
| The log file is empty / missing | It is created on startup: an empty file means the app never got as far as opening a window — start it from a terminal with `npm start` and read stderr |
| Need the renderer stack with line numbers | DevTools (Ctrl+Shift+I) shows it live; the log also records `file:line:col` for uncaught errors. For scripted reproduction, launch with `--remote-debugging-port=9223` and drive it over CDP |
| Reproduce without touching your real profile | Smoke mode uses a separate profile and skips the single-instance lock: `STRATAPILOT_SMOKE=1 STRATAPILOT_SMOKE_MS=30000 STRATAPILOT_SMOKE_PROMPT="Reply OK" npm start`, then read `%TEMP%\stratapilot_smoke_profile\logs\stratapilot.log` |
| The app feels frozen but is still there | Look for `[crash] renderer unresponsive` (no reply for >30 s). Ctrl+Shift+R reloads the renderer; open tabs live in pi processes, so a reload does not kill a running request |
| A white window says nothing at all | It now asks: after a renderer crash, hang or a failed load the app shows a dialog offering **Reload interface** (the window used to just stay blank). Reload re-attaches to the pi processes that are still running - tab ids are saved in the settings file, so the sessions, their context and a running generation survive; only the interface is rebuilt. If a generation really was interrupted, resend the last message (`resend` on the pinned bar or the message action) |
| The window came back by itself after hanging | The log shows `[crash] renderer unresponsive` then `responsive again`, and a toast says nothing was reloaded. If it happens repeatedly, look for a `[renderer error]` line in between - usually one huge transcript or one huge tool output |
| Reload did not bring the tabs back | Only tabs with a session file are restored (unsaved and ephemeral tabs have nothing to reopen). Check `restoreTabs` in the Settings dialog is on, and `openTabs` in the settings file |

## Model / connection

| Symptom | Cause / fix |
|---|---|
| The model dropdown is empty | No provider in `~/.pi/agent/models.json`, or `defaultProvider` in `settings.json` is wrong |
| Sending spins forever / `connection error` | Strata is not running: open `http://127.0.0.1:8081/metrics` in a browser first. Check that the port in the model's `baseUrl` matches the port Strata actually listens on (`--port` in the launcher `.bat`, `"port"` in the Strata config) |
| `model not found` / the request names another model | `models[].id` in `models.json` is not what the server serves: it must equal `"model_name"` in the Strata config, i.e. the `id` in `curl http://127.0.0.1:<port>/v1/models` |
| 401 / `invalid api key` | The `apiKey` in `models.json` does not match Strata's key (`"api_key"` in the config, `--api-key` or `$STRATA_API_KEY`; `curl http://127.0.0.1:<port>/health` says `"api_key": false` when the server has none — then any non-empty placeholder works). That key is what pi uses for requests; it is not the Monitor's `STRATAPILOT_KEY` |
| `request exceeds the context window` | `contextWindow` / `maxTokens` in `models.json` are bigger than the server's (`--max-context` in the Strata config, `max_context` in `/health`), and the config has no `"fit_max_tokens": true` to shorten the request instead |
| Context usage looks wrong, or is high while nothing runs | `contextWindow` in `models.json` is wrong: both the status bar and the Monitor's context-fill donut use that value. It must equal `/health`'s `max_context` — re-check it after `START-HERE.bat --calibrate` rewrites the Strata config |
| Fewer thinking options after switching model | Expected: models without reasoning support expose a shorter thinking list (whatever `get_available_thinking_levels` returns) |

## Sessions / tabs

| Symptom | Cause / fix |
|---|---|
| The session you just opened is not in `SESSION FILES` | pi creates the file only after the **first message** (the queue row shows `unsaved`); if you chose not to save when opening the tab it never appears (`ephemeral`) |
| "It was there a moment ago, now it is not in the queue" | You used `this tab` (`switch_session`) or `Ctrl+Shift+N`, so the tab now points at a different session file; the old file is still in `SESSION FILES` |
| Many rows missing from the list | `Search…` filters it, and only the 400 most recent entries are listed |
| Tabs were not restored after a restart | `openTabs` keeps at most 4 entries and only ones with a `sessionPath` (unsaved / ephemeral tabs are not restored) |
| Sessions of another folder are not visible | They are listed — Session files always shows **all projects**; each row prints its working folder (the folder name is highlighted when it matches the active tab), and `Search…` matches folder paths |
| Session file came from another machine / path | The JSONL records the `cwd` it was created with, so the row may print a path that does not exist here; opening such a session falls back to the default working folder and says so in the chat (`cwd` note) |

## Serial queue

| Symptom | Cause / fix |
|---|---|
| Pressing Send in another tab does nothing | Expected: the message went into that tab's **outbox** and waits for the previous session to reach `agent_settled`. Click the `outbox n` badge to `next` / `remove` |
| A message's `resend` did not send immediately | Expected: `resend` puts the text back in the editor and goes through the same send path as the Send button, so the queue decides — while **another** session is working (or this one already has pending work) it lands in the tab's **outbox**, and while **this** session is streaming it goes into pi's in-session queue (`steering` / `follow-up`). Check `OPEN SESSIONS (QUEUE)` (the `outbox n` badge) and the pinned bar above the editor |
| The order is not the order I clicked | A new message is automatically appended at the **back of the Working group** (it does not cut in line). Use that row's `top` button, or drag it, to cut in line |
| A message went out without serialization | Executions started by an extension cannot be blocked (the scheduler only controls prompts sent from the GUI); or the `serial` checkbox in the top-left is off |
| Queued messages disappeared after a restart | By design: the outbox lives in memory and is not persisted across restarts (so requests are not triggered by accident) |

## Compact

| Symptom | Cause / fix |
|---|---|
| A dialog pops up when you press Compact | Expected guard: while a session is running it asks "wait for it to finish, then compact (default)" or "abort now and compact" |
| `Nothing to compact (session too small)` | The session is too small to have anything worth compacting (not an error) |
| Compaction takes a long time and the transcript looks frozen | Big sessions really are slow (measured 86 MB / 141k tokens: about 5 minutes total, 3–4 of them rewriting the JSONL). Trust the `compaction_end` event; the timeout is 30 minutes |
| Want to abort a compaction that runs too long | Press `Esc` (`session.abort()` calls `abortCompaction()`) → shows `compaction cancelled` |
| Auto-compaction never happens | Check `compaction.enabled` in `~/.pi/agent/settings.json`; the `auto-compact` checkbox next to the editor is per-session (reopening a tab goes back to the global value). With ctx ≥85% and it off, the status bar shows an amber warning |
| Footer `ctx` still shows the pre-compaction number | Should no longer happen (`refreshStats()` runs after `compaction_end`); if you see it, report it together with stderr |

## Export (`/export`)

| Symptom | Cause / fix |
|---|---|
| Export says the session has no session file | The tab has no file to export: pi creates it only after the **first message** (queue row shows `unsaved`), and a tab opened with `--no-session` never has one (`ephemeral`). Send a message first, or open a saved session from `SESSION FILES` |
| Export takes very long | Expected for big sessions: export is model-free (no tokens, no Strata request, and it **skips the serial queue** like `!` bash), but pi re-reads the whole JSONL and rewrites it as HTML — the same cost as the JSONL rewrite during compaction (minutes for 86 MB). The RPC timeout is 30 minutes; the result (or pi's own error text) arrives as a toast when it finishes |
| `export already running (Ns)` | A previous `/export` is still writing (they never stack). Wait for its toast/note, or check the file in the file manager |

## Monitor

| Symptom | Cause / fix |
|---|---|
| Header turns red, `server not reachable` | Wrong address (add `strataUrl` to the settings file) or a key is required (set `STRATAPILOT_KEY` / `STRATA_API_KEY`). The header shows the HTTP status directly (401 is almost always the key); the `server not reachable` label only appears after 3 consecutive failures |
| The Monitor shows an address I did not expect | By default it is derived from the **current tab's** `model.baseUrl` (`/v1` → `/metrics`). To pin it, add `"strataUrl": "http://127.0.0.1:8081/v1"` to `%APPDATA%\StrataPilot\stratapilot_settings.json` |
| `Recent requests` has no prompt / answer text | By design: verbatim text is only retained by Strata's separate `/api-monitor` page, which needs Strata started with `--api-monitor` (or config `"api_monitor": true`). This Monitor reads `/metrics`, which only carries statistics |
| Cards have no history curve / values are 0 | Just started up, or the panel is collapsed (polling at 1 Hz only runs while the panel is open) |
| `Show all` lists only part of the requests | At most the most recent 150 rows are rendered (performance trade-off) |

## Drag & drop / attachments

| Symptom | Cause / fix |
|---|---|
| Dropping a file does nothing, or only a path appears | Expected: only png/jpg/gif/webp (≤8 MB) become RPC `images` attachments; every other file or folder is inserted as an **absolute path** for pi to read with the `read` tool |
| A dropped folder is not expanded into files | By design: only the folder path is inserted |
| An image ended up as inline text | Only files whose absolute path cannot be resolved are inlined; images are never inlined (they are attached or rejected with a toast) |
| Image rejected | Larger than 8 MB, or a format outside png/jpg/gif/webp |
| `Ctrl+V` with a screenshot does nothing | A clipboard image is attached only when it is png/jpg/gif/webp and ≤8 MB — a `bmp`/`tiff` screenshot shows an "unsupported image type" toast (re-capture as png, or save it to disk and **drop** it: a dropped file is inserted as a path instead). Nothing is attached while a dialog or the slash palette is open, by design |
| Pasted image is rejected with its size in the toast | A clipboard image has no file path to fall back on, so anything over 8 MB is refused (`image too large: … is 9.2 MB (9646899 bytes, max 8.0 MB)`). Save it as a file and drop it instead, or shrink it |
| Pasting text stopped working? | It does not: a paste is only hijacked when the clipboard actually carries a file/image, plain text always reaches the composer |

## Bash (`!`) and slash commands (`/`)

| Symptom | Cause / fix |
|---|---|
| `!cmd` was sent as a normal message | Bash mode only kicks in when the composer has no attachments / images — remove the attachments, or send the command by itself |
| Toast: "a bash command is already running in this session" | pi allows one per tab: press `Esc` (sends `abort_bash`) first |
| The model never mentions the command output | Expected: the recorded output is attached to your **next** message. `!!cmd` deliberately keeps it out of the model context |
| A long-running command looks stuck | The card streams whatever the command prints; if it prints nothing the card just says `running…`. `Esc` aborts it |
| Card says `output truncated` | pi caps the inline output and writes the full log to `fullOutputPath`, shown (clickable) in the card footer |
| `/settings`, `/hotkeys` and the other TUI commands do nothing | They are interactive-mode only and are not part of RPC mode; the palette list comes from `get_commands` (extension commands, prompt templates, skills) |
| The slash palette does not appear | It only shows while you are typing the command word itself — once you type a space (arguments) it closes. `Esc` also closes it |
| `/foo` is not in the list but still gets sent | Anything unknown is passed to pi as written, where it reaches the model as plain text |
| A card shows `bash started by an extension` | An extension ran the command itself; the GUI only sees its output events, not the command line |

## Other

| Symptom | Cause / fix |
|---|---|
| An extension's `custom()` component does nothing | RPC mode does not support pi TUI `custom()` components or theme switching (the degradations described in the pi docs) |
| The `/tree` branches are not visible | `get_messages` returns only the current active branch; branch switching has no UI yet |
| Many open tabs feel slow | Each tab is a `pi --mode rpc` process, so memory grows linearly with the tab count |
| Settings lost / want a reset | `%APPDATA%\StrataPilot\stratapilot_settings.json` (delete it to reset; the older `pi-gui` and `Pi on Strata` files are migrated on first launch) |
| The **Usage** chart is empty on a fresh install | expected: the ledger (`%APPDATA%\StrataPilot\token_usage.json`) is built from the session files, and it fills in as sessions run. Opening the dialog rescans, and **Recount from files** rebuilds it from what is on disk. Deleting the ledger file is safe - the next scan recreates it |
| The Usage numbers are lower than the session list says | a session bigger than the 12 MB scan cap is only read up to that point; the dialog says how many sessions were affected (`N session(s) were bigger than the 12 MB scan cap`) |
| The Usage chart shows tokens for sessions I already cleaned up | deliberate: deleting a session file does not delete its cost history. **Recount from files** drops the entries whose file is gone (`N of them no longer exist on disk` in the dialog header) |

## What to include when reporting an issue

**Press the topbar `Diagnostics` button (or type `/diagnostics`, or use menu Help ▸ Copy
Diagnostics).** It copies a report holding items 2–5 below — versions and paths, the pi install,
Strata `/health` and `/v1/models`, both model configs with keys redacted, every open tab's queue
state and the log tail — and saves the same text to
`%APPDATA%\StrataPilot\diagnostics\stratapilot_diagnostics_<timestamp>.txt`. Paste it in and add
item 1; only collect the pieces by hand if the app will not start at all.

1. The symptom plus reproduction steps (which tab, what you pressed)
2. The tail of `%APPDATA%\StrataPilot\logs\stratapilot.log` (menu **Help ▸ Open Log Folder**) —
   the startup banner plus the last `[renderer error]` / `[crash]` / `[fatal]` / `[pi exit]` lines;
   stderr from `npm start` if you can start it from a terminal
3. The first four lines of `node test/smoke-rpc.js <cwd>` (cli / node / pi version / sessions root)
4. pi version (`~/.pi/agent/install/current-version`), Strata version, the output of `curl
   http://127.0.0.1:<port>/health`, and both model configurations — pi's `models.json` and Strata's
   `strata-<model>.json` (**redact the key**; the report does that for you, and it can include the
   Strata config when `strataConfigPath` is set in the settings file)
5. For queue / compact issues: a screenshot of `OPEN SESSIONS (QUEUE)` (Working/Idle groups and
   badges) — the report prints the same rows as text under `[6] open sessions / queue`
5. For queue / compact issues: a screenshot of `OPEN SESSIONS (QUEUE)` (Working/Idle groups and badges)
