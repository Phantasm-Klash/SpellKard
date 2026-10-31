/**
 * Application wiring for the LayaAir build.
 *
 * Owns the LayaAir stage, the lobby/battle clients, the four screens and the
 * screen-switch policy driven by `LobbyFlow`. Platform adapters (socket, timer,
 * datagram, HTTP) are chosen here so the core stays platform-free.
 *
 * It also owns the battle "performance" wiring: the match-event poller (built
 * on the REST transport, because `match.events` is forbidden on the Nakama RPC
 * path) and the match snapshot that drives the stage background, the watermarks
 * and the stage BGM. The `BattleScene` exposes the seams; this file feeds them.
 */

import { bossRaceSeedFromHex } from '../../core/math/boss_race_seed';
import { shortHashHex } from '../../core/math/lobby_rng';
import { BattleClient } from '../../core/net/battle_client';
import {
  HttpLobbyTransport,
  LobbyClient,
  NakamaLobbyTransport,
  WsLobbyTransport,
  type BattleOpeningState,
  type LobbySessionStore,
} from '../../core/net/lobby_client';
import { BattleEventPoller, type MatchEventsPage } from '../../core/net/battle_event_poller';
import type { MatchEventView } from '../../core/game/battle_events';
import { giftChargesLeft, giftChargesSpentFrom } from '../../core/game/gift_bar_view';
import { bossPortrait, characterPortrait, stageIndex } from '../../core/game/stage_art';
import type { DatagramFactory, Logger, SocketFactory, TimerLike } from '../../core/net/transport';
import { DEFAULT_MODE_ID, LobbyFlow, LobbyScreen, type LobbyFlowSnapshot } from '../../core/game/lobby_flow';
import { BOSS_RACE_DEFAULT_BOSS_HP, BOSS_RACE_DEFAULT_MAX_TICKS, BOSS_RACE_TICK_RATE_HZ } from '../../core/sim/boss_race';
import { SettingsStore } from '../../core/settings';
import type { ShortcutAction } from '../../core/input/shortcuts';
import { applyAudioSettings } from './audio';
import { isLanguageCode, setLanguage } from '../../core/game/i18n';
import { applyDisplaySettings, createFpsOverlay, type FpsOverlayHandle } from './display';
import type { WindowScale } from '../../core/settings/schema';
import {
  nativeScreenGeometry,
  requestNativeWindowSize,
  windowSizeForScale,
} from '../native/native_window';
import { toggleFullscreen, fullscreenDebugState } from './fullscreen';
import { LayaInput } from './laya_input';
import { initSteamSession } from '../native/steam/steam_session';
import { LayaTimer } from './laya_timer';
import { installNativeCaretFix, nativeCaretFixInstalled } from './native_caret';
import { ShortcutDispatcher, type ShortcutHost } from './shortcuts';
import { UpscalerController } from './upscaler';
import { textInputDebugState } from './text_input';
import { BattleScene } from './scenes/battle_scene';
import { CheckinScene } from './scenes/checkin_scene';
import { InventoryScene } from './scenes/inventory_scene';
import { DeckScene } from './scenes/deck_scene';
import { LobbyScene } from './scenes/lobby_scene';
import { LoginScene } from './scenes/login_scene';
import { RecordsScene } from './scenes/records_scene';
import { ResultScene } from './scenes/result_scene';
import { DemPlayerScene } from './scenes/dem_player';
import { RoomScene } from './scenes/room_scene';
import { GachaScene } from './scenes/gacha_scene';
import { ShopScene } from './scenes/shop_scene';
import { isShortcutCapable, type ClientScene } from './scenes/scene';
import { LayaHttpClient } from './laya_http_client';

export interface ClientConfig {
  stageWidth: number;
  stageHeight: number;
  lobbyHttpBase: string;
  /** Optional Nakama base URL; defaults to `lobbyHttpBase` when selected. */
  lobbyNakamaHttpBase?: string;
  /** Nakama runtime HTTP key used for anonymous RPC bootstrap. */
  nakamaHttpKey?: string;
  /**
   * Nakama server key (`socket.server_key`). Required by
   * `/v2/account/authenticate/*`; falls back to `nakamaHttpKey` when empty.
   */
  nakamaServerKey?: string;
  /** Host-owned secure session storage; omitted sessions remain in memory only. */
  sessionStore?: LobbySessionStore;
  /** Selects the business transport when no lobby WS URL is configured. */
  lobbyTransport?: 'legacy_http' | 'nakama_rpc';
  /** When empty, the lobby uses the REST transport instead of WebSocket. */
  lobbyWsUrl: string;
  relayUrl: string;
  /** Socket factory used for the lobby WS channel and the battle relay. */
  socketFactory: SocketFactory;
  /** Datagram factory for the battle channel. */
  datagramFactory: DatagramFactory;
  /** Stable anonymous identity used when the lobby WS has no session token yet. */
  deviceId?: string;
  /** Build id reported to the lobby on auth. */
  clientBuild?: string;
  timer?: TimerLike;
  logger?: Logger;
  /**
   * Shared settings store. Optional so the LayaAir IDE boot path (which owns
   * its own wiring) keeps working; when omitted an in-memory store is used and
   * nothing is persisted.
   */
  settings?: SettingsStore;
  /**
   * Forces the UI language at boot (`?lang=…` on the web build). Empty or
   * absent keeps the persisted setting, which defaults to Simplified Chinese.
   */
  language?: string;
}

