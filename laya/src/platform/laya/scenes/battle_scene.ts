/**
 * Battle screen: drives the fixed-tick loop, sends input, renders the race.
 *
 * Rendering prefers the latest authoritative server snapshot and falls back to
 * the local prediction before the first snapshot arrives. The local
 * `BossRaceSimulation` still runs every tick so reconciliation metrics (position
 * error, state-hash match, hard-snap count) stay meaningful.
 */

import type { BattleClient, BattleCorrectionMetrics } from '../../../core/net/battle_client';
import { BattleConnectionState } from '../../../core/net/battle_client';
import type { TimerLike } from '../../../core/net/transport';
import { battleLayout, type BattleLayout } from '../../../core/game/battle_layout';
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
import { AtlasBulletRenderer } from '../view/bullets';
import { sharedTnaFrameSource } from '../view/bullet_atlas';
import type { HudState } from '../view/hud';
import * as theme from '../view/theme';
import type { ShortcutAction, ShortcutScope } from '../../../core/input/shortcuts';
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

export class BattleScene implements ClientScene {
  readonly root: Laya.Sprite;
  readonly shortcutScope: ShortcutScope = 'battle';

  private readonly view: BossRaceView;
  private readonly options: BattleSceneOptions;
  private geometry: BattleLayout;
  // Shared with `BossRaceView`'s actor renderer so the 25 atlases are sliced
  // once, not once per instance.
  private readonly bulletAtlas = sharedTnaFrameSource();
  private readonly bulletRenderer: AtlasBulletRenderer;
  /** Full-stage banner shown while the tick loop is held by `battle.pause`. */
  private readonly pauseOverlay: Laya.Text;
  private authoritative: BossRaceSnapshot | null = null;
  private tickHandle = 0;
  private running = false;
  private paused = false;
  private frame: BossRaceFrame | null = null;
  private matchEnded = false;

  constructor(options: BattleSceneOptions) {
    this.options = options;
    const { width, height } = this.stageSize();
    this.geometry = battleLayout(width, height);
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    // Real 千夜追忆 art is authored for a 640-wide playfield; scale it to ours.
    const artScale = this.geometry.playfield.width / 640;
    this.bulletRenderer = new AtlasBulletRenderer(this.bulletAtlas, artScale);
    void this.bulletAtlas.load();
    this.view = new BossRaceView({
      layout: this.geometry.playfield,
      playfieldX: this.geometry.playfieldX,
      playfieldY: this.geometry.playfieldY,
      hudWidth: this.geometry.hudWidth,
      hudHeight: this.geometry.hudHeight,
      hudX: this.geometry.hudX,
      stageWidth: width,
      stageHeight: height,
      bulletRenderer: this.bulletRenderer,
    });
    this.root.addChild(this.view.root);

    // The scene owns no HUD/status text of its own (the strip belongs to
    // `BossRaceView`), so the paused state is surfaced with a full-stage banner
    // layered above the playfield. Added after the view so it paints on top.
    this.pauseOverlay = new Laya.Text();
    this.pauseOverlay.text = 'PAUSED';
    this.pauseOverlay.fontSize = theme.FONT_SIZE_TITLE;
    this.pauseOverlay.bold = true;
    this.pauseOverlay.color = theme.COLOR_ACCENT;
    this.pauseOverlay.align = 'center';
    this.pauseOverlay.valign = 'middle';
    this.pauseOverlay.size(width, height);
    this.pauseOverlay.visible = false;
    this.root.addChild(this.pauseOverlay);

    this.options.battle.onSnapshot((snapshot) => {
      this.authoritative = snapshot;
      if (snapshot.winnerPlayerId !== '' && !this.matchEnded) {
        this.matchEnded = true;
        this.options.onMatchEnd?.(snapshot.winnerPlayerId);
      }
    });

    // Apply the stage-sized layout once so the first frame already matches the
    // window (the stage may differ from `options` on a resizable native window).
    this.relayout(width, height);
  }

  onEnter(): void {
    this.root.visible = true;
    // Re-register idempotently: `onEnter` can run again after an `onExit`.
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    Laya.stage.on(Laya.Event.RESIZE, this, this.onStageResize);
    // A battle always starts live; never carry a previous pause into it.
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.start();
  }

  onExit(): void {
    this.root.visible = false;
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.stop();
  }

