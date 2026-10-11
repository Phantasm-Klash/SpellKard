/**
 * 千夜追忆运动学移植测试 —— 针对 `bullet_motion.cpp` 的逐函数镜像。
 *
 * 这些测试锁定的是**与服务端逐位一致**这件事，因此断言的是 C++ 里那条具体公式，
 * 而不是「大致像追踪/像正弦」：
 *  - 分派、条件极性、常量（320/480/40、±90、0.6、0.03…）；
 *  - `updateBulletMotion` 的**分工**：不移动位置、不递增 `life`；
 *  - `DeterministicRng` 的字节级材料（期望值由独立 Python 复算得出，见文件末注）。
 */

import {
  DeterministicRng,
  applyBulletFunc,
  createBulletMotion,
  createMotionTargets,
  isKnownBulletFunc,
  integrateVelocity,
  knownBulletMotionFuncs,
  normalizeDeg,
  sinDeg,
  cosDeg,
  updateBulletMotion,
  type BulletMotion,
  type MotionTargets,
} from '../src/core/sim/danmaku/bullet_motion';
import { bossRaceSeedFromHex } from '../src/core/math/boss_race_seed';
import { expect, expectClose, expectEqual, suite, test } from './harness';

/** 空 RNG（绝大多数 func 不消耗随机序列）。 */
function noRng(): DeterministicRng {
  return new DeterministicRng(0, 0, 0, 0);
}

/** 推进 `count` 帧，返回被改动的状态。 */
function step(
  b: BulletMotion,
  func: number,
  count = 1,
  tg: MotionTargets = createMotionTargets(),
): BulletMotion {
  b.bullet_func_no = func;
  for (let i = 0; i < count; i += 1) {
    updateBulletMotion(b, tg, noRng());
  }
  return b;
}

suite('danmaku kinematics (server port)');

test('degrees trig helpers match the unit circle', () => {
  expectClose(sinDeg(90), 1, 1e-12, 'sin 90');
  expectClose(cosDeg(0), 1, 1e-12, 'cos 0');
  expectClose(cosDeg(180), -1, 1e-12, 'cos 180');
  expectClose(sinDeg(-90), -1, 1e-12, 'sin -90');
  expectEqual(normalizeDeg(-90), 270);
  expectEqual(normalizeDeg(450), 90);
});

test('the default state matches the C++ struct member initialisers', () => {
  const b = createBulletMotion();
  // `Func0` gates on `!= -1`, so these defaults are load-bearing.
  expectEqual(b.angle_init, -1, 'A0 defaults to the -1 sentinel');
  expectEqual(b.speed_init, -1, 'V0 defaults to the -1 sentinel');
  expectEqual(b.spd_init2, -1, 'V1 defaults to the -1 sentinel');
  expectEqual(b.xacc, 0, 'X defaults to 0.0 (NOT -1)');
  expectEqual(b.xacc_cap, 0, 'XC defaults to 0.0 (NOT -1)');
  expectEqual(b.pf1, 1, 'pf1 defaults to 1.0');
  expectEqual(b.pf2, 0, 'pf2 defaults to 0.0');
  expectEqual(b.hit_dis, 0, 'hitDis defaults to 0.0 — real-danmaku bullets start with no radius');
  expectEqual(b.hit_hantei, true);
  expectEqual(b.life, 0);
});

test('func0 (linear init) applies the A0/V0/V1/X/XC snapshot', () => {
  const b = createBulletMotion({ angle: 10, angle_init: 90, spd_init2: 4, xacc: 2, xacc_cap: 9 });
  step(b, 0);
  expectEqual(b.angle, 90, 'a = A0');
  expectEqual(b.speed, 4, 'v = V1');
  expectEqual(b.accel, 2, 'va = X');
  expectEqual(b.speed_cap, 9, 'vc = XC');
  expectClose(b.vy, 4 * sinDeg(90), 1e-12, 'the tail recomputes vx/vy');
});

test('func0 leaves a -1 sentinel alone', () => {
  const b = createBulletMotion({ angle: 33 });
  step(b, 0);
  expectEqual(b.angle, 33, 'A0 == -1 means "keep the spawn angle"');
});

test('func5 accelerates toward the cap and clamps there', () => {
  const b = createBulletMotion({ speed: 10, xacc: 2, xacc_cap: 100 });
  step(b, 5, 1);
  expectEqual(b.speed, 12);
  step(b, 5, 3);
  expectEqual(b.speed, 18);

  const capped = createBulletMotion({ speed: 99, xacc: 5, xacc_cap: 100 });
  step(capped, 5, 5);
  expectEqual(capped.speed, 100, 'speed must not exceed XC');
});

