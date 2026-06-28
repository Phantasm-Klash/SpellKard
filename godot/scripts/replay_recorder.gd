class_name ReplayRecorder
extends RefCounted

var game_version := "prototype"
var ruleset_version := "ruleset-local-s0"
var match_seed := 0
var input_stream: Array[Dictionary] = []
var event_stream: Array[Dictionary] = []
var input_by_tick := {}
var hash_by_tick := {}

func configure(seed: int, game_version_value: String = "prototype", ruleset_version_value: String = "ruleset-local-s0") -> void:
	match_seed = seed
	game_version = game_version_value
	ruleset_version = ruleset_version_value
	input_stream.clear()
	event_stream.clear()
	input_by_tick.clear()
	hash_by_tick.clear()

func record_input(tick: int, input_state: Dictionary) -> void:
	var compact := input_state.duplicate(true)
	compact["tick"] = tick
	input_stream.append(compact)
	input_by_tick[tick] = compact

func record_event(tick: int, event_type: String, payload: Dictionary = {}) -> void:
	var event := payload.duplicate(true)
	event["tick"] = tick
	event["type"] = event_type
	event_stream.append(event)
	if event_type == "state_hash":
		hash_by_tick[tick] = int(event.get("hash", 0))

func build_snapshot(final_hash: int) -> Dictionary:
	return {
		"game_version": game_version,
		"ruleset_version": ruleset_version,
		"match_seed": match_seed,
		"player_config": {"ship_id": "prototype_balanced"},
		"deck_snapshot": {},
		"input_stream": input_stream,
		"card_event_stream": event_stream,
		"final_result_hash": final_hash,
	}

func load_snapshot(snapshot: Dictionary) -> void:
	game_version = String(snapshot.get("game_version", "prototype"))
	ruleset_version = String(snapshot.get("ruleset_version", "ruleset-local-s0"))
	match_seed = int(snapshot.get("match_seed", 0))
	input_stream = []
	event_stream = []
	input_by_tick.clear()
	hash_by_tick.clear()
	for input_entry in snapshot.get("input_stream", []):
		var copied_input: Dictionary = input_entry.duplicate(true)
		input_stream.append(copied_input)
		input_by_tick[int(copied_input.get("tick", 0))] = copied_input
	for event_entry in snapshot.get("card_event_stream", []):
		var copied_event: Dictionary = event_entry.duplicate(true)
		event_stream.append(copied_event)
		if String(copied_event.get("type", "")) == "state_hash":
			hash_by_tick[int(copied_event.get("tick", 0))] = int(copied_event.get("hash", 0))

func get_input_for_tick(tick: int) -> Dictionary:
	return input_by_tick.get(tick, {
		"tick": tick,
		"direction_bits": 0,
		"slow_pressed": false,
		"shoot_pressed": false,
		"bomb_pressed": false,
		"card_slot": 0,
	})

func expected_hash_for_tick(tick: int) -> int:
	return int(hash_by_tick.get(tick, 0))

func has_hash_for_tick(tick: int) -> bool:
	return hash_by_tick.has(tick)

func final_recorded_tick() -> int:
	if input_stream.is_empty():
		return 0
	return int(input_stream[input_stream.size() - 1].get("tick", 0))

func recent_events(limit: int = 6) -> Array[Dictionary]:
	var start_index: int = max(0, event_stream.size() - limit)
	return event_stream.slice(start_index, event_stream.size())
