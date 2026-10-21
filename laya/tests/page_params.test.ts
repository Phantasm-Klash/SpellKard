/**
 * pageNumberParam 回归（演示管线的 ?inputLead=N 配置通道）。
 *
 * 战斗输入 tick 必须落在服务端窗口 (server_current, server_current+8]；
 * 高延迟链路下客户端通过页面 query 提高领先量。读取必须对缺失/畸形/负值
 * 一律回落，绝不让 NaN 渗进 tick 计算。
 */

import { pageNumberParam } from '../src/platform/laya/page_params';
import { expectEqual, suite, test } from './harness';

type WindowSlot = { window?: { location?: { search?: string } | null } | undefined };

function withSearch(search: string, fn: () => void): void {
  const slot = globalThis as WindowSlot;
  const prev = slot.window;
  slot.window = { location: { search } };
  try {
    fn();
  } finally {
    slot.window = prev;
  }
}

suite('page params');

test('reads a valid non-negative integer and falls back when absent', () => {
  withSearch('?inputLead=12&other=x', () => {
    expectEqual(pageNumberParam('inputLead', 0), 12, 'valid param');
    expectEqual(pageNumberParam('missing', 7), 7, 'absent param falls back');
    expectEqual(pageNumberParam('other', 3), 3, 'non-numeric value falls back');
  });
});

test('rejects negative, fractional-floor, and malformed values', () => {
  withSearch('?a=-3&b=abc&c=1.9&d=', () => {
    expectEqual(pageNumberParam('a', 5), 5, 'negative rejected');
    expectEqual(pageNumberParam('b', 5), 5, 'non-numeric rejected');
    expectEqual(pageNumberParam('c', 0), 1, 'fractional floors');
    expectEqual(pageNumberParam('d', 4), 4, 'empty value falls back');
  });
});

test('falls back when there is no window at all', () => {
  const slot = globalThis as WindowSlot;
  const prev = slot.window;
  slot.window = undefined;
  try {
    expectEqual(pageNumberParam('inputLead', 9), 9, 'no window → fallback');
  } finally {
    slot.window = prev;
  }
});
