/**
 * Official LayaAir UI widgets, loaded from the engine's own prefab library.
 *
 * ## Why this module exists
 *
 * LayaAir 3.4.1 has **no `Laya.Button` / `Laya.CheckBox` / `Laya.Slider`** —
 * those were LayaAir 2.x (`laya.ui`). Verified live on the shipped native
 * client: `Laya.ui` is `undefined`, `Laya.Button` is `undefined`, and
 * `laya.ui2.js` only exports the **fgui** component set (`GButton`, `GSlider`,
 * `GPanel`, …), which needs a FairGUI `UIPackage` that this project does not
 * ship — instantiating those yields blank, skinless widgets.
 *
 * What the runtime *does* ship is the engine's own prefab library under
 * `internal/UI/`:
 *
 * ```
 * Button.lh  CheckBox.lh  Radio.lh  ProgressBar.lh
 * SliderH.lh SliderV.lh  ScrollBarH.lh ScrollBarV.lh
 * TextInput.lh  TextArea.lh  ComboBox.lh  TabButton.lh
 * comp.atlas / comp.png   (the skin atlas those prefabs render from)
 * ```
 *
 * `Laya.loader.load('internal/UI/CheckBox.lh')` returns a prefab whose
 * `create()` produces a **real, skinned widget** — verified live:
 * `CheckBox.lh` → 132x40 with 3 children and a working `selected` property
 * (false → true), `SliderH.lh` → 200x32 with `bg`/`bar`/`grip`/`title`,
 * `ScrollBarV.lh` → 32x400 with `bg`/`bar`/`grip`/`up`/`down`.
 *
 * Those prefabs are the official widgets on this engine version, so this is the
 * supported way to use them. Everything here is a thin loader over them.
 *
 * ## Loading model
 *
 * `create()` is synchronous but the prefabs load asynchronously, so the
 * prefabs are fetched once up front ({@link preloadOfficialWidgets}) and the
 * factories below read from the cache. Callers must still handle a cache miss
 * (`null`) because a widget can be built before the first load resolves — the
 * settings widgets fall back to their hand-painted control in that case, which
 * is what keeps the panel usable rather than blank.
 *
 * NOTE: `platform/laya/` only.
 */

/**
 * The engine's prefab library, by the widget role the settings panel needs.
 *
 * `internal/UI/` is a fixed path inside every LayaAir 3 native and web build —
 * it ships with the runtime, not with this project, so it is not configurable.
 */
const WIDGET_URLS: Readonly<Record<string, string>> = {
  button: 'internal/UI/Button.lh',
  checkbox: 'internal/UI/CheckBox.lh',
  radio: 'internal/UI/Radio.lh',
  progressBar: 'internal/UI/ProgressBar.lh',
  sliderH: 'internal/UI/SliderH.lh',
  sliderV: 'internal/UI/SliderV.lh',
  scrollBarV: 'internal/UI/ScrollBarV.lh',
  scrollBarH: 'internal/UI/ScrollBarH.lh',
  textInput: 'internal/UI/TextInput.lh',
  textArea: 'internal/UI/TextArea.lh',
  tabButton: 'internal/UI/TabButton.lh',
};

/** A prefab handle: only `create()` is used, so the type stays narrow. */
interface PrefabLike {
  create?: () => unknown;
}

type LoaderLike = {
  load: (url: string, type?: unknown) => Promise<unknown>;
};

const cache = new Map<string, PrefabLike>();
let inflight: Promise<void> | null = null;
let failed = false;

function loaderOrNull(): LoaderLike | null {
  const engine = Laya as unknown as { loader?: LoaderLike };
  return engine.loader ?? null;
}

/**
 * Loads every official widget prefab once.
 *
 * Idempotent and safe to call from a synchronous startup path — it is
 * fire-and-forget there, and concurrent callers share one load. A runtime
 * without the prefab library (a web build that did not copy `internal/UI`, or
 * a future engine that moved it) resolves without marking the widgets ready,
 * so callers keep their fallback instead of showing blank controls.
 */
export function preloadOfficialWidgets(): Promise<void> {
  if (inflight !== null) {
    return inflight;
  }
  const loader = loaderOrNull();
  if (loader === null || typeof loader.load !== 'function') {
    failed = true;
    return Promise.resolve();
  }
  inflight = (async () => {
    for (const [kind, url] of Object.entries(WIDGET_URLS)) {
      if (cache.has(kind)) {
        continue;
      }
      try {
        const prefab = await loader.load(url);
        if (prefab && typeof (prefab as PrefabLike).create === 'function') {
          cache.set(kind, prefab as PrefabLike);
        }
      } catch {
        // One missing prefab must not sink the rest: the panel falls back per
        // widget, so a partial load is still an improvement.
      }
    }
  })();
  return inflight;
}

/** True once {@link preloadOfficialWidgets} has resolved (or permanently failed). */
export function officialWidgetsSettled(): boolean {
  return failed || (inflight !== null && cache.size > 0);
}

/** True when the widget kind is loaded and can be instantiated synchronously. */
export function hasOfficialWidget(kind: string): boolean {
  return cache.has(kind);
}

/**
 * Instantiates an official widget, or `null` when its prefab is not loaded yet.
 *
 * The returned object is the prefab instance: a `Laya.Sprite` subclass with the
 * engine's own children and skin, so sizing and positioning work as they do for
 * any sprite, and widget-specific state (CheckBox `selected`, Slider `value`)
 * lives on the instance.
 */
export function createOfficialWidget(kind: string): Laya.Sprite | null {
  const prefab = cache.get(kind);
  if (prefab === undefined || typeof prefab.create !== 'function') {
    return null;
  }
  try {
    const instance = prefab.create();
    return (instance as Laya.Sprite | null) ?? null;
  } catch {
    return null;
  }
}

/** The widget kinds this module knows, for tests and for a debug readout. */
export function officialWidgetKinds(): readonly string[] {
  return Object.keys(WIDGET_URLS);
}

/** How many kinds actually loaded — `0` means the fallback path is in use. */
export function officialWidgetLoadCount(): number {
  return cache.size;
}
