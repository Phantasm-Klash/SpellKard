class_name ReplayStore
extends RefCounted

const REPLAY_DIR := "user://replays"
const LATEST_REPLAY_PATH := "user://replays/latest_local_replay.json"
const REPLAY_INDEX_PATH := "user://replays/index.json"
const MAX_INDEX_ENTRIES := 20
const SPELLBOOK_PREVIEW_EXPORT_SCHEMA_VERSION := 1
const SPELLBOOK_PREVIEW_SAMPLE_TICKS: Array[int] = [0, 28, 56, 84, 112, 140]
const SPELLBOOK_PREVIEW_SAMPLE_WINDOW_START_TICK := 0
const SPELLBOOK_PREVIEW_SAMPLE_WINDOW_END_TICK := 140
const SPELLBOOK_PREVIEW_SAMPLE_WINDOW_STRIDE_TICKS := 28
const SPELLBOOK_PREVIEW_EXPORT_PREFIX := "boss_spellbook_preview"

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
			var sample_ticks: Array[int] = _preview_sample_ticks_from_fields(entry)
			var sample_window_start_tick := int(entry.get("preview_sample_window_start_tick", _preview_sample_window_start_tick_from_signature(str(entry.get("preview_signature", "")))))
			var sample_window_end_tick := int(entry.get("preview_sample_window_end_tick", _preview_sample_window_end_tick_from_signature(str(entry.get("preview_signature", "")))))
			var sample_window_stride_ticks := int(entry.get("preview_sample_window_stride_ticks", _preview_sample_window_stride_ticks_from_signature(str(entry.get("preview_signature", "")))))
			var sample_signature_digests: Array[int] = _preview_sample_signature_digests_from_fields(entry)
			var sample_emit_counts: Array[int] = _preview_sample_emit_counts_from_fields(entry)
			var max_emit_per_tick := int(entry.get("preview_max_emit_per_tick", -1))
			var bullet_cap_per_tick := int(entry.get("preview_bullet_cap_per_tick", -1))
			var signature_sample_signature_digests: Array[int] = _sample_signature_digests_from_signature(str(entry.get("preview_signature", "")))
			var signature_sample_emit_counts: Array[int] = _sample_emit_counts_from_signature(str(entry.get("preview_signature", "")))
			var signature_digest := _stable_signature_digest(str(entry.get("preview_signature", ""))) if not str(entry.get("preview_signature", "")).is_empty() else 0
			if str(entry.get("spellbook_id", "")).is_empty():
				failures.append("missing_spellbook_id:%s" % replay_id)
			if str(entry.get("phase_id", "")).is_empty():
				failures.append("missing_phase_id:%s" % replay_id)
			if str(entry.get("preview_export_id", "")).is_empty():
				failures.append("missing_preview_export_id:%s" % replay_id)
			if str(entry.get("preview_fixture_id", "")).is_empty():
				failures.append("missing_preview_fixture_id:%s" % replay_id)
			elif str(entry.get("preview_fixture_id", "")) != _expected_preview_fixture_id(entry):
				failures.append("preview_fixture_mismatch:%s" % replay_id)
			if str(entry.get("preview_export_id", "")) != _expected_preview_export_id(entry):
				failures.append("preview_export_id_mismatch:%s" % replay_id)
			if int(entry.get("preview_export_schema_version", 0)) != SPELLBOOK_PREVIEW_EXPORT_SCHEMA_VERSION:
				failures.append("bad_preview_schema:%s" % replay_id)
			if int(entry.get("preview_signature_digest", 0)) <= 0:
				failures.append("missing_preview_digest:%s" % replay_id)
			elif signature_digest > 0 and int(entry.get("preview_signature_digest", 0)) != signature_digest:
				failures.append("preview_signature_digest_mismatch:%s" % replay_id)
			var sample_count := int(entry.get("preview_sample_count", -1))
			if sample_ticks.is_empty():
				failures.append("missing_preview_sample_ticks:%s" % replay_id)
			if sample_signature_digests.is_empty():
				failures.append("missing_preview_sample_digests:%s" % replay_id)
			elif not _all_nonnegative_ints(sample_signature_digests):
				failures.append("preview_sample_digest_negative:%s" % replay_id)
			if sample_emit_counts.is_empty():
				failures.append("missing_preview_sample_emit_counts:%s" % replay_id)
			elif not _all_nonnegative_ints(sample_emit_counts):
				failures.append("preview_sample_emit_count_negative:%s" % replay_id)
			if sample_count <= 0:
				failures.append("missing_preview_sample_count:%s" % replay_id)
			elif sample_count != sample_ticks.size():
				failures.append("preview_sample_count_mismatch:%s" % replay_id)
			elif sample_count != sample_signature_digests.size():
				failures.append("preview_sample_digest_count_mismatch:%s" % replay_id)
			elif sample_count != sample_emit_counts.size():
				failures.append("preview_sample_emit_count_mismatch:%s" % replay_id)
			if not _arrays_equal_ints(sample_ticks, SPELLBOOK_PREVIEW_SAMPLE_TICKS):
				failures.append("preview_sample_ticks_noncanonical:%s" % replay_id)
			if sample_window_start_tick != SPELLBOOK_PREVIEW_SAMPLE_WINDOW_START_TICK:
				failures.append("preview_sample_window_start_mismatch:%s" % replay_id)
			if sample_window_end_tick != SPELLBOOK_PREVIEW_SAMPLE_WINDOW_END_TICK:
				failures.append("preview_sample_window_end_mismatch:%s" % replay_id)
			if sample_window_stride_ticks != SPELLBOOK_PREVIEW_SAMPLE_WINDOW_STRIDE_TICKS:
				failures.append("preview_sample_window_stride_mismatch:%s" % replay_id)
			if not signature_sample_signature_digests.is_empty() and not _arrays_equal_ints(sample_signature_digests, signature_sample_signature_digests):
				failures.append("preview_sample_digest_signature_mismatch:%s" % replay_id)
			if not signature_sample_emit_counts.is_empty() and not _arrays_equal_ints(sample_emit_counts, signature_sample_emit_counts):
				failures.append("preview_sample_emit_count_signature_mismatch:%s" % replay_id)
			if max_emit_per_tick < 0:
				failures.append("missing_preview_max_emit:%s" % replay_id)
			elif max_emit_per_tick != _max_int(sample_emit_counts):
				failures.append("preview_max_emit_mismatch:%s" % replay_id)
			if bullet_cap_per_tick <= 0:
				failures.append("missing_preview_bullet_cap:%s" % replay_id)
			elif int(entry.get("preview_budget_headroom", -1)) != bullet_cap_per_tick - max_emit_per_tick:
				failures.append("preview_budget_headroom_mismatch:%s" % replay_id)
			if int(entry.get("preview_budget_headroom", -1)) < 0:
				failures.append("preview_budget_overrun:%s" % replay_id)
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
	if String(entry.get("preview_fixture_id", "")) != _expected_preview_fixture_id(preview):
		failures.append("preview_fixture_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_export_schema_version", 0)) != int(preview.get("export_schema_version", 0)):
		failures.append("preview_schema_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_signature_digest", 0)) != int(preview.get("signature_digest", 0)):
		failures.append("preview_digest_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_budget_headroom", -1)) != int(preview.get("budget_headroom", -2)):
		failures.append("preview_headroom_mismatch:%s" % str(entry.get("replay_id", "")))
	if String(entry.get("performance_budget_status", "")) != String(preview.get("performance_budget_status", "")):
		failures.append("preview_budget_status_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_max_emit_per_tick", -1)) != int(preview.get("max_emit_per_tick", -2)):
		failures.append("preview_max_emit_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_bullet_cap_per_tick", -1)) != int(preview.get("bullet_cap_per_tick", -2)):
		failures.append("preview_bullet_cap_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_sample_count", -1)) != (preview.get("samples", []) as Array).size():
		failures.append("preview_sample_count_mismatch:%s" % str(entry.get("replay_id", "")))
	if not _arrays_equal_ints(entry.get("preview_sample_ticks", []), preview.get("sample_ticks", [])):
		failures.append("preview_sample_ticks_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_sample_window_start_tick", -1)) != int(preview.get("sample_window_start_tick", -2)):
		failures.append("preview_sample_window_start_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_sample_window_end_tick", -1)) != int(preview.get("sample_window_end_tick", -2)):
		failures.append("preview_sample_window_end_mismatch:%s" % str(entry.get("replay_id", "")))
	if int(entry.get("preview_sample_window_stride_ticks", -1)) != int(preview.get("sample_window_stride_ticks", -2)):
		failures.append("preview_sample_window_stride_mismatch:%s" % str(entry.get("replay_id", "")))
	if not _arrays_equal_ints(entry.get("preview_sample_signature_digests", []), preview.get("sample_signature_digests", [])):
		failures.append("preview_sample_digest_mismatch:%s" % str(entry.get("replay_id", "")))
	if not _arrays_equal_ints(entry.get("preview_sample_emit_counts", []), preview.get("sample_emit_counts", [])):
		failures.append("preview_sample_emit_count_mismatch:%s" % str(entry.get("replay_id", "")))
	return {
		"ok": failures.is_empty(),
		"failures": failures,
	}

