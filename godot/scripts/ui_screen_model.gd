class_name UIScreenModel
extends RefCounted

const SCREENS: Array[String] = [
	"main_menu",
	"play",
	"certification",
	"practice",
	"match",
	"network_match",
	"modes",
	"collection",
	"deck",
	"chest",
	"activity",
	"community",
	"friends",
	"social",
	"promotions",
	"workshop",
	"replay",
	"player_settings",
	"input_settings",
	"audio_settings",
	"display_settings",
	"settings",
	"results",
]
const NAVIGATION_SCREENS: Array[String] = [
	"main_menu",
	"play",
	"certification",
	"practice",
	"match",
	"network_match",
	"modes",
	"collection",
	"deck",
	"chest",
	"activity",
	"community",
	"friends",
	"social",
	"promotions",
	"replay",
	"player_settings",
]

var current_screen := "main_menu"
var cursor := 0
var last_action := "none"
var screen_cursors := {}

var deck_builder: RefCounted = null
var replay_list_model: RefCounted = null
var accessibility_settings: RefCounted = null
var input_profile: RefCounted = null
var audio_settings: RefCounted = null
var localization: RefCounted = null
var display_settings: RefCounted = null
var theme_registry: RefCounted = null
var social_hub_model: RefCounted = null
var chest_system: RefCounted = null
var matchmaking_model: RefCounted = null
var network_match_model: RefCounted = null
var gensoulkyo_api_model: RefCounted = null
var gensoulkyo_http_client: Node = null
var game_mode_model: RefCounted = null
var results_service_model: RefCounted = null
var character_model: RefCounted = null
var bullet_visual_model: RefCounted = null
var stage_select_model: RefCounted = null
var pattern_lab_model: RefCounted = null
var boss_spellbook_model: RefCounted = null
var balance_simulation_model: RefCounted = null
var latency_test_model: RefCounted = null
var client_shell_model: RefCounted = null
var network_security_model: RefCounted = null
var protocol_descriptor_model: RefCounted = null
var battle_network_client_model: RefCounted = null
var player_settings_store: RefCounted = null
var client_menu_page_model: RefCounted = null

func configure(deps: Dictionary) -> void:
	deck_builder = deps.get("deck_builder", null)
	replay_list_model = deps.get("replay_list_model", null)
	accessibility_settings = deps.get("accessibility_settings", null)
	input_profile = deps.get("input_profile", null)
	audio_settings = deps.get("audio_settings", null)
	localization = deps.get("localization", null)
	display_settings = deps.get("display_settings", null)
	theme_registry = deps.get("theme_registry", null)
	social_hub_model = deps.get("social_hub_model", null)
	chest_system = deps.get("chest_system", null)
	matchmaking_model = deps.get("matchmaking_model", null)
	network_match_model = deps.get("network_match_model", null)
	gensoulkyo_api_model = deps.get("gensoulkyo_api_model", null)
	gensoulkyo_http_client = deps.get("gensoulkyo_http_client", null)
	game_mode_model = deps.get("game_mode_model", null)
	results_service_model = deps.get("results_service_model", null)
	character_model = deps.get("character_model", null)
	bullet_visual_model = deps.get("bullet_visual_model", null)
	stage_select_model = deps.get("stage_select_model", null)
	pattern_lab_model = deps.get("pattern_lab_model", null)
	boss_spellbook_model = deps.get("boss_spellbook_model", null)
	balance_simulation_model = deps.get("balance_simulation_model", null)
	latency_test_model = deps.get("latency_test_model", null)
	client_shell_model = deps.get("client_shell_model", null)
	network_security_model = deps.get("network_security_model", null)
	protocol_descriptor_model = deps.get("protocol_descriptor_model", null)
	battle_network_client_model = deps.get("battle_network_client_model", null)
	player_settings_store = deps.get("player_settings_store", null)
	client_menu_page_model = deps.get("client_menu_page_model", null)

func open(screen_id: String) -> bool:
	if not SCREENS.has(screen_id):
		last_action = "invalid"
		return false
	_remember_current_cursor()
	current_screen = screen_id
	cursor = _remembered_cursor_for(screen_id)
	last_action = "open"
	return true

func cycle(delta: int) -> String:
	var index := SCREENS.find(current_screen)
	if index < 0:
		index = 0
	index = wrapi(index + delta, 0, SCREENS.size())
	open(SCREENS[index])
	return current_screen

func select(delta: int) -> void:
	var rows := screen_rows()
	if rows.is_empty():
		cursor = 0
		last_action = "empty"
		return
	cursor = wrapi(cursor + delta, 0, rows.size())
	_remember_current_cursor()
	last_action = "select"

func set_cursor(index: int, action: String = "select") -> void:
	var rows := screen_rows(64)
	if rows.is_empty():
		cursor = 0
	else:
		cursor = clampi(index, 0, rows.size() - 1)
	_remember_current_cursor()
	last_action = action

func select_row_by_id(row_id: String, action: String = "select") -> bool:
	if row_id.is_empty():
		return false
	var rows := screen_rows(64)
	for i in range(rows.size()):
		var row: Dictionary = rows[i]
		if String(row.get("id", "")) == row_id:
			set_cursor(i, action)
			return true
	return false

func selected_row() -> Dictionary:
	var rows := screen_rows()
	if rows.is_empty():
		return {}
	return rows[clampi(cursor, 0, rows.size() - 1)]

func _remember_current_cursor() -> void:
	if current_screen.is_empty():
		return
	screen_cursors[current_screen] = int(cursor)

func _remembered_cursor_for(screen_id: String) -> int:
	var rows := screen_rows(64)
	if rows.is_empty():
		return 0
	return clampi(int(screen_cursors.get(screen_id, 0)), 0, rows.size() - 1)

func page_layout(screen_id: String = "") -> Dictionary:
	var source_screen := screen_id
	if source_screen.is_empty():
		source_screen = current_screen
	if client_menu_page_model != null and client_menu_page_model.has_method("page_spec"):
		var overrides := {}
		if source_screen == "network_match" and _network_match_is_running():
			overrides = {
				"kind": "battle_room",
				"density": "playfield",
				"show_secondary_shell": false,
				"show_gameplay": true,
				"advance_gameplay": false,
				"panel_anchor": "none",
				"panel_width_ratio": 0.0,
			}
		var spec_value: Variant = client_menu_page_model.page_spec(source_screen, overrides)
		if typeof(spec_value) == TYPE_DICTIONARY:
			return (spec_value as Dictionary).duplicate(true)
	var layout_kind := _layout_kind_for_screen(source_screen)
	return {
		"screen": source_screen,
		"kind": layout_kind,
		"category": _navigation_section_for_screen(source_screen),
		"parent": parent_screen_for(source_screen),
		"show_home": source_screen == "main_menu",
		"show_secondary_shell": source_screen != "main_menu",
		"show_gameplay": _layout_should_show_gameplay(source_screen),
		"advance_gameplay": _layout_should_advance_gameplay(source_screen),
		"panel_anchor": _layout_panel_anchor(layout_kind),
		"panel_width_ratio": _layout_panel_width_ratio(layout_kind),
		"overview_priority_ids": _layout_primary_rows(source_screen),
	}

func navigation_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for screen_id in _navigation_screens_for_current():
		rows.append({
			"id": "nav_%s" % screen_id,
			"screen": screen_id,
			"label_key": _screen_label_key(screen_id),
			"section": _navigation_section_for_screen(screen_id),
			"section_label_key": "ui.menu_section_%s" % _navigation_section_for_screen(screen_id),
			"ui_control": "nav",
			"ui_control_label_key": "ui.control_nav",
			"active": screen_id == current_screen,
			"enabled": true,
		})
	return rows

func navigation_family_for(screen_id: String = "") -> String:
	var source_screen := screen_id
	if source_screen.is_empty():
		source_screen = current_screen
	match source_screen:
		"play", "certification", "practice", "match", "network_match", "modes":
			return "play"
		"collection", "deck", "chest", "replay", "results":
			return "collection"
		"community", "activity", "friends", "social", "promotions", "workshop":
			return "community"
		"player_settings", "input_settings", "audio_settings", "display_settings", "settings":
			return "settings"
		_:
			return ""

func _navigation_screens_for_current() -> Array[String]:
	match navigation_family_for(current_screen):
		"play":
			return ["play", "certification", "practice", "match", "network_match", "modes"]
		"collection":
			return ["collection", "deck", "chest", "replay", "results"]
		"community":
			return ["community", "activity", "friends", "social", "promotions", "workshop"]
		"settings":
			return ["player_settings", "input_settings", "audio_settings", "display_settings", "settings"]
		_:
			return []

func parent_screen_for(screen_id: String = "") -> String:
	var source_screen := screen_id
	if source_screen.is_empty():
		source_screen = current_screen
	match source_screen:
		"main_menu":
			return ""
		"practice", "match", "network_match", "modes":
			return "play"
		"activity", "friends", "social", "promotions", "workshop":
			return "community"
		"input_settings", "audio_settings", "display_settings", "settings":
			return "player_settings"
		"deck", "chest", "replay", "results":
			return "collection"
		_:
			return "main_menu"

