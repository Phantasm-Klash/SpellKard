extends SceneTree

const MAIN_SCENE := "res://scenes/main.tscn"
const WAIT_FRAMES := 30
const MAX_FRAMES := 900
const TEST_VIEWPORT := Vector2(1280, 720)

var frame_count := 0
var main_node: Node = null
var failed := false
var stage := "init"

func _initialize() -> void:
	var packed_scene := load(MAIN_SCENE)
	if packed_scene == null:
		_fail("failed to load %s" % MAIN_SCENE)
		quit(1)
		return
	main_node = packed_scene.instantiate()
	root.add_child(main_node)
	call_deferred("_start_validation")

func _process(_delta: float) -> bool:
	frame_count += 1
	if failed:
		return true
	if frame_count > MAX_FRAMES:
		_fail("timed out")
		quit(1)
		return true
	return false

func _start_validation() -> void:
	await _settle_frames(WAIT_FRAMES)
	var ok: bool = await _run_validation()
	if ok:
		print("client_ui_smoke_test ok")
		quit(0)
	else:
		quit(1)

func _run_validation() -> bool:
	if main_node == null:
		return _fail("main scene missing")
	_prepare_default_language_state()
	if not _assert_default_language_state():
		return false
	stage = "home"
	var snapshot: Dictionary = await _open_snapshot("main_menu")
	if not _assert_page_health(snapshot, "home", 0, 0):
		return false
	if not _assert_target_page_contract(snapshot, "home", ["portrait_art", "primary_routes"], ["home_status", "primary_focus"], "standee:home_portrait"):
		return false
	if int(snapshot.get("home_buttons", 0)) != 4:
		return _fail("home should expose four primary buttons %s" % [snapshot])
	var home_text := String(snapshot.get("home_buttons_text", ""))
	if not _contains_all(home_text, _text_keys(["screen.main.play", "screen.main.collection", "screen.main.community", "screen.main.player_settings"])):
		return _fail("home primary buttons missing %s" % home_text)
	if _contains_any(home_text, _text_keys(["screen.main.certification", "screen.main.replay"])):
		return _fail("home primary buttons should stay focused %s" % home_text)
	if int(snapshot.get("home_dashboard_cards", 0)) != 0 or not String(snapshot.get("home_dashboard_text", "")).is_empty():
		return _fail("home dashboard should be hidden")
	if int(snapshot.get("row_buttons", 0)) != 0 or int(snapshot.get("category_buttons", 0)) != 0:
		return _fail("secondary controls leaked onto home")
	if not await _press_home_button(0, "play"):
		return false
	if not await _press_home_button(1, "collection"):
		return false
	if not await _press_home_button(2, "community"):
		return false
	if not await _press_home_button(3, "player_settings"):
		return false
	if not await _validate_play_pages():
		return false
	if not await _validate_result_reward_loop():
		return false
	if not await _validate_menu_independence():
		return false
	if not await _validate_collection_page_contract():
		return false
	if not await _validate_community_pages():
		return false
	if not await _validate_settings_pages():
		return false
	return true

