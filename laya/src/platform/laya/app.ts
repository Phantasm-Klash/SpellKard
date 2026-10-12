/**
 * Application wiring for the LayaAir build.
 *
 * Owns the LayaAir stage, the lobby/battle clients, the four screens and the
 * screen-switch policy driven by `LobbyFlow`. Platform adapters (socket, timer,
 * datagram, HTTP) are chosen here so the core stays platform-free.
 */

import { bossRaceSeedFromHex } from '../../core/math/boss_race_seed';
import { BattleClient } from '../../core/net/battle_client';
import {
  HttpLobbyTransport,
  LobbyClient,
  NakamaLobbyTransport,
  WsLobbyTransport,
  type LobbySessionStore,
} from '../../core/net/lobby_client';
import type { DatagramFactory, Logger, SocketFactory, TimerLike } from '../../core/net/transport';
import { DEFAULT_MODE_ID, LobbyFlow, LobbyScreen, type LobbyFlowSnapshot } from '../../core/game/lobby_flow';
import { BOSS_RACE_DEFAULT_BOSS_HP, BOSS_RACE_DEFAULT_MAX_TICKS, BOSS_RACE_TICK_RATE_HZ } from '../../core/sim/boss_race';
import { SettingsStore } from '../../core/settings';
import type { ShortcutAction } from '../../core/input/shortcuts';
import { applyAudioSettings } from './audio';
import { applyDisplaySettings, createFpsOverlay, type FpsOverlayHandle } from './display';
import { toggleFullscreen, fullscreenDebugState } from './fullscreen';
import { LayaInput } from './laya_input';
import { LayaTimer } from './laya_timer';
import { installNativeCaretFix, nativeCaretFixInstalled } from './native_caret';
import { ShortcutDispatcher, type ShortcutHost } from './shortcuts';
import { UpscalerController } from './upscaler';
import { textInputDebugState } from './text_input';
import { BattleScene } from './scenes/battle_scene';
import { CheckinScene } from './scenes/checkin_scene';
import { InventoryScene } from './scenes/inventory_scene';
import { LobbyScene } from './scenes/lobby_scene';
import { LoginScene } from './scenes/login_scene';
import { ResultScene } from './scenes/result_scene';
import { RoomScene } from './scenes/room_scene';
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
}

export class SpellKardApp {
  private readonly timer: TimerLike;
  private readonly settings: SettingsStore;
  private readonly fpsOverlay: FpsOverlayHandle;
  private readonly flow: LobbyFlow;
  private readonly lobbyClient: LobbyClient;
  private readonly battleClient: BattleClient;
  private readonly input: LayaInput;
  private readonly loginScene: LoginScene;
  private readonly lobbyScene: LobbyScene;
  private readonly roomScene: RoomScene;
  private readonly battleScene: BattleScene;
  private readonly resultScene: ResultScene;
  private readonly checkinScene: CheckinScene;
  private readonly shopScene: ShopScene;
  private readonly inventoryScene: InventoryScene;
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
    applyAudioSettings(this.settings.get().audio);
    this.upscalers.apply(this.settings.get().display);

    this.fpsOverlay = createFpsOverlay();
    this.fpsOverlay.setVisible(this.settings.get().display.showFps);

    this.settings.subscribe((next) => {
      applyDisplaySettings(next.display);
      applyAudioSettings(next.audio);
      this.upscalers.apply(next.display);
      this.fpsOverlay.setVisible(next.display.showFps);
    });

    const httpTransport = new HttpLobbyTransport(new LayaHttpClient(config.lobbyHttpBase));
    const nakamaTransport = new NakamaLobbyTransport(
      new LayaHttpClient(config.lobbyNakamaHttpBase ?? config.lobbyHttpBase),
      { httpKey: config.nakamaHttpKey },
    );
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
      onMatchEnd: (winnerPlayerId) => this.onMatchEnd(winnerPlayerId),
    });
    this.resultScene = new ResultScene({
      width: config.stageWidth,
      height: config.stageHeight,
      flow: this.flow,
      localPlayerId,
    });
    // Lobby business screens: check-in, shop and inventory. All three read the
    // same `LobbyFlow` snapshot, so wiring is just construction + the switch.
    this.checkinScene = new CheckinScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });
    this.shopScene = new ShopScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });
    this.inventoryScene = new InventoryScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });

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
      this.inventoryScene,
    ];
  }

  private onFlowChange(snapshot: LobbyFlowSnapshot): void {
    if (snapshot.screen === LobbyScreen.Battle && snapshot.match !== null) {
      this.ensureBattleConnected(snapshot);
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
      case LobbyScreen.Inventory:
        this.inventoryScene.applySnapshot(snapshot);
        break;
      case LobbyScreen.Battle:
        break;
    }
    this.switchTo(snapshot.screen);
  }

  private ensureBattleConnected(snapshot: LobbyFlowSnapshot): void {
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
    });
  }

  private onMatchEnd(winnerPlayerId: string): void {
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
      case LobbyScreen.Inventory:
        return this.inventoryScene;
      default:
        return this.lobbyScene;
    }
  }

  destroy(): void {
    this.activeScene?.onExit();
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
    inventory: InventoryScene;
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
      inventory: this.inventoryScene,
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
