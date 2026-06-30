extends SceneTree

const MAIN_SCENE := "res://scenes/main.tscn"
const SIMULATED_FRAMES := 180
const ASSET_MANIFEST := "res://assets/asset_manifest.json"
const BASE_THEME_MANIFEST := "res://themes/base/theme_manifest.json"
const BulletPatternLibrary := preload("res://scripts/bullet_pattern_library.gd")
const BulletEngine := preload("res://scripts/bullet_engine.gd")
const BossPatternCatalog := preload("res://scripts/boss_pattern_catalog.gd")
const BossSpellbookModel := preload("res://scripts/boss_spellbook_model.gd")
const ReplayListModelScript := preload("res://scripts/replay_list_model.gd")
const PlayerSettingsStore := preload("res://scripts/player_settings_store.gd")
const InputProfile := preload("res://scripts/input_profile.gd")
const AudioSettings := preload("res://scripts/audio_settings.gd")
const DisplaySettings := preload("res://scripts/display_settings.gd")
const AccessibilitySettings := preload("res://scripts/accessibility_settings.gd")
const SMOKE_SETTINGS_PATH := "user://settings/smoke_player_settings.json"

var frame_count := 0
var main_node: Node = null
var failed := false
var stage := "init"
var validation_started := false

func _initialize() -> void:
	_remove_user_file(PlayerSettingsStore.DEFAULT_PATH)
	_remove_user_file(SMOKE_SETTINGS_PATH)
	var packed_scene := load(MAIN_SCENE)
	if packed_scene == null:
		push_error("Failed to load %s" % MAIN_SCENE)
		failed = true
		quit(1)
		return
	main_node = packed_scene.instantiate()
	root.add_child(main_node)

func _remove_user_file(path: String) -> void:
	if not FileAccess.file_exists(path):
		return
	var directory := path.get_base_dir()
	var file_name := path.get_file()
	var dir := DirAccess.open(directory)
	if dir != null:
		dir.remove(file_name)

func _process(_delta: float) -> bool:
	if failed:
		return true
	frame_count += 1
	if frame_count > SIMULATED_FRAMES + 120:
		push_error("Smoke test failed: timed out at stage %s frame %d" % [stage, frame_count])
		quit(1)
		return true
	if frame_count < SIMULATED_FRAMES:
		return false
	if validation_started:
		return false
	validation_started = true
	stage = "validate_manifests"
	if not _validate_asset_manifests():
		quit(1)
		return true
	stage = "read_main_state"
	var tick_value := int(main_node.get("tick"))
	var bullet_count := int(main_node.get("bullets").size())
	var perf = main_node.get("performance_stats")
	var input_profile = main_node.get("input_profile")
	var localization = main_node.get("localization")
	var theme_registry = main_node.get("theme_registry")
	var accessibility_settings = main_node.get("accessibility_settings")
	var audio_settings = main_node.get("audio_settings")
	var display_settings = main_node.get("display_settings")
	var social_hub_model = main_node.get("social_hub_model")
	var replay_list_model = main_node.get("replay_list_model")
	var deck_builder = main_node.get("deck_builder")
	var ui_screen_model = main_node.get("ui_screen_model")
	var chest_system = main_node.get("chest_system")
	var matchmaking_model = main_node.get("matchmaking_model")
	var network_match_model = main_node.get("network_match_model")
	var gensoulkyo_api_model = main_node.get("gensoulkyo_api_model")
	var game_mode_model = main_node.get("game_mode_model")
	var results_service_model = main_node.get("results_service_model")
	var character_model = main_node.get("character_model")
	var bullet_visual_model = main_node.get("bullet_visual_model")
	var stage_select_model = main_node.get("stage_select_model")
	var pattern_lab_model = main_node.get("pattern_lab_model")
	var boss_spellbook_model = main_node.get("boss_spellbook_model")
	var balance_simulation_model = main_node.get("balance_simulation_model")
	var latency_test_model = main_node.get("latency_test_model")
	var network_security_model = main_node.get("network_security_model")
	var protocol_descriptor_model = main_node.get("protocol_descriptor_model")
	var battle_network_client_model = main_node.get("battle_network_client_model")
	var client_menu_page_model = main_node.get("client_menu_page_model")
	if tick_value != 0 or bullet_count != 0:
		push_error("Smoke test failed: home screen should not advance gameplay demo tick=%d bullets=%d" % [tick_value, bullet_count])
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "practice"):
		push_error("Smoke test failed: practice screen did not open for gameplay tick check")
		quit(1)
		return true
	await _advance_frames(8)
	var practice_tick_value := int(main_node.get("tick"))
	if practice_tick_value <= tick_value:
		push_error("Smoke test failed: gameplay tick did not advance after entering practice")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "main_menu")
	stage = "input_profiles"
	if perf == null:
		push_error("Smoke test failed: performance stats missing")
		quit(1)
		return true
	if accessibility_settings == null:
		push_error("Smoke test failed: accessibility settings missing")
		quit(1)
		return true
	if display_settings == null or not display_settings.validate():
		push_error("Smoke test failed: display settings missing or invalid")
		quit(1)
		return true
	if social_hub_model == null:
		push_error("Smoke test failed: social hub missing")
		quit(1)
		return true
	if network_security_model == null:
		push_error("Smoke test failed: network security model missing")
		quit(1)
		return true
	if protocol_descriptor_model == null:
		push_error("Smoke test failed: protocol descriptor model missing")
		quit(1)
		return true
	if battle_network_client_model == null:
		push_error("Smoke test failed: battle network client model missing")
		quit(1)
		return true
	if client_menu_page_model == null:
		push_error("Smoke test failed: client menu page model missing")
		quit(1)
		return true
	var page_map: Array[Dictionary] = client_menu_page_model.page_map()
	if page_map.size() < 16:
		push_error("Smoke test failed: client menu page map incomplete")
		quit(1)
		return true
	var scene_map_validation: Dictionary = client_menu_page_model.validate_page_scene_map()
	if not bool(scene_map_validation.get("ok", false)):
		push_error("Smoke test failed: client menu scene map invalid %s" % [scene_map_validation])
		quit(1)
		return true
	var scene_contracts: Array[Dictionary] = client_menu_page_model.scene_contracts()
	if scene_contracts.size() < 7:
		push_error("Smoke test failed: client menu scene contracts incomplete")
		quit(1)
		return true
	if not _validate_menu_scene_contracts(scene_contracts):
		quit(1)
		return true
	var play_page_spec: Dictionary = client_menu_page_model.page_spec("play")
	var modes_page_spec: Dictionary = client_menu_page_model.page_spec("modes")
	var settings_page_spec: Dictionary = client_menu_page_model.page_spec("player_settings")
	if String(play_page_spec.get("kind", "")) != "hub" or not (play_page_spec.get("mode_groups", []) as Array).has("pvp") or not (play_page_spec.get("mode_groups", []) as Array).has("boss"):
		push_error("Smoke test failed: play page spec invalid %s" % [play_page_spec])
		quit(1)
		return true
	if String(modes_page_spec.get("kind", "")) != "mode_select" or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("world_boss_rules") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("world_boss_entry") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("world_boss_formation") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("world_boss_display") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("world_boss_playfield") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("world_boss_hud") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("world_boss_practice_preview") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("world_boss_result") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("instance_boss_rules") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("instance_boss_entry") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("instance_boss_formation") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("instance_boss_display") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("instance_boss_playfield") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("instance_boss_hud") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("instance_boss_practice_preview") or not (modes_page_spec.get("secondary_row_ids", []) as Array).has("instance_boss_result"):
		push_error("Smoke test failed: modes page spec Boss rules/result rows invalid %s" % [modes_page_spec])
		quit(1)
		return true
	if String(settings_page_spec.get("kind", "")) != "settings" or not (settings_page_spec.get("setting_groups", []) as Array).has("gamepad") or not (settings_page_spec.get("setting_groups", []) as Array).has("resolution"):
		push_error("Smoke test failed: player settings page spec invalid %s" % [settings_page_spec])
		quit(1)
		return true
	if String(play_page_spec.get("scene_id", "")) != "menu_hub" or String(settings_page_spec.get("scene_id", "")) != "settings_panel" or int(settings_page_spec.get("required_binding_count", 0)) < 6:
		push_error("Smoke test failed: page scene ids invalid play=%s settings=%s" % [play_page_spec, settings_page_spec])
		quit(1)
		return true
	var descriptor_contract: Dictionary = protocol_descriptor_model.validate_minimal_contract()
	if not bool(descriptor_contract.get("ok", false)) or int(descriptor_contract.get("protocol_version", 0)) != 1:
		push_error("Smoke test failed: protocol descriptor contract invalid %s" % [descriptor_contract])
		quit(1)
		return true
	var descriptor_input_payload: Dictionary = protocol_descriptor_model.battle_payload_type_for("input")
	if not bool(descriptor_input_payload.get("ok", false)) or int(descriptor_input_payload.get("number", 0)) != 3 or String(descriptor_input_payload.get("enum_name", "")) != "BATTLE_PAYLOAD_TYPE_INPUT":
		push_error("Smoke test failed: protocol descriptor payload enum invalid %s" % [descriptor_input_payload])
		quit(1)
		return true
	if bool(main_node.get("show_performance_stats")) or bool(main_node.get("show_debug_overlay")) or bool(main_node.get("show_event_log")):
		push_error("Smoke test failed: player UI should start with debug overlays disabled")
		quit(1)
		return true
	var hud_label: Label = main_node.get("hud")
	if hud_label == null or hud_label.visible or not hud_label.text.is_empty():
		push_error("Smoke test failed: home screen should hide gameplay HUD by default")
		quit(1)
		return true
	if input_profile == null or not input_profile.validate_actions():
		push_error("Smoke test failed: input map invalid")
		quit(1)
		return true
	if String(input_profile.profile_name()) != "left_hand" or not input_profile.action_keycodes(&"shoot").has(KEY_Z):
		push_error("Smoke test failed: left-hand input profile not applied")
		quit(1)
		return true
	input_profile.cycle_profile()
	if String(input_profile.profile_name()) != "right_hand" or not input_profile.action_keycodes(&"shoot").has(KEY_K) or not input_profile.validate_actions():
		push_error("Smoke test failed: right-hand input profile not applied")
		quit(1)
		return true
	input_profile.cycle_profile()
	if String(input_profile.profile_name()) != "left_hand" or not input_profile.action_keycodes(&"bomb").has(KEY_X):
		push_error("Smoke test failed: input profile did not cycle back")
		quit(1)
		return true
	if not input_profile.rebind_action(&"shoot", [KEY_C]) or not input_profile.action_keycodes(&"shoot").has(KEY_C) or not input_profile.validate_actions():
		push_error("Smoke test failed: input rebinding did not apply")
		quit(1)
		return true
	if not input_profile.restore_current_profile() or not input_profile.action_keycodes(&"shoot").has(KEY_Z):
		push_error("Smoke test failed: input profile restore did not apply")
		quit(1)
		return true
	var binding_rows: Array[Dictionary] = input_profile.binding_rows()
	if binding_rows.is_empty() or not String(binding_rows[0].get("action", "")).begins_with("move_"):
		push_error("Smoke test failed: input binding rows invalid")
		quit(1)
		return true
	if String(input_profile.conflict_summary()) != "ok" or int(_find_row_by_id(binding_rows, "binding_shoot").get("conflict_count", -1)) != 0:
		push_error("Smoke test failed: default input binding conflict summary invalid")
		quit(1)
		return true
	if not input_profile.rebind_action(&"bomb", [KEY_Z]):
		push_error("Smoke test failed: input conflict setup failed")
		quit(1)
		return true
	var conflict_rows: Array[Dictionary] = input_profile.binding_rows()
	var conflict_shoot_row: Dictionary = _find_row_by_id(conflict_rows, "binding_shoot")
	var conflict_bomb_row: Dictionary = _find_row_by_id(conflict_rows, "binding_bomb")
	if int(conflict_shoot_row.get("conflict_count", 0)) <= 0 or not (conflict_shoot_row.get("conflict_actions", []) as Array).has("bomb") or String(conflict_bomb_row.get("conflict_status", "")) != "conflict":
		push_error("Smoke test failed: input binding conflict rows invalid shoot=%s bomb=%s" % [conflict_shoot_row, conflict_bomb_row])
		quit(1)
		return true
	input_profile.restore_current_profile()
	if audio_settings == null or not audio_settings.validate():
		push_error("Smoke test failed: audio settings invalid")
		quit(1)
		return true
	audio_settings.set_volume("music", 0.25)
	audio_settings.toggle_high_frequency_graze_audio()
	if absf(float(audio_settings.volume_for("music")) - 0.25) > 0.001 or not bool(audio_settings.high_frequency_graze_audio):
		push_error("Smoke test failed: audio settings did not update")
		quit(1)
		return true
	audio_settings.reset_all()
	main_node.call("_apply_audio_settings")
	stage = "character_model"
	if character_model == null:
		push_error("Smoke test failed: character model missing")
		quit(1)
		return true
	var character_rows: Array[Dictionary] = main_node.call("_character_rows")
	if character_rows.size() != 4 or not _rows_have_ids(character_rows, ["character_balanced", "character_precision", "character_wide", "character_spell_power"]):
		push_error("Smoke test failed: character rows invalid")
		quit(1)
		return true
	if not _validate_row_label_keys(character_rows, localization):
		quit(1)
		return true
	if absf(float(character_model.move_speed(false)) - 330.0) > 0.001 or absf(float(character_model.move_speed(true)) - 145.0) > 0.001:
		push_error("Smoke test failed: balanced movement invalid")
		quit(1)
		return true
	if not main_node.call("_select_character", "precision") or String(character_model.selected_character_id) != "precision":
		push_error("Smoke test failed: precision character did not select")
		quit(1)
		return true
	if absf(float(character_model.move_speed(true)) - 108.0) > 0.001 or character_model.shot_rows(true).size() != 2 or float(character_model.graze_modifier()) <= 1.0:
		push_error("Smoke test failed: precision character stats invalid")
		quit(1)
		return true
	if not main_node.call("_select_character", "wide") or character_model.shot_rows(false).size() != 5 or character_model.shot_rows(true).size() != 4:
		push_error("Smoke test failed: wide character shot pattern invalid")
		quit(1)
		return true
	if not main_node.call("_select_character", "spell_power") or float(character_model.spell_power_modifier()) <= 1.0 or float(character_model.bomb_radius_multiplier()) >= 1.0:
		push_error("Smoke test failed: spell power character modifiers invalid")
		quit(1)
		return true
	if String(main_node.call("_cycle_character", 1)).is_empty():
		push_error("Smoke test failed: character cycle invalid")
		quit(1)
		return true
	main_node.call("_select_character", "balanced")
	stage = "bullet_visual_model"
	if bullet_visual_model == null:
		push_error("Smoke test failed: bullet visual model missing")
		quit(1)
		return true
	var visual_samples: Array[Dictionary] = [
		{"radius": 4.0, "vel": Vector2.RIGHT * 90.0, "pattern_id": "spiral_ring", "behavior": {}},
		{"radius": 8.0, "vel": Vector2.DOWN * 130.0, "pattern_id": "slow_blossom", "behavior": {}},
		{"radius": 5.0, "vel": Vector2.DOWN * 94.0, "pattern_id": "curved_homing", "behavior": {"type": "homing"}},
		{"radius": 4.0, "vel": Vector2.DOWN * 220.0, "pattern_id": "seeded_arc", "behavior": {}},
		{"radius": 5.0, "vel": Vector2.DOWN * 140.0, "pattern_id": "aimed_fan", "behavior": {}, "card_modified": true},
	]
	bullet_visual_model.annotate_bullets(visual_samples, 950)
	var small_visual: Dictionary = visual_samples[0].get("visual", {})
	var large_visual: Dictionary = visual_samples[1].get("visual", {})
	var homing_visual: Dictionary = visual_samples[2].get("visual", {})
	var star_visual: Dictionary = visual_samples[3].get("visual", {})
	var card_visual: Dictionary = visual_samples[4].get("visual", {})
	if not bool(small_visual.get("readability_safe", false)) or float(small_visual.get("presentation_radius", 0.0)) < float(small_visual.get("collision_radius", 999.0)):
		push_error("Smoke test failed: bullet visual readability radius invalid")
		quit(1)
		return true
	if String(large_visual.get("kind", "")) != "large_orb" or String(large_visual.get("danger", "")) != "high":
		push_error("Smoke test failed: large bullet danger classification invalid")
		quit(1)
		return true
	if String(homing_visual.get("kind", "")) != "homing" or not bool(homing_visual.get("tail", false)):
		push_error("Smoke test failed: homing visual tail invalid")
		quit(1)
		return true
	if String(star_visual.get("kind", "")) != "star" or String(star_visual.get("speed_band", "")) != "fast" or String(star_visual.get("accent_color_name", "")) != "violet":
		push_error("Smoke test failed: star/speed visual classification invalid")
		quit(1)
		return true
	if not bool(card_visual.get("card_modified", false)) or not bool(card_visual.get("outline", false)):
		push_error("Smoke test failed: card-modified bullet visual marker invalid")
		quit(1)
		return true
	if not _validate_bullet_engine_graze_rules():
		quit(1)
		return true
	if float(bullet_visual_model.decorative_alpha_for_density(950)) >= float(bullet_visual_model.decorative_alpha_for_density(100)):
		push_error("Smoke test failed: high-density decorative alpha did not reduce")
		quit(1)
		return true
	var bullet_visual_rows: Array[Dictionary] = bullet_visual_model.rows()
	if not _rows_have_ids(bullet_visual_rows, ["bullet_visual", "bullet_visual_small_orb", "bullet_visual_large_orb", "bullet_visual_star", "bullet_visual_homing", "bullet_visual_laser_warning"]):
		push_error("Smoke test failed: bullet visual rows invalid")
		quit(1)
		return true
	if not _validate_row_label_keys(bullet_visual_rows, localization):
		quit(1)
		return true
	stage = "stage_select_model"
	if stage_select_model == null:
		push_error("Smoke test failed: stage select model missing")
		quit(1)
		return true
	if pattern_lab_model == null:
		push_error("Smoke test failed: pattern lab model missing")
		quit(1)
		return true
	if boss_spellbook_model == null:
		push_error("Smoke test failed: boss spellbook model missing")
		quit(1)
		return true
	var stage_rows: Array[Dictionary] = main_node.call("_stage_rows")
	if stage_rows.size() < 4 or not _rows_have_ids(stage_rows, ["stage_starlit_lanes", "stage_misty_crossfire", "stage_clockwork_bloom", "stage_lunar_maze"]):
		push_error("Smoke test failed: stage rows invalid")
		quit(1)
		return true
	if not _validate_row_label_keys(stage_rows, localization):
		quit(1)
		return true
	if not stage_select_model.select_stage("lunar_maze") or String(stage_select_model.selected_stage_id) != "lunar_maze":
		push_error("Smoke test failed: stage selection/recommended character invalid")
		quit(1)
		return true
	if String(stage_select_model.active_stage().get("recommended_character", "")) != "spell_power":
		push_error("Smoke test failed: stage recommended character invalid")
		quit(1)
		return true
	var stage_briefing_rows: Array[Dictionary] = main_node.call("_stage_briefing_rows")
	if not _rows_have_ids(stage_briefing_rows, ["stage_briefing", "stage_math_route", "stage_recommended_character", "stage_practice_plan"]):
		push_error("Smoke test failed: stage briefing rows missing")
		quit(1)
		return true
	var math_route_row: Dictionary = _find_row_by_id(stage_briefing_rows, "stage_math_route")
	var basis_route: Array = math_route_row.get("math_basis_route", [])
	var route_steps: Array = math_route_row.get("route_steps", [])
	if route_steps.size() != 3 or not basis_route.has("polar_orbit_tangent") or not basis_route.has("linear_lane_wall") or not basis_route.has("aimed_speed_gradient") or String(math_route_row.get("density_peak", "")) == "" or float(math_route_row.get("spawn_peak_per_second", 0.0)) <= 0.0:
		push_error("Smoke test failed: stage math briefing invalid %s" % [math_route_row])
		quit(1)
		return true
	var recommended_row: Dictionary = _find_row_by_id(stage_briefing_rows, "stage_recommended_character")
	if String(recommended_row.get("recommended_character_id", "")) != "spell_power" or String(recommended_row.get("ui_action", "")) != "apply_recommended_character":
		push_error("Smoke test failed: recommended character briefing invalid")
		quit(1)
		return true
	var stage_plan_row: Dictionary = _find_row_by_id(stage_briefing_rows, "stage_practice_plan")
	if String(stage_plan_row.get("stage_id", "")) != "lunar_maze" or String(stage_plan_row.get("ui_action", "")) != "apply_stage_practice_plan" or int(stage_plan_row.get("phase_pattern_ids", []).size()) != 3:
		push_error("Smoke test failed: stage practice plan row invalid %s" % [stage_plan_row])
		quit(1)
		return true
	var stage_preset_rows: Array[Dictionary] = stage_select_model.practice_preset_rows(pattern_lab_model)
	if not _rows_have_ids(stage_preset_rows, ["stage_practice_preset_route", "stage_practice_preset_peak", "stage_practice_preset_survival"]):
		push_error("Smoke test failed: stage practice presets missing %s" % [stage_preset_rows])
		quit(1)
		return true
	var peak_preset: Dictionary = _find_row_by_id(stage_preset_rows, "stage_practice_preset_peak")
	if String(peak_preset.get("ui_action", "")) != "apply_stage_practice_preset" or String(peak_preset.get("focus_pattern_id", "")).is_empty() or int(peak_preset.get("practice_seed", 0)) <= 0 or float(peak_preset.get("practice_initial_power", 0.0)) <= 0.0:
		push_error("Smoke test failed: stage peak preset invalid %s" % [peak_preset])
		quit(1)
		return true
	var stage_pattern_rows: Array[Dictionary] = main_node.call("_stage_pattern_rows")
	if not _rows_have_ids(stage_pattern_rows, ["stage_pattern_orbital_lattice", "stage_pattern_curtain_wall", "stage_pattern_knife_burst"]):
		push_error("Smoke test failed: stage pattern rows invalid")
		quit(1)
		return true
	if not _validate_row_label_keys(stage_pattern_rows, localization):
		quit(1)
		return true
	var stage_pattern_types: Array[String] = []
	for pattern_row in stage_pattern_rows:
		stage_pattern_types.append(String(pattern_row.get("pattern_type", "")))
	if not stage_pattern_types.has("orbital") or not stage_pattern_types.has("curtain") or not stage_pattern_types.has("burst"):
		push_error("Smoke test failed: stage pattern type coverage invalid")
		quit(1)
		return true
	var pattern_lab_rows: Array[Dictionary] = main_node.call("_pattern_lab_rows")
	if not _validate_pattern_lab_rows(pattern_lab_rows, ["polar_orbit_tangent", "linear_lane_wall", "aimed_speed_gradient"]):
		quit(1)
		return true
	if not _validate_pattern_lab_coverage(stage_select_model, pattern_lab_model):
		quit(1)
		return true
	if not _validate_pattern_emitters(stage_select_model):
		quit(1)
		return true
	if not _validate_boss_pattern_catalog(stage_select_model):
		quit(1)
		return true
	var boss_spellbook_rows_from_main: Array[Dictionary] = main_node.call("_boss_spellbook_rows")
	var boss_spellbook_timeline_from_main: Array[Dictionary] = main_node.call("_boss_spellbook_timeline_rows", "original_boss_archive")
	if not _rows_have_ids(boss_spellbook_rows_from_main, ["boss_spellbook_original_boss_archive"]) or not _rows_have_ids(boss_spellbook_timeline_from_main, ["boss_spell_phase_nonspell_radial_entry", "boss_spell_phase_last_spell_morph_bounce"]):
		push_error("Smoke test failed: boss spellbook main rows invalid")
		quit(1)
		return true
	var boss_spellbook_row_index: int = _row_index_by_id(boss_spellbook_rows_from_main, "boss_spellbook_original_boss_archive")
	if boss_spellbook_row_index < 0 or String(boss_spellbook_rows_from_main[boss_spellbook_row_index].get("ui_action", "")) != "start_boss_spellbook_run":
		push_error("Smoke test failed: boss spellbook start action missing")
		quit(1)
		return true
	if not _validate_row_label_keys(boss_spellbook_rows_from_main, localization) or not _validate_row_label_keys(boss_spellbook_timeline_from_main, localization):
		quit(1)
		return true
	stage_select_model.select_stage("starlit_lanes")
	if not main_node.call("_open_ui_screen", "settings"):
		push_error("Smoke test failed: settings screen did not open for stage selection")
		quit(1)
		return true
	var settings_stage_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	var lunar_cursor: int = _row_index_by_id(settings_stage_rows, "stage_lunar_maze")
	if lunar_cursor < 0:
		push_error("Smoke test failed: lunar stage row missing from settings")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", lunar_cursor)
	var accept_stage: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_stage.get("ok", false)) or String(accept_stage.get("action", "")) != "select_stage" or String(stage_select_model.selected_stage_id) != "lunar_maze" or String(character_model.selected_character_id) != "spell_power":
		push_error("Smoke test failed: UI stage accept invalid")
		quit(1)
		return true
	var lunar_pattern_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	var curtain_cursor: int = _row_index_by_id(lunar_pattern_rows, "stage_pattern_curtain_wall")
	if curtain_cursor < 0:
		push_error("Smoke test failed: curtain pattern row missing from settings")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", curtain_cursor)
	var accept_pattern: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_pattern.get("ok", false)) or String(accept_pattern.get("action", "")) != "select_pattern" or String(stage_select_model.active_pattern().get("id", "")) != "curtain_wall":
		push_error("Smoke test failed: UI pattern accept invalid")
		quit(1)
		return true
	var lunar_lab_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 48)
	var lab_burst_cursor: int = _row_index_by_id(lunar_lab_rows, "pattern_lab_knife_burst")
	if lab_burst_cursor < 0:
		push_error("Smoke test failed: knife burst pattern lab row missing from settings")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", lab_burst_cursor)
	var accept_lab_pattern: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_lab_pattern.get("ok", false)) or String(accept_lab_pattern.get("action", "")) != "select_pattern" or String(stage_select_model.active_pattern().get("id", "")) != "knife_burst":
		push_error("Smoke test failed: UI pattern lab accept invalid")
		quit(1)
		return true
	var character_rows_after_stage: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	var balanced_cursor: int = _row_index_by_id(character_rows_after_stage, "character_balanced")
	if balanced_cursor < 0:
		push_error("Smoke test failed: balanced character row missing from settings")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", balanced_cursor)
	var accept_character: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_character.get("ok", false)) or String(accept_character.get("action", "")) != "select_character" or String(character_model.selected_character_id) != "balanced":
		push_error("Smoke test failed: UI character accept invalid")
		quit(1)
		return true
	var recommended_cursor: int = _row_index_by_id(character_rows_after_stage, "stage_recommended_character")
	if recommended_cursor < 0:
		push_error("Smoke test failed: recommended character action missing from settings")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", recommended_cursor)
	var accept_recommended: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_recommended.get("ok", false)) or String(accept_recommended.get("action", "")) != "apply_recommended_character" or String(character_model.selected_character_id) != "spell_power":
		push_error("Smoke test failed: recommended character action invalid")
		quit(1)
		return true
	if not main_node.call("_select_stage", "misty_crossfire", true):
		push_error("Smoke test failed: stage run setup stage select failed")
		quit(1)
		return true
	var stage_run_started: Dictionary = main_node.call("_dispatch_ui_action", {"ui_action": "toggle_stage_run"})
	if not bool(stage_run_started.get("ok", false)) or not bool(main_node.get("stage_run_enabled")) or int(main_node.get("stage_run_phase_index")) != 0:
		push_error("Smoke test failed: stage run did not start")
		quit(1)
		return true
	main_node.call("_advance_practice_ticks", 620)
	if not bool(main_node.get("stage_run_enabled")) or int(main_node.get("stage_run_phase_index")) != 1 or String(stage_select_model.active_pattern().get("id", "")) != "split_fan":
		push_error("Smoke test failed: stage run did not advance phase")
		quit(1)
		return true
	if int(main_node.get("stage_run_phase_tick")) <= 0 or int(main_node.get("stage_run_phase_tick")) >= 80:
		push_error("Smoke test failed: stage run phase tick invalid")
		quit(1)
		return true
	var spellbook_started: Dictionary = main_node.call("_dispatch_ui_action", {"ui_action": "start_boss_spellbook_run", "spellbook_id": "original_boss_archive"})
	if not bool(spellbook_started.get("ok", false)) or String(spellbook_started.get("action", "")) != "start_boss_spellbook_run" or not bool(main_node.get("boss_spellbook_run_enabled")) or bool(main_node.get("stage_run_enabled")):
		push_error("Smoke test failed: boss spellbook run did not start %s" % [spellbook_started])
		quit(1)
		return true
	main_node.call("_advance_practice_ticks", 40)
	if not bool(main_node.get("boss_spellbook_run_enabled")) or int(main_node.get("boss_spellbook_run_tick")) <= 0 or int(main_node.get("bullets").size()) <= 0:
		push_error("Smoke test failed: boss spellbook run did not emit bullets")
		quit(1)
		return true
	var spellbook_status: Dictionary = main_node.call("_boss_spellbook_run_status")
	if String(spellbook_status.get("spellbook_id", "")) != "original_boss_archive" or String(spellbook_status.get("phase_id", "")).is_empty():
		push_error("Smoke test failed: boss spellbook status invalid %s" % [spellbook_status])
		quit(1)
		return true
	main_node.call("_restart_practice")
	if bool(main_node.get("boss_spellbook_run_enabled")):
		push_error("Smoke test failed: practice restart did not stop boss spellbook run")
		quit(1)
		return true
	main_node.call("_set_demo_index", 2)
	if bool(main_node.get("stage_run_enabled")) or String(stage_select_model.active_pattern().get("id", "")) != "sine_stream":
		push_error("Smoke test failed: manual pattern did not exit stage run")
		quit(1)
		return true
	main_node.call("_select_stage", "starlit_lanes", true)
	main_node.call("_restart_practice")
	main_node.call("_advance_practice_ticks", 90)
	stage = "balance_simulation"
	if balance_simulation_model == null:
		push_error("Smoke test failed: balance simulation model missing")
		quit(1)
		return true
	var balance_report: Dictionary = main_node.call("_run_balance_simulation", {
		"duration_ticks": 240,
		"seeds": [20260625],
		"character_ids": ["balanced", "precision"],
	})
	var balance_aggregate: Dictionary = balance_report.get("aggregate", {})
	if int(balance_report.get("run_count", 0)) <= 0 or float(balance_aggregate.get("average_score", 0.0)) <= 0.0:
		push_error("Smoke test failed: balance simulation aggregate invalid")
		quit(1)
		return true
	if int(balance_aggregate.get("visual_unsafe_count", 0)) != 0 or int(balance_aggregate.get("max_peak_bullets", 0)) <= 0:
		push_error("Smoke test failed: balance simulation readability/perf metrics invalid")
		quit(1)
		return true
	if balance_aggregate.get("character_score_rows", []).size() != 2 or balance_aggregate.get("pattern_score_rows", []).is_empty():
		push_error("Smoke test failed: balance simulation score rows invalid")
		quit(1)
		return true
	var balance_rows: Array[Dictionary] = main_node.call("_balance_simulation_rows")
	if not _rows_have_ids(balance_rows, ["balance_summary", "balance_score", "balance_graze", "balance_hits", "balance_cards"]):
		push_error("Smoke test failed: balance simulation rows invalid")
		quit(1)
		return true
	if not _validate_row_label_keys(balance_rows, localization):
		quit(1)
		return true
	stage = "latency_tests"
	if latency_test_model == null:
		push_error("Smoke test failed: latency test model missing")
		quit(1)
		return true
	var latency_report: Dictionary = main_node.call("_run_latency_tests")
	var latency_aggregate: Dictionary = latency_report.get("aggregate", {})
	if not bool(latency_report.get("ok", false)) or int(latency_report.get("scenario_count", 0)) < 6:
		push_error("Smoke test failed: latency test report invalid")
		quit(1)
		return true
	if int(latency_aggregate.get("max_input_delay_ticks", 0)) > 4 or float(latency_aggregate.get("reconnect_success_rate", 0.0)) < 1.0:
		push_error("Smoke test failed: latency aggregate invalid")
		quit(1)
		return true
	if int(latency_aggregate.get("mode_ok_count", 0)) != int(latency_aggregate.get("mode_count", -1)):
		push_error("Smoke test failed: latency mode gates invalid")
		quit(1)
		return true
	var latency_rows: Array[Dictionary] = main_node.call("_latency_test_rows")
	if not _rows_have_ids(latency_rows, ["latency_summary", "latency_input_delay", "latency_position_error", "latency_corrections", "latency_reconnect"]):
		push_error("Smoke test failed: latency rows invalid")
		quit(1)
		return true
	if not _validate_row_label_keys(latency_rows, localization):
		quit(1)
		return true
	stage = "deck_builder"
	if deck_builder == null:
		push_error("Smoke test failed: deck builder missing")
		quit(1)
		return true
	var deck_validation: Dictionary = deck_builder.validate_working_deck()
	var deck_stats: Dictionary = deck_validation.get("stats", {})
	if not bool(deck_validation.get("valid", false)) or int(deck_stats.get("count", 0)) != 20:
		push_error("Smoke test failed: default deck invalid")
		quit(1)
		return true
	var pattern_rows: Array[Dictionary] = deck_builder.card_rows("rare", "pattern", 16)
	if pattern_rows.is_empty() or String(pattern_rows[0].get("type", "")) != "pattern":
		push_error("Smoke test failed: deck card filters invalid")
		quit(1)
		return true
	var invalid_ids: Array[String] = []
	for i in range(20):
		invalid_ids.append("density_surge")
	var invalid_validation: Dictionary = deck_builder.validate_card_ids(invalid_ids, "ranked")
	var invalid_reasons: Array = invalid_validation.get("reasons", [])
	if bool(invalid_validation.get("valid", false)) or not invalid_reasons.has("deck.reason.duplicate") or not invalid_reasons.has("deck.reason.high_rare") or not invalid_reasons.has("deck.reason.strong_interference"):
		push_error("Smoke test failed: deck validation reasons invalid")
		quit(1)
		return true
	if not deck_builder.save_working_deck("Smoke Practice", true):
		push_error("Smoke test failed: deck save failed")
		quit(1)
		return true
	var active_snapshot: Dictionary = deck_builder.active_deck_snapshot()
	if String(active_snapshot.get("deck_id", "")).is_empty() or int(active_snapshot.get("card_ids", []).size()) != 20:
		push_error("Smoke test failed: active deck snapshot invalid")
		quit(1)
		return true
	var deck_rows: Array[Dictionary] = main_node.call("_deck_builder_rows", "all", "self", 16)
	if deck_rows.is_empty() or String(deck_rows[0].get("type", "")) != "self":
		push_error("Smoke test failed: deck builder rows from main invalid")
		quit(1)
		return true
	stage = "matchmaking_model"
	if matchmaking_model == null:
		push_error("Smoke test failed: matchmaking model missing")
		quit(1)
		return true
	var session_snapshot: Dictionary = matchmaking_model.session_snapshot()
	if String(session_snapshot.get("login_status", "")) != "signed_in" or String(session_snapshot.get("config_status", "")) != "current":
		push_error("Smoke test failed: matchmaking session/config invalid")
		quit(1)
		return true
	var match_rows: Array[Dictionary] = main_node.call("_matchmaking_rows")
	if not _rows_have_ids(match_rows, ["login_session", "server_status", "config_version", "profile", "active_deck", "matchmaking_quick", "matchmaking_ranked", "matchmaking_pvp", "matchmaking_boss", "matchmaking_room", "selected_mode", "network_quality", "queue_status", "queue_wait", "ready", "reconnect_status", "cancel"]):
		push_error("Smoke test failed: matchmaking rows incomplete")
		quit(1)
		return true
	if not _validate_row_label_keys(match_rows, localization):
		quit(1)
		return true
	var mode_rows: Array[Dictionary] = main_node.call("_mode_rows")
	if mode_rows.size() < 5 or not _rows_have_ids(mode_rows, ["certification", "pvp_duel", "battle_royale", "world_boss", "instance_boss"]) or not _rows_have_key(mode_rows, "mode_ruleset_version"):
		push_error("Smoke test failed: matchmaking mode rows invalid")
		quit(1)
		return true
	var pvp_duel_config: Dictionary = _find_row_by_id(mode_rows, "pvp_duel")
	if int(pvp_duel_config.get("min_players", 0)) != 2 or int(pvp_duel_config.get("max_players", 0)) != 2 or String(pvp_duel_config.get("mode_category", "")) != "pvp" or String(pvp_duel_config.get("matchmaking_kind", "")) != "quick_queue":
		push_error("Smoke test failed: PvP duel mode metadata invalid")
		quit(1)
		return true
	var battle_royale_config: Dictionary = _find_row_by_id(mode_rows, "battle_royale")
	if int(battle_royale_config.get("min_players", 0)) != 5 or int(battle_royale_config.get("max_players", 0)) != 10:
		push_error("Smoke test failed: battle royale player requirements invalid")
		quit(1)
		return true
	if game_mode_model.configure_boss_party("world_boss", ["p1", "p2", "p3"]):
		push_error("Smoke test failed: undersized world boss party accepted")
		quit(1)
		return true
	if String(game_mode_model.last_error_code) != "boss_party_size":
		push_error("Smoke test failed: undersized world boss party error invalid")
		quit(1)
		return true
	if not game_mode_model.configure_boss_party("world_boss", ["p1", "p2", "p3", "p4"]):
		push_error("Smoke test failed: world boss four-player party rejected")
		quit(1)
		return true
	var world_formation: Dictionary = game_mode_model.validate_boss_formation("world_boss")
	if not bool(world_formation.get("ok", false)) or int(world_formation.get("player_count", 0)) != 4 or String(world_formation.get("aim_policy", "")) != "toward_center" or bool(world_formation.get("client_result_authoritative", true)):
		push_error("Smoke test failed: world boss formation invalid %s" % [world_formation])
		quit(1)
		return true
	if not _validate_boss_formation_contract(world_formation.get("formation_contract", {}), "world_boss", 4):
		quit(1)
		return true
	var world_angles: Array = world_formation.get("slot_angles_degrees", [])
	if world_angles.size() != 4 or absf(float(world_angles[0]) + 90.0) > 0.01 or absf(float(world_angles[1])) > 0.01 or absf(float(world_angles[2]) - 90.0) > 0.01 or absf(absf(float(world_angles[3])) - 180.0) > 0.01:
		push_error("Smoke test failed: world boss formation angles invalid %s" % [world_angles])
		quit(1)
		return true
	if not game_mode_model.configure_boss_party("instance_boss", ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]):
		push_error("Smoke test failed: instance boss eight-player party rejected")
		quit(1)
		return true
	var instance_formation: Dictionary = game_mode_model.validate_boss_formation("instance_boss")
	if not bool(instance_formation.get("ok", false)) or int(instance_formation.get("player_count", 0)) != 8 or String(instance_formation.get("friendly_fire", "")) != "disabled":
		push_error("Smoke test failed: instance boss formation invalid %s" % [instance_formation])
		quit(1)
		return true
	if not _validate_boss_formation_contract(instance_formation.get("formation_contract", {}), "instance_boss", 8):
		quit(1)
		return true
	var game_mode_state_rows: Array[Dictionary] = game_mode_model.mode_rows()
	if not _rows_have_ids(game_mode_state_rows, ["world_boss_hp", "world_boss_rules", "world_boss_party", "world_boss_formation", "world_boss_display", "world_boss_playfield", "world_boss_hud", "world_boss_practice_preview", "world_boss_transfer", "world_boss_result", "instance_boss_hp", "instance_boss_rules", "instance_boss_party", "instance_boss_formation", "instance_boss_display", "instance_boss_playfield", "instance_boss_hud", "instance_boss_practice_preview", "instance_boss_transfer", "instance_boss_result"]):
		push_error("Smoke test failed: boss mode state rows incomplete")
		quit(1)
		return true
	var world_hp_row: Dictionary = _find_row_by_id(game_mode_state_rows, "world_boss_hp")
	var world_rules_row: Dictionary = _find_row_by_id(game_mode_state_rows, "world_boss_rules")
	var instance_hp_row: Dictionary = _find_row_by_id(game_mode_state_rows, "instance_boss_hp")
	var instance_rules_row: Dictionary = _find_row_by_id(game_mode_state_rows, "instance_boss_rules")
	var world_formation_row: Dictionary = _find_row_by_id(game_mode_state_rows, "world_boss_formation")
	var instance_formation_row: Dictionary = _find_row_by_id(game_mode_state_rows, "instance_boss_formation")
	var world_display_row: Dictionary = _find_row_by_id(game_mode_state_rows, "world_boss_display")
	var instance_display_row: Dictionary = _find_row_by_id(game_mode_state_rows, "instance_boss_display")
	var world_playfield_row: Dictionary = _find_row_by_id(game_mode_state_rows, "world_boss_playfield")
	var instance_playfield_row: Dictionary = _find_row_by_id(game_mode_state_rows, "instance_boss_playfield")
	var world_hud_row: Dictionary = _find_row_by_id(game_mode_state_rows, "world_boss_hud")
	var instance_hud_row: Dictionary = _find_row_by_id(game_mode_state_rows, "instance_boss_hud")
	var world_practice_preview_row: Dictionary = _find_row_by_id(game_mode_state_rows, "world_boss_practice_preview")
	var instance_practice_preview_row: Dictionary = _find_row_by_id(game_mode_state_rows, "instance_boss_practice_preview")
	if not bool(world_hp_row.get("persistent_hp", false)) or bool(instance_hp_row.get("persistent_hp", true)):
		push_error("Smoke test failed: boss hp persistence flags invalid world=%s instance=%s" % [world_hp_row, instance_hp_row])
		quit(1)
		return true
	if String(world_rules_row.get("friendly_fire", "")) != "disabled" or String(world_rules_row.get("arena_policy", "")) != "fixed_directions" or bool(world_rules_row.get("client_result_authoritative", true)) or String(instance_rules_row.get("rules_source", "")) != "local_default":
		push_error("Smoke test failed: boss rules default rows invalid world=%s instance=%s" % [world_rules_row, instance_rules_row])
		quit(1)
		return true
	if not bool(world_formation_row.get("formation_valid", false)) or bool(world_formation_row.get("client_result_authoritative", true)) or int((world_formation_row.get("items", []) as Array).size()) != 4:
		push_error("Smoke test failed: world boss formation row invalid %s" % [world_formation_row])
		quit(1)
		return true
	if not _validate_boss_formation_contract(world_formation_row.get("formation_contract", {}), "world_boss", 4):
		quit(1)
		return true
	if not bool(instance_formation_row.get("formation_valid", false)) or int((instance_formation_row.get("items", []) as Array).size()) != 8:
		push_error("Smoke test failed: instance boss formation row invalid %s" % [instance_formation_row])
		quit(1)
		return true
	if not _validate_boss_formation_contract(instance_formation_row.get("formation_contract", {}), "instance_boss", 8):
		quit(1)
		return true
	if not _validate_boss_display_contract_row(world_display_row, "world_boss", 4, 1.0, true):
		quit(1)
		return true
	if not _validate_boss_display_contract_row(instance_display_row, "instance_boss", 8, 1.0, false):
		quit(1)
		return true
	if not _validate_boss_playfield_projection(world_playfield_row, "world_boss", 4, 1.0):
		quit(1)
		return true
	if not _validate_boss_playfield_projection(instance_playfield_row, "instance_boss", 8, 1.0):
		quit(1)
		return true
	if not _validate_boss_hud_projection(world_hud_row, "world_boss", 4, 1.0):
		quit(1)
		return true
	if not _validate_boss_hud_projection(instance_hud_row, "instance_boss", 8, 1.0):
		quit(1)
		return true
	if not _validate_boss_practice_preview_card_row(world_practice_preview_row, "world_boss"):
		quit(1)
		return true
	if not _validate_boss_practice_preview_card_row(instance_practice_preview_row, "instance_boss"):
		quit(1)
		return true
	if not _validate_row_label_keys(mode_rows, localization):
		quit(1)
		return true
	main_node.call("_set_network_quality", 40, 0.0, 4)
	var join_result: Dictionary = main_node.call("_join_match_queue", "certification")
	if not bool(join_result.get("ok", false)) or String(join_result.get("status", "")) != "queued" or String(join_result.get("active_deck_id", "")).is_empty():
		push_error("Smoke test failed: matchmaking queue join invalid")
		quit(1)
		return true
	var found_result: Dictionary = main_node.call("_simulate_match_found")
	if not bool(found_result.get("ok", false)) or String(found_result.get("status", "")) != "found" or String(found_result.get("match_id", "")).is_empty():
		push_error("Smoke test failed: matchmaking found state invalid")
		quit(1)
		return true
	if not main_node.call("_ready_match") or String(matchmaking_model.queue_status) != "ready":
		push_error("Smoke test failed: matchmaking ready state invalid")
		quit(1)
		return true
	stage = "gensoulkyo_api_model"
	if gensoulkyo_api_model == null:
		push_error("Smoke test failed: Gensoulkyo API model missing")
		quit(1)
		return true
	gensoulkyo_api_model.configure("http://127.0.0.1:7350")
	var login_request: Dictionary = gensoulkyo_api_model.anonymous_login_request("smoke-device", "Smoke Player")
	if String(login_request.get("method", "")) != "POST" or not String(login_request.get("url", "")).ends_with("/v1/auth/anonymous") or bool(login_request.get("authenticated", true)) or not (login_request.get("business_envelope", {}) as Dictionary).is_empty():
		push_error("Smoke test failed: Gensoulkyo login request invalid")
		quit(1)
		return true
	var login_apply: Dictionary = gensoulkyo_api_model.apply_login_response({
		"user_id": "server-user-smoke",
		"session_token": "server-session-smoke",
		"display_name": "Smoke Player",
	}, matchmaking_model)
	if not bool(login_apply.get("ok", false)) or String(matchmaking_model.account_id) != "server-user-smoke" or String(matchmaking_model.server_status) != "gensoulkyo_http":
		push_error("Smoke test failed: Gensoulkyo login response did not apply")
		quit(1)
		return true
	var bootstrap_request: Dictionary = gensoulkyo_api_model.bootstrap_request()
	var bootstrap_headers: Array = bootstrap_request.get("headers", [])
	var bootstrap_envelope: Dictionary = bootstrap_request.get("business_envelope", {})
	if String(bootstrap_request.get("method", "")) != "GET" or not bootstrap_headers.has("Authorization: Bearer server-session-smoke") or int(bootstrap_envelope.get("seq", 0)) != 1 or String(bootstrap_envelope.get("op_code", "")) != "bootstrap" or not bootstrap_headers.has("X-PhK-Business-Seq: 1") or not bootstrap_headers.has("X-PhK-Business-Timestamp-Ms: %d" % int(bootstrap_envelope.get("timestamp_ms", 0))) or not String(bootstrap_envelope.get("ciphertext_mode", "")).contains("http_fallback"):
		push_error("Smoke test failed: Gensoulkyo bootstrap auth request invalid")
		quit(1)
		return true
	var bootstrap_envelope_check: Dictionary = gensoulkyo_api_model.validate_business_envelope(bootstrap_envelope, int(bootstrap_envelope.get("timestamp_ms", 0)), true)
	if not bool(bootstrap_envelope_check.get("ok", false)) or String(gensoulkyo_api_model.last_business_envelope_status) != "validated_scaffold":
		push_error("Smoke test failed: business envelope bootstrap validation invalid %s" % [bootstrap_envelope_check])
		quit(1)
		return true
	var server_deck_snapshot: Dictionary = deck_builder.active_deck_snapshot()
	var server_inventory_items: Array[Dictionary] = []
	for card_id in server_deck_snapshot.get("card_ids", []):
		if _find_inventory_item(server_inventory_items, String(card_id)).is_empty():
			server_inventory_items.append({"card_id": String(card_id), "copies": 2, "level": 1, "first_obtained_at": "2026-01-01T00:00:00Z"})
	var bootstrap_apply: Dictionary = gensoulkyo_api_model.apply_bootstrap_response({
		"user_id": "server-user-smoke",
		"session_token": "server-session-smoke",
		"display_name": "Smoke Player",
		"server_version": "0.1.0",
		"ruleset_version": "ruleset-local-s0",
		"wallet": {"points": 5, "card_dust": 2, "chest_keys": 1},
		"inventory": {"ok": true, "user_id": "server-user-smoke", "ruleset_version": "ruleset-local-s0", "items": server_inventory_items, "server_authoritative": true},
		"decks": {"ok": true, "user_id": "server-user-smoke", "active_deck_id": String(server_deck_snapshot.get("deck_id", "")), "ruleset_version": "ruleset-local-s0", "decks": [server_deck_snapshot.merged({"active": true}, true)], "server_authoritative": true},
		"chests": {
			"ok": true,
			"user_id": "server-user-smoke",
			"ruleset_version": "ruleset-local-s0",
			"wallet": {"points": 5, "card_dust": 2, "chest_keys": 1},
			"owned_chests": {"local_basic": 1},
			"pools": [{
				"pool_id": "local_basic",
				"season_id": "local_s0",
				"name_key": "screen.chest.local_basic",
				"cost": {"chest_keys": 1},
				"weights": {"common": 70, "uncommon": 20, "rare": 8, "epic": 2},
				"pity": {"rare_every": 10, "epic_every": 60, "inherit": false},
				"enabled": true,
			}],
			"pity_counters": {"local_basic": {"rare_counter": 0, "epic_counter": 0}},
			"opening_log": [],
			"last_results": [],
			"server_authoritative": true,
		},
		"modes": [
			{"mode_id": "certification", "min_players": 2, "max_players": 2, "mode_ruleset_version": "cert-s0", "reward_table_id": "cert_s0_rewards"},
			{"mode_id": "battle_royale", "min_players": 5, "max_players": 10, "mode_ruleset_version": "br-s0", "reward_table_id": "br_s0_rewards"},
		],
		"certification": {
			"ok": true,
			"user_id": "server-user-smoke",
			"rating_code": "copper",
			"season_id": "local_s0",
			"rank_score": 1255,
			"rank_score_floor": 1000,
			"challenge_stage_id": "starlit_lanes",
			"percentile": 0.34,
			"top_30_qualified": false,
			"next_certification_unlocked": false,
			"last_rank_score_delta": 0,
			"server_authoritative": true,
			"client_result_authoritative": false,
		},
	}, matchmaking_model, deck_builder, chest_system, game_mode_model)
	if not bool(bootstrap_apply.get("ok", false)) or int(matchmaking_model.wallet.get("points", 0)) != 5 or String(matchmaking_model.mode_config("certification").get("mode_ruleset_version", "")) != "cert-s0" or int(gensoulkyo_api_model.last_inventory_count) <= 0 or String(matchmaking_model.active_deck_id).is_empty():
		push_error("Smoke test failed: Gensoulkyo bootstrap response did not apply")
		quit(1)
		return true
	if String(gensoulkyo_api_model.last_certification_rating) != "copper" or int(game_mode_model.certification_state.get("rank_score", 0)) != 1255:
		push_error("Smoke test failed: Gensoulkyo certification bootstrap did not apply")
		quit(1)
		return true
	if int(gensoulkyo_api_model.last_chest_pool_count) <= 0 or int(chest_system.owned_chests.get("local_basic", 0)) != 1:
		push_error("Smoke test failed: Gensoulkyo bootstrap chest projection did not apply")
		quit(1)
		return true
	var inventory_request: Dictionary = gensoulkyo_api_model.inventory_request()
	var inventory_headers: Array = inventory_request.get("headers", [])
	var inventory_envelope: Dictionary = inventory_request.get("business_envelope", {})
	if String(inventory_request.get("method", "")) != "GET" or not String(inventory_request.get("url", "")).ends_with("/v1/inventory") or int(inventory_envelope.get("seq", 0)) <= int(bootstrap_envelope.get("seq", 0)) or String(inventory_envelope.get("nonce", "")) == String(bootstrap_envelope.get("nonce", "")) or String(inventory_envelope.get("auth_tag", "")).length() != 64 or not inventory_headers.has("X-PhK-Business-Timestamp-Ms: %d" % int(inventory_envelope.get("timestamp_ms", 0))):
		push_error("Smoke test failed: Gensoulkyo inventory request invalid")
		quit(1)
		return true
	var inventory_envelope_check: Dictionary = gensoulkyo_api_model.validate_business_envelope(inventory_envelope, int(inventory_envelope.get("timestamp_ms", 0)), true)
	if not bool(inventory_envelope_check.get("ok", false)) or int(gensoulkyo_api_model.last_verified_business_envelope_seq) != int(inventory_envelope.get("seq", 0)):
		push_error("Smoke test failed: business envelope inventory validation invalid %s" % [inventory_envelope_check])
		quit(1)
		return true
	var replay_envelope_check: Dictionary = gensoulkyo_api_model.validate_business_envelope(inventory_envelope, int(inventory_envelope.get("timestamp_ms", 0)), true)
	if bool(replay_envelope_check.get("ok", false)) or String(replay_envelope_check.get("reason", "")) != "seq_replay":
		push_error("Smoke test failed: business envelope replay check invalid %s" % [replay_envelope_check])
		quit(1)
		return true
	var stale_envelope := inventory_envelope.duplicate(true)
	stale_envelope["seq"] = int(inventory_envelope.get("seq", 0)) + 100
	stale_envelope["nonce"] = "%s-stale" % String(inventory_envelope.get("nonce", ""))
	stale_envelope["timestamp_ms"] = int(inventory_envelope.get("timestamp_ms", 0)) - 600000
	var stale_envelope_check: Dictionary = gensoulkyo_api_model.validate_business_envelope(stale_envelope, int(inventory_envelope.get("timestamp_ms", 0)), false)
	if bool(stale_envelope_check.get("ok", false)) or String(stale_envelope_check.get("reason", "")) != "timestamp_stale":
		push_error("Smoke test failed: business envelope stale timestamp check invalid %s" % [stale_envelope_check])
		quit(1)
		return true
	var inventory_apply: Dictionary = gensoulkyo_api_model.apply_inventory_response({"ok": true, "user_id": "server-user-smoke", "items": server_inventory_items, "server_authoritative": true}, deck_builder)
	if not bool(inventory_apply.get("ok", false)) or int(inventory_apply.get("item_count", 0)) <= 0:
		push_error("Smoke test failed: Gensoulkyo inventory response did not apply")
		quit(1)
		return true
	var save_deck_request: Dictionary = gensoulkyo_api_model.save_deck_request(server_deck_snapshot, true)
	if String(save_deck_request.get("method", "")) != "POST" or not String(save_deck_request.get("url", "")).ends_with("/v1/decks/save") or int((save_deck_request.get("body", {}) as Dictionary).get("card_ids", []).size()) != 20:
		push_error("Smoke test failed: Gensoulkyo deck save request invalid")
		quit(1)
		return true
	var save_deck_apply: Dictionary = gensoulkyo_api_model.apply_deck_save_response({"ok": true, "user_id": "server-user-smoke", "active_deck_id": String(server_deck_snapshot.get("deck_id", "")), "deck": server_deck_snapshot.merged({"active": true}, true), "server_authoritative": true}, deck_builder, matchmaking_model)
	if not bool(save_deck_apply.get("ok", false)) or String(matchmaking_model.active_deck_id).is_empty() or String(deck_builder.last_save_status) != "server_saved":
		push_error("Smoke test failed: Gensoulkyo deck save response did not apply")
		quit(1)
		return true
	var decks_request: Dictionary = gensoulkyo_api_model.decks_request()
	if String(decks_request.get("method", "")) != "GET" or not String(decks_request.get("url", "")).ends_with("/v1/decks"):
		push_error("Smoke test failed: Gensoulkyo decks request invalid")
		quit(1)
		return true
	var decks_apply: Dictionary = gensoulkyo_api_model.apply_decks_response({"ok": true, "user_id": "server-user-smoke", "active_deck_id": String(server_deck_snapshot.get("deck_id", "")), "decks": [server_deck_snapshot.merged({"active": true}, true)], "server_authoritative": true}, deck_builder, matchmaking_model)
	if not bool(decks_apply.get("ok", false)) or int(decks_apply.get("deck_count", 0)) <= 0:
		push_error("Smoke test failed: Gensoulkyo decks response did not apply")
		quit(1)
		return true
	var chests_request: Dictionary = gensoulkyo_api_model.chests_request()
	if String(chests_request.get("method", "")) != "GET" or not String(chests_request.get("url", "")).ends_with("/v1/chests"):
		push_error("Smoke test failed: Gensoulkyo chests request invalid")
		quit(1)
		return true
	var chests_apply: Dictionary = gensoulkyo_api_model.apply_chests_response({
		"ok": true,
		"user_id": "server-user-smoke",
		"wallet": {"points": 5, "card_dust": 2, "chest_keys": 1},
		"owned_chests": {"local_basic": 1},
		"pools": [{
			"pool_id": "local_basic",
			"season_id": "local_s0",
			"name_key": "screen.chest.local_basic",
			"cost": {"chest_keys": 1},
			"weights": {"common": 70, "uncommon": 20, "rare": 8, "epic": 2},
			"pity": {"rare_every": 10, "epic_every": 60, "inherit": false},
			"enabled": true,
		}],
		"pity_counters": {"local_basic": {"rare_counter": 1, "epic_counter": 1}},
		"opening_log": [],
		"last_results": [],
		"server_authoritative": true,
	}, chest_system)
	if not bool(chests_apply.get("ok", false)) or int(chests_apply.get("pool_count", 0)) <= 0 or int(chest_system.pity_summary("local_basic").get("rare_counter", 0)) != 1:
		push_error("Smoke test failed: Gensoulkyo chests response did not apply")
		quit(1)
		return true
	var open_chest_request: Dictionary = gensoulkyo_api_model.open_chest_request("local_basic", 1)
	var open_chest_body: Dictionary = open_chest_request.get("body", {})
	if String(open_chest_request.get("method", "")) != "POST" or not String(open_chest_request.get("url", "")).ends_with("/v1/chests/open") or bool(open_chest_body.get("client_result_authoritative", true)):
		push_error("Smoke test failed: Gensoulkyo open chest request invalid")
		quit(1)
		return true
	var server_chest_result := {"id": "server-open-1", "card_id": "focus_lens", "name_key": "card.focus_lens.name", "rarity": "common", "dust": 5, "accepted": 0, "overflow": 1}
	var chest_open_apply: Dictionary = gensoulkyo_api_model.apply_chest_open_response({
		"ok": true,
		"user_id": "server-user-smoke",
		"pool_id": "local_basic",
		"count": 1,
		"wallet": {"points": 5, "card_dust": 7, "chest_keys": 0},
		"owned_chests": {"local_basic": 0},
		"inventory": {"ok": true, "user_id": "server-user-smoke", "items": server_inventory_items, "server_authoritative": true},
		"pity_counters": {"local_basic": {"rare_counter": 2, "epic_counter": 2}},
		"results": [server_chest_result],
		"audit": {"opening_id": "open-smoke", "pool_id": "local_basic", "count": 1, "cost": {"chest_keys": 1}, "server_seed": "seed-smoke", "results": [server_chest_result], "opened_at": "2026-06-26T00:00:00Z"},
		"server_authoritative": true,
		"client_result_authoritative": false,
	}, chest_system, deck_builder, matchmaking_model)
	if not bool(chest_open_apply.get("ok", false)) or int(chest_system.wallet.get("chest_keys", 0)) != 0 or chest_system.result_rows().is_empty() or chest_system.audit_rows(1).is_empty():
		push_error("Smoke test failed: Gensoulkyo open chest response did not apply")
		quit(1)
		return true
	var upgrade_request: Dictionary = gensoulkyo_api_model.upgrade_card_request("focus_lens")
	var upgrade_body: Dictionary = upgrade_request.get("body", {})
	if String(upgrade_request.get("method", "")) != "POST" or not String(upgrade_request.get("url", "")).ends_with("/v1/cards/upgrade") or bool(upgrade_body.get("client_result_authoritative", true)) or String(upgrade_body.get("card_id", "")) != "focus_lens":
		push_error("Smoke test failed: Gensoulkyo card upgrade request invalid")
		quit(1)
		return true
	var upgraded_inventory_items: Array[Dictionary] = []
	for item in server_inventory_items:
		var upgraded_item: Dictionary = item.duplicate(true)
		if String(upgraded_item.get("card_id", "")) == "focus_lens":
			upgraded_item["level"] = 2
		upgraded_inventory_items.append(upgraded_item)
	var card_upgrade_apply: Dictionary = gensoulkyo_api_model.apply_card_upgrade_response({
		"ok": true,
		"user_id": "server-user-smoke",
		"card_id": "focus_lens",
		"rarity": "common",
		"old_level": 1,
		"new_level": 2,
		"max_level": 5,
		"cost": {"card_dust": 5},
		"wallet": {"points": 5, "card_dust": 2, "chest_keys": 0},
		"inventory": {"ok": true, "user_id": "server-user-smoke", "items": upgraded_inventory_items, "server_authoritative": true},
		"server_authoritative": true,
		"client_result_authoritative": false,
	}, deck_builder, matchmaking_model)
	if not bool(card_upgrade_apply.get("ok", false)) or int(deck_builder.card_levels.get("focus_lens", 0)) != 2 or int(matchmaking_model.wallet.get("card_dust", -1)) != 2:
		push_error("Smoke test failed: Gensoulkyo card upgrade response did not apply")
		quit(1)
		return true
	var heartbeat_request: Dictionary = gensoulkyo_api_model.heartbeat_request("", "", 5, 0)
	var heartbeat_body: Dictionary = heartbeat_request.get("body", {})
	if String(heartbeat_request.get("method", "")) != "POST" or not String(heartbeat_request.get("url", "")).ends_with("/v1/presence/heartbeat") or int(heartbeat_body.get("client_tick", -1)) != 5:
		push_error("Smoke test failed: Gensoulkyo heartbeat request invalid")
		quit(1)
		return true
	var join_request: Dictionary = gensoulkyo_api_model.join_queue_request("certification", server_deck_snapshot, {"stage_id": "lunar_maze", "character_id": "spell_power"})
	var join_body: Dictionary = join_request.get("body", {})
	var join_deck: Dictionary = join_body.get("deck_snapshot", {})
	var join_params: Dictionary = join_body.get("mode_params", {})
	if String(join_request.get("method", "")) != "POST" or String(join_body.get("mode_id", "")) != "certification" or int(join_deck.get("card_ids", []).size()) != 20 or String(join_deck.get("ruleset_version", "")) != "ruleset-local-s0" or String(join_params.get("stage_id", "")) != "lunar_maze" or String(join_params.get("character_id", "")) != "spell_power":
		push_error("Smoke test failed: Gensoulkyo join request invalid")
		quit(1)
		return true
	var main_loadout_params: Dictionary = main_node.call("_gensoulkyo_loadout_mode_params", {})
	if String(main_loadout_params.get("stage_id", "")) != String(stage_select_model.selected_stage_id) or String(main_loadout_params.get("character_id", "")) != String(character_model.selected_character_id) or String(main_loadout_params.get("rating_code", "")) != String(game_mode_model.certification_state.get("rating_code", "")):
		push_error("Smoke test failed: Gensoulkyo loadout params invalid")
		quit(1)
		return true
	var battle_allocation := _smoke_battle_allocation("match-server-smoke")
	var battle_ticket := _smoke_battle_ticket("match-server-smoke", "server-user-smoke", "p-smoke")
	var queue_apply: Dictionary = gensoulkyo_api_model.apply_queue_response({
		"ok": true,
		"queue_status": "found",
		"ticket_id": "ticket-smoke",
		"match_id": "match-server-smoke",
		"mode_id": "certification",
		"loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true},
		"required_players": 2,
		"current_players": 2,
		"battle_allocation": battle_allocation,
		"battle_ticket": battle_ticket,
	}, matchmaking_model)
	if not bool(queue_apply.get("ok", false)) or String(matchmaking_model.server_ticket_id) != "ticket-smoke" or String(matchmaking_model.active_match_id) != "match-server-smoke" or String(matchmaking_model.queue_status) != "found" or String(matchmaking_model.battle_server_id) != "battle-smoke" or String(gensoulkyo_api_model.battle_ticket_status) != "signed":
		push_error("Smoke test failed: Gensoulkyo queue response did not apply")
		quit(1)
		return true
	var battle_allocation_request: Dictionary = gensoulkyo_api_model.battle_allocation_request("match-server-smoke")
	if String(battle_allocation_request.get("method", "")) != "GET" or not String(battle_allocation_request.get("url", "")).ends_with("/v1/matches/match-server-smoke/battle-allocation"):
		push_error("Smoke test failed: Gensoulkyo battle allocation request invalid")
		quit(1)
		return true
	var battle_allocation_apply: Dictionary = gensoulkyo_api_model.apply_battle_allocation_response(battle_allocation, matchmaking_model, network_match_model)
	if not bool(battle_allocation_apply.get("ok", false)) or String(network_match_model.battle_endpoint) != "127.0.0.1:7901" or String(network_match_model.battle_player_id) != "p-smoke":
		push_error("Smoke test failed: Gensoulkyo battle allocation response did not apply")
		quit(1)
		return true
	var battle_ticket_request: Dictionary = gensoulkyo_api_model.battle_ticket_request("match-server-smoke")
	if String(battle_ticket_request.get("method", "")) != "POST" or not String(battle_ticket_request.get("url", "")).ends_with("/v1/matches/match-server-smoke/battle-ticket"):
		push_error("Smoke test failed: Gensoulkyo battle ticket request invalid")
		quit(1)
		return true
	var battle_ticket_apply: Dictionary = gensoulkyo_api_model.apply_battle_ticket_response(battle_ticket, matchmaking_model, network_match_model)
	if not bool(battle_ticket_apply.get("ok", false)) or String(network_match_model.battle_ticket_status) != "signed" or String(matchmaking_model.battle_ticket_id) != "battle-ticket-smoke":
		push_error("Smoke test failed: Gensoulkyo battle ticket response did not apply")
		quit(1)
		return true
	var battle_handshake: Dictionary = main_node.call("_battle_network_prepare_handshake", "00112233445566778899aabb")
	if not bool(battle_handshake.get("ok", false)) or String(battle_handshake.get("connection_id", "")) != "kcp-match-server-p-smoke" or String(battle_network_client_model.handshake_state) != "handshake_ready_scaffold" or String(battle_network_client_model.codec_state) != "descriptor_ready":
		push_error("Smoke test failed: battle network handshake scaffold invalid")
		quit(1)
		return true
	var battle_connected: Dictionary = main_node.call("_battle_network_mark_connected", "ffeeddccbbaa998877665544")
	if not bool(battle_connected.get("ok", false)) or String(battle_network_client_model.connection_state) != "connected_scaffold" or String(battle_network_client_model.transport_state) != "kcp_ready_scaffold":
		push_error("Smoke test failed: battle network connected scaffold invalid")
		quit(1)
		return true
	var battle_packet_header: Dictionary = main_node.call("_battle_network_build_packet_header", "input", 20, 0)
	if not bool(battle_packet_header.get("ok", false)) or int(battle_packet_header.get("seq", 0)) != 1 or int(battle_packet_header.get("ack", -1)) != 0 or String(battle_packet_header.get("payload_type", "")) != "input" or int(battle_packet_header.get("payload_type_number", 0)) != 3 or String(battle_packet_header.get("payload_type_enum", "")) != "BATTLE_PAYLOAD_TYPE_INPUT" or String(battle_packet_header.get("transport", "")) != "KCP/UDP" or String(battle_packet_header.get("codec", "")) != "protobuf phk.v1" or bool(battle_packet_header.get("encrypted", true)):
		push_error("Smoke test failed: battle network packet header invalid")
		quit(1)
		return true
	var battle_mode_action_header: Dictionary = main_node.call("_battle_network_build_packet_header", "mode_action", 21, 1)
	if not bool(battle_mode_action_header.get("ok", false)) or int(battle_mode_action_header.get("seq", 0)) != 2 or int(battle_mode_action_header.get("ack", -1)) != 1 or String(battle_mode_action_header.get("payload_type", "")) != "mode_action" or int(battle_mode_action_header.get("payload_type_number", 0)) != 9 or String(battle_mode_action_header.get("payload_type_enum", "")) != "BATTLE_PAYLOAD_TYPE_MODE_ACTION" or bool(battle_mode_action_header.get("server_authoritative", true)):
		push_error("Smoke test failed: battle network mode-action packet header invalid")
		quit(1)
		return true
	var battle_mode_action_payload: Dictionary = main_node.call("_battle_network_build_mode_action", "select_round_card", {"card_id": "focus_lens", "round_index": 0}, 22, "action-smoke-transport", 1)
	var battle_mode_action_payload_json: Variant = JSON.parse_string(String(battle_mode_action_payload.get("payload_json", "")))
	if not bool(battle_mode_action_payload.get("ok", false)) or String(battle_mode_action_payload.get("match_id", "")) != "match-server-smoke" or String(battle_mode_action_payload.get("player_id", "")) != "p-smoke" or String(battle_mode_action_payload.get("action_id", "")) != "action-smoke-transport" or String(battle_mode_action_payload.get("action_type", "")) != "select_round_card" or int(battle_mode_action_payload.get("tick", 0)) != 22 or int(battle_mode_action_payload.get("seq", 0)) != 3 or bool(battle_mode_action_payload.get("client_result_authoritative", true)) or typeof(battle_mode_action_payload_json) != TYPE_DICTIONARY or String((battle_mode_action_payload_json as Dictionary).get("card_id", "")) != "focus_lens" or int((battle_mode_action_payload_json as Dictionary).get("round_index", -1)) != 0:
		push_error("Smoke test failed: battle network mode-action payload builder invalid %s" % [battle_mode_action_payload])
		quit(1)
		return true
	var invalid_battle_packet_header: Dictionary = main_node.call("_battle_network_build_packet_header", "client_result", 21, 0)
	if bool(invalid_battle_packet_header.get("ok", false)) or String(invalid_battle_packet_header.get("reason", "")) != "payload_type_missing":
		push_error("Smoke test failed: battle network accepted unknown payload type %s" % [invalid_battle_packet_header])
		quit(1)
		return true
	var battle_packet_ack: Dictionary = main_node.call("_battle_network_receive_packet_header", {
		"match_id": "match-server-smoke",
		"player_id": "p-smoke",
		"seq": 7,
	})
	if not bool(battle_packet_ack.get("ok", false)) or int(battle_packet_ack.get("ack", 0)) != 7 or int(battle_network_client_model.last_ack) != 7:
		push_error("Smoke test failed: battle network receive ack invalid")
		quit(1)
		return true
	if not _rows_have_ids(main_node.call("_battle_network_rows"), ["battle_client_transport", "battle_client_handshake", "battle_client_codec", "battle_client_packet"]):
		push_error("Smoke test failed: battle network client rows missing")
		quit(1)
		return true
	var battle_result_request: Dictionary = gensoulkyo_api_model.battle_result_submit_request({
		"result": {
			"match_id": "match-server-smoke",
			"mode_id": "certification",
			"result_hash": "sha256:abcdef",
			"replay_id": "battle-replay-smoke",
		},
		"key_id": "battle-local-dev",
		"signature_hex": "abcd",
	})
	var battle_result_body: Dictionary = battle_result_request.get("body", {})
	if String(battle_result_request.get("method", "")) != "POST" or String(battle_result_request.get("endpoint", "")) != "battle_result_submit" or not String(battle_result_request.get("url", "")).ends_with("/v1/battle/results/submit") or typeof(battle_result_body.get("signed_result", {})) != TYPE_DICTIONARY:
		push_error("Smoke test failed: Gensoulkyo battle result submit request invalid")
		quit(1)
		return true
	var battle_result_apply: Dictionary = gensoulkyo_api_model.apply_battle_result_submit_response({
		"ok": true,
		"version": {"protocol_version": 1, "battle_api_version": "0.1.0-draft", "ruleset_version": "ruleset-local-s0"},
		"match_id": "match-server-smoke",
		"settlement_key": "battle-result:match-server-smoke",
		"accepted": true,
		"duplicate": false,
		"server_authoritative": true,
		"server_time": "2026-06-27T12:00:00Z",
		"result_hash": "sha256:abcdef",
		"replay_id": "battle-replay-smoke",
		"key_id": "battle-local-dev",
	}, network_match_model)
	if not bool(battle_result_apply.get("ok", false)) or String(gensoulkyo_api_model.battle_result_status) != "accepted" or String(network_match_model.battle_result_status) != "accepted" or String(network_match_model.battle_result_hash) != "sha256:abcdef" or String(network_match_model.battle_result_replay_id) != "battle-replay-smoke":
		push_error("Smoke test failed: Gensoulkyo battle result submit response did not apply")
		quit(1)
		return true
	if not _rows_have_ids(gensoulkyo_api_model.status_rows(), ["gensoulkyo_battle_result"]) or not _rows_have_ids(network_match_model.status_rows(), ["battle_result"]):
		push_error("Smoke test failed: battle result status rows missing")
		quit(1)
		return true
	var room_request: Dictionary = gensoulkyo_api_model.create_room_request("certification", server_deck_snapshot)
	if String(room_request.get("method", "")) != "POST" or not String(room_request.get("url", "")).ends_with("/v1/rooms/create"):
		push_error("Smoke test failed: Gensoulkyo room create request invalid")
		quit(1)
		return true
	var room_join_request: Dictionary = gensoulkyo_api_model.join_room_request("RSMOKE", "certification", server_deck_snapshot)
	if String(room_join_request.get("method", "")) != "POST" or not String(room_join_request.get("url", "")).ends_with("/v1/rooms/RSMOKE/join"):
		push_error("Smoke test failed: Gensoulkyo room join request invalid")
		quit(1)
		return true
	var cancel_request: Dictionary = gensoulkyo_api_model.cancel_ticket_request("ticket-room-smoke")
	if String(cancel_request.get("method", "")) != "POST" or not String(cancel_request.get("url", "")).ends_with("/v1/matchmaking/tickets/ticket-room-smoke/cancel"):
		push_error("Smoke test failed: Gensoulkyo cancel ticket request invalid")
		quit(1)
		return true
	var room_apply: Dictionary = gensoulkyo_api_model.apply_queue_response({
		"ok": true,
		"queue_status": "queued",
		"ticket_id": "ticket-room-smoke",
		"mode_id": "certification",
		"room_code": "RSMOKE",
		"room_status": "waiting",
		"required_players": 2,
		"current_players": 1,
	}, matchmaking_model)
	if not bool(room_apply.get("ok", false)) or String(matchmaking_model.room_code) != "RSMOKE" or String(gensoulkyo_api_model.current_room_status) != "waiting":
		push_error("Smoke test failed: Gensoulkyo room response did not apply")
		quit(1)
		return true
	var cancel_apply: Dictionary = gensoulkyo_api_model.apply_queue_response({
		"ok": true,
		"queue_status": "cancelled",
		"ticket_id": "ticket-room-smoke",
		"mode_id": "certification",
		"room_code": "RSMOKE",
		"room_status": "cancelled",
		"required_players": 2,
		"current_players": 0,
	}, matchmaking_model)
	if not bool(cancel_apply.get("ok", false)) or String(matchmaking_model.queue_status) != "cancelled" or String(matchmaking_model.active_match_id) != "" or String(gensoulkyo_api_model.connection_status) != "cancelled":
		push_error("Smoke test failed: Gensoulkyo cancel response did not apply")
		quit(1)
		return true
	var queue_reapply: Dictionary = gensoulkyo_api_model.apply_queue_response({
		"ok": true,
		"queue_status": "found",
		"ticket_id": "ticket-smoke",
		"match_id": "match-server-smoke",
		"mode_id": "certification",
		"required_players": 2,
		"current_players": 2,
	}, matchmaking_model)
	if not bool(queue_reapply.get("ok", false)):
		push_error("Smoke test failed: Gensoulkyo queue reapply invalid")
		quit(1)
		return true
	var queue_heartbeat_apply: Dictionary = gensoulkyo_api_model.apply_heartbeat_response({
		"ok": true,
		"user_id": "server-user-smoke",
		"presence_status": "queue_waiting",
		"session_status": "authenticated",
		"ticket_id": "ticket-smoke",
		"queue_status": "queued",
		"mode_id": "certification",
		"loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true},
		"last_client_tick": 6,
		"last_event_cursor": 0,
		"latest_event_cursor": 0,
		"server_authoritative": true,
	}, matchmaking_model, network_match_model)
	if not bool(queue_heartbeat_apply.get("ok", false)) or String(matchmaking_model.presence_status) != "queue_waiting" or String(gensoulkyo_api_model.last_presence_status) != "queue_waiting":
		push_error("Smoke test failed: Gensoulkyo queue heartbeat response did not apply")
		quit(1)
		return true
	var ready_apply: Dictionary = gensoulkyo_api_model.apply_ready_response({
		"ok": true,
		"match_id": "match-server-smoke",
		"ready_status": "running",
		"ready_count": 2,
		"required_players": 2,
		"match_start": {
			"type": "match_start",
			"match_id": "match-server-smoke",
			"mode_id": "certification",
			"ruleset_version": "ruleset-local-s0",
			"mode_ruleset_version": "cert-s0",
			"server_seed": 20260626,
			"input_delay_ticks": 2,
			"tick_rate": 60,
			"players": [{"user_id": "server-user-smoke", "player_id": "p-smoke", "display_name": "Smoke Player"}],
			"mode_state": {"rating_code": "C", "rank_score_preview": 10, "challenge_progress": 0.1},
			"battle_allocation": battle_allocation,
		},
		"battle_ticket": battle_ticket,
	}, matchmaking_model, network_match_model)
	if not bool(ready_apply.get("ok", false)) or String(network_match_model.authority_state) != "running" or int(network_match_model.server_seed) != 20260626 or String(network_match_model.battle_server_id) != "battle-smoke" or String(network_match_model.battle_ticket_status) != "signed":
		push_error("Smoke test failed: Gensoulkyo ready/match_start response did not apply")
		quit(1)
		return true
	var server_packet: Dictionary = network_match_model.build_input_packet(20, {
		"direction_bits": 4,
		"slow_pressed": true,
		"shoot_pressed": true,
		"bomb_pressed": false,
		"card_slot": -1,
	}, 4)
	var input_request: Dictionary = gensoulkyo_api_model.input_request("match-server-smoke", server_packet)
	var input_body: Dictionary = input_request.get("body", {})
	if String(input_request.get("method", "")) != "POST" or not String(input_request.get("url", "")).ends_with("/v1/matches/match-server-smoke/input") or input_body.has("reward_json"):
		push_error("Smoke test failed: Gensoulkyo input request invalid")
		quit(1)
		return true
	var input_apply: Dictionary = gensoulkyo_api_model.apply_input_response({
		"ok": true,
		"accepted": true,
		"reason": "none",
		"packet": server_packet,
		"snapshot": {
			"match_id": "match-server-smoke",
			"tick": 20,
			"full": false,
			"state_hash": "serverhash",
			"players": [{"user_id": "server-user-smoke", "x": 480.0, "y": 596.0}],
			"bullets_delta": [
				{"op": "spawn", "bullet_id": "server-bullet-1", "pattern_id": "cert_ring", "kind": "ring", "tick": 20, "x": 480.0, "y": 112.0, "vx": 1.0, "vy": 2.0, "radius": 4.5, "damage": 1, "color": "blue"},
			],
			"active_cards": [
				{"activation_id": "server-card-1", "user_id": "server-user-smoke", "card_id": "focus_lens", "slot": 0, "started_tick": 20, "expires_tick": 380, "effect_kind": "self", "cost": 2.0, "damage": 12},
			],
			"score": [{"user_id": "server-user-smoke", "score": 12}],
			"mode_state": {"rating_code": "C", "rank_score_preview": 12, "challenge_progress": 0.12},
			"events": [{"type": "graze", "tick": 20, "user_id": "server-user-smoke", "bullet_id": "server-bullet-1", "value": 1}],
		},
	}, network_match_model, {"tick": 21, "state_hash": "serverhash", "player_pos": {"x": 480.0, "y": 596.0}})
	if not bool(input_apply.get("ok", false)) or int(network_match_model.last_accepted_snapshot_tick) != 20 or int(network_match_model.server_bullets.size()) != 1 or int(network_match_model.server_active_cards.size()) != 1 or int(network_match_model.recent_server_events.size()) != 1:
		push_error("Smoke test failed: Gensoulkyo input response did not apply snapshot")
		quit(1)
		return true
	var disconnect_request: Dictionary = gensoulkyo_api_model.disconnect_request("match-server-smoke")
	if String(disconnect_request.get("method", "")) != "POST" or not String(disconnect_request.get("url", "")).ends_with("/v1/matches/match-server-smoke/disconnect"):
		push_error("Smoke test failed: Gensoulkyo disconnect request invalid")
		quit(1)
		return true
	var disconnect_apply: Dictionary = gensoulkyo_api_model.apply_disconnect_response({
		"ok": true,
		"match_id": "match-server-smoke",
		"user_id": "server-user-smoke",
		"reconnect_status": "disconnected",
		"connected": false,
		"seconds_left": 30,
		"snapshot": {
			"match_id": "match-server-smoke",
			"tick": 20,
			"full": true,
			"state_hash": "disconnecthash",
			"players": [{"user_id": "server-user-smoke", "x": 480.0, "y": 596.0, "connected": false, "reconnect_seconds_left": 30}],
			"bullets_delta": [
				{"op": "sync", "bullet_id": "server-bullet-1", "pattern_id": "cert_ring", "kind": "ring", "tick": 20, "x": 480.0, "y": 112.0, "vx": 1.0, "vy": 2.0, "radius": 4.5, "damage": 1, "color": "blue"},
			],
			"active_cards": [
				{"activation_id": "server-card-1", "user_id": "server-user-smoke", "card_id": "focus_lens", "slot": 0, "started_tick": 20, "expires_tick": 380, "effect_kind": "self", "cost": 2.0, "damage": 12},
			],
			"score": [{"user_id": "server-user-smoke", "score": 12}],
			"mode_state": {"rating_code": "C", "rank_score_preview": 12, "challenge_progress": 0.12},
			"events": [],
		},
	}, network_match_model)
	if not bool(disconnect_apply.get("ok", false)) or String(network_match_model.connection_state) != "disconnected":
		push_error("Smoke test failed: Gensoulkyo disconnect response did not apply")
		quit(1)
		return true
	var reconnect_request: Dictionary = gensoulkyo_api_model.reconnect_request("match-server-smoke")
	if String(reconnect_request.get("method", "")) != "POST" or not String(reconnect_request.get("url", "")).ends_with("/v1/matches/match-server-smoke/reconnect"):
		push_error("Smoke test failed: Gensoulkyo reconnect request invalid")
		quit(1)
		return true
	var reconnect_apply: Dictionary = gensoulkyo_api_model.apply_reconnect_response({
		"ok": true,
		"match_id": "match-server-smoke",
		"user_id": "server-user-smoke",
		"reconnect_status": "restored",
		"connected": true,
		"seconds_left": 18,
		"match_start": {
			"type": "match_start",
			"match_id": "match-server-smoke",
			"mode_id": "certification",
			"ruleset_version": "ruleset-local-s0",
			"mode_ruleset_version": "cert-s0",
			"server_seed": 20260626,
			"input_delay_ticks": 2,
			"tick_rate": 60,
			"players": [{"user_id": "server-user-smoke", "player_id": "p-smoke", "display_name": "Smoke Player"}],
			"mode_state": {"rating_code": "C", "rank_score_preview": 12, "challenge_progress": 0.12},
			"battle_allocation": battle_allocation,
		},
		"battle_ticket": battle_ticket,
		"snapshot": {
			"match_id": "match-server-smoke",
			"tick": 21,
			"full": true,
			"state_hash": "reconnecthash",
			"players": [{"user_id": "server-user-smoke", "x": 480.0, "y": 596.0, "connected": true}],
			"bullets_delta": [
				{"op": "sync", "bullet_id": "server-bullet-1", "pattern_id": "cert_ring", "kind": "ring", "tick": 21, "x": 481.0, "y": 114.0, "vx": 1.0, "vy": 2.0, "radius": 4.5, "damage": 1, "color": "blue"},
			],
			"active_cards": [
				{"activation_id": "server-card-1", "user_id": "server-user-smoke", "card_id": "focus_lens", "slot": 0, "started_tick": 20, "expires_tick": 380, "effect_kind": "self", "cost": 2.0, "damage": 12},
			],
			"score": [{"user_id": "server-user-smoke", "score": 12}],
			"mode_state": {"rating_code": "C", "rank_score_preview": 12, "challenge_progress": 0.12},
			"events": [],
		},
	}, network_match_model, {"tick": 21, "state_hash": "", "player_pos": {"x": 480.0, "y": 596.0}})
	if not bool(reconnect_apply.get("ok", false)) or String(network_match_model.connection_state) != "connected" or String(network_match_model.authority_state) != "running" or bool(network_match_model.full_snapshot_requested) or int(network_match_model.last_accepted_snapshot_tick) != 21:
		push_error("Smoke test failed: Gensoulkyo reconnect response did not restore network model")
		quit(1)
		return true
	var events_request: Dictionary = gensoulkyo_api_model.events_request("match-server-smoke", 0, 8)
	if String(events_request.get("method", "")) != "GET" or not String(events_request.get("url", "")).ends_with("/v1/matches/match-server-smoke/events?after=0&limit=8"):
		push_error("Smoke test failed: Gensoulkyo events request invalid")
		quit(1)
		return true
	var events_apply: Dictionary = gensoulkyo_api_model.apply_events_response({
		"ok": true,
		"match_id": "match-server-smoke",
		"after": 0,
		"cursor": 3,
		"latest_cursor": 3,
		"oldest_cursor": 1,
		"has_more": false,
		"snapshot_tick": 21,
		"events": [
			{"seq": 1, "type": "player_ready", "tick": 0, "user_id": "server-user-smoke"},
			{"seq": 2, "type": "card_accepted", "tick": 20, "user_id": "server-user-smoke", "card_id": "focus_lens", "slot": 0},
			{"seq": 3, "type": "player_reconnected", "tick": 21, "user_id": "server-user-smoke"},
		],
	}, network_match_model)
	if not bool(events_apply.get("ok", false)) or int(network_match_model.event_stream_cursor) != 3 or int(network_match_model.last_event_count) != 3 or int(network_match_model.recent_server_events.size()) < 3:
		push_error("Smoke test failed: Gensoulkyo events response did not apply")
		quit(1)
		return true
	var match_heartbeat_apply: Dictionary = gensoulkyo_api_model.apply_heartbeat_response({
		"ok": true,
		"user_id": "server-user-smoke",
		"presence_status": "in_match",
		"session_status": "authenticated",
		"ticket_id": "ticket-smoke",
		"queue_status": "found",
		"mode_id": "certification",
		"loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true},
		"match_id": "match-server-smoke",
		"match_status": "running",
		"match_tick": 21,
		"last_client_tick": 21,
		"connected": true,
		"ready": true,
		"last_event_cursor": 3,
		"latest_event_cursor": 4,
		"oldest_event_cursor": 1,
		"server_authoritative": true,
	}, matchmaking_model, network_match_model)
	if not bool(match_heartbeat_apply.get("ok", false)) or String(network_match_model.presence_status) != "in_match" or int(network_match_model.presence_match_tick) != 21 or int(network_match_model.event_stream_latest_cursor) != 4:
		push_error("Smoke test failed: Gensoulkyo match heartbeat response did not apply")
		quit(1)
		return true
	var mode_action_request: Dictionary = gensoulkyo_api_model.mode_action_request("match-server-smoke", {
		"mode_id": "battle_royale",
		"action_type": "select_round_card",
		"payload": {"card_id": "focus_lens", "round_index": 0},
		"client_result_authoritative": false,
	})
	var mode_action_body: Dictionary = mode_action_request.get("body", {})
	if String(mode_action_request.get("method", "")) != "POST" or not String(mode_action_request.get("url", "")).ends_with("/v1/matches/match-server-smoke/mode-action") or bool(mode_action_body.get("client_result_authoritative", true)):
		push_error("Smoke test failed: Gensoulkyo mode action request invalid")
		quit(1)
		return true
	var mode_action_apply: Dictionary = gensoulkyo_api_model.apply_mode_action_response({
		"ok": true,
		"accepted": true,
		"reason": "none",
		"match_id": "match-server-smoke",
		"mode_id": "battle_royale",
		"user_id": "server-user-smoke",
		"action_id": "action-smoke-1",
		"action_type": "select_round_card",
		"status": "accepted",
		"payload": {"card_id": "focus_lens", "round_index": 0},
		"mode_state": {
			"round_index": 0,
			"choice_deadline_tick": 1800,
			"candidate_cards": ["focus_lens", "tempo_break", "draw_sigil"],
			"round_selections": {"0:server-user-smoke": {"card_id": "focus_lens"}},
		},
		"event": {"seq": 4, "type": "mode_action_accepted", "tick": 21, "user_id": "server-user-smoke", "action_id": "action-smoke-1", "action_type": "select_round_card", "card_id": "focus_lens", "round_index": 0, "status": "accepted"},
		"server_authoritative": true,
		"client_result_authoritative": false,
	}, network_match_model, game_mode_model)
	if not bool(mode_action_apply.get("ok", false)) or String(game_mode_model.selected_mode_id) != "battle_royale" or int(game_mode_model.battle_royale_state.get("choice_deadline_tick", 0)) != 1800 or int(network_match_model.recent_server_events.size()) < 4:
		push_error("Smoke test failed: Gensoulkyo mode action response did not apply")
		quit(1)
		return true
	results_service_model.reset_local_state()
	var settle_apply: Dictionary = gensoulkyo_api_model.apply_settle_response({
		"type": "match_end",
		"ok": true,
		"duplicate": false,
		"match_id": "match-server-smoke",
		"user_id": "local_user",
		"mode": "certification",
		"stage_id": "lunar_maze",
		"loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true},
		"ruleset_version": "ruleset-local-s0",
		"mode_ruleset_version": "cert-s0",
		"server_seed": 20260626,
		"status": "completed",
		"result": "win",
		"score": 120,
		"graze_count": 4,
		"hit_count": 0,
		"replay_id": "server-replay-smoke",
		"final_result": {"result": "win", "score": 120},
		"reward_json": [{"type": "points", "amount": 12, "source": "server_http"}],
		"task_progress": [{"task_id": "daily_complete_match", "progress": 1, "target": 1, "claimed": false}],
		"event_points": {"local_s0": 1},
		"leaderboard_updates": [{"leaderboard_id": "single_score", "score": 120, "rank": 1, "percentile": 0.1, "season_id": "local_s0"}],
		"mode_result": {"rating_code": "C", "rank_score_after": 1120, "percentile_after": 0.1},
		"server_authoritative": true,
		"client_authored_reward": false,
	}, network_match_model, results_service_model)
	if not bool(settle_apply.get("ok", false)) or int(results_service_model.wallet.get("points", 0)) != 12 or String(network_match_model.replay_metadata.get("replay_id", "")) != "server-replay-smoke":
		push_error("Smoke test failed: Gensoulkyo settlement response did not apply")
		quit(1)
		return true
	if String(network_match_model.replay_metadata.get("stage_id", "")) != "lunar_maze":
		push_error("Smoke test failed: Gensoulkyo settlement loadout did not apply")
		quit(1)
		return true
	var replay_request: Dictionary = gensoulkyo_api_model.replay_request("server-replay-smoke")
	if String(replay_request.get("method", "")) != "GET" or not String(replay_request.get("url", "")).ends_with("/v1/replays/server-replay-smoke"):
		push_error("Smoke test failed: Gensoulkyo replay request invalid")
		quit(1)
		return true
	var replay_apply: Dictionary = gensoulkyo_api_model.apply_replay_response({
		"ok": true,
		"replay_id": "server-replay-smoke",
		"match_id": "match-server-smoke",
		"user_id": "local_user",
		"mode_id": "certification",
		"stage_id": "lunar_maze",
		"loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true},
		"ruleset_version": "ruleset-local-s0",
		"mode_ruleset_version": "cert-s0",
		"server_seed": 20260626,
		"tick_rate": 60,
		"server_authoritative": true,
		"state_hash": "hash-server-replay-smoke",
		"input_count": 3,
		"event_count": 5,
		"events": [{"seq": 5, "type": "match_ended", "tick": 24}],
		"settlement": {"replay_id": "server-replay-smoke", "match_id": "match-server-smoke"},
	}, network_match_model)
	if not bool(replay_apply.get("ok", false)) or not bool(network_match_model.replay_metadata.get("audit_loaded", false)) or String(network_match_model.replay_metadata.get("state_hash", "")) != "hash-server-replay-smoke":
		push_error("Smoke test failed: Gensoulkyo replay response did not apply")
		quit(1)
		return true
	if String(network_match_model.replay_metadata.get("stage_id", "")) != "lunar_maze" or String(network_match_model.server_loadout.get("character_id", "")) != "spell_power":
		push_error("Smoke test failed: Gensoulkyo replay loadout did not apply")
		quit(1)
		return true
	var rematch_request: Dictionary = gensoulkyo_api_model.rematch_request("match-server-smoke")
	if String(rematch_request.get("method", "")) != "POST" or not String(rematch_request.get("url", "")).ends_with("/v1/matches/match-server-smoke/rematch"):
		push_error("Smoke test failed: Gensoulkyo rematch request invalid")
		quit(1)
		return true
	var rematch_wait_apply: Dictionary = gensoulkyo_api_model.apply_rematch_response({
		"ok": true,
		"match_id": "match-server-smoke",
		"rematch_status": "waiting",
		"accepted_count": 1,
		"required_players": 2,
		"mode_id": "certification",
		"stage_id": "lunar_maze",
		"loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true},
		"server_authoritative": true,
	}, matchmaking_model, network_match_model)
	if not bool(rematch_wait_apply.get("ok", false)) or String(network_match_model.rematch_status) != "waiting" or int(network_match_model.rematch_accepted_count) != 1:
		push_error("Smoke test failed: Gensoulkyo waiting rematch response did not apply")
		quit(1)
		return true
	var rematch_found_apply: Dictionary = gensoulkyo_api_model.apply_rematch_response({
		"ok": true,
		"match_id": "match-server-smoke",
		"new_match_id": "match-server-rematch",
		"rematch_status": "found",
		"accepted_count": 2,
		"required_players": 2,
		"mode_id": "certification",
		"stage_id": "lunar_maze",
		"loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true},
		"server_authoritative": true,
	}, matchmaking_model, network_match_model)
	if not bool(rematch_found_apply.get("ok", false)) or String(network_match_model.match_id) != "match-server-rematch" or String(network_match_model.authority_state) != "loading" or String(matchmaking_model.active_match_id) != "match-server-rematch" or String(gensoulkyo_api_model.current_match_id) != "match-server-rematch":
		push_error("Smoke test failed: Gensoulkyo found rematch response did not prepare new match")
		quit(1)
		return true
	if String(network_match_model.rematch_status) != "found" or String(network_match_model.rematch_source_match_id) != "match-server-smoke" or int(network_match_model.rematch_required_players) != 2:
		push_error("Smoke test failed: Gensoulkyo rematch state not retained")
		quit(1)
		return true
	var claim_apply: Dictionary = gensoulkyo_api_model.apply_activity_claim_response({
		"ok": true,
		"duplicate": false,
		"reason": "none",
		"claim_kind": "task",
		"claim_id": "daily_complete_match",
		"user_id": "local_user",
		"reward_json": [{"type": "points", "amount": 25, "source": "task"}],
		"server_authoritative": true,
		"claimed": true,
		"reward_status": "claimed",
	}, results_service_model)
	if not bool(claim_apply.get("ok", false)) or int(results_service_model.wallet.get("points", 0)) != 37 or not bool(results_service_model.task_progress.get("daily_complete_match", {}).get("claimed", false)):
		push_error("Smoke test failed: Gensoulkyo activity claim response did not apply")
		quit(1)
		return true
	stage = "network_match_model"
	if network_match_model == null:
		push_error("Smoke test failed: network match model missing")
		quit(1)
		return true
	if not main_node.call("_begin_network_match_from_queue", found_result) or String(network_match_model.authority_state) != "loading":
		push_error("Smoke test failed: network match did not enter loading")
		quit(1)
		return true
	if not main_node.call("_network_match_ready") or String(network_match_model.authority_state) != "ready":
		push_error("Smoke test failed: network match ready invalid")
		quit(1)
		return true
	if not main_node.call("_network_receive_match_start", {
		"match_id": String(found_result.get("match_id", "")),
		"server_seed": 9101,
		"stage_id": "lunar_maze",
		"ruleset_version": "cert_s0_v1",
		"players": [
			{"user_id": "local_user", "display_name": "Local", "loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true}},
			{"user_id": "remote_user", "display_name": "Remote", "loadout": {"stage_id": "lunar_maze", "character_id": "precision", "ruleset_version": "ruleset-local-s0", "server_authoritative": true}},
		],
	}):
		push_error("Smoke test failed: network match_start rejected")
		quit(1)
		return true
	if String(network_match_model.server_loadout.get("stage_id", "")) != "lunar_maze" or String(network_match_model.server_loadout.get("character_id", "")) != "spell_power":
		push_error("Smoke test failed: network match_start loadout invalid")
		quit(1)
		return true
	var latency_delay: int = main_node.call("_network_update_latency_profile", 80, 0.01, 8)
	if latency_delay != 3:
		push_error("Smoke test failed: network latency profile invalid")
		quit(1)
		return true
	var packet_a: Dictionary = main_node.call("_network_build_input_packet", 10, {
		"direction_bits": 6,
		"slow_pressed": true,
		"shoot_pressed": true,
		"bomb_pressed": false,
		"card_slot": -1,
	}, 4)
	if int(packet_a.get("seq", 0)) != 1 or int(packet_a.get("dir", 0)) != 6 or not bool(packet_a.get("slow", false)) or not bool(packet_a.get("shoot", false)):
		push_error("Smoke test failed: network input packet encoding invalid")
		quit(1)
		return true
	var invalid_packet: Dictionary = main_node.call("_network_validate_packet", {
		"tick": 11,
		"seq": 2,
		"dir": 0,
		"slow": false,
		"shoot": false,
		"bomb": false,
		"card_slot": 4,
	}, 4)
	if bool(invalid_packet.get("valid", true)) or String(invalid_packet.get("reason", "")) != "card_slot_invalid":
		push_error("Smoke test failed: network input validation did not reject invalid card slot")
		quit(1)
		return true
	var packet_b: Dictionary = main_node.call("_network_build_input_packet", 11, {
		"direction_bits": 0,
		"slow_pressed": false,
		"shoot_pressed": false,
		"bomb_pressed": false,
		"card_slot": 1,
	}, 4)
	if int(packet_b.get("seq", 0)) != 2 or int(packet_b.get("card_slot", -1)) != 0 or int(network_match_model.input_packets.size()) != 2:
		push_error("Smoke test failed: network input stream invalid")
		quit(1)
		return true
	var smooth_snapshot: Dictionary = main_node.call("_network_receive_snapshot", {
		"match_id": String(found_result.get("match_id", "")),
		"tick": 10,
		"state_hash": "abcd",
		"full": true,
		"stage_id": "lunar_maze",
		"players": [
			{"user_id": "local_user", "x": 480.0, "y": 600.0, "loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true}},
		],
		"player_pos": {"x": 480.0, "y": 600.0},
		"bullets_delta": [
			{"op": "sync", "bullet_id": "sync-a", "pattern_id": "cert_ring", "kind": "ring", "tick": 10, "x": 481.0, "y": 120.0, "vx": 0.5, "vy": 2.5, "radius": 4.8, "damage": 1, "color": "blue"},
			{"op": "sync", "bullet_id": "sync-b", "pattern_id": "cert_nway", "kind": "nway", "tick": 10, "x": 500.0, "y": 130.0, "vx": -0.5, "vy": 3.0, "radius": 5.0, "damage": 1, "color": "pink"},
		],
		"mode_state": {"rating_code": "D", "rank_score_preview": 12, "challenge_progress": 0.25},
		"active_cards": [
			{"activation_id": "sync-card", "user_id": "local_user", "card_id": "tempo_break", "slot": 1, "started_tick": 10, "expires_tick": 310, "effect_kind": "pattern", "cost": 3.0, "damage": 22},
		],
		"events": [{"type": "graze", "tick": 10, "user_id": "local_user", "bullet_id": "sync-a", "value": 1}],
	}, {
		"tick": 12,
		"state_hash": "abcd",
		"player_pos": {"x": 484.0, "y": 600.0},
	})
	if not bool(smooth_snapshot.get("accepted", false)) or String(smooth_snapshot.get("correction", "")) != "smooth":
		push_error("Smoke test failed: smooth snapshot correction invalid")
		quit(1)
		return true
	if int(network_match_model.server_bullets.size()) != 2 or not network_match_model.server_bullets.has("sync-a") or int(network_match_model.last_bullet_delta_count) != 2 or int(network_match_model.last_event_count) != 1 or int(network_match_model.server_active_cards.size()) != 1:
		push_error("Smoke test failed: full server bullet sync invalid")
		quit(1)
		return true
	if String(network_match_model.server_loadout.get("stage_id", "")) != "lunar_maze" or String(network_match_model.server_loadout.get("character_id", "")) != "spell_power":
		push_error("Smoke test failed: snapshot loadout invalid")
		quit(1)
		return true
	var hard_snapshot: Dictionary = main_node.call("_network_receive_snapshot", {
		"match_id": String(found_result.get("match_id", "")),
		"tick": 12,
		"state_hash": "ef01",
		"full": false,
		"player_pos": {"x": 480.0, "y": 600.0},
		"bullets_delta": [
			{"op": "move", "bullet_id": "sync-a", "pattern_id": "cert_ring", "kind": "ring", "tick": 12, "x": 482.0, "y": 125.0, "vx": 0.5, "vy": 2.5, "radius": 4.8, "damage": 1, "color": "blue"},
			{"op": "despawn", "bullet_id": "sync-b", "pattern_id": "cert_nway", "kind": "nway", "tick": 12},
		],
		"active_cards": [],
	}, {
		"tick": 16,
		"state_hash": "ef01",
		"player_pos": {"x": 640.0, "y": 600.0},
	})
	if not bool(hard_snapshot.get("accepted", false)) or String(hard_snapshot.get("correction", "")) != "hard_snap" or not bool(hard_snapshot.get("request_full", false)):
		push_error("Smoke test failed: hard snapshot correction/full request invalid")
		quit(1)
		return true
	if int(network_match_model.server_bullets.size()) != 1 or network_match_model.server_active_cards.size() != 0 or network_match_model.server_bullets.has("sync-b") or absf(float((network_match_model.server_bullets["sync-a"] as Dictionary).get("y", 0.0)) - 125.0) > 0.001:
		push_error("Smoke test failed: delta server bullet update invalid")
		quit(1)
		return true
	var metrics: Dictionary = main_node.call("_network_metrics")
	if int(metrics.get("correction_count", 0)) < 2 or int(metrics.get("hard_snap_count", 0)) < 1 or float(metrics.get("average_position_error", 0.0)) <= 0.0 or int(metrics.get("server_bullet_count", 0)) != 1 or int(metrics.get("last_active_card_count", -1)) != 0 or String(metrics.get("stage_id", "")) != "lunar_maze":
		push_error("Smoke test failed: network correction metrics invalid")
		quit(1)
		return true
	var network_rows: Array[Dictionary] = main_node.call("_network_match_rows")
	if not _rows_have_ids(network_rows, ["netsec_summary", "business_transport", "business_auth_sign", "business_ecc_seal", "business_replay_guard", "protocol_descriptor", "protocol_descriptor_digest", "battle_client_transport", "battle_client_handshake", "battle_client_codec", "battle_client_packet", "battle_transport", "battle_handshake", "battle_codec_crypto", "battle_result_callback", "server_split", "authority", "match", "server_loadout", "input_delay", "input_stream", "snapshot", "server_bullets", "server_cards", "server_events", "presence", "rematch", "correction", "full_snapshot", "mode_state", "anti_cheat", "online_replay", "server_replay"]):
		push_error("Smoke test failed: network match rows incomplete")
		quit(1)
		return true
	if not _rows_have_sections(network_rows, ["overview", "business_network", "battle_network"]):
		push_error("Smoke test failed: network security sections incomplete")
		quit(1)
		return true
	if not _row_has_control(network_rows, "netsec_summary", "status") or not _row_has_control(network_rows, "business_transport", "status") or not _row_has_control(network_rows, "battle_transport", "status"):
		push_error("Smoke test failed: network security control metadata invalid")
		quit(1)
		return true
	var netsec_summary_row: Dictionary = _find_row_by_id(network_rows, "netsec_summary")
	var business_transport_row: Dictionary = _find_row_by_id(network_rows, "business_transport")
	var business_envelope_row: Dictionary = _find_row_by_id(network_rows, "business_ecc_seal")
	var business_replay_guard_row: Dictionary = _find_row_by_id(network_rows, "business_replay_guard")
	var battle_transport_row: Dictionary = _find_row_by_id(network_rows, "battle_transport")
	var battle_handshake_row: Dictionary = _find_row_by_id(network_rows, "battle_handshake")
	var battle_client_transport_row: Dictionary = _find_row_by_id(network_rows, "battle_client_transport")
	var battle_client_codec_row: Dictionary = _find_row_by_id(network_rows, "battle_client_codec")
	var battle_client_packet_row: Dictionary = _find_row_by_id(network_rows, "battle_client_packet")
	var battle_result_callback_row: Dictionary = _find_row_by_id(network_rows, "battle_result_callback")
	var protocol_descriptor_row: Dictionary = _find_row_by_id(network_rows, "protocol_descriptor")
	var protocol_digest_row: Dictionary = _find_row_by_id(network_rows, "protocol_descriptor_digest")
	if not String(netsec_summary_row.get("value", "")).contains("business") or not String(netsec_summary_row.get("value", "")).contains("battle"):
		push_error("Smoke test failed: network security summary invalid")
		quit(1)
		return true
	if not String(business_transport_row.get("value", "")).contains("HTTPS") or not String(business_transport_row.get("value", "")).contains("WSS") or not String(business_transport_row.get("value", "")).contains("http-dev"):
		push_error("Smoke test failed: business network security target invalid")
		quit(1)
		return true
	if not String(business_envelope_row.get("value", "")).contains("scaffold") or not String(business_envelope_row.get("value", "")).contains("real X25519") or not String(business_replay_guard_row.get("value", "")).contains("timestamp/nonce"):
		push_error("Smoke test failed: business envelope security rows invalid")
		quit(1)
		return true
	if not String(battle_transport_row.get("value", "")).contains("KCP") or not String(battle_transport_row.get("value", "")).contains("127.0.0.1:7901"):
		push_error("Smoke test failed: battle network transport target invalid")
		quit(1)
		return true
	if not String(battle_handshake_row.get("value", "")).contains("signed") or not String(battle_handshake_row.get("value", "")).contains("ECDHE"):
		push_error("Smoke test failed: battle handshake status invalid")
		quit(1)
		return true
	if not String(battle_client_transport_row.get("value", "")).contains("KCP/UDP") or not String(battle_client_transport_row.get("value", "")).contains("kcp_ready_scaffold"):
		push_error("Smoke test failed: battle client transport row invalid")
		quit(1)
		return true
	if not String(battle_client_codec_row.get("value", "")).contains("protobuf phk.v1") or not String(battle_client_codec_row.get("value", "")).contains("ChaCha20-Poly1305"):
		push_error("Smoke test failed: battle client codec row invalid")
		quit(1)
		return true
	if not String(battle_client_packet_row.get("value", "")).contains("input") or not String(battle_client_packet_row.get("value", "")).contains("BATTLE_PAYLOAD_TYPE_INPUT/3") or not String(battle_client_packet_row.get("value", "")).contains("encrypted false"):
		push_error("Smoke test failed: battle client packet row invalid")
		quit(1)
		return true
	if not String(battle_result_callback_row.get("value", "")).contains("Nakama/Go") or not String(battle_result_callback_row.get("value", "")).contains("verify"):
		push_error("Smoke test failed: battle result callback status invalid")
		quit(1)
		return true
	if not String(protocol_descriptor_row.get("value", "")).contains("0.1.0-draft") or not String(protocol_descriptor_row.get("value", "")).contains("battle 0.1.0-draft") or String(protocol_digest_row.get("value", "")).length() != 64:
		push_error("Smoke test failed: protocol descriptor UI rows invalid")
		quit(1)
		return true
	if not String(network_security_model.summary()).contains("signed") or not String(network_security_model.business_transport_summary()).contains("HTTPS") or not String(network_security_model.business_envelope_summary()).contains("scaffold") or not String(network_security_model.battle_transport_summary()).contains("ChaCha20"):
		push_error("Smoke test failed: network security model summaries invalid")
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "network_match"):
		push_error("Smoke test failed: network match screen did not open")
		quit(1)
		return true
	var network_overlay_snapshot: Dictionary = main_node.call("_ui_overlay_snapshot")
	if String(network_overlay_snapshot.get("layout_kind", "")) != "network_room" or String(network_overlay_snapshot.get("layout_anchor", "")) != "center" or bool(network_overlay_snapshot.get("gameplay_visible", true)) or bool(network_overlay_snapshot.get("layout_advance_gameplay", true)):
		push_error("Smoke test failed: network match menu layout policy invalid %s" % [network_overlay_snapshot])
		quit(1)
		return true
	if int(network_overlay_snapshot.get("overview_cards", 0)) != 4 or not String(network_overlay_snapshot.get("overview_cards_text", "")).contains("Gensoulkyo") or not String(network_overlay_snapshot.get("overview_cards_text", "")).contains("create room") or not String(network_overlay_snapshot.get("overview_cards_text", "")).contains("Prepare Handshake"):
		push_error("Smoke test failed: network match battle client overview cards invalid")
		quit(1)
		return true
	if int(network_overlay_snapshot.get("quick_buttons", 0)) > 2 or not String(network_overlay_snapshot.get("quick_actions_text", "")).contains("Home") or String(network_overlay_snapshot.get("quick_actions_text", "")).contains("Prepare Handshake") or String(network_overlay_snapshot.get("quick_actions_text", "")).contains("Connect Scaffold"):
		push_error("Smoke test failed: network match quick actions invalid")
		quit(1)
		return true
	var network_ui_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 64)
	if not _rows_have_ids(network_ui_rows, ["battle_client_prepare", "battle_client_connect", "battle_client_input_header"]) or not _row_has_control(network_ui_rows, "battle_client_prepare", "network") or not _row_has_control(network_ui_rows, "battle_client_connect", "network") or not _row_has_control(network_ui_rows, "battle_client_input_header", "network"):
		push_error("Smoke test failed: network match battle client action rows invalid")
		quit(1)
		return true
	var battle_prepare_cursor: int = _row_index_by_id(network_ui_rows, "battle_client_prepare")
	main_node.call("_ui_set_cursor", battle_prepare_cursor)
	var battle_prepare_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(battle_prepare_result.get("ok", false)) or String(battle_prepare_result.get("action", "")) != "battle_client_prepare" or String(battle_network_client_model.handshake_state) != "handshake_ready_scaffold":
		push_error("Smoke test failed: battle client prepare UI action invalid %s" % [battle_prepare_result])
		quit(1)
		return true
	network_ui_rows = main_node.call("_ui_screen_rows", 64)
	var battle_connect_cursor: int = _row_index_by_id(network_ui_rows, "battle_client_connect")
	main_node.call("_ui_set_cursor", battle_connect_cursor)
	var battle_connect_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(battle_connect_result.get("ok", false)) or String(battle_connect_result.get("action", "")) != "battle_client_connect" or String(battle_network_client_model.connection_state) != "connected_scaffold":
		push_error("Smoke test failed: battle client connect UI action invalid %s" % [battle_connect_result])
		quit(1)
		return true
	network_ui_rows = main_node.call("_ui_screen_rows", 64)
	var battle_header_cursor: int = _row_index_by_id(network_ui_rows, "battle_client_input_header")
	main_node.call("_ui_set_cursor", battle_header_cursor)
	var battle_header_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(battle_header_result.get("ok", false)) or String(battle_header_result.get("action", "")) != "battle_client_input_header" or int((battle_network_client_model.last_packet_header as Dictionary).get("seq", 0)) <= 0 or bool((battle_network_client_model.last_packet_header as Dictionary).get("encrypted", true)):
		push_error("Smoke test failed: battle client input header UI action invalid %s" % [battle_header_result])
		quit(1)
		return true
	if not _validate_row_label_keys(network_rows, localization):
		quit(1)
		return true
	if not String(network_match_model.mode_state_summary()).contains("rating D"):
		push_error("Smoke test failed: network mode state summary invalid")
		quit(1)
		return true
	var full_request: Dictionary = main_node.call("_network_request_full_snapshot", "smoke_manual")
	if String(full_request.get("type", "")) != "request_full_snapshot" or String(full_request.get("reason", "")) != "smoke_manual":
		push_error("Smoke test failed: manual full snapshot request invalid")
		quit(1)
		return true
	if results_service_model == null:
		push_error("Smoke test failed: results service missing before network settlement")
		quit(1)
		return true
	results_service_model.reset_local_state()
	if not main_node.call("_network_receive_event", {
		"type": "match_end",
		"replay_id": "replay-smoke-001",
		"final_result": {"winner": "server", "score": 1000, "graze_count": 12, "hit_count": 0, "result": "win"},
		"reward_json": [
			{"type": "points", "amount": 77, "source": "online_match_end"},
		],
		"task_progress": [
			{"task_id": "daily_complete_match", "progress": 1, "target": 1, "claimed": false},
		],
		"event_points": {"local_s0": 9},
		"leaderboard_updates": [
			{"leaderboard_id": "single_score", "score": 1000, "rank": 99, "percentile": 0.29, "season_id": "local_s0"},
		],
	}):
		push_error("Smoke test failed: network match_end rejected")
		quit(1)
		return true
	if String(network_match_model.authority_state) != "ended" or not bool(network_match_model.replay_metadata.get("authoritative", false)) or String(network_match_model.replay_metadata.get("replay_id", "")) != "replay-smoke-001":
		push_error("Smoke test failed: network replay metadata invalid")
		quit(1)
		return true
	if int(results_service_model.wallet.get("points", 0)) != 77 or int(results_service_model.reward_ledger.size()) != 1 or String(results_service_model.last_result.get("match_id", "")) != String(network_match_model.match_id):
		push_error("Smoke test failed: network match_end did not settle rewards")
		quit(1)
		return true
	if not main_node.call("_network_receive_event", {
		"type": "match_end",
		"replay_id": "replay-smoke-001",
		"final_result": {"winner": "server", "score": 1000},
		"reward_json": [
			{"type": "points", "amount": 7777, "source": "duplicate_online_match_end"},
		],
	}):
		push_error("Smoke test failed: duplicate network match_end rejected")
		quit(1)
		return true
	if int(results_service_model.wallet.get("points", 0)) != 77 or int(results_service_model.reward_ledger.size()) != 1:
		push_error("Smoke test failed: duplicate network match_end was not idempotent")
		quit(1)
		return true
	var reconnect_snapshot: Dictionary = main_node.call("_begin_match_reconnect", "")
	if not bool(reconnect_snapshot.get("ok", false)) or String(reconnect_snapshot.get("status", "")) != "reconnecting" or int(reconnect_snapshot.get("seconds_left", 0)) <= 0 or bool(reconnect_snapshot.get("local_result_authoritative", true)):
		push_error("Smoke test failed: reconnect state invalid")
		quit(1)
		return true
	match_rows = main_node.call("_matchmaking_rows")
	var reconnect_row: Dictionary = _find_row_by_id(match_rows, "reconnect_status")
	if reconnect_row.is_empty() or not String(reconnect_row.get("value", "")).contains("reconnecting"):
		push_error("Smoke test failed: reconnect UI row invalid")
		quit(1)
		return true
	var restored_snapshot: Dictionary = main_node.call("_finish_match_reconnect", true)
	if not bool(restored_snapshot.get("ok", false)) or String(restored_snapshot.get("status", "")) != "restored" or String(restored_snapshot.get("connection_state", "")) != "connected":
		push_error("Smoke test failed: reconnect restore invalid")
		quit(1)
		return true
	if not main_node.call("_cancel_match_queue"):
		push_error("Smoke test failed: matchmaking cancel invalid")
		quit(1)
		return true
	main_node.call("_set_network_quality", 260, 0.04, 30)
	var blocked_result: Dictionary = main_node.call("_join_match_queue", "certification")
	if bool(blocked_result.get("ok", true)) or String(blocked_result.get("status", "")) != "blocked" or String(blocked_result.get("last_error_code", "")) != "network_low":
		push_error("Smoke test failed: ranked low-quality network gate invalid")
		quit(1)
		return true
	if not main_node.call("_cancel_match_queue"):
		push_error("Smoke test failed: matchmaking blocked cancel invalid")
		quit(1)
		return true
	main_node.call("_set_network_quality", 42, 0.0, 4)
	stage = "game_mode_model"
	if game_mode_model == null:
		push_error("Smoke test failed: game mode model missing")
		quit(1)
		return true
	if not main_node.call("_select_game_mode", "certification"):
		push_error("Smoke test failed: certification mode did not select")
		quit(1)
		return true
	if not main_node.call("_apply_certification_result", {
		"rating_code": "C",
		"rank_score_after": 1375,
		"rank_score_delta": 120,
		"percentile_after": 0.25,
		"next_certification_unlocked": true,
		"replay_id": "cert-replay-smoke",
	}) or not bool(game_mode_model.certification_eligible_for_next()) or int(game_mode_model.certification_state.get("rank_score", 0)) != 1375:
		push_error("Smoke test failed: certification top30 eligibility invalid")
		quit(1)
		return true
	var br_players: Array[String] = ["p1", "p2", "p3", "p4", "p5"]
	if not main_node.call("_select_game_mode", "battle_royale") or not main_node.call("_configure_battle_royale_players", br_players):
		push_error("Smoke test failed: battle royale player setup invalid")
		quit(1)
		return true
	var br_pool: Dictionary = main_node.call("_build_battle_royale_pool", {
		"p1": ["a1", "a2", "a3", "a4"],
		"p2": ["b1", "b2", "b3", "b4"],
		"p3": ["c1", "c2", "c3", "c4"],
		"p4": ["d1", "d2", "d3", "d4"],
		"p5": ["e1", "e2", "e3", "e4"],
	})
	if not bool(br_pool.get("valid", false)) or int(br_pool.get("pool", []).size()) != 20:
		push_error("Smoke test failed: battle royale shared pool invalid")
		quit(1)
		return true
	var br_bad_pool: Dictionary = main_node.call("_build_battle_royale_pool", {"p1": ["a1", "a2", "a3"]})
	if bool(br_bad_pool.get("valid", true)) or String(br_bad_pool.get("reason", "")) != "br_pool_card_count":
		push_error("Smoke test failed: battle royale pool count gate invalid")
		quit(1)
		return true
	if not main_node.call("_receive_battle_royale_round", 2, ["choice_a", "choice_b", "choice_c"], 1800, br_players, 1860):
		push_error("Smoke test failed: battle royale round candidates invalid")
		quit(1)
		return true
	var br_select: Dictionary = main_node.call("_select_battle_royale_card", "choice_b", 1204)
	if not bool(br_select.get("ok", false)) or String(br_select.get("request", {}).get("action_type", "")) != "select_round_card" or bool(br_select.get("request", {}).get("client_result_authoritative", true)):
		push_error("Smoke test failed: battle royale selection request invalid")
		quit(1)
		return true
	var br_invalid_select: Dictionary = main_node.call("_select_battle_royale_card", "not_candidate", 1205)
	if bool(br_invalid_select.get("ok", true)) or String(br_invalid_select.get("last_error_code", "")) != "br_card_not_candidate":
		push_error("Smoke test failed: battle royale candidate gate invalid")
		quit(1)
		return true
	if not main_node.call("_select_game_mode", "world_boss") or not main_node.call("_configure_boss_party", "world_boss", ["p1", "p2", "p3", "p4"]):
		push_error("Smoke test failed: world boss party setup invalid")
		quit(1)
		return true
	if int(game_mode_model.world_boss_state.get("positions", []).size()) != 4:
		push_error("Smoke test failed: world boss positions invalid")
		quit(1)
		return true
	var world_boss_party_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_party")
	if not _validate_boss_party_row_contract(world_boss_party_row, "world_boss", 4):
		quit(1)
		return true
	var world_display_slots: Array[Dictionary] = game_mode_model.boss_display_slots("world_boss", Rect2(Vector2(160, 48), Vector2(640, 624)))
	if not _validate_boss_display_slots(world_display_slots, "world_boss", 4):
		quit(1)
		return true
	var world_projection: Dictionary = game_mode_model.boss_playfield_projection("world_boss", Rect2(Vector2(160, 48), Vector2(640, 624)))
	if not _validate_boss_playfield_projection({"playfield_projection": world_projection}, "world_boss", 4, 1.0):
		quit(1)
		return true
	var world_display_contract: Dictionary = game_mode_model.boss_display_contract_row("world_boss_display", "world_boss")
	if not _validate_boss_display_contract_row(world_display_contract, "world_boss", 4, 1.0, true):
		quit(1)
		return true
	main_node.call("_open_ui_screen", "practice")
	var world_draw_snapshot: Dictionary = main_node.call("_boss_playfield_draw_snapshot")
	if not _validate_boss_draw_snapshot(world_draw_snapshot, "world_boss", 4, 1.0):
		quit(1)
		return true
	var world_boss_entry: Dictionary = game_mode_model.validate_boss_entry("world_boss")
	if not bool(world_boss_entry.get("ok", false)) or bool(world_boss_entry.get("client_result_authoritative", true)) or int(world_boss_entry.get("attempts_left", 0)) != 3:
		push_error("Smoke test failed: world boss entry gate invalid %s" % [world_boss_entry])
		quit(1)
		return true
	var world_entry_preview: Dictionary = game_mode_model.boss_entry_preview("world_boss")
	if not _validate_boss_entry_preview(world_entry_preview, "world_boss", true, "none"):
		quit(1)
		return true
	var world_action_availability: Dictionary = game_mode_model.boss_action_availability_projection("world_boss")
	if not _validate_boss_action_availability(world_action_availability, "world_boss", true, "none", 4):
		quit(1)
		return true
	var transfer_preview: Dictionary = game_mode_model.boss_transfer_preview("world_boss", "p1", "p2", "focus_lens")
	if not _validate_boss_transfer_preview(transfer_preview, "world_boss", true, "none"):
		quit(1)
		return true
	var transfer_result: Dictionary = main_node.call("_request_boss_card_transfer", "world_boss", "p1", "p2", "focus_lens")
	if not bool(transfer_result.get("ok", false)) or String(transfer_result.get("request", {}).get("action_type", "")) != "transfer_card" or bool(transfer_result.get("request", {}).get("client_result_authoritative", true)):
		push_error("Smoke test failed: world boss transfer request invalid")
		quit(1)
		return true
	var world_boss_transfer_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_transfer")
	if not bool(world_boss_transfer_row.get("requires_server_confirmation", false)) or bool(world_boss_transfer_row.get("client_result_authoritative", true)):
		push_error("Smoke test failed: world boss transfer authority contract invalid %s" % [world_boss_transfer_row])
		quit(1)
		return true
	if String(world_boss_transfer_row.get("intent_authority", "")) != "client_request_only" or String(world_boss_transfer_row.get("server_confirmation_status", "")) != "pending" or String(world_boss_transfer_row.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: world boss transfer intent authority invalid %s" % [world_boss_transfer_row])
		quit(1)
		return true
	var latest_transfer_request: Dictionary = world_boss_transfer_row.get("latest_transfer_request", {})
	var latest_transfer_preview: Dictionary = world_boss_transfer_row.get("latest_transfer_preview", {})
	if int(world_boss_transfer_row.get("transfer_request_count", 0)) != 1 or int(world_boss_transfer_row.get("pending_server_confirmation_count", 0)) != 1 or String(world_boss_transfer_row.get("transfer_policy", "")) != "once_per_card_per_match":
		push_error("Smoke test failed: world boss transfer summary counts invalid %s" % [world_boss_transfer_row])
		quit(1)
		return true
	if String(latest_transfer_request.get("from_player_id", "")) != "p1" or String(latest_transfer_request.get("to_player_id", "")) != "p2" or String(latest_transfer_request.get("card_id", "")) != "focus_lens" or not String(world_boss_transfer_row.get("latest_transfer_summary", "")).contains("p1->p2 focus_lens"):
		push_error("Smoke test failed: world boss latest transfer summary invalid %s" % [world_boss_transfer_row])
		quit(1)
		return true
	if not _validate_boss_transfer_preview(latest_transfer_preview, "world_boss", true, "none"):
		quit(1)
		return true
	var duplicate_transfer: Dictionary = main_node.call("_request_boss_card_transfer", "world_boss", "p1", "p3", "focus_lens")
	if bool(duplicate_transfer.get("ok", true)) or String(duplicate_transfer.get("last_error_code", "")) != "transfer_duplicate":
		push_error("Smoke test failed: boss transfer idempotency invalid")
		quit(1)
		return true
	var duplicate_preview: Dictionary = game_mode_model.boss_transfer_preview("world_boss", "p1", "p3", "focus_lens")
	if not _validate_boss_transfer_preview(duplicate_preview, "world_boss", false, "transfer_duplicate"):
		quit(1)
		return true
	var self_transfer: Dictionary = main_node.call("_request_boss_card_transfer", "world_boss", "p1", "p1", "team_focus")
	if bool(self_transfer.get("ok", true)) or String(self_transfer.get("last_error_code", "")) != "transfer_self" or not (self_transfer.get("request", {}) as Dictionary).is_empty():
		push_error("Smoke test failed: boss self-transfer gate invalid %s" % [self_transfer])
		quit(1)
		return true
	var outside_transfer: Dictionary = main_node.call("_request_boss_card_transfer", "world_boss", "p1", "p9", "team_focus")
	if bool(outside_transfer.get("ok", true)) or String(outside_transfer.get("last_error_code", "")) != "transfer_player_not_in_party":
		push_error("Smoke test failed: boss transfer party gate invalid %s" % [outside_transfer])
		quit(1)
		return true
	var missing_card_transfer: Dictionary = main_node.call("_request_boss_card_transfer", "world_boss", "p1", "p2", "")
	if bool(missing_card_transfer.get("ok", true)) or String(missing_card_transfer.get("last_error_code", "")) != "transfer_card_missing":
		push_error("Smoke test failed: boss missing-card transfer gate invalid %s" % [missing_card_transfer])
		quit(1)
		return true
	var transfer_guard_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_transfer")
	var local_validation_rules: Array = transfer_guard_row.get("local_validation_rules", [])
	if String(transfer_guard_row.get("local_validation", "")) != "boss_transfer_preflight" or not bool(transfer_guard_row.get("preflight_available", false)) or not local_validation_rules.has("once_per_card_per_match") or String(transfer_guard_row.get("last_error_code", "")) != "transfer_card_missing":
		push_error("Smoke test failed: boss transfer local validation row missing %s" % [transfer_guard_row])
		quit(1)
		return true
	var server_world_boss_snapshot: Dictionary = game_mode_model.apply_server_world_boss_snapshot({
		"boss_instance_id": "world_boss_local_s0_001",
		"season_id": "local_s0",
		"max_hp": 100000,
		"current_hp": 40000,
		"daily_attempt_limit": 3,
		"daily_attempts_used": 1,
		"daily_attempts_left": 2,
		"friendly_fire": "player_bullets_only",
		"arena_policy": "shared_ring",
		"server_authoritative": true,
	})
	if not bool(server_world_boss_snapshot.get("ok", false)) or int(game_mode_model.world_boss_state.get("current_hp", 0)) != 40000 or int(game_mode_model.world_boss_state.get("daily_attempts_left", 0)) != 2:
		push_error("Smoke test failed: server world boss snapshot invalid %s" % [game_mode_model.world_boss_state])
		quit(1)
		return true
	var world_boss_hp_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_hp")
	if not bool(world_boss_hp_row.get("persistent_hp", false)) or not bool(world_boss_hp_row.get("server_authoritative", false)) or bool(world_boss_hp_row.get("client_result_authoritative", true)) or absf(float(world_boss_hp_row.get("hp_ratio", 0.0)) - 0.4) > 0.001:
		push_error("Smoke test failed: world boss hp row authority contract invalid %s" % [world_boss_hp_row])
		quit(1)
		return true
	var world_boss_rules_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_rules")
	if String(world_boss_rules_row.get("friendly_fire", "")) != "player_bullets_only" or String(world_boss_rules_row.get("arena_policy", "")) != "shared_ring" or String(world_boss_rules_row.get("friendly_fire_warning", "")) != "player_bullets_can_hit_allies" or String(world_boss_rules_row.get("rules_source", "")) != "server_snapshot" or bool(world_boss_rules_row.get("client_result_authoritative", true)):
		push_error("Smoke test failed: world boss rules row server projection invalid %s" % [world_boss_rules_row])
		quit(1)
		return true
	var world_boss_playfield_after_snapshot: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_playfield")
	if not _validate_boss_playfield_projection(world_boss_playfield_after_snapshot, "world_boss", 4, 0.4):
		quit(1)
		return true
	var world_boss_hud_after_snapshot: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_hud")
	if not _validate_boss_hud_projection(world_boss_hud_after_snapshot, "world_boss", 4, 0.4):
		quit(1)
		return true
	if main_node.call("_apply_world_boss_result", {
		"client_result_authoritative": true,
		"boss_hp_after_global": 0,
		"team_damage": 999999,
	}):
		push_error("Smoke test failed: client-authored world boss result accepted")
		quit(1)
		return true
	if String(game_mode_model.last_error_code) != "client_authoritative_world_boss_result" or int(game_mode_model.world_boss_state.get("current_hp", 0)) != 40000:
		push_error("Smoke test failed: rejected world boss result mutated state %s" % [game_mode_model.world_boss_state])
		quit(1)
		return true
	var rejected_world_result_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_result")
	if bool(rejected_world_result_row.get("client_result_authoritative", true)) or String(rejected_world_result_row.get("result_source", "")) == "server_settlement_projection":
		push_error("Smoke test failed: rejected world boss result row became authoritative %s" % [rejected_world_result_row])
		quit(1)
		return true
	if not bool(rejected_world_result_row.get("result_rejected", false)) or String(rejected_world_result_row.get("result_rejected_reason", "")) != "client_authoritative_world_boss_result" or String(rejected_world_result_row.get("result_rejection_authority", "")) != "client_rejected_server_required":
		push_error("Smoke test failed: rejected world boss result reason missing %s" % [rejected_world_result_row])
		quit(1)
		return true
	if not _validate_boss_result_authority_row(rejected_world_result_row, "world_boss", false):
		quit(1)
		return true
	if not main_node.call("_apply_world_boss_result", {
		"boss_instance_id": "world_boss_local_s0_001",
		"match_id": "wb-smoke-pending",
		"boss_hp_after_global": 0,
		"boss_max_hp": 100000,
		"team_damage": 40000,
		"global_damage_applied": 40000,
		"daily_attempts_left": 2,
		"server_authoritative": true,
	}):
		push_error("Smoke test failed: pending world boss result invalid")
		quit(1)
		return true
	var pending_world_result_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_result")
	if not bool(pending_world_result_row.get("defeat_timestamp_pending_server", false)) or String(pending_world_result_row.get("defeat_timestamp_source", "")) != "pending_server" or not String(pending_world_result_row.get("defeated_at", "")).is_empty():
		push_error("Smoke test failed: world boss pending defeat timestamp became client-authored %s" % [pending_world_result_row])
		quit(1)
		return true
	if not main_node.call("_apply_world_boss_result", {
		"boss_instance_id": "world_boss_local_s0_001",
		"match_id": "wb-smoke-001",
		"settlement_key": "world-boss-result:wb-smoke-001",
		"result_hash": "sha256:worldboss",
		"replay_id": "world-boss-replay-smoke",
		"server_time": "2026-06-25T00:00:02Z",
		"key_id": "battle-local-dev",
		"boss_hp_after_global": 0,
		"boss_max_hp": 100000,
		"team_damage": 5000,
		"global_damage_applied": 5000,
		"daily_attempts_left": 2,
		"defeated_at": "2026-06-25T00:00:00Z",
		"world_announcement_emitted": true,
		"server_authoritative": true,
	}):
		push_error("Smoke test failed: world boss result invalid")
		quit(1)
		return true
	if String(game_mode_model.world_boss_state.get("defeated_at", "")).is_empty() or String(game_mode_model.world_boss_state.get("world_announcement", "")) != "world_boss_defeated":
		push_error("Smoke test failed: world boss announcement invalid")
		quit(1)
		return true
	var world_result_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "world_boss_result")
	if not bool(world_result_row.get("enabled", false)) or not bool(world_result_row.get("server_authoritative", false)) or bool(world_result_row.get("client_result_authoritative", true)) or String(world_result_row.get("result_source", "")) != "server_settlement_projection":
		push_error("Smoke test failed: world boss result row authority invalid %s" % [world_result_row])
		quit(1)
		return true
	if bool(world_result_row.get("result_rejected", true)) or not String(world_result_row.get("result_rejected_reason", "")).is_empty():
		push_error("Smoke test failed: server world boss result did not clear rejection state %s" % [world_result_row])
		quit(1)
		return true
	if not _validate_boss_result_authority_row(world_result_row, "world_boss", true):
		quit(1)
		return true
	if int(world_result_row.get("damage_this_match", 0)) != 5000 or int(world_result_row.get("global_damage_applied", 0)) != 5000 or String(world_result_row.get("result_status", "")) != "defeated":
		push_error("Smoke test failed: world boss result row summary invalid %s" % [world_result_row])
		quit(1)
		return true
	if bool(world_result_row.get("defeat_timestamp_pending_server", true)) or String(world_result_row.get("defeat_timestamp_source", "")) != "server" or String(world_result_row.get("defeated_at", "")) != "2026-06-25T00:00:00Z":
		push_error("Smoke test failed: world boss server defeat timestamp projection invalid %s" % [world_result_row])
		quit(1)
		return true
	if String(world_result_row.get("result_receipt_id", "")) != "world-boss-result:wb-smoke-001" or String(world_result_row.get("result_hash", "")) != "sha256:worldboss" or String(world_result_row.get("result_replay_id", "")) != "world-boss-replay-smoke" or String(world_result_row.get("receipt_source", "")) != "server_settlement_receipt":
		push_error("Smoke test failed: world boss settlement receipt projection invalid %s" % [world_result_row])
		quit(1)
		return true
	if not main_node.call("_select_game_mode", "instance_boss") or not main_node.call("_configure_boss_party", "instance_boss", ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]):
		push_error("Smoke test failed: instance boss party setup invalid")
		quit(1)
		return true
	if int(game_mode_model.instance_boss_state.get("positions", []).size()) != 8:
		push_error("Smoke test failed: instance boss positions invalid")
		quit(1)
		return true
	var instance_boss_party_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_party")
	if not _validate_boss_party_row_contract(instance_boss_party_row, "instance_boss", 8):
		quit(1)
		return true
	var instance_display_slots: Array[Dictionary] = game_mode_model.boss_display_slots("instance_boss", Rect2(Vector2(160, 48), Vector2(640, 624)))
	if not _validate_boss_display_slots(instance_display_slots, "instance_boss", 8):
		quit(1)
		return true
	var instance_projection: Dictionary = game_mode_model.boss_playfield_projection("instance_boss", Rect2(Vector2(160, 48), Vector2(640, 624)))
	if not _validate_boss_playfield_projection({"playfield_projection": instance_projection}, "instance_boss", 8, 1.0):
		quit(1)
		return true
	main_node.call("_open_ui_screen", "practice")
	var instance_draw_snapshot: Dictionary = main_node.call("_boss_playfield_draw_snapshot")
	if not _validate_boss_draw_snapshot(instance_draw_snapshot, "instance_boss", 8, 1.0):
		quit(1)
		return true
	var rejected_instance_access: Dictionary = main_node.call("_apply_server_instance_boss_access", {
		"client_result_authoritative": true,
		"entry_attempts_left": 9,
		"entry_unlocked": true,
	})
	if bool(rejected_instance_access.get("ok", true)) or String(game_mode_model.last_error_code) != "client_authoritative_instance_boss_access":
		push_error("Smoke test failed: client-authored instance boss access accepted %s" % [rejected_instance_access])
		quit(1)
		return true
	var locked_instance_access: Dictionary = main_node.call("_apply_server_instance_boss_access", {
		"entry_period": "weekly",
		"entry_attempt_limit": 5,
		"entry_attempts_used": 4,
		"entry_attempts_left": 1,
		"required_rating": "C",
		"player_rating": "D",
		"required_key_id": "instance_key_local_s0",
		"owned_key_count": 0,
		"entry_unlocked": false,
		"server_authoritative": true,
	})
	if bool(locked_instance_access.get("ok", true)) or not ["entry_locked", "rating_required", "key_required"].has(String(locked_instance_access.get("reason", ""))):
		push_error("Smoke test failed: locked instance boss access invalid %s state=%s" % [locked_instance_access, game_mode_model.instance_boss_state])
		quit(1)
		return true
	var locked_entry: Dictionary = game_mode_model.validate_boss_entry("instance_boss")
	var locked_entry_failures: Array = locked_entry.get("failures", [])
	if bool(locked_entry.get("ok", true)) or not locked_entry_failures.has("entry_locked") or not locked_entry_failures.has("rating_required") or not locked_entry_failures.has("key_required") or bool(locked_entry.get("client_result_authoritative", true)):
		push_error("Smoke test failed: locked instance entry failures invalid %s" % [locked_entry])
		quit(1)
		return true
	var locked_entry_preview: Dictionary = game_mode_model.boss_entry_preview("instance_boss")
	if not _validate_boss_entry_preview(locked_entry_preview, "instance_boss", false, "entry_locked"):
		quit(1)
		return true
	var locked_action_availability: Dictionary = game_mode_model.boss_action_availability_projection("instance_boss")
	if not _validate_boss_action_availability(locked_action_availability, "instance_boss", false, "entry_locked", 8):
		quit(1)
		return true
	var locked_entry_request: Dictionary = main_node.call("_request_boss_entry", "instance_boss")
	if bool(locked_entry_request.get("ok", true)) or String(locked_entry_request.get("last_error_code", "")) != "entry_locked":
		push_error("Smoke test failed: locked instance entry request invalid %s" % [locked_entry_request])
		quit(1)
		return true
	var unlocked_instance_access: Dictionary = main_node.call("_apply_server_instance_boss_access", {
		"entry_period": "weekly",
		"entry_attempt_limit": 5,
		"entry_attempts_used": 2,
		"entry_attempts_left": 3,
		"required_rating": "C",
		"player_rating": "B",
		"required_key_id": "instance_key_local_s0",
		"owned_key_count": 2,
		"entry_unlocked": true,
		"friendly_fire": "all_friendly_fire",
		"movement_area_policy": "personal_lanes",
		"server_authoritative": true,
	})
	if not bool(unlocked_instance_access.get("ok", false)) or int(unlocked_instance_access.get("attempts_left", 0)) != 3:
		push_error("Smoke test failed: unlocked instance boss access invalid %s state=%s" % [unlocked_instance_access, game_mode_model.instance_boss_state])
		quit(1)
		return true
	var instance_entry_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_entry")
	if not bool(instance_entry_row.get("entry_valid", false)) or not bool(instance_entry_row.get("server_authoritative", false)) or bool(instance_entry_row.get("client_result_authoritative", true)) or int(instance_entry_row.get("owned_key_count", 0)) != 2 or String(instance_entry_row.get("required_rating", "")) != "C":
		push_error("Smoke test failed: instance boss entry row invalid %s" % [instance_entry_row])
		quit(1)
		return true
	var instance_entry_rules: Array = instance_entry_row.get("local_validation_rules", [])
	if String(instance_entry_row.get("intent_authority", "")) != "client_request_only" or String(instance_entry_row.get("server_confirmation_status", "")) != "required" or String(instance_entry_row.get("local_validation", "")) != "boss_entry_preflight" or String(instance_entry_row.get("settlement_authority", "")) != "server" or not instance_entry_rules.has("rating_requirement") or not instance_entry_rules.has("key_requirement"):
		push_error("Smoke test failed: instance boss entry intent authority invalid %s" % [instance_entry_row])
		quit(1)
		return true
	if not _validate_boss_entry_preview(instance_entry_row.get("entry_preflight", {}), "instance_boss", true, "none"):
		quit(1)
		return true
	if not _validate_boss_action_availability(instance_entry_row.get("action_availability", {}), "instance_boss", true, "none", 8):
		quit(1)
		return true
	var instance_rules_row_after_access: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_rules")
	if String(instance_rules_row_after_access.get("friendly_fire", "")) != "all_friendly_fire" or String(instance_rules_row_after_access.get("arena_policy", "")) != "personal_lanes" or String(instance_rules_row_after_access.get("friendly_fire_warning", "")) != "all_friendly_fire_enabled" or not bool(instance_rules_row_after_access.get("server_authoritative", false)) or bool(instance_rules_row_after_access.get("client_result_authoritative", true)):
		push_error("Smoke test failed: instance boss rules row server projection invalid %s" % [instance_rules_row_after_access])
		quit(1)
		return true
	var instance_boss_playfield_after_access: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_playfield")
	if not _validate_boss_playfield_projection(instance_boss_playfield_after_access, "instance_boss", 8, 1.0):
		quit(1)
		return true
	var instance_boss_hud_after_access: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_hud")
	if not _validate_boss_hud_projection(instance_boss_hud_after_access, "instance_boss", 8, 1.0):
		quit(1)
		return true
	var instance_entry_request: Dictionary = main_node.call("_request_boss_entry", "instance_boss")
	if not bool(instance_entry_request.get("ok", false)) or String(instance_entry_request.get("request", {}).get("action_type", "")) != "enter_boss_instance" or bool(instance_entry_request.get("request", {}).get("client_result_authoritative", true)):
		push_error("Smoke test failed: instance boss entry request invalid %s" % [instance_entry_request])
		quit(1)
		return true
	if main_node.call("_apply_instance_boss_result", {
		"client_result_authoritative": true,
		"boss_defeated": true,
		"survivors": 8,
		"clear_time_seconds": 1,
	}):
		push_error("Smoke test failed: client-authored instance boss result accepted")
		quit(1)
		return true
	if String(game_mode_model.last_error_code) != "client_authoritative_instance_boss_result" or bool(game_mode_model.instance_boss_state.get("cleared", false)):
		push_error("Smoke test failed: rejected instance boss result mutated state %s" % [game_mode_model.instance_boss_state])
		quit(1)
		return true
	var rejected_instance_result_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_result")
	if bool(rejected_instance_result_row.get("client_result_authoritative", true)) or String(rejected_instance_result_row.get("result_source", "")) == "server_settlement_projection":
		push_error("Smoke test failed: rejected instance boss result row became authoritative %s" % [rejected_instance_result_row])
		quit(1)
		return true
	if not bool(rejected_instance_result_row.get("result_rejected", false)) or String(rejected_instance_result_row.get("result_rejected_reason", "")) != "client_authoritative_instance_boss_result" or String(rejected_instance_result_row.get("result_rejection_authority", "")) != "client_rejected_server_required":
		push_error("Smoke test failed: rejected instance boss result reason missing %s" % [rejected_instance_result_row])
		quit(1)
		return true
	if not _validate_boss_result_authority_row(rejected_instance_result_row, "instance_boss", false):
		quit(1)
		return true
	if not main_node.call("_apply_instance_boss_result", {
		"match_id": "ib-smoke-mutual-default",
		"settlement_key": "instance-boss-result:ib-smoke-mutual-default",
		"result_hash": "sha256:instanceboss-mutual-default",
		"server_time": "2026-06-25T00:04:30Z",
		"boss_defeated": true,
		"survivors": 0,
		"failed_mechanic": false,
		"clear_time_seconds": 170,
		"server_authoritative": true,
	}):
		push_error("Smoke test failed: default survivor-required instance boss result rejected")
		quit(1)
		return true
	var default_survivor_required_result: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_result")
	if bool(default_survivor_required_result.get("cleared", true)) or String(default_survivor_required_result.get("clear_rule", "")) != "survivor_required" or int(default_survivor_required_result.get("stars", -1)) != 0:
		push_error("Smoke test failed: default survivor-required instance boss mutual defeat cleared %s" % [default_survivor_required_result])
		quit(1)
		return true
	if not main_node.call("_apply_instance_boss_result", {
		"match_id": "ib-smoke-mutual-allowed",
		"settlement_key": "instance-boss-result:ib-smoke-mutual-allowed",
		"result_hash": "sha256:instanceboss-mutual-allowed",
		"replay_id": "instance-boss-replay-mutual-allowed",
		"server_time": "2026-06-25T00:04:45Z",
		"key_id": "battle-local-dev",
		"boss_defeated": true,
		"survivors": 0,
		"survivor_required": false,
		"failed_mechanic": false,
		"clear_time_seconds": 170,
		"three_star_time_seconds": 180,
		"deaths": 8,
		"bombs_used": 4,
		"bomb_limit": 3,
		"server_authoritative": true,
	}):
		push_error("Smoke test failed: survivor-optional instance boss result invalid")
		quit(1)
		return true
	var survivor_optional_result: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_result")
	if not bool(survivor_optional_result.get("cleared", false)) or bool(survivor_optional_result.get("survivor_required", true)) or String(survivor_optional_result.get("clear_rule", "")) != "survivor_optional":
		push_error("Smoke test failed: survivor-optional instance boss result not projected as cleared %s" % [survivor_optional_result])
		quit(1)
		return true
	if int(survivor_optional_result.get("stars", 0)) != 2 or String(survivor_optional_result.get("star_condition_summary", "")) != "2/4":
		push_error("Smoke test failed: survivor-optional instance boss star summary invalid %s" % [survivor_optional_result])
		quit(1)
		return true
	if not _validate_boss_result_authority_row(survivor_optional_result, "instance_boss", true):
		quit(1)
		return true
	if not main_node.call("_apply_instance_boss_result", {
		"match_id": "ib-smoke-001",
		"settlement_key": "instance-boss-result:ib-smoke-001",
		"result_hash": "sha256:instanceboss",
		"replay_id": "instance-boss-replay-smoke",
		"server_time": "2026-06-25T00:05:00Z",
		"key_id": "battle-local-dev",
		"boss_defeated": true,
		"survivors": 3,
		"failed_mechanic": false,
		"clear_time_seconds": 150,
		"three_star_time_seconds": 180,
		"deaths": 0,
		"bombs_used": 2,
		"bomb_limit": 3,
		"server_authoritative": true,
	}):
		push_error("Smoke test failed: instance boss result invalid")
		quit(1)
		return true
	if not bool(game_mode_model.instance_boss_state.get("cleared", false)) or int(game_mode_model.instance_boss_state.get("stars", 0)) != 3:
		push_error("Smoke test failed: instance boss clear/stars invalid")
		quit(1)
		return true
	var instance_boss_stars_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_stars")
	if not bool(instance_boss_stars_row.get("server_authoritative", false)) or bool(instance_boss_stars_row.get("client_result_authoritative", true)):
		push_error("Smoke test failed: instance boss star authority contract invalid %s" % [instance_boss_stars_row])
		quit(1)
		return true
	var instance_result_row: Dictionary = _find_row_by_id(game_mode_model.mode_rows(), "instance_boss_result")
	if not bool(instance_result_row.get("enabled", false)) or not bool(instance_result_row.get("server_authoritative", false)) or bool(instance_result_row.get("client_result_authoritative", true)) or String(instance_result_row.get("result_source", "")) != "server_settlement_projection":
		push_error("Smoke test failed: instance boss result row authority invalid %s" % [instance_result_row])
		quit(1)
		return true
	if bool(instance_result_row.get("result_rejected", true)) or not String(instance_result_row.get("result_rejected_reason", "")).is_empty():
		push_error("Smoke test failed: server instance boss result did not clear rejection state %s" % [instance_result_row])
		quit(1)
		return true
	if not _validate_boss_result_authority_row(instance_result_row, "instance_boss", true):
		quit(1)
		return true
	if not bool(instance_result_row.get("cleared", false)) or int(instance_result_row.get("stars", 0)) != 3 or String(instance_result_row.get("result_status", "")) != "cleared":
		push_error("Smoke test failed: instance boss result row summary invalid %s" % [instance_result_row])
		quit(1)
		return true
	var star_conditions: Array = instance_result_row.get("star_conditions", [])
	if star_conditions.size() != 4 or String(instance_result_row.get("star_condition_summary", "")) != "4/4" or int(instance_result_row.get("three_star_time_seconds", 0)) != 180:
		push_error("Smoke test failed: instance boss star condition summary invalid %s" % [instance_result_row])
		quit(1)
		return true
	if String(instance_result_row.get("result_receipt_id", "")) != "instance-boss-result:ib-smoke-001" or String(instance_result_row.get("result_hash", "")) != "sha256:instanceboss" or String(instance_result_row.get("result_replay_id", "")) != "instance-boss-replay-smoke" or String(instance_result_row.get("receipt_source", "")) != "server_settlement_receipt":
		push_error("Smoke test failed: instance boss settlement receipt projection invalid %s" % [instance_result_row])
		quit(1)
		return true
	for condition in star_conditions:
		var condition_row: Dictionary = condition
		if not bool(condition_row.get("met", false)) or String(condition_row.get("id", "")).is_empty():
			push_error("Smoke test failed: instance boss star condition row invalid %s" % [instance_result_row])
			quit(1)
			return true
	var game_mode_rows: Array[Dictionary] = main_node.call("_game_mode_rows")
	if not _rows_have_ids(game_mode_rows, ["cert_rating", "cert_rank", "cert_top30", "cert_stage", "br_players", "br_pool", "br_round", "br_candidates", "br_zero_order", "world_boss_hp", "world_boss_attempts", "world_boss_entry", "world_boss_party", "world_boss_display", "world_boss_playfield", "world_boss_hud", "world_boss_transfer", "world_boss_result", "world_boss_announcement", "instance_boss_entry", "instance_boss_phase", "instance_boss_conditions", "instance_boss_stars", "instance_boss_party", "instance_boss_display", "instance_boss_playfield", "instance_boss_hud", "instance_boss_transfer", "instance_boss_result", "mode_action_log"]):
		push_error("Smoke test failed: game mode rows incomplete")
		quit(1)
		return true
	if not _validate_row_label_keys(game_mode_rows, localization):
		quit(1)
		return true
	stage = "chest_system"
	if chest_system == null:
		push_error("Smoke test failed: chest system missing")
		quit(1)
		return true
	chest_system.reset_local_state()
	var chest_rows: Array[Dictionary] = chest_system.pool_rows()
	if chest_rows.is_empty() or String(chest_rows[0].get("id", "")) != "local_basic" or not bool(chest_rows[0].get("can_open_one", false)):
		push_error("Smoke test failed: chest pool rows invalid")
		quit(1)
		return true
	var probability_rows: Array[Dictionary] = chest_system.probability_rows("local_basic")
	if probability_rows.size() < 4 or not _rows_have_key(probability_rows, "percent"):
		push_error("Smoke test failed: chest probability rows invalid")
		quit(1)
		return true
	var pity_before: Dictionary = chest_system.pity_summary("local_basic")
	if int(pity_before.get("rare_threshold", 0)) != 10 or int(pity_before.get("epic_threshold", 0)) != 60:
		push_error("Smoke test failed: chest pity summary invalid")
		quit(1)
		return true
	var wallet_keys_before := int(chest_system.wallet.get("chest_keys", 0))
	var open_result: Dictionary = main_node.call("_open_chest", "local_basic", 1)
	if not bool(open_result.get("ok", false)) or chest_system.result_rows().is_empty() or chest_system.audit_rows(1).is_empty():
		push_error("Smoke test failed: chest open did not produce result/audit")
		quit(1)
		return true
	if int(chest_system.wallet.get("chest_keys", 0)) != wallet_keys_before - 1 or int(chest_system.owned_chests.get("local_basic", 0)) != 2:
		push_error("Smoke test failed: chest cost was not deducted")
		quit(1)
		return true
	var first_result: Dictionary = chest_system.result_rows()[0]
	if String(first_result.get("card_id", "")).is_empty() or not first_result.has("rarity"):
		push_error("Smoke test failed: chest result row invalid")
		quit(1)
		return true
	stage = "results_service"
	if results_service_model == null:
		push_error("Smoke test failed: results service missing")
		quit(1)
		return true
	results_service_model.reset_local_state()
	var result_response: Dictionary = main_node.call("_apply_server_match_result", {
		"match_id": "match-reward-smoke",
		"user_id": "local_user",
		"mode": "certification",
		"mode_ruleset_version": "cert_s0_v1",
		"ruleset_version": "ruleset-local-s0",
		"server_seed": "seed-smoke",
		"status": "completed",
		"score": 123456,
		"graze_count": 777,
		"hit_count": 1,
		"result": "win",
		"reward_json": [
			{"type": "points", "amount": 250, "source": "complete_match"},
			{"type": "card_dust", "amount": 35, "source": "graze"},
			{"type": "chest_keys", "amount": 1, "source": "daily_first_win"},
			{"type": "chest", "item_id": "local_basic", "amount": 1, "source": "drop"},
			{"type": "card", "item_id": "focus_lens", "amount": 1, "source": "drop"},
		],
		"task_progress": [
			{"task_id": "daily_complete_match", "progress": 1, "target": 1, "claimed": false},
			{"task_id": "daily_graze", "progress": 777, "target": 500, "claimed": true},
		],
		"event_points": {"local_s0": 42},
		"leaderboard_updates": [
			{"leaderboard_id": "rank_score", "score": 1200, "rank": 25, "percentile": 0.22, "season_id": "local_s0"},
			{"leaderboard_id": "single_score", "score": 123456, "rank": 8, "percentile": 0.08, "season_id": "local_s0"},
		],
		"mode_result": {"rating_code": "C", "rank_score_after": 1200, "percentile_after": 0.22},
		"replay_id": "replay-reward-smoke",
	})
	if not bool(result_response.get("ok", false)) or bool(result_response.get("duplicate", true)):
		push_error("Smoke test failed: server result did not settle")
		quit(1)
		return true
	if int(results_service_model.wallet.get("points", 0)) != 250 or int(results_service_model.wallet.get("card_dust", 0)) != 35 or int(results_service_model.wallet.get("chest_keys", 0)) != 1:
		push_error("Smoke test failed: reward wallet invalid")
		quit(1)
		return true
	if int(chest_system.wallet.get("chest_keys", 0)) != int(wallet_keys_before) or int(chest_system.owned_chests.get("local_basic", 0)) != 3:
		push_error("Smoke test failed: rewards did not update chest wallet/chests")
		quit(1)
		return true
	if int(results_service_model.reward_ledger.size()) != 5:
		push_error("Smoke test failed: reward ledger invalid")
		quit(1)
		return true
	var duplicate_result: Dictionary = main_node.call("_apply_server_match_result", {
		"match_id": "match-reward-smoke",
		"user_id": "local_user",
		"reward_json": [
			{"type": "points", "amount": 9999, "source": "duplicate"},
		],
		"replay_id": "replay-reward-smoke",
	})
	if not bool(duplicate_result.get("ok", false)) or not bool(duplicate_result.get("duplicate", false)) or int(results_service_model.wallet.get("points", 0)) != 250 or int(results_service_model.reward_ledger.size()) != 5:
		push_error("Smoke test failed: reward idempotency invalid")
		quit(1)
		return true
	var rejected_result: Dictionary = main_node.call("_apply_server_match_result", {
		"match_id": "client-authored-reward",
		"user_id": "local_user",
		"client_authored_reward": true,
		"reward_json": [],
		"replay_id": "bad",
	})
	if bool(rejected_result.get("ok", true)) or String(rejected_result.get("reason", "")) != "client_authored_reward":
		push_error("Smoke test failed: client-authored reward was not rejected")
		quit(1)
		return true
	var compensation_result: Dictionary = main_node.call("_claim_compensation", {
		"compensation_id": "comp-smoke",
		"reason": "test_compensation",
		"target_users": ["local_user"],
		"items": [
			{"type": "points", "amount": 50, "source": "compensation"},
		],
		"expires_at": "2026-12-31T00:00:00Z",
	})
	if not bool(compensation_result.get("ok", false)) or bool(compensation_result.get("duplicate", true)) or int(results_service_model.wallet.get("points", 0)) != 300:
		push_error("Smoke test failed: compensation claim invalid")
		quit(1)
		return true
	var duplicate_compensation: Dictionary = main_node.call("_claim_compensation", {
		"compensation_id": "comp-smoke",
		"items": [
			{"type": "points", "amount": 50, "source": "compensation"},
		],
	})
	if not bool(duplicate_compensation.get("ok", false)) or not bool(duplicate_compensation.get("duplicate", false)) or int(results_service_model.wallet.get("points", 0)) != 300:
		push_error("Smoke test failed: compensation idempotency invalid")
		quit(1)
		return true
	var result_rows: Array[Dictionary] = main_node.call("_result_rows")
	if not _rows_have_ids(result_rows, ["result", "score_breakdown", "reward", "wallet", "tasks", "events", "leaderboards", "reward_audit", "idempotency", "save_replay", "retry"]):
		push_error("Smoke test failed: result rows incomplete")
		quit(1)
		return true
	if not _validate_row_label_keys(result_rows, localization):
		quit(1)
		return true
	if results_service_model.task_rows().is_empty() or results_service_model.event_rows().is_empty() or results_service_model.leaderboard_rows().is_empty():
		push_error("Smoke test failed: result task/event/leaderboard rows missing")
		quit(1)
		return true
	var task_claim_request: Dictionary = main_node.call("_request_activity_claim", "task", "daily_complete_match")
	if not bool(task_claim_request.get("ok", false)) or bool(task_claim_request.get("duplicate", true)) or bool(task_claim_request.get("request", {}).get("client_result_authoritative", true)):
		push_error("Smoke test failed: task claim request invalid")
		quit(1)
		return true
	var duplicate_task_claim: Dictionary = main_node.call("_request_activity_claim", "task", "daily_complete_match")
	if not bool(duplicate_task_claim.get("ok", false)) or not bool(duplicate_task_claim.get("duplicate", false)):
		push_error("Smoke test failed: duplicate task claim request invalid")
		quit(1)
		return true
	var incomplete_task_claim: Dictionary = main_node.call("_request_activity_claim", "task", "weekly_replay_review")
	if bool(incomplete_task_claim.get("ok", true)) or String(incomplete_task_claim.get("reason", "")) != "task_incomplete":
		push_error("Smoke test failed: incomplete task claim gate invalid")
		quit(1)
		return true
	var event_claim_request: Dictionary = main_node.call("_request_activity_claim", "event", "local_s0")
	if not bool(event_claim_request.get("ok", false)) or bool(event_claim_request.get("request", {}).get("client_result_authoritative", true)):
		push_error("Smoke test failed: event claim request invalid")
		quit(1)
		return true
	var leaderboard_claim_request: Dictionary = main_node.call("_request_activity_claim", "leaderboard", "single_score")
	if not bool(leaderboard_claim_request.get("ok", false)) or bool(leaderboard_claim_request.get("request", {}).get("client_result_authoritative", true)):
		push_error("Smoke test failed: leaderboard claim request invalid")
		quit(1)
		return true
	if int(results_service_model.wallet.get("points", 0)) != 300:
		push_error("Smoke test failed: activity claim request changed wallet without server settlement")
		quit(1)
		return true
	var task_claim_settlement: Dictionary = main_node.call("_apply_server_activity_claim_result", {
		"claim_kind": "task",
		"claim_id": "daily_complete_match",
		"user_id": "local_user",
		"server_authoritative": true,
		"reward_json": [
			{"type": "points", "amount": 25, "source": "task_claim"},
		],
		"claimed": true,
	})
	if not bool(task_claim_settlement.get("ok", false)) or bool(task_claim_settlement.get("duplicate", true)) or int(results_service_model.wallet.get("points", 0)) != 325:
		push_error("Smoke test failed: activity task claim settlement invalid")
		quit(1)
		return true
	if not bool(results_service_model.task_progress.get("daily_complete_match", {}).get("claimed", false)):
		push_error("Smoke test failed: activity task claim did not mark task claimed")
		quit(1)
		return true
	var duplicate_task_claim_settlement: Dictionary = main_node.call("_apply_server_activity_claim_result", {
		"claim_kind": "task",
		"claim_id": "daily_complete_match",
		"user_id": "local_user",
		"server_authoritative": true,
		"reward_json": [
			{"type": "points", "amount": 999, "source": "duplicate_task_claim"},
		],
		"claimed": true,
	})
	if not bool(duplicate_task_claim_settlement.get("ok", false)) or not bool(duplicate_task_claim_settlement.get("duplicate", false)) or int(results_service_model.wallet.get("points", 0)) != 325:
		push_error("Smoke test failed: duplicate activity task settlement was not idempotent")
		quit(1)
		return true
	var event_claim_settlement: Dictionary = main_node.call("_apply_server_activity_claim_result", {
		"claim_kind": "event",
		"claim_id": "local_s0",
		"user_id": "local_user",
		"server_authoritative": true,
		"reward_json": [
			{"type": "chest_keys", "amount": 1, "source": "event_claim"},
		],
		"reward_status": "claimed",
	})
	if not bool(event_claim_settlement.get("ok", false)) or int(results_service_model.wallet.get("chest_keys", 0)) != 2 or String(results_service_model.event_state.get("local_s0", {}).get("reward_status", "")) != "claimed":
		push_error("Smoke test failed: activity event claim settlement invalid")
		quit(1)
		return true
	var rejected_claim_settlement: Dictionary = main_node.call("_apply_server_activity_claim_result", {
		"claim_kind": "leaderboard",
		"claim_id": "single_score",
		"user_id": "local_user",
		"client_authored_reward": true,
		"reward_json": [],
	})
	if bool(rejected_claim_settlement.get("ok", true)) or String(rejected_claim_settlement.get("reason", "")) != "client_authored_reward":
		push_error("Smoke test failed: client-authored activity claim settlement was not rejected")
		quit(1)
		return true
	var activity_rows: Array[Dictionary] = main_node.call("_activity_rows")
	if not _rows_have_ids(activity_rows, ["activity_summary", "activity_social", "activity_promotions", "announce_architecture", "activity_task_daily_complete_match", "activity_event_local_s0", "activity_leaderboard_single_score", "activity_claim_log"]):
		push_error("Smoke test failed: activity rows incomplete")
		quit(1)
		return true
	if not _validate_row_label_keys(activity_rows, localization):
		quit(1)
		return true
	stage = "ui_screens"
	if ui_screen_model == null:
		push_error("Smoke test failed: UI screen model missing")
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "main_menu"):
		push_error("Smoke test failed: main menu screen did not open")
		quit(1)
		return true
	var main_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 24)
	if main_rows.size() != 4 or not _rows_have_ids(main_rows, ["play", "collection", "community", "player_settings"]):
		push_error("Smoke test failed: simplified main menu primary rows incomplete")
		quit(1)
		return true
	if JSON.stringify(main_rows).to_lower().contains("debug"):
		push_error("Smoke test failed: main menu leaked debug wording")
		quit(1)
		return true
	if not _rows_have_sections(main_rows, ["play", "collection", "community", "settings"]):
		push_error("Smoke test failed: main menu sections incomplete")
		quit(1)
		return true
	if not _rows_have_controls(main_rows, ["nav"]):
		push_error("Smoke test failed: main menu control metadata incomplete")
		quit(1)
		return true
	if not _validate_row_label_keys(main_rows, localization):
		quit(1)
		return true
	var overlay_snapshot: Dictionary = main_node.call("_ui_overlay_snapshot")
	if not bool(overlay_snapshot.get("visible", false)) or String(overlay_snapshot.get("screen", "")) != "main_menu" or not bool(overlay_snapshot.get("home_visible", false)) or bool(overlay_snapshot.get("secondary_visible", true)):
		push_error("Smoke test failed: UI home surface did not render")
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_kind", "")) != "home_lobby" or String(overlay_snapshot.get("layout_anchor", "")) != "full" or bool(overlay_snapshot.get("layout_show_gameplay", true)) or bool(overlay_snapshot.get("layout_advance_gameplay", true)):
		push_error("Smoke test failed: home page layout policy invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_density", "")) != "hero" or int(overlay_snapshot.get("page_primary_count", 0)) != 4 or not String(overlay_snapshot.get("page_primary_ids", "")).contains("collection") or not String(overlay_snapshot.get("page_primary_ids", "")).contains("player_settings") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("certification"):
		push_error("Smoke test failed: home page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_scene_id", "")) != "home_lobby" or not String(overlay_snapshot.get("layout_scene_path", "")).ends_with("home_lobby_view.tscn") or not String(overlay_snapshot.get("page_required_bindings", "")).contains("PortraitPanel"):
		push_error("Smoke test failed: home scene contract invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not bool(overlay_snapshot.get("layout_scene_backed", false)) or int(overlay_snapshot.get("layout_scene_bound_count", 0)) < 6 or not String(overlay_snapshot.get("layout_scene_missing_bindings", "")).is_empty():
		push_error("Smoke test failed: home scene did not back runtime UI %s" % [overlay_snapshot])
		quit(1)
		return true
	if bool(overlay_snapshot.get("gameplay_visible", true)) or bool(overlay_snapshot.get("hud_visible", true)):
		push_error("Smoke test failed: home screen should hide gameplay scene and HUD")
		quit(1)
		return true
	if int(overlay_snapshot.get("home_buttons", 0)) != 4 or not String(overlay_snapshot.get("home_buttons_text", "")).contains("Play") or not String(overlay_snapshot.get("home_buttons_text", "")).contains("Collection") or not String(overlay_snapshot.get("home_buttons_text", "")).contains("Community") or not String(overlay_snapshot.get("home_buttons_text", "")).contains("Player Settings") or String(overlay_snapshot.get("home_buttons_text", "")).contains("Certification") or String(overlay_snapshot.get("home_buttons_text", "")).contains("Replay"):
		push_error("Smoke test failed: home primary menu buttons missing")
		quit(1)
		return true
	var home_dashboard_text := String(overlay_snapshot.get("home_dashboard_text", ""))
	if int(overlay_snapshot.get("home_dashboard_cards", 0)) != 0 or not home_dashboard_text.is_empty():
		push_error("Smoke test failed: simplified home dashboard should be hidden %s" % home_dashboard_text)
		quit(1)
		return true
	if int(overlay_snapshot.get("nav_buttons", 0)) != 0 or int(overlay_snapshot.get("row_buttons", 0)) != 0 or int(overlay_snapshot.get("section_buttons", 0)) != 0 or int(overlay_snapshot.get("category_buttons", 0)) != 0:
		push_error("Smoke test failed: secondary menu controls should be hidden on home")
		quit(1)
		return true
	var home_status_text := String(overlay_snapshot.get("home_status", ""))
	var active_deck_name := String(deck_builder.active_deck_snapshot().get("name", ""))
	if not home_status_text.contains(String(matchmaking_model.selected_mode_id)) or not home_status_text.contains(String(matchmaking_model.queue_status)) or not home_status_text.contains("friends") or not home_status_text.contains(active_deck_name):
		push_error("Smoke test failed: home status summary invalid %s" % home_status_text)
		quit(1)
		return true
	var home_portrait_size: Vector2 = overlay_snapshot.get("home_portrait_size", Vector2.ZERO)
	var panel_size: Vector2 = overlay_snapshot.get("panel_size", Vector2.ZERO)
	if not bool(overlay_snapshot.get("home_portrait_visible", false)) or home_portrait_size.x < 240.0 or home_portrait_size.y < 260.0 or panel_size.x < 560.0 or panel_size.y < 420.0:
		push_error("Smoke test failed: home portrait/adaptive panel size invalid %s %s" % [home_portrait_size, panel_size])
		quit(1)
		return true
	if not _validate_home_layout_snapshot(overlay_snapshot, Vector2(1280, 720), false):
		quit(1)
		return true
	var wide_home_snapshot: Dictionary = main_node.call("_set_test_viewport_size", Vector2(1920, 1080))
	if not _validate_home_layout_snapshot(wide_home_snapshot, Vector2(1920, 1080), false):
		quit(1)
		return true
	var narrow_home_snapshot: Dictionary = main_node.call("_set_test_viewport_size", Vector2(640, 720))
	if not _validate_home_layout_snapshot(narrow_home_snapshot, Vector2(640, 720), true):
		quit(1)
		return true
	overlay_snapshot = main_node.call("_set_test_viewport_size", Vector2(1280, 720))
	var home_dashboard_notice_result: Dictionary = main_node.call("_ui_press_visible_home_dashboard", 2)
	if bool(home_dashboard_notice_result.get("ok", false)) or String(home_dashboard_notice_result.get("action", "")) != "home_dashboard_hidden":
		push_error("Smoke test failed: simplified home dashboard remained clickable %s" % [home_dashboard_notice_result])
		quit(1)
		return true
	main_node.call("_open_ui_screen", "main_menu")
	var compact_dashboard_snapshot: Dictionary = main_node.call("_set_test_viewport_size", Vector2(640, 720))
	var compact_dashboard_result: Dictionary = main_node.call("_ui_press_visible_home_dashboard", 2)
	if bool(compact_dashboard_result.get("ok", false)) or String(compact_dashboard_result.get("action", "")) != "home_dashboard_hidden":
		push_error("Smoke test failed: compact home dashboard remained clickable %s" % [compact_dashboard_snapshot])
		quit(1)
		return true
	main_node.call("_open_ui_screen", "main_menu")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var hidden_category_result: Dictionary = main_node.call("_ui_press_visible_category", 1)
	if bool(hidden_category_result.get("ok", false)) or String(hidden_category_result.get("action", "")) != "category_button_hidden":
		push_error("Smoke test failed: hidden home category tab remained clickable")
		quit(1)
		return true
	var home_settings_result: Dictionary = main_node.call("_ui_press_visible_home_button", 3)
	if not bool(home_settings_result.get("ok", false)) or String(home_settings_result.get("row_id", "")) != "player_settings" or String(home_settings_result.get("screen", "")) != "player_settings" or String(ui_screen_model.current_screen) != "player_settings":
		push_error("Smoke test failed: home settings button did not open player settings")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if bool(overlay_snapshot.get("home_visible", true)) or not bool(overlay_snapshot.get("secondary_visible", false)) or int(overlay_snapshot.get("nav_buttons", 0)) < 8 or int(overlay_snapshot.get("row_buttons", 0)) <= 0 or int(overlay_snapshot.get("section_buttons", 0)) < 4:
		push_error("Smoke test failed: secondary menu did not render after home button")
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_kind", "")) != "settings" and String(overlay_snapshot.get("layout_kind", "")) != "hub":
		push_error("Smoke test failed: player settings layout kind invalid %s" % String(overlay_snapshot.get("layout_kind", "")))
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_anchor", "")) != "full" or bool(overlay_snapshot.get("gameplay_visible", true)) or bool(overlay_snapshot.get("layout_advance_gameplay", true)):
		push_error("Smoke test failed: player settings page should be a full menu without gameplay %s" % [overlay_snapshot])
		quit(1)
		return true
	if not String(overlay_snapshot.get("nav_text", "")).contains("> Player Settings") or not String(overlay_snapshot.get("shell", "")).contains("Client:") or not String(overlay_snapshot.get("shell", "")).contains("settings") or not String(overlay_snapshot.get("shell", "")).contains("deck"):
		push_error("Smoke test failed: secondary menu shell/nav invalid")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "main_menu")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var home_collection_result: Dictionary = main_node.call("_ui_press_visible_home_button", 1)
	if not bool(home_collection_result.get("ok", false)) or String(home_collection_result.get("row_id", "")) != "collection" or String(ui_screen_model.current_screen) != "collection":
		push_error("Smoke test failed: home collection button did not open collection")
		quit(1)
		return true
	var collection_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	if not _rows_have_ids(collection_rows, ["collection_summary", "collection_deck", "collection_chest", "collection_replay"]) or not _validate_row_label_keys(collection_rows, localization):
		push_error("Smoke test failed: collection hub rows invalid")
		quit(1)
		return true
	if not String(main_node.call("_ui_overlay_snapshot").get("page_task_groups", "")).contains("deck") or not String(main_node.call("_ui_overlay_snapshot").get("page_task_groups", "")).contains("replay"):
		push_error("Smoke test failed: collection page task groups invalid")
		quit(1)
		return true
	var collection_replay_cursor: int = _row_index_by_id(collection_rows, "collection_replay")
	main_node.call("_ui_set_cursor", collection_replay_cursor)
	var collection_replay_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(collection_replay_result.get("ok", false)) or String(collection_replay_result.get("screen", "")) != "replay" or String(ui_screen_model.current_screen) != "replay":
		push_error("Smoke test failed: collection replay navigation invalid")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "main_menu")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var home_community_result: Dictionary = main_node.call("_ui_press_visible_home_button", 2)
	if not bool(home_community_result.get("ok", false)) or String(home_community_result.get("row_id", "")) != "community" or String(ui_screen_model.current_screen) != "community":
		push_error("Smoke test failed: home community button did not open community")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("layout_kind", "")) != "hub" or String(overlay_snapshot.get("layout_category", "")) != "community" or bool(overlay_snapshot.get("gameplay_visible", true)):
		push_error("Smoke test failed: community page layout policy invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	var status_collection_result: Dictionary = main_node.call("_ui_press_visible_status_card", 1)
	if not bool(status_collection_result.get("ok", false)) or String(status_collection_result.get("status_id", "")) != "status_collection" or String(status_collection_result.get("screen", "")) != "collection" or String(ui_screen_model.current_screen) != "collection":
		push_error("Smoke test failed: collection status card did not open collection")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "community")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var status_community_result: Dictionary = main_node.call("_ui_press_visible_status_card", 2)
	if not bool(status_community_result.get("ok", false)) or String(status_community_result.get("status_id", "")) != "status_community" or String(status_community_result.get("screen", "")) != "community" or String(ui_screen_model.current_screen) != "community":
		push_error("Smoke test failed: community status card did not open community")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "community")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var status_settings_result: Dictionary = main_node.call("_ui_press_visible_status_card", 3)
	if not bool(status_settings_result.get("ok", false)) or String(status_settings_result.get("status_id", "")) != "status_settings" or String(status_settings_result.get("screen", "")) != "player_settings" or String(ui_screen_model.current_screen) != "player_settings":
		push_error("Smoke test failed: settings status card did not open player settings")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "main_menu")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var hidden_focus_result: Dictionary = main_node.call("_ui_press_visible_focus_action")
	if bool(hidden_focus_result.get("ok", false)) or String(hidden_focus_result.get("action", "")) != "focus_action_hidden":
		push_error("Smoke test failed: hidden home focus action remained clickable")
		quit(1)
		return true
	var home_play_result: Dictionary = main_node.call("_ui_press_visible_home_button", 0)
	if not bool(home_play_result.get("ok", false)) or String(home_play_result.get("row_id", "")) != "play" or String(ui_screen_model.current_screen) != "play":
		push_error("Smoke test failed: home play button did not open play")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("layout_kind", "")) != "hub" or String(overlay_snapshot.get("layout_anchor", "")) != "full" or bool(overlay_snapshot.get("gameplay_visible", true)) or bool(overlay_snapshot.get("layout_advance_gameplay", true)):
		push_error("Smoke test failed: play hub layout policy invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_density", "")) != "hub" or not String(overlay_snapshot.get("page_primary_ids", "")).contains("play_pvp_duel") or not String(overlay_snapshot.get("page_primary_ids", "")).contains("play_world_boss") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("play_battle_royale") or not String(overlay_snapshot.get("page_mode_groups", "")).contains("room"):
		push_error("Smoke test failed: play hub page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_task_groups", "")).contains("matchmaking") or not String(overlay_snapshot.get("page_task_groups", "")).contains("pvp") or not String(overlay_snapshot.get("page_task_groups", "")).contains("boss") or not String(overlay_snapshot.get("page_experience_text", "")).contains("Matchmaking") or String(overlay_snapshot.get("page_experience_text", "")).contains("Primary:") or String(overlay_snapshot.get("page_experience_text", "")).contains("Tasks:"):
		push_error("Smoke test failed: play hub page experience summary invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_scene_id", "")) != "menu_hub" or not String(overlay_snapshot.get("page_required_bindings", "")).contains("OverviewCards"):
		push_error("Smoke test failed: play hub scene contract invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not _validate_runtime_scene_backed(overlay_snapshot, "menu_hub", 9):
		quit(1)
		return true
	if int(overlay_snapshot.get("category_buttons", 0)) < 4 or not String(overlay_snapshot.get("category_tabs_text", "")).contains("Play") or not String(overlay_snapshot.get("category_tabs_text", "")).contains("Collection") or not String(overlay_snapshot.get("category_tabs_text", "")).contains("Community") or not String(overlay_snapshot.get("category_tabs_text", "")).contains("Settings"):
		push_error("Smoke test failed: secondary category tabs missing")
		quit(1)
		return true
	if int(overlay_snapshot.get("status_cards", 0)) != 4 or not String(overlay_snapshot.get("status_cards_text", "")).contains("Play") or not String(overlay_snapshot.get("status_cards_text", "")).contains("Collection") or not String(overlay_snapshot.get("status_cards_text", "")).contains("Community") or not String(overlay_snapshot.get("status_cards_text", "")).contains("Settings") or String(overlay_snapshot.get("status_cards_text", "")).contains("Certification") or String(overlay_snapshot.get("status_cards_text", "")).contains("Activity") or String(overlay_snapshot.get("status_cards_text", "")).contains("Promo"):
		push_error("Smoke test failed: secondary status cards missing")
		quit(1)
		return true
	var status_cards_text := String(overlay_snapshot.get("status_cards_text", ""))
	if not status_cards_text.contains(String(matchmaking_model.selected_mode_id)) or not status_cards_text.contains(String(matchmaking_model.queue_status)) or not status_cards_text.contains("friends") or not status_cards_text.contains("links") or not status_cards_text.contains(active_deck_name):
		push_error("Smoke test failed: secondary status card summaries invalid %s" % status_cards_text)
		quit(1)
		return true
	if not String(overlay_snapshot.get("nav_text", "")).contains("> Play") or not String(overlay_snapshot.get("nav_text", "")).contains("Home") or not String(overlay_snapshot.get("nav_text", "")).contains("Certification"):
		push_error("Smoke test failed: secondary nav rail invalid")
		quit(1)
		return true
	if not String(overlay_snapshot.get("nav", "")).contains("Play / Play") or not String(overlay_snapshot.get("section_summary", "")).contains("Section:") or not String(overlay_snapshot.get("control_preview", "")).contains(":") or not String(overlay_snapshot.get("controls", "")).contains("Page"):
		push_error("Smoke test failed: secondary navigation/control shell invalid")
		quit(1)
		return true
	if int(overlay_snapshot.get("focus_buttons", 0)) < 1 or String(overlay_snapshot.get("focus_action", "")) != "play_matchmaking" or not String(overlay_snapshot.get("focus_panel", "")).contains("Play Hub"):
		push_error("Smoke test failed: play hub focus panel invalid")
		quit(1)
		return true
	if String(overlay_snapshot.get("focus_action", "")) != "play_matchmaking" or not String(overlay_snapshot.get("focus_panel", "")).contains("Play Hub") or not String(overlay_snapshot.get("focus_panel", "")).contains(String(matchmaking_model.selected_mode_id)):
		push_error("Smoke test failed: play hub focus panel invalid")
		quit(1)
		return true
	var play_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 24)
	if not _rows_have_ids(play_rows, ["play_summary", "play_certification_hub", "play_practice", "play_matchmaking", "play_room", "play_certification", "play_pvp_duel", "play_battle_royale", "play_world_boss", "play_instance_boss", "play_queue_selected", "play_deck"]) or not _validate_row_label_keys(play_rows, localization):
		push_error("Smoke test failed: play hub rows invalid")
		quit(1)
		return true
	if not _rows_have_sections(play_rows, ["overview", "local_play", "online_play", "pvp", "boss", "modes", "loadout"]):
		push_error("Smoke test failed: play hub sections invalid")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if int(overlay_snapshot.get("quick_buttons", 0)) != 1 or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Home") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Start Match") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Network Match"):
		push_error("Smoke test failed: play hub quick actions invalid")
		quit(1)
		return true
	if int(overlay_snapshot.get("overview_cards", 0)) != 4 or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Practice") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Matchmaking") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("PvP Duel") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("World Boss") or String(overlay_snapshot.get("overview_cards_text", "")).contains("Room") or String(overlay_snapshot.get("overview_cards_text", "")).contains("Deck"):
		push_error("Smoke test failed: play hub overview cards invalid")
		quit(1)
		return true
	var play_focus_match_result: Dictionary = main_node.call("_ui_press_visible_focus_action")
	if not bool(play_focus_match_result.get("ok", false)) or String(play_focus_match_result.get("row_id", "")) != "play_matchmaking" or String(ui_screen_model.current_screen) != "match":
		push_error("Smoke test failed: play hub focus action did not open matchmaking")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("layout_kind", "")) != "matchmaking" or String(overlay_snapshot.get("layout_anchor", "")) != "center" or bool(overlay_snapshot.get("gameplay_visible", true)) or bool(overlay_snapshot.get("layout_advance_gameplay", true)):
		push_error("Smoke test failed: matchmaking page layout policy invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_density", "")) != "focused" or not String(overlay_snapshot.get("page_mode_groups", "")).contains("ranked") or not String(overlay_snapshot.get("page_mode_groups", "")).contains("boss") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("network_quality"):
		push_error("Smoke test failed: matchmaking page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_task_groups", "")).contains("quick") or not String(overlay_snapshot.get("page_task_groups", "")).contains("ranked") or not String(overlay_snapshot.get("page_task_groups", "")).contains("queue") or not String(overlay_snapshot.get("page_experience_text", "")).contains("Quick Match"):
		push_error("Smoke test failed: matchmaking page experience summary invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_scene_id", "")) != "matchmaking_panel" or not String(overlay_snapshot.get("page_required_bindings", "")).contains("ModeCards"):
		push_error("Smoke test failed: matchmaking scene contract invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not _validate_runtime_scene_backed(overlay_snapshot, "matchmaking_panel", 8):
		quit(1)
		return true
	var matchmaking_ui_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(matchmaking_ui_rows, ["matchmaking_quick", "matchmaking_ranked", "matchmaking_pvp", "matchmaking_boss", "matchmaking_room", "selected_mode", "queue_status"]) or not _validate_row_label_keys(matchmaking_ui_rows, localization):
		push_error("Smoke test failed: matchmaking UI rows invalid")
		quit(1)
		return true
	if not _row_has_control(matchmaking_ui_rows, "matchmaking_ranked", "queue") or not _row_has_control(matchmaking_ui_rows, "matchmaking_pvp", "queue") or not _row_has_control(matchmaking_ui_rows, "matchmaking_boss", "queue"):
		push_error("Smoke test failed: matchmaking mode cards should be queue controls")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if int(overlay_snapshot.get("overview_cards", 0)) != 4 or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Quick Match") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Ranked") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("PvP Duel") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Boss Party") or String(overlay_snapshot.get("overview_cards_text", "")).contains("Room Code"):
		push_error("Smoke test failed: matchmaking mode cards invalid")
		quit(1)
		return true
	matchmaking_model.cancel_queue()
	main_node.call("_open_ui_screen", "match")
	matchmaking_ui_rows = main_node.call("_ui_screen_rows", 32)
	var ranked_cursor: int = _row_index_by_id(matchmaking_ui_rows, "matchmaking_ranked")
	main_node.call("_ui_set_cursor", ranked_cursor)
	var ranked_queue_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(ranked_queue_result.get("ok", false)) or String(ranked_queue_result.get("action", "")) != "queue_mode" or String(matchmaking_model.selected_mode_id) != "certification" or String(matchmaking_model.queue_mode_id) != "certification" or String(matchmaking_model.queue_status) != "queued":
		push_error("Smoke test failed: ranked matchmaking card did not queue certification")
		quit(1)
		return true
	matchmaking_model.cancel_queue()
	main_node.call("_open_ui_screen", "match")
	matchmaking_ui_rows = main_node.call("_ui_screen_rows", 32)
	var pvp_cursor: int = _row_index_by_id(matchmaking_ui_rows, "matchmaking_pvp")
	main_node.call("_ui_set_cursor", pvp_cursor)
	var pvp_queue_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(pvp_queue_result.get("ok", false)) or String(pvp_queue_result.get("action", "")) != "queue_mode" or String(matchmaking_model.selected_mode_id) != "pvp_duel" or String(matchmaking_model.queue_mode_id) != "pvp_duel" or String(matchmaking_model.queue_status) != "queued":
		push_error("Smoke test failed: PvP matchmaking card did not queue pvp_duel")
		quit(1)
		return true
	matchmaking_model.cancel_queue()
	main_node.call("_open_ui_screen", "match")
	matchmaking_ui_rows = main_node.call("_ui_screen_rows", 32)
	var boss_cursor: int = _row_index_by_id(matchmaking_ui_rows, "matchmaking_boss")
	main_node.call("_ui_set_cursor", boss_cursor)
	var boss_queue_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(boss_queue_result.get("ok", false)) or String(boss_queue_result.get("action", "")) != "queue_mode" or String(matchmaking_model.selected_mode_id) != "world_boss" or String(matchmaking_model.queue_mode_id) != "world_boss" or String(matchmaking_model.queue_status) != "queued":
		push_error("Smoke test failed: Boss matchmaking card did not queue world_boss")
		quit(1)
		return true
	matchmaking_model.cancel_queue()
	main_node.call("_open_ui_screen", "play")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var play_overview_match_result: Dictionary = main_node.call("_ui_press_visible_overview_card", 1)
	if not bool(play_overview_match_result.get("ok", false)) or String(play_overview_match_result.get("row_id", "")) != "play_matchmaking" or String(ui_screen_model.current_screen) != "match":
		push_error("Smoke test failed: play overview card did not open matchmaking")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "play")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var quick_home_result: Dictionary = main_node.call("_ui_press_visible_quick_action", 0)
	if not bool(quick_home_result.get("ok", false)) or String(quick_home_result.get("row_id", "")) != "nav_home" or String(quick_home_result.get("screen", "")) != "main_menu" or String(ui_screen_model.current_screen) != "main_menu":
		push_error("Smoke test failed: play hub home quick action invalid")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "practice")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("layout_kind", "")) != "playfield" or String(overlay_snapshot.get("layout_anchor", "")) != "right" or not bool(overlay_snapshot.get("gameplay_visible", false)) or not bool(overlay_snapshot.get("layout_advance_gameplay", false)):
		push_error("Smoke test failed: practice page layout policy invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_density", "")) != "playfield" or not String(overlay_snapshot.get("page_setting_groups", "")).contains("stage") or not String(overlay_snapshot.get("page_setting_groups", "")).contains("analysis"):
		push_error("Smoke test failed: practice page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_scene_id", "")) != "playfield_overlay" or not String(overlay_snapshot.get("page_required_bindings", "")).contains("GameplayHUDSlot"):
		push_error("Smoke test failed: practice scene contract invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not _validate_runtime_scene_backed(overlay_snapshot, "playfield_overlay", 6):
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "certification") or String(ui_screen_model.current_screen) != "certification":
		push_error("Smoke test failed: certification screen did not open")
		quit(1)
		return true
	var certification_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 24)
	if not _rows_have_ids(certification_rows, ["cert_summary", "cert_queue", "cert_practice", "cert_deck", "cert_rules", "cert_rating", "cert_rank", "cert_stage"]) or not _validate_row_label_keys(certification_rows, localization):
		push_error("Smoke test failed: certification hub rows invalid")
		quit(1)
		return true
	if not _rows_have_sections(certification_rows, ["overview", "queue", "practice", "loadout", "rules", "progress"]):
		push_error("Smoke test failed: certification hub sections invalid")
		quit(1)
		return true
	if not _row_has_control(certification_rows, "cert_queue", "queue") or not _row_has_control(certification_rows, "cert_practice", "nav"):
		push_error("Smoke test failed: certification hub control metadata invalid")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("focus_action", "")) != "cert_queue" or not String(overlay_snapshot.get("focus_panel", "")).contains("Certification") or not String(overlay_snapshot.get("focus_panel", "")).contains("stage"):
		push_error("Smoke test failed: certification focus panel invalid")
		quit(1)
		return true
	if int(overlay_snapshot.get("quick_buttons", 0)) != 1 or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Home") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Start Certification") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Certification Drill") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Active Deck"):
		push_error("Smoke test failed: certification quick actions invalid")
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_density", "")) != "hub" or not String(overlay_snapshot.get("page_mode_groups", "")).contains("certification") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("cert_top30"):
		push_error("Smoke test failed: certification page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if int(overlay_snapshot.get("overview_cards", 0)) < 4 or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Start Certification") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Certification Drill") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Active Deck") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Certification Rules"):
		push_error("Smoke test failed: certification hub overview cards invalid")
		quit(1)
		return true
	var cert_overview_practice_result: Dictionary = main_node.call("_ui_press_visible_overview_card", 1)
	if not bool(cert_overview_practice_result.get("ok", false)) or String(cert_overview_practice_result.get("row_id", "")) != "cert_practice" or String(ui_screen_model.current_screen) != "practice":
		push_error("Smoke test failed: certification overview card did not open practice")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "certification")
	certification_rows = main_node.call("_ui_screen_rows", 24)
	var cert_queue_cursor: int = _row_index_by_id(certification_rows, "cert_queue")
	main_node.call("_ui_set_cursor", cert_queue_cursor)
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(overlay_snapshot.get("detail", "")).contains("action Start Certification") or not String(overlay_snapshot.get("hint", "")).contains("Enter runs Start Certification") or String(overlay_snapshot.get("selected_control", "")) != "Queue":
		push_error("Smoke test failed: certification queue detail/hint invalid")
		quit(1)
		return true
	matchmaking_model.cancel_queue()
	var accept_cert_queue: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_cert_queue.get("ok", false)) or String(accept_cert_queue.get("action", "")) != "start_certification_queue" or String(matchmaking_model.queue_status) != "queued" or String(matchmaking_model.selected_mode_id) != "certification":
		push_error("Smoke test failed: certification queue action invalid")
		quit(1)
		return true
	matchmaking_model.cancel_queue()
	main_node.call("_open_ui_screen", "community")
	var community_entry_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 24)
	var events_cursor: int = _row_index_by_id(community_entry_rows, "community_events")
	main_node.call("_ui_set_cursor", events_cursor)
	var accept_events: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_events.get("ok", false)) or String(accept_events.get("action", "")) != "open_screen" or String(accept_events.get("screen", "")) != "activity":
		push_error("Smoke test failed: UI community events screen accept invalid")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "main_menu")
	main_rows = main_node.call("_ui_screen_rows", 24)
	var community_cursor: int = _row_index_by_id(main_rows, "community")
	main_node.call("_ui_set_cursor", community_cursor)
	var accept_community: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_community.get("ok", false)) or String(accept_community.get("screen", "")) != "community":
		push_error("Smoke test failed: UI community hub accept invalid")
		quit(1)
		return true
	var community_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 24)
	if not _rows_have_ids(community_rows, ["community_summary", "community_events", "community_friends", "community_social", "community_promotions", "community_workshop", "announce_architecture", "link_discord"]) or not _validate_row_label_keys(community_rows, localization):
		push_error("Smoke test failed: community hub rows invalid")
		quit(1)
		return true
	var announcement_row: Dictionary = _find_row_by_id(community_rows, "announce_architecture")
	var discord_link_row: Dictionary = _find_row_by_id(community_rows, "link_discord")
	if String(announcement_row.get("cta", "")).is_empty() or not String(announcement_row.get("summary", "")).contains("Read plan") or String(discord_link_row.get("channel", "")) != "community":
		push_error("Smoke test failed: community announcement/link metadata invalid")
		quit(1)
		return true
	if not _rows_have_sections(community_rows, ["overview", "community", "announcements", "links"]):
		push_error("Smoke test failed: community hub sections invalid")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("focus_action", "")) != "community_events" or not String(overlay_snapshot.get("focus_panel", "")).contains("Community") or not String(overlay_snapshot.get("focus_panel", "")).contains("friends"):
		push_error("Smoke test failed: community focus panel invalid")
		quit(1)
		return true
	if int(overlay_snapshot.get("quick_buttons", 0)) != 1 or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Home") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Events") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Friends") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Promotions"):
		push_error("Smoke test failed: community quick actions invalid")
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_density", "")) != "hub" or not String(overlay_snapshot.get("page_social_groups", "")).contains("activity") or not String(overlay_snapshot.get("page_social_groups", "")).contains("promotions") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("community_workshop"):
		push_error("Smoke test failed: community page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_task_groups", "")).contains("activity") or not String(overlay_snapshot.get("page_task_groups", "")).contains("friends") or not String(overlay_snapshot.get("page_task_groups", "")).contains("promotions") or not String(overlay_snapshot.get("page_experience_text", "")).contains("Community"):
		push_error("Smoke test failed: community page experience summary invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_scene_id", "")) != "community_panel" or not String(overlay_snapshot.get("page_required_bindings", "")).contains("SocialTabs"):
		push_error("Smoke test failed: community scene contract invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not _validate_runtime_scene_backed(overlay_snapshot, "community_panel", 9):
		quit(1)
		return true
	if int(overlay_snapshot.get("overview_cards", 0)) < 4 or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Events") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Friends") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Social") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Promotions"):
		push_error("Smoke test failed: community hub overview cards invalid")
		quit(1)
		return true
	var community_focus_events_result: Dictionary = main_node.call("_ui_press_visible_focus_action")
	if not bool(community_focus_events_result.get("ok", false)) or String(community_focus_events_result.get("row_id", "")) != "community_events" or String(ui_screen_model.current_screen) != "activity":
		push_error("Smoke test failed: community focus action did not open activity")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if int(overlay_snapshot.get("quick_buttons", 0)) > 2 or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Community") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Announcement") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Daily Match"):
		push_error("Smoke test failed: activity quick actions invalid")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "community")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var community_overview_social_result: Dictionary = main_node.call("_ui_press_visible_overview_card", 2)
	if not bool(community_overview_social_result.get("ok", false)) or String(community_overview_social_result.get("row_id", "")) != "community_social" or String(ui_screen_model.current_screen) != "social":
		push_error("Smoke test failed: community overview card did not open social")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "community")
	if not main_node.call("_open_ui_screen", "friends"):
		push_error("Smoke test failed: friends screen did not open")
		quit(1)
		return true
	var friends_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	if not _rows_have_ids(friends_rows, ["friends_summary", "friends_social", "friends_promotions", "friend_lumen", "friend_rin"]) or not _validate_row_label_keys(friends_rows, localization):
		push_error("Smoke test failed: friends screen rows incomplete")
		quit(1)
		return true
	var friend_lumen_row: Dictionary = _find_row_by_id(friends_rows, "friend_lumen")
	if String(friend_lumen_row.get("presence", "")).is_empty() or int(friend_lumen_row.get("party_size", 0)) <= 0 or not String(friend_lumen_row.get("summary", "")).contains("party"):
		push_error("Smoke test failed: friends screen presence metadata incomplete")
		quit(1)
		return true
	if not _rows_have_sections(friends_rows, ["overview", "friends"]):
		push_error("Smoke test failed: friends screen sections incomplete")
		quit(1)
		return true
	if not _row_has_control(friends_rows, "friends_social", "nav") or not _row_has_control(friends_rows, "friend_lumen", "friend"):
		push_error("Smoke test failed: friends screen control metadata incomplete")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("focus_action", "")) != "friend_lumen" or not String(overlay_snapshot.get("focus_panel", "")).contains("Friends"):
		push_error("Smoke test failed: friends focus panel invalid")
		quit(1)
		return true
	if int(overlay_snapshot.get("quick_buttons", 0)) > 2 or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Community") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Lumen"):
		push_error("Smoke test failed: friends quick actions invalid")
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_social_groups", "")).contains("presence") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("friends_promotions"):
		push_error("Smoke test failed: friends page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	var friends_social_cursor: int = _row_index_by_id(friends_rows, "friends_social")
	main_node.call("_ui_set_cursor", friends_social_cursor)
	var accept_friends_social: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_friends_social.get("ok", false)) or String(accept_friends_social.get("screen", "")) != "social" or String(ui_screen_model.current_screen) != "social":
		push_error("Smoke test failed: friends social navigation invalid")
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "promotions"):
		push_error("Smoke test failed: promotions screen did not open")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(overlay_snapshot.get("nav_text", "")).contains("> Promotions"):
		push_error("Smoke test failed: UI overlay nav rail did not follow promotions screen")
		quit(1)
		return true
	var promotion_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	if not _rows_have_ids(promotion_rows, ["promotions_summary", "promotions_social", "promotions_friends", "link_steam", "link_creator_program"]) or not _validate_row_label_keys(promotion_rows, localization):
		push_error("Smoke test failed: promotions screen rows incomplete")
		quit(1)
		return true
	var steam_link_row: Dictionary = _find_row_by_id(promotion_rows, "link_steam")
	var creator_link_row: Dictionary = _find_row_by_id(promotion_rows, "link_creator_program")
	if String(steam_link_row.get("channel", "")) != "store" or String(creator_link_row.get("channel", "")) != "creator" or String(creator_link_row.get("description", "")).is_empty():
		push_error("Smoke test failed: promotions channel metadata incomplete")
		quit(1)
		return true
	if not _rows_have_sections(promotion_rows, ["overview", "promotions"]):
		push_error("Smoke test failed: promotions screen sections incomplete")
		quit(1)
		return true
	if not _row_has_control(promotion_rows, "promotions_social", "nav") or not _row_has_control(promotion_rows, "link_steam", "link") or not _row_has_control(promotion_rows, "link_creator_program", "link"):
		push_error("Smoke test failed: promotions screen control metadata incomplete")
		quit(1)
		return true
	if String(overlay_snapshot.get("focus_action", "")) != "link_steam" or not String(overlay_snapshot.get("focus_panel", "")).contains("Promotions"):
		push_error("Smoke test failed: promotions focus panel invalid")
		quit(1)
		return true
	if int(overlay_snapshot.get("quick_buttons", 0)) > 2 or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Community") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Steam"):
		push_error("Smoke test failed: promotions quick actions invalid")
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_social_groups", "")).contains("creator") or not String(overlay_snapshot.get("page_social_groups", "")).contains("store") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("promotions_friends"):
		push_error("Smoke test failed: promotions page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	var promotions_friends_cursor: int = _row_index_by_id(promotion_rows, "promotions_friends")
	main_node.call("_ui_set_cursor", promotions_friends_cursor)
	var accept_promotions_friends: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_promotions_friends.get("ok", false)) or String(accept_promotions_friends.get("screen", "")) != "friends" or String(ui_screen_model.current_screen) != "friends":
		push_error("Smoke test failed: promotions friends navigation invalid")
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "social"):
		push_error("Smoke test failed: social screen did not open")
		quit(1)
		return true
	var social_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(social_rows, ["social_summary", "announce_architecture", "friend_lumen", "link_discord", "link_steam"]) or not _validate_row_label_keys(social_rows, localization):
		push_error("Smoke test failed: social screen rows incomplete")
		quit(1)
		return true
	if not _rows_have_sections(social_rows, ["overview", "announcements", "friends", "links"]):
		push_error("Smoke test failed: social screen sections incomplete")
		quit(1)
		return true
	if not _rows_have_controls(social_rows, ["status", "button", "friend", "link"]):
		push_error("Smoke test failed: social screen control metadata incomplete")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("focus_action", "")) != "link_discord" or not String(overlay_snapshot.get("focus_panel", "")).contains("Social"):
		push_error("Smoke test failed: social focus panel invalid")
		quit(1)
		return true
	if int(overlay_snapshot.get("quick_buttons", 0)) > 2 or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Community") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Discord"):
		push_error("Smoke test failed: social quick actions invalid")
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_social_groups", "")).contains("social_media") or not String(overlay_snapshot.get("page_social_groups", "")).contains("promotion_links"):
		push_error("Smoke test failed: social page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	var announce_cursor: int = _row_index_by_id(social_rows, "announce_architecture")
	main_node.call("_ui_set_cursor", announce_cursor)
	var unread_before: int = int(social_hub_model.unread_count())
	var accept_announcement: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_announcement.get("ok", false)) or String(accept_announcement.get("action", "")) != "dismiss_announcement" or int(social_hub_model.unread_count()) >= unread_before:
		push_error("Smoke test failed: UI announcement dismiss invalid")
		quit(1)
		return true
	social_rows = main_node.call("_ui_screen_rows", 32)
	var friend_cursor: int = _row_index_by_id(social_rows, "friend_lumen")
	main_node.call("_ui_set_cursor", friend_cursor)
	var accept_friend: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_friend.get("ok", false)) or String(accept_friend.get("action", "")) != "invite_friend" or bool(accept_friend.get("authoritative", true)):
		push_error("Smoke test failed: UI friend invite invalid")
		quit(1)
		return true
	var link_cursor: int = _row_index_by_id(social_rows, "link_steam")
	main_node.call("_ui_set_cursor", link_cursor)
	var accept_link: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_link.get("ok", false)) or String(accept_link.get("action", "")) != "open_social_link" or not String(accept_link.get("url", "")).contains("steam"):
		push_error("Smoke test failed: UI social link invalid")
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "main_menu"):
		push_error("Smoke test failed: main menu did not reopen before player settings")
		quit(1)
		return true
	main_rows = main_node.call("_ui_screen_rows", 24)
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if not bool(overlay_snapshot.get("home_visible", false)) or int(overlay_snapshot.get("nonempty_rows", 0)) != 0 or not String(overlay_snapshot.get("home_buttons_text", "")).contains("Player Settings"):
		push_error("Smoke test failed: home player settings entry not visible")
		quit(1)
		return true
	var accept_player_settings: Dictionary = main_node.call("_ui_press_visible_home_button", 3)
	if not bool(accept_player_settings.get("ok", false)) or String(accept_player_settings.get("screen", "")) != "player_settings":
		push_error("Smoke test failed: home player settings accept invalid")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(overlay_snapshot.get("nav_text", "")).contains("> Player Settings"):
		push_error("Smoke test failed: UI overlay nav rail did not follow player settings screen")
		quit(1)
		return true
	if int(overlay_snapshot.get("nav_buttons", 0)) < 8 or int(overlay_snapshot.get("row_buttons", 0)) <= 0 or int(overlay_snapshot.get("section_buttons", 0)) < 4:
		push_error("Smoke test failed: player settings focusable buttons missing")
		quit(1)
		return true
	if int(overlay_snapshot.get("quick_buttons", 0)) != 1 or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Home") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Gamepad Curve") or String(overlay_snapshot.get("quick_actions_text", "")).contains("Resolution"):
		push_error("Smoke test failed: player settings quick actions missing")
		quit(1)
		return true
	if not String(overlay_snapshot.get("settings_snapshot", "")).contains("gamepad") or not String(overlay_snapshot.get("settings_snapshot", "")).contains("audio") or not String(overlay_snapshot.get("settings_snapshot", "")).contains("display") or not String(overlay_snapshot.get("settings_snapshot", "")).contains("store"):
		push_error("Smoke test failed: player settings snapshot summary missing %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("focus_action", "")) != "settings_gamepad_curve" or not String(overlay_snapshot.get("focus_panel", "")).contains("Player Settings") or not String(overlay_snapshot.get("focus_panel", "")).contains("Action: Gamepad Curve"):
		push_error("Smoke test failed: player settings focus panel invalid")
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_density", "")) != "settings" or not String(overlay_snapshot.get("page_setting_groups", "")).contains("gamepad") or not String(overlay_snapshot.get("page_setting_groups", "")).contains("keybinds") or not String(overlay_snapshot.get("page_setting_groups", "")).contains("volume") or not String(overlay_snapshot.get("page_setting_groups", "")).contains("resolution") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("settings_restore_defaults"):
		push_error("Smoke test failed: player settings page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_task_groups", "")).contains("gamepad_curve") or not String(overlay_snapshot.get("page_task_groups", "")).contains("keybinds") or not String(overlay_snapshot.get("page_task_groups", "")).contains("volume") or not String(overlay_snapshot.get("page_task_groups", "")).contains("resolution") or not String(overlay_snapshot.get("page_experience_text", "")).contains("Gamepad Curve") or String(overlay_snapshot.get("page_experience_text", "")).contains("Now:"):
		push_error("Smoke test failed: player settings page experience summary invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_scene_id", "")) != "settings_panel" or not String(overlay_snapshot.get("page_required_bindings", "")).contains("SettingGroups") or not String(overlay_snapshot.get("page_render_slots", "")).contains("control_buttons"):
		push_error("Smoke test failed: player settings scene contract invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not bool(overlay_snapshot.get("layout_scene_backed", false)) or int(overlay_snapshot.get("layout_scene_bound_count", 0)) < 9 or not String(overlay_snapshot.get("layout_scene_missing_bindings", "")).is_empty():
		push_error("Smoke test failed: player settings scene did not back runtime UI %s" % [overlay_snapshot])
		quit(1)
		return true
	if int(overlay_snapshot.get("overview_cards", 0)) < 4 or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Gamepad Curve") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Key Binding") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Volume") or not String(overlay_snapshot.get("overview_cards_text", "")).contains("Resolution"):
		push_error("Smoke test failed: player settings overview cards missing")
		quit(1)
		return true
	var player_settings_focus_input_result: Dictionary = main_node.call("_ui_press_visible_focus_action")
	if not bool(player_settings_focus_input_result.get("ok", false)) or String(player_settings_focus_input_result.get("row_id", "")) != "settings_gamepad_curve" or String(ui_screen_model.current_screen) != "input_settings" or String(ui_screen_model.selected_row().get("id", "")) != "gamepad_curve":
		push_error("Smoke test failed: player settings focus action did not open gamepad curve")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "player_settings")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var player_settings_overview_display_result: Dictionary = main_node.call("_ui_press_visible_overview_card", 3)
	if not bool(player_settings_overview_display_result.get("ok", false)) or String(player_settings_overview_display_result.get("row_id", "")) != "settings_resolution" or String(ui_screen_model.current_screen) != "display_settings" or String(ui_screen_model.selected_row().get("id", "")) != "display_resolution":
		push_error("Smoke test failed: player settings overview card did not open display settings")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "player_settings")
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	var player_settings_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(player_settings_rows, ["settings_summary", "settings_input", "settings_gamepad_curve", "settings_keybinds", "settings_audio", "settings_volume", "settings_display", "settings_resolution", "settings_advanced", "settings_storage_status", "settings_save_now", "settings_reload", "settings_restore_defaults", "accessibility", "access_low_flash"]) or not _validate_row_label_keys(player_settings_rows, localization):
		push_error("Smoke test failed: player settings rows invalid")
		quit(1)
		return true
	if not _rows_have_sections(player_settings_rows, ["overview", "input", "audio", "display", "advanced", "storage", "accessibility"]):
		push_error("Smoke test failed: player settings sections invalid")
		quit(1)
		return true
	if not _row_has_control(player_settings_rows, "settings_save_now", "button") or not _row_has_control(player_settings_rows, "settings_reload", "button") or not _row_has_control(player_settings_rows, "settings_restore_defaults", "button"):
		push_error("Smoke test failed: player settings storage controls invalid")
		quit(1)
		return true
	if not _rows_target_controls(player_settings_rows, {
		"settings_gamepad_curve": "gamepad_curve",
		"settings_keybinds": "binding_shoot",
		"settings_volume": "audio_group_master",
		"settings_resolution": "display_resolution",
	}):
		push_error("Smoke test failed: player settings target row metadata invalid")
		quit(1)
		return true
	var display_section_jump: Dictionary = main_node.call("_ui_press_visible_section", 3)
	if not bool(display_section_jump.get("ok", false)) or String(display_section_jump.get("section", "")) != "display" or String(ui_screen_model.selected_row().get("id", "")) != "settings_resolution":
		push_error("Smoke test failed: player settings section tab did not jump to display")
		quit(1)
		return true
	var settings_input_cursor: int = _row_index_by_id(player_settings_rows, "settings_input")
	main_node.call("_ui_set_cursor", settings_input_cursor)
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(overlay_snapshot.get("detail", "")).contains("opens Input Profile") or not String(overlay_snapshot.get("hint", "")).contains("Settings") or String(overlay_snapshot.get("selected_section", "")) != "Input" or String(overlay_snapshot.get("selected_control", "")) != "Page":
		push_error("Smoke test failed: player settings input detail/hint invalid")
		quit(1)
		return true
	var visible_settings_input_index := int(settings_input_cursor)
	var settings_button_result: Dictionary = main_node.call("_ui_press_visible_row", visible_settings_input_index)
	if not bool(settings_button_result.get("ok", false)) or int(settings_button_result.get("row_index", -1)) != settings_input_cursor or String(ui_screen_model.current_screen) != "input_settings":
		push_error("Smoke test failed: input settings row button navigation invalid")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "player_settings")
	player_settings_rows = main_node.call("_ui_screen_rows", 32)
	if not _accept_player_settings_target(player_settings_rows, "settings_gamepad_curve", "input_settings", "gamepad_curve"):
		quit(1)
		return true
	main_node.call("_open_ui_screen", "player_settings")
	player_settings_rows = main_node.call("_ui_screen_rows", 32)
	if not _accept_player_settings_target(player_settings_rows, "settings_keybinds", "input_settings", "binding_shoot"):
		quit(1)
		return true
	main_node.call("_open_ui_screen", "player_settings")
	player_settings_rows = main_node.call("_ui_screen_rows", 32)
	if not _accept_player_settings_target(player_settings_rows, "settings_volume", "audio_settings", "audio_group_master"):
		quit(1)
		return true
	main_node.call("_open_ui_screen", "player_settings")
	player_settings_rows = main_node.call("_ui_screen_rows", 32)
	if not _accept_player_settings_target(player_settings_rows, "settings_resolution", "display_settings", "display_resolution"):
		quit(1)
		return true
	main_node.call("_open_ui_screen", "player_settings")
	input_profile.gamepad_curve_index = 3
	audio_settings.set_volume("master", 0.42)
	display_settings.resolution_index = 1
	accessibility_settings.bullet_alpha = 0.66
	player_settings_rows = main_node.call("_ui_screen_rows", 24)
	var settings_save_cursor: int = _row_index_by_id(player_settings_rows, "settings_save_now")
	main_node.call("_ui_set_cursor", settings_save_cursor)
	var explicit_save_result: Dictionary = main_node.call("_ui_accept_selected")
	var explicit_settings_store = main_node.get("player_settings_store")
	if not bool(explicit_save_result.get("ok", false)) or String(explicit_save_result.get("action", "")) != "save_player_settings" or explicit_settings_store == null or String(explicit_settings_store.get("last_status")) != "saved" or not FileAccess.file_exists(explicit_settings_store.get("path")):
		push_error("Smoke test failed: explicit player settings save invalid %s" % [explicit_save_result])
		quit(1)
		return true
	input_profile.gamepad_curve_index = 0
	audio_settings.set_volume("master", 0.10)
	display_settings.resolution_index = 0
	accessibility_settings.bullet_alpha = 0.95
	player_settings_rows = main_node.call("_ui_screen_rows", 24)
	var settings_reload_cursor: int = _row_index_by_id(player_settings_rows, "settings_reload")
	main_node.call("_ui_set_cursor", settings_reload_cursor)
	var explicit_reload_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(explicit_reload_result.get("ok", false)) or String(explicit_reload_result.get("action", "")) != "load_player_settings" or int(input_profile.gamepad_curve_index) != 3 or absf(float(audio_settings.volume_for("master")) - 0.42) > 0.001 or String(display_settings.resolution_text()) != "1600x900" or absf(float(accessibility_settings.bullet_alpha) - 0.66) > 0.001:
		push_error("Smoke test failed: explicit player settings reload invalid %s" % [explicit_reload_result])
		quit(1)
		return true
	player_settings_rows = main_node.call("_ui_screen_rows", 24)
	var settings_restore_cursor: int = _row_index_by_id(player_settings_rows, "settings_restore_defaults")
	main_node.call("_ui_set_cursor", settings_restore_cursor)
	var restore_defaults_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(restore_defaults_result.get("ok", false)) or String(restore_defaults_result.get("action", "")) != "restore_default_player_settings" or String(input_profile.gamepad_curve()) != "soft" or absf(float(audio_settings.volume_for("master")) - 1.0) > 0.001 or String(display_settings.resolution_text()) != "1920x1080" or absf(float(accessibility_settings.bullet_alpha) - 0.95) > 0.001 or String(explicit_settings_store.get("last_status")) != "saved":
		push_error("Smoke test failed: restore default player settings invalid %s" % [restore_defaults_result])
		quit(1)
		return true
	main_node.call("_open_ui_screen", "input_settings")
	var input_settings_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 24)
	if not _rows_have_ids(input_settings_rows, ["input_profile", "gamepad_curve", "gamepad_curve_preview", "gamepad_sensitivity", "gamepad_reset_all", "binding_shoot"]) or not _validate_row_label_keys(input_settings_rows, localization):
		push_error("Smoke test failed: input settings rows invalid")
		quit(1)
		return true
	var curve_preview_row: Dictionary = _find_row_by_id(input_settings_rows, "gamepad_curve_preview")
	var curve_preview_samples: Array = curve_preview_row.get("samples", [])
	var curve_speed_samples: Array = curve_preview_row.get("speed_samples", [])
	if curve_preview_samples.size() < 4 or curve_speed_samples.size() < 4 or not String(curve_preview_row.get("summary", "")).contains(">") or not String(curve_preview_row.get("summary", "")).contains("move") or not String(curve_preview_row.get("summary", "")).contains("focus"):
		push_error("Smoke test failed: gamepad curve preview row invalid %s" % [curve_preview_row])
		quit(1)
		return true
	if not _rows_have_sections(input_settings_rows, ["input", "gamepad", "keybinds"]):
		push_error("Smoke test failed: input settings sections invalid")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("focus_action", "")) != "gamepad_curve" or not String(overlay_snapshot.get("focus_panel", "")).contains("Input Setup") or not String(overlay_snapshot.get("focus_panel", "")).contains("pad"):
		push_error("Smoke test failed: input settings focus panel invalid")
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_setting_groups", "")).contains("gamepad") or not String(overlay_snapshot.get("page_setting_groups", "")).contains("keybinds") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("gamepad_curve_preview"):
		push_error("Smoke test failed: input settings page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_task_groups", "")).contains("speed_preview") or not String(overlay_snapshot.get("page_task_groups", "")).contains("keybinds") or not String(overlay_snapshot.get("page_experience_text", "")).contains("Movement Curve Preview"):
		push_error("Smoke test failed: input settings page experience summary invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if int(overlay_snapshot.get("quick_buttons", 0)) < 2 or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Player Settings") or not String(overlay_snapshot.get("quick_actions_text", "")).contains("Home"):
		push_error("Smoke test failed: input settings back/home quick actions invalid")
		quit(1)
		return true
	var input_parent_result: Dictionary = main_node.call("_ui_press_visible_quick_action", 0)
	if not bool(input_parent_result.get("ok", false)) or String(input_parent_result.get("row_id", "")) != "nav_parent" or String(input_parent_result.get("screen", "")) != "player_settings" or String(ui_screen_model.current_screen) != "player_settings":
		push_error("Smoke test failed: input settings parent quick action invalid")
		quit(1)
		return true
	var back_home_result: bool = bool(main_node.call("_ui_back_or_quit"))
	if not back_home_result or String(ui_screen_model.current_screen) != "main_menu":
		push_error("Smoke test failed: shell back action did not return to home")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "input_settings")
	input_settings_rows = main_node.call("_ui_screen_rows", 24)
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if int(overlay_snapshot.get("section_buttons", 0)) < 3 or not String(overlay_snapshot.get("section_tabs", "")).contains("Gamepad"):
		push_error("Smoke test failed: input settings section tabs invalid")
		quit(1)
		return true
	var gamepad_section_jump: Dictionary = main_node.call("_ui_press_visible_section", 1)
	if not bool(gamepad_section_jump.get("ok", false)) or String(gamepad_section_jump.get("section", "")) != "gamepad" or String(ui_screen_model.selected_row().get("id", "")) != "gamepad_curve":
		push_error("Smoke test failed: input settings section tab did not jump to gamepad")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(overlay_snapshot.get("selected_speed_preview", "")).contains("move") or not String(overlay_snapshot.get("selected_speed_preview", "")).contains("focus") or not String(overlay_snapshot.get("control_preview", "")).contains("move"):
		push_error("Smoke test failed: input gamepad speed preview not visible")
		quit(1)
		return true
	if int(overlay_snapshot.get("control_buttons", 0)) < 3 or not String(overlay_snapshot.get("control_buttons_text", "")).contains("<") or not String(overlay_snapshot.get("control_buttons_text", "")).contains(">") or not String(overlay_snapshot.get("control_buttons_text", "")).contains("Reset"):
		push_error("Smoke test failed: input selector context buttons missing")
		quit(1)
		return true
	var curve_before_context: String = String(input_profile.gamepad_curve())
	var previous_curve_result: Dictionary = main_node.call("_ui_press_visible_control", 0)
	if not bool(previous_curve_result.get("ok", false)) or int(previous_curve_result.get("direction", 0)) != -1 or String(input_profile.gamepad_curve()) == curve_before_context:
		push_error("Smoke test failed: input selector previous context button invalid")
		quit(1)
		return true
	var curve_reset_result: Dictionary = main_node.call("_ui_press_visible_control", 2)
	if not bool(curve_reset_result.get("ok", false)) or String(input_profile.gamepad_curve()) != "soft":
		push_error("Smoke test failed: input selector reset context button invalid")
		quit(1)
		return true
	if not _row_has_control(input_settings_rows, "input_profile", "select") or not _row_has_control(input_settings_rows, "gamepad_curve", "select") or not _row_has_control(input_settings_rows, "gamepad_sensitivity", "slider") or not _row_has_control(input_settings_rows, "binding_shoot", "select"):
		push_error("Smoke test failed: input settings control metadata invalid")
		quit(1)
		return true
	if not _row_has_options(input_settings_rows, "gamepad_curve", 4) or not _row_has_slider_range(input_settings_rows, "gamepad_sensitivity", 0.30, 1.50) or not _row_has_options(input_settings_rows, "binding_shoot", 3):
		push_error("Smoke test failed: input settings control value metadata invalid")
		quit(1)
		return true
	var binding_shoot_cursor_for_capture: int = _row_index_by_id(input_settings_rows, "binding_shoot")
	main_node.call("_ui_set_cursor", binding_shoot_cursor_for_capture)
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if int(overlay_snapshot.get("control_buttons", 0)) < 4 or not String(overlay_snapshot.get("control_buttons_text", "")).contains("Capture"):
		push_error("Smoke test failed: input binding capture button missing")
		quit(1)
		return true
	var capture_button_result: Dictionary = main_node.call("_ui_press_visible_control", 2)
	if not bool(capture_button_result.get("ok", false)) or not bool(main_node.get("input_capture_active")) or String(main_node.get("input_capture_action")) != "shoot":
		push_error("Smoke test failed: input binding capture did not arm")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(overlay_snapshot.get("selected_control_state", "")).contains("capturing") or not String(overlay_snapshot.get("shell", "")).contains("capture shoot"):
		push_error("Smoke test failed: input binding capture state not visible")
		quit(1)
		return true
	var capture_commit_result: Dictionary = main_node.call("_commit_input_capture", KEY_Y)
	if not bool(capture_commit_result.get("ok", false)) or bool(main_node.get("input_capture_active")) or not input_profile.action_keycodes(&"shoot").has(KEY_Y):
		push_error("Smoke test failed: input binding capture commit invalid")
		quit(1)
		return true
	var settings_store = main_node.get("player_settings_store")
	if settings_store == null or String(settings_store.get("last_status")) != "saved" or not FileAccess.file_exists(settings_store.get("path")):
		push_error("Smoke test failed: input capture did not persist settings")
		quit(1)
		return true
	var capture_test_result: Dictionary = main_node.call("_capture_binding_for_test", "bomb", KEY_Y)
	if not bool(capture_test_result.get("ok", false)) or not input_profile.action_keycodes(&"bomb").has(KEY_Y):
		push_error("Smoke test failed: direct input capture test helper invalid")
		quit(1)
		return true
	input_profile.restore_current_profile()
	main_node.call("_save_player_settings")
	var gamepad_sensitivity_cursor: int = _row_index_by_id(input_settings_rows, "gamepad_sensitivity")
	main_node.call("_ui_set_cursor", gamepad_sensitivity_cursor)
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("selected_control", "")) != "Slider" or not String(overlay_snapshot.get("selected_control_state", "")).contains("[") or not String(overlay_snapshot.get("control_preview", "")).contains("Slider: [") or int(overlay_snapshot.get("control_buttons", 0)) < 3 or not String(overlay_snapshot.get("control_buttons_text", "")).contains("-") or not String(overlay_snapshot.get("control_buttons_text", "")).contains("+") or not String(overlay_snapshot.get("control_buttons_text", "")).contains("Reset"):
		push_error("Smoke test failed: input slider overlay state invalid")
		quit(1)
		return true
	var sensitivity_before_context: float = float(input_profile.gamepad_sensitivity)
	var sensitivity_down_result: Dictionary = main_node.call("_ui_press_visible_control", 0)
	if not bool(sensitivity_down_result.get("ok", false)) or int(sensitivity_down_result.get("direction", 0)) != -1 or float(input_profile.gamepad_sensitivity) >= sensitivity_before_context:
		push_error("Smoke test failed: input slider decrease context button invalid")
		quit(1)
		return true
	var sensitivity_reset_result: Dictionary = main_node.call("_ui_press_visible_control", 2)
	if not bool(sensitivity_reset_result.get("ok", false)) or absf(float(input_profile.gamepad_sensitivity) - 0.82) > 0.001:
		push_error("Smoke test failed: input slider reset context button invalid")
		quit(1)
		return true
	input_profile.gamepad_curve_index = 3
	input_profile.gamepad_sensitivity = 1.30
	input_profile.gamepad_deadzone = 0.32
	input_profile.gamepad_vibration = 0.90
	input_settings_rows = main_node.call("_ui_screen_rows", 24)
	var gamepad_reset_cursor: int = _row_index_by_id(input_settings_rows, "gamepad_reset_all")
	main_node.call("_ui_set_cursor", gamepad_reset_cursor)
	var gamepad_reset_all_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(gamepad_reset_all_result.get("ok", false)) or String(gamepad_reset_all_result.get("action", "")) != "reset_gamepad_settings" or String(input_profile.gamepad_curve()) != "soft" or absf(float(input_profile.gamepad_sensitivity) - 0.82) > 0.001 or absf(float(input_profile.gamepad_deadzone) - 0.18) > 0.001 or absf(float(input_profile.gamepad_vibration) - 0.35) > 0.001:
		push_error("Smoke test failed: gamepad reset-all action invalid %s" % [gamepad_reset_all_result])
		quit(1)
		return true
	main_node.call("_open_ui_screen", "player_settings")
	player_settings_rows = main_node.call("_ui_screen_rows", 24)
	var settings_audio_cursor: int = _row_index_by_id(player_settings_rows, "settings_audio")
	main_node.call("_ui_set_cursor", settings_audio_cursor)
	var accept_settings_audio: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_settings_audio.get("ok", false)) or String(accept_settings_audio.get("screen", "")) != "audio_settings":
		push_error("Smoke test failed: audio settings navigation invalid")
		quit(1)
		return true
	var audio_settings_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	if not _rows_have_ids(audio_settings_rows, ["audio", "audio_event_visual_cues", "audio_group_master", "audio_group_music", "audio_reset_all"]) or not _validate_row_label_keys(audio_settings_rows, localization):
		push_error("Smoke test failed: audio settings rows invalid")
		quit(1)
		return true
	if not _rows_have_sections(audio_settings_rows, ["overview", "audio", "volume"]):
		push_error("Smoke test failed: audio settings sections invalid")
		quit(1)
		return true
	if not _row_has_control(audio_settings_rows, "audio_event_visual_cues", "toggle") or not _row_has_control(audio_settings_rows, "audio_group_master", "slider"):
		push_error("Smoke test failed: audio settings control metadata invalid")
		quit(1)
		return true
	if not _row_has_toggle_value(audio_settings_rows, "audio_event_visual_cues") or not _row_has_slider_range(audio_settings_rows, "audio_group_master", 0.0, 1.0):
		push_error("Smoke test failed: audio settings control value metadata invalid")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("focus_action", "")) != "audio_group_master" or not String(overlay_snapshot.get("focus_panel", "")).contains("Audio Mix") or not String(overlay_snapshot.get("focus_panel", "")).contains("master"):
		push_error("Smoke test failed: audio settings focus panel invalid")
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_setting_groups", "")).contains("volume") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("audio_group_voice"):
		push_error("Smoke test failed: audio settings page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	var master_volume_cursor: int = _row_index_by_id(audio_settings_rows, "audio_group_master")
	main_node.call("_ui_set_cursor", master_volume_cursor)
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if int(overlay_snapshot.get("control_buttons", 0)) < 3 or not String(overlay_snapshot.get("control_buttons_text", "")).contains("-") or not String(overlay_snapshot.get("control_buttons_text", "")).contains("Reset"):
		push_error("Smoke test failed: audio slider context buttons missing")
		quit(1)
		return true
	var master_before_context: float = float(audio_settings.volume_for("master"))
	var master_down_result: Dictionary = main_node.call("_ui_press_visible_control", 0)
	if not bool(master_down_result.get("ok", false)) or int(master_down_result.get("direction", 0)) != -1 or float(audio_settings.volume_for("master")) >= master_before_context:
		push_error("Smoke test failed: audio slider decrease context button invalid")
		quit(1)
		return true
	var master_reset_result: Dictionary = main_node.call("_ui_press_visible_control", 2)
	if not bool(master_reset_result.get("ok", false)) or absf(float(audio_settings.volume_for("master")) - 1.0) > 0.001:
		push_error("Smoke test failed: audio slider reset context button invalid")
		quit(1)
		return true
	audio_settings.set_volume("master", 0.25)
	audio_settings.set_volume("music", 0.35)
	audio_settings.event_visual_cues = false
	audio_settings.high_frequency_graze_audio = true
	audio_settings_rows = main_node.call("_ui_screen_rows", 16)
	var audio_reset_cursor: int = _row_index_by_id(audio_settings_rows, "audio_reset_all")
	main_node.call("_ui_set_cursor", audio_reset_cursor)
	var audio_reset_all_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(audio_reset_all_result.get("ok", false)) or String(audio_reset_all_result.get("action", "")) != "reset_audio_settings" or absf(float(audio_settings.volume_for("master")) - 1.0) > 0.001 or absf(float(audio_settings.volume_for("music")) - 0.8) > 0.001 or not bool(audio_settings.event_visual_cues) or bool(audio_settings.high_frequency_graze_audio):
		push_error("Smoke test failed: audio reset-all action invalid %s" % [audio_reset_all_result])
		quit(1)
		return true
	main_node.call("_open_ui_screen", "player_settings")
	player_settings_rows = main_node.call("_ui_screen_rows", 24)
	var settings_display_cursor: int = _row_index_by_id(player_settings_rows, "settings_display")
	main_node.call("_ui_set_cursor", settings_display_cursor)
	var accept_settings_display: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_settings_display.get("ok", false)) or String(accept_settings_display.get("screen", "")) != "display_settings":
		push_error("Smoke test failed: display settings navigation invalid")
		quit(1)
		return true
	var display_settings_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 24)
	if not _rows_have_ids(display_settings_rows, ["display", "display_resolution", "display_window_mode", "display_fps_limit", "display_reset_all", "accessibility", "access_reset_all"]) or not _validate_row_label_keys(display_settings_rows, localization):
		push_error("Smoke test failed: display settings rows invalid")
		quit(1)
		return true
	if not _rows_have_sections(display_settings_rows, ["overview", "display", "accessibility"]):
		push_error("Smoke test failed: display settings sections invalid")
		quit(1)
		return true
	if not _row_has_control(display_settings_rows, "display_resolution", "select") or not _row_has_control(display_settings_rows, "display_vsync", "toggle") or not _row_has_control(display_settings_rows, "display_screen_shake", "slider"):
		push_error("Smoke test failed: display settings control metadata invalid")
		quit(1)
		return true
	if not _row_has_options(display_settings_rows, "display_resolution", 4) or not _row_has_options(display_settings_rows, "display_fps_limit", 4) or not _row_has_toggle_value(display_settings_rows, "display_vsync") or not _row_has_slider_range(display_settings_rows, "display_screen_shake", 0.0, 1.0):
		push_error("Smoke test failed: display settings control value metadata invalid")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("focus_action", "")) != "display_resolution" or not String(overlay_snapshot.get("focus_panel", "")).contains("Display") or not String(overlay_snapshot.get("focus_panel", "")).contains(String(display_settings.resolution_text())):
		push_error("Smoke test failed: display settings focus panel invalid")
		quit(1)
		return true
	if not String(overlay_snapshot.get("page_setting_groups", "")).contains("resolution") or not String(overlay_snapshot.get("page_setting_groups", "")).contains("accessibility") or not String(overlay_snapshot.get("page_secondary_ids", "")).contains("display_background_dim"):
		push_error("Smoke test failed: display settings page spec invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	var display_resolution_cursor: int = _row_index_by_id(display_settings_rows, "display_resolution")
	main_node.call("_ui_set_cursor", display_resolution_cursor)
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if int(overlay_snapshot.get("control_buttons", 0)) < 3 or not String(overlay_snapshot.get("control_buttons_text", "")).contains("<") or not String(overlay_snapshot.get("control_buttons_text", "")).contains("Reset"):
		push_error("Smoke test failed: display selector context buttons missing")
		quit(1)
		return true
	var resolution_before_context: String = String(display_settings.resolution_text())
	var resolution_previous_result: Dictionary = main_node.call("_ui_press_visible_control", 0)
	if not bool(resolution_previous_result.get("ok", false)) or int(resolution_previous_result.get("direction", 0)) != -1 or String(display_settings.resolution_text()) == resolution_before_context:
		push_error("Smoke test failed: display selector previous context button invalid")
		quit(1)
		return true
	var resolution_reset_result: Dictionary = main_node.call("_ui_press_visible_control", 2)
	if not bool(resolution_reset_result.get("ok", false)) or String(display_settings.resolution_text()) != "1920x1080":
		push_error("Smoke test failed: display selector reset context button invalid")
		quit(1)
		return true
	display_settings_rows = main_node.call("_ui_screen_rows", 24)
	var display_vsync_cursor: int = _row_index_by_id(display_settings_rows, "display_vsync")
	main_node.call("_ui_set_cursor", display_vsync_cursor)
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if int(overlay_snapshot.get("control_buttons", 0)) < 2 or not String(overlay_snapshot.get("control_buttons_text", "")).contains("Toggle") or not String(overlay_snapshot.get("control_buttons_text", "")).contains("Reset"):
		push_error("Smoke test failed: display toggle context button missing")
		quit(1)
		return true
	var vsync_before_context: bool = bool(display_settings.vsync_enabled)
	var vsync_toggle_result: Dictionary = main_node.call("_ui_press_visible_control", 0)
	if not bool(vsync_toggle_result.get("ok", false)) or bool(display_settings.vsync_enabled) == vsync_before_context:
		push_error("Smoke test failed: display toggle context button invalid")
		quit(1)
		return true
	var vsync_reset_result: Dictionary = main_node.call("_ui_press_visible_control", 1)
	if not bool(vsync_reset_result.get("ok", false)) or not bool(display_settings.vsync_enabled):
		push_error("Smoke test failed: display toggle reset context button invalid")
		quit(1)
		return true
	display_settings.resolution_index = 0
	display_settings.window_mode_index = 2
	display_settings.vsync_enabled = false
	display_settings.fps_limit_index = 3
	display_settings.screen_shake = 0.9
	display_settings.background_dim = 0.8
	display_settings_rows = main_node.call("_ui_screen_rows", 24)
	var display_reset_cursor: int = _row_index_by_id(display_settings_rows, "display_reset_all")
	main_node.call("_ui_set_cursor", display_reset_cursor)
	var display_reset_all_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(display_reset_all_result.get("ok", false)) or String(display_reset_all_result.get("action", "")) != "reset_display_settings" or String(display_settings.resolution_text()) != "1920x1080" or String(display_settings.window_mode()) != "windowed" or not bool(display_settings.vsync_enabled) or int(display_settings.fps_limit()) != 60 or absf(float(display_settings.screen_shake) - 0.35) > 0.001 or absf(float(display_settings.background_dim) - 0.25) > 0.001:
		push_error("Smoke test failed: display reset-all action invalid %s" % [display_reset_all_result])
		quit(1)
		return true
	accessibility_settings.low_flash = false
	accessibility_settings.simplified_background = false
	accessibility_settings.always_show_hitbox = true
	accessibility_settings.practice_graze_ring = false
	accessibility_settings.bullet_alpha = 0.55
	accessibility_settings.palette_index = 1
	display_settings_rows = main_node.call("_ui_screen_rows", 24)
	var access_reset_cursor: int = _row_index_by_id(display_settings_rows, "access_reset_all")
	main_node.call("_ui_set_cursor", access_reset_cursor)
	var access_reset_all_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(access_reset_all_result.get("ok", false)) or String(access_reset_all_result.get("action", "")) != "reset_accessibility_settings" or not bool(accessibility_settings.low_flash) or not bool(accessibility_settings.simplified_background) or bool(accessibility_settings.always_show_hitbox) or not bool(accessibility_settings.practice_graze_ring) or absf(float(accessibility_settings.bullet_alpha) - 0.95) > 0.001 or String(accessibility_settings.palette_name()) != "standard":
		push_error("Smoke test failed: accessibility reset-all action invalid %s" % [access_reset_all_result])
		quit(1)
		return true
	stage = "player_settings_store"
	var smoke_store = PlayerSettingsStore.new()
	smoke_store.configure(SMOKE_SETTINGS_PATH)
	input_profile.rebind_action(&"shoot", [KEY_Y])
	input_profile.gamepad_curve_index = 3
	input_profile.gamepad_sensitivity = 1.25
	audio_settings.set_volume("master", 0.45)
	audio_settings.high_frequency_graze_audio = true
	display_settings.resolution_index = 1
	display_settings.window_mode_index = 1
	display_settings.vsync_enabled = false
	accessibility_settings.bullet_alpha = 0.65
	accessibility_settings.palette_index = 1
	var smoke_save: Dictionary = smoke_store.save(input_profile, audio_settings, display_settings, accessibility_settings)
	if not bool(smoke_save.get("ok", false)) or not FileAccess.file_exists(SMOKE_SETTINGS_PATH):
		push_error("Smoke test failed: player settings store did not save")
		quit(1)
		return true
	var loaded_input = InputProfile.new()
	loaded_input.apply_current_profile()
	var loaded_audio = AudioSettings.new()
	var loaded_display = DisplaySettings.new()
	var loaded_access = AccessibilitySettings.new()
	var smoke_load: Dictionary = smoke_store.load(loaded_input, loaded_audio, loaded_display, loaded_access)
	if not bool(smoke_load.get("ok", false)) or not loaded_input.action_keycodes(&"shoot").has(KEY_Y) or int(loaded_input.gamepad_curve_index) != 3 or absf(float(loaded_input.gamepad_sensitivity) - 1.25) > 0.001:
		push_error("Smoke test failed: player settings store did not load input")
		quit(1)
		return true
	if absf(float(loaded_audio.volume_for("master")) - 0.45) > 0.001 or not bool(loaded_audio.high_frequency_graze_audio):
		push_error("Smoke test failed: player settings store did not load audio")
		quit(1)
		return true
	if String(loaded_display.resolution_text()) != "1600x900" or String(loaded_display.window_mode()) != "borderless" or bool(loaded_display.vsync_enabled):
		push_error("Smoke test failed: player settings store did not load display")
		quit(1)
		return true
	if absf(float(loaded_access.bullet_alpha) - 0.65) > 0.001 or String(loaded_access.palette_name()) != "colorblind":
		push_error("Smoke test failed: player settings store did not load accessibility")
		quit(1)
		return true
	input_profile.restore_current_profile()
	audio_settings.reset_all()
	display_settings.reset_all()
	accessibility_settings.reset_all()
	main_node.call("_apply_audio_settings")
	main_node.call("_apply_display_settings", true)
	main_node.call("_save_player_settings")
	if not main_node.call("_open_ui_screen", "practice"):
		push_error("Smoke test failed: practice screen did not open")
		quit(1)
		return true
	var practice_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 48)
	if not _rows_have_ids(practice_rows, ["practice_summary", "practice_restart", "practice_seed_prev", "practice_seed_next", "practice_power_down", "practice_power_up", "practice_bombs_cycle", "practice_stage_run", "stage_briefing", "stage_math_route", "stage_recommended_character", "stage_practice_plan", "stage_practice_preset_route", "stage_practice_preset_peak", "stage_practice_preset_survival", "boss_spellbook_original_boss_archive", "boss_spell_phase_nonspell_radial_entry", "character_balanced", "stage_starlit_lanes", "stage_pattern_spiral_ring"]):
		push_error("Smoke test failed: practice screen rows incomplete")
		quit(1)
		return true
	if not _validate_row_label_keys(practice_rows, localization):
		quit(1)
		return true
	var practice_power_cursor: int = _row_index_by_id(practice_rows, "practice_power_up")
	main_node.call("_ui_set_cursor", practice_power_cursor)
	var power_before: float = float(main_node.get("practice_initial_power"))
	var accept_power: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_power.get("ok", false)) or String(accept_power.get("action", "")) != "practice_power_up" or float(main_node.get("practice_initial_power")) <= power_before:
		push_error("Smoke test failed: practice power action invalid")
		quit(1)
		return true
	practice_rows = main_node.call("_ui_screen_rows", 48)
	var practice_bombs_cursor: int = _row_index_by_id(practice_rows, "practice_bombs_cycle")
	main_node.call("_ui_set_cursor", practice_bombs_cursor)
	var bombs_before: int = int(main_node.get("practice_initial_bombs"))
	var accept_bombs: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_bombs.get("ok", false)) or String(accept_bombs.get("action", "")) != "practice_bombs_cycle" or int(main_node.get("practice_initial_bombs")) == bombs_before:
		push_error("Smoke test failed: practice bombs action invalid")
		quit(1)
		return true
	practice_rows = main_node.call("_ui_screen_rows", 48)
	var practice_stage_cursor: int = _row_index_by_id(practice_rows, "stage_misty_crossfire")
	main_node.call("_ui_set_cursor", practice_stage_cursor)
	var accept_practice_stage: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_practice_stage.get("ok", false)) or String(accept_practice_stage.get("action", "")) != "select_stage" or String(stage_select_model.selected_stage_id) != "misty_crossfire" or String(character_model.selected_character_id) != "wide":
		push_error("Smoke test failed: practice stage selection invalid")
		quit(1)
		return true
	practice_rows = main_node.call("_ui_screen_rows", 48)
	var practice_pattern_cursor: int = _row_index_by_id(practice_rows, "stage_pattern_sine_stream")
	main_node.call("_ui_set_cursor", practice_pattern_cursor)
	var accept_practice_pattern: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_practice_pattern.get("ok", false)) or String(accept_practice_pattern.get("action", "")) != "select_pattern" or int(stage_select_model.selected_pattern_index) != 2:
		push_error("Smoke test failed: practice pattern selection invalid")
		quit(1)
		return true
	practice_rows = main_node.call("_ui_screen_rows", 48)
	var practice_peak_preset_cursor: int = _row_index_by_id(practice_rows, "stage_practice_preset_peak")
	if practice_peak_preset_cursor < 0:
		push_error("Smoke test failed: practice peak preset row missing")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", practice_peak_preset_cursor)
	var accept_peak_preset: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_peak_preset.get("ok", false)) or String(accept_peak_preset.get("action", "")) != "apply_stage_practice_preset" or String(accept_peak_preset.get("preset_kind", "")) != "danger_peak" or bool(main_node.get("stage_run_enabled")):
		push_error("Smoke test failed: peak practice preset action invalid %s" % [accept_peak_preset])
		quit(1)
		return true
	if String(stage_select_model.active_pattern().get("id", "")).is_empty() or float(main_node.get("practice_initial_power")) < 2.0 or int(main_node.get("practice_initial_bombs")) < 3:
		push_error("Smoke test failed: peak preset did not apply resources/pattern")
		quit(1)
		return true
	practice_rows = main_node.call("_ui_screen_rows", 48)
	var practice_survival_preset_cursor: int = _row_index_by_id(practice_rows, "stage_practice_preset_survival")
	if practice_survival_preset_cursor < 0:
		push_error("Smoke test failed: practice survival preset row missing")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", practice_survival_preset_cursor)
	var accept_survival_preset: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_survival_preset.get("ok", false)) or String(accept_survival_preset.get("action", "")) != "apply_stage_practice_preset" or String(accept_survival_preset.get("preset_kind", "")) != "low_resource" or not bool(main_node.get("stage_run_enabled")):
		push_error("Smoke test failed: survival practice preset action invalid %s" % [accept_survival_preset])
		quit(1)
		return true
	if float(main_node.get("practice_initial_power")) > 1.25 or int(main_node.get("practice_initial_bombs")) != 1 or String(character_model.selected_character_id) != "wide":
		push_error("Smoke test failed: survival preset resources/character invalid")
		quit(1)
		return true
	practice_rows = main_node.call("_ui_screen_rows", 48)
	var practice_plan_cursor: int = _row_index_by_id(practice_rows, "stage_practice_plan")
	if practice_plan_cursor < 0:
		push_error("Smoke test failed: practice plan row missing")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", practice_plan_cursor)
	var accept_practice_plan: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_practice_plan.get("ok", false)) or String(accept_practice_plan.get("action", "")) != "apply_stage_practice_plan" or not bool(main_node.get("stage_run_enabled")) or int(stage_select_model.selected_pattern_index) != 0 or String(character_model.selected_character_id) != "wide":
		push_error("Smoke test failed: practice plan action invalid %s" % [accept_practice_plan])
		quit(1)
		return true
	main_node.call("_dispatch_ui_action", {"ui_action": "toggle_stage_run"})
	main_node.call("_open_ui_screen", "activity")
	var activity_ui_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(activity_ui_rows, ["activity_summary", "activity_social", "activity_promotions", "announce_architecture", "activity_task_daily_complete_match", "activity_claim_log"]):
		push_error("Smoke test failed: activity screen rows invalid")
		quit(1)
		return true
	if not _rows_have_sections(activity_ui_rows, ["overview", "community", "announcements", "activity"]):
		push_error("Smoke test failed: activity screen sections invalid")
		quit(1)
		return true
	var activity_social_cursor: int = _row_index_by_id(activity_ui_rows, "activity_social")
	main_node.call("_ui_set_cursor", activity_social_cursor)
	var accept_activity_social: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_activity_social.get("ok", false)) or String(accept_activity_social.get("screen", "")) != "social":
		push_error("Smoke test failed: activity social navigation invalid")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "activity")
	activity_ui_rows = main_node.call("_ui_screen_rows", 32)
	var leaderboard_cursor: int = _row_index_by_id(activity_ui_rows, "activity_leaderboard_world_boss_damage")
	main_node.call("_ui_set_cursor", leaderboard_cursor)
	var accept_blocked_leaderboard: Dictionary = main_node.call("_ui_accept_selected")
	if bool(accept_blocked_leaderboard.get("ok", true)) or String(accept_blocked_leaderboard.get("action", "")) != "disabled":
		push_error("Smoke test failed: disabled activity row accepted unexpectedly")
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "deck"):
		push_error("Smoke test failed: deck screen did not open")
		quit(1)
		return true
	var ui_deck_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	if ui_deck_rows.is_empty() or String(ui_deck_rows[0].get("id", "")) != "deck_stats" or not _rows_have_key(ui_deck_rows, "card_id"):
		push_error("Smoke test failed: deck screen rows invalid")
		quit(1)
		return true
	var focus_lens_cursor: int = _row_index_by_id(ui_deck_rows, "deck_card_focus_lens")
	if focus_lens_cursor < 0:
		push_error("Smoke test failed: editable deck card row missing")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", focus_lens_cursor)
	var accept_remove_card: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_remove_card.get("ok", false)) or String(accept_remove_card.get("action", "")) != "toggle_deck_card" or int(accept_remove_card.get("deck_size", 0)) != 19 or bool(accept_remove_card.get("valid", true)):
		push_error("Smoke test failed: UI deck card remove invalid")
		quit(1)
		return true
	var invalid_deck_save_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	main_node.call("_ui_set_cursor", 0)
	var accept_invalid_save: Dictionary = main_node.call("_ui_accept_selected")
	if bool(accept_invalid_save.get("ok", true)) or String(accept_invalid_save.get("action", "")) != "save_deck" or String(deck_builder.last_save_status) != "invalid":
		push_error("Smoke test failed: invalid UI deck save was not rejected")
		quit(1)
		return true
	var focus_lens_cursor_after_remove: int = _row_index_by_id(invalid_deck_save_rows, "deck_card_focus_lens")
	main_node.call("_ui_set_cursor", focus_lens_cursor_after_remove)
	var accept_add_card: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_add_card.get("ok", false)) or String(accept_add_card.get("action", "")) != "toggle_deck_card" or int(accept_add_card.get("deck_size", 0)) != 20 or not bool(accept_add_card.get("valid", false)):
		push_error("Smoke test failed: UI deck card add invalid")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", 0)
	var accept_valid_save: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_valid_save.get("ok", false)) or String(accept_valid_save.get("action", "")) != "save_deck" or String(deck_builder.last_save_status) != "saved":
		push_error("Smoke test failed: valid UI deck save failed")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("screen", "")) != "deck" or int(overlay_snapshot.get("nonempty_rows", 0)) <= 1:
		push_error("Smoke test failed: UI overlay did not render deck rows")
		quit(1)
		return true
	if String(overlay_snapshot.get("layout_scene_id", "")) != "collection_panel" or not _validate_runtime_scene_backed(overlay_snapshot, "collection_panel", 9):
		push_error("Smoke test failed: deck collection scene did not back runtime UI %s" % [overlay_snapshot])
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "settings"):
		push_error("Smoke test failed: settings screen did not open")
		quit(1)
		return true
	var settings_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 64)
	if not _rows_have_ids(settings_rows, ["input_profile", "gamepad_curve", "binding_shoot", "display", "display_resolution", "character", "stage_select", "stage_starlit_lanes", "boss_spellbook_original_boss_archive", "boss_spell_phase_nonspell_radial_entry", "bullet_visual", "balance_summary", "accessibility", "audio"]) or not _rows_have_key(settings_rows, "pattern_id") or not _rows_have_key(settings_rows, "group"):
		push_error("Smoke test failed: settings screen rows invalid")
		quit(1)
		return true
	if not _rows_have_ids(settings_rows, ["bullet_visual_small_orb", "bullet_visual_homing"]):
		push_error("Smoke test failed: bullet visual settings rows missing")
		quit(1)
		return true
	var input_profile_cursor: int = _row_index_by_id(settings_rows, "input_profile")
	main_node.call("_ui_set_cursor", input_profile_cursor)
	var accept_input_profile: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_input_profile.get("ok", false)) or String(accept_input_profile.get("action", "")) != "cycle_input_profile" or String(input_profile.profile_name()) != "right_hand":
		push_error("Smoke test failed: UI input profile accept invalid")
		quit(1)
		return true
	var refreshed_settings_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 80)
	var gamepad_curve_cursor: int = _row_index_by_id(refreshed_settings_rows, "gamepad_curve")
	main_node.call("_ui_set_cursor", gamepad_curve_cursor)
	var gamepad_curve_before: String = String(input_profile.gamepad_curve())
	var accept_gamepad_curve: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_gamepad_curve.get("ok", false)) or String(accept_gamepad_curve.get("action", "")) != "cycle_gamepad_curve" or String(input_profile.gamepad_curve()) == gamepad_curve_before:
		push_error("Smoke test failed: UI gamepad curve accept invalid")
		quit(1)
		return true
	refreshed_settings_rows = main_node.call("_ui_screen_rows", 80)
	var binding_cursor: int = _row_index_by_id(refreshed_settings_rows, "binding_shoot")
	main_node.call("_ui_set_cursor", binding_cursor)
	var shoot_keys_before: Array[int] = input_profile.action_keycodes(&"shoot")
	var accept_binding: Dictionary = main_node.call("_ui_accept_selected")
	var shoot_keys_after: Array[int] = input_profile.action_keycodes(&"shoot")
	if not bool(accept_binding.get("ok", false)) or String(accept_binding.get("action", "")) != "cycle_input_binding" or shoot_keys_after == shoot_keys_before:
		push_error("Smoke test failed: UI key binding accept invalid")
		quit(1)
		return true
	refreshed_settings_rows = main_node.call("_ui_screen_rows", 80)
	var resolution_cursor: int = _row_index_by_id(refreshed_settings_rows, "display_resolution")
	main_node.call("_ui_set_cursor", resolution_cursor)
	var resolution_before: String = String(display_settings.resolution_text())
	var accept_resolution: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_resolution.get("ok", false)) or String(accept_resolution.get("action", "")) != "cycle_resolution" or String(display_settings.resolution_text()) == resolution_before:
		push_error("Smoke test failed: UI resolution accept invalid")
		quit(1)
		return true
	refreshed_settings_rows = main_node.call("_ui_screen_rows", 80)
	var low_flash_cursor: int = _row_index_by_id(refreshed_settings_rows, "access_low_flash")
	main_node.call("_ui_set_cursor", low_flash_cursor)
	var low_flash_before: bool = bool(accessibility_settings.low_flash)
	var accept_low_flash: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_low_flash.get("ok", false)) or String(accept_low_flash.get("action", "")) != "toggle_low_flash" or bool(accessibility_settings.low_flash) == low_flash_before:
		push_error("Smoke test failed: UI low-flash accept invalid")
		quit(1)
		return true
	refreshed_settings_rows = main_node.call("_ui_screen_rows", 48)
	var alpha_cursor: int = _row_index_by_id(refreshed_settings_rows, "access_bullet_alpha")
	main_node.call("_ui_set_cursor", alpha_cursor)
	var alpha_before: float = float(accessibility_settings.bullet_alpha)
	var accept_alpha: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_alpha.get("ok", false)) or String(accept_alpha.get("action", "")) != "adjust_bullet_alpha" or float(accessibility_settings.bullet_alpha) <= alpha_before:
		push_error("Smoke test failed: UI bullet-alpha accept invalid")
		quit(1)
		return true
	refreshed_settings_rows = main_node.call("_ui_screen_rows", 52)
	var music_cursor: int = _row_index_by_id(refreshed_settings_rows, "audio_group_music")
	main_node.call("_ui_set_cursor", music_cursor)
	var music_before: float = float(audio_settings.volume_for("music"))
	var accept_music: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_music.get("ok", false)) or String(accept_music.get("action", "")) != "adjust_audio_volume" or float(audio_settings.volume_for("music")) <= music_before:
		push_error("Smoke test failed: UI audio volume accept invalid")
		quit(1)
		return true
	refreshed_settings_rows = main_node.call("_ui_screen_rows", 52)
	var balance_cursor: int = _row_index_by_id(refreshed_settings_rows, "balance_summary")
	main_node.call("_ui_set_cursor", balance_cursor)
	var accept_balance: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_balance.get("ok", false)) or String(accept_balance.get("action", "")) != "run_balance_simulation" or int(accept_balance.get("run_count", 0)) <= 0:
		push_error("Smoke test failed: UI balance simulation accept invalid")
		quit(1)
		return true
	refreshed_settings_rows = main_node.call("_ui_screen_rows", 52)
	var latency_cursor: int = _row_index_by_id(refreshed_settings_rows, "latency_summary")
	main_node.call("_ui_set_cursor", latency_cursor)
	var accept_latency: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_latency.get("ok", false)) or String(accept_latency.get("action", "")) != "run_latency_tests" or int(accept_latency.get("scenario_count", 0)) <= 0:
		push_error("Smoke test failed: UI latency test accept invalid")
		quit(1)
		return true
	main_node.call("_open_ui_screen", "settings")
	if not main_node.call("_open_ui_screen", "workshop"):
		push_error("Smoke test failed: workshop screen did not open")
		quit(1)
		return true
	var workshop_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 8)
	if workshop_rows.is_empty() or not workshop_rows[0].has("active"):
		push_error("Smoke test failed: workshop screen rows invalid")
		quit(1)
		return true
	main_node.call("_ui_set_cursor", 0)
	var accept_theme: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_theme.get("ok", false)) or String(accept_theme.get("action", "")) != "activate_theme":
		push_error("Smoke test failed: UI theme accept invalid")
		quit(1)
		return true
	for screen_id in ["match", "network_match", "modes", "chest", "results"]:
		if not main_node.call("_open_ui_screen", screen_id):
			push_error("Smoke test failed: %s screen did not open" % screen_id)
			quit(1)
			return true
		var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
		if rows.is_empty() or not _validate_row_label_keys(rows, localization):
			push_error("Smoke test failed: %s screen rows invalid" % screen_id)
			quit(1)
			return true
		if screen_id == "chest" and (not _rows_have_ids(rows, ["local_basic", "probability", "pity", "wallet", "result", "audit"]) or not _rows_have_key(rows, "pity")):
			push_error("Smoke test failed: chest screen rows incomplete")
			quit(1)
			return true
	if not main_node.call("_open_ui_screen", "modes"):
		push_error("Smoke test failed: modes screen did not reopen for UI action")
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "network_match"):
		push_error("Smoke test failed: network match screen did not reopen for UI action")
		quit(1)
		return true
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("layout_kind", "")) != "network_room" or String(overlay_snapshot.get("layout_anchor", "")) != "center" or bool(overlay_snapshot.get("gameplay_visible", true)) or bool(overlay_snapshot.get("layout_advance_gameplay", true)):
		push_error("Smoke test failed: network room layout policy invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	var network_action_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 20)
	if not _rows_have_ids(network_action_rows, ["gensoulkyo_login", "gensoulkyo_sync_inventory", "gensoulkyo_sync_decks", "gensoulkyo_save_deck", "gensoulkyo_sync_chests", "gensoulkyo_open_chest", "gensoulkyo_upgrade_card", "gensoulkyo_create_room", "gensoulkyo_set_join_room", "gensoulkyo_join_room", "gensoulkyo_poll_ticket", "gensoulkyo_cancel_ticket", "gensoulkyo_heartbeat", "gensoulkyo_server_ready", "gensoulkyo_poll_events", "gensoulkyo_rematch"]):
		push_error("Smoke test failed: Gensoulkyo UI action rows missing")
		quit(1)
		return true
	gensoulkyo_api_model.set_pending_join_room_code("RSMOKE")
	network_action_rows = main_node.call("_ui_screen_rows", 20)
	var set_room_cursor: int = _row_index_by_id(network_action_rows, "gensoulkyo_set_join_room")
	main_node.call("_ui_set_cursor", set_room_cursor)
	var accept_set_room: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_set_room.get("ok", false)) or String(accept_set_room.get("action", "")) != "gensoulkyo_set_join_room" or String(gensoulkyo_api_model.pending_join_room_code) != "RSMOKE":
		push_error("Smoke test failed: UI set room code accept invalid")
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "modes"):
		push_error("Smoke test failed: modes screen did not reopen after network UI action")
		quit(1)
		return true
	var mode_ui_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	var br_mode_cursor: int = _row_index_by_id(mode_ui_rows, "battle_royale")
	main_node.call("_ui_set_cursor", br_mode_cursor)
	var accept_mode: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_mode.get("ok", false)) or String(accept_mode.get("action", "")) != "select_mode" or String(game_mode_model.selected_mode_id) != "battle_royale":
		push_error("Smoke test failed: UI mode accept invalid")
		quit(1)
		return true
	mode_ui_rows = main_node.call("_ui_screen_rows", 32)
	var br_candidates_cursor: int = _row_index_by_id(mode_ui_rows, "br_candidates")
	main_node.call("_ui_set_cursor", br_candidates_cursor)
	var accept_br_candidate: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_br_candidate.get("ok", false)) or String(accept_br_candidate.get("action", "")) != "select_battle_royale_candidate" or String(accept_br_candidate.get("request_type", "")) != "select_round_card" or bool(accept_br_candidate.get("authoritative", true)):
		push_error("Smoke test failed: UI battle royale candidate accept invalid")
		quit(1)
		return true
	if String(game_mode_model.battle_royale_state.get("selected_card_id", "")) != String(accept_br_candidate.get("card_id", "")):
		push_error("Smoke test failed: UI battle royale selected card did not update")
		quit(1)
		return true
	mode_ui_rows = main_node.call("_ui_screen_rows", 32)
	var world_entry_cursor: int = _row_index_by_id(mode_ui_rows, "world_boss_entry")
	var world_entry_ui_row: Dictionary = _find_row_by_id(mode_ui_rows, "world_boss_entry")
	if not _validate_boss_entry_preview(world_entry_ui_row.get("entry_preflight", {}), "world_boss", true, "none"):
		quit(1)
		return true
	main_node.call("_ui_set_cursor", world_entry_cursor)
	var accept_world_entry: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_world_entry.get("ok", false)) or String(accept_world_entry.get("action", "")) != "request_boss_entry" or String(accept_world_entry.get("request_type", "")) != "enter_world_boss" or bool(accept_world_entry.get("authoritative", true)):
		push_error("Smoke test failed: UI world boss entry accept invalid %s" % [accept_world_entry])
		quit(1)
		return true
	mode_ui_rows = main_node.call("_ui_screen_rows", 32)
	var instance_entry_cursor: int = _row_index_by_id(mode_ui_rows, "instance_boss_entry")
	var instance_entry_ui_row: Dictionary = _find_row_by_id(mode_ui_rows, "instance_boss_entry")
	if not _validate_boss_entry_preview(instance_entry_ui_row.get("entry_preflight", {}), "instance_boss", true, "none"):
		quit(1)
		return true
	main_node.call("_ui_set_cursor", instance_entry_cursor)
	var accept_instance_entry: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_instance_entry.get("ok", false)) or String(accept_instance_entry.get("action", "")) != "request_boss_entry" or String(accept_instance_entry.get("request_type", "")) != "enter_boss_instance" or bool(accept_instance_entry.get("authoritative", true)):
		push_error("Smoke test failed: UI instance boss entry accept invalid %s" % [accept_instance_entry])
		quit(1)
		return true
	mode_ui_rows = main_node.call("_ui_screen_rows", 32)
	var boss_transfer_cursor: int = _row_index_by_id(mode_ui_rows, "world_boss_transfer")
	main_node.call("_ui_set_cursor", boss_transfer_cursor)
	var accept_boss_transfer: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_boss_transfer.get("ok", false)) or String(accept_boss_transfer.get("action", "")) != "request_boss_transfer" or String(accept_boss_transfer.get("request_type", "")) != "transfer_card" or bool(accept_boss_transfer.get("authoritative", true)):
		push_error("Smoke test failed: UI boss transfer accept invalid")
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "match"):
		push_error("Smoke test failed: match screen did not reopen for UI action")
		quit(1)
		return true
	var match_ui_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	var network_cursor: int = _row_index_by_id(match_ui_rows, "network_quality")
	main_node.call("_ui_set_cursor", network_cursor)
	var accept_network_quality: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_network_quality.get("ok", false)) or String(accept_network_quality.get("action", "")) != "cycle_network_quality" or int(matchmaking_model.ping_ms) <= 42:
		push_error("Smoke test failed: UI network quality accept invalid")
		quit(1)
		return true
	match_ui_rows = main_node.call("_ui_screen_rows", 16)
	var queue_cursor: int = _row_index_by_id(match_ui_rows, "queue_status")
	main_node.call("_ui_set_cursor", queue_cursor)
	var accept_queue: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_queue.get("ok", false)) or String(accept_queue.get("action", "")) != "join_queue" or String(matchmaking_model.queue_status) != "queued":
		push_error("Smoke test failed: UI queue join accept invalid")
		quit(1)
		return true
	match_ui_rows = main_node.call("_ui_screen_rows", 16)
	queue_cursor = _row_index_by_id(match_ui_rows, "queue_status")
	main_node.call("_ui_set_cursor", queue_cursor)
	var accept_found: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_found.get("ok", false)) or String(accept_found.get("action", "")) != "simulate_match_found" or String(matchmaking_model.queue_status) != "found":
		push_error("Smoke test failed: UI match-found accept invalid")
		quit(1)
		return true
	match_ui_rows = main_node.call("_ui_screen_rows", 16)
	var ready_cursor: int = _row_index_by_id(match_ui_rows, "ready")
	main_node.call("_ui_set_cursor", ready_cursor)
	var accept_ready: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_ready.get("ok", false)) or String(accept_ready.get("action", "")) != "ready_match" or String(matchmaking_model.queue_status) != "ready":
		push_error("Smoke test failed: UI ready accept invalid")
		quit(1)
		return true
	match_ui_rows = main_node.call("_ui_screen_rows", 16)
	queue_cursor = _row_index_by_id(match_ui_rows, "queue_status")
	main_node.call("_ui_set_cursor", queue_cursor)
	var accept_begin_network: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_begin_network.get("ok", false)) or String(accept_begin_network.get("action", "")) != "begin_network_match" or String(network_match_model.authority_state) != "loading":
		push_error("Smoke test failed: UI begin network match accept invalid")
		quit(1)
		return true
	var network_rows_for_action: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	var authority_cursor: int = _row_index_by_id(network_rows_for_action, "authority")
	main_node.call("_ui_set_cursor", authority_cursor)
	var accept_network_ready: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_network_ready.get("ok", false)) or String(accept_network_ready.get("action", "")) != "network_ready" or String(network_match_model.authority_state) != "ready":
		push_error("Smoke test failed: UI network ready accept invalid")
		quit(1)
		return true
	var full_snapshot_cursor: int = _row_index_by_id(main_node.call("_ui_screen_rows", 16), "full_snapshot")
	main_node.call("_ui_set_cursor", full_snapshot_cursor)
	var disabled_full_snapshot: Dictionary = main_node.call("_ui_accept_selected")
	if bool(disabled_full_snapshot.get("ok", true)) or String(disabled_full_snapshot.get("action", "")) != "disabled":
		push_error("Smoke test failed: disabled UI row accepted unexpectedly")
		quit(1)
		return true
	main_node.call("_network_receive_match_start", {
		"match_id": String(network_match_model.match_id),
		"mode_id": "certification",
		"ruleset_version": "ruleset-local-s0",
		"server_seed": 20260627,
		"input_delay_ticks": 2,
		"players": [{"user_id": "local_user", "player_id": "p-ui", "display_name": "UI Player", "loadout": {"stage_id": "starlit_lanes", "character_id": "balanced", "ruleset_version": "ruleset-local-s0", "server_authoritative": true}}],
	})
	overlay_snapshot = main_node.call("_ui_overlay_snapshot")
	if String(overlay_snapshot.get("layout_kind", "")) != "battle_room" or String(overlay_snapshot.get("layout_anchor", "")) != "right" or not bool(overlay_snapshot.get("gameplay_visible", false)) or bool(overlay_snapshot.get("layout_advance_gameplay", true)):
		push_error("Smoke test failed: running battle room layout policy invalid %s" % [overlay_snapshot])
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "chest"):
		push_error("Smoke test failed: chest screen did not reopen for UI action")
		quit(1)
		return true
	var chest_rows_for_action: Array[Dictionary] = main_node.call("_ui_screen_rows", 16)
	var chest_cursor: int = _row_index_by_id(chest_rows_for_action, "local_basic")
	main_node.call("_ui_set_cursor", chest_cursor)
	var chests_before: int = int(chest_system.owned_chests.get("local_basic", 0))
	var accept_chest: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(accept_chest.get("ok", false)) or String(accept_chest.get("action", "")) != "open_chest" or int(chest_system.owned_chests.get("local_basic", 0)) != chests_before - 1:
		push_error("Smoke test failed: UI chest open accept invalid")
		quit(1)
		return true
	main_node.call("_set_network_quality", 42, 0.0, 4)
	game_mode_model.select_mode("certification")
	matchmaking_model.cancel_queue()
	stage = "localization_theme"
	if localization == null or not localization.missing_keys.is_empty():
		push_error("Smoke test failed: missing i18n keys %s" % [localization.missing_keys if localization != null else []])
		quit(1)
		return true
	if theme_registry == null or not theme_registry.is_valid() or String(theme_registry.active_theme_id) != "base":
		push_error("Smoke test failed: theme registry invalid")
		quit(1)
		return true
	if not theme_registry.replacement_summary().contains("text") or theme_registry.replacement_summary().contains("rules"):
		push_error("Smoke test failed: theme replacement policy invalid")
		quit(1)
		return true
	if not _validate_workshop_theme_discovery(theme_registry, localization):
		quit(1)
		return true
	if not localization.load_errors.is_empty() or not localization.loaded_packs.has("res://i18n/base.en.json"):
		push_error("Smoke test failed: base i18n pack did not load")
		quit(1)
		return true
	if not localization.has_text("ui.score") or not localization.has_text("card.focus_lens.name"):
		push_error("Smoke test failed: required i18n keys missing from loaded text")
		quit(1)
		return true
	stage = "save_replay"
	await _advance_frames(12)
	if not main_node.call("_save_replay_snapshot"):
		push_error("Smoke test failed: replay snapshot did not save")
		quit(1)
		return true
	stage = "replay_index"
	var replay_store = main_node.get("replay_store")
	if replay_store == null or not replay_store.latest_exists():
		push_error("Smoke test failed: replay file missing after save")
		quit(1)
		return true
	var replay_index: Array[Dictionary] = replay_store.load_index()
	if replay_index.is_empty():
		push_error("Smoke test failed: replay index missing after save")
		quit(1)
		return true
	var latest_replay: Dictionary = replay_store.latest_index_entry()
	if String(latest_replay.get("path", "")) != replay_store.latest_path() or int(latest_replay.get("final_tick", 0)) <= 0:
		push_error("Smoke test failed: replay index latest entry invalid")
		quit(1)
		return true
	if String(latest_replay.get("pattern_id", "")).is_empty() or not latest_replay.has("final_result_hash"):
		push_error("Smoke test failed: replay index metadata incomplete")
		quit(1)
		return true
	if String(latest_replay.get("mode", "")) != "local_practice" or String(latest_replay.get("result", "")) != "practice" or String(latest_replay.get("opponent", "")).is_empty():
		push_error("Smoke test failed: replay index list columns incomplete")
		quit(1)
		return true
	if int(latest_replay.get("input_count", 0)) <= 0 or String(latest_replay.get("input_integrity_status", "")) != "valid" or not bool(latest_replay.get("input_tick_contiguous", false)) or int(latest_replay.get("input_last_tick", -1)) != int(latest_replay.get("final_tick", -2)):
		push_error("Smoke test failed: replay input integrity metadata invalid %s" % [latest_replay])
		quit(1)
		return true
	main_node.call("_refresh_replay_index")
	if int(main_node.get("replay_index_entries").size()) <= 0 or String(main_node.get("replay_index_status")) == "empty":
		push_error("Smoke test failed: replay index did not refresh in main scene")
		quit(1)
		return true
	if replay_list_model == null or replay_list_model.row_models(4).is_empty():
		push_error("Smoke test failed: replay list model missing rows")
		quit(1)
		return true
	var replay_verification_summary: Dictionary = replay_list_model.verification_summary_row()
	if String(replay_verification_summary.get("id", "")) != "replay_verification_summary" or int(replay_verification_summary.get("entry_count", 0)) <= 0 or int(replay_verification_summary.get("local_ready_count", 0)) <= 0 or int(replay_verification_summary.get("server_pending_audit_count", -1)) != 0 or bool(replay_verification_summary.get("client_result_authoritative", true)):
		push_error("Smoke test failed: replay verification aggregate invalid %s" % [replay_verification_summary])
		quit(1)
		return true
	if bool(replay_verification_summary.get("filter_empty", true)) or int(replay_verification_summary.get("visible_entry_count", 0)) <= 0 or int(replay_verification_summary.get("selected_filtered_index", 0)) <= 0 or not String(replay_verification_summary.get("filter_navigation_label", "")).contains("/"):
		push_error("Smoke test failed: replay verification aggregate navigation invalid %s" % [replay_verification_summary])
		quit(1)
		return true
	if String(replay_verification_summary.get("selected_local_load_policy", "")) != "loadable_local_practice" or not bool(replay_verification_summary.get("selected_can_play", false)) or bool(replay_verification_summary.get("selected_requires_server_audit", true)):
		push_error("Smoke test failed: replay verification selected load policy invalid %s" % [replay_verification_summary])
		quit(1)
		return true
	var replay_authority_summary: Dictionary = replay_list_model.replay_authority_summary_row()
	if String(replay_authority_summary.get("id", "")) != "replay_authority_summary" \
			or int(replay_authority_summary.get("entry_count", 0)) <= 0 \
			or int(replay_authority_summary.get("local_loadable_count", 0)) <= 0 \
			or int(replay_authority_summary.get("server_audit_required_count", -1)) != 0 \
			or String(replay_authority_summary.get("authority_contract_kind", "")) != "replay_local_display_server_audit_summary" \
			or String(replay_authority_summary.get("online_replay_authority", "")) != "server_audit_required" \
			or String(replay_authority_summary.get("boss_hp_authority", "")) != "server" \
			or bool(replay_authority_summary.get("client_result_authoritative", true)):
		push_error("Smoke test failed: replay authority summary invalid %s" % [replay_authority_summary])
		quit(1)
		return true
	var replay_filter_rows: Array[Dictionary] = replay_list_model.verification_filter_rows()
	if replay_filter_rows.size() < 5 or String(replay_filter_rows[0].get("verification_filter", "")) != "all" or not bool(replay_filter_rows[0].get("active", false)) or bool(replay_filter_rows[0].get("client_result_authoritative", true)):
		push_error("Smoke test failed: replay verification filter rows invalid %s" % [replay_filter_rows])
		quit(1)
		return true
	if _row_index_by_id(replay_filter_rows, "replay_filter_replay_input_invalid") < 0:
		push_error("Smoke test failed: replay verification filters missing input-invalid filter %s" % [replay_filter_rows])
		quit(1)
		return true
	var rejected_claim_filter_model_row: Dictionary = _find_row_by_id(replay_filter_rows, "replay_filter_rejected_server_claim")
	if rejected_claim_filter_model_row.is_empty() \
			or String(rejected_claim_filter_model_row.get("verification_filter", "")) != "rejected_server_claim" \
			or String(rejected_claim_filter_model_row.get("label_key", "")) != "ui.menu_section_replay_rejected_server_claim" \
			or bool(rejected_claim_filter_model_row.get("client_result_authoritative", true)):
		push_error("Smoke test failed: replay verification filters missing rejected-server-claim filter %s" % [replay_filter_rows])
		quit(1)
		return true
	var bad_input_replay := latest_replay.duplicate(true)
	bad_input_replay["replay_id"] = "input-gap-smoke"
	bad_input_replay["input_tick_contiguous"] = false
	bad_input_replay["input_integrity_status"] = "input_tick_gap"
	var bad_input_validation: Dictionary = replay_store.validate_index_metadata([bad_input_replay])
	if bool(bad_input_validation.get("ok", true)) or not (bad_input_validation.get("failures", []) as Array).has("input_tick_gap:input-gap-smoke"):
		push_error("Smoke test failed: replay input gap validation did not reject %s" % [bad_input_validation])
		quit(1)
		return true
	replay_list_model.entries = [bad_input_replay]
	replay_list_model.cursor = 0
	replay_list_model.set_verification_filter("replay_input_invalid")
	var bad_input_rows: Array[Dictionary] = replay_list_model.row_models(4)
	if bad_input_rows.is_empty() or String(bad_input_rows[0].get("section", "")) != "replay_input_invalid" or String(bad_input_rows[0].get("verification_status", "")) != "input_tick_gap" or String(bad_input_rows[0].get("verification_scope", "")) != "local_practice_input_integrity" or bool(bad_input_rows[0].get("can_play", true)) or bool(bad_input_rows[0].get("enabled", true)) or String(bad_input_rows[0].get("load_rejection_reason", "")) != "input_tick_gap":
		push_error("Smoke test failed: replay input invalid filter rows invalid %s" % [bad_input_rows])
		quit(1)
		return true
	if not _validate_replay_row_authority(bad_input_rows[0], "local_practice_verification_only", "server"):
		quit(1)
		return true
	if main_node.call("_load_selected_replay_snapshot") or String(main_node.get("replay_file_status")) != "load_failed" or String(main_node.get("replay_index_action_status")) != "input_tick_gap":
		push_error("Smoke test failed: replay input invalid load was not blocked status=%s action=%s" % [main_node.get("replay_file_status"), main_node.get("replay_index_action_status")])
		quit(1)
		return true
	var server_replay := latest_replay.duplicate(true)
	server_replay["replay_id"] = "server-audit-smoke"
	server_replay["mode"] = "pvp_duel"
	server_replay["result"] = "server_record"
	server_replay["server_authoritative"] = true
	var server_replay_validation: Dictionary = replay_store.validate_index_metadata([server_replay])
	if not bool(server_replay_validation.get("ok", false)):
		push_error("Smoke test failed: server replay audit metadata should be accepted as pending %s" % [server_replay_validation])
		quit(1)
		return true
	replay_list_model.entries = [server_replay]
	replay_list_model.cursor = 0
	replay_list_model.set_verification_filter("replay_server_pending")
	var server_replay_rows: Array[Dictionary] = replay_list_model.row_models(4)
	if server_replay_rows.is_empty() \
			or String(server_replay_rows[0].get("section", "")) != "replay_server_pending" \
			or String(server_replay_rows[0].get("verification_status", "")) != "server_record_pending_audit" \
			or String(server_replay_rows[0].get("verification_scope", "")) != "server_audit_record" \
			or String(server_replay_rows[0].get("replay_authority_scope", "")) != "server_authoritative_record" \
			or String(server_replay_rows[0].get("local_load_policy", "")) != "blocked_server_audit" \
			or String(server_replay_rows[0].get("server_audit_status", "")) != "pending" \
			or not bool(server_replay_rows[0].get("requires_server_audit", false)) \
			or bool(server_replay_rows[0].get("can_play", true)) \
			or bool(server_replay_rows[0].get("enabled", true)) \
			or String(server_replay_rows[0].get("load_rejection_reason", "")) != "server_record_pending_audit" \
			or String(server_replay_rows[0].get("local_load_guard_reason", "")) != "server_record_pending_audit":
		push_error("Smoke test failed: server replay pending-audit row invalid %s" % [server_replay_rows])
		quit(1)
		return true
	if not _validate_replay_row_authority(server_replay_rows[0], "local_practice_verification_only", "server"):
		quit(1)
		return true
	var server_replay_guard: Dictionary = replay_list_model.local_load_guard_for_entry(server_replay)
	if bool(server_replay_guard.get("ok", true)) or String(server_replay_guard.get("reason", "")) != "server_record_pending_audit" or String(server_replay_guard.get("verification_section", "")) != "replay_server_pending":
		push_error("Smoke test failed: server replay local load guard invalid %s" % [server_replay_guard])
		quit(1)
		return true
	var server_replay_summary: Dictionary = replay_list_model.verification_summary_row()
	if String(server_replay_summary.get("selected_local_load_policy", "")) != "blocked_server_audit" \
			or String(server_replay_summary.get("selected_load_guard_reason", "")) != "server_record_pending_audit" \
			or String(server_replay_summary.get("selected_verification_section", "")) != "replay_server_pending" \
			or not bool(server_replay_summary.get("selected_requires_server_audit", false)) \
			or bool(server_replay_summary.get("selected_can_play", true)):
		push_error("Smoke test failed: server replay summary selected load policy invalid %s" % [server_replay_summary])
		quit(1)
		return true
	var server_authority_summary: Dictionary = replay_list_model.replay_authority_summary_row()
	if int(server_authority_summary.get("server_audit_required_count", 0)) != 1 \
			or int(server_authority_summary.get("local_loadable_count", 1)) != 0 \
			or String(server_authority_summary.get("selected_local_load_policy", "")) != "blocked_server_audit" \
			or String(server_authority_summary.get("selected_server_audit_status", "")) != "pending" \
			or not bool(server_authority_summary.get("selected_requires_server_audit", false)) \
			or bool((server_authority_summary.get("selected_guard", {}) as Dictionary).get("ok", true)):
		push_error("Smoke test failed: server replay authority summary invalid %s" % [server_authority_summary])
		quit(1)
		return true
	var server_replay_action_rows: Array[Dictionary] = replay_list_model.selected_action_rows()
	var server_replay_load_action: Dictionary = _find_row_by_id(server_replay_action_rows, "replay_action_load")
	if String(server_replay_load_action.get("selected_verification_status", "")) != "server_record_pending_audit" \
			or String(server_replay_load_action.get("selected_verification_section", "")) != "replay_server_pending" \
			or String(server_replay_load_action.get("selected_server_audit_status", "")) != "pending" \
			or String(server_replay_load_action.get("selected_replay_authority_scope", "")) != "server_authoritative_record" \
			or bool(server_replay_load_action.get("can_play", true)) \
			or bool(server_replay_load_action.get("enabled", true)):
		push_error("Smoke test failed: server replay action context invalid %s" % [server_replay_load_action])
		quit(1)
		return true
	var server_replay_action_guard: Dictionary = server_replay_load_action.get("replay_action_guard", {})
	if bool(server_replay_action_guard.get("ok", true)) \
			or String(server_replay_action_guard.get("reason", "")) != "server_record_pending_audit" \
			or String(server_replay_action_guard.get("local_load_policy", "")) != "blocked_server_audit" \
			or String(server_replay_action_guard.get("server_audit_status", "")) != "pending" \
			or not bool(server_replay_action_guard.get("requires_server_audit", false)) \
			or bool(server_replay_action_guard.get("client_result_authoritative", true)):
		push_error("Smoke test failed: server replay action guard invalid %s" % [server_replay_action_guard])
		quit(1)
		return true
	if main_node.call("_load_selected_replay_snapshot") or String(main_node.get("replay_file_status")) != "load_failed" or String(main_node.get("replay_index_action_status")) != "server_record_pending_audit":
		push_error("Smoke test failed: server replay local load was not blocked status=%s action=%s" % [main_node.get("replay_file_status"), main_node.get("replay_index_action_status")])
		quit(1)
		return true
	var boss_preview: Dictionary = boss_spellbook_model.deterministic_phase_preview("original_boss_archive", "nonspell_radial_entry", 20260625)
	var boss_export: Dictionary = boss_spellbook_model.phase_export_data("original_boss_archive", 20260625)
	var boss_practice_replay := latest_replay.duplicate(true)
	boss_practice_replay["replay_id"] = "boss-practice-replay-smoke"
	boss_practice_replay["mode"] = "boss_spellbook_practice"
	boss_practice_replay["catalog_id"] = "boss_spellbook"
	boss_practice_replay["spellbook_id"] = "original_boss_archive"
	boss_practice_replay["phase_id"] = "nonspell_radial_entry"
	boss_practice_replay["match_seed"] = 20260625
	boss_practice_replay["preview_seed"] = 20260625
	boss_practice_replay["input_integrity_status"] = "preview_input_not_recorded"
	boss_practice_replay["input_count"] = 0
	boss_practice_replay["input_first_tick"] = -1
	boss_practice_replay["input_last_tick"] = -1
	boss_practice_replay["input_tick_span"] = 0
	boss_practice_replay["input_tick_monotonic"] = false
	boss_practice_replay["input_tick_contiguous"] = false
	boss_practice_replay["final_result_hash"] = int(boss_preview.get("signature_digest", 0))
	boss_practice_replay["final_tick"] = int(boss_preview.get("sample_window_end_tick", 140))
	boss_practice_replay["preview_export_schema_version"] = int(boss_preview.get("export_schema_version", 1))
	boss_practice_replay["preview_export_id"] = String(boss_preview.get("export_id", ""))
	boss_practice_replay["preview_fixture_id"] = String(boss_preview.get("preview_fixture_id", ""))
	boss_practice_replay["preview_authority_scope"] = String(boss_preview.get("preview_authority_scope", ""))
	boss_practice_replay["preview_signature"] = String(boss_preview.get("signature", ""))
	boss_practice_replay["preview_signature_digest"] = int(boss_preview.get("signature_digest", 0))
	boss_practice_replay["preview_sample_ticks"] = boss_preview.get("sample_ticks", [])
	boss_practice_replay["preview_sample_window_start_tick"] = int(boss_preview.get("sample_window_start_tick", 0))
	boss_practice_replay["preview_sample_window_end_tick"] = int(boss_preview.get("sample_window_end_tick", 0))
	boss_practice_replay["preview_sample_window_stride_ticks"] = int(boss_preview.get("sample_window_stride_ticks", 0))
	boss_practice_replay["preview_sample_signature_digests"] = boss_preview.get("sample_signature_digests", [])
	boss_practice_replay["preview_sample_emit_counts"] = boss_preview.get("sample_emit_counts", [])
	boss_practice_replay["preview_sample_count"] = (boss_preview.get("samples", []) as Array).size()
	boss_practice_replay["preview_max_emit_per_tick"] = int(boss_preview.get("max_emit_per_tick", 0))
	boss_practice_replay["preview_bullet_cap_per_tick"] = int(boss_preview.get("bullet_cap_per_tick", 0))
	boss_practice_replay["preview_budget_headroom"] = int(boss_preview.get("budget_headroom", 0))
	boss_practice_replay["performance_budget_status"] = String(boss_preview.get("performance_budget_status", ""))
	boss_practice_replay["preview_bundle_id"] = String(boss_export.get("preview_bundle_id", ""))
	boss_practice_replay["preview_bundle_signature_digest"] = int(boss_export.get("preview_bundle_signature_digest", 0))
	boss_practice_replay["preview_phase_count"] = int(boss_export.get("preview_phase_count", 0))
	boss_practice_replay["preview_phase_ids"] = boss_export.get("preview_phase_ids", [])
	boss_practice_replay["preview_phase_signature_digests"] = boss_export.get("preview_phase_signature_digests", [])
	boss_practice_replay["preview_bundle_max_emit_per_tick"] = int(boss_export.get("max_preview_emit_per_tick", 0))
	boss_practice_replay["preview_bundle_min_budget_headroom"] = int(boss_export.get("min_preview_budget_headroom", 0))
	boss_practice_replay["preview_bundle_budget_status"] = String(boss_export.get("performance_budget_status", ""))
	boss_practice_replay["server_authoritative"] = false
	var boss_practice_validation: Dictionary = replay_store.validate_index_metadata([boss_practice_replay])
	if not bool(boss_practice_validation.get("ok", false)) or int(boss_practice_validation.get("spellbook_entries", 0)) != 1:
		push_error("Smoke test failed: boss practice replay metadata invalid %s" % [boss_practice_validation])
		quit(1)
		return true
	replay_list_model.entries = [boss_practice_replay]
	replay_list_model.cursor = 0
	replay_list_model.set_verification_filter("all")
	var boss_practice_rows: Array[Dictionary] = replay_list_model.row_models(4)
	if boss_practice_rows.is_empty():
		push_error("Smoke test failed: boss practice replay row missing")
		quit(1)
		return true
	var boss_practice_row: Dictionary = boss_practice_rows[0]
	var boss_practice_context: Dictionary = boss_practice_row.get("boss_practice_verification", {})
	if String(boss_practice_row.get("verification_status", "")) != "local_final_hash_ready" \
			or String(boss_practice_row.get("verification_scope", "")) != "local_practice_hash" \
			or String(boss_practice_context.get("contract_kind", "")) != "boss_practice_replay_index_verification" \
			or not bool(boss_practice_context.get("ok", false)) \
			or String(boss_practice_context.get("preview_authority_scope", "")) != "local_practice_preview_only" \
			or String(boss_practice_context.get("online_outcome_status", "")) != "server_required" \
			or int(boss_practice_context.get("preview_bundle_signature_digest", 0)) != int(boss_export.get("preview_bundle_signature_digest", 0)) \
			or bool(boss_practice_context.get("client_result_authoritative", true)):
		push_error("Smoke test failed: boss practice replay verification context invalid row=%s context=%s" % [boss_practice_row, boss_practice_context])
		quit(1)
		return true
	if not _validate_replay_row_authority(boss_practice_row, "local_practice_verification_only", "server"):
		quit(1)
		return true
	var boss_practice_summary: Dictionary = replay_list_model.boss_practice_verification_summary_row()
	if int(boss_practice_summary.get("boss_practice_entry_count", 0)) != 1 \
			or int(boss_practice_summary.get("boss_practice_ready_count", 0)) != 1 \
			or int(boss_practice_summary.get("preview_phase_count", 0)) != int(boss_export.get("preview_phase_count", 0)) \
			or String(boss_practice_summary.get("replay_verification_scope", "")) != "local_practice_hash" \
			or String(boss_practice_summary.get("damage_authority", "")) != "server" \
			or bool(boss_practice_summary.get("selected_requires_server_audit", true)) \
			or bool(boss_practice_summary.get("client_result_authoritative", true)):
		push_error("Smoke test failed: boss practice verification summary invalid %s" % [boss_practice_summary])
		quit(1)
		return true
	var boss_practice_actions: Array[Dictionary] = replay_list_model.selected_action_rows()
	var boss_practice_load_action: Dictionary = _find_row_by_id(boss_practice_actions, "replay_action_load")
	if String(boss_practice_load_action.get("selected_boss_practice_verification_status", "")) != "local_final_hash_ready" \
			or (boss_practice_load_action.get("selected_boss_practice_verification", {}) as Dictionary).is_empty() \
			or not bool((boss_practice_load_action.get("selected_boss_practice_verification", {}) as Dictionary).get("ok", false)) \
			or not bool(boss_practice_load_action.get("can_play", false)) \
			or bool(boss_practice_load_action.get("requires_server_audit", true)):
		push_error("Smoke test failed: boss practice load action context invalid %s" % [boss_practice_load_action])
		quit(1)
		return true
	var fallback_claim_replay := boss_practice_replay.duplicate(true)
	fallback_claim_replay["replay_id"] = "boss-practice-claim-fallback"
	fallback_claim_replay["server_authority_claim_fields"] = ["damage_total"]
	var fallback_replay_list_model: RefCounted = ReplayListModelScript.new()
	fallback_replay_list_model.entries = [fallback_claim_replay]
	fallback_replay_list_model.cursor = 0
	fallback_replay_list_model.set_verification_filter("all")
	var fallback_claim_rows: Array[Dictionary] = fallback_replay_list_model.row_models(2)
	if fallback_claim_rows.is_empty():
		push_error("Smoke test failed: fallback server-claim replay row missing")
		quit(1)
		return true
	var fallback_claim_row: Dictionary = fallback_claim_rows[0]
	var fallback_claim_context: Dictionary = fallback_claim_row.get("boss_practice_verification", {})
	var fallback_claim_guard: Dictionary = fallback_replay_list_model.local_load_guard_for_entry(fallback_claim_replay)
	if String(fallback_claim_row.get("verification_scope", "")) != "rejected_server_claim" \
			or String(fallback_claim_row.get("local_load_policy", "")) != "blocked_server_audit" \
			or String(fallback_claim_row.get("server_audit_status", "")) != "pending" \
			or not bool(fallback_claim_row.get("requires_server_audit", false)) \
			or String(fallback_claim_row.get("load_rejection_reason", "")) != "server_authority_claim_rejected" \
			or bool(fallback_claim_row.get("can_play", true)) \
			or bool(fallback_claim_context.get("ok", true)) \
			or String(fallback_claim_context.get("verification_scope", "")) != "rejected_server_claim" \
			or String(fallback_claim_context.get("reason", "")) != "server_authority_claim_rejected" \
			or String(fallback_claim_context.get("local_load_policy", "")) != "blocked_server_audit" \
			or String(fallback_claim_context.get("server_audit_status", "")) != "pending" \
			or not bool(fallback_claim_context.get("requires_server_audit", false)) \
			or String(fallback_claim_context.get("local_playback_authority", "")) != "server_audit_required" \
			or (fallback_claim_context.get("server_authority_claim_fields", []) as Array).is_empty() \
			or bool(fallback_claim_guard.get("ok", true)) \
			or String(fallback_claim_guard.get("reason", "")) != "server_authority_claim_rejected" \
			or String(fallback_claim_guard.get("local_load_policy", "")) != "blocked_server_audit" \
			or String(fallback_claim_guard.get("server_audit_status", "")) != "pending" \
			or not bool(fallback_claim_guard.get("requires_server_audit", false)) \
			or (fallback_claim_guard.get("server_authority_claim_fields", []) as Array).is_empty():
		push_error("Smoke test failed: fallback server-claim replay guard invalid row=%s context=%s guard=%s" % [fallback_claim_row, fallback_claim_context, fallback_claim_guard])
		quit(1)
		return true
	if not replay_list_model.set_verification_filter("replay_boss_practice") or String(replay_list_model.get("active_verification_filter")) != "replay_boss_practice":
		push_error("Smoke test failed: boss practice replay verification filter did not activate")
		quit(1)
		return true
	var boss_filtered_rows: Array[Dictionary] = replay_list_model.row_models(4)
	if boss_filtered_rows.size() != 1 \
			or String(boss_filtered_rows[0].get("mode", "")) != "boss_spellbook_practice" \
			or String(boss_filtered_rows[0].get("verification_scope", "")) != "local_practice_hash" \
			or String(boss_filtered_rows[0].get("active_verification_filter", "")) != "replay_boss_practice" \
			or bool(boss_filtered_rows[0].get("client_result_authoritative", true)) \
			or String(boss_filtered_rows[0].get("damage_authority", "server")) != "server":
		push_error("Smoke test failed: boss practice replay filtered rows invalid %s" % [boss_filtered_rows])
		quit(1)
		return true
	replay_list_model.entries = [boss_practice_replay, fallback_claim_replay]
	replay_list_model.cursor = 0
	replay_list_model.set_verification_filter("all")
	var mixed_authority_summary: Dictionary = replay_list_model.replay_authority_summary_row()
	if int(mixed_authority_summary.get("local_loadable_count", 0)) != 1 \
			or int(mixed_authority_summary.get("server_audit_required_count", 0)) != 1 \
			or int(mixed_authority_summary.get("rejected_server_claim_count", 0)) != 1 \
			or String(mixed_authority_summary.get("damage_authority", "")) != "server" \
			or bool(mixed_authority_summary.get("client_result_authoritative", true)):
		push_error("Smoke test failed: mixed replay authority summary invalid %s" % [mixed_authority_summary])
		quit(1)
		return true
	if not replay_list_model.set_verification_filter("rejected_server_claim") or String(replay_list_model.get("active_verification_filter")) != "rejected_server_claim":
		push_error("Smoke test failed: rejected server-claim replay verification filter did not activate")
		quit(1)
		return true
	var rejected_claim_rows: Array[Dictionary] = replay_list_model.row_models(4)
	if rejected_claim_rows.size() != 1 \
			or String(rejected_claim_rows[0].get("replay_id", "")) != "boss-practice-claim-fallback" \
			or String(rejected_claim_rows[0].get("verification_scope", "")) != "rejected_server_claim" \
			or String(rejected_claim_rows[0].get("local_load_policy", "")) != "blocked_server_audit" \
			or String(rejected_claim_rows[0].get("server_audit_status", "")) != "pending" \
			or not bool(rejected_claim_rows[0].get("requires_server_audit", false)) \
			or bool(rejected_claim_rows[0].get("can_play", true)) \
			or String(rejected_claim_rows[0].get("active_verification_filter", "")) != "rejected_server_claim" \
			or String(rejected_claim_rows[0].get("section_label_key", "")) != "ui.menu_section_replay_metadata_invalid" \
			or bool(rejected_claim_rows[0].get("client_result_authoritative", true)):
		push_error("Smoke test failed: rejected server-claim replay filtered rows invalid %s" % [rejected_claim_rows])
		quit(1)
		return true
	replay_list_model.entries = [boss_practice_replay]
	replay_list_model.cursor = 0
	replay_list_model.refresh()
	if not replay_list_model.set_verification_filter("replay_local_ready") or String(replay_list_model.get("active_verification_filter")) != "replay_local_ready":
		push_error("Smoke test failed: replay verification filter did not activate")
		quit(1)
		return true
	var filtered_replay_rows: Array[Dictionary] = replay_list_model.row_models(8)
	if filtered_replay_rows.is_empty() or String(filtered_replay_rows[0].get("section", "")) != "replay_local_ready":
		push_error("Smoke test failed: replay verification filtered rows invalid %s" % [filtered_replay_rows])
		quit(1)
		return true
	replay_list_model.set_verification_filter("all")
	if String(replay_verification_summary.get("section", "")) != "overview" or String(replay_verification_summary.get("section_label_key", "")) != "ui.menu_section_overview":
		push_error("Smoke test failed: replay verification aggregate section invalid %s" % [replay_verification_summary])
		quit(1)
		return true
	if not main_node.call("_open_ui_screen", "replay"):
		push_error("Smoke test failed: replay screen did not open")
		quit(1)
		return true
	var ui_replay_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 14)
	if ui_replay_rows.size() < 9 or String(ui_replay_rows[0].get("id", "")) != "replay_verification_summary" or String(ui_replay_rows[1].get("ui_action", "")) != "set_replay_filter":
		push_error("Smoke test failed: replay screen rows invalid")
		quit(1)
		return true
	if bool(ui_replay_rows[0].get("client_result_authoritative", true)) or int(ui_replay_rows[0].get("local_ready_count", 0)) <= 0 or int(ui_replay_rows[0].get("server_pending_audit_count", -1)) != 0:
		push_error("Smoke test failed: replay UI verification aggregate invalid %s" % [ui_replay_rows[0]])
		quit(1)
		return true
	if bool(ui_replay_rows[0].get("filter_empty", true)) or int(ui_replay_rows[0].get("selected_filtered_index", 0)) <= 0 or String(ui_replay_rows[0].get("filter_navigation_label", "")).is_empty():
		push_error("Smoke test failed: replay UI verification navigation invalid %s" % [ui_replay_rows[0]])
		quit(1)
		return true
	var ui_replay_authority_summary: Dictionary = _find_row_by_id(ui_replay_rows, "replay_authority_summary")
	if ui_replay_authority_summary.is_empty() \
			or String(ui_replay_authority_summary.get("ui_control", "")) != "status" \
			or not String(ui_replay_authority_summary.get("ui_action", "")).is_empty() \
			or String(ui_replay_authority_summary.get("online_replay_authority", "")) != "server_audit_required" \
			or String(ui_replay_authority_summary.get("damage_authority", "")) != "server" \
			or bool(ui_replay_authority_summary.get("client_result_authoritative", true)):
		push_error("Smoke test failed: replay UI authority summary invalid %s" % [ui_replay_authority_summary])
		quit(1)
		return true
	var local_filter_index := _row_index_by_id(ui_replay_rows, "replay_filter_replay_local_ready")
	if local_filter_index < 0:
		push_error("Smoke test failed: replay UI missing local-ready filter")
		quit(1)
		return true
	var boss_filter_index := _row_index_by_id(ui_replay_rows, "replay_filter_replay_boss_practice")
	if boss_filter_index < 0:
		push_error("Smoke test failed: replay UI missing boss-practice filter")
		quit(1)
		return true
	var boss_filter_row: Dictionary = _find_row_by_id(ui_replay_rows, "replay_filter_replay_boss_practice")
	if String(boss_filter_row.get("verification_filter", "")) != "replay_boss_practice" \
			or String(boss_filter_row.get("ui_action", "")) != "set_replay_filter" \
			or bool(boss_filter_row.get("client_result_authoritative", true)) \
			or String(boss_filter_row.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: replay boss-practice filter row invalid %s" % [boss_filter_row])
		quit(1)
		return true
	var rejected_claim_filter_row: Dictionary = _find_row_by_id(ui_replay_rows, "replay_filter_rejected_server_claim")
	if String(rejected_claim_filter_row.get("verification_filter", "")) != "rejected_server_claim" \
			or String(rejected_claim_filter_row.get("ui_action", "")) != "set_replay_filter" \
			or String(rejected_claim_filter_row.get("label_key", "")) != "ui.menu_section_replay_rejected_server_claim" \
			or bool(rejected_claim_filter_row.get("client_result_authoritative", true)) \
			or String(rejected_claim_filter_row.get("damage_authority", "")) != "server":
		push_error("Smoke test failed: replay rejected-server-claim filter row invalid %s" % [rejected_claim_filter_row])
		quit(1)
		return true
	var load_action_row: Dictionary = _find_row_by_id(ui_replay_rows, "replay_action_load")
	var favorite_action_row: Dictionary = _find_row_by_id(ui_replay_rows, "replay_action_favorite")
	var remove_action_row: Dictionary = _find_row_by_id(ui_replay_rows, "replay_action_remove")
	if load_action_row.is_empty() or favorite_action_row.is_empty() or remove_action_row.is_empty() or String(load_action_row.get("ui_action", "")) != "load_replay" or String(favorite_action_row.get("ui_action", "")) != "toggle_replay_favorite" or String(remove_action_row.get("ui_action", "")) != "remove_replay_from_index" or bool(load_action_row.get("client_result_authoritative", true)) or bool(favorite_action_row.get("client_result_authoritative", true)):
		push_error("Smoke test failed: replay UI action rows invalid load=%s favorite=%s remove=%s" % [load_action_row, favorite_action_row, remove_action_row])
		quit(1)
		return true
	if String(load_action_row.get("local_load_policy", "")) != "loadable_local_practice" or not bool(load_action_row.get("can_play", false)) or bool(load_action_row.get("requires_server_audit", true)) or String(load_action_row.get("local_hash_authority", "")) != "local_practice_verification_only":
		push_error("Smoke test failed: replay load action policy invalid %s" % [load_action_row])
		quit(1)
		return true
	if String(load_action_row.get("selected_verification_status", "")) != "local_final_hash_ready" \
			or not String(load_action_row.get("selected_verification_summary", "")).contains("local practice final hash ready") \
			or String(load_action_row.get("selected_replay_authority_scope", "")) != "local_practice_record" \
			or String(load_action_row.get("selected_local_playback_authority", "")) != "local_practice_hash" \
			or int(load_action_row.get("selected_filtered_index", 0)) <= 0 \
			or int(load_action_row.get("selected_filtered_count", 0)) <= 0 \
			or not String(load_action_row.get("selected_filter_navigation_label", "")).contains("/"):
		push_error("Smoke test failed: replay load action verification context invalid %s" % [load_action_row])
		quit(1)
		return true
	var local_replay_action_guard: Dictionary = load_action_row.get("replay_action_guard", {})
	if not bool(local_replay_action_guard.get("ok", false)) \
			or String(local_replay_action_guard.get("reason", "")) != "loadable_local_practice" \
			or String(local_replay_action_guard.get("local_load_policy", "")) != "loadable_local_practice" \
			or bool(local_replay_action_guard.get("requires_server_audit", true)) \
			or String(local_replay_action_guard.get("local_playback_authority", "")) != "local_practice_hash" \
			or String(local_replay_action_guard.get("settlement_authority", "")) != "server" \
			or bool(local_replay_action_guard.get("client_result_authoritative", true)):
		push_error("Smoke test failed: local replay action guard invalid %s" % [local_replay_action_guard])
		quit(1)
		return true
	main_node.call("_ui_set_cursor", _row_index_by_id(ui_replay_rows, "replay_action_load"))
	var replay_load_overlay: Dictionary = main_node.call("_ui_overlay_snapshot")
	var replay_load_preview := String(replay_load_overlay.get("control_preview", ""))
	if int(replay_load_overlay.get("control_buttons", 0)) < 1 \
			or not String(replay_load_overlay.get("control_buttons_text", "")).contains("Load Replay") \
			or not replay_load_preview.contains("guard_ok") \
			or not replay_load_preview.contains("loadable_local_practice") \
			or not replay_load_preview.contains("local_practice_hash") \
			or not replay_load_preview.contains("settlement_server"):
		push_error("Smoke test failed: replay load action context button missing %s" % [replay_load_overlay])
		quit(1)
		return true
	var replay_load_button_result: Dictionary = main_node.call("_ui_press_visible_control", 0)
	if not bool(replay_load_button_result.get("ok", false)) or String(replay_load_button_result.get("action", "")) != "accept_selected" or String(replay_load_button_result.get("row_id", "")) != "replay_action_load":
		push_error("Smoke test failed: replay load context button invalid %s" % [replay_load_button_result])
		quit(1)
		return true
	main_node.call("_ui_set_cursor", _row_index_by_id(ui_replay_rows, "replay_action_load"))
	var replay_load_action_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(replay_load_action_result.get("ok", false)) or String(replay_load_action_result.get("action", "")) != "load_replay" or String(replay_load_action_result.get("reason", "")) != "none":
		push_error("Smoke test failed: replay UI load action invalid %s" % [replay_load_action_result])
		quit(1)
		return true
	main_node.call("_ui_set_cursor", _row_index_by_id(ui_replay_rows, "replay_action_favorite"))
	var replay_favorite_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(replay_favorite_result.get("ok", false)) or String(replay_favorite_result.get("action", "")) != "toggle_replay_favorite":
		push_error("Smoke test failed: replay UI favorite action invalid %s" % [replay_favorite_result])
		quit(1)
		return true
	var replay_favorite_restore: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(replay_favorite_restore.get("ok", false)) or String(replay_favorite_restore.get("action", "")) != "toggle_replay_favorite":
		push_error("Smoke test failed: replay UI favorite restore invalid %s" % [replay_favorite_restore])
		quit(1)
		return true
	main_node.call("_ui_set_cursor", local_filter_index)
	var replay_filter_result: Dictionary = main_node.call("_ui_accept_selected")
	if not bool(replay_filter_result.get("ok", false)) or String(replay_filter_result.get("verification_filter", "")) != "replay_local_ready":
		push_error("Smoke test failed: replay UI filter action invalid %s" % [replay_filter_result])
		quit(1)
		return true
	ui_replay_rows = main_node.call("_ui_screen_rows", 14)
	var replay_entry_row := _first_replay_entry_row(ui_replay_rows)
	if replay_entry_row.is_empty() or String(replay_entry_row.get("ui_control", "")) != "replay" or not String(replay_entry_row.get("value", "")).contains("hash") or not String(replay_entry_row.get("summary", "")).contains("local_practice_record") or not String(replay_entry_row.get("summary", "")).contains("local practice final hash ready"):
		push_error("Smoke test failed: replay UI verification summary invalid %s" % [replay_entry_row])
		quit(1)
		return true
	if int(replay_entry_row.get("filtered_index", 0)) <= 0 or int(replay_entry_row.get("filtered_count", 0)) <= 0 or not bool(replay_entry_row.get("selected_in_filter", false)) or String(replay_entry_row.get("active_verification_filter", "")) != "replay_local_ready" or not String(replay_entry_row.get("filter_navigation_label", "")).contains("/"):
		push_error("Smoke test failed: replay UI filtered navigation row invalid %s" % [replay_entry_row])
		quit(1)
		return true
	if not _validate_replay_row_authority(replay_entry_row, "local_practice_verification_only", "server"):
		quit(1)
		return true
	if String(replay_entry_row.get("section", "")) != "replay_local_ready" or String(replay_entry_row.get("section_label_key", "")) != "ui.menu_section_replay_local_ready":
		push_error("Smoke test failed: replay UI verification filter section invalid %s" % [replay_entry_row])
		quit(1)
		return true
	main_node.call("_select_replay_index", 0)
	var selected_replay_summary := String(main_node.call("_selected_replay_summary"))
	var replay_rows: Array[Dictionary] = main_node.call("_replay_list_rows", 4)
	if int(main_node.get("replay_index_cursor")) < 0 or selected_replay_summary.is_empty() or replay_rows.is_empty():
		push_error("Smoke test failed: replay index selection invalid")
		quit(1)
		return true
	stage = "load_seek_replay"
	var selected_row := replay_rows[0]
	if not selected_row.has("saved_at") or not selected_row.has("mode") or not selected_row.has("result") or not selected_row.has("version") or not bool(selected_row.get("can_play", false)):
		push_error("Smoke test failed: replay list row invalid")
		quit(1)
		return true
	if int(selected_row.get("filtered_index", 0)) <= 0 or int(selected_row.get("filtered_count", 0)) <= 0 or String(selected_row.get("filter_navigation_label", "")).is_empty():
		push_error("Smoke test failed: replay list filtered navigation invalid %s" % [selected_row])
		quit(1)
		return true
	if int(selected_row.get("final_result_hash", 0)) == 0 or not bool(selected_row.get("can_verify_final_hash", false)) or String(selected_row.get("verification_status", "")) != "local_final_hash_ready" or String(selected_row.get("verification_scope", "")) != "local_practice_hash" or not String(selected_row.get("verification_summary", "")).contains("local practice final hash ready") or String(selected_row.get("replay_authority_scope", "")) != "local_practice_record":
		push_error("Smoke test failed: replay verification row contract invalid %s" % [selected_row])
		quit(1)
		return true
	if not _validate_replay_row_authority(selected_row, "local_practice_verification_only", "server"):
		quit(1)
		return true
	var saved_snapshot: Dictionary = replay_store.load_snapshot()
	if saved_snapshot.is_empty() or not saved_snapshot.has("input_stream") or not saved_snapshot.has("final_result_hash"):
		push_error("Smoke test failed: saved replay snapshot invalid")
		quit(1)
		return true
	var saved_deck_snapshot: Dictionary = saved_snapshot.get("deck_snapshot", {})
	if saved_deck_snapshot.is_empty() or int(saved_deck_snapshot.get("card_ids", []).size()) != 20:
		push_error("Smoke test failed: saved replay deck snapshot invalid")
		quit(1)
		return true
	if not main_node.call("_load_selected_replay_snapshot") or not bool(main_node.get("replay_mode")):
		push_error("Smoke test failed: selected replay snapshot did not load into replay mode")
		quit(1)
		return true
	var seek_tick: int = min(45, int(saved_snapshot.get("input_stream", []).size()))
	if seek_tick <= 0 or not main_node.call("_seek_replay_to_tick", seek_tick):
		push_error("Smoke test failed: replay seek did not run")
		quit(1)
		return true
	if int(main_node.get("tick")) != seek_tick or not bool(main_node.get("replay_paused")) or String(main_node.get("replay_seek_status")) != "done":
		push_error("Smoke test failed: replay seek landed in invalid state")
		quit(1)
		return true
	stage = "replay_favorite_remove"
	var selected_replay_id := String(latest_replay.get("replay_id", ""))
	if selected_replay_id.is_empty() or not main_node.call("_toggle_selected_replay_favorite"):
		push_error("Smoke test failed: replay favorite toggle failed")
		quit(1)
		return true
	var favorite_entry := _find_replay_index_entry(replay_store.load_index(), selected_replay_id)
	if favorite_entry.is_empty() or not bool(favorite_entry.get("favorite", false)):
		push_error("Smoke test failed: replay favorite flag not stored")
		quit(1)
		return true
	if not String(main_node.call("_selected_replay_summary")).contains("*"):
		push_error("Smoke test failed: replay favorite summary missing marker")
		quit(1)
		return true
	main_node.call("_refresh_replay_index")
	if not main_node.call("_remove_selected_replay_from_index"):
		push_error("Smoke test failed: replay index remove failed")
		quit(1)
		return true
	if not _find_replay_index_entry(replay_store.load_index(), selected_replay_id).is_empty() or not replay_store.latest_exists():
		push_error("Smoke test failed: replay index remove invalid")
		quit(1)
		return true
	stage = "final_hash"
	var final_tick: int = int(saved_snapshot.get("input_stream", []).size())
	if final_tick <= 0 or not main_node.call("_seek_replay_to_tick", final_tick):
		push_error("Smoke test failed: replay final seek did not run")
		quit(1)
		return true
	if String(main_node.get("replay_final_hash_status")) != "valid":
		push_error("Smoke test failed: replay final hash did not validate")
		quit(1)
		return true
	if int(main_node.get("replay_expected_final_hash")) != int(main_node.get("replay_actual_final_hash")):
		push_error("Smoke test failed: replay final hash mismatch")
		quit(1)
		return true
	stage = "i18n_overlay"
	localization.load_defaults("zh-CN", "base")
	if not localization.loaded_packs.has("res://i18n/base.zh-CN.json") or localization.text_for("ui.title") == "SpellKard local client":
		push_error("Smoke test failed: zh-CN i18n overlay did not apply")
		quit(1)
		return true
	var optional_overlay_ok: bool = localization.load_pack("res://i18n/themes/missing.zh-CN.json", false)
	if optional_overlay_ok or not localization.load_errors.is_empty() or not localization.missing_keys.is_empty():
		push_error("Smoke test failed: optional i18n overlay handling invalid")
		quit(1)
		return true
	if not main_node.call("_activate_theme", "base"):
		push_error("Smoke test failed: base theme did not reactivate")
		quit(1)
		return true
	print("client_smoke_test ok: tick=%d bullets=%d perf=%s" % [tick_value, bullet_count, perf.summary()])
	quit(0)
	return true

func _validate_asset_manifests() -> bool:
	var asset_manifest := _read_json_object(ASSET_MANIFEST)
	if asset_manifest.is_empty():
		return false
	if int(asset_manifest.get("schema_version", 0)) <= 0:
		push_error("Smoke test failed: asset manifest schema invalid")
		return false
	if typeof(asset_manifest.get("records", null)) != TYPE_ARRAY:
		push_error("Smoke test failed: asset manifest records invalid")
		return false
	var base_theme_manifest := _read_json_object(BASE_THEME_MANIFEST)
	if base_theme_manifest.is_empty():
		return false
	if String(base_theme_manifest.get("theme_id", "")) != "base":
		push_error("Smoke test failed: base theme manifest invalid")
		return false
	if typeof(base_theme_manifest.get("replaces", null)) != TYPE_ARRAY:
		push_error("Smoke test failed: base theme manifest replaces invalid")
		return false
	return true

func _read_json_object(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("Smoke test failed: missing JSON %s" % path)
		return {}
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("Smoke test failed: invalid JSON object %s" % path)
		return {}
	return parsed

func _validate_workshop_theme_discovery(theme_registry: RefCounted, localization: RefCounted) -> bool:
	var root := "user://workshop/themes"
	var valid_dir := "%s/local_valid" % root
	var invalid_dir := "%s/local_invalid" % root
	var error := DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(valid_dir))
	if error != OK:
		push_error("Smoke test failed: failed to create valid workshop dir")
		return false
	error = DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(invalid_dir))
	if error != OK:
		push_error("Smoke test failed: failed to create invalid workshop dir")
		return false
	if not _write_json("%s/en.json" % valid_dir, {
		"card.none": "theme-none",
		"theme.local_valid.name": "Local Valid Theme",
	}):
		return false
	if not _write_json("%s/theme_manifest.json" % valid_dir, {
		"theme_id": "local_valid",
		"display_name_key": "theme.local_valid.name",
		"version": "0.1.0",
		"asset_license": "see LICENSE.md",
		"replaces": ["text", "sprites"],
		"content_root": valid_dir,
		"text_packs": {"en": "%s/en.json" % valid_dir},
	}):
		return false
	if not _write_json("%s/theme_manifest.json" % invalid_dir, {
		"theme_id": "local_invalid",
		"display_name_key": "theme.local_invalid.name",
		"version": "0.1.0",
		"asset_license": "see LICENSE.md",
		"replaces": ["rules"],
		"content_root": invalid_dir,
	}):
		return false
	var discovered: int = theme_registry.discover_workshop_themes(root)
	if discovered <= 0 or not theme_registry.discovered_theme_ids.has("local_valid"):
		push_error("Smoke test failed: valid workshop theme not discovered")
		return false
	if theme_registry.discovered_theme_ids.has("local_invalid"):
		push_error("Smoke test failed: invalid workshop theme was accepted")
		return false
	if theme_registry.rejected_theme_paths.is_empty():
		push_error("Smoke test failed: invalid workshop theme was not rejected")
		return false
	if String(theme_registry.active_theme_id) != "base":
		push_error("Smoke test failed: workshop discovery changed active theme")
		return false
	if not main_node.call("_activate_theme", "local_valid"):
		push_error("Smoke test failed: discovered workshop theme did not activate")
		return false
	if String(theme_registry.active_theme_id) != "local_valid":
		push_error("Smoke test failed: active workshop theme id invalid")
		return false
	if not localization.loaded_packs.has("%s/en.json" % valid_dir) or localization.text_for("card.none") != "theme-none":
		push_error("Smoke test failed: workshop theme text overlay did not apply")
		return false
	return true

func _write_json(path: String, value: Dictionary) -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Smoke test failed: failed to write %s" % path)
		return false
	file.store_string(JSON.stringify(value, "\t"))
	return true

func _find_replay_index_entry(entries: Array[Dictionary], replay_id: String) -> Dictionary:
	for entry in entries:
		if String(entry.get("replay_id", "")) == replay_id:
			return entry
	return {}

func _validate_replay_row_authority(row: Dictionary, expected_hash_authority: String, expected_settlement_authority: String) -> bool:
	if row.is_empty():
		push_error("Smoke test failed: replay authority row missing")
		return false
	if bool(row.get("client_result_authoritative", true)):
		push_error("Smoke test failed: replay row became client result authoritative %s" % [row])
		return false
	if String(row.get("local_hash_authority", "")) != expected_hash_authority:
		push_error("Smoke test failed: replay local hash authority invalid %s" % [row])
		return false
	if String(row.get("settlement_authority", "")) != expected_settlement_authority or String(row.get("reward_authority", "")) != expected_settlement_authority:
		push_error("Smoke test failed: replay settlement/reward authority invalid %s" % [row])
		return false
	return true

func _validate_menu_scene_contracts(scene_contracts: Array[Dictionary]) -> bool:
	for contract in scene_contracts:
		var scene_id := String(contract.get("scene_id", ""))
		var scene_path := String(contract.get("scene_path", ""))
		if scene_id.is_empty() or scene_path.is_empty() or not ResourceLoader.exists(scene_path):
			push_error("Smoke test failed: menu scene contract missing resource %s" % [contract])
			return false
		var packed_scene = load(scene_path)
		if packed_scene == null or not packed_scene is PackedScene:
			push_error("Smoke test failed: menu scene contract could not load %s" % scene_path)
			return false
		var instance: Node = (packed_scene as PackedScene).instantiate()
		if instance == null:
			push_error("Smoke test failed: menu scene contract could not instantiate %s" % scene_path)
			return false
		var required_bindings: Array = contract.get("required_bindings", [])
		for binding in required_bindings:
			var binding_name := String(binding)
			if instance.find_child(binding_name, true, false) == null:
				instance.free()
				push_error("Smoke test failed: menu scene %s missing binding %s" % [scene_path, binding_name])
				return false
		instance.free()
	return true

func _validate_runtime_scene_backed(snapshot: Dictionary, expected_scene_id: String, min_bindings: int) -> bool:
	if String(snapshot.get("layout_scene_id", "")) != expected_scene_id:
		push_error("Smoke test failed: runtime scene id mismatch expected=%s snapshot=%s" % [expected_scene_id, snapshot])
		return false
	if not bool(snapshot.get("layout_scene_backed", false)):
		push_error("Smoke test failed: runtime scene is not backed by an instantiated scene %s" % [snapshot])
		return false
	if int(snapshot.get("layout_scene_bound_count", 0)) < min_bindings:
		push_error("Smoke test failed: runtime scene binding count too low %s" % [snapshot])
		return false
	if not String(snapshot.get("layout_scene_missing_bindings", "")).is_empty():
		push_error("Smoke test failed: runtime scene has missing bindings %s" % [snapshot])
		return false
	return true

func _find_row_by_id(rows: Array[Dictionary], row_id: String) -> Dictionary:
	for row in rows:
		if String(row.get("id", "")) == row_id:
			return row
	return {}

func _first_replay_entry_row(rows: Array[Dictionary]) -> Dictionary:
	for row in rows:
		if not String(row.get("replay_id", "")).is_empty():
			return row
	return {}

func _find_inventory_item(items: Array[Dictionary], card_id: String) -> Dictionary:
	for item in items:
		if String(item.get("card_id", "")) == card_id:
			return item
	return {}

func _row_index_by_id(rows: Array[Dictionary], row_id: String) -> int:
	for i in range(rows.size()):
		if String(rows[i].get("id", "")) == row_id:
			return i
	return -1

func _rows_have_ids(rows: Array[Dictionary], ids: Array[String]) -> bool:
	var found: Array[String] = []
	for row in rows:
		found.append(String(row.get("id", "")))
	for id in ids:
		if not found.has(id):
			return false
	return true

func _rows_have_key(rows: Array[Dictionary], key: String) -> bool:
	for row in rows:
		if row.has(key):
			return true
	return false

func _rows_have_sections(rows: Array[Dictionary], sections: Array[String]) -> bool:
	var found: Array[String] = []
	for row in rows:
		var section := String(row.get("section", ""))
		if not section.is_empty() and not found.has(section):
			found.append(section)
	for section in sections:
		if not found.has(section):
			return false
	return true

func _rows_have_controls(rows: Array[Dictionary], controls: Array[String]) -> bool:
	var found: Array[String] = []
	for row in rows:
		var control := String(row.get("ui_control", ""))
		if not control.is_empty() and not found.has(control):
			found.append(control)
	for control in controls:
		if not found.has(control):
			return false
	return true

func _row_has_control(rows: Array[Dictionary], row_id: String, control: String) -> bool:
	var row := _find_row_by_id(rows, row_id)
	if row.is_empty():
		return false
	return String(row.get("ui_control", "")) == control

func _row_has_options(rows: Array[Dictionary], row_id: String, minimum_count: int) -> bool:
	var row := _find_row_by_id(rows, row_id)
	if row.is_empty():
		return false
	var options: Array = row.get("control_options", [])
	var option_index := int(row.get("control_option_index", -1))
	return options.size() >= minimum_count and option_index >= 0 and option_index < options.size()

func _row_has_slider_range(rows: Array[Dictionary], row_id: String, min_value: float, max_value: float) -> bool:
	var row := _find_row_by_id(rows, row_id)
	if row.is_empty():
		return false
	if not row.has("control_value") or not row.has("control_min") or not row.has("control_max") or not row.has("control_step"):
		return false
	var actual_min := float(row.get("control_min", 999.0))
	var actual_max := float(row.get("control_max", -999.0))
	var actual_value := float(row.get("control_value", -999.0))
	return absf(actual_min - min_value) <= 0.001 and absf(actual_max - max_value) <= 0.001 and actual_value >= actual_min and actual_value <= actual_max

func _row_has_toggle_value(rows: Array[Dictionary], row_id: String) -> bool:
	var row := _find_row_by_id(rows, row_id)
	if row.is_empty() or not row.has("control_value"):
		return false
	return typeof(row.get("control_value")) == TYPE_BOOL

func _rows_target_controls(rows: Array[Dictionary], expected: Dictionary) -> bool:
	for row_id in expected.keys():
		var row := _find_row_by_id(rows, String(row_id))
		if row.is_empty():
			return false
		if String(row.get("target_row_id", "")) != String(expected[row_id]):
			return false
	return true

func _accept_player_settings_target(rows: Array[Dictionary], row_id: String, expected_screen: String, expected_target_row_id: String) -> bool:
	var cursor := _row_index_by_id(rows, row_id)
	if cursor < 0:
		push_error("Smoke test failed: player settings target row missing %s" % row_id)
		return false
	main_node.call("_ui_set_cursor", cursor)
	var accept_result: Dictionary = main_node.call("_ui_accept_selected")
	var selected_row: Dictionary = main_node.get("ui_screen_model").selected_row()
	if not bool(accept_result.get("ok", false)) or String(accept_result.get("screen", "")) != expected_screen or String(accept_result.get("target_row_id", "")) != expected_target_row_id:
		push_error("Smoke test failed: player settings target accept invalid %s %s" % [row_id, accept_result])
		return false
	if String(main_node.get("ui_screen_model").current_screen) != expected_screen or String(selected_row.get("id", "")) != expected_target_row_id:
		push_error("Smoke test failed: player settings target did not select expected row %s selected=%s" % [row_id, selected_row])
		return false
	return true

func _validate_home_layout_snapshot(snapshot: Dictionary, expected_viewport: Vector2, expected_compact: bool) -> bool:
	if not bool(snapshot.get("home_visible", false)):
		push_error("Smoke test failed: home layout snapshot is not visible %s" % [snapshot])
		return false
	var viewport_size: Vector2 = snapshot.get("viewport_size", Vector2.ZERO)
	var panel_rect: Rect2 = snapshot.get("panel_rect", Rect2())
	var portrait_rect: Rect2 = snapshot.get("home_portrait_rect", Rect2())
	var menu_rect: Rect2 = snapshot.get("home_menu_rect", Rect2())
	var buttons_rect: Rect2 = snapshot.get("home_buttons_rect", Rect2())
	if absf(viewport_size.x - expected_viewport.x) > 1.0 or absf(viewport_size.y - expected_viewport.y) > 1.0:
		push_error("Smoke test failed: viewport size mismatch %s expected %s" % [viewport_size, expected_viewport])
		return false
	var expected_panel_size := Vector2(expected_viewport.x - 36.0, expected_viewport.y - 36.0)
	if panel_rect.position.x < 17.0 or panel_rect.position.y < 17.0 or absf(panel_rect.size.x - expected_panel_size.x) > 1.0 or absf(panel_rect.size.y - expected_panel_size.y) > 1.0:
		push_error("Smoke test failed: home panel did not adapt to viewport panel=%s expected=%s" % [panel_rect, expected_panel_size])
		return false
	if bool(snapshot.get("home_compact", false)) != expected_compact:
		push_error("Smoke test failed: home compact mode mismatch %s expected %s" % [snapshot.get("home_compact", false), expected_compact])
		return false
	if not _rect_inside(panel_rect, portrait_rect) or not _rect_inside(panel_rect, menu_rect) or not _rect_inside(panel_rect, buttons_rect):
		push_error("Smoke test failed: home layout rect outside panel panel=%s portrait=%s menu=%s buttons=%s" % [panel_rect, portrait_rect, menu_rect, buttons_rect])
		return false
	if expected_compact:
		if portrait_rect.size.y < 250.0 or menu_rect.position.y <= portrait_rect.position.y:
			push_error("Smoke test failed: compact home layout did not stack portrait/menu portrait=%s menu=%s" % [portrait_rect, menu_rect])
			return false
	else:
		if portrait_rect.size.x < panel_rect.size.x * 0.55 or menu_rect.position.x <= portrait_rect.position.x:
			push_error("Smoke test failed: wide home layout did not reserve portrait column portrait=%s menu=%s panel=%s" % [portrait_rect, menu_rect, panel_rect])
			return false
	if buttons_rect.size.x < 220.0 or buttons_rect.size.y < 208.0:
		push_error("Smoke test failed: home buttons area too small %s" % [buttons_rect])
		return false
	return true

func _rect_inside(outer: Rect2, inner: Rect2) -> bool:
	if inner.size.x <= 0.0 or inner.size.y <= 0.0:
		return false
	return inner.position.x >= outer.position.x - 1.0 and inner.position.y >= outer.position.y - 1.0 and inner.end.x <= outer.end.x + 1.0 and inner.end.y <= outer.end.y + 1.0

func _validate_row_label_keys(rows: Array[Dictionary], localization: RefCounted) -> bool:
	for row in rows:
		var label_key := String(row.get("label_key", ""))
		if label_key.is_empty():
			continue
		if not localization.has_text(label_key):
			push_error("Smoke test failed: missing screen label key %s" % label_key)
			return false
	return true

func _validate_boss_party_row_contract(row: Dictionary, mode_id: String, expected_count: int) -> bool:
	if row.is_empty():
		push_error("Smoke test failed: boss party row missing for %s" % mode_id)
		return false
	var positions: Array = row.get("items", [])
	var display_slots: Array = row.get("display_slots", [])
	if String(row.get("mode_id", "")) != mode_id or String(row.get("mode_category", "")) != "boss":
		push_error("Smoke test failed: boss party row mode contract invalid %s" % [row])
		return false
	if int(row.get("player_count", 0)) != expected_count or positions.size() != expected_count or int(row.get("min_players", 0)) != 4 or int(row.get("max_players", 0)) != 8:
		push_error("Smoke test failed: boss party row count contract invalid %s" % [row])
		return false
	if String(row.get("aim_policy", "")) != "toward_center" or String(row.get("friendly_fire", "")) != "disabled" or bool(row.get("client_result_authoritative", true)):
		push_error("Smoke test failed: boss party row authority/display contract invalid %s" % [row])
		return false
	var expected_layout_policy := "cardinal_4" if expected_count == 4 else ("eight_direction_8" if expected_count == 8 else "even_ring_%d" % expected_count)
	if String(row.get("slot_layout_policy", "")) != expected_layout_policy:
		push_error("Smoke test failed: boss party layout policy invalid %s" % [row])
		return false
	var expected_labels := _expected_boss_slot_labels(expected_count)
	var slot_labels: Array = row.get("slot_labels", [])
	if slot_labels.size() != expected_labels.size():
		push_error("Smoke test failed: boss party slot labels missing %s" % [row])
		return false
	for i in range(expected_labels.size()):
		if String(slot_labels[i]) != expected_labels[i]:
			push_error("Smoke test failed: boss party slot label invalid %s expected=%s" % [row, expected_labels])
			return false
	if display_slots.size() != expected_count:
		push_error("Smoke test failed: boss party display slots missing %s" % [row])
		return false
	for i in range(positions.size()):
		var position: Variant = positions[i]
		var entry: Dictionary = position
		var spawn: Vector2 = entry.get("spawn", Vector2.ZERO)
		var aim: Vector2 = entry.get("aim", Vector2.ZERO)
		if String(entry.get("slot_layout_policy", "")) != expected_layout_policy or String(entry.get("slot_label", "")) != expected_labels[i]:
			push_error("Smoke test failed: boss position layout metadata invalid %s expected=%s" % [entry, expected_labels])
			return false
		if not bool(entry.get("aim_to_center", false)) or entry.get("aim_target", Vector2.INF) != Vector2.ZERO:
			push_error("Smoke test failed: boss position does not target center %s" % [entry])
			return false
		if spawn.length() < 0.99 or spawn.length() > 1.01 or aim.length() < 0.99 or aim.length() > 1.01 or spawn.dot(aim) > -0.99:
			push_error("Smoke test failed: boss position vectors invalid %s" % [entry])
			return false
	if not _validate_boss_formation_contract(row.get("formation_contract", {}), mode_id, expected_count):
		return false
	if not _validate_boss_formation_display_summary(row.get("formation_display_summary", {}), mode_id, expected_count):
		return false
	return true

func _validate_boss_formation_display_summary(summary: Dictionary, mode_id: String, expected_count: int) -> bool:
	if summary.is_empty():
		push_error("Smoke test failed: boss formation display summary missing for %s" % mode_id)
		return false
	if not bool(summary.get("ok", false)) or String(summary.get("mode_id", "")) != mode_id or String(summary.get("mode_category", "")) != "boss":
		push_error("Smoke test failed: boss formation display summary identity invalid %s" % [summary])
		return false
	if String(summary.get("display_summary_kind", "")) != "boss_formation_display_summary":
		push_error("Smoke test failed: boss formation display summary kind invalid %s" % [summary])
		return false
	if String(summary.get("projection_scope", "")) != "local_display_only" or String(summary.get("damage_authority", "")) != "server" or String(summary.get("reward_authority", "")) != "server" or String(summary.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss formation display summary authority labels invalid %s" % [summary])
		return false
	if bool(summary.get("client_result_authoritative", true)) or not bool(summary.get("requires_server_confirmation", false)):
		push_error("Smoke test failed: boss formation display summary authority flags invalid %s" % [summary])
		return false
	var expected_layout_policy := "cardinal_4" if expected_count == 4 else ("eight_direction_8" if expected_count == 8 else "even_ring_%d" % expected_count)
	if int(summary.get("player_count", 0)) != expected_count or int(summary.get("slot_count", 0)) != expected_count or String(summary.get("slot_layout_policy", "")) != expected_layout_policy:
		push_error("Smoke test failed: boss formation display summary count/layout invalid %s" % [summary])
		return false
	if not bool(summary.get("fixed_direction_display", false)) or not bool(summary.get("center_aim_valid", false)) or not bool(summary.get("all_slots_face_center", false)):
		push_error("Smoke test failed: boss formation display summary center aim invalid %s" % [summary])
		return false
	if (summary.get("center_normalized", Vector2.INF) as Vector2).distance_to(Vector2(0.5, 0.5)) > 0.001 or absf(float(summary.get("display_radius_ratio", 0.0)) - 0.42) > 0.001:
		push_error("Smoke test failed: boss formation display summary geometry invalid %s" % [summary])
		return false
	var expected_labels := _expected_boss_slot_labels(expected_count)
	var labels: Array = summary.get("slot_labels", [])
	var slot_summaries: Array = summary.get("slot_summaries", [])
	var slot_points: Array = summary.get("slot_points", [])
	if labels.size() != expected_count or slot_summaries.size() != expected_count or slot_points.size() != expected_count:
		push_error("Smoke test failed: boss formation display summary slots missing %s" % [summary])
		return false
	for i in range(expected_count):
		if String(labels[i]) != expected_labels[i] or not String(slot_summaries[i]).contains(expected_labels[i]):
			push_error("Smoke test failed: boss formation display summary label invalid %s expected=%s" % [summary, expected_labels])
			return false
		var point: Dictionary = slot_points[i]
		var normalized_position: Vector2 = point.get("normalized_display_position", Vector2.ZERO)
		var aim_vector: Vector2 = point.get("aim_vector", Vector2.ZERO)
		if int(point.get("slot_index", -1)) != i or String(point.get("slot_label", "")) != expected_labels[i] or bool(point.get("client_result_authoritative", true)):
			push_error("Smoke test failed: boss formation display point identity invalid %s" % [point])
			return false
		if normalized_position.x < 0.05 or normalized_position.x > 0.95 or normalized_position.y < 0.05 or normalized_position.y > 0.95:
			push_error("Smoke test failed: boss formation display point out of bounds %s" % [point])
			return false
		if not bool(point.get("aim_to_center", false)) or aim_vector.length() < 0.99 or aim_vector.length() > 1.01:
			push_error("Smoke test failed: boss formation display point aim invalid %s" % [point])
			return false
	if int(summary.get("formation_display_signature", 0)) == 0 or not String(summary.get("formation_display_signature_source", "")).contains(expected_layout_policy):
		push_error("Smoke test failed: boss formation display signature invalid %s" % [summary])
		return false
	return true

func _validate_boss_formation_contract(contract: Dictionary, mode_id: String, expected_count: int) -> bool:
	if contract.is_empty():
		push_error("Smoke test failed: boss formation contract missing for %s" % mode_id)
		return false
	if not bool(contract.get("ok", false)) or String(contract.get("mode_id", "")) != mode_id or String(contract.get("mode_category", "")) != "boss":
		push_error("Smoke test failed: boss formation contract identity invalid %s" % [contract])
		return false
	if int(contract.get("slot_count", 0)) != expected_count or int(contract.get("min_players", 0)) != 4 or int(contract.get("max_players", 0)) != 8:
		push_error("Smoke test failed: boss formation contract counts invalid %s" % [contract])
		return false
	var fixed_counts: Array = contract.get("fixed_direction_counts", [])
	if not fixed_counts.has(4) or not fixed_counts.has(8):
		push_error("Smoke test failed: boss formation contract missing fixed direction counts %s" % [contract])
		return false
	var expected_layout_policy := "cardinal_4" if expected_count == 4 else ("eight_direction_8" if expected_count == 8 else "even_ring_%d" % expected_count)
	if String(contract.get("slot_layout_policy", "")) != expected_layout_policy:
		push_error("Smoke test failed: boss formation contract layout invalid %s expected=%s" % [contract, expected_layout_policy])
		return false
	if String(contract.get("spawn_space", "")) != "unit_ring" or String(contract.get("aim_policy", "")) != "toward_center" or String(contract.get("shooting_target", "")) != "boss_center":
		push_error("Smoke test failed: boss formation contract aim/spawn invalid %s" % [contract])
		return false
	if not bool(contract.get("all_slots_face_center", false)) or (contract.get("boss_center", Vector2.INF) as Vector2).distance_to(Vector2.ZERO) > 0.001:
		push_error("Smoke test failed: boss formation contract center target invalid %s" % [contract])
		return false
	if (contract.get("center_normalized", Vector2.INF) as Vector2).distance_to(Vector2(0.5, 0.5)) > 0.001 or absf(float(contract.get("display_radius_ratio", 0.0)) - 0.42) > 0.001:
		push_error("Smoke test failed: boss formation contract display geometry invalid %s" % [contract])
		return false
	if String(contract.get("projection_scope", "")) != "local_display_only" or String(contract.get("damage_authority", "")) != "server" or String(contract.get("reward_authority", "")) != "server" or String(contract.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss formation contract authority labels invalid %s" % [contract])
		return false
	if not bool(contract.get("requires_server_confirmation", false)) or bool(contract.get("client_result_authoritative", true)):
		push_error("Smoke test failed: boss formation contract authority flags invalid %s" % [contract])
		return false
	var expected_labels := _expected_boss_slot_labels(expected_count)
	var labels: Array = contract.get("slot_labels", [])
	if labels.size() != expected_labels.size():
		push_error("Smoke test failed: boss formation contract labels missing %s" % [contract])
		return false
	for i in range(expected_labels.size()):
		if String(labels[i]) != expected_labels[i]:
			push_error("Smoke test failed: boss formation contract label invalid %s expected=%s" % [contract, expected_labels])
			return false
	return true

func _validate_boss_playfield_projection(row: Dictionary, mode_id: String, expected_count: int, expected_hp_ratio: float) -> bool:
	if row.is_empty():
		push_error("Smoke test failed: boss playfield row missing for %s" % mode_id)
		return false
	var projection: Dictionary = row.get("playfield_projection", row)
	if projection.is_empty():
		push_error("Smoke test failed: boss playfield projection missing %s" % [row])
		return false
	var slots: Array = projection.get("display_slots", [])
	var center: Vector2 = projection.get("center_normalized", Vector2.INF)
	var screen_center: Vector2 = projection.get("screen_center", Vector2.INF)
	var screen_bounds: Rect2 = projection.get("screen_bounds", Rect2())
	if String(projection.get("mode_id", "")) != mode_id or String(projection.get("mode_category", "")) != "boss" or String(projection.get("display_kind", "")) != "boss_playfield_projection":
		push_error("Smoke test failed: boss playfield identity invalid %s" % [projection])
		return false
	if String(projection.get("projection_scope", "")) != "local_display_only" or String(projection.get("damage_authority", "")) != "server" or String(projection.get("reward_authority", "")) != "server" or String(projection.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss playfield authority labels invalid %s" % [projection])
		return false
	if bool(projection.get("client_result_authoritative", true)) or not bool(projection.get("requires_server_confirmation", false)):
		push_error("Smoke test failed: boss playfield authority contract invalid %s" % [projection])
		return false
	if bool(projection.get("persistent_hp", false)) != (mode_id == "world_boss"):
		push_error("Smoke test failed: boss playfield persistence invalid %s" % [projection])
		return false
	if int(projection.get("player_count", 0)) != expected_count or slots.size() != expected_count or not bool(projection.get("formation_valid", false)):
		push_error("Smoke test failed: boss playfield slots invalid %s" % [projection])
		return false
	if not _validate_boss_formation_contract(projection.get("formation_contract", {}), mode_id, expected_count):
		return false
	if not _validate_boss_formation_display_summary(projection.get("formation_display_summary", {}), mode_id, expected_count):
		return false
	if absf(float(projection.get("hp_ratio", -1.0)) - expected_hp_ratio) > 0.001:
		push_error("Smoke test failed: boss playfield hp ratio invalid %s expected %.3f" % [projection, expected_hp_ratio])
		return false
	if center.distance_to(Vector2(0.5, 0.5)) > 0.001 or absf(float(projection.get("display_radius_ratio", 0.0)) - 0.42) > 0.001:
		push_error("Smoke test failed: boss playfield center/radius invalid %s" % [projection])
		return false
	if screen_center == Vector2.INF or screen_bounds.size.x <= 0.0 or screen_bounds.size.y <= 0.0 or float(projection.get("screen_radius_pixels", 0.0)) <= 0.0:
		push_error("Smoke test failed: boss playfield screen geometry invalid %s" % [projection])
		return false
	var expected_labels := _expected_boss_slot_labels(expected_count)
	if (projection.get("slot_labels", []) as Array).size() != expected_labels.size():
		push_error("Smoke test failed: boss playfield slot labels missing %s" % [projection])
		return false
	for i in range(slots.size()):
		var slot: Dictionary = slots[i]
		var aim_vector: Vector2 = slot.get("aim_vector", Vector2.ZERO)
		if String(slot.get("mode_id", "")) != mode_id or int(slot.get("slot_index", -1)) != i or String(slot.get("slot_label", "")) != expected_labels[i]:
			push_error("Smoke test failed: boss playfield slot identity invalid %s expected=%s" % [slot, expected_labels])
			return false
		if bool(slot.get("client_result_authoritative", true)) or not bool(slot.get("aim_to_center", false)) or aim_vector.length() < 0.99:
			push_error("Smoke test failed: boss playfield slot authority/aim invalid %s" % [slot])
			return false
		if not _validate_boss_formation_contract(slot.get("formation_contract", {}), mode_id, expected_count):
			return false
	if row.has("projection_scope") and (String(row.get("projection_scope", "")) != "local_display_only" or String(row.get("damage_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server" or bool(row.get("client_result_authoritative", true))):
		push_error("Smoke test failed: boss playfield row authority invalid %s" % [row])
		return false
	if row.has("formation_contract") and not _validate_boss_formation_contract(row.get("formation_contract", {}), mode_id, expected_count):
		return false
	if row.has("formation_display_summary") and not _validate_boss_formation_display_summary(row.get("formation_display_summary", {}), mode_id, expected_count):
		return false
	return true

func _validate_boss_hud_projection(row: Dictionary, mode_id: String, expected_count: int, expected_hp_ratio: float) -> bool:
	if row.is_empty():
		push_error("Smoke test failed: boss HUD row missing for %s" % mode_id)
		return false
	var projection: Dictionary = row.get("hud_projection", row)
	if projection.is_empty():
		push_error("Smoke test failed: boss HUD projection missing %s" % [row])
		return false
	if String(projection.get("mode_id", "")) != mode_id or String(projection.get("mode_category", "")) != "boss" or String(projection.get("display_kind", "")) != "boss_hud_projection":
		push_error("Smoke test failed: boss HUD identity invalid %s" % [projection])
		return false
	if String(projection.get("projection_scope", "")) != "local_display_only" or String(projection.get("damage_authority", "")) != "server" or String(projection.get("reward_authority", "")) != "server" or String(projection.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss HUD authority labels invalid %s" % [projection])
		return false
	if bool(projection.get("client_result_authoritative", true)) or not bool(projection.get("requires_server_confirmation", false)):
		push_error("Smoke test failed: boss HUD authority contract invalid %s" % [projection])
		return false
	if bool(projection.get("persistent_hp", false)) != (mode_id == "world_boss"):
		push_error("Smoke test failed: boss HUD persistence invalid %s" % [projection])
		return false
	if int(projection.get("player_count", 0)) != expected_count or int(projection.get("min_players", 0)) != 4 or int(projection.get("max_players", 0)) != 8:
		push_error("Smoke test failed: boss HUD party count invalid %s" % [projection])
		return false
	if not _validate_boss_formation_contract(projection.get("formation_contract", {}), mode_id, expected_count):
		return false
	if not _validate_boss_formation_display_summary(projection.get("formation_display_summary", {}), mode_id, expected_count):
		return false
	if absf(float(projection.get("hp_ratio", -1.0)) - expected_hp_ratio) > 0.001:
		push_error("Smoke test failed: boss HUD hp ratio invalid %s expected %.3f" % [projection, expected_hp_ratio])
		return false
	if String(projection.get("hp_text", "")).is_empty() or not String(projection.get("hud_status_text", "")).contains("server") and String(projection.get("damage_authority", "")) != "server":
		push_error("Smoke test failed: boss HUD text invalid %s" % [projection])
		return false
	if (projection.get("display_slots", []) as Array).size() != expected_count:
		push_error("Smoke test failed: boss HUD display slots invalid %s" % [projection])
		return false
	if row.has("projection_scope") and (String(row.get("projection_scope", "")) != "local_display_only" or String(row.get("damage_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server" or bool(row.get("client_result_authoritative", true))):
		push_error("Smoke test failed: boss HUD row authority invalid %s" % [row])
		return false
	if row.has("formation_contract") and not _validate_boss_formation_contract(row.get("formation_contract", {}), mode_id, expected_count):
		return false
	if row.has("formation_display_summary") and not _validate_boss_formation_display_summary(row.get("formation_display_summary", {}), mode_id, expected_count):
		return false
	return _validate_boss_playfield_projection({"playfield_projection": projection.get("playfield_projection", {})}, mode_id, expected_count, expected_hp_ratio)

func _validate_boss_display_contract_row(row: Dictionary, mode_id: String, expected_count: int, expected_hp_ratio: float, expected_entry_ready: bool) -> bool:
	if row.is_empty():
		push_error("Smoke test failed: boss display contract row missing for %s" % mode_id)
		return false
	if String(row.get("mode_id", "")) != mode_id or String(row.get("mode_category", "")) != "boss":
		push_error("Smoke test failed: boss display contract identity invalid %s" % [row])
		return false
	if String(row.get("display_scope", "")) != "local_display_only" or String(row.get("projection_scope", "")) != "local_display_only":
		push_error("Smoke test failed: boss display contract scope invalid %s" % [row])
		return false
	if String(row.get("intent_authority", "")) != "client_request_only" or String(row.get("damage_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss display contract authority labels invalid %s" % [row])
		return false
	if bool(row.get("client_result_authoritative", true)) or not bool(row.get("requires_server_confirmation", false)):
		push_error("Smoke test failed: boss display contract authority flags invalid %s" % [row])
		return false
	if bool(row.get("persistent_hp", false)) != (mode_id == "world_boss"):
		push_error("Smoke test failed: boss display persistence invalid %s" % [row])
		return false
	if not bool(row.get("display_ready", false)) or String(row.get("display_status", "")) != "ready" or not (row.get("display_blockers", []) as Array).is_empty():
		push_error("Smoke test failed: boss display should be ready after valid formation %s" % [row])
		return false
	if int(row.get("player_count", 0)) != expected_count or int((row.get("display_slots", []) as Array).size()) != expected_count:
		push_error("Smoke test failed: boss display slot count invalid %s" % [row])
		return false
	if bool(row.get("entry_valid", false)) != expected_entry_ready:
		push_error("Smoke test failed: boss display entry readiness invalid %s expected=%s" % [row, expected_entry_ready])
		return false
	if expected_entry_ready and String(row.get("entry_server_confirmation_status", "")) != "required":
		push_error("Smoke test failed: boss display entry confirmation missing %s" % [row])
		return false
	if not expected_entry_ready and not (row.get("entry_failures", []) as Array).has("entry_locked"):
		push_error("Smoke test failed: boss display entry failures missing lock %s" % [row])
		return false
	if absf(float(row.get("hp_ratio", -1.0)) - expected_hp_ratio) > 0.001:
		push_error("Smoke test failed: boss display hp ratio invalid %s expected %.3f" % [row, expected_hp_ratio])
		return false
	if not bool(row.get("formation_valid", false)) or String(row.get("slot_layout_policy", "")).is_empty() or (row.get("slot_labels", []) as Array).size() != expected_count:
		push_error("Smoke test failed: boss display formation summary invalid %s" % [row])
		return false
	if not _validate_boss_formation_contract(row.get("formation_contract", {}), mode_id, expected_count):
		return false
	if not _validate_boss_formation_display_summary(row.get("formation_display_summary", {}), mode_id, expected_count):
		return false
	if not _validate_boss_playfield_projection({"playfield_projection": row.get("playfield_projection", {})}, mode_id, expected_count, expected_hp_ratio):
		return false
	if not _validate_boss_hud_projection({"hud_projection": row.get("hud_projection", {})}, mode_id, expected_count, expected_hp_ratio):
		return false
	return true

func _validate_boss_practice_preview_card_row(row: Dictionary, mode_id: String) -> bool:
	if row.is_empty():
		push_error("Smoke test failed: boss practice preview card missing for %s" % mode_id)
		return false
	if String(row.get("mode_id", "")) != mode_id or String(row.get("mode_category", "")) != "boss":
		push_error("Smoke test failed: boss practice preview card identity invalid %s" % [row])
		return false
	if String(row.get("preview_card_kind", "")) != "boss_spellbook_practice_preview" or String(row.get("overview_card_kind", "")) != "boss_practice_preview":
		push_error("Smoke test failed: boss practice preview card kind invalid %s" % [row])
		return false
	if String(row.get("ui_control", "")) != "card" or String(row.get("render_slot", "")) != "mode_cards" or String(row.get("section", "")) != "boss_preview":
		push_error("Smoke test failed: boss practice preview card UI contract invalid %s" % [row])
		return false
	if String(row.get("projection_scope", "")) != "local_practice_preview_only" or String(row.get("preview_authority_scope", "")) != "local_practice_preview_only":
		push_error("Smoke test failed: boss practice preview card scope invalid %s" % [row])
		return false
	if String(row.get("replay_verification_scope", "")) != "local_practice_hash" or bool(row.get("requires_server_confirmation", true)):
		push_error("Smoke test failed: boss practice preview replay/confirmation invalid %s" % [row])
		return false
	if String(row.get("damage_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss practice preview online authority invalid %s" % [row])
		return false
	if bool(row.get("client_result_authoritative", true)) or bool(row.get("server_authoritative", true)):
		push_error("Smoke test failed: boss practice preview card authority flags invalid %s" % [row])
		return false
	var metrics: Array = row.get("preview_card_metrics", [])
	var badges: Array = row.get("preview_card_authority_badges", [])
	if metrics.size() < 5 or not badges.has("local_practice_preview_only") or not badges.has("damage_server") or not badges.has("settlement_server"):
		push_error("Smoke test failed: boss practice preview card metrics/badges invalid %s" % [row])
		return false
	if not String(row.get("preview_card_primary_metric", "")).contains("digest") or not String(row.get("preview_card_secondary_metric", "")).contains("headroom"):
		push_error("Smoke test failed: boss practice preview card metric text invalid %s" % [row])
		return false
	if int(row.get("preview_bundle_signature_digest", 0)) <= 0 or int(row.get("preview_phase_count", 0)) < 3 or String(row.get("performance_budget_status", "")) != "within_budget":
		push_error("Smoke test failed: boss practice preview deterministic bundle invalid %s" % [row])
		return false
	return true

func _validate_boss_draw_snapshot(snapshot: Dictionary, mode_id: String, expected_count: int, expected_hp_ratio: float) -> bool:
	if not bool(snapshot.get("enabled", false)) or not bool(snapshot.get("gameplay_visible", false)):
		push_error("Smoke test failed: boss draw snapshot disabled %s" % [snapshot])
		return false
	if String(snapshot.get("mode_id", "")) != mode_id or int(snapshot.get("slot_count", 0)) != expected_count:
		push_error("Smoke test failed: boss draw snapshot identity invalid %s" % [snapshot])
		return false
	if String(snapshot.get("projection_scope", "")) != "local_display_only" or String(snapshot.get("damage_authority", "")) != "server" or String(snapshot.get("reward_authority", "")) != "server" or String(snapshot.get("settlement_authority", "")) != "server" or bool(snapshot.get("client_result_authoritative", true)):
		push_error("Smoke test failed: boss draw snapshot authority invalid %s" % [snapshot])
		return false
	if absf(float(snapshot.get("hp_ratio", -1.0)) - expected_hp_ratio) > 0.001:
		push_error("Smoke test failed: boss draw snapshot hp invalid %s" % [snapshot])
		return false
	if not _validate_boss_hud_projection({"hud_projection": snapshot.get("hud_projection", {})}, mode_id, expected_count, expected_hp_ratio):
		return false
	return _validate_boss_playfield_projection({"playfield_projection": snapshot.get("projection", {})}, mode_id, expected_count, expected_hp_ratio)

func _validate_boss_result_authority_row(row: Dictionary, mode_id: String, expect_server_projection: bool) -> bool:
	if row.is_empty():
		push_error("Smoke test failed: boss result row missing for %s" % mode_id)
		return false
	if String(row.get("mode_id", "")) != mode_id or String(row.get("mode_category", "")) != "boss":
		push_error("Smoke test failed: boss result identity invalid %s" % [row])
		return false
	if bool(row.get("client_result_authoritative", true)):
		push_error("Smoke test failed: boss result became client-authoritative %s" % [row])
		return false
	if String(row.get("damage_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss result authority labels invalid %s" % [row])
		return false
	if not bool(row.get("requires_server_confirmation", false)):
		push_error("Smoke test failed: boss result missing server confirmation flag %s" % [row])
		return false
	if bool(row.get("persistent_hp", false)) != (mode_id == "world_boss"):
		push_error("Smoke test failed: boss result persistence invalid %s" % [row])
		return false
	if bool(row.get("server_authoritative", false)) != expect_server_projection:
		push_error("Smoke test failed: boss result server projection state invalid %s expected=%s" % [row, expect_server_projection])
		return false
	if expect_server_projection and String(row.get("result_source", "")) != "server_settlement_projection":
		push_error("Smoke test failed: boss result source invalid %s" % [row])
		return false
	if not expect_server_projection and String(row.get("result_source", "")) == "server_settlement_projection":
		push_error("Smoke test failed: boss rejected result carried server projection %s" % [row])
		return false
	if expect_server_projection:
		if String(row.get("receipt_source", "")) != "server_settlement_receipt" or String(row.get("result_receipt_id", "")).is_empty():
			push_error("Smoke test failed: boss result missing settlement receipt %s" % [row])
			return false
		if String(row.get("result_hash", "")).is_empty():
			push_error("Smoke test failed: boss result missing server result hash %s" % [row])
			return false
		if String(row.get("ui_control", "")) != "card" or String(row.get("receipt_card_kind", "")) != "boss_server_settlement_receipt" or String(row.get("overview_card_kind", "")) != "boss_result_receipt":
			push_error("Smoke test failed: boss result receipt card metadata invalid %s" % [row])
			return false
		if String(row.get("render_slot", "")) != "mode_cards":
			push_error("Smoke test failed: boss result receipt card render slot invalid %s" % [row])
			return false
		if not String(row.get("receipt_card_primary_metric", "")).contains(String(row.get("result_receipt_id", ""))) or not String(row.get("receipt_card_secondary_metric", "")).contains(String(row.get("result_hash", ""))):
			push_error("Smoke test failed: boss result receipt card metrics invalid %s" % [row])
			return false
		var metrics: Array = row.get("receipt_card_metrics", [])
		var badges: Array = row.get("receipt_card_authority_badges", [])
		if metrics.size() < 5 or not badges.has("server_settlement_receipt") or not badges.has("damage_server") or not badges.has("reward_server") or not badges.has("settlement_server"):
			push_error("Smoke test failed: boss result receipt card badges invalid %s" % [row])
			return false
		if typeof(row.get("receipt_card", {})) != TYPE_DICTIONARY:
			push_error("Smoke test failed: boss result nested receipt card missing %s" % [row])
			return false
		var card: Dictionary = row.get("receipt_card", {})
		if String(card.get("receipt_card_kind", "")) != "boss_server_settlement_receipt" or bool(card.get("client_result_authoritative", true)) or String(card.get("result_receipt_id", "")) != String(row.get("result_receipt_id", "")) or String(card.get("result_hash", "")) != String(row.get("result_hash", "")):
			push_error("Smoke test failed: boss result nested receipt card invalid %s row=%s" % [card, row])
			return false
	else:
		if String(row.get("receipt_source", "")) == "server_settlement_receipt" or not String(row.get("result_receipt_id", "")).is_empty():
			push_error("Smoke test failed: boss rejected result carried settlement receipt %s" % [row])
			return false
	return true

func _validate_boss_entry_preview(preview: Dictionary, mode_id: String, expected_ok: bool, expected_reason: String) -> bool:
	if preview.is_empty():
		push_error("Smoke test failed: boss entry preview missing for %s" % mode_id)
		return false
	if String(preview.get("mode_id", "")) != mode_id or String(preview.get("mode_category", "")) != "boss":
		push_error("Smoke test failed: boss entry preview identity invalid %s" % [preview])
		return false
	if bool(preview.get("ok", false)) != expected_ok or String(preview.get("reason", "")) != expected_reason:
		push_error("Smoke test failed: boss entry preview result invalid %s expected ok=%s reason=%s" % [preview, expected_ok, expected_reason])
		return false
	if String(preview.get("local_validation", "")) != "boss_entry_preflight":
		push_error("Smoke test failed: boss entry preview validation label invalid %s" % [preview])
		return false
	var rules: Array = preview.get("local_validation_rules", [])
	if not rules.has("attempts_available") or not rules.has("party_size") or not rules.has("rating_requirement") or not rules.has("key_requirement"):
		push_error("Smoke test failed: boss entry preview rules invalid %s" % [preview])
		return false
	if String(preview.get("intent_authority", "")) != "client_request_only" or not bool(preview.get("requires_server_confirmation", false)):
		push_error("Smoke test failed: boss entry preview intent authority invalid %s" % [preview])
		return false
	if String(preview.get("damage_authority", "")) != "server" or String(preview.get("reward_authority", "")) != "server" or String(preview.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss entry preview server authority invalid %s" % [preview])
		return false
	if bool(preview.get("client_result_authoritative", true)):
		push_error("Smoke test failed: boss entry preview became client authoritative %s" % [preview])
		return false
	var expected_confirmation := "required" if expected_ok else "blocked_local"
	if String(preview.get("server_confirmation_status", "")) != expected_confirmation:
		push_error("Smoke test failed: boss entry preview confirmation status invalid %s expected=%s" % [preview, expected_confirmation])
		return false
	return true

func _validate_boss_action_availability(projection: Dictionary, mode_id: String, expected_entry_ok: bool, expected_reason: String, expected_count: int) -> bool:
	if projection.is_empty():
		push_error("Smoke test failed: boss action availability missing for %s" % mode_id)
		return false
	if String(projection.get("mode_id", "")) != mode_id or String(projection.get("mode_category", "")) != "boss":
		push_error("Smoke test failed: boss action availability identity invalid %s" % [projection])
		return false
	if String(projection.get("projection_scope", "")) != "local_display_only" or String(projection.get("intent_authority", "")) != "client_request_only":
		push_error("Smoke test failed: boss action availability scope invalid %s" % [projection])
		return false
	if String(projection.get("damage_authority", "")) != "server" or String(projection.get("reward_authority", "")) != "server" or String(projection.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss action availability authority labels invalid %s" % [projection])
		return false
	if bool(projection.get("client_result_authoritative", true)) or not bool(projection.get("requires_server_confirmation", false)):
		push_error("Smoke test failed: boss action availability authority flags invalid %s" % [projection])
		return false
	if bool(projection.get("entry_valid", false)) != expected_entry_ok or bool(projection.get("can_request_entry", false)) != expected_entry_ok:
		push_error("Smoke test failed: boss action availability entry state invalid %s expected=%s" % [projection, expected_entry_ok])
		return false
	if String(projection.get("reason", "")) != expected_reason:
		push_error("Smoke test failed: boss action availability reason invalid %s expected=%s" % [projection, expected_reason])
		return false
	var blockers: Array = projection.get("local_blockers", [])
	if expected_entry_ok:
		if not blockers.is_empty() or String(projection.get("action_status", "")) != "ready_for_server_entry" or String(projection.get("server_confirmation_status", "")) != "required":
			push_error("Smoke test failed: boss action availability ready state invalid %s" % [projection])
			return false
	else:
		if not blockers.has(expected_reason) or String(projection.get("action_status", "")) != "blocked_local" or String(projection.get("server_confirmation_status", "")) != "blocked_local":
			push_error("Smoke test failed: boss action availability blocked state invalid %s" % [projection])
			return false
	if not bool(projection.get("display_ready", false)) or not bool(projection.get("can_display_playfield", false)):
		push_error("Smoke test failed: boss action availability display should stay ready with valid formation %s" % [projection])
		return false
	if int(projection.get("player_count", 0)) != expected_count or String(projection.get("slot_layout_policy", "")).is_empty() or (projection.get("slot_labels", []) as Array).size() != expected_count:
		push_error("Smoke test failed: boss action availability formation summary invalid %s" % [projection])
		return false
	if not bool(projection.get("can_request_transfer", false)):
		push_error("Smoke test failed: boss action availability should allow transfer intent for valid party %s" % [projection])
		return false
	if not _validate_boss_entry_preview(projection.get("entry_preflight", {}), mode_id, expected_entry_ok, expected_reason):
		return false
	if not _validate_boss_playfield_projection({"playfield_projection": projection.get("playfield_projection", {})}, mode_id, expected_count, 1.0):
		return false
	return _validate_boss_hud_projection({"hud_projection": projection.get("hud_projection", {})}, mode_id, expected_count, 1.0)

func _validate_boss_transfer_preview(preview: Dictionary, mode_id: String, expected_ok: bool, expected_reason: String) -> bool:
	if preview.is_empty():
		push_error("Smoke test failed: boss transfer preview missing for %s" % mode_id)
		return false
	if String(preview.get("mode_id", "")) != mode_id or String(preview.get("mode_category", "")) != "boss":
		push_error("Smoke test failed: boss transfer preview identity invalid %s" % [preview])
		return false
	if bool(preview.get("ok", false)) != expected_ok or String(preview.get("reason", "")) != expected_reason:
		push_error("Smoke test failed: boss transfer preview result invalid %s expected ok=%s reason=%s" % [preview, expected_ok, expected_reason])
		return false
	if String(preview.get("local_validation", "")) != "boss_transfer_preflight":
		push_error("Smoke test failed: boss transfer preview validation label invalid %s" % [preview])
		return false
	var rules: Array = preview.get("local_validation_rules", [])
	if not rules.has("party_members_only") or not rules.has("no_self_transfer") or not rules.has("card_id_required") or not rules.has("once_per_card_per_match"):
		push_error("Smoke test failed: boss transfer preview rules invalid %s" % [preview])
		return false
	if String(preview.get("intent_authority", "")) != "client_request_only" or not bool(preview.get("requires_server_confirmation", false)):
		push_error("Smoke test failed: boss transfer preview intent authority invalid %s" % [preview])
		return false
	if String(preview.get("damage_authority", "")) != "server" or String(preview.get("reward_authority", "")) != "server" or String(preview.get("settlement_authority", "")) != "server":
		push_error("Smoke test failed: boss transfer preview server authority invalid %s" % [preview])
		return false
	if bool(preview.get("client_result_authoritative", true)):
		push_error("Smoke test failed: boss transfer preview became client authoritative %s" % [preview])
		return false
	var expected_confirmation := "required" if expected_ok else "blocked_local"
	if String(preview.get("server_confirmation_status", "")) != expected_confirmation:
		push_error("Smoke test failed: boss transfer preview confirmation status invalid %s expected=%s" % [preview, expected_confirmation])
		return false
	return true

func _validate_boss_display_slots(slots: Array[Dictionary], mode_id: String, expected_count: int) -> bool:
	if slots.size() != expected_count:
		push_error("Smoke test failed: boss display slot count invalid %s" % [slots])
		return false
	for i in range(slots.size()):
		var slot: Dictionary = slots[i]
		var normalized_spawn: Vector2 = slot.get("normalized_spawn", Vector2.ZERO)
		var normalized_display_position: Vector2 = slot.get("normalized_display_position", Vector2.ZERO)
		var screen_position: Vector2 = slot.get("screen_position", Vector2.ZERO)
		var aim_vector: Vector2 = slot.get("aim_vector", Vector2.ZERO)
		if String(slot.get("mode_id", "")) != mode_id or int(slot.get("slot_index", -1)) != i or int(slot.get("slot_count", -1)) != expected_count:
			push_error("Smoke test failed: boss display slot identity invalid %s" % [slot])
			return false
		var expected_layout_policy := "cardinal_4" if expected_count == 4 else ("eight_direction_8" if expected_count == 8 else "even_ring_%d" % expected_count)
		var expected_labels := _expected_boss_slot_labels(expected_count)
		if String(slot.get("slot_layout_policy", "")) != expected_layout_policy or String(slot.get("slot_label", "")) != expected_labels[i]:
			push_error("Smoke test failed: boss display slot layout metadata invalid %s expected=%s" % [slot, expected_labels])
			return false
		if bool(slot.get("client_result_authoritative", true)) or String(slot.get("friendly_fire", "")) != "disabled":
			push_error("Smoke test failed: boss display slot authority invalid %s" % [slot])
			return false
		if normalized_spawn.length() < 0.99 or normalized_spawn.length() > 1.01 or aim_vector.length() < 0.99 or aim_vector.length() > 1.01 or normalized_spawn.dot(aim_vector) > -0.99:
			push_error("Smoke test failed: boss display vectors invalid %s" % [slot])
			return false
		if normalized_display_position.x < 0.05 or normalized_display_position.x > 0.95 or normalized_display_position.y < 0.05 or normalized_display_position.y > 0.95:
			push_error("Smoke test failed: boss normalized display position out of bounds %s" % [slot])
			return false
		if screen_position.x < 160.0 or screen_position.x > 800.0 or screen_position.y < 48.0 or screen_position.y > 672.0:
			push_error("Smoke test failed: boss screen display position out of playfield %s" % [slot])
			return false
		if not bool(slot.get("aim_to_center", false)) or slot.get("aim_target", Vector2.INF) != Vector2.ZERO:
			push_error("Smoke test failed: boss display slot target invalid %s" % [slot])
			return false
	return true

func _expected_boss_slot_labels(expected_count: int) -> Array[String]:
	if expected_count == 4:
		return ["north", "east", "south", "west"]
	if expected_count == 8:
		return ["north", "north_east", "east", "south_east", "south", "south_west", "west", "north_west"]
	var labels: Array[String] = []
	for i in range(max(0, expected_count)):
		labels.append("slot_%02d" % i)
	return labels

func _validate_bullet_engine_graze_rules() -> bool:
	var player := Vector2(100, 100)
	var hit_bullet: Dictionary = BulletPatternLibrary.make_bullet(Vector2(106, 100), 0.0, 0.0, 5.0, "engine_hit", 1)
	if BulletEngine.graze_overlaps(player, 22.0, 4.0, hit_bullet):
		push_error("Smoke test failed: hit overlap counted as graze")
		return false
	var graze_bullet: Dictionary = BulletPatternLibrary.make_bullet(Vector2(126, 100), 0.0, 0.0, 5.0, "engine_graze", 2)
	if not BulletEngine.graze_overlaps(player, 22.0, 4.0, graze_bullet):
		push_error("Smoke test failed: bullet radius did not extend graze ring")
		return false
	if not BulletEngine.should_emit_graze(graze_bullet, "p1", 10, player, 22.0, 4.0):
		push_error("Smoke test failed: first graze did not emit")
		return false
	BulletEngine.mark_grazed(graze_bullet, "p1", 10)
	if BulletEngine.should_emit_graze(graze_bullet, "p1", 11, player, 22.0, 4.0):
		push_error("Smoke test failed: normal bullet emitted duplicate graze")
		return false
	var laser_bullet: Dictionary = BulletPatternLibrary.make_bullet(Vector2(126, 100), 0.0, 0.0, 5.0, "engine_laser", 3, "white", {"continuous_graze": true, "graze_cooldown_ticks": 4})
	if not BulletEngine.should_emit_graze(laser_bullet, "p1", 20, player, 22.0, 4.0):
		push_error("Smoke test failed: continuous graze first tick did not emit")
		return false
	BulletEngine.mark_grazed(laser_bullet, "p1", 20)
	if BulletEngine.should_emit_graze(laser_bullet, "p1", 22, player, 22.0, 4.0):
		push_error("Smoke test failed: continuous graze ignored cooldown")
		return false
	if not BulletEngine.should_emit_graze(laser_bullet, "p1", 24, player, 22.0, 4.0):
		push_error("Smoke test failed: continuous graze did not re-emit after cooldown")
		return false
	var beam_bullet: Dictionary = BulletPatternLibrary.make_shaped_bullet(Vector2(100, 60), PI * 0.5, 0.0, 4.0, "engine_beam", 4, "white", {"continuous_graze": true, "graze_cooldown_ticks": 8}, {"shape": "laser", "length": 120.0, "angle": PI * 0.5})
	if not BulletEngine.hit_overlaps(Vector2(100, 100), 4.0, beam_bullet):
		push_error("Smoke test failed: capsule laser hit overlap invalid")
		return false
	if BulletEngine.graze_overlaps(Vector2(100, 100), 22.0, 4.0, beam_bullet):
		push_error("Smoke test failed: capsule laser hit also counted as graze")
		return false
	if not BulletEngine.graze_overlaps(Vector2(126, 100), 22.0, 4.0, beam_bullet):
		push_error("Smoke test failed: capsule laser graze overlap invalid")
		return false
	var warning_beam: Dictionary = BulletPatternLibrary.make_shaped_bullet(Vector2(100, 60), PI * 0.5, 0.0, 4.0, "engine_warning_beam", 5, "white", {"type": "laser_warning", "warning_ticks": 3, "continuous_graze": true, "graze_cooldown_ticks": 8}, {"shape": "laser", "length": 120.0, "angle": PI * 0.5})
	if BulletEngine.collision_active(warning_beam):
		push_error("Smoke test failed: fresh laser warning is collidable")
		return false
	var warning_step_bullets: Array[Dictionary] = [warning_beam]
	var warning_step: Dictionary = BulletEngine.step_bullets(warning_step_bullets, Vector2(100, 100), 31, {"hit_radius": 4.0, "graze_radius": 22.0, "allow_hit": true, "remove_on_hit": false})
	if int(warning_step.get("events", []).size()) != 0:
		push_error("Smoke test failed: laser warning emitted collision event while warning %s" % [warning_step])
		return false
	warning_beam["age_ticks"] = 4
	if not BulletEngine.collision_active(warning_beam) or not BulletEngine.hit_overlaps(Vector2(100, 100), 4.0, warning_beam):
		push_error("Smoke test failed: laser warning did not become collidable after warning")
		return false
	var rotating_lasers: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_rotating_laser",
		"type": "rotating_laser",
		"origin": Vector2(100, 60),
		"count": 1,
		"radius": 4.0,
		"length": 120.0,
		"warning_ticks": 1,
		"angular_velocity": 0.5,
		"graze_cooldown_ticks": 4,
		"lifetime_ticks": 8,
	}, 0, Vector2(100, 180), 30, 20260625)
	if rotating_lasers.is_empty():
		push_error("Smoke test failed: rotating laser did not emit")
		return false
	var rotating_laser: Dictionary = rotating_lasers[0]
	if BulletEngine.collision_active(rotating_laser):
		push_error("Smoke test failed: rotating laser warning is collidable")
		return false
	rotating_laser["age_ticks"] = 2
	if not BulletEngine.collision_active(rotating_laser):
		push_error("Smoke test failed: rotating laser did not become collidable")
		return false
	var angle_before: float = float(rotating_laser.get("angle", 0.0))
	BulletPatternLibrary.resolve_behavior(rotating_laser, Vector2(100, 180))
	if absf(float(rotating_laser.get("angle", 0.0)) - angle_before - 0.5) > 0.001:
		push_error("Smoke test failed: rotating laser did not rotate after warning")
		return false
	var cross_lasers: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_cross_laser",
		"type": "cross_laser",
		"origin": Vector2(100, 100),
		"arms": 4,
		"radius": 4.0,
		"length": 120.0,
		"warning_ticks": 1,
		"angle_offset": 0.0,
		"angular_velocity": 0.0,
	}, 0, Vector2(220, 100), 31, 20260625)
	if cross_lasers.size() != 4:
		push_error("Smoke test failed: cross laser did not emit four arms")
		return false
	var cross_laser: Dictionary = cross_lasers[0]
	if BulletEngine.collision_active(cross_laser):
		push_error("Smoke test failed: cross laser warning is collidable")
		return false
	cross_laser["age_ticks"] = 2
	if not BulletEngine.collision_active(cross_laser) or not BulletEngine.hit_overlaps(Vector2(150, 100), 4.0, cross_laser):
		push_error("Smoke test failed: cross laser did not become a collidable arm")
		return false
	var extend_lasers: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_extend_laser",
		"type": "extend_laser",
		"origin": Vector2(100, 100),
		"count": 1,
		"radius": 4.0,
		"start_length": 20.0,
		"length": 120.0,
		"warning_ticks": 2,
		"extend_duration_ticks": 4,
		"lifetime_ticks": 20,
		"angle_offset": 0.0,
	}, 0, Vector2(220, 100), 32, 20260625)
	if extend_lasers.is_empty():
		push_error("Smoke test failed: extend laser did not emit")
		return false
	var extend_laser: Dictionary = extend_lasers[0]
	if BulletEngine.collision_active(extend_laser):
		push_error("Smoke test failed: extend laser warning is collidable")
		return false
	extend_laser["age_ticks"] = 6
	BulletPatternLibrary.resolve_behavior(extend_laser, Vector2(220, 100))
	if float(extend_laser.get("length", 0.0)) < 119.0 or not BulletEngine.collision_active(extend_laser) or not BulletEngine.hit_overlaps(Vector2(155, 100), 4.0, extend_laser):
		push_error("Smoke test failed: extend laser length did not drive capsule collision")
		return false
	var curve_bullet: Dictionary = BulletPatternLibrary.make_bullet(Vector2(100, 100), 0.0, 0.0, 4.0, "engine_curve_laser", 5, "white", {"continuous_graze": true, "graze_cooldown_ticks": 8})
	curve_bullet["shape"] = "polyline_laser"
	curve_bullet["points"] = [Vector2(0, 0), Vector2(80, 40), Vector2(160, 0)]
	if not BulletEngine.hit_overlaps(Vector2(180, 132), 4.0, curve_bullet):
		push_error("Smoke test failed: polyline laser hit overlap invalid")
		return false
	if BulletEngine.graze_overlaps(Vector2(180, 132), 22.0, 4.0, curve_bullet):
		push_error("Smoke test failed: polyline laser hit also counted as graze")
		return false
	if not BulletEngine.graze_overlaps(Vector2(180, 158), 22.0, 4.0, curve_bullet):
		push_error("Smoke test failed: polyline laser graze overlap invalid")
		return false
	var reflect_lasers: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_reflect_laser",
		"type": "reflect_laser",
		"origin": Vector2(100, 100),
		"count": 1,
		"radius": 4.0,
		"length": 180.0,
		"bounces": 1,
		"reflect_bounds": Rect2(Vector2(80, 80), Vector2(80, 80)),
		"warning_ticks": 1,
		"angle_offset": 0.0,
	}, 0, Vector2(220, 100), 36, 20260625)
	if reflect_lasers.is_empty():
		push_error("Smoke test failed: reflect laser did not emit")
		return false
	var reflect_laser: Dictionary = reflect_lasers[0]
	var reflect_points: Array = reflect_laser.get("points", [])
	if reflect_points.size() < 3 or BulletEngine.collision_active(reflect_laser):
		push_error("Smoke test failed: reflect laser did not build reflected polyline")
		return false
	reflect_laser["age_ticks"] = 2
	if not BulletEngine.collision_active(reflect_laser):
		push_error("Smoke test failed: reflect laser did not become collidable after warning")
		return false
	if not BulletEngine.hit_overlaps(Vector2(140, 100), 4.0, reflect_laser):
		push_error("Smoke test failed: reflect laser first segment collision invalid")
		return false
	if not BulletEngine.hit_overlaps(Vector2(120, 100), 4.0, reflect_laser):
		push_error("Smoke test failed: reflect laser reflected segment collision invalid")
		return false
	var wave_lasers: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_wave_laser",
		"type": "wave_laser",
		"origin": Vector2(100, 100),
		"count": 1,
		"radius": 4.0,
		"length": 120.0,
		"segments": 4,
		"wave_amplitude": 20.0,
		"wave_speed": 0.5,
		"warning_ticks": 1,
		"angle_offset": 0.0,
	}, 0, Vector2(220, 100), 38, 20260625)
	if wave_lasers.is_empty():
		push_error("Smoke test failed: wave laser did not emit")
		return false
	var wave_laser: Dictionary = wave_lasers[0]
	if BulletEngine.collision_active(wave_laser):
		push_error("Smoke test failed: wave laser warning is collidable")
		return false
	var wave_points_before: Array = wave_laser.get("points", [])
	wave_laser["age_ticks"] = 2
	BulletPatternLibrary.resolve_behavior(wave_laser, Vector2(220, 100))
	var wave_points_after: Array = wave_laser.get("points", [])
	if not BulletEngine.collision_active(wave_laser) or wave_points_after.size() < 5 or wave_points_after == wave_points_before:
		push_error("Smoke test failed: wave laser did not animate into a collidable polyline")
		return false
	var wave_mid_relative: Vector2 = wave_points_after[2]
	var wave_midpoint: Vector2 = wave_laser.get("pos", Vector2.ZERO) + wave_mid_relative
	if not BulletEngine.hit_overlaps(wave_midpoint, 4.0, wave_laser):
		push_error("Smoke test failed: wave laser live polyline collision invalid")
		return false
	var snake_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_snake_stream",
		"type": "snake_stream",
		"origin": Vector2(100, 100),
		"count": 1,
		"speed": 60.0,
		"radius": 4.0,
		"angle_offset": 0.0,
		"spread": 0.0,
		"snake_amplitude": PI / 6.0,
		"wave_period_ticks": 4,
		"wave_phase": 0.0,
		"wave_phase_step": 0.0,
	}, 0, Vector2(220, 100), 39, 20260625)
	if snake_bullets.is_empty():
		push_error("Smoke test failed: snake stream did not emit")
		return false
	var snake_bullet: Dictionary = snake_bullets[0]
	snake_bullet["age_ticks"] = 1
	BulletPatternLibrary.resolve_behavior(snake_bullet, Vector2(220, 100))
	var snake_velocity: Vector2 = snake_bullet.get("vel", Vector2.ZERO)
	if absf(snake_velocity.angle() - PI / 6.0) > 0.001 or absf(snake_velocity.length() - 60.0) > 0.001:
		push_error("Smoke test failed: snake stream did not update velocity along wave")
		return false
	var gap_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_gap_ring",
		"type": "gap_ring",
		"origin": Vector2(100, 100),
		"count": 8,
		"speed": 60.0,
		"radius": 4.0,
		"angle_offset": 0.0,
		"gap_angle": 0.0,
		"gap_width": PI * 0.5,
		"gap_count": 1,
	}, 0, Vector2(220, 100), 40, 20260625)
	if gap_bullets.size() >= 8:
		push_error("Smoke test failed: gap ring did not remove safe-gap bullets")
		return false
	for gap_bullet in gap_bullets:
		if absf(angle_difference(gap_bullet.get("vel", Vector2.RIGHT).angle(), 0.0)) <= PI * 0.25:
			push_error("Smoke test failed: gap ring emitted a bullet inside the configured gap")
			return false
	var edge_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_edge_spawn",
		"type": "edge_spawn",
		"count": 4,
		"speed": 60.0,
		"radius": 4.0,
		"edge": "top",
		"spawn_bounds": Rect2(Vector2(100, 100), Vector2(100, 80)),
		"edge_margin": 10.0,
		"aim_mode": "inward",
	}, 0, Vector2(220, 100), 41, 20260625)
	if edge_bullets.size() != 4:
		push_error("Smoke test failed: edge spawn did not emit lane count")
		return false
	var edge_first: Dictionary = edge_bullets[0]
	if not edge_first.get("pos", Vector2.ZERO).is_equal_approx(Vector2(100, 90)) or edge_first.get("vel", Vector2.ZERO).y <= 0.0:
		push_error("Smoke test failed: edge spawn top lane position/velocity invalid %s" % [edge_first])
		return false
	var edge_all_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_edge_spawn_all",
		"type": "edge_spawn",
		"count": 8,
		"speed": 60.0,
		"radius": 4.0,
		"edge": "all",
		"spawn_bounds": Rect2(Vector2(100, 100), Vector2(100, 80)),
		"edge_margin": 10.0,
		"aim_mode": "inward",
	}, 0, Vector2(220, 100), 42, 20260625)
	if edge_all_bullets.size() != 8 or edge_all_bullets[0].get("pos", Vector2.ZERO).y >= 100.0 or edge_all_bullets[1].get("pos", Vector2.ZERO).x <= 200.0 or edge_all_bullets[2].get("pos", Vector2.ZERO).y <= 180.0 or edge_all_bullets[3].get("pos", Vector2.ZERO).x >= 100.0:
		push_error("Smoke test failed: edge spawn all-sides positions invalid %s" % [edge_all_bullets])
		return false
	var bezier_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_bezier_follow",
		"type": "bezier_follow",
		"origin": Vector2(100, 100),
		"count": 1,
		"radius": 4.0,
		"control_points": [Vector2(0, 0), Vector2(100, 0)],
		"path_duration_ticks": 10,
		"lifetime_ticks": 20,
	}, 0, Vector2(220, 100), 40, 20260625)
	if bezier_bullets.is_empty():
		push_error("Smoke test failed: bezier follow did not emit")
		return false
	var bezier_bullet: Dictionary = bezier_bullets[0]
	bezier_bullet["age_ticks"] = 5
	BulletPatternLibrary.resolve_behavior(bezier_bullet, Vector2(220, 100))
	if not bezier_bullet.get("pos", Vector2.ZERO).is_equal_approx(Vector2(150, 100)):
		push_error("Smoke test failed: bezier follow did not sample control curve")
		return false
	var carrier: Dictionary = BulletPatternLibrary.make_bullet(player, 0.0, 0.0, 12.0, "engine_carrier", 6, "violet", {
		"type": "path_emit",
		"path_origin": Vector2(100, 100),
		"path_points": [Vector2(100, 100), Vector2(160, 100)],
		"path_duration_ticks": 12,
		"emit_start_tick": 1,
		"emit_interval_ticks": 1,
		"emit_count": 4,
		"emit_speed": 80.0,
		"emit_radius": 3.5,
		"lifetime_ticks": 4,
	})
	carrier["collidable"] = false
	var carrier_bullets: Array[Dictionary] = [carrier]
	var carrier_step: Dictionary = BulletEngine.step_bullets(carrier_bullets, player, 30, {"hit_radius": 4.0, "graze_radius": 22.0, "allow_hit": true})
	if int(carrier_step.get("events", []).size()) != 0 or int(carrier_step.get("spawned", []).size()) <= 0:
		push_error("Smoke test failed: non-collidable path carrier did not behave correctly %s" % [carrier_step])
		return false
	var path_emitters: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_path_emitters",
		"type": "path_emitters",
		"origin": Vector2(300, 300),
		"count": 1,
		"path_points": [Vector2(0, 0), Vector2(60, 0)],
		"path_duration_ticks": 10,
		"emit_interval_ticks": 99,
		"emit_start_tick": 99,
		"lifetime_ticks": 40,
	}, 0, player, 64, 20260625)
	if path_emitters.is_empty():
		push_error("Smoke test failed: path emitters did not emit")
		return false
	var path_emitter: Dictionary = path_emitters[0]
	path_emitter["age_ticks"] = 5
	BulletPatternLibrary.resolve_behavior(path_emitter, player)
	var path_emitter_pos: Vector2 = path_emitter.get("pos", Vector2.ZERO)
	if path_emitter_pos.distance_to(Vector2(330, 300)) > 0.1:
		push_error("Smoke test failed: path emitter did not preserve origin-relative path %s" % [path_emitter_pos])
		return false
	var telegraph_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_telegraph_burst",
		"type": "telegraph_burst",
		"origin": Vector2(100, 100),
		"count": 6,
		"speed": 100.0,
		"radius": 4.0,
		"trigger_tick": 2,
		"burst_mode": "fan",
		"aim_mode": "player",
		"spread": PI * 0.25,
	}, 0, Vector2(220, 100), 70, 20260625)
	if telegraph_bullets.is_empty() or bool(telegraph_bullets[0].get("collidable", true)):
		push_error("Smoke test failed: telegraph burst carrier invalid")
		return false
	var telegraph_step_early: Dictionary = BulletEngine.step_bullets(telegraph_bullets, player, 40, {"hit_radius": 4.0, "graze_radius": 22.0, "allow_hit": true})
	if int(telegraph_step_early.get("events", []).size()) != 0 or int(telegraph_step_early.get("spawned", []).size()) != 0:
		push_error("Smoke test failed: telegraph burst emitted before trigger %s" % [telegraph_step_early])
		return false
	var telegraph_step_trigger: Dictionary = BulletEngine.step_bullets(telegraph_bullets, player, 41, {"hit_radius": 4.0, "graze_radius": 22.0, "allow_hit": true})
	if int(telegraph_step_trigger.get("events", []).size()) != 0 or int(telegraph_step_trigger.get("spawned", []).size()) != 6:
		push_error("Smoke test failed: telegraph burst did not spawn on trigger %s" % [telegraph_step_trigger])
		return false
	var charge_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_charge_burst",
		"type": "charge_burst",
		"origin": Vector2(100, 100),
		"count": 8,
		"speed": 100.0,
		"radius": 4.0,
		"charge_radius": 8.0,
		"charge_grow": 1.0,
		"max_charge_radius": 12.0,
		"trigger_tick": 2,
		"burst_mode": "ring",
	}, 0, Vector2(220, 100), 71, 20260625)
	if charge_bullets.is_empty() or bool(charge_bullets[0].get("collidable", true)):
		push_error("Smoke test failed: charge burst carrier invalid")
		return false
	var charge_step_early: Dictionary = BulletEngine.step_bullets(charge_bullets, player, 42, {"hit_radius": 4.0, "graze_radius": 22.0, "allow_hit": true})
	if int(charge_step_early.get("events", []).size()) != 0 or int(charge_step_early.get("spawned", []).size()) != 0 or float(charge_bullets[0].get("radius", 0.0)) <= 8.0:
		push_error("Smoke test failed: charge burst early charge invalid %s" % [charge_step_early])
		return false
	var charge_step_trigger: Dictionary = BulletEngine.step_bullets(charge_bullets, player, 43, {"hit_radius": 4.0, "graze_radius": 22.0, "allow_hit": true})
	if int(charge_step_trigger.get("events", []).size()) != 0 or int(charge_step_trigger.get("spawned", []).size()) != 8:
		push_error("Smoke test failed: charge burst did not convert on trigger %s" % [charge_step_trigger])
		return false
	var trap_markers: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_trap_marker",
		"type": "trap_marker",
		"origin": Vector2(100, 100),
		"count": 2,
		"emit_count": 3,
		"speed": 90.0,
		"radius": 4.0,
		"marker_radius": 8.0,
		"placement": "line",
		"width": 60.0,
		"trigger_tick": 2,
		"release_mode": "fan",
		"aim_mode": "player",
		"spread": PI * 0.2,
	}, 0, Vector2(220, 100), 72, 20260625)
	if trap_markers.size() != 2 or bool(trap_markers[0].get("collidable", true)):
		push_error("Smoke test failed: trap marker carriers invalid")
		return false
	var trap_step_early: Dictionary = BulletEngine.step_bullets(trap_markers, player, 44, {"hit_radius": 4.0, "graze_radius": 22.0, "allow_hit": true})
	if int(trap_step_early.get("events", []).size()) != 0 or int(trap_step_early.get("spawned", []).size()) != 0:
		push_error("Smoke test failed: trap marker emitted before trigger %s" % [trap_step_early])
		return false
	var trap_step_trigger: Dictionary = BulletEngine.step_bullets(trap_markers, player, 45, {"hit_radius": 4.0, "graze_radius": 22.0, "allow_hit": true})
	if int(trap_step_trigger.get("events", []).size()) != 0 or int(trap_step_trigger.get("spawned", []).size()) != 6:
		push_error("Smoke test failed: trap marker did not release children %s" % [trap_step_trigger])
		return false
	var trap_child: Dictionary = (trap_step_trigger.get("spawned", []) as Array)[0]
	if trap_child.get("vel", Vector2.ZERO).x <= 0.0:
		push_error("Smoke test failed: trap marker child did not aim toward player")
		return false
	var boomerang_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_boomerang",
		"type": "boomerang_ring",
		"origin": Vector2(100, 100),
		"count": 1,
		"speed": 100.0,
		"radius": 4.0,
		"turn_tick": 2,
		"return_mode": "target",
		"return_target": Vector2(100, 100),
		"return_speed": 120.0,
	}, 0, player, 10, 20260625)
	var boomerang: Dictionary = boomerang_bullets[0]
	var before_turn_velocity: Vector2 = boomerang.get("vel", Vector2.ZERO)
	boomerang["pos"] = Vector2(160, 100)
	boomerang["age_ticks"] = 2
	BulletPatternLibrary.resolve_behavior(boomerang, player)
	var after_turn_velocity: Vector2 = boomerang.get("vel", Vector2.ZERO)
	if before_turn_velocity.dot(after_turn_velocity) >= 0.0:
		push_error("Smoke test failed: boomerang return did not reverse direction")
		return false
	var orbit_release_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_orbit_release",
		"type": "orbit_release",
		"origin": Vector2(100, 100),
		"count": 1,
		"radius": 4.0,
		"orbit_radius": 40.0,
		"orbit_spin": 0.25,
		"release_tick": 3,
		"release_mode": "player",
		"release_speed": 120.0,
	}, 0, Vector2(220, 100), 40, 20260625)
	if orbit_release_bullets.is_empty():
		push_error("Smoke test failed: orbit release did not emit")
		return false
	var orbit_release: Dictionary = orbit_release_bullets[0]
	var orbit_hold_pos: Vector2 = orbit_release.get("pos", Vector2.ZERO)
	orbit_release["age_ticks"] = 2
	BulletPatternLibrary.resolve_behavior(orbit_release, Vector2(220, 100))
	if orbit_hold_pos.distance_to(orbit_release.get("pos", Vector2.ZERO)) <= 0.001 or orbit_release.get("vel", Vector2.ZERO).length() > 0.001:
		push_error("Smoke test failed: orbit release did not hold on orbit before release")
		return false
	orbit_release["age_ticks"] = 3
	BulletPatternLibrary.resolve_behavior(orbit_release, Vector2(220, 100))
	var orbit_release_velocity: Vector2 = orbit_release.get("vel", Vector2.ZERO)
	if orbit_release_velocity.length() < 119.0 or orbit_release_velocity.x <= 0.0:
		push_error("Smoke test failed: orbit release did not release toward player")
		return false
	var phase_shift_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_phase_shift",
		"type": "phase_shift_ring",
		"origin": Vector2(100, 100),
		"count": 1,
		"speed": 60.0,
		"radius": 4.0,
		"shift_tick": 3,
		"shift_mode": "player",
		"shift_speed": 120.0,
	}, 0, Vector2(220, 100), 48, 20260625)
	if phase_shift_bullets.is_empty():
		push_error("Smoke test failed: phase shift ring did not emit")
		return false
	var phase_shift: Dictionary = phase_shift_bullets[0]
	var phase_velocity_before: Vector2 = phase_shift.get("vel", Vector2.ZERO)
	phase_shift["pos"] = Vector2(100, 100)
	phase_shift["age_ticks"] = 2
	BulletPatternLibrary.resolve_behavior(phase_shift, Vector2(220, 100))
	if phase_shift.get("vel", Vector2.ZERO).distance_to(phase_velocity_before) > 0.001:
		push_error("Smoke test failed: phase shift changed before shift tick")
		return false
	phase_shift["age_ticks"] = 3
	BulletPatternLibrary.resolve_behavior(phase_shift, Vector2(220, 100))
	var phase_velocity_after: Vector2 = phase_shift.get("vel", Vector2.ZERO)
	if phase_velocity_after.length() < 119.0 or phase_velocity_after.x <= 0.0 or absf(phase_velocity_after.y) > 0.001:
		push_error("Smoke test failed: phase shift did not retarget player")
		return false
	var scale_pulse_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_scale_pulse",
		"type": "scale_pulse_ring",
		"origin": Vector2(100, 100),
		"count": 1,
		"speed": 0.0,
		"radius": 2.0,
		"base_radius": 2.0,
		"target_radius": 8.0,
		"grow_start_tick": 1,
		"grow_duration_ticks": 2,
		"pulse_amplitude": 0.0,
	}, 0, Vector2(220, 100), 54, 20260625)
	if scale_pulse_bullets.is_empty():
		push_error("Smoke test failed: scale pulse ring did not emit")
		return false
	var scale_pulse: Dictionary = scale_pulse_bullets[0]
	scale_pulse["pos"] = Vector2(124, 100)
	if BulletEngine.graze_overlaps(player, 22.0, 4.0, scale_pulse):
		push_error("Smoke test failed: scale pulse grazed before radius growth")
		return false
	scale_pulse["age_ticks"] = 3
	BulletPatternLibrary.resolve_behavior(scale_pulse, Vector2(220, 100))
	if float(scale_pulse.get("radius", 0.0)) < 7.9 or not BulletEngine.graze_overlaps(player, 22.0, 4.0, scale_pulse):
		push_error("Smoke test failed: scale pulse radius growth did not affect graze overlap")
		return false
	var vortex_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_vortex_field",
		"type": "vortex_field",
		"origin": Vector2(100, 100),
		"count": 1,
		"speed": 80.0,
		"radius": 4.0,
		"spawn_radius": 60.0,
		"field_center": Vector2(100, 100),
		"pull_strength": 2.0,
		"tangent_strength": 4.0,
		"max_speed": 140.0,
	}, 0, Vector2(220, 100), 50, 20260625)
	if vortex_bullets.is_empty():
		push_error("Smoke test failed: vortex field did not emit")
		return false
	var vortex: Dictionary = vortex_bullets[0]
	var vortex_velocity_before: Vector2 = vortex.get("vel", Vector2.ZERO)
	vortex["age_ticks"] = 1
	BulletPatternLibrary.resolve_behavior(vortex, Vector2(220, 100))
	var vortex_velocity_after: Vector2 = vortex.get("vel", Vector2.ZERO)
	if vortex_velocity_after.distance_to(vortex_velocity_before) <= 0.001 or vortex_velocity_after.length() <= 0.0:
		push_error("Smoke test failed: vortex field did not alter velocity")
		return false
	var delayed_aim_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_delayed_aim",
		"type": "delayed_aim_ring",
		"origin": Vector2(100, 100),
		"count": 1,
		"speed": 90.0,
		"release_speed": 120.0,
		"radius": 4.0,
		"hold_tick": 1,
		"aim_tick": 2,
		"aim_mode": "player",
	}, 0, Vector2(220, 100), 20, 20260625)
	var delayed_aim: Dictionary = delayed_aim_bullets[0]
	delayed_aim["pos"] = Vector2(100, 100)
	delayed_aim["age_ticks"] = 2
	BulletPatternLibrary.resolve_behavior(delayed_aim, Vector2(220, 100))
	var delayed_aim_velocity: Vector2 = delayed_aim.get("vel", Vector2.ZERO)
	if delayed_aim_velocity.x <= 0.0 or absf(delayed_aim_velocity.y) > 0.001:
		push_error("Smoke test failed: delayed aim did not target player")
		return false
	var path_follow_bullets: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_path_follow",
		"type": "path_follow",
		"origin": Vector2(300, 300),
		"count": 1,
		"radius": 4.0,
		"path_points": [Vector2(0, 0), Vector2(100, 0)],
		"path_duration_ticks": 10,
		"path_loop": true,
	}, 0, player, 28, 20260625)
	if path_follow_bullets.is_empty():
		push_error("Smoke test failed: path follow did not emit")
		return false
	var path_follow: Dictionary = path_follow_bullets[0]
	path_follow["age_ticks"] = 5
	BulletPatternLibrary.resolve_behavior(path_follow, player)
	var path_follow_pos: Vector2 = path_follow.get("pos", Vector2.ZERO)
	if path_follow_pos.distance_to(Vector2(350, 300)) > 0.1 or not BulletEngine.hit_overlaps(Vector2(350, 300), 4.0, path_follow):
		push_error("Smoke test failed: path follow did not move on origin-relative path")
		return false
	var trail_emitters: Array[Dictionary] = BulletPatternLibrary.emit_pattern({
		"id": "engine_trail_emitters",
		"type": "trail_emitters",
		"origin": Vector2(100, 100),
		"count": 1,
		"speed": 0.0,
		"width": 1.0,
		"carrier_radius": 5.0,
		"emit_interval_ticks": 1,
		"emit_start_tick": 1,
		"emit_count": 4,
		"emit_speed": 80.0,
		"emit_radius": 3.5,
	}, 0, Vector2(220, 100), 24, 20260625)
	if trail_emitters.is_empty() or bool(trail_emitters[0].get("collidable", true)):
		push_error("Smoke test failed: trail emitter carrier invalid")
		return false
	var trail_step: Dictionary = BulletEngine.step_bullets(trail_emitters, player, 43, {"hit_radius": 4.0, "graze_radius": 22.0, "allow_hit": true})
	if int(trail_step.get("events", []).size()) != 0 or int(trail_step.get("spawned", []).size()) != 4:
		push_error("Smoke test failed: trail emitter did not spawn non-colliding children %s" % [trail_step])
		return false
	return true

func _advance_frames(count: int) -> void:
	for i in range(count):
		await process_frame

func _validate_pattern_emitters(stage_select_model: RefCounted) -> bool:
	var required_types: Array[String] = ["ring", "gap_ring", "n_way", "flower", "random_arc", "split_chain", "sine_stream", "snake_stream", "blossom", "homing", "laser_curtain", "orbital", "curtain", "burst", "spiral_stack", "alternating_ring", "accel_ring", "phase_shift_ring", "scale_pulse_ring", "curve_fan", "grid_rain", "edge_spawn", "sweep_laser", "exploding_star", "telegraph_burst", "charge_burst", "beam_sweep", "rotating_laser", "cross_laser", "extend_laser", "curved_laser", "reflect_laser", "wave_laser", "wall_bounce", "morph_ring", "summoner_orbit", "path_emitters", "path_follow", "bezier_follow", "trail_emitters", "converge_cloud", "vortex_field", "stop_release", "boomerang_ring", "orbit_release", "delayed_aim_ring", "gate_lanes"]
	var seen_types: Array[String] = []
	for stage_id in stage_select_model.stage_ids():
		var patterns: Array[Dictionary] = stage_select_model.patterns_for_stage(stage_id)
		if patterns.is_empty():
			push_error("Smoke test failed: stage %s has no patterns" % stage_id)
			return false
		for pattern in patterns:
			var emitted: Array[Dictionary] = BulletPatternLibrary.emit_pattern(pattern, 72, Vector2(480, 600), 1000, 20260625)
			if emitted.is_empty():
				push_error("Smoke test failed: pattern emitted nothing %s" % String(pattern.get("id", "")))
				return false
			var pattern_type := String(pattern.get("type", ""))
			if not seen_types.has(pattern_type):
				seen_types.append(pattern_type)
			var first_bullet: Dictionary = emitted[0]
			if not first_bullet.has("pos") or not first_bullet.has("vel") or float(first_bullet.get("radius", 0.0)) <= 0.0:
				push_error("Smoke test failed: emitted bullet shape invalid %s" % String(pattern.get("id", "")))
				return false
	for required_type in required_types:
		if not seen_types.has(required_type):
			push_error("Smoke test failed: missing pattern type %s" % required_type)
			return false
	return true

func _validate_boss_pattern_catalog(stage_select_model: RefCounted) -> bool:
	var coverage: Dictionary = BossPatternCatalog.validate_stage_patterns(stage_select_model)
	if not bool(coverage.get("ok", false)):
		push_error("Smoke test failed: boss pattern catalog coverage invalid %s" % [coverage])
		return false
	var recipe_validation: Dictionary = BossPatternCatalog.validate_open_source_recipes()
	if not bool(recipe_validation.get("ok", false)) or int(recipe_validation.get("recipe_count", 0)) < 3:
		push_error("Smoke test failed: open source recipe catalog invalid %s" % [recipe_validation])
		return false
	var family_rows: Array[Dictionary] = BossPatternCatalog.family_rows()
	if family_rows.size() < 7:
		push_error("Smoke test failed: boss pattern family catalog too small")
		return false
	var recipe_rows: Array[Dictionary] = BossPatternCatalog.open_source_recipe_rows()
	for recipe in recipe_rows:
		if String(recipe.get("status", "")) == "direct_copy" or String(recipe.get("license", "")).is_empty():
			push_error("Smoke test failed: unsafe open source recipe row %s" % [recipe])
			return false
	var spellbook_model: RefCounted = BossSpellbookModel.new()
	var spellbook_validation: Dictionary = spellbook_model.validate_spellbooks()
	if not bool(spellbook_validation.get("ok", false)) or int(spellbook_validation.get("phase_count", 0)) < 4:
		push_error("Smoke test failed: boss spellbook validation invalid %s" % [spellbook_validation])
		return false
	var spellbook_rows: Array[Dictionary] = spellbook_model.rows()
	if spellbook_rows.is_empty() or int(spellbook_rows[0].get("total_ticks", 0)) <= 0:
		push_error("Smoke test failed: boss spellbook rows invalid %s" % [spellbook_rows])
		return false
	var timeline_rows: Array[Dictionary] = spellbook_model.timeline_rows("original_boss_archive")
	if timeline_rows.size() < 4 or String(timeline_rows[0].get("phase_kind", "")) != "nonspell":
		push_error("Smoke test failed: boss spellbook timeline invalid %s" % [timeline_rows])
		return false
	var emitted: Array[Dictionary] = spellbook_model.emit_tick("original_boss_archive", 0, Vector2(480, 600), 1000, 20260625)
	if emitted.is_empty() or not emitted[0].has("pattern_id"):
		push_error("Smoke test failed: boss spellbook did not emit bullets")
		return false
	return true

func _validate_pattern_lab_rows(rows: Array[Dictionary], required_basis: Array[String]) -> bool:
	if rows.is_empty():
		push_error("Smoke test failed: pattern lab rows empty")
		return false
	var seen_basis: Array[String] = []
	for row in rows:
		var math_basis := String(row.get("math_basis", ""))
		if math_basis.is_empty() or String(row.get("density_estimate", "")).is_empty() or String(row.get("danger_estimate", "")).is_empty():
			push_error("Smoke test failed: pattern lab row missing analysis fields %s" % [row])
			return false
		if String(row.get("readability_hint", "")).is_empty() or String(row.get("parameter_summary", "")).is_empty():
			push_error("Smoke test failed: pattern lab row missing readability/parameter fields %s" % [row])
			return false
		if float(row.get("spawn_rate_per_second", 0.0)) <= 0.0 or int(row.get("total_bullet_count", 0)) <= 0:
			push_error("Smoke test failed: pattern lab row metrics invalid %s" % [row])
			return false
		if not seen_basis.has(math_basis):
			seen_basis.append(math_basis)
	for basis in required_basis:
		if not seen_basis.has(basis):
			push_error("Smoke test failed: pattern lab missing basis %s in %s" % [basis, seen_basis])
			return false
	return true

func _validate_pattern_lab_coverage(stage_select_model: RefCounted, pattern_lab_model: RefCounted) -> bool:
	var required_basis: Array[String] = [
		"polar_even_angles",
		"polar_gap_filter",
		"aimed_angle_lerp",
		"flower_angle_lattice",
		"seeded_random_arc",
		"delayed_polar_split",
		"sine_wave_offset",
		"dynamic_snake_velocity",
		"delayed_blossom_ring",
		"rotate_toward_target",
		"warning_lane_fan",
		"polar_orbit_tangent",
		"linear_lane_wall",
		"aimed_speed_gradient",
		"stacked_rotating_spiral",
		"alternating_offset_ring",
		"velocity_phased_ring",
		"curved_aimed_lanes",
		"staggered_grid_rain",
		"edge_inward_spawn_lanes",
		"continuous_laser_sweep",
		"delayed_starburst_split",
		"warning_then_burst",
		"charge_then_convert_burst",
		"capsule_laser_sweep",
		"rotating_persistent_laser",
		"multi_arm_warning_laser",
		"growing_capsule_laser",
		"polyline_curved_laser",
		"bounded_reflect_laser",
		"dynamic_wave_laser",
		"bounded_reflection_lanes",
		"radial_speed_morph",
		"orbital_periodic_emitters",
		"path_periodic_emitters",
		"path_following_bullets",
		"bezier_path_follow",
		"moving_trail_emitters",
		"seeded_converging_cloud",
		"continuous_force_field",
		"timed_stop_release",
		"returning_radial_ring",
		"orbital_hold_release",
		"two_phase_velocity_shift",
		"radial_radius_pulse",
		"delayed_one_shot_aim",
		"moving_gap_lane_wall",
	]
	var seen_basis: Array[String] = []
	for stage_id in stage_select_model.stage_ids():
		var rows: Array[Dictionary] = pattern_lab_model.rows_for_stage(stage_id)
		if rows.is_empty():
			push_error("Smoke test failed: pattern lab rows empty for stage %s" % stage_id)
			return false
		if not _validate_pattern_lab_rows(rows, []):
			return false
		for row in rows:
			var basis := String(row.get("math_basis", ""))
			if not seen_basis.has(basis):
				seen_basis.append(basis)
	for basis in required_basis:
		if not seen_basis.has(basis):
			push_error("Smoke test failed: pattern lab coverage missing %s in %s" % [basis, seen_basis])
			return false
	return true

func _smoke_battle_allocation(match_id: String) -> Dictionary:
	return {
		"ok": true,
		"version": {"protocol_version": 1, "business_api_version": "0.1.0-draft", "battle_api_version": "0.1.0-draft", "ruleset_version": "ruleset-local-s0"},
		"match_id": match_id,
		"mode_id": "certification",
		"battle_server_id": "battle-smoke",
		"endpoint": "127.0.0.1:7901",
		"players": [
			{"user_id": "server-user-smoke", "player_id": "p-smoke", "display_name": "Smoke Player", "deck_snapshot_hash": "sha256:deck", "loadout": {"stage_id": "lunar_maze", "character_id": "spell_power", "ruleset_version": "ruleset-local-s0", "server_authoritative": true}},
			{"user_id": "server-user-other", "player_id": "p-other", "display_name": "Other", "deck_snapshot_hash": "sha256:other", "loadout": {"stage_id": "lunar_maze", "character_id": "precision", "ruleset_version": "ruleset-local-s0", "server_authoritative": true}},
		],
		"server_seed": 20260626,
		"server_seed_hex": "00000000013512a2",
		"mode_config_hash": "sha256:mode",
		"allocated_at": "2026-06-27T00:00:00Z",
		"server_authoritative": true,
	}

func _smoke_battle_ticket(match_id: String, user_id: String, player_id: String) -> Dictionary:
	return {
		"ok": true,
		"ticket": {
			"version": {"protocol_version": 1, "business_api_version": "0.1.0-draft", "battle_api_version": "0.1.0-draft", "ruleset_version": "ruleset-local-s0"},
			"ticket_id": "battle-ticket-smoke",
			"match_id": match_id,
			"user_id": user_id,
			"player_id": player_id,
			"mode_id": "certification",
			"battle_server_id": "battle-smoke",
			"endpoint": "127.0.0.1:7901",
			"deck_snapshot_hash": "sha256:deck",
			"ruleset_version": "ruleset-local-s0",
			"ticket_nonce_hex": "00112233445566778899aabb",
			"issued_at_ms": 1782489600000,
			"expires_at_ms": 1782489660000,
			"business_session_id": "server-session-smoke",
			"server_authoritative": true,
		},
		"signature_alg": "ED25519",
		"key_id": "dev-ed25519-smoke",
		"signature_hex": "abcd",
		"public_key_hex": "1234",
		"server_authoritative": true,
		"server_time": "2026-06-27T00:00:00Z",
	}