func _validate_play_pages() -> bool:
	stage = "play"
	var snapshot: Dictionary = await _open_snapshot("play")
	if not _assert_page_health(snapshot, "play", 1, 4):
		return false
	if not _assert_target_page_contract(snapshot, "play", ["mode_grid", "focus_panel", "quick_routes"], ["queue_state", "deck_state"], "frame:mode_cards"):
		return false
	if int(snapshot.get("status_cards", 0)) != 4:
		return _fail("secondary status cards should be four primary categories %s" % [snapshot])
	var status_text := String(snapshot.get("status_cards_text", ""))
	if not _contains_all(status_text, _text_keys(["screen.main.play", "screen.main.collection", "screen.main.community", "screen.main.settings"])):
		return _fail("status cards missing primary categories %s" % status_text)
	if _contains_any(status_text, _text_keys(["screen.main.certification", "screen.main.events", "screen.main.friends", "screen.main.promotions", "screen.main.social"])):
		return _fail("status cards should not duplicate subpage cards %s" % status_text)
	if not _contains_all(String(snapshot.get("overview_cards_text", "")), _text_keys(["screen.play.practice", "screen.play.matchmaking", "screen.mode.pvp_duel", "screen.mode.world_boss"])):
		return _fail("play overview cards missing expected mode entries %s" % String(snapshot.get("overview_cards_text", "")))
	if _contains_any(String(snapshot.get("quick_actions_text", "")), _text_keys(["screen.main.start_match", "screen.main.network_match", "screen.play.practice"])):
		return _fail("play quick actions should only carry shell navigation %s" % String(snapshot.get("quick_actions_text", "")))
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(rows, ["play_practice", "play_matchmaking", "play_pvp_duel", "play_world_boss", "play_certification_hub"]):
		return _fail("play rows missing expected modes")
	var focus_result: Dictionary = main_node.call("_ui_press_visible_focus_action")
	await _settle_frames(2)
	if not bool(focus_result.get("ok", false)) or String(focus_result.get("row_id", "")) != "play_matchmaking" or String(main_node.get("ui_screen_model").current_screen) != "match":
		return _fail("play focus action should open matchmaking %s" % [focus_result])
	snapshot = await _open_snapshot("play")
	if not await _validate_gameplay_view_unobstructed():
		return false
	snapshot = await _open_snapshot("play")
	var status_community: Dictionary = main_node.call("_ui_press_visible_status_card", 2)
	await _settle_frames(2)
	if not bool(status_community.get("ok", false)) or String(status_community.get("status_id", "")) != "status_community" or String(status_community.get("screen", "")) != "community":
		return _fail("community status card route invalid %s" % [status_community])
	snapshot = await _open_snapshot("certification")
	if not _assert_page_health(snapshot, "certification", 1, 4):
		return false
	if not _contains_all(String(snapshot.get("overview_cards_text", "")), _text_keys(["screen.cert.queue", "screen.cert.local_drill", "screen.match.active_deck", "screen.cert.rules"])):
		return _fail("certification overview cards invalid %s" % String(snapshot.get("overview_cards_text", "")))
	if _contains_any(String(snapshot.get("quick_actions_text", "")), _text_keys(["screen.cert.queue", "screen.cert.local_drill", "screen.match.active_deck"])):
		return _fail("certification quick actions should not duplicate overview %s" % String(snapshot.get("quick_actions_text", "")))
	snapshot = await _open_snapshot("match")
	if not _assert_page_health(snapshot, "match", 2, 5):
		return false
	if not _contains_all(String(snapshot.get("overview_cards_text", "")), _text_keys(["screen.match.quick", "screen.match.ranked", "screen.mode.pvp_duel", "screen.match.boss_party"])):
		return _fail("match overview cards invalid %s" % String(snapshot.get("overview_cards_text", "")))
	if not _contains_all(String(snapshot.get("overview_cards_text", "")), _text_keys(["screen.match.local_settlement"])):
		return _fail("match overview cards missing settlement loop %s" % String(snapshot.get("overview_cards_text", "")))
	snapshot = await _open_snapshot("network_match")
	if not _assert_page_health(snapshot, "network_match", 2, 4):
		return false
	if not _contains_all(String(snapshot.get("overview_cards_text", "")), ["Gensoulkyo", "create room"]):
		return _fail("network match overview cards invalid %s" % String(snapshot.get("overview_cards_text", "")))
	return true

func _validate_result_reward_loop() -> bool:
	stage = "result_loop"
	var snapshot: Dictionary = await _open_snapshot("match")
	if not _assert_page_health(snapshot, "match_result_loop", 3, 5):
		return false
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 64)
	var settle_index := _row_index_by_id(rows, "local_settlement_preview")
	if settle_index < 0:
		return _fail("match rows missing local settlement preview")
	main_node.call("_ui_set_cursor", settle_index)
	await _settle_frames(2)
	var result: Dictionary = main_node.call("_ui_accept_selected")
	await _settle_frames(2)
	if not bool(result.get("ok", false)) or String(result.get("action", "")) != "local_settle_match":
		return _fail("local settlement action failed %s" % [result])
	if String(main_node.get("ui_screen_model").current_screen) != "results":
		return _fail("local settlement should open results screen")
	snapshot = main_node.call("_ui_overlay_snapshot")
	if not _assert_page_health(snapshot, "results", 2, 4):
		return false
	if not _contains_all(String(snapshot.get("overview_cards_text", "")), _text_keys(["screen.results.result", "screen.results.score", "screen.results.reward", "screen.results.wallet"])):
		return _fail("results overview cards missing result/reward wallet %s" % String(snapshot.get("overview_cards_text", "")))
	var result_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(result_rows, ["result", "score_breakdown", "reward", "wallet", "tasks", "events", "reward_audit"]):
		return _fail("results rows missing closed-loop reward data")
	var reward_row := _row_by_id(result_rows, "reward")
	var reward_items: Array = reward_row.get("items", [])
	if reward_items.size() < 4:
		return _fail("reward row should expose granted items %s" % [reward_row])
	var wallet_text := String(_row_by_id(result_rows, "wallet").get("value", ""))
	if not wallet_text.contains("points") or not wallet_text.contains("dust") or not wallet_text.contains("keys"):
		return _fail("wallet row did not summarize rewards %s" % wallet_text)
	return true

