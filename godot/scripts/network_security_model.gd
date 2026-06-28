class_name NetworkSecurityModel
extends RefCounted

const BUSINESS_TARGET := "HTTPS + WSS + ECC seal + sign"
const BATTLE_TARGET := "ECDHE + KCP/UDP + protobuf + ChaCha20-Poly1305"

var gensoulkyo_api_model: RefCounted = null
var matchmaking_model: RefCounted = null
var network_match_model: RefCounted = null
var battle_network_client_model: RefCounted = null

func configure(deps: Dictionary) -> void:
	gensoulkyo_api_model = deps.get("gensoulkyo_api_model", null)
	matchmaking_model = deps.get("matchmaking_model", null)
	network_match_model = deps.get("network_match_model", null)
	battle_network_client_model = deps.get("battle_network_client_model", null)

func rows() -> Array[Dictionary]:
	return [
		{
			"id": "netsec_summary",
			"label": "Network Security",
			"value": summary(),
			"section": "overview",
			"ui_control": "status",
			"enabled": true,
		},
		{
			"id": "business_transport",
			"label": "Business transport",
			"value": business_transport_summary(),
			"section": "business_network",
			"ui_control": "status",
			"enabled": true,
		},
		{
			"id": "business_auth_sign",
			"label": "Business auth / sign",
			"value": business_auth_summary(),
			"section": "business_network",
			"ui_control": "status",
			"enabled": _has_session(),
		},
		{
			"id": "business_ecc_seal",
			"label": "ECC app-data seal",
			"value": business_envelope_summary(),
			"section": "business_network",
			"ui_control": "status",
			"enabled": _has_business_envelope(),
		},
		{
			"id": "business_replay_guard",
			"label": "Business replay guard",
			"value": business_replay_guard_summary(),
			"section": "business_network",
			"ui_control": "status",
			"enabled": _has_business_envelope(),
		},
		{
			"id": "battle_transport",
			"label": "Battle transport",
			"value": battle_transport_summary(),
			"section": "battle_network",
			"ui_control": "status",
			"enabled": _has_battle_endpoint(),
		},
		{
			"id": "battle_handshake",
			"label": "Battle handshake",
			"value": battle_handshake_summary(),
			"section": "battle_network",
			"ui_control": "status",
			"enabled": _has_signed_ticket(),
		},
		{
			"id": "battle_codec_crypto",
			"label": "Battle codec / crypto",
			"value": battle_codec_crypto_summary(),
			"section": "battle_network",
			"ui_control": "status",
			"enabled": _has_battle_client_codec(),
		},
		{
			"id": "battle_result_callback",
			"label": "Battle result callback",
			"value": battle_result_callback_summary(),
			"section": "battle_network",
			"ui_control": "status",
			"enabled": _has_battle_result_status(),
		},
		{
			"id": "server_split",
			"label": "Server split",
			"value": "Nakama/Go business authority, C++ battle authority skeleton",
			"section": "battle_network",
			"ui_control": "status",
			"enabled": true,
		},
	]

func summary() -> String:
	return "business %s | battle %s" % [business_badge(), battle_badge()]

func business_badge() -> String:
	var scheme := _business_scheme()
	var session := "session" if _has_session() else "anonymous"
	var endpoint := _api_value("last_endpoint", "none")
	var error := _api_value("last_error_code", "none")
	return "%s %s %s %s" % [scheme, session, endpoint, error]

func battle_badge() -> String:
	var ticket := _battle_ticket_status()
	var endpoint := _battle_endpoint()
	var authority := _network_value("authority_state", "idle")
	if endpoint.is_empty():
		endpoint = "no-endpoint"
	return "%s %s %s" % [ticket, endpoint, authority]

func business_transport_summary() -> String:
	var base_url := _api_value("base_url", "")
	var scheme := _business_scheme()
	var websocket := "WSS target" if scheme == "https" else "WSS pending"
	return "%s target %s current %s %s" % [BUSINESS_TARGET, scheme, base_url, websocket]

func business_auth_summary() -> String:
	var user_id := _api_value("user_id", "")
	var ticket_status := _battle_ticket_status()
	var key_id := _api_value("battle_ticket_key_id", "")
	if key_id.is_empty():
		key_id = "no-key"
	return "user %s session %s ticket %s key %s" % [
		user_id if not user_id.is_empty() else "-",
		"ready" if _has_session() else "missing",
		ticket_status,
		key_id,
	]

func business_envelope_summary() -> String:
	var summary := _api_call_string("business_envelope_summary", "")
	if summary.is_empty():
		return "planned ECC/AEAD envelope; current Nakama/Go MVP uses dev HTTP contract"
	return "%s | real X25519/AEAD/sign pending" % summary

