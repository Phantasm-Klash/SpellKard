/**
 * Login screen: the first thing the client shows.
 *
 * It paints the 千夜追忆 title art as a full-bleed backdrop, drops a Reimu
 * portrait beside/above the form, and hosts the account form (sign in / sign
 * up). Returning to the lobby is a keyboard-only action (`login.back`, i.e.
 * `Shift+Escape`) — there is no on-screen Back button. All state lives in
 * `LobbyFlow`; this scene only reads the snapshot and calls flow methods,
 * exactly like the other screens.
 *
 * Layout is derived from the *live* stage size via the engine-agnostic
 * `loginLayout`, and recomputed on every `Laya.Event.RESIZE`, because the web
 * stage (900x1200) and the LayaNative stage (a wide, window-dependent
 * rectangle) are very different. See `BattleScene` for the same pattern.
 *
 * The backdrop is `object-fit: cover`, centred: the art is scaled to fill the
 * stage and the overflow is split evenly across both edges instead of being
 * pinned to the top. The crop is done with a `scrollRect` clip on a stage-sized
 * container, with the art on an inner sprite offset by the raw cover offset —
 * see `relayout`. The spell-sigil disc (`login_sigil.png`) is optional and
 * falls back to a flat vector ellipse when the file is missing.
 *
 * Text entry uses `Laya.Input` (an editable `Text` in `laya.core.js`, present
 * on BOTH web and LayaNative). The classic `Laya.TextInput` is NOT used: the
 * native `laya.ui2.js` build does not export it, and `Laya.Input` already wires
 * up the DOM input on web and the `conch` keyboard on native.
 */

import type { AuthMode, LobbyFlow, LobbyFlowSnapshot } from '../../../core/game/lobby_flow';
import { t } from '../../../core/game/i18n';
import { gameTitle } from '../../../core/game/game_identity';
import { isNativeAssetRuntime } from '../../../core/game/tna_assets';
import {
  LOGIN_BACKGROUND_SIZE,
  coverFit,
  loginAssetRootCandidates,
  loginBackgroundUrl,
  loginPortraitUrl,
  loginSigilUrl,
} from '../../../core/game/login_assets';
import {
  LOGIN_BLOCK_GAP,
  LOGIN_BUTTON_COUNT,
  LOGIN_BUTTON_GAP,
  LOGIN_BUTTON_H,
  LOGIN_CARD_PAD,
  LOGIN_CARD_TITLE_H,
  LOGIN_ENDPOINT_H,
  LOGIN_FIELD_GAP,
  LOGIN_FIELD_H,
  LOGIN_STATUS_H,
  loginEmailRowMetrics,
  loginLayout,
  type LoginLayout,
} from '../../../core/game/login_layout';
import * as theme from '../view/theme';
import { VectorPainter } from '../view/sprites';
import { createArtButton, type ButtonHandle } from './ui_kit';
import { SettingsPanel, type SettingsPanelDebugState } from './settings/panel';
import { SETTINGS_BUTTON_SIZE, createSettingsButton, type SettingsButtonHandle } from './settings/gear_button';
import type { SettingsStore } from '../../../core/settings';
import { stepFocus } from '../../../core/input/shortcuts';
import type { ShortcutAction, ShortcutScope } from '../../../core/input/shortcuts';
import { attachCaretPlacement, blurAll } from '../text_input';
import { resizeTextureSprite } from '../view/texture_sprite';
import type { ClientScene } from './scene';

export interface LoginSceneOptions {
  width: number;
  height: number;
  flow: LobbyFlow;
  /** Lobby endpoint shown under the status line so a connection failure is actionable. */
  lobbyEndpoint?: string;
  /** Shared settings, read and written by the top-right settings modal. */
  settings: SettingsStore;
}

/** An editable field plus the frame sprite that paints its fill and outline. */
interface Field {
  readonly frame: Laya.Sprite;
  readonly input: Laya.Input;
  focused: boolean;
}

/** Snapshot of the rendered login screen, for the local screenshot harness. */
export interface LoginDebugState {
  backgroundLoaded: boolean;
  portraitLoaded: boolean;
  sigilLoaded: boolean;
  authMode: AuthMode;
  cardRect: { x: number; y: number; width: number; height: number };
  portraitRect: { x: number; y: number; width: number; height: number; scale: number };
  backgroundRect: { x: number; y: number; width: number; height: number };
  /** Raw `coverFit` offset of the backdrop; negative on the cropped axis. */
  backgroundOffset: { x: number; y: number };
  /** Halo disc rect (zero when the stage has no room for it). */
  haloRect: { x: number; y: number; width: number; height: number };
  stacked: boolean;
  /** Whether the confirm-password field is on screen (register mode only). */
  confirmVisible: boolean;
  /** Whether the e-mail verification-code field is on screen (register mode only). */
  codeVisible: boolean;
  /** Compact "Send code" button rect (zero-sized when the mode hides it). */
  emailSendButtonRect: { x: number; y: number; width: number; height: number };
  /** Current label of the "Send code" button ("Send code" / "Resend 12s"). */
  emailSendButtonText: string;
  /** Seconds left before the code may be re-sent; 0 when it may be sent now. */
  codeResendSeconds: number;
  /** Whether the compact send-code button is currently clickable. */
  emailSendButtonEnabled: boolean;
  /** Title actually painted (the localised product name). */
  titleText: string;
  /** Settings button rect, so the harness can assert the top-right placement. */
  settingsButtonRect: { x: number; y: number; width: number; height: number };
  /** Settings modal state (open flag, card rect, painted labels). */
  settings: SettingsPanelDebugState;
  /**
   * Index of the field that owns the keyboard, in tab order, or -1 when none
   * does. This is the scene's own focus bookkeeping (not the engine's), which
   * is exactly what `Tab` / `Shift+Tab` drive.
   */
  focusedFieldIndex: number;
  /** How many fields the current mode shows: 2 signing in, 5 registering. */
  visibleFieldCount: number;
}

