/**
 * Settings normalisation and derived values.
 *
 * Two jobs, both pure functions so they can be unit-tested without an engine:
 *
 *  1. `normalizeSettings` — turn *anything* (a corrupt localStorage payload, an
 *     older schema, a hand-edited file) into a valid `GameSettings`. Every
 *     field is coerced and clamped, unknown keys are dropped, and a missing
 *     field falls back to its default. Boot must never fail because a stored
 *     blob went bad.
 *  2. `resolveNetworkEndpoints` / `resolveVolumes` — the derived values the
 *     platform layer actually applies, so "which host do we talk to" and "how
 *     loud is this channel" are computed once, in one place, and tested.
 *
 * NOTE: `core/` only.
 */

import { isLanguageCode } from '../game/i18n';
import {
  EFFECT_LEVELS,
  FRAME_CAPS,
  NETWORK_MODES,
  WINDOW_SCALES,
  defaultSettings,
  type AudioSettings,
  type DisplaySettings,
  type EffectLevel,
  type FrameCap,
  type GameSettings,
  type HudSettings,
  type ModSettings,
  type NetworkMode,
  type NetworkSettings,
  type PluginSettings,
  type WindowScale,
} from './schema';
import {
  UPSCALER_BACKENDS,
  UPSCALER_SHARPNESS_MAX,
  UPSCALER_SHARPNESS_MIN,
  type UpscalerBackendId,
} from '../render/upscaler';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Reads a number, clamped to `[min, max]`; non-finite input falls back. */
function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/** Picks the first member of `allowed` that matches, else `fallback`. */
function readEnum<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function readStringArray(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  // Drop non-strings and blanks, and de-duplicate while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed === '' || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function normalizeDisplay(raw: unknown, fallback: DisplaySettings): DisplaySettings {
  const source = isRecord(raw) ? raw : {};
  return {
    windowScale: readEnum<WindowScale>(source.windowScale, WINDOW_SCALES, fallback.windowScale),
    effectLevel: readEnum<EffectLevel>(source.effectLevel, EFFECT_LEVELS, fallback.effectLevel),
    frameCap: readEnum<FrameCap>(source.frameCap, FRAME_CAPS, fallback.frameCap),
    showFps: readBoolean(source.showFps, fallback.showFps),
    upscaler: readEnum<UpscalerBackendId>(source.upscaler, UPSCALER_BACKENDS, fallback.upscaler),
    upscalerSharpness: readNumber(
      source.upscalerSharpness,
      fallback.upscalerSharpness,
      UPSCALER_SHARPNESS_MIN,
      UPSCALER_SHARPNESS_MAX,
    ),
  };
}

export function normalizeAudio(raw: unknown, fallback: AudioSettings): AudioSettings {
  const source = isRecord(raw) ? raw : {};
  return {
    muted: readBoolean(source.muted, fallback.muted),
    masterVolume: readNumber(source.masterVolume, fallback.masterVolume, 0, 1),
    bgmVolume: readNumber(source.bgmVolume, fallback.bgmVolume, 0, 1),
    grazeVolume: readNumber(source.grazeVolume, fallback.grazeVolume, 0, 1),
    playerShotVolume: readNumber(source.playerShotVolume, fallback.playerShotVolume, 0, 1),
    skillVolume: readNumber(source.skillVolume, fallback.skillVolume, 0, 1),
  };
}

export function normalizeHud(raw: unknown, fallback: HudSettings): HudSettings {
  const source = isRecord(raw) ? raw : {};
  return {
    showOpponentHud: readBoolean(source.showOpponentHud, fallback.showOpponentHud),
    showDamageNumbers: readBoolean(source.showDamageNumbers, fallback.showDamageNumbers),
    showScoreCard: readBoolean(source.showScoreCard, fallback.showScoreCard),
    showUltMeter: readBoolean(source.showUltMeter, fallback.showUltMeter),
    showStatusCard: readBoolean(source.showStatusCard, fallback.showStatusCard),
    showBulletCount: readBoolean(source.showBulletCount, fallback.showBulletCount),
    showCountdown: readBoolean(source.showCountdown, fallback.showCountdown),
    showDebugFooter: readBoolean(source.showDebugFooter, fallback.showDebugFooter),
  };
}

export function normalizeNetwork(raw: unknown, fallback: NetworkSettings): NetworkSettings {
  const source = isRecord(raw) ? raw : {};
  return {
    mode: readEnum<NetworkMode>(source.mode, NETWORK_MODES, fallback.mode),
    lanHost: readString(source.lanHost, fallback.lanHost),
    customHttpBase: readString(source.customHttpBase, fallback.customHttpBase),
    customWsUrl: readString(source.customWsUrl, fallback.customWsUrl),
    customRelayUrl: readString(source.customRelayUrl, fallback.customRelayUrl),
  };
}

export function normalizeMods(raw: unknown, fallback: ModSettings): ModSettings {
  const source = isRecord(raw) ? raw : {};
  return {
    workshopEnabled: readBoolean(source.workshopEnabled, fallback.workshopEnabled),
    customModsEnabled: readBoolean(source.customModsEnabled, fallback.customModsEnabled),
    customModPath: readString(source.customModPath, fallback.customModPath),
    enabledModIds: readStringArray(source.enabledModIds, fallback.enabledModIds),
  };
}

