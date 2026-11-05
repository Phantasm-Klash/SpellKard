# `boss21_tna` 实测弹幕接入链路清单（2026-11-06 只读调研）

> 目的：确认「让线上房间用上原 TNA 实测链表弹幕」到底要动哪些文件。
> 结论先行：**管道已经全通了，只差两个"值"**。但两个值都牵涉结算校验与双端预测，
> 属产品/部署决策，本次只盘点、不改代码。

## 1. 对局服启用实测链表的两个开关

`PhK-BattleServer/src/danmaku/chain_node.cpp:267`：

```cpp
bool ChainTablesActive(std::string_view ruleset_version, std::string_view boss_id) {
    if (ruleset_version != kRulesetDanmakuMechanics) return false;  // "tna-1.40-danmaku"
    if (boss_id.empty()) return false;
    return HasBossPhaseTable(boss_id);
}
```

两个条件**必须同时满足**：

1. `--ruleset tna-1.40-danmaku`（`include/phk/battle/boss_race.hpp:48`）
2. `--boss-id` 命中 `BossPhaseLibrary()`（`src/danmaku/chain_node.cpp:151/167`）：
   `boss21_tna`（state 14）、`boss21_tna_s20`（state 20）
   —— 另有 `boss21` 抽样样板表，但它**几乎不发弹**（块 B 节点未解码），不可用。

启用后 `boss_race.cpp:780-783` 走 `SpawnChainBulletsForTick` 取代 10 模式轮转。

## 2. 逐层现状

| 层 | 位置 | 现状 |
| --- | --- | --- |
| 对局服链表表 | `PhK-BattleServer/src/danmaku/chain_node.cpp` | ✅ 两张实测表已注册并编译进生产二进制 |
| 对局服 CLI | `apps/phk_battle_server/main.cpp:160` | ✅ 支持 `--boss-id` |
| **agent 参数** | `deploy-build/cmd/battle-agent/main.go:590,614` | ✅ `--ruleset`（`item.Ruleset` 或 `RulesetOverride`）+ `--boss-id`（`item.BossID`） |
| **大厅 assignment** | `Gensoulkyo/runtime/core/service.go:3018-3030` | ✅ 已带 `Ruleset: match.RulesetVersion`、`BossID: alloc.BossID` |
| 大厅 boss 白名单 | `Gensoulkyo/runtime/core/service.go:619-673` | ❌ `bossCatalog` 只有 `tian`/`hui`；`validateBossID()` 会拒绝 `boss21_tna` |
| 大厅 ruleset | `service.go:1230,3360` | ❌ `RulesetVersion` 恒为协议 manifest 的 `ruleset-local-s0`，不是 `tna-1.40-danmaku` |
| 结算校验 | `runtime/core/battle_result_callback.go:173-187` | ⚠️ 要求回调 `ruleset_version == match.RulesetVersion` |
| 客户端可选 boss | `SpellKard/laya/src/platform/laya/scenes/room_scene.ts:60` | ❌ `ROOM_BOSS_OPTIONS` 只有 `''` / `tian` / `hui` |
| 客户端 boss 目录 | `src/core/sim/danmaku/boss_catalog.ts:53` | ❌ 只有 `tian` / `hui`，且 phases 指向 10 模式库 |
| **客户端链表镜像** | `src/core/` 全目录 | ❌ **没有** `ChainNode` / cadence 表的镜像（`chain_split.ts` 是"子弹分裂"，不是调度表） |
| 协议 | `PhK-Protocol/schemas/ruleset.schema.json:44,71` | ✅ `boss_id` 是自由 string，无枚举约束，协议层不拦 |

**直连 spawn 路径**（`Gensoulkyo/runtime/battlespawn/spawn.go:298-330`）不带 `--boss-id`，
但那是本地/备用路径；生产走 agent，已通。

## 3. 三个不能忽略的约束

### 3.1 不能只改 agent 的 `RulesetOverride`

`main.go:590` 的 override 会覆盖 assignment 的 ruleset，但
`match.RulesetVersion` 仍是 `ruleset-local-s0`（`service.go:1230` 取全局常量）。
`battle_result_callback.go:185-187` 会判定
`req.RulesetVersion(tna-1.40-danmaku) != expectedRuleset(ruleset-local-s0)`
→ **结算被拒**。要让对局服换 ruleset，必须让大厅记录的 match ruleset 同步换掉。

