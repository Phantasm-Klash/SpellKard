/**
 * Check-in screen: the 7-day reward cycle with one claim button.
 *
 * Layout follows the shared three-band grid (title / content / actions): a
 * `SCREEN_MARGIN` outer gutter, a title band with the streak line, a grid of
 * seven day cells (three colour states: claimed / claimable / locked), and the
 * two full-width buttons at the bottom. Every colour, size and gap comes from
 * `view/theme` — nothing is hard-coded here.
 *
 * The grid is fixed at `CHECKIN_CYCLE_DAYS` cells; the server always returns
 * exactly one cycle, but the scene tolerates a short list by leaving the
 * missing cells in the locked state.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import type { CheckinDayView } from '../../../core/net/lobby_client';
import * as theme from '../view/theme';
import { VectorPainter, mix } from '../view/sprites';
import { createButtonEx, createCaption, createDivider, createPanel, type ButtonHandle } from './ui_kit';
import type { ClientScene } from './scene';

export interface CheckinSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
}

/** Days per check-in cycle; the server contract fixes this at 7. */
const CHECKIN_CYCLE_DAYS = 7;
/** Day cells per row; 4 + 3 keeps each cell wide enough for a reward line. */
const CELLS_PER_ROW = 4;
const CELL_HEIGHT = 78;

interface DayCell {
  readonly sprite: Laya.Sprite;
  readonly dayText: Laya.Text;
  readonly rewardText: Laya.Text;
  readonly stateText: Laya.Text;
}

