class_name ClientMenuPageModel
extends RefCounted

const DEFAULT_CONTROLLER_ACTIONS: Array[String] = ["ui_up", "ui_down", "ui_accept", "ui_cancel_back"]
const HUB_CONTROLLER_ACTIONS: Array[String] = ["ui_up", "ui_down", "ui_left_control", "ui_right_control", "ui_accept", "category_tab", "status_card", "focus_action"]
const SETTINGS_CONTROLLER_ACTIONS: Array[String] = ["ui_up", "ui_down", "ui_left_control", "ui_right_control", "ui_accept", "category_tab", "status_card", "focus_action", "capture_binding", "reset_control"]
const DEFAULT_INPUT_METHODS: Array[String] = ["keyboard", "gamepad", "mouse"]
const DEFAULT_TEXT_FIT_POLICY: Array[String] = ["clip_button_text", "ellipsis_overrun", "wrap_labels", "minimum_44x22_targets"]
const DEFAULT_LAYOUT_SLOTS := {
	"home_lobby": ["portrait_art", "lobby_status", "primary_routes", "safe_margin"],
	"hub": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "overview_cards", "row_window", "quick_routes"],
	"community": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "notice_board", "social_tabs", "row_window", "quick_routes"],
	"settings": ["navigation_rail", "category_tabs", "focus_panel", "setting_groups", "control_preview", "control_buttons", "row_window", "quick_routes"],
	"matchmaking": ["category_tabs", "focus_panel", "mode_cards", "queue_state", "network_status", "row_window", "quick_routes"],
	"network_room": ["category_tabs", "focus_panel", "room_actions", "business_transport", "battle_transport", "row_window", "quick_routes"],
	"mode_select": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "mode_grid", "row_window", "quick_routes"],
	"collection": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "collection_grid", "filter_tabs", "row_window", "quick_routes"],
	"playfield": ["gameplay_hud", "compact_menu", "focus_panel", "quick_routes"],
	"battle_room": ["gameplay_hud", "server_projection", "network_status"],
}

