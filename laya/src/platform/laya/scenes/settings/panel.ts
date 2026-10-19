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
 * and the debug snapshot the screenshot harness reads.
 *
 * Scrolling is hand-rolled with `scrollRect` rather than `laya.ui`'s Panel:
 * the native runtime does not load `laya.ui`, and a drag is all this needs.
 *
 * NOTE: `platform/laya/` only.
 */

import type { SettingsStore } from '../../../../core/settings';
import { normalizeKey } from '../../../../core/input/shortcuts';
import type { ShortcutAction } from '../../../../core/input/shortcuts';
import * as theme from '../../view/theme';
import { VectorPainter } from '../../view/sprites';
import { createButtonEx, type ButtonHandle } from '../ui_kit';
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
  private readonly subtitleText: Laya.Text;
  private readonly viewport: Laya.Sprite;
  private readonly content: Laya.Sprite;
  private readonly scrollThumb: Laya.Sprite;
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

  constructor(options: SettingsPanelOptions) {
    this.options = options;
    this.store = options.store;
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

    this.heading = makeLabel('Settings', theme.FONT_SIZE_HEADING, theme.COLOR_TITLE, true);
    this.card.addChild(this.heading);

    this.closeButton = createButtonEx('Close', 0, 0, 72, () => this.hide(), 'ghost', HEADER_H - 6);
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
    this.viewport = new Laya.Sprite();
    this.viewport.mouseEnabled = true;
    this.card.addChild(this.viewport);
    this.content = new Laya.Sprite();
    this.content.mouseEnabled = false;
    this.viewport.addChild(this.content);
    for (const section of this.sections) {
      // Sections are stacked in the content sprite; only the active one is
      // visible, which keeps every section's state alive across tab switches.
      section.root.mouseEnabled = false;
      section.root.visible = false;
      this.content.addChild(section.root);
    }

    this.scrollThumb = new Laya.Sprite();
    this.card.addChild(this.scrollThumb);

    this.resetButton = createButtonEx(
      'Restore defaults',
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
   * sits *below* the rows, so a drag that starts on a row still scrolls: the
   * rows set `mouseEnabled = false` on their own background (only their control
   * is a target), which lets the press fall through to the viewport.
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
  private applyScroll(): void {
    const max = this.maxScroll();
    this.scrollTop = clamp(this.scrollTop, 0, max);
    this.content.pos(0, -this.scrollTop);

    const viewH = this.viewportRect.height;
    this.scrollThumb.graphics.clear();
    if (max <= 0 || viewH <= 0) {
      return;
    }
    const contentH = this.sections[this.activeIndex].contentHeight;
    const thumbH = Math.max(24, Math.round((viewH / contentH) * viewH));
    const thumbY =
      this.viewportRect.y + Math.round((this.scrollTop / max) * Math.max(0, viewH - thumbH));
    const thumbX = this.viewportRect.x + this.viewportRect.width - SCROLLBAR_W;
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/** Re-exported so scene code can talk about sections without a second import. */
export type { SettingsSection, BaseSettingsSection };
