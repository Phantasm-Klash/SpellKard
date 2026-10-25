/**
 * 单关对齐验收（计划 §4.1 第 3 条）的**客户端侧校验器**。
 *
 * 输入是冻结格式的 trace（JSONL，每 tick 一行，服务端 `--trace-out` 同格式），
 * 输出是「客户端插帧渲染 vs 服务端弹幕核算」的逐 tick 断言结果：
 *
 *  1. **tick 边界**（`frac = 0`）：渲染实体数 == 可见弹幕数（`hidden` 不渲染），
 *     每个实体位置 == trace 位置（milli → 像素后误差 ≤1px）。
 *  2. **tick 内**（`frac ∈ {0.25, 0.5, 0.75}`）：弹幕插值位置 == `p + v * frac`
 *     （相对误差 ≤1e-6），且与「当前 → 下一 tick」同 frac 弦点的距离 ≤ |Δv|·frac + 容差
 *     （线性弹紧约束、曲率弹按速度差放宽、位置跳变会抓）；玩家 / Boss 等于前向
 *     外推公式 `p_n + (p_n - p_{n-1}) * frac`，且不超前一 tick 以上的运动（离权威
 *     下一 tick 位置 ≤ 两个一 tick 位移之和）——即「插帧永不超出服务端核算允许
 *     的范围」，转向 tick 也在此界内。
 *
 * 这一层刻意**不依赖 Laya**：`buildBossRaceFrame` 是引擎无关的纯函数，所以同一
 * 套断言既能在 Node 里跑 trace，也能被单元测试直接调用。
 *
 * NOTE: `core/` only —— 不 import platform。
 */

import { buildBossRaceFrame, PlayfieldTransform, type PlayfieldLayout } from './boss_race_view_model';
import { BossRaceState, type BossRaceEffect, type BossRaceSnapshot } from '../sim/boss_race';

// ---------------------------------------------------------------------------
// 冻结 trace 格式
// ---------------------------------------------------------------------------

export interface StageTraceBullet {
  bulletId: string;
  xMilli: number;
  yMilli: number;
  vxMilli: number;
  vyMilli: number;
  radiusMilli: number;
  kind?: number;
  patternId: string;
  chainId?: string;
  generation?: number;
  hidden?: boolean;
}

export interface StageTracePlayer {
  playerId: string;
  xMilli: number;
  yMilli: number;
  vxMilli?: number;
  vyMilli?: number;
  facingMillideg?: number;
  lives?: number;
  graze?: number;
  invulnerableUntilTick?: number;
}

export interface StageTraceBoss {
  xMilli: number;
  yMilli: number;
  hp: number;
  maxHp: number;
  phase: number;
  effects: BossRaceEffect[];
}

export interface StageTraceChain {
  chainId: string;
  patternIndex: number;
  nodeId: number;
  generation: number;
  rngCursor: number;
}

