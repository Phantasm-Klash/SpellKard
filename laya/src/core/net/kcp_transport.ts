/**
 * KCP session over an abstract datagram channel.
 *
 * The battle client's upper layer only sees `send(bytes)` / `onMessage`. The
 * datagram underneath is a real UDP socket on native builds and the lobby
 * WebSocket relay on web builds, so both share this class unchanged.
 */

import { IKCP_INTERVAL, IKCP_MTU_DEF, IKCP_OVERHEAD, Kcp } from './ikcp';
import type { DatagramLike, Logger, TimerLike } from './transport';
import { nullLogger } from './transport';

export interface KcpSessionOptions {
  conv: number;
  /** `ikcp_nodelay` parameters. The battle server defaults to no-delay mode. */
  noDelay?: number;
  intervalMs?: number;
  fastResend?: number;
  noCongestion?: boolean;
  sndWnd?: number;
  rcvWnd?: number;
  mtu?: number;
  logger?: Logger;
}

export type KcpMessageHandler = (payload: Uint8Array) => void;

/**
 * Drives `ikcp_update`/`ikcp_flush` on a fixed timer and pumps received
 * datagrams into the KCP state machine.
 */
export class KcpSession {
  private readonly kcp: Kcp;
  private readonly datagram: DatagramLike;
  private readonly timer: TimerLike;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private timerHandle = 0;
  private messageHandler: KcpMessageHandler | null = null;
  private closed = false;

  /** Datagrams dropped because the underlying channel was already closed. */
  sendFailures = 0;

  constructor(datagram: DatagramLike, timer: TimerLike, options: KcpSessionOptions) {
    this.datagram = datagram;
    this.timer = timer;
    this.logger = options.logger ?? nullLogger;
    this.intervalMs = options.intervalMs ?? IKCP_INTERVAL;

    this.kcp = new Kcp(options.conv);
    this.kcp.setNodelay(
      options.noDelay ?? 1,
      this.intervalMs,
      options.fastResend ?? 2,
      options.noCongestion === false ? 0 : 1,
    );
    this.kcp.wndsize(options.sndWnd ?? 128, options.rcvWnd ?? 128);
    this.kcp.setmtu(options.mtu ?? IKCP_MTU_DEF);
    this.kcp.setOutput((data, length) => this.output(data, length));

    this.datagram.setHandlers({
      onMessage: (data) => this.kcp.input(data, data.length),
      onClose: () => this.close(),
      onError: (error) => this.logger.warn(`kcp datagram error: ${error.message}`),
    });

    this.timerHandle = this.timer.setInterval(() => this.tick(), this.intervalMs);
  }

  get mtu(): number {
    return this.kcp.mtu;
  }

  get maxPayloadSize(): number {
    // Leave room for one KCP segment header per datagram.
    return this.kcp.mss;
  }

  onMessage(handler: KcpMessageHandler): void {
    this.messageHandler = handler;
  }

  /** Queue a reliable, ordered payload. Returns false if the payload is invalid. */
  send(payload: Uint8Array): boolean {
    if (this.closed) {
      return false;
    }
    if (this.kcp.send(payload, payload.length) !== 0) {
      return false;
    }
    this.kcp.flush();
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.timer.clearInterval(this.timerHandle);
    this.datagram.close();
  }

  private tick(): void {
    if (this.closed) {
      return;
    }
    this.kcp.update(this.timer.now());
    this.kcp.flush();
    this.drain();
  }

  private drain(): void {
    for (;;) {
      const message = this.kcp.recv(65536);
      if (typeof message === 'number') {
        // -1 empty, -2 incomplete, -3 too small: stop draining.
        break;
      }
      this.messageHandler?.(message);
    }
  }

  private output(data: Uint8Array, length: number): void {
    if (this.datagram.closed) {
      this.sendFailures += 1;
      return;
    }
    // Copy out of the reusable write buffer before handing it to the channel.
    this.datagram.send(data.subarray(0, length).slice());
  }
}

export { IKCP_OVERHEAD };
