class_name PatternLabModel
extends RefCounted

var stage_select_model: RefCounted = null
var boss_spellbook_model: RefCounted = null

func configure(stage_model: RefCounted, spellbook_model: RefCounted = null) -> void:
	stage_select_model = stage_model
	boss_spellbook_model = spellbook_model

func configure_boss_spellbook(spellbook_model: RefCounted) -> void:
	boss_spellbook_model = spellbook_model

func active_rows() -> Array[Dictionary]:
	if stage_select_model == null:
		return []
	return rows_for_patterns(stage_select_model.active_patterns(), _active_pattern_id())

func rows_for_stage(stage_id: String) -> Array[Dictionary]:
	if stage_select_model == null:
		return []
	return rows_for_patterns(stage_select_model.patterns_for_stage(stage_id), _active_pattern_id())

func rows_for_patterns(patterns: Array[Dictionary], selected_pattern_id: String = "") -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for pattern in patterns:
		var row: Dictionary = analyze_pattern(pattern)
		var pattern_id := String(pattern.get("id", ""))
		row["id"] = "pattern_lab_%s" % pattern_id
		row["pattern_id"] = pattern_id
		row["pattern_type"] = String(pattern.get("type", ""))
		row["label_key"] = String(pattern.get("name_key", ""))
		row["name"] = String(pattern.get("name", pattern_id))
		row["selected"] = pattern_id == selected_pattern_id
		row["enabled"] = true
		rows.append(row)
	return rows

func rows_for_spellbook(spellbook_id: String = "original_boss_archive", seed: int = 20260625) -> Array[Dictionary]:
	if boss_spellbook_model == null or not boss_spellbook_model.has_method("timeline_rows"):
		return []
	var rows: Array[Dictionary] = []
	for phase_row in boss_spellbook_model.timeline_rows(spellbook_id):
		rows.append_array(rows_for_spellbook_phase("boss_spellbook", String(phase_row.get("phase_id", "")), spellbook_id, seed))
	return rows

func rows_for_spellbook_phase(catalog_id: String, phase_id: String, spellbook_id: String = "original_boss_archive", seed: int = 20260625) -> Array[Dictionary]:
	if catalog_id != "boss_spellbook" or boss_spellbook_model == null:
		return []
	if not boss_spellbook_model.has_method("phase_config") or not boss_spellbook_model.has_method("deterministic_phase_preview"):
		return []
	var phase: Dictionary = boss_spellbook_model.phase_config(spellbook_id, phase_id)
	if phase.is_empty():
		return []
	var preview: Dictionary = boss_spellbook_model.deterministic_phase_preview(spellbook_id, phase_id, seed)
	var phase_script: Dictionary = phase.get("phase_script", {})
	if phase_script.is_empty() and boss_spellbook_model.has_method("phase_script_config"):
		phase_script = boss_spellbook_model.phase_script_config(spellbook_id, phase_id)
	var pattern_rows: Array[Dictionary] = []
	for pattern in phase.get("patterns", []):
		var pattern_dict: Dictionary = (pattern as Dictionary).duplicate(true)
		pattern_dict["id"] = "%s_%s" % [phase_id, String(pattern_dict.get("id", pattern_dict.get("type", "pattern")))]
		var row := analyze_pattern(pattern_dict)
		row["id"] = "pattern_lab_%s_%s_%s" % [catalog_id, phase_id, String(pattern_dict.get("id", ""))]
		row["catalog_id"] = catalog_id
		row["spellbook_id"] = spellbook_id
		row["phase_id"] = phase_id
		row["pattern_id"] = String(pattern_dict.get("id", ""))
		row["pattern_type"] = String(pattern_dict.get("type", ""))
		row["label_key"] = "screen.settings.pattern_lab"
		row["name"] = String(pattern_dict.get("id", ""))
		row["source_policy"] = "original_spell_phase_script"
		row["preview_export_schema_version"] = int(preview.get("export_schema_version", 0))
		row["preview_export_id"] = String(preview.get("export_id", ""))
		row["preview_fixture_id"] = String(preview.get("preview_fixture_id", ""))
		row["preview_authority_scope"] = String(preview.get("preview_authority_scope", ""))
		row["deterministic_preview_signature"] = String(preview.get("signature", ""))
		row["deterministic_preview_digest"] = int(preview.get("signature_digest", 0))
		row["seed"] = int(preview.get("seed", 0))
		row["preview_sample_ticks"] = (preview.get("sample_ticks", []) as Array).duplicate()
		row["preview_sample_window_start_tick"] = int(preview.get("sample_window_start_tick", 0))
		row["preview_sample_window_end_tick"] = int(preview.get("sample_window_end_tick", 0))
		row["preview_sample_window_stride_ticks"] = int(preview.get("sample_window_stride_ticks", 0))
		row["preview_sample_signature_digests"] = (preview.get("sample_signature_digests", []) as Array).duplicate()
		row["preview_sample_emit_counts"] = (preview.get("sample_emit_counts", []) as Array).duplicate()
		row["preview_sample_count"] = (preview.get("samples", []) as Array).size()
		row["max_preview_emit"] = int(preview.get("max_emit_per_tick", 0))
		row["bullet_cap_per_tick"] = int(preview.get("bullet_cap_per_tick", phase_script.get("bullet_cap_per_tick", 0)))
		row["preview_budget_headroom"] = int(preview.get("budget_headroom", 0))
		row["performance_budget_status"] = String(preview.get("performance_budget_status", ""))
		row["enabled"] = true
		pattern_rows.append(row)
	var coverage_row := _spellbook_phase_coverage_row(catalog_id, spellbook_id, phase, phase_script, preview, pattern_rows)
	var rows: Array[Dictionary] = [coverage_row]
	rows.append_array(pattern_rows)
	return rows

