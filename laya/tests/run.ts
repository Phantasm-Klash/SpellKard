/**
 * Test entry point. Run with `npm test` (compiles to `.test-build` then executes).
 *
 * Importing the suites registers their cases; `runAll` executes them and throws
 * if anything failed, which makes the process exit non-zero.
 */

import './deterministic.test';
import './protocol_codec.test';
import './battle_codec.test';
import './boss_race_sim.test';
import './bullet_visual.test';
import './kcp_loopback.test';
import './matchmaking.test';
import './lobby_ws_protocol.test';
import './native_udp_datagram.test';

import { runAll } from './harness';

void runAll().catch((error: unknown) => {
  console.log(`TEST RUN FAILED: ${String(error)}`);
  throw error;
});
