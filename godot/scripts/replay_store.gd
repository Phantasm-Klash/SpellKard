class_name ReplayStore
extends RefCounted

const BossSpellbookModel := preload("res://scripts/boss_spellbook_model.gd")

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
			var sample_ticks: Array[int] = _normalized_int_array(entry.get("preview_sample_ticks", []))
			var sample_emit_counts: Array[int] = _normalized_int_array(entry.get("preview_sample_emit_counts", []))
			var sample_count := int(entry.get("preview_sample_count", -1))
			var max_preview_emit := int(entry.get("max_preview_emit", -1))
			var preview_cap := int(entry.get("preview_bullet_cap_per_tick", -1))
			if sample_ticks.is_empty():
				failures.append("missing_preview_sample_ticks:%s" % replay_id)
			if sample_emit_counts.is_empty():
				failures.append("missing_preview_sample_emit_counts:%s" % replay_id)
			if sample_count <= 0:
				failures.append("missing_preview_sample_count:%s" % replay_id)
			elif sample_count != sample_ticks.size():
				failures.append("preview_sample_count_mismatch:%s" % replay_id)
			elif sample_count != sample_emit_counts.size():
				failures.append("preview_sample_emit_count_mismatch:%s" % replay_id)
			if max_preview_emit < 0:
				failures.append("missing_preview_max_emit:%s" % replay_id)
			if preview_cap <= 0:
				failures.append("missing_preview_bullet_cap:%s" % replay_id)
			if int(entry.get("preview_budget_headroom", -1)) < 0:
				failures.append("preview_budget_overrun:%s" % replay_id)
			elif max_preview_emit >= 0 and preview_cap > 0 and int(entry.get("preview_budget_headroom", -1)) != preview_cap - max_preview_emit:
				failures.append("preview_budget_contract_mismatch:%s" % replay_id)
			if str(entry.get("performance_budget_status", "")) != "within_budget":
				failures.append("preview_budget_status:%s" % replay_id)
			if bool(entry.get("server_authoritative", false)):
				failures.append("local_preview_marked_authoritative:%s" % replay_id)
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"checked": checked,
		"spellbook_entries": spellbook_entries,
	}

func validate_spellbook_preview_metadata(entry: Dictionary, preview: Dictionary) -> Dictionary:
	var failures: Array[String] = []
	var base_result := validate_index_metadata([entry])
	if not bool(base_result.get("ok", false)):
		for failure in base_result.get("failures", []):
			failures.append(String(failure))
	if String(entry.get("spellbook_id", "")) != String(preview.get("spellbook_id", "")):
		failures.append("preview_spellbook_mismatch:%s" % str(entry.get("replay_id", "")))
	if String(entry.get("phase_id", "")) != String(preview.get("phase_id", "")):
		failures.append("preview_phase_mismatch:%s" % str(entry.get("replay_id", "")))
	if String(entry.get("preview_export_id", "")) != String(preview.get("export_id", "")):
		failures.append("preview_export_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_signature_digest", 0)) != int(preview.get("signature_digest", 0)):
		failures.append("preview_digest_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("max_preview_emit", -1)) != int(preview.get("max_emit_per_tick", -2)):
		failures.append("preview_max_emit_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_bullet_cap_per_tick", -1)) != int(preview.get("bullet_cap_per_tick", -2)):
		failures.append("preview_cap_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_budget_headroom", -1)) != int(preview.get("budget_headroom", -2)):
		failures.append("preview_headroom_mismatch:%s" % str(entry.get("replay_id", "")))
	if String(entry.get("performance_budget_status", "")) != String(preview.get("performance_budget_status", "")):
		failures.append("preview_budget_status_mismatch:%s" % str(entry.get("replay_id", "")))
	if not _arrays_equal_ints(entry.get("preview_sample_ticks", []), preview.get("sample_ticks", [])):
		failures.append("preview_sample_ticks_mismatch:%s" % str(entry.get("replay_id", "")))
	if not _arrays_equal_ints(entry.get("preview_sample_emit_counts", []), preview.get("sample_emit_counts", [])):
		failures.append("preview_sample_emit_counts_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_sample_count", -1)) != (preview.get("samples", []) as Array).size():
		failures.append("preview_sample_count_mismatch:%s" % str(entry.get("replay_id", "")))
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"status": _preview_validation_status(failures),
	}

func metadata_status_for_entry(entry: Dictionary) -> String:
	return _metadata_status(entry)

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
	var raw_metadata: Dictionary = snapshot.get("metadata", {})
	var metadata: Dictionary = _metadata_with_spellbook_preview_defaults(snapshot, raw_metadata)
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
		"preview_sample_ticks": _normalized_int_array(metadata.get("preview_sample_ticks", [])),
		"preview_sample_emit_counts": _normalized_int_array(metadata.get("preview_sample_emit_counts", [])),
		"preview_sample_count": int(metadata.get("preview_sample_count", _normalized_int_array(metadata.get("preview_sample_ticks", [])).size())),
		"max_preview_emit": int(metadata.get("max_preview_emit", -1)),
		"preview_bullet_cap_per_tick": int(metadata.get("preview_bullet_cap_per_tick", -1)),
		"preview_budget_headroom": int(metadata.get("preview_budget_headroom", 0)),
		"performance_budget_status": str(metadata.get("performance_budget_status", "")),
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
	return _metadata_status(metadata) == "valid"