  destroy(): void {
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    this.stop();
    this.view.destroy();
    this.root.destroy(true);
  }

  /**
   * Re-tiles the whole scene for a new stage size. Called once at construction
   * and again on every `Laya.Event.RESIZE`, so the playfield, status panel and
   * bullet art scale track the window instead of freezing at boot.
   */
  private relayout(width: number, height: number): void {
    this.geometry = battleLayout(width, height);
    this.root.size(width, height);
    this.pauseOverlay.size(width, height);
    this.view.relayout({
      layout: this.geometry.playfield,
      playfieldX: this.geometry.playfieldX,
      playfieldY: this.geometry.playfieldY,
      hudX: this.geometry.hudX,
      hudWidth: this.geometry.hudWidth,
      hudHeight: this.geometry.hudHeight,
      stageWidth: width,
      stageHeight: height,
    });
    // Real art is authored for a 640-wide playfield; keep it in step with ours.
    this.bulletRenderer.setArtScale(this.geometry.playfield.width / 640);
    this.renderFrame();
  }

  /**
   * Current stage size in pixels, falling back to the boot-time options when the
   * stage is not ready yet (width/height 0) or unavailable.
   */
  private stageSize(): { width: number; height: number } {
    const stage: Laya.Stage | undefined = Laya.stage;
    if (stage !== undefined && stage.width > 0 && stage.height > 0) {
      return { width: stage.width, height: stage.height };
    }
    return { width: this.options.width, height: this.options.height };
  }

  private onStageResize(): void {
    const { width, height } = this.stageSize();
    this.relayout(width, height);
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

  /**
   * Handles a battle shortcut. `pause` holds the fixed-tick loop and shows the
   * banner so the key has visible feedback; the other two battle actions have
   * no control on this screen — there is no forfeit/back path and the HUD strip
   * is owned by `BossRaceView` — so they fall through to the app-level handlers.
   *
   * Only the scene's own `start()`/`stop()` lifecycle is used: the simulation,
   * input sampling and network code are left untouched.
   */
  handleShortcut(action: ShortcutAction, _event: Laya.KeyboardEventLike): boolean {
    if (action !== 'battle.pause') {
      return false;
    }
    this.setPaused(!this.paused);
    return true;
  }

  /** Holds or resumes the tick loop and mirrors the state on the banner. */
  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseOverlay.visible = paused;
    if (paused) {
      this.stop();
    } else {
      this.start();
    }
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
      metricsLine: `snaps ${metrics.snapshotsReceived} · err ${metrics.averagePositionErrorMilli.toFixed(0)} · ${hashCell(metrics)} · snap ${metrics.hardSnaps}`,
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
    return [
      row('BOSS', `HP ${local?.bossCurrentHp ?? '-'}/${this.options.bossMaxHp}`, `dmg ${local?.damageDealt ?? 0}`, `rival ${opponent?.bossCurrentHp ?? '-'}`),
      row('NET', source, `tick ${snapshot.tick}`, stateName, `pattern ${patternFor(snapshot.tick)}`),
      row('FP', `bullets ${snapshot.bullets.length}`, inputs),
      row('SYNC', `snaps ${metrics.snapshotsReceived}`, `err ${metrics.averagePositionErrorMilli.toFixed(0)}`, hashCell(metrics), `snap ${metrics.hardSnaps}`),
    ];
  }
}

/**
 * The SYNC row's state-hash cell.
 *
 * `hashComparable` counts the snapshots where the local bullet model is expected
 * to reproduce the server's (see `BossRaceSimulation.hashComparable`). Since the
 * real-danmaku library is now the server's own, that is every snapshot on the
 * live ruleset, so the cell normally reports a real ratio. It only says why
 * instead when the simulation was built with a provisional timeline
 * (`config.realDanmakuIsProduction === false`) or is still on the legacy
 * `mvp-boss-race-s0` scheduler — in which case a `0/n` would read as a desync
 * even though the *players* agree exactly.
 */
function hashCell(metrics: BattleCorrectionMetrics): string {
  if (metrics.hashComparable === 0) {
    // Kept short on purpose: the SYNC strip is narrow and a longer label wraps
    // into a line that still overflows the panel.
    return 'hash n/a (provisional)';
  }
  return `hash ${metrics.hashMatches}/${metrics.hashComparable}`;
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
