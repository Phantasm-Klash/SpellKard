/**
 * 客户端补帧擦弹的**即时音效反馈**（非权威）。
 *
 * ★ 这是给渲染层用的即时反馈，**不是判定**：不计 graze、不扣 lives、不发事件、
 *   不改快照、不上报服务端；权威计数只归服务端
 *   （`docs/danmaku-delta-wire.md` §5 双端分工 / §8 明确不在范围）。
 *   本函数只回答「这一显示帧有哪些子弹**新进入**了本地玩家的擦弹圈」，
 *   由调用方据此直连播放一次擦弹音效：绕过了 REST 500ms 轮询链
 *   （`battle_event_poller.ts` 的 `DEFAULT_INTERVAL_MS=500`），把及时性从约
 *   500ms 降到约一个显示帧（≈16ms）。★ 播放层的 `SfxThrottle`（5 帧 /
 *   83.3ms，spec §2.0 `ExeSoundEffect`）**仍生效**：密集擦弹仍按 83ms 合并；
 *   本层不绕过、不叠加、也不改音频管理器。
 *
 * 单位与几何（★ 先读 view model 确认过，不要猜）：
 *   `BossRaceFrame` 的 `bullets[].position` / `.radius` 与
 *   `players[].position` / `.grazeRadiusPx` **全部是像素**（playfield px）：
 *   `buildBossRaceFrame` 用 `PlayfieldTransform.toPixels / radiusToPixels` 把
 *   权威 milli 换算过来（参考 640 宽布局 1000 milli = 1 px）。权威
 *   `judgePlayerContacts`（`core/sim/boss_race.ts`）在整数 milli 域算
 *   `dx²+dy² <= (bulletRadiusMilli + DANMAKU_GRAZE_RADIUS_MILLI)²`。
 *   距离平方判定**尺度无关**：同一公式在像素域写成
 *   `dx²+dy² <= (bullet.radius + player.grazeRadiusPx)²` 与权威逐位等价
 *   （既有 `tests/render_state_judgment.test.ts` 已证明二者自洽）。
 *   所以这里直接用 frame 自带的像素量做**同构**判定：同样的距离平方、同样的
 *   `(弹半径 + 擦弹圈半径)²` 加法结构、同样的 `<=` 边界；不反算 scale、不
 *   import sim 常量，保持零环境依赖。若把 20000 当像素用会把整屏当擦弹圈。
 *
 * 与权威判定对齐的其余语义：
 *   - 只判归属本地玩家那份 Boss 副本的弹（`ownerIsLocal`，对应权威
 *     `live.ownerPlayerId === player.playerId`）；
 *   - `judgmentActive === false` 或 `grazeRadiusPx <= 0`（判定系统未启用 /
 *     非 `tna-1.40-danmaku`，view model 此时把擦弹圈置 0，`:298`）→ 不判，
 *     否则会把命中圈（`bullet.radius`）误当擦弹圈；
 *   - 无敌帧内（`options.invulnerable` 或 `local.invulnerable`）→ 不判，
 *     避免无敌帧刷音（权威同处 `continue`）。`local.invulnerable` 是 view
 *     model 用 `snapshot.tick <= player.invulnerableUntilTick` 推导好的
 *     **布尔**（`boss_race_view_model.ts:299-301`，权威 `boss_race.ts:1979`
 *     同款）；纯函数只读这个布尔，**不读** `invulnerableUntilTick`（那是
 *     tick 数，绝不能当布尔判 `if (invulnerableUntilTick)`）。接线时无需
 *     额外传 `invulnerable`，自动与服务端 tick 轴同步。
 *   - `hidden` 弹已在 `buildBossRaceFrame` 被过滤，不在 `frame.bullets` 里，
 *     本函数只遍历 `frame.bullets`，天然不会为它们报擦弹。
 *
 * 去重与节流：
 *   - `seen` 对应权威 `LiveBullet.grazed`：一颗弹只报一次，直到它从 frame
 *     消失；消失后从 `seen` 剔除，将来重新出现可再报（当作新的一颗弹）。
 *   - 返回的新 `seen = (旧 seen ∩ 本帧仍存在的 id) ∪ 本次返回的 ids`，
 *     即剔除已消失弹，内存不随对局无限增长。
 *   - `maxPerFrame`（默认 4）只限制**单帧**返回数量，防止密集弹幕一帧几十个
 *     音效；按 bulletId 去重本身就是跨帧节流。这是**逻辑层**节流，与播放层
 *     的 `SfxThrottle`（按 category 的 83ms 窗口）职责不同、不冲突：本层不
 *     叠加任何时间窗口，也不绕过播放层窗口。被该上限抑制的弹不进 `seen`，
 *     下一显示帧仍是「新进入」。
 *
 * 纯函数：只读 `frame` / `seen`，不修改任何入参；零环境依赖（不碰 Laya、
 * 不碰网络、不读时间戳）。
 */

