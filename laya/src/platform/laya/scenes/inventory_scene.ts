/**
 * Inventory screen: owned card stacks and openable chest pools.
 *
 * Layout follows the shared three-band grid (title / content / actions): a
 * `SCREEN_MARGIN` outer gutter, a title band, a card-stack list, then a chest
 * list where each enabled pool gets its own "Open" button. Both lists are
 * dynamic, so they live in dedicated containers that are cleared and re-added on
 * every `applySnapshot`. Every colour, size and gap comes from `view/theme` —
 * nothing is hard-coded here.
 *
 * The screen shows *two* reads in one place (`/v1/inventory` and `/v1/chests`);
 * `LobbyFlow.openInventory()` only loads the card stacks, so the chest list is
 * loaded here on enter and kept in a local field.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import type { ChestPoolView, InventoryEntryView } from '../../../core/net/lobby_client';
import * as theme from '../view/theme';
import { createButtonEx, createCaption, createDivider, createPanel, type ButtonHandle } from './ui_kit';
import type { ClientScene } from './scene';

export interface InventorySceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
}

/** Height of one card-stack row (dense: one line of text). */
const ITEM_ROW_HEIGHT = 40;
/** Height of one chest row (two lines plus an open button). */
const CHEST_ROW_HEIGHT = 64;
/** Width reserved on the right of a chest row for its open button. */
const OPEN_BUTTON_WIDTH = 84;
/** Maximum rows rendered per list; anything beyond is summarised as `+N more`. */
const MAX_ROWS = 6;

