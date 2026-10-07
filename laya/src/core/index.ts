/**
 * Public surface of the engine-agnostic core layer.
 *
 * Everything exported here is free of DOM, Node and LayaAir globals and is
 * type-checked in isolation by `tsc -p tsconfig.json`.
 */

export * from './math/deterministic';
export * from './math/hash64';

export * from './protocol/types';
export * from './protocol/codec';
export * from './protocol/descriptor.generated';

export * from './net/transport';
export * from './net/lobby_client';
export * from './net/ikcp';
export * from './net/kcp_transport';
// `battle_codec` re-implements a few generic helpers that already exist in
// `protocol/codec` and `lobby_client`, so it is re-exported explicitly.
export {
  ByteReader,
  ByteWriter,
  decodeBattleInput,
  decodeBattleResult,
  decodeBossRaceSnapshot,
  encodeBattleInput,
  encodeHandshakeHello,
  encodePingPayload,
  peekPayloadType,
} from './net/battle_codec';
export type { BattleResultPayload } from './net/battle_codec';
export * from './net/battle_crypto';
export * from './net/battle_client';

export * from './sim/boss_race';

export * from './game/input';
export * from './game/boss_race_view_model';
export * from './game/bullet_visual';
export * from './game/lobby_flow';
