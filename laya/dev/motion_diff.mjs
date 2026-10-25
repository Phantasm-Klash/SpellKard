// 数理差分测试台 —— TS 侧运行器（本机）。
//
// 与网关 C++ 工具 `phk_motion_diff` 读同一份 scenarios.txt，用**生产镜像**
// (`core/sim/danmaku/bullet_motion.ts`) 跑同一循环，输出 motion-ts.txt。
// compare.py 逐 tick 比对两边全部运动学输出。
//
// 前置：`npx tsc -p tsconfig.test.json`（或 `npm run test`）把核心编到
// `.test-build/`。用法：node dev/motion_diff.mjs scenarios.txt motion-ts.txt

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = resolve(HERE, '..');
const MODULE_PATH = resolve(REPO_ROOT, '.test-build/src/core/sim/danmaku/bullet_motion.js');

const motion = require(MODULE_PATH);
const { createBulletMotion, createMotionTargets, DeterministicRng, updateBulletMotion, integrateVelocity } = motion;

const scenariosPath = process.argv[2];
const outPath = process.argv[3];
if (!scenariosPath || !outPath) {
  console.error('usage: node dev/motion_diff.mjs <scenarios.txt> <out.txt>');
  process.exit(2);
}

/** 行式解析：scenario / motion / target / end，字段名与 C++ 结构体逐字一致。 */
function parseScenarios(text) {
  const scenarios = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'scenario') {
      scenarios.push({
        index: Number(parts[1]),
        funcNo: Number(parts[2]),
        ticks: Number(parts[3]),
        seedLo: parseInt(parts[4], 16),
        seedHi: parseInt(parts[5], 16),
        patternIndex: Number(parts[6]),
        spawnIndex: Number(parts[7]),
        motion: {},
        targets: {},
      });
    } else if (parts[0] === 'motion') {
      scenarios[scenarios.length - 1].motion[parts[1]] = Number(parts[2]);
    } else if (parts[0] === 'target') {
      const which = parts[1];
      scenarios[scenarios.length - 1].targets[which] = {
        has: parts[2] === '1',
        x: Number(parts[3]),
        y: Number(parts[4]),
      };
    }
  }
  return scenarios;
}

const text = readFileSync(scenariosPath, 'utf8');
const scenarios = parseScenarios(text);
const lines = [];
for (const scenario of scenarios) {
  const b = createBulletMotion(scenario.motion);
  const myShip = scenario.targets.my_ship ?? { has: false, x: 0, y: 0 };
  const enemy = scenario.targets.enemy ?? { has: false, x: 0, y: 0 };
  const targets = createMotionTargets({
    has_my_ship: myShip.has,
    my_ship_x: myShip.x,
    my_ship_y: myShip.y,
    has_enemy: enemy.has,
    enemy_x: enemy.x,
    enemy_y: enemy.y,
  });
  // 初始速度由 (angle, speed) 合成（与 C++ 侧一致）。
  integrateVelocity(b);
  for (let tick = 1; tick <= scenario.ticks; tick += 1) {
    const rng = new DeterministicRng({ lo: scenario.seedLo, hi: scenario.seedHi }, tick, scenario.patternIndex, scenario.spawnIndex);
    updateBulletMotion(b, targets, rng);
    b.x += b.vx;
    b.y += b.vy;
    b.t += 1;
    lines.push(
      `${scenario.index} ${tick} ${b.x} ${b.y} ${b.vx} ${b.vy} ${b.angle} ${b.speed} ${b.t} ${b.life}`,
    );
  }
}
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(`wrote ${outPath} (${scenarios.length} scenarios)`);
