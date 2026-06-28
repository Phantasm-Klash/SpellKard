class_name ResultsServiceModel
extends RefCounted

const STORE_DIR := "user://results"
const STORE_PATH := "user://results/local_results.json"

var chest_system: RefCounted = null
var deck_builder: RefCounted = null
var user_id := "local_user"
var wallet: Dictionary = {
	"points": 0,
	"card_dust": 0,
	"chest_keys": 0,
}
var settled_results: Dictionary = {}
var reward_ledger: Array[Dictionary] = []
var task_progress: Dictionary = {}
var event_state: Dictionary = {}
var leaderboards: Dictionary = {}
var compensation_claims: Dictionary = {}
var activity_claim_requests: Array[Dictionary] = []
var settled_activity_claims: Dictionary = {}
var last_result: Dictionary = {}
var last_error_code := "none"
var last_status := "none"

func configure(chest: RefCounted, builder: RefCounted) -> void:
	chest_system = chest
	deck_builder = builder
	_reset_runtime_defaults()
	load_state()

func reset_local_state() -> void:
	wallet = {"points": 0, "card_dust": 0, "chest_keys": 0}
	settled_results.clear()
	reward_ledger.clear()
	compensation_claims.clear()
	activity_claim_requests.clear()
	settled_activity_claims.clear()
	last_result = {}
	last_error_code = "none"
	last_status = "none"
	_reset_runtime_defaults()

func apply_server_match_result(result: Dictionary) -> Dictionary:
	var validation := _validate_result(result)
	if not bool(validation.get("valid", false)):
		last_status = "rejected"
		last_error_code = str(validation.get("reason", "invalid"))
		return {"ok": false, "duplicate": false, "reason": last_error_code}
	var match_id := str(result.get("match_id", ""))
	var target_user_id := str(result.get("user_id", user_id))
	var settlement_key := _settlement_key(match_id, target_user_id)
	if settled_results.has(settlement_key):
		last_result = (settled_results[settlement_key] as Dictionary).duplicate(true)
		last_status = "duplicate"
		last_error_code = "none"
		return {"ok": true, "duplicate": true, "reason": "already_settled", "result": last_result}
	var stored := result.duplicate(true)
	stored["settlement_key"] = settlement_key
	stored["authoritative"] = true
	stored["settled_at"] = Time.get_datetime_string_from_system(true, true)
	var rewards: Array[Dictionary] = _reward_array(stored.get("reward_json", []))
	_apply_rewards(match_id, target_user_id, rewards)
	_apply_task_progress(stored.get("task_progress", []))
	_apply_event_points(stored.get("event_points", {}))
	_apply_leaderboard_updates(stored.get("leaderboard_updates", []))
	_apply_mode_result(stored.get("mode_result", {}))
	settled_results[settlement_key] = stored
	last_result = stored.duplicate(true)
	last_status = "settled"
	last_error_code = "none"
	save_state()
	return {"ok": true, "duplicate": false, "reason": "none", "result": last_result}

func claim_compensation(compensation: Dictionary) -> Dictionary:
	var compensation_id := str(compensation.get("compensation_id", ""))
	if compensation_id.is_empty():
		last_status = "rejected"
		last_error_code = "compensation_missing"
		return {"ok": false, "duplicate": false, "reason": last_error_code}
	if compensation_claims.has(compensation_id):
		last_status = "duplicate"
		last_error_code = "none"
		return {"ok": true, "duplicate": true, "reason": "already_claimed"}
	var items: Array[Dictionary] = _reward_array(compensation.get("items", []))
	_apply_rewards("compensation:%s" % compensation_id, user_id, items)
	var stored := compensation.duplicate(true)
	stored["claimed_at"] = Time.get_datetime_string_from_system(true, true)
	compensation_claims[compensation_id] = stored
	last_status = "compensation"
	last_error_code = "none"
	save_state()
	return {"ok": true, "duplicate": false, "reason": "none", "compensation": stored}

