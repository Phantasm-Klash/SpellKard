extends SceneTree

const StageSelectModel := preload("res://scripts/stage_select_model.gd")
const BossPatternCatalog := preload("res://scripts/boss_pattern_catalog.gd")
const BossSpellbookModel := preload("res://scripts/boss_spellbook_model.gd")
const PatternLabModel := preload("res://scripts/pattern_lab_model.gd")
const ReplayListModel := preload("res://scripts/replay_list_model.gd")
const ReplayStore := preload("res://scripts/replay_store.gd")

func _initialize() -> void:
	var stage_model: RefCounted = StageSelectModel.new()
	var coverage: Dictionary = BossPatternCatalog.validate_stage_patterns(stage_model)
	if not bool(coverage.get("ok", false)):
		push_error("Boss pattern catalog failed: missing=%s seen=%s" % [
			coverage.get("missing_types", []),
			coverage.get("seen_types", []),
		])
		quit(1)
		return
	var recipes: Dictionary = BossPatternCatalog.validate_open_source_recipes()
	if not bool(recipes.get("ok", false)):
		push_error("Boss pattern recipes failed: %s" % [recipes])
		quit(1)
		return
	var spellbook_model: RefCounted = BossSpellbookModel.new()
	var pattern_lab_model: RefCounted = PatternLabModel.new()
	pattern_lab_model.configure(stage_model, spellbook_model)
	var spellbooks: Dictionary = spellbook_model.validate_spellbooks()
	if not bool(spellbooks.get("ok", false)):
		push_error("Boss spellbooks failed: %s" % [spellbooks])
		quit(1)
		return
	var preview_exports: Dictionary = BossPatternCatalog.validate_spellbook_preview_exports(spellbook_model, pattern_lab_model, 20260625)
	if not bool(preview_exports.get("ok", false)):
		push_error("Boss spellbook preview exports failed: %s" % [preview_exports])
		quit(1)
		return
	var replay_metadata: Dictionary = _validate_replay_metadata(spellbook_model)
	if not bool(replay_metadata.get("ok", false)):
		push_error("Boss spellbook replay metadata failed: %s" % [replay_metadata])
		quit(1)
		return
	var requirements: Dictionary = BossPatternCatalog.validate_boss_type_requirements(stage_model, spellbook_model)
	if not bool(requirements.get("ok", false)):
		push_error("Boss type requirements failed: %s" % [requirements])
		quit(1)
		return
	var official_types: Dictionary = BossPatternCatalog.validate_official_boss_type_coverage(stage_model, spellbook_model)
	if not bool(official_types.get("ok", false)):
		push_error("Official Boss type coverage failed: %s" % [official_types])
		quit(1)
		return
	var emitters: Dictionary = BossPatternCatalog.validate_pattern_emitters(stage_model, 20260625)
	if not bool(emitters.get("ok", false)):
		push_error("Boss pattern emitters failed: %s" % [emitters])
		quit(1)
		return
	var budgets: Dictionary = BossPatternCatalog.validate_performance_budgets(stage_model, spellbook_model, 20260625)
	if not bool(budgets.get("ok", false)):
		push_error("Boss pattern performance budgets failed: %s" % [budgets])
		quit(1)
		return
	print("boss_pattern_catalog_check ok: families=%d recipes=%d adapters=%d requirements=%d official_types=%d types=%d emitted=%d behavior_spawns=%d spellbooks=%d phases=%d previews=%d golden_previews=%d replay_metadata=%d max_emit=%d max_behavior_spawn=%d max_spellbook_emit=%d" % [
		BossPatternCatalog.family_rows().size(),
		int(recipes.get("recipe_count", 0)),
		int(recipes.get("adapter_count", 0)),
		int(requirements.get("requirement_count", 0)),
		int(official_types.get("requirement_count", 0)),
		BossPatternCatalog.all_catalog_pattern_types().size(),
		int(emitters.get("emitted_type_count", 0)),
		(emitters.get("behavior_spawn_types", []) as Array).size(),
		int(spellbooks.get("spellbook_count", 0)),
		int(spellbooks.get("phase_count", 0)),
		int(preview_exports.get("preview_count", 0)),
		int(preview_exports.get("golden_preview_count", 0)),
		int(replay_metadata.get("checked", 0)),
		int(budgets.get("max_initial_emit", 0)),
		int(budgets.get("max_behavior_spawned_per_tick", 0)),
		int(budgets.get("max_spellbook_emit_per_tick", 0)),
	])
	quit(0)