func metadata_status_for_entry(entry: Dictionary) -> String:
	return _spellbook_metadata_status_from_fields(entry)

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
	var is_spellbook_preview := str(metadata.get("mode", "")) == "boss_spellbook_practice" or str(metadata.get("catalog_id", "")) == "boss_spellbook"
	var preview_schema_version := int(metadata.get("preview_export_schema_version", 0))
	if preview_schema_version <= 0 and is_spellbook_preview and not str(metadata.get("preview_signature", "")).is_empty():
		preview_schema_version = SPELLBOOK_PREVIEW_EXPORT_SCHEMA_VERSION
	var preview_sample_ticks := _preview_sample_ticks_from_fields(metadata)
	var preview_sample_window_start_tick := int(metadata.get("preview_sample_window_start_tick", _preview_sample_window_start_tick_from_signature(str(metadata.get("preview_signature", "")))))
	var preview_sample_window_end_tick := int(metadata.get("preview_sample_window_end_tick", _preview_sample_window_end_tick_from_signature(str(metadata.get("preview_signature", "")))))
	var preview_sample_window_stride_ticks := int(metadata.get("preview_sample_window_stride_ticks", _preview_sample_window_stride_ticks_from_signature(str(metadata.get("preview_signature", "")))))
	var preview_sample_signature_digests := _preview_sample_signature_digests_from_fields(metadata)
	var preview_sample_emit_counts := _preview_sample_emit_counts_from_fields(metadata)
	var preview_max_emit_per_tick := int(metadata.get("preview_max_emit_per_tick", _max_int(preview_sample_emit_counts)))
	var preview_bullet_cap_per_tick := int(metadata.get("preview_bullet_cap_per_tick", 0))
	if preview_bullet_cap_per_tick <= 0 and preview_max_emit_per_tick >= 0:
		preview_bullet_cap_per_tick = preview_max_emit_per_tick + int(metadata.get("preview_budget_headroom", 0))
	var entry := {
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
		"preview_export_schema_version": preview_schema_version,
		"preview_export_id": str(metadata.get("preview_export_id", "")),
		"preview_fixture_id": str(metadata.get("preview_fixture_id", _expected_preview_fixture_id_from_parts(str(metadata.get("spellbook_id", "")), str(metadata.get("phase_id", "")), int(snapshot.get("match_seed", 0))))),
		"preview_signature": str(metadata.get("preview_signature", "")),
		"preview_signature_digest": preview_digest,
		"preview_sample_ticks": preview_sample_ticks,
		"preview_sample_window_start_tick": preview_sample_window_start_tick,
		"preview_sample_window_end_tick": preview_sample_window_end_tick,
		"preview_sample_window_stride_ticks": preview_sample_window_stride_ticks,
		"preview_sample_signature_digests": preview_sample_signature_digests,
		"preview_sample_emit_counts": preview_sample_emit_counts,
		"preview_sample_count": int(metadata.get("preview_sample_count", preview_sample_ticks.size())),
		"preview_max_emit_per_tick": preview_max_emit_per_tick,
		"preview_bullet_cap_per_tick": preview_bullet_cap_per_tick,
		"preview_budget_headroom": int(metadata.get("preview_budget_headroom", 0)),
		"performance_budget_status": str(metadata.get("performance_budget_status", "")),
		"metadata_valid": false,
		"metadata_status": "unchecked",
		"server_authoritative": bool(metadata.get("server_authoritative", false)),
		"opponent": str(metadata.get("opponent", metadata.get("pattern_id", "local"))),
		"mode": str(metadata.get("mode", "local_practice")),
		"result": str(metadata.get("result", "practice")),
		"final_result_hash": final_hash,
		"favorite": bool(metadata.get("favorite", false)),
	}
	entry["metadata_valid"] = _metadata_valid(entry)
	entry["metadata_status"] = _metadata_status(entry)
	return entry

