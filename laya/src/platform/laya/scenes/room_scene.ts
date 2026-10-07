/**
 * Room screen: shows the player roster and starts the match.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import { createButton, createLabel, createPanel, createTitle, type ButtonHandle } from './ui_kit';
import type { ClientScene } from './scene';

export interface RoomSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
}

export class RoomScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly roomLabel: Laya.Text;
  private readonly playersLabel: Laya.Text;
  private readonly statusLabel: Laya.Text;
  private readonly readyButton: ButtonHandle;
  private readonly leaveButton: ButtonHandle;
  private busy = false;

  constructor(private readonly options: RoomSceneOptions) {
    const { width, height } = options;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    this.root.addChild(createTitle('Room', width));
    this.root.addChild(createPanel(16, 70, width - 32, 150));
    this.roomLabel = createLabel('', width, 84);
    this.playersLabel = createLabel('', width, 116);
    this.root.addChild(this.roomLabel);
    this.root.addChild(this.playersLabel);

    this.statusLabel = createLabel('', width, 236);
    this.root.addChild(this.statusLabel);

    this.readyButton = createButton('Ready', 24, 300, width - 48, () => void this.ready());
    this.root.addChild(this.readyButton.sprite);

    this.leaveButton = createButton('Leave room', 24, 360, width - 48, () => void this.leave());
    this.root.addChild(this.leaveButton.sprite);
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

  applySnapshot(snapshot: LobbyFlowSnapshot): void {
    this.statusLabel.text = snapshot.lastError === '' ? snapshot.statusText : snapshot.lastError;
    const room = snapshot.room;
    if (room === null) {
      this.roomLabel.text = 'No room';
      this.playersLabel.text = '';
      return;
    }
    this.roomLabel.text = `Code ${room.roomCode} · ${room.modeId} · ruleset ${room.rulesetVersion || '-'}`;
    const lines = room.players.map((player) => {
      const flags = [player.host ? 'host' : '', player.ready ? 'ready' : 'waiting', player.connected ? '' : 'offline']
        .filter((value) => value !== '')
        .join(', ');
      return `• ${player.displayName || player.playerId}${flags === '' ? '' : ` (${flags})`}`;
    });
    this.playersLabel.text = lines.length > 0 ? lines.join('\n') : 'Waiting for players…';
    const allReady = room.allReady && room.players.length >= 2;
    this.readyButton.setEnabled(!this.busy);
    this.readyButton.setText(allReady ? 'Start match' : 'Ready');
  }

  private async ready(): Promise<void> {
    this.busy = true;
    this.statusLabel.text = 'Ready — waiting for match…';
    await this.options.flow.ready();
    this.busy = false;
    this.applySnapshot(this.options.flow.snapshot());
  }

  private async leave(): Promise<void> {
    this.busy = true;
    await this.options.flow.leaveRoom();
    this.busy = false;
  }
}
