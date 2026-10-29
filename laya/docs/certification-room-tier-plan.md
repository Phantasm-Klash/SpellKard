# 考证模式接入关卡，并用评级区分大厅房间等级

> 2026-10-30 调研。目标：把已有的关卡（stage）作为考证关卡接入考证评级模式，
> 并让玩家在大厅只能看到/匹配到自己评级对应的房间等级。

---

## 0. 一句话结论

**服务端的数据模型已经齐了，缺的是"把它暴露出来"和"用它分组"。**
`CertificationProfile` 已含 `ChallengeStageID`（考证关卡）、`RatingCode`、`RankScore`、
`Percentile`、`Top30Qualified`、`NextCertificationUnlocked` —— 也就是文档
`08_game_modes/certification_ranked_mode.md` 里要求的评级数据**基本都有了**。

缺的三件事：

1. `Records` 接口只回 `RatingCode / RankScore / SeasonID`，**考证关卡与晋级资格没回**；
2. `matchmaking.join` **不按评级分组**（优先同评级、等待超时放宽到相邻评级这条规则没实现）；
3. 客户端**没有模式选择 UI**，也没有"只能进某等级房间"的展示。

---

## 1. 现状盘点（逐端核实）

### 服务端（Gensoulkyo）

| 项 | 位置 | 状态 |
| --- | --- | --- |
| 评级数据模型 | `runtime/core/types.go:743` `CertificationProfile` | ✅ 完整（含 `ChallengeStageID`） |
| 考证模式已注册 | `runtime/core/service.go:1270,1438`（`modeID = "certification"`） | ✅ |
| 关卡（stage）已在用 | `runtime/core/boss_selection.go`：`ModeParams["stage_id"]`（如 `lunar_maze`）+ `validateLoadout(..., CertificationProfile{})` | ✅ 关卡已经是考证流程的一部分 |
| 结算写回评级 | `runtime/core/service.go:4633`（`rankScoreBefore` → 更新） | ✅ |
| **Records 只暴露三个字段** | `runtime/core/service.go:1810 Records()` → `Points/RatingCode/SeasonID` | ❌ 缺 `ChallengeStageID` / `Top30Qualified` / `NextCertificationUnlocked` / `RankScoreFloor` / `Percentile` |
| **匹配不按评级** | `matchmaking.join` 只读 `mode_id` / `mode_params` | ❌ |

### 协议（PhK-Protocol）

| 项 | 位置 | 状态 |
| --- | --- | --- |
| `LoadoutRef` 带 `stageId` + `ratingCode` | `SpellKard/laya/src/core/protocol/types.ts:41-48` | ✅ 房间/载入已能带关卡与评级 |
| `BattleTicket` 带 `level` + `ratingCode` | 同上 `:112-120` | ✅ |
| `RoomStateMessage` **没有评级** | 同上 `:210-218` | ❌ 房间状态里看不到等级 |
| `matchmaking.join` 无 rating 参数 | `lobby_client.ts:1450` | ⚠️ 但 `mode_params` 是自由键值，**可先不扩展协议** |

### 客户端（SpellKard）

| 项 | 位置 | 状态 |
| --- | --- | --- |
| 解析 `ratingCode` / `seasonId` | `lobby_client.ts:2128-2129`（RecordsView） | ✅ |
| 战绩页显示评级 | `records_scene.ts:166` | ✅ |
| 模式列表（含 `certification`） | `core/net/room_setup.ts:24-34` `DECLARED_MODE_IDS` | ✅ 已声明 |
| `certification` **不可玩** | 同上 `PLAYABLE_MODE_IDS = [mvp_boss_race, coop_boss]` | ❌ |
| **模式选择 UI 未接线** | `resolvePlayableModes` / `isPlayableMode` 定义后**无人调用** | ❌ |
| 大厅建房 / 匹配入口 | `lobby_scene.ts:853,864` | ✅ 存在 |

---

## 2. 落地步骤（按顺序，每步可独立回滚）

### 第 1 步：把考证关卡与晋级资格暴露给客户端（服务端）

`Records()` 的 `RecordsView` 里补上（**都是 `CertificationProfile` 已有的字段，只是没返回**）：

```
challenge_stage_id            string   // 当前该考哪一关
top_30_qualified              bool     // 是否够格考下一级
next_certification_unlocked   bool
rank_score_floor              int
percentile                    float
```

客户端 `RecordsView`（`lobby_client.ts:717` 附近）同步解析。

> 这一步**不需要动 wire**：`records.get` 的响应体是服务端自由定义的视图，
> 加字段对老客户端无影响。

### 第 2 步：匹配按评级分组（服务端）

`matchmaking.join` 已有 `mode_params`，客户端会把自己的评级放在
`mode_params.rating_code`（**客户端侧已完成，见 §3**）。服务端据此：

1. 优先把 `rating_code` 相同的玩家配在一起；
2. 等待超过阈值后放宽到**相邻**评级；
3. 跨评级对局时，rank 分变化按评级差修正。

> 这样第 2 步可以**先于协议扩展**落地：客户端现在就发 `rating_code`，
> 服务端读不读都不会出错（老服务端直接忽略这个键）。

### 第 3 步：房间带等级 + 大厅按等级过滤

- `RoomCreateRequest` 已经能带 `loadout.ratingCode`，但 `RoomStateMessage` 不回它
  → **需要给 `RoomStateMessage` 补一个评级字段**（这一步要动 wire，
  按 `PhK-Protocol` 冻结规则，需先登记并等 lead 确认）。
- 大厅据此只列出玩家评级可进的房间，其余标记为"等级不符"。

### 第 4 步：客户端的考证入口与模式选择（客户端）

- 接线 `resolvePlayableModes` / `isPlayableMode`（现在没人调用）；
- `certification` 进入可玩列表（在对局服实现之后）；
- 在大厅显示"当前评级 / 可考关卡 / 是否够格晋级"（数据来自第 1 步）。

---

## 3. 客户端已经做掉的部分（本次提交）

`matchmakingParams(records)`（`core/game/lobby_flow.ts`）：入队时把自己的评级放进
`mode_params.rating_code`。

- **向前兼容**：服务端现在忽略它，行为与今天完全一致；
- **两侧可任意先后落地**：服务端哪天开始读这个键，分组就哪天生效，客户端不用再改；
- `records` 只在战绩页打开时才加载，所以**没打开过战绩页的玩家入队行为与以前一样**
  （不带这个参数）。

---

## 4. 需要 lead 拍板/实施的部分

| # | 内容 | 属于 |
| --- | --- | --- |
| 1 | `RecordsView` 补考证字段（§1 步） | Gensoulkyo |
| 2 | `matchmaking.join` 按 `mode_params.rating_code` 分组（§2 步） | Gensoulkyo |
| 3 | `RoomStateMessage` 补评级字段（§3 步） | PhK-Protocol（**wire 冻结，需登记**） |
| 4 | 考证关卡的 seed / 禁卡 / 通关条件怎么用 `stage_id` 表达 | 设计确认 |

## 5. 测试重点

- 同评级优先：两个同评级玩家入队应配到一起；
- 放宽：只有一个评级玩家时，等待阈值后能跟相邻评级配上；
- 跨评级 rank 分修正；
- 客户端在未加载 records 时入队不带 `rating_code`（老行为不变）。