func _metadata_valid(metadata: Dictionary) -> bool:
	return _spellbook_metadata_status_from_fields(metadata) == "valid"

func _metadata_status(metadata: Dictionary) -> String:
	return _spellbook_metadata_status_from_fields(metadata)

func _spellbook_metadata_status_from_fields(fields: Dictionary) -> String:
	if str(fields.get("mode", "")) != "boss_spellbook_practice" and str(fields.get("catalog_id", "")) != "boss_spellbook":
		return "valid"
	var preview_digest := int(fields.get("preview_signature_digest", 0))
	if preview_digest <= 0 and not str(fields.get("preview_signature", "")).is_empty():
		preview_digest = _stable_signature_digest(str(fields.get("preview_signature", "")))
	var signature_digest := _stable_signature_digest(str(fields.get("preview_signature", ""))) if not str(fields.get("preview_signature", "")).is_empty() else 0
	if bool(fields.get("server_authoritative", false)):
		return "local_preview_marked_authoritative"
	if str(fields.get("spellbook_id", "")).is_empty() \
			or str(fields.get("phase_id", "")).is_empty() \
			or str(fields.get("preview_export_id", "")).is_empty() \
			or preview_digest <= 0:
		return "missing_spellbook_preview"
	if str(fields.get("preview_fixture_id", "")).is_empty():
		return "missing_spellbook_preview"
	if str(fields.get("preview_fixture_id", "")) != _expected_preview_fixture_id(fields) \
			or str(fields.get("preview_export_id", "")) != _expected_preview_export_id(fields):
		return "preview_fixture_mismatch"
	if int(fields.get("preview_export_schema_version", 0)) != SPELLBOOK_PREVIEW_EXPORT_SCHEMA_VERSION:
		return "bad_preview_schema"
	if signature_digest > 0 and preview_digest != signature_digest:
		return "preview_signature_digest_mismatch"
	var sample_ticks := _preview_sample_ticks_from_fields(fields)
	var sample_window_start_tick := int(fields.get("preview_sample_window_start_tick", _preview_sample_window_start_tick_from_signature(str(fields.get("preview_signature", "")))))
	var sample_window_end_tick := int(fields.get("preview_sample_window_end_tick", _preview_sample_window_end_tick_from_signature(str(fields.get("preview_signature", "")))))
	var sample_window_stride_ticks := int(fields.get("preview_sample_window_stride_ticks", _preview_sample_window_stride_ticks_from_signature(str(fields.get("preview_signature", "")))))
	var sample_signature_digests := _preview_sample_signature_digests_from_fields(fields)
	var sample_emit_counts := _preview_sample_emit_counts_from_fields(fields)
	var max_emit_per_tick := int(fields.get("preview_max_emit_per_tick", -1))
	var bullet_cap_per_tick := int(fields.get("preview_bullet_cap_per_tick", -1))
	var signature_sample_signature_digests := _sample_signature_digests_from_signature(str(fields.get("preview_signature", "")))
	var signature_sample_emit_counts := _sample_emit_counts_from_signature(str(fields.get("preview_signature", "")))
	var sample_count := int(fields.get("preview_sample_count", -1))
	if sample_ticks.is_empty() or sample_signature_digests.is_empty() or sample_emit_counts.is_empty() or sample_count <= 0:
		return "bad_preview_sample_window"
	if sample_count != sample_ticks.size() or sample_count != sample_signature_digests.size() or sample_count != sample_emit_counts.size():
		return "bad_preview_sample_window"
	if not _arrays_equal_ints(sample_ticks, SPELLBOOK_PREVIEW_SAMPLE_TICKS):
		return "bad_preview_sample_window"
	if sample_window_start_tick != SPELLBOOK_PREVIEW_SAMPLE_WINDOW_START_TICK \
			or sample_window_end_tick != SPELLBOOK_PREVIEW_SAMPLE_WINDOW_END_TICK \
			or sample_window_stride_ticks != SPELLBOOK_PREVIEW_SAMPLE_WINDOW_STRIDE_TICKS:
		return "bad_preview_sample_window"
	if not _all_nonnegative_ints(sample_signature_digests) or not _all_nonnegative_ints(sample_emit_counts):
		return "bad_preview_sample_window"
	if not signature_sample_signature_digests.is_empty() and not _arrays_equal_ints(sample_signature_digests, signature_sample_signature_digests):
		return "bad_preview_sample_window"
	if not signature_sample_emit_counts.is_empty() and not _arrays_equal_ints(sample_emit_counts, signature_sample_emit_counts):
		return "bad_preview_sample_window"
	if max_emit_per_tick < 0 or max_emit_per_tick != _max_int(sample_emit_counts):
		return "bad_preview_sample_window"
	if bullet_cap_per_tick <= 0 or int(fields.get("preview_budget_headroom", -1)) != bullet_cap_per_tick - max_emit_per_tick:
		return "preview_budget_overrun"
	if int(fields.get("preview_budget_headroom", -1)) < 0 or str(fields.get("performance_budget_status", "")) != "within_budget":
		return "preview_budget_overrun"
	return "valid"