func shell_navigation_rows() -> Array[Dictionary]:
	if current_screen == "main_menu":
		return []
	var rows: Array[Dictionary] = []
	var parent_screen := parent_screen_for(current_screen)
	if not parent_screen.is_empty() and parent_screen != "main_menu" and parent_screen != current_screen:
		rows.append(_shell_navigation_row("nav_parent", parent_screen))
	rows.append(_shell_navigation_row("nav_home", "main_menu"))
	return rows

func _layout_kind_for_screen(screen_id: String) -> String:
	match screen_id:
		"main_menu":
			return "home_lobby"
		"play", "certification", "community", "player_settings":
			return "hub"
		"input_settings", "audio_settings", "display_settings", "settings":
			return "settings"
		"activity", "friends", "social", "promotions", "workshop":
			return "community"
		"match":
			return "matchmaking"
		"network_match":
			return "battle_room" if _network_match_is_running() else "network_room"
		"practice":
			return "playfield"
		"modes":
			return "mode_select"
		"collection", "deck", "chest", "replay", "results":
			return "collection"
		_:
			return "standard"

func _layout_should_show_gameplay(screen_id: String) -> bool:
	if screen_id == "practice":
		return true
	if screen_id == "network_match":
		return _network_match_is_running()
	return false

func _layout_should_advance_gameplay(screen_id: String) -> bool:
	return screen_id == "practice"

func _network_match_is_running() -> bool:
	if network_match_model == null:
		return false
	return String(network_match_model.get("authority_state")) == "running"

func _layout_panel_anchor(layout_kind: String) -> String:
	match layout_kind:
		"home_lobby", "hub", "settings", "community", "mode_select", "collection":
			return "full"
		"playfield", "battle_room":
			return "none"
		"matchmaking", "network_room":
			return "center"
		_:
			return "right"

func _layout_panel_width_ratio(layout_kind: String) -> float:
	match layout_kind:
		"home_lobby":
			return 1.0
		"hub", "settings", "community", "mode_select", "collection":
			return 0.72
		"matchmaking", "network_room":
			return 0.62
		"playfield", "battle_room":
			return 0.0
		_:
			return 0.56

func _layout_primary_rows(screen_id: String) -> Array[String]:
	match screen_id:
		"main_menu":
			return ["play", "collection", "community", "player_settings"]
		"play":
			return ["play_practice", "play_matchmaking", "play_pvp_duel", "play_world_boss", "play_world_boss_status", "play_room", "play_deck"]
		"certification":
			return ["cert_queue", "cert_practice", "cert_deck", "cert_rules"]
		"community":
			return ["community_events", "community_friends", "community_social", "community_promotions"]
		"player_settings":
			return ["settings_gamepad_curve", "settings_keybinds", "settings_volume", "settings_resolution", "settings_input", "settings_advanced"]
		"input_settings":
			return ["input_profile", "gamepad_curve", "gamepad_sensitivity", "binding_shoot"]
		"audio_settings":
			return ["audio_group_master", "audio_group_music", "audio_event_visual_cues", "audio_reset_all"]
		"display_settings":
			return ["display_resolution", "display_window_mode", "display_vsync", "display_fps_limit"]
		"match":
			return ["matchmaking_quick", "matchmaking_ranked", "matchmaking_pvp", "matchmaking_boss", "local_settlement_preview", "matchmaking_room", "queue_status"]
		"network_match":
			return ["gensoulkyo_login", "gensoulkyo_create_room", "gensoulkyo_server_ready", "battle_client_prepare", "battle_client_connect", "battle_client_input_header"]
		"activity":
			return ["activity_summary", "activity_social", "activity_promotions", "announce_architecture", "activity_task_daily_complete_match", "activity_claim_log"]
		"friends":
			return ["friends_summary", "friends_social", "friend_lumen", "friend_rin"]
		"social":
			return ["social_summary", "announce_architecture", "friend_lumen", "link_discord"]
		"promotions":
			return ["promotions_summary", "promotions_social", "link_steam", "link_creator_program"]
		"collection":
			return ["collection_deck", "collection_chest", "collection_replay", "collection_workshop"]
		"results":
			return ["result", "score_breakdown", "reward", "wallet", "tasks", "events"]
		_:
			return []

func screen_rows(limit: int = 12) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	match current_screen:
		"main_menu":
			rows = _main_menu_rows()
		"play":
			rows = _play_rows()
		"certification":
			rows = _certification_rows()
		"practice":
			rows = _practice_rows()
		"match":
			rows = _match_rows()
		"network_match":
			rows = _network_match_rows()
		"modes":
			rows = _mode_rows()
		"collection":
			rows = _collection_rows()
		"deck":
			rows = _deck_rows(limit)
		"chest":
			rows = _chest_rows()
		"activity":
			rows = _activity_rows()
		"community":
			rows = _community_rows()
		"friends":
			rows = _friends_rows()
		"social":
			rows = _social_rows()
		"promotions":
			rows = _promotion_rows()
		"workshop":
			rows = _workshop_rows()
		"replay":
			rows = _replay_rows(limit)
		"player_settings":
			rows = _player_settings_rows()
		"input_settings":
			rows = _input_settings_rows()
		"audio_settings":
			rows = _audio_settings_rows()
		"display_settings":
			rows = _display_settings_rows()
		"settings":
			rows = _settings_rows()
		"results":
			rows = _results_rows()
		_:
			rows = []
	return _sectioned_rows(current_screen, rows)

func _shell_navigation_row(row_id: String, target_screen: String) -> Dictionary:
	return {
		"id": row_id,
		"screen": target_screen,
		"label_key": _screen_label_key(target_screen),
		"section": "navigation",
		"section_label_key": "ui.menu_section_navigation",
		"ui_control": "nav",
		"ui_control_label_key": "ui.control_nav",
		"summary": "return to %s" % target_screen,
		"enabled": true,
	}

func _screen_label_key(screen_id: String) -> String:
	match screen_id:
		"main_menu":
			return "screen.main.home"
		"play":
			return "screen.main.play"
		"certification":
			return "screen.main.certification"
		"practice":
			return "screen.main.practice"
		"match":
			return "screen.main.start_match"
		"network_match":
			return "screen.main.network_match"
		"modes":
			return "screen.main.modes"
		"collection":
			return "screen.main.collection"
		"deck":
			return "screen.main.deck"
		"chest":
			return "screen.main.chest"
		"activity":
			return "screen.main.events"
		"community":
			return "screen.main.community"
		"friends":
			return "screen.main.friends"
		"social":
			return "screen.main.social"
		"promotions":
			return "screen.main.promotions"
		"workshop":
			return "screen.main.workshop"
		"replay":
			return "screen.main.replay"
		"player_settings":
			return "screen.main.player_settings"
		"input_settings":
			return "screen.settings.input_profile"
		"audio_settings":
			return "screen.settings.audio"
		"display_settings":
			return "screen.settings.display"
		"settings":
			return "screen.main.settings"
		"results":
			return "screen.results.result"
	return ""

func _navigation_section_for_screen(screen_id: String) -> String:
	match screen_id:
		"main_menu", "play", "certification", "practice", "match", "network_match", "modes":
			return "play"
		"collection", "deck", "chest", "replay":
			return "collection"
		"activity", "community", "friends", "social", "promotions", "workshop":
			return "community"
		"player_settings", "input_settings", "audio_settings", "display_settings", "settings":
			return "settings"
		_:
			return "system"

func screen_summary() -> String:
	var rows := screen_rows(5)
	var selected := selected_row()
	var selected_id := str(selected.get("id", selected.get("card_id", selected.get("replay_id", "-"))))
	return "%s row %d/%d %s %s" % [
		current_screen,
		0 if rows.is_empty() else cursor + 1,
		rows.size(),
		selected_id,
		last_action,
	]

func _main_menu_rows() -> Array[Dictionary]:
	if client_shell_model != null:
		return client_shell_model.main_menu_rows()
	return [
		{"id": "practice", "screen": "practice", "label_key": "ui.practice", "enabled": true},
		{"id": "certification", "screen": "certification", "label_key": "screen.main.certification", "enabled": true},
		{"id": "start_match", "screen": "match", "label_key": "screen.main.start_match", "enabled": true},
		{"id": "network_match", "screen": "network_match", "label_key": "screen.main.network_match", "enabled": true},
		{"id": "modes", "screen": "modes", "label_key": "screen.main.modes", "enabled": true},
		{"id": "deck", "screen": "deck", "label_key": "screen.main.deck", "enabled": true},
		{"id": "chest", "screen": "chest", "label_key": "screen.main.chest", "enabled": true},
		{"id": "events", "screen": "activity", "label_key": "screen.main.events", "enabled": true},
		{"id": "friends", "screen": "friends", "label_key": "screen.main.friends", "enabled": true},
		{"id": "social", "screen": "social", "label_key": "screen.main.social", "enabled": true},
		{"id": "promotions", "screen": "promotions", "label_key": "screen.main.promotions", "enabled": true},
		{"id": "workshop", "screen": "workshop", "label_key": "screen.main.workshop", "enabled": true},
		{"id": "replay", "screen": "replay", "label_key": "screen.main.replay", "enabled": true},
		{"id": "settings", "screen": "settings", "label_key": "screen.main.settings", "enabled": true},
	]

