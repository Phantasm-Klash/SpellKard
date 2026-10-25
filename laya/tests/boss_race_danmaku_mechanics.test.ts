/**
 * `tna-1.40-danmaku` 机制分支（P2 / E2）测试。
 *
 * 逐条把客户端镜像钉到服务端权威实现上：
 *  - 判定常量（`PhK-BattleServer/include/phk/battle/boss_race.hpp:44-51,192-193`）；
 *  - 命中 / 擦弹 / 无敌帧 / 炸弹 / 残机归零规则（`src/boss_race.cpp:339-423`、
 *    `:1027-1084`）；
 *  - canonical hash 不含机制字段与 vx/vy（`src/boss_race.cpp:1145-1169`）；
 *  - 默认 ruleset 无机制（快照缺省、合成伤害照旧）；
 *  - 快照 vx/vy 产出与 adopt 往返（E3）；
 *  - 票据 ruleset 字符串直通配置（机制开关的集成点）；
 *  - 视图层透传（判定点 / 擦弹圈 / 无敌 / 残机读数）。
 */

import { canonicalHashPair } from '../src/core/math/deterministic';
import {
  BOSS_RACE_DEFAULT_BOSS_HP,
  BossRaceSimulation,
  BossRaceState,
  DANMAKU_DEFAULT_BOMBS,
  DANMAKU_DEFAULT_LIVES,
  DANMAKU_GRAZE_RADIUS_MILLI,
  DANMAKU_HIT_RADIUS_MILLI,
  DANMAKU_INVULNERABLE_TICKS,
  DIR_RIGHT,
  DIR_UP,
  MOVE_MILLI_PER_TICK,
  RULESET_DANMAKU_MECHANICS,
  SCREEN_CENTER_X_PX,
  SCREEN_CENTER_Y_PX,
  SNAPSHOT_DEFAULT_BOMBS,
  SNAPSHOT_DEFAULT_LIVES,
  bossRaceConfigForRuleset,
  defaultBossRaceConfig,
  defaultTnaBossRaceConfig,
  usesDanmakuMechanics,
  usesRealDanmaku,
  type BossRaceSnapshot,
} from '../src/core/sim/boss_race';
import { createBulletMotion } from '../src/core/sim/danmaku/bullet_motion';
import { buildBossRaceFrame, type PlayfieldLayout } from '../src/core/game/boss_race_view_model';
import { buildCoopFrame } from '../src/core/game/coop_view_model';
import { CoopBossState, type CoopBossSnapshot } from '../src/core/sim/coop_boss';
import { expect, expectClose, expectEqual, suite, test } from './harness';

const SEED = 0x00010203;
/** 注入弹的半径（hit_dis = 4px = 4000 milli，与快照默认半径一致）。 */
const BULLET_RADIUS_MILLI = 4000;

/** 640×960 参考布局：transform scale = 1，milli 半径 ÷ 1000 就是像素。 */
const LAYOUT_640_960: PlayfieldLayout = { width: 640, height: 960 };

function mechanicsSim(matchId = 'match-danmaku-001'): BossRaceSimulation {
  const sim = new BossRaceSimulation({
    ...defaultTnaBossRaceConfig(matchId, SEED),
    rulesetVersion: RULESET_DANMAKU_MECHANICS,
  });
  sim.addPlayer('p1', 0, 0);
  sim.addPlayer('p2', 0, 0);
  return sim;
}

/** 放一颗**静止**子弹于 centered milli (x, y)（服务端测试注入口同款用法）。 */
function injectBullet(sim: BossRaceSimulation, ownerPlayerId: string, xMilli: number, yMilli: number): void {
  const motion = createBulletMotion({
    x: SCREEN_CENTER_X_PX + xMilli / 1000,
    y: SCREEN_CENTER_Y_PX + yMilli / 1000,
    hit_dis: BULLET_RADIUS_MILLI / 1000,
  });
  expect(sim.injectLiveBulletForTest(ownerPlayerId, motion), 'bullet injection must succeed');
}

