/**
 * 单关对齐验收（§4.1 第 3 条）的客户端侧断言测试。
 *
 * 用合成 trace（300 tick：环形弹幕 + 匀速玩家 + 一段 hidden 窗口）证明：
 *  - tick 边界：渲染实体数 == 可见弹幕数，位置 == 权威位置；
 *  - tick 内：弹幕 == p+v*frac，玩家/Boss 落在相邻 tick 线段上；
 *  - 解析/序列化往返无损；
 *  - 故意造一条坏数据时，检查器**必须**报错（否则报告没有意义）。
 */

import {
  checkStageParity,
  formatParityReport,
  parseStageTrace,
  parseStageTraceLine,
  serializeStageTrace,
  synthesizeStageTrace,
  traceTickToSnapshot,
} from '../src/core/game/stage_parity';
import { expect, expectClose, expectEqual, suite, test } from './harness';

suite('stage parity: synthetic trace');

test('the synthetic fixture is internally consistent', () => {
  const trace = synthesizeStageTrace(300);
  expectEqual(trace.length, 300, 'one line per tick');
  expectEqual(trace[0].tick, 0);
  expectEqual(trace[299].tick, 299);
  // 玩家的 vx 必须等于相邻两 tick 的位移，否则线段断言会假失败。
  const player = trace[10].players[0];
  const next = trace[11].players[0];
  expectEqual(next.xMilli - player.xMilli, player.vxMilli ?? 0, 'constant velocity player');
  // hidden 窗口：100..139 全 hidden，140 起恢复。
  expectEqual(trace[120].bullets.every((bullet) => bullet.hidden === true), true, 'hidden window');
  expectEqual(trace[140].bullets.every((bullet) => bullet.hidden !== true), true, 'hidden window ends');
});

test('every tick passes both the boundary and the interpolation assertions', () => {
  const report = checkStageParity(synthesizeStageTrace(300));
  expectEqual(report.ticks.length, 300);
  expectEqual(report.failedTicks, 0, `no tick may fail, got ${report.totalFailures} failures`);
  expectEqual(report.totalFailures, 0);
  expectEqual(report.passedTicks, 300);
  expect(report.maxBoundaryErrorPx <= 1e-6, `boundary error ${report.maxBoundaryErrorPx}`);
  expect(report.maxInterpErrorPx <= 1e-6, `interp error ${report.maxInterpErrorPx}`);
  expectEqual(report.skippedSegments, 1, 'the last tick has no next tick to interpolate toward');
});

test('hidden bullets are excluded from the rendered entity count', () => {
  const trace = synthesizeStageTrace(300);
  const report = checkStageParity(trace);
  const visibleWindow = report.ticks[120];
  expectEqual(visibleWindow.visibleBullets, 0, 'the whole ring is hidden during the hold');
  expectEqual(visibleWindow.renderedBullets, 0, 'nothing is rendered while hidden');
  const after = report.ticks[160];
  expect(after.visibleBullets > 0, 'the ring is back after the hold');
  expectEqual(after.renderedBullets, after.visibleBullets);
});

test('a bullet whose velocity disagrees with its trajectory is flagged', () => {
  const trace = synthesizeStageTrace(60);
  // 位置仍然自洽（边界断言照样通过），但速度翻倍：`p + v*frac` 会把插值点推到
  // 「当前 → 下一 tick」线段之外，只有 bullet-segment 这条断言能抓到。
  const source = trace[30].bullets[0];
  trace[30].bullets[0] = { ...source, vxMilli: source.vxMilli * 2, vyMilli: source.vyMilli * 2 };
  const report = checkStageParity(trace);
  const flagged = report.ticks[30].failures.some((failure) => failure.check === 'bullet-segment');
  expect(flagged, 'the interpolation runs off the authoritative segment');
});

test('a player that teleports fails the segment assertion', () => {
  const trace = synthesizeStageTrace(60);
  // 第 40 tick 突然横移 20px：边界断言仍然通过（它就是权威值），但第 39 tick 的
  // 「当前 → 下一 tick」线段断言会把 39 的插值判为偏出容差。
  trace[40].players[0] = { ...trace[40].players[0], xMilli: trace[40].players[0].xMilli + 20000 };
  const report = checkStageParity(trace);
  const offending = report.ticks[39].failures.some((failure) => failure.check === 'entity-interpolation');
  expect(offending, 'tick 39 extrapolates along the wrong segment and must be flagged');
});

suite('stage parity: trace io');

test('serialisation round-trips the frozen JSONL shape', () => {
  const trace = synthesizeStageTrace(5);
  const text = serializeStageTrace(trace);
  const lines = text.trim().split('\n');
  expectEqual(lines.length, 5, 'one line per tick');
  const parsed = parseStageTrace(text);
  expectEqual(parsed.length, 5);
  const original = trace[2];
  const round = parsed[2];
  expectEqual(round.tick, original.tick);
  expectEqual(round.stateHash, original.stateHash);
  expectEqual(round.players[0].xMilli, original.players[0].xMilli);
  expectEqual(round.players[0].vxMilli, original.players[0].vxMilli);
  expectEqual(round.bullets.length, original.bullets.length);
  expectEqual(round.bullets[0].bulletId, original.bullets[0].bulletId);
  expectEqual(round.bullets[0].chainId, original.bullets[0].chainId);
  expectEqual(round.bullets[0].hidden, original.bullets[0].hidden);
  expectEqual(round.chains?.length, original.chains?.length);
});

test('malformed lines are skipped instead of aborting the trace', () => {
  expectEqual(parseStageTraceLine(''), null);
  expectEqual(parseStageTraceLine('{not json'), null);
  expectEqual(parseStageTraceLine('{"state":"running"}'), null, 'a line without tick is dropped');
  const text = ['{"tick":0,"players":[],"bullets":[],"state":"running"}', 'garbage', '{"tick":1,"players":[],"bullets":[],"state":"running"}'].join('\n');
  const parsed = parseStageTrace(text);
  expectEqual(parsed.length, 2);
  expectEqual(parsed[1].tick, 1);
});

test('trace ticks project onto the renderer snapshot shape', () => {
  const trace = synthesizeStageTrace(3);
  const snapshot = traceTickToSnapshot(trace[1]);
  expectEqual(snapshot.tick, 1);
  expectEqual(snapshot.players[0].vxMilli, trace[1].players[0].vxMilli);
  expectEqual(snapshot.bullets[0].hidden, trace[1].bullets[0].hidden);
  expectEqual(snapshot.boss?.maxHp, 6000);
});

suite('stage parity: report');

test('the markdown report states the verdict and the error ceilings', () => {
  const report = checkStageParity(synthesizeStageTrace(20));
  const markdown = formatParityReport(report, { source: 'synthetic', generatedAt: '2026-10-24T00:00:00Z' });
  expect(markdown.includes('✅'), 'a clean run says so');
  expect(markdown.includes('| tick | 可见弹幕 | 渲染弹幕 |'), 'the per-tick table is present');
  expect(markdown.includes('2026-10-24T00:00:00Z'), 'the timestamp is echoed');
  expectClose(report.maxBoundaryErrorPx, 0, 1e-9, 'a synthetic run is exact');
});
