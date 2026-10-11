# 千夜追忆（TNA）弹幕移植到 SpellKard 客户端

> 目标：把《东方千夜追忆》1.40 逆向出的**真实弹幕数据与美术**移植进 SpellKard 客户端
> （LayaAir 3 + TypeScript），替换原先的 10 个合成测试弹幕与纯色圆点渲染。
>
> 输入原料：`rev/analysis/`、`rev/patterns/`、`rev/assets/`（APK 逆向成果），
> 共享契约 `PhK-Protocol/data/tna_contract.json`。
>
> **服务端权威，客户端只做镜像 + 插值表现。** 客户端不发明判定。

---

## 1. 模块结构

```
SpellKard/
  tools/
    gen_danmaku_ts.py        # 由契约生成 TS 数据表（--check 供 CI 校验）
    import_tna_atlas.py      # cocos plist → LayaAir .atlas + 贴图 + index.json
  laya/
    src/core/sim/danmaku/    # 引擎无关的弹幕镜像（可单测，无 Laya 依赖）
      bullet_kind.ts         #   216 个 kEnemyBullet（生成）
      bullet_motion_table.ts #   79 个 bulletFunc 元数据（生成）
      bullet_motion.ts       #   79 个运动学的 TS 镜像 + 逐帧步进
      spawn_command.ts       #   96 字节 CreateBulletCommand + 整圆发射器
      player_loadout.ts      #   52 射击 + 13 炸弹（生成）
      pattern_timeline.ts    #   时间线 + 样板阶段
      index.ts               #   barrel
    src/core/sim/boss_race.ts        # 新增 TNA 规则集分支（保留旧规则集）
    src/core/game/bullet_visual.ts   # bulletKind → {atlas, frame, motionFamily}
    src/core/game/boss_race_view_model.ts # 渲染项新增 bulletKind/motionFamily
    src/platform/laya/view/
      bullets.ts             # AtlasBulletRenderer（真实图集帧）+ 向量兜底
      bullet_atlas.ts        # LayaAir 图集加载 / 帧查询
      boss_race_view.ts      # 渲染项 → 渲染器
    layaide/assets/tna/      # 25 个 .atlas + 25 贴图 + 14 立绘 + index.json
```

数据流：

```
tna_contract.json ──gen_danmaku_ts.py──▶ bullet_kind / bullet_motion_table / player_loadout
rev/assets ──import_tna_atlas.py──▶ layaide/assets/tna/*.atlas + index.json
                                        │
  服务端快照(权威) ─▶ boss_race.ts 镜像 ─▶ bullet_visual(bulletKind→帧) ─▶ AtlasBulletRenderer
```

---

## 2. 资源组织

### 2.1 产物（`laya/layaide/assets/tna/`）

| 资源 | 数量 | 说明 |
|---|---|---|
| `bulletlist01..06.atlas` + `ebullet_1..6.png` | 6 | 子弹图集（**216 弹种全部落在这里**） |
| `bulletvanish.atlas` + `ebbreak.png` | 1 | 子弹消失动画 |
| `enemylist01..04.atlas` + `boss_all_01..04.png` | 4 | 敌机/Boss |
| `ply_shot_01..13.atlas` + 同名 png | 13 | 自机射击贴图 |
| `ply_effect_01.atlas` + png | 1 | 自机特效 |
| `player/player_01..13.png`（含 `player_09_02`） | 14 | 自机立绘（独立贴图） |
| `index.json` | 1 | 运行期索引 |

合计 **570 帧 / 25 图集 / 216 弹种 / 14 立绘**。

### 2.2 `index.json` 结构

```jsonc
{
  "meta":   { "frame_count": 570, "atlas_count": 25, "kind_count": 216,
              "player_count": 14, "clamped_count": 4 },
  "atlases": { "bulletlist01": { "texture": "ebullet_1.png",
                                 "size": {"w":256,"h":256}, "frames": 138 }, ... },
  "frames":  { "bulletlist01/kusabi_01.png": { "atlas":"bulletlist01", "frame":"kusabi_01.png",
                "x":..,"y":..,"w":..,"h":.., "sourceW":..,"sourceH":..,
                "offsetX":0,"offsetY":0,"rotated":false, "clamped":false }, ... },
  "kinds":   { "9": {"atlas":"bulletlist01","frame":"kusabi_01.png"}, ... },
  "players": [ "player/player_01.png", ... ]
}
```

帧键用 `atlas/frame` 组合，避免跨图集同名帧冲突。

### 2.3 `.atlas` 格式

采用 LayaAir 3 的 TexturePacker-JSON 结构（`meta.image/size/scale/prefix` +
`frames[].frame/sourceSize/offset/rotated` + `animations`），与 cocos plist 1:1 对应。
`npm run ide:check` 现会校验：25 图集文件与贴图齐全、570 帧矩形全部落在贴图边界内、
216 弹种可解析、≥13 立绘存在（共 28 项检查）。

