/**
 * Scrolling, breathing stage background.
 *
 * Two stacked layers — `bg_XX_01.png` (far, slow) under `bg_XX_02.png` (near,
 * ~3.3× faster) — give the field parallax depth. Each 256×256 (one is 512×512)
 * source texture is tiled across the whole stage by a grid of `Laya.Sprite`
 * children whose origin is wrapped modulo the tile size as the scroll offset
 * advances (see `core/game/stage_visual` for the pure geometry).
 *
 * Layer transform, from the outside in:
 *   `scaler`  — a container pivoted on the stage centre and scaled by the slow
 *               breathe, so the field never reveals an edge;
 *   `scroller`— a container holding the tile grid, moved by `-wrap(offset)`;
 *   tiles     — one sprite per grid cell, each blitted with the layer texture.
 *
 * Because `scaler.pivot` and `scaler.pos` are both the stage centre, a tile at
 * local `(x, y)` renders at `centre + (x - centre) * scale` — i.e. stage
 * coordinates at scale 1, and a centre-anchored breathe otherwise.
 *
 * The art loads asynchronously through the shared TNA frame source; until it
 * arrives the layer draws nothing (never throws), and a missing layer degrades
 * to an empty field. `setStage` re-arms the layer for the next stage.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` other than the
 *       engine-agnostic art-name / tuning / geometry helpers.
 */

import { backgroundNames } from '../../../core/game/stage_art';
import {
  DEFAULT_STAGE_BACKGROUND_TUNING,
  type StageBackgroundTuning,
} from '../../../core/game/tna_stage_tuning';
import { advanceOffset, breatheScale, tileGrid, wrapOffset } from '../../../core/game/stage_visual';
import { sharedTnaFrameSource, type LayaAtlasFrameSource } from './bullet_atlas';

/** One scrolling layer: a scale container, a scroll container and its tiles. */
interface ScrollLayer {
  /** Breathe container, pivoted on the stage centre. */
  readonly scaler: Laya.Sprite;
  /** Scroll container; holds the tile grid and carries the wrapped offset. */
  readonly scroller: Laya.Sprite;
  /** Pooled tile sprites, indexed `row * cols + col`. */
  readonly tiles: Laya.Sprite[];
  texture: Laya.Texture | null;
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
  offset: number;
  readonly pxPerSecond: number;
}

export class StageBackgroundLayer {
  readonly root: Laya.Sprite;

  private readonly source: LayaAtlasFrameSource;
  private readonly tuning: StageBackgroundTuning;
  private readonly far: ScrollLayer;
  private readonly near: ScrollLayer;
  private names: [string, string] = ['', ''];
  private stage = 0;
  private width = 0;
  private height = 0;
  private elapsedMs = 0;
  private requested = false;
  private built = false;

  constructor(
    tuning: StageBackgroundTuning = DEFAULT_STAGE_BACKGROUND_TUNING,
    source: LayaAtlasFrameSource = sharedTnaFrameSource(),
  ) {
    this.tuning = tuning;
    this.source = source;
    this.root = new Laya.Sprite();
    this.root.mouseEnabled = false;
    this.far = this.makeLayer(tuning.farScrollPxPerSecond);
    this.near = this.makeLayer(tuning.nearScrollPxPerSecond);
    this.root.addChild(this.far.scaler);
    this.root.addChild(this.near.scaler);
  }

  /** Selects the two background layers for a reference stage (unknown → 1). */
  setStage(stage: number): void {
    if (this.stage === stage && this.names[0] !== '') {
      return;
    }
    this.stage = stage;
    this.names = backgroundNames(stage);
    this.far.offset = 0;
    this.near.offset = 0;
    this.far.texture = null;
    this.near.texture = null;
    this.built = false;
    this.requested = false;
  }

  /** Re-tiles for a new stage size and re-anchors the breathe pivot. */
  relayout(width: number, height: number): void {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.root.size(this.width, this.height);
    for (const layer of [this.far, this.near]) {
      layer.scaler.pivot(this.width / 2, this.height / 2);
      layer.scaler.pos(this.width / 2, this.height / 2);
    }
    this.build();
  }

