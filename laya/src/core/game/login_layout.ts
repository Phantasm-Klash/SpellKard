/**
 * Login screen layout math (engine-agnostic, zero-dependency).
 *
 * The login screen has to survive two very different logical stages:
 *
 *  - **web** — `Laya.init` pins the stage to the 900x1200 design size, so the
 *    screen is a portrait rectangle and the art stacks vertically.
 *  - **LayaNative** — the IDE runtime uses `fixedheight`, so the stage is
 *    `(750 * windowAspect) x 750`: a wide landscape rectangle whose width
 *    changes with the window.
 *
 * Rather than hard-code either, this module maps a stage size onto the same
 * three pieces the scene draws — a full-bleed backdrop, the Reimu portrait and
 * the form card — and picks a stacked (portrait above card) or a two-column
 * (portrait beside card) arrangement from the stage aspect. Keeping the maths
 * here (not in the Laya layer) makes it unit-testable without an engine and lets
 * `LoginScene` recompute it on every `RESIZE` instead of freezing it at boot.
 *
 * Every returned coordinate and size is a non-negative integer so the scene can
 * assign them straight onto sprites, and degenerate stages (0, negative, tiny)
 * collapse to zeroes instead of NaN or negative rectangles.
 *
 * NOTE: `core/` only — no Laya / DOM types here.
 */

import {
  LOGIN_BACKGROUND_SIZE,
  LOGIN_PORTRAIT_SIZE,
  containFit,
  coverFit,
} from './login_assets';

/** Outer gutter kept clear on every edge. */
export const LOGIN_MARGIN = 24;

/** Narrowest the form card may get before it stops being readable. */
export const LOGIN_MIN_CARD_WIDTH = 280;

/** Widest the form card may get; wider stages leave room for the portrait. */
export const LOGIN_MAX_CARD_WIDTH = 420;

/**
 * Stage aspect (width / height) at or above which the screen switches to the
 * two-column arrangement. Below it the screen is portrait-ish and stacks.
 */
export const LOGIN_WIDE_RATIO = 1.2;

/**
 * Height of the title band reserved at the top of the screen for the
 * "Phantasm Klash" wordmark. The portrait and card are laid out below it.
 */
export const LOGIN_TITLE_BAND = 96;

// --- card interior metrics (shared with the scene so both agree) ------------

/** Padding between the card edge and its content. */
export const LOGIN_CARD_PAD = 20;
/** Height of the mode heading row inside the card ("Sign in" / "Create account"). */
export const LOGIN_CARD_TITLE_H = 28;
/** Height of one editable field. */
export const LOGIN_FIELD_H = 44;
/** Vertical gap between two stacked fields. */
export const LOGIN_FIELD_GAP = 12;
/**
 * Number of fields the card reserves room for. Register mode shows all five
 * (username / e-mail / password / confirm / e-mail code); sign-in mode shows
 * only the e-mail and password rows.
 */
export const LOGIN_FIELD_COUNT = 5;
/**
 * Width of the compact "Send code" button that sits inside the e-mail row.
 * It is clamped down on a narrow card by `loginEmailRowMetrics`.
 */
export const LOGIN_CODE_BUTTON_W = 104;
/** Gap between the e-mail input and the "Send code" button. */
export const LOGIN_CODE_BUTTON_GAP = 8;
/** The "Send code" button never shrinks below this. */
export const LOGIN_CODE_BUTTON_MIN_W = 76;
/** Height of the status line. */
export const LOGIN_STATUS_H = 20;
/**
 * Height of the endpoint caption the scene paints directly under the status
 * line ("Lobby: <endpoint>"). Reserved unconditionally so the card never
 * reflows when a connection failure surfaces the caption.
 */
export const LOGIN_ENDPOINT_H = 16;
/** Height of one button. */
export const LOGIN_BUTTON_H = 42;
/** Vertical gap between two stacked buttons. */
export const LOGIN_BUTTON_GAP = 10;
/** Number of buttons the card reserves room for (primary / secondary). */
export const LOGIN_BUTTON_COUNT = 2;
/** Gap between two content blocks (heading, fields, status, buttons). */
export const LOGIN_BLOCK_GAP = 12;

/**
 * Gutter kept clear between the decorative halo disc and the stage edge. The
 * disc is centred on the portrait, which the two-column layout pins to the
 * right; without this the disc would always be clipped on a wide stage.
 */
export const HALO_EDGE_GUTTER = 16;

