/**
 * Draft panel: the mixed-pool draft's three candidate cards, drawn as a centred
 * card over the playfield while a round is open.
 *
 * The view is a thin adapter over `core/game/draft_panel_view`: the core model
 * decides *what* the candidates are and whether the local player may pick; this
 * file owns only *how* they look and where a click lands. A click reports the
 * candidate's 0-based index to `onCandidateClick`, which the scene turns into a
 * single `select_round_card` submission.
 *
 * NOTE: `platform/laya/` only. Never import from `core/`.
 */

import type { DraftPanelView } from '../../../core/game/draft_panel_view';
import { VectorPainter } from './sprites';
import * as theme from './theme';

/** The playfield box the panel centres itself inside. */
export interface DraftPanelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Panel width cap so the card does not stretch on a wide playfield. */
const PANEL_WIDTH_MAX = 420;
/** Height of one candidate row. */
const ROW_HEIGHT = 56;
/** Height of the title / turn line blocks. */
const TITLE_HEIGHT = 34;
const TURN_HEIGHT = 22;
/** Characters a summary line shows before it is truncated. */
const SUMMARY_MAX_CHARS = 42;

export class DraftPanel {
  readonly root: Laya.Sprite;
  /** Called with the 0-based candidate index when a candidate is clicked. */
  onCandidateClick: ((index: number) => void) | null = null;

  private readonly titleText: Laya.Text;
  private readonly turnText: Laya.Text;
  private readonly footerText: Laya.Text;
  private readonly candidateLayer: Laya.Sprite;
  private readonly candidateSprites: Laya.Sprite[] = [];
  private layout: DraftPanelLayout = { x: 0, y: 0, width: 0, height: 0 };
  private panel: DraftPanelView | null = null;

  constructor() {
    this.root = new Laya.Sprite();
    this.root.mouseEnabled = false;
    this.root.visible = false;

    this.titleText = makeText(theme.FONT_SIZE_HEADING, theme.COLOR_TITLE, true);
    this.root.addChild(this.titleText);
    this.turnText = makeText(theme.FONT_SIZE_BODY, theme.COLOR_INFO, false);
    this.root.addChild(this.turnText);
    this.footerText = makeText(theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false);
    this.root.addChild(this.footerText);

    this.candidateLayer = new Laya.Sprite();
    this.candidateLayer.mouseEnabled = false;
    this.root.addChild(this.candidateLayer);
  }

  /** Re-tiles the panel for a new playfield box (called on every relayout). */
  relayout(layout: DraftPanelLayout): void {
    this.layout = layout;
    this.redraw();
  }

