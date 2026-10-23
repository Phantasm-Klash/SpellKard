/**
 * Settings panel shell: the modal that hosts the five sections.
 *
 * Structure (all inside one centred card):
 *
 *   header    "Settings" + Close
 *   tabs      Display / Audio / HUD / Other / About
 *   subtitle  one line describing the active tab
 *   viewport  the active section's rows, clipped and drag-scrollable
 *   footer    "Restore defaults"
 *
 * Only the shell lives here; each tab's content is a `SettingsSection` in its
 * own file. The panel owns the scrim, the card, the tab switching, the scroll
 * (drag *and* mouse wheel) and the debug snapshot the screenshot harness reads.
 *
 * Scrolling is hand-rolled with `scrollRect` rather than `laya.ui`'s Panel:
 * the two runtimes load incompatible UI libraries (classic `laya.ui` on web,
 * FairyGUI's `laya.ui2` on LayaNative), so a stock `Panel` exists on neither
 * shared surface — see the note in `widgets.ts`.
 *
 * NOTE: `platform/laya/` only.
 */

import type { SettingsStore } from '../../../../core/settings';
import { normalizeKey } from '../../../../core/input/shortcuts';
import type { ShortcutAction } from '../../../../core/input/shortcuts';
import { t } from '../../../../core/game/i18n';
import { titlePlaque } from '../../../../core/game/ui_assets';
import * as theme from '../../view/theme';
import { VectorPainter } from '../../view/sprites';
import { TnaUiImage } from '../../view/tna_ui';
import { createOfficialWidget } from '../../ui/official_widgets';
import { skinScrollBarV } from '../../ui/official_skin';
import { createButtonEx, type ButtonHandle } from '../ui_kit';
import { platformTagline } from '../../platform';
import { BaseSettingsSection, type SettingsSection } from './section';
import { AboutSection } from './section_about';
import { AudioSection } from './section_audio';
import { DisplaySection } from './section_display';
import { HudSection } from './section_hud';
import { KeysSection } from './section_keys';
import { OtherSection } from './section_other';
import { LanguageSection } from './section_language';
import { ROW_HEIGHT } from './widgets';

const CARD_MAX_WIDTH = 560;
const CARD_MAX_HEIGHT = 660;
const CARD_PAD = 16;
const HEADER_H = 34;
const TAB_H = 32;
const TAB_GAP = 4;
const SUBTITLE_H = 18;
const FOOTER_H = 38;
/** Width of the scroll indicator gutter inside the viewport. */
const SCROLLBAR_W = 4;
/**
 * Pixels scrolled per mouse-wheel notch.
 *
 * The engine hands `MOUSE_WHEEL` a `delta` in notches (`deltaY * 0.025`, so a
 * physical notch is ≈ ±3); this is the per-notch travel. Three rows is the
 * conventional "one screen nudge" for a list this size.
 */
const WHEEL_NOTCH_PX = 48;

export interface SettingsPanelOptions {
  width: number;
  height: number;
  store: SettingsStore;
  /** Invoked after the panel becomes hidden, on either close path. */
  onClose?: () => void;
}

export interface SettingsPanelDebugState {
  open: boolean;
  /** Title of the active tab. */
  activeTab: string;
  /** Every tab label, in order. */
  tabs: string[];
  subtitle: string;
  cardRect: { x: number; y: number; width: number; height: number };
  /** Height the active section needs. */
  contentHeight: number;
  /** Whether the active section overflows its viewport. */
  scrollable: boolean;
  /** Scroll offset (0 = top). */
  scrollTop: number;
  /**
   * Platform tag from {@link platformTagline} — `"Windows · native client"`
   * on the shipped LayaNative build. The screenshot harness records it so a
   * shot always says which runtime produced it.
   */
  platform: string;
  /** Every string painted: header, tabs, subtitle, active section, footer. */
  labels: string[];
}

export class SettingsPanel {
  readonly root: Laya.Sprite;

