class_name NetworkMatchModel
extends RefCounted

const INPUT_DELAY_MIN_TICKS := 2
const INPUT_DELAY_MAX_TICKS := 4
const SNAPSHOT_FULL := "full"
const SNAPSHOT_DELTA := "delta"
const SMALL_POSITION_ERROR := 8.0
const MEDIUM_POSITION_ERROR := 32.0
const LARGE_POSITION_ERROR := 96.0

const FORBIDDEN_CLIENT_FIELDS: Array[String] = [
	"score",
	"graze",
	"hit",
	"hits",
	"damage",
	"position",
	"reward",
	"rank_score",
	"boss_hp",
	"drop",
	"active_cards",
	"card_id",
	"energy",
	"hand",
]

var matchmaking_model: RefCounted = null
var match_id := ""
var mode_id := "certification"
var ruleset_version := ""
var server_seed := 0
var authority_state := "idle"
var connection_state := "disconnected"
var input_delay_ticks := INPUT_DELAY_MIN_TICKS
var next_input_seq := 1
var last_sent_tick := -1
var last_accepted_snapshot_tick := -1
var latest_state_hash := ""
var snapshot_kind := SNAPSHOT_FULL
var full_snapshot_requested := false
var last_full_snapshot_reason := "none"
var last_correction_type := "none"
var correction_count := 0
var hard_snap_count := 0
var late_input_count := 0
var rejected_input_count := 0
var resimulated_ticks := 0
var average_position_error := 0.0
var position_error_samples := 0
var perceived_hit_mismatch := 0
var reconnect_success_count := 0
var illegal_client_field_count := 0
var last_error_code := "none"

var input_packets: Array[Dictionary] = []
var server_snapshots: Array[Dictionary] = []
var server_bullets: Dictionary = {}
var server_active_cards: Dictionary = {}
var recent_server_events: Array[Dictionary] = []
var last_bullet_delta_count := 0
var last_event_count := 0
var last_active_card_count := 0
var event_stream_cursor := 0
var event_stream_latest_cursor := 0
var event_stream_has_more := false
var event_stream_snapshot_tick := -1
var presence_status := "unknown"
var presence_match_status := "unknown"
var presence_match_tick := -1
var presence_connected := false
var presence_reconnect_seconds_left := 0
var presence_last_client_tick := -1
var presence_latest_event_cursor := 0
var presence_server_authoritative := false
var rematch_status := "none"
var rematch_source_match_id := ""
var rematch_new_match_id := ""
var rematch_accepted_count := 0
var rematch_required_players := 0
var mode_state: Dictionary = {}
var server_loadout: Dictionary = {}
var final_result: Dictionary = {}
var replay_metadata: Dictionary = {}
var server_replay_record: Dictionary = {}
var battle_allocation: Dictionary = {}
var battle_ticket: Dictionary = {}
var battle_server_id := ""
var battle_endpoint := ""
var battle_player_id := ""
var battle_ticket_id := ""
var battle_ticket_status := "none"
var battle_ticket_expires_at_ms := 0
var battle_result_status := "none"
var battle_result_settlement_key := ""
var battle_result_hash := ""
var battle_result_replay_id := ""
var battle_result_key_id := ""
var battle_result_duplicate := false

func configure(matchmaking: RefCounted) -> void:
	matchmaking_model = matchmaking

func begin_from_queue(queue_snapshot: Dictionary) -> bool:
	var queued_match_id := str(queue_snapshot.get("match_id", ""))
	if queued_match_id.is_empty():
		last_error_code = "match_missing"
		return false
	match_id = queued_match_id
	mode_id = str(queue_snapshot.get("mode_id", mode_id))
	authority_state = "loading"
	connection_state = "connected"
	next_input_seq = 1
	last_sent_tick = -1
	last_accepted_snapshot_tick = -1
	latest_state_hash = ""
	server_seed = 0
	ruleset_version = _mode_ruleset_for(mode_id)
	snapshot_kind = SNAPSHOT_FULL
	full_snapshot_requested = false
	last_full_snapshot_reason = "none"
	last_correction_type = "none"
	correction_count = 0
	hard_snap_count = 0
	late_input_count = 0
	rejected_input_count = 0
	resimulated_ticks = 0
	average_position_error = 0.0
	position_error_samples = 0
	perceived_hit_mismatch = 0
	illegal_client_field_count = 0
	input_packets.clear()
	server_snapshots.clear()
	server_bullets.clear()
	server_active_cards.clear()
	recent_server_events.clear()
	last_bullet_delta_count = 0
	last_event_count = 0
	last_active_card_count = 0
	event_stream_cursor = 0
	event_stream_latest_cursor = 0
	event_stream_has_more = false
	event_stream_snapshot_tick = -1
	presence_status = "unknown"
	presence_match_status = "unknown"
	presence_match_tick = -1
	presence_connected = true
	presence_reconnect_seconds_left = 0
	presence_last_client_tick = -1
	presence_latest_event_cursor = 0
	presence_server_authoritative = false
	rematch_status = "none"
	rematch_source_match_id = ""
	rematch_new_match_id = ""
	rematch_accepted_count = 0
	rematch_required_players = 0
	mode_state = _default_mode_state(mode_id)
	server_loadout = {}
	final_result = {}
	replay_metadata = {}
	server_replay_record = {}
	battle_allocation = {}
	battle_ticket = {}
	battle_server_id = ""
	battle_endpoint = ""
	battle_player_id = ""
	battle_ticket_id = ""
	battle_ticket_status = "none"
	battle_ticket_expires_at_ms = 0
	battle_result_status = "none"
	battle_result_settlement_key = ""
	battle_result_hash = ""
	battle_result_replay_id = ""
	battle_result_key_id = ""
	battle_result_duplicate = false
	last_error_code = "none"
	_update_input_delay_from_network()
	return true

func mark_loading_ready() -> bool:
	if authority_state != "loading":
		last_error_code = "not_loading"
		return false
	authority_state = "ready"
	last_error_code = "none"
	return true

