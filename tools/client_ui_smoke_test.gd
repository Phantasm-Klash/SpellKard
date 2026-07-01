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
	if not String(snapshot.get("overview_cards_text", "")).contains("hp"):
		return _fail("play overview cards missing boss local status %s" % String(snapshot.get("overview_cards_text", "")))
	if not _assert_page_authority_contract(snapshot, "play", "boss_server_settlement", "Boss display local"):
		return false
	if _contains_any(String(snapshot.get("quick_actions_text", "")), _text_keys(["screen.main.start_match", "screen.main.network_match", "screen.play.practice"])):
		return _fail("play quick actions should only carry shell navigation %s" % String(snapshot.get("quick_actions_text", "")))
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 32)
	if not _rows_have_ids(rows, ["play_practice", "play_matchmaking", "play_pvp_duel", "play_world_boss", "play_world_boss_status", "play_instance_boss_status", "play_certification_hub"]):
		return _fail("play rows missing expected modes")
	if not _assert_boss_status_row(_row_by_id(rows, "play_world_boss_status"), "world_boss"):
		return false
	if not _assert_boss_status_row(_row_by_id(rows, "play_instance_boss_status"), "instance_boss"):
		return false
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
	if not _assert_page_authority_contract(snapshot, "match", "boss_server_settlement", "Boss display local"):
		return false
	rows = main_node.call("_ui_screen_rows", 64)
	if not _rows_have_ids(rows, ["matchmaking_boss", "match_world_boss_status", "match_instance_boss_status"]):
		return _fail("match rows missing boss status rows")
	if not _assert_boss_status_row(_row_by_id(rows, "match_world_boss_status"), "world_boss"):
		return false
	if not _assert_boss_status_row(_row_by_id(rows, "match_instance_boss_status"), "instance_boss"):
		return false
	if not main_node.call("_configure_boss_party", "world_boss", ["p1", "p2", "p3", "p4"]):
		return _fail("world boss UI party setup failed")
	if main_node.call("_configure_boss_party", "world_boss", ["p1", "p2", "p2", "p4"]):
		return _fail("world boss duplicate party ids should be rejected")
	if not main_node.call("_configure_boss_party", "instance_boss", ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]):
		return _fail("instance boss UI party setup failed")
	if main_node.call("_configure_boss_party", "instance_boss", ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p7"]):
		return _fail("instance boss duplicate party ids should be rejected")
	snapshot = await _open_snapshot("modes")
	rows = main_node.call("_ui_screen_rows", 64)
	if not _assert_boss_party_status_row(_row_by_id(rows, "world_boss_party"), "world_boss", 4, "cardinal_4"):
		return false
	if not _assert_boss_party_status_row(_row_by_id(rows, "instance_boss_party"), "instance_boss", 8, "eight_direction_8"):
		return false
	if not _assert_boss_formation_row(_row_by_id(rows, "world_boss_formation"), "world_boss", 4, "cardinal_4"):
		return false
	if not _assert_boss_formation_row(_row_by_id(rows, "instance_boss_formation"), "instance_boss", 8, "eight_direction_8"):
		return false
	if not _assert_boss_practice_preview_row(_row_by_id(rows, "world_boss_practice_preview"), "world_boss"):
		return false
	if not _assert_boss_practice_preview_row(_row_by_id(rows, "instance_boss_practice_preview"), "instance_boss"):
		return false
	var modes_overview_text := String(snapshot.get("overview_cards_text", ""))
	if not modes_overview_text.contains(_text("screen.settings.boss_spellbook")) or not modes_overview_text.contains("phases") or not modes_overview_text.contains("digest"):
		return _fail("modes overview cards missing boss practice preview card metrics %s" % modes_overview_text)
	if not await _assert_boss_practice_preview_launch("world_boss_practice_preview", "world_boss"):
		return false
	if not await _assert_boss_practice_preview_launch("instance_boss_practice_preview", "instance_boss"):
		return false
	snapshot = await _open_snapshot("modes")
	rows = main_node.call("_ui_screen_rows", 64)
	if not String(snapshot.get("page_focus_action_ids", "")).contains("world_boss_authority") or not String(snapshot.get("page_focus_action_ids", "")).contains("instance_boss_authority"):
		return _fail("modes focus actions should prioritize Boss authority cards %s" % [snapshot])
	var world_authority_row := _row_by_id(rows, "world_boss_authority")
	if world_authority_row.is_empty() or not String(world_authority_row.get("summary", "")).contains("server owns damage") or String(world_authority_row.get("damage_authority", "")) != "server" or bool(world_authority_row.get("client_result_authoritative", true)):
		return _fail("modes rows missing full Boss authority summary boundaries %s" % [world_authority_row])
	if not modes_overview_text.contains("client display/intents"):
		return _fail("modes overview cards missing visible Boss authority summary %s" % modes_overview_text)
	var world_authority_index := _row_index_by_id(rows, "world_boss_authority")
	if world_authority_index < 0:
		return _fail("modes page missing world boss authority row")
	main_node.call("_ui_set_cursor", world_authority_index)
	await _settle_frames(2)
	snapshot = main_node.call("_ui_overlay_snapshot")
	if String(snapshot.get("selected_row_id", "")) != "world_boss_authority" or not String(snapshot.get("detail", "")).contains("client display/intent"):
		return _fail("world boss authority focus detail invalid %s" % [snapshot])
	var world_entry_index := _row_index_by_id(rows, "world_boss_entry")
	if world_entry_index < 0:
		return _fail("modes page missing world boss entry row")
	main_node.call("_ui_set_cursor", world_entry_index)
	await _settle_frames(2)
	snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(snapshot.get("control_preview", "")).contains("ready_for_server_entry") or not String(snapshot.get("detail", "")).contains("server required"):
		return _fail("world boss entry should expose ready server-confirmation context %s" % [snapshot])
	if not _assert_boss_action_contract(_row_by_id(rows, "world_boss_entry"), "world_boss", true, true, "required"):
		return false
	if not _assert_boss_action_contract(_row_by_id(rows, "world_boss_display"), "world_boss", true, true, "required"):
		return false
	var instance_entry_index := _row_index_by_id(rows, "instance_boss_entry")
	if instance_entry_index < 0:
		return _fail("modes page missing instance boss entry row")
	main_node.call("_ui_set_cursor", instance_entry_index)
	await _settle_frames(2)
	snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(snapshot.get("control_preview", "")).contains("blocked_local") or not String(snapshot.get("detail", "")).contains("entry_locked"):
		return _fail("locked instance boss entry should expose local blocker context %s" % [snapshot])
	if not _assert_boss_action_contract(_row_by_id(rows, "instance_boss_entry"), "instance_boss", false, true, "blocked_local"):
		return false
	if not _assert_boss_action_contract(_row_by_id(rows, "instance_boss_display"), "instance_boss", false, true, "blocked_local"):
		return false
	if not await _validate_boss_settlement_receipts():
		return false
	snapshot = await _open_snapshot("network_match")
	if not _assert_page_health(snapshot, "network_match", 2, 4):
		return false
	if not _contains_all(String(snapshot.get("overview_cards_text", "")), ["Gensoulkyo", "create room"]):
		return _fail("network match overview cards invalid %s" % String(snapshot.get("overview_cards_text", "")))
	return true

func _validate_boss_settlement_receipts() -> bool:
	stage = "boss_settlement_receipts"
	if main_node.call("_apply_world_boss_result", {
		"client_result_authoritative": true,
		"boss_hp_after_global": 0,
		"team_damage": 999999,
	}):
		return _fail("client-authored world boss result accepted")
	var rejected_snapshot: Dictionary = await _open_snapshot("modes")
	var rejected_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 64)
	var rejected_world_result_index := _row_index_by_id(rejected_rows, "world_boss_result")
	if rejected_world_result_index < 0:
		return _fail("modes page missing rejected world boss result row")
	var rejected_world_result := _row_by_id(rejected_rows, "world_boss_result")
	if not bool(rejected_world_result.get("result_rejected", false)) or String(rejected_world_result.get("result_rejected_reason", "")) != "client_authoritative_world_boss_result":
		return _fail("rejected world boss result reason missing %s" % [rejected_world_result])
	main_node.call("_ui_set_cursor", rejected_world_result_index)
	await _settle_frames(2)
	rejected_snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(rejected_snapshot.get("detail", "")).contains("rejected client_authoritative_world_boss_result"):
		return _fail("rejected world boss detail missing rejection reason %s" % [rejected_snapshot])
	if not main_node.call("_apply_world_boss_result", {
		"match_id": "world_match_ui",
		"boss_instance_id": "world_boss_0",
		"boss_hp_after_global": 87500,
		"boss_hp_global_max": 100000,
		"damage_this_match": 12500,
		"global_damage_applied": 12500,
		"daily_attempts_left": 2,
		"settlement_status": "applied",
		"settlement_receipt": {
			"receipt_id": "world_receipt_ui",
			"result_hash": "world_hash_ui",
			"replay_id": "world_replay_ui",
			"server_time": "2026-06-30T00:00:00Z",
			"key_id": "boss_result_key",
		},
		"server_authoritative": true,
	}):
		return _fail("world boss server result application failed")
	if not main_node.call("_apply_instance_boss_result", {
		"match_id": "instance_match_ui",
		"boss_defeated": true,
		"instance_cleared": true,
		"survivors": 4,
		"failed_mechanic": false,
		"boss_hp_after": 0,
		"clear_time_seconds": 142,
		"three_star_time_seconds": 180,
		"deaths": 0,
		"bombs_used": 1,
		"bomb_limit": 3,
		"settlement_status": "cleared",
		"settlement_receipt": {
			"receipt_id": "instance_receipt_ui",
			"result_hash": "instance_hash_ui",
			"replay_id": "instance_replay_ui",
			"server_time": "2026-06-30T00:01:00Z",
			"key_id": "boss_result_key",
		},
		"server_authoritative": true,
	}):
		return _fail("instance boss server result application failed")
	var snapshot: Dictionary = await _open_snapshot("modes")
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 64)
	if not _assert_boss_result_receipt_row(_row_by_id(rows, "world_boss_result"), "world_boss", "world_receipt_ui", "world_hash_ui"):
		return false
	if not _assert_boss_outcome_projection(_row_by_id(rows, "world_boss_result"), "world_boss", "world_boss_persistent_hp_outcome", "applied"):
		return false
	if not _assert_boss_result_authority_summary(_row_by_id(rows, "world_boss_result"), "world_boss", "world_boss_persistent_hp"):
		return false
	if bool(_row_by_id(rows, "world_boss_result").get("result_rejected", true)):
		return _fail("world boss server receipt did not clear rejected flag %s" % [_row_by_id(rows, "world_boss_result")])
	if not _assert_boss_result_receipt_row(_row_by_id(rows, "instance_boss_result"), "instance_boss", "instance_receipt_ui", "instance_hash_ui"):
		return false
	if not _assert_boss_outcome_projection(_row_by_id(rows, "instance_boss_result"), "instance_boss", "instance_boss_clear_outcome", "cleared"):
		return false
	if not _assert_boss_result_authority_summary(_row_by_id(rows, "instance_boss_result"), "instance_boss", "instance_boss_clear"):
		return false
	var world_result_index := _row_index_by_id(rows, "world_boss_result")
	if world_result_index < 0:
		return _fail("modes page missing world boss result row")
	main_node.call("_ui_set_cursor", world_result_index)
	await _settle_frames(2)
	snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(snapshot.get("detail", "")).contains("boss server receipt") or not String(snapshot.get("detail", "")).contains("world_receipt_ui"):
		return _fail("world boss result detail missing server receipt context %s" % [snapshot])
	var instance_result_index := _row_index_by_id(rows, "instance_boss_result")
	if instance_result_index < 0:
		return _fail("modes page missing instance boss result row")
	main_node.call("_ui_set_cursor", instance_result_index)
	await _settle_frames(2)
	snapshot = main_node.call("_ui_overlay_snapshot")
	if not String(snapshot.get("control_preview", "")).contains("server_receipt_ready") or not String(snapshot.get("detail", "")).contains("instance_receipt_ui"):
		return _fail("instance boss result detail missing server receipt context %s" % [snapshot])
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
	snapshot = await _open_snapshot("replay")
	if not _assert_page_health(snapshot, "replay", 2, 4):
		return false
	if not _assert_page_authority_contract(snapshot, "replay", "local_practice_verification_only", "Replay hash local practice only"):
		return false
	var replay_rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 8)
	if replay_rows.is_empty() or String(replay_rows[0].get("id", "")) != "replay_verification_summary":
		return _fail("replay page missing verification summary row %s" % [replay_rows])
	if not String(replay_rows[0].get("ui_action", "")).is_empty() or String(replay_rows[0].get("ui_control", "")) != "status" or bool(replay_rows[0].get("client_result_authoritative", true)):
		return _fail("replay verification summary should be status-only %s" % [replay_rows[0]])
	if not _assert_replay_ui_authority_row(replay_rows[0]):
		return false
	var replay_authority_summary := _row_by_id(replay_rows, "replay_authority_summary")
	if replay_authority_summary.is_empty() \
			or String(replay_authority_summary.get("ui_control", "")) != "status" \
			or not String(replay_authority_summary.get("ui_action", "")).is_empty() \
			or String(replay_authority_summary.get("authority_contract_kind", "")) != "replay_local_display_server_audit_summary" \
			or String(replay_authority_summary.get("online_replay_authority", "")) != "server_audit_required" \
			or String(replay_authority_summary.get("boss_hp_authority", "")) != "server" \
			or bool(replay_authority_summary.get("client_result_authoritative", true)):
		return _fail("replay page missing authority summary contract %s" % [replay_rows])
	if not _assert_replay_ui_authority_row(replay_authority_summary):
		return false
	var replay_playability_summary := _row_by_id(replay_rows, "replay_playability_summary")
	var expected_playability_filter := "replay_filter_replay_server_pending" if bool(replay_playability_summary.get("selected_requires_server_audit", false)) else "replay_filter_replay_local_ready"
	if replay_playability_summary.is_empty() \
			or String(replay_playability_summary.get("ui_control", "")) != "status" \
			or not String(replay_playability_summary.get("ui_action", "")).is_empty() \
			or String(replay_playability_summary.get("recommended_filter_row_id", "")) != expected_playability_filter \
			or bool(replay_playability_summary.get("client_result_authoritative", true)) \
			or String(replay_playability_summary.get("online_replay_authority", "")) != "server_audit_required" \
			or String(replay_playability_summary.get("boss_hp_authority", "")) != "server":
		return _fail("replay page missing playability summary contract %s" % [replay_rows])
	if not _assert_replay_ui_authority_row(replay_playability_summary):
		return false
	var practice_checklist := _row_by_id(replay_rows, "replay_practice_validation_checklist")
	if practice_checklist.is_empty() \
			or String(practice_checklist.get("ui_control", "")) != "status" \
			or not String(practice_checklist.get("ui_action", "")).is_empty() \
			or String(practice_checklist.get("checklist_kind", "")) != "replay_practice_validation_checklist" \
			or String(practice_checklist.get("authority_contract_kind", "")) != "replay_local_practice_validation_checklist" \
			or String(practice_checklist.get("online_replay_authority", "")) != "server_audit_required" \
			or String(practice_checklist.get("boss_hp_authority", "")) != "server" \
			or bool(practice_checklist.get("client_result_authoritative", true)):
		return _fail("replay page missing practice validation checklist contract %s" % [replay_rows])
	var checklist_items: Array = practice_checklist.get("checklist_items", [])
	if checklist_items.size() != 5 \
			or int(practice_checklist.get("checklist_ready_count", -1)) + int(practice_checklist.get("checklist_blocked_count", -1)) != checklist_items.size():
		return _fail("replay practice validation checklist counts invalid %s" % [practice_checklist])
	if not _checklist_has_ids(checklist_items, ["metadata_valid", "input_integrity_valid_or_preview", "final_hash_present", "server_audit_not_required", "local_file_available"]):
		return _fail("replay practice validation checklist missing gates %s" % [practice_checklist])
	for item in checklist_items:
		if bool(item.get("client_result_authoritative", true)) or String(item.get("online_replay_authority", "")) != "server_audit_required":
			return _fail("replay practice validation checklist item authority invalid %s" % [item])
	if not _assert_replay_ui_authority_row(practice_checklist):
		return false
	var boss_practice_summary := _row_by_id(replay_rows, "replay_boss_practice_verification")
	if boss_practice_summary.is_empty() \
			or String(boss_practice_summary.get("ui_control", "")) != "status" \
			or not String(boss_practice_summary.get("ui_action", "")).is_empty() \
			or String(boss_practice_summary.get("overview_card_kind", "")) != "boss_practice_replay_verification" \
			or String(boss_practice_summary.get("render_slot", "")) != "overview_cards" \
			or String(boss_practice_summary.get("online_replay_authority", "")) != "server_audit_required" \
			or String(boss_practice_summary.get("boss_hp_authority", "")) != "server" \
			or bool(boss_practice_summary.get("client_result_authoritative", true)):
		return _fail("replay page missing boss practice verification summary contract %s" % [replay_rows])
	var boss_practice_metrics: Array = boss_practice_summary.get("verification_card_metrics", [])
	if boss_practice_metrics.size() < 4:
		return _fail("boss practice replay verification metrics missing %s" % [boss_practice_summary])
	if int(boss_practice_summary.get("boss_practice_entry_count", 0)) > 0:
		if String(boss_practice_summary.get("recommended_filter_row_id", "")) != "replay_filter_replay_boss_practice" \
				or String(boss_practice_summary.get("selected_local_playback_authority", "")) != "local_practice_hash" \
				or bool(boss_practice_summary.get("selected_requires_server_audit", true)) \
				or not bool(boss_practice_summary.get("selected_can_play", false)):
			return _fail("boss practice replay verification selected context invalid %s" % [boss_practice_summary])
	else:
		if String(boss_practice_summary.get("recommended_filter_row_id", "")) != "replay_filter_all" \
				or String(boss_practice_summary.get("selected_local_playback_authority", "")) != "none" \
				or bool(boss_practice_summary.get("selected_requires_server_audit", true)) \
				or bool(boss_practice_summary.get("selected_can_play", true)):
			return _fail("empty boss practice replay verification context invalid %s" % [boss_practice_summary])
	var boss_practice_badges: Array = boss_practice_summary.get("verification_card_authority_badges", [])
	if not boss_practice_badges.has("local_practice_verification_only") or not boss_practice_badges.has("online_replay_server_audit") or not boss_practice_badges.has("boss_hp_server") or not boss_practice_badges.has("settlement_server"):
		return _fail("boss practice replay verification badges missing authority boundaries %s" % [boss_practice_summary])
	if not _assert_replay_ui_authority_row(boss_practice_summary):
		return false
	var playback_guard_panel := _row_by_id(replay_rows, "replay_playback_guard_panel")
	if playback_guard_panel.is_empty() \
			or String(playback_guard_panel.get("ui_control", "")) != "status" \
			or not String(playback_guard_panel.get("ui_action", "")).is_empty() \
			or String(playback_guard_panel.get("panel_kind", "")) != "replay_playback_guard_panel" \
			or String(playback_guard_panel.get("authority_contract_kind", "")) != "replay_selected_local_playback_guard_panel" \
			or String(playback_guard_panel.get("render_slot", "")) != "focus_panel" \
			or String(playback_guard_panel.get("online_replay_authority", "")) != "server_audit_required" \
			or String(playback_guard_panel.get("boss_hp_authority", "")) != "server" \
			or bool(playback_guard_panel.get("client_result_authoritative", true)):
		return _fail("replay page missing selected playback guard panel contract %s" % [replay_rows])
	var panel_checklist: Array = playback_guard_panel.get("practice_checklist_items", [])
	if int(playback_guard_panel.get("practice_checklist_count", -1)) != panel_checklist.size() or panel_checklist.size() != 5:
		return _fail("replay playback guard panel checklist invalid %s" % [playback_guard_panel])
	if String(playback_guard_panel.get("selected_local_load_policy", "")) == "loadable_local_practice":
		if not bool(playback_guard_panel.get("selected_can_load", false)) \
				or String(playback_guard_panel.get("action_status", "")) != "local_playback_ready" \
				or bool(playback_guard_panel.get("selected_requires_server_audit", true)):
			return _fail("local replay playback guard panel should be ready %s" % [playback_guard_panel])
	else:
		if bool(playback_guard_panel.get("selected_can_load", true)) \
				or String(playback_guard_panel.get("action_status", "")) == "local_playback_ready":
			return _fail("blocked replay playback guard panel should not be loadable %s" % [playback_guard_panel])
	if not _assert_replay_ui_authority_row(playback_guard_panel):
		return false
	if not String(snapshot.get("section_tabs", "")).contains(_text("ui.menu_section_overview")):
		return _fail("replay filter tabs should expose verification overview %s" % [snapshot])
	if not String(snapshot.get("page_focus_action_ids", "")).contains("replay_filter_replay_boss_practice") or not String(snapshot.get("page_focus_action_ids", "")).contains("replay_filter_replay_local_ready"):
		return _fail("replay focus actions should include boss-practice and local-ready filters %s" % [snapshot])
	var expected_focus_action := "replay_filter_replay_boss_practice" if String(snapshot.get("focus_action", "")) == "replay_filter_replay_boss_practice" else "replay_filter_replay_local_ready"
	var replay_focus_result: Dictionary = main_node.call("_ui_press_visible_focus_action")
	await _settle_frames(2)
	if not bool(replay_focus_result.get("ok", false)) or String(replay_focus_result.get("row_id", "")) != expected_focus_action or String(main_node.get("ui_screen_model").current_screen) != "replay":
		return _fail("replay focus action should apply configured filter %s expected=%s" % [replay_focus_result, expected_focus_action])
	var focused_filter_row := _row_by_id(main_node.call("_ui_screen_rows", 12), expected_focus_action)
	if not bool(focused_filter_row.get("active", false)):
		return _fail("replay focus action did not activate filter %s" % [focused_filter_row])
	if String(focused_filter_row.get("verification_filter", "")) != expected_focus_action.trim_prefix("replay_filter_") or bool(focused_filter_row.get("client_result_authoritative", true)):
		return _fail("replay boss-practice focus row invalid %s" % [focused_filter_row])
	snapshot = main_node.call("_ui_overlay_snapshot")
	var replay_summary_card_result: Dictionary = main_node.call("_ui_press_visible_overview_card", 0)
	if not bool(replay_summary_card_result.get("ok", false)) or String(replay_summary_card_result.get("row_id", "")) != "replay_verification_summary" or String(replay_summary_card_result.get("screen", "")) != "replay":
		return _fail("replay verification summary overview card should stay on replay page %s" % [replay_summary_card_result])
	replay_rows = main_node.call("_ui_screen_rows", 12)
	var replay_filter_index := _row_index_by_id(replay_rows, "replay_filter_replay_local_ready")
	if replay_filter_index < 0 or String(replay_rows[replay_filter_index].get("ui_action", "")) != "set_replay_filter":
		return _fail("replay page missing local-ready filter action %s" % [replay_rows])
	var boss_filter_index := _row_index_by_id(replay_rows, "replay_filter_replay_boss_practice")
	if boss_filter_index < 0 or String(replay_rows[boss_filter_index].get("ui_action", "")) != "set_replay_filter":
		return _fail("replay page missing boss-practice filter action %s" % [replay_rows])
	if not _assert_replay_ui_authority_row(replay_rows[boss_filter_index]):
		return false
	if not _assert_replay_filter_card_row(replay_rows[boss_filter_index], "replay_boss_practice"):
		return false
	var load_action := _row_by_id(replay_rows, "replay_action_load")
	var favorite_action := _row_by_id(replay_rows, "replay_action_favorite")
	var remove_action := _row_by_id(replay_rows, "replay_action_remove")
	if load_action.is_empty() or favorite_action.is_empty() or remove_action.is_empty() or String(load_action.get("ui_action", "")) != "load_replay" or String(favorite_action.get("ui_action", "")) != "toggle_replay_favorite" or String(remove_action.get("ui_action", "")) != "remove_replay_from_index" or bool(load_action.get("client_result_authoritative", true)) or bool(favorite_action.get("client_result_authoritative", true)):
		return _fail("replay page missing load/favorite/remove action rows load=%s favorite=%s remove=%s" % [load_action, favorite_action, remove_action])
	if not _assert_replay_ui_authority_row(_row_by_id(replay_rows, "replay_filter_replay_local_ready")):
		return false
	if not _assert_replay_ui_authority_row(load_action):
		return false
	if not _assert_replay_ui_authority_row(favorite_action):
		return false
	if not _assert_replay_ui_authority_row(remove_action):
		return false
	if String(load_action.get("replay_id", "")).is_empty():
		if bool(load_action.get("enabled", true)) or bool(load_action.get("can_play", true)) or String(load_action.get("local_load_policy", "")) != "none":
			return _fail("empty replay load action should stay disabled %s" % [load_action])
	elif String(load_action.get("local_load_policy", "")) != "loadable_local_practice" or not bool(load_action.get("can_play", false)) or bool(load_action.get("requires_server_audit", true)):
		return _fail("replay load action should expose local-only load policy %s" % [load_action])
	var replay_load_index := _row_index_by_id(replay_rows, "replay_action_load")
	if replay_load_index >= 0:
		main_node.call("_ui_set_cursor", replay_load_index)
		await _settle_frames(2)
		snapshot = main_node.call("_ui_overlay_snapshot")
		var load_control_text := String(snapshot.get("control_buttons_text", ""))
		if bool(load_action.get("enabled", false)):
			if not load_control_text.contains(_text("screen.replay.load")) or not String(snapshot.get("control_preview", "")).contains(String(load_action.get("local_load_policy", ""))):
				return _fail("replay load action should expose context control %s" % [snapshot])
			var load_control_result: Dictionary = main_node.call("_ui_press_visible_control", 0)
			await _settle_frames(2)
			if not bool(load_control_result.get("ok", false)) or String(load_control_result.get("action", "")) != "accept_selected" or String(load_control_result.get("row_id", "")) != "replay_action_load":
				return _fail("replay load context control invalid %s" % [load_control_result])
	if not await _validate_server_replay_pending_guard():
		return false
	main_node.call("_ui_set_cursor", replay_filter_index)
	var replay_filter_result: Dictionary = main_node.call("_ui_accept_selected")
	await _settle_frames(2)
	if not bool(replay_filter_result.get("ok", false)) or String(replay_filter_result.get("verification_filter", "")) != "replay_local_ready" or String(main_node.get("ui_screen_model").current_screen) != "replay":
		return _fail("replay filter action did not stay on replay page %s" % [replay_filter_result])
	replay_rows = main_node.call("_ui_screen_rows", 12)
	if int(replay_filter_result.get("visible_entry_count", 0)) > 0:
		var replay_entry := _first_replay_entry_row(replay_rows)
		if replay_entry.is_empty() or String(replay_entry.get("ui_action", "")) != "load_replay" or String(replay_entry.get("ui_control", "")) != "replay" or String(replay_entry.get("section", "")) != "replay_local_ready":
			return _fail("replay entry row should stay loadable after filter %s" % [replay_rows])
	return true

