# StrataPilot

A desktop GUI for the pi coding agent running against a local Strata server (Electron + pi RPC mode).
Each tab is its own `pi --mode rpc` process, so you can have **several sessions open at the same
time**; because Strata handles only one request at a time, sends across sessions are ordered by the
built-in **serial queue**.

**Cloning this repo?** Four things have to be installed before a prompt can come back: **git**,
**Node.js 22.19+**, **Strata** (the local model server) and **pi** (the coding agent). This repo adds
exactly one dependency of its own — Electron, fetched by `npm ci` — and has no build step. The
walkthrough is [docs/INSTALL.md](docs/INSTALL.md).

> Renamed twice — `pi_gui` → **Pi on Strata** → **StrataPilot**. The app name, the settings file
> (`%APPDATA%\StrataPilot\stratapilot_settings.json`; the `pi-gui` and `Pi on Strata` files are carried
> over automatically on first launch) and the environment variable prefix
> (`PI_GUI_*` → `PI_ON_STRATA_*` → `STRATAPILOT_*`; the old names still work, the new one wins) are all
> updated. The **project folder** itself has to be renamed with `..\rename_to_stratapilot.ps1` (you must
> leave the pi conversation and close the app first, otherwise Windows blocks it). That script also fixes
> the pi sessions folder name, the `cwd` recorded inside session files, and the paths stored in the app
> settings.

## Documentation

The reference used to be one 1 400-line file; it is split by topic now.

| File | What is in it |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | what you are installing (git, Node, Strata, pi), the fresh-clone walkthrough step by step, proxy / offline install, where the app keeps its files, reset and uninstall, and what to do when the install itself fails |
| [docs/CONFIGURE.md](docs/CONFIGURE.md) | the `/setup` first-run check, connecting pi to Strata (`models.json`), every `STRATAPILOT_*` environment variable, and the settings file |
| [docs/SESSIONS.md](docs/SESSIONS.md) | the two sidebar lists, exporting a session, the serial queue, the session tree and branching, storage size and cleanup |
| [docs/COMPOSER.md](docs/COMPOSER.md) | bash mode (`!`), slash commands (`/`), `@` path completion, how links are handled, keyboard shortcuts |
| [docs/TOKENS.md](docs/TOKENS.md) | the token usage ledger, the day / week / month / year chart, the rate table and cost columns, and what in / out / cache read / cache write mean |
| [docs/MODEL.md](docs/MODEL.md) | auto-compaction, retry of transient model errors, compaction and an in-flight request, streaming performance |
| [docs/MONITOR.md](docs/MONITOR.md) | the Strata Monitor: address and key, more than one Strata server |
| [docs/SCHEDULER.md](docs/SCHEDULER.md) | scheduled prompts (cron) |
| [docs/APPEARANCE.md](docs/APPEARANCE.md) | theme (dark / light), interface language (English / 繁體中文 / 简体中文), accessibility |
| [docs/LOGS.md](docs/LOGS.md) | the log file and what lands in it, recovering from a crash, the one-click diagnostics report |
| [docs/DEVELOP.md](docs/DEVELOP.md) | architecture, CI, smoke mode for development, packaging installers, Linux and macOS |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | runtime problems of a working install, by symptom |
| [docs/TODO.md](docs/TODO.md) | the backlog with effort / priority / status |
| [CHANGELOG.md](CHANGELOG.md) | what was added, fixed and changed, by release |

## Quick start

```bash
git clone https://github.com/redurm/StrataPilot.git && cd StrataPilot
npm ci            # Electron is the only thing downloaded (~110 MB, cached for the next clone)
npm start         # = electron .  (single instance: a second run just focuses the window)
```

In the window: `Ctrl+T` → pick a **working folder** (the folder pi will read and edit), pick the model
and the thinking level in the top bar, type a prompt. `Ctrl+M` opens the Strata Monitor, `/stats`
prints token and context use, and every shortcut is in
[docs/COMPOSER.md](docs/COMPOSER.md#keyboard-shortcuts).

If the model dropdown is empty, pi has no provider yet: run `/setup` in the app, then
[Connecting pi to Strata](docs/CONFIGURE.md#connecting-pi-to-strata-one-time-setup).

Prove each layer before blaming the GUI:

| Command | What it proves |
|---|---|
| `npm test` | this repo's own logic — no Electron, no pi, no Strata needed (176 tests) |
| `node test/smoke-rpc.js C:/some/project` | pi is found by the launcher and one RPC round trip works |
| `curl http://127.0.0.1:8081/health` | Strata answers, and which model / port / context it is on |
| `/setup` inside the app | the pi it found, `/health` answering, the working folder new tabs start in |

Strata and pi themselves are installed by their own installers —
[docs/INSTALL.md](docs/INSTALL.md) has both, plus the proxy / offline tricks, `ELECTRON_MIRROR`, where
the app keeps its files, and how to reset or uninstall.

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
  [Auto-compaction](docs/MODEL.md#auto-compaction-identical-to-the-cli)); the composer only gets a
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