func _validate_gameplay_view_unobstructed() -> bool:
	stage = "gameplay_view"
	var snapshot: Dictionary = await _open_snapshot("practice")
	if bool(snapshot.get("visible", true)):
		return _fail("practice should hide menu panel %s" % [snapshot])
	if not bool(snapshot.get("gameplay_visible", false)):
		return _fail("practice should draw gameplay %s" % [snapshot])
	if not bool(snapshot.get("hud_visible", false)):
		return _fail("practice should keep gameplay HUD visible %s" % [snapshot])
	if not bool(snapshot.get("gameplay_unobstructed", false)):
		return _fail("practice should be marked unobstructed %s" % [snapshot])
	if bool(snapshot.get("layout_show_secondary_shell", true)):
		return _fail("practice should disable secondary shell %s" % [snapshot])
	if int(snapshot.get("nav_buttons", 0)) != 0 or int(snapshot.get("row_buttons", 0)) != 0 or int(snapshot.get("quick_buttons", 0)) != 0:
		return _fail("practice should not expose menu controls %s" % [snapshot])
	var nav_result: Dictionary = main_node.call("_ui_press_visible_nav", 0)
	if not ["nav_button_hidden", "nav_button_stale"].has(String(nav_result.get("action", ""))):
		return _fail("practice should not accept hidden nav %s" % [nav_result])
	var row_result: Dictionary = main_node.call("_ui_press_visible_row", 0)
	if not ["row_button_hidden", "row_button_stale"].has(String(row_result.get("action", ""))):
		return _fail("practice should not accept hidden row %s" % [row_result])
	return true

func _validate_menu_independence() -> bool:
	stage = "menu_independence"
	var snapshot: Dictionary = await _open_snapshot("play")
	if not _assert_nav_family(snapshot, "play", _text_keys(["screen.main.play", "screen.main.certification", "screen.main.practice", "screen.main.start_match", "screen.main.network_match", "screen.main.modes"]), _text_keys(["screen.main.collection", "screen.main.community", "screen.main.player_settings", "screen.main.deck", "screen.main.friends", "screen.main.promotions"])):
		return false
	if not _contains_all(String(snapshot.get("category_tabs_text", "")), _text_keys(["screen.main.play", "screen.main.collection", "screen.main.community", "screen.main.settings"])):
		return _fail("category tabs should expose top-level menu families %s" % String(snapshot.get("category_tabs_text", "")))
	var left_result: Dictionary = main_node.call("_ui_navigation_probe", "left")
	await _settle_frames(2)
	if String(left_result.get("before_screen", "")) != "play" or String(left_result.get("after_screen", "")) != "play":
		return _fail("left navigation should stay on current screen %s" % [left_result])
	var right_result: Dictionary = main_node.call("_ui_navigation_probe", "right")
	await _settle_frames(2)
	if String(right_result.get("before_screen", "")) != "play" or String(right_result.get("after_screen", "")) != "play":
		return _fail("right navigation should stay on current screen %s" % [right_result])
	if bool(right_result.get("ok", false)) or String(right_result.get("reason", "")) != "no_action":
		return _fail("right navigation on play summary should be a no-op %s" % [right_result])

	snapshot = await _open_snapshot("community")
	if not _assert_nav_family(snapshot, "community", _text_keys(["screen.main.community", "screen.main.events", "screen.main.friends", "screen.main.social", "screen.main.promotions"]), _text_keys(["screen.main.play", "screen.main.collection", "screen.main.player_settings", "screen.main.deck", "screen.main.start_match"])):
		return false

	snapshot = await _open_snapshot("player_settings")
	if not _assert_nav_family(snapshot, "settings", _text_keys(["screen.main.player_settings", "screen.settings.input_profile", "screen.settings.audio", "screen.settings.display", "screen.main.settings"]), _text_keys(["screen.main.community", "screen.main.collection", "screen.main.deck", "screen.main.friends", "screen.main.start_match"])):
		return false

	snapshot = await _open_snapshot("collection")
	if not _assert_nav_family(snapshot, "collection", _text_keys(["screen.main.collection", "screen.main.deck", "screen.main.chest", "screen.main.replay"]), _text_keys(["screen.main.play", "screen.main.community", "screen.main.player_settings", "screen.main.friends", "screen.main.start_match"])):
		return false

	main_node.call("_open_ui_screen", "main_menu")
	main_node.call("_set_test_viewport_size", TEST_VIEWPORT)
	await _settle_frames(2)
	var nav_result: Dictionary = main_node.call("_ui_press_visible_nav", 0)
	if not ["nav_button_hidden", "nav_button_stale"].has(String(nav_result.get("action", ""))):
		return _fail("home should not accept stale secondary nav %s" % [nav_result])
	var row_result: Dictionary = main_node.call("_ui_press_visible_row", 0)
	if not ["row_button_hidden", "row_button_stale"].has(String(row_result.get("action", ""))):
		return _fail("home should not accept stale secondary row %s" % [row_result])
	return true

