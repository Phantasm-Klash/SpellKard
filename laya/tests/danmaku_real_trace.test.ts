/**
 * 真实弹幕对局 golden —— C++ 权威 trace，不是合成 fixture。
 *
 * 生成（gateway，生产二进制 `build-linux/phk_danmaku_trace`）：
 *   --seed 1     --ticks 300 --ruleset ruleset-local-s0                       → danmaku_real_default.json
 *   --seed 12345 --ticks 300 --difficulty 2                                  → danmaku_real_hard.json
 *   --seed 1     --ticks 300 --ruleset tna-1.40-danmaku --boss-id boss21_tna → danmaku_real_tna_fingerprint.json
 *
 * `default` / `hard` 保留逐 tick 每颗弹的 `(bullet_id, x_milli, y_milli,
 * bullet_kind, motion_func)` + `state_hash` + 弹数；`tna` 高密度原始 trace
 * 有 50 MB，只保留密度序列与 hash 序列的 sha256 指纹（和前 120 tick 抽样）。
 *
 * ★ 这三份同时是下一阶段「差量重建器」的比对基准：客户端从 spawn 事件
 *   递推出的 `bullets[]` 必须与这里逐 tick 逐位相等，否则不能去掉全量数组。
 *   生成方向恒为 **C++ 导出、TS 断言**，不许在 TS 侧重新生成 golden。
 */

import { expect, expectEqual, suite, test } from './harness';

interface NodeFs {
  readFileSync(path: string, encoding: string): string;
}
interface NodeCrypto {
  createHash(algo: string): { update(data: string): { digest(encoding: string): string } };
}
declare const require: (id: string) => unknown;
declare const __dirname: string;

type BulletRow = [string, number, number, number, number];

interface RealTick {
  t: number;
  h: string;
  n: number;
  b?: BulletRow[];
}
interface RealGolden {
  kind: string;
  ticks: number;
  peak: number;
  mean: number;
  count_series_sha256: string;
  rows?: RealTick[];
  hash_series_sha256?: string;
  sample?: Array<{ t: number; n: number; h: string }>;
  source?: string;
}

function load(name: string): RealGolden {
  const fs = require('node:fs') as NodeFs;
  const path = `${__dirname}/../../tests/fixtures/${name}`;
  return JSON.parse(fs.readFileSync(path, 'utf8')) as RealGolden;
}

function sha256(text: string): string {
  const crypto = require('node:crypto') as NodeCrypto;
  return crypto.createHash('sha256').update(text).digest('hex');
}

const DEFAULT = load('danmaku_real_default.json');
const HARD = load('danmaku_real_hard.json');
const TNA = load('danmaku_real_tna_fingerprint.json');

/** 79 个已知 func 的 7 个编号空洞（knowledge-base/battle-server.md §运动函数）。 */
const FUNC_HOLES = new Set([9, 10, 49, 56, 59, 68, 69]);

suite('real danmaku trace golden (C++ authoritative)');

test('the default trace is a complete 300-tick authoritative run', () => {
  expectEqual(DEFAULT.kind, 'per-bullet', 'fixture kind');
  expectEqual(DEFAULT.ticks, 300, 'tick count');
  expect(DEFAULT.rows !== undefined, 'per-bullet rows are present');
  const rows = DEFAULT.rows!;
  expectEqual(rows.length, 300, 'row count');
  expectEqual(rows[0].t, 1, 'first tick is 1');
  expectEqual(rows[299].t, 300, 'last tick is 300');
  for (let i = 0; i < rows.length; i += 1) {
    expectEqual(rows[i].t, i + 1, `tick ${i} is contiguous`);
  }
});

test('every tick declares exactly as many bullets as it carries', () => {
  for (const row of DEFAULT.rows!) {
    expectEqual(row.b!.length, row.n, `tick ${row.t}: n === bullets.length`);
  }
  for (const row of HARD.rows!) {
    expectEqual(row.b!.length, row.n, `hard tick ${row.t}: n === bullets.length`);
  }
});