func spellbook_phase_summary(catalog_id: String, phase_id: String, spellbook_id: String = "original_boss_archive", seed: int = 20260625) -> String:
	var rows := rows_for_spellbook_phase(catalog_id, phase_id, spellbook_id, seed)
	if rows.is_empty():
		return "spellbook phase missing"
	var coverage: Dictionary = rows[0]
	return "%s/%s timeout %d enrage %d cap %d preview %d" % [
		String(coverage.get("catalog_id", "")),
		String(coverage.get("phase_id", "")),
		int(coverage.get("timeout_ticks", 0)),
		int(coverage.get("enrage_after_ticks", 0)),
		int(coverage.get("bullet_cap_per_tick", 0)),
		int(coverage.get("max_preview_emit", 0)),
	]

func summary() -> String:
	var rows: Array[Dictionary] = active_rows()
	if rows.is_empty():
		return "pattern lab empty"
	var selected_row: Dictionary = rows[0]
	for row in rows:
		if bool(row.get("selected", false)):
			selected_row = row
			break
	return "%s %s density %s danger %s" % [
		String(selected_row.get("pattern_id", "")),
		String(selected_row.get("math_basis", "")),
		String(selected_row.get("density_estimate", "")),
		String(selected_row.get("danger_estimate", "")),
	]

func analyze_pattern(pattern: Dictionary) -> Dictionary:
	var pattern_type := String(pattern.get("type", ""))
	var interval_ticks: int = max(1, int(pattern.get("interval_ticks", 60)))
	var trigger_count: int = _trigger_bullet_count(pattern)
	var total_count: int = _total_bullet_count(pattern)
	var speed: float = float(pattern.get("speed", 0.0))
	var radius: float = float(pattern.get("radius", 0.0))
	var density_per_second: float = float(total_count) * 60.0 / float(interval_ticks)
	var danger_score: float = density_per_second / 18.0 + speed / 120.0 + radius / 8.0 + _type_danger_bonus(pattern_type)
	return {
		"math_basis": _math_basis(pattern_type),
		"math_family": _math_family(pattern_type),
		"parameter_summary": _parameter_summary(pattern),
		"trigger_bullet_count": trigger_count,
		"total_bullet_count": total_count,
		"spawn_rate_per_second": snappedf(density_per_second, 0.01),
		"density_estimate": _density_band(density_per_second),
		"danger_estimate": _danger_band(danger_score),
		"readability_hint": _readability_hint(pattern_type, density_per_second, speed),
	}