  private readonly options: SettingsPanelOptions;
  private readonly store: SettingsStore;
  private readonly scrim: Laya.Sprite;
  private readonly card: Laya.Sprite;
  private readonly heading: Laya.Text;
  /**
   * TNA `ui/bar_config.png`：APK 烘焙的「CONFIG」标题牌。它到位后收起文本
   * 标题（`docs/ART_POLICY.md`：标题美术也来自 APK），缺图时文本继续兜底。
   */
  private readonly headingPlaque: TnaUiImage;
  private readonly subtitleText: Laya.Text;
  private readonly viewport: Laya.Sprite;
  private readonly content: Laya.Sprite;
  private readonly scrollThumb: Laya.Sprite;
  /** The official `ScrollBarV.lh` instance when the prefab library loaded. */
  private officialScrollBar: Laya.Sprite | null = null;
  /** Whether the prefab has been attempted once (a miss is not retried). */
  private officialScrollBarTried = false;
  private readonly tabButtons: ButtonHandle[] = [];
  private readonly sections: SettingsSection[];
  /** Public so the local screenshot harness can drive the close path. */
  readonly closeButton: ButtonHandle;
  private readonly resetButton: ButtonHandle;

  private width: number;
  private height: number;
  private cardRect = { x: 0, y: 0, width: 0, height: 0 };
  private viewportRect = { x: 0, y: 0, width: 0, height: 0 };
  private activeIndex = 0;
  private shown = false;
  private scrollTop = 0;
  private dragging = false;
  private dragStartY = 0;
  private dragStartScroll = 0;
  private releaseArmed = false;
  /** Language the shell's own labels were painted in; see {@link applyLanguage}. */
  private paintedLanguage: string;

