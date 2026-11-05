/**
 * 独立显示帧渲染循环的生命周期 —— 与 64Hz 逻辑 tick 解耦。
 *
 * 照 `src/platform/laya/display.ts:191/:204` 的既有生产用例：
 *   `Laya.timer.frameLoop(1, caller, method)` 注册，`Laya.timer.clear(caller, method)` 清理。
 * 这里只把「注册 / 清理 / 幂等 / 清理后不再派发」收在一处，**不引入任何
 * requestAnimationFrame / setInterval 抽象**：LayaAir 引擎自带 timer，浏览器与
 * 原生 .exe 下都由引擎的 vsync 循环驱动，项目里已有的 FPS 计数器就是用这个模式。
 *
 * `core` 层零环境依赖：timer 由平台层以 provider 形式注入（延迟到 `start()`
 * 时才取值，保证引擎已初始化），单测可注入假 timer 断言生命周期。
 * `tsconfig.json` 只给 core 配了 ES2020，这个文件严格不引用 DOM / Laya 全局。
 */

/** LayaAir 3.4.1 `Laya.timer` 的最小形状（照 `display.ts:191/:204` 的用法）。 */
export interface FrameTimerLike {
  frameLoop(delay: number, caller: unknown, method: (...args: unknown[]) => void): void;
  clear(caller: unknown, method: (...args: unknown[]) => void): void;
}

/**
 * 独立的显示帧渲染循环。
 *
 * `start()` 幂等（重复调用不重复注册，杜绝双重回调）；`stop()` 取消注册**并清空
 * 回调**，因此即使帧源在取消后又派发一帧也不会再执行 —— `start()` / `stop()` /
 * `setPaused()` / `onExit` 四条路径都停干净，`onExit` 不残留。
 */
export class RenderLoop {
  private cancelFrame: (() => void) | null = null;
  private callback: (() => void) | null = null;

  constructor(
    private readonly timerProvider: () => FrameTimerLike,
    private readonly caller: unknown,
  ) {}

  get running(): boolean {
    return this.cancelFrame !== null;
  }

  /** 用 `frameLoop(1, caller, method)` 注册每显示帧回调；已在运行时不重复注册。 */
  start(callback: () => void): void {
    if (this.cancelFrame !== null) {
      return;
    }
    this.callback = callback;
    const timer = this.timerProvider();
    const method = () => {
      this.callback?.();
    };
    timer.frameLoop(1, this.caller, method);
    this.cancelFrame = () => {
      timer.clear(this.caller, method);
    };
  }

  /** 用 `clear(caller, method)` 取消注册并清理干净；可安全重复调用。 */
  stop(): void {
    if (this.cancelFrame === null) {
      return;
    }
    const cancel = this.cancelFrame;
    this.cancelFrame = null;
    this.callback = null;
    cancel();
  }
}