/**
 * Height the card needs when every optional row is visible (register mode with
 * the confirm-password field). The scene centres its shorter login-mode content
 * inside this box, so one card rect serves both modes.
 */
export const LOGIN_CARD_CONTENT_H =
  LOGIN_CARD_PAD +
  LOGIN_CARD_TITLE_H +
  LOGIN_BLOCK_GAP +
  (LOGIN_FIELD_COUNT * LOGIN_FIELD_H + (LOGIN_FIELD_COUNT - 1) * LOGIN_FIELD_GAP) +
  LOGIN_BLOCK_GAP +
  LOGIN_STATUS_H +
  LOGIN_ENDPOINT_H +
  LOGIN_BLOCK_GAP +
  (LOGIN_BUTTON_COUNT * LOGIN_BUTTON_H + (LOGIN_BUTTON_COUNT - 1) * LOGIN_BUTTON_GAP) +
  LOGIN_CARD_PAD;

/** Portrait aspect ratio (width / height), from the source art. */
const PORTRAIT_ASPECT = LOGIN_PORTRAIT_SIZE.width / LOGIN_PORTRAIT_SIZE.height;

/** How the e-mail row splits between its input and the "Send code" button. */
export interface LoginEmailRowMetrics {
  inputWidth: number;
  buttonWidth: number;
  gap: number;
}

/**
 * Splits the card's inner width between the e-mail input and the compact "Send
 * code" button.
 *
 * The button takes a fixed-ish share (capped, and never more than a third of the
 * row) so the input keeps the room a full address needs. On a very narrow card
 * the button gives ground first, then both shrink together — the result is
 * always non-negative and always adds back up to `innerWidth`, so the scene can
 * lay the row out without a second clamp.
 */
export function loginEmailRowMetrics(innerWidth: number): LoginEmailRowMetrics {
  const total = px(innerWidth);
  const gap = total > 0 ? Math.min(LOGIN_CODE_BUTTON_GAP, total) : 0;
  const available = Math.max(0, total - gap);
  const preferred = Math.max(LOGIN_CODE_BUTTON_MIN_W, Math.round(available * 0.3));
  const buttonWidth = Math.min(LOGIN_CODE_BUTTON_W, available, Math.max(0, preferred));
  return { inputWidth: Math.max(0, available - buttonWidth), buttonWidth, gap };
}

export interface LoginLayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LoginLayout {
  /** Full-stage backdrop rect. `scale` is the cover-fit factor. */
  background: { x: number; y: number; width: number; height: number; scale: number };
  /** Portrait rect (already aspect-correct, may be zero when there is no room). */
  portrait: { x: number; y: number; width: number; height: number; scale: number };
  /** Form card rect. */
  card: LoginLayoutRect;
  /**
   * Decorative halo disc centred on the portrait (square). Zero when there is
   * no room; it is always kept fully inside the stage.
   */
  halo: LoginLayoutRect;
  /** Two-column (portrait beside card) vs stacked (portrait above card). */
  stacked: boolean;
}