func _spellbook_phase_coverage_row(catalog_id: String, spellbook_id: String, phase: Dictionary, phase_script: Dictionary, preview: Dictionary, pattern_rows: Array[Dictionary]) -> Dictionary:
	var density_peak := _peak_band(pattern_rows, "density_estimate", ["low", "medium", "high", "extreme"])
	var danger_peak := _peak_band(pattern_rows, "danger_estimate", ["low", "medium", "high", "severe"])
	var families: Array[String] = []
	for family_id in phase.get("family_ids", []):
		families.append(String(family_id))
	return {
		"id": "pattern_lab_coverage_%s_%s" % [catalog_id, String(phase.get("id", ""))],
		"catalog_id": catalog_id,
		"spellbook_id": spellbook_id,
		"phase_id": String(phase.get("id", "")),
		"label_key": "screen.settings.pattern_lab",
		"coverage_kind": "spellbook_phase",
		"phase_kind": String(phase.get("kind", "")),
		"pattern_types": _phase_pattern_types(phase),
		"family_ids": families,
		"recipe_id": String(phase.get("recipe_id", "")),
		"source_policy": "original_spell_phase_script",
		"timeout_ticks": int(phase_script.get("timeout_ticks", phase.get("timeout_ticks", 0))),
		"enrage_after_ticks": int(phase_script.get("enrage_after_ticks", phase.get("enrage_after_ticks", 0))),
		"bullet_cap_per_tick": int(phase_script.get("bullet_cap_per_tick", 0)),
		"preview_export_schema_version": int(preview.get("export_schema_version", 0)),
		"preview_export_id": String(preview.get("export_id", "")),
		"preview_authority_scope": String(preview.get("preview_authority_scope", "")),
		"deterministic_preview_signature": String(preview.get("signature", "")),
		"deterministic_preview_digest": int(preview.get("signature_digest", 0)),
		"seed": int(preview.get("seed", 0)),
		"preview_sample_ticks": (preview.get("sample_ticks", []) as Array).duplicate(),
		"preview_sample_window_start_tick": int(preview.get("sample_window_start_tick", 0)),
		"preview_sample_window_end_tick": int(preview.get("sample_window_end_tick", 0)),
		"preview_sample_window_stride_ticks": int(preview.get("sample_window_stride_ticks", 0)),
		"preview_sample_signature_digests": (preview.get("sample_signature_digests", []) as Array).duplicate(),
		"preview_sample_emit_counts": (preview.get("sample_emit_counts", []) as Array).duplicate(),
		"preview_sample_count": (preview.get("samples", []) as Array).size(),
		"max_preview_emit": int(preview.get("max_emit_per_tick", 0)),
		"preview_budget_headroom": int(preview.get("budget_headroom", int(phase_script.get("bullet_cap_per_tick", 0)) - int(preview.get("max_emit_per_tick", 0)))),
		"performance_budget_status": String(preview.get("performance_budget_status", "within_budget" if int(preview.get("max_emit_per_tick", 0)) <= int(phase_script.get("bullet_cap_per_tick", 0)) else "over_budget")),
		"density_estimate": density_peak,
		"danger_estimate": danger_peak,
		"spawn_rate_per_second": _peak_float(pattern_rows, "spawn_rate_per_second"),
		"readability_hint": "spell_phase_route",
		"enabled": true,
	}

func _phase_pattern_types(phase: Dictionary) -> Array[String]:
	var types: Array[String] = []
	for pattern in phase.get("patterns", []):
		var pattern_type := String((pattern as Dictionary).get("type", ""))
		if not pattern_type.is_empty() and not types.has(pattern_type):
			types.append(pattern_type)
	return types

func _peak_band(rows: Array[Dictionary], key: String, order: Array[String]) -> String:
	var peak := ""
	var peak_index := -1
	for row in rows:
		var value := String(row.get(key, ""))
		var index := order.find(value)
		if index > peak_index:
			peak = value
			peak_index = index
	return peak

