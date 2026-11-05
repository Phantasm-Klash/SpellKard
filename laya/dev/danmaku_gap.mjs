/**
 * 实战 vs 原 TNA 弹幕效果差距量化。
 *
 * 消费服务端 `phk_danmaku_trace` 导出的逐 tick JSONL（每 tick 一份权威状态），
 * 从 `bullets[]` 直接量出密度、速度、效果三类指标。不启动浏览器、不起服务器，
 * 也不跑引擎渲染——度量的是**权威状态本身**，这样"差距"不是截图观感。
 *
 * 用法：
 *   node dev/danmaku_gap.mjs <trace.jsonl> [<trace.jsonl> ...]
 *   node dev/danmaku_gap.mjs --out docs/danmaku-gap.md <trace.jsonl> ...
 *
 * 每条 trace 一行；可选 `--window N` 把所有 trace 截到同一 tick 数再比较
 * （trace 长度不同，不截会让累计量失去可比性）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

// ---------------------------------------------------------------------------
// 度量
// ---------------------------------------------------------------------------

/** 百分比分位（输入已排序）。 */
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** 弹速幅值，单位 px/tick（trace 里是 milli/tick）。 */
function speedPx(bullet) {
  const vx = Number(bullet.vx_milli ?? 0);
  const vy = Number(bullet.vy_milli ?? 0);
  return Math.hypot(vx, vy) / 1000;
}

function bulletId(bullet) {
  return String(bullet.bullet_id ?? `${bullet.x_milli}:${bullet.y_milli}:${bullet.pattern_id ?? ''}`);
}

function bulletKind(bullet) {
  return bullet.bullet_kind ?? bullet.kind ?? 'unset';
}

function measure(path, windowTicks) {
  const lines = readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim() !== '');
  const frames = lines.map((l) => JSON.parse(l));
  if (windowTicks > 0) frames.length = Math.min(frames.length, windowTicks);

  const counts = [];
  const speeds = [];
  const radii = [];
  const kinds = new Set();
  const motions = new Set();
  const patterns = new Set();
  const seen = new Set();
  const spawnPerTick = [];
  let spawnTicks = 0;
  let totalSpawned = 0;
  let cappedTicks = 0;

  for (const frame of frames) {
    const bullets = Array.isArray(frame.bullets) ? frame.bullets : [];
    counts.push(bullets.length);
    if (bullets.length >= 768) cappedTicks += 1; // 服务端 kMaxBullets / 玩家

    let fresh = 0;
    for (const b of bullets) {
      const id = bulletId(b);
      if (!seen.has(id)) {
        seen.add(id);
        fresh += 1;
      }
      const s = speedPx(b);
      if (Number.isFinite(s) && s > 0) speeds.push(s);
      const r = Number(b.radius_milli ?? 0) / 1000;
      if (Number.isFinite(r) && r > 0) radii.push(r);
      kinds.add(String(bulletKind(b)));
      if (b.motion_func !== undefined) motions.add(String(b.motion_func));
      if (b.pattern_id !== undefined && b.pattern_id !== '') patterns.add(String(b.pattern_id));
    }
    spawnPerTick.push(fresh);
    totalSpawned += fresh;
    if (fresh > 0) spawnTicks += 1;
  }

  speeds.sort((a, b) => a - b);
  const nonzeroSpawns = spawnPerTick.filter((n) => n > 0).sort((a, b) => a - b);

  return {
    file: basename(path),
    ticks: frames.length,
    avgOnScreen: mean(counts),
    peakOnScreen: counts.length ? Math.max(...counts) : 0,
    p95OnScreen: quantile([...counts].sort((a, b) => a - b), 0.95),
    totalSpawned,
    spawnTicks,
    avgSpawnPerActiveTick: mean(nonzeroSpawns),
    peakSpawnPerTick: nonzeroSpawns.length ? Math.max(...nonzeroSpawns) : 0,
    spawnRatePerTick: totalSpawned / (frames.length || 1),
    cappedTicks,
    avgSpeed: mean(speeds),
    p50Speed: quantile(speeds, 0.5),
    p95Speed: quantile(speeds, 0.95),
    maxSpeed: speeds.length ? speeds[speeds.length - 1] : 0,
    speedSamples: speeds.length,
    avgRadius: mean(radii),
    uniqueKinds: kinds.size,
    uniqueMotions: motions.size,
    uniquePatterns: patterns.size,
  };
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

const f2 = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));
const f0 = (n) => (typeof n === 'number' ? Math.round(n).toString() : String(n));

