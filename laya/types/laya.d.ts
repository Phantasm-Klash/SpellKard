/**
 * Minimal hand-written LayaAir 3 type declarations.
 *
 * The official engine ships built JavaScript (`engine/libs/*.js`) plus a
 * `.d.ts` bundle produced by the LayaAir IDE. Because the IDE is not part of
 * this repository, this shim declares only the surface the client actually
 * touches, which keeps `tsc -p tsconfig.full.json` honest without vendoring the
 * full ~10 MB declaration set.
 *
 * Scope note: this is intentionally small. When the LayaAir IDE is wired into
 * CI, replace this file with the engine-generated `laya.d.ts` (see
 * `laya/README.md` → "Engine integration").
 */

declare namespace Laya {
  class Handler {
    constructor(caller: unknown, method: (...args: unknown[]) => void);
  }

  class EventDispatcher {
    on(type: string, caller: unknown, listener: (...args: unknown[]) => void): EventDispatcher;
    off(type: string, caller: unknown, listener?: (...args: unknown[]) => void): EventDispatcher;
    offAll(type?: string): EventDispatcher;
    event(type: string, data?: unknown): boolean;
  }

  class Event {
    static readonly OPEN: string;
    static readonly CLOSE: string;
    static readonly MESSAGE: string;
    static readonly ERROR: string;
    static readonly PROGRESS: string;
    static readonly KEY_DOWN: string;
    static readonly KEY_UP: string;
    static readonly MOUSE_DOWN: string;
    static readonly MOUSE_UP: string;
    static readonly MOUSE_MOVE: string;
    static readonly MOUSE_OVER: string;
    static readonly MOUSE_OUT: string;
    static readonly CLICK: string;
    static readonly RESIZE: string;
  }

  class Point {
    x: number;
    y: number;
    constructor(x?: number, y?: number);
  }

  /**
   * Vector drawing surface. The client renders without any binary asset, so the
   * visual layer is built entirely from these primitives.
   *
   * IMPORTANT: this mirrors the *real* LayaAir 3 `Graphics` API. Text is drawn
   * with `fillText`, NOT `drawText`; there is no `linearGradient`, `lineCap` or
   * `lineJoin`. Adding a method here that the engine lacks type-checks fine but
   * throws at runtime, so verify against `engine/libs/laya.core.js` first.
   *
   * `clear()` resets the command list, so a redraw always starts from the
   * sprite's local origin.
   */
  class Graphics {
    clear(recoverCmds?: boolean): Graphics;

    // --- filled shapes ---
    drawRect(x: number, y: number, width: number, height: number, fillColor: string | null, lineColor?: string | null, lineWidth?: number, percent?: boolean): Graphics;
    drawRoundRect(x: number, y: number, width: number, height: number, lt: number, rt: number, lb: number, rb: number, fillColor: string | null, lineColor?: string | null, lineWidth?: number, percent?: boolean): Graphics;
    drawCircle(x: number, y: number, radius: number, fillColor: string | null, lineColor?: string | null, lineWidth?: number, percent?: boolean): Graphics;
    /** Note: takes full width/height, not radii. */
    drawEllipse(x: number, y: number, width: number, height: number, fillColor: string | null, lineColor?: string | null, lineWidth?: number, percent?: boolean): Graphics;
    drawPie(x: number, y: number, radius: number, startAngle: number, endAngle: number, fillColor: string | null, lineColor?: string | null, lineWidth?: number): Graphics;
    drawPoly(x: number, y: number, points: number[], fillColor: string | null, lineColor?: string | null, lineWidth?: number): Graphics;

    // --- stroked shapes ---
    drawLine(fromX: number, fromY: number, toX: number, toY: number, lineColor: string, lineWidth?: number): Graphics;
    drawLines(x: number, y: number, points: number[], lineColor: string, lineWidth?: number): Graphics;
    drawCurves(x: number, y: number, points: number[], lineColor: string, lineWidth?: number): Graphics;
    drawPath(x: number, y: number, paths: unknown[], brush?: unknown, pen?: unknown): Graphics;

