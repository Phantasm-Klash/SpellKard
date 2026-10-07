/**
 * Room screen: shows the room code, the player roster and starts the match.
 *
 * Layout follows the shared three-band grid used by every screen (title /
 * content / actions): a `SCREEN_MARGIN` outer gutter, a title band, a content
 * band with the room code plus one card per player slot, then full-width
 * action buttons stacked on the `SPACE_*` rhythm. Every colour, size and gap
 * comes from `view/theme` — nothing is hard-coded here.
 *
 * The roster is dynamic (a room can hold any number of players), so the player
 * cards live in a dedicated `playerList` container that is rebuilt from
 * scratch on every `applySnapshot` — `removeChildren()` then re-add.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import type { RoomPlayerView } from '../../../core/net/lobby_client';
import * as theme from '../view/theme';
import {
  createBadge,
  createButtonEx,
  createCaption,
  createCard,
  createDivider,
  createPanel,
  type BadgeHandle,
  type ButtonHandle,
} from './ui_kit';
import type { ClientScene } from './scene';

export interface RoomSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
}

/**
 * Height of the title bar inside `createCard`. Duplicated here because the
 * room scene stacks cards itself and must know the full card height; `ui_kit`
 * keeps its own copy for drawing. Keep the two in sync.
 */
const CARD_TITLE_BAR_HEIGHT = 34;
/** Height of a card's content row (below the title bar). */
const CARD_BODY_HEIGHT = 36;
/** Distance from the body top to the first text row. */
const CARD_BODY_PAD_TOP = 10;
/** Status chip height, matching `ui_kit`'s `BADGE_HEIGHT`. */
const CARD_BADGE_HEIGHT = 20;
/** Width reserved at the card's trailing edge for the status chip. */
const CARD_BADGE_RESERVE = 96;

export class RoomScene implements ClientScene {
  readonly root: Laya.Sprite;

  private readonly width: number;
  private readonly roomCodeText: Laya.Text;
  private readonly roomMetaText: Laya.Text;
  private readonly playerList: Laya.Sprite;
  private emptyText: Laya.Text;
  private readonly statusText: Laya.Text;
  private readonly readyButton: ButtonHandle;
  private readonly leaveButton: ButtonHandle;
  private busy = false;

