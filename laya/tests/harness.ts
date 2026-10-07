/**
 * Zero-dependency test harness.
 *
 * The core layer has no runtime dependencies (by design), so the tests do too:
 * a tiny registry plus a runner that throws at the end if anything failed, which
 * makes `node .test-build/tests/run.js` exit non-zero without needing
 * `@types/node`.
 */

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const registry: TestCase[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  registry.push({ name, fn });
}

export function suite(name: string): void {
  registry.push({ name: `# ${name}`, fn: () => undefined });
}

export class AssertionError extends Error {}

export function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new AssertionError(message);
  }
}

export function expectEqual<T>(actual: T, expected: T, message = 'values differ'): void {
  if (actual !== expected) {
    throw new AssertionError(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function expectDeepEqual(actual: unknown, expected: unknown, message = 'values differ'): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new AssertionError(`${message}:\n  expected ${b}\n  actual   ${a}`);
  }
}

export function expectClose(actual: number, expected: number, tolerance: number, message = 'values differ'): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new AssertionError(`${message}: expected ~${expected} (±${tolerance}), got ${actual}`);
  }
}

export function expectThrows(fn: () => void, message = 'expected function to throw'): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new AssertionError(message);
  }
}

export async function runAll(): Promise<void> {
  let passed = 0;
  const failures: string[] = [];
  for (const item of registry) {
    if (item.name.startsWith('# ')) {
      console.log(`\n${item.name}`);
      continue;
    }
    try {
      await item.fn();
      passed += 1;
      console.log(`  ok   ${item.name}`);
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      failures.push(`${item.name} — ${reason}`);
      console.log(`  FAIL ${item.name}\n       ${reason}`);
    }
  }
  console.log(`\n${passed} passed, ${failures.length} failed, ${registry.length} registered`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} test(s) failed`);
  }
}

/** Deterministic PRNG for tests that need "randomness" without flakiness. */
export class Lcg {
  private state: number;

  constructor(seed = 12345) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
}
