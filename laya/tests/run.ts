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
import './battle_opening.test';
import './card_intent.test';
import './gift_system.test';
import './art_icons.test';
import './i18n.test';
import './i18n_flow_migration.test';
import './card_keys.test';
import './card_hand_view.test';
import './draft_panel.test';
import './battle_client_input.test';
import './battle_e2e.test';
import './battle_input_sim_parity.test';
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
import './lobby_session.test';
import './lobby_business_surface.test';
import './lobby_contract_surface.test';
import './nakama_lobby_transport.test';
import './checkin_shop.test';
import './card_effects.test';
import './card_hand.test';
import './lobby_rng.test';
import './records_view.test';
import './gacha_model.test';
import './native_udp_datagram.test';
import './native_window.test';
import './native_battle_crypto.test';
import './laya_http_client.test';
import './ws_relay_url.test';
import './page_params.test';
import './battle_layout.test';
import './tna_atlas_frames.test';
import './lobby_auth.test';
import './login_layout.test';
import './lobby_language.test';
import './game_identity.test';
import './settings.test';
import './upscale_math.test';
import './auth_messages.test';
import './session_replaced.test';
import './shortcuts.test';
import './caret.test';
import './stage_art.test';
import './battle_events.test';
import './cutscene_sequence.test';
import './battle_event_poller.test';
import './match_events_cursor.test';
import './tna_stage_tuning.test';
import './stage_background_geometry.test';
import './audio_throttle.test';
import './cutscene_overlay_steps.test';
import './dem_replay.test';

import './coop_view_model.test';
import './coop_layout.test';
import './coop_codec.test';
import './coop_art.test';
import './room_setup.test';
import './danmaku_client_engine.test';
import './stage_parity.test';import './native_random_tiers.test';import './battle_aead.test';import './shop_names.test';
import './battle_handshake.test';
import './native_window_scale.test';
import './records_certification.test';
import './audio_source_volumes.test';
import './lobby_registration_code.test';
import './error_messages.test';
import './boss_race_danmaku_mechanics.test';
import './bullet_kind_atlas_map.test';
import './boss_race_score.test';
import './render_state_judgment.test';
import './steam_native.test';
import './deck_view.test';

import { runAll } from './harness';

void runAll().catch((error: unknown) => {
  console.log(`TEST RUN FAILED: ${String(error)}`);
  throw error;
});
