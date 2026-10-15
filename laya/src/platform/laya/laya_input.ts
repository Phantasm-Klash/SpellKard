/**
 * Keyboard input for the LayaAir build.
 *
 * Tracks key-down state on `Laya.stage` and exposes a `RawInputSnapshot` that
 * `encodeInput` converts into the server's direction bitmask. Bindings follow
 * the Godot prototype's intent (arrow keys or WASD to move, Z/J to shoot,
 * Shift to focus, X/K to bomb, 1-4 for card slots).
 *
 * The digit keys map onto **0-based** wire slots (key `1` = the first card) via
 * `core/game/input.cardSlotForKeyCode`; the armed slot is held in a
 * `CardKeyState` so a keypress survives exactly one packet.
 */

import type { RawInputSnapshot } from '../../core/game/input';
import { CardKeyState, emptyInputState } from '../../core/game/input';

export const KEY_LEFT = 37;
export const KEY_UP = 38;
export const KEY_RIGHT = 39;
export const KEY_DOWN = 40;
export const KEY_SHIFT = 16;
export const KEY_A = 65;
export const KEY_D = 68;
export const KEY_S = 83;
export const KEY_W = 87;
export const KEY_J = 74;
export const KEY_K = 75;
export const KEY_X = 88;
export const KEY_Z = 90;

interface KeyEventLike {
  keyCode: number;
}

export class LayaInput {
  private readonly pressed = new Set<number>();
  /** The card slot armed by the digit keys `1`..`4`, cleared once per tick. */
  private readonly cardKeys = new CardKeyState();

  constructor() {
    Laya.stage.on(Laya.Event.KEY_DOWN, this, (...args: unknown[]) => {
      const event = args[0] as KeyEventLike | undefined;
      if (event !== undefined) {
        this.onKeyDown(event.keyCode);
      }
    });
    Laya.stage.on(Laya.Event.KEY_UP, this, (...args: unknown[]) => {
      const event = args[0] as KeyEventLike | undefined;
      if (event !== undefined) {
        this.pressed.delete(event.keyCode);
      }
    });
  }

  private onKeyDown(keyCode: number): void {
    this.pressed.add(keyCode);
    this.cardKeys.press(keyCode);
  }

  private isDown(...keyCodes: number[]): boolean {
    for (const keyCode of keyCodes) {
      if (this.pressed.has(keyCode)) {
        return true;
      }
    }
    return false;
  }

  /** Clears transient (just-pressed) state; call once per simulation tick. */
  consumeTransient(): void {
    this.cardKeys.consume();
  }

  snapshot(): RawInputSnapshot {
    return {
      left: this.isDown(KEY_LEFT, KEY_A),
      right: this.isDown(KEY_RIGHT, KEY_D),
      up: this.isDown(KEY_UP, KEY_W),
      down: this.isDown(KEY_DOWN, KEY_S),
      slow: this.isDown(KEY_SHIFT),
      shoot: this.isDown(KEY_Z, KEY_J),
      bomb: this.isDown(KEY_X, KEY_K),
      cardSlot: this.cardKeys.slot,
    };
  }

  /** Convenience for tests/headless runs. */
  empty(): RawInputSnapshot {
    const state = emptyInputState();
    return {
      left: false,
      right: false,
      up: false,
      down: false,
      slow: state.slow,
      shoot: state.shoot,
      bomb: state.bomb,
      cardSlot: state.cardSlot,
    };
  }

  destroy(): void {
    Laya.stage.offAll(Laya.Event.KEY_DOWN);
    Laya.stage.offAll(Laya.Event.KEY_UP);
    this.pressed.clear();
  }
}
