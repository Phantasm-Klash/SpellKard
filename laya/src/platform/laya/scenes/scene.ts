/**
 * Screen contract shared by the four client screens.
 */

export interface ClientScene {
  readonly root: Laya.Sprite;
  /** Called when the screen becomes visible. */
  onEnter(): void;
  /** Called when the screen stops being visible. */
  onExit(): void;
  destroy(): void;
}
