# Logs, crash recovery and the diagnostics report

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

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
assembles everything [TROUBLESHOOTING.md](TROUBLESHOOTING.md) asks for when reporting an issue
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