export class LoginScene implements ClientScene {
  readonly root: Laya.Sprite;
  /**
   * Public because `ClientScene` exposes it: `app.ts` services the global
   * "open settings" shortcut through the active screen rather than reaching
   * into a concrete scene.
   */
  readonly settings: SettingsPanel;
  readonly shortcutScope: ShortcutScope = 'login';

  private readonly options: LoginSceneOptions;
  /** Stage-sized clip container for the backdrop. */
  private readonly background: Laya.Sprite;
  /** The cover-fitted art itself, offset inside `background` and clipped by it. */
  private readonly backgroundImage: Laya.Sprite;
  private readonly scrim: Laya.Sprite;
  private readonly glow: Laya.Sprite;
  private readonly sigil: Laya.Sprite;
  private readonly portrait: Laya.Sprite;
  private readonly title: Laya.Text;
  private readonly settingsButton: SettingsButtonHandle;
  private readonly card: Laya.Sprite;
  private readonly cardTitle: Laya.Text;
  /** Register-only handle; hidden in sign-in mode. */
  private readonly username: Field;
  private readonly email: Field;
  private readonly password: Field;
  private readonly confirm: Field;
  /** The 6-digit e-mail verification code mailed by `POST /v1/auth/email/code`. */
  private readonly code: Field;
  private readonly statusText: Laya.Text;
  private readonly endpointText: Laya.Text;

  // Buttons are created once and resized in place via `ButtonHandle.setSize`
  // when the card width changes, so they cannot be `readonly`; `buttonsWidth`
  // is the width they were last sized to.
  private primaryButton!: ButtonHandle;
  private secondaryButton!: ButtonHandle;
  /** Compact button inside the e-mail row that mails the verification code. */
  private emailSendButton!: ButtonHandle;
  private buttonsWidth = -1;
  /** Seconds left before "Send code" becomes clickable again (0 = ready). */
  private codeResendSeconds = 0;
  /** Set while a code request is in flight, so the button cannot be double-fired. */
  private sendingCode = false;

  private layout: LoginLayout;
  private backgroundLoaded = false;
  private portraitLoaded = false;
  private sigilLoaded = false;
  /** Raw `coverFit` offset of the backdrop (may be negative). */
  private backgroundOffset = { x: 0, y: 0 };
  /** Set once the user has edited the username, so snapshots never clobber it. */
  private usernameDirty = false;
  /** Same guard for the e-mail field (the sign-in identifier). */
  private emailDirty = false;
  /** Guards programmatic text writes from flipping `usernameDirty`. */
  private suppressChange = false;
  /** Local validation message (e.g. password mismatch); cleared on every submit. */
  private localError = '';
  private busy = false;
  private mode: AuthMode = 'login';

