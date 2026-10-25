/**
 * Battle screen: drives the fixed-tick loop, sends input, renders the race.
 *
 * Rendering prefers the latest authoritative server snapshot and falls back to
 * the local prediction before the first snapshot arrives. The local
 * `BossRaceSimulation` still runs every tick so reconciliation metrics (position
 * error, state-hash match, hard-snap count) stay meaningful.
 *
 * On top of the playfield the scene owns the "performance" layers — a scrolling
 * stage background, the character/boss watermarks, a stage-entrance cutscene and
 * the battle audio. All of them advance off the scene's single fixed-tick timer
 * (no extra timer), and none of them write to the battle simulation.
 */

import type { BattleClient, BattleCorrectionMetrics } from '../../../core/net/battle_client';
import { BattleConnectionState } from '../../../core/net/battle_client';
import { pageNumberParam } from '../page_params';
import type { TimerLike } from '../../../core/net/transport';
import { battleLayout, type BattleLayout } from '../../../core/game/battle_layout';
import { buildBossRaceFrame, buildJudgmentHud, type BossEffectRenderItem, type BossRaceFrame, type PlayerRenderItem, type RenderPoint, PlayfieldTransform, bossOriginPixels } from '../../../core/game/boss_race_view_model';
import { buildCoopFrame, coopArenaDirectionBits, coopLocalSeat, type CoopFrame } from '../../../core/game/coop_view_model';
import { coopBattleLayout } from '../../../core/game/coop_layout';
import { COOP_MODE_ID, type CoopBossSnapshot } from '../../../core/sim/coop_boss';
import { describeDirectionBits, encodeInput } from '../../../core/game/input';
import { HandBarController, CardActionController, snapshotHandBar } from '../../../core/game/card_hand_view';
import { DraftPanelController, localGrantCardId } from '../../../core/game/draft_panel_view';
import {
  draftPickFromEvent,
  draftViewFromEvent,
  eventToSfx,
  toCardEffectEvent,
  type MatchEventView,
} from '../../../core/game/battle_events';
import type { BattleOpeningState } from '../../../core/net/lobby_client';
import { defaultCutsceneSteps } from '../../../core/game/stage_visual';
import type { BossRaceEventView, BossRaceHandCard, BossRaceSnapshot } from '../../../core/sim/boss_race';
import {
  BOSS_ORIGIN_X_MILLI,
  BOSS_ORIGIN_Y_MILLI,
  BOSS_RACE_PATTERN_IDS,
  BOSS_RACE_PATTERN_PERIOD_TICKS,
  BOSS_RACE_TICK_RATE_HZ,
  BossRaceState,
} from '../../../core/sim/boss_race';
import {
  cardEffectDefinition,
  invulnerableRemainingTicks,
  opponentPatternWarning,
  purgeRadiusMilli,
  purgeSpecFor,
  selectPurgeTargets,
  type CardEffectKind,
} from '../../../core/sim/card_effects';
import type { LayaInput } from '../laya_input';
import { BattleAudioManager } from '../audio_manager';
import { BossRaceView } from '../view/boss_race_view';
import { CoopView } from '../view/coop_view';
import { AtlasBulletRenderer } from '../view/bullets';
import { sharedTnaFrameSource } from '../view/bullet_atlas';
import { sharedGiftIconSource } from '../view/gift_icons';
import { CutsceneOverlay } from '../view/cutscene';
import type { HudState } from '../view/hud';
import { fade } from '../view/sprites';
import { DraftPanel } from '../view/draft_panel';
import { HandBar } from '../view/hand_bar';
import { giftBarView, giftGlyphPath, affordableGiftAt, giftAnnouncement, type GiftBarView } from '../../../core/game/gift_bar_view';
import { GIFT_CHARGE_BUDGET, giftDefinition } from '../../../core/game/gift_catalog';
import { t } from '../../../core/game/i18n';
import { giftViewFromEvent } from '../../../core/game/battle_events';
import { StageBackgroundLayer } from '../view/stage_background';
import { TnaUiImage } from '../view/tna_ui';
import { UI_PAUSE_ICON, titlePlaque } from '../../../core/game/ui_assets';
import * as theme from '../view/theme';
import { WatermarkLayer } from '../view/watermark';
import type { ShortcutAction, ShortcutScope } from '../../../core/input/shortcuts';
import type { ClientScene } from './scene';

/**
 * Gift-bar geometry, shared by `drawGiftLayer` (which paints the slots) and
 * `relayout` (which places the charge readout above them), so the text can
 * never drift away from the bar it describes.
 */
const GIFT_BOX = 26;
const GIFT_GAP = 6;
/** Distance between the bar's bottom edge and the playfield's bottom edge. */
const GIFT_BOTTOM_MARGIN = 10;

export interface BattleSceneOptions {
  width: number;
  height: number;
  battle: BattleClient;
  input: LayaInput;
  timer: TimerLike;
  /** Lazily read: the player id is only known after lobby sign-in. */
  localPlayerId: () => string;
  bossMaxHp: number;
  /**
   * Server-side tick cap, used for the HUD countdown. Optional: when omitted
   * the countdown row is hidden rather than showing a made-up value. The battle
   * server runs with `--max-ticks 7200` by default, so callers that know that
   * figure should pass it.
   */
  matchTickLimit?: number;
  /** Tick rate for the countdown clock. Defaults to the simulation's 64Hz. */
  tickRateHz?: number;
  /**
   * Input-tick latency lead in ticks (64Hz). The battle server's `SubmitInput`
   * only accepts ticks in `(server_current, server_current + 8]`; an input
   * anchored to a snapshot that arrived one RTT ago is already stale, so a
   * high-latency route (cross-border demo: ~150ms RTT ≈ 9 ticks) silently
   * drops every input — the local player never moves and deals no damage.
   * 0 keeps the plain `anchor + 1` behaviour (low-latency links).
   */
  inputLeadTicks?: number;
  /**
   * Explicit override for the purge RNG seed, as decimal text. Intended for
   * tests and offline demos; in a real match the seed comes from
   * {@link serverSeedDecimal}. When neither is set the purge hides nothing
   * (the deterministic pick is unknowable), never a silent `0`.
   */
  cardEffectSeed?: string;
  /**
   * Lazily read lobby match seed (`match.ServerSeed`) as decimal text, e.g.
   * `bossRaceSeedFromHex(hex).decimal`. Lazy because the seed only arrives with
   * `match_start` / the battle allocation, after sign-in.
   */
  serverSeedDecimal?: () => string;
  /**
   * Lazily read opening loadout from the signed battle ticket
   * (`BattleTicketView.opening`): the hand the lobby dealt and the opening
   * energy. Lazy for the same reason as {@link serverSeedDecimal} — the ticket
   * only arrives after `match_start`. Return `null` before then; the hand bar
   * simply draws nothing. The provider may allocate a fresh object per call
   * (the scene compares by value), but a stable reference is cheaper.
   */
  openingHand?: () => BattleOpeningState | null;
  /**
   * Lazily read the local player's **lobby** user id. The draft events name
   * players by lobby `user_id` (not the battle roster id), so this is what
   * decides the picker's role and which grants belong to this player. Empty
   * before sign-in, which reads as a spectator.
   */
  localUserId?: () => string;
  /**
   * Submits one draft pick, exactly as `LobbyClient.selectRoundCard` does
   * (`match.mode_action` with `candidate_index`). Called only from a candidate
   * click by the designated picker; the scene never builds the pick itself.
   */
  selectDraftCard?: (matchId: string, candidateIndex: number, modeId: string) => void;
  /**
   * Sends one in-match gift, exactly as `LobbyClient.sendMatchGift` does
   * (`match.mode_action` with a `gift` action). Called only from a gift-bar
   * click; the scene never builds the payload itself. Optional so the scene
   * still runs without a lobby (offline demos).
   */
  sendGift?: (matchId: string, giftId: string, modeId: string) => void;
  /**
   * Lazily read the local player's **remaining gift charges** (the independent
   * per-match pool, `0..GIFT_CHARGE_BUDGET` — NOT card energy). Decides which
   * gifts the bar greys out. Optional: without a provider the bar assumes the
   * full budget, so a standalone scene shows every gift as sendable rather
   * than greying the whole bar.
   */
  giftCharges?: () => number;
  /**
   * Called on `onEnter`. The app uses it to start the match-event poller (the
   * scene itself owns no network source); optional so the scene still runs
   * standalone.
   */
  onPerformanceEnter?: () => void;
  /** Called on `onExit`; the app uses it to stop the match-event poller. */
  onPerformanceExit?: () => void;
  onMatchEnd?: (winnerPlayerId: string) => void;
}

/**
 * One card effect to present on the battle field.
 *
 * The client has no authoritative card-event channel yet (the C++ battle server
 * only forwards `deck_card_ids`; the lobby owns card resolution), so this is the
 * seam a caller drives — either from a future `card_effect_applied` event or, in
 * tests, directly. The scene renders it and, for `bullet_purge`, hides the
 * matching locally predicted bullets.
 */
export interface CardEffectEvent {
  cardId: string;
  /** `EffectKind`; unknown kinds fall back to the card's static definition. */
  effectKind?: string;
  /** Roster id of the player the effect targets (defaults to the opponent). */
  targetPlayerId?: string;
  /** Overrides the definition's `durationTicks` for the visual window. */
  durationTicks?: number;
  /** Overrides the definition's `damage`. */
  damage?: number;
  /** Curtain pattern id (`opponent_pattern`); defaults to the card id. */
  patternId?: string;
  /** Clear radius in playfield pixels (`bullet_purge`). */
  purgeRadius?: number;
  /** Bullets removed (`bullet_purge`). */
  purgeCount?: number;
}

