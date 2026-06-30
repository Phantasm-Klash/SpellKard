class_name InputProfile
extends RefCounted

const PROFILE_NAMES: Array[String] = ["left_hand", "right_hand"]
const GAMEPAD_CURVES: Array[String] = ["linear", "soft", "precise", "aggressive"]
const DEFAULT_PROFILE_INDEX := 0
const DEFAULT_GAMEPAD_CURVE_INDEX := 1
const DEFAULT_GAMEPAD_SENSITIVITY := 0.82
const DEFAULT_GAMEPAD_DEADZONE := 0.18
const DEFAULT_GAMEPAD_VIBRATION := 0.35
const REBIND_PRESETS := {
	&"move_left": [KEY_A, KEY_LEFT, KEY_J],
	&"move_right": [KEY_D, KEY_RIGHT, KEY_L],
	&"move_up": [KEY_W, KEY_UP, KEY_I],
	&"move_down": [KEY_S, KEY_DOWN, KEY_K],
	&"focus": [KEY_SHIFT, KEY_SPACE, KEY_CTRL],
	&"shoot": [KEY_Z, KEY_K, KEY_J],
	&"bomb": [KEY_X, KEY_L, KEY_U],
	&"card_1": [KEY_1, KEY_U, KEY_Q],
	&"card_2": [KEY_2, KEY_I, KEY_E],
	&"card_3": [KEY_3, KEY_O, KEY_C],
	&"card_4": [KEY_4, KEY_P, KEY_V],
	&"debug_restart": [KEY_R, KEY_ENTER, KEY_BACKSPACE],
}
const ACTION_LABELS := {
	&"move_left": "left",
	&"move_right": "right",
	&"move_up": "up",
	&"move_down": "down",
	&"focus": "focus",
	&"shoot": "shoot",
	&"bomb": "bomb",
	&"card_1": "card1",
	&"card_2": "card2",
	&"card_3": "card3",
	&"card_4": "card4",
	&"debug_restart": "restart",
}
const REQUIRED_ACTIONS: Array[StringName] = [
	&"move_left",
	&"move_right",
	&"move_up",
	&"move_down",
	&"focus",
	&"shoot",
	&"bomb",
	&"card_1",
	&"card_2",
	&"card_3",
	&"card_4",
	&"debug_restart",
]
const PROFILE_BINDINGS := {
	"left_hand": {
		&"move_left": [KEY_A, KEY_LEFT],
		&"move_right": [KEY_D, KEY_RIGHT],
		&"move_up": [KEY_W, KEY_UP],
		&"move_down": [KEY_S, KEY_DOWN],
		&"focus": [KEY_SHIFT],
		&"shoot": [KEY_Z],
		&"bomb": [KEY_X],
		&"card_1": [KEY_1],
		&"card_2": [KEY_2],
		&"card_3": [KEY_3],
		&"card_4": [KEY_4],
		&"debug_restart": [KEY_R],
	},
	"right_hand": {
		&"move_left": [KEY_LEFT, KEY_A],
		&"move_right": [KEY_RIGHT, KEY_D],
		&"move_up": [KEY_UP, KEY_W],
		&"move_down": [KEY_DOWN, KEY_S],
		&"focus": [KEY_SHIFT],
		&"shoot": [KEY_K],
		&"bomb": [KEY_L],
		&"card_1": [KEY_U],
		&"card_2": [KEY_I],
		&"card_3": [KEY_O],
		&"card_4": [KEY_P],
		&"debug_restart": [KEY_ENTER],
	},
}

var profile_index := DEFAULT_PROFILE_INDEX
var last_validation_errors: Array[String] = []
var applied_profile_name := ""
var custom_bindings := {}
var gamepad_curve_index := DEFAULT_GAMEPAD_CURVE_INDEX
var gamepad_sensitivity := DEFAULT_GAMEPAD_SENSITIVITY
var gamepad_deadzone := DEFAULT_GAMEPAD_DEADZONE
var gamepad_vibration := DEFAULT_GAMEPAD_VIBRATION

