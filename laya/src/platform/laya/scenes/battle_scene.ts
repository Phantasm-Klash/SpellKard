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
 * The status panel is a vertical strip pinned to the right of the stage; the
 * playfield keeps its 2:3 portrait ratio and fills the full stage height, so
 * the panel gets exactly the width that is left over. Nothing is letterboxed
 * vertically and the two panes tile the stage edge to edge.
 */
const PLAYFIELD_ASPECT = 3 / 2;

/** Geometry for a stage of `width` x `height`. */
function battleLayout(width: number, height: number): {
  playfield: { width: number; height: number };
  playfieldX: number;
  playfieldY: number;
  hudX: number;
  hudWidth: number;
  hudHeight: number;
} {
  // The playfield owns the full stage height at its fixed 2:3 ratio; the panel
  // takes the remainder. Clamp the playfield so a very wide stage still leaves
  // the panel a readable width.
  const idealPlayfieldWidth = Math.round(height / PLAYFIELD_ASPECT);
  const playfieldWidth = Math.min(idealPlayfieldWidth, Math.max(0, width - MIN_HUD_WIDTH));
  const playfieldHeight = Math.round(playfieldWidth * PLAYFIELD_ASPECT);
  const hudWidth = Math.max(0, width - playfieldWidth);
  return {
    playfield: { width: playfieldWidth, height: playfieldHeight },
    playfieldX: 0,
    playfieldY: Math.round((height - playfieldHeight) / 2),
    hudX: playfieldWidth,
    hudWidth,
    hudHeight: height,
  };
}

/**
 * Minimum width the status panel may shrink to. Below this the cards stop
 * reading, so the playfield yields width rather than the panel.
 */
const MIN_HUD_WIDTH = 240;

export class BattleScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly view: BossRaceView;
  private readonly options: BattleSceneOptions;
  private readonly geometry: ReturnType<typeof battleLayout>;
  private authoritative: BossRaceSnapshot | null = null;
  private tickHandle = 0;
  private running = false;
  private frame: BossRaceFrame | null = null;
  private matchEnded = false;

  constructor(options: BattleSceneOptions) {
    this.options = options;
    this.geometry = battleLayout(options.width, options.height);
    this.root = new Laya.Sprite();
    this.root.size(options.width, options.height);
    this.root.visible = false;

    this.view = new BossRaceView({
      layout: this.geometry.playfield,
      playfieldX: this.geometry.playfieldX,
      playfieldY: this.geometry.playfieldY,
      hudWidth: this.geometry.hudWidth,
      hudHeight: this.geometry.hudHeight,
      hudX: this.geometry.hudX,
      stageWidth: options.width,
      stageHeight: options.height,
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
    // The playfield is a 2:3 portrait rectangle on the left; the status panel is
    // the vertical strip on the right. `buildBossRaceFrame` scales the milli-
    // unit arena uniformly from the playfield width, so only the playfield
    // geometry is passed here — the panel is sized in `drawHudBar` instead.
    this.frame = buildBossRaceFrame(source, {
      layout: this.geometry.playfield,
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
    const damageDealt = local?.damageDealt ?? 0;
    return {
      localHpRatio: Math.max(0, Math.min(1, (local?.bossCurrentHp ?? 0) / maxHp)),
      rivalHpRatio: Math.max(0, Math.min(1, (opponent?.bossCurrentHp ?? 0) / maxHp)),
      bossMaxHp: this.options.bossMaxHp,
      localHp: local?.bossCurrentHp ?? 0,
      rivalHp: opponent?.bossCurrentHp ?? 0,
      damageDealt,
      score: damageDealt,
      ultCooldownRatio: this.ultCooldownRatio(snapshot.tick),
      ultReady: this.ultCooldownRatio(snapshot.tick) <= 0,
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
   * PLACEHOLDER ultimate-cooldown fraction (0 = ready, 1 = just fired).
   *
   * There is no ultimate ability in the simulation or the wire protocol yet, so
   * this is derived from the tick alone to give the status bar a live-moving
   * demo value: a fixed-length charge cycle that free-runs off the tick clock.
   * Replace this with the real server-provided cooldown once the ability lands;
   * the HUD already degrades gracefully when the value is absent.
   */
  private ultCooldownRatio(tick: number): number {
    const period = this.options.tickRateHz ?? 60;
    const cycle = Math.max(1, period * 8);
    const phase = ((tick % cycle) + cycle) % cycle;
    return phase / cycle;
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
