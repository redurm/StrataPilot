# Pi on Strata

A desktop GUI for the pi coding agent running against a local Strata server (Electron + pi RPC mode).
Each tab is its own `pi --mode rpc` process, so you can have **several sessions open at the same
time**; because Strata handles only one request at a time, sends across sessions are ordered by the
built-in **serial queue**.

> Renamed from `pi_gui`: the app name, the settings file
> (`%APPDATA%\Pi on Strata\pi_on_strata_settings.json`, the old file is carried over automatically on
> first launch) and the environment variable prefix (`PI_GUI_*` → `PI_ON_STRATA_*`) are all updated.
> The **project folder** itself has to be renamed with `..\rename_pi_gui.ps1` (you must leave the pi
> conversation first, otherwise Windows blocks it). That script also fixes the pi sessions folder
> name, the `cwd` recorded inside session files, and the paths stored in the app settings.

## Quick start (TL;DR)

Four steps. The first two are one-time setup: **this repo is only the GUI — it ships no model and no
pi**.

**1) Install Strata (the local LLM server)**

```bash
# On Windows you can also just download the zip from the Strata site and unzip it
git clone https://github.com/Niko1221/Strata.git && cd Strata
# Windows: double-click START-HERE.bat (first run installs Python, detects the GPU,
#          picks a model that fits, downloads it and starts the server)
# Linux: ./setup.sh    Mac (Apple Silicon): xcode-select --install once, then ./setup.sh
```

Once it is running, open `http://127.0.0.1:8081/metrics` in a browser — JSON means the server is up.

**2) Install pi (the coding agent)**

```powershell
powershell -c "irm https://pi.dev/install.ps1 | iex"   # Windows
# curl -fsSL https://pi.dev/install.sh | sh            # macOS / Linux
pi --version    # pi requires Node.js 22.19+ (the installer provides it if missing)
```

**3) Point pi at Strata** (one-time setup)

Add Strata as a provider in `~/.pi/agent/models.json` and set `defaultProvider` in
`~/.pi/agent/settings.json`. **Every value comes from your Strata install** — the mapping and the
commands that read them: [Connecting pi to Strata](#connecting-pi-to-strata-one-time-setup).
After this, plain `pi` works in a terminal — and only then does the GUI's model dropdown have
anything in it.

**4) Install this repo and start it**

```bash
git clone <this repo> && cd pi-on-strata
npm install     # single devDependency: Electron (~100 MB)
npm start
```