func profile_name() -> String:
	return PROFILE_NAMES[profile_index]

func cycle_profile() -> void:
	profile_index = (profile_index + 1) % PROFILE_NAMES.size()
	apply_current_profile()

func apply_current_profile() -> bool:
	return apply_profile(profile_name())

func apply_profile(name: String) -> bool:
	if not PROFILE_BINDINGS.has(name):
		last_validation_errors = ["unknown profile %s" % name]
		return false
	profile_index = max(0, PROFILE_NAMES.find(name))
	var bindings: Dictionary = PROFILE_BINDINGS[name]
	for action in REQUIRED_ACTIONS:
		_ensure_action(action)
		InputMap.action_erase_events(action)
		for keycode in bindings.get(action, []):
			InputMap.action_add_event(action, _key_event(int(keycode)))
	applied_profile_name = name
	custom_bindings.clear()
	return validate_actions()

func rebind_action(action: StringName, keycodes: Array) -> bool:
	if not REQUIRED_ACTIONS.has(action):
		last_validation_errors = ["unsupported action %s" % String(action)]
		return false
	if keycodes.is_empty():
		last_validation_errors = ["empty binding %s" % String(action)]
		return false
	_ensure_action(action)
	InputMap.action_erase_events(action)
	var cleaned: Array[int] = []
	for keycode in keycodes:
		if int(keycode) <= 0:
			continue
		if cleaned.has(int(keycode)):
			continue
		cleaned.append(int(keycode))
		InputMap.action_add_event(action, _key_event(int(keycode)))
	custom_bindings[action] = cleaned
	applied_profile_name = "%s_custom" % profile_name()
	return validate_actions()

func restore_current_profile() -> bool:
	return apply_current_profile()

func reset_profile() -> bool:
	profile_index = DEFAULT_PROFILE_INDEX
	return apply_current_profile()

func reset_binding(action: StringName) -> Dictionary:
	if not REQUIRED_ACTIONS.has(action):
		last_validation_errors = ["unsupported action %s" % String(action)]
		return {"ok": false, "reason": "unsupported_action"}
	var profile_bindings: Dictionary = PROFILE_BINDINGS.get(profile_name(), {})
	var keycodes: Array = profile_bindings.get(action, [])
	if keycodes.is_empty():
		return {"ok": false, "reason": "profile_binding_missing"}
	var ok := rebind_action(action, [int(keycodes[0])])
	if ok:
		custom_bindings.erase(action)
		applied_profile_name = profile_name()
	return {"ok": ok, "action": String(action), "keycode": int(keycodes[0]), "key": OS.get_keycode_string(int(keycodes[0]))}

func profile_options() -> Array[String]:
	return PROFILE_NAMES.duplicate()

func gamepad_curve_options() -> Array[String]:
	return GAMEPAD_CURVES.duplicate()

func binding_option_names(action: StringName) -> Array[String]:
	var presets: Array = REBIND_PRESETS.get(action, [])
	var names: Array[String] = []
	for keycode in presets:
		names.append(OS.get_keycode_string(int(keycode)))
	return names

func binding_option_index(action: StringName, keycodes: Array[int]) -> int:
	var presets: Array = REBIND_PRESETS.get(action, [])
	if keycodes.is_empty():
		return -1
	return presets.find(int(keycodes[0]))

