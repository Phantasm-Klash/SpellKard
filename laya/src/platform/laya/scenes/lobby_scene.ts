/**
 * Lobby screen: sign in, pick a room code, create or join a room.
 *
 * Room codes are cycled from a small preset list instead of a text field so the
 * screen stays dependency-free; a real `Laya.TextInput` (laya.ui) replaces the
 * cycle button once the UI package is bundled.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
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
  private readonly signInButton: ButtonHandle;
  private readonly createButton: ButtonHandle;
  private readonly joinButton: ButtonHandle;
  private readonly cycleButton: ButtonHandle;
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

    this.roomCodeIndex = 0;
    this.refresh();
  }

  onEnter(): void {
    this.root.visible = true;
    this.refresh();
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
    this.refresh();
  }

  private refresh(): void {
    this.roomLabel.text = `Room code: ${this.roomCode}`;
    const signedIn = this.options.flow.snapshot().session !== null;
    this.createButton.setEnabled(signedIn && !this.busy);
    this.joinButton.setEnabled(signedIn && !this.busy);
    this.signInButton.setEnabled(!signedIn && !this.busy);
    this.cycleButton.setEnabled(!this.busy);
  }

  private cycleRoomCode(): void {
    this.roomCodeIndex = (this.roomCodeIndex + 1) % PRESET_ROOM_CODES.length;
    this.refresh();
  }

  private async signIn(): Promise<void> {
    this.busy = true;
    this.refresh();
    await this.options.flow.signIn('Player');
    this.busy = false;
    this.refresh();
  }

  private async createRoom(): Promise<void> {
    this.busy = true;
    this.refresh();
    await this.options.flow.createRoom(this.roomCode);
    this.busy = false;
    this.refresh();
  }

  private async joinRoom(): Promise<void> {
    this.busy = true;
    this.refresh();
    await this.options.flow.joinRoom(this.roomCode);
    this.busy = false;
    this.refresh();
  }
}
