/**
 * Pointer-accurate caret placement for `Laya.Input` fields.
 *
 * MEASURED BUG (Playwright, web build): a field pre-filled with `abcdefghijkl`
 * (12 chars) inside a 261 CSS px box leaves `selectionStart === 12` no matter
 * where it is clicked — 20%, 50% and 80% across the field all park the caret at
 * the far right. The caret and the text visibly disagree.
 *
 * ROOT CAUSE (engine): `engine/libs/laya.core.js` → `class TextInputAdapter`
 * handles pointer-down in `onTouchBegin()`, which calls `this.begin(target,
 * true)` and never forwards the pointer position. The adapter then overlays a
 * real DOM `<input>` on the canvas and focuses it (`onCanShowKeyboard` →
 * `this._visEle.focus()`); the browser defaults the caret to the end of the
 * value. Clicking an *already focused* field works because the DOM element
 * receives the click itself, so only the canvas→DOM transition is broken.
 *
 * WHY THE FIX LIVES HERE: the engine cannot be patched, but the transition is
 * observable from the platform layer — the sprite sees MOUSE_DOWN before the
 * adapter's promise chain dispatches FOCUS, so we can remember where the
 * pointer was and re-apply the selection once the DOM overlay is live. The
 * index maths is engine-agnostic and lives in `core/text/caret`; this module is
 * the thin LayaAir/DOM glue around it.
 *
 * NOTE: `platform/laya/` only. Never imported from `core/`.
 */

import { caretIndexAtX, textOriginX, type AdvanceMeasurer } from '../../core/text/caret';

/**
 * Last caret index computed by {@link caretIndexFromLocalX}; `NaN` before the
 * first call. Read by {@link textInputDebugState} for the screenshot harness.
 */
let lastPointerIndex = NaN;

/**
 * Sprite-local x of the last pointer-down on a field, and the field it hit.
 *
 * These are consumed by the matching FOCUS handler: the adapter records the
 * pointer press and then focuses the overlay, so the position is only useful
 * for the *next* FOCUS and is cleared the moment it is used.
 */
let pendingPointerX = NaN;
let pendingPointerInput: Laya.Input | null = null;

/** One shared 2D context; measuring allocates a canvas otherwise, per call. */
let measureContext: CanvasRenderingContext2D | null = null;

/** Fields that already have the caret-placement listeners installed. */
const attachedInputs = new WeakSet<Laya.Input>();

/**
 * Lazily creates the single offscreen measuring context.
 *
 * Returns `null` when there is no DOM (LayaNative), so every caller can fall
 * back to a zero measurement instead of throwing.
 *
 * The whole probe is guarded: LayaNative exposes a `conch` object under the
 * name `document` that has no `createElement`, and a runtime in between the two
 * can hand back an element without `getContext`. Either way the honest answer is
 * "cannot measure", never an exception thrown into a FOCUS handler.
 */
function sharedMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext !== null) {
    return measureContext;
  }
  try {
    if (typeof document === 'undefined') {
      return null;
    }
    const canvas = document.createElement('canvas');
    if (typeof canvas.getContext !== 'function') {
      return null;
    }
    measureContext = canvas.getContext('2d');
  } catch {
    return null;
  }
  return measureContext;
}

/** Measures `text` in the same font the DOM overlay will use. */
export function measureTextWidth(text: string, fontSize: number, fontFamily: string): number {
  const context = sharedMeasureContext();
  if (context === null) {
    return 0;
  }
  // The family is written verbatim: the adapter sets `style.fontFamily` to the
  // same string, so quoting or normalising here would measure a different font.
  context.font = fontSize + 'px ' + fontFamily;
  return context.measureText(text).width;
}

/**
 * True when a real text measurer is available.
 *
 * False on LayaNative (no DOM), where the platform's own text-input bridge
 * already receives the touch position. Guessing a caret index there would
 * override that with "end of value", so the placement hook stands down instead.
 */
export function canMeasureText(): boolean {
  return sharedMeasureContext() !== null;
}

/**
 * The caret index for a pointer at `localX` inside `input`
 * (`localX` is `input.mouseX`, i.e. the sprite's own design-space units).
 */
export function caretIndexFromLocalX(input: Laya.Input, localX: number): number {
  // `mouseX` reads `NaN` before any pointer event, and goes negative when the
  // pointer is left of the box. Both mean "no usable position", and the caret
  // belongs before the first character: snapping to the *end* here is exactly
  // the bug this module exists to fix.
  if (!Number.isFinite(localX) || localX < 0) {
    lastPointerIndex = 0;
    return 0;
  }
  const fontFamily = input.realFont;
  const measure: AdvanceMeasurer = (text: string): number => measureTextWidth(text, input.fontSize, fontFamily);
  const origin = textOriginX(input.align, input.width, measure(input.text));
  const index = caretIndexAtX(input.text, localX - origin, measure);
  lastPointerIndex = index;
  return index;
}

