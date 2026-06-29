class_name ReplayStore
extends RefCounted

const REPLAY_DIR := "user://replays"
const LATEST_REPLAY_PATH := "user://replays/latest_local_replay.json"
const REPLAY_INDEX_PATH := "user://replays/index.json"
const MAX_INDEX_ENTRIES := 20

var last_error := ""

func save_snapshot(snapshot: Dictionary, path: String = LATEST_REPLAY_PATH) -> bool:
	last_error = ""
	if snapshot.is_empty():
		_set_error("snapshot is empty")
		return false
	if not _ensure_replay_dir():
		return false
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		_set_error("failed to open %s for writing: %s" % [path, error_string(FileAccess.get_open_error())])
		return false
	file.store_string(JSON.stringify(snapshot, "\t"))
	_update_index(snapshot, path)
	return true

func load_snapshot(path: String = LATEST_REPLAY_PATH) -> Dictionary:
	last_error = ""
	if not FileAccess.file_exists(path):
		_set_error("%s missing" % path)
		return {}
	var raw := FileAccess.get_file_as_string(path)
	var parsed = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		_set_error("%s is not a replay JSON object" % path)
		return {}
	return parsed

func latest_path() -> String:
	return LATEST_REPLAY_PATH

func latest_exists() -> bool:
	return FileAccess.file_exists(LATEST_REPLAY_PATH)

func load_index() -> Array[Dictionary]:
	if not FileAccess.file_exists(REPLAY_INDEX_PATH):
		return []
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(REPLAY_INDEX_PATH))
	if typeof(parsed) != TYPE_DICTIONARY:
		_set_error("%s is not a replay index JSON object" % REPLAY_INDEX_PATH)
		return []
	var entries = parsed.get("entries", [])
	if typeof(entries) != TYPE_ARRAY:
		_set_error("%s entries is not an array" % REPLAY_INDEX_PATH)
		return []
	var result: Array[Dictionary] = []
	for entry in entries:
		if typeof(entry) == TYPE_DICTIONARY:
			result.append(entry)
	return result

func latest_index_entry() -> Dictionary:
	var entries := load_index()
	if entries.is_empty():
		return {}
	return entries[0]

func validate_index_metadata(entries: Array[Dictionary] = []) -> Dictionary:
	var replay_entries := entries
	if replay_entries.is_empty():
		replay_entries = load_index()
	var failures: Array[String] = []
	var checked := 0
	var spellbook_entries := 0
	for entry in replay_entries:
		checked += 1
		var replay_id := str(entry.get("replay_id", ""))
		if replay_id.is_empty():
			failures.append("missing_replay_id:%d" % checked)
		if str(entry.get("ruleset_version", "")).is_empty():
			failures.append("missing_ruleset:%s" % replay_id)
		if int(entry.get("final_tick", 0)) < 0:
			failures.append("bad_final_tick:%s" % replay_id)
		if str(entry.get("mode", "")) == "boss_spellbook_practice" or str(entry.get("catalog_id", "")) == "boss_spellbook":
			spellbook_entries += 1
			if str(entry.get("spellbook_id", "")).is_empty():
				failures.append("missing_spellbook_id:%s" % replay_id)
			if str(entry.get("phase_id", "")).is_empty():
				failures.append("missing_phase_id:%s" % replay_id)
			if str(entry.get("preview_export_id", "")).is_empty():
				failures.append("missing_preview_export_id:%s" % replay_id)
			if int(entry.get("preview_signature_digest", 0)) <= 0:
				failures.append("missing_preview_digest:%s" % replay_id)
			if bool(entry.get("server_authoritative", false)):
				failures.append("local_preview_marked_authoritative:%s" % replay_id)
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"checked": checked,
		"spellbook_entries": spellbook_entries,
	}

func save_index(entries: Array[Dictionary]) -> bool:
	if not _ensure_replay_dir():
		return false
	var file := FileAccess.open(REPLAY_INDEX_PATH, FileAccess.WRITE)
	if file == null:
		_set_error("failed to open %s for writing: %s" % [REPLAY_INDEX_PATH, error_string(FileAccess.get_open_error())])
		return false
	file.store_string(JSON.stringify({
		"schema_version": 1,
		"entries": entries,
	}, "\t"))
	return true

func load_snapshot_from_entry(entry: Dictionary) -> Dictionary:
	var path := str(entry.get("path", ""))
	if path.is_empty():
		_set_error("replay index entry missing path")
		return {}
	return load_snapshot(path)

func toggle_favorite(replay_id: String) -> bool:
	var entries := load_index()
	for i in range(entries.size()):
		if str(entries[i].get("replay_id", "")) == replay_id:
			entries[i]["favorite"] = not bool(entries[i].get("favorite", false))
			return save_index(entries)
	_set_error("replay index entry not found: %s" % replay_id)
	return false

