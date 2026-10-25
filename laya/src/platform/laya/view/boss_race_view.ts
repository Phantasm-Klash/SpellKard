/**
 * LayaAir rendering of a `BossRaceFrame`.
 *
 * Draws the portrait playfield, both Boss copies, the local player's ship and the
 * bullet curtain. Actors and the backdrop prefer the real TNA art
 * (`AtlasActorRenderer` + a backdrop texture) and fall back to the vector
 * `Graphics` look per-actor whenever a frame has not loaded.
 *
 * This is a thin adapter: all coordinates and colour decisions come from
 * `core/game/boss_race_view_model`; the actual shapes live in the sibling
 * `arena` (field + vector actors), `actors` (real-art actors), `bullets`
 * (curtain) and `hud` (status strip) modules, so this file stays a
 * layer-ordering skeleton with object pools.
 */

import {
  invulnerableBlinkOn,
  type BossRaceFrame,
  type JudgmentHudState,
  type PlayfieldLayout,
  type RenderPoint,
} from '../../../core/game/boss_race_view_model';
import { TNA_BACKGROUND_IMAGE } from '../../../core/game/tna_actor_frames';
import { AtlasActorRenderer, type ActorSpriteRenderer } from './actors';
import { drawPlayfield } from './arena';
import { sharedTnaFrameSource } from './bullet_atlas';
import { vectorBulletRenderer } from './bullets';
import { drawHudBar, type HudState } from './hud';
import { VectorPainter, fade, type BulletRenderer } from './sprites';
import * as theme from './theme';

const COLOR_BACKGROUND = theme.COLOR_BACKGROUND;
const COLOR_HUD = theme.COLOR_HUD;

/** Pixel radius of a Boss copy: the local one reads larger than the rival's. */
const BOSS_RADIUS_LOCAL = 22;
const BOSS_RADIUS_RIVAL = 16;
/** Pixel radius of the player ship hitbox. */
const PLAYER_RADIUS = 4;

/**
 * 判定指示层（铁拳/帷幕同族「玩法指示」）：判定点、擦弹圈、残机/炸弹图标。
 *
 * 几何全部来自 `core/game/boss_race_view_model`（服务端常量经
 * {@link PlayfieldTransform} 缩放的像素值），本层只画不判定。文案铁律：
 * 只用纯图标与数字，不硬编码任何中英文。
 */
const LIFE_ICON_RADIUS = 3;
const LIFE_ICON_PITCH = 10;
const BOMB_ICON_SIZE = 6;
const BOMB_ICON_PITCH = 10;
const GRAZE_TEXT_SIZE = 12;
/** 擦弹数字的固定占位宽度（像素）：读数位数变化时后面的图标不跟着跳。 */
const GRAZE_TEXT_SLOT = 34;
/** 受击数（`hit_count`）读数：三角形图标 + 数字。 */
const HIT_ICON_RADIUS = 4;
const HIT_TEXT_SIZE = 12;
/** 符卡获取数（`spell_get/spell_total`）读数：星形图标 + `get/total`。 */
const SPELL_ICON_OUTER = 5;
const SPELL_TEXT_SIZE = 12;
/** SCORE 读数（千分位文本，右对齐）。 */
const SCORE_TEXT_SIZE = 16;
/**
 * `score` 变化后高亮多少 tick（≈ 0.1s @60Hz）。
 *
 * 不用 `score_gain` 事件做判定源：事件只是「为什么涨」，而读数一律以快照
 * `score` 为准（重连补快照也会跳一次，那时给个高亮同样是对的）。
 */
const SCORE_PULSE_TICKS = 6;
/** 无敌指示环相对判定点的额外半径（像素）。 */
const INVULNERABLE_RING_GAP = 6;

/**
 * 判定卡片（HUD 侧栏**顶部**那条）的高度（像素）。
 *
 * 侧栏由 `drawHudBar` 自绘并会把它拿到的矩形铺满，所以这里不给它「留位置」的
 * 参数，而是**让出顶部一条**：`drawHudBar(g, 0, badgeH, w, h - badgeH, state)`。
 * 好处是 `hud.ts` 一行不用改，也不会出现卡片互相压字。
 *
 * P7 起卡片是**两行**（上：判定读数；下：符卡 + SCORE），所以高度从 30 提到 44。
 * 行位置按高度**比例**取，`render` 里的 `min(height/3)` 夹小之后两行仍不会压字。
 */