/** 递交下一 tick 的输入（满足服务端 +/-8 tick 窗口与 seq 单调）。 */
function submit(
  sim: BossRaceSimulation,
  playerId: string,
  seq: number,
  input: { bits?: number; shoot?: boolean; bomb?: boolean } = {},
): void {
  expect(
    sim.submitInput({
      playerId,
      tick: sim.getCurrentTick() + 1,
      seq,
      directionBits: input.bits ?? 0,
      slow: false,
      shoot: input.shoot ?? false,
      bomb: input.bomb ?? false,
      cardSlot: -1,
      modeActionId: '',
    }),
    'input must be accepted',
  );
}

function playerOf(snapshot: BossRaceSnapshot, playerId: string) {
  const player = snapshot.players.find((entry) => entry.playerId === playerId);
  expect(player !== undefined, `snapshot must carry ${playerId}`);
  return player!;
}

suite('danmaku mechanics (tna-1.40-danmaku)');

test('judgment constants match the server header bit for bit', () => {
  expectEqual(RULESET_DANMAKU_MECHANICS, 'tna-1.40-danmaku', 'kRulesetDanmakuMechanics (boss_race.hpp:44)');
  expectEqual(DANMAKU_HIT_RADIUS_MILLI, 3000, 'kDanmakuHitRadiusMilli (boss_race.hpp:47)');
  expectEqual(DANMAKU_GRAZE_RADIUS_MILLI, 20000, 'kDanmakuGrazeRadiusMilli (boss_race.hpp:48)');
  expectEqual(DANMAKU_INVULNERABLE_TICKS, 120, 'kDanmakuInvulnerableTicks (boss_race.hpp:49)');
  expectEqual(DANMAKU_DEFAULT_LIVES, 3, 'kDanmakuDefaultLives (boss_race.hpp:50)');
  expectEqual(DANMAKU_DEFAULT_BOMBS, 3, 'kDanmakuDefaultBombs (boss_race.hpp:51)');
  expectEqual(SNAPSHOT_DEFAULT_LIVES, 1, 'kSnapshotDefaultLives (boss_race.hpp:192)');
  expectEqual(SNAPSHOT_DEFAULT_BOMBS, 3, 'kSnapshotDefaultBombs (boss_race.hpp:193)');
  expectEqual(usesDanmakuMechanics(RULESET_DANMAKU_MECHANICS), true);
  expectEqual(usesDanmakuMechanics('tna-1.40-phase'), false, 'the plain TNA ruleset has no judgment');
  expectEqual(usesDanmakuMechanics('mvp-boss-race-s0'), false);
  expectEqual(usesDanmakuMechanics('ruleset-local-s0'), false);
  expectEqual(usesDanmakuMechanics(''), false);
});

test('a bullet within r_hit costs one life and grants the 120-tick window', () => {
  const sim = mechanicsSim();
  injectBullet(sim, 'p1', 0, 0);
  submit(sim, 'p1', 1);
  const snapshot = sim.tick();
  expectEqual(snapshot.tick, 1);
  const p1 = playerOf(snapshot, 'p1');
  expectEqual(p1.lives, DANMAKU_DEFAULT_LIVES - 1, 'one life lost');
  expectEqual(p1.invulnerableUntilTick, 1 + DANMAKU_INVULNERABLE_TICKS, 'invulnerable until hit tick + 120');
  const hit = snapshot.events?.filter((event) => event.type === 'player_hit') ?? [];
  expectEqual(hit.length, 1, 'player_hit fires on the hit tick');
  expectEqual(hit[0].playerId, 'p1');
  expectEqual(hit[0].tick, 1);
});

