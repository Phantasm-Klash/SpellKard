class_name MatchmakingModel
extends RefCounted

const CLIENT_VERSION := "prototype-client-0"
const CONFIG_VERSION := "local-config-0"
const SERVER_CONFIG_VERSION := "local-config-0"
const RECONNECT_WINDOW_SECONDS := 30
const RANKED_MAX_PING_MS := 180
const RANKED_MAX_PACKET_LOSS := 0.03

var deck_builder: RefCounted = null
var session_id := ""
var account_id := ""
var login_kind := "anonymous_dev"
var login_status := "signed_in"
var server_status := "local_dev"
var client_version := CLIENT_VERSION
var config_version := CONFIG_VERSION
var server_config_version := SERVER_CONFIG_VERSION
var config_status := "current"
var profile := {}
var wallet := {}
var pulled_surfaces: Array[String] = []
var server_ticket_id := ""
var server_ruleset_version := ""
var battle_allocation: Dictionary = {}
var battle_ticket: Dictionary = {}
var battle_server_id := ""
var battle_endpoint := ""
var battle_player_id := ""
var battle_ticket_id := ""
var battle_ticket_status := "none"
var battle_ticket_expires_at_ms := 0
var room_code := ""
var room_status := "none"
var presence_status := "offline"
var last_presence_tick := -1
var last_presence_cursor := 0
var rematch_status := "none"
var rematch_source_match_id := ""
var rematch_new_match_id := ""
var rematch_accepted_count := 0
var rematch_required_players := 0

var selected_mode_id := "certification"
var queue_status := "idle"
var queue_mode_id := ""
var queue_joined_at_msec := 0
var queue_estimated_wait_seconds := 0
var player_ready := false
var active_match_id := ""
var active_deck_id := ""
var last_error_code := "none"

var connection_state := "connected"
var network_quality := "good"
var ping_ms := 42
var jitter_ms := 4
var packet_loss := 0.0
var reconnect_status := "none"
var reconnect_started_msec := 0
var reconnect_deadline_msec := 0
var local_result_authoritative := false

var mode_order: Array[String] = ["certification", "pvp_duel", "battle_royale", "world_boss", "instance_boss"]
var mode_configs: Dictionary = {}

func _init() -> void:
	mode_configs = _build_mode_configs()
	ensure_local_session()

func configure(builder: RefCounted) -> void:
	deck_builder = builder
	ensure_local_session()
	pull_local_bootstrap()
	_refresh_active_deck_id()

func ensure_local_session(kind: String = "anonymous_dev") -> Dictionary:
	if session_id.is_empty():
		var stamp := int(Time.get_unix_time_from_system())
		var ticks: int = Time.get_ticks_msec()
		account_id = "anon-%d" % stamp
		session_id = "local-session-%d" % ticks
	login_kind = kind
	login_status = "signed_in"
	server_status = "local_dev"
	config_status = _version_status()
	last_error_code = "none"
	return session_snapshot()

func pull_local_bootstrap() -> Dictionary:
	profile = {
		"player_id": account_id,
		"display_name": "Local Tester",
		"rank_points": 0,
		"reputation": 100,
		"top_percent": 1.0,
	}
	wallet = {
		"coins": 0,
		"card_dust": 0,
		"chest_keys": 0,
	}
	pulled_surfaces = ["profile", "wallet", "deck", "activities"]
	return {
		"profile": profile.duplicate(true),
		"wallet": wallet.duplicate(true),
		"surfaces": pulled_surfaces.duplicate(),
	}

func session_snapshot() -> Dictionary:
	return {
		"session_id": session_id,
		"account_id": account_id,
		"server_ticket_id": server_ticket_id,
		"battle_server_id": battle_server_id,
		"battle_endpoint": battle_endpoint,
		"battle_player_id": battle_player_id,
		"battle_ticket_id": battle_ticket_id,
		"battle_ticket_status": battle_ticket_status,
		"room_code": room_code,
		"room_status": room_status,
		"presence_status": presence_status,
		"last_presence_tick": last_presence_tick,
		"last_presence_cursor": last_presence_cursor,
		"login_kind": login_kind,
		"login_status": login_status,
		"server_status": server_status,
		"client_version": client_version,
		"config_version": config_version,
		"server_config_version": server_config_version,
		"config_status": config_status,
	}

