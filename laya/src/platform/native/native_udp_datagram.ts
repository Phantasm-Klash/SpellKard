/**
 * Battle datagram transport for **native** (LayaNative) builds.
 *
 * Browsers cannot open raw UDP sockets, but LayaNative can through a native
 * extension. `spk_udp` (see `laya/native/udp_ext/`) exposes a non-blocking UDP
 * socket to JS; this adapter wraps it as a core `DatagramLike` so `KcpSession`
 * runs unchanged over real UDP.
 *
 * The native extension is poll-based: JS calls `recvFrom` on a timer and the
 * extension writes the datagram into a caller-owned buffer. That keeps the
 * extension's JSVM surface tiny (ints + ArrayBuffers, no object construction)
 * and needs no cross-thread `post_to_js` marshalling.
 *
 * The web build keeps using the WS relay (`ws_relay_datagram.ts`); the two are
 * chosen by configuration in `main.ts`.
 */

import type { DatagramFactory, DatagramHandlers, DatagramLike, TimerLike } from '../../core/net/transport';
import { OfflineDatagram } from '../../core/net/transport';

/** The `spk_udp` global exported by the LayaNative UDP extension. */
export interface NativeUdpModule {
  version(): string;
  create(): number;
  bind(handle: number, address: string, port: number): number;
  setNonBlocking(handle: number, flag: number): number;
  sendTo(handle: number, address: string, port: number, data: ArrayBuffer): number;
  recvFrom(handle: number, buffer: ArrayBuffer): number;
  lastRecvAddress(handle: number): string;
  localPort(handle: number): number;
  close(handle: number): number;
}

export interface UdpEndpoint {
  host: string;
  port: number;
}

/** Parses `host:port` (and `[ipv6]:port`). Returns `null` when malformed. */
export function parseUdpEndpoint(endpoint: string): UdpEndpoint | null {
  const trimmed = endpoint.trim();
  if (trimmed === '') {
    return null;
  }
  let host = '';
  let portText = '';
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    if (close < 0 || trimmed[close + 1] !== ':') {
      return null;
    }
    host = trimmed.slice(1, close);
    portText = trimmed.slice(close + 2);
  } else {
    const colon = trimmed.lastIndexOf(':');
    if (colon <= 0) {
      return null;
    }
    host = trimmed.slice(0, colon);
    portText = trimmed.slice(colon + 1);
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  return { host, port };
}

function isNativeUdpModule(value: unknown): value is NativeUdpModule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.create === 'function' &&
    typeof record.bind === 'function' &&
    typeof record.sendTo === 'function' &&
    typeof record.recvFrom === 'function' &&
    typeof record.close === 'function'
  );
}

/**
 * Returns the native UDP module when the extension is loaded, or `null` on web
 * builds (where `spk_udp` is undefined).
 */
export function resolveNativeUdpModule(scope: unknown = globalThis): NativeUdpModule | null {
  if (typeof scope !== 'object' || scope === null) {
    return null;
  }
  const direct = (scope as Record<string, unknown>).spk_udp;
  if (isNativeUdpModule(direct)) {
    return direct;
  }
  const nested = (scope as Record<string, unknown>).window;
  if (typeof nested === 'object' && nested !== null) {
    const fromWindow = (nested as Record<string, unknown>).spk_udp;
    if (isNativeUdpModule(fromWindow)) {
      return fromWindow;
    }
  }
  return null;
}

const RECEIVE_BUFFER_SIZE = 65536;
const MAX_DRAIN_PER_TICK = 256;

export interface NativeUdpDatagramOptions {
  /** Local bind address; defaults to every interface. */
  bindAddress?: string;
  /** Local bind port; 0 lets the OS choose. */
  bindPort?: number;
  /** How often the receive queue is drained, in milliseconds. */
  pollIntervalMs?: number;
}

/**
 * `DatagramLike` backed by the native UDP extension. Each instance owns one
 * socket handle and polls it on the injected timer.
 */
export class NativeUdpDatagram implements DatagramLike {
  closed = false;

  private handlers: DatagramHandlers = {};
  private readonly receiveBuffer = new Uint8Array(RECEIVE_BUFFER_SIZE);
  private readonly pollIntervalMs: number;
  private timerHandle = 0;

  constructor(
    private readonly module: NativeUdpModule,
    private readonly timer: TimerLike,
    private readonly target: UdpEndpoint,
    private readonly handle: number,
    options: NativeUdpDatagramOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 5;
    this.timerHandle = this.timer.setInterval(() => this.poll(), this.pollIntervalMs);
  }

  send(data: Uint8Array): void {
    if (this.closed) {
      return;
    }
    // Copy into a fresh ArrayBuffer so a subarray's byteOffset never leaks.
    const copy = new Uint8Array(data.length);
    copy.set(data);
    this.module.sendTo(this.handle, this.target.host, this.target.port, copy.buffer);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.timer.clearInterval(this.timerHandle);
    this.module.close(this.handle);
    this.handlers.onClose?.();
  }

  setHandlers(handlers: DatagramHandlers): void {
    this.handlers = handlers;
  }

  private poll(): void {
    if (this.closed) {
      return;
    }
    for (let drained = 0; drained < MAX_DRAIN_PER_TICK; drained += 1) {
      const received = this.module.recvFrom(this.handle, this.receiveBuffer.buffer);
      if (received === 0) {
        return;
      }
      if (received < 0) {
        this.handlers.onError?.(new Error('native udp recv error'));
        return;
      }
      const payload = this.receiveBuffer.slice(0, received);
      this.handlers.onMessage?.(payload);
    }
  }
}

/**
 * `DatagramFactory` that opens a native UDP socket per battle. When the endpoint
 * cannot be parsed it returns an offline channel so the client degrades instead
 * of throwing.
 */
export class NativeUdpDatagramFactory implements DatagramFactory {
  constructor(
    private readonly module: NativeUdpModule,
    private readonly timer: TimerLike,
    private readonly options: NativeUdpDatagramOptions = {},
  ) {}

  open(endpoint: string): DatagramLike {
    const target = parseUdpEndpoint(endpoint);
    if (target === null) {
      return new OfflineDatagram();
    }
    const handle = this.module.create();
    if (handle < 0) {
      return new OfflineDatagram();
    }
    this.module.setNonBlocking(handle, 1);
    const bound = this.module.bind(handle, this.options.bindAddress ?? '0.0.0.0', this.options.bindPort ?? 0);
    if (bound !== 1) {
      this.module.close(handle);
      return new OfflineDatagram();
    }
    return new NativeUdpDatagram(this.module, this.timer, target, handle, this.options);
  }
}
