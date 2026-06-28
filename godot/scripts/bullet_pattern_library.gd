class_name BulletPatternLibrary
extends RefCounted

const BulletMathLib := preload("res://scripts/bullet_math.gd")

const BULLET_COLORS := {
	"red": Color(0.95, 0.23, 0.28),
	"gold": Color(0.95, 0.72, 0.25),
	"cyan": Color(0.25, 0.80, 1.00),
	"violet": Color(0.76, 0.50, 1.00),
	"green": Color(0.40, 0.92, 0.55),
	"white": Color(0.95, 0.96, 1.00),
}

static func make_bullet(origin: Vector2, angle: float, speed: float, radius: float, pattern_id: String, spawn_index: int, color_name: String = "red", behavior: Dictionary = {}) -> Dictionary:
	return {
		"pos": origin,
		"vel": BulletMathLib.direction(angle) * speed,
		"radius": radius,
		"color": BULLET_COLORS.get(color_name, BULLET_COLORS["red"]),
		"color_name": color_name,
		"grazed": false,
		"grazed_players": {},
		"graze_key": "%s:%d" % [pattern_id, spawn_index],
		"age_ticks": 0,
		"pattern_id": pattern_id,
		"spawn_index": spawn_index,
		"behavior": behavior,
	}

static func make_shaped_bullet(origin: Vector2, angle: float, speed: float, radius: float, pattern_id: String, spawn_index: int, color_name: String, behavior: Dictionary, shape: Dictionary) -> Dictionary:
	var bullet := make_bullet(origin, angle, speed, radius, pattern_id, spawn_index, color_name, behavior)
	for key in shape.keys():
		bullet[key] = shape[key]
	bullet["angle"] = float(bullet.get("angle", angle))
	return bullet

static func emit_ring(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 18))
	var speed: float = float(config.get("speed", 120.0))
	var radius: float = float(config.get("radius", 5.0))
	var offset: float = float(config.get("angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "ring"))
	var color_name: String = String(config.get("color", "red"))
	for i in range(count):
		var angle: float = offset + TAU * float(i) / float(count)
		bullets.append(make_bullet(origin, angle, speed, radius, pattern_id, spawn_index + i, color_name))
	return bullets

static func emit_gap_ring(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = max(1, int(config.get("count", 28)))
	var speed: float = float(config.get("speed", 116.0))
	var radius: float = float(config.get("radius", 4.6))
	var offset: float = float(config.get("angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.0)) * float(tick)
	var gap_center: float = offset + float(config.get("gap_angle", PI * 0.5)) + float(config.get("gap_spin_per_tick", 0.0)) * float(tick)
	var gap_width: float = maxf(0.0, float(config.get("gap_width", deg_to_rad(42.0))))
	var gap_count: int = max(1, int(config.get("gap_count", 1)))
	var pattern_id: String = String(config.get("id", "gap_ring"))
	var color_name: String = String(config.get("color", "gold"))
	for i in range(count):
		var angle: float = offset + TAU * float(i) / float(count)
		var in_gap := false
		for gap_index in range(gap_count):
			var center: float = gap_center + TAU * float(gap_index) / float(gap_count)
			var delta: float = absf(angle_difference(angle, center))
			if delta <= gap_width * 0.5:
				in_gap = true
				break
		if in_gap:
			continue
		bullets.append(make_bullet(origin, angle, speed, radius, pattern_id, spawn_index + bullets.size(), color_name))
	return bullets

static func emit_n_way(config: Dictionary, target: Vector2, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var lanes: int = int(config.get("count", 5))
	var speed: float = float(config.get("speed", 150.0))
	var radius: float = float(config.get("radius", 5.0))
	var spread: float = float(config.get("spread", deg_to_rad(60.0)))
	var pattern_id: String = String(config.get("id", "n_way"))
	var color_name: String = String(config.get("color", "cyan"))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) * float(config.get("aim_bias", 1.0))
	base_angle += float(config.get("angle_offset", 0.0))
	for i in range(lanes):
		var lane_ratio: float = 0.5 if lanes == 1 else float(i) / float(lanes - 1)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, lane_ratio)
		bullets.append(make_bullet(origin, angle, speed, radius, pattern_id, spawn_index + i, color_name))
	return bullets

static func emit_random_arc(config: Dictionary, tick: int, spawn_index: int, seed: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 10))
	var radius: float = float(config.get("radius", 4.5))
	var speed: float = float(config.get("speed", 130.0))
	var speed_jitter: float = float(config.get("speed_jitter", 45.0))
	var center_angle: float = float(config.get("angle_offset", PI * 0.5))
	var spread: float = float(config.get("spread", PI))
	var pattern_id: String = String(config.get("id", "random_arc"))
	var color_name: String = String(config.get("color", "gold"))
	for i in range(count):
		var index: int = spawn_index + i
		var angle: float = center_angle + BulletMathLib.deterministic_range(seed, tick, pattern_id, index, 1, -spread * 0.5, spread * 0.5)
		var bullet_speed: float = speed + BulletMathLib.deterministic_range(seed, tick, pattern_id, index, 2, -speed_jitter, speed_jitter)
		bullets.append(make_bullet(origin, angle, bullet_speed, radius, pattern_id, index, color_name))
	return bullets

static func emit_split_chain(config: Dictionary, target: Vector2, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = emit_n_way(config, target, spawn_index)
	var split_count: int = int(config.get("split_count", 6))
	var split_speed: float = float(config.get("split_speed", float(config.get("speed", 120.0)) * 0.8))
	var split_delay_ticks: int = int(config.get("split_delay_ticks", 54))
	var pattern_id: String = String(config.get("id", "split_chain"))
	for i in range(bullets.size()):
		var velocity: Vector2 = bullets[i]["vel"]
		var angle: float = velocity.angle()
		bullets[i]["behavior"] = {
			"type": "split",
			"delay_ticks": split_delay_ticks,
			"count": split_count,
			"speed": split_speed,
			"radius": float(config.get("split_radius", 4.0)),
			"angle_offset": angle + float(config.get("split_angle_offset", 0.0)),
			"color": String(config.get("split_color", "violet")),
			"pattern_id": pattern_id + "_split",
		}
	return bullets

static func emit_blossom(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullet: Dictionary = make_bullet(
		config.get("origin", Vector2.ZERO),
		float(config.get("angle_offset", PI * 0.5)),
		float(config.get("speed", 86.0)),
		float(config.get("radius", 6.5)),
		String(config.get("id", "blossom")),
		spawn_index,
		String(config.get("color", "green")),
		{
			"type": "blossom",
			"delay_ticks": int(config.get("blossom_delay_ticks", 72)),
			"count": int(config.get("count", 20)),
			"speed": float(config.get("blossom_speed", 115.0)),
			"radius": float(config.get("blossom_radius", 4.5)),
			"angle_offset": float(config.get("blossom_angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.0)) * float(tick),
			"color": String(config.get("blossom_color", "gold")),
			"pattern_id": String(config.get("id", "blossom")) + "_open",
		}
	)
	return [bullet]

static func emit_telegraph_burst(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var target_point: Vector2 = config.get("target_point", target)
	var aim_mode: String = String(config.get("aim_mode", "fixed"))
	var warning_angle: float = float(config.get("angle_offset", 0.0))
	if aim_mode == "player":
		warning_angle = BulletMathLib.angle_to_target(origin, target)
	elif aim_mode == "target":
		warning_angle = BulletMathLib.angle_to_target(origin, target_point)
	var pattern_id: String = String(config.get("id", "telegraph_burst"))
	var carrier: Dictionary = make_bullet(origin, 0.0, 0.0, float(config.get("warning_radius", 9.0)), pattern_id, spawn_index, String(config.get("warning_color", config.get("color", "violet"))), {
		"type": "telegraph_burst",
		"trigger_tick": int(config.get("trigger_tick", 48)),
		"burst_mode": String(config.get("burst_mode", "ring")),
		"count": int(config.get("count", 16)),
		"speed": float(config.get("speed", 124.0)),
		"radius": float(config.get("radius", 4.2)),
		"angle_offset": warning_angle,
		"spread": float(config.get("spread", TAU)),
		"color": String(config.get("color", "gold")),
		"pattern_id": pattern_id + "_burst",
		"target_point": target_point,
		"aim_mode": aim_mode,
		"spin_per_tick": float(config.get("spin_per_tick", 0.0)),
	})
	carrier["collidable"] = false
	carrier["carrier"] = true
	carrier["telegraph"] = true
	carrier["warning_ticks"] = int(config.get("trigger_tick", 48))
	return [carrier]

static func emit_charge_burst(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var aim_mode: String = String(config.get("aim_mode", "fixed"))
	var charge_angle: float = float(config.get("angle_offset", 0.0))
	if aim_mode == "player":
		charge_angle = BulletMathLib.angle_to_target(origin, target)
	elif aim_mode == "target":
		charge_angle = BulletMathLib.angle_to_target(origin, config.get("target_point", target))
	charge_angle += float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "charge_burst"))
	var carrier: Dictionary = make_bullet(origin, 0.0, 0.0, float(config.get("charge_radius", 8.0)), pattern_id, spawn_index, String(config.get("charge_color", config.get("color", "violet"))), {
		"type": "charge_burst",
		"trigger_tick": int(config.get("trigger_tick", 54)),
		"burst_mode": String(config.get("burst_mode", "ring")),
		"count": int(config.get("count", 18)),
		"speed": float(config.get("speed", 124.0)),
		"radius": float(config.get("radius", 4.2)),
		"angle_offset": charge_angle,
		"spread": float(config.get("spread", TAU)),
		"speed_step": float(config.get("speed_step", 0.0)),
		"split_count": int(config.get("split_count", 12)),
		"split_delay_ticks": int(config.get("split_delay_ticks", 36)),
		"split_speed": float(config.get("split_speed", config.get("speed", 124.0))),
		"color": String(config.get("color", "gold")),
		"pattern_id": pattern_id + "_burst",
		"target_point": config.get("target_point", target),
		"aim_mode": aim_mode,
		"spin_per_tick": float(config.get("burst_spin_per_tick", 0.0)),
		"charge_grow": float(config.get("charge_grow", 0.0)),
		"max_charge_radius": float(config.get("max_charge_radius", 24.0)),
	})
	carrier["collidable"] = false
	carrier["carrier"] = true
	carrier["telegraph"] = true
	carrier["warning_ticks"] = int(config.get("trigger_tick", 54))
	return [carrier]

static func emit_trap_marker(config: Dictionary, target: Vector2, tick: int, spawn_index: int, seed: int) -> Array[Dictionary]:
	var markers: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var marker_count: int = max(1, int(config.get("count", 4)))
	var placement: String = String(config.get("placement", "around_player"))
	var marker_radius: float = float(config.get("marker_radius", config.get("warning_radius", 9.0)))
	var placement_radius: float = float(config.get("placement_radius", 96.0))
	var width: float = float(config.get("width", 360.0))
	var rows: int = max(1, int(config.get("rows", 1)))
	var row_spacing: float = float(config.get("row_spacing", 42.0))
	var angle_offset: float = float(config.get("angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.0)) * float(tick)
	var position_jitter: float = float(config.get("position_jitter", 0.0))
	var pattern_id: String = String(config.get("id", "trap_marker"))
	var marker_color: String = String(config.get("marker_color", config.get("warning_color", "violet")))
	for i in range(marker_count):
		var ratio: float = 0.5 if marker_count <= 1 else float(i) / float(marker_count - 1)
		var lane_angle: float = angle_offset + TAU * float(i) / float(marker_count)
		var marker_pos: Vector2 = target
		match placement:
			"ring":
				marker_pos = origin + BulletMathLib.direction(lane_angle) * placement_radius
			"line":
				marker_pos = origin + Vector2(lerpf(-width * 0.5, width * 0.5, ratio), 0.0)
			"grid":
				var columns: int = max(1, int(ceil(float(marker_count) / float(rows))))
				var row: int = int(i / columns)
				var column: int = i % columns
				var column_ratio: float = 0.5 if columns <= 1 else float(column) / float(columns - 1)
				marker_pos = origin + Vector2(lerpf(-width * 0.5, width * 0.5, column_ratio), (float(row) - float(rows - 1) * 0.5) * row_spacing)
			"target_line":
				marker_pos = target + Vector2(lerpf(-width * 0.5, width * 0.5, ratio), 0.0)
			_:
				marker_pos = target + BulletMathLib.direction(lane_angle) * placement_radius
		if position_jitter > 0.0:
			var jitter_angle: float = BulletMathLib.deterministic_range(seed, tick, pattern_id, spawn_index + i, 12, -PI, PI)
			var jitter_distance: float = BulletMathLib.deterministic_range(seed, tick, pattern_id, spawn_index + i, 13, 0.0, position_jitter)
			marker_pos += BulletMathLib.direction(jitter_angle) * jitter_distance
		var marker: Dictionary = make_bullet(marker_pos, 0.0, 0.0, marker_radius, pattern_id, spawn_index + i, marker_color, {
			"type": "trap_marker",
			"trigger_tick": int(config.get("trigger_tick", 48)),
			"release_mode": String(config.get("release_mode", "fan")),
			"aim_mode": String(config.get("aim_mode", "player")),
			"emit_count": int(config.get("emit_count", 5)),
			"speed": float(config.get("speed", 128.0)),
			"radius": float(config.get("radius", 4.1)),
			"spread": float(config.get("spread", deg_to_rad(42.0))),
			"angle_offset": float(config.get("release_angle_offset", 0.0)),
			"spin_per_tick": float(config.get("release_spin_per_tick", 0.0)),
			"speed_step": float(config.get("speed_step", 0.0)),
			"color": String(config.get("color", "gold")),
			"pattern_id": pattern_id + "_release",
			"trap_origin": origin,
			"target_point": config.get("target_point", target),
			"child_spawn_index": spawn_index + i * 1000,
		})
		marker["collidable"] = false
		marker["carrier"] = true
		marker["telegraph"] = true
		marker["warning_ticks"] = int(config.get("trigger_tick", 48))
		markers.append(marker)
	return markers

static func emit_homing(config: Dictionary, target: Vector2, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = emit_n_way(config, target, spawn_index)
	for i in range(bullets.size()):
		bullets[i]["behavior"] = {
			"type": "homing",
			"turn_rate": float(config.get("turn_rate", deg_to_rad(2.2))),
			"speed": float(config.get("speed", 92.0)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 150)),
		}
	return bullets

static func emit_flower(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var petals: int = int(config.get("petals", 6))
	var layers: int = int(config.get("layers", 2))
	var per_layer: int = int(config.get("count", petals))
	var speed: float = float(config.get("speed", 116.0))
	var speed_step: float = float(config.get("speed_step", 16.0))
	var radius: float = float(config.get("radius", 4.5))
	var phase: float = float(config.get("angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "flower"))
	var color_name: String = String(config.get("color", "green"))
	for layer in range(max(1, layers)):
		for i in range(max(1, per_layer)):
			var angle: float = BulletMathLib.flower_angle(i, per_layer, petals, phase + float(layer) * PI / float(max(1, petals)))
			var layer_speed: float = speed + float(layer) * speed_step
			bullets.append(make_bullet(origin, angle, layer_speed, radius, pattern_id, spawn_index + bullets.size(), color_name))
	return bullets

static func emit_sine_stream(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 3))
	var speed: float = float(config.get("speed", 138.0))
	var radius: float = float(config.get("radius", 4.5))
	var spread: float = float(config.get("spread", deg_to_rad(32.0)))
	var wave: float = BulletMathLib.wave_offset(tick, int(config.get("wave_period_ticks", 72)), float(config.get("wave_amplitude", 36.0)))
	var base_angle: float = float(config.get("angle_offset", PI * 0.5)) + deg_to_rad(wave * 0.18)
	var pattern_id: String = String(config.get("id", "sine_stream"))
	var color_name: String = String(config.get("color", "cyan"))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var lateral := Vector2(lerpf(-wave, wave, ratio), 0.0)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		bullets.append(make_bullet(origin + lateral, angle, speed, radius, pattern_id, spawn_index + i, color_name))
	return bullets

static func emit_snake_stream(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 5))
	var speed: float = float(config.get("speed", 126.0))
	var radius: float = float(config.get("radius", 4.4))
	var spread: float = float(config.get("spread", deg_to_rad(34.0)))
	var base_angle: float = float(config.get("angle_offset", PI * 0.5))
	if bool(config.get("aimed", false)):
		base_angle = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	base_angle += float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "snake_stream"))
	var color_name: String = String(config.get("color", "green"))
	var snake_amplitude: float = float(config.get("snake_amplitude", deg_to_rad(18.0)))
	var wave_period_ticks: int = max(1, int(config.get("wave_period_ticks", 72)))
	var phase_base: float = float(config.get("wave_phase", 0.0)) + float(config.get("spawn_wave_per_tick", 0.0)) * float(tick)
	var phase_step: float = float(config.get("wave_phase_step", PI))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var lane_angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		var phase: float = phase_base + ratio * phase_step
		var current_angle: float = lane_angle + sin(phase) * snake_amplitude
		bullets.append(make_bullet(origin, current_angle, speed, radius, pattern_id, spawn_index + i, color_name, {
			"type": "snake",
			"base_angle": lane_angle,
			"speed": speed,
			"snake_amplitude": snake_amplitude,
			"wave_period_ticks": wave_period_ticks,
			"wave_phase": phase,
			"acceleration": float(config.get("acceleration", 0.0)),
			"min_speed": float(config.get("min_speed", 0.0)),
			"max_speed": float(config.get("max_speed", 9999.0)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 300)),
		}))
	return bullets

static func emit_curtain(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 13))
	var width: float = float(config.get("width", 520.0))
	var sway: float = BulletMathLib.wave_offset(tick, int(config.get("wave_period_ticks", 120)), float(config.get("sway", 0.0)))
	var speed: float = float(config.get("speed", 124.0))
	var radius: float = float(config.get("radius", 4.8))
	var pattern_id: String = String(config.get("id", "curtain"))
	var color_name: String = String(config.get("color", "gold"))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var x_offset: float = lerpf(-width * 0.5, width * 0.5, ratio) + sway * sin(TAU * ratio)
		var speed_scale: float = 0.88 + 0.24 * absf(ratio - 0.5) * 2.0
		bullets.append(make_bullet(origin + Vector2(x_offset, 0.0), PI * 0.5, speed * speed_scale, radius, pattern_id, spawn_index + i, color_name))
	return bullets

static func emit_burst(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 18))
	var speed: float = float(config.get("speed", 156.0))
	var speed_step: float = float(config.get("speed_step", 0.0))
	var radius: float = float(config.get("radius", 3.8))
	var spread: float = float(config.get("spread", deg_to_rad(28.0)))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	base_angle += float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "burst"))
	var color_name: String = String(config.get("color", "white"))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		var bullet_speed: float = speed + absf(float(i) - float(count - 1) * 0.5) * speed_step
		bullets.append(make_bullet(origin, angle, bullet_speed, radius, pattern_id, spawn_index + i, color_name))
	return bullets

static func emit_laser_curtain(config: Dictionary, target: Vector2, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 7))
	var spacing: float = float(config.get("lane_spacing", 34.0))
	var speed: float = float(config.get("speed", 150.0))
	var radius: float = float(config.get("radius", 5.0))
	var spread: float = float(config.get("spread", deg_to_rad(96.0)))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target)
	var pattern_id: String = String(config.get("id", "laser_curtain"))
	var color_name: String = String(config.get("color", "white"))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var lateral := Vector2((float(i) - float(count - 1) * 0.5) * spacing, 0.0)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		var bullet := make_bullet(origin + lateral, angle, speed, radius, pattern_id, spawn_index + i, color_name, {
			"type": "laser_warning",
			"warning_ticks": int(config.get("warning_ticks", 36)),
		})
		bullets.append(bullet)
	return bullets

static func emit_orbital(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 12))
	var orbit_radius: float = float(config.get("orbit_radius", 58.0))
	var orbit_spin: float = float(config.get("orbit_spin", 0.08))
	var speed: float = float(config.get("speed", 110.0))
	var radius: float = float(config.get("radius", 4.5))
	var phase: float = float(config.get("angle_offset", 0.0)) + orbit_spin * float(tick)
	var pattern_id: String = String(config.get("id", "orbital"))
	var color_name: String = String(config.get("color", "violet"))
	for i in range(max(1, count)):
		var angle: float = phase + TAU * float(i) / float(count)
		var bullet_origin: Vector2 = BulletMathLib.polar(origin, angle, orbit_radius)
		bullets.append(make_bullet(bullet_origin, angle + PI * 0.5, speed, radius, pattern_id, spawn_index + i, color_name))
	return bullets

