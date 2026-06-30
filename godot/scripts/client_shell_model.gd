class_name ClientShellModel
extends RefCounted

var matchmaking_model: RefCounted = null
var game_mode_model: RefCounted = null
var social_hub_model: RefCounted = null
var input_profile: RefCounted = null
var audio_settings: RefCounted = null
var display_settings: RefCounted = null
var deck_builder: RefCounted = null
var results_service_model: RefCounted = null
var network_security_model: RefCounted = null

func configure(deps: Dictionary) -> void:
	matchmaking_model = deps.get("matchmaking_model", null)
	game_mode_model = deps.get("game_mode_model", null)
	social_hub_model = deps.get("social_hub_model", null)
	input_profile = deps.get("input_profile", null)
	audio_settings = deps.get("audio_settings", null)
	display_settings = deps.get("display_settings", null)
	deck_builder = deps.get("deck_builder", null)
	results_service_model = deps.get("results_service_model", null)
	network_security_model = deps.get("network_security_model", null)

func main_menu_rows() -> Array[Dictionary]:
	return [
		{"id": "play", "screen": "play", "label_key": "screen.main.play", "summary": "modes, practice, matchmaking, online room", "enabled": true},
		{"id": "collection", "screen": "collection", "label_key": "screen.main.collection", "summary": "deck, chests, replay, workshop", "enabled": true},
		{"id": "community", "screen": "community", "label_key": "screen.main.community", "summary": "activity, friends, notices, links", "enabled": true},
		{"id": "player_settings", "screen": "player_settings", "label_key": "screen.main.player_settings", "summary": "input, gamepad curve, audio, display", "enabled": true},
	]

func home_dashboard_cards() -> Array[Dictionary]:
	return []

func play_rows() -> Array[Dictionary]:
	return [
		{"id": "play_summary", "label_key": "screen.play.summary", "value": play_summary(), "enabled": true},
		{"id": "play_certification_hub", "screen": "certification", "label_key": "screen.main.certification", "value": certification_summary(), "enabled": true},
		{"id": "play_practice", "screen": "practice", "label_key": "screen.play.practice", "value": "stage drills", "enabled": true},
		{"id": "play_matchmaking", "screen": "match", "label_key": "screen.play.matchmaking", "value": _queue_summary(), "enabled": true},
		{"id": "play_room", "screen": "network_match", "label_key": "screen.play.room", "value": "room and server actions", "enabled": true},
		{"id": "play_certification", "label_key": "screen.mode.certification", "value": _mode_value("certification"), "enabled": true, "ui_action": "select_mode", "mode_id": "certification"},
		{"id": "play_pvp_duel", "label_key": "screen.mode.pvp_duel", "value": _mode_value("pvp_duel"), "enabled": true, "ui_action": "select_mode", "mode_id": "pvp_duel"},
		{"id": "play_battle_royale", "label_key": "screen.mode.battle_royale", "value": _mode_value("battle_royale"), "enabled": true, "ui_action": "select_mode", "mode_id": "battle_royale"},
		{"id": "play_world_boss", "label_key": "screen.mode.world_boss", "value": _boss_mode_value("world_boss"), "enabled": true, "ui_action": "select_mode", "mode_id": "world_boss"},
		{"id": "play_instance_boss", "label_key": "screen.mode.instance_boss", "value": _boss_mode_value("instance_boss"), "enabled": true, "ui_action": "select_mode", "mode_id": "instance_boss"},
		_boss_status_row("play_world_boss_status", "world_boss"),
		_boss_status_row("play_instance_boss_status", "instance_boss"),
		{"id": "play_queue_selected", "label_key": "screen.play.matchmaking", "value": "queue selected mode", "enabled": true, "ui_action": "advance_queue"},
		{"id": "play_deck", "screen": "deck", "label_key": "screen.main.deck", "value": _deck_summary(), "enabled": true},
	]

