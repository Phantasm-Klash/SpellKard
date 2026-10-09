/**
 * Screen contract shared by the client screens.
 *
 * `applySnapshot` is listed as optional so screens that render outside the flow
 * (the battle screen) still satisfy the interface; the lobby-family screens all
 * implement it and `app.ts` calls it directly on those typed references.
 */

import type { LobbyFlowSnapshot } from '../../../core/game/lobby_flow';

export interface ClientScene {
  readonly root: Laya.Sprite;
  /** Called when the screen becomes visible. */
  onEnter(): void;
  /** Called when the screen stops being visible. */
  onExit(): void;
  destroy(): void;
  /** Rebuild the screen from the current flow snapshot. */
  applySnapshot?(snapshot: LobbyFlowSnapshot): void;
}
