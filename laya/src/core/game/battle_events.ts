/**
 * Bridge from the lobby's match-event stream to the battle scene's visuals.
 *
 * The lobby (`Service.MatchEvents`, `GET /v1/matches/{id}/events`) emits one
 * `MatchEvent` row per thing that happened on the field. Two of those matter
 * for the performance layer:
 *
 *  - `card_effect_applied` / `card_accepted` carry a card id but **no effect
 *    kind** — the wire only has `card_id`, `user_id`, `value` and (for
 *    `opponent_pattern`) `target_user_id`. The kind therefore has to be
 *    resolved from the client's own mirror table
 *    ({@link cardEffectDefinition}, `core/sim/card_effects.ts`), which is why
 *    this module lives next to it and why an unknown card id maps to `null`
 *    instead of being guessed at.
 *  - `graze` / `hit` / `bomb_damage` drive sound effects.
 *
 * ★ `CardEffectEventLike` is a *structural* mirror of the scene's
 * `CardEffectEvent` (`src/platform/laya/scenes/battle_scene.ts`): core cannot
 * import platform, so the wiring layer passes this value straight through and
 * TypeScript's structural typing accepts it wherever the scene expects its own
 * interface. Keep the field sets in sync when either side changes.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import { cardEffectDefinition } from '../sim/card_effects';

/** One event of the lobby match-event stream, already projected to camelCase. */
export interface MatchEventView {
  seq: number;
  type: string;
  tick: number;
  userId?: string;
  cardId?: string;
  slot?: number;
  value?: number;
  reason?: string;
  expiresTick?: number;
  targetUserId?: string;
  actionId?: string;
  bulletId?: string;
  /** `draft_open` names the SECOND picker here (the first is `userId`). */
  fromUserId?: string;
  /** Draft round index; 0 for event families that do not carry one. */
  roundIndex?: number;
  /**
   * Free-form state the emitting family defines: the draft uses it for the
   * picker role (`first` / `second`) and for grant state (`granted` /
   * `deferred`).
   */
  status?: string;
}

/** A raw event payload: the server writes snake_case, camelCase is accepted. */
export type MatchEventPayload = Record<string, unknown>;

/**
 * Structural stand-in for the scene's `CardEffectEvent` — see the file header.
 * `effectKind` is intentionally absent from everything this module produces:
 * the scene falls back to the mirror table, which is the same source this
 * module used to classify the event.
 */
export interface CardEffectEventLike {
  cardId: string;
  effectKind?: string;
  /** Roster id (`p-<hash>`) of the targeted player; defaults to the opponent. */
  targetPlayerId?: string;
  durationTicks?: number;
  damage?: number;
  /** Curtain pattern id (`opponent_pattern`); the scene defaults it to the card id. */
  patternId?: string;
  purgeRadius?: number;
  purgeCount?: number;
}

/** Sound-effect channel an event maps onto, or `null` when it is silent. */
export type MatchEventSfx = 'graze' | 'playerShot' | 'skill';

function payloadString(payload: MatchEventPayload, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }
  return '';
}

