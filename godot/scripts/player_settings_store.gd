class_name PlayerSettingsStore
extends RefCounted

const SETTINGS_VERSION := 2
const DEFAULT_PATH := "user://settings/player_settings.json"

var path := DEFAULT_PATH
var last_status := "not_loaded"
var last_error := ""

func configure(settings_path: String = DEFAULT_PATH) -> void:
	path = settings_path

func exists() -> bool:
	return FileAccess.file_exists(path)

func save(input_profile: RefCounted, audio_settings: RefCounted, display_settings: RefCounted, accessibility_settings: RefCounted, localization: RefCounted = null) -> Dictionary:
	var snapshot := build_snapshot(input_profile, audio_settings, display_settings, accessibility_settings, localization)
	var directory := path.get_base_dir()
	if not DirAccess.dir_exists_absolute(directory):
		var dir_result := DirAccess.make_dir_recursive_absolute(directory)
		if dir_result != OK:
			last_status = "save_failed"
			last_error = "dir_%d" % dir_result
			return {"ok": false, "status": last_status, "error": last_error, "path": path}
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		last_status = "save_failed"
		last_error = "open_%d" % FileAccess.get_open_error()
		return {"ok": false, "status": last_status, "error": last_error, "path": path}
	file.store_string(JSON.stringify(snapshot, "\t"))
	file.close()
	last_status = "saved"
	last_error = ""
	return {"ok": true, "status": last_status, "path": path, "version": SETTINGS_VERSION}

func load(input_profile: RefCounted, audio_settings: RefCounted, display_settings: RefCounted, accessibility_settings: RefCounted, localization: RefCounted = null) -> Dictionary:
	if not FileAccess.file_exists(path):
		last_status = "missing"
		last_error = ""
		return {"ok": false, "status": last_status, "path": path}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		last_status = "load_failed"
		last_error = "open_%d" % FileAccess.get_open_error()
		return {"ok": false, "status": last_status, "error": last_error, "path": path}
	var text := file.get_as_text()
	file.close()
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		last_status = "invalid_json"
		last_error = "parse"
		return {"ok": false, "status": last_status, "error": last_error, "path": path}
	var applied := apply_snapshot(parsed as Dictionary, input_profile, audio_settings, display_settings, accessibility_settings, localization)
	last_status = "loaded" if bool(applied.get("ok", false)) else String(applied.get("status", "apply_failed"))
	last_error = String(applied.get("error", ""))
	applied["path"] = path
	return applied

func build_snapshot(input_profile: RefCounted, audio_settings: RefCounted, display_settings: RefCounted, accessibility_settings: RefCounted, localization: RefCounted = null) -> Dictionary:
	var input := {}
	if input_profile != null:
		var bindings := {}
		for action in input_profile.REQUIRED_ACTIONS:
			var keycodes: Array = input_profile.action_keycodes(action)
			bindings[String(action)] = keycodes.duplicate()
		input = {
			"profile": input_profile.profile_name(),
			"applied_profile": String(input_profile.get("applied_profile_name")),
			"bindings": bindings,
			"gamepad_curve_index": int(input_profile.get("gamepad_curve_index")),
			"gamepad_sensitivity": float(input_profile.get("gamepad_sensitivity")),
			"gamepad_deadzone": float(input_profile.get("gamepad_deadzone")),
			"gamepad_vibration": float(input_profile.get("gamepad_vibration")),
		}
	var audio := {}
	if audio_settings != null:
		audio = {
			"volumes": (audio_settings.get("volumes") as Dictionary).duplicate(true),
			"event_visual_cues": bool(audio_settings.get("event_visual_cues")),
			"high_frequency_graze_audio": bool(audio_settings.get("high_frequency_graze_audio")),
			"voice_locale": String(audio_settings.get("voice_locale")),
		}
	var language := {}
	if localization != null:
		language = {
			"locale": String(localization.get("locale")),
		}
	var display := {}
	if display_settings != null:
		display = {
			"resolution_index": int(display_settings.get("resolution_index")),
			"window_mode_index": int(display_settings.get("window_mode_index")),
			"vsync_enabled": bool(display_settings.get("vsync_enabled")),
			"fps_limit_index": int(display_settings.get("fps_limit_index")),
			"screen_shake": float(display_settings.get("screen_shake")),
			"background_dim": float(display_settings.get("background_dim")),
		}
	var accessibility := {}
	if accessibility_settings != null:
		accessibility = {
			"low_flash": bool(accessibility_settings.get("low_flash")),
			"simplified_background": bool(accessibility_settings.get("simplified_background")),
			"always_show_hitbox": bool(accessibility_settings.get("always_show_hitbox")),
			"practice_graze_ring": bool(accessibility_settings.get("practice_graze_ring")),
			"bullet_alpha": float(accessibility_settings.get("bullet_alpha")),
			"palette_index": int(accessibility_settings.get("palette_index")),
		}
	return {
		"version": SETTINGS_VERSION,
		"input": input,
		"language": language,
		"audio": audio,
		"display": display,
		"accessibility": accessibility,
	}

