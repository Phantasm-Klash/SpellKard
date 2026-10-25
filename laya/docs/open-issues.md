# 未解决问题清单（2026-10-25 汇总）

> 本文是跨会话的**单一未决事项登记处**。每条都标注：现象、根因/证据、影响面、
> 归属（谁能修）、建议动作。**已修的不在这里**——已完成的工作看 git log。
>
> 更新规则：新发现问题往对应章节追加；问题解决后**整条删除**（不要留"已解决"的坟）。

---

## A. 服务端 / 对战端（客户端不动，需服务端跟进）

### A1. 服务端 AEAD 仍是脚手架 —— **最高优先级，阻断真实加密**

- **现象**：`PhK-BattleServer/src/handshake.cpp` 的 `Accept()` 里
  `server_x25519_pub = FillDevBytes(match_id + ":server-pub")`。
  `FillDevBytes` 是 **FNV-1a-64 + xorshift 的确定性填充，不是 X25519 运算**；
  `hkdf-dev:...` 的 key ref 是标签字符串而非派生密钥。全仓密码学实现 = 0。
- **证据**：客户端 battle-aead 智能体读源码确认；服务端自己的文档也把
  「Real X25519/ECDHE and HKDF」「Real ChaCha20-Poly1305」列为待办
  （`docs/architecture.md:25`、`README.md:31-32`、`dev/progress.md:278`）。
- **影响**：客户端**双方都没有真正加密**。客户端侧已完全就绪（纯 TS 实现 +
  RFC 官方向量 + 真机内完整握手与 AEAD 互通全过），但**不能单方面切换**——
  服务端不补齐，双方会话密钥必然不同，对战直接坏。
- **归属**：C++ 对战端（`PhK-BattleServer`）。
- **规格已备好**：`laya/docs/battle-aead-server-spec.md` —— nonce 12 字节(24 hex)、
  tag 16 字节、AAD 约定（direction‖key_id‖match_id‖player_id‖u64le×4）、
  五步切换顺序。
- **建议**：按规格实现；实现时先让服务端**同时**接受明文 dev 会话与 AEAD 会话
  （按 `key_id` 区分），双方各自开开关跑一轮互通，最后关明文。

#### A1-bis. ★★ 2026-10-25 追加：现网对战服**根本没有握手与 AEAD 这条路**，比 A1 更靠前

- **现象**（两条独立查证一致）：真正提供对战的是 `MatchServer`
  （`src/match_lifecycle.cpp`，也是 `apps/phk_battle_server/main.cpp` 唯一启动的
  服务）。它的收包入口 `HandleSessionPayload`（`match_lifecycle.cpp:1096`）
  **只调 `DecodeBattleInputPayload`**，即首字节必须是 `0x03` 的手搓二进制：
  - 无 `HANDSHAKE_HELLO` 分支 → 发握手包会被静默丢弃；
  - 无 `BattleEncryptedPacket`（protobuf）解析 → 首字节 `0x0A` 的 AEAD 包同样丢弃；
  - 广播回客户端的快照/结果是 `[type byte][JSON]`，**不加密**。
- **更关键**：`src/server.cpp` / `protocol.cpp` / `handshake.cpp` 里那套完整的
  `BattleServer` + `DispatchEncrypted` + `HandshakeManager`（含
  `nonce_mismatch` / `session_key_mismatch` / `handshake_required` 校验）
  **没有接入任何可执行文件**，只在测试里被实例化。也就是说：
  A1 说的"脚手架"连脚手架都还没上线——它是一份**离线的协议一致性实现**。
- **影响（结论）**：**客户端无法单方面"切换 AEAD"**。任何切换都会让现网每一帧
  输入不可投递，对战立即坏。这与用户 2026-10-24「先不动对战端」的指令一致。
- **客户端已做到位**（2026-10-25）：`core/net/battle_aead.ts` + `BattleClient`
  的 `performHandshake()` / `sealForWire()` / `openFromWire()` 全部实现并测试
  （`tests/battle_handshake.test.ts`，5 例：默认明文同步、无 provider 拒绝、
  hello 字段、accept 后逐帧密封且 nonce/key_id 可验、篡改 tag 丢弃不降级）。
  **但 `performHandshake()` 在现网路径上无人调用**——服务端不回答就永远不该发。
