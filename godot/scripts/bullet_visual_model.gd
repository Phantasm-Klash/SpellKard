class_name BulletVisualModel
extends RefCounted

const KINDS: Array[String] = ["small_orb", "large_orb", "star", "homing", "laser_warning"]
const DANGER_LEVELS: Array[String] = ["low", "medium", "high"]
const LOW_DENSITY := 240
const HIGH_DENSITY := 900

var last_density := 0
var last_counts := {}
var last_decorative_alpha := 1.0
var last_card_modified_count := 0
var last_max_presentation_radius := 0.0

func _init() -> void:
	for kind in KINDS:
		last_counts[kind] = 0

func annotate_bullets(bullets: Array[Dictionary], density: int = -1) -> void:
	var current_density: int = bullets.size() if density < 0 else density
	_reset_stats(current_density)
	for bullet in bullets:
		var visual: Dictionary = presentation_for_bullet(bullet, current_density)
		bullet["visual"] = visual
		var kind := String(visual.get("kind", "small_orb"))
		last_counts[kind] = int(last_counts.get(kind, 0)) + 1
		if bool(visual.get("card_modified", false)):
			last_card_modified_count += 1
		last_max_presentation_radius = maxf(last_max_presentation_radius, float(visual.get("presentation_radius", 0.0)))
	last_decorative_alpha = decorative_alpha_for_density(current_density)

func presentation_for_bullet(bullet: Dictionary, density: int = -1) -> Dictionary:
	var radius := float(bullet.get("radius", 5.0))
	var velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
	var speed := velocity.length()
	var behavior: Dictionary = bullet.get("behavior", {})
	var behavior_type := String(behavior.get("type", ""))
	var pattern_id := String(bullet.get("pattern_id", ""))
	var shape := String(bullet.get("shape", "circle"))
	var kind := classify_kind(radius, speed, behavior_type, pattern_id, shape)
	var danger := danger_level(radius, speed, behavior_type, kind)
	var card_modified := bool(bullet.get("card_modified", false))
	var current_density: int = last_density if density < 0 else density
	var visual_radius := presentation_radius_for(radius, kind, danger)
	var speed_band := speed_band_for(speed)
	return {
		"kind": kind,
		"danger": danger,
		"speed_band": speed_band,
		"collision_radius": radius,
		"presentation_radius": visual_radius,
		"decorative_alpha": decorative_alpha_for_density(current_density),
		"core_alpha": 1.0,
		"accent_color_name": accent_color_name(speed_band, danger, kind),
		"outline": card_modified or danger == "high",
		"card_modified": card_modified,
		"tail": kind == "homing",
		"warning": kind == "laser_warning",
		"shape": shape,
		"length": float(bullet.get("length", 0.0)),
		"angle": float(bullet.get("angle", velocity.angle())),
		"readability_safe": visual_radius >= radius,
	}

func classify_kind(radius: float, speed: float, behavior_type: String, pattern_id: String, shape: String = "circle") -> String:
	if shape == "laser" or shape == "capsule" or shape == "polyline_laser" or shape == "polyline" or shape == "curve_laser" or behavior_type == "laser" or pattern_id.contains("laser") or pattern_id.contains("beam"):
		return "laser_warning"
	if behavior_type == "homing":
		return "homing"
	if radius >= 6.2:
		return "large_orb"
	if pattern_id.contains("arc") or pattern_id.contains("blossom") or speed >= 190.0:
		return "star"
	return "small_orb"

func danger_level(radius: float, speed: float, behavior_type: String, kind: String) -> String:
	var score := radius * 0.58 + speed / 120.0
	if behavior_type == "homing":
		score += 1.0
	if kind == "laser_warning":
		score += 2.0
	if radius >= 7.0:
		score += 0.75
	if score >= 5.25:
		return "high"
	if score >= 3.75:
		return "medium"
	return "low"

func speed_band_for(speed: float) -> String:
	if speed >= 180.0:
		return "fast"
	if speed >= 110.0:
		return "medium"
	return "slow"

func presentation_radius_for(radius: float, kind: String, danger: String) -> float:
	var padding := 1.0
	match kind:
		"large_orb":
			padding = 2.5
		"star":
			padding = 2.0
		"homing":
			padding = 1.75
		"laser_warning":
			padding = 4.0
	if danger == "high":
		padding += 0.75
	return maxf(radius, radius + padding)

func decorative_alpha_for_density(density: int) -> float:
	if density <= LOW_DENSITY:
		return 0.92
	if density >= HIGH_DENSITY:
		return 0.36
	var t := float(density - LOW_DENSITY) / float(HIGH_DENSITY - LOW_DENSITY)
	return lerpf(0.92, 0.36, t)

func accent_color_name(speed_band: String, danger: String, kind: String) -> String:
	if kind == "laser_warning" or danger == "high":
		return "red"
	if speed_band == "fast":
		return "violet"
	if danger == "medium" or speed_band == "medium":
		return "gold"
	return "green"

func rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	rows.append({
		"id": "bullet_visual",
		"label_key": "screen.settings.bullet_visual",
		"summary": summary(),
	})
	for kind in KINDS:
		rows.append({
			"id": "bullet_visual_%s" % kind,
			"label_key": "screen.settings.bullet_visual",
			"visual_kind": kind,
			"count": int(last_counts.get(kind, 0)),
			"decorative_alpha": last_decorative_alpha,
			"enabled": true,
		})
	return rows

func summary() -> String:
	return "density %d alpha %.2f modified %d max_r %.1f" % [
		last_density,
		last_decorative_alpha,
		last_card_modified_count,
		last_max_presentation_radius,
	]

func _reset_stats(density: int) -> void:
	last_density = density
	last_card_modified_count = 0
	last_max_presentation_radius = 0.0
	for kind in KINDS:
		last_counts[kind] = 0
