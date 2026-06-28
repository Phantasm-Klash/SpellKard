class_name LatencyTestModel
extends RefCounted

const MatchmakingModelLib := preload("res://scripts/matchmaking_model.gd")
const NetworkMatchModelLib := preload("res://scripts/network_match_model.gd")
const GameModeModelLib := preload("res://scripts/game_mode_model.gd")

const SCENARIOS: Array[Dictionary] = [
	{"id": "latency_30", "ping_ms": 30, "packet_loss": 0.0, "jitter_ms": 4, "expected_delay": 2},
	{"id": "latency_80", "ping_ms": 80, "packet_loss": 0.01, "jitter_ms": 8, "expected_delay": 3},
	{"id": "latency_150", "ping_ms": 150, "packet_loss": 0.02, "jitter_ms": 20, "expected_delay": 4},
	{"id": "latency_250", "ping_ms": 250, "packet_loss": 0.04, "jitter_ms": 30, "expected_delay": 4},
	{"id": "packet_loss_5", "ping_ms": 120, "packet_loss": 0.05, "jitter_ms": 18, "expected_delay": 4},
	{"id": "jitter_spike", "ping_ms": 90, "packet_loss": 0.01, "jitter_ms": 42, "expected_delay": 4},
]

var matchmaking_model: RefCounted = null
var network_match_model: RefCounted = null
var game_mode_model: RefCounted = null
var last_report: Dictionary = {}

func configure(matchmaking: RefCounted, network_match: RefCounted, game_mode: RefCounted) -> void:
	matchmaking_model = matchmaking
	network_match_model = network_match
	game_mode_model = game_mode

func run_suite() -> Dictionary:
	var original_matchmaking_model: RefCounted = matchmaking_model
	var original_network_match_model: RefCounted = network_match_model
	var original_game_mode_model: RefCounted = game_mode_model
	_use_isolated_models()
	var scenario_rows: Array[Dictionary] = []
	for scenario in SCENARIOS:
		scenario_rows.append(_run_latency_scenario(scenario))
	var reconnect_row: Dictionary = _run_reconnect_scenario()
	var mode_rows: Array[Dictionary] = _run_mode_latency_scenarios()
	var aggregate: Dictionary = _aggregate(scenario_rows, reconnect_row, mode_rows)
	var warnings: Array[String] = _warnings(aggregate, scenario_rows, reconnect_row, mode_rows)
	last_report = {
		"ok": warnings.is_empty(),
		"scenario_count": scenario_rows.size(),
		"scenarios": scenario_rows,
		"reconnect": reconnect_row,
		"mode_rows": mode_rows,
		"aggregate": aggregate,
		"warnings": warnings,
		"summary": _summary(aggregate, warnings),
	}
	matchmaking_model = original_matchmaking_model
	network_match_model = original_network_match_model
	game_mode_model = original_game_mode_model
	return last_report.duplicate(true)

func rows() -> Array[Dictionary]:
	if last_report.is_empty():
		return []
	var aggregate: Dictionary = last_report.get("aggregate", {})
	var rows: Array[Dictionary] = [
		{"id": "latency_summary", "label_key": "screen.settings.latency_test", "value": str(last_report.get("summary", "")), "enabled": true},
		{"id": "latency_input_delay", "label_key": "screen.settings.latency_test", "value": "max %d" % int(aggregate.get("max_input_delay_ticks", 0)), "enabled": true},
		{"id": "latency_position_error", "label_key": "screen.settings.latency_test", "value": "%.2f" % float(aggregate.get("average_position_error", 0.0)), "enabled": true},
		{"id": "latency_corrections", "label_key": "screen.settings.latency_test", "value": "%d hard %d" % [int(aggregate.get("correction_count", 0)), int(aggregate.get("hard_snap_count", 0))], "enabled": true},
		{"id": "latency_reconnect", "label_key": "screen.settings.latency_test", "value": "%.0f%%" % (float(aggregate.get("reconnect_success_rate", 0.0)) * 100.0), "enabled": true},
	]
	for warning in last_report.get("warnings", []):
		rows.append({"id": "latency_warning_%d" % rows.size(), "label_key": "screen.settings.latency_test", "value": str(warning), "enabled": false})
	return rows