  /** Advances the scroll offsets and the breathe phase by `dtMs`. */
  update(dtMs: number): void {
    if (!this.requested) {
      this.requested = true;
      void this.loadTextures();
    }
    if (!Number.isFinite(dtMs) || dtMs <= 0) {
      return;
    }
    this.elapsedMs += dtMs;
    this.far.offset = advanceOffset(this.far.offset, this.far.pxPerSecond, dtMs);
    this.near.offset = advanceOffset(this.near.offset, this.near.pxPerSecond, dtMs);
    if (!this.built) {
      this.build();
    }
    const scale = breatheScale(
      this.elapsedMs,
      this.tuning.breathePeriodMs,
      this.tuning.scaleMin,
      this.tuning.scaleMax,
    );
    for (const layer of [this.far, this.near]) {
      layer.scaler.scaleX = scale;
      layer.scaler.scaleY = scale;
      if (layer.cols > 0) {
        layer.scroller.pos(-wrapOffset(layer.offset, layer.tileW), -wrapOffset(layer.offset, layer.tileH));
      }
    }
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private makeLayer(pxPerSecond: number): ScrollLayer {
    const scaler = new Laya.Sprite();
    const scroller = new Laya.Sprite();
    scaler.addChild(scroller);
    return {
      scaler,
      scroller,
      tiles: [],
      texture: null,
      tileW: 0,
      tileH: 0,
      cols: 0,
      rows: 0,
      offset: 0,
      pxPerSecond,
    };
  }

  /**
   * Coverage factor for the tile grid: a breathe below 1 shrinks the layer
   * toward the centre, so the grid must extend by `1 / scaleMin` to still reach
   * the edges.
   */
  private coverage(): number {
    return this.tuning.scaleMin > 0 && this.tuning.scaleMin < 1 ? 1 / this.tuning.scaleMin : 1;
  }

  /** (Re)builds both layer grids from the currently resolved textures. */
  private build(): void {
    if (this.width <= 0 || this.height <= 0) {
      return;
    }
    let any = false;
    for (const layer of [this.far, this.near]) {
      if (layer.texture === null) {
        continue;
      }
      any = true;
      this.buildLayer(layer);
    }
    this.built = any;
  }

  private buildLayer(layer: ScrollLayer): void {
    const texture = layer.texture;
    if (texture === null) {
      return;
    }
    const tileW = Math.max(1, texture.width || 1);
    const tileH = Math.max(1, texture.height || 1);
    const grid = tileGrid(this.width, this.height, tileW, tileH, layer.offset, layer.offset, this.coverage());
    layer.tileW = tileW;
    layer.tileH = tileH;
    layer.cols = grid.cols;
    layer.rows = grid.rows;
    const needed = grid.cols * grid.rows;
    while (layer.tiles.length < needed) {
      const tile = new Laya.Sprite();
      tile.mouseEnabled = false;
      layer.tiles.push(tile);
      layer.scroller.addChild(tile);
    }
    for (let index = 0; index < layer.tiles.length; index += 1) {
      const tile = layer.tiles[index];
      if (index >= needed) {
        tile.visible = false;
        continue;
      }
      const col = index % grid.cols;
      const row = Math.floor(index / grid.cols);
      tile.visible = true;
      tile.texture = texture;
      tile.pos(col * tileW, row * tileH);
    }
    layer.scroller.pos(-wrapOffset(layer.offset, tileW), -wrapOffset(layer.offset, tileH));
  }

  private async loadTextures(): Promise<void> {
    await this.source.load();
    const [farName, nearName] = this.names;
    if (farName === '') {
      return;
    }
    await this.source.ensureImage(farName);
    await this.source.ensureImage(nearName);
    // The stage may have changed while the art was in flight: drop a stale load.
    if (farName !== this.names[0] || nearName !== this.names[1]) {
      return;
    }
    this.far.texture = this.source.image(farName);
    this.near.texture = this.source.image(nearName);
    this.built = false;
    this.build();
  }
}
