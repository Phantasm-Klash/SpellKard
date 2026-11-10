#!/usr/bin/env node
/**
 * 差量 wire 端到端验收（规格 §10.4）——真实弹幕 trace 的「delta 重建 == 全量」。
 *
 * 服务端 `phk_danmaku_trace` 同参跑两份：
 *   --out full.jsonl     全量快照（含 bullets[]）
 *   --out delta.jsonl --delta   省略 bullets[]，只带 spawn/despawn/deviation 事件流
 *
 * 本脚本把 delta 快照交给客户端的 `decodeBossRaceSnapshot` + `BulletReconstructor`
 * （§10.3 重建器），逐 tick 与全量快照的
 * (bullet_id, x_milli, y_milli, bullet_kind, motion_func) **逐位**比较，
 * 并核对 state_hash 与带宽差。
 *
 * 用法：
 *   node dev/delta_replay.mjs --full full.jsonl --delta delta.jsonl [--seed 12345]
 *
 * 退出码：0 = 全部逐位相等；1 = 有不等（按 §10.4 第 4 条，此时**不允许**
 * 去掉全量 bullets[]，必须回到骨架模式）。
 */
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = resolve(HERE, '..');

const codec = require(resolve(REPO_ROOT, '.test-build/src/core/net/battle_codec.js'));
const recon = require(resolve(REPO_ROOT, '.test-build/src/core/net/bullet_reconstructor.js'));
const seedMod = require(resolve(REPO_ROOT, '.test-build/src/core/math/boss_race_seed.js'));

const SNAPSHOT_TYPE = 4; // BattlePayloadType.SNAPSHOT

function parseArgs(argv) {
  const args = { full: '', delta: '', seed: 12345 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--full') { args.full = argv[++i] ?? ''; continue; }
    if (arg === '--delta') { args.delta = argv[++i] ?? ''; continue; }
    if (arg === '--seed') { args.seed = Number(argv[++i]); continue; }
    console.error(`未知参数 ${arg}`);
    process.exit(2);
  }
  if (!args.full || !args.delta) {
    console.error('usage: node dev/delta_replay.mjs --full <full.jsonl> --delta <delta.jsonl> [--seed N]');
    process.exit(2);
  }
  return args;
}

function readLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 把一行 JSON 快照包成 wire payload（首字节是 payload type）。 */
function toPayload(jsonLine) {
  const bytes = Buffer.from(jsonLine, 'utf8');
  const payload = new Uint8Array(bytes.length + 1);
  payload[0] = SNAPSHOT_TYPE;
  payload.set(bytes, 1);
  return payload;
}

/** 取快照里的 bullet 列表，按 bullet_id 排序，便于逐项比较。 */
function normalize(bullets) {
  return bullets
    .map((b) => ({
      bullet_id: b.bulletId,
      x_milli: b.xMilli,
      y_milli: b.yMilli,
      vx_milli: b.vxMilli,
      vy_milli: b.vyMilli,
      radius_milli: b.radiusMilli,
      bullet_kind: b.bulletKind,
      motion_func: b.motionFunc,
    }))
    .sort((a, b) => (a.bullet_id < b.bullet_id ? -1 : a.bullet_id > b.bullet_id ? 1 : 0));
}

function diffBullets(full, rebuilt) {
  const problems = [];
  if (full.length !== rebuilt.length) {
    problems.push(`存活弹数不同：full=${full.length} rebuilt=${rebuilt.length}`);
  }
  const n = Math.min(full.length, rebuilt.length);
  for (let i = 0; i < n; i += 1) {
    const a = full[i];
    const b = rebuilt[i];
    for (const key of Object.keys(a)) {
      if (a[key] !== b[key]) {
        problems.push(`${a.bullet_id}.${key}: full=${a[key]} rebuilt=${b[key]}`);
        break;
      }
    }
    if (problems.length >= 5) break;
  }
  return problems;
}

const args = parseArgs(process.argv.slice(2));
const fullLines = readLines(args.full);
const deltaLines = readLines(args.delta);

if (fullLines.length !== deltaLines.length) {
  console.error(`FAIL 两份 trace 行数不同：full=${fullLines.length} delta=${deltaLines.length}`);
  process.exit(1);
}

const matchSeed = seedMod.bossRaceSeedFromU32(args.seed);
const reconstructor = new recon.BulletReconstructor({ matchSeed });

let failedTicks = 0;
let totalBullets = 0;
let hashMismatch = 0;
const samples = [];

for (let i = 0; i < fullLines.length; i += 1) {
  const fullJson = JSON.parse(fullLines[i]);
  const deltaJson = JSON.parse(deltaLines[i]);

  // 全量：解码后直接拿权威 bullets[]。
  const fullSnapshot = codec.decodeBossRaceSnapshot(toPayload(fullLines[i]));
  if (fullSnapshot === null) {
    console.error(`FAIL 第 ${i} 行全量快照解码失败`);
    process.exit(1);
  }
  // delta：省略 bullets[]，由重建器递推。
  const deltaSnapshot = codec.decodeBossRaceSnapshot(toPayload(deltaLines[i]), reconstructor);
  if (deltaSnapshot === null) {
    console.error(`FAIL 第 ${i} 行 delta 快照解码/重建失败（重建器返回 null）`);
    process.exit(1);
  }

  const fullBullets = normalize(fullSnapshot.bullets);
  const rebuiltBullets = normalize(deltaSnapshot.bullets);
  totalBullets += fullBullets.length;

  if (fullJson.state_hash !== undefined && deltaJson.state_hash !== undefined
      && fullJson.state_hash !== deltaJson.state_hash) {
    hashMismatch += 1;
    if (samples.length < 5) {
      samples.push(`tick ${i}: state_hash full=${fullJson.state_hash} delta=${deltaJson.state_hash}`);
    }
  }

  const problems = diffBullets(fullBullets, rebuiltBullets);
  if (problems.length > 0) {
    failedTicks += 1;
    if (samples.length < 5) {
      samples.push(`tick ${i}: ${problems.join('; ')}`);
    }
  }
}

const fullBytes = statSync(args.full).size;
const deltaBytes = statSync(args.delta).size;

console.log(`ticks=${fullLines.length} 逐位重建比较：失败 tick=${failedTicks}，state_hash 不等=${hashMismatch}`);
console.log(`带宽：全量 ${fullBytes} B vs delta ${deltaBytes} B（省 ${(100 * (1 - deltaBytes / fullBytes)).toFixed(1)}%）`);
for (const line of samples) {
  console.log(`  FAIL ${line}`);
}
if (failedTicks > 0 || hashMismatch > 0) {
  console.error('FAIL 按 §10.4 第 4 条：存在逐位不等，**不允许**去掉全量 bullets[]，回到骨架模式');
  process.exit(1);
}
console.log('PASS delta 重建与全量逐 tick 逐位相等');
