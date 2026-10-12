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
import { buildBossRaceFrame, type BossRaceFrame, type PlayerRenderItem, type RenderPoint, PlayfieldTransform, bossOriginPixels } from '../../../core/game/boss_race_view_model';
import { describeDirectionBits, encodeInput } from '../../../core/game/input';
import type { BossRaceSnapshot } from '../../../core/sim/boss_race';
import {
  BOSS_ORIGIN_X_MILLI,
  BOSS_ORIGIN_Y_MILLI,
  BOSS_RACE_PATTERN_IDS,
  BOSS_RACE_PATTERN_PERIOD_TICKS,
  BossRaceState,
} from '../../../core/sim/boss_race';
import {
  cardEffectDefinition,
  invulnerableRemainingTicks,
  opponentPatternWarning,
  purgeRadiusMilli,
  purgeSpecFor,
  selectPurgeTargets,
  type CardEffectKind,
} from '../../../core/sim/card_effects';
import type { LayaInput } from '../laya_input';
import { BossRaceView } from '../view/boss_race_view';
import { AtlasBulletRenderer } from '../view/bullets';
import { sharedTnaFrameSource } from '../view/bullet_atlas';
import type { HudState } from '../view/hud';
import { fade } from '../view/sprites';
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
  /**
   * Seed fed to the deterministic bullet-purge selection. The server derives it
   * from the match seed; the scene only needs a stable value so the locally
   * hidden bullets are the same ones on every render. Defaults to 0.
   */
  cardEffectSeed?: number;
  onMatchEnd?: (winnerPlayerId: string) => void;
}

/**
 * One card effect to present on the battle field.
 *
 * The client has no authoritative card-event channel yet (the C++ battle server
 * only forwards `deck_card_ids`; the lobby owns card resolution), so this is the
 * seam a caller drives — either from a future `card_effect_applied` event or, in
 * tests, directly. The scene renders it and, for `bullet_purge`, hides the
 * matching locally predicted bullets.
 */
export interface CardEffectEvent {
  cardId: string;
  /** `EffectKind`; unknown kinds fall back to the card's static definition. */
  effectKind?: string;
  /** Roster id of the player the effect targets (defaults to the opponent). */
  targetPlayerId?: string;
  /** Overrides the definition's `durationTicks` for the visual window. */
  durationTicks?: number;
  /** Overrides the definition's `damage`. */
  damage?: number;
  /** Curtain pattern id (`opponent_pattern`); defaults to the card id. */
  patternId?: string;
  /** Clear radius in playfield pixels (`bullet_purge`). */
  purgeRadius?: number;
  /** Bullets removed (`bullet_purge`). */
  purgeCount?: number;
}

/** A resolved effect the scene is currently animating. */
interface ActiveCardEffect {
  cardId: string;
  effectKind: CardEffectKind;
  startTick: number;
  /** Visual lifetime in ticks. */
  durationTicks: number;
  targetPlayerId: string;
  patternId: string;
  /** Pixel radius of the purge ring (`bullet_purge`). */
  purgeRadiusPx: number;
  /** Bullet ids hidden while the purge is active. */
  purgedIds: Set<string>;
  damage: number;
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
  /**
   * Card-effect overlay, layered between the playfield view and the pause
   * banner. Draws the aimed-curtain warning, the purge ring, the invulnerability
   * aura and the finisher flash; it owns no game state beyond the effect list.
   */
  private readonly effectLayer: Laya.Sprite;
  /** Effect readout (invulnerability countdown, last finisher damage). */
  private readonly effectText: Laya.Text;
  private readonly activeEffects: ActiveCardEffect[] = [];
  private lastFinisherDamage = 0;
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

    // Card-effect overlay: drawn above the playfield actors but below the pause
    // banner. Its geometry tracks the playfield in `relayout`.
    this.effectLayer = new Laya.Sprite();
    this.root.addChild(this.effectLayer);

