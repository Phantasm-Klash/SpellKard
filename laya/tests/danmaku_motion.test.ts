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

test('func0 is a no-op on the per-frame path (spawn-only symbol)', () => {
  // ★ 整帧基准：funcNo=0 在 update 跳转表里 index=-1 越界，直接落共用出口
  //   0x50c618，全库没有 `bl bulletFunc0@plt`。独立符号 0x50cdcc 的
  //   A0/V1/X/XC 快照是 **spawn 时**用的，不是逐帧运动。
  const b = createBulletMotion({ angle: 10, angle_init: 90, spd_init2: 4, xacc: 2, xacc_cap: 9 });
  step(b, 0);
  expectEqual(b.angle, 10, 'angle stays at the spawn value');
  expectEqual(b.speed, 0, 'speed stays at the struct default');
  expectEqual(b.accel, 0, 'spdAcc untouched');
  expectEqual(b.speed_cap, 0, 'speedCap untouched');
  expectClose(b.vy, 0, 1e-12, 'default tail integrates from speed=0');
});

test('func0 leaves a -1 sentinel alone', () => {
  const b = createBulletMotion({ angle: 33 });
  step(b, 0);
  expectEqual(b.angle, 33, 'A0 == -1 means "keep the spawn angle"');
});

test('func5 is gated off in the update dispatch entry (no acceleration)', () => {
  // ★ 0x50b654 入口只有 `ldrb w8,[x19,#1345]; cbz w8, 0x50c618`；
  //   生产端不产生该标志，整段 no-op。独立符号 0x50d250 的 v+=X /
  //   夹到 XC / life-- 不是逐帧路径（整帧实测 speed 恒定）。
  const b = createBulletMotion({ speed: 10, xacc: 2, xacc_cap: 100 });
  step(b, 5, 1);
  expectEqual(b.speed, 10, 'one frame leaves speed alone');
  step(b, 5, 3);
  expectEqual(b.speed, 10, 'still alone after more frames');

  const capped = createBulletMotion({ speed: 99, xacc: 5, xacc_cap: 100 });
  step(capped, 5, 5);
  expectEqual(capped.speed, 99, 'no clamp is applied on the per-frame path');
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

test('func37 uses setPosition (absolute coords) and never writes angle', () => {
  // ★ 整帧基准：func37 走 0x50cafc 二次分派，先 setOpacity 再按常量
  //   -90 做 setPosition 绝对定位；angle/speed 一律不动（C++ 探针
  //   angle=0, x=-1, y=0）。旧的「正弦角」公式是人工翻译错误。
  const b = createBulletMotion({ xacc: 0 });
  step(b, 37, 1);
  expectClose(b.angle, 0, 1e-12, 'angle is untouched');
  expectClose(b.x, -1, 1e-12, 'setPosition pins x to the -90 deg constant');
  expectClose(b.y, 0, 1e-12, 'setPosition pins y');
});

test('func2 (rate-limited homing) turns toward the ship and writes back A0', () => {
  // ★ The server's `RateLimitedTurn` reads `angle_init` as "current", not `angle`.
  const b = createBulletMotion({ life: 1, angle_init: 0, angle_acc: 10 });
  const tg = createMotionTargets({ has_my_ship: true, my_ship_x: 0, my_ship_y: 100 });
  step(b, 2, 1, tg);
  expectClose(b.angle, 10, 1e-12, 'one capped step from A0');
  expectClose(b.angle_init, 10, 1e-12, 'A0 is updated to the new heading');
  step(b, 2, 9, tg);
  // ★ life=1 的 func2 每帧 life--，第一帧后就落进分派入口的 `life<1`
  //   门，后续帧整段跳过；C++ 探针 9 帧后 angle 仍是 10。
  expectClose(b.angle, 10, 1e-12, 'the life gate stops further homing frames');
});

test('func2 does nothing while life < 1', () => {
  const b = createBulletMotion({ life: 0, angle_init: 0, angle_acc: 10 });
  const tg = createMotionTargets({ has_my_ship: true, my_ship_x: 0, my_ship_y: 100 });
  step(b, 2, 1, tg);
  expectEqual(b.angle, 0, 'the spawn angle is untouched');
});

test('func1 mirrors the heading when leaving the 640x960 playfield', () => {
  // ★ 分派入口 0x50b514 有 `life<1` 门；给 life>=1 才能测到反弹本身。
  const b = createBulletMotion({ life: 4, angle: 30, speed: 10, spd_init2: 10, x: 400, y: 100 });
  step(b, 1);
  expectEqual(b.angle, normalizeDeg(180 - 30), 'a = 180 − a');
  expectEqual(b.speed, 10, 'v is untouched (kept at its initial value)');
});

test('func1 leaves an on-screen bullet untouched', () => {
  const b = createBulletMotion({ life: 4, angle: 30, x: 100, y: 100, spd_init2: 7 });
  step(b, 1);
  expectEqual(b.angle, 30);
  // ★ 原版 func1 完全不写 speed/speedCap（旧实现写 V1 会让子弹倒飞）。
  expectEqual(b.speed, 0, 'speed stays at the struct default, not V1');
});

test('func78 mirrors the heading at the top margin (y < 40)', () => {
  // ★ 0x510ea4 逐指令：`a = 360 − a`（不是 180 − a），并 life--；
  //   分派入口 0x50c180 有 `life<1` 门，故用例给 life=4。
  const b = createBulletMotion({ life: 4, angle: 60, x: 100, y: 10 });
  step(b, 78);
  expectEqual(b.angle, 300, 'a = 360 − a');

  const wrapped = createBulletMotion({ life: 4, angle: 210, x: 100, y: 10 });
  step(wrapped, 78);
  expectEqual(wrapped.angle, 150, '360 − 210 = 150');

  // 边界条件是严格 `< 40`，y == 40 不动。
  const below = createBulletMotion({ life: 4, angle: 60, x: 100, y: 500 });
  step(below, 78);
  expectEqual(below.angle, 60, 'below the top margin the heading is untouched');
  const atEdge = createBulletMotion({ life: 4, angle: 60, x: 100, y: 40 });
  step(atEdge, 78);
  expectEqual(atEdge.angle, 60, 'y == 40 is not < 40');
});

test('func61 picks the X-axis cardinal from the ship x comparison', () => {
  // ★ 0x50ffd0 逐指令：p2 偶 → 只比较 pos.x 与 ship.x，pos.x<ship.x → 0°
  //   否则 180°；p2 奇才比较 y（90/270）。默认 p2=0，所以四种 (dx,dy)
  //   只随 dx 变化。C++ 探针：q0/q1=0°，q2/q3=180°。
  const cases: Array<[number, number, number]> = [
    // dx, dy, expected
    [-1, -1, 0],
    [-1, 1, 0],
    [1, 1, 180],
    [1, -1, 180],
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
  // ★ 0x50ea08 逐指令：节拍门 (t-life)%p1==0；p1 奇 → angle = A0 + p2，
  //   p1 偶 → angle = p2 − A0；不归一。旧的「360−(A0−P2)+90 = 435」
  //   来自过时文档，整帧基准实测为 75 / −15。
  const odd = createBulletMotion({ angle_init: 45, p1: 1, p2: 30, spd_init2: 3, xacc_cap: 4 });
  step(odd, 32);
  expectEqual(odd.angle, 45 + 30, 'odd → A0 + P2');
  expectEqual(odd.angle, 75, 'no normalisation');
  expectEqual(odd.speed, 3, 'v = V1');
  expectEqual(odd.speed_cap, 4, 'vc = XC');

  const even = createBulletMotion({ angle_init: 45, p1: 0, p2: 30, spd_init2: 3, xacc_cap: 4 });
  step(even, 32);
  expectEqual(even.angle, 30 - 45, 'even → P2 − A0');
  expectEqual(even.angle, -15, 'negative angles are left as-is');

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
  // ★ func81 是 setPosition 绝对定位，原版**不写 speed / hitDis**；
  //   C++ 探针 speed=0、hitDis=0、x=3.6。旧的「v = V1 + XC·s」是人工推测。
  expectClose(b.speed, 0, 1e-12, 'speed stays at the struct default');
  expectClose(b.hit_dis, 0, 1e-12, 'hitDis is not written');
  // C++ 探针精确值 x=3.5999463379659415（= V1 + XC·p2·cos(pf1)，不是整 3.6）。
  expectClose(b.x, 2.4 + 1.2 * cosDeg(b.pf1), 1e-12, 'setPosition pins x from the sine radius');
});

test('func43 writes hitDis = pf2·v', () => {
  const b = createBulletMotion({ p2: 5, life: 3, spd_init2: 2, xacc: 1, xacc_cap: 90, pf2: 3 });
  step(b, 43);
  const s = 2 + 1 * sinDeg(90 * 0);
  // ★ C++ 探针：speed=0（struct 默认），hitDis = pf2·v = 3·2 = 6。
  expectClose(b.speed, 0, 1e-12, 'speed is untouched by func43');
  expectClose(b.hit_dis, 3 * s, 1e-12, 'hitDis = pf2·(V1 + X·sin(XC·(p2−life)))');
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

test('the frame tail decrements bullet_life (gates the NEXT frame clamp)', () => {
  // ★ 原版 0x50cc84：帧末 bulletLife--（>0 时）。这是 p1/p2 多初值档
  //   大批差异的系统性根因：漏掉它会让每一帧都做 angle 夹持。
  const b = createBulletMotion({ bullet_life: 2, angle: 10, angle_acc: 5, f56c: 0, angle_spd: 0 });
  const tg = createMotionTargets();
  b.bullet_func_no = 0;   // 逐帧 no-op，只观察前处理与帧末递减
  updateBulletMotion(b, tg, noRng());
  expectEqual(b.bullet_life, 1, 'first frame consumes one bullet_life');
  expectEqual(b.angle, 15, 'angle += aa on the first frame');
  updateBulletMotion(b, tg, noRng());
  expectEqual(b.bullet_life, 0, 'second frame consumes the last one');
  expectEqual(b.angle, 20, 'angle += aa again on the second frame');
  updateBulletMotion(b, tg, noRng());
  expectEqual(b.bullet_life, 0, 'does not go negative');
  expectEqual(b.angle, 20, 'no angle integration once bullet_life is zero');
});

test('unknown func numbers are rejected by the dispatch table', () => {
  // 0 是真实编号（逐帧 no-op，但仍可分派）。
  const b = createBulletMotion();
  expectEqual(applyBulletFunc(b, createMotionTargets(), noRng()), true, 'func 0 is dispatchable');
  b.bullet_func_no = 999;
  expectEqual(applyBulletFunc(b, createMotionTargets(), noRng()), false, '999 is rejected');
  expectEqual(isKnownBulletFunc(999), false);
  expectEqual(isKnownBulletFunc(85), true);
  // 整帧基准覆盖 86 个 funcNo 后，仍有 6 个编号无独立实现：9/10/49/56/68/69；
  // 59 是共用出口内联（t1<life 时 angle+=1），已经是可分派的已知编号。
  expectEqual(isKnownBulletFunc(9), false, '9 is a gap');
  expectEqual(isKnownBulletFunc(49), false, '49 is a gap');
  expectEqual(isKnownBulletFunc(56), false, '56 is a gap');
  expectEqual(isKnownBulletFunc(59), true, '59 is the shared-exit inline branch');
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
