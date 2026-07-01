class_name GameModeModel
extends RefCounted

const BulletMathLib := preload("res://scripts/bullet_math.gd")
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
const BOSS_CENTER := Vector2.ZERO
const BOSS_DISPLAY_CENTER := Vector2(0.5, 0.5)
const BOSS_DISPLAY_RADIUS := 0.42
const BOSS_ENTRY_RATING_ORDER := ["D", "C", "B", "A", "S"]
const BOSS_FRIENDLY_FIRE_POLICIES := ["disabled", "player_bullets_only", "all_friendly_fire"]
const BOSS_ARENA_POLICIES := ["fixed_directions", "shared_ring", "personal_lanes"]
const BOSS_CARDINAL_LABELS: Array[String] = ["north", "east", "south", "west"]
const BOSS_EIGHT_DIRECTION_LABELS: Array[String] = ["north", "north_east", "east", "south_east", "south", "south_west", "west", "north_west"]
const BOSS_LOCAL_PREVIEW_SPELLBOOK_ID := "original_boss_archive"
const BOSS_LOCAL_PREVIEW_SEED := 20260625
const BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE := "local_practice_preview_only"

var matchmaking_model: RefCounted = null
var network_match_model: RefCounted = null
var boss_spellbook_model: RefCounted = null
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

func configure(matchmaking: RefCounted, network_match: RefCounted, spellbook_model: RefCounted = null) -> void:
	matchmaking_model = matchmaking
	network_match_model = network_match
	if spellbook_model != null:
		boss_spellbook_model = spellbook_model

func configure_boss_spellbook(spellbook_model: RefCounted) -> void:
	boss_spellbook_model = spellbook_model

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
	if not _has_explicit_server_authority(snapshot):
		last_action_status = "failed"
		last_error_code = "server_authoritative_world_boss_required"
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
	world_boss_state["server_authoritative"] = true
	_apply_boss_rule_config(world_boss_state, snapshot)
	last_action_status = "world_boss_snapshot"
	last_error_code = "none"
	return {"ok": true, "reason": "none", "current_hp": int(world_boss_state.get("current_hp", 0)), "attempts_left": int(world_boss_state.get("daily_attempts_left", 0))}

func apply_server_instance_boss_access(snapshot: Dictionary) -> Dictionary:
	if snapshot.is_empty():
		last_action_status = "failed"
		last_error_code = "instance_boss_access_missing"
		return {"ok": false, "reason": last_error_code}
	if bool(snapshot.get("client_result_authoritative", false)):
		last_action_status = "failed"
		last_error_code = "client_authoritative_instance_boss_access"
		return {"ok": false, "reason": last_error_code}
	if not _has_explicit_server_authority(snapshot):
		last_action_status = "failed"
		last_error_code = "server_authoritative_instance_boss_access_required"
		return {"ok": false, "reason": last_error_code}
	instance_boss_state["entry_period"] = str(snapshot.get("entry_period", instance_boss_state.get("entry_period", "weekly")))
	instance_boss_state["entry_attempt_limit"] = int(snapshot.get("entry_attempt_limit", instance_boss_state.get("entry_attempt_limit", 5)))
	instance_boss_state["entry_attempts_used"] = int(snapshot.get("entry_attempts_used", instance_boss_state.get("entry_attempts_used", 0)))
	instance_boss_state["entry_attempts_left"] = max(0, int(snapshot.get("entry_attempts_left", instance_boss_state.get("entry_attempts_left", 0))))
	instance_boss_state["required_rating"] = str(snapshot.get("required_rating", instance_boss_state.get("required_rating", "C")))
	instance_boss_state["player_rating"] = str(snapshot.get("player_rating", certification_state.get("rating_code", "D")))
	instance_boss_state["required_key_id"] = str(snapshot.get("required_key_id", instance_boss_state.get("required_key_id", "instance_key_local_s0")))
	instance_boss_state["owned_key_count"] = max(0, int(snapshot.get("owned_key_count", instance_boss_state.get("owned_key_count", 0))))
	instance_boss_state["entry_unlocked"] = bool(snapshot.get("entry_unlocked", _rating_meets_requirement(str(instance_boss_state.get("player_rating", "D")), str(instance_boss_state.get("required_rating", "C")))))
	instance_boss_state["server_authoritative"] = true
	_apply_boss_rule_config(instance_boss_state, snapshot)
	var entry_check := validate_boss_entry(MODE_INSTANCE_BOSS)
	last_action_status = "instance_boss_access"
	last_error_code = "none" if bool(entry_check.get("ok", false)) else String((entry_check.get("failures", ["entry_locked"]) as Array)[0])
	return {"ok": bool(entry_check.get("ok", false)), "reason": last_error_code, "attempts_left": int(instance_boss_state.get("entry_attempts_left", 0)), "entry_unlocked": bool(instance_boss_state.get("entry_unlocked", false))}