func remove_from_index(replay_id: String) -> bool:
	var entries := load_index()
	var filtered: Array[Dictionary] = []
	var removed := false
	for entry in entries:
		if str(entry.get("replay_id", "")) == replay_id:
			removed = true
			continue
		filtered.append(entry)
	if not removed:
		_set_error("replay index entry not found: %s" % replay_id)
		return false
	return save_index(filtered)

func index_path() -> String:
	return REPLAY_INDEX_PATH

func _ensure_replay_dir() -> bool:
	var absolute_dir := ProjectSettings.globalize_path(REPLAY_DIR)
	var error := DirAccess.make_dir_recursive_absolute(absolute_dir)
	if error != OK:
		_set_error("failed to create %s: %s" % [REPLAY_DIR, error_string(error)])
		return false
	return true

func _set_error(message: String) -> void:
	last_error = message

func _update_index(snapshot: Dictionary, path: String) -> void:
	var entries := load_index()
	var entry := _build_index_entry(snapshot, path)
	entries = entries.filter(func(existing: Dictionary) -> bool:
		return str(existing.get("replay_id", "")) != str(entry.get("replay_id", ""))
	)
	entries.push_front(entry)
	if entries.size() > MAX_INDEX_ENTRIES:
		entries = entries.slice(0, MAX_INDEX_ENTRIES)
	save_index(entries)

func _build_index_entry(snapshot: Dictionary, path: String) -> Dictionary:
	var input_stream: Array = snapshot.get("input_stream", [])
	var metadata: Dictionary = snapshot.get("metadata", {})
	var final_hash := int(snapshot.get("final_result_hash", 0))
	var saved_at := str(metadata.get("saved_at", Time.get_datetime_string_from_system(true, true)))
	var preview_digest := int(metadata.get("preview_signature_digest", snapshot.get("preview_signature_digest", 0)))
	if preview_digest <= 0 and not str(metadata.get("preview_signature", "")).is_empty():
		preview_digest = _stable_signature_digest(str(metadata.get("preview_signature", "")))
	return {
		"replay_id": "%s_%s_%d" % [str(snapshot.get("ruleset_version", "local")), str(snapshot.get("match_seed", 0)), final_hash],
		"path": path,
		"saved_at": saved_at,
		"game_version": str(snapshot.get("game_version", "prototype")),
		"ruleset_version": str(snapshot.get("ruleset_version", "ruleset-local-s0")),
		"match_seed": int(snapshot.get("match_seed", 0)),
		"final_tick": int(metadata.get("final_tick", input_stream.size())),
		"score": int(metadata.get("score", 0)),
		"graze": int(metadata.get("graze", 0)),
		"hits": int(metadata.get("hits", 0)),
		"pattern_id": str(metadata.get("pattern_id", "")),
		"catalog_id": str(metadata.get("catalog_id", "")),
		"spellbook_id": str(metadata.get("spellbook_id", "")),
		"phase_id": str(metadata.get("phase_id", "")),
		"preview_export_id": str(metadata.get("preview_export_id", "")),
		"preview_signature_digest": preview_digest,
		"metadata_valid": _metadata_valid(metadata),
		"metadata_status": _metadata_status(metadata),
		"server_authoritative": bool(metadata.get("server_authoritative", false)),
		"opponent": str(metadata.get("opponent", metadata.get("pattern_id", "local"))),
		"mode": str(metadata.get("mode", "local_practice")),
		"result": str(metadata.get("result", "practice")),
		"final_result_hash": final_hash,
		"favorite": bool(metadata.get("favorite", false)),
	}

func _metadata_valid(metadata: Dictionary) -> bool:
	if str(metadata.get("mode", "")) != "boss_spellbook_practice" and str(metadata.get("catalog_id", "")) != "boss_spellbook":
		return true
	var preview_digest := int(metadata.get("preview_signature_digest", 0))
	if preview_digest <= 0 and not str(metadata.get("preview_signature", "")).is_empty():
		preview_digest = _stable_signature_digest(str(metadata.get("preview_signature", "")))
	return not str(metadata.get("spellbook_id", "")).is_empty() \
		and not str(metadata.get("phase_id", "")).is_empty() \
		and not str(metadata.get("preview_export_id", "")).is_empty() \
		and preview_digest > 0 \
		and not bool(metadata.get("server_authoritative", false))

func _metadata_status(metadata: Dictionary) -> String:
	if _metadata_valid(metadata):
		return "valid"
	return "missing_spellbook_preview"

func _stable_signature_digest(signature: String) -> int:
	var digest := 0
	for index in range(signature.length()):
		digest = int((digest * 131 + signature.unicode_at(index)) % 1000000007)
	return digest
