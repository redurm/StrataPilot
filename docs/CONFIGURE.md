# Configuration reference

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

What the GUI reads and writes, and what to set when auto-detection is not enough. Getting from a bare
clone to a running window is [Set up from a fresh clone](INSTALL.md#set-up-from-a-fresh-clone-step-by-step).

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
| `STRATAPILOT_SMOKE*` | Developer smoke mode | See [Smoke mode](DEVELOP.md#smoke-mode-for-development) |

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
| `strataUrls` | Extra Strata addresses the Monitor should watch (array, one per line in the Settings dialog) - see [More than one Strata server](MONITOR.md#more-than-one-strata-server) |
| `theme` | `dark` (default), `light` or `system` - see [Theme (dark / light)](APPEARANCE.md#theme-dark--light) |
| `language` | `auto` (default, follows the OS), `en`, `zh-TW` or `zh-CN` - see [Language](APPEARANCE.md#language-english--繁體中文--简体中文) |
| `strataConfigPath` | Optional path of the Strata engine config (`C:\Strata\strata-src\strata-<model>.json`): only used to include that file, keys redacted, in the diagnostics report |

The old `pi-gui` / `Pi on Strata` settings files are migrated automatically on first launch (see the
note at the top).
