class_name BossPatternCatalog
extends RefCounted

const BulletEngineLib := preload("res://scripts/bullet_engine.gd")
const BulletPatterns := preload("res://scripts/bullet_pattern_library.gd")

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
		"source_url": "https://github.com/taisei-project/taisei",
		"status": "mechanic_syntax_only",
		"mapped_pattern_types": ["gap_ring", "spiral_stack", "curve_fan", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser", "summoner_orbit", "path_emitters", "path_follow", "bezier_follow", "trail_emitters", "accel_ring", "stop_release", "delayed_aim_ring", "orbit_release", "phase_shift_ring", "scale_pulse_ring", "telegraph_burst", "charge_burst", "trap_marker"],
		"notes": "Use only broad mechanism categories such as scripted bosses, bullet helpers, warnings, and lasers; do not copy stages, names, assets, or full spell layouts.",
	},
	{
		"id": "danmaku_unity_engine_syntax",
		"project": "DanmakU / Danmokou-style Unity bullet scripting",
		"license": "MIT-family open-source engine examples",
		"source_url": "https://github.com/search?q=DanmakU+danmokou&type=repositories",
		"status": "engine_concept_only",
		"mapped_pattern_types": ["morph_ring", "grid_rain", "converge_cloud", "vortex_field", "snake_stream", "edge_spawn", "gate_lanes", "trap_marker"],
		"notes": "Port the concept of composable bullet equations and deterministic parameters, not any authored pattern script.",
	},
	{
		"id": "godot_bullet_hell_tooling",
		"project": "Godot open-source bullet hell tooling",
		"license": "project-specific open-source licenses; verify before direct asset/code reuse",
		"source_url": "https://github.com/search?q=Godot+bullet+hell+engine&type=repositories",
		"status": "design_reference_only",
		"mapped_pattern_types": ["wall_bounce", "beam_sweep", "reflect_laser", "alternating_ring", "boomerang_ring"],
		"notes": "Keep this repo implementation original; use references only for feature checklist ideas such as pooling, shape hit tests, and editor-friendly recipes.",
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

static func boss_type_requirement_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for requirement in BOSS_TYPE_REQUIREMENTS:
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

static func validate_open_source_recipes() -> Dictionary:
	var failures: Array[String] = []
	var catalog_types := all_catalog_pattern_types()
	for recipe in OPEN_SOURCE_RECIPES:
		if String(recipe.get("id", "")).is_empty() or String(recipe.get("source_url", "")).is_empty():
			failures.append("recipe_identity")
		if String(recipe.get("status", "")) == "direct_copy":
			failures.append("direct_copy_not_allowed")
		for pattern_type in recipe.get("mapped_pattern_types", []):
			if not catalog_types.has(String(pattern_type)):
				failures.append("unknown_pattern_type:%s" % String(pattern_type))
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"recipe_count": OPEN_SOURCE_RECIPES.size(),
	}

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