func apply_server_session(session: Dictionary) -> Dictionary:
	session_id = String(session.get("session_token", session_id))
	account_id = String(session.get("user_id", account_id))
	login_kind = "gensoulkyo_anonymous"
	login_status = "signed_in"
	server_status = "gensoulkyo_http"
	if profile.is_empty():
		profile = {}
	profile["player_id"] = account_id
	profile["display_name"] = String(session.get("display_name", profile.get("display_name", "Local Tester")))
	last_error_code = "none"
	return session_snapshot()

func apply_server_bootstrap(snapshot: Dictionary) -> Dictionary:
	server_status = "gensoulkyo_http"
	server_ruleset_version = String(snapshot.get("ruleset_version", snapshot.get("ruleset", server_ruleset_version)))
	if snapshot.has("server_version"):
		server_config_version = String(snapshot.get("server_version", server_config_version))
	config_status = "current"
	if typeof(snapshot.get("wallet", {})) == TYPE_DICTIONARY:
		wallet = (snapshot.get("wallet", {}) as Dictionary).duplicate(true)
	if typeof(snapshot.get("decks", {})) == TYPE_DICTIONARY:
		apply_server_decks(snapshot.get("decks", {}))
	if typeof(snapshot.get("inventory", {})) == TYPE_DICTIONARY:
		pulled_surfaces.append("inventory")
	if typeof(snapshot.get("tasks", {})) == TYPE_DICTIONARY:
		pulled_surfaces.append("tasks")
	if typeof(snapshot.get("events", {})) == TYPE_DICTIONARY:
		pulled_surfaces.append("events")
	if typeof(snapshot.get("leaderboards", {})) == TYPE_DICTIONARY:
		pulled_surfaces.append("leaderboards")
	if typeof(snapshot.get("modes", [])) == TYPE_ARRAY:
		_apply_server_mode_configs(snapshot.get("modes", []))
	last_error_code = "none"
	return session_snapshot()

func apply_server_decks(snapshot: Dictionary) -> Dictionary:
	server_status = "gensoulkyo_http"
	active_deck_id = String(snapshot.get("active_deck_id", active_deck_id))
	if typeof(snapshot.get("decks", [])) == TYPE_ARRAY:
		if not pulled_surfaces.has("deck"):
			pulled_surfaces.append("deck")
	last_error_code = "none" if bool(snapshot.get("ok", true)) and bool(snapshot.get("server_authoritative", true)) else String(snapshot.get("reason", "decks_failed"))
	return session_snapshot()

func apply_server_deck_save(response: Dictionary) -> Dictionary:
	server_status = "gensoulkyo_http"
	active_deck_id = String(response.get("active_deck_id", active_deck_id))
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "deck_save_failed"))
	return session_snapshot()

func apply_server_wallet(snapshot: Dictionary) -> Dictionary:
	server_status = "gensoulkyo_http"
	if typeof(snapshot.get("wallet", {})) == TYPE_DICTIONARY:
		wallet = (snapshot.get("wallet", {}) as Dictionary).duplicate(true)
		if not pulled_surfaces.has("wallet"):
			pulled_surfaces.append("wallet")
	last_error_code = "none" if bool(snapshot.get("ok", true)) and bool(snapshot.get("server_authoritative", true)) else String(snapshot.get("reason", "wallet_failed"))
	return session_snapshot()

func apply_server_queue_response(response: Dictionary) -> Dictionary:
	server_status = "gensoulkyo_http"
	server_ticket_id = String(response.get("ticket_id", server_ticket_id))
	_apply_battle_contract(response)
	room_code = String(response.get("room_code", ""))
	room_status = String(response.get("room_status", "none"))
	queue_mode_id = String(response.get("mode_id", queue_mode_id if not queue_mode_id.is_empty() else selected_mode_id))
	queue_status = String(response.get("queue_status", queue_status))
	if response.has("match_id"):
		active_match_id = String(response.get("match_id", ""))
	elif queue_status == "queued" or queue_status == "cancelled":
		active_match_id = ""
		if typeof(response.get("battle_allocation", {})) != TYPE_DICTIONARY and typeof(response.get("battle_ticket", {})) != TYPE_DICTIONARY:
			_clear_battle_contract()
	queue_estimated_wait_seconds = int(response.get("estimated_wait_seconds", queue_estimated_wait_seconds))
	if queue_status == "cancelled":
		active_match_id = ""
		player_ready = false
		queue_joined_at_msec = 0
		queue_estimated_wait_seconds = 0
		room_status = String(response.get("room_status", room_status))
	if bool(response.get("ok", false)):
		last_error_code = "none"
	else:
		last_error_code = String(response.get("reason", "server_queue_failed"))
	return queue_snapshot(bool(response.get("ok", false)))

