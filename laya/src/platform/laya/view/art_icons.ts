/**
 * Vector icon set for the client's art-direction pass.
 *
 * The brief: buttons must stop reading as a row of identical squares. Every icon
 * here is drawn with Laya `Graphics` primitives — no bitmaps — so the set stays
 * tiny, crisp at any size, and recolorable per state (the same path is drawn in
 * gold for idle, lacquer-white for pressed, and muted grey for disabled).
 *
 * Design language: the contemporary Chinese "guofeng" vocabulary that Mahjong
 * Soul popularised — seal-plate accents, ink strokes with rounded terminals,
 * vermillion on lacquer. Studied as a *language* (shapes, weights, accents) and
 * redrawn here with our own paths; none of that game's art is used, and its
 * asset bundles are encrypted besides.
 *
 * This module lives in `platform/laya/`, so it may use `Laya` types. It must
 * never be imported from `core/`.
 */

/**
 * The slice of `Laya.Graphics` this module draws with, declared structurally so
 * the icon set compiles (and is testable) without the engine's global typings.
 * A real `Laya.Graphics` is assignable to it: every method here is one it has.
 */
interface ArtGraphics {
  drawPath(
    x: number,
    y: number,
    paths: unknown[],
    brush?: unknown,
    pen?: unknown,
    lineWidth?: number,
  ): void;
  drawCircle(
    x: number,
    y: number,
    radius: number,
    fill?: unknown,
    stroke?: unknown,
    lineWidth?: number,
  ): void;
  drawPoly(x: number, y: number, points: unknown[], fill?: unknown, stroke?: unknown, lineWidth?: number): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, color: unknown, width?: number): void;
}

/** Every icon the UI can ask for, keyed by the name scenes pass in. */
export type ArtIconName =
  | 'play'
  | 'room'
  | 'records'
  | 'shop'
  | 'settings'
  | 'gift'
  | 'back'
  | 'confirm'
  | 'close'
  | 'account'
  | 'deck'
  | 'character'
  | 'rank'
  | 'queue'
  | 'mail'
  | 'trophy';

const ICON_NAMES: readonly ArtIconName[] = [
  'play',
  'room',
  'records',
  'shop',
  'settings',
  'gift',
  'back',
  'confirm',
  'close',
  'account',
  'deck',
  'character',
  'rank',
  'queue',
  'mail',
  'trophy',
];

/** True when `name` is an icon this set can draw. */
export function isArtIconName(name: string): name is ArtIconName {
  return (ICON_NAMES as readonly string[]).includes(name);
}

/**
 * Maps a button label onto an icon, so a scene that only passes text still gets
 * the art treatment. Matching is by substring on the *English* label the scenes
 * use (`Sign in`, `Play`, `Records`, …); a label with no mapping simply draws
 * without an icon rather than guessing a wrong one.
 */
export function iconNameForLabel(label: string): ArtIconName | null {
  const text = label.toLowerCase();
  // "Create account" must be checked before the bare "account" rule: the login
  // screen shows Sign in and Create account side by side, and giving both the
  // same profile icon is exactly the uniform-row feel this pass removes.
  if (text.includes('create') || text.includes('register') || text.includes('sign up')) {
    return 'confirm';
  }
  if (text.includes('sign in') || text.includes('log in') || text.includes('account')) {
    return 'account';
  }
  if (text.includes('play') || text.includes('start') || text.includes('match')) {
    return 'play';
  }
  if (text.includes('room')) {
    return 'room';
  }
  if (text.includes('record') || text.includes('replay') || text.includes('history')) {
    return 'records';
  }
  if (text.includes('shop') || text.includes('store')) {
    return 'shop';
  }
  if (text.includes('setting') || text.includes('option')) {
    return 'settings';
  }
  if (text.includes('gift') || text.includes('send')) {
    return 'gift';
  }
  if (text.includes('back') || text.includes('return')) {
    return 'back';
  }
  if (text.includes('deck') || text.includes('card')) {
    return 'deck';
  }
  if (text.includes('character') || text.includes('hero')) {
    return 'character';
  }
  if (text.includes('rank') || text.includes('tier')) {
    return 'rank';
  }
  if (text.includes('queue') || text.includes('matchmaking')) {
    return 'queue';
  }
  if (text.includes('mail') || text.includes('code')) {
    return 'mail';
  }
  if (text.includes('trophy') || text.includes('achievement')) {
    return 'trophy';
  }
  return null;
}