In the window: `Ctrl+T` → pick a working folder → choose model / thinking in the top bar → type and
send. `Ctrl+M` opens the Strata Monitor. All shortcuts: [Keyboard shortcuts](#keyboard-shortcuts).
If something breaks, start at [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Features

- **New session**: `Ctrl+T` opens a new tab (choose working folder, session name, and whether it is
  ephemeral / not saved); `Ctrl+Shift+N` resets the current tab in place via RPC `new_session`.
- **Session switcher**: the sidebar lists every saved session under `~/.pi/agent/sessions/` at once
  (all projects, no scope to switch). Each row shows the **working folder** it was started in — the
  folder name is highlighted when it matches the active tab, and clicking the path opens that folder in
  the OS file manager. `Search…` matches titles, message text and folder paths.
  - Click a row → open it in a new tab (`pi --session <path>`)
  - `this tab` → load it into the current tab via RPC `switch_session`
  - `name` / `del` → rename (appends a `session_info` entry) / delete the file
  - Tab strip: double-click a tab or press `F2` to name the session
- **Working folder always visible**: the composer carries a `folder` chip with the active session's
  working folder (click to open it in the OS file manager); queue rows show each open tab's folder name,
  and Session files rows show the folder every saved session was started in
- **Drag & drop files, or paste them**: drop a file or folder anywhere on the window, or press
  `Ctrl+V` (or right-click → Paste) with something on the clipboard → it becomes an attachment chip
  - Images (png/jpg/gif/webp, ≤8 MB) → sent as RPC `images` (base64); the chip shows a thumbnail
  - Anything else → a list of **absolute paths** is inserted, and pi reads them with the `read` tool
  - If the absolute path cannot be resolved, it falls back to inlining the content
  - The `Attach files` button uses the same pipeline
  - A clipboard image has no file path, so it always goes down the `images` route; when the clipboard
    gives no name it is called `pasted-1.png`, `pasted-2.png`, … (de-duplicated per paste)
  - Pasting plain text is untouched; while a dialog (including the extension UI dialogs) or the
    slash palette is open, paste is never hijacked
- **Shell & slash commands**: `!cmd` runs a shell command in the session folder (streaming output
  card, `!!cmd` keeps the output out of the model context); `/` opens a command palette
  (`/compact`, `/model`, `/stats`, …) and hands anything else to pi
- **Serial queue (Strata is half-duplex)**: the sidebar's `OPEN SESSIONS (QUEUE)` splits open tabs
  into **Working** and **Idle** groups and runs one session at a time, in list order (see below)
- **Strata Monitor** (`Ctrl+M`): a built-in monitor page for the Strata server (ported from
  `C:\Strata\strata-src\serve\web`) — model state, speed, GPU/VRAM/temperature/power/PCIe/CPU/disk,
  context fill and recent requests, without leaving the app
- **Streaming output**: assistant text / thinking (collapsible) / tool call cards (args, live partial
  output, result, duration)
- **Message actions on hover**: hovering a message (or tabbing into it) reveals small actions in its
  head — `copy` puts the **raw markdown source** of that message on the clipboard (never the rendered
  HTML, and never thinking / tool output), and user messages also get `resend`, which puts the original
  text back into the editor and sends it through the normal Send path, so busy mode (`steering` /
  `follow-up`) and the serial queue behave exactly as for a typed message; if the editor already holds a
  draft you are asked first (and can edit it before sending). `resend` does not re-attach the original
  images (their base64 blobs may be gone), and an image-only message has no `resend`. The buttons are
  invisible until hover, so they never shift the layout, and they exist on messages rendered from
  history as well as live ones.
- **Pinned request bars**: the chat pane keeps the request pi is working on **right now** pinned at the
  very top (`WORKING ON` + where it came from + elapsed time + `↓ jump` scrolls to that message), and
  lists everything **not processed yet** just above the editor — queued `steering`, `follow-up` and this
  session's serial-queue outbox, one row each with its full text in the tooltip. Both bars describe the
  visible tab only, and hide themselves when there is nothing to pin.
- **Markdown rendering** (`renderer/markdown.js`, zero dependencies): headings, lists, quotes,
  rules, code blocks (with copy button) and **GFM tables** (`:---` / `:---:` / `---:` alignment,
  automatic padding/truncation when column counts differ, `\|` escaping, bold/code spans inside
  cells; tables take shape while streaming)
- **Hyperlinks**: every `http(s)://` in all chat text (assistant, user, thinking, tool args/output,
  notes) becomes clickable; clicking opens the **default browser** (never a second Electron window)
- **Model & thinking**: dropdowns (`get_available_models` / `set_model` /
  `get_available_thinking_levels` / `set_thinking_level`)
- **Sending while busy**: `steer` or `follow-up` (dropdown), `Esc` to abort, `Clear queue` pulls the
  queued messages back into the editor; while they wait, the bottom bar shows their text (the top bar keeps
  showing the request that is running, and switches to the steering message once pi delivers it)
- **Compact**: manual context compaction; the status bar shows context usage, tokens and cost; the
  **`auto-compact`** checkbox next to the editor toggles auto-compaction for this session (see below)
- **Extension UI bridging**: `select` / `confirm` / `input` / `editor` emitted by an extension become
  in-window dialogs; `notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text` are shown too
- **Settings dialog** (topbar **Settings**, `Ctrl+,`, `/settings`): working folder, serial queue,
  reopen-tabs, fixed Strata address, Strata config path for the report, Monitor open/width, sidebar,
  plus one-click access to the settings file, the log file and the sessions folder — nothing needs a
  hand edit of the JSON any more
- **Diagnostics report**: the topbar **Diagnostics** button (`/diagnostics`, menu **Help ▸ Copy
  Diagnostics**) copies one pasteable block for a bug report — versions and paths, the pi install,
  Strata `/health` + `/v1/models`, both model configs, every open tab's queue state and the log tail —
  with keys redacted, and saves the same text under `%APPDATA%\Pi on Strata\diagnostics\`
- Tabs that were open on exit are restored on next launch (up to 4)

## The two sidebar lists (why some rows overlap and others don't)

They come from **different sources**, so they partially overlap:

| | `OPEN SESSIONS (QUEUE)` | `SESSION FILES` |
|---|---|---|
| Source | The **open tabs** held in memory (one `pi --mode rpc` process per tab) | Session JSONL files on disk (`~/.pi/agent/sessions/`) |
| Purpose | Serial execution order, drag to reorder, outbox | Find / open / load / rename / delete past conversations |
| Lifetime | Gone when the tab closes | Permanent |

Display rules:

- **In both lists**: that session file is open in a tab → the Session files row shows a blue
  **`open #n`** badge (`#n` is its position in the queue above), and the row for the current tab is
  highlighted
- **Only in the top list**: the tab has no file yet → the queue row shows **`unsaved`** (pi creates the
  file only after the first message) or **`ephemeral`** (chosen when opening the tab; it will never
  appear in Session files)
- **Only in the bottom list**: past sessions not open in any tab
- **There but hidden**: `Search…` filters Session files (this only affects that list, never the queue),
  and shows only the 400 most recent entries
- Also: `this tab` (`switch_session`) or `Ctrl+Shift+N` repoints the tab at **another** session file,
  while the old file stays in Session files — hence the "it was there a second ago, now it's not in
  the queue" case

### Export a session

`/export [path]` (composer or palette) turns the current session into a standalone HTML page.
pi writes the file itself (RPC `export_html`) and returns the path it used; the GUI only picks
the path: no argument opens the native Save dialog (default name from the session name / session
file / session id, inside the session's working folder; cancelling the dialog does nothing), an
argument must be an absolute path ending in `.html`. Afterwards the file manager opens with the
file selected and the path is printed into the transcript.

- A tab with **no session file** cannot be exported (`unsaved` before the first message, or
  `ephemeral`): pi has nothing to export, the GUI says so in a toast instead of calling the RPC.
- Refused while the session is **running or compacting** — pi is appending to the file, exporting
  mid-write is racy (same guard style as `/compact`). A second `/export` while one is in flight
  does not stack: it toasts `export already running (Ns)`.
- Export never calls the model, so like `!` bash it deliberately **skips the serial queue**. A huge
  session still takes minutes (pi re-reads the whole JSONL and rewrites it as HTML), so the RPC
  timeout is 30 minutes like compaction's.

## Serial queue (one session at a time)

Providers like Strata are single-flight, so the GUI has a scheduler (`scheduler` in
`renderer/app.js`). The **serial** checkbox in the top-left `OPEN SESSIONS (QUEUE)` turns it on or
off (on by default, remembered in settings).

### Behaviour

1. The list order (`state.order`) *is* the execution order — **the top row runs first**.
2. Pressing Send in another tab while some session is already running → the message is not handed to
   pi directly; it goes into that tab's **outbox**, the tab immediately joins the **Working** group and
   is **appended at the end of that group** (it never cuts in front of sessions that were already
   queued). Sending again from a tab that is already in Working → it just appends to its own outbox
   (FIFO within the session), position unchanged. To cut in line: use that row's `top` button or drag
   it (a manual order is not overwritten by the automatic placement, unless you press Send in a new
   session again).
3. When the running session emits `agent_settled`:
   - its own outbox still has items → the next one is sent ("keep working until idle")
   - the outbox is empty → the tab moves to the **Idle** group and the scheduler starts the first row
     of Working
4. Pressing Send while the *same* session is already running → pi's own in-session queue
   (`steer` / `follow-up`, switched in the dropdown); it does not go into the outbox.
5. Both the tab strip and the queue rows show state:
   - green dot = running
   - amber dot + `#n` = queued (position n)
   - grey dot = idle
   - `+1` / `outbox 1` badge = number of messages waiting in that session's outbox

### Controls

| Action | How |
|---|---|
| Change execution order | **Drag** a queue row (dropping on the upper/lower half of another row inserts at that position); the order syncs to the tab strip |
| Move to the front | Hover the row → `top` button |
| Put a new message at the back | Just press Send in an idle tab (automatic; the toast says `back of the line`) |
| Inspect pending messages | Click the `outbox n` badge → `next` (reorder to next) or `remove` |
| Drop pending messages | That row's `drop` button |
| Turn serial mode on/off | The `serial` checkbox (off = tabs run in parallel, original behaviour) |

> Note: the outbox lives in memory; restarting the GUI does not resend it (to avoid triggering
> requests by accident).

## Bash mode (`!`) and slash commands (`/`)

Same prefixes as pi's own TUI, wired to the RPC commands pi already exposes.

### `!command` — run a shell command

- Type `!git status` (the composer border turns amber while you type it) and Enter runs it through
  pi's RPC `bash` in the session's working folder. A card appears, output streams in via
  `bash_execution_update` events, then the exit code and duration land in the card footer.
- `!!command` records the output in the session but keeps it **out of the model context**.
- The output reaches the model with your **next** message: pi turns the recorded `bashExecution`
  message into a user message (`Ran \`cmd\`` plus fenced output). Nothing is sent just because you
  ran a command.
- bash never touches the model, so it deliberately **skips the serial queue** — it can run while
  another tab is generating.
- `Esc` (or the `Stop` button) sends `abort_bash`. One bash command per tab at a time (pi's own
  limit): a second `!cmd` while one runs is refused with a toast.
- Very long output is truncated by pi; the card shows the `fullOutputPath` log file when that
  happens.
- Cards survive a reopen: pi stores every run as a `bashExecution` message in the session file, and
  the GUI renders those with the same card style.
- Commands started by an extension (not by you) also get a card, as soon as their first output event
  arrives.

### `/command` — the command palette

Typing `/` opens a palette: `↑`/`↓` to move, `Tab` or `Enter` to complete the highlighted name (a
second Enter sends it), `Esc` to close. Rows tagged `app` are executed by the GUI; everything else is
passed to pi, which expands extension commands, prompt templates and `/skill:name`.

| Command | What it does |
|---|---|
| `/compact [instructions]` | compact this context; while the session is running it asks first (inline instructions are queued until the session goes idle) |
| `/export [path]` | save this session as HTML (pi's `export_html`); no argument opens the native Save dialog, an argument must be an absolute `*.html` — see "Export a session" under the sidebar lists |
| `/model [provider/id]` | pick a model from a list, or set one by (partial) name |
| `/thinking [level]` | show the available levels, or set one |
| `/new`, `/clear` | start a new session in this tab |
| `/rename <name>` | name the current session |
| `/abort` | stop the current run or bash command |
| `/resume` | focus the session search in the sidebar |
| `/settings` | open the Settings dialog (the topbar button or `Ctrl+,`) |
| `/stats` | print tokens / cost / context usage into the transcript |
| `/monitor` | toggle the Strata monitor |
| `/diagnostics` | copy a diagnostics report for a bug report (see [One-click diagnostics report](#one-click-diagnostics-report)) |
| `/commands`, `/help` | list the app commands plus everything `get_commands` reports from pi |

pi's built-in TUI commands (`/settings`, `/hotkeys`, …) do not exist in RPC mode — the palette list
comes from `get_commands`, which only reports extension commands, prompt templates and skills. An
unrecognised `/foo` is sent to pi as written (it then reaches the model as plain text).

## Installation, configuration and first run

### 1. Prerequisites

| Requirement | How to check | Notes |
|---|---|---|
| Windows 10/11 x64 | — | Developed on Windows (paths, `%APPDATA%`, PowerShell scripts) |
| Strata server running locally | Open `http://127.0.0.1:8081/metrics` in a browser | e.g. `C:\Strata\strata-src\START-HERE.bat` (first run installs Python and a model). This app is only the GUI, **it brings no model** |
| pi coding agent installed | `pi --version`, or look at `~/.pi/agent/install/current-version` | This app does not use the pi SDK; it spawns `pi --mode rpc` directly. Install command: see Quick start |
| Node.js **22.19+** on PATH | `node -v` | Hard requirement of pi, and needed for `npm install`. The pi child process prefers the `node` on PATH (if none is found it falls back to `electron.exe` acting as node, see `lib/pi-launch.js`) |
| Electron can be downloaded | `npm install` succeeds | Only one devDependency (`electron`); everything else is dependency-free (the markdown renderer and session parsing are hand-written) |

### 2. Connecting pi to Strata (one-time setup)

The GUI reads pi's own configuration, so **add Strata as a provider in pi first** — only then does the
GUI's model dropdown list anything.

**Do not copy anyone's provider block: pi's values are decided by *your* Strata config.** Read them
from the engine config Strata was started with — the JSON named by `--config` in the launcher, e.g.
`run-iq3_s.bat` → `C:\Strata\strata-src\strata-iq3_s.json` — or, better, from the running server:

```bash
curl -s http://127.0.0.1:8081/v1/models
# {"data":[{"id":"qwen3.8-flash-next-iq3_s","meta":{"n_ctx":262144},
#           "architecture":{"input_modalities":["text","image"],…}}]}
curl -s http://127.0.0.1:8081/health
# {"max_context":262144,"model":"qwen3.8-flash-next-iq3_s","images":true,"api_key":false}
```

| pi field in `~/.pi/agent/models.json` | the Strata side it has to match |
|---|---|
| provider `baseUrl` | the port Strata actually listens on: `--port` in the launcher `.bat` (it wins) or `"port"` in the config → `http://127.0.0.1:<port>/v1` |
| `models[].id` | `"model_name"` in the config (else the family default) — exactly the `id` `/v1/models` reports. pi puts that name in every request, so a mismatch is a "model not found" |
| `apiKey` | Strata's key: `"api_key"` in the config, `--api-key`, or `$STRATA_API_KEY`. When `/health` says `"api_key": false` the server has none — put any non-empty placeholder (`"strata"`): pi needs a key to list the model, Strata ignores it |
| `models[].contextWindow` | `--max-context` in the config's `args` = `/health`'s `max_context` = `/v1/models` `meta.n_ctx` |
| `models[].input` | add `"image"` only when the config has a `vision` section or `--vision` in `args` (`/health` `"images": true`) |
| `models[].reasoning` | `true` when that build thinks: the config carries `reasoning_budget_tokens` / `reasoning_close_retry` / `reasoning_effort` |
| `models[].maxTokens` | the output cap pi asks for — keep it well below `contextWindow`. With `"fit_max_tokens": true` in the Strata config the server shortens it to the room left; without it, prompt + `max_tokens` over the context is a 400. Strata also caps the thinking budget at `max_tokens` minus a quarter of it, so a small `maxTokens` starves the answer |
| `models[].cost` | all zeros — a local server |

The config above (`port 8081`, `model_name qwen3.8-flash-next-iq3_s`, `--max-context 262144`,
`--vision`, `reasoning_budget_tokens 16384`, no `api_key`) therefore gives this
`~/.pi/agent/models.json`:

```json
{
  "providers": {
    "strata": {
      "name": "Strata Flash-Next (local)",
      "baseUrl": "http://127.0.0.1:8081/v1",
      "api": "openai-completions",
      "apiKey": "strata",
      "models": [
        {
          "id": "qwen3.8-flash-next-iq3_s",
          "name": "Qwen3.8-Flash-Next IQ3_S (Strata)",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 262144,
          "maxTokens": 32768,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

Only `id` is required by pi's schema (`models.schema.json`); the rest is metadata pi acts on — when to
compact, whether it may attach images, which thinking levels it offers, what it prints as cost. Wrong
metadata still reaches the server, it just misjudges all of those.

Set the defaults in `~/.pi/agent/settings.json` (`defaultModel` must be that same `id`; you can still
switch in the top bar after launch):

```json
{ "defaultProvider": "strata", "defaultModel": "qwen3.8-flash-next-iq3_s" }
```

> Two keys, don't mix them up: the `apiKey` in `models.json` is what pi sends to `/v1/*`,
> `PI_ON_STRATA_KEY` below is what the Monitor sends to `/metrics`.
>
> Re-running `START-HERE.bat --calibrate`, or editing the Strata config, can change `--max-context`
> and the port. Re-read the two endpoints above afterwards and update `contextWindow` / `baseUrl` —
> the auto-compaction trigger point and the Monitor's context-fill donut both follow `contextWindow`.

### 3. Installing and starting this repo

```bash
cd pi-on-strata
npm install          # installs Electron (fast if cached)
npm start            # electron .
```

- Only **one instance** is allowed (`requestSingleInstanceLock`); running `npm start` again just gives
  focus to the window that is already open.
- Tabs that were open are restored on the next launch (up to 4).
- To start without a terminal: `start "" /b npm start`, or make a shortcut pointing at `electron .`.
- There is **no packaging script** (no electron-builder config): for a standalone exe use
  `electron-packager` / `electron-builder` yourself, or keep using `npm start`.
- To check the environment without the UI (no Electron, no prompt sent):

  ```bash
  node test/smoke-rpc.js C:/some/project
  # prints cli: / node: / pi version: / sessions root: and then does one RPC round trip
  ```

  The first four lines are exactly what `lib/pi-launch.js` resolved; `cli: null` means pi was not
  found and you need the environment variables from the next section.

### 4. Environment variables (all prefixed `PI_ON_STRATA_*`)

Normally you set **nothing**; only override when auto-detection fails.

| Variable | Purpose | Default |
|---|---|---|
| `PI_ON_STRATA_PI_CLI` | Path to pi's `cli.js` | Resolved from `~/.pi/agent/install/current-version` → `releases/<ver>/node_modules/@earendil-works/pi-coding-agent` |
| `PI_ON_STRATA_NODE` | Node executable used to run pi | `node` on PATH; otherwise `electron.exe` + `ELECTRON_RUN_AS_NODE=1` |
| `PI_MANAGED_INSTALL_ROOT` | pi installation root | `~/.pi/agent/install` |
| `PI_ON_STRATA_KEY` / `STRATA_API_KEY` | API key the Monitor uses for `/metrics` | Empty (no key); can also come from the tab model's `apiKey` |
| `PI_CODING_AGENT_SESSION_DIR` | Session JSONL root folder | `~/.pi/agent/sessions` |
| `PI_ON_STRATA_SMOKE*` | Developer smoke mode | See [Smoke mode](#smoke-mode-for-development) |

Example:

```bash
PI_ON_STRATA_PI_CLI="C:/Users/you/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" \
PI_ON_STRATA_NODE="C:/Program Files/nodejs/node.exe" \
PI_ON_STRATA_KEY=llama npm start
```

### 5. Application settings file

`%APPDATA%\Pi on Strata\pi_on_strata_settings.json` — written and **edited by the GUI itself**: the
topbar **Settings** button (`Ctrl+,`, also `/settings`) is a form over every key below, it saves and
applies the change straight away (queue switch, Monitor width, sidebar, working folder). Hand-editing
the file still works — press `Ctrl+R` to reload, or reopen the Settings dialog to see the values.

| Key | Meaning |
|---|---|
| `windowBounds` | Window size / position |
| `cwd` | Default working folder for new tabs |
| `openTabs` | Tabs to restore (session paths), up to 4 |
| `serialQueue` | Serial queue on/off |
| `restoreTabs` | Set to `false` to stop reopening last run's tabs (`true` unless set) |
| `sidebarHidden` / `monitorOpen` / `monitorWidth` | Sidebar, Monitor panel state and width |
| `strataUrl` | Fixed Strata address for the Monitor (e.g. `http://127.0.0.1:8081/v1`); if absent it is derived from the current tab's `model.baseUrl` |
| `strataConfigPath` | Optional path of the Strata engine config (`C:\Strata\strata-src\strata-<model>.json`): only used to include that file, keys redacted, in the diagnostics report |

The old `pi-gui` settings file is migrated automatically on first launch (see the note at the top).

## Auto-compaction (identical to the CLI)

Every tab is a real `pi --mode rpc` process reading the same `~/.pi/agent/settings.json`, so
**auto-compaction is already on** — the GUI does not have to implement anything:

| pi setting (`compaction`) | Default |
|---|---|
| `enabled` | `true` |
| `reserveTokens` | `16,384` (space reserved for the next request) |
| `keepRecentTokens` | `20,000` (recent content kept after compaction) |
| `modelOverrides["provider/model"]` | Can override those three values per model |

When it triggers: pi checks inside the agent loop (after the assistant message ends, before the next
one starts) whether the context is nearly full / overflowing, and compacts by itself. **Auto
compaction never cuts off a reply that is being generated**; only a **manual** Compact calls
`abort()` first (reason: [Compaction and an in-flight request](#compaction-and-an-in-flight-request-not-a-bug-but-confusing)).

What the GUI shows and lets you change:

- When it happens the transcript shows `compacting (auto)…`, then `compacted 183k → ~24k tokens`
- The **`auto-compact`** checkbox next to the editor: toggles **this session** via RPC
  `set_auto_compaction` (each tab independently); the state is read back from
  `get_state.autoCompactionEnabled` (reopening a tab goes back to the global setting)
- If you turn auto-compact off and ctx is already ≥85%, the status bar shows an amber warning
  `auto-compact off · compact before it overflows`, so you do not hit overflow blind
- To turn it off **permanently**: set `"compaction": { "enabled": false }` in
  `~/.pi/agent/settings.json`

## Compaction and an in-flight request (not a bug, but confusing)

In pi 1.2.0 the first line of `AgentSession.compact()` is `await this.abort()`, and the source
comment is explicit:

> *Aborts the current agent operation first. Manual compaction never retries or continues the interrupted agent turn.*

So **pressing Compact while a session is running** aborts the in-flight request, and Strata's
`Recent requests` gets a `Closed` row (client disconnect). Worse: if the session is too small
(`Nothing to compact (session too small)`), the reply is still killed and nothing was compacted.
That is pi's designed behaviour, not a Strata or Pi on Strata bug.

Pi on Strata's guard: pressing Compact while a session is running (streaming / outbox / running in the
serial queue) asks first:

1. **Wait for it to finish, then compact (recommended, default)** — queued as `pendingCompact`,
   executed automatically on `agent_settled` (and it compacts *before* running that session's queued
   outbox messages)
2. **Abort now and compact** — keeps pi's native behaviour (you will see the disconnect)

Measured comparison (same smoke session, same prompt):

| Behaviour | Strata result |
|---|---|
| Before the fix: `compact` sent during generation | `finish=disconnect`, out=494, dur=8.9 s (reply cut off) |
| After the fix: wait for idle, then compact | `finish=stop`, out=1608, dur=22.9 s (finished fully, compacted after settle) |

> Automatic compaction (`compaction_start reason=auto`, triggered when the context is nearly full)
> goes down the same road, but pi only checks it while the agent is idle, so it never cuts off a
> reply that is being generated.

## Compact no longer reports a fake timeout (fixed)

`rpc-mode` handles it as `const result = await session.compact(...)` — meaning **the RPC reply only
comes after the whole compaction finished**. Compacting a big session really is slow, measured
(86 MB / 141k token session):

| Stage | Actual time |
|---|---|
| Summary model call (prompt 82,310 → out 295) | **71.4 s** |
| Rewriting the 86 MB session JSONL + scanning | **about 3–4 minutes** |
| The whole `compact()` | **about 5 minutes** |

The old GUI had a **180 second** timeout on the compact RPC, so pi was still running — and eventually
succeeded (the Monitor's context dropped from 93.7% to 40%) — while the transcript already showed red
text `compaction failed: timeout after 180000ms`, and the footer `ctx` stayed at the old value.

Current behaviour:

- Timeout raised to **30 minutes** (`COMPACT_TIMEOUT_MS`), because pi genuinely needs minutes
- **Events are authoritative**: `compaction_start` / `compaction_end` are the real signals. The
  success/failure line comes from `compaction_end` (`compacted 141k → ~24k tokens`); the RPC reply is
  only logged and no longer pushes a duplicate error (on failure it waits 500 ms and stays quiet if
  the event already reported it)
- On a real timeout it queries `get_state.isCompacting`:
  - still running → amber notice `compaction still running after Ns (big session)` and the waiting
    state is kept until `compaction_end` lands
  - no longer running → only then is a real failure reported (with the elapsed seconds)
- After compaction ends `refreshStats()` always runs, so the footer `ctx` no longer sticks at the
  pre-compaction number

Three related problems fixed along the way:

1. **The serial queue treated compaction as "busy"**: pi rejects a prompt sent during compaction with
   `Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.`
   Now `pump()` skips a session that is compacting, and `deliverPrompt()` keeps the message in the
   outbox on that error (no error shown, nothing lost) and retries after `compaction_end`
2. **Pressing Compact during compaction** no longer stacks a second one: it toasts
   `compaction already running (Ns)`, and the `Compact` button is disabled while compacting
3. **If the pi process dies**, the `compacting` flag is cleared, so the queue cannot deadlock forever

> Want to abort a compaction that runs too long? Just press **Esc**. `session.abort()` calls
> `abortCompaction()`, pi then emits `compaction_end` (`aborted: true`) and the GUI shows
> `compaction cancelled`.

## Strata Monitor (server monitoring)

Toggle with the `Monitor` button in the top bar or `Ctrl+M`. The data source is Strata's
`GET /metrics` (JSON) — the same endpoint Strata's own Monitor page uses; it is **fetched by the main
process as a proxy**, so the renderer's CSP does not block it.

What it shows (polled once per second, stops while the panel is collapsed; the panel has no
Refresh/Hide buttons of its own — toggle only via the top bar `Monitor` or `Ctrl+M`; clicking the URL
in the header opens Strata's web page in a browser):

- **Model state**: Idle / Reading / Generating / Queued / Error badge + progress bar (reading shows
  the prompt read percentage, generating shows generated tokens and live tok/s)
- **8 cards** (with sparkline history): Speed (decode + prefill as two curves), GPU load, VRAM,
  GPU temp, Power, PCIe (Gen/width/MB/s to the GPU), CPU, Disk read
- **Context fill** donut: how much of the context window the current (or last) request's
  prompt+output takes (turns amber at ≥75%, red at ≥90%; the ring is driven by inline style, not a
  presentation attribute)
- **Experts in VRAM / System RAM / GPU temperature** bars + engine info (model, ctx, kv, version)
- **Recent requests** table: time, status, prompt, reused, output, prefill t/s, decode t/s, VRAM hit
  rate (`+x%P` = PCIe share, hover for an explanation), duration; `Show all (N)` toggles everything
  (maps to `metrics?requests=all`) + a totals row at the bottom

### Address and key

- By default derived from the current tab's `model.baseUrl` (e.g. `http://127.0.0.1:8081/v1` →
  `http://127.0.0.1:8081/metrics`)
- To pin an address: set `strataUrl` (e.g. `{"strataUrl": "http://127.0.0.1:8081/v1"}` in
  `%APPDATA%\Pi on Strata\pi_on_strata_settings.json`)
- If the server requires an API key: set `PI_ON_STRATA_KEY` or `STRATA_API_KEY`
- Clicking the URL in the header opens Strata's web page in the default browser
- When unreachable the header turns red and shows the error (after 3 consecutive failures it marks
  `server not reachable`)

> The `requests` data in `/metrics` (latency, tokens, hit rate and other statistics) is always
> available, no switch needed. Only the **verbatim prompt / answer text of each request** belongs to
> the separate `/api-monitor` page, which requires Strata to run with `--api-monitor` (or config
> `"api_monitor": true`) to retain it; this app's Monitor does not read that page.

## How links are handled

- `linkify()` in `renderer/markdown.js`: escapes first, then wraps bare URLs in `<a>`; trailing
  `, . ; : ! ?` are not swallowed into the URL, CJK full-width punctuation (`，。、；：！？（）`)
  acts as a URL boundary, while ASCII parentheses in
  `https://en.wikipedia.org/wiki/Foo_(bar)` are kept intact
- Assistant text goes through the full markdown renderer (`[text](url)` and bare URLs both work);
  user messages, thinking, tool cards and notes go through `linkify()` (links only, no other markdown,
  line breaks preserved)
- Streaming thinking / tool output uses `setPreText()` / `appendPreText()`: innerHTML is re-applied
  only when the text contains `http`, so long output is not re-rendered per delta
- Clicks are caught at the `document` level → `api.openExternal(href)` → `shell.openExternal`
- Belt and braces: the main process has `setWindowOpenHandler` (deny) and `will-navigate` (blocks
  navigation away from the current page), so even `target="_blank"` never opens an extra Electron
  window

## Streaming performance (does collapsing thinking change TPS?)

**No.** The GUI's rendering speed cannot slow Strata's decode in reverse: the main process drains pi's
stdout (JSONL) by itself, `webContents.send` to the renderer is asynchronous, and however slow the
renderer is it cannot push back on the pipe — there is no back-pressure path from the GUI to the
server.

Measured (same machine, same prompt, same code with one switch flipped):

| Case | output tokens | duration | decode tok/s |
|---|---|---|---|
| Deliberately blocking the renderer main thread 40 ms per thinking delta | 1,126 | 24.9 s | **51.2** |
| No blocking at all (normal) | 1,126 | 25.3 s | **50.3** |

Control: the same code and prompt run several times naturally lands decode between **33–65 tok/s**
(VRAM hit rate, prompt length and expert offload all matter). So "TPS looks higher when collapsed" is
mostly (1) natural run-to-run variance and (2) the **perceived** difference caused by the GUI stuttering
and text appearing in chunks when expanded.

Collapsing is still cheaper for the renderer, and the optimization is now really implemented:

- `appendPreText()`: each delta only does `appendChild(textNode)` (O(1)) instead of reassigning the
  whole string; when a `<details>` is **collapsed all DOM writes are skipped**, and it is redrawn once
  from `_raw` when expanded
- Linkification runs exactly once at the end (`thinking_end` / tool end); innerHTML is never re-parsed
  mid-stream
- `autoscroll()`: reading `scrollHeight` forces a synchronous layout, so it is now **rAF-throttled**
  (at most once per frame)
- Tool partial output only appends the new tail instead of redrawing the whole card each time
  (capped at 4,000 characters)
- The Monitor's `Show all` renders at most the most recent **150** rows (previously 500 rows rebuilt
  every second)

> One big item still untouched: opening a huge session (e.g. 86 MB / 600+ messages) makes `renderAll()`
> build the whole transcript into the DOM at once. If needed, lazy rendering (build the last N first,
> fill in on scroll up) is the next step.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Enter` | Send (`Shift+Enter` for a newline) |
| `Ctrl+T` | New session (new tab) |
| `Ctrl+Shift+N` | New session inside the current tab |
| `Ctrl+O` | Focus the session search box |
| `Ctrl+W` | Close tab (terminates that pi process) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch tabs |
| `Ctrl+B` | Show / hide the sidebar |
| `Ctrl+M` | Show / hide the Strata Monitor |
| `Ctrl+,` | Settings dialog (working folder, serial queue, Strata address, Monitor, paths) |
| `Ctrl+V` | Paste: an image (or file) on the clipboard is attached like a drop, plain text goes into the composer |
| `F2` | Name the current session |
| `Tab` | Complete the highlighted slash command (while the palette is open) |
| `Esc` | Abort what is running (agent run, or a running `!cmd`), close a dialog, or close the slash palette |

## Architecture

```
main.js            Electron main process: window, menu, IPC, pi process management
preload.js         contextBridge (window.piGui) + webUtils.getPathForFile
lib/pi-launch.js   resolves the pi CLI and the node executable
lib/pi-process.js  JSONL framing for pi --mode rpc (LF-only line splitting) + command/response pairing
lib/log.js         file log (userData/logs/pi_on_strata.log) + console tee + rotation
lib/sessions.js    scanning/parsing session JSONL (title, name, first message, tokens…)
renderer/          index.html / styles.css / markdown.js / error-report.js / app.js
test/smoke-rpc.js  headless RPC smoke test
docs/TROUBLESHOOTING.md  troubleshooting (split out of the README)
docs/TODO.md             working backlog (tables: what is still missing, effort and priority)
scripts/screenshot.ps1  screenshots (used while developing the UI)
```

Protocol details: see the pi docs `docs/rpc.md`, `docs/rpc-commands.md`, `docs/json.md`,
`docs/session-format.md`.

### Smoke mode for development

```bash
PI_ON_STRATA_SMOKE=1 PI_ON_STRATA_SMOKE_MS=30000 PI_ON_STRATA_SMOKE_PROMPT="Reply OK" npm start
```

Uses an ephemeral session (writes no file), prints the renderer console to stderr, and quits after
`PI_ON_STRATA_SMOKE_MS`. Smoke mode uses a separate profile
(`%TEMP%/pi_on_strata_smoke_profile`) and skips the single-instance lock, so it does not disturb the
GUI you already have open.

Other smoke switches:

| Variable | Effect |
|---|---|
| `PI_ON_STRATA_SMOKE_PROMPT="…"` | Sends one prompt after startup (tests streaming / markdown / tool cards) |
| `PI_ON_STRATA_SMOKE_STEER=1` | Sends a second message to exercise the steer path while busy |
| `PI_ON_STRATA_SMOKE_SESSION=<path>` | Loads a given session with `switch_session` after startup (tests session switching / history rendering); with A2 it also prints `msg_actions=… copy=… resend=…` so you can see the hover actions exist on history-rendered messages |
| `PI_ON_STRATA_SMOKE_QUEUE=1` | Opens 4 tabs and sends 3 messages to test the serial queue (Working/Idle, outbox, order) |
| `PI_ON_STRATA_SMOKE_MONITOR=1` | Opens the Monitor panel right after startup (with `PI_ON_STRATA_SMOKE_PROMPT` you can watch the generating state) |
| `PI_ON_STRATA_SMOKE_COMPACT=1` | Queues a compact during a long generation: "wait for idle" must not kill the request (Strata should show `stop`, not `disconnect`) |
| `PI_ON_STRATA_SMOKE_ORDER=1` | Opens tabs A/B/C, starts B, then sends in C and A; the order should become `B C A` (A moves from first to the back of Working), execution order B → C → A |
| `PI_ON_STRATA_SMOKE_AUTO_COMPACT=1` | Tests `get_state.autoCompactionEnabled` → `set_auto_compaction off/on` → read back; should print `initial=true … now=false … now=true` |
| `PI_ON_STRATA_SMOKE_BASH=1` | Runs `!echo …`, `!!echo …` and `!exit 3`, then `/commands`, and checks the slash palette (`/co` + `Tab`): expect `cards=1 class=bash-card done`, `sign=!!`, `class=bash-card error … exit 3`, and `open=true rows=5` |
| `PI_ON_STRATA_SMOKE_BARS=1` | Sends a long prompt, queues a steer while it runs and prints both pinned bars: expect `top="working on prompt …"` with `bottom="… steering … next turn"`, then `top="last request steering …"` and `bottom="(hidden)"` after the steer is delivered; also checks `↓ jump` (`node=true flashed=true`) |
| `PI_ON_STRATA_SMOKE_PASTE=1` | Synthesises `paste` events carrying a generated 1×1 PNG: expect `files=1 images=1 chips=1 first=pasted-1.png size=70b`, then `images=2 chips=2 first=pasted-2.png`; also checks a two-image paste, `bmp` → "unsupported image type" toast, an 8 MB+ image → "image too large" toast, plain-text paste (`prevented=false`) and the modal guard (`modalOpen=true prevented=false images` unchanged) |
| `PI_ON_STRATA_SMOKE_COPY=1` | Sends a prompt, waits for `agent_settled`, then clicks the user message's `copy` / `resend` (clipboard write is captured in JS): expect `copy_ok=true resend_ok=true composer="" queued=1 label_copied=true assistant_copy_ok=true`. A second tab is generating, so the resent text must land in the **outbox** (queue-aware path), not reach the model; also checks the draft guard (`modal=true` and the draft survives a cancel) and that the buttons survive `renderAll()` |
| `PI_ON_STRATA_SMOKE_EXPORT=1` | Use with `PI_ON_STRATA_SMOKE_SESSION=<path>`: runs `/export <temp>\pi_on_strata_smoke_export.html` (no dialog; override the target with `PI_ON_STRATA_SMOKE_EXPORT_OUT`), then stats pi's returned path through the read-only `fs:stat-paths`: expect `ok=true path=… exists=true bytes=N` |
| `PI_ON_STRATA_SMOKE_DIAG=1` | Clicks **Diagnostics** (clipboard write is captured in JS) and checks the report: expect `copied=1 chars=… lines=… missing_sections=none unredacted_apikeys=0` — all seven sections present and no `apiKey` value left unredacted |
| `PI_ON_STRATA_SMOKE_SETTINGS=1` | Opens the Settings dialog, counts its fields, clicks **Save** and re-reads the file: expect `fields=8 rendered=8 prefilled=3 missing=none saved_monitorWidth=520 css=520px serial=true restoreTabs=true` (the smoke profile keeps these writes away from your real settings) |

```bash
# serial queue test: first should finish before second starts; groups go WWWI → IWWI → IIII
PI_ON_STRATA_SMOKE=1 PI_ON_STRATA_SMOKE_MS=30000 PI_ON_STRATA_SMOKE_QUEUE=1 npm start
```

## Logs and crash diagnosis

Everything the main process prints is mirrored to a file, so a crash can be diagnosed after the
window is gone:

```
%APPDATA%\Pi on Strata\logs\pi_on_strata.log      (Windows)
~/.config/Pi on Strata/logs/pi_on_strata.log      (Linux)
~/Library/Application Support/Pi on Strata/logs/  (macOS)
```

Menu **Help ▸ Open Log Folder** opens it. The file rotates at ~2 MB and keeps two older generations
(`pi_on_strata.log.1`, `.2`). Every record is `[ISO timestamp] [LEVEL] message`.

What lands in it:

| Prefix | Source |
|---|---|
| `appVersion= / electronVersion= / piVersion= / logFile=` | startup banner, so a bug report can start from the log alone |
| `[pi spawn tab=…] ok cwd=… startupMs=` / `failed:` | a tab's pi process starting (or failing) |
| `[pi exit tab=…] code= signal= stderrTail=` | a tab's pi process dying — often what feels like "the UI crashed" |
| `[pi stderr tab=…]` / `[pi log tab=…]` | pi's own output, framed by `lib/pi-process.js` |
| `[renderer 3] … (file:line:col)` | renderer console errors/warnings |
| `[renderer error] …` + stack | uncaught renderer exceptions and unhandled rejections (`renderer/error-report.js`) |
| `[crash] renderer gone reason=… exitCode=` | the renderer process died (white window) |
| `[crash] renderer unresponsive` / `responsive again` | the renderer stopped replying for >30 s |
| `[crash] … process gone reason= code=` | any Electron child process (GPU, utility…) died |
| `[fatal] uncaughtException (source):` + stack | main-process crash — the app quits, but the stack is on disk |
| `[error] unhandledRejection:` | main-process promise rejection (does not quit) |

Notes:

- Logging is best-effort: if the log file cannot be opened the app keeps running and says so once
  (`[log] disabled, cannot open log file: …`).
- Smoke mode writes its own log under `%TEMP%/pi_on_strata_smoke_profile/logs/`, so automated runs
  never touch the real one.
- A renderer exception used to be invisible: nothing was written to disk, no crash dump, no Windows
  error report. If the UI ever freezes or vanishes again, read the log first — the last
  `[renderer error]` / `[crash]` / `[fatal]` line is normally the answer.

### One-click diagnostics report

The topbar **Diagnostics** button (also `/diagnostics`, also menu **Help ▸ Copy Diagnostics**)
assembles everything [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) asks for when reporting an issue
into one text block, puts it on the clipboard and saves a copy to
`%APPDATA%\Pi on Strata\diagnostics\pi_on_strata_diagnostics_<timestamp>.txt`:

| Section | Contents |
|---|---|
| `[1]` | placeholder for the symptom / reproduction steps you still have to write yourself |
| `[2]` | app / Electron / Node versions, platform, log, settings and sessions paths |
| `[3]` | the same four lines `node test/smoke-rpc.js` prints (cli, node runtime, pi version, sessions root) plus the pi version this GUI was tested against |
| `[4]` | Strata base url, `/health` and `/v1/models` verbatim, `/metrics` url, and the Strata engine config if `strataConfigPath` is set |
| `[5]` | pi's `~/.pi/agent/models.json` provider block and its default model settings |
| `[6]` | every open tab: state (streaming / compacting / queued / idle / dead), cwd, session file, outbox length, model — the queue screenshot in text form |
| `[7]` | the tail of the log file |

Keys are stripped before the text is built (`lib/diagnostics.js`: `apiKey`-style JSON keys,
`Bearer …` headers and `api-key …` arguments, at any depth), and the saved file is written already
redacted. Still glance over the text before pasting it into a ticket — the redaction is a
safety net, not a promise. The menu path copies from the main process, so it still works when the
renderer itself is the thing that is broken.

## Known limitations

The full backlog, with effort and priority, is in [`docs/TODO.md`](docs/TODO.md).

- RPC mode does not support pi TUI `custom()` components, theme switching and similar (the pi docs
  describe the RPC-mode degradations).
- `get_messages` only shows the current active branch; `/tree` branch switching has no UI yet (could be
  added on top of `get_tree`).
- Dropping a folder only inserts its path; it is not expanded into multiple attachments.
- One pi process per tab, so many tabs cost memory.
- Only one bash command per tab at a time (pi's own limit), and a bash command started by an
  extension without output events gets no card until its first `bash_execution_update`.
- The scheduler can only serialize prompts **sent from the GUI**; executions started by an extension
  cannot be blocked (in that case it takes over `runningTabId` directly and shows it in the queue).
- The outbox is not persisted across restarts.
