/**
 * Draft-panel presentation model (engine-agnostic).
 *
 * The mixed-pool draft ("T9") opens a round with three candidate cards; the
 * player who defeated the boss first picks one, the second picks from what is
 * left. The client renders exactly the candidates the `draft_open` event
 * carried and submits one `candidate_index` — it never computes candidates,
 * filters the picked one, or decides whose turn it is on its own.
 *
 * The panel is shown on `draft_open` and hidden on `draft_grant` /
 * `draft_timeout` / `draft_skipped` (see the scene); a spectator (an unknown
 * local user id, or a third player) is shown the candidates but gets **no**
 * pick control.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import { draftGrantFromEvent, draftPickerRole, type DraftView, type MatchEventView } from './battle_events';
import { cardEffectDefinition, describeCardEffect, type CardRarity } from '../sim/card_effects';

/** One candidate the server offered, in server order. */
export interface DraftCandidateView {
  /** `candidate_index` submitted when this candidate is clicked (0-based). */
  index: number;
  cardId: string;
  /** Rarity tier when the card is known to the client's mirror, else `''`. */
  rarity: CardRarity | '';
  /** One-line effect summary for a known card, else `''`. */
  summary: string;
}

/** Which side of the round the local player is on. */
export type DraftPickerRole = 'first' | 'second' | 'spectator';

/** Everything the draft panel draws for one redraw. */
export interface DraftPanelView {
  roundIndex: number;
  /** The boss whose defeat opened the round. */
  bossId: string;
  candidates: DraftCandidateView[];
  pickerRole: DraftPickerRole;
  /** True when the local player is a picker this round — i.e. may click. */
  canPick: boolean;
  firstUserId: string;
  secondUserId: string;
  /** Tick after which the server auto-picks; `0` when the event omitted it. */
  expiresTick: number;
  /** Public pool hash, shown for auditing. */
  poolHash: string;
}

/**
 * Projects a `draft_open` view onto the panel, or `null` when there is nothing
 * to render (no round, or a round with no candidates — never an empty panel).
 */
export function buildDraftPanel(
  draft: DraftView | null | undefined,
  localUserId: string,
): DraftPanelView | null {
  if (draft === null || draft === undefined || draft.candidates.length === 0) {
    return null;
  }
  const role = draftPickerRole(draft, localUserId);
  const candidates: DraftCandidateView[] = draft.candidates.map((cardId, index) => {
    const definition = cardEffectDefinition(cardId);
    return {
      index,
      cardId,
      rarity: definition?.rarity ?? '',
      summary: describeCardEffect(cardId),
    };
  });
  return {
    roundIndex: draft.roundIndex,
    bossId: draft.bossId,
    candidates,
    pickerRole: role,
    canPick: role !== 'spectator',
    firstUserId: draft.firstUserId,
    secondUserId: draft.secondUserId,
    expiresTick: draft.expiresTick,
    poolHash: draft.poolHash,
  };
}

/** Called with the pick the local player made: `match.mode_action` arguments. */
export type DraftPickSubmit = (matchId: string, candidateIndex: number, modeId: string) => void;

/**
 * The card a `draft_grant` row adds to the **local** player's hand, or `null`.
 *
 * Returns `null` for a row that is not a grant, is deferred (the card waits in
 * the server's pending list, so the hand keeps its four playable slots), or
 * belongs to another player. This is the only path by which the client's
 * displayed hand grows.
 */
export function localGrantCardId(event: MatchEventView, localUserId: string): string | null {
  const grant = draftGrantFromEvent(event);
  if (grant === null || grant.deferred) {
    return null;
  }
  if (localUserId === '' || grant.userId !== localUserId) {
    return null;
  }
  return grant.cardId;
}

/**
 * The draft panel's state machine: it holds the current round plus the match
 * context and turns a candidate click into exactly one submit.
 *
 * A spectator click, an unknown candidate index and a hidden panel are all
 * rejected locally — not as validation, but so a stale UI cannot send a pick
 * the player is not entitled to make (the server would reject it anyway).
 */
export class DraftPanelController {
  private matchId = '';
  private modeId = '';
  private localUserId = '';
  private draft: DraftView | null = null;
  private readonly submit: DraftPickSubmit;

  constructor(submit: DraftPickSubmit) {
    this.submit = submit;
  }

  /** Updates the match context the pick is submitted against. */
  setContext(matchId: string, modeId: string, localUserId: string): void {
    this.matchId = matchId;
    this.modeId = modeId;
    this.localUserId = localUserId;
  }

  /** Installs (or clears, with `null`) the current round. */
  setDraft(draft: DraftView | null): void {
    this.draft = draft;
  }

  get panel(): DraftPanelView | null {
    return buildDraftPanel(this.draft, this.localUserId);
  }

  get visible(): boolean {
    return this.panel !== null;
  }

  /**
   * Submits a pick for candidate `index`.
   *
   * Returns whether a submit was issued: `false` for a hidden panel, a
   * spectator, or an index outside the current candidates.
   */
  click(candidateIndex: number): boolean {
    const panel = this.panel;
    if (panel === null || !panel.canPick) {
      return false;
    }
    if (!panel.candidates.some((candidate) => candidate.index === candidateIndex)) {
      return false;
    }
    this.submit(this.matchId, candidateIndex, this.modeId);
    return true;
  }
}