### 3.2 `ModeRulesetVersion` 目前只是元数据

`runtime/core/service.go:3361,3887` 有 `ModeRulesetVersion: mode.ModeRulesetVersion`，
但它只写进 match/allocation 记录，**不参与** `RulesetVersion` 的取值，也不参与结算校验。
想用它做"模式级 ruleset"需要新增逻辑，不是现成开关。

### 3.3 客户端预测没有链表镜像

服务端一旦启用 `SpawnChainBulletsForTick`，客户端 `boss_race.ts` 的重推/预测
没有对应的 cadence 表镜像 → 预测会与服务端子弹集合不一致。
（`TNA_TIMELINE_IS_PRODUCTION` / `hashComparable()` 的注释里说明了这类失同步的后果。）
插帧路径（`buildBossRaceFrame` 消费服务端快照）不受影响，已由
`dev/stage_parity.mjs` 对三条实测 trace 各 450 tick 验到 0 px 误差。

## 4. 三种方案（需确认，本次未实施）

### 方案 A：新增「房间级 ruleset」+ 扩充 boss 目录（推荐，改动面可控）

让 `rooms.create` 在房主选 `boss21_tna` 时，把该局的 `RulesetVersion` 定为
`tna-1.40-danmaku`（而不是全局常量），并同步到 match / allocation / 票据，
使结算校验自洽。

需动：
- `Gensoulkyo/runtime/core/service.go`：`bossCatalog` 增 `boss21_tna` 条目（HP/移动/phases 可留空，chain 表自管）；`validateBossID` 随之放行；match 创建处的 `RulesetVersion` 改为按 boss 决定。
- `Gensoulkyo/runtime/core/battle_result_callback.go`：确认 expectedRuleset 取的是同一份值（应该天然一致，但要加测试）。
- `SpellKard/laya`：`ROOM_BOSS_OPTIONS`、`boss_catalog.ts` 增条目；**补 cadence 表镜像**（或明确该房间走"不做客户端预测、只插帧"）。
- 测试：Go 结算校验、客户端 `stage_parity`、双端 hash。

风险：中等。不动协议 manifest、不影响其他房间的 ruleset。

### 方案 B：把协议 manifest 的 `RulesetVersion` 全局改成 `tna-1.40-danmaku`

一行常量，但**所有**对局（含 tian/hui）的 ruleset、票据、结算、双端哈希全变；
且 `ChainTablesActive` 仍要求库内 boss_id，默认 boss 不会自动变密集，只是换了个字符串。
**风险高、收益不匹配**，不建议。

### 方案 C：仅离线/演示接入

保持线上不变，在 `dev/` 里用 `phk_danmaku_trace --ruleset tna-1.40-danmaku
--boss-id boss21_tna` 生成录像/trace 供美术与手感评估（本次已验证可行）。
零风险，适合先让玩家/设计确认"原版密度是否就是要的"。

## 5. 复现命令（本次用于核实，均在网关执行）

```bash
# 网关：内网 192.168.1.100:6122
cd /root/gotouhou/PhK-BattleServer
./build-linux/phk_danmaku_trace --out /tmp/gap.jsonl --seed 1 --ticks 300 \
  --ruleset tna-1.40-danmaku --boss-id boss21_tna     # 300 tick 末 664 颗
./build-linux/phk_danmaku_trace --out /tmp/gap20.jsonl --seed 1 --ticks 300 \
  --ruleset tna-1.40-danmaku --boss-id boss21_tna_s20  # 300 tick 末 760 颗
# 本地量化
cd /d/gotouhou/SpellKard/laya
node dev/danmaku_gap.mjs --window 300 /d/gotouhou/tmp/gap-*.jsonl
```

## 6. 待用户裁决

1. 走 A / B / C 哪条？
2. 若走 A：`boss21_tna` 是**新增可选 boss**（房主挑）还是**替换默认 boss**？
3. 客户端预测是否同期补 cadence 镜像，还是该房间明确只插帧？