func apply_server_ready_response(response: Dictionary) -> Dictionary:
	server_status = "gensoulkyo_http"
	active_match_id = String(response.get("match_id", active_match_id))
	_apply_battle_contract(response)
	var ready_status := String(response.get("ready_status", queue_status))
	player_ready = bool(response.get("ok", false))
	queue_status = "ready" if ready_status == "running" else ready_status
	last_error_code = "none" if bool(response.get("ok", false)) else String(response.get("reason", "server_ready_failed"))
	return queue_snapshot(bool(response.get("ok", false)))

func apply_server_presence(response: Dictionary) -> Dictionary:
	server_status = "gensoulkyo_http"
	presence_status = String(response.get("presence_status", presence_status))
	last_presence_tick = int(response.get("match_tick", last_presence_tick))
	last_presence_cursor = int(response.get("latest_event_cursor", last_presence_cursor))
	server_ticket_id = String(response.get("ticket_id", server_ticket_id))
	room_code = String(response.get("room_code", room_code))
	room_status = String(response.get("room_status", room_status))
	queue_mode_id = String(response.get("mode_id", queue_mode_id if not queue_mode_id.is_empty() else selected_mode_id))
	if response.has("queue_status"):
		queue_status = String(response.get("queue_status", queue_status))
	if response.has("match_id"):
		active_match_id = String(response.get("match_id", active_match_id))
	if response.has("connected"):
		connection_state = "connected" if bool(response.get("connected", false)) else "reconnecting"
	if presence_status == "disconnected":
		reconnect_status = "reconnecting"
	elif presence_status == "in_match":
		reconnect_status = "none"
	player_ready = bool(response.get("ready", player_ready))
	local_result_authoritative = false
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "presence_failed"))
	return queue_snapshot(bool(response.get("ok", false)))

func apply_server_rematch(response: Dictionary) -> Dictionary:
	server_status = "gensoulkyo_http"
	_apply_battle_contract(response)
	rematch_status = String(response.get("rematch_status", rematch_status))
	rematch_source_match_id = String(response.get("match_id", rematch_source_match_id))
	rematch_new_match_id = String(response.get("new_match_id", rematch_new_match_id))
	rematch_accepted_count = int(response.get("accepted_count", rematch_accepted_count))
	rematch_required_players = int(response.get("required_players", rematch_required_players))
	queue_mode_id = String(response.get("mode_id", queue_mode_id if not queue_mode_id.is_empty() else selected_mode_id))
	if not rematch_new_match_id.is_empty():
		active_match_id = rematch_new_match_id
		queue_status = "found"
		player_ready = false
		server_ticket_id = ""
	else:
		active_match_id = rematch_source_match_id
		queue_status = "rematch_waiting"
	local_result_authoritative = false
	last_error_code = "none" if bool(response.get("ok", false)) and bool(response.get("server_authoritative", false)) else String(response.get("reason", "rematch_failed"))
	return queue_snapshot(bool(response.get("ok", false)))

func apply_battle_allocation(allocation: Dictionary) -> Dictionary:
	battle_allocation = allocation.duplicate(true)
	battle_server_id = String(allocation.get("battle_server_id", battle_server_id))
	battle_endpoint = String(allocation.get("endpoint", battle_endpoint))
	if allocation.has("match_id"):
		active_match_id = String(allocation.get("match_id", active_match_id))
	if allocation.has("mode_id"):
		queue_mode_id = String(allocation.get("mode_id", queue_mode_id if not queue_mode_id.is_empty() else selected_mode_id))
	if typeof(allocation.get("players", [])) == TYPE_ARRAY:
		battle_player_id = _player_id_from_allocation(allocation.get("players", []), account_id, battle_player_id)
	last_error_code = "none" if bool(allocation.get("ok", true)) and bool(allocation.get("server_authoritative", true)) else String(allocation.get("reason", "battle_allocation_failed"))
	return session_snapshot()

