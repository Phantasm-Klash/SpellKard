/**
 * `.dem` replay: rebuild the authoritative `BossRaceSimulation` from a
 * `DemDocument`, feed the recorded inputs tick by tick, and check the server's
 * `final_state_hash`.
 *
 * Scope (thread B, milestone B3/B4): this is the container→simulation skeleton.
 * The exact byte-for-byte equality of {@link DemReplayer.runToEnd} against the
 * server's `final_state_hash` depends on the room boss / loadout semantics
 * landing in thread A's `boss_catalog` / `loadout` mirrors; until then the
 * replayer reports a hash mismatch (`hashMatched=false`) instead of throwing.
 *
 * 客户端播放：解压 → 按 header 重建本地 BossRaceSimulation → 逐 tick 喂输入 →
 * 校验 final_state_hash → 时间轴拖动（整段重推 + 每 300 tick 关键帧缓存）。
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

import { BossRaceSimulation, type BossRaceConfig, type BossRaceInput, type BossRaceSnapshot } from '../sim/boss_race';
import type { BossRaceSeed } from '../math/boss_race_seed';
import { ZERO_BOSS_RACE_SEED } from '../math/boss_race_seed';
import { decodeCanonicalInputPayload, parseDemDocument, type DemDocument, type DemHeader } from './parse';

export const DEM_DEFAULT_KEYFRAME_INTERVAL_TICKS = 300;
/** Server `MatchServer` spawn positions (`src/match_lifecycle.cpp:634`). */
export const DEM_PLAYER_SPAWN_X_MILLI = 20000;
export const DEM_PLAYER_SPAWN_Y_MILLI = 60000;

/**
 * Build a full-width `BossRaceSeed` from the header's decimal `server_seed`
 * (`std::to_string(uint64_t)`), preserving all 64 bits without BigInt.
 */
export function bossRaceSeedFromDecimal(decimal: string): BossRaceSeed {
  const clean = decimal.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  if (clean === '') {
    return ZERO_BOSS_RACE_SEED;
  }
  let low32 = 0;
  let hi32 = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const digit = clean.charCodeAt(i) - 48;
    const product = low32 * 10 + digit; // < 2**36, exact in a JS number
    low32 = product >>> 0;
    const carry = Math.floor(product / 0x100000000);
    hi32 = (hi32 * 10 + carry) >>> 0;
  }
  return { decimal: clean, low32, hi32 };
}

export interface DemReplayFrame {
  tick: number;
  snapshot: BossRaceSnapshot;
}

export interface DemReplayResult {
  document: DemDocument;
  finalTick: number;
  /** Server-declared hash from the header. */
  declaredStateHash: string;
  /** Hash recomputed by the local replay at `finalTick`. */
  replayedStateHash: string;
  hashMatched: boolean;
  acceptedInputs: number;
  skippedInputs: number;
  completed: boolean;
}

interface TickInputGroup {
  inputs: BossRaceInput[];
}

/**
 * Build the local simulation config from a dem header. `bossMaxHp: 0` lets the
 * simulation resolve HP from the boss catalog (mirroring the server) or fall
 * back to the default; `loadouts`/`bossId` come straight from the header.
 */
export function bossRaceConfigFromDemHeader(header: DemHeader): BossRaceConfig {
  return {
    matchId: header.match_id,
    modeId: header.mode_id,
    rulesetVersion: header.ruleset_version,
    matchSeed: bossRaceSeedFromDecimal(header.server_seed),
    // The server records its boss HP whenever it deviates from the catalog
    // default (a `--boss-hp` match), and player HP is part of the state hash, so
    // a recording without this value can never be replayed faithfully.
    bossMaxHp: header.boss_max_hp ?? 0,
    tickRateHz: header.tick_rate_hz,
    patternPeriodTicks: 0,
    bossId: header.boss_id,
    loadouts: header.players.map((player) => ({
      playerId: player.player_id,
      characterId: player.loadout.character_id,
      shotType: player.loadout.shot_type,
      bombType: player.loadout.bomb_type,
    })),
  };
}

/**
 * Replays a parsed dem document. Drives one tick at a time for live playback
 * (no seek O(1): dragging re-runs from tick 0), caching a keyframe snapshot every
 * `keyframeIntervalTicks` for scrubbing.
 */
export class DemReplayer {
  readonly header: DemHeader;
  private readonly groups: Map<number, TickInputGroup> = new Map();
  private readonly keyframeInterval: number;
  private readonly keyframesByTick: Map<number, DemReplayFrame> = new Map();
  private simulation: BossRaceSimulation;
  private result: DemReplayResult | undefined;
  private acceptedInputs = 0;
  private skippedInputs = 0;