func binding_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var conflicts_by_action := binding_conflicts_by_action()
	for action in REQUIRED_ACTIONS:
		var keycodes := action_keycodes(action)
		var names: Array[String] = []
		for keycode in keycodes:
			names.append(OS.get_keycode_string(keycode))
		var conflict_actions: Array = conflicts_by_action.get(String(action), [])
		rows.append({
			"id": "binding_%s" % String(action),
			"action": String(action),
			"label_key": "screen.settings.input_binding",
			"label": String(ACTION_LABELS.get(action, action)),
			"keys": names,
			"keycodes": keycodes,
			"conflict_actions": conflict_actions,
			"conflict_count": conflict_actions.size(),
			"conflict_status": "conflict" if not conflict_actions.is_empty() else "ok",
			"summary": "conflicts %s" % ",".join(conflict_actions) if not conflict_actions.is_empty() else "no conflicts",
			"custom": custom_bindings.has(action),
			"control_options": binding_option_names(action),
			"control_option_index": binding_option_index(action, keycodes),
			"ui_action": "cycle_input_binding",
			"enabled": true,
		})
	return rows

func gamepad_rows() -> Array[Dictionary]:
	return [
		{"id": "gamepad_curve", "label_key": "screen.settings.gamepad", "value": gamepad_curve(), "summary": curve_preview_summary(), "curve_graph": curve_preview_graph(), "control_options": gamepad_curve_options(), "control_option_index": gamepad_curve_index, "ui_action": "cycle_gamepad_curve", "enabled": true},
		{"id": "gamepad_curve_preview", "label_key": "screen.settings.gamepad_curve_preview", "summary": curve_preview_summary(), "curve_graph": curve_preview_graph(), "samples": curve_preview_samples(), "enabled": true},
		{"id": "gamepad_sensitivity", "label_key": "screen.settings.gamepad", "value": "%.0f%%" % (gamepad_sensitivity * 100.0), "control_value": gamepad_sensitivity, "control_min": 0.30, "control_max": 1.50, "control_step": 0.05, "control_unit": "percent", "ui_action": "adjust_gamepad_sensitivity", "delta": 0.05, "enabled": true},
		{"id": "gamepad_deadzone", "label_key": "screen.settings.gamepad", "value": "%.0f%%" % (gamepad_deadzone * 100.0), "control_value": gamepad_deadzone, "control_min": 0.02, "control_max": 0.45, "control_step": 0.02, "control_unit": "percent", "ui_action": "adjust_gamepad_deadzone", "delta": 0.02, "enabled": true},
		{"id": "gamepad_vibration", "label_key": "screen.settings.gamepad", "value": "%.0f%%" % (gamepad_vibration * 100.0), "control_value": gamepad_vibration, "control_min": 0.0, "control_max": 1.0, "control_step": 0.05, "control_unit": "percent", "ui_action": "adjust_gamepad_vibration", "delta": 0.05, "enabled": true},
		{"id": "gamepad_reset_all", "label_key": "screen.settings.reset_gamepad", "summary": "curve, sensitivity, deadzone, vibration", "ui_action": "reset_gamepad_settings", "enabled": true},
	]

func validate_actions() -> bool:
	last_validation_errors.clear()
	for action in REQUIRED_ACTIONS:
		if not InputMap.has_action(action):
			last_validation_errors.append("missing %s" % String(action))
			continue
		if InputMap.action_get_events(action).is_empty():
			last_validation_errors.append("unbound %s" % String(action))
	return last_validation_errors.is_empty()

func action_keycodes(action: StringName) -> Array[int]:
	var keycodes: Array[int] = []
	if not InputMap.has_action(action):
		return keycodes
	for event in InputMap.action_get_events(action):
		if event is InputEventKey:
			keycodes.append(int((event as InputEventKey).keycode))
	return keycodes

func action_summary(action: StringName) -> String:
	var parts: Array[String] = []
	for keycode in action_keycodes(action):
		parts.append(OS.get_keycode_string(keycode))
	return "%s=%s" % [String(ACTION_LABELS.get(action, action)), "+".join(parts)]

