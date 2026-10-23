/**
 * `.dem` replay player screen (thread B).
 *
 * Plays a downloaded `.dem` v1 container: decodes it with `core/dem/parse`, drives
 * the ported `BossRaceSimulation` through `core/dem/replayer`, and renders the
 * frames with play/pause, 1x/2x/4x speed and a draggable timeline. All colours
 * and metrics come from `view/theme`.
 *
 * The scene owns no network: `app.ts` downloads the bytes (via
 * `LobbyClient.downloadDem`) and hands them to {@link DemPlayerScene.open}.
 */

import { parseDemDocument, DemError, type DemDocument } from '../../../core/dem/parse';
import { DemReplayer, DEM_DEFAULT_KEYFRAME_INTERVAL_TICKS } from '../../../core/dem/replayer';
import type { BossRaceSnapshot } from '../../../core/sim/boss_race';
import { ARENA_HALF_WIDTH_MILLI, ARENA_HALF_HEIGHT_MILLI, BOSS_RACE_TICK_RATE_HZ } from '../../../core/sim/boss_race';
import * as theme from '../view/theme';
import { createButtonEx, createCaption, createDivider, createLabel, createPanel, type ButtonHandle } from './ui_kit';
import type { ClientScene } from './scene';

export interface DemPlayerSceneOptions {
  width: number;
  height: number;
}

/** Playback speeds offered by the player. */
const DEM_SPEEDS = [1, 2, 4] as const;

