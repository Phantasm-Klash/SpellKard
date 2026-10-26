/**
 * Settings schema — the single source of truth for every tunable the player can
 * change, plus the option lists the UI renders.
 *
 * Engine-agnostic (`core/`): no DOM, no LayaAir, no Node. The platform layer
 * reads these shapes and applies them; the settings panel writes them. Keeping
 * the schema here is what lets both sides be unit-tested without an engine, and
 * what stops the panel and the consumers from drifting apart.
 *
 * NOTE: `core/` only.
 */

import type { UpscalerBackendId } from '../render/upscaler';
import { DEFAULT_LANGUAGE } from '../game/i18n';

// --- enumerations -----------------------------------------------------------

/** Graphics quality tiers, cheapest first. Drives bullet trails / glow / fx. */
export const EFFECT_LEVELS = ['low', 'medium', 'high'] as const;
export type EffectLevel = (typeof EFFECT_LEVELS)[number];

/**
 * Frame-rate caps the renderer may run at, in frames per second. `0` means
 * "uncapped" (follow the display). The simulation tick rate is independent of
 * this — capping frames must never change gameplay.
 */
export const FRAME_CAPS = [30, 60, 120, 0] as const;
export type FrameCap = (typeof FRAME_CAPS)[number];

/**
 * How large the **host window** should be, as a multiple of the design stage
 * (900x1200).
 *
 * This is the window, and the only resolution knob there is: the canvas
 * renders at the window's own pixel size, so this decides both how big the
 * window is on the desktop and how many pixels it has.
 *
 * `auto` picks the largest whole multiple that still fits the monitor, which is
 * what a portrait game needs on a landscape display — see
 * `platform/native/native_window.ts` for the fit. Fractional multiples are not
 * offered: a window that is 1.37x the design size would scale the pixel art by
 * a non-integer factor and make it uneven.
 */
export const WINDOW_SCALES = [1, 1.5, 2, 'auto'] as const;
export type WindowScale = (typeof WINDOW_SCALES)[number];

/**
 * Where the client looks for the lobby / battle services.
 *  - `official` — the endpoints baked into the build.
 *  - `lan`      — a Gensoulkyo host on the local network (`lanHost`).
 *  - `custom`   — a third-party deployment, entered field by field.
 */
export const NETWORK_MODES = ['official', 'lan', 'custom'] as const;
export type NetworkMode = (typeof NETWORK_MODES)[number];
// --- groups -----------------------------------------------------------------

export interface DisplaySettings {
  /**
   * Host-window size as a multiple of the design stage; `'auto'` fills the
   * monitor.
   *
   * There is deliberately **no** render-resolution multiplier any more: the
   * canvas always renders at the window's own pixel size, so the picture the
   * player sees is the picture the window is. The window size is the only knob,
   * and it moves both axes together.
   */
  windowScale: WindowScale;
  effectLevel: EffectLevel;
  frameCap: FrameCap;
  /** Draw a frame-rate / frame-time counter in the corner. */
  showFps: boolean;
  /**
   * Which upscaler the renderer should use. See `core/render/upscaler` for what
   * each id really means — `fsr` and `dlss` are placeholders that stay
   * unavailable until an external backend module is registered.
   */
  upscaler: UpscalerBackendId;
  /** Sharpening amount for the `software` backend, 0..1. */
  upscalerSharpness: number;
}

/**
 * Per-category volumes. The user asked for independent BGM / graze / player
 * shot / skill channels, so each is its own 0..1 slider; `masterVolume` scales
 * all of them and `muted` silences everything without losing the sliders.
 */
export interface AudioSettings {
  muted: boolean;
  masterVolume: number;
  bgmVolume: number;
  /** 擦弹 — the near-miss cue played when a bullet passes close to the hitbox. */
  grazeVolume: number;
  /** 自机音效 — the local ship's own shot / movement cues. */
  playerShotVolume: number;
  /** 技能音效 — bombs / spell cards. */
  skillVolume: number;
}