func _metadata_status(metadata: Dictionary) -> String:
	if str(metadata.get("mode", "")) != "boss_spellbook_practice" and str(metadata.get("catalog_id", "")) != "boss_spellbook":
		return "valid"
	var preview_digest := int(metadata.get("preview_signature_digest", 0))
	if preview_digest <= 0 and not str(metadata.get("preview_signature", "")).is_empty():
		preview_digest = _stable_signature_digest(str(metadata.get("preview_signature", "")))
	if str(metadata.get("spellbook_id", "")).is_empty() \
			or str(metadata.get("phase_id", "")).is_empty() \
			or str(metadata.get("preview_export_id", "")).is_empty() \
			or preview_digest <= 0:
		return "missing_spellbook_preview"
	var sample_ticks: Array[int] = _normalized_int_array(metadata.get("preview_sample_ticks", []))
	var sample_emit_counts: Array[int] = _normalized_int_array(metadata.get("preview_sample_emit_counts", []))
	var sample_count := int(metadata.get("preview_sample_count", -1))
	if sample_ticks.is_empty() or sample_count <= 0:
		return "missing_preview_sample_window"
	if sample_emit_counts.is_empty():
		return "missing_preview_sample_emit_counts"
	if sample_count != sample_ticks.size():
		return "preview_sample_count_mismatch"
	if sample_count != sample_emit_counts.size():
		return "preview_sample_emit_count_mismatch"
	var max_preview_emit := int(metadata.get("max_preview_emit", -1))
	var preview_cap := int(metadata.get("preview_bullet_cap_per_tick", -1))
	if max_preview_emit < 0 or preview_cap <= 0:
		return "missing_preview_budget_window"
	if int(metadata.get("preview_budget_headroom", -1)) < 0:
		return "preview_budget_overrun"
	if int(metadata.get("preview_budget_headroom", -1)) != preview_cap - max_preview_emit:
		return "preview_budget_contract_mismatch"
	if str(metadata.get("performance_budget_status", "")) != "within_budget":
		return "preview_budget_status"
	if bool(metadata.get("server_authoritative", false)):
		return "local_preview_marked_authoritative"
	return "valid"

func _metadata_with_spellbook_preview_defaults(snapshot: Dictionary, metadata: Dictionary) -> Dictionary:
	var result := metadata.duplicate(true)
	if str(result.get("mode", "")) != "boss_spellbook_practice" and str(result.get("catalog_id", "")) != "boss_spellbook":
		return result
	var practice_config: Dictionary = snapshot.get("practice_config", {})
	var spellbook_id := str(result.get("spellbook_id", practice_config.get("spellbook_id", "")))
	var phase_id := str(result.get("phase_id", practice_config.get("phase_id", "")))
	if spellbook_id.is_empty() or phase_id.is_empty():
		return result
	result["spellbook_id"] = spellbook_id
	result["phase_id"] = phase_id
	var preview := BossSpellbookModel.new().deterministic_phase_preview(spellbook_id, phase_id, int(snapshot.get("match_seed", 0)))
	if preview.is_empty():
		return result
	if str(result.get("preview_export_id", "")).is_empty():
		result["preview_export_id"] = str(preview.get("export_id", ""))
	if str(result.get("preview_signature", "")).is_empty():
		result["preview_signature"] = str(preview.get("signature", ""))
	if int(result.get("preview_signature_digest", 0)) <= 0:
		result["preview_signature_digest"] = int(preview.get("signature_digest", 0))
	if not result.has("preview_sample_ticks") or _normalized_int_array(result.get("preview_sample_ticks", [])).is_empty():
		result["preview_sample_ticks"] = (preview.get("sample_ticks", []) as Array).duplicate()
	if not result.has("preview_sample_emit_counts") or _normalized_int_array(result.get("preview_sample_emit_counts", [])).is_empty():
		result["preview_sample_emit_counts"] = (preview.get("sample_emit_counts", []) as Array).duplicate()
	if int(result.get("preview_sample_count", 0)) <= 0:
		result["preview_sample_count"] = (preview.get("samples", []) as Array).size()
	if not result.has("max_preview_emit") or int(result.get("max_preview_emit", -1)) < 0:
		result["max_preview_emit"] = int(preview.get("max_emit_per_tick", -1))
	if not result.has("preview_bullet_cap_per_tick") or int(result.get("preview_bullet_cap_per_tick", -1)) <= 0:
		result["preview_bullet_cap_per_tick"] = int(preview.get("bullet_cap_per_tick", -1))
	if not result.has("preview_budget_headroom"):
		result["preview_budget_headroom"] = int(preview.get("budget_headroom", 0))
	if str(result.get("performance_budget_status", "")).is_empty():
		result["performance_budget_status"] = str(preview.get("performance_budget_status", ""))
	return result

func _preview_validation_status(failures: Array[String]) -> String:
	if failures.is_empty():
		return "valid"
	var first_failure := String(failures[0])
	var separator := first_failure.find(":")
	if separator <= 0:
		return first_failure
	return first_failure.substr(0, separator)

func _stable_signature_digest(signature: String) -> int:
	var digest := 0
	for index in range(signature.length()):
		digest = int((digest * 131 + signature.unicode_at(index)) % 1000000007)
	return digest

func _normalized_int_array(value: Variant) -> Array[int]:
	var result: Array[int] = []
	if typeof(value) != TYPE_ARRAY:
		return result
	for item in value:
		result.append(int(item))
	return result

func _arrays_equal_ints(left: Variant, right: Variant) -> bool:
	if typeof(left) != TYPE_ARRAY or typeof(right) != TYPE_ARRAY:
		return false
	var left_array: Array = left
	var right_array: Array = right
	if left_array.size() != right_array.size():
		return false
	for index in range(left_array.size()):
		if int(left_array[index]) != int(right_array[index]):
			return false
	return true
