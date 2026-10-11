/**
 * Upscaler platform adapter — the spatial "software" backend plus the DLC loader.
 *
 * ## Why "DLSS 5" and "FSR" cannot exist in this client
 *
 * The user asked for DLSS 5 and FSR. Neither is possible here, and it would be
 * dishonest to ship a toggle that pretends otherwise:
 *
 *  - LayaAir 3 is a **2D canvas / WebGL** renderer. It presents an already
 *    composited flat scene — no depth buffer, no per-pixel motion vectors, no
 *    jittered projection and no exposed low-resolution render target. Every
 *    temporal technique (DLSS, FSR 2/3) needs at least motion vectors + depth,
 *    and DLSS additionally needs an RTX GPU, the native DLSS SDK and a
 *    D3D12/Vulkan command stream. None of those channels exist in this build.
 *  - `core/render/upscaler` documents that and ships `fsr` / `dlss`
 *    descriptors that are permanently `available: false`, with an honest
 *    `note` the settings panel prints verbatim.
 *
 * ## What this module provides instead
 *
 * 1. A **working `software` backend** — the spatial half only. It lowers the
 *    render resolution (done by `display.ts` through `renderScale`) and applies
 *    an SVG `feConvolveMatrix` sharpen filter to the canvas element. That is the
 *    same *shape* as FSR 1 (render fewer pixels, upscale, sharpen), and it must
 *    never be described as DLSS or FSR — the descriptor's `note` says so.
 * 2. A **DLC loader** — `loadModule(url)` dynamically `import()`s an external ES
 *    module and lets it register a real backend descriptor into the shared
 *    `UpscalerRegistry`. This is the slot a future DLSS/FSR backend would plug
 *    into. Nothing is downloaded unless the player supplies a URL.
 *
 * A CSS filter over a WebGL canvas is not free, so **every path in this module
 * is a no-op unless the player explicitly selects the `software` backend with a
 * non-zero sharpness**. The stock configuration touches nothing.
 *
 * NOTE: `platform/laya/` only. Never imported from `core/`.
 */

import { isLoadableModuleUrl, type DisplaySettings } from '../../core/settings';
import {
  UpscalerRegistry,
  clampSharpness,
  type UpscalerBackendId,
  type UpscalerDescriptor,
} from '../../core/render/upscaler';
import { SHARPEN_FILTER_ID, sharpenFilterMarkup } from '../../core/render/upscale_math';

// --- debug surface ----------------------------------------------------------

/** Everything the debug overlay needs to explain what the upscaler is doing. */
export interface UpscalerDebugState {
  /** The backend the Display group last asked for. */
  readonly backend: UpscalerBackendId;
  /** Whether that backend's descriptor is currently `available`. */
  readonly available: boolean;
  /** True while the sharpen CSS filter is on the canvas. */
  readonly sharpenApplied: boolean;
  /** The clamped sharpness currently applied (0 when nothing is applied). */
  readonly sharpenStrength: number;
  /** True when the hidden `<svg>` filter definition is in the DOM. */
  readonly filterElementPresent: boolean;
  /** Module URLs that imported and registered successfully, in load order. */
  readonly loadedModuleUrls: readonly string[];
  /** Backend ids those modules registered. */
  readonly loadedBackendIds: readonly string[];
  /** The most recent error message, or `''`. */
  readonly lastError: string;
}

// --- narrow helpers (no `any`) ----------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBool(value: unknown): boolean {
  return value === true;
}

/** Turns any thrown value into a short message safe to show the player. */
function describeError(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') {
    return cause.message;
  }
  if (typeof cause === 'string' && cause !== '') {
    return cause;
  }
  return 'Unknown error';
}

// --- DOM access, all guarded ------------------------------------------------

/**
 * The host document, or `null` when there is none.
 *
 * `Laya.Browser.document` is `unknown` in the type shim (and is a `conch`
 * object rather than a real DOM on LayaNative), so this narrows structurally
 * and treats any surprise as "no DOM" instead of throwing.
 */