func _validate_community_pages() -> bool:
	stage = "community"
	var snapshot: Dictionary = await _open_snapshot("community")
	if not _assert_page_health(snapshot, "community", 1, 4):
		return false
	if not _assert_target_page_contract(snapshot, "community", ["notice_board", "social_tabs", "focus_panel"], ["announcement_state", "friend_presence"], "frame:community_notice_cards"):
		return false
	if not _contains_all(String(snapshot.get("overview_cards_text", "")), _text_keys(["screen.main.events", "screen.main.friends", "screen.main.social", "screen.main.promotions"])):
		return _fail("community overview cards invalid %s" % String(snapshot.get("overview_cards_text", "")))
	if _contains_any(String(snapshot.get("quick_actions_text", "")), _text_keys(["screen.main.events", "screen.main.friends", "screen.main.social", "screen.main.promotions"])):
		return _fail("community quick actions should not duplicate overview %s" % String(snapshot.get("quick_actions_text", "")))
	var community_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(community_rows, ["community_events", "community_friends", "community_social", "community_promotions", "announce_architecture", "link_discord"]):
		return _fail("community rows missing social surfaces")
	snapshot = await _open_snapshot("activity")
	if not _assert_page_health(snapshot, "activity", 2, 3):
		return false
	var activity_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(activity_rows, ["announce_architecture", "activity_task_daily_complete_match", "activity_claim_log"]):
		return _fail("activity rows missing announcement/task controls")
	snapshot = await _open_snapshot("friends")
	if not _assert_page_health(snapshot, "friends", 2, 3):
		return false
	var friend_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(friend_rows, ["friend_lumen", "friend_rin", "friends_social"]):
		return _fail("friends rows missing presence controls")
	snapshot = await _open_snapshot("social")
	if not _assert_page_health(snapshot, "social", 2, 3):
		return false
	var social_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(social_rows, ["announce_architecture", "friend_lumen", "link_discord", "link_steam"]):
		return _fail("social rows missing media/link controls")
	snapshot = await _open_snapshot("promotions")
	if not _assert_page_health(snapshot, "promotions", 2, 3):
		return false
	var promotion_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(promotion_rows, ["link_steam", "link_creator_program", "promotions_social"]):
		return _fail("promotion rows missing store/creator links")
	return true

