class_name BulletEngine
extends RefCounted

const BulletPatterns := preload("res://scripts/bullet_pattern_library.gd")

const FIXED_DELTA := 1.0 / 60.0
const DEFAULT_WORLD_BOUNDS := Rect2(Vector2(-56, -56), Vector2(1072, 832))

static func circle_overlap(a: Vector2, a_radius: float, b: Vector2, b_radius: float) -> bool:
	return a.distance_to(b) <= a_radius + b_radius

static func point_segment_distance(point: Vector2, a: Vector2, b: Vector2) -> float:
	var segment := b - a
	var length_squared := segment.length_squared()
	if length_squared <= 0.0001:
		return point.distance_to(a)
	var t := clampf((point - a).dot(segment) / length_squared, 0.0, 1.0)
	return point.distance_to(a + segment * t)

static func bullet_segment(bullet: Dictionary) -> Dictionary:
	var pos: Vector2 = bullet.get("pos", Vector2.ZERO)
	var length := float(bullet.get("length", 0.0))
	var angle := float(bullet.get("angle", bullet.get("vel", Vector2.RIGHT).angle()))
	var half := Vector2.RIGHT.rotated(angle) * length * 0.5
	return {
		"a": pos - half,
		"b": pos + half,
	}

static func bullet_polyline_points(bullet: Dictionary) -> Array[Vector2]:
	var points: Array[Vector2] = []
	var raw_points: Variant = bullet.get("points", [])
	var pos: Vector2 = bullet.get("pos", Vector2.ZERO)
	if typeof(raw_points) == TYPE_ARRAY:
		for point in raw_points as Array:
			if typeof(point) == TYPE_VECTOR2:
				var relative_point: Vector2 = point
				points.append(pos + relative_point)
	if points.size() < 2:
		points.clear()
		var segment := bullet_segment(bullet)
		points.append(segment.get("a", pos))
		points.append(segment.get("b", pos))
	return points

static func point_polyline_distance(point: Vector2, points: Array[Vector2]) -> float:
	if points.is_empty():
		return INF
	if points.size() == 1:
		return point.distance_to(points[0])
	var best := INF
	for i in range(points.size() - 1):
		best = minf(best, point_segment_distance(point, points[i], points[i + 1]))
	return best

static func distance_to_bullet(player_pos: Vector2, bullet: Dictionary) -> float:
	var shape := String(bullet.get("shape", "circle"))
	match shape:
		"capsule", "laser":
			var segment := bullet_segment(bullet)
			return point_segment_distance(player_pos, segment.get("a", Vector2.ZERO), segment.get("b", Vector2.ZERO))
		"polyline_laser", "polyline", "curve_laser":
			return point_polyline_distance(player_pos, bullet_polyline_points(bullet))
		_:
			return player_pos.distance_to(bullet.get("pos", Vector2.ZERO))

static func hit_overlaps(player_pos: Vector2, player_hit_radius: float, bullet: Dictionary) -> bool:
	return distance_to_bullet(player_pos, bullet) <= player_hit_radius + float(bullet.get("radius", 5.0))

static func graze_overlaps(player_pos: Vector2, player_graze_radius: float, player_hit_radius: float, bullet: Dictionary) -> bool:
	var bullet_radius := float(bullet.get("radius", 5.0))
	var distance := distance_to_bullet(player_pos, bullet)
	if distance <= player_hit_radius + bullet_radius:
		return false
	return distance <= player_graze_radius + bullet_radius

static func should_emit_graze(bullet: Dictionary, player_id: String, tick: int, player_pos: Vector2, graze_radius: float, hit_radius: float) -> bool:
	if not graze_overlaps(player_pos, graze_radius, hit_radius, bullet):
		return false
	var graze_key := String(bullet.get("graze_key", _bullet_graze_key(bullet)))
	var grazed_players: Dictionary = bullet.get("grazed_players", {})
	var behavior: Dictionary = bullet.get("behavior", {})
	var cooldown_ticks := int(behavior.get("graze_cooldown_ticks", 0))
	if cooldown_ticks > 0 or bool(behavior.get("continuous_graze", false)):
		var last_tick := int(grazed_players.get(player_id, -999999))
		return tick - last_tick >= max(1, cooldown_ticks)
	return not grazed_players.has(player_id) and not bool(bullet.get("grazed", false)) and not graze_key.is_empty()