  /** Installs the latest model; `null` hides the panel. */
  setView(panel: DraftPanelView | null): void {
    this.panel = panel;
    this.redraw();
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private panelWidth(): number {
    return Math.max(0, Math.min(PANEL_WIDTH_MAX, this.layout.width - theme.SPACE_LG * 2));
  }

  private panelHeight(): number {
    const rows = this.panel?.candidates.length ?? 0;
    const pad = theme.SPACE_MD;
    return pad + TITLE_HEIGHT + TURN_HEIGHT + rows * (ROW_HEIGHT + theme.SPACE_SM) + TITLE_HEIGHT + pad;
  }

  private redraw(): void {
    const panel = this.panel;
    const width = this.panelWidth();
    const visible = panel !== null && this.layout.width > 0 && width > 0;
    this.root.visible = visible;
    if (!visible || panel === null) {
      return;
    }
    const height = this.panelHeight();
    const left = this.layout.x + (this.layout.width - width) / 2;
    const top = this.layout.y + Math.max(theme.SPACE_LG, (this.layout.height - height) / 2);
    this.root.pos(left, top);
    this.root.size(width, height);

    const g = this.root.graphics;
    g.clear();
    VectorPainter.roundedPanel(g, 0, 0, width, height, theme.RADIUS_MD, theme.COLOR_PANEL_DEEP, theme.COLOR_ACCENT, 2);

    const pad = theme.SPACE_MD;
    this.titleText.text = `DRAFT · ROUND ${panel.roundIndex + 1}`;
    this.titleText.pos(pad, pad);
    this.titleText.size(width - pad * 2, TITLE_HEIGHT);
    this.turnText.text = turnLabel(panel);
    this.turnText.color = panel.canPick ? theme.COLOR_SUCCESS : theme.COLOR_TEXT_MUTED;
    this.turnText.pos(pad, pad + TITLE_HEIGHT);
    this.turnText.size(width - pad * 2, TURN_HEIGHT);

    let cursor = pad + TITLE_HEIGHT + TURN_HEIGHT;
    const rowWidth = width - pad * 2;
    for (let i = 0; i < panel.candidates.length; i += 1) {
      const sprite = this.candidateSprite(i);
      sprite.visible = true;
      sprite.pos(pad, cursor);
      sprite.size(rowWidth, ROW_HEIGHT);
      // Only a picker may click; a spectator sees the same rows inert.
      sprite.mouseEnabled = panel.canPick;
      this.drawCandidate(sprite, panel, i, rowWidth);
      cursor += ROW_HEIGHT + theme.SPACE_SM;
    }
    for (let i = panel.candidates.length; i < this.candidateSprites.length; i += 1) {
      this.candidateSprites[i].visible = false;
    }

    this.footerText.text = panel.poolHash === '' ? '' : `pool ${panel.poolHash}`;
    this.footerText.pos(pad, cursor);
    this.footerText.size(rowWidth, TITLE_HEIGHT);
  }

  private drawCandidate(sprite: Laya.Sprite, panel: DraftPanelView, index: number, width: number): void {
    const candidate = panel.candidates[index];
    const g = sprite.graphics;
    g.clear();
    const border = panel.canPick ? theme.COLOR_PANEL_BORDER : theme.COLOR_DIVIDER;
    VectorPainter.roundedPanel(g, 0, 0, width, ROW_HEIGHT, theme.RADIUS_SM, theme.COLOR_PANEL, border, 1);
    const size = theme.FONT_SIZE_CAPTION;
    g.fillText(
      `${index + 1}. ${candidate.cardId}`,
      theme.SPACE_SM,
      theme.SPACE_SM,
      theme.font(theme.FONT_SIZE_LABEL, true),
      theme.COLOR_TEXT,
      'left',
    );
    if (candidate.rarity !== '') {
      g.fillText(
        candidate.rarity.toUpperCase(),
        width - theme.SPACE_SM,
        theme.SPACE_SM,
        theme.font(size),
        theme.COLOR_ACCENT,
        'right',
      );
    }
    g.fillText(
      truncate(candidate.summary, SUMMARY_MAX_CHARS),
      theme.SPACE_SM,
      ROW_HEIGHT - size - theme.SPACE_SM,
      theme.font(size),
      theme.COLOR_TEXT_MUTED,
      'left',
    );
  }

  private candidateSprite(index: number): Laya.Sprite {
    const existing = this.candidateSprites[index];
    if (existing !== undefined) {
      return existing;
    }
    const sprite = new Laya.Sprite();
    const candidateIndex = index;
    sprite.on(Laya.Event.CLICK, undefined, () => this.onCandidateClick?.(candidateIndex));
    this.candidateLayer.addChild(sprite);
    this.candidateSprites.push(sprite);
    return sprite;
  }
}

function makeText(fontSize: number, color: string, bold: boolean): Laya.Text {
  const text = new Laya.Text();
  text.fontSize = fontSize;
  text.color = color;
  text.bold = bold;
  text.visible = true;
  return text;
}

/** Whose turn it is, in player-facing words. */
function turnLabel(panel: DraftPanelView): string {
  switch (panel.pickerRole) {
    case 'first':
      return 'YOUR PICK — you defeated the boss first';
    case 'second':
      return 'YOUR PICK — pick from what remains';
    default:
      return `WAITING — ${panel.firstUserId || 'another player'} is picking`;
  }
}

/** Truncates a label to `max` characters with a trailing ellipsis. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
