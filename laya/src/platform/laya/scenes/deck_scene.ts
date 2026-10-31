/**
 * Deck editor screen: the 20-card deck on the left, the owned cards on the right.
 *
 * Layout follows the shared three-band grid (title / content / actions) used by
 * every lobby-family screen: a `SCREEN_MARGIN` outer gutter, a title band with a
 * divider, a two-column content band, then the action band. Every colour, size
 * and gap comes from `view/theme`; nothing is hard-coded here.
 *
 * The *editing* rules live in `core/game/deck_view.ts` (`DeckDraft`) — this file
 * only renders the draft and forwards clicks to it, so the legality rules are
 * unit-tested without a stage. Saving goes through `LobbyClient.saveDeck`
 * (`decks.save`, always `active: true`) and the refreshed list is handed back to
 * the flow so the next visit starts from the server's copy.
 *
 * Two reads feed the screen: `decks.list` (via `LobbyFlow.openDeck`, which also
 * switches here) and the inventory, which is the candidate pool. The inventory
 * is fetched *locally* when the flow has not cached it — calling
 * `flow.openInventory()` would navigate away from this screen.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import {
  DECK_SIZE,
  DeckDraft,
  MAX_COPIES_PER_CARD,
  MAX_HIGH_RARE_CARDS,
  MAX_INTERFERENCE_CARDS,
  deckPoolFromInventory,
  deckSourceFromDecks,
  type DeckCandidateView,
  type DeckProblem,
  type DeckSlotView,
} from '../../../core/game/deck_view';
import { describeAuthError } from '../../../core/game/auth_messages';
import { t } from '../../../core/game/i18n';
import type { InventoryView } from '../../../core/net/lobby_client';
import * as theme from '../view/theme';
import { createArtButton, createButtonEx, createCaption, createDivider, createPanel, type ButtonHandle } from './ui_kit';
import type { ShortcutAction, ShortcutScope } from '../../../core/input/shortcuts';
import type { ClientScene } from './scene';

export interface DeckSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
}

/** Height of one row in either column (two lines: name/rarity, then detail). */
const ROW_HEIGHT = 40;
/** Vertical gap between rows. */
const ROW_GAP = 4;
/** Width of the add/remove buttons on a row. */
const ROW_BUTTON_WIDTH = 84;
/** Row-button height; shorter than `theme.BUTTON_HEIGHT` so it fits the row. */
const ROW_BUTTON_HEIGHT = 28;
/** Font size for a row button's label ("Remove" must fit 54px). */
const ROW_BUTTON_FONT = 12;

/** A short status line: text plus the tone it is painted in. */
interface StatusLine {
  text: string;
  color: string;
}

export class DeckScene implements ClientScene {
  readonly root: Laya.Sprite;
  readonly shortcutScope: ShortcutScope = 'deck';

  private readonly columnWidth: number;
  private readonly title: Laya.Text;
  private readonly deckCaption: Laya.Text;
  /** "高稀有 x/6 · 干扰 x/4" line under the deck caption. */
  private readonly statsText: Laya.Text;
  private readonly poolCaption: Laya.Text;
  private readonly statusText: Laya.Text;
  private readonly deckHost: Laya.Sprite;
  private readonly poolHost: Laya.Sprite;
  private readonly saveButton: ButtonHandle;
  private readonly clearButton: ButtonHandle;
  private readonly backButton: ButtonHandle;
  /** The draft being edited; `null` until the first load lands. */
  private draft: DeckDraft | null = null;
  /** Owned cards, cached locally so the pool survives a flow repaint. */
  private inventory: InventoryView | null = null;
  /** True once a draft has been seeded for this visit (guards re-seeding). */
  private seeded = false;
  private busy = false;
  /** Text shown instead of the derived status (a save result, an edit refusal). */
  private localStatus: StatusLine | null = null;

