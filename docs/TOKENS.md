# Tokens: the usage ledger, the chart and the rates

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

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