func request_activity_claim(claim_kind: String, claim_id: String) -> Dictionary:
	var normalized_kind := claim_kind.strip_edges()
	var normalized_id := claim_id.strip_edges()
	if normalized_kind.is_empty() or normalized_id.is_empty():
		last_status = "claim_rejected"
		last_error_code = "claim_missing"
		return {"ok": false, "duplicate": false, "reason": last_error_code}
	var existing: Dictionary = _find_claim_request(normalized_kind, normalized_id)
	if not existing.is_empty():
		last_status = "claim_duplicate"
		last_error_code = "none"
		return {"ok": true, "duplicate": true, "reason": "already_requested", "request": existing}
	var eligibility: Dictionary = _claim_eligibility(normalized_kind, normalized_id)
	if not bool(eligibility.get("eligible", false)):
		last_status = "claim_rejected"
		last_error_code = str(eligibility.get("reason", "claim_ineligible"))
		return {"ok": false, "duplicate": false, "reason": last_error_code}
	var request := {
		"request_id": "local-claim-%d-%d" % [Time.get_ticks_msec(), activity_claim_requests.size()],
		"claim_kind": normalized_kind,
		"claim_id": normalized_id,
		"status": "pending_server",
		"client_result_authoritative": false,
		"created_at": Time.get_datetime_string_from_system(true, true),
		"preview": eligibility.get("preview", {}),
	}
	activity_claim_requests.append(request)
	if activity_claim_requests.size() > 64:
		activity_claim_requests.pop_front()
	last_status = "claim_request"
	last_error_code = "none"
	save_state()
	return {"ok": true, "duplicate": false, "reason": "none", "request": request}

func apply_server_activity_claim_result(result: Dictionary) -> Dictionary:
	var validation := _validate_activity_claim_result(result)
	if not bool(validation.get("valid", false)):
		last_status = "claim_result_rejected"
		last_error_code = str(validation.get("reason", "invalid"))
		return {"ok": false, "duplicate": false, "reason": last_error_code}
	var claim_kind := str(result.get("claim_kind", ""))
	var claim_id := str(result.get("claim_id", ""))
	var target_user_id := str(result.get("user_id", user_id))
	var settlement_key := _activity_claim_settlement_key(claim_kind, claim_id, target_user_id)
	if settled_activity_claims.has(settlement_key):
		last_status = "claim_result_duplicate"
		last_error_code = "none"
		return {
			"ok": true,
			"duplicate": true,
			"reason": "already_settled",
			"result": (settled_activity_claims[settlement_key] as Dictionary).duplicate(true),
		}
	var stored := result.duplicate(true)
	stored["settlement_key"] = settlement_key
	stored["authoritative"] = true
	stored["settled_at"] = Time.get_datetime_string_from_system(true, true)
	_apply_rewards("activity:%s:%s" % [claim_kind, claim_id], target_user_id, _reward_array(stored.get("reward_json", [])))
	_apply_activity_claim_projection(claim_kind, claim_id, stored)
	settled_activity_claims[settlement_key] = stored
	_update_activity_claim_request_status(claim_kind, claim_id, "settled")
	last_status = "claim_result"
	last_error_code = "none"
	save_state()
	return {"ok": true, "duplicate": false, "reason": "none", "result": stored}

func result_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var result_code := str(last_result.get("result", "none"))
	rows.append({"id": "result", "label_key": "screen.results.result", "value": result_code, "enabled": not last_result.is_empty()})
	rows.append({"id": "score_breakdown", "label_key": "screen.results.score", "value": _score_summary(last_result), "enabled": last_result.has("score")})
	rows.append({"id": "reward", "label_key": "screen.results.reward", "items": _reward_array(last_result.get("reward_json", [])), "enabled": last_status != "rejected"})
	rows.append({"id": "wallet", "label_key": "screen.results.wallet", "value": wallet_summary(), "enabled": true})
	rows.append({"id": "tasks", "label_key": "screen.results.tasks", "items": task_rows(), "enabled": true})
	rows.append({"id": "events", "label_key": "screen.results.events", "items": event_rows(), "enabled": true})
	rows.append({"id": "leaderboards", "label_key": "screen.results.leaderboards", "items": leaderboard_rows(), "enabled": true})
	rows.append({"id": "reward_audit", "label_key": "screen.results.audit", "items": ledger_rows(5), "enabled": true})
	rows.append({"id": "idempotency", "label_key": "screen.results.idempotency", "value": "%d %s %s" % [settled_results.size(), last_status, last_error_code], "enabled": true})
	rows.append({"id": "save_replay", "label_key": "screen.results.save_replay", "enabled": last_result.has("replay_id")})
	rows.append({"id": "retry", "label_key": "screen.results.retry", "enabled": true})
	return rows

