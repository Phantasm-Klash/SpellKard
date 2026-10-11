/**
 * `SettingsStore` — the one object every screen reads settings from and writes
 * settings to.
 *
 * Design notes:
 *  - The store owns the *only* mutable copy. `get()` hands out the same frozen
 *    snapshot until something changes, so a consumer can compare by identity
 *    instead of deep-diffing.
 *  - Every write goes through `normalizeSettings`, so a bad value can never
 *    enter the state, no matter who wrote it (panel, URL, storage).
 *  - Persistence is injected (`SettingsPersistence`), which keeps this file
 *    DOM-free and lets the tests use an in-memory double.
 *  - Persistence failures are swallowed on purpose: a player whose browser
 *    denies storage should still be able to change settings for this session.
 *
 * NOTE: `core/` only.
 */

import { defaultSettings, type GameSettings, type SettingsPatch } from './schema';
import { normalizeSettings } from './normalize';

/** Minimal storage surface; `window.localStorage` satisfies it structurally. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Where a store loads from / saves to. */
export interface SettingsPersistence {
  /** Returns the stored payload, or `null` when there is nothing to load. */
  load(): unknown;
  save(settings: GameSettings): void;
}

export const SETTINGS_STORAGE_KEY = 'spellkard.settings';

/**
 * JSON persistence over any `StorageLike`. Never throws: a corrupt payload
 * loads as `null` (i.e. defaults) and a failed write is ignored.
 */
export function createStoragePersistence(
  storage: StorageLike | null | undefined,
  key: string = SETTINGS_STORAGE_KEY,
): SettingsPersistence {
  return {
    load(): unknown {
      try {
        const raw = storage?.getItem(key) ?? null;
        return raw === null || raw === '' ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    },
    save(settings: GameSettings): void {
      try {
        storage?.setItem(key, JSON.stringify(settings));
      } catch {
        // Quota exceeded / privacy mode: losing persistence is not worth a crash.
      }
    },
  };
}

/** Structural equality via the canonical JSON form (key order is fixed). */
function sameSettings(a: GameSettings, b: GameSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type SettingsListener = (settings: GameSettings) => void;

export class SettingsStore {
  private state: GameSettings;
  private readonly listeners = new Set<SettingsListener>();
  private readonly persistence: SettingsPersistence | null;

  constructor(options: { persistence?: SettingsPersistence | null; initial?: unknown } = {}) {
    this.persistence = options.persistence ?? null;
    const stored = options.initial !== undefined ? options.initial : this.persistence?.load() ?? null;
    this.state = normalizeSettings(stored);
  }

  /** The current settings. Treated as immutable by every consumer. */
  get(): GameSettings {
    return this.state;
  }

  /**
   * Merges a deep-partial patch. Unknown / invalid values are coerced by the
   * normaliser, so callers cannot corrupt the state. A patch that changes
   * nothing is a no-op (no persist, no notification).
   */
  update(patch: SettingsPatch): void {
    // Shallow-spread the groups, then let each group's normaliser fill the
    // fields the patch did not mention from the current state.
    const merged = { ...this.state, ...patch };
    this.apply(normalizeSettings(merged, this.state));
  }

  /** Replaces the whole payload (used by "restore defaults" and tests). */
  replace(settings: unknown): void {
    this.apply(normalizeSettings(settings));
  }

  /** Restores the shipped defaults. */
  reset(): void {
    this.apply(defaultSettings());
  }

  /** Subscribes to changes; returns the unsubscribe function. */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Canonical JSON form, i.e. exactly what would be persisted. */
  toJSON(): string {
    return JSON.stringify(this.state);
  }

  private apply(next: GameSettings): void {
    if (sameSettings(next, this.state)) {
      return;
    }
    this.state = next;
    this.persistence?.save(next);
    // Copy the set first: a listener is allowed to unsubscribe during dispatch.
    for (const listener of [...this.listeners]) {
      listener(next);
    }
  }
}