static func emit_orbit_release(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 12))
	var orbit_radius: float = float(config.get("orbit_radius", 84.0))
	var orbit_spin: float = float(config.get("orbit_spin", 0.035))
	var radius: float = float(config.get("radius", 4.6))
	var phase: float = float(config.get("angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "orbit_release"))
	var color_name: String = String(config.get("color", "gold"))
	for i in range(max(1, count)):
		var angle: float = phase + TAU * float(i) / float(max(1, count))
		var bullet_origin: Vector2 = BulletMathLib.polar(origin, angle, orbit_radius)
		bullets.append(make_bullet(bullet_origin, angle, 0.0, radius, pattern_id, spawn_index + i, color_name, {
			"type": "orbit_release",
			"center": origin,
			"orbit_radius": orbit_radius,
			"orbit_spin": orbit_spin,
			"phase": angle,
			"release_tick": int(config.get("release_tick", 54)),
			"release_mode": String(config.get("release_mode", "radial")),
			"release_speed": float(config.get("release_speed", float(config.get("speed", 126.0)))),
			"release_target": config.get("release_target", origin),
			"lifetime_ticks": int(config.get("lifetime_ticks", 360)),
			"released": false,
		}))
	return bullets

static func emit_spiral_stack(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var arms: int = int(config.get("count", 6))
	var layers: int = int(config.get("layers", 3))
	var speed: float = float(config.get("speed", 92.0))
	var speed_step: float = float(config.get("speed_step", 22.0))
	var radius: float = float(config.get("radius", 4.4))
	var phase: float = float(config.get("angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.055)) * float(tick)
	var layer_offset: float = float(config.get("layer_angle_offset", PI / 9.0))
	var pattern_id: String = String(config.get("id", "spiral_stack"))
	var color_name: String = String(config.get("color", "red"))
	for layer in range(max(1, layers)):
		for i in range(max(1, arms)):
			var angle := phase + TAU * float(i) / float(arms) + float(layer) * layer_offset
			var bullet_speed := speed + float(layer) * speed_step
			bullets.append(make_bullet(origin, angle, bullet_speed, radius, pattern_id, spawn_index + bullets.size(), color_name))
	return bullets

static func emit_alternating_ring(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var config_copy := config.duplicate(true)
	var count: int = max(1, int(config_copy.get("count", 20)))
	var interval: int = max(1, int(config_copy.get("phase_interval_ticks", int(config_copy.get("interval_ticks", 30)))))
	var phase_index := int(tick / interval)
	var lane_phase := TAU / float(count) * 0.5 * float(phase_index % 2)
	config_copy["angle_offset"] = float(config_copy.get("angle_offset", 0.0)) + lane_phase
	return emit_ring(config_copy, tick, spawn_index)

static func emit_accel_ring(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = emit_ring(config, tick, spawn_index)
	for bullet in bullets:
		var velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
		bullet["behavior"] = {
			"type": "accelerate",
			"acceleration": float(config.get("acceleration", 2.0)),
			"max_speed": float(config.get("max_speed", maxf(velocity.length(), float(config.get("speed", 90.0))) + 120.0)),
			"min_speed": float(config.get("min_speed", 12.0)),
			"delay_ticks": int(config.get("accel_delay_ticks", 0)),
		}
	return bullets

static func emit_phase_shift_ring(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = emit_ring(config, tick, spawn_index)
	var shift_mode: String = String(config.get("shift_mode", "radial"))
	var shift_target: Vector2 = config.get("shift_target", config.get("origin", Vector2.ZERO))
	for bullet in bullets:
		var initial_velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
		var radial_angle: float = BulletMathLib.angle_to_target(config.get("origin", Vector2.ZERO), bullet.get("pos", Vector2.ZERO) + initial_velocity.normalized())
		if initial_velocity.length_squared() > 0.0001:
			radial_angle = initial_velocity.angle()
		bullet["vel"] = initial_velocity * float(config.get("pre_shift_speed_scale", 1.0))
		bullet["behavior"] = {
			"type": "phase_shift",
			"shift_tick": int(config.get("shift_tick", 48)),
			"shift_mode": shift_mode,
			"shift_target": shift_target,
			"shift_speed": float(config.get("shift_speed", maxf(initial_velocity.length(), float(config.get("speed", 120.0))))),
			"shift_angle_offset": float(config.get("shift_angle_offset", 0.0)),
			"radial_angle": radial_angle,
			"acceleration_after_shift": float(config.get("acceleration_after_shift", 0.0)),
			"max_speed": float(config.get("max_speed", 240.0)),
			"shifted": false,
		}
	return bullets

static func emit_scale_pulse_ring(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var config_copy: Dictionary = config.duplicate(true)
	var base_radius: float = float(config.get("base_radius", config.get("radius", 3.0)))
	config_copy["radius"] = base_radius
	var bullets: Array[Dictionary] = emit_ring(config_copy, tick, spawn_index)
	var target_radius: float = float(config.get("target_radius", maxf(base_radius, float(config.get("radius", 8.0)))))
	for i in range(bullets.size()):
		var pulse_phase: float = float(config.get("pulse_phase", 0.0)) + float(i) * float(config.get("pulse_phase_step", TAU / float(max(1, bullets.size()))))
		bullets[i]["behavior"] = {
			"type": "scale_pulse",
			"base_radius": base_radius,
			"target_radius": target_radius,
			"grow_start_tick": int(config.get("grow_start_tick", 0)),
			"grow_duration_ticks": max(1, int(config.get("grow_duration_ticks", 36))),
			"pulse_amplitude": float(config.get("pulse_amplitude", 0.0)),
			"pulse_period_ticks": max(1, int(config.get("pulse_period_ticks", 72))),
			"pulse_phase": pulse_phase,
			"min_radius": float(config.get("min_radius", 1.0)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 300)),
		}
	return bullets

static func emit_curve_fan(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = emit_n_way(config, target, spawn_index)
	var curve_step := float(config.get("curve_step", 0.0))
	for i in range(bullets.size()):
		var side := float(i) - float(bullets.size() - 1) * 0.5
		bullets[i]["behavior"] = {
			"type": "curve",
			"angular_velocity": float(config.get("angular_velocity", deg_to_rad(0.65))) + side * curve_step,
			"acceleration": float(config.get("acceleration", 0.0)),
			"min_speed": float(config.get("min_speed", 30.0)),
			"max_speed": float(config.get("max_speed", 220.0)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 240)),
		}
	return bullets

static func emit_grid_rain(config: Dictionary, tick: int, spawn_index: int, seed: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var lanes: int = int(config.get("count", 11))
	var rows: int = int(config.get("rows", 1))
	var width: float = float(config.get("width", 560.0))
	var row_spacing: float = float(config.get("row_spacing", 24.0))
	var speed: float = float(config.get("speed", 132.0))
	var radius: float = float(config.get("radius", 4.2))
	var angle_base: float = float(config.get("angle_offset", PI * 0.5))
	var angle_jitter: float = float(config.get("angle_jitter", deg_to_rad(5.0)))
	var pattern_id: String = String(config.get("id", "grid_rain"))
	var color_name: String = String(config.get("color", "cyan"))
	for row in range(max(1, rows)):
		for lane in range(max(1, lanes)):
			var ratio := 0.5 if lanes == 1 else float(lane) / float(lanes - 1)
			var x_offset := lerpf(-width * 0.5, width * 0.5, ratio)
			var stagger := float((row + lane + int(tick / max(1, int(config.get("interval_ticks", 1))))) % 2) * float(config.get("stagger", 11.0))
			var index := spawn_index + bullets.size()
			var angle := angle_base + BulletMathLib.deterministic_range(seed, tick, pattern_id, index, 3, -angle_jitter, angle_jitter)
			bullets.append(make_bullet(origin + Vector2(x_offset + stagger, -float(row) * row_spacing), angle, speed, radius, pattern_id, index, color_name))
	return bullets

static func emit_edge_spawn(config: Dictionary, target: Vector2, tick: int, spawn_index: int, seed: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var bounds: Rect2 = config.get("spawn_bounds", Rect2(Vector2(160, 48), Vector2(640, 624)))
	var count: int = max(1, int(config.get("count", 12)))
	var speed: float = float(config.get("speed", 124.0))
	var radius: float = float(config.get("radius", 4.2))
	var margin: float = float(config.get("edge_margin", 18.0))
	var edge_mode: String = String(config.get("edge", "top"))
	var aim_mode: String = String(config.get("aim_mode", "inward"))
	var angle_jitter: float = float(config.get("angle_jitter", 0.0))
	var lane_jitter: float = float(config.get("lane_jitter", 0.0))
	var pattern_id: String = String(config.get("id", "edge_spawn"))
	var color_name: String = String(config.get("color", "white"))
	for lane in range(count):
		var side: String = edge_mode
		if edge_mode == "all":
			var sides: Array[String] = ["top", "right", "bottom", "left"]
			side = sides[lane % sides.size()]
		var side_lane: int = lane
		var side_count: int = count
		if edge_mode == "all":
			side_lane = int(lane / 4)
			side_count = int(ceil(float(count) / 4.0))
		var ratio: float = 0.5 if side_count <= 1 else float(side_lane) / float(side_count - 1)
		var jitter: float = BulletMathLib.deterministic_range(seed, tick, pattern_id, spawn_index + lane, 7, -lane_jitter, lane_jitter)
		var pos: Vector2 = Vector2.ZERO
		var angle: float = PI * 0.5
		match side:
			"bottom":
				pos = Vector2(lerpf(bounds.position.x, bounds.end.x, ratio) + jitter, bounds.end.y + margin)
				angle = -PI * 0.5
			"left":
				pos = Vector2(bounds.position.x - margin, lerpf(bounds.position.y, bounds.end.y, ratio) + jitter)
				angle = 0.0
			"right":
				pos = Vector2(bounds.end.x + margin, lerpf(bounds.position.y, bounds.end.y, ratio) + jitter)
				angle = PI
			_:
				pos = Vector2(lerpf(bounds.position.x, bounds.end.x, ratio) + jitter, bounds.position.y - margin)
				angle = PI * 0.5
		if aim_mode == "player":
			angle = BulletMathLib.angle_to_target(pos, target)
		elif aim_mode == "target":
			angle = BulletMathLib.angle_to_target(pos, config.get("target_point", target))
		elif aim_mode == "fixed":
			angle = float(config.get("angle_offset", angle))
		else:
			angle += float(config.get("angle_offset", 0.0))
		angle += BulletMathLib.deterministic_range(seed, tick, pattern_id, spawn_index + lane, 8, -angle_jitter, angle_jitter)
		var lane_speed: float = speed + float(config.get("speed_wave", 0.0)) * sin(TAU * ratio + float(config.get("speed_phase", 0.0)) + float(tick) * float(config.get("speed_phase_per_tick", 0.0)))
		bullets.append(make_bullet(pos, angle, lane_speed, radius, pattern_id, spawn_index + lane, color_name))
	return bullets

static func emit_sweep_laser(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var lanes: int = int(config.get("count", 5))
	var radius: float = float(config.get("radius", 6.0))
	var speed: float = float(config.get("speed", 92.0))
	var spread: float = float(config.get("spread", deg_to_rad(72.0)))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	var pattern_id: String = String(config.get("id", "sweep_laser"))
	var color_name: String = String(config.get("color", "white"))
	for i in range(max(1, lanes)):
		var ratio: float = 0.5 if lanes == 1 else float(i) / float(lanes - 1)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		bullets.append(make_bullet(origin, angle, speed, radius, pattern_id, spawn_index + i, color_name, {
			"type": "laser_warning",
			"warning_ticks": int(config.get("warning_ticks", 42)),
			"continuous_graze": true,
			"graze_cooldown_ticks": int(config.get("graze_cooldown_ticks", 18)),
		}))
	return bullets

static func emit_exploding_star(config: Dictionary, target: Vector2, spawn_index: int) -> Array[Dictionary]:
	var bullet: Dictionary = make_bullet(
		config.get("origin", Vector2.ZERO),
		BulletMathLib.angle_to_target(config.get("origin", Vector2.ZERO), target) + float(config.get("angle_offset", 0.0)),
		float(config.get("speed", 84.0)),
		float(config.get("radius", 6.0)),
		String(config.get("id", "exploding_star")),
		spawn_index,
		String(config.get("color", "violet")),
		{
			"type": "blossom",
			"delay_ticks": int(config.get("split_delay_ticks", 64)),
			"count": int(config.get("split_count", 10)),
			"speed": float(config.get("split_speed", 128.0)),
			"radius": float(config.get("split_radius", 4.0)),
			"angle_offset": float(config.get("split_angle_offset", -PI * 0.5)),
			"color": String(config.get("split_color", "gold")),
			"pattern_id": String(config.get("id", "exploding_star")) + "_burst",
		}
	)
	return [bullet]

static func emit_beam_sweep(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 3))
	var spread: float = float(config.get("spread", deg_to_rad(44.0)))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	base_angle += float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "beam_sweep"))
	var color_name: String = String(config.get("color", "white"))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		bullets.append(make_shaped_bullet(origin, angle, float(config.get("speed", 0.0)), float(config.get("radius", 5.0)), pattern_id, spawn_index + i, color_name, {
			"type": "laser_warning",
			"warning_ticks": int(config.get("warning_ticks", 42)),
			"continuous_graze": true,
			"graze_cooldown_ticks": int(config.get("graze_cooldown_ticks", 12)),
		}, {
			"shape": "laser",
			"length": float(config.get("length", 720.0)),
			"angle": angle,
		}))
	return bullets

static func emit_rotating_laser(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 2))
	var spread: float = float(config.get("spread", TAU))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	base_angle += float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "rotating_laser"))
	var color_name: String = String(config.get("color", "white"))
	for i in range(max(1, count)):
		var ratio: float = 0.0 if count == 1 else float(i) / float(count)
		var angle: float = base_angle + spread * ratio
		bullets.append(make_shaped_bullet(origin, angle, float(config.get("speed", 0.0)), float(config.get("radius", 5.0)), pattern_id, spawn_index + i, color_name, {
			"type": "rotating_laser",
			"warning_ticks": int(config.get("warning_ticks", 42)),
			"angular_velocity": float(config.get("angular_velocity", deg_to_rad(0.9))),
			"continuous_graze": true,
			"graze_cooldown_ticks": int(config.get("graze_cooldown_ticks", 12)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 240)),
		}, {
			"shape": "laser",
			"length": float(config.get("length", 720.0)),
			"angle": angle,
		}))
	return bullets

static func emit_cross_laser(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var arms: int = max(2, int(config.get("arms", int(config.get("count", 4)))))
	var length: float = float(config.get("length", 660.0))
	var base_angle: float = float(config.get("angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.0)) * float(tick)
	if bool(config.get("aimed", false)):
		base_angle = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "cross_laser"))
	var color_name: String = String(config.get("color", "white"))
	for i in range(arms):
		var angle: float = base_angle + TAU * float(i) / float(arms)
		var bullet: Dictionary = make_shaped_bullet(origin, angle, 0.0, float(config.get("radius", 4.8)), pattern_id, spawn_index + i, color_name, {
			"type": "rotating_laser",
			"warning_ticks": int(config.get("warning_ticks", 42)),
			"angular_velocity": float(config.get("angular_velocity", 0.0)),
			"continuous_graze": true,
			"graze_cooldown_ticks": int(config.get("graze_cooldown_ticks", 12)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 190)),
		}, {
			"shape": "laser",
			"length": length,
			"angle": angle,
		})
		bullet["cross_arm"] = i
		bullets.append(bullet)
	return bullets

static func emit_extend_laser(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 3))
	var radius: float = float(config.get("radius", 5.0))
	var spread: float = float(config.get("spread", deg_to_rad(42.0)))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	base_angle += float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "extend_laser"))
	var color_name: String = String(config.get("color", "white"))
	var start_length: float = float(config.get("start_length", 24.0))
	var target_length: float = float(config.get("length", 680.0))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		bullets.append(make_shaped_bullet(origin, angle, 0.0, radius, pattern_id, spawn_index + i, color_name, {
			"type": "extend_laser",
			"warning_ticks": int(config.get("warning_ticks", 36)),
			"start_length": start_length,
			"target_length": target_length,
			"extend_duration_ticks": max(1, int(config.get("extend_duration_ticks", 42))),
			"lifetime_ticks": int(config.get("lifetime_ticks", 180)),
			"continuous_graze": true,
			"graze_cooldown_ticks": int(config.get("graze_cooldown_ticks", 12)),
		}, {
			"shape": "laser",
			"length": start_length,
			"angle": angle,
		}))
	return bullets

static func emit_curved_laser(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 3))
	var spread: float = float(config.get("spread", deg_to_rad(48.0)))
	var length: float = float(config.get("length", 620.0))
	var curve: float = float(config.get("curve", 72.0))
	var segments: int = max(3, int(config.get("segments", 7)))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	base_angle += float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "curved_laser"))
	var color_name: String = String(config.get("color", "white"))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		var direction: Vector2 = BulletMathLib.direction(angle)
		var normal: Vector2 = direction.rotated(PI * 0.5)
		var side: float = -1.0 if i % 2 == 0 else 1.0
		var points: Array[Vector2] = []
		for segment_index in range(segments + 1):
			var t: float = float(segment_index) / float(segments)
			var bend: float = sin(PI * t) * curve * side
			points.append(direction * length * t + normal * bend)
		var bullet: Dictionary = make_bullet(origin, angle, float(config.get("speed", 0.0)), float(config.get("radius", 5.0)), pattern_id, spawn_index + i, color_name, {
			"type": "laser_warning",
			"warning_ticks": int(config.get("warning_ticks", 42)),
			"continuous_graze": true,
			"graze_cooldown_ticks": int(config.get("graze_cooldown_ticks", 12)),
		})
		bullet["shape"] = "polyline_laser"
		bullet["points"] = points
		bullet["length"] = length
		bullet["angle"] = angle
		bullets.append(bullet)
	return bullets

