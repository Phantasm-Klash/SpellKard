/**
 * Result screen: winner, points and replay id for a settled match.
 *
 * Layout follows the shared three-band grid (title / content / actions): a
 * `SCREEN_MARGIN` outer gutter, a title band, then a headline band that flips
 * hard between a golden VICTORY badge and a red DEFEAT badge, a two-column
 * data band (your stats | opponent) split by a vertical rule, and a single
 * full-width ghost button at the bottom. Every colour, size and gap comes from
 * `view/theme` — nothing is hard-coded here.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import * as theme from '../view/theme';
import {
  createBadge,
  createButtonEx,
  createDivider,
  createPanel,
  type ButtonHandle,
} from './ui_kit';
import type { ClientScene } from './scene';

export interface ResultSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
  /** Lazily read: the player id is only known after lobby sign-in. */
  localPlayerId: () => string;
}

/**
 * Vertical gap between the caption + value pairs inside a stat card. Chosen so
 * three rows fit inside `cardHeight` with the card border still clear.
 */
const ROW_GAP = theme.SPACE_SM;
/** Height of one stat card. Sized for a heading plus three caption/value rows. */
const CARD_HEIGHT = 196;

export class ResultScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly width: number;
  private readonly headline: Laya.Text;
  private readonly badgeHost: Laya.Sprite;
  private readonly leftCard: Laya.Sprite;
  private readonly leftTitle: Laya.Text;
  private readonly rightCard: Laya.Sprite;
  private readonly rightTitle: Laya.Text;
  private readonly divider: Laya.Sprite;
  private readonly metaText: Laya.Text;
  private readonly backButton: ButtonHandle;
  private readonly cardY: number;
  private readonly cardHeight: number;

  constructor(private readonly options: ResultSceneOptions) {
    const { width, height } = options;
    this.width = width;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    // --- title band ---
    const title = this.makeText('Match result', theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    title.y = margin;
    this.root.addChild(title);
    this.root.addChild(createDivider(margin, title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    // --- headline band: big accent/danger outcome word plus a status badge ---
    const headlineY = title.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    this.headline = this.makeText('', theme.FONT_SIZE_TITLE * 1.2, theme.COLOR_TITLE, true, margin);
    this.headline.align = 'center';
    this.headline.y = headlineY;
    this.root.addChild(this.headline);

    this.badgeHost = new Laya.Sprite();
    this.badgeHost.pos(margin, headlineY + theme.FONT_SIZE_TITLE * 1.2 + theme.SPACE_SM);
    this.root.addChild(this.badgeHost);

    // --- two-column data band ---
    // The title band is short and the action button is pinned to the bottom, so
    // the stat cards are pushed down by two `SPACE_XL` steps: with one step they
    // clustered at the top and left a dead half-screen below.
    this.cardY = headlineY + theme.FONT_SIZE_TITLE * 1.2 + theme.SPACE_SM + theme.SPACE_XL * 2;
    this.cardHeight = CARD_HEIGHT;
    const gap = theme.SPACE_MD;
    const columnWidth = Math.floor((contentWidth - gap) / 2);

    this.leftCard = new Laya.Sprite();
    this.leftCard.pos(margin, this.cardY);
    this.leftTitle = this.makeText('Your stats', columnWidth, theme.COLOR_TITLE, true, 0);
    this.leftTitle.y = theme.SPACE_SM;
    this.leftCard.addChild(this.leftTitle);
    this.root.addChild(this.leftCard);

    this.rightCard = new Laya.Sprite();
    this.rightCard.pos(margin + columnWidth + gap, this.cardY);
    this.rightTitle = this.makeText('Opponent', columnWidth, theme.COLOR_TITLE, true, 0);
    this.rightTitle.y = theme.SPACE_SM;
    this.rightCard.addChild(this.rightTitle);
    this.root.addChild(this.rightCard);

    // Vertical rule between the columns, spanning the data band.
    this.divider = createDivider(margin + columnWidth + gap / 2, this.cardY, this.cardHeight, false);
    this.root.addChild(this.divider);

    // `No result yet` uses a single centred notice panel instead of the columns.
    this.metaText = this.makeText('No result yet', theme.FONT_SIZE_HEADING, theme.COLOR_TEXT_DISABLED, false, margin);
    this.metaText.align = 'center';
    this.metaText.y = this.cardY + this.cardHeight / 2 - theme.FONT_SIZE_HEADING / 2;
    this.root.addChild(this.metaText);

    // --- action band ---
    this.backButton = createButtonEx(
      'Back to lobby',
      margin,
      height - margin - theme.BUTTON_HEIGHT,
      contentWidth,
      () => this.options.flow.backToLobby(),
      'ghost',
    );
    this.root.addChild(this.backButton.sprite);
  }

  onEnter(): void {
    this.root.visible = true;
    this.applySnapshot(this.options.flow.snapshot());
  }

  onExit(): void {
    this.root.visible = false;
  }

  destroy(): void {
    this.root.destroy(true);
  }

  applySnapshot(snapshot: LobbyFlowSnapshot): void {
    const result = snapshot.result;
    if (result === null) {
      this.headline.text = 'No result yet';
      this.headline.color = theme.COLOR_TEXT_DISABLED;
      this.badgeHost.visible = false;
      this.setColumnsVisible(false);
      this.metaText.visible = true;
      this.metaText.text = 'No result yet';
      this.metaText.fontSize = theme.FONT_SIZE_HEADING;
      this.metaText.y = this.cardY + this.cardHeight / 2 - theme.FONT_SIZE_HEADING / 2;
      return;
    }

    this.metaText.visible = false;
    this.setColumnsVisible(true);
    // Re-show the badge host: the "no result" branch above hides it, so a
    // scene that first rendered without a result must restore it or the
    // VICTORY / DEFEAT pill stays invisible.
    this.badgeHost.visible = true;

    // The signed-in player id can legitimately be empty (offline demo, or a
    // result rendered before sign-in completes). In that case fall back to the
    // first id in the score table so the screen still reads as a real result
    // instead of crowning nobody and printing `-` for the local score.
    const signedInId = this.options.localPlayerId();
    const scoreIds = Object.keys(result.points);
    const localId = signedInId !== '' ? signedInId : scoreIds[0] ?? '';
    const opponentId = scoreIds.find((id) => id !== localId) ?? '';
    const won = localId !== '' && result.winnerPlayerId === localId;
    this.headline.text = won ? 'Victory!' : 'Defeat';
    this.headline.color = won ? theme.COLOR_ACCENT : theme.COLOR_DANGER;

    this.badgeHost.removeChildren();
    const badge = createBadge(won ? 'VICTORY' : 'DEFEAT', 0, 0, { tone: won ? 'success' : 'danger' });
    // Centre the pill under the headline.
    badge.sprite.x = Math.floor((this.width - badge.width) / 2);
    this.badgeHost.addChild(badge.sprite);

    this.renderColumn(this.leftCard, 'Your stats', [
      ['Winner', result.winnerPlayerId || '-'],
      ['Your score', this.formatScore(result.points[localId])],
      ['Match', result.matchId || '-'],
    ]);
    this.renderColumn(this.rightCard, 'Opponent', [
      ['Opponent', opponentId || '-'],
      ['Score', opponentId ? this.formatScore(result.points[opponentId]) : '-'],
      ['Replay', result.replayId || '-'],
    ]);

    this.metaText.text = `${result.serverAuthoritative ? 'Server authoritative' : 'Client authoritative'} · settled ${result.settledAtMs}ms`;
    this.metaText.color = theme.COLOR_TEXT_MUTED;
    this.metaText.fontSize = theme.FONT_SIZE_CAPTION;
    this.metaText.y = this.cardY + this.cardHeight + theme.SPACE_MD;
  }

  private setColumnsVisible(visible: boolean): void {
    this.leftCard.visible = visible;
    this.rightCard.visible = visible;
    this.divider.visible = visible;
  }

  /**
   * Paints a titled card with a stack of caption + value rows.
   *
   * Row pitch is one caption line plus one value line plus `ROW_GAP`. It is
   * deliberately tighter than `SPACE_MD`: with three rows the previous pitch
   * overflowed `cardHeight` and the last value row ran into the card border.
   */
  private renderColumn(sprite: Laya.Sprite, title: string, rows: [string, string][]): void {
    const columnWidth = sprite === this.leftCard ? this.leftTitle.width : this.rightTitle.width;
    sprite.removeChildren();
    const panel = createPanel(0, 0, columnWidth, this.cardHeight, { fill: theme.COLOR_PANEL_DEEP });
    sprite.addChild(panel);
    const heading = this.makeText(title, columnWidth, theme.COLOR_TITLE, true, theme.SPACE_MD);
    heading.y = theme.SPACE_SM;
    heading.width = columnWidth - theme.SPACE_MD * 2;
    sprite.addChild(heading);
    // Start below the heading; `SPACE_SM + FONT_SIZE_LABEL + SPACE_SM` clears it.
    let y = theme.SPACE_SM + theme.FONT_SIZE_LABEL + theme.SPACE_SM;
    rows.forEach(([label, value]) => {
      const caption = this.makeText(label, columnWidth, theme.COLOR_TEXT_MUTED, false, theme.SPACE_MD);
      caption.fontSize = theme.FONT_SIZE_CAPTION;
      caption.width = columnWidth - theme.SPACE_MD * 2;
      caption.y = y;
      sprite.addChild(caption);
      const valueText = this.makeText(value, columnWidth, theme.COLOR_TEXT, true, theme.SPACE_MD);
      valueText.fontSize = theme.FONT_SIZE_LABEL;
      valueText.width = columnWidth - theme.SPACE_MD * 2;
      valueText.y = y + theme.FONT_SIZE_CAPTION + theme.SPACE_XS;
      sprite.addChild(valueText);
      y += theme.FONT_SIZE_CAPTION + theme.FONT_SIZE_LABEL + ROW_GAP;
    });
  }

  private formatScore(value: number | undefined): string {
    return value === undefined ? '-' : String(value);
  }

  /** Concise text factory: one place that sets font, weight and x. */
  private makeText(text: string, width: number, color: string, bold: boolean, x: number): Laya.Text {
    const label = new Laya.Text();
    label.text = text;
    label.fontSize = theme.FONT_SIZE_LABEL;
    label.color = color;
    label.bold = bold;
    label.width = width;
    label.x = x;
    return label;
  }
}
