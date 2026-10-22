/**
 * 建房设置（雀魂友人场式）的选项定义与编解码。
 *
 * 服务端已经能接收并持久化这些选项（`rooms.create` 的 `mode_params`，
 * `rooms.update` / `POST /v1/rooms/{code}/options` 改选），本文件是客户端这一侧
 * 的单一真相：面板显示什么、默认值是什么、怎么编成请求参数、怎么从房间快照
 * 还原成面板状态。
 *
 * 两条纪律：
 *
 * 1. **可玩模式列表与服务端一致**。服务端只提供 `mvp_boss_race` 与 `coop_boss`
 *    两套模拟，其余模式建了房也会在开局时失败（`mode_unavailable`）。这里把未
 *    实现的模式标为不可选，而不是让玩家点了才报错。服务端加一个可玩模式时，
 *    这里必须同步。
 * 2. **boss 血量键名是 `boss_health` 不是 `boss_hp`**。`boss_hp` 属于客户端禁列
 *    字段——客户端提交它等于可以谎报 boss 剩余血量。房间选项走的是客户端提交的
 *    `mode_params`，所以这个名字会被服务端直接拒掉。详见
 *    `Gensoulkyo/runtime/core/service.go` 的 `forbiddenClientFields`。
 */

/** 当前真正能打完一局的模式（与服务端 `PlayableModeIDs()` 一致）。 */
export const PLAYABLE_MODE_IDS: readonly string[] = ['mvp_boss_race', 'coop_boss'];

/** 已声明但尚无对局服实现的模式：面板要显示为「即将推出」而不是缺失。 */
export const DECLARED_MODE_IDS: readonly string[] = [
  'mvp_boss_race',
  'coop_boss',
  'certification',
  'pvp_duel',
  'battle_royale',
  'world_boss',
  'instance_boss',
];

export function isPlayableMode(modeId: string): boolean {
  return PLAYABLE_MODE_IDS.indexOf(modeId) >= 0;
}

/**
 * 用服务端返回的列表判定可玩模式，服务端没给（或给了空）时才退回本地列表。
 *
 * 顺序很重要：服务端是权威——它才知道对局服里真正装了哪几套模拟。本地列表只是
 * 兜底，让面板在拿不到接口时不至于把所有模式都藏起来。反过来做（以本地为准）
 * 会让「服务端新增了一个可玩模式、客户端却继续隐藏它」这种漂移无人发现。
 */
export function resolvePlayableModes(serverModeIds: readonly string[] | undefined): readonly string[] {
  if (serverModeIds && serverModeIds.length > 0) {
    return serverModeIds.slice();
  }
  return PLAYABLE_MODE_IDS;
}

/** 面板用：这个模式能不能选，选不了要不要显示「即将推出」。 */
export interface RoomModeAvailability {
  readonly playable: boolean;
  readonly declared: boolean;
}

export function modeAvailability(
  modeId: string,
  serverModeIds: readonly string[] | undefined,
): RoomModeAvailability {
  const declared = DECLARED_MODE_IDS.indexOf(modeId) >= 0;
  return {
    playable: resolvePlayableModes(serverModeIds).indexOf(modeId) >= 0,
    declared,
  };
}

/** 一个建房选项。 */
export interface RoomSetupOption {
  /** `mode_params` 里的键。 */
  readonly key: string;
  /** 房主专属（房间级）还是每位玩家各自选择。 */
  readonly hostOnly: boolean;
  /** 只在列出的模式里显示；省略 = 所有模式。 */
  readonly modes?: readonly string[];
}

export const ROOM_SETUP_OPTIONS: readonly RoomSetupOption[] = [
  { key: 'boss_id', hostOnly: true },
  { key: 'stage_id', hostOnly: false },
  { key: 'coop_players', hostOnly: true, modes: ['coop_boss'] },
  { key: 'max_ticks', hostOnly: true },
  { key: 'boss_health', hostOnly: true },
];

/** 对局时长（tick）的边界，与服务端 `MinRoomMaxTicks` / `MaxRoomMaxTicks` 对齐。 */
export const MIN_MAX_TICKS = 600;
export const MAX_MAX_TICKS = 7200;
export const MAX_TICKS_STEP = 60;

/** boss 血量的边界，与服务端 `MinRoomBossHP` / `MaxRoomBossHP` 对齐。 */
export const MIN_BOSS_HEALTH = 1000;
export const MAX_BOSS_HEALTH = 100000;

