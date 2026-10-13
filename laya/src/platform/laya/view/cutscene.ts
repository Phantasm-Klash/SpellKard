/**
 * Stage-entrance cutscene overlay.
 *
 * Wraps the pure {@link CutsceneSequencer} (`core/game/cutscene_sequence`) and
 * draws the beat it reports:
 *   - `stage_title` — a centred banner that fades in;
 *   - `boss_intro` / `player_intro` — the portrait slides in from its own side
 *     (boss from the right, character from the left) and fades in;
 *   - `bgm_cue` / `wait` — nothing (audio-only / a deliberate pause).
 *
 * All motion is a pure function of the current step's elapsed time, so a paused
 * frame or a garbage delta cannot leave the overlay half-drawn. The overlay is
 * a full-stage sprite that is `mouseEnabled = false`: it never swallows input,
 * and it never calls any resolution API.
 *
 * Portrait art is optional and loaded through the shared TNA frame source (see
 * {@link setPortraits}); a missing texture degrades to just the banner text.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` other than the
 *       engine-agnostic cutscene / tuning / geometry helpers.
 */

import { CutsceneSequencer, type CutsceneStep } from '../../../core/game/cutscene_sequence';
import { cutsceneVisualFor } from '../../../core/game/stage_visual';
import { sharedTnaFrameSource, type LayaAtlasFrameSource } from './bullet_atlas';
import * as theme from './theme';

export class CutsceneOverlay {
  readonly root: Laya.Sprite;

  private readonly sequencer = new CutsceneSequencer();
  private readonly source: LayaAtlasFrameSource;
  private readonly panel: Laya.Sprite;
  private readonly banner: Laya.Text;
  private readonly portrait: Laya.Sprite;
  private characterName = '';
  private bossName = '';
  private characterTexture: Laya.Texture | null = null;
  private bossTexture: Laya.Texture | null = null;
  private characterRequested = false;
  private bossRequested = false;
  private stepElapsedMs = 0;
  private lastStep: CutsceneStep | null = null;
  private width = 0;
  private height = 0;

  constructor(source: LayaAtlasFrameSource = sharedTnaFrameSource()) {
    this.source = source;
    this.root = new Laya.Sprite();
    // Never block input: the cutscene is decoration, not a modal.
    this.root.mouseEnabled = false;
    this.panel = new Laya.Sprite();
    this.panel.mouseEnabled = false;
    this.banner = new Laya.Text();
    this.banner.mouseEnabled = false;
    this.banner.color = theme.COLOR_TITLE;
    this.banner.fontSize = theme.FONT_SIZE_TITLE;
    this.banner.bold = true;
    this.banner.align = 'center';
    this.banner.valign = 'middle';
    this.portrait = new Laya.Sprite();
    this.portrait.mouseEnabled = false;
    this.portrait.visible = false;
    this.root.addChild(this.panel);
    this.root.addChild(this.portrait);
    this.root.addChild(this.banner);
    this.hideAll();
  }

  /** Starts (or restarts) the sequence and clears the previous paint. */
  play(steps: readonly CutsceneStep[]): void {
    this.sequencer.start(steps);
    this.stepElapsedMs = 0;
    this.lastStep = null;
    this.hideAll();
  }

  /** Returns to the idle state (`done` reads `true`, nothing is drawn). */
  reset(): void {
    this.sequencer.reset();
    this.stepElapsedMs = 0;
    this.lastStep = null;
    this.hideAll();
  }

  /** Advances the sequence and repaints the current beat. */
  update(dtMs: number): void {
    const before = this.sequencer.current;
    this.sequencer.update(dtMs);
    const now = this.sequencer.current;
    if (now !== before) {
      // A new beat's window just opened; its elapsed time starts at zero.
      this.stepElapsedMs = 0;
    } else if (Number.isFinite(dtMs) && dtMs > 0) {
      this.stepElapsedMs += dtMs;
    }
    this.lastStep = now;
    this.draw(now, this.stepElapsedMs);
  }

  /** True once every step has elapsed (or before {@link play}). */
  get done(): boolean {
    return this.sequencer.done;
  }

  /** Re-centres the overlay for a new stage size. */
  relayout(width: number, height: number): void {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.root.size(this.width, this.height);
    this.draw(this.lastStep, this.stepElapsedMs);
  }

