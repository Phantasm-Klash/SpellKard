class_name CardSystem
extends RefCounted

const HAND_LIMIT := 4
const DRAW_INTERVAL_TICKS := 360
const STARTING_ENERGY := 2.0
const MAX_ENERGY := 10.0

var deck: Array[Dictionary] = []
var hand: Array[Dictionary] = []
var discard: Array[Dictionary] = []
var active_effects: Array[Dictionary] = []
var cooldowns := {}
var energy := STARTING_ENERGY
var draw_cursor := 0
var deck_snapshot := {}

func configure_local_practice() -> void:
	configure_from_cards([
		{
			"id": "focus_lens",
			"name_key": "card.focus_lens.name",
			"cost": 2.0,
			"cooldown_ticks": 240,
			"duration_ticks": 360,
			"effect": {"kind": "self", "graze_score_multiplier": 1.45, "focus_speed_multiplier": 0.82},
		},
		{
			"id": "hitbox_charm",
			"name_key": "card.hitbox_charm.name",
			"cost": 3.0,
			"cooldown_ticks": 420,
			"duration_ticks": 300,
			"effect": {"kind": "self", "hit_radius_multiplier": 0.65},
		},
		{
			"id": "density_surge",
			"name_key": "card.density_surge.name",
			"cost": 4.0,
			"cooldown_ticks": 540,
			"duration_ticks": 420,
			"effect": {"kind": "pattern", "density_multiplier": 1.35, "speed_multiplier": 1.08, "graze_score_multiplier": 1.2},
		},
		{
			"id": "tempo_break",
			"name_key": "card.tempo_break.name",
			"cost": 3.0,
			"cooldown_ticks": 480,
			"duration_ticks": 300,
			"effect": {"kind": "pattern", "speed_multiplier": 0.72, "density_multiplier": 0.85, "score_multiplier_penalty": 0.92},
		},
		{
			"id": "bomb_amplifier",
			"name_key": "card.bomb_amplifier.name",
			"cost": 2.0,
			"cooldown_ticks": 360,
			"duration_ticks": 480,
			"effect": {"kind": "self", "bomb_radius_multiplier": 1.28, "bomb_invuln_bonus_ticks": 24},
		},
		{
			"id": "guard_seal",
			"name_key": "card.guard_seal.name",
			"cost": 5.0,
			"cooldown_ticks": 720,
			"duration_ticks": 900,
			"effect": {"kind": "self", "shield_charges": 1},
		},
	], {
		"deck_id": "hardcoded_practice",
		"name": "Hardcoded Practice",
		"format": "local_practice",
		"card_ids": ["focus_lens", "hitbox_charm", "density_surge", "tempo_break", "bomb_amplifier", "guard_seal"],
	})

func configure_from_cards(card_definitions: Array[Dictionary], snapshot: Dictionary = {}) -> void:
	deck = []
	for card in card_definitions:
		deck.append(card.duplicate(true))
	deck_snapshot = snapshot.duplicate(true)
	hand.clear()
	discard.clear()
	active_effects.clear()
	cooldowns.clear()
	energy = STARTING_ENERGY
	draw_cursor = 0
	for i in range(HAND_LIMIT):
		draw_card()

func tick_update(tick: int) -> void:
	for card_id in cooldowns.keys():
		cooldowns[card_id] = max(0, int(cooldowns[card_id]) - 1)
	active_effects = active_effects.filter(func(effect: Dictionary) -> bool:
		return tick < int(effect.get("expires_tick", 0))
	)
	if tick > 0 and tick % DRAW_INTERVAL_TICKS == 0:
		draw_card()

func draw_card() -> bool:
	if hand.size() >= HAND_LIMIT or deck.is_empty():
		return false
	var card := deck[draw_cursor % deck.size()].duplicate(true)
	draw_cursor += 1
	hand.append(card)
	return true

func add_energy(amount: float) -> void:
	energy = clampf(energy + amount, 0.0, MAX_ENERGY)

func can_play(slot: int) -> bool:
	if slot < 0 or slot >= hand.size():
		return false
	var card := hand[slot]
	var card_id := String(card.get("id", ""))
	return energy >= float(card.get("cost", 0.0)) and int(cooldowns.get(card_id, 0)) <= 0

func play(slot: int, tick: int) -> Dictionary:
	if not can_play(slot):
		return {}
	var card := hand[slot]
	var card_id := String(card.get("id", ""))
	energy -= float(card.get("cost", 0.0))
	cooldowns[card_id] = int(card.get("cooldown_ticks", 0))
	hand.remove_at(slot)
	discard.append(card)
	var effect: Dictionary = card.get("effect", {}).duplicate(true)
	effect["card_id"] = card_id
	effect["card_name_key"] = String(card.get("name_key", card_id))
	effect["started_tick"] = tick
	effect["expires_tick"] = tick + int(card.get("duration_ticks", 0))
	if int(effect.get("draw_cards", 0)) > 0:
		for i in range(int(effect.get("draw_cards", 0))):
			draw_card()
	if float(effect.get("energy_gain", 0.0)) > 0.0:
		add_energy(float(effect.get("energy_gain", 0.0)))
	active_effects.append(effect)
	return {
		"card_id": card_id,
		"card_name_key": String(card.get("name_key", card_id)),
		"slot": slot,
		"cost": float(card.get("cost", 0.0)),
		"expires_tick": int(effect.get("expires_tick", tick)),
	}