/** A resolved effect the scene is currently animating. */
interface ActiveCardEffect {
  cardId: string;
  effectKind: CardEffectKind;
  startTick: number;
  /** Visual lifetime in ticks. */
  durationTicks: number;
  targetPlayerId: string;
  patternId: string;
  /** Pixel radius of the purge ring (`bullet_purge`). */
  purgeRadiusPx: number;
  /** Bullet ids hidden while the purge is active. */
  purgedIds: Set<string>;
  damage: number;
}

export class BattleScene implements ClientScene {
  readonly root: Laya.Sprite;
  readonly shortcutScope: ShortcutScope = 'battle';

  private readonly view: BossRaceView;
  private readonly options: BattleSceneOptions;
  private geometry: BattleLayout;
  // Shared with `BossRaceView`'s actor renderer so the 25 atlases are sliced
  // once, not once per instance.
  private readonly bulletAtlas = sharedTnaFrameSource();
  /**
   * Gift-bar icons: the six 64x64 PNGs of {@link ../core/game/gift_assets}.
   * A miss keeps the bar on its vector glyphs, so this load is best-effort.
   */
  private readonly giftIcons = sharedGiftIconSource();
  private readonly bulletRenderer: AtlasBulletRenderer;
  /** Scrolling stage background, painted under every other layer. */
  private readonly stageBackground: StageBackgroundLayer;
  /** Character/boss watermark portraits, above the actors and below the HUD. */
  private readonly watermark: WatermarkLayer;
  /** Stage-entrance cutscene, above the effects and below the PAUSED banner. */
  private readonly cutscene: CutsceneOverlay;
  /** Battle audio (stage BGM + match-event SEs). */
  private readonly audio = new BattleAudioManager();
  /** Full-stage banner shown while the tick loop is held by `battle.pause`. */
  private readonly pauseOverlay: Laya.Text;
  /**
   * TNA `ui/btn_pause.png` shown above the PAUSED banner. Per
   * `docs/ART_POLICY.md` the pause state is carried by the imported art, not by
   * a vector glyph; the text banner stays as the readable label.
   */
  private readonly pauseIcon: TnaUiImage;
  /**
   * TNA `ui/bar_pause_menu.png`——APK 烘焙好的「Pause Menu」标题牌，压在
   * 暂停横幅中央；它到位后 `pauseOverlay` 的文本只作缺图兜底。
   */
  private readonly pausePlaque: TnaUiImage;
  /**
   * Card-effect overlay, layered between the playfield view and the pause
   * banner. Draws the aimed-curtain warning, the purge ring, the invulnerability
   * aura and the finisher flash; it owns no game state beyond the effect list.
   */
  private readonly effectLayer: Laya.Sprite;
  /** Effect readout (invulnerability countdown, last finisher damage). */
  private readonly effectText: Laya.Text;
  /** Gift announcement line, centred above the gift bar. */
  private readonly giftText: Laya.Text;
  /** Remaining gift-charge readout (`心意 x/5`), just above the gift bar. */
  private readonly giftChargesText: Laya.Text;
  /**
   * Hand bar: the ticket's opening hand as cast slots plus the energy readout.
   * Sits above the card effects and below the cutscene / pause banner.
   */
  private readonly handBar: HandBar;
  /** Hand-bar state: the dealt hand and the one-shot cast intent. */
  private readonly handController = new HandBarController();
  /**
   * §2.3 抽卡/选卡/用卡状态机：抽卡与用卡是**一次性脉冲**，选卡是持续状态，
   * 每帧随输入上行（见 `core/game/card_hand_view.CardActionController`）。
   */
  private readonly cardActions = new CardActionController();
  /**
   * Signature of the hand currently mirrored into the bar. The provider is
   * polled every tick, so the bar is only rebuilt when the hand actually
   * changes (including a change from "no ticket yet" to the dealt hand).
   */
  private lastHandKey = '\u0001';
  /** 快照手牌（§2.8 hand/deck/cooldown）的签名，避免每 tick 重绘。 */
  private lastSnapshotHandKey = '\u0001';
  /**
   * 最近一条符卡相关快照事件（`events[]` 里 `type` 以 `card` 开头的行）。
   *
   * P1 阶段服务端还只下发占位事件，所以这里**只解析不表现**：等 P3 定下
   * `card_drawn` / `card_cast` / `card_refused` 的字段与文案后，再由这里驱动
   * 手牌栏的 toast。暴露给测试与调试面板读取。
   */
  private lastCardEvent: BossRaceEventView | null = null;
  /**
   * Draft panel: the three candidates of an open mixed-pool round. Centred
   * over the playfield, above the hand bar and below the pause banner.
   */
  private readonly draftPanel: DraftPanel;
  /** Draft state: the open round and the pick submission. */
  private readonly draftController: DraftPanelController;
  private readonly activeEffects: ActiveCardEffect[] = [];
  private lastFinisherDamage = 0;
  private authoritative: BossRaceSnapshot | null = null;
  /**
   * §2.9 插值：上一份权威快照与它的到达时刻。
   *
   * `render_tick = last_snapshot_tick + frac`，`frac` = 「距上一份快照过了多少
   * 个 tick 间隔」。玩家/Boss（无速度）用 `previous → authoritative` 差分插值，
   * 弹幕（有速度）用最新快照的 vx/vy 外推。本地镜像模拟**不参与**这条路径。
   */
  private previousAuthoritative: BossRaceSnapshot | null = null;
  private authoritativeAtMs = 0;
  /** 相邻两份权威快照的到达间隔（ms）；0 = 还没有第二份，插值退化为直显。 */
  private authoritativeIntervalMs = 0;
  // 合作模式（coop_boss）：快照来自字节 12，渲染走 CoopView，座位决定视野旋转。
  private coopAuthoritative: CoopBossSnapshot | null = null;
  private previousCoopAuthoritative: CoopBossSnapshot | null = null;
  private coopAuthoritativeAtMs = 0;
  private coopAuthoritativeIntervalMs = 0;
  private coopFrame: CoopFrame | null = null;
  private coopView: CoopView | null = null;
  private coopSeatCount = 2;
  private tickHandle = 0;
  private running = false;
  private paused = false;
  private frame: BossRaceFrame | null = null;
  private matchEnded = false;
  /** Lobby stage id whose BGM is playing (empty until the snapshot arrives). */
  private stageId = '';
  /** Cutscene banner text for the stage title. */
  private stageTitle = 'BATTLE';
  private characterPortraitName = '';
  private bossPortraitName = '';

