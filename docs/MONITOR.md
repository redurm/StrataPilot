# Strata Monitor

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

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
