/**
 * Input model shared by the local practice loop and the online battle client.
 *
 * Bit layout follows the battle server (`PhK-BattleServer/src/boss_race.cpp`):
 * `up=0x1, right=0x2, down=0x4, left=0x8`. The Godot prototype used a different
 * layout, so this module is the single place the client translates raw device
 * input into the wire bitmask.
 */

import { DIR_DOWN, DIR_LEFT, DIR_MASK, DIR_RIGHT, DIR_UP } from '../sim/boss_race';

export interface InputState {
  directionBits: number;
  slow: boolean;
  shoot: boolean;
  bomb: boolean;
  cardSlot: number;
}

export function emptyInputState(): InputState {
  return { directionBits: 0, slow: false, shoot: false, bomb: false, cardSlot: -1 };
}

export interface RawInputSnapshot {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  slow: boolean;
  shoot: boolean;
  bomb: boolean;
  cardSlot: number;
}

export function encodeInput(raw: RawInputSnapshot): InputState {
  let bits = 0;
  if (raw.up) {
    bits |= DIR_UP;
  }
  if (raw.right) {
    bits |= DIR_RIGHT;
  }
  if (raw.down) {
    bits |= DIR_DOWN;
  }
  if (raw.left) {
    bits |= DIR_LEFT;
  }
  return {
    directionBits: bits & DIR_MASK,
    slow: raw.slow,
    shoot: raw.shoot,
    bomb: raw.bomb,
    cardSlot: raw.cardSlot,
  };
}

/** Unit movement vector for a direction bitmask (screen space, +y down). */
export function directionVector(bits: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if ((bits & DIR_LEFT) !== 0) {
    x -= 1;
  }
  if ((bits & DIR_RIGHT) !== 0) {
    x += 1;
  }
  if ((bits & DIR_UP) !== 0) {
    y -= 1;
  }
  if ((bits & DIR_DOWN) !== 0) {
    y += 1;
  }
  const length = Math.sqrt(x * x + y * y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  return { x, y };
}

/** Human-readable bit names, used by the debug HUD and tests. */
export function describeDirectionBits(bits: number): string {
  const names: string[] = [];
  if ((bits & DIR_UP) !== 0) {
    names.push('up');
  }
  if ((bits & DIR_RIGHT) !== 0) {
    names.push('right');
  }
  if ((bits & DIR_DOWN) !== 0) {
    names.push('down');
  }
  if ((bits & DIR_LEFT) !== 0) {
    names.push('left');
  }
  return names.length === 0 ? 'none' : names.join('+');
}

/** Hand size the lobby enforces (`cardHandLimit`); a cast slot stays below it. */
export const MAX_CARD_SLOTS = 4;

/**
 * A one-shot card-cast intent.
 *
 * The battle loop builds exactly one packet per tick, so a click must survive
 * one `take()` and then clear — otherwise a single click would cast on every
 * subsequent tick. Out-of-range requests are ignored rather than clamped: a
 * stale UI must never fire a card the server would reject anyway.
 */
export class CardCastIntent {
  private pending = -1;

  get armed(): boolean {
    return this.pending >= 0;
  }

  /** Arms a cast for the next packet; returns whether the request was accepted. */
  request(slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_CARD_SLOTS) {
      return false;
    }
    this.pending = slot;
    return true;
  }

  /** Consumes the armed slot (one packet only); `-1` when nothing is armed. */
  take(): number {
    const slot = this.pending;
    this.pending = -1;
    return slot;
  }

  cancel(): void {
    this.pending = -1;
  }
}

/**
 * `KeyboardEvent.keyCode` for the digit keys `1`..`4`, in slot order.
 *
 * The values are the **wire** slots: 0-based, so key `1` casts the first card.
 * That matches the server's `ValidateCast` (`slot >= hand.size()` is rejected,
 * see `M-1_card_slot_bound_fix.md`) and `CardCastIntent`. The old
 * `keyCode - KEY_1 + 1` mapping was 1-based, which cast the *second* card on
 * key `1` and made key `4` an out-of-range slot the server rejects.
 */
export const CARD_KEY_CODES: readonly number[] = [49, 50, 51, 52];

/**
 * Maps a key code onto a 0-based cast slot, or `-1` when the key is not a card
 * key. `-1` doubles as the wire's "no card this tick" sentinel.
 */
export function cardSlotForKeyCode(keyCode: number): number {
  return CARD_KEY_CODES.indexOf(keyCode);
}

/**
 * Tracks the card slot armed by the digit keys.
 *
 * The battle loop reads one slot per tick and then clears it, so a keypress
 * survives exactly one packet — the keyboard's counterpart to
 * {@link CardCastIntent}'s one-shot contract. Kept in `core/` so the key→slot
 * mapping and the transient reset are unit-testable without an engine.
 */
export class CardKeyState {
  private pending = -1;

  /** Records a key-down; a non-card key leaves the armed slot unchanged. */
  press(keyCode: number): void {
    const slot = cardSlotForKeyCode(keyCode);
    if (slot >= 0) {
      this.pending = slot;
    }
  }

  /** The armed slot (0-based), or `-1` when no card key was pressed. */
  get slot(): number {
    return this.pending;
  }

  /** Clears the transient state; call once per simulation tick. */
  consume(): void {
    this.pending = -1;
  }
}
