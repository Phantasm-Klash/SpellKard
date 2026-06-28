class_name BalanceSimulationModel
extends RefCounted

const BulletMathLib := preload("res://scripts/bullet_math.gd")
const BulletPatterns := preload("res://scripts/bullet_pattern_library.gd")
const BulletEngineLib := preload("res://scripts/bullet_engine.gd")
const BulletVisualModelLib := preload("res://scripts/bullet_visual_model.gd")
const CardSystemLib := preload("res://scripts/card_system.gd")

const TICK_RATE := 60.0
const FIXED_DELTA := 1.0 / TICK_RATE
const DEFAULT_DURATION_TICKS := 720
const GRAZE_RADIUS := 22.0
const HIT_RADIUS := 4.0
const MAX_BULLETS := 1400
const DEFAULT_SEEDS: Array[int] = [20260625, 20260626, 20260627]

var pattern_configs: Array[Dictionary] = []
var deck_cards: Array[Dictionary] = []
var deck_snapshot: Dictionary = {}
var character_model: RefCounted = null
var bullet_visual_model: RefCounted = null
var last_report: Dictionary = {}

func configure(configs: Array[Dictionary], cards: Array[Dictionary], snapshot: Dictionary, characters: RefCounted = null, visual_model: RefCounted = null) -> void:
	pattern_configs = []
	for config in configs:
		pattern_configs.append(config.duplicate(true))
	deck_cards = []
	for card in cards:
		deck_cards.append(card.duplicate(true))
	deck_snapshot = snapshot.duplicate(true)
	character_model = characters
	bullet_visual_model = visual_model if visual_model != null else BulletVisualModelLib.new()

func run_suite(options: Dictionary = {}) -> Dictionary:
	var seeds: Array[int] = _int_array(options.get("seeds", DEFAULT_SEEDS))
	var duration_ticks: int = int(options.get("duration_ticks", DEFAULT_DURATION_TICKS))
	var character_ids: Array[String] = _character_ids(options.get("character_ids", []))
	var runs: Array[Dictionary] = []
	for character_id in character_ids:
		for pattern_index in range(pattern_configs.size()):
			for seed in seeds:
				runs.append(_run_single(seed, duration_ticks, pattern_index, character_id))
	var aggregate: Dictionary = _aggregate_runs(runs)
	var warnings: Array[String] = _build_warnings(aggregate)
	last_report = {
		"ok": warnings.is_empty(),
		"ruleset_version": str(deck_snapshot.get("ruleset_version", "ruleset-local-s0")),
		"duration_ticks": duration_ticks,
		"seed_count": seeds.size(),
		"pattern_count": pattern_configs.size(),
		"character_count": character_ids.size(),
		"run_count": runs.size(),
		"runs": runs,
		"aggregate": aggregate,
		"warnings": warnings,
		"summary": _summary_text(aggregate, warnings),
	}
	return last_report.duplicate(true)

func rows() -> Array[Dictionary]:
	if last_report.is_empty():
		return []
	var aggregate: Dictionary = last_report.get("aggregate", {})
	var rows: Array[Dictionary] = [
		{
			"id": "balance_summary",
			"label_key": "screen.settings.balance_sim",
			"value": str(last_report.get("summary", "")),
			"enabled": true,
		},
		{
			"id": "balance_score",
			"label_key": "screen.settings.balance_sim",
			"value": int(aggregate.get("average_score", 0)),
			"enabled": true,
		},
		{
			"id": "balance_graze",
			"label_key": "screen.settings.balance_sim",
			"value": "%.2f" % float(aggregate.get("average_graze", 0.0)),
			"enabled": true,
		},
		{
			"id": "balance_hits",
			"label_key": "screen.settings.balance_sim",
			"value": "%.2f" % float(aggregate.get("average_hits", 0.0)),
			"enabled": true,
		},
		{
			"id": "balance_cards",
			"label_key": "screen.settings.balance_sim",
			"value": "%.2f" % float(aggregate.get("average_cards_played", 0.0)),
			"enabled": true,
		},
	]
	for warning in last_report.get("warnings", []):
		rows.append({
			"id": "balance_warning_%d" % rows.size(),
			"label_key": "screen.settings.balance_sim",
			"value": str(warning),
			"enabled": false,
		})
	return rows

