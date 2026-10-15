# Pi on Strata

pi coding agent 跑在本地 Strata server 上的桌面圖形介面（Electron + pi RPC mode）。
每個分頁 = 一個獨立的 `pi --mode rpc` 程序，所以可以**同時**開多個 session；
因為 Strata 一次只能處理一個請求，跨 session 的發送由內建的**串行佇列**排序。

> 名稱改自 `pi_gui`：應用名稱、設定檔（`%APPDATA%\Pi on Strata\pi_on_strata_settings.json`，
> 舊檔首次啟動會自動搬過來）、環境變數前綴（`PI_GUI_*` → `PI_ON_STRATA_*`）都已改好。
> **專案資料夾**要用 `..\rename_pi_gui.ps1` 改（必須先離開 pi 對話，否則 Windows 會擋掉），
> 該腳本會一併處理：pi sessions 資料夾名稱、session 檔記錄的 cwd、app 設定裡的路徑。

## 功能

- **New session**：`Ctrl+T` 開新分頁（可指定工作資料夾、session 名稱、是否 ephemeral 不存檔）；
  `Ctrl+Shift+N` 在同一個分頁內用 RPC `new_session` 重置。
- **Session switch**：左側欄列出 `~/.pi/agent/sessions/` 底下的 session（可搜「本資料夾」或「全部專案」）。
  - 點一下 → 在新分頁開啟（`pi --session <path>`）
  - `this tab` → 用 RPC `switch_session` 載入到目前分頁
  - `name` / `del` → 重新命名（append `session_info` entry）／刪除檔案
  - 分頁列：雙擊分頁或 `F2` 可命名 session
- **拖拉檔案**：把檔案／資料夾拖到視窗任何位置 → 變成附件 chip
  - 圖片（png/jpg/gif/webp，≤8MB）→ 以 RPC `images`（base64）送出
  - 其他檔案／資料夾 → 插入**絕對路徑**清單，pi 用 `read` 工具去讀
  - 拿不到絕對路徑時自動退回內文嵌入（inline）
  - `Attach files` 按鈕走同樣的管線
- **Serial queue（strata 單工）**：左側欄 `OPEN SESSIONS (QUEUE)` 把開著的分頁分成
  **Working** 與 **Idle** 兩群，一次只跑一個 session，照清單順序（見下方說明）
- **Strata Monitor**（`Ctrl+M`）：內建 Strata server 的監控頁（抄自 `C:\Strata\strata-src\serve\web`），
  不用開瀏覽器就能看到模型狀態、速度、GPU/VRAM/溫度/功耗/PCIe/CPU/磁碟、context fill 與最近請求
- **串流顯示**：assistant 文字／thinking（可摺疊）／tool call 卡片（args、即時 partial output、結果、耗時）
- **Markdown 渲染**（`renderer/markdown.js`，零依賴）：標題、清單、引用、分隔線、程式碼區塊（附 copy）
  與 **GFM 表格**（`:---` / `:---:` / `---:` 對齊、欄數不等會自動補空／截斷、支援跳脫 `\|`、
  儲存格內可再放 bold／code span；串流中表格邊生成邊成形）
- **超連結**：chat 裡所有文字（assistant、user、thinking、tool args/output、note）的
  `http(s)://` 都會自動變成可點連結；點一下用**預設瀏覽器**開啟（不會開第二個 Electron 視窗）
- **模型與 thinking**：下拉選單（`get_available_models` / `set_model` / `get_available_thinking_levels` / `set_thinking_level`）
- **busy 時送訊息**：`steer` 或 `follow-up`（下拉切換），`Esc` 中止，`Clear queue` 把排隊訊息拿回編輯區
- **Compact**：手動壓縮 context；狀態列顯示 context 使用率、token、cost；
  編輯區旁有 **`auto-compact`** 核取方塊可開關這個 session 的自動壓縮（見下方說明）
- **Extension UI 轉接**：extension 發出的 `select` / `confirm` / `input` / `editor` 會變成視窗內對話框，
  `notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text` 也會顯示
- 重啟後自動還原上次開著的 session 分頁（最多 4 個）

## 左側欄的兩個清單（為什麼有的重複、有的不重複）

它們是**不同來源**，所以會部分重疊：

