/**
 * `Laya.Socket` adapter implementing the core `SocketLike` contract.
 *
 * LayaAir's socket is a WebSocket in browser builds and a native TCP/WS socket
 * in LayaAir native builds, so it covers both the lobby RPC channel and the
 * battle datagram relay. Message payloads arrive on `socket.input`; text frames
 * are read as UTF-8 and binary frames as an `ArrayBuffer`.
 */

import type { SocketHandlers, SocketLike } from '../../core/net/transport';

export class LayaSocket implements SocketLike {
  private handlers: SocketHandlers = {};
  private opened = false;
  private closedByUser = false;

  constructor(private readonly socket: Laya.Socket) {
    socket.disableInput = false;
    socket.on(Laya.Event.OPEN, this, () => {
      this.opened = true;
      this.handlers.onOpen?.();
    });
    socket.on(Laya.Event.MESSAGE, this, () => this.readMessage());
    socket.on(Laya.Event.CLOSE, this, () => {
      this.handlers.onClose?.(1000, 'closed');
    });
    socket.on(Laya.Event.ERROR, this, () => {
      this.handlers.onError?.(new Error('laya socket error'));
    });
  }

  get connected(): boolean {
    return this.opened && !this.closedByUser;
  }

  connect(url: string): void {
    this.socket.connectByUrl(url);
  }

  send(data: string | Uint8Array): void {
    if (typeof data === 'string') {
      this.socket.send(data);
      return;
    }
    const copy = new Uint8Array(data.length);
    copy.set(data);
    this.socket.send(copy.buffer);
  }

  close(): void {
    if (this.closedByUser) {
      return;
    }
    this.closedByUser = true;
    this.socket.close();
  }

  setHandlers(handlers: SocketHandlers): void {
    this.handlers = handlers;
  }

  private readMessage(): void {
    const input = this.socket.input;
    const length = input.length;
    if (length <= 0) {
      return;
    }
    // LayaAir keeps the raw bytes on `input.buffer`; try UTF-8 first because the
    // lobby RPC channel is JSON text, then fall back to raw bytes.
    const raw = new Uint8Array(input.buffer);
    const text = tryDecodeUtf8(raw);
    if (text !== null) {
      this.handlers.onMessage?.(text);
      return;
    }
    this.handlers.onMessage?.(raw);
  }
}

export class LayaSocketFactory {
  connect(url: string): SocketLike {
    const socket = new Laya.Socket();
    const adapter = new LayaSocket(socket);
    adapter.connect(url);
    return adapter;
  }
}

/**
 * Returns the decoded string only when the bytes form valid UTF-8 text that
 * looks like the lobby JSON protocol; otherwise `null` so the caller treats the
 * frame as binary.
 */
function tryDecodeUtf8(bytes: Uint8Array): string | null {
  const trimmed = trimTrailingNul(bytes);
  if (trimmed.length === 0) {
    return null;
  }
  // Lobby frames are JSON objects/arrays.
  if (trimmed[0] !== 0x7b && trimmed[0] !== 0x5b) {
    return null;
  }
  try {
    const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;
    if (decoder === null) {
      return null;
    }
    return decoder.decode(trimmed);
  } catch {
    return null;
  }
}

function trimTrailingNul(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    end -= 1;
  }
  return bytes.subarray(0, end);
}