- **解锁条件**：服务端先在 `MatchServer` 上落地
  ① 收 `HANDSHAKE_HELLO` 并回 `HANDSHAKE_ACCEPT`；② 解析
  `BattleEncryptedPacket`；③ 真 X25519 + HKDF（替换 `FillDevBytes`）。
  客户端侧只需在开战处加一次 `await client.performHandshake()`。

### A2. 竞速模式服务端丢弃 `card_slot`

- **现象**：`grep -c card_slot src/boss_race.cpp` = **0**。
  `match_lifecycle.cpp:1122` → `BossRaceSimulation::SubmitInput` 全文件 0 处读取。
- **影响**：客户端 `BossRaceConfig.cardMechanics` **默认 false**（正确决定）。
  开启本地预测会算出服务端没有的 Boss 血量，而 `adoptAuthoritativeSnapshot`
  只回填玩家状态不回填子弹 → **分叉无法自愈**。
- **归属**：C++ 对战端。客户端侧实现已就绪（`core/sim/card_hand.ts` 等）。
- **建议**：把 `card_hand.hpp` 那套搬进 `BossRaceSimulation::ApplyPlayerTick` +
  `MatchServer` 灌票据手牌，然后同时开客户端开关
  （`src/core/net/battle_client.ts:239` 构造模拟处加 `cardMechanics: true`）。

### A3. `tna-1.40-danmaku` 机制分支未在客户端实现

- **现象**：C++ `boss_race.cpp:371-386` 有炸弹消耗 / 无敌帧 / `bomb_used` 事件，
  但只在 `tna-1.40-danmaku` 规则集下生效。客户端 TS 模拟**没有机制规则集**
  （无残机 / 擦弹 / 判定系统）。
- **影响**：该分支下客户端的炸弹行为与服务端不一致。
- **归属**：客户端，但依赖「弹幕计划 §2.4 判定系统」的功能面。
- **建议**：等判定系统落地后一并做；硬塞会造半成品。

### A4. 客户端快照不产出 `vxMilli` / `vyMilli`

- **现象**：C++ `ApplyPlayerTick` 写这两个字段（`boss_race.cpp:364-365`）并进快照
  （`boss_race.hpp:223-224`）；客户端 `PlayerState` 不跟踪、`snapshot()` 不产出。
- **影响**：**仅渲染插值数据完备度**。canonical hash 不含 vx/vy，预测正确性不受影响。
- **归属**：客户端（改快照形状可能波及 golden 测试与 `game/` 层，故未动）。
- **建议**：低优先级。要做时先评估 `tests/battle_input_sim_parity.test.ts` 的
  golden 断言影响面。

---

## B. 大厅 / 账号服务（服务端配置，非代码缺陷）

### B1. 本部署没有账号服务

- **现象**：`auth.emailCode` / `auth.register` / `auth.login` 全部
  `accounts_unavailable: the lobby has no account service configured`。
- **影响**：**登录 UI 的账号路径无法真机走通**。所有 UI 验证只能走 device
  匿名认证。协议层已验证 62 个业务调用、0 协议错误。
- **归属**：Go 大厅（`Gensoulkyo`）部署配置。
- **建议**：若要验证账号登录 UI，需先在大厅配账号服务。

---

## C. 客户端已知限制（有意识的设计，非缺陷）

### C1. `match.events` / `match.snapshot` / `match.input` / `match.settle` 在 Nakama 路径不可用

- **现象**：`/v2/rpc/match.events` 等答 **404 "RPC function not found"**；
  它们也在 forbidden-op 名单上，将来若注册会答 `403 client_operation_disallowed`。
- **现状**：客户端已正确改走 `/v1` REST 桥（`restTransport`），代码注释有说明。
- **注意**：`nakama_rpc` 部署**必须**配 `restTransport`，否则每个事件消费者
  静默饥饿（症状是战斗表现层永不同步，无报错）。

### C2. 原生缺 OS 级 CSPRNG（已缓解）

