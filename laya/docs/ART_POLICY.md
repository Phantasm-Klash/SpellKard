# 美术与表现底层原则（ART POLICY）

> 本文件是**强制约束**，不是建议。任何客户端改动都必须满足这里的条款；
> 评审与门禁（`npm run check`）失败时先对照本文件。

## 1. 唯一美术来源：东方千夜贴（千夜追忆 1.40 导入树）

- 游戏内一切可见美术都来自 **千夜追忆（TNA）1.40 APK** 的导入树：
  `laya/layaide/assets/resources/tna/`（web）或 `resources/tna`（LayaNative）。
  当前导入：**25 个图集 / 570 帧 / 216 个 `kEnemyBullet` / 14 个自机立绘 /
  24 张背景 `bg_01_01 … bg_30_02` / Boss 立绘 `boss/` + `boss_all_0N` +
  `enemylist0N` 图集**。
- 登录页美术（`resources/login`）同样出自该 APK（`bg_title.png`、
  `player_01.png`），不得替换为自绘素材。
- 弹幕函数与视觉同源：运动/弹道以 `core/sim/danmaku/bullet_motion.ts`
  为准（与服务端同源），视觉帧以 `core/game/bullet_visual.ts` +
  `core/game/tna_actor_frames.ts` + `core/game/coop_art.ts` 的
  `atlas#frame` 映射为准。

## 2. 禁止自制美术作为最终表现

- **禁止**用 `Laya.Graphics` 自绘 Boss、自机、子弹、背景、立绘、转场图案
  作为画面的最终观感（历史遗留的圆形 Boss、三角自机、圆点弹幕、网格背景
  都属于此列）。
- 允许的 `Graphics` 用途仅限**玩法指示与 UI 骨架**：格挡扇形弧、巨炮封锁
  弹道、锁定/格挡/断线标记、血条、文本、面板边框。
- 资源未加载的瞬态窗口可以隐藏精灵（空白），但**不得**回落到另一种美术
  风格作为默认观感。

## 3. 玩家角色必须用千夜贴自机精灵绘制

- 战斗中的玩家角色必须使用 TNA 自机精灵：`ply_shot_0N/player_0N.png`
  （32×48，机头朝上，按朝向旋转）。合作模式按座位取 1..4 号自机
  （`core/game/coop_art.ts#coopPlayerArt`）。
- **禁止**用箭头、三角形、圆点或任何几何体代替玩家角色。

## 4. 界面切换必须由千夜贴美术承载

- 进入对局、场景切换不得出现「两套美术风格交替闪现」。同一画面自始至终
  使用同一美术来源。
- 合作模式（`coop_boss`）在首个快照到达前就渲染 TNA 背景
  （`CoopView.render(null)`），**不得**先渲染 MVP 视图的 TNA 美术再切换成
  另一种风格的战场。
- 转场/过场（cutscene、watermark）使用 TNA 立绘与背景，不使用纯色或自制
  矢量图案充当画面。

## 5. 缺美术时：从 APK 补导入，不自绘

- 缺少某个美术资源时，用 `SpellKard/tools/import_tna_atlas.py` 从 APK
  重新导入，并把新帧登记进 `layaide/assets/resources/tna/index.json`。
- 每个新增的 `atlas#frame` 映射必须在 `tests/danmaku_atlas_index.test.ts`
  中钉住（帧必须真实存在于 index.json），否则门禁失败。
- **禁止**为了「先跑起来」而自绘替代品并留在最终表现里。

## 6. 门禁

- `npm run check`（typecheck + test + ide:check）与 `npm run build` 必须通过。
- 新增美术映射必须附带测试：纯映射逻辑放 `tests/coop_art.test.ts` 一类
  的单元测试，帧存在性放 `tests/danmaku_atlas_index.test.ts`。