func binding_conflicts_by_action() -> Dictionary:
	var key_to_actions := {}
	for action in REQUIRED_ACTIONS:
		for keycode in action_keycodes(action):
			if keycode <= 0:
				continue
			var key := int(keycode)
			var actions: Array = key_to_actions.get(key, [])
			if not actions.has(String(action)):
				actions.append(String(action))
			key_to_actions[key] = actions
	var conflicts := {}
	for action in REQUIRED_ACTIONS:
		conflicts[String(action)] = []
	for key in key_to_actions.keys():
		var actions: Array = key_to_actions[key]
		if actions.size() <= 1:
			continue
		for action_name in actions:
			var existing: Array = conflicts.get(action_name, [])
			for other_action in actions:
				if other_action == action_name or existing.has(other_action):
					continue
				existing.append(other_action)
			conflicts[action_name] = existing
	return conflicts

func conflict_summary() -> String:
	var parts: Array[String] = []
	var conflicts := binding_conflicts_by_action()
	for action in REQUIRED_ACTIONS:
		var conflict_actions: Array = conflicts.get(String(action), [])
		if conflict_actions.is_empty():
			continue
		parts.append("%s:%s" % [String(action), ",".join(conflict_actions)])
	return "ok" if parts.is_empty() else "; ".join(parts)

func validation_summary() -> String:
	if validate_actions():
		return "ok"
	return ", ".join(last_validation_errors)

func gamepad_curve() -> String:
	return GAMEPAD_CURVES[gamepad_curve_index]

func cycle_gamepad_curve(delta: int = 1) -> String:
	gamepad_curve_index = wrapi(gamepad_curve_index + delta, 0, GAMEPAD_CURVES.size())
	return gamepad_curve()

func adjust_gamepad_sensitivity(delta: float) -> float:
	gamepad_sensitivity = clampf(gamepad_sensitivity + delta, 0.30, 1.50)
	return gamepad_sensitivity

func adjust_gamepad_deadzone(delta: float) -> float:
	gamepad_deadzone = clampf(gamepad_deadzone + delta, 0.02, 0.45)
	return gamepad_deadzone

func adjust_gamepad_vibration(delta: float) -> float:
	gamepad_vibration = clampf(gamepad_vibration + delta, 0.0, 1.0)
	return gamepad_vibration

func reset_gamepad_curve() -> String:
	gamepad_curve_index = DEFAULT_GAMEPAD_CURVE_INDEX
	return gamepad_curve()

func reset_gamepad_sensitivity() -> float:
	gamepad_sensitivity = DEFAULT_GAMEPAD_SENSITIVITY
	return gamepad_sensitivity

func reset_gamepad_deadzone() -> float:
	gamepad_deadzone = DEFAULT_GAMEPAD_DEADZONE
	return gamepad_deadzone

func reset_gamepad_vibration() -> float:
	gamepad_vibration = DEFAULT_GAMEPAD_VIBRATION
	return gamepad_vibration

func reset_gamepad_settings() -> Dictionary:
	return {
		"curve": reset_gamepad_curve(),
		"sensitivity": reset_gamepad_sensitivity(),
		"deadzone": reset_gamepad_deadzone(),
		"vibration": reset_gamepad_vibration(),
	}

func curve_preview_samples() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for raw in [0.25, 0.50, 0.75, 1.00]:
		rows.append({
			"raw": raw,
			"output": curve_value(raw),
		})
	return rows

func curve_preview_summary() -> String:
	var parts: Array[String] = []
	for sample in curve_preview_samples():
		parts.append("%.0f>%.0f" % [
			float(sample.get("raw", 0.0)) * 100.0,
			float(sample.get("output", 0.0)) * 100.0,
		])
	return "%s dz %.0f%% sens %.0f%% %s" % [
		gamepad_curve(),
		gamepad_deadzone * 100.0,
		gamepad_sensitivity * 100.0,
		" ".join(parts),
	]