func _peak_float(rows: Array[Dictionary], key: String) -> float:
	var peak := 0.0
	for row in rows:
		peak = maxf(peak, float(row.get(key, 0.0)))
	return snappedf(peak, 0.01)

func _active_pattern_id() -> String:
	if stage_select_model == null:
		return ""
	var active_pattern: Dictionary = stage_select_model.active_pattern()
	return String(active_pattern.get("id", ""))

func _trigger_bullet_count(pattern: Dictionary) -> int:
	var pattern_type := String(pattern.get("type", ""))
	match pattern_type:
		"blossom":
			return 1
		"exploding_star":
			return 1
		"telegraph_burst":
			return 1
		"charge_burst":
			return 1
		"trap_marker":
			return max(1, int(pattern.get("count", 1)))
		"flower":
			return max(1, int(pattern.get("count", int(pattern.get("petals", 1))))) * max(1, int(pattern.get("layers", 1)))
		"spiral_stack":
			return max(1, int(pattern.get("count", 1))) * max(1, int(pattern.get("layers", 1)))
		"grid_rain":
			return max(1, int(pattern.get("count", 1))) * max(1, int(pattern.get("rows", 1)))
		"edge_spawn":
			return max(1, int(pattern.get("count", 1)))
		"beam_sweep":
			return max(1, int(pattern.get("count", 1)))
		"rotating_laser":
			return max(1, int(pattern.get("count", 1)))
		"cross_laser":
			return max(2, int(pattern.get("arms", int(pattern.get("count", 4)))))
		"extend_laser":
			return max(1, int(pattern.get("count", 1)))
		"curved_laser":
			return max(1, int(pattern.get("count", 1)))
		"reflect_laser":
			return max(1, int(pattern.get("count", 1)))
		"wave_laser":
			return max(1, int(pattern.get("count", 1)))
		"summoner_orbit":
			return max(1, int(pattern.get("count", 1)))
		"boomerang_ring":
			return max(1, int(pattern.get("count", 1)))
		"orbit_release":
			return max(1, int(pattern.get("count", 1)))
		"phase_shift_ring":
			return max(1, int(pattern.get("count", 1)))
		"scale_pulse_ring":
			return max(1, int(pattern.get("count", 1)))
		"delayed_aim_ring":
			return max(1, int(pattern.get("count", 1)))
		"path_emitters":
			return max(1, int(pattern.get("count", 1)))
		"path_follow":
			return max(1, int(pattern.get("count", 1)))
		"bezier_follow":
			return max(1, int(pattern.get("count", 1)))
		"trail_emitters":
			return max(1, int(pattern.get("count", 1)))
		"gate_lanes":
			return max(1, int(pattern.get("count", 1)))
		_:
			return max(1, int(pattern.get("count", 1)))

func _total_bullet_count(pattern: Dictionary) -> int:
	var pattern_type := String(pattern.get("type", ""))
	var count: int = max(1, int(pattern.get("count", 1)))
	match pattern_type:
		"split_chain":
			return count * (1 + max(1, int(pattern.get("split_count", 1))))
		"blossom":
			return 1 + count
		"exploding_star":
			return 1 + max(1, int(pattern.get("split_count", 1)))
		"telegraph_burst":
			return 1 + count
		"charge_burst":
			return 1 + count
		"trap_marker":
			return count * (1 + max(1, int(pattern.get("emit_count", 1))))
		"flower":
			return count * max(1, int(pattern.get("layers", 1)))
		"spiral_stack":
			return count * max(1, int(pattern.get("layers", 1)))
		"grid_rain":
			return count * max(1, int(pattern.get("rows", 1)))
		"edge_spawn":
			return count
		"summoner_orbit":
			return count * (1 + max(1, int(pattern.get("emit_count", 1))) * max(1, int(pattern.get("lifetime_ticks", 120))) / max(1, int(pattern.get("emit_interval_ticks", 24))))
		"path_emitters":
			return count * (1 + max(1, int(pattern.get("emit_count", 1))) * max(1, int(pattern.get("lifetime_ticks", 360))) / max(1, int(pattern.get("emit_interval_ticks", 24))))
		"path_follow":
			return count
		"bezier_follow":
			return count
		"trail_emitters":
			return count * (1 + max(1, int(pattern.get("emit_count", 1))) * max(1, int(pattern.get("lifetime_ticks", 150))) / max(1, int(pattern.get("emit_interval_ticks", 18))))
		"vortex_field":
			return count
		"gate_lanes":
			var blocked_by_gate: int = max(1, int(ceil(float(count) * float(pattern.get("gate_width", 96.0)) / max(1.0, float(pattern.get("width", 560.0))))))
			return max(1, count - blocked_by_gate)
		_:
			return count

