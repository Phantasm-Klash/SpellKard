# 弹幕状态分解与差量传输合同 v0.1（2026-11-07）

> 状态：**规格 + 骨架阶段**。本文件是 C++ 对战端与 TS 客户端的共同合同；
> 任何字段/公式改动必须双端同步并重跑 §7 的验收门禁。

## 1. 动机

现网快照每 tick 全量下发 `bullets[]`（均值 6434 B / 峰值 16178 B，其中 95% 是
弹幕数组）。而弹幕状态绝大多数可由双端共享的确定性运动函数复算。目标：把
「每帧传绝对位置」改成「一次传出生参数 + 稀疏传偏移」。

## 2. 数学模型

记号：tick `t ∈ ℕ`；全局种子 `s`（票据带外下发，64 位）；弹 `i`。

**出生事件** `σᵢ = (t₀, θᵢ, gᵢ, pᵢ, qᵢ)`
- `t₀` 出生 tick；`θᵢ` = `BulletMotion` 的静态参数模板（`angle_init, spd_init2,
  xacc, xacc_cap, f598, prev_angle, p1, p2, delay, bullet_func_no, bullet_kind,
  hit_dis, ...`）；`gᵢ` = group id；`(pᵢ,qᵢ)` = `(pattern_index, spawn_index)`。
- `bullet_id` 沿用服务端发号 `"b" + next_bullet_id++`，**双端不得各自发号**。

**共享上下文** `C(t)` = 全体玩家 `(x,y)`、Boss 位置、`global_state`。
这些已在快照 `players[]` / `boss` 中，不重复编码。`MotionTargets` 由 `C(t)` 派生。

**整体运动** `G_g(t) = (τx, τy, φ)`（平移 + 旋转的刚体变换），作用于 group 内
成员的局部坐标。★ 当前服务端**没有**这层概念（`BossMovement` 只是出生点偏移，
烘焙进 `motion.x/y` 后不再共享）；本版定义 `G_g(t) ≡ I`，字段先占位，
真实编队变换属后续工作。

**确定性基线** `Fᵢ(t)`：从 `σᵢ` 出发逐 tick 递推

```
R_i(t) = DeterministicRng(s, t, p_i, q_i)          // counter 每 tick 从 0 起
m_i(t+1) = UpdateBulletMotion(m_i(t), C(t), R_i(t)) // 79 func 分派 + IntegrateVelocity
pos_i(t+1) = pos_i(t) + (vx, vy)                    // 显式欧拉，无 dt
```

`UpdateBulletMotion` / `IntegrateVelocity` / `DeterministicRng` 双端已有逐位镜像，
由 `phk_motion_diff` ↔ `dev/motion_diff.mjs` 证明一致（相对误差 ≤1e-12）。

**权威偏移** `Δᵢ(t) = Sᵢ(t) − Fᵢ(t)`，其中 `Sᵢ(t)` 是服务端权威状态。
最终状态：

```
S_i(t) = G_{g_i}(t) ∘ [ F_i(t; σ_i, C[0..t], E[0..t]) + Δ_i(t) ]
```

`E[0..t]` 是权威事件流（分裂 / 清屏 / 卡牌 / hidden）——它是 `Δ` 的主要来源，
必须以稀疏事件下发，不能指望客户端猜。

★ **`Fᵢ` 不是 `(seed,tick)` 的纯函数**，而是 `(σᵢ, C[0..t], E[0..t])` 的函数。
任何「客户端仅凭 seed+tick 就能重算全部弹幕」的表述都不成立。

## 3. 传输分类

| 类别 | 判据 | 每 tick 传输 |
| --- | --- | --- |
| 整体运动弹 | `gᵢ ≠ 0` 且 `G_g(t) ≠ I` | 只传 `G_g(t)` 三个参数；成员不传 |
| 新生离散弹 | `t = t₀` | `spawn` 事件：`σᵢ` 全模板 + 四元组 + `group_id`，仅一次 |
| 基线一致的离散弹 | `Δᵢ(t) = 0` | **不传** |
| 分叉的离散弹 | `Δᵢ(t) ≠ 0` | 只传 `(bullet_id, Δx, Δy, Δvx, Δvy[, Δkind])` |
| 消亡弹 | 权威删除 | `despawn` 事件：`bullet_id` + 原因，仅一次 |

所有 Δ 用 **milli 整数**（与现 wire 一致）；`Fᵢ` 内部的像素浮点只在双端各自的
运动库里存在，转换 `ToMilli = llround(px*1000)` 统一在快照边界做，避免误差累积。

## 4. wire 合同（可选、可回退）

快照 JSON 顶层新增**可选**字段；`0x04` 类型字节不变：