test('the hit test is inclusive at exactly r_bullet + r_hit', () => {
  const sim = mechanicsSim();
  injectBullet(sim, 'p1', BULLET_RADIUS_MILLI + DANMAKU_HIT_RADIUS_MILLI, 0);
  submit(sim, 'p1', 1);
  const snapshot = sim.tick();
  expectEqual(playerOf(snapshot, 'p1').lives, DANMAKU_DEFAULT_LIVES - 1, 'dist == r + r_hit is a hit');
});

test('grazing counts once per bullet and never costs a life', () => {
  const sim = mechanicsSim();
  injectBullet(sim, 'p1', 10000, 0); // > r+r_hit (7000), <= r+r_graze (24000)
  let grazeEvents = 0;
  for (let tick = 1; tick <= 3; tick += 1) {
    submit(sim, 'p1', tick);
    const snapshot = sim.tick();
    const p1 = playerOf(snapshot, 'p1');
    expectEqual(p1.lives, DANMAKU_DEFAULT_LIVES, 'outside r_hit no life is lost');
    expectEqual(p1.graze, 1, 'the same stationary bullet only grazes once');
    grazeEvents += (snapshot.events?.filter((event) => event.type === 'player_graze') ?? []).length;
  }
  expectEqual(grazeEvents, 1, 'player_graze fires exactly once for one bullet');
});

test('the graze test is inclusive at exactly r_bullet + r_graze', () => {
  const sim = mechanicsSim();
  injectBullet(sim, 'p1', BULLET_RADIUS_MILLI + DANMAKU_GRAZE_RADIUS_MILLI, 0);
  submit(sim, 'p1', 1);
  const snapshot = sim.tick();
  expectEqual(playerOf(snapshot, 'p1').graze, 1, 'dist == r + r_graze is a graze');
  expectEqual(playerOf(snapshot, 'p1').lives, DANMAKU_DEFAULT_LIVES, 'and not a hit');
});

test('the invulnerable window blocks hit and graze until it expires', () => {
  const sim = mechanicsSim();
  injectBullet(sim, 'p1', 0, 0);
  submit(sim, 'p1', 1);
  expectEqual(playerOf(sim.tick(), 'p1').lives, DANMAKU_DEFAULT_LIVES - 1, 'the overlapping bullet hits at tick 1');
  // ticks 2..121（含 until 本身）全部无敌：贴脸也不再掉命、不计擦弹。
  for (let tick = 2; tick <= DANMAKU_INVULNERABLE_TICKS + 1; tick += 1) {
    submit(sim, 'p1', tick);
    const p1 = playerOf(sim.tick(), 'p1');
    expectEqual(p1.lives, DANMAKU_DEFAULT_LIVES - 1, `tick ${tick} is still inside the window`);
    expectEqual(p1.graze, 0, 'nothing grazes while invulnerable');
  }
  submit(sim, 'p1', DANMAKU_INVULNERABLE_TICKS + 2);
  const after = sim.tick();
  expectEqual(after.tick, DANMAKU_INVULNERABLE_TICKS + 2);
  expectEqual(playerOf(after, 'p1').lives, DANMAKU_DEFAULT_LIVES - 2, 'window expired: the bullet hits again');
});

test('bomb consumes one bomb and grants the invulnerable window', () => {
  const sim = mechanicsSim();
  for (let i = 0; i < DANMAKU_DEFAULT_BOMBS; i += 1) {
    submit(sim, 'p1', i + 1, { bomb: true });
    const snapshot = sim.tick();
    const p1 = playerOf(snapshot, 'p1');
    expectEqual(p1.bombs, DANMAKU_DEFAULT_BOMBS - i - 1, `bomb ${i + 1} consumed`);
    expectEqual(p1.invulnerableUntilTick, snapshot.tick + DANMAKU_INVULNERABLE_TICKS, 'bomb grants the window');
    expectEqual((snapshot.events?.filter((event) => event.type === 'bomb_used') ?? []).length, 1, 'one bomb_used');
  }
  submit(sim, 'p1', DANMAKU_DEFAULT_BOMBS + 1, { bomb: true });
  const exhausted = sim.tick();
  expectEqual(playerOf(exhausted, 'p1').bombs, 0, 'no bombs left');
  expectEqual(exhausted.events, undefined, 'an empty magazine emits nothing');
  expectEqual(
    playerOf(exhausted, 'p1').invulnerableUntilTick,
    DANMAKU_DEFAULT_BOMBS + DANMAKU_INVULNERABLE_TICKS,
    'the window is not refreshed without bombs',
  );
});

