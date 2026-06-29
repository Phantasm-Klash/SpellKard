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
			if int(entry.get("preview_budget_headroom", -1)) != int(preview.get("budget_headroom", -2)):
				failures.append("entry_headroom_mismatch:%s" % phase_id)
			if String(entry.get("performance_budget_status", "")) != String(preview.get("performance_budget_status", "")):
				failures.append("entry_budget_status_mismatch:%s" % phase_id)
	var invalid_entry := valid_entries[0].duplicate(true)
	invalid_entry["replay_id"] = "fixture_missing_spellbook_preview"
	invalid_entry["preview_export_id"] = ""
	invalid_entry["preview_signature_digest"] = 0
	var authoritative_entry := valid_entries[0].duplicate(true)
	authoritative_entry["replay_id"] = "fixture_authoritative_spellbook_preview"
	authoritative_entry["server_authoritative"] = true
	var invalid_entries: Array[Dictionary] = [invalid_entry, authoritative_entry]
	var valid_result: Dictionary = store.validate_index_metadata(valid_entries)
	if not bool(valid_result.get("ok", false)):
		failures.append("valid_replay_rejected:%s" % [valid_result.get("failures", [])])
	var invalid_result: Dictionary = store.validate_index_metadata(invalid_entries)
	if bool(invalid_result.get("ok", false)):
		failures.append("invalid_replay_accepted")
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
		var invalid_row: Dictionary = rows[valid_entries.size()]
		if bool(invalid_row.get("metadata_valid", true)) or String(invalid_row.get("metadata_status", "")) != "missing_spellbook_preview":
			failures.append("invalid_row_metadata:%s" % [invalid_row])
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
			"preview_export_id": String(preview.get("export_id", "")),
			"preview_signature_digest": int(preview.get("signature_digest", 0)),
			"preview_budget_headroom": int(preview.get("budget_headroom", 0)),
			"performance_budget_status": String(preview.get("performance_budget_status", "")),
			"server_authoritative": false,
			"result": "practice",
		},
	}
	return store._build_index_entry(snapshot, "user://replays/fixture_%s_%s.json" % [spellbook_id, phase_id])
