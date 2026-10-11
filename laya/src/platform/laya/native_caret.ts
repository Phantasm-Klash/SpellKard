/**
 * Caret-geometry fix for LayaNative's private text layout.
 *
 * MEASURED BUG (native `.exe`): clicking an **empty** `Laya.Input` put the
 * caret in visibly the wrong place — too high and too short — no matter where
 * inside the box the pointer landed. A field with any character in it was fine.
 *
 * ROOT CAUSE (engine, `engine/libs/laya.adapter-native.js`): the caret is not
 * drawn by conch, it is drawn in JavaScript by `NativeTextInputVisual`, which
 * asks `NativeTextLayout.getCaretRect(index)`. That method has an early-exit for
 * empty text which ignores everything the normal path uses:
 *
 *     if (this._lines.length === 0 || textLength === 0) {
 *         const height = Math.max(1, Math.floor(target.fontSize * fontScale) + 1);
 *         let x = padding[3];
 *         if (target.align === 'center') x += Math.floor(contentWidth * 0.5);
 *         else if (target.align === 'right') x += contentWidth;
 *         return out.setTo(x - scrollX, padding[0] - scrollY, 0, height);
 *     }
 *
 * `y = padding[0]` pins the caret to the padding box instead of the text line,
 * so `valign` is ignored; `height = fontSize + 1` drops `leading`. Measured on
 * the login Username field (`padding 0,0,0,0`, `valign middle`, `height 44`,
 * `fontSize 17`, `leading 2`, `text ''`): the caret came back
 * `{x: 0, y: 0, h: 18}` while the real line — the placeholder's, which is the
 * one the player sees — sits at `{x: 0, y: 11, h: 21}`.
 *
 * WHY THIS IS A PROTOTYPE PATCH: the layout object is unreachable from
 * TypeScript (it is created inside the adapter and never exposed), and there is
 * no engine API for caret *geometry* at all — `Laya.Text` only has
 * `setSelection`/`selectionStart`, i.e. the index, never the rectangle. The
 * class itself is published as `Laya.NativeTextLayout` (the adapter's UMD tail
 * does `exports.NativeTextLayout = NativeTextLayout` against the `Laya` global),
 * so its prototype is the one seam available.
 *
 * The patch only rewrites the empty-text branch, and only when a laid-out line
 * exists to copy the geometry from. Fields with text, and layouts that have not
 * typeset anything yet, keep the engine's own answer.
 *
 * NOTE: `platform/laya/` only. Native only; a no-op on web.
 */

/** The private `NativeTextLayout` constructor, as seen from TypeScript. */
interface NativeLayoutConstructor {
  readonly prototype: unknown;
}

/** The line record `NativeTextLayout` keeps per typeset line. */
interface NativeLayoutLine {
  readonly x?: number;
  readonly y?: number;
  readonly height?: number;
}

/** One entry of `NativeTextLayout._lines`. */
interface NativeIndexedLine {
  readonly line?: NativeLayoutLine;
}

/** The bits of the layout instance and its target this fix reads. */
interface NativeLayoutState {
  /** The field's own text, *not* its placeholder. Empty is the buggy case. */
  readonly _text?: unknown;
  readonly _lines?: readonly NativeIndexedLine[];
  readonly _target?: {
    readonly padding?: readonly number[];
    readonly scrollY?: number;
  };
}

/** `NativeTextLayout.prototype.getCaretRect`. */
type NativeGetCaretRect = (this: unknown, index: number, out?: Laya.Rectangle) => Laya.Rectangle;

let installed = false;

/** True once {@link installNativeCaretFix} has patched the layout. */
export function nativeCaretFixInstalled(): boolean {
  return installed;
}

/** The published `NativeTextLayout` constructor, or `null` when absent. */
function nativeLayoutConstructor(): NativeLayoutConstructor | null {
  const namespace = Laya as unknown as { readonly NativeTextLayout?: unknown };
  const constructor = namespace.NativeTextLayout;
  if (typeof constructor !== 'function') {
    return null;
  }
  return constructor as NativeLayoutConstructor;
}

/**
 * Rewrites the caret rectangle for an empty field from the real first line.
 *
 * Returns `rect` untouched whenever the engine's own answer should stand, so a
 * runtime whose layout looks different from the one measured here simply keeps
 * the stock behaviour instead of breaking.
 */
function correctedCaretRect(state: NativeLayoutState, rect: Laya.Rectangle): Laya.Rectangle {
  // Any text at all takes the engine's normal path, which already returns the
  // real line geometry — never second-guess it.
  const text = state._text === undefined || state._text === null ? '' : String(state._text);
  if (text !== '') {
    return rect;
  }

  const lines = state._lines;
  if (lines === undefined || lines.length === 0) {
    return rect;
  }
  const line = lines[0]?.line;
  if (line === undefined || !Number.isFinite(line.y) || !Number.isFinite(line.height)) {
    return rect;
  }

  const padding = state._target?.padding;
  const padTop = padding !== undefined && Number.isFinite(padding[0]) ? padding[0] : 0;
  const scrollY = state._target?.scrollY;
  const scrolled = scrollY !== undefined && Number.isFinite(scrollY) ? scrollY : 0;

  rect.y = padTop + (line.y as number) - scrolled;
  rect.height = line.height as number;
  return rect;
}

/**
 * Installs the fix. Idempotent, and safe to call on web or before the engine
 * has loaded: it returns `false` and changes nothing when the layout class is
 * not present.
 */
export function installNativeCaretFix(): boolean {
  if (installed) {
    return true;
  }
  const constructor = nativeLayoutConstructor();
  if (constructor === null) {
    return false;
  }
  const prototype = constructor.prototype as { getCaretRect?: NativeGetCaretRect };
  const original = prototype.getCaretRect;
  if (typeof original !== 'function') {
    return false;
  }

  prototype.getCaretRect = function patchedGetCaretRect(
    this: unknown,
    index: number,
    out?: Laya.Rectangle,
  ): Laya.Rectangle {
    const rect = original.call(this, index, out);
    try {
      return correctedCaretRect(this as NativeLayoutState, rect);
    } catch {
      // A shape this fix does not recognise must not break the field: fall back
      // to exactly what the engine computed.
      return rect;
    }
  };

  installed = true;
  return true;
}