test('lives reaching zero kills the player and stops judgment, but the Boss copy keeps firing', () => {
  const sim = mechanicsSim();
  // 对手摘除：长程测试只关心 p1 的事件流（p2 的副本弹幕会自行命中 p2）。
  sim.setPlayerConnected('p2', false);
  injectBullet(sim, 'p1', 0, 0);
  let seq = 0;
  // 受击排期：tick 1 / 122 / 243（每次命中后 120 tick 无敌，窗口内不掉命——
  // 因此无论副本弹幕如何穿插，每个易伤 tick 恰好只掉一条命）。
  const killingTick = 2 * DANMAKU_INVULNERABLE_TICKS + 3;
  for (let tick = 1; tick <= killingTick; tick += 1) {
    seq += 1;
    submit(sim, 'p1', seq);
    const snapshot = sim.tick();
    if (tick === killingTick) {
      expectEqual(playerOf(snapshot, 'p1').lives, 0, 'the third hit empties the life stock');
      expectEqual((snapshot.events?.filter((event) => event.type === 'player_hit') ?? []).length, 1, 'the killing blow still hits');
      expectEqual((snapshot.events?.filter((event) => event.type === 'player_dead') ?? []).length, 1, 'player_dead fires once');
    }
  }
  // 死后停判：那颗仍贴在玩家身上的弹（b1）不再产生任何事件。
  seq += 1;
  submit(sim, 'p1', seq);
  const afterDeath = sim.tick();
  expect(afterDeath.bullets.some((bullet) => bullet.bulletId === 'b1'), 'the overlapping bullet is still in play');
  expectEqual(afterDeath.events, undefined, 'a dead player is never judged again');
  // 服务端同构：Boss 副本不因玩家死亡停火（SpawnRealBulletsForTick 只查 connected/HP）。
  while (sim.getCurrentTick() < 270) {
    seq += 1;
    submit(sim, 'p1', seq);
    sim.tick();
  }
  expectEqual(sim.getCurrentTick(), 270);
  expect(
    sim.snapshot().bullets.some((bullet) => bullet.ownerPlayerId === 'p1'),
    'the dead player Boss copy keeps firing (server parity)',
  );
});

test('the default rulesets run no judgment mechanics at all', () => {
  const configs = [
    defaultBossRaceConfig('match-default-001', SEED),
    defaultTnaBossRaceConfig('match-default-002', SEED),
    bossRaceConfigForRuleset('match-default-003', SEED, 'ruleset-local-s0'),
  ];
  for (const config of configs) {
    const sim = new BossRaceSimulation(config);
    sim.addPlayer('p1', 0, 0);
    sim.addPlayer('p2', 0, 0);
    injectBullet(sim, 'p1', 0, 0);
    injectBullet(sim, 'p1', 10000, 0);
    for (let tick = 1; tick <= 5; tick += 1) {
      submit(sim, 'p1', tick, { shoot: true, bomb: true });
      const snapshot = sim.tick();
      const p1 = playerOf(snapshot, 'p1');
      expectEqual(p1.lives, undefined, 'no lives field without the mechanics ruleset');
      expectEqual(p1.bombs, undefined, 'no bombs field');
      expectEqual(p1.graze, undefined, 'no graze field');
      expectEqual(p1.invulnerableUntilTick, undefined, 'no invulnerable field');
      expectEqual(snapshot.events, undefined, 'no judgment events');
    }
    // 默认路径的合成伤害逐字节保持现状（服务端 boss_race.cpp:395-414）。
    expectEqual(playerOf(sim.snapshot(), 'p1').damageDealt, 50, 'shoot still deals 10 damage per tick');
  }
});