func receive_match_start(match_start: Dictionary) -> bool:
	if not match_start.has("match_id"):
		last_error_code = "match_start_missing_id"
		return false
	var incoming_match_id := str(match_start.get("match_id", ""))
	if not match_id.is_empty() and incoming_match_id != match_id:
		last_error_code = "match_id_mismatch"
		return false
	match_id = incoming_match_id
	server_seed = int(match_start.get("server_seed", server_seed))
	ruleset_version = str(match_start.get("ruleset_version", ruleset_version))
	server_loadout = _loadout_from_match_start(match_start)
	if typeof(match_start.get("battle_allocation", {})) == TYPE_DICTIONARY:
		var allocation: Dictionary = match_start.get("battle_allocation", {})
		if not allocation.is_empty():
			apply_battle_allocation(allocation)
	if match_start.has("stage_id"):
		mode_state["stage_id"] = String(match_start.get("stage_id", mode_state.get("stage_id", "")))
	authority_state = "running"
	connection_state = "connected"
	last_error_code = "none"
	return true

func apply_rematch_response(response: Dictionary) -> Dictionary:
	if not bool(response.get("ok", false)):
		last_error_code = str(response.get("reason", "rematch_failed"))
		return {"ok": false, "reason": last_error_code}
	if not bool(response.get("server_authoritative", false)):
		last_error_code = "rematch_not_authoritative"
		return {"ok": false, "reason": last_error_code}
	var source_match_id: String = str(response.get("match_id", rematch_source_match_id))
	var new_match_id: String = str(response.get("new_match_id", rematch_new_match_id))
	var status: String = str(response.get("rematch_status", rematch_status))
	var accepted_count: int = int(response.get("accepted_count", rematch_accepted_count))
	var required_players: int = int(response.get("required_players", rematch_required_players))
	rematch_source_match_id = source_match_id
	rematch_new_match_id = new_match_id
	rematch_status = status
	rematch_accepted_count = accepted_count
	rematch_required_players = required_players
	if response.has("loadout"):
		server_loadout = _loadout_from_value(response.get("loadout", server_loadout))
	if not rematch_new_match_id.is_empty():
		var rematch_mode_id := str(response.get("mode_id", mode_id))
		begin_from_queue({"match_id": rematch_new_match_id, "mode_id": rematch_mode_id})
		rematch_source_match_id = source_match_id
		rematch_new_match_id = new_match_id
		rematch_status = status
		rematch_accepted_count = accepted_count
		rematch_required_players = required_players
		if response.has("stage_id"):
			mode_state["stage_id"] = String(response.get("stage_id", mode_state.get("stage_id", "")))
		if response.has("loadout"):
			server_loadout = _loadout_from_value(response.get("loadout", server_loadout))
		if typeof(response.get("match_start", {})) == TYPE_DICTIONARY:
			var match_start: Dictionary = response.get("match_start", {})
			if not match_start.is_empty():
				mark_loading_ready()
				receive_match_start(match_start)
	last_error_code = "none"
	return {
		"ok": true,
		"status": rematch_status,
		"match_id": rematch_source_match_id,
		"new_match_id": rematch_new_match_id,
		"accepted_count": rematch_accepted_count,
		"required_players": rematch_required_players,
	}

func apply_battle_allocation(allocation: Dictionary) -> Dictionary:
	battle_allocation = allocation.duplicate(true)
	match_id = String(allocation.get("match_id", match_id))
	mode_id = String(allocation.get("mode_id", mode_id))
	battle_server_id = String(allocation.get("battle_server_id", battle_server_id))
	battle_endpoint = String(allocation.get("endpoint", battle_endpoint))
	if typeof(allocation.get("players", [])) == TYPE_ARRAY:
		var account_id := ""
		if matchmaking_model != null:
			account_id = String(matchmaking_model.get("account_id"))
		battle_player_id = _player_id_from_allocation(allocation.get("players", []), account_id, battle_player_id)
	last_error_code = "none" if bool(allocation.get("ok", true)) and bool(allocation.get("server_authoritative", true)) else String(allocation.get("reason", "battle_allocation_failed"))
	return {"ok": last_error_code == "none", "battle_server_id": battle_server_id, "endpoint": battle_endpoint, "player_id": battle_player_id}

func apply_battle_ticket(signed_ticket: Dictionary) -> Dictionary:
	battle_ticket = signed_ticket.duplicate(true)
	battle_ticket_status = "signed" if bool(signed_ticket.get("ok", false)) and not String(signed_ticket.get("signature_hex", "")).is_empty() else "unsigned"
	var ticket_value: Variant = signed_ticket.get("ticket", {})
	if typeof(ticket_value) == TYPE_DICTIONARY:
		var ticket: Dictionary = ticket_value
		battle_ticket_id = String(ticket.get("ticket_id", battle_ticket_id))
		match_id = String(ticket.get("match_id", match_id))
		mode_id = String(ticket.get("mode_id", mode_id))
		battle_server_id = String(ticket.get("battle_server_id", battle_server_id))
		battle_endpoint = String(ticket.get("endpoint", battle_endpoint))
		battle_player_id = String(ticket.get("player_id", battle_player_id))
		battle_ticket_expires_at_ms = int(ticket.get("expires_at_ms", battle_ticket_expires_at_ms))
	last_error_code = "none" if bool(signed_ticket.get("ok", false)) and bool(signed_ticket.get("server_authoritative", false)) else String(signed_ticket.get("reason", "battle_ticket_failed"))
	return {"ok": last_error_code == "none", "battle_ticket_id": battle_ticket_id, "status": battle_ticket_status, "player_id": battle_player_id}