/**
 * What the battle HUD is allowed to draw. Every flag maps to a block the HUD
 * can omit entirely; the layout re-flows around whatever is left.
 */
export interface HudSettings {
  /** Show the rival's Boss HP panel. */
  showOpponentHud: boolean;
  /** Show floating damage numbers over the Boss. */
  showDamageNumbers: boolean;
  showScoreCard: boolean;
  showUltMeter: boolean;
  showStatusCard: boolean;
  /** Show the `BULLETS n` row of the status card. */
  showBulletCount: boolean;
  /** Show the remaining-time countdown. */
  showCountdown: boolean;
  /** Show the network / reconciliation footer. */
  showDebugFooter: boolean;
}

export interface NetworkSettings {
  mode: NetworkMode;
  /** `host` or `host:port` of a Gensoulkyo on the LAN. */
  lanHost: string;
  customHttpBase: string;
  customWsUrl: string;
  customRelayUrl: string;
}

export interface ModSettings {
  /** Creative-workshop browsing. Reserved: no loader ships yet. */
  workshopEnabled: boolean;
  /** Load mods from a local folder / URL. Reserved: no loader ships yet. */
  customModsEnabled: boolean;
  customModPath: string;
  /** Ids the (future) loader should activate, in load order. */
  enabledModIds: string[];
}

/**
 * External backend modules ("DLC") the client should pull in at runtime.
 *
 * Each URL must resolve to an ES module exporting `createUpscaler()` /
 * `createModule()`; see `platform/laya/upscaler.ts`. Nothing is downloaded
 * unless the player fills this in — the stock build ships zero external code.
 */
export interface PluginSettings {
  /** Module URLs, in load order. Empty by default. */
  moduleUrls: string[];
  /** Load them as soon as the client starts, without asking per module. */
  autoLoad: boolean;
}

export interface GameSettings {
  /**
   * Active UI language (an i18n code from `core/game/i18n`). Persisted like the
   * rest of the settings; the app applies it at boot and on change.
   */
  language: string;
  display: DisplaySettings;
  audio: AudioSettings;
  hud: HudSettings;
  network: NetworkSettings;
  mods: ModSettings;
  plugins: PluginSettings;
}

/** A deep-partial update; `SettingsStore.update` merges it into the current state. */
export interface SettingsPatch {
  language?: string;
  display?: Partial<DisplaySettings>;
  audio?: Partial<AudioSettings>;
  hud?: Partial<HudSettings>;
  network?: Partial<NetworkSettings>;
  mods?: Partial<ModSettings>;
  plugins?: Partial<PluginSettings>;
}

// --- defaults ---------------------------------------------------------------

/**
 * Factory (not a shared object) so every caller gets its own copy and a stray
 * mutation in one place cannot leak into another.
 */
export function defaultSettings(): GameSettings {
  return {
    language: DEFAULT_LANGUAGE,
    display: {
      windowScale: 'auto',
      effectLevel: 'high',
      frameCap: 60,
      showFps: false,
      upscaler: 'off',
      upscalerSharpness: 0.4,
    },
    audio: {
      muted: false,
      masterVolume: 0.8,
      bgmVolume: 0.7,
      grazeVolume: 0.6,
      playerShotVolume: 0.7,
      skillVolume: 0.8,
    },
    hud: {
      showOpponentHud: true,
      showDamageNumbers: true,
      showScoreCard: true,
      showUltMeter: true,
      showStatusCard: true,
      showBulletCount: true,
      showCountdown: true,
      showDebugFooter: true,
    },
    network: {
      mode: 'official',
      lanHost: '',
      customHttpBase: '',
      customWsUrl: '',
      customRelayUrl: '',
    },
    mods: {
      workshopEnabled: false,
      customModsEnabled: false,
      customModPath: '',
      enabledModIds: [],
    },
    plugins: {
      moduleUrls: [],
      autoLoad: false,
    },
  };
}