func _validate_replay_metadata(spellbook_model: RefCounted) -> Dictionary:
	var failures: Array[String] = []
	var store: RefCounted = ReplayStore.new()
	var valid_entries: Array[Dictionary] = []
	for spellbook_id in spellbook_model.spellbook_ids():
		for phase_row in spellbook_model.timeline_rows(String(spellbook_id)):
			var phase_id := String((phase_row as Dictionary).get("phase_id", ""))
			var preview: Dictionary = spellbook_model.deterministic_phase_preview(String(spellbook_id), phase_id, 20260625)
			var entry := _replay_entry_for_preview(store, String(spellbook_id), phase_id, preview)
			valid_entries.append(entry)
			var exact_result: Dictionary = store.validate_spellbook_preview_metadata(entry, preview)
			if not bool(exact_result.get("ok", false)):
				failures.append("valid_preview_metadata_rejected:%s:%s" % [phase_id, exact_result.get("failures", [])])
			if int(entry.get("preview_budget_headroom", -1)) != int(preview.get("budget_headroom", -2)):
				failures.append("entry_headroom_mismatch:%s" % phase_id)
			if String(entry.get("performance_budget_status", "")) != String(preview.get("performance_budget_status", "")):
				failures.append("entry_budget_status_mismatch:%s" % phase_id)
			if int(entry.get("preview_export_schema_version", 0)) != int(preview.get("export_schema_version", 0)):
				failures.append("entry_schema_mismatch:%s" % phase_id)
			if int(entry.get("preview_sample_count", -1)) != (preview.get("samples", []) as Array).size():
				failures.append("entry_sample_count_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(entry.get("preview_sample_ticks", []), preview.get("sample_ticks", [])):
				failures.append("entry_sample_ticks_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(entry.get("preview_sample_signature_digests", []), preview.get("sample_signature_digests", [])):
				failures.append("entry_sample_digest_mismatch:%s" % phase_id)
			var legacy_entry := _legacy_replay_entry_for_preview(store, String(spellbook_id), phase_id, preview)
			var legacy_result: Dictionary = store.validate_spellbook_preview_metadata(legacy_entry, preview)
			if not bool(legacy_result.get("ok", false)):
				failures.append("legacy_preview_metadata_rejected:%s:%s" % [phase_id, legacy_result.get("failures", [])])
			if int(legacy_entry.get("preview_export_schema_version", 0)) != int(preview.get("export_schema_version", 0)):
				failures.append("legacy_entry_schema_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(legacy_entry.get("preview_sample_ticks", []), preview.get("sample_ticks", [])):
				failures.append("legacy_entry_sample_ticks_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(legacy_entry.get("preview_sample_signature_digests", []), preview.get("sample_signature_digests", [])):
				failures.append("legacy_entry_sample_digest_mismatch:%s" % phase_id)
	var invalid_entry := valid_entries[0].duplicate(true)
	invalid_entry["replay_id"] = "fixture_missing_spellbook_preview"
	invalid_entry["preview_export_id"] = ""
	invalid_entry["preview_signature_digest"] = 0
	var bad_schema_entry := valid_entries[0].duplicate(true)
	bad_schema_entry["replay_id"] = "fixture_bad_schema_spellbook_preview"
	bad_schema_entry["preview_export_schema_version"] = 0
	var authoritative_entry := valid_entries[0].duplicate(true)
	authoritative_entry["replay_id"] = "fixture_authoritative_spellbook_preview"
	authoritative_entry["server_authoritative"] = true
	var over_budget_entry := valid_entries[0].duplicate(true)
	over_budget_entry["replay_id"] = "fixture_over_budget_spellbook_preview"
	over_budget_entry["preview_budget_headroom"] = -1
	over_budget_entry["performance_budget_status"] = "over_budget"
	var stale_digest_entry := valid_entries[0].duplicate(true)
	stale_digest_entry["replay_id"] = "fixture_stale_digest_spellbook_preview"
	stale_digest_entry["preview_signature_digest"] = int(stale_digest_entry.get("preview_signature_digest", 0)) + 1
	var stale_sample_entry := valid_entries[0].duplicate(true)
	stale_sample_entry["replay_id"] = "fixture_stale_samples_spellbook_preview"
	stale_sample_entry["preview_sample_ticks"] = [0, 30, 60]
	stale_sample_entry["preview_sample_count"] = 3
	var noncanonical_sample_ticks_entry := valid_entries[0].duplicate(true)
	noncanonical_sample_ticks_entry["replay_id"] = "fixture_noncanonical_sample_ticks_spellbook_preview"
	noncanonical_sample_ticks_entry["preview_sample_ticks"] = [0, 29, 56, 84, 112, 140]
	var stale_sample_digest_entry := valid_entries[0].duplicate(true)
	stale_sample_digest_entry["replay_id"] = "fixture_stale_sample_digests_spellbook_preview"
	var stale_digests: Array = (stale_sample_digest_entry.get("preview_sample_signature_digests", []) as Array).duplicate()
	stale_digests[0] = int(stale_digests[0]) + 1
	stale_sample_digest_entry["preview_sample_signature_digests"] = stale_digests
	var bad_sample_count_entry := valid_entries[0].duplicate(true)
	bad_sample_count_entry["replay_id"] = "fixture_bad_sample_count_spellbook_preview"
	bad_sample_count_entry["preview_sample_count"] = int(bad_sample_count_entry.get("preview_sample_count", 0)) + 1
	var missing_sample_entry := valid_entries[0].duplicate(true)
	missing_sample_entry["replay_id"] = "fixture_missing_samples_spellbook_preview"
	missing_sample_entry["preview_sample_ticks"] = []
	missing_sample_entry["preview_sample_signature_digests"] = []
	missing_sample_entry["preview_sample_count"] = 0
	var invalid_entries: Array[Dictionary] = [invalid_entry, bad_schema_entry, authoritative_entry, over_budget_entry, bad_sample_count_entry, missing_sample_entry, noncanonical_sample_ticks_entry]
	var valid_result: Dictionary = store.validate_index_metadata(valid_entries)
	if not bool(valid_result.get("ok", false)):
		failures.append("valid_replay_rejected:%s" % [valid_result.get("failures", [])])
	var invalid_result: Dictionary = store.validate_index_metadata(invalid_entries)
	if bool(invalid_result.get("ok", false)):
		failures.append("invalid_replay_accepted")
	var first_preview: Dictionary = spellbook_model.deterministic_phase_preview(
		String(valid_entries[0].get("spellbook_id", "")),
		String(valid_entries[0].get("phase_id", "")),
		20260625
	)
	if bool(store.validate_spellbook_preview_metadata(stale_digest_entry, first_preview).get("ok", false)):
		failures.append("stale_digest_preview_accepted")
	if bool(store.validate_spellbook_preview_metadata(stale_sample_entry, first_preview).get("ok", false)):
		failures.append("stale_sample_preview_accepted")
	if bool(store.validate_spellbook_preview_metadata(stale_sample_digest_entry, first_preview).get("ok", false)):
		failures.append("stale_sample_digest_preview_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(bad_schema_entry)).get("ok", false)):
		failures.append("bad_schema_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(bad_sample_count_entry)).get("ok", false)):
		failures.append("bad_sample_count_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(missing_sample_entry)).get("ok", false)):
		failures.append("missing_sample_window_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(noncanonical_sample_ticks_entry)).get("ok", false)):
		failures.append("noncanonical_sample_ticks_replay_accepted")
	var replay_list: RefCounted = ReplayListModel.new()
	replay_list.replay_store = store
	var list_entries: Array[Dictionary] = valid_entries.duplicate(true)
	list_entries.append(invalid_entry)
	replay_list.entries = list_entries
	var rows: Array[Dictionary] = replay_list.row_models(list_entries.size())
	if rows.size() != list_entries.size():
		failures.append("replay_rows_missing:%d" % rows.size())
	else:
		for index in range(valid_entries.size()):
			var valid_row: Dictionary = rows[index]
			if not bool(valid_row.get("metadata_valid", false)) or String(valid_row.get("metadata_status", "")) != "valid":
				failures.append("valid_row_metadata:%s" % [valid_row])
			if int(valid_row.get("preview_budget_headroom", -1)) < 0:
				failures.append("valid_row_headroom:%s" % [valid_row])
			if String(valid_row.get("performance_budget_status", "")) != "within_budget":
				failures.append("valid_row_budget_status:%s" % [valid_row])
			if int(valid_row.get("preview_sample_count", -1)) <= 0:
				failures.append("valid_row_sample_count:%s" % [valid_row])
			if (valid_row.get("preview_sample_signature_digests", []) as Array).is_empty():
				failures.append("valid_row_sample_digests:%s" % [valid_row])
		var invalid_row: Dictionary = rows[valid_entries.size()]
		if bool(invalid_row.get("metadata_valid", true)) or String(invalid_row.get("metadata_status", "")) != "missing_spellbook_preview":
			failures.append("invalid_row_metadata:%s" % [invalid_row])
		var bad_schema_row: Dictionary = replay_list._row_from_entry(bad_schema_entry, rows.size())
		if bool(bad_schema_row.get("metadata_valid", true)) or String(bad_schema_row.get("metadata_status", "")) != "bad_preview_schema":
			failures.append("bad_schema_row_metadata:%s" % [bad_schema_row])
		var over_budget_row: Dictionary = replay_list._row_from_entry(over_budget_entry, rows.size())
		if bool(over_budget_row.get("metadata_valid", true)) or String(over_budget_row.get("metadata_status", "")) != "preview_budget_overrun":
			failures.append("over_budget_row_metadata:%s" % [over_budget_row])
		var authoritative_row: Dictionary = replay_list._row_from_entry(authoritative_entry, rows.size() + 1)
		if bool(authoritative_row.get("metadata_valid", true)) or String(authoritative_row.get("metadata_status", "")) != "local_preview_marked_authoritative":
			failures.append("authoritative_row_metadata:%s" % [authoritative_row])
		var bad_sample_count_row: Dictionary = replay_list._row_from_entry(bad_sample_count_entry, rows.size() + 2)
		if bool(bad_sample_count_row.get("metadata_valid", true)) or String(bad_sample_count_row.get("metadata_status", "")) != "bad_preview_sample_window":
			failures.append("bad_sample_count_row_metadata:%s" % [bad_sample_count_row])
		var noncanonical_sample_ticks_row: Dictionary = replay_list._row_from_entry(noncanonical_sample_ticks_entry, rows.size() + 3)
		if bool(noncanonical_sample_ticks_row.get("metadata_valid", true)) or String(noncanonical_sample_ticks_row.get("metadata_status", "")) != "bad_preview_sample_window":
			failures.append("noncanonical_sample_ticks_row_metadata:%s" % [noncanonical_sample_ticks_row])
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"checked": valid_entries.size() + invalid_entries.size(),
	}

func _replay_entry_for_preview(store: RefCounted, spellbook_id: String, phase_id: String, preview: Dictionary) -> Dictionary:
	var snapshot := {
		"ruleset_version": "ruleset-local-s0",
		"game_version": "prototype",
		"match_seed": int(preview.get("seed", 0)),
		"final_result_hash": int(preview.get("signature_digest", 0)),
		"input_stream": [],
		"metadata": {
			"saved_at": "2026-06-29T04:18:00Z",
			"final_tick": 180,
			"mode": "boss_spellbook_practice",
			"catalog_id": "boss_spellbook",
			"spellbook_id": spellbook_id,
			"phase_id": phase_id,
			"preview_export_schema_version": int(preview.get("export_schema_version", 0)),
			"preview_export_id": String(preview.get("export_id", "")),
			"preview_signature_digest": int(preview.get("signature_digest", 0)),
			"preview_sample_ticks": (preview.get("sample_ticks", []) as Array).duplicate(),
			"preview_sample_signature_digests": (preview.get("sample_signature_digests", []) as Array).duplicate(),
			"preview_sample_count": (preview.get("samples", []) as Array).size(),
			"preview_budget_headroom": int(preview.get("budget_headroom", 0)),
			"performance_budget_status": String(preview.get("performance_budget_status", "")),
			"server_authoritative": false,
			"result": "practice",
		},
	}
	return store._build_index_entry(snapshot, "user://replays/fixture_%s_%s.json" % [spellbook_id, phase_id])

func _legacy_replay_entry_for_preview(store: RefCounted, spellbook_id: String, phase_id: String, preview: Dictionary) -> Dictionary:
	var snapshot := {
		"ruleset_version": "ruleset-local-s0",
		"game_version": "prototype",
		"match_seed": int(preview.get("seed", 0)),
		"final_result_hash": int(preview.get("signature_digest", 0)),
		"input_stream": [],
		"metadata": {
			"saved_at": "2026-06-29T04:19:00Z",
			"final_tick": 180,
			"mode": "boss_spellbook_practice",
			"catalog_id": "boss_spellbook",
			"spellbook_id": spellbook_id,
			"phase_id": phase_id,
			"preview_export_id": String(preview.get("export_id", "")),
			"preview_signature": String(preview.get("signature", "")),
			"preview_budget_headroom": int(preview.get("budget_headroom", 0)),
			"performance_budget_status": String(preview.get("performance_budget_status", "")),
			"server_authoritative": false,
			"result": "practice",
		},
	}
	return store._build_index_entry(snapshot, "user://replays/legacy_fixture_%s_%s.json" % [spellbook_id, phase_id])

func _single_entry_array(entry: Dictionary) -> Array[Dictionary]:
	var entries: Array[Dictionary] = []
	entries.append(entry)
	return entries

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
