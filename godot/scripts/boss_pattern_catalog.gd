class_name BossPatternCatalog
extends RefCounted

const BulletEngineLib := preload("res://scripts/bullet_engine.gd")
const BulletPatterns := preload("res://scripts/bullet_pattern_library.gd")

const MAX_INITIAL_EMIT_BULLETS_PER_PATTERN := 96
const MAX_BEHAVIOR_SPAWNED_BULLETS_PER_TICK := 96
const MAX_SPELLBOOK_EMIT_BULLETS_PER_TICK := 192

const BOSS_TYPE_REQUIREMENTS: Array[Dictionary] = [
	{
		"id": "aimed_shot",
		"label": "target-aimed pressure",
		"pattern_types": ["n_way", "burst", "curve_fan", "homing", "delayed_aim_ring"],
	},
	{
		"id": "n_way",
		"label": "fan lanes",
		"pattern_types": ["n_way", "burst", "curve_fan", "split_chain"],
	},
	{
		"id": "ring",
		"label": "radial rings",
		"pattern_types": ["ring", "gap_ring", "alternating_ring", "morph_ring", "phase_shift_ring", "scale_pulse_ring"],
	},
	{
		"id": "spiral",
		"label": "rotating spiral stacks",
		"pattern_types": ["spiral_stack", "flower", "sine_stream", "snake_stream"],
	},
	{
		"id": "laser",
		"label": "warning lasers and shaped beams",
		"pattern_types": ["laser_curtain", "sweep_laser", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser"],
	},
	{
		"id": "curve",
		"label": "curved lanes and paths",
		"pattern_types": ["curve_fan", "snake_stream", "curved_laser", "wave_laser", "path_follow", "bezier_follow", "trail_emitters"],
	},
	{
		"id": "delayed_speed",
		"label": "delayed speed changes",
		"pattern_types": ["accel_ring", "stop_release", "phase_shift_ring", "boomerang_ring", "orbit_release", "delayed_aim_ring"],
	},
	{
		"id": "split_transform",
		"label": "split and transform carriers",
		"pattern_types": ["split_chain", "blossom", "exploding_star", "telegraph_burst", "charge_burst", "trap_marker", "summoner_orbit", "path_emitters"],
	},
	{
		"id": "seeded_random",
		"label": "deterministic seeded random",
		"pattern_types": ["random_arc", "grid_rain", "edge_spawn", "converge_cloud", "vortex_field", "trap_marker"],
	},
	{
		"id": "phase_script",
		"label": "multi-phase boss scripts",
		"pattern_types": ["boss_spellbook"],
	},
]

const OFFICIAL_BOSS_TYPE_COVERAGE: Array[Dictionary] = [
	{
		"id": "n_way",
		"label": "n-way fans",
		"pattern_types": ["n_way", "burst", "curve_fan", "split_chain"],
	},
	{
		"id": "aimed",
		"label": "aimed shots and baited lanes",
		"pattern_types": ["n_way", "burst", "curve_fan", "homing", "delayed_aim_ring", "edge_spawn", "beam_sweep"],
	},
	{
		"id": "rotating_rings",
		"label": "rotating rings",
		"pattern_types": ["ring", "gap_ring", "alternating_ring", "morph_ring", "phase_shift_ring", "scale_pulse_ring"],
	},
	{
		"id": "spiral",
		"label": "spirals and rotating stacks",
		"pattern_types": ["spiral_stack", "flower", "sine_stream", "snake_stream"],
	},
	{
		"id": "curtain_wall",
		"label": "curtains, walls, and gates",
		"pattern_types": ["curtain", "grid_rain", "edge_spawn", "wall_bounce", "gate_lanes"],
	},
	{
		"id": "laser_warning_fire",
		"label": "laser warning plus fire",
		"pattern_types": ["laser_curtain", "sweep_laser", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser"],
	},
	{
		"id": "split_branching",
		"label": "split and branching carriers",
		"pattern_types": ["split_chain", "exploding_star", "telegraph_burst", "charge_burst", "trap_marker", "summoner_orbit", "path_emitters", "trail_emitters"],
	},
	{
		"id": "delayed_blossom",
		"label": "delayed blossom and delayed velocity",
		"pattern_types": ["blossom", "exploding_star", "stop_release", "boomerang_ring", "delayed_aim_ring", "phase_shift_ring", "orbit_release"],
	},
	{
		"id": "homing",
		"label": "limited homing",
		"pattern_types": ["homing"],
	},
	{
		"id": "orbital_lattice",
		"label": "orbital and lattice releases",
		"pattern_types": ["orbital", "orbit_release", "summoner_orbit", "path_emitters", "path_follow", "bezier_follow"],
	},
	{
		"id": "stream_weave",
		"label": "streams and weave lanes",
		"pattern_types": ["sine_stream", "snake_stream", "curve_fan", "trail_emitters", "gate_lanes"],
	},
	{
		"id": "random_seeded",
		"label": "deterministic seeded randomness",
		"pattern_types": ["random_arc", "grid_rain", "edge_spawn", "converge_cloud", "vortex_field", "trap_marker"],
	},
	{
		"id": "phase_script",
		"label": "multi-phase script",
		"pattern_types": ["boss_spellbook"],
	},
	{
		"id": "spellcard_timeout_enrage",
		"label": "spellcard timeout and enrage rules",
		"pattern_types": ["boss_spellbook"],
		"requires_spellbook_timeout_enrage": true,
	},
]

const FAMILIES: Array[Dictionary] = [
	{
		"id": "radial",
		"label": "radial rings and spirals",
		"official_coverage": ["even_ring", "odd_even_ring", "spiral", "multi_layer_spiral", "safe_gap_ring", "speed_morph_ring", "acceleration_ring", "stop_release_ring", "returning_ring", "orbit_release", "phase_shift_ring", "growing_orb_ring"],
		"pattern_types": ["ring", "gap_ring", "alternating_ring", "spiral_stack", "morph_ring", "flower", "accel_ring", "stop_release", "boomerang_ring", "orbit_release", "phase_shift_ring", "scale_pulse_ring"],
	},
	{
		"id": "aimed",
		"label": "aimed fans and lane pressure",
		"official_coverage": ["n_way", "aimed_fan", "knife_burst", "curved_lane", "speed_gradient"],
		"pattern_types": ["n_way", "burst", "curve_fan"],
	},
	{
		"id": "random_seeded",
		"label": "seeded scatter and rain",
		"official_coverage": ["random_arc", "jittered_rain", "grid_wall", "converging_cloud", "force_field"],
		"pattern_types": ["random_arc", "grid_rain", "converge_cloud", "vortex_field"],
	},
	{
		"id": "delayed",
		"label": "delayed split and blossom",
		"official_coverage": ["split_chain", "blossom", "starburst", "timed_release", "delayed_aim", "telegraphed_burst", "charge_cancel_burst", "trap_marker"],
		"pattern_types": ["split_chain", "blossom", "exploding_star", "telegraph_burst", "charge_burst", "trap_marker", "delayed_aim_ring"],
	},
	{
		"id": "tracking",
		"label": "limited tracking",
		"official_coverage": ["homing", "baitable_turning"],
		"pattern_types": ["homing"],
	},
	{
		"id": "laser",
		"label": "warning and persistent lasers",
		"official_coverage": ["warning_laser", "sweep_laser", "capsule_beam", "continuous_graze_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "rotating_laser", "wave_laser"],
		"pattern_types": ["laser_curtain", "sweep_laser", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser"],
	},
	{
		"id": "field",
		"label": "walls, orbitals, waves, and emitters",
		"official_coverage": ["curtain_wall", "sine_stream", "snake_stream", "edge_spawn", "orbital_release", "summoner_orbit", "path_emitters", "path_follow", "bezier_follow", "trail_emitters", "bounce_lanes", "moving_gate_wall"],
		"pattern_types": ["curtain", "sine_stream", "snake_stream", "edge_spawn", "orbital", "summoner_orbit", "path_emitters", "path_follow", "bezier_follow", "trail_emitters", "wall_bounce", "gate_lanes"],
	},
]

const OPEN_SOURCE_RECIPES: Array[Dictionary] = [
	{
		"id": "taisei_mechanic_syntax",
		"project": "Taisei Project",
		"license": "MIT-compatible open-source project license",
		"provenance": "public Git repository; mechanism checklist only",
		"source_url": "https://github.com/taisei-project/taisei",
		"status": "mechanic_syntax_only",
		"mapped_pattern_types": ["gap_ring", "spiral_stack", "curve_fan", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser", "summoner_orbit", "path_emitters", "path_follow", "bezier_follow", "trail_emitters", "accel_ring", "stop_release", "delayed_aim_ring", "orbit_release", "phase_shift_ring", "scale_pulse_ring", "telegraph_burst", "charge_burst", "trap_marker"],
		"notes": "Use only broad mechanism categories such as scripted bosses, bullet helpers, warnings, and lasers; do not copy stages, names, assets, or full spell layouts.",
	},
	{
		"id": "danmaku_unity_engine_syntax",
		"project": "DanmakU / Danmokou-style Unity bullet scripting",
		"license": "MIT-family open-source engine examples",
		"provenance": "public engine examples; no authored pattern data imported",
		"source_url": "https://github.com/search?q=DanmakU+danmokou&type=repositories",
		"status": "engine_concept_only",
		"mapped_pattern_types": ["morph_ring", "grid_rain", "converge_cloud", "vortex_field", "snake_stream", "edge_spawn", "gate_lanes", "trap_marker"],
		"notes": "Port the concept of composable bullet equations and deterministic parameters, not any authored pattern script.",
	},
	{
		"id": "godot_bullet_hell_tooling",
		"project": "Godot open-source bullet hell tooling",
		"license": "project-specific open-source licenses; verify before direct asset/code reuse",
		"provenance": "public tooling references; original SpellKard implementation",
		"source_url": "https://github.com/search?q=Godot+bullet+hell+engine&type=repositories",
		"status": "design_reference_only",
		"mapped_pattern_types": ["wall_bounce", "beam_sweep", "reflect_laser", "alternating_ring", "boomerang_ring"],
		"notes": "Keep this repo implementation original; use references only for feature checklist ideas such as pooling, shape hit tests, and editor-friendly recipes.",
	},
]

const OPEN_SOURCE_ADAPTERS: Array[Dictionary] = [
	{
		"id": "mechanic_recipe_adapter_v1",
		"label": "mechanic syntax adapter",
		"license": "metadata-only adapter; source project license must be recorded per recipe",
		"provenance": "SpellKard-authored adapter for mechanism categories and deterministic parameters",
		"accepted_fields": ["source_project", "source_url", "license", "provenance", "status", "mapped_pattern_types", "parameters"],
		"required_fields": ["source_project", "source_url", "license", "provenance", "status", "mapped_pattern_types"],
		"allowed_statuses": ["mechanic_syntax_only", "engine_concept_only", "design_reference_only"],
		"rejected_material": ["commercial_stage_data", "commercial_character_names", "commercial_audio", "commercial_art", "direct_copy", "authored_pattern_script"],
	},
]

static func family_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for family in FAMILIES:
		rows.append((family as Dictionary).duplicate(true))
	return rows

static func open_source_recipe_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for recipe in OPEN_SOURCE_RECIPES:
		rows.append((recipe as Dictionary).duplicate(true))
	return rows

static func open_source_adapter_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for adapter in OPEN_SOURCE_ADAPTERS:
		rows.append((adapter as Dictionary).duplicate(true))
	return rows

static func boss_type_requirement_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for requirement in BOSS_TYPE_REQUIREMENTS:
		rows.append((requirement as Dictionary).duplicate(true))
	return rows

static func official_boss_type_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for requirement in OFFICIAL_BOSS_TYPE_COVERAGE:
		rows.append((requirement as Dictionary).duplicate(true))
	return rows

static func all_catalog_pattern_types() -> Array[String]:
	var types: Array[String] = []
	for family in FAMILIES:
		for pattern_type in family.get("pattern_types", []):
			var type_name := String(pattern_type)
			if not types.has(type_name):
				types.append(type_name)
	return types

static func validate_official_boss_type_coverage(stage_model: RefCounted, spellbook_model: RefCounted = null) -> Dictionary:
	var failures: Array[String] = []
	var seen_types := _combined_seen_types(stage_model, spellbook_model)
	for requirement in OFFICIAL_BOSS_TYPE_COVERAGE:
		var requirement_id := String(requirement.get("id", ""))
		var satisfied := false
		if bool(requirement.get("requires_spellbook_timeout_enrage", false)):
			satisfied = _spellbook_has_timeout_enrage(spellbook_model)
		elif requirement_id == "phase_script":
			satisfied = spellbook_model != null and spellbook_model.has_method("validate_spellbooks") and bool(spellbook_model.validate_spellbooks().get("ok", false))
		else:
			for pattern_type in requirement.get("pattern_types", []):
				if seen_types.has(String(pattern_type)):
					satisfied = true
					break
		if not satisfied:
			failures.append("missing_official_type:%s" % requirement_id)
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"requirement_count": OFFICIAL_BOSS_TYPE_COVERAGE.size(),
		"seen_types": seen_types,
	}

static func validate_stage_patterns(stage_model: RefCounted) -> Dictionary:
	var required_types := all_catalog_pattern_types()
	var seen_types: Array[String] = []
	if stage_model == null or not stage_model.has_method("stage_ids"):
		return {"ok": false, "missing_types": required_types, "seen_types": seen_types, "reason": "missing_stage_model"}
	for stage_id in stage_model.stage_ids():
		for pattern in stage_model.patterns_for_stage(String(stage_id)):
			var pattern_type := String(pattern.get("type", ""))
			if not pattern_type.is_empty() and not seen_types.has(pattern_type):
				seen_types.append(pattern_type)
	var missing: Array[String] = []
	for pattern_type in required_types:
		if not seen_types.has(pattern_type):
			missing.append(pattern_type)
	return {
		"ok": missing.is_empty(),
		"missing_types": missing,
		"seen_types": seen_types,
		"required_types": required_types,
	}

static func validate_boss_type_requirements(stage_model: RefCounted, spellbook_model: RefCounted = null) -> Dictionary:
	var failures: Array[String] = []
	var stage_coverage := validate_stage_patterns(stage_model)
	var seen_types: Array[String] = []
	for pattern_type in stage_coverage.get("seen_types", []):
		seen_types.append(String(pattern_type))
	var spellbook_ok := false
	if spellbook_model != null and spellbook_model.has_method("validate_spellbooks"):
		var spellbook_result: Dictionary = spellbook_model.validate_spellbooks()
		spellbook_ok = bool(spellbook_result.get("ok", false)) and int(spellbook_result.get("phase_count", 0)) >= 3
	for requirement in BOSS_TYPE_REQUIREMENTS:
		var requirement_id := String(requirement.get("id", ""))
		var satisfied := false
		if requirement_id == "phase_script":
			satisfied = spellbook_ok
		else:
			for pattern_type in requirement.get("pattern_types", []):
				if seen_types.has(String(pattern_type)):
					satisfied = true
					break
		if not satisfied:
			failures.append("missing_requirement:%s" % requirement_id)
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"requirement_count": BOSS_TYPE_REQUIREMENTS.size(),
		"seen_types": seen_types,
	}

static func validate_pattern_emitters(stage_model: RefCounted, seed: int = 20260625) -> Dictionary:
	var failures: Array[String] = []
	var sample_by_type := _stage_sample_by_type(stage_model)
	var emitted_by_type: Dictionary = {}
	var spawned_by_behavior: Dictionary = {}
	var shaped_laser_types: Array[String] = []
	var continuous_laser_types: Array[String] = []
	var deterministic_types: Array[String] = []
	var seed_variant_types: Array[String] = []
	var target := Vector2(480, 600)
	var spawn_index := 1000
	for pattern_type in all_catalog_pattern_types():
		if not sample_by_type.has(pattern_type):
			failures.append("missing_sample:%s" % pattern_type)
			continue
		var config: Dictionary = (sample_by_type[pattern_type] as Dictionary).duplicate(true)
		config["type"] = pattern_type
		config["origin"] = config.get("origin", Vector2(480, 120))
		var tick := int(config.get("phase_offset_ticks", 0))
		var emitted: Array[Dictionary] = BulletPatterns.emit_pattern(config, tick, target, spawn_index, seed)
		if emitted.is_empty():
			failures.append("emit_empty:%s" % pattern_type)
			continue
		emitted_by_type[pattern_type] = emitted.size()
		if _has_behavior_spawn(emitted, target):
			spawned_by_behavior[pattern_type] = true
		if _has_shaped_laser(emitted):
			shaped_laser_types.append(pattern_type)
		if _has_continuous_graze(emitted):
			continuous_laser_types.append(pattern_type)
		var repeated: Array[Dictionary] = BulletPatterns.emit_pattern(config, tick, target, spawn_index, seed)
		if _bullet_signature(emitted) != _bullet_signature(repeated):
			failures.append("non_deterministic:%s" % pattern_type)
		else:
			deterministic_types.append(pattern_type)
		if _requires_seed_variation(pattern_type):
			var variant: Array[Dictionary] = BulletPatterns.emit_pattern(config, tick, target, spawn_index, seed + 97)
			if _bullet_signature(emitted) == _bullet_signature(variant):
				failures.append("seed_no_effect:%s" % pattern_type)
			else:
				seed_variant_types.append(pattern_type)
		spawn_index += 100
	for requirement in BOSS_TYPE_REQUIREMENTS:
		var requirement_id := String(requirement.get("id", ""))
		if requirement_id == "phase_script":
			continue
		var emitted_requirement := false
		for pattern_type in requirement.get("pattern_types", []):
			if emitted_by_type.has(String(pattern_type)):
				emitted_requirement = true
				break
		if not emitted_requirement:
			failures.append("requirement_not_emitted:%s" % requirement_id)
	if shaped_laser_types.is_empty():
		failures.append("no_shaped_laser")
	if continuous_laser_types.is_empty():
		failures.append("no_continuous_laser_graze")
	if spawned_by_behavior.is_empty():
		failures.append("no_behavior_spawns")
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"emitted_type_count": emitted_by_type.size(),
		"emitted_by_type": emitted_by_type,
		"behavior_spawn_types": spawned_by_behavior.keys(),
		"shaped_laser_types": shaped_laser_types,
		"continuous_laser_types": continuous_laser_types,
		"deterministic_type_count": deterministic_types.size(),
		"seed_variant_types": seed_variant_types,
	}

static func validate_performance_budgets(stage_model: RefCounted, spellbook_model: RefCounted = null, seed: int = 20260625) -> Dictionary:
	var failures: Array[String] = []
	var sample_by_type := _stage_sample_by_type(stage_model)
	var target := Vector2(480, 600)
	var max_initial_emit := 0
	var max_behavior_spawned := 0
	var spawn_index := 7000
	var initial_emit_by_type: Dictionary = {}
	var behavior_spawn_by_type: Dictionary = {}
	for pattern_type in all_catalog_pattern_types():
		if not sample_by_type.has(pattern_type):
			continue
		var config: Dictionary = (sample_by_type[pattern_type] as Dictionary).duplicate(true)
		config["type"] = pattern_type
		config["origin"] = config.get("origin", Vector2(480, 120))
		var tick := int(config.get("phase_offset_ticks", 0))
		var emitted: Array[Dictionary] = BulletPatterns.emit_pattern(config, tick, target, spawn_index, seed)
		max_initial_emit = maxi(max_initial_emit, emitted.size())
		initial_emit_by_type[pattern_type] = emitted.size()
		if emitted.size() > MAX_INITIAL_EMIT_BULLETS_PER_PATTERN:
			failures.append("emit_budget:%s:%d" % [pattern_type, emitted.size()])
		var max_spawned_for_pattern := _max_behavior_spawned_per_tick(emitted, target)
		max_behavior_spawned = maxi(max_behavior_spawned, max_spawned_for_pattern)
		behavior_spawn_by_type[pattern_type] = max_spawned_for_pattern
		if max_spawned_for_pattern > MAX_BEHAVIOR_SPAWNED_BULLETS_PER_TICK:
			failures.append("behavior_spawn_budget:%s:%d" % [pattern_type, max_spawned_for_pattern])
		spawn_index += 100
	var spellbook_budget: Dictionary = _spellbook_emit_budget_report(spellbook_model, target, seed)
	var max_spellbook_emit := int(spellbook_budget.get("max_emit_per_tick", 0))
	if max_spellbook_emit > MAX_SPELLBOOK_EMIT_BULLETS_PER_TICK:
		failures.append("spellbook_emit_budget:%d" % max_spellbook_emit)
	for row in spellbook_budget.get("rows", []):
		var row_dict: Dictionary = row as Dictionary
		if String(row_dict.get("performance_budget_status", "")) == "over_budget":
			failures.append("spellbook_phase_emit_budget:%s:%d" % [
				String(row_dict.get("phase_id", "")),
				int(row_dict.get("max_emit_per_tick", 0)),
			])
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"max_initial_emit": max_initial_emit,
		"max_behavior_spawned_per_tick": max_behavior_spawned,
		"max_spellbook_emit_per_tick": max_spellbook_emit,
		"initial_emit_by_type": initial_emit_by_type,
		"behavior_spawn_by_type": behavior_spawn_by_type,
		"spellbook_budget_rows": spellbook_budget.get("rows", []),
		"spellbook_budget_status": String(spellbook_budget.get("status", "")),
		"max_spellbook_phase": String(spellbook_budget.get("max_phase_id", "")),
		"initial_emit_budget": MAX_INITIAL_EMIT_BULLETS_PER_PATTERN,
		"behavior_spawn_budget": MAX_BEHAVIOR_SPAWNED_BULLETS_PER_TICK,
		"spellbook_emit_budget": MAX_SPELLBOOK_EMIT_BULLETS_PER_TICK,
	}

static func validate_spellbook_preview_exports(spellbook_model: RefCounted, pattern_lab_model: RefCounted = null, seed: int = 20260625) -> Dictionary:
	var failures: Array[String] = []
	if spellbook_model == null:
		return {"ok": false, "failures": ["missing_spellbook_model"], "preview_count": 0}
	for method_name in ["spellbook_ids", "timeline_rows", "deterministic_phase_preview", "phase_export_data", "validate_phase_preview_exports", "golden_preview_fixtures", "golden_preview_bundle_fixtures"]:
		if not spellbook_model.has_method(method_name):
			return {"ok": false, "failures": ["missing_method:%s" % method_name], "preview_count": 0}
	var model_export_validation: Dictionary = spellbook_model.validate_phase_preview_exports(seed)
	if not bool(model_export_validation.get("ok", false)):
		for failure in model_export_validation.get("failures", []):
			failures.append("spellbook_model_%s" % String(failure))
	var preview_count := 0
	var golden_preview_count := 0
	var golden_bundle_count := 0
	var golden_fixtures: Dictionary = spellbook_model.golden_preview_fixtures()
	var golden_bundle_fixtures: Dictionary = spellbook_model.golden_preview_bundle_fixtures()
	var seen_fixture_ids: Array[String] = []
	var seen_bundle_fixture_ids: Array[String] = []
	for spellbook_id in spellbook_model.spellbook_ids():
		var export: Dictionary = spellbook_model.phase_export_data(String(spellbook_id), seed)
		if String(export.get("license", "")).is_empty() or String(export.get("provenance", "")).is_empty():
			failures.append("export_missing_provenance:%s" % String(spellbook_id))
		var expected_bundle_id := "boss_spellbook_preview_bundle_%s_%d" % [String(spellbook_id), seed]
		if String(export.get("preview_bundle_id", "")) != expected_bundle_id:
			failures.append("preview_bundle_id_mismatch:%s" % String(spellbook_id))
		var bundle_fixture_id := "%s:%d" % [String(spellbook_id), seed]
		if not golden_bundle_fixtures.has(bundle_fixture_id):
			failures.append("missing_golden_preview_bundle:%s" % bundle_fixture_id)
		else:
			var bundle_fixture: Dictionary = golden_bundle_fixtures[bundle_fixture_id]
			golden_bundle_count += 1
			seen_bundle_fixture_ids.append(bundle_fixture_id)
			if String(bundle_fixture.get("preview_bundle_id", "")) != String(export.get("preview_bundle_id", "")):
				failures.append("golden_preview_bundle_id:%s" % String(spellbook_id))
			if String(bundle_fixture.get("preview_bundle_fixture_id", "")) != bundle_fixture_id:
				failures.append("golden_preview_bundle_fixture_id:%s" % String(spellbook_id))
			if String(bundle_fixture.get("preview_authority_scope", "")) != "local_practice_preview_only":
				failures.append("golden_preview_bundle_authority_scope:%s" % String(spellbook_id))
			if int(bundle_fixture.get("preview_bundle_signature_digest", 0)) != int(export.get("preview_bundle_signature_digest", 0)):
				failures.append("golden_preview_bundle_digest:%s" % String(spellbook_id))
			if int(bundle_fixture.get("preview_phase_count", 0)) != int(export.get("preview_phase_count", 0)):
				failures.append("golden_preview_bundle_phase_count:%s" % String(spellbook_id))
			if not _arrays_equal_strings(bundle_fixture.get("preview_phase_ids", []), export.get("preview_phase_ids", [])):
				failures.append("golden_preview_bundle_phase_ids:%s" % String(spellbook_id))
			if not _arrays_equal_ints(bundle_fixture.get("preview_phase_signature_digests", []), export.get("preview_phase_signature_digests", [])):
				failures.append("golden_preview_bundle_phase_digests:%s" % String(spellbook_id))
			if int(bundle_fixture.get("max_preview_emit_per_tick", 0)) != int(export.get("max_preview_emit_per_tick", 0)):
				failures.append("golden_preview_bundle_max_emit:%s" % String(spellbook_id))
			if int(bundle_fixture.get("min_preview_budget_headroom", 0)) != int(export.get("min_preview_budget_headroom", 0)):
				failures.append("golden_preview_bundle_headroom:%s" % String(spellbook_id))
			if String(bundle_fixture.get("performance_budget_status", "")) != String(export.get("performance_budget_status", "")):
				failures.append("golden_preview_bundle_budget_status:%s" % String(spellbook_id))
		var export_phases: Array = export.get("phases", [])
		if int(export.get("preview_phase_count", 0)) != export_phases.size():
			failures.append("preview_bundle_phase_count_mismatch:%s" % String(spellbook_id))
		if int(export.get("preview_bundle_signature_digest", 0)) <= 0:
			failures.append("preview_bundle_digest_missing:%s" % String(spellbook_id))
		var expected_phase_ids: Array[String] = []
		var expected_phase_digests: Array[int] = []
		for exported_phase in export_phases:
			var exported_phase_dict: Dictionary = exported_phase as Dictionary
			var exported_preview: Dictionary = exported_phase_dict.get("deterministic_preview", {})
			expected_phase_ids.append(String(exported_phase_dict.get("phase_id", "")))
			expected_phase_digests.append(int(exported_preview.get("signature_digest", 0)))
		if not _arrays_equal_strings(export.get("preview_phase_ids", []), expected_phase_ids):
			failures.append("preview_bundle_phase_ids_mismatch:%s" % String(spellbook_id))
		if not _arrays_equal_ints(export.get("preview_phase_signature_digests", []), expected_phase_digests):
			failures.append("preview_bundle_phase_digests_mismatch:%s" % String(spellbook_id))
		for row in spellbook_model.timeline_rows(String(spellbook_id)):
			var phase_id := String((row as Dictionary).get("phase_id", ""))
			var phase_script: Dictionary = (row as Dictionary).get("phase_script", {})
			var preview_a: Dictionary = spellbook_model.deterministic_phase_preview(String(spellbook_id), phase_id, seed)
			var preview_b: Dictionary = spellbook_model.deterministic_phase_preview(String(spellbook_id), phase_id, seed)
			preview_a["preview_bundle_id"] = String(export.get("preview_bundle_id", ""))
			preview_a["preview_bundle_signature_digest"] = int(export.get("preview_bundle_signature_digest", 0))
			preview_a["preview_phase_count"] = int(export.get("preview_phase_count", 0))
			preview_b["preview_bundle_id"] = String(export.get("preview_bundle_id", ""))
			preview_b["preview_bundle_signature_digest"] = int(export.get("preview_bundle_signature_digest", 0))
			preview_b["preview_phase_count"] = int(export.get("preview_phase_count", 0))
			preview_count += 1
			if String(preview_a.get("preview_authority_scope", "")) != "local_practice_preview_only":
				failures.append("preview_authority_scope:%s" % phase_id)
			if String(phase_script.get("license", "")).is_empty() or String(phase_script.get("provenance", "")).is_empty():
				failures.append("script_missing_provenance:%s" % phase_id)
			if int(phase_script.get("timeout_ticks", 0)) <= 0 or int(phase_script.get("enrage_after_ticks", 0)) <= 0:
				failures.append("script_missing_timeout_enrage:%s" % phase_id)
			if int(phase_script.get("bullet_cap_per_tick", 0)) <= 0:
				failures.append("script_missing_bullet_cap:%s" % phase_id)
			if String(preview_a.get("signature", "")) != String(preview_b.get("signature", "")):
				failures.append("preview_not_reproducible:%s" % phase_id)
			if int(preview_a.get("signature_digest", 0)) <= 0 or int(preview_a.get("signature_digest", 0)) != int(preview_b.get("signature_digest", 0)):
				failures.append("preview_digest_not_reproducible:%s" % phase_id)
			if int(preview_a.get("max_emit_per_tick", 0)) > int(preview_a.get("bullet_cap_per_tick", 0)):
				failures.append("preview_bullet_cap:%s:%d" % [phase_id, int(preview_a.get("max_emit_per_tick", 0))])
			var fixture_id := "%s:%s:%d" % [String(spellbook_id), phase_id, seed]
			if not golden_fixtures.has(fixture_id):
				failures.append("missing_golden_preview:%s" % fixture_id)
			else:
				var fixture: Dictionary = golden_fixtures[fixture_id]
				golden_preview_count += 1
				seen_fixture_ids.append(fixture_id)
				if int(preview_a.get("signature_digest", 0)) != int(fixture.get("signature_digest", 0)):
					failures.append("golden_preview_digest:%s:%d" % [phase_id, int(preview_a.get("signature_digest", 0))])
				if String(fixture.get("preview_authority_scope", "")) != "local_practice_preview_only":
					failures.append("golden_preview_authority_scope:%s" % phase_id)
				if String(fixture.get("preview_fixture_id", "")) != String(preview_a.get("preview_fixture_id", "")) \
						or String(fixture.get("preview_fixture_id", "")) != fixture_id:
					failures.append("golden_preview_fixture_id:%s:%s" % [phase_id, fixture_id])
				if String(fixture.get("export_id", "")) != String(preview_a.get("export_id", "")):
					failures.append("golden_preview_export_id:%s:%s" % [phase_id, fixture_id])
				if (preview_a.get("samples", []) as Array).size() != int(fixture.get("sample_count", 0)):
					failures.append("golden_preview_samples:%s" % phase_id)
				if int(preview_a.get("max_emit_per_tick", 0)) != int(fixture.get("max_emit_per_tick", 0)):
					failures.append("golden_preview_max_emit:%s:%d" % [phase_id, int(preview_a.get("max_emit_per_tick", 0))])
				if int(preview_a.get("bullet_cap_per_tick", 0)) != int(fixture.get("bullet_cap_per_tick", 0)):
					failures.append("golden_preview_cap:%s:%d" % [phase_id, int(preview_a.get("bullet_cap_per_tick", 0))])
				if int(preview_a.get("budget_headroom", 0)) != int(fixture.get("budget_headroom", 0)):
					failures.append("golden_preview_headroom:%s:%d" % [phase_id, int(preview_a.get("budget_headroom", 0))])
				if not _arrays_equal_ints(preview_a.get("sample_emit_counts", []), fixture.get("sample_emit_counts", [])):
					failures.append("golden_preview_sample_emit_counts:%s" % phase_id)
			if pattern_lab_model != null and pattern_lab_model.has_method("rows_for_spellbook_phase"):
				var lab_rows: Array = pattern_lab_model.rows_for_spellbook_phase("boss_spellbook", phase_id, String(spellbook_id), seed)
				if lab_rows.is_empty():
					failures.append("pattern_lab_missing_phase:%s" % phase_id)
				else:
					var coverage: Dictionary = lab_rows[0]
					if String(coverage.get("catalog_id", "")) != "boss_spellbook" or String(coverage.get("phase_id", "")) != phase_id:
						failures.append("pattern_lab_bad_phase:%s" % phase_id)
					if String(coverage.get("deterministic_preview_signature", "")).is_empty():
						failures.append("pattern_lab_missing_preview:%s" % phase_id)
					if int(coverage.get("deterministic_preview_digest", 0)) != int(preview_a.get("signature_digest", 0)):
						failures.append("pattern_lab_digest_mismatch:%s" % phase_id)
					if String(coverage.get("preview_fixture_id", "")) != String(preview_a.get("preview_fixture_id", "")):
						failures.append("pattern_lab_fixture_mismatch:%s" % phase_id)
					if String(coverage.get("preview_authority_scope", "")) != String(preview_a.get("preview_authority_scope", "")):
						failures.append("pattern_lab_authority_scope_mismatch:%s" % phase_id)
					if String(coverage.get("preview_bundle_id", "")) != String(export.get("preview_bundle_id", "")):
						failures.append("pattern_lab_bundle_id_mismatch:%s" % phase_id)
					if int(coverage.get("preview_bundle_signature_digest", 0)) != int(export.get("preview_bundle_signature_digest", 0)):
						failures.append("pattern_lab_bundle_digest_mismatch:%s" % phase_id)
					if int(coverage.get("preview_phase_count", 0)) != int(export.get("preview_phase_count", 0)):
						failures.append("pattern_lab_bundle_phase_count_mismatch:%s" % phase_id)
					if int(coverage.get("max_preview_emit", 0)) != int(preview_a.get("max_emit_per_tick", 0)):
						failures.append("pattern_lab_max_emit_mismatch:%s" % phase_id)
					if int(coverage.get("preview_budget_headroom", 0)) != int(preview_a.get("budget_headroom", 0)):
						failures.append("pattern_lab_headroom_mismatch:%s" % phase_id)
					if String(coverage.get("performance_budget_status", "")) != String(preview_a.get("performance_budget_status", "")):
						failures.append("pattern_lab_budget_status_mismatch:%s" % phase_id)
					if not _arrays_equal_ints(coverage.get("preview_sample_ticks", []), preview_a.get("sample_ticks", [])):
						failures.append("pattern_lab_sample_ticks_mismatch:%s" % phase_id)
					if int(coverage.get("preview_sample_window_start_tick", -1)) != int(preview_a.get("sample_window_start_tick", -2)):
						failures.append("pattern_lab_sample_window_start_mismatch:%s" % phase_id)
					if int(coverage.get("preview_sample_window_end_tick", -1)) != int(preview_a.get("sample_window_end_tick", -2)):
						failures.append("pattern_lab_sample_window_end_mismatch:%s" % phase_id)
					if int(coverage.get("preview_sample_window_stride_ticks", -1)) != int(preview_a.get("sample_window_stride_ticks", -2)):
						failures.append("pattern_lab_sample_window_stride_mismatch:%s" % phase_id)
					if not _arrays_equal_ints(coverage.get("preview_sample_signature_digests", []), preview_a.get("sample_signature_digests", [])):
						failures.append("pattern_lab_sample_digest_mismatch:%s" % phase_id)
					if not _arrays_equal_ints(coverage.get("preview_sample_emit_counts", []), preview_a.get("sample_emit_counts", [])):
						failures.append("pattern_lab_sample_emit_counts_mismatch:%s" % phase_id)
	for fixture_id in golden_fixtures.keys():
		if String(fixture_id).ends_with(":%d" % seed) and not seen_fixture_ids.has(String(fixture_id)):
			failures.append("orphan_golden_preview:%s" % String(fixture_id))
	for fixture_id in golden_bundle_fixtures.keys():
		if String(fixture_id).ends_with(":%d" % seed) and not seen_bundle_fixture_ids.has(String(fixture_id)):
			failures.append("orphan_golden_preview_bundle:%s" % String(fixture_id))
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"preview_count": preview_count,
		"golden_preview_count": golden_preview_count,
		"golden_bundle_count": golden_bundle_count,
	}