static func mark_grazed(bullet: Dictionary, player_id: String, tick: int) -> void:
	var grazed_players: Dictionary = bullet.get("grazed_players", {})
	grazed_players[player_id] = tick
	bullet["grazed_players"] = grazed_players
	bullet["grazed"] = true
	bullet["last_graze_tick"] = tick

static func step_bullets(bullets: Array[Dictionary], player_pos: Vector2, tick: int, options: Dictionary = {}) -> Dictionary:
	var hit_radius := float(options.get("hit_radius", 4.0))
	var graze_radius := float(options.get("graze_radius", 22.0))
	var player_id := String(options.get("player_id", "local"))
	var fixed_delta := float(options.get("fixed_delta", FIXED_DELTA))
	var bounds: Rect2 = options.get("bounds", DEFAULT_WORLD_BOUNDS)
	var remove_on_hit := bool(options.get("remove_on_hit", true))
	var allow_hit := bool(options.get("allow_hit", true))
	var spawned_by_behavior: Array[Dictionary] = []
	var events: Array[Dictionary] = []
	var checks := 0

	for bullet in bullets:
		bullet["age_ticks"] = int(bullet.get("age_ticks", 0)) + 1
		var children: Array[Dictionary] = BulletPatterns.resolve_behavior(bullet, player_pos)
		if not children.is_empty():
			for child in children:
				child["card_modified"] = bool(bullet.get("card_modified", false))
			spawned_by_behavior.append_array(children)

		bullet["pos"] = bullet.get("pos", Vector2.ZERO) + bullet.get("vel", Vector2.ZERO) * fixed_delta
		checks += 1
		if not collision_active(bullet):
			continue

		var hit := allow_hit and hit_overlaps(player_pos, hit_radius, bullet)
		if hit:
			events.append({
				"type": "hit",
				"bullet": bullet,
				"pattern_id": String(bullet.get("pattern_id", "unknown")),
			})
			if remove_on_hit:
				bullet["pos"] = Vector2(-9999, -9999)
			continue

		if should_emit_graze(bullet, player_id, tick, player_pos, graze_radius, hit_radius):
			mark_grazed(bullet, player_id, tick)
			events.append({
				"type": "graze",
				"bullet": bullet,
				"pattern_id": String(bullet.get("pattern_id", "unknown")),
				"graze_key": String(bullet.get("graze_key", _bullet_graze_key(bullet))),
			})

	if not spawned_by_behavior.is_empty():
		bullets.append_array(spawned_by_behavior)

	var kept: Array[Dictionary] = []
	for bullet in bullets:
		var pos: Vector2 = bullet.get("pos", Vector2.ZERO)
		if _bullet_in_bounds(bullet, bounds):
			kept.append(bullet)

	return {
		"bullets": kept,
		"spawned": spawned_by_behavior,
		"events": events,
		"collision_checks": checks,
	}

static func _bullet_graze_key(bullet: Dictionary) -> String:
	var pattern_id := String(bullet.get("pattern_id", "unknown"))
	var spawn_index := int(bullet.get("spawn_index", -1))
	return "%s:%d" % [pattern_id, spawn_index]

static func collision_active(bullet: Dictionary) -> bool:
	if not bool(bullet.get("collidable", true)):
		return false
	var behavior: Dictionary = bullet.get("behavior", {})
	if String(behavior.get("type", "")) in ["laser_warning", "rotating_laser", "extend_laser", "wave_laser"] and not bool(behavior.get("collision_during_warning", false)):
		return int(bullet.get("age_ticks", 0)) > int(behavior.get("warning_ticks", 36))
	return true

static func _bullet_in_bounds(bullet: Dictionary, bounds: Rect2) -> bool:
	var shape := String(bullet.get("shape", "circle"))
	if shape in ["polyline_laser", "polyline", "curve_laser"]:
		for point in bullet_polyline_points(bullet):
			if bounds.has_point(point):
				return true
	var pos: Vector2 = bullet.get("pos", Vector2.ZERO)
	return bounds.has_point(pos)