func _play_rows() -> Array[Dictionary]:
	if client_shell_model != null:
		return client_shell_model.play_rows()
	var rows := _play_mode_shortcut_rows()
	rows.append({"id": "play_deck", "screen": "deck", "label_key": "screen.main.deck", "enabled": true})
	return rows

func _collection_rows() -> Array[Dictionary]:
	if client_shell_model != null and client_shell_model.has_method("collection_rows"):
		return client_shell_model.collection_rows()
	return [
		{"id": "collection_summary", "label_key": "screen.main.collection", "summary": "deck, chest, replay, workshop", "enabled": true},
		{"id": "collection_deck", "screen": "deck", "label_key": "screen.main.deck", "enabled": true},
		{"id": "collection_chest", "screen": "chest", "label_key": "screen.main.chest", "enabled": true},
		{"id": "collection_replay", "screen": "replay", "label_key": "screen.main.replay", "enabled": true},
		{"id": "collection_workshop", "screen": "workshop", "label_key": "screen.main.workshop", "enabled": true},
	]

func _certification_rows() -> Array[Dictionary]:
	if client_shell_model != null and client_shell_model.has_method("certification_rows"):
		return client_shell_model.certification_rows()
	var rows: Array[Dictionary] = []
	rows.append({"id": "cert_summary", "label_key": "screen.cert.summary", "value": "local", "enabled": true})
	rows.append({"id": "cert_queue", "label_key": "screen.cert.queue", "value": "queue", "enabled": true, "ui_action": "start_certification_queue"})
	if game_mode_model != null:
		for row in game_mode_model.mode_rows():
			if String(row.get("id", "")).begins_with("cert_"):
				rows.append((row as Dictionary).duplicate(true))
	return rows

func _practice_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var stage_summary: String = stage_select_model.summary() if stage_select_model != null else "-"
	var character_summary: String = character_model.summary() if character_model != null else "-"
	rows.append({"id": "practice_summary", "label_key": "ui.practice", "value": "%s | %s" % [stage_summary, character_summary], "enabled": true})
	rows.append({"id": "practice_restart", "label_key": "ui.practice", "value": "restart", "enabled": true, "ui_action": "practice_restart"})
	rows.append({"id": "practice_seed_prev", "label_key": "ui.practice", "value": "seed -", "enabled": true, "ui_action": "practice_seed_prev"})
	rows.append({"id": "practice_seed_next", "label_key": "ui.practice", "value": "seed +", "enabled": true, "ui_action": "practice_seed_next"})
	rows.append({"id": "practice_power_down", "label_key": "ui.practice", "value": "power -", "enabled": true, "ui_action": "practice_power_down"})
	rows.append({"id": "practice_power_up", "label_key": "ui.practice", "value": "power +", "enabled": true, "ui_action": "practice_power_up"})
	rows.append({"id": "practice_bombs_cycle", "label_key": "ui.practice", "value": "bombs", "enabled": true, "ui_action": "practice_bombs_cycle"})
	rows.append({"id": "practice_stage_run", "label_key": "screen.settings.stage_select", "value": "stage run", "enabled": true, "ui_action": "toggle_stage_run"})
	if stage_select_model != null and stage_select_model.has_method("briefing_rows"):
		rows.append_array(stage_select_model.briefing_rows(pattern_lab_model))
	if stage_select_model != null and stage_select_model.has_method("practice_preset_rows"):
		rows.append_array(stage_select_model.practice_preset_rows(pattern_lab_model))
	if boss_spellbook_model != null:
		rows.append_array(_boss_spellbook_rows())
	if character_model != null:
		rows.append_array(character_model.rows())
	if stage_select_model != null:
		rows.append_array(stage_select_model.stage_rows())
		rows.append_array(stage_select_model.pattern_rows())
	if pattern_lab_model != null:
		rows.append({"id": "pattern_lab_summary", "label_key": "screen.settings.pattern_lab", "summary": pattern_lab_model.summary(), "enabled": true})
		rows.append_array(pattern_lab_model.active_rows())
		if pattern_lab_model.has_method("rows_for_spellbook"):
			rows.append_array(pattern_lab_model.rows_for_spellbook("original_boss_archive"))
	return rows

func _match_rows() -> Array[Dictionary]:
	if matchmaking_model != null:
		var rows := _play_mode_shortcut_rows()
		rows.append_array(_decorate_match_rows(matchmaking_model.match_rows()))
		return rows
	var active_deck := {}
	if deck_builder != null:
		active_deck = deck_builder.active_deck_snapshot()
	return [
		{"id": "active_deck", "label_key": "screen.match.active_deck", "value": str(active_deck.get("name", "-")), "enabled": true},
		{"id": "mode_certification", "label_key": "screen.mode.certification", "value": "local", "enabled": true},
		{"id": "network_quality", "label_key": "screen.match.network", "value": "offline", "enabled": true},
		{"id": "queue_wait", "label_key": "screen.match.wait", "value": "0", "enabled": false},
		{"id": "cancel", "label_key": "screen.match.cancel", "enabled": false},
	]

func _boss_spellbook_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if boss_spellbook_model == null:
		return rows
	if boss_spellbook_model.has_method("rows"):
		rows.append_array(boss_spellbook_model.rows())
	if boss_spellbook_model.has_method("timeline_rows"):
		rows.append_array(boss_spellbook_model.timeline_rows("original_boss_archive"))
	return rows

func _mode_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	rows.append({"id": "mode_summary", "label_key": "screen.mode.summary", "value": game_mode_model.summary() if game_mode_model != null else "-", "enabled": true})
	if matchmaking_model != null:
		rows.append_array(_decorate_mode_rows(matchmaking_model.mode_rows()))
	if game_mode_model != null:
		rows.append_array(_decorate_game_mode_state_rows(game_mode_model.mode_rows()))
		return rows
	if not rows.is_empty():
		return rows
	rows = [
		{"id": "certification", "label_key": "screen.mode.certification", "rank_points": 0, "enabled": true},
		{"id": "battle_royale", "label_key": "screen.mode.battle_royale", "round": 0, "enabled": false},
		{"id": "world_boss", "label_key": "screen.mode.world_boss", "daily_attempts": 0, "enabled": false},
		{"id": "instance_boss", "label_key": "screen.mode.instance_boss", "stars": 0, "enabled": false},
	]
	return rows

func _network_match_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if network_security_model != null and network_security_model.has_method("rows"):
		rows.append_array(network_security_model.rows())
	if protocol_descriptor_model != null and protocol_descriptor_model.has_method("rows"):
		rows.append_array(protocol_descriptor_model.rows())
	if battle_network_client_model != null and battle_network_client_model.has_method("rows"):
		rows.append_array(battle_network_client_model.rows())
	rows.append_array(_battle_client_action_rows())
	rows.append_array(_gensoulkyo_action_rows())
	if gensoulkyo_api_model != null:
		rows.append_array(gensoulkyo_api_model.status_rows())
	if gensoulkyo_http_client != null and gensoulkyo_http_client.has_method("status_rows"):
		rows.append_array(gensoulkyo_http_client.status_rows())
	if network_match_model != null:
		rows.append_array(_decorate_network_rows(network_match_model.status_rows()))
	return rows

func _battle_client_action_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if battle_network_client_model == null:
		return rows
	var handshake_state := String(battle_network_client_model.get("handshake_state"))
	var connection_state := String(battle_network_client_model.get("connection_state"))
	var transport_state := String(battle_network_client_model.get("transport_state"))
	var endpoint := String(battle_network_client_model.get("endpoint"))
	var next_seq := int(battle_network_client_model.get("next_seq"))
	rows.append({
		"id": "battle_client_prepare",
		"label": "Prepare Handshake",
		"value": "%s %s" % [handshake_state, endpoint if not endpoint.is_empty() else "no endpoint"],
		"summary": "stage X25519/HKDF transcript scaffold from signed ticket",
		"enabled": true,
		"ui_action": "battle_client_prepare",
	})
	rows.append({
		"id": "battle_client_connect",
		"label": "Connect Scaffold",
		"value": "%s %s" % [connection_state, transport_state],
		"summary": "mark KCP/UDP connection ready for packet-contract checks",
		"enabled": handshake_state != "waiting_ticket",
		"ui_action": "battle_client_connect",
	})
	rows.append({
		"id": "battle_client_input_header",
		"label": "Build Input Packet",
		"value": "next seq %d" % next_seq,
		"summary": "build protobuf input header with seq/ack/nonce; encrypted=false until AEAD lands",
		"enabled": true,
		"ui_action": "battle_client_input_header",
		"payload_type": "input",
	})
	return rows