func _validate_settings_pages() -> bool:
	stage = "settings"
	var snapshot: Dictionary = await _open_snapshot("player_settings")
	if not _assert_page_health(snapshot, "player_settings", 1, 4):
		return false
	if not _assert_target_page_contract(snapshot, "player_settings", ["setting_groups", "control_preview", "control_buttons"], ["input_profile_state", "display_state"], "frame:settings_control_cards"):
		return false
	if int(snapshot.get("row_count", 0)) < 14 or int(snapshot.get("row_buttons", 0)) < 12:
		return _fail("player settings should expose compact row window %s" % [snapshot])
	if _snapshot_contains_debug_settings_path(snapshot):
		return _fail("player settings should not show local settings path %s" % [snapshot])
	if not _contains_all(String(snapshot.get("overview_cards_text", "")), _text_keys(["screen.settings.language", "screen.settings.gamepad_curve", "screen.settings.input_binding", "screen.settings.volume"])):
		return _fail("player settings overview cards invalid %s" % String(snapshot.get("overview_cards_text", "")))
	if _contains_any(String(snapshot.get("quick_actions_text", "")), _text_keys(["screen.settings.gamepad_curve", "screen.settings.resolution", "screen.settings.volume"])):
		return _fail("player settings quick actions should not duplicate overview %s" % String(snapshot.get("quick_actions_text", "")))
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 48)
	if not _rows_have_ids(rows, ["settings_language", "settings_gamepad_curve", "settings_keybinds", "settings_volume", "settings_resolution", "settings_save_now", "settings_restore_defaults"]):
		return _fail("player settings rows missing expected controls")
	if not await _assert_deep_row_visible("player_settings", "settings_restore_defaults"):
		return false
	var language_index := _row_index_by_id(rows, "settings_language")
	if language_index < 0:
		return _fail("language row missing")
	main_node.call("_ui_set_cursor", language_index)
	await _settle_frames(2)
	snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(snapshot.get("control_buttons_text", "")).contains("<") or not String(snapshot.get("control_buttons_text", "")).contains(">"):
		return _fail("language selector should expose compact left/right controls %s" % String(snapshot.get("control_buttons_text", "")))
	var language_result: Dictionary = main_node.call("_ui_press_visible_control", 1)
	await _settle_frames(2)
	if not bool(language_result.get("ok", false)) or String(main_node.get("localization").get("locale")) != "en":
		return _fail("language control did not switch to English %s locale %s" % [language_result, String(main_node.get("localization").get("locale"))])
	var language_reset: Dictionary = main_node.call("_ui_press_visible_control", 2)
	await _settle_frames(2)
	if not bool(language_reset.get("ok", false)) or String(main_node.get("localization").get("locale")) != "zh-CN":
		return _fail("language reset did not restore zh-CN %s locale %s" % [language_reset, String(main_node.get("localization").get("locale"))])
	var gamepad_result: Dictionary = main_node.call("_ui_press_visible_overview_card", 1)
	await _settle_frames(2)
	if not bool(gamepad_result.get("ok", false)) or String(gamepad_result.get("row_id", "")) != "settings_gamepad_curve" or String(main_node.get("ui_screen_model").current_screen) != "input_settings":
		return _fail("gamepad curve overview card route invalid %s" % [gamepad_result])
	snapshot = main_node.call("_ui_overlay_snapshot")
	if not _assert_page_health(snapshot, "input_settings", 2, 3):
		return false
	if String(snapshot.get("selected_row_id", "")) != "gamepad_curve":
		return _fail("gamepad curve deep link should focus target row %s" % [snapshot])
	rows = main_node.call("_ui_screen_rows", 48)
	if not _rows_have_ids(rows, ["input_profile", "gamepad_curve", "gamepad_sensitivity", "binding_shoot", "binding_bomb"]):
		return _fail("input settings rows missing gamepad/keybind controls")
	if not await _assert_deep_row_visible("input_settings", "binding_focus"):
		return false
	if not String(snapshot.get("selected_speed_preview", "")).contains("move"):
		return _fail("input settings should expose gamepad speed preview %s" % String(snapshot.get("selected_speed_preview", "")))
	var parent_result: Dictionary = main_node.call("_ui_press_visible_quick_action", 0)
	await _settle_frames(2)
	if not bool(parent_result.get("ok", false)) or String(main_node.get("ui_screen_model").current_screen) != "player_settings":
		return _fail("input settings parent quick action invalid %s" % [parent_result])
	snapshot = main_node.call("_ui_overlay_snapshot")
	if String(snapshot.get("selected_row_id", "")) != "settings_gamepad_curve":
		return _fail("player settings should restore last hub row after parent return %s" % [snapshot])
	var keybind_result: Dictionary = main_node.call("_ui_press_visible_overview_card", 2)
	await _settle_frames(2)
	if not bool(keybind_result.get("ok", false)) or String(keybind_result.get("row_id", "")) != "settings_keybinds" or String(main_node.get("ui_screen_model").current_screen) != "input_settings":
		return _fail("key binding overview card route invalid %s" % [keybind_result])
	snapshot = main_node.call("_ui_overlay_snapshot")
	if String(snapshot.get("selected_row_id", "")) != "binding_shoot":
		return _fail("key binding deep link should focus target row %s" % [snapshot])
	rows = main_node.call("_ui_screen_rows", 48)
	var preview_index := _row_index_by_id(rows, "gamepad_curve_preview")
	if preview_index < 0:
		return _fail("gamepad curve preview row missing")
	main_node.call("_ui_set_cursor", preview_index)
	await _settle_frames(2)
	snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(snapshot.get("detail", "")).contains("*") and not String(snapshot.get("control_preview", "")).contains("*"):
		return _fail("gamepad curve should render preview nodes %s / %s" % [String(snapshot.get("detail", "")), String(snapshot.get("control_preview", ""))])
	if int(snapshot.get("control_buttons", 0)) != 0:
		return _fail("gamepad curve preview should be read-only %s" % String(snapshot.get("control_buttons_text", "")))
	snapshot = await _open_snapshot("audio_settings")
	if not _assert_page_health(snapshot, "audio_settings", 2, 3):
		return false
	rows = main_node.call("_ui_screen_rows", 48)
	if not _rows_have_ids(rows, ["audio_voice_locale", "audio_group_master", "audio_group_music", "audio_group_sfx", "audio_reset_all"]):
		return _fail("audio settings rows missing volume controls")
	if not await _assert_deep_row_visible("audio_settings", "audio_reset_all"):
		return false
	var voice_index := _row_index_by_id(rows, "audio_voice_locale")
	if voice_index < 0:
		return _fail("voice language row missing")
	main_node.call("_ui_set_cursor", voice_index)
	await _settle_frames(2)
	var voice_result: Dictionary = main_node.call("_ui_press_visible_control", 1)
	await _settle_frames(2)
	if not bool(voice_result.get("ok", false)) or String(main_node.get("audio_settings").get("voice_locale")) != "en":
		return _fail("voice language control did not switch to English %s locale %s" % [voice_result, String(main_node.get("audio_settings").get("voice_locale"))])
	var voice_reset: Dictionary = main_node.call("_ui_press_visible_control", 2)
	await _settle_frames(2)
	if not bool(voice_reset.get("ok", false)) or String(main_node.get("audio_settings").get("voice_locale")) != "zh-CN":
		return _fail("voice language reset did not restore zh-CN %s locale %s" % [voice_reset, String(main_node.get("audio_settings").get("voice_locale"))])
	snapshot = await _open_snapshot("display_settings")
	if not _assert_page_health(snapshot, "display_settings", 2, 3):
		return false
	if _snapshot_contains_debug_settings_path(snapshot):
		return _fail("display settings should not show local settings path %s" % [snapshot])
	rows = main_node.call("_ui_screen_rows", 48)
	if not _rows_have_ids(rows, ["display_resolution", "display_window_mode", "display_vsync", "display_fps_limit"]):
		return _fail("display settings rows missing resolution/video controls")
	if not await _assert_deep_row_visible("display_settings", "access_low_flash"):
		return false
	var resolution_index := _row_index_by_id(rows, "display_resolution")
	if resolution_index < 0:
		return _fail("display resolution row missing")
	main_node.call("_ui_set_cursor", resolution_index)
	await _settle_frames(2)
	snapshot = main_node.call("_ui_overlay_snapshot")
	var resolution_controls := String(snapshot.get("control_buttons_text", ""))
	if not resolution_controls.contains("<") or not resolution_controls.contains(">") or not resolution_controls.contains("Reset"):
		return _fail("display resolution should expose compact left/right/reset controls %s" % resolution_controls)
	return true

