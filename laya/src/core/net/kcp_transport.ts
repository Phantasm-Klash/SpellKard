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

/**
 * Upper bound for one reassembled KCP message.
 *
 * A boss21 delta snapshot reaches ~130KB (216 spawns × ~518B of full
 * BulletMotion template, plus ~12KB of `chains[]`), so a 64KB cap silently
 * deadlocks the receive path: `Kcp.recv` answers -3, the drain loop treats it
 * like "nothing more to read", and the oversized head message stays at the
 * front of the queue forever — the client then stops seeing snapshots while
 * its local tick keeps advancing.
 *
 * 4MB leaves plenty of headroom over any real snapshot while still bounding
 * the allocation a malformed length field could ask for.
 */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

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
      // ★ 上限必须**大于任何一条合法消息**，否则 recv 返回 -3（too small），
      //   而 -3 与 -1/-2 一样让下面的循环 break —— 于是队头那条超限消息永远
      //   取不出来，KCP 接收队列（rcvWnd=128）被它顶满，后续快照全部堵在
      //   服务端的发送窗口后面：**实机症状是客户端只收到头两条快照就再无进展**
      //   （本地 tick 一路涨、权威 tick 卡住）。
      //   一条 boss21 的 delta 快照可达 ~130KB：单 tick 216 条 spawn，每条带
      //   完整 37 字段 BulletMotion 模板（~518B/条），加上 chains[] 12KB。
      //   所以这里按「实测最大消息 + 余量」取 4MB，远大于任何真实快照，
      //   又不至于让一个畸形长度字段把内存吃光。
      const message = this.kcp.recv(MAX_MESSAGE_BYTES);
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
    const datagram = data.subarray(0, length).slice();
    try {
      this.datagram.send(datagram);
    } catch (error) {
      // A broken/offline channel must degrade to a dropped datagram. Letting
      // this escape would unwind the KCP timer callback (`update` → `flush` →
      // `output`) and stop the session from ever flushing again.
      this.sendFailures += 1;
      this.logger.warn(`kcp datagram send failed: ${String(error)}`);
    }
  }
}

export { IKCP_OVERHEAD };