func _stable_signature_digest(signature: String) -> int:
	var digest := 0
	for index in range(signature.length()):
		digest = int((digest * 131 + signature.unicode_at(index)) % 1000000007)
	return digest

func _expected_preview_fixture_id(fields: Dictionary) -> String:
	return _expected_preview_fixture_id_from_parts(
		str(fields.get("spellbook_id", "")),
		str(fields.get("phase_id", "")),
		int(fields.get("seed", fields.get("match_seed", 0)))
	)

func _expected_preview_fixture_id_from_parts(spellbook_id: String, phase_id: String, seed: int) -> String:
	if spellbook_id.is_empty() or phase_id.is_empty() or seed <= 0:
		return ""
	return "%s:%s:%d" % [spellbook_id, phase_id, seed]

func _expected_preview_export_id(fields: Dictionary) -> String:
	var fixture_id := _expected_preview_fixture_id(fields)
	if fixture_id.is_empty():
		return ""
	return "%s_%s_%s_%d" % [
		SPELLBOOK_PREVIEW_EXPORT_PREFIX,
		str(fields.get("spellbook_id", "")),
		str(fields.get("phase_id", "")),
		int(fields.get("seed", fields.get("match_seed", 0))),
	]

func _normalized_int_array(value: Variant) -> Array[int]:
	var result: Array[int] = []
	if typeof(value) != TYPE_ARRAY:
		return result
	for item in value:
		result.append(int(item))
	return result