func certification_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = [
		{"id": "cert_summary", "label_key": "screen.cert.summary", "value": certification_summary(), "enabled": true},
		{"id": "cert_queue", "label_key": "screen.cert.queue", "value": _queue_summary(), "enabled": true, "ui_action": "start_certification_queue"},
		{"id": "cert_practice", "screen": "practice", "label_key": "screen.cert.local_drill", "value": _certification_stage(), "enabled": true},
		{"id": "cert_deck", "screen": "deck", "label_key": "screen.match.active_deck", "value": _deck_summary(), "enabled": true},
		{"id": "cert_rules", "label_key": "screen.cert.rules", "value": _certification_rules(), "enabled": true},
	]
	if game_mode_model != null:
		for row in game_mode_model.mode_rows():
			var row_id := String(row.get("id", ""))
			if row_id.begins_with("cert_"):
				rows.append((row as Dictionary).duplicate(true))
	return rows

func community_rows() -> Array[Dictionary]:
	return [
		{"id": "community_summary", "label_key": "screen.community.summary", "value": community_summary(), "enabled": true},
		{"id": "community_events", "screen": "activity", "label_key": "screen.main.events", "enabled": true},
		{"id": "community_friends", "screen": "friends", "label_key": "screen.main.friends", "summary": friends_summary(), "enabled": true},
		{"id": "community_social", "screen": "social", "label_key": "screen.main.social", "enabled": true},
		{"id": "community_promotions", "screen": "promotions", "label_key": "screen.main.promotions", "summary": promotions_summary(), "enabled": true},
		{"id": "community_workshop", "screen": "workshop", "label_key": "screen.main.workshop", "enabled": true},
	]

func collection_rows() -> Array[Dictionary]:
	return [
		{"id": "collection_summary", "label_key": "screen.main.collection", "value": "%s | replay local" % [_deck_summary()], "summary": "cards, chests, replays, workshop", "enabled": true},
		{"id": "collection_deck", "screen": "deck", "label_key": "screen.main.deck", "summary": _deck_summary(), "enabled": true},
		{"id": "collection_chest", "screen": "chest", "label_key": "screen.main.chest", "summary": "local chest pools and audit", "enabled": true},
		{"id": "collection_replay", "screen": "replay", "label_key": "screen.main.replay", "summary": "match records and local playback", "enabled": true},
		{"id": "collection_workshop", "screen": "workshop", "label_key": "screen.main.workshop", "summary": "themes and local content manifests", "enabled": true},
	]

func player_settings_rows() -> Array[Dictionary]:
	return [
		{"id": "settings_summary", "label_key": "screen.settings.summary", "value": settings_summary(), "enabled": true},
		{"id": "settings_gamepad_curve", "screen": "input_settings", "target_row_id": "gamepad_curve", "label_key": "screen.settings.gamepad_curve", "summary": _gamepad_curve_summary(), "enabled": true},
		{"id": "settings_keybinds", "screen": "input_settings", "target_row_id": "binding_shoot", "label_key": "screen.settings.input_binding", "summary": _keybind_summary(), "enabled": true},
		{"id": "settings_input", "screen": "input_settings", "target_row_id": "input_profile", "label_key": "screen.settings.input_profile", "summary": _input_summary(), "enabled": true},
		{"id": "settings_volume", "screen": "audio_settings", "target_row_id": "audio_group_master", "label_key": "screen.settings.volume", "summary": _volume_summary(), "enabled": true},
		{"id": "settings_audio", "screen": "audio_settings", "target_row_id": "audio_group_master", "label_key": "screen.settings.audio", "summary": _audio_summary(), "enabled": true},
		{"id": "settings_resolution", "screen": "display_settings", "target_row_id": "display_resolution", "label_key": "screen.settings.resolution", "summary": _resolution_summary(), "enabled": true},
		{"id": "settings_display", "screen": "display_settings", "target_row_id": "display_resolution", "label_key": "screen.settings.display", "summary": _display_summary(), "enabled": true},
		{"id": "settings_advanced", "screen": "settings", "label_key": "screen.settings.advanced", "summary": "character, stage, pattern lab, tests", "enabled": true},
	]