import type { BossRaceFrame } from './boss_race_view_model';

/** 单帧最多返回的擦弹音效数（默认），防止密集弹幕一帧几十个 SE 同时炸开。 */
const DEFAULT_MAX_PER_FRAME = 4;

export interface GrazeFeedbackOptions {
  /** 本地玩家的 battle roster id；决定用 `players[]` 里哪一个判定点。 */
  localPlayerId: string;
  /** 上一显示帧返回的 `seen`；缺省 = 第一次调用。只读，不会被修改。 */
  seen?: ReadonlySet<string>;
  /** 无敌帧内显式抑制（与权威一致，避免无敌帧刷音）。 */
  invulnerable?: boolean;
  /** 单帧返回上限，默认 4；`<= 0` = 本帧不返回。 */
  maxPerFrame?: number;
}

export interface GrazeFeedbackResult {
  /** 本帧新进入擦弹圈、应即时播音效的 bulletId（已去重、已限流）。 */
  ids: string[];
  /** 供下一显示帧传入的新 `seen`（已剔除消失弹，含本次 `ids`）。 */
  seen: Set<string>;
}

/**
 * 判一次补帧 frame 的新擦弹。返回的 `seen` 必须回灌给下一显示帧，
 * 否则去重链断开、同一颗弹会在每一帧重复播音效。
 */
export function computeInterpolatedGrazes(
  frame: BossRaceFrame,
  options: GrazeFeedbackOptions,
): GrazeFeedbackResult {
  const ids: string[] = [];

  // 本帧可见弹 id（hidden 弹已在 buildBossRaceFrame 被过滤，不在此集合）。
  const currentIds = new Set<string>();
  for (const bullet of frame.bullets) {
    currentIds.add(bullet.bulletId);
  }

  // 新 seen 起点：旧 seen 中本帧仍存在的 id —— 剔除已消失弹，避免内存增长，
  // 并让「消失后重新出现」的弹可以再次报告。
  const nextSeen = new Set<string>();
  if (options.seen !== undefined) {
    for (const id of options.seen) {
      if (currentIds.has(id)) {
        nextSeen.add(id);
      }
    }
  }

  const local = frame.players.find((player) => player.playerId === options.localPlayerId);
  // 卫兵：无本地玩家 / 判定系统未启用 / 擦弹圈半径<=0 / 无敌帧内，一律零擦弹。
  // ★ judgmentActive 必须显式判：boss_race_view_model.ts:298 在关闭时把
  //   grazeRadiusPx 置 0；若只靠半径>0 判断，遇到「关闭但仍带非零半径」的
  //   数据会退化成 (bullet.radius+0)²，把命中圈误判成擦弹。
  if (
    local === undefined ||
    !local.judgmentActive ||
    local.grazeRadiusPx <= 0 ||
    options.invulnerable === true ||
    local.invulnerable === true
  ) {
    // 抑制时仍返回清理过的 seen（剔除已消失弹），保证跨帧状态不串。
    return { ids, seen: nextSeen };
  }

  const configured = options.maxPerFrame ?? DEFAULT_MAX_PER_FRAME;
  const limit = Number.isFinite(configured)
    ? Math.max(0, Math.floor(configured))
    : DEFAULT_MAX_PER_FRAME;

  const px = local.position.x;
  const py = local.position.y;
  const grazeRadiusPx = local.grazeRadiusPx;

  for (const bullet of frame.bullets) {
    if (ids.length >= limit) {
      break;
    }
    if (!bullet.ownerIsLocal || nextSeen.has(bullet.bulletId)) {
      continue;
    }
    // 与服务端同构的距离平方判定（像素域；尺度无关，等价整数 milli 域）。
    const dx = bullet.position.x - px;
    const dy = bullet.position.y - py;
    const distanceSquared = dx * dx + dy * dy;
    const grazeRadius = bullet.radius + grazeRadiusPx;
    if (distanceSquared <= grazeRadius * grazeRadius) {
      ids.push(bullet.bulletId);
      nextSeen.add(bullet.bulletId);
    }
  }

  return { ids, seen: nextSeen };
}