const JUDGMENT_BADGE_HEIGHT = 44;

/**
 * 判定 HUD 的渲染状态 —— **本视图对外契约**，由 `battle_scene.ts` 的
 * `judgmentState()` 从 `PlayerRenderItem` 构造（单一来源：
 * `core/game/boss_race_view_model.buildJudgmentHud`）。缺省不传
 * `render(..., judgment)` 时整条卡片不画——老调用零变化。
 *
 * 形状定义在 `core/game/boss_race_view_model`（core 不能反向依赖 platform，
 * 而派生逻辑必须可无引擎单测），这里只把它挂到视图的公开 API 上，**不再抄一份
 * 结构**——两份同形接口迟早会漂移。
 *
 * 文案铁律：卡片里只有图标与数字，没有任何自然语言。
 */
export type { JudgmentHudState } from '../../../core/game/boss_race_view_model';

export interface BossRaceViewOptions {
  /** Playfield size in pixels (the 2:3 portrait battle area). */
  layout: PlayfieldLayout;
  /** Left edge of the playfield inside the stage. Defaults to 0. */
  playfieldX?: number;
  /** Top edge of the playfield inside the stage. Defaults to 0. */
  playfieldY?: number;
  /** Width of the status panel on the right. */
  hudWidth?: number;
  /** Height of the status panel on the right. */
  hudHeight?: number;
  /** Left edge of the status panel inside the stage. Defaults to the playfield's right edge. */
  hudX?: number;
  /** Top edge of the status panel inside the stage. Defaults to 0 (stage top). */
  hudY?: number;
  /** Whole stage width; defaults to `playfieldX + layout.width + hudWidth`. */
  stageWidth?: number;
  /** Whole stage height; defaults to `playfieldY + layout.height`. */
  stageHeight?: number;
  /** Bullet renderer; defaults to the pure-vector fallback. */
  bulletRenderer?: BulletRenderer;
  /** Animate species frames locally (opt-in; server frame index is authoritative). */
  animateBulletFrames?: boolean;
  /**
   * Actor renderer for the Boss copies and player ships. Defaults to real TNA
   * atlas art with the vector renderer as per-actor fallback.
   */
  actorRenderer?: ActorSpriteRenderer;
  /**
   * Playfield backdrop texture. When omitted the view tries the shared TNA
   * backdrop image and keeps the vector playfield if it is unavailable.
   */
  backgroundTexture?: Laya.Texture;
  /**
   * Optional watermark layer (character/boss portraits). Inserted between the
   * actor layer and the HUD strip, so portraits sit above the actors and below
   * the status panel. Owned and sized by the caller.
   */
  watermark?: Laya.Sprite;
  /**
   * Optional scrolling background layer. Inserted directly above the opaque
   * stage fill and below the playfield, so it is the visible backdrop; when it
   * is supplied the view skips both the gradient playfield backdrop and the
   * `TNA_BACKGROUND_IMAGE` starfield that would otherwise cover it. Owned and
   * sized by the caller.
   */
  backgroundLayer?: Laya.Sprite;
}

export class BossRaceView {
  readonly root: Laya.Sprite;

  // Mutable so `relayout` can re-tile the view when the stage is resized.
  private layout: PlayfieldLayout;
  private playfieldX: number;
  private playfieldY: number;
  private hudX: number;
  private hudY: number;
  private hudWidth: number;
  private hudHeight: number;
  private stageWidth: number;
  private stageHeight: number;
  private readonly background: Laya.Sprite;
  private readonly backgroundLayer: Laya.Sprite | null;
  private readonly playfield: Laya.Sprite;
  private readonly backdrop: Laya.Sprite;
  private readonly bulletLayer: Laya.Sprite;
  private readonly actorLayer: Laya.Sprite;
  /** 判定点 / 擦弹圈 / 残机炸弹图标层（bullet+actor 之上）。 */
  private readonly indicatorLayer: Laya.Sprite;
  /** 擦弹计数（纯数字；无判定的 ruleset 下隐藏）。 */
  private readonly grazeText: Laya.Text;
  /** 受击数（纯数字，同上）。 */
  private readonly hitText: Laya.Text;
  /** 符卡获取数 `get/total`（纯数字，同上）。 */
  private readonly spellText: Laya.Text;
  /** SCORE 读数（千分位纯数字，右对齐）。 */
  private readonly scoreText: Laya.Text;
  /** 上一帧画出的分数；`null` = 还没画过（首帧不触发高亮）。 */
  private lastScore: number | null = null;
  /** 分数高亮持续到哪个 tick（`score` 变化时刷新）。 */
  private scorePulseUntilTick = 0;
  private readonly watermark: Laya.Sprite | null;
  private readonly hudLayer: Laya.Sprite;
  private readonly hud: Laya.Text;
  private readonly bulletPool: Laya.Sprite[] = [];
  private readonly actorPool: Laya.Sprite[] = [];
  private readonly bulletRenderer: BulletRenderer;
  private readonly actorRenderer: ActorSpriteRenderer;
  private readonly animateBulletFrames: boolean;
  private backgroundTexture: Laya.Texture | null;
  private activeBullets = 0;
  private activeActors = 0;

