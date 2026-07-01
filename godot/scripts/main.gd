extends Node2D

const PLAYFIELD := Rect2(Vector2(160, 48), Vector2(640, 624))
const TICK_RATE := 60.0
const FIXED_DELTA := 1.0 / TICK_RATE
const MAX_FRAME_TICKS := 4
const DEFAULT_MATCH_SEED := 20260625
const BASE_LOBBY_STANDEE := "res://themes/base/ui/lobby_standee.svg"
const BulletMathLib := preload("res://scripts/bullet_math.gd")
const BulletPatterns := preload("res://scripts/bullet_pattern_library.gd")
const BulletEngineLib := preload("res://scripts/bullet_engine.gd")
const InputCodecLib := preload("res://scripts/input_codec.gd")
const ReplayRecorderLib := preload("res://scripts/replay_recorder.gd")
const ReplayStoreLib := preload("res://scripts/replay_store.gd")
const CardSystemLib := preload("res://scripts/card_system.gd")
const PerformanceStatsLib := preload("res://scripts/performance_stats.gd")
const AccessibilitySettingsLib := preload("res://scripts/accessibility_settings.gd")
const InputProfileLib := preload("res://scripts/input_profile.gd")
const LocalizationLib := preload("res://scripts/localization.gd")
const ThemeRegistryLib := preload("res://scripts/theme_registry.gd")
const ReplayListModelLib := preload("res://scripts/replay_list_model.gd")
const AudioSettingsLib := preload("res://scripts/audio_settings.gd")
const DisplaySettingsLib := preload("res://scripts/display_settings.gd")
const SocialHubModelLib := preload("res://scripts/social_hub_model.gd")
const DeckBuilderModelLib := preload("res://scripts/deck_builder_model.gd")
const UIScreenModelLib := preload("res://scripts/ui_screen_model.gd")
const ChestSystemLib := preload("res://scripts/chest_system.gd")
const MatchmakingModelLib := preload("res://scripts/matchmaking_model.gd")
const NetworkMatchModelLib := preload("res://scripts/network_match_model.gd")
const GensoulkyoApiModelLib := preload("res://scripts/gensoulkyo_api_model.gd")
const GensoulkyoHttpClientLib := preload("res://scripts/gensoulkyo_http_client.gd")
const GameModeModelLib := preload("res://scripts/game_mode_model.gd")
const ResultsServiceModelLib := preload("res://scripts/results_service_model.gd")
const CharacterModelLib := preload("res://scripts/character_model.gd")
const BulletVisualModelLib := preload("res://scripts/bullet_visual_model.gd")
const BalanceSimulationModelLib := preload("res://scripts/balance_simulation_model.gd")
const LatencyTestModelLib := preload("res://scripts/latency_test_model.gd")
const StageSelectModelLib := preload("res://scripts/stage_select_model.gd")
const PatternLabModelLib := preload("res://scripts/pattern_lab_model.gd")
const BossSpellbookModelLib := preload("res://scripts/boss_spellbook_model.gd")
const ClientShellModelLib := preload("res://scripts/client_shell_model.gd")
const ClientMenuPageModelLib := preload("res://scripts/client_menu_page_model.gd")
const PlayerSettingsStoreLib := preload("res://scripts/player_settings_store.gd")
const NetworkSecurityModelLib := preload("res://scripts/network_security_model.gd")
const ProtocolDescriptorModelLib := preload("res://scripts/protocol_descriptor_model.gd")
const BattleNetworkClientModelLib := preload("res://scripts/battle_network_client_model.gd")

const PLAYER_SPEED := 330.0
const FOCUS_SPEED := 145.0
const HIT_RADIUS := 4.0
const GRAZE_RADIUS := 22.0
const MAX_BULLETS := 1400
const PLAYER_SHOT_INTERVAL_TICKS := 5
const PLAYER_SHOT_SPEED := 620.0
const PLAYER_SHOT_RADIUS := 3.5
const STAGE_RUN_PHASE_TICKS := 600
const TARGET_RADIUS := 28.0
const BOMB_RADIUS := 190.0
const BOMB_INVULN_TICKS := 78
const HIT_INVULN_TICKS := 105
const DEATHBOMB_WINDOW_TICKS := 6
const PICKUP_LINE_Y := 190.0
const REPLAY_SPEEDS: Array[float] = [0.5, 1.0, 2.0, 4.0]

var player_pos := Vector2(480, 600)
var target_pos := Vector2(480, 116)
var practice_seed := DEFAULT_MATCH_SEED
var active_match_seed := DEFAULT_MATCH_SEED
var practice_start_tick := 0
var practice_initial_power := 1.0
var practice_initial_bombs := 3
var practice_prewarping := false
var stage_run_enabled := false
var stage_run_start_tick := 0
var stage_run_phase_index := 0
var stage_run_phase_tick := 0
var stage_run_phase_count := 0
var boss_spellbook_run_enabled := false
var boss_spellbook_run_start_tick := 0
var boss_spellbook_run_tick := 0
var boss_spellbook_id := "original_boss_archive"
var bullets: Array[Dictionary] = []
var player_shots: Array[Dictionary] = []
var tick := 0
var accumulator := 0.0
var spawn_index := 0
var shot_spawn_index := 0
var graze_count := 0
var hit_count := 0
var bomb_count := 3
var bomb_used := 0
var invuln_ticks := 90
var deathbomb_ticks := 0
var pending_death_hit := false
var pending_hit_pattern_id := ""
var power := 1.0
var score := 0
var multiplier := 1.0
var combo := 0
var max_combo := 0
var target_damage := 0
var delayed_spawn_count := 0
var active_modifiers := {}
var tab_was_pressed := false
var replay_recorder: RefCounted
var card_system: RefCounted
var performance_stats: RefCounted
var accessibility_settings: RefCounted
var input_profile: RefCounted
var localization: RefCounted
var theme_registry: RefCounted
var replay_list_model: RefCounted
var audio_settings: RefCounted
var display_settings: RefCounted
var social_hub_model: RefCounted
var deck_builder: RefCounted
var ui_screen_model: RefCounted
var chest_system: RefCounted
var matchmaking_model: RefCounted
var network_match_model: RefCounted
var gensoulkyo_api_model: RefCounted
var gensoulkyo_http_client: Node
var game_mode_model: RefCounted
var results_service_model: RefCounted
var character_model: RefCounted
var bullet_visual_model: RefCounted
var balance_simulation_model: RefCounted
var latency_test_model: RefCounted
var stage_select_model: RefCounted
var pattern_lab_model: RefCounted
var boss_spellbook_model: RefCounted
var client_shell_model: RefCounted
var client_menu_page_model: RefCounted
var player_settings_store: RefCounted
var network_security_model: RefCounted
var protocol_descriptor_model: RefCounted
var battle_network_client_model: RefCounted
var pattern_modifiers := {}
var self_modifiers := {}
var replay_snapshot := {}
var replay_mode := false
var replay_paused := false
var replay_speed_index := 1
var replay_validation_failed := false
var replay_first_mismatch_tick := 0
var replay_seek_target_tick := 0
var replay_seek_status := "none"
var replay_final_hash_status := "pending"
var replay_expected_final_hash := 0
var replay_actual_final_hash := 0
var show_bullet_hitboxes := false
var show_event_log := false
var show_debug_overlay := false
var show_performance_stats := false
var last_input_state: Dictionary = {}
var debug_key_latches := {}
var replay_store: RefCounted
var replay_file_status := "none"
var replay_file_path := ""
var replay_index_entries: Array[Dictionary] = []
var replay_index_cursor := 0
var replay_index_status := "empty"
var replay_index_action_status := "none"
var ui_overlay_visible := true
var ui_nav_row_labels: Array[Button] = []
var ui_row_labels: Array[Button] = []
var ui_category_tabs_box: HBoxContainer = null
var ui_category_buttons: Array[Button] = []
var ui_section_buttons: Array[Button] = []
var ui_title_label: Label = null
var ui_nav_label: Label = null
var ui_shell_label: Label = null
var ui_page_summary_label: Label = null
var ui_status_cards_box: GridContainer = null
var ui_status_cards: Array[Button] = []
var ui_focus_button: Button = null
var ui_section_label: Label = null
var ui_section_tabs_box: HBoxContainer = null
var ui_overview_cards_box: GridContainer = null
var ui_overview_buttons: Array[Button] = []
var ui_quick_actions_box: HBoxContainer = null
var ui_quick_buttons: Array[Button] = []
var ui_control_label: Label = null
var ui_control_buttons_box: HBoxContainer = null
var ui_control_buttons: Array[Button] = []
var ui_status_label: Label = null
var ui_detail_label: Label = null
var ui_hint_label: Label = null
var ui_panel: PanelContainer = null
var ui_root_box: HBoxContainer = null
var ui_home_box: BoxContainer = null
var ui_home_portrait_panel: PanelContainer = null
var ui_home_portrait_art: TextureRect = null
var ui_home_portrait_label: Label = null
var ui_home_title_label: Label = null
var ui_home_status_label: Label = null
var ui_home_dashboard_box: GridContainer = null
var ui_home_dashboard_buttons: Array[Button] = []
var ui_home_menu_box: VBoxContainer = null
var ui_home_buttons_box: VBoxContainer = null
var ui_home_buttons: Array[Button] = []
var ui_nav_box: VBoxContainer = null
var ui_content_box: VBoxContainer = null
var ui_rows_box: VBoxContainer = null
var ui_scene_roots := {}
var ui_scene_mounts := {}
var ui_scene_binding_counts := {}
var ui_scene_missing_bindings := {}
var ui_active_scene_id := ""
var last_applied_resolution := Vector2i.ZERO
var last_applied_window_mode := ""
var last_applied_vsync := false
var last_applied_fps_limit := -1
var audio_bus_indices := {}
var input_capture_active := false
var input_capture_action := StringName()
var input_capture_keycode := 0
var input_capture_status := "idle"

var pattern_configs: Array[Dictionary] = []

@onready var hud := Label.new()

func _ready() -> void:
	replay_recorder = ReplayRecorderLib.new()
	replay_recorder.configure(practice_seed)
	replay_store = ReplayStoreLib.new()
	replay_list_model = ReplayListModelLib.new()
	replay_list_model.configure(replay_store)
	replay_file_path = replay_store.latest_path()
	replay_file_status = "found" if replay_store.latest_exists() else "none"
	_refresh_replay_index()
	deck_builder = DeckBuilderModelLib.new()
	matchmaking_model = MatchmakingModelLib.new()
	matchmaking_model.configure(deck_builder)
	network_match_model = NetworkMatchModelLib.new()
	network_match_model.configure(matchmaking_model)
	gensoulkyo_api_model = GensoulkyoApiModelLib.new()
	gensoulkyo_api_model.configure()
	gensoulkyo_http_client = GensoulkyoHttpClientLib.new()
	gensoulkyo_http_client.name = "GensoulkyoHttpClient"
	add_child(gensoulkyo_http_client)
	gensoulkyo_http_client.configure(gensoulkyo_api_model, matchmaking_model, network_match_model, results_service_model, deck_builder)
	game_mode_model = GameModeModelLib.new()
	game_mode_model.configure(matchmaking_model, network_match_model)
	chest_system = ChestSystemLib.new()
	chest_system.configure(deck_builder)
	results_service_model = ResultsServiceModelLib.new()
	results_service_model.configure(chest_system, deck_builder)
	gensoulkyo_http_client.configure(gensoulkyo_api_model, matchmaking_model, network_match_model, results_service_model, deck_builder, game_mode_model, chest_system)
	card_system = CardSystemLib.new()
	_configure_card_system_from_active_deck()
	performance_stats = PerformanceStatsLib.new()
	accessibility_settings = AccessibilitySettingsLib.new()
	audio_settings = AudioSettingsLib.new()
	display_settings = DisplaySettingsLib.new()
	social_hub_model = SocialHubModelLib.new()
	input_profile = InputProfileLib.new()
	input_profile.apply_current_profile()
	player_settings_store = PlayerSettingsStoreLib.new()
	player_settings_store.configure()
	theme_registry = ThemeRegistryLib.new()
	localization = LocalizationLib.new()
	localization.load_defaults(localization.locale, theme_registry.active_theme_id)
	_load_player_settings()
	_ensure_audio_buses()
	_apply_audio_settings()
	_apply_display_settings(true)
	character_model = CharacterModelLib.new()
	bullet_visual_model = BulletVisualModelLib.new()
	stage_select_model = StageSelectModelLib.new()
	pattern_lab_model = PatternLabModelLib.new()
	pattern_lab_model.configure(stage_select_model)
	boss_spellbook_model = BossSpellbookModelLib.new()
	if game_mode_model.has_method("configure_boss_spellbook"):
		game_mode_model.configure_boss_spellbook(boss_spellbook_model)
	if pattern_lab_model.has_method("configure_boss_spellbook"):
		pattern_lab_model.configure_boss_spellbook(boss_spellbook_model)
	_refresh_pattern_configs_from_stage()
	balance_simulation_model = BalanceSimulationModelLib.new()
	_configure_balance_simulation_model()
	latency_test_model = LatencyTestModelLib.new()
	_configure_latency_test_model()
	protocol_descriptor_model = ProtocolDescriptorModelLib.new()
	protocol_descriptor_model.load_descriptor()
	battle_network_client_model = BattleNetworkClientModelLib.new()
	battle_network_client_model.configure(network_match_model, protocol_descriptor_model)
	network_security_model = NetworkSecurityModelLib.new()
	network_security_model.configure({
		"gensoulkyo_api_model": gensoulkyo_api_model,
		"matchmaking_model": matchmaking_model,
		"network_match_model": network_match_model,
		"battle_network_client_model": battle_network_client_model,
	})
	client_shell_model = ClientShellModelLib.new()
	client_shell_model.configure({
		"matchmaking_model": matchmaking_model,
		"game_mode_model": game_mode_model,
		"social_hub_model": social_hub_model,
		"input_profile": input_profile,
		"audio_settings": audio_settings,
		"display_settings": display_settings,
		"deck_builder": deck_builder,
		"results_service_model": results_service_model,
		"network_security_model": network_security_model,
		"battle_network_client_model": battle_network_client_model,
	})
	client_menu_page_model = ClientMenuPageModelLib.new()
	_load_active_theme_text()
	ui_screen_model = UIScreenModelLib.new()
	ui_screen_model.configure({
		"deck_builder": deck_builder,
		"replay_list_model": replay_list_model,
		"accessibility_settings": accessibility_settings,
		"input_profile": input_profile,
		"audio_settings": audio_settings,
		"localization": localization,
		"display_settings": display_settings,
		"social_hub_model": social_hub_model,
		"theme_registry": theme_registry,
		"chest_system": chest_system,
		"matchmaking_model": matchmaking_model,
		"network_match_model": network_match_model,
		"gensoulkyo_api_model": gensoulkyo_api_model,
		"gensoulkyo_http_client": gensoulkyo_http_client,
		"game_mode_model": game_mode_model,
		"results_service_model": results_service_model,
		"character_model": character_model,
		"bullet_visual_model": bullet_visual_model,
		"stage_select_model": stage_select_model,
		"pattern_lab_model": pattern_lab_model,
		"boss_spellbook_model": boss_spellbook_model,
		"balance_simulation_model": balance_simulation_model,
		"latency_test_model": latency_test_model,
		"client_shell_model": client_shell_model,
		"network_security_model": network_security_model,
		"protocol_descriptor_model": protocol_descriptor_model,
		"battle_network_client_model": battle_network_client_model,
		"player_settings_store": player_settings_store,
		"client_menu_page_model": client_menu_page_model,
	})
	add_child(hud)
	hud.position = Vector2(18, 14)
	hud.add_theme_font_size_override("font_size", 16)
	_build_ui_overlay()
	queue_redraw()

func _process(delta: float) -> void:
	if Input.is_action_just_pressed("ui_cancel"):
		if _ui_back_or_quit():
			return
		get_tree().quit()

	_handle_debug_controls()
	if replay_paused:
		_apply_runtime_settings()
		_update_hud()
		queue_redraw()
		return
	var frame_ticks := 0
	if _should_advance_gameplay_tick():
		accumulator += delta * REPLAY_SPEEDS[replay_speed_index]
		while accumulator >= FIXED_DELTA and frame_ticks < MAX_FRAME_TICKS:
			_fixed_tick()
			accumulator -= FIXED_DELTA
			frame_ticks += 1
		if frame_ticks == MAX_FRAME_TICKS:
			accumulator = min(accumulator, FIXED_DELTA)
	else:
		accumulator = 0.0
	performance_stats.record_frame(delta, FIXED_DELTA, frame_ticks, MAX_FRAME_TICKS)
	_apply_runtime_settings()

	_update_hud()
	queue_redraw()

func _input(event: InputEvent) -> void:
	if not input_capture_active:
		return
	if event is InputEventKey and bool((event as InputEventKey).pressed) and not bool((event as InputEventKey).echo):
		var keycode := int((event as InputEventKey).keycode)
		if keycode == KEY_ESCAPE:
			_cancel_input_capture()
		else:
			_commit_input_capture(keycode)
		get_viewport().set_input_as_handled()

func _load_player_settings() -> Dictionary:
	if player_settings_store == null:
		return {"ok": false, "status": "missing_store"}
	var result: Dictionary = player_settings_store.load(input_profile, audio_settings, display_settings, accessibility_settings, localization)
	if bool(result.get("ok", false)):
		input_capture_status = "loaded"
		_load_active_theme_text()
	else:
		input_capture_status = String(result.get("status", "missing"))
	return result

func _save_player_settings() -> Dictionary:
	if player_settings_store == null:
		return {"ok": false, "status": "missing_store"}
	var result: Dictionary = player_settings_store.save(input_profile, audio_settings, display_settings, accessibility_settings, localization)
	input_capture_status = String(result.get("status", "save_failed"))
	return result

func _note_player_setting_changed() -> void:
	_save_player_settings()

func _restore_default_player_settings() -> Dictionary:
	if input_profile != null:
		input_profile.reset_profile()
		input_profile.reset_gamepad_settings()
	if audio_settings != null:
		audio_settings.reset_all()
	if localization != null:
		localization.set_locale(LocalizationLib.DEFAULT_LOCALE)
	if display_settings != null:
		display_settings.reset_all()
	if accessibility_settings != null:
		accessibility_settings.reset_all()
	_apply_audio_settings()
	_apply_display_settings(true)
	var save_result: Dictionary = _save_player_settings()
	return {
		"ok": bool(save_result.get("ok", false)),
		"status": "defaults_saved" if bool(save_result.get("ok", false)) else String(save_result.get("status", "save_failed")),
		"save_status": String(save_result.get("status", "")),
		"path": String(save_result.get("path", "")),
	}

func _handle_debug_controls() -> void:
	for i in range(min(6, pattern_configs.size())):
		if Input.is_key_pressed(KEY_F1 + i):
			_set_demo_index(i)
	var tab_pressed := Input.is_key_pressed(KEY_TAB)
	if tab_pressed and not tab_was_pressed:
		var next_index := 0
		if stage_select_model != null and not pattern_configs.is_empty():
			next_index = (int(stage_select_model.selected_pattern_index) + 1) % pattern_configs.size()
		_set_demo_index(next_index)
	tab_was_pressed = tab_pressed
	if Input.is_key_pressed(KEY_M):
		active_modifiers = {
			"speed_multiplier": 1.18,
			"density_multiplier": 1.28,
			"angle_offset": deg_to_rad(9.0),
			"curve_strength": 0.0,
			"aim_bias": 0.0,
		}
	else:
		active_modifiers = {}
	if Input.is_action_just_pressed("debug_restart"):
		_restart_practice()
	if _debug_key_just_pressed(KEY_P):
		_start_replay_from_recording()
	if _debug_key_just_pressed(KEY_END):
		_save_replay_snapshot()
	if _debug_key_just_pressed(KEY_INSERT):
		_load_selected_replay_snapshot()
	if _debug_key_just_pressed(KEY_N):
		_select_replay_index(1)
	if _debug_key_just_pressed(KEY_B):
		_select_replay_index(-1)
	if _debug_key_just_pressed(KEY_C):
		_toggle_selected_replay_favorite()
	if _debug_key_just_pressed(KEY_V):
		_remove_selected_replay_from_index()
	if _debug_key_just_pressed(KEY_HOME) and replay_mode:
		_restart_replay()
	if _debug_key_just_pressed(KEY_K):
		_adjust_replay_seek_target(300)
	if _debug_key_just_pressed(KEY_J):
		_adjust_replay_seek_target(-300)
	if _debug_key_just_pressed(KEY_DELETE):
		_seek_replay_to_tick(replay_seek_target_tick)
	if _debug_key_just_pressed(KEY_SPACE):
		replay_paused = not replay_paused
	if _debug_key_just_pressed(KEY_EQUAL):
		replay_speed_index = min(REPLAY_SPEEDS.size() - 1, replay_speed_index + 1)
	if _debug_key_just_pressed(KEY_MINUS):
		replay_speed_index = max(0, replay_speed_index - 1)
	if _debug_key_just_pressed(KEY_H):
		show_bullet_hitboxes = not show_bullet_hitboxes
	if _debug_key_just_pressed(KEY_L):
		show_event_log = not show_event_log
	if _debug_key_just_pressed(KEY_O):
		show_debug_overlay = not show_debug_overlay
	if _debug_key_just_pressed(KEY_I):
		show_performance_stats = not show_performance_stats
	if _debug_key_just_pressed(KEY_BRACKETLEFT):
		_set_practice_start_tick(max(0, practice_start_tick - 600))
	if _debug_key_just_pressed(KEY_BRACKETRIGHT):
		_set_practice_start_tick(practice_start_tick + 600)
	if _debug_key_just_pressed(KEY_SEMICOLON):
		_set_practice_seed(BulletMathLib.mix32(practice_seed - 1))
	if _debug_key_just_pressed(KEY_APOSTROPHE):
		_set_practice_seed(BulletMathLib.mix32(practice_seed + 1))
	if _debug_key_just_pressed(KEY_COMMA):
		practice_initial_power = max(1.0, practice_initial_power - 0.5)
		_restart_practice()
	if _debug_key_just_pressed(KEY_PERIOD):
		practice_initial_power = min(4.0, practice_initial_power + 0.5)
		_restart_practice()
	if _debug_key_just_pressed(KEY_SLASH):
		practice_initial_bombs = (practice_initial_bombs + 1) % 7
		_restart_practice()
	if _debug_key_just_pressed(KEY_F7):
		accessibility_settings.low_flash = not accessibility_settings.low_flash
	if _debug_key_just_pressed(KEY_F8):
		accessibility_settings.simplified_background = not accessibility_settings.simplified_background
	if _debug_key_just_pressed(KEY_F9):
		accessibility_settings.always_show_hitbox = not accessibility_settings.always_show_hitbox
	if _debug_key_just_pressed(KEY_F10):
		accessibility_settings.practice_graze_ring = not accessibility_settings.practice_graze_ring
	if _debug_key_just_pressed(KEY_F11):
		accessibility_settings.cycle_palette()
	if _debug_key_just_pressed(KEY_F12):
		localization.cycle_locale()
		_load_active_theme_text()
	if _debug_key_just_pressed(KEY_PAGEUP):
		accessibility_settings.adjust_bullet_alpha(0.05)
	if _debug_key_just_pressed(KEY_PAGEDOWN):
		accessibility_settings.adjust_bullet_alpha(-0.05)
	if _debug_key_just_pressed(KEY_BACKSLASH):
		input_profile.cycle_profile()
	_handle_ui_navigation_controls()

func _handle_ui_navigation_controls() -> void:
	if _is_gameplay_view_unobstructed():
		return
	if _ui_navigation_just_pressed("ui_up", KEY_UP):
		_ui_select(-1)
	if _ui_navigation_just_pressed("ui_down", KEY_DOWN):
		_ui_select(1)
	if _ui_navigation_just_pressed("ui_left", KEY_LEFT):
		_ui_adjust_selected_control(-1)
	if _ui_navigation_just_pressed("ui_right", KEY_RIGHT):
		_ui_adjust_selected_control(1)
	if _ui_navigation_just_pressed("ui_accept", KEY_ENTER):
		_ui_accept_selected()

func _ui_navigation_probe(action: String) -> Dictionary:
	var before_screen := String(ui_screen_model.current_screen if ui_screen_model != null else "")
	var before_cursor := int(ui_screen_model.cursor if ui_screen_model != null else 0)
	var result: Dictionary = {"ok": false, "action": action}
	match action:
		"up":
			_ui_select(-1)
			result["ok"] = true
		"down":
			_ui_select(1)
			result["ok"] = true
		"left":
			result = _ui_adjust_selected_control(-1)
		"right":
			result = _ui_adjust_selected_control(1)
		"accept":
			result = _ui_accept_selected()
		_:
			result = {"ok": false, "action": "navigation_probe_invalid"}
	result["before_screen"] = before_screen
	result["after_screen"] = String(ui_screen_model.current_screen if ui_screen_model != null else "")
	result["before_cursor"] = before_cursor
	result["after_cursor"] = int(ui_screen_model.cursor if ui_screen_model != null else 0)
	return result

func _ui_navigation_just_pressed(action: StringName, keycode: Key) -> bool:
	var pressed := Input.is_action_just_pressed(action)
	var key_pressed := _debug_key_just_pressed(keycode)
	return pressed or key_pressed

func _set_practice_start_tick(value: int) -> void:
	practice_start_tick = max(0, value)
	_restart_practice()

func _apply_runtime_settings() -> void:
	_apply_audio_settings()
	_apply_display_settings(false)

func _ensure_audio_buses() -> void:
	audio_bus_indices.clear()
	for group in AudioSettingsLib.GROUPS:
		var bus_name := _audio_bus_name(group)
		var bus_index := AudioServer.get_bus_index(bus_name)
		if bus_index < 0 and group != "master":
			AudioServer.add_bus()
			bus_index = AudioServer.get_bus_count() - 1
			AudioServer.set_bus_name(bus_index, bus_name)
		audio_bus_indices[group] = max(0, bus_index)

func _audio_bus_name(group: String) -> String:
	match group:
		"master":
			return "Master"
		"music":
			return "Music"
		"sfx":
			return "SFX"
		"ui":
			return "UI"
		"voice":
			return "Voice"
		_:
			return group.capitalize()

func _apply_audio_settings() -> void:
	if audio_settings == null:
		return
	if audio_bus_indices.is_empty():
		_ensure_audio_buses()
	for group in AudioSettingsLib.GROUPS:
		var bus_index := int(audio_bus_indices.get(group, -1))
		if bus_index < 0 or bus_index >= AudioServer.get_bus_count():
			continue
		var linear_volume: float = audio_settings.volume_for(group)
		AudioServer.set_bus_volume_db(bus_index, linear_to_db(maxf(0.0001, linear_volume)))
		AudioServer.set_bus_mute(bus_index, linear_volume <= 0.001)

func _apply_display_settings(force: bool = false) -> void:
	if display_settings == null:
		return
	Engine.max_fps = display_settings.fps_limit()
	if DisplayServer.get_name() == "headless":
		return
	var resolution: Vector2i = display_settings.resolution()
	var window_mode: String = display_settings.window_mode()
	if force or resolution != last_applied_resolution:
		DisplayServer.window_set_size(resolution)
		last_applied_resolution = resolution
	if force or window_mode != last_applied_window_mode:
		match window_mode:
			"fullscreen":
				DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
			"borderless":
				DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
				DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
			_:
				DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, false)
				DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
		last_applied_window_mode = window_mode
	if force or display_settings.vsync_enabled != last_applied_vsync:
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if display_settings.vsync_enabled else DisplayServer.VSYNC_DISABLED)
		last_applied_vsync = display_settings.vsync_enabled
	last_applied_fps_limit = display_settings.fps_limit()

func _activate_theme(theme_id: String) -> bool:
	if not theme_registry.activate_theme(theme_id):
		return false
	localization.load_defaults(localization.locale, theme_registry.active_theme_id)
	_load_active_theme_text()
	return true

func _load_active_theme_text() -> void:
	for path in theme_registry.text_pack_paths(localization.locale):
		localization.load_pack(path, false)

func _refresh_pattern_configs_from_stage() -> void:
	if stage_select_model == null:
		pattern_configs = []
		return
	pattern_configs = stage_select_model.active_patterns()

func _set_practice_seed(value: int) -> void:
	practice_seed = value
	_restart_practice()

func _adjust_practice_seed(delta: int) -> int:
	_set_practice_seed(BulletMathLib.mix32(practice_seed + delta))
	return practice_seed

func _adjust_practice_initial_power(delta: float) -> float:
	practice_initial_power = clampf(practice_initial_power + delta, 1.0, 4.0)
	_restart_practice()
	_update_ui_overlay()
	return practice_initial_power

func _cycle_practice_initial_bombs() -> int:
	practice_initial_bombs = (practice_initial_bombs + 1) % 7
	_restart_practice()
	_update_ui_overlay()
	return practice_initial_bombs

func _debug_key_just_pressed(keycode: Key) -> bool:
	var pressed := Input.is_key_pressed(keycode)
	var was_pressed := bool(debug_key_latches.get(keycode, false))
	debug_key_latches[keycode] = pressed
	return pressed and not was_pressed

func _set_demo_index(value: int) -> void:
	if stage_select_model == null:
		return
	stage_run_enabled = false
	_stop_boss_spellbook_run(false)
	var before_index: int = int(stage_select_model.selected_pattern_index)
	if not stage_select_model.select_pattern_index(value) or int(stage_select_model.selected_pattern_index) == before_index:
		return
	_refresh_pattern_configs_from_stage()
	_reset_pattern_runtime()

func _select_stage(stage_id: String, apply_recommended_character: bool = false) -> bool:
	if stage_select_model == null:
		return false
	if not stage_select_model.select_stage(stage_id):
		return false
	_stop_boss_spellbook_run(false)
	_refresh_pattern_configs_from_stage()
	_reset_stage_run_progress_for_stage()
	_reset_pattern_runtime()
	if apply_recommended_character and character_model != null:
		var stage: Dictionary = stage_select_model.active_stage()
		character_model.select_character(str(stage.get("recommended_character", character_model.selected_character_id)))
	_configure_balance_simulation_model()
	_update_ui_overlay()
	return true

func _cycle_stage(delta: int = 1, apply_recommended_character: bool = false) -> String:
	if stage_select_model == null:
		return ""
	var stage_id: String = stage_select_model.cycle_stage(delta)
	_stop_boss_spellbook_run(false)
	_refresh_pattern_configs_from_stage()
	_reset_stage_run_progress_for_stage()
	_reset_pattern_runtime()
	if apply_recommended_character and character_model != null:
		var stage: Dictionary = stage_select_model.active_stage()
		character_model.select_character(str(stage.get("recommended_character", character_model.selected_character_id)))
	_configure_balance_simulation_model()
	_update_ui_overlay()
	return stage_id

func _start_stage_run() -> bool:
	if stage_select_model == null:
		return false
	var patterns: Array[Dictionary] = stage_select_model.active_patterns()
	if patterns.is_empty():
		return false
	_stop_boss_spellbook_run(false)
	stage_run_enabled = true
	stage_run_start_tick = tick
	stage_run_phase_index = 0
	stage_run_phase_tick = 0
	stage_run_phase_count = patterns.size()
	stage_select_model.select_pattern_index(0)
	_refresh_pattern_configs_from_stage()
	_reset_pattern_runtime(false)
	_update_ui_overlay()
	return true

func _stop_stage_run() -> bool:
	stage_run_enabled = false
	stage_run_start_tick = tick
	stage_run_phase_tick = 0
	_update_ui_overlay()
	return true

func _toggle_stage_run() -> bool:
	if stage_run_enabled:
		return _stop_stage_run()
	return _start_stage_run()

func _start_boss_spellbook_run(spellbook_id: String = "original_boss_archive") -> bool:
	if boss_spellbook_model == null or not boss_spellbook_model.has_method("spellbook_config"):
		return false
	var spellbook: Dictionary = boss_spellbook_model.spellbook_config(spellbook_id)
	if spellbook.is_empty():
		return false
	stage_run_enabled = false
	boss_spellbook_id = spellbook_id
	boss_spellbook_run_enabled = true
	boss_spellbook_run_start_tick = 0
	boss_spellbook_run_tick = 0
	_restart_practice(false)
	boss_spellbook_run_enabled = true
	boss_spellbook_run_start_tick = tick
	boss_spellbook_run_tick = 0
	_update_ui_overlay()
	return true

func _stop_boss_spellbook_run(refresh_ui: bool = true) -> bool:
	boss_spellbook_run_enabled = false
	boss_spellbook_run_start_tick = tick
	boss_spellbook_run_tick = 0
	if refresh_ui:
		_update_ui_overlay()
	return true

func _boss_spellbook_run_status() -> Dictionary:
	var phase: Dictionary = {}
	var total_ticks: int = 0
	if boss_spellbook_model != null and boss_spellbook_model.has_method("active_phase"):
		phase = boss_spellbook_model.active_phase(boss_spellbook_id, boss_spellbook_run_tick)
	if boss_spellbook_model != null and boss_spellbook_model.has_method("spellbook_config") and boss_spellbook_model.has_method("total_ticks"):
		var spellbook: Dictionary = boss_spellbook_model.spellbook_config(boss_spellbook_id)
		if not spellbook.is_empty():
			total_ticks = int(boss_spellbook_model.total_ticks(spellbook))
	return {
		"enabled": boss_spellbook_run_enabled,
		"spellbook_id": boss_spellbook_id,
		"local_tick": boss_spellbook_run_tick,
		"total_ticks": total_ticks,
		"phase_id": String(phase.get("id", "")),
		"phase_tick": int(phase.get("phase_tick", 0)),
		"phase_kind": String(phase.get("kind", "")),
	}

func _stage_run_status() -> Dictionary:
	var pattern := _active_pattern_config()
	return {
		"enabled": stage_run_enabled,
		"phase_index": stage_run_phase_index,
		"phase_count": max(1, stage_run_phase_count),
		"phase_tick": stage_run_phase_tick,
		"phase_ticks": STAGE_RUN_PHASE_TICKS,
		"pattern_id": String(pattern.get("id", "")),
	}

func _reset_stage_run_progress_for_stage() -> void:
	stage_run_start_tick = tick
	stage_run_phase_index = 0
	stage_run_phase_tick = 0
	stage_run_phase_count = pattern_configs.size()
	if stage_run_enabled and stage_select_model != null:
		stage_select_model.select_pattern_index(0)

func _stage_rows() -> Array[Dictionary]:
	if stage_select_model == null:
		return []
	return stage_select_model.stage_rows()

func _stage_pattern_rows() -> Array[Dictionary]:
	if stage_select_model == null:
		return []
	return stage_select_model.pattern_rows()

func _stage_briefing_rows() -> Array[Dictionary]:
	if stage_select_model == null or not stage_select_model.has_method("briefing_rows"):
		return []
	return stage_select_model.briefing_rows(pattern_lab_model)

func _active_stage_practice_plan() -> Dictionary:
	if stage_select_model == null or not stage_select_model.has_method("practice_plan_row"):
		return {}
	return stage_select_model.practice_plan_row(pattern_lab_model)

func _active_stage_practice_presets() -> Array[Dictionary]:
	if stage_select_model == null or not stage_select_model.has_method("practice_preset_rows"):
		return []
	return stage_select_model.practice_preset_rows(pattern_lab_model)

func _pattern_lab_rows() -> Array[Dictionary]:
	if pattern_lab_model == null:
		return []
	return pattern_lab_model.active_rows()

func _boss_spellbook_rows() -> Array[Dictionary]:
	if boss_spellbook_model == null or not boss_spellbook_model.has_method("rows"):
		return []
	return boss_spellbook_model.rows()

func _boss_spellbook_timeline_rows(spellbook_id: String = "original_boss_archive") -> Array[Dictionary]:
	if boss_spellbook_model == null or not boss_spellbook_model.has_method("timeline_rows"):
		return []
	return boss_spellbook_model.timeline_rows(spellbook_id)

func _active_stage_summary() -> String:
	if stage_select_model == null:
		return "-"
	return stage_select_model.summary()

func _apply_recommended_character_for_active_stage() -> bool:
	if stage_select_model == null or character_model == null:
		return false
	var stage: Dictionary = stage_select_model.active_stage()
	var character_id := String(stage.get("recommended_character", ""))
	if character_id.is_empty():
		return false
	var ok: bool = character_model.select_character(character_id)
	if ok:
		_configure_balance_simulation_model()
		_update_ui_overlay()
	return ok

func _apply_stage_practice_plan() -> Dictionary:
	if stage_select_model == null:
		return {"ok": false, "reason": "stage_missing"}
	var plan: Dictionary = _active_stage_practice_plan()
	if plan.is_empty():
		return {"ok": false, "reason": "plan_missing"}
	var stage_id := String(plan.get("stage_id", stage_select_model.selected_stage_id))
	if stage_id.is_empty() or not stage_select_model.select_stage(stage_id):
		return {"ok": false, "reason": "stage_missing", "stage_id": stage_id}
	var recommended_character_id := String(plan.get("recommended_character_id", ""))
	if not recommended_character_id.is_empty() and character_model != null:
		character_model.select_character(recommended_character_id)
	stage_select_model.select_pattern_index(0)
	_refresh_pattern_configs_from_stage()
	_reset_stage_run_progress_for_stage()
	_configure_balance_simulation_model()
	_restart_practice()
	var stage_run_ok := _start_stage_run()
	_update_ui_overlay()
	return {
		"ok": stage_run_ok,
		"reason": "none" if stage_run_ok else "stage_run_failed",
		"stage_id": stage_id,
		"character_id": String(character_model.selected_character_id if character_model != null else ""),
		"phase_count": int(plan.get("phase_pattern_ids", []).size()) if typeof(plan.get("phase_pattern_ids", [])) == TYPE_ARRAY else 0,
		"pattern_id": String(_active_pattern_config().get("id", "")),
		"density_peak": String(plan.get("density_peak", "")),
		"danger_peak": String(plan.get("danger_peak", "")),
		"spawn_peak_per_second": float(plan.get("spawn_peak_per_second", 0.0)),
		"math_basis_route": plan.get("math_basis_route", []),
		"practice_validation_kind": String(plan.get("practice_validation_kind", "")),
		"practice_validation_status": String(plan.get("practice_validation_status", "")),
		"projection_scope": String(plan.get("projection_scope", "")),
		"replay_verification_scope": String(plan.get("replay_verification_scope", "")),
		"local_hash_authority": String(plan.get("local_hash_authority", "")),
		"online_result_authority": String(plan.get("online_result_authority", "")),
		"damage_authority": String(plan.get("damage_authority", "")),
		"reward_authority": String(plan.get("reward_authority", "")),
		"settlement_authority": String(plan.get("settlement_authority", "")),
		"boss_hp_authority": String(plan.get("boss_hp_authority", "")),
		"server_authoritative": bool(plan.get("server_authoritative", false)),
		"client_result_authoritative": bool(plan.get("client_result_authoritative", false)),
		"requires_server_confirmation": bool(plan.get("requires_server_confirmation", false)),
		"server_confirmation_status": String(plan.get("server_confirmation_status", "")),
	}

func _apply_stage_practice_preset(preset: Dictionary) -> Dictionary:
	if stage_select_model == null:
		return {"ok": false, "reason": "stage_missing"}
	if preset.is_empty():
		return {"ok": false, "reason": "preset_missing"}
	var stage_id := String(preset.get("stage_id", stage_select_model.selected_stage_id))
	if stage_id.is_empty() or not stage_select_model.select_stage(stage_id):
		return {"ok": false, "reason": "stage_missing", "stage_id": stage_id}
	var recommended_character_id := String(preset.get("recommended_character_id", ""))
	if not recommended_character_id.is_empty() and character_model != null:
		character_model.select_character(recommended_character_id)
	practice_initial_power = clampf(float(preset.get("practice_initial_power", practice_initial_power)), 0.0, 4.0)
	practice_initial_bombs = clampi(int(preset.get("practice_initial_bombs", practice_initial_bombs)), 0, 6)
	_set_practice_seed(int(preset.get("practice_seed", practice_seed)))
	var target_pattern_index := clampi(int(preset.get("target_pattern_index", 0)), 0, max(0, stage_select_model.active_patterns().size() - 1))
	stage_select_model.select_pattern_index(target_pattern_index)
	_refresh_pattern_configs_from_stage()
	_reset_stage_run_progress_for_stage()
	_configure_balance_simulation_model()
	_restart_practice()
	var preset_kind := String(preset.get("preset_kind", ""))
	var start_ok := true
	if preset_kind == "danger_peak":
		stage_run_enabled = false
		stage_run_phase_index = target_pattern_index
		stage_run_phase_tick = 0
		stage_run_phase_count = pattern_configs.size()
	else:
		start_ok = _start_stage_run()
		if preset_kind == "low_resource":
			stage_run_phase_index = target_pattern_index
			stage_select_model.select_pattern_index(target_pattern_index)
			stage_run_start_tick = tick - target_pattern_index * STAGE_RUN_PHASE_TICKS
			stage_run_phase_tick = 0
			_refresh_pattern_configs_from_stage()
	_update_ui_overlay()
	return {
		"ok": start_ok,
		"reason": "none" if start_ok else "stage_run_failed",
		"stage_id": stage_id,
		"preset_id": String(preset.get("preset_id", "")),
		"preset_kind": preset_kind,
		"character_id": String(character_model.selected_character_id if character_model != null else ""),
		"pattern_id": String(_active_pattern_config().get("id", "")),
		"practice_seed": practice_seed,
		"practice_initial_power": practice_initial_power,
		"practice_initial_bombs": practice_initial_bombs,
		"stage_run_enabled": stage_run_enabled,
		"focus_math_basis": String(preset.get("focus_math_basis", "")),
		"focus_reason": String(preset.get("focus_reason", "")),
		"practice_validation_kind": String(preset.get("practice_validation_kind", "")),
		"practice_validation_status": String(preset.get("practice_validation_status", "")),
		"projection_scope": String(preset.get("projection_scope", "")),
		"replay_verification_scope": String(preset.get("replay_verification_scope", "")),
		"local_hash_authority": String(preset.get("local_hash_authority", "")),
		"online_result_authority": String(preset.get("online_result_authority", "")),
		"damage_authority": String(preset.get("damage_authority", "")),
		"reward_authority": String(preset.get("reward_authority", "")),
		"settlement_authority": String(preset.get("settlement_authority", "")),
		"boss_hp_authority": String(preset.get("boss_hp_authority", "")),
		"server_authoritative": bool(preset.get("server_authoritative", false)),
		"client_result_authoritative": bool(preset.get("client_result_authoritative", false)),
		"requires_server_confirmation": bool(preset.get("requires_server_confirmation", false)),
		"server_confirmation_status": String(preset.get("server_confirmation_status", "")),
	}

func _active_pattern_config() -> Dictionary:
	if stage_select_model == null:
		if pattern_configs.is_empty():
			return {}
		return pattern_configs[0].duplicate(true)
	return stage_select_model.active_pattern()

func _reset_pattern_runtime(clear_stage_run_progress: bool = true) -> void:
	bullets.clear()
	player_shots.clear()
	spawn_index = 0
	shot_spawn_index = 0
	delayed_spawn_count = 0
	if clear_stage_run_progress:
		stage_run_phase_tick = 0
		if not stage_run_enabled:
			stage_run_phase_index = int(stage_select_model.selected_pattern_index if stage_select_model != null else 0)
			stage_run_phase_count = pattern_configs.size()

func _fixed_tick() -> void:
	performance_stats.begin_tick()
	tick += 1
	var input_state: Dictionary = _read_simulation_input()
	last_input_state = input_state
	card_system.tick_update(tick)
	_update_card_play(input_state)
	pattern_modifiers = card_system.build_pattern_modifiers()
	self_modifiers = card_system.build_self_modifiers()
	_update_player(input_state, FIXED_DELTA)
	_update_player_shooting(input_state)
	_update_bomb(input_state)
	_update_pattern()
	_update_player_shots()
	_update_bullets()
	_update_score_tick(input_state)
	if invuln_ticks > 0:
		invuln_ticks -= 1
	if deathbomb_ticks > 0:
		deathbomb_ticks -= 1
		if deathbomb_ticks == 0 and pending_death_hit:
			_commit_hit()
	_validate_replay_tick()
	performance_stats.end_tick(bullets.size(), player_shots.size())

func _read_simulation_input() -> Dictionary:
	if practice_prewarping:
		return InputCodecLib.empty_state()
	if replay_mode:
		return replay_recorder.get_input_for_tick(tick)
	var input_state: Dictionary = InputCodecLib.read_local()
	if input_profile != null:
		var analog_direction: Vector2 = input_profile.gamepad_direction()
		if analog_direction.length_squared() > 0.0:
			input_state["analog_x"] = analog_direction.x
			input_state["analog_y"] = analog_direction.y
			input_state["analog_strength"] = analog_direction.length()
	replay_recorder.record_input(tick, input_state)
	return input_state

func _start_replay_from_recording() -> void:
	if replay_recorder.input_stream.is_empty():
		return
	replay_snapshot = _build_replay_snapshot()
	replay_seek_target_tick = min(600, replay_recorder.final_recorded_tick())
	_restart_replay()

func _build_replay_snapshot() -> Dictionary:
	var snapshot: Dictionary = replay_recorder.build_snapshot(_state_hash())
	var active_pattern: Dictionary = _active_pattern_config()
	var spellbook_status: Dictionary = _boss_spellbook_run_status() if boss_spellbook_run_enabled else {}
	var phase_id := String(spellbook_status.get("phase_id", ""))
	var phase_preview: Dictionary = {}
	var phase_export: Dictionary = {}
	if boss_spellbook_run_enabled and boss_spellbook_model != null and boss_spellbook_model.has_method("deterministic_phase_preview") and not phase_id.is_empty():
		phase_preview = boss_spellbook_model.deterministic_phase_preview(boss_spellbook_id, phase_id, practice_seed)
	if boss_spellbook_run_enabled and boss_spellbook_model != null and boss_spellbook_model.has_method("phase_export_data"):
		phase_export = boss_spellbook_model.phase_export_data(boss_spellbook_id, practice_seed)
	snapshot["deck_snapshot"] = deck_builder.active_deck_snapshot() if deck_builder != null else {}
	snapshot["practice_config"] = {
		"start_tick": practice_start_tick,
		"initial_power": practice_initial_power,
		"initial_bombs": practice_initial_bombs,
		"stage_id": String(stage_select_model.selected_stage_id if stage_select_model != null else ""),
		"pattern_id": String(active_pattern.get("id", "")),
		"catalog_id": "boss_spellbook" if boss_spellbook_run_enabled else "stage_pattern",
		"spellbook_id": boss_spellbook_id if boss_spellbook_run_enabled else "",
		"phase_id": phase_id,
		"preview_export_id": String(phase_preview.get("export_id", "")),
		"preview_bundle_id": String(phase_export.get("preview_bundle_id", "")),
		"preview_bundle_signature_digest": int(phase_export.get("preview_bundle_signature_digest", 0)),
	}
	snapshot["metadata"] = {
		"saved_at": Time.get_datetime_string_from_system(true, true),
		"final_tick": replay_recorder.final_recorded_tick(),
		"score": score,
		"graze": graze_count,
		"hits": hit_count,
		"stage_id": String(stage_select_model.selected_stage_id if stage_select_model != null else ""),
		"pattern_id": String(active_pattern.get("id", "")),
		"opponent": String(active_pattern.get("id", "local")),
		"catalog_id": "boss_spellbook" if boss_spellbook_run_enabled else "stage_pattern",
		"spellbook_id": boss_spellbook_id if boss_spellbook_run_enabled else "",
		"phase_id": phase_id,
		"preview_export_schema_version": int(phase_preview.get("export_schema_version", 0)),
		"preview_export_id": String(phase_preview.get("export_id", "")),
		"preview_fixture_id": String(phase_preview.get("preview_fixture_id", "")),
		"preview_authority_scope": String(phase_preview.get("preview_authority_scope", "")),
		"preview_seed": int(phase_preview.get("seed", 0)),
		"preview_signature": String(phase_preview.get("signature", "")),
		"preview_signature_digest": int(phase_preview.get("signature_digest", 0)),
		"preview_sample_ticks": phase_preview.get("sample_ticks", []),
		"preview_sample_window_start_tick": int(phase_preview.get("sample_window_start_tick", 0)),
		"preview_sample_window_end_tick": int(phase_preview.get("sample_window_end_tick", 0)),
		"preview_sample_window_stride_ticks": int(phase_preview.get("sample_window_stride_ticks", 0)),
		"preview_sample_signature_digests": phase_preview.get("sample_signature_digests", []),
		"preview_sample_emit_counts": phase_preview.get("sample_emit_counts", []),
		"preview_sample_count": (phase_preview.get("samples", []) as Array).size() if typeof(phase_preview.get("samples", [])) == TYPE_ARRAY else 0,
		"preview_max_emit_per_tick": int(phase_preview.get("max_emit_per_tick", 0)),
		"preview_bullet_cap_per_tick": int(phase_preview.get("bullet_cap_per_tick", 0)),
		"preview_budget_headroom": int(phase_preview.get("budget_headroom", 0)),
		"performance_budget_status": String(phase_preview.get("performance_budget_status", "")),
		"preview_bundle_id": String(phase_export.get("preview_bundle_id", "")),
		"preview_bundle_signature_digest": int(phase_export.get("preview_bundle_signature_digest", 0)),
		"preview_phase_count": int(phase_export.get("preview_phase_count", 0)),
		"preview_phase_ids": phase_export.get("preview_phase_ids", []),
		"preview_phase_signature_digests": phase_export.get("preview_phase_signature_digests", []),
		"preview_bundle_max_emit_per_tick": int(phase_export.get("max_preview_emit_per_tick", 0)),
		"preview_bundle_min_budget_headroom": int(phase_export.get("min_preview_budget_headroom", 0)),
		"preview_bundle_budget_status": String(phase_export.get("performance_budget_status", "")),
		"mode": "boss_spellbook_practice" if boss_spellbook_run_enabled else "local_practice",
		"result": "practice",
	}
	return snapshot

func _save_replay_snapshot() -> bool:
	if replay_recorder.input_stream.is_empty():
		replay_file_status = "empty"
		return false
	replay_snapshot = _build_replay_snapshot()
	var saved: bool = replay_store.save_snapshot(replay_snapshot)
	replay_file_status = "saved" if saved else "save_failed"
	if saved:
		_refresh_replay_index()
	return saved

func _load_latest_replay_snapshot() -> bool:
	var loaded_snapshot: Dictionary = replay_store.load_snapshot()
	return _load_replay_snapshot(loaded_snapshot, replay_store.latest_path())

func _load_selected_replay_snapshot() -> bool:
	if replay_index_entries.is_empty():
		return _load_latest_replay_snapshot()
	replay_index_cursor = clampi(replay_index_cursor, 0, replay_index_entries.size() - 1)
	var entry: Dictionary = replay_index_entries[replay_index_cursor]
	if replay_list_model != null:
		if replay_list_model.has_method("request_selected_local_load"):
			var request: Dictionary = replay_list_model.request_selected_local_load()
			if not bool(request.get("ok", false)):
				replay_file_status = "load_failed"
				replay_index_action_status = String(request.get("reason", "load_rejected"))
				return false
			entry = replay_list_model.selected_entry()
		else:
			entry = replay_list_model.selected_entry()
	if not _selected_replay_entry_can_load(entry):
		return false
	var loaded_snapshot: Dictionary = replay_store.load_snapshot_from_entry(entry)
	return _load_replay_snapshot(loaded_snapshot, str(entry.get("path", replay_store.latest_path())))

func _selected_replay_entry_can_load(entry: Dictionary) -> bool:
	if entry.is_empty():
		replay_file_status = "load_failed"
		replay_index_action_status = "missing_entry"
		return false
	if replay_list_model != null and replay_list_model.has_method("local_load_guard_for_entry"):
		var guard: Dictionary = replay_list_model.local_load_guard_for_entry(entry)
		if not bool(guard.get("ok", false)):
			replay_file_status = "load_failed"
			replay_index_action_status = String(guard.get("reason", "load_rejected"))
			return false
	var path := str(entry.get("path", ""))
	if path.is_empty() or not FileAccess.file_exists(path):
		replay_file_status = "load_failed"
		replay_index_action_status = "file_missing" if not path.is_empty() else "missing_path"
		return false
	replay_index_action_status = "load_ready"
	return true

func _load_replay_snapshot(loaded_snapshot: Dictionary, loaded_path: String) -> bool:
	if loaded_snapshot.is_empty():
		replay_file_status = "load_failed"
		return false
	replay_snapshot = loaded_snapshot
	replay_file_status = "loaded"
	replay_file_path = loaded_path
	active_match_seed = int(replay_snapshot.get("match_seed", practice_seed))
	practice_seed = active_match_seed
	var loaded_inputs: Array = replay_snapshot.get("input_stream", [])
	if not loaded_inputs.is_empty():
		replay_seek_target_tick = min(600, int(loaded_inputs[loaded_inputs.size() - 1].get("tick", 0)))
	_restart_replay()
	return true

func _refresh_replay_index() -> void:
	if replay_list_model != null:
		replay_list_model.refresh()
		_sync_replay_index_state()
		return
	replay_index_entries = replay_store.load_index() if replay_store != null else []
	if replay_index_entries.is_empty():
		replay_index_cursor = 0
		replay_index_status = "empty"
		return
	replay_index_cursor = clampi(replay_index_cursor, 0, replay_index_entries.size() - 1)
	replay_index_status = "ready"

func _select_replay_index(delta: int) -> void:
	if replay_list_model != null:
		replay_list_model.select(delta)
		_sync_replay_index_state()
		return
	_refresh_replay_index()
	if replay_index_entries.is_empty():
		return
	replay_index_cursor = wrapi(replay_index_cursor + delta, 0, replay_index_entries.size())
	replay_index_status = "selected"

func _toggle_selected_replay_favorite() -> bool:
	if replay_list_model != null:
		var model_ok: bool = replay_list_model.toggle_selected_favorite()
		_sync_replay_index_state()
		return model_ok
	if replay_index_entries.is_empty():
		replay_index_action_status = "empty"
		return false
	var entry := replay_index_entries[clampi(replay_index_cursor, 0, replay_index_entries.size() - 1)]
	var replay_id := str(entry.get("replay_id", ""))
	if replay_id.is_empty():
		replay_index_action_status = "failed"
		return false
	var ok: bool = replay_store.toggle_favorite(replay_id)
	replay_index_action_status = "favorite" if ok else "failed"
	_refresh_replay_index()
	return ok

func _remove_selected_replay_from_index() -> bool:
	if replay_list_model != null:
		var model_ok: bool = replay_list_model.remove_selected_from_index()
		_sync_replay_index_state()
		return model_ok
	if replay_index_entries.is_empty():
		replay_index_action_status = "empty"
		return false
	var entry := replay_index_entries[clampi(replay_index_cursor, 0, replay_index_entries.size() - 1)]
	var replay_id := str(entry.get("replay_id", ""))
	if replay_id.is_empty():
		replay_index_action_status = "failed"
		return false
	var ok: bool = replay_store.remove_from_index(replay_id)
	replay_index_action_status = "removed" if ok else "failed"
	_refresh_replay_index()
	return ok

func _selected_replay_summary() -> String:
	if replay_list_model != null:
		return replay_list_model.selected_summary()
	if replay_index_entries.is_empty():
		return "-"
	var entry := replay_index_entries[clampi(replay_index_cursor, 0, replay_index_entries.size() - 1)]
	var favorite_mark := "*" if bool(entry.get("favorite", false)) else "-"
	return "%d/%d %s seed %d tick %d score %d %s" % [
		replay_index_cursor + 1,
		replay_index_entries.size(),
		favorite_mark,
		int(entry.get("match_seed", 0)),
		int(entry.get("final_tick", 0)),
		int(entry.get("score", 0)),
		str(entry.get("pattern_id", "")),
	]

func _replay_list_rows(limit: int = 8) -> Array[Dictionary]:
	if replay_list_model == null:
		return []
	return replay_list_model.row_models(limit)

func _set_replay_verification_filter(filter_id: String) -> bool:
	if replay_list_model == null or not replay_list_model.has_method("set_verification_filter"):
		return false
	var ok: bool = replay_list_model.set_verification_filter(filter_id)
	_sync_replay_index_state()
	return ok

func _select_replay_source_index_from_row(row: Dictionary) -> bool:
	if replay_list_model == null:
		return false
	var source_index := int(row.get("source_index", -1))
	if source_index >= 0:
		var ok: bool = replay_list_model.select_index(source_index)
		_sync_replay_index_state()
		return ok
	var replay_id := String(row.get("replay_id", ""))
	if replay_id.is_empty():
		return false
	var replay_rows: Array[Dictionary] = replay_list_model.row_models(64)
	for replay_row in replay_rows:
		if String(replay_row.get("replay_id", "")) == replay_id:
			var ok_by_id: bool = replay_list_model.select_index(int(replay_row.get("source_index", -1)))
			_sync_replay_index_state()
			return ok_by_id
	return false

func _sync_replay_index_state() -> void:
	if replay_list_model == null:
		return
	replay_index_entries = replay_list_model.entries
	replay_index_cursor = replay_list_model.cursor
	replay_index_status = replay_list_model.status
	replay_index_action_status = replay_list_model.action_status

func _restart_replay() -> void:
	if replay_snapshot.is_empty():
		return
	_reset_match_state(false)
	active_match_seed = int(replay_snapshot.get("match_seed", practice_seed))
	replay_mode = true
	replay_paused = false
	replay_validation_failed = false
	replay_first_mismatch_tick = 0
	replay_seek_status = "restart"
	replay_final_hash_status = "pending"
	replay_expected_final_hash = int(replay_snapshot.get("final_result_hash", 0))
	replay_actual_final_hash = 0
	performance_stats = PerformanceStatsLib.new()
	replay_recorder.load_snapshot(replay_snapshot)
	_configure_card_system_from_snapshot(replay_snapshot.get("deck_snapshot", {}))

func _adjust_replay_seek_target(delta_ticks: int) -> void:
	var final_tick: int = replay_recorder.final_recorded_tick()
	if final_tick <= 0 and not replay_snapshot.is_empty():
		var snapshot_inputs: Array = replay_snapshot.get("input_stream", [])
		if not snapshot_inputs.is_empty():
			final_tick = int(snapshot_inputs[snapshot_inputs.size() - 1].get("tick", 0))
	replay_seek_target_tick = clampi(replay_seek_target_tick + delta_ticks, 0, max(0, final_tick))
	replay_seek_status = "target"

func _seek_replay_to_tick(target_tick: int) -> bool:
	if replay_snapshot.is_empty():
		replay_seek_status = "missing"
		return false
	var final_tick: int = replay_recorder.final_recorded_tick()
	if final_tick <= 0:
		var snapshot_inputs: Array = replay_snapshot.get("input_stream", [])
		if not snapshot_inputs.is_empty():
			final_tick = int(snapshot_inputs[snapshot_inputs.size() - 1].get("tick", 0))
	var clamped_target: int = clampi(target_tick, 0, max(0, final_tick))
	_reset_match_state(false)
	active_match_seed = int(replay_snapshot.get("match_seed", practice_seed))
	replay_mode = true
	replay_paused = true
	replay_validation_failed = false
	replay_first_mismatch_tick = 0
	replay_final_hash_status = "pending"
	replay_expected_final_hash = int(replay_snapshot.get("final_result_hash", 0))
	replay_actual_final_hash = 0
	replay_recorder.load_snapshot(replay_snapshot)
	performance_stats = PerformanceStatsLib.new()
	var seek_guard := 0
	var max_seek_steps: int = clamped_target + 2
	while tick < clamped_target:
		var before_tick := tick
		_fixed_tick()
		seek_guard += 1
		if tick <= before_tick or seek_guard > max_seek_steps:
			replay_seek_status = "failed"
			return false
	accumulator = 0.0
	replay_seek_target_tick = clamped_target
	replay_seek_status = "done"
	return true

func _validate_replay_tick() -> void:
	if not replay_mode:
		return
	if not replay_validation_failed and replay_recorder.has_hash_for_tick(tick):
		var expected: int = replay_recorder.expected_hash_for_tick(tick)
		var actual: int = _state_hash()
		if expected != actual:
			replay_validation_failed = true
			replay_first_mismatch_tick = tick
			replay_final_hash_status = "invalid"
			replay_recorder.record_event(tick, "replay_invalid", {"expected": expected, "actual": actual})
	if tick >= replay_recorder.final_recorded_tick():
		_validate_replay_final_hash()
		replay_paused = true

func _validate_replay_final_hash() -> bool:
	if replay_snapshot.is_empty():
		replay_final_hash_status = "missing"
		return false
	replay_expected_final_hash = int(replay_snapshot.get("final_result_hash", 0))
	replay_actual_final_hash = _state_hash()
	if replay_actual_final_hash == replay_expected_final_hash and not replay_validation_failed:
		replay_final_hash_status = "valid"
		return true
	replay_validation_failed = true
	if replay_first_mismatch_tick == 0:
		replay_first_mismatch_tick = tick
	replay_final_hash_status = "invalid"
	replay_recorder.record_event(tick, "replay_final_invalid", {"expected": replay_expected_final_hash, "actual": replay_actual_final_hash})
	return false

func _update_player(input_state: Dictionary, delta: float) -> void:
	var direction: Vector2 = InputCodecLib.direction_from_bits(int(input_state.get("direction_bits", 0)))
	if input_state.has("analog_x") or input_state.has("analog_y"):
		var analog_direction := Vector2(float(input_state.get("analog_x", 0.0)), float(input_state.get("analog_y", 0.0)))
		if analog_direction.length_squared() > 0.0:
			direction = analog_direction
	var focused := bool(input_state.get("slow_pressed", false))
	var speed: float = character_model.move_speed(focused) if character_model != null else (FOCUS_SPEED if focused else PLAYER_SPEED)
	if focused:
		speed *= float(self_modifiers.get("focus_speed_multiplier", 1.0))
	player_pos += direction * speed * delta
	player_pos = player_pos.clamp(PLAYFIELD.position, PLAYFIELD.position + PLAYFIELD.size)

func _update_card_play(input_state: Dictionary) -> void:
	var requested_slot := int(input_state.get("card_slot", 0))
	if requested_slot <= 0:
		return
	var result: Dictionary = card_system.play(requested_slot - 1, tick)
	if result.is_empty():
		replay_recorder.record_event(tick, "card_rejected", {"slot": requested_slot, "energy": card_system.energy})
		return
	replay_recorder.record_event(tick, "card_played", result)

func _update_player_shooting(input_state: Dictionary) -> void:
	if not bool(input_state.get("shoot_pressed", false)):
		return
	var focused := bool(input_state.get("slow_pressed", false))
	var shot_interval: int = character_model.shot_interval_ticks(focused) if character_model != null else PLAYER_SHOT_INTERVAL_TICKS
	if tick % shot_interval != 0:
		return
	var shot_rows: Array[Dictionary] = character_model.shot_rows(focused) if character_model != null else []
	if shot_rows.is_empty():
		for lane in ([-10.0, 10.0] if focused else [-24.0, -8.0, 8.0, 24.0]):
			shot_rows.append({
				"offset": Vector2(float(lane), -12.0),
				"velocity": Vector2.UP * PLAYER_SHOT_SPEED,
				"radius": PLAYER_SHOT_RADIUS,
				"damage": 1,
				"color_name": "cyan",
			})
	for shot_config in shot_rows:
		var shot_offset: Vector2 = shot_config.get("offset", Vector2.ZERO)
		var shot_velocity: Vector2 = shot_config.get("velocity", Vector2.UP * PLAYER_SHOT_SPEED)
		player_shots.append({
			"pos": player_pos + shot_offset,
			"vel": shot_velocity,
			"radius": float(shot_config.get("radius", PLAYER_SHOT_RADIUS)),
			"damage": int(shot_config.get("damage", 1)) + int(floor(power)),
			"color_name": str(shot_config.get("color_name", "cyan")),
			"spawn_index": shot_spawn_index,
		})
		shot_spawn_index += 1

func _update_bomb(input_state: Dictionary) -> void:
	if not bool(input_state.get("bomb_pressed", false)):
		return
	if bomb_count <= 0:
		return
	_activate_bomb("manual")

func _activate_bomb(reason: String) -> void:
	bomb_count -= 1
	bomb_used += 1
	var character_bomb_invuln_multiplier: float = character_model.bomb_invuln_multiplier() if character_model != null else 1.0
	var bomb_invuln := int(float(BOMB_INVULN_TICKS) * character_bomb_invuln_multiplier) + int(self_modifiers.get("bomb_invuln_bonus_ticks", 0))
	invuln_ticks = max(invuln_ticks, bomb_invuln)
	deathbomb_ticks = 0
	pending_death_hit = false
	pending_hit_pattern_id = ""
	var cleared := 0
	var character_bomb_radius_multiplier: float = character_model.bomb_radius_multiplier() if character_model != null else 1.0
	var bomb_radius := BOMB_RADIUS * character_bomb_radius_multiplier * float(self_modifiers.get("bomb_radius_multiplier", 1.0))
	for bullet in bullets:
		if player_pos.distance_to(bullet["pos"]) <= bomb_radius:
			bullet["pos"] = Vector2(-9999, -9999)
			cleared += 1
	var refund_power: float = min(0.25, float(cleared) * 0.002)
	power = min(4.0, power + refund_power)
	multiplier = max(1.0, multiplier * 0.72)
	replay_recorder.record_event(tick, "bomb", {"reason": reason, "cleared": cleared})

func _restart_practice(clear_boss_spellbook_run: bool = true) -> void:
	_reset_match_state(true, clear_boss_spellbook_run)

func _advance_practice_ticks(count: int) -> int:
	var steps: int = max(0, count)
	for _i in range(steps):
		_fixed_tick()
	_update_hud()
	queue_redraw()
	return tick

func _reset_match_state(reset_replay: bool, clear_boss_spellbook_run: bool = true) -> void:
	player_pos = Vector2(480, 600)
	active_match_seed = practice_seed
	bullets.clear()
	player_shots.clear()
	tick = 0
	accumulator = 0.0
	spawn_index = 0
	shot_spawn_index = 0
	graze_count = 0
	hit_count = 0
	bomb_count = practice_initial_bombs
	bomb_used = 0
	invuln_ticks = 90
	deathbomb_ticks = 0
	pending_death_hit = false
	pending_hit_pattern_id = ""
	power = practice_initial_power
	score = 0
	multiplier = 1.0
	combo = 0
	max_combo = 0
	target_damage = 0
	delayed_spawn_count = 0
	stage_run_phase_index = int(stage_select_model.selected_pattern_index if stage_select_model != null else 0)
	stage_run_start_tick = 0
	stage_run_phase_tick = 0
	stage_run_phase_count = pattern_configs.size()
	if clear_boss_spellbook_run:
		boss_spellbook_run_enabled = false
		boss_spellbook_run_start_tick = 0
		boss_spellbook_run_tick = 0
	pattern_modifiers = {}
	self_modifiers = {}
	last_input_state = InputCodecLib.empty_state()
	if reset_replay:
		replay_mode = false
		replay_paused = false
		replay_snapshot = {}
		replay_validation_failed = false
		replay_first_mismatch_tick = 0
		replay_recorder.configure(active_match_seed)
	_configure_card_system_from_active_deck()
	if reset_replay and practice_start_tick > 0:
		_prewarm_to_start_tick()

func _configure_card_system_from_active_deck() -> void:
	if card_system == null:
		return
	if deck_builder == null:
		card_system.configure_local_practice()
		_configure_balance_simulation_model()
		return
	card_system.configure_from_cards(deck_builder.active_card_definitions(), deck_builder.active_deck_snapshot())
	_configure_balance_simulation_model()

func _configure_card_system_from_snapshot(snapshot: Dictionary) -> void:
	if card_system == null:
		return
	if deck_builder == null or snapshot.is_empty():
		card_system.configure_local_practice()
		return
	card_system.configure_from_cards(deck_builder.cards_for_snapshot(snapshot), snapshot)

func _configure_balance_simulation_model() -> void:
	if balance_simulation_model == null or deck_builder == null:
		return
	balance_simulation_model.configure(
		pattern_configs,
		deck_builder.active_card_definitions(),
		deck_builder.active_deck_snapshot(),
		character_model,
		bullet_visual_model
	)

func _configure_latency_test_model() -> void:
	if latency_test_model == null:
		return
	latency_test_model.configure(matchmaking_model, network_match_model, game_mode_model)

func _deck_builder_rows(rarity: String = "all", card_type: String = "all", limit: int = 64) -> Array[Dictionary]:
	if deck_builder == null:
		return []
	return deck_builder.card_rows(rarity, card_type, limit)

func _toggle_deck_card(card_id: String) -> Dictionary:
	if deck_builder == null:
		return {"ok": false, "reason": "missing", "card_id": card_id}
	var result: Dictionary = deck_builder.toggle_card_in_working(card_id)
	_configure_balance_simulation_model()
	_update_ui_overlay()
	return result

func _character_rows() -> Array[Dictionary]:
	if character_model == null:
		return []
	return character_model.rows()

func _select_character(character_id: String) -> bool:
	if character_model == null:
		return false
	var ok: bool = character_model.select_character(character_id)
	_update_ui_overlay()
	return ok

func _cycle_character(delta: int = 1) -> String:
	if character_model == null:
		return ""
	var character_id: String = character_model.cycle_character(delta)
	_update_ui_overlay()
	return character_id

func _matchmaking_rows() -> Array[Dictionary]:
	if matchmaking_model == null:
		return []
	return matchmaking_model.match_rows()

func _mode_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if matchmaking_model != null:
		rows.append_array(matchmaking_model.mode_rows())
	if game_mode_model != null:
		rows.append_array(game_mode_model.mode_rows())
	return rows

func _game_mode_rows() -> Array[Dictionary]:
	if game_mode_model == null:
		return []
	return game_mode_model.mode_rows()

func _select_game_mode(mode_id: String) -> bool:
	if game_mode_model == null:
		return false
	var ok: bool = game_mode_model.select_mode(mode_id)
	_update_ui_overlay()
	return ok

func _apply_certification_result(result: Dictionary) -> bool:
	if game_mode_model == null:
		return false
	var ok: bool = game_mode_model.apply_certification_result(result)
	_update_ui_overlay()
	return ok

func _configure_battle_royale_players(players: Array) -> bool:
	if game_mode_model == null:
		return false
	var ok: bool = game_mode_model.configure_battle_royale_players(players)
	_update_ui_overlay()
	return ok

func _build_battle_royale_pool(player_cards: Dictionary) -> Dictionary:
	if game_mode_model == null:
		return {"valid": false, "reason": "missing", "pool": []}
	var result: Dictionary = game_mode_model.build_battle_royale_pool(player_cards)
	_update_ui_overlay()
	return result

func _receive_battle_royale_round(round_index: int, candidate_cards: Array, deadline_tick: int, zero_round_order: Array, effect_trigger_tick: int) -> bool:
	if game_mode_model == null:
		return false
	var ok: bool = game_mode_model.receive_battle_royale_round(round_index, candidate_cards, deadline_tick, zero_round_order, effect_trigger_tick)
	_update_ui_overlay()
	return ok

func _select_battle_royale_card(card_id: String, action_tick: int) -> Dictionary:
	if game_mode_model == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = game_mode_model.select_battle_royale_card(card_id, action_tick)
	_update_ui_overlay()
	return result

func _configure_boss_party(mode_id: String, player_ids: Array) -> bool:
	if game_mode_model == null:
		return false
	var ok: bool = game_mode_model.configure_boss_party(mode_id, player_ids)
	_update_ui_overlay()
	return ok

func _request_boss_card_transfer(mode_id: String, from_player_id: String, to_player_id: String, card_id: String) -> Dictionary:
	if game_mode_model == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = game_mode_model.request_boss_card_transfer(mode_id, from_player_id, to_player_id, card_id)
	_update_ui_overlay()
	return result

func _apply_server_instance_boss_access(snapshot: Dictionary) -> Dictionary:
	if game_mode_model == null:
		return {"ok": false, "reason": "missing"}
	var result: Dictionary = game_mode_model.apply_server_instance_boss_access(snapshot)
	_update_ui_overlay()
	return result

func _request_boss_entry(mode_id: String) -> Dictionary:
	if game_mode_model == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = game_mode_model.request_boss_entry(mode_id)
	_update_ui_overlay()
	return result

func _submit_battle_royale_card_to_server(card_id: String, action_tick: int) -> Dictionary:
	var local_result: Dictionary = _select_battle_royale_card(card_id, action_tick)
	if not bool(local_result.get("ok", false)):
		return local_result
	return await _gensoulkyo_submit_mode_action(local_result.get("request", {}))

func _submit_boss_card_transfer_to_server(mode_id: String, from_player_id: String, to_player_id: String, card_id: String) -> Dictionary:
	var local_result: Dictionary = _request_boss_card_transfer(mode_id, from_player_id, to_player_id, card_id)
	if not bool(local_result.get("ok", false)):
		return local_result
	return await _gensoulkyo_submit_mode_action(local_result.get("request", {}))

func _apply_world_boss_result(result: Dictionary) -> bool:
	if game_mode_model == null:
		return false
	var ok: bool = game_mode_model.apply_world_boss_result(result)
	_update_ui_overlay()
	return ok

func _apply_instance_boss_result(result: Dictionary) -> bool:
	if game_mode_model == null:
		return false
	var ok: bool = game_mode_model.apply_instance_boss_result(result)
	_update_ui_overlay()
	return ok

func _apply_server_match_result(result: Dictionary) -> Dictionary:
	if results_service_model == null:
		return {"ok": false, "reason": "missing"}
	var response: Dictionary = results_service_model.apply_server_match_result(result)
	if game_mode_model != null and typeof(result.get("mode_result", {})) == TYPE_DICTIONARY:
		game_mode_model.apply_certification_result(result.get("mode_result", {}))
	_update_ui_overlay()
	return response

func _claim_compensation(compensation: Dictionary) -> Dictionary:
	if results_service_model == null:
		return {"ok": false, "reason": "missing"}
	var response: Dictionary = results_service_model.claim_compensation(compensation)
	_update_ui_overlay()
	return response

func _request_activity_claim(claim_kind: String, claim_id: String) -> Dictionary:
	if results_service_model == null:
		return {"ok": false, "reason": "missing"}
	var response: Dictionary = results_service_model.request_activity_claim(claim_kind, claim_id)
	_update_ui_overlay()
	return response

func _apply_server_activity_claim_result(result: Dictionary) -> Dictionary:
	if results_service_model == null:
		return {"ok": false, "reason": "missing"}
	var response: Dictionary = results_service_model.apply_server_activity_claim_result(result)
	_update_ui_overlay()
	return response

func _result_rows() -> Array[Dictionary]:
	if results_service_model == null:
		return []
	return results_service_model.result_rows()

func _activity_rows() -> Array[Dictionary]:
	if results_service_model == null:
		return []
	return results_service_model.activity_rows()

func _run_balance_simulation(options: Dictionary = {}) -> Dictionary:
	if balance_simulation_model == null:
		return {"ok": false, "reason": "missing"}
	_configure_balance_simulation_model()
	var report: Dictionary = balance_simulation_model.run_suite(options)
	_update_ui_overlay()
	return report

func _balance_simulation_rows() -> Array[Dictionary]:
	if balance_simulation_model == null:
		return []
	return balance_simulation_model.rows()

func _run_latency_tests() -> Dictionary:
	if latency_test_model == null:
		return {"ok": false, "reason": "missing"}
	_configure_latency_test_model()
	var report: Dictionary = latency_test_model.run_suite()
	_update_ui_overlay()
	return report

func _latency_test_rows() -> Array[Dictionary]:
	if latency_test_model == null:
		return []
	return latency_test_model.rows()

func _network_match_rows() -> Array[Dictionary]:
	if ui_screen_model != null:
		var previous_screen := String(ui_screen_model.current_screen)
		var previous_cursor := int(ui_screen_model.cursor)
		var previous_last_action := String(ui_screen_model.last_action)
		ui_screen_model.open("network_match")
		var rows: Array[Dictionary] = ui_screen_model.screen_rows(64)
		ui_screen_model.open(previous_screen)
		ui_screen_model.cursor = previous_cursor
		ui_screen_model.last_action = previous_last_action
		return rows
	if network_match_model == null:
		return []
	return network_match_model.status_rows()

func _join_match_queue(mode_id: String = "") -> Dictionary:
	if matchmaking_model == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = matchmaking_model.join_queue(mode_id)
	_update_ui_overlay()
	return result

func _cancel_match_queue() -> bool:
	if matchmaking_model == null:
		return false
	var ok: bool = matchmaking_model.cancel_queue()
	_update_ui_overlay()
	return ok

func _simulate_match_found() -> Dictionary:
	if matchmaking_model == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = matchmaking_model.simulate_match_found()
	_update_ui_overlay()
	return result

func _ready_match() -> bool:
	if matchmaking_model == null:
		return false
	var ok: bool = matchmaking_model.ready()
	_update_ui_overlay()
	return ok

func _settle_local_match_preview() -> Dictionary:
	if results_service_model == null or matchmaking_model == null:
		return {"ok": false, "reason": "missing_model"}
	var mode_id := String(matchmaking_model.get("selected_mode_id"))
	var result := _build_local_server_result_preview(mode_id)
	var settlement: Dictionary = results_service_model.apply_server_match_result(result)
	if bool(settlement.get("ok", false)):
		if ["queued", "found", "ready", "blocked"].has(String(matchmaking_model.get("queue_status"))):
			matchmaking_model.cancel_queue()
		_open_ui_screen("results")
	_update_ui_overlay()
	return settlement

func _build_local_server_result_preview(mode_id: String) -> Dictionary:
	var match_id := "local-preview-%s-%d" % [mode_id, Time.get_ticks_msec()]
	var score_value := 128000 + int(abs(sin(float(Time.get_ticks_msec()) * 0.001)) * 24000.0)
	var graze_value := 420 + (score_value % 180)
	var hit_value := 1 if mode_id == "world_boss" else 0
	var reward_json: Array[Dictionary] = [
		{"type": "points", "amount": 120, "source": "match"},
		{"type": "card_dust", "amount": 35, "source": "match"},
		{"type": "chest_keys", "amount": 1, "source": "daily"},
		{"type": "card", "item_id": "focus_lens", "amount": 1, "source": "match"},
	]
	if mode_id == "world_boss" or mode_id == "instance_boss":
		reward_json.append({"type": "chest", "item_id": "local_basic", "amount": 1, "source": "boss"})
	return {
		"match_id": match_id,
		"user_id": String(results_service_model.get("user_id")),
		"result": "boss_clear" if mode_id == "world_boss" or mode_id == "instance_boss" else "win",
		"mode_id": mode_id,
		"score": score_value,
		"graze_count": graze_value,
		"hit_count": hit_value,
		"replay_id": "replay-%s" % match_id,
		"reward_json": reward_json,
		"task_progress": [
			{"task_id": "daily_complete_match", "progress": 1, "target": 1},
			{"task_id": "daily_graze", "progress": graze_value, "target": 500},
		],
		"event_points": {"local_s0": 30},
		"leaderboard_updates": [
			{"leaderboard_id": "single_score", "score": score_value, "rank": 42, "percentile": 0.24, "season_id": "local_s0"},
			{"leaderboard_id": "world_boss_damage", "score": target_damage + 1600, "rank": 18, "percentile": 0.18, "season_id": "local_s0"},
		],
		"mode_result": {
			"rating_code": "C",
			"rank_score_after": 1240,
			"percentile_after": 0.28,
		},
		"server_authoritative": true,
		"client_authored_reward": false,
	}

func _set_network_quality(ping_ms: int, packet_loss: float = 0.0, jitter_ms: int = 0) -> void:
	if matchmaking_model == null:
		return
	matchmaking_model.set_network_quality(ping_ms, packet_loss, jitter_ms)
	_update_ui_overlay()

func _begin_match_reconnect(match_id: String = "") -> Dictionary:
	if matchmaking_model == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = matchmaking_model.begin_reconnect(match_id)
	_update_ui_overlay()
	return result

func _finish_match_reconnect(success: bool = true) -> Dictionary:
	if matchmaking_model == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = matchmaking_model.finish_reconnect(success)
	if network_match_model != null:
		network_match_model.note_reconnect_result(success)
	_update_ui_overlay()
	return result

func _begin_network_match_from_queue(queue_snapshot: Dictionary) -> bool:
	if network_match_model == null:
		return false
	var ok: bool = network_match_model.begin_from_queue(queue_snapshot)
	_update_ui_overlay()
	return ok

func _network_match_ready() -> bool:
	if network_match_model == null:
		return false
	var ok: bool = network_match_model.mark_loading_ready()
	_update_ui_overlay()
	return ok

func _network_receive_match_start(match_start: Dictionary) -> bool:
	if network_match_model == null:
		return false
	var ok: bool = network_match_model.receive_match_start(match_start)
	_update_ui_overlay()
	return ok

func _network_build_input_packet(input_tick: int, input_state: Dictionary, hand_size: int = 4) -> Dictionary:
	if network_match_model == null:
		return {"tick": input_tick, "seq": 0}
	var packet: Dictionary = network_match_model.build_input_packet(input_tick, input_state, hand_size)
	_update_ui_overlay()
	return packet

func _network_validate_packet(packet: Dictionary, hand_size: int = 4) -> Dictionary:
	if network_match_model == null:
		return {"valid": false, "reason": "missing"}
	return network_match_model.validate_outgoing_packet(packet, hand_size)

func _network_receive_snapshot(snapshot: Dictionary, predicted_state: Dictionary = {}) -> Dictionary:
	if network_match_model == null:
		return {"accepted": false, "reason": "missing"}
	var result: Dictionary = network_match_model.receive_snapshot(snapshot, predicted_state)
	_update_ui_overlay()
	return result

func _network_receive_event(event: Dictionary) -> bool:
	if network_match_model == null:
		return false
	var ok: bool = network_match_model.receive_event(event)
	if ok and String(event.get("type", "")) == "match_end":
		_apply_match_end_settlement(event)
	_update_ui_overlay()
	return ok

func _apply_match_end_settlement(event: Dictionary) -> Dictionary:
	if results_service_model == null:
		return {"ok": false, "reason": "missing"}
	var settlement: Dictionary = _settlement_from_match_end(event)
	if settlement.is_empty():
		return {"ok": false, "reason": "no_settlement"}
	return results_service_model.apply_server_match_result(settlement)

func _settlement_from_match_end(event: Dictionary) -> Dictionary:
	if bool(event.get("client_authored_reward", false)):
		return event.duplicate(true)
	var has_reward := typeof(event.get("reward_json", [])) == TYPE_ARRAY and not (event.get("reward_json", []) as Array).is_empty()
	var has_progress := typeof(event.get("task_progress", [])) == TYPE_ARRAY and not (event.get("task_progress", []) as Array).is_empty()
	var has_event_points := typeof(event.get("event_points", {})) == TYPE_DICTIONARY and not (event.get("event_points", {}) as Dictionary).is_empty()
	var has_leaderboard := typeof(event.get("leaderboard_updates", [])) == TYPE_ARRAY and not (event.get("leaderboard_updates", []) as Array).is_empty()
	var has_mode_result := typeof(event.get("mode_result", {})) == TYPE_DICTIONARY and not (event.get("mode_result", {}) as Dictionary).is_empty()
	if not (has_reward or has_progress or has_event_points or has_leaderboard or has_mode_result):
		return {}
	var final_result: Dictionary = event.get("final_result", {}) if typeof(event.get("final_result", {})) == TYPE_DICTIONARY else {}
	var settlement := event.duplicate(true)
	settlement.erase("type")
	settlement["match_id"] = String(settlement.get("match_id", network_match_model.match_id if network_match_model != null else ""))
	settlement["user_id"] = String(settlement.get("user_id", results_service_model.user_id if results_service_model != null else "local_user"))
	settlement["mode"] = String(settlement.get("mode", network_match_model.mode_id if network_match_model != null else ""))
	settlement["mode_ruleset_version"] = String(settlement.get("mode_ruleset_version", network_match_model.ruleset_version if network_match_model != null else ""))
	settlement["ruleset_version"] = String(settlement.get("ruleset_version", DeckBuilderModelLib.RULESET_VERSION))
	settlement["server_seed"] = settlement.get("server_seed", network_match_model.server_seed if network_match_model != null else 0)
	settlement["status"] = String(settlement.get("status", "completed"))
	settlement["score"] = int(settlement.get("score", final_result.get("score", 0)))
	settlement["graze_count"] = int(settlement.get("graze_count", final_result.get("graze_count", 0)))
	settlement["hit_count"] = int(settlement.get("hit_count", final_result.get("hit_count", 0)))
	settlement["result"] = String(settlement.get("result", final_result.get("result", final_result.get("winner", "completed"))))
	settlement["reward_json"] = settlement.get("reward_json", [])
	settlement["replay_id"] = String(settlement.get("replay_id", network_match_model.replay_metadata.get("replay_id", "") if network_match_model != null else ""))
	return settlement

func _network_request_full_snapshot(reason: String = "manual") -> Dictionary:
	if network_match_model == null:
		return {"type": "request_full_snapshot", "reason": "missing"}
	var request: Dictionary = network_match_model.request_full_snapshot(reason)
	_update_ui_overlay()
	return request

func _network_update_latency_profile(ping_ms: int, packet_loss: float = 0.0, jitter_ms: int = 0) -> int:
	if network_match_model == null:
		return 0
	var delay_ticks: int = network_match_model.update_latency_profile(ping_ms, packet_loss, jitter_ms)
	_update_ui_overlay()
	return delay_ticks

func _network_metrics() -> Dictionary:
	if network_match_model == null:
		return {}
	return network_match_model.metrics()

func _battle_network_prepare_handshake(client_nonce: String = "") -> Dictionary:
	if battle_network_client_model == null:
		return {"ok": false, "reason": "missing"}
	var result: Dictionary = battle_network_client_model.prepare_handshake(client_nonce)
	_update_ui_overlay()
	return result

func _battle_network_mark_connected(server_nonce: String = "") -> Dictionary:
	if battle_network_client_model == null:
		return {"ok": false, "reason": "missing"}
	var result: Dictionary = battle_network_client_model.mark_connected(server_nonce)
	_update_ui_overlay()
	return result

func _battle_network_build_packet_header(payload_type: String, packet_tick: int, ack: int = -1) -> Dictionary:
	if battle_network_client_model == null:
		return {"ok": false, "reason": "missing"}
	var header: Dictionary = battle_network_client_model.build_packet_header(payload_type, packet_tick, ack)
	_update_ui_overlay()
	return header

func _battle_network_build_mode_action(action_type: String, payload: Dictionary = {}, tick: int = 0, action_id: String = "", ack: int = -1) -> Dictionary:
	if battle_network_client_model == null:
		return {"ok": false, "reason": "missing"}
	var action: Dictionary = battle_network_client_model.build_mode_action(action_type, payload, tick, action_id, ack)
	_update_ui_overlay()
	return action

func _battle_network_receive_packet_header(header: Dictionary) -> Dictionary:
	if battle_network_client_model == null:
		return {"ok": false, "reason": "missing"}
	var result: Dictionary = battle_network_client_model.receive_packet_header(header)
	_update_ui_overlay()
	return result

func _battle_network_rows() -> Array[Dictionary]:
	if battle_network_client_model == null:
		return []
	return battle_network_client_model.rows()

func _gensoulkyo_login_and_bootstrap(device_id: String = "spellkard-local", display_name: String = "Local Tester") -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.login_and_bootstrap(device_id, display_name)
	_update_ui_overlay()
	return result

func _gensoulkyo_sync_inventory() -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.sync_inventory()
	_update_ui_overlay()
	return result

func _gensoulkyo_sync_decks() -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.sync_decks()
	_update_ui_overlay()
	return result

func _gensoulkyo_sync_chests() -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.sync_chests()
	_update_ui_overlay()
	return result

func _gensoulkyo_save_active_deck(make_active: bool = true) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.save_active_deck(make_active)
	_configure_card_system_from_active_deck()
	_update_ui_overlay()
	return result

func _gensoulkyo_open_chest(pool_id: String = "local_basic", count: int = 1) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.open_chest(pool_id, count)
	_update_ui_overlay()
	return result

func _gensoulkyo_upgrade_card(card_id: String = "focus_lens", target_level: int = 0) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.upgrade_card(card_id, target_level)
	_configure_card_system_from_active_deck()
	_update_ui_overlay()
	return result

func _gensoulkyo_join_queue(mode_id: String = "", mode_params: Dictionary = {}) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var target_mode_id: String = mode_id
	if target_mode_id.is_empty() and matchmaking_model != null:
		target_mode_id = String(matchmaking_model.selected_mode_id)
	var result: Dictionary = await gensoulkyo_http_client.join_queue(target_mode_id, _gensoulkyo_loadout_mode_params(mode_params))
	_update_ui_overlay()
	return result

func _gensoulkyo_create_room(mode_id: String = "", mode_params: Dictionary = {}) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var target_mode_id: String = mode_id
	if target_mode_id.is_empty() and matchmaking_model != null:
		target_mode_id = String(matchmaking_model.selected_mode_id)
	var result: Dictionary = await gensoulkyo_http_client.create_room(target_mode_id, _gensoulkyo_loadout_mode_params(mode_params))
	_update_ui_overlay()
	return result

func _gensoulkyo_join_room(room_code: String, mode_id: String = "", mode_params: Dictionary = {}) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var target_mode_id: String = mode_id
	if target_mode_id.is_empty() and matchmaking_model != null:
		target_mode_id = String(matchmaking_model.selected_mode_id)
	var result: Dictionary = await gensoulkyo_http_client.join_room(room_code, target_mode_id, _gensoulkyo_loadout_mode_params(mode_params))
	_update_ui_overlay()
	return result

func _gensoulkyo_loadout_mode_params(mode_params: Dictionary = {}) -> Dictionary:
	var params: Dictionary = mode_params.duplicate(true)
	if not params.has("stage_id") and stage_select_model != null:
		params["stage_id"] = String(stage_select_model.selected_stage_id)
	if not params.has("character_id") and character_model != null:
		params["character_id"] = String(character_model.selected_character_id)
	if not params.has("rating_code") and game_mode_model != null and String(params.get("mode_id", "certification")) == "certification":
		var cert_state: Dictionary = game_mode_model.get("certification_state")
		var rating_code := String(cert_state.get("rating_code", ""))
		if not rating_code.is_empty():
			params["rating_code"] = rating_code
	return params

func _gensoulkyo_poll_ticket(ticket_id: String = "") -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.poll_ticket(ticket_id)
	_update_ui_overlay()
	return result

func _gensoulkyo_cancel_ticket(ticket_id: String = "") -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.cancel_ticket(ticket_id)
	_update_ui_overlay()
	return result

func _gensoulkyo_heartbeat(ticket_id: String = "", match_id: String = "", client_tick: int = -1) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var target_ticket_id := ticket_id
	if target_ticket_id.is_empty() and gensoulkyo_api_model != null:
		target_ticket_id = String(gensoulkyo_api_model.get("current_ticket_id"))
	var target_match_id := match_id
	if target_match_id.is_empty() and gensoulkyo_api_model != null:
		target_match_id = String(gensoulkyo_api_model.get("current_match_id"))
	if target_match_id.is_empty() and network_match_model != null:
		target_match_id = String(network_match_model.match_id)
	var target_tick := client_tick
	if target_tick < 0:
		target_tick = tick
	var cursor := 0
	if network_match_model != null:
		cursor = int(network_match_model.event_stream_cursor)
	var result: Dictionary = await gensoulkyo_http_client.heartbeat(target_ticket_id, target_match_id, target_tick, cursor)
	_update_ui_overlay()
	return result

func _gensoulkyo_set_pending_room_code(room_code: String = "") -> Dictionary:
	if gensoulkyo_api_model == null:
		return {"ok": false, "last_error_code": "missing"}
	var target_room_code := room_code.strip_edges().to_upper()
	if target_room_code.is_empty():
		target_room_code = String(gensoulkyo_api_model.get("pending_join_room_code")).strip_edges().to_upper()
	if target_room_code.is_empty():
		target_room_code = String(gensoulkyo_api_model.get("current_room_code")).strip_edges().to_upper()
	if target_room_code.is_empty() and matchmaking_model != null:
		target_room_code = String(matchmaking_model.room_code).strip_edges().to_upper()
	if target_room_code.is_empty() and DisplayServer.get_name() != "headless":
		target_room_code = DisplayServer.clipboard_get().strip_edges().to_upper()
	gensoulkyo_api_model.set_pending_join_room_code(target_room_code)
	_update_ui_overlay()
	return {"ok": not target_room_code.is_empty(), "last_error_code": "none" if not target_room_code.is_empty() else "room_code_missing", "room_code": target_room_code}

func _gensoulkyo_ready(match_id: String = "") -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.ready_match(match_id)
	_update_ui_overlay()
	return result

func _gensoulkyo_submit_input(input_tick: int, input_state: Dictionary, predicted_state: Dictionary = {}, hand_size: int = 4) -> Dictionary:
	if gensoulkyo_http_client == null or network_match_model == null:
		return {"ok": false, "last_error_code": "missing"}
	var packet: Dictionary = network_match_model.build_input_packet(input_tick, input_state, hand_size)
	var result: Dictionary = await gensoulkyo_http_client.submit_input(network_match_model.match_id, packet, predicted_state)
	_update_ui_overlay()
	return result

func _gensoulkyo_snapshot(match_id: String = "", predicted_state: Dictionary = {}) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.snapshot(match_id, predicted_state)
	_update_ui_overlay()
	return result

func _gensoulkyo_poll_events(match_id: String = "", after: int = -1, limit: int = 64) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var target_match_id := match_id
	if target_match_id.is_empty() and network_match_model != null:
		target_match_id = String(network_match_model.match_id)
	var result: Dictionary = await gensoulkyo_http_client.poll_events(target_match_id, after, limit)
	_update_ui_overlay()
	return result

func _gensoulkyo_submit_mode_action(action_request: Dictionary, match_id: String = "") -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var target_match_id := match_id
	if target_match_id.is_empty() and network_match_model != null:
		target_match_id = String(network_match_model.match_id)
	var result: Dictionary = await gensoulkyo_http_client.submit_mode_action(target_match_id, action_request)
	_update_ui_overlay()
	return result

func _gensoulkyo_disconnect(match_id: String = "") -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.disconnect_match(match_id)
	_update_ui_overlay()
	return result

func _gensoulkyo_reconnect(match_id: String = "", predicted_state: Dictionary = {}) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.reconnect_match(match_id, predicted_state)
	_update_ui_overlay()
	return result

func _gensoulkyo_settle(match_id: String = "") -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.settle(match_id)
	_update_ui_overlay()
	return result

func _gensoulkyo_rematch(match_id: String = "") -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var target_match_id := match_id
	if target_match_id.is_empty() and network_match_model != null:
		target_match_id = String(network_match_model.match_id)
	var result: Dictionary = await gensoulkyo_http_client.rematch(target_match_id)
	_update_ui_overlay()
	return result

func _gensoulkyo_fetch_replay(replay_id: String = "") -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var target_replay_id := replay_id
	if target_replay_id.is_empty() and network_match_model != null:
		target_replay_id = String(network_match_model.replay_metadata.get("replay_id", ""))
	var result: Dictionary = await gensoulkyo_http_client.fetch_replay(target_replay_id)
	_update_ui_overlay()
	return result

func _gensoulkyo_claim_activity(claim_kind: String, claim_id: String) -> Dictionary:
	if gensoulkyo_http_client == null:
		return {"ok": false, "last_error_code": "missing"}
	var result: Dictionary = await gensoulkyo_http_client.claim_activity(claim_kind, claim_id)
	_update_ui_overlay()
	return result

func _open_ui_screen(screen_id: String, target_row_id: String = "") -> bool:
	if ui_screen_model == null:
		return false
	var opened: bool = ui_screen_model.open(screen_id)
	if opened and not target_row_id.is_empty():
		_ui_select_row_by_id(target_row_id, false)
	_update_ui_overlay()
	return opened

func _ui_select_row_by_id(row_id: String, refresh: bool = true) -> bool:
	if ui_screen_model == null or row_id.is_empty():
		return false
	var rows: Array[Dictionary] = ui_screen_model.screen_rows(64)
	var row_index := _ui_row_index_by_id(rows, row_id)
	if row_index < 0:
		return false
	if ui_screen_model.has_method("set_cursor"):
		ui_screen_model.set_cursor(row_index, "select:%s" % row_id)
	else:
		ui_screen_model.cursor = row_index
		ui_screen_model.last_action = "select:%s" % row_id
	if refresh:
		_update_ui_overlay()
	return true

func _ui_back_or_quit() -> bool:
	if input_capture_active:
		_cancel_input_capture()
		return true
	if ui_screen_model == null:
		return false
	if String(ui_screen_model.current_screen) == "main_menu":
		return false
	var target_screen := "main_menu"
	if ui_screen_model.has_method("parent_screen_for"):
		var parent_value: Variant = ui_screen_model.parent_screen_for(ui_screen_model.current_screen)
		if typeof(parent_value) == TYPE_STRING and not String(parent_value).is_empty():
			target_screen = String(parent_value)
	_open_ui_screen(target_screen)
	return true

func _cycle_ui_screen(delta: int) -> String:
	if ui_screen_model == null:
		return ""
	var screen_id: String = ui_screen_model.cycle(delta)
	_update_ui_overlay()
	return screen_id

func _ui_select(delta: int) -> void:
	if ui_screen_model == null:
		return
	ui_screen_model.select(delta)
	_update_ui_overlay()

func _ui_set_cursor(index: int) -> void:
	if ui_screen_model == null:
		return
	if ui_screen_model.has_method("set_cursor"):
		ui_screen_model.set_cursor(index, "select")
	else:
		var rows: Array[Dictionary] = ui_screen_model.screen_rows(64)
		if rows.is_empty():
			ui_screen_model.cursor = 0
		else:
			ui_screen_model.cursor = clampi(index, 0, rows.size() - 1)
		ui_screen_model.last_action = "select"
	_update_ui_overlay()

func _ui_accept_selected() -> Dictionary:
	if ui_screen_model == null:
		return {"ok": false, "action": "missing_ui"}
	var row: Dictionary = ui_screen_model.selected_row()
	if row.is_empty():
		return _set_ui_action_result(false, "empty")
	if not bool(row.get("enabled", true)):
		return _set_ui_action_result(false, "disabled", {"id": String(row.get("id", ""))})
	if row.has("ui_action"):
		return _dispatch_ui_action(row)
	if row.has("screen"):
		var target_screen := String(row.get("screen", ""))
		var target_row_id := String(row.get("target_row_id", ""))
		var opened := _open_ui_screen(target_screen, target_row_id)
		ui_screen_model.last_action = "open:%s" % target_screen if opened else "open_failed"
		_update_ui_overlay()
		return {"ok": opened, "action": "open_screen", "screen": target_screen, "target_row_id": target_row_id}
	if row.has("character_id"):
		var character_id := String(row.get("character_id", ""))
		var ok := _select_character(character_id)
		return _set_ui_action_result(ok, "select_character", {"character_id": character_id})
	if row.has("stage_id"):
		var stage_id := String(row.get("stage_id", ""))
		var ok := _select_stage(stage_id, true)
		return _set_ui_action_result(ok, "select_stage", {"stage_id": stage_id})
	if row.has("pattern_id") and row.has("pattern_type"):
		var pattern_id := String(row.get("pattern_id", ""))
		var active_patterns: Array[Dictionary] = stage_select_model.active_patterns() if stage_select_model != null else []
		for i in range(active_patterns.size()):
			if String(active_patterns[i].get("id", "")) == pattern_id:
				_set_demo_index(i)
				return _set_ui_action_result(true, "select_pattern", {"pattern_id": pattern_id, "pattern_index": i})
		return _set_ui_action_result(false, "select_pattern", {"pattern_id": pattern_id})
	return _set_ui_action_result(false, "noop", {"id": String(row.get("id", ""))})

func _ui_accept_selected_async() -> Dictionary:
	if ui_screen_model == null:
		return {"ok": false, "action": "missing_ui"}
	var row: Dictionary = ui_screen_model.selected_row()
	if row.is_empty():
		return _set_ui_action_result(false, "empty")
	if not bool(row.get("enabled", true)):
		return _set_ui_action_result(false, "disabled", {"id": String(row.get("id", ""))})
	var action := String(row.get("ui_action", ""))
	if action.begins_with("gensoulkyo_"):
		return await _dispatch_gensoulkyo_ui_action(row)
	return _ui_accept_selected()

func _set_ui_action_result(ok: bool, action: String, extra: Dictionary = {}) -> Dictionary:
	if ui_screen_model != null:
		ui_screen_model.last_action = "%s:%s" % [action, "ok" if ok else "failed"]
	if ok and _ui_action_should_persist(action):
		_note_player_setting_changed()
	_update_ui_overlay()
	var result: Dictionary = {"ok": ok, "action": action}
	for key in extra.keys():
		if String(key) == "action":
			result["payload_action"] = extra[key]
			continue
		result[key] = extra[key]
	return result

func _ui_action_should_persist(action: String) -> bool:
	return action in [
		"cycle_input_profile",
		"cycle_input_binding",
		"capture_input_binding",
		"commit_input_binding",
		"reset_input_profile",
		"reset_input_binding",
		"cycle_gamepad_curve",
		"adjust_gamepad_sensitivity",
		"adjust_gamepad_deadzone",
		"adjust_gamepad_vibration",
		"reset_gamepad_curve",
		"reset_gamepad_sensitivity",
		"reset_gamepad_deadzone",
		"reset_gamepad_vibration",
		"reset_gamepad_settings",
		"cycle_language",
		"cycle_voice_locale",
		"reset_language",
		"reset_voice_locale",
		"cycle_resolution",
		"cycle_window_mode",
		"toggle_vsync",
		"cycle_fps_limit",
		"adjust_screen_shake",
		"adjust_background_dim",
		"reset_resolution",
		"reset_window_mode",
		"reset_vsync",
		"reset_fps_limit",
		"reset_screen_shake",
		"reset_background_dim",
		"toggle_low_flash",
		"toggle_simplified_background",
		"toggle_always_show_hitbox",
		"toggle_practice_graze_ring",
		"cycle_palette",
		"adjust_bullet_alpha",
		"reset_low_flash",
		"reset_simplified_background",
		"reset_hitbox",
		"reset_graze_ring",
		"reset_palette",
		"reset_bullet_alpha",
		"reset_accessibility_settings",
		"toggle_event_visual_cues",
		"toggle_high_frequency_graze_audio",
		"adjust_audio_volume",
		"reset_audio_volume",
		"reset_audio_cues",
		"reset_graze_audio",
		"reset_audio_settings",
		"reset_display_settings",
		"restore_default_player_settings",
	]

func _dispatch_ui_action(row: Dictionary) -> Dictionary:
	var action := String(row.get("ui_action", ""))
	var direction := _ui_action_direction(row)
	match action:
		"practice_restart":
			_restart_practice()
			return _set_ui_action_result(true, action, {"tick": tick})
		"practice_seed_prev":
			return _set_ui_action_result(true, action, {"seed": _adjust_practice_seed(-1)})
		"practice_seed_next":
			return _set_ui_action_result(true, action, {"seed": _adjust_practice_seed(1)})
		"practice_power_down":
			return _set_ui_action_result(true, action, {"power": _adjust_practice_initial_power(-0.5)})
		"practice_power_up":
			return _set_ui_action_result(true, action, {"power": _adjust_practice_initial_power(0.5)})
		"practice_bombs_cycle":
			return _set_ui_action_result(true, action, {"bombs": _cycle_practice_initial_bombs()})
		"toggle_stage_run":
			var stage_run_ok: bool = _toggle_stage_run()
			return _set_ui_action_result(stage_run_ok, action, _stage_run_status())
		"start_boss_spellbook_run":
			var start_spellbook_ok: bool = _start_boss_spellbook_run(String(row.get("spellbook_id", boss_spellbook_id)))
			return _set_ui_action_result(start_spellbook_ok, action, _boss_spellbook_run_status())
		"start_boss_practice_preview":
			var preview_seed := int(row.get("preview_seed", practice_seed))
			var preview_spellbook_id := String(row.get("spellbook_id", boss_spellbook_id))
			practice_seed = preview_seed
			active_match_seed = practice_seed
			var preview_ok: bool = _start_boss_spellbook_run(preview_spellbook_id)
			if preview_ok:
				_open_ui_screen(String(row.get("local_practice_target_screen", "practice")))
			var preview_status := _boss_spellbook_run_status()
			preview_status["mode_id"] = String(row.get("mode_id", ""))
			preview_status["spellbook_id"] = preview_spellbook_id
			preview_status["preview_seed"] = preview_seed
			preview_status["preview_bundle_id"] = String(row.get("preview_bundle_id", ""))
			preview_status["preview_bundle_signature_digest"] = int(row.get("preview_bundle_signature_digest", 0))
			preview_status["preview_phase_count"] = int(row.get("preview_phase_count", 0))
			preview_status["preview_authority_scope"] = String(row.get("preview_authority_scope", "local_practice_preview_only"))
			preview_status["projection_scope"] = String(row.get("projection_scope", "local_practice_preview_only"))
			preview_status["replay_verification_scope"] = String(row.get("replay_verification_scope", "local_practice_hash"))
			preview_status["performance_budget_status"] = String(row.get("performance_budget_status", ""))
			preview_status["local_hash_authority"] = String(row.get("local_hash_authority", "local_practice_verification_only"))
			preview_status["online_result_authority"] = String(row.get("online_result_authority", "server_settlement_required"))
			preview_status["screen"] = String(ui_screen_model.current_screen if ui_screen_model != null else "")
			preview_status["client_result_authoritative"] = false
			return _set_ui_action_result(preview_ok, action, preview_status)
		"apply_stage_practice_plan":
			var plan_result: Dictionary = _apply_stage_practice_plan()
			return _set_ui_action_result(bool(plan_result.get("ok", false)), action, plan_result)
		"apply_stage_practice_preset":
			var preset_result: Dictionary = _apply_stage_practice_preset(row)
			return _set_ui_action_result(bool(preset_result.get("ok", false)), action, preset_result)
		"gensoulkyo_login", "gensoulkyo_sync_inventory", "gensoulkyo_sync_decks", "gensoulkyo_save_deck", "gensoulkyo_sync_chests", "gensoulkyo_open_chest", "gensoulkyo_upgrade_card", "gensoulkyo_create_room", "gensoulkyo_join_room", "gensoulkyo_poll_ticket", "gensoulkyo_cancel_ticket", "gensoulkyo_heartbeat", "gensoulkyo_server_ready", "gensoulkyo_poll_events", "gensoulkyo_rematch":
			call_deferred("_run_gensoulkyo_ui_action", row.duplicate(true))
			return _set_ui_action_result(true, action, {"status": "requested"})
		"gensoulkyo_set_join_room":
			var pending_room_result: Dictionary = _gensoulkyo_set_pending_room_code()
			return _set_ui_action_result(bool(pending_room_result.get("ok", false)), action, _transport_ui_extra(pending_room_result))
		"battle_client_prepare":
			var battle_prepare: Dictionary = _battle_network_prepare_handshake()
			return _set_ui_action_result(bool(battle_prepare.get("ok", false)), action, battle_prepare)
		"battle_client_connect":
			var battle_connect: Dictionary = _battle_network_mark_connected()
			return _set_ui_action_result(bool(battle_connect.get("ok", false)), action, battle_connect)
		"battle_client_input_header":
			var battle_header: Dictionary = _battle_network_build_packet_header(String(row.get("payload_type", "input")), tick, -1)
			return _set_ui_action_result(bool(battle_header.get("ok", false)), action, battle_header)
		"cycle_input_profile":
			input_profile.cycle_profile()
			return _set_ui_action_result(true, action, {"profile": input_profile.profile_name()})
		"cycle_input_binding":
			var binding_action := StringName(String(row.get("action", "")))
			var binding_result: Dictionary = input_profile.cycle_binding(binding_action, direction)
			return _set_ui_action_result(bool(binding_result.get("ok", false)), action, binding_result)
		"cycle_gamepad_curve":
			return _set_ui_action_result(true, action, {"curve": input_profile.cycle_gamepad_curve(direction)})
		"adjust_gamepad_sensitivity":
			return _set_ui_action_result(true, action, {"sensitivity": input_profile.adjust_gamepad_sensitivity(float(row.get("delta", 0.05)) * float(direction))})
		"adjust_gamepad_deadzone":
			return _set_ui_action_result(true, action, {"deadzone": input_profile.adjust_gamepad_deadzone(float(row.get("delta", 0.02)) * float(direction))})
		"adjust_gamepad_vibration":
			return _set_ui_action_result(true, action, {"vibration": input_profile.adjust_gamepad_vibration(float(row.get("delta", 0.05)) * float(direction))})
		"reset_gamepad_settings":
			var gamepad_result: Dictionary = input_profile.reset_gamepad_settings()
			return _set_ui_action_result(true, action, gamepad_result)
		"cycle_language":
			localization.cycle_locale(direction)
			_load_active_theme_text()
			return _set_ui_action_result(true, action, {"locale": localization.locale, "label": localization.locale_label()})
		"cycle_voice_locale":
			var voice_locale: String = audio_settings.cycle_voice_locale(direction)
			return _set_ui_action_result(true, action, {"voice_locale": voice_locale, "label": audio_settings.voice_locale_label()})
		"cycle_resolution":
			var resolution_text: String = display_settings.cycle_resolution(direction)
			_apply_display_settings(true)
			return _set_ui_action_result(true, action, {"resolution": resolution_text})
		"cycle_window_mode":
			var window_mode_text: String = display_settings.cycle_window_mode(direction)
			_apply_display_settings(true)
			return _set_ui_action_result(true, action, {"window_mode": window_mode_text})
		"toggle_vsync":
			var vsync_enabled: bool = display_settings.toggle_vsync()
			_apply_display_settings(true)
			return _set_ui_action_result(true, action, {"enabled": vsync_enabled})
		"cycle_fps_limit":
			var fps_limit: int = display_settings.cycle_fps_limit(direction)
			_apply_display_settings(true)
			return _set_ui_action_result(true, action, {"fps_limit": fps_limit})
		"adjust_screen_shake":
			return _set_ui_action_result(true, action, {"screen_shake": display_settings.adjust_screen_shake(float(row.get("delta", 0.05)) * float(direction))})
		"adjust_background_dim":
			return _set_ui_action_result(true, action, {"background_dim": display_settings.adjust_background_dim(float(row.get("delta", 0.05)) * float(direction))})
		"reset_display_settings":
			var display_result: Dictionary = display_settings.reset_all()
			_apply_display_settings(true)
			return _set_ui_action_result(true, action, display_result)
		"cycle_character":
			var character_id: String = _cycle_character(1)
			return _set_ui_action_result(not character_id.is_empty(), action, {"character_id": character_id})
		"cycle_stage":
			var stage_id: String = _cycle_stage(1, true)
			return _set_ui_action_result(not stage_id.is_empty(), action, {"stage_id": stage_id})
		"apply_recommended_character":
			var recommended_ok: bool = _apply_recommended_character_for_active_stage()
			return _set_ui_action_result(recommended_ok, action, {"character_id": String(character_model.selected_character_id if character_model != null else "")})
		"toggle_low_flash":
			accessibility_settings.low_flash = not bool(accessibility_settings.low_flash)
			return _set_ui_action_result(true, action, {"enabled": accessibility_settings.low_flash})
		"toggle_simplified_background":
			accessibility_settings.simplified_background = not bool(accessibility_settings.simplified_background)
			return _set_ui_action_result(true, action, {"enabled": accessibility_settings.simplified_background})
		"toggle_always_show_hitbox":
			accessibility_settings.always_show_hitbox = not bool(accessibility_settings.always_show_hitbox)
			return _set_ui_action_result(true, action, {"enabled": accessibility_settings.always_show_hitbox})
		"toggle_practice_graze_ring":
			accessibility_settings.practice_graze_ring = not bool(accessibility_settings.practice_graze_ring)
			return _set_ui_action_result(true, action, {"enabled": accessibility_settings.practice_graze_ring})
		"cycle_palette":
			accessibility_settings.cycle_palette()
			return _set_ui_action_result(true, action, {"palette": accessibility_settings.palette_name()})
		"adjust_bullet_alpha":
			accessibility_settings.adjust_bullet_alpha(float(row.get("delta", 0.05)) * float(direction))
			return _set_ui_action_result(true, action, {"alpha": accessibility_settings.bullet_alpha})
		"reset_accessibility_settings":
			var accessibility_result: Dictionary = accessibility_settings.reset_all()
			return _set_ui_action_result(true, action, accessibility_result)
		"toggle_event_visual_cues":
			audio_settings.toggle_event_visual_cues()
			return _set_ui_action_result(true, action, {"enabled": audio_settings.event_visual_cues})
		"toggle_high_frequency_graze_audio":
			audio_settings.toggle_high_frequency_graze_audio()
			return _set_ui_action_result(true, action, {"enabled": audio_settings.high_frequency_graze_audio})
		"adjust_audio_volume":
			var group := String(row.get("group", ""))
			var audio_ok: bool = audio_settings.adjust_volume(group, float(row.get("delta", 0.1)) * float(direction))
			if audio_ok and direction > 0 and audio_settings.volume_for(group) >= 1.0:
				audio_settings.set_volume(group, 0.0)
			if audio_ok:
				_apply_audio_settings()
			return _set_ui_action_result(audio_ok, action, {"group": group, "volume": audio_settings.volume_for(group)})
		"reset_audio_settings":
			var audio_result: Dictionary = audio_settings.reset_all_snapshot()
			_apply_audio_settings()
			return _set_ui_action_result(true, action, audio_result)
		"save_player_settings":
			var save_settings_result: Dictionary = _save_player_settings()
			return _set_ui_action_result(bool(save_settings_result.get("ok", false)), action, save_settings_result)
		"load_player_settings":
			var load_settings_result: Dictionary = _load_player_settings()
			if bool(load_settings_result.get("ok", false)):
				_load_active_theme_text()
				_apply_audio_settings()
				_apply_display_settings(true)
			return _set_ui_action_result(bool(load_settings_result.get("ok", false)), action, load_settings_result)
		"restore_default_player_settings":
			var default_settings_result: Dictionary = _restore_default_player_settings()
			return _set_ui_action_result(bool(default_settings_result.get("ok", false)), action, default_settings_result)
		"run_balance_simulation":
			var balance_report: Dictionary = _run_balance_simulation({"duration_ticks": 180, "seeds": [practice_seed]})
			return _set_ui_action_result(int(balance_report.get("run_count", 0)) > 0, action, {"run_count": int(balance_report.get("run_count", 0))})
		"run_latency_tests":
			var latency_report: Dictionary = _run_latency_tests()
			return _set_ui_action_result(bool(latency_report.get("ok", false)), action, {"scenario_count": int(latency_report.get("scenarios", []).size())})
		"local_settle_match":
			var settlement_result: Dictionary = _settle_local_match_preview()
			return _set_ui_action_result(bool(settlement_result.get("ok", false)), action, {
				"reason": String(settlement_result.get("reason", "none")),
				"duplicate": bool(settlement_result.get("duplicate", false)),
			})
		"open_chest":
			var pool_id := String(row.get("pool_id", row.get("id", "local_basic")))
			var count := int(row.get("open_count", 1))
			var chest_result: Dictionary = _open_chest(pool_id, count)
			return _set_ui_action_result(bool(chest_result.get("ok", false)), action, {"pool_id": pool_id, "count": count, "reason": String(chest_result.get("reason", "none"))})
		"activate_theme":
			var theme_id := String(row.get("theme_id", row.get("id", "base")))
			var theme_ok: bool = _activate_theme(theme_id)
			return _set_ui_action_result(theme_ok, action, {"theme_id": theme_id})
		"load_replay":
			var replay_id := String(row.get("replay_id", ""))
			var replay_rows: Array[Dictionary] = _replay_list_rows(64)
			for i in range(replay_rows.size()):
				if String(replay_rows[i].get("replay_id", "")) == replay_id:
					if replay_list_model != null:
						replay_list_model.select_index(int(replay_rows[i].get("source_index", i)))
						_sync_replay_index_state()
					var replay_ok: bool = _load_selected_replay_snapshot()
					return _set_ui_action_result(replay_ok, action, {
						"replay_id": replay_id,
						"status": replay_index_action_status,
						"reason": "none" if replay_ok else replay_index_action_status,
					})
			return _set_ui_action_result(false, action, {"replay_id": replay_id, "reason": "missing_entry"})
		"set_replay_filter":
			var filter_id := String(row.get("verification_filter", "all"))
			var filter_ok: bool = _set_replay_verification_filter(filter_id)
			return _set_ui_action_result(filter_ok, action, {
				"verification_filter": filter_id,
				"visible_entry_count": replay_list_model.row_models(64).size() if replay_list_model != null else 0,
			})
		"toggle_replay_favorite":
			var selected_for_favorite := _select_replay_source_index_from_row(row)
			var favorite_ok := selected_for_favorite and _toggle_selected_replay_favorite()
			return _set_ui_action_result(favorite_ok, action, {
				"replay_id": String(row.get("replay_id", "")),
				"status": replay_index_action_status,
			})
		"remove_replay_from_index":
			var selected_for_remove := _select_replay_source_index_from_row(row)
			var remove_ok := selected_for_remove and _remove_selected_replay_from_index()
			return _set_ui_action_result(remove_ok, action, {
				"replay_id": String(row.get("replay_id", "")),
				"status": replay_index_action_status,
			})
		"save_replay":
			var save_ok: bool = _save_replay_snapshot()
			return _set_ui_action_result(save_ok, action)
		"restart_practice":
			_restart_practice()
			return _set_ui_action_result(true, action, {"tick": tick})
		"save_deck":
			var deck_ok: bool = deck_builder.save_working_deck()
			_configure_card_system_from_active_deck()
			return _set_ui_action_result(deck_ok, action, {"status": String(deck_builder.last_save_status)})
		"toggle_deck_card":
			var card_id := String(row.get("card_id", ""))
			var edit_result: Dictionary = _toggle_deck_card(card_id)
			return _set_ui_action_result(bool(edit_result.get("ok", false)), action, {
				"card_id": card_id,
				"deck_size": int(edit_result.get("deck_size", 0)),
				"valid": bool(edit_result.get("valid", false)),
				"status": String(edit_result.get("status", "")),
			})
		"select_mode":
			var mode_id := String(row.get("mode_id", row.get("id", "")))
			var mode_ok: bool = _select_game_mode(mode_id)
			return _set_ui_action_result(mode_ok, action, {"mode_id": mode_id})
		"queue_mode":
			var queue_mode_id := String(row.get("mode_id", row.get("id", "")))
			var mode_queue_result: Dictionary = _join_match_queue(queue_mode_id)
			return _set_ui_action_result(bool(mode_queue_result.get("ok", false)), action, {
				"status": String(mode_queue_result.get("status", "")),
				"mode_id": queue_mode_id,
				"match_id": String(mode_queue_result.get("match_id", "")),
			})
		"start_certification_queue":
			var cert_select_ok: bool = _select_game_mode("certification")
			if not cert_select_ok:
				return _set_ui_action_result(false, action, {"mode_id": "certification"})
			var cert_queue_result: Dictionary = _join_match_queue("certification")
			return _set_ui_action_result(bool(cert_queue_result.get("ok", false)), action, {"status": String(cert_queue_result.get("status", "")), "mode_id": "certification"})
		"select_battle_royale_candidate":
			var candidate_card_id := String(row.get("candidate_card_id", ""))
			var br_result: Dictionary = _select_battle_royale_card(candidate_card_id, tick)
			var br_request: Dictionary = br_result.get("request", {})
			return _set_ui_action_result(bool(br_result.get("ok", false)), action, {
				"card_id": candidate_card_id,
				"request_type": String(br_result.get("action_type", br_request.get("action_type", ""))),
				"authoritative": bool(br_result.get("server_authoritative", false)),
				"last_error_code": String(br_result.get("last_error_code", "")),
			})
		"request_boss_transfer":
			var transfer_request: Dictionary = row.get("transfer_request", {})
			var transfer_result: Dictionary = _request_boss_card_transfer(
				String(transfer_request.get("mode_id", "")),
				String(transfer_request.get("from_player_id", "")),
				String(transfer_request.get("to_player_id", "")),
				String(transfer_request.get("card_id", ""))
			)
			var request_record: Dictionary = transfer_result.get("request", {})
			return _set_ui_action_result(bool(transfer_result.get("ok", false)), action, {
				"mode_id": String(transfer_request.get("mode_id", "")),
				"card_id": String(transfer_request.get("card_id", "")),
				"request_type": String(transfer_result.get("action_type", request_record.get("action_type", ""))),
				"authoritative": bool(transfer_result.get("server_authoritative", false)),
				"last_error_code": String(transfer_result.get("last_error_code", "")),
			})
		"request_boss_entry":
			var entry_mode_id := String(row.get("mode_id", ""))
			var entry_result: Dictionary = _request_boss_entry(entry_mode_id)
			var entry_request: Dictionary = entry_result.get("request", {})
			var entry_payload: Dictionary = entry_request.get("payload", {})
			return _set_ui_action_result(bool(entry_result.get("ok", false)), action, {
				"mode_id": entry_mode_id,
				"request_type": String(entry_request.get("action_type", "")),
				"authoritative": bool(entry_request.get("server_authoritative", false)),
				"request_scope": String(entry_payload.get("request_scope", "")),
				"server_confirmation_status": String(entry_payload.get("server_confirmation_status", "")),
				"client_result_authoritative": bool(entry_request.get("client_result_authoritative", true)) or bool(entry_payload.get("client_result_authoritative", true)),
				"last_error_code": String(entry_result.get("last_error_code", "")),
			})
		"request_activity_claim":
			var claim_kind := String(row.get("activity_kind", ""))
			var claim_id := String(row.get("activity_id", ""))
			var claim_response: Dictionary = _request_activity_claim(claim_kind, claim_id)
			var claim_request: Dictionary = claim_response.get("request", {})
			return _set_ui_action_result(bool(claim_response.get("ok", false)), action, {
				"claim_kind": claim_kind,
				"claim_id": claim_id,
				"duplicate": bool(claim_response.get("duplicate", false)),
				"status": String(claim_request.get("status", "")),
				"authoritative": bool(claim_request.get("client_result_authoritative", true)),
				"reason": String(claim_response.get("reason", "")),
			})
		"dismiss_announcement":
			var announcement_result: Dictionary = social_hub_model.dismiss_announcement(String(row.get("id", "")))
			return _set_ui_action_result(bool(announcement_result.get("ok", false)), action, announcement_result)
		"invite_friend":
			var invite_result: Dictionary = social_hub_model.invite_friend(String(row.get("id", "")))
			var invite_request: Dictionary = invite_result.get("request", {})
			return _set_ui_action_result(bool(invite_result.get("ok", false)), action, {
				"friend_id": String(invite_request.get("friend_id", row.get("id", ""))),
				"status": String(invite_request.get("status", "")),
				"authoritative": bool(invite_request.get("client_result_authoritative", true)),
				"reason": String(invite_result.get("reason", "")),
			})
		"open_social_link":
			var link_result: Dictionary = social_hub_model.open_social_link(String(row.get("id", "")))
			return _set_ui_action_result(bool(link_result.get("ok", false)), action, link_result)
		"advance_queue":
			var queue_status := String(matchmaking_model.queue_status if matchmaking_model != null else "")
			if queue_status == "idle" or queue_status == "cancelled":
				var queue_result: Dictionary = _join_match_queue()
				return _set_ui_action_result(bool(queue_result.get("ok", false)), "join_queue", {"status": String(queue_result.get("status", ""))})
			if queue_status == "queued":
				var found_result: Dictionary = _simulate_match_found()
				return _set_ui_action_result(bool(found_result.get("ok", false)), "simulate_match_found", {"status": String(found_result.get("status", ""))})
			if queue_status == "found":
				var ready_ok: bool = _ready_match()
				return _set_ui_action_result(ready_ok, "ready_match")
			if queue_status == "ready":
				var snapshot: Dictionary = matchmaking_model.queue_snapshot(true)
				var begin_ok: bool = _begin_network_match_from_queue(snapshot)
				if begin_ok:
					_open_ui_screen("network_match")
				return _set_ui_action_result(begin_ok, "begin_network_match", {"match_id": String(snapshot.get("match_id", ""))})
			return _set_ui_action_result(false, action, {"status": queue_status})
		"ready_match":
			var ready_ok_direct: bool = _ready_match()
			return _set_ui_action_result(ready_ok_direct, action)
		"cancel_queue":
			var cancel_ok: bool = _cancel_match_queue()
			return _set_ui_action_result(cancel_ok, action)
		"finish_reconnect":
			var reconnect_result: Dictionary = _finish_match_reconnect(true)
			return _set_ui_action_result(bool(reconnect_result.get("ok", false)), action)
		"network_ready":
			var network_ready_ok: bool = _network_match_ready()
			return _set_ui_action_result(network_ready_ok, action)
		"request_full_snapshot":
			var request: Dictionary = _network_request_full_snapshot("ui")
			return _set_ui_action_result(String(request.get("type", "")) == "request_full_snapshot", action)
		"cycle_network_quality":
			var next_profile: Dictionary = _next_network_profile()
			_set_network_quality(int(next_profile.get("ping_ms", 42)), float(next_profile.get("packet_loss", 0.0)), int(next_profile.get("jitter_ms", 4)))
			_network_update_latency_profile(int(next_profile.get("ping_ms", 42)), float(next_profile.get("packet_loss", 0.0)), int(next_profile.get("jitter_ms", 4)))
			return _set_ui_action_result(true, action, next_profile)
		_:
			return _set_ui_action_result(false, action, {"id": String(row.get("id", ""))})

func _reset_ui_control(row: Dictionary) -> Dictionary:
	var action := String(row.get("ui_action", ""))
	match action:
		"cycle_input_profile":
			var input_ok: bool = input_profile.reset_profile()
			return _set_ui_action_result(input_ok, "reset_input_profile", {"profile": input_profile.profile_name()})
		"cycle_input_binding":
			var binding_action: StringName = StringName(String(row.get("action", "")))
			var binding_result: Dictionary = input_profile.reset_binding(binding_action)
			return _set_ui_action_result(bool(binding_result.get("ok", false)), "reset_input_binding", binding_result)
		"cycle_gamepad_curve":
			return _set_ui_action_result(true, "reset_gamepad_curve", {"curve": input_profile.reset_gamepad_curve()})
		"cycle_language":
			localization.set_locale(LocalizationLib.DEFAULT_LOCALE)
			_load_active_theme_text()
			return _set_ui_action_result(true, "reset_language", {"locale": localization.locale, "label": localization.locale_label()})
		"cycle_voice_locale":
			audio_settings.set_voice_locale(AudioSettingsLib.DEFAULT_VOICE_LOCALE)
			return _set_ui_action_result(true, "reset_voice_locale", {"voice_locale": audio_settings.voice_locale, "label": audio_settings.voice_locale_label()})
		"adjust_gamepad_sensitivity":
			return _set_ui_action_result(true, "reset_gamepad_sensitivity", {"sensitivity": input_profile.reset_gamepad_sensitivity()})
		"adjust_gamepad_deadzone":
			return _set_ui_action_result(true, "reset_gamepad_deadzone", {"deadzone": input_profile.reset_gamepad_deadzone()})
		"adjust_gamepad_vibration":
			return _set_ui_action_result(true, "reset_gamepad_vibration", {"vibration": input_profile.reset_gamepad_vibration()})
		"adjust_audio_volume":
			var group: String = String(row.get("group", ""))
			var audio_ok: bool = audio_settings.reset_volume(group)
			if audio_ok:
				_apply_audio_settings()
			return _set_ui_action_result(audio_ok, "reset_audio_volume", {"group": group, "volume": audio_settings.volume_for(group)})
		"toggle_event_visual_cues":
			audio_settings.event_visual_cues = AudioSettingsLib.DEFAULT_EVENT_VISUAL_CUES
			return _set_ui_action_result(true, "reset_audio_cues", {"enabled": audio_settings.event_visual_cues})
		"toggle_high_frequency_graze_audio":
			audio_settings.high_frequency_graze_audio = AudioSettingsLib.DEFAULT_HIGH_FREQUENCY_GRAZE_AUDIO
			return _set_ui_action_result(true, "reset_graze_audio", {"enabled": audio_settings.high_frequency_graze_audio})
		"cycle_resolution":
			var resolution_text: String = display_settings.reset_resolution()
			_apply_display_settings(true)
			return _set_ui_action_result(true, "reset_resolution", {"resolution": resolution_text})
		"cycle_window_mode":
			var window_mode_text: String = display_settings.reset_window_mode()
			_apply_display_settings(true)
			return _set_ui_action_result(true, "reset_window_mode", {"window_mode": window_mode_text})
		"toggle_vsync":
			var vsync_enabled: bool = display_settings.reset_vsync()
			_apply_display_settings(true)
			return _set_ui_action_result(true, "reset_vsync", {"enabled": vsync_enabled})
		"cycle_fps_limit":
			var fps_limit: int = display_settings.reset_fps_limit()
			_apply_display_settings(true)
			return _set_ui_action_result(true, "reset_fps_limit", {"fps_limit": fps_limit})
		"adjust_screen_shake":
			return _set_ui_action_result(true, "reset_screen_shake", {"screen_shake": display_settings.reset_screen_shake()})
		"adjust_background_dim":
			return _set_ui_action_result(true, "reset_background_dim", {"background_dim": display_settings.reset_background_dim()})
		"toggle_low_flash":
			return _set_ui_action_result(true, "reset_low_flash", {"enabled": accessibility_settings.reset_low_flash()})
		"toggle_simplified_background":
			return _set_ui_action_result(true, "reset_simplified_background", {"enabled": accessibility_settings.reset_simplified_background()})
		"toggle_always_show_hitbox":
			return _set_ui_action_result(true, "reset_hitbox", {"enabled": accessibility_settings.reset_always_show_hitbox()})
		"toggle_practice_graze_ring":
			return _set_ui_action_result(true, "reset_graze_ring", {"enabled": accessibility_settings.reset_practice_graze_ring()})
		"cycle_palette":
			return _set_ui_action_result(true, "reset_palette", {"palette": accessibility_settings.reset_palette()})
		"adjust_bullet_alpha":
			return _set_ui_action_result(true, "reset_bullet_alpha", {"alpha": accessibility_settings.reset_bullet_alpha()})
		_:
			return _set_ui_action_result(false, "reset_selected", {"id": String(row.get("id", ""))})

func _ui_action_direction(row: Dictionary) -> int:
	var direction := int(row.get("direction", 1))
	return -1 if direction < 0 else 1

func _run_gensoulkyo_ui_action(row: Dictionary) -> void:
	await _dispatch_gensoulkyo_ui_action(row)

func _dispatch_gensoulkyo_ui_action(row: Dictionary) -> Dictionary:
	var action := String(row.get("ui_action", ""))
	var transport_result: Dictionary = {}
	match action:
		"gensoulkyo_login":
			transport_result = await _gensoulkyo_login_and_bootstrap("spellkard-ui", "SpellKard UI")
		"gensoulkyo_sync_inventory":
			transport_result = await _gensoulkyo_sync_inventory()
		"gensoulkyo_sync_decks":
			transport_result = await _gensoulkyo_sync_decks()
		"gensoulkyo_save_deck":
			transport_result = await _gensoulkyo_save_active_deck(true)
		"gensoulkyo_sync_chests":
			transport_result = await _gensoulkyo_sync_chests()
		"gensoulkyo_open_chest":
			transport_result = await _gensoulkyo_open_chest(String(row.get("pool_id", "local_basic")), int(row.get("open_count", 1)))
		"gensoulkyo_upgrade_card":
			transport_result = await _gensoulkyo_upgrade_card(String(row.get("card_id", "focus_lens")), int(row.get("target_level", 0)))
		"gensoulkyo_create_room":
			transport_result = await _gensoulkyo_create_room()
		"gensoulkyo_set_join_room":
			transport_result = _gensoulkyo_set_pending_room_code()
		"gensoulkyo_join_room":
			var room_code := String(gensoulkyo_api_model.get("pending_join_room_code")) if gensoulkyo_api_model != null else ""
			transport_result = await _gensoulkyo_join_room(room_code)
		"gensoulkyo_poll_ticket":
			transport_result = await _gensoulkyo_poll_ticket()
		"gensoulkyo_cancel_ticket":
			transport_result = await _gensoulkyo_cancel_ticket()
		"gensoulkyo_heartbeat":
			transport_result = await _gensoulkyo_heartbeat()
		"gensoulkyo_server_ready":
			transport_result = await _gensoulkyo_ready()
		"gensoulkyo_poll_events":
			transport_result = await _gensoulkyo_poll_events()
		"gensoulkyo_rematch":
			transport_result = await _gensoulkyo_rematch()
		_:
			transport_result = {"ok": false, "last_error_code": "action_unknown"}
	return _set_ui_action_result(bool(transport_result.get("ok", false)), action, _transport_ui_extra(transport_result))

func _transport_ui_extra(transport_result: Dictionary) -> Dictionary:
	var extra: Dictionary = {
		"transport_ok": bool(transport_result.get("ok", false)),
		"last_error_code": String(transport_result.get("last_error_code", "none")),
	}
	for key in ["http_status", "status", "ticket_id", "match_id", "new_match_id", "room_code", "url", "mode_id", "action_id", "action_type", "accepted", "accepted_count", "required_players", "presence_status", "match_tick", "latest_event_cursor", "server_authoritative", "item_count", "deck_count", "active_deck_id", "pool_count", "result_count", "pool_id", "count", "card_id", "new_level", "cost", "certification_rating", "certification_rank_score", "certification_top30", "certification_delta"]:
		if transport_result.has(key):
			extra[key] = transport_result.get(key)
	return extra

func _next_network_profile() -> Dictionary:
	var current_ping := int(matchmaking_model.ping_ms if matchmaking_model != null else 42)
	if current_ping <= 45:
		return {"ping_ms": 95, "packet_loss": 0.01, "jitter_ms": 18}
	if current_ping <= 100:
		return {"ping_ms": 220, "packet_loss": 0.04, "jitter_ms": 40}
	return {"ping_ms": 42, "packet_loss": 0.0, "jitter_ms": 4}

func _ui_screen_rows(limit: int = 12) -> Array[Dictionary]:
	if ui_screen_model == null:
		return []
	return _decorate_client_experience_rows(ui_screen_model.screen_rows(limit))

func _decorate_client_experience_rows(rows: Array[Dictionary]) -> Array[Dictionary]:
	var decorated: Array[Dictionary] = []
	for source_row in rows:
		var row := source_row.duplicate(true)
		_decorate_gamepad_speed_preview(row)
		decorated.append(row)
	return decorated

func _decorate_gamepad_speed_preview(row: Dictionary) -> void:
	if input_profile == null or not input_profile.has_method("movement_speed_preview_summary"):
		return
	var row_id := String(row.get("id", ""))
	if row_id != "gamepad_curve" and row_id != "gamepad_curve_preview":
		return
	var move_speed: float = character_model.move_speed(false) if character_model != null else PLAYER_SPEED
	var focus_speed: float = character_model.move_speed(true) if character_model != null else FOCUS_SPEED
	row["speed_preview"] = input_profile.movement_speed_preview_summary(move_speed, focus_speed)
	row["speed_samples"] = input_profile.movement_speed_preview_samples(move_speed, focus_speed)
	row["summary"] = "%s | %s" % [String(row.get("summary", "")), String(row.get("speed_preview", ""))]

func _ui_page_layout() -> Dictionary:
	if ui_screen_model != null and ui_screen_model.has_method("page_layout"):
		var layout_value: Variant = ui_screen_model.page_layout()
		if typeof(layout_value) == TYPE_DICTIONARY:
			return (layout_value as Dictionary).duplicate(true)
	var screen_id := String(ui_screen_model.current_screen if ui_screen_model != null else "")
	return {
		"screen": screen_id,
		"kind": "home_lobby" if screen_id == "main_menu" else "standard",
		"show_home": screen_id == "main_menu",
		"show_secondary_shell": screen_id != "main_menu" and screen_id != "practice",
		"show_gameplay": screen_id == "practice",
		"advance_gameplay": screen_id == "practice",
		"panel_anchor": "none" if screen_id == "practice" else ("full" if screen_id == "main_menu" else "right"),
		"panel_width_ratio": 0.0 if screen_id == "practice" else (1.0 if screen_id == "main_menu" else 0.48),
	}

func _should_show_ui_shell(page_layout: Dictionary = {}) -> bool:
	if not ui_overlay_visible:
		return false
	var layout := page_layout
	if layout.is_empty():
		layout = _ui_page_layout()
	return bool(layout.get("show_home", _is_home_screen())) or bool(layout.get("show_secondary_shell", true))

func _is_gameplay_view_unobstructed() -> bool:
	var page_layout := _ui_page_layout()
	return bool(page_layout.get("show_gameplay", false)) and not bool(page_layout.get("show_secondary_shell", true))

func _open_chest(pool_id: String = "local_basic", count: int = 1) -> Dictionary:
	if chest_system == null:
		return {"ok": false, "reason": "missing"}
	var result: Dictionary = chest_system.open_chest(pool_id, count)
	_update_ui_overlay()
	return result

func _set_test_viewport_size(size: Vector2) -> Dictionary:
	get_window().size = Vector2i(int(size.x), int(size.y))
	_update_ui_overlay()
	return _ui_overlay_snapshot()

func _ui_overlay_snapshot() -> Dictionary:
	var rows: Array[Dictionary] = []
	if ui_screen_model != null:
		rows = _decorate_client_experience_rows(ui_screen_model.screen_rows(64))
	var selected: Dictionary = _decorated_ui_selected_row()
	var page_layout := _ui_page_layout()
	var overlap_check := _ui_visible_control_overlap_check()
	var focus_check := _ui_visible_focus_health_check()
	var text_fit_check := _ui_visible_text_fit_check()
	var label_fit_check := _ui_visible_label_text_fit_check()
	var mouse_check := _ui_visible_mouse_health_check()
	var focus_section_check := _ui_focus_section_runtime_check(page_layout)
	var selected_window_check := _ui_selected_row_window_check()
	var viewport_size := get_viewport_rect().size
	var panel_rect := Rect2(ui_panel.position, ui_panel.size) if ui_panel != null else Rect2()
	var portrait_rect := Rect2(ui_home_portrait_panel.global_position, ui_home_portrait_panel.size) if ui_home_portrait_panel != null else Rect2()
	var home_menu_rect := Rect2(ui_home_menu_box.global_position, ui_home_menu_box.size) if ui_home_menu_box != null else Rect2()
	var home_buttons_rect := Rect2(ui_home_buttons_box.global_position, ui_home_buttons_box.size) if ui_home_buttons_box != null else Rect2()
	var home_dashboard_rect := Rect2(ui_home_dashboard_box.global_position, ui_home_dashboard_box.size) if ui_home_dashboard_box != null else Rect2()
	var scene_id := String(page_layout.get("scene_id", ""))
	var scene_missing := _ui_string_array(ui_scene_missing_bindings.get(scene_id, []))
	return {
		"visible": ui_overlay_visible and ui_panel != null and ui_panel.visible,
		"screen": ui_screen_model.current_screen if ui_screen_model != null else "",
		"layout_kind": String(page_layout.get("kind", "")),
		"layout_anchor": String(page_layout.get("panel_anchor", "")),
		"layout_category": String(page_layout.get("category", "")),
		"layout_parent": String(page_layout.get("parent", "")),
		"layout_density": String(page_layout.get("density", "")),
		"layout_scene_id": String(page_layout.get("scene_id", "")),
		"layout_scene_path": String(page_layout.get("scene_path", "")),
		"layout_scene_family": String(page_layout.get("scene_family", "")),
		"layout_scene_backed": ui_scene_roots.has(scene_id),
		"layout_scene_bound_count": int(ui_scene_binding_counts.get(scene_id, 0)),
		"layout_scene_missing_bindings": ",".join(scene_missing),
		"layout_show_gameplay": bool(page_layout.get("show_gameplay", false)),
		"layout_advance_gameplay": bool(page_layout.get("advance_gameplay", false)),
		"layout_show_secondary_shell": bool(page_layout.get("show_secondary_shell", true)),
		"gameplay_unobstructed": _is_gameplay_view_unobstructed(),
		"page_primary_ids": ",".join(_ui_string_array(page_layout.get("primary_row_ids", []))),
		"page_secondary_ids": ",".join(_ui_string_array(page_layout.get("secondary_row_ids", []))),
		"page_setting_groups": ",".join(_ui_string_array(page_layout.get("setting_groups", []))),
		"page_social_groups": ",".join(_ui_string_array(page_layout.get("social_groups", []))),
		"page_mode_groups": ",".join(_ui_string_array(page_layout.get("mode_groups", []))),
		"page_task_groups": ",".join(_ui_string_array(page_layout.get("player_task_groups", []))),
		"page_state_regions": ",".join(_ui_string_array(page_layout.get("state_regions", []))),
		"page_status_regions": ",".join(_ui_string_array(page_layout.get("status_region_ids", []))),
		"page_layout_slots": ",".join(_ui_string_array(page_layout.get("layout_slots", []))),
		"page_controller_actions": ",".join(_ui_string_array(page_layout.get("controller_actions", []))),
		"page_focus_action_ids": ",".join(_ui_string_array(page_layout.get("focus_action_ids", []))),
		"page_asset_usage": ",".join(_ui_string_array(page_layout.get("asset_usage", []))),
		"page_input_methods": ",".join(_ui_string_array(page_layout.get("input_methods", []))),
		"page_focus_sections": ",".join(_ui_string_array(page_layout.get("focus_sections", []))),
		"page_focus_sections_visible": String(focus_section_check.get("visible_sections", "")),
		"page_focus_sections_missing_visible": String(focus_section_check.get("missing_sections", "")),
		"selected_row_visible": bool(selected_window_check.get("visible", true)),
		"selected_row_id": String(selected_window_check.get("selected_id", "")),
		"selected_row_index": int(selected_window_check.get("selected_index", -1)),
		"visible_row_window_ids": String(selected_window_check.get("visible_ids", "")),
		"visible_row_window_indices": String(selected_window_check.get("visible_indices", "")),
		"page_text_fit_policy": ",".join(_ui_string_array(page_layout.get("text_fit_policy", []))),
		"page_visual_asset": String(page_layout.get("visual_asset", "")),
		"page_visual_treatment": String(page_layout.get("visual_treatment", "")),
		"page_standee_asset": String(page_layout.get("standee_asset", "")),
		"page_frame_asset": String(page_layout.get("frame_asset", "")),
		"page_required_bindings": ",".join(_ui_string_array(page_layout.get("required_bindings", []))),
		"page_render_slots": ",".join(_ui_string_array(page_layout.get("render_slots", []))),
		"page_primary_count": int(page_layout.get("primary_count", 0)),
		"page_secondary_count": int(page_layout.get("secondary_count", 0)),
		"page_task_count": int(page_layout.get("player_task_count", 0)),
		"page_state_region_count": int(page_layout.get("state_region_count", 0)),
		"page_status_region_count": int(page_layout.get("status_region_count", 0)),
		"page_layout_slot_count": int(page_layout.get("layout_slot_count", 0)),
		"page_controller_action_count": int(page_layout.get("controller_action_count", 0)),
		"page_focus_action_count": int(page_layout.get("focus_action_count", 0)),
		"page_asset_usage_count": int(page_layout.get("asset_usage_count", 0)),
		"page_input_method_count": int(page_layout.get("input_method_count", 0)),
		"page_focus_section_count": int(page_layout.get("focus_section_count", 0)),
		"page_focus_section_visible_count": int(focus_section_check.get("visible_count", 0)),
		"page_focus_section_missing_visible_count": int(focus_section_check.get("missing_count", 0)),
		"page_text_fit_policy_count": int(page_layout.get("text_fit_policy_count", 0)),
		"viewport_size": viewport_size,
		"home_visible": _is_home_screen() and ui_home_box != null and ui_home_box.visible,
		"secondary_visible": not _is_home_screen() and ui_root_box != null and ui_root_box.visible,
		"gameplay_visible": _should_draw_gameplay_scene(),
		"hud_visible": hud.visible,
		"panel_position": ui_panel.position if ui_panel != null else Vector2.ZERO,
		"panel_size": ui_panel.size if ui_panel != null else Vector2.ZERO,
		"panel_rect": panel_rect,
		"home_compact": ui_home_box != null and ui_home_box.vertical,
		"home_menu_size": home_menu_rect.size,
		"home_menu_rect": home_menu_rect,
		"home_buttons_size": home_buttons_rect.size,
		"home_buttons_rect": home_buttons_rect,
		"home_dashboard_size": home_dashboard_rect.size,
		"home_dashboard_rect": home_dashboard_rect,
		"home_dashboard_cards": _ui_overlay_focusable_count(ui_home_dashboard_buttons),
		"home_dashboard_text": _ui_home_dashboard_text(),
		"home_portrait_visible": ui_home_portrait_panel != null and ui_home_portrait_panel.visible,
		"home_portrait_size": portrait_rect.size,
		"home_portrait_rect": portrait_rect,
		"home_title": ui_home_title_label.text if ui_home_title_label != null else "",
		"home_status": ui_home_status_label.text if ui_home_status_label != null else "",
		"home_buttons": _ui_overlay_focusable_count(ui_home_buttons),
		"home_buttons_text": _ui_home_buttons_text(),
		"nav_rows": _ui_nav_overlay_nonempty_rows(),
		"nav_text": _ui_nav_overlay_text(),
		"nav_buttons": _ui_overlay_focusable_count(ui_nav_row_labels),
		"category_buttons": _ui_overlay_focusable_count(ui_category_buttons),
		"category_tabs_text": _ui_category_tabs_text(),
		"row_count": ui_row_labels.size(),
		"row_buttons": _ui_overlay_focusable_count(ui_row_labels),
		"section_buttons": _ui_overlay_focusable_count(ui_section_buttons),
		"section_tabs": _ui_section_tabs_text(),
		"overview_cards": _ui_overlay_focusable_count(ui_overview_buttons),
		"overview_cards_text": _ui_overview_cards_text(),
		"quick_buttons": _ui_overlay_focusable_count(ui_quick_buttons),
		"quick_actions_text": _ui_quick_actions_text(),
		"control_buttons": _ui_overlay_focusable_count(ui_control_buttons),
		"control_buttons_text": _ui_control_buttons_text(),
		"nonempty_rows": _ui_overlay_nonempty_rows(),
		"title": ui_title_label.text if ui_title_label != null else "",
		"nav": ui_nav_label.text if ui_nav_label != null else "",
		"shell": ui_shell_label.text if ui_shell_label != null else "",
		"page_experience_text": ui_page_summary_label.text if ui_page_summary_label != null else "",
		"page_experience": _page_experience_summary(rows, selected, page_layout),
		"status_cards": _ui_overlay_focusable_count(ui_status_cards),
		"status_cards_text": _ui_status_cards_text(),
		"focus_panel": ui_focus_button.text if ui_focus_button != null and ui_focus_button.is_visible_in_tree() else "",
		"focus_action": String(ui_focus_button.get_meta("row_id", "")) if ui_focus_button != null and ui_focus_button.is_visible_in_tree() else "",
		"focus_actions_text": _ui_focus_action_text(),
		"focus_buttons": _ui_focus_button_count(),
		"section_summary": ui_section_label.text if ui_section_label != null else "",
		"control_preview": ui_control_label.text if ui_control_label != null else "",
		"status": ui_status_label.text if ui_status_label != null else "",
		"detail": ui_detail_label.text if ui_detail_label != null else "",
		"hint": ui_hint_label.text if ui_hint_label != null else "",
		"sections": _ui_section_summary(rows),
		"selected_section": _row_section_text(selected),
		"selected_control": _row_control_text(selected),
		"selected_control_state": _row_control_state_text(selected),
		"selected_speed_preview": String(selected.get("speed_preview", "")),
		"settings_snapshot": _player_settings_snapshot_summary(),
		"controls": _ui_control_summary(rows),
		"visible_control_count": int(overlap_check.get("control_count", 0)),
		"visible_control_overlap_count": int(overlap_check.get("overlap_count", 0)),
		"visible_control_overlaps": String(overlap_check.get("overlaps", "")),
		"visible_focusable_count": int(focus_check.get("focusable_count", 0)),
		"visible_focus_without_neighbor_count": int(focus_check.get("missing_neighbor_count", 0)),
		"visible_focus_without_neighbor": String(focus_check.get("missing_neighbors", "")),
		"visible_control_small_target_count": int(text_fit_check.get("small_target_count", 0)),
		"visible_control_small_targets": String(text_fit_check.get("small_targets", "")),
		"visible_text_unclipped_count": int(text_fit_check.get("unclipped_count", 0)),
		"visible_text_unclipped": String(text_fit_check.get("unclipped", "")),
		"visible_label_text_count": int(label_fit_check.get("label_count", 0)),
		"visible_label_unwrapped_count": int(label_fit_check.get("unwrapped_count", 0)),
		"visible_label_unwrapped": String(label_fit_check.get("unwrapped", "")),
		"visible_label_out_of_panel_count": int(label_fit_check.get("out_of_panel_count", 0)),
		"visible_label_out_of_panel": String(label_fit_check.get("out_of_panel", "")),
		"visible_mouse_operable_count": int(mouse_check.get("operable_count", 0)),
		"visible_mouse_blocked_count": int(mouse_check.get("blocked_count", 0)),
		"visible_mouse_blocked": String(mouse_check.get("blocked", "")),
		"debug_status": ui_screen_model.screen_summary() if ui_screen_model != null else "",
	}

func _ui_visible_control_overlap_check() -> Dictionary:
	var controls: Array[Dictionary] = []
	_append_visible_controls_for_overlap(controls, "home", ui_home_buttons)
	_append_visible_controls_for_overlap(controls, "nav", ui_nav_row_labels)
	_append_visible_controls_for_overlap(controls, "category", ui_category_buttons)
	_append_visible_controls_for_overlap(controls, "status", ui_status_cards)
	_append_visible_controls_for_overlap(controls, "section", ui_section_buttons)
	_append_visible_controls_for_overlap(controls, "overview", ui_overview_buttons)
	_append_visible_controls_for_overlap(controls, "quick", ui_quick_buttons)
	_append_visible_controls_for_overlap(controls, "control", ui_control_buttons)
	_append_visible_controls_for_overlap(controls, "row", ui_row_labels)
	var overlaps: Array[String] = []
	for i in range(controls.size()):
		var a: Dictionary = controls[i]
		var rect_a: Rect2 = a.get("rect", Rect2())
		for j in range(i + 1, controls.size()):
			var b: Dictionary = controls[j]
			var rect_b: Rect2 = b.get("rect", Rect2())
			if rect_a.intersects(rect_b, false):
				overlaps.append("%s:%s" % [String(a.get("id", "")), String(b.get("id", ""))])
	return {
		"control_count": controls.size(),
		"overlap_count": overlaps.size(),
		"overlaps": ",".join(overlaps),
	}

func _append_visible_controls_for_overlap(result: Array[Dictionary], group: String, controls: Array) -> void:
	for i in range(controls.size()):
		var value: Variant = controls[i]
		if not value is Control:
			continue
		var control := value as Control
		if not control.is_visible_in_tree():
			continue
		var rect := Rect2(control.global_position, control.size)
		if rect.size.x <= 1.0 or rect.size.y <= 1.0:
			continue
		result.append({
			"id": "%s%d" % [group, i],
			"rect": rect,
		})

func _ui_visible_focus_health_check() -> Dictionary:
	var controls := _visible_focus_controls()
	var missing: Array[String] = []
	for item in controls:
		var button := item.get("button", null) as Button
		if button == null:
			continue
		if button.focus_neighbor_top == NodePath() or button.focus_neighbor_bottom == NodePath() or button.focus_neighbor_left == NodePath() or button.focus_neighbor_right == NodePath():
			missing.append(String(item.get("id", "")))
	return {
		"focusable_count": controls.size(),
		"missing_neighbor_count": missing.size(),
		"missing_neighbors": ",".join(missing),
	}

func _ui_visible_text_fit_check() -> Dictionary:
	var controls := _visible_focus_controls()
	var small_targets: Array[String] = []
	var unclipped: Array[String] = []
	for item in controls:
		var button := item.get("button", null) as Button
		if button == null:
			continue
		if button.size.x < 44.0 or button.size.y < 22.0:
			small_targets.append(String(item.get("id", "")))
		if not button.text.is_empty() and (not button.clip_text or button.text_overrun_behavior != TextServer.OVERRUN_TRIM_ELLIPSIS):
			unclipped.append(String(item.get("id", "")))
	return {
		"small_target_count": small_targets.size(),
		"small_targets": ",".join(small_targets),
		"unclipped_count": unclipped.size(),
		"unclipped": ",".join(unclipped),
	}

func _ui_visible_label_text_fit_check() -> Dictionary:
	var labels := _visible_player_facing_labels()
	var unwrapped: Array[String] = []
	var out_of_panel: Array[String] = []
	var panel_rect := Rect2(ui_panel.global_position, ui_panel.size) if ui_panel != null else Rect2()
	for item in labels:
		var label := item.get("label", null) as Label
		if label == null:
			continue
		var label_id := String(item.get("id", ""))
		var requires_wrap := bool(item.get("requires_wrap", true))
		if requires_wrap and label.text.length() > 24 and label.autowrap_mode == TextServer.AUTOWRAP_OFF:
			unwrapped.append(label_id)
		if panel_rect.size.x > 1.0 and panel_rect.size.y > 1.0:
			var label_rect := Rect2(label.global_position, label.size)
			if label_rect.size.x > 1.0 and label_rect.size.y > 1.0 and not panel_rect.encloses(label_rect):
				out_of_panel.append(label_id)
	return {
		"label_count": labels.size(),
		"unwrapped_count": unwrapped.size(),
		"unwrapped": ",".join(unwrapped),
		"out_of_panel_count": out_of_panel.size(),
		"out_of_panel": ",".join(out_of_panel),
	}

func _ui_visible_mouse_health_check() -> Dictionary:
	var controls := _visible_focus_controls()
	var blocked: Array[String] = []
	for item in controls:
		var button := item.get("button", null) as Button
		if button == null:
			continue
		if button.mouse_filter == Control.MOUSE_FILTER_IGNORE or button.mouse_default_cursor_shape != Control.CURSOR_POINTING_HAND:
			blocked.append(String(item.get("id", "")))
	return {
		"operable_count": controls.size() - blocked.size(),
		"blocked_count": blocked.size(),
		"blocked": ",".join(blocked),
	}

func _ui_focus_section_runtime_check(page_layout: Dictionary) -> Dictionary:
	var expected_sections := _ui_string_array(page_layout.get("focus_sections", []))
	var visible_sections: Array[String] = []
	var missing_sections: Array[String] = []
	for section_id in expected_sections:
		if _ui_focus_section_visible_count(section_id) > 0:
			visible_sections.append(section_id)
		elif _ui_focus_section_is_contextual(section_id):
			continue
		else:
			missing_sections.append(section_id)
	return {
		"visible_count": visible_sections.size(),
		"missing_count": missing_sections.size(),
		"visible_sections": ",".join(visible_sections),
		"missing_sections": ",".join(missing_sections),
	}

func _ui_focus_section_is_contextual(section_id: String) -> bool:
	return section_id in ["control_buttons", "control_preview"]

func _ui_selected_row_window_check() -> Dictionary:
	if ui_screen_model == null:
		return {
			"visible": true,
			"selected_id": "",
			"selected_index": -1,
			"visible_ids": "",
			"visible_indices": "",
		}
	var selected: Dictionary = ui_screen_model.selected_row()
	var selected_id := String(selected.get("id", ""))
	var selected_index := int(ui_screen_model.cursor)
	var visible_ids: Array[String] = []
	var visible_indices: Array[String] = []
	var selected_visible := selected_id.is_empty() or _ui_overlay_focusable_count(ui_row_labels) == 0
	for button in ui_row_labels:
		if button == null or not button.is_visible_in_tree() or button.disabled:
			continue
		var row_index := int(button.get_meta("row_index", -1))
		var row_id := String(button.get_meta("row_id", ""))
		visible_indices.append(str(row_index))
		visible_ids.append(row_id)
		if row_index == selected_index and (row_id.is_empty() or row_id == selected_id):
			selected_visible = true
	return {
		"visible": selected_visible,
		"selected_id": selected_id,
		"selected_index": selected_index,
		"visible_ids": ",".join(visible_ids),
		"visible_indices": ",".join(visible_indices),
	}

func _ui_focus_section_visible_count(section_id: String) -> int:
	match section_id:
		"primary_routes":
			return _ui_overlay_focusable_count(ui_home_buttons)
		"navigation_rail":
			return _ui_overlay_focusable_count(ui_nav_row_labels)
		"category_tabs":
			return _ui_overlay_focusable_count(ui_category_buttons)
		"status_cards":
			return _ui_overlay_focusable_count(ui_status_cards)
		"focus_panel":
			return _ui_focus_button_count()
		"section_tabs", "social_tabs", "filter_tabs":
			return _ui_overlay_focusable_count(ui_section_buttons)
		"overview_cards", "setting_groups", "mode_cards", "mode_grid", "collection_grid", "notice_board":
			return _ui_overlay_focusable_count(ui_overview_buttons)
		"quick_routes":
			return _ui_overlay_focusable_count(ui_quick_buttons)
		"control_buttons":
			return _ui_overlay_focusable_count(ui_control_buttons)
		"row_window":
			return _ui_overlay_focusable_count(ui_row_labels)
		"control_preview":
			return 1 if ui_control_label != null and ui_control_label.is_visible_in_tree() and not ui_control_label.text.is_empty() else 0
	return 0

func _visible_focus_controls() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	_append_visible_focus_controls(result, "home", ui_home_buttons)
	_append_visible_focus_controls(result, "nav", ui_nav_row_labels)
	_append_visible_focus_controls(result, "category", ui_category_buttons)
	_append_visible_focus_controls(result, "status", ui_status_cards)
	_append_focus_button_for_health(result, "focus", ui_focus_button)
	_append_visible_focus_controls(result, "section", ui_section_buttons)
	_append_visible_focus_controls(result, "overview", ui_overview_buttons)
	_append_visible_focus_controls(result, "quick", ui_quick_buttons)
	_append_visible_focus_controls(result, "control", ui_control_buttons)
	_append_visible_focus_controls(result, "row", ui_row_labels)
	return result

func _append_visible_focus_controls(result: Array[Dictionary], group: String, controls: Array) -> void:
	for i in range(controls.size()):
		var value: Variant = controls[i]
		if not value is Button:
			continue
		_append_focus_button_for_health(result, "%s%d" % [group, i], value as Button)

func _append_focus_button_for_health(result: Array[Dictionary], control_id: String, button: Button) -> void:
	if button == null or not button.is_visible_in_tree() or button.disabled or button.focus_mode == Control.FOCUS_NONE:
		return
	result.append({
		"id": control_id,
		"button": button,
	})

func _visible_player_facing_labels() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	_append_visible_label_for_health(result, "title", ui_title_label, false)
	_append_visible_label_for_health(result, "nav_path", ui_nav_label)
	_append_visible_label_for_health(result, "shell", ui_shell_label)
	_append_visible_label_for_health(result, "page_summary", ui_page_summary_label)
	_append_visible_label_for_health(result, "section_summary", ui_section_label)
	_append_visible_label_for_health(result, "control_preview", ui_control_label)
	_append_visible_label_for_health(result, "status", ui_status_label)
	_append_visible_label_for_health(result, "detail", ui_detail_label)
	_append_visible_label_for_health(result, "hint", ui_hint_label)
	_append_visible_label_for_health(result, "home_portrait", ui_home_portrait_label)
	_append_visible_label_for_health(result, "home_status", ui_home_status_label)
	return result

func _append_visible_label_for_health(result: Array[Dictionary], label_id: String, label: Label, require_wrap: bool = true) -> void:
	if label == null or not label.is_visible_in_tree() or label.text.is_empty():
		return
	result.append({"id": label_id, "label": label, "requires_wrap": require_wrap})

func _ui_string_array(source: Variant) -> Array[String]:
	var values: Array[String] = []
	if typeof(source) != TYPE_ARRAY:
		return values
	for item in source as Array:
		values.append(String(item))
	return values

func _decorated_ui_selected_row() -> Dictionary:
	if ui_screen_model == null:
		return {}
	var selected: Dictionary = ui_screen_model.selected_row()
	if selected.is_empty():
		return {}
	var rows := _decorate_client_experience_rows([selected])
	return rows[0] if not rows.is_empty() else selected

func _player_settings_snapshot_summary() -> String:
	var parts: Array[String] = []
	if input_profile != null:
		parts.append("gamepad %s sens %.0f dz %.0f" % [
			input_profile.gamepad_curve(),
			float(input_profile.get("gamepad_sensitivity")) * 100.0,
			float(input_profile.get("gamepad_deadzone")) * 100.0,
		])
		parts.append("keys %s %s" % [
			input_profile.action_summary(&"shoot"),
			input_profile.action_summary(&"bomb"),
		])
	if audio_settings != null:
		parts.append("audio master %.0f music %.0f sfx %.0f" % [
			float(audio_settings.volume_for("master")) * 100.0,
			float(audio_settings.volume_for("music")) * 100.0,
			float(audio_settings.volume_for("sfx")) * 100.0,
		])
	if display_settings != null:
		parts.append("display %s %s fps %d" % [
			display_settings.resolution_text(),
			display_settings.window_mode(),
			int(display_settings.fps_limit()),
		])
	if player_settings_store != null:
		parts.append("store %s" % String(player_settings_store.get("last_status")))
	return " | ".join(parts)

func _page_experience_summary(rows: Array[Dictionary], selected: Dictionary, page_layout: Dictionary) -> Dictionary:
	var screen_id := String(page_layout.get("screen", ui_screen_model.current_screen if ui_screen_model != null else ""))
	var task_groups := _ui_string_array(page_layout.get("player_task_groups", []))
	var authority_summary := _page_authority_summary(screen_id, rows, selected)
	return {
		"screen": screen_id,
		"title": _screen_title(screen_id),
		"kind": String(page_layout.get("kind", "")),
		"category": String(page_layout.get("category", "")),
		"density": String(page_layout.get("density", "")),
		"tasks": task_groups,
		"task_text": _page_task_text(task_groups),
		"primary_text": _page_primary_action_text(rows, page_layout),
		"selected_text": _row_label_text(selected),
		"selected_section": _row_section_text(selected),
		"selected_control": _row_control_text(selected),
		"snapshot": _page_context_snapshot(screen_id),
		"authority_text": String(authority_summary.get("text", "")),
		"authority_scope": String(authority_summary.get("scope", "")),
		"authority_requires_server": bool(authority_summary.get("requires_server", false)),
		"authority_client_result_authoritative": bool(authority_summary.get("client_result_authoritative", false)),
		"visual_asset": String(page_layout.get("visual_asset", "")),
		"visual_treatment": String(page_layout.get("visual_treatment", "")),
		"state_regions": _ui_string_array(page_layout.get("state_regions", [])),
		"status_regions": _ui_string_array(page_layout.get("status_region_ids", [])),
		"layout_slots": _ui_string_array(page_layout.get("layout_slots", [])),
		"controller_actions": _ui_string_array(page_layout.get("controller_actions", [])),
		"focus_action_ids": _ui_string_array(page_layout.get("focus_action_ids", [])),
		"asset_usage": _ui_string_array(page_layout.get("asset_usage", [])),
	}

func _page_experience_text(summary: Dictionary) -> String:
	if summary.is_empty():
		return ""
	var parts: Array[String] = []
	parts.append(String(summary.get("title", "")))
	var primary_text := String(summary.get("primary_text", ""))
	if not primary_text.is_empty():
		parts.append(_trim_ui_card_text(primary_text, 72))
	var authority_text := String(summary.get("authority_text", ""))
	if not authority_text.is_empty():
		parts.append(_trim_ui_card_text(authority_text, 72))
	return " | ".join(parts)

func _page_authority_summary(screen_id: String, rows: Array[Dictionary], selected: Dictionary) -> Dictionary:
	if ["play", "match", "modes"].has(screen_id):
		var boss_row := _first_boss_authority_row(rows)
		if not boss_row.is_empty():
			return {
				"text": "Boss display local; damage rewards settlement server",
				"scope": "boss_server_settlement",
				"requires_server": bool(boss_row.get("requires_server_confirmation", true)),
				"client_result_authoritative": false,
				"row_id": String(boss_row.get("id", "")),
			}
	if screen_id == "replay":
		var replay_row := selected if not selected.is_empty() else _ui_find_row_by_id(rows, "replay_verification_summary")
		if replay_row.is_empty():
			replay_row = _first_replay_authority_row(rows)
		return {
			"text": "Replay hash local practice only; settlement rewards server",
			"scope": String(replay_row.get("local_hash_authority", "local_practice_verification_only")),
			"requires_server": bool(replay_row.get("requires_server_audit", false)),
			"client_result_authoritative": false,
			"row_id": String(replay_row.get("id", "")),
		}
	if String(selected.get("settlement_authority", "")) == "server" or String(selected.get("reward_authority", "")) == "server":
		return {
			"text": "Online outcome server authoritative",
			"scope": "server_settlement",
			"requires_server": bool(selected.get("requires_server_confirmation", false)),
			"client_result_authoritative": false,
			"row_id": String(selected.get("id", "")),
		}
	return {
		"text": "",
		"scope": "",
		"requires_server": false,
		"client_result_authoritative": false,
		"row_id": "",
	}

func _first_boss_authority_row(rows: Array[Dictionary]) -> Dictionary:
	for row in rows:
		if String(row.get("mode_category", "")) != "boss":
			continue
		if String(row.get("settlement_authority", "")) == "server" or bool(row.get("requires_server_confirmation", false)):
			return row
	return {}

func _first_replay_authority_row(rows: Array[Dictionary]) -> Dictionary:
	for row in rows:
		if not String(row.get("replay_id", "")).is_empty():
			return row
	return {}

func _page_task_text(task_groups: Array[String]) -> String:
	var labels: Array[String] = []
	for task_id in task_groups:
		var label := _page_task_label(String(task_id))
		if not label.is_empty():
			labels.append(label)
	return " / ".join(labels)

func _page_task_label(task_id: String) -> String:
	match task_id:
		"play":
			return localization.text_for("screen.main.play")
		"community":
			return localization.text_for("screen.main.community")
		"settings":
			return localization.text_for("screen.main.player_settings")
		"certification":
			return localization.text_for("screen.main.certification")
		"deck":
			return localization.text_for("screen.main.deck")
		"replay":
			return localization.text_for("screen.main.replay")
		"practice":
			return localization.text_for("screen.play.practice")
		"matchmaking":
			return localization.text_for("screen.play.matchmaking")
		"pvp":
			return "PvP"
		"boss":
			return "Boss"
		"room":
			return localization.text_for("screen.play.room")
		"queue":
			return localization.text_for("screen.match.status")
		"drill":
			return localization.text_for("screen.cert.local_drill")
		"rules":
			return localization.text_for("screen.cert.rules")
		"rating":
			return localization.text_for("screen.cert.summary")
		"quick":
			return localization.text_for("screen.match.quick")
		"ranked":
			return localization.text_for("screen.match.ranked")
		"activity", "events":
			return localization.text_for("screen.main.events")
		"friends", "presence", "invites":
			return localization.text_for("screen.main.friends")
		"social", "social_media":
			return localization.text_for("screen.main.social")
		"promotions", "promotion_links", "store", "creator":
			return localization.text_for("screen.main.promotions")
		"gamepad_curve":
			return localization.text_for("screen.settings.gamepad_curve")
		"keybinds":
			return localization.text_for("screen.settings.input_binding")
		"volume":
			return localization.text_for("screen.settings.volume")
		"resolution":
			return localization.text_for("screen.settings.resolution")
		"language":
			return localization.text_for("screen.settings.language")
		"voice":
			return localization.text_for("screen.settings.voice_language")
		"input_profile", "profile", "input":
			return localization.text_for("screen.settings.input_profile")
		"audio", "master", "music", "sfx", "ui":
			return localization.text_for("screen.settings.audio")
		"display", "window", "vsync", "fps":
			return localization.text_for("screen.settings.display")
		"speed_preview":
			return localization.text_for("screen.settings.gamepad_curve_preview")
		"storage":
			return localization.text_for("screen.settings.storage")
		"announcements":
			return localization.text_for("screen.social.announcement")
		"tasks", "claims":
			return localization.text_for("screen.activity.claim_log")
		"business_security":
			return "Business Security"
		"battle_transport":
			return "Battle Transport"
		"packet_scaffold":
			return "Packet Scaffold"
		"server_ready":
			return "Server Ready"
		_:
			return task_id.replace("_", " ").capitalize()

func _page_primary_action_text(rows: Array[Dictionary], page_layout: Dictionary) -> String:
	var labels: Array[String] = []
	var primary_ids := _ui_string_array(page_layout.get("primary_row_ids", []))
	for row_id in primary_ids:
		var found := _ui_find_row_by_id(rows, row_id)
		if int(found.get("row_index", -1)) < 0:
			continue
		var label := String(found.get("label", ""))
		if not label.is_empty():
			labels.append(label)
		if labels.size() >= 4:
			break
	return " / ".join(labels)

func _page_context_snapshot(screen_id: String) -> String:
	match screen_id:
		"play", "match", "certification":
			return client_shell_model.play_summary() if client_shell_model != null and client_shell_model.has_method("play_summary") else ""
		"network_match":
			return "%s | %s" % [
				network_security_model.summary() if network_security_model != null and network_security_model.has_method("summary") else "network scaffold",
				network_match_model.summary() if network_match_model != null and network_match_model.has_method("summary") else "authority offline",
			]
		"community", "activity", "friends", "social", "promotions":
			return client_shell_model.community_summary() if client_shell_model != null and client_shell_model.has_method("community_summary") else ""
		"player_settings", "input_settings", "audio_settings", "display_settings", "settings":
			return _player_settings_snapshot_summary()
		"deck", "chest":
			return deck_builder.summary(localization) if deck_builder != null and deck_builder.has_method("summary") else ""
		"replay":
			return _selected_replay_summary()
	return ""

func _ui_home_buttons_text() -> String:
	var parts: Array[String] = []
	for button in ui_home_buttons:
		if button.is_visible_in_tree() and not button.text.is_empty():
			parts.append(button.text.replace("\n", ": "))
	return " | ".join(parts)

func _ui_home_dashboard_text() -> String:
	var parts: Array[String] = []
	for button in ui_home_dashboard_buttons:
		if button.is_visible_in_tree() and not button.text.is_empty():
			parts.append(button.text.replace("\n", ": "))
	return " | ".join(parts)

func _ui_overlay_nonempty_rows() -> int:
	var count := 0
	for label in ui_row_labels:
		if label.is_visible_in_tree() and not label.text.is_empty():
			count += 1
	return count

func _ui_nav_overlay_nonempty_rows() -> int:
	var count := 0
	for label in ui_nav_row_labels:
		if label.is_visible_in_tree() and not label.text.is_empty():
			count += 1
	return count

func _ui_nav_overlay_text() -> String:
	var parts: Array[String] = []
	for label in ui_nav_row_labels:
		if label.is_visible_in_tree() and not label.text.is_empty():
			parts.append(label.text)
	return "\n".join(parts)

func _ui_overlay_focusable_count(buttons: Array[Button]) -> int:
	var count := 0
	for button in buttons:
		if button.is_visible_in_tree() and button.focus_mode != Control.FOCUS_NONE:
			count += 1
	return count

func _ui_section_tabs_text() -> String:
	var parts: Array[String] = []
	for button in ui_section_buttons:
		if button.is_visible_in_tree() and not button.text.is_empty():
			parts.append(button.text)
	return " | ".join(parts)

func _ui_category_tabs_text() -> String:
	var parts: Array[String] = []
	for button in ui_category_buttons:
		if button.is_visible_in_tree() and not button.text.is_empty():
			parts.append(button.text)
	return " | ".join(parts)

func _ui_status_cards_text() -> String:
	var parts: Array[String] = []
	for button in ui_status_cards:
		if button.is_visible_in_tree() and not button.text.is_empty():
			parts.append(button.text.replace("\n", ": "))
	return " | ".join(parts)

func _ui_focus_action_text() -> String:
	if ui_focus_button == null or not ui_focus_button.is_visible_in_tree():
		return ""
	return ui_focus_button.text.replace("\n", ": ")

func _ui_focus_button_count() -> int:
	if ui_focus_button == null or not ui_focus_button.is_visible_in_tree():
		return 0
	return 1 if ui_focus_button.focus_mode != Control.FOCUS_NONE else 0

func _ui_control_buttons_text() -> String:
	var parts: Array[String] = []
	for button in ui_control_buttons:
		if button.is_visible_in_tree() and not button.text.is_empty():
			parts.append(button.text)
	return " | ".join(parts)

func _ui_quick_actions_text() -> String:
	var parts: Array[String] = []
	for button in ui_quick_buttons:
		if button.is_visible_in_tree() and not button.text.is_empty():
			parts.append(button.text)
	return " | ".join(parts)

func _ui_overview_cards_text() -> String:
	var parts: Array[String] = []
	for button in ui_overview_buttons:
		if button.is_visible_in_tree() and not button.text.is_empty():
			parts.append(button.text.replace("\n", ": "))
	return " | ".join(parts)

func _is_home_screen() -> bool:
	return ui_screen_model != null and String(ui_screen_model.current_screen) == "main_menu"

func _home_primary_rows(rows: Array[Dictionary]) -> Array[Dictionary]:
	var priority: Array[String] = ["play", "collection", "community", "player_settings"]
	var result: Array[Dictionary] = []
	for row_id in priority:
		for row in rows:
			if String(row.get("id", "")) == row_id and bool(row.get("enabled", true)):
				result.append(row)
				break
	return result

func _home_status_text() -> String:
	if client_shell_model != null and client_shell_model.has_method("home_status_summary"):
		return String(client_shell_model.home_status_summary())
	return _ui_shell_status_text()

func _home_dashboard_rows() -> Array[Dictionary]:
	if client_shell_model != null and client_shell_model.has_method("home_dashboard_cards"):
		var cards_value: Variant = client_shell_model.home_dashboard_cards()
		if typeof(cards_value) == TYPE_ARRAY:
			var cards: Array[Dictionary] = []
			var raw_cards: Array = cards_value
			for card_value in raw_cards:
				if typeof(card_value) == TYPE_DICTIONARY:
					cards.append((card_value as Dictionary).duplicate(true))
			return cards
	return []

func _home_portrait_text() -> String:
	var character_name := "Balanced"
	var character_summary := "-"
	if character_model != null:
		var character: Dictionary = character_model.active_character()
		character_name = localization.text_for(String(character.get("name_key", "")))
		character_summary = character_model.summary()
	var deck_name := "-"
	if deck_builder != null:
		var deck_snapshot: Dictionary = deck_builder.active_deck_snapshot()
		deck_name = String(deck_snapshot.get("name", "-"))
	return "%s\n\n%s\nDeck %s" % [character_name, character_summary, deck_name]

func _format_home_button(row: Dictionary) -> String:
	var label := _row_label_text(row)
	var summary := String(row.get("summary", row.get("value", "")))
	if summary.is_empty():
		var target_screen := String(row.get("screen", ""))
		if not target_screen.is_empty():
			summary = _screen_title(target_screen)
	if summary.is_empty():
		return label
	return "%s\n%s" % [label, _trim_ui_card_text(summary, 44)]

func _update_ui_home_surface(rows: Array[Dictionary]) -> void:
	if ui_home_box == null:
		return
	ui_home_box.visible = _is_home_screen() and ui_overlay_visible
	if not ui_home_box.visible:
		_deactivate_home_ui_controls()
		return
	ui_home_title_label.text = "SpellKard"
	ui_home_status_label.text = _home_status_text()
	ui_home_portrait_label.text = _home_portrait_text()
	_update_ui_home_dashboard()
	var home_rows := _home_primary_rows(rows)
	for i in range(ui_home_buttons.size()):
		var button := ui_home_buttons[i]
		if i >= home_rows.size():
			_ui_deactivate_button(button, ["row_index", "row_id", "screen_id"])
			continue
		var row: Dictionary = home_rows[i]
		var row_index := _ui_row_index_by_id(rows, String(row.get("id", "")))
		var target_screen := String(row.get("screen", ""))
		button.visible = true
		button.disabled = row_index < 0 or target_screen.is_empty()
		_ui_mark_button_owner(button)
		button.set_meta("row_index", row_index)
		button.set_meta("row_id", String(row.get("id", "")))
		button.set_meta("screen_id", target_screen)
		button.text = _format_home_button(row)
		button.tooltip_text = _format_ui_row(row)

func _update_ui_home_dashboard() -> void:
	if ui_home_dashboard_box == null:
		return
	var cards := _home_dashboard_rows()
	var compact_home := ui_home_box != null and ui_home_box.vertical
	ui_home_dashboard_box.visible = false
	for i in range(ui_home_dashboard_buttons.size()):
		var button := ui_home_dashboard_buttons[i]
		if i >= cards.size():
			_ui_deactivate_button(button, ["screen_id", "dashboard_id"])
			continue
		var card: Dictionary = cards[i]
		var screen_id := String(card.get("screen", ""))
		button.visible = true
		button.disabled = screen_id.is_empty()
		_ui_mark_button_owner(button)
		button.set_meta("screen_id", screen_id)
		button.set_meta("dashboard_id", String(card.get("id", "")))
		var label_text := String(card.get("label", ""))
		var label_key := String(card.get("label_key", ""))
		if not label_key.is_empty():
			label_text = localization.text_for(label_key)
		button.text = "%s\n%s" % [
			_trim_ui_card_text(label_text, 18),
			_trim_ui_card_text(String(card.get("value", "")), 24),
		]
		button.tooltip_text = "%s: %s" % [label_text, String(card.get("value", ""))]

func _ui_row_index_by_id(rows: Array[Dictionary], row_id: String) -> int:
	if row_id.is_empty():
		return -1
	for i in range(rows.size()):
		if String(rows[i].get("id", "")) == row_id:
			return i
	return -1

func _on_ui_home_button_pressed(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var row_index := int(button.get_meta("row_index", -1))
	if row_index >= 0:
		_ui_set_cursor(row_index)
	_ui_accept_selected()

func _on_ui_home_dashboard_button_pressed(button: Button) -> void:
	if button == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var screen_id := String(button.get_meta("screen_id", ""))
	if not screen_id.is_empty():
		_open_ui_screen(screen_id)

func _ui_press_visible_home_button(index: int) -> Dictionary:
	if index < 0 or index >= ui_home_buttons.size():
		return {"ok": false, "action": "home_button_invalid"}
	var button := ui_home_buttons[index]
	if button == null or not button.is_visible_in_tree():
		return {"ok": false, "action": "home_button_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "home_button_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var row_index := int(button.get_meta("row_index", -1))
	var row_id := String(button.get_meta("row_id", ""))
	var screen_id := String(button.get_meta("screen_id", ""))
	_on_ui_home_button_pressed(button)
	return {
		"ok": row_index >= 0 and not screen_id.is_empty(),
		"action": "home_button",
		"row_index": row_index,
		"row_id": row_id,
		"screen": screen_id,
	}

func _ui_press_visible_home_dashboard(index: int) -> Dictionary:
	if index < 0 or index >= ui_home_dashboard_buttons.size():
		return {"ok": false, "action": "home_dashboard_invalid"}
	var button := ui_home_dashboard_buttons[index]
	if button == null or not button.is_visible_in_tree():
		return {"ok": false, "action": "home_dashboard_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "home_dashboard_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var screen_id := String(button.get_meta("screen_id", ""))
	var dashboard_id := String(button.get_meta("dashboard_id", ""))
	_on_ui_home_dashboard_button_pressed(button)
	return {
		"ok": not screen_id.is_empty(),
		"action": "home_dashboard",
		"dashboard_id": dashboard_id,
		"screen": screen_id,
		"current_screen": ui_screen_model.current_screen if ui_screen_model != null else "",
	}

func _prewarm_to_start_tick() -> void:
	practice_prewarping = true
	var saved_recorder: RefCounted = replay_recorder
	replay_recorder = ReplayRecorderLib.new()
	replay_recorder.configure(active_match_seed)
	while tick < practice_start_tick:
		_fixed_tick()
	replay_recorder = saved_recorder
	replay_recorder.configure(active_match_seed)
	performance_stats = PerformanceStatsLib.new()
	accumulator = 0.0
	practice_prewarping = false

func _update_stage_run() -> void:
	if not stage_run_enabled or replay_mode or stage_select_model == null:
		return
	var patterns: Array[Dictionary] = stage_select_model.active_patterns()
	if patterns.is_empty():
		stage_run_enabled = false
		return
	stage_run_phase_count = patterns.size()
	var elapsed: int = max(0, tick - stage_run_start_tick)
	var expected_index: int = clampi(elapsed / STAGE_RUN_PHASE_TICKS, 0, patterns.size() - 1)
	if expected_index != stage_run_phase_index:
		stage_run_phase_index = expected_index
		stage_select_model.select_pattern_index(stage_run_phase_index)
		_refresh_pattern_configs_from_stage()
		_reset_pattern_runtime(false)
		replay_recorder.record_event(tick, "stage_phase", {
			"stage_id": String(stage_select_model.selected_stage_id),
			"phase_index": stage_run_phase_index,
			"pattern_id": String(stage_select_model.active_pattern().get("id", "")),
		})
	stage_run_phase_tick = elapsed - stage_run_phase_index * STAGE_RUN_PHASE_TICKS

func _update_pattern() -> void:
	if _update_boss_spellbook_pattern():
		return
	_update_stage_run()
	var base_config := _active_pattern_config()
	if base_config.is_empty():
		return
	var combined_modifiers: Dictionary = pattern_modifiers.duplicate(true)
	for key in active_modifiers.keys():
		combined_modifiers[key] = active_modifiers[key]
	var config: Dictionary = BulletMathLib.apply_modifiers(base_config, combined_modifiers)
	var interval: int = max(1, int(config.get("interval_ticks", 30)))
	if tick % interval != 0:
		return
	var spawned: Array[Dictionary] = BulletPatterns.emit_pattern(config, tick, player_pos, spawn_index, active_match_seed)
	_apply_spawn_visual_metadata(spawned, _has_active_pattern_visual_modifier(combined_modifiers))
	_spawn_bullets(spawned)

func _update_boss_spellbook_pattern() -> bool:
	if not boss_spellbook_run_enabled or replay_mode or boss_spellbook_model == null:
		return false
	if not boss_spellbook_model.has_method("emit_tick"):
		return false
	var total_ticks: int = 0
	if boss_spellbook_model.has_method("spellbook_config") and boss_spellbook_model.has_method("total_ticks"):
		var spellbook: Dictionary = boss_spellbook_model.spellbook_config(boss_spellbook_id)
		if spellbook.is_empty():
			_stop_boss_spellbook_run(false)
			return false
		total_ticks = int(boss_spellbook_model.total_ticks(spellbook))
	boss_spellbook_run_tick = max(0, tick - boss_spellbook_run_start_tick)
	if total_ticks > 0 and boss_spellbook_run_tick >= total_ticks:
		boss_spellbook_run_tick = boss_spellbook_run_tick % total_ticks
		boss_spellbook_run_start_tick = tick - boss_spellbook_run_tick
	var spawned: Array[Dictionary] = boss_spellbook_model.emit_tick(boss_spellbook_id, boss_spellbook_run_tick, player_pos, spawn_index, active_match_seed)
	_apply_spawn_visual_metadata(spawned, false)
	_spawn_bullets(spawned)
	return true

func _spawn_bullets(new_bullets: Array[Dictionary]) -> void:
	if bullets.size() + new_bullets.size() > MAX_BULLETS:
		delayed_spawn_count += 1
		performance_stats.record_spawn_limit_event()
		replay_recorder.record_event(tick, "spawn_limit", {"requested": new_bullets.size(), "current": bullets.size(), "limit": MAX_BULLETS})
		return
	bullets.append_array(new_bullets)
	spawn_index += new_bullets.size()
	_refresh_bullet_visuals()

func _update_bullets() -> void:
	var effective_hit_radius := HIT_RADIUS * float(self_modifiers.get("hit_radius_multiplier", 1.0))
	var result: Dictionary = BulletEngineLib.step_bullets(bullets, player_pos, tick, {
		"hit_radius": effective_hit_radius,
		"graze_radius": GRAZE_RADIUS,
		"player_id": "local",
		"fixed_delta": FIXED_DELTA,
		"allow_hit": invuln_ticks <= 0,
		"remove_on_hit": false,
	})
	performance_stats.record_collision_checks(int(result.get("collision_checks", 0)))
	var spawned_by_behavior: Array[Dictionary] = result.get("spawned", [])
	if not spawned_by_behavior.is_empty():
		_apply_child_visual_metadata_from_result(spawned_by_behavior)
	for event in result.get("events", []):
		var event_dict: Dictionary = event
		match String(event_dict.get("type", "")):
			"graze":
				_apply_graze_event(event_dict.get("bullet", {}))
			"hit":
				_apply_hit_event(event_dict.get("bullet", {}))
	bullets = result.get("bullets", bullets)
	if bullets.size() > MAX_BULLETS:
		delayed_spawn_count += 1
		performance_stats.record_spawn_limit_event()
		replay_recorder.record_event(tick, "spawn_limit", {"requested": spawned_by_behavior.size(), "current": bullets.size(), "limit": MAX_BULLETS})
		bullets.resize(MAX_BULLETS)
	_refresh_bullet_visuals()

func _apply_spawn_visual_metadata(new_bullets: Array[Dictionary], card_modified: bool) -> void:
	for bullet in new_bullets:
		bullet["card_modified"] = card_modified

func _apply_child_visual_metadata(new_bullets: Array[Dictionary], parent_bullet: Dictionary) -> void:
	var parent_card_modified := bool(parent_bullet.get("card_modified", false))
	for bullet in new_bullets:
		bullet["card_modified"] = parent_card_modified

func _apply_child_visual_metadata_from_result(new_bullets: Array[Dictionary]) -> void:
	for bullet in new_bullets:
		if not bullet.has("card_modified"):
			bullet["card_modified"] = false

func _has_active_pattern_visual_modifier(modifiers: Dictionary) -> bool:
	var speed_changed := absf(float(modifiers.get("speed_multiplier", 1.0)) - 1.0) > 0.001
	var density_changed := absf(float(modifiers.get("density_multiplier", 1.0)) - 1.0) > 0.001
	var angle_changed := absf(float(modifiers.get("angle_offset", 0.0))) > 0.001
	var curve_changed := absf(float(modifiers.get("curve_strength", 0.0))) > 0.001
	var aim_changed := absf(float(modifiers.get("aim_bias", 0.0))) > 0.001
	return speed_changed or density_changed or angle_changed or curve_changed or aim_changed

func _refresh_bullet_visuals() -> void:
	if bullet_visual_model == null:
		return
	bullet_visual_model.annotate_bullets(bullets, bullets.size())

func _update_player_shots() -> void:
	for shot in player_shots:
		shot["pos"] += shot["vel"] * FIXED_DELTA
		if shot["pos"].distance_to(target_pos) <= TARGET_RADIUS + float(shot.get("radius", PLAYER_SHOT_RADIUS)):
			target_damage += int(shot.get("damage", 1))
			score += int(8.0 * multiplier)
			power = min(4.0, power + 0.004)
			card_system.add_energy(0.006)
			shot["pos"] = Vector2(-9999, -9999)
	player_shots = player_shots.filter(func(shot: Dictionary) -> bool:
		var pos: Vector2 = shot["pos"]
		return pos.y >= -32 and pos.y <= 752 and pos.x >= -32 and pos.x <= 992
	)

func _apply_graze_event(bullet: Dictionary) -> void:
	graze_count += 1
	combo += 1
	max_combo = max(max_combo, combo)
	var graze_value := 120 if invuln_ticks <= 0 else 45
	var character_graze_modifier: float = character_model.graze_modifier() if character_model != null else 1.0
	graze_value = int(float(graze_value) * character_graze_modifier * float(pattern_modifiers.get("graze_score_multiplier", 1.0)) * float(self_modifiers.get("graze_score_multiplier", 1.0)))
	var character_spell_power_modifier: float = character_model.spell_power_modifier() if character_model != null else 1.0
	if player_pos.y <= PICKUP_LINE_Y:
		graze_value = int(float(graze_value) * 1.5)
		multiplier = min(8.0, multiplier + 0.035)
		card_system.add_energy(0.035 * character_spell_power_modifier)
	else:
		multiplier = min(8.0, multiplier + 0.015)
		card_system.add_energy(0.015 * character_spell_power_modifier)
	score += int(float(graze_value) * multiplier)
	if not practice_prewarping:
		replay_recorder.record_event(tick, "graze", {"pattern_id": String(bullet.get("pattern_id", "unknown")), "spawn_index": int(bullet.get("spawn_index", -1))})

func _apply_hit_event(bullet: Dictionary) -> void:
	if deathbomb_ticks > 0 and bomb_count > 0:
		_activate_bomb("deathbomb")
		return
	if pending_death_hit:
		return
	if int(self_modifiers.get("shield_charges", 0)) > 0 and card_system.consume_shield_charge():
		combo = max(0, int(combo * 0.5))
		invuln_ticks = 45
		replay_recorder.record_event(tick, "shield_block", {"pattern_id": String(bullet.get("pattern_id", "unknown"))})
		bullet["pos"] = Vector2(-9999, -9999)
		return
	pending_death_hit = true
	pending_hit_pattern_id = String(bullet.get("pattern_id", "unknown"))
	deathbomb_ticks = DEATHBOMB_WINDOW_TICKS
	bullet["pos"] = Vector2(-9999, -9999)

func _commit_hit() -> void:
	hit_count += 1
	combo = 0
	multiplier = max(1.0, multiplier * 0.45)
	score = max(0, score - 2500)
	invuln_ticks = HIT_INVULN_TICKS
	replay_recorder.record_event(tick, "hit", {"pattern_id": pending_hit_pattern_id})
	pending_death_hit = false
	pending_hit_pattern_id = ""

func _update_score_tick(input_state: Dictionary) -> void:
	score += 1
	if bool(input_state.get("slow_pressed", false)) and player_pos.y <= PICKUP_LINE_Y:
		score += 2
		multiplier = min(8.0, multiplier + 0.002)
		card_system.add_energy(0.006 * (character_model.spell_power_modifier() if character_model != null else 1.0))
	if tick % 60 == 0:
		card_system.add_energy(0.12)
		if not practice_prewarping:
			replay_recorder.record_event(tick, "state_hash", {"hash": _state_hash()})
	multiplier *= float(pattern_modifiers.get("score_multiplier_penalty", 1.0))

func _state_hash() -> int:
	var value := active_match_seed
	value = BulletMathLib.mix32(value ^ int(player_pos.x * 10.0) ^ (int(player_pos.y * 10.0) << 1))
	value = BulletMathLib.mix32(value ^ bullets.size() ^ (player_shots.size() << 4))
	value = BulletMathLib.mix32(value ^ score ^ (hit_count << 8) ^ (graze_count << 16))
	return value

func _update_hud() -> void:
	hud.visible = _should_show_gameplay_hud()
	if not hud.visible:
		hud.text = ""
		_update_ui_overlay()
		return
	var config := _active_pattern_config()
	var pattern_index: int = int(stage_select_model.selected_pattern_index if stage_select_model != null else 0)
	if not show_performance_stats:
		hud.text = _compact_hud_text(config, pattern_index)
		_update_ui_overlay()
		return
	hud.text = _debug_hud_text(config, pattern_index)
	_update_ui_overlay()

func _compact_hud_text(config: Dictionary, pattern_index: int) -> String:
	return localization.format_lines([
		{"key": "ui.hud_status", "values": {"mode": _practice_mode_label(), "screen": _screen_title(ui_screen_model.current_screen if ui_screen_model != null else "main_menu"), "action": ui_screen_model.last_action if ui_screen_model != null else "-"}},
		{"key": "ui.score", "values": {"score": score, "multiplier": "%.2f" % multiplier, "combo": combo, "max_combo": max_combo}},
		{"key": "ui.resources", "values": {"power": "%.2f" % power, "bomb": bomb_count, "invuln": invuln_ticks}},
		{"key": "ui.energy_hand", "values": {"energy": "%.2f" % card_system.energy, "max_energy": "%.0f" % CardSystemLib.MAX_ENERGY, "hand": card_system.hand_summary(localization)}},
		{"key": "ui.pattern", "values": {"name": String(config.get("name", config.get("id", "unknown"))), "index": pattern_index + 1, "count": pattern_configs.size()}},
		{"key": "ui.hud_network", "values": {"network": matchmaking_model.summary() if matchmaking_model != null else "-", "authority": network_match_model.summary() if network_match_model != null else "-"}},
		{"key": "ui.menu_help"},
	])

func _debug_hud_text(config: Dictionary, pattern_index: int) -> String:
	var perf_line: String = performance_stats.summary() if show_performance_stats else localization.text_for("ui.hidden")
	return localization.format_lines([
		{"key": "ui.title"},
		{"key": "ui.stage", "values": {"stage": _active_stage_summary()}},
		{"key": "ui.pattern", "values": {"name": String(config.get("name", config.get("id", "unknown"))), "index": pattern_index + 1, "count": pattern_configs.size()}},
		{"key": "ui.mode", "values": {"mode": _practice_mode_label(), "pause": localization.text_for("ui.paused") if replay_paused else localization.text_for("ui.running"), "speed": "%.1f" % REPLAY_SPEEDS[replay_speed_index], "tick": tick, "final_tick": replay_recorder.final_recorded_tick() if replay_mode else tick, "seed": active_match_seed, "start_tick": practice_start_tick}},
		{"key": "ui.practice_init", "values": {"power": "%.1f" % practice_initial_power, "bombs": practice_initial_bombs}},
		{"key": "ui.replay_valid", "values": {"valid": localization.text_for("ui.no") if replay_validation_failed else localization.text_for("ui.yes"), "mismatch": replay_first_mismatch_tick}},
		{"key": "ui.replay_file", "values": {"status": localization.text_for("ui.replay_file_%s" % replay_file_status), "path": replay_file_path}},
		{"key": "ui.replay_index", "values": {"status": localization.text_for("ui.replay_index_%s" % replay_index_status), "action": localization.text_for("ui.replay_index_action_%s" % replay_index_action_status), "selected": _selected_replay_summary()}},
		{"key": "ui.replay_seek", "values": {"target": replay_seek_target_tick, "status": localization.text_for("ui.replay_seek_%s" % replay_seek_status)}},
		{"key": "ui.replay_final", "values": {"status": localization.text_for("ui.replay_final_%s" % replay_final_hash_status), "expected": replay_expected_final_hash, "actual": replay_actual_final_hash}},
		{"key": "ui.score", "values": {"score": score, "multiplier": "%.2f" % multiplier, "combo": combo, "max_combo": max_combo}},
		{"key": "ui.energy_hand", "values": {"energy": "%.2f" % card_system.energy, "max_energy": "%.0f" % CardSystemLib.MAX_ENERGY, "hand": card_system.hand_summary(localization)}},
		{"key": "ui.deck", "values": {"deck": deck_builder.summary(localization) if deck_builder != null else "-"}},
		{"key": "ui.active_cards", "values": {"cards": card_system.active_summary(localization)}},
		{"key": "ui.resources", "values": {"power": "%.2f" % power, "bomb": bomb_count, "invuln": invuln_ticks}},
		{"key": "ui.combat", "values": {"graze": graze_count, "hits": hit_count, "damage": target_damage}},
		{"key": "ui.counts", "values": {"bullets": bullets.size(), "shots": player_shots.size(), "delayed": delayed_spawn_count}},
		{"key": "ui.perf", "values": {"perf": perf_line}},
		{"key": "ui.access", "values": {"access": accessibility_settings.summary()}},
		{"key": "ui.audio", "values": {"audio": audio_settings.summary()}},
		{"key": "ui.input", "values": {"input": input_profile.summary()}},
		{"key": "ui.character", "values": {"character": character_model.summary() if character_model != null else "-"}},
		{"key": "ui.network", "values": {"network": matchmaking_model.summary() if matchmaking_model != null else "-"}},
		{"key": "ui.authority", "values": {"authority": network_match_model.summary() if network_match_model != null else "-"}},
		{"key": "ui.game_mode", "values": {"mode": game_mode_model.summary() if game_mode_model != null else "-"}},
		{"key": "ui.results", "values": {"results": results_service_model.summary() if results_service_model != null else "-"}},
		{"key": "ui.screen", "values": {"screen": ui_screen_model.screen_summary() if ui_screen_model != null else "-"}},
		{"key": "ui.locale", "values": {"locale": localization.locale, "packs": localization.loaded_packs.size(), "theme": theme_registry.active_theme_id, "theme_version": theme_registry.version(), "theme_replaces": theme_registry.replacement_summary()}},
		{"key": "ui.focus_debug", "values": {"focus": localization.text_for("ui.on") if Input.is_action_pressed("focus") else localization.text_for("ui.off"), "debug": localization.text_for("ui.on") if not active_modifiers.is_empty() else localization.text_for("ui.off"), "bits": int(last_input_state.get("direction_bits", 0))}},
		{"key": "ui.replay_counts", "values": {"inputs": replay_recorder.input_stream.size(), "events": replay_recorder.event_stream.size()}},
		{"key": "ui.keys"},
	])

func _practice_mode_label() -> String:
	if replay_mode:
		return localization.text_for("ui.replay")
	if boss_spellbook_run_enabled:
		var status: Dictionary = _boss_spellbook_run_status()
		return "boss-spellbook %s %dt" % [String(status.get("phase_id", boss_spellbook_id)), boss_spellbook_run_tick]
	if stage_run_enabled:
		return "stage-run %d/%d %dt" % [stage_run_phase_index + 1, max(1, stage_run_phase_count), stage_run_phase_tick]
	return localization.text_for("ui.practice")

func _ui_scene_contract(scene_id: String) -> Dictionary:
	if client_menu_page_model != null and client_menu_page_model.has_method("scene_contract"):
		var contract_value: Variant = client_menu_page_model.scene_contract(scene_id)
		if typeof(contract_value) == TYPE_DICTIONARY:
			return (contract_value as Dictionary).duplicate(true)
	return {
		"scene_id": scene_id,
		"scene_path": "",
		"required_bindings": [],
	}

func _instantiate_ui_scene_root(scene_id: String) -> Control:
	if ui_scene_roots.has(scene_id):
		return ui_scene_roots.get(scene_id, null) as Control
	var contract := _ui_scene_contract(scene_id)
	var scene_path := String(contract.get("scene_path", ""))
	var root: Node = null
	if not scene_path.is_empty() and ResourceLoader.exists(scene_path):
		var packed_scene := load(scene_path)
		if packed_scene is PackedScene:
			root = (packed_scene as PackedScene).instantiate()
	var required_bindings := _ui_string_array(contract.get("required_bindings", []))
	if root == null:
		ui_scene_roots.erase(scene_id)
		ui_scene_binding_counts[scene_id] = 0
		ui_scene_missing_bindings[scene_id] = required_bindings
		return null
	ui_scene_roots[scene_id] = root
	ui_scene_mounts[scene_id] = {}
	var found_count := 0
	var missing: Array[String] = []
	for binding_name in required_bindings:
		if _ui_scene_find(root, binding_name) == null:
			missing.append(binding_name)
		else:
			found_count += 1
	ui_scene_binding_counts[scene_id] = found_count
	ui_scene_missing_bindings[scene_id] = missing
	return root as Control

func _ui_scene_find(root: Node, node_name: String) -> Node:
	if root == null or node_name.is_empty():
		return null
	if root.name == node_name:
		return root
	return root.find_child(node_name, true, false)

func _ui_bound_node(scene_id: String, binding_name: String) -> Node:
	var root: Node = ui_scene_roots.get(scene_id, null)
	return _ui_scene_find(root, binding_name)

func _current_ui_scene_id() -> String:
	var scene_id := String(_ui_page_layout().get("scene_id", ""))
	if scene_id.is_empty() or scene_id == "home_lobby":
		return "settings_panel"
	return scene_id

func _active_bound_node(binding_name: String) -> Node:
	return _ui_bound_node(_current_ui_scene_id(), binding_name)

func _active_bound_container(binding_name: String, fallback_parent: Container) -> Container:
	var node := _active_bound_node(binding_name)
	if node is Container:
		return node as Container
	return fallback_parent

func _reparent_control_to_active_binding(control: Control, binding_name: String, fallback_parent: Container) -> void:
	if control == null:
		return
	var target := _active_bound_container(binding_name, fallback_parent)
	if target == null:
		return
	var current_parent := control.get_parent()
	if current_parent == target:
		return
	if current_parent != null:
		current_parent.remove_child(control)
	target.add_child(control)

func _move_children_to_active_binding(children: Array, binding_name: String, fallback_parent: Container) -> void:
	var target := _active_bound_container(binding_name, fallback_parent)
	if target == null:
		return
	for child_value in children:
		if not child_value is Control:
			continue
		var control := child_value as Control
		var current_parent := control.get_parent()
		if current_parent == target:
			continue
		if current_parent != null:
			current_parent.remove_child(control)
		target.add_child(control)

func _set_ui_root_interactive(root: Control, interactive: bool) -> void:
	if root == null:
		return
	root.mouse_filter = Control.MOUSE_FILTER_STOP if interactive else Control.MOUSE_FILTER_IGNORE
	root.focus_mode = Control.FOCUS_NONE
	for child in root.get_children():
		if child is Control:
			_set_ui_control_interactive(child as Control, interactive)

func _set_ui_control_interactive(control: Control, interactive: bool) -> void:
	if control == null:
		return
	control.mouse_filter = Control.MOUSE_FILTER_STOP if interactive else Control.MOUSE_FILTER_IGNORE
	if not interactive:
		control.focus_mode = Control.FOCUS_NONE
	elif control is Button:
		control.focus_mode = Control.FOCUS_ALL
	for child in control.get_children():
		if child is Control:
			_set_ui_control_interactive(child as Control, interactive)

func _sync_secondary_scene_host() -> void:
	if ui_panel == null:
		return
	var page_layout := _ui_page_layout()
	var show_shell := _should_show_ui_shell(page_layout)
	var active_scene := String(page_layout.get("scene_id", "settings_panel"))
	if active_scene == "home_lobby":
		active_scene = "settings_panel"
	if active_scene.is_empty():
		active_scene = "settings_panel"
	ui_active_scene_id = active_scene
	for scene_id in ui_scene_roots.keys():
		if String(scene_id) == "home_lobby":
			continue
		var root := ui_scene_roots.get(scene_id, null) as Control
		if root == null:
			continue
		var should_show := show_shell and String(scene_id) == active_scene and not _is_home_screen()
		root.visible = should_show
		root.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		root.size_flags_vertical = Control.SIZE_EXPAND_FILL
		if root.get_parent() == null:
			ui_panel.add_child(root)
		_set_ui_root_interactive(root, should_show)
		if should_show:
			ui_root_box = root as HBoxContainer
	var fallback_box := _active_bound_container("ContentPanel", ui_content_box)
	if fallback_box is VBoxContainer:
		ui_content_box = fallback_box as VBoxContainer
	_reparent_control_to_active_binding(ui_title_label, "TitleLabel", ui_content_box)
	_reparent_control_to_active_binding(ui_nav_label, "NavPathLabel", ui_content_box)
	_reparent_control_to_active_binding(ui_shell_label, "ShellStatusLabel", ui_content_box)
	_reparent_control_to_active_binding(ui_page_summary_label, "PageSummary", ui_content_box)
	_reparent_control_to_active_binding(ui_section_label, "SectionSummary", ui_content_box)
	_reparent_control_to_active_binding(ui_control_label, "ControlPreview", ui_content_box)
	_reparent_control_to_active_binding(ui_status_label, "StatusLabel", ui_content_box)
	_reparent_control_to_active_binding(ui_detail_label, "DetailLabel", ui_content_box)
	_reparent_control_to_active_binding(ui_hint_label, "HintLabel", ui_content_box)
	_move_children_to_active_binding(ui_nav_row_labels, "NavigationRail", ui_root_box)
	_move_children_to_active_binding(ui_category_buttons, "CategoryTabs", ui_content_box)
	_move_children_to_active_binding(ui_status_cards, "StatusCards", ui_content_box)
	_reparent_control_to_active_binding(ui_focus_button, "FocusPanel", ui_content_box)
	_move_children_to_active_binding(ui_section_buttons, _active_section_binding_name(), ui_content_box)
	_move_children_to_active_binding(ui_overview_buttons, _active_overview_binding_name(), ui_content_box)
	_move_children_to_active_binding(ui_quick_buttons, "QuickActions", ui_content_box)
	_move_children_to_active_binding(ui_control_buttons, "ControlButtons", ui_content_box)
	_move_children_to_active_binding(ui_row_labels, "ContentRows", ui_content_box)
	_set_ui_root_interactive(ui_root_box, show_shell and not _is_home_screen())

func _active_section_binding_name() -> String:
	var scene_id := _current_ui_scene_id()
	if scene_id == "community_panel":
		return "SocialTabs"
	if scene_id == "collection_panel":
		return "FilterTabs"
	return "SectionTabs"

func _active_overview_binding_name() -> String:
	var scene_id := _current_ui_scene_id()
	if scene_id == "matchmaking_panel":
		return "ModeCards"
	return "OverviewCards"

func _ui_bind_or_new_box(scene_id: String, binding_name: String, fallback_name: String, vertical: bool) -> BoxContainer:
	var node := _ui_bound_node(scene_id, binding_name)
	if node is BoxContainer:
		return node as BoxContainer
	var box: BoxContainer = VBoxContainer.new() if vertical else HBoxContainer.new()
	box.name = fallback_name
	_attach_ui_fallback_node(binding_name, box)
	return box

func _ui_bound_or_new_vbox(scene_id: String, binding_name: String, fallback_name: String) -> VBoxContainer:
	var node := _ui_bound_node(scene_id, binding_name)
	if node is VBoxContainer:
		return node as VBoxContainer
	var box := VBoxContainer.new()
	box.name = fallback_name
	_attach_ui_fallback_node(binding_name, box)
	return box

func _ui_bound_or_new_hbox(scene_id: String, binding_name: String, fallback_name: String) -> HBoxContainer:
	var node := _ui_bound_node(scene_id, binding_name)
	if node is HBoxContainer:
		return node as HBoxContainer
	var box := HBoxContainer.new()
	box.name = fallback_name
	_attach_ui_fallback_node(binding_name, box)
	return box

func _ui_bound_or_new_grid(scene_id: String, binding_name: String, fallback_name: String) -> GridContainer:
	var node := _ui_bound_node(scene_id, binding_name)
	if node is GridContainer:
		return node as GridContainer
	var grid := GridContainer.new()
	grid.name = fallback_name
	_attach_ui_fallback_node(binding_name, grid)
	return grid

func _ui_bound_or_new_label(scene_id: String, binding_name: String, fallback_name: String) -> Label:
	var node := _ui_bound_node(scene_id, binding_name)
	if node is Label:
		var bound_label := node as Label
		_configure_ui_label(bound_label, binding_name)
		return bound_label
	var label := Label.new()
	label.name = fallback_name
	_configure_ui_label(label, binding_name)
	_attach_ui_fallback_node(binding_name, label)
	return label

func _configure_ui_label(label: Label, binding_name: String = "") -> void:
	if label == null:
		return
	label.clip_text = true
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if binding_name != "TitleLabel":
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART

func _ui_bound_container_or_parent(scene_id: String, binding_name: String, fallback_parent: Container) -> Container:
	var node := _ui_bound_node(scene_id, binding_name)
	if node is Container:
		return node as Container
	return fallback_parent

func _attach_ui_fallback_node(binding_name: String, node: Control) -> void:
	if node == null:
		return
	var parent: Node = null
	if binding_name in ["NavigationRail", "ContentPanel"]:
		parent = ui_root_box
	elif ui_content_box != null:
		parent = ui_content_box
	elif ui_root_box != null:
		parent = ui_root_box
	elif ui_panel != null:
		parent = ui_panel
	if parent != null and node.get_parent() == null:
		parent.add_child(node)

func _build_ui_secondary_root() -> HBoxContainer:
	var root_control := _instantiate_ui_scene_root("settings_panel")
	var root_box := root_control as HBoxContainer
	if root_box == null:
		root_box = HBoxContainer.new()
	root_box.name = "UIScreenRoot"
	root_box.add_theme_constant_override("separation", 8)
	root_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	root_box.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return root_box

func _preload_secondary_ui_scenes() -> void:
	for scene_id in ["menu_hub", "community_panel", "matchmaking_panel", "playfield_overlay", "collection_panel"]:
		var root := _instantiate_ui_scene_root(scene_id)
		if root == null:
			continue
		root.visible = false
		root.name = "UIScreenScene_%s" % scene_id
		root.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		root.size_flags_vertical = Control.SIZE_EXPAND_FILL
		if root.get_parent() == null and ui_panel != null:
			ui_panel.add_child(root)

func _build_ui_overlay() -> void:
	var layer := CanvasLayer.new()
	layer.name = "UIScreenLayer"
	layer.layer = 10
	add_child(layer)
	ui_panel = PanelContainer.new()
	ui_panel.name = "UIScreenPanel"
	ui_panel.position = Vector2(506, 18)
	ui_panel.custom_minimum_size = Vector2(436, 520)
	ui_panel.add_theme_stylebox_override("panel", _ui_panel_style())
	layer.add_child(ui_panel)
	ui_home_box = _build_ui_home_surface()
	ui_panel.add_child(ui_home_box)
	ui_root_box = _build_ui_secondary_root()
	var root_box := ui_root_box
	ui_panel.add_child(root_box)
	_preload_secondary_ui_scenes()
	var nav_box := _ui_bound_or_new_vbox("settings_panel", "NavigationRail", "UIScreenNavList")
	nav_box.custom_minimum_size = Vector2(112, 0)
	nav_box.add_theme_constant_override("separation", 3)
	ui_nav_box = nav_box
	for i in range(12):
		var nav_button := Button.new()
		nav_button.name = "UIScreenNavRow%d" % i
		_configure_ui_button(nav_button, Vector2(108, 26), 10, true)
		nav_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		nav_button.pressed.connect(_on_ui_nav_button_pressed.bind(nav_button))
		nav_box.add_child(nav_button)
		ui_nav_row_labels.append(nav_button)
	var box := _ui_bound_or_new_vbox("settings_panel", "ContentPanel", "UIScreenBox")
	box.add_theme_constant_override("separation", 2)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ui_content_box = box
	ui_category_tabs_box = _ui_bound_or_new_hbox("settings_panel", "CategoryTabs", "UIScreenCategoryTabs")
	ui_category_tabs_box.add_theme_constant_override("separation", 3)
	for i in range(6):
		var category_button := Button.new()
		category_button.name = "UIScreenCategoryTab%d" % i
		_configure_ui_button(category_button, Vector2(84, 26), 10, true)
		category_button.pressed.connect(_on_ui_category_button_pressed.bind(category_button))
		ui_category_tabs_box.add_child(category_button)
		ui_category_buttons.append(category_button)
	ui_title_label = _ui_bound_or_new_label("settings_panel", "TitleLabel", "UIScreenTitle")
	ui_title_label.name = "UIScreenTitle"
	ui_title_label.add_theme_font_size_override("font_size", 18)
	ui_nav_label = _ui_bound_or_new_label("settings_panel", "NavPathLabel", "UIScreenNav")
	ui_nav_label.name = "UIScreenNav"
	ui_nav_label.add_theme_font_size_override("font_size", 11)
	ui_nav_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui_shell_label = _ui_bound_or_new_label("settings_panel", "ShellStatusLabel", "UIScreenShellStatus")
	ui_shell_label.name = "UIScreenShellStatus"
	ui_shell_label.add_theme_font_size_override("font_size", 10)
	ui_shell_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui_page_summary_label = _ui_bound_or_new_label("settings_panel", "PageSummary", "UIScreenPageSummary")
	ui_page_summary_label.name = "UIScreenPageSummary"
	ui_page_summary_label.add_theme_font_size_override("font_size", 12)
	ui_page_summary_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui_status_cards_box = _ui_bound_or_new_grid("settings_panel", "StatusCards", "UIScreenStatusCards")
	ui_status_cards_box.name = "UIScreenStatusCards"
	ui_status_cards_box.columns = 2
	ui_status_cards_box.add_theme_constant_override("h_separation", 3)
	ui_status_cards_box.add_theme_constant_override("v_separation", 3)
	for i in range(8):
		var status_button := Button.new()
		status_button.name = "UIScreenStatusCard%d" % i
		_configure_ui_button(status_button, Vector2(138, 32), 9, false)
		status_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		status_button.pressed.connect(_on_ui_status_card_pressed.bind(status_button))
		ui_status_cards_box.add_child(status_button)
		ui_status_cards.append(status_button)
	ui_focus_button = Button.new()
	ui_focus_button.name = "UIScreenFocusPanel"
	_configure_ui_button(ui_focus_button, Vector2(280, 52), 11, false)
	ui_focus_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	ui_focus_button.focus_entered.connect(_on_ui_focus_button_focus_entered)
	ui_focus_button.pressed.connect(_on_ui_focus_button_pressed)
	_ui_bound_container_or_parent("settings_panel", "FocusPanel", box).add_child(ui_focus_button)
	ui_section_label = _ui_bound_or_new_label("settings_panel", "SectionSummary", "UIScreenSections")
	ui_section_label.name = "UIScreenSections"
	ui_section_label.add_theme_font_size_override("font_size", 11)
	ui_section_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui_section_tabs_box = _ui_bound_or_new_hbox("settings_panel", "SectionTabs", "UIScreenSectionTabs")
	ui_section_tabs_box.add_theme_constant_override("separation", 2)
	for i in range(6):
		var section_button := Button.new()
		section_button.name = "UIScreenSectionTab%d" % i
		_configure_ui_button(section_button, Vector2(78, 22), 9, true)
		section_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		section_button.pressed.connect(_on_ui_section_button_pressed.bind(section_button))
		ui_section_tabs_box.add_child(section_button)
		ui_section_buttons.append(section_button)
	ui_overview_cards_box = _ui_bound_or_new_grid("settings_panel", "SettingGroups", "UIScreenOverviewCards")
	ui_overview_cards_box.name = "UIScreenOverviewCards"
	ui_overview_cards_box.columns = 2
	ui_overview_cards_box.add_theme_constant_override("h_separation", 2)
	ui_overview_cards_box.add_theme_constant_override("v_separation", 2)
	for i in range(6):
		var overview_button := Button.new()
		overview_button.name = "UIScreenOverviewCard%d" % i
		_configure_ui_button(overview_button, Vector2(132, 34), 9, false)
		overview_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		overview_button.focus_entered.connect(_on_ui_overview_button_focus_entered.bind(overview_button))
		overview_button.pressed.connect(_on_ui_overview_button_pressed.bind(overview_button))
		ui_overview_cards_box.add_child(overview_button)
		ui_overview_buttons.append(overview_button)
	ui_quick_actions_box = _ui_bound_or_new_hbox("settings_panel", "QuickActions", "UIScreenQuickActions")
	ui_quick_actions_box.add_theme_constant_override("separation", 3)
	for i in range(6):
		var quick_button := Button.new()
		quick_button.name = "UIScreenQuickAction%d" % i
		_configure_ui_button(quick_button, Vector2(88, 26), 10, true)
		quick_button.pressed.connect(_on_ui_quick_button_pressed.bind(quick_button))
		ui_quick_actions_box.add_child(quick_button)
		ui_quick_buttons.append(quick_button)
	ui_control_label = _ui_bound_or_new_label("settings_panel", "ControlPreview", "UIScreenControlPreview")
	ui_control_label.name = "UIScreenControlPreview"
	ui_control_label.add_theme_font_size_override("font_size", 11)
	ui_control_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui_control_buttons_box = _ui_bound_or_new_hbox("settings_panel", "ControlButtons", "UIScreenControlButtons")
	ui_control_buttons_box.add_theme_constant_override("separation", 2)
	for i in range(4):
		var control_button := Button.new()
		control_button.name = "UIScreenControlButton%d" % i
		_configure_ui_button(control_button, Vector2(64, 24), 10, true)
		control_button.pressed.connect(_on_ui_control_button_pressed.bind(control_button))
		ui_control_buttons_box.add_child(control_button)
		ui_control_buttons.append(control_button)
	ui_status_label = _ui_bound_or_new_label("settings_panel", "StatusLabel", "UIScreenStatus")
	ui_status_label.name = "UIScreenStatus"
	ui_status_label.add_theme_font_size_override("font_size", 12)
	ui_status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui_detail_label = _ui_bound_or_new_label("settings_panel", "DetailLabel", "UIScreenDetail")
	ui_detail_label.name = "UIScreenDetail"
	ui_detail_label.add_theme_font_size_override("font_size", 11)
	ui_detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui_rows_box = _ui_bound_or_new_vbox("settings_panel", "ContentRows", "UIScreenRows")
	ui_rows_box.add_theme_constant_override("separation", 2)
	for i in range(14):
		var row_button := Button.new()
		row_button.name = "UIScreenRow%d" % i
		_configure_ui_button(row_button, Vector2(320, 24), 10, true)
		row_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		row_button.focus_entered.connect(_on_ui_row_button_focus_entered.bind(row_button))
		row_button.pressed.connect(_on_ui_row_button_pressed.bind(row_button))
		ui_rows_box.add_child(row_button)
		ui_row_labels.append(row_button)
	ui_hint_label = _ui_bound_or_new_label("settings_panel", "HintLabel", "UIScreenHint")
	ui_hint_label.name = "UIScreenHint"
	ui_hint_label.add_theme_font_size_override("font_size", 10)
	ui_hint_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_update_ui_overlay()

func _build_ui_home_surface() -> BoxContainer:
	var scene_root := _instantiate_ui_scene_root("home_lobby")
	var home := scene_root as BoxContainer
	if home == null:
		home = BoxContainer.new()
	home.name = "UIScreenHome"
	home.add_theme_constant_override("separation", 18)
	home.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	home.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ui_home_portrait_panel = _ui_bound_node("home_lobby", "PortraitPanel") as PanelContainer
	if ui_home_portrait_panel == null:
		ui_home_portrait_panel = PanelContainer.new()
	ui_home_portrait_panel.name = "UIScreenHomePortrait"
	ui_home_portrait_panel.custom_minimum_size = Vector2(420, 460)
	ui_home_portrait_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ui_home_portrait_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ui_home_portrait_panel.add_theme_stylebox_override("panel", _ui_portrait_style())
	if ui_home_portrait_panel.get_parent() == null:
		home.add_child(ui_home_portrait_panel)
	ui_home_portrait_art = _ui_bound_node("home_lobby", "PortraitArt") as TextureRect
	if ui_home_portrait_art == null:
		ui_home_portrait_art = TextureRect.new()
		ui_home_portrait_panel.add_child(ui_home_portrait_art)
	ui_home_portrait_art.name = "UIScreenHomePortraitArt"
	ui_home_portrait_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	ui_home_portrait_art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	ui_home_portrait_art.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ui_home_portrait_art.size_flags_vertical = Control.SIZE_EXPAND_FILL
	if ResourceLoader.exists(BASE_LOBBY_STANDEE):
		ui_home_portrait_art.texture = load(BASE_LOBBY_STANDEE)
	ui_home_portrait_label = _ui_bound_node("home_lobby", "PortraitLabel") as Label
	if ui_home_portrait_label == null:
		ui_home_portrait_label = Label.new()
		ui_home_portrait_panel.add_child(ui_home_portrait_label)
	ui_home_portrait_label.name = "UIScreenHomePortraitLabel"
	ui_home_portrait_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui_home_portrait_label.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
	ui_home_portrait_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui_home_portrait_label.add_theme_font_size_override("font_size", 20)
	var menu_box := _ui_bound_node("home_lobby", "MenuPanel") as VBoxContainer
	if menu_box == null:
		menu_box = VBoxContainer.new()
	menu_box.name = "UIScreenHomeMenu"
	menu_box.custom_minimum_size = Vector2(300, 0)
	menu_box.size_flags_vertical = Control.SIZE_EXPAND_FILL
	menu_box.add_theme_constant_override("separation", 8)
	ui_home_menu_box = menu_box
	if menu_box.get_parent() == null:
		home.add_child(menu_box)
	ui_home_title_label = _ui_bound_node("home_lobby", "TitleLabel") as Label
	if ui_home_title_label == null:
		ui_home_title_label = Label.new()
		menu_box.add_child(ui_home_title_label)
	ui_home_title_label.name = "UIScreenHomeTitle"
	ui_home_title_label.text = "SpellKard"
	ui_home_title_label.add_theme_font_size_override("font_size", 28)
	ui_home_status_label = _ui_bound_node("home_lobby", "StatusLabel") as Label
	if ui_home_status_label == null:
		ui_home_status_label = Label.new()
		menu_box.add_child(ui_home_status_label)
	ui_home_status_label.name = "UIScreenHomeStatus"
	ui_home_status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ui_home_status_label.add_theme_font_size_override("font_size", 12)
	ui_home_dashboard_box = _ui_bound_node("home_lobby", "DashboardGrid") as GridContainer
	if ui_home_dashboard_box == null:
		ui_home_dashboard_box = GridContainer.new()
	ui_home_dashboard_box.name = "UIScreenHomeDashboard"
	ui_home_dashboard_box.columns = 2
	ui_home_dashboard_box.add_theme_constant_override("h_separation", 5)
	ui_home_dashboard_box.add_theme_constant_override("v_separation", 5)
	if ui_home_dashboard_box.get_parent() == null:
		menu_box.add_child(ui_home_dashboard_box)
	for i in range(6):
		var dashboard_button := Button.new()
		dashboard_button.name = "UIScreenHomeDashboard%d" % i
		_configure_ui_button(dashboard_button, Vector2(132, 38), 10, false)
		dashboard_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		dashboard_button.add_theme_stylebox_override("normal", _ui_button_style(false))
		dashboard_button.add_theme_stylebox_override("hover", _ui_button_style(true))
		dashboard_button.add_theme_stylebox_override("pressed", _ui_button_style(true))
		dashboard_button.pressed.connect(_on_ui_home_dashboard_button_pressed.bind(dashboard_button))
		ui_home_dashboard_box.add_child(dashboard_button)
		ui_home_dashboard_buttons.append(dashboard_button)
	ui_home_buttons_box = _ui_bound_node("home_lobby", "PrimaryButtons") as VBoxContainer
	if ui_home_buttons_box == null:
		ui_home_buttons_box = VBoxContainer.new()
	ui_home_buttons_box.name = "UIScreenHomeButtons"
	ui_home_buttons_box.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ui_home_buttons_box.add_theme_constant_override("separation", 6)
	if ui_home_buttons_box.get_parent() == null:
		menu_box.add_child(ui_home_buttons_box)
	for i in range(6):
		var button := Button.new()
		button.name = "UIScreenHomeButton%d" % i
		_configure_ui_button(button, Vector2(260, 50), 15, false)
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.add_theme_stylebox_override("normal", _ui_button_style(false))
		button.add_theme_stylebox_override("hover", _ui_button_style(true))
		button.add_theme_stylebox_override("pressed", _ui_button_style(true))
		button.pressed.connect(_on_ui_home_button_pressed.bind(button))
		ui_home_buttons_box.add_child(button)
		ui_home_buttons.append(button)
	return home

func _ui_panel_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.075, 0.080, 0.090, 0.90)
	style.border_color = Color(0.42, 0.50, 0.56, 0.65)
	style.set_border_width_all(1)
	style.set_corner_radius_all(6)
	style.content_margin_left = 14
	style.content_margin_top = 14
	style.content_margin_right = 14
	style.content_margin_bottom = 14
	return style

func _ui_portrait_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.10, 0.13, 0.12, 0.82)
	style.border_color = Color(0.72, 0.60, 0.34, 0.70)
	style.set_border_width_all(1)
	style.set_corner_radius_all(6)
	style.content_margin_left = 10
	style.content_margin_top = 10
	style.content_margin_right = 10
	style.content_margin_bottom = 10
	return style

func _ui_button_style(active: bool) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.18, 0.21, 0.22, 0.92) if active else Color(0.12, 0.14, 0.15, 0.86)
	style.border_color = Color(0.68, 0.44, 0.42, 0.82) if active else Color(0.34, 0.40, 0.42, 0.70)
	style.set_border_width_all(1)
	style.set_corner_radius_all(6)
	style.content_margin_left = 12
	style.content_margin_top = 7
	style.content_margin_right = 12
	style.content_margin_bottom = 7
	return style

func _configure_ui_button(button: Button, min_size: Vector2, font_size: int, flat: bool = true) -> void:
	if button == null:
		return
	button.flat = flat
	button.focus_mode = Control.FOCUS_ALL
	button.custom_minimum_size = min_size
	button.clip_text = true
	button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_size_override("font_size", font_size)

func _ui_current_owner_screen() -> String:
	return String(ui_screen_model.current_screen if ui_screen_model != null else "")

func _ui_mark_button_owner(button: Button) -> void:
	if button != null:
		button.set_meta("owner_screen", _ui_current_owner_screen())

func _ui_clear_button_owner(button: Button) -> void:
	if button != null and button.has_meta("owner_screen"):
		button.remove_meta("owner_screen")

func _ui_button_owned_by_current_screen(button: Button) -> bool:
	return button != null and String(button.get_meta("owner_screen", "")) == _ui_current_owner_screen()

func _ui_deactivate_button(button: Button, meta_keys: Array = []) -> void:
	if button == null:
		return
	button.text = ""
	button.visible = false
	button.disabled = true
	button.tooltip_text = ""
	_ui_clear_button_owner(button)
	for key in meta_keys:
		if button.has_meta(key):
			button.remove_meta(key)

func _update_ui_focus_neighbors() -> void:
	var buttons := _visible_focus_button_chain()
	for i in range(buttons.size()):
		var button := buttons[i]
		if button == null:
			continue
		var previous := buttons[wrapi(i - 1, 0, buttons.size())]
		var next := buttons[wrapi(i + 1, 0, buttons.size())]
		var previous_path := previous.get_path() if previous != null else NodePath()
		var next_path := next.get_path() if next != null else NodePath()
		button.focus_neighbor_top = previous_path
		button.focus_neighbor_bottom = next_path
		button.focus_neighbor_left = previous_path
		button.focus_neighbor_right = next_path
		button.focus_previous = previous_path
		button.focus_next = next_path

func _visible_focus_button_chain() -> Array[Button]:
	var buttons: Array[Button] = []
	_append_visible_buttons_to_focus_chain(buttons, ui_home_buttons)
	_append_visible_buttons_to_focus_chain(buttons, ui_nav_row_labels)
	_append_visible_buttons_to_focus_chain(buttons, ui_category_buttons)
	_append_visible_buttons_to_focus_chain(buttons, ui_status_cards)
	if ui_focus_button != null:
		_append_button_to_focus_chain(buttons, ui_focus_button)
	_append_visible_buttons_to_focus_chain(buttons, ui_section_buttons)
	_append_visible_buttons_to_focus_chain(buttons, ui_overview_buttons)
	_append_visible_buttons_to_focus_chain(buttons, ui_quick_buttons)
	_append_visible_buttons_to_focus_chain(buttons, ui_control_buttons)
	_append_visible_buttons_to_focus_chain(buttons, ui_row_labels)
	return buttons

func _append_visible_buttons_to_focus_chain(result: Array[Button], controls: Array) -> void:
	for value in controls:
		if value is Button:
			_append_button_to_focus_chain(result, value as Button)

func _append_button_to_focus_chain(result: Array[Button], button: Button) -> void:
	if button == null or not button.is_visible_in_tree() or button.disabled or button.focus_mode == Control.FOCUS_NONE:
		return
	result.append(button)

func _deactivate_home_ui_controls() -> void:
	for button in ui_home_buttons:
		_ui_deactivate_button(button, ["row_index", "row_id", "screen_id"])
	for button in ui_home_dashboard_buttons:
		_ui_deactivate_button(button, ["screen_id", "dashboard_id"])

func _deactivate_secondary_ui_controls() -> void:
	for button in ui_nav_row_labels:
		_ui_deactivate_button(button, ["screen_id"])
	for button in ui_category_buttons:
		_ui_deactivate_button(button, ["screen_id", "category_id"])
	for button in ui_status_cards:
		_ui_deactivate_button(button, ["screen_id", "status_id"])
	if ui_focus_button != null:
		_ui_deactivate_button(ui_focus_button, ["row_index", "row_id", "focus_id"])
	for button in ui_section_buttons:
		_ui_deactivate_button(button, ["row_index", "section_id"])
	for button in ui_overview_buttons:
		_ui_deactivate_button(button, ["row_index", "row_id"])
	for button in ui_quick_buttons:
		_ui_deactivate_button(button, ["row_index", "row_id", "screen_id"])
	for button in ui_control_buttons:
		_ui_deactivate_button(button, ["control_action", "direction"])
	for button in ui_row_labels:
		_ui_deactivate_button(button, ["row_index", "row_id"])

func _update_ui_overlay() -> void:
	if ui_panel == null or ui_screen_model == null:
		return
	var page_layout := _ui_page_layout()
	var show_shell := _should_show_ui_shell(page_layout)
	ui_panel.visible = show_shell
	if not show_shell:
		_deactivate_home_ui_controls()
		_deactivate_secondary_ui_controls()
		_sync_secondary_scene_host()
		return
	_layout_ui_overlay(page_layout)
	var all_rows: Array[Dictionary] = _decorate_client_experience_rows(ui_screen_model.screen_rows(64))
	var home_visible := _is_home_screen()
	if ui_home_box != null:
		ui_home_box.visible = home_visible
	_sync_secondary_scene_host()
	_update_ui_home_surface(all_rows)
	if home_visible:
		_deactivate_secondary_ui_controls()
		_update_ui_focus_neighbors()
		return
	_deactivate_home_ui_controls()
	var nav_rows: Array[Dictionary] = ui_screen_model.navigation_rows()
	var row_window_start: int = 0
	if all_rows.size() > ui_row_labels.size():
		row_window_start = clampi(ui_screen_model.cursor - int(ui_row_labels.size() / 2), 0, all_rows.size() - ui_row_labels.size())
	var rows: Array[Dictionary] = all_rows.slice(row_window_start, min(all_rows.size(), row_window_start + ui_row_labels.size()))
	var selected: Dictionary = _decorated_ui_selected_row()
	ui_title_label.text = _screen_title(ui_screen_model.current_screen)
	ui_nav_label.text = _ui_nav_text(ui_screen_model.current_screen)
	ui_shell_label.text = _ui_shell_status_text()
	ui_page_summary_label.text = _page_experience_text(_page_experience_summary(all_rows, selected, _ui_page_layout()))
	_update_ui_status_cards()
	_update_ui_focus_panel(all_rows, selected)
	ui_section_label.text = _ui_section_bar_text(all_rows, selected)
	ui_control_label.text = _ui_control_preview_text(selected)
	ui_status_label.text = _ui_status_text(all_rows)
	ui_detail_label.text = _ui_detail_text(selected)
	ui_hint_label.text = _ui_hint_text(ui_screen_model.current_screen, selected, all_rows)
	_update_ui_nav_overlay(nav_rows)
	_update_ui_category_tabs(nav_rows)
	_update_ui_section_tabs(all_rows, selected)
	_update_ui_overview_cards(all_rows, selected)
	_update_ui_quick_actions(all_rows, selected)
	_update_ui_control_buttons(selected)
	for i in range(ui_row_labels.size()):
		var label := ui_row_labels[i]
		if i >= rows.size():
			_ui_deactivate_button(label, ["row_index", "row_id"])
			continue
		label.visible = true
		var absolute_index := row_window_start + i
		var prefix := "> " if absolute_index == ui_screen_model.cursor else "  "
		label.disabled = false
		_ui_mark_button_owner(label)
		label.set_meta("row_index", absolute_index)
		label.set_meta("row_id", String(rows[i].get("id", "")))
		label.text = _format_ui_overlay_row(rows[i], prefix, all_rows, absolute_index)
	_update_ui_focus_neighbors()

func _layout_ui_overlay(page_layout: Dictionary = {}) -> void:
	if ui_panel == null:
		return
	var layout := page_layout
	if layout.is_empty():
		layout = _ui_page_layout()
	if not _should_show_ui_shell(layout):
		ui_panel.visible = false
		return
	var viewport_size := get_viewport_rect().size
	var margin := 18.0
	var available_width := maxf(320.0, viewport_size.x - margin * 2.0)
	var available_height := maxf(320.0, viewport_size.y - margin * 2.0)
	var layout_kind := String(layout.get("kind", "standard"))
	var panel_anchor := String(layout.get("panel_anchor", "right"))
	if bool(layout.get("show_home", _is_home_screen())):
		var target_width := available_width
		var target_height := available_height
		ui_panel.position = Vector2(margin, margin)
		ui_panel.custom_minimum_size = Vector2(target_width, target_height)
		ui_panel.size = Vector2(target_width, target_height)
		var compact_home := target_width < 760.0
		if ui_home_box != null:
			ui_home_box.vertical = compact_home
		if ui_home_menu_box != null:
			ui_home_menu_box.custom_minimum_size = Vector2(240.0 if compact_home else 300.0, 0.0)
		if ui_home_dashboard_box != null:
			ui_home_dashboard_box.visible = false
			ui_home_dashboard_box.columns = 1 if compact_home else 2
		var portrait_width := maxf(220.0, target_width - (40.0 if compact_home else 390.0))
		var portrait_height := maxf(190.0, target_height * (0.42 if compact_home else 1.0) - 28.0)
		if ui_home_portrait_panel != null:
			ui_home_portrait_panel.custom_minimum_size = Vector2(portrait_width, portrait_height)
		return
	var width_ratio := clampf(float(layout.get("panel_width_ratio", 0.48)), 0.38, 1.0)
	var min_panel_width := 436.0
	if layout_kind in ["hub", "settings", "community", "collection", "mode_select"]:
		min_panel_width = 560.0
	elif layout_kind in ["matchmaking", "network_room"]:
		min_panel_width = 520.0
	var panel_width := minf(maxf(min_panel_width, viewport_size.x * width_ratio), available_width)
	var panel_height := available_height
	var panel_x := maxf(margin, viewport_size.x - panel_width - margin)
	if panel_anchor == "full":
		panel_width = available_width
		panel_x = margin
	elif panel_anchor == "center":
		panel_x = margin + maxf(0.0, (available_width - panel_width) * 0.5)
	ui_panel.position = Vector2(panel_x, margin)
	ui_panel.custom_minimum_size = Vector2(panel_width, panel_height)
	ui_panel.size = Vector2(panel_width, panel_height)

func _update_ui_nav_overlay(nav_rows: Array[Dictionary]) -> void:
	var start_index := _ui_nav_window_start(nav_rows)
	for i in range(ui_nav_row_labels.size()):
		var label := ui_nav_row_labels[i]
		var nav_index := start_index + i
		if nav_index >= nav_rows.size():
			_ui_deactivate_button(label, ["screen_id"])
			continue
		label.visible = true
		var row: Dictionary = nav_rows[nav_index]
		var marker := "> " if bool(row.get("active", false)) else "  "
		var edge_marker := ""
		if nav_index == start_index and start_index > 0:
			edge_marker = "^ "
		elif i == ui_nav_row_labels.size() - 1 and nav_index < nav_rows.size() - 1:
			edge_marker = "v "
		label.disabled = false
		_ui_mark_button_owner(label)
		label.set_meta("screen_id", String(row.get("screen", "")))
		label.text = "%s%s%s" % [edge_marker, marker, _row_label_text(row)]

func _update_ui_category_tabs(nav_rows: Array[Dictionary]) -> void:
	var tabs := _category_tab_rows(nav_rows)
	for i in range(ui_category_buttons.size()):
		var button := ui_category_buttons[i]
		if i >= tabs.size():
			_ui_deactivate_button(button, ["screen_id", "category_id"])
			continue
		var tab: Dictionary = tabs[i]
		button.visible = true
		button.disabled = false
		_ui_mark_button_owner(button)
		button.set_meta("screen_id", String(tab.get("screen", "")))
		button.set_meta("category_id", String(tab.get("category_id", "")))
		var marker := "> " if bool(tab.get("active", false)) else ""
		button.text = "%s%s" % [marker, String(tab.get("label", ""))]
		button.tooltip_text = String(tab.get("label", ""))

func _category_tab_rows(nav_rows: Array[Dictionary]) -> Array[Dictionary]:
	var category_order: Array[String] = ["play", "collection", "community", "settings"]
	var labels := {
		"play": localization.text_for("ui.menu_section_play"),
		"collection": localization.text_for("ui.menu_section_collection"),
		"community": localization.text_for("ui.menu_section_community"),
		"settings": localization.text_for("ui.menu_section_settings"),
	}
	var screen_for_category := {
		"play": "play",
		"collection": "collection",
		"community": "community",
		"settings": "player_settings",
	}
	var active_category := ""
	for row in nav_rows:
		var section_id := _row_section_id(row)
		if not category_order.has(section_id):
			continue
		if bool(row.get("active", false)):
			active_category = section_id
	if active_category.is_empty() and ui_screen_model != null:
		active_category = _screen_category_id(ui_screen_model.current_screen)
	var tabs: Array[Dictionary] = []
	for category_id in category_order:
		if not screen_for_category.has(category_id):
			continue
		tabs.append({
			"category_id": category_id,
			"screen": String(screen_for_category[category_id]),
			"label": String(labels.get(category_id, category_id)),
			"active": category_id == active_category,
		})
	return tabs

func _update_ui_section_tabs(rows: Array[Dictionary], selected: Dictionary) -> void:
	var section_rows := _section_jump_rows(rows)
	var selected_section := _row_section_id(selected)
	for i in range(ui_section_buttons.size()):
		var button := ui_section_buttons[i]
		if i >= section_rows.size():
			_ui_deactivate_button(button, ["row_index", "section_id"])
			continue
		var section_row: Dictionary = section_rows[i]
		var section_id := String(section_row.get("section_id", ""))
		var active_marker := "> " if section_id == selected_section else ""
		button.visible = true
		button.disabled = false
		_ui_mark_button_owner(button)
		button.set_meta("row_index", int(section_row.get("row_index", 0)))
		button.set_meta("section_id", section_id)
		button.text = "%s%s" % [active_marker, String(section_row.get("label", section_id))]
		button.tooltip_text = String(section_row.get("label", section_id))

func _section_jump_rows(rows: Array[Dictionary]) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	var seen: Dictionary = {}
	for i in range(rows.size()):
		var row := rows[i]
		var section_id := _row_section_id(row)
		if section_id.is_empty() or seen.has(section_id):
			continue
		seen[section_id] = true
		result.append({
			"section_id": section_id,
			"row_index": i,
			"label": _row_section_text(row),
		})
	return result

func _on_ui_section_button_pressed(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var row_index := int(button.get_meta("row_index", -1))
	if row_index >= 0:
		_ui_set_cursor(row_index)

func _ui_press_visible_section(index: int) -> Dictionary:
	if index < 0 or index >= ui_section_buttons.size():
		return {"ok": false, "action": "section_button_invalid"}
	var button := ui_section_buttons[index]
	if button == null or not button.is_visible_in_tree():
		return {"ok": false, "action": "section_button_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "section_button_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var row_index := int(button.get_meta("row_index", -1))
	var section_id := String(button.get_meta("section_id", ""))
	_on_ui_section_button_pressed(button)
	return {"ok": row_index >= 0, "action": "section_button", "row_index": row_index, "section": section_id}

func _on_ui_category_button_pressed(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var screen_id := String(button.get_meta("screen_id", ""))
	if screen_id.is_empty():
		return
	_open_ui_screen(screen_id)

func _ui_press_visible_category(index: int) -> Dictionary:
	if index < 0 or index >= ui_category_buttons.size():
		return {"ok": false, "action": "category_button_invalid"}
	var button := ui_category_buttons[index]
	if button == null or not button.is_visible_in_tree():
		return {"ok": false, "action": "category_button_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "category_button_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var screen_id := String(button.get_meta("screen_id", ""))
	var category_id := String(button.get_meta("category_id", ""))
	_on_ui_category_button_pressed(button)
	return {
		"ok": not screen_id.is_empty(),
		"action": "category_button",
		"screen": screen_id,
		"category": category_id,
	}

func _update_ui_status_cards() -> void:
	var cards := _client_status_card_rows()
	if ui_status_cards_box != null:
		ui_status_cards_box.visible = not cards.is_empty()
	for i in range(ui_status_cards.size()):
		var button := ui_status_cards[i]
		if i >= cards.size():
			_ui_deactivate_button(button, ["screen_id", "status_id"])
			continue
		var card: Dictionary = cards[i]
		var target_screen := String(card.get("screen", ""))
		button.visible = true
		button.disabled = target_screen.is_empty()
		_ui_mark_button_owner(button)
		button.set_meta("screen_id", target_screen)
		button.set_meta("status_id", String(card.get("id", "")))
		var label_text := _row_label_text(card)
		button.text = "%s\n%s" % [
			_trim_ui_card_text(label_text, 22),
			_trim_ui_card_text(String(card.get("value", "")), 24),
		]
		button.tooltip_text = "%s: %s" % [label_text, String(card.get("value", ""))]

func _client_status_card_rows() -> Array[Dictionary]:
	if client_shell_model != null and client_shell_model.has_method("client_status_cards"):
		return client_shell_model.client_status_cards()
	return []

func _on_ui_status_card_pressed(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var screen_id := String(button.get_meta("screen_id", ""))
	if screen_id.is_empty():
		return
	_open_ui_screen(screen_id)

func _ui_press_visible_status_card(index: int) -> Dictionary:
	if index < 0 or index >= ui_status_cards.size():
		return {"ok": false, "action": "status_card_invalid"}
	var button := ui_status_cards[index]
	if button == null or not button.visible:
		return {"ok": false, "action": "status_card_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "status_card_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var screen_id := String(button.get_meta("screen_id", ""))
	var status_id := String(button.get_meta("status_id", ""))
	_on_ui_status_card_pressed(button)
	return {
		"ok": not screen_id.is_empty(),
		"action": "status_card",
		"screen": screen_id,
		"status_id": status_id,
	}

func _update_ui_focus_panel(rows: Array[Dictionary], selected: Dictionary) -> void:
	if ui_focus_button == null:
		return
	var focus := _page_focus_data(ui_screen_model.current_screen if ui_screen_model != null else "", rows, selected)
	if focus.is_empty():
		_ui_deactivate_button(ui_focus_button, ["row_index", "row_id", "focus_id"])
		return
	var row_index := int(focus.get("row_index", -1))
	ui_focus_button.visible = true
	ui_focus_button.disabled = row_index < 0
	_ui_mark_button_owner(ui_focus_button)
	ui_focus_button.set_meta("row_index", row_index)
	ui_focus_button.set_meta("row_id", String(focus.get("row_id", "")))
	ui_focus_button.set_meta("focus_id", String(focus.get("id", "")))
	ui_focus_button.text = _format_ui_focus_panel(focus)
	ui_focus_button.tooltip_text = String(focus.get("tooltip", ui_focus_button.text))

func _page_focus_data(screen_id: String, rows: Array[Dictionary], selected: Dictionary) -> Dictionary:
	var payload := {}
	if client_shell_model != null and client_shell_model.has_method("page_focus"):
		var payload_value: Variant = client_shell_model.page_focus(screen_id)
		if typeof(payload_value) == TYPE_DICTIONARY:
			payload = (payload_value as Dictionary).duplicate(true)
	if payload.is_empty():
		payload = {
			"id": "focus_%s" % screen_id,
			"title": _screen_title(screen_id),
			"summary": _ui_detail_text(selected),
			"primary_row_ids": [],
			"primary_label": _row_label_text(selected),
		}
	var target := _focus_target_row(rows, payload, selected)
	payload["row_index"] = int(target.get("row_index", -1))
	payload["row_id"] = String(target.get("row_id", ""))
	payload["target_label"] = String(target.get("label", payload.get("primary_label", "")))
	payload["target_detail"] = String(target.get("detail", ""))
	payload["tooltip"] = "%s: %s" % [String(payload.get("title", "")), String(payload.get("summary", ""))]
	return payload

func _focus_target_row(rows: Array[Dictionary], payload: Dictionary, selected: Dictionary) -> Dictionary:
	var primary_ids: Array = payload.get("primary_row_ids", [])
	for row_id_value in primary_ids:
		var row_id := String(row_id_value)
		var found := _ui_find_row_by_id(rows, row_id)
		if int(found.get("row_index", -1)) >= 0:
			return found
	if _overview_card_should_accept(selected):
		var selected_id := String(selected.get("id", ""))
		if not selected_id.is_empty():
			return {
				"row_index": ui_screen_model.cursor if ui_screen_model != null else -1,
				"row_id": selected_id,
				"label": _row_label_text(selected),
				"detail": _overview_card_detail(selected),
			}
	for i in range(rows.size()):
		var row: Dictionary = rows[i]
		if _overview_card_should_accept(row):
			return {
				"row_index": i,
				"row_id": String(row.get("id", "")),
				"label": _row_label_text(row),
				"detail": _overview_card_detail(row),
			}
	return {"row_index": -1, "row_id": "", "label": String(payload.get("primary_label", "")), "detail": ""}

func _ui_find_row_by_id(rows: Array[Dictionary], row_id: String) -> Dictionary:
	if row_id.is_empty():
		return {"row_index": -1}
	for i in range(rows.size()):
		var row: Dictionary = rows[i]
		if String(row.get("id", "")) != row_id:
			continue
		if not bool(row.get("enabled", true)):
			continue
		return {
			"row_index": i,
			"row_id": row_id,
			"label": _row_label_text(row),
			"detail": _overview_card_detail(row),
		}
	return {"row_index": -1}

func _format_ui_focus_panel(focus: Dictionary) -> String:
	var title := _trim_ui_card_text(String(focus.get("title", "")), 26)
	var summary := _trim_ui_card_text(String(focus.get("summary", "")), 54)
	var action := _trim_ui_card_text(String(focus.get("target_label", focus.get("primary_label", ""))), 26)
	if action.is_empty():
		action = _trim_ui_card_text(String(focus.get("primary_label", "")), 26)
	if summary.is_empty():
		return "%s\nAction: %s" % [title, action]
	return "%s\n%s\nAction: %s" % [title, summary, action]

func _on_ui_focus_button_focus_entered() -> void:
	if ui_focus_button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(ui_focus_button):
		return
	var row_index := int(ui_focus_button.get_meta("row_index", -1))
	if row_index >= 0:
		_ui_set_cursor(row_index)

func _on_ui_focus_button_pressed() -> void:
	if ui_focus_button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(ui_focus_button):
		return
	var row_index := int(ui_focus_button.get_meta("row_index", -1))
	if row_index < 0:
		return
	_ui_set_cursor(row_index)
	_ui_accept_selected()

func _ui_press_visible_focus_action() -> Dictionary:
	if ui_focus_button == null or not ui_focus_button.is_visible_in_tree():
		return {"ok": false, "action": "focus_action_hidden"}
	if not _ui_button_owned_by_current_screen(ui_focus_button):
		return {"ok": false, "action": "focus_action_stale", "owner": String(ui_focus_button.get_meta("owner_screen", ""))}
	var row_index := int(ui_focus_button.get_meta("row_index", -1))
	var row_id := String(ui_focus_button.get_meta("row_id", ""))
	_on_ui_focus_button_pressed()
	return {
		"ok": row_index >= 0,
		"action": "focus_action",
		"row_index": row_index,
		"row_id": row_id,
		"screen": ui_screen_model.current_screen if ui_screen_model != null else "",
	}

func _update_ui_overview_cards(rows: Array[Dictionary], selected: Dictionary) -> void:
	var cards := _overview_card_rows(rows, selected)
	if ui_overview_cards_box != null:
		ui_overview_cards_box.visible = not cards.is_empty()
	for i in range(ui_overview_buttons.size()):
		var button := ui_overview_buttons[i]
		if i >= cards.size():
			_ui_deactivate_button(button, ["row_index", "row_id"])
			continue
		var card: Dictionary = cards[i]
		var row: Dictionary = card.get("row", {})
		var row_index := int(card.get("row_index", -1))
		button.visible = true
		button.disabled = row_index < 0 or not bool(row.get("enabled", true))
		_ui_mark_button_owner(button)
		button.set_meta("row_index", row_index)
		button.set_meta("row_id", String(row.get("id", "")))
		button.text = _format_ui_overview_card(card)
		button.tooltip_text = _format_ui_row(row)

func _overview_card_rows(rows: Array[Dictionary], selected: Dictionary) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	var seen: Dictionary = {}
	var max_cards := _visible_overview_card_limit()
	for row_id in _overview_priority_ids(ui_screen_model.current_screen if ui_screen_model != null else ""):
		_append_overview_card_by_id(result, seen, rows, String(row_id))
		if result.size() >= max_cards:
			return result
	for i in range(rows.size()):
		var row: Dictionary = rows[i]
		if not _is_overview_candidate(row):
			continue
		var row_id := String(row.get("id", ""))
		if not row_id.is_empty() and seen.has(row_id):
			continue
		var section_id := _row_section_id(row)
		if not section_id.is_empty() and seen.has("section:%s" % section_id):
			continue
		_append_overview_card(result, seen, row, i)
		if result.size() >= max_cards:
			return result
		if not section_id.is_empty():
			seen["section:%s" % section_id] = true
	return result

func _visible_overview_card_limit() -> int:
	var screen_id := String(ui_screen_model.current_screen if ui_screen_model != null else "")
	match screen_id:
		"play", "certification", "community", "player_settings":
			return mini(4, ui_overview_buttons.size())
		"modes":
			return mini(5, ui_overview_buttons.size())
		"match":
			return mini(5, ui_overview_buttons.size())
		"network_match":
			return mini(4, ui_overview_buttons.size())
		"results":
			return mini(4, ui_overview_buttons.size())
		_:
			return mini(3, ui_overview_buttons.size())

func _append_overview_card_by_id(result: Array[Dictionary], seen: Dictionary, rows: Array[Dictionary], row_id: String) -> void:
	if row_id.is_empty() or seen.has(row_id):
		return
	for i in range(rows.size()):
		var row: Dictionary = rows[i]
		if String(row.get("id", "")) == row_id:
			_append_overview_card(result, seen, row, i)
			return

func _append_overview_card(result: Array[Dictionary], seen: Dictionary, row: Dictionary, row_index: int) -> void:
	var row_id := String(row.get("id", ""))
	if not row_id.is_empty():
		seen[row_id] = true
	result.append({
		"row": row,
		"row_index": row_index,
	})

func _overview_priority_ids(screen_id: String) -> Array[String]:
	if ui_screen_model != null and ui_screen_model.has_method("page_layout"):
		var layout_value: Variant = ui_screen_model.page_layout(screen_id)
		if typeof(layout_value) == TYPE_DICTIONARY:
			var priority_value: Variant = (layout_value as Dictionary).get("overview_priority_ids", [])
			if typeof(priority_value) == TYPE_ARRAY:
				var priority_rows: Array[String] = []
				for row_id_value in priority_value as Array:
					priority_rows.append(String(row_id_value))
				return priority_rows
	match screen_id:
		"main_menu":
			return ["play", "certification", "community", "player_settings"]
		"play":
			return ["play_practice", "play_matchmaking", "play_pvp_duel", "play_world_boss", "play_room", "play_deck"]
		"certification":
			return ["cert_queue", "cert_practice", "cert_deck", "cert_rules"]
		"community":
			return ["community_events", "community_friends", "community_social", "community_promotions"]
		"player_settings":
			return ["settings_gamepad_curve", "settings_keybinds", "settings_volume", "settings_resolution", "settings_input", "settings_save_now"]
		"input_settings":
			return ["input_profile", "gamepad_curve", "gamepad_sensitivity", "binding_shoot"]
		"audio_settings":
			return ["audio", "audio_event_visual_cues", "audio_group_master", "audio_group_music"]
		"display_settings":
			return ["display", "display_resolution", "display_window_mode", "display_fps_limit"]
		"match":
			return ["matchmaking_quick", "matchmaking_ranked", "matchmaking_pvp", "matchmaking_boss", "matchmaking_room", "queue_status"]
		"network_match":
			return ["gensoulkyo_login", "gensoulkyo_create_room", "gensoulkyo_join_room", "gensoulkyo_server_ready"]
		"activity":
			return ["activity_summary", "activity_social", "announce_architecture", "activity_task_daily_complete_match", "activity_claim_log"]
		"friends":
			return ["friends_summary", "friends_social", "friend_lumen", "friend_rin"]
		"social":
			return ["social_summary", "announce_architecture", "friend_lumen", "link_discord"]
		"promotions":
			return ["promotions_summary", "promotions_social", "link_steam", "link_creator_program"]
		_:
			return []

func _is_overview_candidate(row: Dictionary) -> bool:
	if row.is_empty() or not bool(row.get("enabled", true)):
		return false
	var row_id := String(row.get("id", ""))
	if row_id.is_empty():
		return false
	if not String(row.get("overview_card_kind", "")).is_empty():
		return true
	if row_id.ends_with("_summary"):
		return _row_control_id(row) == "status"
	if row.has("screen") or not String(row.get("ui_action", "")).is_empty():
		return true
	var control_id := _row_control_id(row)
	return control_id in ["nav", "queue", "button", "select", "toggle", "slider", "link", "friend", "claim", "chest", "card", "replay", "mode"]

func _format_ui_overview_card(card: Dictionary) -> String:
	var row: Dictionary = card.get("row", {})
	var row_index := int(card.get("row_index", -1))
	var marker := "> " if ui_screen_model != null and row_index == ui_screen_model.cursor else ""
	var label := _trim_ui_card_text(_row_label_text(row), 22)
	var detail := _trim_ui_card_text(_overview_card_detail(row), 28)
	if detail.is_empty():
		return "%s%s" % [marker, label]
	return "%s%s\n%s" % [marker, label, detail]

func _overview_card_detail(row: Dictionary) -> String:
	if not String(row.get("preview_card_primary_metric", "")).is_empty():
		var primary_metric := String(row.get("preview_card_primary_metric", ""))
		var secondary_metric := String(row.get("preview_card_secondary_metric", ""))
		if not secondary_metric.is_empty():
			return "%s | %s" % [primary_metric, secondary_metric]
		return primary_metric
	var control_state := _row_control_state_text(row)
	if not control_state.is_empty():
		return control_state
	if row.has("summary"):
		return String(row.get("summary", ""))
	if row.has("value"):
		return String(row.get("value", ""))
	if row.has("screen"):
		return _screen_title(String(row.get("screen", "")))
	if row.has("ui_action"):
		return _ui_action_label(String(row.get("ui_action", "")))
	return _row_section_text(row)

func _trim_ui_card_text(text: String, limit: int) -> String:
	if text.length() <= limit:
		return text
	if limit <= 3:
		return text.substr(0, limit)
	return "%s..." % text.substr(0, limit - 3)

func _on_ui_overview_button_focus_entered(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var row_index := int(button.get_meta("row_index", -1))
	if row_index >= 0:
		_ui_set_cursor(row_index)

func _on_ui_overview_button_pressed(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var row_index := int(button.get_meta("row_index", -1))
	if row_index < 0:
		return
	_ui_set_cursor(row_index)
	var row: Dictionary = ui_screen_model.selected_row()
	if _overview_card_should_accept(row):
		_ui_accept_selected()

func _overview_card_should_accept(row: Dictionary) -> bool:
	if row.is_empty() or not bool(row.get("enabled", true)):
		return false
	return row.has("screen") or not String(row.get("ui_action", "")).is_empty() or row.has("character_id") or row.has("stage_id") or row.has("pattern_id") or row.has("card_id") or not String(row.get("replay_id", "")).is_empty()

func _ui_press_visible_overview_card(index: int) -> Dictionary:
	if index < 0 or index >= ui_overview_buttons.size():
		return {"ok": false, "action": "overview_card_invalid"}
	var button := ui_overview_buttons[index]
	if button == null or not button.is_visible_in_tree():
		return {"ok": false, "action": "overview_card_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "overview_card_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var row_index := int(button.get_meta("row_index", -1))
	var row_id := String(button.get_meta("row_id", ""))
	_on_ui_overview_button_pressed(button)
	return {
		"ok": row_index >= 0,
		"action": "overview_card",
		"row_index": row_index,
		"row_id": row_id,
		"screen": ui_screen_model.current_screen if ui_screen_model != null else "",
	}

func _update_ui_quick_actions(rows: Array[Dictionary], selected: Dictionary) -> void:
	var actions := _quick_action_rows(rows, selected)
	for i in range(ui_quick_buttons.size()):
		var button := ui_quick_buttons[i]
		if i >= actions.size():
			_ui_deactivate_button(button, ["row_index", "row_id", "screen_id"])
			continue
		var action_row: Dictionary = actions[i]
		var row_index := int(action_row.get("row_index", -1))
		button.visible = true
		var screen_id := String(action_row.get("screen", ""))
		button.disabled = row_index < 0 and screen_id.is_empty()
		_ui_mark_button_owner(button)
		button.set_meta("row_index", row_index)
		button.set_meta("row_id", String(action_row.get("row_id", "")))
		button.set_meta("screen_id", screen_id)
		button.set_meta("target_row_id", String(action_row.get("target_row_id", "")))
		button.text = String(action_row.get("label", ""))
		button.tooltip_text = String(action_row.get("tooltip", button.text))

func _quick_action_rows(rows: Array[Dictionary], selected: Dictionary) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	var seen: Dictionary = {}
	_append_shell_navigation_quick_actions(result, seen)
	return result

func _append_quick_action_by_id(result: Array[Dictionary], seen: Dictionary, rows: Array[Dictionary], row_id: String, selected_id: String) -> void:
	if row_id.is_empty() or seen.has(row_id):
		return
	for i in range(rows.size()):
		var row: Dictionary = rows[i]
		if String(row.get("id", "")) != row_id:
			continue
		_append_quick_action(result, seen, row, i, selected_id)
		return

func _append_quick_action(result: Array[Dictionary], seen: Dictionary, row: Dictionary, row_index: int, selected_id: String) -> void:
	if row.is_empty() or not bool(row.get("enabled", true)):
		return
	if not _is_quick_action_row(row):
		return
	var row_id := String(row.get("id", ""))
	if row_id.is_empty() or seen.has(row_id):
		return
	seen[row_id] = true
	var label: String = _row_quick_label(row)
	if row_id == selected_id:
		label = "> %s" % label
	result.append({
		"row_index": row_index,
		"row_id": row_id,
		"target_row_id": String(row.get("target_row_id", "")),
		"label": label,
		"tooltip": _format_ui_row(row),
	})

func _shell_navigation_quick_action_count() -> int:
	if ui_screen_model == null or not ui_screen_model.has_method("shell_navigation_rows"):
		return 0
	var rows: Array[Dictionary] = ui_screen_model.shell_navigation_rows()
	return mini(rows.size(), ui_quick_buttons.size())

func _append_shell_navigation_quick_actions(result: Array[Dictionary], seen: Dictionary) -> void:
	if ui_screen_model == null or not ui_screen_model.has_method("shell_navigation_rows"):
		return
	var shell_rows: Array[Dictionary] = ui_screen_model.shell_navigation_rows()
	for row in shell_rows:
		if result.size() >= ui_quick_buttons.size():
			return
		if not bool(row.get("enabled", true)):
			continue
		var row_id := String(row.get("id", ""))
		var screen_id := String(row.get("screen", ""))
		if row_id.is_empty() or screen_id.is_empty() or seen.has(row_id):
			continue
		seen[row_id] = true
		result.append({
			"row_index": -1,
			"row_id": row_id,
			"screen": screen_id,
			"target_row_id": String(row.get("target_row_id", "")),
			"label": _row_label_text(row),
			"tooltip": "%s: %s" % [_row_label_text(row), String(row.get("summary", ""))],
		})

func _is_quick_action_row(row: Dictionary) -> bool:
	var row_id := String(row.get("id", ""))
	var control_id := _row_control_id(row)
	var action := String(row.get("ui_action", ""))
	if row.has("screen"):
		if row_id.ends_with("_summary"):
			return false
		return control_id == "nav"
	match row_id:
		"cert_queue", "cert_practice", "settings_gamepad_curve", "settings_keybinds", "settings_volume", "settings_resolution", "play_queue_selected", "queue_status", "ready", "cancel", "gensoulkyo_login", "gensoulkyo_create_room", "battle_client_prepare", "battle_client_connect", "battle_client_input_header", "matchmaking_quick", "matchmaking_ranked", "matchmaking_pvp", "matchmaking_boss", "local_settlement_preview", "matchmaking_room":
			return true
	if action in ["advance_queue", "start_certification_queue", "ready_match", "cancel_queue", "battle_client_prepare", "battle_client_connect", "battle_client_input_header", "open_social_link", "invite_friend", "dismiss_announcement", "request_activity_claim", "select_mode", "queue_mode", "local_settle_match", "open_chest", "save_deck", "save_replay", "toggle_replay_favorite", "remove_replay_from_index", "run_balance_simulation", "run_latency_tests"]:
		return true
	return false

func _row_quick_label(row: Dictionary) -> String:
	var label := _row_label_text(row)
	if row.has("screen"):
		var screen_id := String(row.get("screen", ""))
		if not screen_id.is_empty():
			return _screen_title(screen_id)
	return label

func _on_ui_quick_button_pressed(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var row_index := int(button.get_meta("row_index", -1))
	var screen_id := String(button.get_meta("screen_id", ""))
	var target_row_id := String(button.get_meta("target_row_id", ""))
	if row_index < 0 and not screen_id.is_empty():
		_open_ui_screen(screen_id, target_row_id)
		return
	if row_index < 0:
		return
	_ui_set_cursor(row_index)
	_ui_accept_selected()

func _ui_press_visible_quick_action(index: int) -> Dictionary:
	if index < 0 or index >= ui_quick_buttons.size():
		return {"ok": false, "action": "quick_action_invalid"}
	var button := ui_quick_buttons[index]
	if button == null or not button.is_visible_in_tree():
		return {"ok": false, "action": "quick_action_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "quick_action_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var row_index := int(button.get_meta("row_index", -1))
	var row_id := String(button.get_meta("row_id", ""))
	var screen_id := String(button.get_meta("screen_id", ""))
	var target_row_id := String(button.get_meta("target_row_id", ""))
	_on_ui_quick_button_pressed(button)
	return {"ok": row_index >= 0 or not screen_id.is_empty(), "action": "quick_action", "row_index": row_index, "row_id": row_id, "screen": screen_id, "target_row_id": target_row_id}

func _update_ui_control_buttons(row: Dictionary) -> void:
	var actions := _control_button_actions(row)
	for i in range(ui_control_buttons.size()):
		var button := ui_control_buttons[i]
		if i >= actions.size():
			_ui_deactivate_button(button, ["control_action", "direction"])
			continue
		var control_action: Dictionary = actions[i]
		button.visible = true
		button.disabled = false
		_ui_mark_button_owner(button)
		button.text = String(control_action.get("label", ""))
		button.tooltip_text = String(control_action.get("tooltip", button.text))
		button.set_meta("control_action", String(control_action.get("action", "")))
		button.set_meta("direction", int(control_action.get("direction", 0)))

func _control_button_actions(row: Dictionary) -> Array[Dictionary]:
	var actions: Array[Dictionary] = []
	if row.is_empty() or not bool(row.get("enabled", true)):
		return actions
	match _row_control_id(row):
		"select":
			actions.append({"label": "<", "tooltip": "Previous option", "action": "adjust_selected", "direction": -1})
			actions.append({"label": ">", "tooltip": "Next option", "action": "adjust_selected", "direction": 1})
		"slider":
			actions.append({"label": "-", "tooltip": "Decrease value", "action": "adjust_selected", "direction": -1})
			actions.append({"label": "+", "tooltip": "Increase value", "action": "adjust_selected", "direction": 1})
		"toggle":
			actions.append({"label": "Toggle", "tooltip": "Toggle value", "action": "adjust_selected", "direction": 1})
	if _row_has_direct_control_action(row):
		actions.append({
			"label": _row_label_text(row),
			"tooltip": _format_ui_row(row),
			"action": "accept_selected",
			"direction": 0,
		})
	if _row_is_binding_row(row):
		actions.append({"label": "Capture", "tooltip": "Capture next key press", "action": "capture_selected", "direction": 0})
	if _row_has_reset_action(row):
		actions.append({"label": "Reset", "tooltip": "Restore default value", "action": "reset_selected", "direction": 0})
	return actions

func _on_ui_control_button_pressed(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var action := String(button.get_meta("control_action", ""))
	var direction := int(button.get_meta("direction", 0))
	if action == "adjust_selected":
		_ui_adjust_selected_control(direction)
	elif action == "accept_selected":
		_ui_accept_selected()
	elif action == "reset_selected":
		_ui_reset_selected_control()
	elif action == "capture_selected":
		_ui_capture_selected_binding()

func _row_has_direct_control_action(row: Dictionary) -> bool:
	if row.is_empty() or not bool(row.get("enabled", true)):
		return false
	var row_id := String(row.get("id", ""))
	var action := String(row.get("ui_action", ""))
	return row_id.begins_with("replay_action_") and action in [
		"load_replay",
		"toggle_replay_favorite",
		"remove_replay_from_index",
	]

func _ui_adjust_selected_control(direction: int) -> Dictionary:
	if ui_screen_model == null:
		return {"ok": false, "action": "missing_ui"}
	var row: Dictionary = ui_screen_model.selected_row()
	if row.is_empty():
		return _set_ui_action_result(false, "adjust_selected", {"reason": "empty"})
	if not bool(row.get("enabled", true)):
		return _set_ui_action_result(false, "adjust_selected", {"reason": "disabled"})
	if not row.has("ui_action"):
		return _set_ui_action_result(false, "adjust_selected", {"reason": "no_action"})
	if not _row_accepts_directional_adjust(row):
		return _set_ui_action_result(false, "adjust_selected", {"reason": "unsupported_control"})
	var adjusted_row := row.duplicate(true)
	adjusted_row["direction"] = -1 if direction < 0 else 1
	return _dispatch_ui_action(adjusted_row)

func _row_accepts_directional_adjust(row: Dictionary) -> bool:
	if row.is_empty():
		return false
	if _row_is_binding_row(row):
		return true
	return _row_control_id(row) in ["select", "slider", "toggle"]

func _row_has_reset_action(row: Dictionary) -> bool:
	var action := String(row.get("ui_action", ""))
	return action in [
		"cycle_input_profile",
		"cycle_input_binding",
		"cycle_gamepad_curve",
		"cycle_language",
		"cycle_voice_locale",
		"adjust_gamepad_sensitivity",
		"adjust_gamepad_deadzone",
		"adjust_gamepad_vibration",
		"adjust_audio_volume",
		"toggle_event_visual_cues",
		"toggle_high_frequency_graze_audio",
		"cycle_resolution",
		"cycle_window_mode",
		"toggle_vsync",
		"cycle_fps_limit",
		"adjust_screen_shake",
		"adjust_background_dim",
		"toggle_low_flash",
		"toggle_simplified_background",
		"toggle_always_show_hitbox",
		"toggle_practice_graze_ring",
		"cycle_palette",
		"adjust_bullet_alpha",
	]

func _row_is_binding_row(row: Dictionary) -> bool:
	return String(row.get("ui_action", "")) == "cycle_input_binding" and not String(row.get("action", "")).is_empty()

func _ui_reset_selected_control() -> Dictionary:
	if ui_screen_model == null:
		return {"ok": false, "action": "missing_ui"}
	var row: Dictionary = ui_screen_model.selected_row()
	if row.is_empty():
		return _set_ui_action_result(false, "reset_selected", {"reason": "empty"})
	if not _row_has_reset_action(row):
		return _set_ui_action_result(false, "reset_selected", {"reason": "unsupported"})
	return _reset_ui_control(row)

func _ui_capture_selected_binding() -> Dictionary:
	if ui_screen_model == null:
		return {"ok": false, "action": "missing_ui"}
	var row: Dictionary = ui_screen_model.selected_row()
	if not _row_is_binding_row(row):
		return _set_ui_action_result(false, "capture_input_binding", {"reason": "unsupported"})
	return _begin_input_capture(StringName(String(row.get("action", ""))))

func _begin_input_capture(action: StringName) -> Dictionary:
	if input_profile == null or not input_profile.REQUIRED_ACTIONS.has(action):
		return _set_ui_action_result(false, "capture_input_binding", {"reason": "unsupported_action"})
	input_capture_active = true
	input_capture_action = action
	input_capture_keycode = 0
	input_capture_status = "waiting"
	return _set_ui_action_result(true, "capture_input_binding", {"action_name": String(action), "status": input_capture_status})

func _cancel_input_capture() -> Dictionary:
	var action_name := String(input_capture_action)
	input_capture_active = false
	input_capture_action = StringName()
	input_capture_keycode = 0
	input_capture_status = "cancelled"
	return _set_ui_action_result(true, "cancel_input_binding", {"action_name": action_name, "status": input_capture_status})

func _commit_input_capture(keycode: int) -> Dictionary:
	if input_profile == null or not input_capture_active:
		return _set_ui_action_result(false, "commit_input_binding", {"reason": "not_capturing"})
	var action := input_capture_action
	var ok: bool = input_profile.rebind_action(action, [keycode])
	input_capture_active = false
	input_capture_action = StringName()
	input_capture_keycode = keycode
	input_capture_status = "captured_%s" % OS.get_keycode_string(keycode) if ok else "failed"
	return _set_ui_action_result(ok, "commit_input_binding", {
		"action_name": String(action),
		"keycode": keycode,
		"key": OS.get_keycode_string(keycode),
		"status": input_capture_status,
	})

func _capture_binding_for_test(action_name: String, keycode: int) -> Dictionary:
	var begin_result: Dictionary = _begin_input_capture(StringName(action_name))
	if not bool(begin_result.get("ok", false)):
		return begin_result
	return _commit_input_capture(keycode)

func _ui_press_visible_control(index: int) -> Dictionary:
	if index < 0 or index >= ui_control_buttons.size():
		return {"ok": false, "action": "control_button_invalid"}
	var button := ui_control_buttons[index]
	if button == null or not button.is_visible_in_tree():
		return {"ok": false, "action": "control_button_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "control_button_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var direction := int(button.get_meta("direction", 0))
	var action := String(button.get_meta("control_action", ""))
	var selected_id := String(ui_screen_model.selected_row().get("id", "")) if ui_screen_model != null else ""
	_on_ui_control_button_pressed(button)
	return {"ok": not action.is_empty(), "action": action, "direction": direction, "row_id": selected_id}

func _on_ui_nav_button_pressed(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var screen_id := String(button.get_meta("screen_id", ""))
	if screen_id.is_empty():
		return
	_open_ui_screen(screen_id)

func _on_ui_row_button_focus_entered(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var row_index := int(button.get_meta("row_index", -1))
	if row_index >= 0:
		_ui_set_cursor(row_index)

func _on_ui_row_button_pressed(button: Button) -> void:
	if button == null or ui_screen_model == null:
		return
	if not _ui_button_owned_by_current_screen(button):
		return
	var row_index := int(button.get_meta("row_index", -1))
	if row_index >= 0:
		_ui_set_cursor(row_index)
	_ui_accept_selected()

func _ui_press_visible_nav(index: int) -> Dictionary:
	if index < 0 or index >= ui_nav_row_labels.size():
		return {"ok": false, "action": "nav_button_invalid"}
	var button := ui_nav_row_labels[index]
	if button == null or not button.is_visible_in_tree():
		return {"ok": false, "action": "nav_button_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "nav_button_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var screen_id := String(button.get_meta("screen_id", ""))
	_on_ui_nav_button_pressed(button)
	return {"ok": not screen_id.is_empty(), "action": "nav_button", "screen": screen_id}

func _ui_press_visible_row(index: int) -> Dictionary:
	if index < 0 or index >= ui_row_labels.size():
		return {"ok": false, "action": "row_button_invalid"}
	var button := ui_row_labels[index]
	if button == null or not button.is_visible_in_tree():
		return {"ok": false, "action": "row_button_hidden"}
	if not _ui_button_owned_by_current_screen(button):
		return {"ok": false, "action": "row_button_stale", "owner": String(button.get_meta("owner_screen", ""))}
	var row_index := int(button.get_meta("row_index", -1))
	_on_ui_row_button_pressed(button)
	return {"ok": row_index >= 0, "action": "row_button", "row_index": row_index}

func _ui_nav_window_start(nav_rows: Array[Dictionary]) -> int:
	if nav_rows.size() <= ui_nav_row_labels.size():
		return 0
	var active_index := 0
	for i in range(nav_rows.size()):
		if bool(nav_rows[i].get("active", false)):
			active_index = i
			break
	return clampi(active_index - int(ui_nav_row_labels.size() / 2), 0, nav_rows.size() - ui_nav_row_labels.size())

func _screen_title(screen_id: String) -> String:
	match screen_id:
		"main_menu":
			return "SpellKard"
		"play":
			return localization.text_for("screen.main.play")
		"certification":
			return localization.text_for("screen.main.certification")
		"practice":
			return localization.text_for("ui.practice")
		"match":
			return localization.text_for("screen.main.start_match")
		"network_match":
			return localization.text_for("screen.main.network_match")
		"modes":
			return localization.text_for("screen.main.modes")
		"deck":
			return localization.text_for("screen.main.deck")
		"chest":
			return localization.text_for("screen.main.chest")
		"activity":
			return localization.text_for("screen.main.events")
		"community":
			return localization.text_for("screen.main.community")
		"friends":
			return localization.text_for("screen.main.friends")
		"social":
			return localization.text_for("screen.main.social")
		"promotions":
			return localization.text_for("screen.main.promotions")
		"workshop":
			return localization.text_for("screen.main.workshop")
		"replay":
			return localization.text_for("screen.main.replay")
		"player_settings":
			return localization.text_for("screen.main.player_settings")
		"input_settings":
			return localization.text_for("screen.settings.input_profile")
		"audio_settings":
			return localization.text_for("screen.settings.audio")
		"display_settings":
			return localization.text_for("screen.settings.display")
		"settings":
			return localization.text_for("screen.main.settings")
		"results":
			return localization.text_for("screen.results.result")
		_:
			return screen_id

func _ui_status_text(rows: Array[Dictionary]) -> String:
	if ui_screen_model == null:
		return ""
	var selected: Dictionary = ui_screen_model.selected_row()
	var selected_label: String = _row_label_text(selected)
	var row_count: int = ui_screen_model.screen_rows(64).size()
	return localization.text_for("ui.menu_status", {
		"row": 0 if row_count == 0 else ui_screen_model.cursor + 1,
		"count": row_count,
		"selected": selected_label,
		"action": ui_screen_model.last_action,
	})

func _ui_nav_text(screen_id: String) -> String:
	return localization.text_for("ui.menu_nav", {
		"category": _screen_category_text(screen_id),
		"screen": _screen_title(screen_id),
	})

func _ui_shell_status_text() -> String:
	var summary := _screen_title(ui_screen_model.current_screen if ui_screen_model != null else "")
	if input_capture_active:
		summary = "%s | capture %s" % [summary, String(input_capture_action)]
	return localization.text_for("ui.menu_shell", {"status": summary})

func _ui_section_bar_text(rows: Array[Dictionary], selected: Dictionary) -> String:
	var selected_section := _row_section_text(selected)
	if selected_section.is_empty():
		selected_section = "-"
	return localization.text_for("ui.menu_sections", {
		"selected": selected_section,
		"sections": _trim_ui_card_text(_ui_section_summary(rows), 48),
	})

func _ui_control_preview_text(row: Dictionary) -> String:
	if row.is_empty():
		return localization.text_for("ui.menu_control_preview_empty")
	var state := _row_control_state_text(row)
	if state.is_empty():
		state = _row_label_text(row)
	var boss_action_context := _boss_action_context_text(row)
	if not boss_action_context.is_empty():
		state = "%s | %s" % [state, boss_action_context]
	if row.has("curve_graph"):
		state = "%s | %s" % [state, String(row.get("curve_graph", ""))]
	if row.has("speed_preview"):
		state = "%s | %s" % [state, String(row.get("speed_preview", ""))]
	return localization.text_for("ui.menu_control_preview", {
		"control": _row_control_text(row),
		"state": state,
	})

func _replay_action_guard_text(row: Dictionary) -> String:
	if typeof(row.get("replay_action_guard", {})) != TYPE_DICTIONARY:
		return ""
	var guard: Dictionary = row.get("replay_action_guard", {})
	var parts: Array[String] = []
	parts.append("guard_ok" if bool(guard.get("ok", false)) else "guard_blocked")
	var reason := String(guard.get("reason", ""))
	if reason.is_empty():
		reason = String(row.get("local_load_guard_reason", ""))
	if not reason.is_empty():
		parts.append(reason)
	var policy := String(guard.get("local_load_policy", row.get("local_load_policy", "")))
	if not policy.is_empty() and not parts.has(policy):
		parts.append(policy)
	var audit_status := String(guard.get("server_audit_status", ""))
	if bool(guard.get("requires_server_audit", false)):
		parts.append("server_audit_%s" % (audit_status if not audit_status.is_empty() else "required"))
	var playback_authority := String(guard.get("local_playback_authority", ""))
	if not playback_authority.is_empty() and playback_authority != "none":
		parts.append(playback_authority)
	var settlement_authority := String(guard.get("settlement_authority", ""))
	if not settlement_authority.is_empty():
		parts.append("settlement_%s" % settlement_authority)
	if bool(guard.get("client_result_authoritative", true)):
		parts.append("client_result_authoritative")
	return " ".join(parts)

func _ui_detail_text(row: Dictionary) -> String:
	if row.is_empty():
		return localization.text_for("ui.menu_detail_empty")
	if _screen_category_id(ui_screen_model.current_screen if ui_screen_model != null else "") == "settings":
		var setting_detail := _row_control_state_text(row)
		if setting_detail.is_empty() and row.has("summary"):
			setting_detail = str(row.get("summary", ""))
		if setting_detail.is_empty() and row.has("value"):
			setting_detail = str(row.get("value", ""))
		if row.has("curve_graph"):
			setting_detail = "%s | %s" % [setting_detail, String(row.get("curve_graph", ""))]
		if setting_detail.is_empty():
			setting_detail = _row_label_text(row)
		return localization.text_for("ui.menu_detail", {
			"label": _row_label_text(row),
			"detail": _trim_ui_card_text(setting_detail, 92),
		})
	var detail_parts: Array[String] = []
	var control_text := _row_control_text(row)
	if not control_text.is_empty():
		detail_parts.append(localization.text_for("ui.menu_detail_control", {"control": control_text}))
	var boss_action_context := _boss_action_context_text(row)
	if not boss_action_context.is_empty():
		detail_parts.append(boss_action_context)
	var control_state := _row_control_state_text(row)
	if not control_state.is_empty():
		detail_parts.append(localization.text_for("ui.menu_detail_control_state", {"state": control_state}))
	if row.has("summary"):
		detail_parts.append(str(row.get("summary", "")))
	if row.has("value"):
		detail_parts.append(str(row.get("value", "")))
	if row.has("screen"):
		detail_parts.append(localization.text_for("ui.menu_detail_screen", {"screen": _screen_title(String(row.get("screen", "")))}))
	if row.has("ui_action"):
		detail_parts.append(localization.text_for("ui.menu_detail_action", {"action": _ui_action_label(String(row.get("ui_action", "")))}))
	if not bool(row.get("enabled", true)):
		detail_parts.append(localization.text_for("ui.menu_detail_locked"))
	if detail_parts.is_empty():
		detail_parts.append(_format_ui_row(row))
	return localization.text_for("ui.menu_detail", {
		"label": _row_label_text(row),
		"detail": _trim_ui_card_text(" | ".join(detail_parts), 92),
	})

func _boss_action_context_text(row: Dictionary) -> String:
	if row.is_empty() or String(row.get("mode_category", "")) != "boss":
		return ""
	var receipt_context := _boss_settlement_receipt_context_text(row)
	if not receipt_context.is_empty():
		return receipt_context
	var status := String(row.get("action_status", ""))
	if status.is_empty() and typeof(row.get("action_availability", {})) == TYPE_DICTIONARY:
		var action_availability: Dictionary = row.get("action_availability", {})
		status = String(action_availability.get("action_status", ""))
	if status.is_empty():
		return ""
	var blockers: Array[String] = _ui_string_array(row.get("local_blockers", []))
	if blockers.is_empty() and typeof(row.get("action_availability", {})) == TYPE_DICTIONARY:
		var action_context: Dictionary = row.get("action_availability", {})
		blockers = _ui_string_array(action_context.get("local_blockers", []))
	var confirmation := String(row.get("server_confirmation_status", ""))
	if confirmation.is_empty() and typeof(row.get("action_availability", {})) == TYPE_DICTIONARY:
		var action_projection: Dictionary = row.get("action_availability", {})
		confirmation = String(action_projection.get("server_confirmation_status", ""))
	var parts: Array[String] = [status]
	if not confirmation.is_empty():
		parts.append("server %s" % confirmation)
	if not blockers.is_empty():
		parts.append("blocked %s" % ",".join(blockers))
	return "boss action %s" % " ".join(parts)

func _boss_settlement_receipt_context_text(row: Dictionary) -> String:
	var receipt_projection: Dictionary = {}
	if typeof(row.get("settlement_receipt_projection", {})) == TYPE_DICTIONARY:
		receipt_projection = row.get("settlement_receipt_projection", {})
	var receipt: Dictionary = {}
	if typeof(row.get("settlement_receipt", {})) == TYPE_DICTIONARY:
		receipt = row.get("settlement_receipt", {})
	elif typeof(receipt_projection.get("settlement_receipt", {})) == TYPE_DICTIONARY:
		receipt = receipt_projection.get("settlement_receipt", {})
	var receipt_status := String(row.get("receipt_status", receipt_projection.get("receipt_status", "")))
	var receipt_id := String(row.get("result_receipt_id", receipt_projection.get("result_receipt_id", receipt.get("receipt_id", "")))).strip_edges()
	var result_hash := String(row.get("result_hash", receipt_projection.get("result_hash", receipt.get("result_hash", "")))).strip_edges()
	var replay_id := String(row.get("result_replay_id", receipt_projection.get("result_replay_id", receipt.get("replay_id", "")))).strip_edges()
	var server_time := String(row.get("result_server_time", receipt_projection.get("result_server_time", receipt.get("server_time", "")))).strip_edges()
	var key_id := String(row.get("result_key_id", receipt_projection.get("result_key_id", receipt.get("key_id", "")))).strip_edges()
	var rejected_reason := String(row.get("result_rejected_reason", receipt_projection.get("result_rejected_reason", ""))).strip_edges()
	var result_rejected := bool(row.get("result_rejected", receipt_projection.get("result_rejected", false))) or not rejected_reason.is_empty()
	if receipt_status.is_empty() and receipt_id.is_empty() and result_hash.is_empty() and replay_id.is_empty() and server_time.is_empty() and key_id.is_empty() and not result_rejected:
		return ""
	var result_status := String(row.get("result_status", receipt_projection.get("result_status", "pending")))
	var parts: Array[String] = [receipt_status if not receipt_status.is_empty() else "pending_server_receipt"]
	if not receipt_id.is_empty():
		parts.append("id %s" % receipt_id)
	if not result_hash.is_empty():
		parts.append("hash %s" % result_hash)
	if not replay_id.is_empty():
		parts.append("replay %s" % replay_id)
	if not server_time.is_empty():
		parts.append("time %s" % server_time)
	if not key_id.is_empty():
		parts.append("key %s" % key_id)
	if not result_status.is_empty():
		parts.append("result %s" % result_status)
	var receipt_context := "boss server receipt %s" % " ".join(parts)
	if result_rejected:
		return "rejected %s | %s" % [rejected_reason if not rejected_reason.is_empty() else "server_required", receipt_context]
	return receipt_context

func _ui_hint_text(screen_id: String, row: Dictionary, rows: Array[Dictionary]) -> String:
	var action_hint: String = localization.text_for("ui.menu_hint_apply")
	if row.is_empty():
		action_hint = localization.text_for("ui.menu_hint_empty")
	elif row.has("screen"):
		action_hint = localization.text_for("ui.menu_hint_open", {"screen": _screen_title(String(row.get("screen", "")))})
	elif row.has("ui_action"):
		action_hint = localization.text_for("ui.menu_hint_action", {"action": _ui_action_label(String(row.get("ui_action", "")))})
	elif not bool(row.get("enabled", true)):
		action_hint = localization.text_for("ui.menu_hint_locked")
	return localization.text_for("ui.menu_hint", {
		"category": _screen_category_text(screen_id),
		"count": rows.size(),
		"action": action_hint,
	})

func _screen_category_text(screen_id: String) -> String:
	return localization.text_for("ui.menu_section_%s" % _screen_category_id(screen_id))

func _screen_category_id(screen_id: String) -> String:
	match screen_id:
		"main_menu", "play", "certification", "practice", "match", "network_match", "modes":
			return "play"
		"deck", "chest", "results", "replay":
			return "collection"
		"activity", "community", "friends", "social", "promotions", "workshop":
			return "community"
		"player_settings", "input_settings", "audio_settings", "display_settings", "settings":
			return "settings"
		_:
			return "system"

func _ui_action_label(action: String) -> String:
	match action:
		"start_certification_queue":
			return localization.text_for("screen.cert.queue")
		"advance_queue":
			return localization.text_for("screen.play.matchmaking")
		"queue_mode":
			return localization.text_for("screen.play.matchmaking")
		"select_mode":
			return localization.text_for("screen.match.mode")
		"invite_friend":
			return localization.text_for("screen.social.friend")
		"open_social_link":
			return localization.text_for("screen.social.link")
		"dismiss_announcement":
			return localization.text_for("screen.social.announcement")
		"cycle_input_profile":
			return localization.text_for("screen.settings.input_profile")
		"cycle_input_binding":
			return localization.text_for("screen.settings.input_binding")
		"cycle_language", "reset_language":
			return localization.text_for("screen.settings.language")
		"cycle_voice_locale", "reset_voice_locale":
			return localization.text_for("screen.settings.voice_language")
		"cycle_gamepad_curve", "adjust_gamepad_sensitivity", "adjust_gamepad_deadzone", "adjust_gamepad_vibration", "reset_gamepad_settings":
			return localization.text_for("screen.settings.gamepad")
		"adjust_audio_volume", "toggle_event_visual_cues", "toggle_high_frequency_graze_audio", "reset_audio_settings":
			return localization.text_for("screen.settings.audio")
		"cycle_resolution", "cycle_window_mode", "toggle_vsync", "cycle_fps_limit", "adjust_screen_shake", "adjust_background_dim", "reset_display_settings":
			return localization.text_for("screen.settings.display")
		"reset_accessibility_settings":
			return localization.text_for("screen.settings.accessibility")
		"save_player_settings":
			return localization.text_for("screen.settings.save")
		"load_player_settings":
			return localization.text_for("screen.settings.reload")
		"restore_default_player_settings":
			return localization.text_for("screen.settings.restore_defaults")
		"request_activity_claim":
			return localization.text_for("screen.activity.claim_log")
		"local_settle_match":
			return localization.text_for("screen.match.local_settlement")
		"open_chest":
			return localization.text_for("screen.main.chest")
		"save_deck":
			return localization.text_for("screen.deck.stats")
		_:
			return action.replace("_", " ")

func _row_label_text(row: Dictionary) -> String:
	if row.is_empty():
		return "-"
	var label_key := str(row.get("label_key", ""))
	if not label_key.is_empty():
		return localization.text_for(label_key)
	if row.has("label"):
		return str(row.get("label", ""))
	return str(row.get("id", row.get("card_id", row.get("replay_id", "-"))))

func _format_ui_overlay_row(row: Dictionary, prefix: String, all_rows: Array[Dictionary], absolute_index: int) -> String:
	var text := prefix + _format_ui_row(row)
	var control_state := _row_control_state_text(row)
	if not control_state.is_empty():
		text = "%s  %s" % [text, _inline_control_state_text(row, control_state)]
	if _should_show_section_header(row, all_rows, absolute_index):
		var section_text := _row_section_text(row)
		if not section_text.is_empty():
			return "[%s]\n%s" % [section_text, text]
	return text

func _should_show_section_header(row: Dictionary, all_rows: Array[Dictionary], absolute_index: int) -> bool:
	var section_id := _row_section_id(row)
	if section_id.is_empty():
		return false
	if absolute_index <= 0 or absolute_index >= all_rows.size():
		return true
	return _row_section_id(all_rows[absolute_index - 1]) != section_id

func _row_section_id(row: Dictionary) -> String:
	if row.is_empty():
		return ""
	return String(row.get("section", ""))

func _row_section_text(row: Dictionary) -> String:
	var section_id := _row_section_id(row)
	if section_id.is_empty():
		return ""
	var label_key := String(row.get("section_label_key", "ui.menu_section_%s" % section_id))
	return localization.text_for(label_key)

func _row_control_id(row: Dictionary) -> String:
	if row.is_empty():
		return ""
	return String(row.get("ui_control", ""))

func _row_control_text(row: Dictionary) -> String:
	var control_id := _row_control_id(row)
	if control_id.is_empty():
		return ""
	var label_key := String(row.get("ui_control_label_key", "ui.control_%s" % control_id))
	return localization.text_for(label_key)

func _row_control_state_text(row: Dictionary) -> String:
	var control_id := _row_control_id(row)
	if _row_is_binding_row(row) and input_capture_active and String(input_capture_action) == String(row.get("action", "")):
		return "capturing..."
	if String(row.get("preview_card_kind", "")) == "boss_spellbook_practice_preview":
		var primary_metric := String(row.get("preview_card_primary_metric", ""))
		var secondary_metric := String(row.get("preview_card_secondary_metric", ""))
		if not primary_metric.is_empty() and not secondary_metric.is_empty():
			return "%s | %s" % [primary_metric, secondary_metric]
		if not primary_metric.is_empty():
			return primary_metric
	match control_id:
		"toggle":
			return localization.text_for("ui.on") if _row_toggle_control_value(row) else localization.text_for("ui.off")
		"slider":
			var value := float(row.get("control_value", 0.0))
			var min_value := float(row.get("control_min", 0.0))
			var max_value := float(row.get("control_max", 1.0))
			var unit := String(row.get("control_unit", ""))
			var numeric := "%.2f" % value
			if unit == "percent":
				numeric = "%.0f%%" % (value * 100.0)
			return "%s %s" % [_slider_bar(value, min_value, max_value), numeric]
		"select":
			var options: Array = row.get("control_options", [])
			if options.is_empty():
				return ""
			var option_index := int(row.get("control_option_index", -1))
			if option_index < 0 or option_index >= options.size():
				return String(row.get("value", ""))
			return "%s (%d/%d)" % [str(options[option_index]), option_index + 1, options.size()]
		"replay":
			var guard_text := _replay_action_guard_text(row)
			if not guard_text.is_empty():
				return guard_text
			var policy := String(row.get("local_load_policy", ""))
			var guard := String(row.get("local_load_guard_reason", ""))
			if policy.is_empty() and not String(row.get("verification_status", "")).is_empty():
				policy = String(row.get("verification_status", ""))
			if guard.is_empty() and bool(row.get("requires_server_audit", false)):
				guard = "server_audit_required"
			if guard.is_empty():
				return policy
			if policy.is_empty():
				return guard
			return "%s %s" % [policy, guard]
	return ""

func _inline_control_state_text(row: Dictionary, control_state: String) -> String:
	match _row_control_id(row):
		"select":
			return "< %s >" % control_state
		"slider":
			return "- %s +" % control_state
		"toggle":
			return "[%s]" % control_state
	return control_state

func _row_toggle_control_value(row: Dictionary) -> bool:
	var value: Variant = row.get("control_value", false)
	if typeof(value) == TYPE_BOOL:
		return bool(value)
	if typeof(value) == TYPE_STRING:
		var text := String(value).to_lower()
		return text == "on" or text == "true" or text == "yes"
	return bool(value)

func _slider_bar(value: float, min_value: float, max_value: float) -> String:
	var width := 8
	var span := maxf(0.001, max_value - min_value)
	var ratio := clampf((value - min_value) / span, 0.0, 1.0)
	var filled := clampi(int(round(ratio * width)), 0, width)
	var text := "["
	for i in range(width):
		text += "#" if i < filled else "-"
	text += "]"
	return text

func _ui_section_summary(rows: Array[Dictionary]) -> String:
	var labels: Array[String] = []
	var seen: Dictionary = {}
	for row in rows:
		var section_id := _row_section_id(row)
		if section_id.is_empty() or seen.has(section_id):
			continue
		seen[section_id] = true
		var label := _row_section_text(row)
		if not label.is_empty():
			labels.append(label)
	return " > ".join(labels)

func _ui_control_summary(rows: Array[Dictionary]) -> String:
	var labels: Array[String] = []
	var seen: Dictionary = {}
	for row in rows:
		var control_id := _row_control_id(row)
		if control_id.is_empty() or seen.has(control_id):
			continue
		seen[control_id] = true
		var label := _row_control_text(row)
		if not label.is_empty():
			labels.append(label)
	return " > ".join(labels)

func _format_ui_row(row: Dictionary) -> String:
	var label_key := str(row.get("label_key", ""))
	var label_text: String = localization.text_for(label_key) if not label_key.is_empty() else str(row.get("label", row.get("id", row.get("card_id", row.get("group", "-")))))
	if String(row.get("id", "")) == "gamepad_curve_preview":
		return "%s %s" % [label_text, _gamepad_curve_preview_text(row)]
	if row.has("summary"):
		return "%s: %s" % [label_text, str(row.get("summary", ""))]
	if String(row.get("id", "")) == "social_summary":
		return "%s %s" % [label_text, String(row.get("value", ""))]
	if String(row.get("label_key", "")) == "screen.social.announcement":
		return "%s [%s] %s %s" % [
			label_text,
			String(row.get("priority", "")),
			String(row.get("title", "")),
			"new" if bool(row.get("unread", false)) and bool(row.get("enabled", true)) else "seen",
		]
	if String(row.get("label_key", "")) == "screen.social.friend":
		return "%s%s %s %s" % [
			"* " if bool(row.get("selected", false)) else "",
			String(row.get("display_name", "")),
			String(row.get("status", "")),
			String(row.get("mode", "")),
		]
	if String(row.get("label_key", "")) == "screen.social.link":
		return "%s %s %s" % [String(row.get("title", "")), String(row.get("kind", "")), String(row.get("url", ""))]
	if String(row.get("id", "")).begins_with("cert_"):
		if row.has("items"):
			var cert_items: Array = row.get("items", [])
			return "%s: %s (%d)" % [label_text, str(row.get("value", "")), cert_items.size()]
		return "%s: %s" % [label_text, str(row.get("value", ""))]
	if String(row.get("id", "")) == "friends_summary" or String(row.get("id", "")) == "promotions_summary":
		return "%s: %s" % [label_text, str(row.get("value", ""))]
	if String(row.get("id", "")).begins_with("gamepad_"):
		return "%s %s" % [label_text, String(row.get("value", ""))]
	if String(row.get("id", "")).begins_with("display_"):
		return "%s %s" % [label_text, String(row.get("value", ""))]
	if String(row.get("id", "")).begins_with("binding_"):
		var keys: Array = row.get("keys", [])
		var conflict_text := ""
		if int(row.get("conflict_count", 0)) > 0:
			conflict_text = " conflict %s" % ",".join(row.get("conflict_actions", []) as Array)
		return "%s %s [%s%s]" % [String(row.get("label", "")), "+".join(keys), "custom" if bool(row.get("custom", false)) else "preset", conflict_text]
	if String(row.get("id", "")).begins_with("play_"):
		return "%s %s" % [label_text, String(row.get("value", ""))]
	if String(row.get("id", "")).begins_with("matchmaking_"):
		return "%s %s" % [label_text, String(row.get("value", ""))]
	if String(row.get("id", "")) == "pvp_duel":
		return "%s %s" % [label_text, String(row.get("value", ""))]
	if String(row.get("id", "")) == "practice_stage_run":
		return "%s %s %s" % [label_text, String(row.get("value", "stage run")), _practice_mode_label()]
	if String(row.get("id", "")) == "stage_briefing":
		var stage_types: Array = row.get("pattern_types", [])
		return "%s d%d %s patterns %d [%s] rec %s" % [
			label_text,
			int(row.get("difficulty", 0)),
			String(row.get("tempo", "")),
			int(row.get("pattern_count", 0)),
			",".join(stage_types),
			String(row.get("recommended_character_id", "")),
		]
	if String(row.get("id", "")) == "stage_math_route":
		var basis_route: Array = row.get("math_basis_route", [])
		var hints: Array = row.get("readability_hints", [])
		return "%s route %s dens %s danger %s peak %.1f/s hints %s" % [
			label_text,
			" > ".join(basis_route),
			String(row.get("density_peak", "")),
			String(row.get("danger_peak", "")),
			float(row.get("spawn_peak_per_second", 0.0)),
			",".join(hints),
		]
	if String(row.get("id", "")) == "stage_recommended_character":
		return "%s rec %s" % [label_text, String(row.get("recommended_character_id", ""))]
	if String(row.get("id", "")) == "stage_practice_plan":
		var plan_basis_route: Array = row.get("math_basis_route", [])
		var phase_pattern_ids: Array = row.get("phase_pattern_ids", [])
		return "%s plan %s phases %d peak %s/%s rec %s" % [
			label_text,
			" > ".join(plan_basis_route),
			phase_pattern_ids.size(),
			String(row.get("density_peak", "")),
			String(row.get("danger_peak", "")),
			String(row.get("recommended_character_id", "")),
		]
	if String(row.get("id", "")).begins_with("stage_practice_preset_"):
		var preset_basis_route: Array = row.get("math_basis_route", [])
		return "%s preset %s pattern %s seed %d p%.1f b%d basis %s" % [
			label_text,
			String(row.get("preset_kind", "")),
			String(row.get("focus_pattern_id", "")),
			int(row.get("practice_seed", 0)),
			float(row.get("practice_initial_power", 0.0)),
			int(row.get("practice_initial_bombs", 0)),
			" > ".join(preset_basis_route),
		]
	if str(row.get("id", "")) == "deck_stats":
		var validation: Dictionary = row.get("validation", {})
		var stats: Dictionary = validation.get("stats", {})
		var reasons: Array = validation.get("reasons", [])
		return "%s %s %d/%d save %s %s" % [
			label_text,
			"ok" if bool(validation.get("valid", false)) else "invalid",
			int(stats.get("count", 0)),
			DeckBuilderModelLib.DECK_SIZE,
			str(row.get("save_status", "")),
			"-" if reasons.is_empty() else ",".join(reasons),
		]
	if row.has("card_id"):
		return "%s  %s/%s cost %.1f owned %d deck %d size %d" % [
			localization.text_for(str(row.get("name_key", ""))),
			str(row.get("rarity", "")),
			str(row.get("type", "")),
			float(row.get("cost", 0.0)),
			int(row.get("owned", 0)),
			int(row.get("in_deck", 0)),
			int(row.get("deck_size", 0)),
		]
	if row.has("replay_id"):
		return "%s %s score %d %s" % [
			"*" if bool(row.get("favorite", false)) else "-",
			str(row.get("saved_at", "")),
			int(row.get("score", 0)),
			str(row.get("mode", "")),
		]
	if row.has("character_id"):
		return "%s%s move %.0f slow %.0f graze %.2f spell %.2f" % [
			"* " if bool(row.get("selected", false)) else "",
			label_text,
			float(row.get("move_speed", 0.0)),
			float(row.get("slow_speed", 0.0)),
			float(row.get("graze_modifier", 1.0)),
			float(row.get("spell_power_modifier", 1.0)),
		]
	if row.has("stage_id"):
		var stage_types: Array = row.get("pattern_types", [])
		return "%s%s d%d %s patterns %d [%s] rec %s" % [
			"* " if bool(row.get("selected", false)) else "",
			label_text,
			int(row.get("difficulty", 0)),
			str(row.get("tempo", "")),
			int(row.get("pattern_count", 0)),
			",".join(stage_types),
			str(row.get("recommended_character", "")),
		]
	if row.has("pattern_id") and row.has("math_basis"):
		return "%s%s %s dens %s danger %s %.1f/s %s" % [
			"* " if bool(row.get("selected", false)) else "",
			label_text,
			str(row.get("math_basis", "")),
			str(row.get("density_estimate", "")),
			str(row.get("danger_estimate", "")),
			float(row.get("spawn_rate_per_second", 0.0)),
			str(row.get("readability_hint", "")),
		]
	if row.has("catalog_id") and row.has("phase_id"):
		return "%s %s/%s timeout %d enrage %d cap %d preview %d" % [
			label_text,
			String(row.get("catalog_id", "")),
			String(row.get("phase_id", "")),
			int(row.get("timeout_ticks", 0)),
			int(row.get("enrage_after_ticks", 0)),
			int(row.get("bullet_cap_per_tick", 0)),
			int(row.get("max_preview_emit", 0)),
		]
	if row.has("pattern_id") and row.has("pattern_type"):
		return "%s%s %s every %dt count %d speed %.0f" % [
			"* " if bool(row.get("selected", false)) else "",
			label_text,
			str(row.get("pattern_type", "")),
			int(row.get("interval_ticks", 0)),
			int(row.get("count", 0)),
			float(row.get("speed", 0.0)),
		]
	if row.has("group"):
		return "%s %.0f%%" % [str(row.get("group", "")), float(row.get("volume", 0.0)) * 100.0]
	if row.has("activity_kind"):
		var kind := str(row.get("activity_kind", ""))
		var claim_status := "settled" if bool(row.get("claim_settled", false)) else ("requested" if bool(row.get("claim_requested", false)) else "claim")
		match kind:
			"task":
				return "%s %d/%d %s %s" % [
					label_text,
					int(row.get("progress", 0)),
					int(row.get("target", 1)),
					claim_status,
					"" if bool(row.get("enabled", true)) else "(%s)" % str(row.get("blocked_reason", "locked")),
				]
			"event":
				return "%s points %d %s %s" % [
					label_text,
					int(row.get("points", 0)),
					str(row.get("reward_status", "pending")),
					claim_status if claim_status != "claim" else ("" if bool(row.get("enabled", true)) else "(%s)" % str(row.get("blocked_reason", "locked"))),
				]
			"leaderboard":
				return "%s rank %d top %.1f%% %s" % [
					label_text,
					int(row.get("rank", 0)),
					float(row.get("percentile", 1.0)) * 100.0,
					claim_status if claim_status != "claim" else ("" if bool(row.get("enabled", true)) else "(%s)" % str(row.get("blocked_reason", "locked"))),
				]
	if row.has("mode_ruleset_version"):
		return "%s %d-%d %s wait %ds %s" % [
			label_text,
			int(row.get("min_players", 1)),
			int(row.get("max_players", 1)),
			str(row.get("mode_ruleset_version", "")),
			int(row.get("estimated_wait_seconds", 0)),
			"" if bool(row.get("enabled", true)) else "(%s)" % str(row.get("blocked_reason", "locked")),
		]
	if row.has("items") and str(row.get("id", "")).begins_with("br_"):
		var br_items: Array = row.get("items", [])
		if str(row.get("id", "")) == "br_candidates":
			return "%s: %s (%d) next %s" % [
				label_text,
				str(row.get("value", "")),
				br_items.size(),
				str(row.get("candidate_card_id", "")),
			]
		return "%s: %s (%d)" % [label_text, str(row.get("value", "")), br_items.size()]
	if row.has("items") and (str(row.get("id", "")).contains("boss") or str(row.get("id", "")).begins_with("cert_")):
		var mode_items: Array = row.get("items", [])
		if row.has("transfer_request"):
			var transfer_request: Dictionary = row.get("transfer_request", {})
			return "%s: %s (%d) %s>%s %s" % [
				label_text,
				str(row.get("value", "")),
				mode_items.size(),
				str(transfer_request.get("from_player_id", "")),
				str(transfer_request.get("to_player_id", "")),
				str(transfer_request.get("card_id", "")),
			]
		return "%s: %s (%d)" % [label_text, str(row.get("value", "")), mode_items.size()]
	if ["tasks", "events", "leaderboards", "reward_audit", "reward", "activity_claim_log"].has(str(row.get("id", ""))):
		var result_items: Array = row.get("items", [])
		return "%s: %s (%d)" % [label_text, str(row.get("value", "")), result_items.size()]
	if row.has("pity"):
		var pity: Dictionary = row.get("pity", {})
		return "%s owned %d pity R %d/%d E %d/%d" % [
			label_text,
			int(row.get("owned", 0)),
			int(pity.get("rare_counter", 0)),
			int(pity.get("rare_threshold", 0)),
			int(pity.get("epic_counter", 0)),
			int(pity.get("epic_threshold", 0)),
		]
	if row.has("items"):
		var items: Array = row.get("items", [])
		return "%s: %d" % [label_text, items.size()]
	if row.has("summary"):
		return "%s: %s" % [label_text, str(row.get("summary", ""))]
	if row.has("value"):
		return "%s: %s" % [label_text, str(row.get("value", ""))]
	if row.has("enabled"):
		return "%s %s" % [label_text, "" if bool(row.get("enabled", true)) else "(locked)"]
	return label_text

func _gamepad_curve_preview_text(row: Dictionary) -> String:
	var graph := String(row.get("curve_graph", ""))
	var summary := String(row.get("summary", ""))
	if graph.is_empty():
		return summary
	if summary.is_empty():
		return graph
	return "%s | %s" % [graph, summary]

func _draw() -> void:
	if not _should_draw_gameplay_scene():
		_draw_menu_backdrop()
		return
	draw_rect(PLAYFIELD, accessibility_settings.background_fill(), true)
	draw_rect(PLAYFIELD, accessibility_settings.border_color(), false, 2.0)
	_draw_playfield_guides()
	_draw_boss_playfield_projection()
	_draw_target()

	for bullet in bullets:
		var color_name := String(bullet.get("color_name", "red"))
		var color: Color = accessibility_settings.color_for(color_name, bullet.get("color", Color(0.95, 0.23, 0.28)))
		if bool(bullet.get("grazed", false)):
			color = color.lightened(0.20 if accessibility_settings.low_flash else 0.34)
		_draw_bullet_visual(bullet, color)
		if show_bullet_hitboxes:
			_draw_bullet_hitbox_debug(bullet, Color(1.0, 1.0, 1.0, 0.35))

	if _should_draw_server_bullets():
		_draw_server_bullets()

	for shot in player_shots:
		var shot_color_name := str(shot.get("color_name", "cyan"))
		var shot_color: Color = accessibility_settings.color_for(shot_color_name, Color(0.45, 0.95, 1.00))
		draw_circle(shot["pos"], float(shot.get("radius", PLAYER_SHOT_RADIUS)), shot_color)

	var player_color := Color(0.35, 0.85, 1.00) if accessibility_settings.low_flash or invuln_ticks <= 0 or tick % 8 < 4 else Color(0.35, 0.85, 1.00, 0.36)
	draw_circle(player_pos, 9.0, player_color)
	if Input.is_action_pressed("focus") or accessibility_settings.always_show_hitbox:
		if accessibility_settings.practice_graze_ring:
			draw_circle(player_pos, GRAZE_RADIUS, Color(0.35, 0.85, 1.00, 0.16))
		var hitbox_visual_scale: float = character_model.hitbox_visual_scale() if character_model != null else 1.0
		draw_circle(player_pos, HIT_RADIUS * hitbox_visual_scale * float(self_modifiers.get("hit_radius_multiplier", 1.0)), Color(1.00, 1.00, 1.00))
	if show_event_log:
		_draw_event_log()

func _should_show_gameplay_hud() -> bool:
	return _should_draw_gameplay_scene() or show_performance_stats

func _should_draw_gameplay_scene() -> bool:
	return bool(_ui_page_layout().get("show_gameplay", ui_screen_model == null))

func _should_advance_gameplay_tick() -> bool:
	return bool(_ui_page_layout().get("advance_gameplay", ui_screen_model == null))

func _boss_playfield_draw_snapshot() -> Dictionary:
	var mode_id := _boss_projection_mode_id()
	if mode_id.is_empty() or game_mode_model == null or not game_mode_model.has_method("boss_playfield_projection"):
		return {
			"enabled": false,
			"reason": "boss_mode_inactive",
			"client_result_authoritative": false,
		}
	var projection: Dictionary = game_mode_model.boss_playfield_projection(mode_id, PLAYFIELD)
	var hud_projection: Dictionary = game_mode_model.boss_hud_projection(mode_id, PLAYFIELD) if game_mode_model.has_method("boss_hud_projection") else {}
	var slots: Array = projection.get("display_slots", [])
	return {
		"enabled": bool(projection.get("ok", false)) and slots.size() > 0,
		"reason": String(projection.get("reason", "none")),
		"mode_id": mode_id,
		"slot_count": slots.size(),
		"hp_ratio": float(projection.get("hp_ratio", 0.0)),
		"projection_scope": String(projection.get("projection_scope", "")),
		"damage_authority": String(projection.get("damage_authority", "")),
		"reward_authority": String(hud_projection.get("reward_authority", "server")),
		"settlement_authority": String(projection.get("settlement_authority", "")),
		"friendly_fire_warning": String(projection.get("friendly_fire_warning", "none")),
		"gameplay_visible": _should_draw_gameplay_scene(),
		"projection": projection,
		"hud_projection": hud_projection,
		"server_authoritative": bool(projection.get("server_authoritative", false)),
		"client_result_authoritative": false,
	}

func _boss_projection_mode_id() -> String:
	if game_mode_model == null:
		return ""
	var mode_id := String(game_mode_model.get("selected_mode_id"))
	if mode_id == "world_boss" or mode_id == "instance_boss":
		return mode_id
	return ""

func _draw_menu_backdrop() -> void:
	var viewport_size := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, viewport_size), Color(0.045, 0.050, 0.055), true)
	draw_rect(Rect2(Vector2(0.0, viewport_size.y * 0.64), Vector2(viewport_size.x, viewport_size.y * 0.36)), Color(0.070, 0.082, 0.078), true)
	if _is_home_screen():
		_draw_home_standee()
	else:
		_draw_secondary_menu_backdrop()

func _draw_home_standee() -> void:
	if ui_home_portrait_panel == null:
		return
	var rect := Rect2(ui_home_portrait_panel.global_position, ui_home_portrait_panel.size)
	if rect.size.x <= 1.0 or rect.size.y <= 1.0:
		return
	var center := rect.position + Vector2(rect.size.x * 0.50, rect.size.y * 0.56)
	var height := rect.size.y * 0.66
	var width := minf(rect.size.x * 0.42, height * 0.42)
	draw_circle(center + Vector2(0, -height * 0.36), width * 0.27, Color(0.78, 0.80, 0.78, 0.45))
	var body := PackedVector2Array([
		center + Vector2(0, -height * 0.18),
		center + Vector2(-width * 0.44, height * 0.30),
		center + Vector2(-width * 0.20, height * 0.50),
		center + Vector2(width * 0.20, height * 0.50),
		center + Vector2(width * 0.44, height * 0.30),
	])
	draw_colored_polygon(body, Color(0.62, 0.68, 0.65, 0.34))
	draw_line(center + Vector2(-width * 0.78, height * 0.55), center + Vector2(width * 0.78, height * 0.55), Color(0.76, 0.64, 0.40, 0.55), 2.0)
	draw_arc(center + Vector2(0, -height * 0.05), width * 0.70, PI * 0.12, PI * 0.88, 32, Color(0.84, 0.42, 0.38, 0.36), 2.0)

func _draw_secondary_menu_backdrop() -> void:
	var viewport_size := get_viewport_rect().size
	var preview_rect := Rect2(Vector2(30, 44), Vector2(minf(430.0, viewport_size.x * 0.46), minf(540.0, viewport_size.y - 88.0)))
	draw_rect(preview_rect, Color(0.08, 0.10, 0.11, 0.72), true)
	draw_rect(preview_rect, Color(0.42, 0.50, 0.56, 0.36), false, 1.0)
	for i in range(5):
		var y := preview_rect.position.y + 60.0 + float(i) * 72.0
		draw_line(Vector2(preview_rect.position.x + 26.0, y), Vector2(preview_rect.position.x + preview_rect.size.x - 26.0, y + 14.0), Color(0.58, 0.64, 0.64, 0.12), 2.0)

func _should_draw_server_bullets() -> bool:
	if network_match_model == null:
		return false
	if String(network_match_model.get("authority_state")) != "running":
		return false
	var table_value: Variant = network_match_model.get("server_bullets")
	return typeof(table_value) == TYPE_DICTIONARY and not (table_value as Dictionary).is_empty()

func _draw_server_bullets() -> void:
	var table_value: Variant = network_match_model.get("server_bullets")
	if typeof(table_value) != TYPE_DICTIONARY:
		return
	var server_bullet_table: Dictionary = table_value as Dictionary
	for bullet_value in server_bullet_table.values():
		if typeof(bullet_value) != TYPE_DICTIONARY:
			continue
		var bullet: Dictionary = _local_bullet_from_server_bullet(bullet_value as Dictionary, server_bullet_table.size())
		var color_name := String(bullet.get("color_name", "white"))
		var color: Color = accessibility_settings.color_for(color_name, bullet.get("color", Color(0.95, 0.96, 1.00)))
		_draw_bullet_visual(bullet, color)
		if show_bullet_hitboxes:
			_draw_bullet_hitbox_debug(bullet, Color(0.70, 0.90, 1.0, 0.35))

func _local_bullet_from_server_bullet(server_bullet: Dictionary, density: int) -> Dictionary:
	var color_name := String(server_bullet.get("color", "white"))
	var bullet := {
		"pos": Vector2(float(server_bullet.get("x", 0.0)), float(server_bullet.get("y", 0.0))),
		"vel": Vector2(float(server_bullet.get("vx", 0.0)) * 60.0, float(server_bullet.get("vy", 0.0)) * 60.0),
		"radius": float(server_bullet.get("radius", 5.0)),
		"pattern_id": String(server_bullet.get("pattern_id", "")),
		"color_name": _server_color_name(color_name),
		"color": _server_color_fallback(color_name),
		"card_modified": false,
	}
	if bullet_visual_model != null:
		bullet["visual"] = bullet_visual_model.presentation_for_bullet(bullet, density)
	return bullet

func _server_color_name(color_name: String) -> String:
	match color_name:
		"amber":
			return "gold"
		"ruby":
			return "red"
		"blue", "pink", "lime":
			return "cyan" if color_name == "blue" else ("violet" if color_name == "pink" else "green")
		_:
			return color_name

func _server_color_fallback(color_name: String) -> Color:
	match color_name:
		"blue":
			return Color(0.34, 0.62, 1.00)
		"pink":
			return Color(1.00, 0.42, 0.78)
		"amber":
			return Color(1.00, 0.68, 0.22)
		"ruby":
			return Color(0.92, 0.12, 0.25)
		"lime":
			return Color(0.48, 0.95, 0.42)
		_:
			return Color(0.95, 0.96, 1.00)

func _draw_bullet_visual(bullet: Dictionary, color: Color) -> void:
	var visual: Dictionary = bullet.get("visual", {})
	var pos: Vector2 = bullet["pos"]
	var radius := float(bullet.get("radius", 5.0))
	var presentation_radius := maxf(radius, float(visual.get("presentation_radius", radius)))
	var decorative_alpha := float(visual.get("decorative_alpha", 0.92))
	var decoration_color := color
	decoration_color.a *= decorative_alpha
	var kind := String(visual.get("kind", "small_orb"))
	var shape := String(bullet.get("shape", String(visual.get("shape", "circle"))))
	if shape == "laser" or shape == "capsule":
		_draw_capsule_bullet_visual(bullet, color, decoration_color, presentation_radius)
		return
	if shape == "polyline_laser" or shape == "polyline" or shape == "curve_laser":
		_draw_polyline_bullet_visual(bullet, color, decoration_color, presentation_radius)
		return
	if presentation_radius > radius + 0.1:
		match kind:
			"star":
				_draw_star(pos, presentation_radius, decoration_color)
			"laser_warning":
				draw_arc(pos, presentation_radius + 3.0, 0.0, TAU, 32, Color(1.0, 0.18, 0.16, decoration_color.a * 0.7), 2.0)
				draw_line(pos + Vector2(-presentation_radius, 0), pos + Vector2(presentation_radius, 0), Color(1.0, 0.18, 0.16, decoration_color.a * 0.45), 1.0)
			_:
				draw_circle(pos, presentation_radius, decoration_color)
	if bool(visual.get("tail", false)):
		var velocity: Vector2 = bullet.get("vel", Vector2.ZERO)
		if velocity.length() > 0.001:
			var tail_end := pos - velocity.normalized() * minf(28.0, presentation_radius * 4.0)
			draw_line(tail_end, pos, Color(color.r, color.g, color.b, minf(color.a, 0.42 * decorative_alpha)), 2.0)
	draw_circle(pos, radius, color)
	if bool(visual.get("outline", false)):
		var outline_color := Color(1.0, 1.0, 1.0, 0.58)
		if bool(visual.get("card_modified", false)):
			outline_color = Color(1.0, 0.92, 0.35, 0.72)
		draw_arc(pos, presentation_radius, 0.0, TAU, 24, outline_color, 1.35)

func _draw_capsule_bullet_visual(bullet: Dictionary, color: Color, decoration_color: Color, presentation_radius: float) -> void:
	var pos: Vector2 = bullet["pos"]
	var length := float(bullet.get("length", 0.0))
	var angle := float(bullet.get("angle", bullet.get("vel", Vector2.RIGHT).angle()))
	var radius := float(bullet.get("radius", 5.0))
	var half := Vector2.RIGHT.rotated(angle) * length * 0.5
	var a := pos - half
	var b := pos + half
	draw_line(a, b, decoration_color, presentation_radius * 2.0)
	draw_circle(a, presentation_radius, decoration_color)
	draw_circle(b, presentation_radius, decoration_color)
	draw_line(a, b, color, radius * 2.0)
	draw_circle(a, radius, color)
	draw_circle(b, radius, color)
	if bool(bullet.get("visual", {}).get("outline", true)):
		var outline := Color(1.0, 1.0, 1.0, 0.34)
		draw_line(a, b, outline, presentation_radius * 2.0 + 1.5)

func _draw_polyline_bullet_visual(bullet: Dictionary, color: Color, decoration_color: Color, presentation_radius: float) -> void:
	var points := _bullet_polyline_world_points(bullet)
	if points.size() < 2:
		draw_circle(bullet["pos"], float(bullet.get("radius", 5.0)), color)
		return
	var radius := float(bullet.get("radius", 5.0))
	for i in range(points.size() - 1):
		draw_line(points[i], points[i + 1], decoration_color, presentation_radius * 2.0)
	for point in points:
		draw_circle(point, presentation_radius, decoration_color)
	for i in range(points.size() - 1):
		draw_line(points[i], points[i + 1], color, radius * 2.0)
	for point in points:
		draw_circle(point, radius, color)
	if bool(bullet.get("visual", {}).get("outline", true)):
		var outline := Color(1.0, 1.0, 1.0, 0.34)
		for i in range(points.size() - 1):
			draw_line(points[i], points[i + 1], outline, presentation_radius * 2.0 + 1.5)

func _draw_bullet_hitbox_debug(bullet: Dictionary, color: Color) -> void:
	var shape := String(bullet.get("shape", "circle"))
	if shape == "polyline_laser" or shape == "polyline" or shape == "curve_laser":
		var points := _bullet_polyline_world_points(bullet)
		if points.size() >= 2:
			for i in range(points.size() - 1):
				draw_line(points[i], points[i + 1], color, float(bullet.get("radius", 5.0)) * 2.0)
			return
	draw_arc(bullet["pos"], float(bullet.get("radius", 5.0)), 0.0, TAU, 18, color, 1.0)

func _bullet_polyline_world_points(bullet: Dictionary) -> Array[Vector2]:
	var points: Array[Vector2] = []
	var raw_points: Variant = bullet.get("points", [])
	var pos: Vector2 = bullet.get("pos", Vector2.ZERO)
	if typeof(raw_points) == TYPE_ARRAY:
		for point in raw_points as Array:
			if typeof(point) == TYPE_VECTOR2:
				var relative_point: Vector2 = point
				points.append(pos + relative_point)
	return points

func _draw_star(pos: Vector2, radius: float, color: Color) -> void:
	var points := PackedVector2Array()
	for i in range(10):
		var point_radius := radius if i % 2 == 0 else radius * 0.48
		var angle := -PI * 0.5 + TAU * float(i) / 10.0
		points.append(pos + Vector2(cos(angle), sin(angle)) * point_radius)
	draw_colored_polygon(points, color)

func _draw_playfield_guides() -> void:
	if not show_debug_overlay:
		return
	var center_x := PLAYFIELD.position.x + PLAYFIELD.size.x * 0.5
	draw_line(Vector2(center_x, PLAYFIELD.position.y), Vector2(center_x, PLAYFIELD.position.y + PLAYFIELD.size.y), Color(1, 1, 1, 0.08), 1.0)
	draw_line(Vector2(PLAYFIELD.position.x, player_pos.y), Vector2(PLAYFIELD.position.x + PLAYFIELD.size.x, player_pos.y), Color(1, 1, 1, 0.05), 1.0)
	draw_line(Vector2(PLAYFIELD.position.x, PICKUP_LINE_Y), Vector2(PLAYFIELD.position.x + PLAYFIELD.size.x, PICKUP_LINE_Y), Color(0.35, 0.90, 1.0, 0.18), 1.0)
	if invuln_ticks > 0:
		var character_bomb_radius_multiplier: float = character_model.bomb_radius_multiplier() if character_model != null else 1.0
		draw_arc(player_pos, BOMB_RADIUS * character_bomb_radius_multiplier * float(self_modifiers.get("bomb_radius_multiplier", 1.0)), 0.0, TAU, 96, Color(0.4, 0.8, 1.0, 0.08), 2.0)

func _draw_boss_playfield_projection() -> void:
	var snapshot := _boss_playfield_draw_snapshot()
	if not bool(snapshot.get("enabled", false)):
		return
	var projection: Dictionary = snapshot.get("projection", {})
	var center: Vector2 = projection.get("screen_center", PLAYFIELD.position + PLAYFIELD.size * 0.5)
	var arena_radius := float(projection.get("screen_radius_pixels", 0.0))
	var boss_radius := clampf(arena_radius * 0.16, 26.0, 58.0)
	var hp_ratio := clampf(float(projection.get("hp_ratio", 0.0)), 0.0, 1.0)
	var slots: Array = projection.get("display_slots", [])
	var warning := String(projection.get("friendly_fire_warning", "none"))
	var arena_color := Color(0.30, 0.56, 0.62, 0.22)
	var boss_color := Color(0.84, 0.30, 0.42, 0.30)
	var hp_color := Color(0.88, 0.78, 0.34, 0.82)
	if warning != "none":
		arena_color = Color(0.64, 0.46, 0.24, 0.24)
	draw_arc(center, arena_radius, 0.0, TAU, 96, arena_color, 2.0)
	draw_circle(center, boss_radius, boss_color)
	draw_arc(center, boss_radius + 7.0, -PI * 0.5, -PI * 0.5 + TAU * hp_ratio, 48, hp_color, 3.0)
	draw_arc(center, boss_radius, 0.0, TAU, 48, Color(0.96, 0.70, 0.78, 0.72), 2.0)
	draw_line(center + Vector2(-boss_radius, 0.0), center + Vector2(boss_radius, 0.0), Color(1.0, 1.0, 1.0, 0.40), 1.0)
	draw_line(center + Vector2(0.0, -boss_radius), center + Vector2(0.0, boss_radius), Color(1.0, 1.0, 1.0, 0.40), 1.0)
	for raw_slot in slots:
		var slot: Dictionary = raw_slot
		var slot_position: Vector2 = slot.get("screen_position", center)
		var aim_vector: Vector2 = slot.get("aim_vector", Vector2.ZERO)
		var slot_color := Color(0.38, 0.86, 0.95, 0.82)
		if warning != "none":
			slot_color = Color(0.94, 0.76, 0.34, 0.86)
		draw_line(slot_position, center, Color(slot_color.r, slot_color.g, slot_color.b, 0.18), 1.0)
		draw_circle(slot_position, 8.0, slot_color)
		draw_arc(slot_position, 12.0, 0.0, TAU, 24, Color(1.0, 1.0, 1.0, 0.46), 1.2)
		if aim_vector.length() > 0.01:
			draw_line(slot_position, slot_position + aim_vector.normalized() * 24.0, Color(1.0, 1.0, 1.0, 0.66), 2.0)
	var label := "%s hp %.0f%% %s" % [
		String(projection.get("mode_id", "")),
		hp_ratio * 100.0,
		String(projection.get("damage_authority", "server")),
	]
	draw_string(ThemeDB.fallback_font, center + Vector2(-58.0, boss_radius + 24.0), label, HORIZONTAL_ALIGNMENT_CENTER, 116.0, 12, Color(0.92, 0.94, 0.90, 0.72))

func _draw_target() -> void:
	draw_circle(target_pos, TARGET_RADIUS, Color(0.80, 0.25, 0.35, 0.18))
	draw_arc(target_pos, TARGET_RADIUS, 0.0, TAU, 48, Color(0.95, 0.35, 0.45), 2.0)
	draw_line(target_pos + Vector2(-18, 0), target_pos + Vector2(18, 0), Color(0.95, 0.35, 0.45, 0.8), 1.0)
	draw_line(target_pos + Vector2(0, -18), target_pos + Vector2(0, 18), Color(0.95, 0.35, 0.45, 0.8), 1.0)

func _draw_event_log() -> void:
	var events: Array[Dictionary] = replay_recorder.recent_events(6)
	var pos := Vector2(810, 500)
	for event in events:
		var line := "%d %s" % [int(event.get("tick", 0)), String(event.get("type", ""))]
		draw_string(ThemeDB.fallback_font, pos, line, HORIZONTAL_ALIGNMENT_LEFT, 130.0, 13, Color(0.85, 0.90, 0.95, 0.75))
		pos.y += 16.0