static func validate_open_source_recipes() -> Dictionary:
	var failures: Array[String] = []
	var catalog_types := all_catalog_pattern_types()
	var allowed_statuses: Array[String] = ["mechanic_syntax_only", "engine_concept_only", "design_reference_only"]
	for recipe in OPEN_SOURCE_RECIPES:
		if String(recipe.get("id", "")).is_empty() or String(recipe.get("source_url", "")).is_empty():
			failures.append("recipe_identity")
		if String(recipe.get("license", "")).is_empty():
			failures.append("missing_license:%s" % String(recipe.get("id", "")))
		if String(recipe.get("provenance", "")).is_empty():
			failures.append("missing_provenance:%s" % String(recipe.get("id", "")))
		if not allowed_statuses.has(String(recipe.get("status", ""))):
			failures.append("unsafe_status:%s" % String(recipe.get("id", "")))
		for pattern_type in recipe.get("mapped_pattern_types", []):
			if not catalog_types.has(String(pattern_type)):
				failures.append("unknown_pattern_type:%s" % String(pattern_type))
	for adapter in OPEN_SOURCE_ADAPTERS:
		for required in ["id", "license", "provenance", "required_fields", "allowed_statuses", "rejected_material"]:
			if not adapter.has(required) or _adapter_field_empty(adapter.get(required, null)):
				failures.append("adapter_missing_%s:%s" % [required, String(adapter.get("id", ""))])
		for blocked in ["direct_copy", "commercial_stage_data", "commercial_audio", "commercial_art"]:
			if not (adapter.get("rejected_material", []) as Array).has(blocked):
				failures.append("adapter_missing_rejection:%s" % blocked)
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"recipe_count": OPEN_SOURCE_RECIPES.size(),
		"adapter_count": OPEN_SOURCE_ADAPTERS.size(),
	}

