# 战斗输入编解码 ↔ 本地模拟一致性验证报告

- 执行人：sim-parity（团队 _auto_c9b0b143）
- 日期：2026-10-25
- 客户端根目录：`D:/gotouhou/SpellKard/laya`（即任务书中的 `laya`，实际位于 `SpellKard/` 子目录下）
- 服务端参考（只读）：`D:/gotouhou/PhK-BattleServer`
- 全程离线：未起任何服务器、未编译 C++、未跑 `go test`。

## 一、验证了什么

### 1. 往返一致（codec：`encodeBattleInput` → `decodeBattleInput`）

以 C++ 编码器 `PhK-BattleServer/src/match_lifecycle.cpp:480-505`（`EncodeBattleInputPayload`）
与解码器 `:515-551`（`ReadBattleInputBody`）为权威基准，逐条核对：

| 验证项 | 结果 |
| --- | --- |
| 8 种 slow/shoot/bomb 组合 × 16 种 direction mask（含 0） | 全部等价 |
| card block 36 种组合（cardDraw × cardSelect × cardUse，含 undefined/false/-1/0/3） | 全部等价 |
| `cardSlot` 全 i8 域（-128..127）+ `-1` 哨兵 | 逐值等价 |
| `cardSelect` 全 i8 域（强制 block 在场） | 逐值等价 |
| 越界截断：128→-128、-129→127、256→0、255→-1、-256→0 | 与 C++ `static_cast<int8_t>`（`:494`/`:536`）一致 |
| `tick`/`seq` ≤ 2^53（0、1、45、10^5、2^31、2^53-1） | 精确（>2^53 的退化行为已由 battle_e2e 套件钉住） |
| 字符串：空、ASCII、CJK、emoji 代理对、数学字母代理对、孤立高/低代理 | 逐字符等价 |
| `version`：仅 `protocolVersion` 上线；缺省编码为 1 | 与 wire 形状（`:483`）一致 |
| legacy 帧（无 card block）解码为 C++ struct 默认（`protocol.hpp:52/57-59`） | 一致 |
| 生产 ticket 帧（`encodeBattleInputWithTicket`）的 input body | 往返不变，ticket 存在位永不误判为 card block |
| 300 例 Lcg fuzz（随机字符串/flag/方向/i8 域） | 全部等价 |
| 字节规范性：`encode(decode(encode(x))) === encode(x)` | 所有用例成立 |

### 2. 模拟消费一致（解码出的输入喂入 `BossRaceSimulation`）

所有用例都走产品真实路径：构造 `BattleInput` → `encodeBattleInput` → `decodeBattleInput` →
`submitInput` → `tick()`。基准为 C++ `boss_race.cpp`：

| 验证项 | C++ 基准 | 结果 |
| --- | --- | --- |
| 移动 3000 milli/tick、服务器位布局（up=0x1,right=0x2,down=0x4,left=0x8）、arena 钳制 | `boss_race.cpp:356-369` | 一致 |
| `slow` 在 race 内不影响移动（flat 3000；focus 半速属共享模式 `simulation.cpp:2181`） | `:356-369` | 一致 |
| 无 loadout：shoot=10/tick；bomb 单独=0（服务端 bomb spec 为 nullptr）；shoot+bomb=10 | `:395-414` | 一致 |
| 有 loadout（ReimuA1=50 / Reimu=45）：shot 替换为 50（非叠加）；bomb +45；bomb 单独 45 | `:395-414` + 黄金测试 `tests/boss_race_tests.cpp:252-293`（50 → 95） | 逐位一致 |
| 未知 loadout 名 ≡ 无 loadout（C++ 查表未命中 → nullptr；客户端 -1 哨兵等价） | `:181-196` | 一致 |
| 每 tick 伤害钳制 `min(tick_damage, boss_current_hp)` | `:410-413` | 一致 |
| `card_slot` 在 `cardMechanics` 默认 `false` 时完全惰性（含 canonical hash 逐 tick 相等） | race 全文无 `card_slot` 读取 | 一致（默认值是正确的服务端对齐决定，未改） |
| `slot == -1` 哨兵：accepted + `playsNoCard`，无 `card_rejected`、无账本变化 | `card_hand.cpp:72-77` | 一致 |
| held fallback 不重放 cast（只消费真实输入帧） | `simulation.cpp:1171-1177` | 一致 |
| 解码帧仍受 `SubmitInput` 窗口/seq/mask 校验（stale tick、0x10 mask、+8 窗外、非单调 seq 均拒） | `boss_race.cpp:301-328` | 一致 |
| 透明性：双模拟（原始输入 vs 解码输入）50 tick canonical hash 逐 tick 相等 | — | 一致 |