export function normalizePlugins(raw: unknown, fallback: PluginSettings): PluginSettings {
  const source = isRecord(raw) ? raw : {};
  return {
    // Only http(s) URLs survive: a stored payload must never be able to make the
    // client import `file:` / `data:` code on boot.
    moduleUrls: readStringArray(source.moduleUrls, fallback.moduleUrls).filter(isLoadableModuleUrl),
    autoLoad: readBoolean(source.autoLoad, fallback.autoLoad),
  };
}

/** True for URLs the DLC loader is willing to `import()`. */
export function isLoadableModuleUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '') {
    return false;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }
  // Root-relative paths are fine (same-origin DLC dropped into the web root);
  // anything with a scheme we do not recognise is not.
  return trimmed.startsWith('/') && !trimmed.startsWith('//');
}

/**
 * Coerces an arbitrary payload into a complete, valid `GameSettings`.
 *
 * `fallback` defaults to the shipped defaults; pass the current state to use a
 * patch-shaped payload as an overlay instead of a full replacement.
 */
/**
 * A language this build actually ships; anything else (typo, retired code)
 * falls back rather than blanking the UI.
 */
export function normalizeLanguage(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && isLanguageCode(raw) ? raw : fallback;
}

export function normalizeSettings(raw: unknown, fallback: GameSettings = defaultSettings()): GameSettings {
  const source = isRecord(raw) ? raw : {};
  return {
    language: normalizeLanguage(source.language, fallback.language),
    display: normalizeDisplay(source.display, fallback.display),
    audio: normalizeAudio(source.audio, fallback.audio),
    hud: normalizeHud(source.hud, fallback.hud),
    network: normalizeNetwork(source.network, fallback.network),
    mods: normalizeMods(source.mods, fallback.mods),
    plugins: normalizePlugins(source.plugins, fallback.plugins),
  };
}

// --- derived: network endpoints --------------------------------------------

/** The three endpoints the client needs, in one bag. */
export interface NetworkEndpoints {
  /** Gensoulkyo REST base, e.g. `http://192.168.1.10:7350`. Empty = same origin. */
  httpBase: string;
  /** Lobby WebSocket URL. Empty = fall back to the REST transport. */
  wsUrl: string;
  /** Battle KCP relay. Empty = offline battle. */
  relayUrl: string;
}

/** Paths a Gensoulkyo deployment is assumed to serve on a LAN host. */
export const LAN_WS_PATH = '/ws';
export const LAN_RELAY_PATH = '/relay';

/** Strips a scheme and any trailing slashes so `host` can be re-schemed. */
function bareHost(host: string): string {
  return host
    .trim()
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    .replace(/\/+$/, '');
}

/**
 * Endpoints for a bare LAN host (`192.168.1.10`, `192.168.1.10:7350`, or a full
 * URL). Gensoulkyo serves the lobby WS on `/ws` and the battle relay on
 * `/relay`; a deployment that differs should use the `custom` mode instead,
 * where each URL is entered explicitly.
 */
export function lanEndpoints(host: string): NetworkEndpoints {
  const clean = bareHost(host);
  if (clean === '') {
    return { httpBase: '', wsUrl: '', relayUrl: '' };
  }
  return {
    httpBase: `http://${clean}`,
    wsUrl: `ws://${clean}${LAN_WS_PATH}`,
    relayUrl: `ws://${clean}${LAN_RELAY_PATH}`,
  };
}

/**
 * The endpoints to actually connect to, given the player's choice and the
 * build's own (official) endpoints.
 */
export function resolveNetworkEndpoints(
  network: NetworkSettings,
  official: NetworkEndpoints,
): NetworkEndpoints {
  switch (network.mode) {
    case 'lan':
      return lanEndpoints(network.lanHost);
    case 'custom':
      return {
        httpBase: network.customHttpBase.trim(),
        wsUrl: network.customWsUrl.trim(),
        relayUrl: network.customRelayUrl.trim(),
      };
    case 'official':
    default:
      return { ...official };
  }
}

// --- derived: volumes -------------------------------------------------------

/** Resolved 0..1 gains per channel, after master volume and mute. */
export interface ResolvedVolumes {
  bgm: number;
  graze: number;
  playerShot: number;
  skill: number;
  /** Master gain for the whole SFX bus (categories multiply into it). */
  sfxMaster: number;
}

/**
 * Folds `masterVolume` and `muted` into every channel so the audio layer never
 * has to reason about them. Muting zeroes the output but leaves the stored
 * sliders untouched, so un-muting restores the previous mix exactly.
 */
export function resolveVolumes(audio: AudioSettings): ResolvedVolumes {
  if (audio.muted) {
    return { bgm: 0, graze: 0, playerShot: 0, skill: 0, sfxMaster: 0 };
  }
  const master = clamp01(audio.masterVolume);
  return {
    bgm: master * clamp01(audio.bgmVolume),
    graze: master * clamp01(audio.grazeVolume),
    playerShot: master * clamp01(audio.playerShotVolume),
    skill: master * clamp01(audio.skillVolume),
    sfxMaster: master,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