static func _combined_seen_types(stage_model: RefCounted, spellbook_model: RefCounted = null) -> Array[String]:
	var seen_types: Array[String] = []
	for pattern_type in validate_stage_patterns(stage_model).get("seen_types", []):
		seen_types.append(String(pattern_type))
	if spellbook_model != null and spellbook_model.has_method("spellbook_ids") and spellbook_model.has_method("spellbook_config"):
		for spellbook_id in spellbook_model.spellbook_ids():
			var spellbook: Dictionary = spellbook_model.spellbook_config(String(spellbook_id))
			for phase in spellbook.get("phases", []):
				for pattern in (phase as Dictionary).get("patterns", []):
					var pattern_type := String((pattern as Dictionary).get("type", ""))
					if not pattern_type.is_empty() and not seen_types.has(pattern_type):
						seen_types.append(pattern_type)
	return seen_types

static func _spellbook_has_timeout_enrage(spellbook_model: RefCounted) -> bool:
	if spellbook_model == null or not spellbook_model.has_method("spellbook_ids") or not spellbook_model.has_method("spellbook_config"):
		return false
	for spellbook_id in spellbook_model.spellbook_ids():
		var spellbook: Dictionary = spellbook_model.spellbook_config(String(spellbook_id))
		for phase in spellbook.get("phases", []):
			var phase_dict: Dictionary = phase as Dictionary
			var timeout_ticks := int(phase_dict.get("timeout_ticks", phase_dict.get("duration_ticks", 0)))
			var enrage_after_ticks := int(phase_dict.get("enrage_after_ticks", 0))
			var enrage: Dictionary = phase_dict.get("enrage", {})
			if timeout_ticks > 0 and enrage_after_ticks > 0 and not enrage.is_empty():
				return true
	return false

