/**
 * Runtime location of the lobby-screen backdrop.
 *
 * One file ships under the IDE resource tree (`assets/resources/lobby/`):
 *
 *  - `lobby_bg.png` — the main-menu backdrop (1200x1800, opaque, 2:3).
 *
 * It is generated offline by `tools/compose_lobby_art.py` from the same visual
 * language as the login backdrop (see `./login_assets`), and shares the exact
 * 2:3 aspect the login cover-fit math already assumes — so the scene can reuse
 * `coverFit` unchanged.
 *
 * Exactly like {@link ./login_assets}, the same file is reached through
 * **different URL roots** depending on deployment:
 *
 *  - **web** — `index.html` is served from `laya/`, so the path is relative:
 *    `layaide/assets/resources/lobby`.
 *  - **LayaNative / IDE publish** — the tree is exported under the packaged
 *    resource root: `resources/lobby`.
 *
 * This mirrors `login_assets.ts` rather than sharing a generic helper on
 * purpose: the two modules are independent, so a change to one deployment
 * layout can never silently move the other screen's art.
 *
 * NOTE: `core/` only — no Laya / DOM types here.
 */

/** Directory name of the lobby art inside the resource root. */
export const LOBBY_ASSET_DIR = 'lobby';

/** Web root, relative to `laya/index.html`. */
export const LOBBY_WEB_ROOT = 'layaide/assets/resources/lobby';

/** LayaNative / IDE-publish root, relative to the packaged resource root. */
export const LOBBY_NATIVE_ROOT = 'resources/lobby';

/** File name of the full-screen lobby backdrop. */
export const LOBBY_BACKGROUND_FILE = 'lobby_bg.png';

/** Intrinsic size of {@link LOBBY_BACKGROUND_FILE}, in pixels (2:3). */
export const LOBBY_BACKGROUND_SIZE = { width: 1200, height: 1800 } as const;

/**
 * Ordered candidate roots for a deployment, most-likely first. The scene walks
 * the list and keeps the first root that actually loads, so a wrong guess costs
 * one failed request instead of a blank screen.
 */
export function lobbyAssetRootCandidates(native: boolean): readonly string[] {
  return native ? [LOBBY_NATIVE_ROOT, LOBBY_WEB_ROOT] : [LOBBY_WEB_ROOT, LOBBY_NATIVE_ROOT];
}

/** The single preferred root for a deployment. */
export function resolveLobbyAssetRoot(native: boolean): string {
  return lobbyAssetRootCandidates(native)[0];
}

/** Absolute-ish URL of the lobby backdrop for a given root. */
export function lobbyBackgroundUrl(root: string): string {
  return `${root}/${LOBBY_BACKGROUND_FILE}`;
}