func apply_battle_ticket(signed_ticket: Dictionary) -> Dictionary:
	battle_ticket = signed_ticket.duplicate(true)
	battle_ticket_status = "signed" if bool(signed_ticket.get("ok", false)) and not String(signed_ticket.get("signature_hex", "")).is_empty() else "unsigned"
	var ticket_value: Variant = signed_ticket.get("ticket", {})
	if typeof(ticket_value) == TYPE_DICTIONARY:
		var ticket: Dictionary = ticket_value
		battle_ticket_id = String(ticket.get("ticket_id", battle_ticket_id))
		active_match_id = String(ticket.get("match_id", active_match_id))
		queue_mode_id = String(ticket.get("mode_id", queue_mode_id if not queue_mode_id.is_empty() else selected_mode_id))
		battle_server_id = String(ticket.get("battle_server_id", battle_server_id))
		battle_endpoint = String(ticket.get("endpoint", battle_endpoint))
		battle_player_id = String(ticket.get("player_id", battle_player_id))
		battle_ticket_expires_at_ms = int(ticket.get("expires_at_ms", battle_ticket_expires_at_ms))
	last_error_code = "none" if bool(signed_ticket.get("ok", false)) and bool(signed_ticket.get("server_authoritative", false)) else String(signed_ticket.get("reason", "battle_ticket_failed"))
	return session_snapshot()

func simulate_config_version(server_version: String) -> String:
	server_config_version = server_version
	config_status = _version_status()
	if config_status != "current":
		last_error_code = "config_mismatch"
	return config_status

func select_mode(mode_id: String) -> bool:
	if not mode_configs.has(mode_id):
		last_error_code = "mode_missing"
		return false
	selected_mode_id = mode_id
	last_error_code = "none"
	return true

func mode_config(mode_id: String) -> Dictionary:
	var mode_value: Variant = mode_configs.get(mode_id, {})
	if typeof(mode_value) != TYPE_DICTIONARY:
		return {}
	return (mode_value as Dictionary).duplicate(true)

func mode_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for mode_id in mode_order:
		var config: Dictionary = mode_config(mode_id)
		if config.is_empty():
			continue
		var gate: Dictionary = gate_for_mode(mode_id)
		rows.append({
			"id": mode_id,
			"label_key": str(config.get("label_key", "")),
			"value": _mode_card_value(mode_id, config, gate),
			"summary": str(config.get("summary", "")),
			"mode_category": str(config.get("mode_category", "pvp")),
			"matchmaking_kind": str(config.get("matchmaking_kind", "queue")),
			"mode_ruleset_version": str(config.get("mode_ruleset_version", "")),
			"min_players": int(config.get("min_players", 1)),
			"max_players": int(config.get("max_players", 1)),
			"card_pool_id": str(config.get("card_pool_id", "")),
			"reward_table_id": str(config.get("reward_table_id", "")),
			"ranked": bool(config.get("ranked", false)),
			"estimated_wait_seconds": int(config.get("estimated_wait_seconds", 0)),
			"selected": mode_id == selected_mode_id,
			"enabled": bool(gate.get("valid", false)),
			"blocked_reason": str(gate.get("reason", "none")),
		})
	return rows