func _assert_deep_row_visible(screen_id: String, row_id: String) -> bool:
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 64)
	var row_index := _row_index_by_id(rows, row_id)
	if row_index < 0:
		return _fail("%s missing deep row %s" % [screen_id, row_id])
	main_node.call("_ui_set_cursor", row_index)
	await _settle_frames(2)
	var snapshot: Dictionary = main_node.call("_ui_overlay_snapshot")
	if String(snapshot.get("selected_row_id", "")) != row_id or not bool(snapshot.get("selected_row_visible", false)):
		return _fail("%s deep row %s not visible in row window %s / %s" % [
			screen_id,
			row_id,
			String(snapshot.get("visible_row_window_ids", "")),
			String(snapshot.get("visible_row_window_indices", "")),
		])
	return true

func _validate_collection_page_contract() -> bool:
	stage = "collection"
	var snapshot: Dictionary = await _open_snapshot("collection")
	if not _assert_page_health(snapshot, "collection", 1, 4):
		return false
	if not _assert_target_page_contract(snapshot, "collection", ["collection_grid", "filter_tabs", "focus_panel"], ["deck_state", "chest_state", "replay_state"], "frame:collection_cards"):
		return false
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(rows, ["collection_deck", "collection_chest", "collection_replay", "collection_workshop"]):
		return _fail("collection rows missing deck/chest/replay/workshop")
	var focus_result: Dictionary = main_node.call("_ui_press_visible_focus_action")
	await _settle_frames(2)
	if not bool(focus_result.get("ok", false)) or String(focus_result.get("row_id", "")) != "collection_deck" or String(main_node.get("ui_screen_model").current_screen) != "deck":
		return _fail("collection focus action should open deck %s" % [focus_result])
	return true

func _press_home_button(index: int, expected_screen: String) -> bool:
	if not main_node.call("_open_ui_screen", "main_menu"):
		return _fail("main menu did not reopen")
	main_node.call("_set_test_viewport_size", TEST_VIEWPORT)
	await _settle_frames(2)
	var result: Dictionary = main_node.call("_ui_press_visible_home_button", index)
	await _settle_frames(2)
	if not bool(result.get("ok", false)) or String(result.get("screen", "")) != expected_screen:
		return _fail("home button %d route invalid %s" % [index, result])
	return true

func _open_snapshot(screen_id: String) -> Dictionary:
	main_node.call("_open_ui_screen", screen_id)
	main_node.call("_set_test_viewport_size", TEST_VIEWPORT)
	await _settle_frames(2)
	return main_node.call("_ui_overlay_snapshot")

func _settle_frames(count: int) -> void:
	for i in range(count):
		await process_frame

func _prepare_default_language_state() -> void:
	var store: Variant = main_node.get("player_settings_store")
	if store != null and store.has_method("configure"):
		store.configure("user://settings/client_ui_smoke_test_player_settings.json")
	var localization: Variant = main_node.get("localization")
	if localization != null and localization.has_method("set_locale"):
		localization.set_locale("zh-CN")
	var audio_settings: Variant = main_node.get("audio_settings")
	if audio_settings != null and audio_settings.has_method("set_voice_locale"):
		audio_settings.set_voice_locale("zh-CN")
	if main_node.has_method("_update_ui_overlay"):
		main_node.call("_update_ui_overlay")

func _assert_default_language_state() -> bool:
	var localization: Variant = main_node.get("localization")
	if localization == null:
		return _fail("localization missing")
	if String(localization.get("locale")) != "zh-CN":
		return _fail("default locale should be zh-CN, got %s" % String(localization.get("locale")))
	if _text("screen.settings.language") == "screen.settings.language":
		return _fail("language label key missing")
	if _text("screen.settings.voice_language") == "screen.settings.voice_language":
		return _fail("voice language label key missing")
	var audio_settings: Variant = main_node.get("audio_settings")
	if audio_settings == null:
		return _fail("audio settings missing")
	if String(audio_settings.get("voice_locale")) != "zh-CN":
		return _fail("default voice locale should be zh-CN, got %s" % String(audio_settings.get("voice_locale")))
	return true

