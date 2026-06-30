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
const SPELLBOOK_PREVIEW_BUNDLE_PREFIX := "boss_spellbook_preview_bundle"
const SPELLBOOK_PREVIEW_AUTHORITY_SCOPE := "local_practice_preview_only"
const SPELLBOOK_PREVIEW_PHASE_ORDER: Dictionary = {
	"original_boss_archive": ["nonspell_radial_entry", "spell_laser_field", "spell_summoner_split", "last_spell_morph_bounce"],
}
const SPELLBOOK_PREVIEW_GOLDEN_FIXTURES: Dictionary = {
	"original_boss_archive:nonspell_radial_entry:20260625": {"export_schema_version": 1, "export_id": "boss_spellbook_preview_original_boss_archive_nonspell_radial_entry_20260625", "preview_fixture_id": "original_boss_archive:nonspell_radial_entry:20260625", "preview_authority_scope": "local_practice_preview_only", "signature_digest": 905452029, "sample_ticks": [0, 28, 56, 84, 112, 140], "sample_window_start_tick": 0, "sample_window_end_tick": 140, "sample_window_stride_ticks": 28, "sample_signature_digests": [429408177, 651507191, 705589077, 266214312, 882357878, 75020320], "sample_emit_counts": [24, 42, 24, 24, 42, 24], "sample_count": 6, "max_emit_per_tick": 42, "bullet_cap_per_tick": 192, "budget_headroom": 150, "performance_budget_status": "within_budget"},
	"original_boss_archive:spell_laser_field:20260625": {"export_schema_version": 1, "export_id": "boss_spellbook_preview_original_boss_archive_spell_laser_field_20260625", "preview_fixture_id": "original_boss_archive:spell_laser_field:20260625", "preview_authority_scope": "local_practice_preview_only", "signature_digest": 187927263, "sample_ticks": [0, 28, 56, 84, 112, 140], "sample_window_start_tick": 0, "sample_window_end_tick": 140, "sample_window_stride_ticks": 28, "sample_signature_digests": [450260093, 75256905, 0, 862484991, 934817433, 0], "sample_emit_counts": [3, 2, 0, 12, 20, 0], "sample_count": 6, "max_emit_per_tick": 20, "bullet_cap_per_tick": 192, "budget_headroom": 172, "performance_budget_status": "within_budget"},
	"original_boss_archive:spell_summoner_split:20260625": {"export_schema_version": 1, "export_id": "boss_spellbook_preview_original_boss_archive_spell_summoner_split_20260625", "preview_fixture_id": "original_boss_archive:spell_summoner_split:20260625", "preview_authority_scope": "local_practice_preview_only", "signature_digest": 471609142, "sample_ticks": [0, 28, 56, 84, 112, 140], "sample_window_start_tick": 0, "sample_window_end_tick": 140, "sample_window_stride_ticks": 28, "sample_signature_digests": [368982465, 0, 0, 0, 0, 742323659], "sample_emit_counts": [4, 0, 0, 0, 0, 12], "sample_count": 6, "max_emit_per_tick": 12, "bullet_cap_per_tick": 192, "budget_headroom": 180, "performance_budget_status": "within_budget"},
	"original_boss_archive:last_spell_morph_bounce:20260625": {"export_schema_version": 1, "export_id": "boss_spellbook_preview_original_boss_archive_last_spell_morph_bounce_20260625", "preview_fixture_id": "original_boss_archive:last_spell_morph_bounce:20260625", "preview_authority_scope": "local_practice_preview_only", "signature_digest": 979716623, "sample_ticks": [0, 28, 56, 84, 112, 140], "sample_window_start_tick": 0, "sample_window_end_tick": 140, "sample_window_stride_ticks": 28, "sample_signature_digests": [769410047, 0, 0, 0, 0, 0], "sample_emit_counts": [30, 0, 0, 0, 0, 0], "sample_count": 6, "max_emit_per_tick": 30, "bullet_cap_per_tick": 192, "budget_headroom": 162, "performance_budget_status": "within_budget"},
}
const SPELLBOOK_PREVIEW_SERVER_AUTHORITY_FIELDS: Array[String] = [
	"boss_instance_id",
	"boss_max_hp",
	"boss_current_hp",
	"boss_hp_delta",
	"boss_damage",
	"boss_hp_after",
	"boss_hp_after_global",
	"boss_hp_global_max",
	"current_hp",
	"max_hp",
	"damage_dealt",
	"daily_attempts_left",
	"daily_attempts_used",
	"defeated_at",
	"reward_grants",
	"settlement_receipt",
	"settlement_status",
	"world_announcement",
	"world_boss_defeated",
	"instance_boss_clear",
	"clear_stars",
	"server_result_hash",
]

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
			var preview_seed := _preview_seed_from_fields(entry)
			var signature_sample_signature_digests: Array[int] = _sample_signature_digests_from_signature(str(entry.get("preview_signature", "")))
			var signature_sample_emit_counts: Array[int] = _sample_emit_counts_from_signature(str(entry.get("preview_signature", "")))
			var signature_digest := _stable_signature_digest(str(entry.get("preview_signature", ""))) if not str(entry.get("preview_signature", "")).is_empty() else 0
			var preview_phase_ids: Array[String] = _preview_phase_ids_from_fields(entry)
			var preview_phase_signature_digests: Array[int] = _preview_phase_signature_digests_from_fields(entry)
			if str(entry.get("spellbook_id", "")).is_empty():
				failures.append("missing_spellbook_id:%s" % replay_id)
			if str(entry.get("phase_id", "")).is_empty():
				failures.append("missing_phase_id:%s" % replay_id)
			if str(entry.get("preview_export_id", "")).is_empty():
				failures.append("missing_preview_export_id:%s" % replay_id)
			if str(entry.get("preview_authority_scope", SPELLBOOK_PREVIEW_AUTHORITY_SCOPE)) != SPELLBOOK_PREVIEW_AUTHORITY_SCOPE:
				failures.append("preview_authority_scope_mismatch:%s" % replay_id)
			if preview_seed <= 0:
				failures.append("missing_preview_seed:%s" % replay_id)
			elif int(entry.get("match_seed", 0)) > 0 and preview_seed != int(entry.get("match_seed", 0)):
				failures.append("preview_seed_mismatch:%s" % replay_id)
			if str(entry.get("preview_fixture_id", "")).is_empty():
				failures.append("missing_preview_fixture_id:%s" % replay_id)
			elif str(entry.get("preview_fixture_id", "")) != _expected_preview_fixture_id(entry):
				failures.append("preview_fixture_mismatch:%s" % replay_id)
			if str(entry.get("preview_export_id", "")) != _expected_preview_export_id(entry):
				failures.append("preview_export_id_mismatch:%s" % replay_id)
			if _has_preview_bundle_metadata(entry):
				if str(entry.get("preview_bundle_id", "")) != _expected_preview_bundle_id(entry):
					failures.append("preview_bundle_id_mismatch:%s" % replay_id)
				if int(entry.get("preview_bundle_signature_digest", 0)) <= 0:
					failures.append("preview_bundle_digest_missing:%s" % replay_id)
				elif int(entry.get("preview_bundle_signature_digest", 0)) != _expected_preview_bundle_signature_digest(entry):
					failures.append("preview_bundle_digest_mismatch:%s" % replay_id)
				if int(entry.get("preview_phase_count", 0)) != _expected_preview_phase_count(entry):
					failures.append("preview_bundle_phase_count_mismatch:%s" % replay_id)
				if preview_phase_ids.is_empty():
					failures.append("preview_bundle_phase_ids_missing:%s" % replay_id)
				elif not _arrays_equal_strings(preview_phase_ids, _expected_preview_phase_ids(entry)):
					failures.append("preview_bundle_phase_ids_mismatch:%s" % replay_id)
				if preview_phase_signature_digests.is_empty():
					failures.append("preview_bundle_phase_digest_missing:%s" % replay_id)
				elif not _arrays_equal_ints(preview_phase_signature_digests, _expected_preview_phase_signature_digests(entry)):
					failures.append("preview_bundle_phase_digest_mismatch:%s" % replay_id)
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
			var golden_fixture: Dictionary = _golden_preview_fixture_for_fields(entry)
			if golden_fixture.is_empty():
				failures.append("unknown_preview_fixture:%s" % replay_id)
			else:
				failures.append_array(_golden_fixture_failures(entry, golden_fixture, replay_id))
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
			var authority_claim_fields := _server_authority_claim_fields(entry)
			if not authority_claim_fields.is_empty():
				failures.append("local_preview_server_claim:%s:%s" % [replay_id, ",".join(authority_claim_fields)])
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
	if String(preview.get("preview_fixture_id", "")) != _expected_preview_fixture_id(preview):
		failures.append("preview_fixture_source_mismatch:%s" % str(entry.get("replay_id", "")))
	if String(preview.get("export_id", "")) != _expected_preview_export_id(preview):
		failures.append("preview_export_source_mismatch:%s" % str(entry.get("replay_id", "")))
	if String(entry.get("spellbook_id", "")) != String(preview.get("spellbook_id", "")):
		failures.append("preview_spellbook_mismatch:%s" % str(entry.get("replay_id", "")))
	if String(entry.get("phase_id", "")) != String(preview.get("phase_id", "")):
		failures.append("preview_phase_mismatch:%s" % str(entry.get("replay_id", "")))
	if String(entry.get("preview_export_id", "")) != String(preview.get("export_id", "")):
		failures.append("preview_export_mismatch:%s" % str(entry.get("replay_id", "")))
	if _has_preview_bundle_metadata(entry):
		if String(entry.get("preview_bundle_id", "")) != String(preview.get("preview_bundle_id", "")):
			failures.append("preview_bundle_mismatch:%s" % str(entry.get("replay_id", "")))
		if int(entry.get("preview_bundle_signature_digest", 0)) != int(preview.get("preview_bundle_signature_digest", 0)):
			failures.append("preview_bundle_digest_mismatch:%s" % str(entry.get("replay_id", "")))
		if int(entry.get("preview_phase_count", 0)) != int(preview.get("preview_phase_count", 0)):
			failures.append("preview_bundle_phase_count_mismatch:%s" % str(entry.get("replay_id", "")))
		if not _arrays_equal_strings(_preview_phase_ids_from_fields(entry), _preview_phase_ids_from_fields(preview)):
			failures.append("preview_bundle_phase_ids_mismatch:%s" % str(entry.get("replay_id", "")))
		if not _arrays_equal_ints(_preview_phase_signature_digests_from_fields(entry), _preview_phase_signature_digests_from_fields(preview)):
			failures.append("preview_bundle_phase_digest_mismatch:%s" % str(entry.get("replay_id", "")))
	if String(entry.get("preview_authority_scope", SPELLBOOK_PREVIEW_AUTHORITY_SCOPE)) != SPELLBOOK_PREVIEW_AUTHORITY_SCOPE \
			or String(preview.get("preview_authority_scope", "")) != SPELLBOOK_PREVIEW_AUTHORITY_SCOPE:
		failures.append("preview_authority_scope_mismatch:%s" % str(entry.get("replay_id", "")))
	if _preview_seed_from_fields(entry) != int(preview.get("seed", 0)):
		failures.append("preview_seed_mismatch:%s" % str(entry.get("replay_id", "")))
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