func apply_battle_result_submit_response(response: Dictionary) -> Dictionary:
	if not bool(response.get("ok", false)):
		battle_result_status = "rejected"
		last_error_code = String(response.get("error", response.get("reason", "battle_result_failed")))
		return {"ok": false, "reason": last_error_code}
	if not bool(response.get("server_authoritative", false)):
		battle_result_status = "rejected"
		last_error_code = "battle_result_not_authoritative"
		return {"ok": false, "reason": last_error_code}
	if not bool(response.get("accepted", false)):
		battle_result_status = "rejected"
		last_error_code = String(response.get("error", response.get("reason", "battle_result_rejected")))
		return {"ok": false, "reason": last_error_code}
	var incoming_match_id := String(response.get("match_id", match_id))
	if not match_id.is_empty() and incoming_match_id != match_id:
		battle_result_status = "rejected"
		last_error_code = "battle_result_match_mismatch"
		return {"ok": false, "reason": last_error_code}
	match_id = incoming_match_id
	battle_result_status = "accepted"
	battle_result_settlement_key = String(response.get("settlement_key", battle_result_settlement_key))
	battle_result_duplicate = bool(response.get("duplicate", false))
	if response.has("result_hash"):
		battle_result_hash = String(response.get("result_hash", battle_result_hash))
	if response.has("replay_id"):
		battle_result_replay_id = String(response.get("replay_id", battle_result_replay_id))
	if response.has("key_id"):
		battle_result_key_id = String(response.get("key_id", battle_result_key_id))
	last_error_code = "none"
	return {
		"ok": true,
		"status": battle_result_status,
		"settlement_key": battle_result_settlement_key,
		"duplicate": battle_result_duplicate,
	}

func build_input_packet(tick: int, input_state: Dictionary, hand_size: int = 4) -> Dictionary:
	var card_slot := _normalize_card_slot(int(input_state.get("card_slot", -1)), hand_size)
	var packet := {
		"tick": tick,
		"seq": next_input_seq,
		"dir": int(input_state.get("direction_bits", input_state.get("dir", 0))),
		"slow": bool(input_state.get("slow_pressed", input_state.get("slow", false))),
		"shoot": bool(input_state.get("shoot_pressed", input_state.get("shoot", false))),
		"bomb": bool(input_state.get("bomb_pressed", input_state.get("bomb", false))),
		"card_slot": card_slot,
	}
	var validation: Dictionary = validate_outgoing_packet(packet, hand_size)
	if bool(validation.get("valid", false)):
		input_packets.append(packet.duplicate(true))
		next_input_seq += 1
		last_sent_tick = tick
		last_error_code = "none"
	else:
		rejected_input_count += 1
		last_error_code = str(validation.get("reason", "invalid_input"))
	return packet

func validate_outgoing_packet(packet: Dictionary, hand_size: int = 4) -> Dictionary:
	for field in FORBIDDEN_CLIENT_FIELDS:
		if packet.has(field):
			illegal_client_field_count += 1
			return {"valid": false, "reason": "forbidden_field", "field": field}
	var packet_tick := int(packet.get("tick", -1))
	if packet_tick <= last_sent_tick:
		return {"valid": false, "reason": "tick_not_monotonic"}
	var packet_seq := int(packet.get("seq", -1))
	if packet_seq != next_input_seq:
		return {"valid": false, "reason": "seq_invalid"}
	var dir_bits := int(packet.get("dir", 0))
	if dir_bits < 0 or dir_bits > 15:
		return {"valid": false, "reason": "dir_invalid"}
	var card_slot := int(packet.get("card_slot", -1))
	if card_slot >= hand_size:
		return {"valid": false, "reason": "card_slot_invalid"}
	if packet_tick + input_delay_ticks < last_accepted_snapshot_tick:
		late_input_count += 1
		return {"valid": false, "reason": "input_too_late"}
	return {"valid": true, "reason": "none"}

func receive_snapshot(snapshot: Dictionary, predicted_state: Dictionary = {}) -> Dictionary:
	if _snapshot_has_forbidden_client_result(snapshot):
		last_error_code = "snapshot_contains_client_result"
		return {"accepted": false, "correction": "reject", "reason": last_error_code}
	var incoming_match_id := str(snapshot.get("match_id", match_id))
	if not match_id.is_empty() and incoming_match_id != match_id:
		last_error_code = "snapshot_match_mismatch"
		return {"accepted": false, "correction": "reject", "reason": last_error_code}
	match_id = incoming_match_id
	var snapshot_tick := int(snapshot.get("tick", -1))
	if snapshot_tick < last_accepted_snapshot_tick:
		last_error_code = "snapshot_out_of_order"
		return {"accepted": false, "correction": "reject", "reason": last_error_code}
	var is_full := bool(snapshot.get("full", false))
	snapshot_kind = SNAPSHOT_FULL if is_full else SNAPSHOT_DELTA
	last_accepted_snapshot_tick = snapshot_tick
	latest_state_hash = str(snapshot.get("state_hash", latest_state_hash))
	server_loadout = _loadout_from_snapshot(snapshot)
	mode_state = _merge_mode_state(snapshot.get("mode_state", {}))
	var bullet_result: Dictionary = _apply_bullet_deltas(snapshot.get("bullets_delta", []), is_full)
	var card_result: Dictionary = _apply_active_cards(snapshot.get("active_cards", []))
	var event_result: Dictionary = _apply_snapshot_events(snapshot.get("events", []))
	server_snapshots.append(_snapshot_summary(snapshot))
	if server_snapshots.size() > 24:
		server_snapshots.pop_front()
	var correction: Dictionary = _classify_correction(snapshot, predicted_state)
	last_correction_type = str(correction.get("type", "none"))
	if last_correction_type != "none":
		correction_count += 1
	if last_correction_type == "hard_snap":
		hard_snap_count += 1
	if bool(correction.get("request_full", false)):
		request_full_snapshot(str(correction.get("reason", "correction")))
	var rewind_tick := int(correction.get("rewind_tick", snapshot_tick))
	var current_tick := int(predicted_state.get("tick", snapshot_tick))
	resimulated_ticks += max(0, current_tick - rewind_tick)
	authority_state = "running" if authority_state != "ended" else authority_state
	last_error_code = "none"
	return {
		"accepted": true,
		"correction": last_correction_type,
		"position_error": float(correction.get("position_error", 0.0)),
		"snapshot_tick": snapshot_tick,
		"request_full": full_snapshot_requested,
		"resimulated_ticks": int(correction.get("resimulated_ticks", max(0, current_tick - rewind_tick))),
		"bullet_result": bullet_result,
		"card_result": card_result,
		"event_result": event_result,
	}

