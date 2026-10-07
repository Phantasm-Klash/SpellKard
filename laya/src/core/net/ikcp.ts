/**
 * KCP (skywind3000/ikcp) port for the battle client.
 *
 * PhK-BattleServer links the upstream `third_party/ikcp/ikcp.c` and its
 * `kcp_server_endpoint.cpp` speaks the standard KCP wire format:
 *
 *   segment = conv(4) | cmd(1) | frg(1) | wnd(2) | ts(4) | sn(4) | una(4) | len(4)   [24 bytes]
 *
 * all little-endian. This port mirrors `ikcp.c` control flow (input/flush/update/
 * check/recv/send, RTT estimation, congestion window, window probing, fast
 * resend, dead-link detection) so a client built from it interoperates with the
 * C++ server without server changes.
 *
 * Deliberate deviations from the C source, all behaviour-preserving:
 *  - Segments are plain objects; the intrusive linked list is modelled with
 *    `prev`/`next` references so ordering matches `IQUEUE_*` exactly.
 *  - The output callback takes a `Uint8Array` instead of `(char*, int, user)`.
 *  - Timestamps are JS numbers masked to signed 32-bit via `| 0`, reproducing
 *    `IINT32` wraparound arithmetic.
 */

export const IKCP_RTO_NDL = 30;
export const IKCP_RTO_MIN = 100;
export const IKCP_RTO_DEF = 200;
export const IKCP_RTO_MAX = 60000;
export const IKCP_CMD_PUSH = 81;
export const IKCP_CMD_ACK = 82;
export const IKCP_CMD_WASK = 83;
export const IKCP_CMD_WINS = 84;
export const IKCP_ASK_SEND = 1;
export const IKCP_ASK_TELL = 2;
export const IKCP_WND_SND = 32;
export const IKCP_WND_RCV = 128;
export const IKCP_MTU_DEF = 1400;
export const IKCP_ACK_FAST = 3;
export const IKCP_INTERVAL = 100;
export const IKCP_OVERHEAD = 24;
export const IKCP_DEADLINK = 20;
export const IKCP_THRESH_INIT = 2;
export const IKCP_THRESH_MIN = 2;
export const IKCP_PROBE_INIT = 7000;
export const IKCP_PROBE_LIMIT = 120000;
export const IKCP_FASTACK_LIMIT = 5;

/** Signed 32-bit difference, reproducing `_itimediff`. */
function itimediff(later: number, earlier: number): number {
  return (later - earlier) | 0;
}

function bound(lower: number, value: number, upper: number): number {
  return value < lower ? lower : value > upper ? upper : value;
}

class Segment {
  /** Discriminant that keeps `QueueHead` and `Segment` structurally distinct. */
  readonly isQueueHead = false as const;

  /** Intrusive linked-list links, mirroring `struct IQUEUEHEAD`. */
  prev: QueueHead | Segment = this;
  next: QueueHead | Segment = this;

  conv = 0;
  cmd = 0;
  frg = 0;
  wnd = 0;
  ts = 0;
  sn = 0;
  una = 0;
  resendts = 0;
  rto = 0;
  fastack = 0;
  xmit = 0;
  data: Uint8Array;

  constructor(length: number) {
    this.data = new Uint8Array(length);
  }
}

/** Doubly-linked list head, mirroring `struct IQUEUEHEAD`. */
class QueueHead {
  readonly isQueueHead = true as const;
  next: QueueHead | Segment = this;
  prev: QueueHead | Segment = this;
}

function isHead(node: QueueHead | Segment): node is QueueHead {
  return node instanceof QueueHead;
}

function queueAddAfter(node: Segment, after: QueueHead | Segment): void {
  node.prev = after;
  node.next = after.next;
  after.next.prev = node;
  after.next = node;
}

function queueAddTail(node: Segment, head: QueueHead): void {
  node.prev = head.prev;
  node.next = head;
  head.prev.next = node;
  head.prev = node;
}

function queueDel(node: Segment): void {
  node.next.prev = node.prev;
  node.prev.next = node.next;
  node.prev = node;
  node.next = node;
}

