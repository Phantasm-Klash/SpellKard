/**
 * Hand-bar presentation model (engine-agnostic).
 *
 * The battle HUD shows the local player's hand as a small strip of cast slots
 * plus the opening energy. The hand starts as the **signed battle ticket's**
 * opening loadout (`BattleOpeningState`, `core/net/lobby_client.ts`) and only
 * ever grows through a server `draft_grant` — the client owns no hand state of
 * its own, it renders what the server dealt and turns a slot click into a
 * one-shot cast intent for the next input packet.
 *
 * Two deliberate non-features, because the server is authoritative:
 *
 *  - no cost / cooldown / turn gating. Energy is displayed, never compared
 *    against a card's cost; whether a cast is legal is the server's decision.
 *  - no hand mutation beyond a server grant. The hand changes only when a
 *    `draft_grant` row says so, never because the UI felt like it.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import type { BattleOpeningState } from '../net/lobby_client';
import type { BossRaceHandCard } from '../sim/boss_race';
import { cardEffectDefinition, describeCardEffect, type CardRarity } from '../sim/card_effects';
import { CardCastIntent, MAX_CARD_SLOTS } from './input';

/** One cast slot: a card from the server's hand, in server order. */
export interface HandSlotView {
  /** 0-based cast slot, i.e. the value sent on the wire for this card. */
  index: number;
  cardId: string;
  /** Rarity tier when the card is in the client's mirror table, else `''`. */
  rarity: CardRarity | '';
  /** One-line effect summary for a known card, else `''` (the raw id still shows). */
  summary: string;
  /** 服务端快照 `hand[].selected`（权威回显）；老路径（ticket 手牌）恒 `false`。 */
  selected: boolean;
}

/** Everything the hand bar draws for one redraw. */
export interface HandBarView {
  slots: HandSlotView[];
  /** Opening energy, shown verbatim; never a gate. */
  energy: number;
  /** False for an empty hand: the bar draws nothing. */
  visible: boolean;
  /** 牌库剩余张数；{@link HAND_DECK_UNKNOWN} = 服务端没下发。 */
  deckRemaining: number;
  /** 抽卡冷却（tick）；`0` = 可抽。 */
  drawCooldownTicks: number;
  /** 抽卡按钮是否可点（牌库非空且冷却归零）。 */
  canDraw: boolean;
  /** 当前选中的槽位；`-1` = 未选。 */
  selectedSlot: number;
  /** 使用按钮是否可点（有选中槽位）。 */
  canUse: boolean;
  /** 是否显示抽卡/使用按钮（快照驱动的手牌才显示；ticket 路径隐藏）。 */
  showActions: boolean;
}

/** `deck_remaining` 缺失时的哨兵（不是 0：0 表示「牌库空了」）。 */
export const HAND_DECK_UNKNOWN = -1;

/**
 * Projects a hand onto the hand bar.
 *
 * An empty hand yields an invisible bar with no slots — never a placeholder
 * slot, which a click could otherwise arm. Slots are the server's own order,
 * capped at the cast-slot limit so a malformed ticket cannot produce an
 * uncastable slot index. Never throws.
 *
 * `selectedSlot` is the wire-level selection (`card_select`); the ticket path
 * passes nothing and every slot reads unselected.
 */
export function buildHandBar(
  handCardIds: readonly string[] | null | undefined,
  energy: number,
  maxSlots: number = MAX_CARD_SLOTS,
  selectedSlot = -1,
): HandBarView {
  const hand = handCardIds ?? [];
  const limit = Math.max(0, Math.trunc(maxSlots));
  const slots: HandSlotView[] = [];
  for (let index = 0; index < hand.length && index < limit; index += 1) {
    const cardId = hand[index];
    if (typeof cardId !== 'string' || cardId === '') {
      // Keep the index aligned with the server's slot numbering.
      continue;
    }
    const definition = cardEffectDefinition(cardId);
    slots.push({
      index,
      cardId,
      rarity: definition?.rarity ?? '',
      summary: describeCardEffect(cardId),
      selected: index === selectedSlot,
    });
  }
  return {
    slots,
    energy: Number.isFinite(energy) ? energy : 0,
    visible: slots.length > 0,
    deckRemaining: HAND_DECK_UNKNOWN,
    drawCooldownTicks: 0,
    canDraw: false,
    selectedSlot: slots.some((slot) => slot.selected) ? selectedSlot : -1,
    canUse: slots.some((slot) => slot.selected),
    showActions: false,
  };
}

