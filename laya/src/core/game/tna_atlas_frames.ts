/**
 * Engine-agnostic slicing of the imported 千夜追忆 `.atlas` JSON into frame
 * rectangles.
 *
 * The TNA tree ships 25 LayaAir `.atlas` files. Each frame records its trimmed
 * rect under `frame`, its untrimmed size under `sourceSize`, and its trim
 * offset under `offset`:
 *
 * ```json
 * "stage_boss_01_11.png": {
 *   "frame": { "x": 0, "y": 0, "w": 128, "h": 128 },
 *   "sourceSize": { "w": 128, "h": 128 },
 *   "offset": { "x": 0, "y": 0 },
 *   "rotated": false
 * }
 * ```
 *
 * LayaAir's own `AtlasLoader` expects a **`spriteSourceSize`** key instead and
 * dereferences `obj.spriteSourceSize.x` without a guard, so feeding it these
 * files throws a `TypeError` and the whole load rejects (silently degrading the
 * battle to vector art). Rather than rewrite the art, the platform layer reads
 * the JSON itself and slices the texture with this helper — so both spellings
 * are accepted:
 *
 *   - **offset** ← `spriteSourceSize` if present, else `offset`, else `(0, 0)`.
 *     This is the key compatibility rule: the shipped files only have `offset`.
 *   - **sourceSize** ← `sourceSize.{w,h}`, falling back to `frame.{w,h}`.
 *
 * The function is pure and total: a missing / empty `frames` map returns `[]`
 * and never throws, so a malformed atlas degrades instead of taking the battle
 * down. Frame order follows `Object.keys` (JSON insertion order) so the caller
 * can rely on it.
 *
 * NOTE: `core/` only — no Laya / DOM types here.
 */

/** One sliceable frame rectangle, already resolved to LayaAir's 9-arg form. */
export interface TnaFrameRect {
  /** Frame name as it appears in the atlas, e.g. `stage_boss_01_11.png`. */
  name: string;
  /** Trimmed rect inside the atlas texture. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Trim offset within the untrimmed sprite (LayaAir's `offsetX`/`offsetY`). */
  offsetX: number;
  offsetY: number;
  /** Untrimmed sprite size (LayaAir's `sourceWidth`/`sourceHeight`). */
  sourceW: number;
  sourceH: number;
}

/** The subset of an `.atlas` JSON document this module reads. */
export interface TnaAtlasJson {
  meta?: { image?: string; prefix?: string; scale?: number };
  frames?: Record<string, unknown>;
}

/** Coerces a JSON value to a finite number, falling back when it is not one. */
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Reads a `{x,y,w,h}` rect, or `null` when the shape is unusable. */
function readRect(value: unknown): { x: number; y: number; w: number; h: number } | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return { x: num(record.x), y: num(record.y), w: num(record.w), h: num(record.h) };
}

/** Trim offset: `spriteSourceSize` wins, then `offset`, then `(0, 0)`. */
function readOffset(frame: Record<string, unknown>): { x: number; y: number } {
  const source = readRect(frame.spriteSourceSize) ?? readRect(frame.offset);
  return source === null ? { x: 0, y: 0 } : { x: source.x, y: source.y };
}

/** Untrimmed size: `sourceSize.{w,h}` if present, else the trimmed `frame.{w,h}`. */
function readSourceSize(
  frame: Record<string, unknown>,
  rect: { w: number; h: number },
): { sourceW: number; sourceH: number } {
  const source = readRect(frame.sourceSize);
  if (source === null) {
    return { sourceW: rect.w, sourceH: rect.h };
  }
  return { sourceW: num(source.w, rect.w), sourceH: num(source.h, rect.h) };
}

/**
 * Slices an atlas JSON document into frame rectangles.
 *
 * Entries without a usable `frame` object are skipped. A missing or empty
 * `frames` map yields `[]` — never an exception.
 */
export function sliceAtlasFrames(json: TnaAtlasJson): TnaFrameRect[] {
  const frames = json?.frames;
  if (typeof frames !== 'object' || frames === null) {
    return [];
  }
  const rects: TnaFrameRect[] = [];
  for (const name of Object.keys(frames)) {
    const raw = frames[name];
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const frame = raw as Record<string, unknown>;
    const rect = readRect(frame.frame);
    if (rect === null) {
      continue;
    }
    const offset = readOffset(frame);
    const size = readSourceSize(frame, rect);
    rects.push({
      name,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      offsetX: offset.x,
      offsetY: offset.y,
      sourceW: size.sourceW,
      sourceH: size.sourceH,
    });
  }
  return rects;
}
