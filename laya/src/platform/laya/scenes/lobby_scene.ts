/**
 * Lobby screen: sign in, pick a room code, create/join a room, and use the
 * matchmaking queue.
 *
 * The lobby is two levels inside a single scene, switched by `page` and grouped
 * visibility rather than separate screens:
 *
 *   - `menu` — the main menu: six buttons (Sign in/Sign out / Play / Check-in /
 *     Shop / Inventory / Records) plus the shared profile card. The first button
 *     is context-sensitive: it reads `Sign in` (and opens the login screen)
 *     while signed out, and `Sign out` while signed in. Switching accounts is
 *     deliberately *not* a separate entry — `Sign out` already lands on the
 *     login form, and the menu stays at six buttons on purpose.
 *   - `play` — the play sub-page: the room-code card, create/join room, and the
 *     matchmaking queue controls, plus a Back button that returns to the menu.
 *
 * Layout follows a shared three-band grid (title / content / actions) so all
 * four screens breathe the same way: a `SCREEN_MARGIN` outer gutter, a title
 * band, then full-width buttons stacked on the `SPACE_*` rhythm. Every colour,
 * size and gap comes from `view/theme` — nothing is hard-coded here.
 *
 * Room codes are cycled from a small preset list rather than typed, so this
 * screen needs no text widget at all. A free-form field would not need
 * `laya.ui` either: the editable input shipped in `laya.core.js` is
 * `Laya.Input` (a `Text` subclass), which the login screen already uses — it
 * drives a DOM `<input>` on web and the `conch` native keyboard on LayaNative.
 * The classic `Laya.TextInput` is not available here because the native build
 * only loads `laya.ui2.js`, which does not export it.
 */

import type { LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import { describeMatchmakingQueue } from '../../../core/game/lobby_flow';
import { t, language } from '../../../core/game/i18n';
import { lobbyTitle } from '../../../core/game/game_identity';
import { titleLogoFor } from '../../../core/game/ui_assets';
import { coverFit } from '../../../core/game/login_assets';
import { isNativeAssetRuntime } from '../../../core/game/tna_assets';
import {
  LOBBY_BACKGROUND_SIZE,
  lobbyAssetRootCandidates,
  lobbyBackgroundUrl,
} from '../../../core/game/lobby_assets';
import * as theme from '../view/theme';
import { VectorPainter } from '../view/sprites';
import { createArtButton, createButton, createPanel, type ButtonHandle } from './ui_kit';
import { SettingsPanel, type SettingsPanelDebugState } from './settings/panel';
import { SETTINGS_BUTTON_SIZE, createSettingsButton, type SettingsButtonHandle } from './settings/gear_button';
import type { SettingsStore } from '../../../core/settings';
import type { ShortcutAction, ShortcutScope } from '../../../core/input/shortcuts';
import { resizeTextureSprite } from '../view/texture_sprite';
import { TnaUiImage } from '../view/tna_ui';
import type { ClientScene } from './scene';

const PRESET_ROOM_CODES = ['RACE01', 'RACE02', 'RACE03', 'DUEL'];

/** The two levels the lobby can show. */
type LobbyPage = 'menu' | 'play';

export interface LobbySceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
  /** Shared settings, read and written by the top-right settings modal. */
  settings: SettingsStore;
}

export class LobbyScene implements ClientScene {
  readonly root: Laya.Sprite;
  readonly shortcutScope: ShortcutScope = 'lobby';