static func emit_reflect_laser(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 2))
	var spread: float = float(config.get("spread", deg_to_rad(36.0)))
	var length: float = float(config.get("length", 760.0))
	var bounces: int = max(1, int(config.get("bounces", 1)))
	var bounds: Rect2 = config.get("reflect_bounds", Rect2(Vector2(128, 48), Vector2(704, 624)))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	base_angle += float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "reflect_laser"))
	var color_name: String = String(config.get("color", "white"))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		var points: Array[Vector2] = _reflect_polyline_points(origin, angle, length, bounces, bounds)
		var bullet: Dictionary = make_bullet(origin, angle, 0.0, float(config.get("radius", 4.8)), pattern_id, spawn_index + i, color_name, {
			"type": "laser_warning",
			"warning_ticks": int(config.get("warning_ticks", 42)),
			"continuous_graze": true,
			"graze_cooldown_ticks": int(config.get("graze_cooldown_ticks", 12)),
		})
		bullet["shape"] = "polyline_laser"
		bullet["points"] = points
		bullet["length"] = length
		bullet["angle"] = angle
		bullet["reflect_bounds"] = bounds
		bullets.append(bullet)
	return bullets

static func emit_wave_laser(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 2))
	var spread: float = float(config.get("spread", deg_to_rad(36.0)))
	var length: float = float(config.get("length", 620.0))
	var segments: int = max(3, int(config.get("segments", 9)))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	base_angle += float(config.get("spin_per_tick", 0.0)) * float(tick)
	var pattern_id: String = String(config.get("id", "wave_laser"))
	var color_name: String = String(config.get("color", "violet"))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		var phase: float = float(config.get("wave_phase", 0.0)) + ratio * float(config.get("wave_phase_step", PI))
		var points: Array[Vector2] = _wave_laser_points(angle, length, segments, float(config.get("wave_amplitude", 52.0)), phase)
		var bullet: Dictionary = make_bullet(origin, angle, 0.0, float(config.get("radius", 4.8)), pattern_id, spawn_index + i, color_name, {
			"type": "wave_laser",
			"warning_ticks": int(config.get("warning_ticks", 42)),
			"length": length,
			"segments": segments,
			"wave_amplitude": float(config.get("wave_amplitude", 52.0)),
			"wave_phase": phase,
			"wave_speed": float(config.get("wave_speed", 0.08)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 220)),
			"continuous_graze": true,
			"graze_cooldown_ticks": int(config.get("graze_cooldown_ticks", 12)),
		})
		bullet["shape"] = "polyline_laser"
		bullet["points"] = points
		bullet["length"] = length
		bullet["angle"] = angle
		bullets.append(bullet)
	return bullets