func _validate_server_replay_pending_guard() -> bool:
	stage = "replay_server_pending_guard"
	var replay_model: RefCounted = main_node.get("replay_list_model")
	var replay_store: RefCounted = main_node.get("replay_store")
	if replay_model == null or replay_store == null:
		return _fail("replay model missing")
	var previous_entries: Array[Dictionary] = []
	for entry in replay_store.call("load_index"):
		if typeof(entry) == TYPE_DICTIONARY:
			previous_entries.append((entry as Dictionary).duplicate(true))
	var previous_cursor := int(replay_model.get("cursor"))
	var previous_filter := String(replay_model.get("active_verification_filter"))
	var base_entry: Dictionary = previous_entries[0] if not previous_entries.is_empty() else {}
	var pending_path := _server_pending_replay_path(replay_store, base_entry)
	if pending_path.is_empty():
		return _fail("could not prepare server pending replay file")
	var pending_entries: Array[Dictionary] = [_server_pending_replay_entry(base_entry, pending_path)]
	if not bool(replay_store.call("save_index", pending_entries)):
		return _fail("could not save server pending replay index")
	replay_model.set("cursor", 0)
	replay_model.call("set_verification_filter", "replay_server_pending")
	if not main_node.call("_open_ui_screen", "replay"):
		return _fail("replay page did not open for server pending guard")
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 12)
	var load_index := _row_index_by_id(rows, "replay_action_load")
	var load_row := _row_by_id(rows, "replay_action_load")
	if load_index < 0 or load_row.is_empty():
		return _fail("server pending replay load row missing %s" % [rows])
	if bool(load_row.get("enabled", true)) \
			or bool(load_row.get("can_play", true)) \
			or String(load_row.get("local_load_policy", "")) != "blocked_server_audit" \
			or not bool(load_row.get("requires_server_audit", false)):
		return _fail("server pending replay load row should be blocked %s" % [load_row])
	var guard: Dictionary = load_row.get("replay_action_guard", {})
	if bool(guard.get("ok", true)) \
			or String(guard.get("reason", "")) != "server_record_pending_audit" \
			or bool(guard.get("client_result_authoritative", true)):
		return _fail("server pending replay load guard invalid %s" % [guard])
	var guard_panel := _row_by_id(rows, "replay_playback_guard_panel")
	if guard_panel.is_empty() \
			or bool(guard_panel.get("selected_can_load", true)) \
			or String(guard_panel.get("action_status", "")) != "server_audit_required" \
			or String(guard_panel.get("selected_local_load_policy", "")) != "blocked_server_audit" \
			or not bool(guard_panel.get("selected_requires_server_audit", false)) \
			or String(guard_panel.get("selected_server_audit_status", "")) != "pending" \
			or not (guard_panel.get("guard_blockers", []) as Array).has("server_audit_required") \
			or bool(guard_panel.get("client_result_authoritative", true)):
		return _fail("server pending replay guard panel invalid %s" % [guard_panel])
	if not _assert_replay_ui_authority_row(guard_panel):
		return false
	main_node.call("_ui_set_cursor", load_index)
	await _settle_frames(2)
	var snapshot: Dictionary = main_node.call("_ui_overlay_snapshot")
	var preview := String(snapshot.get("control_preview", ""))
	if not preview.contains("guard_blocked") \
			or not preview.contains("server_record_pending_audit") \
			or not preview.contains("blocked_server_audit") \
			or not preview.contains("server_audit_pending") \
			or not preview.contains("settlement_server"):
		return _fail("server pending replay guard preview missing %s" % [snapshot])
	var load_control_result: Dictionary = main_node.call("_ui_press_visible_control", 0)
	if bool(load_control_result.get("ok", false)):
		return _fail("server pending replay load control should stay disabled %s" % [load_control_result])
	replay_store.call("save_index", previous_entries)
	replay_model.call("refresh")
	replay_model.set("cursor", previous_cursor)
	replay_model.call("set_verification_filter", previous_filter)
	main_node.call("_open_ui_screen", "replay")
	await _settle_frames(2)
	return true

