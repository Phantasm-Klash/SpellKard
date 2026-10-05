/**
 * Battle datagram transport for the **web** build.
 *
 * Browsers cannot open raw UDP sockets, so the web client tunnels the KCP
 * datagrams through the lobby server's WebSocket connection: the client sends
 * each KCP datagram as one binary WS frame, Gensoulkyo forwards it to the
 * assigned battle server over UDP, and relays the reply back as a binary frame.
 * Text frames on the same socket remain the lobby RPC channel.
 *
 * The relay URL and handshake below are the client side of that contract. The
 * server-side relay endpoint is not implemented in Gensoulkyo yet (it currently
 * exposes only the RPC/WSS business dispatcher), so this class is the integration
 * seam for the web path — it is fully functional against any relay that follows
 * the same framing.
 */

import type { DatagramHandlers, DatagramLike, SocketLike } from '../../core/net/transport';

export interface RelaySessionDescriptor {
  /** e.g. `wss://lobby.example/v1/battle/relay`. */
  relayUrl: string;
  matchId: string;
  playerId: string;
  battleServerId: string;
  /** Signed battle ticket id presented to the relay for authorization. */
  ticketId: string;
}

export function buildRelayUrl(descriptor: RelaySessionDescriptor): string {
  const query = [
    `match_id=${encodeURIComponent(descriptor.matchId)}`,
    `player_id=${encodeURIComponent(descriptor.playerId)}`,
    `battle_server_id=${encodeURIComponent(descriptor.battleServerId)}`,
    `ticket_id=${encodeURIComponent(descriptor.ticketId)}`,
  ].join('&');
  return `${descriptor.relayUrl}?${query}`;
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
