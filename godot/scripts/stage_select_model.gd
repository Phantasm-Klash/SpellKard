class_name StageSelectModel
extends RefCounted

const DEFAULT_STAGE_ID := "starlit_lanes"
const DEFAULT_PRACTICE_SEED := 20260625

var stages: Array[Dictionary] = []
var stage_by_id: Dictionary = {}
var selected_stage_id := DEFAULT_STAGE_ID
var selected_pattern_index := 0
var last_action_status := "none"
var last_error_code := "none"

func _init() -> void:
	stages = _build_stages()
	_rebuild_index()

func select_stage(stage_id: String) -> bool:
	if not stage_by_id.has(stage_id):
		last_action_status = "failed"
		last_error_code = "stage_missing"
		return false
	selected_stage_id = stage_id
	selected_pattern_index = 0
	last_action_status = "stage_selected"
	last_error_code = "none"
	return true

func cycle_stage(delta: int = 1) -> String:
	var ids := stage_ids()
	if ids.is_empty():
		return selected_stage_id
	var index := ids.find(selected_stage_id)
	if index < 0:
		index = 0
	select_stage(ids[wrapi(index + delta, 0, ids.size())])
	last_action_status = "stage_cycled"
	return selected_stage_id

func select_pattern_index(index: int) -> bool:
	var patterns := active_patterns()
	if patterns.is_empty():
		last_action_status = "failed"
		last_error_code = "patterns_empty"
		return false
	selected_pattern_index = clampi(index, 0, patterns.size() - 1)
	last_action_status = "pattern_selected"
	last_error_code = "none"
	return true

func cycle_pattern(delta: int = 1) -> int:
	var patterns := active_patterns()
	if patterns.is_empty():
		selected_pattern_index = 0
		return selected_pattern_index
	selected_pattern_index = wrapi(selected_pattern_index + delta, 0, patterns.size())
	last_action_status = "pattern_cycled"
	last_error_code = "none"
	return selected_pattern_index

func active_stage() -> Dictionary:
	return stage_config(selected_stage_id)

func stage_config(stage_id: String) -> Dictionary:
	if not stage_by_id.has(stage_id):
		return {}
	return (stage_by_id[stage_id] as Dictionary).duplicate(true)

func active_patterns() -> Array[Dictionary]:
	return patterns_for_stage(selected_stage_id)

func patterns_for_stage(stage_id: String) -> Array[Dictionary]:
	var stage := stage_config(stage_id)
	var rows: Array[Dictionary] = []
	var pattern_value: Variant = stage.get("patterns", [])
	if typeof(pattern_value) != TYPE_ARRAY:
		return rows
	for item in pattern_value as Array:
		if typeof(item) == TYPE_DICTIONARY:
			rows.append((item as Dictionary).duplicate(true))
	return rows

func active_pattern() -> Dictionary:
	var patterns := active_patterns()
	if patterns.is_empty():
		return {}
	return patterns[clampi(selected_pattern_index, 0, patterns.size() - 1)].duplicate(true)

func stage_ids() -> Array[String]:
	var ids: Array[String] = []
	for stage in stages:
		ids.append(str(stage.get("id", "")))
	return ids

func stage_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for stage in stages:
		var stage_id := str(stage.get("id", ""))
		var patterns: Array = stage.get("patterns", [])
		rows.append({
			"id": "stage_%s" % stage_id,
			"stage_id": stage_id,
			"label_key": str(stage.get("name_key", "")),
			"difficulty": int(stage.get("difficulty", 1)),
			"tempo": str(stage.get("tempo", "")),
			"recommended_character": str(stage.get("recommended_character", "")),
			"pattern_count": patterns.size(),
			"pattern_types": _pattern_types(patterns),
			"selected": stage_id == selected_stage_id,
			"enabled": true,
		})
	return rows

func pattern_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var patterns := active_patterns()
	for i in range(patterns.size()):
		var pattern := patterns[i]
		rows.append({
			"id": "stage_pattern_%s" % str(pattern.get("id", i)),
			"pattern_id": str(pattern.get("id", "")),
			"label_key": str(pattern.get("name_key", "")),
			"name": str(pattern.get("name", pattern.get("id", ""))),
			"pattern_type": str(pattern.get("type", "")),
			"interval_ticks": int(pattern.get("interval_ticks", 0)),
			"count": int(pattern.get("count", 0)),
			"speed": float(pattern.get("speed", 0.0)),
			"selected": i == selected_pattern_index,
			"enabled": true,
		})
	return rows

func briefing_rows(pattern_lab_model: RefCounted = null) -> Array[Dictionary]:
	var stage := active_stage()
	if stage.is_empty():
		return []
	var stage_id := String(stage.get("id", ""))
	var patterns := active_patterns()
	var lab_rows: Array[Dictionary] = []
	if pattern_lab_model != null and pattern_lab_model.has_method("rows_for_stage"):
		var lab_value: Variant = pattern_lab_model.rows_for_stage(stage_id)
		if typeof(lab_value) == TYPE_ARRAY:
			for item in lab_value as Array:
				if typeof(item) == TYPE_DICTIONARY:
					lab_rows.append((item as Dictionary).duplicate(true))
	var route_steps := _route_steps(patterns, lab_rows)
	var math_basis_route := _string_unique_from_steps(route_steps, "math_basis")
	var math_families := _string_unique_from_steps(route_steps, "math_family")
	var readability_hints := _string_unique_from_steps(route_steps, "readability_hint")
	return [
		{
			"id": "stage_briefing",
			"label_key": "screen.settings.stage_select",
			"brief_stage_id": stage_id,
			"difficulty": int(stage.get("difficulty", 1)),
			"tempo": String(stage.get("tempo", "")),
			"recommended_character_id": String(stage.get("recommended_character", "")),
			"pattern_count": patterns.size(),
			"pattern_types": _pattern_types(patterns),
			"enabled": true,
		},
		{
			"id": "stage_math_route",
			"label_key": "screen.settings.pattern_lab",
			"brief_stage_id": stage_id,
			"route_steps": route_steps,
			"math_basis_route": math_basis_route,
			"math_families": math_families,
			"readability_hints": readability_hints,
			"density_peak": _peak_band(route_steps, "density_estimate", ["low", "medium", "high", "extreme"]),
			"danger_peak": _peak_band(route_steps, "danger_estimate", ["low", "medium", "high", "severe"]),
			"spawn_peak_per_second": _peak_float(route_steps, "spawn_rate_per_second"),
			"enabled": true,
		},
		{
			"id": "stage_recommended_character",
			"label_key": "screen.settings.character",
			"brief_stage_id": stage_id,
			"recommended_character_id": String(stage.get("recommended_character", "")),
			"ui_action": "apply_recommended_character",
			"enabled": not String(stage.get("recommended_character", "")).is_empty(),
		},
		_practice_plan_row(stage, patterns, route_steps),
	]