  constructor(document: DemDocument, options: { keyframeIntervalTicks?: number } = {}) {
    this.header = document.header;
    this.keyframeInterval = options.keyframeIntervalTicks ?? DEM_DEFAULT_KEYFRAME_INTERVAL_TICKS;
    for (const entry of document.entries) {
      if (entry.action_type !== 'input') {
        // match_seed / mode actions are not inputs to BossRaceSimulation.
        continue;
      }
      const fields = decodeCanonicalInputPayload(entry.payload);
      const input: BossRaceInput = {
        playerId: entry.player_id,
        tick: entry.tick,
        seq: fields.seq,
        directionBits: fields.directionBits,
        slow: fields.slow,
        shoot: fields.shoot,
        bomb: fields.bomb,
        cardSlot: fields.cardSlot,
        modeActionId: fields.modeActionId,
      };
      const group = this.groups.get(entry.tick) ?? { inputs: [] };
      group.inputs.push(input);
      this.groups.set(entry.tick, group);
    }
    this.simulation = this.buildSimulation();
  }

  private buildSimulation(): BossRaceSimulation {
    const simulation = new BossRaceSimulation(bossRaceConfigFromDemHeader(this.header));
    this.header.players.forEach((player, index) => {
      const x = index % 2 === 0 ? -DEM_PLAYER_SPAWN_X_MILLI : DEM_PLAYER_SPAWN_X_MILLI;
      simulation.addPlayer(player.player_id, x, DEM_PLAYER_SPAWN_Y_MILLI);
    });
    return simulation;
  }

  get currentTick(): number {
    return this.simulation.getCurrentTick();
  }

  get finalTick(): number {
    return this.header.final_tick;
  }

  get simulationRef(): BossRaceSimulation {
    return this.simulation;
  }

  get keyframes(): readonly DemReplayFrame[] {
    return [...this.keyframesByTick.values()].sort((a, b) => a.tick - b.tick);
  }

  get finalResult(): DemReplayResult | undefined {
    return this.result;
  }

  /** Reset to tick 0 (fresh simulation, cached keyframes kept). */
  reset(): void {
    this.simulation = this.buildSimulation();
    this.acceptedInputs = 0;
    this.skippedInputs = 0;
    this.result = undefined;
  }

  /** Feed this tick's inputs (in body order) then advance one tick. */
  step(): BossRaceSnapshot {
    const nextTick = this.simulation.getCurrentTick() + 1;
    const group = this.groups.get(nextTick);
    if (group !== undefined) {
      for (const input of group.inputs) {
        if (this.simulation.submitInput(input)) {
          this.acceptedInputs += 1;
        } else {
          this.skippedInputs += 1;
        }
      }
    }
    const snapshot = this.simulation.tick();
    if (nextTick % this.keyframeInterval === 0) {
      this.keyframesByTick.set(nextTick, { tick: nextTick, snapshot });
    }
    return snapshot;
  }

  /** Run to the header's `final_tick` and verify the final state hash. */
  runToEnd(): DemReplayResult {
    if (this.result !== undefined) {
      return this.result;
    }
    let snapshot = this.simulation.snapshot();
    while (this.simulation.getCurrentTick() < this.header.final_tick) {
      snapshot = this.step();
    }
    const replayed = this.simulation.canonicalStateHash();
    this.keyframesByTick.set(this.header.final_tick, { tick: this.header.final_tick, snapshot });
    this.result = {
      document: { header: this.header, entries: [] },
      finalTick: this.header.final_tick,
      declaredStateHash: this.header.final_state_hash,
      replayedStateHash: replayed,
      hashMatched: replayed === this.header.final_state_hash,
      acceptedInputs: this.acceptedInputs,
      skippedInputs: this.skippedInputs,
      completed: true,
    };
    return this.result;
  }

  /** Cached keyframe snapshot at or before `tick` (for timeline scrubbing display). */
  keyframeAt(tick: number): DemReplayFrame | undefined {
    let best: DemReplayFrame | undefined;
    for (const frame of this.keyframesByTick.values()) {
      if (frame.tick <= tick && (best === undefined || frame.tick > best.tick)) {
        best = frame;
      }
    }
    return best;
  }

  /** Re-run from tick 0 to `tick` and return the snapshot (dragging = whole re-sim). */
  seek(tick: number): BossRaceSnapshot {
    const target = Math.max(0, Math.min(tick, this.header.final_tick));
    if (target < this.simulation.getCurrentTick()) {
      this.reset();
    }
    let snapshot = this.simulation.snapshot();
    while (this.simulation.getCurrentTick() < target) {
      snapshot = this.step();
    }
    return snapshot;
  }
}

/** Parse raw `.dem` bytes and build a replayer (single entry point for the UI). */
export function replayerFromDemBytes(bytes: Uint8Array, keyframeIntervalTicks?: number): DemReplayer {
  const document = parseDemDocument(bytes);
  return new DemReplayer(document, keyframeIntervalTicks === undefined ? {} : { keyframeIntervalTicks });
}