export class DemPlayerScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly arena: Laya.Sprite;
  private readonly infoText: Laya.Text;
  private readonly statusText: Laya.Text;
  private readonly progressText: Laya.Text;
  private readonly timelineTrack: Laya.Sprite;
  private readonly timelineKnob: Laya.Sprite;
  private readonly playButton: ButtonHandle;
  private readonly restartButton: ButtonHandle;
  private readonly closeButton: ButtonHandle;
  private readonly speedButtons: ButtonHandle[] = [];
  private readonly speedLabels: { button: ButtonHandle; speed: number }[] = [];

  private replayer: DemReplayer | null = null;
  private document: DemDocument | null = null;
  private label = '';
  private playing = false;
  private speed = 1;
  private dragging = false;

  constructor(options: DemPlayerSceneOptions) {
    const { width, height } = options;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    const title = createLabel('Replay', contentWidth, margin, theme.FONT_SIZE_TITLE, { color: theme.COLOR_TITLE, bold: true });
    title.x = margin;
    this.root.addChild(title);
    this.root.addChild(createDivider(margin, title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    const infoY = title.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    const infoCaption = createCaption('Session', contentWidth, infoY);
    infoCaption.x = margin;
    this.root.addChild(infoCaption);
    this.infoText = createLabel('', contentWidth, infoY + theme.FONT_SIZE_CAPTION + theme.SPACE_XS, theme.FONT_SIZE_LABEL, {
      color: theme.COLOR_TEXT_MUTED,
    });
    this.infoText.x = margin;
    this.root.addChild(this.infoText);

    // --- arena ---
    const arenaY = this.infoText.y + theme.FONT_SIZE_LABEL * 3 + theme.SPACE_MD;
    const arenaHeight = height - arenaY - 150;
    this.arena = createPanel(margin, arenaY, contentWidth, arenaHeight);
    this.root.addChild(this.arena);

    // --- timeline ---
    const timelineY = arenaY + arenaHeight + theme.SPACE_MD;
    this.timelineTrack = new Laya.Sprite();
    this.timelineTrack.pos(margin, timelineY);
    this.timelineTrack.size(contentWidth, 18);
    this.timelineTrack.mouseEnabled = true;
    this.drawTimelineTrack();
    this.root.addChild(this.timelineTrack);
    this.timelineKnob = new Laya.Sprite();
    this.timelineKnob.graphics.drawCircle(0, 0, 7, theme.COLOR_ACCENT);
    this.timelineTrack.addChild(this.timelineKnob);
    this.bindTimelineDrag();

    this.progressText = createLabel('', contentWidth, timelineY + 26, theme.FONT_SIZE_CAPTION, { color: theme.COLOR_TEXT_MUTED });
    this.progressText.x = margin;
    this.root.addChild(this.progressText);

    // --- controls ---
    const controlY = timelineY + 56;
    const controlWidth = 92;
    this.playButton = createButtonEx('Play', margin, controlY, controlWidth, () => this.togglePlay());
    this.root.addChild(this.playButton.sprite);
    this.restartButton = createButtonEx('Restart', margin + controlWidth + theme.SPACE_SM, controlY, controlWidth, () => {
      this.seekTo(0);
    });
    this.root.addChild(this.restartButton.sprite);
    let speedX = margin + (controlWidth + theme.SPACE_SM) * 2;
    for (const speed of DEM_SPEEDS) {
      const button = createButtonEx(`${speed}x`, speedX, controlY, 64, () => this.setSpeed(speed), speed === 1 ? 'primary' : 'ghost');
      this.root.addChild(button.sprite);
      this.speedButtons.push(button);
      this.speedLabels.push({ button, speed });
      speedX += 64 + theme.SPACE_SM;
    }
    this.closeButton = createButtonEx('Close', width - margin - controlWidth, controlY, controlWidth, () => this.close(), 'ghost');
    this.root.addChild(this.closeButton.sprite);

    this.statusText = createLabel('', contentWidth, controlY + theme.BUTTON_HEIGHT + theme.SPACE_SM, theme.FONT_SIZE_CAPTION, {
      color: theme.COLOR_TEXT_MUTED,
    });
    this.statusText.x = margin;
    this.root.addChild(this.statusText);
  }

  // --- lifecycle -----------------------------------------------------------

  /** Load a freshly downloaded `.dem` container and enter playback. */
  open(bytes: Uint8Array, label: string): boolean {
    try {
      const document = parseDemDocument(bytes);
      this.document = document;
      this.replayer = new DemReplayer(document, { keyframeIntervalTicks: DEM_DEFAULT_KEYFRAME_INTERVAL_TICKS });
      this.label = label;
      this.statusText.text = 'loaded';
      this.speed = 1;
      this.speedButtons[0].setVariant?.('primary');
      this.speedButtons.slice(1).forEach((button) => button.setVariant?.('ghost'));
      this.refreshInfo();
      this.seekTo(0);
      this.root.visible = true;
      this.onEnter();
      return true;
    } catch (error) {
      this.statusText.text = `dem_load_failed: ${error instanceof DemError ? error.code : String(error)}`;
      this.root.visible = true;
      return false;
    }
  }

  onEnter(): void {
    // Nothing to prefetch: the caller already supplied the bytes.
  }

  onExit(): void {
    this.stopLoop();
  }

  close(): void {
    this.stopLoop();
    this.playing = false;
    this.root.visible = false;
  }

  destroy(): void {
    this.close();
    this.root.removeChildren();
  }

  // --- playback ------------------------------------------------------------

  private togglePlay(): void {
    if (this.replayer === null) {
      return;
    }
    if (this.playing) {
      this.stopLoop();
      this.playing = false;
      this.playButton.setText('Play');
    } else {
      if (this.replayer.currentTick >= this.replayer.finalTick) {
        this.seekTo(0);
      }
      this.playing = true;
      this.playButton.setText('Pause');
      this.startLoop();
    }
  }

  private setSpeed(speed: number): void {
    this.speed = speed;
    for (const { button, speed: value } of this.speedLabels) {
      button.setVariant?.(value === speed ? 'primary' : 'ghost');
    }
    if (this.playing) {
      this.startLoop();
    }
  }

  private startLoop(): void {
    this.stopLoop();
    const replayer = this.replayer;
    if (replayer === null) {
      return;
    }
    // 老 .dem 头里可能没有 tick_rate_hz（0），回落到当前模拟的 64 tick。
    const tickRate = replayer.header.tick_rate_hz > 0 ? replayer.header.tick_rate_hz : BOSS_RACE_TICK_RATE_HZ;
    const perTickMs = Math.max(4, Math.round(1000 / tickRate / this.speed));
    Laya.timer.loop(perTickMs, this, this.onFrame);
  }

  private stopLoop(): void {
    Laya.timer.clear(this, this.onFrame);
  }

  private onFrame(): void {
    const replayer = this.replayer;
    if (replayer === null) {
      return;
    }
    if (replayer.currentTick >= replayer.finalTick) {
      this.stopLoop();
      this.playing = false;
      this.playButton.setText('Play');
      this.render(replayer.simulationRef.snapshot());
      this.finishReport(replayer);
      return;
    }
    const snapshot = replayer.step();
    this.render(snapshot);
  }

  private seekTo(tick: number): void {
    const replayer = this.replayer;
    if (replayer === null) {
      return;
    }
    const snapshot = replayer.seek(tick);
    this.render(snapshot);
  }

  private finishReport(replayer: DemReplayer): void {
    const result = replayer.runToEnd();
    this.statusText.text = result.hashMatched
      ? `final_state_hash MATCH (${result.replayedStateHash})`
      : `final_state_hash MISMATCH declared=${result.declaredStateHash} replayed=${result.replayedStateHash}`;
    this.statusText.color = result.hashMatched ? theme.COLOR_SUCCESS : theme.COLOR_WARNING;
    this.refreshInfo();
  }

  // --- rendering -----------------------------------------------------------

  private refreshInfo(): void {
    const document = this.document;
    if (document === null) {
      return;
    }
    const header = document.header;
    this.infoText.text =
      `${this.label}  match=${header.match_id}  mode=${header.mode_id}  boss=${header.boss_id || '(default)'}\n` +
      `seed=${header.server_seed}  entries=${document.entries.length}  final_tick=${header.final_tick}`;
  }

  private render(snapshot: BossRaceSnapshot): void {
    const replayer = this.replayer;
    if (replayer === null) {
      return;
    }
    this.arena.graphics.clear();
    const width = this.arena.width;
    const height = this.arena.height;
    const toX = (milli: number): number => width / 2 + (milli / ARENA_HALF_WIDTH_MILLI) * (width / 2 - 8);
    const toY = (milli: number): number => height / 2 + (milli / ARENA_HALF_HEIGHT_MILLI) * (height / 2 - 8);

    // boss marker at origin
    this.arena.graphics.drawCircle(width / 2, height / 2, 8, theme.COLOR_BOSS);
    // bullets
    for (const bullet of snapshot.bullets) {
      this.arena.graphics.drawCircle(toX(bullet.xMilli), toY(bullet.yMilli), 2, theme.COLOR_OPPONENT_BULLET);
    }
    // players
    for (const player of snapshot.players) {
      const color = player.playerId === this.localPlayerId(replayer) ? theme.COLOR_LOCAL_PLAYER : theme.COLOR_PLAYER;
      this.arena.graphics.drawCircle(toX(player.xMilli), toY(player.yMilli), 5, color);
    }

    const tick = snapshot.tick;
    const total = replayer.finalTick;
    this.progressText.text = `tick ${tick}/${total}  bullets=${snapshot.bullets.length}  players=${snapshot.players.length}`;
    this.moveKnob(tick, total);
  }

  private localPlayerId(replayer: DemReplayer): string {
    return replayer.header.players[0]?.player_id ?? '';
  }

  // --- timeline ------------------------------------------------------------

  private drawTimelineTrack(): void {
    const g = this.timelineTrack.graphics;
    g.clear();
    g.drawRect(0, 6, this.timelineTrack.width, 6, theme.COLOR_DIVIDER);
  }

  private moveKnob(tick: number, total: number): void {
    const ratio = total <= 0 ? 0 : Math.max(0, Math.min(1, tick / total));
    this.timelineKnob.x = ratio * this.timelineTrack.width;
    this.timelineKnob.y = 9;
  }

  private bindTimelineDrag(): void {
    this.timelineTrack.on(Laya.Event.MOUSE_DOWN, undefined, (...args: unknown[]) => {
      this.dragging = true;
      this.seekFromPointer(args[0]);
    });
    this.timelineTrack.on(Laya.Event.MOUSE_MOVE, undefined, (...args: unknown[]) => {
      if (this.dragging) {
        this.seekFromPointer(args[0]);
      }
    });
    this.timelineTrack.on(Laya.Event.MOUSE_UP, undefined, () => {
      this.dragging = false;
    });
    this.timelineTrack.on(Laya.Event.MOUSE_OUT, undefined, () => {
      this.dragging = false;
    });
  }

  private seekFromPointer(raw: unknown): void {
    const replayer = this.replayer;
    if (replayer === null) {
      return;
    }
    const stageX = (raw as { stageX?: number }).stageX ?? 0;
    const localX = stageX - this.timelineTrack.x;
    const ratio = this.timelineTrack.width <= 0 ? 0 : Math.max(0, Math.min(1, localX / this.timelineTrack.width));
    this.seekTo(Math.round(ratio * replayer.finalTick));
  }
}
