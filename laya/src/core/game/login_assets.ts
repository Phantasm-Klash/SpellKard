/**
 * Runtime location of the login-screen art.
 *
 * Two files ship under the IDE resource tree (`assets/resources/login/`):
 *
 *  - `login_bg.png`     — the title-screen backdrop (320x480, opaque).
 *  - `login_reimu.png`  — 博丽灵梦 / Reimu Hakurei, full-body, transparent (190x279).
 *
 * Both were lifted from the 千夜追忆 1.40 APK (`assets/bg_title.png` and
 * `assets/player_01.png`), which is the art the rest of the client already uses.
 *
 * Exactly like {@link ./tna_assets}, the same files are reached through
 * **different URL roots** depending on deployment:
 *
 *  - **web** — `index.html` is served from `laya/`, so the path is relative:
 *    `layaide/assets/resources/login`.
 *  - **LayaNative / IDE publish** — the tree is exported under the packaged
 *    resource root: `resources/login`.
 *
 * NOTE: `core/` only — no Laya / DOM types here.
 */

/** Directory name of the login art inside the resource root. */
export const LOGIN_ASSET_DIR = 'login';

/** Web root, relative to `laya/index.html`. */
export const LOGIN_WEB_ROOT = 'layaide/assets/resources/login';

/** LayaNative / IDE-publish root, relative to the packaged resource root. */
export const LOGIN_NATIVE_ROOT = 'resources/login';

/** File name of the full-screen login backdrop. */
export const LOGIN_BACKGROUND_FILE = 'login_bg.png';

/** File name of the Reimu portrait shown beside the form. */
export const LOGIN_PORTRAIT_FILE = 'login_reimu.png';

/**
 * File name of the translucent spell-sigil disc drawn behind the portrait.
 *
 * Square, transparent, gold-on-magenta. It replaces the flat vector ellipse the
 * login screen used first, which read as a hard-edged red disc rather than
 * something belonging to the art. Loading it is optional: the scene falls back
 * to the ellipse when the file is missing.
 */
export const LOGIN_SIGIL_FILE = 'login_sigil.png';

/** Intrinsic size of {@link LOGIN_BACKGROUND_FILE}, in pixels. */
export const LOGIN_BACKGROUND_SIZE = { width: 320, height: 480 } as const;

/** Intrinsic size of {@link LOGIN_PORTRAIT_FILE}, in pixels. */
export const LOGIN_PORTRAIT_SIZE = { width: 190, height: 279 } as const;

/**
 * Ordered candidate roots for a deployment, most-likely first. The scene walks
 * the list and keeps the first root that actually loads, so a wrong guess costs
 * one failed request instead of a blank screen.
 */
export function loginAssetRootCandidates(native: boolean): readonly string[] {
  return native ? [LOGIN_NATIVE_ROOT, LOGIN_WEB_ROOT] : [LOGIN_WEB_ROOT, LOGIN_NATIVE_ROOT];
}

/** The single preferred root for a deployment. */
export function resolveLoginAssetRoot(native: boolean): string {
  return loginAssetRootCandidates(native)[0];
}

/** Absolute-ish URL of the login backdrop for a given root. */
export function loginBackgroundUrl(root: string): string {
  return `${root}/${LOGIN_BACKGROUND_FILE}`;
}

/** Absolute-ish URL of the Reimu portrait for a given root. */
export function loginPortraitUrl(root: string): string {
  return `${root}/${LOGIN_PORTRAIT_FILE}`;
}

/** Absolute-ish URL of the spell-sigil disc for a given root. */
export function loginSigilUrl(root: string): string {
  return `${root}/${LOGIN_SIGIL_FILE}`;
}

/**
 * `object-fit: cover` in pure numbers.
 *
 * Returns the scale factor and the offset that map a `sourceW x sourceH` image
 * onto a `targetW x targetH` box while preserving aspect ratio and filling the
 * box completely (overflow is clipped by the caller). Used to stretch the 2:3
 * backdrop over whatever stage aspect the runtime picked, including the wide
 * LayaNative logical stage (`750 * windowAspect` by 750).
 */
export function coverFit(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): { scale: number; x: number; y: number } {
  if (sourceW <= 0 || sourceH <= 0 || targetW <= 0 || targetH <= 0) {
    return { scale: 0, x: 0, y: 0 };
  }
  const scale = Math.max(targetW / sourceW, targetH / sourceH);
  return {
    scale,
    x: Math.round((targetW - sourceW * scale) / 2),
    y: Math.round((targetH - sourceH * scale) / 2),
  };
}

/**
 * `object-fit: contain` in pure numbers — the inverse of {@link coverFit}.
 * Used for the portrait so the whole character stays visible at any stage size.
 */
export function containFit(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): { scale: number; x: number; y: number } {
  if (sourceW <= 0 || sourceH <= 0 || targetW <= 0 || targetH <= 0) {
    return { scale: 0, x: 0, y: 0 };
  }
  const scale = Math.min(targetW / sourceW, targetH / sourceH);
  return {
    scale,
    x: Math.round((targetW - sourceW * scale) / 2),
    y: Math.round((targetH - sourceH * scale) / 2),
  };
}
