class_name BossPatternCatalog
extends RefCounted

const FAMILIES: Array[Dictionary] = [
	{
		"id": "radial",
		"label": "radial rings and spirals",
		"official_coverage": ["even_ring", "odd_even_ring", "spiral", "multi_layer_spiral", "safe_gap_ring", "speed_morph_ring", "stop_release_ring", "returning_ring", "orbit_release", "phase_shift_ring", "growing_orb_ring"],
		"pattern_types": ["ring", "gap_ring", "alternating_ring", "spiral_stack", "morph_ring", "flower", "stop_release", "boomerang_ring", "orbit_release", "phase_shift_ring", "scale_pulse_ring"],
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
		"mapped_pattern_types": ["gap_ring", "spiral_stack", "curve_fan", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser", "summoner_orbit", "path_emitters", "path_follow", "bezier_follow", "trail_emitters", "stop_release", "delayed_aim_ring", "orbit_release", "phase_shift_ring", "scale_pulse_ring", "telegraph_burst", "charge_burst", "trap_marker"],
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
