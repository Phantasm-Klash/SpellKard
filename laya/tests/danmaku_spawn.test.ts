/**
 * `CreateBulletCommand` (96 字节 POD) 与**权威**发射器镜像测试。
 *
 * 发射器现在是 `pattern_timeline.ts` 的 `emitRadial(cmd, tmpl, ctx)` /
 * `emitPatternTick(def, tick, ctx, targets)` —— 逐行对应服务端
 * `src/danmaku/emitter.cpp` + `src/danmaku/pattern_timeline.cpp`。
 *
 * 这里刻意区分两件以前被混为一谈的事：
 *  1. `createBullets1` 的语义是**整圆均分**（`step = 360/count`，起始角
 *     `base - spread`），**不是**「以 base 为中心铺一个扇形」。以前的客户端写了
 *     一个 `f24` 驱动的扇形变体，服务端没有对应物。
 *  2. `SpawnCommand` 的 `float` 字段在写入时经历 `static_cast<float>`，客户端必须
 *     用 `f32` 复刻。
 */

import {
  SPAWN_COMMAND_SIZE_BYTES,
  createSpawnCommand,
  decodeSpawnCommand,
  encodeSpawnCommand,
} from '../src/core/sim/danmaku/spawn_command';
import {
  AimMode,
  bossRacePatternIds,
  bossRacePatternLibraryCached,
  createBulletTemplate,
  emitPatternTick,
  emitRadial,
  radialAngles,
} from '../src/core/sim/danmaku/pattern_timeline';
import { createMotionTargets } from '../src/core/sim/danmaku/bullet_motion';
import { f32, normalizeDeg } from '../src/core/math/float_lib';
import { expect, expectClose, expectEqual, suite, test } from './harness';

suite('spawn command');

test('the struct is exactly 96 bytes', () => {
  expectEqual(SPAWN_COMMAND_SIZE_BYTES, 96);
});

test('encode/decode round-trips every field', () => {
  const command = createSpawnCommand({
    bulletType: 36,
    frameIndex: 3,
    spawnX: 12.5,
    spawnY: -40.25,
    flag16: true,
    baseAngleDeg: 90,
    f24: 30,
    f28: 1,
    f32: 2,
    f36: 3,
    f40: 4,
    count: 16,
    spreadOrSpeed: 5,
    s52: 7,
    s54: 8,
    s56: 9,
    f60: 10,
    f64: 11,
    f68: 12,
    f72: 13,
    f76: 14,
    f80: 15,
    s84: 0,
    s86: 1,
    s88: 2,
    s90: 3,
    s92: 4,
    s94: 5,
  });
  const view = encodeSpawnCommand(command);
  expectEqual(view.byteLength, 96);
  const decoded = decodeSpawnCommand(view);
  expectEqual(decoded.bulletType, 36);
  expectEqual(decoded.frameIndex, 3);
  expectClose(decoded.spawnX, 12.5, 1e-6);
  expectClose(decoded.spawnY, -40.25, 1e-6);
  expectEqual(decoded.flag16, true);
  expectClose(decoded.baseAngleDeg, 90, 1e-6);
  expectClose(decoded.spreadOrSpeed, 5, 1e-6);
  expectEqual(decoded.count, 16);
  expectEqual(decoded.s84, 0);
  expectEqual(decoded.s94, 5);
});

test('fields land at the offsets documented from the disassembly', () => {
  const command = createSpawnCommand({ bulletType: 9, count: 3, baseAngleDeg: 45, spreadOrSpeed: 5 });
  const view = encodeSpawnCommand(command);
  expectEqual(view.getInt32(0, true), 9, 'bulletType @0');
  expectEqual(view.getInt16(44, true), 3, 'count @44');
  expectClose(view.getFloat32(20, true), 45, 1e-6, 'baseAngleDeg @20');
  expectClose(view.getFloat32(48, true), 5, 1e-6, 'spreadOrSpeed @48');
});

suite('radial emitter (createBullets1)');

test('a zero-count command emits nothing', () => {
  const cmd = createSpawnCommand({ count: 0 });
  expectEqual(emitRadial(cmd, createBulletTemplate(), { emitter_x: 0, emitter_y: 0 }).length, 0);
});