func _assert_page_health(snapshot: Dictionary, label: String, expected_quick_max: int, expected_overview_max: int) -> bool:
	if int(snapshot.get("visible_control_overlap_count", 0)) != 0:
		return _fail("%s visible controls overlap %s" % [label, String(snapshot.get("visible_control_overlaps", ""))])
	if bool(snapshot.get("visible", true)) and int(snapshot.get("visible_focusable_count", 0)) <= 0:
		return _fail("%s has no visible focusable controls %s" % [label, snapshot])
	if bool(snapshot.get("visible", true)) and not bool(snapshot.get("selected_row_visible", true)):
		return _fail("%s selected row is outside visible row window: selected %s/%d in %s (%s)" % [
			label,
			String(snapshot.get("selected_row_id", "")),
			int(snapshot.get("selected_row_index", -1)),
			String(snapshot.get("visible_row_window_ids", "")),
			String(snapshot.get("visible_row_window_indices", "")),
		])
	if int(snapshot.get("visible_focus_without_neighbor_count", 0)) != 0:
		return _fail("%s visible controls missing focus neighbors %s" % [label, String(snapshot.get("visible_focus_without_neighbor", ""))])
	if int(snapshot.get("visible_control_small_target_count", 0)) != 0:
		return _fail("%s visible controls below minimum target size %s" % [label, String(snapshot.get("visible_control_small_targets", ""))])
	if int(snapshot.get("visible_text_unclipped_count", 0)) != 0:
		return _fail("%s visible button text is not clipped/ellipsized %s" % [label, String(snapshot.get("visible_text_unclipped", ""))])
	if int(snapshot.get("visible_label_unwrapped_count", 0)) != 0:
		return _fail("%s visible labels are not wrapped %s" % [label, String(snapshot.get("visible_label_unwrapped", ""))])
	if int(snapshot.get("visible_label_out_of_panel_count", 0)) != 0:
		return _fail("%s visible labels extend outside panel %s" % [label, String(snapshot.get("visible_label_out_of_panel", ""))])
	if int(snapshot.get("visible_mouse_blocked_count", 0)) != 0:
		return _fail("%s visible buttons are not mouse-operable %s" % [label, String(snapshot.get("visible_mouse_blocked", ""))])
	if int(snapshot.get("page_state_region_count", 0)) <= 0 or String(snapshot.get("page_state_regions", "")).is_empty():
		return _fail("%s missing page state regions %s" % [label, snapshot])
	if int(snapshot.get("page_layout_slot_count", 0)) <= 0 or String(snapshot.get("page_layout_slots", "")).is_empty():
		return _fail("%s missing page layout slots %s" % [label, snapshot])
	if int(snapshot.get("page_status_region_count", 0)) <= 0 or String(snapshot.get("page_status_regions", "")).is_empty():
		return _fail("%s missing page status regions %s" % [label, snapshot])
	if int(snapshot.get("page_controller_action_count", 0)) <= 0 or String(snapshot.get("page_controller_actions", "")).is_empty():
		return _fail("%s missing controller actions %s" % [label, snapshot])
	if int(snapshot.get("page_asset_usage_count", 0)) <= 0 or String(snapshot.get("page_asset_usage", "")).is_empty():
		return _fail("%s missing asset usage records %s" % [label, snapshot])
	if int(snapshot.get("page_input_method_count", 0)) <= 0 or not _contains_all(String(snapshot.get("page_input_methods", "")), ["keyboard", "gamepad", "mouse"]):
		return _fail("%s missing keyboard/gamepad/mouse contract %s" % [label, snapshot])
	if int(snapshot.get("page_focus_section_count", 0)) <= 0 or String(snapshot.get("page_focus_sections", "")).is_empty():
		return _fail("%s missing focus section contract %s" % [label, snapshot])
	if bool(snapshot.get("visible", true)) and int(snapshot.get("page_focus_section_missing_visible_count", 0)) != 0:
		return _fail("%s missing visible controls for focus sections %s in %s" % [label, String(snapshot.get("page_focus_sections_missing_visible", "")), String(snapshot.get("page_focus_sections", ""))])
	if int(snapshot.get("page_text_fit_policy_count", 0)) <= 0 or not _contains_all(String(snapshot.get("page_text_fit_policy", "")), ["clip_button_text", "ellipsis_overrun", "wrap_labels"]):
		return _fail("%s missing text fit policy %s" % [label, snapshot])
	if String(snapshot.get("page_visual_asset", "")).is_empty() or String(snapshot.get("page_visual_treatment", "")).is_empty():
		return _fail("%s missing page visual contract %s" % [label, snapshot])
	if int(snapshot.get("quick_buttons", 0)) > expected_quick_max:
		return _fail("%s quick buttons too noisy %s" % [label, snapshot])
	if expected_overview_max >= 0 and int(snapshot.get("overview_cards", 0)) > expected_overview_max:
		return _fail("%s overview cards exceeded compact limit %s" % [label, snapshot])
	if _visible_text_has_debug_labels(snapshot):
		return _fail("%s leaked debug labels %s" % [label, snapshot])
	return true