- **现状**：LayaNative 的 `crypto.subtle` 是 apploader.js 的 **shim 类**，
  每个方法调用都 throw `"not implemented"`。已由 `spk_crypto` 扩展补上
  （Windows CNG `BCryptGenRandom` / Linux+Android `getrandom(2)`），
  真机实测档位 `native-extension`、`source: windows-cng-bcryptgenrandom`。
- **残留**：若扩展未加载（旧产物、其他平台），仍回退到 `Math.random()` 喂的
  ChaCha20 DRBG，强度弱于浏览器。`randomSource()` 会如实报告档位。
- **建议**：推动 LayaAir 实现 `crypto.getRandomValues`（届时自动切到 webcrypto 档位，
  无需改代码）。

### C3. `spk_crypto` 扩展的入口符号必须与引擎约定一致

- **教训**：入口必须是 `laya_extension_init`（`LAYA_EXTENSION_ENTRY` 宏导出）+ 填
  `LayaExtensionInitInfo`。写错符号名**完全静默**——DLL 加载成功、不报错、
  只是不注册，JS 侧只能看到 `window.spk_crypto` 是 undefined。
- **现状**：已修正并与 `spk_udp` 的导出表逐项比对一致。

### C4. 扩展 DLL 不入库

- **现状**：`.layaext.json` 声明入库，DLL 是本地构建产物（MSVC），被 .gitignore 排除。
  与 `spk_udp` 的约定一致。
- **注意**：换机器 / CI 需要先跑 `native/crypto_ext/windows/build_windows.bat` 产出 DLL。

---

## D. 测试方法论坑（已写入记忆，此处留档）

### D1. CDP 探针必须按 `visible` 逐层过滤

设置面板把 7 个 section 的 root **全部挂在 content 下**，只有活动页
`visible=true`。不过滤会数出"12 个滑杆"（真相：活动页 5 + 隐藏页 7），
误判为重复渲染；也会操作到隐藏页控件导致"拖动 FAIL"。

正确写法：
```js
function walk(n, hidden){ var h = hidden || n.visible === false;
  for(...){ var c = n.getChildAt(i);
    if(!h){ /* 这才算可见控件 */ }
    walk(c, h || c.visible === false); } }
walk(Laya.stage, false);
```
点 tab 必须**按文字匹配**（索引 0 是「语言」页）。

### D2. 合成鼠标事件要先写 `Laya.InputManager.mouseX`

`Sprite.mouseX` 取的是 `InputManager.mouseX`（可写属性）。合成鼠标事件前不写它，
`track.mouseX` 是缓存旧值（未收真实指针事件时为 0）。

### D3. 每次 `Runtime.evaluate` 是独立作用域

跨调用建立的模块注册表在下一次 evaluate 里不可见（报 "module not loaded yet"
但文件明明加载过）。**加载与驱动必须在同一次 evaluate 内完成。**

### D4. 测试里切换全局语言会污染后续用例

`suite` 后续用例隐式依赖前面留下的全局语言状态。**用 `stringTable()` 直读表**，
不要 `setLanguage`。

---

## E. 本轮已完成（仅列标题，详情看 git log）

- 官方拖动条过大（150×34 → 108×26）+ 顺带修掉预制体部件不跟随父级 size、
  knob 行程 clamp 导致右端填不满两个 bug
- `layabox` 黑屏根因（`Laya.PlayerConfig.UI` 缺失）与修复
- 房间码链路（服务端总自己生成码，客户端曾用本地预设码显示和加入 → 必然 not_found）
- `lobby_flow.ts` 剩余 53 处硬编码英文全迁 i18n；后续又清零最后 10 处场景字面量
- 商店曾恒为空（读 `items[]` 而服务端发 `products[]`）；商品无名字（服务端不发）
- 大厅 / 登录页 / 状态行不随语言切换重绘
- 战斗输入往返 + 模拟消费一致性（26 例，与 C++ 黄金测试逐位一致，零代码改动）
- 原生端 X25519/HKDF/ChaCha20-Poly1305 + `spk_crypto` OS CSPRNG 扩展