func _math_basis(pattern_type: String) -> String:
	match pattern_type:
		"ring":
			return "polar_even_angles"
		"gap_ring":
			return "polar_gap_filter"
		"n_way":
			return "aimed_angle_lerp"
		"random_arc":
			return "seeded_random_arc"
		"split_chain":
			return "delayed_polar_split"
		"blossom":
			return "delayed_blossom_ring"
		"homing":
			return "rotate_toward_target"
		"flower":
			return "flower_angle_lattice"
		"sine_stream":
			return "sine_wave_offset"
		"snake_stream":
			return "dynamic_snake_velocity"
		"curtain":
			return "linear_lane_wall"
		"burst":
			return "aimed_speed_gradient"
		"laser_curtain":
			return "warning_lane_fan"
		"orbital":
			return "polar_orbit_tangent"
		"spiral_stack":
			return "stacked_rotating_spiral"
		"alternating_ring":
			return "alternating_offset_ring"
		"accel_ring":
			return "velocity_phased_ring"
		"curve_fan":
			return "curved_aimed_lanes"
		"grid_rain":
			return "staggered_grid_rain"
		"edge_spawn":
			return "edge_inward_spawn_lanes"
		"sweep_laser":
			return "continuous_laser_sweep"
		"exploding_star":
			return "delayed_starburst_split"
		"telegraph_burst":
			return "warning_then_burst"
		"charge_burst":
			return "charge_then_convert_burst"
		"trap_marker":
			return "delayed_position_traps"
		"beam_sweep":
			return "capsule_laser_sweep"
		"rotating_laser":
			return "rotating_persistent_laser"
		"cross_laser":
			return "multi_arm_warning_laser"
		"extend_laser":
			return "growing_capsule_laser"
		"curved_laser":
			return "polyline_curved_laser"
		"reflect_laser":
			return "bounded_reflect_laser"
		"wave_laser":
			return "dynamic_wave_laser"
		"wall_bounce":
			return "bounded_reflection_lanes"
		"morph_ring":
			return "radial_speed_morph"
		"summoner_orbit":
			return "orbital_periodic_emitters"
		"path_emitters":
			return "path_periodic_emitters"
		"path_follow":
			return "path_following_bullets"
		"bezier_follow":
			return "bezier_path_follow"
		"trail_emitters":
			return "moving_trail_emitters"
		"converge_cloud":
			return "seeded_converging_cloud"
		"vortex_field":
			return "continuous_force_field"
		"stop_release":
			return "timed_stop_release"
		"boomerang_ring":
			return "returning_radial_ring"
		"orbit_release":
			return "orbital_hold_release"
		"phase_shift_ring":
			return "two_phase_velocity_shift"
		"scale_pulse_ring":
			return "radial_radius_pulse"
		"delayed_aim_ring":
			return "delayed_one_shot_aim"
		"gate_lanes":
			return "moving_gap_lane_wall"
		_:
			return "unknown"

func _math_family(pattern_type: String) -> String:
	match pattern_type:
		"ring", "gap_ring", "flower", "orbital", "spiral_stack", "alternating_ring", "accel_ring", "morph_ring", "stop_release", "boomerang_ring", "orbit_release", "phase_shift_ring", "scale_pulse_ring":
			return "polar"
		"n_way", "burst", "laser_curtain", "curve_fan", "sweep_laser", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser", "wall_bounce":
			return "aimed"
		"random_arc", "converge_cloud", "vortex_field":
			return "seeded_random"
		"split_chain", "blossom", "exploding_star", "telegraph_burst", "charge_burst", "trap_marker", "summoner_orbit", "path_emitters", "path_follow", "bezier_follow", "trail_emitters", "delayed_aim_ring":
			return "delayed"
		"homing":
			return "tracking"
		"sine_stream", "snake_stream", "curtain", "grid_rain", "edge_spawn", "gate_lanes":
			return "wave"
		_:
			return "unknown"

