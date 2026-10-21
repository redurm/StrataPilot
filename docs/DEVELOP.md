# Development: architecture, CI, smoke mode, packaging

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

## Architecture

```
main.js            Electron main process: window, menu, IPC, pi process management
preload.js         contextBridge (window.piGui) + webUtils.getPathForFile
lib/pi-launch.js   resolves the pi CLI and the node executable
lib/pi-process.js  JSONL framing for pi --mode rpc (LF-only line splitting) + command/response pairing
lib/log.js         file log (userData/logs/stratapilot.log) + console tee + rotation
lib/sessions.js    scanning/parsing session JSONL (title, name, first message, tokens…) + storage cleanup
lib/usage-ledger.js token rollup (userData/token_usage.json) - incremental, and it never writes tokens off
lib/cron.js        scheduled prompts: plain words in, next-run times out
lib/diagnostics.js the one-click report; keys are redacted before the text is built
renderer/          index.html / styles.css / theme-boot.js / i18n.js / markdown.js / error-report.js / app.js
locales/           zh-TW.json / zh-CN.json - the English source string is the key
test/              node --test unit tests (176) + smoke-rpc.js, the headless RPC check
scripts/           screenshot.ps1 / crop.ps1 / i18n-extract.js (npm run i18n, i18n:missing, i18n:unwrapped)
docs/              the reference, split by topic - the README table is the index
test/docs-links.test.js  the check that keeps that split honest (files, anchors, index, README length)
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

**CI runs the scenarios that need no model.** `STRATAPILOT_SMOKE_SAFE=1` turns on every scenario in
`lib/smoke-flags.js` `MODEL_INDEPENDENT` (plus `SMOKE_PERSIST` and `SMOKE_MONITOR`), and the CI job
`smoke scenarios` runs exactly that on Windows and Linux against a real pi with no credentials. The
scenarios run **one at a time** in `SCENARIO_TABLE` order and the app quits when they have all
reported, printing one tally line:

```
[smoke-scenarios] tally ran=16/16 crashed=0 fail_lines=0
```

The verdict comes from the log, not the exit code:

```bash
STRATAPILOT_SMOKE=1 STRATAPILOT_SMOKE_SAFE=1 npx electron . > smoke.log 2>&1
node scripts/check-smoke-log.js smoke.log --safe
```

That checker fails when a scenario printed `FAIL`, threw, finished without printing its `[smoke-…]`
line, or when the tally line is missing at all - which is how a run that ended early used to look like
a pass. Adding a scenario to the safe set makes CI demand its line automatically
(`test/smoke-flags.test.js` keeps the tag table honest).

Other smoke switches:

| Variable | Effect |
|---|---|
| `STRATAPILOT_SMOKE_SAFE=1` | Turns on every scenario that needs no model and no credentials - the set CI runs (#47). See the block above |
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
On a tag push a `publish-release` job then collects those artifacts and opens the GitHub Release for the
tag (`gh release create --verify-tag`, notes taken from that version's `CHANGELOG.md` section by
`scripts/release-notes.js`). electron-builder's own publish stays disabled - it wants a token and fails
after everything is already built (#38) - and the workflow uses the token GitHub hands the job, so no
secret has to be configured (#41).

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