  constructor(options: BattleSceneOptions) {
    this.options = options;
    const { width, height } = this.stageSize();
    this.geometry = this.computeGeometry(width, height);
    this.root = new Laya.Sprite();
    this.root.size(width, height);
    this.root.visible = false;

    // Real 千夜追忆 art is authored for a 640-wide playfield; scale it to ours.
    const artScale = this.geometry.playfield.width / 640;
    this.bulletRenderer = new AtlasBulletRenderer(this.bulletAtlas, artScale);
    void this.bulletAtlas.load();
    // Best-effort: the gift bar draws its vector glyphs until (and unless) the
    // icon files resolve, so a failed load must never hold up the scene.
    void this.giftIcons.load();

    // The scrolling background is handed to the view, which paints it above its
    // opaque stage fill but below the playfield grid; the scene positions and
    // sizes it over the playfield (the client's analogue of the reference's
    // 320x480 stage) in `relayout`.
    this.stageBackground = new StageBackgroundLayer();

    // The watermark is handed to the view so it can sit between the actors and
    // the HUD strip; the view owns its z-order from then on.
    this.watermark = new WatermarkLayer();

    this.view = new BossRaceView({
      layout: this.geometry.playfield,
      playfieldX: this.geometry.playfieldX,
      playfieldY: this.geometry.playfieldY,
      hudWidth: this.geometry.hudWidth,
      hudHeight: this.geometry.hudHeight,
      hudX: this.geometry.hudX,
      stageWidth: width,
      stageHeight: height,
      bulletRenderer: this.bulletRenderer,
      watermark: this.watermark.root,
      backgroundLayer: this.stageBackground.root,
    });
    this.root.addChild(this.view.root);

    // Card-effect overlay: drawn above the playfield actors but below the pause
    // banner. Its geometry tracks the playfield in `relayout`.
    this.effectLayer = new Laya.Sprite();
    this.root.addChild(this.effectLayer);

    this.effectText = new Laya.Text();
    this.effectText.fontSize = theme.FONT_SIZE_CAPTION;
    this.effectText.bold = true;
    this.effectText.color = theme.COLOR_ACCENT;
    this.effectText.align = 'center';
    this.effectText.visible = false;
    this.root.addChild(this.effectText);

    // The gift announcement shares the effect text's styling; it lives above
    // the gift bar so a toast never covers a slot.
    this.giftText = new Laya.Text();
    this.giftText.fontSize = theme.FONT_SIZE_CAPTION;
    this.giftText.bold = true;
    this.giftText.color = theme.COLOR_INFO;
    this.giftText.align = 'center';
    this.giftText.visible = false;
    this.root.addChild(this.giftText);

    // Remaining gift charges, read out just above the gift bar. Same styling
    // as the announcement; turns warning-coloured once the pool is spent.
    this.giftChargesText = new Laya.Text();
    this.giftChargesText.fontSize = theme.FONT_SIZE_CAPTION;
    this.giftChargesText.bold = true;
    this.giftChargesText.color = theme.COLOR_INFO;
    this.giftChargesText.align = 'center';
    this.giftChargesText.visible = false;
    this.root.addChild(this.giftChargesText);

    // The hand bar hugs the bottom of the playfield: above the card effects
    // (so a purge ring does not hide a slot) and below the entrance cutscene
    // and the pause banner (so a pause always wins visually). Its click is a
    // one-shot cast intent consumed by the next input packet in `step`.
    this.handBar = new HandBar();
    this.handBar.onSlotClick = (index) => {
      // 选中（§2.3 card_select，持续状态）与既有的「点一下就用」一次性意图
      // 并行：服务端目前只认 `card_slot`，P3 接上 `card_use` 后再二选一。
      this.handController.click(index);
      this.cardActions.select(index);
    };
    this.handBar.onDraw = () => this.cardActions.requestDraw();
    this.handBar.onUse = () => this.cardActions.requestUse();
    this.root.addChild(this.handBar.root);

    // The draft panel sits above the hand bar; a candidate click becomes one
    // `select_round_card` submission through the injected lobby callback.
    this.draftPanel = new DraftPanel();
    this.draftController = new DraftPanelController((matchId, candidateIndex, modeId) =>
      this.options.selectDraftCard?.(matchId, candidateIndex, modeId),
    );
    this.draftPanel.onCandidateClick = (index) => this.draftController.click(index);
    this.root.addChild(this.draftPanel.root);

    // The stage-entrance cutscene sits above the card effects but below the
    // PAUSED banner (a pause should always win visually).
    this.cutscene = new CutsceneOverlay();
    this.root.addChild(this.cutscene.root);

    // The scene owns no HUD/status text of its own (the strip belongs to
    // `BossRaceView`), so the paused state is surfaced with a full-stage banner
    // layered above the playfield. Added after the view so it paints on top.
    this.pauseOverlay = new Laya.Text();
    this.pauseOverlay.text = 'PAUSED';
    this.pauseOverlay.fontSize = theme.FONT_SIZE_TITLE;
    this.pauseOverlay.bold = true;
    this.pauseOverlay.color = theme.COLOR_ACCENT;
    this.pauseOverlay.align = 'center';
    this.pauseOverlay.valign = 'middle';
    this.pauseOverlay.size(width, height);
    this.pauseOverlay.visible = false;
    this.root.addChild(this.pauseOverlay);

    // Pause icon sits above the banner text; it loads on first pause only, so a
    // match that is never paused costs no fetch.
    this.pauseIcon = new TnaUiImage(this.bulletAtlas);
    this.pauseIcon.sprite.visible = false;
    this.root.addChild(this.pauseIcon.sprite);
    this.pausePlaque = new TnaUiImage(this.bulletAtlas);
    this.pausePlaque.sprite.visible = false;
    this.root.addChild(this.pausePlaque.sprite);

    this.options.battle.onSnapshot((snapshot) => {
      const now = Date.now();
      if (this.authoritative !== null) {
        this.previousAuthoritative = this.authoritative;
        const gap = now - this.authoritativeAtMs;
        if (gap > 0) {
          this.authoritativeIntervalMs = gap;
        }
      }
      this.authoritative = snapshot;
      this.authoritativeAtMs = now;
      if (snapshot.winnerPlayerId !== '' && !this.matchEnded) {
        this.matchEnded = true;
        this.options.onMatchEnd?.(snapshot.winnerPlayerId);
      }
    });

    // 合作模式快照：只有 mode_id = coop_boss 的对局会收到。
    this.options.battle.onCoopSnapshot((snapshot) => {
      const now = Date.now();
      if (this.coopAuthoritative !== null) {
        this.previousCoopAuthoritative = this.coopAuthoritative;
        const gap = now - this.coopAuthoritativeAtMs;
        if (gap > 0) {
          this.coopAuthoritativeIntervalMs = gap;
        }
      }
      this.coopAuthoritative = snapshot;
      this.coopAuthoritativeAtMs = now;
    });

    // Apply the stage-sized layout once so the first frame already matches the
    // window (the stage may differ from `options` on a resizable native window).
    this.relayout(width, height);
  }

  /** Gift bar state: rebuilt every frame from the local energy. */
  private giftBar: GiftBarView = giftBarView(GIFT_CHARGE_BUDGET, -1);
  /** Slot the pointer last picked; -1 until the player clicks one. */
  private giftSelected = -1;
  /** Active gift announcement: the line plus the tick it expires on. */
  private giftToast: { text: string; untilTick: number } | null = null;
  /** Hit boxes of the gift bar slots, refreshed with every draw. */
  private giftHitBoxes: { x: number; y: number; w: number; h: number; index: number }[] = [];

  onEnter(): void {
    this.root.visible = true;
    // Re-register idempotently: `onEnter` can run again after an `onExit`.
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    Laya.stage.on(Laya.Event.RESIZE, this, this.onStageResize);
    // A battle always starts live; never carry a previous pause into it.
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.clearCardEffects();
    // Mirror whatever opening loadout the ticket has already delivered.
    this.syncHand();
    // Reset the overlays, replay the entrance cutscene and (re)start the stage
    // track from the stage the snapshot last reported.
    this.resetOverlays();
    this.cutscene.play(defaultCutsceneSteps(this.stageTitle));
    this.audio.playStageBgm(this.stageId);
    // Let the app start its match-event poller; the scene owns no network.
    this.options.onPerformanceEnter?.();
    this.start();
  }

  onExit(): void {
    this.root.visible = false;
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    this.paused = false;
    this.pauseOverlay.visible = false;
    this.clearCardEffects();
    this.resetOverlays();
    // Nothing should bleed across screens.
    this.audio.stopAll();
    this.options.onPerformanceExit?.();
    this.stop();
  }

  destroy(): void {
    Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
    this.stop();
    this.clearCardEffects();
    this.view.destroy();
    this.coopView?.destroy();
    this.coopView = null;
    this.stageBackground.destroy();
    this.watermark.destroy();
    this.cutscene.destroy();
    this.handBar.destroy();
    this.draftPanel.destroy();
    this.root.destroy(true);
  }

  /** Resets the transient overlay state (the entrance cutscene, any open draft). */
  private resetOverlays(): void {
    this.cutscene.reset();
    // No round is open when a battle (re)starts; a `draft_open` shows it again.
    this.draftController.setDraft(null);
    this.draftPanel.setView(null);
  }

  /**
   * Selects the stage background (reference stage 1..4) and the banner text for
   * the entrance cutscene. Called by the app once the match snapshot resolves.
   */
  setStage(stage: number): void {
    this.stageBackground.setStage(stage);
    this.coopView?.setStage(stage);
    this.stageTitle = stage >= 1 ? `STAGE ${stage}` : 'BATTLE';
  }

  /** Sets the local character's watermark portrait (TNA-root-relative name). */
  showCharacter(portrait: string): void {
    this.characterPortraitName = portrait;
    this.watermark.showCharacter(portrait);
    this.cutscene.setPortraits(portrait, this.bossPortraitName);
  }

  /** Sets the boss watermark portrait (TNA-root-relative name) and its phase. */
  showBoss(portrait: string, phase: number): void {
    this.bossPortraitName = portrait;
    this.watermark.showBoss(portrait, phase);
    this.cutscene.setPortraits(this.characterPortraitName, portrait);
  }

  /** Starts (or restarts) the stage BGM. An unknown id plays nothing. */
  playStageBgm(stageId: string): void {
    this.stageId = stageId;
    this.audio.playStageBgm(stageId);
  }

  /**
   * Bridges one lobby match event into the scene's visuals and audio: card
   * effects are presented through {@link applyCardEffect}, and the event's SE
   * channel (when any) plays through the throttled audio manager.
   *
   * @param resolveRosterId maps the event's lobby `user_id` to the battle roster
   *        id (`p-<hash>`); see `app.ts` for how it is derived.
   */
  applyMatchEvent(event: MatchEventView, resolveRosterId: (userId: string) => string): void {
    const effect = toCardEffectEvent(event, resolveRosterId);
    if (effect !== null) {
      this.applyCardEffect(effect);
    }
    const sfx = eventToSfx(event);
    if (sfx !== null) {
      this.audio.playSfx(sfx);
    }
    this.handleDraftEvent(event);
  }

  /**
   * Bridges the draft event family onto the panel and the hand bar.
   *
   * `draft_open` shows the round's three candidates; `draft_grant` appends the
   * local player's card to the hand and closes the panel; `draft_timeout` /
   * `draft_skipped` close it too. `draft_pick` carries the first picker's
   * card: the panel remembers it and drops it from the second picker's offered
   * set (keeping the original `candidate_index` of every card left on offer).
   *
   * A deferred grant (`card_grant_deferred`) is *not* added to the visible
   * hand: the card waits in the server's pending list, so the bar keeps showing
   * the four cards that are actually playable.
   */
  private handleDraftEvent(event: MatchEventView): void {
    switch (event.type) {
      case 'draft_open': {
        this.refreshDraftContext();
        this.draftController.setDraft(draftViewFromEvent(event));
        this.draftPanel.setView(this.draftController.panel);
        break;
      }
      case 'draft_pick': {
        // Only the first picker's pick changes what the panel offers (to the
        // second picker); anything else leaves the open round untouched.
        if (this.draftController.notePick(draftPickFromEvent(event))) {
          this.draftPanel.setView(this.draftController.panel);
        }
        break;
      }
      case 'draft_grant':
      case 'card_grant_deferred': {
        // Only this player's immediate grants change this player's hand; the
        // opponent's grant and a deferred one must leave it untouched.
        const cardId = localGrantCardId(event, this.options.localUserId?.() ?? '');
        if (cardId !== null && this.handController.applyGrant(cardId)) {
          this.handBar.setView(this.handController.view);
        }
        this.draftController.setDraft(null);
        this.draftPanel.setView(null);
        break;
      }
      case 'draft_timeout':
      case 'draft_skipped':
        this.draftController.setDraft(null);
        this.draftPanel.setView(null);
        break;
      default:
        break;
    }
  }

