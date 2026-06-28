class_name GensoulkyoHttpClient
extends Node

signal request_applied(result: Dictionary)

var api_model: RefCounted = null
var matchmaking_model: RefCounted = null
var network_match_model: RefCounted = null
var results_service_model: RefCounted = null
var game_mode_model: RefCounted = null
var deck_builder: RefCounted = null
var chest_system: RefCounted = null
var http_request: HTTPRequest = null
var busy := false
var last_transport_status := "idle"
var last_error_code := "none"
var last_http_status := 0
var last_endpoint := "none"
var last_url := ""
var last_response: Dictionary = {}

func _ready() -> void:
	if http_request == null:
		http_request = HTTPRequest.new()
		http_request.name = "GensoulkyoHTTPRequest"
		add_child(http_request)

func configure(api: RefCounted, matchmaking: RefCounted = null, network_match: RefCounted = null, results_service: RefCounted = null, builder: RefCounted = null, game_mode: RefCounted = null, chest: RefCounted = null) -> void:
	api_model = api
	matchmaking_model = matchmaking
	network_match_model = network_match
	results_service_model = results_service
	deck_builder = builder
	game_mode_model = game_mode
	chest_system = chest
	if http_request == null and is_inside_tree():
		_ready()

func status_rows() -> Array[Dictionary]:
	return [
		{"id": "gensoulkyo_transport", "label_key": "screen.network.gensoulkyo", "value": "%s http %d %s" % [last_transport_status, last_http_status, last_error_code], "enabled": last_error_code == "none"},
	]

func summary() -> String:
	return "%s %s %d %s" % [last_endpoint, last_transport_status, last_http_status, last_error_code]

func send_and_apply(request: Dictionary, predicted_state: Dictionary = {}) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	if http_request == null:
		_ready()
	if busy:
		return _transport_result(false, "busy", {})
	var url := String(request.get("url", ""))
	if url.is_empty():
		return _transport_result(false, "url_missing", {})
	var endpoint := String(request.get("endpoint", "unknown"))
	var method_id := _method_id(String(request.get("method", "GET")))
	var headers: PackedStringArray = _header_array(request.get("headers", []))
	var body_text := ""
	if method_id != HTTPClient.METHOD_GET and typeof(request.get("body", {})) == TYPE_DICTIONARY:
		body_text = JSON.stringify(request.get("body", {}))
	busy = true
	last_transport_status = "requesting"
	last_error_code = "none"
	last_http_status = 0
	last_endpoint = endpoint
	last_url = url
	var error := http_request.request(url, headers, method_id, body_text)
	if error != OK:
		busy = false
		return _transport_result(false, "request_%d" % int(error), {})
	var completed: Array = await http_request.request_completed
	busy = false
	var transport_result: Dictionary = _handle_completed(endpoint, completed, predicted_state)
	request_applied.emit(transport_result)
	return transport_result

func login_and_bootstrap(device_id: String = "spellkard-local", display_name: String = "Local Tester") -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	var login_request: Dictionary = api_model.anonymous_login_request(device_id, display_name)
	var login_result: Dictionary = await send_and_apply(login_request)
	if not bool(login_result.get("ok", false)):
		return login_result
	var bootstrap_request: Dictionary = api_model.bootstrap_request()
	return await send_and_apply(bootstrap_request)

func sync_inventory() -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.inventory_request())

func sync_decks() -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.decks_request())

func sync_chests() -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.chests_request())

func save_active_deck(make_active: bool = true) -> Dictionary:
	if api_model == null or deck_builder == null:
		return _transport_result(false, "missing_dependency", {})
	var deck_snapshot_value: Variant = deck_builder.active_deck_snapshot()
	if typeof(deck_snapshot_value) != TYPE_DICTIONARY:
		return _transport_result(false, "deck_snapshot_invalid", {})
	return await send_and_apply(api_model.save_deck_request(deck_snapshot_value as Dictionary, make_active))

func open_chest(pool_id: String = "local_basic", count: int = 1) -> Dictionary:
	if api_model == null or chest_system == null:
		return _transport_result(false, "missing_dependency", {})
	return await send_and_apply(api_model.open_chest_request(pool_id, count))

func upgrade_card(card_id: String, target_level: int = 0) -> Dictionary:
	if api_model == null or deck_builder == null:
		return _transport_result(false, "missing_dependency", {})
	if card_id.strip_edges().is_empty():
		return _transport_result(false, "card_id_missing", {})
	return await send_and_apply(api_model.upgrade_card_request(card_id, target_level))