func metadata_failures_for_entry(entry: Dictionary) -> Array[String]:
	var result := validate_index_metadata([entry])
	var failures: Array[String] = []
	for failure in result.get("failures", []):
		failures.append(String(failure))
	return failures

func server_authority_claim_fields_for_entry(entry: Dictionary) -> Array[String]:
	return _server_authority_claim_fields(entry)

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
	var preview_seed := int(metadata.get("preview_seed", metadata.get("seed", snapshot.get("match_seed", 0))))
	var preview_bullet_cap_per_tick := int(metadata.get("preview_bullet_cap_per_tick", 0))
	if preview_bullet_cap_per_tick <= 0 and preview_max_emit_per_tick >= 0:
		preview_bullet_cap_per_tick = preview_max_emit_per_tick + int(metadata.get("preview_budget_headroom", 0))
	var server_authority_claim_fields := _server_authority_claim_fields_from_sources(metadata, snapshot)
	var entry := {
		"replay_id": "%s_%s_%d" % [str(snapshot.get("ruleset_version", "local")), str(snapshot.get("match_seed", 0)), final_hash],
		"path": path,
		"saved_at": saved_at,
		"game_version": str(snapshot.get("game_version", "prototype")),
		"ruleset_version": str(snapshot.get("ruleset_version", "ruleset-local-s0")),
		"match_seed": int(snapshot.get("match_seed", 0)),
		"preview_seed": preview_seed,
		"final_tick": int(metadata.get("final_tick", input_stream.size())),
		"score": int(metadata.get("score", 0)),
		"graze": int(metadata.get("graze", 0)),
		"hits": int(metadata.get("hits", 0)),
		"pattern_id": str(metadata.get("pattern_id", "")),
		"catalog_id": str(metadata.get("catalog_id", "")),
		"spellbook_id": str(metadata.get("spellbook_id", "")),
		"phase_id": str(metadata.get("phase_id", "")),
		"preview_export_schema_version": preview_schema_version,
		"preview_bundle_id": str(metadata.get("preview_bundle_id", "")),
		"preview_bundle_signature_digest": int(metadata.get("preview_bundle_signature_digest", 0)),
		"preview_phase_count": int(metadata.get("preview_phase_count", 0)),
		"preview_phase_ids": _preview_phase_ids_from_fields(metadata),
		"preview_phase_signature_digests": _preview_phase_signature_digests_from_fields(metadata),
		"preview_export_id": str(metadata.get("preview_export_id", "")),
		"preview_authority_scope": str(metadata.get("preview_authority_scope", SPELLBOOK_PREVIEW_AUTHORITY_SCOPE if is_spellbook_preview else "")),
		"preview_fixture_id": str(metadata.get("preview_fixture_id", _expected_preview_fixture_id_from_parts(str(metadata.get("spellbook_id", "")), str(metadata.get("phase_id", "")), preview_seed))),
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
		"server_authority_claim_fields": server_authority_claim_fields,
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
	if not _server_authority_claim_fields(fields).is_empty():
		return "local_preview_server_claim"
	if str(fields.get("spellbook_id", "")).is_empty() \
			or str(fields.get("phase_id", "")).is_empty() \
			or str(fields.get("preview_export_id", "")).is_empty() \
			or preview_digest <= 0:
		return "missing_spellbook_preview"
	if str(fields.get("preview_fixture_id", "")).is_empty():
		return "missing_spellbook_preview"
	var preview_seed := _preview_seed_from_fields(fields)
	if preview_seed <= 0:
		return "missing_spellbook_preview"
	if int(fields.get("match_seed", 0)) > 0 and preview_seed != int(fields.get("match_seed", 0)):
		return "preview_seed_mismatch"
	if str(fields.get("preview_fixture_id", "")) != _expected_preview_fixture_id(fields):
		return "preview_fixture_mismatch"
	if str(fields.get("preview_export_id", "")) != _expected_preview_export_id(fields):
		return "preview_export_id_mismatch"
	if _has_preview_bundle_metadata(fields):
		if str(fields.get("preview_bundle_id", "")) != _expected_preview_bundle_id(fields):
			return "preview_bundle_id_mismatch"
		if int(fields.get("preview_bundle_signature_digest", 0)) <= 0:
			return "preview_bundle_digest_missing"
		if int(fields.get("preview_bundle_signature_digest", 0)) != _expected_preview_bundle_signature_digest(fields):
			return "preview_bundle_digest_mismatch"
		if int(fields.get("preview_phase_count", 0)) != _expected_preview_phase_count(fields):
			return "preview_bundle_phase_count_mismatch"
		if _preview_phase_ids_from_fields(fields).is_empty():
			return "preview_bundle_phase_ids_missing"
		if not _arrays_equal_strings(_preview_phase_ids_from_fields(fields), _expected_preview_phase_ids(fields)):
			return "preview_bundle_phase_ids_mismatch"
		if _preview_phase_signature_digests_from_fields(fields).is_empty():
			return "preview_bundle_phase_digest_missing"
		if not _arrays_equal_ints(_preview_phase_signature_digests_from_fields(fields), _expected_preview_phase_signature_digests(fields)):
			return "preview_bundle_phase_digest_mismatch"
	if str(fields.get("preview_authority_scope", SPELLBOOK_PREVIEW_AUTHORITY_SCOPE)) != SPELLBOOK_PREVIEW_AUTHORITY_SCOPE:
		return "preview_authority_scope_mismatch"
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
		return "missing_preview_samples"
	if sample_count != sample_ticks.size():
		return "preview_sample_count_mismatch"
	if sample_count != sample_signature_digests.size():
		return "preview_sample_digest_count_mismatch"
	if sample_count != sample_emit_counts.size():
		return "preview_sample_emit_count_mismatch"
	if not _arrays_equal_ints(sample_ticks, SPELLBOOK_PREVIEW_SAMPLE_TICKS):
		return "preview_sample_ticks_noncanonical"
	if sample_window_start_tick != SPELLBOOK_PREVIEW_SAMPLE_WINDOW_START_TICK \
			or sample_window_end_tick != SPELLBOOK_PREVIEW_SAMPLE_WINDOW_END_TICK \
			or sample_window_stride_ticks != SPELLBOOK_PREVIEW_SAMPLE_WINDOW_STRIDE_TICKS:
		return "preview_sample_window_mismatch"
	if not _all_nonnegative_ints(sample_signature_digests):
		return "preview_sample_digest_negative"
	if not _all_nonnegative_ints(sample_emit_counts):
		return "preview_sample_emit_count_negative"
	if not signature_sample_signature_digests.is_empty() and not _arrays_equal_ints(sample_signature_digests, signature_sample_signature_digests):
		return "preview_sample_digest_mismatch"
	if not signature_sample_emit_counts.is_empty() and not _arrays_equal_ints(sample_emit_counts, signature_sample_emit_counts):
		return "preview_sample_emit_count_mismatch"
	var golden_fixture := _golden_preview_fixture_for_fields(fields)
	if golden_fixture.is_empty():
		return "unknown_preview_fixture"
	var golden_status := _golden_fixture_status(fields, golden_fixture)
	if golden_status != "valid":
		return golden_status
	if max_emit_per_tick < 0 or max_emit_per_tick != _max_int(sample_emit_counts):
		return "preview_max_emit_mismatch"
	if bullet_cap_per_tick <= 0 or int(fields.get("preview_budget_headroom", -1)) != bullet_cap_per_tick - max_emit_per_tick:
		return "preview_budget_headroom_mismatch"
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
		_preview_seed_from_fields(fields)
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
		_preview_seed_from_fields(fields),
	]