func practice_plan_row(pattern_lab_model: RefCounted = null) -> Dictionary:
	var rows := briefing_rows(pattern_lab_model)
	for row in rows:
		if String(row.get("id", "")) == "stage_practice_plan":
			return row.duplicate(true)
	return {}

func practice_preset_rows(pattern_lab_model: RefCounted = null) -> Array[Dictionary]:
	var stage := active_stage()
	if stage.is_empty():
		return []
	var stage_id := String(stage.get("id", ""))
	var patterns := active_patterns()
	var lab_rows: Array[Dictionary] = []
	if pattern_lab_model != null and pattern_lab_model.has_method("rows_for_stage"):
		var lab_value: Variant = pattern_lab_model.rows_for_stage(stage_id)
		if typeof(lab_value) == TYPE_ARRAY:
			for item in lab_value as Array:
				if typeof(item) == TYPE_DICTIONARY:
					lab_rows.append((item as Dictionary).duplicate(true))
	var route_steps := _route_steps(patterns, lab_rows)
	return _practice_preset_rows(stage, patterns, route_steps)

func summary() -> String:
	var stage := active_stage()
	var pattern := active_pattern()
	return "%s d%d %s pattern %d/%d %s" % [
		selected_stage_id,
		int(stage.get("difficulty", 0)),
		str(stage.get("tempo", "")),
		selected_pattern_index + 1,
		active_patterns().size(),
		str(pattern.get("id", "-")),
	]

func practice_plan_summary(pattern_lab_model: RefCounted = null) -> String:
	var row := practice_plan_row(pattern_lab_model)
	if row.is_empty():
		return "no stage plan"
	var phase_ids: Array = row.get("phase_pattern_ids", [])
	var basis_route: Array = row.get("math_basis_route", [])
	return "%s phases %d route %s rec %s" % [
		String(row.get("stage_id", selected_stage_id)),
		phase_ids.size(),
		" > ".join(basis_route),
		String(row.get("recommended_character_id", "")),
	]

func _pattern_types(patterns: Array) -> Array[String]:
	var types: Array[String] = []
	for item in patterns:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var pattern := item as Dictionary
		var pattern_type := str(pattern.get("type", ""))
		if not types.has(pattern_type):
			types.append(pattern_type)
	return types

func _route_steps(patterns: Array[Dictionary], lab_rows: Array[Dictionary]) -> Array[Dictionary]:
	var lab_by_pattern: Dictionary = {}
	for lab in lab_rows:
		lab_by_pattern[String(lab.get("pattern_id", ""))] = lab
	var steps: Array[Dictionary] = []
	for pattern in patterns:
		var pattern_id := String(pattern.get("id", ""))
		var lab: Dictionary = lab_by_pattern.get(pattern_id, {})
		steps.append({
			"pattern_id": pattern_id,
			"pattern_type": String(pattern.get("type", "")),
			"math_basis": String(lab.get("math_basis", String(pattern.get("type", "")))),
			"math_family": String(lab.get("math_family", "unknown")),
			"density_estimate": String(lab.get("density_estimate", "unknown")),
			"danger_estimate": String(lab.get("danger_estimate", "unknown")),
			"readability_hint": String(lab.get("readability_hint", "")),
			"spawn_rate_per_second": float(lab.get("spawn_rate_per_second", 0.0)),
		})
	return steps

func _string_unique_from_steps(steps: Array[Dictionary], key: String) -> Array[String]:
	var values: Array[String] = []
	for step in steps:
		var value := String(step.get(key, ""))
		if not value.is_empty() and not values.has(value):
			values.append(value)
	return values

func _peak_band(steps: Array[Dictionary], key: String, order: Array[String]) -> String:
	var peak := ""
	var peak_index := -1
	for step in steps:
		var value := String(step.get(key, ""))
		var index := order.find(value)
		if index > peak_index:
			peak = value
			peak_index = index
	return peak

func _peak_float(steps: Array[Dictionary], key: String) -> float:
	var peak := 0.0
	for step in steps:
		peak = maxf(peak, float(step.get(key, 0.0)))
	return snappedf(peak, 0.01)

