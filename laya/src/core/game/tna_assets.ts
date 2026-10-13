/**
 * Runtime location of the imported 千夜追忆 (TNA) art tree.
 *
 * The same `.atlas` + texture files are reached through **different URL roots**
 * depending on how the client is deployed:
 *
 *  - **web** — `index.html` is served from `laya/`, so the IDE asset tree is a
 *    plain relative path: `layaide/assets/resources/tna`.
 *  - **LayaNative / LayaAir IDE publish** — the assets are exported under the
 *    project's `assets/resources/` *resource directory* (LayaAir's
 *    `resourcesDirName` convention, the only folder the IDE bundles when nothing
 *    references it) and land under the packaged resource root, so the runtime
 *    URL is `resources/tna`.
 *
 * `DEFAULT_TNA_ATLAS_ROOT` used to hard-code the web path, which made every
 * frame lookup miss in the `.exe` and silently fall back to vector art. The
 * helpers here are engine-agnostic and side-effect free so the platform layer
 * can probe the candidates and the tests can pin both shapes.
 *
 * NOTE: `core/` only — no Laya / DOM types here.
 */

/** Directory name of the TNA asset tree inside the resource root. */
export const TNA_ASSET_DIR = 'tna';

/** Web root, relative to `laya/index.html`. */
export const TNA_WEB_ROOT = 'layaide/assets/resources/tna';

/** LayaNative / IDE-publish root, relative to the packaged resource root. */
export const TNA_NATIVE_ROOT = 'resources/tna';

/**
 * Ordered candidate roots for a deployment, most-likely first. `load()` walks
 * the list and keeps the first one that actually resolves a frame, so a wrong
 * guess costs a few failed loads instead of a blank screen.
 */
export function tnaAtlasRootCandidates(native: boolean): readonly string[] {
  return native ? [TNA_NATIVE_ROOT, TNA_WEB_ROOT] : [TNA_WEB_ROOT, TNA_NATIVE_ROOT];
}

/** The single preferred root for a deployment. */
export function resolveTnaAtlasRoot(native: boolean): string {
  return tnaAtlasRootCandidates(native)[0];
}

/**
 * Joins a **TNA-root-relative** path onto a deployment's TNA root.
 *
 * `relativePath` is always relative to the TNA root itself (e.g.
 * `audio/bgm_stage_01_11.mp3`, `bg_01_01.png`, `player/player_01.png`) — the
 * `stage_art.ts` name helpers deliberately return root-relative names — so this
 * is the single place that knows the deployment root and adds it exactly once.
 * A leading `/` is tolerated and stripped, so `'/audio/x.mp3'` and
 * `'audio/x.mp3'` join identically (and the `tna` segment is never doubled).
 */
export function tnaAssetUrl(relativePath: string, native: boolean): string {
  return `${resolveTnaAtlasRoot(native)}/${relativePath.replace(/^\/+/, '')}`;
}

/**
 * Detects the LayaNative runtime by the presence of the `conch` global, which
 * the engine itself uses (`LayaEnv.isConch = window.conch != null`). Kept as a
 * pure scope probe so it is testable without a live runtime.
 */
export function isNativeAssetRuntime(scope: unknown = globalThis): boolean {
  if (typeof scope !== 'object' || scope === null) {
    return false;
  }
  const record = scope as Record<string, unknown>;
  if (record.conch !== undefined && record.conch !== null) {
    return true;
  }
  const windowValue = record.window;
  if (typeof windowValue === 'object' && windowValue !== null) {
    const conch = (windowValue as Record<string, unknown>).conch;
    return conch !== undefined && conch !== null;
  }
  return false;
}