test('count shots spread evenly over the full circle', () => {
  const cmd = createSpawnCommand({ bulletType: 36, count: 4, baseAngleDeg: 0, spreadOrSpeed: 0 });
  const shots = emitRadial(cmd, createBulletTemplate({ bullet_kind: 36 }), {
    emitter_x: 0,
    emitter_y: 0,
  });
  expectEqual(shots.length, 4);
  expectEqual(JSON.stringify(shots.map((s) => s.angle)), JSON.stringify([0, 90, 180, 270]));
  for (const shot of shots) {
    expectEqual(shot.bullet_kind, 36);
    expectEqual(shot.x, 0);
    expectEqual(shot.y, 0);
  }
});

test('the sweep starts at base − spread and normalises into [0,360)', () => {
  const cmd = createSpawnCommand({ bulletType: 27, count: 8, baseAngleDeg: 90, spreadOrSpeed: 22.5 });
  const shots = emitRadial(cmd, createBulletTemplate({ bullet_kind: 27 }), {
    emitter_x: 0,
    emitter_y: 0,
  });
  expectClose(shots[0].angle, 67.5, 1e-12, 'start angle');
  expectClose(shots[1].angle, 112.5, 1e-12, 'second spoke');
  for (const shot of shots) {
    expect(shot.angle >= 0 && shot.angle < 360, `angle ${shot.angle} out of range`);
  }
});

test('a negative start is wrapped up by whole turns', () => {
  const cmd = createSpawnCommand({ bulletType: 9, count: 2, baseAngleDeg: 10, spreadOrSpeed: 370 });
  const shots = emitRadial(cmd, createBulletTemplate({ bullet_kind: 9 }), {
    emitter_x: 0,
    emitter_y: 0,
  });
  // start = 10 - 370 = -360 → 0
  expectClose(shots[0].angle, 0, 1e-12);
  expectClose(shots[1].angle, 180, 1e-12);
});

test('the -1 sentinel follows the emitter, an explicit point wins', () => {
  const follow = createSpawnCommand({ bulletType: 90, count: 1, baseAngleDeg: 90, spreadOrSpeed: 10 });
  const followed = emitRadial(follow, createBulletTemplate({ bullet_kind: 90 }), {
    emitter_x: 100,
    emitter_y: -200,
  });
  expectEqual(followed[0].x, 100);
  expectEqual(followed[0].y, -200);

  const explicit = createSpawnCommand({ bulletType: 90, count: 1, spawnX: 5, spawnY: 6 });
  const placed = emitRadial(explicit, createBulletTemplate({ bullet_kind: 90 }), {
    emitter_x: 100,
    emitter_y: -200,
  });
  expectEqual(placed[0].x, 5);
  expectEqual(placed[0].y, 6);
});

test('the template overrides the command kind and seeds the motion snapshot', () => {
  const cmd = createSpawnCommand({ bulletType: 1, count: 1, baseAngleDeg: 0 });
  const tmpl = createBulletTemplate({
    bullet_kind: 99,
    bullet_func_no: 81,
    speed: 2.4,
    angle_init: 0.5,
    f598: 0.6,
    prev_angle: 4,
    xacc_cap: 1.2,
    p2: 1,
    life: 3,
  });
  const shots = emitRadial(cmd, tmpl, { emitter_x: 0, emitter_y: 0 });
  const b = shots[0];
  expectEqual(b.bullet_kind, 99, 'the template kind wins');
  expectEqual(b.bullet_func_no, 81);
  expectEqual(b.angle_init, 0.5);
  expectEqual(b.speed, 2.4);
  expectEqual(b.spd_init2, 2.4, 'V1 is seeded from the template speed');
  expectEqual(b.speed_init, 2.4, 'V0 likewise');
  expectEqual(b.angle_spd, 0);
  expectEqual(b.angle_acc, 0);
  expectEqual(b.f598, 0.6);
  expectEqual(b.prev_angle, 4);
  expectEqual(b.xacc, 0);
  expectEqual(b.xacc_cap, 1.2);
  expectEqual(b.pf1, 1, 'pf1 is reset to 1.0 by the emitter');
  expectEqual(b.pf2, 0);
  expectEqual(b.life, 3);
  expectEqual(b.p1, 0);
  expectEqual(b.p2, 1);
  expectEqual(b.delay, 0);
  expectEqual(b.rotate_flg, 0);
  expectEqual(b.hit_hantei, true);
  expectEqual(b.hit_dis, 0, 'hitDis is left at the struct default');
  expectEqual(b.vx, 0, 'no first-frame update has run yet');
});