static func _adapter_field_empty(value: Variant) -> bool:
	if value == null:
		return true
	if typeof(value) == TYPE_ARRAY:
		return (value as Array).is_empty()
	return String(value).is_empty()

static func _stage_sample_by_type(stage_model: RefCounted) -> Dictionary:
	var samples: Dictionary = {}
	if stage_model == null or not stage_model.has_method("stage_ids"):
		return samples
	for stage_id in stage_model.stage_ids():
		for pattern in stage_model.patterns_for_stage(String(stage_id)):
			var pattern_type := String(pattern.get("type", ""))
			if not pattern_type.is_empty() and not samples.has(pattern_type):
				samples[pattern_type] = (pattern as Dictionary).duplicate(true)
	return samples

static func _has_behavior_spawn(bullets: Array[Dictionary], target: Vector2) -> bool:
	var live: Array[Dictionary] = []
	for bullet in bullets:
		live.append((bullet as Dictionary).duplicate(true))
	for step in range(96):
		var result: Dictionary = BulletEngineLib.step_bullets(live, target, step, {
			"allow_hit": false,
			"remove_on_hit": false,
			"bounds": Rect2(Vector2(-4096, -4096), Vector2(8192, 8192)),
		})
		live.clear()
		for bullet in result.get("bullets", []):
			if typeof(bullet) == TYPE_DICTIONARY:
				live.append(bullet as Dictionary)
		if not (result.get("spawned", []) as Array).is_empty():
			return true
	return false

