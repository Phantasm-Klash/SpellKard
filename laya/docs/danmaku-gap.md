# 实战 vs 原 TNA 弹幕效果差距（权威状态量化）— 修订版 2026-11-06

- 生成：2026-11-05T18:05:02.044Z
- 数据来源：**网关当前生产二进制** `PhK-BattleServer/build-linux/phk_danmaku_trace`
  `--seed 1 --ticks 300` 同参生成，度量 `bullets[]` 本身
- 对齐窗口：前 300 tick
- 速度单位 px/tick（trace 内为 milli/tick），tick 率 60Hz

| 指标            | gap-boss21_tna.jsonl | gap-ruleset-local-s0.jsonl | gap-boss21_tna_s20.jsonl | gap-tna-1_40-phase.jsonl | gap-mvp-boss-race-s0.jsonl |
| ------------- | -------------------- | -------------------------- | ------------------------ | ------------------------ | -------------------------- |
| tick 数        | 300                  | 300                        | 300                      | 300                      | 300                        |
| 平均同屏弹数        | 639.14               | 28.33                      | 716.61                   | 28.33                    | 27.19                      |
| 峰值同屏弹数        | 768                  | 46                         | 768                      | 46                       | 44                         |
| 同屏 P95        | 764                  | 46                         | 768                      | 46                       | 42                         |
| 累计发射（去重 id）   | 1996                 | 78                         | 1596                     | 78                       | 66                         |
| 有发射的 tick 数   | 29                   | 6                          | 54                       | 6                        | 6                          |
| 每 tick 平均发射   | 6.65                 | 0.26                       | 5.32                     | 0.26                     | 0.22                       |
| 发射 tick 平均齐射量 | 68.83                | 13.00                      | 29.56                    | 13.00                    | 11.00                      |
| 单次最大齐射        | 208                  | 24                         | 262                      | 24                       | 24                         |
| 达弹数上限的 tick   | 14                   | 0                          | 99                       | 0                        | 0                          |
| 平均弹速 px/tick  | 3.97                 | 3.16                       | 2.56                     | 3.16                     | 3.20                       |
| 弹速中位数         | 3.60                 | 2.80                       | 2.80                     | 2.80                     | 3.20                       |
| 弹速 P95        | 5.00                 | 4.40                       | 4.00                     | 4.40                     | 3.60                       |
| 最大弹速          | 5.00                 | 4.50                       | 4.00                     | 4.50                     | 4.40                       |
| 平均判定半径 px     | 4.00                 | n/a（trace 未给）              | 4.00                     | n/a（trace 未给）            | 4.17                       |
| 弹种数（唯一）       | 4                    | 6                          | 7                        | 6                        | 1                          |
| 运动函数数（唯一）     | 4                    | 4                          | 6                        | 4                        | 1                          |
| pattern 数（唯一） | 1                    | 6                          | 1                        | 6                        | 6                          |

## 差距（原 TNA ÷ 实战）

| 维度 | 原 TNA | 实战 | 倍数 |
| --- | ---: | ---: | ---: |
| 平均同屏密度 | 639.14 | 28.33 | 22.56× |
| 峰值同屏密度 | 768 | 46 | 16.70× |
| 累计发射量 | 1996 | 78 | 25.59× |
| 发射频率（有发射的 tick） | 29 | 6 | 4.83× |
| 单次最大齐射 | 208 | 24 | 8.67× |
| 平均弹速 | 3.97 | 3.16 | 1.26× |
| 弹速 P95 | 5.00 | 4.40 | 1.14× |

> 倍数为「原 TNA 相对实战」；>1 表示原版更密/更快。

## 口径与读法

- **第一个 trace 是原 TNA 基准，第二个是实战**（按命令行顺序），倍数按这个顺序算。
- `tick` 率取 `PhK-Protocol/data/tna_contract.json` 的 60Hz；速度 `sqrt(vx²+vy²)/1000` px/tick。
- 「累计发射」按 `bullet_id` 去重，不是 `bullets.length` 求和——后者是同屏存量。
- **弹种/运动函数数量不能直接当"丰富度"比**：原 TNA trace 是**单个 Boss 的实测链表**
  （boss21，一种 pattern、少数弹种但极高密度），实战是**10 模式轮转**（多 pattern、
  弹种略多但每波只有十几颗）。两者口径不同，只看密度/速度/齐射量才有意义。