### 2.4 越界帧（已知原版缺陷）

`rev/docs/porting_plan.md` §7 记录 `ply_shot_04`/`ply_shot_06` 的 plist 帧矩形越界。
导入器把这 **4 帧裁剪到贴图边界**（`clamped:true`），保留 570 帧总数；这 4 帧不属于
216 弹种，仅影响少数自机射击/炸弹贴图。`index.json#meta.clamped_count` 与单测锁定该数字。

### 2.5 美术抽查（结论）

从 `rev/assets/sliced/` 抽查 12 张帧 + 4 张立绘，内容正确：
`kusabi`(楔形)、`ring`(环)、`arrow`(箭)、`fuda`(札)、`heart`(心)、`chou`(蝶)、
`kou`(光球)、`poison`(紫雾)、`anchor`(锚)、`unzan`(云)、`dangan`(弹丸)、`knife`(刀)；
立绘为灵梦/铃仙/琪露诺/蕾米莉亚等，风格与 APK 一致。216 弹种帧名 **216/216 命中图集**。

---

## 3. 与服务端的对齐点

| 对齐项 | 约定 | 客户端落点 |
|---|---|---|
| **角度单位** | 度（degree），非弧度 | `bullet_motion.sinDeg/cosDeg` |
| **坐标** | 服务端 milli 整数（1/1000 px），场地 640×960 | `boss_race` 沿用 `*_milli`；运动上下文 ×1000 |
| **弹种数值** | `kEnemyBullet` 原版枚举 9..224，**逐位一致** | `bullet_kind.ts`（生成自契约） |
| **运动学编号** | `bulletFunc` 0..85 | `bullet_motion_table.ts`（生成自契约） |
| **一次齐射** | `CreateBulletCommand` 96 字节 POD | `spawn_command.ts`（编解码 + 整圆发射器） |
| **发射算法** | `createBullets1`：`step=360/count`，起始角 `base−spread` 归一化 | `spawn_command.emitRadial` |
| **坐标哨兵** | `spawnX/Y == -1.0` → 跟随发射者 | `SPAWN_FOLLOW_EMITTER` |
| **规则集版本** | `tna-1.40-phase` | `pattern_timeline.TNA_RULESET_VERSION` |

**96 字节布局**（小端，来自 `rev/patterns/create_bullet_command.md` 实测）：
`bulletType@0 i32 / frameIndex@4 i32 / spawnX@8 f32 / spawnY@12 f32 / flag16@16 u8 /
baseAngleDeg@20 f32 / f24..f40@24..40 / count@44 i16 / spreadOrSpeed@48 f32 /
s52..s56@52..56 i16 / f60..f80@60..80 f32 / s84..s94@84..94 i16`。

**旧规则集保留**：`mvp-boss-race-s0` 的 10 个合成 pattern 路径**未删除**——服务端尚未切换
到 TNA 时间线，删除会破坏双端哈希对齐。客户端通过 `rulesetVersion` 分支：旧版走合成
pattern，新版走真实弹幕（见 §6 未完成项）。

---

## 4. 运动学镜像

`bullet_motion.ts` 把 79 个 `bulletFunc` 归入 13 个族，并给出确定性的逐帧步进：

| 族 | func 例 | 语义 |
|---|---|---|
| `init_linear` | 0,4,29,47,63 | 应用 A0/V0/V1/X/XC 快照 |
| `accelerate` | 5,35,39,43 | `v+=X` 夹 `XC`；线性/正弦调速 |
| `sine` | 25,37,40,73,81 | `v=V1+XC·sin(A0+X·T)` 等 |
| `homing` | 2,17,18,48 | 朝目标转，单帧 ≤ 阈值 |
| `aimed` | 11,12,13,70,76,61 | 出屏/周期重新瞄准 |
| `bounce` | 1,7,20,32,38,46,57,58,62,67,77,78 | `180−a` / `360−a+90` 归一化 |
| `proximity` | 15,16,24,34,41,42,44,45,53,60,74,80,84,85 | `dist ≤ 阈值` 触发 |
| `split` | 31,41,50,55,67,83 | Boss 分裂/召唤（事件） |
| `reskin` | 14,30,34,39,41,48,54,65,84,85 | 换皮 + 命中半径 |
| `parametric` | 26,33,66,75,82,83 | 参数方程/摆线 |
| `state_machine` | 19,21,22,23,34,51,57,71,72,77 | 读全局状态码 |
| `auxiliary` | 3,6,8,28,36,79 | 无字段写入 |
| `unknown` | 27,53 等 | 逆向未确定 |