  constructor(private readonly options: RoomSceneOptions) {
    const { width, height } = options;
    this.width = width;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    // --- title band ---
    const title = this.makeText('Room', theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    title.y = margin;
    this.root.addChild(title);
    this.root.addChild(createDivider(margin, title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    // --- room-code band: a framed, centred accent code so it reads at a glance ---
    const codeY = title.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    const codeHeight = 96;
    this.root.addChild(
      createPanel(margin, codeY, contentWidth, codeHeight, { fill: theme.COLOR_PANEL_DEEP, border: theme.COLOR_ACCENT }),
    );
    const codeCaption = createCaption('Room code', contentWidth - theme.SPACE_MD * 2, codeY + theme.SPACE_SM);
    codeCaption.x = margin + theme.SPACE_MD;
    this.root.addChild(codeCaption);
    this.roomCodeText = this.makeText('—', theme.FONT_SIZE_TITLE, theme.COLOR_ACCENT, true, margin);
    this.roomCodeText.align = 'center';
    this.roomCodeText.y = codeY + 28;
    this.root.addChild(this.roomCodeText);
    this.roomMetaText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.roomMetaText.align = 'center';
    this.roomMetaText.y = codeY + codeHeight - theme.SPACE_LG;
    this.root.addChild(this.roomMetaText);

    // --- roster band: dynamic player cards rebuilt per snapshot ---
    const rosterCaptionY = codeY + codeHeight + theme.SPACE_MD;
    const rosterCaption = createCaption('Players', contentWidth, rosterCaptionY);
    rosterCaption.x = margin;
    this.root.addChild(rosterCaption);

    const listY = rosterCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_SM;
    this.playerList = new Laya.Sprite();
    this.playerList.pos(margin, listY);
    this.root.addChild(this.playerList);

    this.emptyText = this.makeText('Waiting for players…', theme.FONT_SIZE_BODY, theme.COLOR_TEXT_DISABLED, false, 0);
    this.emptyText.y = theme.SPACE_SM;
    this.playerList.addChild(this.emptyText);

    // --- actions band: status line, then same-width centred buttons ---
    const actionsY = height - margin - theme.BUTTON_HEIGHT * 2 - theme.SPACE_MD;
    this.statusText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_INFO, false, margin);
    this.statusText.y = actionsY - theme.FONT_SIZE_CAPTION - theme.SPACE_MD;
    this.statusText.width = contentWidth;
    this.statusText.wordWrap = true;
    this.statusText.leading = theme.SPACE_XS;
    this.root.addChild(this.statusText);

    this.readyButton = createButtonEx('Ready', margin, actionsY, contentWidth, () => void this.ready(), 'primary');
    this.root.addChild(this.readyButton.sprite);

    this.leaveButton = createButtonEx(
      'Leave room',
      margin,
      actionsY + theme.BUTTON_HEIGHT + theme.SPACE_MD,
      contentWidth,
      () => void this.leave(),
      'ghost',
    );
    this.root.addChild(this.leaveButton.sprite);
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
    this.statusText.text = snapshot.lastError === '' ? snapshot.statusText : snapshot.lastError;
    this.statusText.color = snapshot.lastError === '' ? theme.COLOR_INFO : theme.COLOR_DANGER;

    const room = snapshot.room;
    if (room === null) {
      this.roomCodeText.text = '—';
      this.roomCodeText.color = theme.COLOR_TEXT_DISABLED;
      this.roomMetaText.text = 'No room';
      this.rebuildPlayers([]);
      this.readyButton.setEnabled(false);
      this.readyButton.setText('Ready');
      return;
    }

    this.roomCodeText.text = room.roomCode;
    this.roomCodeText.color = theme.COLOR_ACCENT;
    this.roomMetaText.text = `${room.modeId} · ruleset ${room.rulesetVersion || '-'}`;
    this.rebuildPlayers(room.players);

    const allReady = room.allReady && room.players.length >= 2;
    this.readyButton.setEnabled(!this.busy);
    this.readyButton.setText(allReady ? 'Start match' : 'Ready');
  }

  /**
   * Rebuilds the roster: one card per player, cleared and re-added each time.
   *
   * Each card carries a name row and, to its right, a status chip. Both sit on
   * the same body row, so the card only needs room for the title bar plus that
   * one row — `CARD_BODY_HEIGHT` below. Cards are stacked with `SPACE_MD`
   * between them: the body row is taller than `SPACE_SM`, and the previous
   * `SPACE_SM` step made consecutive cards overlap.
   */
  private rebuildPlayers(players: RoomPlayerView[]): void {
    this.playerList.removeChildren();
    if (players.length === 0) {
      this.emptyText = this.makeText('Waiting for players…', theme.FONT_SIZE_BODY, theme.COLOR_TEXT_DISABLED, false, 0);
      this.emptyText.y = theme.SPACE_SM;
      this.playerList.addChild(this.emptyText);
      return;
    }
    const contentWidth = this.width - theme.SCREEN_MARGIN * 2;
    const cardHeight = CARD_TITLE_BAR_HEIGHT + CARD_BODY_HEIGHT;
    const step = cardHeight + theme.SPACE_MD;
    players.forEach((player, index) => {
      const card = createCard(0, index * step, contentWidth, cardHeight, player.displayName || player.playerId);
      const name = this.makeText(player.playerId, theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, theme.SPACE_MD);
      name.y = CARD_BODY_PAD_TOP;
      // Reserve the trailing third of the row for the status chip so a long id
      // never runs under it.
      name.width = contentWidth - theme.SPACE_MD * 2 - CARD_BADGE_RESERVE;
      name.overflow = 'hidden';
      card.body.addChild(name);
      this.attachBadge(card.body, player, contentWidth);
      this.playerList.addChild(card.sprite);
    });
  }

  /** Picks the right status chip(s) for a player and parks them on the right. */
  private attachBadge(body: Laya.Sprite, player: RoomPlayerView, cardWidth: number): void {
    const badges: BadgeHandle[] = [];
    if (player.host) {
      badges.push(createBadge('HOST', 0, 0, { tone: 'neutral' }));
    }
    if (!player.connected) {
      badges.push(createBadge('OFFLINE', 0, 0, { tone: 'danger' }));
    } else if (player.ready) {
      badges.push(createBadge('READY', 0, 0, { tone: 'success' }));
    } else {
      badges.push(createBadge('WAITING', 0, 0, { tone: 'warning' }));
    }
    // Lay the chips out right-to-left so they hug the card's trailing edge,
    // anchored to the card's inner edge — not the sprite edge, which is where
    // the panel border sits and used to clip the first chip.
    let cursor = cardWidth - theme.SPACE_MD;
    for (let i = badges.length - 1; i >= 0; i -= 1) {
      const badge = badges[i];
      const badgeWidth = badge.width;
      badge.sprite.x = cursor - badgeWidth;
      badge.sprite.y = Math.round((CARD_BODY_HEIGHT - CARD_BADGE_HEIGHT) / 2);
      cursor -= badgeWidth + theme.SPACE_XS;
      body.addChild(badge.sprite);
    }
  }

  private async ready(): Promise<void> {
    this.busy = true;
    this.statusText.text = 'Ready — waiting for match…';
    await this.options.flow.ready();
    this.busy = false;
    this.applySnapshot(this.options.flow.snapshot());
  }

  private async leave(): Promise<void> {
    this.busy = true;
    await this.options.flow.leaveRoom();
    this.busy = false;
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