func _run_single(seed: int, duration_ticks: int, pattern_index: int, character_id: String) -> Dictionary:
	var pattern: Dictionary = pattern_configs[pattern_index].duplicate(true)
	var player_pos := Vector2(480, 600)
	var bullets: Array[Dictionary] = []
	var spawn_index: int = 0
	var score: int = 0
	var graze_count: int = 0
	var hit_count: int = 0
	var cards_played: int = 0
	var peak_bullets: int = 0
	var visual_unsafe_count: int = 0
	var high_density_ticks: int = 0
	var card_system: RefCounted = CardSystemLib.new()
	card_system.configure_from_cards(deck_cards, deck_snapshot)
	_select_character(character_id)
	for tick in range(1, duration_ticks + 1):
		card_system.tick_update(tick)
		cards_played += _auto_play_card(card_system, tick)
		var pattern_modifiers: Dictionary = card_system.build_pattern_modifiers()
		var self_modifiers: Dictionary = card_system.build_self_modifiers()
		var modified_pattern: Dictionary = BulletMathLib.apply_modifiers(pattern, pattern_modifiers)
		var interval: int = max(1, int(modified_pattern.get("interval_ticks", 30)))
		if tick % interval == 0:
			var spawned: Array[Dictionary] = BulletPatterns.emit_pattern(modified_pattern, tick, player_pos, spawn_index, seed)
			for bullet in spawned:
				bullet["card_modified"] = _has_pattern_modifier(pattern_modifiers)
			bullets.append_array(spawned)
			spawn_index += spawned.size()
		var effective_hit_radius: float = HIT_RADIUS * float(self_modifiers.get("hit_radius_multiplier", 1.0))
		var engine_result: Dictionary = BulletEngineLib.step_bullets(bullets, player_pos, tick, {
			"hit_radius": effective_hit_radius,
			"graze_radius": GRAZE_RADIUS,
			"player_id": character_id,
			"fixed_delta": FIXED_DELTA,
			"remove_on_hit": true,
		})
		for event in engine_result.get("events", []):
			var event_dict: Dictionary = event
			match String(event_dict.get("type", "")):
				"graze":
					graze_count += 1
					var graze_value: int = int(120.0 * _character_graze_modifier() * float(pattern_modifiers.get("graze_score_multiplier", 1.0)) * float(self_modifiers.get("graze_score_multiplier", 1.0)))
					score += graze_value
					card_system.add_energy(0.015 * _character_spell_power_modifier())
				"hit":
					hit_count += 1
					score = max(0, score - 600)
		bullets = engine_result.get("bullets", bullets)
		peak_bullets = max(peak_bullets, bullets.size())
		if bullets.size() > MAX_BULLETS:
			bullets.resize(MAX_BULLETS)
		if bullets.size() >= 900:
			high_density_ticks += 1
		if bullet_visual_model != null:
			bullet_visual_model.annotate_bullets(bullets, bullets.size())
			for bullet in bullets:
				var visual: Dictionary = bullet.get("visual", {})
				if not bool(visual.get("readability_safe", true)):
					visual_unsafe_count += 1
		score += 1
	return {
		"seed": seed,
		"pattern_id": str(pattern.get("id", "unknown")),
		"character_id": character_id,
		"score": score,
		"graze": graze_count,
		"hits": hit_count,
		"cards_played": cards_played,
		"peak_bullets": peak_bullets,
		"visual_unsafe_count": visual_unsafe_count,
		"high_density_ticks": high_density_ticks,
	}

func _auto_play_card(card_system: RefCounted, tick: int) -> int:
	for slot in range(CardSystemLib.HAND_LIMIT):
		if card_system.can_play(slot):
			var result: Dictionary = card_system.play(slot, tick)
			return 0 if result.is_empty() else 1
	return 0

func _aggregate_runs(runs: Array[Dictionary]) -> Dictionary:
	if runs.is_empty():
		return {}
	var total_score := 0.0
	var total_graze := 0.0
	var total_hits := 0.0
	var total_cards := 0.0
	var max_peak: int = 0
	var visual_unsafe: int = 0
	var high_density_ticks: int = 0
	var character_scores := {}
	var pattern_scores := {}
	for run in runs:
		total_score += float(run.get("score", 0))
		total_graze += float(run.get("graze", 0))
		total_hits += float(run.get("hits", 0))
		total_cards += float(run.get("cards_played", 0))
		max_peak = max(max_peak, int(run.get("peak_bullets", 0)))
		visual_unsafe += int(run.get("visual_unsafe_count", 0))
		high_density_ticks += int(run.get("high_density_ticks", 0))
		_append_score(character_scores, str(run.get("character_id", "")), float(run.get("score", 0)))
		_append_score(pattern_scores, str(run.get("pattern_id", "")), float(run.get("score", 0)))
	var count: float = float(runs.size())
	return {
		"average_score": total_score / count,
		"average_graze": total_graze / count,
		"average_hits": total_hits / count,
		"average_cards_played": total_cards / count,
		"max_peak_bullets": max_peak,
		"visual_unsafe_count": visual_unsafe,
		"high_density_ticks": high_density_ticks,
		"character_score_rows": _score_rows(character_scores),
		"pattern_score_rows": _score_rows(pattern_scores),
	}