  /** Refreshes the match context a draft pick is submitted against. */
  private refreshDraftContext(): void {
    const info = this.options.battle.info;
    this.draftController.setContext(
      info?.matchId ?? '',
      info?.modeId ?? '',
      this.options.localUserId?.() ?? '',
    );
  }

  /** Drops every card effect and its overlay paint. */
  private clearCardEffects(): void {
    this.activeEffects.length = 0;
    this.lastFinisherDamage = 0;
    this.effectLayer.graphics.clear();
    this.effectText.text = '';
    this.effectText.visible = false;
  }

  /**
   * Mirrors the signed ticket's opening hand into the hand bar.
   *
   * The provider is polled every tick because the ticket arrives after
   * `match_start`; the bar is only rebuilt when the hand's signature changes,
   * so an absent ticket (and an empty hand) both settle on "draw nothing"
   * without redrawing each frame. Never touches the wire: the bar shows the
   * dealt hand verbatim and the cast intent is the only thing a click sets.
   */
  private syncHand(): void {
    const opening = this.options.openingHand?.() ?? null;
    const key = `${opening?.initialEnergy ?? 0}|${(opening?.handCardIds ?? []).join(',')}`;
    if (key === this.lastHandKey) {
      return;
    }
    this.lastHandKey = key;
    this.handController.setOpening(opening);
    this.handBar.setView(this.handController.view);
  }

  /**
   * §2.8/§2.3 快照手牌 → 手牌栏（权威路径）。
   *
   * 只有服务端真的下发了 `hand` 才接管；老服务端没有这个键时继续用 ticket
   * 的开局手牌，行为不变。选中的回显也来自这里（`hand[].selected`），所以
   * 服务端拒绝/清空选择后 UI 会跟着回去。
   */
  private syncSnapshotHand(
    hand: readonly BossRaceHandCard[] | undefined,
    deckRemaining: number | undefined,
    drawCooldownTicks: number | undefined,
  ): void {
    if (hand === undefined) {
      return;
    }
    const serverSelected = hand.find((entry) => entry.selected === true)?.slot ?? -1;
    this.cardActions.syncFromSnapshot(serverSelected);
    const key = `${hand
      .map((entry) => `${entry.slot}:${entry.cardId}:${entry.selected ? 1 : 0}`)
      .join(',')}|${deckRemaining ?? 'x'}|${drawCooldownTicks ?? 'x'}|${this.cardActions.selectedSlot}`;
    if (key === this.lastSnapshotHandKey) {
      return;
    }
    this.lastSnapshotHandKey = key;
    this.handBar.setView(
      snapshotHandBar(hand, deckRemaining, drawCooldownTicks, this.handController.energy),
    );
  }

  /**
   * §2.8 `events[]` 的符卡回显：只记录，不表现（P3 定文案后再接 toast）。
   *
   * 认 `type` 以 `card` 开头的行（`card_draw` / `card_drawn` / `card_use` /
   * `card_cast` / `card_refused` …），字段全在 `data` 里原样保留。
   */
  private noteCardEvents(snapshot: BossRaceSnapshot): void {
    const events = snapshot.events;
    if (events === undefined || events.length === 0) {
      return;
    }
    for (const event of events) {
      if (event.type.startsWith('card')) {
        this.lastCardEvent = event;
      }
    }
  }

  /**
   * Re-tiles the whole scene for a new stage size. Called once at construction
   * and again on every `Laya.Event.RESIZE`, so the playfield, status panel and
   * bullet art scale track the window instead of freezing at boot.
   */
  private relayout(width: number, height: number): void {
    this.geometry = this.computeGeometry(width, height);
    this.root.size(width, height);
    this.pauseOverlay.size(width, height);
    // The icon rides above the centred PAUSED text (which the engine draws with
    // `valign = 'middle'`), so it is parked a fixed distance up from centre.
    this.pauseIcon.setImage(UI_PAUSE_ICON, theme.FONT_SIZE_TITLE * 2.2);
    this.pauseIcon.sprite.pos(width / 2, height / 2 - theme.FONT_SIZE_TITLE * 2.4);
    // 标题牌压在横幅正中；它的贴图到位后文本横幅收起（见 `setPaused`）。
    this.pausePlaque.setImage(titlePlaque('pauseMenu'), theme.FONT_SIZE_TITLE * 1.4);
    this.pausePlaque.sprite.pos(width / 2, height / 2);
    // The background is the reference 320x480 stage model mapped onto the
    // playfield; the watermark and cutscene cover the whole stage, HUD included.
    this.stageBackground.root.pos(this.geometry.playfieldX, this.geometry.playfieldY);
    this.stageBackground.relayout(this.geometry.playfield.width, this.geometry.playfield.height);
    this.watermark.relayout(width, height);
    this.cutscene.relayout(width, height);
    // Effect overlay works in playfield-local pixels, so it shares the
    // playfield's origin and size; the readout sits in the HUD strip.
    this.effectLayer.pos(this.geometry.playfieldX, this.geometry.playfieldY);
    this.effectLayer.size(this.geometry.playfield.width, this.geometry.playfield.height);
    this.effectText.pos(this.geometry.hudX + 8, this.geometry.hudHeight - theme.FONT_SIZE_CAPTION - 8);
    this.effectText.width = this.geometry.hudWidth - 16;
    // The gift-charge readout spans the playfield just above the gift bar, so
    // it tracks the same geometry `drawGiftLayer` paints the slots with.
    const giftBarTop =
      this.geometry.playfieldY + this.geometry.playfield.height - GIFT_BOX - GIFT_BOTTOM_MARGIN;
    this.giftChargesText.pos(this.geometry.playfieldX, giftBarTop - theme.FONT_SIZE_CAPTION - 2);
    this.giftChargesText.width = this.geometry.playfield.width;
    // The hand bar spans the playfield and hugs its bottom edge.
    this.handBar.relayout({
      x: this.geometry.playfieldX,
      bottom: this.geometry.playfieldY + this.geometry.playfield.height,
      width: this.geometry.playfield.width,
    });
    // The draft panel centres itself over the whole playfield.
    this.draftPanel.relayout({
      x: this.geometry.playfieldX,
      y: this.geometry.playfieldY,
      width: this.geometry.playfield.width,
      height: this.geometry.playfield.height,
    });
    this.view.relayout({
      layout: this.geometry.playfield,
      playfieldX: this.geometry.playfieldX,
      playfieldY: this.geometry.playfieldY,
      hudX: this.geometry.hudX,
      hudWidth: this.geometry.hudWidth,
      hudHeight: this.geometry.hudHeight,
      stageWidth: width,
      stageHeight: height,
    });
    // 合作视图（若已创建）跟着同一套几何走：它自己持有 TNA 背景与精灵层。
    this.coopView?.layout(
      this.geometry.playfieldX,
      this.geometry.playfieldY,
      this.geometry.playfield.width,
      this.geometry.playfield.height,
    );
    // Real art is authored for a 640-wide playfield; keep it in step with ours.
    this.bulletRenderer.setArtScale(this.geometry.playfield.width / 640);
    this.renderFrame();
  }

  /**
   * Current stage size in pixels, falling back to the boot-time options when the
   * stage is not ready yet (width/height 0) or unavailable.
   */
  private stageSize(): { width: number; height: number } {
    const stage: Laya.Stage | undefined = Laya.stage;
    if (stage !== undefined && stage.width > 0 && stage.height > 0) {
      return { width: stage.width, height: stage.height };
    }
    return { width: this.options.width, height: this.options.height };
  }

  private onStageResize(): void {
    const { width, height } = this.stageSize();
    this.relayout(width, height);
  }

  /** 合作模式当前帧（诊断/单测用；同时让该字段成为「被读取」，满足 noUnusedLocals）。 */
  get currentCoopFrame(): CoopFrame | null {
    return this.coopFrame;
  }

  get currentFrame(): BossRaceFrame | null {
    return this.frame;
  }

  /** Debug-only: direct view access for the local screenshot harness. */
  get __debugView(): BossRaceView {
    return this.view;
  }

  /** Debug-only: the performance overlays, for the screenshot harness. */
  get __debugOverlays(): {
    background: StageBackgroundLayer;
    watermark: WatermarkLayer;
    cutscene: CutsceneOverlay;
  } {
    return { background: this.stageBackground, watermark: this.watermark, cutscene: this.cutscene };
  }

  /** Debug-only: card effects currently being animated. */
  get __debugCardEffects(): readonly ActiveCardEffect[] {
    return this.activeEffects;
  }

  /** Debug-only: 当前选中的手牌槽位（-1 = 未选）。 */
  get __debugSelectedCardSlot(): number {
    return this.cardActions.selectedSlot;
  }

  /** Debug-only: 最近一条符卡快照事件（P1 只记录不表现）。 */
  get __debugLastCardEvent(): BossRaceEventView | null {
    return this.lastCardEvent;
  }

  /**
   * Presents a card effect on the battle field.
   *
   * Resolves the effect's kind/numbers from the static mirror when the event
   * omits them, then either draws a transient visual (`opponent_pattern`,
   * `invulnerable`, `finisher`) or records the locally predicted bullets to hide
   * (`bullet_purge`). Unknown kinds are ignored so a newer server cannot crash
   * the scene.
   */
  applyCardEffect(event: CardEffectEvent): void {
    const definition = cardEffectDefinition(event.cardId);
    const effectKind = (event.effectKind ?? definition?.effectKind ?? '') as CardEffectKind | '';
    if (effectKind === '') {
      return;
    }
    const durationTicks = event.durationTicks ?? definition?.durationTicks ?? 60;
    const purgeSpec = purgeSpecFor(event.cardId);
    const purgeRadiusPx = event.purgeRadius ?? purgeSpec?.radius ?? 0;
    const purgeCount = event.purgeCount ?? purgeSpec?.count ?? 0;
    const tick = this.currentTick();
    const effect: ActiveCardEffect = {
      cardId: event.cardId,
      effectKind,
      startTick: tick,
      durationTicks: visualDurationTicks(effectKind, durationTicks),
      targetPlayerId: event.targetPlayerId ?? '',
      patternId: event.patternId ?? definition?.cardId ?? event.cardId,
      purgeRadiusPx,
      purgedIds: new Set<string>(),
      damage: event.damage ?? definition?.damage ?? 0,
    };
    if (effectKind === 'bullet_purge') {
      effect.purgedIds = this.resolvePurgeTargets(event.cardId, purgeRadiusPx, purgeCount);
    }
    if (effectKind === 'finisher') {
      this.lastFinisherDamage = effect.damage;
    }
    this.activeEffects.push(effect);
  }