  private readonly width: number;
  /** Stage-sized clip container for the backdrop. */
  private readonly background: Laya.Sprite;
  /** The cover-fitted art itself, offset inside `background` and clipped by it. */
  private readonly backgroundImage: Laya.Sprite;
  /** Dark translucent wash over the backdrop so the menu stays readable. */
  private readonly scrim: Laya.Sprite;
  private backgroundLoaded = false;
  /** Scaled art rect in absolute stage coords; negative offset on the cropped axis. */
  private backgroundRect = { x: 0, y: 0, width: 0, height: 0 };
  /** Title painted in the header band (the localised product name). */
  private readonly title: Laya.Text;
  /**
   * TNA 标题 logo（`ui/title_logo*.png`）。按 `docs/ART_POLICY.md`，标题美术也
   * 来自 APK：logo 一旦贴上就收起文本标题；贴不上（缺图/离线）时文本继续兜底。
   */
  private readonly titleLogo: TnaUiImage;
  /** Top-right gear button, and the modal it opens. */
  private readonly settingsButton: SettingsButtonHandle;
  /**
   * Top-right settings modal. Kept public (rather than private) so the app
   * shell can reach it through `ClientScene.settings` to service the global
   * "open settings" shortcut without knowing which screen is showing.
   */
  readonly settings: SettingsPanel;
  private readonly pageText: Laya.Text;
  private readonly profileText: Laya.Text;
  private readonly statusText: Laya.Text;
  private readonly roomCodeText: Laya.Text;
  private readonly queueText: Laya.Text;
  private readonly signInButton: ButtonHandle;
  private readonly playButton: ButtonHandle;
  private readonly createButton: ButtonHandle;
  private readonly joinButton: ButtonHandle;
  private readonly cycleButton: ButtonHandle;
  private readonly joinQueueButton: ButtonHandle;
  private readonly refreshQueueButton: ButtonHandle;
  private readonly cancelQueueButton: ButtonHandle;
  private readonly backButton: ButtonHandle;
  private readonly checkinButton: ButtonHandle;
  private readonly shopButton: ButtonHandle;
  private readonly inventoryButton: ButtonHandle;
  private readonly recordsButton: ButtonHandle;
  /** Gold ring painted over the keyboard-highlighted button (shared overlay). */
  private readonly menuFocusRing: Laya.Sprite;
  /** Sprites shown only on the main menu. */
  private readonly menuSprites: Laya.Sprite[] = [];
  /** Sprites shown only on the play sub-page. */
  private readonly playSprites: Laya.Sprite[] = [];
  private page: LobbyPage = 'menu';
  /** Keyboard highlight index into the current page's buttons; -1 = none. */
  private menuFocusIndex = -1;
  private roomCodeIndex = 0;
  private busy = false;

  constructor(private readonly options: LobbySceneOptions) {
    const { width, height } = options;
    this.width = width;
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    // --- backdrop + scrim (bottom-most) ------------------------------------
    // Added before every other child so they paint behind the whole menu. The
    // clip container stays stage-sized; the art lives on an inner sprite so the
    // cover scale never distorts it (sizing a textured sprite squashes it).
    this.background = new Laya.Sprite();
    this.root.addChild(this.background);
    this.backgroundImage = new Laya.Sprite();
    this.background.addChild(this.backgroundImage);
    this.scrim = new Laya.Sprite();
    this.root.addChild(this.scrim);

    const margin = theme.SCREEN_MARGIN;
    const contentWidth = width - margin * 2;

    // Portrait (720x1280) leaves a lot of vertical room below the action band,
    // so the three bands are spread down the screen instead of hugging the top:
    // the title stays at the margin, and the content + action bands are pushed
    // apart by an extra `SPACE_XL` step. The action buttons remain stacked on
    // the same `SPACE_*` rhythm as before.
    const sectionGap = theme.SPACE_XL;
    const step = theme.BUTTON_HEIGHT + theme.SPACE_MD;

    // --- title band (shared by both pages) ---
    this.title = this.makeText(lobbyTitle(), theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true, margin);
    this.title.y = margin;
    this.root.addChild(this.title);
    // 标题 logo 与文本标题同高、水平居中；纹理到位后文本才收起（见 `loadTitleLogo`）。
    this.titleLogo = new TnaUiImage();
    this.titleLogo.sprite.pos(width / 2, margin + theme.FONT_SIZE_TITLE / 2);
    this.root.addChild(this.titleLogo.sprite);
    const dividerY = this.title.y + theme.FONT_SIZE_TITLE + theme.SPACE_SM;
    this.root.addChild(this.divider(margin, dividerY, contentWidth));

    // One-line label naming the active level ("Main menu" / "Play").
    this.pageText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin);
    this.pageText.y = dividerY + theme.SPACE_SM;
    this.root.addChild(this.pageText);

