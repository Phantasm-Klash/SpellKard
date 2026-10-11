/**
 * 统一浮点库 —— 客户端**全部**确定性算术的唯一入口。
 *
 * 为什么必须只有一份
 * ------------------
 * 客户端既要做**权威重放**（`BossRaceSimulation` 镜像服务端逐 tick 状态，用来比对
 * `CanonicalStateHash`），又要做**插值表现**（`interpolateFrames` 在服务端 tick
 * 之间补帧）。如果这两条路径各自用不同的三角/取整/单位换算，那么「面板上看到的
 * 弹幕位置」和「服务端权威位置」会系统性错开 —— 这正是「客户端插帧和渲染和服务端
 * 面板不匹配」的根因。所以本模块是唯一来源：模拟层、插值层、渲染层都从这里取算术。
 *
 * 语义对齐 C++（`PhK-BattleServer/src/danmaku/bullet_motion.cpp` 等）
 * ----------------------------------------------------------------
 *  - **f64 主体**：C++ `double` = JS `number`，直接对应，无需包装。
 *  - **f32 收窄**：C++ `SpawnCommand` 的 `float` 字段（`base_angle_deg` /
 *    `spread_or_speed` / `spawn_x` / `spawn_y` / `f24`…）在写入时经历
 *    `static_cast<float>`。JS 没有 float32 数值类型，必须显式 `Math.fround`，
 *    否则 `EmitRadial` 读回的 `base_angle_deg` 会比服务端多出 double 尾数，
 *    角度 → `cos/sin` → 位置逐 tick 漂移。见 {@link f32}。
 *  - **角度单位 = 度**（原版 `MyMathUtil::sin/cos` 入参即度）。
 *  - **`NormalizeDeg` 用 `fmod`**（截断余数，符号随被除数），不是 `Math.floor` 取模。
 *  - **`llround` 半值远离零**（`std::llround`），不是 JS `Math.round` 的「半值向 +∞」。
 *    两者只在 `-N.5` 上不同：`llround(-0.5) = -1` 而 `Math.round(-0.5) = -0`。
 *
 * 单位与坐标
 * ----------
 *  - 服务端**权威**坐标是整数 milli（1/1000 px），但**运动学在像素浮点里跑**
 *    （原版场地 640×960），只在快照/哈希边界 `llround` 一次。见 {@link toMilli}。
 *  - 屏幕坐标系：原点左上，+x 右，+y 下，中心 `(320, 480)`。
 */

/** `kPi`，与 `bullet_motion.hpp` 的常量同值。 */
export const PI = 3.14159265358979323846;

/** 度 → 弧度。 */
export const DEG_TO_RAD = PI / 180;

/** 弧度 → 度。 */
export const RAD_TO_DEG = 180 / PI;

/** 2π。 */
export const TWO_PI = PI * 2;

// --- 类型收窄 ---------------------------------------------------------------

/**
 * C++ `static_cast<float>`：把 f64 收窄到 IEEE-754 binary32 再放回 f64。
 *
 * 凡是服务端把值写进 `SpawnCommand`（96 字节 POD，字段类型 `float`）的地方，
 * 客户端都必须过这一层。`Math.fround(double(x))` 与 C++ `(float)x` 结果相同：
 * double 的精度远高于 float，先取最近 double 再取最近 float 等价于直接取最近 float。
 */
export function f32(value: number): number {
  return Math.fround(value);
}

/** C++ `static_cast<double>`：JS `number` 已是 f64，恒等（保留以示意图）。 */
export function f64(value: number): number {
  return value;
}

// --- 三角（度） -------------------------------------------------------------

/** `sin(deg)` —— 对应原版 `MyMathUtil::sin`（入参为度）。 */
export function sinDeg(deg: number): number {
  return Math.sin(deg * DEG_TO_RAD);
}

/** `cos(deg)` —— 对应原版 `MyMathUtil::cos`（入参为度）。 */
export function cosDeg(deg: number): number {
  return Math.cos(deg * DEG_TO_RAD);
}

// --- 角度归一化 -------------------------------------------------------------

