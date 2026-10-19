/**
 * Records screen: the player's personal record dashboard.
 *
 * Layout follows the shared three-band grid (title / content / actions): a
 * `SCREEN_MARGIN` outer gutter, a title band, a two-column summary grid (gold /
 * points / rating / win-loss-draw / win rate / best / average / cumulative
 * graze · hit · damage · card plays), then the recent-match list. Both dynamic
 * blocks live in dedicated containers that are cleared and re-added on every
 * `applySnapshot`. Every colour, size and gap comes from `view/theme` —
 * nothing is hard-coded here.
 *
 * The data comes from `LobbyFlow.openRecords()` (`GET /v1/records`), which
 * loads the `RecordsView`; the scene only renders it.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import { t } from '../../../core/game/i18n';
import type { MatchHistoryEntryView } from '../../../core/net/lobby_client';
import * as theme from '../view/theme';
import { createArtButton, createButtonEx, createCaption, createDivider, createPanel, type ButtonHandle } from './ui_kit';
import type { ShortcutAction, ShortcutScope } from '../../../core/input/shortcuts';
import type { ClientScene } from './scene';

export interface RecordsSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
  /**
   * Opens the `.dem` replay player for a match that has a downloadable
   * recording. `replayId` is the match id (the lobby's dem download route
   * accepts either a replay id or a match id); absent → no download buttons.
   */
  onOpenDemPlayer?: (replayId: string, label: string) => void;
}

/** Height of one summary row (one label + value line). */
const SUMMARY_ROW_HEIGHT = 30;
/** Height of one recent-match row (compact, one line). */
const RECENT_ROW_HEIGHT = 26;
/** Maximum recent matches rendered; the server caps the list at 20. */
const RECENT_LIMIT = 20;
/** Width of the per-row ".dem download" button. */
const DEM_BUTTON_WIDTH = 120;

export class RecordsScene implements ClientScene {
  readonly root: Laya.Sprite;
  readonly shortcutScope: ShortcutScope = 'records';

  private readonly width: number;
  private readonly statusText: Laya.Text;
  private readonly summaryHost: Laya.Sprite;
  private readonly recentHost: Laya.Sprite;
  private readonly recentCaption: Laya.Text;
  private readonly backButton: ButtonHandle;
  private readonly refreshButton: ButtonHandle;
  private busy = false;