function resolveDocument(): Document | null {
  try {
    const raw: unknown = Laya.Browser.document;
    if (raw === null || raw === undefined || typeof raw !== 'object') {
      return null;
    }
    const candidate = raw as Partial<Document>;
    if (typeof candidate.createElement !== 'function' || typeof candidate.querySelector !== 'function') {
      return null;
    }
    return raw as Document;
  } catch {
    return null;
  }
}

/**
 * The canvas the engine renders into.
 *
 * `Browser.mainCanvas` is the real `<canvas>` on web; when this engine version
 * (or a native runtime) does not expose it, fall back to the first `<canvas>`
 * in the document.
 */
function resolveCanvas(doc: Document): HTMLCanvasElement | null {
  try {
    const browser = Laya.Browser as unknown as { mainCanvas?: unknown };
    const main = browser.mainCanvas;
    if (main !== null && main !== undefined && typeof main === 'object') {
      const candidate = main as { style?: unknown };
      if (candidate.style !== null && candidate.style !== undefined) {
        return main as HTMLCanvasElement;
      }
    }
  } catch {
    // Fall through to the query below.
  }
  return doc.querySelector<HTMLCanvasElement>('canvas');
}

// --- descriptor coercion ----------------------------------------------------

/**
 * Validates a module-supplied value as a descriptor, or returns `null`.
 *
 * `external` is forced to `true`: anything reaching this point arrived over the
 * DLC loader, so it is external by definition and must not be able to
 * masquerade as a built-in. The `temporal` / `neural` claims are preserved
 * exactly as supplied — this module never lies in either direction — and the
 * module's own `note` is kept untouched.
 */
function coerceDescriptor(value: unknown): UpscalerDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = value.id;
  const label = value.label;
  const capabilities = value.capabilities;
  if (typeof id !== 'string' || id.trim() === '') {
    return null;
  }
  if (typeof label !== 'string') {
    return null;
  }
  if (!isRecord(capabilities)) {
    return null;
  }
  return {
    id: id as UpscalerBackendId,
    label,
    shortLabel: typeof value.shortLabel === 'string' ? value.shortLabel : label,
    capabilities: {
      temporal: readBool(capabilities.temporal),
      gpu: readBool(capabilities.gpu),
      motionVectors: readBool(capabilities.motionVectors),
      depthBuffer: readBool(capabilities.depthBuffer),
      neural: readBool(capabilities.neural),
      external: true,
    },
    note: typeof value.note === 'string' ? value.note : '',
    available: readBool(value.available),
    unavailableReason: typeof value.unavailableReason === 'string' ? value.unavailableReason : '',
  };
}

// --- controller -------------------------------------------------------------

export class UpscalerController {
  /** The shared backend registry. Pass one in to keep a single app-wide instance. */
  readonly registry: UpscalerRegistry;

  /** The hidden `<svg>` that carries the filter definition, once created. */
  private svgElement: SVGSVGElement | null = null;
  /** The strength the current `<svg>` markup was built for, or `null`. */
  private svgStrength: number | null = null;

  private sharpenApplied = false;
  private appliedSharpness = 0;
  private appliedBackend: UpscalerBackendId = 'off';
  private appliedAvailable = false;

  private readonly loadedModuleUrls: string[] = [];
  private readonly loadedBackendIds: string[] = [];
  private lastError = '';

  constructor(registry: UpscalerRegistry = new UpscalerRegistry()) {
    this.registry = registry;
  }

  /** Applies the Display group's upscaler choice. Safe to call any time. */
  apply(display: DisplaySettings): void {
    const backend = display.upscaler;
    const descriptor = this.registry.get(backend);
    this.appliedBackend = backend;
    this.appliedAvailable = descriptor.available;

    const strength = clampSharpness(display.upscalerSharpness);
    const wantSharpen = backend === 'software' && descriptor.available && strength > 0;
    try {
      if (wantSharpen) {
        this.ensureSharpen(display.upscalerSharpness);
      } else {
        this.clearSharpen();
      }
    } catch (cause) {
      // A DOM that refuses the filter is not a reason to fail a settings change.
      this.lastError = describeError(cause);
    }
  }