func activity_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	rows.append({
		"id": "activity_summary",
		"label_key": "screen.activity.summary",
		"value": "%d requests %s %s" % [activity_claim_requests.size(), last_status, last_error_code],
		"settled_claims": settled_activity_claims.size(),
		"enabled": true,
	})
	var task_ids: Array = task_progress.keys()
	task_ids.sort()
	for task_id_value in task_ids:
		var task_id := str(task_id_value)
		var task: Dictionary = task_progress[task_id]
		var task_eligibility: Dictionary = _claim_eligibility("task", task_id)
		rows.append({
			"id": "activity_task_%s" % task_id,
			"label_key": str(task.get("label_key", "screen.activity.task")),
			"activity_kind": "task",
			"activity_id": task_id,
			"progress": int(task.get("progress", 0)),
			"target": int(task.get("target", 1)),
			"claimed": bool(task.get("claimed", false)),
			"claim_requested": not _find_claim_request("task", task_id).is_empty(),
			"claim_settled": settled_activity_claims.has(_activity_claim_settlement_key("task", task_id, user_id)),
			"claim_eligible": bool(task_eligibility.get("eligible", false)),
			"blocked_reason": str(task_eligibility.get("reason", "none")),
			"enabled": bool(task_eligibility.get("eligible", false)),
		})
	var event_ids: Array = event_state.keys()
	event_ids.sort()
	for event_id_value in event_ids:
		var event_id := str(event_id_value)
		var event: Dictionary = event_state[event_id]
		var event_eligibility: Dictionary = _claim_eligibility("event", event_id)
		rows.append({
			"id": "activity_event_%s" % event_id,
			"label_key": str(event.get("label_key", "screen.activity.event")),
			"activity_kind": "event",
			"activity_id": event_id,
			"points": int(event.get("points", 0)),
			"starts_at": str(event.get("starts_at", "")),
			"ends_at": str(event.get("ends_at", "")),
			"reward_status": str(event.get("reward_status", "pending")),
			"claim_requested": not _find_claim_request("event", event_id).is_empty(),
			"claim_settled": settled_activity_claims.has(_activity_claim_settlement_key("event", event_id, user_id)),
			"claim_eligible": bool(event_eligibility.get("eligible", false)),
			"blocked_reason": str(event_eligibility.get("reason", "none")),
			"enabled": bool(event_eligibility.get("eligible", false)),
		})
	var leaderboard_ids: Array = leaderboards.keys()
	leaderboard_ids.sort()
	for leaderboard_id_value in leaderboard_ids:
		var leaderboard_id := str(leaderboard_id_value)
		var board: Dictionary = leaderboards[leaderboard_id]
		var leaderboard_eligibility: Dictionary = _claim_eligibility("leaderboard", leaderboard_id)
		rows.append({
			"id": "activity_leaderboard_%s" % leaderboard_id,
			"label_key": str(board.get("label_key", "screen.activity.leaderboard")),
			"activity_kind": "leaderboard",
			"activity_id": leaderboard_id,
			"score": int(board.get("score", 0)),
			"rank": int(board.get("rank", 0)),
			"percentile": float(board.get("percentile", 1.0)),
			"season_id": str(board.get("season_id", "local")),
			"claim_requested": not _find_claim_request("leaderboard", leaderboard_id).is_empty(),
			"claim_settled": settled_activity_claims.has(_activity_claim_settlement_key("leaderboard", leaderboard_id, user_id)),
			"claim_eligible": bool(leaderboard_eligibility.get("eligible", false)),
			"blocked_reason": str(leaderboard_eligibility.get("reason", "none")),
			"enabled": bool(leaderboard_eligibility.get("eligible", false)),
		})
	rows.append({
		"id": "activity_claim_log",
		"label_key": "screen.activity.claim_log",
		"value": "%d/%d %s %s" % [settled_activity_claims.size(), activity_claim_requests.size(), last_status, last_error_code],
		"items": claim_request_rows(5),
		"enabled": true,
	})
	return rows