- 合成 trace 不带 `radius_milli`，半径列为 n/a，不代表判定半径为 0。
- 这些是**权威状态**的度量，不是截图观感；渲染是否忠实另由 `dev/stage_parity.mjs` 验收。


## ★ 修订说明（本版推翻初版的两处结论）

初版把差距归因于「默认 `rulesetVersion` 仍是 `mvp-boss-race-s0`」，并建议
「切到 `tna-1.40-phase`」。**两处都错了**，用当前生产二进制同参重跑后已核实：

1. 协议 manifest（`PhK-Protocol/gen/go/phk/v1/manifest.go:10`）的
   `RulesetVersion = "ruleset-local-s0"`，大厅票据签的就是它；
   `core.RulesetVersion = phkv1.RulesetVersion`；
   `usesRealDanmaku()` 只对 `mvp-boss-race-s0` 返回 false ⇒ **线上默认走真实弹幕路径**。
   `defaultBossRaceConfig()` 里的 `mvp-boss-race-s0` 只是**本地/测试兜底**，
   真实配置由 `bossRaceConfigForRuleset()` 按票据 ruleset 构造。
   `battlespawn.DefaultRuleset` 同样只是对战服进程参数为空时的兜底，不是票据。
2. **切规则集不会改变密度**：`ruleset-local-s0` 与 `tna-1.40-phase` 同参生成的
   `state_hash` 完全相同（`459e4e803e8c1d4c`），平均同屏都是 **28.33**、累计发射都是 78。

### 真正的根因：boss / pattern 库，不是规则集

| 路径 | ruleset | boss | 平均同屏 |
| --- | --- | --- | ---: |
| 线上默认 | `ruleset-local-s0` | 默认 `BOSS_CATALOG`（tian/hui，10 模式合成库） | 28.33 |
| 合成兼容 | `mvp-boss-race-s0` | 同上 | 27.19 |
| 显式 TNA | `tna-1.40-phase` | 同上 | 28.33 |
| **原 TNA state 14** | `tna-1.40-danmaku` | **`boss21_tna`**（实测链表 cadence） | **639.14** |
| **原 TNA state 20** | `tna-1.40-danmaku` | **`boss21_tna_s20`** | **716.61** |

差距来自**发射调度**：线上用 10 模式合成库（45 tick 一波、6 种 pattern、最大齐射 24），
原 TNA 用 `boss21_tna` 实测链表（1 种 pattern、18 帧子节奏、最大齐射 208、14 个 tick
打满 768 上限）。`pattern_timeline.ts` 那套「逐行镜像服务端实测 cadence」的库是给
`boss21_tna` 这类 boss 用的，**默认 boss 并没有接上它**。

顺带核实：直接用 `--boss-id boss21`（不带 `_tna` 后缀）当前几乎不发弹（300 tick 仅 2 颗、
链记录 8 条），与 `STAGE_PARITY_REPORT.md` §6.1 登记的「块 B 节点未解码」一致 ——
**不要把这个 id 当成原 TNA 基准**。

### 修正后的建议（需确认，本次未动）

1. 要复刻原版密度，应让**大厅/对局服选用 `boss21_tna` / `boss21_tna_s20` 这类实测 boss**
   （`rooms.create` 的 boss_id / mode_params 下发链路），而不是切规则集。
2. 先确认 `BossCatalog` 与 `boss21_tna` 的注册关系（后者是 `tna-1.40-danmaku` 下的
   独立 boss_id），以及大厅能否把该 boss_id 传给对战服。
3. `boss21`（未解码版本）与 state 20 的门周期、`0x4db5cc` 魔数仍属逆向遗留项，
   见 `tmp/danmaku-engine-20261024/TNA21_REWRITE_PROPOSAL.md`。
4. 若暂时不接，至少在模式说明里标明当前默认 boss 是「10 模式库」，不是原版链表弹幕。

### E2E（不变）

- `dev/stage_parity.mjs` 对三条原 TNA 实测 trace（tna450 / tna450b / s20）各 450 tick：
  **450/450 通过，边界/插值误差 0.000000 px** ⇒ 高密度下插帧仍逐像素忠实。
- 原生 `app-v62` CDP 抽查：stage `1000.84×750`（4:3）、15 子节点、TNA 图集可加载。