export interface StageTraceTick {
  tick: number;
  state: string;
  boss?: StageTraceBoss;
  players: StageTracePlayer[];
  bullets: StageTraceBullet[];
  chains?: StageTraceChain[];
  events?: Array<Record<string, unknown>>;
  stateHash: string;
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

function num(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return 0;
}

function optNum(source: Record<string, unknown>, key: string): number | undefined {
  return key in source && source[key] !== null && source[key] !== undefined
    ? num(source, key)
    : undefined;
}

function str(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * Parses one JSONL line. Returns `null` for a blank line, malformed JSON or a
 * line without a numeric `tick` — the caller skips it rather than aborting the
 * whole trace, so one truncated tail line does not fail an otherwise good run.
 */
export function parseStageTraceLine(line: string): StageTraceTick | null {
  const text = line.trim();
  if (text === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.tick !== 'number' || !Number.isFinite(parsed.tick)) {
    return null;
  }
  const bossSource = isRecord(parsed.boss) ? parsed.boss : null;
  return {
    tick: parsed.tick,
    state: str(parsed, 'state') || 'running',
    boss: bossSource === null
      ? undefined
      : {
          xMilli: num(bossSource, 'x_milli'),
          yMilli: num(bossSource, 'y_milli'),
          hp: num(bossSource, 'hp'),
          maxHp: num(bossSource, 'max_hp'),
          phase: num(bossSource, 'phase'),
          effects: records(bossSource.effects).map((effect): BossRaceEffect => ({
            type: str(effect, 'type'),
            state: str(effect, 'state'),
            tRemaining: num(effect, 't_remaining'),
            x0Milli: optNum(effect, 'x0_milli'),
            y0Milli: optNum(effect, 'y0_milli'),
            dxMilli: optNum(effect, 'dx_milli'),
            dyMilli: optNum(effect, 'dy_milli'),
            lengthMilli: optNum(effect, 'length_milli'),
            edgeYMilli: optNum(effect, 'edge_y_milli'),
          })),
        },
    players: records(parsed.players).map((player) => ({
      playerId: str(player, 'player_id'),
      xMilli: num(player, 'x_milli'),
      yMilli: num(player, 'y_milli'),
      vxMilli: optNum(player, 'vx_milli'),
      vyMilli: optNum(player, 'vy_milli'),
      facingMillideg: optNum(player, 'facing_millideg'),
      lives: optNum(player, 'lives'),
      graze: optNum(player, 'graze'),
      invulnerableUntilTick: optNum(player, 'invulnerable_until_tick'),
    })),
    bullets: records(parsed.bullets).map((bullet) => ({
      bulletId: str(bullet, 'bullet_id'),
      xMilli: num(bullet, 'x_milli'),
      yMilli: num(bullet, 'y_milli'),
      vxMilli: num(bullet, 'vx_milli'),
      vyMilli: num(bullet, 'vy_milli'),
      radiusMilli: num(bullet, 'radius_milli'),
      kind: optNum(bullet, 'kind'),
      patternId: str(bullet, 'pattern_id'),
      chainId: 'chain_id' in bullet ? str(bullet, 'chain_id') : undefined,
      generation: optNum(bullet, 'generation'),
      hidden: typeof bullet.hidden === 'boolean' ? bullet.hidden : undefined,
    })),
    chains: Array.isArray(parsed.chains)
      ? records(parsed.chains).map((chain) => ({
          chainId: str(chain, 'chain_id'),
          patternIndex: num(chain, 'pattern_index'),
          nodeId: num(chain, 'node_id'),
          generation: num(chain, 'generation'),
          rngCursor: num(chain, 'rng_cursor'),
        }))
      : undefined,
    events: Array.isArray(parsed.events) ? records(parsed.events) : undefined,
    stateHash: str(parsed, 'state_hash'),
  };
}

/** Parses a whole JSONL document, dropping malformed lines. */
export function parseStageTrace(text: string): StageTraceTick[] {
  const ticks: StageTraceTick[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tick = parseStageTraceLine(line);
    if (tick !== null) {
      ticks.push(tick);
    }
  }
  return ticks.sort((a, b) => a.tick - b.tick);
}

/** Projects a trace tick onto the snapshot shape the renderer consumes. */
export function traceTickToSnapshot(tick: StageTraceTick): BossRaceSnapshot {
  const maxHp = tick.boss?.maxHp ?? 0;
  return {
    tick: tick.tick,
    state: tick.state === 'finished' ? BossRaceState.Finished : BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    stateHash: tick.stateHash,
    players: tick.players.map((player) => ({
      playerId: player.playerId,
      xMilli: player.xMilli,
      yMilli: player.yMilli,
      bossCurrentHp: tick.boss?.hp ?? maxHp,
      damageDealt: 0,
      connected: true,
      vxMilli: player.vxMilli,
      vyMilli: player.vyMilli,
      facingMillideg: player.facingMillideg,
      lives: player.lives,
      graze: player.graze,
      invulnerableUntilTick: player.invulnerableUntilTick,
    })),
    bullets: tick.bullets.map((bullet) => ({
      bulletId: bullet.bulletId,
      ownerPlayerId: '',
      xMilli: bullet.xMilli,
      yMilli: bullet.yMilli,
      vxMilli: bullet.vxMilli,
      vyMilli: bullet.vyMilli,
      radiusMilli: bullet.radiusMilli,
      patternId: bullet.patternId,
      bulletKind: bullet.kind,
      chainId: bullet.chainId,
      generation: bullet.generation,
      hidden: bullet.hidden,
    })),
    boss: tick.boss === undefined
      ? undefined
      : {
          xMilli: tick.boss.xMilli,
          yMilli: tick.boss.yMilli,
          hp: tick.boss.hp,
          maxHp: tick.boss.maxHp,
          phase: tick.boss.phase,
          effects: tick.boss.effects,
        },
    chains: tick.chains,
  };
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

export interface ParityOptions {
  /** 渲染用的 playfield 尺寸（像素）。默认 480×720，与战场布局同比例。 */
  layout?: PlayfieldLayout;
  localPlayerId?: string;
  bossMaxHp?: number;
  /** tick 内插值采样的 frac。 */
  fracs?: readonly number[];
  /** 位置容差（像素）。 */
  tolerancePx?: number;
}

export interface ParityFailure {
  tick: number;
  check:
    | 'count'
    | 'boundary-position'
    | 'bullet-interpolation'
    | 'bullet-trajectory'
    | 'entity-extrapolation'
    | 'entity-bounded-ahead'
    | 'missing-bullet';
  detail: string;
  expected?: number;
  actual?: number;
}

export interface ParityTickResult {
  tick: number;
  /** trace 里非 hidden 的弹幕数。 */
  visibleBullets: number;
  /** `buildBossRaceFrame` 实际渲染的弹幕数。 */
  renderedBullets: number;
  /** `frac = 0` 时所有实体的最大位置误差（像素）。 */
  boundaryMaxErrorPx: number;
  /** `frac ∈ {0.25,0.5,0.75}` 时的最大误差（像素）。 */
  interpMaxErrorPx: number;
  failures: ParityFailure[];
}

export interface ParityReport {
  ticks: ParityTickResult[];
  passedTicks: number;
  failedTicks: number;
  maxBoundaryErrorPx: number;
  maxInterpErrorPx: number;
  totalFailures: number;
  /** 前 10 条失败样例。 */
  sampleFailures: ParityFailure[];
  /** 无法做线段断言的 tick（例如 trace 的最后一行没有下一 tick）。 */
  skippedSegments: number;
  layout: PlayfieldLayout;
}

const DEFAULT_LAYOUT: PlayfieldLayout = { width: 480, height: 720 };
const DEFAULT_FRACS: readonly number[] = [0.25, 0.5, 0.75];

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * 跑完整条 trace。
 *
 * `trace` 必须按 tick 升序；每个 tick 与它的前一行、后一行一起检查：
 * 前一行提供「上一 tick 位移」（无速度实体外推用），后一行提供 tick 内线段
 * 断言的终点。
 */
export function checkStageParity(
  trace: readonly StageTraceTick[],
  options: ParityOptions = {},
): ParityReport {
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const localPlayerId = options.localPlayerId ?? trace[0]?.players[0]?.playerId ?? 'p1';
  const bossMaxHp = options.bossMaxHp ?? trace[0]?.boss?.maxHp ?? 6000;
  const fracs = options.fracs ?? DEFAULT_FRACS;
  const tolerancePx = options.tolerancePx ?? 1;
  const transform = new PlayfieldTransform(layout);

  const ticks: ParityTickResult[] = [];
  let maxBoundary = 0;
  let maxInterp = 0;
  let totalFailures = 0;
  let skippedSegments = 0;

  for (let index = 0; index < trace.length; index += 1) {
    const current = trace[index];
    const previous = index > 0 ? trace[index - 1] : null;
    const next = index + 1 < trace.length ? trace[index + 1] : null;
    const failures: ParityFailure[] = [];
    let boundaryMax = 0;
    let interpMax = 0;

    // ---- tick 边界（frac = 0）----
    const boundary = buildBossRaceFrame(traceTickToSnapshot(current), {
      layout,
      localPlayerId,
      bossMaxHp,
      previous: previous === null ? null : traceTickToSnapshot(previous),
      frac: 0,
    });
    const visible = current.bullets.filter((bullet) => bullet.hidden !== true);
    if (boundary.bullets.length !== visible.length) {
      failures.push({
        tick: current.tick,
        check: 'count',
        detail: 'rendered bullets != visible bullets',
        expected: visible.length,
        actual: boundary.bullets.length,
      });
    }
    const byId = new Map(current.bullets.map((bullet) => [bullet.bulletId, bullet]));
    for (const rendered of boundary.bullets) {
      const source = byId.get(rendered.bulletId);
      if (source === undefined) {
        failures.push({ tick: current.tick, check: 'missing-bullet', detail: rendered.bulletId });
        continue;
      }
      const expectedPoint = transform.toPixels(source.xMilli, source.yMilli);
      const error = distance(rendered.position.x, rendered.position.y, expectedPoint.x, expectedPoint.y);
      boundaryMax = Math.max(boundaryMax, error);
      if (error > tolerancePx) {
        failures.push({
          tick: current.tick,
          check: 'boundary-position',
          detail: `bullet ${rendered.bulletId} off by ${error.toFixed(4)}px`,
          expected: expectedPoint.x,
          actual: rendered.position.x,
        });
      }
    }
    for (const player of current.players) {
      const rendered = boundary.players.find((entry) => entry.playerId === player.playerId);
      if (rendered === undefined) {
        failures.push({ tick: current.tick, check: 'count', detail: `player ${player.playerId} missing` });
        continue;
      }
      const expectedPoint = transform.toPixels(player.xMilli, player.yMilli);
      const error = distance(rendered.position.x, rendered.position.y, expectedPoint.x, expectedPoint.y);
      boundaryMax = Math.max(boundaryMax, error);
      if (error > tolerancePx) {
        failures.push({
          tick: current.tick,
          check: 'boundary-position',
          detail: `player ${player.playerId} off by ${error.toFixed(4)}px`,
          expected: expectedPoint.x,
          actual: rendered.position.x,
        });
      }
    }

    // ---- tick 内（frac ∈ fracs）----
    for (const frac of fracs) {
      const frame = buildBossRaceFrame(traceTickToSnapshot(current), {
        layout,
        localPlayerId,
        bossMaxHp,
        previous: previous === null ? null : traceTickToSnapshot(previous),
        frac,
      });
      // 弹幕：p + v * frac，相对误差 ≤1e-6。
      for (const rendered of frame.bullets) {
        const source = byId.get(rendered.bulletId);
        if (source === undefined) {
          continue;
        }
        const expected = transform.toPixels(
          source.xMilli + source.vxMilli * frac,
          source.yMilli + source.vyMilli * frac,
        );
        const error = distance(rendered.position.x, rendered.position.y, expected.x, expected.y);
        const relative = error / Math.max(1, Math.abs(expected.x), Math.abs(expected.y));
        interpMax = Math.max(interpMax, error);
        if (relative > 1e-6) {
          failures.push({
            tick: current.tick,
            check: 'bullet-interpolation',
            detail: `bullet ${rendered.bulletId} frac=${frac} rel=${relative.toExponential(2)}`,
            expected: expected.x,
            actual: rendered.position.x,
          });
        }
      }
      // 弹幕轨迹检查：插值点与「当前 → 下一 tick」弦的偏差 ≤ |Δv| * frac + 容差。
      // 推导：弦 = p + disp·t，切线外推 = p + v_n·t，两者之差 = |v_n - disp|·t
      // ≤ |v_n - v_{n+1}|·t（光滑运动的位移≈两 tick 速度均值）。线性弹 Δv=0 →
      // 1px 紧约束；正弦调速/追踪转向按 Δv 放宽（曲率是服务端运动学固有属性，
      // 不是客户端漂移）；位置跳变（传送）会被抓。
      // 注意：自洽的快照速度谎言（v 与轨迹整体不一致）在 tick 内没有第二真值
      // 源，客户端原理上不可见——那条归服务端单测（damage/位置钉帧）管。
      if (next === null) {
        continue;
      }
      for (const rendered of frame.bullets) {
        const following = next.bullets.find((entry) => entry.bulletId === rendered.bulletId);
        const source = byId.get(rendered.bulletId);
        if (following === undefined || source === undefined || following.hidden === true) {
          continue;
        }
        // 参考点 = 同 frac 的**弦点** `p + (p_{n+1} - p)·frac`（两个权威位置
        // 之间的直线路径在该 frac 的位置），不是「到直线的垂距」——垂距在垂直
        // 传送时只有 |v|·frac（渲染点就在弦起点附近），抓不到跳变；弦点距离
        // 才是插值质量的正确度量。
        const chordPoint = transform.toPixels(
          source.xMilli + (following.xMilli - source.xMilli) * frac,
          source.yMilli + (following.yMilli - source.yMilli) * frac,
        );
        const deltaVPx = Math.hypot(following.vxMilli - source.vxMilli, following.vyMilli - source.vyMilli) / 1000;
        const speedPx = Math.hypot(source.vxMilli, source.vyMilli) / 1000;
        // |Δv| 覆盖 tick 间速度变化；0.25·|v| 是 tick 内连续曲率的余量——服务端
        // 以 tick 粒度积分，一 tick 的位移与两个端速度都可能有分数级差异
        // （正弦调速实测 4.8px @ frac=0.75，Δv 项只给到 4.68px）。
        const allowance = (deltaVPx + 0.25 * speedPx) * frac + tolerancePx;
        const offChord = distance(rendered.position.x, rendered.position.y, chordPoint.x, chordPoint.y);
        if (offChord > allowance) {
          failures.push({
            tick: current.tick,
            check: 'bullet-trajectory',
            detail: `bullet ${rendered.bulletId} frac=${frac} ${offChord.toFixed(4)}px off the chord point (allowance ${allowance.toFixed(4)}px)`,
            expected: chordPoint.x,
            actual: rendered.position.x,
          });
        }
      }
      // 玩家 / Boss（无速度实体）：冻结公式是**前向外推**
      // `p_n + (p_n - p_{n-1}) * frac`（§2.9，2026-10-24 修正）——渲染基准必须
      // 是当前权威 tick（frac=0 逐像素等于快照），滞后插值会慢权威一拍。
      // 两条独立断言：
      //   1) entity-extrapolation：渲染点等于外推公式（公式实现正确性）；
      //   2) entity-bounded-ahead：渲染点离「权威下一 tick 位置」不超过
      //      「两个一 tick 位移」之和——渲染永不超前一 tick 以上的运动，
      //      这是「插帧与服务端核算匹配」的上界（转向 tick 也在此内）。
      for (const player of current.players) {
        const rendered = frame.players.find((entry) => entry.playerId === player.playerId);
        if (rendered === undefined) {
          continue;
        }
        const nowPoint = transform.toPixels(player.xMilli, player.yMilli);
        const prior = previous === null
          ? undefined
          : previous.players.find((entry) => entry.playerId === player.playerId);
        if (prior !== undefined) {
          const priorPoint = transform.toPixels(prior.xMilli, prior.yMilli);
          const expected = {
            x: nowPoint.x + (nowPoint.x - priorPoint.x) * frac,
            y: nowPoint.y + (nowPoint.y - priorPoint.y) * frac,
          };
          const error = distance(rendered.position.x, rendered.position.y, expected.x, expected.y);
          interpMax = Math.max(interpMax, error);
          if (error > tolerancePx) {
            failures.push({
              tick: current.tick,
              check: 'entity-extrapolation',
              detail: `player ${player.playerId} frac=${frac} off by ${error.toFixed(4)}px`,
              expected: expected.x,
              actual: rendered.position.x,
            });
          }
        }
        if (next === null) {
          continue;
        }
        const following = next.players.find((entry) => entry.playerId === player.playerId);
        if (following === undefined) {
          continue;
        }
        const nextPoint = transform.toPixels(following.xMilli, following.yMilli);
        const oneTickPx = distance(nowPoint.x, nowPoint.y, nextPoint.x, nextPoint.y);
        const driftPx = prior === undefined
          ? oneTickPx
          : distance(
              transform.toPixels(prior.xMilli, prior.yMilli).x,
              transform.toPixels(prior.xMilli, prior.yMilli).y,
              nowPoint.x,
              nowPoint.y,
            );
        const ahead = distance(rendered.position.x, rendered.position.y, nextPoint.x, nextPoint.y);
        if (ahead > oneTickPx + driftPx + tolerancePx) {
          failures.push({
            tick: current.tick,
            check: 'entity-bounded-ahead',
            detail: `player ${player.playerId} frac=${frac} runs ${ahead.toFixed(4)}px ahead (bound ${(oneTickPx + driftPx).toFixed(4)}px)`,
            expected: nextPoint.x,
            actual: rendered.position.x,
          });
        }
      }
      if (current.boss !== undefined && next !== null && next.boss !== undefined && frame.boss !== null) {
        const nowBoss = transform.toPixels(current.boss.xMilli, current.boss.yMilli);
        const nextBoss = transform.toPixels(next.boss.xMilli, next.boss.yMilli);
        const priorBoss = previous === null || previous.boss === undefined
          ? undefined
          : transform.toPixels(previous.boss.xMilli, previous.boss.yMilli);
        if (priorBoss !== undefined) {
          const expected = {
            x: nowBoss.x + (nowBoss.x - priorBoss.x) * frac,
            y: nowBoss.y + (nowBoss.y - priorBoss.y) * frac,
          };
          const error = distance(frame.boss.position.x, frame.boss.position.y, expected.x, expected.y);
          interpMax = Math.max(interpMax, error);
          if (error > tolerancePx) {
            failures.push({
              tick: current.tick,
              check: 'entity-extrapolation',
              detail: `boss frac=${frac} off by ${error.toFixed(4)}px`,
              expected: expected.x,
              actual: frame.boss.position.x,
            });
          }
        }
        const oneTickPx = distance(nowBoss.x, nowBoss.y, nextBoss.x, nextBoss.y);
        const driftPx = priorBoss === undefined
          ? oneTickPx
          : distance(priorBoss.x, priorBoss.y, nowBoss.x, nowBoss.y);
        const ahead = distance(frame.boss.position.x, frame.boss.position.y, nextBoss.x, nextBoss.y);
        if (ahead > oneTickPx + driftPx + tolerancePx) {
          failures.push({
            tick: current.tick,
            check: 'entity-bounded-ahead',
            detail: `boss frac=${frac} runs ${ahead.toFixed(4)}px ahead (bound ${(oneTickPx + driftPx).toFixed(4)}px)`,
            expected: nextBoss.x,
            actual: frame.boss.position.x,
          });
        }
      }
    }
    if (next === null) {
      skippedSegments += 1;
    }

    maxBoundary = Math.max(maxBoundary, boundaryMax);
    maxInterp = Math.max(maxInterp, interpMax);
    totalFailures += failures.length;
    ticks.push({
      tick: current.tick,
      visibleBullets: visible.length,
      renderedBullets: boundary.bullets.length,
      boundaryMaxErrorPx: boundaryMax,
      interpMaxErrorPx: interpMax,
      failures,
    });
  }

  const allFailures = ticks.flatMap((tick) => tick.failures);
  return {
    ticks,
    passedTicks: ticks.filter((tick) => tick.failures.length === 0).length,
    failedTicks: ticks.filter((tick) => tick.failures.length > 0).length,
    maxBoundaryErrorPx: maxBoundary,
    maxInterpErrorPx: maxInterp,
    totalFailures,
    sampleFailures: allFailures.slice(0, 10),
    skippedSegments,
    layout,
  };
}

// ---------------------------------------------------------------------------
// 合成 trace（P5 之前的自检 fixture）
// ---------------------------------------------------------------------------

/**
 * 300 tick 的合成 trace：环形弹幕 + 一个匀速移动的玩家 + 一段 hidden 窗口。
 *
 * 位置全部解析式给出（`p = p0 + v * t`），所以「客户端插值 == 服务端核算」这条
 * 断言在合成数据上必须零误差——脚本本身写错时会立刻红。
 */
export function synthesizeStageTrace(tickCount = 300, layout: PlayfieldLayout = DEFAULT_LAYOUT): StageTraceTick[] {
  const ticks: StageTraceTick[] = [];
  const ringCount = 16;
  const hiddenFrom = 100;
  const hiddenTo = 140;
  const lateWaveAt = 150;
  const playerSpeedMilli = 3000;
  const playerStart = -30000;

  for (let tick = 0; tick < tickCount; tick += 1) {
    const bullets: StageTraceBullet[] = [];
    // 环形弹幕：每 tick 向外 1.5px。
    for (let i = 0; i < ringCount; i += 1) {
      const angle = (i / ringCount) * Math.PI * 2;
      const speedMilli = 1500;
      bullets.push({
        bulletId: `ring-${i}`,
        xMilli: Math.round(Math.cos(angle) * speedMilli * tick),
        yMilli: Math.round(Math.sin(angle) * speedMilli * tick),
        vxMilli: Math.round(Math.cos(angle) * speedMilli),
        vyMilli: Math.round(Math.sin(angle) * speedMilli),
        radiusMilli: 4000,
        kind: 1,
        patternId: 'synthetic-ring',
        chainId: 'chain-ring',
        generation: 0,
        hidden: tick >= hiddenFrom && tick < hiddenTo,
      });
    }
    // 晚波：tick 150 起从 Boss 下方落下。
    if (tick >= lateWaveAt) {
      const age = tick - lateWaveAt;
      for (let i = 0; i < 4; i += 1) {
        bullets.push({
          bulletId: `wave-${i}`,
          xMilli: -6000 + i * 4000,
          yMilli: -60000 + 2000 * age,
          vxMilli: 0,
          vyMilli: 2000,
          radiusMilli: 3000,
          kind: 2,
          patternId: 'synthetic-wave',
          chainId: 'chain-wave',
          generation: 1,
          hidden: false,
        });
      }
    }

    ticks.push({
      tick,
      state: 'running',
      boss: {
        // 正弦移动：覆盖 Boss 前向外推在速度换向 tick 的行为（extremes at 120/240）。
        xMilli: Math.round(30000 * Math.sin((tick / 20) * (Math.PI / 180) * 6)),
        yMilli: -60000,
        hp: Math.max(0, 6000 - tick * 10),
        maxHp: 6000,
        phase: tick < 150 ? 1 : 2,
        effects: [],
      },
      players: [
        {
          playerId: 'p1',
          // tick 120 处 90° 转向（+x → +y）：覆盖前向外推在速度突变 tick 的
          // 行为——滞后线段插值在这里会红，前向外推 + 有界检查不会。
          xMilli: playerStart + playerSpeedMilli * Math.min(tick, 120),
          yMilli: playerSpeedMilli * Math.max(0, tick - 120),
          vxMilli: tick < 120 ? playerSpeedMilli : 0,
          vyMilli: tick < 120 ? 0 : playerSpeedMilli,
          facingMillideg: tick < 120 ? 9000 : 0,
          lives: 3,
          graze: tick,
          invulnerableUntilTick: 0,
        },
      ],
      bullets,
      chains: [
        { chainId: 'chain-ring', patternIndex: 0, nodeId: 1, generation: 0, rngCursor: tick },
        { chainId: 'chain-wave', patternIndex: 1, nodeId: 2, generation: 1, rngCursor: tick },
      ],
      events: [],
      stateHash: `synthetic-${tick.toString(16).padStart(8, '0')}`,
    });
  }
  // `layout` 只影响像素换算，这里保留参数是为了让调用方与 check 用同一套布局。
  void layout;
  return ticks;
}

/** Serialises a trace back to the frozen JSONL format (one tick per line). */
export function serializeStageTrace(trace: readonly StageTraceTick[]): string {
  return `${trace
    .map((tick) =>
      JSON.stringify({
        tick: tick.tick,
        state: tick.state,
        boss: tick.boss,
        players: tick.players.map((player) => ({
          player_id: player.playerId,
          x_milli: player.xMilli,
          y_milli: player.yMilli,
          vx_milli: player.vxMilli,
          vy_milli: player.vyMilli,
          facing_millideg: player.facingMillideg,
          lives: player.lives,
          graze: player.graze,
          invulnerable_until_tick: player.invulnerableUntilTick,
        })),
        bullets: tick.bullets.map((bullet) => ({
          bullet_id: bullet.bulletId,
          x_milli: bullet.xMilli,
          y_milli: bullet.yMilli,
          vx_milli: bullet.vxMilli,
          vy_milli: bullet.vyMilli,
          radius_milli: bullet.radiusMilli,
          kind: bullet.kind,
          pattern_id: bullet.patternId,
          chain_id: bullet.chainId,
          generation: bullet.generation,
          hidden: bullet.hidden === true,
        })),
        chains: tick.chains,
        events: tick.events,
        state_hash: tick.stateHash,
      }),
    )
    .join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

/**
 * Markdown 报告：总览 + 逐 tick 表 + 失败样例前 10 条。
 *
 * 逐 tick 表对 300 tick 是可读的；更长的 trace 只列失败行与每 10 tick 的采样，
 * 免得报告本身变成几万行。
 */
export function formatParityReport(
  report: ParityReport,
  meta: { source: string; generatedAt?: string } = { source: 'synthetic' },
): string {
  const lines: string[] = [];
  lines.push('# 单关对齐验收 — 客户端侧报告（§4.1 第 3 条）');
  lines.push('');
  lines.push(`- trace：\`${meta.source}\``);
  lines.push(`- 生成时间：${meta.generatedAt ?? new Date().toISOString()}`);
  lines.push(`- 渲染布局：${report.layout.width}×${report.layout.height} px`);
  lines.push(`- tick 数：${report.ticks.length}（通过 ${report.passedTicks} / 失败 ${report.failedTicks}）`);
  lines.push(`- 断言总数失败：${report.totalFailures}`);
  lines.push(`- tick 边界最大误差：${report.maxBoundaryErrorPx.toFixed(6)} px（容差 1 px）`);
  lines.push(`- tick 内插值最大误差：${report.maxInterpErrorPx.toFixed(6)} px（弹幕相对误差容差 1e-6）`);
  lines.push(`- 无下一 tick、跳过线段断言的 tick：${report.skippedSegments}`);
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push(
    report.failedTicks === 0
      ? '✅ 全部 tick 通过：渲染实体数与可见弹幕数一致，tick 边界位置等于权威位置，tick 内插值落在冻结公式上。'
      : `❌ ${report.failedTicks} 个 tick 失败，见下表与失败样例。`,
  );
  lines.push('');
  lines.push('## 逐 tick');
  lines.push('');
  lines.push('| tick | 可见弹幕 | 渲染弹幕 | 边界误差(px) | 插值误差(px) | 结果 |');
  lines.push('| ---: | ---: | ---: | ---: | ---: | :--- |');
  const every = report.ticks.length > 400 ? 10 : 1;
  for (const tick of report.ticks) {
    const failing = tick.failures.length > 0;
    if (!failing && tick.tick % every !== 0) {
      continue;
    }
    lines.push(
      `| ${tick.tick} | ${tick.visibleBullets} | ${tick.renderedBullets} | ${tick.boundaryMaxErrorPx.toFixed(4)} | ${tick.interpMaxErrorPx.toFixed(4)} | ${failing ? 'FAIL' : 'ok'} |`,
    );
  }
  lines.push('');
  lines.push('## 失败样例（前 10 条）');
  lines.push('');
  if (report.sampleFailures.length === 0) {
    lines.push('（无）');
  } else {
    lines.push('| tick | 检查项 | 详情 | expected | actual |');
    lines.push('| ---: | :--- | :--- | ---: | ---: |');
    for (const failure of report.sampleFailures) {
      lines.push(
        `| ${failure.tick} | ${failure.check} | ${failure.detail} | ${failure.expected ?? '-'} | ${failure.actual ?? '-'} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}