func task_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for task_id in task_progress.keys():
		var task: Dictionary = task_progress[task_id]
		rows.append({
			"id": str(task_id),
			"label_key": str(task.get("label_key", "screen.results.tasks")),
			"progress": int(task.get("progress", 0)),
			"target": int(task.get("target", 1)),
			"claimed": bool(task.get("claimed", false)),
		})
	return rows

func event_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for event_id in event_state.keys():
		var event: Dictionary = event_state[event_id]
		rows.append({
			"id": str(event_id),
			"label_key": str(event.get("label_key", "screen.results.events")),
			"points": int(event.get("points", 0)),
			"starts_at": str(event.get("starts_at", "")),
			"ends_at": str(event.get("ends_at", "")),
			"reward_status": str(event.get("reward_status", "pending")),
		})
	return rows

func leaderboard_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for leaderboard_id in leaderboards.keys():
		var board: Dictionary = leaderboards[leaderboard_id]
		rows.append({
			"id": str(leaderboard_id),
			"label_key": str(board.get("label_key", "screen.results.leaderboards")),
			"score": int(board.get("score", 0)),
			"rank": int(board.get("rank", 0)),
			"percentile": float(board.get("percentile", 1.0)),
			"season_id": str(board.get("season_id", "local")),
		})
	return rows

func ledger_rows(limit: int = 8) -> Array[Dictionary]:
	var start_index: int = max(0, reward_ledger.size() - limit)
	return reward_ledger.slice(start_index, reward_ledger.size())

func claim_request_rows(limit: int = 8) -> Array[Dictionary]:
	var start_index: int = max(0, activity_claim_requests.size() - limit)
	return activity_claim_requests.slice(start_index, activity_claim_requests.size())

func wallet_summary() -> String:
	return "points %d dust %d keys %d" % [
		int(wallet.get("points", 0)),
		int(wallet.get("card_dust", 0)),
		int(wallet.get("chest_keys", 0)),
	]

func summary() -> String:
	return "%s results %d ledger %d %s" % [last_status, settled_results.size(), reward_ledger.size(), wallet_summary()]

func load_state() -> bool:
	if not FileAccess.file_exists(STORE_PATH):
		return false
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(STORE_PATH))
	if typeof(parsed) != TYPE_DICTIONARY:
		last_status = "load_failed"
		return false
	var data := parsed as Dictionary
	wallet = data.get("wallet", wallet)
	settled_results = data.get("settled_results", settled_results)
	compensation_claims = data.get("compensation_claims", compensation_claims)
	settled_activity_claims = data.get("settled_activity_claims", settled_activity_claims)
	task_progress = data.get("task_progress", task_progress)
	event_state = data.get("event_state", event_state)
	leaderboards = data.get("leaderboards", leaderboards)
	activity_claim_requests.clear()
	var claim_requests_value: Variant = data.get("activity_claim_requests", [])
	if typeof(claim_requests_value) == TYPE_ARRAY:
		for request_entry in claim_requests_value as Array:
			if typeof(request_entry) == TYPE_DICTIONARY:
				activity_claim_requests.append((request_entry as Dictionary).duplicate(true))
	reward_ledger.clear()
	var ledger_value: Variant = data.get("reward_ledger", [])
	if typeof(ledger_value) == TYPE_ARRAY:
		for entry in ledger_value as Array:
			if typeof(entry) == TYPE_DICTIONARY:
				reward_ledger.append((entry as Dictionary).duplicate(true))
	return true

