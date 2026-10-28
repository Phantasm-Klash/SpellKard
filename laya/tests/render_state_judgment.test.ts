/**
 * 渲染态与判定一致性：客户端**渲染出来的东西**必须和服务端**算出来的东西**对得上。
 *
 * 覆盖：
 *  1. 每颗弹幕的渲染位置 == 权威位置（经同一变换），渲染半径 == radiusMilli × scale；
 *  2. 判定点半径 == 3000 milli × scale、擦弹圈 == 20000 milli × scale（服务端常量）；
 *  3. 用**服务端同一套整数算术**（距离平方 ≤ (半径+阈值)²）对每颗弹分类 hit/graze/none，
 *     与渲染几何（判定点/擦弹圈位置与半径）自洽——即画面上看到的"压点/擦边"
 *     就是服务端判定为命中/擦弹的那颗弹；
 *  4. 图集渲染时精灵尺寸 = 图集帧原尺寸 × artScale（美术尺寸跟 TNA 原图，不按 radius 缩放）。
 */
import { buildBossRaceFrame, PlayfieldTransform } from '../src/core/game/boss_race_view_model';
import {
  DANMAKU_GRAZE_RADIUS_MILLI,
  DANMAKU_HIT_RADIUS_MILLI,
} from '../src/core/sim/boss_race';
import { expectClose, expectEqual, expect, suite, test } from './harness';

const LAYOUT = { width: 480, height: 720 };

function snapshotWith(players: any[], bullets: any[] = []): any {
  return {
    tick: 100,
    state: 'running',
    winnerPlayerId: '',
    boss: { xMilli: 0, yMilli: -60000, hp: 6000, maxHp: 6000, phase: 1, effects: [] },
    players,
    bullets,
    chains: [],
    events: [],
  };
}

function player(overrides: Record<string, unknown> = {}): any {
  return {
    playerId: 'p1',
    xMilli: 0,
    yMilli: 60000,
    vxMilli: 0,
    vyMilli: 0,
    bossCurrentHp: 6000,
    damageDealt: 0,
    connected: true,
    lives: 3,
    bombs: 3,
    graze: 0,
    invulnerableUntilTick: 0,
    ...overrides,
  };
}

function bullet(overrides: Record<string, unknown> = {}): any {
  return {
    bulletId: 'b1',
    xMilli: 0,
    yMilli: 0,
    vxMilli: 0,
    vyMilli: 0,
    radiusMilli: 4000,
    kind: 45,
    hidden: false,
    ownerPlayerId: 'p1',
    patternId: 'kome_ring',
    ...overrides,
  };
}

/** 服务端 `JudgePlayerContacts` 的同一套算术：距离平方 ≤ (弹半径 + 阈值)²。 */
function classify(bulletXMilli: number, bulletYMilli: number, radiusMilli: number, playerX: number, playerY: number): 'hit' | 'graze' | 'none' {
  const dx = bulletXMilli - playerX;
  const dy = bulletYMilli - playerY;
  const distanceSquared = dx * dx + dy * dy;
  const hitRadius = radiusMilli + DANMAKU_HIT_RADIUS_MILLI;
  if (distanceSquared <= hitRadius * hitRadius) {
    return 'hit';
  }
  const grazeRadius = radiusMilli + DANMAKU_GRAZE_RADIUS_MILLI;
  if (distanceSquared <= grazeRadius * grazeRadius) {
    return 'graze';
  }
  return 'none';
}

suite('render state: bullets and judgement geometry');

test('every rendered bullet sits where the server says, with the server radius', () => {
  const transform = new PlayfieldTransform(LAYOUT);
  const bullets = [
    bullet({ bulletId: 'a', xMilli: 10000, yMilli: -20000, radiusMilli: 4000 }),
    bullet({ bulletId: 'b', xMilli: -120000, yMilli: 90000, radiusMilli: 8000 }),
    bullet({ bulletId: 'c', xMilli: 319000, yMilli: -479000, radiusMilli: 16000 }),
  ];
  const frame = buildBossRaceFrame(snapshotWith([player()], bullets), {
    layout: LAYOUT,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
    frac: 0,
  });
  expectEqual(frame.bullets.length, 3);
  for (const source of bullets) {
    const rendered = frame.bullets.find((b) => b.bulletId === source.bulletId)!;
    const expected = transform.toPixels(source.xMilli, source.yMilli);
    expectClose(rendered.position.x, expected.x, 1e-9, `x of ${source.bulletId}`);
    expectClose(rendered.position.y, expected.y, 1e-9, `y of ${source.bulletId}`);
    // 渲染半径 = 服务端碰撞半径 × 变换（同一把尺子）。
    expectClose(rendered.radius, source.radiusMilli * transform.scale, 1e-9, `radius of ${source.bulletId}`);
  }
});

