class_name ProtocolDescriptorModel
extends RefCounted

const DEFAULT_DESCRIPTOR_PATH := "res://../../PhK-Protocol/descriptors/phk_v1_descriptor.json"

var path := DEFAULT_DESCRIPTOR_PATH
var descriptor: Dictionary = {}
var last_status := "not_loaded"
var last_error := "none"

func load_descriptor(custom_path: String = DEFAULT_DESCRIPTOR_PATH) -> Dictionary:
	path = custom_path
	if not FileAccess.file_exists(path):
		descriptor = {}
		last_status = "missing"
		last_error = "descriptor_missing"
		return {"ok": false, "reason": last_error}
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		descriptor = {}
		last_status = "invalid"
		last_error = "descriptor_invalid_json"
		return {"ok": false, "reason": last_error}
	descriptor = parsed as Dictionary
	last_status = "loaded"
	last_error = "none"
	return {"ok": true, "version": descriptor_version(), "source_digest": source_digest()}

func descriptor_version() -> String:
	return String(descriptor.get("descriptor_version", ""))

func protocol_version() -> int:
	return int(descriptor.get("protocol_version", 0))

func business_api_version() -> String:
	return String(descriptor.get("business_api_version", ""))

func battle_api_version() -> String:
	return String(descriptor.get("battle_api_version", ""))

func ruleset_version() -> String:
	return String(descriptor.get("ruleset_version", ""))

func source_digest() -> String:
	return String(descriptor.get("source_digest_sha256", ""))

func has_message(message_name: String) -> bool:
	return not message_fields(message_name).is_empty()

func enum_values(enum_name: String) -> Dictionary:
	for proto_file in descriptor.get("files", []):
		if typeof(proto_file) != TYPE_DICTIONARY:
			continue
		for enum_value in (proto_file as Dictionary).get("enums", []):
			if typeof(enum_value) != TYPE_DICTIONARY:
				continue
			var enum_dict: Dictionary = enum_value
			if String(enum_dict.get("name", "")) != enum_name:
				continue
			var values := {}
			for item in enum_dict.get("values", []):
				if typeof(item) != TYPE_DICTIONARY:
					continue
				var item_dict: Dictionary = item
				values[String(item_dict.get("name", ""))] = int(item_dict.get("number", 0))
			return values
	return {}

func battle_payload_type_for(payload_type: String) -> Dictionary:
	var enum_name := _battle_payload_enum_name(payload_type)
	if enum_name.is_empty():
		return {"ok": false, "reason": "payload_type_empty"}
	var values := enum_values("BattlePayloadType")
	if not values.has(enum_name):
		return {"ok": false, "reason": "payload_type_missing", "payload_type": payload_type, "enum_name": enum_name}
	return {
		"ok": true,
		"payload_type": payload_type,
		"enum_name": enum_name,
		"number": int(values.get(enum_name, 0)),
	}

func message_fields(message_name: String) -> Array[String]:
	var fields: Array[String] = []
	for proto_file in descriptor.get("files", []):
		if typeof(proto_file) != TYPE_DICTIONARY:
			continue
		for message in (proto_file as Dictionary).get("messages", []):
			if typeof(message) != TYPE_DICTIONARY:
				continue
			var message_dict: Dictionary = message
			if String(message_dict.get("name", "")) != message_name:
				continue
			for field in message_dict.get("fields", []):
				if typeof(field) == TYPE_DICTIONARY:
					fields.append(String((field as Dictionary).get("name", "")))
			return fields
	return fields

func validate_minimal_contract() -> Dictionary:
	if descriptor.is_empty():
		return {"ok": false, "reason": "descriptor_not_loaded"}
	for message_name in ["BusinessSecureEnvelope", "BattleTicket", "BattlePacketHeader", "BattleInput", "BattleResult"]:
		if not has_message(message_name):
			return {"ok": false, "reason": "message_missing", "message": message_name}
	var payload_values := enum_values("BattlePayloadType")
	for enum_name in ["BATTLE_PAYLOAD_TYPE_INPUT", "BATTLE_PAYLOAD_TYPE_SNAPSHOT", "BATTLE_PAYLOAD_TYPE_EVENT", "BATTLE_PAYLOAD_TYPE_RESULT"]:
		if not payload_values.has(enum_name):
			return {"ok": false, "reason": "payload_enum_missing", "enum": enum_name}
	var ticket_fields := message_fields("BattleTicket")
	for field_name in ["match_id", "player_id", "battle_server_id", "endpoint", "ruleset_version", "expires_at_ms"]:
		if not ticket_fields.has(field_name):
			return {"ok": false, "reason": "ticket_field_missing", "field": field_name}
	var header_fields := message_fields("BattlePacketHeader")
	for field_name in ["match_id", "player_id", "tick", "seq", "ack", "payload_type", "key_id", "nonce"]:
		if not header_fields.has(field_name):
			return {"ok": false, "reason": "header_field_missing", "field": field_name}
	return {"ok": true, "version": descriptor_version(), "protocol_version": protocol_version()}

func summary() -> String:
	if descriptor.is_empty():
		return "%s %s" % [last_status, last_error]
	return "phk.v1 %s p%d business %s battle %s" % [
		descriptor_version(),
		protocol_version(),
		business_api_version(),
		battle_api_version(),
	]

func rows() -> Array[Dictionary]:
	return [
		{
			"id": "protocol_descriptor",
			"label": "Protocol descriptor",
			"value": summary(),
			"section": "business_network",
			"ui_control": "status",
			"enabled": not descriptor.is_empty(),
		},
		{
			"id": "protocol_descriptor_digest",
			"label": "Protocol digest",
			"value": source_digest(),
			"section": "battle_network",
			"ui_control": "status",
			"enabled": not source_digest().is_empty(),
		},
	]

func _battle_payload_enum_name(payload_type: String) -> String:
	var normalized := payload_type.strip_edges().to_upper().replace("-", "_").replace(" ", "_")
	if normalized.is_empty():
		return ""
	if normalized.begins_with("BATTLE_PAYLOAD_TYPE_"):
		return normalized
	return "BATTLE_PAYLOAD_TYPE_%s" % normalized