  /**
   * Supplies the portrait names (TNA-root-relative) the intros should slide in.
   * Names are resolved asynchronously through the shared frame source; an
   * unavailable texture simply leaves the banner text-only.
   */
  setPortraits(characterPortrait: string, bossPortrait: string): void {
    if (characterPortrait !== this.characterName) {
      this.characterName = characterPortrait;
      this.characterTexture = null;
      this.characterRequested = false;
    }
    if (bossPortrait !== this.bossName) {
      this.bossName = bossPortrait;
      this.bossTexture = null;
      this.bossRequested = false;
    }
    this.requestPortraits();
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private draw(step: CutsceneStep | null, elapsedMs: number): void {
    if (step === null) {
      this.hideAll();
      return;
    }
    const visual = cutsceneVisualFor(step.kind);
    if (visual === 'none') {
      this.hideAll();
      return;
    }
    const duration = Math.max(1, step.durationMs);
    const progress = Math.max(0, Math.min(1, elapsedMs / duration));
    if (visual === 'banner') {
      this.drawBanner(step.text ?? '', progress);
    } else {
      this.drawPortrait(visual === 'boss_slide' ? 'boss' : 'character', step.text ?? '', progress);
    }
  }

  private drawBanner(text: string, progress: number): void {
    this.panel.graphics.clear();
    this.portrait.visible = false;
    const margin = theme.SCREEN_MARGIN;
    const width = Math.max(120, Math.min(this.width - margin * 2, 360));
    const height = theme.FONT_SIZE_TITLE + theme.SPACE_LG * 2;
    const x = (this.width - width) / 2;
    const y = this.height / 2 - height / 2;
    this.panel.pos(x, y);
    this.panel.alpha = Math.min(1, progress * 3);
    this.panel.graphics.drawRoundRect(
      0,
      0,
      width,
      height,
      theme.RADIUS_MD,
      theme.RADIUS_MD,
      theme.RADIUS_MD,
      theme.RADIUS_MD,
      theme.COLOR_PANEL_DEEP,
      theme.COLOR_ACCENT,
      2,
    );
    this.banner.text = text;
    this.banner.visible = text !== '';
    this.banner.size(width, height);
    this.banner.pos(x, y);
  }

  private drawPortrait(kind: 'character' | 'boss', text: string, progress: number): void {
    this.panel.graphics.clear();
    this.panel.alpha = 0;
    const texture = kind === 'boss' ? this.bossTexture : this.characterTexture;
    const fromRight = kind === 'boss';
    const margin = theme.SCREEN_MARGIN;
    const eased = easeOutCubic(progress);
    const travel = Math.max(80, this.width * 0.25);
    this.portrait.visible = texture !== null;
    if (texture !== null) {
      const textureW = texture.width || 0;
      const textureH = texture.height || 0;
      const targetH = Math.min(this.height * 0.5, textureH || this.height * 0.5);
      const scale = textureH > 0 ? targetH / textureH : 1;
      const displayW = textureW * scale;
      const baseX = fromRight ? this.width - margin - displayW : margin;
      const x = fromRight ? baseX + (1 - eased) * travel : baseX - (1 - eased) * travel;
      const y = this.height / 2 - (textureH * scale) / 2;
      this.portrait.pivot(0, 0);
      this.portrait.texture = texture;
      this.portrait.scaleX = scale;
      this.portrait.scaleY = scale;
      this.portrait.pos(x, y);
      this.portrait.alpha = Math.min(1, progress * 2);
    }
    this.banner.text = text;
    this.banner.visible = text !== '';
    const band = theme.FONT_SIZE_HEADING * 2;
    this.banner.size(this.width, band);
    this.banner.pos(0, fromRight ? margin : this.height - band - margin);
  }

  private hideAll(): void {
    this.panel.graphics.clear();
    this.panel.alpha = 0;
    this.banner.text = '';
    this.banner.visible = false;
    this.portrait.visible = false;
  }

  private requestPortraits(): void {
    if (!this.characterRequested && this.characterName !== '') {
      this.characterRequested = true;
      void this.loadPortrait('character');
    }
    if (!this.bossRequested && this.bossName !== '') {
      this.bossRequested = true;
      void this.loadPortrait('boss');
    }
  }

  private async loadPortrait(kind: 'character' | 'boss'): Promise<void> {
    const name = kind === 'character' ? this.characterName : this.bossName;
    await this.source.load();
    await this.source.ensureImage(name);
    if (name !== (kind === 'character' ? this.characterName : this.bossName)) {
      return;
    }
    const texture = this.source.image(name);
    if (kind === 'character') {
      this.characterTexture = texture;
    } else {
      this.bossTexture = texture;
    }
  }
}

/** Ease-out cubic, used to settle the portrait into place. */
function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const inverse = 1 - clamped;
  return 1 - inverse * inverse * inverse;
}
