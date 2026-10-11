/**
 * Battle screen layout math (engine-agnostic, zero-dependency).
 *
 * The status panel is a vertical strip that sits to the right of the playfield;
 * the playfield keeps its 2:3 portrait ratio and fills the full stage height.
 * The panel takes the width that is left over, bounded above by `MAX_HUD_WIDTH`
 * so a very wide stage cannot let it swallow most of the screen. When the two
 * panes together are narrower than the stage (which happens once the panel hits
 * its cap) the whole block is centred horizontally, leaving near-symmetric
 * margins. When the leftover width is odd the block cannot be centred exactly,
 * so the extra 1px is deliberately left on the *right* margin: `originX` floors
 * the half-remainder, which guarantees `originX + contentWidth <= stageWidth`
 * and keeps the content block flush against the left edge first.
 *
 * Kept in `core/` (not the Laya platform layer) so the tiling is unit-testable
 * without an engine, and so `BattleScene` can recompute it whenever the stage
 * is resized instead of freezing it at construction time.
 */

/** Playfield height/width ratio: a 2:3 portrait battle area. */
export const PLAYFIELD_ASPECT = 3 / 2;

/**
 * Minimum width the status panel may shrink to. Below this the cards stop
 * reading, so the playfield yields width rather than the panel.
 */
export const MIN_HUD_WIDTH = 240;

/**
 * Maximum width the status panel may grow to. On a wide (landscape) stage the
 * leftover space would otherwise hand the panel most of the screen — on a 16:9
 * native stage it used to take ~62% — so the panel is capped and the remaining
 * space becomes symmetric letterbox margins on both sides of the content.
 */
export const MAX_HUD_WIDTH = 420;

/** Geometry for a stage of a given size. */
export interface BattleLayout {
  playfield: { width: number; height: number };
  playfieldX: number;
  playfieldY: number;
  hudX: number;
  hudWidth: number;
  hudHeight: number;
  /**
   * Actual empty strip on the right of the stage, i.e. the distance from the
   * end of the HUD to the right edge: `playfieldX` or `playfieldX + 1`.
   */
  rightGutter: number;
}

/** Geometry for a stage of `width` x `height`. */
export function battleLayout(width: number, height: number): BattleLayout {
  // Degenerate / negative stages must not yield negative sizes: clamp the
  // inputs, then run the same tiling math as a normal stage.
  const stageWidth = Math.max(0, width);
  const stageHeight = Math.max(0, height);
  // The playfield owns the full stage height at its fixed 2:3 ratio; the panel
  // takes the remainder. Clamp the playfield so a very wide stage still leaves
  // the panel a readable width.
  const idealPlayfieldWidth = Math.round(stageHeight / PLAYFIELD_ASPECT);
  const playfieldWidth = Math.min(idealPlayfieldWidth, Math.max(0, stageWidth - MIN_HUD_WIDTH));
  const playfieldHeight = Math.round(playfieldWidth * PLAYFIELD_ASPECT);
  // Cap the panel so a wide stage does not hand it most of the screen. Once the
  // cap bites, `contentWidth` falls short of the stage and the block is centred.
  const hudWidth = Math.min(Math.max(0, stageWidth - playfieldWidth), MAX_HUD_WIDTH);
  const contentWidth = playfieldWidth + hudWidth;
  // Floor (not round) the half-remainder so any odd pixel is left on the right:
  // this keeps `originX + contentWidth <= stageWidth` true for every stage size
  // instead of letting a rounded-up centre overhang the right edge by 1px.
  const originX = Math.max(0, Math.floor((stageWidth - contentWidth) / 2));
  // rightGutter is the *actual* empty strip on the right of the stage, i.e. the
  // distance from the end of the HUD to the right edge. Because originX is
  // floored, it is playfieldX or playfieldX + 1 — never less, and never more
  // than 1px more, so the two-column layout stays visually centred.
  const rightGutter = Math.max(0, stageWidth - originX - contentWidth);
  return {
    playfield: { width: playfieldWidth, height: playfieldHeight },
    playfieldX: originX,
    playfieldY: Math.round((stageHeight - playfieldHeight) / 2),
    hudX: originX + playfieldWidth,
    hudWidth,
    hudHeight: stageHeight,
    rightGutter,
  };
}
