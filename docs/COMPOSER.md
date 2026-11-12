# The composer: bash mode, slash commands, links, shortcuts

Part of the StrataPilot documentation. The index and the feature overview are in
[README.md](../README.md), runtime problems are in [Troubleshooting](TROUBLESHOOTING.md), and the
backlog is in [TODO.md](TODO.md).

## Bash mode (`!`) and slash commands (`/`)

Same prefixes as pi's own TUI, wired to the RPC commands pi already exposes.

### `!command` — run a shell command

- Type `!git status` (the composer border turns amber while you type it) and Enter runs it through
  pi's RPC `bash` in the session's working folder. A card appears, output streams in via
  `bash_execution_update` events, then the exit code and duration land in the card footer.
- `!!command` records the output in the session but keeps it **out of the model context**.
- The output reaches the model with your **next** message: pi turns the recorded `bashExecution`
  message into a user message (`Ran \`cmd\`` plus fenced output). Nothing is sent just because you
  ran a command.
- bash never touches the model, so it deliberately **skips the serial queue** — it can run while
  another tab is generating.
- `Esc` (or the `Stop` button) sends `abort_bash`. One bash command per tab at a time (pi's own
  limit): a second `!cmd` while one runs is refused with a toast.
- Very long output is truncated by pi; the card shows the `fullOutputPath` log file when that
  happens.
- Cards survive a reopen: pi stores every run as a `bashExecution` message in the session file, and
  the GUI renders those with the same card style.
- Commands started by an extension (not by you) also get a card, as soon as their first output event
  arrives.

### `/command` — the command palette

Typing `/` opens a palette: `↑`/`↓` to move, `Tab` or `Enter` to complete the highlighted name (a
second Enter sends it), `Esc` to close. Rows tagged `app` are executed by the GUI; everything else is
passed to pi, which expands extension commands, prompt templates and `/skill:name`.