test('a zero template kind falls back to the command kind', () => {
  const cmd = createSpawnCommand({ bulletType: 45, count: 1 });
  const shots = emitRadial(cmd, createBulletTemplate({ bullet_kind: 0 }), {
    emitter_x: 0,
    emitter_y: 0,
  });
  expectEqual(shots[0].bullet_kind, 45);
});

test('radialAngles mirrors the emitter angle sweep', () => {
  expectEqual(JSON.stringify(radialAngles(0, 0, 4)), JSON.stringify([0, 90, 180, 270]));
  expectEqual(JSON.stringify(radialAngles(90, 22.5, 2)), JSON.stringify([67.5, 247.5]));
  expectEqual(radialAngles(0, 0, 0).length, 0);
});

suite('boss race pattern library');

test('the library ships the server\'s ten patterns in scheduler order', () => {
  const ids = bossRacePatternIds();
  expectEqual(ids.length, 10);
  expectEqual(
    JSON.stringify(ids),
    JSON.stringify([
      'kome_ring',
      'kusabi_gap_ring',
      'arrow_aimed_fan',
      'ring_spiral',
      'kome_homing',
      'heart_sine_speed',
      'kunai_bounce',
      'sizuku_sine_radius',
      'stama_mirror',
      'chou_four_dir',
    ]),
    'the order IS the schedule — reordering it changes every pattern_index',
  );
  for (const def of bossRacePatternLibraryCached()) {
    expectEqual(def.period_ticks, 45, `${def.id} period`);
    expect(def.waves.length >= 1, `${def.id} has no waves`);
    for (const wave of def.waves) {
      expectEqual(wave.tick_offset, 0, `${def.id} waves fire on the period boundary`);
    }
  }
});

test('nothing fires between period boundaries', () => {
  const def = bossRacePatternLibraryCached()[0];
  const ctx = { emitter_x: 320, emitter_y: 420 };
  for (const tick of [1, 2, 44, 46, 89]) {
    expectEqual(emitPatternTick(def, tick, ctx, createMotionTargets()).length, 0, `tick ${tick}`);
  }
  expectEqual(emitPatternTick(def, 45, ctx, createMotionTargets()).length, 16, 'tick 45 fires');
});

test('kome_ring fires 16 kome bullets from the Boss origin', () => {
  const def = bossRacePatternLibraryCached()[0];
  const shots = emitPatternTick(def, 45, { emitter_x: 320, emitter_y: 420 }, createMotionTargets());
  expectEqual(shots.length, 16);
  expectEqual(shots[0].bullet_kind, 45);
  expectEqual(shots[0].bullet_func_no, 0);
  expectEqual(shots[0].x, 320, 'emitter x (Boss origin)');
  expectEqual(shots[0].y, 420, 'emitter y = 480 + (-60)');
  expectEqual(shots[0].speed, 3);
  expectEqual(shots[0].angle, 0);
  expectClose(shots[1].angle, 22.5, 1e-12);
});

test('kusabi_gap_ring fires both offset waves on the same tick', () => {
  const def = bossRacePatternLibraryCached()[1];
  const shots = emitPatternTick(def, 45, { emitter_x: 320, emitter_y: 420 }, createMotionTargets());
  expectEqual(shots.length, 24, 'two waves of 12');
  expectEqual(shots[0].bullet_kind, 9);
  expectEqual(shots[0].angle, 0);
  expectEqual(shots[12].bullet_kind, 9);
  // The second wave is offset by +15° in its base angle.
  expectClose(shots[12].angle, 15, 1e-12, 'second wave base = 15');
});