| | `OPEN SESSIONS (QUEUE)` | `SESSION FILES` |
|---|---|---|
| 來源 | 記憶體中**開著的分頁**（每頁＝一個 `pi --mode rpc` 程序） | 磁碟上的 session JSONL（`~/.pi/agent/sessions/`） |
| 用途 | 串行執行順序、拖曳排序、outbox | 找回／開啟／載入／改名／刪除歷史對話 |
| 生命週期 | 關分頁就消失 | 永久存在 |

出現規則：

- **兩邊都有**：這個 session 檔正在某個分頁裡 → Session files 那列會顯示藍色 **`open #n`**
  徽章（`#n` 就是它在上面佇列的位置），並高亮目前分頁的那個
- **只在上邊**：分頁還沒有對應的檔 → 佇列列顯示 **`unsaved`**（pi 要收到第一則訊息才建檔）
  或 **`ephemeral`**（開分頁時選了不存檔，永遠不會出現在 Session files）
- **只在下邊**：沒開在任何分頁的歷史 session
- **看不到但其實存在**：Session files 會被 `Search…` 與 `this folder` / `all projects`
  過濾（只影響這個清單，不影響上面佇列），且只列最近 400 筆
- 另外：`this tab`（`switch_session`）或 `Ctrl+Shift+N` 會把分頁指向**另一個** session 檔，
  舊檔仍留在 Session files 裡（所以你會看到「剛才有、現在不在上面」的情況）

## Serial queue（一次只跑一個 session）

strata 這類 provider 只能單工，所以 GUI 內建一個排程器（`renderer/app.js` 的 `scheduler`）。
左上 `OPEN SESSIONS (QUEUE)` 的 **serial** 核取方塊可開關（預設開，會記在設定裡）。

### 行為

1. 清單順序（`state.order`）就是執行順序，**最上面的先跑**。
2. 在其他分頁按 Send 時，如果已經有另一個 session 在跑 → 訊息不會直接送給 pi，
   而是存進該分頁的 **outbox**（待送佇列），該分頁立刻進入 **Working** 群，
   並且**自動插到 Working 群的最後**（不會插隊到原本就在排的 session 前面）。
   已在 Working 群内的分頁再送 → 只排進自己 outbox 的後面（session 內 FIFO），位置不變。
   要插隊：用該列的 `top` 按鈕或拖曳（手動順序不會被自動重排覆蓋，除非你又在新 session 按 Send）。
3. 正在跑的 session 收到 `agent_settled` 後：
   - 它自己的 outbox 還有東西 → 繼續送下一筆（「一直工作到 idle」）
   - outbox 空了 → 移到 **Idle** 群，排程器接著跑 Working 群第一位
4. 同一個 session 內部已经在跑時按 Send → 走 pi 自己的 in-session 佇列
   （`steer` / `follow-up`，下拉選單切換），不會進 outbox。
5. 分頁列與佇列列都會顯示狀態：
   - 綠點＝running（正在跑）
     - 琥珀色點＋`#n`＝queued（排隊中，第 n 位）
   - 灰點＝idle
   - `+1` / `outbox 1` 徽章＝該 session 待送訊息數

### 操作

| 動作 | 方法 |
|---|---|
| 改變執行順序 | **拖曳**佇列列（拖到另一列的上半部／下半部會插入對應位置），順序會同步到分頁列 |
| 插到最前面 | 滑鼠移到該列 → `top` 按鈕 |
| 新訊息插到最後 | 直接在 idle 分頁按 Send（自動行為，toast 會顯示 `back of the line`） |
| 看待送訊息 | 點 `outbox n` 徽章 → 可 `next`（調整為下一筆）或 `remove` |
| 清空待送 | 該列的 `drop` 按鈕 |
| 開／關串行 | `serial` 核取方塊（關掉＝各分頁可並行，回復原本行為） |

> 註：outbox 存在記憶體，重啟 GUI 不會自動重送（避免意外觸發請求）。

## 安裝 / 啟動

```bash
cd pi-on-strata
npm install          # 會裝 Electron（已快取過就很快）
npm start
```

需要本機已經裝好 `pi`（`~/.pi/agent/bin/pi`）。pi 的 CLI 路徑是自動從
`~/.pi/agent/install/current-version` 解析的；必要時可用環境變數覆蓋：