export class CheckinScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly streakText: Laya.Text;
  private readonly statusText: Laya.Text;
  private readonly cellHost: Laya.Sprite;
  private readonly cells: DayCell[] = [];
  private readonly claimButton: ButtonHandle;
  private readonly backButton: ButtonHandle;
  private readonly cellWidth: number;
  private busy = false;

  constructor(private readonly options: CheckinSceneOptions) {
    const { width, height } = options;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    // --- title band ---
    const title = this.makeText('Check-in', theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    title.y = margin;
    this.root.addChild(title);
    this.root.addChild(createDivider(margin, title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    const streakY = title.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    const streakPanel = createPanel(margin, streakY, contentWidth, 64, { fill: theme.COLOR_PANEL_DEEP });
    this.root.addChild(streakPanel);
    this.streakText = this.makeText('—', theme.FONT_SIZE_HEADING, theme.COLOR_ACCENT, true, margin + theme.SPACE_MD);
    this.streakText.y = streakY + theme.SPACE_SM;
    this.streakText.width = contentWidth - theme.SPACE_MD * 2;
    this.root.addChild(this.streakText);

    this.statusText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin + theme.SPACE_MD);
    this.statusText.y = streakY + 38;
    this.statusText.width = contentWidth - theme.SPACE_MD * 2;
    this.statusText.wordWrap = true;
    this.statusText.leading = theme.SPACE_XS;
    this.root.addChild(this.statusText);

    // --- cycle grid ---
    const gridCaptionY = streakY + 64 + theme.SPACE_MD;
    const gridCaption = createCaption('This cycle', contentWidth, gridCaptionY);
    gridCaption.x = margin;
    this.root.addChild(gridCaption);

    const gridY = gridCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_SM;
    const gap = theme.SPACE_SM;
    this.cellWidth = Math.floor((contentWidth - gap * (CELLS_PER_ROW - 1)) / CELLS_PER_ROW);
    this.cellHost = new Laya.Sprite();
    this.cellHost.pos(margin, gridY);
    this.root.addChild(this.cellHost);

    for (let index = 0; index < CHECKIN_CYCLE_DAYS; index += 1) {
      this.cells.push(this.buildCell(index));
    }

    // --- action band ---
    const actionsY = height - margin - theme.BUTTON_HEIGHT * 2 - theme.SPACE_MD;
    this.claimButton = createButtonEx('Claim', margin, actionsY, contentWidth, () => void this.claim());
    this.root.addChild(this.claimButton.sprite);
    this.backButton = createButtonEx(
      'Back to lobby',
      margin,
      actionsY + theme.BUTTON_HEIGHT + theme.SPACE_MD,
      contentWidth,
      () => this.options.flow.backToLobby(),
      'ghost',
    );
    this.root.addChild(this.backButton.sprite);
  }

  onEnter(): void {
    this.root.visible = true;
    this.applySnapshot(this.options.flow.snapshot());
    void this.reload();
  }

  onExit(): void {
    this.root.visible = false;
  }

  destroy(): void {
    this.root.destroy(true);
  }

  applySnapshot(snapshot: LobbyFlowSnapshot): void {
    const view = snapshot.checkin;
    if (view === null) {
      this.streakText.text = '—';
      this.statusText.text = snapshot.lastError === '' ? 'Loading check-in…' : snapshot.lastError;
      this.statusText.color = snapshot.lastError === '' ? theme.COLOR_TEXT_MUTED : theme.COLOR_DANGER;
      this.renderDays([]);
      this.claimButton.setEnabled(false);
      return;
    }
    this.streakText.text = `${view.streak}-day streak · ${view.cycleId}`;
    this.streakText.color = theme.COLOR_ACCENT;
    if (snapshot.lastError !== '') {
      this.statusText.text = snapshot.lastError;
      this.statusText.color = theme.COLOR_DANGER;
    } else {
      this.statusText.text = `${snapshot.statusText} · next day ${view.nextClaimableDay || '-'}`;
      this.statusText.color = theme.COLOR_TEXT_MUTED;
    }
    this.renderDays(view.days);
    const claimable = view.days.find((day) => day.claimable) !== undefined;
    this.claimButton.setEnabled(claimable && !this.busy);
    this.claimButton.setText(claimable ? 'Claim today' : 'Already claimed');
  }

  /** Builds one fixed day cell; only its paint changes per snapshot. */
  private buildCell(index: number): DayCell {
    const column = index % CELLS_PER_ROW;
    const row = Math.floor(index / CELLS_PER_ROW);
    const x = column * (this.cellWidth + theme.SPACE_SM);
    const y = row * (CELL_HEIGHT + theme.SPACE_SM);

    const sprite = new Laya.Sprite();
    sprite.pos(x, y);
    sprite.size(this.cellWidth, CELL_HEIGHT);

    const dayText = this.makeText(`Day ${index + 1}`, this.cellWidth, theme.COLOR_TITLE, true, 0);
    dayText.fontSize = theme.FONT_SIZE_CAPTION;
    dayText.y = theme.SPACE_SM;
    sprite.addChild(dayText);

    const rewardText = this.makeText('', this.cellWidth, theme.COLOR_TEXT, false, 0);
    rewardText.fontSize = theme.FONT_SIZE_CAPTION;
    rewardText.y = theme.SPACE_SM + theme.FONT_SIZE_CAPTION + theme.SPACE_XS;
    sprite.addChild(rewardText);

    const stateText = this.makeText('', this.cellWidth, theme.COLOR_TEXT_MUTED, true, 0);
    stateText.fontSize = theme.FONT_SIZE_CAPTION;
    stateText.y = CELL_HEIGHT - theme.SPACE_LG;
    sprite.addChild(stateText);

    this.cellHost.addChild(sprite);
    return { sprite, dayText, rewardText, stateText };
  }

  /** Repaints every cell from the (possibly short) day list. */
  private renderDays(days: CheckinDayView[]): void {
    for (let index = 0; index < this.cells.length; index += 1) {
      const cell = this.cells[index];
      const view = days.find((day) => day.day === index + 1) ?? days[index];
      const state = cellState(view);
      this.paintCell(cell, state.fill, state.border);
      if (view === undefined) {
        cell.rewardText.text = '—';
        cell.stateText.text = 'LOCKED';
        cell.stateText.color = theme.COLOR_TEXT_DISABLED;
        continue;
      }
      cell.rewardText.text = formatReward(view.reward);
      cell.stateText.text = state.label;
      cell.stateText.color = state.labelColor;
    }
  }

  private paintCell(cell: DayCell, fill: string, border: string): void {
    const g = cell.sprite.graphics;
    g.clear();
    VectorPainter.roundedPanel(g, 0, 0, this.cellWidth, CELL_HEIGHT, theme.RADIUS_SM, fill, border, 2);
  }

  private async reload(): Promise<void> {
    if (this.options.flow.snapshot().checkin !== null) {
      return;
    }
    this.busy = true;
    await this.options.flow.openCheckin();
    this.busy = false;
  }

  private async claim(): Promise<void> {
    this.busy = true;
    this.claimButton.setEnabled(false);
    await this.options.flow.claimCheckin();
    this.busy = false;
    this.applySnapshot(this.options.flow.snapshot());
  }

  /** Concise text factory: one place that sets font, weight, alignment and x. */
  private makeText(text: string, width: number, color: string, bold: boolean, x: number): Laya.Text {
    const label = new Laya.Text();
    label.text = text;
    label.fontSize = theme.FONT_SIZE_LABEL;
    label.color = color;
    label.bold = bold;
    label.align = 'center';
    label.width = width;
    label.x = x;
    return label;
  }
}

interface CellState {
  fill: string;
  border: string;
  label: string;
  labelColor: string;
}

/** Maps a day's flags onto the three-state cell palette. */
function cellState(day: CheckinDayView | undefined): CellState {
  if (day === undefined) {
    return {
      fill: theme.COLOR_PANEL_DEEP,
      border: theme.COLOR_DIVIDER,
      label: 'LOCKED',
      labelColor: theme.COLOR_TEXT_DISABLED,
    };
  }
  if (day.claimed) {
    return {
      fill: mix(theme.COLOR_PANEL, theme.COLOR_SUCCESS, 0.22),
      border: theme.COLOR_SUCCESS,
      label: 'CLAIMED',
      labelColor: theme.COLOR_SUCCESS,
    };
  }
  if (day.claimable) {
    return {
      fill: mix(theme.COLOR_PANEL, theme.COLOR_ACCENT, 0.28),
      border: theme.COLOR_ACCENT,
      label: 'CLAIM',
      labelColor: theme.COLOR_ACCENT,
    };
  }
  return {
    fill: theme.COLOR_PANEL_DEEP,
    border: theme.COLOR_DIVIDER,
    label: 'LOCKED',
    labelColor: theme.COLOR_TEXT_DISABLED,
  };
}

/** `{ gold: 200, ticket: 1 }` → `200 gold · 1 ticket`; empty bags render `—`. */
export function formatReward(reward: Record<string, number>): string {
  const parts = Object.entries(reward)
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => `${amount} ${currency}`);
  return parts.length === 0 ? '—' : parts.join(' · ');
}
