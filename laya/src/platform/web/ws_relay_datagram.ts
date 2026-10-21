/**
 * Battle datagram transport for the **web** build.
 *
 * Browsers cannot open raw UDP sockets, so the web client tunnels the KCP
 * datagrams through the lobby server's WebSocket connection: the client sends
 * each KCP datagram as one binary WS frame, Gensoulkyo forwards it to the
 * assigned battle server over UDP, and relays the reply back as a binary frame.
 * Text frames on the same socket remain the lobby RPC channel.
 *
 * The relay URL and handshake below are the client side of that contract.
 * Gensoulkyo implements the server side at `/v1/battle/relay`
 * (`runtime/lobbyws/server.go` `HandleRelay`): it dials the match's battle-server
 * UDP socket and pipes raw binary frames in both directions. The only query
 * parameter it requires is `match_id`; the rest are advisory.
 */

import type { DatagramFactory, DatagramHandlers, DatagramLike, DatagramSessionContext, SocketFactory, SocketLike } from '../../core/net/transport';

export interface RelaySessionDescriptor {
  /** e.g. `wss://lobby.example/v1/battle/relay`. */
  relayUrl: string;
  matchId: string;
  playerId: string;
  battleServerId: string;
  /** Signed battle ticket id presented to the relay for authorization. */
  ticketId: string;
  /**
   * Advisory: the battle-server endpoint (`host:port`) the match was allocated
   * to. The lobby relay resolves the match server-side and ignores this hint,
   * but a dumb relay (e.g. the local WS-to-UDP demo relay, which has no session
   * token and cannot call the allocation REST) dials it directly instead of
   * falling back to a hard-coded port that may host a stale match.
   */
  endpoint?: string;
}

export function buildRelayUrl(descriptor: RelaySessionDescriptor): string {
  const pairs: Array<[string, string]> = [
    ['match_id', descriptor.matchId],
    ['player_id', descriptor.playerId],
    ['battle_server_id', descriptor.battleServerId],
    ['ticket_id', descriptor.ticketId],
    ['endpoint', descriptor.endpoint ?? ''],
  ];
  // `match_id` is mandatory server-side; the rest are omitted when unknown so the
  // URL stays stable and the server never sees empty-valued hints.
  const query = pairs
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return query === '' ? descriptor.relayUrl : `${descriptor.relayUrl}?${query}`;
}

/**
 * Wraps a `SocketLike` that is already connected to the relay endpoint.
 * Binary frames in both directions are raw KCP datagrams.
 */
export class WsRelayDatagram implements DatagramLike {
  private handlers: DatagramHandlers = {};

  closed = false;

  constructor(private readonly socket: SocketLike) {
    socket.setHandlers({
      onMessage: (data) => {
        if (typeof data === 'string') {
          // Lobby RPC traffic shares the socket; the battle layer ignores it.
          return;
        }
        this.handlers.onMessage?.(data);
      },
      onClose: (_code, _reason) => {
        this.closed = true;
        this.handlers.onClose?.();
      },
      onError: (error) => this.handlers.onError?.(error),
    });
  }

  send(data: Uint8Array): void {
    if (this.closed) {
      return;
    }
    this.socket.send(data);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.socket.close();
  }

  setHandlers(handlers: DatagramHandlers): void {
    this.handlers = handlers;
  }
}

/** Opens the relay socket for a match and returns the datagram channel. */
export class WsRelayDatagramFactory {
  constructor(
    private readonly connect: (url: string) => SocketLike,
    private readonly descriptor: RelaySessionDescriptor,
  ) {}

  open(): DatagramLike {
    const socket = this.connect(buildRelayUrl(this.descriptor));
    return new WsRelayDatagram(socket);
  }
}

/**
 * `DatagramFactory` adapter so the bootstrap can hand the battle client a
 * relay-backed datagram channel. `open(endpoint, session)` treats `endpoint` as
 * the relay base URL when no explicit `relayUrl` was configured, and forwards the
 * match identity from `session` so the lobby can route to the right battle
 * server. The resolved `endpoint` is also forwarded as an advisory query hint
 * (`endpoint=host:port`): the lobby relay ignores it, while a local demo relay
 * dials it directly instead of guessing a fallback port.
 */
export class RelayDatagramFactory implements DatagramFactory {
  constructor(
    private readonly sockets: SocketFactory,
    private readonly relayUrl = '',
  ) {}

  open(endpoint: string, session: DatagramSessionContext = {}): DatagramLike {
    const descriptor: RelaySessionDescriptor = {
      relayUrl: this.relayUrl !== '' ? this.relayUrl : endpoint,
      matchId: session.matchId ?? '',
      playerId: session.playerId ?? '',
      battleServerId: session.battleServerId ?? '',
      ticketId: session.ticketId ?? '',
      endpoint,
    };
    return new WsRelayDatagramFactory((url) => this.sockets.connect(url), descriptor).open();
  }
}