  /** Current simulation tick, preferring the authoritative snapshot. */
  private currentTick(): number {
    return this.authoritative?.tick ?? this.options.battle.simulationRef?.getCurrentTick() ?? 0;
  }

  /**
   * Picks the bullets a purge hides, from the **milli-unit** snapshot bullets so
   * the radius is compared in the server's own unit space. The choice is
   * deterministic (see `selectPurgeTargets`) so a repaint never flickers; the
   * deterministic stream is the **card id** and the seed is the lobby match seed
   * (`match.ServerSeed` as decimal text), matching the server's
   * `deterministicUnit(seed, tick, cardID, i)`.
   *
   * With no seed available (before `match_start`) nothing is hidden rather than
   * falling back to a made-up seed, which would purge an arbitrary set.
   */
  private resolvePurgeTargets(cardId: string, radiusPx: number, count: number): Set<string> {
    const snapshot = this.authoritative ?? this.options.battle.simulationRef?.snapshot() ?? null;
    if (snapshot === null || radiusPx <= 0 || count <= 0) {
      return new Set<string>();
    }
    const seedDecimal = this.options.cardEffectSeed ?? this.options.serverSeedDecimal?.() ?? '';
    if (seedDecimal === '') {
      return new Set<string>();
    }
    const localId = this.options.localPlayerId();
    const local = snapshot.players.find((player) => player.playerId === localId) ?? snapshot.players[0];
    if (local === undefined) {
      return new Set<string>();
    }
    const ids = selectPurgeTargets(
      snapshot.bullets,
      local.xMilli,
      local.yMilli,
      purgeRadiusMilli(radiusPx),
      count,
      seedDecimal,
      snapshot.tick,
      cardId,
    );
    return new Set<string>(ids);
  }

  /** Starts the fixed-tick loop at the battle client's tick rate. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.matchEnded = false;
    this.tickHandle = this.options.timer.setInterval(
      () => this.step(),
      this.options.battle.tickIntervalMs,
    );
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.options.timer.clearInterval(this.tickHandle);
  }

  /**
   * Handles a battle shortcut. `pause` holds the fixed-tick loop and shows the
   * banner so the key has visible feedback; the other two battle actions have
   * no control on this screen — there is no forfeit/back path and the HUD strip
   * is owned by `BossRaceView` — so they fall through to the app-level handlers.
   *
   * Only the scene's own `start()`/`stop()` lifecycle is used: the simulation,
   * input sampling and network code are left untouched.
   */
  handleShortcut(action: ShortcutAction, _event: Laya.KeyboardEventLike): boolean {
    if (action !== 'battle.pause') {
      return false;
    }
    this.setPaused(!this.paused);
    return true;
  }

  /** Holds or resumes the tick loop and mirrors the state on the banner. */
  private setPaused(paused: boolean): void {
    this.paused = paused;
    // 暂停横幅由 TNA 美术承载：标题牌在中央、暂停图标在上方；两者都缺图时
    // 才显示文本 PAUSED（`pausePlaque` 的纹理一到，文本就让位）。
    if (paused) {
      this.pauseIcon.show();
      this.pausePlaque.show();
      void this.pausePlaque.whenSettled().then((ready) => {
        this.pauseOverlay.visible = this.paused && !ready;
      });
      this.pauseOverlay.visible = !this.pausePlaque.isReady;
    } else {
      this.pauseIcon.hide();
      this.pausePlaque.hide();
      this.pauseOverlay.visible = false;
    }
    if (paused) {
      this.stop();
    } else {
      this.start();
    }
  }

  /**
   * Latency lead for the input tick (ticks @64Hz). {@link BattleSceneOptions.inputLeadTicks}
   * wins when set; otherwise the demo harness can pass `?inputLead=N` on the
   * page URL (a local relay to a cross-border battle server runs ~150ms RTT
   * ≈ 9 ticks). Absent or invalid → 0, the plain anchor+1 behaviour.
   */
  private inputLeadTicks(): number {
    const fromOptions = this.options.inputLeadTicks;
    if (fromOptions !== undefined && fromOptions > 0) {
      return Math.floor(fromOptions);
    }
    return pageNumberParam('inputLead', 0);
  }

  /** One simulation tick: read input, send it, advance prediction, render. */
  step(): void {
    // The performance overlays animate off this same fixed-tick clock, so they
    // keep running even while the battle connection is not yet `Running` (the
    // entrance cutscene must play before the first snapshot arrives).
    this.updateOverlays(this.options.battle.tickIntervalMs);
    // Mirror the ticket's hand (it may have just arrived) before reading the
    // cast intent, so a click can never fire a slot the bar no longer shows.
    this.syncHand();
    const battle = this.options.battle;
    // A hand-bar click is one-shot: consume it on this very tick, even when no
    // packet goes out (a click during a pause must not fire much later).
    const clickedSlot = this.handController.take();
    if (battle.state !== BattleConnectionState.Running) {
      this.renderFrame();
      return;
    }
    const raw = this.options.input.snapshot();
    const encoded = encodeInput(raw);
    // 输入 tick 必须落在服务端接收窗口 (server_current, server_current+8]。
    // 合作模式的权威帧走独立监听链，本地 BossRaceSimulation 永远收不到服务端
    // 状态——其时钟从连接时的 0 起算且随渲染帧率漂移，直接沿用会被
    // `tick <= current_tick` 整段丢弃（玩家不动、零伤害）。因此合作模式锚定
    // 最新权威快照的 tick；MVP 路径的本地模拟每帧快照 alignTick，行为不变。
    // inputLeadTicks 补偿链路 RTT（跨境演示 ~150ms ≈ 9 tick，见选项注释）。
    const anchor = this.isCoopMode() && this.coopAuthoritative !== null
      ? this.coopAuthoritative.tick
      : (battle.simulationRef?.getCurrentTick() ?? 0);
    const tick = anchor + 1 + this.inputLeadTicks();
    // §2.3：抽卡/用卡脉冲只在真的能发帧时消费，避免断线期间点一下就被丢掉。
    const cardIntent = this.cardActions.take();
    // A clicked slot wins over the keyboard's slot for exactly this one packet.
    const cardSlot = clickedSlot >= 0 ? clickedSlot : encoded.cardSlot;
    // 合作模式：视图方向（本地恒朝上）→ 战场方向（服务端协议零改动）。
    const directionBits = this.isCoopMode()
      ? coopArenaDirectionBits(
          encoded.directionBits,
          coopLocalSeat(this.coopAuthoritative, this.options.localPlayerId()),
          this.coopSeatCount,
        )
      : encoded.directionBits;
    battle.sendInput(
      tick,
      directionBits,
      encoded.slow,
      encoded.shoot,
      encoded.bomb,
      cardSlot,
      '',
      cardIntent.cardDraw,
      cardIntent.cardSelect,
      cardIntent.cardUse,
    );
    this.options.input.consumeTransient();
    battle.tick();
    this.pruneEffects();
    this.renderFrame();
  }

  /** Advances the background, watermark and cutscene by one tick. */
  private updateOverlays(dtMs: number): void {
    this.stageBackground.update(dtMs);
    this.coopView?.update(dtMs);
    this.watermark.update(dtMs);
    this.cutscene.update(dtMs);
  }

  /** Drops card effects whose visual window has elapsed. */
  private pruneEffects(): void {
    const tick = this.currentTick();
    for (let index = this.activeEffects.length - 1; index >= 0; index -= 1) {
      const effect = this.activeEffects[index];
      if (tick - effect.startTick >= effect.durationTicks) {
        this.activeEffects.splice(index, 1);
      }
    }
    if (this.activeEffects.length === 0) {
      this.lastFinisherDamage = 0;
    }
  }

  /** 合作模式判定（对局信息里的 mode_id）。 */
  private isCoopMode(): boolean {
    return (this.options.battle.info?.modeId ?? '') === COOP_MODE_ID;
  }

  /** 布局：4 人合作房用方形战场，其余（含 2 人合作）沿用 2:3 竖屏。 */
  private computeGeometry(width: number, height: number): BattleLayout {
    return this.isCoopMode() ? coopBattleLayout(width, height, this.coopSeatCount) : battleLayout(width, height);
  }

  /**
   * 懒建合作视图。合作模式在**首个快照到达前**就创建并显示它（背景先渲染），
   * 这样进入对局时不会先出现 MVP 视图的 TNA 美术、再被矢量合作视图替换——
   * 那个「一闪而过」正是两套美术风格在切换。
   */
  private ensureCoopView(): CoopView {
    if (this.coopView === null) {
      const { width, height } = this.stageSize();
      this.coopView = new CoopView({ stageWidth: width, stageHeight: height });
      this.coopView.setStage(this.stageNumber());
      this.root.addChild(this.coopView.root);
    }
    return this.coopView;
  }

  /** 大厅 stage 号（`setStage` 的入参），未设置时按 1 号背景。 */
  private stageNumber(): number {
    const match = /^STAGE (\d+)$/.exec(this.stageTitle);
    return match === null ? 1 : Number(match[1]);
  }