  constructor(options: SettingsPanelOptions) {
    this.options = options;
    this.store = options.store;
    this.paintedLanguage = this.store.get().language;
    this.width = options.width;
    this.height = options.height;

    this.sections = [
      // Language first: it is the setting a player looks for before anything
      // else when the UI is not in their language.
      new LanguageSection(this.store),
      new DisplaySection(this.store),
      new KeysSection(this.store),
      new AudioSection(this.store),
      new HudSection(this.store),
      new OtherSection(this.store),
      new AboutSection(this.store),
    ];

    this.root = new Laya.Sprite();
    this.root.size(this.width, this.height);
    this.root.visible = false;

    this.scrim = new Laya.Sprite();
    this.root.addChild(this.scrim);

    // Mouse-enabled so a tap on the card never reaches the scrim (which closes).
    this.card = new Laya.Sprite();
    this.card.mouseEnabled = true;
    this.root.addChild(this.card);

    this.heading = makeLabel(t('settings.title'), theme.FONT_SIZE_HEADING, theme.COLOR_TITLE, true);
    this.card.addChild(this.heading);
    this.headingPlaque = new TnaUiImage();
    this.headingPlaque.setAnchor(0, 0.5);
    this.card.addChild(this.headingPlaque.sprite);

    this.closeButton = createButtonEx(t('settings.close'), 0, 0, 72, () => this.hide(), 'ghost', HEADER_H - 6);
    this.card.addChild(this.closeButton.sprite);

    for (const section of this.sections) {
      const index = this.tabButtons.length;
      const button = createButtonEx(section.title, 0, 0, 80, () => this.selectTab(index), 'ghost', TAB_H);
      this.card.addChild(button.sprite);
      this.tabButtons.push(button);
    }

    this.subtitleText = makeLabel('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false);
    this.card.addChild(this.subtitleText);

    // The viewport clips the section; the content sprite inside it is what
    // actually moves while dragging.
    //
    // ★ `mouseEnabled` is deliberately left at its default on both the
    // viewport's content sprite and the section roots. An explicitly
    // `mouseEnabled = false` container is skipped wholesale by
    // `InputManager.getSpriteUnderPoint` (a `_mouseState` of 1 blocks descent
    // into the whole subtree), which is exactly what made every row control
    // — toggles, segmented options, sliders, buttons — unreachable. With the
    // default state, each control's own `mouseEnabled = true` marks the
    // ancestor chain as hit-testable (`setMouseEnabledUp`), and a press on
    // bare row space still bubbles down to the viewport's drag-scroll below.
    this.viewport = new Laya.Sprite();
    this.viewport.mouseEnabled = true;
    this.card.addChild(this.viewport);
    this.content = new Laya.Sprite();
    this.viewport.addChild(this.content);
    for (const section of this.sections) {
      // Sections are stacked in the content sprite; only the active one is
      // visible, which keeps every section's state alive across tab switches.
      section.root.visible = false;
      this.content.addChild(section.root);
    }

    this.scrollThumb = new Laya.Sprite();
    this.card.addChild(this.scrollThumb);

    this.resetButton = createButtonEx(
      t('settings.restoreDefaults'),
      0,
      0,
      150,
      () => this.restoreDefaults(),
      'danger',
      FOOTER_H - 8,
    );
    this.card.addChild(this.resetButton.sprite);

    // Tapping the dimmed area outside the card closes the panel.
    this.scrim.on(Laya.Event.CLICK, undefined, () => this.hide());

    // The shell owns the tab bar, the header and the footer, and those are
    // painted once from `t()` at construction. Switching language would
    // therefore leave a panel whose tabs are Chinese and whose Close button is
    // still English, so repaint the shell whenever the stored language moves.
    this.store.subscribe(() => this.applyLanguage());

    this.bindScroll();
    this.selectTab(0);
    this.layout(this.width, this.height);
  }

  get isOpen(): boolean {
    return this.shown;
  }

  /** Title of the active tab (used by the harness and by the scenes). */
  get activeTab(): string {
    return this.sections[this.activeIndex].title;
  }

  show(): void {
    this.shown = true;
    this.root.visible = true;
    // Re-read the store: something outside the panel (a reset, a URL override)
    // may have changed it while the panel was closed.
    this.applyLanguage();
    this.sections[this.activeIndex].refresh();
    this.scrollTop = 0;
    this.applyScroll();
  }

  hide(): void {
    if (!this.shown) {
      return;
    }
    this.shown = false;
    this.root.visible = false;
    this.options.onClose?.();
  }

  toggle(): void {
    if (this.shown) {
      this.hide();
    } else {
      this.show();
    }
  }

  /** Switches tabs by index (clamped) and refreshes that section. */
  selectTab(index: number): void {
    const next = Math.max(0, Math.min(this.sections.length - 1, Math.round(index)));
    this.activeIndex = next;
    for (let i = 0; i < this.sections.length; i += 1) {
      this.sections[i].root.visible = i === next;
      this.tabButtons[i].setVariant?.(i === next ? 'primary' : 'ghost');
    }
    this.subtitleText.text = this.sections[next].subtitle;
    this.sections[next].refresh();
    this.scrollTop = 0;
    this.applyScroll();
  }

  /** Re-centres the scrim and the card for the current stage size. */
  layout(width: number, height: number): void {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.root.size(this.width, this.height);

    this.scrim.graphics.clear();
    this.scrim.size(this.width, this.height);
    if (this.width > 0 && this.height > 0) {
      this.scrim.graphics.drawRect(0, 0, this.width, this.height, theme.COLOR_MODAL_SCRIM);
    }

    const gutter = theme.SCREEN_MARGIN;
    const cardWidth = Math.round(
      Math.max(0, Math.min(CARD_MAX_WIDTH, this.width - gutter * 2, this.width)),
    );
    const cardHeight = Math.round(Math.max(0, Math.min(CARD_MAX_HEIGHT, this.height - gutter * 2)));
    const cardX = Math.round((this.width - cardWidth) / 2);
    const cardY = Math.round((this.height - cardHeight) / 2);
    this.cardRect = { x: cardX, y: cardY, width: cardWidth, height: cardHeight };

    this.card.pos(cardX, cardY);
    this.card.graphics.clear();
    if (cardWidth > 0 && cardHeight > 0) {
      VectorPainter.roundedPanel(
        this.card.graphics,
        0,
        0,
        cardWidth,
        cardHeight,
        theme.RADIUS_MD,
        theme.COLOR_PANEL,
        theme.COLOR_PANEL_BORDER,
        2,
      );
    }

    const innerW = Math.max(0, cardWidth - CARD_PAD * 2);

    // --- header ---
    this.heading.pos(CARD_PAD, CARD_PAD);
    this.heading.width = Math.max(0, innerW - 84);
    // 标题牌左对齐到标题的位置、垂直居中于标题行；贴图一到就收起文本标题。
    this.headingPlaque.sprite.pos(CARD_PAD, CARD_PAD + theme.FONT_SIZE_HEADING / 2);
    this.headingPlaque.setImage(titlePlaque('config'), theme.FONT_SIZE_HEADING * 1.6);
    void this.headingPlaque.whenSettled().then((ready) => {
      this.heading.visible = !ready;
    });
    this.closeButton.setSize(72, HEADER_H - 6);
    this.closeButton.sprite.pos(cardWidth - CARD_PAD - 72, CARD_PAD - 2);

    // --- tab bar ---
    const tabY = CARD_PAD + HEADER_H;
    const tabWidth = this.sections.length > 0 ? Math.floor((innerW - TAB_GAP * (this.sections.length - 1)) / this.sections.length) : 0;
    for (let i = 0; i < this.tabButtons.length; i += 1) {
      this.tabButtons[i].setSize(tabWidth, TAB_H);
      this.tabButtons[i].sprite.pos(CARD_PAD + i * (tabWidth + TAB_GAP), tabY);
    }

    // --- subtitle ---
    const subtitleY = tabY + TAB_H + 6;
    this.subtitleText.pos(CARD_PAD, subtitleY);
    this.subtitleText.width = innerW;

    // --- viewport + footer ---
    const viewportY = subtitleY + SUBTITLE_H;
    const viewportH = Math.max(0, cardHeight - viewportY - FOOTER_H - CARD_PAD);
    this.viewportRect = { x: CARD_PAD, y: viewportY, width: innerW, height: viewportH };
    this.viewport.pos(CARD_PAD, viewportY);
    this.viewport.size(innerW, viewportH);
    this.viewport.scrollRect =
      innerW > 0 && viewportH > 0 ? new Laya.Rectangle(0, 0, innerW, viewportH) : null;

    this.resetButton.setSize(150, FOOTER_H - 8);
    this.resetButton.sprite.pos(CARD_PAD, cardHeight - CARD_PAD - (FOOTER_H - 8));

    const contentWidth = Math.max(0, innerW - SCROLLBAR_W - 4);
    for (const section of this.sections) {
      section.layout(contentWidth);
    }
    this.applyScroll();
  }

  /** Debug-only view of the panel, for the local screenshot harness. */
  debugState(): SettingsPanelDebugState {
    const section = this.sections[this.activeIndex];
    const maxScroll = Math.max(0, section.contentHeight - this.viewportRect.height);
    return {
      open: this.shown,
      activeTab: section.title,
      tabs: this.sections.map((item) => item.title),
      subtitle: section.subtitle,
      cardRect: { ...this.cardRect },
      contentHeight: section.contentHeight,
      scrollable: maxScroll > 0,
      scrollTop: this.scrollTop,
      platform: platformTagline(),
      labels: [
        this.heading.text,
        ...this.sections.map((item) => item.title),
        section.subtitle,
        ...section.debugLabels(),
        this.resetButton.label.text,
        this.closeButton.label.text,
      ],
    };
  }

  /** Switches tabs by title (case-insensitive); returns whether it matched. */
  selectTabByTitle(title: string): boolean {
    const wanted = title.trim().toLowerCase();
    const index = this.sections.findIndex((section) => section.title.toLowerCase() === wanted);
    if (index < 0) {
      return false;
    }
    this.selectTab(index);
    return true;
  }

  /** Restores every group to its shipped default and redraws the active tab. */
  restoreDefaults(): void {
    this.store.reset();
    for (const section of this.sections) {
      section.refresh();
    }
    this.scrollTop = 0;
    this.applyScroll();
  }

  /**
   * Repaints the shell's own strings in the current language.
   *
   * The tab bar, the header and the footer are built once from `t()` at
   * construction, while the section bodies resolve their strings on every
   * rebuild. Switching language therefore left a half-translated panel — the
   * tabs in the new language, `Close` still in the old one — so this re-texts
   * the shell in place and rebuilds the visible section. It is a no-op unless
   * the language actually moved, which keeps it safe to call from `show()`.
   */
  private applyLanguage(): void {
    const code = this.store.get().language;
    if (code === this.paintedLanguage) {
      return;
    }
    this.paintedLanguage = code;
    this.heading.text = t('settings.title');
    this.closeButton.setText(t('settings.close'));
    this.resetButton.setText(t('settings.restoreDefaults'));
    for (let i = 0; i < this.tabButtons.length; i += 1) {
      this.tabButtons[i].setText(this.sections[i].title);
    }
    this.subtitleText.text = this.sections[this.activeIndex].subtitle;
    this.sections[this.activeIndex].refresh();
    this.applyScroll();
  }

  /**
   * Handles a settings-scoped shortcut. Returns true when it was consumed.
   * A no-op (returns false) while the panel is closed.
   */
  handleShortcut(action: ShortcutAction, event: Laya.KeyboardEventLike): boolean {
    if (!this.shown) {
      return false;
    }
    switch (action) {
      case 'app.settingsClose':
        this.hide();
        return true;
      case 'settings.tabNext':
        this.selectTab((this.activeIndex + 1) % this.sections.length);
        return true;
      case 'settings.tabPrev':
        this.selectTab((this.activeIndex - 1 + this.sections.length) % this.sections.length);
        return true;
      case 'settings.scrollUp':
      case 'settings.scrollDown': {
        // PageUp / PageDown share the scroll action with the arrow keys but
        // should move a whole viewport; the arrows move a single row.
        const key = normalizeKey(event.key, event.keyCode);
        const step = key === 'pageup' || key === 'pagedown' ? this.viewportRect.height : ROW_HEIGHT;
        const direction = action === 'settings.scrollUp' ? -1 : 1;
        this.scrollTop = clamp(this.scrollTop + direction * step, 0, this.maxScroll());
        this.applyScroll();
        return true;
      }
      case 'settings.scrollTop':
        this.scrollTop = 0;
        this.applyScroll();
        return true;
      case 'settings.scrollBottom':
        this.scrollTop = this.maxScroll();
        this.applyScroll();
        return true;
      case 'settings.reset':
        this.restoreDefaults();
        return true;
      default:
        return false;
    }
  }

  // --- scrolling ------------------------------------------------------------

  /**
   * Drag-to-scroll over the viewport. Registered on the viewport sprite, which
   * sits *below* the rows, so a drag that starts on a row still scrolls: mouse
   * events bubble up the ancestor chain, so a press on a row (or on one of its
   * controls — the slider claims its own press with `stopPropagation`) reaches
   * this listener too.
   *
   * Mouse-wheel scrolling is handled here as well. The engine dispatches
   * `Event.MOUSE_WHEEL` on both runtimes (on LayaNative the `conch` mouse bridge
   * synthesises the `wheel` event), with `event.delta` in notches
   * (`deltaY * 0.025` — one physical notch is roughly ±3).
   */
  private bindScroll(): void {
    this.viewport.on(Laya.Event.MOUSE_DOWN, undefined, () => {
      const maxScroll = this.maxScroll();
      if (maxScroll <= 0) {
        return;
      }
      this.dragging = true;
      this.dragStartY = this.viewport.mouseY;
      this.dragStartScroll = this.scrollTop;
      this.armRelease();
    });
    this.viewport.on(Laya.Event.MOUSE_MOVE, undefined, () => {
      if (!this.dragging) {
        return;
      }
      const delta = this.viewport.mouseY - this.dragStartY;
      this.scrollTop = clamp(this.dragStartScroll - delta, 0, this.maxScroll());
      this.applyScroll();
    });
    this.viewport.on(Laya.Event.MOUSE_UP, undefined, () => {
      this.dragging = false;
    });
    this.viewport.on(Laya.Event.MOUSE_WHEEL, undefined, (...args: unknown[]) => {
      if (this.maxScroll() <= 0) {
        return;
      }
      // `Sprite.on` types the handler as `(...args: unknown[]) => void`, so the
      // event is narrowed here rather than declared in the signature — a
      // parameter typed `MouseEventLike` is not assignable to `unknown`.
      const event = args[0] as Laya.MouseEventLike | undefined;
      const notches = event?.delta ?? 0;
      if (!Number.isFinite(notches) || notches === 0) {
        return;
      }
      this.scrollTop = clamp(this.scrollTop + notches * WHEEL_NOTCH_PX, 0, this.maxScroll());
      this.applyScroll();
    });
  }

  /** A release outside the viewport must still end the drag (self-removing). */
  private armRelease(): void {
    if (this.releaseArmed) {
      return;
    }
    this.releaseArmed = true;
    const onRelease = (): void => {
      this.dragging = false;
      this.releaseArmed = false;
      Laya.stage.off(Laya.Event.MOUSE_UP, undefined, onRelease);
    };
    Laya.stage.on(Laya.Event.MOUSE_UP, undefined, onRelease);
  }

  private maxScroll(): number {
    return Math.max(0, this.sections[this.activeIndex].contentHeight - this.viewportRect.height);
  }

  /** Pushes `scrollTop` onto the content sprite and repaints the indicator. */
  /**
   * Returns the official scrollbar, creating it on first use.
   *
   * The prefab is loaded asynchronously, so it may simply not be there yet —
   * the caller falls back to the painted thumb in that case, and the next
   * `applyScroll` (a tab switch, a wheel notch) picks it up once it lands.
   */
  private ensureOfficialScrollBar(): Laya.Sprite | null {
    if (this.officialScrollBar !== null) {
      return this.officialScrollBar;
    }
    if (this.officialScrollBarTried) {
      return null;
    }
    this.officialScrollBarTried = true;
    const created = createOfficialWidget('scrollBarV');
    if (created === null) {
      return null;
    }
    clearOfficialText(created);
    // The prefab ships the engine's light `comp.atlas` art; repaint it in the
    // TNA palette and drop its arrow buttons (the panel drives the offset).
    skinScrollBarV(created);
    // The panel owns the offset (drag / wheel / keyboard all write
    // `scrollTop`), so the prefab's own input is switched off: leaving it on
    // would give the scrollbar a second, competing driver.
    created.mouseEnabled = false;
    this.card.addChild(created);
    this.officialScrollBar = created;
    return created;
  }

  private applyScroll(): void {
    const max = this.maxScroll();
    this.scrollTop = clamp(this.scrollTop, 0, max);
    this.content.pos(0, -this.scrollTop);

    const viewH = this.viewportRect.height;
    this.scrollThumb.graphics.clear();

    // The official `ScrollBarV.lh` prefab (`internal/UI/`) when it has loaded:
    // it ships a track, a draggable grip and up/down buttons, all skinned from
    // `comp.atlas`. It is used for what it is good at — the scrollbar's own
    // look and hit box — while the panel keeps ownership of the scroll *offset*
    // (drag, wheel and keyboard all still go through `scrollTop`), so one code
    // path stays authoritative. The prefab's buttons are cleared of text and
    // left unbound: wiring them would mean a second, competing scroll driver.
    const official = this.ensureOfficialScrollBar();
    if (max <= 0 || viewH <= 0) {
      if (official !== null) {
        official.visible = false;
      }
      return;
    }
    const contentH = this.sections[this.activeIndex].contentHeight;
    const thumbH = Math.max(24, Math.round((viewH / contentH) * viewH));
    const thumbY =
      this.viewportRect.y + Math.round((this.scrollTop / max) * Math.max(0, viewH - thumbH));
    const thumbX = this.viewportRect.x + this.viewportRect.width - SCROLLBAR_W;

    if (official !== null) {
      official.visible = true;
      official.size(SCROLLBAR_W, viewH);
      official.pos(thumbX, this.viewportRect.y);
      // `grip` is the prefab's own draggable part; it is repositioned and
      // resized to track the offset the panel computed.
      const grip = findChildByName(official, 'grip');
      if (grip !== null) {
        grip.size(SCROLLBAR_W, thumbH);
        grip.y = thumbY - this.viewportRect.y;
      }
      return;
    }

    VectorPainter.roundedPanel(
      this.scrollThumb.graphics,
      thumbX,
      thumbY,
      SCROLLBAR_W,
      thumbH,
      SCROLLBAR_W / 2,
      theme.COLOR_PANEL_BORDER,
      undefined,
      0,
    );
  }
}

/** Concise text factory: one place that sets font, weight and colour. */
function makeLabel(text: string, size: number, color: string, bold: boolean): Laya.Text {
  const label = new Laya.Text();
  label.text = text;
  label.fontSize = size;
  label.color = color;
  label.bold = bold;
  return label;
}

/**
 * Clears every text child of an official widget.
 *
 * The `ScrollBarV.lh` prefab carries label children sized for its own layout;
 * left alone they would paint stray text over the panel.
 */
function clearOfficialText(widget: Laya.Sprite): void {
  for (let i = 0; i < widget.numChildren; i += 1) {
    const child = widget.getChildAt(i);
    if (child === null || child === undefined) {
      continue;
    }
    const labelled = child as Laya.Sprite & { text?: unknown };
    if (typeof labelled.text === 'string') {
      labelled.text = '';
    }
  }
}

/**
 * Finds a direct child by name, or `null`.
 *
 * `name` is read through a widened record: the project's Laya typings do not
 * declare it on `Sprite`, though the engine sets it for every prefab child
 * (`ScrollBarV.lh` names its parts `bg` / `bar` / `grip` / `up` / `down`).
 */
function findChildByName(widget: Laya.Sprite, name: string): Laya.Sprite | null {
  for (let i = 0; i < widget.numChildren; i += 1) {
    const child = widget.getChildAt(i);
    if (child === null || child === undefined) {
      continue;
    }
    const named = child as unknown as { name?: unknown };
    if (named.name === name) {
      return child;
    }
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/** Re-exported so scene code can talk about sections without a second import. */
export type { SettingsSection, BaseSettingsSection };