func build_pattern_modifiers() -> Dictionary:
	var result := {
		"speed_multiplier": 1.0,
		"density_multiplier": 1.0,
		"angle_offset": 0.0,
		"curve_strength": 0.0,
		"aim_bias": 0.0,
		"graze_score_multiplier": 1.0,
		"score_multiplier_penalty": 1.0,
	}
	for effect in active_effects:
		if String(effect.get("kind", "")) != "pattern":
			continue
		result["speed_multiplier"] = float(result["speed_multiplier"]) * float(effect.get("speed_multiplier", 1.0))
		result["density_multiplier"] = float(result["density_multiplier"]) * float(effect.get("density_multiplier", 1.0))
		result["angle_offset"] = float(result["angle_offset"]) + float(effect.get("angle_offset", 0.0))
		result["curve_strength"] = float(result["curve_strength"]) + float(effect.get("curve_strength", 0.0))
		result["aim_bias"] = float(result["aim_bias"]) + float(effect.get("aim_bias", 0.0))
		result["graze_score_multiplier"] = float(result["graze_score_multiplier"]) * float(effect.get("graze_score_multiplier", 1.0))
		result["score_multiplier_penalty"] = float(result["score_multiplier_penalty"]) * float(effect.get("score_multiplier_penalty", 1.0))
	return result

func build_self_modifiers() -> Dictionary:
	var result := {
		"focus_speed_multiplier": 1.0,
		"hit_radius_multiplier": 1.0,
		"graze_score_multiplier": 1.0,
		"bomb_radius_multiplier": 1.0,
		"bomb_invuln_bonus_ticks": 0,
		"shield_charges": 0,
	}
	for effect in active_effects:
		if String(effect.get("kind", "")) != "self":
			continue
		result["focus_speed_multiplier"] = float(result["focus_speed_multiplier"]) * float(effect.get("focus_speed_multiplier", 1.0))
		result["hit_radius_multiplier"] = float(result["hit_radius_multiplier"]) * float(effect.get("hit_radius_multiplier", 1.0))
		result["graze_score_multiplier"] = float(result["graze_score_multiplier"]) * float(effect.get("graze_score_multiplier", 1.0))
		result["bomb_radius_multiplier"] = float(result["bomb_radius_multiplier"]) * float(effect.get("bomb_radius_multiplier", 1.0))
		result["bomb_invuln_bonus_ticks"] = int(result["bomb_invuln_bonus_ticks"]) + int(effect.get("bomb_invuln_bonus_ticks", 0))
		result["shield_charges"] = int(result["shield_charges"]) + int(effect.get("shield_charges", 0))
	return result

func consume_shield_charge() -> bool:
	for effect in active_effects:
		if String(effect.get("kind", "")) == "self" and int(effect.get("shield_charges", 0)) > 0:
			effect["shield_charges"] = int(effect["shield_charges"]) - 1
			return true
	return false

func hand_summary(localization: RefCounted = null) -> String:
	var parts: Array[String] = []
	for i in range(HAND_LIMIT):
		if i >= hand.size():
			parts.append("%d:-" % [i + 1])
			continue
		var card := hand[i]
		var card_id := String(card.get("id", ""))
		var name_key := String(card.get("name_key", card_id))
		if name_key.is_empty():
			name_key = "card.none"
		var display_name: String = localization.text_for(name_key) if localization != null else name_key
		var cooldown := int(cooldowns.get(card_id, 0))
		var ready := ""
		if can_play(i):
			ready = localization.text_for("card.ready") if localization != null else "ready"
		elif cooldown > 0:
			ready = localization.text_for("card.cooldown", {"ticks": cooldown}) if localization != null else "cd %d" % cooldown
		else:
			ready = localization.text_for("card.need", {"cost": "%.0f" % float(card.get("cost", 0.0))}) if localization != null else "need %.0f" % float(card.get("cost", 0.0))
		parts.append("%d:%s %.0f/%s" % [i + 1, display_name, float(card.get("cost", 0.0)), ready])
	return " | ".join(parts)

func active_summary(localization: RefCounted = null) -> String:
	var parts: Array[String] = []
	for effect in active_effects:
		var name_key := String(effect.get("card_name_key", effect.get("card_id", "?")))
		if name_key.is_empty():
			name_key = "card.none"
		var display_name: String = localization.text_for(name_key) if localization != null else name_key
		parts.append("%s:%d" % [display_name, int(effect.get("expires_tick", 0))])
	return (localization.text_for("card.none") if localization != null else "none") if parts.is_empty() else ", ".join(parts)