/**
 * 两个设置分组是否等价（只看一层字段）。
 *
 * 不能用引用比较：`SettingsStore.update` 把整个 payload 过一遍 normaliser，
 * 所以哪怕一个值都没变，各分组拿到的也是**新对象**，引用比较永远判为"变了"。
 */
function sameSettingsGroup(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) {
    return false;
  }
  return keys.every((key) => left[key] === right[key]);
}

/**
 * Sizes the host window from the stored window scale.
 *
 * A no-op when the running build has no window-resize door — web builds, and
 * the current prebuilt `spk_win.dll` — because `requestNativeWindowSize`
 * reports that instead of throwing. It deliberately does not fall back to
 * `PAL.browser.setResolution`, which on Windows reaches `conch.setResolution`
 * and changes the monitor's mode.
 */
function applyWindowScale(scale: WindowScale): void {
  // "Auto" used to fill the work area outright, which gave the window the
  // **monitor's** shape (16:10 on this screen) instead of 4:3 — the shape the
  // player picked. Now it grows 4:3 until it meets the work area instead, so
  // the window has the shape it is supposed to have and is as large as it can
  // be at that shape.
  //
  // The window shape and the battle stage's shape are two different things and
  // are meant to differ: the stage is portrait (900x1200) because the playfield
  // and the HUD are stacked, and that layout is still moving. The shell around
  // it stays 4:3 landscape.
  requestNativeWindowSize(windowSizeForScale(scale, nativeScreenGeometry()));
}

export class SpellKardApp {
  private readonly timer: TimerLike;
  private readonly settings: SettingsStore;
  private readonly fpsOverlay: FpsOverlayHandle;
  private readonly flow: LobbyFlow;
  private readonly lobbyClient: LobbyClient;
  private readonly battleClient: BattleClient;
  private readonly input: LayaInput;
  /**
   * Polls the lobby's REST match-event stream and feeds the battle scene. Owned
   * here (not by the scene) because it needs the REST transport; the scene's
   * `onEnter`/`onExit` start and stop it through the performance callbacks.
   */
  private readonly battlePoller: BattleEventPoller;
  /** Match whose events are being polled / whose roster ids resolve. */
  private performanceMatchId = '';
  /**
   * The signed ticket's opening loadout for the current match (dealt hand +
   * opening energy), or `null` before the ticket resolves. Read lazily by the
   * battle scene's hand bar; the ticket is the only source of the dealt hand.
   */
  private battleOpening: BattleOpeningState | null = null;
  /**
   * Gift charges the local player has spent in the current match, derived from
   * the `gift_sent` rows of the event stream (see
   * {@link giftChargesSpentFrom}). Reset whenever the poller (re)starts, because
   * a gap resync replays the stream from the oldest retained event and every
   * row would otherwise be counted twice.
   */
  private giftChargesSpent = 0;
  private readonly loginScene: LoginScene;
  private readonly lobbyScene: LobbyScene;
  private readonly roomScene: RoomScene;
  private readonly battleScene: BattleScene;
  private readonly resultScene: ResultScene;
  private readonly checkinScene: CheckinScene;
  private readonly shopScene: ShopScene;
  private readonly gachaScene: GachaScene;
  private readonly inventoryScene: InventoryScene;
  private readonly deckScene: DeckScene;
  private readonly recordsScene: RecordsScene;
  private readonly demPlayerScene: DemPlayerScene;
  /**
   * The single keyboard dispatcher. Screens never subscribe to raw key events;
   * they implement `ShortcutCapable` and `app.ts` routes actions to whichever
   * one is on top, then falls back to the app-level bindings below.
   */
  private readonly shortcuts = new ShortcutDispatcher();
  /** Owns the software upscaler's sharpen pass and the external-module (DLC) loader. */
  private readonly upscalers = new UpscalerController();
  private activeScene: ClientScene | null = null;
  private activeScreen = '';