/**
 * Projects the **authoritative snapshot hand** (§2.8) onto the bar.
 *
 * This is the P1+ path: the server owns the hand (`hand[]`), the deck size and
 * the draw cooldown, and the bar mirrors them verbatim. Unlike the ticket
 * path it also carries the selection (`card_select`) and the two button gates:
 *  - `canDraw` = the deck still has cards **and** the cooldown has elapsed;
 *  - `canUse`  = something is selected.
 *
 * Missing fields stay "unknown" rather than a fake zero: an absent
 * `deck_remaining` does not grey the draw button (the server would refuse a
 * draw from an empty deck anyway), and an absent cooldown reads as ready.
 */
export function snapshotHandBar(
  hand: readonly BossRaceHandCard[] | null | undefined,
  deckRemaining: number | undefined,
  drawCooldownTicks: number | undefined,
  energy: number,
  maxSlots: number = MAX_CARD_SLOTS,
): HandBarView {
  const entries = hand ?? [];
  const limit = Math.max(0, Math.trunc(maxSlots));
  const slots: HandSlotView[] = [];
  for (const entry of entries) {
    if (slots.length >= limit) {
      break;
    }
    if (typeof entry.cardId !== 'string' || entry.cardId === '') {
      continue;
    }
    const definition = cardEffectDefinition(entry.cardId);
    slots.push({
      index: Number.isFinite(entry.slot) ? entry.slot : slots.length,
      cardId: entry.cardId,
      rarity: definition?.rarity ?? '',
      summary: describeCardEffect(entry.cardId),
      selected: entry.selected === true,
    });
  }
  const selected = slots.find((slot) => slot.selected);
  const deck = deckRemaining === undefined ? HAND_DECK_UNKNOWN : Math.max(0, Math.trunc(deckRemaining));
  const cooldown = drawCooldownTicks === undefined ? 0 : Math.max(0, Math.trunc(drawCooldownTicks));
  return {
    slots,
    energy: Number.isFinite(energy) ? energy : 0,
    visible: slots.length > 0,
    deckRemaining: deck,
    drawCooldownTicks: cooldown,
    canDraw: cooldown <= 0 && deck !== 0,
    selectedSlot: selected?.index ?? -1,
    canUse: selected !== undefined,
    showActions: true,
  };
}

/** Convenience: the hand bar for a ticket opening loadout (or `null`). */
export function openingHandBar(
  opening: BattleOpeningState | null | undefined,
  maxSlots: number = MAX_CARD_SLOTS,
): HandBarView {
  return buildHandBar(opening?.handCardIds ?? [], opening?.initialEnergy ?? 0, maxSlots);
}

/**
 * The hand bar's state machine: it owns the current hand and the one-shot cast
 * intent, so a click can never cast a slot the server did not deal.
 *
 * `click` arms a cast only for a slot that actually holds a card; `take`
 * consumes it for exactly one input packet. Installing a *different* opening
 * cancels any pending cast, so a click that raced a fresh ticket cannot fire a
 * stale slot; a grant only appends, so it leaves an in-flight click alone.
 */
export class HandBarController {
  private hand: string[] = [];
  private energyValue = 0;
  /** Signature of the opening last installed, so an unchanged ticket is a no-op. */
  private openingKey = '\u0001';
  private readonly intent = new CardCastIntent();

  /** Installs the server's opening loadout; `null` clears the bar. */
  setOpening(opening: BattleOpeningState | null | undefined): void {
    const next = opening ?? null;
    const ids = (next?.handCardIds ?? []).slice(0, MAX_CARD_SLOTS);
    const key = ids.join('\u0000');
    if (key !== this.openingKey) {
      // The opening changed under a pending click: drop it rather than fire a
      // slot that may no longer hold that card.
      this.intent.cancel();
      this.openingKey = key;
    }
    this.hand = ids.slice();
    this.energyValue = next?.initialEnergy ?? 0;
  }

