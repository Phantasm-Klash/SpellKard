/**
 * Upscaler model — the honest half of the DLSS / FSR story.
 *
 * ## What this renderer can and cannot do
 *
 * The client draws through LayaAir 3, which is a **2D canvas / WebGL** renderer.
 * It presents a flat, already-composited 2D scene; there is no depth buffer, no
 * per-pixel motion vector pass, no jittered projection matrix and no exposed
 * low-resolution render target.
 *
 * That rules out the two things "DLSS" and "FSR" actually mean:
 *
 *  - **DLSS 5** is NVIDIA's *temporal neural* super-resolution. It needs an RTX
 *    GPU, the DLSS SDK's native library, a D3D12/Vulkan command stream, and —
 *    critically — engine-supplied motion vectors + depth so the network can
 *    reproject the previous frame. None of those channels exist here.
 *  - **FSR 1** (EASU + RCAS) is purely spatial, so its *shape* is reproducible:
 *    render at a lower resolution, upscale, then sharpen. **FSR 2 / 3** are
 *    temporal and need motion vectors, so they are as impossible as DLSS.
 *
 * So this module does not pretend. It defines a **slot**: a descriptor per
 * backend, each carrying `capabilities` and an honest `note` the UI prints
 * verbatim. The built-in `software` backend is a spatial upscale (render scale
 * + browser scaler) with an optional sharpen pass — the closest thing to FSR 1
 * this pipeline allows, and it is labelled as exactly that, never as DLSS/FSR.
 *
 * A real backend can be registered later by an external module (see
 * `registerUpscaler`), which is what makes the DLSS5 / FSR DLC idea possible
 * without lying in the meantime.
 *
 * NOTE: `core/` only — no DOM, no LayaAir, no Node.
 */

// --- backend ids ------------------------------------------------------------

/** Every backend id the settings schema accepts. */
export const UPSCALER_BACKENDS = ['off', 'software', 'fsr', 'dlss'] as const;
export type UpscalerBackendId = (typeof UPSCALER_BACKENDS)[number];

// --- capabilities -----------------------------------------------------------

/**
 * What a backend genuinely does. Reported by the backend itself and surfaced in
 * the UI, so a spatial approximation can never be mistaken for a temporal one.
 */
export interface UpscalerCapabilities {
  /** Reprojects previous frames using motion vectors (DLSS, FSR 2/3, TAAU). */
  readonly temporal: boolean;
  /** Runs inside a graphics API (D3D12 / Vulkan / Metal) rather than the CPU. */
  readonly gpu: boolean;
  /** Requires the host renderer to supply per-pixel motion vectors. */
  readonly motionVectors: boolean;
  /** Requires the host renderer to supply a depth buffer. */
  readonly depthBuffer: boolean;
  /** Requires a neural-network weight set / vendor runtime. */
  readonly neural: boolean;
  /** Supplied by an external module loaded at runtime rather than built in. */
  readonly external: boolean;
}

/** The all-false capability set, for "off" and for placeholders. */
export function noCapabilities(): UpscalerCapabilities {
  return {
    temporal: false,
    gpu: false,
    motionVectors: false,
    depthBuffer: false,
    neural: false,
    external: false,
  };
}

// --- descriptors ------------------------------------------------------------

/** One selectable upscaler backend, as the UI and the store see it. */
export interface UpscalerDescriptor {
  readonly id: UpscalerBackendId;
  /** Long label for the settings row. */
  readonly label: string;
  /** Short label for compact UI (the option segment). */
  readonly shortLabel: string;
  readonly capabilities: UpscalerCapabilities;
  /**
   * One honest sentence about what this backend really is. Printed verbatim in
   * the settings panel — do not soften it.
   */
  readonly note: string;
  /** False when the backend needs something this build cannot provide. */
  readonly available: boolean;
  /** Why it is unavailable, or `''` when it is available. */
  readonly unavailableReason: string;
}

// --- built-ins --------------------------------------------------------------

const OFF: UpscalerDescriptor = {
  id: 'off',
  label: 'Off',
  shortLabel: 'Off',
  capabilities: noCapabilities(),
  note: 'Render at the resolution in "Resolution scale" and let the display scaler do the rest.',
  available: true,
  unavailableReason: '',
};

/**
 * The built-in placeholder. Spatial only: it renders fewer pixels and sharpens
 * the result. That is the same *shape* as FSR 1, and deliberately nothing like
 * DLSS or FSR 2/3 — hence the wording.
 */
const SOFTWARE: UpscalerDescriptor = {
  id: 'software',
  label: 'Software spatial upscale (approximate)',
  shortLabel: 'Software',
  capabilities: {
    temporal: false,
    gpu: false,
    motionVectors: false,
    depthBuffer: false,
    neural: false,
    external: false,
  },
  note: 'Renders fewer pixels, upscales with the browser scaler and sharpens the result. A spatial approximation only — not DLSS and not FSR.',
  available: true,
  unavailableReason: '',
};

