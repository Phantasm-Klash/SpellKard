/**
 * DOM `WebSocket` adapter implementing the core `SocketLike` contract.
 *
 * Used by the browser build for both the lobby RPC channel and the battle
 * datagram relay.
 */

import type { SocketHandlers, SocketLike } from '../../core/net/transport';

export class BrowserWebSocket implements SocketLike {
  private handlers: SocketHandlers = {};
  private closedByUser = false;

  constructor(private readonly socket: WebSocket) {
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => this.handlers.onOpen?.();
    socket.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data === 'string') {
        this.handlers.onMessage?.(data);
      } else if (data instanceof ArrayBuffer) {
        this.handlers.onMessage?.(new Uint8Array(data));
      } else if (data instanceof Uint8Array) {
        this.handlers.onMessage?.(data);
      }
    };
    socket.onclose = (event: CloseEvent) => this.handlers.onClose?.(event.code, event.reason);
    socket.onerror = () => this.handlers.onError?.(new Error('websocket error'));
  }

  get connected(): boolean {
    return this.socket.readyState === 1;
  }

  send(data: string | Uint8Array): void {
    if (typeof data === 'string') {
      this.socket.send(data);
      return;
    }
    // Copy into a standalone ArrayBuffer: subarray views would otherwise be
    // serialized with the wrong bounds.
    const copy = new Uint8Array(data.length);
    copy.set(data);
    this.socket.send(copy.buffer);
  }

  close(code = 1000, reason = ''): void {
    if (this.closedByUser) {
      return;
    }
    this.closedByUser = true;
    this.socket.close(code, reason);
  }

  setHandlers(handlers: SocketHandlers): void {
    this.handlers = handlers;
  }
}

export class BrowserWebSocketFactory {
  connect(url: string): SocketLike {
    return new BrowserWebSocket(new WebSocket(url));
  }
}
