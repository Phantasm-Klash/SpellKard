/**
 * Global keyboard shortcut dispatch for the LayaAir build.
 *
 * The shortcut *table* and the matcher live in `core/input/shortcuts` and know
 * nothing about the engine. This module is the other half: it owns the single
 * `KEY_DOWN` listener on `Laya.stage`, asks the matcher whether the pressed key
 * maps to an action in the active screen's scope, and hands that action to
 * whichever screen is on top. Screens never subscribe to raw key events
 * themselves, so adding a shortcut stays a one-line change in the table plus a
 * handler on the owning screen.
 *
 * Deliberately does not:
 *  - Own any screen state. `setHost` is driven by the screen switcher; the
 *    dispatcher only remembers the active host and its scope.
 *  - Interpret keys. Normalisation, modifier matching and the text-input policy
 *    all live in the core matcher, which is unit-tested without a stage.
 *  - Swallow keys it cannot place. `preventDefault()` is only called when the
 *    host reports the action as consumed, so an unhandled key still reaches the
 *    browser (F5, dev tools, ...).
 *
 * `Laya.stage` does not exist until `Laya.init` has run, and a headless test
 * may never run it, so every stage access is guarded and `attach()` degrades to
 * a no-op instead of throwing.
 *
 * NOTE: `platform/laya/` only.
 */

import { isModifierOnly, resolveShortcut } from '../../core/input/shortcuts';
import type { ShortcutAction, ShortcutScope } from '../../core/input/shortcuts';

/** A screen that can receive shortcut actions. */
export interface ShortcutHost {
  readonly scope: ShortcutScope;
  /** Returns true when the action was consumed (so the key's default is suppressed). */
  handleShortcut(action: ShortcutAction, event: Laya.KeyboardEventLike): boolean;
}

/**
 * The live `Laya.stage`, or `null` before `Laya.init` has run.
 *
 * The declaration file types `Laya.stage` as always present, but at runtime it
 * is assigned during init, so the cast back to optional is the honest shape.
 */
function stageOrNull(): Laya.Stage | null {
  const stage = (Laya as unknown as { readonly stage?: Laya.Stage }).stage;
  return stage ?? null;
}

/** True when a text field currently owns the keyboard. */
export function isTextInputFocused(): boolean {
  const stage = stageOrNull();
  if (stage === null) {
    return false;
  }
  const focus: unknown = stage.focus;
  return typeof focus === 'object' && focus !== null && focus instanceof Laya.Input;
}

export interface ShortcutDebugState {
  readonly attached: boolean;
  readonly scope: ShortcutScope;
  readonly inTextInput: boolean;
  readonly lastAction: ShortcutAction | null;
  readonly dispatchCount: number;
}

export class ShortcutDispatcher {
  private attachedFlag = false;
  private currentHost: ShortcutHost | null = null;
  private lastActionValue: ShortcutAction | null = null;
  private dispatchCountValue = 0;

  /**
   * A property arrow function, not a prototype method: the bound reference is
   * what `off` matches against, and an inline closure would be unremovable
   * because `off` compares by identity.
   */
  private readonly onKeyDown = (...args: unknown[]): void => {
    const raw = args[0];
    if (raw === null || typeof raw !== 'object') {
      return;
    }
    const event = raw as Laya.KeyboardEventLike;
    if (isModifierOnly(event)) {
      return;
    }
    const host = this.currentHost;
    if (host === null) {
      return;
    }
    const action = resolveShortcut(event, host.scope, { inTextInput: isTextInputFocused() });
    if (action === null) {
      return;
    }
    this.lastActionValue = action;
    this.dispatchCountValue += 1;
    if (host.handleShortcut(action, event)) {
      event.preventDefault?.();
    }
  };

  get host(): ShortcutHost | null {
    return this.currentHost;
  }

  /** Attaches the global KEY_DOWN listener. Idempotent. */
  attach(): void {
    if (this.attachedFlag) {
      return;
    }
    const stage = stageOrNull();
    if (stage === null) {
      return;
    }
    stage.on(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    this.attachedFlag = true;
  }

  /** Removes the listener. Idempotent. */
  detach(): void {
    if (!this.attachedFlag) {
      return;
    }
    stageOrNull()?.off(Laya.Event.KEY_DOWN, this, this.onKeyDown);
    this.attachedFlag = false;
  }

  /** Sets the active screen. Pass null when no screen wants shortcuts. */
  setHost(host: ShortcutHost | null): void {
    this.currentHost = host;
  }

  debugState(): ShortcutDebugState {
    return {
      attached: this.attachedFlag,
      scope: this.currentHost?.scope ?? 'global',
      inTextInput: isTextInputFocused(),
      lastAction: this.lastActionValue,
      dispatchCount: this.dispatchCountValue,
    };
  }
}
