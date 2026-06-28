class_name DisplaySettings
extends RefCounted

const RESOLUTION_PRESETS: Array[Vector2i] = [
	Vector2i(1280, 720),
	Vector2i(1600, 900),
	Vector2i(1920, 1080),
	Vector2i(2560, 1440),
]
const WINDOW_MODES: Array[String] = ["windowed", "borderless", "fullscreen"]
const FPS_LIMITS: Array[int] = [60, 120, 144, 240]
const DEFAULT_RESOLUTION_INDEX := 2
const DEFAULT_WINDOW_MODE_INDEX := 0
const DEFAULT_VSYNC_ENABLED := true
const DEFAULT_FPS_LIMIT_INDEX := 0
const DEFAULT_SCREEN_SHAKE := 0.35
const DEFAULT_BACKGROUND_DIM := 0.25

var resolution_index := DEFAULT_RESOLUTION_INDEX
var window_mode_index := DEFAULT_WINDOW_MODE_INDEX
var vsync_enabled := DEFAULT_VSYNC_ENABLED
var fps_limit_index := DEFAULT_FPS_LIMIT_INDEX
var screen_shake := DEFAULT_SCREEN_SHAKE
var background_dim := DEFAULT_BACKGROUND_DIM
var last_validation_errors: Array[String] = []

func resolution() -> Vector2i:
	return RESOLUTION_PRESETS[resolution_index]

func resolution_text() -> String:
	var value := resolution()
	return "%dx%d" % [value.x, value.y]

func window_mode() -> String:
	return WINDOW_MODES[window_mode_index]

func fps_limit() -> int:
	return FPS_LIMITS[fps_limit_index]

func resolution_options() -> Array[String]:
	var options: Array[String] = []
	for preset in RESOLUTION_PRESETS:
		options.append("%dx%d" % [preset.x, preset.y])
	return options

func window_mode_options() -> Array[String]:
	return WINDOW_MODES.duplicate()

func fps_limit_options() -> Array[int]:
	return FPS_LIMITS.duplicate()

func cycle_resolution(delta: int = 1) -> String:
	resolution_index = wrapi(resolution_index + delta, 0, RESOLUTION_PRESETS.size())
	return resolution_text()

func cycle_window_mode(delta: int = 1) -> String:
	window_mode_index = wrapi(window_mode_index + delta, 0, WINDOW_MODES.size())
	return window_mode()

func toggle_vsync() -> bool:
	vsync_enabled = not vsync_enabled
	return vsync_enabled

func cycle_fps_limit(delta: int = 1) -> int:
	fps_limit_index = wrapi(fps_limit_index + delta, 0, FPS_LIMITS.size())
	return fps_limit()

func adjust_screen_shake(delta: float) -> float:
	screen_shake = clampf(screen_shake + delta, 0.0, 1.0)
	return screen_shake

func adjust_background_dim(delta: float) -> float:
	background_dim = clampf(background_dim + delta, 0.0, 0.85)
	return background_dim

func reset_resolution() -> String:
	resolution_index = DEFAULT_RESOLUTION_INDEX
	return resolution_text()

func reset_window_mode() -> String:
	window_mode_index = DEFAULT_WINDOW_MODE_INDEX
	return window_mode()

func reset_vsync() -> bool:
	vsync_enabled = DEFAULT_VSYNC_ENABLED
	return vsync_enabled

func reset_fps_limit() -> int:
	fps_limit_index = DEFAULT_FPS_LIMIT_INDEX
	return fps_limit()

func reset_screen_shake() -> float:
	screen_shake = DEFAULT_SCREEN_SHAKE
	return screen_shake

func reset_background_dim() -> float:
	background_dim = DEFAULT_BACKGROUND_DIM
	return background_dim

func reset_all() -> Dictionary:
	return {
		"resolution": reset_resolution(),
		"window_mode": reset_window_mode(),
		"vsync": reset_vsync(),
		"fps_limit": reset_fps_limit(),
		"screen_shake": reset_screen_shake(),
		"background_dim": reset_background_dim(),
	}

func validate() -> bool:
	last_validation_errors.clear()
	if resolution_index < 0 or resolution_index >= RESOLUTION_PRESETS.size():
		last_validation_errors.append("resolution_index")
	if window_mode_index < 0 or window_mode_index >= WINDOW_MODES.size():
		last_validation_errors.append("window_mode_index")
	if fps_limit_index < 0 or fps_limit_index >= FPS_LIMITS.size():
		last_validation_errors.append("fps_limit_index")
	if screen_shake < 0.0 or screen_shake > 1.0:
		last_validation_errors.append("screen_shake")
	if background_dim < 0.0 or background_dim > 0.85:
		last_validation_errors.append("background_dim")
	return last_validation_errors.is_empty()

func rows() -> Array[Dictionary]:
	return [
		{"id": "display_resolution", "label_key": "screen.settings.display", "value": resolution_text(), "control_options": resolution_options(), "control_option_index": resolution_index, "ui_action": "cycle_resolution", "enabled": true},
		{"id": "display_window_mode", "label_key": "screen.settings.display", "value": window_mode(), "control_options": window_mode_options(), "control_option_index": window_mode_index, "ui_action": "cycle_window_mode", "enabled": true},
		{"id": "display_vsync", "label_key": "screen.settings.display", "value": "on" if vsync_enabled else "off", "control_value": vsync_enabled, "ui_action": "toggle_vsync", "enabled": true},
		{"id": "display_fps_limit", "label_key": "screen.settings.display", "value": "%d" % fps_limit(), "control_options": fps_limit_options(), "control_option_index": fps_limit_index, "ui_action": "cycle_fps_limit", "enabled": true},
		{"id": "display_screen_shake", "label_key": "screen.settings.display", "value": "%.0f%%" % (screen_shake * 100.0), "control_value": screen_shake, "control_min": 0.0, "control_max": 1.0, "control_step": 0.05, "control_unit": "percent", "ui_action": "adjust_screen_shake", "delta": 0.05, "enabled": true},
		{"id": "display_background_dim", "label_key": "screen.settings.display", "value": "%.0f%%" % (background_dim * 100.0), "control_value": background_dim, "control_min": 0.0, "control_max": 0.85, "control_step": 0.05, "control_unit": "percent", "ui_action": "adjust_background_dim", "delta": 0.05, "enabled": true},
	]

func summary() -> String:
	return "%s %s vsync %s fps %d shake %.0f dim %.0f" % [
		resolution_text(),
		window_mode(),
		"on" if vsync_enabled else "off",
		fps_limit(),
		screen_shake * 100.0,
		background_dim * 100.0,
	]