```jsonc
{
  "wire_cap": 7,                    // u32 bitmask: 1=SPAWN 2=DEVIATION 4=GROUP
  "bullet_spawns": [                // 仅本 tick 新生弹
    { "bullet_id": "b42", "owner_player_id": "p1", "t0": 45,
      "p": 3, "q": 7, "group_id": 0,
      "template": { "x":320, "y":120, "angle":90, "speed":3.2,
                    "bullet_func_no":0, "bullet_kind":12, "hit_dis":4.0,
                    "angle_init":-1, "spd_init2":-1, "xacc":0, "xacc_cap":0,
                    "f598":0, "p1":0, "p2":0, "delay":0, "...": "完整 BulletMotion 默认集" } }
  ],
  "bullet_deviations": [            // 仅 Δ≠0 的弹
    { "bullet_id": "b17", "dx": 120, "dy": -40, "dvx": 0, "dvy": 0 }
  ],
  "bullet_despawns": [ { "bullet_id": "b9", "reason": "spell_clear" } ],
  "group_motion": [ { "group_id": 1, "tx": 0, "ty": -120, "phi": 0 } ],
  "bullets": []                    // wire_cap≠0 且客户端声明支持时可省略
}
```

**回退铁律**
1. `wire_cap` 缺省 / 为 0 → 服务端发**逐字节不变**的全量 `bullets[]`；
   客户端走原 `decodeBossRaceSnapshot` 路径。
2. 客户端解析 `wire_cap≠0` 时若任一必需字段缺失、类型错误、或本地基线重建失败，
   **必须静默回落到全量路径**（若 `bullets[]` 存在）或返回空数组，绝不抛异常、
   绝不把半重建的状态混进权威渲染。
3. 服务端开关 `delta_wire_enabled` 默认 **false**；打开前须完成 §7 全部验收。
4. `CanonicalStateHash` 的 material **不变**；重建出的 `(id,x,y,kind,func)` 必须
   与全量逐位相同，否则 hash 与 golden fixture 全乱。

## 5. 双端分工

| 职责 | 服务端（权威） | 客户端 |
| --- | --- | --- |
| 运动函数 `Fᵢ` | C++ `UpdateBulletMotion` | TS `updateBulletMotion`（同构镜像） |
| 出生发号 / 模板 | 唯一来源，写 `spawn` 事件 | 只消费，不自建 |
| `C(t)` 上下文 | 权威玩家/Boss 坐标 | 从 `players[]`/`boss` 读，预测期用 `p+v·frac` 外推 |
| 碰撞 / 擦弹 / 无敌 / 残机 | **权威判定** | 不权威；补帧只做几何预判定播音效 |
| 卡牌效果 / 清屏 / 分裂 / hidden | **权威生效** | 消费 `despawn`/`deviation`/既有 `events[]` |
| 计分 | 权威 | 只读快照 |
| 补帧 | — | 两快照插值 / 速度外推；**本地算擦弹仅驱动音效** |

## 6. 可行性边界（源码实测，不猜测）

- **79 func 分类**（`bullet_motion.cpp` / `.ts` 分派表）：41 个纯确定性（自身参数 + t）、
  34 个依赖 `MotionTargets`（玩家/Boss 实时坐标）、6 个消耗 RNG（7/52/62/70/71/76）、
  11 个边界反弹、4 个 H 族分裂标记（真实子代由宿主生成）。
- **可重建"大部分"的口径**：41 个纯确定性 + 依赖 `C(t)` 的 34 个中的绝大多数
  （`C(t)` 已在 `players[]`）≈ **75/79**；剩余 6 个 RNG func、链式分裂、卡牌增删、
  符卡清屏归入 `deviation` / `despawn` / `spawn` 事件。
- **RNG 分叉**：`DeterministicRng.counter_` 消耗次数由运行期分支（出屏、`t==0`、
  `global_state`）决定。基线重建若消耗次数不同，后续随机序列全偏。
  解法：这 6 个 func 的弹不做客户端基线重建，改由服务端下发 `rng_cursor`
  或整颗归入 `deviation`。
- **`chains[]` 不是 spawn 流**：每 tick 清空、`chain_id` 是静态节点序号、
  `rng_cursor` 实为弹数、缺 `spawn_index`/模板/`bullet_id` 列表。不可复用，
  必须新建 §4 的 `bullet_spawns`。
- **`vanish_tick` / `angle_deg` 当前未进客户端 codec**（`vanish_tick` 被前向兼容
  测试明确列为"客户端不建模"）；差量化后 `despawn` 事件需覆盖清屏语义。

## 7. 验收门禁（改动后必须全绿）

| 项 | 命令 / 文件 |
| --- | --- |
| 服务端构建 | gateway `cmake --build build-linux -j4` exit 0 |
| 服务端测试 | gateway `ctest --test-dir build-linux`（基线 19/19） |
| 双端运动学差分 | `phk_motion_diff` ↔ `dev/motion_diff.mjs`，79 场景 ×64 tick ≤1e-12 |
| 客户端门禁 | `npm run check`（基线 1022/0/1204）+ `typecheck:full` + `build` + `ide:check` |
| 黄金向量 | `tests/fixtures/boss_race_golden.json`（C++ 导出 240 tick 逐弹）逐位对齐 |
| 轨迹 parity | `npm run parity:client` / `dev/stage_parity.mjs`，`bullet-interpolation` ≤1e-6 |
| 密度回归 | `tools/danmaku_regression` 36 个 golden（`spawn_series_sha256`） |
| 带宽对照 | `phk_danmaku_trace` 同参全量 vs delta，逐 tick 重建位置逐位相等 |