function payloadNumber(payload: MatchEventPayload, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

/**
 * Projects one wire event onto {@link MatchEventView}.
 *
 * Returns `null` when the event is unusable — missing/empty `type` or a
 * non-finite `tick` — so a malformed row can never enter the event pipeline as
 * a phantom effect. Optional fields are only set when the wire carries them.
 */
export function matchEventViewFromPayload(payload: MatchEventPayload): MatchEventView | null {
  const type = payloadString(payload, 'type');
  const tick = payloadNumber(payload, 'tick');
  if (type === '' || tick === undefined) {
    return null;
  }
  const view: MatchEventView = {
    seq: payloadNumber(payload, 'seq') ?? 0,
    type,
    tick,
  };
  const userId = payloadString(payload, 'user_id', 'userId');
  if (userId !== '') {
    view.userId = userId;
  }
  const cardId = payloadString(payload, 'card_id', 'cardId');
  if (cardId !== '') {
    view.cardId = cardId;
  }
  const slot = payloadNumber(payload, 'slot');
  if (slot !== undefined) {
    view.slot = slot;
  }
  const value = payloadNumber(payload, 'value');
  if (value !== undefined) {
    view.value = value;
  }
  const reason = payloadString(payload, 'reason');
  if (reason !== '') {
    view.reason = reason;
  }
  const expiresTick = payloadNumber(payload, 'expires_tick', 'expiresTick');
  if (expiresTick !== undefined) {
    view.expiresTick = expiresTick;
  }
  // `card_effect_applied` names the affected player in `target_user_id`; older
  // emitters (and other event families) spell the same role `to_user_id`.
  const targetUserId = payloadString(payload, 'target_user_id', 'targetUserId')
    || payloadString(payload, 'to_user_id', 'toUserId');
  if (targetUserId !== '') {
    view.targetUserId = targetUserId;
  }
  const actionId = payloadString(payload, 'action_id', 'actionId');
  if (actionId !== '') {
    view.actionId = actionId;
  }
  const bulletId = payloadString(payload, 'bullet_id', 'bulletId');
  if (bulletId !== '') {
    view.bulletId = bulletId;
  }
  const fromUserId = payloadString(payload, 'from_user_id', 'fromUserId');
  if (fromUserId !== '') {
    view.fromUserId = fromUserId;
  }
  const roundIndex = payloadNumber(payload, 'round_index', 'roundIndex');
  if (roundIndex !== undefined) {
    view.roundIndex = roundIndex;
  }
  const status = payloadString(payload, 'status');
  if (status !== '') {
    view.status = status;
  }
  return view;
}

/**
 * Maps a card event onto the scene's effect input, or `null` when the event
 * carries no presentable effect.
 *
 * Only `card_effect_applied` (and its accepted-sibling `card_accepted`, which
 * the scene treats the same) qualify, and only when the card id resolves
 * against {@link cardEffectDefinition} — an unknown card must stay invisible
 * rather than appear with a guessed effect. `value` is re-interpreted by the
 * resolved kind, because the server overloads the field:
 *
 * | kind               | `value` on the wire        | mapped onto            |
 * | ------------------ | -------------------------- | ---------------------- |
 * | `opponent_pattern` | bullets spawned            | `patternId=cardId`, `targetPlayerId` |
 * | `bullet_purge`     | bullets removed            | `purgeCount`           |
 * | `finisher`         | bullets cleared / damage   | `damage`               |
 * | anything else      | —                          | (nothing)              |
 *
 * @param resolveRosterId maps the event's lobby `user_id` onto the battle
 *        roster id (`p-<hash>`); the battle server only accepts roster ids.
 */
export function toCardEffectEvent(
  event: MatchEventView,
  resolveRosterId: (userId: string) => string,
): CardEffectEventLike | null {
  if (event.type !== 'card_effect_applied' && event.type !== 'card_accepted') {
    return null;
  }
  if (event.cardId === undefined || event.cardId === '') {
    return null;
  }
  const definition = cardEffectDefinition(event.cardId);
  if (definition === null) {
    return null;
  }
  const effect: CardEffectEventLike = { cardId: event.cardId };
  switch (definition.effectKind) {
    case 'opponent_pattern':
      effect.patternId = event.cardId;
      if (event.targetUserId !== undefined && event.targetUserId !== '') {
        effect.targetPlayerId = resolveRosterId(event.targetUserId);
      }
      break;
    case 'bullet_purge':
      if (event.value !== undefined) {
        effect.purgeCount = event.value;
      }
      break;
    case 'finisher':
      if (event.value !== undefined) {
        effect.damage = event.value;
      }
      break;
    default:
      // `self` / `pattern` / `economy` / `invulnerable`: the scene reads the
      // static definition for every other field.
      break;
  }
  return effect;
}

/** The sound-effect channel an event plays through, or `null` when silent. */
export function eventToSfx(event: MatchEventView): MatchEventSfx | null {
  switch (event.type) {
    case 'graze':
      return 'graze';
    case 'hit':
    case 'bomb_damage':
    case 'card_effect_applied':
      return 'skill';
    case 'card_accepted':
      return 'playerShot';
    default:
      return null;
  }
}

/** One round of the mixed-pool draft, projected from a `draft_open` row. */
export interface DraftView {
  roundIndex: number;
  /** The boss whose defeat opened the round (the event's `action_id`). */
  bossId: string;
  /** The three candidates, in server order (the wire joins them with commas). */
  candidates: string[];
  /** The player who defeated the boss first — picks first. */
  firstUserId: string;
  /** The second defeater — picks from what remains, or '' when unknown. */
  secondUserId: string;
  /** Public pool hash (the event's `reason`), for auditing the pool. */
  poolHash: string;
  /** Tick after which the server auto-picks for a silent player. */
  expiresTick: number;
}

/**
 * Projects a `draft_open` row onto {@link DraftView}.
 *
 * The wire has no array fields, so the candidates arrive comma-joined in
 * `card_id` (see `battle_draft.go`). An empty list means the row is unusable —
 * never render a draft with nothing to pick.
 */
export function draftViewFromEvent(event: MatchEventView): DraftView | null {
  if (event.type !== 'draft_open') {
    return null;
  }
  const candidates = (event.cardId ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (candidates.length === 0) {
    return null;
  }
  return {
    roundIndex: event.roundIndex ?? 0,
    bossId: event.actionId ?? '',
    candidates,
    firstUserId: event.userId ?? '',
    secondUserId: event.fromUserId ?? '',
    poolHash: event.reason ?? '',
    expiresTick: event.expiresTick ?? 0,
  };
}

/** A granted card row: one per player, sharing `action_id` as the grant id. */
export interface DraftGrantView {
  roundIndex: number;
  userId: string;
  cardId: string;
  /** Shared id across the rows of one grant, so both can be matched up. */
  grantId: string;
  /** True when the hand was full and the card waits in `PendingGrants`. */
  deferred: boolean;
}

export function draftGrantFromEvent(event: MatchEventView): DraftGrantView | null {
  if (event.type !== 'draft_grant' && event.type !== 'card_grant_deferred') {
    return null;
  }
  const cardId = (event.cardId ?? '').trim();
  if (cardId === '') {
    return null;
  }
  return {
    roundIndex: event.roundIndex ?? 0,
    userId: event.userId ?? '',
    cardId,
    grantId: event.actionId ?? '',
    deferred: event.type === 'card_grant_deferred',
  };
}

/** One pick, with the picker's role in the round. */
export interface DraftPickView {
  roundIndex: number;
  userId: string;
  cardId: string;
  role: string;
}

export function draftPickFromEvent(event: MatchEventView): DraftPickView | null {
  if (event.type !== 'draft_pick') {
    return null;
  }
  const cardId = (event.cardId ?? '').trim();
  if (cardId === '') {
    return null;
  }
  return {
    roundIndex: event.roundIndex ?? 0,
    userId: event.userId ?? '',
    cardId,
    role: event.status ?? '',
  };
}

/**
 * Which side of the draft the local player is on. A spectator (a third player,
 * or an unknown local id) must never be shown a pick control.
 */
export function draftPickerRole(view: DraftView, localUserId: string): 'first' | 'second' | 'spectator' {
  if (localUserId === '') {
    return 'spectator';
  }
  if (localUserId === view.firstUserId) {
    return 'first';
  }
  if (localUserId === view.secondUserId) {
    return 'second';
  }
  return 'spectator';
}