  constructor(options: BossRaceViewOptions) {
    this.layout = options.layout;
    this.bulletRenderer = options.bulletRenderer ?? vectorBulletRenderer;
    this.animateBulletFrames = options.animateBulletFrames ?? false;
    this.playfieldX = options.playfieldX ?? 0;
    this.playfieldY = options.playfieldY ?? 0;
    this.hudX = options.hudX ?? this.playfieldX + this.layout.width;
    this.hudY = options.hudY ?? 0;
    this.hudWidth = options.hudWidth ?? this.layout.width;
    this.hudHeight = options.hudHeight ?? 72;
    this.stageWidth = options.stageWidth ?? this.hudX + this.hudWidth;
    this.stageHeight = options.stageHeight ?? Math.max(this.playfieldY + this.layout.height, this.hudHeight);
    this.backgroundTexture = options.backgroundTexture ?? null;
    this.watermark = options.watermark ?? null;
    this.backgroundLayer = options.backgroundLayer ?? null;

    // Real TNA art (Boss / player / backdrop) with vector fallback. The shared
    // source is only created when a caller has not supplied its own renderer or
    // backdrop, so tests can drive the view without a Laya loader.
    const source = options.actorRenderer === undefined || this.backgroundTexture === null ? sharedTnaFrameSource() : null;
    this.actorRenderer = options.actorRenderer ?? new AtlasActorRenderer(source!);

    this.root = new Laya.Sprite();
    this.root.size(this.stageWidth, this.stageHeight);

    this.background = new Laya.Sprite();
    this.background.graphics.drawRect(0, 0, this.stageWidth, this.stageHeight, COLOR_BACKGROUND);
    this.root.addChild(this.background);

    // A caller-supplied scrolling background paints directly above the opaque
    // fill, so it is the visible backdrop. It must sit above the fill (which
    // would otherwise hide it) but below the playfield grid.
    if (this.backgroundLayer !== null) {
      this.root.addChild(this.backgroundLayer);
    }

    // Backdrop image (real art) sits between the solid stage colour and the
    // playfield grid; the grid/reticle/border are still drawn on top.
    this.backdrop = new Laya.Sprite();
    this.backdrop.pos(this.playfieldX, this.playfieldY);
    this.root.addChild(this.backdrop);

    this.playfield = new Laya.Sprite();
    this.playfield.pos(this.playfieldX, this.playfieldY);
    this.redrawPlayfield();
    this.root.addChild(this.playfield);

    this.bulletLayer = new Laya.Sprite();
    this.bulletLayer.pos(this.playfieldX, this.playfieldY);
    this.actorLayer = new Laya.Sprite();
    this.actorLayer.pos(this.playfieldX, this.playfieldY);
    this.root.addChild(this.bulletLayer);
    this.root.addChild(this.actorLayer);

    // Judgment indicators sit above the actors (the hitbox dot must stay
    // readable over the ship art) and below the watermark/HUD strip.
    this.indicatorLayer = new Laya.Sprite();
    this.indicatorLayer.pos(this.playfieldX, this.playfieldY);
    this.root.addChild(this.indicatorLayer);

    // 判定卡片里的擦弹数字用 `Text` 画（Graphics 没有文本能力）。它挂在 HUD 层
    // 而不是战场层：读数属于侧栏，`hudLayer` 的可见性/重排会带着它一起走。
    this.grazeText = new Laya.Text();
    this.grazeText.fontSize = GRAZE_TEXT_SIZE;
    this.grazeText.color = theme.COLOR_TEXT_MUTED;
    this.grazeText.visible = false;

    // 受击数 / 符卡获取数 / SCORE：同一条卡片上的另三个读数，同样挂 HUD 层。
    this.hitText = new Laya.Text();
    this.hitText.fontSize = HIT_TEXT_SIZE;
    this.hitText.color = theme.COLOR_TEXT_MUTED;
    this.hitText.visible = false;

    this.spellText = new Laya.Text();
    this.spellText.fontSize = SPELL_TEXT_SIZE;
    this.spellText.color = theme.COLOR_TEXT_MUTED;
    this.spellText.visible = false;

    this.scoreText = new Laya.Text();
    this.scoreText.fontSize = SCORE_TEXT_SIZE;
    this.scoreText.color = theme.COLOR_TEXT;
    this.scoreText.align = 'right';
    this.scoreText.visible = false;

    // Watermark portraits sit above the actors but below the HUD strip.
    if (this.watermark !== null) {
      this.root.addChild(this.watermark);
    }

    // Structured HUD panel: a vertical strip to the right of the playfield. It
    // can render either as vector cards (`hudState`) or as a plain text block
    // (`hudLines`); both target the same region.
    //
    // The panel is a full-height strip: it starts at the top of the stage (not
    // at `playfieldY`, which is the vertically-centred playfield's offset) and
    // spans `hudHeight`, so it never runs off the bottom when the playfield is
    // shorter than the stage.
    this.hudLayer = new Laya.Sprite();
    this.hudLayer.pos(this.hudX, this.hudY);
    this.root.addChild(this.hudLayer);
    // 擦弹数字挂在侧栏层（坐标是卡片内的局部坐标，见 `drawJudgmentBadge`）。
    this.hudLayer.addChild(this.grazeText);
    this.hudLayer.addChild(this.hitText);
    this.hudLayer.addChild(this.spellText);
    this.hudLayer.addChild(this.scoreText);

    this.hud = new Laya.Text();
    this.hud.pos(this.hudX + 8, this.hudY + 8);
    this.hud.fontSize = 14;
    this.hud.color = COLOR_HUD;
    this.hud.leading = 4;
    this.hud.width = this.hudWidth - 16;
    this.hud.wordWrap = true;
    this.root.addChild(this.hud);

    if (source !== null) {
      // Fire-and-forget: the backdrop swaps in as soon as the image resolves;
      // actor frames are picked up by the per-frame lookups automatically. A
      // caller-supplied background layer replaces the starfield, so it is not
      // loaded then (it would only be painted over).
      void source.load().then(() => {
        if (this.backgroundTexture === null && this.backgroundLayer === null) {
          const texture = source.image(TNA_BACKGROUND_IMAGE);
          if (texture !== null) {
            this.backgroundTexture = texture;
            this.redrawPlayfield();
          }
        }
      });
    }
  }

