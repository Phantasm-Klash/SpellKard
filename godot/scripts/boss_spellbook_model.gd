class_name BossSpellbookModel
extends RefCounted

const BossPatternCatalogLib := preload("res://scripts/boss_pattern_catalog.gd")
const BulletMathLib := preload("res://scripts/bullet_math.gd")
const BulletPatterns := preload("res://scripts/bullet_pattern_library.gd")

var spellbooks: Array[Dictionary] = []
var spellbook_by_id: Dictionary = {}

func _init() -> void:
	spellbooks = _build_spellbooks()
	_rebuild_index()

func spellbook_ids() -> Array[String]:
	var ids: Array[String] = []
	for spellbook in spellbooks:
		ids.append(String(spellbook.get("id", "")))
	return ids

func spellbook_config(spellbook_id: String) -> Dictionary:
	if not spellbook_by_id.has(spellbook_id):
		return {}
	return (spellbook_by_id[spellbook_id] as Dictionary).duplicate(true)

func rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for spellbook in spellbooks:
		var phases: Array = spellbook.get("phases", [])
		rows.append({
			"id": "boss_spellbook_%s" % String(spellbook.get("id", "")),
			"spellbook_id": String(spellbook.get("id", "")),
			"label_key": String(spellbook.get("name_key", "")),
			"summary": "phases %d ticks %d families %s" % [phases.size(), total_ticks(spellbook), ",".join(_spellbook_family_ids(spellbook))],
			"phase_count": phases.size(),
			"pattern_types": _spellbook_pattern_types(spellbook),
			"family_ids": _spellbook_family_ids(spellbook),
			"total_ticks": total_ticks(spellbook),
			"open_source_recipe_ids": _spellbook_recipe_ids(spellbook),
			"ui_action": "start_boss_spellbook_run",
			"enabled": true,
		})
	return rows

func timeline_rows(spellbook_id: String) -> Array[Dictionary]:
	var spellbook: Dictionary = spellbook_config(spellbook_id)
	var rows: Array[Dictionary] = []
	var start_tick: int = 0
	for phase in spellbook.get("phases", []):
		var duration: int = int(phase.get("duration_ticks", 0))
		rows.append({
			"id": "boss_spell_phase_%s" % String(phase.get("id", "")),
			"label_key": "screen.settings.boss_spellbook",
			"summary": "%s %dt %s" % [String(phase.get("kind", "")), duration, ",".join(_phase_pattern_types(phase))],
			"spellbook_id": spellbook_id,
			"phase_id": String(phase.get("id", "")),
			"phase_kind": String(phase.get("kind", "")),
			"start_tick": start_tick,
			"end_tick": start_tick + duration,
			"duration_ticks": duration,
			"pattern_types": _phase_pattern_types(phase),
			"family_ids": _phase_family_ids(phase),
			"recipe_id": String(phase.get("recipe_id", "")),
			"enabled": true,
		})
		start_tick += duration
	return rows

func total_ticks(spellbook: Dictionary) -> int:
	var total: int = 0
	for phase in spellbook.get("phases", []):
		total += int(phase.get("duration_ticks", 0))
	return total

func active_phase(spellbook_id: String, local_tick: int) -> Dictionary:
	var spellbook: Dictionary = spellbook_config(spellbook_id)
	var cursor: int = 0
	for phase in spellbook.get("phases", []):
		var duration: int = int(phase.get("duration_ticks", 0))
		if local_tick >= cursor and local_tick < cursor + duration:
			var result: Dictionary = (phase as Dictionary).duplicate(true)
			result["phase_tick"] = local_tick - cursor
			result["start_tick"] = cursor
			return result
		cursor += duration
	return {}

