# UI 四语言 + 交互验证报告（ui-langs）

日期：2026-10-25 · 环境：Windows 11 + Git Bash · 客户端：原生 `SpellKard.exe` + CDP（`ws://127.0.0.1:5971/laya`）

## 方法

- 原生客户端 E2E 全程走 **CDP + 原生 exe**（未使用 layabox/浏览器产物）。
- 为拿到 app 句柄（大厅只能经 device 匿名认证进入，登录页账号登录在本部署被服务端拒绝
  `accounts_unavailable`，无 UI 路径），在 **tmp 副本**（`tmp/fix-ui-langs/app-dbg`、
  `app-v5`）的 bundle 与 dcc 缓存里各打了一行补丁
  （`window.__PK_APP__ = startClient(config);`），仓库源码未动。
- 遍历 UI 树一律 **按 `visible` 逐层过滤**（隐藏 section 的控件不计入）；点 tab 按
  **文字匹配**（索引 0 是「语言」页）。
- 复验构建：`node tools/publish_windows.mjs --out tmp/fix-ui-langs/app-v5`（bundle
  1,075,552B，含本次修复），打同一行探针补丁后复跑全部用例。

## 四语言验证结果（app-v5，修复后）

切语言一律通过设置页「语言」分段按钮的**真实 CLICK** 完成，四语言 × 四轮：

| 语言 | store | 分段点击 | 大厅自身文案 | 设置 shell | 7 tab rebuild | 占位符残留 |
|---|---|---|---|---|---|---|
| ja | ja | ✅ | 全日文（メインメニュー/ログアウト/開始/デイリーログイン…） | 設定/言語/表示… | 18/46/80/40/29/38/36 labels | 无 |
| zh-Hant | zh-Hant | ✅ | 全繁中（主選單/登出/簽到/背包…） | 設置/語言/顯示… | 同上 | 无 |
| en | en | ✅ | 全英文（Main menu/Sign out/Play/Check-in…） | Settings/Language/Display… | 同上 | 无 |
| zh-Hans | zh-Hans | ✅ | 全简中（主菜单/退出登录/开始/签到…） | 设置/语言/显示… | 同上 | 无 |

- **设置面板**：切语言后 shell（标题/关闭/7 个 tab/副标题/恢复默认）即时重绘；活动 section
  同步 rebuild；逐 tab 点开，7 页 labels 数与内容高度在四种语言下完全一致，无残缺。
- **play 页**（补键后复验）：房间码卡、加入框、六个动作按钮、匹配队列状态行全部有对应语言
  文本，**无原始键名泄漏**（修复前会显示 `lobby.joinRoomCode` 字面量）。
- **占位符**：所有语言、所有 tab、大厅 + play 页可见文本（含 Input.prompt）零 `{xxx}` 残留。
- **登录页**：设置面板自身四语言正常；登录页自身文案（标题/字段/按钮）**不随语言切换重绘**
  （见「未解决」）。

## UI 交互验证结果（真实事件驱动）

| 项 | 方法 | 结果 |
|---|---|---|
| 7 个 tab 打开 | 按当前语言文字匹配 tab 按钮，派发 `Laya.Event.CLICK` | 7/7 打开，`activeTab` 与点击一致 |
| 活动页/隐藏页隔离 | 按 visible 过滤统计可命中控件 | 隐藏 section 可见控件数 = 0（活动页正常） |
| 开关 46×24 | `track.event(CLICK)` → 读回 store | `showOpponentHud` true→false，store 同步 |
| 恢复默认 150×30 | footer 按钮 `CLICK` | `showFps` 改动后被重置 |
| 滑杆 108×26 | 校准 `Laya.InputManager.mouseX` 后派发 `MOUSE_DOWN/MOUSE_MOVE/MOUSE_UP` 到 track | 0.8→0.2（按下 25%）→0.8（拖到 75%），store 与读数同步，量化步长正确 |
| 滚轮滚动 | viewport 派发带 `delta=±3` 的 `MOUSE_WHEEL` | scrollTop 0→144→0 |
| 拖动滚动 | viewport `MOUSE_DOWN`+`MOUSE_MOVE`（注入鼠标坐标） | scrollTop 变化，content.y 跟随 |
| About 页 | — | 无交互控件（纯信息行），可见控件 0 属预期 |

