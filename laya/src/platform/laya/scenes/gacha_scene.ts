/**
 * Gacha screen: the two totem pools (cards + characters).
 *
 * Layout follows the shared three-band grid (title / content / actions). The
 * wallet strip shows gems / faith / card dust; a pool tab row switches between
 * the card totem and the character totem; the odds + pity lines mirror the
 * server pool table; the pull buttons call `flow.pullGacha` (the server owns
 * every roll) and the results band renders the last pull with rarity colours.
 * The roster strip summarises owned shots and offers the faith exchange
 * (150 faith → any locked shot).
 *
 * Design reference: Mahjong Soul's 寻觅 system, see
 * `/root/gotouhou/task-queue/out/T10_gacha_design.md`.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import type { GachaPoolView, GachaPullResultView, CharacterRosterView } from '../../../core/net/lobby_client';
import {
  GACHA_CARD_POOL_ID,
  GACHA_CHARACTER_POOL_ID,
  GACHA_TEN_COUNT,
  GACHA_FAITH_EXCHANGE_COST,
  GACHA_SINGLE_COST_GEMS,
  GACHA_TEN_COST_GEMS,
  gachaPercent,
  gachaPoolMirror,
  gachaWeightTotal,
  shotLabel,
  type GachaRarity,
} from '../../../core/game/gacha_model';
import { t } from '../../../core/game/i18n';
import * as theme from '../view/theme';
import { createButtonEx, createCaption, createDivider, createPanel, type ButtonHandle } from './ui_kit';
import type { ShortcutAction, ShortcutScope } from '../../../core/input/shortcuts';
import type { ClientScene } from './scene';

export interface GachaSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
}

/** Rarity colours (presentation only; not the stock-market convention). */
const RARITY_COLORS: Record<string, string> = {
  common: theme.COLOR_TEXT_MUTED,
  uncommon: theme.COLOR_SUCCESS,
  rare: theme.COLOR_INFO,
  epic: theme.COLOR_BOSS,
};

const RARITY_LABELS: Record<string, string> = {
  common: 'R',
  uncommon: 'SR',
  rare: 'SSR',
  epic: 'UR',
};

/** Height of one result row in the last-pull band. */
const RESULT_ROW_HEIGHT = 30;
/** Max rows rendered from one pull (a ten-pull shows all ten). */
const MAX_RESULT_ROWS = 10;
/** Locked shots offered in the faith exchange strip. */
const EXCHANGE_SLOTS = 6;

export class GachaScene implements ClientScene {
  readonly root: Laya.Sprite;
  readonly shortcutScope: ShortcutScope = 'gacha';

  private readonly width: number;
  private readonly walletText: Laya.Text;
  private readonly statusText: Laya.Text;
  private readonly poolTabHost: Laya.Sprite;
  private readonly poolInfoText: Laya.Text;
  private readonly pityText: Laya.Text;
  private readonly resultHost: Laya.Sprite;
  private readonly rosterText: Laya.Text;
  private readonly exchangeHost: Laya.Sprite;
  private readonly singleButton: ButtonHandle;
  private readonly tenButton: ButtonHandle;
  private readonly backButton: ButtonHandle;
  private busy = false;
  /** Active pool tab; character pool is the gacha-girls' default view. */
  private activePoolId: string = GACHA_CHARACTER_POOL_ID;
  private tabButtons: ButtonHandle[] = [];