```bash
PI_ON_STRATA_PI_CLI=<path to pi cli.js> PI_ON_STRATA_NODE=<node 執行檔> npm start
```

## 自動 compact（和 CLI 完全相同）

每個分頁就是一個真正的 `pi --mode rpc` 程序，讀的是同一份 `~/.pi/agent/settings.json`，
所以**自動壓縮本來就開著**，不需要 GUI 額外實作：

| pi 設定（`compaction`） | 預設值 |
|---|---|
| `enabled` | `true` |
| `reserveTokens` | `16,384`（預留給下一次請求的空間） |
| `keepRecentTokens` | `20,000`（壓縮後仍保留的最近內容） |
| `modelOverrides["provider/model"]` | 可 per-model 覆寫上面三個值 |

觸發時機：pi 在 agent 迴圈裡（assistant 訊息結束後、下一段開始前）檢查 context 是否
快滿／overflow，會話就自己壓縮。**自動 compact 不會砍掉正在生成的回答**；
只有**手動**按 Compact 才會先 `abort()`（原因見上方〈Compact 與進行中的請求〉）。

GUI 裡看得到也改得動：

- 發生時 transcript 會出現 `compacting (auto)…`，完成後 `compacted 183k → ~24k tokens`
- 編輯區旁的 **`auto-compact`** 核取方塊：用 RPC `set_auto_compaction` 切換**目前這個 session**
  （每個分頁獨立），狀態從 `get_state.autoCompactionEnabled` 讀回
  （重啟分頁後會回到全域設定的值）
- 若你把 auto-compact 關掉、而 ctx 已 ≥85%，狀態列會出現琥珀警告
  `auto-compact off · compact before it overflows`，避免直接撞到 overflow
- 要**永久**關掉：改 `~/.pi/agent/settings.json` 的 `"compaction": { "enabled": false }`

## Compact 與進行中的請求（不是 bug，但容易誤會）

pi 1.2.0 的 `AgentSession.compact()` 第一行就是 `await this.abort()`，原始碼註解寫得很明確：

> *Aborts the current agent operation first. Manual compaction never retries or continues the interrupted agent turn.*

所以**在 session 還在跑的時候按 Compact**，進行中的那個請求會被中止，Strata 的
`Recent requests` 就會出現一筆 `Closed`（client disconnect）。更糟的是：如果 session 太小
（`Nothing to compact (session too small)`），回答照樣被砍、但什麼都沒壓縮。
這是 pi 的設計行為，不是 Strata 或 Pi on Strata 的問題。

Pi on Strata 的防護：session 正在跑（streaming / outbox / 串行佇列執行中）時按 Compact，會先問：

1. **等它跑完再壓縮（建議，預設）** — 排入 `pendingCompact`，收到 `agent_settled` 後自動執行
   （而且會先壓縮，再跑這個 session 排隊中的 outbox 訊息）
2. **立刻中止，現在壓縮** — 維持 pi 原生行為（會看到 disconnect）

實測對照（同一個 smoke session、同一個 prompt）：

| 行為 | Strata 結果 |
|---|---|
| 修正前：生成中直接送 `compact` | `finish=disconnect`、out=494、dur=8.9s（回答被砍） |
| 修正後：排隊等 idle 再 compact | `finish=stop`、out=1608、dur=22.9s（完整跑完，settle 後才 compact） |

> 自動壓縮（context 快滿時 pi 自己觸發的 `compaction_start reason=auto`）走的也是同一條路，
> 但那是 pi 在 agent 空閒時才檢查，不會砍正在生成的回答。

## Compact 不會再假 timeout（已修正）

`rpc-mode` 的處理是 `const result = await session.compact(...)` — 也就是**整個壓縮跑完才回應 RPC**。
大 session 的壓縮真的很慢，實測（86MB / 141k tokens 的 session）：

| 階段 | 實際花時間 |
|---|---|
| 摘要 model call（prompt 82,310 → out 295） | **71.4 s** |
| 重寫 86MB 的 session JSONL + 掃描 | **約 3–4 分鐘** |
| 整個 `compact()` | **約 5 分鐘** |

舊版 GUI 把 compact RPC 的 timeout 設成 **180 秒**，所以 pi 其實還在跑、最後也成功了
（Monitor 的 context 從 93.7% 掉到 40%），transcript 卻先出現紅字
`compaction failed: timeout after 180000ms`，而且 footer 的 `ctx` 還停在舊值。