func _gensoulkyo_action_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if gensoulkyo_http_client == null or gensoulkyo_api_model == null:
		return rows
	var session_ready := not String(gensoulkyo_api_model.get("session_token")).is_empty()
	var current_room := String(gensoulkyo_api_model.get("current_room_code"))
	var pending_room := String(gensoulkyo_api_model.get("pending_join_room_code"))
	var ticket_id := String(gensoulkyo_api_model.get("current_ticket_id"))
	var api_match_id := String(gensoulkyo_api_model.get("current_match_id"))
	var upgrade_card_id := _default_upgrade_card_id()
	var upgrade_preview := _upgrade_preview(upgrade_card_id)
	var match_id := api_match_id
	if match_id.is_empty() and network_match_model != null:
		match_id = String(network_match_model.get("match_id"))
	var authority_state := ""
	if network_match_model != null:
		authority_state = String(network_match_model.get("authority_state"))
	rows.append({"id": "gensoulkyo_login", "label_key": "screen.network.gensoulkyo", "value": "login/bootstrap", "enabled": true, "ui_action": "gensoulkyo_login"})
	rows.append({"id": "gensoulkyo_sync_inventory", "label_key": "screen.network.gensoulkyo", "value": "sync inventory", "enabled": session_ready, "ui_action": "gensoulkyo_sync_inventory"})
	rows.append({"id": "gensoulkyo_sync_decks", "label_key": "screen.network.gensoulkyo", "value": "sync decks", "enabled": session_ready, "ui_action": "gensoulkyo_sync_decks"})
	rows.append({"id": "gensoulkyo_save_deck", "label_key": "screen.network.gensoulkyo", "value": "save active deck", "enabled": session_ready, "ui_action": "gensoulkyo_save_deck"})
	rows.append({"id": "gensoulkyo_sync_chests", "label_key": "screen.network.gensoulkyo", "value": "sync chests", "enabled": session_ready, "ui_action": "gensoulkyo_sync_chests"})
	rows.append({"id": "gensoulkyo_open_chest", "label_key": "screen.network.gensoulkyo", "value": "open server chest", "enabled": session_ready and chest_system != null and chest_system.can_open("local_basic", 1), "ui_action": "gensoulkyo_open_chest", "pool_id": "local_basic", "open_count": 1})
	rows.append({"id": "gensoulkyo_upgrade_card", "label_key": "screen.network.gensoulkyo", "value": "upgrade %s lv %d cost %d" % [upgrade_card_id, int(upgrade_preview.get("level", 1)), int(upgrade_preview.get("cost", 0))], "enabled": session_ready and bool(upgrade_preview.get("can_upgrade", true)), "ui_action": "gensoulkyo_upgrade_card", "card_id": upgrade_card_id, "target_level": int(upgrade_preview.get("target_level", 0))})
	rows.append({"id": "gensoulkyo_create_room", "label_key": "screen.network.gensoulkyo", "value": "create room", "enabled": session_ready, "ui_action": "gensoulkyo_create_room"})
	rows.append({"id": "gensoulkyo_set_join_room", "label_key": "screen.network.gensoulkyo", "value": _room_entry_value(current_room, pending_room), "enabled": session_ready and (not current_room.is_empty() or not pending_room.is_empty()), "ui_action": "gensoulkyo_set_join_room"})
	rows.append({"id": "gensoulkyo_join_room", "label_key": "screen.network.gensoulkyo", "value": "join %s" % pending_room, "enabled": session_ready and not pending_room.is_empty(), "ui_action": "gensoulkyo_join_room"})
	rows.append({"id": "gensoulkyo_poll_ticket", "label_key": "screen.network.gensoulkyo", "value": ticket_id, "enabled": session_ready and not ticket_id.is_empty(), "ui_action": "gensoulkyo_poll_ticket"})
	rows.append({"id": "gensoulkyo_cancel_ticket", "label_key": "screen.match.cancel", "value": ticket_id, "enabled": session_ready and not ticket_id.is_empty() and api_match_id.is_empty(), "ui_action": "gensoulkyo_cancel_ticket"})
	rows.append({"id": "gensoulkyo_heartbeat", "label_key": "screen.network.gensoulkyo", "value": "%s %s" % [ticket_id, match_id], "enabled": session_ready, "ui_action": "gensoulkyo_heartbeat"})
	rows.append({"id": "gensoulkyo_server_ready", "label_key": "screen.network.gensoulkyo", "value": match_id, "enabled": session_ready and not match_id.is_empty(), "ui_action": "gensoulkyo_server_ready"})
	rows.append({"id": "gensoulkyo_poll_events", "label_key": "screen.network.gensoulkyo", "value": match_id, "enabled": session_ready and not match_id.is_empty(), "ui_action": "gensoulkyo_poll_events"})
	rows.append({"id": "gensoulkyo_rematch", "label_key": "screen.network.gensoulkyo", "value": match_id, "enabled": session_ready and authority_state == "ended" and not match_id.is_empty(), "ui_action": "gensoulkyo_rematch"})
	return rows

func _room_entry_value(current_room: String, pending_room: String) -> String:
	if not pending_room.is_empty():
		return "pending %s" % pending_room
	if not current_room.is_empty():
		return "use %s" % current_room
	return "room missing"

func _default_upgrade_card_id() -> String:
	if deck_builder != null:
		var active_ids: Array = deck_builder.active_card_ids() if deck_builder.has_method("active_card_ids") else []
		for card_id in active_ids:
			var id_text := String(card_id)
			if not id_text.is_empty():
				return id_text
	return "focus_lens"

func _upgrade_preview(card_id: String) -> Dictionary:
	if deck_builder != null and deck_builder.has_method("upgrade_preview"):
		var wallet := {}
		if matchmaking_model != null:
			var wallet_value: Variant = matchmaking_model.get("wallet")
			if typeof(wallet_value) == TYPE_DICTIONARY:
				wallet = wallet_value
		if typeof(wallet) == TYPE_DICTIONARY:
			return deck_builder.upgrade_preview(card_id, wallet)
		return deck_builder.upgrade_preview(card_id)
	return {"card_id": card_id, "level": 1, "target_level": 2, "cost": 0, "can_upgrade": true}

func _deck_rows(limit: int) -> Array[Dictionary]:
	if deck_builder == null:
		return []
	var rows: Array[Dictionary] = []
	rows.append({
		"id": "deck_stats",
		"label_key": "screen.deck.stats",
		"validation": deck_builder.validate_working_deck(),
		"save_status": str(deck_builder.last_save_status),
		"ui_action": "save_deck",
	})
	for card_row in deck_builder.card_rows("all", "all", max(0, limit - 1)):
		var editable_row: Dictionary = card_row.duplicate(true)
		editable_row["ui_action"] = "toggle_deck_card"
		rows.append(editable_row)
	return rows

func _chest_rows() -> Array[Dictionary]:
	if chest_system == null:
		return []
	var rows: Array[Dictionary] = []
	for pool in chest_system.pool_rows():
		var pool_row: Dictionary = pool.duplicate(true)
		pool_row["ui_action"] = "open_chest"
		pool_row["open_count"] = 1
		rows.append(pool_row)
	rows.append({"id": "probability", "label_key": "screen.chest.probability", "items": chest_system.probability_rows("local_basic")})
	rows.append({"id": "pity", "label_key": "screen.chest.pity", "value": chest_system.pity_summary("local_basic")})
	rows.append({"id": "wallet", "label_key": "screen.chest.wallet", "value": chest_system.wallet_summary()})
	rows.append({"id": "result", "label_key": "screen.chest.result", "items": chest_system.result_rows()})
	rows.append({"id": "audit", "label_key": "screen.chest.audit", "items": chest_system.audit_rows(3)})
	return rows

func _workshop_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if theme_registry == null:
		return rows
	for theme_id in theme_registry.discovered_theme_ids:
		rows.append({
			"id": str(theme_id),
			"label_key": "screen.workshop.theme",
			"active": str(theme_id) == str(theme_registry.active_theme_id),
			"replacement_scope": theme_registry.replacement_summary() if str(theme_id) == str(theme_registry.active_theme_id) else "",
			"ui_action": "activate_theme",
			"theme_id": str(theme_id),
		})
	if rows.is_empty():
		rows.append({"id": "base", "label_key": "screen.workshop.theme", "active": true, "replacement_scope": "text,sprites,audio,ui", "ui_action": "activate_theme", "theme_id": "base"})
	return rows