func receive_event(event: Dictionary) -> bool:
	var event_type := str(event.get("type", ""))
	if event_type == "match_end":
		return receive_match_end(event)
	_record_server_event(event)
	if event_type == "hit_confirmed" and bool(event.get("client_predicted_miss", false)):
		perceived_hit_mismatch += 1
	if event.has("mode_state"):
		mode_state = _merge_mode_state(event.get("mode_state", {}))
	return true

func receive_event_stream(response: Dictionary) -> Dictionary:
	if not bool(response.get("ok", false)):
		last_error_code = str(response.get("reason", "events_failed"))
		return {"ok": false, "reason": last_error_code}
	var incoming_match_id := str(response.get("match_id", match_id))
	if not match_id.is_empty() and incoming_match_id != match_id:
		last_error_code = "event_match_mismatch"
		return {"ok": false, "reason": last_error_code}
	match_id = incoming_match_id
	event_stream_cursor = int(response.get("cursor", event_stream_cursor))
	event_stream_latest_cursor = int(response.get("latest_cursor", event_stream_latest_cursor))
	event_stream_has_more = bool(response.get("has_more", false))
	event_stream_snapshot_tick = int(response.get("snapshot_tick", event_stream_snapshot_tick))
	var applied := 0
	var events_value: Variant = response.get("events", [])
	if typeof(events_value) == TYPE_ARRAY:
		for item in events_value as Array:
			if typeof(item) != TYPE_DICTIONARY:
				continue
			if receive_event((item as Dictionary).duplicate(true)):
				applied += 1
	last_event_count = applied
	last_error_code = "none"
	return {
		"ok": true,
		"applied": applied,
		"cursor": event_stream_cursor,
		"latest_cursor": event_stream_latest_cursor,
		"has_more": event_stream_has_more,
	}

func apply_presence_heartbeat(response: Dictionary) -> Dictionary:
	if not bool(response.get("ok", false)):
		last_error_code = str(response.get("reason", "heartbeat_failed"))
		return {"ok": false, "reason": last_error_code}
	if not bool(response.get("server_authoritative", false)):
		last_error_code = "presence_not_authoritative"
		return {"ok": false, "reason": last_error_code}
	var incoming_match_id := str(response.get("match_id", match_id))
	if not match_id.is_empty() and not incoming_match_id.is_empty() and incoming_match_id != match_id:
		last_error_code = "presence_match_mismatch"
		return {"ok": false, "reason": last_error_code}
	if not incoming_match_id.is_empty():
		match_id = incoming_match_id
	mode_id = str(response.get("mode_id", mode_id))
	presence_status = str(response.get("presence_status", presence_status))
	presence_match_status = str(response.get("match_status", presence_match_status))
	presence_match_tick = int(response.get("match_tick", presence_match_tick))
	presence_connected = bool(response.get("connected", presence_connected))
	presence_reconnect_seconds_left = int(response.get("reconnect_seconds_left", presence_reconnect_seconds_left))
	presence_last_client_tick = int(response.get("last_client_tick", presence_last_client_tick))
	presence_latest_event_cursor = int(response.get("latest_event_cursor", presence_latest_event_cursor))
	presence_server_authoritative = true
	event_stream_latest_cursor = max(event_stream_latest_cursor, presence_latest_event_cursor)
	if response.has("loadout"):
		server_loadout = _loadout_from_value(response.get("loadout", server_loadout))
	if response.has("match_tick"):
		event_stream_snapshot_tick = max(event_stream_snapshot_tick, presence_match_tick)
	if presence_status == "in_match":
		connection_state = "connected"
		if authority_state == "idle":
			authority_state = "loading"
	elif presence_status == "disconnected":
		connection_state = "disconnected"
	elif presence_status == "ended":
		authority_state = "ended"
	last_error_code = "none"
	return {
		"ok": true,
		"presence_status": presence_status,
		"match_status": presence_match_status,
		"match_tick": presence_match_tick,
		"latest_event_cursor": presence_latest_event_cursor,
		"connected": presence_connected,
	}

func receive_match_end(result: Dictionary) -> bool:
	if not result.has("final_result") and not result.has("replay_id"):
		last_error_code = "result_missing"
		return false
	final_result = result.duplicate(true)
	authority_state = "ended"
	connection_state = "connected"
	replay_metadata = {
		"match_id": match_id,
		"ruleset_version": ruleset_version,
		"server_seed": server_seed,
		"mode_id": mode_id,
		"stage_id": str(result.get("stage_id", server_loadout.get("stage_id", ""))),
		"loadout": result.get("loadout", server_loadout),
		"replay_id": str(result.get("replay_id", "")),
		"final_result": result.get("final_result", {}),
		"authoritative": true,
	}
	last_error_code = "none"
	return true