| Command | What it does |
|---|---|
| `/compact [instructions]` | compact this context; while the session is running it asks first (inline instructions are queued until the session goes idle) |
| `/export [path]` | save this session as HTML (pi's `export_html`); no argument opens the native Save dialog, an argument must be an absolute `*.html` — see "Export a session" under the sidebar lists |
| `/model [provider/id]` | pick a model from a list, or set one by (partial) name |
| `/thinking [level]` | show the available levels, or set one |
| `/new`, `/clear` | start a new session in this tab |
| `/rename <name>` | name the current session |
| `/abort` | stop the current run or bash command |
| `/resume` | focus the session search in the sidebar |
| `/settings` | open the Settings dialog (the topbar button or `Ctrl+,`) |
| `/retry [on\|off\|stop]` | pi's retry of transient model errors: on/off for this session, `stop` cancels a retry sitting in its delay - see [Retry of transient model errors](MODEL.md#retry-of-transient-model-errors) |
| `/jobs` | open the scheduled-prompts dialog - cron jobs, see [Scheduled prompts (cron)](SCHEDULER.md#scheduled-prompts-cron) |
| `/setup` | open the first-run check: is pi installed, is Strata reachable, which folder do new tabs start in |
| `/tree` | show the session tree: the branch you are on, abandoned entries, fork from an earlier prompt, clone the branch |
| `/stats` | print tokens / cost / context usage into the transcript |
| `/usage` | token usage per day / week / month / year (in, out, cache), from the ledger - see [Token usage (per day / week / month / year)](TOKENS.md#token-usage-per-day--week--month--year) |
| `/monitor` | toggle the Strata monitor |
| `/diagnostics` | copy a diagnostics report for a bug report (see [One-click diagnostics report](LOGS.md#one-click-diagnostics-report)) |
| `/commands`, `/help` | list the app commands plus everything `get_commands` reports from pi |

pi's built-in TUI commands (`/settings`, `/hotkeys`, …) do not exist in RPC mode — the palette list
comes from `get_commands`, which only reports extension commands, prompt templates and skills. An
unrecognised `/foo` is sent to pi as written (it then reaches the model as plain text).

### `@` path completion (D1)

Typing `@` after a space (or at the start) opens the same palette, but with the **contents of the
session's working folder**:

| | |
|---|---|
| Trigger | `@` at the caret, e.g. `read @lib/dia` - the token under the caret is what is matched, not the whole line |
| Listing | the main process lists one directory level (`fs:complete`); it never goes above the session folder, and `node_modules`, `.git`, `.venv`, `__pycache__`, `dist`, `build`, `out`, `.next`, `.cache` are hidden unless you type them on purpose |
| Pick | `Up` / `Down`, then `Enter` or `Tab` inserts the path (`@lib/diagnostics.js`); a folder keeps the menu open for the next level (`@src/`), `Esc` closes it |
| Two Enters | the first completes the path, the second sends the prompt - the same rule as the command palette |
| Not an attachment | the path is inserted as **text**; the model reads the file with its own tools. Drag & drop or **Attach files** is still what actually uploads content |

## How markdown is rendered

The transcript renders what a chat answer actually contains, and refuses to render the rest. The
renderer is hand-written (`renderer/markdown.js`, no dependency, no build step) and it escapes every
token before it emits markup, so model output can never inject HTML.

- **Block level**: fenced code (``` and `~~~`, any fence length, an unclosed fence runs to the end of
  the answer because that is where the answer ends), tables with `:---:` alignment, nested ordered and
  unordered lists, task lists, blockquotes (including nested ones and GitHub alerts
  `[!NOTE] [!TIP] [!IMPORTANT] [!WARNING] [!CAUTION]`, which get a class rather than an emoji),
  `#` and `===`/`---` underlined headings, thematic breaks, and 4-space indented code
- **A single newline inside a paragraph is a line break**, not a paragraph gap: pi's system prompt
  tells models CJK output needs no blank lines between paragraphs, and a renderer that joins those
  lines produces one unreadable wall
- **Inline**: emphasis (`**b**`, `*i*`, `_i_`; the CJK cases work - `**粗體**中文` where the closing
  marker is followed by a non-space that is not punctuation, `、*斜體*、` where the opener follows CJK
  punctuation, `中文*斜體*中文` between CJK letters - while `2 * 3 * 4` and `snake_case_name` stay text),
  inline code (its content is tokenised before emphasis runs,
  so `` `a*b*c` `` stays literal), links `[t](u "title")`, reference and shortcut links, angle-bracket
  autolinks, bare-URL linkification
- **Not rendered, on purpose**: raw HTML (other than autolinks), `<img>` (the CSP allows `img-src
  'self' data: blob:`, so a remote image would be a tracker the user never asked for: an image becomes
  a labelled chip), Mermaid and math (this app has no renderer for them; the **Markdown Viewer**
  button hands the block to an external program, see [CONFIGURE.md](CONFIGURE.md)), footnotes (a
  transcript has no page bottom to park one at - the `[^1]: …` line stays as text, it is not dropped),
  `==mark==`, `::: containers`, `++underline++`, subscript/superscript (`~2~`, `^2^`), `:emoji:`
  shortcodes, smart punctuation (`---`, `...`), definition lists, `*[HTML]: …` abbreviations and
  `{#custom-id}` heading ids. An unknown construct is left as text, which is ugly but honest
- `linkify()` is the links-only path used for user messages, thinking, tool cards and notes; assistant
  text goes through `mdToHtml()`
- Streaming thinking / tool output uses `setPreText()` / `appendPreText()`: innerHTML is re-applied
  only when the text contains `http`, so long output is not re-rendered per delta
- Link clicks are caught at the `document` level → `api.openExternal(href)` → `shell.openExternal`.
  A target that is not `http(s)`, `mailto:` or an app route is not made clickable at all, and one
  whose path traverses (`..`) is rendered as a dead-link marker rather than a link
- Belt and braces: the main process has `setWindowOpenHandler` (deny) and `will-navigate` (blocks
  navigation away from the current page), so even `target="_blank"` never opens an extra Electron
  window
- Fenced blocks are coloured by `renderer/highlight.js` (also hand-written: vendoring highlight.js
  would mean ~1 MB of code and a bundler this repo does not have). An unknown language is not an
  error - the block is escaped and left uncoloured, so a new language costs a rule set and nothing else

## How the Markdown Viewer handoff works

A Mermaid block, a long answer, or any markdown the transcript will not draw: the **viewer** button on
a fenced block (diagrams only) or in an assistant message's actions writes the source to a `.md` file
under the user temp folder and opens it with an external program. Nothing is rendered inside this app,
and the file is a real file, so saving, printing and searching it are the viewer's problem, not ours.

- `lib/md-viewer.js` owns the rules: the message title becomes a file name that cannot walk out of the
  handoff folder (separators, leading and trailing dots, a name that is only dots), two messages with the
  same title get two files instead of the viewer showing a stale answer, an over-long answer is cut at a
  byte cap without splitting a multi-byte character, handoff files older than a week are pruned on the
  next handoff, and the fence wrapped around a copied block is sized longer than anything inside it
  (`fenceFor()`), because a block quoted inside a block would otherwise close itself
- which program: the `markdownViewerPath` setting, then `STRATAPILOT_MD_VIEWER`, then the operating
  system's handler for `.md`. A configured path that no longer exists is **reported**, never quietly
  replaced - silently opening Notepad is how "the diagram showed a wall of text" becomes a bug report
- `test/md-viewer.test.js` covers the rules; `STRATAPILOT_SMOKE_MDVIEW=1` drives the channel through
  the real app with a viewer that cannot exist, so no desktop program is launched inside a test run, and
  `STRATAPILOT_SMOKE_MDVIEW_EXE=<executable>` adds the launch itself when a developer wants it proved

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Enter` | Send (`Shift+Enter` for a newline) |
| `Ctrl+T` | New session (new tab) |
| `Ctrl+Shift+N` | New session inside the current tab |
| `Ctrl+O` | Focus the session search box |
| `Ctrl+W` | Close tab (terminates that pi process) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch tabs |
| `Alt+Up` / `Alt+Down` | Move the active session up / down in the serial queue (also works with the row focused, then plain `Up` / `Down` do it) |
| `Ctrl+B` | Show / hide the sidebar |
| `Ctrl+M` | Show / hide the Strata Monitor |
| `Ctrl+,` | Settings dialog (working folder, serial queue, Strata address, Monitor, paths) |
| `Ctrl+V` | Paste: an image (or file) on the clipboard is attached like a drop, plain text goes into the composer |
| `F2` | Name the current session |
| `Tab` | Complete the highlighted slash command (while the palette is open) |
| `Esc` | Abort what is running (agent run, or a running `!cmd`), close a dialog, or close the slash palette |