func _server_pending_replay_path(replay_store: RefCounted, base_entry: Dictionary) -> String:
	var existing_path := String(base_entry.get("path", ""))
	if not existing_path.is_empty() and FileAccess.file_exists(existing_path):
		return existing_path
	var path := String(replay_store.call("latest_path"))
	var snapshot := {
		"ruleset_version": "ruleset-local-s0",
		"match_seed": 12345,
		"final_result_hash": 123456,
		"input_stream": [{"tick": 10}, {"tick": 11}, {"tick": 12}],
		"metadata": {
			"replay_id": "server-ui-pending-file",
			"mode": "pvp_duel",
			"result": "server_record",
			"final_tick": 12,
			"saved_at": "2026-06-30T00:02:00Z",
		},
	}
	if bool(replay_store.call("save_snapshot", snapshot, path)):
		return path
	return ""

func _server_pending_replay_entry(base_entry: Dictionary, path: String) -> Dictionary:
	var entry: Dictionary = base_entry.duplicate(true)
	entry.merge({
		"replay_id": "server-ui-pending",
		"path": path,
		"saved_at": "2026-06-30T00:02:00Z",
		"opponent": "server",
		"mode": "pvp_duel",
		"result": "server_record",
		"ruleset_version": "ruleset-local-s0",
		"game_version": "ui-smoke",
		"pattern_id": "server_pending",
		"score": 1000,
		"final_tick": 12,
		"final_result_hash": 123456,
		"input_count": 3,
		"input_first_tick": 10,
		"input_last_tick": 12,
		"input_tick_span": 3,
		"input_tick_monotonic": true,
		"input_tick_contiguous": true,
		"input_integrity_status": "valid",
		"server_authoritative": true,
	}, true)
	return entry

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