  /**
   * Repaints the playfield grid. The gradient is skipped when a real backdrop
   * covers the field — either the starfield texture or a caller-supplied
   * background layer — because it would otherwise paint over them.
   */
  private redrawPlayfield(): void {
    this.playfield.graphics.clear();
    drawPlayfield(
      this.playfield.graphics,
      this.layout.width,
      this.layout.height,
      this.backgroundTexture === null && this.backgroundLayer === null,
    );
    this.backdrop.graphics.clear();
    this.backdrop.texture = null;
    this.backdrop.scaleX = 1;
    this.backdrop.scaleY = 1;
    if (this.backgroundTexture !== null) {
      const texW = this.backgroundTexture.width || 1;
      const texH = this.backgroundTexture.height || 1;
      this.backdrop.texture = this.backgroundTexture;
      // Stretch to fill the playfield exactly so the image never spills into
      // the HUD strip; the art is a seamless starfield, so the stretch is fine.
      this.backdrop.scaleX = this.layout.width / texW;
      this.backdrop.scaleY = this.layout.height / texH;
    }
  }

  get playfieldHeight(): number {
    return this.layout.height;
  }

  /**
   * Re-tiles the view after the stage has been resized.
   *
   * Only the geometry fields passed here are overwritten; anything omitted keeps
   * its current value. The object pools (bullets / actors) are deliberately left
   * alone — they position purely from frame coordinates in `render`, so a resize
   * only needs the layers re-placed and the playfield/backdrop repainted.
   *
   * Must be called after the constructor has built `root`.
   */
  relayout(options: {
    layout?: PlayfieldLayout;
    playfieldX?: number;
    playfieldY?: number;
    hudX?: number;
    hudY?: number;
    hudWidth?: number;
    hudHeight?: number;
    stageWidth?: number;
    stageHeight?: number;
  }): void {
    if (options.layout !== undefined) {
      this.layout = options.layout;
    }
    if (options.playfieldX !== undefined) {
      this.playfieldX = options.playfieldX;
    }
    if (options.playfieldY !== undefined) {
      this.playfieldY = options.playfieldY;
    }
    if (options.hudX !== undefined) {
      this.hudX = options.hudX;
    }
    if (options.hudY !== undefined) {
      this.hudY = options.hudY;
    }
    if (options.hudWidth !== undefined) {
      this.hudWidth = options.hudWidth;
    }
    if (options.hudHeight !== undefined) {
      this.hudHeight = options.hudHeight;
    }
    if (options.stageWidth !== undefined) {
      this.stageWidth = options.stageWidth;
    }
    if (options.stageHeight !== undefined) {
      this.stageHeight = options.stageHeight;
    }

    this.root.size(this.stageWidth, this.stageHeight);
    this.background.graphics.clear();
    this.background.graphics.drawRect(0, 0, this.stageWidth, this.stageHeight, COLOR_BACKGROUND);

    this.backdrop.pos(this.playfieldX, this.playfieldY);
    this.playfield.pos(this.playfieldX, this.playfieldY);
    this.bulletLayer.pos(this.playfieldX, this.playfieldY);
    this.actorLayer.pos(this.playfieldX, this.playfieldY);
    this.indicatorLayer.pos(this.playfieldX, this.playfieldY);
    // Re-apply the watermark's stage-sized geometry. Its z-order was fixed at
    // construction (above actors, below the HUD) and is left untouched.
    if (this.watermark !== null) {
      this.watermark.pos(0, 0);
      this.watermark.size(this.stageWidth, this.stageHeight);
    }
    this.hudLayer.pos(this.hudX, this.hudY);
    this.hud.pos(this.hudX + 8, this.hudY + 8);
    this.hud.width = this.hudWidth - 16;

    this.redrawPlayfield();
  }