func business_replay_guard_summary() -> String:
	var seq := _api_int("business_envelope_seq", 0)
	var verified_seq := _api_int("last_verified_business_envelope_seq", 0)
	var status := _api_value("last_business_envelope_status", "not_started")
	var error := _api_value("last_business_envelope_error", "none")
	return "seq %d verified %d %s %s timestamp/nonce guard scaffold" % [seq, verified_seq, status, error]

func battle_transport_summary() -> String:
	var endpoint := _battle_endpoint()
	var player_id := _network_value("battle_player_id", "")
	return "%s endpoint %s player %s" % [
		BATTLE_TARGET,
		endpoint if not endpoint.is_empty() else "waiting allocation",
		player_id if not player_id.is_empty() else "-",
	]

func battle_handshake_summary() -> String:
	var client_summary := _battle_client_call_string("handshake_summary", "")
	if not client_summary.is_empty():
		return client_summary
	var ticket_status := _battle_ticket_status()
	var expires_at := _network_int("battle_ticket_expires_at_ms", 0)
	var readiness := "ready for ECDHE" if _has_signed_ticket() else "waiting signed ticket"
	return "%s %s exp %d" % [ticket_status, readiness, expires_at]

func battle_codec_crypto_summary() -> String:
	var client_summary := _battle_client_call_string("codec_summary", "")
	if not client_summary.is_empty():
		return "%s | real packet encryption pending" % client_summary
	return "protobuf + ChaCha20-Poly1305 pending; current client consumes HTTP fallback snapshots"

func battle_result_callback_summary() -> String:
	var status := _battle_result_status()
	var key := _network_value("battle_result_key_id", "")
	if key.is_empty():
		key = _api_value("battle_result_key_id", "")
	var settlement := _network_value("battle_result_settlement_key", "")
	if settlement.is_empty():
		settlement = _api_value("battle_result_settlement_key", "")
	return "C++ result -> Nakama/Go verify %s key %s %s" % [
		status,
		key if not key.is_empty() else "-",
		settlement,
	]

func _business_scheme() -> String:
	var base_url := _api_value("base_url", "")
	if base_url.to_lower().begins_with("https://"):
		return "https"
	if base_url.to_lower().begins_with("http://"):
		return "http-dev"
	return "unknown"

func _has_session() -> bool:
	return not _api_value("session_token", "").is_empty()

func _has_business_envelope() -> bool:
	return _api_int("business_envelope_seq", 0) > 0

func _has_battle_endpoint() -> bool:
	return not _battle_endpoint().is_empty()

func _has_signed_ticket() -> bool:
	return _battle_ticket_status() == "signed"

func _has_battle_client_codec() -> bool:
	if battle_network_client_model == null:
		return false
	return String(battle_network_client_model.get("codec_state")) == "descriptor_ready"

func _has_battle_result_status() -> bool:
	return _battle_result_status() != "none"

func _battle_ticket_status() -> String:
	var network_status := _network_value("battle_ticket_status", "")
	if not network_status.is_empty() and network_status != "none":
		return network_status
	return _api_value("battle_ticket_status", "none")

func _battle_result_status() -> String:
	var network_status := _network_value("battle_result_status", "")
	if not network_status.is_empty() and network_status != "none":
		return network_status
	return _api_value("battle_result_status", "none")

func _battle_endpoint() -> String:
	var endpoint := _network_value("battle_endpoint", "")
	if not endpoint.is_empty():
		return endpoint
	return _api_value("battle_endpoint", "")

func _api_value(property_name: String, fallback: String) -> String:
	if gensoulkyo_api_model == null:
		return fallback
	return String(gensoulkyo_api_model.get(property_name))

func _api_int(property_name: String, fallback: int) -> int:
	if gensoulkyo_api_model == null:
		return fallback
	return int(gensoulkyo_api_model.get(property_name))

func _api_call_string(method_name: String, fallback: String) -> String:
	if gensoulkyo_api_model == null or not gensoulkyo_api_model.has_method(method_name):
		return fallback
	return String(gensoulkyo_api_model.call(method_name))

func _network_value(property_name: String, fallback: String) -> String:
	if network_match_model == null:
		return fallback
	return String(network_match_model.get(property_name))

func _network_int(property_name: String, fallback: int) -> int:
	if network_match_model == null:
		return fallback
	return int(network_match_model.get(property_name))

func _battle_client_call_string(method_name: String, fallback: String) -> String:
	if battle_network_client_model == null or not battle_network_client_model.has_method(method_name):
		return fallback
	return String(battle_network_client_model.call(method_name))
