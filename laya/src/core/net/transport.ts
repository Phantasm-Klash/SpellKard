/**
 * Engine-agnostic transport contracts.
 *
 * The core never references `WebSocket`, `Laya.Socket`, `dgram` or any platform
 * global directly: platform adapters implement these interfaces and inject them.
 * That keeps `tsc -p tsconfig.json` (no DOM/Node libs) able to type-check the
 * whole core layer on its own.
 */

export interface SocketHandlers {
  onOpen?: () => void;
  onMessage?: (data: string | Uint8Array) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (error: Error) => void;
}

/** A text/binary bidirectional socket (WebSocket-like). */
export interface SocketLike {
  readonly connected: boolean;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  setHandlers(handlers: SocketHandlers): void;
}

export interface SocketFactory {
  connect(url: string): SocketLike;
}

export interface DatagramHandlers {
  onMessage?: (data: Uint8Array) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/**
 * An unreliable datagram channel. Native builds wrap a real UDP socket; the web
 * build wraps the lobby WebSocket relay. KCP runs on top of this either way.
 */
export interface DatagramLike {
  readonly closed: boolean;
  send(data: Uint8Array): void;
  close(): void;
  setHandlers(handlers: DatagramHandlers): void;
}

export interface DatagramFactory {
  open(endpoint: string): DatagramLike;
}

/** Timer/clock abstraction so the KCP update loop is testable and injectable. */
export interface TimerLike {
  now(): number;
  setInterval(callback: () => void, intervalMs: number): number;
  clearInterval(handle: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * A no-op transport used by tests and by headless/offline modes. It never opens
 * a connection and never delivers messages.
 */
export class OfflineSocket implements SocketLike {
  private handlers: SocketHandlers = {};

  readonly connected = false;

  send(): void {
    throw new Error('OfflineSocket: not connected');
  }

  close(): void {
    this.handlers.onClose?.(1000, 'offline');
  }

  setHandlers(handlers: SocketHandlers): void {
    this.handlers = handlers;
  }
}

export class OfflineDatagram implements DatagramLike {
  private handlers: DatagramHandlers = {};

  readonly closed = false;

  send(): void {
    throw new Error('OfflineDatagram: not connected');
  }

  close(): void {
    this.handlers.onClose?.();
  }

  setHandlers(handlers: DatagramHandlers): void {
    this.handlers = handlers;
  }
}

export class OfflineSocketFactory implements SocketFactory {
  connect(): SocketLike {
    return new OfflineSocket();
  }
}

export class OfflineDatagramFactory implements DatagramFactory {
  open(): DatagramLike {
    return new OfflineDatagram();
  }
}