  constructor(private readonly options: GachaSceneOptions) {
    const { width, height } = options;
    this.width = width;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    // --- title band ---
    const title = this.makeText(t('gacha.title'), theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    title.y = margin;
    this.root.addChild(title);
    this.root.addChild(createDivider(margin, title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    // --- wallet strip ---
    const walletY = title.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    this.root.addChild(createPanel(margin, walletY, contentWidth, 44, { fill: theme.COLOR_PANEL_DEEP }));
    this.walletText = this.makeText('—', theme.FONT_SIZE_BODY, theme.COLOR_ACCENT, true, margin + theme.SPACE_MD);
    this.walletText.y = walletY + theme.SPACE_SM;
    this.walletText.width = contentWidth - theme.SPACE_MD * 2;
    this.root.addChild(this.walletText);

    // --- pool tabs ---
    const tabY = walletY + 44 + theme.SPACE_SM;
    const tabCaption = createCaption(t('gacha.pools'), contentWidth, tabY);
    tabCaption.x = margin;
    this.root.addChild(tabCaption);
    this.poolTabHost = new Laya.Sprite();
    this.poolTabHost.pos(margin, tabY + theme.FONT_SIZE_CAPTION + theme.SPACE_XS);
    this.root.addChild(this.poolTabHost);

    // --- pool info (odds + pity) ---
    const infoY = this.poolTabHost.y + theme.BUTTON_HEIGHT + theme.SPACE_SM;
    this.poolInfoText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.poolInfoText.y = infoY;
    this.poolInfoText.width = contentWidth;
    this.poolInfoText.wordWrap = true;
    this.poolInfoText.leading = theme.SPACE_XS;
    this.root.addChild(this.poolInfoText);

    this.pityText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.pityText.y = infoY + theme.FONT_SIZE_CAPTION * 2 + theme.SPACE_SM;
    this.pityText.width = contentWidth;
    this.pityText.wordWrap = true;
    this.pityText.leading = theme.SPACE_XS;
    this.root.addChild(this.pityText);

    // --- last pull results ---
    const resultCaptionY = this.pityText.y + theme.FONT_SIZE_CAPTION * 2 + theme.SPACE_SM;
    const resultCaption = createCaption(t('gacha.lastPull'), contentWidth, resultCaptionY);
    resultCaption.x = margin;
    this.root.addChild(resultCaption);
    this.resultHost = new Laya.Sprite();
    this.resultHost.pos(margin, resultCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_XS);
    this.root.addChild(this.resultHost);

    // --- roster + faith exchange ---
    const rosterCaptionY = this.resultHost.y + RESULT_ROW_HEIGHT * MAX_RESULT_ROWS + theme.SPACE_SM;
    const rosterCaption = createCaption(t('gacha.roster'), contentWidth, rosterCaptionY);
    rosterCaption.x = margin;
    this.root.addChild(rosterCaption);
    this.rosterText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.rosterText.y = rosterCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_XS;
    this.rosterText.width = contentWidth;
    this.root.addChild(this.rosterText);
    this.exchangeHost = new Laya.Sprite();
    this.exchangeHost.pos(margin, this.rosterText.y + theme.FONT_SIZE_CAPTION + theme.SPACE_XS);
    this.root.addChild(this.exchangeHost);

    // --- action band ---
    const actionsY = height - margin - theme.BUTTON_HEIGHT;
    this.statusText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.statusText.y = actionsY - theme.SPACE_MD - theme.FONT_SIZE_CAPTION;
    this.statusText.width = contentWidth;
    this.statusText.wordWrap = true;
    this.statusText.leading = theme.SPACE_XS;
    this.root.addChild(this.statusText);

    const buttonWidth = (contentWidth - theme.SPACE_SM * 2) / 3;
    this.singleButton = createButtonEx(
      t('gacha.pullSingle', { cost: GACHA_SINGLE_COST_GEMS }),
      margin,
      actionsY,
      buttonWidth,
      () => void this.pull(1),
      'primary',
    );
    this.root.addChild(this.singleButton.sprite);
    this.tenButton = createButtonEx(
      t('gacha.pullTen', { cost: GACHA_TEN_COST_GEMS }),
      margin + buttonWidth + theme.SPACE_SM,
      actionsY,
      buttonWidth,
      () => void this.pull(GACHA_TEN_COUNT),
      'primary',
    );
    this.root.addChild(this.tenButton.sprite);
    this.backButton = createButtonEx(
      t('gacha.back'),
      margin + (buttonWidth + theme.SPACE_SM) * 2,
      actionsY,
      buttonWidth,
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
    if (snapshot.lastError !== '') {
      this.statusText.text = snapshot.lastError;
      this.statusText.color = theme.COLOR_DANGER;
    } else {
      this.statusText.text = snapshot.statusText;
      this.statusText.color = theme.COLOR_TEXT_MUTED;
    }
    const view = snapshot.gacha;
    if (view !== null) {
      this.applyPoolsView(view, snapshot.gachaRoster, snapshot.gachaLastPull);
    }
  }

  handleShortcut(action: ShortcutAction, _event: Laya.KeyboardEventLike): boolean {
    switch (action) {
      case 'ui.next':
        this.switchPool(1);
        return true;
      case 'ui.prev':
        this.switchPool(-1);
        return true;
      case 'ui.activate':
        void this.pull(1);
        return true;
      case 'ui.back':
        this.options.flow.backToLobby();
        return true;
      default:
        return false;
    }
  }

  /** Rebuilds the tabs, odds, pity, results, roster and exchange strip. */
  private applyPoolsView(
    view: NonNullable<LobbyFlowSnapshot['gacha']>,
    roster: CharacterRosterView | null,
    lastPull: LobbyFlowSnapshot['gachaLastPull'],
  ): void {
    const pools = view.pools;
    if (pools.length === 0) {
      return;
    }
    if (!pools.some((pool) => pool.poolId === this.activePoolId)) {
      this.activePoolId = pools[0].poolId;
    }
    this.rebuildTabs(pools);
    const active = pools.find((pool) => pool.poolId === this.activePoolId);
    if (active === undefined) {
      return;
    }
    this.poolInfoText.text = this.poolOddsLine(active);
    this.pityText.text = this.pityLine(active, view.pityCounters);
    this.walletText.text = this.walletLine(view.wallet, view.faith);
    this.rebuildResults(lastPull);
    this.rebuildRoster(roster);
  }

  private rebuildTabs(pools: GachaPoolView[]): void {
    this.poolTabHost.removeChildren();
    this.tabButtons = [];
    const buttonWidth = (this.width - theme.SCREEN_MARGIN * 2 - theme.SPACE_SM) / Math.max(pools.length, 1);
    pools.forEach((pool, index) => {
      const label = pool.poolId === GACHA_CARD_POOL_ID ? t('gacha.pool.cards') : t('gacha.pool.characters');
      const button = createButtonEx(
        label,
        index * (buttonWidth + theme.SPACE_SM),
        0,
        buttonWidth,
        () => {
          this.activePoolId = pool.poolId;
          this.applySnapshot(this.options.flow.snapshot());
        },
        pool.poolId === this.activePoolId ? 'primary' : 'ghost',
      );
      this.poolTabHost.addChild(button.sprite);
      this.tabButtons.push(button);
    });
  }

  private poolOddsLine(pool: GachaPoolView): string {
    const mirror = gachaPoolMirror(pool.poolId);
    if (mirror === null) {
      return `${pool.name} · odds server-owned`;
    }
    const total = gachaWeightTotal(mirror.weights);
    const order: GachaRarity[] = ['common', 'uncommon', 'rare', 'epic'];
    const odds = order
      .map((rarity) => `${RARITY_LABELS[rarity]} ${gachaPercent(mirror.weights[rarity], total)}`)
      .join(' · ');
    const kindLine = pool.kind === 'character' ? t('gacha.kind.characters') : t('gacha.kind.cards');
    return [
      t('gacha.odds', { kind: kindLine, odds }),
      t('gacha.costLine', { single: pool.costGems, ten: pool.costTenGems }),
    ].join('\n');
  }

  private pityLine(
    pool: GachaPoolView,
    counters: Record<string, { rareCounter: number; epicCounter: number }>,
  ): string {
    const mirror = gachaPoolMirror(pool.poolId);
    if (mirror === null) {
      return '';
    }
    const counter = counters[pool.poolId];
    const rareLeft = Math.max(mirror.pity.rareEvery - (counter?.rareCounter ?? 0), 0);
    const epicLeft = Math.max(mirror.pity.epicEvery - (counter?.epicCounter ?? 0), 0);
    return t('gacha.pity', { rare: rareLeft, epic: epicLeft });
  }

  private walletLine(wallet: Record<string, number>, faith: number): string {
    const gems = wallet['gems'] ?? 0;
    const dust = wallet['card_dust'] ?? 0;
    return t('gacha.wallet', { gems, faith, dust });
  }

  private rebuildResults(lastPull: LobbyFlowSnapshot['gachaLastPull']): void {
    this.resultHost.removeChildren();
    if (lastPull === null || lastPull.results.length === 0) {
      const empty = this.makeText(t('gacha.noPulls'), this.width, theme.COLOR_TEXT_DISABLED, false, 0);
      empty.fontSize = theme.FONT_SIZE_CAPTION;
      this.resultHost.addChild(empty);
      return;
    }
    lastPull.results.slice(0, MAX_RESULT_ROWS).forEach((result, index) => {
      this.resultHost.addChild(
        this.buildResultRow(result, index * (RESULT_ROW_HEIGHT + theme.SPACE_XS)).sprite,
      );
    });
  }

  private buildResultRow(result: GachaPullResultView, y: number): { sprite: Laya.Sprite } {
    const row = new Laya.Sprite();
    row.pos(0, y);
    const width = this.width - theme.SCREEN_MARGIN * 2;
    const color = RARITY_COLORS[result.rarity] ?? theme.COLOR_TEXT;
    row.addChild(createPanel(0, 0, width, RESULT_ROW_HEIGHT, { fill: theme.COLOR_PANEL_DEEP }));
    const label = this.resultLabel(result);
    const text = this.makeText(label, theme.FONT_SIZE_CAPTION, color, result.rarity === 'epic', theme.SPACE_SM);
    text.y = (RESULT_ROW_HEIGHT - theme.FONT_SIZE_CAPTION) / 2;
    text.width = width - theme.SPACE_SM * 2;
    text.overflow = 'hidden';
    row.addChild(text);
    return { sprite: row };
  }

  private resultLabel(result: GachaPullResultView): string {
    const rarity = RARITY_LABELS[result.rarity] ?? result.rarity;
    if (result.kind === 'character') {
      const name = shotLabel(result.shotId);
      if (result.isNew) {
        return t('gacha.result.new', { rarity, name });
      }
      return t('gacha.result.dupeFaith', { rarity, name, faith: result.faithGained });
    }
    if (result.isNew) {
      return t('gacha.result.new', { rarity, name: result.cardId });
    }
    return t('gacha.result.dupeDust', { rarity, name: result.cardId, dust: result.dust });
  }

  private rebuildRoster(roster: CharacterRosterView | null): void {
    if (roster === null) {
      this.rosterText.text = 'Roster loading…';
      this.exchangeHost.removeChildren();
      return;
    }
    this.rosterText.text =
      t('gacha.rosterLine', {
        owned: roster.shots.length,
        faith: roster.faith,
        cost: roster.exchangeCostFaith || GACHA_FAITH_EXCHANGE_COST,
      });
    this.rebuildExchange(roster);
  }

  private rebuildExchange(roster: CharacterRosterView): void {
    this.exchangeHost.removeChildren();
    const locked = roster.lockedShotIds;
    if (locked.length === 0) {
      const done = this.makeText(t('gacha.allUnlocked'), this.width, theme.COLOR_SUCCESS, false, 0);
      done.fontSize = theme.FONT_SIZE_CAPTION;
      this.exchangeHost.addChild(done);
      return;
    }
    const affordable = roster.faith >= GACHA_FAITH_EXCHANGE_COST;
    const caption = this.makeText(
      affordable
        ? t('gacha.exchangePick', { cost: GACHA_FAITH_EXCHANGE_COST })
        : t('gacha.exchangeNeed', { cost: GACHA_FAITH_EXCHANGE_COST, faith: roster.faith }),
      this.width,
      affordable ? theme.COLOR_TEXT_MUTED : theme.COLOR_TEXT_DISABLED,
      false,
      0,
    );
    caption.fontSize = theme.FONT_SIZE_CAPTION;
    this.exchangeHost.addChild(caption);
    if (!affordable) {
      return;
    }
    const buttonWidth = (this.width - theme.SCREEN_MARGIN * 2 - theme.SPACE_SM * 2) / 3;
    locked.slice(0, EXCHANGE_SLOTS).forEach((shotId, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const rarity = gachaEntryRarity(shotId);
      const button = createButtonEx(
        `${RARITY_LABELS[rarity] ?? rarity} ${shotLabel(shotId)}`,
        col * (buttonWidth + theme.SPACE_SM),
        theme.FONT_SIZE_CAPTION + theme.SPACE_XS + row * (theme.BUTTON_HEIGHT + theme.SPACE_SM),
        buttonWidth,
        () => void this.exchange(shotId),
        'ghost',
      );
      this.exchangeHost.addChild(button.sprite);
    });
  }

  private async reload(): Promise<void> {
    if (this.options.flow.snapshot().gacha !== null) {
      return;
    }
    this.busy = true;
    await this.options.flow.openGacha();
    this.busy = false;
  }

  private switchPool(direction: number): void {
    const pools = this.options.flow.snapshot().gacha?.pools ?? [];
    if (pools.length < 2) {
      return;
    }
    const index = pools.findIndex((pool) => pool.poolId === this.activePoolId);
    const next = (index + direction + pools.length) % pools.length;
    this.activePoolId = pools[next].poolId;
    this.applySnapshot(this.options.flow.snapshot());
  }

  private async pull(count: number): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.refreshButtons();
    try {
      await this.options.flow.pullGacha(this.activePoolId, count);
    } finally {
      this.busy = false;
      this.refreshButtons();
    }
  }

  private async exchange(shotId: string): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.refreshButtons();
    try {
      await this.options.flow.exchangeGachaFaith(shotId);
    } finally {
      this.busy = false;
      this.refreshButtons();
    }
  }

  private refreshButtons(): void {
    const gems = this.options.flow.snapshot().gacha?.wallet['gems'] ?? 0;
    this.singleButton.setEnabled(!this.busy && gems >= GACHA_SINGLE_COST_GEMS);
    this.tenButton.setEnabled(!this.busy && gems >= GACHA_TEN_COST_GEMS);
    this.backButton.setEnabled(!this.busy);
    for (const tab of this.tabButtons) {
      tab.setEnabled(!this.busy);
    }
  }

  /** Concise text factory: one place that sets font, weight, alignment and x. */
  private makeText(text: string, size: number, color: string, bold: boolean, x: number): Laya.Text {
    const label = new Laya.Text();
    label.text = text;
    label.fontSize = size;
    label.color = color;
    label.bold = bold;
    label.width = this.width;
    label.x = x;
    return label;
  }
}

/** Rarity of a shot id, from the client mirror (presentation only). */
function gachaEntryRarity(shotId: string): string {
  const match = /^[A-Za-z]+([AB])([12])$/.exec(shotId);
  if (match === null) {
    return 'common';
  }
  const mode = match[1];
  const variant = Number(match[2]);
  if (mode === 'A') {
    return variant <= 1 ? 'common' : 'uncommon';
  }
  return variant <= 1 ? 'rare' : 'epic';
}