func _preview_sample_ticks_from_fields(fields: Dictionary) -> Array[int]:
	var direct := _normalized_int_array(fields.get("preview_sample_ticks", []))
	if not direct.is_empty():
		return direct
	return _sample_ticks_from_signature(str(fields.get("preview_signature", "")))

func _preview_sample_signature_digests_from_fields(fields: Dictionary) -> Array[int]:
	var direct := _normalized_int_array(fields.get("preview_sample_signature_digests", []))
	if not direct.is_empty():
		return direct
	return _sample_signature_digests_from_signature(str(fields.get("preview_signature", "")))

func _preview_sample_emit_counts_from_fields(fields: Dictionary) -> Array[int]:
	var direct := _normalized_int_array(fields.get("preview_sample_emit_counts", []))
	if not direct.is_empty():
		return direct
	return _sample_emit_counts_from_signature(str(fields.get("preview_signature", "")))

func _sample_ticks_from_signature(signature: String) -> Array[int]:
	if _sample_signature_segments_from_signature(signature).is_empty():
		return []
	return SPELLBOOK_PREVIEW_SAMPLE_TICKS.duplicate()

func _preview_sample_window_start_tick_from_signature(signature: String) -> int:
	return SPELLBOOK_PREVIEW_SAMPLE_WINDOW_START_TICK if not _sample_signature_segments_from_signature(signature).is_empty() else -1