func heartbeat(ticket_id: String = "", match_id: String = "", client_tick: int = -1, last_event_cursor: int = -1) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	var target_cursor := last_event_cursor
	if target_cursor < 0 and network_match_model != null:
		target_cursor = int(network_match_model.get("event_stream_cursor"))
	return await send_and_apply(api_model.heartbeat_request(ticket_id, match_id, client_tick, target_cursor))

func join_queue(mode_id: String, mode_params: Dictionary = {}) -> Dictionary:
	if api_model == null or deck_builder == null:
		return _transport_result(false, "missing_dependency", {})
	var deck_snapshot_value: Variant = deck_builder.active_deck_snapshot()
	if typeof(deck_snapshot_value) != TYPE_DICTIONARY:
		return _transport_result(false, "deck_snapshot_invalid", {})
	var request: Dictionary = api_model.join_queue_request(mode_id, deck_snapshot_value as Dictionary, mode_params)
	return await send_and_apply(request)

func create_room(mode_id: String, mode_params: Dictionary = {}) -> Dictionary:
	if api_model == null or deck_builder == null:
		return _transport_result(false, "missing_dependency", {})
	var deck_snapshot_value: Variant = deck_builder.active_deck_snapshot()
	if typeof(deck_snapshot_value) != TYPE_DICTIONARY:
		return _transport_result(false, "deck_snapshot_invalid", {})
	var request: Dictionary = api_model.create_room_request(mode_id, deck_snapshot_value as Dictionary, mode_params)
	return await send_and_apply(request)

func join_room(room_code: String, mode_id: String, mode_params: Dictionary = {}) -> Dictionary:
	if api_model == null or deck_builder == null:
		return _transport_result(false, "missing_dependency", {})
	var deck_snapshot_value: Variant = deck_builder.active_deck_snapshot()
	if typeof(deck_snapshot_value) != TYPE_DICTIONARY:
		return _transport_result(false, "deck_snapshot_invalid", {})
	var request: Dictionary = api_model.join_room_request(room_code, mode_id, deck_snapshot_value as Dictionary, mode_params)
	return await send_and_apply(request)

func poll_ticket(ticket_id: String = "") -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.ticket_request(ticket_id))

func cancel_ticket(ticket_id: String = "") -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.cancel_ticket_request(ticket_id))

func ready_match(match_id: String = "") -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.ready_request(match_id))

func battle_allocation(match_id: String = "") -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.battle_allocation_request(match_id))

func battle_ticket(match_id: String = "") -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.battle_ticket_request(match_id))

func submit_battle_result(signed_result: Dictionary) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.battle_result_submit_request(signed_result))

func submit_input(match_id: String, packet: Dictionary, predicted_state: Dictionary = {}) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.input_request(match_id, packet), predicted_state)

func snapshot(match_id: String = "", predicted_state: Dictionary = {}) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.snapshot_request(match_id), predicted_state)

func poll_events(match_id: String = "", after: int = -1, limit: int = 64) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	var cursor := after
	if cursor < 0 and network_match_model != null:
		cursor = int(network_match_model.get("event_stream_cursor"))
	return await send_and_apply(api_model.events_request(match_id, cursor, limit))

func submit_mode_action(match_id: String, action_request: Dictionary) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	var target_match_id := match_id
	if target_match_id.is_empty() and network_match_model != null:
		target_match_id = String(network_match_model.get("match_id"))
	return await send_and_apply(api_model.mode_action_request(target_match_id, action_request))

func disconnect_match(match_id: String = "") -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.disconnect_request(match_id))

func reconnect_match(match_id: String = "", predicted_state: Dictionary = {}) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.reconnect_request(match_id), predicted_state)

func settle(match_id: String = "") -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.settle_request(match_id))

func rematch(match_id: String = "") -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	var target_match_id := match_id
	if target_match_id.is_empty() and network_match_model != null:
		target_match_id = String(network_match_model.get("match_id"))
	return await send_and_apply(api_model.rematch_request(target_match_id))

func fetch_replay(replay_id: String) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	if replay_id.strip_edges().is_empty():
		return _transport_result(false, "replay_id_missing", {})
	return await send_and_apply(api_model.replay_request(replay_id))

func claim_activity(claim_kind: String, claim_id: String) -> Dictionary:
	if api_model == null:
		return _transport_result(false, "missing_api", {})
	return await send_and_apply(api_model.activity_claim_request(claim_kind, claim_id))

