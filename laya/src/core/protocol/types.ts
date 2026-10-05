/**
 * TypeScript mirrors of the `phk.v1` protobuf messages the client consumes.
 *
 * Field numbers are copied from `PhK-Protocol/proto/phk/v1/*.proto` so the
 * hand-rolled codec in `codec.ts` stays wire-compatible with the Go/C++ sides.
 * `bytes` fields map to `Uint8Array`, 64-bit integers to `number` (JS-safe for
 * the ranges this protocol uses), and enums to their numeric values.
 */

// ---------------------------------------------------------------------------
// common.proto
// ---------------------------------------------------------------------------

export interface VersionStamp {
  protocolVersion: number;
  businessApiVersion: string;
  battleApiVersion: string;
  rulesetVersion: string;
  rulesetHash: string;
}

export interface SignedBlob {
  payload: Uint8Array;
  signatureAlg: string;
  keyId: string;
  signature: Uint8Array;
}

export interface ErrorStatus {
  code: string;
  message: string;
  retryable: boolean;
}

export interface DeckSnapshotRef {
  deckId: string;
  deckSnapshotHash: string;
  rulesetVersion: string;
  cardIds: string[];
}

export interface LoadoutRef {
  userId: string;
  playerId: string;
  characterId: string;
  stageId: string;
  ratingCode: string;
  deck?: DeckSnapshotRef;
}

// ---------------------------------------------------------------------------
// matchmaking.proto
// ---------------------------------------------------------------------------

export interface BattleTicket {
  version?: VersionStamp;
  ticketId: string;
  matchId: string;
  userId: string;
  playerId: string;
  modeId: string;
  battleServerId: string;
  endpoint: string;
  deckSnapshotHash: string;
  rulesetVersion: string;
  ticketNonce: Uint8Array;
  issuedAtMs: number;
  expiresAtMs: number;
  businessSessionId: string;
}

export interface SignedBattleTicket {
  ticket?: BattleTicket;
  signatureAlg: string;
  keyId: string;
  signature: Uint8Array;
}

export interface BattleServerAllocation {
  version?: VersionStamp;
  matchId: string;
  modeId: string;
  battleServerId: string;
  endpoint: string;
  players: LoadoutRef[];
  serverSeed: Uint8Array;
  modeConfigHash: string;
  allocatedAtMs: number;
}

// ---------------------------------------------------------------------------
// lobby.proto
// ---------------------------------------------------------------------------

export enum LobbyMessageType {
  UNSPECIFIED = 0,
  AUTH_REQUEST = 1,
  AUTH_RESPONSE = 2,
  BOOTSTRAP_REQUEST = 3,
  BOOTSTRAP_RESPONSE = 4,
  ROOM_CREATE_REQUEST = 5,
  ROOM_CREATE_RESPONSE = 6,
  ROOM_JOIN_REQUEST = 7,
  ROOM_JOIN_RESPONSE = 8,
  ROOM_LEAVE_REQUEST = 9,
  ROOM_STATE = 10,
  MATCH_START = 11,
  MATCH_RESULT = 12,
}

export interface LobbyPlayerProfile {
  userId: string;
  playerId: string;
  displayName: string;
  characterId: string;
  level: number;
  ratingCode: string;
  loadout?: LoadoutRef;
}

export interface LobbyPlayer {
  userId: string;
  playerId: string;
  displayName: string;
  ready: boolean;
  host: boolean;
  connected: boolean;
  characterId: string;
  loadout?: LoadoutRef;
}

export interface LobbyAuthRequest {
  version?: VersionStamp;
  sessionToken: string;
  userId: string;
  platform: string;
  clientBuild: string;
}

export interface LobbyAuthResponse {
  version?: VersionStamp;
  sessionToken: string;
  userId: string;
  playerId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  error?: ErrorStatus;
}

export interface LobbyBootstrapRequest {
  version?: VersionStamp;
  sessionToken: string;
  userId: string;
  knownRulesetVersion: string;
}

export interface LobbyBootstrapResponse {
  version?: VersionStamp;
  profile?: LobbyPlayerProfile;
  rulesetVersion: string;
  unlockedCharacterIds: string[];
  serverFlags: Record<string, string>;
  error?: ErrorStatus;
}

export interface RoomCreateRequest {
  version?: VersionStamp;
  roomCode: string;
  modeId: string;
  hostUserId: string;
  loadout?: LoadoutRef;
  modeParams: Record<string, string>;
}

export interface RoomCreateResponse {
  version?: VersionStamp;
  roomCode: string;
  modeId: string;
  hostUserId: string;
  room?: RoomStateMessage;
  error?: ErrorStatus;
}

export interface RoomJoinRequest {
  version?: VersionStamp;
  roomCode: string;
  userId: string;
  playerId: string;
  loadout?: LoadoutRef;
}

export interface RoomJoinResponse {
  version?: VersionStamp;
  roomCode: string;
  modeId: string;
  hostUserId: string;
  players: LobbyPlayer[];
  room?: RoomStateMessage;
  error?: ErrorStatus;
}

export interface RoomLeaveRequest {
  version?: VersionStamp;
  roomCode: string;
  userId: string;
  playerId: string;
  reason: string;
}