func play_summary() -> String:
	var mode_id := "certification"
	if matchmaking_model != null:
		mode_id = String(matchmaking_model.get("selected_mode_id"))
	return "mode %s queue %s" % [mode_id, _queue_summary()]

func certification_summary() -> String:
	var rating := "-"
	var rank_score := 0
	var percentile := 100.0
	if game_mode_model != null:
		var cert_state_value: Variant = game_mode_model.get("certification_state")
		if typeof(cert_state_value) == TYPE_DICTIONARY:
			var cert_state: Dictionary = cert_state_value
			rating = String(cert_state.get("rating_code", "-"))
			rank_score = int(cert_state.get("rank_score", 0))
			percentile = float(cert_state.get("percentile", 1.0)) * 100.0
	return "rating %s rank %d top %.1f%% %s" % [rating, rank_score, percentile, _mode_value("certification")]

func community_summary() -> String:
	if social_hub_model == null:
		return "offline"
	return social_hub_model.summary()

func friends_summary() -> String:
	if social_hub_model == null:
		return "offline"
	var requests: Array = social_hub_model.get("invite_requests")
	return "friends %d invites %d" % [int(social_hub_model.online_friend_count()), requests.size()]

func promotions_summary() -> String:
	if social_hub_model == null:
		return "offline"
	var rows: Array[Dictionary] = social_hub_model.promotion_rows()
	return "links %d last %s" % [rows.size(), String(social_hub_model.get("last_opened_link_id")) if not String(social_hub_model.get("last_opened_link_id")).is_empty() else "none"]

func settings_summary() -> String:
	return "%s | %s | %s" % [_input_summary(), _audio_summary(), _display_summary()]

func home_status_summary() -> String:
	return "%s %s | %s | deck %s" % [
		String(matchmaking_model.get("selected_mode_id")) if matchmaking_model != null else "practice",
		String(matchmaking_model.get("queue_status")) if matchmaking_model != null else "local",
		friends_summary(),
		_deck_summary(),
	]

func client_status_summary() -> String:
	return "play %s | cert %s | social %s | network %s | settings %s | deck %s" % [
		play_summary(),
		_certification_badge(),
		community_summary(),
		_network_badge(),
		settings_summary(),
		_deck_summary(),
	]

func client_status_cards() -> Array[Dictionary]:
	return [
		{
			"id": "status_play",
			"label_key": "screen.main.play",
			"value": _next_action_value(),
			"screen": _next_action_screen(),
		},
		{
			"id": "status_collection",
			"label_key": "screen.main.collection",
			"value": _deck_summary(),
			"screen": "collection",
		},
		{
			"id": "status_community",
			"label_key": "screen.main.community",
			"value": community_summary(),
			"screen": "community",
		},
		{
			"id": "status_settings",
			"label_key": "screen.main.settings",
			"value": _settings_badge(),
			"screen": "player_settings",
		},
	]

