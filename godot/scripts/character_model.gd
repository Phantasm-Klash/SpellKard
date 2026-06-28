class_name CharacterModel
extends RefCounted

const DEFAULT_CHARACTER_ID := "balanced"

var characters: Array[Dictionary] = []
var character_by_id: Dictionary = {}
var selected_character_id := DEFAULT_CHARACTER_ID
var last_action_status := "none"

func _init() -> void:
	characters = _build_characters()
	_rebuild_index()

func select_character(character_id: String) -> bool:
	if not character_by_id.has(character_id):
		last_action_status = "missing"
		return false
	selected_character_id = character_id
	last_action_status = "selected"
	return true

func cycle_character(delta: int = 1) -> String:
	var ids := character_ids()
	if ids.is_empty():
		return selected_character_id
	var index := ids.find(selected_character_id)
	if index < 0:
		index = 0
	selected_character_id = ids[wrapi(index + delta, 0, ids.size())]
	last_action_status = "cycled"
	return selected_character_id

func active_character() -> Dictionary:
	return character_config(selected_character_id)

func character_config(character_id: String) -> Dictionary:
	if not character_by_id.has(character_id):
		return {}
	return (character_by_id[character_id] as Dictionary).duplicate(true)

func character_ids() -> Array[String]:
	var ids: Array[String] = []
	for character in characters:
		ids.append(str(character.get("id", "")))
	return ids

func move_speed(focused: bool) -> float:
	var character := active_character()
	return float(character.get("slow_speed", 145.0)) if focused else float(character.get("move_speed", 330.0))

func shot_interval_ticks(focused: bool) -> int:
	var pattern := _shot_pattern(focused)
	return max(1, int(pattern.get("interval_ticks", 5)))

func shot_rows(focused: bool) -> Array[Dictionary]:
	var pattern := _shot_pattern(focused)
	var rows: Array[Dictionary] = []
	var lanes_value: Variant = pattern.get("lanes", [])
	if typeof(lanes_value) != TYPE_ARRAY:
		return rows
	var speed := float(pattern.get("speed", 620.0))
	var radius := float(pattern.get("radius", 3.5))
	var damage := int(pattern.get("damage", 1))
	var color_name := str(pattern.get("color_name", "cyan"))
	for item in lanes_value as Array:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var lane := item as Dictionary
		rows.append({
			"offset": Vector2(float(lane.get("x", 0.0)), float(lane.get("y", -12.0))),
			"velocity": Vector2(float(lane.get("vx", 0.0)), float(lane.get("vy", -1.0))).normalized() * speed,
			"radius": radius,
			"damage": damage,
			"color_name": color_name,
		})
	return rows

func bomb_radius_multiplier() -> float:
	return float(active_character().get("bomb_radius_multiplier", 1.0))

func bomb_invuln_multiplier() -> float:
	return float(active_character().get("bomb_invuln_multiplier", 1.0))

func graze_modifier() -> float:
	return float(active_character().get("graze_modifier", 1.0))

func spell_power_modifier() -> float:
	return float(active_character().get("spell_power_modifier", 1.0))

func hitbox_visual_scale() -> float:
	return float(active_character().get("hitbox_visual_scale", 1.0))

func rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for character in characters:
		var character_id := str(character.get("id", ""))
		rows.append({
			"id": "character_%s" % character_id,
			"character_id": character_id,
			"label_key": str(character.get("name_key", "")),
			"selected": character_id == selected_character_id,
			"move_speed": float(character.get("move_speed", 0.0)),
			"slow_speed": float(character.get("slow_speed", 0.0)),
			"bomb_type": str(character.get("bomb_type", "")),
			"graze_modifier": float(character.get("graze_modifier", 1.0)),
			"spell_power_modifier": float(character.get("spell_power_modifier", 1.0)),
			"enabled": true,
		})
	return rows

func summary() -> String:
	var character := active_character()
	return "%s move %.0f slow %.0f bomb %s graze %.2f spell %.2f" % [
		selected_character_id,
		float(character.get("move_speed", 0.0)),
		float(character.get("slow_speed", 0.0)),
		str(character.get("bomb_type", "")),
		graze_modifier(),
		spell_power_modifier(),
	]

func _shot_pattern(focused: bool) -> Dictionary:
	var character := active_character()
	var key := "focus_shot_pattern" if focused else "normal_shot_pattern"
	var value: Variant = character.get(key, {})
	if typeof(value) != TYPE_DICTIONARY:
		return {}
	return (value as Dictionary).duplicate(true)