static func emit_wall_bounce(config: Dictionary, target: Vector2, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 8))
	var speed: float = float(config.get("speed", 134.0))
	var radius: float = float(config.get("radius", 4.5))
	var spread: float = float(config.get("spread", deg_to_rad(90.0)))
	var base_angle: float = BulletMathLib.angle_to_target(origin, target) + float(config.get("angle_offset", 0.0))
	var pattern_id: String = String(config.get("id", "wall_bounce"))
	var color_name: String = String(config.get("color", "cyan"))
	for i in range(max(1, count)):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var angle: float = base_angle + lerpf(-spread * 0.5, spread * 0.5, ratio)
		bullets.append(make_bullet(origin, angle, speed, radius, pattern_id, spawn_index + i, color_name, {
			"type": "bounce",
			"bounds": config.get("bounce_bounds", Rect2(Vector2(160, 48), Vector2(640, 624))),
			"remaining_bounces": int(config.get("bounces", 1)),
			"damping": float(config.get("damping", 1.0)),
		}))
	return bullets

static func emit_morph_ring(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 24))
	var speed: float = float(config.get("speed", 108.0))
	var radius: float = float(config.get("radius", 4.4))
	var phase: float = float(config.get("angle_offset", 0.0)) + float(config.get("spin_per_tick", 0.0)) * float(tick)
	var wave_amplitude: float = float(config.get("wave_amplitude", 0.34))
	var pattern_id: String = String(config.get("id", "morph_ring"))
	var color_name: String = String(config.get("color", "green"))
	for i in range(max(1, count)):
		var ratio: float = float(i) / float(max(1, count))
		var angle: float = phase + TAU * ratio
		var speed_scale: float = 1.0 + sin(TAU * ratio * float(config.get("lobes", 4)) + phase) * wave_amplitude
		bullets.append(make_bullet(origin, angle, speed * speed_scale, radius, pattern_id, spawn_index + i, color_name))
	return bullets

static func emit_summoner_orbit(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 4))
	var orbit_radius: float = float(config.get("orbit_radius", 96.0))
	var phase: float = float(config.get("angle_offset", 0.0)) + float(config.get("orbit_spin", 0.05)) * float(tick)
	var pattern_id: String = String(config.get("id", "summoner_orbit"))
	var color_name: String = String(config.get("color", "violet"))
	for i in range(max(1, count)):
		var angle: float = phase + TAU * float(i) / float(max(1, count))
		var pos: Vector2 = BulletMathLib.polar(origin, angle, orbit_radius)
		bullets.append(make_bullet(pos, angle + PI * 0.5, float(config.get("speed", 36.0)), float(config.get("radius", 6.0)), pattern_id, spawn_index + i, color_name, {
			"type": "periodic_emit",
			"emit_interval_ticks": int(config.get("emit_interval_ticks", 24)),
			"emit_start_tick": int(config.get("emit_start_tick", 18)),
			"emit_count": int(config.get("emit_count", 8)),
			"emit_speed": float(config.get("emit_speed", 118.0)),
			"emit_radius": float(config.get("emit_radius", 4.0)),
			"emit_color": String(config.get("emit_color", "gold")),
			"emit_pattern_id": pattern_id + "_shot",
			"emit_spin": float(config.get("emit_spin", 0.16)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 120)),
		}))
	return bullets

static func emit_converge_cloud(config: Dictionary, tick: int, spawn_index: int, seed: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 16))
	var radius: float = float(config.get("radius", 4.2))
	var spawn_radius: float = float(config.get("spawn_radius", 240.0))
	var speed: float = float(config.get("speed", 118.0))
	var target_point: Vector2 = config.get("converge_point", Vector2(480, 480))
	var pattern_id: String = String(config.get("id", "converge_cloud"))
	var color_name: String = String(config.get("color", "cyan"))
	for i in range(max(1, count)):
		var index := spawn_index + i
		var angle: float = BulletMathLib.deterministic_range(seed, tick, pattern_id, index, 1, 0.0, TAU)
		var dist: float = BulletMathLib.deterministic_range(seed, tick, pattern_id, index, 2, spawn_radius * 0.45, spawn_radius)
		var pos: Vector2 = origin + BulletMathLib.direction(angle) * dist
		var bullet_angle: float = BulletMathLib.angle_to_target(pos, target_point)
		bullets.append(make_bullet(pos, bullet_angle, speed, radius, pattern_id, index, color_name))
	return bullets