test('the mechanics ruleset leaves boss damage to the server', () => {
  const sim = mechanicsSim();
  for (let tick = 1; tick <= 5; tick += 1) {
    submit(sim, 'p1', tick, { shoot: true, bomb: true });
    sim.tick();
  }
  const p1 = playerOf(sim.snapshot(), 'p1');
  expectEqual(p1.bossCurrentHp, BOSS_RACE_DEFAULT_BOSS_HP, 'no synthetic per-tick damage under mechanics');
  expectEqual(p1.damageDealt, 0, 'damage arrives via server snapshots / boss_damage events');
  expectEqual(p1.bombs, 0, 'three presses consumed the three bombs; the rest are no-ops');
});

test('canonical hash ignores vx/vy and the judgment fields', () => {
  const sim = mechanicsSim();
  injectBullet(sim, 'p1', 13000, 0); // 玩家本 tick 右移到 3000 → dist 10000 → 擦弹
  submit(sim, 'p1', 1, { bits: DIR_RIGHT });
  const snapshot = sim.tick();
  const p1 = playerOf(snapshot, 'p1');
  // 状态确实带着这些字段……
  expectEqual(p1.vxMilli, MOVE_MILLI_PER_TICK, 'the snapshot carries vx');
  expectEqual(p1.graze, 1, 'and the graze count');
  expectEqual(p1.lives, DANMAKU_DEFAULT_LIVES, 'and lives');
  // ……但 hash material 与服务端同构，只含 x/y/hp/damage 与子弹（boss_race.cpp:1145-1169）。
  let material =
    `${sim.config.matchId}|${sim.config.matchSeed.decimal}|${snapshot.tick}|` +
    `${snapshot.state as number}|${snapshot.winnerPlayerId}|${snapshot.winnerTick}`;
  for (const player of snapshot.players) {
    material += `|p:${player.playerId}:${player.xMilli}:${player.yMilli}:${player.bossCurrentHp}:${player.damageDealt}`;
  }
  material += `|b:${snapshot.bullets.length}`;
  for (const bullet of snapshot.bullets) {
    material += `|${bullet.bulletId}:${bullet.xMilli}:${bullet.yMilli}:${bullet.bulletKind ?? 0}:${bullet.motionFunc ?? 0}`;
  }
  expectEqual(snapshot.stateHash, canonicalHashPair(material), 'hash material excludes the new fields');
});

test('two simulations at the same position hash alike regardless of vx', () => {
  const moving = mechanicsSim('match-vx-001');
  submit(moving, 'p1', 1, { bits: DIR_RIGHT });
  moving.tick();

  // 同一终点、零速度：出生点即 moving 一 tick 后的位置，且整局不输入。
  const still = new BossRaceSimulation({
    ...defaultTnaBossRaceConfig('match-vx-001', SEED),
    rulesetVersion: RULESET_DANMAKU_MECHANICS,
  });
  still.addPlayer('p1', MOVE_MILLI_PER_TICK, 0);
  still.addPlayer('p2', 0, 0);
  still.tick();

  const a = playerOf(moving.snapshot(), 'p1');
  const b = playerOf(still.snapshot(), 'p1');
  expectEqual(a.xMilli, b.xMilli, 'same position');
  expectEqual(a.vxMilli, MOVE_MILLI_PER_TICK, 'the mover reports its velocity');
  expectEqual(b.vxMilli, 0, 'the still ship reports zero');
  expectEqual(moving.canonicalStateHash(), still.canonicalStateHash(), 'vx/vy are not in the hash');
});

