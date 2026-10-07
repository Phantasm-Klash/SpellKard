/**
 * Lobby screen: sign in, pick a room code, create/join a room, and use the
 * matchmaking queue.
 *
 * Room codes are cycled from a small preset list instead of a text field so the
 * screen stays dependency-free; a real `Laya.TextInput` (laya.ui) replaces the
 * cycle button once the UI package is bundled.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import { describeMatchmakingQueue } from '../../../core/game/lobby_flow';
import { createButton, createLabel, createTitle, type ButtonHandle } from './ui_kit';
import type { ClientScene } from './scene';

const PRESET_ROOM_CODES = ['RACE01', 'RACE02', 'RACE03', 'DUEL'];

export interface LobbySceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
}

export class LobbyScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly statusLabel: Laya.Text;
  private readonly roomLabel: Laya.Text;
  private readonly profileLabel: Laya.Text;
  private readonly queueLabel: Laya.Text;
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
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    this.root.addChild(createTitle('Phantasm Klash — Lobby', width));

    this.profileLabel = createLabel('Not signed in', width, 80);
    this.root.addChild(this.profileLabel);

    this.statusLabel = createLabel('', width, 116);
    this.root.addChild(this.statusLabel);

    this.roomLabel = createLabel('', width, 168);
    this.root.addChild(this.roomLabel);

    this.signInButton = createButton('Sign in', 24, 220, width - 48, () => void this.signIn());
    this.root.addChild(this.signInButton.sprite);

    this.cycleButton = createButton('Change room code', 24, 280, width - 48, () => this.cycleRoomCode());
    this.root.addChild(this.cycleButton.sprite);

    this.createButton = createButton('Create room', 24, 340, width - 48, () => void this.createRoom());
    this.root.addChild(this.createButton.sprite);

    this.joinButton = createButton('Join room', 24, 400, width - 48, () => void this.joinRoom());
    this.root.addChild(this.joinButton.sprite);

    this.queueLabel = createLabel('', width, 456);
    this.root.addChild(this.queueLabel);

    this.joinQueueButton = createButton('Join matchmaking queue', 24, 500, width - 48, () => void this.joinQueue());
    this.root.addChild(this.joinQueueButton.sprite);

    this.refreshQueueButton = createButton('Refresh queue status', 24, 560, width - 48, () => void this.refreshQueue());
    this.root.addChild(this.refreshQueueButton.sprite);

    this.cancelQueueButton = createButton('Cancel matchmaking', 24, 620, width - 48, () => void this.cancelQueue());
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
    this.statusLabel.text = snapshot.lastError === '' ? snapshot.statusText : snapshot.lastError;
    if (snapshot.session !== null) {
      this.profileLabel.text =
        `${snapshot.session.displayName} (${snapshot.session.playerId || snapshot.session.userId})\n` +
        `ruleset ${snapshot.session.rulesetVersion || '-'}`;
    }
    this.queueLabel.text = describeMatchmakingQueue(snapshot);
    this.refresh(snapshot);
  }

  private refresh(snapshot: LobbyFlowSnapshot = this.options.flow.snapshot()): void {
    this.roomLabel.text = `Room code: ${this.roomCode}`;
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
}
