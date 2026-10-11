/**
 * Test entry point. Run with `npm test` (compiles to `.test-build` then executes).
 *
 * Importing the suites registers their cases; `runAll` executes them and throws
 * if anything failed, which makes the process exit non-zero.
 */

import './deterministic.test';
import './boss_race_seed.test';
import './protocol_codec.test';
import './battle_codec.test';
import './battle_client_input.test';
import './boss_race_sim.test';
import './boss_race_tna.test';
import './bullet_visual.test';
import './danmaku_data.test';
import './danmaku_motion.test';
import './danmaku_spawn.test';
import './danmaku_atlas_index.test';
import './tna_assets.test';
import './match_clock.test';
import './kcp_loopback.test';
import './matchmaking.test';
import './lobby_ws_protocol.test';
import './lobby_ws_reconnect.test';
import './checkin_shop.test';
import './native_udp_datagram.test';
import './native_window.test';
import './laya_http_client.test';
import './battle_layout.test';
import './tna_atlas_frames.test';
import './lobby_auth.test';
import './login_layout.test';
import './game_identity.test';
import './settings.test';
import './upscale_math.test';
import './auth_messages.test';
import './session_replaced.test';
import './shortcuts.test';
import './caret.test';

import { runAll } from './harness';

void runAll().catch((error: unknown) => {
  console.log(`TEST RUN FAILED: ${String(error)}`);
  throw error;
});