/**
 * Draws one icon centred on (cx, cy) inside a `size`-pixel box, in `color`.
 *
 * Every path is authored in a unit box (-0.5..0.5) and scaled by `size`, so an
 * icon looks the same at 18 px in a button and at 64 px in a banner.
 */
export function drawArtIcon(
  g: ArtGraphics,
  name: ArtIconName,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const s = size / 2;
  const px = (ux: number, uy: number): [number, number] => [cx + ux * s, cy + uy * s];
  const path = (points: readonly (readonly [number, number])[], close = true): void => {
    const flat: number[] = [];
    for (const [ux, uy] of points) {
      flat.push(cx + ux * s, cy + uy * s);
    }
    if (close) {
      flat.push(flat[0], flat[1]);
    }
    g.drawPath(0, 0, flat, null, color, Math.max(1.5, size * 0.09));
  };
  const dot = (ux: number, uy: number, r: number, fill = color): void => {
    const [x, y] = px(ux, uy);
    g.drawCircle(x, y, Math.max(0.8, r * s), fill);
  };

  switch (name) {
    case 'play': {
      // A filled triangle with rounded corners: the one shape that still reads
      // as "go" after the square-button purge.
      path(
        [
          [-0.26, -0.34],
          [0.3, 0],
          [-0.26, 0.34],
        ],
        true,
      );
      g.drawPoly(0, 0, [cx - 0.26 * s, cy - 0.34 * s, cx + 0.3 * s, cy, cx - 0.26 * s, cy + 0.34 * s], color, null, 0);
      break;
    }
    case 'room': {
      // A table with two seats: two dots over a shallow tray.
      path(
        [
          [-0.36, 0.02],
          [0.36, 0.02],
          [0.28, 0.3],
          [-0.28, 0.3],
        ],
        true,
      );
      dot(-0.24, -0.2, 0.1);
      dot(0.24, -0.2, 0.1);
      break;
    }
    case 'records': {
      // A scroll: a bar with two rolled ends.
      path(
        [
          [-0.34, -0.26],
          [0.34, -0.26],
          [0.34, 0.26],
          [-0.34, 0.26],
        ],
        true,
      );
      dot(-0.42, -0.26, 0.09);
      dot(0.42, -0.26, 0.09);
      dot(-0.42, 0.26, 0.09);
      dot(0.42, 0.26, 0.09);
      break;
    }
    case 'shop': {
      // A hanging sign: a cord, a plaque, a tassel.
      path(
        [
          [0, -0.42],
          [0, -0.18],
        ],
        false,
      );
      path(
        [
          [-0.26, -0.18],
          [0.26, -0.18],
          [0.26, 0.22],
          [-0.26, 0.22],
        ],
        true,
      );
      path(
        [
          [0, 0.22],
          [0, 0.38],
        ],
        false,
      );
      break;
    }
    case 'settings': {
      // A gear reduced to a ring with six teeth — readable at 18 px.
      const teeth = 6;
      const flat: number[] = [];
      for (let index = 0; index < teeth * 2; index += 1) {
        const angle = (index / (teeth * 2)) * Math.PI * 2;
        const radius = index % 2 === 0 ? 0.36 : 0.24;
        flat.push(cx + Math.cos(angle) * radius * s, cy + Math.sin(angle) * radius * s);
      }
      flat.push(flat[0], flat[1]);
      g.drawPath(0, 0, flat, null, color, Math.max(1.5, size * 0.09));
      dot(0, 0, 0.07, 'rgba(0,0,0,0)');
      break;
    }
    case 'gift': {
      // A tied box: a ribbon cross over a rounded body.
      path(
        [
          [-0.3, -0.1],
          [0.3, -0.1],
          [0.3, 0.34],
          [-0.3, 0.34],
        ],
        true,
      );
      path(
        [
          [0, -0.1],
          [0, 0.34],
        ],
        false,
      );
      path(
        [
          [-0.36, -0.1],
          [0, -0.3],
          [0.36, -0.1],
        ],
        false,
      );
      break;
    }
    case 'back': {
      // A chevron pointing left.
      path(
        [
          [0.2, -0.32],
          [-0.16, 0],
          [0.2, 0.32],
        ],
        false,
      );
      break;
    }
    case 'confirm': {
      // A check with a brush-like tapered tail.
      path(
        [
          [-0.32, 0.02],
          [-0.08, 0.26],
          [0.34, -0.28],
        ],
        false,
      );
      break;
    }
    case 'close': {
      // Two crossing strokes.
      path(
        [
          [-0.26, -0.26],
          [0.26, 0.26],
        ],
        false,
      );
      path(
        [
          [0.26, -0.26],
          [-0.26, 0.26],
        ],
        false,
      );
      break;
    }
    case 'account': {
      // A seal-style profile: a head dot over a shoulder arc.
      dot(0, -0.16, 0.15);
      path(
        [
          [-0.32, 0.36],
          [-0.28, 0.06],
          [0.28, 0.06],
          [0.32, 0.36],
        ],
        false,
      );
      break;
    }
    case 'deck': {
      // Two overlapping cards.
      path(
        [
          [-0.3, -0.28],
          [0.06, -0.34],
          [0.06, 0.26],
          [-0.3, 0.32],
        ],
        true,
      );
      path(
        [
          [0.3, -0.2],
          [0.3, 0.34],
          [0.02, 0.28],
          [0.02, -0.26],
        ],
        true,
      );
      break;
    }
    case 'character': {
      // A standing figure: head, body, skirt.
      dot(0, -0.3, 0.12);
      path(
        [
          [-0.26, 0.36],
          [-0.14, -0.08],
          [0.14, -0.08],
          [0.26, 0.36],
        ],
        true,
      );
      break;
    }
    case 'rank': {
      // A banner on a pole.
      path(
        [
          [-0.3, -0.34],
          [-0.3, 0.4],
        ],
        false,
      );
      path(
        [
          [-0.3, -0.3],
          [0.3, -0.16],
          [-0.3, 0.02],
        ],
        true,
      );
      break;
    }
    case 'queue': {
      // Three queued dots on a line.
      path(
        [
          [-0.38, 0.24],
          [0.38, 0.24],
        ],
        false,
      );
      dot(-0.22, -0.06, 0.09);
      dot(0, -0.06, 0.09);
      dot(0.22, -0.06, 0.09);
      break;
    }
    case 'mail': {
      // An envelope.
      path(
        [
          [-0.34, -0.22],
          [0.34, -0.22],
          [0.34, 0.22],
          [-0.34, 0.22],
        ],
        true,
      );
      path(
        [
          [-0.34, -0.22],
          [0, 0.08],
          [0.34, -0.22],
        ],
        false,
      );
      break;
    }
    case 'trophy': {
      // A cup with two handles.
      path(
        [
          [-0.22, -0.24],
          [0.22, -0.24],
          [0.14, 0.2],
          [-0.14, 0.2],
        ],
        true,
      );
      path(
        [
          [-0.22, -0.16],
          [-0.36, -0.08],
          [-0.22, 0.04],
        ],
        false,
      );
      path(
        [
          [0.22, -0.16],
          [0.36, -0.08],
          [0.22, 0.04],
        ],
        false,
      );
      path(
        [
          [0, 0.2],
          [0, 0.34],
        ],
        false,
      );
      break;
    }
    default:
      break;
  }
}