func apply_snapshot(snapshot: Dictionary, input_profile: RefCounted, audio_settings: RefCounted, display_settings: RefCounted, accessibility_settings: RefCounted, localization: RefCounted = null) -> Dictionary:
	if int(snapshot.get("version", SETTINGS_VERSION)) > SETTINGS_VERSION:
		return {"ok": false, "status": "unsupported_version", "error": "version"}
	if input_profile != null and typeof(snapshot.get("input", {})) == TYPE_DICTIONARY:
		_apply_input(snapshot.get("input", {}) as Dictionary, input_profile)
	if localization != null and typeof(snapshot.get("language", {})) == TYPE_DICTIONARY:
		_apply_language(snapshot.get("language", {}) as Dictionary, localization)
	if audio_settings != null and typeof(snapshot.get("audio", {})) == TYPE_DICTIONARY:
		_apply_audio(snapshot.get("audio", {}) as Dictionary, audio_settings)
	if display_settings != null and typeof(snapshot.get("display", {})) == TYPE_DICTIONARY:
		_apply_display(snapshot.get("display", {}) as Dictionary, display_settings)
	if accessibility_settings != null and typeof(snapshot.get("accessibility", {})) == TYPE_DICTIONARY:
		_apply_accessibility(snapshot.get("accessibility", {}) as Dictionary, accessibility_settings)
	return {"ok": true, "status": "loaded", "version": int(snapshot.get("version", SETTINGS_VERSION))}

func _apply_input(data: Dictionary, input_profile: RefCounted) -> void:
	var profile := String(data.get("profile", input_profile.profile_name()))
	input_profile.apply_profile(profile)
	var curve_index := clampi(int(data.get("gamepad_curve_index", input_profile.DEFAULT_GAMEPAD_CURVE_INDEX)), 0, input_profile.GAMEPAD_CURVES.size() - 1)
	input_profile.set("gamepad_curve_index", curve_index)
	input_profile.set("gamepad_sensitivity", clampf(float(data.get("gamepad_sensitivity", input_profile.DEFAULT_GAMEPAD_SENSITIVITY)), 0.30, 1.50))
	input_profile.set("gamepad_deadzone", clampf(float(data.get("gamepad_deadzone", input_profile.DEFAULT_GAMEPAD_DEADZONE)), 0.02, 0.45))
	input_profile.set("gamepad_vibration", clampf(float(data.get("gamepad_vibration", input_profile.DEFAULT_GAMEPAD_VIBRATION)), 0.0, 1.0))
	if typeof(data.get("bindings", {})) != TYPE_DICTIONARY:
		return
	var bindings: Dictionary = data.get("bindings", {})
	for action in input_profile.REQUIRED_ACTIONS:
		var action_text := String(action)
		if not bindings.has(action_text):
			continue
		var keycodes := _int_array(bindings.get(action_text, []))
		if not keycodes.is_empty():
			input_profile.rebind_action(action, keycodes)
	input_profile.validate_actions()