func _parameter_summary(pattern: Dictionary) -> String:
	var pattern_type := String(pattern.get("type", ""))
	var common: String = "count %d speed %.0f interval %dt" % [
		_trigger_bullet_count(pattern),
		float(pattern.get("speed", 0.0)),
		int(pattern.get("interval_ticks", 0)),
	]
	match pattern_type:
		"ring":
			return "%s spin %.3f" % [common, float(pattern.get("spin_per_tick", 0.0))]
		"gap_ring":
			return "%s gap %.0fdeg x%d" % [common, rad_to_deg(float(pattern.get("gap_width", 0.0))), int(pattern.get("gap_count", 1))]
		"n_way", "burst", "laser_curtain":
			return "%s spread %.0fdeg" % [common, rad_to_deg(float(pattern.get("spread", 0.0)))]
		"random_arc":
			return "%s jitter %.0f spread %.0fdeg" % [common, float(pattern.get("speed_jitter", 0.0)), rad_to_deg(float(pattern.get("spread", 0.0)))]
		"split_chain":
			return "%s split %dx after %dt" % [common, int(pattern.get("split_count", 0)), int(pattern.get("split_delay_ticks", 0))]
		"blossom":
			return "%s opens %dx after %dt" % [common, int(pattern.get("count", 0)), int(pattern.get("blossom_delay_ticks", 0))]
		"homing":
			return "%s turn %.1fdeg life %dt" % [common, rad_to_deg(float(pattern.get("turn_rate", 0.0))), int(pattern.get("lifetime_ticks", 0))]
		"flower":
			return "%s petals %d layers %d" % [common, int(pattern.get("petals", 0)), int(pattern.get("layers", 0))]
		"sine_stream":
			return "%s wave %.0f/%dt" % [common, float(pattern.get("wave_amplitude", 0.0)), int(pattern.get("wave_period_ticks", 0))]
		"snake_stream":
			return "%s snake %.0fdeg/%dt" % [common, rad_to_deg(float(pattern.get("snake_amplitude", 0.0))), int(pattern.get("wave_period_ticks", 0))]
		"curtain":
			return "%s width %.0f sway %.0f" % [common, float(pattern.get("width", 0.0)), float(pattern.get("sway", 0.0))]
		"orbital":
			return "%s orbit %.0f spin %.2f" % [common, float(pattern.get("orbit_radius", 0.0)), float(pattern.get("orbit_spin", 0.0))]
		"spiral_stack":
			return "%s layers %d spin %.3f" % [common, int(pattern.get("layers", 0)), float(pattern.get("spin_per_tick", 0.0))]
		"alternating_ring":
			return "%s phase every %dt" % [common, int(pattern.get("phase_interval_ticks", int(pattern.get("interval_ticks", 0))))]
		"accel_ring":
			return "%s accel %.1f max %.0f" % [common, float(pattern.get("acceleration", 0.0)), float(pattern.get("max_speed", 0.0))]
		"curve_fan":
			return "%s curve %.2fdeg" % [common, rad_to_deg(float(pattern.get("angular_velocity", 0.0)))]
		"grid_rain":
			return "%s rows %d width %.0f" % [common, int(pattern.get("rows", 1)), float(pattern.get("width", 0.0))]
		"edge_spawn":
			return "%s edge %s bounds %.0fx%.0f" % [common, String(pattern.get("edge", "top")), float((pattern.get("spawn_bounds", Rect2(Vector2.ZERO, Vector2.ZERO)) as Rect2).size.x), float((pattern.get("spawn_bounds", Rect2(Vector2.ZERO, Vector2.ZERO)) as Rect2).size.y)]
		"sweep_laser":
			return "%s continuous cooldown %dt" % [common, int(pattern.get("graze_cooldown_ticks", 0))]
		"exploding_star":
			return "%s split %dx after %dt" % [common, int(pattern.get("split_count", 0)), int(pattern.get("split_delay_ticks", 0))]
		"telegraph_burst":
			return "%s warning %dt %s" % [common, int(pattern.get("trigger_tick", 0)), String(pattern.get("burst_mode", "ring"))]
		"charge_burst":
			return "%s charge %dt %s" % [common, int(pattern.get("trigger_tick", 0)), String(pattern.get("burst_mode", "ring"))]
		"trap_marker":
			return "%s traps %d release %dx after %dt" % [common, int(pattern.get("count", 1)), int(pattern.get("emit_count", 1)), int(pattern.get("trigger_tick", 0))]
		"beam_sweep":
			return "%s beam %.0fpx cooldown %dt" % [common, float(pattern.get("length", 0.0)), int(pattern.get("graze_cooldown_ticks", 0))]
		"rotating_laser":
			return "%s rotate %.2fdeg life %dt" % [common, rad_to_deg(float(pattern.get("angular_velocity", 0.0))), int(pattern.get("lifetime_ticks", 0))]
		"cross_laser":
			return "%s arms %d length %.0f life %dt" % [common, max(2, int(pattern.get("arms", int(pattern.get("count", 4))))), float(pattern.get("length", 0.0)), int(pattern.get("lifetime_ticks", 0))]
		"extend_laser":
			return "%s extend %.0f->%.0f/%dt" % [common, float(pattern.get("start_length", 0.0)), float(pattern.get("length", 0.0)), int(pattern.get("extend_duration_ticks", 0))]
		"curved_laser":
			return "%s curve %.0fpx seg %d" % [common, float(pattern.get("curve", 0.0)), int(pattern.get("segments", 0))]
		"reflect_laser":
			return "%s reflect %dx %.0fpx" % [common, int(pattern.get("bounces", 0)), float(pattern.get("length", 0.0))]
		"wave_laser":
			return "%s wave %.0fpx seg %d life %dt" % [common, float(pattern.get("wave_amplitude", 0.0)), int(pattern.get("segments", 0)), int(pattern.get("lifetime_ticks", 0))]
		"wall_bounce":
			return "%s bounces %d spread %.0fdeg" % [common, int(pattern.get("bounces", 0)), rad_to_deg(float(pattern.get("spread", 0.0)))]
		"morph_ring":
			return "%s lobes %d amp %.2f" % [common, int(pattern.get("lobes", 0)), float(pattern.get("wave_amplitude", 0.0))]
		"summoner_orbit":
			return "%s emit %dx/%dt life %dt" % [common, int(pattern.get("emit_count", 0)), int(pattern.get("emit_interval_ticks", 0)), int(pattern.get("lifetime_ticks", 0))]
		"path_emitters":
			return "%s path %dt emit %dx/%dt" % [common, int(pattern.get("path_duration_ticks", 0)), int(pattern.get("emit_count", 0)), int(pattern.get("emit_interval_ticks", 0))]
		"path_follow":
			return "%s path %dt radius %.0fx%.0f" % [common, int(pattern.get("path_duration_ticks", 0)), float(pattern.get("path_radius_x", 0.0)), float(pattern.get("path_radius_y", 0.0))]
		"bezier_follow":
			return "%s bezier %dt controls %d" % [common, int(pattern.get("path_duration_ticks", 0)), (pattern.get("control_points", []) as Array).size()]
		"trail_emitters":
			return "%s trail %.0f emit %dx/%dt" % [common, float(pattern.get("width", 0.0)), int(pattern.get("emit_count", 0)), int(pattern.get("emit_interval_ticks", 0))]
		"converge_cloud":
			return "%s cloud radius %.0f" % [common, float(pattern.get("spawn_radius", 0.0))]
		"vortex_field":
			return "%s pull %.1f tangent %.1f" % [common, float(pattern.get("pull_strength", 0.0)), float(pattern.get("tangent_strength", 0.0))]
		"stop_release":
			return "%s stop %dt release %dt" % [common, int(pattern.get("stop_tick", 0)), int(pattern.get("release_tick", 0))]
		"boomerang_ring":
			return "%s turn %dt mode %s" % [common, int(pattern.get("turn_tick", 0)), String(pattern.get("return_mode", "reverse"))]
		"orbit_release":
			return "%s orbit %.0f release %dt %s" % [common, float(pattern.get("orbit_radius", 0.0)), int(pattern.get("release_tick", 0)), String(pattern.get("release_mode", "radial"))]
		"phase_shift_ring":
			return "%s shift %dt %s" % [common, int(pattern.get("shift_tick", 0)), String(pattern.get("shift_mode", "radial"))]
		"scale_pulse_ring":
			return "%s radius %.1f->%.1f grow %dt" % [common, float(pattern.get("base_radius", pattern.get("radius", 0.0))), float(pattern.get("target_radius", pattern.get("radius", 0.0))), int(pattern.get("grow_duration_ticks", 0))]
		"delayed_aim_ring":
			return "%s hold %dt aim %dt" % [common, int(pattern.get("hold_tick", 0)), int(pattern.get("aim_tick", 0))]
		"gate_lanes":
			return "%s width %.0f gate %.0f" % [common, float(pattern.get("width", 0.0)), float(pattern.get("gate_width", 0.0))]
		_:
			return common