  constructor(private readonly options: DeckSceneOptions) {
    const { width, height } = options;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;
    const columnGap = theme.SPACE_MD;
    const columnWidth = Math.floor((contentWidth - columnGap) / 2);
    this.columnWidth = columnWidth;
    const rightX = margin + columnWidth + columnGap;

    // --- title band ---
    this.title = this.makeText(t('deck.title'), theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    this.title.y = margin;
    this.root.addChild(this.title);
    // 卡组没有对应的 TNA 标题牌，按 `docs/ART_POLICY.md` 保留文本标题。
    const dividerY = this.title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM;
    this.root.addChild(createDivider(margin, dividerY, contentWidth));

    // --- column captions ---
    const captionY = dividerY + theme.SPACE_SM;
    this.deckCaption = createCaption(t('deck.current'), columnWidth, captionY);
    this.deckCaption.x = margin;
    this.root.addChild(this.deckCaption);
    this.poolCaption = createCaption(t('deck.pool'), columnWidth, captionY);
    this.poolCaption.x = rightX;
    this.root.addChild(this.poolCaption);

    // The two caps the deck is judged by, one line above the list: "high rarity
    // x/6" and "interference x/4". They turn red the moment a cap is exceeded.
    const statsY = captionY + theme.FONT_SIZE_CAPTION + theme.SPACE_XS;
    this.statsText = createCaption('', contentWidth, statsY);
    this.statsText.x = margin;
    this.root.addChild(this.statsText);

    // --- content band: two row lists ---
    const listTop = statsY + theme.FONT_SIZE_CAPTION + theme.SPACE_SM;
    this.deckHost = new Laya.Sprite();
    this.deckHost.pos(margin, listTop);
    this.root.addChild(this.deckHost);
    this.poolHost = new Laya.Sprite();
    this.poolHost.pos(rightX, listTop);
    this.root.addChild(this.poolHost);

    // --- action band ---
    const actionsY = height - margin - theme.BUTTON_HEIGHT;
    this.statusText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.statusText.y = actionsY - theme.FONT_SIZE_CAPTION - theme.SPACE_MD;
    this.statusText.width = contentWidth;
    this.statusText.wordWrap = true;
    this.statusText.leading = theme.SPACE_XS;
    this.root.addChild(this.statusText);

    const saveWidth = Math.round(contentWidth * 0.44);
    const clearWidth = Math.round(contentWidth * 0.2);
    const backWidth = contentWidth - saveWidth - clearWidth - theme.SPACE_MD * 2;
    this.saveButton = createButtonEx(t('deck.save'), margin, actionsY, saveWidth, () => void this.save(), 'primary');
    this.root.addChild(this.saveButton.sprite);
    const clearX = margin + saveWidth + theme.SPACE_MD;
    this.clearButton = createButtonEx(t('deck.clear'), clearX, actionsY, clearWidth, () => this.clearDeck(), 'ghost');
    this.root.addChild(this.clearButton.sprite);
    this.backButton = createButtonEx(
      t('lobby.backToLobby'),
      clearX + clearWidth + theme.SPACE_MD,
      actionsY,
      backWidth,
      () => this.options.flow.backToLobby(),
      'ghost',
    );
    this.root.addChild(this.backButton.sprite);

    this.refresh();
  }

  onEnter(): void {
    this.root.visible = true;
    this.seeded = false;
    this.localStatus = null;
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
    // The flow's own error (a failed `decks.list`) outranks anything derived:
    // it is the reason the screen has no data at all.
    if (snapshot.lastError !== '') {
      this.localStatus = { text: snapshot.lastError, color: theme.COLOR_DANGER };
    }
    if (!this.seeded && snapshot.decks !== null) {
      this.seedDraft(snapshot.decks);
    }
    this.refresh();
  }

  /**
   * Handles a deck shortcut. Only `ui.back` maps onto an existing control; the
   * add/remove buttons live on their own rows and there is no list selection,
   * so the navigation actions fall through to the app-level handlers.
   */
  handleShortcut(action: ShortcutAction, _event: Laya.KeyboardEventLike): boolean {
    if (action === 'ui.back') {
      this.options.flow.backToLobby();
      return true;
    }
    return false;
  }

  /** Loads the deck list (through the flow) and the owned cards (locally). */
  private async reload(): Promise<void> {
    const snapshot = this.options.flow.snapshot();
    // A freshly loaded inventory (the player visited the inventory screen since
    // the last visit here) outranks this scene's cache; only a miss triggers a
    // local read. `flow.openInventory()` would switch screens, hence the direct
    // client call.
    const known = snapshot.inventory ?? this.inventory;
    this.inventory = known ?? (await this.options.flow.client.fetchInventory());
    if (snapshot.decks === null) {
      this.busy = true;
      this.refresh();
      await this.options.flow.openDeck();
      this.busy = false;
    }
    this.seedDraft(this.options.flow.snapshot().decks);
    this.refresh();
  }

  /** Builds (or rebuilds) the draft from a deck list; no-op without data. */
  private seedDraft(decks: LobbyFlowSnapshot['decks']): void {
    if (decks === null) {
      return;
    }
    this.draft = new DeckDraft(deckSourceFromDecks(decks), deckPoolFromInventory(this.inventory));
    this.seeded = true;
    this.localStatus = null;
  }

  /**
   * Repaints both columns, the captions and the action band.
   *
   * Every fixed label is re-resolved from `t()` here rather than only at
   * construction: the scene outlives a language switch (the settings modal
   * writes the shared store, this screen is not rebuilt), so a label painted
   * once would stay in the boot language forever.
   */
  private refresh(): void {
    const draft = this.draft;
    const status = this.statusLine();
    this.title.text = t('deck.title');
    this.saveButton.setText(t('deck.save'));
    this.clearButton.setText(t('deck.clear'));
    this.backButton.setText(t('lobby.backToLobby'));
    this.statusText.text = status.text;
    this.statusText.color = status.color;

    if (draft === null) {
      this.deckCaption.text = t('deck.current');
      this.poolCaption.text = t('deck.pool');
      this.statsText.text = '';
      this.clearHost(this.deckHost);
      this.clearHost(this.poolHost);
      this.deckHost.addChild(this.emptyLine(t('flow.deck.loading'), 0));
      this.saveButton.setEnabled(false);
      this.clearButton.setEnabled(false);
      this.backButton.setEnabled(!this.busy);
      return;
    }

    const view = draft.view();
    this.deckCaption.text = `${t('deck.current')} · ${t('deck.count', { count: view.count, max: view.maxSize })}`;
    this.poolCaption.text = t('deck.pool');
    this.statsText.text =
      `${t('deck.highRarity', { count: view.highRarity, max: view.maxHighRarity })}` +
      ` · ${t('deck.interference', { count: view.interference, max: view.maxInterference })}`;
    this.statsText.color =
      view.highRarity > view.maxHighRarity || view.interference > view.maxInterference
        ? theme.COLOR_DANGER
        : theme.COLOR_TEXT_MUTED;
    this.rebuildSlots(view.slots);
    this.rebuildPool(view.candidates);
    this.saveButton.setEnabled(!this.busy && view.canSave);
    this.clearButton.setEnabled(!this.busy && view.canClear);
    this.backButton.setEnabled(!this.busy);
  }

  /** The 20 slots, filled or empty, each with a remove button when filled. */
  private rebuildSlots(slots: DeckSlotView[]): void {
    this.clearHost(this.deckHost);
    slots.forEach((slot, index) => {
      const y = index * (ROW_HEIGHT + ROW_GAP);
      const row = new Laya.Sprite();
      row.pos(0, y);
      row.size(this.columnWidth, ROW_HEIGHT);
      const filled = slot.cardId !== '';
      row.addChild(
        createPanel(0, 0, this.columnWidth, ROW_HEIGHT, {
          fill: filled ? theme.COLOR_PANEL : theme.COLOR_PANEL_DEEP,
          border: filled ? theme.COLOR_PANEL_BORDER : theme.COLOR_DIVIDER,
        }),
      );

      const indexLabel = this.makeText(
        String(index + 1).padStart(2, '0'),
        20,
        theme.COLOR_ACCENT_DIM,
        true,
        theme.SPACE_SM,
      );
      indexLabel.y = theme.SPACE_XS;
      row.addChild(indexLabel);

      const textWidth = this.columnWidth - theme.SPACE_SM * 2 - 30 - (filled ? ROW_BUTTON_WIDTH + theme.SPACE_SM : 0);
      const name = this.makeText(
        filled ? slot.name : t('deck.emptySlot'),
        textWidth,
        filled ? theme.COLOR_TEXT : theme.COLOR_TEXT_DISABLED,
        filled,
        30,
      );
      name.fontSize = theme.FONT_SIZE_LABEL;
      name.y = theme.SPACE_XS - 2;
      name.overflow = 'hidden';
      row.addChild(name);

      if (filled) {
        const rarity = this.makeText(
          slot.rarity,
          textWidth,
          theme.COLOR_ACCENT,
          false,
          30,
        );
        rarity.fontSize = theme.FONT_SIZE_CAPTION;
        rarity.align = 'right';
        rarity.y = theme.SPACE_XS - 1;
        row.addChild(rarity);

        const effect = this.makeText(slot.effect, textWidth, theme.COLOR_TEXT_MUTED, false, 30);
        effect.fontSize = theme.FONT_SIZE_CAPTION;
        effect.y = ROW_HEIGHT - theme.FONT_SIZE_CAPTION - theme.SPACE_XS;
        effect.overflow = 'hidden';
        row.addChild(effect);

        const remove = this.rowButton(
          t('deck.remove'),
          this.columnWidth - ROW_BUTTON_WIDTH - theme.SPACE_SM,
          (ROW_HEIGHT - ROW_BUTTON_HEIGHT) / 2,
          () => this.removeAt(slot.index),
          'close',
        );
        row.addChild(remove.sprite);
      }
      this.deckHost.addChild(row);
    });
  }

  /** One row per owned card: name, owned/in-deck counts, remove/add buttons. */
  private rebuildPool(candidates: DeckCandidateView[]): void {
    this.clearHost(this.poolHost);
    if (candidates.length === 0) {
      this.poolHost.addChild(this.emptyLine(t('deck.emptyPool'), 0));
      return;
    }
    candidates.forEach((candidate, index) => {
      const y = index * (ROW_HEIGHT + ROW_GAP);
      const row = new Laya.Sprite();
      row.pos(0, y);
      row.size(this.columnWidth, ROW_HEIGHT);
      row.addChild(createPanel(0, 0, this.columnWidth, ROW_HEIGHT, { fill: theme.COLOR_PANEL_DEEP }));

      const textWidth = this.columnWidth - theme.SPACE_SM * 2 - ROW_BUTTON_WIDTH * 2 - theme.SPACE_SM * 2;
      const name = this.makeText(
        candidate.name,
        textWidth,
        candidate.banned ? theme.COLOR_DANGER : theme.COLOR_TEXT,
        true,
        theme.SPACE_SM,
      );
      name.fontSize = theme.FONT_SIZE_LABEL;
      name.y = theme.SPACE_XS - 2;
      name.overflow = 'hidden';
      row.addChild(name);

      const rarity = this.makeText(candidate.rarity, textWidth, theme.COLOR_ACCENT, false, theme.SPACE_SM);
      rarity.fontSize = theme.FONT_SIZE_CAPTION;
      rarity.align = 'right';
      rarity.y = theme.SPACE_XS - 1;
      row.addChild(rarity);

      const meta = this.makeText(
        t('deck.owned', { used: candidate.used, cap: candidate.cap, owned: candidate.owned }),
        textWidth,
        theme.COLOR_TEXT_MUTED,
        false,
        theme.SPACE_SM,
      );
      meta.fontSize = theme.FONT_SIZE_CAPTION;
      meta.y = ROW_HEIGHT - theme.FONT_SIZE_CAPTION - theme.SPACE_XS;
      meta.overflow = 'hidden';
      row.addChild(meta);

      const remove = this.rowButton(
        t('deck.remove'),
        this.columnWidth - ROW_BUTTON_WIDTH * 2 - theme.SPACE_SM * 2,
        (ROW_HEIGHT - ROW_BUTTON_HEIGHT) / 2,
        () => this.removeLast(candidate.cardId),
        'close',
      );
      remove.setEnabled(!this.busy && candidate.canRemove);
      row.addChild(remove.sprite);

      const add = this.rowButton(
        t('deck.add'),
        this.columnWidth - ROW_BUTTON_WIDTH - theme.SPACE_SM,
        (ROW_HEIGHT - ROW_BUTTON_HEIGHT) / 2,
        () => this.add(candidate.cardId),
        'confirm',
      );
      add.setEnabled(!this.busy && candidate.canAdd);
      row.addChild(add.sprite);
      this.poolHost.addChild(row);
    });
  }

  // --- edits ----------------------------------------------------------------

  private add(cardId: string): void {
    const draft = this.draft;
    if (draft === null) {
      return;
    }
    this.reportProblem(draft.add(cardId), cardId);
    this.refresh();
  }

  private removeLast(cardId: string): void {
    const draft = this.draft;
    if (draft === null) {
      return;
    }
    this.reportProblem(draft.removeLast(cardId), cardId);
    this.refresh();
  }

  private removeAt(index: number): void {
    const draft = this.draft;
    if (draft === null) {
      return;
    }
    this.reportProblem(draft.removeAt(index), '');
    this.refresh();
  }

  private clearDeck(): void {
    const draft = this.draft;
    if (draft === null) {
      return;
    }
    draft.clear();
    this.localStatus = null;
    this.refresh();
  }

  private async save(): Promise<void> {
    const draft = this.draft;
    if (draft === null || this.busy) {
      return;
    }
    if (!draft.canSave) {
      const validation = draft.validate();
      this.reportProblem(validation.problem, validation.cardId);
      this.refresh();
      return;
    }
    this.busy = true;
    this.localStatus = { text: t('deck.saving'), color: theme.COLOR_INFO };
    this.refresh();
    const saved = await this.options.flow.client.saveDeck(draft.toSavePayload());
    this.busy = false;
    if (saved === null) {
      // The raw code never reaches the player: `describeAuthError` turns the
      // lobby's `error_code` into a sentence in the active language.
      this.localStatus = {
        text: t('deck.saveFailed', { error: describeAuthError(this.options.flow.client.lastError) }),
        color: theme.COLOR_DANGER,
      };
      this.refresh();
      return;
    }
    // Hand the refreshed list to the flow first (it notifies, which repaints
    // this screen), then re-seed so the draft's baseline is the saved copy.
    this.options.flow.applyDecks(saved);
    this.seedDraft(saved);
    this.localStatus = { text: t('deck.saved', { count: draft.count }), color: theme.COLOR_SUCCESS };
    this.refresh();
  }

  /** Turns a refused edit into a status line; a no-op edit leaves it alone. */
  private reportProblem(problem: DeckProblem, cardId: string): void {
    if (problem === '') {
      this.localStatus = null;
      return;
    }
    this.localStatus = { text: deckProblemText(this.draft, problem, cardId), color: theme.COLOR_DANGER };
  }

  // --- text ----------------------------------------------------------------

  /**
   * The status line: a local message (save result / refused edit) wins,
   * otherwise the line describes the draft's state.
   */
  private statusLine(): StatusLine {
    if (this.localStatus !== null) {
      return this.localStatus;
    }
    if (this.busy) {
      return { text: t('deck.saving'), color: theme.COLOR_INFO };
    }
    const draft = this.draft;
    if (draft === null) {
      return { text: t('flow.deck.loading'), color: theme.COLOR_TEXT_MUTED };
    }
    const validation = draft.validate();
    if (validation.problem !== '') {
      return {
        text: deckProblemText(draft, validation.problem, validation.cardId),
        // "Still needs N cards" is a to-do, not a violation: amber, not red.
        color: validation.problem === 'deck_incomplete' ? theme.COLOR_WARNING : theme.COLOR_DANGER,
      };
    }
    return draft.dirty
      ? { text: t('deck.dirty'), color: theme.COLOR_WARNING }
      : { text: t('deck.synced'), color: theme.COLOR_TEXT_MUTED };
  }

  /**
   * Row-sized button: seal icon + label.
   *
   * `createArtButton` is used (rather than `createButtonEx`) on purpose: the row
   * buttons are built *after* the official `Button.lh` prefab has finished
   * loading, and the prefab's label is a nested node `ui_kit` does not write
   * through, so a plain text button would render the prefab's placeholder
   * ("Title") instead of its label. The art-button branch paints its own plaque
   * and label, so the text is what it says it is — and the seal icon (✓ add /
   * ✕ remove) is the project's own icon set, not hand-drawn art.
   */
  private rowButton(
    text: string,
    x: number,
    y: number,
    onClick: () => void,
    icon: 'confirm' | 'close',
  ): ButtonHandle {
    const button = createArtButton(text, x, y, ROW_BUTTON_WIDTH, onClick, icon, 'ghost', ROW_BUTTON_HEIGHT);
    button.label.fontSize = ROW_BUTTON_FONT;
    button.label.wordWrap = false;
    return button;
  }

  private emptyLine(text: string, y: number): Laya.Text {
    const label = this.makeText(text, this.columnWidth, theme.COLOR_TEXT_DISABLED, false, 0);
    label.fontSize = theme.FONT_SIZE_CAPTION;
    label.wordWrap = true;
    label.leading = theme.SPACE_XS;
    label.y = y;
    return label;
  }

  /** Detaches and destroys every child, so a rebuild does not leak row nodes. */
  private clearHost(host: Laya.Sprite): void {
    while (host.numChildren > 0) {
      const child = host.getChildAt(0);
      host.removeChild(child);
      child.destroy(true);
    }
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

/**
 * Player-facing sentence for a refused edit or an unsaveable deck.
 *
 * The `{card}` placeholder is the card id: the wire carries no display name for
 * cards (see `core/sim/card_effects.ts`), and inventing one here would disagree
 * with the inventory screen, which also prints the id.
 *
 * `draft` supplies the numbers the sentence needs (how many are missing, how
 * many copies are owned); it may be `null` while the screen is still loading.
 */
export function deckProblemText(draft: DeckDraft | null, problem: DeckProblem, cardId: string): string {
  switch (problem) {
    case '':
      return '';
    case 'deck_incomplete':
      return t('deck.problem.deck_incomplete', {
        max: DECK_SIZE,
        missing: Math.max(0, DECK_SIZE - (draft?.count ?? 0)),
      });
    case 'deck_overflow':
      return t('deck.problem.deck_overflow', { max: DECK_SIZE });
    case 'card_not_owned':
      return t('deck.problem.card_not_owned', { card: cardId });
    case 'copy_cap':
      return t('deck.problem.copy_cap', { card: cardId, cap: MAX_COPIES_PER_CARD });
    case 'copy_limit':
      return t('deck.problem.copy_limit', { card: cardId, owned: draft?.owned(cardId) ?? 0 });
    case 'high_rarity_limit':
      return t('deck.problem.high_rarity_limit', {
        count: draft?.tally().highRarity ?? 0,
        max: MAX_HIGH_RARE_CARDS,
      });
    case 'interference_limit':
      return t('deck.problem.interference_limit', {
        count: draft?.tally().interference ?? 0,
        max: MAX_INTERFERENCE_CARDS,
      });
    case 'ranked_banned':
      return t('deck.problem.ranked_banned', { card: cardId });
    case 'slot_invalid':
      return t('deck.problem.slot_invalid');
    default:
      return t('deck.problem.slot_invalid');
  }
}
