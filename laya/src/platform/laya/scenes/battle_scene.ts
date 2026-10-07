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
import type { HudState } from '../view/hud';
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
  /**
   * Server-side tick cap, used for the HUD countdown. Optional: when omitted
   * the countdown row is hidden rather than showing a made-up value. The battle
   * server runs with `--max-ticks 7200` by default, so callers that know that
   * figure should pass it.
   */
  matchTickLimit?: number;
  /** Tick rate for the countdown clock. Defaults to the simulation's 60Hz. */
  tickRateHz?: number;
  onMatchEnd?: (winnerPlayerId: string) => void;
}

/**
 * Height reserved for the HUD strip below the playfield. Tall enough for the
 * structured HUD's label / bar / value / damage rows plus the footer line, with
 * padding — see `drawHudBar`.
 */
const HUD_HEIGHT = 108;

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
      layout: { width: options.width, height: options.height - HUD_HEIGHT },
      hudHeight: HUD_HEIGHT,
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

  /** Debug-only: direct view access for the local screenshot harness. */
  get __debugView(): BossRaceView {
    return this.view;
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
      layout: { width: this.options.width, height: this.options.height - HUD_HEIGHT },
      localPlayerId: this.options.localPlayerId(),
      bossMaxHp: this.options.bossMaxHp,
    });
    this.view.render(this.frame, this.hudLines(source), this.hudState(source));
  }

  /**
   * Assembles the structured HUD state consumed by the vector HUD strip. The
   * string rows from `hudLines` remain the fallback; this richer shape lets the
   * view draw bars and badges instead of monospaced text.
   */
  private hudState(snapshot: BossRaceSnapshot): HudState {
    const metrics = this.options.battle.metrics;
    const local = snapshot.players.find((player) => player.playerId === this.options.localPlayerId());
    const opponent = snapshot.players.find((player) => player.playerId !== this.options.localPlayerId());
    const maxHp = this.options.bossMaxHp > 0 ? this.options.bossMaxHp : 1;
    const hashTotal = metrics.hashMatches + metrics.hashMismatches;
    return {
      localHpRatio: Math.max(0, Math.min(1, (local?.bossCurrentHp ?? 0) / maxHp)),
      rivalHpRatio: Math.max(0, Math.min(1, (opponent?.bossCurrentHp ?? 0) / maxHp)),
      bossMaxHp: this.options.bossMaxHp,
      localHp: local?.bossCurrentHp ?? 0,
      rivalHp: opponent?.bossCurrentHp ?? 0,
      damageDealt: local?.damageDealt ?? 0,
      tick: snapshot.tick,
      stateName: BossRaceState[snapshot.state] ?? String(snapshot.state),
      patternId: patternFor(snapshot.tick),
      bullets: snapshot.bullets.length,
      connectionLabel: this.authoritative === null ? 'predicted' : 'server',
      metricsLine: `snaps ${metrics.snapshotsReceived} · err ${metrics.averagePositionErrorMilli.toFixed(0)} · hash ${metrics.hashMatches}/${hashTotal} · snap ${metrics.hardSnaps}`,
      tickLimit: this.options.matchTickLimit,
      tickRateHz: this.options.tickRateHz,
    };
  }

  /**
   * Builds the HUD text block returned to `BossRaceView.render(frame, hudLines)`.
   *
   * The contract stays a `string[]` (the view renders it verbatim), but the rows
   * are now laid out as aligned `LABEL  value` columns so the eye can scan down a
   * column instead of parsing one long line. Row order is by importance:
   *   1. Boss HP / damage / rival HP  — the race outcome, kept first and loudest
   *   2. connection + tick + state + pattern
   *   3. input + bullet count
   *   4. reconciliation metrics (network health)
   */
  private hudLines(snapshot: BossRaceSnapshot): string[] {
    const battle = this.options.battle;
    const raw = this.options.input.snapshot();
    const metrics = battle.metrics;
    const stateName = BossRaceState[snapshot.state] ?? String(snapshot.state);
    const local = snapshot.players.find((player) => player.playerId === this.options.localPlayerId());
    const opponent = snapshot.players.find((player) => player.playerId !== this.options.localPlayerId());
    const source = this.authoritative === null ? 'predicted' : 'server';
    const inputs = [describeDirectionBits(rawToBits(raw)), raw.shoot ? 'shoot' : '', raw.slow ? 'focus' : '']
      .filter((value) => value !== '')
      .join(' ');
    const hashTotal = metrics.hashMatches + metrics.hashMismatches;
    return [
      row('BOSS', `HP ${local?.bossCurrentHp ?? '-'}/${this.options.bossMaxHp}`, `dmg ${local?.damageDealt ?? 0}`, `rival ${opponent?.bossCurrentHp ?? '-'}`),
      row('NET', source, `tick ${snapshot.tick}`, stateName, `pattern ${patternFor(snapshot.tick)}`),
      row('FP', `bullets ${snapshot.bullets.length}`, inputs),
      row('SYNC', `snaps ${metrics.snapshotsReceived}`, `err ${metrics.averagePositionErrorMilli.toFixed(0)}`, `hash ${metrics.hashMatches}/${hashTotal}`, `snap ${metrics.hardSnaps}`),
    ];
  }
}

/** Joins HUD cells with a fixed gutter so columns line up across rows. */
function row(label: string, ...cells: string[]): string {
  return `${label.padEnd(5)} │ ${cells.join('  ·  ')}`;
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