static func emit_vortex_field(config: Dictionary, tick: int, spawn_index: int, seed: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = int(config.get("count", 18))
	var radius: float = float(config.get("radius", 4.0))
	var spawn_radius: float = float(config.get("spawn_radius", 230.0))
	var speed: float = float(config.get("speed", 86.0))
	var field_center: Vector2 = config.get("field_center", origin)
	var pattern_id: String = String(config.get("id", "vortex_field"))
	var color_name: String = String(config.get("color", "cyan"))
	for i in range(max(1, count)):
		var index := spawn_index + i
		var angle: float = BulletMathLib.deterministic_range(seed, tick, pattern_id, index, 1, 0.0, TAU)
		var dist: float = BulletMathLib.deterministic_range(seed, tick, pattern_id, index, 2, spawn_radius * 0.35, spawn_radius)
		var pos: Vector2 = origin + BulletMathLib.direction(angle) * dist
		var velocity_angle: float = angle + float(config.get("angle_offset", PI * 0.5))
		bullets.append(make_bullet(pos, velocity_angle, speed, radius, pattern_id, index, color_name, {
			"type": "vortex",
			"field_center": field_center,
			"pull_strength": float(config.get("pull_strength", 2.2)),
			"tangent_strength": float(config.get("tangent_strength", 3.4)),
			"max_speed": float(config.get("max_speed", 172.0)),
			"min_speed": float(config.get("min_speed", 24.0)),
			"clockwise": bool(config.get("clockwise", true)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 300)),
		}))
	return bullets