/** Rounds to a non-negative integer (guards NaN too). */
function px(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

/**
 * Geometry for a stage of `stageWidth` x `stageHeight`. The returned rects are
 * already positioned (absolute stage coordinates), not relative to a parent.
 */
export function loginLayout(stageWidth: number, stageHeight: number): LoginLayout {
  const w = px(stageWidth);
  const h = px(stageHeight);

  // Backdrop: cover-fit the 2:3 title art over the whole stage. On a wide stage
  // the art is scaled up and cropped top/bottom; on a tall stage it is cropped
  // left/right. Either way the stage is fully covered.
  const cover = coverFit(LOGIN_BACKGROUND_SIZE.width, LOGIN_BACKGROUND_SIZE.height, w, h);
  const background = {
    x: px(cover.x),
    y: px(cover.y),
    width: px(LOGIN_BACKGROUND_SIZE.width * cover.scale),
    height: px(LOGIN_BACKGROUND_SIZE.height * cover.scale),
    scale: cover.scale,
  };

  // Card width: the preferred clamp, then capped by the stage so it can never
  // overflow (this is what makes a 0x0 stage collapse to width 0 instead of the
  // 280px minimum).
  const avail = Math.max(0, w - LOGIN_MARGIN * 2);
  const cardWidth = px(Math.min(px(Math.min(LOGIN_MAX_CARD_WIDTH, Math.max(LOGIN_MIN_CARD_WIDTH, avail))), w));

  // Portrait-ish stages stack; wide stages go two-column.
  const stacked = !(h > 0 && w / h >= LOGIN_WIDE_RATIO);

  // Portrait: cap the height (0.42h stacked / 0.62h two-column), keep the art's
  // aspect, and never let it grow past the share of the width it is allowed.
  const portraitMaxH = stacked ? h * 0.42 : h * 0.62;
  const portraitMaxW = stacked ? w * 0.72 : w * 0.4;
  const portraitFit = containFit(LOGIN_PORTRAIT_SIZE.width, LOGIN_PORTRAIT_SIZE.height, portraitMaxW, portraitMaxH);
  const portraitW = px(LOGIN_PORTRAIT_SIZE.width * portraitFit.scale);
  const portraitH = px(LOGIN_PORTRAIT_SIZE.height * portraitFit.scale);
  const portraitScale = portraitH > 0 ? portraitH / LOGIN_PORTRAIT_SIZE.height : 0;

  const titleBand = Math.min(LOGIN_TITLE_BAND, h);

  let cardX: number;
  let cardY: number;
  let portraitX: number;
  let portraitY: number;

  if (stacked) {
    // Portrait centred under the title band; card centred below the portrait.
    //
    // The card has to fit **completely**: register mode is five fields and two
    // buttons, which needs LOGIN_CARD_CONTENT_H. The portrait used to take its
    // full height first and squeezed the card into whatever was left - on a
    // 800x600 portrait that left 168px of a 502px card, and the buttons ended
    // up past its border. So the portrait only gets the room the card does not
    // need, and the card starts right under the title band.
    const cardTop = px(titleBand);
    const cardRoom = Math.max(0, h - cardTop - LOGIN_MARGIN);
    const portraitRoom = Math.max(0, cardRoom - px(LOGIN_CARD_CONTENT_H));
    portraitX = px((w - portraitW) / 2);
    portraitY = cardTop + Math.max(0, portraitRoom);
    cardX = px((w - cardWidth) / 2);
    cardY = cardTop;
  } else {
    // Card pinned to the left gutter; portrait centred vertically on the right.
    cardX = px(LOGIN_MARGIN);
    cardY = px(titleBand);
    portraitX = px(Math.max(cardX + cardWidth + LOGIN_BLOCK_GAP, w - LOGIN_MARGIN - portraitW));
    portraitY = px((h - portraitH) / 2);
  }

  // The card is clamped to whatever vertical room is left so it never runs off
  // the bottom of the stage (and never goes negative on a degenerate stage).
  const cardHeight = px(Math.min(LOGIN_CARD_CONTENT_H, Math.max(0, h - cardY - LOGIN_MARGIN)));

  // Decorative halo disc: centred on the portrait, a little taller than it, and
  // centred below the portrait's midpoint (chest/waist) so the head clears the
  // ring. The only hard constraint is that the disc stays fully inside the stage
  // with a `HALO_EDGE_GUTTER` margin — otherwise the two-column layout (which
  // pins the portrait near the right edge) would always clip it.
  const haloCx = portraitX + portraitW / 2;
  const haloCy = portraitY + portraitH * 0.55;
  const roomX = Math.min(haloCx - HALO_EDGE_GUTTER, w - HALO_EDGE_GUTTER - haloCx);
  const roomY = Math.min(haloCy - HALO_EDGE_GUTTER, h - HALO_EDGE_GUTTER - haloCy);
  const maxSide = Math.max(0, 2 * Math.min(roomX, roomY));
  const haloSide = Math.max(0, Math.min(Math.round(portraitH * 1.35), maxSide));
  const halo =
    haloSide > 0
      ? {
          x: px(haloCx - haloSide / 2),
          y: px(haloCy - haloSide / 2),
          width: px(haloSide),
          height: px(haloSide),
        }
      : { x: 0, y: 0, width: 0, height: 0 };

  return {
    background,
    portrait: {
      x: portraitX,
      y: portraitY,
      width: portraitW,
      height: portraitH,
      scale: portraitScale,
    },
    card: { x: cardX, y: cardY, width: cardWidth, height: cardHeight },
    halo,
    stacked,
  };
}

/** Exposed for tests: the portrait aspect ratio the layout keeps. */
export const LOGIN_PORTRAIT_ASPECT = PORTRAIT_ASPECT;

/** Exposed for tests: the clamp bounds the card width is chosen from. */
export const LOGIN_CARD_WIDTH_BOUNDS = { min: LOGIN_MIN_CARD_WIDTH, max: LOGIN_MAX_CARD_WIDTH } as const;