func _run_latency_scenario(scenario: Dictionary) -> Dictionary:
	_reset_network_match("certification", str(scenario.get("id", "latency")))
	var delay_ticks: int = network_match_model.update_latency_profile(
		int(scenario.get("ping_ms", 0)),
		float(scenario.get("packet_loss", 0.0)),
		int(scenario.get("jitter_ms", 0))
	)
	network_match_model.build_input_packet(10, {"direction_bits": 6, "slow_pressed": true, "shoot_pressed": true, "bomb_pressed": false, "card_slot": -1}, 4)
	network_match_model.receive_snapshot({
		"match_id": network_match_model.match_id,
		"tick": 10,
		"state_hash": "latency-%s-a" % str(scenario.get("id", "")),
		"full": true,
		"player_pos": {"x": 480.0, "y": 600.0},
		"mode_state": {"rating_code": "D", "rank_score_preview": 0, "challenge_progress": 0.4},
	}, {
		"tick": 10 + delay_ticks,
		"state_hash": "latency-%s-a" % str(scenario.get("id", "")),
		"player_pos": {"x": 480.0 + float(delay_ticks * 3), "y": 600.0},
	})
	if int(scenario.get("ping_ms", 0)) >= 150:
		network_match_model.receive_event({"type": "hit_confirmed", "client_predicted_miss": true})
	var metrics: Dictionary = network_match_model.metrics()
	return {
		"id": str(scenario.get("id", "")),
		"ping_ms": int(scenario.get("ping_ms", 0)),
		"packet_loss": float(scenario.get("packet_loss", 0.0)),
		"jitter_ms": int(scenario.get("jitter_ms", 0)),
		"input_delay_ticks": delay_ticks,
		"expected_delay": int(scenario.get("expected_delay", delay_ticks)),
		"average_position_error": float(metrics.get("average_position_error", 0.0)),
		"correction_count": int(metrics.get("correction_count", 0)),
		"hard_snap_count": int(metrics.get("hard_snap_count", 0)),
		"late_input_count": int(metrics.get("late_input_count", 0)),
		"perceived_hit_mismatch": int(metrics.get("perceived_hit_mismatch", 0)),
		"accepted": delay_ticks == int(scenario.get("expected_delay", delay_ticks)),
	}

func _run_reconnect_scenario() -> Dictionary:
	_reset_network_match("certification", "reconnect")
	network_match_model.update_latency_profile(150, 0.02, 20)
	network_match_model.note_reconnect_result(true)
	var request: Dictionary = network_match_model.request_full_snapshot("reconnect_restore")
	var metrics: Dictionary = network_match_model.metrics()
	return {
		"id": "short_disconnect_reconnect",
		"ok": int(metrics.get("reconnect_success_count", 0)) >= 1 and bool(network_match_model.full_snapshot_requested),
		"reconnect_success_rate": 1.0 if int(metrics.get("reconnect_success_count", 0)) >= 1 else 0.0,
		"full_snapshot_reason": str(request.get("reason", "")),
		"replay_authoritative": _end_match_authoritative("latency-reconnect-replay"),
	}