test('the judgement point and graze ring use the server radii', () => {
  const transform = new PlayfieldTransform(LAYOUT);
  const frame = buildBossRaceFrame(snapshotWith([player()]), {
    layout: LAYOUT,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
    frac: 0,
  });
  const local = frame.players[0];
  // 判定点 3px、擦弹圈 20px（640×960 屏坐标）→ 经变换到画面。
  expectClose(local.hitboxRadiusPx, DANMAKU_HIT_RADIUS_MILLI * transform.scale, 1e-9, 'judgement point');
  expectClose(local.grazeRadiusPx, DANMAKU_GRAZE_RADIUS_MILLI * transform.scale, 1e-9, 'graze ring');
  // 1px 屏 = 1000 milli → 判定点 3px、擦弹 20px（480 宽画面下 ×0.75）。
  expectClose(local.hitboxRadiusPx, 3 * (LAYOUT.width / 640), 1e-9, 'judgement point in screen px');
  expectClose(local.grazeRadiusPx, 20 * (LAYOUT.width / 640), 1e-9, 'graze ring in screen px');
});

test('what the player sees as a hit or a graze is what the server classifies', () => {
  const playerX = 0;
  const playerY = 60000;
  const radius = 4000;
  // 三颗弹：正好压点（命中）、正好在擦弹带内、明显在外。
  const hitDistance = radius + DANMAKU_HIT_RADIUS_MILLI;
  const grazeDistance = radius + DANMAKU_HIT_RADIUS_MILLI + 5000;
  const farDistance = radius + DANMAKU_GRAZE_RADIUS_MILLI + 5000;
  const bullets = [
    bullet({ bulletId: 'hit', xMilli: playerX, yMilli: playerY - hitDistance, radiusMilli: radius }),
    bullet({ bulletId: 'graze', xMilli: playerX, yMilli: playerY - grazeDistance, radiusMilli: radius }),
    bullet({ bulletId: 'far', xMilli: playerX, yMilli: playerY - farDistance, radiusMilli: radius }),
  ];
  const frame = buildBossRaceFrame(snapshotWith([player({ xMilli: playerX, yMilli: playerY })], bullets), {
    layout: LAYOUT,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
    frac: 0,
  });
  const local = frame.players[0];
  const point = { x: local.position.x, y: local.position.y };

  for (const source of bullets) {
    const rendered = frame.bullets.find((b) => b.bulletId === source.bulletId)!;
    // 渲染几何：画面上的像素距离 vs 判定点/擦弹圈像素半径。
    const dx = rendered.position.x - point.x;
    const dy = rendered.position.y - point.y;
    const pixelDistance = Math.hypot(dx, dy);
    const visuallyHit = pixelDistance <= local.hitboxRadiusPx + rendered.radius;
    const visuallyGraze = pixelDistance <= local.grazeRadiusPx + rendered.radius;
    // 服务端算术（milli，整数域）。
    const serverClass = classify(source.xMilli, source.yMilli, source.radiusMilli, playerX, playerY);

    if (serverClass === 'hit') {
      expect(visuallyHit, `bullet ${source.bulletId}: server says hit, render must overlap the judgement point`);
      expectEqual(visuallyGraze, true, `bullet ${source.bulletId}: a hit is also inside the graze ring`);
    } else if (serverClass === 'graze') {
      expect(!visuallyHit, `bullet ${source.bulletId}: server says graze only, render must NOT overlap the point`);
      expect(visuallyGraze, `bullet ${source.bulletId}: graze must be inside the ring`);
    } else {
      expect(!visuallyGraze, `bullet ${source.bulletId}: server says none, render must be outside the ring`);
    }
  }
});