/** 面板状态：房主的选择 + 本机玩家的自机选择。 */
export interface RoomSetupState {
  modeId: string;
  /** boss；空串 = 默认 timeline。 */
  bossId: string;
  stageId: string;
  /** coop_boss 的座位数，2 或 4；其他模式忽略。 */
  coopPlayers: number;
  /** 对局时长（tick）；0 = 用对局服默认。 */
  maxTicks: number;
  /** boss 血量；0 = 用 boss 目录的值。 */
  bossHealth: number;
}

export function defaultRoomSetup(modeId = 'mvp_boss_race'): RoomSetupState {
  return {
    modeId,
    bossId: '',
    stageId: '',
    coopPlayers: modeId === 'coop_boss' ? 2 : 0,
    maxTicks: 0,
    bossHealth: 0,
  };
}

function clampOption(value: number, min: number, max: number, step: number): number {
  if (!isFinite(value) || value <= 0) {
    return 0;
  }
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(clamped / step) * step;
}

/**
 * 面板状态 → `mode_params`。
 *
 * 只输出非默认值：把一个没选过的选项显式写成 0，等于把「未设置」和「设为 0」
 * 混在一起，服务端那边的语义是前者用默认、后者也是默认，但请求体会因此变长，
 * 而且房间快照里会多出一堆无意义的键。
 */
export function roomSetupToModeParams(state: RoomSetupState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (state.bossId !== '') {
    out.boss_id = state.bossId;
  }
  if (state.stageId !== '') {
    out.stage_id = state.stageId;
  }
  if (state.modeId === 'coop_boss' && state.coopPlayers > 0) {
    out.coop_players = state.coopPlayers;
  }
  if (state.maxTicks > 0) {
    out.max_ticks = clampOption(state.maxTicks, MIN_MAX_TICKS, MAX_MAX_TICKS, MAX_TICKS_STEP);
  }
  if (state.bossHealth > 0) {
    out.boss_health = clampOption(state.bossHealth, MIN_BOSS_HEALTH, MAX_BOSS_HEALTH, 1);
  }
  return out;
}

function readString(params: Record<string, unknown>, key: string): string {
  const raw = params[key];
  return typeof raw === 'string' ? raw : '';
}

function readNumber(params: Record<string, unknown>, key: string): number {
  const raw = params[key];
  if (typeof raw === 'number' && isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** 房间快照的 `mode_params` → 面板状态，用于打开房间时回填面板。 */
export function roomSetupFromModeParams(
  modeId: string,
  params: Record<string, unknown> | undefined,
): RoomSetupState {
  const state = defaultRoomSetup(modeId);
  if (!params) {
    return state;
  }
  state.bossId = readString(params, 'boss_id');
  state.stageId = readString(params, 'stage_id');
  const seats = readNumber(params, 'coop_players');
  if (modeId === 'coop_boss' && (seats === 2 || seats === 4)) {
    state.coopPlayers = seats;
  }
  state.maxTicks = clampOption(readNumber(params, 'max_ticks'), MIN_MAX_TICKS, MAX_MAX_TICKS, MAX_TICKS_STEP);
  state.bossHealth = clampOption(readNumber(params, 'boss_health'), MIN_BOSS_HEALTH, MAX_BOSS_HEALTH, 1);
  return state;
}

/**
 * 房主能否改设置。
 *
 * 服务端会再判一次（房主 + waiting），这里只是让 UI 别给出点了必然失败的按钮。
 */
export function roomSetupEditable(isHost: boolean, roomStatus: string): boolean {
  return isHost && roomStatus === 'waiting';
}

/** 房间顶部常驻摘要条：一句话说明这局是什么规则。 */
export function roomSetupSummary(state: RoomSetupState): string {
  const parts: string[] = [];
  parts.push(state.bossId === '' ? '默认' : state.bossId);
  if (state.modeId === 'coop_boss') {
    parts.push(`${state.coopPlayers}人`);
  }
  if (state.maxTicks > 0) {
    // 60Hz：tick 数除以 60 就是秒。
    parts.push(`${Math.round(state.maxTicks / 60)}秒`);
  }
  if (state.bossHealth > 0) {
    parts.push(`HP ${state.bossHealth}`);
  }
  return parts.join(' · ');
}
