/**
 * Screen contract shared by the client screens.
 *
 * `applySnapshot` is listed as optional so screens that render outside the flow
 * (the battle screen) still satisfy the interface; the lobby-family screens all
 * implement it and `app.ts` calls it directly on those typed references.
 *
 * `shortcutScope` / `handleShortcut` are the keyboard half of the same idea: a
 * screen opts in by implementing {@link ShortcutCapable}, and `app.ts` forwards
 * every action the global dispatcher resolves to whichever screen is on top.
 * Screens that have nothing keyboard-shaped simply omit them.
 */

import type { LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import type { ShortcutAction, ShortcutScope } from '../../../core/input/shortcuts';

export interface ClientScene {
  readonly root: Laya.Sprite;
  /** Called when the screen becomes visible. */
  onEnter(): void;
  /** Called when the screen stops being visible. */
  onExit(): void;
  destroy(): void;
  /** Rebuild the screen from the current flow snapshot. */
  applySnapshot?(snapshot: LobbyFlowSnapshot): void;
  /**
   * Optional settings overlay owned by this screen, when it has one. `app.ts`
   * uses it to service the global "open settings" shortcut without knowing
   * which screen is showing.
   */
  readonly settings?: SettingsOverlayLike;
}

/** The slice of `SettingsPanel` the app shell needs. */
export interface SettingsOverlayLike {
  show(): void;
  hide(): void;
  readonly isOpen: boolean;
}

/**
 * A screen that answers keyboard shortcuts.
 *
 * `handleShortcut` must return `true` only when it actually did something —
 * that return value is what suppresses the key's browser default, so claiming
 * an action that was ignored would swallow the key for no reason.
 */
export interface ShortcutCapable {
  readonly shortcutScope: ShortcutScope;
  handleShortcut(action: ShortcutAction, event: Laya.KeyboardEventLike): boolean;
}

/**
 * Narrows a scene to the shortcut-capable shape.
 *
 * Uses a duck-typed check rather than `instanceof` so a scene can satisfy the
 * contract without extending a shared base class.
 */
export function isShortcutCapable(scene: ClientScene | null): scene is ClientScene & ShortcutCapable {
  if (scene === null) {
    return false;
  }
  const candidate = scene as Partial<ShortcutCapable>;
  return typeof candidate.shortcutScope === 'string' && typeof candidate.handleShortcut === 'function';
}
