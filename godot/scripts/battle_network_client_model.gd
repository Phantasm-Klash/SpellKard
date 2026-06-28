class_name BattleNetworkClientModel
extends RefCounted

const TRANSPORT_TARGET := "KCP/UDP"
const HANDSHAKE_TARGET := "X25519 ECDHE + HKDF-SHA256"
const CODEC_TARGET := "protobuf phk.v1"
const AEAD_TARGET := "ChaCha20-Poly1305"

var network_match_model: RefCounted = null
var protocol_descriptor_model: RefCounted = null

var connection_state := "idle"
var handshake_state := "waiting_ticket"
var codec_state := "descriptor_missing"
var crypto_state := "pending"
var transport_state := "disconnected"
var last_error_code := "none"

var match_id := ""
var mode_id := ""
var battle_server_id := ""
var endpoint := ""
var player_id := ""
var ticket_id := ""
var ticket_key_id := ""
var ticket_expires_at_ms := 0
var ruleset_version := ""
var protocol_version := 0
var battle_api_version := ""
var connection_id := ""
var client_nonce_hex := ""
var server_nonce_hex := ""
var transcript_hash := ""
var next_seq := 1
var last_ack := 0
var last_received_seq := 0
var last_payload_type := "none"
var last_packet_header: Dictionary = {}

func configure(network_match: RefCounted, descriptor_model: RefCounted = null) -> void:
	network_match_model = network_match
	protocol_descriptor_model = descriptor_model
	_refresh_descriptor_state()
	sync_from_network_match()

func sync_from_network_match() -> Dictionary:
	if network_match_model == null:
		last_error_code = "network_match_missing"
		return {"ok": false, "reason": last_error_code}
	var allocation_value: Variant = network_match_model.get("battle_allocation")
	if typeof(allocation_value) == TYPE_DICTIONARY and not (allocation_value as Dictionary).is_empty():
		apply_battle_allocation(allocation_value as Dictionary)
	var ticket_value: Variant = network_match_model.get("battle_ticket")
	if typeof(ticket_value) == TYPE_DICTIONARY and not (ticket_value as Dictionary).is_empty():
		apply_battle_ticket(ticket_value as Dictionary)
	return {"ok": true, "state": connection_state, "handshake": handshake_state}

func reset() -> void:
	connection_state = "idle"
	handshake_state = "waiting_ticket"
	transport_state = "disconnected"
	crypto_state = "pending"
	last_error_code = "none"
	match_id = ""
	mode_id = ""
	battle_server_id = ""
	endpoint = ""
	player_id = ""
	ticket_id = ""
	ticket_key_id = ""
	ticket_expires_at_ms = 0
	connection_id = ""
	client_nonce_hex = ""
	server_nonce_hex = ""
	transcript_hash = ""
	next_seq = 1
	last_ack = 0
	last_received_seq = 0
	last_payload_type = "none"
	last_packet_header = {}
	_refresh_descriptor_state()

func apply_battle_allocation(allocation: Dictionary) -> Dictionary:
	if not bool(allocation.get("ok", true)) or not bool(allocation.get("server_authoritative", true)):
		connection_state = "allocation_rejected"
		last_error_code = String(allocation.get("reason", "allocation_not_authoritative"))
		return {"ok": false, "reason": last_error_code}
	match_id = String(allocation.get("match_id", match_id))
	mode_id = String(allocation.get("mode_id", mode_id))
	battle_server_id = String(allocation.get("battle_server_id", battle_server_id))
	endpoint = String(allocation.get("endpoint", endpoint))
	if typeof(allocation.get("version", {})) == TYPE_DICTIONARY:
		var version: Dictionary = allocation.get("version", {})
		protocol_version = int(version.get("protocol_version", protocol_version))
		ruleset_version = String(version.get("ruleset_version", ruleset_version))
		battle_api_version = String(version.get("battle_api_version", battle_api_version))
	player_id = _player_id_from_allocation(allocation.get("players", []), player_id)
	connection_state = "allocated"
	transport_state = "endpoint_ready" if not endpoint.is_empty() else "waiting_endpoint"
	last_error_code = "none"
	return {"ok": true, "state": connection_state, "endpoint": endpoint, "player_id": player_id}