func page_focus(screen_id: String) -> Dictionary:
	match screen_id:
		"main_menu":
			return _focus_payload(
				"focus_home",
				"Ready Lobby",
				"%s | %s | deck %s" % [play_summary(), community_summary(), _deck_summary()],
				["play"],
				"Play"
			)
		"play":
			return _focus_payload(
				"focus_play",
				"Play Hub",
				"%s | deck %s" % [play_summary(), _deck_summary()],
				["play_matchmaking", "play_practice", "play_room"],
				"Matchmaking"
			)
		"certification":
			return _focus_payload(
				"focus_certification",
				"Certification",
				"%s | stage %s | rules %s" % [certification_summary(), _certification_stage(), _certification_rules()],
				["cert_queue", "cert_practice"],
				"Start Certification"
			)
		"match":
			return _focus_payload(
				"focus_match",
				"Matchmaking",
				"%s | deck %s" % [_play_status_badge(), _deck_summary()],
				_match_primary_row_ids(),
				"Queue"
			)
		"network_match":
			return _focus_payload(
				"focus_network_match",
				"Online Room",
				"%s | %s" % [_queue_summary(), _network_badge()],
				["gensoulkyo_login", "gensoulkyo_create_room", "gensoulkyo_server_ready", "battle_client_prepare", "battle_client_connect"],
				"Network Actions"
			)
		"activity":
			return _focus_payload(
				"focus_activity",
				"Activity Center",
				_activity_summary(),
				["activity_task_daily_complete_match", "activity_event_local_s0", "activity_claim_log"],
				"Activity Claim"
			)
		"community":
			return _focus_payload(
				"focus_community",
				"Community",
				"%s | %s | %s" % [community_summary(), friends_summary(), promotions_summary()],
				["community_events", "community_friends", "community_social", "community_promotions"],
				"Events"
			)
		"friends":
			return _focus_payload(
				"focus_friends",
				"Friends",
				friends_summary(),
				["friend_lumen", "friend_rin"],
				"Invite Friend"
			)
		"social":
			return _focus_payload(
				"focus_social",
				"Social",
				community_summary(),
				["link_discord", "announce_architecture", "friend_lumen"],
				"Discord"
			)
		"promotions":
			return _focus_payload(
				"focus_promotions",
				"Promotions",
				promotions_summary(),
				["link_steam", "link_creator_program"],
				"Steam"
			)
		"collection":
			return _focus_payload(
				"focus_collection",
				"Collection",
				"%s | chests and replays" % [_deck_summary()],
				["collection_deck", "collection_chest", "collection_replay"],
				"Deck"
			)
		"player_settings":
			return _focus_payload(
				"focus_player_settings",
				"Player Settings",
				settings_summary(),
				["settings_gamepad_curve", "settings_keybinds", "settings_volume", "settings_resolution"],
				"Gamepad Curve"
			)
		"input_settings":
			return _focus_payload(
				"focus_input_settings",
				"Input Setup",
				_input_focus_summary(),
				["gamepad_curve", "gamepad_sensitivity", "binding_shoot", "input_profile"],
				"Gamepad Curve"
			)
		"audio_settings":
			return _focus_payload(
				"focus_audio_settings",
				"Audio Mix",
				_audio_summary(),
				["audio_group_master", "audio_group_music", "audio_event_visual_cues"],
				"Master Volume"
			)
		"display_settings":
			return _focus_payload(
				"focus_display_settings",
				"Display",
				_display_summary(),
				["display_resolution", "display_window_mode", "display_vsync"],
				"Resolution"
			)
		"deck":
			return _focus_payload(
				"focus_deck",
				"Deck",
				_deck_summary(),
				["save_deck"],
				"Save Deck"
			)
		"chest":
			return _focus_payload(
				"focus_chest",
				"Chest",
				_deck_summary(),
				["local_basic"],
				"Open Chest"
			)
		"replay":
			return _focus_payload(
				"focus_replay",
				"Replay",
				"local replay filters and playback verification",
				["replay_filter_replay_local_ready", "replay_action_favorite", "replay_action_remove"],
				"Verified Replays"
			)
		"settings":
			return _focus_payload(
				"focus_advanced_settings",
				"Advanced Settings",
				"%s | %s" % [_display_summary(), _audio_summary()],
				["input_profile", "display_resolution", "audio_group_master"],
				"Tuning"
			)
	return _focus_payload(
		"focus_%s" % screen_id,
		screen_id.capitalize(),
		client_status_summary(),
		[],
		""
	)

func _queue_summary() -> String:
	if matchmaking_model == null:
		return "offline"
	return "%s %dms" % [String(matchmaking_model.get("queue_status")), int(matchmaking_model.get("ping_ms"))]

func _play_status_badge() -> String:
	if matchmaking_model == null:
		return "local offline"
	return "%s %s %dms" % [
		String(matchmaking_model.get("selected_mode_id")),
		String(matchmaking_model.get("queue_status")),
		int(matchmaking_model.get("ping_ms")),
	]