func _expected_preview_bundle_id(fields: Dictionary) -> String:
	var spellbook_id := str(fields.get("spellbook_id", ""))
	var seed := _preview_seed_from_fields(fields)
	if spellbook_id.is_empty() or seed <= 0:
		return ""
	return "%s_%s_%d" % [SPELLBOOK_PREVIEW_BUNDLE_PREFIX, spellbook_id, seed]

func _expected_preview_phase_count(fields: Dictionary) -> int:
	var spellbook_id := str(fields.get("spellbook_id", ""))
	var seed := _preview_seed_from_fields(fields)
	if spellbook_id.is_empty() or seed <= 0:
		return 0
	var count := 0
	for fixture_id in SPELLBOOK_PREVIEW_GOLDEN_FIXTURES.keys():
		var parts := String(fixture_id).split(":")
		if parts.size() == 3 and String(parts[0]) == spellbook_id and int(parts[2]) == seed:
			count += 1
	return count

func _expected_preview_phase_ids(fields: Dictionary) -> Array[String]:
	var spellbook_id := str(fields.get("spellbook_id", ""))
	if spellbook_id.is_empty() or not SPELLBOOK_PREVIEW_PHASE_ORDER.has(spellbook_id):
		return []
	var result: Array[String] = []
	for phase_id in SPELLBOOK_PREVIEW_PHASE_ORDER.get(spellbook_id, []):
		result.append(String(phase_id))
	return result

