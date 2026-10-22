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
  /** 锚点（0..1，默认居中）。左对齐的标题牌用 `setAnchor(0, 0.5)`。 */
  private anchorX = 0.5;
  private anchorY = 0.5;
  /** 最近一次贴上的纹理原始尺寸，`setAnchor` 用它重算 pivot。 */
  private sourceW = 0;
  private sourceH = 0;
  /** 非等比拉伸目标（宽高都为 0 = 关闭，走等比缩放）。 */
  private stretchW = 0;
  private stretchH = 0;
  /** 左裁比例（1 = 不裁）。 */
  private crop = 1;
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
    // 等比缩放模式：清掉之前可能设过的拉伸目标（后调用者生效）。
    this.stretchW = 0;
    this.stretchH = 0;
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
   * 设置锚点：`(0, 0.5)` = 左边中点对齐，`(0.5, 0.5)`（默认）= 居中。
   * 左对齐的标题牌用它，就不必先知道缩放后的宽度。
   */
  setAnchor(x: number, y: number): void {
    this.anchorX = x;
    this.anchorY = y;
    if (this.isReady) {
      this.repivot();
    }
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
   * 非等比拉伸到给定宽高（条状图专用：滑杆轨道/填充段这类横向可拉伸的图）。
   *
   * 与 `setImage(name, displayHeight)` 的等比缩放互斥——后调用者生效。
   */
  setStretched(width: number, height: number): void {
    this.stretchW = Math.max(0, width);
    this.stretchH = Math.max(0, height);
    this.height = 0;
    if (this.isReady) {
      this.applyTransform();
    }
  }

  /**
   * 只显示纹理左侧 `fraction`（0..1）的部分，用于「已填充」的进度段。
   *
   * 用 `scrollRect` 裁剪而不是横向压缩：压缩会把胶囊端头挤成椭圆。
   */
  setCrop(fraction: number): void {
    this.crop = Math.max(0, Math.min(1, fraction));
    if (this.isReady) {
      this.applyTransform();
    }
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
    this.sourceW = sourceW;
    this.sourceH = sourceH;
    this.sprite.texture = texture;
    this.repivot();
    this.applyTransform();
    this.sprite.visible = true;
  }

  /** 应用缩放与裁剪（等比缩放 / 拉伸 / 左裁三种模式都在这里收口）。 */
  private applyTransform(): void {
    if (this.sourceW <= 0 || this.sourceH <= 0) {
      return;
    }
    if (this.stretchW > 0 && this.stretchH > 0) {
      this.sprite.scaleX = this.stretchW / this.sourceW;
      this.sprite.scaleY = this.stretchH / this.sourceH;
    } else {
      const scale = this.height > 0 ? this.height / this.sourceH : 1;
      this.sprite.scaleX = scale;
      this.sprite.scaleY = scale;
    }
    if (this.crop < 1) {
      this.sprite.scrollRect = new Laya.Rectangle(0, 0, this.sourceW * this.crop, this.sourceH);
    } else {
      this.sprite.scrollRect = null;
    }
  }

  /** 按当前锚点把 pivot 落在原始尺寸上（缩放不改变 pivot 的比例关系）。 */
  private repivot(): void {
    if (this.sourceW <= 0 || this.sourceH <= 0) {
      return;
    }
    this.sprite.pivot(this.sourceW * this.anchorX, this.sourceH * this.anchorY);
  }
}