  /**
   * Dynamically imports an external backend module and registers whatever it
   * exports. Resolves with the registered descriptor, or rejects with an Error
   * whose message is safe to show the player.
   */
  async loadModule(url: string): Promise<UpscalerDescriptor> {
    const trimmed = url.trim();
    if (!isLoadableModuleUrl(trimmed)) {
      const error = new Error(
        `"${url}" is not a loadable module URL. Use an http(s):// URL or a root-relative /path.`,
      );
      this.lastError = error.message;
      throw error;
    }

    let mod: unknown;
    try {
      // Kept as a variable specifier on purpose: `tsc` with `module: ES2020`
      // emits this as a real runtime `import()`, which is the DLC mechanism.
      mod = await import(/* @vite-ignore */ trimmed);
    } catch (cause) {
      const message = `Failed to load upscaler module from ${trimmed}: ${describeError(cause)}`;
      this.lastError = message;
      throw new Error(message);
    }

    let descriptor: UpscalerDescriptor;
    try {
      descriptor = this.registerFromModule(mod);
    } catch (cause) {
      const message = describeError(cause);
      this.lastError = message;
      throw cause instanceof Error ? cause : new Error(message);
    }

    this.loadedModuleUrls.push(trimmed);
    this.loadedBackendIds.push(descriptor.id);
    this.lastError = '';
    return descriptor;
  }

  /** Loads every URL, collecting per-URL failures instead of aborting. */
  async loadModules(
    urls: readonly string[],
  ): Promise<{ loaded: UpscalerDescriptor[]; failed: { url: string; error: string }[] }> {
    const loaded: UpscalerDescriptor[] = [];
    const failed: { url: string; error: string }[] = [];
    for (const url of urls) {
      try {
        loaded.push(await this.loadModule(url));
      } catch (cause) {
        failed.push({ url, error: describeError(cause) });
      }
    }
    return { loaded, failed };
  }

  /** Removes the sharpen filter and drops every runtime-registered backend. */
  reset(): void {
    try {
      this.clearSharpen();
    } catch {
      // Best effort — a missing DOM cannot be un-filtered.
    }
    for (const id of this.loadedBackendIds) {
      this.registry.unregister(id as UpscalerBackendId);
    }
    this.loadedModuleUrls.length = 0;
    this.loadedBackendIds.length = 0;
    this.lastError = '';
  }

  debugState(): UpscalerDebugState {
    return {
      backend: this.appliedBackend,
      available: this.appliedAvailable,
      sharpenApplied: this.sharpenApplied,
      sharpenStrength: this.appliedSharpness,
      filterElementPresent: this.isFilterElementPresent(),
      loadedModuleUrls: [...this.loadedModuleUrls],
      loadedBackendIds: [...this.loadedBackendIds],
      lastError: this.lastError,
    };
  }

  // --- software backend -----------------------------------------------------

  /** Installs (or refreshes) the filter definition and applies it to the canvas. */
  private ensureSharpen(rawStrength: number): void {
    const strength = clampSharpness(rawStrength);
    const doc = resolveDocument();
    if (doc === null) {
      return;
    }
    const canvas = resolveCanvas(doc);
    if (canvas === null) {
      return;
    }

    let svg = this.findFilterSvg(doc);
    if (svg === null) {
      svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-pk-upscaler', '1');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      svg.style.width = '0';
      svg.style.height = '0';
      svg.style.overflow = 'hidden';
      svg.style.pointerEvents = 'none';
      doc.body.appendChild(svg);
      this.svgElement = svg;
    }

    // Only rewrite the markup when the strength actually changed: re-parsing an
    // SVG filter forces the browser to rebuild it, so leave it alone otherwise.
    if (this.svgStrength !== strength) {
      svg.innerHTML = sharpenFilterMarkup(strength);
      this.svgStrength = strength;
    }

    canvas.style.filter = `url(#${SHARPEN_FILTER_ID})`;
    // Explicitly allow the smooth upscale; a "pixelated" hint would defeat the
    // whole point of rendering fewer pixels.
    canvas.style.imageRendering = 'auto';
    this.sharpenApplied = true;
    this.appliedSharpness = strength;
  }

