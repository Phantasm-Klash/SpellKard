class_name GensoulkyoApiModel
extends RefCounted

const DEFAULT_BASE_URL := "http://127.0.0.1:7350"
const JSON_CONTENT_TYPE := "Content-Type: application/json"
const BUSINESS_ENVELOPE_VERSION := "business-v0-scaffold"
const BUSINESS_ENVELOPE_KEY_ID := "dev-business-envelope-v0"
const BUSINESS_ENVELOPE_MAX_SKEW_MS := 300000

var base_url := DEFAULT_BASE_URL
var session_token := ""
var user_id := ""
var display_name := "Local Tester"
var server_version := ""
var ruleset_version := ""
var connection_status := "configured"
var last_error_code := "none"
var last_http_status := 0
var last_endpoint := "none"
var current_ticket_id := ""
var current_match_id := ""
var current_mode_id := "certification"
var current_room_code := ""
var current_room_status := "none"
var battle_allocation: Dictionary = {}
var battle_ticket: Dictionary = {}
var battle_server_id := ""
var battle_endpoint := ""
var battle_player_id := ""
var battle_ticket_id := ""
var battle_ticket_key_id := ""
var battle_ticket_expires_at_ms := 0
var battle_ticket_status := "none"
var battle_result_status := "none"
var battle_result_hash := ""
var battle_result_replay_id := ""
var battle_result_key_id := ""
var battle_result_settlement_key := ""
var pending_join_room_code := ""
var last_presence_status := "unknown"
var last_heartbeat_match_tick := -1
var last_heartbeat_cursor := 0
var last_rematch_status := "none"
var last_rematch_match_id := ""
var last_rematch_new_match_id := ""
var last_rematch_accepted_count := 0
var last_rematch_required_players := 0
var last_inventory_count := 0
var last_deck_count := 0
var last_active_deck_id := ""
var last_deck_sync_status := "none"
var last_chest_pool_count := 0
var last_chest_result_count := 0
var last_chest_sync_status := "none"
var last_upgrade_card_id := ""
var last_upgrade_level := 0
var last_upgrade_cost := 0
var last_upgrade_status := "none"
var certification_profile: Dictionary = {}
var last_certification_status := "none"
var last_certification_rating := ""
var last_certification_rank_score := 0
var last_certification_percentile := 1.0
var last_certification_top30 := false
var last_certification_delta := 0
var world_boss_snapshot: Dictionary = {}
var last_world_boss_status := "none"
var last_world_boss_hp := 0
var last_world_boss_max_hp := 0
var last_world_boss_attempts_left := 0
var last_world_boss_announcement := false
var last_request: Dictionary = {}
var last_response: Dictionary = {}
var business_envelope_seq := 0
var last_business_envelope: Dictionary = {}
var last_business_envelope_status := "not_started"
var last_business_envelope_error := "none"
var last_verified_business_envelope_seq := 0
var seen_business_envelope_nonces: Dictionary = {}

func configure(endpoint: String = DEFAULT_BASE_URL) -> void:
	set_base_url(endpoint)
	connection_status = "configured"
	last_error_code = "none"
	_reset_business_envelope_state()

func set_base_url(endpoint: String) -> void:
	var trimmed := endpoint.strip_edges()
	base_url = DEFAULT_BASE_URL if trimmed.is_empty() else trimmed.trim_suffix("/")

func anonymous_login_request(device_id: String = "", requested_display_name: String = "Local Tester") -> Dictionary:
	var request := _request("POST", "/v1/auth/anonymous", {
		"device_id": device_id,
		"display_name": requested_display_name,
	}, false, "auth_anonymous")
	return _record_request(request)

func bootstrap_request() -> Dictionary:
	return _record_request(_request("GET", "/v1/bootstrap", {}, true, "bootstrap"))

func inventory_request() -> Dictionary:
	return _record_request(_request("GET", "/v1/inventory", {}, true, "inventory_read"))

func decks_request() -> Dictionary:
	return _record_request(_request("GET", "/v1/decks", {}, true, "decks_read"))

func save_deck_request(deck_snapshot: Dictionary, make_active: bool = true) -> Dictionary:
	var body := {
		"deck_id": String(deck_snapshot.get("deck_id", "")),
		"name": String(deck_snapshot.get("name", "")),
		"format": String(deck_snapshot.get("format", "local_practice")),
		"card_ids": _string_array(deck_snapshot.get("card_ids", [])),
		"active": make_active,
		"updated_at": String(deck_snapshot.get("updated_at", "")),
	}
	return _record_request(_request("POST", "/v1/decks/save", body, true, "deck_save"))

func chests_request() -> Dictionary:
	return _record_request(_request("GET", "/v1/chests", {}, true, "chests_read"))

func open_chest_request(pool_id: String = "local_basic", count: int = 1) -> Dictionary:
	var body := {
		"pool_id": pool_id,
		"count": clampi(count, 1, 10),
		"client_result_authoritative": false,
	}
	return _record_request(_request("POST", "/v1/chests/open", body, true, "chest_open"))

func upgrade_card_request(card_id: String, target_level: int = 0) -> Dictionary:
	var body := {
		"card_id": card_id.strip_edges(),
		"target_level": target_level,
		"client_result_authoritative": false,
	}
	return _record_request(_request("POST", "/v1/cards/upgrade", body, true, "card_upgrade"))

func heartbeat_request(ticket_id: String = "", match_id: String = "", client_tick: int = -1, last_event_cursor: int = -1) -> Dictionary:
	var target_ticket_id := current_ticket_id if ticket_id.is_empty() else ticket_id
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	var cursor := last_heartbeat_cursor if last_event_cursor < 0 else last_event_cursor
	var body := {
		"ticket_id": target_ticket_id,
		"match_id": target_match_id,
		"client_tick": client_tick,
		"last_event_cursor": cursor,
	}
	return _record_request(_request("POST", "/v1/presence/heartbeat", body, true, "presence_heartbeat"))

func join_queue_request(mode_id: String, deck_snapshot: Dictionary, mode_params: Dictionary = {}) -> Dictionary:
	var body := {
		"mode_id": mode_id,
		"active_deck_id": String(deck_snapshot.get("deck_id", "")),
		"deck_snapshot": _server_deck_snapshot(deck_snapshot),
		"mode_params": mode_params.duplicate(true),
	}
	return _record_request(_request("POST", "/v1/matchmaking/join", body, true, "matchmaking_join"))

func create_room_request(mode_id: String, deck_snapshot: Dictionary, mode_params: Dictionary = {}) -> Dictionary:
	var body := {
		"mode_id": mode_id,
		"active_deck_id": String(deck_snapshot.get("deck_id", "")),
		"deck_snapshot": _server_deck_snapshot(deck_snapshot),
		"mode_params": mode_params.duplicate(true),
	}
	return _record_request(_request("POST", "/v1/rooms/create", body, true, "room_create"))

func join_room_request(room_code: String, mode_id: String, deck_snapshot: Dictionary, mode_params: Dictionary = {}) -> Dictionary:
	set_pending_join_room_code(room_code)
	var body := {
		"mode_id": mode_id,
		"active_deck_id": String(deck_snapshot.get("deck_id", "")),
		"deck_snapshot": _server_deck_snapshot(deck_snapshot),
		"mode_params": mode_params.duplicate(true),
	}
	return _record_request(_request("POST", "/v1/rooms/%s/join" % room_code.strip_edges(), body, true, "room_join"))