func curve_preview_graph() -> String:
	var grid: Array[String] = []
	var width := 13
	var height := 5
	for y in range(height):
		var chars: Array[String] = []
		for x in range(width):
			chars.append(".")
		grid.append("".join(chars))
	for x in range(width):
		var raw := float(x) / float(width - 1)
		var output := curve_value(raw)
		var y := clampi(int(round((1.0 - output) * float(height - 1))), 0, height - 1)
		var chars: Array = grid[y].split("")
		chars[x] = "*"
		grid[y] = "".join(chars)
	return "/".join(grid)

func movement_speed_preview_samples(move_speed: float, focus_speed: float) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for sample in curve_preview_samples():
		var output := float(sample.get("output", 0.0))
		rows.append({
			"raw": float(sample.get("raw", 0.0)),
			"output": output,
			"move_speed": output * move_speed,
			"focus_speed": output * focus_speed,
		})
	return rows

func movement_speed_preview_summary(move_speed: float, focus_speed: float) -> String:
	var move_parts: Array[String] = []
	var focus_parts: Array[String] = []
	for sample in movement_speed_preview_samples(move_speed, focus_speed):
		move_parts.append("%.0f>%.0f" % [
			float(sample.get("raw", 0.0)) * 100.0,
			float(sample.get("move_speed", 0.0)),
		])
		focus_parts.append("%.0f>%.0f" % [
			float(sample.get("raw", 0.0)) * 100.0,
			float(sample.get("focus_speed", 0.0)),
		])
	return "move %s focus %s" % [" ".join(move_parts), " ".join(focus_parts)]

func curve_value(raw_strength: float) -> float:
	var normalized := clampf((raw_strength - gamepad_deadzone) / maxf(0.001, 1.0 - gamepad_deadzone), 0.0, 1.0)
	match gamepad_curve():
		"soft":
			normalized = sqrt(normalized)
		"precise":
			normalized = normalized * normalized
		"aggressive":
			normalized = pow(normalized, 0.72)
	return clampf(normalized * gamepad_sensitivity, 0.0, 1.0)

func gamepad_direction(device_id: int = -1) -> Vector2:
	var joypads := Input.get_connected_joypads()
	if joypads.is_empty():
		return Vector2.ZERO
	var target_device := device_id
	if target_device < 0:
		target_device = int(joypads[0])
	var raw := Vector2(
		Input.get_joy_axis(target_device, JOY_AXIS_LEFT_X),
		Input.get_joy_axis(target_device, JOY_AXIS_LEFT_Y)
	)
	if raw.length() <= gamepad_deadzone:
		return Vector2.ZERO
	var curved_strength := curve_value(raw.length())
	return raw.normalized() * curved_strength

func cycle_binding(action: StringName, delta: int = 1) -> Dictionary:
	if not REQUIRED_ACTIONS.has(action):
		last_validation_errors = ["unsupported action %s" % String(action)]
		return {"ok": false, "reason": "unsupported_action"}
	var presets: Array = REBIND_PRESETS.get(action, [])
	if presets.is_empty():
		return {"ok": false, "reason": "preset_missing"}
	var current: Array[int] = action_keycodes(action)
	var first_key := int(current[0]) if not current.is_empty() else 0
	var preset_index := presets.find(first_key)
	var next_index := wrapi(preset_index + delta, 0, presets.size())
	var next_key := int(presets[next_index])
	var ok := rebind_action(action, [next_key])
	return {"ok": ok, "action": String(action), "keycode": next_key, "key": OS.get_keycode_string(next_key)}

func summary() -> String:
	return "%s map %s %s %s %s pad %s %.0f dz %.0f" % [
		profile_name(),
		"%s conflicts %s" % [validation_summary(), conflict_summary()],
		action_summary(&"shoot"),
		action_summary(&"bomb"),
		action_summary(&"focus"),
		gamepad_curve(),
		gamepad_sensitivity * 100.0,
		gamepad_deadzone * 100.0,
	]

func _ensure_action(action: StringName) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)

func _key_event(keycode: int) -> InputEventKey:
	var event := InputEventKey.new()
	event.keycode = keycode
	return event