**分工对齐原版**：`advanceBulletMotion` 做角/速积分与 `vx/vy` 合成；族函数只覆写与触发。
**确定性**：无系统时间/随机；需要随机处由调用方经 `ctx.randomAngleDeg` 传入（服务端权威）。

---

## 5. 渲染改造要点

- `bullet_visual.ts` 新增三元映射 `bulletKind → { atlas, frame, motionFamily }`：
  `atlas/frame` 来自契约，`motionFamily` 由 `bulletFunc` 解析（缺省 `unknown`）。
  同时提供 `speciesFrames`、`animatedFrameFor`（本地帧动画，可选）、
  `isRotatingSpecies`/`spriteRotationDeg`（方向性美术随角度旋转）。
- `bullets.ts`：
  - `AtlasBulletRenderer` —— 按 `bulletKind` 取图集帧，设置 `sprite.texture` +
    `pivot(中心)` + `artScale`（= `playfieldWidth/640`，因原版美术按 640 宽制作）。
  - `VectorBulletRenderer` —— 原向量美术，作为**兜底**（图集未加载/非法 kind/旧 pattern）。
  - 图集帧缺失时自动回退，不会出现空白。
- `boss_race_view.ts` 用对象池复用 `Laya.Sprite`，渲染项交给可替换的 `BulletRenderer`；
  不再每帧 `new`，也不再画纯色圆点。
- `bullet_atlas.ts`：`LayaAtlasFrameSource` 一次性加载 25 个 `.atlas`，按
  `atlasUrl#frameName` 查询子纹理并缓存。资源根 `DEFAULT_TNA_ATLAS_ROOT =
  'layaide/assets/tna'`（web 构建经 `dev/serve.mjs` 从 `laya/` 提供；IDE 构建可能需改为 `tna`）。

---

## 6. 未完成项 / 不确定性

1. **★ 弹种 → 运动函数（`bulletFunc`）的分派表未解出**（`rev/docs/porting_plan.md` §7.2）。
   因此 `pattern_timeline.ts` 的时间线是**样板**：弹种/运动函数取自实测，但**逐 tick 调度是
   示例值**，非原版 `setBossBullet*` 时间线。接入真实时间线时替换 `SAMPLE_TNA_PHASES` 即可。
2. **服务端尚未实现 `tna-1.40-phase`**（另由 BattleServer agent 负责）。客户端旧规则集
   （`mvp-boss-race-s0`）路径保留，双端哈希仍对齐；待服务端上线后应把默认配置切到 TNA，
   并删除合成 pattern。
3. **旋转物种清单为推断**（`ROTATING_SPECIES`）：原版 `rotateFlg`/`rotateAngle` 未解出，
   现按美术外观（细长形状）近似；圆形弹不旋转。
4. **12 个 `setBossBullet*` 的节点模式 id 语义**未闭合，无法还原全部 Boss 弹幕。
5. `spreadOrSpeed` 同时作张角与速度使用（契约注释「张角/速度」），为**推断**；
   服务端确认后需同步。
6. **自机射击/炸弹**只落了数据表（`player_loadout.ts`），未接入模拟/判定；52 射击中
   `resolved:false` 的若干项存在未确定字段。
7. `emitFan` 为客户端便利实现（非 `createBullets1` 直译），仅用于样板演示。
8. 图集资源根路径在 web / IDE 两种构建下的差异需按实际运行环境确认。

---

## 7. 测试与门禁

`npm run test`：**159 passed / 0 failed**（基线 102，新增 57）。新增用例：

- `danmaku_data.test.ts` —— 216 弹种唯一/连续、43 物种划分、79 运动、52+13 武装。
- `danmaku_motion.test.ts` —— 6 个族逐帧坐标、归一化、确定性。
- `danmaku_spawn.test.ts` —— 96 字节布局/编解码、整圆/扇形发射。
- `danmaku_atlas_index.test.ts` —— 读 `index.json`：216 弹种帧齐全、坐标在界内、570 帧。
- `boss_race_tna.test.ts` —— TNA 路径发射真实弹种并按镜像推进；旧规则集回归。
- `bullet_visual.test.ts`（扩展）—— 三元映射、物种帧、动画、旋转。

门禁：`npm run typecheck`、`npm run typecheck:full`、`npm run ide:check`（28 项）、
`python tools/gen_danmaku_ts.py --check` 全部通过。

---

## 8. 版权

本目录下的美术（`.atlas`/`.png`）与弹幕数值为《东方千夜追忆》同人作品的**逆向成果**，
版权属原作者 / 上海爱丽丝幻乐团（东方 Project 二次创作规约）。

**仅用于内部研究与自研玩法参考**，不得直接分发。上线版本必须替换为**自制或已授权**的美术；
本方案的资源管线（`import_tna_atlas.py` + `.atlas` 组织 + 渲染器）保持不变，只替换素材即可。
