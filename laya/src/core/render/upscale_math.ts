/**
 * Upscale sharpen math — the pure half of the `software` backend's pass.
 *
 * The `software` upscaler (see `upscaler.ts`) renders fewer pixels, lets the
 * browser scaler stretch them back to the display resolution, then sharpens
 * the canvas with an SVG `feConvolveMatrix` filter. This module owns only the
 * numbers that pass needs: the convolution kernel, its SVG text form, and the
 * factor the settings UI uses to explain the render-cost trade-off. Keeping it
 * free of the DOM lets it be reasoned about and tested on its own.
 *
 * NOTE: `core/` only — no DOM, no LayaAir, no Node.
 */

/** Edge length of the sharpen kernel (3x3). */
export const SHARPEN_KERNEL_SIZE = 3;

/**
 * How strongly a full-strength sharpen pulls the centre pixel away from its
 * neighbours. The 5-point Laplacian unsharp kernel is `centre = 1 + 4a` with
 * each of the four edge neighbours `-a`; its sum is `(1 + 4a) - 4a = 1` for any
 * `a`, so brightness is preserved. `0.6` at full strength gives `centre = 3.4`,
 * a firm but not destructive amount — the strongest the browser filter can
 * express without ringing on the flat fills this art uses.
 */
const MAX_EDGE_WEIGHT = 0.6;

/** Rounds to the precision the SVG string and the tests both rely on. */
function round6(value: number): number {
  return Number(value.toFixed(6));
}

/** Clamps strength to 0..1; anything non-finite is treated as 0. */
function clampStrength(strength: number): number {
  if (!Number.isFinite(strength)) {
    return 0;
  }
  if (strength <= 0) {
    return 0;
  }
  if (strength >= 1) {
    return 1;
  }
  return strength;
}

/**
 * A 3x3 contrast-adaptive-sharpening-style kernel for the given strength.
 * Row-major, length 9, symmetric, and normalised so it sums to exactly 1
 * (a convolution with a kernel that sums to 1 preserves overall brightness).
 * strength 0 -> the identity kernel [0,0,0, 0,1,0, 0,0,0].
 * strength is clamped to 0..1; non-finite input is treated as 0.
 */
export function sharpenKernel(strength: number): number[] {
  const a = MAX_EDGE_WEIGHT * clampStrength(strength);
  const centre = 1 + 4 * a;
  const edge = -a;
  return [
    0, edge, 0,
    edge, centre, edge,
    0, edge, 0,
  ].map(round6);
}

/** Formats a kernel as the SVG `kernelMatrix` attribute value. */
export function kernelToConvolveMatrix(kernel: readonly number[]): string {
  return kernel.map((value) => value.toFixed(6)).join(' ');
}

/** A stable CSS filter id for the sharpen pass, namespaced to this client. */
export const SHARPEN_FILTER_ID = 'pk-upscale-sharpen';

/** The SVG `feConvolveMatrix` element markup for a kernel, as a string. */
export function sharpenFilterMarkup(strength: number): string {
  const matrix = kernelToConvolveMatrix(sharpenKernel(strength));
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute">' +
    `<filter id="${SHARPEN_FILTER_ID}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feConvolveMatrix order="${SHARPEN_KERNEL_SIZE}" preserveAlpha="true" kernelMatrix="${matrix}"/>` +
    '</filter></svg>'
  );
}

/**
 * How much of the "upscaling work" a backend actually does, as a 0..1 factor
 * used by the settings UI to explain the trade-off. `off` = 0 (the display
 * scaler does everything), `software` = 1 (the client renders every pixel).
 * Any other backend id (fsr/dlss) returns 0 because no backend is installed.
 */
export function upscaleWorkFactor(backend: string): number {
  return backend === 'software' ? 1 : 0;
}
