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
import { t } from '../../../core/game/i18n';
import type { RoomPlayerView, RoomView } from '../../../core/net/lobby_client';
import * as theme from '../view/theme';
import {
  createArtButton,
  createBadge,
  createButtonEx,
  createCaption,
  createCard,
  createDivider,
  createPanel,
  type BadgeHandle,
  type ButtonHandle,
} from './ui_kit';
import type { ShortcutAction, ShortcutScope } from '../../../core/input/shortcuts';
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

/**
 * 房间 boss 选项（与 Gensoulkyo core.BossCatalog / C++ boss_catalog 一致）。
 * `labelKey` 指向 i18n 键：标签在显示时才解析，语言切换不会丢图标也不会
 * 冻结成单一语言（模块级常量在导入时求值，不能直接调用 t()）。
 */
const ROOM_BOSS_OPTIONS: ReadonlyArray<{ id: string; labelKey: string }> = [
  { id: '', labelKey: 'room.boss.default' },
  { id: 'tian', labelKey: 'room.boss.tian' },
  { id: 'hui', labelKey: 'room.boss.hui' },
];

/** 自机 shot/bomb 快捷循环选项（完整 52/13 表在 core/sim/danmaku/player_loadout）。 */
const ROOM_SHOT_OPTIONS: readonly string[] = [
  '',
  'ReimuA1',
  'ReimuB1',
  'MarisaA1',
  'MarisaB1',
  'SanaeA1',
  'SakuyaA1',
  'YoumuA1',
  'YuyukoA1',
];
const ROOM_BOMB_OPTIONS: readonly string[] = ['', 'Reimu', 'Marisa', 'Sanae', 'Sakuya', 'Youmu', 'Yuyuko'];

/** 高亮「match setup」区的高度，roster 标题据此下移（不设则不重叠）。 */
const SETUP_BLOCK_HEIGHT = 96;

export class RoomScene implements ClientScene {
  readonly root: Laya.Sprite;
  readonly shortcutScope: ShortcutScope = 'room';