function report(results, windowTicks) {
  const rows = [
    ['指标', ...results.map((r) => r.file)],
    ['tick 数', ...results.map((r) => f0(r.ticks))],
    ['平均同屏弹数', ...results.map((r) => f2(r.avgOnScreen))],
    ['峰值同屏弹数', ...results.map((r) => f0(r.peakOnScreen))],
    ['同屏 P95', ...results.map((r) => f0(r.p95OnScreen))],
    ['累计发射（去重 id）', ...results.map((r) => f0(r.totalSpawned))],
    ['有发射的 tick 数', ...results.map((r) => f0(r.spawnTicks))],
    ['每 tick 平均发射', ...results.map((r) => f2(r.spawnRatePerTick))],
    ['发射 tick 平均齐射量', ...results.map((r) => f2(r.avgSpawnPerActiveTick))],
    ['单次最大齐射', ...results.map((r) => f0(r.peakSpawnPerTick))],
    ['达弹数上限的 tick', ...results.map((r) => f0(r.cappedTicks))],
    ['平均弹速 px/tick', ...results.map((r) => f2(r.avgSpeed))],
    ['弹速中位数', ...results.map((r) => f2(r.p50Speed))],
    ['弹速 P95', ...results.map((r) => f2(r.p95Speed))],
    ['最大弹速', ...results.map((r) => f2(r.maxSpeed))],
    // 合成路径的 trace 不带 radius_milli；写 0.00 会被误读成"半径为 0"。
    ['平均判定半径 px', ...results.map((r) => (r.avgRadius > 0 ? f2(r.avgRadius) : 'n/a（trace 未给）'))],
    ['弹种数（唯一）', ...results.map((r) => f0(r.uniqueKinds))],
    ['运动函数数（唯一）', ...results.map((r) => f0(r.uniqueMotions))],
    ['pattern 数（唯一）', ...results.map((r) => f0(r.uniquePatterns))],
  ];
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  const line = (cells) => '| ' + cells.map((v, c) => String(v).padEnd(widths[c])).join(' | ') + ' |';
  const sep = '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |';

  const out = [];
  out.push('# 实战 vs 原 TNA 弹幕效果差距（权威状态量化）');
  out.push('');
  out.push(`- 生成：${new Date().toISOString()}`);
  out.push(`- 数据来源：服务端 \`phk_danmaku_trace\` 逐 tick JSONL，度量 \`bullets[]\` 本身`);
  out.push(`- 对齐窗口：${windowTicks > 0 ? `前 ${windowTicks} tick` : '各自全长（注意长度不同，累计量不可直接比）'}`);
  out.push('- 速度单位 px/tick（trace 内为 milli/tick），tick 率 60Hz');
  out.push('');
  out.push(line(rows[0]));
  out.push(sep);
  for (const row of rows.slice(1)) out.push(line(row));
  out.push('');

  if (results.length >= 2) {
    const [tna, live] = results; // 约定：第一个是原 TNA 基准，第二个是实战
    const ratio = (a, b) => (b === 0 ? '—' : `${f2(a / b)}×`);
    out.push('## 差距（原 TNA ÷ 实战）');
    out.push('');
    out.push('| 维度 | 原 TNA | 实战 | 倍数 |');
    out.push('| --- | ---: | ---: | ---: |');
    out.push(`| 平均同屏密度 | ${f2(tna.avgOnScreen)} | ${f2(live.avgOnScreen)} | ${ratio(tna.avgOnScreen, live.avgOnScreen)} |`);
    out.push(`| 峰值同屏密度 | ${f0(tna.peakOnScreen)} | ${f0(live.peakOnScreen)} | ${ratio(tna.peakOnScreen, live.peakOnScreen)} |`);
    out.push(`| 累计发射量 | ${f0(tna.totalSpawned)} | ${f0(live.totalSpawned)} | ${ratio(tna.totalSpawned, live.totalSpawned)} |`);
    out.push(`| 发射频率（有发射的 tick） | ${f0(tna.spawnTicks)} | ${f0(live.spawnTicks)} | ${ratio(tna.spawnTicks, live.spawnTicks)} |`);
    out.push(`| 单次最大齐射 | ${f0(tna.peakSpawnPerTick)} | ${f0(live.peakSpawnPerTick)} | ${ratio(tna.peakSpawnPerTick, live.peakSpawnPerTick)} |`);
    out.push(`| 平均弹速 | ${f2(tna.avgSpeed)} | ${f2(live.avgSpeed)} | ${ratio(tna.avgSpeed, live.avgSpeed)} |`);
    out.push(`| 弹速 P95 | ${f2(tna.p95Speed)} | ${f2(live.p95Speed)} | ${ratio(tna.p95Speed, live.p95Speed)} |`);
    out.push('');
    out.push('> 倍数为「原 TNA 相对实战」；>1 表示原版更密/更快。');
    out.push('');
    out.push('## 口径与读法');
    out.push('');
    out.push('- **第一个 trace 是原 TNA 基准，第二个是实战**（按命令行顺序），倍数按这个顺序算。');
    out.push('- `tick` 率取 `PhK-Protocol/data/tna_contract.json` 的 60Hz；速度 `sqrt(vx²+vy²)/1000` px/tick。');
    out.push('- 「累计发射」按 `bullet_id` 去重，不是 `bullets.length` 求和——后者是同屏存量。');
    out.push('- **弹种/运动函数数量不能直接当"丰富度"比**：原 TNA trace 是**单个 Boss 的实测链表**');
    out.push('  （boss21，一种 pattern、少数弹种但极高密度），实战是**10 模式轮转**（多 pattern、');
    out.push('  弹种略多但每波只有十几颗）。两者口径不同，只看密度/速度/齐射量才有意义。');
    out.push('- 合成 trace 不带 `radius_milli`，半径列为 n/a，不代表判定半径为 0。');
    out.push('- 这些是**权威状态**的度量，不是截图观感；渲染是否忠实另由 `dev/stage_parity.mjs` 验收。');
  }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let outPath = '';
let windowTicks = 0;
const paths = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--out') outPath = args[++i];
  else if (args[i] === '--window') windowTicks = Number(args[++i]) || 0;
  else if (!args[i].startsWith('--')) paths.push(args[i]);
}
if (paths.length === 0) {
  console.error('用法: node dev/danmaku_gap.mjs [--out report.md] [--window N] <trace.jsonl> ...');
  process.exit(1);
}
const results = paths.map((p) => measure(p, windowTicks));
const md = report(results, windowTicks);
if (outPath) {
  writeFileSync(outPath, md, 'utf-8');
  console.log(`已写 ${outPath}`);
} else {
  console.log(md);
}
console.log(JSON.stringify(results, null, 2));