func match_rows() -> Array[Dictionary]:
	_refresh_active_deck_id()
	var active_deck: Dictionary = _active_deck_snapshot()
	var selected_mode: Dictionary = mode_config(selected_mode_id)
	var deck_validation: Dictionary = _validate_active_deck(_deck_format_for_mode(selected_mode_id))
	var queue_wait: int = queue_elapsed_seconds() if queue_status == "queued" else 0
	return [
		{"id": "login_session", "label_key": "screen.login.session", "value": "%s %s" % [login_status, account_id], "enabled": login_status == "signed_in"},
		{"id": "server_status", "label_key": "screen.login.server", "value": "%s https_rpc+wss_stub" % server_status, "enabled": true},
		{"id": "battle_server", "label_key": "screen.network.gensoulkyo", "value": "%s %s" % [battle_server_id, battle_endpoint], "enabled": not battle_server_id.is_empty() or not battle_endpoint.is_empty()},
		{"id": "battle_ticket", "label_key": "screen.network.gensoulkyo", "value": "%s %s exp %d" % [battle_ticket_status, battle_ticket_id, battle_ticket_expires_at_ms], "enabled": battle_ticket_status != "none"},
		{"id": "presence", "label_key": "screen.network.gensoulkyo", "value": "%s tick %d cursor %d" % [presence_status, last_presence_tick, last_presence_cursor], "enabled": presence_status != "offline"},
		{"id": "config_version", "label_key": "screen.login.config", "value": "%s %s/%s" % [config_status, config_version, server_config_version], "enabled": config_status == "current"},
		{"id": "profile", "label_key": "screen.login.profile", "value": _profile_summary(), "enabled": true},
		{"id": "active_deck", "label_key": "screen.match.active_deck", "value": "%s %s" % [str(active_deck.get("name", "-")), _deck_status_text(deck_validation)], "enabled": bool(deck_validation.get("valid", false))},
		{"id": "matchmaking_quick", "label_key": "screen.match.quick", "value": "%s wait %ds" % [selected_mode_id, int(selected_mode.get("estimated_wait_seconds", 0))], "summary": "queue immediately with selected mode and active deck", "enabled": bool(deck_validation.get("valid", false)), "ui_action": "advance_queue"},
		{"id": "matchmaking_ranked", "label_key": "screen.match.ranked", "value": _matchmaking_option_value("certification"), "summary": "ranked certification queue with network-quality gate", "enabled": bool(gate_for_mode("certification").get("valid", false)), "ui_action": "queue_mode", "mode_id": "certification"},
		{"id": "matchmaking_pvp", "label_key": "screen.mode.pvp_duel", "value": _matchmaking_option_value("pvp_duel"), "summary": "open 1v1 PvP duel queue", "enabled": bool(gate_for_mode("pvp_duel").get("valid", false)), "ui_action": "queue_mode", "mode_id": "pvp_duel"},
		{"id": "matchmaking_boss", "label_key": "screen.match.boss_party", "value": _matchmaking_option_value("world_boss"), "summary": "party matchmaking for world and instance Boss modes", "enabled": bool(gate_for_mode("world_boss").get("valid", false)), "ui_action": "queue_mode", "mode_id": "world_boss"},
		{"id": "matchmaking_room", "label_key": "screen.match.room_code", "value": "%s %s" % [room_code if not room_code.is_empty() else "no room", room_status], "summary": "create or join a room through the network room page", "enabled": true, "screen": "network_match"},
		{"id": "selected_mode", "label_key": "screen.match.mode", "value": "%s %s" % [selected_mode_id, str(selected_mode.get("mode_ruleset_version", ""))], "enabled": not selected_mode.is_empty()},
		{"id": "network_quality", "label_key": "screen.match.network", "value": _network_summary(), "enabled": connection_state != "offline"},
		{"id": "queue_status", "label_key": "screen.match.status", "value": "%s %s" % [queue_status, last_error_code], "enabled": queue_status != "blocked"},
		{"id": "room_code", "label_key": "screen.match.status", "value": "%s %s" % [room_code, room_status], "enabled": not room_code.is_empty()},
		{"id": "rematch", "label_key": "screen.match.status", "value": "%s %d/%d %s" % [rematch_status, rematch_accepted_count, rematch_required_players, rematch_new_match_id], "enabled": rematch_status != "none"},
		{"id": "queue_wait", "label_key": "screen.match.wait", "value": "%ds/%ds" % [queue_wait, queue_estimated_wait_seconds], "enabled": queue_status == "queued"},
		{"id": "ready", "label_key": "screen.match.ready", "value": "ready" if player_ready else "pending", "enabled": queue_status == "found"},
		{"id": "reconnect_status", "label_key": "screen.match.reconnect", "value": _reconnect_summary(), "enabled": reconnect_status == "reconnecting"},
		{"id": "cancel", "label_key": "screen.match.cancel", "enabled": ["queued", "found", "ready", "blocked"].has(queue_status)},
	]

func join_queue(mode_id: String = "", mode_params: Dictionary = {}) -> Dictionary:
	var target_mode_id := selected_mode_id if mode_id.is_empty() else mode_id
	if not select_mode(target_mode_id):
		queue_status = "blocked"
		return queue_snapshot(false)
	if ["queued", "found", "ready"].has(queue_status):
		last_error_code = "already_queued"
		return queue_snapshot(false)
	var gate: Dictionary = gate_for_mode(target_mode_id)
	if not bool(gate.get("valid", false)):
		queue_status = "blocked"
		queue_mode_id = target_mode_id
		last_error_code = str(gate.get("reason", "blocked"))
		return queue_snapshot(false)
	var config: Dictionary = mode_config(target_mode_id)
	var active_deck: Dictionary = _active_deck_snapshot()
	queue_status = "queued"
	queue_mode_id = target_mode_id
	queue_joined_at_msec = Time.get_ticks_msec()
	queue_estimated_wait_seconds = int(config.get("estimated_wait_seconds", 0))
	player_ready = false
	active_match_id = ""
	room_code = ""
	room_status = "none"
	active_deck_id = str(active_deck.get("deck_id", ""))
	local_result_authoritative = false
	last_error_code = "none"
	return queue_snapshot(true, mode_params)

func cancel_queue() -> bool:
	if not ["queued", "found", "ready", "blocked"].has(queue_status):
		last_error_code = "queue_not_active"
		return false
	queue_status = "cancelled"
	queue_mode_id = ""
	queue_joined_at_msec = 0
	queue_estimated_wait_seconds = 0
	player_ready = false
	active_match_id = ""
	room_code = ""
	room_status = "none"
	last_error_code = "none"
	return true