  /**
   * Redraws the whole frame.
   *
   * @param hudLines  plain-text HUD lines, rendered verbatim (legacy contract)
   * @param hudState  when given, the HUD strip is drawn as vector bars instead
   *                  of text; `hudLines` is then ignored
   * @param judgment  判定卡片（残机/炸弹/擦弹/受击 + 符卡/SCORE）；缺省 = 不画，
   *                  且侧栏恢复占满整条（老调用方零变化）。传入时侧栏让出顶部
   *                  {@link JUDGMENT_BADGE_HEIGHT} 像素给卡片，`hud.ts` 不需要
   *                  知道这张卡存在。
   */
  render(
    frame: BossRaceFrame,
    hudLines: string[] = [],
    hudState?: HudState,
    judgment?: JudgmentHudState,
  ): void {
    this.drawBullets(frame);
    this.drawActors(frame);
    this.drawJudgment(frame);
    if (hudState !== undefined) {
      this.hud.text = '';
      this.hud.visible = false;
      this.hudLayer.visible = true;
      const g = this.hudLayer.graphics;
      g.clear();
      const badgeH = judgment === undefined ? 0 : Math.min(JUDGMENT_BADGE_HEIGHT, this.hudHeight / 3);
      if (judgment !== undefined) {
        this.drawJudgmentBadge(g, 0, 0, this.hudWidth, badgeH, judgment, frame.tick);
      }
      drawHudBar(g, 0, badgeH, this.hudWidth, this.hudHeight - badgeH, hudState);
    } else {
      this.hudLayer.visible = false;
      this.hud.text = hudLines.join('\n');
      this.hud.visible = true;
    }
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private drawBullets(frame: BossRaceFrame): void {
    this.activeBullets = 0;
    for (const bullet of frame.bullets) {
      const sprite = this.bulletSprite(this.activeBullets);
      sprite.visible = true;
      sprite.pos(bullet.position.x, bullet.position.y);
      // The renderer owns the sprite's art: the atlas renderer sets a texture
      // (and pivot/scale/rotation); the vector renderer clears and redraws.
      this.bulletRenderer.draw(sprite, {
        bulletKind: bullet.bulletKind,
        patternId: bullet.bulletKind > 0 ? '' : bullet.patternId,
        radius: bullet.radius,
        ownerIsLocal: bullet.ownerIsLocal,
        angleRad: bullet.angleRad,
        angleDeg: bullet.angleDeg,
        motionFamily: bullet.motionFamily,
        tick: frame.tick,
        animate: this.animateBulletFrames,
      });
      this.activeBullets += 1;
    }
    for (let i = this.activeBullets; i < this.bulletPool.length; i += 1) {
      this.bulletPool[i].visible = false;
    }
  }

  private drawActors(frame: BossRaceFrame): void {
    this.activeActors = 0;

    // Draw the rival Boss first so the local copy stays on top.
    if (frame.opponentBoss !== null) {
      this.drawBoss(frame.opponentBoss.position, frame.opponentBoss.defeated, false, frame.opponentBoss.hpRatio, frame.tick);
    }
    if (frame.boss !== null) {
      this.drawBoss(frame.boss.position, frame.boss.defeated, true, frame.boss.hpRatio, frame.tick);
    }
    for (const player of frame.players) {
      const sprite = this.actorSprite(this.activeActors);
      // 无敌帧闪烁（4 亮 4 灭）：受击/炸弹后的无敌期内自机闪烁提示。相位由
      // core 的 `invulnerableBlinkOn` 决定，判定点/无敌环/HUD 图标共用它。
      sprite.visible = invulnerableBlinkOn(frame.tick, player.invulnerable);
      sprite.pos(player.position.x, player.position.y);
      // `PlayerRenderItem` carries no facing yet, so ships default to +x.
      this.actorRenderer.drawPlayer(sprite, PLAYER_RADIUS, player.isLocal, false, 0);
      this.activeActors += 1;
    }
    for (let i = this.activeActors; i < this.actorPool.length; i += 1) {
      this.actorPool[i].visible = false;
    }
  }

  private drawBoss(position: RenderPoint, defeated: boolean, isLocal: boolean, hpRatio: number, tick: number): void {
    const sprite = this.actorSprite(this.activeActors);
    sprite.visible = true;
    sprite.pos(position.x, position.y);
    this.actorRenderer.drawBoss(
      sprite,
      isLocal ? BOSS_RADIUS_LOCAL : BOSS_RADIUS_RIVAL,
      hpRatio,
      defeated,
      isLocal,
      tick,
    );
    this.activeActors += 1;
  }

  /**
   * 判定玩法指示（§2.4 客户端镜像表现）：**场上**的判定点、擦弹圈、无敌环。
   *
   * 全部数据来自 `PlayerRenderItem`（服务端常量经 PlayfieldTransform 的像素值），
   * 本方法不做任何判定：
   *  - 判定点：每颗自机一颗实心点（`r_hit` = 3000 milli ≈ 3px）；
   *  - 擦弹圈：仅当快照下发判定字段（`tna-1.40-danmaku`）时画（`r_graze` =
   *    20000 milli ≈ 20px），其余 ruleset 不画；
   *  - 无敌：判定点外一圈脉冲环，相位与自机闪烁同相（`blinkOn`）。
   *
   * 残机/炸弹/擦弹的**读数**不在这里，而在侧栏顶部的判定卡片
   * （{@link drawJudgmentBadge}）——读数属于 HUD，场上只留位置性指示。
   */
  private drawJudgment(frame: BossRaceFrame): void {
    const g = this.indicatorLayer.graphics;
    g.clear();
    // 卡片读数默认隐藏：没有判定数据（或走纯文本 HUD）时它们不该留在屏上。
    this.grazeText.visible = false;
    this.hitText.visible = false;
    this.spellText.visible = false;
    this.scoreText.visible = false;

    for (const player of frame.players) {
      // 判定点（本地高亮、对手压暗）。
      g.drawCircle(
        player.position.x,
        player.position.y,
        Math.max(1, player.hitboxRadiusPx),
        player.isLocal ? theme.COLOR_HITBOX : fade(theme.COLOR_HITBOX, 0.45),
      );
      // 擦弹圈（只有判定数据存在时才画）。
      if (player.grazeRadiusPx > 0) {
        g.drawCircle(
          player.position.x,
          player.position.y,
          player.grazeRadiusPx,
          null,
          fade(theme.COLOR_INFO, player.isLocal ? 0.5 : 0.3),
          1,
        );
      }
      // 无敌指示环：与自机闪烁同相（亮的那一半 tick 才画），让玩家一眼看出
      // 「现在打不到我」。对手也画，但压暗——它是可读的玩法状态。
      if (player.invulnerable && invulnerableBlinkOn(frame.tick, true)) {
        const ringRadius = Math.max(2, player.hitboxRadiusPx) + INVULNERABLE_RING_GAP;
        g.drawCircle(
          player.position.x,
          player.position.y,
          ringRadius,
          null,
          fade(theme.COLOR_SUCCESS, player.isLocal ? 0.85 : 0.4),
          1,
        );
      }
    }
  }

  /**
   * 判定卡片：HUD 侧栏**顶部**一条，P7 起分两行。
   *
   *  - 上行（判定）：残机圆点 / 炸弹方块 / 擦弹环+数字 / 受击三角+数字；
   *  - 下行（计分）：符卡星+`get/total`，右端 SCORE 千分位读数。
   *
   * 全部是图标与数字，**没有任何自然语言**（文案铁律）。分数变化后的
   * {@link SCORE_PULSE_TICKS} 个 tick 内用强调色画，作为「刚加分」的提示。
   *
   * 几何：卡片占 `(x, y, width, height)`；行位置按 `height` **比例**取，所以
   * `render` 里按侧栏高度夹小之后两行仍然不压字。无敌期在卡片外框画一圈脉冲
   * 环，**相位与场上自机相同**（4 亮 4 灭），所以玩家看到的是「人闪、环也闪」。
   */
  private drawJudgmentBadge(
    g: Laya.Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    judgment: JudgmentHudState,
    tick: number,
  ): void {
    if (width <= 0 || height <= 0) {
      return;
    }
    // 卡片底：与侧栏其它卡片同一套面板色，避免出现「第二套美术」。
    VectorPainter.roundedPanel(
      g,
      x,
      y,
      width,
      height,
      theme.RADIUS_SM,
      theme.COLOR_PANEL,
      theme.COLOR_PANEL_BORDER,
      1,
    );
    // 无敌：外框脉冲环（亮相位才画），与场上自机/判定点同相。
    if (judgment.invulnerable && judgment.blinkOn) {
      VectorPainter.roundedOutline(
        g,
        x + 1,
        y + 1,
        width - 2,
        height - 2,
        theme.RADIUS_SM,
        fade(theme.COLOR_SUCCESS, 0.9),
        2,
      );
    }

    const dim = judgment.invulnerable && !judgment.blinkOn;
    const pad = theme.SPACE_SM;
    // 两行的中心线（比例布局：任何卡片高度下都不压字）。
    const rowTop = y + height * 0.3;
    const rowBottom = y + height * 0.72;
    let cursor = x + pad + LIFE_ICON_RADIUS;

    // 残机：实心圆点，一条命一颗；耗尽时画一个危险色空心圈占位（读数不消失）。
    if (judgment.exhausted) {
      g.drawCircle(cursor, rowTop, LIFE_ICON_RADIUS, null, theme.COLOR_DANGER, 1);
      cursor += LIFE_ICON_PITCH;
    } else {
      for (let i = 0; i < judgment.lives; i += 1) {
        g.drawCircle(
          cursor,
          rowTop,
          LIFE_ICON_RADIUS,
          dim ? fade(theme.COLOR_LOCAL_PLAYER, 0.35) : theme.COLOR_LOCAL_PLAYER,
        );
        cursor += LIFE_ICON_PITCH;
      }
    }

    // 炸弹：方块，一颗炸弹一块；无敌期跟随闪烁变暗。
    cursor += theme.SPACE_XS;
    for (let i = 0; i < judgment.bombs; i += 1) {
      g.drawRect(
        cursor - BOMB_ICON_SIZE / 2,
        rowTop - BOMB_ICON_SIZE / 2,
        BOMB_ICON_SIZE,
        BOMB_ICON_SIZE,
        fade(theme.COLOR_INFO, dim ? 0.45 : 0.9),
      );
      cursor += BOMB_ICON_PITCH;
    }

    // 擦弹：小环图标 + 纯数字（数字用 Text 画，Graphics 没有文本能力）。
    cursor += theme.SPACE_XS + 4;
    g.drawCircle(cursor, rowTop, 4, null, fade(theme.COLOR_TEXT_MUTED, 0.8), 1);
    this.grazeText.pos(cursor + 7, rowTop - GRAZE_TEXT_SIZE / 2);
    this.grazeText.text = String(judgment.graze);
    this.grazeText.visible = true;
    // 定宽槽位（不是 `textWidth` 实测）：擦弹数位数会变，槽位固定才不会让
    // 后面的受击图标随读数左右跳动。
    cursor += 7 + GRAZE_TEXT_SLOT;

    // 受击（`hit_count`）：顶点朝下的三角 + 数字。三角、擦弹的空心环、残机的
    // 实心点在同一行里形状互不混淆，一眼能分出是哪一类读数。
    VectorPainter.polygon(
      g,
      cursor,
      rowTop,
      3,
      HIT_ICON_RADIUS,
      Math.PI / 2,
      fade(theme.COLOR_DANGER, dim ? 0.45 : 0.9),
    );
    this.hitText.pos(cursor + HIT_ICON_RADIUS + 3, rowTop - HIT_TEXT_SIZE / 2);
    this.hitText.text = String(judgment.hitCount);
    this.hitText.visible = true;

    // ---- 下行：符卡获取数 + SCORE ----
    const spellX = x + pad + SPELL_ICON_OUTER;
    // 符卡：星形图标（符卡） + `get/total`。total = 0 表示本 ruleset 没有符卡，
    // 仍然把 `0/0` 画出来——那是真实读数，不是占位。
    VectorPainter.star(
      g,
      spellX,
      rowBottom,
      5,
      SPELL_ICON_OUTER,
      SPELL_ICON_OUTER * 0.45,
      0,
      fade(theme.COLOR_ACCENT, dim ? 0.45 : 0.9),
    );
    this.spellText.pos(spellX + SPELL_ICON_OUTER + 4, rowBottom - SPELL_TEXT_SIZE / 2);
    this.spellText.text = `${judgment.spellGet}/${judgment.spellTotal}`;
    this.spellText.visible = true;

    // SCORE：千分位纯数字，右对齐（`width` 撑满 + `align='right'`，不依赖
    // `textWidth`——Laya 的原生运行时不一定有那次排版测量）。
    // 分数刚变化的那几 tick 用强调色，做一个不改变布局的高亮提示。
    if (this.lastScore !== null && judgment.score !== this.lastScore) {
      this.scorePulseUntilTick = tick + SCORE_PULSE_TICKS;
    }
    this.lastScore = judgment.score;
    const pulsing = tick < this.scorePulseUntilTick;
    this.scoreText.pos(x + pad, rowBottom - SCORE_TEXT_SIZE / 2);
    // 字号跟着卡片高度走：`render` 会把卡片夹到 `hudHeight/3`，矮侧栏上固定
    // 16px 会顶出卡片底边（压到下面的 HP 卡片）。
    this.scoreText.fontSize = Math.max(9, Math.round(Math.min(SCORE_TEXT_SIZE, height * 0.36)));
    this.scoreText.width = Math.max(0, width - pad * 2);
    this.scoreText.color = pulsing ? theme.COLOR_ACCENT : theme.COLOR_TEXT;
    this.scoreText.text = judgment.scoreText;
    this.scoreText.visible = true;
  }

  private bulletSprite(index: number): Laya.Sprite {
    const existing = this.bulletPool[index];
    if (existing !== undefined) {
      return existing;
    }
    const sprite = new Laya.Sprite();
    this.bulletPool.push(sprite);
    this.bulletLayer.addChild(sprite);
    return sprite;
  }

  private actorSprite(index: number): Laya.Sprite {
    const existing = this.actorPool[index];
    if (existing !== undefined) {
      return existing;
    }
    const sprite = new Laya.Sprite();
    this.actorPool.push(sprite);
    this.actorLayer.addChild(sprite);
    return sprite;
  }
}