func boss_position_for_phase(phase: Dictionary, phase_tick: int) -> Vector2:
	var base: Vector2 = phase.get("origin", Vector2(480, 116))
	var motion: Dictionary = phase.get("motion", {})
	match String(motion.get("type", "static")):
		"sinusoid":
			return base + Vector2(
				BulletMathLib.wave_offset(phase_tick, int(motion.get("period_ticks", 180)), float(motion.get("amplitude_x", 90.0))),
				BulletMathLib.wave_offset(phase_tick, int(motion.get("period_ticks_y", 240)), float(motion.get("amplitude_y", 20.0)), PI * 0.5)
			)
		"ellipse":
			var angle: float = TAU * float(phase_tick) / float(max(1, int(motion.get("period_ticks", 240))))
			return BulletMathLib.ellipse_point(base, angle, float(motion.get("radius_x", 80.0)), float(motion.get("radius_y", 24.0)))
		_:
			return base

func pattern_configs_for_tick(spellbook_id: String, local_tick: int) -> Array[Dictionary]:
	var phase: Dictionary = active_phase(spellbook_id, local_tick)
	var configs: Array[Dictionary] = []
	if phase.is_empty():
		return configs
	var phase_tick: int = int(phase.get("phase_tick", 0))
	var origin: Vector2 = boss_position_for_phase(phase, phase_tick)
	for pattern in phase.get("patterns", []):
		var config: Dictionary = (pattern as Dictionary).duplicate(true)
		config["origin"] = origin + config.get("origin_offset", Vector2.ZERO)
		config["id"] = "%s_%s" % [String(phase.get("id", "phase")), String(config.get("id", config.get("type", "pattern")))]
		var interval: int = max(1, int(config.get("interval_ticks", 60)))
		var offset: int = int(config.get("phase_offset_ticks", 0))
		if phase_tick >= offset and (phase_tick - offset) % interval == 0:
			configs.append(config)
	return configs

func emit_tick(spellbook_id: String, local_tick: int, target: Vector2, spawn_index: int, seed: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var next_index: int = spawn_index
	for config in pattern_configs_for_tick(spellbook_id, local_tick):
		var emitted: Array[Dictionary] = BulletPatterns.emit_pattern(config, local_tick, target, next_index, seed)
		bullets.append_array(emitted)
		next_index += emitted.size()
	return bullets

func validate_spellbooks() -> Dictionary:
	var failures: Array[String] = []
	var catalog_types: Array[String] = BossPatternCatalogLib.all_catalog_pattern_types()
	for spellbook in spellbooks:
		var phases: Array = spellbook.get("phases", [])
		if phases.size() < 3:
			failures.append("too_few_phases:%s" % String(spellbook.get("id", "")))
		for phase in phases:
			var phase_dict: Dictionary = phase as Dictionary
			if int(phase_dict.get("duration_ticks", 0)) <= 0:
				failures.append("bad_duration:%s" % String(phase_dict.get("id", "")))
			if int(phase_dict.get("timeout_ticks", 0)) <= 0:
				failures.append("missing_timeout:%s" % String(phase_dict.get("id", "")))
			if int(phase_dict.get("enrage_after_ticks", 0)) <= 0 or (phase_dict.get("enrage", {}) as Dictionary).is_empty():
				failures.append("missing_enrage:%s" % String(phase_dict.get("id", "")))
			for pattern_type in _phase_pattern_types(phase_dict):
				if not catalog_types.has(pattern_type):
					failures.append("unknown_pattern_type:%s" % pattern_type)
			if String(phase_dict.get("recipe_id", "")).is_empty():
				failures.append("missing_recipe:%s" % String(phase_dict.get("id", "")))
	var emitted_ok: bool = false
	if not spellbooks.is_empty():
		var sample: Array[Dictionary] = emit_tick(String(spellbooks[0].get("id", "")), 0, Vector2(480, 600), 100, 20260625)
		emitted_ok = not sample.is_empty()
	if not emitted_ok:
		failures.append("sample_emit_empty")
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"spellbook_count": spellbooks.size(),
		"phase_count": _phase_count(),
	}