    // --- content band: profile + status card (shared by both pages) ---
    const profileY = this.pageText.y + theme.FONT_SIZE_CAPTION + theme.SPACE_MD;
    const profileHeight = 96;
    this.root.addChild(createPanel(margin, profileY, contentWidth, profileHeight));
    this.profileText = this.makeText(t('lobby.notSignedIn'), theme.FONT_SIZE_LABEL, theme.COLOR_TEXT, false, margin + theme.SPACE_MD);
    this.profileText.y = profileY + theme.SPACE_SM;
    this.profileText.width = contentWidth - theme.SPACE_MD * 2;
    this.profileText.wordWrap = true;
    this.profileText.leading = 4;
    this.root.addChild(this.profileText);

    this.statusText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_INFO, false, margin + theme.SPACE_MD);
    this.statusText.y = profileY + profileHeight - theme.SPACE_LG;
    this.statusText.width = contentWidth - theme.SPACE_MD * 2;
    this.statusText.wordWrap = true;
    this.statusText.leading = 4;
    this.root.addChild(this.statusText);

    // The band below the profile card is reused by both pages: the play page
    // puts the room-code card here, the menu page starts its buttons here so the
    // gap left by the hidden card never shows.
    const contentY = profileY + profileHeight + sectionGap;
    const buttonX = margin;

    // --- menu page: six buttons ---
    let y = contentY;
    // Context-sensitive: "Sign in" opens the login screen while signed out;
    // "Sign out" drops the session while signed in (see `refresh`). One button
    // covers both so the menu never grows past six entries. Icons are named
    // explicitly (not derived from the label) so a language switch cannot drop
    // them: `iconNameForLabel` matches English substrings.
    this.signInButton = createArtButton(t('ui.signIn'), buttonX, y, contentWidth, () => this.onAccountButton(), 'account');
    this.addToPage(this.menuSprites, this.signInButton.sprite);
    y += step;

    this.playButton = createArtButton(t('ui.play'), buttonX, y, contentWidth, () => this.setPage('play'), 'play');
    this.addToPage(this.menuSprites, this.playButton.sprite);
    y += step;

    this.checkinButton = createButton(t('lobby.checkin'), buttonX, y, contentWidth, () => void this.openCheckin());
    this.addToPage(this.menuSprites, this.checkinButton.sprite);
    y += step;

    this.shopButton = createArtButton(t('ui.shop'), buttonX, y, contentWidth, () => this.openShop(), 'shop');
    this.addToPage(this.menuSprites, this.shopButton.sprite);
    y += step;

    this.inventoryButton = createButton(t('lobby.inventory'), buttonX, y, contentWidth, () => void this.openInventory());
    this.addToPage(this.menuSprites, this.inventoryButton.sprite);
    y += step;

    this.recordsButton = createArtButton(t('ui.records'), buttonX, y, contentWidth, () => void this.openRecords(), 'records');
    this.addToPage(this.menuSprites, this.recordsButton.sprite);

    // --- play page: room-code card, then the room + queue actions ---
    const codeCardHeight = 96;
    this.addToPage(this.playSprites, createPanel(margin, contentY, contentWidth, codeCardHeight));
    const codeCaption = this.makeText(t('ui.roomCode'), theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, margin + theme.SPACE_MD);
    codeCaption.y = contentY + theme.SPACE_SM;
    this.addToPage(this.playSprites, codeCaption);
    // Highlight frame around the code so it reads at a glance.
    this.addToPage(
      this.playSprites,
      this.panelFrame(margin + theme.SPACE_MD, contentY + 34, 160, 40, theme.COLOR_ACCENT, theme.RADIUS_SM),
    );
    this.roomCodeText = this.makeText('', theme.FONT_SIZE_HEADING, theme.COLOR_ACCENT, true, margin + theme.SPACE_MD + theme.SPACE_SM);
    this.roomCodeText.y = contentY + 40;
    this.addToPage(this.playSprites, this.roomCodeText);

    const actionsY = contentY + codeCardHeight + sectionGap;
    let py = actionsY;
    this.cycleButton = createArtButton(t('lobby.changeRoomCode'), buttonX, py, contentWidth, () => this.cycleRoomCode(), 'room');
    this.addToPage(this.playSprites, this.cycleButton.sprite);
    py += step;

    this.createButton = createArtButton(t('lobby.createRoom'), buttonX, py, contentWidth, () => void this.createRoom(), 'confirm');
    this.addToPage(this.playSprites, this.createButton.sprite);
    py += step;

    this.joinButton = createArtButton(t('lobby.joinRoom'), buttonX, py, contentWidth, () => void this.joinRoom(), 'room');
    this.addToPage(this.playSprites, this.joinButton.sprite);
    py += step;

    // Matchmaking: status line, then the queue actions packed a touch tighter.
    this.queueText = this.makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false, buttonX);
    this.queueText.y = py + theme.SPACE_XS;
    this.queueText.width = contentWidth;
    this.queueText.wordWrap = true;
    this.queueText.leading = 4;
    this.addToPage(this.playSprites, this.queueText);
    py += theme.SPACE_XS + 34;

    this.joinQueueButton = createArtButton(t('lobby.joinQueue'), buttonX, py, contentWidth, () => void this.joinQueue(), 'play');
    this.addToPage(this.playSprites, this.joinQueueButton.sprite);
    py += step;

    this.refreshQueueButton = createArtButton(t('lobby.refreshQueue'), buttonX, py, contentWidth, () => void this.refreshQueue(), 'queue');
    this.addToPage(this.playSprites, this.refreshQueueButton.sprite);
    py += step;

    this.cancelQueueButton = createArtButton(t('lobby.cancelQueue'), buttonX, py, contentWidth, () => void this.cancelQueue(), 'play');
    this.addToPage(this.playSprites, this.cancelQueueButton.sprite);
    py += step;

    this.backButton = createArtButton(t('ui.back'), buttonX, py, contentWidth, () => this.setPage('menu'), 'back');
    this.addToPage(this.playSprites, this.backButton.sprite);

    this.roomCodeIndex = 0;

    // Shared focus ring for keyboard navigation: one overlay parked over the
    // highlighted button. It is a separate sprite because the buttons' own
    // `graphics` is owned by `ui_kit` — clearing it here would erase the button
    // frame. Added before the settings modal so the modal still covers it.
    this.menuFocusRing = new Laya.Sprite();
    this.menuFocusRing.visible = false;
    this.root.addChild(this.menuFocusRing);

    // --- settings (top-right gear + modal panel) ----------------------------
    // Added last so the panel paints above the whole menu; `relayoutBackground`
    // parks the button in the corner and re-centres the card.
    this.settingsButton = createSettingsButton(0, 0, SETTINGS_BUTTON_SIZE, () => this.settings.show());
    this.root.addChild(this.settingsButton.sprite);
    this.settings = new SettingsPanel({ width, height, store: options.settings });
    this.root.addChild(this.settings.root);

    this.applyPageVisibility();
    this.refresh();
    this.relayoutBackground();
    void this.loadArt();
    void this.loadTitleLogo();
  }

  onEnter(): void {
    this.root.visible = true;
    // Re-register idempotently: `onEnter` can run again after an `onExit`.
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    Laya.stage.on(Laya.Event.RESIZE, this, this.onStageResize);
    // Returning to the lobby always lands on the main menu.
    this.page = 'menu';
    this.menuFocusIndex = -1;
    this.applyPageVisibility();
    this.relayoutBackground();
    this.paintMenuFocus();
    this.applySnapshot(this.options.flow.snapshot());
  }

  onExit(): void {
    this.root.visible = false;
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    // A modal left open would be waiting for the player on the way back in.
    this.settings.hide();
    // Drop the keyboard highlight so re-entering never shows a stale ring.
    this.menuFocusIndex = -1;
    this.paintMenuFocus();
  }

  destroy(): void {
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    this.root.destroy(true);
  }

  // --- keyboard shortcuts ---------------------------------------------------

  /**
   * Handles a lobby shortcut. The menu actions move a highlight through the
   * current page's buttons and run the highlighted one; `playPage` and `back`
   * drive the page / settings-overlay transitions. Returns true only for
   * actions this screen actually performed, so anything else falls through to
   * the app-level handlers.
   */
  handleShortcut(action: ShortcutAction, _event: Laya.KeyboardEventLike): boolean {
    switch (action) {
      case 'lobby.menuNext':
        return this.stepMenuFocus(1);
      case 'lobby.menuPrev':
        return this.stepMenuFocus(-1);
      case 'lobby.activate':
        return this.activateMenuFocus();
      case 'lobby.playPage':
        if (this.page === 'play') {
          return false;
        }
        this.setPage('play');
        return true;
      case 'lobby.back':
        if (this.settings.isOpen) {
          this.settings.hide();
          return true;
        }
        if (this.page === 'play') {
          this.setPage('menu');
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  /** Buttons on the visible page, in visual order, each paired with its click action. */
  private focusableButtons(): { handle: ButtonHandle; activate: () => void }[] {
    if (this.page === 'menu') {
      return [
        { handle: this.signInButton, activate: () => this.onAccountButton() },
        { handle: this.playButton, activate: () => this.setPage('play') },
        { handle: this.checkinButton, activate: () => void this.openCheckin() },
        { handle: this.shopButton, activate: () => this.openShop() },
        { handle: this.inventoryButton, activate: () => void this.openInventory() },
        { handle: this.recordsButton, activate: () => void this.openRecords() },
      ];
    }
    return [
      { handle: this.cycleButton, activate: () => this.cycleRoomCode() },
      { handle: this.createButton, activate: () => void this.createRoom() },
      { handle: this.joinButton, activate: () => void this.joinRoom() },
      { handle: this.joinQueueButton, activate: () => void this.joinQueue() },
      { handle: this.refreshQueueButton, activate: () => void this.refreshQueue() },
      { handle: this.cancelQueueButton, activate: () => void this.cancelQueue() },
      { handle: this.backButton, activate: () => this.setPage('menu') },
    ];
  }

  /**
   * Moves the highlight one step through the current page's buttons, wrapping
   * at both ends. The first press lands on an end rather than skipping the
   * first entry, which is what starting from `-1` gives us.
   */
  private stepMenuFocus(direction: 1 | -1): boolean {
    const count = this.focusableButtons().length;
    if (count === 0) {
      return false;
    }
    if (this.menuFocusIndex < 0) {
      this.menuFocusIndex = direction === 1 ? 0 : count - 1;
    } else {
      this.menuFocusIndex = (this.menuFocusIndex + direction + count) % count;
    }
    this.paintMenuFocus();
    return true;
  }

  /** Runs the highlighted button's click action, but only while it is enabled. */
  private activateMenuFocus(): boolean {
    const buttons = this.focusableButtons();
    const focused = this.menuFocusIndex >= 0 ? buttons[this.menuFocusIndex] : undefined;
    // A disabled button ignores clicks; a keyboard activation must too.
    if (focused === undefined || !focused.handle.sprite.mouseEnabled) {
      return false;
    }
    focused.activate();
    return true;
  }

  /**
   * Paints the gold focus ring over the highlighted button, or hides it when
   * nothing is highlighted. Uses the same `roundedOutline` + `COLOR_FIELD_FOCUS`
   * treatment as the login form's focused field.
   */
  private paintMenuFocus(): void {
    const buttons = this.focusableButtons();
    const focused = this.menuFocusIndex >= 0 ? buttons[this.menuFocusIndex] : undefined;
    const graphics = this.menuFocusRing.graphics;
    graphics.clear();
    if (focused === undefined) {
      this.menuFocusRing.visible = false;
      return;
    }
    const { sprite } = focused.handle;
    this.menuFocusRing.visible = true;
    this.menuFocusRing.pos(sprite.x, sprite.y);
    this.menuFocusRing.size(sprite.width, sprite.height);
    VectorPainter.roundedOutline(
      graphics,
      0,
      0,
      sprite.width,
      sprite.height,
      theme.RADIUS_SM,
      theme.COLOR_FIELD_FOCUS,
      2,
    );
  }

  /** Debug-only view of the rendered screen, for the local screenshot harness. */
  debugState(): {
    backgroundLoaded: boolean;
    backgroundRect: { x: number; y: number; width: number; height: number };
    backgroundOffset: { x: number; y: number };
    stage: { width: number; height: number };
    /** Title actually painted (the localised product name). */
    titleText: string;
    /** Settings button rect, so the harness can assert the top-right placement. */
    settingsButtonRect: { x: number; y: number; width: number; height: number };
    /** Settings modal state (open flag, card rect, painted labels). */
    settings: SettingsPanelDebugState;
  } {
    return {
      backgroundLoaded: this.backgroundLoaded,
      backgroundRect: {
        x: this.backgroundRect.x,
        y: this.backgroundRect.y,
        width: this.backgroundRect.width,
        height: this.backgroundRect.height,
      },
      backgroundOffset: {
        x: this.backgroundRect.x,
        y: this.backgroundRect.y,
      },
      stage: this.stageSize(),
      titleText: this.title.text,
      settingsButtonRect: {
        x: this.settingsButton.sprite.x,
        y: this.settingsButton.sprite.y,
        width: this.settingsButton.sprite.width,
        height: this.settingsButton.sprite.height,
      },
      settings: this.settings.debugState(),
    };
  }

  // --- backdrop -------------------------------------------------------------

  /**
   * Re-tiles the backdrop for the current stage size. Called on boot, on every
   * `Laya.Event.RESIZE`, and once the art finishes loading (so the fallback wash
   * is dropped). The menu content itself is fixed at boot, but the backdrop must
   * keep covering whatever logical stage the runtime picked (web 900x1200 vs the
   * wide LayaNative rectangle).
   */
  private relayoutBackground(): void {
    const { width, height } = this.stageSize();

    // `coverFit` returns the offset that centres the overflow on BOTH axes; it
    // is negative on the cropped axis (y = -75 at 900x1200). The clip container
    // stays pinned to the stage and `scrollRect` crops to it, while the art
    // sprite is placed at the raw (possibly negative) offset.
    const cover = coverFit(LOBBY_BACKGROUND_SIZE.width, LOBBY_BACKGROUND_SIZE.height, width, height);
    const artWidth = Math.round(LOBBY_BACKGROUND_SIZE.width * cover.scale);
    const artHeight = Math.round(LOBBY_BACKGROUND_SIZE.height * cover.scale);
    this.backgroundRect = { x: cover.x, y: cover.y, width: artWidth, height: artHeight };

    this.background.pos(0, 0);
    this.background.size(width, height);
    this.backgroundImage.pos(cover.x, cover.y);
    resizeTextureSprite(this.backgroundImage, artWidth, artHeight);
    if (width > 0 && height > 0) {
      this.background.scrollRect = new Laya.Rectangle(0, 0, width, height);
    } else {
      this.background.scrollRect = null;
    }

    // Fallback: a flat dark wash, so the menu never sits on a blank stage when
    // the art is missing (offline / headless / pre-art-drop). Never throws.
    this.background.graphics.clear();
    if (!this.backgroundLoaded && width > 0 && height > 0) {
      this.background.graphics.drawRect(0, 0, width, height, theme.COLOR_BACKGROUND);
    }

    // Scrim reuses the login screen's token so both screens stay in lockstep if
    // its alpha is retuned (the UI owns that value, this scene only reads it).
    this.scrim.graphics.clear();
    this.scrim.size(width, height);
    if (width > 0 && height > 0) {
      this.scrim.graphics.drawRect(0, 0, width, height, theme.COLOR_LOGIN_SCRIM);
    }

    // Settings lives in the top-right corner on both pages, and its modal has to
    // cover whatever logical stage the runtime picked (web vs LayaNative).
    this.settingsButton.setPosition(
      Math.max(0, width - theme.SCREEN_MARGIN - SETTINGS_BUTTON_SIZE),
      Math.max(0, Math.round(theme.SCREEN_MARGIN + theme.FONT_SIZE_TITLE / 2 - SETTINGS_BUTTON_SIZE / 2)),
    );
    this.settings.layout(width, height);
  }

  /** Current stage size, falling back to the boot-time options when unready. */
  private stageSize(): { width: number; height: number } {
    const stage: Laya.Stage | undefined = Laya.stage;
    if (stage !== undefined && stage.width > 0 && stage.height > 0) {
      return { width: stage.width, height: stage.height };
    }
    return { width: this.width, height: this.options.height };
  }

  private onStageResize(): void {
    this.relayoutBackground();
  }

  // --- assets ---------------------------------------------------------------

  /**
   * Loads the lobby backdrop, probing each candidate root in order and keeping
   * the first that resolves. Missing art is not an error: the painted fallback
   * wash stays in place (matching the login screen's behaviour).
   */
  private async loadArt(): Promise<void> {
    for (const root of lobbyAssetRootCandidates(isNativeAssetRuntime())) {
      if (this.backgroundLoaded) {
        break;
      }
      // eslint-disable-next-line no-await-in-loop -- roots are probed in order.
      const texture = await this.loadTexture(lobbyBackgroundUrl(root));
      if (texture !== null) {
        this.backgroundImage.texture = texture;
        this.backgroundLoaded = true;
      }
    }
    this.relayoutBackground();
  }

  /**
   * 载入 TNA 标题 logo。中文用 `title_logo_ch`、英文用 `title_logo_en_2`、
   * 其余（含日文）用日文原版——APK 把三种语言各烘焙了一张图。
   *
   * logo 到位后收起文本标题，避免「图 + 字」重复；缺图时文本继续显示，所以
   * 离线 / 资源未打包的场景也不会出现空标题。
   */
  private async loadTitleLogo(): Promise<void> {
    this.titleLogo.setImage(titleLogoFor(language()), theme.FONT_SIZE_TITLE * 1.7);
    if (await this.titleLogo.whenSettled()) {
      this.title.visible = false;
    }
  }

  /** Loads one image URL as a texture; returns `null` on any failure. */
  private async loadTexture(url: string): Promise<Laya.Texture | null> {
    let res: unknown;
    try {
      res = await Laya.loader.load(url, 'image');
    } catch {
      res = null;
    }
    let texture = unwrapTexture(res);
    if (texture === null || texture === undefined) {
      try {
        texture = unwrapTexture(Laya.loader.getRes(url));
      } catch {
        texture = null;
      }
    }
    return texture;
  }

  get roomCode(): string {
    return PRESET_ROOM_CODES[this.roomCodeIndex];
  }

  applySnapshot(snapshot: LobbyFlowSnapshot): void {
    this.statusText.text = snapshot.lastError === '' ? snapshot.statusText : snapshot.lastError;
    this.statusText.color = snapshot.lastError === '' ? theme.COLOR_INFO : theme.COLOR_DANGER;
    if (snapshot.session !== null) {
      this.profileText.text =
        `${snapshot.session.displayName} (${snapshot.session.playerId || snapshot.session.userId})\n` +
        t('lobby.profile.ruleset', { version: snapshot.session.rulesetVersion || '-' });
      this.profileText.color = theme.COLOR_TEXT;
    } else {
      this.profileText.text = t('lobby.notSignedIn');
      this.profileText.color = theme.COLOR_TEXT_DISABLED;
    }
    this.queueText.text = describeMatchmakingQueue(snapshot);
    this.refresh(snapshot);
  }

  /** Adds a sprite to the scene and tags it with the page it belongs to. */
  private addToPage(page: Laya.Sprite[], sprite: Laya.Sprite): void {
    this.root.addChild(sprite);
    page.push(sprite);
  }

  /** Shows only the sprites that belong to the current page. */
  private applyPageVisibility(): void {
    const onMenu = this.page === 'menu';
    for (const sprite of this.menuSprites) {
      sprite.visible = onMenu;
    }
    for (const sprite of this.playSprites) {
      sprite.visible = !onMenu;
    }
    this.pageText.text = onMenu ? t('lobby.page.menu') : t('lobby.page.play');
  }

  /** Switches level and refreshes both visibility and button enablement. */
  private setPage(page: LobbyPage): void {
    this.page = page;
    // The highlight is per-page: clear it so the new page starts unselected.
    this.menuFocusIndex = -1;
    this.applyPageVisibility();
    this.paintMenuFocus();
    this.refresh();
  }

  private refresh(snapshot: LobbyFlowSnapshot = this.options.flow.snapshot()): void {
    this.roomCodeText.text = this.roomCode;
    const signedIn = snapshot.session !== null;
    const queued = snapshot.matchmaking !== null;
    // Enablement is recomputed for every button on both pages, not just the
    // visible ones: hidden buttons cannot be clicked, and this keeps their state
    // correct the instant a page becomes visible again. The account button is
    // always enabled — it signs out when signed in and opens the login screen
    // when signed out — and its label flips with the session.
    this.createButton.setEnabled(signedIn && !this.busy);
    this.joinButton.setEnabled(signedIn && !this.busy);
    this.signInButton.setText(signedIn ? t('lobby.signOut') : t('ui.signIn'));
    this.signInButton.setEnabled(!this.busy);
    this.cycleButton.setEnabled(!this.busy);
    this.joinQueueButton.setEnabled(signedIn && !queued && !this.busy);
    this.refreshQueueButton.setEnabled(queued && !this.busy);
    this.cancelQueueButton.setEnabled(queued && !this.busy);
    this.checkinButton.setEnabled(signedIn && !this.busy);
    this.shopButton.setEnabled(signedIn && !this.busy);
    this.inventoryButton.setEnabled(signedIn && !this.busy);
    this.recordsButton.setEnabled(signedIn && !this.busy);
  }

  private cycleRoomCode(): void {
    this.roomCodeIndex = (this.roomCodeIndex + 1) % PRESET_ROOM_CODES.length;
    this.refresh();
  }

  /**
   * The account button: signs out when a session exists, otherwise opens the
   * login screen. Both paths are synchronous flow transitions, so no busy flag
   * is needed.
   */
  private onAccountButton(): void {
    if (this.options.flow.snapshot().session !== null) {
      this.options.flow.signOut();
    } else {
      this.options.flow.showLogin();
    }
  }

  private async createRoom(): Promise<void> {
    await this.run(() => this.options.flow.createRoom(this.roomCode));
  }

  private async joinRoom(): Promise<void> {
    await this.run(() => this.options.flow.joinRoom(this.roomCode));
  }

  private async joinQueue(): Promise<void> {
    await this.run(() => this.options.flow.joinMatchmaking());
  }

  private async refreshQueue(): Promise<void> {
    await this.run(() => this.options.flow.refreshMatchmakingTicket());
  }

  private async cancelQueue(): Promise<void> {
    await this.run(() => this.options.flow.cancelMatchmaking());
  }

  private async openCheckin(): Promise<void> {
    await this.run(() => this.options.flow.openCheckin());
  }

  private async openShop(): Promise<void> {
    await this.run(() => this.options.flow.openShop());
  }

  private async openInventory(): Promise<void> {
    await this.run(() => this.options.flow.openInventory());
  }

  private async openRecords(): Promise<void> {
    await this.run(() => this.options.flow.openRecords());
  }

  /** Runs a flow action with the busy flag set and the screen refreshed after. */
  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy = true;
    this.refresh();
    try {
      await action();
    } finally {
      this.busy = false;
      this.refresh();
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

  /** A thin horizontal rule drawn with the shared divider helper. */
  private divider(x: number, y: number, length: number): Laya.Sprite {
    const sprite = new Laya.Sprite();
    VectorPainter.divider(sprite.graphics, x, y, length, true);
    return sprite;
  }

  /** A rounded outline used to frame the highlighted room code. */
  private panelFrame(x: number, y: number, w: number, h: number, color: string, radius: number): Laya.Sprite {
    const sprite = new Laya.Sprite();
    VectorPainter.roundedOutline(sprite.graphics, x, y, w, h, radius, color, 2);
    return sprite;
  }
}

/**
 * Unwraps the value returned by LayaAir's image loader.
 *
 * `Laya.loader.load(url, 'image')` normally resolves with the `Texture`, but
 * some engine revisions wrap it (`{ texture }` / `{ data }`); the `getRes`
 * cache probe already returns the raw texture. Anything without a numeric
 * `width` is rejected so the caller keeps its fallback. Mirrors the login
 * screen's helper (kept local so the two scenes stay independent).
 */
function unwrapTexture(res: unknown): Laya.Texture | null {
  if (typeof res !== 'object' || res === null) {
    return null;
  }
  const record = res as Record<string, unknown>;
  const candidates = [record.texture, record.data, res];
  for (const candidate of candidates) {
    if (typeof candidate === 'object' && candidate !== null && typeof (candidate as Laya.Texture).width === 'number') {
      return candidate as Laya.Texture;
    }
  }
  return null;
}