static func emit_stop_release(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = emit_ring(config, tick, spawn_index)
	var release_speed: float = float(config.get("release_speed", config.get("speed", 120.0)))
	var release_angle_offset: float = float(config.get("release_angle_offset", 0.0))
	for bullet in bullets:
		var initial_velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
		var release_angle: float = initial_velocity.angle() + release_angle_offset
		bullet["vel"] = initial_velocity * float(config.get("drift_multiplier", 0.25))
		bullet["behavior"] = {
			"type": "stop_release",
			"stop_tick": int(config.get("stop_tick", 18)),
			"release_tick": int(config.get("release_tick", 62)),
			"release_angle": release_angle,
			"release_speed": release_speed,
		}
	return bullets

static func emit_gate_lanes(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var lanes: int = int(config.get("count", 15))
	var width: float = float(config.get("width", 560.0))
	var gate_width: float = float(config.get("gate_width", 96.0))
	var gate_period: int = max(1, int(config.get("gate_period_ticks", 180)))
	var gate_phase: float = float(config.get("gate_phase", 0.0)) + TAU * float(tick % gate_period) / float(gate_period)
	var gate_center_ratio: float = 0.5 + 0.5 * sin(gate_phase)
	var speed: float = float(config.get("speed", 128.0))
	var radius: float = float(config.get("radius", 4.4))
	var angle: float = float(config.get("angle_offset", PI * 0.5))
	var pattern_id: String = String(config.get("id", "gate_lanes"))
	var color_name: String = String(config.get("color", "cyan"))
	for lane in range(max(1, lanes)):
		var ratio: float = 0.5 if lanes == 1 else float(lane) / float(lanes - 1)
		var x_offset: float = lerpf(-width * 0.5, width * 0.5, ratio)
		if absf(ratio - gate_center_ratio) * width <= gate_width * 0.5:
			continue
		var lane_speed: float = speed + float(config.get("speed_wave", 0.0)) * sin(TAU * ratio + gate_phase)
		bullets.append(make_bullet(origin + Vector2(x_offset, 0.0), angle, lane_speed, radius, pattern_id, spawn_index + bullets.size(), color_name))
	return bullets

static func emit_path_emitters(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = max(1, int(config.get("count", 2)))
	var path_radius_x: float = float(config.get("path_radius_x", 220.0))
	var path_radius_y: float = float(config.get("path_radius_y", 70.0))
	var path_points: Array[Vector2] = [
		Vector2(-path_radius_x, 0.0),
		Vector2(-path_radius_x * 0.35, path_radius_y),
		Vector2(path_radius_x * 0.35, -path_radius_y),
		Vector2(path_radius_x, 0.0),
	]
	var raw_points: Variant = config.get("path_points", [])
	if typeof(raw_points) == TYPE_ARRAY and (raw_points as Array).size() >= 2:
		path_points.clear()
		for point in raw_points as Array:
			if typeof(point) == TYPE_VECTOR2:
				path_points.append(point)
	var pattern_id: String = String(config.get("id", "path_emitters"))
	for i in range(count):
		var start_ratio: float = float(i) / float(count)
		var carrier: Dictionary = make_bullet(origin + path_points[0], 0.0, 0.0, float(config.get("carrier_radius", 6.0)), pattern_id, spawn_index + i, String(config.get("carrier_color", config.get("color", "violet"))), {
			"type": "path_emit",
			"path_origin": origin,
			"path_points": path_points,
			"path_duration_ticks": int(config.get("path_duration_ticks", 240)),
			"path_loop": bool(config.get("path_loop", true)),
			"path_ping_pong": bool(config.get("path_ping_pong", true)),
			"path_phase_ratio": start_ratio,
			"emit_interval_ticks": int(config.get("emit_interval_ticks", 24)),
			"emit_start_tick": int(config.get("emit_start_tick", 12)),
			"emit_count": int(config.get("emit_count", 8)),
			"emit_speed": float(config.get("emit_speed", 112.0)),
			"emit_radius": float(config.get("emit_radius", 4.0)),
			"emit_color": String(config.get("emit_color", "gold")),
			"emit_pattern_id": pattern_id + "_shot",
			"emit_spin": float(config.get("emit_spin", 0.11)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 360)),
		})
		carrier["collidable"] = false
		carrier["carrier"] = true
		bullets.append(carrier)
	return bullets

static func emit_path_follow(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = max(1, int(config.get("count", 8)))
	var path_radius_x: float = float(config.get("path_radius_x", 220.0))
	var path_radius_y: float = float(config.get("path_radius_y", 80.0))
	var path_points: Array[Vector2] = [
		Vector2(-path_radius_x, 0.0),
		Vector2(-path_radius_x * 0.2, path_radius_y),
		Vector2(path_radius_x * 0.3, -path_radius_y),
		Vector2(path_radius_x, 0.0),
	]
	var raw_points: Variant = config.get("path_points", [])
	if typeof(raw_points) == TYPE_ARRAY and (raw_points as Array).size() >= 2:
		path_points.clear()
		for point in raw_points as Array:
			if typeof(point) == TYPE_VECTOR2:
				path_points.append(point)
	var pattern_id: String = String(config.get("id", "path_follow"))
	var color_name: String = String(config.get("color", "green"))
	var duration: int = max(1, int(config.get("path_duration_ticks", 180)))
	for i in range(count):
		var phase_ratio: float = float(i) / float(count)
		var path_t: float = phase_ratio
		if bool(config.get("path_ping_pong", false)):
			path_t = 1.0 - absf(path_t * 2.0 - 1.0)
		var start_pos: Vector2 = origin + _sample_polyline(path_points, path_t)
		var bullet: Dictionary = make_bullet(start_pos, 0.0, 0.0, float(config.get("radius", 4.4)), pattern_id, spawn_index + i, color_name, {
			"type": "path_follow",
			"path_origin": origin,
			"path_points": path_points,
			"path_duration_ticks": duration,
			"path_phase_ratio": phase_ratio,
			"path_loop": bool(config.get("path_loop", true)),
			"path_ping_pong": bool(config.get("path_ping_pong", false)),
			"lifetime_ticks": int(config.get("lifetime_ticks", duration)),
		})
		bullets.append(bullet)
	return bullets

static func emit_bezier_follow(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = max(1, int(config.get("count", 6)))
	var control_points: Array[Vector2] = [
		Vector2(-220.0, 0.0),
		Vector2(-96.0, 128.0),
		Vector2(96.0, -96.0),
		Vector2(220.0, 0.0),
	]
	var raw_points: Variant = config.get("control_points", config.get("path_points", []))
	if typeof(raw_points) == TYPE_ARRAY and (raw_points as Array).size() >= 2:
		control_points.clear()
		for point in raw_points as Array:
			if typeof(point) == TYPE_VECTOR2:
				control_points.append(point)
	if control_points.size() < 2:
		return bullets
	var pattern_id: String = String(config.get("id", "bezier_follow"))
	var color_name: String = String(config.get("color", "violet"))
	var duration: int = max(1, int(config.get("path_duration_ticks", 210)))
	for i in range(count):
		var phase_ratio: float = float(i) / float(count)
		var path_t: float = phase_ratio
		if bool(config.get("path_ping_pong", false)):
			path_t = 1.0 - absf(path_t * 2.0 - 1.0)
		var start_pos: Vector2 = origin + _sample_bezier(control_points, path_t)
		var bullet: Dictionary = make_bullet(start_pos, 0.0, 0.0, float(config.get("radius", 4.4)), pattern_id, spawn_index + i, color_name, {
			"type": "bezier_follow",
			"path_origin": origin,
			"control_points": control_points,
			"path_duration_ticks": duration,
			"path_phase_ratio": phase_ratio,
			"path_loop": bool(config.get("path_loop", true)),
			"path_ping_pong": bool(config.get("path_ping_pong", false)),
			"lifetime_ticks": int(config.get("lifetime_ticks", duration)),
		})
		bullets.append(bullet)
	return bullets

static func emit_trail_emitters(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = []
	var origin: Vector2 = config.get("origin", Vector2.ZERO)
	var count: int = max(1, int(config.get("count", 3)))
	var width: float = float(config.get("width", 420.0))
	var pattern_id: String = String(config.get("id", "trail_emitters"))
	var color_name: String = String(config.get("carrier_color", config.get("color", "cyan")))
	var angle: float = float(config.get("angle_offset", PI * 0.5)) + float(config.get("spin_per_tick", 0.0)) * float(tick)
	var speed: float = float(config.get("speed", 64.0))
	for i in range(count):
		var ratio: float = 0.5 if count == 1 else float(i) / float(count - 1)
		var lateral: Vector2 = Vector2(lerpf(-width * 0.5, width * 0.5, ratio), 0.0)
		var carrier: Dictionary = make_bullet(origin + lateral, angle, speed, float(config.get("carrier_radius", 5.6)), pattern_id, spawn_index + i, color_name, {
			"type": "periodic_emit",
			"emit_interval_ticks": int(config.get("emit_interval_ticks", 18)),
			"emit_start_tick": int(config.get("emit_start_tick", 6)),
			"emit_count": int(config.get("emit_count", 5)),
			"emit_speed": float(config.get("emit_speed", 104.0)),
			"emit_radius": float(config.get("emit_radius", 3.8)),
			"emit_color": String(config.get("emit_color", "gold")),
			"emit_pattern_id": pattern_id + "_shot",
			"emit_spin": float(config.get("emit_spin", 0.18)) + ratio * float(config.get("emit_phase_step", 0.08)),
			"lifetime_ticks": int(config.get("lifetime_ticks", 150)),
		})
		carrier["collidable"] = bool(config.get("carrier_collidable", false))
		carrier["carrier"] = true
		bullets.append(carrier)
	return bullets

static func emit_boomerang_ring(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = emit_ring(config, tick, spawn_index)
	var return_mode: String = String(config.get("return_mode", "reverse"))
	var return_target: Vector2 = config.get("return_target", config.get("origin", Vector2.ZERO))
	for bullet in bullets:
		var velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
		bullet["behavior"] = {
			"type": "boomerang",
			"turn_tick": int(config.get("turn_tick", 54)),
			"return_mode": return_mode,
			"return_target": return_target,
			"return_speed": float(config.get("return_speed", maxf(velocity.length(), float(config.get("speed", 120.0))))),
			"pre_turn_acceleration": float(config.get("pre_turn_acceleration", -0.7)),
			"min_speed": float(config.get("min_speed", 16.0)),
			"max_speed": float(config.get("max_speed", 220.0)),
			"turned": false,
		}
	return bullets

static func emit_delayed_aim_ring(config: Dictionary, tick: int, spawn_index: int) -> Array[Dictionary]:
	var bullets: Array[Dictionary] = emit_ring(config, tick, spawn_index)
	var aim_target: Vector2 = config.get("aim_target", Vector2.ZERO)
	for bullet in bullets:
		var velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
		bullet["vel"] = velocity * float(config.get("drift_multiplier", 0.20))
		bullet["behavior"] = {
			"type": "delayed_aim",
			"aim_tick": int(config.get("aim_tick", 42)),
			"aim_mode": String(config.get("aim_mode", "player")),
			"aim_target": aim_target,
			"release_speed": float(config.get("release_speed", maxf(velocity.length(), float(config.get("speed", 120.0))))),
			"hold_tick": int(config.get("hold_tick", 14)),
			"aimed": false,
		}
	return bullets

static func emit_pattern(config: Dictionary, tick: int, target: Vector2, spawn_index: int, seed: int) -> Array[Dictionary]:
	match String(config.get("type", "ring")):
		"ring":
			return emit_ring(config, tick, spawn_index)
		"gap_ring":
			return emit_gap_ring(config, tick, spawn_index)
		"n_way":
			return emit_n_way(config, target, spawn_index)
		"random_arc":
			return emit_random_arc(config, tick, spawn_index, seed)
		"split_chain":
			return emit_split_chain(config, target, spawn_index)
		"blossom":
			return emit_blossom(config, tick, spawn_index)
		"telegraph_burst":
			return emit_telegraph_burst(config, target, tick, spawn_index)
		"charge_burst":
			return emit_charge_burst(config, target, tick, spawn_index)
		"trap_marker":
			return emit_trap_marker(config, target, tick, spawn_index, seed)
		"homing":
			return emit_homing(config, target, spawn_index)
		"flower":
			return emit_flower(config, tick, spawn_index)
		"sine_stream":
			return emit_sine_stream(config, tick, spawn_index)
		"snake_stream":
			return emit_snake_stream(config, target, tick, spawn_index)
		"curtain":
			return emit_curtain(config, tick, spawn_index)
		"burst":
			return emit_burst(config, target, tick, spawn_index)
		"laser_curtain":
			return emit_laser_curtain(config, target, spawn_index)
		"orbital":
			return emit_orbital(config, tick, spawn_index)
		"orbit_release":
			return emit_orbit_release(config, tick, spawn_index)
		"spiral_stack":
			return emit_spiral_stack(config, tick, spawn_index)
		"alternating_ring":
			return emit_alternating_ring(config, tick, spawn_index)
		"accel_ring":
			return emit_accel_ring(config, tick, spawn_index)
		"phase_shift_ring":
			return emit_phase_shift_ring(config, tick, spawn_index)
		"scale_pulse_ring":
			return emit_scale_pulse_ring(config, tick, spawn_index)
		"curve_fan":
			return emit_curve_fan(config, target, tick, spawn_index)
		"grid_rain":
			return emit_grid_rain(config, tick, spawn_index, seed)
		"edge_spawn":
			return emit_edge_spawn(config, target, tick, spawn_index, seed)
		"sweep_laser":
			return emit_sweep_laser(config, target, tick, spawn_index)
		"exploding_star":
			return emit_exploding_star(config, target, spawn_index)
		"beam_sweep":
			return emit_beam_sweep(config, target, tick, spawn_index)
		"rotating_laser":
			return emit_rotating_laser(config, target, tick, spawn_index)
		"cross_laser":
			return emit_cross_laser(config, target, tick, spawn_index)
		"extend_laser":
			return emit_extend_laser(config, target, tick, spawn_index)
		"curved_laser":
			return emit_curved_laser(config, target, tick, spawn_index)
		"reflect_laser":
			return emit_reflect_laser(config, target, tick, spawn_index)
		"wave_laser":
			return emit_wave_laser(config, target, tick, spawn_index)
		"wall_bounce":
			return emit_wall_bounce(config, target, tick, spawn_index)
		"morph_ring":
			return emit_morph_ring(config, tick, spawn_index)
		"summoner_orbit":
			return emit_summoner_orbit(config, tick, spawn_index)
		"converge_cloud":
			return emit_converge_cloud(config, tick, spawn_index, seed)
		"vortex_field":
			return emit_vortex_field(config, tick, spawn_index, seed)
		"stop_release":
			return emit_stop_release(config, tick, spawn_index)
		"gate_lanes":
			return emit_gate_lanes(config, tick, spawn_index)
		"path_emitters":
			return emit_path_emitters(config, tick, spawn_index)
		"path_follow":
			return emit_path_follow(config, tick, spawn_index)
		"bezier_follow":
			return emit_bezier_follow(config, tick, spawn_index)
		"trail_emitters":
			return emit_trail_emitters(config, tick, spawn_index)
		"boomerang_ring":
			return emit_boomerang_ring(config, tick, spawn_index)
		"delayed_aim_ring":
			return emit_delayed_aim_ring(config, tick, spawn_index)
		_:
			return []

static func resolve_behavior(bullet: Dictionary, target: Vector2) -> Array[Dictionary]:
	var spawned: Array[Dictionary] = []
	var behavior: Dictionary = bullet.get("behavior", {})
	if behavior.is_empty():
		return spawned

	var age: int = int(bullet.get("age_ticks", 0))
	match String(behavior.get("type", "")):
		"stop_release":
			if age >= int(behavior.get("release_tick", 62)):
				bullet["vel"] = BulletMathLib.direction(float(behavior.get("release_angle", bullet.get("vel", Vector2.ZERO).angle()))) * float(behavior.get("release_speed", 120.0))
			elif age >= int(behavior.get("stop_tick", 18)):
				bullet["vel"] = Vector2.ZERO
		"boomerang":
			var current_velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
			var current_speed: float = current_velocity.length()
			if age < int(behavior.get("turn_tick", 54)):
				var next_speed: float = clampf(
					current_speed + float(behavior.get("pre_turn_acceleration", -0.7)),
					float(behavior.get("min_speed", 0.0)),
					float(behavior.get("max_speed", 9999.0))
				)
				if current_velocity.length_squared() > 0.0001:
					bullet["vel"] = current_velocity.normalized() * next_speed
			elif not bool(behavior.get("turned", false)):
				var return_mode: String = String(behavior.get("return_mode", "reverse"))
				var return_speed: float = float(behavior.get("return_speed", maxf(current_speed, 120.0)))
				var return_angle: float = current_velocity.angle() + PI
				if return_mode == "target":
					return_angle = BulletMathLib.angle_to_target(bullet.get("pos", Vector2.ZERO), behavior.get("return_target", Vector2.ZERO))
				elif return_mode == "player":
					return_angle = BulletMathLib.angle_to_target(bullet.get("pos", Vector2.ZERO), target)
				bullet["vel"] = BulletMathLib.direction(return_angle) * return_speed
				behavior["turned"] = true
				bullet["behavior"] = behavior
		"delayed_aim":
			if age >= int(behavior.get("aim_tick", 42)) and not bool(behavior.get("aimed", false)):
				var aim_mode: String = String(behavior.get("aim_mode", "player"))
				var aim_angle: float = BulletMathLib.angle_to_target(bullet.get("pos", Vector2.ZERO), target)
				if aim_mode == "target":
					aim_angle = BulletMathLib.angle_to_target(bullet.get("pos", Vector2.ZERO), behavior.get("aim_target", Vector2.ZERO))
				elif aim_mode == "reverse":
					aim_angle = bullet.get("vel", Vector2.RIGHT).angle() + PI
				bullet["vel"] = BulletMathLib.direction(aim_angle) * float(behavior.get("release_speed", 120.0))
				behavior["aimed"] = true
				bullet["behavior"] = behavior
			elif age >= int(behavior.get("hold_tick", 14)) and not bool(behavior.get("aimed", false)):
				bullet["vel"] = Vector2.ZERO
		"telegraph_burst":
			if age >= int(behavior.get("trigger_tick", 48)) and not bool(behavior.get("triggered", false)):
				var origin: Vector2 = bullet.get("pos", Vector2.ZERO)
				var burst_mode: String = String(behavior.get("burst_mode", "ring"))
				var config: Dictionary = {
					"id": String(behavior.get("pattern_id", "telegraph_child")),
					"origin": origin,
					"count": int(behavior.get("count", 16)),
					"speed": float(behavior.get("speed", 124.0)),
					"radius": float(behavior.get("radius", 4.2)),
					"angle_offset": float(behavior.get("angle_offset", 0.0)) + float(behavior.get("spin_per_tick", 0.0)) * float(age),
					"spread": float(behavior.get("spread", TAU)),
					"color": String(behavior.get("color", "gold")),
				}
				var aim_mode: String = String(behavior.get("aim_mode", "fixed"))
				if aim_mode == "player":
					config["angle_offset"] = BulletMathLib.angle_to_target(origin, target)
				elif aim_mode == "target":
					config["angle_offset"] = BulletMathLib.angle_to_target(origin, behavior.get("target_point", target))
				if burst_mode == "fan":
					spawned = emit_n_way(config, target, 0)
				else:
					spawned = emit_ring(config, age, 0)
				behavior["triggered"] = true
				bullet["behavior"] = behavior
				bullet["pos"] = Vector2(-9999, -9999)
		"charge_burst":
			if not bool(behavior.get("triggered", false)):
				var charge_grow: float = float(behavior.get("charge_grow", 0.0))
				if charge_grow != 0.0:
					bullet["radius"] = minf(float(behavior.get("max_charge_radius", 24.0)), float(bullet.get("radius", 8.0)) + charge_grow)
			if age >= int(behavior.get("trigger_tick", 54)) and not bool(behavior.get("triggered", false)):
				var origin: Vector2 = bullet.get("pos", Vector2.ZERO)
				var burst_mode: String = String(behavior.get("burst_mode", "ring"))
				var config: Dictionary = {
					"id": String(behavior.get("pattern_id", "charge_child")),
					"origin": origin,
					"count": int(behavior.get("count", 18)),
					"speed": float(behavior.get("speed", 124.0)),
					"radius": float(behavior.get("radius", 4.2)),
					"angle_offset": float(behavior.get("angle_offset", 0.0)) + float(behavior.get("spin_per_tick", 0.0)) * float(age),
					"spread": float(behavior.get("spread", TAU)),
					"speed_step": float(behavior.get("speed_step", 0.0)),
					"split_count": int(behavior.get("split_count", 12)),
					"split_delay_ticks": int(behavior.get("split_delay_ticks", 36)),
					"split_speed": float(behavior.get("split_speed", behavior.get("speed", 124.0))),
					"color": String(behavior.get("color", "gold")),
				}
				var aim_mode: String = String(behavior.get("aim_mode", "fixed"))
				if aim_mode == "player":
					config["angle_offset"] = BulletMathLib.angle_to_target(origin, target)
				elif aim_mode == "target":
					config["angle_offset"] = BulletMathLib.angle_to_target(origin, behavior.get("target_point", target))
				if burst_mode == "fan":
					spawned = emit_n_way(config, target, 0)
				elif burst_mode == "star":
					spawned = emit_exploding_star(config, target, 0)
				else:
					spawned = emit_ring(config, age, 0)
				behavior["triggered"] = true
				bullet["behavior"] = behavior
				bullet["pos"] = Vector2(-9999, -9999)
		"trap_marker":
			bullet["vel"] = Vector2.ZERO
			if age >= int(behavior.get("trigger_tick", 48)) and not bool(behavior.get("triggered", false)):
				var origin: Vector2 = bullet.get("pos", Vector2.ZERO)
				var release_mode: String = String(behavior.get("release_mode", "fan"))
				var aim_mode: String = String(behavior.get("aim_mode", "player"))
				var release_angle: float = float(behavior.get("angle_offset", 0.0)) + float(behavior.get("spin_per_tick", 0.0)) * float(age)
				if aim_mode == "player":
					release_angle += BulletMathLib.angle_to_target(origin, target)
				elif aim_mode == "target":
					release_angle += BulletMathLib.angle_to_target(origin, behavior.get("target_point", target))
				elif aim_mode == "origin":
					release_angle += BulletMathLib.angle_to_target(origin, behavior.get("trap_origin", origin))
				var config: Dictionary = {
					"id": String(behavior.get("pattern_id", "trap_marker_release")),
					"origin": origin,
					"count": int(behavior.get("emit_count", 5)),
					"speed": float(behavior.get("speed", 128.0)),
					"radius": float(behavior.get("radius", 4.1)),
					"angle_offset": release_angle,
					"spread": float(behavior.get("spread", deg_to_rad(42.0))),
					"speed_step": float(behavior.get("speed_step", 0.0)),
					"color": String(behavior.get("color", "gold")),
				}
				var child_spawn_index: int = int(behavior.get("child_spawn_index", 0))
				if release_mode == "ring":
					spawned = emit_ring(config, age, child_spawn_index)
				elif release_mode == "aimed":
					config["count"] = 1
					spawned = emit_n_way(config, target, child_spawn_index)
				else:
					spawned = emit_n_way(config, target, child_spawn_index)
				behavior["triggered"] = true
				bullet["behavior"] = behavior
				bullet["pos"] = Vector2(-9999, -9999)
		"accelerate":
			if age >= int(behavior.get("delay_ticks", 0)):
				var current_velocity: Vector2 = bullet["vel"]
				var speed := clampf(
					current_velocity.length() + float(behavior.get("acceleration", 0.0)),
					float(behavior.get("min_speed", 0.0)),
					float(behavior.get("max_speed", 9999.0))
				)
				bullet["vel"] = BulletMathLib.direction(current_velocity.angle()) * speed
		"phase_shift":
			if age >= int(behavior.get("shift_tick", 48)):
				if not bool(behavior.get("shifted", false)):
					var shift_mode: String = String(behavior.get("shift_mode", "radial"))
					var shift_angle: float = float(behavior.get("radial_angle", bullet.get("vel", Vector2.RIGHT).angle()))
					if shift_mode == "reverse":
						shift_angle = bullet.get("vel", Vector2.RIGHT).angle() + PI
					elif shift_mode == "tangent":
						shift_angle = float(behavior.get("radial_angle", shift_angle)) + PI * 0.5
					elif shift_mode == "reverse_tangent":
						shift_angle = float(behavior.get("radial_angle", shift_angle)) - PI * 0.5
					elif shift_mode == "player":
						shift_angle = BulletMathLib.angle_to_target(bullet.get("pos", Vector2.ZERO), target)
					elif shift_mode == "target":
						shift_angle = BulletMathLib.angle_to_target(bullet.get("pos", Vector2.ZERO), behavior.get("shift_target", target))
					shift_angle += float(behavior.get("shift_angle_offset", 0.0))
					bullet["vel"] = BulletMathLib.direction(shift_angle) * float(behavior.get("shift_speed", 120.0))
					behavior["shifted"] = true
					bullet["behavior"] = behavior
				var shifted_velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
				var acceleration_after_shift: float = float(behavior.get("acceleration_after_shift", 0.0))
				if acceleration_after_shift != 0.0 and shifted_velocity.length_squared() > 0.0001:
					var shifted_speed: float = clampf(shifted_velocity.length() + acceleration_after_shift, 0.0, float(behavior.get("max_speed", 240.0)))
					bullet["vel"] = shifted_velocity.normalized() * shifted_speed
		"scale_pulse":
			var grow_start_tick: int = int(behavior.get("grow_start_tick", 0))
			var grow_duration_ticks: int = max(1, int(behavior.get("grow_duration_ticks", 36)))
			var grow_t: float = clampf(float(age - grow_start_tick) / float(grow_duration_ticks), 0.0, 1.0)
			var base_radius: float = float(behavior.get("base_radius", bullet.get("radius", 4.0)))
			var target_radius: float = float(behavior.get("target_radius", base_radius))
			var next_radius: float = lerpf(base_radius, target_radius, grow_t)
			var pulse_amplitude: float = float(behavior.get("pulse_amplitude", 0.0))
			if pulse_amplitude != 0.0:
				var pulse_period_ticks: int = max(1, int(behavior.get("pulse_period_ticks", 72)))
				var pulse_phase: float = float(behavior.get("pulse_phase", 0.0))
				next_radius += sin(TAU * float(age) / float(pulse_period_ticks) + pulse_phase) * pulse_amplitude
			bullet["radius"] = maxf(float(behavior.get("min_radius", 1.0)), next_radius)
			if age > int(behavior.get("lifetime_ticks", 300)):
				bullet["pos"] = Vector2(-9999, -9999)
		"curve":
			if age <= int(behavior.get("lifetime_ticks", 240)):
				var current_velocity: Vector2 = bullet["vel"]
				var speed := clampf(
					current_velocity.length() + float(behavior.get("acceleration", 0.0)),
					float(behavior.get("min_speed", 0.0)),
					float(behavior.get("max_speed", 9999.0))
				)
				bullet["vel"] = BulletMathLib.direction(current_velocity.angle() + float(behavior.get("angular_velocity", 0.0))) * speed
		"snake":
			var snake_lifetime: int = int(behavior.get("lifetime_ticks", 300))
			if age <= snake_lifetime:
				var snake_period_ticks: int = max(1, int(behavior.get("wave_period_ticks", 72)))
				var snake_phase: float = float(behavior.get("wave_phase", 0.0)) + TAU * float(age) / float(snake_period_ticks)
				var snake_speed: float = clampf(
					float(behavior.get("speed", 126.0)) + float(behavior.get("acceleration", 0.0)) * float(age),
					float(behavior.get("min_speed", 0.0)),
					float(behavior.get("max_speed", 9999.0))
				)
				var snake_angle: float = float(behavior.get("base_angle", bullet.get("vel", Vector2.RIGHT).angle())) + sin(snake_phase) * float(behavior.get("snake_amplitude", deg_to_rad(18.0)))
				bullet["vel"] = BulletMathLib.direction(snake_angle) * snake_speed
			else:
				bullet["pos"] = Vector2(-9999, -9999)
		"vortex":
			if age <= int(behavior.get("lifetime_ticks", 300)):
				var current_velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
				var center: Vector2 = behavior.get("field_center", bullet.get("pos", Vector2.ZERO))
				var to_center: Vector2 = center - bullet.get("pos", Vector2.ZERO)
				var pull: Vector2 = Vector2.ZERO
				if to_center.length_squared() > 0.0001:
					pull = to_center.normalized() * float(behavior.get("pull_strength", 2.2))
				var tangent: Vector2 = Vector2(-pull.y, pull.x)
				if not bool(behavior.get("clockwise", true)):
					tangent = -tangent
				var next_velocity: Vector2 = current_velocity + pull + tangent.normalized() * float(behavior.get("tangent_strength", 3.4))
				var next_speed: float = clampf(next_velocity.length(), float(behavior.get("min_speed", 24.0)), float(behavior.get("max_speed", 172.0)))
				if next_velocity.length_squared() > 0.0001:
					bullet["vel"] = next_velocity.normalized() * next_speed
			else:
				bullet["pos"] = Vector2(-9999, -9999)
		"bounce":
			var bounds: Rect2 = behavior.get("bounds", Rect2(Vector2(160, 48), Vector2(640, 624)))
			var remaining: int = int(behavior.get("remaining_bounces", 0))
			if remaining > 0:
				var pos: Vector2 = bullet.get("pos", Vector2.ZERO)
				var velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
				var bounced := false
				if pos.x <= bounds.position.x or pos.x >= bounds.end.x:
					velocity.x = -velocity.x * float(behavior.get("damping", 1.0))
					bounced = true
				if pos.y <= bounds.position.y or pos.y >= bounds.end.y:
					velocity.y = -velocity.y * float(behavior.get("damping", 1.0))
					bounced = true
				if bounced:
					behavior["remaining_bounces"] = remaining - 1
					bullet["behavior"] = behavior
					bullet["vel"] = velocity
		"periodic_emit":
			var start_tick: int = int(behavior.get("emit_start_tick", 1))
			var interval: int = max(1, int(behavior.get("emit_interval_ticks", 24)))
			var lifetime: int = int(behavior.get("lifetime_ticks", 120))
			if age >= start_tick and age <= lifetime and (age - start_tick) % interval == 0:
				var emit_count: int = int(behavior.get("emit_count", 8))
				var angle_offset: float = float(behavior.get("emit_spin", 0.0)) * float(age)
				var config: Dictionary = {
					"id": String(behavior.get("emit_pattern_id", "periodic_child")),
					"origin": bullet["pos"],
					"count": emit_count,
					"speed": float(behavior.get("emit_speed", 100.0)),
					"radius": float(behavior.get("emit_radius", 4.0)),
					"angle_offset": angle_offset,
					"color": String(behavior.get("emit_color", "white")),
				}
				spawned = emit_ring(config, age, 0)
			if age > lifetime:
				bullet["pos"] = Vector2(-9999, -9999)
		"path_emit":
			var path_points: Array[Vector2] = []
			var raw_points: Variant = behavior.get("path_points", [])
			if typeof(raw_points) == TYPE_ARRAY:
				for point in raw_points as Array:
					if typeof(point) == TYPE_VECTOR2:
						path_points.append(point)
			if path_points.size() >= 2:
				var path_origin: Vector2 = behavior.get("path_origin", Vector2.ZERO)
				var duration: int = max(1, int(behavior.get("path_duration_ticks", 240)))
				var phase_ratio: float = float(behavior.get("path_phase_ratio", 0.0))
				var path_t: float = fposmod(float(age) / float(duration) + phase_ratio, 1.0)
				if bool(behavior.get("path_ping_pong", true)):
					path_t = 1.0 - absf(path_t * 2.0 - 1.0)
				bullet["pos"] = path_origin + _sample_polyline(path_points, path_t)
			var path_emit_start_tick: int = int(behavior.get("emit_start_tick", 1))
			var path_emit_interval: int = max(1, int(behavior.get("emit_interval_ticks", 24)))
			var path_lifetime: int = int(behavior.get("lifetime_ticks", 360))
			if age >= path_emit_start_tick and age <= path_lifetime and (age - path_emit_start_tick) % path_emit_interval == 0:
				var config: Dictionary = {
					"id": String(behavior.get("emit_pattern_id", "path_child")),
					"origin": bullet["pos"],
					"count": int(behavior.get("emit_count", 8)),
					"speed": float(behavior.get("emit_speed", 100.0)),
					"radius": float(behavior.get("emit_radius", 4.0)),
					"angle_offset": float(behavior.get("emit_spin", 0.0)) * float(age),
					"color": String(behavior.get("emit_color", "white")),
				}
				spawned = emit_ring(config, age, 0)
			if age > path_lifetime or (not bool(behavior.get("path_loop", true)) and age > int(behavior.get("path_duration_ticks", 240))):
				bullet["pos"] = Vector2(-9999, -9999)
		"path_follow":
			var follow_points: Array[Vector2] = []
			var follow_raw_points: Variant = behavior.get("path_points", [])
			if typeof(follow_raw_points) == TYPE_ARRAY:
				for point in follow_raw_points as Array:
					if typeof(point) == TYPE_VECTOR2:
						follow_points.append(point)
			if follow_points.size() >= 2:
				var follow_origin: Vector2 = behavior.get("path_origin", Vector2.ZERO)
				var follow_duration: int = max(1, int(behavior.get("path_duration_ticks", 180)))
				var follow_phase_ratio: float = float(behavior.get("path_phase_ratio", 0.0))
				var follow_t: float = fposmod(float(age) / float(follow_duration) + follow_phase_ratio, 1.0)
				if bool(behavior.get("path_ping_pong", false)):
					follow_t = 1.0 - absf(follow_t * 2.0 - 1.0)
				bullet["pos"] = follow_origin + _sample_polyline(follow_points, follow_t)
			if age > int(behavior.get("lifetime_ticks", 180)):
				bullet["pos"] = Vector2(-9999, -9999)
		"bezier_follow":
			var bezier_points: Array[Vector2] = []
			var bezier_raw_points: Variant = behavior.get("control_points", [])
			if typeof(bezier_raw_points) == TYPE_ARRAY:
				for point in bezier_raw_points as Array:
					if typeof(point) == TYPE_VECTOR2:
						bezier_points.append(point)
			if bezier_points.size() >= 2:
				var bezier_origin: Vector2 = behavior.get("path_origin", Vector2.ZERO)
				var bezier_duration: int = max(1, int(behavior.get("path_duration_ticks", 210)))
				var bezier_phase_ratio: float = float(behavior.get("path_phase_ratio", 0.0))
				var bezier_t: float = fposmod(float(age) / float(bezier_duration) + bezier_phase_ratio, 1.0)
				if bool(behavior.get("path_ping_pong", false)):
					bezier_t = 1.0 - absf(bezier_t * 2.0 - 1.0)
				bullet["pos"] = bezier_origin + _sample_bezier(bezier_points, bezier_t)
			if age > int(behavior.get("lifetime_ticks", 210)):
				bullet["pos"] = Vector2(-9999, -9999)
		"homing":
			if age <= int(behavior.get("lifetime_ticks", 150)):
				var current_velocity: Vector2 = bullet["vel"]
				var target_angle: float = BulletMathLib.angle_to_target(bullet["pos"], target)
				var next_angle: float = BulletMathLib.rotate_toward(current_velocity.angle(), target_angle, float(behavior.get("turn_rate", deg_to_rad(2.2))))
				bullet["vel"] = BulletMathLib.direction(next_angle) * float(behavior.get("speed", current_velocity.length()))
		"orbit_release":
			if not bool(behavior.get("released", false)):
				var center: Vector2 = behavior.get("center", bullet.get("pos", Vector2.ZERO))
				var phase: float = float(behavior.get("phase", 0.0)) + float(behavior.get("orbit_spin", 0.0)) * float(age)
				bullet["pos"] = center + BulletMathLib.direction(phase) * float(behavior.get("orbit_radius", 84.0))
				if age >= int(behavior.get("release_tick", 54)):
					var release_mode: String = String(behavior.get("release_mode", "radial"))
					var release_angle: float = phase
					if release_mode == "tangent":
						release_angle = phase + PI * 0.5
					elif release_mode == "reverse_tangent":
						release_angle = phase - PI * 0.5
					elif release_mode == "player":
						release_angle = BulletMathLib.angle_to_target(bullet.get("pos", Vector2.ZERO), target)
					elif release_mode == "target":
						release_angle = BulletMathLib.angle_to_target(bullet.get("pos", Vector2.ZERO), behavior.get("release_target", center))
					bullet["vel"] = BulletMathLib.direction(release_angle) * float(behavior.get("release_speed", 126.0))
					behavior["released"] = true
					bullet["behavior"] = behavior
			if age > int(behavior.get("lifetime_ticks", 360)):
				bullet["pos"] = Vector2(-9999, -9999)
		"laser_warning":
			if age < int(behavior.get("warning_ticks", 36)):
				bullet["vel"] = Vector2.ZERO
		"rotating_laser":
			bullet["vel"] = Vector2.ZERO
			if age > int(behavior.get("warning_ticks", 42)):
				bullet["angle"] = float(bullet.get("angle", 0.0)) + float(behavior.get("angular_velocity", 0.0))
			if age > int(behavior.get("lifetime_ticks", 240)):
				bullet["pos"] = Vector2(-9999, -9999)
		"extend_laser":
			bullet["vel"] = Vector2.ZERO
			var warning_ticks: int = int(behavior.get("warning_ticks", 36))
			var start_length: float = float(behavior.get("start_length", bullet.get("length", 24.0)))
			var target_length: float = float(behavior.get("target_length", bullet.get("length", 680.0)))
			if age <= warning_ticks:
				bullet["length"] = start_length
			else:
				var extend_duration_ticks: int = max(1, int(behavior.get("extend_duration_ticks", 42)))
				var extend_t: float = clampf(float(age - warning_ticks) / float(extend_duration_ticks), 0.0, 1.0)
				bullet["length"] = lerpf(start_length, target_length, extend_t)
			if age > int(behavior.get("lifetime_ticks", 180)):
				bullet["pos"] = Vector2(-9999, -9999)
		"wave_laser":
			bullet["vel"] = Vector2.ZERO
			var wave_angle: float = float(bullet.get("angle", 0.0))
			var wave_length: float = float(behavior.get("length", bullet.get("length", 620.0)))
			var wave_segments: int = max(3, int(behavior.get("segments", 9)))
			var wave_amplitude: float = float(behavior.get("wave_amplitude", 52.0))
			var wave_phase: float = float(behavior.get("wave_phase", 0.0)) + float(behavior.get("wave_speed", 0.08)) * float(age)
			bullet["points"] = _wave_laser_points(wave_angle, wave_length, wave_segments, wave_amplitude, wave_phase)
			if age > int(behavior.get("lifetime_ticks", 220)):
				bullet["pos"] = Vector2(-9999, -9999)
		"split", "blossom":
			if age == int(behavior.get("delay_ticks", 60)):
				var config: Dictionary = {
					"id": String(behavior.get("pattern_id", "child")),
					"origin": bullet["pos"],
					"count": int(behavior.get("count", 8)),
					"speed": float(behavior.get("speed", 100.0)),
					"radius": float(behavior.get("radius", 4.0)),
					"angle_offset": float(behavior.get("angle_offset", 0.0)),
					"color": String(behavior.get("color", "white")),
				}
				spawned = emit_ring(config, age, 0)
				bullet["pos"] = Vector2(-9999, -9999)
	return spawned

static func _sample_polyline(points: Array[Vector2], t: float) -> Vector2:
	if points.is_empty():
		return Vector2.ZERO
	if points.size() == 1:
		return points[0]
	var scaled: float = clampf(t, 0.0, 1.0) * float(points.size() - 1)
	var index: int = clampi(int(floor(scaled)), 0, points.size() - 2)
	var local_t: float = scaled - float(index)
	return points[index].lerp(points[index + 1], local_t)

static func _sample_bezier(points: Array[Vector2], t: float) -> Vector2:
	if points.is_empty():
		return Vector2.ZERO
	if points.size() == 1:
		return points[0]
	var work: Array[Vector2] = points.duplicate()
	var clamped_t: float = clampf(t, 0.0, 1.0)
	for level in range(points.size() - 1):
		for i in range(points.size() - 1 - level):
			work[i] = work[i].lerp(work[i + 1], clamped_t)
	return work[0]

static func _reflect_polyline_points(origin: Vector2, angle: float, total_length: float, bounces: int, bounds: Rect2) -> Array[Vector2]:
	var points: Array[Vector2] = [Vector2.ZERO]
	var pos: Vector2 = origin
	var direction: Vector2 = BulletMathLib.direction(angle)
	var remaining: float = maxf(1.0, total_length)
	var bounce_count: int = 0
	while remaining > 0.001 and bounce_count <= bounces:
		var hit: Dictionary = _ray_to_bounds(pos, direction, bounds)
		var distance: float = minf(remaining, float(hit.get("distance", remaining)))
		pos += direction * distance
		points.append(pos - origin)
		remaining -= distance
		if remaining <= 0.001 or not bool(hit.get("hit", false)) or bounce_count >= bounces:
			break
		var normal: Vector2 = hit.get("normal", Vector2.ZERO)
		direction = direction.bounce(normal).normalized()
		pos += direction * 0.5
		bounce_count += 1
	return points

static func _ray_to_bounds(pos: Vector2, direction: Vector2, bounds: Rect2) -> Dictionary:
	var best_distance: float = INF
	var normal: Vector2 = Vector2.ZERO
	if absf(direction.x) > 0.0001:
		var target_x: float = bounds.end.x if direction.x > 0.0 else bounds.position.x
		var t_x: float = (target_x - pos.x) / direction.x
		var y_at_x: float = pos.y + direction.y * t_x
		if t_x > 0.001 and y_at_x >= bounds.position.y - 0.1 and y_at_x <= bounds.end.y + 0.1 and t_x < best_distance:
			best_distance = t_x
			normal = Vector2.LEFT if direction.x > 0.0 else Vector2.RIGHT
	if absf(direction.y) > 0.0001:
		var target_y: float = bounds.end.y if direction.y > 0.0 else bounds.position.y
		var t_y: float = (target_y - pos.y) / direction.y
		var x_at_y: float = pos.x + direction.x * t_y
		if t_y > 0.001 and x_at_y >= bounds.position.x - 0.1 and x_at_y <= bounds.end.x + 0.1 and t_y < best_distance:
			best_distance = t_y
			normal = Vector2.UP if direction.y > 0.0 else Vector2.DOWN
	return {
		"hit": best_distance < INF,
		"distance": best_distance,
		"normal": normal,
	}

static func _wave_laser_points(angle: float, length: float, segments: int, amplitude: float, phase: float) -> Array[Vector2]:
	var points: Array[Vector2] = []
	var direction: Vector2 = BulletMathLib.direction(angle)
	var normal: Vector2 = direction.rotated(PI * 0.5)
	for segment_index in range(max(1, segments) + 1):
		var t: float = float(segment_index) / float(max(1, segments))
		var lateral: float = sin(TAU * t + phase) * amplitude * sin(PI * t)
		points.append(direction * length * t + normal * lateral)
	return points