func ticket_request(ticket_id: String = "") -> Dictionary:
	var target_ticket_id := current_ticket_id if ticket_id.is_empty() else ticket_id
	return _record_request(_request("GET", "/v1/matchmaking/tickets/%s" % target_ticket_id, {}, true, "matchmaking_ticket"))

func cancel_ticket_request(ticket_id: String = "") -> Dictionary:
	var target_ticket_id := current_ticket_id if ticket_id.is_empty() else ticket_id
	return _record_request(_request("POST", "/v1/matchmaking/tickets/%s/cancel" % target_ticket_id, {}, true, "matchmaking_cancel"))

func set_pending_join_room_code(room_code: String) -> String:
	pending_join_room_code = room_code.strip_edges().to_upper()
	return pending_join_room_code

func ready_request(match_id: String = "") -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	return _record_request(_request("POST", "/v1/matches/%s/ready" % target_match_id, {}, true, "match_ready"))

func battle_allocation_request(match_id: String = "") -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	return _record_request(_request("GET", "/v1/matches/%s/battle-allocation" % target_match_id, {}, true, "battle_allocation"))

func battle_ticket_request(match_id: String = "") -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	return _record_request(_request("POST", "/v1/matches/%s/battle-ticket" % target_match_id, {}, true, "battle_ticket"))

func battle_result_submit_request(signed_result: Dictionary) -> Dictionary:
	var body := {"signed_result": signed_result.duplicate(true)}
	return _record_request(_request("POST", "/v1/battle/results/submit", body, true, "battle_result_submit"))

func input_request(match_id: String, packet: Dictionary) -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	return _record_request(_request("POST", "/v1/matches/%s/input" % target_match_id, packet.duplicate(true), true, "match_input"))

func snapshot_request(match_id: String = "") -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	return _record_request(_request("GET", "/v1/matches/%s/snapshot" % target_match_id, {}, true, "match_snapshot"))

func events_request(match_id: String = "", after: int = -1, limit: int = 64) -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	var cursor := 0
	if after >= 0:
		cursor = after
	var capped_limit := clampi(limit, 1, 64)
	return _record_request(_request("GET", "/v1/matches/%s/events?after=%d&limit=%d" % [target_match_id, cursor, capped_limit], {}, true, "match_events"))

func mode_action_request(match_id: String, action_request: Dictionary) -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	var payload_value: Variant = action_request.get("payload", {})
	var payload := {}
	if typeof(payload_value) == TYPE_DICTIONARY:
		payload = (payload_value as Dictionary).duplicate(true)
	var body := {
		"mode_id": String(action_request.get("mode_id", current_mode_id)),
		"action_type": String(action_request.get("action_type", "")),
		"payload": payload,
		"client_result_authoritative": false,
	}
	return _record_request(_request("POST", "/v1/matches/%s/mode-action" % target_match_id, body, true, "match_mode_action"))

func disconnect_request(match_id: String = "") -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	return _record_request(_request("POST", "/v1/matches/%s/disconnect" % target_match_id, {}, true, "match_disconnect"))

func reconnect_request(match_id: String = "") -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	return _record_request(_request("POST", "/v1/matches/%s/reconnect" % target_match_id, {}, true, "match_reconnect"))

func settle_request(match_id: String = "") -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	return _record_request(_request("POST", "/v1/matches/%s/settle" % target_match_id, {}, true, "match_settle"))

func rematch_request(match_id: String = "") -> Dictionary:
	var target_match_id := current_match_id if match_id.is_empty() else match_id
	return _record_request(_request("POST", "/v1/matches/%s/rematch" % target_match_id, {}, true, "match_rematch"))

func replay_request(replay_id: String) -> Dictionary:
	return _record_request(_request("GET", "/v1/replays/%s" % replay_id.strip_edges(), {}, true, "replay_read"))

func activity_claim_request(claim_kind: String, claim_id: String) -> Dictionary:
	return _record_request(_request("POST", "/v1/activity/claim", {
		"claim_kind": claim_kind,
		"claim_id": claim_id,
	}, true, "activity_claim"))

func apply_login_response(response: Dictionary, matchmaking_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "auth_anonymous"
	session_token = String(response.get("session_token", session_token))
	user_id = String(response.get("user_id", user_id))
	display_name = String(response.get("display_name", display_name))
	connection_status = "authenticated" if not session_token.is_empty() else "auth_failed"
	last_error_code = "none" if connection_status == "authenticated" else "session_missing"
	if connection_status == "authenticated":
		_reset_business_envelope_state()
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_session"):
		matchmaking_model.apply_server_session(response)
	return _result(connection_status == "authenticated", "login", {"user_id": user_id, "session_token": session_token})

func apply_bootstrap_response(response: Dictionary, matchmaking_model: RefCounted = null, deck_builder: RefCounted = null, chest_system: RefCounted = null, game_mode_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "bootstrap"
	server_version = String(response.get("server_version", server_version))
	ruleset_version = String(response.get("ruleset_version", response.get("ruleset", ruleset_version)))
	if not String(response.get("user_id", user_id)).is_empty():
		user_id = String(response.get("user_id", user_id))
	connection_status = "bootstrapped"
	last_error_code = "none"
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_bootstrap"):
		matchmaking_model.apply_server_bootstrap(response)
	if deck_builder != null:
		if typeof(response.get("inventory", {})) == TYPE_DICTIONARY and deck_builder.has_method("apply_server_inventory"):
			deck_builder.apply_server_inventory(response.get("inventory", {}))
		if typeof(response.get("decks", {})) == TYPE_DICTIONARY and deck_builder.has_method("apply_server_decks"):
			deck_builder.apply_server_decks(response.get("decks", {}))
	if chest_system != null and typeof(response.get("chests", {})) == TYPE_DICTIONARY and chest_system.has_method("apply_server_chests"):
		chest_system.apply_server_chests(response.get("chests", {}))
	if typeof(response.get("certification", {})) == TYPE_DICTIONARY:
		_apply_certification_profile(response.get("certification", {}), game_mode_model)
	if typeof(response.get("world_boss", {})) == TYPE_DICTIONARY:
		_apply_world_boss_snapshot(response.get("world_boss", {}), game_mode_model)
	_apply_inventory_deck_summary(response)
	_apply_chest_summary(response)
	return _result(true, "bootstrap", {
		"server_version": server_version,
		"ruleset_version": ruleset_version,
		"certification_rating": last_certification_rating,
		"certification_rank_score": last_certification_rank_score,
		"certification_top30": last_certification_top30,
		"world_boss_hp": last_world_boss_hp,
		"world_boss_attempts_left": last_world_boss_attempts_left,
	})

func apply_inventory_response(response: Dictionary, deck_builder: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "inventory_read"
	last_inventory_count = int(response.get("items", []).size()) if typeof(response.get("items", [])) == TYPE_ARRAY else 0
	last_deck_sync_status = "inventory"
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "inventory_failed"))
	var builder_result: Dictionary = {}
	if deck_builder != null and deck_builder.has_method("apply_server_inventory"):
		builder_result = deck_builder.apply_server_inventory(response)
		if not bool(builder_result.get("ok", false)):
			last_error_code = String(builder_result.get("reason", last_error_code))
	return _result(last_error_code == "none", "inventory", {"item_count": last_inventory_count, "builder": builder_result})

func apply_decks_response(response: Dictionary, deck_builder: RefCounted = null, matchmaking_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "decks_read"
	last_deck_count = int(response.get("decks", []).size()) if typeof(response.get("decks", [])) == TYPE_ARRAY else 0
	last_active_deck_id = String(response.get("active_deck_id", last_active_deck_id))
	last_deck_sync_status = "decks"
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "decks_failed"))
	var builder_result: Dictionary = {}
	if deck_builder != null and deck_builder.has_method("apply_server_decks"):
		builder_result = deck_builder.apply_server_decks(response)
		if not bool(builder_result.get("ok", false)):
			last_error_code = String(builder_result.get("reason", last_error_code))
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_decks"):
		matchmaking_model.apply_server_decks(response)
	return _result(last_error_code == "none", "decks", {"deck_count": last_deck_count, "active_deck_id": last_active_deck_id, "builder": builder_result})