    this.effectText = new Laya.Text();
    this.effectText.fontSize = theme.FONT_SIZE_CAPTION;
    this.effectText.bold = true;
    this.effectText.color = theme.COLOR_ACCENT;
    this.effectText.align = 'center';
    this.effectText.visible = false;
    this.root.addChild(this.effectText);

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
    this.clearCardEffects();
    this.start();
  }

  onExit(): void {
    this.root.visible = false;
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.clearCardEffects();
    this.stop();
  }

  destroy(): void {
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    this.stop();
    this.clearCardEffects();
    this.view.destroy();
    this.root.destroy(true);
  }

  /** Drops every card effect and its overlay paint. */
  private clearCardEffects(): void {
    this.activeEffects.length = 0;
    this.lastFinisherDamage = 0;
    this.effectLayer.graphics.clear();
    this.effectText.text = '';
    this.effectText.visible = false;
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
    // Effect overlay works in playfield-local pixels, so it shares the
    // playfield's origin and size; the readout sits in the HUD strip.
    this.effectLayer.pos(this.geometry.playfieldX, this.geometry.playfieldY);
    this.effectLayer.size(this.geometry.playfield.width, this.geometry.playfield.height);
    this.effectText.pos(this.geometry.hudX + 8, this.geometry.hudHeight - theme.FONT_SIZE_CAPTION - 8);
    this.effectText.width = this.geometry.hudWidth - 16;
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

  /** Debug-only: card effects currently being animated. */
  get __debugCardEffects(): readonly ActiveCardEffect[] {
    return this.activeEffects;
  }

  /**
   * Presents a card effect on the battle field.
   *
   * Resolves the effect's kind/numbers from the static mirror when the event
   * omits them, then either draws a transient visual (`opponent_pattern`,
   * `invulnerable`, `finisher`) or records the locally predicted bullets to hide
   * (`bullet_purge`). Unknown kinds are ignored so a newer server cannot crash
   * the scene.
   */
  applyCardEffect(event: CardEffectEvent): void {
    const definition = cardEffectDefinition(event.cardId);
    const effectKind = (event.effectKind ?? definition?.effectKind ?? '') as CardEffectKind | '';
    if (effectKind === '') {
      return;
    }
    const durationTicks = event.durationTicks ?? definition?.durationTicks ?? 60;
    const purgeSpec = purgeSpecFor(event.cardId);
    const purgeRadiusPx = event.purgeRadius ?? purgeSpec?.radius ?? 0;
    const purgeCount = event.purgeCount ?? purgeSpec?.count ?? 0;
    const tick = this.currentTick();
    const effect: ActiveCardEffect = {
      cardId: event.cardId,
      effectKind,
      startTick: tick,
      durationTicks: visualDurationTicks(effectKind, durationTicks),
      targetPlayerId: event.targetPlayerId ?? '',
      patternId: event.patternId ?? definition?.cardId ?? event.cardId,
      purgeRadiusPx,
      purgedIds: new Set<string>(),
      damage: event.damage ?? definition?.damage ?? 0,
    };
    if (effectKind === 'bullet_purge') {
      effect.purgedIds = this.resolvePurgeTargets(purgeRadiusPx, purgeCount);
    }
    if (effectKind === 'finisher') {
      this.lastFinisherDamage = effect.damage;
    }
    this.activeEffects.push(effect);
  }

  /** Current simulation tick, preferring the authoritative snapshot. */
  private currentTick(): number {
    return this.authoritative?.tick ?? this.options.battle.simulationRef?.getCurrentTick() ?? 0;
  }

  /**
   * Picks the bullets a purge hides, from the **milli-unit** snapshot bullets so
   * the radius is compared in the server's own unit space. The choice is
   * deterministic (see `selectPurgeTargets`) so a repaint never flickers.
   */
  private resolvePurgeTargets(radiusPx: number, count: number): Set<string> {
    const snapshot = this.authoritative ?? this.options.battle.simulationRef?.snapshot() ?? null;
    if (snapshot === null || radiusPx <= 0 || count <= 0) {
      return new Set<string>();
    }
    const localId = this.options.localPlayerId();
    const local = snapshot.players.find((player) => player.playerId === localId) ?? snapshot.players[0];
    if (local === undefined) {
      return new Set<string>();
    }
    const ids = selectPurgeTargets(
      snapshot.bullets,
      local.xMilli,
      local.yMilli,
      purgeRadiusMilli(radiusPx),
      count,
      this.options.cardEffectSeed ?? 0,
      snapshot.tick,
      'bullet_purge',
    );
    return new Set<string>(ids);
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
    this.pruneEffects();
    this.renderFrame();
  }

  /** Drops card effects whose visual window has elapsed. */
  private pruneEffects(): void {
    const tick = this.currentTick();
    for (let index = this.activeEffects.length - 1; index >= 0; index -= 1) {
      const effect = this.activeEffects[index];
      if (tick - effect.startTick >= effect.durationTicks) {
        this.activeEffects.splice(index, 1);
      }
    }
    if (this.activeEffects.length === 0) {
      this.lastFinisherDamage = 0;
    }
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
    let frame = buildBossRaceFrame(source, {
      layout: this.geometry.playfield,
      localPlayerId: this.options.localPlayerId(),
      bossMaxHp: this.options.bossMaxHp,
    });
    // A `bullet_purge` removes its chosen bullets from the *local prediction*:
    // the simulation is untouched (the server stays authoritative), only the
    // rendered frame drops them for the effect's window.
    const hidden = this.hiddenBulletIds();
    if (hidden.size > 0) {
      frame = { ...frame, bullets: frame.bullets.filter((bullet) => !hidden.has(bullet.bulletId)) };
    }
    this.frame = frame;
    this.view.render(frame, this.hudLines(source), this.hudState(source));
    this.drawCardEffects(frame, source);
  }

  /** Bullet ids hidden by an active purge. */
  private hiddenBulletIds(): Set<string> {
    let hidden: Set<string> | null = null;
    for (const effect of this.activeEffects) {
      if (effect.effectKind !== 'bullet_purge' || effect.purgedIds.size === 0) {
        continue;
      }
      hidden = hidden ?? new Set<string>();
      for (const id of effect.purgedIds) {
        hidden.add(id);
      }
    }
    return hidden ?? EMPTY_ID_SET;
  }

  /**
   * Repaints the card-effect overlay for the current frame.
   *
   * Everything is drawn in playfield-local pixels: the transform maps the
   * snapshot's milli-unit actors onto the same space `BossRaceView` uses, so the
   * aura and the warning line land exactly on the rendered ships.
   */
  private drawCardEffects(frame: BossRaceFrame, snapshot: BossRaceSnapshot): void {
    const graphics = this.effectLayer.graphics;
    graphics.clear();
    this.effectText.text = '';
    this.effectText.visible = false;
    if (this.activeEffects.length === 0) {
      return;
    }
    const transform = new PlayfieldTransform(this.geometry.playfield);
    const localPlayer = frame.players.find((player) => player.isLocal);
    const opponentPlayer = frame.players.find((player) => !player.isLocal);
    const tick = frame.tick;
    const notes: string[] = [];

    for (const effect of this.activeEffects) {
      const progress = effectProgress(effect, tick);
      switch (effect.effectKind) {
        case 'opponent_pattern': {
          const target = this.effectTargetPlayer(effect, frame, opponentPlayer);
          if (target === undefined) {
            break;
          }
          const origin = bossOriginPixels(transform);
          // Aim from the Boss to the target, mirroring the server's `atan2`
          // toward the opponent's position (in the snapshot's milli units).
          const aimMilli = snapshot.players.find((player) => player.playerId === target.playerId);
          const warning = opponentPatternWarning(
            BOSS_ORIGIN_X_MILLI,
            BOSS_ORIGIN_Y_MILLI,
            aimMilli?.xMilli ?? 0,
            aimMilli?.yMilli ?? 0,
            effect.patternId,
          );
          drawOpponentWarning(graphics, origin, target.position, warning.angleRad, progress);
          break;
        }
        case 'bullet_purge': {
          if (localPlayer === undefined) {
            break;
          }
          drawPurgeRing(graphics, localPlayer.position, effect.purgeRadiusPx, progress);
          break;
        }
        case 'invulnerable': {
          if (localPlayer === undefined) {
            break;
          }
          drawInvulnerableAura(graphics, localPlayer.position, tick, progress);
          const remaining = invulnerableRemainingTicks(effect.startTick + effect.durationTicks, tick);
          notes.push(`INVULNERABLE ${(remaining / 60).toFixed(1)}s`);
          break;
        }
        case 'finisher': {
          drawFinisherFlash(graphics, this.geometry.playfield.width, this.geometry.playfield.height, progress);
          if (localPlayer !== undefined && this.lastFinisherDamage > 0) {
            drawDamageNumber(graphics, localPlayer.position, this.lastFinisherDamage, progress);
          }
          break;
        }
        default:
          break;
      }
    }

    if (notes.length > 0) {
      this.effectText.text = notes.join('  ·  ');
      this.effectText.visible = true;
    }
  }

  /** The player an `opponent_pattern` should aim at, preferring its target id. */
  private effectTargetPlayer(
    effect: ActiveCardEffect,
    frame: BossRaceFrame,
    fallback: PlayerRenderItem | undefined,
  ): PlayerRenderItem | undefined {
    if (effect.targetPlayerId !== '') {
      const named = frame.players.find((player) => player.playerId === effect.targetPlayerId);
      if (named !== undefined) {
        return named;
      }
    }
    return fallback;
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

// ---------------------------------------------------------------------------
// Card-effect visuals
//
// Pure `Laya.Graphics` painters. They take playfield-local pixel coordinates —
// the same space `BossRaceView` draws actors in — so a caller never has to
// re-derive a transform. Colours come from `view/theme` and fade toward the
// void background as the effect's window elapses.
// ---------------------------------------------------------------------------

/** Shared empty set so the common (no purge) path never allocates. Never mutated. */
const EMPTY_ID_SET: Set<string> = new Set<string>();

/**
 * Visual lifetime of an effect, in ticks.
 *
 * One-shot effects (purge / finisher) and the aimed curtain use a short window
 * so they read as an impact rather than a lingering overlay; `invulnerable`
 * keeps its full server duration so the aura matches the real immunity.
 */
function visualDurationTicks(kind: CardEffectKind, definitionTicks: number): number {
  switch (kind) {
    case 'bullet_purge':
      return Math.max(1, Math.min(definitionTicks, 30));
    case 'finisher':
      return Math.max(1, Math.min(definitionTicks, 45));
    case 'opponent_pattern':
      return Math.max(1, Math.min(definitionTicks, 120));
    default:
      return Math.max(1, definitionTicks);
  }
}

/** Fraction of an effect's window that has elapsed, clamped to `[0, 1]`. */
function effectProgress(effect: ActiveCardEffect, tick: number): number {
  if (effect.durationTicks <= 0) {
    return 1;
  }
  const elapsed = tick - effect.startTick;
  return Math.max(0, Math.min(1, elapsed / effect.durationTicks));
}

/** Aimed-curtain warning: a cone + reticle from the Boss toward the target. */
function drawOpponentWarning(
  g: Laya.Graphics,
  origin: RenderPoint,
  target: RenderPoint,
  angleRad: number,
  progress: number,
): void {
  const reach = 90;
  const spread = 0.3;
  const left = {
    x: origin.x + Math.cos(angleRad - spread) * reach,
    y: origin.y + Math.sin(angleRad - spread) * reach,
  };
  const right = {
    x: origin.x + Math.cos(angleRad + spread) * reach,
    y: origin.y + Math.sin(angleRad + spread) * reach,
  };
  g.drawPoly(0, 0, [origin.x, origin.y, left.x, left.y, right.x, right.y], fade(theme.COLOR_WARNING, progress * 0.55));
  g.drawLine(origin.x, origin.y, target.x, target.y, fade(theme.COLOR_DANGER, progress * 0.5), 2);
  g.drawCircle(
    target.x,
    target.y,
    12 + progress * 12,
    null,
    fade(theme.COLOR_DANGER, progress * 0.4),
    2,
  );
}

/** Expanding clear ring at the caster. */
function drawPurgeRing(g: Laya.Graphics, center: RenderPoint, radiusPx: number, progress: number): void {
  const radius = Math.max(8, radiusPx) * (0.4 + progress * 0.6);
  g.drawCircle(center.x, center.y, radius, null, fade(theme.COLOR_INFO, progress * 0.4), 3);
  g.drawCircle(center.x, center.y, Math.max(4, radius * 0.35), fade(theme.COLOR_LOCAL_BULLET_CORE, progress * 0.5));
}

/** Pulsing invulnerability aura around the local ship. */
function drawInvulnerableAura(g: Laya.Graphics, center: RenderPoint, tick: number, progress: number): void {
  const pulse = 16 + Math.sin(tick * 0.35) * 3;
  g.drawCircle(center.x, center.y, pulse, theme.COLOR_PLAYFIELD, fade(theme.COLOR_ACCENT, progress * 0.5), 3);
  g.drawCircle(center.x, center.y, pulse + 5, null, fade(theme.COLOR_ACCENT, progress * 0.6), 1);
}

/** Full-playfield finisher flash: a fading border band plus a centre burst. */
function drawFinisherFlash(g: Laya.Graphics, width: number, height: number, progress: number): void {
  const color = fade(theme.COLOR_ACCENT, progress * 0.7);
  const band = Math.max(2, 24 * (1 - progress));
  g.drawRect(0, 0, width, band, color);
  g.drawRect(0, height - band, width, band, color);
  g.drawRect(0, 0, band, height, color);
  g.drawRect(width - band, 0, band, height, color);
  g.drawCircle(width / 2, height / 2, Math.max(4, 120 * (1 - progress)), fade(theme.COLOR_WARNING, progress * 0.55));
}

/** Rising damage number for a finisher. */
function drawDamageNumber(g: Laya.Graphics, center: RenderPoint, damage: number, progress: number): void {
  const text = `-${Math.round(damage)}`;
  const y = center.y - 24 - progress * 40;
  g.fillText(text, center.x, y, theme.font(theme.FONT_SIZE_HEADING, true), fade(theme.COLOR_DANGER, progress * 0.7), 'center');
}
