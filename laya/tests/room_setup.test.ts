import { expect, expectEqual, suite, test } from './harness';
import {
  MAX_BOSS_HEALTH,
  MAX_MAX_TICKS,
  MIN_BOSS_HEALTH,
  MIN_MAX_TICKS,
  PLAYABLE_MODE_IDS,
  RoomSetupState,
  defaultRoomSetup,
  isPlayableMode,
  modeAvailability,
  resolvePlayableModes,
  roomSetupEditable,
  roomSetupFromModeParams,
  roomSetupSummary,
  roomSetupToModeParams,
} from '../src/core/net/room_setup';

suite('room setup (mahjong-soul style panel)');

test('only the modes with a battle server simulation are playable', () => {
  expect(isPlayableMode('mvp_boss_race'), 'race is playable');
  expect(isPlayableMode('coop_boss'), 'coop is playable');
  expect(!isPlayableMode('world_boss'), 'world boss has no simulation');
  expect(!isPlayableMode('battle_royale'), 'battle royale has no simulation');
  expect(!isPlayableMode('certification'), 'certification is a race reskin, not its own mode');
  expect(!isPlayableMode(''), 'empty is not a mode');
  expectEqual(PLAYABLE_MODE_IDS.length, 2, 'two playable modes');
});

test('defaults carry no options, so a plain room stays a plain room', () => {
  const params = roomSetupToModeParams(defaultRoomSetup('mvp_boss_race'));
  expectEqual(Object.keys(params).length, 0, 'no default options are emitted');
});

test('chosen options are encoded under the keys the server reads', () => {
  const state: RoomSetupState = {
    modeId: 'mvp_boss_race',
    bossId: 'hui',
    stageId: 'lunar_maze',
    coopPlayers: 0,
    maxTicks: 1800,
    bossHealth: 12000,
  };
  const params = roomSetupToModeParams(state);
  expectEqual(params.boss_id, 'hui', 'boss id');
  expectEqual(params.stage_id, 'lunar_maze', 'stage id');
  expectEqual(params.max_ticks, 1800, 'match length');
  expectEqual(params.boss_health, 12000, 'boss health');
  expect(params.coop_players === undefined, 'coop seats are not sent for a race room');
});

test('boss health is boss_health, never boss_hp', () => {
  const params = roomSetupToModeParams({
    ...defaultRoomSetup('mvp_boss_race'),
    bossHealth: 12000,
  });
  expect(params.boss_health !== undefined, 'boss_health is present');
  expect(params.boss_hp === undefined, 'boss_hp is a client-forbidden field and must not be sent');
});

test('coop seats are only sent for coop rooms', () => {
  const coop = roomSetupToModeParams({ ...defaultRoomSetup('coop_boss'), coopPlayers: 4 });
  expectEqual(coop.coop_players, 4, 'coop room sends its seat count');
  const race = roomSetupToModeParams({ ...defaultRoomSetup('mvp_boss_race'), coopPlayers: 4 });
  expect(race.coop_players === undefined, 'a race room must not send coop seats');
});

test('out-of-range options are clamped to the server bounds', () => {
  const tight = roomSetupToModeParams({
    ...defaultRoomSetup('mvp_boss_race'),
    maxTicks: 10,
    bossHealth: 5,
  });
  expectEqual(tight.max_ticks, MIN_MAX_TICKS, 'match length clamps up to the minimum');
  expectEqual(tight.boss_health, MIN_BOSS_HEALTH, 'boss health clamps up to the minimum');

  const loose = roomSetupToModeParams({
    ...defaultRoomSetup('mvp_boss_race'),
    maxTicks: 99999,
    bossHealth: 9999999,
  });
  expectEqual(loose.max_ticks, MAX_MAX_TICKS, 'match length clamps down to the maximum');
  expectEqual(loose.boss_health, MAX_BOSS_HEALTH, 'boss health clamps down to the maximum');
});

test('match length snaps to whole seconds', () => {
  const params = roomSetupToModeParams({ ...defaultRoomSetup('mvp_boss_race'), maxTicks: 1831 });
  expectEqual(Number(params.max_ticks) % 60, 0, 'tick count stays on a one-second step');
});

test('a room snapshot refills the panel', () => {
  const state = roomSetupFromModeParams('coop_boss', {
    boss_id: 'tian',
    stage_id: 'lunar_maze',
    coop_players: 4,
    max_ticks: 1800,
    boss_health: 12000,
  });
  expectEqual(state.bossId, 'tian', 'boss');
  expectEqual(state.stageId, 'lunar_maze', 'stage');
  expectEqual(state.coopPlayers, 4, 'seats');
  expectEqual(state.maxTicks, 1800, 'match length');
  expectEqual(state.bossHealth, 12000, 'boss health');
});

test('an empty or absent snapshot leaves the defaults alone', () => {
  const empty = roomSetupFromModeParams('mvp_boss_race', undefined);
  expectEqual(empty.bossId, '', 'no boss');
  expectEqual(empty.maxTicks, 0, 'no match length');
  expectEqual(empty.bossHealth, 0, 'no boss health');
});

test('numeric options survive a stringified snapshot', () => {
  const state = roomSetupFromModeParams('mvp_boss_race', { max_ticks: '1800', boss_health: '12000' });
  expectEqual(state.maxTicks, 1800, 'match length parsed from a string');
  expectEqual(state.bossHealth, 12000, 'boss health parsed from a string');
});

test('only the host can edit, and only while the room waits', () => {
  expect(roomSetupEditable(true, 'waiting'), 'host in a waiting room');
  expect(!roomSetupEditable(true, 'found'), 'locked once a match is found');
  expect(!roomSetupEditable(false, 'waiting'), 'a guest never edits');
  expect(!roomSetupEditable(false, 'found'), 'guest in a found room');
});

test('the summary reads as one line of rules', () => {
  const plain = roomSetupSummary(defaultRoomSetup('mvp_boss_race'));
  expectEqual(plain, '默认', 'a default room says default');

  const custom = roomSetupSummary({
    modeId: 'coop_boss',
    bossId: 'hui',
    stageId: '',
    coopPlayers: 4,
    maxTicks: 1800,
    bossHealth: 12000,
  });
  expectEqual(custom, 'hui · 4人 · 30秒 · HP 12000', 'custom rules');
});

test('the server list wins over the local one', () => {
  const fromServer = resolvePlayableModes(['mvp_boss_race', 'coop_boss', 'certification']);
  expectEqual(fromServer.length, 3, 'the server may offer more than the local list');
  expect(fromServer.indexOf('certification') >= 0, 'a newly playable mode shows up');
});

test('an empty server list falls back instead of hiding everything', () => {
  const empty = resolvePlayableModes([]);
  expectEqual(empty.length, PLAYABLE_MODE_IDS.length, 'falls back to the local list');
  const absent = resolvePlayableModes(undefined);
  expectEqual(absent.length, PLAYABLE_MODE_IDS.length, 'absent also falls back');
});

test('availability distinguishes playable from declared-but-not-built', () => {
  const race = modeAvailability('mvp_boss_race', undefined);
  expect(race.playable && race.declared, 'race is both declared and playable');

  const world = modeAvailability('world_boss', undefined);
  expect(!world.playable && world.declared, 'world boss is declared but not built');

  const unknown = modeAvailability('not_a_mode', undefined);
  expect(!unknown.playable && !unknown.declared, 'unknown mode is neither');
});
