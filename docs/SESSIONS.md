# Sessions, tabs and the serial queue

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

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