注：`Sprite.mouseX` 取的是 `InputManager.mouseX`（可写属性），合成鼠标事件需先写它，
否则 `track.mouseX` 为缓存旧值（未收到真实指针事件时为 0）。

## 发现并修复（均在文件域内）

1. **大厅文案不随语言切换重绘**（`lobby_scene.ts`，真机复现：切日语后菜单按钮仍是
   「开始/签到/商店」）。修复：构造时记录 `paintedLanguage` 并订阅 settings store，
   新增 `applyLanguage()`——语言真变了才重涂 12 个按钮、2 个 caption、输入框 prompt、
   page/account/profile/status/queue 文本，并按语言重载标题 logo（`loadTitleLogo`
   改为先恢复文本标题再加载，缺图时不空标题）；`destroy()` 退订。
2. **`lobby.joinRoomCode` / `lobby.roomCodeHint` 两键四张表全缺**（`i18n.ts` +
   `lobby_scene.ts`），play 页直接显示原始键名。修复：接口 + 四语言表补齐
   （加入的房间码 / 加入的房間碼 / 参加するルームコード / Room code to join；
   输入房主分享的房间码 / … / ホストが共有したルームコードを入力 / Type the code the host shared）。
3. **新增离线测试** `tests/lobby_language.test.ts`（登记到 `tests/run.ts`，3 例）：
   锁大厅/ ui 键集存在且非空、en 必须异于 zh-Hans、ja 除 `ui.shop`（商店，日汉同形）
   外必须异于 zh-Hans、除两个由调用方参数化的键外不得携带占位符。
   测试用 `stringTable()` 直读、不碰全局语言状态（suite 后续用例隐式依赖
   gift_system 留下的 `en`，第一版因恢复全局语言导致 19 例 auth_messages 失败，已规避）。

## 未解决（超出文件域，仅记录）

1. **登录页自身文案不随语言切换重绘**（`login_scene.ts`，不在文件域）：在登录页设置里
   切语言，表单标题/字段/按钮停留在原语言，直到下一次 flow snapshot。大厅已修，登录页
   同样缺一个 store 订阅 + 重涂（`applyFieldPrompts` 已存在，缺调用时机）。
2. **大厅状态行 `Signed in as X` 停留在登录时语言**（`core/game/lobby_flow.ts`，
   不在文件域）：`statusText` 在 `signIn` 时一次性 compose 进 snapshot，大厅
   `applySnapshot` 只能原样显示。
3. 本部署无账号服务（`auth.login/register` 均 `accounts_unavailable`），登录 UI 的账号
   路径无法真机走通；大厅验证走 device 匿名认证（协议层已验证 62 调用）。

## 质量门

- `npm run check`：typecheck + **876 passed, 0 failed**（基线 873 + 新增 3）+
  ide:check 30 项 OK。
- `npm run build`：通过（browser tsconfig 更严，第一版因 `string`→`LanguageCode`
  窄化失败，已修）。
- 未 commit、未 push。

## 产物

- 报告：`D:/gotouhou/tmp/fix-ui-langs/report.md`
- CDP 驱动：`tmp/fix-ui-langs/cdp.mjs`；探针：`probe2_langs.mjs`（四语言+交互）、
  `probe3_playpage.mjs`（play 页+登录页）；结果：`probe2_v5.json`、`probe2_out.json`。
- 插桩副本：`tmp/fix-ui-langs/app-dbg`（修复前）、`tmp/fix-ui-langs/app-v5`（修复后，
  `publish_windows.mjs` 产出 + 一行探针补丁）。原生产物 `tmp/fix-ui-ctl/app-v4` 未动。