  private renderFrame(): void {
    if (this.isCoopMode()) {
      const coop = this.coopAuthoritative;
      if (coop !== null && coop.seatCount > 0 && coop.seatCount !== this.coopSeatCount) {
        this.coopSeatCount = coop.seatCount;
        const size = this.stageSize();
        this.relayout(size.width, size.height);
      }
      // 合作模式一律走 TNA 美术视图；快照未到时只画 TNA 背景，绝不回落到
      // MVP 视图（那会让千夜贴美术先闪一下再被另一种风格覆盖）。
      const view = this.ensureCoopView();
      view.setVisible(true);
      this.view.root.visible = false;
      view.layout(
        this.geometry.playfieldX,
        this.geometry.playfieldY,
        this.geometry.playfield.width,
        this.geometry.playfield.height,
      );
      if (coop === null) {
        view.render(null);
        return;
      }
      // §2.8：合作快照也带 hand/deck/cooldown（老服务端没有 → 不接管）。
      this.syncSnapshotHand(coop.hand, coop.deckRemaining, coop.drawCooldownTicks);
      const coopFrame = buildCoopFrame(coop, {
        layout: this.geometry.playfield,
        localPlayerId: this.options.localPlayerId(),
        bossMaxHp: this.options.bossMaxHp,
        previous: this.previousCoopAuthoritative,
        frac: this.renderFrac(this.coopAuthoritativeAtMs, this.coopAuthoritativeIntervalMs),
      });
      this.coopFrame = coopFrame;
      view.render(coopFrame);
      return;
    }
    const battle = this.options.battle;
    const source = this.authoritative ?? battle.simulationRef?.snapshot() ?? null;
    if (source === null) {
      return;
    }
    // §2.8：权威快照的手牌/牌库/抽卡冷却驱动手牌栏（预测帧没有这些字段）。
    this.syncSnapshotHand(source.hand, source.deckRemaining, source.drawCooldownTicks);
    this.noteCardEvents(source);
    // 非合作对局：MVP 视图是唯一渲染者（合作视图若曾创建则收起）。
    this.view.root.visible = true;
    this.coopView?.setVisible(false);
    // The playfield is a 2:3 portrait rectangle on the left; the status panel is
    // the vertical strip on the right. `buildBossRaceFrame` scales the milli-
    // unit arena uniformly from the playfield width, so only the playfield
    // geometry is passed here — the panel is sized in `drawHudBar` instead.
    let frame = buildBossRaceFrame(source, {
      layout: this.geometry.playfield,
      localPlayerId: this.options.localPlayerId(),
      bossMaxHp: this.options.bossMaxHp,
      // 只有权威快照才插值：本地预测帧没有「下一份快照」，直显即可。
      previous: this.authoritative === null ? null : this.previousAuthoritative,
      frac: this.authoritative === null
        ? 0
        : this.renderFrac(this.authoritativeAtMs, this.authoritativeIntervalMs),
    });
    // A `bullet_purge` removes its chosen bullets from the *local prediction*:
    // the simulation is untouched (the server stays authoritative), only the
    // rendered frame drops them for the effect's window.
    const hidden = this.hiddenBulletIds();
    if (hidden.size > 0) {
      frame = { ...frame, bullets: frame.bullets.filter((bullet) => !hidden.has(bullet.bulletId)) };
    }
    this.frame = frame;
    this.view.render(frame, this.hudLines(source, frame), this.hudState(source));
    this.drawCardEffects(frame, source);
    this.drawGiftLayer(frame);
    this.drawBossEffects(frame);
  }

  /**
   * §2.9 插值分数：距上一份权威快照过了多少个「快照间隔」，夹到 `[0, 0.999]`。
   *
   * 用到达间隔（而不是 tick 率）当分母，是因为插值的意义就在于「两份权威
   * 快照之间补帧」：服务端每 tick 都发快照时它自然接近 0（直显），发得稀时
   * 才真的补出中间帧。没有第二份快照 → 0。
   */
  private renderFrac(snapshotAtMs: number, intervalMs: number): number {
    if (intervalMs <= 0 || snapshotAtMs <= 0) {
      return 0;
    }
    const elapsed = Date.now() - snapshotAtMs;
    if (elapsed <= 0) {
      return 0;
    }
    return Math.min(0.999, elapsed / intervalMs);
  }

  /**
   * 特殊机制（铁拳 / 黑色帷幕）的玩法指示层 —— 按**阶段**区分表现。
   *
   * 数据全部来自快照 `boss.effects[]`（服务端权威），这里只画几何骨架：
   *  - 铁拳 `windup`：闪烁细线 + 端点准星（「即将落下」的预告）；
   *    `strike`：粗实线 + 亮芯（判定正在推进）；其余（`recover`）淡出细线。
   *  - 黑色帷幕 `hold`：playfield 压暗遮罩（只罩战场，不碰右侧 HUD，也不碰
   *    底部手牌栏——它们在本层之上）；`fall`/`sweep`：边缘线，`sweep` 更亮更粗。
   *
   * 按 `ART_POLICY`「只允许玩法指示自绘」，不引入第二套美术风格。画在礼图层
   * 之后，因为两者共用 `effectLayer` 而礼图层每帧 `clear()`。
   */
  private drawBossEffects(frame: BossRaceFrame): void {
    if (frame.bossEffects.length === 0) {
      return;
    }
    const g = this.effectLayer.graphics;
    const width = this.geometry.playfield.width;
    const height = this.geometry.playfield.height;
    for (const effect of frame.bossEffects) {
      if (effect.type === 'iron_fist') {
        this.drawIronFist(g, frame.tick, effect);
        continue;
      }
      if (effect.type === 'black_curtain') {
        this.drawBlackCurtain(g, width, height, effect);
      }
    }
  }

  /** 铁拳三阶段：windup 闪烁预告 / strike 实线判定 / recover 淡出。 */
  private drawIronFist(g: Laya.Graphics, tick: number, effect: BossEffectRenderItem): void {
    if (effect.from === null || effect.to === null) {
      return;
    }
    const { from, to } = effect;
    if (effect.state === 'windup') {
      // 4 tick 亮 / 4 tick 暗：既醒目又不至于闪到看不清弹幕。
      const on = tick % 8 < 4;
      const color = on ? theme.COLOR_WARNING : fade(theme.COLOR_WARNING, 0.55);
      g.drawLine(from.x, from.y, to.x, to.y, color, 2);
      g.drawCircle(to.x, to.y, on ? 7 : 5, null, color, 2);
      g.drawCircle(from.x, from.y, 3, color);
      return;
    }
    if (effect.state === 'strike') {
      // 判定正在推进：粗线 + 一条更亮的芯，读起来是「已经落下」。
      g.drawLine(from.x, from.y, to.x, to.y, theme.COLOR_DANGER, 6);
      g.drawLine(from.x, from.y, to.x, to.y, theme.COLOR_TEXT, 2);
      return;
    }
    // recover / 未知阶段：淡出，不抢戏。
    g.drawLine(from.x, from.y, to.x, to.y, fade(theme.COLOR_DANGER, 0.35), 1);
  }

  /** 黑色帷幕：hold 压暗战场，fall/sweep 画边缘线（sweep 最亮）。 */
  private drawBlackCurtain(
    g: Laya.Graphics,
    width: number,
    height: number,
    effect: BossEffectRenderItem,
  ): void {
    if (effect.state === 'hold') {
      // 只罩战场矩形：HUD 在右侧状态条、手牌栏在本层之上，都不受影响。
      g.drawRect(0, 0, width, height, 'rgba(7,5,14,0.55)');
      if (effect.edgeY !== null) {
        g.drawLine(0, effect.edgeY, width, effect.edgeY, fade(theme.COLOR_BOSS, 0.5), 2);
      }
      return;
    }
    if (effect.edgeY === null) {
      return;
    }
    if (effect.state === 'sweep') {
      g.drawLine(0, effect.edgeY, width, effect.edgeY, theme.COLOR_BOSS, 5);
      g.drawLine(0, effect.edgeY, width, effect.edgeY, theme.COLOR_TEXT, 1);
      return;
    }
    // fall（或未知）：细一号的预告线。
    g.drawLine(0, effect.edgeY, width, effect.edgeY, fade(theme.COLOR_BOSS, 0.6), 2);
  }

