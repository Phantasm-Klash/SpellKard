class_name GameModeModel
extends RefCounted

const MODE_CERTIFICATION := "certification"
const MODE_PVP_DUEL := "pvp_duel"
const MODE_BATTLE_ROYALE := "battle_royale"
const MODE_WORLD_BOSS := "world_boss"
const MODE_INSTANCE_BOSS := "instance_boss"
const BR_ROUND_SECONDS := 30
const BR_CANDIDATE_COUNT := 3
const BR_POOL_CARDS_PER_PLAYER := 4
const BOSS_MIN_PLAYERS := 4
const BOSS_MAX_PLAYERS := 8

var matchmaking_model: RefCounted = null
var network_match_model: RefCounted = null
var selected_mode_id := MODE_CERTIFICATION
var last_action_status := "none"
var last_error_code := "none"

var certification_state: Dictionary = {}
var battle_royale_state: Dictionary = {}
var world_boss_state: Dictionary = {}
var instance_boss_state: Dictionary = {}
var mode_action_requests: Array[Dictionary] = []

func _init() -> void:
	reset_local_state()

func configure(matchmaking: RefCounted, network_match: RefCounted) -> void:
	matchmaking_model = matchmaking
	network_match_model = network_match

func reset_local_state() -> void:
	certification_state = {
		"rating_code": "D",
		"display_i18n_key": "screen.mode.certification",
		"required_previous_rating": "",
		"challenge_stage_id": "cert_d_stage",
		"pass_conditions": ["survive", "hit_limit", "score_floor"],
		"rank_score_floor": 0,
		"rank_score": 0,
		"percentile": 1.0,
		"next_unlock_percentile": 0.30,
		"next_certification_unlocked": false,
		"season_locked": false,
	}
	battle_royale_state = {
		"players": [],
		"match_card_pool": [],
		"round_index": 0,
		"round_duration_seconds": BR_ROUND_SECONDS,
		"choice_deadline_tick": 0,
		"candidate_cards": [],
		"selected_card_id": "",
		"zero_round_order": [],
		"effect_trigger_tick": 0,
		"waiting_for_players": true,
	}
	world_boss_state = _default_boss_state(true)
	instance_boss_state = _default_boss_state(false)
	mode_action_requests.clear()
	selected_mode_id = MODE_CERTIFICATION
	last_action_status = "none"
	last_error_code = "none"