func simulate_match_found() -> Dictionary:
	if queue_status != "queued":
		last_error_code = "queue_not_active"
		return queue_snapshot(false)
	active_match_id = "local-%s-%d" % [queue_mode_id, Time.get_ticks_msec()]
	queue_status = "found"
	player_ready = false
	last_error_code = "none"
	return queue_snapshot(true)

func ready() -> bool:
	if queue_status != "found":
		last_error_code = "match_not_found"
		return false
	player_ready = true
	queue_status = "ready"
	last_error_code = "none"
	return true

func queue_snapshot(ok: bool = true, mode_params: Dictionary = {}) -> Dictionary:
	return {
		"ok": ok,
		"session_id": session_id,
		"server_ticket_id": server_ticket_id,
		"battle_server_id": battle_server_id,
		"battle_endpoint": battle_endpoint,
		"battle_player_id": battle_player_id,
		"battle_ticket_id": battle_ticket_id,
		"battle_ticket_status": battle_ticket_status,
		"room_code": room_code,
		"room_status": room_status,
		"active_deck_id": active_deck_id,
		"mode_id": queue_mode_id if not queue_mode_id.is_empty() else selected_mode_id,
		"mode_params": mode_params.duplicate(true),
		"status": queue_status,
		"estimated_wait_seconds": queue_estimated_wait_seconds,
		"elapsed_seconds": queue_elapsed_seconds(),
		"match_id": active_match_id,
		"player_ready": player_ready,
		"last_error_code": last_error_code,
	}

func queue_elapsed_seconds() -> int:
	if queue_joined_at_msec <= 0:
		return 0
	var elapsed_msec: int = maxi(0, Time.get_ticks_msec() - queue_joined_at_msec)
	return int(float(elapsed_msec) / 1000.0)

func set_network_quality(new_ping_ms: int, new_packet_loss: float = 0.0, new_jitter_ms: int = 0) -> void:
	ping_ms = max(0, new_ping_ms)
	packet_loss = clampf(new_packet_loss, 0.0, 1.0)
	jitter_ms = max(0, new_jitter_ms)
	if ping_ms > 300 or packet_loss >= 0.08:
		network_quality = "bad"
	elif ping_ms > RANKED_MAX_PING_MS or packet_loss > RANKED_MAX_PACKET_LOSS:
		network_quality = "poor"
	elif ping_ms > 80 or packet_loss > 0.01 or jitter_ms > 25:
		network_quality = "fair"
	else:
		network_quality = "good"
	if connection_state == "offline":
		connection_state = "connected"

func ranked_quality_ok() -> bool:
	return connection_state == "connected" and ping_ms <= RANKED_MAX_PING_MS and packet_loss <= RANKED_MAX_PACKET_LOSS and network_quality != "bad"

func gate_for_mode(mode_id: String) -> Dictionary:
	var config: Dictionary = mode_config(mode_id)
	if config.is_empty():
		return {"valid": false, "reason": "mode_missing"}
	if login_status != "signed_in":
		return {"valid": false, "reason": "login_required"}
	if config_status != "current":
		return {"valid": false, "reason": "config_mismatch"}
	var validation: Dictionary = _validate_active_deck(_deck_format_for_mode(mode_id))
	if not bool(validation.get("valid", false)):
		return {
			"valid": false,
			"reason": "deck_invalid",
			"deck_reasons": validation.get("reasons", []),
		}
	if bool(config.get("ranked", false)) and not ranked_quality_ok():
		return {"valid": false, "reason": "network_low"}
	return {"valid": true, "reason": "none"}

func begin_reconnect(match_id: String = "") -> Dictionary:
	var target_match_id := active_match_id if match_id.is_empty() else match_id
	if target_match_id.is_empty():
		last_error_code = "match_missing"
		return reconnect_snapshot(false)
	active_match_id = target_match_id
	connection_state = "reconnecting"
	reconnect_status = "reconnecting"
	reconnect_started_msec = Time.get_ticks_msec()
	reconnect_deadline_msec = reconnect_started_msec + (RECONNECT_WINDOW_SECONDS * 1000)
	local_result_authoritative = false
	last_error_code = "none"
	return reconnect_snapshot(true)

func finish_reconnect(success: bool = true) -> Dictionary:
	if reconnect_status != "reconnecting":
		last_error_code = "reconnect_not_active"
		return reconnect_snapshot(false)
	if success:
		connection_state = "connected"
		reconnect_status = "restored"
		last_error_code = "none"
	else:
		connection_state = "offline"
		reconnect_status = "expired"
		last_error_code = "reconnect_expired"
	local_result_authoritative = false
	return reconnect_snapshot(success)