  /**
   * The in-match gift bar and the last gift announcement.
   *
   * Each slot draws its catalog bitmap (see {@link ../core/game/gift_assets})
   * when the icon has loaded, and otherwise the vector glyph from
   * {@link giftGlyphPath} — so the bar stays drawable even when the icon files
   * never resolve. Grey-out follows the gift-charge pool
   * ({@link GIFT_CHARGE_BUDGET} per match, independent of card energy); the
   * server stays authoritative and its refusals surface as a toast. A click is
   * routed through {@link BattleSceneOptions.sendGift}; the scene never builds
   * the payload, exactly like the draft picks.
   */
  private drawGiftLayer(frame: BossRaceFrame): void {
    const g = this.effectLayer?.graphics;
    if (g === undefined) {
      return;
    }
    g.clear();
    const chargesLeft = this.options.giftCharges?.() ?? GIFT_CHARGE_BUDGET;
    this.giftBar = giftBarView(chargesLeft, this.giftSelected);
    const box = GIFT_BOX;
    const gap = GIFT_GAP;
    const total = this.giftBar.slots.length * box + (this.giftBar.slots.length - 1) * gap;
    const startX = Math.max(8, (this.geometry.playfield.width - total) / 2);
    const y = this.geometry.playfield.height - box - GIFT_BOTTOM_MARGIN;
    this.giftHitBoxes = [];
    for (const [index, slot] of this.giftBar.slots.entries()) {
      const x = startX + index * (box + gap);
      this.giftHitBoxes.push({ x, y, w: box, h: box, index });
      const accent = slot.affordable ? slot.definition.accent : 0x6b7280;
      const accentCss = `#${accent.toString(16).padStart(6, '0')}`;
      g.drawRect(x, y, box, box, slot.selected ? '#1f2937' : '#111827', accentCss, slot.selected ? 2 : 1);
      const icon = slot.definition.icon;
      const texture = icon === undefined ? null : this.giftIcons.texture(icon);
      if (texture !== null) {
        // Real art: inset so the icon never touches the slot border.
        const inset = 3;
        g.drawTexture(texture, x + inset, y + inset, box - inset * 2, box - inset * 2);
        continue;
      }
      const path = giftGlyphPath(slot.definition.glyph);
      if (path.length >= 3) {
        // Flattened x,y pairs — Laya's drawPoly takes a number list.
        const points: number[] = [];
        for (const [px, py] of path) {
          points.push(x + box / 2 + px * box * 0.34, y + box / 2 + py * box * 0.34);
        }
        g.drawPoly(0, 0, points, accentCss, accentCss, 1);
      }
    }
    // Charge readout: the pool the bar greys against, so a greyed slot always
    // has a visible reason. Warning colour once the pool is spent.
    this.giftChargesText.text = t('gift.bar.charges', { left: chargesLeft, total: GIFT_CHARGE_BUDGET });
    this.giftChargesText.color = chargesLeft > 0 ? theme.COLOR_INFO : theme.COLOR_WARNING;
    this.giftChargesText.visible = true;
    if (this.giftToast !== null && frame.tick <= this.giftToast.untilTick) {
      this.giftText.text = this.giftToast.text;
      this.giftText.visible = true;
    } else {
      this.giftText.text = '';
      this.giftText.visible = false;
      this.giftToast = null;
    }
  }

  /**
   * Routes a pointer position onto the gift bar. Returns true when a slot was
   * hit (so the caller knows the tap was consumed). An unaffordable slot is
   * selected but not sent — the player sees what it costs first.
   */
  handleGiftTap(px: number, py: number): boolean {
    for (const hit of this.giftHitBoxes) {
      if (px < hit.x || px > hit.x + hit.w || py < hit.y || py > hit.y + hit.h) {
        continue;
      }
      this.giftSelected = hit.index;
      const slot = this.giftBar.slots[hit.index];
      if (slot === undefined || !slot.affordable) {
        return true;
      }
      const gift = affordableGiftAt(this.giftBar, this.options.giftCharges?.() ?? GIFT_CHARGE_BUDGET);
      if (gift === null) {
        return true;
      }
      const definition = giftDefinition(gift.giftId);
      const label = definition === null ? gift.giftId : t(definition.nameKey);
      this.giftToast = {
        text: t('gift.toast.sent', { gift: label }),
        untilTick: (this.frame?.tick ?? 0) + 180,
      };
      this.options.sendGift?.(this.options.battle.info?.matchId ?? '', gift.giftId, this.options.battle.info?.modeId ?? '');
      return true;
    }
    return false;
  }

  /** Shows a received `gift_sent` event as the announcement line. */
  applyGiftEvent(event: MatchEventView): void {
    const gift = giftViewFromEvent(event);
    if (gift === null) {
      return;
    }
    const mine = this.options.localUserId?.() ?? '';
    const from = gift.fromUserId === mine ? '你' : '对手';
    const to = gift.toUserId === mine ? '你' : '对手';
    this.giftToast = { text: giftAnnouncement(gift.giftId, from, to), untilTick: (this.frame?.tick ?? 0) + 240 };
  }

  /** Bullet ids hidden by an active purge. */
  private hiddenBulletIds(): Set<string> {
    let hidden: Set<string> | null = null;
    for (const effect of this.activeEffects) {
      if (effect.effectKind !== 'bullet_purge' || effect.purgedIds.size === 0) {
        continue;
      }
      hidden = hidden ?? new Set<string>();
      for (const id of effect.purgedIds) {
        hidden.add(id);
      }
    }
    return hidden ?? EMPTY_ID_SET;
  }

  /**
   * Repaints the card-effect overlay for the current frame.
   *
   * Everything is drawn in playfield-local pixels: the transform maps the
   * snapshot's milli-unit actors onto the same space `BossRaceView` uses, so the
   * aura and the warning line land exactly on the rendered ships.
   */
  private drawCardEffects(frame: BossRaceFrame, snapshot: BossRaceSnapshot): void {
    const graphics = this.effectLayer.graphics;
    graphics.clear();
    this.effectText.text = '';
    this.effectText.visible = false;
    if (this.activeEffects.length === 0) {
      return;
    }
    const transform = new PlayfieldTransform(this.geometry.playfield);
    const localPlayer = frame.players.find((player) => player.isLocal);
    const opponentPlayer = frame.players.find((player) => !player.isLocal);
    const tick = frame.tick;
    const notes: string[] = [];

    for (const effect of this.activeEffects) {
      const progress = effectProgress(effect, tick);
      switch (effect.effectKind) {
        case 'opponent_pattern': {
          const target = this.effectTargetPlayer(effect, frame, opponentPlayer);
          if (target === undefined) {
            break;
          }
          const origin = bossOriginPixels(transform);
          // Aim from the Boss to the target, mirroring the server's `atan2`
          // toward the opponent's position (in the snapshot's milli units).
          const aimMilli = snapshot.players.find((player) => player.playerId === target.playerId);
          const warning = opponentPatternWarning(
            BOSS_ORIGIN_X_MILLI,
            BOSS_ORIGIN_Y_MILLI,
            aimMilli?.xMilli ?? 0,
            aimMilli?.yMilli ?? 0,
            effect.patternId,
          );
          drawOpponentWarning(graphics, origin, target.position, warning.angleRad, progress);
          break;
        }
        case 'bullet_purge': {
          if (localPlayer === undefined) {
            break;
          }
          drawPurgeRing(graphics, localPlayer.position, effect.purgeRadiusPx, progress);
          break;
        }
        case 'invulnerable': {
          if (localPlayer === undefined) {
            break;
          }
          drawInvulnerableAura(graphics, localPlayer.position, tick, progress);
          const remaining = invulnerableRemainingTicks(effect.startTick + effect.durationTicks, tick);
          notes.push(`INVULNERABLE ${(remaining / BOSS_RACE_TICK_RATE_HZ).toFixed(1)}s`);
          break;
        }
        case 'finisher': {
          drawFinisherFlash(graphics, this.geometry.playfield.width, this.geometry.playfield.height, progress);
          if (localPlayer !== undefined && this.lastFinisherDamage > 0) {
            drawDamageNumber(graphics, localPlayer.position, this.lastFinisherDamage, progress);
          }
          break;
        }
        default:
          break;
      }
    }

    if (notes.length > 0) {
      this.effectText.text = notes.join('  ·  ');
      this.effectText.visible = true;
    }
  }

  /** The player an `opponent_pattern` should aim at, preferring its target id. */
  private effectTargetPlayer(
    effect: ActiveCardEffect,
    frame: BossRaceFrame,
    fallback: PlayerRenderItem | undefined,
  ): PlayerRenderItem | undefined {
    if (effect.targetPlayerId !== '') {
      const named = frame.players.find((player) => player.playerId === effect.targetPlayerId);
      if (named !== undefined) {
        return named;
      }
    }
    return fallback;
  }

  /**
   * Assembles the structured HUD state consumed by the vector HUD strip. The
   * string rows from `hudLines` remain the fallback; this richer shape lets the
   * view draw bars and badges instead of monospaced text.
   */
  private hudState(snapshot: BossRaceSnapshot): HudState {
    const metrics = this.options.battle.metrics;
    const local = snapshot.players.find((player) => player.playerId === this.options.localPlayerId());
    const opponent = snapshot.players.find((player) => player.playerId !== this.options.localPlayerId());
    const maxHp = this.options.bossMaxHp > 0 ? this.options.bossMaxHp : 1;
    const damageDealt = local?.damageDealt ?? 0;
    return {
      localHpRatio: Math.max(0, Math.min(1, (local?.bossCurrentHp ?? 0) / maxHp)),
      rivalHpRatio: Math.max(0, Math.min(1, (opponent?.bossCurrentHp ?? 0) / maxHp)),
      bossMaxHp: this.options.bossMaxHp,
      localHp: local?.bossCurrentHp ?? 0,
      rivalHp: opponent?.bossCurrentHp ?? 0,
      damageDealt,
      score: damageDealt,
      ultCooldownRatio: this.ultCooldownRatio(snapshot.tick),
      ultReady: this.ultCooldownRatio(snapshot.tick) <= 0,
      tick: snapshot.tick,
      stateName: BossRaceState[snapshot.state] ?? String(snapshot.state),
      patternId: patternFor(snapshot.tick),
      bullets: snapshot.bullets.length,
      connectionLabel: this.authoritative === null ? 'predicted' : 'server',
      metricsLine: `snaps ${metrics.snapshotsReceived} · err ${metrics.averagePositionErrorMilli.toFixed(0)} · ${hashCell(metrics)} · snap ${metrics.hardSnaps}`,
      tickLimit: this.options.matchTickLimit,
      tickRateHz: this.options.tickRateHz,
    };
  }

  /**
   * PLACEHOLDER ultimate-cooldown fraction (0 = ready, 1 = just fired).
   *
   * There is no ultimate ability in the simulation or the wire protocol yet, so
   * this is derived from the tick alone to give the status bar a live-moving
   * demo value: a fixed-length charge cycle that free-runs off the tick clock.
   * Replace this with the real server-provided cooldown once the ability lands;
   * the HUD already degrades gracefully when the value is absent.
   */
  private ultCooldownRatio(tick: number): number {
    const period = this.options.tickRateHz ?? BOSS_RACE_TICK_RATE_HZ;
    const cycle = Math.max(1, period * 8);
    const phase = ((tick % cycle) + cycle) % cycle;
    return phase / cycle;
  }