function queueEmpty(head: QueueHead): boolean {
  return head.next === head;
}

function segmentsFromHead(head: QueueHead): Segment[] {
  const out: Segment[] = [];
  let node = head.next;
  while (!isHead(node)) {
    out.push(node);
    node = node.next;
  }
  return out;
}

export type KcpOutput = (data: Uint8Array, length: number) => void;

export class Kcp {
  conv: number;
  private user: unknown;
  private output: KcpOutput | null = null;

  sndUna = 0;
  sndNxt = 0;
  rcvNxt = 0;
  tsRecent = 0;
  tsLastack = 0;
  tsProbe = 0;
  probeWait = 0;
  sndWnd = IKCP_WND_SND;
  rcvWnd = IKCP_WND_RCV;
  rmtWnd = IKCP_WND_RCV;
  cwnd = 0;
  incr = 0;
  probe = 0;
  mtu = IKCP_MTU_DEF;
  mss = IKCP_MTU_DEF - IKCP_OVERHEAD;
  stream = 0;

  rxRto = IKCP_RTO_DEF;
  rxMinrto = IKCP_RTO_MIN;
  interval = IKCP_INTERVAL;
  tsFlush = IKCP_INTERVAL;
  nodelay = 0;
  updated = 0;
  ssthresh = IKCP_THRESH_INIT;
  fastresend = 0;
  fastlimit = IKCP_FASTACK_LIMIT;
  nocwnd = 0;
  xmit = 0;
  deadLink = IKCP_DEADLINK;
  state = 0;
  current = 0;

  private rxSrtt = 0;
  private rxRttval = 0;

  private readonly sndQueue = new QueueHead();
  private readonly rcvQueue = new QueueHead();
  private readonly sndBuf = new QueueHead();
  private readonly rcvBuf = new QueueHead();
  private nsndQue = 0;
  private nrcvQue = 0;
  private nsndBuf = 0;
  private nrcvBuf = 0;

  private acklistSn: number[] = [];
  private acklistTs: number[] = [];
  private ackcount = 0;

  private writeBuffer = new Uint8Array(IKCP_MTU_DEF);

  constructor(conv: number, user: unknown = null) {
    this.conv = conv >>> 0;
    this.user = user;
  }

  getUser(): unknown {
    return this.user;
  }

  setOutput(output: KcpOutput): void {
    this.output = output;
  }

  /** Port of `ikcp_nodelay`. */
  setNodelay(nodelay: number, interval: number, resend: number, nc: number): number {
    if (nodelay >= 0) {
      this.nodelay = nodelay;
      this.rxMinrto = nodelay !== 0 ? IKCP_RTO_NDL : IKCP_RTO_MIN;
    }
    if (interval >= 0) {
      let value = interval;
      if (value > 5000) {
        value = 5000;
      } else if (value < 10) {
        value = 10;
      }
      this.interval = value;
    }
    if (resend >= 0) {
      this.fastresend = resend;
    }
    if (nc >= 0) {
      this.nocwnd = nc;
    }
    return 0;
  }

  wndsize(sndwnd: number, rcvwnd: number): number {
    if (sndwnd > 0) {
      this.sndWnd = sndwnd;
    }
    if (rcvwnd > 0) {
      this.rcvWnd = Math.max(rcvwnd, IKCP_WND_RCV);
    }
    return 0;
  }

  setmtu(mtu: number): number {
    if (mtu < 50 || mtu < IKCP_OVERHEAD) {
      return -1;
    }
    this.mtu = mtu;
    this.mss = mtu - IKCP_OVERHEAD;
    return 0;
  }

  /** Number of bytes the next `recv` would return, or -1 if nothing is ready. */
  peeksize(): number {
    if (queueEmpty(this.rcvQueue)) {
      return -1;
    }
    const first = this.rcvQueue.next as Segment;
    if (first.frg === 0) {
      return first.data.length;
    }
    if (this.nrcvQue < first.frg + 1) {
      return -1;
    }
    let length = 0;
    for (const segment of segmentsFromHead(this.rcvQueue)) {
      length += segment.data.length;
      if (segment.frg === 0) {
        break;
      }
    }
    return length;
  }