func _next_action_screen() -> String:
	if matchmaking_model == null:
		return "practice"
	var queue_status := String(matchmaking_model.get("queue_status"))
	if ["queued", "found", "ready"].has(queue_status):
		return "match"
	return "play"

func _next_action_value() -> String:
	if matchmaking_model == null:
		return "practice ready"
	var queue_status := String(matchmaking_model.get("queue_status"))
	if queue_status == "queued":
		return "queue %dms" % int(matchmaking_model.get("ping_ms"))
	if queue_status == "found" or queue_status == "ready":
		return "match found"
	return "%s ready" % String(matchmaking_model.get("selected_mode_id"))

func _top_notice_summary() -> String:
	if social_hub_model == null:
		return "offline"
	if social_hub_model.has_method("announcement_rows"):
		var rows: Array[Dictionary] = social_hub_model.announcement_rows()
		for row in rows:
			if bool(row.get("enabled", true)):
				return "%s %s" % [String(row.get("priority", "")), String(row.get("starts_at", ""))]
	return "ann %d" % int(social_hub_model.unread_count())

func _social_status_badge() -> String:
	if social_hub_model == null:
		return "offline"
	return "ann %d friends %d invites %d" % [
		int(social_hub_model.unread_count()),
		int(social_hub_model.online_friend_count()),
		(social_hub_model.get("invite_requests") as Array).size(),
	]

func _settings_badge() -> String:
	var input_text: String = input_profile.profile_name() if input_profile != null and input_profile.has_method("profile_name") else "-"
	var display_text: String = display_settings.resolution_text() if display_settings != null and display_settings.has_method("resolution_text") else "-"
	return "%s %s" % [input_text, display_text]

func _mode_value(mode_id: String) -> String:
	if matchmaking_model == null:
		return "local"
	var gate: Dictionary = matchmaking_model.gate_for_mode(mode_id)
	var config: Dictionary = matchmaking_model.mode_config(mode_id)
	return "%s wait %ds" % [
		"ready" if bool(gate.get("valid", false)) else String(gate.get("reason", "blocked")),
		int(config.get("estimated_wait_seconds", 0)),
	]

func _boss_mode_value(mode_id: String) -> String:
	var value := _mode_value(mode_id)
	if game_mode_model != null and game_mode_model.has_method("boss_local_status_row"):
		var row: Dictionary = game_mode_model.boss_local_status_row("boss_status_preview", mode_id)
		var status := String(row.get("value", ""))
		if not status.is_empty():
			return "%s | %s" % [value, status]
	return value

func _boss_status_row(row_id: String, mode_id: String) -> Dictionary:
	if game_mode_model != null and game_mode_model.has_method("boss_local_status_row"):
		return game_mode_model.boss_local_status_row(row_id, mode_id)
	return {
		"id": row_id,
		"label_key": "screen.mode.world_boss" if mode_id == "world_boss" else "screen.mode.instance_boss",
		"value": "offline",
		"mode_id": mode_id,
		"mode_category": "boss",
		"requires_server_confirmation": true,
		"server_authoritative": false,
		"client_result_authoritative": false,
		"enabled": true,
	}

func _certification_stage() -> String:
	if game_mode_model == null:
		return "cert_d_stage"
	var cert_state_value: Variant = game_mode_model.get("certification_state")
	if typeof(cert_state_value) != TYPE_DICTIONARY:
		return "cert_d_stage"
	return String((cert_state_value as Dictionary).get("challenge_stage_id", "cert_d_stage"))

func _certification_rules() -> String:
	if game_mode_model == null:
		return "survive, hit_limit, score_floor"
	var cert_state_value: Variant = game_mode_model.get("certification_state")
	if typeof(cert_state_value) != TYPE_DICTIONARY:
		return "survive, hit_limit, score_floor"
	var conditions: Array = (cert_state_value as Dictionary).get("pass_conditions", [])
	return ", ".join(conditions)