  /**
   * Builds the HUD text block returned to `BossRaceView.render(frame, hudLines)`.
   *
   * The contract stays a `string[]` (the view renders it verbatim), but the rows
   * are now laid out as aligned `LABEL  value` columns so the eye can scan down a
   * column instead of parsing one long line. Row order is by importance:
   *   1. Boss HP / damage / rival HP  — the race outcome, kept first and loudest
   *   2. connection + tick + state + pattern
   *   3. input + bullet count
   *   4. 判定（残机 / 炸弹 / 擦弹 / 无敌）—— 仅 `tna-1.40-danmaku` 下发时出现
   *   5. reconciliation metrics (network health)
   */
  private hudLines(snapshot: BossRaceSnapshot, frame: BossRaceFrame): string[] {
    const battle = this.options.battle;
    const raw = this.options.input.snapshot();
    const metrics = battle.metrics;
    const stateName = BossRaceState[snapshot.state] ?? String(snapshot.state);
    const local = snapshot.players.find((player) => player.playerId === this.options.localPlayerId());
    const opponent = snapshot.players.find((player) => player.playerId !== this.options.localPlayerId());
    const source = this.authoritative === null ? 'predicted' : 'server';
    const inputs = [describeDirectionBits(rawToBits(raw)), raw.shoot ? 'shoot' : '', raw.slow ? 'focus' : '']
      .filter((value) => value !== '')
      .join(' ');
    const rows = [
      row('BOSS', `HP ${local?.bossCurrentHp ?? '-'}/${this.options.bossMaxHp}`, `dmg ${local?.damageDealt ?? 0}`, `rival ${opponent?.bossCurrentHp ?? '-'}`),
      row('NET', source, `tick ${snapshot.tick}`, stateName, `pattern ${patternFor(snapshot.tick)}`),
      row('FP', `bullets ${snapshot.bullets.length}`, inputs),
    ];
    // 判定行：与战场左上角的图标读数同源（`buildJudgmentHud`），ruleset 不下发
    // 判定字段时整行不出现——不打印 wire 占位值冒充真实残机。
    const judgment = buildJudgmentHud(frame);
    if (judgment !== null) {
      const rate = this.options.tickRateHz ?? BOSS_RACE_TICK_RATE_HZ;
      const cells = [`lives ${judgment.lives}`, `bombs ${judgment.bombs}`, `graze ${judgment.graze}`];
      if (judgment.invulnerable) {
        cells.push(`inv ${(judgment.invulnerableTicksRemaining / rate).toFixed(1)}s`);
      }
      rows.push(row('JUDGE', ...cells));
    }
    rows.push(
      row('SYNC', `snaps ${metrics.snapshotsReceived}`, `err ${metrics.averagePositionErrorMilli.toFixed(0)}`, hashCell(metrics), `snap ${metrics.hardSnaps}`),
    );
    return rows;
  }
}

/**
 * The SYNC row's state-hash cell.
 *
 * `hashComparable` counts the snapshots where the local bullet model is expected
 * to reproduce the server's (see `BossRaceSimulation.hashComparable`). Since the
 * real-danmaku library is now the server's own, that is every snapshot on the
 * live ruleset, so the cell normally reports a real ratio. It only says why
 * instead when the simulation was built with a provisional timeline
 * (`config.realDanmakuIsProduction === false`) or is still on the legacy
 * `mvp-boss-race-s0` scheduler — in which case a `0/n` would read as a desync
 * even though the *players* agree exactly.
 */
function hashCell(metrics: BattleCorrectionMetrics): string {
  if (metrics.hashComparable === 0) {
    // Kept short on purpose: the SYNC strip is narrow and a longer label wraps
    // into a line that still overflows the panel.
    return 'hash n/a (provisional)';
  }
  return `hash ${metrics.hashMatches}/${metrics.hashComparable}`;
}

/** Joins HUD cells with a fixed gutter so columns line up across rows. */
function row(label: string, ...cells: string[]): string {
  return `${label.padEnd(5)} │ ${cells.join('  ·  ')}`;
}

function patternFor(tick: number): string {
  const index = Math.floor(tick / BOSS_RACE_PATTERN_PERIOD_TICKS) % BOSS_RACE_PATTERN_IDS.length;
  return BOSS_RACE_PATTERN_IDS[index];
}

function rawToBits(raw: { left: boolean; right: boolean; up: boolean; down: boolean }): number {
  let bits = 0;
  if (raw.up) {
    bits |= 0x1;
  }
  if (raw.right) {
    bits |= 0x2;
  }
  if (raw.down) {
    bits |= 0x4;
  }
  if (raw.left) {
    bits |= 0x8;
  }
  return bits;
}

// ---------------------------------------------------------------------------
// Card-effect visuals
//
// Pure `Laya.Graphics` painters. They take playfield-local pixel coordinates —
// the same space `BossRaceView` draws actors in — so a caller never has to
// re-derive a transform. Colours come from `view/theme` and fade toward the
// void background as the effect's window elapses.
// ---------------------------------------------------------------------------

/** Shared empty set so the common (no purge) path never allocates. Never mutated. */
const EMPTY_ID_SET: Set<string> = new Set<string>();

/**
 * Visual lifetime of an effect, in ticks.
 *
 * One-shot effects (purge / finisher) and the aimed curtain use a short window
 * so they read as an impact rather than a lingering overlay; `invulnerable`
 * keeps its full server duration so the aura matches the real immunity.
 */
function visualDurationTicks(kind: CardEffectKind, definitionTicks: number): number {
  switch (kind) {
    case 'bullet_purge':
      return Math.max(1, Math.min(definitionTicks, 30));
    case 'finisher':
      return Math.max(1, Math.min(definitionTicks, 45));
    case 'opponent_pattern':
      return Math.max(1, Math.min(definitionTicks, 120));
    default:
      return Math.max(1, definitionTicks);
  }
}

/** Fraction of an effect's window that has elapsed, clamped to `[0, 1]`. */
function effectProgress(effect: ActiveCardEffect, tick: number): number {
  if (effect.durationTicks <= 0) {
    return 1;
  }
  const elapsed = tick - effect.startTick;
  return Math.max(0, Math.min(1, elapsed / effect.durationTicks));
}

/** Aimed-curtain warning: a cone + reticle from the Boss toward the target. */
function drawOpponentWarning(
  g: Laya.Graphics,
  origin: RenderPoint,
  target: RenderPoint,
  angleRad: number,
  progress: number,
): void {
  const reach = 90;
  const spread = 0.3;
  const left = {
    x: origin.x + Math.cos(angleRad - spread) * reach,
    y: origin.y + Math.sin(angleRad - spread) * reach,
  };
  const right = {
    x: origin.x + Math.cos(angleRad + spread) * reach,
    y: origin.y + Math.sin(angleRad + spread) * reach,
  };
  g.drawPoly(0, 0, [origin.x, origin.y, left.x, left.y, right.x, right.y], fade(theme.COLOR_WARNING, progress * 0.55));
  g.drawLine(origin.x, origin.y, target.x, target.y, fade(theme.COLOR_DANGER, progress * 0.5), 2);
  g.drawCircle(
    target.x,
    target.y,
    12 + progress * 12,
    null,
    fade(theme.COLOR_DANGER, progress * 0.4),
    2,
  );
}

/** Expanding clear ring at the caster. */
function drawPurgeRing(g: Laya.Graphics, center: RenderPoint, radiusPx: number, progress: number): void {
  const radius = Math.max(8, radiusPx) * (0.4 + progress * 0.6);
  g.drawCircle(center.x, center.y, radius, null, fade(theme.COLOR_INFO, progress * 0.4), 3);
  g.drawCircle(center.x, center.y, Math.max(4, radius * 0.35), fade(theme.COLOR_LOCAL_BULLET_CORE, progress * 0.5));
}

/** Pulsing invulnerability aura around the local ship. */
function drawInvulnerableAura(g: Laya.Graphics, center: RenderPoint, tick: number, progress: number): void {
  const pulse = 16 + Math.sin(tick * 0.35) * 3;
  g.drawCircle(center.x, center.y, pulse, theme.COLOR_PLAYFIELD, fade(theme.COLOR_ACCENT, progress * 0.5), 3);
  g.drawCircle(center.x, center.y, pulse + 5, null, fade(theme.COLOR_ACCENT, progress * 0.6), 1);
}

/** Full-playfield finisher flash: a fading border band plus a centre burst. */
function drawFinisherFlash(g: Laya.Graphics, width: number, height: number, progress: number): void {
  const color = fade(theme.COLOR_ACCENT, progress * 0.7);
  const band = Math.max(2, 24 * (1 - progress));
  g.drawRect(0, 0, width, band, color);
  g.drawRect(0, height - band, width, band, color);
  g.drawRect(0, 0, band, height, color);
  g.drawRect(width - band, 0, band, height, color);
  g.drawCircle(width / 2, height / 2, Math.max(4, 120 * (1 - progress)), fade(theme.COLOR_WARNING, progress * 0.55));
}

/** Rising damage number for a finisher. */
function drawDamageNumber(g: Laya.Graphics, center: RenderPoint, damage: number, progress: number): void {
  const text = `-${Math.round(damage)}`;
  const y = center.y - 24 - progress * 40;
  g.fillText(text, center.x, y, theme.font(theme.FONT_SIZE_HEADING, true), fade(theme.COLOR_DANGER, progress * 0.7), 'center');
}