test('func5 with a zero X is a no-op', () => {
  const b = createBulletMotion({ speed: 10, xacc: 0, xacc_cap: 100 });
  step(b, 5, 3);
  expectEqual(b.speed, 10);
});

test('func25 (sine speed) v = V1 + XC·sin(A0 + X·T)', () => {
  // ★ `t` belongs to the HOST: the server's `AdvanceBullets` does `t += 1.0`
  //   *after* `UpdateBulletMotion`, which itself never bumps `t`. So this test
  //   has to advance `t` by hand, exactly the way the host does.
  const b = createBulletMotion({ spd_init2: 5, xacc_cap: 2, angle_init: 0, xacc: 1 });
  b.bullet_func_no = 25;
  const hostFrame = (): void => {
    updateBulletMotion(b, createMotionTargets(), noRng());
    b.t += 1;
  };
  hostFrame();
  expectClose(b.speed, 5, 1e-12, 'sin(0) = 0 ⇒ speed stays V1');
  hostFrame();
  expectClose(b.speed, 5 + 2 * sinDeg(1), 1e-12, 'speed at T=1');
  hostFrame();
  expectClose(b.speed, 5 + 2 * sinDeg(2), 1e-12, 'speed at T=2');
});

test('func37 (sine angle) a = 75·sin(L + X·T − 90) + 180', () => {
  const b = createBulletMotion({ xacc: 0 });
  step(b, 37, 1);
  expectClose(b.angle, 75 * sinDeg(-90) + 180, 1e-12, 'angle at L=0,T=0');
  expectClose(b.angle, 105, 1e-12, 'sin(-90) = -1 ⇒ 105');
});

test('func2 (rate-limited homing) turns toward the ship and writes back A0', () => {
  // ★ The server's `RateLimitedTurn` reads `angle_init` as "current", not `angle`.
  const b = createBulletMotion({ life: 1, angle_init: 0, angle_acc: 10 });
  const tg = createMotionTargets({ has_my_ship: true, my_ship_x: 0, my_ship_y: 100 });
  step(b, 2, 1, tg);
  expectClose(b.angle, 10, 1e-12, 'one capped step from A0');
  expectClose(b.angle_init, 10, 1e-12, 'A0 is updated to the new heading');
  step(b, 2, 9, tg);
  expectClose(b.angle, 90, 1e-12, 'converges on the target');
});

test('func2 does nothing while life < 1', () => {
  const b = createBulletMotion({ life: 0, angle_init: 0, angle_acc: 10 });
  const tg = createMotionTargets({ has_my_ship: true, my_ship_x: 0, my_ship_y: 100 });
  step(b, 2, 1, tg);
  expectEqual(b.angle, 0, 'the spawn angle is untouched');
});

test('func1 mirrors the heading when leaving the 640x960 playfield', () => {
  const b = createBulletMotion({ angle: 30, speed: 10, spd_init2: 10, x: 400, y: 100 });
  step(b, 1);
  expectEqual(b.angle, normalizeDeg(180 - 30), 'a = 180 − a');
  expectEqual(b.speed, 10, 'v = V1');
});

test('func1 leaves an on-screen bullet untouched', () => {
  const b = createBulletMotion({ angle: 30, x: 100, y: 100, spd_init2: 7 });
  step(b, 1);
  expectEqual(b.angle, 30);
  expectEqual(b.speed, 7, 'the tail still restores v = V1');
});

test('func78 mirrors the heading at the top margin (y < 40)', () => {
  // ★ bulletFunc78 @0x510e88 是 `a = 180 − a`（不是 func32 的 `360 − a + 90`）。
  const b = createBulletMotion({ angle: 60, x: 100, y: 10 });
  step(b, 78);
  expectEqual(b.angle, 120, 'a = 180 − a');

  // 负角由 `+360` 回卷。
  const wrapped = createBulletMotion({ angle: 210, x: 100, y: 10 });
  step(wrapped, 78);
  expectEqual(wrapped.angle, 330, '180 − 210 = −30 ⇒ +360');

  // 边界条件是严格 `< 40`，y == 40 不动。
  const below = createBulletMotion({ angle: 60, x: 100, y: 500 });
  step(below, 78);
  expectEqual(below.angle, 60, 'below the top margin the heading is untouched');
  const atEdge = createBulletMotion({ angle: 60, x: 100, y: 40 });
  step(atEdge, 78);
  expectEqual(atEdge.angle, 60, 'y == 40 is not < 40');
});