  /** Clears the canvas filter and removes the filter definition. */
  private clearSharpen(): void {
    const doc = resolveDocument();
    if (doc !== null) {
      const canvas = resolveCanvas(doc);
      if (canvas !== null) {
        canvas.style.filter = '';
      }
    }
    this.removeFilterSvg(doc);
    this.sharpenApplied = false;
    this.appliedSharpness = 0;
    this.svgStrength = null;
  }

  /** Finds the reused filter `<svg>`, re-querying if the cached one detached. */
  private findFilterSvg(doc: Document): SVGSVGElement | null {
    const cached = this.svgElement;
    if (cached !== null && cached.isConnected) {
      return cached;
    }
    const found = doc.querySelector<SVGSVGElement>('svg[data-pk-upscaler="1"]');
    this.svgElement = found;
    return found;
  }

  /** Removes the filter `<svg>` from the DOM, wherever it currently lives. */
  private removeFilterSvg(doc: Document | null): void {
    const cached = this.svgElement;
    this.svgElement = null;
    if (cached !== null) {
      cached.remove();
      return;
    }
    if (doc !== null) {
      doc.querySelector('svg[data-pk-upscaler="1"]')?.remove();
    }
  }

  private isFilterElementPresent(): boolean {
    try {
      const doc = resolveDocument();
      if (doc === null) {
        return false;
      }
      return doc.querySelector('svg[data-pk-upscaler="1"]') !== null;
    } catch {
      return false;
    }
  }

  // --- module registration --------------------------------------------------

  /** Registers whatever descriptor the module exports, forcing `external`. */
  private registerFromModule(mod: unknown): UpscalerDescriptor {
    const record = isRecord(mod) ? mod : {};

    const create = record.createUpscaler;
    if (typeof create === 'function') {
      return this.validateAndRegister((create as () => unknown)());
    }
    if (record.upscaler !== undefined) {
      return this.validateAndRegister(record.upscaler);
    }
    if (record.descriptor !== undefined) {
      return this.validateAndRegister(record.descriptor);
    }
    const register = record.register;
    if (typeof register === 'function') {
      return this.registerViaCallback(register as (registry: UpscalerRegistry) => unknown);
    }
    throw new Error(
      'Upscaler module exports none of the accepted shapes: createUpscaler(), upscaler, descriptor, or register(registry).',
    );
  }

  /**
   * Calls a module's `register(registry)` and reports what it registered.
   *
   * A module may either return a descriptor or write one into the registry
   * itself; in the latter case the registry is diffed to find the change, and
   * the result is re-registered so `external` is forced and the shape is
   * normalised exactly as for the other shapes.
   */
  private registerViaCallback(register: (registry: UpscalerRegistry) => unknown): UpscalerDescriptor {
    const before = new Map<UpscalerBackendId, UpscalerDescriptor>();
    for (const descriptor of this.registry.list()) {
      before.set(descriptor.id, descriptor);
    }

    const result = register(this.registry);
    if (result !== undefined && result !== null) {
      return this.validateAndRegister(result);
    }

    for (const descriptor of this.registry.list()) {
      if (before.get(descriptor.id) !== descriptor) {
        return this.validateAndRegister(descriptor);
      }
    }
    throw new Error('Upscaler module register(registry) did not add or return a descriptor.');
  }

  private validateAndRegister(value: unknown): UpscalerDescriptor {
    const descriptor = coerceDescriptor(value);
    if (descriptor === null) {
      throw new Error(
        'Upscaler module did not provide a usable descriptor: it needs a non-empty string id, a string label, and a capabilities object. Accepted shapes: createUpscaler(), upscaler, descriptor, register(registry).',
      );
    }
    return this.registry.register(descriptor);
  }
}

// NOTE: `platform/laya/` only. Never imported from `core/`.