/**
 * Makes a click inside `input` place the caret where the pointer is.
 * Returns a detach function that removes every listener it added.
 */
export function attachCaretPlacement(input: Laya.Input): () => void {
  // Idempotent per field: a second call must not stack duplicate listeners.
  if (attachedInputs.has(input)) {
    return () => undefined;
  }
  attachedInputs.add(input);

  let pendingTimeout = 0;

  const onMouseDown = (): void => {
    pendingPointerX = input.mouseX;
    pendingPointerInput = input;
  };

  const onFocus = (): void => {
    // Programmatic focus and Tab navigation leave no recorded pointer, and the
    // browser's default is correct for both — do nothing.
    if (pendingPointerInput !== input || !Number.isFinite(pendingPointerX)) {
      return;
    }
    const localX = pendingPointerX;
    // Consume the recording before applying: a later focus must not reuse it.
    pendingPointerX = NaN;
    pendingPointerInput = null;

    // LayaNative has no DOM measurer, and its own text-input bridge already got
    // the touch position: standing down leaves that behaviour untouched.
    if (!canMeasureText()) {
      return;
    }

    const index = caretIndexFromLocalX(input, localX);

    // The adapter dispatches FOCUS from its promise chain but focuses the DOM
    // element (`this._visEle.focus()`) later, and `focus()` resets the caret to
    // the end. A macrotask always runs after the microtask queue has drained,
    // so `setTimeout(0)` lands the selection after that reset; a frame timer
    // would be a whole frame late and the caret would visibly jump.
    if (pendingTimeout !== 0) {
      clearTimeout(pendingTimeout);
    }
    pendingTimeout = setTimeout(() => {
      pendingTimeout = 0;
      try {
        // `setSelection` sets `this.focus = true`, which the adapter
        // short-circuits because this field is already its target, then writes
        // the range onto the live overlay element.
        input.setSelection(index, index);
      } catch {
        // LayaNative has no DOM overlay and `PAL.textInput` may be missing; a
        // native failure must not break the field.
      }
    }, 0);
  };

  input.on(Laya.Event.MOUSE_DOWN, undefined, onMouseDown);
  input.on(Laya.Event.FOCUS, undefined, onFocus);

  return () => {
    input.off(Laya.Event.MOUSE_DOWN, undefined, onMouseDown);
    input.off(Laya.Event.FOCUS, undefined, onFocus);
    if (pendingTimeout !== 0) {
      clearTimeout(pendingTimeout);
      pendingTimeout = 0;
    }
  };
}

/** The `Laya.Input` that currently owns the keyboard, or null. */
export function focusedInput(): Laya.Input | null {
  const stage: Laya.Stage | undefined = Laya.stage;
  if (stage === undefined) {
    return null;
  }
  const focus = stage.focus;
  return focus instanceof Laya.Input ? focus : null;
}

/** Closes the DOM/native overlay for any focused input under `root`. */
export function blurAll(root: Laya.Sprite): void {
  if (root === null || root === undefined) {
    return;
  }
  blurSubtree(root);
  // No field is focused any more, so a pending pointer-down is meaningless.
  pendingPointerX = NaN;
  pendingPointerInput = null;
}

function blurSubtree(node: Laya.Sprite): void {
  if (node instanceof Laya.Input && node.focus) {
    node.focus = false;
  }
  const count = node.numChildren;
  for (let i = 0; i < count; i += 1) {
    blurSubtree(node.getChildAt(i));
  }
}

/** For the screenshot harness. Reads the live DOM overlay, so web only. */
export function textInputDebugState(): {
  readonly focused: string | null;
  readonly domInputs: number;
  readonly lastPointerIndex: number;
} {
  let focused: string | null = null;
  let domInputs = 0;
  if (typeof document !== 'undefined') {
    const active = document.activeElement;
    if (active !== null && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      const kind = active.tagName.toLowerCase();
      const type = kind === 'input' ? (active as HTMLInputElement).type : '';
      // A short label like `input:text`; the engine's overlay sets no id, so the
      // id/name suffix only appears when something else put one there.
      const label = type !== '' ? `${kind}:${type}` : kind;
      const id = active.id !== '' ? active.id : active.getAttribute('name');
      focused = id !== null && id !== '' ? `${label}#${id}` : label;
    }
    domInputs = document.querySelectorAll('input, textarea').length;
  }
  return { focused, domInputs, lastPointerIndex };
}
