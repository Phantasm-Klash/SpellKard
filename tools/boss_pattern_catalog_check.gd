extends SceneTree

const StageSelectModel := preload("res://scripts/stage_select_model.gd")
const BossPatternCatalog := preload("res://scripts/boss_pattern_catalog.gd")
const BossSpellbookModel := preload("res://scripts/boss_spellbook_model.gd")
const PatternLabModel := preload("res://scripts/pattern_lab_model.gd")
const ReplayListModel := preload("res://scripts/replay_list_model.gd")
const ReplayStore := preload("res://scripts/replay_store.gd")

class TightSpellbookBudgetModel:
	extends RefCounted

	var base: RefCounted = BossSpellbookModel.new()

	func spellbook_ids() -> Array[String]:
		return base.spellbook_ids()

	func spellbook_config(spellbook_id: String) -> Dictionary:
		return base.spellbook_config(spellbook_id)

	func phase_script_config(spellbook_id: String, phase_id: String) -> Dictionary:
		var script: Dictionary = base.phase_script_config(spellbook_id, phase_id)
		if phase_id == "nonspell_radial_entry":
			script["bullet_cap_per_tick"] = 20
		return script

	func emit_tick(spellbook_id: String, local_tick: int, target: Vector2, spawn_index: int, seed: int) -> Array[Dictionary]:
		return base.emit_tick(spellbook_id, local_tick, target, spawn_index, seed)

class StaleGoldenFixtureIdentityModel:
	extends RefCounted

	var base: RefCounted = BossSpellbookModel.new()

	func spellbook_ids() -> Array[String]:
		return base.spellbook_ids()

	func timeline_rows(spellbook_id: String) -> Array[Dictionary]:
		return base.timeline_rows(spellbook_id)

	func deterministic_phase_preview(spellbook_id: String, phase_id: String, seed: int = 20260625) -> Dictionary:
		return base.deterministic_phase_preview(spellbook_id, phase_id, seed)

	func phase_export_data(spellbook_id: String, seed: int = 20260625) -> Dictionary:
		return base.phase_export_data(spellbook_id, seed)

	func validate_phase_preview_exports(seed: int = 20260625) -> Dictionary:
		return base.validate_phase_preview_exports(seed)

	func golden_preview_fixtures() -> Dictionary:
		var fixtures: Dictionary = base.golden_preview_fixtures()
		var fixture_id := "original_boss_archive:nonspell_radial_entry:20260625"
		var stale: Dictionary = (fixtures.get(fixture_id, {}) as Dictionary).duplicate(true)
		stale["export_id"] = "boss_spellbook_preview_original_boss_archive_wrong_phase_20260625"
		stale["preview_fixture_id"] = "original_boss_archive:wrong_phase:20260625"
		fixtures[fixture_id] = stale
		return fixtures

	func golden_preview_bundle_fixtures() -> Dictionary:
		return base.golden_preview_bundle_fixtures()

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
	var golden_identity_regression: Dictionary = _validate_golden_fixture_identity_regression(pattern_lab_model)
	if not bool(golden_identity_regression.get("ok", false)):
		push_error("Boss spellbook golden fixture identity regression failed: %s" % [golden_identity_regression])
		quit(1)
		return
	var replay_metadata: Dictionary = _validate_replay_metadata(spellbook_model, pattern_lab_model)
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
	var phase_budget_regression: Dictionary = _validate_phase_budget_regression(stage_model)
	if not bool(phase_budget_regression.get("ok", false)):
		push_error("Boss spellbook phase budget regression failed: %s" % [phase_budget_regression])
		quit(1)
		return
	print("boss_pattern_catalog_check ok: families=%d recipes=%d adapters=%d requirements=%d official_types=%d types=%d emitted=%d behavior_spawns=%d spellbooks=%d phases=%d previews=%d golden_previews=%d golden_bundles=%d golden_identity_regressions=%d replay_metadata=%d max_emit=%d max_behavior_spawn=%d max_spellbook_emit=%d" % [
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
		int(preview_exports.get("golden_bundle_count", 0)),
		int(golden_identity_regression.get("checked", 0)),
		int(replay_metadata.get("checked", 0)),
		int(budgets.get("max_initial_emit", 0)),
		int(budgets.get("max_behavior_spawned_per_tick", 0)),
		int(budgets.get("max_spellbook_emit_per_tick", 0)),
	])
	quit(0)

func _validate_golden_fixture_identity_regression(pattern_lab_model: RefCounted) -> Dictionary:
	var failures: Array[String] = []
	var stale_model: RefCounted = StaleGoldenFixtureIdentityModel.new()
	var result: Dictionary = BossPatternCatalog.validate_spellbook_preview_exports(stale_model, pattern_lab_model, 20260625)
	if bool(result.get("ok", true)):
		failures.append("stale_golden_fixture_identity_accepted")
	var saw_fixture_failure := false
	var saw_export_failure := false
	for failure in result.get("failures", []):
		if String(failure).contains("golden_preview_fixture_id:nonspell_radial_entry"):
			saw_fixture_failure = true
		if String(failure).contains("golden_preview_export_id:nonspell_radial_entry"):
			saw_export_failure = true
	if not saw_fixture_failure:
		failures.append("stale_golden_fixture_id_failure_missing:%s" % [result.get("failures", [])])
	if not saw_export_failure:
		failures.append("stale_golden_export_id_failure_missing:%s" % [result.get("failures", [])])
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"checked": 1,
	}

func _validate_phase_budget_regression(stage_model: RefCounted) -> Dictionary:
	var failures: Array[String] = []
	var tight_model: RefCounted = TightSpellbookBudgetModel.new()
	var result: Dictionary = BossPatternCatalog.validate_performance_budgets(stage_model, tight_model, 20260625)
	if bool(result.get("ok", true)):
		failures.append("tight_phase_budget_accepted")
	var saw_phase_failure := false
	for failure in result.get("failures", []):
		if String(failure).begins_with("spellbook_phase_emit_budget:nonspell_radial_entry:"):
			saw_phase_failure = true
	if not saw_phase_failure:
		failures.append("tight_phase_budget_failure_missing:%s" % [result.get("failures", [])])
	var saw_over_budget_row := false
	for row in result.get("spellbook_budget_rows", []):
		var row_dict: Dictionary = row as Dictionary
		if String(row_dict.get("phase_id", "")) == "nonspell_radial_entry" \
				and int(row_dict.get("bullet_cap_per_tick", 0)) == 20 \
				and String(row_dict.get("performance_budget_status", "")) == "over_budget" \
				and int(row_dict.get("budget_headroom", 0)) < 0:
			saw_over_budget_row = true
	if not saw_over_budget_row:
		failures.append("tight_phase_budget_row_missing:%s" % [result.get("spellbook_budget_rows", [])])
	return {
		"ok": failures.is_empty(),
		"failures": failures,
	}