func reconnect_snapshot(ok: bool = true) -> Dictionary:
	return {
		"ok": ok,
		"match_id": active_match_id,
		"session_id": session_id,
		"connection_state": connection_state,
		"status": reconnect_status,
		"seconds_left": reconnect_seconds_left(),
		"local_result_authoritative": local_result_authoritative,
		"last_error_code": last_error_code,
	}

func reconnect_seconds_left() -> int:
	if reconnect_status != "reconnecting":
		return 0
	var remaining_msec: int = maxi(0, reconnect_deadline_msec - Time.get_ticks_msec())
	return int(ceil(float(remaining_msec) / 1000.0))

func summary() -> String:
	return "%s %s cfg %s net %s %dms queue %s mode %s" % [
		login_status,
		server_status,
		config_status,
		network_quality,
		ping_ms,
		queue_status,
		selected_mode_id,
	]

func _apply_server_mode_configs(modes: Array) -> void:
	for mode_value in modes:
		if typeof(mode_value) != TYPE_DICTIONARY:
			continue
		var mode: Dictionary = mode_value
		var mode_id := String(mode.get("mode_id", ""))
		if mode_id.is_empty():
			continue
		var config: Dictionary = mode_config(mode_id)
		if config.is_empty():
			config = {
				"label_key": "screen.mode.%s" % mode_id,
				"card_pool_id": "",
				"ranked": mode_id == "certification",
				"estimated_wait_seconds": 15,
				"action_types": ["ready", "reconnect"],
			}
		config["mode_ruleset_version"] = String(mode.get("mode_ruleset_version", config.get("mode_ruleset_version", "")))
		config["min_players"] = int(mode.get("min_players", config.get("min_players", 1)))
		config["max_players"] = int(mode.get("max_players", config.get("max_players", 1)))
		config["reward_table_id"] = String(mode.get("reward_table_id", config.get("reward_table_id", "")))
		mode_configs[mode_id] = config
		if not mode_order.has(mode_id):
			mode_order.append(mode_id)

func _apply_battle_contract(response: Dictionary) -> void:
	if typeof(response.get("battle_allocation", {})) == TYPE_DICTIONARY:
		var allocation: Dictionary = response.get("battle_allocation", {})
		if not allocation.is_empty():
			apply_battle_allocation(allocation)
	if typeof(response.get("battle_ticket", {})) == TYPE_DICTIONARY:
		var signed_ticket: Dictionary = response.get("battle_ticket", {})
		if not signed_ticket.is_empty():
			apply_battle_ticket(signed_ticket)

func _clear_battle_contract() -> void:
	battle_allocation = {}
	battle_ticket = {}
	battle_server_id = ""
	battle_endpoint = ""
	battle_player_id = ""
	battle_ticket_id = ""
	battle_ticket_status = "none"
	battle_ticket_expires_at_ms = 0

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

func _version_status() -> String:
	return "current" if config_version == server_config_version else "mismatch"

func _network_summary() -> String:
	return "%s %s %dms jitter %dms loss %.1f%%" % [
		connection_state,
		network_quality,
		ping_ms,
		jitter_ms,
		packet_loss * 100.0,
	]

func _reconnect_summary() -> String:
	if reconnect_status == "reconnecting":
		return "%s %ds" % [reconnect_status, reconnect_seconds_left()]
	return reconnect_status

func _profile_summary() -> String:
	return "%s rank %d rep %d" % [
		str(profile.get("display_name", "-")),
		int(profile.get("rank_points", 0)),
		int(profile.get("reputation", 0)),
	]

func _deck_status_text(validation: Dictionary) -> String:
	if bool(validation.get("valid", false)):
		return "ok"
	var reasons: Array = validation.get("reasons", [])
	return "invalid:%s" % ",".join(reasons)

func _refresh_active_deck_id() -> void:
	var active_deck: Dictionary = _active_deck_snapshot()
	active_deck_id = str(active_deck.get("deck_id", active_deck_id))

func _active_deck_snapshot() -> Dictionary:
	if deck_builder == null:
		return {}
	var snapshot_value: Variant = deck_builder.active_deck_snapshot()
	if typeof(snapshot_value) != TYPE_DICTIONARY:
		return {}
	return (snapshot_value as Dictionary).duplicate(true)