func receive_replay_record(record: Dictionary) -> Dictionary:
	if not bool(record.get("ok", false)):
		last_error_code = str(record.get("reason", "replay_failed"))
		return {"ok": false, "reason": last_error_code}
	if not bool(record.get("server_authoritative", false)):
		last_error_code = "replay_not_authoritative"
		return {"ok": false, "reason": last_error_code}
	var replay_id := str(record.get("replay_id", ""))
	if replay_id.is_empty():
		last_error_code = "replay_id_missing"
		return {"ok": false, "reason": last_error_code}
	var incoming_match_id := str(record.get("match_id", match_id))
	if not match_id.is_empty() and incoming_match_id != match_id:
		last_error_code = "replay_match_mismatch"
		return {"ok": false, "reason": last_error_code}
	match_id = incoming_match_id
	server_replay_record = record.duplicate(true)
	server_loadout = _loadout_from_record(record)
	replay_metadata["replay_id"] = replay_id
	replay_metadata["server_replay_id"] = replay_id
	replay_metadata["stage_id"] = str(record.get("stage_id", server_loadout.get("stage_id", "")))
	replay_metadata["loadout"] = record.get("loadout", server_loadout)
	replay_metadata["state_hash"] = str(record.get("state_hash", ""))
	replay_metadata["event_count"] = int(record.get("event_count", 0))
	replay_metadata["input_count"] = int(record.get("input_count", 0))
	replay_metadata["audit_loaded"] = true
	last_error_code = "none"
	return {
		"ok": true,
		"replay_id": replay_id,
		"state_hash": str(record.get("state_hash", "")),
		"event_count": int(record.get("event_count", 0)),
		"input_count": int(record.get("input_count", 0)),
	}

func request_full_snapshot(reason: String) -> Dictionary:
	full_snapshot_requested = true
	last_full_snapshot_reason = reason
	return {
		"type": "request_full_snapshot",
		"match_id": match_id,
		"last_snapshot_tick": last_accepted_snapshot_tick,
		"reason": reason,
	}

func clear_full_snapshot_request() -> void:
	full_snapshot_requested = false
	last_full_snapshot_reason = "none"

func note_reconnect_result(success: bool) -> void:
	connection_state = "connected" if success else "disconnected"
	if success:
		reconnect_success_count += 1
		request_full_snapshot("reconnect")

func apply_reconnect_response(response: Dictionary, predicted_state: Dictionary = {}) -> Dictionary:
	if not bool(response.get("ok", false)):
		connection_state = "disconnected"
		last_error_code = str(response.get("reason", "reconnect_failed"))
		return {"ok": false, "reason": last_error_code}
	if typeof(response.get("match_start", {})) == TYPE_DICTIONARY:
		var match_start: Dictionary = response.get("match_start", {})
		if not match_start.is_empty():
			if match_id.is_empty():
				begin_from_queue({
					"match_id": String(match_start.get("match_id", response.get("match_id", ""))),
					"mode_id": String(match_start.get("mode_id", mode_id)),
				})
				mark_loading_ready()
			receive_match_start(match_start)
	var snapshot_result: Dictionary = {}
	if typeof(response.get("snapshot", {})) == TYPE_DICTIONARY:
		var snapshot: Dictionary = response.get("snapshot", {})
		if not snapshot.is_empty():
			snapshot_result = receive_snapshot(snapshot, predicted_state)
	connection_state = "connected"
	authority_state = "running" if authority_state != "ended" else authority_state
	reconnect_success_count += 1
	clear_full_snapshot_request()
	last_error_code = "none"
	return {
		"ok": true,
		"status": str(response.get("reconnect_status", "restored")),
		"snapshot": snapshot_result,
		"seconds_left": int(response.get("seconds_left", 0)),
	}

func update_latency_profile(ping_ms: int, packet_loss: float = 0.0, jitter_ms: int = 0) -> int:
	if matchmaking_model != null:
		matchmaking_model.set_network_quality(ping_ms, packet_loss, jitter_ms)
	_update_input_delay_from_values(ping_ms, packet_loss, jitter_ms)
	return input_delay_ticks

func status_rows() -> Array[Dictionary]:
	return [
		{"id": "authority", "label_key": "screen.network.authority", "value": authority_state, "enabled": true},
		{"id": "match", "label_key": "screen.network.match", "value": "%s %s seed %d" % [match_id, mode_id, server_seed], "enabled": not match_id.is_empty()},
		{"id": "battle_server", "label_key": "screen.network.gensoulkyo", "value": "%s %s player %s" % [battle_server_id, battle_endpoint, battle_player_id], "enabled": not battle_server_id.is_empty() or not battle_endpoint.is_empty()},
		{"id": "battle_ticket", "label_key": "screen.network.gensoulkyo", "value": "%s %s exp %d" % [battle_ticket_status, battle_ticket_id, battle_ticket_expires_at_ms], "enabled": battle_ticket_status != "none"},
		{"id": "battle_result", "label_key": "screen.network.gensoulkyo", "value": "%s %s %s" % [battle_result_status, battle_result_settlement_key, battle_result_hash], "enabled": battle_result_status != "none"},
		{"id": "server_loadout", "label_key": "screen.settings.stage_select", "value": "%s %s" % [String(server_loadout.get("stage_id", str(mode_state.get("stage_id", "-")))), String(server_loadout.get("character_id", "-"))], "enabled": not server_loadout.is_empty() or mode_state.has("stage_id")},
		{"id": "input_delay", "label_key": "screen.network.input_delay", "value": "%d ticks" % input_delay_ticks, "enabled": true},
		{"id": "input_stream", "label_key": "screen.network.input_stream", "value": "seq %d sent %d rejected %d late %d" % [next_input_seq, input_packets.size(), rejected_input_count, late_input_count], "enabled": true},
		{"id": "snapshot", "label_key": "screen.network.snapshot", "value": "%s tick %d hash %s" % [snapshot_kind, last_accepted_snapshot_tick, latest_state_hash], "enabled": last_accepted_snapshot_tick >= 0},
		{"id": "server_bullets", "label_key": "screen.network.server_bullets", "value": "active %d delta %d events %d" % [server_bullets.size(), last_bullet_delta_count, recent_server_events.size()], "enabled": server_bullets.size() > 0 or last_bullet_delta_count > 0},
		{"id": "server_cards", "label_key": "screen.network.server_cards", "value": "active %d last %d %s" % [server_active_cards.size(), last_active_card_count, server_active_card_summary()], "enabled": server_active_cards.size() > 0 or last_active_card_count > 0},
		{"id": "server_events", "label_key": "screen.network.server_events", "value": "cursor %d/%d last %d more %s" % [event_stream_cursor, event_stream_latest_cursor, last_event_count, event_stream_has_more], "enabled": event_stream_latest_cursor > 0 or last_event_count > 0},
		{"id": "presence", "label_key": "screen.network.gensoulkyo", "value": "%s %s tick %d cursor %d" % [presence_status, presence_match_status, presence_match_tick, presence_latest_event_cursor], "enabled": presence_server_authoritative},
		{"id": "rematch", "label_key": "screen.network.gensoulkyo", "value": "%s %d/%d %s" % [rematch_status, rematch_accepted_count, rematch_required_players, rematch_new_match_id], "enabled": rematch_status != "none"},
		{"id": "correction", "label_key": "screen.network.correction", "value": "%s count %d hard %d err %.2f resim %d" % [last_correction_type, correction_count, hard_snap_count, average_position_error, resimulated_ticks], "enabled": true},
		{"id": "full_snapshot", "label_key": "screen.network.full_snapshot", "value": "%s %s" % [full_snapshot_requested, last_full_snapshot_reason], "enabled": full_snapshot_requested},
		{"id": "mode_state", "label_key": "screen.network.mode_state", "value": mode_state_summary(), "enabled": not mode_state.is_empty()},
		{"id": "anti_cheat", "label_key": "screen.network.anti_cheat", "value": "illegal %d result_local false" % illegal_client_field_count, "enabled": illegal_client_field_count == 0},
		{"id": "online_replay", "label_key": "screen.network.online_replay", "value": str(replay_metadata.get("replay_id", "-")), "enabled": bool(replay_metadata.get("authoritative", false))},
		{"id": "server_replay", "label_key": "screen.network.online_replay", "value": "%s events %d inputs %d" % [str(replay_metadata.get("server_replay_id", "-")), int(replay_metadata.get("event_count", 0)), int(replay_metadata.get("input_count", 0))], "enabled": bool(replay_metadata.get("audit_loaded", false))},
	]

