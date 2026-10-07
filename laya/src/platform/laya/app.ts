/**
 * Application wiring for the LayaAir build.
 *
 * Owns the LayaAir stage, the lobby/battle clients, the four screens and the
 * screen-switch policy driven by `LobbyFlow`. Platform adapters (socket, timer,
 * datagram, HTTP) are chosen here so the core stays platform-free.
 */

import { BattleClient } from '../../core/net/battle_client';
import { HttpLobbyTransport, LobbyClient, WsLobbyTransport, seedFromHex } from '../../core/net/lobby_client';
import type { DatagramFactory, Logger, SocketFactory, TimerLike } from '../../core/net/transport';
import { LobbyFlow, LobbyScreen, type LobbyFlowSnapshot } from '../../core/game/lobby_flow';
import { BOSS_RACE_DEFAULT_BOSS_HP, BOSS_RACE_DEFAULT_MAX_TICKS, BOSS_RACE_TICK_RATE_HZ } from '../../core/sim/boss_race';
import { LayaInput } from './laya_input';
import { LayaTimer } from './laya_timer';
import { BattleScene } from './scenes/battle_scene';
import { CheckinScene } from './scenes/checkin_scene';
import { InventoryScene } from './scenes/inventory_scene';
import { LobbyScene } from './scenes/lobby_scene';
import { ResultScene } from './scenes/result_scene';
import { RoomScene } from './scenes/room_scene';
import { ShopScene } from './scenes/shop_scene';
import type { ClientScene } from './scenes/scene';
import { FetchHttpClient } from '../web/web_http_client';

export interface ClientConfig {
  stageWidth: number;
  stageHeight: number;
  lobbyHttpBase: string;
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
}

export class SpellKardApp {
  private readonly timer: TimerLike;
  private readonly flow: LobbyFlow;
  private readonly lobbyClient: LobbyClient;
  private readonly battleClient: BattleClient;
  private readonly input: LayaInput;
  private readonly lobbyScene: LobbyScene;
  private readonly roomScene: RoomScene;
  private readonly battleScene: BattleScene;
  private readonly resultScene: ResultScene;
  private readonly checkinScene: CheckinScene;
  private readonly shopScene: ShopScene;
  private readonly inventoryScene: InventoryScene;
  private activeScene: ClientScene | null = null;
  private activeScreen = '';

  constructor(config: ClientConfig) {
    this.timer = config.timer ?? new LayaTimer();

    const httpTransport = new HttpLobbyTransport(new FetchHttpClient(config.lobbyHttpBase));
    const lobbyTransport =
      config.lobbyWsUrl !== ''
        ? new WsLobbyTransport(config.socketFactory.connect(config.lobbyWsUrl), {
            logger: config.logger,
            platform: 'laya',
            clientBuild: config.clientBuild,
            userId: config.deviceId,
            fallback: httpTransport,
          })
        : httpTransport;

    this.lobbyClient = new LobbyClient({ transport: lobbyTransport, logger: config.logger });
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
    const localPlayerId = (): string => this.lobbyClient.session?.playerId ?? '';

    this.lobbyScene = new LobbyScene({ width: config.stageWidth, height: config.stageHeight, flow: this.flow });
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
    this.switchTo(this.flow.currentScreen);
  }

  private allScenes(): ClientScene[] {
    return [
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
    const localPlayerId = session?.playerId ?? '';
    this.battleClient.connect({
      matchId: match.matchId,
      playerId: localPlayerId,
      playerIds: match.playerIds.length > 0 ? match.playerIds : [localPlayerId],
      modeId: match.modeId,
      rulesetVersion: match.rulesetVersion,
      endpoint: match.endpoint,
      serverSeed: seedFromHex(match.serverSeedHex),
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
      modeId: match?.modeId ?? 'mvp_boss_race',
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
    next.onEnter();
  }

  private sceneFor(screen: LobbyScreen): ClientScene {
    switch (screen) {
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
    this.input.destroy();
    this.battleClient.close();
    this.lobbyClient.close();
  }

  /**
   * Debug-only scene accessors, used by the local screenshot harness to drive
   * each screen without a live lobby server. Not part of the runtime flow.
   */
  debugScenes(): {
    lobby: LobbyScene;
    room: RoomScene;
    battle: BattleScene;
    result: ResultScene;
    checkin: CheckinScene;
    shop: ShopScene;
    inventory: InventoryScene;
    flow: LobbyFlow;
    switchTo: (screen: LobbyScreen) => void;
  } {
    return {
      lobby: this.lobbyScene,
      room: this.roomScene,
      battle: this.battleScene,
      result: this.resultScene,
      checkin: this.checkinScene,
      shop: this.shopScene,
      inventory: this.inventoryScene,
      flow: this.flow,
      switchTo: (screen: LobbyScreen) => this.switchTo(screen),
    };
  }
}