func _handle_completed(endpoint: String, completed: Array, predicted_state: Dictionary) -> Dictionary:
	var result_code := int(completed[0])
	var response_code := int(completed[1])
	var body_bytes: PackedByteArray = completed[3]
	last_http_status = response_code
	if result_code != HTTPRequest.RESULT_SUCCESS:
		return _transport_result(false, "transport_%d" % result_code, {})
	var body_text := body_bytes.get_string_from_utf8()
	var parsed_value: Variant = JSON.parse_string(body_text)
	if typeof(parsed_value) != TYPE_DICTIONARY:
		return _transport_result(false, "json_invalid", {"body": body_text})
	var response: Dictionary = (parsed_value as Dictionary).duplicate(true)
	last_response = response.duplicate(true)
	if response_code < 200 or response_code >= 300:
		return _transport_result(false, String(response.get("error_code", "http_%d" % response_code)), {"response": response})
	var apply_result: Dictionary = _apply_response(endpoint, response, predicted_state)
	last_transport_status = "applied" if bool(apply_result.get("ok", false)) else "apply_failed"
	last_error_code = String(apply_result.get("last_error_code", "none"))
	return apply_result

func _apply_response(endpoint: String, response: Dictionary, predicted_state: Dictionary) -> Dictionary:
	match endpoint:
		"auth_anonymous":
			return api_model.apply_login_response(response, matchmaking_model)
		"bootstrap":
			return api_model.apply_bootstrap_response(response, matchmaking_model, deck_builder, chest_system, game_mode_model)
		"inventory_read":
			return api_model.apply_inventory_response(response, deck_builder)
		"decks_read":
			return api_model.apply_decks_response(response, deck_builder, matchmaking_model)
		"deck_save":
			return api_model.apply_deck_save_response(response, deck_builder, matchmaking_model)
		"chests_read":
			return api_model.apply_chests_response(response, chest_system, matchmaking_model)
		"chest_open":
			return api_model.apply_chest_open_response(response, chest_system, deck_builder, matchmaking_model)
		"card_upgrade":
			return api_model.apply_card_upgrade_response(response, deck_builder, matchmaking_model)
		"presence_heartbeat":
			return api_model.apply_heartbeat_response(response, matchmaking_model, network_match_model)
		"matchmaking_join", "matchmaking_ticket", "matchmaking_cancel", "room_create", "room_join":
			return api_model.apply_queue_response(response, matchmaking_model)
		"match_ready":
			return api_model.apply_ready_response(response, matchmaking_model, network_match_model)
		"battle_allocation":
			return api_model.apply_battle_allocation_response(response, matchmaking_model, network_match_model)
		"battle_ticket":
			return api_model.apply_battle_ticket_response(response, matchmaking_model, network_match_model)
		"battle_result_submit":
			return api_model.apply_battle_result_submit_response(response, network_match_model)
		"match_input":
			return api_model.apply_input_response(response, network_match_model, predicted_state)
		"match_snapshot":
			return api_model.apply_snapshot_response(response, network_match_model, predicted_state)
		"match_events":
			return api_model.apply_events_response(response, network_match_model)
		"match_mode_action":
			return api_model.apply_mode_action_response(response, network_match_model, game_mode_model)
		"match_disconnect":
			return api_model.apply_disconnect_response(response, network_match_model)
		"match_reconnect":
			return api_model.apply_reconnect_response(response, network_match_model, predicted_state)
		"match_settle":
			return api_model.apply_settle_response(response, network_match_model, results_service_model, game_mode_model)
		"match_rematch":
			return api_model.apply_rematch_response(response, matchmaking_model, network_match_model)
		"replay_read":
			return api_model.apply_replay_response(response, network_match_model)
		"activity_claim":
			return api_model.apply_activity_claim_response(response, results_service_model)
		_:
			return _transport_result(false, "endpoint_unknown", {"response": response})

func _transport_result(ok: bool, error_code: String, extra: Dictionary) -> Dictionary:
	last_error_code = "none" if ok else error_code
	last_transport_status = "ok" if ok else "failed"
	var result: Dictionary = {
		"ok": ok,
		"action": last_endpoint,
		"last_error_code": last_error_code,
		"http_status": last_http_status,
		"url": last_url,
	}
	for key in extra.keys():
		result[key] = extra[key]
	return result

func _method_id(method: String) -> HTTPClient.Method:
	match method.to_upper():
		"POST":
			return HTTPClient.METHOD_POST
		"PUT":
			return HTTPClient.METHOD_PUT
		"PATCH":
			return HTTPClient.METHOD_PATCH
		"DELETE":
			return HTTPClient.METHOD_DELETE
		_:
			return HTTPClient.METHOD_GET

func _header_array(source: Variant) -> PackedStringArray:
	var headers := PackedStringArray()
	if typeof(source) != TYPE_ARRAY:
		return headers
	for item in source as Array:
		headers.append(str(item))
	return headers