func _certification_badge() -> String:
	if game_mode_model == null:
		return "offline"
	var cert_state_value: Variant = game_mode_model.get("certification_state")
	if typeof(cert_state_value) != TYPE_DICTIONARY:
		return "unrated"
	var cert_state: Dictionary = cert_state_value
	return "%s %d top %.1f%%" % [
		String(cert_state.get("rating_code", "-")),
		int(cert_state.get("rank_score", 0)),
		float(cert_state.get("percentile", 1.0)) * 100.0,
	]

func _deck_summary() -> String:
	if deck_builder == null:
		return "-"
	return String(deck_builder.active_deck_snapshot().get("name", "-"))

func _input_summary() -> String:
	return input_profile.summary() if input_profile != null else "-"

func _gamepad_curve_summary() -> String:
	if input_profile == null:
		return "-"
	return "curve %s sens %.0f%% dz %.0f%% vib %.0f%%" % [
		input_profile.gamepad_curve(),
		float(input_profile.get("gamepad_sensitivity")) * 100.0,
		float(input_profile.get("gamepad_deadzone")) * 100.0,
		float(input_profile.get("gamepad_vibration")) * 100.0,
	]

func _keybind_summary() -> String:
	if input_profile == null:
		return "-"
	return "%s | %s | %s" % [
		input_profile.action_summary(&"shoot"),
		input_profile.action_summary(&"bomb"),
		input_profile.action_summary(&"focus"),
	]

func _audio_summary() -> String:
	return audio_settings.summary() if audio_settings != null else "-"

func _volume_summary() -> String:
	if audio_settings == null:
		return "-"
	return "master %.0f music %.0f sfx %.0f ui %.0f" % [
		float(audio_settings.volume_for("master")) * 100.0,
		float(audio_settings.volume_for("music")) * 100.0,
		float(audio_settings.volume_for("sfx")) * 100.0,
		float(audio_settings.volume_for("ui")) * 100.0,
	]

func _display_summary() -> String:
	return display_settings.summary() if display_settings != null else "-"

func _resolution_summary() -> String:
	if display_settings == null:
		return "-"
	return "%s %s fps %d vsync %s" % [
		display_settings.resolution_text(),
		display_settings.window_mode(),
		int(display_settings.fps_limit()),
		"on" if bool(display_settings.get("vsync_enabled")) else "off",
	]

func _focus_payload(focus_id: String, title: String, summary: String, primary_row_ids: Array, primary_label: String) -> Dictionary:
	return {
		"id": focus_id,
		"title": title,
		"summary": summary,
		"primary_row_ids": primary_row_ids.duplicate(),
		"primary_label": primary_label,
	}

func _match_primary_row_ids() -> Array[String]:
	if matchmaking_model == null:
		return ["queue_status"]
	var queue_status := String(matchmaking_model.get("queue_status"))
	match queue_status:
		"found":
			return ["ready", "queue_status", "cancel"]
		"queued":
			return ["queue_status", "cancel"]
		"ready":
			return ["queue_status", "ready", "cancel"]
		"blocked":
			return ["queue_status", "selected_mode"]
		_:
			return ["queue_status", "selected_mode"]

func _network_badge() -> String:
	if network_security_model != null and network_security_model.has_method("summary"):
		return String(network_security_model.summary())
	if matchmaking_model == null:
		return "offline"
	return "%s %s" % [
		String(matchmaking_model.get("server_status")),
		String(matchmaking_model.get("connection_state")),
	]

func _activity_summary() -> String:
	if results_service_model != null and results_service_model.has_method("summary"):
		return results_service_model.summary()
	return "local activity"

func _input_focus_summary() -> String:
	if input_profile == null:
		return "-"
	return "profile %s | pad %s %.0f%% dz %.0f%% | keys %s/%s" % [
		input_profile.profile_name(),
		input_profile.gamepad_curve(),
		float(input_profile.get("gamepad_sensitivity")) * 100.0,
		float(input_profile.get("gamepad_deadzone")) * 100.0,
		input_profile.action_summary(&"shoot"),
		input_profile.action_summary(&"bomb"),
	]
