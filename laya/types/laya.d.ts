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
    static create(
      caller: unknown,
      method: (...args: unknown[]) => void,
      args?: unknown[] | null,
      once?: boolean,
    ): Handler;
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
    /**
     * Fired by an editable `Text` whenever its content changes. The engine
     * dispatches this for BOTH input paths — the DOM `<input>` adapter on web
     * and the `conch` native keyboard on LayaNative — so it is the one event to
     * listen on to mirror what the user typed.
     */
    static readonly CHANGE: string;
    /** Editable `Text` gained keyboard focus (its native input is live). */
    static readonly FOCUS: string;
    /** Editable `Text` lost keyboard focus. */
    static readonly BLUR: string;
    /**
     * Fired by an editable `Text` when the user presses Enter while it holds
     * focus. The engine's own text-input adapter dispatches this and then closes
     * the input unless the handler calls `preventDefault()` on the event, so it
     * is the correct hook for "Enter confirms the form".
     */
    static readonly ENTER: string;
    /** Sprite was added to / removed from the display list. */
    static readonly DISPLAY: string;
    static readonly UNDISPLAY: string;
    /** Fullscreen state changed (browser `fullscreenchange`). */
    static readonly FULL_SCREEN_CHANGE: string;
  }

  /**
   * A keyboard event as the engine hands it to a `KEY_DOWN` / `KEY_UP` handler.
   *
   * Verified against `engine/libs/laya.core.js`: `keyCode`, `key`, `altKey`,
   * `ctrlKey`, `shiftKey` and `metaKey` are all plain forwarders to the
   * underlying `nativeEvent`, so they exist on both web and LayaNative. Use
   * `key` when it is present (layout-independent) and `keyCode` as the fallback.
   */
  interface KeyboardEventLike {
    /** `KeyboardEvent.key`, e.g. `'Tab'`, `'Enter'`, `'ArrowUp'`, `'a'`. */
    readonly key?: string;
    /** Legacy numeric code; `13` = Enter, `9` = Tab, `27` = Escape. */
    readonly keyCode?: number;
    readonly charCode?: string;
    readonly altKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly shiftKey?: boolean;
    readonly metaKey?: boolean;
    /** Present on the engine's own `Event` instances; stops the default action. */
    preventDefault?(): void;
  }

  class Point {
    x: number;
    y: number;
    constructor(x?: number, y?: number);
  }

  /**
   * Axis-aligned rectangle. Used by {@link Sprite.scrollRect} to clip a sprite
   * (and its children) to a sub-box, which is how the login backdrop crops the
   * cover-fitted title art instead of stretching it.
   */
  class Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
    constructor(x?: number, y?: number, width?: number, height?: number);
    setTo(x: number, y: number, width: number, height: number): Rectangle;
    clone(out?: Rectangle): Rectangle;
    contains(x: number, y: number): boolean;
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
    /** Current draw texture; `null` when the sprite draws via `graphics` only. */
    texture: Texture | null;
    /**
     * Clips this sprite (and its children) to a rectangle in its own local
     * coordinates; `null` disables the clip. Used to crop the cover-fitted
     * backdrop to the stage instead of overflowing it.
     */
    scrollRect: Rectangle | null;
    readonly graphics: Graphics;
    constructor();
    addChild<T extends Sprite>(child: T): T;
    removeChild(child: Sprite): Sprite;
    removeChildren(): Sprite;
    removeSelf(): Sprite;
    destroy(destroyChild?: boolean): void;
    /** Child count; pairs with `getChildAt` for read-only tree walks. */
    readonly numChildren: number;
    getChildAt(index: number): Sprite;
    pos(x: number, y: number): Sprite;
    size(width: number, height: number): Sprite;
    /** Sets the transform origin (rotation/scale pivot) in pixels. */
    pivot(x: number, y: number): Sprite;
    /** Loads an image URL directly into this sprite's texture. */
    loadImage(url: string, complete?: Handler): Sprite;
    /**
     * Pointer position **in this sprite's local coordinates** (verified against
     * `engine/libs/laya.core.js`: `globalToLocal(stage.mouseX, stage.mouseY)`).
     * Read it inside a mouse handler to get coordinates without touching the
     * event payload — this is how the settings sliders map a drag to a value.
     */
    readonly mouseX: number;
    readonly mouseY: number;
    /** Converts a point from this sprite's space to the stage's. */
    localToGlobal(point: Point, createNew?: boolean): Point;
    /** Converts a stage point into this sprite's local space. */
    globalToLocal(point: Point, createNew?: boolean): Point;
  }

  /** A single texture or an atlas sub-texture. */
  class Texture {
    readonly width: number;
    readonly height: number;
    readonly sourceWidth: number;
    readonly sourceHeight: number;
    readonly offsetX: number;
    readonly offsetY: number;
    /**
     * Creates an atlas sub-texture from a region of `source`.
     *
     * `offsetX`/`offsetY` are the trim offset and `sourceWidth`/`sourceHeight`
     * the untrimmed size (NOT width/height) — matching the engine's own
     * `AtlasLoader`, which calls `Texture.create(...)` with exactly these nine
     * arguments.
     */
    static create(
      source: Texture,
      x: number,
      y: number,
      width: number,
      height: number,
      offsetX?: number,
      offsetY?: number,
      sourceWidth?: number,
      sourceHeight?: number,
    ): Texture;
  }

  /**
   * Resource loader singleton (`Laya.loader`) + static resource-type constants.
   *
   * `load` mirrors the real engine's `load(url, arg1, arg2, arg3, ...)`: the
   * **type** is read from `arg1` when it is a string, from `arg1.type` when it
   * is an options object, and from `arg3` when `arg1` is a `Handler`. Passing
   * `null`/`undefined` as `arg1` therefore drops the type and falls back to the
   * URL extension.
   */
  class Loader {
    static readonly IMAGE: string;
    static readonly ATLAS: string;
    static readonly JSON: string;
    load(
      url: string | string[],
      arg1?: unknown,
      arg2?: unknown,
      arg3?: unknown,
      arg4?: unknown,
      arg5?: unknown,
      arg6?: unknown,
    ): Promise<unknown>;
    getRes(url: string): unknown;
  }

  const loader: Loader;

  /** Static text label. For an editable field use {@link Input}. */
  class Text extends Sprite {
    text: string;
    color: string;
    fontSize: number;
    font: string;
    /**
     * The resolved font family the engine hands to the DOM text-input overlay
     * (verified in `engine/libs/laya.core.js`: `TextInputAdapter.onBegin` sets
     * `style.fontFamily = target.realFont`). The `font` setter stores the
     * concrete family here and falls back to `Config.defaultFont` (`'Arial'`)
     * when `font` is empty, so it is always a usable family — which is what
     * lets the platform layer measure text in the very font the overlay paints.
     */
    readonly realFont: string;
    bold: boolean;
    italic: boolean;
    align: string;
    valign: string;
    overflow: string;
    wordWrap: boolean;
    leading: number;
    stroke: number;
    strokeColor: string;
    /** Background fill painted behind the text (used by editable fields). */
    bgColor: string;
    constructor(text?: string);
  }

  /**
   * Editable text field. `laya.core` ships `Input extends Text` on BOTH the web
   * and the LayaNative build (`exports.Input = Input`), and it is what attaches
   * the input adapter — a real DOM `<input>` on web, the `conch` native keyboard
   * on LayaNative — so one node type accepts typed text on either runtime.
   *
   * This is why the client uses `Laya.Input` instead of the classic
   * `Laya.TextInput`: the native `laya.ui2.js` build does not export the latter,
   * but `Laya.Input` lives in `laya.core.js`, which every runtime loads.
   *
   * Note that the input-only members below (`editable`, `type`, `prompt`, …) are
   * NOT on the base `Text` class in this engine version — only on `Input`.
   */
  class Input extends Text {
    /** Live input field when true (defaults to true for `Input`). */
    editable: boolean;
    /**
     * Input flavour. `'password'` masks the rendered text (the engine sets an
     * internal `_asPassword` flag); `'text'` (or unset) shows it verbatim.
     */
    type: string;
    /** Greyed placeholder shown while the field is empty. */
    prompt: string;
    /** Colour of {@link prompt}. */
    promptColor: string;
    /** Maximum number of characters the field accepts (0 = engine default). */
    maxChars: number;
    /** Allow line breaks in the field (multi-line input). */
    multiline: boolean;
    /** Soft-keyboard return key label (e.g. `'done'`). */
    confirmType: string;
    /**
     * Focus flag. Setting it to true opens the native/DOM input
     * (`PAL.textInput.begin(this)`); false closes it. The engine does NOT focus
     * on click by itself, so the scene must set this from a CLICK handler.
     */
    focus: boolean;
    /** Selects a character range and focuses the field. */
    setSelection(startIndex: number, endIndex: number): void;
    /** Selects all text and focuses the field. */
    select(): void;
  }

  class Stage extends Sprite {
    bgColor: string;
    scaleMode: string;
    alignH: string;
    alignV: string;
    frameRate: number;
    readonly width: number;
    readonly height: number;
    readonly designWidth: number;
    readonly designHeight: number;
    readonly canvasDegree: number;
    readonly clientScaleX: number;
    readonly clientScaleY: number;
    /**
     * The sprite that currently owns keyboard focus, or `null`. The engine's
     * text-input adapter sets this to the focused `Input`, so it is the reliable
     * way to ask "is a text field editing right now?".
     */
    focus: unknown;
    /**
     * `true` requests fullscreen **on the next click** — the setter only attaches
     * a `mousedown`/`touchstart` listener to the canvas, it does not call the
     * Fullscreen API. To enter fullscreen immediately use
     * `Laya.PAL.browser.requestFullscreen()`.
     */
    fullscreen: boolean;
    /** Leaves fullscreen immediately. */
    exitFullscreen(): void;
    /** CSS transform of the canvas element; drives the DOM-overlay maths. */
    readonly _canvasTransform: { a: number; b: number; c: number; d: number; tx: number; ty: number };
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
    /** Runs on every rendered frame, ignoring `delay`. Used for the FPS counter. */
    frameLoop(delay: number, caller: unknown, method: (...args: unknown[]) => void, args?: unknown[]): void;
    frameOnce(delay: number, caller: unknown, method: (...args: unknown[]) => void, args?: unknown[]): void;
    /** Clears both the timed and the frame-bound registrations for `caller`/`method`. */
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

  /**
   * The render loop singleton (`Laya.Render`).
   *
   * Verified in `engine/libs/laya.core.js`: the vsync loop calls
   * `Render.loop(timestamp)`, which early-returns unless
   *
   *     Render.forceOnce || (Render.predicate != null
   *       ? Render.predicate(timestamp)
   *       : <switch on Render.throttleMode>)
   *
   * `Stage.frameRate` is NOT a numeric cap in this engine version — its setter
   * only maps the strings `'slow' | 'mouse' | 'sleep'` onto `throttleMode`, and
   * every number (including 30 and 120) lands on `throttleMode = 0` ("fast").
   * `Render.predicate` is therefore the supported hook for a real numeric frame
   * cap: return `false` and the engine skips the whole update+render for that
   * vsync tick. Set it back to `null` to run unthrottled.
   */
  class Render {
    static frameInterval: number;
    static lastFrame: number;
    static frameStartTime: number;
    static throttleMode: number;
    /** Custom gate, called with the vsync timestamp; `false` skips the tick. */
    static predicate: ((timestamp: number) => boolean) | null;
    static paused: boolean;
    /** Set to `true` to let exactly one tick through while `paused`. */
    static forceOnce: boolean;
    static readonly canvas: unknown;
  }

  /**
   * Platform abstraction layer (`Laya.PAL`), exported by `laya.core.js`.
   *
   * `Browser.pixelRatio` is a *getter* that simply forwards to
   * `PAL.browser.getPixelRatio()`, and that method is a plain (writable)
   * prototype member returning the cached `_pixelRatio`. Overriding it is the
   * one supported way to change the canvas backing-store scale at runtime —
   * `Browser.pixelRatio` itself has no setter.
   */
  const PAL: {
    browser: {
      getPixelRatio(): number;
      /**
       * Asks the document for fullscreen. This is the only *immediate*
       * fullscreen entry point — `Stage.fullscreen = true` merely arms a
       * click listener. Resolves/rejects depending on the browser's user-gesture
       * policy, so always call it from a real input event or handle rejection.
       */
      requestFullscreen(): Promise<void> | void;
      /** Leaves fullscreen. No-op when not fullscreen. */
      exitFullscreen(): void;
    };
    /**
     * The active text-input adapter (web `<input>` overlay, or `conch` on
     * LayaNative). `target` is the `Input` that currently owns the keyboard.
     */
    textInput: {
      readonly target: unknown;
      begin(target: unknown, fromTouchBegin?: boolean): Promise<void> | void;
      end(): Promise<void> | void;
      setSelection(startIndex: number, endIndex: number): void;
    };
  };

  const stage: Stage;
  const timer: Timer;

  /**
   * A playing sound. Returned by `SoundManager.playSound` / `playMusic`.
   *
   * `volume` is per-channel and multiplies into the manager's bus volume
   * (verified in `engine/libs/laya.core.js`: the manager writes
   * `channel.volume = ...` when a bus changes), which is what lets the client
   * give BGM / graze / player-shot / skill their own gains on top of one master.
   */
  class SoundChannel extends EventDispatcher {
    /** Per-channel gain, 0..1. */
    volume: number;
    muted: boolean;
    playbackRate: number;
    /** Length in seconds (`NaN` until the asset's metadata is known). */
    readonly duration: number;
    stop(): void;
  }

  /**
   * Global audio manager. Only the members the client actually uses are
   * declared; every one of them was verified present in `laya.core.js`.
   *
   * There are two buses — `musicVolume` (BGM) and `soundVolume` (everything
   * else) — plus matching `*Muted` switches. Per-category gains are applied on
   * the returned `SoundChannel.volume`.
   */
  class SoundManager {
    static musicVolume: number;
    static soundVolume: number;
    static musicMuted: boolean;
    static soundMuted: boolean;
    static autoStopMusic: boolean;
    static useAudioMusic: boolean;
    static playbackRate: number;
    static playMusic(url: string, loops?: number, complete?: Handler, startTime?: number): SoundChannel;
    static playSound(url: string, loops?: number, complete?: Handler, soundClass?: unknown, startTime?: number): SoundChannel;
    static stopMusic(): void;
    static stopSound(url: string): void;
    static stopAll(): void;
    static stopAllSound(): void;
  }

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
