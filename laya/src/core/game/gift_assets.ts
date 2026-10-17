/**
 * Runtime location of the in-match gift icons.
 *
 * Six 64x64 transparent PNGs ship under the IDE resource tree
 * (`layaide/assets/resources/gifts/`), one per catalog gift:
 *
 *  - `gift_heart.png`    — Twemoji 14.0.2 `2764` (heavy black heart), CC-BY 4.0.
 *  - `gift_star.png`     — 东方梦符祭 (workshop 1332364041) `custom_game/star_png`,
 *                          the mod's own glowing star, extracted from the VPK.
 *  - `gift_ribbon.png`   — Twemoji 14.0.2 `1f380` (ribbon), CC-BY 4.0.
 *  - `gift_lantern.png`  — Twemoji 14.0.2 `1f3ee` (red paper lantern), CC-BY 4.0.
 *  - `gift_wand.png`     — 东方梦符祭 `spellicons/touhoutd/thtd_reimu_02`,
 *                          Reimu's gohei wand, decoded from the VPK.
 *  - `gift_cup.png`      — 东方梦符祭 `items/qingcha` (green-tea flask),
 *                          decoded from the VPK and cropped to the art.
 *
 * The mod art was decoded offline from the workshop VPK with a pure-python
 * `vtex_c` reader (Source 2 resource blocks + DXT5/BC3 and PNG_DXT5 pixel
 * formats). Every gift keeps its vector glyph as the fallback, so a missing
 * file degrades to the old drawing instead of a blank slot.
 *
 * Exactly like {@link ./login_assets} and {@link ./tna_assets}, the same files
 * are reached through **different URL roots** depending on deployment:
 *
 *  - **web** — `index.html` is served from `laya/`, so the path is relative:
 *    `layaide/assets/resources/gifts`.
 *  - **LayaNative / IDE publish** — the tree is exported under the packaged
 *    resource root: `resources/gifts`.
 *
 * NOTE: `core/` only — no Laya / DOM types here.
 */

/** Directory name of the gift icons inside the resource root. */
export const GIFT_ASSET_DIR = 'gifts';

/** Web root, relative to `laya/index.html`. */
export const GIFT_WEB_ROOT = 'layaide/assets/resources/gifts';

/** LayaNative / IDE-publish root, relative to the packaged resource root. */
export const GIFT_NATIVE_ROOT = 'resources/gifts';

/**
 * Ordered candidate roots for a deployment, most-likely first. The loader
 * walks the list and keeps the first root that actually resolves an icon, so
 * a wrong guess costs one failed request per icon instead of blanking the bar.
 */
export function giftAssetRootCandidates(native: boolean): readonly string[] {
  return native ? [GIFT_NATIVE_ROOT, GIFT_WEB_ROOT] : [GIFT_WEB_ROOT, GIFT_NATIVE_ROOT];
}

/** The single preferred root for a deployment. */
export function resolveGiftAssetRoot(native: boolean): string {
  return giftAssetRootCandidates(native)[0];
}

/**
 * URL of one gift icon file. `icon` is the catalog's root-relative file name
 * (e.g. `gift_heart.png`); a leading `/` is tolerated and stripped so callers
 * can pass either spelling.
 */
export function giftIconUrl(icon: string, native: boolean): string {
  return giftIconUrlAt(resolveGiftAssetRoot(native), icon);
}

/**
 * Joins an icon file name onto an explicit asset root. The platform layer
 * probes several roots, so it needs the join without the deployment pick.
 */
export function giftIconUrlAt(root: string, icon: string): string {
  return `${root}/${icon.replace(/^\/+/, '')}`;
}