func _assert_target_page_contract(snapshot: Dictionary, label: String, layout_tokens: Array[String], status_tokens: Array[String], asset_usage_token: String) -> bool:
	var layout_text := String(snapshot.get("page_layout_slots", ""))
	if not _contains_all(layout_text, layout_tokens):
		return _fail("%s layout slots missing %s in %s" % [label, layout_tokens, layout_text])
	var status_text := String(snapshot.get("page_status_regions", ""))
	if not _contains_all(status_text, status_tokens):
		return _fail("%s status regions missing %s in %s" % [label, status_tokens, status_text])
	var controller_text := String(snapshot.get("page_controller_actions", ""))
	if not _contains_all(controller_text, ["ui_up", "ui_down", "ui_accept"]):
		return _fail("%s controller actions missing base navigation %s" % [label, controller_text])
	if label != "home" and not _contains_all(controller_text, ["ui_left_control", "ui_right_control"]):
		return _fail("%s controller actions missing secondary navigation %s" % [label, controller_text])
	if not String(snapshot.get("page_asset_usage", "")).contains(asset_usage_token):
		return _fail("%s asset usage missing %s in %s" % [label, asset_usage_token, String(snapshot.get("page_asset_usage", ""))])
	if int(snapshot.get("page_focus_action_count", 0)) <= 0 or String(snapshot.get("page_focus_action_ids", "")).is_empty():
		return _fail("%s missing focus action ids %s" % [label, snapshot])
	if label != "home" and (int(snapshot.get("focus_buttons", 0)) <= 0 or String(snapshot.get("focus_action", "")).is_empty()):
		return _fail("%s focus panel missing actionable target %s" % [label, snapshot])
	if label != "home":
		var focus_sections := String(snapshot.get("page_focus_sections", ""))
		if not _contains_all(focus_sections, ["category_tabs", "focus_panel", "row_window"]):
			return _fail("%s focus sections missing category/focus/rows %s" % [label, focus_sections])
	return true

func _assert_nav_family(snapshot: Dictionary, label: String, expected_tokens: Array[String], blocked_tokens: Array[String]) -> bool:
	var nav_text := String(snapshot.get("nav_text", ""))
	if not _contains_all(nav_text, expected_tokens):
		return _fail("%s nav missing expected family entries %s" % [label, nav_text])
	if _contains_any(nav_text, blocked_tokens):
		return _fail("%s nav leaked another family %s" % [label, nav_text])
	return true

func _visible_text_has_debug_labels(snapshot: Dictionary) -> bool:
	var fields := ["shell", "page_experience_text", "section_summary", "control_preview", "status", "detail", "hint", "focus_panel", "quick_actions_text", "overview_cards_text", "status_cards_text"]
	var blocked := ["Primary:", "Tasks:", "Now:", "debug_status", "layout_", "page_", "row_id", "screen_id"]
	for field in fields:
		var text := String(snapshot.get(field, ""))
		for token in blocked:
			if text.contains(token):
				return true
	return false

func _snapshot_contains_debug_settings_path(snapshot: Dictionary) -> bool:
	var fields := ["shell", "page_experience_text", "section_summary", "control_preview", "status", "detail", "hint", "quick_actions_text", "overview_cards_text", "status_cards_text"]
	for field in fields:
		var text := String(snapshot.get(field, ""))
		if text.contains("user://settings") or text.contains("player_settings.json"):
			return true
	return false

func _rows_have_ids(rows: Array[Dictionary], ids: Array[String]) -> bool:
	var found: Array[String] = []
	for row in rows:
		found.append(String(row.get("id", "")))
	for id in ids:
		if not found.has(String(id)):
			push_error("client_ui_smoke_test missing row %s in %s" % [String(id), found])
			return false
	return true

func _row_index_by_id(rows: Array[Dictionary], row_id: String) -> int:
	for i in range(rows.size()):
		if String(rows[i].get("id", "")) == row_id:
			return i
	return -1

func _row_by_id(rows: Array[Dictionary], row_id: String) -> Dictionary:
	for row in rows:
		if String(row.get("id", "")) == row_id:
			return row
	return {}

func _text(key: String) -> String:
	var localization: Variant = main_node.get("localization")
	if localization != null and localization.has_method("text_for"):
		return String(localization.call("text_for", key))
	return key

func _text_keys(keys: Array[String]) -> Array[String]:
	var result: Array[String] = []
	for key in keys:
		var value := _text(key)
		if not value.is_empty():
			result.append(value)
	return result

func _contains_all(text: String, tokens: Array[String]) -> bool:
	for token in tokens:
		if not text.contains(token):
			return false
	return true

func _contains_any(text: String, tokens: Array[String]) -> bool:
	for token in tokens:
		if text.contains(token):
			return true
	return false

func _fail(message: String) -> bool:
	failed = true
	push_error("client_ui_smoke_test failed at %s: %s" % [stage, message])
	return false