func _community_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if client_shell_model != null:
		rows.append_array(client_shell_model.community_rows())
	else:
		rows.append({"id": "community_events", "screen": "activity", "label_key": "screen.main.events", "enabled": true})
		rows.append({"id": "community_friends", "screen": "friends", "label_key": "screen.main.friends", "enabled": true})
		rows.append({"id": "community_social", "screen": "social", "label_key": "screen.main.social", "enabled": true})
		rows.append({"id": "community_promotions", "screen": "promotions", "label_key": "screen.main.promotions", "enabled": true})
		rows.append({"id": "community_workshop", "screen": "workshop", "label_key": "screen.main.workshop", "enabled": true})
	if social_hub_model != null:
		rows.append_array(social_hub_model.announcement_rows())
		rows.append_array(social_hub_model.link_rows())
	return rows

func _activity_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var activity_model_rows: Array[Dictionary] = []
	if results_service_model != null:
		activity_model_rows = _decorate_activity_rows(results_service_model.activity_rows())
		for i in range(activity_model_rows.size()):
			if String(activity_model_rows[i].get("id", "")) == "activity_summary":
				var summary_row: Dictionary = activity_model_rows[i].duplicate(true)
				summary_row["summary"] = "notices, tasks, events, leaderboards, claims"
				rows.append(summary_row)
				activity_model_rows.remove_at(i)
				break
	if not _rows_contain_id(rows, "activity_summary"):
		rows.append({"id": "activity_summary", "label_key": "screen.activity.summary", "value": "local activity", "summary": "notices, tasks, events, leaderboards, claims", "enabled": true})
	rows.append({"id": "activity_social", "screen": "social", "label_key": "screen.main.social", "summary": "announcements, friends, social media", "enabled": true})
	rows.append({"id": "activity_promotions", "screen": "promotions", "label_key": "screen.main.promotions", "summary": "campaign links and creator codes", "enabled": true})
	if social_hub_model != null:
		rows.append_array(social_hub_model.announcement_rows())
	rows.append_array(activity_model_rows)
	return rows

func _rows_contain_id(rows: Array[Dictionary], row_id: String) -> bool:
	for row in rows:
		if String(row.get("id", "")) == row_id:
			return true
	return false

func _social_rows() -> Array[Dictionary]:
	if social_hub_model == null:
		return []
	return social_hub_model.rows()

func _friends_rows() -> Array[Dictionary]:
	if social_hub_model == null:
		return []
	if social_hub_model.has_method("friend_page_rows"):
		return social_hub_model.friend_page_rows()
	var rows: Array[Dictionary] = []
	rows.append_array(social_hub_model.friend_rows())
	return rows

func _promotion_rows() -> Array[Dictionary]:
	if social_hub_model == null:
		return []
	if social_hub_model.has_method("promotion_page_rows"):
		return social_hub_model.promotion_page_rows()
	if social_hub_model.has_method("promotion_rows"):
		return social_hub_model.promotion_rows()
	return social_hub_model.link_rows()

func _replay_rows(limit: int) -> Array[Dictionary]:
	if replay_list_model == null:
		return []
	replay_list_model.refresh()
	var rows: Array[Dictionary] = []
	if replay_list_model.has_method("verification_summary_row"):
		rows.append(replay_list_model.verification_summary_row())
	if replay_list_model.has_method("verification_filter_rows"):
		rows.append_array(replay_list_model.verification_filter_rows())
	for row in replay_list_model.row_models(limit):
		var replay_row: Dictionary = row.duplicate(true)
		if not String(replay_row.get("replay_id", "")).is_empty():
			replay_row["ui_action"] = "load_replay"
		replay_row["ui_control"] = "replay"
		replay_row["value"] = "%s hash %s" % [
			String(replay_row.get("verification_status", "unchecked")),
			String(replay_row.get("final_result_hash", "0")),
		]
		replay_row["summary"] = "%s | %s tick %d %s" % [
			String(replay_row.get("verification_summary", "")),
			String(replay_row.get("replay_authority_scope", "local_practice_record")),
			int(replay_row.get("final_tick", 0)),
			String(replay_row.get("metadata_status", "unchecked")),
		]
		rows.append(replay_row)
	return rows

func _player_settings_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if client_shell_model != null:
		rows.append_array(client_shell_model.player_settings_rows())
	else:
		rows.append({"id": "settings_input", "screen": "input_settings", "label_key": "screen.settings.input_profile", "enabled": true})
		rows.append({"id": "settings_audio", "screen": "audio_settings", "label_key": "screen.settings.audio", "enabled": true})
		rows.append({"id": "settings_display", "screen": "display_settings", "label_key": "screen.settings.display", "enabled": true})
	rows.append_array(_language_settings_rows())
	rows.append_array(_settings_management_rows())
	rows.append_array(_accessibility_settings_rows())
	return rows

func _language_settings_rows() -> Array[Dictionary]:
	if localization == null:
		return []
	return [
		{
			"id": "settings_language",
			"label_key": "screen.settings.language",
			"value": localization.locale_label() if localization.has_method("locale_label") else String(localization.get("locale")),
			"summary": "界面语言 / UI language",
			"ui_action": "cycle_language",
			"enabled": true,
			"ui_control": "select",
			"control_options": localization.locale_options() if localization.has_method("locale_options") else [String(localization.get("locale"))],
			"control_option_index": localization.locale_index() if localization.has_method("locale_index") else 0,
		},
	]

func _settings_management_rows() -> Array[Dictionary]:
	var status := "not_loaded"
	if player_settings_store != null:
		status = String(player_settings_store.get("last_status"))
	return [
		{"id": "settings_save_now", "label_key": "screen.settings.save", "value": status, "ui_action": "save_player_settings", "enabled": true},
		{"id": "settings_reload", "label_key": "screen.settings.reload", "ui_action": "load_player_settings", "enabled": true},
		{"id": "settings_restore_defaults", "label_key": "screen.settings.restore_defaults", "ui_action": "restore_default_player_settings", "enabled": true},
	]

func _input_settings_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if input_profile != null:
		rows.append({"id": "input_profile", "label_key": "screen.settings.input_profile", "summary": input_profile.summary(), "ui_action": "cycle_input_profile", "enabled": true})
		rows.append_array(input_profile.gamepad_rows())
		rows.append_array(input_profile.binding_rows())
	return rows

func _audio_settings_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if audio_settings != null:
		rows.append({"id": "audio", "label_key": "screen.settings.audio", "summary": audio_settings.summary(), "ui_action": "toggle_event_visual_cues", "enabled": true})
		rows.append_array(_audio_action_rows())
	return rows

func _display_settings_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if display_settings != null:
		rows.append({"id": "display", "label_key": "screen.settings.display", "summary": display_settings.summary(), "enabled": true})
		rows.append_array(display_settings.rows())
		rows.append({"id": "display_reset_all", "label_key": "screen.settings.reset_display", "summary": "resolution, window, vsync, fps, shake, background", "ui_action": "reset_display_settings", "enabled": true})
	if accessibility_settings != null:
		rows.append_array(_accessibility_settings_rows())
	return rows

func _settings_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if input_profile != null:
		rows.append({"id": "input_profile", "label_key": "screen.settings.input_profile", "summary": input_profile.summary(), "ui_action": "cycle_input_profile"})
		rows.append_array(input_profile.gamepad_rows())
		rows.append_array(input_profile.binding_rows())
	if display_settings != null:
		rows.append({"id": "display", "label_key": "screen.settings.display", "summary": display_settings.summary(), "enabled": true})
		rows.append_array(display_settings.rows())
	if character_model != null:
		rows.append({"id": "character", "label_key": "screen.settings.character", "summary": character_model.summary(), "ui_action": "cycle_character"})
		rows.append_array(character_model.rows())
	if stage_select_model != null:
		rows.append({"id": "stage_select", "label_key": "screen.settings.stage_select", "summary": stage_select_model.summary(), "ui_action": "cycle_stage"})
		if stage_select_model.has_method("briefing_rows"):
			rows.append_array(stage_select_model.briefing_rows(pattern_lab_model))
		if stage_select_model.has_method("practice_preset_rows"):
			rows.append_array(stage_select_model.practice_preset_rows(pattern_lab_model))
		rows.append_array(stage_select_model.stage_rows())
		rows.append_array(stage_select_model.pattern_rows())
	if boss_spellbook_model != null:
		rows.append_array(_boss_spellbook_rows())
	if pattern_lab_model != null:
		rows.append({"id": "pattern_lab", "label_key": "screen.settings.pattern_lab", "summary": pattern_lab_model.summary()})
		rows.append_array(pattern_lab_model.active_rows())
	if bullet_visual_model != null:
		rows.append_array(bullet_visual_model.rows())
	if balance_simulation_model != null:
		rows.append_array(_decorate_balance_rows(balance_simulation_model.rows()))
	if latency_test_model != null:
		rows.append_array(_decorate_latency_rows(latency_test_model.rows()))
	if accessibility_settings != null:
		rows.append_array(_accessibility_settings_rows())
	if audio_settings != null:
		rows.append({"id": "audio", "label_key": "screen.settings.audio", "summary": audio_settings.summary(), "ui_action": "toggle_event_visual_cues"})
		rows.append_array(_audio_action_rows())
	return rows