func _run_mode_latency_scenarios() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if game_mode_model == null:
		return rows
	var br_players: Array[String] = ["p1", "p2", "p3", "p4", "p5"]
	game_mode_model.select_mode("battle_royale")
	game_mode_model.configure_battle_royale_players(br_players)
	var br_round_ok: bool = game_mode_model.receive_battle_royale_round(1, ["choice_a", "choice_b", "choice_c"], 1800, br_players, 1860)
	var br_select: Dictionary = game_mode_model.select_battle_royale_card("choice_b", 1798)
	rows.append({
		"id": "battle_royale_deadline_150ms",
		"ok": br_round_ok and bool(br_select.get("ok", false)) and int(game_mode_model.battle_royale_state.get("choice_deadline_tick", 0)) == 1800,
		"metric": "choice_deadline_tick",
		"value": int(game_mode_model.battle_royale_state.get("choice_deadline_tick", 0)),
	})
	game_mode_model.select_mode("world_boss")
	game_mode_model.configure_boss_party("world_boss", ["p1", "p2", "p3", "p4"])
	var party_positions: Array = game_mode_model.world_boss_state.get("positions", [])
	var party_orientation_ok := party_positions.size() == 4
	for position_value in party_positions:
		if typeof(position_value) != TYPE_DICTIONARY:
			party_orientation_ok = false
			continue
		var position := position_value as Dictionary
		var spawn_value: Variant = position.get("spawn", Vector2.ZERO)
		var aim_value: Variant = position.get("aim", Vector2.ZERO)
		if typeof(spawn_value) != TYPE_VECTOR2 or typeof(aim_value) != TYPE_VECTOR2:
			party_orientation_ok = false
			continue
		var spawn: Vector2 = spawn_value
		var aim: Vector2 = aim_value
		if spawn.length() < 0.99 or aim.length() < 0.99 or spawn.dot(aim) > -0.99:
			party_orientation_ok = false
	rows.append({
		"id": "boss_party_positions_250ms",
		"ok": party_orientation_ok,
		"metric": "party_positions",
		"value": party_positions.size(),
	})
	var transfer_a: Dictionary = game_mode_model.request_boss_card_transfer("world_boss", "p1", "p2", "focus_lens")
	var transfer_b: Dictionary = game_mode_model.request_boss_card_transfer("world_boss", "p1", "p2", "focus_lens")
	rows.append({
		"id": "world_boss_transfer_idempotency_250ms",
		"ok": bool(transfer_a.get("ok", false)) and not bool(transfer_b.get("ok", true)) and str(transfer_b.get("last_error_code", "")) == "transfer_duplicate",
		"metric": "transfer_requests",
		"value": int((game_mode_model.world_boss_state.get("transfer_requests", []) as Array).size()),
	})
	game_mode_model.select_mode("certification")
	var before_rank: int = int(game_mode_model.certification_state.get("rank_score", 0))
	game_mode_model.apply_certification_result({
		"rating_code": "C",
		"rank_score_delta": 50,
		"percentile_after": 0.29,
		"next_certification_unlocked": true,
		"replay_id": "latency-cert-replay",
	})
	rows.append({
		"id": "certification_server_result_250ms",
		"ok": int(game_mode_model.certification_state.get("rank_score", 0)) == before_rank + 50 and game_mode_model.certification_eligible_for_next(),
		"metric": "rank_score_delta",
		"value": int(game_mode_model.certification_state.get("rank_score", 0)) - before_rank,
	})
	return rows

func _aggregate(scenarios: Array[Dictionary], reconnect_row: Dictionary, mode_rows: Array[Dictionary]) -> Dictionary:
	var max_delay: int = 0
	var total_error := 0.0
	var total_corrections: int = 0
	var hard_snaps: int = 0
	var late_inputs: int = 0
	var hit_mismatch: int = 0
	for row in scenarios:
		max_delay = max(max_delay, int(row.get("input_delay_ticks", 0)))
		total_error += float(row.get("average_position_error", 0.0))
		total_corrections += int(row.get("correction_count", 0))
		hard_snaps += int(row.get("hard_snap_count", 0))
		late_inputs += int(row.get("late_input_count", 0))
		hit_mismatch += int(row.get("perceived_hit_mismatch", 0))
	var mode_ok_count: int = 0
	for row in mode_rows:
		if bool(row.get("ok", false)):
			mode_ok_count += 1
	return {
		"max_input_delay_ticks": max_delay,
		"average_position_error": total_error / float(max(1, scenarios.size())),
		"correction_count": total_corrections,
		"hard_snap_count": hard_snaps,
		"late_input_count": late_inputs,
		"perceived_hit_mismatch": hit_mismatch,
		"reconnect_success_rate": float(reconnect_row.get("reconnect_success_rate", 0.0)),
		"mode_ok_count": mode_ok_count,
		"mode_count": mode_rows.size(),
	}