const PAGE_SPECS := {
	"main_menu": {
		"kind": "home_lobby",
		"category": "play",
		"parent": "",
		"density": "hero",
		"visual_asset": "res://themes/base/ui/lobby_standee.svg",
		"visual_treatment": "portrait_first_original",
		"standee_asset": "res://themes/base/ui/lobby_standee.svg",
		"frame_asset": "",
		"asset_usage": ["standee:home_portrait:res://themes/base/ui/lobby_standee.svg"],
		"layout_slots": ["portrait_art", "lobby_status", "primary_routes", "safe_margin"],
		"focus_sections": ["primary_routes"],
		"input_methods": ["keyboard", "gamepad", "mouse"],
		"text_fit_policy": ["clip_button_text", "ellipsis_overrun", "wrap_labels", "minimum_44x22_targets"],
		"state_regions": ["hero_art", "status_strip", "primary_routes"],
		"status_region_ids": ["home_status", "client_summary", "primary_focus"],
		"focus_action_ids": ["play"],
		"controller_actions": ["ui_up", "ui_down", "ui_accept", "ui_cancel_back", "focus_action"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "mode_card_grid",
		"standee_asset": "",
		"frame_asset": "res://themes/base/ui/mode_card_frame.svg",
		"asset_usage": ["frame:mode_cards:res://themes/base/ui/mode_card_frame.svg"],
		"layout_slots": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "mode_grid", "row_window", "quick_routes"],
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "section_tabs", "overview_cards", "quick_routes", "row_window"],
		"input_methods": ["keyboard", "gamepad", "mouse"],
		"text_fit_policy": ["clip_button_text", "ellipsis_overrun", "wrap_labels", "minimum_44x22_targets"],
		"state_regions": ["navigation", "status_cards", "focus_panel", "overview_cards", "route_rows"],
		"status_region_ids": ["status_play", "status_collection", "status_community", "status_settings", "queue_state", "deck_state"],
		"focus_action_ids": ["play_matchmaking", "play_practice", "play_room"],
		"controller_actions": ["ui_up", "ui_down", "ui_left_control", "ui_right_control", "ui_accept", "category_tab", "status_card", "focus_action"],
		"primary_row_ids": ["play_practice", "play_matchmaking", "play_pvp_duel", "play_world_boss", "play_world_boss_status", "play_room", "play_deck"],
		"secondary_row_ids": ["play_certification_hub", "play_battle_royale", "play_instance_boss", "play_instance_boss_status", "play_queue_selected"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "rank_status_cards",
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "section_tabs", "overview_cards", "quick_routes", "row_window"],
		"state_regions": ["rating", "queue_action", "rules", "loadout"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "unobstructed_hud_overlay",
		"state_regions": ["gameplay_hud", "compact_menu", "stage_status"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "queue_status_cards",
		"focus_sections": ["category_tabs", "focus_panel", "mode_cards", "quick_routes", "row_window"],
		"state_regions": ["mode_cards", "queue_state", "network_status", "loadout", "settlement_loop"],
		"primary_row_ids": ["matchmaking_quick", "matchmaking_ranked", "matchmaking_pvp", "matchmaking_boss", "local_settlement_preview", "matchmaking_room", "queue_status"],
		"secondary_row_ids": ["match_world_boss_status", "match_instance_boss_status", "active_deck", "selected_mode", "network_quality", "ready", "cancel", "reconnect_status"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "secure_room_status",
		"focus_sections": ["category_tabs", "focus_panel", "mode_cards", "quick_routes", "row_window"],
		"state_regions": ["room_actions", "business_transport", "battle_transport", "packet_status"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "mode_selector",
		"state_regions": ["mode_cards", "mode_rules", "mode_status"],
		"primary_row_ids": ["mode_summary", "certification", "pvp_duel", "battle_royale", "world_boss", "instance_boss"],
		"secondary_row_ids": ["br_candidates", "world_boss_rules", "world_boss_authority", "world_boss_entry", "world_boss_party", "world_boss_formation", "world_boss_display", "world_boss_playfield", "world_boss_hud", "world_boss_practice_preview", "world_boss_transfer", "world_boss_result", "instance_boss_rules", "instance_boss_authority", "instance_boss_entry", "instance_boss_party", "instance_boss_formation", "instance_boss_display", "instance_boss_playfield", "instance_boss_hud", "instance_boss_practice_preview", "instance_boss_transfer", "instance_boss_result"],
		"overview_priority_ids": ["world_boss_authority", "instance_boss_authority", "world_boss_practice_preview", "instance_boss_practice_preview", "world_boss_entry", "instance_boss_entry", "battle_royale"],
		"focus_action_ids": ["world_boss_authority", "instance_boss_authority", "world_boss_entry", "instance_boss_entry"],
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
		"visual_asset": "res://themes/base/ui/collection_card_frame.svg",
		"visual_treatment": "card_collection_grid",
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "filter_tabs", "overview_cards", "quick_routes", "row_window"],
		"state_regions": ["deck_stats", "filters", "card_grid", "save_action"],
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
		"visual_asset": "res://themes/base/ui/collection_card_frame.svg",
		"visual_treatment": "chest_pool_cards",
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "filter_tabs", "overview_cards", "quick_routes", "row_window"],
		"state_regions": ["pool_cards", "probability", "pity", "results"],
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
		"visual_asset": "res://themes/base/ui/collection_card_frame.svg",
		"visual_treatment": "inventory_hub",
		"standee_asset": "",
		"frame_asset": "res://themes/base/ui/collection_card_frame.svg",
		"asset_usage": ["frame:collection_cards:res://themes/base/ui/collection_card_frame.svg"],
		"layout_slots": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "collection_grid", "filter_tabs", "row_window", "quick_routes"],
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "filter_tabs", "overview_cards", "quick_routes", "row_window"],
		"input_methods": ["keyboard", "gamepad", "mouse"],
		"text_fit_policy": ["clip_button_text", "ellipsis_overrun", "wrap_labels", "minimum_44x22_targets"],
		"state_regions": ["status_cards", "deck", "chest", "replay", "workshop"],
		"status_region_ids": ["status_collection", "deck_state", "chest_state", "replay_state", "workshop_state"],
		"focus_action_ids": ["collection_deck", "collection_chest", "collection_replay"],
		"controller_actions": ["ui_up", "ui_down", "ui_left_control", "ui_right_control", "ui_accept", "category_tab", "status_card", "focus_action"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "community_notice_board",
		"standee_asset": "",
		"frame_asset": "res://themes/base/ui/mode_card_frame.svg",
		"asset_usage": ["frame:community_notice_cards:res://themes/base/ui/mode_card_frame.svg"],
		"layout_slots": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "notice_board", "social_tabs", "row_window", "quick_routes"],
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "social_tabs", "overview_cards", "quick_routes", "row_window"],
		"input_methods": ["keyboard", "gamepad", "mouse"],
		"text_fit_policy": ["clip_button_text", "ellipsis_overrun", "wrap_labels", "minimum_44x22_targets"],
		"state_regions": ["announcements", "friends", "social_links", "promotion_links"],
		"status_region_ids": ["status_community", "announcement_state", "friend_presence", "promotion_state"],
		"focus_action_ids": ["community_events", "community_friends", "community_social", "community_promotions"],
		"controller_actions": ["ui_up", "ui_down", "ui_left_control", "ui_right_control", "ui_accept", "category_tab", "status_card", "focus_action"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "activity_task_board",
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "social_tabs", "overview_cards", "quick_routes", "row_window"],
		"state_regions": ["notices", "tasks", "events", "claims"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "friend_presence_list",
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "social_tabs", "overview_cards", "quick_routes", "row_window"],
		"state_regions": ["presence", "invites", "party_actions"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "social_link_board",
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "social_tabs", "overview_cards", "quick_routes", "row_window"],
		"state_regions": ["announcements", "friends", "social_media", "external_links"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "promotion_link_board",
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "social_tabs", "overview_cards", "quick_routes", "row_window"],
		"state_regions": ["store_links", "creator_links", "friend_referrals"],
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
		"visual_asset": "res://themes/base/ui/collection_card_frame.svg",
		"visual_treatment": "theme_manifest_cards",
		"state_regions": ["theme_list", "license_notice", "fallback_status"],
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
		"visual_asset": "res://themes/base/ui/collection_card_frame.svg",
		"visual_treatment": "replay_list",
		"focus_sections": ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "filter_tabs", "overview_cards", "quick_routes", "row_window"],
		"state_regions": ["verification_summary", "authority_summary", "playability_summary", "practice_validation", "replay_rows", "entry_actions"],
		"primary_row_ids": ["replay_verification_summary", "replay_authority_summary", "replay_playability_summary", "replay_practice_validation_checklist"],
		"secondary_row_ids": ["replay_boss_practice_verification", "replay_filter_replay_boss_practice", "replay_filter_replay_local_ready", "replay_filter_rejected_server_claim", "replay_action_load", "replay_action_favorite", "replay_action_remove"],
		"focus_action_ids": ["replay_filter_replay_boss_practice", "replay_filter_replay_local_ready", "replay_authority_summary", "replay_playability_summary", "replay_practice_validation_checklist", "replay_boss_practice_verification", "replay_filter_rejected_server_claim", "replay_action_load", "replay_action_favorite", "replay_action_remove"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "settings_control_hub",
		"standee_asset": "",
		"frame_asset": "res://themes/base/ui/mode_card_frame.svg",
		"asset_usage": ["frame:settings_control_cards:res://themes/base/ui/mode_card_frame.svg"],
		"layout_slots": ["navigation_rail", "category_tabs", "focus_panel", "setting_groups", "control_preview", "control_buttons", "row_window", "quick_routes"],
		"focus_sections": ["navigation_rail", "category_tabs", "focus_panel", "section_tabs", "setting_groups", "control_buttons", "quick_routes", "row_window"],
		"input_methods": ["keyboard", "gamepad", "mouse"],
		"text_fit_policy": ["clip_button_text", "ellipsis_overrun", "wrap_labels", "minimum_44x22_targets"],
		"state_regions": ["language", "input", "audio", "display", "storage"],
		"status_region_ids": ["input_profile_state", "gamepad_state", "audio_state", "display_state", "storage_state"],
		"focus_action_ids": ["settings_gamepad_curve", "settings_keybinds", "settings_volume", "settings_resolution"],
		"controller_actions": ["ui_up", "ui_down", "ui_left_control", "ui_right_control", "ui_accept", "category_tab", "status_card", "focus_action", "capture_binding", "reset_control"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "input_control_matrix",
		"focus_sections": ["navigation_rail", "category_tabs", "focus_panel", "section_tabs", "setting_groups", "control_buttons", "quick_routes", "row_window"],
		"state_regions": ["profile", "gamepad_curve", "speed_preview", "keybinds"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "audio_mixer",
		"focus_sections": ["navigation_rail", "category_tabs", "focus_panel", "section_tabs", "setting_groups", "control_buttons", "quick_routes", "row_window"],
		"state_regions": ["voice", "volume_sliders", "cue_toggles", "reset"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "display_option_panel",
		"focus_sections": ["navigation_rail", "category_tabs", "focus_panel", "section_tabs", "setting_groups", "control_buttons", "quick_routes", "row_window"],
		"state_regions": ["resolution", "window_mode", "frame_sync", "accessibility"],
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
		"visual_asset": "res://themes/base/ui/mode_card_frame.svg",
		"visual_treatment": "advanced_tool_panel",
		"state_regions": ["input", "display", "character", "stage", "analysis"],
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
		"visual_asset": "res://themes/base/ui/collection_card_frame.svg",
		"visual_treatment": "settlement_reward_panel",
		"state_regions": ["result", "score", "reward", "wallet", "replay", "retry"],
		"primary_row_ids": ["result", "score_breakdown", "reward", "wallet", "save_replay", "retry"],
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
	if _string_array(spec.get("overview_priority_ids", [])).is_empty():
		spec["overview_priority_ids"] = _string_array(spec.get("primary_row_ids", []))
	else:
		spec["overview_priority_ids"] = _string_array(spec.get("overview_priority_ids", []))
	spec["state_regions"] = _string_array(spec.get("state_regions", []))
	spec["status_region_ids"] = _string_array(spec.get("status_region_ids", []))
	spec["layout_slots"] = _string_array(spec.get("layout_slots", []))
	spec["controller_actions"] = _string_array(spec.get("controller_actions", []))
	spec["focus_action_ids"] = _string_array(spec.get("focus_action_ids", []))
	spec["asset_usage"] = _string_array(spec.get("asset_usage", []))
	spec["input_methods"] = _string_array(spec.get("input_methods", []))
	spec["focus_sections"] = _string_array(spec.get("focus_sections", []))
	spec["text_fit_policy"] = _string_array(spec.get("text_fit_policy", []))
	if _string_array(spec.get("status_region_ids", [])).is_empty():
		spec["status_region_ids"] = _string_array(spec.get("state_regions", []))
	if _string_array(spec.get("layout_slots", [])).is_empty():
		spec["layout_slots"] = _layout_slots_for_spec(spec)
	if _string_array(spec.get("controller_actions", [])).is_empty():
		spec["controller_actions"] = _controller_actions_for_spec(spec)
	if _string_array(spec.get("focus_action_ids", [])).is_empty():
		spec["focus_action_ids"] = _default_focus_action_ids(spec)
	if _string_array(spec.get("asset_usage", [])).is_empty() and not String(spec.get("visual_asset", "")).is_empty():
		spec["asset_usage"] = ["visual:%s:%s" % [String(spec.get("visual_treatment", "")), String(spec.get("visual_asset", ""))]]
	if _string_array(spec.get("input_methods", [])).is_empty():
		spec["input_methods"] = DEFAULT_INPUT_METHODS.duplicate()
	if _string_array(spec.get("focus_sections", [])).is_empty():
		spec["focus_sections"] = _focus_sections_for_spec(spec)
	if _string_array(spec.get("text_fit_policy", [])).is_empty():
		spec["text_fit_policy"] = DEFAULT_TEXT_FIT_POLICY.duplicate()
	spec["player_task_groups"] = _player_task_groups(source_screen, spec)
	spec["asset_license_required"] = not String(spec.get("visual_asset", "")).is_empty()
	spec["primary_count"] = _string_array(spec.get("primary_row_ids", [])).size()
	spec["secondary_count"] = _string_array(spec.get("secondary_row_ids", [])).size()
	spec["setting_group_count"] = _string_array(spec.get("setting_groups", [])).size()
	spec["social_group_count"] = _string_array(spec.get("social_groups", [])).size()
	spec["mode_group_count"] = _string_array(spec.get("mode_groups", [])).size()
	spec["player_task_count"] = _string_array(spec.get("player_task_groups", [])).size()
	spec["required_binding_count"] = _string_array(spec.get("required_bindings", [])).size()
	spec["render_slot_count"] = _string_array(spec.get("render_slots", [])).size()
	spec["state_region_count"] = _string_array(spec.get("state_regions", [])).size()
	spec["status_region_count"] = _string_array(spec.get("status_region_ids", [])).size()
	spec["layout_slot_count"] = _string_array(spec.get("layout_slots", [])).size()
	spec["controller_action_count"] = _string_array(spec.get("controller_actions", [])).size()
	spec["focus_action_count"] = _string_array(spec.get("focus_action_ids", [])).size()
	spec["asset_usage_count"] = _string_array(spec.get("asset_usage", [])).size()
	spec["input_method_count"] = _string_array(spec.get("input_methods", [])).size()
	spec["focus_section_count"] = _string_array(spec.get("focus_sections", [])).size()
	spec["text_fit_policy_count"] = _string_array(spec.get("text_fit_policy", [])).size()
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
	var incomplete: Array[String] = []
	for screen_id in PAGE_SPECS.keys():
		var screen_text := String(screen_id)
		var spec := page_spec(screen_text)
		var scene_id := _scene_id_for_screen(screen_text)
		var contract := scene_contract(scene_id)
		if String(contract.get("scene_path", "")).is_empty() or _string_array(contract.get("required_bindings", [])).is_empty():
			missing.append("%s:%s" % [screen_text, scene_id])
		if _string_array(spec.get("primary_row_ids", [])).is_empty() or _string_array(spec.get("player_task_groups", [])).is_empty() or _string_array(spec.get("state_regions", [])).is_empty():
			incomplete.append(screen_text)
	return {
		"ok": missing.is_empty() and incomplete.is_empty(),
		"missing": missing,
		"incomplete": incomplete,
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

func _layout_slots_for_spec(spec: Dictionary) -> Array[String]:
	var kind := String(spec.get("kind", ""))
	if DEFAULT_LAYOUT_SLOTS.has(kind):
		return _string_array(DEFAULT_LAYOUT_SLOTS[kind])
	var render_slots := _string_array(spec.get("render_slots", []))
	if not render_slots.is_empty():
		return render_slots
	return ["navigation_rail", "focus_panel", "row_window"]

func _controller_actions_for_spec(spec: Dictionary) -> Array[String]:
	var kind := String(spec.get("kind", ""))
	if kind == "settings":
		return SETTINGS_CONTROLLER_ACTIONS.duplicate()
	if kind in ["hub", "community", "collection", "matchmaking", "network_room", "mode_select"]:
		return HUB_CONTROLLER_ACTIONS.duplicate()
	return DEFAULT_CONTROLLER_ACTIONS.duplicate()

func _focus_sections_for_spec(spec: Dictionary) -> Array[String]:
	var kind := String(spec.get("kind", ""))
	match kind:
		"home_lobby":
			return ["primary_routes"]
		"settings":
			return ["navigation_rail", "category_tabs", "focus_panel", "section_tabs", "setting_groups", "control_buttons", "quick_routes", "row_window"]
		"community":
			return ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "social_tabs", "overview_cards", "quick_routes", "row_window"]
		"collection":
			return ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "filter_tabs", "overview_cards", "quick_routes", "row_window"]
		"matchmaking", "network_room":
			return ["category_tabs", "focus_panel", "mode_cards", "quick_routes", "row_window"]
		"hub", "mode_select":
			return ["navigation_rail", "category_tabs", "status_cards", "focus_panel", "section_tabs", "overview_cards", "quick_routes", "row_window"]
		"playfield", "battle_room":
			return []
	return ["navigation_rail", "focus_panel", "row_window"]

func _default_focus_action_ids(spec: Dictionary) -> Array[String]:
	var primary := _string_array(spec.get("primary_row_ids", []))
	var focus_ids: Array[String] = []
	for row_id in primary:
		if row_id.ends_with("_summary"):
			continue
		focus_ids.append(row_id)
		if focus_ids.size() >= 4:
			break
	return focus_ids

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