/**
 * C `std::fmod`：截断除法余数，结果符号跟随被除数。
 *
 * JS 的 `%` 对浮点就是 `fmod` 语义，但显式包一层可让「这里刻意不是 floor-mod」
 * 在调用点可读，并给归一化一个单一实现。
 */
export function fmod(a: number, b: number): number {
  return a % b;
}

/** `NormalizeDeg`：`fmod(deg, 360)` 后归到 `[0, 360)`。 */
export function normalizeDeg(deg: number): number {
  let value = fmod(deg, 360);
  if (value < 0) {
    value += 360;
  }
  return value;
}

/** `AngleToPoint`：从 `(x, y)` 指向 `(tx, ty)` 的角度（度，`[0, 360)`）。 */
export function angleToPoint(x: number, y: number, tx: number, ty: number): number {
  return normalizeDeg(Math.atan2(ty - y, tx - x) * RAD_TO_DEG);
}

// --- 取整 -------------------------------------------------------------------

/**
 * `std::llround`：四舍五入，`.5` 远离零，返回整数。
 *
 * `Math.round(-0.5)` 得 `-0`（半值向 +∞），而 `llround(-0.5)` 得 `-1`。
 * 服务端每个 tick 都用它把像素位置折成 milli，差异会直接落进 `CanonicalStateHash`。
 */
export function llround(value: number): number {
  return value >= 0 ? Math.round(value) : -Math.round(-value);
}

// --- 像素 ⇄ milli -----------------------------------------------------------

/** 1 px = 1000 milli（服务端 `kMilliPerPixel`）。 */
export const MILLI_PER_PIXEL = 1000;

/** 屏幕中心 X（px）。 */
export const SCREEN_CENTER_X_PX = 320;

/** 屏幕中心 Y（px）。 */
export const SCREEN_CENTER_Y_PX = 480;

/** 屏幕宽（px）—— 原版场地 640。 */
export const SCREEN_W_PX = 640;

/** 屏幕高（px）—— 原版场地 960。 */
export const SCREEN_H_PX = 960;

/** 场地半宽（px）—— `bullet_motion.cpp` 的 `kHalfW`。 */
export const HALF_W_PX = 320;

/** 场地半高（px）—— `bullet_motion.cpp` 的 `kHalfH`。 */
export const HALF_H_PX = 480;

/** 顶边留白（px）—— `bullet_motion.cpp` 的 `kTop`。 */
export const TOP_MARGIN_PX = 40;

/** `ToMilli(pixels)` = `llround(pixels * 1000)`。 */
export function toMilli(pixels: number): number {
  return llround(pixels * MILLI_PER_PIXEL);
}

/** `ToPixels(milli)` = `milli / 1000`。 */
export function toPixels(milli: number): number {
  return milli / MILLI_PER_PIXEL;
}

/** 屏幕系像素 X → 以场地中心为原点的 milli（服务端 `ToMilli(x - kScreenCenterX)`）。 */
export function screenXToMilli(xPx: number): number {
  return toMilli(xPx - SCREEN_CENTER_X_PX);
}

/** 屏幕系像素 Y → 以场地中心为原点的 milli（服务端 `ToMilli(y - kScreenCenterY)`）。 */
export function screenYToMilli(yPx: number): number {
  return toMilli(yPx - SCREEN_CENTER_Y_PX);
}

/** 以场地中心为原点的 milli X → 屏幕系像素。 */
export function milliToScreenX(xMilli: number): number {
  return SCREEN_CENTER_X_PX + toPixels(xMilli);
}

/** 以场地中心为原点的 milli Y → 屏幕系像素。 */
export function milliToScreenY(yMilli: number): number {
  return SCREEN_CENTER_Y_PX + toPixels(yMilli);
}

// --- 插值 -------------------------------------------------------------------

/**
 * 线性插值 —— 插值层唯一允许的补帧算术。
 *
 * 与模拟层共用同一套浮点语义，保证「补出来的中间帧」落在两端权威位置的连线上，
 * 不会因换一种写法（例如先取整再插值）而相对服务端面板偏移。
 */
export function lerpF64(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 把 `t` 夹到 `[0, 1]`。 */
export function clamp01(t: number): number {
  if (t < 0) {
    return 0;
  }
  if (t > 1) {
    return 1;
  }
  return t;
}