### 3. C++ 对齐核对

逐条核对了客户端 `src/core/sim/boss_race.ts`、`card_hand.ts` 中**已实现**的每条规则
（移动、伤害、loadout 查表、哨兵、校验顺序、冷却/能量 epsilon、抽卡光标）。
结论：已实现的规则与 C++ 无一处数值或顺序偏差。

## 二、发现的问题

### 已修复

1. **（测试自身）loadout 累计伤害断言算错**：`damageDealt` 是累计值，我最初按每 tick 值断言
   （期望 95 实际 145）。已改为累计口径（50 → 145 → 190），其每 tick 增量
   （50、+45、+45）与 C++ 黄金测试 `boss_race_tests.cpp:280-292` 逐位一致。
   位置：`tests/battle_input_sim_parity.test.ts`（loadout 用例）。

### 协议设计而非 bug（无需修，已用测试钉住）

2. **显式默认值 ≡ 缺省**：`cardDraw:false`/`cardSelect:-1`/`cardUse:false` 编码时省略 card block，
   解码回 `undefined`。与 C++ 写出条件（`match_lifecycle.cpp:498`）逐字一致；语义等价
   （消费者已按默认值处理），再编码字节相同。这是 wire 规范，不是丢失。
3. **`version` 仅 `protocolVersion` 上线**：其余 VersionStamp 字段属于 ticket 块，不在 input body 上
   （`match_lifecycle.cpp:483`）。

### 记录未修（服务端有、客户端无的功能级缺口）

4. **`tna-1.40-danmaku` 机制分支未移植**（`boss_race.hpp:44` + `boss_race.cpp:161-163` 开启）：
   - C++ `:373-386`：bomb 消耗残弹（3→2）、`invulnerable_until_tick = tick + 120`、发 `bomb_used` 事件、
     直接结算 bomb 伤害（`ApplyBossDamage`）；
   - C++ `:395-418`：机制开启时 shoot 改为发射自机弹实体（`SpawnMyBulletsForPlayer`），不再叠加合成伤害；
   - C++ 黄金测试：`tests/boss_race_tests.cpp:617-632`。
   - 客户端 `boss_race.ts` 无 bombs/alive/my-bullets/判定/符卡阶段模型；且 `bossRaceConfigForRuleset`
     会把任意非合成 ruleset 重贴为 `tna-1.40-phase`，机制区分对 sim 不可见。
   - **不影响生产**：大厅签发的是 `ruleset-local-s0`（`docs/battle-aead-server-spec.md` 与 ticket 示例），
     C++ 机制只对精确字符串 `tna-1.40-danmaku` 开启。已用测试钉住当前行为防止无声漂移。
   - **未修原因**：这是数千行特性移植（自机弹 + 受击判定 + 符卡阶段 + 铁拳/帷幕），超出"修不一致"范围；
     且该 ruleset 无人签发。建议服务端正式启用该 ruleset 时一并移植（双端同改）。
5. **客户端快照不产出 `vxMilli`/`vyMilli`**（观察项，无输入消费影响）：C++ 在 `ApplyPlayerTick`
   写这两个字段（`boss_race.cpp:364-365`）并进快照（`boss_race.hpp:223-224`）；客户端 PlayerState
   不跟踪、`snapshot()` 不产出（解码侧能读服务端下发的可选值）。canonical hash 不含 vx/vy，
   预测正确性不受影响；属渲染插值数据完备度，且改快照形状可能波及 golden 测试与 `game/` 层
   （文件域外）。只记录。

## 三、修了什么 / 没修什么

- **修了**：仅测试层 —— 新建 `tests/battle_input_sim_parity.test.ts`（3 个 suite、25 个用例），
  并在 `tests/run.ts` 注册。`src/core/sim/**` 与 `src/core/net/**` **零改动**
  （详查后已实现规则与 C++ 完全一致，无可修 bug；我修的唯一错误是自己测试里的累计值口径）。
- **没修**：第 4、5 条（上文「记录未修」），原因已注明。

## 四、验证命令

- `npm run check`（typecheck + 873 tests + ide:check 30 项）—— 通过
- `npm run build` —— 通过
- 新增用例全部离线运行（`tests/harness.ts` 的 suite/test/expect）。

## 五、产物

- 测试：`SpellKard/laya/tests/battle_input_sim_parity.test.ts`
- 注册：`SpellKard/laya/tests/run.ts`（+1 行 import）
- 本报告：`D:/gotouhou/tmp/fix-sim-parity/report.md`