static func _max_behavior_spawned_per_tick(bullets: Array[Dictionary], target: Vector2) -> int:
	var live: Array[Dictionary] = []
	for bullet in bullets:
		live.append((bullet as Dictionary).duplicate(true))
	var max_spawned := 0
	for step in range(120):
		var result: Dictionary = BulletEngineLib.step_bullets(live, target, step, {
			"allow_hit": false,
			"remove_on_hit": false,
			"bounds": Rect2(Vector2(-4096, -4096), Vector2(8192, 8192)),
		})
		max_spawned = maxi(max_spawned, (result.get("spawned", []) as Array).size())
		live.clear()
		for bullet in result.get("bullets", []):
			if typeof(bullet) == TYPE_DICTIONARY:
				live.append(bullet as Dictionary)
	return max_spawned

static func _spellbook_emit_budget_report(spellbook_model: RefCounted, target: Vector2, seed: int) -> Dictionary:
	if spellbook_model == null or not spellbook_model.has_method("spellbook_ids") or not spellbook_model.has_method("emit_tick") or not spellbook_model.has_method("spellbook_config"):
		return {"max_emit_per_tick": 0, "max_phase_id": "", "rows": [], "status": "missing_spellbook_model"}
	var max_emit := 0
	var max_phase_id := ""
	var rows: Array[Dictionary] = []
	for spellbook_id in spellbook_model.spellbook_ids():
		var spellbook: Dictionary = spellbook_model.spellbook_config(String(spellbook_id))
		var phase_start := 0
		for phase in spellbook.get("phases", []):
			var phase_dict: Dictionary = phase as Dictionary
			var phase_id := String(phase_dict.get("id", ""))
			var duration := int(phase_dict.get("duration_ticks", 0))
			var phase_max_emit := 0
			var phase_max_tick := phase_start
			for local_tick in range(phase_start, phase_start + max(1, duration)):
				var emitted: Array[Dictionary] = spellbook_model.emit_tick(String(spellbook_id), local_tick, target, 9000 + local_tick, seed)
				if emitted.size() > phase_max_emit:
					phase_max_emit = emitted.size()
					phase_max_tick = local_tick
				if emitted.size() > max_emit:
					max_emit = emitted.size()
					max_phase_id = phase_id
			var phase_bullet_cap := _spellbook_phase_bullet_cap(spellbook_model, String(spellbook_id), phase_dict)
			rows.append({
				"spellbook_id": String(spellbook_id),
				"phase_id": phase_id,
				"max_emit_per_tick": phase_max_emit,
				"max_emit_local_tick": phase_max_tick,
				"bullet_cap_per_tick": phase_bullet_cap,
				"budget_headroom": phase_bullet_cap - phase_max_emit,
				"performance_budget_status": "within_budget" if phase_max_emit <= phase_bullet_cap else "over_budget",
			})
			phase_start += duration
	return {
		"max_emit_per_tick": max_emit,
		"max_phase_id": max_phase_id,
		"rows": rows,
		"status": "within_budget" if max_emit <= MAX_SPELLBOOK_EMIT_BULLETS_PER_TICK else "over_budget",
	}

