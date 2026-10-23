#!/usr/bin/env node
/**
 * 单关对齐验收（计划 §4.1 第 3 条）的**客户端侧 CLI**。
 *
 * 纯 Node，不依赖 Laya / 浏览器：断言逻辑在 `src/core/game/stage_parity.ts`
 * （引擎无关的纯函数），这里只负责读 trace、跑一遍、写报告。
 *
 * 用法：
 *   node dev/stage_parity.mjs                          # 合成 300 tick fixture 自检
 *   node dev/stage_parity.mjs --synth=300              # 显式指定合成 tick 数
 *   node dev/stage_parity.mjs --trace path/to/trace.jsonl
 *   node dev/stage_parity.mjs --trace t.jsonl --out report.md --layout 480x720 --player p1
 *
 * 前置：核心模块要先编译到 `.test-build`（`npm run test` 会做，或单独
 * `npx tsc -p tsconfig.test.json`）。缺构建产物时脚本会直接说明怎么补。
 *
 * 退出码：0 = 全部通过；1 = 有断言失败（或输入/构建缺失）。
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = resolve(HERE, '..');
const MODULE_PATH = resolve(REPO_ROOT, '.test-build/src/core/game/stage_parity.js');
const DEFAULT_OUT_DIR = resolve(HERE, '../../..', 'tmp/danmaku-engine-20261024/stage-parity');
const DEFAULT_OUT = resolve(DEFAULT_OUT_DIR, 'report-client.md');
const SYNTH_TRACE_OUT = resolve(DEFAULT_OUT_DIR, 'trace-synthetic.jsonl');

function parseArgs(argv) {
  const args = { synth: null, trace: null, out: DEFAULT_OUT, layout: null, player: null, quiet: false };
  const takesValue = { '--trace': 'trace', '--out': 'out', '--layout': 'layout', '--player': 'player' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--quiet') {
      args.quiet = true;
      continue;
    }
    if (arg === '--synth') {
      args.synth = 300;
      continue;
    }
    if (arg.startsWith('--synth=')) {
      args.synth = Number(arg.slice('--synth='.length)) || 300;
      continue;
    }
    const equal = arg.indexOf('=');
    if (arg.startsWith('--') && equal > 0) {
      const key = arg.slice(0, equal);
      const value = arg.slice(equal + 1);
      if (takesValue[key] === undefined) {
        fail(`未知参数 ${key}`);
      }
      args[takesValue[key]] = value;
      continue;
    }
    if (takesValue[arg] !== undefined) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        fail(`${arg} 缺少值`);
      }
      args[takesValue[arg]] = value;
      i += 1;
      continue;
    }
    fail(`未知参数 ${arg}`);
  }
  return args;
}

function fail(message) {
  console.error(`stage_parity: ${message}`);
  process.exit(1);
}

let core;
try {
  core = require(MODULE_PATH);
} catch (error) {
  fail(
    `无法加载 ${MODULE_PATH}\n` +
      `  先编译核心模块：npm run test（或 npx tsc -p tsconfig.test.json）\n` +
      `  ${String(error)}`,
  );
}

const args = parseArgs(process.argv.slice(2));
const layout = args.layout === null
  ? undefined
  : (() => {
      const match = /^(\d+)x(\d+)$/.exec(args.layout);
      if (match === null) {
        fail(`--layout 需要 WxH，收到 ${args.layout}`);
      }
      return { width: Number(match[1]), height: Number(match[2]) };
    })();

let trace;
let source;
if (args.trace !== null) {
  source = resolve(args.trace);
  let text;
  try {
    text = readFileSync(source, 'utf8');
  } catch (error) {
    fail(`读不到 trace：${source}\n  ${String(error)}`);
  }
  trace = core.parseStageTrace(text);
  if (trace.length === 0) {
    fail(`trace 里没有可解析的 tick：${source}`);
  }
} else {
  const count = args.synth ?? 300;
  trace = core.synthesizeStageTrace(count, layout);
  source = SYNTH_TRACE_OUT;
  mkdirSync(dirname(SYNTH_TRACE_OUT), { recursive: true });
  writeFileSync(SYNTH_TRACE_OUT, core.serializeStageTrace(trace), 'utf8');
}

const report = core.checkStageParity(trace, {
  layout,
  localPlayerId: args.player ?? undefined,
});

const markdown = core.formatParityReport(report, { source });
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, markdown, 'utf8');

if (!args.quiet) {
  console.log(`trace: ${source} (${trace.length} ticks)`);
  console.log(
    `ticks: ${report.passedTicks} passed / ${report.failedTicks} failed · failures ${report.totalFailures}`,
  );
  console.log(
    `max boundary error ${report.maxBoundaryErrorPx.toFixed(6)} px · max interp error ${report.maxInterpErrorPx.toFixed(6)} px`,
  );
  for (const failure of report.sampleFailures) {
    console.log(`  FAIL tick ${failure.tick} [${failure.check}] ${failure.detail}`);
  }
  console.log(`report: ${args.out}`);
}

process.exit(report.failedTicks === 0 ? 0 : 1);