func _validate_active_deck(deck_format: String) -> Dictionary:
	if deck_builder == null:
		return {"valid": false, "reasons": ["deck.reason.missing"], "stats": {}, "format": deck_format}
	var snapshot: Dictionary = _active_deck_snapshot()
	var card_ids_value: Variant = snapshot.get("card_ids", [])
	var card_ids: Array = card_ids_value if typeof(card_ids_value) == TYPE_ARRAY else []
	var validation_value: Variant = deck_builder.validate_card_ids(card_ids, deck_format)
	if typeof(validation_value) != TYPE_DICTIONARY:
		return {"valid": false, "reasons": ["deck.reason.invalid"], "stats": {}, "format": deck_format}
	return (validation_value as Dictionary).duplicate(true)

func _deck_format_for_mode(mode_id: String) -> String:
	var config: Dictionary = mode_config(mode_id)
	return "ranked" if bool(config.get("ranked", false)) else "local_practice"

func _build_mode_configs() -> Dictionary:
	return {
		"certification": {
			"label_key": "screen.mode.certification",
			"summary": "ranked proof run for rating and top-30% qualification",
			"mode_category": "ranked",
			"matchmaking_kind": "ranked_queue",
			"mode_ruleset_version": "cert_s0_v1",
			"min_players": 1,
			"max_players": 2,
			"card_pool_id": "cert_local_s0",
			"reward_table_id": "cert_s0_rewards",
			"ranked": true,
			"estimated_wait_seconds": 15,
			"action_types": ["cast_card", "ready", "reconnect"],
		},
		"pvp_duel": {
			"label_key": "screen.mode.pvp_duel",
			"summary": "1v1 PvP duel using the active deck and battle server authority",
			"mode_category": "pvp",
			"matchmaking_kind": "quick_queue",
			"mode_ruleset_version": "pvp_duel_s0_v1",
			"min_players": 2,
			"max_players": 2,
			"card_pool_id": "pvp_duel_s0",
			"reward_table_id": "pvp_duel_s0_rewards",
			"ranked": false,
			"estimated_wait_seconds": 20,
			"action_types": ["cast_card", "ready", "reconnect"],
		},
		"battle_royale": {
			"label_key": "screen.mode.battle_royale",
			"summary": "5-10 player shared-pool PvP survival mode",
			"mode_category": "pvp",
			"matchmaking_kind": "multi_queue",
			"mode_ruleset_version": "br_s0_v1",
			"min_players": 5,
			"max_players": 10,
			"card_pool_id": "br_shared_s0",
			"reward_table_id": "br_s0_rewards",
			"ranked": false,
			"estimated_wait_seconds": 45,
			"action_types": ["cast_card", "select_round_card", "ready", "reconnect"],
		},
		"world_boss": {
			"label_key": "screen.mode.world_boss",
			"summary": "4-8 player persistent world Boss party window",
			"mode_category": "boss",
			"matchmaking_kind": "party_queue",
			"mode_ruleset_version": "world_boss_s0_v1",
			"min_players": 4,
			"max_players": 8,
			"card_pool_id": "boss_shared_s0",
			"reward_table_id": "world_boss_s0_rewards",
			"ranked": false,
			"estimated_wait_seconds": 60,
			"daily_attempts": 3,
			"action_types": ["cast_card", "transfer_card", "ready", "reconnect"],
		},
		"instance_boss": {
			"label_key": "screen.mode.instance_boss",
			"summary": "4-8 player instanced Boss clear and star conditions",
			"mode_category": "boss",
			"matchmaking_kind": "party_queue",
			"mode_ruleset_version": "instance_boss_s0_v1",
			"min_players": 4,
			"max_players": 8,
			"card_pool_id": "instance_boss_s0",
			"reward_table_id": "instance_boss_s0_rewards",
			"ranked": false,
			"estimated_wait_seconds": 30,
			"stars": 0,
			"action_types": ["cast_card", "transfer_card", "ready", "reconnect"],
		},
	}

func _mode_card_value(mode_id: String, config: Dictionary, gate: Dictionary) -> String:
	return "%s %d-%d wait %ds" % [
		"ready" if bool(gate.get("valid", false)) else str(gate.get("reason", "blocked")),
		int(config.get("min_players", 1)),
		int(config.get("max_players", 1)),
		int(config.get("estimated_wait_seconds", 0)),
	]

func _matchmaking_option_value(mode_id: String) -> String:
	var config: Dictionary = mode_config(mode_id)
	if config.is_empty():
		return "missing"
	var gate: Dictionary = gate_for_mode(mode_id)
	return _mode_card_value(mode_id, config, gate)
