/**
 * 千夜追忆（TNA）UI 贴图精灵。
 *
 * 按 `docs/ART_POLICY.md`，界面上的图标/血环/滑杆/关闭按钮也**只**来自 TNA
 * 导入树（`tna/ui/*.png` 与根目录的 `bg_menu.png`），客户端不自绘这些图形作为
 * 最终表现。这些图是**独立贴图**而不是图集帧，所以走
 * `LayaAtlasFrameSource.ensureImage`（按需加载 + 成功后记忆），而不是 `frame`。
 *
 * 为什么要有这一层：`ensureImage` 是异步的，而场景布局是同步的。`TnaUiImage`
 * 把「换图请求」和「加载结果」解耦——
 *
 *  - `setImage(name, height)` 同步登记请求并返回，精灵在纹理到达前保持隐藏；
 *  - 请求带**序号**，迟到的旧加载（例如一秒内连换两次图）不会覆盖新图；
 *  - 纹理缺失时精灵保持隐藏，**不回落任何自制矢量图形**（宁可空，也不换风格）。
 *
 * 缩放规则与 `CoopView.blit` 一致：按**原始像素高度**等比缩放到 `displayHeight`，
 * 因为 `sprite.size()` 会把带纹理的精灵拉变形（见 `texture_sprite`）。
 *
 * NOTE: `platform/laya/` only。
 */

import { sharedTnaFrameSource, type LayaAtlasFrameSource } from './bullet_atlas';

export class TnaUiImage {
  readonly sprite: Laya.Sprite;

  private readonly source: LayaAtlasFrameSource;
  /** 当前请求的贴图名（TNA 根相对路径）；空串 = 从未请求。 */
  private name = '';
  /** 当前请求的显示高度（像素）；<=0 表示按原始尺寸。 */
  private height = 0;
  /** 请求序号：每次 `setImage` 递增，用于丢弃迟到的加载结果。 */
  private token = 0;
  /** 当前请求的落定结果（`true` = 纹理已贴上）。 */
  private pending: Promise<boolean> = Promise.resolve(false);
  private resolvePending: ((value: boolean) => void) | null = null;

  constructor(source: LayaAtlasFrameSource = sharedTnaFrameSource()) {
    this.source = source;
    this.sprite = new Laya.Sprite();
    this.sprite.mouseEnabled = false;
    this.sprite.visible = false;
  }

  /** 当前请求的贴图名（`''` = 无请求）。 */
  get imageName(): string {
    return this.name;
  }

  /** 纹理是否已经贴上去（可用来决定是否还要显示文本兜底）。 */
  get isReady(): boolean {
    return this.sprite.texture !== null && this.sprite.texture !== undefined;
  }

  /**
   * 请求一张 TNA UI 贴图。
   *
   * @param name TNA 根相对路径，例如 `ui/btn_pause.png`
   * @param displayHeight 目标显示高度（像素）；宽度按原始宽高比跟随
   */
  setImage(name: string, displayHeight: number): void {
    const height = Math.max(0, displayHeight);
    if (name === this.name && height === this.height && this.isReady) {
      // 同一张图、同一尺寸：纹理已在手，直接点亮（`hide()` 之后复显也走这里）。
      this.sprite.visible = true;
      this.pending = Promise.resolve(true);
      return;
    }
    this.name = name;
    this.height = height;
    this.token += 1;
    // 上一个请求的等待者不能永远悬着：先按「当前是否已有纹理」落定它。
    this.settle(this.isReady);
    this.pending = new Promise<boolean>((resolve) => {
      this.resolvePending = resolve;
    });
    if (name === '') {
      this.settle(false);
      return;
    }
    void this.apply(this.token);
  }

  /**
   * 等当前请求落定：`true` = 纹理已贴上，`false` = 该图缺失（精灵保持隐藏）。
   *
   * 界面用它决定「美术到位后是否收起文本兜底」——不必轮询 `isReady`。
   */
  whenSettled(): Promise<boolean> {
    return this.pending;
  }

  /** 隐藏（不清除请求，再次 `setImage` 同一张图会立即复用已加载纹理）。 */
  hide(): void {
    this.sprite.visible = false;
  }

  /**
   * 重新显示。纹理尚未就绪时保持隐藏——在途的加载完成后会自动点亮，所以
   * 调用方可以在「第一次显示」之前就调用它，不必等图。
   */
  show(): void {
    if (this.isReady) {
      this.sprite.visible = true;
    }
  }

  destroy(): void {
    this.sprite.destroy(true);
  }

  private async apply(token: number): Promise<void> {
    // `ensureImage` 依赖 `load()` 先探明部署根（web / LayaNative 不同）。
    await this.source.load();
    const name = this.name;
    if (name === '' || token !== this.token) {
      return;
    }
    const texture = await this.source.ensureImage(name);
    // 加载期间可能又换了图：只有最后一次请求有权落笔。
    if (token !== this.token) {
      return;
    }
    if (texture === null || texture === undefined) {
      this.sprite.visible = false;
      this.settle(false);
      return;
    }
    this.paint(texture);
    this.settle(true);
  }

  /** 落定当前请求（迟到的旧请求不会走到这里，序号已在上游拦下）。 */
  private settle(value: boolean): void {
    const resolve = this.resolvePending;
    this.resolvePending = null;
    if (resolve !== null) {
      resolve(value);
    }
  }

  private paint(texture: Laya.Texture): void {
    const sourceW = texture.sourceWidth || texture.width || 1;
    const sourceH = texture.sourceHeight || texture.height || 1;
    this.sprite.texture = texture;
    // 以原始尺寸的中心为锚点，调用方只负责 `pos()` 与 `rotation`。
    this.sprite.pivot(sourceW / 2, sourceH / 2);
    const scale = this.height > 0 ? this.height / sourceH : 1;
    this.sprite.scaleX = scale;
    this.sprite.scaleY = scale;
    this.sprite.visible = true;
  }
}