    // --- text ---
    fillText(text: string, x: number, y: number, font: string, color: string, textAlign?: string): Graphics;
    fillBorderText(text: string, x: number, y: number, font: string, fillColor: string, textAlign?: string, lineWidth?: number, borderColor?: string): Graphics;
    strokeText(text: string, x: number, y: number, font: string, color: string, lineWidth: number, textAlign?: string): Graphics;

    // --- clip / alpha / transform (relative to the sprite's own origin) ---
    clipRect(x: number, y: number, width: number, height: number): Graphics;
    alpha(value: number): Graphics;
    save(): Graphics;
    restore(): Graphics;
    translate(tx: number, ty: number): Graphics;
    rotate(angle: number, pivotX?: number, pivotY?: number): Graphics;
    scale(scaleX: number, scaleY: number, pivotX?: number, pivotY?: number): Graphics;
    transform(matrix: unknown, pivotX?: number, pivotY?: number): Graphics;
  }

  class Sprite extends EventDispatcher {
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
    alpha: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    zOrder: number;
    blendMode: string;
    mouseEnabled: boolean;
    readonly graphics: Graphics;
    constructor();
    addChild<T extends Sprite>(child: T): T;
    removeChild(child: Sprite): Sprite;
    removeChildren(): Sprite;
    removeSelf(): Sprite;
    destroy(destroyChild?: boolean): void;
    pos(x: number, y: number): Sprite;
    size(width: number, height: number): Sprite;
  }

  class Text extends Sprite {
    text: string;
    color: string;
    fontSize: number;
    font: string;
    bold: boolean;
    italic: boolean;
    align: string;
    valign: string;
    overflow: string;
    wordWrap: boolean;
    leading: number;
    stroke: number;
    strokeColor: string;
    constructor(text?: string);
  }

  class Stage extends Sprite {
    bgColor: string;
    scaleMode: string;
    alignH: string;
    alignV: string;
    frameRate: number;
    readonly width: number;
    readonly height: number;
  }

  class Byte {
    pos: number;
    readonly length: number;
    readonly buffer: ArrayBuffer;
    readUTFBytes(length: number): string;
    readArrayBuffer(length: number): ArrayBuffer;
    clear(): void;
  }

  class Socket extends EventDispatcher {
    static readonly BIG_ENDIAN: string;
    static readonly LITTLE_ENDIAN: string;
    constructor(host?: string | null, port?: number | null);
    connectByUrl(url: string): void;
    connect(host: string, port: number): void;
    send(data: string | ArrayBuffer | Uint8Array): void;
    close(): void;
    cleanSocket(): void;
    readonly connected: boolean;
    readonly input: Byte;
    readonly output: Byte;
    endian: string;
    disableInput: boolean;
  }

  class Timer {
    loop(delay: number, caller: unknown, method: (...args: unknown[]) => void, args?: unknown[], once?: boolean, jumpFrame?: boolean): void;
    once(delay: number, caller: unknown, method: (...args: unknown[]) => void, args?: unknown[], jumpFrame?: boolean): void;
    clear(caller: unknown, method: (...args: unknown[]) => void): void;
    clearAll(caller: unknown): void;
  }

  class Browser {
    static readonly now: () => number;
    static readonly document: unknown;
    static readonly window: unknown;
    static readonly pixelRatio: number;
    static readonly width: number;
    static readonly height: number;
    static readonly onMobile: boolean;
  }

  const stage: Stage;
  const timer: Timer;

  /** Stage description accepted by `Laya.init`. */
  interface StageConfig {
    designWidth: number;
    designHeight: number;
    scaleMode?: string;
    screenMode?: string;
    alignH?: string;
    alignV?: string;
    backgroundColor?: string;
  }

  /**
   * `Laya.init` is asynchronous in LayaAir 3: it returns a promise that resolves
   * once the render device, stage and 2D renderer are ready.
   */
  function init(stageConfig: StageConfig): Promise<void>;
  function init(width: number, height: number): Promise<void>;
}

/** LayaAir render backends accepted by `Laya.init`. */
declare const WebGL: number;
declare const WebGL2: number;