func _expected_preview_phase_signature_digests(fields: Dictionary) -> Array[int]:
	var spellbook_id := str(fields.get("spellbook_id", ""))
	var seed := _preview_seed_from_fields(fields)
	if spellbook_id.is_empty() or seed <= 0:
		return []
	var result: Array[int] = []
	for phase_id in _expected_preview_phase_ids(fields):
		var fixture_id := "%s:%s:%d" % [spellbook_id, phase_id, seed]
		if not SPELLBOOK_PREVIEW_GOLDEN_FIXTURES.has(fixture_id):
			return []
		result.append(int((SPELLBOOK_PREVIEW_GOLDEN_FIXTURES[fixture_id] as Dictionary).get("signature_digest", 0)))
	return result

func _expected_preview_bundle_signature_digest(fields: Dictionary) -> int:
	var spellbook_id := str(fields.get("spellbook_id", ""))
	var seed := _preview_seed_from_fields(fields)
	if spellbook_id.is_empty() or seed <= 0 or not SPELLBOOK_PREVIEW_PHASE_ORDER.has(spellbook_id):
		return 0
	var parts: Array[String] = ["%s:%d" % [spellbook_id, seed]]
	for phase_id in SPELLBOOK_PREVIEW_PHASE_ORDER.get(spellbook_id, []):
		var fixture_id := "%s:%s:%d" % [spellbook_id, String(phase_id), seed]
		if not SPELLBOOK_PREVIEW_GOLDEN_FIXTURES.has(fixture_id):
			return 0
		var fixture: Dictionary = SPELLBOOK_PREVIEW_GOLDEN_FIXTURES[fixture_id]
		parts.append("%s:%s:%s:%d:%d:%d:%d:%d" % [
			String(phase_id),
			String(fixture.get("export_id", "")),
			fixture_id,
			int(fixture.get("signature_digest", 0)),
			int(fixture.get("sample_count", 0)),
			int(fixture.get("max_emit_per_tick", 0)),
			int(fixture.get("bullet_cap_per_tick", 0)),
			int(fixture.get("budget_headroom", 0)),
		])
	return _stable_signature_digest("|".join(parts))