func _play_mode_shortcut_rows() -> Array[Dictionary]:
	return [
		{"id": "play_practice", "screen": "practice", "label_key": "screen.play.practice", "value": "local stage drills", "enabled": true},
		{"id": "play_certification", "screen": "modes", "label_key": "screen.mode.certification", "value": "rank qualification", "enabled": true, "ui_action": "select_mode", "mode_id": "certification"},
		{"id": "play_matchmaking", "label_key": "screen.play.matchmaking", "value": "queue selected mode", "enabled": true, "ui_action": "advance_queue"},
		{"id": "play_room", "screen": "network_match", "label_key": "screen.play.room", "value": "room code / server actions", "enabled": true},
	]

func _results_rows() -> Array[Dictionary]:
	if results_service_model != null:
		return _decorate_result_rows(results_service_model.result_rows())
	return [
		{"id": "result", "label_key": "screen.results.result", "value": "practice"},
		{"id": "score_breakdown", "label_key": "screen.results.score", "value": 0},
		{"id": "reward", "label_key": "screen.results.reward", "items": []},
		{"id": "save_replay", "label_key": "screen.results.save_replay", "enabled": true, "ui_action": "save_replay"},
		{"id": "retry", "label_key": "screen.results.retry", "enabled": true, "ui_action": "restart_practice"},
	]