test('func61 picks one of four cardinal headings from the ship quadrant', () => {
  const cases: Array<[number, number, number]> = [
    // dx, dy, expected
    [-1, -1, 90],
    [-1, 1, 180],
    [1, 1, 270],
    [1, -1, 0],
  ];
  for (const [dx, dy, expected] of cases) {
    const b = createBulletMotion({ x: dx, y: dy, spd_init2: 3, xacc_cap: 5 });
    const tg = createMotionTargets({ has_my_ship: true, my_ship_x: 0, my_ship_y: 0 });
    step(b, 61, 1, tg);
    expectEqual(b.angle, expected, `dx=${dx} dy=${dy}`);
    expectEqual(b.speed, 3, 'v = V1');
    expectEqual(b.speed_cap, 5, 'vc = XC');
  }
});

test('func32 mirrors by the P1 parity bit', () => {
  // ★ bulletFunc32 @0x50ea08 —— 只在 `T == 0` 生效，且**不做角度归一化**。
  //   服务端的 `NormalizeDeg` 只出现在发射期（emitter.cpp / pattern_timeline.cpp）
  //   与 `AngleToPoint`，逐函数运动学一律原样写角（cos/sin 对 435° 与 75° 同值）。
  const odd = createBulletMotion({ angle_init: 45, p1: 1, p2: 30, spd_init2: 3, xacc_cap: 4 });
  step(odd, 32);
  expectEqual(odd.angle, 360 - (45 - 30) + 90, 'odd → 360 − (A0 − P2) + 90');
  expectEqual(odd.angle, 435, 'the server leaves it un-normalised');
  expectEqual(odd.speed, 3, 'v = V1');
  expectEqual(odd.speed_cap, 4, 'vc = XC');

  const even = createBulletMotion({ angle_init: 45, p1: 0, p2: 30, spd_init2: 3, xacc_cap: 4 });
  step(even, 32);
  expectEqual(even.angle, 15, 'even → A0 − P2');

  const late = createBulletMotion({ angle_init: 45, p1: 1, p2: 30 });
  late.t = 3;
  step(late, 32);
  expectEqual(late.angle, 0, 'the func only fires on the spawn frame');
});

test('func81 writes pf1/hitDis/speed from the same sine term', () => {
  const b = createBulletMotion({
    angle_init: 0.5,
    f598: 0.6,
    prev_angle: 4,
    xacc_cap: 1.2,
    p2: 1,
    spd_init2: 2.4,
    pf2: 0,
  });
  step(b, 81);
  const s = sinDeg(4 * 1);
  expectClose(b.pf1, 0.5 + 0.6 * s, 1e-12, 'pf1 = A0 + F98·sin(PA·P2)');
  expectClose(b.speed, 2.4 + 1.2 * s, 1e-12, 'v = V1 + XC·s');
  expectClose(b.hit_dis, 0 * b.pf1, 1e-12, 'hitDis = pf2·pf1');
});

test('func43 writes hitDis = pf2·v', () => {
  const b = createBulletMotion({ p2: 5, life: 3, spd_init2: 2, xacc: 1, xacc_cap: 90, pf2: 3 });
  step(b, 43);
  const s = 2 + 1 * sinDeg(90 * 0);
  expectClose(b.speed, s, 1e-12);
  expectClose(b.hit_dis, 3 * s, 1e-12);
});

test('the integration tail recomputes vx/vy from angle and speed', () => {
  const b = createBulletMotion({ angle: 90, speed: 10 });
  integrateVelocity(b);
  expectClose(b.vx, 10 * cosDeg(90), 1e-12, 'vx');
  expectClose(b.vy, 10 * sinDeg(90), 1e-12, 'vy');
});

test('updateBulletMotion never moves the bullet and never bumps life', () => {
  // ★ This is the server's division of labour: `EnemyBullet::update` only rewrites
  // kinematics; `AdvanceBullets` does `pos += (vx, vy)` and `t += 1`. The client
  // used to also do `life += 1` here, which sent every `L`-gated func down the
  // wrong branch.
  const b = createBulletMotion({ angle: 0, speed: 10, x: 5, y: 7, spd_init2: 10 });
  step(b, 0, 5);
  expectEqual(b.x, 5, 'x is untouched by the kinematics step');
  expectEqual(b.y, 7, 'y is untouched');
  expectEqual(b.life, 0, 'life is never incremented by the port');
  expectEqual(b.t, 0, 't is the host\'s job too');
});

test('the delay countdown consumes a frame without moving', () => {
  const b = createBulletMotion({ delay: 2, angle: 0, speed: 10, spd_init2: 10 });
  step(b, 0);
  expectEqual(b.delay, 1, 'the delay ticks down');
  expectEqual(b.vx, 0, 'and no velocity integration happened');
  step(b, 0);
  expectEqual(b.delay, 0);
  step(b, 0);
  expectEqual(b.vx, 10, 'the third frame integrates normally');
});

test('bullet_life gates the angle integration and the f56c clamp', () => {
  const b = createBulletMotion({ bullet_life: 1, angle: 0, angle_acc: 5, f56c: 3, angle_spd: 1 });
  step(b, 0);
  // angle += aa (5), then clamped to f56c + w (4).
  expectEqual(b.angle, 4, 'the positive f56c clamp applies');
});

