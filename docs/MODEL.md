# Model behaviour: compaction, retry, streaming

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

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