func _decorate_match_rows(source_rows: Array[Dictionary]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for i in range(source_rows.size()):
		var row: Dictionary = source_rows[i].duplicate(true)
		var row_id: String = String(row.get("id", ""))
		match row_id:
			"active_deck":
				row["screen"] = "deck"
			"selected_mode":
				row["screen"] = "modes"
			"network_quality":
				row["ui_action"] = "cycle_network_quality"
			"queue_status":
				row["ui_action"] = "advance_queue"
			"ready":
				row["ui_action"] = "ready_match"
			"cancel":
				row["ui_action"] = "cancel_queue"
			"reconnect_status":
				row["ui_action"] = "finish_reconnect"
			"matchmaking_boss":
				row = _decorate_boss_matchmaking_card(row)
		rows.append(row)
	rows.append_array(_match_boss_status_rows())
	rows.append(_local_settlement_preview_row())
	return rows

func _match_boss_status_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	if game_mode_model == null or not game_mode_model.has_method("boss_local_status_row"):
		return rows
	rows.append(game_mode_model.boss_local_status_row("match_world_boss_status", "world_boss"))
	rows.append(game_mode_model.boss_local_status_row("match_instance_boss_status", "instance_boss"))
	return rows

func _decorate_boss_matchmaking_card(row: Dictionary) -> Dictionary:
	if game_mode_model == null or not game_mode_model.has_method("boss_local_status_row"):
		return row
	var boss_status: Dictionary = game_mode_model.boss_local_status_row("match_world_boss_status_preview", "world_boss")
	var status_text := String(boss_status.get("summary", boss_status.get("value", "")))
	if not status_text.is_empty():
		row["summary"] = "%s | %s" % [String(row.get("summary", "")), status_text]
		row["value"] = "%s | %s" % [String(row.get("value", "")), String(boss_status.get("value", ""))]
	row["requires_server_confirmation"] = true
	row["settlement_authority"] = "server"
	row["client_result_authoritative"] = false
	return row

func _local_settlement_preview_row() -> Dictionary:
	var selected_mode := "certification"
	var queue_status := "idle"
	if matchmaking_model != null:
		selected_mode = String(matchmaking_model.get("selected_mode_id"))
		queue_status = String(matchmaking_model.get("queue_status"))
	return {
		"id": "local_settlement_preview",
		"label_key": "screen.match.local_settlement",
		"value": "%s %s" % [selected_mode, queue_status],
		"enabled": results_service_model != null,
		"ui_action": "local_settle_match",
	}

func _decorate_mode_rows(source_rows: Array[Dictionary]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for i in range(source_rows.size()):
		var row: Dictionary = source_rows[i].duplicate(true)
		row["ui_action"] = "select_mode"
		row["mode_id"] = String(row.get("id", ""))
		rows.append(row)
	return rows

func _decorate_game_mode_state_rows(source_rows: Array[Dictionary]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for i in range(source_rows.size()):
		var row: Dictionary = source_rows[i].duplicate(true)
		var row_id := String(row.get("id", ""))
		match row_id:
			"br_candidates":
				var candidates: Array[String] = _string_array(row.get("items", []))
				var next_card_id := _first_unselected_candidate(candidates, String(row.get("selected_card_id", "")))
				row["ui_action"] = "select_battle_royale_candidate"
				row["candidate_card_id"] = next_card_id
				row["enabled"] = not next_card_id.is_empty()
			"world_boss_transfer", "instance_boss_transfer":
				var transfer_request: Dictionary = _default_boss_transfer_request(row)
				row["ui_action"] = "request_boss_transfer"
				row["transfer_request"] = transfer_request
				row["enabled"] = bool(transfer_request.get("valid", false))
			"world_boss_entry", "instance_boss_entry":
				row["ui_action"] = "request_boss_entry"
				row["enabled"] = bool(row.get("entry_valid", false))
		rows.append(row)
	return rows

func _decorate_network_rows(source_rows: Array[Dictionary]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for i in range(source_rows.size()):
		var row: Dictionary = source_rows[i].duplicate(true)
		var row_id: String = String(row.get("id", ""))
		match row_id:
			"authority":
				row["ui_action"] = "network_ready"
			"input_delay":
				row["ui_action"] = "cycle_network_quality"
			"full_snapshot":
				row["ui_action"] = "request_full_snapshot"
		rows.append(row)
	return rows

func _decorate_balance_rows(source_rows: Array[Dictionary]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for i in range(source_rows.size()):
		var row: Dictionary = source_rows[i].duplicate(true)
		if String(row.get("id", "")) == "balance_summary":
			row["ui_action"] = "run_balance_simulation"
		rows.append(row)
	return rows

func _decorate_latency_rows(source_rows: Array[Dictionary]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for i in range(source_rows.size()):
		var row: Dictionary = source_rows[i].duplicate(true)
		if String(row.get("id", "")) == "latency_summary":
			row["ui_action"] = "run_latency_tests"
		rows.append(row)
	return rows

func _decorate_result_rows(source_rows: Array[Dictionary]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for i in range(source_rows.size()):
		var row: Dictionary = source_rows[i].duplicate(true)
		match String(row.get("id", "")):
			"save_replay":
				row["ui_action"] = "save_replay"
			"retry":
				row["ui_action"] = "restart_practice"
		rows.append(row)
	return rows

func _decorate_activity_rows(source_rows: Array[Dictionary]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for i in range(source_rows.size()):
		var row: Dictionary = source_rows[i].duplicate(true)
		if row.has("activity_kind") and row.has("activity_id"):
			row["ui_action"] = "request_activity_claim"
		rows.append(row)
	return rows

func _first_unselected_candidate(candidates: Array[String], selected_card_id: String) -> String:
	for card_id in candidates:
		if card_id != selected_card_id:
			return card_id
	return ""

func _default_boss_transfer_request(row: Dictionary) -> Dictionary:
	var party_ids: Array[String] = _string_array(row.get("party_ids", []))
	if party_ids.size() < 2:
		return {"valid": false, "reason": "party_missing"}
	var card_id := _default_transfer_card_id(_string_array(row.get("transferred_card_ids", [])))
	if card_id.is_empty():
		return {"valid": false, "reason": "card_missing"}
	return {
		"valid": true,
		"mode_id": String(row.get("mode_id", "")),
		"from_player_id": party_ids[0],
		"to_player_id": party_ids[1],
		"card_id": card_id,
	}

func _default_transfer_card_id(transferred_card_ids: Array[String]) -> String:
	var card_ids: Array[String] = []
	if deck_builder != null:
		var active_deck: Dictionary = deck_builder.active_deck_snapshot()
		card_ids = _string_array(active_deck.get("card_ids", []))
	for card_id in card_ids:
		if not transferred_card_ids.has(card_id):
			return card_id
	return ""

func _string_array(source: Variant) -> Array[String]:
	var values: Array[String] = []
	if typeof(source) != TYPE_ARRAY:
		return values
	for item in source as Array:
		values.append(str(item))
	return values

func _accessibility_action_rows() -> Array[Dictionary]:
	if accessibility_settings == null:
		return []
	return [
		{"id": "access_low_flash", "label_key": "screen.settings.accessibility", "value": "on" if bool(accessibility_settings.low_flash) else "off", "ui_action": "toggle_low_flash", "enabled": true},
		{"id": "access_background", "label_key": "screen.settings.accessibility", "value": "simple" if bool(accessibility_settings.simplified_background) else "normal", "ui_action": "toggle_simplified_background", "enabled": true},
		{"id": "access_hitbox", "label_key": "screen.settings.accessibility", "value": "always" if bool(accessibility_settings.always_show_hitbox) else "focus", "ui_action": "toggle_always_show_hitbox", "enabled": true},
		{"id": "access_graze_ring", "label_key": "screen.settings.accessibility", "value": "on" if bool(accessibility_settings.practice_graze_ring) else "off", "ui_action": "toggle_practice_graze_ring", "enabled": true},
		{"id": "access_palette", "label_key": "screen.settings.accessibility", "value": accessibility_settings.palette_name(), "ui_action": "cycle_palette", "enabled": true},
		{"id": "access_bullet_alpha", "label_key": "screen.settings.accessibility", "value": "%.2f" % float(accessibility_settings.bullet_alpha), "ui_action": "adjust_bullet_alpha", "delta": 0.05, "enabled": true},
		{"id": "access_reset_all", "label_key": "screen.settings.reset_accessibility", "summary": "flash, background, hitbox, graze ring, palette, alpha", "ui_action": "reset_accessibility_settings", "enabled": true},
	]

func _accessibility_settings_rows() -> Array[Dictionary]:
	if accessibility_settings == null:
		return []
	var rows: Array[Dictionary] = [
		{"id": "accessibility", "label_key": "screen.settings.accessibility", "summary": accessibility_settings.summary(), "ui_action": "toggle_low_flash", "enabled": true},
	]
	rows.append_array(_accessibility_action_rows())
	return rows

func _audio_action_rows() -> Array[Dictionary]:
	if audio_settings == null:
		return []
	var rows: Array[Dictionary] = [
		{
			"id": "audio_voice_locale",
			"label_key": "screen.settings.voice_language",
			"value": audio_settings.voice_locale_label() if audio_settings.has_method("voice_locale_label") else String(audio_settings.get("voice_locale")),
			"summary": "角色语音 / voice language",
			"ui_action": "cycle_voice_locale",
			"enabled": true,
			"ui_control": "select",
			"control_options": audio_settings.voice_locale_options() if audio_settings.has_method("voice_locale_options") else [String(audio_settings.get("voice_locale"))],
			"control_option_index": audio_settings.voice_locale_index() if audio_settings.has_method("voice_locale_index") else 0,
		},
		{"id": "audio_event_visual_cues", "label_key": "screen.settings.audio", "value": "on" if bool(audio_settings.event_visual_cues) else "off", "ui_action": "toggle_event_visual_cues", "enabled": true},
		{"id": "audio_graze_audio", "label_key": "screen.settings.audio", "value": "on" if bool(audio_settings.high_frequency_graze_audio) else "off", "ui_action": "toggle_high_frequency_graze_audio", "enabled": true},
	]
	for group_row in audio_settings.group_rows():
		var audio_row: Dictionary = group_row.duplicate(true)
		audio_row["id"] = "audio_group_%s" % str(audio_row.get("group", ""))
		audio_row["label_key"] = "screen.settings.audio"
		audio_row["ui_action"] = "adjust_audio_volume"
		audio_row["delta"] = 0.1
		rows.append(audio_row)
	rows.append({"id": "audio_reset_all", "label_key": "screen.settings.reset_audio", "summary": "volumes and cue toggles", "ui_action": "reset_audio_settings", "enabled": true})
	return rows

func _sectioned_rows(screen_id: String, source_rows: Array[Dictionary]) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for source_row in source_rows:
		var row: Dictionary = source_row.duplicate(true)
		if not row.has("section"):
			var section := _section_for_row(screen_id, row)
			if not section.is_empty():
				row["section"] = section
		if row.has("section") and not row.has("section_label_key"):
			row["section_label_key"] = "ui.menu_section_%s" % String(row.get("section", ""))
		if not row.has("ui_control"):
			var control := _control_for_row(screen_id, row)
			if not control.is_empty():
				row["ui_control"] = control
		if row.has("ui_control") and not row.has("ui_control_label_key"):
			row["ui_control_label_key"] = "ui.control_%s" % String(row.get("ui_control", ""))
		_decorate_control_metadata(row)
		rows.append(row)
	return rows

func _section_for_row(screen_id: String, row: Dictionary) -> String:
	var row_id := String(row.get("id", ""))
	var target_screen := String(row.get("screen", ""))
	var action := String(row.get("ui_action", ""))
	match screen_id:
		"main_menu":
			if ["play", "certification"].has(row_id):
				return "play"
			if ["deck", "replay"].has(row_id):
				return "collection"
			if row_id == "community":
				return "community"
			if row_id == "player_settings":
				return "settings"
		"play":
			if row_id == "play_summary":
				return "overview"
			if row_id == "play_deck":
				return "loadout"
			if ["play_practice", "play_certification_hub"].has(row_id):
				return "local_play"
			if ["play_matchmaking", "play_room", "play_queue_selected"].has(row_id):
				return "online_play"
			if row_id == "play_pvp_duel" or row_id == "play_battle_royale":
				return "pvp"
			if row_id == "play_world_boss" or row_id == "play_instance_boss" or row_id == "play_world_boss_status" or row_id == "play_instance_boss_status":
				return "boss"
			if row_id.begins_with("play_"):
				return "modes"
		"certification":
			if row_id == "cert_summary":
				return "overview"
			if row_id == "cert_queue":
				return "queue"
			if row_id == "cert_practice":
				return "practice"
			if row_id == "cert_deck":
				return "loadout"
			if row_id == "cert_rules":
				return "rules"
			if row_id.begins_with("cert_"):
				return "progress"
		"practice":
			if row_id.begins_with("practice_"):
				return "practice"
			if row_id.begins_with("stage_practice") or row_id in ["stage_briefing", "stage_math_route", "stage_recommended_character"]:
				return "stage"
			if row_id.begins_with("character_"):
				return "character"
			if row_id.begins_with("stage_"):
				return "stage"
			if row_id.begins_with("pattern_lab") or row.has("pattern_id"):
				return "analysis"
		"match":
			if row_id == "active_deck":
				return "loadout"
			if row_id == "local_settlement_preview":
				return "results"
			if row_id == "match_world_boss_status" or row_id == "match_instance_boss_status":
				return "boss"
			if row_id.begins_with("matchmaking_"):
				return "matchmaking"
			if row_id == "selected_mode" or target_screen == "modes" or action == "select_mode" or row_id.begins_with("mode_"):
				return "modes"
			return "matchmaking"
		"network_match":
			if row_id == "netsec_summary":
				return "overview"
			if row_id.begins_with("gensoulkyo") or row_id in ["session", "server", "config", "profile"]:
				return "business_network"
			return "battle_network"
		"modes":
			if row_id == "mode_summary":
				return "overview"
			if row_id.begins_with("cert_"):
				return "progress"
			return "modes"
		"deck":
			return "cards" if row.has("card_id") else "overview"
		"collection":
			if row_id == "collection_summary":
				return "overview"
			return "collection"
		"chest":
			return "chest"
		"activity":
			if row_id.begins_with("announce_"):
				return "announcements"
			if row_id == "activity_summary":
				return "overview"
			if row_id == "activity_social" or row_id == "activity_promotions":
				return "community"
			return "activity"
		"community":
			if row_id == "community_summary":
				return "overview"
			if row_id.begins_with("announce_"):
				return "announcements"
			if row_id.begins_with("link_"):
				return "links"
			return "community"
		"friends":
			return "overview" if row_id == "friends_summary" else "friends"
		"social":
			if row_id == "social_summary":
				return "overview"
			if row_id.begins_with("announce_"):
				return "announcements"
			if row_id.begins_with("friend_"):
				return "friends"
			if row_id.begins_with("link_"):
				return "links"
		"promotions":
			return "overview" if row_id == "promotions_summary" else "promotions"
		"workshop":
			return "workshop"
		"replay":
			if row_id == "replay_verification_summary" or row_id.begins_with("replay_filter_"):
				return "overview"
			return "replay"
		"player_settings":
			if row_id == "settings_summary":
				return "overview"
			if row_id == "settings_language":
				return "language"
			if row_id == "settings_input" or row_id == "settings_gamepad_curve" or row_id == "settings_keybinds":
				return "input"
			if row_id == "settings_audio" or row_id == "settings_volume":
				return "audio"
			if row_id == "settings_display" or row_id == "settings_resolution":
				return "display"
			if row_id == "settings_advanced":
				return "advanced"
			if row_id.begins_with("settings_storage") or row_id.begins_with("settings_save") or row_id.begins_with("settings_reload") or row_id.begins_with("settings_restore"):
				return "storage"
			if row_id.begins_with("access_") or row_id == "accessibility":
				return "accessibility"
		"input_settings":
			if row_id == "input_profile":
				return "input"
			if row_id.begins_with("gamepad_"):
				return "gamepad"
			if row_id.begins_with("binding_"):
				return "keybinds"
		"audio_settings":
			if row_id == "audio":
				return "overview"
			if row_id == "audio_voice_locale":
				return "voice"
			if row_id.begins_with("audio_group_") or row.has("group"):
				return "volume"
			if row_id == "audio_reset_all":
				return "advanced"
			return "audio"
		"display_settings":
			if row_id == "display":
				return "overview"
			if row_id.begins_with("access_") or row_id == "accessibility":
				return "accessibility"
			if row_id == "display_reset_all":
				return "advanced"
			return "display"
		"settings":
			if row_id == "input_profile" or row_id.begins_with("gamepad_") or row_id.begins_with("binding_"):
				return "input"
			if row_id == "display" or row_id.begins_with("display_"):
				return "display"
			if row_id == "character" or row_id.begins_with("character_"):
				return "character"
			if row_id == "stage_select" or row_id.begins_with("stage_"):
				return "stage"
			if row_id.begins_with("pattern_lab") or row_id.begins_with("bullet_visual"):
				return "analysis"
			if row_id.begins_with("balance_") or row_id.begins_with("latency_"):
				return "advanced"
			if row_id.begins_with("access_") or row_id == "accessibility":
				return "accessibility"
			if row_id == "audio" or row_id.begins_with("audio_") or row.has("group"):
				return "audio"
		"results":
			return "results"
	return ""

func _control_for_row(screen_id: String, row: Dictionary) -> String:
	var row_id := String(row.get("id", ""))
	var action := String(row.get("ui_action", ""))
	if row.has("screen"):
		return "nav"
	if not action.is_empty():
		if action.begins_with("gensoulkyo"):
			if action == "gensoulkyo_open_chest":
				return "chest"
			return "network"
		match action:
			"battle_client_prepare", "battle_client_connect", "battle_client_input_header":
				return "network"
			"local_settle_match":
				return "button"
			"advance_queue", "queue_mode", "start_certification_queue", "ready_match", "begin_network_match", "cancel_queue":
				return "queue"
			"select_mode", "select_battle_royale_candidate", "request_boss_transfer":
				return "mode"
			"open_social_link":
				return "link"
			"invite_friend":
				return "friend"
			"request_activity_claim":
				return "claim"
			"open_chest":
				return "chest"
			"load_replay":
				return "replay"
			"set_replay_filter":
				return "button"
			"toggle_deck_card", "save_deck":
				return "card"
			"cycle_input_profile", "cycle_input_binding", "cycle_language", "cycle_voice_locale", "cycle_gamepad_curve", "cycle_resolution", "cycle_window_mode", "cycle_fps_limit", "cycle_character", "cycle_stage", "cycle_network_quality", "cycle_palette":
				return "select"
			"adjust_gamepad_sensitivity", "adjust_gamepad_deadzone", "adjust_gamepad_vibration", "adjust_audio_volume", "adjust_screen_shake", "adjust_background_dim", "adjust_bullet_alpha":
				return "slider"
			"toggle_vsync", "toggle_low_flash", "toggle_simplified_background", "toggle_always_show_hitbox", "toggle_practice_graze_ring", "toggle_event_visual_cues", "toggle_high_frequency_graze_audio", "toggle_stage_run":
				return "toggle"
			"network_ready", "request_full_snapshot", "practice_restart", "practice_seed_prev", "practice_seed_next", "practice_power_down", "practice_power_up", "practice_bombs_cycle", "start_boss_spellbook_run", "apply_stage_practice_plan", "apply_stage_practice_preset", "apply_recommended_character", "run_balance_simulation", "run_latency_tests", "activate_theme", "dismiss_announcement", "restart_practice", "save_replay", "reset_gamepad_settings", "reset_audio_settings", "reset_display_settings", "reset_accessibility_settings", "save_player_settings", "load_player_settings", "restore_default_player_settings":
				return "button"
			_:
				return "button"
	if row.has("card_id"):
		return "card"
	if row.has("replay_id"):
		return "replay"
	if row.has("character_id") or row.has("stage_id") or row.has("pattern_id"):
		return "select"
	if row.has("mode_ruleset_version") or row_id.begins_with("mode_") or row_id.begins_with("cert_") or row_id.begins_with("br_") or row_id == "pvp_duel" or row_id.contains("boss"):
		return "mode"
	if String(row.get("label_key", "")) == "screen.social.link":
		return "link"
	if String(row.get("label_key", "")) == "screen.social.friend":
		return "friend"
	if String(row.get("label_key", "")) == "screen.social.announcement":
		return "button"
	if row_id == "gamepad_curve_preview":
		return "status"
	if row.has("group") or row_id.begins_with("gamepad_") or row_id.begins_with("display_") or row_id.begins_with("access_"):
		return "slider"
	if row.has("summary") or row.has("value") or row.has("items") or screen_id == "network_match":
		return "status"
	return "row"

func _decorate_control_metadata(row: Dictionary) -> void:
	var control := String(row.get("ui_control", ""))
	match control:
		"toggle":
			if not row.has("control_value"):
				row["control_value"] = _row_toggle_value(row)
		"slider":
			if not row.has("control_value"):
				row["control_value"] = _row_slider_value(row)
			if not row.has("control_min"):
				row["control_min"] = 0.0
			if not row.has("control_max"):
				row["control_max"] = 1.0
			if not row.has("control_step"):
				row["control_step"] = float(row.get("delta", 0.05))
			if not row.has("control_unit"):
				row["control_unit"] = "percent"
		"select":
			if not row.has("control_options"):
				row["control_options"] = _row_select_options(row)
			if not row.has("control_option_index"):
				row["control_option_index"] = _row_select_index(row)

func _row_toggle_value(row: Dictionary) -> bool:
	if row.has("value"):
		var value := String(row.get("value", "")).to_lower()
		return value == "on" or value == "true" or value == "yes"
	var action := String(row.get("ui_action", ""))
	if accessibility_settings != null:
		match action:
			"toggle_low_flash":
				return bool(accessibility_settings.low_flash)
			"toggle_simplified_background":
				return bool(accessibility_settings.simplified_background)
			"toggle_always_show_hitbox":
				return bool(accessibility_settings.always_show_hitbox)
			"toggle_practice_graze_ring":
				return bool(accessibility_settings.practice_graze_ring)
	if audio_settings != null:
		match action:
			"toggle_event_visual_cues":
				return bool(audio_settings.event_visual_cues)
			"toggle_high_frequency_graze_audio":
				return bool(audio_settings.high_frequency_graze_audio)
	if display_settings != null and action == "toggle_vsync":
		return bool(display_settings.vsync_enabled)
	return bool(row.get("enabled", true))

func _row_slider_value(row: Dictionary) -> float:
	if row.has("control_value"):
		return float(row.get("control_value", 0.0))
	if row.has("volume"):
		return float(row.get("volume", 0.0))
	if row.has("value"):
		var value := String(row.get("value", "0")).replace("%", "")
		if value.is_valid_float():
			return clampf(value.to_float() / 100.0, 0.0, 1.5)
	return 0.0

func _row_select_options(row: Dictionary) -> Array:
	var action := String(row.get("ui_action", ""))
	if input_profile != null:
		match action:
			"cycle_input_profile":
				return input_profile.profile_options()
			"cycle_gamepad_curve":
				return input_profile.gamepad_curve_options()
			"cycle_input_binding":
				var binding_action := StringName(String(row.get("action", "")))
				return input_profile.binding_option_names(binding_action)
	if display_settings != null:
		match action:
			"cycle_resolution":
				return display_settings.resolution_options()
			"cycle_window_mode":
				return display_settings.window_mode_options()
			"cycle_fps_limit":
				return display_settings.fps_limit_options()
	if accessibility_settings != null and action == "cycle_palette":
		return accessibility_settings.palette_options()
	return []

func _row_select_index(row: Dictionary) -> int:
	var options: Array = row.get("control_options", [])
	if options.is_empty():
		return -1
	var value_text := String(row.get("value", ""))
	for i in range(options.size()):
		if str(options[i]) == value_text:
			return i
	var action := String(row.get("ui_action", ""))
	if input_profile != null:
		match action:
			"cycle_input_profile":
				return int(input_profile.profile_index)
			"cycle_gamepad_curve":
				return int(input_profile.gamepad_curve_index)
			"cycle_input_binding":
				var keycodes: Array = row.get("keycodes", [])
				if keycodes.is_empty():
					return -1
				var names: Array = row.get("control_options", [])
				return names.find(OS.get_keycode_string(int(keycodes[0])))
	if display_settings != null:
		match action:
			"cycle_resolution":
				return int(display_settings.resolution_index)
			"cycle_window_mode":
				return int(display_settings.window_mode_index)
			"cycle_fps_limit":
				return int(display_settings.fps_limit_index)
	if accessibility_settings != null and action == "cycle_palette":
		return int(accessibility_settings.palette_index)
	return -1