func apply_battle_ticket(signed_ticket: Dictionary) -> Dictionary:
	if not bool(signed_ticket.get("ok", false)) or not bool(signed_ticket.get("server_authoritative", false)):
		handshake_state = "ticket_rejected"
		last_error_code = String(signed_ticket.get("reason", "ticket_not_authoritative"))
		return {"ok": false, "reason": last_error_code}
	if String(signed_ticket.get("signature_hex", "")).is_empty():
		handshake_state = "ticket_unsigned"
		last_error_code = "ticket_signature_missing"
		return {"ok": false, "reason": last_error_code}
	ticket_key_id = String(signed_ticket.get("key_id", ticket_key_id))
	var ticket_value: Variant = signed_ticket.get("ticket", {})
	if typeof(ticket_value) != TYPE_DICTIONARY:
		handshake_state = "ticket_invalid"
		last_error_code = "ticket_body_missing"
		return {"ok": false, "reason": last_error_code}
	var ticket: Dictionary = ticket_value
	ticket_id = String(ticket.get("ticket_id", ticket_id))
	match_id = String(ticket.get("match_id", match_id))
	mode_id = String(ticket.get("mode_id", mode_id))
	player_id = String(ticket.get("player_id", player_id))
	battle_server_id = String(ticket.get("battle_server_id", battle_server_id))
	endpoint = String(ticket.get("endpoint", endpoint))
	ruleset_version = String(ticket.get("ruleset_version", ruleset_version))
	ticket_expires_at_ms = int(ticket.get("expires_at_ms", ticket_expires_at_ms))
	if typeof(ticket.get("version", {})) == TYPE_DICTIONARY:
		var version: Dictionary = ticket.get("version", {})
		protocol_version = int(version.get("protocol_version", protocol_version))
		battle_api_version = String(version.get("battle_api_version", battle_api_version))
		ruleset_version = String(version.get("ruleset_version", ruleset_version))
	handshake_state = "ticket_verified_scaffold"
	connection_state = "ticket_ready" if connection_state == "idle" else connection_state
	transport_state = "endpoint_ready" if not endpoint.is_empty() else transport_state
	last_error_code = "none"
	return {"ok": true, "ticket_id": ticket_id, "key_id": ticket_key_id, "state": handshake_state}

func prepare_handshake(client_nonce: String = "") -> Dictionary:
	sync_from_network_match()
	if match_id.is_empty() or player_id.is_empty() or endpoint.is_empty():
		handshake_state = "allocation_missing"
		last_error_code = "battle_endpoint_or_player_missing"
		return {"ok": false, "reason": last_error_code}
	if ticket_id.is_empty() or ticket_key_id.is_empty():
		handshake_state = "ticket_missing"
		last_error_code = "signed_ticket_missing"
		return {"ok": false, "reason": last_error_code}
	if not _descriptor_ready():
		handshake_state = "descriptor_missing"
		last_error_code = "protocol_descriptor_missing"
		return {"ok": false, "reason": last_error_code}
	client_nonce_hex = client_nonce if not client_nonce.is_empty() else _deterministic_nonce("client")
	connection_id = _connection_id()
	transcript_hash = _scaffold_hash("%s|%s|%s|%s" % [match_id, player_id, ticket_id, client_nonce_hex])
	handshake_state = "handshake_ready_scaffold"
	connection_state = "handshake_ready"
	crypto_state = "key_schedule_pending"
	transport_state = "kcp_connect_pending"
	last_error_code = "none"
	return {
		"ok": true,
		"connection_id": connection_id,
		"client_nonce_hex": client_nonce_hex,
		"transcript_hash": transcript_hash,
	}

