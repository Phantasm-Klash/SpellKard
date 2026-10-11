/**
 * Upscale sharpen math tests.
 *
 * The sharpen pass is a single convolution, so a wrong kernel does not throw —
 * it quietly darkens, blows out or rings the whole frame. These pin the two
 * properties that catch that: a kernel that sums to 1 (brightness-preserving)
 * and the exact SVG text the browser filter is built from. The identity case
 * matters most, because sharpness 0 must be a true no-op, not an almost one.
 */

import {
  SHARPEN_FILTER_ID,
  SHARPEN_KERNEL_SIZE,
  kernelToConvolveMatrix,
  sharpenFilterMarkup,
  sharpenKernel,
  upscaleWorkFactor,
} from '../src/core/render/upscale_math';
import { expect, expectClose, expectDeepEqual, expectEqual, suite, test } from './harness';

/** The neutral kernel: a convolution with this leaves the image untouched. */
const IDENTITY = [0, 0, 0, 0, 1, 0, 0, 0, 0];

/** The strengths the settings slider can land on. */
const STRENGTHS = [0, 0.25, 0.5, 0.75, 1];

function sum(kernel: readonly number[]): number {
  let total = 0;
  for (const value of kernel) {
    total += value;
  }
  return total;
}

suite('upscale math: kernel');

test('strength 0 is the identity kernel', () => {
  expectDeepEqual(sharpenKernel(0), IDENTITY);
});

test('the kernel always has nine entries', () => {
  for (const strength of STRENGTHS) {
    expectEqual(sharpenKernel(strength).length, SHARPEN_KERNEL_SIZE * SHARPEN_KERNEL_SIZE);
  }
});

test('every strength preserves brightness (kernel sums to 1)', () => {
  for (const strength of STRENGTHS) {
    expectClose(sum(sharpenKernel(strength)), 1, 1e-9, `strength ${strength}`);
  }
});

test('the four edge weights are equal and the corners are zero', () => {
  for (const strength of STRENGTHS) {
    const k = sharpenKernel(strength);
    expectEqual(k[1], k[3], 'edge weights differ across the centre');
    expectEqual(k[3], k[5], 'edge weights differ across the centre');
    expectEqual(k[5], k[7], 'edge weights differ across the centre');
    expectEqual(k[0], 0, 'corner must be 0');
    expectEqual(k[2], 0, 'corner must be 0');
    expectEqual(k[6], 0, 'corner must be 0');
    expectEqual(k[8], 0, 'corner must be 0');
  }
});

test('the centre rises monotonically with strength', () => {
  let previous = -Infinity;
  for (const strength of STRENGTHS) {
    const centre = sharpenKernel(strength)[4];
    expect(centre > previous, `centre must increase at strength ${strength}`);
    previous = centre;
  }
});

test('the edge weight becomes more negative with strength', () => {
  let previous = Infinity;
  for (const strength of STRENGTHS) {
    const edge = sharpenKernel(strength)[1];
    expect(edge < previous, `edge must grow more negative at strength ${strength}`);
    previous = edge;
  }
});

test('a negative strength clamps to the identity', () => {
  expectDeepEqual(sharpenKernel(-1), sharpenKernel(0));
});

test('a strength above one clamps to full strength', () => {
  expectDeepEqual(sharpenKernel(5), sharpenKernel(1));
});

test('a non-finite strength is treated as zero', () => {
  expectDeepEqual(sharpenKernel(Number.NaN), sharpenKernel(0));
});

suite('upscale math: svg');

test('kernelToConvolveMatrix emits nine 6-decimal fields', () => {
  const fields = kernelToConvolveMatrix(sharpenKernel(0.5)).split(' ');
  expectEqual(fields.length, 9, 'kernel matrix must have nine fields');
  for (const field of fields) {
    expect(/^-?\d+\.\d{6}$/.test(field), `not a 6-decimal field: ${field}`);
  }
});

test('the filter id is the namespaced constant', () => {
  expectEqual(SHARPEN_FILTER_ID, 'pk-upscale-sharpen');
  expect(sharpenFilterMarkup(0.5).includes(`id="${SHARPEN_FILTER_ID}"`), 'filter id is missing');
});

test('the markup embeds the live kernel and the alpha-safe flags', () => {
  const markup = sharpenFilterMarkup(0.5);
  const matrix = kernelToConvolveMatrix(sharpenKernel(0.5));
  expect(markup.includes('feConvolveMatrix'), 'missing the feConvolveMatrix element');
  expect(markup.includes('preserveAlpha="true"'), 'the canvas alpha channel must be preserved');
  expect(markup.includes(matrix), 'the embedded kernel must match kernelToConvolveMatrix');
});

suite('upscale math: work factor');

test('only the software backend renders every pixel itself', () => {
  expectEqual(upscaleWorkFactor('off'), 0);
  expectEqual(upscaleWorkFactor('software'), 1);
  expectEqual(upscaleWorkFactor('fsr'), 0);
  expectEqual(upscaleWorkFactor('dlss'), 0);
  expectEqual(upscaleWorkFactor(''), 0, 'empty id is unknown, not software');
  expectEqual(upscaleWorkFactor('mystery'), 0, 'unknown id is treated as off');
});

test('the kernel edge length is 3', () => {
  expectEqual(SHARPEN_KERNEL_SIZE, 3);
});