export class InventoryScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly width: number;
  private readonly statusText: Laya.Text;
  private readonly itemHost: Laya.Sprite;
  private readonly chestHost: Laya.Sprite;
  private readonly chestsCaption: Laya.Text;
  private readonly backButton: ButtonHandle;
  private pools: ChestPoolView[] = [];
  private ownedChests: Record<string, number> = {};
  private chestsLoaded = false;
  private busy = false;

  constructor(private readonly options: InventorySceneOptions) {
    const { width, height } = options;
    this.width = width;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    // --- title band ---
    const title = this.makeText('Inventory', theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    title.y = margin;
    this.root.addChild(title);
    this.root.addChild(createDivider(margin, title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    // --- card stacks ---
    const itemsCaptionY = title.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    const itemsCaption = createCaption('Cards', contentWidth, itemsCaptionY);
    itemsCaption.x = margin;
    this.root.addChild(itemsCaption);

    const itemsY = itemsCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_SM;
    this.itemHost = new Laya.Sprite();
    this.itemHost.pos(margin, itemsY);
    this.root.addChild(this.itemHost);

    // --- chest pools ---
    // The card list is capped at MAX_ROWS; pin the chest band just below it so
    // a long inventory cannot push the chest buttons off-screen.
    const chestCaptionY = itemsY + MAX_ROWS * (ITEM_ROW_HEIGHT + theme.SPACE_XS) + theme.SPACE_MD;
    this.chestsCaption = createCaption('Chests', contentWidth, chestCaptionY);
    this.chestsCaption.x = margin;
    this.root.addChild(this.chestsCaption);

    const chestY = chestCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_SM;
    this.chestHost = new Laya.Sprite();
    this.chestHost.pos(margin, chestY);
    this.root.addChild(this.chestHost);

    // --- action band ---
    const actionsY = height - margin - theme.BUTTON_HEIGHT;
    this.statusText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.statusText.y = actionsY - theme.FONT_SIZE_CAPTION - theme.SPACE_MD;
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
    if (snapshot.lastError !== '') {
      this.statusText.text = snapshot.lastError;
      this.statusText.color = theme.COLOR_DANGER;
    } else {
      this.statusText.text = snapshot.statusText;
      this.statusText.color = theme.COLOR_TEXT_MUTED;
    }
    const view = snapshot.inventory;
    this.rebuildItems(view === null ? [] : view.items);
    this.rebuildChests();
  }

  /** Repaints the card-stack list (capped at `MAX_ROWS`). */
  private rebuildItems(items: InventoryEntryView[]): void {
    this.itemHost.removeChildren();
    if (items.length === 0) {
      this.itemHost.addChild(this.emptyLine('No cards', 0));
      return;
    }
    const contentWidth = this.width - theme.SCREEN_MARGIN * 2;
    items.slice(0, MAX_ROWS).forEach((item, index) => {
      const y = index * (ITEM_ROW_HEIGHT + theme.SPACE_XS);
      const row = new Laya.Sprite();
      row.pos(0, y);
      row.size(contentWidth, ITEM_ROW_HEIGHT);
      row.addChild(createPanel(0, 0, contentWidth, ITEM_ROW_HEIGHT, { fill: theme.COLOR_PANEL_DEEP }));
      const label = this.makeText(
        item.cardId || '—',
        contentWidth - theme.SPACE_MD * 2 - 160,
        theme.COLOR_TEXT,
        false,
        theme.SPACE_MD,
      );
      label.fontSize = theme.FONT_SIZE_CAPTION;
      label.y = (ITEM_ROW_HEIGHT - theme.FONT_SIZE_CAPTION) / 2;
      label.overflow = 'hidden';
      row.addChild(label);
      const meta = this.makeText(
        `Lv ${item.level} · ×${item.copies}`,
        contentWidth - theme.SPACE_MD * 2,
        theme.COLOR_ACCENT,
        true,
        theme.SPACE_MD,
      );
      meta.fontSize = theme.FONT_SIZE_CAPTION;
      meta.align = 'right';
      meta.y = (ITEM_ROW_HEIGHT - theme.FONT_SIZE_CAPTION) / 2;
      row.addChild(meta);
      this.itemHost.addChild(row);
    });
    if (items.length > MAX_ROWS) {
      this.itemHost.addChild(this.emptyLine(`+${items.length - MAX_ROWS} more`, MAX_ROWS * (ITEM_ROW_HEIGHT + theme.SPACE_XS)));
    }
  }

  /** Repaints the chest list: one row per pool, enabled pools get "Open". */
  private rebuildChests(): void {
    this.chestHost.removeChildren();
    if (!this.chestsLoaded) {
      this.chestHost.addChild(this.emptyLine('Loading chests…', 0));
      return;
    }
    const enabled = this.pools.filter((pool) => pool.enabled);
    if (enabled.length === 0) {
      this.chestHost.addChild(this.emptyLine('No chest pools', 0));
      return;
    }
    const contentWidth = this.width - theme.SCREEN_MARGIN * 2;
    enabled.slice(0, MAX_ROWS).forEach((pool, index) => {
      const y = index * (CHEST_ROW_HEIGHT + theme.SPACE_XS);
      const row = new Laya.Sprite();
      row.pos(0, y);
      row.size(contentWidth, CHEST_ROW_HEIGHT);
      row.addChild(createPanel(0, 0, contentWidth, CHEST_ROW_HEIGHT, { fill: theme.COLOR_PANEL_DEEP }));

      const name = this.makeText(
        pool.name || pool.poolId,
        contentWidth - theme.SPACE_MD * 2 - OPEN_BUTTON_WIDTH,
        theme.COLOR_TITLE,
        true,
        theme.SPACE_MD,
      );
      name.fontSize = theme.FONT_SIZE_LABEL;
      name.y = theme.SPACE_SM;
      name.overflow = 'hidden';
      row.addChild(name);

      const owned = this.ownedChests[pool.poolId] ?? 0;
      const cost = formatCost(pool.cost);
      const meta = this.makeText(
        `Owned ${owned} · ${cost}`,
        contentWidth - theme.SPACE_MD * 2 - OPEN_BUTTON_WIDTH,
        theme.COLOR_TEXT_MUTED,
        false,
        theme.SPACE_MD,
      );
      meta.fontSize = theme.FONT_SIZE_CAPTION;
      meta.y = CHEST_ROW_HEIGHT - theme.SPACE_LG;
      row.addChild(meta);

      const open = createButtonEx(
        'Open',
        contentWidth - OPEN_BUTTON_WIDTH - theme.SPACE_MD,
        (CHEST_ROW_HEIGHT - theme.BUTTON_HEIGHT) / 2,
        OPEN_BUTTON_WIDTH,
        () => void this.open(pool.poolId),
        'primary',
        theme.BUTTON_HEIGHT,
      );
      open.setEnabled(!this.busy);
      row.addChild(open.sprite);
      this.chestHost.addChild(row);
    });
  }

  /** Loads the card stacks (via the flow) and the chest pools (locally). */
  private async reload(): Promise<void> {
    if (this.options.flow.snapshot().inventory === null) {
      this.busy = true;
      await this.options.flow.openInventory();
      this.busy = false;
    }
    if (this.chestsLoaded) {
      return;
    }
    const chests = await this.options.flow.client.fetchChests();
    if (chests !== null) {
      this.pools = chests.pools;
      this.ownedChests = chests.ownedChests;
      this.chestsLoaded = true;
    }
    this.applySnapshot(this.options.flow.snapshot());
  }

  private async open(poolId: string): Promise<void> {
    this.busy = true;
    this.applySnapshot(this.options.flow.snapshot());
    const result = await this.options.flow.client.openChest(poolId, 1);
    this.busy = false;
    if (result !== null) {
      this.ownedChests = result.ownedChests;
      this.statusText.text = `Opened ${result.results.length} card(s) from ${poolId}`;
      this.statusText.color = theme.COLOR_SUCCESS;
    } else {
      this.statusText.text = this.options.flow.client.lastError;
      this.statusText.color = theme.COLOR_DANGER;
    }
    await this.options.flow.openInventory();
    this.applySnapshot(this.options.flow.snapshot());
  }

  private emptyLine(text: string, y: number): Laya.Text {
    const label = this.makeText(text, this.width, theme.COLOR_TEXT_DISABLED, false, 0);
    label.fontSize = theme.FONT_SIZE_CAPTION;
    label.y = y;
    return label;
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

/** `{ gold: 300 }` → `300 gold`; empty cost renders `free`. */
export function formatCost(cost: Record<string, number>): string {
  const parts = Object.entries(cost)
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => `${amount} ${currency}`);
  return parts.length === 0 ? 'free' : parts.join(' · ');
}