func _practice_plan_row(stage: Dictionary, patterns: Array[Dictionary], route_steps: Array[Dictionary]) -> Dictionary:
	var phase_pattern_ids: Array[String] = []
	var phase_labels: Array[String] = []
	for pattern in patterns:
		phase_pattern_ids.append(String(pattern.get("id", "")))
		phase_labels.append(String(pattern.get("name_key", pattern.get("id", ""))))
	var row := _practice_validation_contract("stage_practice_plan", "stage_route")
	row.merge({
		"id": "stage_practice_plan",
		"label_key": "screen.settings.stage_select",
		"stage_id": String(stage.get("id", "")),
		"recommended_character_id": String(stage.get("recommended_character", "")),
		"phase_pattern_ids": phase_pattern_ids,
		"phase_labels": phase_labels,
		"math_basis_route": _string_unique_from_steps(route_steps, "math_basis"),
		"math_families": _string_unique_from_steps(route_steps, "math_family"),
		"readability_hints": _string_unique_from_steps(route_steps, "readability_hint"),
		"density_peak": _peak_band(route_steps, "density_estimate", ["low", "medium", "high", "extreme"]),
		"danger_peak": _peak_band(route_steps, "danger_estimate", ["low", "medium", "high", "severe"]),
		"spawn_peak_per_second": _peak_float(route_steps, "spawn_rate_per_second"),
		"phase_ticks": 600,
		"ui_action": "apply_stage_practice_plan",
		"enabled": patterns.size() > 0,
	}, true)
	return row

func _practice_preset_rows(stage: Dictionary, patterns: Array[Dictionary], route_steps: Array[Dictionary]) -> Array[Dictionary]:
	if patterns.is_empty():
		return []
	var stage_id := String(stage.get("id", ""))
	var recommended_character_id := String(stage.get("recommended_character", ""))
	var all_phase_ids: Array[String] = []
	for pattern in patterns:
		all_phase_ids.append(String(pattern.get("id", "")))
	var peak_index := _peak_step_index(route_steps)
	var peak_step: Dictionary = route_steps[clampi(peak_index, 0, max(0, route_steps.size() - 1))]
	var peak_pattern_id := String(peak_step.get("pattern_id", all_phase_ids[0]))
	var difficulty := int(stage.get("difficulty", 1))
	var route_row := _practice_validation_contract("stage_practice_preset", "full_route")
	route_row.merge({
			"id": "stage_practice_preset_route",
			"label_key": "screen.settings.stage_select",
			"preset_id": "route",
			"preset_kind": "full_route",
			"stage_id": stage_id,
			"recommended_character_id": recommended_character_id,
			"target_pattern_index": 0,
			"phase_pattern_ids": all_phase_ids,
			"phase_ticks": 600,
			"practice_seed": _stable_seed("%s:route" % stage_id),
			"practice_initial_power": _preset_power(difficulty, "route"),
			"practice_initial_bombs": _preset_bombs(difficulty, "route"),
			"math_basis_route": _string_unique_from_steps(route_steps, "math_basis"),
			"focus_math_basis": String(route_steps[0].get("math_basis", "")),
			"focus_pattern_id": all_phase_ids[0],
			"focus_reason": "learn_route_order",
			"density_peak": _peak_band(route_steps, "density_estimate", ["low", "medium", "high", "extreme"]),
			"danger_peak": _peak_band(route_steps, "danger_estimate", ["low", "medium", "high", "severe"]),
			"spawn_peak_per_second": _peak_float(route_steps, "spawn_rate_per_second"),
			"ui_action": "apply_stage_practice_preset",
			"enabled": true,
	}, true)
	var peak_row := _practice_validation_contract("stage_practice_preset", "danger_peak")
	peak_row.merge({
			"id": "stage_practice_preset_peak",
			"label_key": "screen.settings.stage_select",
			"preset_id": "peak",
			"preset_kind": "danger_peak",
			"stage_id": stage_id,
			"recommended_character_id": recommended_character_id,
			"target_pattern_index": peak_index,
			"phase_pattern_ids": [peak_pattern_id],
			"phase_ticks": 900,
			"practice_seed": _stable_seed("%s:peak:%s" % [stage_id, peak_pattern_id]),
			"practice_initial_power": _preset_power(difficulty, "peak"),
			"practice_initial_bombs": _preset_bombs(difficulty, "peak"),
			"math_basis_route": [String(peak_step.get("math_basis", ""))],
			"focus_math_basis": String(peak_step.get("math_basis", "")),
			"focus_pattern_id": peak_pattern_id,
			"focus_reason": "danger_peak_repeat",
			"density_peak": String(peak_step.get("density_estimate", "")),
			"danger_peak": String(peak_step.get("danger_estimate", "")),
			"spawn_peak_per_second": float(peak_step.get("spawn_rate_per_second", 0.0)),
			"ui_action": "apply_stage_practice_preset",
			"enabled": true,
	}, true)
	var survival_row := _practice_validation_contract("stage_practice_preset", "low_resource")
	survival_row.merge({
			"id": "stage_practice_preset_survival",
			"label_key": "screen.settings.stage_select",
			"preset_id": "survival",
			"preset_kind": "low_resource",
			"stage_id": stage_id,
			"recommended_character_id": recommended_character_id,
			"target_pattern_index": peak_index,
			"phase_pattern_ids": all_phase_ids,
			"phase_ticks": 720,
			"practice_seed": _stable_seed("%s:survival:%s" % [stage_id, peak_pattern_id]),
			"practice_initial_power": _preset_power(difficulty, "survival"),
			"practice_initial_bombs": _preset_bombs(difficulty, "survival"),
			"math_basis_route": _string_unique_from_steps(route_steps, "math_basis"),
			"focus_math_basis": String(peak_step.get("math_basis", "")),
			"focus_pattern_id": peak_pattern_id,
			"focus_reason": "low_resource_survival",
			"density_peak": _peak_band(route_steps, "density_estimate", ["low", "medium", "high", "extreme"]),
			"danger_peak": _peak_band(route_steps, "danger_estimate", ["low", "medium", "high", "severe"]),
			"spawn_peak_per_second": _peak_float(route_steps, "spawn_rate_per_second"),
			"ui_action": "apply_stage_practice_preset",
			"enabled": true,
	}, true)
	return [route_row, peak_row, survival_row]