func apply_deck_save_response(response: Dictionary, deck_builder: RefCounted = null, matchmaking_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "deck_save"
	last_active_deck_id = String(response.get("active_deck_id", last_active_deck_id))
	last_deck_sync_status = "saved"
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "deck_save_failed"))
	var builder_result: Dictionary = {}
	if deck_builder != null and deck_builder.has_method("apply_server_deck_save"):
		builder_result = deck_builder.apply_server_deck_save(response)
		if not bool(builder_result.get("ok", false)):
			last_error_code = String(builder_result.get("reason", last_error_code))
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_deck_save"):
		matchmaking_model.apply_server_deck_save(response)
	return _result(last_error_code == "none", "deck_save", {"active_deck_id": last_active_deck_id, "builder": builder_result})

func apply_chests_response(response: Dictionary, chest_system: RefCounted = null, matchmaking_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "chests_read"
	last_chest_pool_count = int(response.get("pools", []).size()) if typeof(response.get("pools", [])) == TYPE_ARRAY else 0
	last_chest_result_count = int(response.get("last_results", []).size()) if typeof(response.get("last_results", [])) == TYPE_ARRAY else 0
	last_chest_sync_status = "chests"
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "chests_failed"))
	var chest_result: Dictionary = {}
	if chest_system != null and chest_system.has_method("apply_server_chests"):
		chest_result = chest_system.apply_server_chests(response)
		if not bool(chest_result.get("ok", false)):
			last_error_code = String(chest_result.get("reason", last_error_code))
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_wallet"):
		matchmaking_model.apply_server_wallet(response)
	return _result(last_error_code == "none", "chests", {"pool_count": last_chest_pool_count, "result_count": last_chest_result_count, "chests": chest_result})

func apply_chest_open_response(response: Dictionary, chest_system: RefCounted = null, deck_builder: RefCounted = null, matchmaking_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "chest_open"
	last_chest_result_count = int(response.get("results", []).size()) if typeof(response.get("results", [])) == TYPE_ARRAY else 0
	last_chest_sync_status = "opened"
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) and not bool(response.get("client_result_authoritative", true)) else String(response.get("reason", "chest_open_failed"))
	var chest_result: Dictionary = {}
	if chest_system != null and chest_system.has_method("apply_server_chest_open"):
		chest_result = chest_system.apply_server_chest_open(response)
		if not bool(chest_result.get("ok", false)):
			last_error_code = String(chest_result.get("reason", last_error_code))
	if deck_builder != null and typeof(response.get("inventory", {})) == TYPE_DICTIONARY and deck_builder.has_method("apply_server_inventory"):
		var builder_result: Dictionary = deck_builder.apply_server_inventory(response.get("inventory", {}))
		if not bool(builder_result.get("ok", false)):
			last_error_code = String(builder_result.get("reason", last_error_code))
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_wallet"):
		matchmaking_model.apply_server_wallet(response)
	return _result(last_error_code == "none", "chest_open", {
		"pool_id": String(response.get("pool_id", "")),
		"count": int(response.get("count", last_chest_result_count)),
		"result_count": last_chest_result_count,
		"server_authoritative": bool(response.get("server_authoritative", false)),
		"chests": chest_result,
	})

func apply_card_upgrade_response(response: Dictionary, deck_builder: RefCounted = null, matchmaking_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "card_upgrade"
	last_upgrade_card_id = String(response.get("card_id", last_upgrade_card_id))
	last_upgrade_level = int(response.get("new_level", last_upgrade_level))
	last_upgrade_cost = 0
	var cost_source: Variant = response.get("cost", {})
	if typeof(cost_source) == TYPE_DICTIONARY:
		var cost_map: Dictionary = cost_source
		last_upgrade_cost = int(cost_map.get("card_dust", 0))
	last_upgrade_status = "upgraded"
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) and not bool(response.get("client_result_authoritative", true)) else String(response.get("reason", "card_upgrade_failed"))
	var builder_result: Dictionary = {}
	if deck_builder != null and deck_builder.has_method("apply_server_card_upgrade"):
		builder_result = deck_builder.apply_server_card_upgrade(response)
		if not bool(builder_result.get("ok", false)):
			last_error_code = String(builder_result.get("reason", last_error_code))
	elif deck_builder != null and typeof(response.get("inventory", {})) == TYPE_DICTIONARY and deck_builder.has_method("apply_server_inventory"):
		builder_result = deck_builder.apply_server_inventory(response.get("inventory", {}))
		if not bool(builder_result.get("ok", false)):
			last_error_code = String(builder_result.get("reason", last_error_code))
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_wallet"):
		matchmaking_model.apply_server_wallet(response)
	if last_error_code != "none":
		last_upgrade_status = "failed"
	return _result(last_error_code == "none", "card_upgrade", {
		"card_id": last_upgrade_card_id,
		"new_level": last_upgrade_level,
		"cost": last_upgrade_cost,
		"server_authoritative": bool(response.get("server_authoritative", false)),
		"builder": builder_result,
	})

func apply_heartbeat_response(response: Dictionary, matchmaking_model: RefCounted = null, network_match_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "presence_heartbeat"
	last_presence_status = String(response.get("presence_status", last_presence_status))
	current_ticket_id = String(response.get("ticket_id", current_ticket_id))
	if response.has("match_id"):
		current_match_id = String(response.get("match_id", current_match_id))
	current_mode_id = String(response.get("mode_id", current_mode_id))
	current_room_code = String(response.get("room_code", current_room_code))
	current_room_status = String(response.get("room_status", current_room_status))
	last_heartbeat_match_tick = int(response.get("match_tick", last_heartbeat_match_tick))
	last_heartbeat_cursor = int(response.get("latest_event_cursor", response.get("last_event_cursor", last_heartbeat_cursor)))
	connection_status = last_presence_status
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "heartbeat_failed"))
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_presence"):
		matchmaking_model.apply_server_presence(response)
	if network_match_model != null and network_match_model.has_method("apply_presence_heartbeat"):
		network_match_model.apply_presence_heartbeat(response)
	return _result(last_error_code == "none", "heartbeat", {
		"presence_status": last_presence_status,
		"match_id": current_match_id,
		"ticket_id": current_ticket_id,
		"match_tick": last_heartbeat_match_tick,
		"latest_event_cursor": last_heartbeat_cursor,
		"server_authoritative": bool(response.get("server_authoritative", false)),
	})