func _validate_replay_metadata(spellbook_model: RefCounted, pattern_lab_model: RefCounted) -> Dictionary:
	var failures: Array[String] = []
	var store: RefCounted = ReplayStore.new()
	var valid_entries: Array[Dictionary] = []
	for spellbook_id in spellbook_model.spellbook_ids():
		var phase_export: Dictionary = spellbook_model.phase_export_data(String(spellbook_id), 20260625)
		for phase_row in spellbook_model.timeline_rows(String(spellbook_id)):
			var phase_id := String((phase_row as Dictionary).get("phase_id", ""))
			var preview: Dictionary = spellbook_model.deterministic_phase_preview(String(spellbook_id), phase_id, 20260625)
			preview["preview_bundle_id"] = String(phase_export.get("preview_bundle_id", ""))
			preview["preview_bundle_signature_digest"] = int(phase_export.get("preview_bundle_signature_digest", 0))
			preview["preview_phase_count"] = int(phase_export.get("preview_phase_count", 0))
			preview["preview_phase_ids"] = (phase_export.get("preview_phase_ids", []) as Array).duplicate()
			preview["preview_phase_signature_digests"] = (phase_export.get("preview_phase_signature_digests", []) as Array).duplicate()
			preview["preview_bundle_max_emit_per_tick"] = int(phase_export.get("max_preview_emit_per_tick", 0))
			preview["preview_bundle_min_budget_headroom"] = int(phase_export.get("min_preview_budget_headroom", 0))
			preview["preview_bundle_budget_status"] = String(phase_export.get("performance_budget_status", ""))
			var entry := _replay_entry_for_preview(store, String(spellbook_id), phase_id, preview)
			valid_entries.append(entry)
			var exact_result: Dictionary = store.validate_spellbook_preview_metadata(entry, preview)
			if not bool(exact_result.get("ok", false)):
				failures.append("valid_preview_metadata_rejected:%s:%s" % [phase_id, exact_result.get("failures", [])])
			if int(entry.get("preview_budget_headroom", -1)) != int(preview.get("budget_headroom", -2)):
				failures.append("entry_headroom_mismatch:%s" % phase_id)
			if String(entry.get("performance_budget_status", "")) != String(preview.get("performance_budget_status", "")):
				failures.append("entry_budget_status_mismatch:%s" % phase_id)
			if int(entry.get("preview_max_emit_per_tick", -1)) != int(preview.get("max_emit_per_tick", -2)):
				failures.append("entry_max_emit_mismatch:%s" % phase_id)
			if int(entry.get("preview_bullet_cap_per_tick", -1)) != int(preview.get("bullet_cap_per_tick", -2)):
				failures.append("entry_bullet_cap_mismatch:%s" % phase_id)
			if int(entry.get("preview_export_schema_version", 0)) != int(preview.get("export_schema_version", 0)):
				failures.append("entry_schema_mismatch:%s" % phase_id)
			if String(entry.get("preview_bundle_id", "")) != String(preview.get("preview_bundle_id", "")):
				failures.append("entry_bundle_id_mismatch:%s" % phase_id)
			if int(entry.get("preview_bundle_signature_digest", 0)) != int(preview.get("preview_bundle_signature_digest", 0)):
				failures.append("entry_bundle_digest_mismatch:%s" % phase_id)
			if int(entry.get("preview_phase_count", 0)) != int(preview.get("preview_phase_count", 0)):
				failures.append("entry_bundle_phase_count_mismatch:%s" % phase_id)
			if not _arrays_equal_strings(entry.get("preview_phase_ids", []), preview.get("preview_phase_ids", [])):
				failures.append("entry_bundle_phase_ids_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(entry.get("preview_phase_signature_digests", []), preview.get("preview_phase_signature_digests", [])):
				failures.append("entry_bundle_phase_digest_mismatch:%s" % phase_id)
			if int(entry.get("preview_bundle_max_emit_per_tick", 0)) != int(preview.get("preview_bundle_max_emit_per_tick", -1)):
				failures.append("entry_bundle_max_emit_mismatch:%s" % phase_id)
			if int(entry.get("preview_bundle_min_budget_headroom", 0)) != int(preview.get("preview_bundle_min_budget_headroom", -1)):
				failures.append("entry_bundle_headroom_mismatch:%s" % phase_id)
			if String(entry.get("preview_bundle_budget_status", "")) != String(preview.get("preview_bundle_budget_status", "")):
				failures.append("entry_bundle_budget_status_mismatch:%s" % phase_id)
			if String(entry.get("preview_authority_scope", "")) != String(preview.get("preview_authority_scope", "")):
				failures.append("entry_authority_scope_mismatch:%s" % phase_id)
			if String(preview.get("preview_fixture_id", "")) != "%s:%s:%d" % [String(spellbook_id), phase_id, int(preview.get("seed", 0))]:
				failures.append("preview_fixture_id_mismatch:%s" % phase_id)
			if String(entry.get("preview_fixture_id", "")) != "%s:%s:%d" % [String(spellbook_id), phase_id, int(preview.get("seed", 0))]:
				failures.append("entry_fixture_mismatch:%s" % phase_id)
			if int(entry.get("preview_seed", 0)) != int(preview.get("seed", 0)):
				failures.append("entry_seed_mismatch:%s" % phase_id)
			if int(entry.get("preview_sample_count", -1)) != (preview.get("samples", []) as Array).size():
				failures.append("entry_sample_count_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(entry.get("preview_sample_ticks", []), preview.get("sample_ticks", [])):
				failures.append("entry_sample_ticks_mismatch:%s" % phase_id)
			if int(entry.get("preview_sample_window_start_tick", -1)) != int(preview.get("sample_window_start_tick", -2)):
				failures.append("entry_sample_window_start_mismatch:%s" % phase_id)
			if int(entry.get("preview_sample_window_end_tick", -1)) != int(preview.get("sample_window_end_tick", -2)):
				failures.append("entry_sample_window_end_mismatch:%s" % phase_id)
			if int(entry.get("preview_sample_window_stride_ticks", -1)) != int(preview.get("sample_window_stride_ticks", -2)):
				failures.append("entry_sample_window_stride_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(entry.get("preview_sample_signature_digests", []), preview.get("sample_signature_digests", [])):
				failures.append("entry_sample_digest_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(entry.get("preview_sample_emit_counts", []), preview.get("sample_emit_counts", [])):
				failures.append("entry_sample_emit_counts_mismatch:%s" % phase_id)
			var legacy_entry := _legacy_replay_entry_for_preview(store, String(spellbook_id), phase_id, preview)
			var legacy_result: Dictionary = store.validate_spellbook_preview_metadata(legacy_entry, preview)
			if not bool(legacy_result.get("ok", false)):
				failures.append("legacy_preview_metadata_rejected:%s:%s" % [phase_id, legacy_result.get("failures", [])])
			if int(legacy_entry.get("preview_export_schema_version", 0)) != int(preview.get("export_schema_version", 0)):
				failures.append("legacy_entry_schema_mismatch:%s" % phase_id)
			if String(legacy_entry.get("preview_authority_scope", "")) != String(preview.get("preview_authority_scope", "")):
				failures.append("legacy_entry_authority_scope_mismatch:%s" % phase_id)
			if int(legacy_entry.get("preview_max_emit_per_tick", -1)) != int(preview.get("max_emit_per_tick", -2)):
				failures.append("legacy_entry_max_emit_mismatch:%s" % phase_id)
			if int(legacy_entry.get("preview_bullet_cap_per_tick", -1)) != int(preview.get("bullet_cap_per_tick", -2)):
				failures.append("legacy_entry_bullet_cap_mismatch:%s" % phase_id)
			if String(legacy_entry.get("preview_fixture_id", "")) != "%s:%s:%d" % [String(spellbook_id), phase_id, int(preview.get("seed", 0))]:
				failures.append("legacy_entry_fixture_mismatch:%s" % phase_id)
			if int(legacy_entry.get("preview_seed", 0)) != int(preview.get("seed", 0)):
				failures.append("legacy_entry_seed_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(legacy_entry.get("preview_sample_ticks", []), preview.get("sample_ticks", [])):
				failures.append("legacy_entry_sample_ticks_mismatch:%s" % phase_id)
			if int(legacy_entry.get("preview_sample_window_start_tick", -1)) != int(preview.get("sample_window_start_tick", -2)):
				failures.append("legacy_entry_sample_window_start_mismatch:%s" % phase_id)
			if int(legacy_entry.get("preview_sample_window_end_tick", -1)) != int(preview.get("sample_window_end_tick", -2)):
				failures.append("legacy_entry_sample_window_end_mismatch:%s" % phase_id)
			if int(legacy_entry.get("preview_sample_window_stride_ticks", -1)) != int(preview.get("sample_window_stride_ticks", -2)):
				failures.append("legacy_entry_sample_window_stride_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(legacy_entry.get("preview_sample_signature_digests", []), preview.get("sample_signature_digests", [])):
				failures.append("legacy_entry_sample_digest_mismatch:%s" % phase_id)
			if not _arrays_equal_ints(legacy_entry.get("preview_sample_emit_counts", []), preview.get("sample_emit_counts", [])):
				failures.append("legacy_entry_sample_emit_counts_mismatch:%s" % phase_id)
			if String(legacy_entry.get("preview_signature", "")) != String(preview.get("signature", "")):
				failures.append("legacy_entry_signature_missing:%s" % phase_id)
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
	var first_preview: Dictionary = spellbook_model.deterministic_phase_preview(
		String(valid_entries[0].get("spellbook_id", "")),
		String(valid_entries[0].get("phase_id", "")),
		20260625
	)
	var server_claim_entry := valid_entries[0].duplicate(true)
	server_claim_entry["replay_id"] = "fixture_server_claim_spellbook_preview"
	server_claim_entry["boss_instance_id"] = "world_boss_local_s0_001"
	server_claim_entry["boss_max_hp"] = 500000
	server_claim_entry["boss_current_hp"] = 420000
	server_claim_entry["boss_hp_remaining"] = 408000
	server_claim_entry["boss_damage"] = 12000
	server_claim_entry["boss_hp_after_global"] = 408000
	server_claim_entry["damage_summary"] = {"damage_this_match": 12000, "team_damage": 12000, "total_damage": 12000}
	server_claim_entry["daily_attempts_left"] = 2
	server_claim_entry["entry_attempts_left"] = 1
	server_claim_entry["entry_unlocked"] = true
	server_claim_entry["required_key_id"] = "instance_key_server_only"
	server_claim_entry["owned_key_count"] = 1
	server_claim_entry["defeated_at"] = "2026-06-29T00:00:00Z"
	server_claim_entry["defeated_by_match_id"] = "match_server_only"
	server_claim_entry["reward_grants"] = [{"currency": "spirit", "amount": 25}]
	server_claim_entry["reward_summary"] = {"reward_receipts": [{"receipt_id": "server-only-reward"}], "drop_rewards": [{"item_id": "spirit_fragment", "amount": 1}], "first_clear_reward": {"currency": "spirit", "amount": 100}}
	server_claim_entry["settlement_result"] = {"settlement_status": "cleared", "clear_status": "cleared"}
	server_claim_entry["settlement_status"] = "cleared"
	server_claim_entry["world_announcement"] = "world_boss_defeated"
	var nested_server_claim_entry := valid_entries[0].duplicate(true)
	nested_server_claim_entry["replay_id"] = "fixture_nested_server_claim_spellbook_preview"
	nested_server_claim_entry["boss_snapshot"] = {
		"boss_instance_id": "world_boss_nested_claim",
		"boss_state": {
			"boss_current_hp": 399000,
			"boss_remaining_hp": 387000,
			"boss_hp_after_global": 387000,
		},
		"boss_result_summary": {
			"damage_summary": {"team_damage": 12000, "total_damage": 12000},
			"access_gate": {"entry_unlocked": true, "owned_key_count": 1},
			"star_summary": {"stars": 3, "clear_time_seconds": 144, "bombs_used": 1},
		},
	}
	nested_server_claim_entry["settlement"] = {
		"settlement_receipt": {"receipt_id": "server-only-nested"},
		"reward_summary": {"reward_receipts": [{"receipt_id": "server-only-nested-reward"}], "star_rewards": [{"currency": "spirit", "amount": 10}]},
		"reward_grants": [{"currency": "spirit", "amount": 30}],
		"server_result_hash": "nested-server-hash-only",
	}
	var snapshot_server_claim_entry := _snapshot_server_claim_replay_entry_for_preview(store, String(valid_entries[0].get("spellbook_id", "")), String(valid_entries[0].get("phase_id", "")), first_preview)
	snapshot_server_claim_entry["boss_result"] = {
		"result_summary": {
			"damage_summary": {"damage_this_match": 12000},
			"entry_gate": {"required_key_id": "instance_key_server_only", "entry_attempts_left": 1},
			"settlement_summary": {"settlement_status": "cleared"},
			"star_summary": {"stars": 2, "deaths": 1, "mechanic_complete": true},
		}
	}
	snapshot_server_claim_entry["result_summary"] = snapshot_server_claim_entry["boss_result"]["result_summary"]
	var wrong_authority_scope_entry := valid_entries[0].duplicate(true)
	wrong_authority_scope_entry["replay_id"] = "fixture_wrong_authority_scope_spellbook_preview"
	wrong_authority_scope_entry["preview_authority_scope"] = "server_settlement_authoritative"
	var over_budget_entry := valid_entries[0].duplicate(true)
	over_budget_entry["replay_id"] = "fixture_over_budget_spellbook_preview"
	over_budget_entry["preview_budget_headroom"] = -1
	over_budget_entry["performance_budget_status"] = "over_budget"
	var stale_digest_entry := valid_entries[0].duplicate(true)
	stale_digest_entry["replay_id"] = "fixture_stale_digest_spellbook_preview"
	stale_digest_entry["preview_signature"] = String(spellbook_model.deterministic_phase_preview(
		String(stale_digest_entry.get("spellbook_id", "")),
		String(stale_digest_entry.get("phase_id", "")),
		20260625
	).get("signature", ""))
	stale_digest_entry["preview_signature_digest"] = int(stale_digest_entry.get("preview_signature_digest", 0)) + 1
	var stale_fixture_entry := valid_entries[0].duplicate(true)
	stale_fixture_entry["replay_id"] = "fixture_stale_fixture_spellbook_preview"
	stale_fixture_entry["preview_fixture_id"] = "original_boss_archive:wrong_phase:20260625"
	var stale_export_entry := valid_entries[0].duplicate(true)
	stale_export_entry["replay_id"] = "fixture_stale_export_spellbook_preview"
	stale_export_entry["preview_export_id"] = "boss_spellbook_preview_original_boss_archive_wrong_phase_20260625"
	var stale_seed_entry := valid_entries[0].duplicate(true)
	stale_seed_entry["replay_id"] = "fixture_stale_seed_spellbook_preview"
	stale_seed_entry["preview_seed"] = int(stale_seed_entry.get("preview_seed", 0)) + 1
	var stale_bundle_id_entry := valid_entries[0].duplicate(true)
	stale_bundle_id_entry["replay_id"] = "fixture_stale_bundle_id_spellbook_preview"
	stale_bundle_id_entry["preview_bundle_id"] = "boss_spellbook_preview_bundle_wrong_spellbook_20260625"
	var stale_bundle_digest_entry := valid_entries[0].duplicate(true)
	stale_bundle_digest_entry["replay_id"] = "fixture_stale_bundle_digest_spellbook_preview"
	stale_bundle_digest_entry["preview_bundle_signature_digest"] = int(stale_bundle_digest_entry.get("preview_bundle_signature_digest", 0)) + 1
	var missing_bundle_digest_entry := valid_entries[0].duplicate(true)
	missing_bundle_digest_entry["replay_id"] = "fixture_missing_bundle_digest_spellbook_preview"
	missing_bundle_digest_entry["preview_bundle_signature_digest"] = 0
	var stale_bundle_phase_count_entry := valid_entries[0].duplicate(true)
	stale_bundle_phase_count_entry["replay_id"] = "fixture_stale_bundle_phase_count_spellbook_preview"
	stale_bundle_phase_count_entry["preview_phase_count"] = int(stale_bundle_phase_count_entry.get("preview_phase_count", 0)) + 1
	var stale_bundle_phase_ids_entry := valid_entries[0].duplicate(true)
	stale_bundle_phase_ids_entry["replay_id"] = "fixture_stale_bundle_phase_ids_spellbook_preview"
	var stale_phase_ids: Array = (stale_bundle_phase_ids_entry.get("preview_phase_ids", []) as Array).duplicate()
	stale_phase_ids.reverse()
	stale_bundle_phase_ids_entry["preview_phase_ids"] = stale_phase_ids
	var stale_bundle_phase_digest_entry := valid_entries[0].duplicate(true)
	stale_bundle_phase_digest_entry["replay_id"] = "fixture_stale_bundle_phase_digest_spellbook_preview"
	var stale_phase_digests: Array = (stale_bundle_phase_digest_entry.get("preview_phase_signature_digests", []) as Array).duplicate()
	stale_phase_digests[0] = int(stale_phase_digests[0]) + 1
	stale_bundle_phase_digest_entry["preview_phase_signature_digests"] = stale_phase_digests
	var missing_bundle_phase_ids_entry := valid_entries[0].duplicate(true)
	missing_bundle_phase_ids_entry["replay_id"] = "fixture_missing_bundle_phase_ids_spellbook_preview"
	missing_bundle_phase_ids_entry["preview_phase_ids"] = []
	var missing_bundle_phase_digest_entry := valid_entries[0].duplicate(true)
	missing_bundle_phase_digest_entry["replay_id"] = "fixture_missing_bundle_phase_digest_spellbook_preview"
	missing_bundle_phase_digest_entry["preview_phase_signature_digests"] = []
	var stale_bundle_max_emit_entry := valid_entries[0].duplicate(true)
	stale_bundle_max_emit_entry["replay_id"] = "fixture_stale_bundle_max_emit_spellbook_preview"
	stale_bundle_max_emit_entry["preview_bundle_max_emit_per_tick"] = int(stale_bundle_max_emit_entry.get("preview_bundle_max_emit_per_tick", 0)) + 1
	var stale_bundle_headroom_entry := valid_entries[0].duplicate(true)
	stale_bundle_headroom_entry["replay_id"] = "fixture_stale_bundle_headroom_spellbook_preview"
	stale_bundle_headroom_entry["preview_bundle_min_budget_headroom"] = int(stale_bundle_headroom_entry.get("preview_bundle_min_budget_headroom", 0)) - 1
	var stale_bundle_budget_status_entry := valid_entries[0].duplicate(true)
	stale_bundle_budget_status_entry["replay_id"] = "fixture_stale_bundle_budget_status_spellbook_preview"
	stale_bundle_budget_status_entry["preview_bundle_budget_status"] = "over_budget"
	var stale_sample_entry := valid_entries[0].duplicate(true)
	stale_sample_entry["replay_id"] = "fixture_stale_samples_spellbook_preview"
	stale_sample_entry["preview_sample_ticks"] = [0, 30, 60]
	stale_sample_entry["preview_sample_count"] = 3
	var noncanonical_sample_ticks_entry := valid_entries[0].duplicate(true)
	noncanonical_sample_ticks_entry["replay_id"] = "fixture_noncanonical_sample_ticks_spellbook_preview"
	noncanonical_sample_ticks_entry["preview_sample_ticks"] = [0, 29, 56, 84, 112, 140]
	var stale_sample_window_start_entry := valid_entries[0].duplicate(true)
	stale_sample_window_start_entry["replay_id"] = "fixture_stale_sample_window_start_spellbook_preview"
	stale_sample_window_start_entry["preview_sample_window_start_tick"] = 1
	var stale_sample_window_end_entry := valid_entries[0].duplicate(true)
	stale_sample_window_end_entry["replay_id"] = "fixture_stale_sample_window_end_spellbook_preview"
	stale_sample_window_end_entry["preview_sample_window_end_tick"] = 112
	var stale_sample_window_stride_entry := valid_entries[0].duplicate(true)
	stale_sample_window_stride_entry["replay_id"] = "fixture_stale_sample_window_stride_spellbook_preview"
	stale_sample_window_stride_entry["preview_sample_window_stride_ticks"] = 14
	var stale_sample_digest_entry := valid_entries[0].duplicate(true)
	stale_sample_digest_entry["replay_id"] = "fixture_stale_sample_digests_spellbook_preview"
	var stale_digests: Array = (stale_sample_digest_entry.get("preview_sample_signature_digests", []) as Array).duplicate()
	stale_digests[0] = int(stale_digests[0]) + 1
	stale_sample_digest_entry["preview_sample_signature_digests"] = stale_digests
	var stale_sample_emit_count_entry := valid_entries[0].duplicate(true)
	stale_sample_emit_count_entry["replay_id"] = "fixture_stale_sample_emit_counts_spellbook_preview"
	var stale_emit_counts: Array = (stale_sample_emit_count_entry.get("preview_sample_emit_counts", []) as Array).duplicate()
	stale_emit_counts[1] = int(stale_emit_counts[1]) + 1
	stale_sample_emit_count_entry["preview_sample_emit_counts"] = stale_emit_counts
	var negative_sample_digest_entry := valid_entries[0].duplicate(true)
	negative_sample_digest_entry["replay_id"] = "fixture_negative_sample_digest_spellbook_preview"
	var negative_digests: Array = (negative_sample_digest_entry.get("preview_sample_signature_digests", []) as Array).duplicate()
	negative_digests[0] = -1
	negative_sample_digest_entry["preview_sample_signature_digests"] = negative_digests
	var negative_sample_emit_count_entry := valid_entries[0].duplicate(true)
	negative_sample_emit_count_entry["replay_id"] = "fixture_negative_sample_emit_counts_spellbook_preview"
	var negative_emit_counts: Array = (negative_sample_emit_count_entry.get("preview_sample_emit_counts", []) as Array).duplicate()
	negative_emit_counts[0] = -1
	negative_sample_emit_count_entry["preview_sample_emit_counts"] = negative_emit_counts
	var legacy_signature_digest_mismatch_entry := _legacy_replay_entry_for_preview(
		store,
		String(valid_entries[0].get("spellbook_id", "")),
		String(valid_entries[0].get("phase_id", "")),
		spellbook_model.deterministic_phase_preview(
			String(valid_entries[0].get("spellbook_id", "")),
			String(valid_entries[0].get("phase_id", "")),
			20260625
		)
	)
	legacy_signature_digest_mismatch_entry["replay_id"] = "fixture_legacy_signature_digest_mismatch_spellbook_preview"
	var mismatched_legacy_digests: Array = (legacy_signature_digest_mismatch_entry.get("preview_sample_signature_digests", []) as Array).duplicate()
	mismatched_legacy_digests[0] = int(mismatched_legacy_digests[0]) + 1
	legacy_signature_digest_mismatch_entry["preview_sample_signature_digests"] = mismatched_legacy_digests
	var legacy_signature_emit_count_mismatch_entry := legacy_signature_digest_mismatch_entry.duplicate(true)
	legacy_signature_emit_count_mismatch_entry["replay_id"] = "fixture_legacy_signature_emit_count_mismatch_spellbook_preview"
	var valid_legacy_digests: Array = (valid_entries[0].get("preview_sample_signature_digests", []) as Array).duplicate()
	legacy_signature_emit_count_mismatch_entry["preview_sample_signature_digests"] = valid_legacy_digests
	var mismatched_legacy_emit_counts: Array = (legacy_signature_emit_count_mismatch_entry.get("preview_sample_emit_counts", []) as Array).duplicate()
	mismatched_legacy_emit_counts[0] = int(mismatched_legacy_emit_counts[0]) + 1
	legacy_signature_emit_count_mismatch_entry["preview_sample_emit_counts"] = mismatched_legacy_emit_counts
	var bad_sample_count_entry := valid_entries[0].duplicate(true)
	bad_sample_count_entry["replay_id"] = "fixture_bad_sample_count_spellbook_preview"
	bad_sample_count_entry["preview_sample_count"] = int(bad_sample_count_entry.get("preview_sample_count", 0)) + 1
	var bad_sample_emit_count_entry := valid_entries[0].duplicate(true)
	bad_sample_emit_count_entry["replay_id"] = "fixture_bad_sample_emit_count_spellbook_preview"
	bad_sample_emit_count_entry["preview_sample_emit_counts"] = [int((bad_sample_emit_count_entry.get("preview_sample_emit_counts", []) as Array)[0])]
	var stale_max_emit_entry := valid_entries[0].duplicate(true)
	stale_max_emit_entry["replay_id"] = "fixture_stale_max_emit_spellbook_preview"
	stale_max_emit_entry["preview_max_emit_per_tick"] = int(stale_max_emit_entry.get("preview_max_emit_per_tick", 0)) + 1
	var stale_bullet_cap_entry := valid_entries[0].duplicate(true)
	stale_bullet_cap_entry["replay_id"] = "fixture_stale_bullet_cap_spellbook_preview"
	stale_bullet_cap_entry["preview_bullet_cap_per_tick"] = int(stale_bullet_cap_entry.get("preview_bullet_cap_per_tick", 0)) + 1
	var missing_sample_entry := valid_entries[0].duplicate(true)
	missing_sample_entry["replay_id"] = "fixture_missing_samples_spellbook_preview"
	missing_sample_entry["preview_sample_ticks"] = []
	missing_sample_entry["preview_sample_signature_digests"] = []
	missing_sample_entry["preview_sample_emit_counts"] = []
	missing_sample_entry["preview_sample_count"] = 0
	var bad_sample_digest_count_entry := valid_entries[0].duplicate(true)
	bad_sample_digest_count_entry["replay_id"] = "fixture_bad_sample_digest_count_spellbook_preview"
	bad_sample_digest_count_entry["preview_sample_signature_digests"] = [int((bad_sample_digest_count_entry.get("preview_sample_signature_digests", []) as Array)[0])]
	var invalid_entries: Array[Dictionary] = [invalid_entry, bad_schema_entry, authoritative_entry, server_claim_entry, nested_server_claim_entry, wrong_authority_scope_entry, over_budget_entry, stale_fixture_entry, stale_export_entry, stale_seed_entry, stale_bundle_id_entry, stale_bundle_digest_entry, missing_bundle_digest_entry, stale_bundle_phase_count_entry, stale_bundle_phase_ids_entry, stale_bundle_phase_digest_entry, missing_bundle_phase_ids_entry, missing_bundle_phase_digest_entry, stale_bundle_max_emit_entry, stale_bundle_headroom_entry, stale_bundle_budget_status_entry, bad_sample_count_entry, bad_sample_digest_count_entry, bad_sample_emit_count_entry, stale_max_emit_entry, stale_bullet_cap_entry, missing_sample_entry, noncanonical_sample_ticks_entry, stale_sample_window_start_entry, stale_sample_window_end_entry, stale_sample_window_stride_entry, negative_sample_emit_count_entry]
	var valid_result: Dictionary = store.validate_index_metadata(valid_entries)
	if not bool(valid_result.get("ok", false)):
		failures.append("valid_replay_rejected:%s" % [valid_result.get("failures", [])])
	var invalid_result: Dictionary = store.validate_index_metadata(invalid_entries)
	if bool(invalid_result.get("ok", false)):
		failures.append("invalid_replay_accepted")
	if bool(store.validate_spellbook_preview_metadata(stale_digest_entry, first_preview).get("ok", false)):
		failures.append("stale_digest_preview_accepted")
	if bool(store.validate_spellbook_preview_metadata(wrong_authority_scope_entry, first_preview).get("ok", false)):
		failures.append("wrong_authority_scope_preview_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(wrong_authority_scope_entry)).get("ok", false)):
		failures.append("wrong_authority_scope_replay_accepted")
	if bool(store.validate_spellbook_preview_metadata(server_claim_entry, first_preview).get("ok", false)):
		failures.append("server_claim_preview_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(server_claim_entry)).get("ok", false)):
		failures.append("server_claim_replay_accepted")
	if bool(store.validate_spellbook_preview_metadata(nested_server_claim_entry, first_preview).get("ok", false)):
		failures.append("nested_server_claim_preview_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(nested_server_claim_entry)).get("ok", false)):
		failures.append("nested_server_claim_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(snapshot_server_claim_entry)).get("ok", false)):
		failures.append("snapshot_server_claim_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_digest_entry)).get("ok", false)):
		failures.append("stale_digest_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_fixture_entry)).get("ok", false)):
		failures.append("stale_fixture_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_export_entry)).get("ok", false)):
		failures.append("stale_export_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_seed_entry)).get("ok", false)):
		failures.append("stale_seed_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_bundle_id_entry)).get("ok", false)):
		failures.append("stale_bundle_id_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_bundle_digest_entry)).get("ok", false)):
		failures.append("stale_bundle_digest_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(missing_bundle_digest_entry)).get("ok", false)):
		failures.append("missing_bundle_digest_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_bundle_phase_count_entry)).get("ok", false)):
		failures.append("stale_bundle_phase_count_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_bundle_phase_ids_entry)).get("ok", false)):
		failures.append("stale_bundle_phase_ids_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_bundle_phase_digest_entry)).get("ok", false)):
		failures.append("stale_bundle_phase_digest_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(missing_bundle_phase_ids_entry)).get("ok", false)):
		failures.append("missing_bundle_phase_ids_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(missing_bundle_phase_digest_entry)).get("ok", false)):
		failures.append("missing_bundle_phase_digest_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_bundle_max_emit_entry)).get("ok", false)):
		failures.append("stale_bundle_max_emit_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_bundle_headroom_entry)).get("ok", false)):
		failures.append("stale_bundle_headroom_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_bundle_budget_status_entry)).get("ok", false)):
		failures.append("stale_bundle_budget_status_replay_accepted")
	if bool(store.validate_spellbook_preview_metadata(stale_fixture_entry, first_preview).get("ok", false)):
		failures.append("stale_fixture_preview_accepted")
	if bool(store.validate_spellbook_preview_metadata(stale_export_entry, first_preview).get("ok", false)):
		failures.append("stale_export_preview_accepted")
	if bool(store.validate_spellbook_preview_metadata(stale_seed_entry, first_preview).get("ok", false)):
		failures.append("stale_seed_preview_accepted")
	var stale_source_preview := first_preview.duplicate(true)
	stale_source_preview["preview_fixture_id"] = "original_boss_archive:wrong_phase:20260625"
	stale_source_preview["export_id"] = "boss_spellbook_preview_original_boss_archive_wrong_phase_20260625"
	var stale_source_result: Dictionary = store.validate_spellbook_preview_metadata(valid_entries[0], stale_source_preview)
	if bool(stale_source_result.get("ok", false)):
		failures.append("stale_source_preview_accepted")
	var saw_source_fixture_failure := false
	var saw_source_export_failure := false
	for failure in stale_source_result.get("failures", []):
		if String(failure).begins_with("preview_fixture_source_mismatch:"):
			saw_source_fixture_failure = true
		if String(failure).begins_with("preview_export_source_mismatch:"):
			saw_source_export_failure = true
	if not saw_source_fixture_failure:
		failures.append("stale_source_fixture_failure_missing:%s" % [stale_source_result.get("failures", [])])
	if not saw_source_export_failure:
		failures.append("stale_source_export_failure_missing:%s" % [stale_source_result.get("failures", [])])
	var server_claim_source_preview := first_preview.duplicate(true)
	server_claim_source_preview["boss_snapshot"] = {
		"boss_instance_id": "world_boss_source_claim",
		"boss_current_hp": 300000,
		"reward_grants": [{"currency": "spirit", "amount": 40}],
	}
	server_claim_source_preview["settlement_receipt"] = {"receipt_id": "source-preview-server-only"}
	var server_claim_source_result: Dictionary = store.validate_spellbook_preview_metadata(valid_entries[0], server_claim_source_preview)
	if bool(server_claim_source_result.get("ok", false)):
		failures.append("server_claim_source_preview_accepted")
	var saw_source_server_claim_failure := false
	for failure in server_claim_source_result.get("failures", []):
		if String(failure).begins_with("preview_source_server_claim:"):
			saw_source_server_claim_failure = true
	if not saw_source_server_claim_failure:
		failures.append("server_claim_source_failure_missing:%s" % [server_claim_source_result.get("failures", [])])
	if bool(store.validate_spellbook_preview_metadata(stale_sample_entry, first_preview).get("ok", false)):
		failures.append("stale_sample_preview_accepted")
	if bool(store.validate_spellbook_preview_metadata(stale_sample_digest_entry, first_preview).get("ok", false)):
		failures.append("stale_sample_digest_preview_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_sample_digest_entry)).get("ok", false)):
		failures.append("stale_sample_digest_replay_accepted")
	if bool(store.validate_spellbook_preview_metadata(stale_sample_emit_count_entry, first_preview).get("ok", false)):
		failures.append("stale_sample_emit_count_preview_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_sample_emit_count_entry)).get("ok", false)):
		failures.append("stale_sample_emit_count_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(negative_sample_digest_entry)).get("ok", false)):
		failures.append("negative_sample_digest_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(negative_sample_emit_count_entry)).get("ok", false)):
		failures.append("negative_sample_emit_count_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(legacy_signature_digest_mismatch_entry)).get("ok", false)):
		failures.append("legacy_signature_digest_mismatch_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(legacy_signature_emit_count_mismatch_entry)).get("ok", false)):
		failures.append("legacy_signature_emit_count_mismatch_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(bad_schema_entry)).get("ok", false)):
		failures.append("bad_schema_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(bad_sample_count_entry)).get("ok", false)):
		failures.append("bad_sample_count_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(bad_sample_digest_count_entry)).get("ok", false)):
		failures.append("bad_sample_digest_count_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(bad_sample_emit_count_entry)).get("ok", false)):
		failures.append("bad_sample_emit_count_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_max_emit_entry)).get("ok", false)):
		failures.append("stale_max_emit_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_bullet_cap_entry)).get("ok", false)):
		failures.append("stale_bullet_cap_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(missing_sample_entry)).get("ok", false)):
		failures.append("missing_sample_window_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(noncanonical_sample_ticks_entry)).get("ok", false)):
		failures.append("noncanonical_sample_ticks_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_sample_window_start_entry)).get("ok", false)):
		failures.append("stale_sample_window_start_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_sample_window_end_entry)).get("ok", false)):
		failures.append("stale_sample_window_end_replay_accepted")
	if bool(store.validate_index_metadata(_single_entry_array(stale_sample_window_stride_entry)).get("ok", false)):
		failures.append("stale_sample_window_stride_replay_accepted")
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
			if int(valid_row.get("metadata_failure_count", -1)) != 0 or not (valid_row.get("metadata_failures", []) as Array).is_empty():
				failures.append("valid_row_metadata_failures:%s" % [valid_row])
			if int(valid_row.get("preview_budget_headroom", -1)) < 0:
				failures.append("valid_row_headroom:%s" % [valid_row])
			if String(valid_row.get("performance_budget_status", "")) != "within_budget":
				failures.append("valid_row_budget_status:%s" % [valid_row])
			if int(valid_row.get("preview_sample_count", -1)) <= 0:
				failures.append("valid_row_sample_count:%s" % [valid_row])
			if int(valid_row.get("preview_sample_window_start_tick", -1)) != int((valid_entries[index] as Dictionary).get("preview_sample_window_start_tick", -2)):
				failures.append("valid_row_sample_window_start:%s" % [valid_row])
			if int(valid_row.get("preview_sample_window_end_tick", -1)) != int((valid_entries[index] as Dictionary).get("preview_sample_window_end_tick", -2)):
				failures.append("valid_row_sample_window_end:%s" % [valid_row])
			if int(valid_row.get("preview_sample_window_stride_ticks", -1)) != int((valid_entries[index] as Dictionary).get("preview_sample_window_stride_ticks", -2)):
				failures.append("valid_row_sample_window_stride:%s" % [valid_row])
			if String(valid_row.get("preview_fixture_id", "")).is_empty():
				failures.append("valid_row_fixture_id:%s" % [valid_row])
			if int(valid_row.get("preview_seed", 0)) != int((valid_entries[index] as Dictionary).get("preview_seed", -1)):
				failures.append("valid_row_seed:%s" % [valid_row])
			if (valid_row.get("preview_sample_signature_digests", []) as Array).is_empty():
				failures.append("valid_row_sample_digests:%s" % [valid_row])
			if (valid_row.get("preview_sample_emit_counts", []) as Array).is_empty():
				failures.append("valid_row_sample_emit_counts:%s" % [valid_row])
			if int(valid_row.get("preview_max_emit_per_tick", -1)) < 0:
				failures.append("valid_row_max_emit:%s" % [valid_row])
			if int(valid_row.get("preview_bullet_cap_per_tick", -1)) <= 0:
				failures.append("valid_row_bullet_cap:%s" % [valid_row])
			if String(valid_row.get("preview_authority_scope", "")) != "local_practice_preview_only":
				failures.append("valid_row_authority_scope:%s" % [valid_row])
			if String(valid_row.get("verification_scope", "")) != "local_practice_hash" or not String(valid_row.get("verification_summary", "")).contains("local practice final hash ready"):
				failures.append("valid_row_verification_summary:%s" % [valid_row])
			if String(valid_row.get("preview_bundle_id", "")) != String((valid_entries[index] as Dictionary).get("preview_bundle_id", "")):
				failures.append("valid_row_bundle_id:%s" % [valid_row])
			if int(valid_row.get("preview_bundle_signature_digest", 0)) != int((valid_entries[index] as Dictionary).get("preview_bundle_signature_digest", -1)):
				failures.append("valid_row_bundle_digest:%s" % [valid_row])
			if int(valid_row.get("preview_phase_count", 0)) != int((valid_entries[index] as Dictionary).get("preview_phase_count", -1)):
				failures.append("valid_row_bundle_phase_count:%s" % [valid_row])
			if not _arrays_equal_strings(valid_row.get("preview_phase_ids", []), (valid_entries[index] as Dictionary).get("preview_phase_ids", [])):
				failures.append("valid_row_bundle_phase_ids:%s" % [valid_row])
			if not _arrays_equal_ints(valid_row.get("preview_phase_signature_digests", []), (valid_entries[index] as Dictionary).get("preview_phase_signature_digests", [])):
				failures.append("valid_row_bundle_phase_digests:%s" % [valid_row])
			if int(valid_row.get("preview_bundle_max_emit_per_tick", 0)) != int((valid_entries[index] as Dictionary).get("preview_bundle_max_emit_per_tick", -1)):
				failures.append("valid_row_bundle_max_emit:%s" % [valid_row])
			if int(valid_row.get("preview_bundle_min_budget_headroom", 0)) != int((valid_entries[index] as Dictionary).get("preview_bundle_min_budget_headroom", -1)):
				failures.append("valid_row_bundle_headroom:%s" % [valid_row])
			if String(valid_row.get("preview_bundle_budget_status", "")) != String((valid_entries[index] as Dictionary).get("preview_bundle_budget_status", "")):
				failures.append("valid_row_bundle_budget_status:%s" % [valid_row])
		var invalid_row: Dictionary = rows[valid_entries.size()]
		if bool(invalid_row.get("metadata_valid", true)) or String(invalid_row.get("metadata_status", "")) != "missing_spellbook_preview":
			failures.append("invalid_row_metadata:%s" % [invalid_row])
		if int(invalid_row.get("metadata_failure_count", 0)) <= 0 or not _string_array_contains(invalid_row.get("metadata_failures", []), "missing_preview_export_id:fixture_missing_spellbook_preview"):
			failures.append("invalid_row_metadata_failures:%s" % [invalid_row])
		var bad_schema_row: Dictionary = replay_list._row_from_entry(bad_schema_entry, rows.size())
		if bool(bad_schema_row.get("metadata_valid", true)) or String(bad_schema_row.get("metadata_status", "")) != "bad_preview_schema":
			failures.append("bad_schema_row_metadata:%s" % [bad_schema_row])
		if int(bad_schema_row.get("metadata_failure_count", 0)) <= 0 or not _string_array_contains(bad_schema_row.get("metadata_failures", []), "bad_preview_schema:fixture_bad_schema_spellbook_preview"):
			failures.append("bad_schema_row_metadata_failures:%s" % [bad_schema_row])
		var over_budget_row: Dictionary = replay_list._row_from_entry(over_budget_entry, rows.size())
		if bool(over_budget_row.get("metadata_valid", true)) or String(over_budget_row.get("metadata_status", "")) != "preview_budget_headroom_mismatch":
			failures.append("over_budget_row_metadata:%s" % [over_budget_row])
		var authoritative_row: Dictionary = replay_list._row_from_entry(authoritative_entry, rows.size() + 1)
		if bool(authoritative_row.get("metadata_valid", true)) or String(authoritative_row.get("metadata_status", "")) != "local_preview_marked_authoritative":
			failures.append("authoritative_row_metadata:%s" % [authoritative_row])
	var server_claim_row: Dictionary = replay_list._row_from_entry(server_claim_entry, rows.size() + 2)
	if bool(server_claim_row.get("metadata_valid", true)) or String(server_claim_row.get("metadata_status", "")) != "local_preview_server_claim":
		failures.append("server_claim_row_metadata:%s" % [server_claim_row])
	if String(server_claim_row.get("verification_scope", "")) != "rejected_server_claim" or not String(server_claim_row.get("verification_summary", "")).contains("rejected server-authority claims"):
		failures.append("server_claim_row_verification_summary:%s" % [server_claim_row])
	if String(server_claim_row.get("local_load_policy", "")) != "blocked_server_audit" or not bool(server_claim_row.get("requires_server_audit", false)) or String(server_claim_row.get("server_audit_status", "")) != "pending":
		failures.append("server_claim_row_audit_guard:%s" % [server_claim_row])
		for expected_claim in ["boss_instance_id", "boss_current_hp", "boss_hp_after_global", "boss_hp_remaining", "damage_summary", "daily_attempts_left", "entry_attempts_left", "entry_unlocked", "required_key_id", "owned_key_count", "defeated_at", "defeated_by_match_id", "reward_grants", "reward_summary", "settlement_result", "world_announcement"]:
			if not _string_array_contains(server_claim_row.get("server_authority_claim_fields", []), expected_claim):
				failures.append("server_claim_row_missing_field:%s:%s" % [expected_claim, server_claim_row])
	var nested_server_claim_row: Dictionary = replay_list._row_from_entry(nested_server_claim_entry, rows.size() + 31)
	if bool(nested_server_claim_row.get("metadata_valid", true)) or String(nested_server_claim_row.get("metadata_status", "")) != "local_preview_server_claim":
		failures.append("nested_server_claim_row_metadata:%s" % [nested_server_claim_row])
	if String(nested_server_claim_row.get("verification_scope", "")) != "rejected_server_claim" or not String(nested_server_claim_row.get("verification_summary", "")).contains("rejected server-authority claims"):
		failures.append("nested_server_claim_row_verification_summary:%s" % [nested_server_claim_row])
	if String(nested_server_claim_row.get("local_load_policy", "")) != "blocked_server_audit" or not bool(nested_server_claim_row.get("requires_server_audit", false)) or String(nested_server_claim_row.get("server_audit_status", "")) != "pending":
		failures.append("nested_server_claim_row_audit_guard:%s" % [nested_server_claim_row])
		for expected_claim in ["boss_instance_id", "boss_current_hp", "boss_hp_after_global", "boss_remaining_hp", "boss_result_summary", "access_gate", "star_summary", "settlement_receipt", "reward_grants", "reward_summary", "server_result_hash"]:
			if not _string_array_contains(nested_server_claim_row.get("server_authority_claim_fields", []), expected_claim):
				failures.append("nested_server_claim_row_missing_field:%s:%s" % [expected_claim, nested_server_claim_row])
	var snapshot_server_claim_row: Dictionary = replay_list._row_from_entry(snapshot_server_claim_entry, rows.size() + 24)
	if bool(snapshot_server_claim_row.get("metadata_valid", true)) or String(snapshot_server_claim_row.get("metadata_status", "")) != "local_preview_server_claim":
		failures.append("snapshot_server_claim_row_metadata:%s" % [snapshot_server_claim_row])
	if String(snapshot_server_claim_row.get("verification_scope", "")) != "rejected_server_claim" or not String(snapshot_server_claim_row.get("verification_summary", "")).contains("rejected server-authority claims"):
		failures.append("snapshot_server_claim_row_verification_summary:%s" % [snapshot_server_claim_row])
	if String(snapshot_server_claim_row.get("local_load_policy", "")) != "blocked_server_audit" or not bool(snapshot_server_claim_row.get("requires_server_audit", false)) or String(snapshot_server_claim_row.get("server_audit_status", "")) != "pending":
		failures.append("snapshot_server_claim_row_audit_guard:%s" % [snapshot_server_claim_row])
		for expected_claim in ["boss_instance_id", "boss_hp_after_global", "boss_remaining_hp", "result_summary", "entry_gate", "star_summary", "settlement_receipt", "reward_grants", "reward_summary", "server_result_hash"]:
			if not _string_array_contains(snapshot_server_claim_row.get("server_authority_claim_fields", []), expected_claim):
				failures.append("snapshot_server_claim_row_missing_field:%s:%s" % [expected_claim, snapshot_server_claim_row])
		var filter_rows: Array[Dictionary] = replay_list.verification_filter_rows()
		var rejected_filter_row: Dictionary = _find_row_by_id(filter_rows, "replay_filter_rejected_server_claim")
		if String(rejected_filter_row.get("verification_filter", "")) != "rejected_server_claim" \
				or String(rejected_filter_row.get("label_key", "")) != "ui.menu_section_replay_rejected_server_claim" \
				or int(rejected_filter_row.get("entry_count", 0)) != 0 \
				or bool(rejected_filter_row.get("client_result_authoritative", true)):
			failures.append("rejected_claim_filter_row_invalid:%s" % [rejected_filter_row])
		var rejected_filter_entries: Array[Dictionary] = [valid_entries[0], server_claim_entry, nested_server_claim_entry, snapshot_server_claim_entry]
		replay_list.entries = rejected_filter_entries
		replay_list.cursor = 0
		if not replay_list.set_verification_filter("rejected_server_claim"):
			failures.append("rejected_claim_filter_not_set")
		var rejected_rows: Array[Dictionary] = replay_list.row_models(8)
		if rejected_rows.size() != 3:
			failures.append("rejected_claim_filter_count:%d:%s" % [rejected_rows.size(), rejected_rows])
		for rejected_row in rejected_rows:
			if String(rejected_row.get("verification_scope", "")) != "rejected_server_claim" \
					or String(rejected_row.get("local_load_policy", "")) != "blocked_server_audit" \
					or not bool(rejected_row.get("requires_server_audit", false)) \
					or bool(rejected_row.get("can_play", true)) \
					or String(rejected_row.get("active_verification_filter", "")) != "rejected_server_claim" \
					or bool(rejected_row.get("client_result_authoritative", true)):
				failures.append("rejected_claim_filter_row_scope:%s" % [rejected_row])
		var wrong_authority_scope_row: Dictionary = replay_list._row_from_entry(wrong_authority_scope_entry, rows.size() + 3)
		if bool(wrong_authority_scope_row.get("metadata_valid", true)) or String(wrong_authority_scope_row.get("metadata_status", "")) != "preview_authority_scope_mismatch":
			failures.append("wrong_authority_scope_row_metadata:%s" % [wrong_authority_scope_row])
		var bad_sample_count_row: Dictionary = replay_list._row_from_entry(bad_sample_count_entry, rows.size() + 3)
		if bool(bad_sample_count_row.get("metadata_valid", true)) or String(bad_sample_count_row.get("metadata_status", "")) != "preview_sample_count_mismatch":
			failures.append("bad_sample_count_row_metadata:%s" % [bad_sample_count_row])
		var missing_sample_row: Dictionary = replay_list._row_from_entry(missing_sample_entry, rows.size() + 19)
		if bool(missing_sample_row.get("metadata_valid", true)) or String(missing_sample_row.get("metadata_status", "")) != "missing_preview_samples":
			failures.append("missing_sample_row_metadata:%s" % [missing_sample_row])
		var bad_sample_digest_count_row: Dictionary = replay_list._row_from_entry(bad_sample_digest_count_entry, rows.size() + 20)
		if bool(bad_sample_digest_count_row.get("metadata_valid", true)) or String(bad_sample_digest_count_row.get("metadata_status", "")) != "preview_sample_digest_count_mismatch":
			failures.append("bad_sample_digest_count_row_metadata:%s" % [bad_sample_digest_count_row])
		var noncanonical_sample_ticks_row: Dictionary = replay_list._row_from_entry(noncanonical_sample_ticks_entry, rows.size() + 4)
		if bool(noncanonical_sample_ticks_row.get("metadata_valid", true)) or String(noncanonical_sample_ticks_row.get("metadata_status", "")) != "preview_sample_ticks_noncanonical":
			failures.append("noncanonical_sample_ticks_row_metadata:%s" % [noncanonical_sample_ticks_row])
		var stale_sample_window_start_row: Dictionary = replay_list._row_from_entry(stale_sample_window_start_entry, rows.size() + 5)
		if bool(stale_sample_window_start_row.get("metadata_valid", true)) or String(stale_sample_window_start_row.get("metadata_status", "")) != "preview_sample_window_mismatch":
			failures.append("stale_sample_window_start_row_metadata:%s" % [stale_sample_window_start_row])
		var stale_sample_window_end_row: Dictionary = replay_list._row_from_entry(stale_sample_window_end_entry, rows.size() + 6)
		if bool(stale_sample_window_end_row.get("metadata_valid", true)) or String(stale_sample_window_end_row.get("metadata_status", "")) != "preview_sample_window_mismatch":
			failures.append("stale_sample_window_end_row_metadata:%s" % [stale_sample_window_end_row])
		var stale_sample_window_stride_row: Dictionary = replay_list._row_from_entry(stale_sample_window_stride_entry, rows.size() + 7)
		if bool(stale_sample_window_stride_row.get("metadata_valid", true)) or String(stale_sample_window_stride_row.get("metadata_status", "")) != "preview_sample_window_mismatch":
			failures.append("stale_sample_window_stride_row_metadata:%s" % [stale_sample_window_stride_row])
		var negative_sample_digest_row: Dictionary = replay_list._row_from_entry(negative_sample_digest_entry, rows.size() + 8)
		if bool(negative_sample_digest_row.get("metadata_valid", true)) or String(negative_sample_digest_row.get("metadata_status", "")) != "preview_sample_digest_negative":
			failures.append("negative_sample_digest_row_metadata:%s" % [negative_sample_digest_row])
		var stale_sample_digest_row: Dictionary = replay_list._row_from_entry(stale_sample_digest_entry, rows.size() + 9)
		if bool(stale_sample_digest_row.get("metadata_valid", true)) or String(stale_sample_digest_row.get("metadata_status", "")) != "preview_sample_digest_mismatch":
			failures.append("stale_sample_digest_row_metadata:%s" % [stale_sample_digest_row])
		var stale_sample_emit_count_row: Dictionary = replay_list._row_from_entry(stale_sample_emit_count_entry, rows.size() + 9)
		if bool(stale_sample_emit_count_row.get("metadata_valid", true)) or String(stale_sample_emit_count_row.get("metadata_status", "")) != "preview_sample_emit_count_mismatch":
			failures.append("stale_sample_emit_count_row_metadata:%s" % [stale_sample_emit_count_row])
		var negative_sample_emit_count_row: Dictionary = replay_list._row_from_entry(negative_sample_emit_count_entry, rows.size() + 10)
		if bool(negative_sample_emit_count_row.get("metadata_valid", true)) or String(negative_sample_emit_count_row.get("metadata_status", "")) != "preview_sample_emit_count_negative":
			failures.append("negative_sample_emit_count_row_metadata:%s" % [negative_sample_emit_count_row])
		var stale_fixture_row: Dictionary = replay_list._row_from_entry(stale_fixture_entry, rows.size() + 11)
		if bool(stale_fixture_row.get("metadata_valid", true)) or String(stale_fixture_row.get("metadata_status", "")) != "preview_fixture_mismatch":
			failures.append("stale_fixture_row_metadata:%s" % [stale_fixture_row])
		var stale_export_row: Dictionary = replay_list._row_from_entry(stale_export_entry, rows.size() + 12)
		if bool(stale_export_row.get("metadata_valid", true)) or String(stale_export_row.get("metadata_status", "")) != "preview_export_id_mismatch":
			failures.append("stale_export_row_metadata:%s" % [stale_export_row])
		var stale_seed_row: Dictionary = replay_list._row_from_entry(stale_seed_entry, rows.size() + 13)
		if bool(stale_seed_row.get("metadata_valid", true)) or String(stale_seed_row.get("metadata_status", "")) != "preview_seed_mismatch":
			failures.append("stale_seed_row_metadata:%s" % [stale_seed_row])
		var stale_bundle_id_row: Dictionary = replay_list._row_from_entry(stale_bundle_id_entry, rows.size() + 21)
		if bool(stale_bundle_id_row.get("metadata_valid", true)) or String(stale_bundle_id_row.get("metadata_status", "")) != "preview_bundle_id_mismatch":
			failures.append("stale_bundle_id_row_metadata:%s" % [stale_bundle_id_row])
		var stale_bundle_digest_row: Dictionary = replay_list._row_from_entry(stale_bundle_digest_entry, rows.size() + 22)
		if bool(stale_bundle_digest_row.get("metadata_valid", true)) or String(stale_bundle_digest_row.get("metadata_status", "")) != "preview_bundle_digest_mismatch":
			failures.append("stale_bundle_digest_row_metadata:%s" % [stale_bundle_digest_row])
		var missing_bundle_digest_row: Dictionary = replay_list._row_from_entry(missing_bundle_digest_entry, rows.size() + 27)
		if bool(missing_bundle_digest_row.get("metadata_valid", true)) or String(missing_bundle_digest_row.get("metadata_status", "")) != "preview_bundle_digest_missing":
			failures.append("missing_bundle_digest_row_metadata:%s" % [missing_bundle_digest_row])
		var stale_bundle_phase_count_row: Dictionary = replay_list._row_from_entry(stale_bundle_phase_count_entry, rows.size() + 23)
		if bool(stale_bundle_phase_count_row.get("metadata_valid", true)) or String(stale_bundle_phase_count_row.get("metadata_status", "")) != "preview_bundle_phase_count_mismatch":
			failures.append("stale_bundle_phase_count_row_metadata:%s" % [stale_bundle_phase_count_row])
		var legacy_signature_digest_mismatch_row: Dictionary = replay_list._row_from_entry(legacy_signature_digest_mismatch_entry, rows.size() + 14)
		if bool(legacy_signature_digest_mismatch_row.get("metadata_valid", true)) or String(legacy_signature_digest_mismatch_row.get("metadata_status", "")) != "preview_sample_digest_mismatch":
			failures.append("legacy_signature_digest_mismatch_row_metadata:%s" % [legacy_signature_digest_mismatch_row])
		var legacy_signature_emit_count_mismatch_row: Dictionary = replay_list._row_from_entry(legacy_signature_emit_count_mismatch_entry, rows.size() + 15)
		if bool(legacy_signature_emit_count_mismatch_row.get("metadata_valid", true)) or String(legacy_signature_emit_count_mismatch_row.get("metadata_status", "")) != "preview_sample_emit_count_mismatch":
			failures.append("legacy_signature_emit_count_mismatch_row_metadata:%s" % [legacy_signature_emit_count_mismatch_row])
		var stale_digest_row: Dictionary = replay_list._row_from_entry(stale_digest_entry, rows.size() + 16)
		if bool(stale_digest_row.get("metadata_valid", true)) or String(stale_digest_row.get("metadata_status", "")) != "preview_signature_digest_mismatch":
			failures.append("stale_digest_row_metadata:%s" % [stale_digest_row])
		var stale_max_emit_row: Dictionary = replay_list._row_from_entry(stale_max_emit_entry, rows.size() + 17)
		if bool(stale_max_emit_row.get("metadata_valid", true)) or String(stale_max_emit_row.get("metadata_status", "")) != "preview_max_emit_mismatch":
			failures.append("stale_max_emit_row_metadata:%s" % [stale_max_emit_row])
		var stale_bullet_cap_row: Dictionary = replay_list._row_from_entry(stale_bullet_cap_entry, rows.size() + 18)
		if bool(stale_bullet_cap_row.get("metadata_valid", true)) or String(stale_bullet_cap_row.get("metadata_status", "")) != "preview_budget_headroom_mismatch":
			failures.append("stale_bullet_cap_row_metadata:%s" % [stale_bullet_cap_row])
		var stale_bundle_phase_ids_row: Dictionary = replay_list._row_from_entry(stale_bundle_phase_ids_entry, rows.size() + 21)
		if bool(stale_bundle_phase_ids_row.get("metadata_valid", true)) or String(stale_bundle_phase_ids_row.get("metadata_status", "")) != "preview_bundle_phase_ids_mismatch":
			failures.append("stale_bundle_phase_ids_row_metadata:%s" % [stale_bundle_phase_ids_row])
		var stale_bundle_phase_digest_row: Dictionary = replay_list._row_from_entry(stale_bundle_phase_digest_entry, rows.size() + 22)
		if bool(stale_bundle_phase_digest_row.get("metadata_valid", true)) or String(stale_bundle_phase_digest_row.get("metadata_status", "")) != "preview_bundle_phase_digest_mismatch":
			failures.append("stale_bundle_phase_digest_row_metadata:%s" % [stale_bundle_phase_digest_row])
		var missing_bundle_phase_ids_row: Dictionary = replay_list._row_from_entry(missing_bundle_phase_ids_entry, rows.size() + 25)
		if bool(missing_bundle_phase_ids_row.get("metadata_valid", true)) or String(missing_bundle_phase_ids_row.get("metadata_status", "")) != "preview_bundle_phase_ids_missing":
			failures.append("missing_bundle_phase_ids_row_metadata:%s" % [missing_bundle_phase_ids_row])
		var missing_bundle_phase_digest_row: Dictionary = replay_list._row_from_entry(missing_bundle_phase_digest_entry, rows.size() + 26)
		if bool(missing_bundle_phase_digest_row.get("metadata_valid", true)) or String(missing_bundle_phase_digest_row.get("metadata_status", "")) != "preview_bundle_phase_digest_missing":
			failures.append("missing_bundle_phase_digest_row_metadata:%s" % [missing_bundle_phase_digest_row])
		var stale_bundle_max_emit_row: Dictionary = replay_list._row_from_entry(stale_bundle_max_emit_entry, rows.size() + 28)
		if bool(stale_bundle_max_emit_row.get("metadata_valid", true)) or String(stale_bundle_max_emit_row.get("metadata_status", "")) != "preview_bundle_max_emit_mismatch":
			failures.append("stale_bundle_max_emit_row_metadata:%s" % [stale_bundle_max_emit_row])
		var stale_bundle_headroom_row: Dictionary = replay_list._row_from_entry(stale_bundle_headroom_entry, rows.size() + 29)
		if bool(stale_bundle_headroom_row.get("metadata_valid", true)) or String(stale_bundle_headroom_row.get("metadata_status", "")) != "preview_bundle_headroom_mismatch":
			failures.append("stale_bundle_headroom_row_metadata:%s" % [stale_bundle_headroom_row])
		var stale_bundle_budget_status_row: Dictionary = replay_list._row_from_entry(stale_bundle_budget_status_entry, rows.size() + 30)
		if bool(stale_bundle_budget_status_row.get("metadata_valid", true)) or String(stale_bundle_budget_status_row.get("metadata_status", "")) != "preview_bundle_budget_status_mismatch":
			failures.append("stale_bundle_budget_status_row_metadata:%s" % [stale_bundle_budget_status_row])
	var lab_export: Dictionary = spellbook_model.phase_export_data("original_boss_archive", 20260625)
	var pattern_lab_rows: Array[Dictionary] = pattern_lab_model.rows_for_spellbook("original_boss_archive", 20260625)
	for lab_row in pattern_lab_rows:
		var row_dict: Dictionary = lab_row as Dictionary
		var lab_phase_id := String(row_dict.get("phase_id", ""))
		var lab_preview: Dictionary = spellbook_model.deterministic_phase_preview("original_boss_archive", lab_phase_id, 20260625)
		if String(row_dict.get("coverage_kind", "")) == "spellbook_phase":
			if String(row_dict.get("preview_bundle_id", "")) != String(lab_export.get("preview_bundle_id", "")):
				failures.append("pattern_lab_bundle_id_mismatch:%s" % lab_phase_id)
			if int(row_dict.get("preview_bundle_signature_digest", 0)) != int(lab_export.get("preview_bundle_signature_digest", 0)):
				failures.append("pattern_lab_bundle_digest_mismatch:%s" % lab_phase_id)
			if int(row_dict.get("preview_phase_count", 0)) != int(lab_export.get("preview_phase_count", 0)):
				failures.append("pattern_lab_bundle_phase_count_mismatch:%s" % lab_phase_id)
			if not _arrays_equal_strings(row_dict.get("preview_phase_ids", []), lab_export.get("preview_phase_ids", [])):
				failures.append("pattern_lab_bundle_phase_ids_mismatch:%s" % lab_phase_id)
			if not _arrays_equal_ints(row_dict.get("preview_phase_signature_digests", []), lab_export.get("preview_phase_signature_digests", [])):
				failures.append("pattern_lab_bundle_phase_digest_mismatch:%s" % lab_phase_id)
			if int(row_dict.get("preview_bundle_max_emit_per_tick", 0)) != int(lab_export.get("max_preview_emit_per_tick", -1)):
				failures.append("pattern_lab_bundle_max_emit_mismatch:%s" % lab_phase_id)
			if int(row_dict.get("preview_bundle_min_budget_headroom", 0)) != int(lab_export.get("min_preview_budget_headroom", -1)):
				failures.append("pattern_lab_bundle_headroom_mismatch:%s" % lab_phase_id)
			if String(row_dict.get("preview_bundle_budget_status", "")) != String(lab_export.get("performance_budget_status", "")):
				failures.append("pattern_lab_bundle_budget_status_mismatch:%s" % lab_phase_id)
			if String(row_dict.get("preview_fixture_id", "")) != String(lab_preview.get("preview_fixture_id", "")):
				failures.append("pattern_lab_fixture_mismatch:%s" % lab_phase_id)
			if not _arrays_equal_ints(row_dict.get("preview_sample_signature_digests", []), lab_preview.get("sample_signature_digests", [])):
				failures.append("pattern_lab_sample_digest_mismatch:%s" % lab_phase_id)
			if int(row_dict.get("preview_sample_window_start_tick", -1)) != int(lab_preview.get("sample_window_start_tick", -2)):
				failures.append("pattern_lab_sample_window_start_mismatch:%s" % lab_phase_id)
			continue
		if int(row_dict.get("deterministic_preview_digest", 0)) != int(lab_preview.get("signature_digest", 0)):
			failures.append("pattern_row_digest_mismatch:%s" % lab_phase_id)
		if String(row_dict.get("preview_bundle_id", "")) != String(lab_export.get("preview_bundle_id", "")):
			failures.append("pattern_row_bundle_id_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("preview_bundle_signature_digest", 0)) != int(lab_export.get("preview_bundle_signature_digest", 0)):
			failures.append("pattern_row_bundle_digest_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("preview_phase_count", 0)) != int(lab_export.get("preview_phase_count", 0)):
			failures.append("pattern_row_bundle_phase_count_mismatch:%s" % lab_phase_id)
		if not _arrays_equal_strings(row_dict.get("preview_phase_ids", []), lab_export.get("preview_phase_ids", [])):
			failures.append("pattern_row_bundle_phase_ids_mismatch:%s" % lab_phase_id)
		if not _arrays_equal_ints(row_dict.get("preview_phase_signature_digests", []), lab_export.get("preview_phase_signature_digests", [])):
			failures.append("pattern_row_bundle_phase_digest_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("preview_bundle_max_emit_per_tick", 0)) != int(lab_export.get("max_preview_emit_per_tick", -1)):
			failures.append("pattern_row_bundle_max_emit_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("preview_bundle_min_budget_headroom", 0)) != int(lab_export.get("min_preview_budget_headroom", -1)):
			failures.append("pattern_row_bundle_headroom_mismatch:%s" % lab_phase_id)
		if String(row_dict.get("preview_bundle_budget_status", "")) != String(lab_export.get("performance_budget_status", "")):
			failures.append("pattern_row_bundle_budget_status_mismatch:%s" % lab_phase_id)
		if String(row_dict.get("preview_authority_scope", "")) != String(lab_preview.get("preview_authority_scope", "")):
			failures.append("pattern_row_authority_scope_mismatch:%s" % lab_phase_id)
		if String(row_dict.get("preview_export_id", "")) != String(lab_preview.get("export_id", "")):
			failures.append("pattern_row_export_mismatch:%s" % lab_phase_id)
		if String(row_dict.get("preview_fixture_id", "")) != String(lab_preview.get("preview_fixture_id", "")):
			failures.append("pattern_row_fixture_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("preview_sample_count", -1)) != (lab_preview.get("samples", []) as Array).size():
			failures.append("pattern_row_sample_count_mismatch:%s" % lab_phase_id)
		if not _arrays_equal_ints(row_dict.get("preview_sample_ticks", []), lab_preview.get("sample_ticks", [])):
			failures.append("pattern_row_sample_ticks_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("preview_sample_window_start_tick", -1)) != int(lab_preview.get("sample_window_start_tick", -2)):
			failures.append("pattern_row_sample_window_start_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("preview_sample_window_end_tick", -1)) != int(lab_preview.get("sample_window_end_tick", -2)):
			failures.append("pattern_row_sample_window_end_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("preview_sample_window_stride_ticks", -1)) != int(lab_preview.get("sample_window_stride_ticks", -2)):
			failures.append("pattern_row_sample_window_stride_mismatch:%s" % lab_phase_id)
		if not _arrays_equal_ints(row_dict.get("preview_sample_signature_digests", []), lab_preview.get("sample_signature_digests", [])):
			failures.append("pattern_row_sample_digest_mismatch:%s" % lab_phase_id)
		if not _arrays_equal_ints(row_dict.get("preview_sample_emit_counts", []), lab_preview.get("sample_emit_counts", [])):
			failures.append("pattern_row_sample_emit_count_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("max_preview_emit", -1)) != int(lab_preview.get("max_emit_per_tick", -2)):
			failures.append("pattern_row_max_emit_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("bullet_cap_per_tick", -1)) != int(lab_preview.get("bullet_cap_per_tick", -2)):
			failures.append("pattern_row_bullet_cap_mismatch:%s" % lab_phase_id)
		if int(row_dict.get("preview_budget_headroom", -1)) != int(lab_preview.get("budget_headroom", -2)):
			failures.append("pattern_row_headroom_mismatch:%s" % lab_phase_id)
		if String(row_dict.get("performance_budget_status", "")) != String(lab_preview.get("performance_budget_status", "")):
			failures.append("pattern_row_budget_status_mismatch:%s" % lab_phase_id)
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
			"preview_bundle_id": String(preview.get("preview_bundle_id", "")),
			"preview_bundle_signature_digest": int(preview.get("preview_bundle_signature_digest", 0)),
			"preview_phase_count": int(preview.get("preview_phase_count", 0)),
			"preview_phase_ids": (preview.get("preview_phase_ids", []) as Array).duplicate(),
			"preview_phase_signature_digests": (preview.get("preview_phase_signature_digests", []) as Array).duplicate(),
			"preview_bundle_max_emit_per_tick": int(preview.get("preview_bundle_max_emit_per_tick", 0)),
			"preview_bundle_min_budget_headroom": int(preview.get("preview_bundle_min_budget_headroom", 0)),
			"preview_bundle_budget_status": String(preview.get("preview_bundle_budget_status", "")),
			"preview_export_id": String(preview.get("export_id", "")),
			"preview_authority_scope": String(preview.get("preview_authority_scope", "")),
			"preview_fixture_id": "%s:%s:%d" % [spellbook_id, phase_id, int(preview.get("seed", 0))],
			"preview_seed": int(preview.get("seed", 0)),
			"preview_signature_digest": int(preview.get("signature_digest", 0)),
			"preview_sample_ticks": (preview.get("sample_ticks", []) as Array).duplicate(),
			"preview_sample_window_start_tick": int(preview.get("sample_window_start_tick", 0)),
			"preview_sample_window_end_tick": int(preview.get("sample_window_end_tick", 0)),
			"preview_sample_window_stride_ticks": int(preview.get("sample_window_stride_ticks", 0)),
			"preview_sample_signature_digests": (preview.get("sample_signature_digests", []) as Array).duplicate(),
			"preview_sample_emit_counts": (preview.get("sample_emit_counts", []) as Array).duplicate(),
			"preview_sample_count": (preview.get("samples", []) as Array).size(),
			"preview_max_emit_per_tick": int(preview.get("max_emit_per_tick", 0)),
			"preview_bullet_cap_per_tick": int(preview.get("bullet_cap_per_tick", 0)),
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
			"preview_fixture_id": "%s:%s:%d" % [spellbook_id, phase_id, int(preview.get("seed", 0))],
			"preview_signature": String(preview.get("signature", "")),
			"preview_budget_headroom": int(preview.get("budget_headroom", 0)),
			"performance_budget_status": String(preview.get("performance_budget_status", "")),
			"server_authoritative": false,
			"result": "practice",
		},
	}
	return store._build_index_entry(snapshot, "user://replays/legacy_fixture_%s_%s.json" % [spellbook_id, phase_id])

func _snapshot_server_claim_replay_entry_for_preview(store: RefCounted, spellbook_id: String, phase_id: String, preview: Dictionary) -> Dictionary:
	var snapshot := {
		"ruleset_version": "ruleset-local-s0",
		"game_version": "prototype",
		"match_seed": int(preview.get("seed", 0)),
		"final_result_hash": int(preview.get("signature_digest", 0)),
		"input_stream": [],
		"boss_instance_id": "world_boss_snapshot_claim",
		"boss_remaining_hp": 400000,
		"boss_hp_after_global": 412000,
		"settlement_receipt": {"receipt_id": "server-only"},
		"reward_grants": [{"currency": "spirit", "amount": 99}],
		"server_result_hash": "server-hash-only",
		"metadata": {
			"saved_at": "2026-06-29T04:20:00Z",
			"final_tick": 180,
			"mode": "boss_spellbook_practice",
			"catalog_id": "boss_spellbook",
			"spellbook_id": spellbook_id,
			"phase_id": phase_id,
			"preview_export_schema_version": int(preview.get("export_schema_version", 0)),
			"preview_export_id": String(preview.get("export_id", "")),
			"preview_authority_scope": String(preview.get("preview_authority_scope", "")),
			"preview_fixture_id": "%s:%s:%d" % [spellbook_id, phase_id, int(preview.get("seed", 0))],
			"preview_seed": int(preview.get("seed", 0)),
			"preview_signature_digest": int(preview.get("signature_digest", 0)),
			"preview_sample_ticks": (preview.get("sample_ticks", []) as Array).duplicate(),
			"preview_sample_window_start_tick": int(preview.get("sample_window_start_tick", 0)),
			"preview_sample_window_end_tick": int(preview.get("sample_window_end_tick", 0)),
			"preview_sample_window_stride_ticks": int(preview.get("sample_window_stride_ticks", 0)),
			"preview_sample_signature_digests": (preview.get("sample_signature_digests", []) as Array).duplicate(),
			"preview_sample_emit_counts": (preview.get("sample_emit_counts", []) as Array).duplicate(),
			"preview_sample_count": (preview.get("samples", []) as Array).size(),
			"preview_max_emit_per_tick": int(preview.get("max_emit_per_tick", 0)),
			"preview_bullet_cap_per_tick": int(preview.get("bullet_cap_per_tick", 0)),
			"preview_budget_headroom": int(preview.get("budget_headroom", 0)),
			"performance_budget_status": String(preview.get("performance_budget_status", "")),
			"server_authoritative": false,
			"result": "practice",
		},
	}
	return store._build_index_entry(snapshot, "user://replays/snapshot_claim_fixture_%s_%s.json" % [spellbook_id, phase_id])

func _single_entry_array(entry: Dictionary) -> Array[Dictionary]:
	var entries: Array[Dictionary] = []
	entries.append(entry)
	return entries

func _string_array_contains(values: Variant, expected: String) -> bool:
	if typeof(values) != TYPE_ARRAY:
		return false
	for value in values:
		if String(value) == expected:
			return true
	return false

func _find_row_by_id(rows: Array[Dictionary], row_id: String) -> Dictionary:
	for row in rows:
		if String(row.get("id", "")) == row_id:
			return row
	return {}

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
