/**
 * Lobby screen: sign in, pick a room code, create/join a room, and use the
 * matchmaking queue.
 *
 * Layout follows a shared three-band grid (title / content / actions) so all
 * four screens breathe the same way: a `SCREEN_MARGIN` outer gutter, a title
 * band, then full-width buttons stacked on the `SPACE_*` rhythm. Every colour,
 * size and gap comes from `view/theme` — nothing is hard-coded here.
 *
 * Room codes are cycled from a small preset list instead of a text field so the
 * screen stays dependency-free; a real `Laya.TextInput` (laya.ui) replaces the
 * cycle button once the UI package is bundled.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import { describeMatchmakingQueue } from '../../../core/game/lobby_flow';
import * as theme from '../view/theme';
import { VectorPainter } from '../view/sprites';
import { createButton, createPanel, type ButtonHandle } from './ui_kit';
import type { ClientScene } from './scene';

const PRESET_ROOM_CODES = ['RACE01', 'RACE02', 'RACE03', 'DUEL'];

export interface LobbySceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
}

export class LobbyScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly width: number;
  private readonly profileText: Laya.Text;
  private readonly statusText: Laya.Text;
  private readonly roomCodeText: Laya.Text;
  private readonly queueText: Laya.Text;
  private readonly signInButton: ButtonHandle;
  private readonly createButton: ButtonHandle;
  private readonly joinButton: ButtonHandle;
  private readonly cycleButton: ButtonHandle;
  private readonly joinQueueButton: ButtonHandle;
  private readonly refreshQueueButton: ButtonHandle;
  private readonly cancelQueueButton: ButtonHandle;
  private roomCodeIndex = 0;
  private busy = false;

  constructor(private readonly options: LobbySceneOptions) {
    const { width, height } = options;
    this.width = width;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    // --- title band ---
    const subtitle = this.makeText('Phantasm Klash — Lobby', theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    subtitle.y = margin;
    this.root.addChild(subtitle);
    this.root.addChild(this.divider(margin, subtitle.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    // --- content band: profile + status card, then the room-code card ---
    const profileY = subtitle.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    const profileHeight = 76;
    this.root.addChild(createPanel(margin, profileY, contentWidth, profileHeight));
    this.profileText = this.makeText('Not signed in', theme.FONT_SIZE_LABEL, theme.COLOR_TEXT, false, margin + theme.SPACE_MD);
    this.profileText.y = profileY + theme.SPACE_SM;
    this.profileText.width = contentWidth - theme.SPACE_MD * 2;
    this.profileText.wordWrap = true;
    this.profileText.leading = 4;
    this.root.addChild(this.profileText);

    this.statusText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_INFO, false, margin + theme.SPACE_MD);
    this.statusText.y = profileY + 44;
    this.statusText.width = contentWidth - theme.SPACE_MD * 2;
    this.statusText.wordWrap = true;
    this.statusText.leading = 4;
    this.root.addChild(this.statusText);

    const codeCardY = profileY + profileHeight + theme.SPACE_MD;
    const codeCardHeight = 64;
    this.root.addChild(createPanel(margin, codeCardY, contentWidth, codeCardHeight));
    const codeCaption = this.makeText('Room code', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin + theme.SPACE_MD);
    codeCaption.y = codeCardY + theme.SPACE_XS;
    this.root.addChild(codeCaption);
    // Highlight frame around the code so it reads at a glance.
    this.root.addChild(this.panelFrame(margin + theme.SPACE_MD, codeCardY + 22, 140, 30, theme.COLOR_ACCENT, theme.RADIUS_SM));
    this.roomCodeText = this.makeText('', theme.FONT_SIZE_HEADING, theme.COLOR_ACCENT, true, margin + theme.SPACE_MD + theme.SPACE_SM);
    this.roomCodeText.y = codeCardY + 26;
    this.root.addChild(this.roomCodeText);

    // --- action band ---
    const actionsY = codeCardY + codeCardHeight + theme.SPACE_MD;
    const buttonX = margin;
    const step = theme.BUTTON_HEIGHT + theme.SPACE_SM;
    let y = actionsY;

    this.signInButton = createButton('Sign in', buttonX, y, contentWidth, () => void this.signIn());
    this.root.addChild(this.signInButton.sprite);
    y += step;

    this.cycleButton = createButton('Change room code', buttonX, y, contentWidth, () => this.cycleRoomCode());
    this.root.addChild(this.cycleButton.sprite);
    y += step;

    this.createButton = createButton('Create room', buttonX, y, contentWidth, () => void this.createRoom());
    this.root.addChild(this.createButton.sprite);
    y += step;

    this.joinButton = createButton('Join room', buttonX, y, contentWidth, () => void this.joinRoom());
    this.root.addChild(this.joinButton.sprite);
    y += step;

    // Matchmaking: status line, then the queue actions packed a touch tighter.
    this.queueText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, buttonX);
    this.queueText.y = y + theme.SPACE_XS;
    this.queueText.width = contentWidth;
    this.queueText.wordWrap = true;
    this.queueText.leading = 4;
    this.root.addChild(this.queueText);
    y += theme.SPACE_XS + 34;

    this.joinQueueButton = createButton('Join matchmaking queue', buttonX, y, contentWidth, () => void this.joinQueue());
    this.root.addChild(this.joinQueueButton.sprite);
    y += step;

    this.refreshQueueButton = createButton('Refresh queue status', buttonX, y, contentWidth, () => void this.refreshQueue());
    this.root.addChild(this.refreshQueueButton.sprite);
    y += step;

    this.cancelQueueButton = createButton('Cancel matchmaking', buttonX, y, contentWidth, () => void this.cancelQueue());
    this.root.addChild(this.cancelQueueButton.sprite);

    this.roomCodeIndex = 0;
    this.refresh();
  }

  onEnter(): void {
    this.root.visible = true;
    this.applySnapshot(this.options.flow.snapshot());
  }

  onExit(): void {
    this.root.visible = false;
  }

  destroy(): void {
    this.root.destroy(true);
  }

  get roomCode(): string {
    return PRESET_ROOM_CODES[this.roomCodeIndex];
  }

  applySnapshot(snapshot: LobbyFlowSnapshot): void {
    this.statusText.text = snapshot.lastError === '' ? snapshot.statusText : snapshot.lastError;
    this.statusText.color = snapshot.lastError === '' ? theme.COLOR_INFO : theme.COLOR_DANGER;
    if (snapshot.session !== null) {
      this.profileText.text =
        `${snapshot.session.displayName} (${snapshot.session.playerId || snapshot.session.userId})\n` +
        `ruleset ${snapshot.session.rulesetVersion || '-'}`;
      this.profileText.color = theme.COLOR_TEXT;
    } else {
      this.profileText.text = 'Not signed in';
      this.profileText.color = theme.COLOR_TEXT_DISABLED;
    }
    this.queueText.text = describeMatchmakingQueue(snapshot);
    this.refresh(snapshot);
  }

  private refresh(snapshot: LobbyFlowSnapshot = this.options.flow.snapshot()): void {
    this.roomCodeText.text = this.roomCode;
    const signedIn = snapshot.session !== null;
    const queued = snapshot.matchmaking !== null;
    this.createButton.setEnabled(signedIn && !this.busy);
    this.joinButton.setEnabled(signedIn && !this.busy);
    this.signInButton.setEnabled(!signedIn && !this.busy);
    this.cycleButton.setEnabled(!this.busy);
    this.joinQueueButton.setEnabled(signedIn && !queued && !this.busy);
    this.refreshQueueButton.setEnabled(queued && !this.busy);
    this.cancelQueueButton.setEnabled(queued && !this.busy);
  }

  private cycleRoomCode(): void {
    this.roomCodeIndex = (this.roomCodeIndex + 1) % PRESET_ROOM_CODES.length;
    this.refresh();
  }

  private async signIn(): Promise<void> {
    await this.run(() => this.options.flow.signIn('Player'));
  }

  private async createRoom(): Promise<void> {
    await this.run(() => this.options.flow.createRoom(this.roomCode));
  }

  private async joinRoom(): Promise<void> {
    await this.run(() => this.options.flow.joinRoom(this.roomCode));
  }

  private async joinQueue(): Promise<void> {
    await this.run(() => this.options.flow.joinMatchmaking());
  }

  private async refreshQueue(): Promise<void> {
    await this.run(() => this.options.flow.refreshMatchmakingTicket());
  }

  private async cancelQueue(): Promise<void> {
    await this.run(() => this.options.flow.cancelMatchmaking());
  }

  /** Runs a flow action with the busy flag set and the screen refreshed after. */
  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy = true;
    this.refresh();
    try {
      await action();
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  /** Concise text factory: one place that sets font, weight, alignment and x. */
  private makeText(text: string, size: number, color: string, bold: boolean, x: number): Laya.Text {
    const label = new Laya.Text();
    label.text = text;
    label.fontSize = size;
    label.color = color;
    label.bold = bold;
    label.width = this.width;
    label.x = x;
    return label;
  }

  /** A thin horizontal rule drawn with the shared divider helper. */
  private divider(x: number, y: number, length: number): Laya.Sprite {
    const sprite = new Laya.Sprite();
    VectorPainter.divider(sprite.graphics, x, y, length, true);
    return sprite;
  }

  /** A rounded outline used to frame the highlighted room code. */
  private panelFrame(x: number, y: number, w: number, h: number, color: string, radius: number): Laya.Sprite {
    const sprite = new Laya.Sprite();
    VectorPainter.roundedOutline(sprite.graphics, x, y, w, h, radius, color, 2);
    return sprite;
  }
}