test('unknown func numbers are rejected by the dispatch table', () => {
  // 0 是**真实存在**的 func（Func0 = 线性初始化），必须分派成功。
  const b = createBulletMotion();
  expectEqual(applyBulletFunc(b, createMotionTargets(), noRng()), true, 'func 0 is dispatchable');
  b.bullet_func_no = 999;
  expectEqual(applyBulletFunc(b, createMotionTargets(), noRng()), false, '999 is rejected');
  expectEqual(isKnownBulletFunc(999), false);
  expectEqual(isKnownBulletFunc(85), true);
  // 1..85 里有 6 个空洞（服务端 switch 里没有 case）：9/10、49、56、59、68/69。
  expectEqual(isKnownBulletFunc(9), false, '9 is a gap');
  expectEqual(isKnownBulletFunc(49), false, '49 is a gap');
  expectEqual(isKnownBulletFunc(56), false, '56 is a gap');
  expectEqual(isKnownBulletFunc(86), false, '86 is past the table');
});

test('every registered motion func is dispatchable', () => {
  for (const func of knownBulletMotionFuncs()) {
    expect(isKnownBulletFunc(func), `func ${func} should be dispatchable`);
    const b = createBulletMotion({ bullet_func_no: func });
    expectEqual(applyBulletFunc(b, createMotionTargets(), noRng()), true, `func ${func} dispatched`);
  }
});

test('the same inputs produce identical frame-by-frame output (determinism)', () => {
  const run = (): number[] => {
    const b = createBulletMotion({ angle: 37, speed: 7, xacc: 1, xacc_cap: 20, spd_init2: 7 });
    const tg = createMotionTargets({ has_my_ship: true, my_ship_x: 10, my_ship_y: 20 });
    const trace: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      updateBulletMotion(b, tg, noRng());
      b.x += b.vx;
      b.y += b.vy;
      b.t += 1;
      trace.push(b.x, b.y, b.speed);
    }
    return trace;
  };
  expectEqual(JSON.stringify(run()), JSON.stringify(run()));
});

suite('danmaku deterministic rng');

/**
 * 期望值由一份**独立**的 Python 复算给出（任意精度整数，逐字节喂 FNV-1a），
 * 不是从本实现反抄的：
 *
 * ```python
 * h = 2166136261
 * for v in (seed, tick, pattern, spawn, counter):
 *     for i in range(8):
 *         h = ((h ^ ((v >> (8*i)) & 0xff)) * 16777619) & 0xffffffff
 * # then the Mix32 avalanche
 * ```
 */
test('NextU32 reproduces the server byte-mixing for a real lobby seed', () => {
  // server_seed_hex = 5d4db41532808f4b
  const seed = bossRaceSeedFromHex('5d4db41532808f4b');

  const r0 = new DeterministicRng(seed, 45, 0, 3);
  expectEqual(r0.nextU32(), 394483151, 'counter 0');

  const r1 = new DeterministicRng(seed, 90, 2, 7);
  expectEqual(r1.nextU32(), 3828467906, 'counter 0, different tick/pattern/spawn');
});

test('NextU32 reproduces the server for narrow and maximal seeds', () => {
  expectEqual(new DeterministicRng(0, 45, 0, 0).nextU32(), 3791268979, 'zero seed, counter 0');

  const second = new DeterministicRng(0, 45, 0, 0);
  second.nextU32();
  expectEqual(second.nextU32(), 2976391538, 'the counter advances the stream');

  // 2 ** 32 — only the high half differs from the zero seed, and the server mixes
  // all eight seed bytes, so this must not collide with the zero seed.
  const wide = new DeterministicRng(bossRaceSeedFromHex('0000000100000000'), 45, 4, 0);
  expectEqual(wide.nextU32(), 1236164782, 'the high seed half reaches the material');

  const max = new DeterministicRng(bossRaceSeedFromHex('ffffffffffffffff'), 7200, 9, 383);
  max.nextU32();
  max.nextU32();
  expectEqual(max.nextU32(), 592867656, 'counter 2');
});

test('randomInt matches the server modulo convention', () => {
  const seed = bossRaceSeedFromHex('5d4db41532808f4b');
  expectEqual(new DeterministicRng(seed, 45, 0, 0).randomInt(0, 360), 203);
  expectEqual(new DeterministicRng(seed, 45, 0, 0).randomInt(-0x50, 0x50), -41);
  // `a > b` swaps, mirroring `DeterministicRng::RandomInt`.
  expectEqual(new DeterministicRng(seed, 45, 0, 0).randomInt(0x50, -0x50), -41);
});
