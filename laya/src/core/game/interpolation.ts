/**
 * 渲染插值层（引擎无关、零依赖、Node 直测）。
 *
 * 设计真值：`DANMAKU_CLIENT_ENGINE_PLAN.md` §2.9（冻结公式）。
 *
 *  - 客户端时钟 **64 tick/s**；渲染取 `render_tick = last_snapshot_tick + frac`
 *    （`frac ∈ [0,1)`，由调用方按墙钟算出）。
 *  - **有速度的实体**（弹幕）：`pos = p_n + v_n * frac` —— 与服务端逐 tick 积分
 *    同式，`v_n` 取 tick N 快照里的 vx/vy。
 *  - **无速度的实体**（玩家 / Boss）：`pos = p_n + (p_{n+1} - p_n) * frac` ——
 *    调用方传入相邻两个权威快照的同一实体位置。
 *  - **朝向**：最短弧插值（350° → 10° 走 +20°，不绕 −340°）。
 *
 * 纯函数：不读时钟、不持状态、不 import 任何模块（`core/math/float_lib` 也不
 * 依赖，保持这一层可以被任何渲染器/测试复用）。
 */

export interface InterpPoint {
  x: number;
  y: number;
}

/** `frac` 归一到 `[0,1)`：NaN/负数 → 0，`>= 1` 折回 0（下一个 tick 的起点）。 */
export function normalizeFrac(frac: number): number {
  if (!Number.isFinite(frac) || frac <= 0) {
    return 0;
  }
  const whole = Math.floor(frac);
  return frac - whole;
}

/**
 * 有速度实体：`p_n + v_n * frac`（冻结公式）。
 *
 * 弹幕的运动学完全由速度决定，所以外推不会引入与服务端积分不同的路径——
 * 服务端下一 tick 的位置就是这条式子的 `frac = 1` 端点。
 */
export function interpolatePos(position: InterpPoint, velocity: InterpPoint, frac: number): InterpPoint {
  const t = Number.isFinite(frac) ? frac : 0;
  return {
    x: position.x + velocity.x * t,
    y: position.y + velocity.y * t,
  };
}

/** 无速度实体：`p_n + (p_{n+1} - p_n) * frac`（差分插值）。 */
export function interpolateBetween(previous: InterpPoint, next: InterpPoint, frac: number): InterpPoint {
  const t = Number.isFinite(frac) ? frac : 0;
  return {
    x: previous.x + (next.x - previous.x) * t,
    y: previous.y + (next.y - previous.y) * t,
  };
}

/**
 * 无速度实体但已知「上一 tick 位移」时：`p_n + (p_n - p_{n-1}) * frac`。
 *
 * 这是 §2.9 差分插值在 `p_{n+1}` 还没到达时的唯一可行写法：渲染基准必须是
 * **当前权威 tick**（`frac = 0` 必须逐像素等于快照位置，见 §4.1 的 tick 边界
 * 断言），所以不能用「上一份快照 → 本份快照」的滞后插值，只能拿最近一次位移
 * 前向外推。下一份快照到达后位置会被校正，误差上限 = 一 tick 的加速度位移。
 */
export function extrapolatePos(position: InterpPoint, previous: InterpPoint, frac: number): InterpPoint {
  const t = Number.isFinite(frac) ? frac : 0;
  return {
    x: position.x + (position.x - previous.x) * t,
    y: position.y + (position.y - previous.y) * t,
  };
}

/** 角度归一到 `[0, 360)`；非有限值按 0 处理。 */
export function normalizeAngleDeg(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) {
    return 0;
  }
  const wrapped = angleDeg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * 角度最短弧插值（度）。
 *
 * 把 `next - previous` 归到 `(-180, 180]`，沿这条更短的弧走 `frac`，结果归一到
 * `[0, 360)`。因此 `350° → 10°` 在 `frac = 0.5` 时是 `0°`（等价 360°），
 * 即「走 +20°」，而不是反方向绕 −340°。
 */
export function interpolateAngleDeg(previousDeg: number, nextDeg: number, frac: number): number {
  const from = normalizeAngleDeg(previousDeg);
  const to = normalizeAngleDeg(nextDeg);
  const t = Number.isFinite(frac) ? frac : 0;
  let delta = to - from;
  if (delta > 180) {
    delta -= 360;
  } else if (delta <= -180) {
    delta += 360;
  }
  return normalizeAngleDeg(from + delta * t);
}