  /**
   * Appends a card the server granted to this player (`draft_grant`).
   *
   * Returns whether the hand changed. A duplicate id, a blank id, or a full
   * hand is ignored — the client mirrors the server's `cardHandLimit` for
   * display and never invents a fifth slot.
   */
  applyGrant(cardId: string): boolean {
    const id = cardId.trim();
    if (id === '' || this.hand.includes(id) || this.hand.length >= MAX_CARD_SLOTS) {
      return false;
    }
    this.hand.push(id);
    return true;
  }

  get view(): HandBarView {
    return buildHandBar(this.hand, this.energyValue);
  }

  get energy(): number {
    return this.energyValue;
  }

  get handCardIds(): readonly string[] {
    return this.hand;
  }

  get armed(): boolean {
    return this.intent.armed;
  }

  /** The slot at `index`, or `null` when the hand has no such card. */
  slot(index: number): HandSlotView | null {
    return this.view.slots.find((entry) => entry.index === index) ?? null;
  }

  /** Arms a cast for the clicked slot; `false` when the slot holds no card. */
  click(index: number): boolean {
    if (this.slot(index) === null) {
      return false;
    }
    return this.intent.request(index);
  }

  /** Consumes the armed slot for one packet; `-1` when nothing is armed. */
  take(): number {
    return this.intent.take();
  }

  cancel(): void {
    this.intent.cancel();
  }
}

/**
 * 一帧输入上的符卡动作（§2.3）。默认值 = **不写卡块**，字节串与旧版一致。
 */
export interface CardActionIntent {
  cardDraw: boolean;
  cardSelect: number;
  cardUse: boolean;
}

/**
 * 抽卡 / 选卡 / 用卡的状态机（纯数据，无引擎依赖）。
 *
 * 语义与服务端 `BattleInput` 的三个字段一一对应：
 *  - `cardDraw` / `cardUse` 是**一次性脉冲**：`take()` 消费一次，下一帧自动清零；
 *  - `cardSelect` 是**持续状态**：只要选中了槽位就随每帧上行（KCP 可靠，但重复
 *    发送让服务端在任何时刻都看得到当前选择）；`-1` = 未选，恰好是 wire 缺省值。
 *
 * 选择的所有权：玩家点过之后**本地优先**，不被滞后的快照回显改回去（否则点完
 * 立刻被上一份快照的 `selected` 弹回，手牌栏会闪）。用卡之后交还给服务端回显。
 */
export class CardActionController {
  private selected = -1;
  private drawPending = false;
  private usePending = false;
  /** 玩家已经点过选择：快照回显不再覆盖，直到用卡或重置。 */
  private localSelection = false;

  get selectedSlot(): number {
    return this.selected;
  }

  /** 点选/取消选择。返回点击后是否处于「已选中」。 */
  select(slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_CARD_SLOTS) {
      this.selected = -1;
      this.localSelection = true;
      return false;
    }
    this.selected = this.selected === slot ? -1 : slot;
    this.localSelection = true;
    return this.selected >= 0;
  }

  /**
   * 服务端回显（快照 `hand[].selected`）。玩家手动选过之后忽略，避免回弹。
   */
  syncFromSnapshot(selectedSlot: number): void {
    if (this.localSelection) {
      return;
    }
    this.selected = Number.isInteger(selectedSlot) && selectedSlot >= 0 ? selectedSlot : -1;
  }

  /** 请求抽卡；服务端校验冷却/上限，客户端不做门禁。 */
  requestDraw(): void {
    this.drawPending = true;
  }

  /** 请求使用当前选中的符卡；未选中时返回 false（不发脉冲）。 */
  requestUse(): boolean {
    if (this.selected < 0) {
      return false;
    }
    this.usePending = true;
    // 用卡之后选择权交回服务端：下一份快照的 `selected` 说了算。
    this.localSelection = false;
    return true;
  }

  /** 取走本帧动作（脉冲清零，选择保留）。 */
  take(): CardActionIntent {
    const intent: CardActionIntent = {
      cardDraw: this.drawPending,
      cardSelect: this.selected,
      cardUse: this.usePending,
    };
    this.drawPending = false;
    this.usePending = false;
    return intent;
  }

  /** 对局重开/换手：清空全部状态。 */
  reset(): void {
    this.selected = -1;
    this.drawPending = false;
    this.usePending = false;
    this.localSelection = false;
  }
}