func _apply_language(data: Dictionary, localization: RefCounted) -> void:
	var locale := String(data.get("locale", localization.get("locale")))
	if localization.has_method("set_locale"):
		localization.set_locale(locale)
	else:
		localization.set("locale", locale)

func _apply_audio(data: Dictionary, audio_settings: RefCounted) -> void:
	if typeof(data.get("volumes", {})) == TYPE_DICTIONARY:
		var volumes: Dictionary = data.get("volumes", {})
		for group in audio_settings.GROUPS:
			if volumes.has(group):
				audio_settings.set_volume(group, float(volumes.get(group, audio_settings.volume_for(group))))
	audio_settings.set("event_visual_cues", bool(data.get("event_visual_cues", audio_settings.DEFAULT_EVENT_VISUAL_CUES)))
	audio_settings.set("high_frequency_graze_audio", bool(data.get("high_frequency_graze_audio", audio_settings.DEFAULT_HIGH_FREQUENCY_GRAZE_AUDIO)))
	if audio_settings.has_method("set_voice_locale"):
		audio_settings.set_voice_locale(String(data.get("voice_locale", audio_settings.DEFAULT_VOICE_LOCALE)))

func _apply_display(data: Dictionary, display_settings: RefCounted) -> void:
	display_settings.set("resolution_index", clampi(int(data.get("resolution_index", display_settings.DEFAULT_RESOLUTION_INDEX)), 0, display_settings.RESOLUTION_PRESETS.size() - 1))
	display_settings.set("window_mode_index", clampi(int(data.get("window_mode_index", display_settings.DEFAULT_WINDOW_MODE_INDEX)), 0, display_settings.WINDOW_MODES.size() - 1))
	display_settings.set("vsync_enabled", bool(data.get("vsync_enabled", display_settings.DEFAULT_VSYNC_ENABLED)))
	display_settings.set("fps_limit_index", clampi(int(data.get("fps_limit_index", display_settings.DEFAULT_FPS_LIMIT_INDEX)), 0, display_settings.FPS_LIMITS.size() - 1))
	display_settings.set("screen_shake", clampf(float(data.get("screen_shake", display_settings.DEFAULT_SCREEN_SHAKE)), 0.0, 1.0))
	display_settings.set("background_dim", clampf(float(data.get("background_dim", display_settings.DEFAULT_BACKGROUND_DIM)), 0.0, 0.85))
	display_settings.validate()

func _apply_accessibility(data: Dictionary, accessibility_settings: RefCounted) -> void:
	accessibility_settings.set("low_flash", bool(data.get("low_flash", accessibility_settings.DEFAULT_LOW_FLASH)))
	accessibility_settings.set("simplified_background", bool(data.get("simplified_background", accessibility_settings.DEFAULT_SIMPLIFIED_BACKGROUND)))
	accessibility_settings.set("always_show_hitbox", bool(data.get("always_show_hitbox", accessibility_settings.DEFAULT_ALWAYS_SHOW_HITBOX)))
	accessibility_settings.set("practice_graze_ring", bool(data.get("practice_graze_ring", accessibility_settings.DEFAULT_PRACTICE_GRAZE_RING)))
	accessibility_settings.set("bullet_alpha", clampf(float(data.get("bullet_alpha", accessibility_settings.DEFAULT_BULLET_ALPHA)), 0.35, 1.0))
	accessibility_settings.set("palette_index", clampi(int(data.get("palette_index", accessibility_settings.DEFAULT_PALETTE_INDEX)), 0, accessibility_settings.PALETTE_NAMES.size() - 1))

func _int_array(source: Variant) -> Array[int]:
	var result: Array[int] = []
	if typeof(source) != TYPE_ARRAY:
		return result
	for item in source as Array:
		var value := int(item)
		if value > 0 and not result.has(value):
			result.append(value)
	return result
