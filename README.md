# StrataPilot

A desktop GUI for the pi coding agent running against a local Strata server (Electron + pi RPC mode).
Each tab is its own `pi --mode rpc` process, so you can have **several sessions open at the same
time**; because Strata handles only one request at a time, sends across sessions are ordered by the
built-in **serial queue**.

**Cloning this repo?** Four things have to be installed before a prompt can come back: **git**, **Node.js 22.19+**, **Strata** (the local model server) and **pi** (the coding agent). This repo adds exactly
one dependency of its own — Electron, fetched by `npm ci` — and has no build step. Start at
[Set up from a fresh clone](#set-up-from-a-fresh-clone-step-by-step).

> Renamed twice — `pi_gui` → **Pi on Strata** → **StrataPilot**. The app name, the settings file
> (`%APPDATA%\StrataPilot\stratapilot_settings.json`; the `pi-gui` and `Pi on Strata` files are carried
> over automatically on first launch) and the environment variable prefix
> (`PI_GUI_*` → `PI_ON_STRATA_*` → `STRATAPILOT_*`; the old names still work, the new one wins) are all
> updated. The **project folder** itself has to be renamed with `..\rename_to_stratapilot.ps1` (you must
> leave the pi conversation and close the app first, otherwise Windows blocks it). That script also fixes
> the pi sessions folder name, the `cwd` recorded inside session files, and the paths stored in the app
> settings.

## Table of contents

**Just cloned this repo?** Read these four in order:
[What you are installing](#what-you-are-installing-three-moving-parts) →
[Set up from a fresh clone](#set-up-from-a-fresh-clone-step-by-step) →
[When the install itself fails](#when-the-install-itself-fails) →
[Configuration reference](#configuration-reference).
Runtime problems of an already-working install: [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

Behaviour and features: [Features](#features) ·
[The two sidebar lists](#the-two-sidebar-lists-why-some-rows-overlap-and-others-dont) ·
[Serial queue](#serial-queue-one-session-at-a-time) ·
Bash mode (`!`) and slash commands (`/`) ·
[Session tree and branching](#session-tree-and-branching) ·
[Session storage](#session-storage-size-and-cleanup) ·
[Token usage](#token-usage-per-day--week--month--year) ·
[Theme (dark / light)](#theme-dark--light) ·
[Language](#language-english--繁體中文--简体中文) ·
[Scheduled prompts (cron)](#scheduled-prompts-cron) ·
[Strata Monitor](#strata-monitor-server-monitoring)

Reference and internals: [Keyboard shortcuts](#keyboard-shortcuts) ·
[Accessibility](#accessibility) · [Auto-compaction](#auto-compaction-identical-to-the-cli) ·
[Retry of transient model errors](#retry-of-transient-model-errors) ·
[Token counts: in / out / cache](#token-counts-in--out--cache) ·
[How links are handled](#how-links-are-handled) ·
[Streaming performance](#streaming-performance-does-collapsing-thinking-change-tps) ·
[Packaging](#packaging-installers-and-a-portable-build) ·
[Linux and macOS](#linux-and-macos) · [Architecture](#architecture) ·
[Smoke mode for development](#smoke-mode-for-development) ·
[Logs and crash diagnosis](#logs-and-crash-diagnosis) ·
[Known limitations](#known-limitations)

## What you are installing (three moving parts)

**This repo is only the GUI.** It ships no model, no agent and no server. Three separate installs
have to meet before a prompt can come back with an answer:

```
  ┌──────────────────────────────┐  spawns  pi --mode rpc   ┌───────────────────────────┐
  │  StrataPilot  (this repo)    │ ───────────────────────► │  pi  (the coding agent)   │
  │  the Electron window: tabs,  │                          │  installed under          │
  │  queue, monitor, settings    │                          │  ~/.pi/agent/install      │
  │  npm ci && npm start         │                          │  reads ~/.pi/agent/       │
  └──────────────────────────────┘                          │  models.json, settings    │
                                                            └─────────────┬─────────────┘
                                                                          │ OpenAI-compatible HTTP
                                                                          ▼
                        ┌────────────────────────────────────────────────────────────┐
                        │  Strata  (the local model server, usually port 8081)       │
                        │  /v1/chat/completions · /v1/models · /health · /metrics    │
                        └────────────────────────────────────────────────────────────┘
```

| Part | What it does | Who installs it | Prove it is there |
|---|---|---|---|
| **Strata** | loads the weights and answers `/v1/*`; it owns Python, CUDA and the model file | its own repo (`START-HERE.bat` / `setup.sh` installs Python, detects the GPU and downloads a model by itself) | `curl http://127.0.0.1:8081/health` |
| **pi** | the coding agent: it talks to the model, writes the session JSONL, exposes RPC | the `pi.dev` install script, into `~/.pi/agent/install` | `pi --version` |
| **StrataPilot** | this repo: the window, the tabs, the serial queue, the Monitor | `npm ci` in this folder (Electron is the only runtime you download) | `npx electron --version` |

The GUI **never installs anything for you**. It detects a missing pi or a dead Strata and tells you
about it (the `/setup` check, the env bar, the diagnostics report), but every install command below
is one you run yourself.

## Set up from a fresh clone (step by step)

Written for someone who has just cloned this repo and has nothing else installed. Each step ends with
a command that proves it worked — do not skip ahead until the previous one prints what it should.

### Step 0: what the machine needs

| | Requirement | Notes |
|---|---|---|
| Operating system | Windows 10/11 x64 | developed and hand-tested on Windows; Linux and macOS run in CI — see [Linux and macOS](#linux-and-macos) |
| Free disk | ~15 GB | Strata + Python + one quantised model (several GB, model-dependent) · this repo's `node_modules` **422 MB** · the Electron download cache ~110 MB · `dist/` installers if you package |
| RAM / VRAM | whatever your model needs | the GUI is a normal Electron app; each open tab is one `pi --mode rpc` process, so memory grows with the tab count. The model's appetite belongs to Strata, not to this repo |
| GPU | not needed by this repo | needed to get usable speed out of Strata (its launcher detects it for you) |
| Outbound network | `registry.npmjs.org`, `github.com` (the pi installer and the Electron binary), Hugging Face (the model weights), `pi.dev` | behind a corporate proxy: see [Step 5](#step-5-this-repos-dependencies) |

You do **not** need Python, CUDA, a Visual C++ redistributable or a global `electron` for this repo —
Python and CUDA belong to Strata, and Electron is fetched per-project by `npm ci`.

### Step 1: the toolchain (git and Node.js 22.19+)

`package.json` declares `"engines": { "node": ">=22.19" }`. That floor is **pi's** requirement, and
`npm` itself needs Node as well. Check first:

```bash
node -v          # must print v22.19.0 or newer
npm -v           # 10.x or 11.x ships with Node 22+
git --version
```

If `node` is missing or too old:

| Platform | Install | Then |
|---|---|---|
| Windows | `winget install OpenJS.NodeJS.LTS`, or the installer from nodejs.org | close and reopen the terminal; an app started from the Start menu only sees a changed `PATH` after sign-out / sign-in |
| macOS (Homebrew) | `brew install node@22 && brew link --overwrite node@22` | put the keg's `bin` on PATH (`/opt/homebrew/opt/node@22/bin`) |
| any (recommended when several Node versions coexist) | `fnm install 22 && fnm use 22`, or `nvm install 22 && nvm use 22` | the version manager has to be loaded by the same shell you run `npm start` from |
| Linux (distro package) | **avoid** `apt install nodejs`: Ubuntu 22.04 ships Node 12, which cannot run pi | use `fnm` / `nvm` or the NodeSource repository |

`where node` (Windows) / `which node` (macOS, Linux) tells you which one actually wins when several
are installed.

> The GUI can still *run pi* with no `node` on PATH: `lib/pi-launch.js` falls back to `electron.exe`
> with `ELECTRON_RUN_AS_NODE=1`. That fallback never helps you **install** anything — `npm` always
> needs a real Node.

### Step 2: Strata, the model server

```bash
# On Windows you can also just download the zip from the Strata site and unzip it
git clone https://github.com/Niko1221/Strata.git && cd Strata
# Windows: double-click START-HERE.bat (first run installs Python, detects the GPU,
#          picks a model that fits, downloads it and starts the server)
# Linux: ./setup.sh    Mac (Apple Silicon): xcode-select --install once, then ./setup.sh
```

Prove it: open `http://127.0.0.1:8081/metrics` in a browser (or `curl -s
http://127.0.0.1:8081/health`) — JSON means the server is up. **Remember the port and the model
name** the launcher prints: Step 4 has to match them exactly.

### Step 3: pi, the coding agent

```powershell
powershell -c "irm https://pi.dev/install.ps1 | iex"   # Windows
# curl -fsSL https://pi.dev/install.sh | sh            # macOS / Linux
pi --version    # pi requires Node.js 22.19+ (the installer provides it if missing)
```

Reopen the terminal so `pi` is on PATH. The managed install lands in `~/.pi/agent/install`, and this
GUI resolves it from `~/.pi/agent/install/current-version` — a pi installed some other way (a global
`npm i -g`, a checkout) is invisible to it unless you set `STRATAPILOT_PI_CLI`, see
[Environment variables](#environment-variables-all-prefixed-stratapilot_).

### Step 4: point pi at Strata

Add Strata as a provider in `~/.pi/agent/models.json` and set `defaultProvider` in
`~/.pi/agent/settings.json`. **Do not copy anyone's block: every value comes from *your* Strata
install.** The field-by-field mapping, and the two `curl` calls that read the values back off the
running server, are in [Connecting pi to Strata (one-time setup)](#connecting-pi-to-strata-one-time-setup).

Prove it before touching the GUI: plain `pi` in a terminal must answer a prompt. Only then does the
GUI's model dropdown have anything in it.

### Step 5: this repo's dependencies

```bash
git clone <this repo> && cd StrataPilot
npm ci            # installs exactly what package-lock.json pins
```

Use `npm ci`, not `npm install`: the lockfile (v3) pins `electron@40.10.2` and
`electron-builder@^26.15.3` exactly, and `npm ci` refuses to run if the lockfile and `package.json`
disagree instead of quietly rewriting them. `npm install` is only what you want when you are
deliberately changing a dependency.

What that command actually brings down:

| What | Where it comes from | Size on this machine |
|---|---|---|
| `electron@40.10.2` — the runtime the app runs on | the npm package, whose `postinstall` downloads the Electron **binary** zip from `github.com/electron/electron/releases` | the zip ~110 MB; `node_modules/electron/dist` **332 MB** |
| `electron-builder@^26` — only needed for `npm run dist*` | npm | part of the same install |
| **nothing else** | the markdown renderer, the session parser, the cron parser and the usage ledger are hand-written: **zero runtime dependencies** | `node_modules` total **422 MB** |

Notes that save time:

- The Electron zip is cached, so a second clone on the same machine does not re-download it:
  `%LOCALAPPDATA%\electron\Cache` (Windows), `~/Library/Caches/electron` (macOS),
  `~/.cache/electron` (Linux). Delete that cache to force a fresh download.
- `node_modules/`, `dist/`, `.smoke/` and `*.log` are git-ignored: a fresh clone has none of them,
  and they must never be committed.
- To run only the unit tests you do not need the Electron binary at all — that is exactly what CI
  does: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && npm test`.
- Do **not** `npm install -g electron`: `npm start` uses the local `node_modules/.bin/electron`.
- There is **no build step**: no bundler, no TypeScript, no compile. `main.js`, `lib/` and `renderer/`
  are loaded as they are, so `npm ci` followed by `npm start` is the whole install.

Behind a proxy, or where GitHub is unreachable:

```bash
npm config set https-proxy http://proxy:8080      # and: npm config set proxy  http://proxy:8080
npm config set cafile /path/to/corp-ca.pem        # TLS-intercepting proxy: give npm the CA, do not disable ssl

# the Electron binary is fetched by @electron/get: it honours HTTPS_PROXY / HTTP_PROXY,
# and ELECTRON_MIRROR points it somewhere else (an internal mirror, an SMB share, …)
set ELECTRON_MIRROR=https://example.internal/electron/     # cmd
$env:ELECTRON_MIRROR = "https://example.internal/electron/"  # PowerShell
export ELECTRON_MIRROR="https://example.internal/electron/"  # bash
```

### Step 6: start it

```bash
npm start          # = electron .
```

- Only **one instance** is allowed (`requestSingleInstanceLock`); running `npm start` again just gives
  focus to the window that is already open.
- Tabs that were open are restored on the next launch (up to 4); switch it off in Settings
  (`restoreTabs: false`).
- To start without a terminal: `start "" /b npm start`, a shortcut pointing at `electron .`, or an
  installer / portable zip — see [Packaging](#packaging-installers-and-a-portable-build). Nothing is
  code-signed, so SmartScreen and Gatekeeper complain once.
- The env bar shows the pi version and **turns amber when it is not the version this GUI was tested
  against** (`TESTED_PI_VERSION` in `lib/pi-launch.js`, currently `1.2.0`). pi is resolved through
  `current-version`, so a pi upgrade can move the RPC contract under the GUI: same major.minor is
  treated as safe, a different minor warns (pi adds RPC commands in minor releases), a different major
  turns red (the framing may have changed). Hover the version for what to do; the same comparison is
  printed in the diagnostics report. Set `STRATAPILOT_SMOKE_PI_VERSION=1.4.2` to see the warning
  without installing another pi.

### Step 7: check every layer before blaming the GUI

| Layer | Command | A good answer looks like |
|---|---|---|
| Node | `node -v` | `v22.19.0` or newer |
| npm | `npm -v` | 10.x / 11.x |
| Electron binary | `npx electron --version` | `v40.10.2`, matching `package.json` |
| the repo's own logic (no Electron, no pi, no Strata) | `npm test` | every test passes |
| pi is found by the launcher | `node test/smoke-rpc.js C:/some/project` | the first four lines are `cli:` (a real path), `node:`, `pi version:`, `sessions root:` — then one RPC round trip. `cli: null` means pi was not found: set `STRATAPILOT_PI_CLI` / `PI_MANAGED_INSTALL_ROOT` |
| Strata answers | `curl http://127.0.0.1:8081/health` | JSON with `model`, `max_context`, `api_key` |
| the model id pi must use | `curl http://127.0.0.1:8081/v1/models` | the `id` you put in `models.json` |
| the window starts with **no** Strata running | `STRATAPILOT_SMOKE=1 STRATAPILOT_SMOKE_MS=6000 npx electron .` | a `[smoke] window` line on stderr, and the env bar reporting `pi ?` is fine here. Linux headless: `xvfb-run -a` in front, `--no-sandbox` after |
| inside the app | `/setup` | three green steps: the pi it found, `/health` answering, the working folder new tabs start in |

### Step 8: the first run in the window

1. `Ctrl+T` → pick a **working folder** (this is the folder pi will read and edit; it is not the
   folder this repo lives in).
2. Pick the model and the thinking level in the top bar — if that dropdown is empty, Step 4 was not
   done.
3. Type a prompt and send. `Ctrl+M` opens the Strata Monitor, `/stats` prints tokens and context use.
4. Every shortcut: [Keyboard shortcuts](#keyboard-shortcuts). Something broke: start at
   [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md), and press **Diagnostics** (`/diagnostics`)
   before reporting it.

### Step 9: where the app keeps its files, reset and uninstall

| What | Windows | Linux | macOS |
|---|---|---|---|
| settings | `%APPDATA%\StrataPilot\stratapilot_settings.json` | `~/.config/StrataPilot/` | `~/Library/Application Support/StrataPilot/` |
| token ledger | `token_usage.json` next to it | same folder | same folder |
| logs | `logs\stratapilot.log` (menu **Help ▸ Open Log Folder**) | same folder | same folder |
| diagnostics dumps | `diagnostics\` | same folder | same folder |
| sessions | `~/.pi/agent/sessions` | same | same |
| the pi install | `~/.pi/agent/install` | same | same |

The last two rows belong to **pi**, not to this app: they are the same path on all three platforms and
survive anything you do here.

- **Reset the app**: quit it, then delete or rename that `StrataPilot` folder under `userData`. The
  settings, the ledger, the logs and the diagnostics dumps all start over. pi's config and sessions
  are untouched.
- **Uninstall a development clone**: quit the app, delete the repo folder (`node_modules` alone is
  422 MB) and, if you want the settings gone, the `userData` folder above.
- **Uninstall an installed build**: the NSIS entry in *Add or remove programs* (it keeps your settings
  by default — `deleteAppDataOnUninstall: false`), or just delete the folder of the portable zip.
- Neither removes pi, Strata, the model weights or the session files: those are separate installs.

## When the install itself fails

Runtime problems live in [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md); this table is only
about *getting from a clone to a running window*.

| Symptom | Cause and fix |
|---|---|
| `npm ERR! engine ... wanted {"node":">=22.19"}` | Node is older than pi's floor → [Step 1](#step-1-the-toolchain-git-and-nodejs-2219) |
| `npm ci` hangs on `reify:electron`, then `ETIMEDOUT` / `ECONNRESET` / `403` | the Electron **binary** download is blocked: set `HTTPS_PROXY` or `ELECTRON_MIRROR` → [Step 5](#step-5-this-repos-dependencies) |
| `self-signed certificate in certificate chain` / `unable to verify the first certificate` | a TLS-intercepting proxy: `npm config set cafile <corp-ca.pem>` (do not turn off `strict-ssl` unless you have to) |
| `Error: Electron failed to install correctly, please delete node_modules/electron` | the download died halfway: delete `node_modules/electron`, set the mirror, run `npm ci` again |
| `'electron' is not recognized` / `sh: electron: not found` | you ran `electron .` instead of `npm start`, or `npm ci` never finished |
| `node -v` still prints an old version after installing a new one | PATH order or a version manager that is not loaded in this shell → `where node` / `which node` |
| Linux: `error while loading shared libraries: libgtk-3.so.0`, or an immediate abort | Electron's system libraries are missing: `sudo apt-get install -y libgtk-3-0 libnss3 libasound2t64 libxss1 libgbm1` (older releases call it `libasound2`) — the same list CI installs |
| Linux in a container, or running as root: `FATAL:setuid_sandbox_host.cc` | the sandbox cannot start: `npx electron . --no-sandbox` |
| Linux with no display | `xvfb-run -a npx electron .` |
| Windows: SmartScreen "Windows protected your PC" | expected — nothing in this repo is code-signed → **More info → Run anyway** |
| macOS: "…is damaged and can't be opened" | also the missing signature: right-click → **Open**, or `xattr -dr com.apple.quarantine <path>` |
| `EBUSY` / `EPERM` / `ENOTEMPTY` while `npm ci` runs on Windows | a `StrataPilot`/`electron.exe` is still running and holding files: quit it, delete `node_modules`, run again. Antivirus and OneDrive-synced folders do this too |
| `npm ci` is very slow, or fails on a path that is too long | clone somewhere short (`C:\dev\StrataPilot`) instead of OneDrive / Desktop, and enable Win32 long paths |
| the window opens but the model dropdown is empty | Step 4 was skipped — pi has no provider. Run `/setup` and then read [Connecting pi to Strata](#connecting-pi-to-strata-one-time-setup) |
| the window opens, sending spins forever | Strata is not running, or the port in `baseUrl` is not the port the launcher uses → `curl http://127.0.0.1:8081/health` |
| you want proof of all of this without opening a window | `node test/smoke-rpc.js <cwd>` — its first four lines are exactly what `lib/pi-launch.js` resolved |

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
- **First-run check** (`/setup`, Help ▸ First-run check): is pi installed, is Strata answering `/health`, and
  which folder new tabs start in - with the install command to copy when pi is missing, and a re-check button
- **Session tree and branching** (`/tree`): the whole entry tree, jump to any message, fork from an
  earlier prompt, or clone the branch into a new session - all through pi's own RPC
- **`@` path completion** in the composer: type `@` and the session folder's contents appear; Enter inserts
  the path (a folder keeps the menu open for the next level), and the listing never leaves the session folder
- **Several Strata servers at once**: the Monitor gets a pill per address with its own health dot, so two
  engines on two ports can be compared without editing settings by hand
- **Session storage**: the footer shows how much disk the sessions take; a dialog cleans up by age or by
  "keep the N newest per folder", always after a preview, and never touching a session that is open
- **Token usage ledger**: the footer also shows the all-time token total, and **Usage** (`/usage`) opens a
  column chart of in / out / cache read / cache write per **day, week, month or year**. The rollup is kept
  in its own file and only ever grows: compact, branch switch, fork, cleanup or a session file being
  rewritten cannot write off what was already recorded
- **Accessibility**: dialogs are real dialogs (role, label, focus trapped and restored, `Esc`), icon-only
  buttons get an accessible name, queue rows describe their state in words instead of colour, focus is
  visible for keyboard users, and the animations honour `prefers-reduced-motion`
- **Dark and light theme**: pick it in Settings (or let it follow the system); colours are CSS
  variables, so a theme is one variable block, and the last theme is mirrored in `localStorage` so a
  light-theme start does not flash dark first
- **English, 繁體中文 or 简体中文**: **Settings ▸ Interface ▸ Language** (`/settings`) switches the whole
  interface while the app runs - no restart. `Auto` follows the OS; the app chrome, the dialogs, the
  Monitor and the native menu are translated, while pi answers in the language you write to it
- **Tab strip carries more**: each tab shows which **model** it is on (plus the thinking level when it
  is not the default), its queue position and its outbox count; hovering the model tag shows the full
  `provider/id` and the server address
- **Restart a dead tab**: when a tab's pi process has ended, the composer gets an explicit
  **Restart** button (same folder, same session file) instead of only hinting "press Send" in the
  placeholder, so the draft in the editor survives
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
- **Compact**: manual context compaction; the status bar shows context usage, tokens
  (`in / out / cache`) and cost. Auto-compaction and auto-retry are **always on** - the GUI turns
  both on when a session starts and there is no checkbox for them (see
  [Auto-compaction](#auto-compaction-identical-to-the-cli)); the composer only gets a
  **`stop retry`** button while a retry is waiting (`abort_retry`)
- **Extension UI bridging**: `select` / `confirm` / `input` / `editor` emitted by an extension become
  in-window dialogs; `notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text` are shown too
- **Settings dialog** (topbar **Settings**, `Ctrl+,`, `/settings`): working folder, serial queue,
  reopen-tabs, fixed Strata address, Strata config path for the report, Monitor open/width, sidebar,
  plus one-click access to the settings file, the log file and the sessions folder — nothing needs a
  hand edit of the JSON any more
- **Scheduled prompts** (`/jobs`, Settings): cron-style jobs (5 fields, local time) kept in the settings
  file and armed by the background process; a due prompt is queued into a session through the serial
  queue, never sent behind its back, and a run missed while the machine slept is reported instead of
  replayed
- **Diagnostics report**: the topbar **Diagnostics** button (`/diagnostics`, menu **Help ▸ Copy
  Diagnostics**) copies one pasteable block for a bug report — versions and paths, the pi install,
  Strata `/health` + `/v1/models`, both model configs, every open tab's queue state and the log tail —
  with keys redacted, and saves the same text under `%APPDATA%\StrataPilot\diagnostics\`
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

**Refreshing the list is cheap.** `listSessions()` in the main process keeps a
`path -> {mtimeMs, size, meta}` cache: a session file is append-only, so when its mtime and size are
unchanged nothing is parsed again. That matters because the sidebar refreshes after almost every
message, and parsing an 86 MB session every time would freeze the UI (the scan of one file is also
capped at 12 MB, which is why very long sessions show `truncatedScan`). `renameSession()` /
`deleteSession()` drop their cache entry, and a file that vanished between two refreshes is removed
from it.

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
**The outbox survives a restart.** Whatever was still queued in a session's outbox is stored in the
settings file; after a relaunch it comes back as a blue dashed **`pending N`** badge on that session's
queue row and as a note in the transcript. It is *not* in the outbox and the queue will not send it:
open the badge and choose `queue it` / `queue all` (or `drop`). Sending queued messages automatically
after a crash is exactly what nobody wants, so the decision stays with the user.


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
| `/retry [on\|off\|stop]` | pi's retry of transient model errors: on/off for this session, `stop` cancels a retry sitting in its delay - see [Retry of transient model errors](#retry-of-transient-model-errors) |
| `/jobs` | open the scheduled-prompts dialog - cron jobs, see [Scheduled prompts (cron)](#scheduled-prompts-cron) |
| `/setup` | open the first-run check: is pi installed, is Strata reachable, which folder do new tabs start in |
| `/tree` | show the session tree: the branch you are on, abandoned entries, fork from an earlier prompt, clone the branch |
| `/stats` | print tokens / cost / context usage into the transcript |
| `/usage` | token usage per day / week / month / year (in, out, cache), from the ledger - see [Token usage (per day / week / month / year)](#token-usage-per-day--week--month--year) |
| `/monitor` | toggle the Strata monitor |
| `/diagnostics` | copy a diagnostics report for a bug report (see [One-click diagnostics report](#one-click-diagnostics-report)) |
| `/commands`, `/help` | list the app commands plus everything `get_commands` reports from pi |

pi's built-in TUI commands (`/settings`, `/hotkeys`, …) do not exist in RPC mode — the palette list
comes from `get_commands`, which only reports extension commands, prompt templates and skills. An
unrecognised `/foo` is sent to pi as written (it then reaches the model as plain text).

### `@` path completion (D1)

Typing `@` after a space (or at the start) opens the same palette, but with the **contents of the
session's working folder**:

| | |
|---|---|
| Trigger | `@` at the caret, e.g. `read @lib/dia` - the token under the caret is what is matched, not the whole line |
| Listing | the main process lists one directory level (`fs:complete`); it never goes above the session folder, and `node_modules`, `.git`, `.venv`, `__pycache__`, `dist`, `build`, `out`, `.next`, `.cache` are hidden unless you type them on purpose |
| Pick | `Up` / `Down`, then `Enter` or `Tab` inserts the path (`@lib/diagnostics.js`); a folder keeps the menu open for the next level (`@src/`), `Esc` closes it |
| Two Enters | the first completes the path, the second sends the prompt - the same rule as the command palette |
| Not an attachment | the path is inserted as **text**; the model reads the file with its own tools. Drag & drop or **Attach files** is still what actually uploads content |

## Configuration reference

What the GUI reads and writes, and what to set when auto-detection is not enough. Getting from a bare
clone to a running window is [Set up from a fresh clone](#set-up-from-a-fresh-clone-step-by-step).

### First-run check (the `/setup` command)

On the first run - and any time you ask for it (**Help ▸ First-run check**, or `/setup`) - the app opens
a check instead of making you guess:

| Step | What it does |
|---|---|
| 1. pi CLI | reports the pi it resolved (`~/.pi/agent/install/current-version`, overridable with `STRATAPILOT_PI_CLI`), colour-coded against the version this GUI was tested with. If nothing was found it prints the install command with a copy button and a **re-check pi** button - no restart needed, and the app never installs anything for you |
| 2. Strata server | an address field with a **check** button that calls `/health` and reports the HTTP status and the latency (it checks by itself when the dialog opens). **use this address** saves it as `strataUrl`, which is what the Monitor and the diagnostics report use. A failing check says to start the engine, change the address, or set `STRATAPILOT_KEY` if the server needs a key |
| 3. working folder | the folder new tabs start in, with a folder picker; saving it writes the `cwd` setting |

Closing the dialog (or pressing **Start using it**) records `firstRunSeen: true`, so it does not come
back. Remove that key - or run `/setup` - to see it again.


### Connecting pi to Strata (one-time setup)

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
> `STRATAPILOT_KEY` below is what the Monitor sends to `/metrics`.
>
> Re-running `START-HERE.bat --calibrate`, or editing the Strata config, can change `--max-context`
> and the port. Re-read the two endpoints above afterwards and update `contextWindow` / `baseUrl` —
> the auto-compaction trigger point and the Monitor's context-fill donut both follow `contextWindow`.

### Environment variables (all prefixed `STRATAPILOT_*`)

Normally you set **nothing**; only override when auto-detection fails.

| Variable | Purpose | Default |
|---|---|---|
| `STRATAPILOT_PI_CLI` | Path to pi's `cli.js` | Resolved from `~/.pi/agent/install/current-version` → `releases/<ver>/node_modules/@earendil-works/pi-coding-agent` |
| `STRATAPILOT_NODE` | Node executable used to run pi | `node` on PATH; otherwise `electron.exe` + `ELECTRON_RUN_AS_NODE=1` |
| `PI_MANAGED_INSTALL_ROOT` | pi installation root | `~/.pi/agent/install` |
| `STRATAPILOT_KEY` / `STRATA_API_KEY` | API key the Monitor uses for `/metrics` | Empty (no key); can also come from the tab model's `apiKey` |
| `PI_CODING_AGENT_SESSION_DIR` | Session JSONL root folder | `~/.pi/agent/sessions` |
| `STRATAPILOT_SMOKE*` | Developer smoke mode | See [Smoke mode](#smoke-mode-for-development) |

> The old `PI_ON_STRATA_*` names still work: `migrateEnv()` in `main.js` copies any `PI_ON_STRATA_X`
> onto `STRATAPILOT_X` at startup (only when the new one is not already set), so an old terminal,
> scheduled task or IDE run configuration does not break. New setups should use `STRATAPILOT_*`.

Example:

```bash
STRATAPILOT_PI_CLI="C:/Users/you/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" \
STRATAPILOT_NODE="C:/Program Files/nodejs/node.exe" \
STRATAPILOT_KEY=llama npm start
```

### Application settings file

`%APPDATA%\StrataPilot\stratapilot_settings.json` — written and **edited by the GUI itself**: the
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
| `jobs[]` | Scheduled prompts (B5): `{ id, name, schedule, prompt, target, cwd, ephemeral, enabled, lastRun, nextRun }` - edited in the Jobs dialog rather than by hand |
| `strataUrls` | Extra Strata addresses the Monitor should watch (array, one per line in the Settings dialog) - see [More than one Strata server](#more-than-one-strata-server) |
| `theme` | `dark` (default), `light` or `system` - see [Theme (dark / light)](#theme-dark--light) |
| `language` | `auto` (default, follows the OS), `en`, `zh-TW` or `zh-CN` - see [Language](#language-english--繁體中文--简体中文) |
| `strataConfigPath` | Optional path of the Strata engine config (`C:\Strata\strata-src\strata-<model>.json`): only used to include that file, keys redacted, in the diagnostics report |

The old `pi-gui` / `Pi on Strata` settings files are migrated automatically on first launch (see the
note at the top).

## Session tree and branching

A pi session is an **append-only tree**: every entry has an id and a parent, and the conversation you
read is the path from a root down to the current leaf. The transcript only ever shows that path, so an
earlier prompt you wanted to take a different route from was unreachable in the GUI.

Open it with **`/tree`** or the **tree** chip in the stats row (it counts branch points once they exist).

| Part | What it does |
|---|---|
| Source | pi's own `get_tree` over RPC - the GUI never parses or writes the session file for this, so there is still exactly one writer |
| The view | every entry, indented by depth, labelled by kind (`user`, `assistant`, `model`, `usage`, `compaction`, ...) with a text preview and the time. The branch you are on has a blue left border; entries pi stopped following are dimmed; a node with several children carries a `+ n branches` chip, the leaf says `leaf` |
| **jump** | scrolls the transcript to that message. The transcript is built from messages, not entries, so the match is by text - if an entry is pre-compaction history or on another branch the toast says so instead of jumping nowhere |
| **fork here** | on any **user** message of the current branch: pi moves the session back to that prompt and waits for a new one. The session file is append-only, so the answers you already got are not deleted, they are just no longer on your branch. Afterwards the tab re-reads the conversation and asks `get_state` for its session file (pi may hand the process a different one) |
| **clone branch** | pi duplicates the branch you are on into a **new session file**; the sidebar refreshes and the tab adopts the path pi reports |
| **refresh** | re-reads the tree, useful right after a fork |

Verified end to end with `STRATAPILOT_SMOKE_FORK=1` against a throwaway session: forking from the first
prompt leaves the transcript with that one message (`items_before=5 items_after=1`).

> Forking is a pi operation, not a GUI edit: an extension can cancel it (`session_before_fork`) and the
> GUI reports the cancellation instead of pretending it worked.

## Session storage (size and cleanup)

The sidebar footer shows the count **and the size**: `15 / 15 sessions  Storage: 8.2 MB in 15 files`.
Click **Storage** for the dialog.

| Part | Behaviour |
|---|---|
| Totals | per working-folder group: bytes, file count, newest and oldest session, biggest group first. Only `stat()` is called, so an 86 MB session costs the same as a 1 KB one |
| Two rules | **age** (older than 30 / 90 / 180 / 365 days) and **a per-folder cap** (keep the 5 / 10 / 20 / 50 newest). Leave one empty and the other does all the work |
| Always previewed | `Preview` lists how many files and how many bytes would go, with the reason per file; `Delete` then asks again before touching anything |
| Safe by construction | the main process filters out every session a live pi process owns - including tabs that switched sessions with `switch_session`, which the background process is told about - so a session open in a tab can never be in the list; paths outside the sessions folder are refused by `assertInsideRoot`; deleting is permanent (no recycle bin) |
| Cache | a bulk delete drops the session-metadata cache in one go, so the sidebar re-reads instead of showing ghosts |

Code: `storageStats()`, `cleanupPlan()`, `deleteSessions()` in `lib/sessions.js` (unit-tested against a
temp sessions root, never the real one), IPC `sessions:stats` / `sessions:cleanup-plan` /
`sessions:cleanup-run`, dialog `openStorageModal()`.

## Token usage (per day / week / month / year)

The sidebar footer shows the all-time total: `Usage: 33.1M tok`. Click **Usage** (or `/usage`) for the
dialog: a stacked column chart of **in / out / cache read / cache write** per **day, week, month or
year**, over the last 7 / 30 / 90 / 365 days or everything.

| Thing | How |
|---|---|
| Where it is kept | `%APPDATA%\StrataPilot\token_usage.json` - one entry per session file, each holding day buckets (`in`, `out`, `cacheRead`, `cacheWrite`, `total`, `cost`, call counters, split per model) |
| **Tokens are never written off** | day buckets are only ever ADDED to. A session file being rewritten (`SessionManager._rewriteFile()` reopens it with `"w"`) or truncated cannot subtract what was already banked; a watermark (`countedCount` + `lastRecordId`) makes the re-scan add only the records it has not seen yet. The single action that can lower the numbers is **Recount from files**, which asks first |
| Every model call counts | pi stamps `usage` on four entry types - a model reply, a standalone `usage` entry (e.g. a cache warm), **`compaction`** and **`branch_summary`**. The two summary ones are real model calls (one compaction here cost 72,124 tokens on its own), so compacting and switching branches are charged, not free. The dialog shows them separately (`561 model calls · (3 compact)`) |
| Forks and clones are not counted twice | pi's `fork` / `clone` copies the parent's entries **verbatim, ids included**, into a new file. The first time a file with `parentSession` is seen, the ancestor chain is read and its entry ids are skipped (fork of a fork and sibling forks included). If the parent file is already gone the ledger says so (`N fork(s) could not be deduplicated`) instead of hiding it |
| Why a ledger at all | pi's numbers live in the session JSONL, so a D7 cleanup deletes them along with the file. The ledger is the record of what those sessions cost, and it is what makes "what did this week cost" answerable without re-reading every session |
| Keyed by file name | pi names a session file `<createdAt>Z_<uuid>.jsonl`, so a session that moves to another folder group keeps its history instead of being counted twice (that is exactly what the `pi-on-strata` → `StrataPilot` folder rename did to every session on this machine) |
| Deleted sessions | their day buckets stay in the chart (history). **Recount from files** rebuilds the ledger from what is on disk, so the deleted ones leave with their files |
| Incremental | the same `(mtime, size)` stamp trick as the session list cache: a session file that did not change is never opened again, so opening the chart over thousands of sessions stays cheap |
| Local calendar | day buckets are the user's local day, not UTC - a session that ran at 23:30 belongs to their day. Weeks start on Monday |
| Retention | day buckets older than 3 years are dropped on the next refresh |
| Cache dominates | cache reads are usually two orders of magnitude bigger than real work (this machine: 39.9M cache reads against 1.0M prompt reads), so the dialog has a **stack cache read / write** checkbox: untick it and the columns show only in / out, rescaled |
| **What it costs** | Strata reports no prices - pi's `usage.cost` is `0` for every call - so the money side is computed from rates **you** type: **USD per 1,000,000 tokens**, one row per model plus a **default rate** row. The rate table sits under the chart; pick **cost (USD)** in the third dropdown and the columns become money, split into the same four stacked parts. The totals line spells the sum out (`$6.91 = $1.17 in + $0.99 out + $4.75 cache read + $0 cache write`), and the sidebar chip gains the money too |
| Rates live in settings, not in the ledger | they are saved in `stratapilot_settings.json` under `usagePrices` as soon as you leave a box. The ledger stores only token counts, so changing a rate re-prices every past day instantly, needs no re-scan, and never rewrites history. Each model is priced at its own rate, so a day that used two models is the sum of both |
| A model row is a **patch**, not a replacement | filling in only `in` changes only `in` - the other three fields come from the default rate, and the placeholder in each box shows what currently applies. An all-empty model row is not stored at all, so it keeps falling back to the default instead of silently making that model free. To make one model free: set the default row to 0 and give the expensive models their own rows |
| Honest about limits | a session bigger than the 12 MB scan cap is counted only up to that point, and the dialog says how many sessions were affected |
| Kept up to date | refreshed after startup, after **every settled run and every compaction**, when the window regains focus, after a storage cleanup and after a pi process exits - and the footer chip plus an open Usage dialog follow the ledger **without an app restart** (the renderer pulls a fresh summary 1.5 s after a settle; the main process re-scans 2.5 s later so the ledger file on disk is current for the diagnostics report too). The renderer logs `[usage-live] ledger total X → Y` when that happens. The file is written atomically (`tmp` + rename) |

Code: `lib/usage-ledger.js` (33 unit tests against a temp sessions root - among them "a rewritten
session file cannot write off banked tokens", "a compaction entry's usage is counted" and "a fork's
copied entries are not counted twice") and the pricing side in `renderer/app.js` (`priceForModel()`,
`costOf()`, `bucketCostParts()`, 11 unit tests in `test/usage-cost.test.js`), IPC `usage:series` /
`usage:summary` / `usage:recount`, dialog `openUsageModal()` and `buildUsageChart()` (inline SVG, no
dependency, CSP untouched).

## Theme (dark / light)

Pick it in **Settings ▸ Interface ▸ Theme**: `Dark` (the default), `Light`, or `Follow the system
theme` (keeps following `prefers-color-scheme` while the app runs).

| Thing | How |
|---|---|
| Storage | the `theme` key in the settings file - nothing else is touched |
| Implementation | every colour in `styles.css` goes through a CSS variable, so a theme is only a redefinition of those variables (`[data-theme="light"]`); there is no second stylesheet and no duplicated rule |
| No flash on start | the last applied theme is mirrored in `localStorage` and read by `renderer/theme-boot.js` before the first paint; the real setting (including `system`) is applied a moment later from the settings file |
| Screenshots | `STRATAPILOT_SMOKE_THEME=1` switches theme, prints the computed colours and writes both screenshots to the temp folder (see the smoke table) |

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

## Scheduled prompts (cron)

Run a prompt on a schedule - "every weekday at 09:30, summarise what changed since yesterday".
Open it with the **`/jobs`** command or Settings, Manage scheduled jobs.

| Piece | Where it lives |
|---|---|
| The schedule | you pick **when** from a dropdown - *every weekday*, *every day*, *on chosen weekdays* (day chips), *on one day each month*, *every N hours*, *every N minutes* - and set a time; the 5-field expression is written for you and echoed above the preview line. **custom cron (advanced)** is the only case where you type it: `minute hour day-of-month month day-of-week` in **local time**, with `*`, `a-b`, `*/n`, `a-b/step`, lists, and the names `jan..dec` / `sun..sat`. When day-of-month and day-of-week are both restricted, **either** matching is enough (Vixie cron); `0` and `7` are both Sunday. Parsed by `lib/cron.js` (no dependency added), which also reads an expression back into the builder (`schedulePreset`); `test/cron.test.js` covers month/year rollover, impossible dates (`0 0 30 2 *` never fires), the slept-through case and the builder round-trip |
| The scheduler | the **main process**: ticks every 30 s, keeps `nextRun` per job in `settings.jobs[]`, and re-arms on `powerMonitor resume` / `unlock-screen` and on every tick. A laptop that slept through 09:30 does not fire it at 11:00 - the run is reported as missed and the next one is scheduled |
| The firing | the scheduler **never sends a prompt itself**: it emits `cron:fire`, and the renderer pushes the text into the target session's **outbox** and lets the serial queue run it. Two senders would break Strata's one-request-at-a-time rule, and an outbox item is crash-recoverable (B4) |
| The target | picked from a dropdown, not typed: `new-tab` (a fresh session each run, **ephemeral by default** so jobs do not pile up session files), **pick a recent session…** → `session:<path>` (reuses that conversation, opening it if closed), or **pick an open tab…** → `tab:<id>` (an open tab; a dead tab is restarted - note a tab id only exists while the app runs) |
| Run it now | the **run now** button queues the prompt immediately - the quick way to test a job without waiting for the clock |

> **A scheduled prompt runs with full rights.** It is sent exactly like a typed message, so pi may
> read, edit and run commands in the target folder while nobody is watching. Keep those prompts
> read-mostly, pin the working folder in the job, and prefer ephemeral new-tab jobs you can inspect
> afterwards.

Jobs live in the settings file (`jobs[]`) so they survive restarts; disabling a job keeps it listed
with its `nextRun` cleared.

## Auto-compaction (identical to the CLI)

Every tab is a real `pi --mode rpc` process reading the same `~/.pi/agent/settings.json`, so
**auto-compaction is already on** — the GUI only has to keep it on:

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
- **Always on, on purpose**: at every (re)start the tab reads `get_state.autoCompactionEnabled` and,
  if pi came up without it (a `"compaction": { "enabled": false }` in that settings file), puts it
  back on with `set_auto_compaction`. The composer has no `auto-compact` checkbox any more
- If that RPC ever fails and ctx is already ≥85%, the status bar shows an amber warning
  `auto-compact off · compact before it overflows`, so you do not hit overflow blind

## Token counts: in / out / cache

Every token chip - the stats row, each assistant message header, the session list, and `/stats` -
spells the same three numbers out, because pi's total is their sum:

```
total = in + out + cache
```

| | what it is |
|---|---|
| **in** | prompt tokens read that **missed** the prompt cache - the work Strata actually had to prefill |
| **out** | tokens the model generated (thinking tokens are included when the provider reports them) |
| **cache** | context **re-read** from the prompt cache (`cacheRead + cacheWrite`) |

The old single total hid this, and it was misleading in both directions. pi re-sends the whole
conversation on every tool round, so a long session's total is mostly re-read context: one real
session reads `in 36.5k / out 26.4k / cache 2.26M` and totals **2.33M** - 97% of it is cache. Its
last turn had **156** uncached prompt tokens against **60,934** re-read ones. So `in + out` is the
number that answers "how much new work did this session do", while the total mostly answers "how much
context did it carry" - which is also what drives compaction.

`cache` is left out of the label when it is zero, which is exactly when `in + out` already equals the
total. Hover any chip for the exact figures, written out as the sum. This is the same split the
Monitor panel reports as `prompt tokens read (reused) · written`.

## Retry of transient model errors

Strata drops a request now and then (overloaded, rate limit, 5xx, and - the common one here - a
Strata restart mid-request). pi retries those by itself, and the GUI keeps that on and exposes the
one half of it that still needs a hand:

| What | Where |
|---|---|
| The retry itself | transcript notes: `retry 2/4 in 3000ms: <error>` (`auto_retry_start`) and, if it gives up, `retry failed after 4 attempts: ...` (`auto_retry_end`) |
| **always on** | every (re)start sends `set_auto_retry { enabled: true }`, so a tab never comes up without retries even if pi's own settings have `"retry": { "enabled": false }` - there is no `auto-retry` checkbox in the composer |
| **`stop retry`** button | appears in the composer **only while a retry is sitting in its delay**, and sends `abort_retry`: the delay is cancelled and the request fails now instead of hammering a server that is clearly down |
| `/retry`, `/retry on`, `/retry off`, `/retry stop` | same from the palette; bare `/retry` prints the current state and the attempt it is waiting for. `on` / `off` are the escape hatch for one bad stretch in one session - a restarted session is always on |

## Compaction and an in-flight request (not a bug, but confusing)

In pi 1.2.0 the first line of `AgentSession.compact()` is `await this.abort()`, and the source
comment is explicit:

> *Aborts the current agent operation first. Manual compaction never retries or continues the interrupted agent turn.*

So **pressing Compact while a session is running** aborts the in-flight request, and Strata's
`Recent requests` gets a `Closed` row (client disconnect). Worse: if the session is too small
(`Nothing to compact (session too small)`), the reply is still killed and nothing was compacted.
That is pi's designed behaviour, not a Strata or StrataPilot bug.

StrataPilot's guard: pressing Compact while a session is running (streaming / outbox / running in the
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
  `%APPDATA%\StrataPilot\stratapilot_settings.json`)
- If the server requires an API key: set `STRATAPILOT_KEY` or `STRATA_API_KEY`
- Clicking the URL in the header opens Strata's web page in the default browser
- When unreachable the header turns red and shows the error (after 3 consecutive failures it marks

### More than one Strata server

Two engines on two ports (say `:8081` and `:8082`) can be watched at the same time:

- The Monitor header row gets a **pill per address**: `active tab` (follow the active tab's model
  server), one for every known address, and `+ add server`.
- Known addresses = the derived one + `strataUrls` in Settings (one per line) + whatever the open tabs
  are actually using.
- Clicking a pill points the cards at that server; the pill carries a **health dot** (`/health`, polled
  every 4 s for every watched server): green with the latency, red with the error, grey before the
  first check.
- `+ add server` saves the address into `strataUrls`; the `×` on a pill removes it again. Nothing else
  about the Monitor changes - the cards, sparklines and state badges are the same, they just follow the
  picked address.
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

**The transcript is windowed.** Opening a huge session (600+ messages) used to build every message
node at once, which is what felt like a freeze. `renderAll()` now renders only the **last 120**
items; a `show 150 earlier` control at the top pulls in one page at a time, and the scroll position
stays where you were looking. `tab.items` still holds the whole conversation, so search, the pinned
bars and `↓ jump` keep working over everything - jumping to a message that is above the window
simply renders the page that contains it. Measured on a 319-message session: 61 nodes instead of 319
(`[transcript] rendered 61 of 319 items (window from 199)` in the renderer console).

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Enter` | Send (`Shift+Enter` for a newline) |
| `Ctrl+T` | New session (new tab) |
| `Ctrl+Shift+N` | New session inside the current tab |
| `Ctrl+O` | Focus the session search box |
| `Ctrl+W` | Close tab (terminates that pi process) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch tabs |
| `Alt+Up` / `Alt+Down` | Move the active session up / down in the serial queue (also works with the row focused, then plain `Up` / `Down` do it) |
| `Ctrl+B` | Show / hide the sidebar |
| `Ctrl+M` | Show / hide the Strata Monitor |
| `Ctrl+,` | Settings dialog (working folder, serial queue, Strata address, Monitor, paths) |
| `Ctrl+V` | Paste: an image (or file) on the clipboard is attached like a drop, plain text goes into the composer |
| `F2` | Name the current session |
| `Tab` | Complete the highlighted slash command (while the palette is open) |
| `Esc` | Abort what is running (agent run, or a running `!cmd`), close a dialog, or close the slash palette |

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

## Packaging (installers and a portable build)

```bash
npm ci
npm run dist          # whatever platform you are on
npm run dist:win      # NSIS setup + portable zip
npm run dist:mac      # .dmg + .zip (x64 and arm64)
npm run dist:linux    # .AppImage + .deb
```

`electron-builder` is a devDependency; the configuration lives in `package.json` under `build`, the icon
in `build/icon.png` / `build/icon.ico` (a `π` over three Strata layers), and the output goes to `dist/`
(which is git-ignored).

| Artifact | What it is |
|---|---|
| `stratapilot-<version>-win-x64-setup.exe` | NSIS installer: per-user, no admin rights needed, you choose the folder, uninstalling keeps your settings |
| `stratapilot-<version>-win-x64.zip` | the unpacked folder - a **portable** install: unzip anywhere and run `StrataPilot.exe`. This is what CI launches in smoke mode before publishing the artifact |
| `.dmg` / `.zip`, `.AppImage` / `.deb` | built by the same config on the other two platforms |

Verified here: `npx electron-builder --win` produced both Windows artifacts, and the unpacked
`StrataPilot.exe` was started in smoke mode - it opened a window and resolved pi 1.2.0 exactly like
`npm start` does.

Two things to know:

- **Nothing is code-signed.** There is no certificate in this repo, so SmartScreen ("Windows protected
  your PC") and Gatekeeper will complain the first time. That is expected, not a broken build.
- The packaged app uses the same settings file as `npm start` (`%APPDATA%\StrataPilot`), so installing
  over a development run keeps your tabs, queue and jobs.

CI: the `Release build` workflow runs on a `v*` tag or manually (Actions ▸ Run workflow), builds on all
three platforms, uploads each artifact separately, and then **starts the packaged Windows build in smoke
mode** so a build that does not launch never reaches the artifact list.

## Linux and macOS

The app is developed and hand-tested on Windows, so this is what is actually known, and how it is
checked automatically (docs/TODO.md C7):

| Platform | How it is verified | What that proves |
|---|---|---|
| Windows | hand-run smoke scenarios (`STRATAPILOT_SMOKE_*`) | everything below, plus the Strata Monitor, drag & drop and the tray-less menu |
| Linux (`ubuntu-latest` in CI) | `unit tests` job, `pi install smoke` job, and an **`electron smoke`** job that installs the Electron binary, installs pi, and starts a real window under `xvfb-run` with no Strata server | the launcher resolves the managed pi install the same way, the main process spawns, the renderer boots without a single `renderer error`, and the env bar reports the pi it found |
| macOS (`macos-latest` in CI) | same jobs; the `electron smoke` leg is `continue-on-error` because a GUI on a CI runner is flaky there | the launcher and the unit tests; the window start is best-effort - read the job log when someone says "it does not start on macOS" |

What is portable by construction:

- **Settings**: `app.getPath('userData')`, so `%APPDATA%\StrataPilot\stratapilot_settings.json` on
  Windows, `~/.config/StrataPilot/stratapilot_settings.json` on Linux,
  `~/Library/Application Support/StrataPilot/stratapilot_settings.json` on macOS. The log files live
  in `logs/` next to it, the diagnostics dumps in `diagnostics/`.
- **Sessions**: `~/.pi/agent/sessions` on all three (`PI_CODING_AGENT_SESSION_DIR` overrides).
- **pi resolution**: `~/.pi/agent/install/current-version` and the package's `bin` entry, then run that
  JS file with `node` (or Electron as node when there is no node on PATH). No `.cmd`/`.exe` assumption
  anywhere; `STRATAPILOT_PI_CLI` / `STRATAPILOT_NODE` override it on any platform.
- **Menu**: the template has a `darwin` branch (app menu, `CmdOrCtrl` accelerators work on both).

What is Windows-only:

- `scripts/screenshot.ps1` and `scripts/crop.ps1` (dev helpers for these README screenshots) - the app
  does not need them.
- The `%APPDATA%` paths in the docs above: substitute the equivalent for your platform.

Running it on Linux or macOS is the same two commands:

```bash
npm ci
npm start          # or: STRATAPILOT_SMOKE=1 STRATAPILOT_SMOKE_MS=6000 npx electron .
```

On Linux, if Electron refuses to start in a container, add `--no-sandbox` (CI does exactly that).

## Architecture

```
main.js            Electron main process: window, menu, IPC, pi process management
preload.js         contextBridge (window.piGui) + webUtils.getPathForFile
lib/pi-launch.js   resolves the pi CLI and the node executable
lib/pi-process.js  JSONL framing for pi --mode rpc (LF-only line splitting) + command/response pairing
lib/log.js         file log (userData/logs/stratapilot.log) + console tee + rotation
lib/sessions.js    scanning/parsing session JSONL (title, name, first message, tokens…)
renderer/          index.html / styles.css / markdown.js / error-report.js / app.js
test/smoke-rpc.js  headless RPC smoke test
docs/TROUBLESHOOTING.md  troubleshooting (split out of the README)
docs/TODO.md             working backlog (tables: what is still missing, effort and priority)
scripts/screenshot.ps1  screenshots (used while developing the UI)
```

Protocol details: see the pi docs `docs/rpc.md`, `docs/rpc-commands.md`, `docs/json.md`,
`docs/session-format.md`.

### CI

`.github/workflows/ci.yml` runs on push/PR:

| Job | What it does |
|---|---|
| `unit-tests` | `npm test` on **Windows, Linux and macOS** (Node 22.19, the version `engines` requires, and current Node). The unit tests need nothing but Node: no Electron binary is downloaded (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`), no pi, no Strata |
| `syntax` | `node --check` over every `main.js` / `preload.js` / `lib` / `renderer` / `test` file |
| `pi-install` | installs pi on a clean runner and runs `node test/smoke-rpc.js`, which prints what the launcher resolves (cli, node runtime, pi version, sessions root) and exercises `get_state` / `get_available_models` / `get_commands` against a real pi with no model configured |

The smoke scenarios below are **not** in CI: they need a real pi install *and* a running Strata
server with a model loaded, which no hosted runner has. They stay a manual step, and each one prints
one `[smoke-…]` line so you can tell at a glance whether it passed.

### Smoke mode for development

```bash
STRATAPILOT_SMOKE=1 STRATAPILOT_SMOKE_MS=30000 STRATAPILOT_SMOKE_PROMPT="Reply OK" npm start
```

Uses an ephemeral session (writes no file), prints the renderer console to stderr, and quits after
`STRATAPILOT_SMOKE_MS`. Smoke mode uses a separate profile
(`%TEMP%/stratapilot_smoke_profile`) and skips the single-instance lock, so it does not disturb the
GUI you already have open.

Other smoke switches:

| Variable | Effect |
|---|---|
| `STRATAPILOT_SMOKE_PROMPT="…"` | Sends one prompt after startup (tests streaming / markdown / tool cards) |
| `STRATAPILOT_SMOKE_STEER=1` | Sends a second message to exercise the steer path while busy |
| `STRATAPILOT_SMOKE_SESSION=<path>` | Loads a given session with `switch_session` after startup (tests session switching / history rendering); with A2 it also prints `msg_actions=… copy=… resend=…` so you can see the hover actions exist on history-rendered messages, and `[smoke-tokens] bar="tok in … / out … / cache …" message_chips=N first="in … / out …" tooltip="…"` so the token chips are proven to carry the split, not a blended total |
| `STRATAPILOT_SMOKE_QUEUE=1` | Opens 4 tabs and sends 3 messages to test the serial queue (Working/Idle, outbox, order) |
| `STRATAPILOT_SMOKE_MONITOR=1` | Opens the Monitor panel right after startup (with `STRATAPILOT_SMOKE_PROMPT` you can watch the generating state) |
| `STRATAPILOT_SMOKE_COMPACT=1` | Queues a compact during a long generation: "wait for idle" must not kill the request (Strata should show `stop`, not `disconnect`) |
| `STRATAPILOT_SMOKE_ORDER=1` | Opens tabs A/B/C, starts B, then sends in C and A; the order should become `B C A` (A moves from first to the back of Working), execution order B → C → A |
| `STRATAPILOT_SMOKE_AUTO_COMPACT=1` | Checks auto-compaction is always on: `get_state` at boot, `set_auto_compaction off`, then `ensureAlwaysOn()` and read back; should print `boot=true … now=false … ensureOn=true tab.autoCompact=true` |
| `STRATAPILOT_SMOKE_BASH=1` | Runs `!echo …`, `!!echo …` and `!exit 3`, then `/commands`, and checks the slash palette (`/co` + `Tab`): expect `cards=1 class=bash-card done`, `sign=!!`, `class=bash-card error … exit 3`, and `open=true rows=5` |
| `STRATAPILOT_SMOKE_BARS=1` | Sends a long prompt, queues a steer while it runs and prints both pinned bars: expect `top="working on prompt …"` with `bottom="… steering … next turn"`, then `top="last request steering …"` and `bottom="(hidden)"` after the steer is delivered; also checks `↓ jump` (`node=true flashed=true`) |
| `STRATAPILOT_SMOKE_PASTE=1` | Synthesises `paste` events carrying a generated 1×1 PNG: expect `files=1 images=1 chips=1 first=pasted-1.png size=70b`, then `images=2 chips=2 first=pasted-2.png`; also checks a two-image paste, `bmp` → "unsupported image type" toast, an 8 MB+ image → "image too large" toast, plain-text paste (`prevented=false`) and the modal guard (`modalOpen=true prevented=false images` unchanged) |
| `STRATAPILOT_SMOKE_COPY=1` | Sends a prompt, waits for `agent_settled`, then clicks the user message's `copy` / `resend` (clipboard write is captured in JS): expect `copy_ok=true resend_ok=true composer="" queued=1 label_copied=true assistant_copy_ok=true`. A second tab is generating, so the resent text must land in the **outbox** (queue-aware path), not reach the model; also checks the draft guard (`modal=true` and the draft survives a cancel) and that the buttons survive `renderAll()` |
| `STRATAPILOT_SMOKE_EXPORT=1` | Use with `STRATAPILOT_SMOKE_SESSION=<path>`: runs `/export <temp>\stratapilot_smoke_export.html` (no dialog; override the target with `STRATAPILOT_SMOKE_EXPORT_OUT`), then stats pi's returned path through the read-only `fs:stat-paths`: expect `ok=true path=… exists=true bytes=N` |
| `STRATAPILOT_SMOKE_DIAG=1` | Clicks **Diagnostics** (clipboard write is captured in JS) and checks the report: expect `copied=1 chars=… lines=… missing_sections=none unredacted_apikeys=0` — all seven sections present and no `apiKey` value left unredacted |
| `STRATAPILOT_SMOKE_SETTINGS=1` | Opens the Settings dialog, counts its fields, clicks **Save** and re-reads the file: expect `fields=8 rendered=8 prefilled=3 missing=none saved_monitorWidth=520 css=520px serial=true restoreTabs=true` (the smoke profile keeps these writes away from your real settings) |
| `STRATAPILOT_SMOKE_RETRY=1` | Checks auto-retry starts on, exercises `/retry`'s `set_auto_retry off/on` and `abort_retry`, then feeds the two retry events the composer reacts to: expect `bootOn=true setOff=true tabOff=true setOn=true tabOn=true stop_shown=true stop_hidden_after_end=true abort=true` |
| `STRATAPILOT_SMOKE_OUTBOX=1` | B4: packs an outbox entry (an oversized image is dropped instead of bloating the settings file), restores it and checks nothing was sent: expect `packed=2 images_dropped=1 restored=2 pending=2 badge=pending 2 outbox=0 auto_sent=false` |
| `STRATAPILOT_SMOKE_CRON=1` | B5: saves a job through the main process, reads it back with a computed `nextRun`, previews `30 9 * * 1-5`, rejects `nope`, then run-now, and finally opens the dialog to check the builder: expect `saved=true jobs=1 nextRun=set preview="every weekday, at 09:30" has_next=true invalid_rejected=true new_tab=true queued=true outbox_badges=1 list_words="every day, every 5 minutes · next …" builder_default="cron: 30 9 * * 1-5" builder_step="cron: */30 * * * *" weekday_chips=7 weekly_chips_shown=flex shot="…stratapilot-smoke-jobs-editor.png"`. The serial queue is off inside the scenario, so the prompt never reaches the model |
| `STRATAPILOT_SMOKE_TABTAG=1` | D5/D8: expect `model_tag=qwen3.8-flash-n… tag_title="strata/qwen3.8-flash-next-iq3_s" shown_when_alive=false shown_when_dead=true hidden_when_alive_again=true` |
| `STRATAPILOT_SMOKE_I18N=1` | D10: drives the Settings dialog the way a user does (open it, set the **Language** dropdown, press **Save**) for `zh-TW`, then `zh-CN`, then back to `en`, reading the visible text each time: expect `switched=true cjk=true monitor_translated=true restored=true` with `tw_newSession="新工作階段"`, `tw_monitor="速度,GPU 負載,VRAM,GPU 溫度,功耗,PCIe,CPU,磁碟讀取"`, `cn_newSession="新建会话"`, `cn_monitor="速度,GPU 负载,…,磁盘读取"`, `options=auto,en,zh-TW,zh-CN` and `saved_pref=en` (the smoke profile is left in English), plus two screenshots (`stratapilot-smoke-i18n-zh-TW.png`, `stratapilot-smoke-i18n-zh-CN.png`). The catalogs themselves - every key present, no `{placeholder}` changed, `locales/**` packaged - are checked by `test/i18n.test.js` instead | 
| `STRATAPILOT_SMOKE_THEME=1` | D2: expect `changed=true` plus the computed colours of both themes (`dark: body=rgb(15, 17, 21)/rgb(223, 227, 234)`, `light: body=rgb(244, 246, 249)/rgb(27, 35, 48)`) and two screenshots in the temp folder: `stratapilot-smoke-light-theme.png`, `stratapilot-smoke-dark-theme.png` |
| `STRATAPILOT_SMOKE_SETUP=1` | C5 first run: expect `modal=true steps=3 pi="pi 1.2.0 - the version this GUI was tested against…" strata="http://127.0.0.1:8081/health answered /health with HTTP 200 in 30ms" classes=["setup-status good","setup-status good","setup-status"] closed=true first_run_seen=true` |
| `STRATAPILOT_SMOKE_A11Y=1` | D3: expect `dialog=true role=dialog aria_modal=true labelled_by_heading=true focus_inside=true tab_wraps=true esc_closes=true focus_restored=true nameless_buttons=0 toasts_live=polite tabs_role=tablist` plus the `aria-label` of an idle queue row and of a working one (`working_row_label="..., running, queue position 1 of 1. ..."` - the working row is the one that carries a position, and it is the row that once threw) |
| `STRATAPILOT_SMOKE_STORAGE=1` | D7: reads the totals and three plans (absurd age, absurd cap, everything), checks the open session is filtered out and that the dialog opens and closes: expect `ok=true files=15 bytes=8562058 groups=2 none=0 also_none=0 everything=15 scanned=15 open_in_list=false footer="15 / 15 sessionsStorage: 8.2 MB in 15 files" dialog=true dialog_closed=true`. **Nothing is deleted by the scenario** |
| `STRATAPILOT_SMOKE_USAGE=1` | D9: reads the ledger through IPC (per day and per month), checks the footer chip follows a fresh summary (the reported bug was that it only moved after an app restart), opens the Usage dialog, counts the columns drawn, clicks one (the breakdown line must follow), unticks the cache stack (the axis must rescale), writes rates through the same IPC the rate table uses and switches the columns to **cost (USD)** (the axis must become money, the rate rows and their four inputs must exist, the header must show a `$` total), types one model rate through the dialog's own save path (the money must go **up** and the row must land in `byModel`), puts the rates back, switches to per month and counts again, then closes it: expect `ok=true ipc_day=4 ipc_month=1 chart_columns=4 after_unit=1 entries=10 chip_before="Usage: 100.36M tok" chip_after="Usage: 100.38M tok" chip_follows_ledger=true gone=0 dedupe_missed=0 ledger="token_usage.json" total=100378346 cache_read=96808484 answers=1156 compactions=6 branches=0 axis_with_cache="0\|20.00M\|40.00M\|60.00M\|80.00M" axis_without_cache="0\|800.0k\|1.60M\|2.40M\|3.20M" rescaled=true cost_axis="$0\|$1.00\|$2.00\|$3.00\|$4.00" cost_is_money=true rate_rows=4 rate_inputs=12 money_in_header=true money_before="14.26" typed_model_rate="qwen3.8-flash-next-iq3_s" saved_by_model=["qwen3.8-flash-next-iq3_s"] money_after="22.20" money_changed=true money_up=true refilled_boxes=5 detail="…" footer="…Usage: 100.45M tok" dialog=true dialog_closed=true`, plus three screenshots (`stratapilot-smoke-usage-chart.png`, `...-nocache.png`, `...-cost.png`). **Read-only for sessions** - and the smoke profile's ledger and settings files are separate from the real ones. To prove the live path end to end, point it at a throwaway sessions root (`PI_CODING_AGENT_SESSION_DIR=<temp root>`) and keep appending usage records to a session file while it runs: the log then shows `[usage-live] ledger total 100378346 → 100448046` and the smoke line shows `chip_before` and `chip_after` differing |
| `STRATAPILOT_SMOKE_SERVERS=1` | D6: adds an unreachable address (`http://127.0.0.1:9/v1`) through Settings, checks the pill and its red health dot, points the cards at it, then removes it through the pill's `x`: expect `pills=4 bogus_pill=true dot_before="mon-dot bad" dot_after="mon-dot bad" active=127.0.0.1:9× removed=true pills_after=3` |
| `STRATAPILOT_SMOKE_PATH=1` | D1: types `@lib/d` in the composer, waits for the palette, presses Enter: expect `rows=1 first="@lib/diagnostics.js…" inserted="read @lib/diagnostics.js" menu_open_after=false sent_instead=false` (the path is inserted, the prompt is **not** sent) |
| `STRATAPILOT_SMOKE_TREE=1` | B1 read-only: opens the tree of a loaded session: expect `modal=true rows=278 on_path=278 off_path=0 branch_heads=0 fork_buttons=12 chip="tree"` |
| `STRATAPILOT_SMOKE_FORK=1` | B1, **writes**: run it against a throwaway session only. Opens the tree, clicks **fork here** on the first user message, confirms, re-reads: expect `fork_button=true confirm=true rows_after=2 items_before=5 items_after=1` |

```bash
# serial queue test: first should finish before second starts; groups go WWWI → IWWI → IIII
STRATAPILOT_SMOKE=1 STRATAPILOT_SMOKE_MS=30000 STRATAPILOT_SMOKE_QUEUE=1 npm start
```

## Logs and crash diagnosis

Everything the main process prints is mirrored to a file, so a crash can be diagnosed after the
window is gone:

```
%APPDATA%\StrataPilot\logs\stratapilot.log      (Windows)
~/.config/StrataPilot/logs/stratapilot.log      (Linux)
~/Library/Application Support/StrataPilot/logs/  (macOS)
```

Menu **Help ▸ Open Log Folder** opens it. The file rotates at ~2 MB and keeps two older generations
(`stratapilot.log.1`, `.2`). Every record is `[ISO timestamp] [LEVEL] message`.

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
| `[crash] recovery offered: …` / `[crash] reloading interface` | the crash dialog was shown and what the user chose (see [Recovering from a crash](#recovering-from-a-crash)) |
| `[crash] renderer unresponsive` / `responsive again` | the renderer stopped replying for >30 s |
| `[crash] … process gone reason= code=` | any Electron child process (GPU, utility…) died |
| `[fatal] uncaughtException (source):` + stack | main-process crash — the app quits, but the stack is on disk |
| `[error] unhandledRejection:` | main-process promise rejection (does not quit) |

Notes:

- Logging is best-effort: if the log file cannot be opened the app keeps running and says so once
  (`[log] disabled, cannot open log file: …`).
- Smoke mode writes its own log under `%TEMP%/stratapilot_smoke_profile/logs/`, so automated runs
  never touch the real one.
- A renderer exception used to be invisible: nothing was written to disk, no crash dump, no Windows
  error report. If the UI ever freezes or vanishes again, read the log first — the last
  `[renderer error]` / `[crash]` / `[fatal]` line is normally the answer.

### Recovering from a crash

A dead or hung renderer used to leave a white window with no message and no way back. Now the main
process notices all three shapes of it and offers to fix them itself:

| What happens | What it does |
|---|---|
| renderer process died (`render-process-gone`), the interface stopped answering for >30 s (`unresponsive`), or the page failed to load (`did-fail-load`) | a dialog: **Reload interface** or **Keep the window as it is** |
| the interface starts answering again after a hang | a toast says nothing was reloaded, so you know it was a stall rather than a restart |
| you choose Reload | `webContents.reload()` rebuilds the interface; the tabs are restored from the settings file **with their tab ids**, and `spawnTab` hands back the pi process that is still running for that id instead of starting a second one |

What survives a reload: every session file, the conversation context, and a generation that is
still running in pi (it keeps streaming into the reloaded window). What does not: the transcript
that was on screen (it is re-read from the session file), unsaved and ephemeral tabs (no file to
reopen), and the outbox (see the note in `docs/TODO.md` B4).

### One-click diagnostics report

The topbar **Diagnostics** button (also `/diagnostics`, also menu **Help ▸ Copy Diagnostics**)
assembles everything [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) asks for when reporting an issue
into one text block, puts it on the clipboard and saves a copy to
`%APPDATA%\StrataPilot\diagnostics\stratapilot_diagnostics_<timestamp>.txt`:

| Section | Contents |
|---|---|
| `[1]` | placeholder for the symptom / reproduction steps you still have to write yourself |
| `[2]` | app / Electron / Node versions, platform, log, settings and sessions paths, plus the **token ledger** summary (total in / out / cache read / cache write, how many of those calls were compaction or branch summaries, and the flags: deleted sessions, sessions past the 12 MB scan cap, forks that could not be deduplicated) and the **rates** the money side uses (USD per 1,000,000 tokens: the default row plus every model row, or a line saying no rates were entered) |
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
- The transcript shows the branch you are on; `/tree` shows the whole entry tree and can fork from an
  earlier prompt or clone the branch, but there is no way to move the leaf onto an abandoned branch - pi
  exposes no RPC for that, only `fork` (user messages) and `clone`.
- Dropping a folder only inserts its path; it is not expanded into multiple attachments.
- One pi process per tab, so many tabs cost memory.
- Only one bash command per tab at a time (pi's own limit), and a bash command started by an
  extension without output events gets no card until its first `bash_execution_update`.
- The scheduler can only serialize prompts **sent from the GUI**; executions started by an extension
  cannot be blocked (in that case it takes over `runningTabId` directly and shows it in the queue).
- A queued message that was still in the outbox when the app closed comes back as **pending** (never
  sent on its own), but only for tabs that have a session file: an unsaved or ephemeral tab has
  nothing to reopen, so its outbox is lost with it. Images of those queued messages are dropped when
  they would make the settings file bigger than ~400 KB.

## License

MIT — see [LICENSE](LICENSE). What was added when: [CHANGELOG.md](CHANGELOG.md). The working backlog
with effort/priority/status for everything not done yet: [docs/TODO.md](docs/TODO.md).