func _spellbook_pattern_types(spellbook: Dictionary) -> Array[String]:
	var types: Array[String] = []
	for phase in spellbook.get("phases", []):
		for pattern_type in _phase_pattern_types(phase as Dictionary):
			if not types.has(pattern_type):
				types.append(pattern_type)
	return types

func _spellbook_family_ids(spellbook: Dictionary) -> Array[String]:
	var ids: Array[String] = []
	for phase in spellbook.get("phases", []):
		for family_id in _phase_family_ids(phase as Dictionary):
			if not ids.has(family_id):
				ids.append(family_id)
	return ids

func _spellbook_recipe_ids(spellbook: Dictionary) -> Array[String]:
	var ids: Array[String] = []
	for phase in spellbook.get("phases", []):
		var recipe_id: String = String((phase as Dictionary).get("recipe_id", ""))
		if not recipe_id.is_empty() and not ids.has(recipe_id):
			ids.append(recipe_id)
	return ids

func _phase_pattern_types(phase: Dictionary) -> Array[String]:
	var types: Array[String] = []
	for pattern in phase.get("patterns", []):
		var pattern_type: String = String((pattern as Dictionary).get("type", ""))
		if not pattern_type.is_empty() and not types.has(pattern_type):
			types.append(pattern_type)
	return types

func _phase_family_ids(phase: Dictionary) -> Array[String]:
	var ids: Array[String] = []
	for family_id in phase.get("family_ids", []):
		ids.append(String(family_id))
	return ids

func _phase_count() -> int:
	var count: int = 0
	for spellbook in spellbooks:
		count += (spellbook.get("phases", []) as Array).size()
	return count

func _rebuild_index() -> void:
	spellbook_by_id.clear()
	for spellbook in spellbooks:
		spellbook_by_id[String(spellbook.get("id", ""))] = spellbook