func _has_preview_bundle_metadata(fields: Dictionary) -> bool:
	return not str(fields.get("preview_bundle_id", "")).is_empty() \
			or int(fields.get("preview_bundle_signature_digest", 0)) > 0 \
			or int(fields.get("preview_phase_count", 0)) > 0 \
			or not _normalized_string_array(fields.get("preview_phase_ids", [])).is_empty() \
			or not _normalized_int_array(fields.get("preview_phase_signature_digests", [])).is_empty()

func _preview_seed_from_fields(fields: Dictionary) -> int:
	return int(fields.get("preview_seed", fields.get("seed", fields.get("match_seed", 0))))

func _golden_preview_fixture_for_fields(fields: Dictionary) -> Dictionary:
	var fixture_id := _expected_preview_fixture_id(fields)
	if fixture_id.is_empty() or not SPELLBOOK_PREVIEW_GOLDEN_FIXTURES.has(fixture_id):
		return {}
	return (SPELLBOOK_PREVIEW_GOLDEN_FIXTURES[fixture_id] as Dictionary).duplicate(true)

func _golden_fixture_status(fields: Dictionary, fixture: Dictionary) -> String:
	var replay_id := str(fields.get("replay_id", ""))
	var failures := _golden_fixture_failures(fields, fixture, replay_id)
	if failures.is_empty():
		return "valid"
	var first_failure := String(failures[0])
	if first_failure.begins_with("preview_signature_digest_mismatch:"):
		return "preview_signature_digest_mismatch"
	if first_failure.begins_with("preview_sample_digest_mismatch:"):
		return "preview_sample_digest_mismatch"
	if first_failure.begins_with("preview_sample_emit_count_mismatch:"):
		return "preview_sample_emit_count_mismatch"
	if first_failure.begins_with("preview_max_emit_mismatch:"):
		return "preview_max_emit_mismatch"
	if first_failure.begins_with("preview_budget_headroom_mismatch:"):
		return "preview_budget_headroom_mismatch"
	if first_failure.begins_with("preview_budget_status:"):
		return "preview_budget_overrun"
	if first_failure.begins_with("bad_preview_schema:"):
		return "bad_preview_schema"
	if first_failure.begins_with("preview_authority_scope_mismatch:"):
		return "preview_authority_scope_mismatch"
	if first_failure.begins_with("preview_export_id_mismatch:"):
		return "preview_export_id_mismatch"
	if first_failure.begins_with("preview_bundle_id_mismatch:"):
		return "preview_bundle_id_mismatch"
	if first_failure.begins_with("preview_bundle_digest_missing:"):
		return "preview_bundle_digest_missing"
	if first_failure.begins_with("preview_bundle_digest_mismatch:"):
		return "preview_bundle_digest_mismatch"
	if first_failure.begins_with("preview_bundle_phase_count_mismatch:"):
		return "preview_bundle_phase_count_mismatch"
	return "preview_golden_fixture_mismatch"