func _practice_validation_contract(entry_kind: String, preset_kind: String) -> Dictionary:
	return {
		"practice_entry_kind": entry_kind,
		"practice_validation_kind": "stage_practice_local_verification",
		"practice_validation_status": "local_practice_ready",
		"practice_preset_kind": preset_kind,
		"projection_scope": "local_practice_only",
		"local_practice_authority": "client_local_practice",
		"replay_verification_scope": "local_practice_hash",
		"local_hash_authority": "local_practice_verification_only",
		"online_result_authority": "server_settlement_required",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"boss_hp_authority": "server",
		"server_authoritative": false,
		"client_result_authoritative": false,
		"requires_server_confirmation": false,
		"server_confirmation_status": "not_applicable_local_practice",
		"practice_replay_metadata_ready": true,
		"server_required_for": ["damage", "reward", "settlement", "boss_hp"],
	}

func _peak_step_index(route_steps: Array[Dictionary]) -> int:
	var best_index := 0
	var best_score := -1.0
	var danger_order := ["low", "medium", "high", "severe"]
	var density_order := ["low", "medium", "high", "extreme"]
	for i in range(route_steps.size()):
		var step := route_steps[i]
		var danger_score := float(max(0, danger_order.find(String(step.get("danger_estimate", ""))))) * 10.0
		var density_score := float(max(0, density_order.find(String(step.get("density_estimate", ""))))) * 3.0
		var spawn_score := float(step.get("spawn_rate_per_second", 0.0)) / 20.0
		var score := danger_score + density_score + spawn_score
		if score > best_score:
			best_score = score
			best_index = i
	return best_index

func _preset_power(difficulty: int, preset_id: String) -> float:
	match preset_id:
		"route":
			return clampf(1.0 + float(difficulty) * 0.25, 1.0, 3.0)
		"peak":
			return clampf(2.0 + float(difficulty) * 0.20, 2.0, 3.5)
		"survival":
			return clampf(0.5 + float(max(0, difficulty - 2)) * 0.25, 0.5, 1.25)
		_:
			return 1.0

func _preset_bombs(difficulty: int, preset_id: String) -> int:
	match preset_id:
		"route":
			return clampi(3 + int(difficulty >= 4), 3, 4)
		"peak":
			return clampi(4, 3, 4)
		"survival":
			return 1
		_:
			return 3

func _stable_seed(text: String) -> int:
	var result := 2166136261
	for value in text.to_utf8_buffer():
		result = int((result ^ int(value)) * 16777619) & 0x7fffffff
	return (result ^ DEFAULT_PRACTICE_SEED) & 0x7fffffff

func _rebuild_index() -> void:
	stage_by_id.clear()
	for stage in stages:
		stage_by_id[str(stage.get("id", ""))] = stage