func _warnings(aggregate: Dictionary, scenarios: Array[Dictionary], reconnect_row: Dictionary, mode_rows: Array[Dictionary]) -> Array[String]:
	var warnings: Array[String] = []
	for scenario in scenarios:
		if not bool(scenario.get("accepted", false)):
			warnings.append("delay_profile_%s" % str(scenario.get("id", "")))
	if int(aggregate.get("max_input_delay_ticks", 0)) > 4:
		warnings.append("input_delay_too_high")
	if float(aggregate.get("average_position_error", 0.0)) > 32.0:
		warnings.append("position_error_high")
	if int(aggregate.get("hard_snap_count", 0)) > 0:
		warnings.append("hard_snap")
	if int(aggregate.get("late_input_count", 0)) > 0:
		warnings.append("late_input")
	if float(reconnect_row.get("reconnect_success_rate", 0.0)) < 1.0 or not bool(reconnect_row.get("replay_authoritative", false)):
		warnings.append("reconnect_restore")
	for row in mode_rows:
		if not bool(row.get("ok", false)):
			warnings.append(str(row.get("id", "mode_latency")))
	return warnings

func _summary(aggregate: Dictionary, warnings: Array[String]) -> String:
	return "delay %d err %.2f corr %d hard %d late %d mismatch %d reconnect %.0f%% modes %d/%d warnings %d" % [
		int(aggregate.get("max_input_delay_ticks", 0)),
		float(aggregate.get("average_position_error", 0.0)),
		int(aggregate.get("correction_count", 0)),
		int(aggregate.get("hard_snap_count", 0)),
		int(aggregate.get("late_input_count", 0)),
		int(aggregate.get("perceived_hit_mismatch", 0)),
		float(aggregate.get("reconnect_success_rate", 0.0)) * 100.0,
		int(aggregate.get("mode_ok_count", 0)),
		int(aggregate.get("mode_count", 0)),
		warnings.size(),
	]

func _reset_network_match(mode_id: String, suffix: String) -> void:
	if matchmaking_model != null:
		matchmaking_model.select_mode(mode_id)
	var queue_snapshot := {
		"match_id": "latency-%s-%d" % [suffix, Time.get_ticks_msec()],
		"mode_id": mode_id,
	}
	network_match_model.begin_from_queue(queue_snapshot)
	network_match_model.mark_loading_ready()
	network_match_model.receive_match_start({
		"match_id": str(queue_snapshot.get("match_id", "")),
		"server_seed": 20260625,
		"ruleset_version": "%s_latency" % mode_id,
	})

func _use_isolated_models() -> void:
	var isolated_matchmaking: RefCounted = MatchmakingModelLib.new()
	var isolated_network_match: RefCounted = NetworkMatchModelLib.new()
	var isolated_game_mode: RefCounted = GameModeModelLib.new()
	isolated_network_match.configure(isolated_matchmaking)
	isolated_game_mode.configure(isolated_matchmaking, isolated_network_match)
	matchmaking_model = isolated_matchmaking
	network_match_model = isolated_network_match
	game_mode_model = isolated_game_mode

func _end_match_authoritative(replay_id: String) -> bool:
	if network_match_model == null:
		return false
	network_match_model.receive_match_end({
		"replay_id": replay_id,
		"final_result": {"winner": "server", "rank_score_delta": 0},
	})
	return bool(network_match_model.replay_metadata.get("authoritative", false)) and str(network_match_model.replay_metadata.get("replay_id", "")) == replay_id