test('the recorded count-series sha256 still matches the real trajectory', () => {
  const counts = DEFAULT.rows!.map((row) => String(row.n)).join(',');
  expectEqual(sha256(counts), DEFAULT.count_series_sha256, 'default density series is untampered');
  const hardCounts = HARD.rows!.map((row) => String(row.n)).join(',');
  expectEqual(sha256(hardCounts), HARD.count_series_sha256, 'hard density series is untampered');
});

test('bullet ids are unique within each tick and never reused carelessly', () => {
  for (const row of DEFAULT.rows!) {
    const ids = new Set<string>();
    for (const bullet of row.b!) {
      expect(!ids.has(bullet[0]), `tick ${row.t}: duplicate id ${bullet[0]}`);
      ids.add(bullet[0]);
    }
  }
});

test('no surviving bullet teleports between two authoritative ticks', () => {
  // The real engine caps speed around 5 px/tick (5000 milli). A generous
  // 20000-milli ceiling still catches any reconstruction/jump error while
  // tolerating the boundary-reflection functions.
  const MAX_STEP_MILLI = 20000;
  let checked = 0;
  const rows = DEFAULT.rows!;
  for (let i = 1; i < rows.length; i += 1) {
    const before = new Map<string, BulletRow>();
    for (const bullet of rows[i - 1].b!) {
      before.set(bullet[0], bullet);
    }
    for (const bullet of rows[i].b!) {
      const prev = before.get(bullet[0]);
      if (prev === undefined) {
        continue;
      }
      const dx = bullet[1] - prev[1];
      const dy = bullet[2] - prev[2];
      expect(
        dx * dx + dy * dy <= MAX_STEP_MILLI * MAX_STEP_MILLI,
        `tick ${rows[i].t}: ${bullet[0]} jumped ${dx},${dy} milli`,
      );
      checked += 1;
    }
  }
  expect(checked > 1000, `trajectory continuity exercised on ${checked} bullet pairs`);
});

test('bullet kinds and motion funcs stay inside the 216-kind / 79-func contract', () => {
  for (const row of DEFAULT.rows!) {
    for (const bullet of row.b!) {
      const kind = bullet[3];
      const func = bullet[4];
      expect(kind >= 9 && kind <= 224, `tick ${row.t}: kind ${kind} in 9..224`);
      expect(func >= 0 && func <= 85, `tick ${row.t}: func ${func} in 0..85`);
      expect(!FUNC_HOLES.has(func), `tick ${row.t}: func ${func} is a known hole`);
    }
  }
});

test('state_hash is the 16-hex C++ canonical hash and evolves with the match', () => {
  const rows = DEFAULT.rows!;
  const seen = new Set<string>();
  for (const row of rows) {
    expect(/^[0-9a-f]{16}$/.test(row.h), `tick ${row.t}: hash shape`);
    seen.add(row.h);
  }
  expect(seen.size > 250, `hash actually changes across ticks (${seen.size} distinct)`);
});

test('difficulty changes density and hash, but keeps the same invariants', () => {
  expectEqual(HARD.kind, 'per-bullet', 'hard fixture kind');
  expectEqual(HARD.rows!.length, 300, 'hard tick count');
  expect(HARD.mean !== DEFAULT.mean, 'difficulty 2 changes mean density');
  expect(HARD.rows![150].h !== DEFAULT.rows![150].h, 'a different seed/difficulty changes the state hash');
});

test('the original TNA high-density fingerprint is pinned', () => {
  expectEqual(TNA.kind, 'density-fingerprint', 'fingerprint kind');
  expectEqual(TNA.ticks, 300, 'tick count');
  expectEqual(TNA.peak, 768, 'peak concurrent bullets');
  expectEqual(TNA.mean, 639.14, 'mean concurrent bullets');
  expect(/^[0-9a-f]{64}$/.test(TNA.count_series_sha256), 'count series sha256 shape');
  expect(/^[0-9a-f]{64}$/.test(TNA.hash_series_sha256!), 'hash series sha256 shape');
  expectEqual(TNA.sample!.length, 120, 'sample rows retained');
  expect(TNA.mean / DEFAULT.mean > 20, 'original TNA density is >20x the live 10-pattern library');
});
