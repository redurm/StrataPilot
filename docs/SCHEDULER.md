# Scheduled prompts (cron)

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

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