func metrics() -> Dictionary:
	return {
		"input_delay_ticks": input_delay_ticks,
		"average_position_error": average_position_error,
		"correction_count": correction_count,
		"hard_snap_count": hard_snap_count,
		"late_input_count": late_input_count,
		"perceived_hit_mismatch": perceived_hit_mismatch,
		"reconnect_success_count": reconnect_success_count,
		"resimulated_ticks": resimulated_ticks,
		"server_bullet_count": server_bullets.size(),
		"last_bullet_delta_count": last_bullet_delta_count,
		"last_event_count": last_event_count,
		"event_stream_cursor": event_stream_cursor,
		"event_stream_latest_cursor": event_stream_latest_cursor,
		"event_stream_has_more": event_stream_has_more,
		"presence_status": presence_status,
		"presence_match_tick": presence_match_tick,
		"presence_latest_event_cursor": presence_latest_event_cursor,
		"rematch_status": rematch_status,
		"rematch_new_match_id": rematch_new_match_id,
		"server_active_card_count": server_active_cards.size(),
		"last_active_card_count": last_active_card_count,
		"stage_id": String(server_loadout.get("stage_id", mode_state.get("stage_id", ""))),
		"character_id": String(server_loadout.get("character_id", "")),
		"battle_server_id": battle_server_id,
		"battle_endpoint": battle_endpoint,
		"battle_player_id": battle_player_id,
		"battle_ticket_status": battle_ticket_status,
		"battle_result_status": battle_result_status,
		"battle_result_settlement_key": battle_result_settlement_key,
		"battle_result_hash": battle_result_hash,
		"battle_result_replay_id": battle_result_replay_id,
		"battle_result_key_id": battle_result_key_id,
		"battle_result_duplicate": battle_result_duplicate,
	}

func mode_state_summary() -> String:
	if mode_state.is_empty():
		return "-"
	match mode_id:
		"certification":
			return "rating %s rank %d progress %.0f%%" % [
				str(mode_state.get("rating_code", "-")),
				int(mode_state.get("rank_score_preview", 0)),
				float(mode_state.get("challenge_progress", 0.0)) * 100.0,
			]
		"battle_royale":
			return "round %d deadline %d pool %s" % [
				int(mode_state.get("round_index", 0)),
				int(mode_state.get("choice_deadline_tick", 0)),
				str(mode_state.get("public_pool_hash", "-")),
			]
		"world_boss":
			return "boss %.0f attempts %d transfers %d" % [
				float(mode_state.get("boss_hp_preview", 0.0)),
				int(mode_state.get("daily_attempts_left", 0)),
				(mode_state.get("transfer_requests", []) as Array).size() if typeof(mode_state.get("transfer_requests", [])) == TYPE_ARRAY else 0,
			]
		"instance_boss":
			return "phase %s party %s conditions %d" % [
				str(mode_state.get("boss_phase", "-")),
				str(mode_state.get("party_status", "-")),
				(mode_state.get("clear_conditions", []) as Array).size() if typeof(mode_state.get("clear_conditions", [])) == TYPE_ARRAY else 0,
			]
		_:
			return JSON.stringify(mode_state)

func summary() -> String:
	return "%s %s delay %d snap %d corr %d hard %d full %s" % [
		authority_state,
		connection_state,
		input_delay_ticks,
		last_accepted_snapshot_tick,
		correction_count,
		hard_snap_count,
		full_snapshot_requested,
	]

func _mode_ruleset_for(target_mode_id: String) -> String:
	if matchmaking_model == null:
		return ""
	var config_value: Variant = matchmaking_model.mode_config(target_mode_id)
	if typeof(config_value) != TYPE_DICTIONARY:
		return ""
	return str((config_value as Dictionary).get("mode_ruleset_version", ""))

func _default_mode_state(target_mode_id: String) -> Dictionary:
	match target_mode_id:
		"certification":
			return {"rating_code": "unrated", "rank_score_preview": 0, "challenge_progress": 0.0}
		"battle_royale":
			return {"round_index": 0, "choice_deadline_tick": 0, "public_pool_hash": "", "zero_round_order": []}
		"world_boss":
			return {"boss_hp_preview": 0.0, "daily_attempts_left": 0, "transfer_requests": []}
		"instance_boss":
			return {"boss_phase": "loading", "party_status": "forming", "clear_conditions": []}
		_:
			return {}