func _first_replay_entry_row(rows: Array[Dictionary]) -> Dictionary:
	for row in rows:
		if not String(row.get("replay_id", "")).is_empty():
			return row
	return {}

func _assert_boss_status_row(row: Dictionary, mode_id: String) -> bool:
	if row.is_empty():
		return _fail("boss status row missing for %s" % mode_id)
	if String(row.get("mode_id", "")) != mode_id:
		return _fail("boss status mode mismatch %s row=%s" % [mode_id, row])
	if String(row.get("mode_category", "")) != "boss":
		return _fail("boss status row missing boss category %s" % [row])
	if bool(row.get("client_result_authoritative", true)):
		return _fail("boss status row must not be client authoritative %s" % [row])
	if String(row.get("settlement_authority", "")) != "server":
		return _fail("boss status row must show server settlement authority %s" % [row])
	if not bool(row.get("requires_server_confirmation", false)):
		return _fail("boss status row must require server confirmation %s" % [row])
	if String(row.get("projection_scope", row.get("display_scope", "local_display_only"))) != "local_display_only":
		return _fail("boss status row must stay local display scoped %s" % [row])
	if String(row.get("status_contract_kind", "")) != "boss_local_status_projection" or int(row.get("status_contract_version", 0)) != 1:
		return _fail("boss status row missing status projection contract %s" % [row])
	if String(row.get("availability_contract_kind", "")) != "boss_action_availability_projection":
		return _fail("boss status row missing action availability contract %s" % [row])
	if String(row.get("entry_request_scope", "")) != "intent_only" or String(row.get("transfer_request_scope", "")) != "intent_only":
		return _fail("boss status row action scopes must stay intent-only %s" % [row])
	if String(row.get("entry_contract_kind", "")) != "boss_entry_verification_contract" or int(row.get("entry_contract_version", 0)) != 1:
		return _fail("boss status row missing entry verification contract %s" % [row])
	if String(row.get("intent_authority", "")) != "client_request_only":
		return _fail("boss status row intent authority invalid %s" % [row])
	if String(row.get("damage_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server":
		return _fail("boss status row must keep server damage/reward authority %s" % [row])
	var required_fields: Array = row.get("server_required_for", [])
	for field in ["entry_confirmation", "card_transfer_confirmation", "damage", "reward_grants", "settlement", "result_receipt"]:
		if not required_fields.has(field):
			return _fail("boss status row missing server-required field %s in %s" % [field, row])
	if mode_id == "world_boss":
		for field in ["persistent_hp", "daily_attempts", "defeated_at", "world_announcement"]:
			if not required_fields.has(field):
				return _fail("world boss status row missing server-required field %s in %s" % [field, row])
	else:
		for field in ["access_gate", "clear_status", "stars"]:
			if not required_fields.has(field):
				return _fail("instance boss status row missing server-required field %s in %s" % [field, row])
	var allowed_fields: Array = row.get("entry_intent_allowed_fields", [])
	if not allowed_fields.has("party_ids") or not allowed_fields.has("client_action_seq"):
		return _fail("boss status row missing entry intent fields %s" % [row])
	var forbidden_fields: Array = row.get("client_forbidden_entry_fields", [])
	for field in ["damage", "reward_grants", "settlement_receipt", "server_result_hash"]:
		if not forbidden_fields.has(field):
			return _fail("boss status row missing forbidden authority field %s in %s" % [field, row])
	if String(row.get("practice_preview_scope", "")) != "local_practice_preview_only":
		return _fail("boss status row practice preview must stay local-only %s" % [row])
	if String(row.get("receipt_status", "")) != "pending_server_receipt" and String(row.get("settlement_receipt_projection", {}).get("projection_scope", "")) != "server_settlement_receipt_projection":
		return _fail("boss status row receipt projection invalid %s" % [row])
	var value := String(row.get("value", ""))
	if not value.contains("hp") or not value.contains("attempts") or not value.contains("layout") or not value.contains("action"):
		return _fail("boss status row value should include hp and attempts %s" % [row])
	if not String(row.get("summary", "")).contains("client can only request entry or transfer"):
		return _fail("boss status row summary missing intent-only copy %s" % [row])
	if String(row.get("slot_layout_policy", "")).is_empty():
		return _fail("boss status row missing slot layout policy %s" % [row])
	if typeof(row.get("slot_labels", [])) != TYPE_ARRAY:
		return _fail("boss status row missing slot labels %s" % [row])
	return true

func _assert_boss_party_status_row(row: Dictionary, mode_id: String, expected_count: int, expected_layout: String) -> bool:
	if row.is_empty():
		return _fail("boss party status row missing for %s" % mode_id)
	if String(row.get("mode_id", "")) != mode_id or String(row.get("mode_category", "")) != "boss":
		return _fail("boss party status identity mismatch %s" % [row])
	if String(row.get("party_status_kind", "")) != "boss_party_status_summary":
		return _fail("boss party status summary kind missing %s" % [row])
	if bool(row.get("client_result_authoritative", true)):
		return _fail("boss party status must not be client authoritative %s" % [row])
	if String(row.get("projection_scope", "")) != "local_display_only" or String(row.get("intent_authority", "")) != "client_request_only":
		return _fail("boss party status scope/intent invalid %s" % [row])
	if String(row.get("damage_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server":
		return _fail("boss party status must keep server outcome authority %s" % [row])
	if not bool(row.get("requires_server_confirmation", false)):
		return _fail("boss party status must require server confirmation %s" % [row])
	if int(row.get("player_count", 0)) != expected_count or String(row.get("slot_layout_policy", "")) != expected_layout:
		return _fail("boss party status count/layout mismatch %s" % [row])
	if not bool(row.get("formation_valid", false)) or not bool(row.get("fixed_direction_ready", false)) or not bool(row.get("all_slots_face_center", false)):
		return _fail("boss party status formation flags invalid %s" % [row])
	var summary: Dictionary = row.get("party_status_summary", {})
	if summary.is_empty() or String(summary.get("party_status_kind", "")) != "boss_party_status_summary":
		return _fail("boss party status nested summary invalid %s" % [row])
	var server_required: Array = row.get("server_required_for", [])
	if not server_required.has("damage") or not server_required.has("settlement"):
		return _fail("boss party status missing server-required outcome fields %s" % [row])
	return true

func _assert_boss_formation_row(row: Dictionary, mode_id: String, expected_count: int, expected_layout: String) -> bool:
	if row.is_empty():
		return _fail("boss formation row missing for %s" % mode_id)
	if String(row.get("mode_id", "")) != mode_id or String(row.get("mode_category", "")) != "boss":
		return _fail("boss formation identity mismatch %s" % [row])
	if bool(row.get("client_result_authoritative", true)):
		return _fail("boss formation must not be client authoritative %s" % [row])
	if not bool(row.get("formation_valid", false)):
		return _fail("boss formation should remain valid after rejected duplicate party %s" % [row])
	if int(row.get("player_count", 0)) != expected_count or String(row.get("slot_layout_policy", "")) != expected_layout:
		return _fail("boss formation count/layout mismatch %s" % [row])
	var slots: Array = row.get("display_slots", [])
	var labels: Array = row.get("slot_labels", [])
	if slots.size() != expected_count or labels.size() != expected_count:
		return _fail("boss formation slots/labels mismatch %s" % [row])
	if int(row.get("formation_display_signature", 0)) <= 0:
		return _fail("boss formation missing stable display signature %s" % [row])
	for raw_slot in slots:
		var slot: Dictionary = raw_slot
		if not bool(slot.get("aim_to_center", false)) or bool(slot.get("client_result_authoritative", true)):
			return _fail("boss formation slot authority/aim mismatch %s" % [slot])
	return true

func _assert_boss_practice_preview_row(row: Dictionary, mode_id: String) -> bool:
	if row.is_empty():
		return _fail("boss practice preview row missing for %s" % mode_id)
	if String(row.get("mode_id", "")) != mode_id:
		return _fail("boss practice preview mode mismatch %s row=%s" % [mode_id, row])
	if String(row.get("mode_category", "")) != "boss":
		return _fail("boss practice preview row missing boss category %s" % [row])
	if bool(row.get("client_result_authoritative", true)) or bool(row.get("server_authoritative", true)):
		return _fail("boss practice preview must not claim result/server authority %s" % [row])
	if String(row.get("projection_scope", "")) != "local_practice_preview_only" or String(row.get("preview_authority_scope", "")) != "local_practice_preview_only":
		return _fail("boss practice preview scope mismatch %s" % [row])
	if String(row.get("replay_verification_scope", "")) != "local_practice_hash":
		return _fail("boss practice preview replay scope mismatch %s" % [row])
	if String(row.get("damage_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server":
		return _fail("boss practice preview must keep online authority on server %s" % [row])
	if bool(row.get("requires_server_confirmation", true)):
		return _fail("boss practice preview should not require server confirmation %s" % [row])
	if String(row.get("ui_control", "")) != "card" or String(row.get("ui_action", "")) != "start_boss_practice_preview" or String(row.get("preview_card_kind", "")) != "boss_spellbook_practice_preview" or String(row.get("overview_card_kind", "")) != "boss_practice_preview":
		return _fail("boss practice preview card contract mismatch %s" % [row])
	if String(row.get("local_practice_action", "")) != "start_boss_spellbook_run" or String(row.get("local_practice_target_screen", "")) != "practice":
		return _fail("boss practice preview local action contract mismatch %s" % [row])
	if String(row.get("local_hash_authority", "")) != "local_practice_verification_only" or String(row.get("online_result_authority", "")) != "server_settlement_required":
		return _fail("boss practice preview action authority mismatch %s" % [row])
	if String(row.get("render_slot", "")) != "mode_cards" or String(row.get("section", "")) != "boss_preview":
		return _fail("boss practice preview card placement mismatch %s" % [row])
	var metrics: Array = row.get("preview_card_metrics", [])
	var badges: Array = row.get("preview_card_authority_badges", [])
	if metrics.size() < 5 or not badges.has("local_practice_preview_only") or not badges.has("replay_local_practice_hash") or not badges.has("damage_server"):
		return _fail("boss practice preview card metrics/badges mismatch %s" % [row])
	if not String(row.get("preview_card_primary_metric", "")).contains("digest") or not String(row.get("preview_card_secondary_metric", "")).contains("headroom"):
		return _fail("boss practice preview card metric text mismatch %s" % [row])
	if int(row.get("preview_bundle_signature_digest", 0)) <= 0 or int(row.get("preview_phase_count", 0)) < 3:
		return _fail("boss practice preview missing deterministic digest %s" % [row])
	if String(row.get("performance_budget_status", "")) != "within_budget":
		return _fail("boss practice preview budget status invalid %s" % [row])
	return true

func _assert_boss_practice_preview_launch(row_id: String, mode_id: String) -> bool:
	var snapshot: Dictionary = await _open_snapshot("modes")
	var rows: Array[Dictionary] = main_node.call("_ui_screen_rows", 64)
	var preview_index := _row_index_by_id(rows, row_id)
	if preview_index < 0:
		return _fail("modes page missing boss practice preview row %s" % row_id)
	main_node.call("_ui_set_cursor", preview_index)
	await _settle_frames(2)
	var preview_action: Dictionary = main_node.call("_ui_accept_selected")
	await _settle_frames(2)
	if not bool(preview_action.get("ok", false)) \
			or String(preview_action.get("action", "")) != "start_boss_practice_preview" \
			or String(preview_action.get("screen", "")) != "practice" \
			or String(preview_action.get("mode_id", "")) != mode_id \
			or String(preview_action.get("spellbook_id", "")) != String(rows[preview_index].get("spellbook_id", "")) \
			or int(preview_action.get("preview_seed", 0)) != int(rows[preview_index].get("preview_seed", -1)) \
			or String(preview_action.get("preview_bundle_id", "")) != String(rows[preview_index].get("preview_bundle_id", "")) \
			or int(preview_action.get("preview_bundle_signature_digest", 0)) != int(rows[preview_index].get("preview_bundle_signature_digest", -1)) \
			or int(preview_action.get("preview_phase_count", 0)) != int(rows[preview_index].get("preview_phase_count", -1)) \
			or String(preview_action.get("preview_authority_scope", "")) != "local_practice_preview_only" \
			or String(preview_action.get("projection_scope", "")) != "local_practice_preview_only" \
			or String(preview_action.get("replay_verification_scope", "")) != "local_practice_hash" \
			or String(preview_action.get("performance_budget_status", "")) != "within_budget" \
			or String(preview_action.get("local_hash_authority", "")) != "local_practice_verification_only" \
			or String(preview_action.get("online_result_authority", "")) != "server_settlement_required" \
			or bool(preview_action.get("client_result_authoritative", true)):
		return _fail("%s practice preview action invalid %s" % [mode_id, preview_action])
	snapshot = main_node.call("_ui_overlay_snapshot")
	if String(snapshot.get("screen", "")) != "practice" or not bool(snapshot.get("layout_show_gameplay", false)) or bool(snapshot.get("layout_show_secondary_shell", true)):
		return _fail("%s practice preview should open unobstructed practice %s" % [mode_id, snapshot])
	return true

func _assert_boss_result_receipt_row(row: Dictionary, mode_id: String, expected_receipt_id: String, expected_hash: String) -> bool:
	if row.is_empty():
		return _fail("boss result row missing for %s" % mode_id)
	if String(row.get("mode_id", "")) != mode_id:
		return _fail("boss result mode mismatch %s row=%s" % [mode_id, row])
	if String(row.get("mode_category", "")) != "boss":
		return _fail("boss result row missing boss category %s" % [row])
	if bool(row.get("client_result_authoritative", true)):
		return _fail("boss result row must not be client authoritative %s" % [row])
	if String(row.get("damage_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server":
		return _fail("boss result row must keep server damage/reward/settlement authority %s" % [row])
	if String(row.get("receipt_status", "")) != "server_receipt_ready":
		return _fail("boss result row missing ready receipt status %s" % [row])
	if String(row.get("result_receipt_id", "")) != expected_receipt_id or String(row.get("result_hash", "")) != expected_hash:
		return _fail("boss result row receipt mismatch %s" % [row])
	if String(row.get("ui_control", "")) != "card" or String(row.get("receipt_card_kind", "")) != "boss_server_settlement_receipt" or String(row.get("overview_card_kind", "")) != "boss_result_receipt":
		return _fail("boss result receipt card metadata mismatch %s" % [row])
	if String(row.get("render_slot", "")) != "mode_cards" or not String(row.get("receipt_card_primary_metric", "")).contains(expected_receipt_id) or not String(row.get("receipt_card_secondary_metric", "")).contains(expected_hash):
		return _fail("boss result receipt card metrics mismatch %s" % [row])
	var metrics: Array = row.get("receipt_card_metrics", [])
	var badges: Array = row.get("receipt_card_authority_badges", [])
	if metrics.size() < 5 or not badges.has("server_settlement_receipt") or not badges.has("damage_server") or not badges.has("reward_server") or not badges.has("settlement_server"):
		return _fail("boss result receipt card badges/metrics mismatch %s" % [row])
	if typeof(row.get("receipt_card", {})) != TYPE_DICTIONARY:
		return _fail("boss result row missing nested receipt card %s" % [row])
	var card: Dictionary = row.get("receipt_card", {})
	if String(card.get("receipt_card_kind", "")) != "boss_server_settlement_receipt" or bool(card.get("client_result_authoritative", true)):
		return _fail("boss result nested receipt card authority mismatch %s" % [card])
	if String(card.get("result_receipt_id", "")) != expected_receipt_id or String(card.get("result_hash", "")) != expected_hash:
		return _fail("boss result nested receipt card receipt mismatch %s" % [card])
	if typeof(row.get("settlement_receipt_projection", {})) != TYPE_DICTIONARY:
		return _fail("boss result row missing receipt projection %s" % [row])
	var projection: Dictionary = row.get("settlement_receipt_projection", {})
	if String(projection.get("projection_scope", "")) != "server_settlement_receipt_projection":
		return _fail("boss result projection scope mismatch %s" % [projection])
	if bool(projection.get("client_result_authoritative", true)):
		return _fail("boss result projection must not be client authoritative %s" % [projection])
	var receipt: Dictionary = projection.get("settlement_receipt", {})
	if String(receipt.get("receipt_id", "")) != expected_receipt_id or String(receipt.get("result_hash", "")) != expected_hash:
		return _fail("boss result projection receipt mismatch %s" % [projection])
	return true

func _assert_boss_outcome_projection(row: Dictionary, mode_id: String, expected_kind: String, expected_status: String) -> bool:
	if row.is_empty():
		return _fail("boss outcome row missing for %s" % mode_id)
	if String(row.get("mode_id", "")) != mode_id or String(row.get("mode_category", "")) != "boss":
		return _fail("boss outcome identity mismatch %s" % [row])
	if String(row.get("outcome_kind", "")) != expected_kind or String(row.get("outcome_status", "")) != expected_status:
		return _fail("boss outcome status mismatch %s expected=%s/%s" % [row, expected_kind, expected_status])
	if String(row.get("damage_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server":
		return _fail("boss outcome must keep server authority %s" % [row])
	if bool(row.get("client_result_authoritative", true)):
		return _fail("boss outcome row must not be client authoritative %s" % [row])
	var projection: Dictionary = row.get("outcome_projection", {})
	if String(projection.get("outcome_kind", "")) != expected_kind or String(projection.get("outcome_status", "")) != expected_status:
		return _fail("boss nested outcome projection mismatch %s" % [projection])
	if bool(projection.get("client_result_authoritative", true)) or String(projection.get("settlement_authority", "")) != "server":
		return _fail("boss nested outcome projection authority mismatch %s" % [projection])
	if mode_id == "world_boss":
		if not bool(row.get("persistent_hp", false)) or String(row.get("announcement_status", "")) != "none" or bool(row.get("defeated", true)):
			return _fail("world boss persistent outcome mismatch %s" % [row])
		if not String(row.get("outcome_summary", "")).contains("persistent hp"):
			return _fail("world boss outcome summary missing persistent hp %s" % [row])
	else:
		if bool(row.get("persistent_hp", true)) or not bool(row.get("cleared", false)) or int(row.get("stars", 0)) < 1:
			return _fail("instance boss clear outcome mismatch %s" % [row])
		if not String(row.get("outcome_summary", "")).contains("stars"):
			return _fail("instance boss outcome summary missing stars %s" % [row])
	var receipt_card: Dictionary = row.get("receipt_card", {})
	if String(receipt_card.get("outcome_kind", "")) != expected_kind or String(receipt_card.get("outcome_status", "")) != expected_status:
		return _fail("boss receipt card outcome mismatch %s" % [receipt_card])
	return true

func _assert_boss_result_authority_summary(row: Dictionary, mode_id: String, expected_scope: String) -> bool:
	if row.is_empty():
		return _fail("boss result authority summary row missing for %s" % mode_id)
	var summary: Dictionary = row.get("result_authority_summary", {})
	if String(row.get("result_authority_summary_kind", "")) != "boss_result_authority_summary" or String(summary.get("summary_kind", "")) != "boss_result_authority_summary":
		return _fail("boss result authority summary kind mismatch %s" % [row])
	if not String(row.get("result_authority_text", "")).contains("server settlement owns") or not String(summary.get("authority_text", "")).contains(expected_scope):
		return _fail("boss result authority summary text mismatch %s" % [row])
	if String(summary.get("mode_result_scope", "")) != expected_scope or bool(summary.get("client_result_authoritative", true)):
		return _fail("boss result authority summary scope mismatch %s" % [summary])
	if String(summary.get("damage_authority", "")) != "server" or String(summary.get("reward_authority", "")) != "server" or String(summary.get("settlement_authority", "")) != "server":
		return _fail("boss result authority summary server authority mismatch %s" % [summary])
	var required_fields: Array = summary.get("server_required_fields", [])
	if required_fields.size() < 4 or not required_fields.has("damage") or not required_fields.has("reward_grants") or not required_fields.has("settlement") or not required_fields.has("result_receipt"):
		return _fail("boss result authority summary required fields mismatch %s" % [summary])
	var badges: Array = summary.get("authority_badges", [])
	if not badges.has("damage_server") or not badges.has("reward_server") or not badges.has("settlement_server"):
		return _fail("boss result authority summary badges mismatch %s" % [summary])
	return true

func _assert_boss_action_contract(row: Dictionary, mode_id: String, expected_entry_enabled: bool, expected_transfer_enabled: bool, expected_confirmation: String) -> bool:
	if row.is_empty():
		return _fail("boss action contract row missing for %s" % mode_id)
	if String(row.get("mode_id", "")) != mode_id or String(row.get("mode_category", "")) != "boss":
		return _fail("boss action contract identity mismatch %s" % [row])
	if String(row.get("availability_contract_kind", "")) != "boss_action_availability_projection":
		return _fail("boss action contract kind missing %s" % [row])
	if String(row.get("entry_request_scope", "")) != "intent_only" or String(row.get("transfer_request_scope", "")) != "intent_only":
		return _fail("boss action scopes must stay intent-only %s" % [row])
	if String(row.get("entry_contract_kind", "")) != "boss_entry_verification_contract" or int(row.get("entry_contract_version", 0)) != 1:
		return _fail("boss entry verification contract missing %s" % [row])
	var allowed_fields: Array = row.get("entry_intent_allowed_fields", [])
	for field in ["mode_id", "boss_instance_id", "party_ids", "selected_deck_id", "deck_snapshot_hash", "client_action_seq", "requested_at_tick"]:
		if not allowed_fields.has(field):
			return _fail("boss entry allowed intent field missing %s in %s" % [field, row])
	var forbidden_fields: Array = row.get("client_forbidden_entry_fields", [])
	for field in ["damage", "damage_this_match", "team_damage", "boss_hp_after", "reward_grants", "settlement_result", "settlement_receipt", "server_result_hash"]:
		if not forbidden_fields.has(field):
			return _fail("boss entry forbidden authority field missing %s in %s" % [field, row])
	var required_fields: Array = row.get("server_required_for", [])
	for field in ["entry_confirmation", "card_transfer_confirmation", "damage", "reward_grants", "settlement", "result_receipt"]:
		if not required_fields.has(field):
			return _fail("boss action server-required field missing %s in %s" % [field, row])
	if mode_id == "world_boss":
		for field in ["persistent_hp", "daily_attempts", "defeated_at", "world_announcement"]:
			if not required_fields.has(field):
				return _fail("world boss server-required field missing %s in %s" % [field, row])
		for field in ["season_id"]:
			if not allowed_fields.has(field):
				return _fail("world boss allowed intent field missing %s in %s" % [field, row])
		for field in ["current_hp", "daily_attempts_left", "defeated_at", "world_announcement"]:
			if not forbidden_fields.has(field):
				return _fail("world boss forbidden entry field missing %s in %s" % [field, row])
	else:
		for field in ["access_gate", "clear_status", "stars"]:
			if not required_fields.has(field):
				return _fail("instance boss server-required field missing %s in %s" % [field, row])
		for field in ["required_key_id", "entry_period"]:
			if not allowed_fields.has(field):
				return _fail("instance boss allowed intent field missing %s in %s" % [field, row])
		for field in ["entry_attempts_left", "entry_unlocked", "clear_status", "stars"]:
			if not forbidden_fields.has(field):
				return _fail("instance boss forbidden entry field missing %s in %s" % [field, row])
	if String(row.get("intent_authority", "")) != "client_request_only" or bool(row.get("client_result_authoritative", true)):
		return _fail("boss action authority flags invalid %s" % [row])
	var entry_confirmation: Dictionary = row.get("entry_confirmation_contract", {})
	if String(entry_confirmation.get("contract_kind", "")) != "boss_entry_confirmation_contract" \
			or String(entry_confirmation.get("entry_request_scope", "")) != "intent_only" \
			or String(entry_confirmation.get("server_confirmation_status", "")) != expected_confirmation \
			or String(entry_confirmation.get("intent_authority", "")) != "client_request_only" \
			or String(entry_confirmation.get("damage_authority", "")) != "server" \
			or String(entry_confirmation.get("reward_authority", "")) != "server" \
			or String(entry_confirmation.get("settlement_authority", "")) != "server" \
			or bool(entry_confirmation.get("client_result_authoritative", true)):
		return _fail("boss entry confirmation contract invalid %s" % [entry_confirmation])
	var confirmation_required: Array = entry_confirmation.get("server_required_for", [])
	for field in required_fields:
		if not confirmation_required.has(field):
			return _fail("boss entry confirmation missing server field %s in %s" % [field, entry_confirmation])
	var contract: Dictionary = row.get("ui_action_contract", {})
	if String(contract.get("contract_kind", "")) != "boss_ui_action_contract":
		return _fail("boss ui action contract missing %s" % [row])
	if bool(contract.get("entry_enabled", false)) != expected_entry_enabled or bool(contract.get("transfer_enabled", false)) != expected_transfer_enabled:
		return _fail("boss ui action enablement mismatch %s" % [contract])
	if String(contract.get("entry_request_scope", "")) != "intent_only" or String(contract.get("transfer_request_scope", "")) != "intent_only":
		return _fail("boss ui action contract scopes invalid %s" % [contract])
	if String(contract.get("server_confirmation_status", "")) != expected_confirmation or not bool(contract.get("server_authority_required", false)):
		return _fail("boss ui action server confirmation invalid %s expected=%s" % [contract, expected_confirmation])
	if String(contract.get("damage_authority", "")) != "server" or String(contract.get("reward_authority", "")) != "server" or String(contract.get("settlement_authority", "")) != "server":
		return _fail("boss ui action server authority invalid %s" % [contract])
	if bool(contract.get("client_result_authoritative", true)):
		return _fail("boss ui action contract became client authoritative %s" % [contract])
	var action_cards: Array = row.get("ui_action_cards", [])
	var saw_entry_card := false
	for raw_card in action_cards:
		if typeof(raw_card) != TYPE_DICTIONARY:
			continue
		var card: Dictionary = raw_card
		if String(card.get("action_card_kind", "")) != "boss_entry_intent":
			continue
		saw_entry_card = true
		if String(card.get("entry_contract_kind", "")) != "boss_entry_verification_contract" \
				or String(card.get("entry_request_scope", "")) != "intent_only" \
				or bool(card.get("client_result_authoritative", true)):
			return _fail("boss entry action card contract invalid %s" % [card])
		var card_forbidden: Array = card.get("client_forbidden_entry_fields", [])
		for field in forbidden_fields:
			if not card_forbidden.has(field):
				return _fail("boss entry action card missing forbidden field %s in %s" % [field, card])
	if not saw_entry_card:
		return _fail("boss entry action card missing %s" % [row])
	return true

func _assert_page_authority_contract(snapshot: Dictionary, label: String, expected_scope: String, expected_text: String) -> bool:
	var summary: Dictionary = snapshot.get("page_experience", {})
	if String(summary.get("authority_scope", "")) != expected_scope:
		return _fail("%s page authority scope mismatch %s" % [label, summary])
	if not String(summary.get("authority_text", "")).contains(expected_text):
		return _fail("%s page authority text missing %s in %s" % [label, expected_text, summary])
	if bool(summary.get("authority_client_result_authoritative", true)):
		return _fail("%s page authority must not be client-result authoritative %s" % [label, summary])
	if not String(snapshot.get("page_experience_text", "")).contains(expected_text):
		return _fail("%s page summary text missing authority contract %s" % [label, String(snapshot.get("page_experience_text", ""))])
	return true

func _assert_replay_filter_card_row(row: Dictionary, filter_id: String) -> bool:
	if row.is_empty():
		return _fail("replay filter card row missing for %s" % filter_id)
	if String(row.get("verification_filter", "")) != filter_id:
		return _fail("replay filter card id mismatch %s expected=%s" % [row, filter_id])
	if String(row.get("filter_card_kind", "")) != "replay_verification_filter" or String(row.get("overview_card_kind", "")) != "replay_verification_filter":
		return _fail("replay filter card metadata mismatch %s" % [row])
	if String(row.get("render_slot", "")) != "filter_tabs":
		return _fail("replay filter card render slot mismatch %s" % [row])
	if not String(row.get("filter_card_primary_metric", "")).contains("entries") or not String(row.get("filter_card_secondary_metric", "")).contains("active"):
		return _fail("replay filter card metric text mismatch %s" % [row])
	var metrics: Array = row.get("filter_card_metrics", [])
	var badges: Array = row.get("filter_card_authority_badges", [])
	if metrics.size() < 3 or not badges.has("local_practice_verification_only") or not badges.has("server_audit_required_for_online") or not badges.has("damage_server") or not badges.has("settlement_server"):
		return _fail("replay filter card metrics/badges mismatch %s" % [row])
	if String(row.get("ui_action", "")) != "set_replay_filter" or String(row.get("ui_control", "")) != "button":
		return _fail("replay filter card action/control mismatch %s" % [row])
	return _assert_replay_ui_authority_row(row)

func _checklist_has_ids(items: Array, ids: Array[String]) -> bool:
	var seen := {}
	for item in items:
		if typeof(item) == TYPE_DICTIONARY:
			seen[String((item as Dictionary).get("id", ""))] = true
	for id in ids:
		if not seen.has(id):
			return false
	return true

func _assert_replay_ui_authority_row(row: Dictionary) -> bool:
	if row.is_empty():
		return _fail("replay authority row missing")
	if String(row.get("local_hash_authority", "")) != "local_practice_verification_only":
		return _fail("replay UI row missing local hash authority %s" % [row])
	if String(row.get("damage_authority", "")) != "server" or String(row.get("settlement_authority", "")) != "server" or String(row.get("reward_authority", "")) != "server":
		return _fail("replay UI row missing server damage/settlement/reward authority %s" % [row])
	if bool(row.get("client_result_authoritative", true)):
		return _fail("replay UI row must not be client-result authoritative %s" % [row])
	return true

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
