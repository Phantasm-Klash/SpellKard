/**
 * Resize helpers for texture-backed `Laya.Sprite`s.
 *
 * NOTE: `platform/laya/view/` only.
 *
 * The problem this file works around is a real, pixel-verified LayaNative bug:
 * a sprite whose look comes from a `texture` bakes its draw quad on the FIRST
 * paint, using the texture/size at that moment. Afterwards `sprite.size(w, h)`
 * does NOT rebuild the quad, and neither does `sprite.repaint()`. Only
 * re-assigning the `texture` rebuilds it.
 *
 * Engine evidence (`engine/libs/laya.core.js`):
 *
 *   set texture(value) {
 *     if (this._texture == value) return;   // ← same-value assign is a no-op!
 *     this._texture && this._texture._removeReference();
 *     this._texture = value;
 *     if (value) { value._addReference(); this.graphics.repaint(); }
 *     else { if (this._graphics) { this._graphics.repaint(); } else { this.repaint(); } }
 *   }
 *
 * Two consequences:
 *  - `sprite.texture = sprite.texture` does nothing, because the setter returns
 *    early on an equal value. The texture must be cleared to `null` first and
 *    then assigned back.
 *  - `Sprite.size()` alone is insufficient: `_setWidthHeight` only sets
 *    `_notifyChange` when `autoSize` is true, and `size()` itself returns early
 *    for some `Size` transitions — so the stale quad survives.
 *
 * On device the `null → original` round-trip was measured to work: before the
 * fix the backdrop art stopped at canvas x=960 (the old width); after it, the
 * art filled to x=1400 (the full width).
 */

/**
 * Forces a texture-backed sprite to rebuild its draw quad at its current size.
 *
 * Call this instead of a bare `sprite.size()` whenever a textured sprite is
 * re-tiled (e.g. a cover-fit backdrop on `Laya.Event.RESIZE`). It clears the
 * texture to `null` and re-assigns the original so the engine's `texture` setter
 * runs its repaint branch again; the `null` round-trip also balances the
 * engine's internal reference counting (`_removeReference` / `_addReference`)
 * correctly. A direct `sprite.texture = sprite.texture` would NOT work — the
 * setter returns early when the value is unchanged.
 *
 * @returns `true` when a texture was present and the quad was rebuilt; `false`
 *   when the sprite has no texture yet (art not loaded — the caller should keep
 *   its own fallback and re-call once the texture arrives).
 */
export function rebuildTextureQuad(sprite: Laya.Sprite): boolean {
  const texture = sprite.texture;
  if (texture === null || texture === undefined) {
    return false;
  }
  // `sprite.texture = sprite.texture` is a no-op (the setter early-returns on an
  // equal value), so the texture must be cleared first. The null round-trip also
  // keeps the engine's internal reference count balanced.
  sprite.texture = null;
  sprite.texture = texture;
  return true;
}

/**
 * Sizes a texture-backed sprite and forces its draw quad to rebuild in one step.
 *
 * The order matters: the size must be set BEFORE the rebuild, because the quad
 * is baked from the size at rebuild time. This is the entry point scenes should
 * use for a cover-fit backdrop, replacing a bare `sprite.size(width, height)`.
 *
 * A sprite that has no texture yet (art still loading) is a supported degrade
 * case: the size is still applied and `false` is returned, so the caller can
 * paint its own fallback and retry after the texture loads.
 *
 * @returns `true` when a texture was present and the quad was rebuilt; `false`
 *   otherwise (see `rebuildTextureQuad`).
 */
export function resizeTextureSprite(sprite: Laya.Sprite, width: number, height: number): boolean {
  // Size first: the rebuild below bakes the quad from the new dimensions.
  sprite.size(width, height);
  return rebuildTextureQuad(sprite);
}