func _build_warnings(aggregate: Dictionary) -> Array[String]:
	var warnings: Array[String] = []
	if int(aggregate.get("visual_unsafe_count", 0)) > 0:
		warnings.append("visual_readability")
	if int(aggregate.get("max_peak_bullets", 0)) >= MAX_BULLETS:
		warnings.append("performance_bullet_cap")
	if float(aggregate.get("average_hits", 0.0)) > 12.0:
		warnings.append("hit_rate_high")
	if float(aggregate.get("average_cards_played", 0.0)) < 1.0:
		warnings.append("card_usage_low")
	if _score_spread_too_high(aggregate.get("character_score_rows", []), 0.55):
		warnings.append("character_score_spread")
	if _score_spread_too_high(aggregate.get("pattern_score_rows", []), 0.75):
		warnings.append("pattern_score_spread")
	return warnings

func _summary_text(aggregate: Dictionary, warnings: Array[String]) -> String:
	return "score %.1f graze %.1f hits %.1f cards %.1f peak %d warnings %d" % [
		float(aggregate.get("average_score", 0.0)),
		float(aggregate.get("average_graze", 0.0)),
		float(aggregate.get("average_hits", 0.0)),
		float(aggregate.get("average_cards_played", 0.0)),
		int(aggregate.get("max_peak_bullets", 0)),
		warnings.size(),
	]

func _character_ids(value: Variant) -> Array[String]:
	var ids: Array[String] = []
	if typeof(value) == TYPE_ARRAY:
		for item in value:
			ids.append(str(item))
	if ids.is_empty() and character_model != null:
		ids = character_model.character_ids()
	if ids.is_empty():
		ids.append("balanced")
	return ids

func _int_array(value: Variant) -> Array[int]:
	var result: Array[int] = []
	if typeof(value) == TYPE_ARRAY:
		for item in value:
			result.append(int(item))
	if result.is_empty():
		result.append_array(DEFAULT_SEEDS)
	return result

func _select_character(character_id: String) -> void:
	if character_model != null:
		character_model.select_character(character_id)

func _character_graze_modifier() -> float:
	return float(character_model.graze_modifier()) if character_model != null else 1.0

func _character_spell_power_modifier() -> float:
	return float(character_model.spell_power_modifier()) if character_model != null else 1.0

func _has_pattern_modifier(modifiers: Dictionary) -> bool:
	var speed_changed := absf(float(modifiers.get("speed_multiplier", 1.0)) - 1.0) > 0.001
	var density_changed := absf(float(modifiers.get("density_multiplier", 1.0)) - 1.0) > 0.001
	var angle_changed := absf(float(modifiers.get("angle_offset", 0.0))) > 0.001
	var curve_changed := absf(float(modifiers.get("curve_strength", 0.0))) > 0.001
	var aim_changed := absf(float(modifiers.get("aim_bias", 0.0))) > 0.001
	return speed_changed or density_changed or angle_changed or curve_changed or aim_changed

func _append_score(scores: Dictionary, key: String, score: float) -> void:
	if not scores.has(key):
		scores[key] = {"id": key, "total": 0.0, "count": 0}
	var row: Dictionary = scores[key]
	row["total"] = float(row.get("total", 0.0)) + score
	row["count"] = int(row.get("count", 0)) + 1
	scores[key] = row

func _score_rows(scores: Dictionary) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for key in scores.keys():
		var row: Dictionary = scores[key]
		rows.append({
			"id": str(key),
			"average_score": float(row.get("total", 0.0)) / float(max(1, int(row.get("count", 0)))),
			"count": int(row.get("count", 0)),
		})
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return float(a.get("average_score", 0.0)) > float(b.get("average_score", 0.0))
	)
	return rows

func _score_spread_too_high(rows_value: Variant, threshold: float) -> bool:
	if typeof(rows_value) != TYPE_ARRAY:
		return false
	var rows: Array = rows_value
	if rows.size() < 2:
		return false
	var highest: float = float(rows[0].get("average_score", 0.0))
	var lowest: float = float(rows[rows.size() - 1].get("average_score", 0.0))
	if highest <= 0.0:
		return false
	return (highest - lowest) / highest > threshold