func _build_stages() -> Array[Dictionary]:
	return [
		{
			"id": "starlit_lanes",
			"name_key": "stage.starlit_lanes.name",
			"difficulty": 1,
			"tempo": "steady",
			"recommended_character": "balanced",
			"patterns": [
				{
					"id": "spiral_ring",
					"name": "Ring spiral",
					"name_key": "pattern.spiral_ring.name",
					"type": "ring",
					"origin": Vector2(480, 120),
					"interval_ticks": 16,
					"count": 18,
					"speed": 128.0,
					"radius": 5.0,
					"spin_per_tick": 0.035,
					"color": "red",
				},
				{
					"id": "aimed_fan",
					"name": "Aimed n-way",
					"name_key": "pattern.aimed_fan.name",
					"type": "n_way",
					"origin": Vector2(480, 120),
					"interval_ticks": 24,
					"count": 7,
					"speed": 170.0,
					"radius": 5.0,
					"spread": deg_to_rad(52.0),
					"color": "cyan",
				},
				{
					"id": "petal_weave",
					"name": "Petal weave",
					"name_key": "pattern.petal_weave.name",
					"type": "flower",
					"origin": Vector2(480, 118),
					"interval_ticks": 20,
					"petals": 6,
					"layers": 2,
					"speed": 116.0,
					"speed_step": 18.0,
					"radius": 4.5,
					"spin_per_tick": 0.030,
					"color": "green",
				},
			],
		},
		{
			"id": "misty_crossfire",
			"name_key": "stage.misty_crossfire.name",
			"difficulty": 2,
			"tempo": "syncopated",
			"recommended_character": "wide",
			"patterns": [
				{
					"id": "seeded_arc",
					"name": "Seeded random arc",
					"name_key": "pattern.seeded_arc.name",
					"type": "random_arc",
					"origin": Vector2(480, 112),
					"interval_ticks": 18,
					"count": 9,
					"speed": 128.0,
					"speed_jitter": 44.0,
					"radius": 4.5,
					"angle_offset": PI * 0.5,
					"spread": deg_to_rad(116.0),
					"color": "gold",
				},
				{
					"id": "split_fan",
					"name": "Split chain",
					"name_key": "pattern.split_fan.name",
					"type": "split_chain",
					"origin": Vector2(480, 116),
					"interval_ticks": 56,
					"count": 5,
					"speed": 112.0,
					"radius": 5.5,
					"spread": deg_to_rad(42.0),
					"split_delay_ticks": 48,
					"split_count": 8,
					"split_speed": 92.0,
					"split_color": "violet",
					"color": "white",
				},
				{
					"id": "sine_stream",
					"name": "Sine stream",
					"name_key": "pattern.sine_stream.name",
					"type": "sine_stream",
					"origin": Vector2(480, 96),
					"interval_ticks": 10,
					"count": 3,
					"speed": 138.0,
					"radius": 4.5,
					"spread": deg_to_rad(34.0),
					"wave_amplitude": 42.0,
					"wave_period_ticks": 72,
					"color": "cyan",
				},
				{
					"id": "snake_stream",
					"name": "Snake stream",
					"name_key": "pattern.snake_stream.name",
					"type": "snake_stream",
					"origin": Vector2(480, 100),
					"interval_ticks": 18,
					"count": 4,
					"speed": 122.0,
					"radius": 4.3,
					"spread": deg_to_rad(32.0),
					"snake_amplitude": deg_to_rad(17.0),
					"wave_period_ticks": 76,
					"wave_phase_step": PI,
					"spawn_wave_per_tick": 0.08,
					"lifetime_ticks": 260,
					"color": "green",
				},
			],
		},
		{
			"id": "clockwork_bloom",
			"name_key": "stage.clockwork_bloom.name",
			"difficulty": 3,
			"tempo": "delayed",
			"recommended_character": "precision",
			"patterns": [
				{
					"id": "slow_blossom",
					"name": "Delayed blossom",
					"name_key": "pattern.slow_blossom.name",
					"type": "blossom",
					"origin": Vector2(480, 92),
					"interval_ticks": 72,
					"speed": 84.0,
					"radius": 6.5,
					"count": 24,
					"blossom_delay_ticks": 58,
					"blossom_speed": 118.0,
					"spin_per_tick": 0.024,
					"color": "green",
					"blossom_color": "gold",
				},
				{
					"id": "curved_homing",
					"name": "Limited homing",
					"name_key": "pattern.curved_homing.name",
					"type": "homing",
					"origin": Vector2(480, 112),
					"interval_ticks": 34,
					"count": 4,
					"speed": 94.0,
					"radius": 5.0,
					"spread": deg_to_rad(70.0),
					"turn_rate": deg_to_rad(2.0),
					"lifetime_ticks": 132,
					"color": "violet",
				},
				{
					"id": "laser_curtain",
					"name": "Laser curtain",
					"name_key": "pattern.laser_curtain.name",
					"type": "laser_curtain",
					"origin": Vector2(480, 88),
					"interval_ticks": 96,
					"count": 7,
					"speed": 150.0,
					"radius": 5.0,
					"spread": deg_to_rad(96.0),
					"warning_ticks": 36,
					"lane_spacing": 34.0,
					"color": "white",
				},
			],
		},
		{
			"id": "lunar_maze",
			"name_key": "stage.lunar_maze.name",
			"difficulty": 4,
			"tempo": "dense",
			"recommended_character": "spell_power",
			"patterns": [
				{
					"id": "orbital_lattice",
					"name": "Orbital lattice",
					"name_key": "pattern.orbital_lattice.name",
					"type": "orbital",
					"origin": Vector2(480, 140),
					"interval_ticks": 18,
					"count": 12,
					"speed": 110.0,
					"radius": 4.5,
					"orbit_radius": 58.0,
					"orbit_spin": 0.08,
					"color": "violet",
				},
				{
					"id": "curtain_wall",
					"name": "Curtain wall",
					"name_key": "pattern.curtain_wall.name",
					"type": "curtain",
					"origin": Vector2(480, 78),
					"interval_ticks": 26,
					"count": 13,
					"speed": 124.0,
					"radius": 4.8,
					"width": 520.0,
					"sway": 28.0,
					"color": "gold",
				},
				{
					"id": "knife_burst",
					"name": "Knife burst",
					"name_key": "pattern.knife_burst.name",
					"type": "burst",
					"origin": Vector2(480, 116),
					"interval_ticks": 44,
					"count": 18,
					"speed": 156.0,
					"speed_step": 5.5,
					"radius": 3.8,
					"spread": deg_to_rad(28.0),
					"color": "white",
				},
			],
		},
		{
			"id": "boss_pattern_archive",
			"name_key": "stage.boss_pattern_archive.name",
			"difficulty": 5,
			"tempo": "boss_archive",
			"recommended_character": "precision",
			"patterns": [
				{
					"id": "archive_spiral_stack",
					"name": "Spiral stack",
					"name_key": "pattern.archive_spiral_stack.name",
					"type": "spiral_stack",
					"origin": Vector2(480, 124),
					"interval_ticks": 22,
					"count": 7,
					"layers": 3,
					"speed": 78.0,
					"speed_step": 24.0,
					"radius": 4.3,
					"spin_per_tick": 0.052,
					"layer_angle_offset": deg_to_rad(10.0),
					"color": "red",
				},
				{
					"id": "archive_alternating_ring",
					"name": "Alternating ring",
					"name_key": "pattern.archive_alternating_ring.name",
					"type": "alternating_ring",
					"origin": Vector2(480, 118),
					"interval_ticks": 30,
					"phase_interval_ticks": 30,
					"count": 26,
					"speed": 112.0,
					"radius": 4.6,
					"color": "gold",
				},
				{
					"id": "archive_gap_ring",
					"name": "Gap ring",
					"name_key": "pattern.archive_gap_ring.name",
					"type": "gap_ring",
					"origin": Vector2(480, 118),
					"interval_ticks": 34,
					"count": 34,
					"speed": 112.0,
					"radius": 4.4,
					"gap_angle": PI * 0.5,
					"gap_width": deg_to_rad(52.0),
					"gap_count": 2,
					"gap_spin_per_tick": 0.012,
					"spin_per_tick": 0.018,
					"color": "gold",
				},
				{
					"id": "archive_accel_ring",
					"name": "Acceleration ring",
					"name_key": "pattern.archive_accel_ring.name",
					"type": "accel_ring",
					"origin": Vector2(480, 112),
					"interval_ticks": 46,
					"count": 22,
					"speed": 54.0,
					"radius": 4.4,
					"acceleration": 1.8,
					"max_speed": 184.0,
					"color": "cyan",
				},
				{
					"id": "archive_curve_fan",
					"name": "Curved fan",
					"name_key": "pattern.archive_curve_fan.name",
					"type": "curve_fan",
					"origin": Vector2(480, 112),
					"interval_ticks": 34,
					"count": 9,
					"speed": 118.0,
					"radius": 4.4,
					"spread": deg_to_rad(62.0),
					"angular_velocity": deg_to_rad(0.42),
					"curve_step": deg_to_rad(0.03),
					"color": "green",
				},
				{
					"id": "archive_grid_rain",
					"name": "Grid rain",
					"name_key": "pattern.archive_grid_rain.name",
					"type": "grid_rain",
					"origin": Vector2(480, 74),
					"interval_ticks": 28,
					"count": 12,
					"rows": 2,
					"speed": 126.0,
					"radius": 4.1,
					"width": 560.0,
					"stagger": 14.0,
					"angle_jitter": deg_to_rad(4.0),
					"color": "white",
				},
				{
					"id": "archive_edge_spawn",
					"name": "Edge spawn",
					"name_key": "pattern.archive_edge_spawn.name",
					"type": "edge_spawn",
					"origin": Vector2(480, 112),
					"interval_ticks": 36,
					"count": 16,
					"speed": 122.0,
					"radius": 4.1,
					"edge": "all",
					"spawn_bounds": Rect2(Vector2(160, 60), Vector2(640, 600)),
					"edge_margin": 18.0,
					"aim_mode": "inward",
					"lane_jitter": 8.0,
					"angle_jitter": deg_to_rad(3.0),
					"color": "white",
				},
				{
					"id": "archive_sweep_laser",
					"name": "Sweep laser",
					"name_key": "pattern.archive_sweep_laser.name",
					"type": "sweep_laser",
					"origin": Vector2(480, 92),
					"interval_ticks": 104,
					"count": 5,
					"speed": 118.0,
					"radius": 5.4,
					"spread": deg_to_rad(70.0),
					"warning_ticks": 36,
					"graze_cooldown_ticks": 18,
					"color": "violet",
				},
				{
					"id": "archive_exploding_star",
					"name": "Exploding star",
					"name_key": "pattern.archive_exploding_star.name",
					"type": "exploding_star",
					"origin": Vector2(480, 92),
					"interval_ticks": 78,
					"speed": 82.0,
					"radius": 6.0,
					"split_delay_ticks": 52,
					"split_count": 14,
					"split_speed": 126.0,
					"split_color": "gold",
					"color": "violet",
				},
				{
					"id": "archive_telegraph_burst",
					"name": "Telegraph burst",
					"name_key": "pattern.archive_telegraph_burst.name",
					"type": "telegraph_burst",
					"origin": Vector2(480, 230),
					"interval_ticks": 92,
					"count": 18,
					"speed": 126.0,
					"radius": 4.1,
					"warning_radius": 11.0,
					"trigger_tick": 42,
					"burst_mode": "ring",
					"spin_per_tick": 0.020,
					"warning_color": "violet",
					"color": "gold",
				},
				{
					"id": "archive_charge_burst",
					"name": "Charge burst",
					"name_key": "pattern.archive_charge_burst.name",
					"type": "charge_burst",
					"origin": Vector2(480, 210),
					"interval_ticks": 118,
					"count": 20,
					"speed": 126.0,
					"radius": 4.1,
					"charge_radius": 8.0,
					"charge_grow": 0.22,
					"max_charge_radius": 18.0,
					"trigger_tick": 50,
					"burst_mode": "ring",
					"burst_spin_per_tick": 0.018,
					"charge_color": "violet",
					"color": "gold",
				},
				{
					"id": "archive_trap_marker",
					"name": "Trap marker",
					"name_key": "pattern.archive_trap_marker.name",
					"type": "trap_marker",
					"origin": Vector2(480, 250),
					"interval_ticks": 104,
					"count": 5,
					"emit_count": 5,
					"speed": 126.0,
					"radius": 4.0,
					"marker_radius": 10.0,
					"placement": "around_player",
					"placement_radius": 92.0,
					"position_jitter": 12.0,
					"trigger_tick": 44,
					"release_mode": "fan",
					"aim_mode": "player",
					"spread": deg_to_rad(36.0),
					"marker_color": "violet",
					"color": "gold",
				},
				{
					"id": "archive_beam_sweep",
					"name": "Beam sweep",
					"name_key": "pattern.archive_beam_sweep.name",
					"type": "beam_sweep",
					"origin": Vector2(480, 118),
					"interval_ticks": 118,
					"count": 3,
					"radius": 4.8,
					"length": 720.0,
					"spread": deg_to_rad(44.0),
					"warning_ticks": 44,
					"graze_cooldown_ticks": 12,
					"spin_per_tick": 0.006,
					"color": "white",
				},
				{
					"id": "archive_rotating_laser",
					"name": "Rotating laser",
					"name_key": "pattern.archive_rotating_laser.name",
					"type": "rotating_laser",
					"origin": Vector2(480, 118),
					"interval_ticks": 150,
					"count": 2,
					"radius": 4.8,
					"length": 700.0,
					"spread": PI,
					"warning_ticks": 42,
					"angular_velocity": deg_to_rad(0.75),
					"graze_cooldown_ticks": 12,
					"lifetime_ticks": 180,
					"color": "white",
				},
				{
					"id": "archive_cross_laser",
					"name": "Cross laser",
					"name_key": "pattern.archive_cross_laser.name",
					"type": "cross_laser",
					"origin": Vector2(480, 118),
					"interval_ticks": 158,
					"arms": 4,
					"radius": 4.8,
					"length": 700.0,
					"warning_ticks": 42,
					"angular_velocity": deg_to_rad(0.32),
					"graze_cooldown_ticks": 12,
					"lifetime_ticks": 184,
					"spin_per_tick": 0.004,
					"color": "white",
				},
				{
					"id": "archive_extend_laser",
					"name": "Extend laser",
					"name_key": "pattern.archive_extend_laser.name",
					"type": "extend_laser",
					"origin": Vector2(480, 118),
					"interval_ticks": 146,
					"count": 3,
					"radius": 4.8,
					"start_length": 28.0,
					"length": 690.0,
					"spread": deg_to_rad(44.0),
					"warning_ticks": 38,
					"extend_duration_ticks": 46,
					"graze_cooldown_ticks": 12,
					"lifetime_ticks": 190,
					"spin_per_tick": 0.004,
					"color": "white",
				},
				{
					"id": "archive_curved_laser",
					"name": "Curved laser",
					"name_key": "pattern.archive_curved_laser.name",
					"type": "curved_laser",
					"origin": Vector2(480, 118),
					"interval_ticks": 132,
					"count": 3,
					"radius": 4.8,
					"length": 620.0,
					"curve": 78.0,
					"segments": 7,
					"spread": deg_to_rad(40.0),
					"warning_ticks": 44,
					"graze_cooldown_ticks": 12,
					"spin_per_tick": 0.004,
					"color": "violet",
				},
				{
					"id": "archive_reflect_laser",
					"name": "Reflect laser",
					"name_key": "pattern.archive_reflect_laser.name",
					"type": "reflect_laser",
					"origin": Vector2(480, 118),
					"interval_ticks": 154,
					"count": 2,
					"radius": 4.8,
					"length": 760.0,
					"spread": deg_to_rad(34.0),
					"bounces": 2,
					"warning_ticks": 44,
					"graze_cooldown_ticks": 12,
					"spin_per_tick": 0.003,
					"color": "white",
				},
				{
					"id": "archive_wave_laser",
					"name": "Wave laser",
					"name_key": "pattern.archive_wave_laser.name",
					"type": "wave_laser",
					"origin": Vector2(480, 118),
					"interval_ticks": 150,
					"count": 2,
					"radius": 4.6,
					"length": 640.0,
					"segments": 9,
					"wave_amplitude": 56.0,
					"wave_speed": 0.08,
					"spread": deg_to_rad(34.0),
					"warning_ticks": 42,
					"graze_cooldown_ticks": 12,
					"lifetime_ticks": 220,
					"spin_per_tick": 0.003,
					"color": "cyan",
				},
				{
					"id": "archive_wall_bounce",
					"name": "Wall bounce",
					"name_key": "pattern.archive_wall_bounce.name",
					"type": "wall_bounce",
					"origin": Vector2(480, 132),
					"interval_ticks": 48,
					"count": 7,
					"speed": 126.0,
					"radius": 4.2,
					"spread": deg_to_rad(92.0),
					"bounces": 2,
					"color": "cyan",
				},
				{
					"id": "archive_morph_ring",
					"name": "Morph ring",
					"name_key": "pattern.archive_morph_ring.name",
					"type": "morph_ring",
					"origin": Vector2(480, 116),
					"interval_ticks": 38,
					"count": 30,
					"speed": 104.0,
					"radius": 4.3,
					"lobes": 5,
					"wave_amplitude": 0.32,
					"spin_per_tick": 0.024,
					"color": "green",
				},
				{
					"id": "archive_summoner_orbit",
					"name": "Summoner orbit",
					"name_key": "pattern.archive_summoner_orbit.name",
					"type": "summoner_orbit",
					"origin": Vector2(480, 126),
					"interval_ticks": 144,
					"count": 4,
					"speed": 28.0,
					"radius": 6.2,
					"orbit_radius": 96.0,
					"orbit_spin": 0.045,
					"emit_interval_ticks": 24,
					"emit_start_tick": 18,
					"emit_count": 8,
					"emit_speed": 116.0,
					"lifetime_ticks": 108,
					"color": "violet",
					"emit_color": "gold",
				},
				{
					"id": "archive_path_emitters",
					"name": "Path emitters",
					"name_key": "pattern.archive_path_emitters.name",
					"type": "path_emitters",
					"origin": Vector2(480, 132),
					"interval_ticks": 170,
					"count": 3,
					"carrier_radius": 5.5,
					"path_radius_x": 250.0,
					"path_radius_y": 72.0,
					"path_duration_ticks": 250,
					"emit_interval_ticks": 22,
					"emit_start_tick": 12,
					"emit_count": 7,
					"emit_speed": 112.0,
					"emit_radius": 4.0,
					"emit_spin": 0.14,
					"lifetime_ticks": 260,
					"carrier_color": "violet",
					"emit_color": "white",
				},
				{
					"id": "archive_path_follow",
					"name": "Path follow",
					"name_key": "pattern.archive_path_follow.name",
					"type": "path_follow",
					"origin": Vector2(480, 180),
					"interval_ticks": 92,
					"count": 10,
					"speed": 0.0,
					"radius": 4.3,
					"path_radius_x": 245.0,
					"path_radius_y": 86.0,
					"path_duration_ticks": 190,
					"path_loop": true,
					"path_ping_pong": false,
					"lifetime_ticks": 190,
					"color": "green",
				},
				{
					"id": "archive_bezier_follow",
					"name": "Bezier follow",
					"name_key": "pattern.archive_bezier_follow.name",
					"type": "bezier_follow",
					"origin": Vector2(480, 180),
					"interval_ticks": 104,
					"count": 8,
					"speed": 0.0,
					"radius": 4.3,
					"control_points": [
						Vector2(-250, 0),
						Vector2(-120, 130),
						Vector2(120, -110),
						Vector2(250, 0),
					],
					"path_duration_ticks": 210,
					"path_loop": true,
					"path_ping_pong": false,
					"lifetime_ticks": 210,
					"color": "violet",
				},
				{
					"id": "archive_trail_emitters",
					"name": "Trail emitters",
					"name_key": "pattern.archive_trail_emitters.name",
					"type": "trail_emitters",
					"origin": Vector2(480, 92),
					"interval_ticks": 132,
					"count": 5,
					"speed": 56.0,
					"width": 460.0,
					"carrier_radius": 5.4,
					"emit_interval_ticks": 18,
					"emit_start_tick": 6,
					"emit_count": 5,
					"emit_speed": 108.0,
					"emit_radius": 3.8,
					"emit_spin": 0.17,
					"lifetime_ticks": 150,
					"carrier_color": "cyan",
					"emit_color": "gold",
				},
				{
					"id": "archive_converge_cloud",
					"name": "Converge cloud",
					"name_key": "pattern.archive_converge_cloud.name",
					"type": "converge_cloud",
					"origin": Vector2(480, 250),
					"interval_ticks": 52,
					"count": 18,
					"speed": 112.0,
					"radius": 4.0,
					"spawn_radius": 270.0,
					"converge_point": Vector2(480, 480),
					"color": "red",
				},
				{
					"id": "archive_vortex_field",
					"name": "Vortex field",
					"name_key": "pattern.archive_vortex_field.name",
					"type": "vortex_field",
					"origin": Vector2(480, 240),
					"interval_ticks": 64,
					"count": 16,
					"speed": 84.0,
					"radius": 4.0,
					"spawn_radius": 260.0,
					"field_center": Vector2(480, 360),
					"pull_strength": 2.0,
					"tangent_strength": 3.6,
					"max_speed": 170.0,
					"lifetime_ticks": 260,
					"color": "cyan",
				},
				{
					"id": "archive_stop_release",
					"name": "Stop release",
					"name_key": "pattern.archive_stop_release.name",
					"type": "stop_release",
					"origin": Vector2(480, 116),
					"interval_ticks": 58,
					"count": 22,
					"speed": 104.0,
					"release_speed": 146.0,
					"radius": 4.4,
					"stop_tick": 16,
					"release_tick": 58,
					"drift_multiplier": 0.18,
					"spin_per_tick": 0.018,
					"color": "gold",
				},
				{
					"id": "archive_boomerang_ring",
					"name": "Boomerang ring",
					"name_key": "pattern.archive_boomerang_ring.name",
					"type": "boomerang_ring",
					"origin": Vector2(480, 118),
					"interval_ticks": 64,
					"count": 24,
					"speed": 118.0,
					"radius": 4.3,
					"turn_tick": 46,
					"return_mode": "target",
					"return_target": Vector2(480, 116),
					"return_speed": 142.0,
					"pre_turn_acceleration": -1.1,
					"spin_per_tick": 0.020,
					"color": "green",
				},
				{
					"id": "archive_orbit_release",
					"name": "Orbit release",
					"name_key": "pattern.archive_orbit_release.name",
					"type": "orbit_release",
					"origin": Vector2(480, 118),
					"interval_ticks": 96,
					"count": 18,
					"speed": 128.0,
					"radius": 4.2,
					"orbit_radius": 86.0,
					"orbit_spin": 0.045,
					"release_tick": 46,
					"release_mode": "tangent",
					"release_speed": 132.0,
					"spin_per_tick": 0.018,
					"color": "green",
				},
				{
					"id": "archive_phase_shift_ring",
					"name": "Phase shift ring",
					"name_key": "pattern.archive_phase_shift_ring.name",
					"type": "phase_shift_ring",
					"origin": Vector2(480, 116),
					"interval_ticks": 70,
					"count": 24,
					"speed": 72.0,
					"radius": 4.2,
					"shift_tick": 42,
					"shift_mode": "tangent",
					"shift_speed": 140.0,
					"acceleration_after_shift": 0.5,
					"spin_per_tick": 0.016,
					"color": "cyan",
				},
				{
					"id": "archive_scale_pulse_ring",
					"name": "Scale pulse ring",
					"name_key": "pattern.archive_scale_pulse_ring.name",
					"type": "scale_pulse_ring",
					"origin": Vector2(480, 118),
					"interval_ticks": 86,
					"count": 18,
					"speed": 88.0,
					"radius": 3.0,
					"base_radius": 3.0,
					"target_radius": 8.0,
					"grow_start_tick": 14,
					"grow_duration_ticks": 44,
					"pulse_amplitude": 1.3,
					"pulse_period_ticks": 72,
					"spin_per_tick": 0.018,
					"lifetime_ticks": 260,
					"color": "violet",
				},
				{
					"id": "archive_delayed_aim_ring",
					"name": "Delayed aim ring",
					"name_key": "pattern.archive_delayed_aim_ring.name",
					"type": "delayed_aim_ring",
					"origin": Vector2(480, 112),
					"interval_ticks": 74,
					"count": 18,
					"speed": 94.0,
					"release_speed": 152.0,
					"radius": 4.2,
					"hold_tick": 16,
					"aim_tick": 48,
					"aim_mode": "player",
					"drift_multiplier": 0.16,
					"spin_per_tick": 0.022,
					"color": "white",
				},
				{
					"id": "archive_gate_lanes",
					"name": "Gate lanes",
					"name_key": "pattern.archive_gate_lanes.name",
					"type": "gate_lanes",
					"origin": Vector2(480, 76),
					"interval_ticks": 24,
					"count": 17,
					"speed": 126.0,
					"radius": 4.2,
					"width": 600.0,
					"gate_width": 118.0,
					"gate_period_ticks": 190,
					"speed_wave": 18.0,
					"color": "cyan",
				},
			],
		},
	]