func _golden_fixture_failures(fields: Dictionary, fixture: Dictionary, replay_id: String) -> Array[String]:
	var failures: Array[String] = []
	if int(fields.get("preview_export_schema_version", 0)) != int(fixture.get("export_schema_version", 0)):
		failures.append("bad_preview_schema:%s" % replay_id)
	if str(fields.get("preview_export_id", "")) != str(fixture.get("export_id", "")):
		failures.append("preview_export_id_mismatch:%s" % replay_id)
	if str(fields.get("preview_authority_scope", SPELLBOOK_PREVIEW_AUTHORITY_SCOPE)) != str(fixture.get("preview_authority_scope", "")):
		failures.append("preview_authority_scope_mismatch:%s" % replay_id)
	if int(fields.get("preview_signature_digest", 0)) != int(fixture.get("signature_digest", 0)):
		failures.append("preview_signature_digest_mismatch:%s" % replay_id)
	if not _arrays_equal_ints(_preview_sample_ticks_from_fields(fields), fixture.get("sample_ticks", [])):
		failures.append("preview_sample_ticks_noncanonical:%s" % replay_id)
	if int(fields.get("preview_sample_window_start_tick", -1)) != int(fixture.get("sample_window_start_tick", -2)) \
			or int(fields.get("preview_sample_window_end_tick", -1)) != int(fixture.get("sample_window_end_tick", -2)) \
			or int(fields.get("preview_sample_window_stride_ticks", -1)) != int(fixture.get("sample_window_stride_ticks", -2)):
		failures.append("preview_sample_window_mismatch:%s" % replay_id)
	if int(fields.get("preview_sample_count", -1)) != int(fixture.get("sample_count", 0)):
		failures.append("preview_sample_count_mismatch:%s" % replay_id)
	if not _arrays_equal_ints(_preview_sample_signature_digests_from_fields(fields), fixture.get("sample_signature_digests", [])):
		failures.append("preview_sample_digest_mismatch:%s" % replay_id)
	if not _arrays_equal_ints(_preview_sample_emit_counts_from_fields(fields), fixture.get("sample_emit_counts", [])):
		failures.append("preview_sample_emit_count_mismatch:%s" % replay_id)
	if int(fields.get("preview_max_emit_per_tick", -1)) != int(fixture.get("max_emit_per_tick", 0)):
		failures.append("preview_max_emit_mismatch:%s" % replay_id)
	if int(fields.get("preview_bullet_cap_per_tick", -1)) != int(fixture.get("bullet_cap_per_tick", 0)) \
			or int(fields.get("preview_budget_headroom", -1)) != int(fixture.get("budget_headroom", 0)):
		failures.append("preview_budget_headroom_mismatch:%s" % replay_id)
	if str(fields.get("performance_budget_status", "")) != str(fixture.get("performance_budget_status", "")):
		failures.append("preview_budget_status:%s" % replay_id)
	return failures