test('snapshot vx/vy and the judgment fields survive an adopt round-trip', () => {
  const source = mechanicsSim();
  submit(source, 'p1', 1, { bits: DIR_RIGHT | DIR_UP }); // vx=+3000, vy=-3000
  source.tick();
  const wire = source.snapshot();
  expectEqual(playerOf(wire, 'p1').vxMilli, MOVE_MILLI_PER_TICK);
  expectEqual(playerOf(wire, 'p1').vyMilli, -MOVE_MILLI_PER_TICK);

  const target = mechanicsSim();
  target.adoptAuthoritativeSnapshot(wire);
  const adopted = playerOf(target.snapshot(), 'p1');
  expectEqual(adopted.vxMilli, MOVE_MILLI_PER_TICK, 'adopted vx');
  expectEqual(adopted.vyMilli, -MOVE_MILLI_PER_TICK, 'adopted vy');
  expectEqual(adopted.lives, DANMAKU_DEFAULT_LIVES, 'adopted lives');
  expectEqual(adopted.bombs, DANMAKU_DEFAULT_BOMBS, 'adopted bombs');
  expectEqual(adopted.graze, 0, 'adopted graze');

  const dead: BossRaceSnapshot = {
    ...wire,
    players: wire.players.map((player) =>
      player.playerId === 'p1' ? { ...player, lives: 0, graze: 7 } : player,
    ),
  };
  target.adoptAuthoritativeSnapshot(dead);
  const afterDead = playerOf(target.snapshot(), 'p1');
  expectEqual(afterDead.lives, 0, 'adopted zero lives');
  expectEqual(afterDead.graze, 7, 'adopted graze');

  const revived: BossRaceSnapshot = {
    ...wire,
    players: wire.players.map((player) =>
      player.playerId === 'p1' ? { ...player, lives: 2 } : player,
    ),
  };
  target.adoptAuthoritativeSnapshot(revived);
  expectEqual(playerOf(target.snapshot(), 'p1').lives, 2, 'a positive life stock revives the local prediction');
});

test('bossRaceConfigForRuleset carries the ticket ruleset through', () => {
  const danmaku = bossRaceConfigForRuleset('m', 1, RULESET_DANMAKU_MECHANICS);
  expectEqual(danmaku.rulesetVersion, RULESET_DANMAKU_MECHANICS, 'the mechanics switch must survive config building');
  expectEqual(usesRealDanmaku(danmaku.rulesetVersion), true, 'and it still runs the real-danmaku path');
  expectEqual(new BossRaceSimulation(danmaku).usesDanmakuMechanics(), true, 'the simulation sees the switch');

  const local = bossRaceConfigForRuleset('m', 1, 'ruleset-local-s0');
  expectEqual(local.rulesetVersion, 'ruleset-local-s0', 'the ticket string is preserved verbatim');
  expectEqual(new BossRaceSimulation(local).usesRealDanmaku(), true, 'still the real-danmaku path');
  expectEqual(new BossRaceSimulation(local).usesDanmakuMechanics(), false, 'but no judgment mechanics');

  const legacy = bossRaceConfigForRuleset('m', 1, 'mvp-boss-race-s0');
  expectEqual(legacy.rulesetVersion, 'mvp-boss-race-s0');
  expectEqual(new BossRaceSimulation(legacy).usesRealDanmaku(), false, 'the legacy synthetic path is untouched');
});

function snapshotWithPlayers(players: BossRaceSnapshot['players']): BossRaceSnapshot {
  return {
    tick: 100,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    stateHash: '',
    players,
    bullets: [],
  };
}