  /** Queue a payload for delivery. Returns 0 on success, <0 on error. */
  send(buffer: Uint8Array, len = buffer.length): number {
    if (len <= 0) {
      return -1;
    }
    if (this.stream !== 0) {
      return this.sendStream(buffer, len);
    }
    let count: number;
    if (len <= this.mss) {
      count = 1;
    } else {
      count = Math.floor((len + this.mss - 1) / this.mss);
    }
    if (count >= IKCP_WND_RCV) {
      return -2;
    }
    if (count === 0) {
      count = 1;
    }
    let offset = 0;
    let remaining = len;
    for (let i = 0; i < count; i += 1) {
      const size = remaining > this.mss ? this.mss : remaining;
      const segment = new Segment(size);
      segment.data.set(buffer.subarray(offset, offset + size));
      segment.frg = count - i - 1;
      queueAddTail(segment, this.sndQueue);
      this.nsndQue += 1;
      offset += size;
      remaining -= size;
    }
    return 0;
  }

  private sendStream(buffer: Uint8Array, len: number): number {
    // `stream == 1` mode: append into the tail segment up to `mss`.
    let offset = 0;
    let remaining = len;
    if (this.nsndQue > 0) {
      const tail = this.sndQueue.prev as Segment;
      const capacity = this.mss - tail.data.length;
      const take = Math.min(capacity, remaining);
      if (take > 0) {
        const merged = new Uint8Array(tail.data.length + take);
        merged.set(tail.data, 0);
        merged.set(buffer.subarray(offset, offset + take), tail.data.length);
        tail.data = merged;
        offset += take;
        remaining -= take;
      }
    }
    while (remaining > 0) {
      const size = Math.min(remaining, this.mss);
      const segment = new Segment(size);
      segment.data.set(buffer.subarray(offset, offset + size));
      segment.frg = 0;
      queueAddTail(segment, this.sndQueue);
      this.nsndQue += 1;
      offset += size;
      remaining -= size;
    }
    return 0;
  }

  /** Pull one complete message. Returns the byte length, or -1/-2/-3. */
  recv(maxLength: number): Uint8Array | number {
    if (queueEmpty(this.rcvQueue)) {
      return -1;
    }
    const peeksize = this.peeksize();
    if (peeksize < 0) {
      return -2;
    }
    if (peeksize > maxLength) {
      return -3;
    }
    const output = new Uint8Array(peeksize);
    let offset = 0;
    for (;;) {
      const segment = this.rcvQueue.next as Segment;
      if (isHead(segment)) {
        break;
      }
      output.set(segment.data, offset);
      offset += segment.data.length;
      const fragment = segment.frg;
      queueDel(segment);
      this.nrcvQue -= 1;
      if (fragment === 0) {
        break;
      }
    }
    // Move any newly contiguous segments into the receive queue.
    while (!queueEmpty(this.rcvBuf) && this.nrcvQue < this.rcvWnd) {
      const segment = this.rcvBuf.next as Segment;
      if (segment.sn === this.rcvNxt) {
        queueDel(segment);
        this.nrcvBuf -= 1;
        queueAddTail(segment, this.rcvQueue);
        this.nrcvQue += 1;
        this.rcvNxt = (this.rcvNxt + 1) >>> 0;
      } else {
        break;
      }
    }
    if (this.nrcvQue < this.rcvWnd) {
      this.probe |= IKCP_ASK_TELL;
    }
    return output;
  }