  constructor(config: ClientConfig) {
    this.timer = config.timer ?? new LayaTimer();
    this.settings = config.settings ?? new SettingsStore();

    // Push the stored settings into the engine once at boot, then keep them in
    // sync. Doing it here (rather than inside the settings panel) means a value
    // restored from storage is honoured before the first frame, and the panel
    // stays a pure UI component with no engine knowledge.
    applyDisplaySettings(this.settings.get().display);
    // The window is resized *after* the engine is up, not here: at construction
    // time the native host window is still being set up, and resizing it there
    // took the process down with it. `Laya.init` has already run by the time
    // this constructor is called, but the first frames are when the window
    // settles, so the size is applied on the next tick.
    // The window is resized shortly after the engine is up, not here: at
    // construction time the native host window is still settling, and resizing
    // it there is too early.
    this.timer.setTimeout(() => {
      applyWindowScale(this.settings.get().display.windowScale);
    }, 500);
    applyAudioSettings(this.settings.get().audio);
    this.upscalers.apply(this.settings.get().display);
    // The language is applied here, not in the settings panel, so a value
    // restored from storage is honoured before the first frame (the same reason
    // display and audio are applied above). Every view resolves its strings per
    // frame, so a switch takes effect immediately.
    //
    // `?lang=` wins over the stored value: the E2E harnesses assert against the
    // English copy while the shipped default is Chinese, and a screenshot run
    // must not depend on whatever a previous run persisted. It goes through the
    // store (not straight into `setLanguage`) so the settings panel shows the
    // language the UI is actually in.
    if (config.language !== undefined && config.language !== '' && isLanguageCode(config.language)) {
      this.settings.update({ language: config.language });
    }
    setLanguage(this.settings.get().language);

    this.fpsOverlay = createFpsOverlay();
    this.fpsOverlay.setVisible(this.settings.get().display.showFps);

    // ★ 按分组去重 —— 哪一组真的动了才应用哪一组。
    //
    // 不加这层判断时，任何一次设置变更都会把下面四个全跑一遍，而其中
    // `applyDisplaySettings` 会重设帧率上限与画布尺寸、`upscalers.apply`
    // 会重建升频器，两者都是**整屏重绘**级别的操作。
    // 于是拖一下音量、或者按下设置里任何一个按钮，整个画面连所有按钮
    // 都会闪一次 —— 与改动的那一项毫无关系的部分也跟着重绘。
    let appliedDisplay = this.settings.get().display;
    let appliedAudio = this.settings.get().audio;
    let appliedLanguage = this.settings.get().language;
    this.settings.subscribe((next) => {
      if (!sameSettingsGroup(next.display, appliedDisplay)) {
        applyDisplaySettings(next.display);
        this.upscalers.apply(next.display);
        this.fpsOverlay.setVisible(next.display.showFps);
        applyWindowScale(next.display.windowScale);
        appliedDisplay = next.display;
      }
      if (!sameSettingsGroup(next.audio, appliedAudio)) {
        applyAudioSettings(next.audio);
        appliedAudio = next.audio;
      }
      if (next.language !== appliedLanguage) {
        setLanguage(next.language);
        appliedLanguage = next.language;
      }
    });

    const httpTransport = new HttpLobbyTransport(new LayaHttpClient(config.lobbyHttpBase));
    const nakamaTransport = new NakamaLobbyTransport(
      new LayaHttpClient(config.lobbyNakamaHttpBase ?? config.lobbyHttpBase),
      { httpKey: config.nakamaHttpKey, serverKey: config.nakamaServerKey ?? config.nakamaHttpKey },
    );
    // WS seam: `WsLobbyTransport` speaks Gensoulkyo's own lobby WS protocol
    // (`/v1/lobby/ws`, `runtime/lobbyws`), which Nakama does not serve. The
    // Nakama socket replacement belongs here — a `LobbyTransport` built on
    // Nakama's realtime socket plus `onEvent(...)` for the pushed
    // `room_state` / `match_start` / `match_result` frames, so the wiring
    // below (`lobbyTransport.onEvent(...)`) stays unchanged. Until that
    // transport exists, `nakama_rpc` is the only working path.
    const lobbyTransport =
      config.lobbyWsUrl !== ''
        ? new WsLobbyTransport(config.socketFactory.connect(config.lobbyWsUrl), {
            logger: config.logger,
            platform: 'laya',
            clientBuild: config.clientBuild,
            userId: config.deviceId,
            fallback: httpTransport,
            // A dropped lobby channel is rebuilt with a brand-new socket: a
            // `Laya.Socket` cannot be revived once closed. One attempt per call.
            reconnect: () => config.socketFactory.connect(config.lobbyWsUrl),
          })
        : config.lobbyTransport === 'nakama_rpc'
          ? nakamaTransport
          : httpTransport;

    this.lobbyClient = new LobbyClient({
      transport: lobbyTransport,
      // `match.events` / `match.snapshot` are forbidden on the Nakama RPC path
      // (403 client_operation_disallowed), so every fetch must go over REST
      // regardless of which transport carries the business operations.
      restTransport: httpTransport,
      logger: config.logger,
      deviceId: config.deviceId,
      clientBuild: config.clientBuild,
      sessionStore: config.sessionStore,
    });
    if (lobbyTransport instanceof WsLobbyTransport) {
      // Pushed room state / match start / match result arrive out-of-band.
      lobbyTransport.onEvent((event) => this.lobbyClient.dispatchEvent(event));
    }
    this.flow = new LobbyFlow(this.lobbyClient);
    this.battleClient = new BattleClient({
      datagramFactory: config.datagramFactory,
      timer: this.timer,
      logger: config.logger,
    });
    this.input = new LayaInput();

    // The local player id is only known after sign-in, so screens read it lazily.
    //
    // It must come from the **battle ticket**, not the session: the lobby never
    // puts a battle `player_id` in an auth response. Verified against the
    // deployed lobby — `POST /v1/auth/anonymous` answers
    // `{user_id, session_token, display_name, created_at}` and `GET /v1/bootstrap`
    // has no `player_id` field at all, so `SessionState.playerId` is always `''`
    // (an account session does not carry one either: the only `json:"player_id"`
    // declarations in `runtime/core/types.go` are on the battle ticket and the
    // battle payloads). The roster id is `p-<sha256(matchID:userID)[:4]>`, minted
    // per match and revealed only in the signed ticket attached to `match_start`.
    //
    // Reading the session here therefore always yielded `''`, so `BattleScene`
    // could not tell which player was "mine" and the HUD fell back to
    // `YOU 0/6000` while the opponent took the first roster slot.
    const localPlayerId = (): string => {
      const ticketPlayerId = this.flow.snapshot().match?.playerId ?? '';
      return ticketPlayerId !== '' ? ticketPlayerId : this.lobbyClient.session?.playerId ?? '';
    };

    // The match-event poller. Its source is backed by the REST transport (via
    // `LobbyClient.fetchMatchEvents`), and its events drive the battle scene's
    // card effects and SEs. 500 ms / 64 rows mirrors the server page cap.
    this.battlePoller = new BattleEventPoller(
      { fetchEvents: (matchId, after, limit) => this.fetchEventsPage(matchId, after, limit) },
      this.timer,
      {
        intervalMs: 500,
        limit: 64,
        onEvents: (events) => this.onMatchEvents(events),
        // The server dropped events we had not read; rebuild from the snapshot.
        onGap: (matchId) => {
          void this.enterBattlePerformance(matchId, true);
        },
        onError: (message) => console.warn(`[spellkard] match event poll failed: ${message}`),
      },
    );

    // The login screen is the entry point: `LobbyFlow` starts on
    // `LobbyScreen.Login`, so `start()` shows this scene first. It also gets the
    // endpoint it could not reach, so a connection failure names the host.
    this.loginScene = new LoginScene({
      width: config.stageWidth,
      height: config.stageHeight,
      flow: this.flow,
      lobbyEndpoint: config.lobbyWsUrl !== '' ? config.lobbyWsUrl : config.lobbyHttpBase,
      settings: this.settings,
    });
    this.lobbyScene = new LobbyScene({
      width: config.stageWidth,
      height: config.stageHeight,
      flow: this.flow,
      settings: this.settings,
    });
    this.roomScene = new RoomScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });
    this.battleScene = new BattleScene({
      width: config.stageWidth,
      height: config.stageHeight,
      battle: this.battleClient,
      input: this.input,
      timer: this.timer,
      localPlayerId,
      bossMaxHp: BOSS_RACE_DEFAULT_BOSS_HP,
      // Mirrors the battle server's default `--max-ticks` (see the
      // phk-battle-agent systemd unit). Used only for the HUD countdown; the
      // server remains authoritative on when the match actually ends.
      matchTickLimit: BOSS_RACE_DEFAULT_MAX_TICKS,
      tickRateHz: BOSS_RACE_TICK_RATE_HZ,
      // The purge RNG needs the lobby match seed (`match.ServerSeed`) as exact
      // decimal text — the same `seedFrom(matchID)` the server hashes. Read it
      // lazily: it only arrives with `match_start` / the battle allocation.
      // `bossRaceSeedFromHex` keeps the full 64-bit width; an empty hex yields
      // `''` (not `0`) so the scene hides nothing instead of purging a made-up
      // set.
      serverSeedDecimal: () => {
        const hex =
          this.flow.snapshot().match?.serverSeedHex ?? this.lobbyClient.allocation?.serverSeedHex ?? '';
        return hex === '' ? '' : bossRaceSeedFromHex(hex).decimal;
      },
      // The hand bar reads the dealt hand from the signed ticket (fetched in
      // `enterBattlePerformance`); before it resolves this returns null and the
      // bar draws nothing.
      openingHand: () => this.battleOpening,
      // Draft events name players by lobby `user_id`, so the picker's role and
      // which grants belong to this client are decided against the session id.
      localUserId: () => this.lobbyClient.session?.userId ?? '',
      // A candidate click becomes one `match.mode_action` pick; the lobby owns
      // the outcome, the client only sends the intent.
      selectDraftCard: (matchId, candidateIndex, modeId) => {
        void this.lobbyClient.selectRoundCard(matchId, candidateIndex, modeId);
      },
      // A gift-bar click becomes one `match.mode_action` gift; the lobby owns
      // the outcome (and echoes it to both players as `gift_sent`).
      sendGift: (matchId, giftId, modeId) => {
        void this.lobbyClient.sendMatchGift(matchId, giftId, modeId);
      },
      // Remaining gift charges of the independent per-match pool — NOT card
      // energy. Derived from the event stream (the server pushes no count), so
      // it lags by at most one poll; the server stays authoritative and its
      // refusals surface as the usual error toast.
      giftCharges: () => giftChargesLeft(this.giftChargesSpent),
      // The scene's lifecycle starts/stops the poller; it owns no network itself.
      onPerformanceEnter: () => {
        if (this.performanceMatchId !== '' && !this.battlePoller.running) {
          this.battlePoller.start(this.performanceMatchId);
        }
      },
      onPerformanceExit: () => this.battlePoller.stop(),
      onMatchEnd: (winnerPlayerId) => this.onMatchEnd(winnerPlayerId),
    });
    // `.dem` replay player. It owns no network: the result / records screens
    // ask for a replay id and the app downloads the container bytes on their
    // behalf (constructed first so both screens can reference it).
    this.demPlayerScene = new DemPlayerScene({ width: config.stageWidth, height: config.stageHeight });
    this.resultScene = new ResultScene({
      width: config.stageWidth,
      height: config.stageHeight,
      flow: this.flow,
      localPlayerId,
      onOpenDemPlayer: (replayId, label) => {
        void this.openDemReplay(replayId, label);
      },
    });
    // Lobby business screens: check-in, shop and inventory. All three read the
    // same `LobbyFlow` snapshot, so wiring is just construction + the switch.
    this.checkinScene = new CheckinScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });
    this.shopScene = new ShopScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });
    this.gachaScene = new GachaScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });
    this.inventoryScene = new InventoryScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });
    this.deckScene = new DeckScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });
    this.recordsScene = new RecordsScene({
      width: config.stageWidth,
      height: config.stageHeight,
      flow: this.flow,
      onOpenDemPlayer: (replayId, label) => {
        void this.openDemReplay(replayId, label);
      },
    });

    this.flow.onChange((snapshot) => this.onFlowChange(snapshot));
    this.battleClient.onResult((result) => {
      this.flow.applyResult({
        matchId: result.matchId,
        winnerPlayerId: result.winnerPlayerId,
        points: {},
        replayId: '',
        serverAuthoritative: true,
        modeId: result.modeId,
        settledAtMs: 0,
      });
    });
  }

  start(): void {
    for (const scene of this.allScenes()) {
      Laya.stage.addChild(scene.root);
    }
    // The frame-rate readout goes on last so it paints above every screen,
    // including the settings modal.
    this.fpsOverlay.attach(Laya.stage);
    this.switchTo(this.flow.currentScreen);
    // `attach()` needs `Laya.stage`, which only exists after `Laya.init`, so the
    // dispatcher is wired here rather than in the constructor.
    this.shortcuts.attach();
    // LayaNative draws the caret itself from JS, and its private text layout
    // mis-places the empty-text branch; the adapter only publishes
    // `Laya.NativeTextLayout` after `Laya.init`, so the patch is installed here.
    // On web this is a no-op (the class does not exist) and returns false.
    installNativeCaretFix();
    // Steam (DLC + achievements) is optional: without the native extension or
    // the Steam client this is a silent no-op; the game never waits on it.
    void initSteamSession();
    void this.loadConfiguredModules();
  }

  /**
   * Pulls in the external backend modules ("DLC") the player listed in settings.
   *
   * Nothing is fetched unless the list is non-empty AND `autoLoad` is on — the
   * stock build downloads no external code. Failures are collected rather than
   * thrown: a bad URL must not stop the client from starting.
   */
  private async loadConfiguredModules(): Promise<void> {
    const plugins = this.settings.get().plugins;
    if (!plugins.autoLoad || plugins.moduleUrls.length === 0) {
      return;
    }
    const result = await this.upscalers.loadModules(plugins.moduleUrls);
    for (const failure of result.failed) {
      console.warn(`[spellkard] upscaler module ${failure.url} failed: ${failure.error}`);
    }
  }

  /**
   * Routes a resolved shortcut. The active screen gets first refusal so it can
   * claim the keys that mean something inside it; anything it declines falls
   * through to the app-wide bindings.
   */
  private handleShortcut(action: ShortcutAction, event: Laya.KeyboardEventLike): boolean {
    const scene = this.activeScene;
    if (isShortcutCapable(scene) && scene.handleShortcut(action, event)) {
      return true;
    }
    switch (action) {
      case 'app.fullscreen':
        void toggleFullscreen();
        return true;
      case 'app.settings':
        return this.openSettings();
      default:
        return false;
    }
  }

  /** Opens the active screen's settings overlay, when it has one. */
  private openSettings(): boolean {
    const overlay = this.activeScene?.settings;
    if (overlay === undefined) {
      return false;
    }
    overlay.show();
    return true;
  }

  /**
   * Builds the dispatcher host for a screen.
   *
   * A fresh object per switch (rather than a mutable shared one) keeps
   * `ShortcutHost.scope` honestly readonly and makes the scope a pure function
   * of the active screen.
   */
  private hostFor(scene: ClientScene): ShortcutHost {
    return {
      scope: isShortcutCapable(scene) ? scene.shortcutScope : 'global',
      handleShortcut: (action, event) => this.handleShortcut(action, event),
    };
  }

  private allScenes(): ClientScene[] {
    return [
      this.loginScene,
      this.lobbyScene,
      this.roomScene,
      this.battleScene,
      this.resultScene,
      this.checkinScene,
      this.shopScene,
      this.gachaScene,
      this.inventoryScene,
      this.deckScene,
      this.recordsScene,
      this.demPlayerScene,
    ];
  }

  private onFlowChange(snapshot: LobbyFlowSnapshot): void {
    // A flow transition closes any open replay player overlay.
    this.demPlayerScene.close();
    if (snapshot.screen === LobbyScreen.Battle && snapshot.match !== null) {
      void this.ensureBattleConnected(snapshot);
      // Record the match before the async snapshot so `onPerformanceEnter`
      // (fired by the scene's `onEnter`, right after this) can start the poller.
      this.performanceMatchId = snapshot.match.matchId;
      void this.enterBattlePerformance(snapshot.match.matchId, false);
    }
    switch (snapshot.screen) {
      case LobbyScreen.Login:
        this.loginScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Lobby:
      case LobbyScreen.Error:
        this.lobbyScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Room:
      case LobbyScreen.Matching:
        this.roomScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Result:
        this.resultScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Checkin:
        this.checkinScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Shop:
        this.shopScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Gacha:
        this.gachaScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Inventory:
        this.inventoryScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Deck:
        this.deckScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Records:
        this.recordsScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Battle:
        break;
    }
    this.switchTo(snapshot.screen);
  }

  /**
   * Downloads a finished match's `.dem` container and opens the replay player.
   * A missing container (or a non-participant caller) simply does not open the
   * overlay; the records screen keeps showing the list.
   */
  private async openDemReplay(replayId: string, label: string): Promise<void> {
    try {
      const bytes = await this.lobbyClient.downloadDem(replayId);
      if (bytes === null) {
        return;
      }
      this.demPlayerScene.open(bytes, label);
    } catch (error) {
      console.warn(`[spellkard] dem download failed for ${replayId}: ${String(error)}`);
    }
  }

  private async ensureBattleConnected(snapshot: LobbyFlowSnapshot): Promise<void> {
    const match = snapshot.match;
    if (match === null || this.battleClient.info?.matchId === match.matchId) {
      return;
    }
    const session = this.lobbyClient.session;
    // The battle roster uses `player_id` (`p-<hash>`), which the lobby only ever
    // reveals in the signed battle ticket attached to `match_start`. The session's
    // own `playerId` is usually empty (anonymous auth returns none), and sending
    // the lobby `user_id` instead makes the battle server drop every input.
    const localPlayerId = match.playerId !== '' ? match.playerId : session?.playerId ?? '';
    // The battle server binds a session to the first input that carries the
    // signed ticket, so the ticket has to be in hand before the first send —
    // otherwise it logs `reason=ticket_missing` and the recording loses the
    // account. A failure here degrades to today's behaviour (connect without a
    // ticket) instead of blocking the match.
    // The `battle.ticket` RPC response is the authoritative signed ticket: the
    // same field names and shapes the battle server decodes. The `match_start`
    // WS message also carries a ticket, but as a *projection* (its seed is not
    // the decimal text the server parses), so swapping it in wholesale made the
    // server log `server_seed_invalid` — keep the RPC object.
    let signedTicket = this.lobbyClient.ticket?.raw;
    if (signedTicket === undefined) {
      try {
        const ticket = await this.lobbyClient.fetchBattleTicket(match.matchId);
        signedTicket = ticket?.raw;
      } catch {
        signedTicket = undefined;
      }
    }
    this.battleClient.connect({
      matchId: match.matchId,
      playerId: localPlayerId,
      playerIds: match.playerIds.length > 0 ? match.playerIds : [localPlayerId],
      modeId: match.modeId,
      rulesetVersion: match.rulesetVersion,
      endpoint: match.endpoint,
      // Full 64-bit width: the server prints the whole seed into both its RNG
      // material and its state hash, so a 32-bit fold can never agree.
      serverSeed: bossRaceSeedFromHex(match.serverSeedHex),
      signedTicket,
    });
  }

  /**
   * Fetches the match snapshot and applies it to the battle scene: stage
   * background, watermarks and BGM. Called on entering a match and again on a
   * poller gap (to rebuild the scene state the dropped events would have set).
   *
   * @param restartPoller force a cursor reset (a gap resync); otherwise the
   *        poller is only started when it is not already running.
   */
  private async enterBattlePerformance(matchId: string, restartPoller: boolean): Promise<void> {
    if (matchId === '') {
      return;
    }
    const snapshot = await this.lobbyClient.fetchMatchSnapshot(matchId);
    // The flow moved on while the snapshot was in flight: drop the stale result.
    if (this.performanceMatchId !== matchId) {
      return;
    }
    if (snapshot !== null) {
      const stage = stageIndex(snapshot.stageId);
      this.battleScene.setStage(stage);
      this.battleScene.showCharacter(characterPortrait(snapshot.characterId));
      // The snapshot carries no boss phase yet; phase 1 is the standing art.
      this.battleScene.showBoss(bossPortrait(stage, 1), 1);
      this.battleScene.playStageBgm(snapshot.stageId);
    }
    // The opening hand rides in the signed battle ticket, which is only
    // revealed once the match starts; fetch it so the hand bar can draw the
    // dealt cards. A failure leaves `battleOpening` null (the bar draws
    // nothing) rather than inventing a hand.
    const ticket = await this.lobbyClient.fetchBattleTicket(matchId);
    if (this.performanceMatchId !== matchId) {
      return;
    }
    this.battleOpening = ticket?.opening ?? null;
    if (restartPoller || !this.battlePoller.running) {
      // A (re)start replays the stream from the oldest retained event, so the
      // derived gift-charge count must restart from zero — otherwise every
      // `gift_sent` row counts twice (a gap resync re-delivers the boundary
      // page that detected it).
      this.giftChargesSpent = 0;
      this.battlePoller.start(matchId);
    }
  }

  /** Stops polling and forgets the match. */
  private stopBattlePerformance(): void {
    this.battlePoller.stop();
    this.performanceMatchId = '';
    this.battleOpening = null;
    // Charges are per-match: they do not migrate into the next one.
    this.giftChargesSpent = 0;
  }

  /**
   * One REST page of the match-event stream, adapted to the poller's page shape.
   *
   * `oldestCursor` comes straight from the server's `oldest_cursor`
   * (`LobbyClient.fetchMatchEvents`), so the poller's `after < oldestCursor`
   * test raises `onGap` for real when the server dropped events we had not
   * read. When the server omits the field it parses as `0`, which can only
   * suppress a gap — never invent one.
   */
  private async fetchEventsPage(matchId: string, after: number, limit: number): Promise<MatchEventsPage | null> {
    const page = await this.lobbyClient.fetchMatchEvents(matchId, after, limit);
    if (page === null) {
      return null;
    }
    return {
      events: page.events,
      cursor: page.cursor,
      hasMore: page.hasMore,
      oldestCursor: page.oldestCursor,
    };
  }

  /** Feeds one page of match events into the battle scene's effect/SE bridge. */
  private onMatchEvents(events: MatchEventView[]): void {
    const resolveRosterId = (userId: string): string => this.resolveRosterId(userId);
    for (const event of events) {
      this.battleScene.applyMatchEvent(event, resolveRosterId);
      if (event.type === 'gift_sent') {
        this.battleScene.applyGiftEvent(event);
      }
    }
    // Derive the spent gift charges from this page: the rows the local player
    // sent, priced by the catalog. Pages arrive in order and each row is
    // delivered once per poller run (the run resets the counter on start), so
    // accumulating per page is exact — see `enterBattlePerformance`.
    this.giftChargesSpent += giftChargesSpentFrom(events, this.lobbyClient.session?.userId ?? '');
  }

  /**
   * Maps a lobby `user_id` to the battle roster id (`p-<hash>`).
   *
   * The lobby mints it as `"p-" + hex(sha256(matchID + ":" + userID)[:4])`
   * (`Gensoulkyo/runtime/core/service.go` `playerIDForUser` / `shortHash`), and
   * `shortHashHex` reproduces `shortHash` exactly, so the client derives the
   * same id without a server round-trip. Before a match id is known the input is
   * passed through unchanged.
   */
  private resolveRosterId(userId: string): string {
    const matchId = this.performanceMatchId;
    if (matchId === '' || userId === '') {
      return userId;
    }
    return `p-${shortHashHex(`${matchId}:${userId}`)}`;
  }

  private onMatchEnd(winnerPlayerId: string): void {
    this.stopBattlePerformance();
    const match = this.flow.snapshot().match;
    this.flow.applyResult({
      matchId: match?.matchId ?? '',
      winnerPlayerId,
      points: {},
      replayId: '',
      serverAuthoritative: true,
      modeId: match?.modeId ?? DEFAULT_MODE_ID,
      settledAtMs: 0,
    });
  }

  private switchTo(screen: LobbyScreen): void {
    const key = screen === LobbyScreen.Matching ? LobbyScreen.Room : screen;
    if (this.activeScreen === key) {
      return;
    }
    this.activeScene?.onExit();
    const next = this.sceneFor(key);
    // Mark the target active *before* `onEnter()` runs. `onEnter()` may kick off
    // a reload that loops back through the flow (`flow.openCheckin()` →
    // `setScreen` → `onFlowChange` → `switchTo`). With the active screen still
    // pointing at the previous entry, that re-entrant call would not short
    // circuit and the two would recurse until the stack overflows. Updating the
    // fields first turns the re-entrant call into the no-op it should be.
    this.activeScene = next;
    this.activeScreen = key;
    this.shortcuts.setHost(this.hostFor(next));
    next.onEnter();
  }

  private sceneFor(screen: LobbyScreen): ClientScene {
    switch (screen) {
      case LobbyScreen.Login:
        return this.loginScene;
      case LobbyScreen.Room:
        return this.roomScene;
      case LobbyScreen.Battle:
        return this.battleScene;
      case LobbyScreen.Result:
        return this.resultScene;
      case LobbyScreen.Checkin:
        return this.checkinScene;
      case LobbyScreen.Shop:
        return this.shopScene;
      case LobbyScreen.Gacha:
        return this.gachaScene;
      case LobbyScreen.Inventory:
        return this.inventoryScene;
      case LobbyScreen.Deck:
        return this.deckScene;
      case LobbyScreen.Records:
        return this.recordsScene;
      default:
        return this.lobbyScene;
    }
  }

  destroy(): void {
    this.activeScene?.onExit();
    this.battlePoller.stop();
    for (const scene of this.allScenes()) {
      scene.destroy();
    }
    this.shortcuts.detach();
    this.upscalers.reset();
    this.fpsOverlay.destroy();
    this.input.destroy();
    this.battleClient.close();
    this.lobbyClient.close();
  }

  /**
   * Debug-only scene accessors, used by the local screenshot harness to drive
   * each screen without a live lobby server. Not part of the runtime flow.
   */
  debugScenes(): {
    login: LoginScene;
    lobby: LobbyScene;
    room: RoomScene;
    battle: BattleScene;
    result: ResultScene;
    checkin: CheckinScene;
    shop: ShopScene;
    gacha: GachaScene;
    inventory: InventoryScene;
    deck: DeckScene;
    records: RecordsScene;
    demPlayer: DemPlayerScene;
    flow: LobbyFlow;
    /** Shared settings store, so the harness can drive values directly. */
    settings: SettingsStore;
    /** Keyboard dispatcher, so the harness can drive keys and read the scope. */
    shortcuts: ShortcutDispatcher;
    /** Upscaler + DLC controller, so the harness can assert the pass state. */
    upscalers: UpscalerController;
    /** Live caret/overlay readout, so the harness can assert where a click landed. */
    textInput: () => ReturnType<typeof textInputDebugState>;
    /** Whether the LayaNative caret-position patch was installed on this run. */
    nativeCaret: () => boolean;
    /** Fullscreen readout for the `Alt+Enter` assertion. */
    fullscreen: () => ReturnType<typeof fullscreenDebugState>;
    switchTo: (screen: LobbyScreen) => void;
  } {
    return {
      login: this.loginScene,
      lobby: this.lobbyScene,
      room: this.roomScene,
      battle: this.battleScene,
      result: this.resultScene,
      checkin: this.checkinScene,
      shop: this.shopScene,
      gacha: this.gachaScene,
      inventory: this.inventoryScene,
      deck: this.deckScene,
      records: this.recordsScene,
      demPlayer: this.demPlayerScene,
      flow: this.flow,
      settings: this.settings,
      shortcuts: this.shortcuts,
      upscalers: this.upscalers,
      textInput: () => textInputDebugState(),
      nativeCaret: () => nativeCaretFixInstalled(),
      fullscreen: () => fullscreenDebugState(),
      switchTo: (screen: LobbyScreen) => this.switchTo(screen),
    };
  }
}
