/**
 * Central visual theme for the LayaAir client.
 *
 * Every colour, spacing value and font size the UI uses is declared here so the
 * whole look can be retuned from one file. Scenes and the battle view must read
 * from these tokens instead of hard-coding hex strings, otherwise the palette
 * drifts between screens.
 *
 * Palette intent: dark "spell card" night sky with violet/indigo structure and
 * gold accents, matching the original Touhou-flavoured direction (red = danger,
 * cyan = the player's own bullets, pink = the rival's bullets).
 *
 * NOTE: this module lives in `platform/laya/`, so it may use `Laya` types. It
 * must never be imported from `core/` — the core stays engine-agnostic.
 */

// --- base surfaces ---
export const COLOR_VOID = '#07050e';
export const COLOR_BACKGROUND = '#0a0713';
export const COLOR_PLAYFIELD = '#150c22';
export const COLOR_PLAYFIELD_EDGE = '#241638';
export const COLOR_PANEL = '#1d1430';
export const COLOR_PANEL_DEEP = '#150e25';
export const COLOR_PANEL_BORDER = '#5c4a86';
export const COLOR_DIVIDER = '#33254d';

// --- accent / state ---
export const COLOR_ACCENT = '#ffe36e';
export const COLOR_ACCENT_DIM = '#8a7530';
export const COLOR_SUCCESS = '#59e08a';
export const COLOR_DANGER = '#ff5470';
export const COLOR_WARNING = '#ffb347';
export const COLOR_INFO = '#7fd4ff';

// --- playfield actors ---
export const COLOR_BOSS = '#c46bff';
export const COLOR_BOSS_RING = '#6f3bb0';
export const COLOR_BOSS_DEFEATED = '#4b3a63';
export const COLOR_BORDER = '#4a3a6a';
export const COLOR_PLAYER = '#ffffff';
export const COLOR_LOCAL_PLAYER = '#ffe36e';
export const COLOR_HITBOX = '#ff3b6b';

// --- bullets ---
export const COLOR_LOCAL_BULLET = '#7fd4ff';
export const COLOR_LOCAL_BULLET_CORE = '#eafcff';
export const COLOR_OPPONENT_BULLET = '#ff8fb1';
export const COLOR_OPPONENT_BULLET_CORE = '#ffe6f0';

// --- HUD ---
export const COLOR_HUD = '#e8e2ff';
export const COLOR_HUD_DIM = '#9a8fc0';
export const COLOR_HP_BAR = '#59e08a';
export const COLOR_HP_BAR_LOW = '#ff5470';
export const COLOR_HP_BACK = '#331e3f';

// --- text ---
export const COLOR_TEXT = '#f0ecff';
/** Secondary label text: readable on `COLOR_PANEL_DEEP`, dimmer than `COLOR_TEXT`. */
export const COLOR_TEXT_MUTED = '#b9b1d9';
export const COLOR_TEXT_DISABLED = '#8a83a8';
export const COLOR_TITLE = '#ffe36e';

// --- spacing scale (4px base) ---
export const SPACE_XS = 4;
export const SPACE_SM = 8;
export const SPACE_MD = 16;
export const SPACE_LG = 24;
export const SPACE_XL = 32;

// --- layout metrics ---
/** Standard outer margin for a full screen. */
export const SCREEN_MARGIN = 24;
/** Height of a primary button. */
export const BUTTON_HEIGHT = 44;
/** Corner treatment radius used by panels/buttons. */
export const RADIUS_SM = 4;
export const RADIUS_MD = 8;

// --- typography ---
export const FONT_FAMILY = 'Arial';
export const FONT_SIZE_TITLE = 30;
export const FONT_SIZE_HEADING = 22;
export const FONT_SIZE_BODY = 17;
export const FONT_SIZE_LABEL = 16;
export const FONT_SIZE_CAPTION = 13;

/** Convenience: the CSS font string `Graphics.fillText` expects. */
export function font(size: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${size}px ${FONT_FAMILY}`;
}
