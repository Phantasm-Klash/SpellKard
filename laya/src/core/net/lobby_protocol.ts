/**
 * Gensoulkyo lobby WebSocket wire protocol (`runtime/lobbyws/protocol.go`).
 *
 * Every lobby message is a JSON envelope:
 *
 *   {"type": <int>, "seq": <int>, "payload": { ... }}
 *
 * The `type` discriminates the payload shape (see `LobbyMessageType`); the
 * server never echoes `seq`, so request/response correlation is done by message
 * type. `seq` is still sent for observability and decoded when present.
 *
 * This module is deliberately free of transport/client types so it can be unit
 * tested on its own.
 */

import {
  DESCRIPTOR_BATTLE_API_VERSION,
  DESCRIPTOR_BUSINESS_API_VERSION,
  DESCRIPTOR_PROTOCOL_VERSION,
  DESCRIPTOR_RULESET_HASH,
  DESCRIPTOR_RULESET_VERSION,
} from '../protocol/descriptor.generated';

/** `phk.v1.LobbyMessageType`. */
export const LOBBY_MESSAGE = {
  AuthRequest: 1,
  AuthResponse: 2,
  BootstrapRequest: 3,
  BootstrapResponse: 4,
  RoomCreateRequest: 5,
  RoomCreateResponse: 6,
  RoomJoinRequest: 7,
  RoomJoinResponse: 8,
  RoomLeaveRequest: 9,
  RoomState: 10,
  MatchStart: 11,
  MatchResult: 12,
  /** Transport-level extension (not in `lobby.proto`). */
  Error: 100,
} as const;

export type LobbyMessageType = (typeof LOBBY_MESSAGE)[keyof typeof LOBBY_MESSAGE];

/** `phk.v1.VersionStamp`. */
export interface VersionStamp {
  protocol_version: number;
  business_api_version: string;
  battle_api_version: string;
  ruleset_version: string;
  ruleset_hash: string;
}

/** Version stamp matching the vendored protocol descriptor. */
export const DEFAULT_VERSION_STAMP: VersionStamp = {
  protocol_version: DESCRIPTOR_PROTOCOL_VERSION,
  business_api_version: DESCRIPTOR_BUSINESS_API_VERSION,
  battle_api_version: DESCRIPTOR_BATTLE_API_VERSION,
  ruleset_version: DESCRIPTOR_RULESET_VERSION,
  ruleset_hash: DESCRIPTOR_RULESET_HASH,
};

/** `phk.v1.ErrorStatus`, also the payload of a `TypeError` envelope. */
export interface ErrorStatus {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface LobbyEnvelope {
  type: number;
  seq?: number;
  payload?: unknown;
}

/** Serialize a lobby envelope. */
export function encodeLobbyEnvelope(type: number, payload?: unknown, seq?: number): string {
  const envelope: LobbyEnvelope = { type };
  if (seq !== undefined) {
    envelope.seq = seq;
  }
  if (payload !== undefined) {
    envelope.payload = payload;
  }
  return JSON.stringify(envelope);
}

/** Parse a lobby envelope; returns `null` for non-envelope JSON. */
export function decodeLobbyEnvelope(text: string): LobbyEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'number' || !Number.isFinite(type)) {
    return null;
  }
  const envelope: LobbyEnvelope = { type };
  if (typeof record.seq === 'number' && Number.isFinite(record.seq)) {
    envelope.seq = record.seq;
  }
  if (record.payload !== undefined) {
    envelope.payload = record.payload;
  }
  return envelope;
}

/** Route from a high-level lobby operation id to its WS request/response types. */
export interface LobbyWsRoute {
  requestType: number;
  /** Envelope types that complete the request (a `TypeError` completes any). */
  responseTypes: readonly number[];
}

/**
 * Operations the lobby WS protocol can carry. Operations absent from this table
 * (matchmaking, battle ticket, replay, …) are not part of the WS protocol and
 * must go through another transport.
 */
export const LOBBY_WS_ROUTES: Record<string, LobbyWsRoute> = {
  'auth.anonymous': { requestType: LOBBY_MESSAGE.AuthRequest, responseTypes: [LOBBY_MESSAGE.AuthResponse] },
  bootstrap: { requestType: LOBBY_MESSAGE.BootstrapRequest, responseTypes: [LOBBY_MESSAGE.BootstrapResponse] },
  'rooms.create': { requestType: LOBBY_MESSAGE.RoomCreateRequest, responseTypes: [LOBBY_MESSAGE.RoomCreateResponse] },
  'rooms.join': { requestType: LOBBY_MESSAGE.RoomJoinRequest, responseTypes: [LOBBY_MESSAGE.RoomJoinResponse] },
  // A leave is acknowledged by the resulting room state push.
  'rooms.leave': { requestType: LOBBY_MESSAGE.RoomLeaveRequest, responseTypes: [LOBBY_MESSAGE.RoomState] },
};

/** Envelope types the server pushes without a matching request. */
export const LOBBY_PUSH_TYPES: readonly number[] = [
  LOBBY_MESSAGE.RoomState,
  LOBBY_MESSAGE.MatchStart,
  LOBBY_MESSAGE.MatchResult,
];

/** Reads the `error` sub-object of a response payload, if any. */
export function errorStatusOf(payload: unknown): ErrorStatus | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const error = (payload as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) {
    return null;
  }
  const record = error as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  if (code === '') {
    return null;
  }
  const status: ErrorStatus = {
    code,
    message: typeof record.message === 'string' ? record.message : '',
  };
  if (typeof record.retryable === 'boolean') {
    status.retryable = record.retryable;
  }
  return status;
}

/** Reads a bare `ErrorStatus` payload (a `TypeError` envelope). */
export function errorStatusFromPayload(payload: unknown): ErrorStatus {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { code: 'invalid_error', message: '' };
  }
  const record = payload as Record<string, unknown>;
  const status: ErrorStatus = {
    code: typeof record.code === 'string' && record.code !== '' ? record.code : 'lobby_ws_error',
    message: typeof record.message === 'string' ? record.message : '',
  };
  if (typeof record.retryable === 'boolean') {
    status.retryable = record.retryable;
  }
  return status;
}