func mark_connected(server_nonce: String = "") -> Dictionary:
	if handshake_state != "handshake_ready_scaffold":
		var prepared := prepare_handshake()
		if not bool(prepared.get("ok", false)):
			return prepared
	server_nonce_hex = server_nonce if not server_nonce.is_empty() else _deterministic_nonce("server")
	connection_state = "connected_scaffold"
	transport_state = "kcp_ready_scaffold"
	crypto_state = "aead_pending"
	last_error_code = "none"
	return {"ok": true, "state": connection_state, "server_nonce_hex": server_nonce_hex}

func build_packet_header(payload_type: String, tick: int, ack: int = -1) -> Dictionary:
	if connection_state != "connected_scaffold":
		var connected := mark_connected()
		if not bool(connected.get("ok", false)):
			return {"ok": false, "reason": String(connected.get("reason", last_error_code))}
	var payload_descriptor := _payload_descriptor(payload_type)
	if not bool(payload_descriptor.get("ok", false)):
		last_error_code = String(payload_descriptor.get("reason", "payload_type_invalid"))
		return {"ok": false, "reason": last_error_code, "payload_type": payload_type}
	var packet_ack := last_ack if ack < 0 else ack
	var payload_label := String(payload_descriptor.get("payload_type", payload_type))
	var header := {
		"ok": true,
		"protocol_version": protocol_version,
		"battle_api_version": battle_api_version,
		"ruleset_version": ruleset_version,
		"match_id": match_id,
		"player_id": player_id,
		"tick": tick,
		"seq": next_seq,
		"ack": packet_ack,
		"payload_type": payload_label,
		"payload_type_number": int(payload_descriptor.get("number", 0)),
		"payload_type_enum": String(payload_descriptor.get("enum_name", "")),
		"key_id": ticket_key_id,
		"nonce": _packet_nonce(next_seq),
		"transport": TRANSPORT_TARGET,
		"codec": CODEC_TARGET,
		"crypto": "%s pending" % AEAD_TARGET,
		"encrypted": false,
		"server_authoritative": false,
	}
	last_packet_header = header.duplicate(true)
	last_payload_type = payload_label
	next_seq += 1
	last_error_code = "none"
	return header

func receive_packet_header(header: Dictionary) -> Dictionary:
	var incoming_match_id := String(header.get("match_id", ""))
	var incoming_player_id := String(header.get("player_id", ""))
	if incoming_match_id != match_id or incoming_player_id != player_id:
		last_error_code = "battle_packet_identity_mismatch"
		return {"ok": false, "reason": last_error_code}
	var incoming_seq := int(header.get("seq", 0))
	if incoming_seq <= last_received_seq:
		last_error_code = "battle_packet_replay"
		return {"ok": false, "reason": last_error_code, "seq": incoming_seq}
	last_received_seq = incoming_seq
	last_ack = incoming_seq
	last_error_code = "none"
	return {"ok": true, "ack": last_ack}

func rows() -> Array[Dictionary]:
	sync_from_network_match()
	_refresh_descriptor_state()
	return [
		{
			"id": "battle_client_transport",
			"label": "Battle client transport",
			"value": transport_summary(),
			"section": "battle_network",
			"ui_control": "status",
			"enabled": not endpoint.is_empty(),
		},
		{
			"id": "battle_client_handshake",
			"label": "Battle client handshake",
			"value": handshake_summary(),
			"section": "battle_network",
			"ui_control": "status",
			"enabled": handshake_state != "waiting_ticket",
		},
		{
			"id": "battle_client_codec",
			"label": "Battle client codec",
			"value": codec_summary(),
			"section": "battle_network",
			"ui_control": "status",
			"enabled": _descriptor_ready(),
		},
		{
			"id": "battle_client_packet",
			"label": "Battle client packet",
			"value": packet_summary(),
			"section": "battle_network",
			"ui_control": "status",
			"enabled": not last_packet_header.is_empty(),
		},
	]

func summary() -> String:
	sync_from_network_match()
	return "%s %s seq %d ack %d %s" % [
		connection_state,
		transport_state,
		next_seq,
		last_ack,
		last_error_code,
	]

