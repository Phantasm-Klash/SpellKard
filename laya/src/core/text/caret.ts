/**
 * Caret placement math — engine-agnostic.
 *
 * The engine's web text-input adapter focuses the overlay `<input>` without
 * telling it *where* the pointer landed, so the browser drops the caret at the
 * end of the value. Clicking the middle of a filled field therefore puts the
 * caret at the far right: the caret and the text do not coincide.
 *
 * Fixing that needs one thing the core can own: turning a horizontal offset
 * inside the text box into a character index. The platform layer supplies a
 * width measurer (a 2D `measureText` call against the very same font the input
 * uses); everything else — code-point handling, the search, the rounding — is
 * pure and lives here so it can be unit-tested without a browser.
 *
 * NOTE: `core/` only — no DOM, no LayaAir, no Node.
 */

/** Measures the rendered width of a string, in the text box's own units. */
export type AdvanceMeasurer = (text: string) => number;

/**
 * The UTF-16 offsets that are legal caret positions: every code-point boundary,
 * including 0 and `text.length`. Split surrogate pairs are excluded, so the
 * caret can never land inside an emoji.
 */
export function caretBoundaries(text: string): number[] {
  const out: number[] = [0];
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    out.push(index);
  }
  return out;
}

/**
 * The caret index nearest to `x` inside the text box.
 *
 * `x` is measured from the box's text origin (0 for a left-aligned field), in
 * the same units as `measure`. Returns a UTF-16 index, ready for
 * `HTMLInputElement.setSelectionRange` / `Laya.Input.setSelection`.
 */
export function caretIndexAtX(text: string, x: number, measure: AdvanceMeasurer): number {
  if (text === '') {
    return 0;
  }
  if (!Number.isFinite(x) || x <= 0) {
    return 0;
  }
  const boundaries = caretBoundaries(text);
  const last = boundaries[boundaries.length - 1] ?? 0;
  if (x >= measure(text)) {
    return last;
  }
  // Largest boundary whose prefix is still at or left of `x`.
  let low = 0;
  let high = boundaries.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const offset = boundaries[mid] ?? last;
    if (measure(text.slice(0, offset)) <= x) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const leftIndex = boundaries[low] ?? 0;
  const leftEdge = measure(text.slice(0, leftIndex));
  const rightIndex = boundaries[low + 1];
  if (rightIndex === undefined) {
    return leftIndex;
  }
  const rightEdge = measure(text.slice(0, rightIndex));
  // Snap to whichever boundary the pointer is closer to, so a click just past
  // a glyph lands after it and a click just inside lands before it.
  return x - leftEdge <= rightEdge - x ? leftIndex : rightIndex;
}

/**
 * Where the text starts inside the box, for a given alignment. Left-aligned
 * fields (what every input in this client uses) return 0.
 */
export function textOriginX(
  align: string,
  boxWidth: number,
  textWidth: number,
  paddingLeft = 0,
): number {
  const inner = Math.max(0, boxWidth - paddingLeft);
  if (align === 'center') {
    return paddingLeft + Math.floor(Math.max(0, inner - textWidth) * 0.5);
  }
  if (align === 'right') {
    return paddingLeft + Math.max(0, inner - textWidth);
  }
  return paddingLeft;
}
