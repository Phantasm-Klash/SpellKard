/**
 * Page-URL query helpers for the Laya bootstrap and scenes.
 *
 * The demo harness configures the client through page query parameters — the
 * same channel `relayUrl` already uses (see `resolveRuntimeConfig`). Scenes
 * must not reach for `window` themselves, so numeric parameters are read
 * through here. Missing, malformed, or negative values fall back instead of
 * poisoning the caller with `NaN`.
 */

/** Reads a non-negative integer query parameter; absent/invalid → `fallback`. */
export function pageNumberParam(name: string, fallback: number): number {
  if (typeof window === 'undefined' || window.location === null) {
    return fallback;
  }
  try {
    const raw = new URLSearchParams(window.location.search).get(name);
    if (raw === null || raw === '') {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return Math.floor(parsed);
  } catch {
    return fallback;
  }
}
