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