export interface RoomStateMessage {
  version?: VersionStamp;
  roomCode: string;
  hostUserId: string;
  players: LobbyPlayer[];
  modeId: string;
  allReady: boolean;
  rulesetVersion: string;
  modeParams: Record<string, string>;
}

export interface MatchStartMessage {
  version?: VersionStamp;
  matchId: string;
  serverSeed: Uint8Array;
  battleServerId: string;
  endpoint: string;
  signedBattleTicket?: SignedBattleTicket;
  rulesetVersion: string;
  modeId: string;
  playerIds: string[];
  startedAtMs: number;
}

export interface MatchResultMessage {
  version?: VersionStamp;
  matchId: string;
  winnerPlayerId: string;
  points: Record<string, number>;
  replayId: string;
  serverAuthoritative: boolean;
  modeId: string;
  settledAtMs: number;
}

// ---------------------------------------------------------------------------
// battle.proto
// ---------------------------------------------------------------------------

export enum BattlePayloadType {
  UNSPECIFIED = 0,
  HANDSHAKE_HELLO = 1,
  HANDSHAKE_ACCEPT = 2,
  INPUT = 3,
  SNAPSHOT = 4,
  EVENT = 5,
  PING = 6,
  RECONNECT = 7,
  RESULT = 8,
  MODE_ACTION = 9,
  BOSS_RACE_STATE = 10,
}

export interface BattlePacketHeader {
  version?: VersionStamp;
  matchId: string;
  playerId: string;
  tick: number;
  seq: number;
  ack: number;
  payloadType: BattlePayloadType;
  keyId: string;
  nonce: Uint8Array;
}

export interface BattleEncryptedPacket {
  header?: BattlePacketHeader;
  ciphertext: Uint8Array;
  authTag: Uint8Array;
}

export interface BattleHandshakeHello {
  version?: VersionStamp;
  battleTicket?: SignedBattleTicket;
  clientX25519Pub: Uint8Array;
  clientRandom: Uint8Array;
  supportedAead: string[];
}

export interface BattleHandshakeAccept {
  version?: VersionStamp;
  matchId: string;
  playerId: string;
  serverX25519Pub: Uint8Array;
  serverRandom: Uint8Array;
  selectedAead: string;
  kcpConv: number;
  keyId: string;
  transcriptHash: Uint8Array;
  serverSignature?: SignedBlob;
}

export interface BattleInput {
  version?: VersionStamp;
  matchId: string;
  playerId: string;
  tick: number;
  seq: number;
  directionBits: number;
  slow: boolean;
  shoot: boolean;
  bomb: boolean;
  cardSlot: number;
  modeActionId: string;
}

export interface BattleModeAction {
  version?: VersionStamp;
  matchId: string;
  playerId: string;
  tick: number;
  seq: number;
  actionId: string;
  actionType: string;
  payloadJson: Uint8Array;
  clientResultAuthoritative: boolean;
}

export interface BattlePlayerSnapshot {
  playerId: string;
  xMilli: number;
  yMilli: number;
  connected: boolean;
  handSize: number;
}

export interface BattleBulletDelta {
  bulletId: string;
  op: string;
  xMilli: number;
  yMilli: number;
  vxMilli: number;
  vyMilli: number;
  radiusMilli: number;
  patternId: string;
  color: string;
}

export interface BattleSnapshot {
  version?: VersionStamp;
  matchId: string;
  snapshotTick: number;
  snapshotKind: string;
  stateHash: string;
  players: BattlePlayerSnapshot[];
  bulletsDelta: BattleBulletDelta[];
  modeState: Record<string, string>;
  eventCursor: number;
}

export interface BattleEvent {
  version?: VersionStamp;
  matchId: string;
  cursor: number;
  tick: number;
  type: string;
  playerId: string;
  payloadJson: Uint8Array;
  serverAuthoritative: boolean;
}

export interface BattleResult {
  version?: VersionStamp;
  matchId: string;
  modeId: string;
  resultHash: string;
  replayId: string;
  playerIds: string[];
  rewardProjectionJson: Uint8Array;
  modeResultJson: Uint8Array;
  settledAtMs: number;
}

export interface SignedBattleResult {
  result?: BattleResult;
  signatureAlg: string;
  keyId: string;
  signature: Uint8Array;
}

export interface BossRacePlayerState {
  playerId: string;
  bossCurrentHp: number;
  bossMaxHp: number;
  damageDealt: number;
  defeated: boolean;
  defeatTick: number;
  pointsAwarded: number;
}

export interface BossRaceModeState {
  version?: VersionStamp;
  matchId: string;
  modeId: string;
  tick: number;
  players: BossRacePlayerState[];
  winnerPlayerId: string;
  matchOver: boolean;
  rulesetVersion: string;
}

export function emptyVersionStamp(): VersionStamp {
  return {
    protocolVersion: 0,
    businessApiVersion: '',
    battleApiVersion: '',
    rulesetVersion: '',
    rulesetHash: '',
  };
}

export function emptyUint8Array(): Uint8Array {
  return new Uint8Array(0);
}