func _rebuild_index() -> void:
	character_by_id.clear()
	for character in characters:
		character_by_id[str(character.get("id", ""))] = character

func _build_characters() -> Array[Dictionary]:
	return [
		{
			"id": "balanced",
			"name_key": "character.balanced.name",
			"move_speed": 330.0,
			"slow_speed": 145.0,
			"bomb_type": "standard_clear",
			"bomb_radius_multiplier": 1.0,
			"bomb_invuln_multiplier": 1.0,
			"graze_modifier": 1.0,
			"spell_power_modifier": 1.0,
			"hitbox_visual_scale": 1.0,
			"normal_shot_pattern": {
				"interval_ticks": 5,
				"speed": 620.0,
				"radius": 3.5,
				"damage": 1,
				"color_name": "cyan",
				"lanes": [{"x": -24.0}, {"x": -8.0}, {"x": 8.0}, {"x": 24.0}],
			},
			"focus_shot_pattern": {
				"interval_ticks": 5,
				"speed": 640.0,
				"radius": 3.5,
				"damage": 1,
				"color_name": "cyan",
				"lanes": [{"x": -10.0}, {"x": 10.0}],
			},
		},
		{
			"id": "precision",
			"name_key": "character.precision.name",
			"move_speed": 300.0,
			"slow_speed": 108.0,
			"bomb_type": "standard_clear",
			"bomb_radius_multiplier": 0.96,
			"bomb_invuln_multiplier": 1.05,
			"graze_modifier": 1.28,
			"spell_power_modifier": 0.95,
			"hitbox_visual_scale": 1.35,
			"normal_shot_pattern": {
				"interval_ticks": 5,
				"speed": 610.0,
				"radius": 3.3,
				"damage": 1,
				"color_name": "green",
				"lanes": [{"x": -14.0}, {"x": 14.0}],
			},
			"focus_shot_pattern": {
				"interval_ticks": 4,
				"speed": 660.0,
				"radius": 3.2,
				"damage": 1,
				"color_name": "green",
				"lanes": [{"x": -5.0}, {"x": 5.0}],
			},
		},
		{
			"id": "wide",
			"name_key": "character.wide.name",
			"move_speed": 340.0,
			"slow_speed": 150.0,
			"bomb_type": "standard_clear",
			"bomb_radius_multiplier": 1.0,
			"bomb_invuln_multiplier": 1.0,
			"graze_modifier": 0.96,
			"spell_power_modifier": 0.98,
			"hitbox_visual_scale": 1.0,
			"normal_shot_pattern": {
				"interval_ticks": 5,
				"speed": 600.0,
				"radius": 3.4,
				"damage": 1,
				"color_name": "gold",
				"lanes": [{"x": -40.0, "vx": -0.12}, {"x": -20.0, "vx": -0.04}, {"x": 0.0}, {"x": 20.0, "vx": 0.04}, {"x": 40.0, "vx": 0.12}],
			},
			"focus_shot_pattern": {
				"interval_ticks": 5,
				"speed": 610.0,
				"radius": 3.4,
				"damage": 1,
				"color_name": "gold",
				"lanes": [{"x": -24.0, "vx": -0.05}, {"x": -8.0}, {"x": 8.0}, {"x": 24.0, "vx": 0.05}],
			},
		},
		{
			"id": "spell_power",
			"name_key": "character.spell_power.name",
			"move_speed": 318.0,
			"slow_speed": 138.0,
			"bomb_type": "weak_clear",
			"bomb_radius_multiplier": 0.86,
			"bomb_invuln_multiplier": 0.90,
			"graze_modifier": 1.12,
			"spell_power_modifier": 1.32,
			"hitbox_visual_scale": 1.05,
			"normal_shot_pattern": {
				"interval_ticks": 5,
				"speed": 615.0,
				"radius": 3.5,
				"damage": 1,
				"color_name": "violet",
				"lanes": [{"x": -22.0}, {"x": -7.0}, {"x": 7.0}, {"x": 22.0}],
			},
			"focus_shot_pattern": {
				"interval_ticks": 5,
				"speed": 645.0,
				"radius": 3.5,
				"damage": 1,
				"color_name": "violet",
				"lanes": [{"x": -12.0}, {"x": 0.0}, {"x": 12.0}],
			},
		},
	]