func apply_queue_response(response: Dictionary, matchmaking_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	if not ["matchmaking_join", "matchmaking_ticket", "matchmaking_cancel", "room_create", "room_join"].has(last_endpoint):
		last_endpoint = "matchmaking_join"
	current_ticket_id = String(response.get("ticket_id", current_ticket_id))
	var response_status := String(response.get("queue_status", "queued"))
	if response.has("match_id"):
		current_match_id = String(response.get("match_id", ""))
	elif response_status == "queued" or response_status == "cancelled":
		current_match_id = ""
		if typeof(response.get("battle_allocation", {})) != TYPE_DICTIONARY and typeof(response.get("battle_ticket", {})) != TYPE_DICTIONARY:
			_clear_battle_contract()
	current_mode_id = String(response.get("mode_id", current_mode_id))
	current_room_code = String(response.get("room_code", ""))
	current_room_status = String(response.get("room_status", "none"))
	connection_status = response_status
	_apply_battle_contract_from_response(response, matchmaking_model)
	if connection_status == "cancelled":
		current_match_id = ""
		current_room_status = String(response.get("room_status", current_room_status))
	last_error_code = "none" if bool(response.get("ok", false)) else String(response.get("reason", "queue_failed"))
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_queue_response"):
		matchmaking_model.apply_server_queue_response(response)
	return _result(bool(response.get("ok", false)), "queue", {
		"ticket_id": current_ticket_id,
		"match_id": current_match_id,
		"room_code": current_room_code,
		"battle_server_id": battle_server_id,
		"battle_endpoint": battle_endpoint,
		"battle_ticket_id": battle_ticket_id,
	})

func apply_ready_response(response: Dictionary, matchmaking_model: RefCounted = null, network_match_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "match_ready"
	current_match_id = String(response.get("match_id", current_match_id))
	connection_status = String(response.get("ready_status", "ready"))
	_apply_battle_contract_from_response(response, matchmaking_model)
	last_error_code = "none" if bool(response.get("ok", false)) else String(response.get("reason", "ready_failed"))
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_ready_response"):
		matchmaking_model.apply_server_ready_response(response)
	if network_match_model != null and typeof(response.get("match_start", {})) == TYPE_DICTIONARY:
		var match_start: Dictionary = response.get("match_start", {})
		if not match_start.is_empty():
			var queue_snapshot := {
				"match_id": String(match_start.get("match_id", current_match_id)),
				"mode_id": String(match_start.get("mode_id", current_mode_id)),
			}
			network_match_model.begin_from_queue(queue_snapshot)
			network_match_model.mark_loading_ready()
			network_match_model.receive_match_start(match_start)
			_apply_battle_contract_from_response(response, null, network_match_model)
			connection_status = "running"
	return _result(bool(response.get("ok", false)), "ready", {
		"match_id": current_match_id,
		"status": connection_status,
		"battle_server_id": battle_server_id,
		"battle_endpoint": battle_endpoint,
		"battle_ticket_id": battle_ticket_id,
	})

func apply_battle_allocation_response(response: Dictionary, matchmaking_model: RefCounted = null, network_match_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "battle_allocation"
	if response.has("match_id"):
		current_match_id = String(response.get("match_id", current_match_id))
	_apply_battle_allocation(response)
	if matchmaking_model != null and matchmaking_model.has_method("apply_battle_allocation"):
		matchmaking_model.apply_battle_allocation(battle_allocation)
	if network_match_model != null and network_match_model.has_method("apply_battle_allocation"):
		network_match_model.apply_battle_allocation(battle_allocation)
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "battle_allocation_failed"))
	return _result(last_error_code == "none", "battle_allocation", {
		"match_id": current_match_id,
		"battle_server_id": battle_server_id,
		"battle_endpoint": battle_endpoint,
	})

func apply_battle_ticket_response(response: Dictionary, matchmaking_model: RefCounted = null, network_match_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "battle_ticket"
	_apply_battle_ticket(response)
	if matchmaking_model != null and matchmaking_model.has_method("apply_battle_ticket"):
		matchmaking_model.apply_battle_ticket(battle_ticket)
	if network_match_model != null and network_match_model.has_method("apply_battle_ticket"):
		network_match_model.apply_battle_ticket(battle_ticket)
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "battle_ticket_failed"))
	return _result(last_error_code == "none", "battle_ticket", {
		"match_id": current_match_id,
		"battle_server_id": battle_server_id,
		"battle_endpoint": battle_endpoint,
		"battle_ticket_id": battle_ticket_id,
		"battle_player_id": battle_player_id,
	})

func apply_battle_result_submit_response(response: Dictionary, network_match_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "battle_result_submit"
	current_match_id = String(response.get("match_id", current_match_id))
	_apply_battle_result_submit(response)
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) and bool(response.get("accepted", false)) else String(response.get("error", response.get("reason", "battle_result_failed")))
	if network_match_model != null and network_match_model.has_method("apply_battle_result_submit_response"):
		var result: Dictionary = network_match_model.apply_battle_result_submit_response(response)
		if not bool(result.get("ok", false)):
			last_error_code = String(result.get("reason", last_error_code))
			battle_result_status = "rejected"
	return _result(last_error_code == "none", "battle_result_submit", {
		"match_id": current_match_id,
		"status": battle_result_status,
		"settlement_key": battle_result_settlement_key,
		"duplicate": bool(response.get("duplicate", false)),
		"result_hash": battle_result_hash,
		"replay_id": battle_result_replay_id,
		"key_id": battle_result_key_id,
	})

func apply_input_response(response: Dictionary, network_match_model: RefCounted = null, predicted_state: Dictionary = {}) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "match_input"
	last_error_code = String(response.get("reason", "none"))
	var accepted := bool(response.get("accepted", response.get("ok", false)))
	var snapshot_result: Dictionary = {}
	if accepted and network_match_model != null and typeof(response.get("snapshot", {})) == TYPE_DICTIONARY:
		var snapshot: Dictionary = response.get("snapshot", {})
		if not snapshot.is_empty():
			snapshot_result = network_match_model.receive_snapshot(snapshot, predicted_state)
	return _result(accepted, "input", {"snapshot": snapshot_result})

func apply_snapshot_response(response: Dictionary, network_match_model: RefCounted = null, predicted_state: Dictionary = {}) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "match_snapshot"
	if network_match_model == null:
		last_error_code = "network_model_missing"
		return _result(false, "snapshot", {})
	var snapshot_result: Dictionary = network_match_model.receive_snapshot(response, predicted_state)
	last_error_code = "none" if bool(snapshot_result.get("accepted", false)) else String(snapshot_result.get("reason", "snapshot_failed"))
	return _result(bool(snapshot_result.get("accepted", false)), "snapshot", snapshot_result)