const FSR: UpscalerDescriptor = {
  id: 'fsr',
  label: 'AMD FidelityFX Super Resolution',
  shortLabel: 'FSR',
  capabilities: {
    temporal: false,
    gpu: true,
    motionVectors: false,
    depthBuffer: false,
    neural: false,
    external: true,
  },
  note: 'Requires a native FidelityFX backend module and a graphics API this 2D WebGL renderer does not expose. No backend module is installed.',
  available: false,
  unavailableReason:
    'No FidelityFX backend module is installed. This build renders through a 2D WebGL canvas and cannot host one.',
};

const DLSS: UpscalerDescriptor = {
  id: 'dlss',
  label: 'NVIDIA DLSS 5',
  shortLabel: 'DLSS',
  capabilities: {
    temporal: true,
    gpu: true,
    motionVectors: true,
    depthBuffer: true,
    neural: true,
    external: true,
  },
  note: 'Temporal neural super-resolution. Needs an RTX GPU, the DLSS SDK, a D3D12/Vulkan pipeline and engine-supplied motion vectors + depth — none of which this 2D canvas renderer has. No backend module is installed.',
  available: false,
  unavailableReason:
    'DLSS needs motion vectors, a depth buffer and a D3D12/Vulkan render target. This renderer supplies none of them, and no DLSS backend module is installed.',
};

/** The descriptors this build ships, in menu order. */
export function builtinUpscalers(): UpscalerDescriptor[] {
  return [OFF, SOFTWARE, FSR, DLSS];
}

// --- registry ---------------------------------------------------------------

/**
 * Runtime-registered backends (the DLC path). A module loaded at runtime calls
 * `UpscalerRegistry.register` with a descriptor whose `capabilities.external`
 * is true and whose `available` is true only once its own prerequisites pass.
 */
export class UpscalerRegistry {
  private readonly modules = new Map<UpscalerBackendId, UpscalerDescriptor>();

  constructor(seed: readonly UpscalerDescriptor[] = builtinUpscalers()) {
    for (const descriptor of seed) {
      this.modules.set(descriptor.id, descriptor);
    }
  }

  /** Adds or replaces a backend. Returns the descriptor that is now in force. */
  register(descriptor: UpscalerDescriptor): UpscalerDescriptor {
    this.modules.set(descriptor.id, descriptor);
    return descriptor;
  }

  /** Removes a runtime-registered backend, falling back to the built-in one. */
  unregister(id: UpscalerBackendId): void {
    const builtin = builtinUpscalers().find((entry) => entry.id === id);
    if (builtin === undefined) {
      this.modules.delete(id);
    } else {
      this.modules.set(id, builtin);
    }
  }

  get(id: UpscalerBackendId): UpscalerDescriptor {
    return this.modules.get(id) ?? OFF;
  }

  has(id: UpscalerBackendId): boolean {
    return this.modules.has(id);
  }

  /** Menu order: built-ins first, then whatever a module added. */
  list(): UpscalerDescriptor[] {
    const order = builtinUpscalers().map((entry) => entry.id);
    const builtins = order.map((id) => this.get(id));
    const extras = [...this.modules.values()].filter((entry) => !order.includes(entry.id));
    return [...builtins, ...extras];
  }
}

/**
 * True when a descriptor claims anything only a real temporal upscaler can do.
 * Used by the tests and by the panel's warning line: a backend that claims
 * temporal super-resolution must be external, otherwise it is mislabelled.
 */
export function claimsTemporal(descriptor: UpscalerDescriptor): boolean {
  return descriptor.capabilities.temporal || descriptor.capabilities.neural;
}

/**
 * The sentence the settings panel shows under the selected backend. Kept here
 * (not in the platform layer) so it can be asserted without an engine.
 */
export function upscalerSummary(descriptor: UpscalerDescriptor): string {
  if (!descriptor.available) {
    return `Unavailable — ${descriptor.unavailableReason}`;
  }
  return descriptor.note;
}

/**
 * The sharpening range the software backend exposes. `0` is a plain bilinear
 * upscale; `1` is the strongest RCAS-like contrast-adaptive pass the browser
 * filter can express.
 */
export const UPSCALER_SHARPNESS_MIN = 0;
export const UPSCALER_SHARPNESS_MAX = 1;

/** Clamps an arbitrary sharpness value into the supported range. */
export function clampSharpness(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < UPSCALER_SHARPNESS_MIN) {
    return UPSCALER_SHARPNESS_MIN;
  }
  if (value > UPSCALER_SHARPNESS_MAX) {
    return UPSCALER_SHARPNESS_MAX;
  }
  return value;
}
