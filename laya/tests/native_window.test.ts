/**
 * Native (LayaNative) window-control wrapper coverage: desktop-size parsing,
 * `spk_win` discovery, and the fullscreen toggle contract.
 *
 * The wrapper is a thin shim over a native global, so every case is exercised
 * with a fake extension and an injected scope — no native runtime is needed.
 */

import {
  nativeDesktopSize,
  nativeFullscreenActive,
  nativeWindowAvailable,
  parseDesktopSize,
  setNativeFullscreen,
  spkWin,
  type SpkWinApi,
} from '../src/platform/native/native_window';
import { expectDeepEqual, expectEqual, suite, test } from './harness';

/** A well-formed fake extension; override one method per case. */
function fakeWin(overrides: Partial<SpkWinApi> = {}): SpkWinApi {
  return {
    version: () => 'spellkard-win/1.0.0',
    getDesktopSize: () => '2048x1280',
    isFullscreen: () => 0,
    getState: () => '{"fullscreen":0,"desktopW":2048,"desktopH":1280}',
    setFullscreen: () => 1,
    ...overrides,
  };
}

suite('native window: desktop size parsing');

test('parseDesktopSize reads a WxH pair', () => {
  expectDeepEqual(parseDesktopSize('2048x1280'), { width: 2048, height: 1280 });
  expectDeepEqual(parseDesktopSize('960x720'), { width: 960, height: 720 });
});

test('parseDesktopSize tolerates surrounding whitespace', () => {
  expectDeepEqual(parseDesktopSize('  1920x1080 '), { width: 1920, height: 1080 });
});

test('parseDesktopSize rejects malformed and non-positive sizes', () => {
  expectEqual(parseDesktopSize('0x0'), null, 'a degenerate size is not usable');
  expectEqual(parseDesktopSize('abc'), null);
  expectEqual(parseDesktopSize(''), null);
  expectEqual(parseDesktopSize('2048'), null, 'a bare number is not WxH');
  expectEqual(parseDesktopSize('2048x'), null);
  expectEqual(parseDesktopSize('x1280'), null);
  expectEqual(parseDesktopSize('2048X1280'), null, 'the separator is lowercase x');
  expectEqual(parseDesktopSize(null as unknown as string), null, 'a non-string reading is rejected');
});

suite('native window: extension discovery');

test('spkWin finds spk_win on the scope or its window', () => {
  const api = fakeWin();
  expectEqual(spkWin({ spk_win: api }), api);
  expectEqual(spkWin({ window: { spk_win: api } }), api);
  expectEqual(spkWin({}), null);
  expectEqual(spkWin(null), null);
});

test('spkWin rejects a partial or wrong-typed extension', () => {
  expectEqual(spkWin({ spk_win: 'nope' }), null);
  expectEqual(
    spkWin({ spk_win: { version: () => 'x', isFullscreen: () => 0 } }),
    null,
    'a missing method must disqualify the object',
  );
});

test('nativeWindowAvailable mirrors spkWin', () => {
  expectEqual(nativeWindowAvailable({ spk_win: fakeWin() }), true);
  expectEqual(nativeWindowAvailable({}), false);
});

suite('native window: desktop size via the extension');

test('nativeDesktopSize reads the extension and degrades to null', () => {
  expectDeepEqual(nativeDesktopSize({ spk_win: fakeWin() }), { width: 2048, height: 1280 });
  expectEqual(nativeDesktopSize({}), null, 'no extension means no size');
  expectEqual(nativeDesktopSize({ spk_win: fakeWin({ getDesktopSize: () => 'garbage' }) }), null);
  expectEqual(
    nativeDesktopSize({
      spk_win: fakeWin({
        getDesktopSize: () => {
          throw new Error('boom');
        },
      }),
    }),
    null,
    'a throwing getter must not escape',
  );
});

suite('native window: fullscreen state');

test('nativeFullscreenActive reads isFullscreen and degrades to false', () => {
  expectEqual(nativeFullscreenActive({ spk_win: fakeWin({ isFullscreen: () => 1 }) }), true);
  expectEqual(nativeFullscreenActive({ spk_win: fakeWin({ isFullscreen: () => 0 }) }), false);
  expectEqual(nativeFullscreenActive({}), false, 'no extension reads as not fullscreen');
  expectEqual(
    nativeFullscreenActive({
      spk_win: fakeWin({
        isFullscreen: () => {
          throw new Error('boom');
        },
      }),
    }),
    false,
    'a throwing getter must not escape',
  );
});

suite('native window: fullscreen toggle');

test('setNativeFullscreen maps true/false onto 1/0 and reports the success flag', () => {
  const calls: number[] = [];
  const api = fakeWin({
    setFullscreen: (enable) => {
      calls.push(enable);
      return 1;
    },
  });
  expectEqual(setNativeFullscreen(true, { spk_win: api }), true);
  expectEqual(setNativeFullscreen(false, { spk_win: api }), true, 'the result is the call outcome, not the request');
  expectDeepEqual(calls, [1, 0]);
});

test('setNativeFullscreen reports failure when the extension returns 0', () => {
  expectEqual(setNativeFullscreen(true, { spk_win: fakeWin({ setFullscreen: () => 0 }) }), false);
});

test('setNativeFullscreen swallows a throwing extension', () => {
  const api = fakeWin({
    setFullscreen: () => {
      throw new Error('boom');
    },
  });
  expectEqual(setNativeFullscreen(true, { spk_win: api }), false);
});

test('setNativeFullscreen is a no-op without the extension', () => {
  expectEqual(setNativeFullscreen(true, {}), false);
  expectEqual(setNativeFullscreen(false, {}), false);
});