func _merge_mode_state(mode_state_value: Variant) -> Dictionary:
	var merged := mode_state.duplicate(true)
	if typeof(mode_state_value) != TYPE_DICTIONARY:
		return merged
	var incoming := mode_state_value as Dictionary
	for key in incoming.keys():
		merged[key] = incoming[key]
	return merged

func _snapshot_summary(snapshot: Dictionary) -> Dictionary:
	return {
		"tick": int(snapshot.get("tick", -1)),
		"state_hash": str(snapshot.get("state_hash", "")),
		"full": bool(snapshot.get("full", false)),
		"stage_id": String(snapshot.get("stage_id", server_loadout.get("stage_id", ""))),
		"bullet_delta_count": last_bullet_delta_count,
		"active_bullets": server_bullets.size(),
		"event_count": (snapshot.get("events", []) as Array).size() if typeof(snapshot.get("events", [])) == TYPE_ARRAY else 0,
		"active_card_count": last_active_card_count,
	}

func _loadout_from_match_start(match_start: Dictionary) -> Dictionary:
	var loadout := _loadout_from_players(match_start.get("players", []))
	if loadout.is_empty():
		loadout = _loadout_from_value(match_start.get("loadout", {}))
	if loadout.is_empty() and match_start.has("stage_id"):
		loadout = {"stage_id": String(match_start.get("stage_id", "")), "character_id": ""}
	return loadout

func _loadout_from_snapshot(snapshot: Dictionary) -> Dictionary:
	var loadout := _loadout_from_players(snapshot.get("players", []))
	if loadout.is_empty():
		loadout = server_loadout.duplicate(true)
	if snapshot.has("stage_id"):
		loadout["stage_id"] = String(snapshot.get("stage_id", loadout.get("stage_id", "")))
	return loadout

func _loadout_from_record(record: Dictionary) -> Dictionary:
	var loadout := _loadout_from_value(record.get("loadout", {}))
	if loadout.is_empty():
		loadout = server_loadout.duplicate(true)
	if record.has("stage_id"):
		loadout["stage_id"] = String(record.get("stage_id", loadout.get("stage_id", "")))
	return loadout

func _loadout_from_players(players_value: Variant) -> Dictionary:
	if typeof(players_value) != TYPE_ARRAY:
		return {}
	var fallback := {}
	for item in players_value as Array:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var player := item as Dictionary
		var loadout := _loadout_from_value(player.get("loadout", {}))
		if loadout.is_empty():
			continue
		if fallback.is_empty():
			fallback = loadout
		if matchmaking_model != null and String(player.get("user_id", "")) == String(matchmaking_model.get("account_id")):
			return loadout
	return fallback

func _loadout_from_value(value: Variant) -> Dictionary:
	if typeof(value) != TYPE_DICTIONARY:
		return {}
	var source := value as Dictionary
	var stage_id := String(source.get("stage_id", ""))
	var character_id := String(source.get("character_id", ""))
	if stage_id.is_empty() and character_id.is_empty():
		return {}
	return {
		"stage_id": stage_id,
		"character_id": character_id,
		"ruleset_version": String(source.get("ruleset_version", "")),
		"server_authoritative": bool(source.get("server_authoritative", false)),
	}

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

func _apply_bullet_deltas(delta_value: Variant, full_snapshot: bool) -> Dictionary:
	last_bullet_delta_count = 0
	if typeof(delta_value) != TYPE_ARRAY:
		if full_snapshot:
			server_bullets.clear()
		return {"applied": 0, "active": server_bullets.size(), "despawned": 0}
	if full_snapshot:
		server_bullets.clear()
	var despawned := 0
	for item in delta_value as Array:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var delta := item as Dictionary
		var op := String(delta.get("op", "spawn"))
		var bullet_id := String(delta.get("bullet_id", ""))
		if bullet_id.is_empty():
			continue
		match op:
			"despawn":
				if server_bullets.has(bullet_id):
					despawned += 1
				server_bullets.erase(bullet_id)
			"spawn", "sync", "move":
				server_bullets[bullet_id] = _server_bullet_from_delta(delta)
			_:
				last_error_code = "bullet_delta_unknown"
				continue
		last_bullet_delta_count += 1
	return {"applied": last_bullet_delta_count, "active": server_bullets.size(), "despawned": despawned}

func _server_bullet_from_delta(delta: Dictionary) -> Dictionary:
	var bullet := {}
	var bullet_id := String(delta.get("bullet_id", ""))
	if server_bullets.has(bullet_id):
		bullet = (server_bullets[bullet_id] as Dictionary).duplicate(true)
	bullet["bullet_id"] = bullet_id
	bullet["pattern_id"] = String(delta.get("pattern_id", bullet.get("pattern_id", "")))
	bullet["kind"] = String(delta.get("kind", bullet.get("kind", "")))
	bullet["tick"] = int(delta.get("tick", bullet.get("tick", 0)))
	bullet["pos"] = {"x": float(delta.get("x", bullet.get("x", 0.0))), "y": float(delta.get("y", bullet.get("y", 0.0)))}
	bullet["x"] = float(delta.get("x", bullet.get("x", 0.0)))
	bullet["y"] = float(delta.get("y", bullet.get("y", 0.0)))
	bullet["vx"] = float(delta.get("vx", bullet.get("vx", 0.0)))
	bullet["vy"] = float(delta.get("vy", bullet.get("vy", 0.0)))
	bullet["radius"] = float(delta.get("radius", bullet.get("radius", 0.0)))
	bullet["damage"] = int(delta.get("damage", bullet.get("damage", 0)))
	bullet["color"] = String(delta.get("color", bullet.get("color", "")))
	return bullet