現在的行為：

- timeout 拉長到 **30 分鐘**（`COMPACT_TIMEOUT_MS`），因為 pi 本來就要幾分鐘
- **以事件為準**：`compaction_start` / `compaction_end` 才是權威訊號。完成/失敗的訊息由
  `compaction_end` 顯示（`compacted 141k → ~24k tokens`），RPC 回應只做 log，
  不會再重複推一筆錯誤（失敗時會等 500ms，確認事件已報過就闭嘴）
- 真的 timeout 時，會去查 `get_state.isCompacting`：
  - 還在跑 → 琥珀色提示 `compaction still running after Ns (big session) — 這不是失敗…`，
    並保留等待狀態，等 `compaction_end` 落地
  - 不在跑了 → 才報真正的失敗（附 elapsed 秒數）
- 壓縮結束後一律 `refreshStats()`，footer 的 `ctx` 不會再停在壓縮前的數字

連帶修好的三個相關問題：

1. **串行佇列會把壓縮當成「忙碌」**：pi 在壓縮中收到 prompt 會直接丟
   `Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.`
   現在 `pump()` 會跳過正在壓縮的 session，`deliverPrompt()` 遇到那個錯誤會把訊息留在
   outbox（不報錯、不丟失），等 `compaction_end` 再跑
2. **壓縮中按 Compact** 不會再疊第二個壓縮：直接 toast `compaction already running (Ns)`，
   而且 `Compact` 按鈕在壓縮期間是 disabled
3. **pi 程序掛掉**會清掉 `compacting` 旗標，不會把佇列永久卡死

> 想中止一個跑太久的壓縮：按 **Esc** 就可以。`session.abort()` 裡面會呼叫
> `abortCompaction()`，pi 接著發出 `compaction_end`（`aborted: true`），
> GUI 會顯示 `compaction cancelled`。

## Strata Monitor（伺服器監控）

頂欄 `Monitor` 按鈕或 `Ctrl+M` 開啟／關閉。資料來源是 Strata 的 `GET /metrics`（JSON），
跟 Strata 自己的 Monitor 頁同一個端點；**由 main process 代理抓取**，所以不會被 renderer 的 CSP 擋掉。

顯示內容（每 1 秒自動輪詢，面板收起來就停止；面板本身沒有 Refresh／Hide 按鈕，
開關只用頂欄 `Monitor` 或 `Ctrl+M`，點標題的 URL 會在瀏覽器開 Strata 網頁版）：

- **Model state**：Idle / Reading / Generating / Queued / Error 徽章 + 進度條
  （reading 顯示 prompt 讀取百分比，generating 顯示已生成 token 與即時 tok/s）
- **8 張卡片**（帶 sparkline 歷史曲線）：Speed（decode + prefill 雙曲線）、GPU load、VRAM、
  GPU temp、Power、PCIe（Gen/寬度/到 GPU 的 MB/s）、CPU、Disk read
- **Context fill** 環形圖：目前（或最後一次）請求的 prompt+output 佔 context window 的比例
  （≥75% 轉琥珀色、≥90% 轉紅色；環形用 inline style 驅動，不是 presentation attribute）
- **Experts in VRAM / System RAM / GPU temperature** 條 + engine 資訊（model、ctx、kv、版本）
- **Recent requests** 表格：時間、狀態、prompt、reused、output、prefill t/s、decode t/s、
  VRAM hit rate（`+x%P` ＝ PCIe 份額，滑鼠移上去有說明）、duration；`Show all (N)` 切換全部
  （對應 `metrics?requests=all`）+ 底部 totals 統計行

### 位址與金鑰

- 預設從目前分頁的 `model.baseUrl` 推導（例如 `http://127.0.0.1:8081/v1` → `http://127.0.0.1:8081/metrics`）
- 要固定位址：設定 `strataUrl`（例：`{"strataUrl": "http://127.0.0.1:8081/v1"}` 在
  `%APPDATA%\Pi on Strata\pi_on_strata_settings.json`）
