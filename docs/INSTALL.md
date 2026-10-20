# Install from a fresh clone

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

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
| Operating system | Windows 10/11 x64 | developed and hand-tested on Windows; Linux and macOS run in CI — see [Linux and macOS](DEVELOP.md#linux-and-macos) |
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
[Environment variables](CONFIGURE.md#environment-variables-all-prefixed-stratapilot_).

### Step 4: point pi at Strata

Add Strata as a provider in `~/.pi/agent/models.json` and set `defaultProvider` in
`~/.pi/agent/settings.json`. **Do not copy anyone's block: every value comes from *your* Strata
install.** The field-by-field mapping, and the two `curl` calls that read the values back off the
running server, are in [Connecting pi to Strata (one-time setup)](CONFIGURE.md#connecting-pi-to-strata-one-time-setup).

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
  installer / portable zip — see [Packaging](DEVELOP.md#packaging-installers-and-a-portable-build). Nothing is
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
4. Every shortcut: [Keyboard shortcuts](COMPOSER.md#keyboard-shortcuts). Something broke: start at
   [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md), and press **Diagnostics** (`/diagnostics`)
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

Runtime problems live in [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md); this table is only
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
| the window opens but the model dropdown is empty | Step 4 was skipped — pi has no provider. Run `/setup` and then read [Connecting pi to Strata](CONFIGURE.md#connecting-pi-to-strata-one-time-setup) |
| the window opens, sending spins forever | Strata is not running, or the port in `baseUrl` is not the port the launcher uses → `curl http://127.0.0.1:8081/health` |
| you want proof of all of this without opening a window | `node test/smoke-rpc.js <cwd>` — its first four lines are exactly what `lib/pi-launch.js` resolved |
