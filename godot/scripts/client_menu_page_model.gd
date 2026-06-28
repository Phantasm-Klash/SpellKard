class_name ClientMenuPageModel
extends RefCounted

const PAGE_SPECS := {
	"main_menu": {
		"kind": "home_lobby",
		"category": "play",
		"parent": "",
		"density": "hero",
		"primary_row_ids": ["play", "collection", "community", "player_settings"],
		"secondary_row_ids": ["certification", "deck", "replay", "activity", "friends", "promotions"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["practice", "certification", "pvp", "boss", "room"],
		"show_home": true,
		"show_secondary_shell": false,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 1.0,
	},
	"play": {
		"kind": "hub",
		"category": "play",
		"parent": "main_menu",
		"density": "hub",
		"primary_row_ids": ["play_practice", "play_matchmaking", "play_pvp_duel", "play_world_boss", "play_room", "play_deck"],
		"secondary_row_ids": ["play_certification_hub", "play_battle_royale", "play_instance_boss", "play_queue_selected"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["practice", "certification", "pvp", "boss", "room"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"certification": {
		"kind": "hub",
		"category": "play",
		"parent": "main_menu",
		"density": "hub",
		"primary_row_ids": ["cert_queue", "cert_practice", "cert_deck", "cert_rules"],
		"secondary_row_ids": ["cert_rating", "cert_rank", "cert_top30", "cert_stage"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["certification", "practice", "loadout"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"practice": {
		"kind": "playfield",
		"category": "play",
		"parent": "play",
		"density": "playfield",
		"primary_row_ids": ["practice_restart", "practice_stage_run", "stage_briefing", "stage_recommended_character"],
		"secondary_row_ids": ["practice_seed_prev", "practice_seed_next", "practice_power_down", "practice_power_up", "practice_bombs_cycle"],
		"setting_groups": ["stage", "character", "analysis"],
		"social_groups": [],
		"mode_groups": ["practice"],
		"show_home": false,
		"show_secondary_shell": false,
		"show_gameplay": true,
		"advance_gameplay": true,
		"panel_anchor": "none",
		"panel_width_ratio": 0.0,
	},
	"match": {
		"kind": "matchmaking",
		"category": "play",
		"parent": "play",
		"density": "focused",
		"primary_row_ids": ["matchmaking_quick", "matchmaking_ranked", "matchmaking_pvp", "matchmaking_boss", "matchmaking_room", "queue_status"],
		"secondary_row_ids": ["active_deck", "selected_mode", "network_quality", "ready", "cancel", "reconnect_status"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["quick", "ranked", "pvp", "boss", "room"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "center",
		"panel_width_ratio": 0.62,
	},
	"network_match": {
		"kind": "network_room",
		"category": "play",
		"parent": "play",
		"density": "focused",
		"primary_row_ids": ["gensoulkyo_login", "gensoulkyo_create_room", "gensoulkyo_server_ready", "battle_client_prepare", "battle_client_connect", "battle_client_input_header"],
		"secondary_row_ids": ["netsec_summary", "business_transport", "business_auth_sign", "battle_transport", "battle_handshake", "battle_codec_crypto"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["room", "business_network", "battle_network"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "center",
		"panel_width_ratio": 0.62,
	},
	"modes": {
		"kind": "mode_select",
		"category": "play",
		"parent": "play",
		"density": "hub",
		"primary_row_ids": ["mode_summary", "certification", "pvp_duel", "battle_royale", "world_boss", "instance_boss"],
		"secondary_row_ids": ["br_candidates", "world_boss_transfer", "instance_boss_transfer"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["certification", "pvp", "boss"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"deck": {
		"kind": "collection",
		"category": "collection",
		"parent": "collection",
		"density": "collection",
		"primary_row_ids": ["deck_stats", "save_deck"],
		"secondary_row_ids": ["active_deck", "card_filter"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["loadout"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"chest": {
		"kind": "collection",
		"category": "collection",
		"parent": "collection",
		"density": "collection",
		"primary_row_ids": ["local_basic", "chest_wallet", "chest_result", "chest_audit"],
		"secondary_row_ids": ["chest_probability", "chest_pity"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["collection"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"collection": {
		"kind": "collection",
		"category": "collection",
		"parent": "main_menu",
		"density": "collection",
		"primary_row_ids": ["collection_deck", "collection_chest", "collection_replay"],
		"secondary_row_ids": ["collection_summary", "collection_workshop"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["deck", "chest", "replay", "workshop"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"community": {
		"kind": "hub",
		"category": "community",
		"parent": "main_menu",
		"density": "hub",
		"primary_row_ids": ["community_events", "community_friends", "community_social", "community_promotions"],
		"secondary_row_ids": ["community_workshop", "announce_architecture", "link_discord"],
		"setting_groups": [],
		"social_groups": ["activity", "friends", "social", "promotions", "workshop"],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"activity": {
		"kind": "community",
		"category": "community",
		"parent": "community",
		"density": "hub",
		"primary_row_ids": ["activity_summary", "activity_social", "activity_promotions", "announce_architecture", "activity_task_daily_complete_match", "activity_claim_log"],
		"secondary_row_ids": ["activity_event_local_s0", "activity_leaderboard_single_score"],
		"setting_groups": [],
		"social_groups": ["announcements", "tasks", "events", "leaderboards", "social", "promotions"],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"friends": {
		"kind": "community",
		"category": "community",
		"parent": "community",
		"density": "hub",
		"primary_row_ids": ["friends_summary", "friends_social", "friend_lumen", "friend_rin"],
		"secondary_row_ids": ["friends_promotions", "friend_kai"],
		"setting_groups": [],
		"social_groups": ["friends", "presence", "invites", "social"],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"social": {
		"kind": "community",
		"category": "community",
		"parent": "community",
		"density": "hub",
		"primary_row_ids": ["social_summary", "announce_architecture", "friend_lumen", "link_discord"],
		"secondary_row_ids": ["announce_certification", "link_steam", "link_creator_program", "link_github"],
		"setting_groups": [],
		"social_groups": ["announcements", "friends", "social_media", "promotion_links"],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"promotions": {
		"kind": "community",
		"category": "community",
		"parent": "community",
		"density": "hub",
		"primary_row_ids": ["promotions_summary", "promotions_social", "link_steam", "link_creator_program"],
		"secondary_row_ids": ["promotions_friends"],
		"setting_groups": [],
		"social_groups": ["promotion_links", "creator", "store", "friends"],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"workshop": {
		"kind": "community",
		"category": "community",
		"parent": "community",
		"density": "collection",
		"primary_row_ids": ["base"],
		"secondary_row_ids": [],
		"setting_groups": ["themes"],
		"social_groups": ["workshop"],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"replay": {
		"kind": "collection",
		"category": "collection",
		"parent": "collection",
		"density": "collection",
		"primary_row_ids": ["save_replay", "latest_replay"],
		"secondary_row_ids": ["favorite_replay", "remove_replay"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["replay"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"player_settings": {
		"kind": "settings",
		"category": "settings",
		"parent": "main_menu",
		"density": "settings",
		"primary_row_ids": ["settings_language", "settings_gamepad_curve", "settings_keybinds", "settings_volume", "settings_resolution", "settings_input"],
		"secondary_row_ids": ["settings_audio", "settings_display", "settings_save_now", "settings_reload", "settings_restore_defaults", "accessibility"],
		"setting_groups": ["language", "input", "gamepad", "keybinds", "audio", "volume", "display", "resolution", "accessibility", "storage"],
		"social_groups": [],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"input_settings": {
		"kind": "settings",
		"category": "settings",
		"parent": "player_settings",
		"density": "settings",
		"primary_row_ids": ["input_profile", "gamepad_curve", "gamepad_sensitivity", "binding_shoot"],
		"secondary_row_ids": ["gamepad_curve_preview", "gamepad_deadzone", "gamepad_vibration", "gamepad_reset_all", "binding_bomb", "binding_focus"],
		"setting_groups": ["input", "gamepad", "keybinds"],
		"social_groups": [],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"audio_settings": {
		"kind": "settings",
		"category": "settings",
		"parent": "player_settings",
		"density": "settings",
		"primary_row_ids": ["audio_voice_locale", "audio_group_master", "audio_group_music", "audio_event_visual_cues"],
		"secondary_row_ids": ["audio_group_sfx", "audio_group_ui", "audio_group_voice", "audio_graze_audio", "audio_reset_all"],
		"setting_groups": ["audio", "voice", "volume", "accessibility"],
		"social_groups": [],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"display_settings": {
		"kind": "settings",
		"category": "settings",
		"parent": "player_settings",
		"density": "settings",
		"primary_row_ids": ["display_resolution", "display_window_mode", "display_vsync", "display_fps_limit"],
		"secondary_row_ids": ["display_screen_shake", "display_background_dim", "display_reset_all", "accessibility", "access_low_flash"],
		"setting_groups": ["display", "resolution", "accessibility"],
		"social_groups": [],
		"mode_groups": [],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"settings": {
		"kind": "settings",
		"category": "settings",
		"parent": "player_settings",
		"density": "advanced",
		"primary_row_ids": ["input_profile", "display", "character", "stage_select", "pattern_lab", "audio"],
		"secondary_row_ids": ["bullet_visual", "balance_summary", "latency_summary", "accessibility"],
		"setting_groups": ["input", "gamepad", "keybinds", "display", "character", "stage", "analysis", "audio", "accessibility"],
		"social_groups": [],
		"mode_groups": ["practice_tuning"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
	"results": {
		"kind": "collection",
		"category": "collection",
		"parent": "deck",
		"density": "collection",
		"primary_row_ids": ["result", "score_breakdown", "reward", "save_replay", "retry"],
		"secondary_row_ids": ["tasks", "events", "leaderboards", "reward_audit"],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": ["result"],
		"show_home": false,
		"show_secondary_shell": true,
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "full",
		"panel_width_ratio": 0.72,
	},
}
const SCENE_CONTRACTS := {
	"home_lobby": {
		"scene_path": "res://scenes/ui/home_lobby_view.tscn",
		"family": "home",
		"required_bindings": ["HomeRoot", "PortraitPanel", "PortraitLabel", "StatusLabel", "PrimaryButtons", "DashboardGrid"],
		"render_slots": ["portrait", "status", "primary_buttons", "dashboard"],
	},
	"menu_hub": {
		"scene_path": "res://scenes/ui/menu_hub_view.tscn",
		"family": "hub",
		"required_bindings": ["MenuRoot", "NavigationRail", "CategoryTabs", "StatusCards", "FocusPanel", "SectionTabs", "OverviewCards", "QuickActions", "ContentRows", "PageSummary"],
		"render_slots": ["navigation", "categories", "status_cards", "focus", "page_summary", "sections", "overview", "quick_actions", "rows"],
	},
	"community_panel": {
		"scene_path": "res://scenes/ui/community_panel_view.tscn",
		"family": "community",
		"required_bindings": ["CommunityRoot", "NavigationRail", "CategoryTabs", "StatusCards", "FocusPanel", "SocialTabs", "OverviewCards", "QuickActions", "ContentRows", "PageSummary"],
		"render_slots": ["navigation", "categories", "status_cards", "focus", "page_summary", "social_tabs", "overview", "quick_actions", "rows"],
	},
	"settings_panel": {
		"scene_path": "res://scenes/ui/settings_panel_view.tscn",
		"family": "settings",
		"required_bindings": ["SettingsRoot", "NavigationRail", "CategoryTabs", "FocusPanel", "SectionTabs", "SettingGroups", "ControlPreview", "ControlButtons", "ContentRows", "PageSummary"],
		"render_slots": ["navigation", "categories", "focus", "page_summary", "sections", "setting_groups", "control_preview", "control_buttons", "rows"],
	},
	"matchmaking_panel": {
		"scene_path": "res://scenes/ui/matchmaking_panel_view.tscn",
		"family": "matchmaking",
		"required_bindings": ["MatchmakingRoot", "CategoryTabs", "FocusPanel", "ModeCards", "QueueState", "NetworkStatus", "QuickActions", "ContentRows", "PageSummary"],
		"render_slots": ["categories", "focus", "page_summary", "mode_cards", "queue_state", "network_status", "quick_actions", "rows"],
	},
	"playfield_overlay": {
		"scene_path": "res://scenes/ui/playfield_overlay_view.tscn",
		"family": "playfield",
		"required_bindings": ["PlayfieldOverlayRoot", "GameplayHUDSlot", "CompactMenuPanel", "FocusPanel", "QuickActions", "ContentRows", "PageSummary"],
		"render_slots": ["gameplay_hud", "compact_menu", "focus", "page_summary", "quick_actions", "rows"],
	},
	"collection_panel": {
		"scene_path": "res://scenes/ui/collection_panel_view.tscn",
		"family": "collection",
		"required_bindings": ["CollectionRoot", "NavigationRail", "CategoryTabs", "StatusCards", "FocusPanel", "FilterTabs", "OverviewCards", "QuickActions", "ContentRows", "PageSummary"],
		"render_slots": ["navigation", "categories", "status_cards", "focus", "page_summary", "filters", "overview", "quick_actions", "rows"],
	},
}
const PAGE_SCENE_IDS := {
	"main_menu": "home_lobby",
	"play": "menu_hub",
	"certification": "menu_hub",
	"modes": "menu_hub",
	"collection": "collection_panel",
	"community": "community_panel",
	"activity": "community_panel",
	"friends": "community_panel",
	"social": "community_panel",
	"promotions": "community_panel",
	"workshop": "community_panel",
	"player_settings": "settings_panel",
	"input_settings": "settings_panel",
	"audio_settings": "settings_panel",
	"display_settings": "settings_panel",
	"settings": "settings_panel",
	"match": "matchmaking_panel",
	"network_match": "matchmaking_panel",
	"practice": "playfield_overlay",
	"deck": "collection_panel",
	"chest": "collection_panel",
	"replay": "collection_panel",
	"results": "collection_panel",
}

func page_spec(screen_id: String, overrides: Dictionary = {}) -> Dictionary:
	var source_screen := screen_id
	if source_screen.is_empty():
		source_screen = "main_menu"
	var spec := _base_spec(source_screen)
	for key in overrides.keys():
		spec[key] = overrides[key]
	var scene_id := String(spec.get("scene_id", _scene_id_for_screen(source_screen)))
	var scene_contract := scene_contract(scene_id)
	spec["screen"] = source_screen
	spec["scene_id"] = scene_id
	spec["scene_path"] = String(scene_contract.get("scene_path", ""))
	spec["scene_family"] = String(scene_contract.get("family", ""))
	spec["required_bindings"] = _string_array(scene_contract.get("required_bindings", []))
	spec["render_slots"] = _string_array(scene_contract.get("render_slots", []))
	spec["overview_priority_ids"] = _string_array(spec.get("primary_row_ids", []))
	spec["player_task_groups"] = _player_task_groups(source_screen, spec)
	spec["primary_count"] = _string_array(spec.get("primary_row_ids", [])).size()
	spec["secondary_count"] = _string_array(spec.get("secondary_row_ids", [])).size()
	spec["setting_group_count"] = _string_array(spec.get("setting_groups", [])).size()
	spec["social_group_count"] = _string_array(spec.get("social_groups", [])).size()
	spec["mode_group_count"] = _string_array(spec.get("mode_groups", [])).size()
	spec["player_task_count"] = _string_array(spec.get("player_task_groups", [])).size()
	spec["required_binding_count"] = _string_array(spec.get("required_bindings", [])).size()
	spec["render_slot_count"] = _string_array(spec.get("render_slots", [])).size()
	return spec

func primary_row_ids(screen_id: String) -> Array[String]:
	return _string_array(page_spec(screen_id).get("primary_row_ids", []))

func secondary_row_ids(screen_id: String) -> Array[String]:
	return _string_array(page_spec(screen_id).get("secondary_row_ids", []))

func setting_groups(screen_id: String) -> Array[String]:
	return _string_array(page_spec(screen_id).get("setting_groups", []))

func social_groups(screen_id: String) -> Array[String]:
	return _string_array(page_spec(screen_id).get("social_groups", []))

func mode_groups(screen_id: String) -> Array[String]:
	return _string_array(page_spec(screen_id).get("mode_groups", []))

func player_task_groups(screen_id: String) -> Array[String]:
	return _string_array(page_spec(screen_id).get("player_task_groups", []))

func page_map() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for screen_id in PAGE_SPECS.keys():
		rows.append(page_spec(String(screen_id)))
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return String(a.get("screen", "")) < String(b.get("screen", ""))
	)
	return rows

func scene_contract(scene_id: String) -> Dictionary:
	var source_scene := scene_id
	if source_scene.is_empty():
		source_scene = "menu_hub"
	if SCENE_CONTRACTS.has(source_scene):
		var contract: Dictionary = (SCENE_CONTRACTS[source_scene] as Dictionary).duplicate(true)
		contract["scene_id"] = source_scene
		contract["required_bindings"] = _string_array(contract.get("required_bindings", []))
		contract["render_slots"] = _string_array(contract.get("render_slots", []))
		return contract
	return {
		"scene_id": source_scene,
		"scene_path": "",
		"family": "missing",
		"required_bindings": [],
		"render_slots": [],
	}

func scene_contracts() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for scene_id in SCENE_CONTRACTS.keys():
		rows.append(scene_contract(String(scene_id)))
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return String(a.get("scene_id", "")) < String(b.get("scene_id", ""))
	)
	return rows

func validate_page_scene_map() -> Dictionary:
	var missing: Array[String] = []
	for screen_id in PAGE_SPECS.keys():
		var scene_id := _scene_id_for_screen(String(screen_id))
		var contract := scene_contract(scene_id)
		if String(contract.get("scene_path", "")).is_empty() or _string_array(contract.get("required_bindings", [])).is_empty():
			missing.append("%s:%s" % [String(screen_id), scene_id])
	return {
		"ok": missing.is_empty(),
		"missing": missing,
		"screen_count": PAGE_SPECS.size(),
		"scene_count": SCENE_CONTRACTS.size(),
	}

func _base_spec(screen_id: String) -> Dictionary:
	if PAGE_SPECS.has(screen_id):
		return (PAGE_SPECS[screen_id] as Dictionary).duplicate(true)
	return {
		"kind": "standard",
		"category": "system",
		"parent": "main_menu",
		"density": "standard",
		"primary_row_ids": [],
		"secondary_row_ids": [],
		"setting_groups": [],
		"social_groups": [],
		"mode_groups": [],
		"show_home": screen_id == "main_menu",
		"show_secondary_shell": screen_id != "main_menu",
		"show_gameplay": false,
		"advance_gameplay": false,
		"panel_anchor": "right",
		"panel_width_ratio": 0.56,
	}

func _scene_id_for_screen(screen_id: String) -> String:
	return String(PAGE_SCENE_IDS.get(screen_id, "menu_hub"))

func _player_task_groups(screen_id: String, spec: Dictionary) -> Array[String]:
	match screen_id:
		"main_menu":
			return ["play", "collection", "community", "settings"]
		"play":
			return ["practice", "matchmaking", "pvp", "boss", "room", "deck"]
		"certification":
			return ["queue", "drill", "deck", "rules", "rating"]
		"practice":
			return ["restart", "stage_run", "stage", "character", "pattern_lab"]
		"match":
			return ["quick", "ranked", "pvp", "boss", "room", "queue"]
		"network_match":
			return ["login", "room", "business_security", "battle_transport", "packet_scaffold", "server_ready"]
		"modes":
			return ["certification", "pvp", "battle_royale", "world_boss", "instance_boss"]
		"deck":
			return ["deck_stats", "save_deck", "cards", "filters"]
		"collection":
			return ["deck", "chest", "replay", "workshop"]
		"chest":
			return ["open_chest", "wallet", "probability", "pity", "audit"]
		"community":
			return ["activity", "friends", "social", "promotions", "workshop"]
		"activity":
			return ["announcements", "tasks", "events", "leaderboards", "claims", "links"]
		"friends":
			return ["presence", "invites", "social", "promotions"]
		"social":
			return ["announcements", "friends", "social_media", "promotion_links"]
		"promotions":
			return ["store", "creator", "friends", "social"]
		"workshop":
			return ["themes", "manifests", "local_rejection"]
		"replay":
			return ["save_replay", "latest_replay", "favorite", "remove", "seek"]
		"player_settings":
			return ["language", "gamepad_curve", "keybinds", "volume", "resolution", "input_profile", "storage"]
		"input_settings":
			return ["profile", "gamepad_curve", "speed_preview", "keybinds", "reset"]
		"audio_settings":
			return ["voice", "master", "music", "sfx", "ui", "accessibility", "reset"]
		"display_settings":
			return ["resolution", "window", "vsync", "fps", "screen_effects", "accessibility"]
		"settings":
			return ["input", "display", "character", "stage", "pattern_lab", "audio"]
		"results":
			return ["result", "score", "reward", "replay", "retry"]
	var groups: Array[String] = []
	for key in ["setting_groups", "social_groups", "mode_groups", "primary_row_ids"]:
		for value in _string_array(spec.get(key, [])):
			if not groups.has(value):
				groups.append(value)
	return groups

func _string_array(source: Variant) -> Array[String]:
	var values: Array[String] = []
	if typeof(source) != TYPE_ARRAY:
		return values
	for item in source as Array:
		values.append(String(item))
	return values