func transport_summary() -> String:
	return "%s %s endpoint %s conn %s" % [
		TRANSPORT_TARGET,
		transport_state,
		endpoint if not endpoint.is_empty() else "-",
		connection_id if not connection_id.is_empty() else "-",
	]

func handshake_summary() -> String:
	return "%s %s ticket %s key %s" % [
		HANDSHAKE_TARGET,
		handshake_state,
		ticket_id if not ticket_id.is_empty() else "-",
		ticket_key_id if not ticket_key_id.is_empty() else "-",
	]

func codec_summary() -> String:
	return "%s %s p%d rules %s aead %s" % [
		CODEC_TARGET,
		codec_state,
		protocol_version,
		ruleset_version if not ruleset_version.is_empty() else "-",
		AEAD_TARGET,
	]

func packet_summary() -> String:
	if last_packet_header.is_empty():
		return "no packet header built; seq %d ack %d" % [next_seq, last_ack]
	return "%s enum %s/%d seq %d ack %d nonce %s encrypted false" % [
		last_payload_type,
		String(last_packet_header.get("payload_type_enum", "")),
		int(last_packet_header.get("payload_type_number", 0)),
		int(last_packet_header.get("seq", 0)),
		int(last_packet_header.get("ack", 0)),
		String(last_packet_header.get("nonce", "")),
	]

func _refresh_descriptor_state() -> void:
	if protocol_descriptor_model == null:
		codec_state = "descriptor_missing"
		return
	var result: Dictionary = protocol_descriptor_model.validate_minimal_contract() if protocol_descriptor_model.has_method("validate_minimal_contract") else {}
	if bool(result.get("ok", false)):
		codec_state = "descriptor_ready"
		protocol_version = int(result.get("protocol_version", protocol_version))
		if protocol_descriptor_model.has_method("battle_api_version"):
			battle_api_version = String(protocol_descriptor_model.call("battle_api_version"))
		if protocol_descriptor_model.has_method("ruleset_version"):
			ruleset_version = String(protocol_descriptor_model.call("ruleset_version"))
	else:
		codec_state = String(result.get("reason", "descriptor_missing"))

func _descriptor_ready() -> bool:
	return codec_state == "descriptor_ready"

func _payload_descriptor(payload_type: String) -> Dictionary:
	if protocol_descriptor_model == null or not protocol_descriptor_model.has_method("battle_payload_type_for"):
		if payload_type.strip_edges().is_empty():
			return {"ok": false, "reason": "payload_type_empty"}
		return {
			"ok": true,
			"payload_type": payload_type,
			"enum_name": "BATTLE_PAYLOAD_TYPE_%s" % payload_type.strip_edges().to_upper(),
			"number": 0,
		}
	return protocol_descriptor_model.call("battle_payload_type_for", payload_type) as Dictionary

func _player_id_from_allocation(players_value: Variant, fallback: String = "") -> String:
	if typeof(players_value) != TYPE_ARRAY:
		return fallback
	for item in players_value as Array:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var player: Dictionary = item
		var candidate := String(player.get("player_id", ""))
		if candidate.is_empty():
			continue
		if fallback.is_empty() or candidate == fallback:
			return candidate
	return fallback

func _connection_id() -> String:
	return "kcp-%s-%s" % [
		_sanitize_short(match_id),
		_sanitize_short(player_id),
	]

func _packet_nonce(seq: int) -> String:
	return _scaffold_hash("%s|%s|%d|%s" % [connection_id, client_nonce_hex, seq, "c2s"]).substr(0, 24)

func _deterministic_nonce(direction: String) -> String:
	return _scaffold_hash("%s|%s|%s|%s" % [direction, match_id, player_id, ticket_id]).substr(0, 24)

func _scaffold_hash(value: String) -> String:
	var ctx := HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(value.to_utf8_buffer())
	return ctx.finish().hex_encode()

func _sanitize_short(value: String) -> String:
	var sanitized := value.replace(":", "").replace("/", "").replace("\\", "").replace(" ", "")
	if sanitized.length() > 12:
		return sanitized.substr(0, 12)
	return sanitized