static func _spellbook_phase_bullet_cap(spellbook_model: RefCounted, spellbook_id: String, phase: Dictionary) -> int:
	if spellbook_model != null and spellbook_model.has_method("phase_script_config"):
		var phase_script: Dictionary = spellbook_model.phase_script_config(spellbook_id, String(phase.get("id", "")))
		if int(phase_script.get("bullet_cap_per_tick", 0)) > 0:
			return int(phase_script.get("bullet_cap_per_tick", 0))
	var inline_script: Dictionary = phase.get("phase_script", {})
	if int(inline_script.get("bullet_cap_per_tick", 0)) > 0:
		return int(inline_script.get("bullet_cap_per_tick", 0))
	return MAX_SPELLBOOK_EMIT_BULLETS_PER_TICK

static func _arrays_equal_ints(left: Variant, right: Variant) -> bool:
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

static func _arrays_equal_strings(left: Variant, right: Variant) -> bool:
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

static func _has_shaped_laser(bullets: Array[Dictionary]) -> bool:
	for bullet in bullets:
		var shape := String(bullet.get("shape", "circle"))
		if shape in ["laser", "capsule", "polyline_laser", "curve_laser"]:
			return true
	return false

static func _has_continuous_graze(bullets: Array[Dictionary]) -> bool:
	for bullet in bullets:
		var behavior: Dictionary = bullet.get("behavior", {})
		if bool(behavior.get("continuous_graze", false)) and int(behavior.get("graze_cooldown_ticks", 0)) > 0:
			return true
	return false

static func _requires_seed_variation(pattern_type: String) -> bool:
	return pattern_type in ["random_arc", "grid_rain", "edge_spawn", "converge_cloud", "vortex_field", "trap_marker"]

static func _bullet_signature(bullets: Array[Dictionary]) -> String:
	var parts: Array[String] = []
	for bullet in bullets:
		var pos: Vector2 = bullet.get("pos", Vector2.ZERO)
		var vel: Vector2 = bullet.get("vel", Vector2.ZERO)
		var behavior: Dictionary = bullet.get("behavior", {})
		parts.append("%s:%d:%s:%s:%.3f:%.3f:%.3f:%.3f:%.3f:%s:%s:%d" % [
			String(bullet.get("pattern_id", "")),
			int(bullet.get("spawn_index", 0)),
			String(bullet.get("shape", "circle")),
			String(bullet.get("color_name", "")),
			pos.x,
			pos.y,
			vel.x,
			vel.y,
			float(bullet.get("radius", 0.0)),
			String(behavior.get("type", "")),
			String(behavior.get("aim_mode", "")),
			int((bullet.get("points", []) as Array).size()) if typeof(bullet.get("points", [])) == TYPE_ARRAY else 0,
		])
	return "|".join(parts)