  /** Feed a received datagram (possibly containing several segments). */
  input(data: Uint8Array, length = data.length): number {
    const prevUna = this.sndUna;
    let maxack = 0;
    let flag = 0;
    let offset = 0;
    let size = length;

    if (size < IKCP_OVERHEAD) {
      return -1;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    for (;;) {
      if (size < IKCP_OVERHEAD) {
        break;
      }
      const conv = view.getUint32(offset, true);
      if (conv !== this.conv) {
        return -1;
      }
      const cmd = view.getUint8(offset + 4);
      const frg = view.getUint8(offset + 5);
      const wnd = view.getUint16(offset + 6, true);
      const ts = view.getUint32(offset + 8, true);
      const sn = view.getUint32(offset + 12, true);
      const una = view.getUint32(offset + 16, true);
      const len = view.getUint32(offset + 20, true);

      offset += IKCP_OVERHEAD;
      size -= IKCP_OVERHEAD;

      if (size < len) {
        return -2;
      }
      if (
        cmd !== IKCP_CMD_PUSH &&
        cmd !== IKCP_CMD_ACK &&
        cmd !== IKCP_CMD_WASK &&
        cmd !== IKCP_CMD_WINS
      ) {
        return -3;
      }

      this.rmtWnd = wnd;
      this.parseUna(una);
      this.shrinkBuf();

      if (cmd === IKCP_CMD_ACK) {
        if (itimediff(this.current, ts) >= 0) {
          this.updateAck(itimediff(this.current, ts));
        }
        this.parseAck(sn);
        this.shrinkBuf();
        if (flag === 0) {
          flag = 1;
          maxack = sn;
        } else if (itimediff(sn, maxack) > 0) {
          maxack = sn;
        }
      } else if (cmd === IKCP_CMD_PUSH) {
        if (itimediff(sn, this.rcvNxt + this.rcvWnd) < 0) {
          this.ackPush(sn, ts);
          if (itimediff(sn, this.rcvNxt) >= 0) {
            const segment = new Segment(len);
            segment.conv = conv;
            segment.cmd = cmd;
            segment.frg = frg;
            segment.wnd = wnd;
            segment.ts = ts;
            segment.sn = sn;
            segment.una = una;
            if (len > 0) {
              segment.data.set(data.subarray(offset, offset + len));
            }
            this.parseData(segment);
          }
        }
      } else if (cmd === IKCP_CMD_WASK) {
        this.probe |= IKCP_ASK_TELL;
      }

      offset += len;
      size -= len;
    }

    if (flag !== 0) {
      this.parseFastack(maxack);
    }

    if (itimediff(this.sndUna, prevUna) > 0) {
      if (this.cwnd < this.rmtWnd) {
        const mss = this.mss;
        if (this.cwnd < this.ssthresh) {
          this.cwnd += 1;
          this.incr += mss;
        } else {
          if (this.incr < mss) {
            this.incr = mss;
          }
          this.incr += Math.floor((mss * mss) / this.incr) + Math.floor(mss / 16);
          if ((this.cwnd + 1) * mss <= this.incr) {
            this.cwnd = Math.floor((this.incr + mss - 1) / (mss > 0 ? mss : 1));
          }
        }
        if (this.cwnd > this.rmtWnd) {
          this.cwnd = this.rmtWnd;
          this.incr = this.rmtWnd * mss;
        }
      }
    }
    return 0;
  }

  update(current: number): void {
    this.current = current;
    if (this.updated === 0) {
      this.updated = 1;
      this.tsFlush = this.current;
    }
    let slap = itimediff(this.current, this.tsFlush);
    if (slap >= 10000 || slap < -10000) {
      this.tsFlush = this.current;
      slap = 0;
    }
    if (slap >= 0) {
      this.tsFlush += this.interval;
      if (itimediff(this.current, this.tsFlush) >= 0) {
        this.tsFlush = this.current + this.interval;
      }
      this.flush();
    }
  }

  /** Next time (ms) at which `update` should run. */
  check(current: number): number {
    let tsFlush = this.tsFlush;
    let tmFlush = 0x7fffffff;
    let tmPacket = 0x7fffffff;
    if (this.updated === 0) {
      return current;
    }
    if (itimediff(current, tsFlush) >= 10000 || itimediff(current, tsFlush) < -10000) {
      tsFlush = current;
    }
    if (itimediff(current, tsFlush) >= 0) {
      return current;
    }
    tmFlush = itimediff(tsFlush, current);
    for (const segment of segmentsFromHead(this.sndBuf)) {
      const diff = itimediff(segment.resendts, current);
      if (diff <= 0) {
        return current;
      }
      if (diff < tmPacket) {
        tmPacket = diff;
      }
    }
    let minimal = tmPacket < tmFlush ? tmPacket : tmFlush;
    if (minimal >= this.interval) {
      minimal = this.interval;
    }
    return current + minimal;
  }

  flush(): void {
    if (this.updated === 0) {
      return;
    }
    const current = this.current;
    let offset = 0;
    let lost = 0;
    let change = 0;

    // ACKs share a single `wnd`/`una`/`frg` prefix.
    const ackWnd = this.wndUnused();
    const ackUna = this.rcvNxt;

    // Flush queued ACKs.
    for (let i = 0; i < this.ackcount; i += 1) {
      if (offset + IKCP_OVERHEAD > this.mtu) {
        this.emit(offset);
        offset = 0;
      }
      this.encodeSegment(offset, {
        conv: this.conv,
        cmd: IKCP_CMD_ACK,
        frg: 0,
        wnd: ackWnd,
        ts: this.acklistTs[i],
        sn: this.acklistSn[i],
        una: ackUna,
        len: 0,
      });
      offset += IKCP_OVERHEAD;
    }
    this.ackcount = 0;
    this.acklistSn = [];
    this.acklistTs = [];

    // Window probing.
    if (this.rmtWnd === 0) {
      if (this.probeWait === 0) {
        this.probeWait = IKCP_PROBE_INIT;
        this.tsProbe = this.current + this.probeWait;
      } else if (itimediff(this.current, this.tsProbe) >= 0) {
        if (this.probeWait < IKCP_PROBE_INIT) {
          this.probeWait = IKCP_PROBE_INIT;
        }
        this.probeWait += Math.floor(this.probeWait / 2);
        if (this.probeWait > IKCP_PROBE_LIMIT) {
          this.probeWait = IKCP_PROBE_LIMIT;
        }
        this.tsProbe = this.current + this.probeWait;
        this.probe |= IKCP_ASK_SEND;
      }
    } else {
      this.tsProbe = 0;
      this.probeWait = 0;
    }

    if ((this.probe & IKCP_ASK_SEND) !== 0) {
      if (offset + IKCP_OVERHEAD > this.mtu) {
        this.emit(offset);
        offset = 0;
      }
      this.encodeSegment(offset, {
        conv: this.conv,
        cmd: IKCP_CMD_WASK,
        frg: 0,
        wnd: ackWnd,
        ts: 0,
        sn: 0,
        una: ackUna,
        len: 0,
      });
      offset += IKCP_OVERHEAD;
    }
    if ((this.probe & IKCP_ASK_TELL) !== 0) {
      if (offset + IKCP_OVERHEAD > this.mtu) {
        this.emit(offset);
        offset = 0;
      }
      this.encodeSegment(offset, {
        conv: this.conv,
        cmd: IKCP_CMD_WINS,
        frg: 0,
        wnd: ackWnd,
        ts: 0,
        sn: 0,
        una: ackUna,
        len: 0,
      });
      offset += IKCP_OVERHEAD;
    }
    this.probe = 0;

    // Effective congestion window.
    let cwnd = Math.min(this.sndWnd, this.rmtWnd);
    if (this.nocwnd === 0) {
      cwnd = Math.min(this.cwnd, cwnd);
    }

    // Move queued segments into the send buffer.
    while (itimediff(this.sndNxt, this.sndUna + cwnd) < 0) {
      if (queueEmpty(this.sndQueue)) {
        break;
      }
      const segment = this.sndQueue.next as Segment;
      if (isHead(segment)) {
        break;
      }
      queueDel(segment);
      this.nsndQue -= 1;
      queueAddTail(segment, this.sndBuf);
      this.nsndBuf += 1;
      segment.conv = this.conv;
      segment.cmd = IKCP_CMD_PUSH;
      segment.wnd = ackWnd;
      segment.ts = current;
      segment.sn = this.sndNxt;
      this.sndNxt = (this.sndNxt + 1) >>> 0;
      segment.una = this.rcvNxt;
      segment.resendts = current;
      segment.rto = this.rxRto;
      segment.fastack = 0;
      segment.xmit = 0;
    }

    const resent = this.fastresend > 0 ? this.fastresend : 0xffffffff;
    const rtomin = this.nodelay === 0 ? this.rxRto >> 3 : 0;

    for (const segment of segmentsFromHead(this.sndBuf)) {
      let needsend = 0;
      if (segment.xmit === 0) {
        needsend = 1;
        segment.xmit += 1;
        segment.rto = this.rxRto;
        segment.resendts = current + segment.rto + rtomin;
      } else if (itimediff(current, segment.resendts) >= 0) {
        needsend = 1;
        segment.xmit += 1;
        this.xmit += 1;
        if (this.nodelay === 0) {
          segment.rto += Math.max(segment.rto, this.rxRto);
        } else {
          const step = this.nodelay < 2 ? segment.rto : this.rxRto;
          segment.rto += Math.floor(step / 2);
        }
        segment.resendts = current + segment.rto;
        lost = 1;
      } else if (segment.fastack >= resent) {
        if (segment.xmit <= this.fastlimit || this.fastlimit <= 0) {
          needsend = 1;
          segment.xmit += 1;
          segment.fastack = 0;
          segment.resendts = current + segment.rto;
          change += 1;
        }
      }

      if (needsend !== 0) {
        segment.ts = current;
        segment.wnd = ackWnd;
        segment.una = this.rcvNxt;

        const need = IKCP_OVERHEAD + segment.data.length;
        if (offset + need > this.mtu) {
          this.emit(offset);
          offset = 0;
        }
        this.encodeSegment(offset, {
          conv: this.conv,
          cmd: segment.cmd,
          frg: segment.frg,
          wnd: segment.wnd,
          ts: segment.ts,
          sn: segment.sn,
          una: segment.una,
          len: segment.data.length,
        });
        offset += IKCP_OVERHEAD;
        if (segment.data.length > 0) {
          this.ensureWriteBuffer(offset + segment.data.length);
          this.writeBuffer.set(segment.data, offset);
          offset += segment.data.length;
        }
        if (segment.xmit >= this.deadLink) {
          this.state = 0xffffffff;
        }
      }
    }

    if (offset > 0) {
      this.emit(offset);
    }

    if (change !== 0) {
      const inflight = (this.sndNxt - this.sndUna) >>> 0;
      this.ssthresh = Math.floor(inflight / 2);
      if (this.ssthresh < IKCP_THRESH_MIN) {
        this.ssthresh = IKCP_THRESH_MIN;
      }
      this.cwnd = this.ssthresh + resent;
      this.incr = this.cwnd * this.mss;
    }

    if (lost !== 0) {
      this.ssthresh = Math.floor(cwnd / 2);
      if (this.ssthresh < IKCP_THRESH_MIN) {
        this.ssthresh = IKCP_THRESH_MIN;
      }
      this.cwnd = 1;
      this.incr = this.mss;
    }

    if (this.cwnd < 1) {
      this.cwnd = 1;
      this.incr = this.mss;
    }
  }

  private emit(length: number): void {
    if (this.output !== null && length > 0) {
      this.output(this.writeBuffer.subarray(0, length), length);
    }
  }

  private ensureWriteBuffer(size: number): void {
    if (size <= this.writeBuffer.length) {
      return;
    }
    let next = this.writeBuffer.length * 2;
    while (next < size) {
      next *= 2;
    }
    const grown = new Uint8Array(next);
    grown.set(this.writeBuffer);
    this.writeBuffer = grown;
  }

  private encodeSegment(
    offset: number,
    segment: {
      conv: number;
      cmd: number;
      frg: number;
      wnd: number;
      ts: number;
      sn: number;
      una: number;
      len: number;
    },
  ): void {
    this.ensureWriteBuffer(offset + IKCP_OVERHEAD);
    const view = new DataView(this.writeBuffer.buffer, this.writeBuffer.byteOffset, this.writeBuffer.byteLength);
    view.setUint32(offset, segment.conv >>> 0, true);
    view.setUint8(offset + 4, segment.cmd & 0xff);
    view.setUint8(offset + 5, segment.frg & 0xff);
    view.setUint16(offset + 6, segment.wnd & 0xffff, true);
    view.setUint32(offset + 8, segment.ts >>> 0, true);
    view.setUint32(offset + 12, segment.sn >>> 0, true);
    view.setUint32(offset + 16, segment.una >>> 0, true);
    view.setUint32(offset + 20, segment.len >>> 0, true);
  }

  private wndUnused(): number {
    const unused = this.rcvWnd - this.nrcvQue;
    return unused > 0 ? unused : 0;
  }

  private updateAck(rtt: number): void {
    if (this.rxSrtt === 0) {
      this.rxSrtt = rtt;
      this.rxRttval = Math.floor(rtt / 2);
    } else {
      let delta = rtt - this.rxSrtt;
      if (delta < 0) {
        delta = -delta;
      }
      this.rxRttval = Math.floor((3 * this.rxRttval + delta) / 4);
      this.rxSrtt = Math.floor((7 * this.rxSrtt + rtt) / 8);
      if (this.rxSrtt < 1) {
        this.rxSrtt = 1;
      }
    }
    const rto = this.rxSrtt + Math.max(this.interval, 4 * this.rxRttval);
    this.rxRto = bound(this.rxMinrto, rto, IKCP_RTO_MAX);
  }

  private shrinkBuf(): void {
    if (!queueEmpty(this.sndBuf)) {
      const segment = this.sndBuf.next as Segment;
      this.sndUna = segment.sn;
    } else {
      this.sndUna = this.sndNxt;
    }
  }

  private parseAck(sn: number): void {
    if (itimediff(sn, this.sndUna) < 0 || itimediff(sn, this.sndNxt) >= 0) {
      return;
    }
    for (const segment of segmentsFromHead(this.sndBuf)) {
      if (sn === segment.sn) {
        queueDel(segment);
        this.nsndBuf -= 1;
        break;
      }
      if (itimediff(sn, segment.sn) < 0) {
        break;
      }
    }
  }

  private parseUna(una: number): void {
    for (const segment of segmentsFromHead(this.sndBuf)) {
      if (itimediff(una, segment.sn) > 0) {
        queueDel(segment);
        this.nsndBuf -= 1;
      } else {
        break;
      }
    }
  }

  private parseFastack(sn: number): void {
    if (itimediff(sn, this.sndUna) < 0 || itimediff(sn, this.sndNxt) >= 0) {
      return;
    }
    for (const segment of segmentsFromHead(this.sndBuf)) {
      if (itimediff(sn, segment.sn) < 0) {
        break;
      }
      if (sn !== segment.sn) {
        segment.fastack += 1;
      }
    }
  }

  private ackPush(sn: number, ts: number): void {
    this.acklistSn.push(sn);
    this.acklistTs.push(ts);
    this.ackcount += 1;
  }

  private parseData(newseg: Segment): void {
    const sn = newseg.sn;
    if (itimediff(sn, this.rcvNxt + this.rcvWnd) >= 0 || itimediff(sn, this.rcvNxt) < 0) {
      return;
    }
    let repeat = false;
    let insertAfter: QueueHead | Segment = this.rcvBuf;
    let node = this.rcvBuf.prev;
    while (!isHead(node)) {
      const segment = node;
      if (segment.sn === sn) {
        repeat = true;
        break;
      }
      if (itimediff(sn, segment.sn) > 0) {
        insertAfter = segment;
        break;
      }
      insertAfter = segment.prev;
      node = segment.prev;
    }
    if (!repeat) {
      queueAddAfter(newseg, insertAfter);
      this.nrcvBuf += 1;
    }

    while (!queueEmpty(this.rcvBuf) && this.nrcvQue < this.rcvWnd) {
      const segment = this.rcvBuf.next as Segment;
      if (segment.sn === this.rcvNxt) {
        queueDel(segment);
        this.nrcvBuf -= 1;
        queueAddTail(segment, this.rcvQueue);
        this.nrcvQue += 1;
        this.rcvNxt = (this.rcvNxt + 1) >>> 0;
      } else {
        break;
      }
    }
  }
}

/** Reads the conv field from the head of a KCP datagram without parsing it. */
export function ikcpGetConv(data: Uint8Array): number {
  if (data.length < 4) {
    return 0;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(0, true);
}
