/**
 * Result screen: winner, points and replay id for a settled match.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import { createButton, createLabel, createPanel, createTitle, type ButtonHandle } from './ui_kit';
import type { ClientScene } from './scene';

export interface ResultSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
  /** Lazily read: the player id is only known after lobby sign-in. */
  localPlayerId: () => string;
}

export class ResultScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly headline: Laya.Text;
  private readonly detail: Laya.Text;
  private readonly backButton: ButtonHandle;

  constructor(private readonly options: ResultSceneOptions) {
    const { width } = options;
    this.root = new Laya.Sprite();
    this.root.size(width, options.height);
    this.root.visible = false;

    this.root.addChild(createTitle('Match result', width));
    this.root.addChild(createPanel(16, 70, width - 32, 190));

    this.headline = createLabel('', width, 88, 20);
    this.detail = createLabel('', width, 130);
    this.root.addChild(this.headline);
    this.root.addChild(this.detail);

    this.backButton = createButton('Back to lobby', 24, 290, width - 48, () => this.options.flow.backToLobby());
    this.root.addChild(this.backButton.sprite);
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
    const result = snapshot.result;
    if (result === null) {
      this.headline.text = 'No result yet';
      this.detail.text = '';
      return;
    }
    const won = result.winnerPlayerId === this.options.localPlayerId();
    this.headline.text = won ? 'Victory!' : 'Defeat';
    const points = Object.entries(result.points)
      .map(([playerId, value]) => `${playerId}: ${value}`)
      .join('   ');
    this.detail.text =
      `Winner: ${result.winnerPlayerId}\n` +
      `Points: ${points || '-'}\n` +
      `Replay: ${result.replayId || '-'}\n` +
      `Authoritative: ${result.serverAuthoritative ? 'yes' : 'no'} · settled ${result.settledAtMs}`;
  }
}