func _apply_active_cards(active_card_value: Variant) -> Dictionary:
	server_active_cards.clear()
	last_active_card_count = 0
	if typeof(active_card_value) != TYPE_ARRAY:
		return {"applied": 0, "active": 0}
	for item in active_card_value as Array:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var card := (item as Dictionary).duplicate(true)
		var activation_id := String(card.get("activation_id", ""))
		if activation_id.is_empty():
			activation_id = "%s:%s:%d" % [
				String(card.get("user_id", "")),
				String(card.get("card_id", "")),
				int(card.get("started_tick", 0)),
			]
		server_active_cards[activation_id] = card
		last_active_card_count += 1
	return {"applied": last_active_card_count, "active": server_active_cards.size()}

func server_active_card_summary() -> String:
	if server_active_cards.is_empty():
		return "-"
	var parts: Array[String] = []
	for activation_id in server_active_cards.keys():
		var card: Dictionary = server_active_cards[activation_id]
		parts.append("%s@%d" % [String(card.get("card_id", activation_id)), int(card.get("expires_tick", 0))])
		if parts.size() >= 4:
			break
	return ", ".join(parts)

func _apply_snapshot_events(event_value: Variant) -> Dictionary:
	last_event_count = 0
	if typeof(event_value) != TYPE_ARRAY:
		return {"applied": 0, "recent": recent_server_events.size()}
	for item in event_value as Array:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		_record_server_event((item as Dictionary).duplicate(true))
		last_event_count += 1
	return {"applied": last_event_count, "recent": recent_server_events.size()}

func _record_server_event(event: Dictionary) -> void:
	recent_server_events.append(event.duplicate(true))
	if recent_server_events.size() > 24:
		recent_server_events.pop_front()

func _classify_correction(snapshot: Dictionary, predicted_state: Dictionary) -> Dictionary:
	if predicted_state.is_empty():
		return {"type": "none", "position_error": 0.0, "rewind_tick": int(snapshot.get("tick", -1)), "request_full": false}
	var position_error := _position_error(snapshot, predicted_state)
	_record_position_error(position_error)
	var snapshot_tick := int(snapshot.get("tick", -1))
	var predicted_tick := int(predicted_state.get("tick", snapshot_tick))
	if str(predicted_state.get("state_hash", "")) != "" and str(snapshot.get("state_hash", "")) != "" and str(predicted_state.get("state_hash", "")) != str(snapshot.get("state_hash", "")):
		return {"type": "hard_snap", "position_error": position_error, "rewind_tick": snapshot_tick, "request_full": true, "reason": "hash_mismatch", "resimulated_ticks": max(0, predicted_tick - snapshot_tick)}
	if position_error <= SMALL_POSITION_ERROR:
		return {"type": "smooth", "position_error": position_error, "rewind_tick": snapshot_tick, "request_full": false, "resimulated_ticks": max(0, predicted_tick - snapshot_tick)}
	if position_error <= MEDIUM_POSITION_ERROR:
		return {"type": "interpolate", "position_error": position_error, "rewind_tick": snapshot_tick, "request_full": false, "resimulated_ticks": max(0, predicted_tick - snapshot_tick)}
	if position_error <= LARGE_POSITION_ERROR:
		return {"type": "resimulate", "position_error": position_error, "rewind_tick": snapshot_tick, "request_full": false, "resimulated_ticks": max(0, predicted_tick - snapshot_tick)}
	return {"type": "hard_snap", "position_error": position_error, "rewind_tick": snapshot_tick, "request_full": true, "reason": "large_position_error", "resimulated_ticks": max(0, predicted_tick - snapshot_tick)}

func _position_error(snapshot: Dictionary, predicted_state: Dictionary) -> float:
	var server_pos_value: Variant = snapshot.get("player_pos", snapshot.get("position", Vector2.ZERO))
	var predicted_pos_value: Variant = predicted_state.get("player_pos", predicted_state.get("position", Vector2.ZERO))
	var server_pos := _variant_to_vector2(server_pos_value)
	var predicted_pos := _variant_to_vector2(predicted_pos_value)
	return server_pos.distance_to(predicted_pos)

func _variant_to_vector2(value: Variant) -> Vector2:
	if typeof(value) == TYPE_VECTOR2:
		return value
	if typeof(value) == TYPE_DICTIONARY:
		var dict := value as Dictionary
		return Vector2(float(dict.get("x", 0.0)), float(dict.get("y", 0.0)))
	if typeof(value) == TYPE_ARRAY:
		var array := value as Array
		if array.size() >= 2:
			return Vector2(float(array[0]), float(array[1]))
	return Vector2.ZERO

func _record_position_error(value: float) -> void:
	position_error_samples += 1
	average_position_error += (value - average_position_error) / float(position_error_samples)

func _snapshot_has_forbidden_client_result(snapshot: Dictionary) -> bool:
	return bool(snapshot.get("client_authored_result", false))

func _normalize_card_slot(raw_slot: int, hand_size: int) -> int:
	if raw_slot <= 0:
		return -1
	if raw_slot <= hand_size:
		return raw_slot - 1
	return raw_slot

func _update_input_delay_from_network() -> void:
	if matchmaking_model == null:
		input_delay_ticks = INPUT_DELAY_MIN_TICKS
		return
	var ping_value := int(matchmaking_model.get("ping_ms"))
	var loss_value := float(matchmaking_model.get("packet_loss"))
	var jitter_value := int(matchmaking_model.get("jitter_ms"))
	_update_input_delay_from_values(ping_value, loss_value, jitter_value)

func _update_input_delay_from_values(ping_ms: int, packet_loss: float, jitter_ms: int) -> void:
	if ping_ms <= 30 and packet_loss <= 0.005 and jitter_ms <= 8:
		input_delay_ticks = 2
	elif ping_ms <= 80 and packet_loss <= 0.01:
		input_delay_ticks = 3
	else:
		input_delay_ticks = INPUT_DELAY_MAX_TICKS