func save_state() -> bool:
	var error := DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(STORE_DIR))
	if error != OK:
		last_status = "save_failed"
		return false
	var file := FileAccess.open(STORE_PATH, FileAccess.WRITE)
	if file == null:
		last_status = "save_failed"
		return false
	file.store_string(JSON.stringify({
		"schema_version": 1,
		"wallet": wallet,
		"settled_results": settled_results,
		"compensation_claims": compensation_claims,
		"settled_activity_claims": settled_activity_claims,
		"task_progress": task_progress,
		"event_state": event_state,
		"leaderboards": leaderboards,
		"activity_claim_requests": activity_claim_requests,
		"reward_ledger": reward_ledger,
	}, "\t"))
	return true

func _reset_runtime_defaults() -> void:
	task_progress = {
		"daily_complete_match": {"label_key": "task.daily.complete_match", "progress": 0, "target": 1, "claimed": false},
		"daily_graze": {"label_key": "task.daily.graze", "progress": 0, "target": 500, "claimed": false},
		"weekly_replay_review": {"label_key": "task.weekly.replay_review", "progress": 0, "target": 1, "claimed": false},
	}
	event_state = {
		"local_s0": {
			"label_key": "event.local_s0.name",
			"starts_at": "2026-01-01T00:00:00Z",
			"ends_at": "2026-12-31T23:59:59Z",
			"points": 0,
			"reward_status": "pending",
		},
	}
	leaderboards = {
		"rank_score": {"label_key": "leaderboard.rank_score", "score": 0, "rank": 0, "percentile": 1.0, "season_id": "local_s0"},
		"single_score": {"label_key": "leaderboard.single_score", "score": 0, "rank": 0, "percentile": 1.0, "season_id": "local_s0"},
		"world_boss_damage": {"label_key": "leaderboard.world_boss_damage", "score": 0, "rank": 0, "percentile": 1.0, "season_id": "local_s0"},
	}

func _validate_result(result: Dictionary) -> Dictionary:
	if bool(result.get("client_authored_reward", false)):
		return {"valid": false, "reason": "client_authored_reward"}
	if str(result.get("match_id", "")).is_empty():
		return {"valid": false, "reason": "match_missing"}
	if str(result.get("user_id", user_id)).is_empty():
		return {"valid": false, "reason": "user_missing"}
	if typeof(result.get("reward_json", [])) != TYPE_ARRAY:
		return {"valid": false, "reason": "reward_invalid"}
	if not result.has("replay_id"):
		return {"valid": false, "reason": "replay_missing"}
	return {"valid": true, "reason": "none"}

func _validate_activity_claim_result(result: Dictionary) -> Dictionary:
	if bool(result.get("client_authored_reward", false)):
		return {"valid": false, "reason": "client_authored_reward"}
	var claim_kind := str(result.get("claim_kind", ""))
	var claim_id := str(result.get("claim_id", ""))
	if claim_kind.is_empty() or claim_id.is_empty():
		return {"valid": false, "reason": "claim_missing"}
	if not ["task", "event", "leaderboard"].has(claim_kind):
		return {"valid": false, "reason": "claim_kind_invalid"}
	if str(result.get("user_id", user_id)).is_empty():
		return {"valid": false, "reason": "user_missing"}
	if typeof(result.get("reward_json", [])) != TYPE_ARRAY:
		return {"valid": false, "reason": "reward_invalid"}
	if not bool(result.get("server_authoritative", true)):
		return {"valid": false, "reason": "server_authority_missing"}
	return {"valid": true, "reason": "none"}

func _settlement_key(match_id: String, target_user_id: String) -> String:
	return "%s:%s" % [match_id, target_user_id]

func _activity_claim_settlement_key(claim_kind: String, claim_id: String, target_user_id: String) -> String:
	return "%s:%s:%s" % [claim_kind, claim_id, target_user_id]

func _reward_array(source: Variant) -> Array[Dictionary]:
	var rewards: Array[Dictionary] = []
	if typeof(source) != TYPE_ARRAY:
		return rewards
	for item in source as Array:
		if typeof(item) == TYPE_DICTIONARY:
			rewards.append((item as Dictionary).duplicate(true))
	return rewards