func _preview_sample_window_end_tick_from_signature(signature: String) -> int:
	return SPELLBOOK_PREVIEW_SAMPLE_WINDOW_END_TICK if not _sample_signature_segments_from_signature(signature).is_empty() else -1

func _preview_sample_window_stride_ticks_from_signature(signature: String) -> int:
	return SPELLBOOK_PREVIEW_SAMPLE_WINDOW_STRIDE_TICKS if not _sample_signature_segments_from_signature(signature).is_empty() else -1

func _sample_signature_digests_from_signature(signature: String) -> Array[int]:
	var digests: Array[int] = []
	for segment in _sample_signature_segments_from_signature(signature):
		digests.append(_stable_signature_digest(String(segment)))
	return digests

func _sample_emit_counts_from_signature(signature: String) -> Array[int]:
	var emit_counts: Array[int] = []
	for segment in _sample_signature_segments_from_signature(signature):
		if String(segment).is_empty():
			emit_counts.append(0)
		else:
			emit_counts.append(String(segment).split("|", false).size())
	return emit_counts

func _sample_signature_segments_from_signature(signature: String) -> Array[String]:
	var segments: Array[String] = []
	if signature.is_empty():
		return segments
	var cursor := 0
	for index in range(SPELLBOOK_PREVIEW_SAMPLE_TICKS.size()):
		var tick := SPELLBOOK_PREVIEW_SAMPLE_TICKS[index]
		var marker := "%d:" % tick
		var marker_index := 0
		if index == 0:
			if not signature.begins_with(marker):
				return []
			marker_index = 0
		else:
			marker_index = signature.find("|%s" % marker, cursor)
			if marker_index < 0:
				return []
			marker_index += 1
		var content_start := marker_index + marker.length()
		var content_end := signature.length()
		if index + 1 < SPELLBOOK_PREVIEW_SAMPLE_TICKS.size():
			var next_marker_index := signature.find("|%d:" % int(SPELLBOOK_PREVIEW_SAMPLE_TICKS[index + 1]), content_start)
			if next_marker_index < 0:
				return []
			content_end = next_marker_index
		segments.append(signature.substr(content_start, content_end - content_start))
		cursor = content_end
	return segments

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

func _all_nonnegative_ints(values: Array[int]) -> bool:
	for value in values:
		if int(value) < 0:
			return false
	return true

func _max_int(values: Array[int]) -> int:
	var result := -1
	for value in values:
		result = maxi(result, int(value))
	return result