test('arrow_aimed_fan re-aims the base angle at the ship, then sweeps the full circle', () => {
  const def = bossRacePatternLibraryCached()[2];
  const ctx = { emitter_x: 320, emitter_y: 420 };
  // Ship straight below the Boss ⇒ angleToPoint(320,420 → 320,480) = 90°.
  const targets = createMotionTargets({
    has_my_ship: true,
    my_ship_x: 320,
    my_ship_y: 480,
    has_enemy: true,
    enemy_x: 320,
    enemy_y: 420,
  });
  const shots = emitPatternTick(def, 45, ctx, targets);
  expectEqual(shots.length, 7);
  expectEqual(shots[0].bullet_kind, 90);
  const step = 360 / 7;
  expectClose(shots[0].angle, normalizeDeg(90 - 30), 1e-12, 'base 90 − spread 30');
  expectClose(shots[1].angle, normalizeDeg(90 - 30 + step), 1e-12);
});

test('an aimed base angle is narrowed to float32, like SpawnCommand demands', () => {
  const def = bossRacePatternLibraryCached()[2];
  const ctx = { emitter_x: 320, emitter_y: 420 };
  // A deliberately non-representable aim angle.
  const targets = createMotionTargets({
    has_my_ship: true,
    my_ship_x: 321.7,
    my_ship_y: 480,
    has_enemy: true,
    enemy_x: 320,
    enemy_y: 420,
  });
  const raw = Math.atan2(480 - 420, 321.7 - 320) * (180 / Math.PI);
  expect(f32(raw) !== raw, 'the chosen aim really is not float32-exact');
  const shots = emitPatternTick(def, 45, ctx, targets);
  expectEqual(shots[0].angle, normalizeDeg(f32(raw) - f32(30)), 'base is f32, spread is f32');
});

test('ring_spiral spins the base angle by 13° per tick', () => {
  const def = bossRacePatternLibraryCached()[3];
  const ctx = { emitter_x: 320, emitter_y: 420 };
  for (const tick of [0, 45, 90, 135]) {
    const shots = emitPatternTick(def, tick, ctx, createMotionTargets());
    expectEqual(shots.length, 4, `tick ${tick} fires four`);
    const expected = f32(normalizeDeg(0 + 13 * tick));
    expectEqual(shots[0].angle, normalizeDeg(expected - 0), `tick ${tick} base angle`);
  }
  // Tick 90 → 1170 → 90 after normalisation; the four spokes are 90/180/270/0.
  const at90 = emitPatternTick(def, 90, ctx, createMotionTargets());
  expectEqual(
    JSON.stringify(at90.map((s) => s.angle)),
    JSON.stringify([90, 180, 270, 0]),
  );
});

test('kome_homing seeds the func2 turning parameters', () => {
  const def = bossRacePatternLibraryCached()[4];
  const shots = emitPatternTick(def, 45, { emitter_x: 320, emitter_y: 420 }, createMotionTargets());
  expectEqual(shots.length, 2);
  expectEqual(shots[0].bullet_func_no, 2);
  expectEqual(shots[0].life, 1, 'func2 needs life >= 1 to turn');
  expectEqual(shots[0].angle_init, 90);
  expectEqual(shots[0].angle_acc, 3);
  expectEqual(shots[0].speed, 2.6);
});

test('every pattern wave produces bullets with a valid kind and func', () => {
  const ctx = { emitter_x: 320, emitter_y: 420 };
  const targets = createMotionTargets({
    has_my_ship: true,
    my_ship_x: 320,
    my_ship_y: 480,
    has_enemy: true,
    enemy_x: 320,
    enemy_y: 420,
  });
  for (const def of bossRacePatternLibraryCached()) {
    const shots = emitPatternTick(def, 45, ctx, targets);
    expect(shots.length > 0, `${def.id} emitted nothing`);
    for (const shot of shots) {
      expect(shot.bullet_kind >= 9 && shot.bullet_kind <= 224, `${def.id} kind ${shot.bullet_kind}`);
      expect(shot.bullet_func_no >= 0 && shot.bullet_func_no <= 85, `${def.id} func`);
      expect(Number.isFinite(shot.angle), `${def.id} angle`);
      expect(shot.angle >= 0 && shot.angle < 360, `${def.id} angle ${shot.angle} out of range`);
    }
  }
});

test('AimMode is the server enum', () => {
  expectEqual(AimMode.None, 0);
  expectEqual(AimMode.AtShip, 1);
  expectEqual(AimMode.AtEnemy, 2);
});