- 伺服器需要 API key 時：設環境變數 `PI_ON_STRATA_KEY` 或 `STRATA_API_KEY`
- 點標題列的 URL 會在預設瀏覽器開啟 Strata 網頁版
- 連不上時標題會變紅並顯示錯誤（連續 3 次失敗會標 `server not reachable`）

> `/metrics` 的 `requests`（延遲、token、hit rate 等統計）一直都有，不需要額外開關。
> 只有「請求的 prompt / 答案原文」是另一個頁面 `/api-monitor` 的功能，需要 Strata 執行時加
> `--api-monitor`（或 config `"api_monitor": true`）才會保留；本應用的 Monitor 不讀那個頁面。

## 連結怎麼處理

- `renderer/markdown.js` 的 `linkify()`：escape 後再把 bare URL 包成 `<a>`；
  結尾的 `, . ; : ! ?` 不會吃進 URL，中文全形標點（`，。、；：！？（）`）直接當 URL 邊界，
  但 `https://en.wikipedia.org/wiki/Foo_(bar)` 這種半形括號會完整保留
- assistant 文字走完整 markdown（`[text](url)` 與 bare URL 都支援）；user 訊息、thinking、
  tool 卡片、note 走 `linkify()`（只加連結、不跑其他 markdown，換行照舊）
- 串流中的 thinking / tool output 用 `setPreText()` / `appendPreText()`：只有文字裡出現
  `http` 時才重套 innerHTML，長輸出也不會每 delta 重渲染
- 點擊由 `document` 層級接住 → `api.openExternal(href)` → `shell.openExternal`
- 保險：main process 有 `setWindowOpenHandler`（deny）與 `will-navigate`（擋掉非當前頁的導覽），
  所以就算有 `target="_blank"` 也不會多開 Electron 視窗

## 串流效能（收合 thinking 會影響 TPS 嗎？）

**不會。** GUI 的渲染速度無法回頭拖慢 Strata 的 decode：main process 自己會把 pi 的 stdout
（JSONL）抽乾，`webContents.send` 到 renderer 是非同步的，renderer 再慢也不會把管線塞回去，
所以不存在從 GUI 到伺服器的反壓路徑。

實測（同一台機器、同一個 prompt、同一份程式碼只改一個開關）：

| 情境 | output tokens | duration | decode tok/s |
|---|---|---|---|
| 每個 thinking delta 故意把 renderer 主執行緒卡死 40ms | 1,126 | 24.9 s | **51.2** |
| 完全不卡（正常） | 1,126 | 25.3 s | **50.3** |

對照組：同一份程式碼、同樣 prompt 連跑多次，decode 本來就會落在 **33–65 tok/s** 之間
（VRAM hit rate、prompt 長度、expert offload 都會影響）。所以「收合時 TPS 看起來比較高」
多數是（1）請求間的自然變異，與（2）展開時 GUI 自己卡頓、文字一段一段跳出來的**感受差**。

不過收合確實比較省 renderer，而且現在真的實作了這個優化：

- `appendPreText()`：每個 delta 只 `appendChild(textNode)`（O(1)），不再整個字串重新赋值；
  `<details>` **收合時完全跳過 DOM 寫入**，展開時才從 `_raw` 重繪一次
- 連結化（linkify）只在結尾做一次（`thinking_end` / tool 結束），串流中絕不重解析 innerHTML
- `autoscroll()`：讀 `scrollHeight` 會強制同步 layout，改成 **rAF 節流**（每 frame 最多一次）
- tool 的 partial output 只 append 新增的尾端，不再每次重繪整張卡片（最多 4,000 字元）
- Monitor 的 `Show all` 最多只渲染最近 **150** 列（原本 500 列 × 每秒重建）

> 還有一個沒動的大項：開啟超大 session（例如 86MB / 600+ 訊息）時 `renderAll()` 會把
> 整個 transcript 一次建進 DOM。需要的话可以做 lazy render（先只建最近 N 則，往上捲再補）。

## 快捷鍵

| 按鍵 | 動作 |
|---|---|
| `Enter` | 送出（`Shift+Enter` 換行） |
| `Ctrl+T` | 新 session（新分頁） |
| `Ctrl+Shift+N` | 目前分頁內新 session |
| `Ctrl+O` | 聚焦搜尋框（找 session） |
| `Ctrl+W` | 關閉分頁（會結束該 pi 程序） |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 切換分頁 |
| `Ctrl+B` | 顯示／隱藏左側欄 |
| `Ctrl+M` | 開啟／關閉 Strata Monitor |
| `F2` | 命名目前 session |
| `Esc` | 中止執行中（或關閉對話框） |