func validate_boss_entry(mode_id: String) -> Dictionary:
	var failures: Array[String] = []
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {"ok": false, "failures": ["boss_mode_invalid"], "mode_id": mode_id}
	var state := _state_for_mode(mode_id)
	if mode_id == MODE_WORLD_BOSS:
		if int(state.get("daily_attempts_left", 0)) <= 0:
			failures.append("attempts_exhausted")
	else:
		if int(state.get("entry_attempts_left", 0)) <= 0:
			failures.append("attempts_exhausted")
		if not bool(state.get("entry_unlocked", false)):
			failures.append("entry_locked")
		if not _rating_meets_requirement(String(state.get("player_rating", "D")), String(state.get("required_rating", "C"))):
			failures.append("rating_required")
		if String(state.get("required_key_id", "")).strip_edges() != "" and int(state.get("owned_key_count", 0)) <= 0:
			failures.append("key_required")
	var formation := validate_boss_formation(mode_id)
	if not bool(formation.get("ok", false)):
		failures.append("party_required")
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"mode_id": mode_id,
		"entry_period": String(state.get("entry_period", "daily" if mode_id == MODE_WORLD_BOSS else "weekly")),
		"attempts_left": int(state.get("daily_attempts_left", 0)) if mode_id == MODE_WORLD_BOSS else int(state.get("entry_attempts_left", 0)),
		"required_rating": String(state.get("required_rating", "")),
		"player_rating": String(state.get("player_rating", certification_state.get("rating_code", "D"))),
		"required_key_id": String(state.get("required_key_id", "")),
		"owned_key_count": int(state.get("owned_key_count", 0)),
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_entry_preview(mode_id: String) -> Dictionary:
	var validation := validate_boss_entry(mode_id)
	var failures := _string_array(validation.get("failures", []))
	var reason := "none" if failures.is_empty() else failures[0]
	var entry_ok := bool(validation.get("ok", false))
	return {
		"ok": entry_ok,
		"reason": reason,
		"failures": failures,
		"mode_id": mode_id,
		"mode_category": "boss",
		"entry_period": String(validation.get("entry_period", "")),
		"attempts_left": int(validation.get("attempts_left", 0)),
		"required_rating": String(validation.get("required_rating", "")),
		"player_rating": String(validation.get("player_rating", "")),
		"required_key_id": String(validation.get("required_key_id", "")),
		"owned_key_count": int(validation.get("owned_key_count", 0)),
		"entry_contract_kind": "boss_entry_verification_contract",
		"entry_contract_version": 1,
		"local_validation": "boss_entry_preflight",
		"local_validation_rules": ["attempts_available", "party_size", "rating_requirement", "key_requirement"],
		"entry_intent_allowed_fields": _boss_entry_intent_allowed_fields(mode_id),
		"client_forbidden_entry_fields": _boss_client_forbidden_entry_fields(mode_id),
		"entry_confirmation_contract": _boss_entry_confirmation_contract(mode_id, entry_ok, reason),
		"server_required_for": _boss_server_required_fields(mode_id),
		"intent_authority": "client_request_only",
		"server_confirmation_status": "required" if entry_ok else "blocked_local",
		"requires_server_confirmation": true,
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(validation.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_action_availability_projection(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"availability_contract_kind": "boss_action_availability_projection",
			"action_status": "blocked_local",
			"local_blockers": ["boss_mode_invalid"],
			"display_ready": false,
			"entry_valid": false,
			"can_request_entry": false,
			"can_request_transfer": false,
			"server_confirmation_status": "blocked_local",
			"projection_scope": "local_display_only",
			"intent_authority": "client_request_only",
			"entry_request_scope": "intent_only",
			"transfer_request_scope": "intent_only",
			"server_required_for": _boss_server_required_fields(mode_id),
			"ui_action_contract": _boss_ui_action_contract(false, false),
			"ui_action_cards": _boss_ui_action_cards(mode_id, false, false, ["boss_mode_invalid"], "blocked_local"),
			"entry_action_panel": _boss_entry_action_panel_from_projection(mode_id, {
				"mode_id": mode_id,
				"mode_category": "boss",
				"action_status": "blocked_local",
				"local_blockers": ["boss_mode_invalid"],
				"display_ready": false,
				"entry_valid": false,
				"formation_valid": false,
				"can_request_entry": false,
				"can_request_transfer": false,
				"server_confirmation_status": "blocked_local",
				"projection_scope": "local_display_only",
				"intent_authority": "client_request_only",
				"entry_request_scope": "intent_only",
				"transfer_request_scope": "intent_only",
				"server_required_for": _boss_server_required_fields(mode_id),
				"ui_action_contract": _boss_ui_action_contract(false, false),
				"ui_action_cards": _boss_ui_action_cards(mode_id, false, false, ["boss_mode_invalid"], "blocked_local"),
				"damage_authority": "server",
				"reward_authority": "server",
				"settlement_authority": "server",
				"requires_server_confirmation": true,
				"server_authoritative": false,
				"client_result_authoritative": false,
			}),
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"requires_server_confirmation": true,
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var entry := boss_entry_preview(mode_id)
	var formation := validate_boss_formation(mode_id)
	var playfield := boss_playfield_projection(mode_id)
	var hud := boss_hud_projection(mode_id)
	var entry_failures := _string_array(entry.get("failures", []))
	var formation_failures := _string_array(formation.get("failures", []))
	var display_blockers: Array[String] = []
	if not bool(playfield.get("ok", false)):
		display_blockers.append(String(playfield.get("reason", "playfield_projection_failed")))
	if not bool(hud.get("ok", false)):
		display_blockers.append(String(hud.get("reason", "hud_projection_failed")))
	for failure in formation_failures:
		if not display_blockers.has(failure):
			display_blockers.append(failure)
	var display_ready := display_blockers.is_empty() and bool(playfield.get("formation_valid", false))
	var local_blockers: Array[String] = []
	for failure in entry_failures:
		if not local_blockers.has(failure):
			local_blockers.append(failure)
	for failure in display_blockers:
		if not local_blockers.has(failure):
			local_blockers.append(failure)
	var party_ids := _string_array(state.get("party_ids", []))
	var can_request_entry := bool(entry.get("ok", false))
	var can_request_transfer := bool(formation.get("ok", false)) and party_ids.size() >= 2
	var action_status := "ready_for_server_entry" if can_request_entry else "blocked_local"
	if can_request_entry and not display_ready:
		action_status = "entry_ready_display_blocked"
	return {
		"ok": can_request_entry and display_ready,
		"reason": "none" if local_blockers.is_empty() else local_blockers[0],
		"mode_id": mode_id,
		"mode_category": "boss",
		"action_status": action_status,
		"local_blockers": local_blockers,
		"display_blockers": display_blockers,
		"entry_failures": entry_failures,
		"formation_failures": formation_failures,
		"display_ready": display_ready,
			"entry_valid": can_request_entry,
			"formation_valid": bool(formation.get("ok", false)),
			"can_request_entry": can_request_entry,
			"can_request_transfer": can_request_transfer,
			"can_display_playfield": display_ready,
			"availability_contract_kind": "boss_action_availability_projection",
			"entry_request_scope": "intent_only",
			"transfer_request_scope": "intent_only",
			"server_required_for": _boss_server_required_fields(mode_id),
			"ui_action_contract": _boss_ui_action_contract(can_request_entry, can_request_transfer),
			"ui_action_cards": _boss_ui_action_cards(mode_id, can_request_entry, can_request_transfer, local_blockers, String(entry.get("server_confirmation_status", "required" if can_request_entry else "blocked_local"))),
			"entry_action_panel": _boss_entry_action_panel_from_projection(mode_id, {
				"mode_id": mode_id,
				"mode_category": "boss",
				"action_status": action_status,
				"local_blockers": local_blockers,
				"display_blockers": display_blockers,
				"entry_failures": entry_failures,
				"formation_failures": formation_failures,
				"display_ready": display_ready,
				"entry_valid": can_request_entry,
				"formation_valid": bool(formation.get("ok", false)),
				"can_request_entry": can_request_entry,
				"can_request_transfer": can_request_transfer,
				"can_display_playfield": display_ready,
				"entry_preflight": entry,
				"server_confirmation_status": String(entry.get("server_confirmation_status", "required" if can_request_entry else "blocked_local")),
				"projection_scope": "local_display_only",
				"intent_authority": "client_request_only",
				"entry_request_scope": "intent_only",
				"transfer_request_scope": "intent_only",
				"server_required_for": _boss_server_required_fields(mode_id),
				"ui_action_contract": _boss_ui_action_contract(can_request_entry, can_request_transfer),
				"ui_action_cards": _boss_ui_action_cards(mode_id, can_request_entry, can_request_transfer, local_blockers, String(entry.get("server_confirmation_status", "required" if can_request_entry else "blocked_local"))),
				"player_count": int(formation.get("player_count", 0)),
				"slot_layout_policy": String(formation.get("slot_layout_policy", "")),
				"slot_labels": formation.get("slot_labels", []),
				"attempts_left": int(entry.get("attempts_left", 0)),
				"required_rating": String(entry.get("required_rating", "")),
				"player_rating": String(entry.get("player_rating", "")),
				"required_key_id": String(entry.get("required_key_id", "")),
				"owned_key_count": int(entry.get("owned_key_count", 0)),
				"damage_authority": "server",
				"reward_authority": "server",
				"settlement_authority": "server",
				"requires_server_confirmation": true,
				"server_authoritative": bool(state.get("server_authoritative", false)),
				"client_result_authoritative": false,
			}),
			"player_count": int(formation.get("player_count", 0)),
			"slot_layout_policy": String(formation.get("slot_layout_policy", "")),
			"slot_labels": formation.get("slot_labels", []),
		"attempts_left": int(entry.get("attempts_left", 0)),
		"required_rating": String(entry.get("required_rating", "")),
		"player_rating": String(entry.get("player_rating", "")),
		"required_key_id": String(entry.get("required_key_id", "")),
		"owned_key_count": int(entry.get("owned_key_count", 0)),
		"entry_preflight": entry,
		"playfield_projection": playfield,
		"hud_projection": hud,
		"server_confirmation_status": String(entry.get("server_confirmation_status", "required" if can_request_entry else "blocked_local")),
		"projection_scope": "local_display_only",
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_entry_action_panel_projection(mode_id: String) -> Dictionary:
	return _boss_entry_action_panel_from_projection(mode_id, boss_action_availability_projection(mode_id))

func boss_authority_summary(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"summary_kind": "boss_authority_summary",
			"projection_scope": "local_display_only",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var entry := boss_entry_preview(mode_id)
	var display := boss_display_contract_row("%s_display" % mode_id, mode_id)
	var practice_preview := boss_practice_preview_projection(mode_id)
	var receipt := boss_settlement_receipt_projection(mode_id)
	var server_fields: Array[String] = [
		"entry_confirmation",
		"roster_lock",
		"damage",
		"reward_grants",
		"settlement",
		"result_receipt",
	]
	if mode_id == MODE_WORLD_BOSS:
		server_fields.append_array(["persistent_hp", "daily_attempts", "defeated_at", "world_announcement"])
	else:
		server_fields.append_array(["access_gate", "clear_status", "stars", "failed_mechanic"])
	var client_scopes: Array[String] = [
		"local_display_projection",
		"formation_preview",
		"hud_projection",
		"practice_spellbook_preview",
		"entry_intent_request",
		"card_transfer_intent_request",
	]
	var receipt_status := String(receipt.get("receipt_status", "pending_server_receipt"))
	var result_status := String(state.get("last_result_status", "pending"))
	var source_status := "server_settlement" if String(state.get("last_result_source", "")) == "server_settlement_projection" else ("server_snapshot" if bool(state.get("server_authoritative", false)) else "local_default")
	var summary_text := "%s %s entry %s display %s receipt %s" % [
		source_status,
		"persistent_hp" if mode_id == MODE_WORLD_BOSS else "instance_clear",
		String(entry.get("server_confirmation_status", "")),
		String(display.get("display_status", "")),
		receipt_status,
	]
	return {
		"ok": true,
		"reason": "none",
		"mode_id": mode_id,
		"mode_category": "boss",
		"summary_kind": "boss_authority_summary",
		"authority_summary_text": summary_text,
		"projection_scope": "local_display_only",
		"client_allowed_scopes": client_scopes,
		"server_authoritative_fields": server_fields,
		"entry_confirmation_status": String(entry.get("server_confirmation_status", "")),
		"display_scope": String(display.get("display_scope", "local_display_only")),
		"display_ready": bool(display.get("display_ready", false)),
		"practice_preview_scope": String(practice_preview.get("preview_authority_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)),
		"receipt_status": receipt_status,
		"result_status": result_status,
		"result_source": String(state.get("last_result_source", "")),
		"rules_source": String(state.get("rules_source", "local_default")),
		"persistent_hp": mode_id == MODE_WORLD_BOSS,
		"requires_server_confirmation": true,
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"entry_preflight": entry,
		"display_contract": display,
		"practice_preview": practice_preview,
		"settlement_receipt_projection": receipt,
	}

func request_boss_entry(mode_id: String) -> Dictionary:
	var entry := boss_entry_preview(mode_id)
	if not bool(entry.get("ok", false)):
		last_action_status = "failed"
		var failures: Array = entry.get("failures", [])
		last_error_code = "entry_locked" if failures.is_empty() else String(failures[0])
		return _action_result(false, {})
	var request := _record_mode_action(mode_id, "enter_boss_instance" if mode_id == MODE_INSTANCE_BOSS else "enter_world_boss", _boss_entry_request_payload(mode_id, entry))
	last_action_status = "boss_entry_request"
	last_error_code = "none"
	return _action_result(true, request)

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
	var id_failures := _boss_party_id_failures(ids)
	if not id_failures.is_empty():
		last_action_status = "failed"
		last_error_code = id_failures[0]
		return false
	var valid_count := ids.size() >= BOSS_MIN_PLAYERS and ids.size() <= BOSS_MAX_PLAYERS
	var state := _state_for_mode(mode_id)
	state["party_ids"] = ids
	state["party_status"] = "ready" if valid_count else "waiting"
	state["positions"] = _boss_positions(ids)
	state["player_count"] = ids.size()
	state["boss_center"] = BOSS_CENTER
	state["aim_policy"] = "toward_center"
	_set_state_for_mode(mode_id, state)
	last_action_status = "boss_party"
	last_error_code = "none" if valid_count else "boss_party_size"
	return valid_count

func boss_formation_summary(mode_id: String) -> String:
	var validation := validate_boss_formation(mode_id)
	if not bool(validation.get("ok", false)):
		return "%s invalid %s" % [mode_id, ",".join(_string_array(validation.get("failures", [])))]
	return "%s %d slots %s %s" % [
		mode_id,
		int(validation.get("player_count", 0)),
		String(validation.get("slot_layout_policy", "free_ring")),
		String(validation.get("aim_policy", "toward_center")),
	]

func boss_party_status_summary(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"party_status_kind": "boss_party_status_summary",
			"projection_scope": "local_display_only",
			"requires_server_confirmation": true,
			"server_required_for": _boss_server_required_fields(mode_id),
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var formation := validate_boss_formation(mode_id)
	var formation_failures := _string_array(formation.get("failures", []))
	var party_ids := _string_array(state.get("party_ids", []))
	var player_count := int(formation.get("player_count", party_ids.size()))
	var entry := boss_entry_preview(mode_id)
	var transfer_available := bool(formation.get("ok", false)) and party_ids.size() >= 2
	var fixed_direction_ready := bool(formation.get("ok", false)) and (player_count == 4 or player_count == 8)
	var roster_authority := boss_roster_authority_contract(mode_id)
	return {
		"ok": bool(formation.get("ok", false)),
		"reason": "none" if bool(formation.get("ok", false)) else ",".join(formation_failures),
		"mode_id": mode_id,
		"mode_category": "boss",
		"party_status_kind": "boss_party_status_summary",
		"party_status": String(state.get("party_status", "waiting")),
		"party_ids": party_ids,
		"player_count": player_count,
		"min_players": BOSS_MIN_PLAYERS,
		"max_players": BOSS_MAX_PLAYERS,
		"slot_layout_policy": String(formation.get("slot_layout_policy", _boss_slot_layout_policy(player_count))),
		"slot_labels": formation.get("slot_labels", _boss_slot_labels(player_count)),
		"formation_valid": bool(formation.get("ok", false)),
		"formation_failures": formation_failures,
		"fixed_direction_ready": fixed_direction_ready,
		"center_aim_valid": bool(formation.get("ok", false)) and String(formation.get("aim_policy", "")) == "toward_center",
		"all_slots_face_center": bool(formation.get("ok", false)),
		"entry_valid": bool(entry.get("ok", false)),
		"entry_failures": entry.get("failures", []),
		"transfer_available": transfer_available,
		"can_request_transfer": transfer_available,
		"server_confirmation_status": String(entry.get("server_confirmation_status", "required" if bool(entry.get("ok", false)) else "blocked_local")),
		"roster_authority_contract": roster_authority,
		"roster_contract_kind": String(roster_authority.get("contract_kind", "")),
		"roster_projection_scope": String(roster_authority.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(roster_authority.get("roster_lock_authority", "server")),
		"roster_lock_status": String(roster_authority.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"display_status": "ready" if bool(formation.get("ok", false)) else "blocked",
		"display_scope": "local_display_only",
		"projection_scope": "local_display_only",
		"intent_authority": "client_request_only",
		"server_required_for": _boss_server_required_fields(mode_id),
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_roster_authority_contract(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"contract_kind": "boss_roster_authority_contract",
			"roster_projection_scope": "local_display_only",
			"roster_lock_authority": "server",
			"local_roster_authoritative": false,
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var formation := validate_boss_formation(mode_id)
	var party_ids := _string_array(state.get("party_ids", []))
	var server_confirmed := bool(state.get("server_authoritative", false))
	var roster_locked := bool(state.get("boss_roster_locked", state.get("roster_locked", false)))
	var lock_status := "server_locked" if server_confirmed and roster_locked else ("server_snapshot_unlocked" if server_confirmed else "local_preview")
	return {
		"ok": true,
		"reason": "none",
		"mode_id": mode_id,
		"mode_category": "boss",
		"contract_kind": "boss_roster_authority_contract",
		"contract_version": 1,
		"roster_projection_scope": "local_display_only",
		"roster_confirmation_status": "server_confirmed" if server_confirmed else "pending_server_confirmation",
		"roster_lock_authority": "server",
		"roster_lock_status": lock_status,
		"server_locked": server_confirmed and roster_locked,
		"local_roster_preview": true,
		"local_roster_authoritative": false,
		"party_ids": party_ids,
		"player_count": int(formation.get("player_count", party_ids.size())),
		"slot_layout_policy": String(formation.get("slot_layout_policy", _boss_slot_layout_policy(party_ids.size()))),
		"slot_labels": formation.get("slot_labels", _boss_slot_labels(party_ids.size())),
		"server_required_for": _boss_server_required_fields(mode_id),
		"client_forbidden_roster_fields": ["damage", "reward_grants", "settlement", "boss_hp", "result_receipt"],
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": server_confirmed,
		"client_result_authoritative": false,
	}

func boss_formation_display_summary(mode_id: String, playfield: Rect2 = Rect2(Vector2.ZERO, Vector2.ONE)) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"display_summary_kind": "boss_formation_display_summary",
			"projection_scope": "local_display_only",
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var validation := validate_boss_formation(mode_id)
	var roster_authority := boss_roster_authority_contract(mode_id)
	var slots := boss_display_slots(mode_id, playfield)
	var slot_summaries: Array[String] = []
	var slot_points: Array[Dictionary] = []
	for raw_slot in slots:
		var slot: Dictionary = raw_slot
		var label := String(slot.get("slot_label", ""))
		var normalized_position: Vector2 = slot.get("normalized_display_position", Vector2.ZERO)
		var aim_vector: Vector2 = slot.get("aim_vector", Vector2.ZERO)
		var angle_degrees := float(slot.get("aim_angle_degrees", 0.0))
		slot_summaries.append("%02d:%s:%.3f,%.3f:aim%.1f" % [
			int(slot.get("slot_index", -1)),
			label,
			normalized_position.x,
			normalized_position.y,
			angle_degrees,
		])
		slot_points.append({
			"slot_index": int(slot.get("slot_index", -1)),
			"slot_label": label,
			"player_id": String(slot.get("player_id", "")),
			"normalized_display_position": normalized_position,
			"aim_angle_degrees": angle_degrees,
			"aim_to_center": bool(slot.get("aim_to_center", false)),
			"aim_vector": aim_vector,
			"roster_authority_contract": roster_authority,
			"roster_projection_scope": String(roster_authority.get("roster_projection_scope", "local_display_only")),
			"roster_lock_authority": String(roster_authority.get("roster_lock_authority", "server")),
			"local_roster_authoritative": false,
			"client_result_authoritative": false,
		})
	var signature_source := "%s|%s|%s|%s|%s" % [
		mode_id,
		String(validation.get("slot_layout_policy", "")),
		String(validation.get("aim_policy", "toward_center")),
		",".join(_string_array(validation.get("slot_labels", []))),
		"|".join(slot_summaries),
	]
	var display_signature := BulletMathLib.fvn1a32(signature_source)
	return {
		"ok": bool(validation.get("ok", false)),
		"reason": "none" if bool(validation.get("ok", false)) else ",".join(_string_array(validation.get("failures", []))),
		"mode_id": mode_id,
		"mode_category": "boss",
		"display_summary_kind": "boss_formation_display_summary",
		"player_count": int(validation.get("player_count", 0)),
		"slot_count": slots.size(),
		"slot_layout_policy": String(validation.get("slot_layout_policy", "")),
		"slot_labels": validation.get("slot_labels", []),
		"slot_summaries": slot_summaries,
		"slot_points": slot_points,
		"formation_display_signature": display_signature,
		"formation_display_signature_source": signature_source,
		"fixed_direction_display": slots.size() == 4 or slots.size() == 8,
		"center_aim_valid": bool(validation.get("ok", false)) and String(validation.get("aim_policy", "")) == "toward_center",
		"all_slots_face_center": bool(validation.get("ok", false)),
		"center_normalized": BOSS_DISPLAY_CENTER,
		"display_radius_ratio": BOSS_DISPLAY_RADIUS,
		"friendly_fire": String(state.get("friendly_fire", "disabled")),
		"arena_policy": String(state.get("arena_policy", "fixed_directions")),
		"roster_authority_contract": roster_authority,
		"roster_projection_scope": String(roster_authority.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(roster_authority.get("roster_lock_authority", "server")),
		"roster_lock_status": String(roster_authority.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"projection_scope": "local_display_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_formation_contract(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"projection_scope": "local_display_only",
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"requires_server_confirmation": true,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var positions: Array = state.get("positions", [])
	var count := positions.size()
	return {
		"ok": true,
		"reason": "none",
		"mode_id": mode_id,
		"mode_category": "boss",
		"slot_count": count,
		"min_players": BOSS_MIN_PLAYERS,
		"max_players": BOSS_MAX_PLAYERS,
		"fixed_direction_counts": [4, 8],
		"slot_layout_policy": _boss_slot_layout_policy(count),
		"slot_labels": _boss_slot_labels(count),
		"spawn_space": "unit_ring",
		"center_normalized": BOSS_DISPLAY_CENTER,
		"display_radius_ratio": BOSS_DISPLAY_RADIUS,
		"boss_center": state.get("boss_center", BOSS_CENTER),
		"aim_policy": String(state.get("aim_policy", "toward_center")),
		"shooting_target": "boss_center",
		"all_slots_face_center": true,
		"friendly_fire": String(state.get("friendly_fire", "disabled")),
		"arena_policy": String(state.get("arena_policy", "fixed_directions")),
		"projection_scope": "local_display_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_display_slots(mode_id: String, playfield: Rect2 = Rect2(Vector2.ZERO, Vector2.ONE)) -> Array[Dictionary]:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return []
	var state := _state_for_mode(mode_id)
	var contract := boss_formation_contract(mode_id)
	var roster_authority := boss_roster_authority_contract(mode_id)
	var positions: Array = state.get("positions", [])
	var slots: Array[Dictionary] = []
	for raw_position in positions:
		var position: Dictionary = raw_position
		var spawn: Vector2 = position.get("spawn", Vector2.ZERO)
		var aim: Vector2 = position.get("aim", Vector2.ZERO)
		var normalized_position := BOSS_DISPLAY_CENTER + spawn * BOSS_DISPLAY_RADIUS
		var screen_position := playfield.position + Vector2(
			normalized_position.x * playfield.size.x,
			normalized_position.y * playfield.size.y
		)
		slots.append({
			"player_id": String(position.get("player_id", "")),
			"mode_id": mode_id,
			"slot_index": int(position.get("slot_index", -1)),
			"slot_count": int(position.get("slot_count", positions.size())),
			"slot_label": String(position.get("slot_label", _boss_slot_label(int(position.get("slot_index", -1)), positions.size()))),
			"slot_layout_policy": _boss_slot_layout_policy(positions.size()),
			"formation_contract": contract,
			"normalized_spawn": spawn,
			"normalized_display_position": normalized_position,
			"screen_position": screen_position,
			"aim_vector": aim,
			"aim_angle_degrees": rad_to_deg(aim.angle()),
			"aim_target": position.get("aim_target", BOSS_CENTER),
			"aim_to_center": bool(position.get("aim_to_center", false)),
			"friendly_fire": String(state.get("friendly_fire", "disabled")),
			"arena_policy": String(state.get("arena_policy", "fixed_directions")),
			"friendly_fire_warning": String(state.get("friendly_fire_warning", "none")),
			"boss_center": state.get("boss_center", BOSS_CENTER),
			"roster_authority_contract": roster_authority,
			"roster_projection_scope": String(roster_authority.get("roster_projection_scope", "local_display_only")),
			"roster_lock_authority": String(roster_authority.get("roster_lock_authority", "server")),
			"local_roster_authoritative": false,
			"server_authoritative": bool(state.get("server_authoritative", false)),
			"client_result_authoritative": false,
		})
	return slots

func boss_playfield_projection(mode_id: String, playfield: Rect2 = Rect2(Vector2.ZERO, Vector2.ONE)) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var formation := validate_boss_formation(mode_id)
	var entry := validate_boss_entry(mode_id)
	var contract := boss_formation_contract(mode_id)
	var roster_authority := boss_roster_authority_contract(mode_id)
	var formation_display_summary := boss_formation_display_summary(mode_id, playfield)
	var rule_safety := boss_rule_safety_projection(mode_id)
	var current_hp := float(state.get("current_hp", 0.0))
	var max_hp := float(state.get("max_hp", 0.0))
	var screen_center := playfield.position + Vector2(
		BOSS_DISPLAY_CENTER.x * playfield.size.x,
		BOSS_DISPLAY_CENTER.y * playfield.size.y
	)
	var radius_pixels := minf(playfield.size.x, playfield.size.y) * BOSS_DISPLAY_RADIUS
	var screen_bounds := Rect2(screen_center - Vector2(radius_pixels, radius_pixels), Vector2(radius_pixels * 2.0, radius_pixels * 2.0))
	return {
		"ok": true,
		"reason": "none",
		"mode_id": mode_id,
		"mode_category": "boss",
		"display_kind": "boss_playfield_projection",
		"projection_scope": "local_display_only",
		"boss_instance_id": String(state.get("boss_instance_id", "")),
		"persistent_hp": mode_id == MODE_WORLD_BOSS,
		"current_hp": current_hp,
		"max_hp": max_hp,
		"hp_ratio": 0.0 if max_hp <= 0.0 else clampf(current_hp / max_hp, 0.0, 1.0),
		"center_normalized": BOSS_DISPLAY_CENTER,
		"display_radius_ratio": BOSS_DISPLAY_RADIUS,
		"screen_center": screen_center,
		"screen_radius_pixels": radius_pixels,
		"screen_bounds": screen_bounds,
		"display_slots": boss_display_slots(mode_id, playfield),
		"formation_contract": contract,
		"roster_authority_contract": roster_authority,
		"roster_projection_scope": String(roster_authority.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(roster_authority.get("roster_lock_authority", "server")),
		"roster_lock_status": String(roster_authority.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"formation_display_summary": formation_display_summary,
		"formation_display_signature": int(formation_display_summary.get("formation_display_signature", 0)),
		"player_count": int(formation.get("player_count", 0)),
		"slot_layout_policy": String(formation.get("slot_layout_policy", "")),
		"slot_labels": formation.get("slot_labels", []),
		"formation_valid": bool(formation.get("ok", false)),
		"formation_failures": formation.get("failures", []),
		"entry_valid": bool(entry.get("ok", false)),
		"entry_failures": entry.get("failures", []),
		"aim_policy": String(state.get("aim_policy", "toward_center")),
		"rule_safety_projection": rule_safety,
		"safety_kind": String(rule_safety.get("safety_kind", "boss_rule_safety_projection")),
		"safety_badges": rule_safety.get("safety_badges", []),
		"friendly_fire": String(rule_safety.get("friendly_fire", state.get("friendly_fire", "disabled"))),
		"arena_policy": String(rule_safety.get("arena_policy", state.get("arena_policy", "fixed_directions"))),
		"friendly_fire_warning": String(rule_safety.get("friendly_fire_warning", state.get("friendly_fire_warning", "none"))),
		"friendly_fire_risk_level": String(rule_safety.get("friendly_fire_risk_level", "none")),
		"rules_display_only": true,
		"requires_server_confirmation": true,
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_hud_projection(mode_id: String, playfield: Rect2 = Rect2(Vector2.ZERO, Vector2.ONE)) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"display_kind": "boss_hud_projection",
			"projection_scope": "local_display_only",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var playfield_projection := boss_playfield_projection(mode_id, playfield)
	var entry := validate_boss_entry(mode_id)
	var formation := validate_boss_formation(mode_id)
	var contract := boss_formation_contract(mode_id)
	var roster_authority := boss_roster_authority_contract(mode_id)
	var rule_safety: Dictionary = playfield_projection.get("rule_safety_projection", boss_rule_safety_projection(mode_id))
	var formation_display_summary: Dictionary = playfield_projection.get("formation_display_summary", boss_formation_display_summary(mode_id, playfield))
	var current_hp := float(playfield_projection.get("current_hp", state.get("current_hp", 0.0)))
	var max_hp := float(playfield_projection.get("max_hp", state.get("max_hp", 0.0)))
	var entry_failures := _string_array(entry.get("failures", []))
	var formation_failures := _string_array(formation.get("failures", []))
	var status_parts: Array[String] = [
		"hp %.0f/%.0f" % [current_hp, max_hp],
		"party %d/%d-%d" % [int(formation.get("player_count", 0)), BOSS_MIN_PLAYERS, BOSS_MAX_PLAYERS],
		"entry %s" % ("ready" if bool(entry.get("ok", false)) else ",".join(entry_failures)),
		"rules %s/%s" % [String(rule_safety.get("friendly_fire", state.get("friendly_fire", "disabled"))), String(rule_safety.get("arena_policy", state.get("arena_policy", "fixed_directions")))],
	]
	return {
		"ok": true,
		"reason": "none",
		"mode_id": mode_id,
		"mode_category": "boss",
		"display_kind": "boss_hud_projection",
		"projection_scope": "local_display_only",
		"persistent_hp": mode_id == MODE_WORLD_BOSS,
		"boss_instance_id": String(state.get("boss_instance_id", "")),
		"hp_text": "%.0f/%.0f" % [current_hp, max_hp],
		"current_hp": current_hp,
		"max_hp": max_hp,
		"hp_ratio": float(playfield_projection.get("hp_ratio", 0.0)),
		"attempts_left": int(entry.get("attempts_left", 0)),
		"entry_valid": bool(entry.get("ok", false)),
		"entry_failures": entry_failures,
		"formation_valid": bool(formation.get("ok", false)),
		"formation_failures": formation_failures,
		"player_count": int(formation.get("player_count", 0)),
		"min_players": BOSS_MIN_PLAYERS,
		"max_players": BOSS_MAX_PLAYERS,
		"slot_layout_policy": String(formation.get("slot_layout_policy", "")),
		"slot_labels": formation.get("slot_labels", []),
		"formation_contract": contract,
		"roster_authority_contract": roster_authority,
		"roster_projection_scope": String(roster_authority.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(roster_authority.get("roster_lock_authority", "server")),
		"roster_lock_status": String(roster_authority.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"formation_display_summary": formation_display_summary,
		"formation_display_signature": int(formation_display_summary.get("formation_display_signature", 0)),
		"rule_safety_projection": rule_safety,
		"safety_kind": String(rule_safety.get("safety_kind", "boss_rule_safety_projection")),
		"safety_badges": rule_safety.get("safety_badges", []),
		"friendly_fire": String(rule_safety.get("friendly_fire", state.get("friendly_fire", "disabled"))),
		"arena_policy": String(rule_safety.get("arena_policy", state.get("arena_policy", "fixed_directions"))),
		"friendly_fire_warning": String(rule_safety.get("friendly_fire_warning", state.get("friendly_fire_warning", "none"))),
		"friendly_fire_risk_level": String(rule_safety.get("friendly_fire_risk_level", "none")),
		"rules_display_only": true,
		"rules_source": String(state.get("rules_source", "local_default")),
		"result_status": String(state.get("last_result_status", "pending")),
		"result_source": String(state.get("last_result_source", "")),
		"world_announcement": String(state.get("world_announcement", "")),
		"display_slots": playfield_projection.get("display_slots", []),
		"playfield_projection": playfield_projection,
		"hud_status_text": " | ".join(status_parts),
		"requires_server_confirmation": true,
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_rule_safety_projection(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"safety_kind": "boss_rule_safety_projection",
			"projection_scope": "local_display_only",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var friendly_fire := _sanitized_boss_friendly_fire(String(state.get("friendly_fire", "disabled")))
	var arena_policy := _sanitized_boss_arena_policy(String(state.get("arena_policy", state.get("movement_area_policy", "fixed_directions"))))
	var warning := _boss_friendly_fire_warning(friendly_fire)
	var risk_level := _boss_friendly_fire_risk_level(friendly_fire)
	var badges: Array[String] = [
		"rules_display_only",
		"damage_server",
		"settlement_server",
		"friendly_fire_%s" % friendly_fire,
		"arena_%s" % arena_policy,
	]
	return {
		"ok": true,
		"reason": "none",
		"mode_id": mode_id,
		"mode_category": "boss",
		"safety_kind": "boss_rule_safety_projection",
		"friendly_fire": friendly_fire,
		"friendly_fire_warning": warning,
		"friendly_fire_risk_level": risk_level,
		"friendly_fire_enabled": friendly_fire != "disabled",
		"arena_policy": arena_policy,
		"movement_area_policy": arena_policy,
		"movement_constraint_summary": _boss_arena_policy_summary(arena_policy),
		"rules_source": String(state.get("rules_source", "local_default")),
		"safety_badges": badges,
		"safety_text": "friendly_fire %s risk %s arena %s source %s" % [
			friendly_fire,
			risk_level,
			arena_policy,
			String(state.get("rules_source", "local_default")),
		],
		"projection_scope": "local_display_only",
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"boss_hp_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_local_status_row(row_id: String, mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"id": row_id,
			"label_key": "screen.mode.boss.entry",
			"value": "invalid boss mode",
			"mode_id": mode_id,
			"mode_category": "boss",
			"enabled": false,
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var entry := validate_boss_entry(mode_id)
	var formation := validate_boss_formation(mode_id)
	var current_hp := float(state.get("current_hp", 0.0))
	var max_hp := float(state.get("max_hp", 0.0))
	var attempts_left := int(entry.get("attempts_left", 0))
	var entry_failures := _string_array(entry.get("failures", []))
	var entry_status := "ready" if bool(entry.get("ok", false)) else ",".join(entry_failures)
	var player_count := int(formation.get("player_count", 0))
	var result_status := String(state.get("last_result_status", "pending"))
	var slot_layout_policy := String(formation.get("slot_layout_policy", _boss_slot_layout_policy(player_count)))
	var contract := boss_formation_contract(mode_id)
	var roster_authority := boss_roster_authority_contract(mode_id)
	var action_projection := boss_action_availability_projection(mode_id)
	var display_projection := boss_playfield_projection(mode_id)
	var practice_preview := boss_practice_preview_projection(mode_id)
	var receipt_projection := boss_settlement_receipt_projection(mode_id)
	var entry_preflight: Dictionary = action_projection.get("entry_preflight", {}) if typeof(action_projection.get("entry_preflight", {})) == TYPE_DICTIONARY else {}
	return {
		"id": row_id,
		"label_key": "screen.mode.world_boss" if mode_id == MODE_WORLD_BOSS else "screen.mode.instance_boss",
		"value": "hp %.0f/%.0f attempts %d party %d/%d-%d layout %s entry %s action %s" % [
			current_hp,
			max_hp,
			attempts_left,
			player_count,
			BOSS_MIN_PLAYERS,
			BOSS_MAX_PLAYERS,
			slot_layout_policy,
			entry_status,
			String(action_projection.get("action_status", "")),
		],
		"summary": "hp %.0f/%.0f attempts %d; server settlement %s; client can only request entry or transfer; display %s practice %s receipt %s" % [
			current_hp,
			max_hp,
			attempts_left,
			result_status,
			String(display_projection.get("display_kind", "boss_playfield_projection")),
			String(practice_preview.get("preview_authority_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)),
			String(receipt_projection.get("receipt_status", "pending_server_receipt")),
		],
		"mode_id": mode_id,
		"mode_category": "boss",
		"status_contract_kind": "boss_local_status_projection",
		"status_contract_version": 1,
		"projection_scope": "local_display_only",
		"persistent_hp": mode_id == MODE_WORLD_BOSS,
		"hp_ratio": 0.0 if max_hp <= 0.0 else clampf(current_hp / max_hp, 0.0, 1.0),
		"friendly_fire": String(state.get("friendly_fire", "disabled")),
		"arena_policy": String(state.get("arena_policy", "fixed_directions")),
		"friendly_fire_warning": String(state.get("friendly_fire_warning", "none")),
		"attempts_left": attempts_left,
		"entry_valid": bool(entry.get("ok", false)),
		"entry_failures": entry_failures,
		"formation_valid": bool(formation.get("ok", false)),
		"formation_failures": _string_array(formation.get("failures", [])),
		"player_count": player_count,
		"slot_layout_policy": slot_layout_policy,
		"slot_labels": formation.get("slot_labels", _boss_slot_labels(player_count)),
		"formation_contract": contract,
		"roster_authority_contract": roster_authority,
		"roster_projection_scope": String(roster_authority.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(roster_authority.get("roster_lock_authority", "server")),
		"roster_lock_status": String(roster_authority.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"action_availability": action_projection,
		"action_status": String(action_projection.get("action_status", "")),
		"can_request_entry": bool(action_projection.get("can_request_entry", false)),
		"can_request_transfer": bool(action_projection.get("can_request_transfer", false)),
		"availability_contract_kind": String(action_projection.get("availability_contract_kind", "")),
		"entry_request_scope": String(action_projection.get("entry_request_scope", "intent_only")),
		"transfer_request_scope": String(action_projection.get("transfer_request_scope", "intent_only")),
		"entry_contract_kind": String(entry_preflight.get("entry_contract_kind", "")),
		"entry_contract_version": int(entry_preflight.get("entry_contract_version", 0)),
		"entry_intent_allowed_fields": _boss_entry_intent_allowed_fields(mode_id),
		"client_forbidden_entry_fields": _boss_client_forbidden_entry_fields(mode_id),
		"entry_confirmation_contract": entry_preflight.get("entry_confirmation_contract", {}),
		"ui_action_contract": action_projection.get("ui_action_contract", {}),
		"ui_action_cards": action_projection.get("ui_action_cards", []),
		"server_required_for": _boss_server_required_fields(mode_id),
		"entry_action_panel": action_projection.get("entry_action_panel", {}),
		"playfield_projection": display_projection,
		"display_scope": String(display_projection.get("projection_scope", "local_display_only")),
		"display_ready": bool(display_projection.get("formation_valid", false)),
		"display_kind": String(display_projection.get("display_kind", "")),
		"formation_display_signature": int(display_projection.get("formation_display_signature", 0)),
		"practice_preview": practice_preview,
		"practice_preview_scope": String(practice_preview.get("preview_authority_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)),
		"practice_preview_bundle_signature_digest": int(practice_preview.get("preview_bundle_signature_digest", 0)),
		"settlement_receipt_projection": receipt_projection,
		"receipt_status": String(receipt_projection.get("receipt_status", "pending_server_receipt")),
		"result_source": String(receipt_projection.get("result_source", "")),
		"min_players": BOSS_MIN_PLAYERS,
		"max_players": BOSS_MAX_PLAYERS,
		"requires_server_confirmation": true,
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": true,
	}

func boss_display_contract_row(row_id: String, mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"id": row_id,
			"label_key": "screen.mode.boss.playfield",
			"value": "invalid boss mode",
			"mode_id": mode_id,
			"mode_category": "boss",
			"display_ready": false,
			"display_blockers": ["boss_mode_invalid"],
			"projection_scope": "local_display_only",
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"server_authoritative": false,
			"client_result_authoritative": false,
			"enabled": false,
		}
	var state := _state_for_mode(mode_id)
	var playfield_projection := boss_playfield_projection(mode_id)
	var hud_projection := boss_hud_projection(mode_id)
	var entry_preview := boss_entry_preview(mode_id)
	var action_projection := boss_action_availability_projection(mode_id)
	var entry_action_panel: Dictionary = action_projection.get("entry_action_panel", _boss_entry_action_panel_from_projection(mode_id, action_projection))
	var formation_display_summary: Dictionary = playfield_projection.get("formation_display_summary", boss_formation_display_summary(mode_id))
	var formation_failures := _string_array(playfield_projection.get("formation_failures", []))
	var entry_failures := _string_array(entry_preview.get("failures", []))
	var display_blockers: Array[String] = []
	if not bool(playfield_projection.get("ok", false)):
		display_blockers.append(String(playfield_projection.get("reason", "playfield_projection_failed")))
	if not bool(hud_projection.get("ok", false)):
		display_blockers.append(String(hud_projection.get("reason", "hud_projection_failed")))
	for failure in formation_failures:
		if not display_blockers.has(failure):
			display_blockers.append(failure)
	var display_ready := display_blockers.is_empty() and bool(playfield_projection.get("formation_valid", false))
	var entry_status := "entry_ready" if bool(entry_preview.get("ok", false)) else "entry_blocked:%s" % ",".join(entry_failures)
	var hp_ratio := float(playfield_projection.get("hp_ratio", 0.0))
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.playfield",
		"value": "display %s slots %d hp %.0f%% %s" % [
			"ready" if display_ready else "blocked",
			int(playfield_projection.get("player_count", 0)),
			hp_ratio * 100.0,
			entry_status,
		],
		"summary": "local Boss playfield and HUD display contract only; entry intent, damage, rewards, and settlement require server confirmation",
		"mode_id": mode_id,
		"mode_category": "boss",
		"display_ready": display_ready,
		"display_status": "ready" if display_ready else "blocked",
		"display_blockers": display_blockers,
		"display_scope": "local_display_only",
		"projection_scope": "local_display_only",
		"persistent_hp": mode_id == MODE_WORLD_BOSS,
		"playfield_projection": playfield_projection,
		"hud_projection": hud_projection,
		"display_slots": playfield_projection.get("display_slots", []),
		"formation_contract": playfield_projection.get("formation_contract", {}),
		"roster_authority_contract": playfield_projection.get("roster_authority_contract", {}),
		"roster_projection_scope": String(playfield_projection.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(playfield_projection.get("roster_lock_authority", "server")),
		"roster_lock_status": String(playfield_projection.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"formation_display_summary": formation_display_summary,
		"formation_display_signature": int(formation_display_summary.get("formation_display_signature", 0)),
		"action_availability": action_projection,
			"entry_action_panel": entry_action_panel,
			"action_status": String(action_projection.get("action_status", "")),
			"local_blockers": action_projection.get("local_blockers", []),
			"can_request_entry": bool(action_projection.get("can_request_entry", false)),
			"can_request_transfer": bool(action_projection.get("can_request_transfer", false)),
			"can_display_playfield": bool(action_projection.get("can_display_playfield", false)),
			"availability_contract_kind": String(action_projection.get("availability_contract_kind", "")),
			"entry_request_scope": String(action_projection.get("entry_request_scope", "intent_only")),
			"transfer_request_scope": String(action_projection.get("transfer_request_scope", "intent_only")),
			"server_required_for": action_projection.get("server_required_for", []),
			"entry_contract_kind": String(entry_preview.get("entry_contract_kind", "")),
			"entry_contract_version": int(entry_preview.get("entry_contract_version", 0)),
			"entry_intent_allowed_fields": entry_preview.get("entry_intent_allowed_fields", []),
			"client_forbidden_entry_fields": entry_preview.get("client_forbidden_entry_fields", []),
			"entry_confirmation_contract": entry_preview.get("entry_confirmation_contract", {}),
			"ui_action_contract": action_projection.get("ui_action_contract", {}),
			"ui_action_cards": action_projection.get("ui_action_cards", []),
			"formation_valid": bool(playfield_projection.get("formation_valid", false)),
			"formation_failures": formation_failures,
			"entry_valid": bool(entry_preview.get("ok", false)),
			"entry_failures": entry_failures,
		"entry_preflight": entry_preview,
		"entry_server_confirmation_status": String(entry_preview.get("server_confirmation_status", "")),
		"player_count": int(playfield_projection.get("player_count", 0)),
		"slot_layout_policy": String(playfield_projection.get("slot_layout_policy", "")),
		"slot_labels": playfield_projection.get("slot_labels", []),
		"hp_ratio": hp_ratio,
		"friendly_fire": String(state.get("friendly_fire", "disabled")),
		"arena_policy": String(state.get("arena_policy", "fixed_directions")),
		"friendly_fire_warning": String(state.get("friendly_fire_warning", "none")),
		"requires_server_confirmation": true,
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": display_ready,
	}

func boss_display_health_projection(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"health_kind": "boss_display_health_projection",
			"projection_scope": "local_display_only",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var entry := boss_entry_preview(mode_id)
	var formation := validate_boss_formation(mode_id)
	var action := boss_action_availability_projection(mode_id)
	var display := boss_display_contract_row("%s_display_health_source" % mode_id, mode_id)
	var playfield := boss_playfield_projection(mode_id)
	var hud := boss_hud_projection(mode_id)
	var practice := boss_practice_preview_projection(mode_id)
	var receipt := boss_settlement_receipt_projection(mode_id)
	var blockers: Array[String] = []
	if not bool(entry.get("ok", false)):
		for failure in _string_array(entry.get("failures", [])):
			if not blockers.has(failure):
				blockers.append(failure)
	if not bool(formation.get("ok", false)):
		for failure in _string_array(formation.get("failures", [])):
			if not blockers.has(failure):
				blockers.append(failure)
	if not bool(display.get("display_ready", false)):
		for failure in _string_array(display.get("display_blockers", [])):
			if not blockers.has(failure):
				blockers.append(failure)
	if not bool(playfield.get("ok", false)) and not blockers.has(String(playfield.get("reason", "playfield_projection_failed"))):
		blockers.append(String(playfield.get("reason", "playfield_projection_failed")))
	if not bool(hud.get("ok", false)) and not blockers.has(String(hud.get("reason", "hud_projection_failed"))):
		blockers.append(String(hud.get("reason", "hud_projection_failed")))
	if not bool(practice.get("ok", false)) and not blockers.has(String(practice.get("reason", "practice_preview_failed"))):
		blockers.append(String(practice.get("reason", "practice_preview_failed")))
	var display_ready := blockers.is_empty()
	var health_status := "ready_for_local_display" if display_ready else "blocked_local:%s" % blockers[0]
	var check_rows: Array[Dictionary] = [
		{"id": "entry", "ok": bool(entry.get("ok", false)), "status": String(entry.get("server_confirmation_status", "")), "reason": String(entry.get("reason", "none"))},
		{"id": "formation", "ok": bool(formation.get("ok", false)), "status": String(formation.get("slot_layout_policy", "")), "reason": "none" if bool(formation.get("ok", false)) else ",".join(_string_array(formation.get("failures", [])))},
		{"id": "display", "ok": bool(display.get("display_ready", false)), "status": String(display.get("display_status", "")), "reason": "none" if bool(display.get("display_ready", false)) else ",".join(_string_array(display.get("display_blockers", [])))},
		{"id": "playfield", "ok": bool(playfield.get("ok", false)), "status": String(playfield.get("display_kind", "")), "reason": String(playfield.get("reason", "none"))},
		{"id": "hud", "ok": bool(hud.get("ok", false)), "status": String(hud.get("display_kind", "")), "reason": String(hud.get("reason", "none"))},
		{"id": "practice_preview", "ok": bool(practice.get("ok", false)), "status": String(practice.get("preview_authority_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)), "reason": String(practice.get("reason", "none"))},
		{"id": "receipt", "ok": String(receipt.get("receipt_status", "")) == "server_receipt_ready" or String(receipt.get("receipt_status", "")) == "pending_server_receipt", "status": String(receipt.get("receipt_status", "")), "reason": String(receipt.get("reason", "none"))},
	]
	return {
		"ok": display_ready,
		"reason": "none" if blockers.is_empty() else blockers[0],
		"mode_id": mode_id,
		"mode_category": "boss",
		"health_kind": "boss_display_health_projection",
		"health_status": health_status,
		"health_checks": check_rows,
		"local_blockers": blockers,
		"display_ready": bool(display.get("display_ready", false)),
		"entry_valid": bool(entry.get("ok", false)),
		"formation_valid": bool(formation.get("ok", false)),
		"playfield_ready": bool(playfield.get("ok", false)),
		"hud_ready": bool(hud.get("ok", false)),
		"practice_preview_ready": bool(practice.get("ok", false)),
		"receipt_status": String(receipt.get("receipt_status", "pending_server_receipt")),
		"action_status": String(action.get("action_status", "")),
		"can_request_entry": bool(action.get("can_request_entry", false)),
		"can_request_transfer": bool(action.get("can_request_transfer", false)),
		"player_count": int(formation.get("player_count", 0)),
		"slot_layout_policy": String(formation.get("slot_layout_policy", "")),
		"slot_labels": formation.get("slot_labels", []),
		"formation_display_signature": int(playfield.get("formation_display_signature", 0)),
		"hp_ratio": float(playfield.get("hp_ratio", 0.0)),
		"persistent_hp": mode_id == MODE_WORLD_BOSS,
		"rules_source": String(state.get("rules_source", "local_default")),
		"result_status": String(state.get("last_result_status", "pending")),
		"server_required_for": _boss_server_required_fields(mode_id),
		"projection_scope": "local_display_only",
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"boss_hp_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func _boss_display_health_row(row_id: String, mode_id: String) -> Dictionary:
	var projection := boss_display_health_projection(mode_id)
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.playfield",
		"value": "%s checks %d party %d hp %.0f%%" % [
			String(projection.get("health_status", "")),
			(projection.get("health_checks", []) as Array).size(),
			int(projection.get("player_count", 0)),
			float(projection.get("hp_ratio", 0.0)) * 100.0,
		],
		"summary": "local Boss display health only; entry confirmation, Boss HP, damage, rewards, and settlement remain server-authoritative",
		"mode_id": mode_id,
		"mode_category": "boss",
		"ui_control": "status",
		"health_kind": String(projection.get("health_kind", "boss_display_health_projection")),
		"health_projection": projection,
		"health_status": String(projection.get("health_status", "")),
		"health_checks": projection.get("health_checks", []),
		"local_blockers": projection.get("local_blockers", []),
		"display_ready": bool(projection.get("display_ready", false)),
		"entry_valid": bool(projection.get("entry_valid", false)),
		"formation_valid": bool(projection.get("formation_valid", false)),
		"playfield_ready": bool(projection.get("playfield_ready", false)),
		"hud_ready": bool(projection.get("hud_ready", false)),
		"practice_preview_ready": bool(projection.get("practice_preview_ready", false)),
		"receipt_status": String(projection.get("receipt_status", "pending_server_receipt")),
		"action_status": String(projection.get("action_status", "")),
		"can_request_entry": bool(projection.get("can_request_entry", false)),
		"can_request_transfer": bool(projection.get("can_request_transfer", false)),
		"player_count": int(projection.get("player_count", 0)),
		"slot_layout_policy": String(projection.get("slot_layout_policy", "")),
		"slot_labels": projection.get("slot_labels", []),
		"formation_display_signature": int(projection.get("formation_display_signature", 0)),
		"hp_ratio": float(projection.get("hp_ratio", 0.0)),
		"persistent_hp": bool(projection.get("persistent_hp", false)),
		"server_required_for": projection.get("server_required_for", _boss_server_required_fields(mode_id)),
		"projection_scope": "local_display_only",
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"boss_hp_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(projection.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": true,
	}

func boss_practice_preview_projection(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"projection_scope": "local_practice_preview_only",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	if boss_spellbook_model == null or not boss_spellbook_model.has_method("phase_export_data"):
		return {
			"ok": false,
			"reason": "boss_spellbook_unavailable",
			"mode_id": mode_id,
			"mode_category": "boss",
			"projection_scope": BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE,
			"preview_authority_scope": BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE,
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var export_data: Dictionary = boss_spellbook_model.phase_export_data(BOSS_LOCAL_PREVIEW_SPELLBOOK_ID, BOSS_LOCAL_PREVIEW_SEED)
	if export_data.is_empty():
		return {
			"ok": false,
			"reason": "boss_spellbook_preview_missing",
			"mode_id": mode_id,
			"mode_category": "boss",
			"spellbook_id": BOSS_LOCAL_PREVIEW_SPELLBOOK_ID,
			"preview_seed": BOSS_LOCAL_PREVIEW_SEED,
			"projection_scope": BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE,
			"preview_authority_scope": BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE,
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var phase_ids := _string_array(export_data.get("preview_phase_ids", []))
	var phase_digests := _int_array(export_data.get("preview_phase_signature_digests", []))
	return {
		"ok": String(export_data.get("preview_authority_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)) == BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE,
		"reason": "none" if String(export_data.get("preview_authority_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)) == BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE else "preview_authority_scope_mismatch",
		"mode_id": mode_id,
		"mode_category": "boss",
		"spellbook_id": String(export_data.get("spellbook_id", BOSS_LOCAL_PREVIEW_SPELLBOOK_ID)),
		"preview_seed": int(export_data.get("seed", BOSS_LOCAL_PREVIEW_SEED)),
		"preview_bundle_id": String(export_data.get("preview_bundle_id", "")),
		"preview_bundle_signature_digest": int(export_data.get("preview_bundle_signature_digest", 0)),
		"preview_phase_count": int(export_data.get("preview_phase_count", phase_ids.size())),
		"preview_phase_ids": phase_ids,
		"preview_phase_signature_digests": phase_digests,
		"preview_max_emit_per_tick": int(export_data.get("max_preview_emit_per_tick", 0)),
		"preview_min_budget_headroom": int(export_data.get("min_preview_budget_headroom", 0)),
		"performance_budget_status": String(export_data.get("performance_budget_status", "")),
		"preview_authority_scope": String(export_data.get("preview_authority_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)),
		"projection_scope": BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE,
		"replay_verification_scope": "local_practice_hash",
		"practice_mode": "boss_spellbook_practice",
		"server_confirmation_status": "not_applicable_local_preview",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": false,
		"server_authoritative": false,
		"client_result_authoritative": false,
	}

func boss_practice_replay_metadata(mode_id: String, phase_id: String = "nonspell_radial_entry") -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"metadata_contract_kind": "boss_practice_replay_metadata",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	if boss_spellbook_model == null \
			or not boss_spellbook_model.has_method("deterministic_phase_preview") \
			or not boss_spellbook_model.has_method("phase_export_data"):
		return {
			"ok": false,
			"reason": "boss_spellbook_unavailable",
			"mode_id": mode_id,
			"mode_category": "boss",
			"metadata_contract_kind": "boss_practice_replay_metadata",
			"preview_authority_scope": BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE,
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var export_data: Dictionary = boss_spellbook_model.phase_export_data(BOSS_LOCAL_PREVIEW_SPELLBOOK_ID, BOSS_LOCAL_PREVIEW_SEED)
	var phase_ids := _string_array(export_data.get("preview_phase_ids", []))
	var selected_phase_id := phase_id
	if selected_phase_id.is_empty() and not phase_ids.is_empty():
		selected_phase_id = phase_ids[0]
	var preview: Dictionary = boss_spellbook_model.deterministic_phase_preview(BOSS_LOCAL_PREVIEW_SPELLBOOK_ID, selected_phase_id, BOSS_LOCAL_PREVIEW_SEED)
	if preview.is_empty() or export_data.is_empty():
		return {
			"ok": false,
			"reason": "boss_spellbook_preview_missing",
			"mode_id": mode_id,
			"mode_category": "boss",
			"metadata_contract_kind": "boss_practice_replay_metadata",
			"spellbook_id": BOSS_LOCAL_PREVIEW_SPELLBOOK_ID,
			"phase_id": selected_phase_id,
			"preview_seed": BOSS_LOCAL_PREVIEW_SEED,
			"preview_authority_scope": BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE,
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var preview_scope := String(preview.get("preview_authority_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE))
	return {
		"ok": preview_scope == BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE,
		"reason": "none" if preview_scope == BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE else "preview_authority_scope_mismatch",
		"metadata_contract_kind": "boss_practice_replay_metadata",
		"mode_id": mode_id,
		"mode_category": "boss",
		"mode": "boss_spellbook_practice",
		"result": "practice",
		"opponent": selected_phase_id,
		"catalog_id": "boss_spellbook",
		"spellbook_id": BOSS_LOCAL_PREVIEW_SPELLBOOK_ID,
		"phase_id": selected_phase_id,
		"match_seed": BOSS_LOCAL_PREVIEW_SEED,
		"preview_seed": BOSS_LOCAL_PREVIEW_SEED,
		"input_integrity_status": "preview_input_not_recorded",
		"input_count": 0,
		"input_first_tick": -1,
		"input_last_tick": -1,
		"input_tick_span": 0,
		"input_tick_monotonic": false,
		"input_tick_contiguous": false,
		"final_tick": int(preview.get("sample_window_end_tick", 0)),
		"final_result_hash": int(preview.get("signature_digest", 0)),
		"preview_export_schema_version": int(preview.get("export_schema_version", 1)),
		"preview_export_id": String(preview.get("export_id", "")),
		"preview_fixture_id": String(preview.get("preview_fixture_id", "")),
		"preview_authority_scope": preview_scope,
		"preview_signature": String(preview.get("signature", "")),
		"preview_signature_digest": int(preview.get("signature_digest", 0)),
		"preview_sample_ticks": preview.get("sample_ticks", []),
		"preview_sample_window_start_tick": int(preview.get("sample_window_start_tick", 0)),
		"preview_sample_window_end_tick": int(preview.get("sample_window_end_tick", 0)),
		"preview_sample_window_stride_ticks": int(preview.get("sample_window_stride_ticks", 0)),
		"preview_sample_signature_digests": preview.get("sample_signature_digests", []),
		"preview_sample_emit_counts": preview.get("sample_emit_counts", []),
		"preview_sample_count": int(preview.get("sample_count", (preview.get("samples", []) as Array).size())),
		"preview_max_emit_per_tick": int(preview.get("max_emit_per_tick", 0)),
		"preview_bullet_cap_per_tick": int(preview.get("bullet_cap_per_tick", 0)),
		"preview_budget_headroom": int(preview.get("budget_headroom", 0)),
		"performance_budget_status": String(preview.get("performance_budget_status", "")),
		"preview_bundle_id": String(export_data.get("preview_bundle_id", "")),
		"preview_bundle_signature_digest": int(export_data.get("preview_bundle_signature_digest", 0)),
		"preview_phase_count": int(export_data.get("preview_phase_count", 0)),
		"preview_phase_ids": phase_ids,
		"preview_phase_signature_digests": _int_array(export_data.get("preview_phase_signature_digests", [])),
		"preview_bundle_max_emit_per_tick": int(export_data.get("max_preview_emit_per_tick", 0)),
		"preview_bundle_min_budget_headroom": int(export_data.get("min_preview_budget_headroom", 0)),
		"preview_bundle_budget_status": String(export_data.get("performance_budget_status", "")),
		"local_hash_authority": "local_practice_verification_only",
		"replay_verification_scope": "local_practice_hash",
		"replay_authority_scope": "local_practice_record",
		"online_replay_authority": "server_audit_required",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"boss_hp_authority": "server",
		"server_authority_claim_fields": [],
		"server_authoritative": false,
		"client_result_authoritative": false,
	}

func validate_boss_formation(mode_id: String) -> Dictionary:
	var failures: Array[String] = []
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {"ok": false, "failures": ["boss_mode_invalid"], "player_count": 0}
	var state := _state_for_mode(mode_id)
	var positions: Array = state.get("positions", [])
	var party_ids := _string_array(state.get("party_ids", []))
	var count := positions.size()
	if count != party_ids.size():
		failures.append("position_party_count_mismatch")
	if count < BOSS_MIN_PLAYERS or count > BOSS_MAX_PLAYERS:
		failures.append("party_size")
	if String(state.get("aim_policy", "")) != "toward_center":
		failures.append("aim_policy")
	var expected_step := TAU / float(max(1, count))
	var seen_ids: Array[String] = []
	var slot_angles: Array[float] = []
	for i in range(count):
		var position: Dictionary = positions[i]
		var player_id := String(position.get("player_id", ""))
		if player_id.is_empty() or seen_ids.has(player_id):
			failures.append("player_id:%d" % i)
		seen_ids.append(player_id)
		if int(position.get("slot_index", -1)) != i or int(position.get("slot_count", -1)) != count:
			failures.append("slot:%d" % i)
		var spawn: Vector2 = position.get("spawn", Vector2.ZERO)
		var aim: Vector2 = position.get("aim", Vector2.ZERO)
		var target: Vector2 = position.get("aim_target", BOSS_CENTER)
		var angle := float(position.get("angle", 0.0))
		slot_angles.append(rad_to_deg(angle))
		if absf(spawn.length() - 1.0) > 0.001:
			failures.append("spawn_radius:%d" % i)
		if target.distance_to(BOSS_CENTER) > 0.001 or not bool(position.get("aim_to_center", false)):
			failures.append("aim_target:%d" % i)
		if aim.length() < 0.999 or aim.length() > 1.001:
			failures.append("aim_unit:%d" % i)
		elif aim.dot((BOSS_CENTER - spawn).normalized()) < 0.999:
			failures.append("aim_center:%d" % i)
		if count > 1:
			var expected_angle := -PI * 0.5 + expected_step * float(i)
			if absf(wrapf(angle - expected_angle, -PI, PI)) > 0.001:
				failures.append("angle_step:%d" % i)
	return {
		"ok": failures.is_empty(),
		"failures": failures,
		"mode_id": mode_id,
		"player_count": count,
		"min_players": BOSS_MIN_PLAYERS,
		"max_players": BOSS_MAX_PLAYERS,
		"party_status": String(state.get("party_status", "waiting")),
		"aim_policy": String(state.get("aim_policy", "toward_center")),
		"friendly_fire": String(state.get("friendly_fire", "disabled")),
		"arena_policy": String(state.get("arena_policy", "fixed_directions")),
		"friendly_fire_warning": String(state.get("friendly_fire_warning", "none")),
		"slot_angles_degrees": slot_angles,
		"slot_layout_policy": _boss_slot_layout_policy(count),
		"slot_labels": _boss_slot_labels(count),
		"formation_contract": boss_formation_contract(mode_id),
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_transfer_preview(mode_id: String, from_player_id: String, to_player_id: String, card_id: String) -> Dictionary:
	var failures: Array[String] = []
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		failures.append("boss_mode_invalid")
	var state := _state_for_mode(mode_id)
	var party_ids := _string_array(state.get("party_ids", []))
	var transferred := _string_array(state.get("transferred_card_ids", []))
	var clean_card_id := card_id.strip_edges()
	var clean_from_player_id := from_player_id.strip_edges()
	var clean_to_player_id := to_player_id.strip_edges()
	if clean_card_id.is_empty():
		failures.append("transfer_card_missing")
	if clean_from_player_id.is_empty() or clean_to_player_id.is_empty():
		failures.append("transfer_player_missing")
	if not clean_from_player_id.is_empty() and clean_from_player_id == clean_to_player_id:
		failures.append("transfer_self")
	if not clean_from_player_id.is_empty() and not clean_to_player_id.is_empty() and (not party_ids.has(clean_from_player_id) or not party_ids.has(clean_to_player_id)):
		failures.append("transfer_player_not_in_party")
	if not clean_card_id.is_empty() and transferred.has(clean_card_id):
		failures.append("transfer_duplicate")
	var reason := "none" if failures.is_empty() else failures[0]
	return {
		"ok": failures.is_empty(),
		"reason": reason,
		"failures": failures,
		"mode_id": mode_id,
		"mode_category": "boss",
		"from_player_id": clean_from_player_id,
		"to_player_id": clean_to_player_id,
		"card_id": clean_card_id,
		"party_ids": party_ids,
		"transferred_card_ids": transferred,
		"transfer_policy": "once_per_card_per_match",
		"local_validation": "boss_transfer_preflight",
		"local_validation_rules": ["party_members_only", "no_self_transfer", "card_id_required", "once_per_card_per_match"],
		"intent_authority": "client_request_only",
		"server_confirmation_status": "required" if failures.is_empty() else "blocked_local",
		"requires_server_confirmation": true,
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func request_boss_card_transfer(mode_id: String, from_player_id: String, to_player_id: String, card_id: String) -> Dictionary:
	var state := _state_for_mode(mode_id)
	var preview := boss_transfer_preview(mode_id, from_player_id, to_player_id, card_id)
	if not bool(preview.get("ok", false)):
		last_action_status = "failed"
		last_error_code = String(preview.get("reason", "transfer_invalid"))
		return _action_result(false, {})
	var transferred := _string_array(state.get("transferred_card_ids", []))
	var clean_card_id := String(preview.get("card_id", ""))
	var clean_from_player_id := String(preview.get("from_player_id", ""))
	var clean_to_player_id := String(preview.get("to_player_id", ""))
	transferred.append(clean_card_id)
	state["transferred_card_ids"] = transferred
	var requests: Array = state.get("transfer_requests", [])
	var transfer := {
		"from_player_id": clean_from_player_id,
		"to_player_id": clean_to_player_id,
		"card_id": clean_card_id,
		"status": "requested",
		"preflight": preview,
	}
	requests.append(transfer)
	state["transfer_requests"] = requests
	_set_state_for_mode(mode_id, state)
	var request := _record_mode_action(mode_id, "transfer_card", transfer)
	last_action_status = "transfer_request"
	last_error_code = "none"
	return _action_result(true, request)

func apply_world_boss_result(result: Dictionary) -> bool:
	if bool(result.get("client_result_authoritative", false)):
		last_action_status = "failed"
		last_error_code = "client_authoritative_world_boss_result"
		world_boss_state["last_result_rejected_reason"] = last_error_code
		world_boss_state["last_result_rejected_client_authoritative"] = true
		return false
	if not _has_explicit_server_authority(result):
		last_action_status = "failed"
		last_error_code = "server_authoritative_world_boss_result_required"
		world_boss_state["last_result_rejected_reason"] = last_error_code
		world_boss_state["last_result_rejected_client_authoritative"] = false
		return false
	world_boss_state["boss_instance_id"] = str(result.get("boss_instance_id", world_boss_state.get("boss_instance_id", "")))
	var hp_after: Variant = result.get("boss_hp_after_global", result.get("current_hp", world_boss_state.get("current_hp", 0.0)))
	world_boss_state["current_hp"] = max(0.0, float(hp_after))
	world_boss_state["max_hp"] = float(result.get("boss_hp_global_max", result.get("boss_max_hp", world_boss_state.get("max_hp", 0.0))))
	world_boss_state["damage_this_match"] = int(result.get("damage_this_match", result.get("team_damage", world_boss_state.get("damage_this_match", 0))))
	world_boss_state["global_damage_applied"] = int(result.get("global_damage_applied", world_boss_state.get("global_damage_applied", 0)))
	world_boss_state["daily_attempts_left"] = max(0, int(result.get("daily_attempts_left", world_boss_state.get("daily_attempts_left", 0))))
	world_boss_state["defeated_by_match_id"] = str(result.get("defeated_by_match_id", world_boss_state.get("defeated_by_match_id", "")))
	world_boss_state["defeated_by_user_id"] = str(result.get("defeated_by_user_id", world_boss_state.get("defeated_by_user_id", "")))
	world_boss_state["last_result_match_id"] = str(result.get("match_id", world_boss_state.get("last_result_match_id", "")))
	world_boss_state["last_result_status"] = str(result.get("settlement_status", "defeated" if float(world_boss_state.get("current_hp", 0.0)) <= 0.0 else "applied"))
	world_boss_state["last_result_source"] = "server_settlement_projection"
	world_boss_state["last_result_rejected_reason"] = ""
	world_boss_state["last_result_rejected_client_authoritative"] = false
	world_boss_state["server_authoritative"] = true
	_apply_boss_settlement_receipt(world_boss_state, result)
	var defeated_at_from_server := str(result.get("defeated_at", "")).strip_edges()
	if not defeated_at_from_server.is_empty():
		world_boss_state["defeated_at"] = defeated_at_from_server
	if bool(result.get("world_announcement_emitted", false)):
		world_boss_state["world_announcement"] = str(result.get("world_announcement", "world_boss_defeated"))
	world_boss_state["defeat_timestamp_pending_server"] = float(world_boss_state.get("current_hp", 0.0)) <= 0.0 and str(world_boss_state.get("defeated_at", "")).strip_edges().is_empty()
	last_action_status = "world_boss_result"
	last_error_code = "none"
	return true

func apply_instance_boss_result(result: Dictionary) -> bool:
	if bool(result.get("client_result_authoritative", false)):
		last_action_status = "failed"
		last_error_code = "client_authoritative_instance_boss_result"
		instance_boss_state["last_result_rejected_reason"] = last_error_code
		instance_boss_state["last_result_rejected_client_authoritative"] = true
		return false
	if not _has_explicit_server_authority(result):
		last_action_status = "failed"
		last_error_code = "server_authoritative_instance_boss_result_required"
		instance_boss_state["last_result_rejected_reason"] = last_error_code
		instance_boss_state["last_result_rejected_client_authoritative"] = false
		return false
	var boss_defeated := bool(result.get("boss_defeated", result.get("instance_cleared", false)))
	var survivors := int(result.get("survivors", 0))
	var failed_mechanic := bool(result.get("failed_mechanic", false))
	var failed_mechanic_ids := _boss_failed_mechanic_ids_from_result(result, failed_mechanic)
	var failed_mechanic_id := String(result.get("failed_mechanic_id", failed_mechanic_ids[0] if not failed_mechanic_ids.is_empty() else ""))
	var failed_mechanic_summary := String(result.get("failed_mechanic_summary", result.get("failed_mechanic_reason", ",".join(failed_mechanic_ids)))).strip_edges()
	var survivor_required := bool(result.get("survivor_required", instance_boss_state.get("survivor_required", true)))
	var cleared := bool(result.get("instance_cleared", boss_defeated and (survivors > 0 or not survivor_required) and not failed_mechanic))
	instance_boss_state["boss_defeated"] = boss_defeated
	instance_boss_state["survivors"] = survivors
	instance_boss_state["failed_mechanic"] = failed_mechanic
	instance_boss_state["failed_mechanic_id"] = failed_mechanic_id
	instance_boss_state["failed_mechanic_ids"] = failed_mechanic_ids
	instance_boss_state["failed_mechanic_summary"] = failed_mechanic_summary
	instance_boss_state["failed_mechanic_source"] = "server_settlement" if failed_mechanic else "none"
	instance_boss_state["cleared"] = cleared
	instance_boss_state["party_status"] = str(result.get("party_status", "cleared" if cleared else "failed"))
	instance_boss_state["current_hp"] = max(0.0, float(result.get("boss_hp_after", instance_boss_state.get("current_hp", 0.0))))
	instance_boss_state["clear_time_seconds"] = int(result.get("clear_time_seconds", 0))
	instance_boss_state["three_star_time_seconds"] = int(result.get("three_star_time_seconds", instance_boss_state.get("three_star_time_seconds", 180)))
	instance_boss_state["deaths"] = int(result.get("deaths", 0))
	instance_boss_state["survivor_required"] = survivor_required
	instance_boss_state["clear_conditions"] = ["boss_hp_zero", "survivor_required" if survivor_required else "survivor_optional", "no_failed_mechanic"]
	instance_boss_state["bombs_used"] = int(result.get("bombs_used", instance_boss_state.get("bombs_used", 0)))
	instance_boss_state["bomb_limit"] = int(result.get("bomb_limit", instance_boss_state.get("bomb_limit", 0)))
	instance_boss_state["last_result_match_id"] = str(result.get("match_id", instance_boss_state.get("last_result_match_id", "")))
	instance_boss_state["last_result_status"] = str(result.get("settlement_status", "cleared" if cleared else "failed"))
	instance_boss_state["last_result_source"] = "server_settlement_projection"
	instance_boss_state["last_result_rejected_reason"] = ""
	instance_boss_state["last_result_rejected_client_authoritative"] = false
	instance_boss_state["stars"] = _calculate_instance_stars(result, cleared)
	instance_boss_state["server_authoritative"] = true
	_apply_boss_settlement_receipt(instance_boss_state, result)
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
		_boss_hp_row("world_boss_hp", world_boss_state, true),
		_boss_rules_row("world_boss_rules", MODE_WORLD_BOSS, world_boss_state),
		_boss_rule_safety_row("world_boss_rule_safety", MODE_WORLD_BOSS),
		_boss_authority_summary_row("world_boss_authority", MODE_WORLD_BOSS),
		{"id": "world_boss_attempts", "label_key": "screen.mode.boss.attempts", "value": int(world_boss_state.get("daily_attempts_left", 0)), "mode_category": "boss", "server_authoritative": bool(world_boss_state.get("server_authoritative", false)), "client_result_authoritative": false, "enabled": int(world_boss_state.get("daily_attempts_left", 0)) > 0},
		_boss_entry_row("world_boss_entry", MODE_WORLD_BOSS, world_boss_state),
		_boss_party_row("world_boss_party", MODE_WORLD_BOSS, world_boss_state),
		_boss_formation_row("world_boss_formation", MODE_WORLD_BOSS, world_boss_state),
		boss_display_contract_row("world_boss_display", MODE_WORLD_BOSS),
		_boss_display_health_row("world_boss_display_health", MODE_WORLD_BOSS),
		_boss_playfield_row("world_boss_playfield", MODE_WORLD_BOSS),
		_boss_hud_row("world_boss_hud", MODE_WORLD_BOSS),
		_boss_practice_preview_row("world_boss_practice_preview", MODE_WORLD_BOSS),
		_boss_transfer_row("world_boss_transfer", MODE_WORLD_BOSS, world_boss_state),
		_world_boss_result_row(),
		{"id": "world_boss_announcement", "label_key": "screen.mode.boss.announcement", "value": str(world_boss_state.get("world_announcement", "")), "mode_category": "boss", "server_authoritative": bool(world_boss_state.get("server_authoritative", false)), "client_result_authoritative": false, "enabled": not str(world_boss_state.get("defeated_at", "")).is_empty()},
	]

func _instance_boss_rows() -> Array[Dictionary]:
	return [
		_boss_hp_row("instance_boss_hp", instance_boss_state, false),
		_boss_rules_row("instance_boss_rules", MODE_INSTANCE_BOSS, instance_boss_state),
		_boss_rule_safety_row("instance_boss_rule_safety", MODE_INSTANCE_BOSS),
		_boss_authority_summary_row("instance_boss_authority", MODE_INSTANCE_BOSS),
		_boss_entry_row("instance_boss_entry", MODE_INSTANCE_BOSS, instance_boss_state),
		{"id": "instance_boss_phase", "label_key": "screen.mode.instance.phase", "value": str(instance_boss_state.get("boss_phase", "phase_1")), "mode_category": "boss", "server_authoritative": bool(instance_boss_state.get("server_authoritative", false)), "client_result_authoritative": false, "enabled": true},
		{"id": "instance_boss_conditions", "label_key": "screen.mode.instance.conditions", "value": "clear %s mechanic %s" % [bool(instance_boss_state.get("cleared", false)), String(instance_boss_state.get("failed_mechanic_id", "")) if bool(instance_boss_state.get("failed_mechanic", false)) else "ok"], "items": instance_boss_state.get("clear_conditions", []), "failed_mechanic": bool(instance_boss_state.get("failed_mechanic", false)), "failed_mechanic_id": String(instance_boss_state.get("failed_mechanic_id", "")), "failed_mechanic_ids": _string_array(instance_boss_state.get("failed_mechanic_ids", [])), "failed_mechanic_summary": String(instance_boss_state.get("failed_mechanic_summary", "")), "failed_mechanic_authority": "server", "mode_category": "boss", "server_authoritative": bool(instance_boss_state.get("server_authoritative", false)), "client_result_authoritative": false, "enabled": true},
		{"id": "instance_boss_stars", "label_key": "screen.mode.instance.stars", "value": int(instance_boss_state.get("stars", 0)), "mode_category": "boss", "server_authoritative": bool(instance_boss_state.get("server_authoritative", false)), "client_result_authoritative": false, "enabled": bool(instance_boss_state.get("cleared", false))},
		_boss_party_row("instance_boss_party", MODE_INSTANCE_BOSS, instance_boss_state),
		_boss_formation_row("instance_boss_formation", MODE_INSTANCE_BOSS, instance_boss_state),
		boss_display_contract_row("instance_boss_display", MODE_INSTANCE_BOSS),
		_boss_display_health_row("instance_boss_display_health", MODE_INSTANCE_BOSS),
		_boss_playfield_row("instance_boss_playfield", MODE_INSTANCE_BOSS),
		_boss_hud_row("instance_boss_hud", MODE_INSTANCE_BOSS),
		_boss_practice_preview_row("instance_boss_practice_preview", MODE_INSTANCE_BOSS),
		_boss_transfer_row("instance_boss_transfer", MODE_INSTANCE_BOSS, instance_boss_state),
		_instance_boss_result_row(),
	]

func _default_boss_state(is_world: bool) -> Dictionary:
	return {
		"boss_instance_id": "world_boss_0" if is_world else "instance_boss_0",
		"max_hp": 100000.0 if is_world else 25000.0,
		"current_hp": 100000.0 if is_world else 25000.0,
		"season_id": "s0",
		"daily_attempts_left": 3,
		"daily_attempt_limit": 3,
		"daily_attempts_used": 0,
		"entry_period": "daily" if is_world else "weekly",
		"entry_attempt_limit": 3 if is_world else 5,
		"entry_attempts_used": 0,
		"entry_attempts_left": 3 if is_world else 1,
		"entry_unlocked": true if is_world else false,
		"required_rating": "" if is_world else "C",
		"player_rating": "D",
		"required_key_id": "" if is_world else "instance_key_local_s0",
		"owned_key_count": 0,
		"friendly_fire": "disabled",
		"arena_policy": "fixed_directions",
		"movement_area_policy": "fixed_directions",
		"friendly_fire_warning": "none",
		"rules_source": "local_default",
		"party_ids": [],
		"party_status": "waiting",
		"positions": [],
		"player_count": 0,
		"min_players": BOSS_MIN_PLAYERS,
		"max_players": BOSS_MAX_PLAYERS,
		"boss_center": BOSS_CENTER,
		"aim_policy": "toward_center",
		"transfer_requests": [],
		"transferred_card_ids": [],
		"damage_this_match": 0,
		"global_damage_applied": 0,
		"defeated_at": "",
		"world_announcement": "",
		"defeat_timestamp_pending_server": false,
		"boss_phase": "phase_1",
		"clear_conditions": ["boss_hp_zero", "survivor_required", "no_failed_mechanic"],
		"cleared": false,
		"stars": 0,
		"survivors": 0,
		"failed_mechanic": false,
		"failed_mechanic_id": "",
		"failed_mechanic_ids": [],
		"failed_mechanic_summary": "",
		"failed_mechanic_source": "none",
		"clear_time_seconds": 0,
		"deaths": 0,
		"bombs_used": 0,
		"bomb_limit": 3,
		"three_star_time_seconds": 180,
		"last_result_match_id": "",
		"last_result_status": "pending",
		"last_result_source": "",
		"last_result_receipt_id": "",
		"last_result_hash": "",
		"last_result_replay_id": "",
		"last_result_server_time": "",
		"last_result_key_id": "",
		"last_result_receipt_source": "",
		"last_result_rejected_reason": "",
		"last_result_rejected_client_authoritative": false,
		"server_authoritative": false,
		"client_result_authoritative": false,
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

func _boss_entry_request_payload(mode_id: String, entry: Dictionary) -> Dictionary:
	var action_projection := boss_action_availability_projection(mode_id)
	return {
		"mode_id": mode_id,
		"mode_category": "boss",
		"entry_period": String(entry.get("entry_period", "")),
		"attempts_left": int(entry.get("attempts_left", 0)),
		"required_rating": String(entry.get("required_rating", "")),
		"player_rating": String(entry.get("player_rating", "")),
		"required_key_id": String(entry.get("required_key_id", "")),
		"owned_key_count": int(entry.get("owned_key_count", 0)),
		"entry_preflight": entry.duplicate(true),
		"action_availability": action_projection,
		"entry_action_panel": _boss_entry_action_panel_from_projection(mode_id, action_projection),
		"entry_contract_kind": String(entry.get("entry_contract_kind", "boss_entry_verification_contract")),
		"entry_contract_version": int(entry.get("entry_contract_version", 1)),
		"local_validation": "boss_entry_preflight",
		"local_validation_rules": ["attempts_available", "party_size", "rating_requirement", "key_requirement"],
		"entry_intent_allowed_fields": entry.get("entry_intent_allowed_fields", _boss_entry_intent_allowed_fields(mode_id)),
		"client_forbidden_entry_fields": entry.get("client_forbidden_entry_fields", _boss_client_forbidden_entry_fields(mode_id)),
		"entry_confirmation_contract": entry.get("entry_confirmation_contract", _boss_entry_confirmation_contract(mode_id, bool(entry.get("ok", false)), String(entry.get("reason", "none")))),
		"request_scope": "intent_only",
		"entry_request_scope": "intent_only",
		"intent_authority": "client_request_only",
		"server_confirmation_status": String(entry.get("server_confirmation_status", "required")),
		"requires_server_confirmation": true,
		"server_required_for": _boss_server_required_fields(mode_id),
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": false,
		"client_result_authoritative": false,
	}

func _action_result(ok: bool, request: Dictionary) -> Dictionary:
	return {
		"ok": ok,
		"request": request,
		"last_action_status": last_action_status,
		"last_error_code": last_error_code,
	}

func _has_explicit_server_authority(payload: Dictionary) -> bool:
	if payload.has("server_authority"):
		return bool(payload.get("server_authority", false))
	if payload.has("server_authoritative"):
		return bool(payload.get("server_authoritative", false))
	return false

func _boss_positions(player_ids: Array[String]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var count := player_ids.size()
	if count <= 0:
		return rows
	for i in range(count):
		var angle := -PI * 0.5 + (TAU * float(i) / float(count))
		var spawn := Vector2(cos(angle), sin(angle))
		var aim := BOSS_CENTER - spawn
		rows.append({
			"player_id": player_ids[i],
			"angle": angle,
			"spawn": spawn,
			"aim": aim.normalized(),
			"aim_target": BOSS_CENTER,
			"aim_to_center": true,
			"slot_index": i,
			"slot_count": count,
			"slot_label": _boss_slot_label(i, count),
			"slot_layout_policy": _boss_slot_layout_policy(count),
		})
	return rows

func _boss_party_id_failures(player_ids: Array[String]) -> Array[String]:
	var failures: Array[String] = []
	var seen: Dictionary = {}
	for i in range(player_ids.size()):
		var player_id := player_ids[i].strip_edges()
		if player_id.is_empty():
			failures.append("player_id_empty")
			continue
		if seen.has(player_id):
			failures.append("player_id_duplicate")
			continue
		seen[player_id] = true
	return failures

func _boss_slot_layout_policy(count: int) -> String:
	match count:
		4:
			return "cardinal_4"
		8:
			return "eight_direction_8"
		_:
			return "even_ring_%d" % count

func _boss_slot_labels(count: int) -> Array[String]:
	var labels: Array[String] = []
	for i in range(max(0, count)):
		labels.append(_boss_slot_label(i, count))
	return labels

func _boss_slot_label(index: int, count: int) -> String:
	if count == 4 and index >= 0 and index < BOSS_CARDINAL_LABELS.size():
		return BOSS_CARDINAL_LABELS[index]
	if count == 8 and index >= 0 and index < BOSS_EIGHT_DIRECTION_LABELS.size():
		return BOSS_EIGHT_DIRECTION_LABELS[index]
	return "slot_%02d" % max(0, index)

func _boss_hp_row(row_id: String, state: Dictionary, persistent_hp: bool) -> Dictionary:
	var current_hp := float(state.get("current_hp", 0.0))
	var max_hp := float(state.get("max_hp", 0.0))
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.hp",
		"value": "%.0f/%.0f" % [current_hp, max_hp],
		"mode_category": "boss",
		"persistent_hp": persistent_hp,
		"hp_ratio": 0.0 if max_hp <= 0.0 else clampf(current_hp / max_hp, 0.0, 1.0),
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": true,
	}

func _boss_authority_summary_row(row_id: String, mode_id: String) -> Dictionary:
	var summary := boss_authority_summary(mode_id)
	var client_scopes := _string_array(summary.get("client_allowed_scopes", []))
	var server_fields := _string_array(summary.get("server_authoritative_fields", []))
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.result" if mode_id == MODE_WORLD_BOSS else "screen.mode.instance.result",
		"value": String(summary.get("authority_summary_text", "")),
		"summary": "client display/intents only; server owns damage, rewards, settlement, and Boss outcome",
		"mode_id": mode_id,
		"mode_category": "boss",
		"ui_control": "card",
		"ui_control_label_key": "ui.control_card",
		"overview_card_kind": "boss_authority_summary",
		"render_slot": "mode_cards",
		"authority_summary_kind": String(summary.get("summary_kind", "boss_authority_summary")),
		"authority_summary": summary,
		"authority_summary_text": String(summary.get("authority_summary_text", "")),
		"client_allowed_scopes": client_scopes,
		"server_authoritative_fields": server_fields,
		"authority_badges": ["client_display_only", "intent_request_only", "damage_server", "reward_server", "settlement_server"],
		"entry_confirmation_status": String(summary.get("entry_confirmation_status", "")),
		"display_scope": String(summary.get("display_scope", "local_display_only")),
		"practice_preview_scope": String(summary.get("practice_preview_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)),
		"receipt_status": String(summary.get("receipt_status", "")),
		"result_status": String(summary.get("result_status", "")),
		"result_source": String(summary.get("result_source", "")),
		"rules_source": String(summary.get("rules_source", "local_default")),
		"persistent_hp": mode_id == MODE_WORLD_BOSS,
		"requires_server_confirmation": true,
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(summary.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": bool(summary.get("ok", false)),
	}

func _boss_rules_row(row_id: String, mode_id: String, state: Dictionary) -> Dictionary:
	var friendly_fire := String(state.get("friendly_fire", "disabled"))
	var arena_policy := String(state.get("arena_policy", state.get("movement_area_policy", "fixed_directions")))
	var warning := String(state.get("friendly_fire_warning", _boss_friendly_fire_warning(friendly_fire)))
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.rules",
		"value": "%s / %s" % [friendly_fire, arena_policy],
		"summary": "server mode config display only; damage and settlement stay server-authoritative; warning %s" % warning,
		"mode_id": mode_id,
		"mode_category": "boss",
		"friendly_fire": friendly_fire,
		"arena_policy": arena_policy,
		"movement_area_policy": arena_policy,
		"friendly_fire_warning": warning,
		"rules_source": String(state.get("rules_source", "local_default")),
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": true,
	}

func _boss_rule_safety_row(row_id: String, mode_id: String) -> Dictionary:
	var projection := boss_rule_safety_projection(mode_id)
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.rules",
		"value": String(projection.get("safety_text", "")),
		"summary": "local rule safety display only; friendly-fire damage, Boss HP, rewards, and settlement remain server-authoritative",
		"mode_id": mode_id,
		"mode_category": "boss",
		"ui_control": "status",
		"safety_kind": String(projection.get("safety_kind", "boss_rule_safety_projection")),
		"safety_projection": projection,
		"friendly_fire": String(projection.get("friendly_fire", "disabled")),
		"friendly_fire_warning": String(projection.get("friendly_fire_warning", "none")),
		"friendly_fire_risk_level": String(projection.get("friendly_fire_risk_level", "none")),
		"friendly_fire_enabled": bool(projection.get("friendly_fire_enabled", false)),
		"arena_policy": String(projection.get("arena_policy", "fixed_directions")),
		"movement_area_policy": String(projection.get("movement_area_policy", "fixed_directions")),
		"movement_constraint_summary": String(projection.get("movement_constraint_summary", "")),
		"rules_source": String(projection.get("rules_source", "local_default")),
		"safety_badges": projection.get("safety_badges", []),
		"projection_scope": "local_display_only",
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"boss_hp_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(projection.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": bool(projection.get("ok", false)),
	}

func _boss_party_row(row_id: String, mode_id: String, state: Dictionary) -> Dictionary:
	var positions: Array = state.get("positions", [])
	var display_slots := boss_display_slots(mode_id)
	var contract := boss_formation_contract(mode_id)
	var party_status_summary := boss_party_status_summary(mode_id)
	var roster_authority: Dictionary = party_status_summary.get("roster_authority_contract", boss_roster_authority_contract(mode_id))
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.party",
		"value": "%d/%d-%d %s layout %s display %s" % [
			int(party_status_summary.get("player_count", positions.size())),
			BOSS_MIN_PLAYERS,
			BOSS_MAX_PLAYERS,
			String(party_status_summary.get("party_status", state.get("party_status", "waiting"))),
			String(party_status_summary.get("slot_layout_policy", _boss_slot_layout_policy(positions.size()))),
			String(party_status_summary.get("display_status", "blocked")),
		],
		"summary": "local party formation display only; entry, card transfer, damage, rewards, and settlement require server confirmation",
		"items": positions,
		"display_slots": display_slots,
		"mode_id": mode_id,
		"mode_category": "boss",
		"party_status_summary": party_status_summary,
		"party_status_kind": String(party_status_summary.get("party_status_kind", "boss_party_status_summary")),
		"party_status": String(party_status_summary.get("party_status", state.get("party_status", "waiting"))),
		"player_count": int(state.get("player_count", positions.size())),
		"slot_layout_policy": String(party_status_summary.get("slot_layout_policy", _boss_slot_layout_policy(positions.size()))),
		"slot_labels": party_status_summary.get("slot_labels", _boss_slot_labels(positions.size())),
		"formation_contract": contract,
		"roster_authority_contract": roster_authority,
		"roster_projection_scope": String(roster_authority.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(roster_authority.get("roster_lock_authority", "server")),
		"roster_lock_status": String(roster_authority.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"formation_valid": bool(party_status_summary.get("formation_valid", false)),
		"formation_failures": party_status_summary.get("formation_failures", []),
		"fixed_direction_ready": bool(party_status_summary.get("fixed_direction_ready", false)),
		"center_aim_valid": bool(party_status_summary.get("center_aim_valid", false)),
		"all_slots_face_center": bool(party_status_summary.get("all_slots_face_center", false)),
		"entry_valid": bool(party_status_summary.get("entry_valid", false)),
		"entry_failures": party_status_summary.get("entry_failures", []),
		"can_request_transfer": bool(party_status_summary.get("can_request_transfer", false)),
		"server_confirmation_status": String(party_status_summary.get("server_confirmation_status", "required")),
		"display_scope": String(party_status_summary.get("display_scope", "local_display_only")),
		"projection_scope": String(party_status_summary.get("projection_scope", "local_display_only")),
		"intent_authority": "client_request_only",
		"server_required_for": party_status_summary.get("server_required_for", _boss_server_required_fields(mode_id)),
		"min_players": BOSS_MIN_PLAYERS,
		"max_players": BOSS_MAX_PLAYERS,
		"boss_center": state.get("boss_center", BOSS_CENTER),
		"aim_policy": str(state.get("aim_policy", "toward_center")),
		"friendly_fire": str(state.get("friendly_fire", "disabled")),
		"arena_policy": str(state.get("arena_policy", "fixed_directions")),
		"friendly_fire_warning": str(state.get("friendly_fire_warning", "none")),
		"requires_server_confirmation": true,
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": true,
	}

func _boss_entry_row(row_id: String, mode_id: String, state: Dictionary) -> Dictionary:
	var validation := boss_entry_preview(mode_id)
	var action_projection := boss_action_availability_projection(mode_id)
	var entry_action_panel: Dictionary = action_projection.get("entry_action_panel", _boss_entry_action_panel_from_projection(mode_id, action_projection))
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.entry",
		"value": "%s attempts %d key %d" % [
			String(validation.get("entry_period", "")),
			int(validation.get("attempts_left", 0)),
			int(validation.get("owned_key_count", 0)),
		],
		"mode_id": mode_id,
		"mode_category": "boss",
		"entry_valid": bool(validation.get("ok", false)),
		"entry_failures": validation.get("failures", []),
		"entry_period": String(validation.get("entry_period", "")),
		"attempts_left": int(validation.get("attempts_left", 0)),
		"required_rating": String(validation.get("required_rating", "")),
		"player_rating": String(validation.get("player_rating", "")),
		"required_key_id": String(validation.get("required_key_id", "")),
		"owned_key_count": int(validation.get("owned_key_count", 0)),
		"entry_preflight": validation,
		"action_availability": action_projection,
		"entry_action_panel": entry_action_panel,
			"entry_contract_kind": String(validation.get("entry_contract_kind", "")),
			"entry_contract_version": int(validation.get("entry_contract_version", 0)),
			"action_status": String(action_projection.get("action_status", "")),
			"local_blockers": action_projection.get("local_blockers", []),
			"can_request_entry": bool(action_projection.get("can_request_entry", false)),
			"can_request_transfer": bool(action_projection.get("can_request_transfer", false)),
			"can_display_playfield": bool(action_projection.get("can_display_playfield", false)),
			"availability_contract_kind": String(action_projection.get("availability_contract_kind", "")),
			"entry_request_scope": String(action_projection.get("entry_request_scope", "intent_only")),
			"transfer_request_scope": String(action_projection.get("transfer_request_scope", "intent_only")),
			"server_required_for": action_projection.get("server_required_for", []),
			"entry_intent_allowed_fields": validation.get("entry_intent_allowed_fields", []),
			"client_forbidden_entry_fields": validation.get("client_forbidden_entry_fields", []),
			"entry_confirmation_contract": validation.get("entry_confirmation_contract", {}),
			"ui_action_contract": action_projection.get("ui_action_contract", {}),
			"ui_action_cards": action_projection.get("ui_action_cards", []),
			"intent_authority": "client_request_only",
			"server_confirmation_status": String(validation.get("server_confirmation_status", "")),
			"local_validation": "boss_entry_preflight",
		"local_validation_rules": ["attempts_available", "party_size", "rating_requirement", "key_requirement"],
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": bool(validation.get("ok", false)),
	}

func _boss_entry_action_panel_from_projection(mode_id: String, projection: Dictionary) -> Dictionary:
	var cards: Array = projection.get("ui_action_cards", [])
	var action_buttons: Array[Dictionary] = []
	var entry_button: Dictionary = {}
	var transfer_button: Dictionary = {}
	for raw_card in cards:
		if typeof(raw_card) != TYPE_DICTIONARY:
			continue
		var card: Dictionary = raw_card
		var button := {
			"id": String(card.get("id", "")),
			"label_key": String(card.get("label_key", "")),
			"ui_action": String(card.get("ui_action", "")),
			"action_card_kind": String(card.get("action_card_kind", "")),
			"action_status": String(card.get("action_status", "")),
			"enabled": bool(card.get("enabled", false)),
			"blocked_reason": String(card.get("blocked_reason", "none")),
			"request_scope": String(card.get("request_scope", "intent_only")),
			"entry_request_scope": String(card.get("entry_request_scope", "")),
			"transfer_request_scope": String(card.get("transfer_request_scope", "")),
			"entry_contract_kind": String(card.get("entry_contract_kind", "")),
			"entry_contract_version": int(card.get("entry_contract_version", 0)),
			"entry_intent_allowed_fields": card.get("entry_intent_allowed_fields", []),
			"client_forbidden_entry_fields": card.get("client_forbidden_entry_fields", []),
			"entry_confirmation_contract": card.get("entry_confirmation_contract", {}),
			"server_required_for": card.get("server_required_for", []),
			"server_confirmation_status": String(card.get("server_confirmation_status", "")),
			"requires_server_confirmation": bool(card.get("requires_server_confirmation", true)),
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"client_result_authoritative": false,
		}
		action_buttons.append(button)
		if String(button.get("action_card_kind", "")) == "boss_entry_intent":
			entry_button = button
		elif String(button.get("action_card_kind", "")) == "boss_card_transfer_intent":
			transfer_button = button
	var local_blockers := _string_array(projection.get("local_blockers", []))
	var entry_blocked_reason := "none" if local_blockers.is_empty() else local_blockers[0]
	var panel_status := "ready_for_server_confirmation" if bool(projection.get("can_request_entry", false)) else "blocked_local"
	return {
		"ok": bool(projection.get("can_request_entry", false)) and bool(projection.get("display_ready", false)),
		"reason": String(projection.get("reason", "none" if local_blockers.is_empty() else local_blockers[0])),
		"mode_id": mode_id,
		"mode_category": "boss",
		"panel_kind": "boss_entry_action_panel",
		"ui_control": "panel",
		"render_slot": "mode_actions",
		"panel_status": panel_status,
		"primary_action_id": String(entry_button.get("id", "%s_entry_action_card" % mode_id)),
		"secondary_action_id": String(transfer_button.get("id", "%s_transfer_action_card" % mode_id)),
		"entry_enabled": bool(projection.get("can_request_entry", false)),
		"transfer_enabled": bool(projection.get("can_request_transfer", false)),
		"display_ready": bool(projection.get("display_ready", false)),
		"formation_valid": bool(projection.get("formation_valid", false)),
		"entry_valid": bool(projection.get("entry_valid", false)),
		"disabled_reasons": local_blockers,
		"entry_blocked_reason": entry_blocked_reason,
		"transfer_blocked_reason": "none" if bool(projection.get("can_request_transfer", false)) else entry_blocked_reason,
		"action_buttons": action_buttons,
		"entry_button": entry_button,
		"transfer_button": transfer_button,
		"entry_preflight": projection.get("entry_preflight", {}),
		"player_count": int(projection.get("player_count", 0)),
		"slot_layout_policy": String(projection.get("slot_layout_policy", "")),
		"slot_labels": projection.get("slot_labels", []),
		"attempts_left": int(projection.get("attempts_left", 0)),
		"required_rating": String(projection.get("required_rating", "")),
		"player_rating": String(projection.get("player_rating", "")),
		"required_key_id": String(projection.get("required_key_id", "")),
		"owned_key_count": int(projection.get("owned_key_count", 0)),
		"action_availability_kind": String(projection.get("availability_contract_kind", "")),
		"server_required_for": projection.get("server_required_for", _boss_server_required_fields(mode_id)),
		"entry_request_scope": String(projection.get("entry_request_scope", "intent_only")),
		"transfer_request_scope": String(projection.get("transfer_request_scope", "intent_only")),
		"server_confirmation_status": String(projection.get("server_confirmation_status", "required" if bool(projection.get("can_request_entry", false)) else "blocked_local")),
		"projection_scope": "local_display_only",
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(projection.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func _boss_formation_row(row_id: String, mode_id: String, state: Dictionary) -> Dictionary:
	var validation := validate_boss_formation(mode_id)
	var display_slots := boss_display_slots(mode_id)
	var contract := boss_formation_contract(mode_id)
	var roster_authority := boss_roster_authority_contract(mode_id)
	var formation_display_summary := boss_formation_display_summary(mode_id)
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.party",
		"value": boss_formation_summary(mode_id),
		"items": state.get("positions", []),
		"display_slots": display_slots,
		"mode_id": mode_id,
		"mode_category": "boss",
		"formation_valid": bool(validation.get("ok", false)),
		"formation_failures": validation.get("failures", []),
		"slot_angles_degrees": validation.get("slot_angles_degrees", []),
		"slot_layout_policy": String(validation.get("slot_layout_policy", "")),
		"slot_labels": validation.get("slot_labels", []),
		"formation_contract": contract,
		"roster_authority_contract": roster_authority,
		"roster_projection_scope": String(roster_authority.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(roster_authority.get("roster_lock_authority", "server")),
		"roster_lock_status": String(roster_authority.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"formation_display_summary": formation_display_summary,
		"formation_display_signature": int(formation_display_summary.get("formation_display_signature", 0)),
		"player_count": int(validation.get("player_count", 0)),
		"min_players": BOSS_MIN_PLAYERS,
		"max_players": BOSS_MAX_PLAYERS,
		"aim_policy": String(validation.get("aim_policy", "toward_center")),
		"friendly_fire": String(validation.get("friendly_fire", "disabled")),
		"arena_policy": String(validation.get("arena_policy", "fixed_directions")),
		"friendly_fire_warning": String(validation.get("friendly_fire_warning", "none")),
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": bool(validation.get("ok", false)),
	}

func _boss_playfield_row(row_id: String, mode_id: String) -> Dictionary:
	var projection := boss_playfield_projection(mode_id)
	var formation_display_summary: Dictionary = projection.get("formation_display_summary", boss_formation_display_summary(mode_id))
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.playfield",
		"value": "slots %d center %.2f,%.2f radius %.2f hp %.0f%%" % [
			int(projection.get("player_count", 0)),
			(projection.get("center_normalized", BOSS_DISPLAY_CENTER) as Vector2).x,
			(projection.get("center_normalized", BOSS_DISPLAY_CENTER) as Vector2).y,
			float(projection.get("display_radius_ratio", BOSS_DISPLAY_RADIUS)),
			float(projection.get("hp_ratio", 0.0)) * 100.0,
		],
		"summary": "local display projection only; damage, hp deltas, rewards, and settlement stay server-authoritative",
		"mode_id": mode_id,
		"mode_category": "boss",
		"playfield_projection": projection,
		"display_slots": projection.get("display_slots", []),
		"formation_contract": projection.get("formation_contract", {}),
		"roster_authority_contract": projection.get("roster_authority_contract", {}),
		"roster_projection_scope": String(projection.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(projection.get("roster_lock_authority", "server")),
		"roster_lock_status": String(projection.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"formation_display_summary": formation_display_summary,
		"formation_display_signature": int(formation_display_summary.get("formation_display_signature", 0)),
		"projection_scope": String(projection.get("projection_scope", "local_display_only")),
		"damage_authority": String(projection.get("damage_authority", "server")),
		"reward_authority": String(projection.get("reward_authority", "server")),
		"settlement_authority": String(projection.get("settlement_authority", "server")),
		"formation_valid": bool(projection.get("formation_valid", false)),
		"entry_valid": bool(projection.get("entry_valid", false)),
		"requires_server_confirmation": true,
		"server_authoritative": bool(projection.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": bool(projection.get("ok", false)),
	}

func _boss_hud_row(row_id: String, mode_id: String) -> Dictionary:
	var projection := boss_hud_projection(mode_id)
	var formation_display_summary: Dictionary = projection.get("formation_display_summary", boss_formation_display_summary(mode_id))
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.hud",
		"value": String(projection.get("hud_status_text", "")),
		"summary": "local HUD projection only; damage, rewards, and settlement stay server-authoritative",
		"mode_id": mode_id,
		"mode_category": "boss",
		"hud_projection": projection,
		"playfield_projection": projection.get("playfield_projection", {}),
		"display_slots": projection.get("display_slots", []),
		"formation_contract": projection.get("formation_contract", {}),
		"roster_authority_contract": projection.get("roster_authority_contract", {}),
		"roster_projection_scope": String(projection.get("roster_projection_scope", "local_display_only")),
		"roster_lock_authority": String(projection.get("roster_lock_authority", "server")),
		"roster_lock_status": String(projection.get("roster_lock_status", "local_preview")),
		"local_roster_authoritative": false,
		"formation_display_summary": formation_display_summary,
		"formation_display_signature": int(formation_display_summary.get("formation_display_signature", 0)),
		"projection_scope": String(projection.get("projection_scope", "local_display_only")),
		"damage_authority": String(projection.get("damage_authority", "server")),
		"reward_authority": String(projection.get("reward_authority", "server")),
		"settlement_authority": String(projection.get("settlement_authority", "server")),
		"entry_valid": bool(projection.get("entry_valid", false)),
		"formation_valid": bool(projection.get("formation_valid", false)),
		"hp_ratio": float(projection.get("hp_ratio", 0.0)),
		"player_count": int(projection.get("player_count", 0)),
		"requires_server_confirmation": true,
		"server_authoritative": bool(projection.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": bool(projection.get("ok", false)),
	}

func _boss_practice_preview_row(row_id: String, mode_id: String) -> Dictionary:
	var projection := boss_practice_preview_projection(mode_id)
	var replay_metadata := boss_practice_replay_metadata(mode_id)
	var phase_count := int(projection.get("preview_phase_count", 0))
	var digest := int(projection.get("preview_bundle_signature_digest", 0))
	var max_emit := int(projection.get("preview_max_emit_per_tick", 0))
	var headroom := int(projection.get("preview_min_budget_headroom", 0))
	var budget_status := String(projection.get("performance_budget_status", ""))
	var preview_metrics: Array[Dictionary] = [
		{"id": "phases", "label": "phases", "value": phase_count},
		{"id": "digest", "label": "digest", "value": digest},
		{"id": "max_emit", "label": "max emit", "value": max_emit},
		{"id": "headroom", "label": "headroom", "value": headroom},
		{"id": "budget", "label": "budget", "value": budget_status},
	]
	var authority_badges: Array[String] = [
		"local_practice_preview_only",
		"replay_local_practice_hash",
		"damage_server",
		"reward_server",
		"settlement_server",
	]
	return {
		"id": row_id,
		"label_key": "screen.settings.boss_spellbook",
		"value": "practice preview phases %d digest %d max_emit %d headroom %d %s" % [
			phase_count,
			digest,
			max_emit,
			headroom,
			budget_status,
		],
		"summary": "local Boss spellbook practice preview only; Replay can verify preview digest, but online damage, rewards, hp, and settlement stay server-authoritative",
		"mode_id": mode_id,
		"mode_category": "boss",
		"mode_group": "boss",
		"section": "boss_preview",
		"section_label_key": "ui.menu_section_boss",
		"ui_control": "card",
		"ui_control_label_key": "ui.control_card",
		"ui_action": "start_boss_practice_preview",
		"preview_card_kind": "boss_spellbook_practice_preview",
		"preview_card_title_key": "screen.settings.boss_spellbook",
		"preview_card_summary": "local practice preview; Replay hash can verify the bundle, online outcomes remain server authoritative",
		"preview_card_metrics": preview_metrics,
		"preview_card_primary_metric": "phases %d digest %d" % [phase_count, digest],
		"preview_card_secondary_metric": "max_emit %d headroom %d %s" % [max_emit, headroom, budget_status],
		"preview_card_authority_badges": authority_badges,
		"preview_card_action_hint": "start local practice preview; Replay verification only",
		"local_practice_action": "start_boss_spellbook_run",
		"local_practice_target_screen": "practice",
		"replay_metadata_contract": replay_metadata,
		"replay_metadata_ready": bool(replay_metadata.get("ok", false)),
		"replay_metadata_contract_kind": String(replay_metadata.get("metadata_contract_kind", "")),
		"local_hash_authority": "local_practice_verification_only",
		"online_result_authority": "server_settlement_required",
		"overview_card_kind": "boss_practice_preview",
		"render_slot": "mode_cards",
		"preview_projection": projection,
		"spellbook_id": String(projection.get("spellbook_id", BOSS_LOCAL_PREVIEW_SPELLBOOK_ID)),
		"preview_seed": int(projection.get("preview_seed", BOSS_LOCAL_PREVIEW_SEED)),
		"preview_bundle_id": String(projection.get("preview_bundle_id", "")),
		"preview_bundle_signature_digest": digest,
		"preview_phase_count": phase_count,
		"preview_phase_ids": projection.get("preview_phase_ids", []),
		"preview_phase_signature_digests": projection.get("preview_phase_signature_digests", []),
		"preview_max_emit_per_tick": max_emit,
		"preview_min_budget_headroom": headroom,
		"performance_budget_status": budget_status,
		"preview_authority_scope": String(projection.get("preview_authority_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)),
		"projection_scope": String(projection.get("projection_scope", BOSS_LOCAL_PREVIEW_AUTHORITY_SCOPE)),
		"replay_verification_scope": String(projection.get("replay_verification_scope", "local_practice_hash")),
		"practice_mode": String(projection.get("practice_mode", "boss_spellbook_practice")),
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_confirmation_status": String(projection.get("server_confirmation_status", "not_applicable_local_preview")),
		"requires_server_confirmation": false,
		"server_authoritative": false,
		"client_result_authoritative": false,
		"enabled": bool(projection.get("ok", false)),
	}

func _boss_transfer_row(row_id: String, mode_id: String, state: Dictionary) -> Dictionary:
	var requests: Array = state.get("transfer_requests", [])
	var transferred_ids := _string_array(state.get("transferred_card_ids", []))
	var action_projection := boss_action_availability_projection(mode_id)
	var latest_request := _latest_boss_transfer_request(requests)
	var latest_preview: Dictionary = latest_request.get("preflight", {}) if not latest_request.is_empty() else {}
	if latest_preview.is_empty() and not latest_request.is_empty():
		latest_preview = boss_transfer_preview(
			mode_id,
			String(latest_request.get("from_player_id", "")),
			String(latest_request.get("to_player_id", "")),
			String(latest_request.get("card_id", ""))
		)
	var latest_summary := "none"
	if not latest_request.is_empty():
		latest_summary = "%s->%s %s %s" % [
			String(latest_request.get("from_player_id", "")),
			String(latest_request.get("to_player_id", "")),
			String(latest_request.get("card_id", "")),
			String(latest_request.get("status", "requested")),
		]
	return {
		"id": row_id,
		"label_key": "screen.mode.boss.transfer",
		"value": "requested %d transferred %d latest %s" % [requests.size(), transferred_ids.size(), latest_summary],
		"summary": "local transfer intent display only; party_members_only and once_per_card_per_match guards run before server confirmation",
		"items": requests,
		"mode_id": mode_id,
		"mode_category": "boss",
		"party_ids": state.get("party_ids", []),
		"transferred_card_ids": transferred_ids,
		"transfer_request_count": requests.size(),
		"transferred_card_count": transferred_ids.size(),
		"pending_server_confirmation_count": _boss_pending_transfer_count(requests),
		"latest_transfer_request": latest_request,
		"latest_transfer_preview": latest_preview,
		"latest_transfer_summary": latest_summary,
		"action_availability": action_projection,
			"action_status": String(action_projection.get("action_status", "")),
			"local_blockers": action_projection.get("local_blockers", []),
			"can_request_entry": bool(action_projection.get("can_request_entry", false)),
			"can_request_transfer": bool(action_projection.get("can_request_transfer", false)),
			"can_display_playfield": bool(action_projection.get("can_display_playfield", false)),
			"availability_contract_kind": String(action_projection.get("availability_contract_kind", "")),
			"entry_request_scope": String(action_projection.get("entry_request_scope", "intent_only")),
			"transfer_request_scope": String(action_projection.get("transfer_request_scope", "intent_only")),
			"server_required_for": action_projection.get("server_required_for", []),
			"ui_action_contract": action_projection.get("ui_action_contract", {}),
			"ui_action_cards": action_projection.get("ui_action_cards", []),
			"transfer_policy": "once_per_card_per_match",
			"local_validation_rules": ["party_members_only", "no_self_transfer", "card_id_required", "once_per_card_per_match"],
		"preflight_available": true,
		"intent_authority": "client_request_only",
		"server_confirmation_status": "pending" if _boss_pending_transfer_count(requests) > 0 else "none",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"requires_server_confirmation": true,
		"local_validation": "boss_transfer_preflight",
		"last_error_code": last_error_code if last_action_status == "failed" else "none",
		"enabled": true,
	}

func _latest_boss_transfer_request(requests: Array) -> Dictionary:
	for i in range(requests.size() - 1, -1, -1):
		if typeof(requests[i]) == TYPE_DICTIONARY:
			return (requests[i] as Dictionary).duplicate(true)
	return {}

func _boss_pending_transfer_count(requests: Array) -> int:
	var count := 0
	for request in requests:
		if typeof(request) != TYPE_DICTIONARY:
			continue
		var row: Dictionary = request
		if String(row.get("status", "requested")) == "requested":
			count += 1
	return count

func _boss_server_required_fields(mode_id: String) -> Array[String]:
	var fields: Array[String] = [
		"entry_confirmation",
		"roster_lock",
		"card_transfer_confirmation",
		"damage",
		"reward_grants",
		"settlement",
		"result_receipt",
	]
	if mode_id == MODE_WORLD_BOSS:
		fields.append_array(["persistent_hp", "daily_attempts", "defeated_at", "world_announcement"])
	elif mode_id == MODE_INSTANCE_BOSS:
		fields.append_array(["access_gate", "clear_status", "stars", "failed_mechanic"])
	return fields

func _boss_entry_intent_allowed_fields(mode_id: String) -> Array[String]:
	var fields: Array[String] = [
		"mode_id",
		"boss_instance_id",
		"party_ids",
		"selected_deck_id",
		"deck_snapshot_hash",
		"client_action_seq",
		"requested_at_tick",
	]
	if mode_id == MODE_INSTANCE_BOSS:
		fields.append_array(["required_key_id", "entry_period"])
	elif mode_id == MODE_WORLD_BOSS:
		fields.append("season_id")
	return fields

func _boss_client_forbidden_entry_fields(mode_id: String) -> Array[String]:
	var fields: Array[String] = [
		"damage",
		"damage_this_match",
		"team_damage",
		"total_damage",
		"boss_hp_after",
		"boss_hp_after_global",
		"reward_grants",
		"reward_summary",
		"settlement_result",
		"settlement_receipt",
		"result_receipt",
		"server_result_hash",
	]
	if mode_id == MODE_WORLD_BOSS:
		fields.append_array(["current_hp", "daily_attempts_left", "defeated_at", "world_announcement"])
	elif mode_id == MODE_INSTANCE_BOSS:
		fields.append_array(["entry_attempts_left", "entry_unlocked", "clear_status", "stars", "star_rewards"])
	return fields

func _boss_entry_confirmation_contract(mode_id: String, entry_valid: bool, reason: String) -> Dictionary:
	return {
		"contract_kind": "boss_entry_confirmation_contract",
		"contract_version": 1,
		"mode_id": mode_id,
		"mode_category": "boss",
		"local_preflight_status": "valid" if entry_valid else "blocked_local",
		"local_preflight_reason": reason,
		"entry_request_scope": "intent_only",
		"entry_intent_allowed_fields": _boss_entry_intent_allowed_fields(mode_id),
		"client_forbidden_entry_fields": _boss_client_forbidden_entry_fields(mode_id),
		"server_required_for": _boss_server_required_fields(mode_id),
		"server_confirmation_status": "required" if entry_valid else "blocked_local",
		"requires_server_confirmation": true,
		"intent_authority": "client_request_only",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": false,
		"client_result_authoritative": false,
	}

func _boss_ui_action_contract(can_request_entry: bool, can_request_transfer: bool) -> Dictionary:
	return {
		"contract_kind": "boss_ui_action_contract",
		"entry_action": "request_boss_entry",
		"transfer_action": "request_boss_transfer",
		"entry_enabled": can_request_entry,
		"transfer_enabled": can_request_transfer,
		"entry_request_scope": "intent_only",
		"transfer_request_scope": "intent_only",
		"server_confirmation_status": "required" if can_request_entry else "blocked_local",
		"server_authority_required": true,
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"client_result_authoritative": false,
	}

func _boss_ui_action_cards(mode_id: String, can_request_entry: bool, can_request_transfer: bool, blockers: Array[String], confirmation_status: String) -> Array[Dictionary]:
	var local_blockers := blockers.duplicate()
	var entry_blocker: String = "none" if local_blockers.is_empty() else local_blockers[0]
	var entry_status: String = "ready_for_server_confirmation" if can_request_entry else "blocked_local"
	var transfer_status: String = "ready_for_server_confirmation" if can_request_transfer else "blocked_local"
	return [
		{
			"id": "%s_entry_action_card" % mode_id,
			"label_key": "screen.mode.boss.entry",
			"value": entry_status,
			"summary": "request intent only; server confirms entry and owns attempts, damage, rewards, and settlement",
			"mode_id": mode_id,
			"mode_category": "boss",
			"ui_control": "card",
			"ui_action": "request_boss_entry",
			"action_card_kind": "boss_entry_intent",
			"action_status": entry_status,
			"enabled": can_request_entry,
			"blocked_reason": entry_blocker,
			"local_blockers": local_blockers,
			"request_scope": "intent_only",
			"entry_request_scope": "intent_only",
			"entry_contract_kind": "boss_entry_verification_contract",
			"entry_contract_version": 1,
			"entry_intent_allowed_fields": _boss_entry_intent_allowed_fields(mode_id),
			"client_forbidden_entry_fields": _boss_client_forbidden_entry_fields(mode_id),
			"entry_confirmation_contract": _boss_entry_confirmation_contract(mode_id, can_request_entry, entry_blocker),
			"server_required_for": _boss_server_required_fields(mode_id),
			"server_confirmation_status": confirmation_status,
			"requires_server_confirmation": true,
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"client_result_authoritative": false,
		},
		{
			"id": "%s_transfer_action_card" % mode_id,
			"label_key": "screen.mode.boss.transfer",
			"value": transfer_status,
			"summary": "card transfer intent only; server checks ownership, bans, cost, cooldown, and once-per-card rules",
			"mode_id": mode_id,
			"mode_category": "boss",
			"ui_control": "card",
			"ui_action": "request_boss_transfer",
			"action_card_kind": "boss_card_transfer_intent",
			"action_status": transfer_status,
			"enabled": can_request_transfer,
			"blocked_reason": "none" if can_request_transfer else entry_blocker,
			"local_blockers": local_blockers,
			"request_scope": "intent_only",
			"transfer_request_scope": "intent_only",
			"server_confirmation_status": "required" if can_request_transfer else "blocked_local",
			"requires_server_confirmation": true,
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"client_result_authoritative": false,
		},
	]

func boss_outcome_projection(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"outcome_kind": "boss_outcome_projection",
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	if mode_id == MODE_WORLD_BOSS:
		var current_hp := float(state.get("current_hp", 0.0))
		var max_hp := float(state.get("max_hp", 0.0))
		var defeated_at := str(state.get("defeated_at", "")).strip_edges()
		var world_announcement := str(state.get("world_announcement", "")).strip_edges()
		var defeated := current_hp <= 0.0 or not defeated_at.is_empty() or not world_announcement.is_empty()
		var timestamp_pending := bool(state.get("defeat_timestamp_pending_server", false))
		var timestamp_source := "pending_server" if timestamp_pending else ("server" if not defeated_at.is_empty() else "none")
		var announcement_status := "emitted" if not world_announcement.is_empty() else ("pending_server" if defeated else "none")
		var outcome_status := "defeated" if defeated else str(state.get("last_result_status", "pending"))
		return {
			"ok": true,
			"reason": "none",
			"mode_id": mode_id,
			"mode_category": "boss",
			"outcome_kind": "world_boss_persistent_hp_outcome",
			"outcome_status": outcome_status,
			"outcome_summary": "persistent hp %.0f/%.0f status %s announcement %s timestamp %s" % [current_hp, max_hp, outcome_status, announcement_status, timestamp_source],
			"persistent_hp": true,
			"current_hp": current_hp,
			"max_hp": max_hp,
			"hp_ratio": 0.0 if max_hp <= 0.0 else clampf(current_hp / max_hp, 0.0, 1.0),
			"defeated": defeated,
			"defeated_at": defeated_at,
			"defeat_timestamp_pending_server": timestamp_pending,
			"defeat_timestamp_source": timestamp_source,
			"world_announcement": world_announcement,
			"announcement_status": announcement_status,
			"last_result_status": str(state.get("last_result_status", "pending")),
			"result_source": str(state.get("last_result_source", "")),
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"requires_server_confirmation": true,
			"server_authoritative": bool(state.get("server_authoritative", false)),
			"client_result_authoritative": false,
		}
	var star_conditions := _instance_boss_star_conditions(state)
	var met_conditions := 0
	for condition in star_conditions:
		if typeof(condition) == TYPE_DICTIONARY and bool((condition as Dictionary).get("met", false)):
			met_conditions += 1
	var cleared := bool(state.get("cleared", false))
	var boss_defeated := bool(state.get("boss_defeated", false))
	var failed_mechanic := bool(state.get("failed_mechanic", false))
	var failed_mechanic_id := String(state.get("failed_mechanic_id", ""))
	var failed_mechanic_ids := _string_array(state.get("failed_mechanic_ids", []))
	var failed_mechanic_summary := String(state.get("failed_mechanic_summary", ""))
	var failed_mechanic_source := String(state.get("failed_mechanic_source", "none"))
	var survivors := int(state.get("survivors", 0))
	var survivor_required := bool(state.get("survivor_required", true))
	var outcome_status := "cleared" if cleared else str(state.get("last_result_status", "pending"))
	return {
		"ok": true,
		"reason": "none",
		"mode_id": mode_id,
		"mode_category": "boss",
		"outcome_kind": "instance_boss_clear_outcome",
		"outcome_status": outcome_status,
		"outcome_summary": "clear %s stars %d conditions %d/%d survivors %d mechanic %s" % [
			outcome_status,
			int(state.get("stars", 0)),
			met_conditions,
			star_conditions.size(),
			survivors,
			failed_mechanic_id if failed_mechanic and not failed_mechanic_id.is_empty() else ("failed" if failed_mechanic else "ok"),
		],
		"persistent_hp": false,
		"cleared": cleared,
		"boss_defeated": boss_defeated,
		"survivors": survivors,
		"survivor_required": survivor_required,
		"failed_mechanic": failed_mechanic,
		"failed_mechanic_id": failed_mechanic_id,
		"failed_mechanic_ids": failed_mechanic_ids,
		"failed_mechanic_summary": failed_mechanic_summary,
		"failed_mechanic_source": failed_mechanic_source,
		"clear_rule": "survivor_required" if survivor_required else "survivor_optional",
		"clear_time_seconds": int(state.get("clear_time_seconds", 0)),
		"three_star_time_seconds": int(state.get("three_star_time_seconds", 180)),
		"deaths": int(state.get("deaths", 0)),
		"bombs_used": int(state.get("bombs_used", 0)),
		"bomb_limit": int(state.get("bomb_limit", 0)),
		"stars": int(state.get("stars", 0)),
		"star_conditions": star_conditions,
		"star_condition_summary": "%d/%d" % [met_conditions, star_conditions.size()],
		"last_result_status": str(state.get("last_result_status", "pending")),
		"result_source": str(state.get("last_result_source", "")),
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func _world_boss_result_row() -> Dictionary:
	var outcome_projection := boss_outcome_projection(MODE_WORLD_BOSS)
	var receipt_projection := boss_settlement_receipt_projection(MODE_WORLD_BOSS)
	var receipt_card := _boss_settlement_receipt_card(MODE_WORLD_BOSS, receipt_projection)
	var result_authority_summary := boss_result_authority_summary(MODE_WORLD_BOSS, outcome_projection, receipt_projection)
	return {
		"id": "world_boss_result",
		"label_key": "screen.mode.boss.result",
		"value": "damage %d applied %d hp %.0f attempts %d" % [
			int(world_boss_state.get("damage_this_match", 0)),
			int(world_boss_state.get("global_damage_applied", 0)),
			float(world_boss_state.get("current_hp", 0.0)),
			int(world_boss_state.get("daily_attempts_left", 0)),
		],
		"mode_id": MODE_WORLD_BOSS,
		"mode_category": "boss",
		"persistent_hp": true,
		"damage_this_match": int(world_boss_state.get("damage_this_match", 0)),
		"global_damage_applied": int(world_boss_state.get("global_damage_applied", 0)),
		"daily_attempts_left": int(world_boss_state.get("daily_attempts_left", 0)),
		"defeated_at": str(world_boss_state.get("defeated_at", "")),
		"world_announcement": str(world_boss_state.get("world_announcement", "")),
		"outcome_projection": outcome_projection,
		"outcome_kind": String(outcome_projection.get("outcome_kind", "")),
		"outcome_status": String(outcome_projection.get("outcome_status", "")),
		"outcome_summary": String(outcome_projection.get("outcome_summary", "")),
		"announcement_status": String(outcome_projection.get("announcement_status", "")),
		"defeated": bool(outcome_projection.get("defeated", false)),
		"defeat_timestamp_pending_server": bool(world_boss_state.get("defeat_timestamp_pending_server", false)),
		"defeat_timestamp_source": "pending_server" if bool(world_boss_state.get("defeat_timestamp_pending_server", false)) else ("server" if not str(world_boss_state.get("defeated_at", "")).is_empty() else "none"),
		"result_status": str(world_boss_state.get("last_result_status", "pending")),
		"result_source": str(world_boss_state.get("last_result_source", "")),
		"result_receipt_id": str(world_boss_state.get("last_result_receipt_id", "")),
		"result_hash": str(world_boss_state.get("last_result_hash", "")),
		"result_replay_id": str(world_boss_state.get("last_result_replay_id", "")),
		"result_server_time": str(world_boss_state.get("last_result_server_time", "")),
		"result_key_id": str(world_boss_state.get("last_result_key_id", "")),
		"receipt_source": str(world_boss_state.get("last_result_receipt_source", "")),
		"receipt_status": String(receipt_projection.get("receipt_status", "")),
		"result_authority_summary": result_authority_summary,
		"result_authority_summary_kind": String(result_authority_summary.get("summary_kind", "")),
		"result_authority_text": String(result_authority_summary.get("authority_text", "")),
		"result_authority_badges": result_authority_summary.get("authority_badges", []),
		"result_server_required_fields": result_authority_summary.get("server_required_fields", []),
		"settlement_receipt": receipt_projection.get("settlement_receipt", {}),
		"settlement_receipt_projection": receipt_projection,
		"receipt_card": receipt_card,
		"receipt_card_kind": String(receipt_card.get("receipt_card_kind", "")),
		"receipt_card_title_key": String(receipt_card.get("receipt_card_title_key", "")),
		"receipt_card_primary_metric": String(receipt_card.get("receipt_card_primary_metric", "")),
		"receipt_card_secondary_metric": String(receipt_card.get("receipt_card_secondary_metric", "")),
		"receipt_card_metrics": receipt_card.get("receipt_card_metrics", []),
		"receipt_card_authority_badges": receipt_card.get("receipt_card_authority_badges", []),
		"receipt_card_action_hint": String(receipt_card.get("receipt_card_action_hint", "")),
		"overview_card_kind": String(receipt_card.get("overview_card_kind", "")),
		"render_slot": String(receipt_card.get("render_slot", "")),
		"ui_control": String(receipt_card.get("ui_control", "card")),
		"ui_control_label_key": String(receipt_card.get("ui_control_label_key", "ui.control_card")),
		"result_rejected": bool(world_boss_state.get("last_result_rejected_client_authoritative", false)),
		"result_rejected_reason": str(world_boss_state.get("last_result_rejected_reason", "")),
		"result_rejection_authority": "client_rejected_server_required" if bool(world_boss_state.get("last_result_rejected_client_authoritative", false)) else "none",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(world_boss_state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": bool(world_boss_state.get("server_authoritative", false)),
	}

func _instance_boss_result_row() -> Dictionary:
	var star_conditions := _instance_boss_star_conditions(instance_boss_state)
	var outcome_projection := boss_outcome_projection(MODE_INSTANCE_BOSS)
	var receipt_projection := boss_settlement_receipt_projection(MODE_INSTANCE_BOSS)
	var receipt_card := _boss_settlement_receipt_card(MODE_INSTANCE_BOSS, receipt_projection)
	var result_authority_summary := boss_result_authority_summary(MODE_INSTANCE_BOSS, outcome_projection, receipt_projection)
	var met_conditions := 0
	for condition in star_conditions:
		if typeof(condition) == TYPE_DICTIONARY and bool((condition as Dictionary).get("met", false)):
			met_conditions += 1
	return {
		"id": "instance_boss_result",
		"label_key": "screen.mode.instance.result",
		"value": "%s stars %d conditions %d/%d time %ds deaths %d" % [
			str(instance_boss_state.get("last_result_status", "pending")),
			int(instance_boss_state.get("stars", 0)),
			met_conditions,
			star_conditions.size(),
			int(instance_boss_state.get("clear_time_seconds", 0)),
			int(instance_boss_state.get("deaths", 0)),
		],
		"mode_id": MODE_INSTANCE_BOSS,
		"mode_category": "boss",
		"persistent_hp": false,
		"cleared": bool(instance_boss_state.get("cleared", false)),
		"boss_defeated": bool(instance_boss_state.get("boss_defeated", false)),
		"survivors": int(instance_boss_state.get("survivors", 0)),
		"survivor_required": bool(instance_boss_state.get("survivor_required", true)),
		"clear_rule": "survivor_required" if bool(instance_boss_state.get("survivor_required", true)) else "survivor_optional",
		"failed_mechanic": bool(instance_boss_state.get("failed_mechanic", false)),
		"failed_mechanic_id": String(instance_boss_state.get("failed_mechanic_id", "")),
		"failed_mechanic_ids": _string_array(instance_boss_state.get("failed_mechanic_ids", [])),
		"failed_mechanic_summary": String(instance_boss_state.get("failed_mechanic_summary", "")),
		"failed_mechanic_source": String(instance_boss_state.get("failed_mechanic_source", "none")),
		"failed_mechanic_authority": "server",
		"clear_time_seconds": int(instance_boss_state.get("clear_time_seconds", 0)),
		"three_star_time_seconds": int(instance_boss_state.get("three_star_time_seconds", 180)),
		"deaths": int(instance_boss_state.get("deaths", 0)),
		"bombs_used": int(instance_boss_state.get("bombs_used", 0)),
		"bomb_limit": int(instance_boss_state.get("bomb_limit", 0)),
		"stars": int(instance_boss_state.get("stars", 0)),
		"star_conditions": star_conditions,
		"star_condition_summary": "%d/%d" % [met_conditions, star_conditions.size()],
		"outcome_projection": outcome_projection,
		"outcome_kind": String(outcome_projection.get("outcome_kind", "")),
		"outcome_status": String(outcome_projection.get("outcome_status", "")),
		"outcome_summary": String(outcome_projection.get("outcome_summary", "")),
		"result_status": str(instance_boss_state.get("last_result_status", "pending")),
		"result_source": str(instance_boss_state.get("last_result_source", "")),
		"result_receipt_id": str(instance_boss_state.get("last_result_receipt_id", "")),
		"result_hash": str(instance_boss_state.get("last_result_hash", "")),
		"result_replay_id": str(instance_boss_state.get("last_result_replay_id", "")),
		"result_server_time": str(instance_boss_state.get("last_result_server_time", "")),
		"result_key_id": str(instance_boss_state.get("last_result_key_id", "")),
		"receipt_source": str(instance_boss_state.get("last_result_receipt_source", "")),
		"receipt_status": String(receipt_projection.get("receipt_status", "")),
		"result_authority_summary": result_authority_summary,
		"result_authority_summary_kind": String(result_authority_summary.get("summary_kind", "")),
		"result_authority_text": String(result_authority_summary.get("authority_text", "")),
		"result_authority_badges": result_authority_summary.get("authority_badges", []),
		"result_server_required_fields": result_authority_summary.get("server_required_fields", []),
		"settlement_receipt": receipt_projection.get("settlement_receipt", {}),
		"settlement_receipt_projection": receipt_projection,
		"receipt_card": receipt_card,
		"receipt_card_kind": String(receipt_card.get("receipt_card_kind", "")),
		"receipt_card_title_key": String(receipt_card.get("receipt_card_title_key", "")),
		"receipt_card_primary_metric": String(receipt_card.get("receipt_card_primary_metric", "")),
		"receipt_card_secondary_metric": String(receipt_card.get("receipt_card_secondary_metric", "")),
		"receipt_card_metrics": receipt_card.get("receipt_card_metrics", []),
		"receipt_card_authority_badges": receipt_card.get("receipt_card_authority_badges", []),
		"receipt_card_action_hint": String(receipt_card.get("receipt_card_action_hint", "")),
		"overview_card_kind": String(receipt_card.get("overview_card_kind", "")),
		"render_slot": String(receipt_card.get("render_slot", "")),
		"ui_control": String(receipt_card.get("ui_control", "card")),
		"ui_control_label_key": String(receipt_card.get("ui_control_label_key", "ui.control_card")),
		"result_rejected": bool(instance_boss_state.get("last_result_rejected_client_authoritative", false)),
		"result_rejected_reason": str(instance_boss_state.get("last_result_rejected_reason", "")),
		"result_rejection_authority": "client_rejected_server_required" if bool(instance_boss_state.get("last_result_rejected_client_authoritative", false)) else "none",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(instance_boss_state.get("server_authoritative", false)),
		"client_result_authoritative": false,
		"enabled": bool(instance_boss_state.get("server_authoritative", false)),
	}

func _calculate_instance_stars(result: Dictionary, cleared: bool) -> int:
	if not cleared:
		return 0
	var stars := 1
	if int(result.get("clear_time_seconds", 9999)) <= int(result.get("three_star_time_seconds", 180)):
		stars += 1
	if int(result.get("deaths", 99)) == 0 and int(result.get("bombs_used", 99)) <= int(result.get("bomb_limit", 3)):
		stars += 1
	return clampi(stars, 1, 3)

func _boss_failed_mechanic_ids_from_result(result: Dictionary, failed_mechanic: bool) -> Array[String]:
	var ids := _string_array(result.get("failed_mechanic_ids", []))
	var single_id := String(result.get("failed_mechanic_id", "")).strip_edges()
	if not single_id.is_empty() and not ids.has(single_id):
		ids.push_front(single_id)
	var reason := String(result.get("failed_mechanic_reason", "")).strip_edges()
	if ids.is_empty() and failed_mechanic and not reason.is_empty():
		ids.append(reason)
	if ids.is_empty() and failed_mechanic:
		ids.append("server_failed_mechanic")
	return ids

func _instance_boss_star_conditions(state: Dictionary) -> Array[Dictionary]:
	var cleared := bool(state.get("cleared", false))
	var boss_defeated := bool(state.get("boss_defeated", false))
	var survivors := int(state.get("survivors", 0))
	var survivor_required := bool(state.get("survivor_required", true))
	var failed_mechanic := bool(state.get("failed_mechanic", false))
	var failed_mechanic_id := String(state.get("failed_mechanic_id", ""))
	var failed_mechanic_ids := _string_array(state.get("failed_mechanic_ids", []))
	var failed_mechanic_summary := String(state.get("failed_mechanic_summary", ""))
	var clear_time_seconds := int(state.get("clear_time_seconds", 0))
	var three_star_time_seconds := int(state.get("three_star_time_seconds", 180))
	var deaths := int(state.get("deaths", 0))
	var bombs_used := int(state.get("bombs_used", 0))
	var bomb_limit := int(state.get("bomb_limit", 3))
	return [
		{
			"id": "clear_required",
			"label_key": "screen.mode.instance.conditions",
			"met": cleared and boss_defeated and not failed_mechanic and (survivors > 0 or not survivor_required),
			"actual": "cleared" if cleared else "failed",
			"target": "boss_hp_zero_survivor_no_failed_mechanic" if survivor_required else "boss_hp_zero_no_failed_mechanic",
			"survivor_required": survivor_required,
			"failed_mechanic": failed_mechanic,
			"failed_mechanic_id": failed_mechanic_id,
			"failed_mechanic_ids": failed_mechanic_ids,
			"failed_mechanic_summary": failed_mechanic_summary,
			"failed_mechanic_authority": "server",
		},
		{
			"id": "time_star",
			"label_key": "screen.mode.instance.result",
			"met": cleared and clear_time_seconds > 0 and clear_time_seconds <= three_star_time_seconds,
			"actual_seconds": clear_time_seconds,
			"target_seconds": three_star_time_seconds,
		},
		{
			"id": "survival_star",
			"label_key": "screen.mode.instance.result",
			"met": cleared and deaths == 0,
			"actual_deaths": deaths,
			"target_deaths": 0,
		},
		{
			"id": "bomb_star",
			"label_key": "screen.mode.instance.result",
			"met": cleared and bombs_used <= bomb_limit,
			"actual_bombs": bombs_used,
			"target_bombs": bomb_limit,
		},
	]

func boss_settlement_receipt_projection(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"receipt_status": "invalid",
			"settlement_authority": "server",
			"reward_authority": "server",
			"damage_authority": "server",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var outcome_projection := boss_outcome_projection(mode_id)
	var receipt_id := str(state.get("last_result_receipt_id", "")).strip_edges()
	var result_hash := str(state.get("last_result_hash", "")).strip_edges()
	var replay_id := str(state.get("last_result_replay_id", "")).strip_edges()
	var server_time := str(state.get("last_result_server_time", "")).strip_edges()
	var key_id := str(state.get("last_result_key_id", "")).strip_edges()
	var receipt_source := str(state.get("last_result_receipt_source", "")).strip_edges()
	var has_receipt := not receipt_id.is_empty() or not result_hash.is_empty() or not server_time.is_empty()
	var receipt := {
		"receipt_id": receipt_id,
		"result_hash": result_hash,
		"replay_id": replay_id,
		"server_time": server_time,
		"key_id": key_id,
		"source": receipt_source,
	}
	return {
		"ok": has_receipt,
		"reason": "none" if has_receipt else "pending_server_receipt",
		"mode_id": mode_id,
		"mode_category": "boss",
		"receipt_status": "server_receipt_ready" if has_receipt else "pending_server_receipt",
		"result_status": str(state.get("last_result_status", "pending")),
		"result_source": str(state.get("last_result_source", "")),
		"outcome_projection": outcome_projection,
		"outcome_kind": String(outcome_projection.get("outcome_kind", "")),
		"outcome_status": String(outcome_projection.get("outcome_status", "")),
		"outcome_summary": String(outcome_projection.get("outcome_summary", "")),
		"settlement_receipt": receipt,
		"result_receipt_id": receipt_id,
		"result_hash": result_hash,
		"result_replay_id": replay_id,
		"result_server_time": server_time,
		"result_key_id": key_id,
		"receipt_source": receipt_source,
		"result_rejected": bool(state.get("last_result_rejected_client_authoritative", false)),
		"result_rejected_reason": str(state.get("last_result_rejected_reason", "")),
		"result_rejection_authority": "client_rejected_server_required" if bool(state.get("last_result_rejected_client_authoritative", false)) else "none",
		"persistent_hp": mode_id == MODE_WORLD_BOSS,
		"projection_scope": "server_settlement_receipt_projection",
		"settlement_authority": "server",
		"reward_authority": "server",
		"damage_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_result_authority_summary(mode_id: String, outcome_projection: Dictionary = {}, receipt_projection: Dictionary = {}) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"summary_kind": "boss_result_authority_summary",
			"authority_text": "invalid boss mode; server result required",
			"server_required_fields": ["damage", "reward_grants", "settlement", "result_receipt"],
			"authority_badges": ["damage_server", "reward_server", "settlement_server"],
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	var state := _state_for_mode(mode_id)
	var safe_outcome := outcome_projection
	if safe_outcome.is_empty():
		safe_outcome = boss_outcome_projection(mode_id)
	var safe_receipt := receipt_projection
	if safe_receipt.is_empty():
		safe_receipt = boss_settlement_receipt_projection(mode_id)
	var server_required_fields: Array[String] = ["damage", "reward_grants", "settlement", "result_receipt"]
	var authority_badges: Array[String] = ["damage_server", "reward_server", "settlement_server", "result_receipt_server"]
	var mode_result_scope := "world_boss_persistent_hp"
	if mode_id == MODE_WORLD_BOSS:
		server_required_fields.append_array(["persistent_hp", "daily_attempts", "defeated_at", "world_announcement"])
		authority_badges.append("persistent_hp_server")
	else:
		mode_result_scope = "instance_boss_clear"
		server_required_fields.append_array(["clear_status", "stars", "access_gate", "failed_mechanic"])
		authority_badges.append("clear_status_server")
	return {
		"ok": true,
		"reason": "none",
		"mode_id": mode_id,
		"mode_category": "boss",
		"summary_kind": "boss_result_authority_summary",
		"authority_text": "server settlement owns %s; client only displays receipt and outcome projection" % mode_result_scope,
		"mode_result_scope": mode_result_scope,
		"outcome_kind": String(safe_outcome.get("outcome_kind", "")),
		"outcome_status": String(safe_outcome.get("outcome_status", "")),
		"receipt_status": String(safe_receipt.get("receipt_status", "pending_server_receipt")),
		"result_status": str(state.get("last_result_status", "pending")),
		"result_source": str(state.get("last_result_source", "")),
		"result_receipt_id": str(state.get("last_result_receipt_id", "")),
		"result_hash": str(state.get("last_result_hash", "")),
		"result_rejected": bool(state.get("last_result_rejected_client_authoritative", false)),
		"result_rejected_reason": str(state.get("last_result_rejected_reason", "")),
		"server_required_fields": server_required_fields,
		"authority_badges": authority_badges,
		"requires_server_confirmation": true,
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": bool(state.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func boss_settlement_receipt_card_projection(mode_id: String) -> Dictionary:
	if not [MODE_WORLD_BOSS, MODE_INSTANCE_BOSS].has(mode_id):
		return {
			"ok": false,
			"reason": "boss_mode_invalid",
			"mode_id": mode_id,
			"mode_category": "boss",
			"receipt_card_kind": "boss_server_settlement_receipt",
			"server_authoritative": false,
			"client_result_authoritative": false,
		}
	return _boss_settlement_receipt_card(mode_id, boss_settlement_receipt_projection(mode_id))

func _boss_settlement_receipt_card(mode_id: String, receipt_projection: Dictionary) -> Dictionary:
	var receipt: Dictionary = {}
	if typeof(receipt_projection.get("settlement_receipt", {})) == TYPE_DICTIONARY:
		receipt = receipt_projection.get("settlement_receipt", {})
	var receipt_id := String(receipt_projection.get("result_receipt_id", receipt.get("receipt_id", ""))).strip_edges()
	var result_hash := String(receipt_projection.get("result_hash", receipt.get("result_hash", ""))).strip_edges()
	var replay_id := String(receipt_projection.get("result_replay_id", receipt.get("replay_id", ""))).strip_edges()
	var server_time := String(receipt_projection.get("result_server_time", receipt.get("server_time", ""))).strip_edges()
	var key_id := String(receipt_projection.get("result_key_id", receipt.get("key_id", ""))).strip_edges()
	var receipt_status := String(receipt_projection.get("receipt_status", "pending_server_receipt"))
	var result_status := String(receipt_projection.get("result_status", "pending"))
	var outcome_kind := String(receipt_projection.get("outcome_kind", ""))
	var outcome_status := String(receipt_projection.get("outcome_status", ""))
	var outcome_summary := String(receipt_projection.get("outcome_summary", ""))
	var result_rejected := bool(receipt_projection.get("result_rejected", false))
	var title_key := "screen.mode.boss.result" if mode_id == MODE_WORLD_BOSS else "screen.mode.instance.result"
	var metrics: Array[Dictionary] = [
		{"id": "receipt", "label": "receipt", "value": receipt_id if not receipt_id.is_empty() else "pending"},
		{"id": "hash", "label": "hash", "value": result_hash if not result_hash.is_empty() else "pending"},
		{"id": "replay", "label": "replay", "value": replay_id if not replay_id.is_empty() else "pending"},
		{"id": "server_time", "label": "server time", "value": server_time if not server_time.is_empty() else "pending"},
		{"id": "key", "label": "key", "value": key_id if not key_id.is_empty() else "pending"},
	]
	return {
		"ok": bool(receipt_projection.get("ok", false)),
		"reason": String(receipt_projection.get("reason", "none")),
		"mode_id": mode_id,
		"mode_category": "boss",
		"ui_control": "card",
		"ui_control_label_key": "ui.control_card",
		"receipt_card_kind": "boss_server_settlement_receipt",
		"overview_card_kind": "boss_result_receipt",
		"render_slot": "mode_cards",
		"receipt_card_title_key": title_key,
		"receipt_card_status": receipt_status,
		"receipt_card_primary_metric": "receipt %s" % (receipt_id if not receipt_id.is_empty() else receipt_status),
		"receipt_card_secondary_metric": "hash %s replay %s" % [result_hash if not result_hash.is_empty() else "pending", replay_id if not replay_id.is_empty() else "pending"],
		"receipt_card_metrics": metrics,
		"receipt_card_authority_badges": ["server_settlement_receipt", "damage_server", "reward_server", "settlement_server"],
		"receipt_card_action_hint": "view server receipt and replay audit only",
		"receipt_status": receipt_status,
		"result_status": result_status,
		"outcome_kind": outcome_kind,
		"outcome_status": outcome_status,
		"outcome_summary": outcome_summary,
		"result_rejected": result_rejected,
		"settlement_receipt": receipt,
		"settlement_receipt_projection": receipt_projection,
		"result_receipt_id": receipt_id,
		"result_hash": result_hash,
		"result_replay_id": replay_id,
		"result_server_time": server_time,
		"result_key_id": key_id,
		"projection_scope": "server_settlement_receipt_projection",
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"requires_server_confirmation": true,
		"server_authoritative": bool(receipt_projection.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func _apply_boss_settlement_receipt(state: Dictionary, result: Dictionary) -> void:
	var receipt: Dictionary = {}
	if typeof(result.get("settlement_receipt", {})) == TYPE_DICTIONARY:
		receipt = result.get("settlement_receipt", {})
	var receipt_id := str(result.get("settlement_key", result.get("receipt_id", result.get("settlement_receipt_id", receipt.get("receipt_id", ""))))).strip_edges()
	if receipt_id.is_empty():
		receipt_id = str(result.get("match_id", state.get("last_result_match_id", ""))).strip_edges()
	var result_hash := str(result.get("result_hash", result.get("state_hash", receipt.get("result_hash", receipt.get("state_hash", ""))))).strip_edges()
	var replay_id := str(result.get("replay_id", receipt.get("replay_id", ""))).strip_edges()
	var server_time := str(result.get("server_time", result.get("settled_at", receipt.get("server_time", receipt.get("settled_at", ""))))).strip_edges()
	var key_id := str(result.get("key_id", result.get("battle_key_id", receipt.get("key_id", receipt.get("battle_key_id", ""))))).strip_edges()
	state["last_result_receipt_id"] = receipt_id
	state["last_result_hash"] = result_hash
	state["last_result_replay_id"] = replay_id
	state["last_result_server_time"] = server_time
	state["last_result_key_id"] = key_id
	state["last_result_receipt_source"] = "server_settlement_receipt"

func _apply_boss_rule_config(state: Dictionary, source: Dictionary) -> void:
	var friendly_fire := _sanitized_boss_friendly_fire(String(source.get("friendly_fire", state.get("friendly_fire", "disabled"))))
	var arena_policy := _sanitized_boss_arena_policy(String(source.get("arena_policy", source.get("movement_area_policy", state.get("arena_policy", "fixed_directions")))))
	state["friendly_fire"] = friendly_fire
	state["arena_policy"] = arena_policy
	state["movement_area_policy"] = arena_policy
	state["friendly_fire_warning"] = _boss_friendly_fire_warning(friendly_fire)
	state["rules_source"] = "server_snapshot" if bool(source.get("server_authoritative", state.get("server_authoritative", false))) else "local_default"

func _sanitized_boss_friendly_fire(policy: String) -> String:
	var normalized := policy.strip_edges().to_lower()
	if BOSS_FRIENDLY_FIRE_POLICIES.has(normalized):
		return normalized
	return "disabled"

func _sanitized_boss_arena_policy(policy: String) -> String:
	var normalized := policy.strip_edges().to_lower()
	if BOSS_ARENA_POLICIES.has(normalized):
		return normalized
	return "fixed_directions"

func _boss_friendly_fire_warning(policy: String) -> String:
	match _sanitized_boss_friendly_fire(policy):
		"player_bullets_only":
			return "player_bullets_can_hit_allies"
		"all_friendly_fire":
			return "all_friendly_fire_enabled"
		_:
			return "none"

func _boss_friendly_fire_risk_level(policy: String) -> String:
	match _sanitized_boss_friendly_fire(policy):
		"player_bullets_only":
			return "moderate"
		"all_friendly_fire":
			return "high"
		_:
			return "none"

func _boss_arena_policy_summary(policy: String) -> String:
	match _sanitized_boss_arena_policy(policy):
		"shared_ring":
			return "shared_ring_movement"
		"personal_lanes":
			return "personal_lane_movement"
		_:
			return "fixed_direction_slots"

func _rating_meets_requirement(player_rating: String, required_rating: String) -> bool:
	if required_rating.strip_edges().is_empty():
		return true
	var player_index := BOSS_ENTRY_RATING_ORDER.find(player_rating.to_upper())
	var required_index := BOSS_ENTRY_RATING_ORDER.find(required_rating.to_upper())
	if required_index < 0:
		return true
	if player_index < 0:
		return false
	return player_index >= required_index

func _string_array(source: Variant) -> Array[String]:
	var values: Array[String] = []
	if typeof(source) != TYPE_ARRAY:
		return values
	for item in source as Array:
		values.append(str(item))
	return values

func _int_array(source: Variant) -> Array[int]:
	var values: Array[int] = []
	if typeof(source) != TYPE_ARRAY:
		return values
	for item in source as Array:
		values.append(int(item))
	return values
