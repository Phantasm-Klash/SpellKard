class_name BulletMath
extends RefCounted

const DEFAULT_MATCH_SEED := 20260625
const MASK_32 := 0xffffffff

static func direction(angle: float) -> Vector2:
	return Vector2.RIGHT.rotated(angle)

static func angle_to_target(origin: Vector2, target: Vector2) -> float:
	return (target - origin).angle()

static func polar(origin: Vector2, angle: float, distance: float) -> Vector2:
	return origin + direction(angle) * distance

static func ellipse_point(origin: Vector2, angle: float, radius_x: float, radius_y: float) -> Vector2:
	return origin + Vector2(cos(angle) * radius_x, sin(angle) * radius_y)

static func wave_offset(tick: int, period_ticks: int, amplitude: float, phase: float = 0.0) -> float:
	var period: float = max(1.0, float(period_ticks))
	return sin((TAU * float(tick) / period) + phase) * amplitude

static func flower_angle(index: int, count: int, petals: int, phase: float = 0.0) -> float:
	var safe_count: int = max(1, count)
	var petal_count: int = max(1, petals)
	var ratio := float(index) / float(safe_count)
	return TAU * ratio * float(petal_count) + phase

static func shortest_angle_delta(from_angle: float, to_angle: float) -> float:
	return wrapf(to_angle - from_angle, -PI, PI)

static func rotate_toward(from_angle: float, to_angle: float, max_step: float) -> float:
	var delta := shortest_angle_delta(from_angle, to_angle)
	return from_angle + clamp(delta, -max_step, max_step)

static func fvn1a32(text: String) -> int:
	var result := 2166136261
	for value in text.to_utf8_buffer():
		result = int((result ^ value) * 16777619) & MASK_32
	return result

static func mix32(value: int) -> int:
	var x := value & MASK_32
	x = (x ^ (x >> 16)) & MASK_32
	x = int(x * 0x7feb352d) & MASK_32
	x = (x ^ (x >> 15)) & MASK_32
	x = int(x * 0x846ca68b) & MASK_32
	x = (x ^ (x >> 16)) & MASK_32
	return x & MASK_32

static func deterministic_u32(seed: int, tick: int, pattern_id: String, spawn_index: int, stream: int = 0) -> int:
	var id_hash := fvn1a32(pattern_id)
	var value := seed & MASK_32
	value = (value ^ int(tick * 0x9e3779b1)) & MASK_32
	value = (value ^ id_hash) & MASK_32
	value = (value ^ int(spawn_index * 0x85ebca6b)) & MASK_32
	value = (value ^ int(stream * 0xc2b2ae35)) & MASK_32
	return mix32(value)

static func deterministic_unit(seed: int, tick: int, pattern_id: String, spawn_index: int, stream: int = 0) -> float:
	return float(deterministic_u32(seed, tick, pattern_id, spawn_index, stream)) / float(MASK_32)

static func deterministic_range(seed: int, tick: int, pattern_id: String, spawn_index: int, stream: int, min_value: float, max_value: float) -> float:
	return lerpf(min_value, max_value, deterministic_unit(seed, tick, pattern_id, spawn_index, stream))

static func apply_modifiers(config: Dictionary, modifiers: Dictionary) -> Dictionary:
	var result := config.duplicate(true)
	result["speed"] = float(result.get("speed", 120.0)) * float(modifiers.get("speed_multiplier", 1.0))
	result["count"] = max(1, int(round(float(result.get("count", 1)) * float(modifiers.get("density_multiplier", 1.0)))))
	result["angle_offset"] = float(result.get("angle_offset", 0.0)) + float(modifiers.get("angle_offset", 0.0))
	result["curve_strength"] = float(result.get("curve_strength", 0.0)) + float(modifiers.get("curve_strength", 0.0))
	result["aim_bias"] = clamp(float(result.get("aim_bias", 1.0)) + float(modifiers.get("aim_bias", 0.0)), 0.0, 1.0)
	return result