## 架構

```
main.js            Electron 主程序：視窗、選單、IPC、pi 程序管理
preload.js         contextBridge（window.piGui）+ webUtils.getPathForFile
lib/pi-launch.js   解析 pi CLI 與 node 執行檔
lib/pi-process.js  pi --mode rpc 的 JSONL 框架（只用 LF 切行）+ 命令/回應配對
lib/sessions.js    掃描/解析 session JSONL（標題、名稱、first message、token…）
renderer/          index.html / styles.css / markdown.js / app.js
test/smoke-rpc.js  無 UI 的 RPC 冒煙測試
scripts/screenshot.ps1  截圖用（開發時驗證 UI）
```

協定細節見 pi 文件：`docs/rpc.md`、`docs/rpc-commands.md`、`docs/json.md`、`docs/session-format.md`。

### 開發用的 smoke 模式

```bash
PI_ON_STRATA_SMOKE=1 PI_ON_STRATA_SMOKE_MS=30000 PI_ON_STRATA_SMOKE_PROMPT="Reply OK" npm start
```

會用 ephemeral session（不寫檔）、把 renderer console 印到 stderr，並在 `PI_ON_STRATA_SMOKE_MS` 後自動結束。
smoke 模式會用獨立的 profile（`%TEMP%/pi_on_strata_smoke_profile`）並跳過單實例鎖，
所以不會影向你正常開著的 GUI。

其他 smoke 開關：

| 變數 | 作用 |
|---|---|
| `PI_ON_STRATA_SMOKE_PROMPT="…"` | 啟動後自動送一次 prompt（測串流／markdown／tool 卡片） |
| `PI_ON_STRATA_SMOKE_STEER=1` | 再補一則訊息，測 busy 時的 steer 路徑 |
| `PI_ON_STRATA_SMOKE_SESSION=<path>` | 啟動後用 `switch_session` 載入指定 session（測 session switch／歷史渲染） |
| `PI_ON_STRATA_SMOKE_QUEUE=1` | 自動開 4 個分頁、送 3 則訊息，測串行佇列（Working/Idle、outbox、順序） |
| `PI_ON_STRATA_SMOKE_MONITOR=1` | 啟動後直接開啟 Monitor 頁（配合 `PI_ON_STRATA_SMOKE_PROMPT` 可看到 generating 狀態） |
| `PI_ON_STRATA_SMOKE_COMPACT=1` | 長生成中排入 compact，測「等 idle 再壓縮」不會砍掉請求（Strata 應為 `stop` 而非 `disconnect`） |
| `PI_ON_STRATA_SMOKE_ORDER=1` | 開 A/B/C 三個分頁，先讓 B 跑、再在 C 與 A 送訊息；應看到順序變成 `B C A`（A 從第一位插到 Working 群最後），執行順序 B → C → A |
| `PI_ON_STRATA_SMOKE_AUTO_COMPACT=1` | 測 `get_state.autoCompactionEnabled` → `set_auto_compaction off/on` → 再讀回，應為 `initial=true … now=false … now=true` |

```bash
# 測串行佇列：應該看到 first 跑完才換 second，groups 從 WWWI 變成 IWWI 再到 IIII
PI_ON_STRATA_SMOKE=1 PI_ON_STRATA_SMOKE_MS=30000 PI_ON_STRATA_SMOKE_QUEUE=1 npm start
```

## 已知限制

- RPC 模式不支援 pi TUI 的 `custom()` 元件、主題切換等（pi 文件說明了 RPC 模式的降級行為）。
- `get_messages` 只顯示目前 active branch；`/tree` 的分支切換尚未做成 UI（可用 `get_tree` 之後再加）。
- 拖曳資料夾只會插入路徑，不會展開成多個附件。
- 每個分頁一個 pi 程序，開很多分頁會比較吃記憶體。
- 排程器只能保證**由 GUI 送出**的 prompt 串行；extension 自己發起的執行無法被擋住
  （此時會直接接管 `runningTabId` 並在佇列顯示）。
- outbox 不跨重啟保存。