func _apply_rewards(match_id: String, target_user_id: String, rewards: Array[Dictionary]) -> void:
	for reward in rewards:
		var reward_type := str(reward.get("type", ""))
		var amount := int(reward.get("amount", 0))
		var item_id := str(reward.get("item_id", ""))
		match reward_type:
			"points", "card_dust", "chest_keys":
				wallet[reward_type] = int(wallet.get(reward_type, 0)) + amount
				if chest_system != null and chest_system.wallet.has(reward_type):
					chest_system.wallet[reward_type] = int(chest_system.wallet.get(reward_type, 0)) + amount
			"chest":
				if chest_system != null:
					chest_system.owned_chests[item_id] = int(chest_system.owned_chests.get(item_id, 0)) + max(1, amount)
			"card":
				if deck_builder != null:
					deck_builder.grant_card(item_id, max(1, amount), "reward:%s" % match_id)
		reward_ledger.append({
			"match_id": match_id,
			"user_id": target_user_id,
			"type": reward_type,
			"item_id": item_id,
			"amount": amount,
			"source": str(reward.get("source", "match")),
			"created_at": Time.get_datetime_string_from_system(true, true),
		})

func _apply_task_progress(source: Variant) -> void:
	if typeof(source) != TYPE_ARRAY:
		return
	for item in source as Array:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var update := item as Dictionary
		var task_id := str(update.get("task_id", ""))
		if task_id.is_empty():
			continue
		var task: Dictionary = task_progress.get(task_id, {"label_key": "task.%s" % task_id, "progress": 0, "target": int(update.get("target", 1)), "claimed": false})
		task["progress"] = max(int(task.get("progress", 0)), int(update.get("progress", 0)))
		task["target"] = int(update.get("target", task.get("target", 1)))
		task["claimed"] = bool(update.get("claimed", task.get("claimed", false)))
		task_progress[task_id] = task

func _apply_event_points(source: Variant) -> void:
	if typeof(source) != TYPE_DICTIONARY:
		return
	var updates := source as Dictionary
	for event_id in updates.keys():
		var event: Dictionary = event_state.get(str(event_id), {"label_key": "event.%s" % str(event_id), "points": 0, "reward_status": "pending"})
		event["points"] = int(event.get("points", 0)) + int(updates[event_id])
		event_state[str(event_id)] = event

func _apply_leaderboard_updates(source: Variant) -> void:
	if typeof(source) != TYPE_ARRAY:
		return
	for item in source as Array:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var update := item as Dictionary
		var leaderboard_id := str(update.get("leaderboard_id", ""))
		if leaderboard_id.is_empty():
			continue
		var board: Dictionary = leaderboards.get(leaderboard_id, {"label_key": "leaderboard.%s" % leaderboard_id, "score": 0, "rank": 0, "percentile": 1.0, "season_id": "local_s0"})
		board["score"] = int(update.get("score", board.get("score", 0)))
		board["rank"] = int(update.get("rank", board.get("rank", 0)))
		board["percentile"] = float(update.get("percentile", board.get("percentile", 1.0)))
		board["season_id"] = str(update.get("season_id", board.get("season_id", "local_s0")))
		leaderboards[leaderboard_id] = board

func _apply_mode_result(source: Variant) -> void:
	if typeof(source) != TYPE_DICTIONARY:
		return
	var mode_result := source as Dictionary
	if mode_result.has("rating_code"):
		var board: Dictionary = leaderboards.get("rating_%s" % str(mode_result.get("rating_code", "")), {"label_key": "leaderboard.rank_score", "score": 0, "rank": 0, "percentile": 1.0, "season_id": "local_s0"})
		board["score"] = int(mode_result.get("rank_score_after", board.get("score", 0)))
		board["percentile"] = float(mode_result.get("percentile_after", board.get("percentile", 1.0)))
		leaderboards["rating_%s" % str(mode_result.get("rating_code", ""))] = board

