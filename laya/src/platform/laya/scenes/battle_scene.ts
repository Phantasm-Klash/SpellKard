/**
 * Battle screen: drives the fixed-tick loop, sends input, renders the race.
 *
 * Rendering prefers the latest authoritative server snapshot and falls back to
 * the local prediction before the first snapshot arrives. The local
 * `BossRaceSimulation` still runs every tick so reconciliation metrics (position
 * error, state-hash match, hard-snap count) stay meaningful.
 */

import type { BattleClient } from '../../../core/net/battle_client';
import { BattleConnectionState } from '../../../core/net/battle_client';
import type { TimerLike } from '../../../core/net/transport';
import { buildBossRaceFrame, type BossRaceFrame } from '../../../core/game/boss_race_view_model';
import { describeDirectionBits, encodeInput } from '../../../core/game/input';
import type { BossRaceSnapshot } from '../../../core/sim/boss_race';
import {
  BOSS_RACE_PATTERN_IDS,
  BOSS_RACE_PATTERN_PERIOD_TICKS,
  BossRaceState,
} from '../../../core/sim/boss_race';
import type { LayaInput } from '../laya_input';
import { BossRaceView } from '../view/boss_race_view';
import type { ClientScene } from './scene';

export interface BattleSceneOptions {
  width: number;
  height: number;
  battle: BattleClient;
  input: LayaInput;
  timer: TimerLike;
  /** Lazily read: the player id is only known after lobby sign-in. */
  localPlayerId: () => string;
  bossMaxHp: number;
  onMatchEnd?: (winnerPlayerId: string) => void;
}

export class BattleScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly view: BossRaceView;
  private readonly options: BattleSceneOptions;
  private authoritative: BossRaceSnapshot | null = null;
  private tickHandle = 0;
  private running = false;
  private frame: BossRaceFrame | null = null;
  private matchEnded = false;

  constructor(options: BattleSceneOptions) {
    this.options = options;
    this.root = new Laya.Sprite();
    this.root.size(options.width, options.height);
    this.root.visible = false;

    this.view = new BossRaceView({
      layout: { width: options.width, height: options.height - 80 },
      hudHeight: 80,
    });
    this.root.addChild(this.view.root);

    this.options.battle.onSnapshot((snapshot) => {
      this.authoritative = snapshot;
      if (snapshot.winnerPlayerId !== '' && !this.matchEnded) {
        this.matchEnded = true;
        this.options.onMatchEnd?.(snapshot.winnerPlayerId);
      }
    });
  }

  onEnter(): void {
    this.root.visible = true;
    this.start();
  }

  onExit(): void {
    this.root.visible = false;
    this.stop();
  }

  destroy(): void {
    this.stop();
    this.view.destroy();
    this.root.destroy(true);
  }

  get currentFrame(): BossRaceFrame | null {
    return this.frame;
  }

  /** Starts the fixed-tick loop at the battle client's tick rate. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.matchEnded = false;
    this.tickHandle = this.options.timer.setInterval(
      () => this.step(),
      this.options.battle.tickIntervalMs,
    );
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.options.timer.clearInterval(this.tickHandle);
  }

  /** One simulation tick: read input, send it, advance prediction, render. */
  step(): void {
    const battle = this.options.battle;
    if (battle.state !== BattleConnectionState.Running) {
      this.renderFrame();
      return;
    }
    const raw = this.options.input.snapshot();
    const encoded = encodeInput(raw);
    const tick = (battle.simulationRef?.getCurrentTick() ?? 0) + 1;
    battle.sendInput(
      tick,
      encoded.directionBits,
      encoded.slow,
      encoded.shoot,
      encoded.bomb,
      encoded.cardSlot,
    );
    this.options.input.consumeTransient();
    battle.tick();
    this.renderFrame();
  }

  private renderFrame(): void {
    const battle = this.options.battle;
    const source = this.authoritative ?? battle.simulationRef?.snapshot() ?? null;
    if (source === null) {
      return;
    }
    this.frame = buildBossRaceFrame(source, {
      layout: { width: this.options.width, height: this.options.height - 80 },
      localPlayerId: this.options.localPlayerId(),
      bossMaxHp: this.options.bossMaxHp,
    });
    this.view.render(this.frame, this.hudLines(source));
  }

  private hudLines(snapshot: BossRaceSnapshot): string[] {
    const battle = this.options.battle;
    const raw = this.options.input.snapshot();
    const metrics = battle.metrics;
    const stateName = BossRaceState[snapshot.state] ?? String(snapshot.state);
    const local = snapshot.players.find((player) => player.playerId === this.options.localPlayerId());
    const opponent = snapshot.players.find((player) => player.playerId !== this.options.localPlayerId());
    const source = this.authoritative === null ? 'predicted' : 'server';
    return [
      `${source} · tick ${snapshot.tick} · ${stateName} · pattern ${patternFor(snapshot.tick)}`,
      `Boss HP ${local?.bossCurrentHp ?? '-'}/${this.options.bossMaxHp} · damage ${local?.damageDealt ?? 0}` +
        ` · rival HP ${opponent?.bossCurrentHp ?? '-'}`,
      `bullets ${snapshot.bullets.length} · input ${describeDirectionBits(rawToBits(raw))}` +
        `${raw.shoot ? ' +shoot' : ''}${raw.slow ? ' +focus' : ''}`,
      `snapshots ${metrics.snapshotsReceived} · err ${metrics.averagePositionErrorMilli.toFixed(0)}` +
        ` · hash ${metrics.hashMatches}/${metrics.hashMatches + metrics.hashMismatches}` +
        ` · hardSnap ${metrics.hardSnaps}`,
    ];
  }
}

function patternFor(tick: number): string {
  const index = Math.floor(tick / BOSS_RACE_PATTERN_PERIOD_TICKS) % BOSS_RACE_PATTERN_IDS.length;
  return BOSS_RACE_PATTERN_IDS[index];
}

function rawToBits(raw: { left: boolean; right: boolean; up: boolean; down: boolean }): number {
  let bits = 0;
  if (raw.up) {
    bits |= 0x1;
  }
  if (raw.right) {
    bits |= 0x2;
  }
  if (raw.down) {
    bits |= 0x4;
  }
  if (raw.left) {
    bits |= 0x8;
  }
  return bits;
}