func _density_band(density_per_second: float) -> String:
	if density_per_second >= 70.0:
		return "extreme"
	if density_per_second >= 38.0:
		return "high"
	if density_per_second >= 18.0:
		return "medium"
	return "low"

func _danger_band(danger_score: float) -> String:
	if danger_score >= 6.0:
		return "severe"
	if danger_score >= 4.2:
		return "high"
	if danger_score >= 2.6:
		return "medium"
	return "low"

func _readability_hint(pattern_type: String, density_per_second: float, speed: float) -> String:
	if density_per_second >= 70.0:
		return "thin_routes"
	match pattern_type:
		"laser_curtain":
			return "watch_warnings"
		"telegraph_burst":
			return "watch_warnings"
		"charge_burst":
			return "watch_warnings"
		"trap_marker":
			return "watch_warnings"
		"sweep_laser", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser":
			return "respect_persistent_lanes"
		"wall_bounce":
			return "track_reflections"
		"homing":
			return "bait_turns"
		"split_chain", "blossom", "exploding_star", "stop_release", "delayed_aim_ring", "trap_marker":
			return "time_delays"
		"sine_stream", "snake_stream", "curtain", "grid_rain", "gate_lanes":
			return "read_waves"
		"edge_spawn":
			return "watch_edges"
		"random_arc":
			return "read_seeded_gaps"
		"orbital", "flower", "ring", "gap_ring", "spiral_stack", "alternating_ring", "accel_ring", "morph_ring", "boomerang_ring", "orbit_release", "phase_shift_ring", "scale_pulse_ring":
			return "read_radial_symmetry"
		"summoner_orbit", "path_emitters", "path_follow", "bezier_follow", "trail_emitters":
			return "watch_emitters"
		"converge_cloud":
			return "leave_convergence_point"
		"vortex_field":
			return "read_curving_lanes"
		"curve_fan":
			return "read_curving_lanes"
		_:
			if speed >= 170.0:
				return "early_positioning"
			return "aimed_lane_read"

func _type_danger_bonus(pattern_type: String) -> float:
	match pattern_type:
		"homing", "laser_curtain", "sweep_laser", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser":
			return 0.9
		"split_chain", "blossom", "exploding_star", "telegraph_burst", "charge_burst", "trap_marker", "summoner_orbit", "path_emitters", "path_follow", "bezier_follow", "trail_emitters", "stop_release", "delayed_aim_ring", "orbit_release", "phase_shift_ring", "scale_pulse_ring":
			return 0.7
		"burst", "orbital", "curve_fan", "accel_ring", "wall_bounce", "converge_cloud", "vortex_field", "edge_spawn", "gate_lanes", "boomerang_ring":
			return 0.5
		_:
			return 0.0