func _build_spellbooks() -> Array[Dictionary]:
	return [
		{
			"id": "original_boss_archive",
			"name_key": "boss_spellbook.original_archive.name",
			"source_policy": "original_mechanic_matrix",
			"phases": [
				{
					"id": "nonspell_radial_entry",
					"kind": "nonspell",
					"duration_ticks": 420,
					"timeout_ticks": 420,
					"enrage_after_ticks": 336,
					"enrage": {"density_multiplier": 1.12, "speed_multiplier": 1.06, "allow_timeout_clear": true},
					"origin": Vector2(480, 116),
					"motion": {"type": "sinusoid", "period_ticks": 180, "amplitude_x": 80.0, "amplitude_y": 10.0},
					"family_ids": ["radial", "aimed"],
					"recipe_id": "taisei_mechanic_syntax",
					"patterns": [
						{"id": "ring", "type": "alternating_ring", "interval_ticks": 28, "count": 24, "speed": 112.0, "radius": 4.6, "color": "gold"},
						{"id": "gap", "type": "gap_ring", "interval_ticks": 64, "phase_offset_ticks": 8, "count": 32, "speed": 104.0, "radius": 4.3, "gap_width": PI * 0.28, "gap_count": 2, "gap_spin_per_tick": 0.01, "spin_per_tick": 0.016, "color": "gold"},
						{"id": "fan", "type": "curve_fan", "interval_ticks": 56, "phase_offset_ticks": 14, "count": 7, "speed": 124.0, "radius": 4.2, "spread": PI * 0.3, "angular_velocity": PI / 514.0, "color": "green"},
						{"id": "snake", "type": "snake_stream", "interval_ticks": 72, "phase_offset_ticks": 18, "count": 5, "speed": 118.0, "radius": 4.2, "spread": PI * 0.18, "snake_amplitude": PI / 11.0, "wave_period_ticks": 82, "spawn_wave_per_tick": 0.06, "lifetime_ticks": 260, "color": "green"},
						{"id": "hold", "type": "stop_release", "interval_ticks": 84, "phase_offset_ticks": 28, "count": 18, "speed": 82.0, "release_speed": 138.0, "radius": 4.1, "stop_tick": 14, "release_tick": 54, "drift_multiplier": 0.16, "color": "cyan"},
					],
				},
				{
					"id": "spell_laser_field",
					"kind": "spell",
					"duration_ticks": 540,
					"timeout_ticks": 540,
					"enrage_after_ticks": 432,
					"enrage": {"density_multiplier": 1.10, "speed_multiplier": 1.04, "warning_ticks_delta": -6},
					"origin": Vector2(480, 110),
					"motion": {"type": "ellipse", "period_ticks": 260, "radius_x": 72.0, "radius_y": 18.0},
					"family_ids": ["laser", "field"],
					"recipe_id": "godot_bullet_hell_tooling",
					"patterns": [
						{"id": "beam", "type": "beam_sweep", "interval_ticks": 110, "count": 3, "radius": 4.8, "length": 720.0, "spread": PI * 0.2556, "warning_ticks": 42, "graze_cooldown_ticks": 12, "color": "white"},
						{"id": "rotor", "type": "rotating_laser", "interval_ticks": 168, "phase_offset_ticks": 18, "count": 2, "radius": 4.8, "length": 700.0, "spread": PI, "warning_ticks": 42, "angular_velocity": PI / 240.0, "graze_cooldown_ticks": 12, "lifetime_ticks": 180, "color": "white"},
						{"id": "cross", "type": "cross_laser", "interval_ticks": 176, "phase_offset_ticks": 24, "arms": 4, "radius": 4.7, "length": 700.0, "warning_ticks": 42, "angular_velocity": PI / 560.0, "graze_cooldown_ticks": 12, "lifetime_ticks": 190, "color": "white"},
						{"id": "extend", "type": "extend_laser", "interval_ticks": 156, "phase_offset_ticks": 28, "count": 2, "radius": 4.8, "start_length": 28.0, "length": 680.0, "spread": PI * 0.22, "warning_ticks": 38, "extend_duration_ticks": 44, "graze_cooldown_ticks": 12, "lifetime_ticks": 184, "color": "white"},
						{"id": "curve_beam", "type": "curved_laser", "interval_ticks": 132, "phase_offset_ticks": 36, "count": 2, "radius": 4.6, "length": 620.0, "curve": 74.0, "segments": 7, "spread": PI * 0.2, "warning_ticks": 42, "graze_cooldown_ticks": 12, "color": "violet"},
						{"id": "reflect", "type": "reflect_laser", "interval_ticks": 170, "phase_offset_ticks": 48, "count": 2, "radius": 4.6, "length": 740.0, "spread": PI * 0.18, "bounces": 2, "warning_ticks": 42, "graze_cooldown_ticks": 12, "color": "white"},
						{"id": "wave", "type": "wave_laser", "interval_ticks": 164, "phase_offset_ticks": 58, "count": 2, "radius": 4.6, "length": 640.0, "segments": 9, "wave_amplitude": 48.0, "wave_speed": 0.075, "spread": PI * 0.18, "warning_ticks": 42, "graze_cooldown_ticks": 12, "lifetime_ticks": 210, "color": "cyan"},
						{"id": "wall", "type": "grid_rain", "interval_ticks": 32, "phase_offset_ticks": 16, "count": 10, "rows": 2, "speed": 118.0, "radius": 4.0, "width": 540.0, "color": "cyan"},
						{"id": "edge", "type": "edge_spawn", "interval_ticks": 64, "phase_offset_ticks": 20, "count": 12, "speed": 118.0, "radius": 4.0, "edge": "all", "spawn_bounds": Rect2(Vector2(170, 58), Vector2(620, 592)), "edge_margin": 18.0, "angle_jitter": PI / 60.0, "lane_jitter": 6.0, "color": "white"},
						{"id": "gate", "type": "gate_lanes", "interval_ticks": 42, "phase_offset_ticks": 22, "count": 15, "speed": 122.0, "radius": 4.0, "width": 560.0, "gate_width": 110.0, "gate_period_ticks": 180, "speed_wave": 12.0, "color": "gold"},
					],
				},
				{
					"id": "spell_summoner_split",
					"kind": "spell",
					"duration_ticks": 600,
					"timeout_ticks": 600,
					"enrage_after_ticks": 480,
					"enrage": {"density_multiplier": 1.16, "speed_multiplier": 1.05, "carrier_lifetime_scale": 0.92},
					"origin": Vector2(480, 124),
					"motion": {"type": "static"},
					"family_ids": ["delayed", "field", "random_seeded"],
					"recipe_id": "danmaku_unity_engine_syntax",
					"patterns": [
						{"id": "summon", "type": "summoner_orbit", "interval_ticks": 150, "count": 4, "speed": 28.0, "radius": 6.2, "orbit_radius": 96.0, "emit_interval_ticks": 24, "emit_count": 8, "emit_speed": 112.0, "lifetime_ticks": 108, "color": "violet", "emit_color": "gold"},
						{"id": "orbit_release", "type": "orbit_release", "interval_ticks": 128, "phase_offset_ticks": 18, "count": 14, "speed": 124.0, "radius": 4.2, "orbit_radius": 82.0, "orbit_spin": 0.042, "release_tick": 44, "release_mode": "player", "release_speed": 132.0, "spin_per_tick": 0.017, "color": "green"},
						{"id": "telegraph", "type": "telegraph_burst", "interval_ticks": 112, "phase_offset_ticks": 26, "count": 9, "speed": 126.0, "radius": 4.0, "trigger_tick": 42, "burst_mode": "fan", "aim_mode": "player", "spread": PI * 0.42, "warning_radius": 11.0, "warning_color": "violet", "color": "gold"},
						{"id": "charge", "type": "charge_burst", "interval_ticks": 136, "phase_offset_ticks": 32, "count": 18, "speed": 122.0, "radius": 4.0, "charge_radius": 8.0, "charge_grow": 0.18, "max_charge_radius": 18.0, "trigger_tick": 48, "burst_mode": "ring", "burst_spin_per_tick": 0.018, "charge_color": "violet", "color": "gold"},
						{"id": "trap", "type": "trap_marker", "interval_ticks": 124, "phase_offset_ticks": 38, "count": 4, "emit_count": 5, "speed": 126.0, "radius": 4.0, "marker_radius": 9.5, "placement": "around_player", "placement_radius": 86.0, "position_jitter": 10.0, "trigger_tick": 42, "release_mode": "fan", "aim_mode": "player", "spread": PI * 0.2, "marker_color": "violet", "color": "gold"},
						{"id": "path", "type": "path_emitters", "interval_ticks": 180, "phase_offset_ticks": 42, "count": 2, "path_radius_x": 230.0, "path_radius_y": 64.0, "path_duration_ticks": 240, "emit_interval_ticks": 26, "emit_count": 7, "emit_speed": 108.0, "emit_radius": 4.0, "lifetime_ticks": 260, "carrier_color": "cyan", "emit_color": "white"},
						{"id": "path_follow", "type": "path_follow", "interval_ticks": 132, "phase_offset_ticks": 50, "count": 8, "speed": 0.0, "radius": 4.2, "path_radius_x": 210.0, "path_radius_y": 72.0, "path_duration_ticks": 210, "lifetime_ticks": 210, "color": "green"},
						{"id": "bezier", "type": "bezier_follow", "interval_ticks": 144, "phase_offset_ticks": 54, "count": 7, "speed": 0.0, "radius": 4.1, "control_points": [Vector2(-220, 0), Vector2(-120, 120), Vector2(120, -96), Vector2(220, 0)], "path_duration_ticks": 220, "lifetime_ticks": 220, "color": "violet"},
						{"id": "trail", "type": "trail_emitters", "interval_ticks": 156, "phase_offset_ticks": 58, "count": 4, "speed": 54.0, "width": 410.0, "carrier_radius": 5.2, "emit_interval_ticks": 20, "emit_start_tick": 8, "emit_count": 5, "emit_speed": 106.0, "emit_radius": 3.8, "emit_spin": 0.16, "lifetime_ticks": 140, "carrier_color": "cyan", "emit_color": "gold"},
						{"id": "aim_hold", "type": "delayed_aim_ring", "interval_ticks": 96, "phase_offset_ticks": 34, "count": 16, "speed": 82.0, "release_speed": 146.0, "radius": 4.0, "hold_tick": 14, "aim_tick": 46, "aim_mode": "player", "drift_multiplier": 0.14, "spin_per_tick": 0.018, "color": "white"},
						{"id": "cloud", "type": "converge_cloud", "interval_ticks": 68, "phase_offset_ticks": 20, "count": 16, "speed": 108.0, "radius": 4.0, "spawn_radius": 260.0, "converge_point": Vector2(480, 500), "color": "red"},
						{"id": "vortex", "type": "vortex_field", "interval_ticks": 96, "phase_offset_ticks": 44, "count": 12, "speed": 82.0, "radius": 3.9, "spawn_radius": 230.0, "field_center": Vector2(480, 360), "pull_strength": 1.8, "tangent_strength": 3.2, "max_speed": 166.0, "lifetime_ticks": 240, "color": "cyan"},
					],
				},
				{
					"id": "last_spell_morph_bounce",
					"kind": "last_spell",
					"duration_ticks": 720,
					"timeout_ticks": 720,
					"enrage_after_ticks": 540,
					"enrage": {"density_multiplier": 1.20, "speed_multiplier": 1.08, "timeout_pressure": true},
					"origin": Vector2(480, 118),
					"motion": {"type": "sinusoid", "period_ticks": 150, "amplitude_x": 110.0, "period_ticks_y": 210, "amplitude_y": 18.0},
					"family_ids": ["radial", "field", "laser"],
					"recipe_id": "taisei_mechanic_syntax",
					"patterns": [
						{"id": "morph", "type": "morph_ring", "interval_ticks": 40, "count": 30, "speed": 106.0, "radius": 4.2, "lobes": 5, "wave_amplitude": 0.32, "spin_per_tick": 0.024, "color": "green"},
						{"id": "phase_shift", "type": "phase_shift_ring", "interval_ticks": 92, "phase_offset_ticks": 12, "count": 18, "speed": 74.0, "radius": 4.0, "shift_tick": 40, "shift_mode": "player", "shift_speed": 138.0, "acceleration_after_shift": 0.4, "spin_per_tick": 0.018, "color": "white"},
						{"id": "scale_pulse", "type": "scale_pulse_ring", "interval_ticks": 104, "phase_offset_ticks": 26, "count": 16, "speed": 86.0, "radius": 3.0, "base_radius": 3.0, "target_radius": 8.2, "grow_start_tick": 12, "grow_duration_ticks": 44, "pulse_amplitude": 1.1, "pulse_period_ticks": 68, "spin_per_tick": 0.016, "lifetime_ticks": 260, "color": "violet"},
						{"id": "return", "type": "boomerang_ring", "interval_ticks": 76, "phase_offset_ticks": 18, "count": 24, "speed": 112.0, "radius": 4.1, "turn_tick": 44, "return_mode": "target", "return_target": Vector2(480, 118), "return_speed": 138.0, "pre_turn_acceleration": -1.0, "spin_per_tick": 0.018, "color": "gold"},
						{"id": "bounce", "type": "wall_bounce", "interval_ticks": 64, "phase_offset_ticks": 24, "count": 7, "speed": 130.0, "radius": 4.2, "spread": PI * 0.4889, "bounces": 2, "color": "cyan"},
						{"id": "laser", "type": "sweep_laser", "interval_ticks": 132, "phase_offset_ticks": 44, "count": 5, "speed": 116.0, "radius": 5.4, "spread": PI * 0.3889, "warning_ticks": 36, "graze_cooldown_ticks": 18, "color": "violet"},
					],
				},
			],
		},
	]