func apply_events_response(response: Dictionary, network_match_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "match_events"
	current_match_id = String(response.get("match_id", current_match_id))
	if network_match_model == null or not network_match_model.has_method("receive_event_stream"):
		last_error_code = "network_model_missing"
		return _result(false, "events", {})
	var event_result: Dictionary = network_match_model.receive_event_stream(response)
	last_error_code = "none" if bool(event_result.get("ok", false)) else String(event_result.get("reason", "events_failed"))
	return _result(last_error_code == "none", "events", event_result)

func apply_mode_action_response(response: Dictionary, network_match_model: RefCounted = null, game_mode_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "match_mode_action"
	current_match_id = String(response.get("match_id", current_match_id))
	current_mode_id = String(response.get("mode_id", current_mode_id))
	var accepted := bool(response.get("accepted", false))
	last_error_code = "none" if accepted else String(response.get("reason", "mode_action_failed"))
	if network_match_model != null and typeof(response.get("event", {})) == TYPE_DICTIONARY:
		var event: Dictionary = response.get("event", {})
		if not event.is_empty():
			network_match_model.receive_event(event)
	if game_mode_model != null and typeof(response.get("mode_state", {})) == TYPE_DICTIONARY and game_mode_model.has_method("apply_server_mode_action_response"):
		game_mode_model.apply_server_mode_action_response(response)
	return _result(accepted, "mode_action", {
		"accepted": accepted,
		"match_id": current_match_id,
		"mode_id": current_mode_id,
		"action_id": String(response.get("action_id", "")),
		"action_type": String(response.get("action_type", "")),
		"status": String(response.get("status", "")),
		"reason": String(response.get("reason", "none")),
		"server_authoritative": bool(response.get("server_authoritative", false)),
		"client_result_authoritative": bool(response.get("client_result_authoritative", true)),
	})

func apply_disconnect_response(response: Dictionary, network_match_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "match_disconnect"
	current_match_id = String(response.get("match_id", current_match_id))
	connection_status = String(response.get("reconnect_status", "disconnected"))
	last_error_code = "none" if bool(response.get("ok", false)) else String(response.get("reason", "disconnect_failed"))
	if network_match_model != null:
		network_match_model.note_reconnect_result(false)
		if typeof(response.get("snapshot", {})) == TYPE_DICTIONARY:
			var snapshot: Dictionary = response.get("snapshot", {})
			if not snapshot.is_empty():
				network_match_model.receive_snapshot(snapshot, {})
	return _result(bool(response.get("ok", false)), "disconnect", {"match_id": current_match_id, "status": connection_status, "seconds_left": int(response.get("seconds_left", 0))})

func apply_reconnect_response(response: Dictionary, network_match_model: RefCounted = null, predicted_state: Dictionary = {}) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "match_reconnect"
	current_match_id = String(response.get("match_id", current_match_id))
	connection_status = String(response.get("reconnect_status", "restored"))
	last_error_code = "none" if bool(response.get("ok", false)) else String(response.get("reason", "reconnect_failed"))
	var reconnect_result: Dictionary = {}
	if network_match_model != null:
		reconnect_result = network_match_model.apply_reconnect_response(response, predicted_state)
		_apply_battle_contract_from_response(response, null, network_match_model)
		if not bool(reconnect_result.get("ok", false)):
			last_error_code = String(reconnect_result.get("reason", last_error_code))
	return _result(last_error_code == "none", "reconnect", {"match_id": current_match_id, "status": connection_status, "seconds_left": int(response.get("seconds_left", 0)), "snapshot": reconnect_result})

func apply_settle_response(response: Dictionary, network_match_model: RefCounted = null, results_service_model: RefCounted = null, game_mode_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "match_settle"
	connection_status = "settled"
	current_match_id = String(response.get("match_id", current_match_id))
	var network_ok := true
	if network_match_model != null:
		network_ok = network_match_model.receive_event(_match_end_event(response))
	var result_response: Dictionary = {}
	if results_service_model == null:
		last_error_code = "results_model_missing"
		return _result(false, "settle", {"result": result_response})
	result_response = results_service_model.apply_server_match_result(response)
	if typeof(response.get("mode_result", {})) == TYPE_DICTIONARY:
		var mode_result: Dictionary = response.get("mode_result", {})
		_apply_certification_result(mode_result, game_mode_model)
		_apply_boss_mode_result(String(response.get("mode", "")), mode_result, game_mode_model)
	last_error_code = "none" if network_ok and (result_response.is_empty() or bool(result_response.get("ok", false))) else "settle_failed"
	return _result(last_error_code == "none", "settle", {
		"result": result_response,
		"certification_rating": last_certification_rating,
		"certification_rank_score": last_certification_rank_score,
		"certification_top30": last_certification_top30,
		"certification_delta": last_certification_delta,
		"world_boss_hp": last_world_boss_hp,
		"world_boss_announcement": last_world_boss_announcement,
	})

func apply_rematch_response(response: Dictionary, matchmaking_model: RefCounted = null, network_match_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "match_rematch"
	last_rematch_match_id = String(response.get("match_id", last_rematch_match_id))
	last_rematch_new_match_id = String(response.get("new_match_id", last_rematch_new_match_id))
	last_rematch_status = String(response.get("rematch_status", last_rematch_status))
	last_rematch_accepted_count = int(response.get("accepted_count", last_rematch_accepted_count))
	last_rematch_required_players = int(response.get("required_players", last_rematch_required_players))
	current_mode_id = String(response.get("mode_id", current_mode_id))
	if not last_rematch_new_match_id.is_empty():
		current_match_id = last_rematch_new_match_id
		current_ticket_id = ""
	elif not last_rematch_match_id.is_empty():
		current_match_id = last_rematch_match_id
	connection_status = "rematch_%s" % last_rematch_status
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "rematch_failed"))
	if matchmaking_model != null and matchmaking_model.has_method("apply_server_rematch"):
		matchmaking_model.apply_server_rematch(response)
	if network_match_model != null and network_match_model.has_method("apply_rematch_response"):
		var rematch_result: Dictionary = network_match_model.apply_rematch_response(response)
		if not bool(rematch_result.get("ok", false)):
			last_error_code = String(rematch_result.get("reason", last_error_code))
	return _result(last_error_code == "none", "rematch", {
		"match_id": last_rematch_match_id,
		"new_match_id": last_rematch_new_match_id,
		"status": last_rematch_status,
		"accepted_count": last_rematch_accepted_count,
		"required_players": last_rematch_required_players,
		"server_authoritative": bool(response.get("server_authoritative", false)),
	})

func apply_replay_response(response: Dictionary, network_match_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "replay_read"
	var replay_ok := bool(response.get("ok", false)) and bool(response.get("server_authoritative", false))
	if network_match_model != null and network_match_model.has_method("receive_replay_record"):
		var record_result: Dictionary = network_match_model.receive_replay_record(response)
		replay_ok = replay_ok and bool(record_result.get("ok", false))
		last_error_code = "none" if replay_ok else String(record_result.get("reason", "replay_failed"))
	else:
		last_error_code = "network_model_missing"
		replay_ok = false
	return _result(replay_ok, "replay", {
		"replay_id": String(response.get("replay_id", "")),
		"match_id": String(response.get("match_id", "")),
		"state_hash": String(response.get("state_hash", "")),
		"event_count": int(response.get("event_count", 0)),
	})

func apply_activity_claim_response(response: Dictionary, results_service_model: RefCounted = null) -> Dictionary:
	last_response = response.duplicate(true)
	last_endpoint = "activity_claim"
	var result_response: Dictionary = {}
	if results_service_model != null:
		result_response = results_service_model.apply_server_activity_claim_result(response)
	last_error_code = "none" if result_response.is_empty() or bool(result_response.get("ok", false)) else String(result_response.get("reason", "claim_failed"))
	return _result(last_error_code == "none", "activity_claim", {"result": result_response})

func status_rows() -> Array[Dictionary]:
	return [
		{"id": "gensoulkyo_endpoint", "label_key": "screen.network.gensoulkyo", "value": base_url, "enabled": true},
		{"id": "gensoulkyo_session", "label_key": "screen.network.gensoulkyo", "value": "%s %s" % [connection_status, user_id], "enabled": not session_token.is_empty()},
		{"id": "gensoulkyo_business_envelope", "label_key": "screen.network.gensoulkyo", "value": business_envelope_summary(), "enabled": not last_business_envelope.is_empty()},
		{"id": "gensoulkyo_ticket", "label_key": "screen.network.gensoulkyo", "value": "%s %s" % [current_ticket_id, current_match_id], "enabled": not current_ticket_id.is_empty() or not current_match_id.is_empty()},
		{"id": "gensoulkyo_battle_server", "label_key": "screen.network.gensoulkyo", "value": "%s %s" % [battle_server_id, battle_endpoint], "enabled": not battle_server_id.is_empty() or not battle_endpoint.is_empty()},
		{"id": "gensoulkyo_battle_ticket", "label_key": "screen.network.gensoulkyo", "value": "%s %s exp %d" % [battle_ticket_status, battle_ticket_key_id, battle_ticket_expires_at_ms], "enabled": battle_ticket_status != "none"},
		{"id": "gensoulkyo_battle_result", "label_key": "screen.network.gensoulkyo", "value": "%s %s %s" % [battle_result_status, battle_result_settlement_key, battle_result_hash], "enabled": battle_result_status != "none"},
		{"id": "gensoulkyo_room", "label_key": "screen.network.gensoulkyo", "value": "%s %s" % [current_room_code, current_room_status], "enabled": not current_room_code.is_empty()},
		{"id": "gensoulkyo_pending_room", "label_key": "screen.network.gensoulkyo", "value": pending_join_room_code, "enabled": not pending_join_room_code.is_empty()},
		{"id": "gensoulkyo_presence", "label_key": "screen.network.gensoulkyo", "value": "%s tick %d cursor %d" % [last_presence_status, last_heartbeat_match_tick, last_heartbeat_cursor], "enabled": last_presence_status != "unknown"},
		{"id": "gensoulkyo_rematch_state", "label_key": "screen.network.gensoulkyo", "value": "%s %d/%d %s" % [last_rematch_status, last_rematch_accepted_count, last_rematch_required_players, last_rematch_new_match_id], "enabled": last_rematch_status != "none"},
		{"id": "gensoulkyo_decks", "label_key": "screen.network.gensoulkyo", "value": "%s inv %d decks %d active %s" % [last_deck_sync_status, last_inventory_count, last_deck_count, last_active_deck_id], "enabled": last_deck_sync_status != "none"},
		{"id": "gensoulkyo_chests", "label_key": "screen.network.gensoulkyo", "value": "%s pools %d results %d" % [last_chest_sync_status, last_chest_pool_count, last_chest_result_count], "enabled": last_chest_sync_status != "none"},
		{"id": "gensoulkyo_upgrades", "label_key": "screen.network.gensoulkyo", "value": "%s %s lv %d cost %d" % [last_upgrade_status, last_upgrade_card_id, last_upgrade_level, last_upgrade_cost], "enabled": last_upgrade_status != "none"},
		{"id": "gensoulkyo_certification", "label_key": "screen.mode.certification", "value": "%s rank %d top %.1f%% %s" % [last_certification_rating, last_certification_rank_score, last_certification_percentile * 100.0, "unlock" if last_certification_top30 else ""], "enabled": last_certification_status != "none"},
		{"id": "gensoulkyo_world_boss", "label_key": "screen.mode.boss.hp", "value": "%d/%d attempts %d %s" % [last_world_boss_hp, last_world_boss_max_hp, last_world_boss_attempts_left, "announced" if last_world_boss_announcement else ""], "enabled": last_world_boss_status != "none"},
		{"id": "gensoulkyo_contract", "label_key": "screen.network.gensoulkyo", "value": "%s %s" % [last_endpoint, last_error_code], "enabled": last_error_code == "none"},
	]

func summary() -> String:
	return "%s %s user %s match %s %s" % [
		base_url,
		connection_status,
		user_id,
		current_match_id,
		last_error_code,
	]

func business_envelope_summary() -> String:
	if last_business_envelope.is_empty():
		return "no envelope; login/auth request still uses plain HTTP fallback"
	return "scaffold %s seq %d op %s %s %s" % [
		String(last_business_envelope.get("version", BUSINESS_ENVELOPE_VERSION)),
		int(last_business_envelope.get("seq", 0)),
		String(last_business_envelope.get("op_code", "")),
		String(last_business_envelope.get("ciphertext_mode", "")),
		last_business_envelope_status if last_business_envelope_error == "none" else last_business_envelope_error,
	]

func validate_business_envelope(envelope: Dictionary, now_ms: int = 0, record_nonce: bool = true) -> Dictionary:
	if envelope.is_empty():
		last_business_envelope_status = "invalid"
		last_business_envelope_error = "envelope_missing"
		return {"ok": false, "reason": last_business_envelope_error}
	if String(envelope.get("version", "")) != BUSINESS_ENVELOPE_VERSION:
		last_business_envelope_status = "invalid"
		last_business_envelope_error = "version"
		return {"ok": false, "reason": last_business_envelope_error}
	var seq := int(envelope.get("seq", 0))
	if seq <= 0:
		last_business_envelope_status = "invalid"
		last_business_envelope_error = "seq_missing"
		return {"ok": false, "reason": last_business_envelope_error}
	if record_nonce and seq <= last_verified_business_envelope_seq:
		last_business_envelope_status = "replay_rejected"
		last_business_envelope_error = "seq_replay"
		return {"ok": false, "reason": last_business_envelope_error, "seq": seq}
	var timestamp_ms := int(envelope.get("timestamp_ms", 0))
	var check_now_ms := _now_ms() if now_ms <= 0 else now_ms
	if timestamp_ms <= 0:
		last_business_envelope_status = "invalid"
		last_business_envelope_error = "timestamp_missing"
		return {"ok": false, "reason": last_business_envelope_error, "seq": seq}
	if timestamp_ms < check_now_ms - BUSINESS_ENVELOPE_MAX_SKEW_MS:
		last_business_envelope_status = "replay_rejected"
		last_business_envelope_error = "timestamp_stale"
		return {"ok": false, "reason": last_business_envelope_error, "seq": seq, "timestamp_ms": timestamp_ms}
	if timestamp_ms > check_now_ms + BUSINESS_ENVELOPE_MAX_SKEW_MS:
		last_business_envelope_status = "replay_rejected"
		last_business_envelope_error = "timestamp_future"
		return {"ok": false, "reason": last_business_envelope_error, "seq": seq, "timestamp_ms": timestamp_ms}
	var nonce := String(envelope.get("nonce", ""))
	if nonce.is_empty():
		last_business_envelope_status = "invalid"
		last_business_envelope_error = "nonce_missing"
		return {"ok": false, "reason": last_business_envelope_error, "seq": seq}
	if record_nonce and seen_business_envelope_nonces.has(nonce):
		last_business_envelope_status = "replay_rejected"
		last_business_envelope_error = "nonce_replay"
		return {"ok": false, "reason": last_business_envelope_error, "seq": seq, "nonce": nonce}
	if String(envelope.get("op_code", "")).is_empty() or String(envelope.get("auth_tag", "")).is_empty():
		last_business_envelope_status = "invalid"
		last_business_envelope_error = "auth_fields_missing"
		return {"ok": false, "reason": last_business_envelope_error, "seq": seq}
	if record_nonce:
		last_verified_business_envelope_seq = seq
		seen_business_envelope_nonces[nonce] = true
		if seen_business_envelope_nonces.size() > 128:
			seen_business_envelope_nonces.erase(seen_business_envelope_nonces.keys()[0])
	last_business_envelope_status = "validated_scaffold"
	last_business_envelope_error = "none"
	return {"ok": true, "reason": "none", "seq": seq, "nonce": nonce, "timestamp_ms": timestamp_ms}

func _server_deck_snapshot(deck_snapshot: Dictionary) -> Dictionary:
	return {
		"deck_id": String(deck_snapshot.get("deck_id", "")),
		"name": String(deck_snapshot.get("name", "")),
		"ruleset_version": String(deck_snapshot.get("ruleset_version", "")),
		"card_ids": _string_array(deck_snapshot.get("card_ids", [])),
	}

func _apply_inventory_deck_summary(response: Dictionary) -> void:
	if typeof(response.get("inventory", {})) == TYPE_DICTIONARY:
		var inventory: Dictionary = response.get("inventory", {})
		last_inventory_count = int(inventory.get("items", []).size()) if typeof(inventory.get("items", [])) == TYPE_ARRAY else last_inventory_count
	if typeof(response.get("decks", {})) == TYPE_DICTIONARY:
		var decks: Dictionary = response.get("decks", {})
		last_deck_count = int(decks.get("decks", []).size()) if typeof(decks.get("decks", [])) == TYPE_ARRAY else last_deck_count
		last_active_deck_id = String(decks.get("active_deck_id", last_active_deck_id))
	if last_inventory_count > 0 or last_deck_count > 0:
		last_deck_sync_status = "bootstrap"

func _apply_chest_summary(response: Dictionary) -> void:
	if typeof(response.get("chests", {})) != TYPE_DICTIONARY:
		return
	var chests: Dictionary = response.get("chests", {})
	last_chest_pool_count = int(chests.get("pools", []).size()) if typeof(chests.get("pools", [])) == TYPE_ARRAY else last_chest_pool_count
	last_chest_result_count = int(chests.get("last_results", []).size()) if typeof(chests.get("last_results", [])) == TYPE_ARRAY else last_chest_result_count
	last_chest_sync_status = "bootstrap"

func _apply_certification_profile(profile: Dictionary, game_mode_model: RefCounted = null) -> void:
	certification_profile = profile.duplicate(true)
	last_certification_status = "profile"
	last_certification_rating = String(profile.get("rating_code", last_certification_rating))
	last_certification_rank_score = int(profile.get("rank_score", last_certification_rank_score))
	last_certification_percentile = float(profile.get("percentile", last_certification_percentile))
	last_certification_top30 = bool(profile.get("next_certification_unlocked", profile.get("top_30_qualified", last_certification_top30)))
	last_certification_delta = int(profile.get("last_rank_score_delta", last_certification_delta))
	if game_mode_model != null and game_mode_model.has_method("apply_server_certification_profile"):
		game_mode_model.apply_server_certification_profile(profile)

func _apply_certification_result(mode_result: Dictionary, game_mode_model: RefCounted = null) -> void:
	if not mode_result.has("rating_code"):
		return
	last_certification_status = "settled"
	last_certification_rating = String(mode_result.get("rating_code", last_certification_rating))
	last_certification_rank_score = int(mode_result.get("rank_score_after", last_certification_rank_score))
	last_certification_percentile = float(mode_result.get("percentile_after", last_certification_percentile))
	last_certification_top30 = bool(mode_result.get("next_certification_unlocked", mode_result.get("qualified_top_30", last_certification_top30)))
	last_certification_delta = int(mode_result.get("rank_score_delta", last_certification_delta))
	certification_profile["rating_code"] = last_certification_rating
	certification_profile["rank_score"] = last_certification_rank_score
	certification_profile["percentile"] = last_certification_percentile
	certification_profile["next_certification_unlocked"] = last_certification_top30
	certification_profile["top_30_qualified"] = last_certification_top30
	certification_profile["last_rank_score_delta"] = last_certification_delta
	if game_mode_model != null and game_mode_model.has_method("apply_certification_result"):
		game_mode_model.apply_certification_result(mode_result)

func _apply_world_boss_snapshot(snapshot: Dictionary, game_mode_model: RefCounted = null) -> void:
	world_boss_snapshot = snapshot.duplicate(true)
	last_world_boss_status = "snapshot"
	last_world_boss_hp = int(snapshot.get("current_hp", last_world_boss_hp))
	last_world_boss_max_hp = int(snapshot.get("max_hp", last_world_boss_max_hp))
	last_world_boss_attempts_left = int(snapshot.get("daily_attempts_left", last_world_boss_attempts_left))
	last_world_boss_announcement = bool(snapshot.get("announcement_emitted", last_world_boss_announcement))
	if game_mode_model != null and game_mode_model.has_method("apply_server_world_boss_snapshot"):
		game_mode_model.apply_server_world_boss_snapshot(snapshot)

func _apply_boss_mode_result(mode_id: String, mode_result: Dictionary, game_mode_model: RefCounted = null) -> void:
	if mode_id == "world_boss" or mode_result.has("boss_instance_id"):
		last_world_boss_status = "settled"
		last_world_boss_hp = int(mode_result.get("boss_hp_after_global", last_world_boss_hp))
		last_world_boss_max_hp = int(mode_result.get("boss_max_hp", last_world_boss_max_hp))
		last_world_boss_attempts_left = int(mode_result.get("daily_attempts_left", last_world_boss_attempts_left))
		last_world_boss_announcement = bool(mode_result.get("world_announcement_emitted", last_world_boss_announcement))
		world_boss_snapshot["current_hp"] = last_world_boss_hp
		world_boss_snapshot["max_hp"] = last_world_boss_max_hp
		world_boss_snapshot["daily_attempts_left"] = last_world_boss_attempts_left
		world_boss_snapshot["announcement_emitted"] = last_world_boss_announcement
		if game_mode_model != null and game_mode_model.has_method("apply_world_boss_result"):
			game_mode_model.apply_world_boss_result(mode_result)
	elif mode_id == "instance_boss" and game_mode_model != null and game_mode_model.has_method("apply_instance_boss_result"):
		game_mode_model.apply_instance_boss_result(mode_result)

func _apply_battle_contract_from_response(response: Dictionary, matchmaking_model: RefCounted = null, network_match_model: RefCounted = null) -> void:
	if typeof(response.get("battle_allocation", {})) == TYPE_DICTIONARY:
		var allocation: Dictionary = response.get("battle_allocation", {})
		if not allocation.is_empty():
			_apply_battle_allocation(allocation)
			if matchmaking_model != null and matchmaking_model.has_method("apply_battle_allocation"):
				matchmaking_model.apply_battle_allocation(battle_allocation)
			if network_match_model != null and network_match_model.has_method("apply_battle_allocation"):
				network_match_model.apply_battle_allocation(battle_allocation)
	if typeof(response.get("battle_ticket", {})) == TYPE_DICTIONARY:
		var signed_ticket: Dictionary = response.get("battle_ticket", {})
		if not signed_ticket.is_empty():
			_apply_battle_ticket(signed_ticket)
			if matchmaking_model != null and matchmaking_model.has_method("apply_battle_ticket"):
				matchmaking_model.apply_battle_ticket(battle_ticket)
			if network_match_model != null and network_match_model.has_method("apply_battle_ticket"):
				network_match_model.apply_battle_ticket(battle_ticket)

func _clear_battle_contract() -> void:
	battle_allocation = {}
	battle_ticket = {}
	battle_server_id = ""
	battle_endpoint = ""
	battle_player_id = ""
	battle_ticket_id = ""
	battle_ticket_key_id = ""
	battle_ticket_expires_at_ms = 0
	battle_ticket_status = "none"
	battle_result_status = "none"
	battle_result_hash = ""
	battle_result_replay_id = ""
	battle_result_key_id = ""
	battle_result_settlement_key = ""

func _apply_battle_allocation(allocation: Dictionary) -> void:
	battle_allocation = allocation.duplicate(true)
	battle_server_id = String(allocation.get("battle_server_id", battle_server_id))
	battle_endpoint = String(allocation.get("endpoint", battle_endpoint))
	current_match_id = String(allocation.get("match_id", current_match_id))
	current_mode_id = String(allocation.get("mode_id", current_mode_id))
	if allocation.has("players") and typeof(allocation.get("players", [])) == TYPE_ARRAY:
		battle_player_id = _player_id_from_allocation(allocation.get("players", []), user_id, battle_player_id)

func _apply_battle_ticket(signed_ticket: Dictionary) -> void:
	battle_ticket = signed_ticket.duplicate(true)
	battle_ticket_status = "signed" if bool(signed_ticket.get("ok", false)) and not String(signed_ticket.get("signature_hex", "")).is_empty() else "unsigned"
	battle_ticket_key_id = String(signed_ticket.get("key_id", battle_ticket_key_id))
	var ticket_value: Variant = signed_ticket.get("ticket", {})
	if typeof(ticket_value) != TYPE_DICTIONARY:
		return
	var ticket: Dictionary = ticket_value
	battle_ticket_id = String(ticket.get("ticket_id", battle_ticket_id))
	current_match_id = String(ticket.get("match_id", current_match_id))
	current_mode_id = String(ticket.get("mode_id", current_mode_id))
	battle_server_id = String(ticket.get("battle_server_id", battle_server_id))
	battle_endpoint = String(ticket.get("endpoint", battle_endpoint))
	battle_player_id = String(ticket.get("player_id", battle_player_id))
	battle_ticket_expires_at_ms = int(ticket.get("expires_at_ms", battle_ticket_expires_at_ms))

func _apply_battle_result_submit(response: Dictionary) -> void:
	battle_result_status = "accepted" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) and bool(response.get("accepted", false)) else "rejected"
	battle_result_settlement_key = String(response.get("settlement_key", battle_result_settlement_key))
	if response.has("result_hash"):
		battle_result_hash = String(response.get("result_hash", battle_result_hash))
	if response.has("replay_id"):
		battle_result_replay_id = String(response.get("replay_id", battle_result_replay_id))
	if response.has("key_id"):
		battle_result_key_id = String(response.get("key_id", battle_result_key_id))

func _player_id_from_allocation(players_value: Variant, target_user_id: String, fallback: String = "") -> String:
	if typeof(players_value) != TYPE_ARRAY:
		return fallback
	var first_player_id := fallback
	for item in players_value as Array:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var player: Dictionary = item
		var player_id := String(player.get("player_id", ""))
		if first_player_id.is_empty():
			first_player_id = player_id
		if not target_user_id.is_empty() and String(player.get("user_id", "")) == target_user_id:
			return player_id
	return first_player_id

func _request(method: String, path: String, body: Dictionary, authenticated: bool, endpoint: String) -> Dictionary:
	var headers: Array[String] = [JSON_CONTENT_TYPE]
	if authenticated and not session_token.is_empty():
		headers.append("Authorization: Bearer %s" % session_token)
	var envelope := _business_envelope(method, path, body, authenticated, endpoint)
	if not envelope.is_empty():
		headers.append_array(_business_envelope_headers(envelope))
	return {
		"endpoint": endpoint,
		"method": method,
		"url": "%s%s" % [base_url, path],
		"headers": headers,
		"body": body.duplicate(true),
		"business_envelope": envelope,
		"authenticated": authenticated,
	}

func _record_request(request: Dictionary) -> Dictionary:
	last_request = request.duplicate(true)
	last_endpoint = String(request.get("endpoint", last_endpoint))
	return request

func _business_envelope(method: String, path: String, body: Dictionary, authenticated: bool, endpoint: String) -> Dictionary:
	if not authenticated or session_token.is_empty():
		return {}
	business_envelope_seq += 1
	var timestamp_ms := _now_ms()
	var body_json := JSON.stringify(body)
	var body_hash := body_json.sha256_text()
	var nonce := _business_nonce(endpoint, business_envelope_seq, timestamp_ms)
	var op_code := endpoint
	var tag_material := "%s|%d|%d|%s|%s|%s|%s" % [
		BUSINESS_ENVELOPE_VERSION,
		business_envelope_seq,
		timestamp_ms,
		nonce,
		op_code,
		body_hash,
		_session_id_hint(),
	]
	var envelope := {
		"version": BUSINESS_ENVELOPE_VERSION,
		"suite": "tls13_plus_x25519_hkdf_chacha20poly1305_ed25519_target",
		"status": "scaffold_no_production_crypto",
		"session_id": _session_id_hint(),
		"seq": business_envelope_seq,
		"timestamp_ms": timestamp_ms,
		"nonce": nonce,
		"op_code": op_code,
		"method": method.to_upper(),
		"path": path,
		"body_hash": body_hash,
		"body_ciphertext": "pending_aead:%s" % body_hash.substr(0, 24),
		"ciphertext_mode": "not_encrypted_http_fallback",
		"auth_tag": tag_material.sha256_text(),
		"auth_tag_kind": "scaffold_sha256_not_crypto_mac",
		"key_id": BUSINESS_ENVELOPE_KEY_ID,
		"key_agreement": "pending_x25519_ecdhe",
		"aead_alg": "pending_chacha20_poly1305",
		"sign_alg": "pending_ed25519",
	}
	last_business_envelope = envelope.duplicate(true)
	last_business_envelope_status = "built_scaffold"
	last_business_envelope_error = "none"
	return envelope

func _business_envelope_headers(envelope: Dictionary) -> Array[String]:
	return [
		"X-PhK-Business-Envelope: %s" % String(envelope.get("version", "")),
		"X-PhK-Business-Seq: %d" % int(envelope.get("seq", 0)),
		"X-PhK-Business-Timestamp-Ms: %d" % int(envelope.get("timestamp_ms", 0)),
		"X-PhK-Business-Nonce: %s" % String(envelope.get("nonce", "")),
		"X-PhK-Business-Op: %s" % String(envelope.get("op_code", "")),
		"X-PhK-Business-Key-Id: %s" % String(envelope.get("key_id", "")),
		"X-PhK-Business-Tag: %s" % String(envelope.get("auth_tag", "")),
		"X-PhK-Business-Mode: %s" % String(envelope.get("ciphertext_mode", "")),
	]

func _reset_business_envelope_state() -> void:
	business_envelope_seq = 0
	last_business_envelope = {}
	last_business_envelope_status = "not_started"
	last_business_envelope_error = "none"
	last_verified_business_envelope_seq = 0
	seen_business_envelope_nonces.clear()

func _business_nonce(endpoint: String, seq: int, timestamp_ms: int) -> String:
	var material := "%s:%d:%d:%d" % [endpoint, seq, timestamp_ms, Time.get_ticks_usec()]
	return material.sha256_text().substr(0, 32)

func _session_id_hint() -> String:
	if session_token.is_empty():
		return "anonymous"
	return "session:%s" % session_token.sha256_text().substr(0, 16)

func _now_ms() -> int:
	return int(Time.get_unix_time_from_system() * 1000.0)

func _result(ok: bool, action: String, extra: Dictionary = {}) -> Dictionary:
	var result := {"ok": ok, "action": action, "last_error_code": last_error_code}
	for key in extra.keys():
		result[key] = extra[key]
	return result

func _match_end_event(response: Dictionary) -> Dictionary:
	var event := response.duplicate(true)
	event["type"] = "match_end"
	return event

func _string_array(source: Variant) -> Array[String]:
	var values: Array[String] = []
	if typeof(source) != TYPE_ARRAY:
		return values
	for item in source as Array:
		values.append(str(item))
	return values