func _server_authority_claim_fields(fields: Dictionary) -> Array[String]:
	var claims: Array[String] = []
	if typeof(fields.get("server_authority_claim_fields", [])) == TYPE_ARRAY:
		for field in fields.get("server_authority_claim_fields", []):
			var field_name := String(field)
			if not field_name.is_empty() and not claims.has(field_name):
				claims.append(field_name)
	for field_name in SPELLBOOK_PREVIEW_SERVER_AUTHORITY_FIELDS:
		if fields.has(field_name) and not claims.has(field_name):
			claims.append(field_name)
	return claims

func _server_authority_claim_fields_from_sources(primary_fields: Dictionary, secondary_fields: Dictionary = {}) -> Array[String]:
	var claims := _server_authority_claim_fields(primary_fields)
	for field_name in _server_authority_claim_fields(secondary_fields):
		if not claims.has(field_name):
			claims.append(field_name)
	return claims

func _normalized_int_array(value: Variant) -> Array[int]:
	var result: Array[int] = []
	if typeof(value) != TYPE_ARRAY:
		return result
	for item in value:
		result.append(int(item))
	return result

func _normalized_string_array(value: Variant) -> Array[String]:
	var result: Array[String] = []
	if typeof(value) != TYPE_ARRAY:
		return result
	for item in value:
		result.append(String(item))
	return result

func _preview_phase_ids_from_fields(fields: Dictionary) -> Array[String]:
	return _normalized_string_array(fields.get("preview_phase_ids", []))

func _preview_phase_signature_digests_from_fields(fields: Dictionary) -> Array[int]:
	return _normalized_int_array(fields.get("preview_phase_signature_digests", []))

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

func _arrays_equal_strings(left: Variant, right: Variant) -> bool:
	if typeof(left) != TYPE_ARRAY or typeof(right) != TYPE_ARRAY:
		return false
	var left_array: Array = left
	var right_array: Array = right
	if left_array.size() != right_array.size():
		return false
	for index in range(left_array.size()):
		if String(left_array[index]) != String(right_array[index]):
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