test('the frame carries the judgment indicators at the server radii', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([
      {
        playerId: 'p1',
        xMilli: 0,
        yMilli: 0,
        bossCurrentHp: 6000,
        damageDealt: 0,
        connected: true,
        lives: 2,
        bombs: 1,
        graze: 41,
        invulnerableUntilTick: 100,
      },
      { playerId: 'p2', xMilli: 0, yMilli: 0, bossCurrentHp: 6000, damageDealt: 0, connected: true },
    ]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  const local = frame.players.find((player) => player.isLocal)!;
  expectClose(local.hitboxRadiusPx, 3, 1e-9, 'r_hit 3000 milli = 3px at the 640x960 reference layout');
  expectClose(local.grazeRadiusPx, 20, 1e-9, 'r_graze 20000 milli = 20px at the reference layout');
  expectEqual(local.invulnerable, true, 'tick 100 <= invulnerableUntilTick 100');
  expectEqual(local.lives, 2, 'lives pass through');
  expectEqual(local.bombs, 1, 'bombs pass through');
  expectEqual(local.graze, 41, 'graze passes through');
  const rival = frame.players.find((player) => !player.isLocal)!;
  expectEqual(rival.grazeRadiusPx, 0, 'a snapshot without judgment fields draws no graze ring');
  expectEqual(rival.lives, SNAPSHOT_DEFAULT_LIVES, 'wire placeholder lives');
  expectEqual(rival.bombs, SNAPSHOT_DEFAULT_BOMBS, 'wire placeholder bombs');
  expectEqual(rival.graze, 0, 'wire placeholder graze');
  expectEqual(rival.invulnerable, false, 'no invulnerable flag without the field');
});

test('an expired invulnerable window clears the blink flag', () => {
  const frame = buildBossRaceFrame(
    snapshotWithPlayers([
      {
        playerId: 'p1',
        xMilli: 0,
        yMilli: 0,
        bossCurrentHp: 6000,
        damageDealt: 0,
        connected: true,
        lives: 3,
        bombs: 3,
        graze: 0,
        invulnerableUntilTick: 99,
      },
    ]),
    { layout: LAYOUT_640_960, localPlayerId: 'p1', bossMaxHp: 6000 },
  );
  expectEqual(frame.players[0].invulnerable, false, 'tick 100 > invulnerableUntilTick 99');
  expect(frame.players[0].grazeRadiusPx > 0, 'the ring still shows while judgment is active');
});

test('the coop frame passes the judgment fields through with wire placeholders', () => {
  const snapshot: CoopBossSnapshot = {
    tick: 50,
    state: CoopBossState.Running,
    bossHp: 9000,
    bossMaxHp: 10000,
    seatCount: 2,
    shieldDirMask: 0,
    lockDir: -1,
    lockUntilTick: 0,
    spiralActive: false,
    players: [
      {
        playerId: 'p1',
        seat: 0,
        xMilli: 0,
        yMilli: 0,
        facingMilliDeg: 0,
        damageDealt: 0,
        connected: true,
        locked: false,
        shielded: false,
        lives: 2,
        bombs: 1,
        graze: 9,
        invulnerableUntilTick: 60,
      },
      {
        playerId: 'p2',
        seat: 1,
        xMilli: 0,
        yMilli: 0,
        facingMilliDeg: 0,
        damageDealt: 0,
        connected: true,
        locked: false,
        shielded: false,
      },
    ],
    bullets: [],
    stateHash: '',
  };
  const frame = buildCoopFrame(snapshot, { layout: { width: 480, height: 480 }, localPlayerId: 'p1' });
  const local = frame.players.find((player) => player.isLocal)!;
  expectEqual(local.lives, 2, 'coop lives pass through');
  expectEqual(local.bombs, 1, 'coop bombs pass through');
  expectEqual(local.graze, 9, 'coop graze passes through');
  expectEqual(local.invulnerable, true, 'tick 50 <= invulnerableUntilTick 60');
  const ally = frame.players.find((player) => !player.isLocal)!;
  expectEqual(ally.lives, SNAPSHOT_DEFAULT_LIVES, 'wire placeholder lives');
  expectEqual(ally.bombs, SNAPSHOT_DEFAULT_BOMBS, 'wire placeholder bombs');
  expectEqual(ally.graze, 0, 'wire placeholder graze');
  expectEqual(ally.invulnerable, false, 'no flag without the field');
});
