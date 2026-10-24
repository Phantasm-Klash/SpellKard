/**
 * Engine configuration that must exist **before** `Laya.init` runs.
 *
 * ## Why this is needed
 *
 * LayaAir 3.4.1's `laya.ui2.js` (the FairGUI module) registers
 * `UIPackage._init` through `Laya.Laya.addAfterInitCallback`, and that
 * callback reads:
 *
 * ```js
 * if (Laya.PlayerConfig.UI.alwaysIncludeDefaultSkin) { … }
 * ```
 *
 * `Laya.PlayerConfig` is declared as an **empty object** in `laya.core.js` and
 * is filled in by the IDE-generated `index.js`
 * (`Object.assign(Laya.PlayerConfig, config)`). A published build therefore
 * has `PlayerConfig.UI`, but the **IDE preview** (`layabox`) does not — and the
 * callback then throws
 *
 * ```
 * TypeError: Cannot read properties of undefined (reading 'alwaysIncludeDefaultSkin')
 * ```
 *
 * which aborts the bootstrap and leaves a black screen. The error surfaces as a
 * generic "the network is unstable, please restart" notice, which is both wrong
 * and unhelpful.
 *
 * ## Why the fix lives in the bundle
 *
 * The callback runs after `Laya.init`, but the application bundle is loaded
 * **before** the engine is initialised, so a module-top-level statement here
 * still wins the race. Putting the same guard in `platform/laya/main.ts` covers
 * the plain web bootstrap, which initialises the engine itself.
 *
 * NOTE: `platform/laya/` and `layaide/src/` only.
 */

/** The subset of `PlayerConfig` the FairGUI module reads. */
interface PlayerConfigLike {
  UI?: { alwaysIncludeDefaultSkin?: boolean };
}

/**
 * Ensures `Laya.PlayerConfig.UI` exists before the engine initialises.
 *
 * Safe to call more than once, and a no-op when the IDE already injected a
 * full configuration (which is the case for published builds).
 */
export function ensurePlayerConfigUi(): void {
  const engine = (globalThis as { Laya?: { PlayerConfig?: PlayerConfigLike } }).Laya;
  if (engine === undefined || engine.PlayerConfig === undefined) {
    return;
  }
  const config = engine.PlayerConfig;
  if (config.UI === undefined || config.UI === null) {
    // `alwaysIncludeDefaultSkin: true` makes the engine preload the default
    // widget skins (`internal/UI/*.lh` + `comp.atlas`), which is what the
    // settings widgets rely on.
    config.UI = { alwaysIncludeDefaultSkin: true };
    return;
  }
  if (config.UI.alwaysIncludeDefaultSkin === undefined) {
    config.UI.alwaysIncludeDefaultSkin = true;
  }
}