## 8. 明确不在本版范围

- 真实编队 / group 刚体变换（`G_g ≡ I`，仅留字段）。
- 去掉 `bullets[]` 全量（保留为回退兜底与能力协商失败路径）。
- 改 `PhK-Protocol/*.proto`（wire 冻结期；线上 wire 是 `match_lifecycle.cpp`
  手写 JSON，协议仓只是长期契约草案）。
- 改 `CanonicalStateHash` material、result/dem 校验、`Gensoulkyo/`。
- 客户端补帧擦弹**不做权威计数**：不计 graze、不扣 lives、不上报、不改快照。

## 10. 第二阶段：事件溯源式重建（2026-11-07）

### 10.1 Δ 的精确定义

```
Δ_i(t) = S_i(t) − Update(S_i(t−1), C(t−1), R_i(t))
Update  = updateBulletMotion(·, C(t−1), RNG(s, t, p_i, q_i)) + pos += v + t += 1
```

即 Δ 是「本 tick 原始运动函数解释不了的部分」——正是「离散弹幕只传和原始
运动函数的偏移」的严格形式。**服务端不需要影子状态**：`Update` 的输入就是
上一 tick 的权威状态，服务端本来就有。

★ 关键观察：服务端权威轨迹本来就是 `Update` 产生的；所有权威扰动
（符卡清屏 `vanish_tick`、卡牌 `bullet_purge`、出界 `erase`、func31 分裂）
都是**增删弹**，不修改存活弹的 `motion`。因此稳态下 **`Δ ≡ 0`**，差量通道
退化为：

- 每 tick 新生弹 → `bullet_spawns[]`（完整 `BulletMotion` 模板 + `(p,q)`）
- 每 tick 消失弹 → `bullet_despawns[]`（`bullet_id` + 原因）
- `bullet_deviations[]` 保留为纠偏/校验通道，正常为空数组

### 10.2 服务端事件收集

- `BossRaceSimulation` 新增每 tick 容器 `tick_spawns_` / `tick_despawns_`，
  在 `SpawnBulletsForTick` 三条路径、`AdvanceBullets`（出界 / 清屏 / 分裂）、
  `ApplyCardBulletDeltas` 里登记；`Tick()` 开头清空（与 `tick_events_` 同构）。
- `BossRaceSnapshot` 带出；`EncodeBossRaceSnapshotPayload` 在
  `delta_wire_enabled=true` 时 **省略 `bullets[]`**，只发
  `wire_cap` + spawns/despawns/deviations/group_motion。
- spawn 模板逐字段与 `danmaku::BulletMotion` 一致（`phk_motion_diff` 已证
  TS 侧同构）；`(p,q)` = `(pattern_index, spawn_index)` 必须真下发。
- 保留 `delta_wire_enabled=false`（默认）逐字节不变的全量路径作为回退。

### 10.3 客户端重建器

`BulletReconstructor` 维护 `Map<bullet_id, BulletMotion>`：

1. spawn → `createBulletMotion(template)`，记下 `(p,q)` 与 `ownerPlayerId`；
2. 每 tick：`new DeterministicRng(s,t,p,q)` → `updateBulletMotion(m, C(t), rng)`
   → `m.x += m.vx; m.y += m.vy; m.t += 1`；
3. deviation ≠ 0 → 把 `(dx,dy,dvx,dvy)` 叠加到 milli 派生值；
4. despawn → 删除；出界 → 复用 `keepsBullet` 删除；
5. 输出 `BossRaceBullet[]`：`toMilli(m.x − SCREEN_CENTER_X_PX)` 等
   （与 `snapshot()` 同一换算，禁止另写一套）。

`C(t)`（`MotionTargets`）由 `players[]` / `boss` 重建：`my_ship_x/y` 取本地
玩家像素坐标，`enemy_x/y` 取 Boss 发射点（`bossOffsetForTick`）。任一输入
异常 → 返回 `null` → 回落全量（若存在）。

### 10.4 真实弹幕验收（硬性，不许用合成数据代替）

用 §7 / `tests/fixtures/danmaku_real_*.json` 的三组 C++ 权威 trace：

1. 同参生成 **delta trace**（省略 `bullets[]`，只带事件流）；
2. 客户端重建器从 spawn 递推，逐 tick 与全量 golden 的
   `(bullet_id, x_milli, y_milli, bullet_kind, motion_func)` **逐位相等**；
3. `state_hash` 逐 tick 相等；
4. 任何一 tick 不等 → **不允许**去掉全量 `bullets[]`，回到骨架模式；
5. 带宽对照：全量 2.5 MB / 300 tick vs delta 字节数。

RNG 分叉预案：6 个消耗 RNG 的 func（7/52/62/70/71/76）若在第 2 步出现
逐位偏差，先检查 `rng_cursor` 消耗次数，必要时整颗并入 `deviation`，
不得靠放宽断言蒙混。