func select_mode(mode_id: String) -> bool:
	if not [MODE_CERTIFICATION, MODE_PVP_DUEL, MODE_BATTLE_ROYALE, MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		last_action_status = "failed"
		last_error_code = "mode_missing"
		return false
	selected_mode_id = mode_id
	if matchmaking_model != null:
		matchmaking_model.select_mode(mode_id)
	last_action_status = "selected"
	last_error_code = "none"
	return true

func apply_server_mode_state(mode_id: String, state: Dictionary) -> bool:
	if not select_mode(mode_id):
		return false
	var target: Dictionary = _state_for_mode(mode_id)
	for key in state.keys():
		target[key] = state[key]
	_set_state_for_mode(mode_id, target)
	if network_match_model != null:
		network_match_model.receive_event({"type": "mode_state", "mode_state": state})
	last_action_status = "server_state"
	last_error_code = "none"
	return true

func apply_server_mode_action_response(response: Dictionary) -> Dictionary:
	var mode_id := String(response.get("mode_id", selected_mode_id))
	if not [MODE_CERTIFICATION, MODE_PVP_DUEL, MODE_BATTLE_ROYALE, MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		last_action_status = "failed"
		last_error_code = "mode_missing"
		return {"ok": false, "reason": last_error_code}
	selected_mode_id = mode_id
	if matchmaking_model != null:
		matchmaking_model.select_mode(mode_id)
	if bool(response.get("accepted", false)) and typeof(response.get("mode_state", {})) == TYPE_DICTIONARY:
		var target: Dictionary = _state_for_mode(mode_id)
		var state: Dictionary = response.get("mode_state", {})
		for key in state.keys():
			target[key] = state[key]
		_set_state_for_mode(mode_id, target)
		last_action_status = String(response.get("action_type", "mode_action"))
		last_error_code = "none"
	else:
		last_action_status = "server_rejected"
		last_error_code = String(response.get("reason", "mode_action_failed"))
	var action_row := {
		"mode_id": mode_id,
		"action_type": String(response.get("action_type", "")),
		"action_id": String(response.get("action_id", "")),
		"status": String(response.get("status", "")),
		"accepted": bool(response.get("accepted", false)),
		"server_authoritative": bool(response.get("server_authoritative", true)),
		"client_result_authoritative": bool(response.get("client_result_authoritative", false)),
	}
	mode_action_requests.append(action_row)
	if mode_action_requests.size() > 32:
		mode_action_requests.pop_front()
	return {"ok": bool(response.get("accepted", false)), "reason": last_error_code, "action": action_row}

func mode_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	rows.append_array(_certification_rows())
	rows.append_array(_battle_royale_rows())
	rows.append_array(_world_boss_rows())
	rows.append_array(_instance_boss_rows())
	rows.append({
		"id": "mode_action_log",
		"label_key": "screen.mode.action_log",
		"value": "%d %s %s" % [mode_action_requests.size(), last_action_status, last_error_code],
		"enabled": true,
	})
	return rows

func certification_eligible_for_next() -> bool:
	if bool(certification_state.get("season_locked", false)):
		return false
	if not bool(certification_state.get("next_certification_unlocked", false)):
		return false
	return float(certification_state.get("percentile", 1.0)) <= float(certification_state.get("next_unlock_percentile", 0.30))

func apply_certification_result(result: Dictionary) -> bool:
	var rating_code := str(result.get("rating_code", certification_state.get("rating_code", "")))
	if rating_code.is_empty():
		last_action_status = "failed"
		last_error_code = "rating_missing"
		return false
	certification_state["rating_code"] = rating_code
	if result.has("rank_score_after"):
		certification_state["rank_score"] = int(result.get("rank_score_after", certification_state.get("rank_score", 0)))
	else:
		certification_state["rank_score"] = int(certification_state.get("rank_score", 0)) + int(result.get("rank_score_delta", 0))
	certification_state["last_rank_score_delta"] = int(result.get("rank_score_delta", certification_state.get("last_rank_score_delta", 0)))
	certification_state["rank_score_floor"] = int(result.get("rank_score_floor", certification_state.get("rank_score_floor", 0)))
	certification_state["challenge_stage_id"] = str(result.get("challenge_stage_id", certification_state.get("challenge_stage_id", "")))
	certification_state["percentile"] = float(result.get("percentile_after", certification_state.get("percentile", 1.0)))
	certification_state["next_certification_unlocked"] = bool(result.get("next_certification_unlocked", result.get("qualified_top_30", false)))
	certification_state["replay_id"] = str(result.get("replay_id", ""))
	certification_state["server_authoritative"] = bool(result.get("server_authoritative", true))
	certification_state["last_result"] = str(result.get("result", certification_state.get("last_result", "")))
	last_action_status = "cert_result"
	last_error_code = "none"
	return true

func apply_server_certification_profile(profile: Dictionary) -> Dictionary:
	if profile.is_empty():
		last_action_status = "failed"
		last_error_code = "cert_profile_missing"
		return {"ok": false, "reason": last_error_code}
	if bool(profile.get("client_result_authoritative", false)):
		last_action_status = "failed"
		last_error_code = "client_authoritative_cert"
		return {"ok": false, "reason": last_error_code}
	var rating_code := str(profile.get("rating_code", certification_state.get("rating_code", "")))
	if rating_code.is_empty():
		last_action_status = "failed"
		last_error_code = "rating_missing"
		return {"ok": false, "reason": last_error_code}
	certification_state["rating_code"] = rating_code
	certification_state["rank_score"] = int(profile.get("rank_score", certification_state.get("rank_score", 0)))
	certification_state["rank_score_floor"] = int(profile.get("rank_score_floor", certification_state.get("rank_score_floor", 0)))
	certification_state["challenge_stage_id"] = str(profile.get("challenge_stage_id", certification_state.get("challenge_stage_id", "")))
	certification_state["percentile"] = float(profile.get("percentile", certification_state.get("percentile", 1.0)))
	certification_state["next_certification_unlocked"] = bool(profile.get("next_certification_unlocked", profile.get("top_30_qualified", false)))
	certification_state["last_rank_score_delta"] = int(profile.get("last_rank_score_delta", certification_state.get("last_rank_score_delta", 0)))
	certification_state["season_id"] = str(profile.get("season_id", certification_state.get("season_id", "local_s0")))
	certification_state["updated_at"] = str(profile.get("updated_at", certification_state.get("updated_at", "")))
	certification_state["server_authoritative"] = bool(profile.get("server_authoritative", true))
	certification_state["client_result_authoritative"] = false
	if profile.has("last_result"):
		certification_state["last_result"] = str(profile.get("last_result", ""))
	last_action_status = "cert_profile"
	last_error_code = "none"
	return {"ok": true, "reason": "none", "rating_code": rating_code, "rank_score": int(certification_state.get("rank_score", 0)), "top_30": certification_eligible_for_next()}

func apply_server_world_boss_snapshot(snapshot: Dictionary) -> Dictionary:
	if snapshot.is_empty():
		last_action_status = "failed"
		last_error_code = "world_boss_snapshot_missing"
		return {"ok": false, "reason": last_error_code}
	if bool(snapshot.get("client_result_authoritative", false)):
		last_action_status = "failed"
		last_error_code = "client_authoritative_world_boss"
		return {"ok": false, "reason": last_error_code}
	world_boss_state["boss_instance_id"] = str(snapshot.get("boss_instance_id", world_boss_state.get("boss_instance_id", "")))
	world_boss_state["season_id"] = str(snapshot.get("season_id", world_boss_state.get("season_id", "")))
	world_boss_state["max_hp"] = float(snapshot.get("max_hp", world_boss_state.get("max_hp", 0.0)))
	world_boss_state["current_hp"] = max(0.0, float(snapshot.get("current_hp", world_boss_state.get("current_hp", 0.0))))
	world_boss_state["daily_attempt_limit"] = int(snapshot.get("daily_attempt_limit", world_boss_state.get("daily_attempt_limit", 3)))
	world_boss_state["daily_attempts_used"] = int(snapshot.get("daily_attempts_used", world_boss_state.get("daily_attempts_used", 0)))
	world_boss_state["daily_attempts_left"] = max(0, int(snapshot.get("daily_attempts_left", world_boss_state.get("daily_attempts_left", 0))))
	world_boss_state["defeated_at"] = str(snapshot.get("defeated_at", world_boss_state.get("defeated_at", "")))
	world_boss_state["defeated_by_match_id"] = str(snapshot.get("defeated_by_match_id", world_boss_state.get("defeated_by_match_id", "")))
	world_boss_state["defeated_by_user_id"] = str(snapshot.get("defeated_by_user_id", world_boss_state.get("defeated_by_user_id", "")))
	world_boss_state["world_announcement"] = "world_boss_defeated" if bool(snapshot.get("announcement_emitted", false)) else str(world_boss_state.get("world_announcement", ""))
	world_boss_state["server_authoritative"] = bool(snapshot.get("server_authoritative", true))
	last_action_status = "world_boss_snapshot"
	last_error_code = "none"
	return {"ok": true, "reason": "none", "current_hp": int(world_boss_state.get("current_hp", 0)), "attempts_left": int(world_boss_state.get("daily_attempts_left", 0))}

func configure_battle_royale_players(players: Array) -> bool:
	var player_ids := _string_array(players)
	battle_royale_state["players"] = player_ids
	battle_royale_state["waiting_for_players"] = player_ids.size() < 5
	last_action_status = "br_players"
	last_error_code = "none" if player_ids.size() <= 10 else "too_many_players"
	return player_ids.size() <= 10

func build_battle_royale_pool(player_cards: Dictionary) -> Dictionary:
	var pool: Array[Dictionary] = []
	for player_id in player_cards.keys():
		var cards := _string_array(player_cards[player_id] if typeof(player_cards[player_id]) == TYPE_ARRAY else [])
		if cards.size() != BR_POOL_CARDS_PER_PLAYER:
			last_action_status = "failed"
			last_error_code = "br_pool_card_count"
			return {"valid": false, "reason": last_error_code, "pool": []}
		for card_id in cards:
			pool.append({"player_id": str(player_id), "card_id": card_id})
	battle_royale_state["match_card_pool"] = pool
	last_action_status = "br_pool"
	last_error_code = "none"
	return {"valid": true, "reason": "none", "pool": pool}

func receive_battle_royale_round(round_index: int, candidate_cards: Array, deadline_tick: int, zero_round_order: Array, effect_trigger_tick: int) -> bool:
	var candidates := _string_array(candidate_cards)
	if candidates.size() != BR_CANDIDATE_COUNT:
		last_action_status = "failed"
		last_error_code = "br_candidate_count"
		return false
	battle_royale_state["round_index"] = max(0, round_index)
	battle_royale_state["candidate_cards"] = candidates
	battle_royale_state["choice_deadline_tick"] = max(0, deadline_tick)
	battle_royale_state["zero_round_order"] = _string_array(zero_round_order)
	battle_royale_state["effect_trigger_tick"] = max(0, effect_trigger_tick)
	battle_royale_state["selected_card_id"] = ""
	last_action_status = "br_round"
	last_error_code = "none"
	return true

func select_battle_royale_card(card_id: String, tick: int) -> Dictionary:
	var candidates := _string_array(battle_royale_state.get("candidate_cards", []))
	if not candidates.has(card_id):
		last_action_status = "failed"
		last_error_code = "br_card_not_candidate"
		return _action_result(false, {})
	battle_royale_state["selected_card_id"] = card_id
	var request := _record_mode_action(MODE_BATTLE_ROYALE, "select_round_card", {
		"card_id": card_id,
		"round_index": int(battle_royale_state.get("round_index", 0)),
		"tick": tick,
	})
	last_action_status = "br_select"
	last_error_code = "none"
	return _action_result(true, request)

func configure_boss_party(mode_id: String, player_ids: Array) -> bool:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		last_action_status = "failed"
		last_error_code = "boss_mode_invalid"
		return false
	var ids := _string_array(player_ids)
	var valid_count := ids.size() >= BOSS_MIN_PLAYERS and ids.size() <= BOSS_MAX_PLAYERS
	var state := _state_for_mode(mode_id)
	state["party_ids"] = ids
	state["party_status"] = "ready" if valid_count else "waiting"
	state["positions"] = _boss_positions(ids)
	_set_state_for_mode(mode_id, state)
	last_action_status = "boss_party"
	last_error_code = "none" if valid_count else "boss_party_size"
	return valid_count

func request_boss_card_transfer(mode_id: String, from_player_id: String, to_player_id: String, card_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		last_action_status = "failed"
		last_error_code = "boss_mode_invalid"
		return _action_result(false, {})
	var state := _state_for_mode(mode_id)
	var transferred := _string_array(state.get("transferred_card_ids", []))
	if transferred.has(card_id):
		last_action_status = "failed"
		last_error_code = "transfer_duplicate"
		return _action_result(false, {})
	transferred.append(card_id)
	state["transferred_card_ids"] = transferred
	var requests: Array = state.get("transfer_requests", [])
	var transfer := {
		"from_player_id": from_player_id,
		"to_player_id": to_player_id,
		"card_id": card_id,
		"status": "requested",
	}
	requests.append(transfer)
	state["transfer_requests"] = requests
	_set_state_for_mode(mode_id, state)
	var request := _record_mode_action(mode_id, "transfer_card", transfer)
	last_action_status = "transfer_request"
	last_error_code = "none"
	return _action_result(true, request)

func apply_world_boss_result(result: Dictionary) -> bool:
	var hp_after: Variant = result.get("boss_hp_after_global", result.get("current_hp", world_boss_state.get("current_hp", 0.0)))
	world_boss_state["current_hp"] = max(0.0, float(hp_after))
	world_boss_state["max_hp"] = float(result.get("boss_hp_global_max", result.get("boss_max_hp", world_boss_state.get("max_hp", 0.0))))
	world_boss_state["damage_this_match"] = int(result.get("damage_this_match", result.get("team_damage", world_boss_state.get("damage_this_match", 0))))
	world_boss_state["global_damage_applied"] = int(result.get("global_damage_applied", world_boss_state.get("global_damage_applied", 0)))
	world_boss_state["daily_attempts_left"] = max(0, int(result.get("daily_attempts_left", world_boss_state.get("daily_attempts_left", 0))))
	world_boss_state["defeated_by_match_id"] = str(result.get("defeated_by_match_id", world_boss_state.get("defeated_by_match_id", "")))
	world_boss_state["defeated_by_user_id"] = str(result.get("defeated_by_user_id", world_boss_state.get("defeated_by_user_id", "")))
	world_boss_state["server_authoritative"] = bool(result.get("server_authority", result.get("server_authoritative", true)))
	if bool(result.get("world_announcement_emitted", false)):
		world_boss_state["world_announcement"] = str(result.get("world_announcement", "world_boss_defeated"))
	if float(world_boss_state.get("current_hp", 0.0)) <= 0.0 and str(world_boss_state.get("defeated_at", "")).is_empty():
		world_boss_state["defeated_at"] = str(result.get("defeated_at", Time.get_datetime_string_from_system(true, true)))
		if str(world_boss_state.get("world_announcement", "")).is_empty():
			world_boss_state["world_announcement"] = str(result.get("world_announcement", "defeated"))
	last_action_status = "world_boss_result"
	last_error_code = "none"
	return true

func apply_instance_boss_result(result: Dictionary) -> bool:
	var boss_defeated := bool(result.get("boss_defeated", result.get("instance_cleared", false)))
	var survivors := int(result.get("survivors", 0))
	var failed_mechanic := bool(result.get("failed_mechanic", false))
	var cleared := bool(result.get("instance_cleared", boss_defeated and survivors > 0 and not failed_mechanic))
	instance_boss_state["boss_defeated"] = boss_defeated
	instance_boss_state["survivors"] = survivors
	instance_boss_state["failed_mechanic"] = failed_mechanic
	instance_boss_state["cleared"] = cleared
	instance_boss_state["party_status"] = str(result.get("party_status", "cleared" if cleared else "failed"))
	instance_boss_state["current_hp"] = max(0.0, float(result.get("boss_hp_after", instance_boss_state.get("current_hp", 0.0))))
	instance_boss_state["clear_time_seconds"] = int(result.get("clear_time_seconds", 0))
	instance_boss_state["deaths"] = int(result.get("deaths", 0))
	instance_boss_state["stars"] = _calculate_instance_stars(result, cleared)
	last_action_status = "instance_boss_result"
	last_error_code = "none"
	return true

func summary() -> String:
	return "%s %s %s actions %d" % [selected_mode_id, last_action_status, last_error_code, mode_action_requests.size()]

func _certification_rows() -> Array[Dictionary]:
	return [
		{"id": "cert_rating", "label_key": "screen.mode.cert.rating", "value": str(certification_state.get("rating_code", "-")), "enabled": selected_mode_id == MODE_CERTIFICATION},
		{"id": "cert_rank", "label_key": "screen.mode.cert.rank", "value": int(certification_state.get("rank_score", 0)), "enabled": true},
		{"id": "cert_top30", "label_key": "screen.mode.cert.top30", "value": "%.1f%% / %.0f%%" % [float(certification_state.get("percentile", 1.0)) * 100.0, float(certification_state.get("next_unlock_percentile", 0.30)) * 100.0], "enabled": certification_eligible_for_next()},
		{"id": "cert_rank_delta", "label_key": "screen.mode.cert.rank", "value": "%+d server %s" % [int(certification_state.get("last_rank_score_delta", 0)), "yes" if bool(certification_state.get("server_authoritative", false)) else "local"], "enabled": bool(certification_state.get("server_authoritative", false))},
		{"id": "cert_stage", "label_key": "screen.mode.cert.stage", "value": str(certification_state.get("challenge_stage_id", "-")), "items": certification_state.get("pass_conditions", []), "enabled": true},
	]

func _battle_royale_rows() -> Array[Dictionary]:
	var players := _string_array(battle_royale_state.get("players", []))
	var candidates := _string_array(battle_royale_state.get("candidate_cards", []))
	var selected_card_id := str(battle_royale_state.get("selected_card_id", ""))
	var candidate_value := ",".join(candidates)
	if not selected_card_id.is_empty():
		candidate_value = "%s selected %s" % [candidate_value, selected_card_id]
	return [
		{"id": "br_players", "label_key": "screen.mode.br.players", "value": "%d/5-10" % players.size(), "enabled": players.size() >= 5 and players.size() <= 10},
		{"id": "br_pool", "label_key": "screen.mode.br.pool", "value": "%d cards" % (battle_royale_state.get("match_card_pool", []) as Array).size(), "enabled": true},
		{"id": "br_round", "label_key": "screen.mode.br.round", "value": "%d %ds" % [int(battle_royale_state.get("round_index", 0)), int(battle_royale_state.get("round_duration_seconds", BR_ROUND_SECONDS))], "enabled": true},
		{"id": "br_candidates", "label_key": "screen.mode.br.candidates", "value": candidate_value, "items": candidates, "selected_card_id": selected_card_id, "enabled": candidates.size() == BR_CANDIDATE_COUNT},
		{"id": "br_zero_order", "label_key": "screen.mode.br.zero_order", "value": "trigger %d" % int(battle_royale_state.get("effect_trigger_tick", 0)), "items": battle_royale_state.get("zero_round_order", []), "enabled": true},
	]

func _world_boss_rows() -> Array[Dictionary]:
	return [
		{"id": "world_boss_hp", "label_key": "screen.mode.boss.hp", "value": "%.0f/%.0f" % [float(world_boss_state.get("current_hp", 0.0)), float(world_boss_state.get("max_hp", 0.0))], "enabled": true},
		{"id": "world_boss_attempts", "label_key": "screen.mode.boss.attempts", "value": int(world_boss_state.get("daily_attempts_left", 0)), "enabled": int(world_boss_state.get("daily_attempts_left", 0)) > 0},
		{"id": "world_boss_party", "label_key": "screen.mode.boss.party", "value": "%d positions" % (world_boss_state.get("positions", []) as Array).size(), "items": world_boss_state.get("positions", []), "enabled": true},
		{"id": "world_boss_transfer", "label_key": "screen.mode.boss.transfer", "value": "%d" % (world_boss_state.get("transfer_requests", []) as Array).size(), "items": world_boss_state.get("transfer_requests", []), "mode_id": MODE_WORLD_BOSS, "party_ids": world_boss_state.get("party_ids", []), "transferred_card_ids": world_boss_state.get("transferred_card_ids", []), "enabled": true},
		{"id": "world_boss_announcement", "label_key": "screen.mode.boss.announcement", "value": str(world_boss_state.get("world_announcement", "")), "enabled": not str(world_boss_state.get("defeated_at", "")).is_empty()},
	]

func _instance_boss_rows() -> Array[Dictionary]:
	return [
		{"id": "instance_boss_phase", "label_key": "screen.mode.instance.phase", "value": str(instance_boss_state.get("boss_phase", "phase_1")), "enabled": true},
		{"id": "instance_boss_conditions", "label_key": "screen.mode.instance.conditions", "value": "clear %s" % bool(instance_boss_state.get("cleared", false)), "items": instance_boss_state.get("clear_conditions", []), "enabled": true},
		{"id": "instance_boss_stars", "label_key": "screen.mode.instance.stars", "value": int(instance_boss_state.get("stars", 0)), "enabled": bool(instance_boss_state.get("cleared", false))},
		{"id": "instance_boss_party", "label_key": "screen.mode.boss.party", "value": str(instance_boss_state.get("party_status", "waiting")), "items": instance_boss_state.get("positions", []), "enabled": true},
		{"id": "instance_boss_transfer", "label_key": "screen.mode.boss.transfer", "value": "%d" % (instance_boss_state.get("transfer_requests", []) as Array).size(), "items": instance_boss_state.get("transfer_requests", []), "mode_id": MODE_INSTANCE_BOSS, "party_ids": instance_boss_state.get("party_ids", []), "transferred_card_ids": instance_boss_state.get("transferred_card_ids", []), "enabled": true},
	]

func _default_boss_state(is_world: bool) -> Dictionary:
	return {
		"boss_instance_id": "world_boss_0" if is_world else "instance_boss_0",
		"max_hp": 100000.0 if is_world else 25000.0,
		"current_hp": 100000.0 if is_world else 25000.0,
		"season_id": "s0",
		"daily_attempts_left": 3,
		"friendly_fire": "disabled",
		"party_ids": [],
		"party_status": "waiting",
		"positions": [],
		"transfer_requests": [],
		"transferred_card_ids": [],
		"defeated_at": "",
		"world_announcement": "",
		"boss_phase": "phase_1",
		"clear_conditions": ["boss_hp_zero", "survivor_required", "no_failed_mechanic"],
		"cleared": false,
		"stars": 0,
	}

func _state_for_mode(mode_id: String) -> Dictionary:
	match mode_id:
		MODE_CERTIFICATION:
			return certification_state.duplicate(true)
		MODE_BATTLE_ROYALE:
			return battle_royale_state.duplicate(true)
		MODE_WORLD_BOSS:
			return world_boss_state.duplicate(true)
		MODE_INSTANCE_BOSS:
			return instance_boss_state.duplicate(true)
		_:
			return {}

func _set_state_for_mode(mode_id: String, state: Dictionary) -> void:
	match mode_id:
		MODE_CERTIFICATION:
			certification_state = state
		MODE_BATTLE_ROYALE:
			battle_royale_state = state
		MODE_WORLD_BOSS:
			world_boss_state = state
		MODE_INSTANCE_BOSS:
			instance_boss_state = state

func _record_mode_action(mode_id: String, action_type: String, payload: Dictionary) -> Dictionary:
	var request := {
		"mode_id": mode_id,
		"action_type": action_type,
		"payload": payload.duplicate(true),
		"client_result_authoritative": false,
	}
	mode_action_requests.append(request)
	if mode_action_requests.size() > 32:
		mode_action_requests.pop_front()
	return request

func _action_result(ok: bool, request: Dictionary) -> Dictionary:
	return {
		"ok": ok,
		"request": request,
		"last_action_status": last_action_status,
		"last_error_code": last_error_code,
	}

func _boss_positions(player_ids: Array[String]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var count := player_ids.size()
	if count <= 0:
		return rows
	for i in range(count):
		var angle := -PI * 0.5 + (TAU * float(i) / float(count))
		rows.append({
			"player_id": player_ids[i],
			"angle": angle,
			"spawn": Vector2(cos(angle), sin(angle)),
			"aim": Vector2(-cos(angle), -sin(angle)),
		})
	return rows

func _calculate_instance_stars(result: Dictionary, cleared: bool) -> int:
	if not cleared:
		return 0
	var stars := 1
	if int(result.get("clear_time_seconds", 9999)) <= int(result.get("three_star_time_seconds", 180)):
		stars += 1
	if int(result.get("deaths", 99)) == 0 and int(result.get("bombs_used", 99)) <= int(result.get("bomb_limit", 3)):
		stars += 1
	return clampi(stars, 1, 3)

func _string_array(source: Variant) -> Array[String]:
	var values: Array[String] = []
	if typeof(source) != TYPE_ARRAY:
		return values
	for item in source as Array:
		values.append(str(item))
	return values