  constructor(private readonly options: RecordsSceneOptions) {
    const { width, height } = options;
    this.width = width;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    // --- title band ---
    const title = this.makeText(t('ui.records'), theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    title.y = margin;
    this.root.addChild(title);
    this.root.addChild(createDivider(margin, title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    // --- summary block ---
    const summaryCaptionY = title.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    const summaryCaption = createCaption(t('records.career'), contentWidth, summaryCaptionY);
    summaryCaption.x = margin;
    this.root.addChild(summaryCaption);

    const summaryY = summaryCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_SM;
    this.summaryHost = new Laya.Sprite();
    this.summaryHost.pos(margin, summaryY);
    this.root.addChild(this.summaryHost);

    // --- recent matches block ---
    // Pinned just below the fixed-height summary grid so a long list cannot
    // push the action band off-screen.
    const summaryRows = 6;
    const recentCaptionY = summaryY + summaryRows * (SUMMARY_ROW_HEIGHT + theme.SPACE_XS) + theme.SPACE_MD;
    this.recentCaption = createCaption(t('records.recentMatches'), contentWidth, recentCaptionY);
    this.recentCaption.x = margin;
    this.root.addChild(this.recentCaption);

    const recentY = recentCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_SM;
    this.recentHost = new Laya.Sprite();
    this.recentHost.pos(margin, recentY);
    this.root.addChild(this.recentHost);

    // --- action band ---
    const actionsY = height - margin - theme.BUTTON_HEIGHT * 2 - theme.SPACE_MD;
    this.statusText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.statusText.y = actionsY - theme.FONT_SIZE_CAPTION - theme.SPACE_MD;
    this.statusText.width = contentWidth;
    this.statusText.wordWrap = true;
    this.statusText.leading = theme.SPACE_XS;
    this.root.addChild(this.statusText);

    this.refreshButton = createButtonEx(t('records.refresh'), margin, actionsY, contentWidth, () => void this.refresh());
    this.root.addChild(this.refreshButton.sprite);
    this.backButton = createArtButton(
      t('ui.backToLobby'),
      margin,
      actionsY + theme.BUTTON_HEIGHT + theme.SPACE_MD,
      contentWidth,
      () => this.options.flow.backToLobby(),
      'back',
      'ghost',
    );
    this.root.addChild(this.backButton.sprite);
  }

  onEnter(): void {
    this.root.visible = true;
    this.applySnapshot(this.options.flow.snapshot());
    void this.refresh();
  }

  onExit(): void {
    this.root.visible = false;
  }

  destroy(): void {
    this.root.destroy(true);
  }

  applySnapshot(snapshot: LobbyFlowSnapshot): void {
    if (snapshot.lastError !== '') {
      this.statusText.text = snapshot.lastError;
      this.statusText.color = theme.COLOR_DANGER;
    } else {
      this.statusText.text = snapshot.statusText;
      this.statusText.color = theme.COLOR_TEXT_MUTED;
    }
    const view = snapshot.records;
    this.rebuildSummary(view === null ? null : view);
    this.rebuildRecent(view === null ? [] : view.recent);
    this.refreshButton.setEnabled(!this.busy);
  }

  /** Repaints the two-column career summary; `null` shows a loading line. */
  private rebuildSummary(view: RecordsViewLike | null): void {
    this.summaryHost.removeChildren();
    const contentWidth = this.width - theme.SCREEN_MARGIN * 2;
    if (view === null) {
      this.summaryHost.addChild(this.emptyLine(t('records.loading'), 0));
      return;
    }
    const records = [
      [t('records.gold'), `${view.gold}`],
      [t('records.tickets'), `${view.tickets}`],
      [t('records.points'), `${view.points} (${view.ratingCode || '-'})`],
      [t('records.season'), view.seasonId || '-'],
      [t('records.matches'), `${view.matchesPlayed}`],
      [t('records.wld'), `${view.wins}-${view.losses}-${view.draws}`],
      [t('records.winRate'), `${(view.winRate * 100).toFixed(1)}%`],
      [t('records.bestScore'), `${view.bestScore}`],
      [t('records.averageScore'), `${view.averageScore.toFixed(1)}`],
      [t('records.grazeHit'), `${view.totalGraze} · ${view.totalHits}`],
      [t('records.damageCards'), `${view.totalDamageDealt} · ${view.totalCardPlays}`],
      [t('records.decksCards'), `${view.deckCount} · ${view.cardCount}`],
    ] as const;

    records.forEach(([label, value], index) => {
      const row = new Laya.Sprite();
      row.pos(0, index * (SUMMARY_ROW_HEIGHT + theme.SPACE_XS));
      row.size(contentWidth, SUMMARY_ROW_HEIGHT);
      row.addChild(createPanel(0, 0, contentWidth, SUMMARY_ROW_HEIGHT, { fill: theme.COLOR_PANEL_DEEP }));
      const labelText = this.makeText(label, contentWidth - theme.SPACE_MD * 2, theme.COLOR_TEXT_MUTED, false, theme.SPACE_MD);
      labelText.fontSize = theme.FONT_SIZE_CAPTION;
      labelText.y = (SUMMARY_ROW_HEIGHT - theme.FONT_SIZE_CAPTION) / 2;
      row.addChild(labelText);
      const valueText = this.makeText(value, contentWidth - theme.SPACE_MD * 2, theme.COLOR_TEXT, true, theme.SPACE_MD);
      valueText.fontSize = theme.FONT_SIZE_CAPTION;
      valueText.align = 'right';
      valueText.y = (SUMMARY_ROW_HEIGHT - theme.FONT_SIZE_CAPTION) / 2;
      row.addChild(valueText);
      this.summaryHost.addChild(row);
    });
  }

  /** Repaints the recent-match list (capped at {@link RECENT_LIMIT}). */
  private rebuildRecent(entries: MatchHistoryEntryView[]): void {
    this.recentHost.removeChildren();
    this.recentCaption.text = t('records.recentMatchesCount', { count: entries.length });
    if (entries.length === 0) {
      this.recentHost.addChild(this.emptyLine(t('records.noMatches'), 0));
      return;
    }
    const contentWidth = this.width - theme.SCREEN_MARGIN * 2;
    entries.slice(0, RECENT_LIMIT).forEach((entry, index) => {
      const row = new Laya.Sprite();
      row.pos(0, index * (RECENT_ROW_HEIGHT + theme.SPACE_XS));
      row.size(contentWidth, RECENT_ROW_HEIGHT);
      row.addChild(createPanel(0, 0, contentWidth, RECENT_ROW_HEIGHT, { fill: theme.COLOR_PANEL_DEEP }));

      const resultColor = resultColour(entry.result);
      const resultText = this.makeText(
        resultLabel(entry.result) || '-',
        theme.SPACE_XL,
        resultColor,
        true,
        theme.SPACE_SM,
      );
      resultText.fontSize = theme.FONT_SIZE_CAPTION;
      resultText.y = (RECENT_ROW_HEIGHT - theme.FONT_SIZE_CAPTION) / 2;
      row.addChild(resultText);

      const meta = this.makeText(
        formatRecentEntry(entry),
        contentWidth - theme.SPACE_XL - theme.SPACE_SM * 2 - (entry.hasDem ? DEM_BUTTON_WIDTH + theme.SPACE_SM : 0),
        theme.COLOR_TEXT,
        false,
        theme.SPACE_XL,
      );
      meta.fontSize = theme.FONT_SIZE_CAPTION;
      meta.y = (RECENT_ROW_HEIGHT - theme.FONT_SIZE_CAPTION) / 2;
      meta.overflow = 'hidden';
      row.addChild(meta);

      if (entry.hasDem && this.options.onOpenDemPlayer !== undefined) {
        const download = createButtonEx(
          t('ui.downloadDem'),
          contentWidth - DEM_BUTTON_WIDTH - theme.SPACE_SM,
          3,
          DEM_BUTTON_WIDTH,
          () => this.options.onOpenDemPlayer?.(entry.matchId, t('ui.matchLabel', { id: entry.matchId })),
          'ghost',
          RECENT_ROW_HEIGHT - 6,
        );
        row.addChild(download.sprite);
      }
      this.recentHost.addChild(row);
    });
  }

  private async refresh(): Promise<void> {
    this.busy = true;
    this.refreshButton.setEnabled(false);
    await this.options.flow.openRecords();
    this.busy = false;
    this.applySnapshot(this.options.flow.snapshot());
  }

  private emptyLine(text: string, y: number): Laya.Text {
    const label = this.makeText(text, this.width, theme.COLOR_TEXT_DISABLED, false, 0);
    label.fontSize = theme.FONT_SIZE_CAPTION;
    label.y = y;
    return label;
  }

  /**
   * Handles a records shortcut. Only `ui.back` maps onto a control; the list
   * has no selection and confirm (`ui.activate`) falls through to the app.
   */
  handleShortcut(action: ShortcutAction, _event: Laya.KeyboardEventLike): boolean {
    if (action === 'ui.back') {
      this.options.flow.backToLobby();
      return true;
    }
    return false;
  }

  /** Concise text factory: one place that sets font, weight, alignment and x. */
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

/** Structural subset of `RecordsView` the summary reads (keeps the scene decoupled). */
type RecordsViewLike = {
  gold: number;
  tickets: number;
  points: number;
  ratingCode: string;
  seasonId: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  bestScore: number;
  averageScore: number;
  totalGraze: number;
  totalHits: number;
  totalDamageDealt: number;
  totalCardPlays: number;
  deckCount: number;
  cardCount: number;
};

/** Colour for a `win` / `loss` / `draw` result chip. */
function resultColour(result: string): string {
  switch (result) {
    case 'win':
      return theme.COLOR_SUCCESS;
    case 'loss':
      return theme.COLOR_DANGER;
    case 'draw':
      return theme.COLOR_WARNING;
    default:
      return theme.COLOR_TEXT_MUTED;
  }
}

/** Chip label for a `win` / `loss` / `draw` result; unknown values pass through upper-cased. */
function resultLabel(result: string): string {
  switch (result) {
    case 'win':
      return t('records.result.win');
    case 'loss':
      return t('records.result.loss');
    case 'draw':
      return t('records.result.draw');
    default:
      return result.toUpperCase();
  }
}

/** `match abc123 · mvp_boss_race · 42s · 1200 pts · +12` */
export function formatRecentEntry(entry: MatchHistoryEntryView): string {
  const parts = [
    entry.matchId || '-',
    entry.modeId || '-',
    t('records.unit.seconds', { seconds: Math.round(entry.durationTicks / 60) }),
    t('records.unit.points', { points: entry.score }),
  ];
  if (entry.rankDelta !== 0) {
    parts.push(`${entry.rankDelta > 0 ? '+' : ''}${entry.rankDelta}`);
  }
  return parts.join(' · ');
}
