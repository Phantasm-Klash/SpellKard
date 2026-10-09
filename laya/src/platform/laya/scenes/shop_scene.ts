/**
 * Shop screen: the wallet balance plus one buy row per listing.
 *
 * Layout follows the shared three-band grid (title / content / actions): a
 * `SCREEN_MARGIN` outer gutter, a title band, a wallet strip, then a scroll-free
 * list of item rows rebuilt per snapshot. Each row shows name / description /
 * price / stock and carries its own buy button, disabled when the item is not
 * `purchasable` (out of stock or unaffordable). Every colour, size and gap
 * comes from `view/theme` — nothing is hard-coded here.
 *
 * The list is dynamic, so the rows live in a dedicated container that is cleared
 * and re-added on every `applySnapshot`.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import type { ShopItemView } from '../../../core/net/lobby_client';
import * as theme from '../view/theme';
import { createButtonEx, createCaption, createDivider, createPanel, type ButtonHandle } from './ui_kit';
import type { ClientScene } from './scene';

export interface ShopSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
}

/** One listing row. */
const ROW_HEIGHT = 88;
/** Width reserved on the right of a row for the buy button. */
const BUY_BUTTON_WIDTH = 88;

export class ShopScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly width: number;
  private readonly walletText: Laya.Text;
  private readonly statusText: Laya.Text;
  private readonly listHost: Laya.Sprite;
  private readonly listBottom: number;
  private readonly backButton: ButtonHandle;
  private busy = false;

  constructor(private readonly options: ShopSceneOptions) {
    const { width, height } = options;
    this.width = width;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    // --- title band ---
    const title = this.makeText('Shop', theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    title.y = margin;
    this.root.addChild(title);
    this.root.addChild(createDivider(margin, title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    // --- wallet strip ---
    const walletY = title.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    this.root.addChild(createPanel(margin, walletY, contentWidth, 48, { fill: theme.COLOR_PANEL_DEEP }));
    const walletCaption = createCaption('Wallet', contentWidth - theme.SPACE_MD * 2, walletY + theme.SPACE_XS);
    walletCaption.x = margin + theme.SPACE_MD;
    this.root.addChild(walletCaption);
    this.walletText = this.makeText('—', theme.FONT_SIZE_BODY, theme.COLOR_ACCENT, true, margin + theme.SPACE_MD);
    this.walletText.y = walletY + theme.SPACE_LG;
    this.walletText.width = contentWidth - theme.SPACE_MD * 2;
    this.root.addChild(this.walletText);

    // --- listing band ---
    const listCaptionY = walletY + 48 + theme.SPACE_MD;
    const listCaption = createCaption('Items', contentWidth, listCaptionY);
    listCaption.x = margin;
    this.root.addChild(listCaption);

    const listY = listCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_SM;
    this.listHost = new Laya.Sprite();
    this.listHost.pos(margin, listY);
    this.root.addChild(this.listHost);

    // --- action band ---
    const actionsY = height - margin - theme.BUTTON_HEIGHT;
    // Reserve a full caption row (text height + a gap) above the button, so the
    // status line is never clipped or overlapped by the back button.
    this.listBottom = actionsY - theme.SPACE_MD - theme.FONT_SIZE_CAPTION;

    this.statusText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.statusText.y = this.listBottom + theme.SPACE_XS;
    this.statusText.width = contentWidth;
    this.statusText.wordWrap = true;
    this.statusText.leading = theme.SPACE_XS;
    this.root.addChild(this.statusText);

    this.backButton = createButtonEx(
      'Back to lobby',
      margin,
      actionsY,
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
    const view = snapshot.shop;
    if (snapshot.lastError !== '') {
      this.statusText.text = snapshot.lastError;
      this.statusText.color = theme.COLOR_DANGER;
    } else {
      this.statusText.text = snapshot.statusText;
      this.statusText.color = theme.COLOR_TEXT_MUTED;
    }
    if (view === null) {
      this.walletText.text = '—';
      this.rebuildItems([]);
      return;
    }
    this.walletText.text = formatAmounts(view.wallet);
    this.rebuildItems(view.items);
  }

  /** Clears and rebuilds one row per listing. */
  private rebuildItems(items: ShopItemView[]): void {
    this.listHost.removeChildren();
    if (items.length === 0) {
      const empty = this.makeText('No listings', this.width, theme.COLOR_TEXT_DISABLED, false, 0);
      empty.fontSize = theme.FONT_SIZE_BODY;
      this.listHost.addChild(empty);
      return;
    }
    const contentWidth = this.width - theme.SCREEN_MARGIN * 2;
    items.forEach((item, index) => {
      this.listHost.addChild(this.buildRow(item, index * (ROW_HEIGHT + theme.SPACE_SM), contentWidth).sprite);
    });
  }

  /** One listing row: panel, two text lines, price caption and buy button. */
  private buildRow(item: ShopItemView, y: number, width: number): { sprite: Laya.Sprite } {
    const row = new Laya.Sprite();
    row.pos(0, y);
    row.size(width, ROW_HEIGHT);
    row.addChild(createPanel(0, 0, width, ROW_HEIGHT, { fill: theme.COLOR_PANEL_DEEP }));

    const name = this.makeText(item.name || item.itemId, width - theme.SPACE_MD * 2, theme.COLOR_TITLE, true, theme.SPACE_MD);
    name.fontSize = theme.FONT_SIZE_LABEL;
    name.y = theme.SPACE_SM;
    name.width = width - theme.SPACE_MD * 2 - BUY_BUTTON_WIDTH;
    name.overflow = 'hidden';
    row.addChild(name);

    const description = this.makeText(
      item.description,
      width - theme.SPACE_MD * 2,
      theme.COLOR_TEXT_MUTED,
      false,
      theme.SPACE_MD,
    );
    description.fontSize = theme.FONT_SIZE_CAPTION;
    description.y = theme.SPACE_SM + theme.FONT_SIZE_LABEL + theme.SPACE_XS;
    description.width = width - theme.SPACE_MD * 2 - BUY_BUTTON_WIDTH;
    description.wordWrap = true;
    description.leading = theme.SPACE_XS;
    row.addChild(description);

    const stock = item.stock < 0 ? 'unlimited' : `stock ${item.stock}`;
    const meta = this.makeText(
      `Price ${formatAmounts(item.price)} · ${stock} · bought ${item.purchased}`,
      width - theme.SPACE_MD * 2,
      theme.COLOR_TEXT_MUTED,
      false,
      theme.SPACE_MD,
    );
    meta.fontSize = theme.FONT_SIZE_CAPTION;
    meta.y = ROW_HEIGHT - theme.SPACE_LG;
    meta.width = width - theme.SPACE_MD * 2 - BUY_BUTTON_WIDTH;
    row.addChild(meta);

    const buy = createButtonEx(
      'Buy',
      width - BUY_BUTTON_WIDTH - theme.SPACE_MD,
      (ROW_HEIGHT - theme.BUTTON_HEIGHT) / 2,
      BUY_BUTTON_WIDTH,
      () => void this.buy(item.itemId),
      'primary',
      theme.BUTTON_HEIGHT,
    );
    buy.setEnabled(item.purchasable && !this.busy);
    row.addChild(buy.sprite);

    return { sprite: row };
  }

  private async reload(): Promise<void> {
    if (this.options.flow.snapshot().shop !== null) {
      return;
    }
    this.busy = true;
    await this.options.flow.openShop();
    this.busy = false;
  }

  private async buy(itemId: string): Promise<void> {
    this.busy = true;
    this.applySnapshot(this.options.flow.snapshot());
    await this.options.flow.purchaseItem(itemId, 1);
    this.busy = false;
    this.applySnapshot(this.options.flow.snapshot());
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

/** `{ gold: 700, ticket: 1 }` → `700 gold · 1 ticket`; empty bags render `—`. */
export function formatAmounts(amounts: Record<string, number>): string {
  const parts = Object.entries(amounts)
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => `${amount} ${currency}`);
  return parts.length === 0 ? '—' : parts.join(' · ');
}