  constructor(options: LoginSceneOptions) {
    this.options = options;
    const { width, height } = this.stageSize();
    this.layout = loginLayout(width, height);

    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    // --- backdrop + scrim ---------------------------------------------------
    // The clip container stays stage-sized; the art lives on an inner sprite so
    // the cover scale never distorts it (sizing a textured sprite squashes it).
    this.background = new Laya.Sprite();
    this.root.addChild(this.background);
    this.backgroundImage = new Laya.Sprite();
    this.background.addChild(this.backgroundImage);
    this.scrim = new Laya.Sprite();
    this.root.addChild(this.scrim);

    // --- portrait + halo ----------------------------------------------------
    // `glow` is the vector fallback; `sigil` is the optional art disc. Only one
    // is ever visible, and both sit behind the portrait.
    this.glow = new Laya.Sprite();
    this.root.addChild(this.glow);
    this.sigil = new Laya.Sprite();
    this.sigil.visible = false;
    this.root.addChild(this.sigil);
    this.portrait = new Laya.Sprite();
    this.root.addChild(this.portrait);

    // --- title --------------------------------------------------------------
    // The Chinese product name is the title; the Latin wordmark that used to sit
    // under it as a caption is gone (see `game_identity`).
    this.title = this.makeLabel(gameTitle(), theme.FONT_SIZE_TITLE, theme.COLOR_TITLE, true);
    this.title.align = 'center';
    this.root.addChild(this.title);

    // --- form card ----------------------------------------------------------
    // The shared `createPanel` helper adds an opaque inset wash that would hide
    // the backdrop, so the card is painted as a single translucent rounded panel
    // with the same `VectorPainter` helper it uses internally.
    this.card = new Laya.Sprite();
    this.root.addChild(this.card);

    this.cardTitle = this.makeLabel(t('login.title'), theme.FONT_SIZE_HEADING, theme.COLOR_TITLE, true);
    this.card.addChild(this.cardTitle);

    this.username = this.createField(t('login.username'), 'text', 24, () => {
      this.usernameDirty = true;
    });
    this.email = this.createField(t('login.email'), 'text', 254, () => {
      this.emailDirty = true;
    });
    this.password = this.createField(t('login.password'), 'password', 64);
    this.confirm = this.createField(t('login.confirmPassword'), 'password', 64);
    this.code = this.createField(t('login.emailCode'), 'text', 6);

    // The compact "Send code" button lives inside the e-mail row. It is created
    // here (so it is a sibling of the fields, painted above them) and positioned
    // by `layoutCardContent`.
    this.emailSendButton = createArtButton(
      t('login.sendCode'),
      0,
      0,
      0,
      () => void this.sendEmailCode(),
      'gift',
      'ghost',
      LOGIN_FIELD_H,
    );
    this.card.addChild(this.emailSendButton.sprite);

    this.statusText = this.makeLabel('', theme.FONT_SIZE_CAPTION, theme.COLOR_INFO, false);
    this.statusText.wordWrap = true;
    this.statusText.leading = 4;
    this.card.addChild(this.statusText);

    // Sits under the status line and only appears when the flow is not connected;
    // it names the lobby endpoint so a failure is actionable rather than opaque.
    this.endpointText = this.makeLabel('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false);
    this.endpointText.visible = false;
    this.card.addChild(this.endpointText);

    // --- settings (top-right gear + modal panel) ----------------------------
    // Added last so the panel paints above the whole screen; `relayout` places
    // the button and re-centres the card.
    this.settingsButton = createSettingsButton(0, 0, SETTINGS_BUTTON_SIZE, () => this.openSettings());
    this.root.addChild(this.settingsButton.sprite);
    this.settings = new SettingsPanel({ width, height, store: options.settings });
    this.root.addChild(this.settings.root);

    this.relayout();
    void this.loadArt();
    this.refresh();
  }

  onEnter(): void {
    this.root.visible = true;
    // Re-register idempotently: `onEnter` can run again after an `onExit`.
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    Laya.stage.on(Laya.Event.RESIZE, this, this.onStageResize);
    this.relayout();
    this.applySnapshot(this.options.flow.snapshot());
  }

  onExit(): void {
    this.root.visible = false;
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    // A modal left open would be waiting for the player on the way back in.
    this.settings.hide();
    // The DOM input the engine overlays is independent of the canvas, so it must
    // be closed explicitly or it would linger over the next screen.
    this.blurFields();
    this.stopCodeCountdown();
  }

  destroy(): void {
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    this.stopCodeCountdown();
    this.blurFields();
    this.root.destroy(true);
  }

  applySnapshot(snapshot: LobbyFlowSnapshot): void {
    this.mode = snapshot.authMode;
    this.applyModeLabels();

    // Echo the last username back, but never while the user is mid-edit (that
    // would reset the caret and drop characters they just typed).
    if (!this.usernameDirty) {
      this.setInputText(this.username.input, snapshot.authUsername);
    }
    // The address is the sign-in identifier, so it is echoed in both modes.
    if (!this.emailDirty) {
      this.setInputText(this.email.input, snapshot.authEmail);
    }

    // A mode flip adds/removes the confirm field, so the card content must be
    // re-laid out here (a stage RESIZE is not the only thing that changes it).
    this.layoutCardContent();
    // `refresh` owns the status line (including the busy override) so there is a
    // single place that decides what the player reads.
    this.refresh(snapshot);
  }

  /** Debug-only view of the rendered screen, for the local screenshot harness. */
  debugState(): LoginDebugState {
    return {
      backgroundLoaded: this.backgroundLoaded,
      portraitLoaded: this.portraitLoaded,
      sigilLoaded: this.sigilLoaded,
      authMode: this.mode,
      cardRect: {
        x: this.layout.card.x,
        y: this.layout.card.y,
        width: this.layout.card.width,
        height: this.layout.card.height,
      },
      portraitRect: {
        x: this.layout.portrait.x,
        y: this.layout.portrait.y,
        width: this.layout.portrait.width,
        height: this.layout.portrait.height,
        scale: this.layout.portrait.scale,
      },
      backgroundRect: {
        x: this.layout.background.x,
        y: this.layout.background.y,
        width: this.layout.background.width,
        height: this.layout.background.height,
      },
      backgroundOffset: { x: this.backgroundOffset.x, y: this.backgroundOffset.y },
      haloRect: {
        x: this.layout.halo.x,
        y: this.layout.halo.y,
        width: this.layout.halo.width,
        height: this.layout.halo.height,
      },
      stacked: this.layout.stacked,
      confirmVisible: this.confirm.frame.visible,
      codeVisible: this.code.frame.visible,
      emailSendButtonRect: {
        x: this.emailSendButton.sprite.x,
        y: this.emailSendButton.sprite.y,
        width: this.emailSendButton.sprite.width,
        height: this.emailSendButton.sprite.height,
      },
      emailSendButtonText: this.emailSendButton.label.text,
      codeResendSeconds: this.codeResendSeconds,
      emailSendButtonEnabled: this.emailSendButton.sprite.mouseEnabled,
      titleText: this.title.text,
      settingsButtonRect: {
        x: this.settingsButton.sprite.x,
        y: this.settingsButton.sprite.y,
        width: this.settingsButton.sprite.width,
        height: this.settingsButton.sprite.height,
      },
      settings: this.settings.debugState(),
      focusedFieldIndex: this.visibleFields().findIndex((field) => field.focused),
      visibleFieldCount: this.visibleFields().length,
    };
  }

  // --- layout ---------------------------------------------------------------

  /** Re-tiles the whole screen for the current stage size. */
  private relayout(): void {
    const { width, height } = this.stageSize();
    this.layout = loginLayout(width, height);
    this.root.size(width, height);

    // --- backdrop: cover-fit, centred crop ----------------------------------
    // `coverFit` returns the offset that centres the overflow on BOTH axes; it
    // is negative on the cropped axis (y = -75 at 900x1200). The clip container
    // stays pinned to the stage and `scrollRect` crops to it, while the art
    // sprite is placed at the raw (possibly negative) offset. Clipping at (0,0)
    // rather than at the offset keeps the result correct whether or not the
    // renderer also translates a scrolled subtree — the sprite position alone
    // decides where the art lands.
    const cover = coverFit(LOGIN_BACKGROUND_SIZE.width, LOGIN_BACKGROUND_SIZE.height, width, height);
    this.backgroundOffset = { x: cover.x, y: cover.y };
    this.background.pos(0, 0);
    this.background.size(width, height);
    this.backgroundImage.pos(cover.x, cover.y);
    resizeTextureSprite(
      this.backgroundImage,
      Math.round(LOGIN_BACKGROUND_SIZE.width * cover.scale),
      Math.round(LOGIN_BACKGROUND_SIZE.height * cover.scale),
    );
    if (width > 0 && height > 0) {
      this.background.scrollRect = new Laya.Rectangle(0, 0, width, height);
    } else {
      this.background.scrollRect = null;
    }
    if (this.backgroundLoaded) {
      // Drop any fallback painted before the art arrived.
      this.background.graphics.clear();
    } else {
      this.paintFallbackBackdrop(width, height);
    }

    this.scrim.graphics.clear();
    this.scrim.size(width, height);
    if (width > 0 && height > 0) {
      this.scrim.graphics.drawRect(0, 0, width, height, theme.COLOR_LOGIN_SCRIM);
    }

    // --- portrait halo ------------------------------------------------------
    const p = this.layout.portrait;
    const halo = this.layout.halo;
    // The layout guarantees the disc stays inside the stage, so a zero-size
    // halo means there is genuinely no room — draw neither halo then.
    const hasHalo = halo.width > 0;
    // Only one of the two halos is ever on screen: the art disc when it loaded,
    // the flat ellipse otherwise.
    this.glow.visible = !this.sigilLoaded && hasHalo;
    this.glow.graphics.clear();
    if (this.glow.visible) {
      // A soft ellipse behind the art, sized to hug the portrait (a little wider
      // than the art, a little shorter) so it reads as a halo, not a plate.
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height * 0.42;
      const rw = p.width * 1.3;
      const rh = p.height * 0.95;
      this.glow.graphics.drawEllipse(cx - rw / 2, cy - rh / 2, rw, rh, theme.COLOR_PORTRAIT_GLOW);
    }
    this.sigil.visible = this.sigilLoaded && hasHalo;
    if (this.sigil.visible) {
      // `loginLayout` centres the disc on the chest/waist and clamps it inside
      // the stage, so the scene just paints it at the returned rect.
      this.sigil.pos(halo.x, halo.y);
      this.sigil.size(halo.width, halo.height);
    }
    this.portrait.pos(p.x, p.y);
    this.portrait.size(p.width, p.height);

    const titleY = theme.SPACE_MD;
    this.title.pos(0, titleY);
    this.title.width = width;

    // Settings sits in the top-right corner, centred on the title band.
    this.settingsButton.setPosition(
      Math.max(0, width - theme.SCREEN_MARGIN - SETTINGS_BUTTON_SIZE),
      Math.max(0, Math.round(titleY + theme.FONT_SIZE_TITLE / 2 - SETTINGS_BUTTON_SIZE / 2)),
    );
    this.settings.layout(width, height);

    this.paintCard();
    this.layoutCardContent();
  }

  /** Repaints the translucent card panel at the current card rect. */
  private paintCard(): void {
    const width = this.layout.card.width;
    // `loginLayout` is the single source of truth for the card height (it
    // already reserves the endpoint row); the clamp is a belt-and-braces guard
    // for degenerate stages.
    const height = Math.min(this.layout.card.height, Math.max(0, this.stageSize().height - this.layout.card.y));
    this.card.pos(this.layout.card.x, this.layout.card.y);
    this.card.graphics.clear();
    if (width > 0 && height > 0) {
      VectorPainter.roundedPanel(
        this.card.graphics,
        0,
        0,
        width,
        height,
        theme.RADIUS_MD,
        theme.COLOR_LOGIN_CARD,
        theme.COLOR_PANEL_BORDER,
        2,
      );
    }
  }

  /** Places every card child, centred vertically so both modes look balanced. */
  private layoutCardContent(): void {
    const cardWidth = this.layout.card.width;
    const cardHeight = this.layout.card.height;
    const innerX = LOGIN_CARD_PAD;
    const innerW = Math.max(0, cardWidth - LOGIN_CARD_PAD * 2);

    const fields = this.visibleFields();
    const fieldsHeight = fields.length * LOGIN_FIELD_H + Math.max(0, fields.length - 1) * LOGIN_FIELD_GAP;
    const buttonsHeight = LOGIN_BUTTON_COUNT * LOGIN_BUTTON_H + Math.max(0, LOGIN_BUTTON_COUNT - 1) * LOGIN_BUTTON_GAP;
    const contentHeight =
      LOGIN_CARD_PAD +
      LOGIN_CARD_TITLE_H +
      LOGIN_BLOCK_GAP +
      fieldsHeight +
      LOGIN_BLOCK_GAP +
      LOGIN_STATUS_H +
      LOGIN_ENDPOINT_H +
      LOGIN_BLOCK_GAP +
      buttonsHeight +
      LOGIN_CARD_PAD;

    // `LOGIN_CARD_CONTENT_H` (inside `loginLayout`) reserves the tallest
    // (register) form; centre the shorter login form inside it instead of
    // leaving a gap at the bottom.
    let y = Math.max(0, Math.round((cardHeight - contentHeight) / 2)) + LOGIN_CARD_PAD;

    this.cardTitle.pos(innerX, y);
    this.cardTitle.width = innerW;
    y += LOGIN_CARD_TITLE_H + LOGIN_BLOCK_GAP;

    // The e-mail row is split between the address input and the compact
    // "Send code" button; every other row spans the card.
    const emailRow = loginEmailRowMetrics(innerW);
    for (const field of fields) {
      const isEmailRow = field === this.email;
      this.positionField(field, innerX, y, isEmailRow ? emailRow.inputWidth : innerW);
      if (isEmailRow) {
        this.positionEmailSendButton(
          innerX + Math.max(0, innerW - emailRow.buttonWidth),
          y,
          emailRow.buttonWidth,
        );
      }
      y += LOGIN_FIELD_H + LOGIN_FIELD_GAP;
    }
    // Fields the current mode hides still need sane geometry, so a later mode
    // flip does not flash them at a stale position/size.
    for (const field of this.allFields()) {
      if (!fields.includes(field)) {
        this.positionField(field, innerX, y, innerW);
      }
    }
    this.applyFieldVisibility(fields);
    this.emailSendButton.sprite.visible = this.mode === 'register';
    y -= LOGIN_FIELD_GAP; // the loop added one gap too many after the last field
    y += LOGIN_BLOCK_GAP;

    this.statusText.pos(innerX, y);
    this.statusText.width = innerW;
    // The endpoint caption sits directly under the status line; the row is
    // always reserved so the card never reflows when it appears.
    this.endpointText.pos(innerX, y + LOGIN_STATUS_H);
    this.endpointText.width = innerW;
    y += LOGIN_STATUS_H + LOGIN_ENDPOINT_H + LOGIN_BLOCK_GAP;

    this.ensureButtons(innerX, y, innerW);
  }

  /** Positions a field's frame + input inside the card at `(x, y)`. */
  private positionField(field: Field, x: number, y: number, width: number): void {
    field.frame.pos(x, y);
    field.frame.size(width, LOGIN_FIELD_H);
    field.input.pos(x + theme.SPACE_MD, y);
    field.input.size(Math.max(0, width - theme.SPACE_MD * 2), LOGIN_FIELD_H);
    this.paintFieldFrame(field);
  }

  /** Positions and resizes the compact "Send code" button inside the e-mail row. */
  private positionEmailSendButton(x: number, y: number, width: number): void {
    this.emailSendButton.setSize(width, LOGIN_FIELD_H);
    this.emailSendButton.sprite.pos(x, y);
  }

  /** Paints a field's fill + outline, gold while focused. */
  private paintFieldFrame(field: Field): void {
    const width = field.frame.width;
    const height = field.frame.height;
    field.frame.graphics.clear();
    if (width <= 0 || height <= 0) {
      return;
    }
    VectorPainter.roundedPanel(
      field.frame.graphics,
      0,
      0,
      width,
      height,
      theme.RADIUS_SM,
      theme.COLOR_FIELD_BG,
      field.focused ? theme.COLOR_FIELD_FOCUS : theme.COLOR_FIELD_BORDER,
      field.focused ? 2 : 1,
    );
  }

  /**
   * Creates the two action buttons once, then resizes them in place with
   * `ButtonHandle.setSize` and repositions them on every layout pass. The old
   * code destroyed and rebuilt the handles whenever the card width changed,
   * which dropped hover/pressed state and re-parented the sprites on each
   * stage resize.
   */
  private ensureButtons(x: number, y: number, width: number): void {
    if (this.primaryButton === undefined) {
      // Icons are named explicitly (not derived from the label) so a language
      // switch cannot drop them: `iconNameForLabel` matches English substrings.
      this.primaryButton = createArtButton(
        t('ui.signIn'),
        x,
        y,
        width,
        () => void this.submit(),
        'account',
        'primary',
        LOGIN_BUTTON_H,
      );
      this.card.addChild(this.primaryButton.sprite);
      this.secondaryButton = createArtButton(
        t('ui.createAccount'),
        x,
        y,
        width,
        () => this.toggleMode(),
        'confirm',
        'ghost',
        LOGIN_BUTTON_H,
      );
      this.card.addChild(this.secondaryButton.sprite);
      this.buttonsWidth = width;
    } else if (this.buttonsWidth !== width) {
      this.primaryButton.setSize(width, LOGIN_BUTTON_H);
      this.secondaryButton.setSize(width, LOGIN_BUTTON_H);
      this.buttonsWidth = width;
    }

    const step = LOGIN_BUTTON_H + LOGIN_BUTTON_GAP;
    this.primaryButton.sprite.pos(x, y);
    this.secondaryButton.sprite.pos(x, y + step);
  }

  /** Applies the mode-dependent heading to the card title. */
  private applyModeLabels(): void {
    this.cardTitle.text = this.mode === 'register' ? t('ui.createAccount') : t('login.title');
  }

  /** Solid + banded fallback backdrop when the art is unavailable. */
  private paintFallbackBackdrop(width: number, height: number): void {
    const g = this.background.graphics;
    g.clear();
    if (width <= 0 || height <= 0) {
      return;
    }
    g.drawRect(0, 0, width, height, theme.COLOR_BACKGROUND);
    // Two translucent bands stand in for the sky/ground split of the art.
    g.alpha(0.7);
    g.drawRect(0, 0, width, Math.round(height * 0.6), theme.COLOR_PLAYFIELD);
    g.drawRect(0, Math.round(height * 0.6), width, Math.round(height * 0.4), theme.COLOR_PANEL_DEEP);
    g.alpha(1);
  }

  /** Current stage size, falling back to the boot-time options when unready. */
  private stageSize(): { width: number; height: number } {
    const stage: Laya.Stage | undefined = Laya.stage;
    if (stage !== undefined && stage.width > 0 && stage.height > 0) {
      return { width: stage.width, height: stage.height };
    }
    return { width: this.options.width, height: this.options.height };
  }

  private onStageResize(): void {
    this.relayout();
  }

  // --- assets ---------------------------------------------------------------

  /**
   * Loads the backdrop, portrait and (optional) spell sigil, probing each
   * candidate root in order and keeping the first that resolves. Falls back to a
   * painted backdrop and a vector halo when the loader is unavailable or the art
   * is missing (offline / headless / pre-art-drop) — never throws, never blanks.
   */
  private async loadArt(): Promise<void> {
    const candidates = loginAssetRootCandidates(isNativeAssetRuntime());
    for (const root of candidates) {
      if (!this.backgroundLoaded) {
        // eslint-disable-next-line no-await-in-loop -- roots are probed in order.
        const bg = await this.loadTexture(loginBackgroundUrl(root));
        if (bg !== null) {
          this.backgroundImage.texture = bg;
          this.backgroundLoaded = true;
        }
      }
      if (!this.portraitLoaded) {
        // eslint-disable-next-line no-await-in-loop -- roots are probed in order.
        const portrait = await this.loadTexture(loginPortraitUrl(root));
        if (portrait !== null) {
          this.portrait.texture = portrait;
          this.portraitLoaded = true;
        }
      }
      if (!this.sigilLoaded) {
        // Optional art: a failed probe just leaves the ellipse fallback in place.
        // eslint-disable-next-line no-await-in-loop -- roots are probed in order.
        const sigil = await this.loadTexture(loginSigilUrl(root));
        if (sigil !== null) {
          this.sigil.texture = sigil;
          this.sigilLoaded = true;
        }
      }
      if (this.backgroundLoaded && this.portraitLoaded && this.sigilLoaded) {
        break;
      }
    }
    this.relayout();
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

  // --- form ----------------------------------------------------------------

  /** Builds an editable field: a frame sprite plus a `Laya.Input` on top. */
  private createField(prompt: string, type: string, maxChars: number, onChange?: () => void): Field {
    const frame = new Laya.Sprite();
    this.card.addChild(frame);

    const input = new Laya.Input();
    input.editable = true;
    input.type = type;
    input.prompt = prompt;
    input.promptColor = theme.COLOR_TEXT_DISABLED;
    input.maxChars = maxChars;
    input.color = theme.COLOR_TEXT;
    input.fontSize = theme.FONT_SIZE_BODY;
    input.valign = 'middle';
    input.align = 'left';
    // `Input` hit-tests against its own size, and the engine's text-input adapter
    // focuses it from a mouse-down capture — no manual focus call is needed.
    input.mouseEnabled = true;
    this.card.addChild(input);

    const field: Field = { frame, input, focused: false };
    // Click-to-caret. The engine's overlay focuses the field without telling the
    // browser where the pointer landed, so a click anywhere in a filled box
    // parks the caret at the end of the text. See `platform/laya/text_input`.
    attachCaretPlacement(input);
    input.on(Laya.Event.FOCUS, this, () => this.setFieldFocus(field, true));
    input.on(Laya.Event.BLUR, this, () => this.setFieldFocus(field, false));
    // Enter confirms the form. The engine dispatches ENTER on the focused field
    // and then closes its overlay, so this is the hook for "Enter while typing";
    // the shortcut layer covers the same action when no field has focus.
    input.on(Laya.Event.ENTER, this, () => {
      if (!this.busy) {
        void this.submit();
      }
    });
    if (type === 'text' && onChange !== undefined) {
      input.on(Laya.Event.CHANGE, this, () => {
        if (!this.suppressChange) {
          onChange();
        }
      });
    }
    return field;
  }

  private setFieldFocus(field: Field, focused: boolean): void {
    field.focused = focused;
    this.paintFieldFrame(field);
  }

  /**
   * The fields the current mode actually shows, in tab order.
   *
   * Sign-in takes an e-mail address and a password. Sign-up additionally asks
   * for the username, the password confirmation and the verification code that
   * was mailed to the address.
   */
  private visibleFields(): Field[] {
    return this.mode === 'register'
      ? [this.username, this.email, this.password, this.confirm, this.code]
      : [this.email, this.password];
  }

  /** Every field the card owns, whether or not the current mode shows it. */
  private allFields(): Field[] {
    return [this.username, this.email, this.password, this.confirm, this.code];
  }

  /** Shows exactly `fields`, hiding the rest (frame and input together). */
  private applyFieldVisibility(fields: Field[]): void {
    for (const field of this.allFields()) {
      const shown = fields.includes(field);
      field.frame.visible = shown;
      field.input.visible = shown;
    }
  }

  /** The field that currently owns the keyboard, or null. */
  private focusedField(): Field | null {
    for (const field of this.visibleFields()) {
      if (field.focused) {
        return field;
      }
    }
    return null;
  }

  /**
   * Moves focus through the form for `Tab` / `Shift+Tab`, wrapping at both ends
   * and skipping any field the busy lock has disabled.
   *
   * No explicit blur is needed: assigning `focus = true` makes the engine's
   * adapter end the previous field itself, so the two overlays never coexist.
   */
  private stepFieldFocus(direction: 1 | -1): void {
    const fields = this.visibleFields();
    const current = fields.findIndex((field) => field.focused);
    const next = stepFocus(fields, current, direction, (field) => field.input.mouseEnabled);
    if (next < 0) {
      return;
    }
    const target = fields[next];
    if (target !== undefined) {
      target.input.focus = true;
    }
  }

  /**
   * Handles a login-scoped shortcut. Returns true when it was consumed.
   *
   * The settings modal is checked first: while it is up it owns the keyboard,
   * so a stray `Tab` cannot move focus into a form field hidden behind it.
   */
  handleShortcut(action: ShortcutAction, event: Laya.KeyboardEventLike): boolean {
    if (this.settings.isOpen) {
      // `Ctrl+,` / `F1` while the modal is up means "close", not "open again".
      if (action === 'app.settings') {
        this.closeSettings();
        return true;
      }
      if (this.settings.handleShortcut(action, event)) {
        // The panel may have just closed, taking its own DOM input fields with
        // it in spirit but not in fact — the overlay is independent of canvas.
        if (!this.settings.isOpen) {
          this.closeSettings();
        }
        return true;
      }
      return false;
    }

    switch (action) {
      case 'app.settings':
        this.openSettings();
        return true;
      case 'login.focusNext':
        this.stepFieldFocus(1);
        return true;
      case 'login.focusPrev':
        this.stepFieldFocus(-1);
        return true;
      case 'login.submit':
        // With a field focused the engine's own ENTER event already submits;
        // firing here as well would double-submit.
        if (this.focusedField() !== null) {
          return false;
        }
        void this.submit();
        return true;
      case 'login.toggleMode':
        this.toggleMode();
        return true;
      case 'login.sendCode':
        // Register-only, and only while the button is actually clickable —
        // otherwise a stray keypress would spend a cooldown for nothing.
        if (this.mode !== 'register' || this.busy || this.sendingCode || this.codeResendSeconds > 0) {
          return false;
        }
        void this.sendEmailCode();
        return true;
      case 'login.back':
        return this.back();
      case 'app.settingsClose':
        // Escape leaves the field first, then the screen.
        if (this.focusedField() !== null) {
          this.blurFields();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  /** Closes the settings modal and any DOM overlay input that came with it. */
  private closeSettings(): void {
    blurAll(this.root);
    this.settings.hide();
  }

  /**
   * Opens the settings modal, ending any live text overlay first.
   *
   * A focused field's overlay is a DOM element positioned in window space, so
   * it paints above *every* canvas layer — including a modal opened on top of
   * it. Blurring first is what keeps the stray field from floating over the
   * panel (measured: the login field's overlay stayed visible over the
   * Sharpening row).
   */
  private openSettings(): void {
    this.blurFields();
    this.settings.show();
  }

  /** Closes the native/DOM input for every field (used when leaving the screen). */
  private blurFields(): void {
    for (const field of this.allFields()) {
      if (field.focused) {
        field.input.focus = false;
      }
    }
  }

  /** Writes text without tripping the user-edit guard. */
  private setInputText(input: Laya.Input, value: string): void {
    if (input.text === value) {
      return;
    }
    this.suppressChange = true;
    input.text = value;
    this.suppressChange = false;
  }

  /** Flips between sign-in and sign-up on the flow. */
  private toggleMode(): void {
    this.localError = '';
    this.usernameDirty = false;
    // A code belongs to one address and one attempt; flipping the form starts a
    // clean slate rather than leaving a live countdown on a hidden button.
    this.stopCodeCountdown();
    this.options.flow.setAuthMode(this.mode === 'register' ? 'login' : 'register');
  }

  /**
   * Back to the lobby when a session exists; returns whether it navigated.
   *
   * Reached only through the `login.back` shortcut (`Shift+Escape`) — the login
   * screen has no on-screen Back button.
   */
  private back(): boolean {
    const snapshot = this.options.flow.snapshot();
    if (snapshot.session !== null) {
      this.options.flow.backToLobby();
      return true;
    }
    return false;
  }

  /** Submits the form: sign in, or register when the flow is in register mode. */
  private async submit(): Promise<void> {
    this.localError = '';
    const email = this.email.input.text;
    const password = this.password.input.text;
    if (this.mode === 'register') {
      const username = this.username.input.text;
      const code = this.code.input.text;
      if (username.trim() === '') {
        this.localError = t('login.error.username');
        this.refresh();
        return;
      }
      if (password !== this.confirm.input.text) {
        // Local guard: never send a request the server would reject anyway.
        this.localError = t('login.error.passwordMismatch');
        this.refresh();
        return;
      }
      if (code.trim() === '') {
        this.localError = t('login.error.codeRequired');
        this.refresh();
        return;
      }
      await this.run(() => this.options.flow.registerAccount(username, email, password, code));
      return;
    }
    await this.run(() => this.options.flow.signInWithAccount(email, password));
  }

  /**
   * Mails a verification code to the address currently in the e-mail field.
   *
   * The cooldown the button shows comes from the server's own rate limit
   * (`resend_in_seconds`), so the countdown can never drift out of step with
   * what the lobby will accept.
   */
  private async sendEmailCode(): Promise<void> {
    if (this.busy || this.sendingCode || this.codeResendSeconds > 0) {
      return;
    }
    const email = this.email.input.text.trim();
    if (email === '') {
      this.localError = t('login.error.emailRequired');
      this.refresh();
      return;
    }
    this.localError = '';
    this.sendingCode = true;
    this.refreshCodeButton();
    try {
      const result = await this.options.flow.requestEmailCode(email);
      if (result.ok) {
        this.startCodeCountdown(result.resendInSeconds);
      }
    } finally {
      this.sendingCode = false;
      this.refresh();
    }
  }

  /** Starts the "resend in Ns" countdown shown on the send-code button. */
  private startCodeCountdown(seconds: number): void {
    Laya.timer.clear(this, this.onCodeCountdown);
    this.codeResendSeconds = Math.max(0, Math.round(seconds));
    if (this.codeResendSeconds > 0) {
      Laya.timer.loop(1000, this, this.onCodeCountdown);
    }
    this.refreshCodeButton();
  }

  /** One second of the resend countdown. */
  private onCodeCountdown(): void {
    this.codeResendSeconds = Math.max(0, this.codeResendSeconds - 1);
    if (this.codeResendSeconds === 0) {
      Laya.timer.clear(this, this.onCodeCountdown);
    }
    this.refreshCodeButton();
  }

  /** Stops the countdown (leaving the screen, or flipping mode). */
  private stopCodeCountdown(): void {
    Laya.timer.clear(this, this.onCodeCountdown);
    this.codeResendSeconds = 0;
  }

  /**
   * Repaints the compact send-code button. It is disabled while a request is in
   * flight, while the form is busy, and for the whole cooldown window.
   */
  private refreshCodeButton(): void {
    if (this.emailSendButton === undefined) {
      return;
    }
    const counting = this.codeResendSeconds > 0;
    this.emailSendButton.setText(counting ? t('login.resendCode', { seconds: this.codeResendSeconds }) : t('login.sendCode'));
    this.emailSendButton.setEnabled(!this.busy && !this.sendingCode && !counting);
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

  /**
   * Single place that decides what the player sees and can click. Handles the
   * mode labels, the busy lock (button text + disabled inputs), the status line
   * and the endpoint caption.
   */
  private refresh(snapshot: LobbyFlowSnapshot = this.options.flow.snapshot()): void {
    if (this.primaryButton === undefined) {
      return;
    }
    const register = this.mode === 'register';

    // Busy swaps the primary label for a progress verb and locks every control
    // so a second submit cannot race the first.
    this.primaryButton.setText(
      this.busy
        ? register
          ? t('login.creatingAccount')
          : t('login.signingIn')
        : register
          ? t('login.signUpAndPlay')
          : t('ui.signIn'),
    );
    this.secondaryButton.setText(register ? t('login.backToSignIn') : t('ui.createAccount'));
    this.primaryButton.setEnabled(!this.busy);
    this.secondaryButton.setEnabled(!this.busy);

    for (const field of this.allFields()) {
      field.input.mouseEnabled = !this.busy;
    }
    this.applyFieldPrompts();
    this.refreshCodeButton();

    const message = this.busy
      ? t('login.connecting')
      : this.localError !== ''
        ? this.localError
        : snapshot.lastError !== ''
          ? snapshot.lastError
          : snapshot.statusText;
    const danger = !this.busy && (this.localError !== '' || snapshot.lastError !== '');
    this.statusText.text = message;
    this.statusText.color = danger ? theme.COLOR_DANGER : theme.COLOR_INFO;

    this.refreshEndpoint(snapshot);
  }

  /**
   * Re-applies the field prompts from the active language. The prompts are set
   * once at construction, so without this a language switch would leave the
   * form showing the previous language until the screen is rebuilt.
   */
  private applyFieldPrompts(): void {
    this.username.input.prompt = t('login.username');
    this.email.input.prompt = t('login.email');
    this.password.input.prompt = t('login.password');
    this.confirm.input.prompt = t('login.confirmPassword');
    this.code.input.prompt = t('login.emailCode');
  }

  /**
   * Shows `Lobby: <endpoint>` under the status line while the client is signed
   * out and the last failure was a connection problem (or it never connected),
   * so "Not connected" tells the player which host it could not reach.
   */
  private refreshEndpoint(snapshot: LobbyFlowSnapshot): void {
    const endpoint = this.options.lobbyEndpoint ?? '';
    const show = endpoint !== '' && snapshot.session === null && this.isDisconnected(snapshot);
    this.endpointText.visible = show;
    this.endpointText.text = show ? t('login.lobbyEndpoint', { endpoint }) : '';
  }

  /** True when the flow is signed out because it could not reach the lobby. */
  private isDisconnected(snapshot: LobbyFlowSnapshot): boolean {
    // `transport_error` is the raw code `LobbyFlow` stores in `authErrorCode`
    // when a sign-in attempt cannot reach the server (see `auth_messages`).
    if (snapshot.authErrorCode === 'transport_error') {
      return true;
    }
    // Before the first attempt there is no error code yet; the flow's initial
    // status is literally "Not connected".
    return snapshot.statusText === 'Not connected' || snapshot.statusText.startsWith('Lobby transport closed');
  }

  /** Concise text factory: one place that sets font, weight and colour. */
  private makeLabel(text: string, size: number, color: string, bold: boolean): Laya.Text {
    const label = new Laya.Text();
    label.text = text;
    label.fontSize = size;
    label.color = color;
    label.bold = bold;
    return label;
  }
}

/**
 * Unwraps the value returned by LayaAir's image loader.
 *
 * `Laya.loader.load(url, 'image')` normally resolves with the `Texture`, but
 * some engine revisions wrap it (`{ texture }` / `{ data }`); the `getRes`
 * cache probe already returns the raw texture. Anything without a numeric
 * `width` is rejected so the caller keeps its fallback.
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