  private readonly width: number;
  private readonly roomCodeText: Laya.Text;
  private readonly roomMetaText: Laya.Text;
  private readonly playerList: Laya.Sprite;
  private emptyText: Laya.Text;
  private readonly statusText: Laya.Text;
  private readonly readyButton: ButtonHandle;
  private readonly leaveButton: ButtonHandle;
  private readonly setupText: Laya.Text;
  private readonly bossButton: ButtonHandle;
  private readonly shotButton: ButtonHandle;
  private readonly bombButton: ButtonHandle;
  /** 合作人数（coop_boss 房主选项：2/4）。 */
  private readonly coopButton: ButtonHandle;
  private coopPlayers = 2;
  private bossIndex = 0;
  private shotIndex = 0;
  private bombIndex = 0;
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
    const title = this.makeText(t('room.title'), theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    title.y = margin;
    this.root.addChild(title);
    this.root.addChild(createDivider(margin, title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM, contentWidth));

    // --- room-code band: a framed, centred accent code so it reads at a glance ---
    const codeY = title.y + theme.FONT_SIZE_TITLE + theme.SPACE_MD;
    const codeHeight = 128;
    this.root.addChild(
      createPanel(margin, codeY, contentWidth, codeHeight, { fill: theme.COLOR_PANEL_DEEP, border: theme.COLOR_ACCENT }),
    );
    const codeCaption = createCaption(t('ui.roomCode'), contentWidth - theme.SPACE_MD * 2, codeY + theme.SPACE_MD);
    codeCaption.x = margin + theme.SPACE_MD;
    this.root.addChild(codeCaption);
    this.roomCodeText = this.makeText('—', theme.FONT_SIZE_TITLE, theme.COLOR_ACCENT, true, margin);
    this.roomCodeText.align = 'center';
    this.roomCodeText.y = codeY + 44;
    this.root.addChild(this.roomCodeText);
    this.roomMetaText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.roomMetaText.align = 'center';
    this.roomMetaText.y = codeY + codeHeight - theme.SPACE_LG;
    this.root.addChild(this.roomMetaText);

    // --- match setup band: boss + 自机 (host-only; server fixes boss at create,
    // so a host change re-creates the room while alone) ---
    const setupY = codeY + codeHeight + theme.SPACE_SM;
    const setupCaption = createCaption(t('room.setup.caption'), contentWidth, setupY);
    setupCaption.x = margin;
    this.root.addChild(setupCaption);
    this.setupText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.setupText.y = setupY + theme.FONT_SIZE_CAPTION + theme.SPACE_XS;
    this.root.addChild(this.setupText);
    const setupRowY = this.setupText.y + theme.FONT_SIZE_CAPTION + theme.SPACE_XS;
    const setupButtonWidth = Math.floor((contentWidth - theme.SPACE_SM * 3) / 4);
    this.bossButton = createButtonEx(t('room.boss'), margin, setupRowY, setupButtonWidth, () => void this.cycleBoss(), 'ghost');
    this.root.addChild(this.bossButton.sprite);
    this.shotButton = createButtonEx(
      t('room.shot'),
      margin + setupButtonWidth + theme.SPACE_SM,
      setupRowY,
      setupButtonWidth,
      () => void this.cycleShot(),
      'ghost',
    );
    this.root.addChild(this.shotButton.sprite);
    this.bombButton = createButtonEx(
      t('room.bomb'),
      margin + (setupButtonWidth + theme.SPACE_SM) * 2,
      setupRowY,
      setupButtonWidth,
      () => void this.cycleBomb(),
      'ghost',
    );
    this.root.addChild(this.bombButton.sprite);
    this.coopButton = createButtonEx(
      t('room.coop.players', { count: 2 }),
      margin + (setupButtonWidth + theme.SPACE_SM) * 3,
      setupRowY,
      setupButtonWidth,
      () => void this.cycleCoopPlayers(),
      'ghost',
    );
    this.coopButton.sprite.visible = false;
    this.root.addChild(this.coopButton.sprite);

    // --- roster band: dynamic player cards rebuilt per snapshot ---
    const rosterCaptionY = codeY + codeHeight + SETUP_BLOCK_HEIGHT;
    const rosterCaption = createCaption(t('room.players'), contentWidth, rosterCaptionY);
    rosterCaption.x = margin;
    this.root.addChild(rosterCaption);

    const listY = rosterCaptionY + theme.FONT_SIZE_CAPTION + theme.SPACE_SM;
    this.playerList = new Laya.Sprite();
    this.playerList.pos(margin, listY);
    this.root.addChild(this.playerList);

    this.emptyText = this.makeText(t('room.waitingForPlayers'), theme.FONT_SIZE_BODY, theme.COLOR_TEXT_DISABLED, false, 0);
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

    this.readyButton = createButtonEx(t('room.ready'), margin, actionsY, contentWidth, () => void this.ready(), 'primary');
    this.root.addChild(this.readyButton.sprite);

    this.leaveButton = createArtButton(
      t('room.leaveRoom'),
      margin,
      actionsY + theme.BUTTON_HEIGHT + theme.SPACE_MD,
      contentWidth,
      () => void this.leave(),
      'room',
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
      this.roomMetaText.text = t('room.noRoom');
      this.setupText.text = '';
      this.setSetupEnabled(false);
      this.rebuildPlayers([]);
      this.readyButton.setEnabled(false);
      this.readyButton.setText(t('room.ready'));
      return;
    }

    this.roomCodeText.text = room.roomCode;
    this.roomCodeText.color = theme.COLOR_ACCENT;
    this.roomMetaText.text = t('room.meta', { mode: room.modeId, version: room.rulesetVersion || '-' });
    this.applySetup(snapshot, room);
    this.rebuildPlayers(room.players);

    const allReady = room.allReady && room.players.length >= 2;
    this.readyButton.setEnabled(!this.busy);
    this.readyButton.setText(allReady ? t('room.startMatch') : t('room.ready'));
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
      this.emptyText = this.makeText(t('room.waitingForPlayers'), theme.FONT_SIZE_BODY, theme.COLOR_TEXT_DISABLED, false, 0);
      this.emptyText.y = theme.SPACE_SM;
      this.playerList.addChild(this.emptyText);
      return;
    }
    const contentWidth = this.width - theme.SCREEN_MARGIN * 2;
    const cardHeight = CARD_TITLE_BAR_HEIGHT + CARD_BODY_HEIGHT;
    const step = cardHeight + theme.SPACE_MD;
    players.forEach((player, index) => {
      const card = createCard(0, index * step, contentWidth, cardHeight, player.displayName || player.playerId);
      const loadoutLabel =
        player.shotType === '' && player.bombType === ''
          ? ''
          : ` · ${player.shotType || t('room.default')}/${player.bombType || t('room.default')}`;
      const name = this.makeText(
        `${player.playerId}${loadoutLabel}`,
        theme.FONT_SIZE_CAPTION,
        theme.COLOR_TEXT_MUTED,
        false,
        theme.SPACE_MD,
      );
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
      badges.push(createBadge(t('room.badge.host'), 0, 0, { tone: 'neutral' }));
    }
    if (!player.connected) {
      badges.push(createBadge(t('room.badge.offline'), 0, 0, { tone: 'danger' }));
    } else if (player.ready) {
      badges.push(createBadge(t('room.badge.ready'), 0, 0, { tone: 'success' }));
    } else {
      badges.push(createBadge(t('room.badge.waiting'), 0, 0, { tone: 'warning' }));
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

  /**
   * Renders the match setup band. The boss is fixed by the server at create
   * time, so the controls are host-only: a guest sees the values read-only.
   */
  private applySetup(snapshot: LobbyFlowSnapshot, room: RoomView): void {
    const isHost = snapshot.session !== null && snapshot.session.userId === room.hostUserId;
    this.setSetupEnabled(isHost && !this.busy);
    const bossOption = ROOM_BOSS_OPTIONS.find((option) => option.id === room.bossId);
    const bossLabel = bossOption !== undefined ? t(bossOption.labelKey) : room.bossId;
    const me = room.players.find((player) => player.userId === snapshot.session?.userId) ?? null;
    const shot = me?.shotType ?? '';
    const bomb = me?.bombType ?? '';
    const bossIndex = ROOM_BOSS_OPTIONS.findIndex((option) => option.id === room.bossId);
    if (bossIndex >= 0) {
      this.bossIndex = bossIndex;
    }
    const shotIndex = ROOM_SHOT_OPTIONS.indexOf(shot);
    if (shotIndex >= 0) {
      this.shotIndex = shotIndex;
    }
    const bombIndex = ROOM_BOMB_OPTIONS.indexOf(bomb);
    if (bombIndex >= 0) {
      this.bombIndex = bombIndex;
    }
    this.setupText.text = t('room.setup.summary', {
      boss: bossLabel,
      shot: shot || t('room.default'),
      bomb: bomb || t('room.default'),
    });
    this.setupText.color = isHost ? theme.COLOR_INFO : theme.COLOR_TEXT_MUTED;
    // 合作人数：仅 coop_boss 房显示（房主可改；guest 只读展示）。
    const isCoop = room.modeId === 'coop_boss';
    this.coopPlayers = room.coopPlayers ?? 2;
    this.coopButton.sprite.visible = isCoop;
    this.coopButton.setText(t('room.coop.players', { count: this.coopPlayers }));
  }

  private setSetupEnabled(enabled: boolean): void {
    this.bossButton.setEnabled(enabled);
    this.shotButton.setEnabled(enabled);
    this.bombButton.setEnabled(enabled);
    this.coopButton.setEnabled(enabled);
  }

  /** Cycles the room boss (host only) by re-creating the room with the new id. */
  private async cycleBoss(): Promise<void> {
    this.bossIndex = (this.bossIndex + 1) % ROOM_BOSS_OPTIONS.length;
    await this.reconfigure({ bossId: ROOM_BOSS_OPTIONS[this.bossIndex].id });
  }

  /** 切换合作人数（2 ↔ 4）；服务端以重建房间落定（同 boss 选择的机制）。 */
  private async cycleCoopPlayers(): Promise<void> {
    this.coopPlayers = this.coopPlayers === 2 ? 4 : 2;
    await this.reconfigure({ coopPlayers: this.coopPlayers });
  }

  private async cycleShot(): Promise<void> {
    this.shotIndex = (this.shotIndex + 1) % ROOM_SHOT_OPTIONS.length;
    await this.reconfigure({ shotType: ROOM_SHOT_OPTIONS[this.shotIndex] });
  }

  private async cycleBomb(): Promise<void> {
    this.bombIndex = (this.bombIndex + 1) % ROOM_BOMB_OPTIONS.length;
    await this.reconfigure({ bombType: ROOM_BOMB_OPTIONS[this.bombIndex] });
  }

  /** Applies a host selection by re-creating the room (server fixes boss at create). */
  private async reconfigure(selection: {
    bossId?: string;
    shotType?: string;
    bombType?: string;
    coopPlayers?: number;
  }): Promise<void> {
    const room = this.options.flow.snapshot().room;
    if (room === null) {
      return;
    }
    const bossId = selection.bossId ?? room.bossId;
    const me = room.players.find((player) => player.userId === this.options.flow.snapshot().session?.userId);
    const shotType = selection.shotType ?? me?.shotType ?? '';
    const bombType = selection.bombType ?? me?.bombType ?? '';
    this.busy = true;
    this.applySnapshot(this.options.flow.snapshot());
    await this.options.flow.reconfigureRoom({
      bossId,
      shotType,
      bombType,
      coopPlayers: selection.coopPlayers ?? this.coopPlayers,
    });
    this.busy = false;
    this.applySnapshot(this.options.flow.snapshot());
  }

  private async ready(): Promise<void> {
    this.busy = true;
    this.statusText.text = t('room.readyWaiting');
    await this.options.flow.ready();
    this.busy = false;
    this.applySnapshot(this.options.flow.snapshot());
  }

  private async leave(): Promise<void> {
    this.busy = true;
    await this.options.flow.leaveRoom();
    this.busy = false;
  }

  /**
   * Handles a room shortcut. `room.ready` / `ui.activate` fire the Ready button
   * and `room.leave` / `ui.back` fire the Leave button — the same flow calls
   * their clicks make. The roster has no selection concept, so the generic
   * list-navigation actions fall through to the app-level handlers.
   */
  handleShortcut(action: ShortcutAction, _event: Laya.KeyboardEventLike): boolean {
    switch (action) {
      case 'room.ready':
      case 'ui.activate':
        // A disabled button ignores clicks; a keyboard activation must too.
        if (!this.readyButton.sprite.mouseEnabled) {
          return false;
        }
        void this.ready();
        return true;
      case 'room.leave':
      case 'ui.back':
        void this.leave();
        return true;
      default:
        return false;
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
