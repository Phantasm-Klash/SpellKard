/**
 * Canonical product identity (engine-agnostic, zero-dependency).
 *
 * One place that names the game, so the login title, the lobby header and the
 * settings panel can never drift apart. Before this module the Latin wordmark
 * "Phantasm Klash" was duplicated as a literal in three files, which is exactly
 * how a product name ends up inconsistent across screens.
 *
 * The Chinese name is the one the player sees on the title; the Latin name is
 * kept alongside it (settings panel, Windows bundle metadata).
 *
 * NOTE: `core/` only — no Laya / DOM types here.
 */

/** Localised (Chinese) product name — the title the player reads. */
export const GAME_NAME_ZH = '纷争幻想';

/** Latin product name, kept for the settings panel and the desktop bundle. */
export const GAME_NAME_EN = 'Phantasm Klash';

/**
 * Client version shown on the settings panel. Mirrors `package.json`; there is
 * no build-time stamping step yet, so bump both together.
 */
export const GAME_VERSION = '0.1.0';

/** Title text for the entry (login) screen. */
export function gameTitle(): string {
  return GAME_NAME_ZH;
}

/** Lobby header: product name plus the screen the player is on. */
export function lobbyTitle(): string {
  return `${GAME_NAME_ZH} — Lobby`;
}

/** Settings "Game" row: both names, Chinese first. */
export function gameNameLine(): string {
  return `${GAME_NAME_ZH} · ${GAME_NAME_EN}`;
}

// --- About page facts -------------------------------------------------------

/**
 * Copyright line shown on the About tab. Mirrors the repository `LICENSE`
 * ("MIT License — Copyright (c) 2026 Phantasm Klash contributors").
 */
export const COPYRIGHT_LINE = '© 2026 Phantasm Klash contributors';

/** Licence of the code. */
export const CODE_LICENSE = 'MIT';

/** Licence of the bundled art / data. */
export const ASSET_LICENSE = 'CC BY 4.0';

/**
 * Public repository URL. **Empty until the project is published** — the About
 * tab then shows "Not published yet" and disables the open button instead of
 * sending the player to a dead link. Fill this in when the repo goes public.
 */
export const PROJECT_URL = '';

/** Build label shown next to the version (engine + target). */
export const BUILD_LABEL = 'LayaAir 3 · TypeScript';

/**
 * Third-party credits, one line each. Kept as data so the About tab stays a
 * dumb renderer and the list can be reviewed in one place.
 */
export const CREDITS: readonly string[] = [
  '上海アリス幻樂団 / ZUN — 東方Project 原作',
  'LayaAir (Layabox) — 客户端引擎',
  'Nakama (Heroic Labs) — 大厅服务端',
  '千夜追忆 (Thousand Night Anamnesis) — 弹幕数据参考',
  'Phantasm Klash contributors — 代码与美术',
];