func _apply_activity_claim_projection(claim_kind: String, claim_id: String, result: Dictionary) -> void:
	match claim_kind:
		"task":
			var task: Dictionary = task_progress.get(claim_id, {"label_key": "task.%s" % claim_id, "progress": 0, "target": 1, "claimed": false})
			task["claimed"] = bool(result.get("claimed", true))
			task["claimed_at"] = str(result.get("claimed_at", Time.get_datetime_string_from_system(true, true)))
			task_progress[claim_id] = task
		"event":
			var event: Dictionary = event_state.get(claim_id, {"label_key": "event.%s" % claim_id, "points": 0, "reward_status": "pending"})
			event["reward_status"] = str(result.get("reward_status", "claimed"))
			event["claimed_at"] = str(result.get("claimed_at", Time.get_datetime_string_from_system(true, true)))
			event_state[claim_id] = event
		"leaderboard":
			var board: Dictionary = leaderboards.get(claim_id, {"label_key": "leaderboard.%s" % claim_id, "score": 0, "rank": 0, "percentile": 1.0, "season_id": "local_s0"})
			board["reward_status"] = str(result.get("reward_status", "claimed"))
			board["claimed_at"] = str(result.get("claimed_at", Time.get_datetime_string_from_system(true, true)))
			leaderboards[claim_id] = board

func _update_activity_claim_request_status(claim_kind: String, claim_id: String, status: String) -> void:
	for i in range(activity_claim_requests.size()):
		if str(activity_claim_requests[i].get("claim_kind", "")) == claim_kind and str(activity_claim_requests[i].get("claim_id", "")) == claim_id:
			activity_claim_requests[i]["status"] = status
			activity_claim_requests[i]["updated_at"] = Time.get_datetime_string_from_system(true, true)

func _claim_eligibility(claim_kind: String, claim_id: String) -> Dictionary:
	if not _find_claim_request(claim_kind, claim_id).is_empty():
		return {"eligible": false, "reason": "already_requested", "preview": {}}
	match claim_kind:
		"task":
			if not task_progress.has(claim_id):
				return {"eligible": false, "reason": "task_missing", "preview": {}}
			var task: Dictionary = task_progress[claim_id]
			if bool(task.get("claimed", false)):
				return {"eligible": false, "reason": "already_claimed", "preview": {}}
			var progress := int(task.get("progress", 0))
			var target := int(task.get("target", 1))
			if progress < target:
				return {"eligible": false, "reason": "task_incomplete", "preview": {"progress": progress, "target": target}}
			return {"eligible": true, "reason": "none", "preview": {"progress": progress, "target": target}}
		"event":
			if not event_state.has(claim_id):
				return {"eligible": false, "reason": "event_missing", "preview": {}}
			var event: Dictionary = event_state[claim_id]
			var points := int(event.get("points", 0))
			if points <= 0:
				return {"eligible": false, "reason": "event_no_points", "preview": {"points": points}}
			var reward_status := str(event.get("reward_status", "pending"))
			if not ["pending", "available"].has(reward_status):
				return {"eligible": false, "reason": "event_%s" % reward_status, "preview": {"points": points, "reward_status": reward_status}}
			return {"eligible": true, "reason": "none", "preview": {"points": points, "reward_status": reward_status}}
		"leaderboard":
			if not leaderboards.has(claim_id):
				return {"eligible": false, "reason": "leaderboard_missing", "preview": {}}
			var board: Dictionary = leaderboards[claim_id]
			var rank := int(board.get("rank", 0))
			var percentile := float(board.get("percentile", 1.0))
			if rank <= 0:
				return {"eligible": false, "reason": "leaderboard_unranked", "preview": {"rank": rank, "percentile": percentile}}
			if percentile > 0.30:
				return {"eligible": false, "reason": "leaderboard_threshold", "preview": {"rank": rank, "percentile": percentile}}
			return {"eligible": true, "reason": "none", "preview": {"rank": rank, "percentile": percentile}}
		_:
			return {"eligible": false, "reason": "claim_kind_invalid", "preview": {}}

func _find_claim_request(claim_kind: String, claim_id: String) -> Dictionary:
	for request in activity_claim_requests:
		if str(request.get("claim_kind", "")) == claim_kind and str(request.get("claim_id", "")) == claim_id:
			return request.duplicate(true)
	return {}

func _score_summary(result: Dictionary) -> String:
	return "score %d graze %d hits %d %s" % [
		int(result.get("score", 0)),
		int(result.get("graze_count", 0)),
		int(result.get("hit_count", 0)),
		str(result.get("result", "none")),
	]
