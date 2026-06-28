extends SceneTree

const MAIN_SCENE := "res://scenes/main.tscn"
const SERVER_URL := "http://127.0.0.1:7350"
const MAX_FRAMES := 420

var main_node: Node = null
var frame_count := 0
var started := false
var failed := false
var stage := "init"

func _initialize() -> void:
	var packed_scene := load(MAIN_SCENE)
	if packed_scene == null:
		push_error("Gensoulkyo live check failed: failed to load main scene")
		failed = true
		quit(1)
		return
	main_node = packed_scene.instantiate()
	root.add_child(main_node)

func _process(_delta: float) -> bool:
	if failed:
		return true
	frame_count += 1
	if frame_count > MAX_FRAMES:
		push_error("Gensoulkyo live check failed: timed out at stage %s" % stage)
		quit(1)
		return true
	if frame_count < 20 or started:
		return false
	started = true
	_run_live_check()
	return false

func _run_live_check() -> void:
	var api_model = main_node.get("gensoulkyo_api_model")
	var http_client = main_node.get("gensoulkyo_http_client")
	var matchmaking_model = main_node.get("matchmaking_model")
	var network_match_model = main_node.get("network_match_model")
	var game_mode_model = main_node.get("game_mode_model")
	var results_service_model = main_node.get("results_service_model")
	var deck_builder = main_node.get("deck_builder")
	var chest_system = main_node.get("chest_system")
	if api_model == null or http_client == null or matchmaking_model == null or network_match_model == null or game_mode_model == null or results_service_model == null or deck_builder == null or chest_system == null:
		_fail("missing client models")
		return
	deck_builder.configure_local_defaults()
	if main_node.has_method("_select_stage"):
		main_node.call("_select_stage", "lunar_maze", true)
	if main_node.has_method("_select_character"):
		main_node.call("_select_character", "spell_power")
	api_model.configure(SERVER_URL)
	stage = "login_bootstrap"
	var login_result: Dictionary = await main_node.call("_gensoulkyo_login_and_bootstrap", "spellkard-live-a", "SpellKard Live A")
	if not bool(login_result.get("ok", false)) or String(api_model.session_token).is_empty() or String(matchmaking_model.server_status) != "gensoulkyo_http":
		_fail("login/bootstrap failed %s" % [login_result])
		return
	if int(api_model.get("last_inventory_count")) <= 0 or int(api_model.get("last_deck_count")) <= 0 or int(api_model.get("last_chest_pool_count")) <= 0 or String(deck_builder.active_deck_id).is_empty():
		_fail("bootstrap did not sync server surfaces inv=%d decks=%d chests=%d active=%s" % [int(api_model.get("last_inventory_count")), int(api_model.get("last_deck_count")), int(api_model.get("last_chest_pool_count")), String(deck_builder.active_deck_id)])
		return
	if String(api_model.get("last_certification_rating")) != "copper" or int(game_mode_model.certification_state.get("rank_score", 0)) < 1000:
		_fail("bootstrap did not sync certification profile api=%s cert=%s" % [String(api_model.get("last_certification_rating")), game_mode_model.certification_state])
		return
	if int(api_model.get("last_world_boss_hp")) <= 0 or int(api_model.get("last_world_boss_attempts_left")) != 3 or int(game_mode_model.world_boss_state.get("current_hp", 0)) <= 0:
		_fail("bootstrap did not sync world boss state api_hp=%d attempts=%d state=%s" % [int(api_model.get("last_world_boss_hp")), int(api_model.get("last_world_boss_attempts_left")), game_mode_model.world_boss_state])
		return
	stage = "deck_sync"
	var inventory_sync: Dictionary = await main_node.call("_gensoulkyo_sync_inventory")
	if not bool(inventory_sync.get("ok", false)) or int(inventory_sync.get("item_count", 0)) <= 0:
		_fail("inventory sync failed %s" % [inventory_sync])
		return
	var deck_save: Dictionary = await main_node.call("_gensoulkyo_save_active_deck", true)
	if not bool(deck_save.get("ok", false)) or String(deck_save.get("active_deck_id", "")).is_empty():
		_fail("deck save failed %s" % [deck_save])
		return
	var decks_sync: Dictionary = await main_node.call("_gensoulkyo_sync_decks")
	if not bool(decks_sync.get("ok", false)) or int(decks_sync.get("deck_count", 0)) <= 0 or String(matchmaking_model.active_deck_id).is_empty():
		_fail("decks sync failed %s active=%s" % [decks_sync, String(matchmaking_model.active_deck_id)])
		return
	stage = "chest_sync_open"
	var chests_sync: Dictionary = await main_node.call("_gensoulkyo_sync_chests")
	if not bool(chests_sync.get("ok", false)) or int(chests_sync.get("pool_count", 0)) <= 0 or int(chest_system.owned_chests.get("local_basic", 0)) <= 0:
		_fail("chests sync failed %s owned=%s" % [chests_sync, chest_system.owned_chests])
		return
	var open_chest: Dictionary = await main_node.call("_gensoulkyo_open_chest", "local_basic", 1)
	if not bool(open_chest.get("ok", false)) or int(open_chest.get("result_count", 0)) <= 0 or chest_system.result_rows().is_empty() or chest_system.audit_rows(1).is_empty():
		_fail("server chest open failed %s rows=%s audit=%s" % [open_chest, chest_system.result_rows(), chest_system.audit_rows(1)])
		return
	var chest_results: Array = chest_system.result_rows()
	var upgrade_card_id := String((chest_results[0] as Dictionary).get("card_id", "focus_lens")) if typeof(chest_results[0]) == TYPE_DICTIONARY else "focus_lens"
	stage = "card_upgrade"
	var upgrade_card: Dictionary = await main_node.call("_gensoulkyo_upgrade_card", upgrade_card_id)
	if not bool(upgrade_card.get("ok", false)) or int(upgrade_card.get("new_level", 0)) < 2 or int(deck_builder.card_levels.get(upgrade_card_id, 0)) < 2:
		_fail("server card upgrade failed %s card=%s level=%s" % [upgrade_card, upgrade_card_id, deck_builder.card_levels.get(upgrade_card_id, 0)])
		return
	stage = "join_first"
	var first_join: Dictionary = await main_node.call("_gensoulkyo_join_queue", "certification")
	if not bool(first_join.get("ok", false)) or String(matchmaking_model.server_ticket_id).is_empty():
		_fail("first queue join failed %s" % [first_join])
		return
	stage = "heartbeat_waiting"
	var waiting_heartbeat: Dictionary = await main_node.call("_gensoulkyo_heartbeat")
	if not bool(waiting_heartbeat.get("ok", false)) or String(matchmaking_model.presence_status) != "queue_waiting" or String(api_model.last_presence_status) != "queue_waiting":
		_fail("waiting heartbeat failed %s presence=%s api=%s" % [waiting_heartbeat, String(matchmaking_model.presence_status), String(api_model.last_presence_status)])
		return
	var first_token := String(api_model.session_token)
	var first_user := String(api_model.user_id)
	stage = "login_second"
	var second_login_request: Dictionary = api_model.anonymous_login_request("spellkard-live-b", "SpellKard Live B")
	var second_login: Dictionary = await http_client.send_and_apply(second_login_request)
	if not bool(second_login.get("ok", false)):
		_fail("second login failed %s" % [second_login])
		return
	var second_user := String(api_model.user_id)
	var second_join: Dictionary = await main_node.call("_gensoulkyo_join_queue", "certification")
	if not bool(second_join.get("ok", false)) or String(matchmaking_model.active_match_id).is_empty():
		_fail("second queue join failed %s" % [second_join])
		return
	var match_id := String(matchmaking_model.active_match_id)
	var second_token := String(api_model.session_token)
	stage = "ready_second"
	var second_ready: Dictionary = await main_node.call("_gensoulkyo_ready", match_id)
	if not bool(second_ready.get("ok", false)):
		_fail("second ready failed %s" % [second_ready])
		return
	stage = "ready_first"
	api_model.session_token = first_token
	api_model.user_id = first_user
	var first_ready: Dictionary = await main_node.call("_gensoulkyo_ready", match_id)
	if not bool(first_ready.get("ok", false)) or String(network_match_model.authority_state) != "running":
		_fail("first ready/match_start failed %s authority %s" % [first_ready, String(network_match_model.authority_state)])
		return
	if String(network_match_model.server_loadout.get("stage_id", "")) != "lunar_maze" or String(network_match_model.server_loadout.get("character_id", "")) != "spell_power":
		_fail("server loadout missing after ready %s" % [network_match_model.server_loadout])
		return
	stage = "input"
	var input_result: Dictionary = await main_node.call("_gensoulkyo_submit_input", 1, {
		"direction_bits": 4,
		"slow_pressed": true,
		"shoot_pressed": true,
		"bomb_pressed": false,
		"card_slot": -1,
	}, {
		"tick": 1,
		"state_hash": "",
		"player_pos": {"x": 480.0, "y": 600.0},
	}, 4)
	if not bool(input_result.get("ok", false)) or int(network_match_model.last_accepted_snapshot_tick) < 1:
		_fail("input failed %s" % [input_result])
		return
	if String(network_match_model.server_loadout.get("stage_id", "")) != "lunar_maze":
		_fail("snapshot loadout stage missing %s" % [network_match_model.server_loadout])
		return
	if int(network_match_model.server_bullets.size()) <= 0 or int(network_match_model.last_bullet_delta_count) <= 0:
		_fail("server bullet delta did not apply bullets=%d delta=%d" % [int(network_match_model.server_bullets.size()), int(network_match_model.last_bullet_delta_count)])
		return
	stage = "heartbeat_running"
	var running_heartbeat: Dictionary = await main_node.call("_gensoulkyo_heartbeat", "", match_id, 1)
	if not bool(running_heartbeat.get("ok", false)) or String(network_match_model.presence_status) != "in_match" or int(network_match_model.presence_match_tick) < 1 or not bool(network_match_model.presence_server_authoritative):
		_fail("running heartbeat failed %s presence=%s tick=%d" % [running_heartbeat, String(network_match_model.presence_status), int(network_match_model.presence_match_tick)])
		return
	stage = "card_input"
	var card_input_result: Dictionary = await main_node.call("_gensoulkyo_submit_input", 2, {
		"direction_bits": 0,
		"slow_pressed": false,
		"shoot_pressed": false,
		"bomb_pressed": false,
		"card_slot": 1,
	}, {
		"tick": 2,
		"state_hash": "",
		"player_pos": {"x": 480.0, "y": 600.0},
	}, 4)
	if not bool(card_input_result.get("ok", false)) or int(network_match_model.server_active_cards.size()) <= 0 or not String(network_match_model.server_active_card_summary()).contains("focus_lens"):
		_fail("server card activation did not apply %s cards=%d summary=%s" % [card_input_result, int(network_match_model.server_active_cards.size()), String(network_match_model.server_active_card_summary())])
		return
	stage = "events_after_card"
	var events_after_card: Dictionary = await main_node.call("_gensoulkyo_poll_events", match_id, 0, 16)
	if not bool(events_after_card.get("ok", false)) or int(network_match_model.event_stream_cursor) <= 0 or int(network_match_model.last_event_count) <= 0:
		_fail("event stream after card failed %s cursor=%d last=%d" % [events_after_card, int(network_match_model.event_stream_cursor), int(network_match_model.last_event_count)])
		return
	var event_cursor_after_card := int(network_match_model.event_stream_cursor)
	stage = "snapshot_full"
	var snapshot_result: Dictionary = await main_node.call("_gensoulkyo_snapshot", match_id, {
		"tick": 2,
		"state_hash": "",
		"player_pos": {"x": 480.0, "y": 600.0},
	})
	if not bool(snapshot_result.get("ok", false)) or int(network_match_model.server_bullets.size()) <= 0 or int(network_match_model.server_active_cards.size()) <= 0:
		_fail("full snapshot failed %s bullets=%d cards=%d" % [snapshot_result, int(network_match_model.server_bullets.size()), int(network_match_model.server_active_cards.size())])
		return
	stage = "disconnect"
	var disconnect_result: Dictionary = await main_node.call("_gensoulkyo_disconnect", match_id)
	if not bool(disconnect_result.get("ok", false)) or String(network_match_model.connection_state) != "disconnected":
		_fail("disconnect failed %s state=%s" % [disconnect_result, String(network_match_model.connection_state)])
		return
	stage = "heartbeat_disconnected"
	var disconnect_heartbeat: Dictionary = await main_node.call("_gensoulkyo_heartbeat", "", match_id, 3)
	if not bool(disconnect_heartbeat.get("ok", false)) or String(network_match_model.presence_status) != "disconnected" or bool(network_match_model.presence_connected):
		_fail("disconnect heartbeat should not reconnect %s presence=%s connected=%s" % [disconnect_heartbeat, String(network_match_model.presence_status), bool(network_match_model.presence_connected)])
		return
	stage = "input_disconnected"
	var disconnected_input: Dictionary = await main_node.call("_gensoulkyo_submit_input", 3, {
		"direction_bits": 0,
		"slow_pressed": false,
		"shoot_pressed": true,
		"bomb_pressed": false,
		"card_slot": -1,
	}, {
		"tick": 3,
		"state_hash": "",
		"player_pos": {"x": 480.0, "y": 600.0},
	}, 4)
	if bool(disconnected_input.get("ok", false)) or String(disconnected_input.get("last_error_code", "")) != "match_state_invalid":
		_fail("disconnected input should fail %s" % [disconnected_input])
		return
	stage = "reconnect"
	var reconnect_result: Dictionary = await main_node.call("_gensoulkyo_reconnect", match_id, {
		"tick": 3,
		"state_hash": "",
		"player_pos": {"x": 480.0, "y": 600.0},
	})
	if not bool(reconnect_result.get("ok", false)) or String(network_match_model.connection_state) != "connected" or int(network_match_model.last_accepted_snapshot_tick) < 2 or int(network_match_model.server_bullets.size()) <= 0:
		_fail("reconnect failed %s state=%s tick=%d bullets=%d" % [reconnect_result, String(network_match_model.connection_state), int(network_match_model.last_accepted_snapshot_tick), int(network_match_model.server_bullets.size())])
		return
	stage = "events_after_reconnect"
	var events_after_reconnect: Dictionary = await main_node.call("_gensoulkyo_poll_events", match_id, event_cursor_after_card, 16)
	if not bool(events_after_reconnect.get("ok", false)) or int(network_match_model.event_stream_cursor) <= event_cursor_after_card or int(network_match_model.last_event_count) <= 0:
		_fail("event stream after reconnect failed %s cursor=%d previous=%d last=%d" % [events_after_reconnect, int(network_match_model.event_stream_cursor), event_cursor_after_card, int(network_match_model.last_event_count)])
		return
	stage = "settle"
	results_service_model.reset_local_state()
	var settle_result: Dictionary = await main_node.call("_gensoulkyo_settle", match_id)
	if not bool(settle_result.get("ok", false)) or int(results_service_model.wallet.get("points", 0)) <= 0 or String(network_match_model.authority_state) != "ended":
		_fail("settle failed %s wallet %s" % [settle_result, results_service_model.wallet])
		return
	if String(api_model.get("last_certification_rating")).is_empty() or int(api_model.get("last_certification_delta")) == 0 or int(game_mode_model.certification_state.get("rank_score", 0)) <= 1000:
		_fail("settle did not sync certification result api=%s delta=%d cert=%s" % [String(api_model.get("last_certification_rating")), int(api_model.get("last_certification_delta")), game_mode_model.certification_state])
		return
	stage = "replay_read"
	var replay_id := String(network_match_model.replay_metadata.get("replay_id", ""))
	var replay_result: Dictionary = await main_node.call("_gensoulkyo_fetch_replay", replay_id)
	if not bool(replay_result.get("ok", false)) or not bool(network_match_model.replay_metadata.get("audit_loaded", false)) or int(network_match_model.replay_metadata.get("event_count", 0)) <= 0:
		_fail("replay read failed %s metadata %s" % [replay_result, network_match_model.replay_metadata])
		return
	if String(network_match_model.replay_metadata.get("stage_id", "")) != "lunar_maze":
		_fail("replay loadout stage missing %s" % [network_match_model.replay_metadata])
		return
	stage = "rematch_waiting"
	api_model.session_token = first_token
	api_model.user_id = first_user
	var rematch_waiting: Dictionary = await main_node.call("_gensoulkyo_rematch", match_id)
	if not bool(rematch_waiting.get("ok", false)) or String(network_match_model.rematch_status) != "waiting" or int(network_match_model.rematch_accepted_count) != 1:
		_fail("rematch waiting failed %s state=%s accepted=%d" % [rematch_waiting, String(network_match_model.rematch_status), int(network_match_model.rematch_accepted_count)])
		return
	stage = "rematch_found"
	api_model.session_token = second_token
	api_model.user_id = second_user
	var rematch_found: Dictionary = await main_node.call("_gensoulkyo_rematch", match_id)
	var rematch_match_id := String(rematch_found.get("new_match_id", network_match_model.match_id))
	if not bool(rematch_found.get("ok", false)) or String(network_match_model.rematch_status) != "found" or rematch_match_id.is_empty() or rematch_match_id == match_id or String(network_match_model.authority_state) != "loading":
		_fail("rematch found failed %s rematch=%s authority=%s" % [rematch_found, rematch_match_id, String(network_match_model.authority_state)])
		return
	stage = "rematch_ready_second"
	var rematch_second_ready: Dictionary = await main_node.call("_gensoulkyo_ready", rematch_match_id)
	if not bool(rematch_second_ready.get("ok", false)):
		_fail("rematch second ready failed %s" % [rematch_second_ready])
		return
	stage = "rematch_ready_first"
	api_model.session_token = first_token
	api_model.user_id = first_user
	var rematch_first_ready: Dictionary = await main_node.call("_gensoulkyo_ready", rematch_match_id)
	if not bool(rematch_first_ready.get("ok", false)) or String(network_match_model.authority_state) != "running" or String(network_match_model.match_id) != rematch_match_id:
		_fail("rematch first ready failed %s authority=%s match=%s" % [rematch_first_ready, String(network_match_model.authority_state), String(network_match_model.match_id)])
		return
	if String(network_match_model.server_loadout.get("stage_id", "")) != "lunar_maze":
		_fail("rematch loadout stage missing %s" % [network_match_model.server_loadout])
		return
	stage = "claim"
	var claim_result: Dictionary = await main_node.call("_gensoulkyo_claim_activity", "task", "daily_complete_match")
	if not bool(claim_result.get("ok", false)) or not bool(results_service_model.task_progress.get("daily_complete_match", {}).get("claimed", false)):
		_fail("claim failed %s" % [claim_result])
		return
	stage = "room_host_ui_login"
	if not main_node.call("_open_ui_screen", "network_match"):
		_fail("network screen open failed")
		return
	var room_host_login: Dictionary = await _accept_ui_row("gensoulkyo_login")
	if not bool(room_host_login.get("ok", false)):
		_fail("room host UI login failed %s" % [room_host_login])
		return
	stage = "room_ui_cancel_probe_create"
	var cancel_probe_create: Dictionary = await _accept_ui_row("gensoulkyo_create_room")
	var cancel_probe_ticket := String(api_model.current_ticket_id)
	if not bool(cancel_probe_create.get("ok", false)) or cancel_probe_ticket.is_empty():
		_fail("cancel probe create failed %s" % [cancel_probe_create])
		return
	stage = "room_ui_cancel_probe"
	var cancel_probe: Dictionary = await _accept_ui_row("gensoulkyo_cancel_ticket")
	if not bool(cancel_probe.get("ok", false)) or String(matchmaking_model.queue_status) != "cancelled" or String(matchmaking_model.room_status) != "cancelled":
		_fail("cancel probe failed %s queue=%s room=%s" % [cancel_probe, String(matchmaking_model.queue_status), String(matchmaking_model.room_status)])
		return
	var room_host_token := String(api_model.session_token)
	stage = "room_ui_create"
	var room_create: Dictionary = await _accept_ui_row("gensoulkyo_create_room")
	var room_code := String(room_create.get("room_code", api_model.current_room_code))
	var room_ticket := String(api_model.current_ticket_id)
	if not bool(room_create.get("ok", false)) or room_code.is_empty() or String(matchmaking_model.room_status) != "waiting" or room_ticket.is_empty():
		_fail("room UI create failed %s room %s ticket %s" % [room_create, room_code, room_ticket])
		return
	stage = "room_guest_login"
	var room_guest_login_request: Dictionary = api_model.anonymous_login_request("spellkard-room-guest", "Room Guest")
	var room_guest_login: Dictionary = await http_client.send_and_apply(room_guest_login_request)
	if not bool(room_guest_login.get("ok", false)):
		_fail("room guest login failed %s" % [room_guest_login])
		return
	stage = "room_ui_set_code"
	var set_room: Dictionary = await main_node.call("_gensoulkyo_set_pending_room_code", room_code)
	if not bool(set_room.get("ok", false)) or String(api_model.pending_join_room_code) != room_code:
		_fail("room UI set code failed %s" % [set_room])
		return
	stage = "room_ui_join"
	var room_join: Dictionary = await _accept_ui_row("gensoulkyo_join_room")
	if not bool(room_join.get("ok", false)) or String(matchmaking_model.active_match_id).is_empty() or String(matchmaking_model.room_status) != "found":
		_fail("room UI join failed %s" % [room_join])
		return
	var room_match_id := String(matchmaking_model.active_match_id)
	var room_guest_token := String(api_model.session_token)
	stage = "room_ui_ready_guest"
	var room_guest_ready: Dictionary = await _accept_ui_row("gensoulkyo_server_ready")
	if not bool(room_guest_ready.get("ok", false)):
		_fail("room UI guest ready failed %s" % [room_guest_ready])
		return
	stage = "room_ui_host_ticket"
	api_model.session_token = room_host_token
	api_model.current_ticket_id = room_ticket
	var host_ticket: Dictionary = await _accept_ui_row("gensoulkyo_poll_ticket")
	if not bool(host_ticket.get("ok", false)) or String(matchmaking_model.active_match_id) != room_match_id:
		_fail("room UI host ticket failed %s" % [host_ticket])
		return
	stage = "room_ui_ready_host"
	var room_host_ready: Dictionary = await _accept_ui_row("gensoulkyo_server_ready")
	if not bool(room_host_ready.get("ok", false)) or String(network_match_model.authority_state) != "running":
		_fail("room UI host ready failed %s authority %s" % [room_host_ready, String(network_match_model.authority_state)])
		return
	stage = "world_boss_mode_action"
	var boss_tokens: Array[String] = []
	var boss_users: Array[String] = []
	var boss_match_id := ""
	for i in range(4):
		var login_request: Dictionary = api_model.anonymous_login_request("spellkard-boss-%d" % i, "Boss %d" % i)
		var login_response: Dictionary = await http_client.send_and_apply(login_request)
		if not bool(login_response.get("ok", false)):
			_fail("boss login failed %s" % [login_response])
			return
		boss_tokens.append(String(api_model.session_token))
		boss_users.append(String(api_model.user_id))
		var boss_join: Dictionary = await main_node.call("_gensoulkyo_join_queue", "world_boss")
		if not bool(boss_join.get("ok", false)):
			_fail("boss join failed %s" % [boss_join])
			return
		if not String(matchmaking_model.active_match_id).is_empty():
			boss_match_id = String(matchmaking_model.active_match_id)
	if boss_match_id.is_empty():
		_fail("boss match missing")
		return
	for i in range(boss_tokens.size()):
		api_model.session_token = boss_tokens[i]
		api_model.user_id = boss_users[i]
		var boss_ready: Dictionary = await main_node.call("_gensoulkyo_ready", boss_match_id)
		if not bool(boss_ready.get("ok", false)):
			_fail("boss ready failed %s" % [boss_ready])
			return
	api_model.session_token = boss_tokens[0]
	api_model.user_id = boss_users[0]
	network_match_model.begin_from_queue({"match_id": boss_match_id, "mode_id": "world_boss"})
	game_mode_model.configure_boss_party("world_boss", boss_users)
	var transfer_result: Dictionary = await main_node.call("_submit_boss_card_transfer_to_server", "world_boss", boss_users[0], boss_users[1], "focus_lens")
	if not bool(transfer_result.get("ok", false)) or not bool(transfer_result.get("server_authoritative", false)) or int(game_mode_model.world_boss_state.get("transferred_card_count", 0)) != 1:
		_fail("boss mode action failed %s state=%s" % [transfer_result, game_mode_model.world_boss_state])
		return
	var boss_settle: Dictionary = await main_node.call("_gensoulkyo_settle", boss_match_id)
	if not bool(boss_settle.get("ok", false)) or int(api_model.get("last_world_boss_hp")) > int(api_model.get("last_world_boss_max_hp")) or int(api_model.get("last_world_boss_attempts_left")) != 2 or not bool(game_mode_model.world_boss_state.get("server_authoritative", false)):
		_fail("boss settlement did not sync world boss result %s api_hp=%d/%d attempts=%d state=%s" % [boss_settle, int(api_model.get("last_world_boss_hp")), int(api_model.get("last_world_boss_max_hp")), int(api_model.get("last_world_boss_attempts_left")), game_mode_model.world_boss_state])
		return
	print("gensoulkyo_live_http_check ok: match=%s user=%s points=%d token2=%s" % [
		match_id,
		first_user,
		int(results_service_model.wallet.get("points", 0)),
		"%s room=%s guest=%s" % [
			second_token.substr(0, min(16, second_token.length())),
			room_code,
			room_guest_token.substr(0, min(16, room_guest_token.length())),
		],
	])
	quit(0)

func _accept_ui_row(row_id: String) -> Dictionary:
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 24)
	for i in range(rows.size()):
		if String(rows[i].get("id", "")) == row_id:
			main_node.call("_ui_set_cursor", i)
			return await main_node.call("_ui_accept_selected_async")
	return {"ok": false, "last_error_code": "row_missing", "row_id": row_id}

func _fail(message: String) -> void:
	push_error("Gensoulkyo live check failed at %s: %s" % [stage, message])
	failed = true
	quit(1)
