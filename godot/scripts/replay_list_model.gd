class_name ReplayListModel
extends RefCounted

var replay_store: RefCounted = null
var entries: Array[Dictionary] = []
var cursor := 0
var status := "empty"
var action_status := "none"
var active_verification_filter := "all"

const VERIFICATION_FILTER_ALL := "all"
const VERIFICATION_FILTERS: Array[String] = [
	VERIFICATION_FILTER_ALL,
	"replay_boss_practice",
	"replay_local_ready",
	"replay_missing_hash",
	"replay_input_invalid",
	"replay_server_pending",
	"replay_metadata_invalid",
	"rejected_server_claim",
]

func configure(store: RefCounted) -> void:
	replay_store = store
	refresh()

func refresh() -> void:
	if replay_store == null:
		entries.clear()
		cursor = 0
		status = "empty"
		return
	entries = replay_store.load_index()
	if entries.is_empty():
		cursor = 0
		status = "empty"
		return
	cursor = clampi(cursor, 0, entries.size() - 1)
	_clamp_cursor_to_filter()
	status = "filtered_empty" if _filtered_indices().is_empty() else "ready"

func select(delta: int) -> bool:
	refresh()
	var indices := _filtered_indices()
	if indices.is_empty():
		return false
	var filtered_cursor := indices.find(cursor)
	if filtered_cursor < 0:
		filtered_cursor = 0
	cursor = indices[wrapi(filtered_cursor + delta, 0, indices.size())]
	status = "selected"
	return true

func select_index(index: int) -> bool:
	refresh()
	if entries.is_empty():
		return false
	cursor = clampi(index, 0, entries.size() - 1)
	status = "selected"
	return true

func selected_entry() -> Dictionary:
	if entries.is_empty():
		return {}
	var safe_cursor := clampi(cursor, 0, entries.size() - 1)
	if _entry_matches_active_filter(entries[safe_cursor]):
		return entries[safe_cursor]
	for index in _filtered_indices():
		return entries[index]
	return {}

func selected_path(default_path: String = "") -> String:
	var entry := selected_entry()
	return str(entry.get("path", default_path))

func selected_replay_id() -> String:
	var entry := selected_entry()
	return str(entry.get("replay_id", ""))

func selected_row() -> Dictionary:
	var entry := selected_entry()
	if entry.is_empty():
		return {}
	return _row_from_entry(entry, cursor)

func row_models(limit: int = 20) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var count: int = max(0, limit)
	if count == 0:
		return rows
	for i in range(entries.size()):
		if not _entry_matches_active_filter(entries[i]):
			continue
		rows.append(_row_from_entry(entries[i], i))
		if rows.size() >= count:
			break
	return rows

func verification_summary_row() -> Dictionary:
	var counts := _verification_counts()
	var local_ready := int(counts.get("replay_local_ready", 0))
	var missing_hash := int(counts.get("replay_missing_hash", 0))
	var input_invalid := int(counts.get("replay_input_invalid", 0))
	var server_pending := int(counts.get("replay_server_pending", 0))
	var metadata_invalid := int(counts.get("replay_metadata_invalid", 0))
	var rejected_server_claim := int(counts.get("rejected_server_claim", 0))
	var boss_practice := int(counts.get("replay_boss_practice", 0))
	var filtered_indices := _filtered_indices()
	var selected := selected_entry()
	var selected_source_index := _source_index_for_replay_id(str(selected.get("replay_id", "")))
	var selected_filtered_index := filtered_indices.find(selected_source_index)
	var selected_row_model := _row_from_entry(selected, selected_source_index) if not selected.is_empty() and selected_source_index >= 0 else {}
	return {
		"id": "replay_verification_summary",
		"label_key": "screen.main.replay",
		"value": "filter %s boss %d local %d missing %d input %d server %d invalid %d" % [active_verification_filter, boss_practice, local_ready, missing_hash, input_invalid, server_pending, metadata_invalid],
		"summary": "verification filter=%s boss_practice=%d local_ready=%d missing_hash=%d input_invalid=%d server_pending=%d metadata_invalid=%d rejected_server_claim=%d visible=%d" % [active_verification_filter, boss_practice, local_ready, missing_hash, input_invalid, server_pending, metadata_invalid, rejected_server_claim, _filtered_indices().size()],
		"entry_count": entries.size(),
		"visible_entry_count": filtered_indices.size(),
		"active_verification_filter": active_verification_filter,
		"filter_empty": filtered_indices.is_empty(),
		"selected_replay_id": str(selected.get("replay_id", "")),
		"selected_source_index": selected_source_index,
		"selected_filtered_index": selected_filtered_index + 1 if selected_filtered_index >= 0 else 0,
		"filter_navigation_label": _filter_navigation_label(selected_filtered_index, filtered_indices.size()),
		"selected_verification_status": String(selected_row_model.get("verification_status", "none")),
		"selected_verification_section": String(selected_row_model.get("section", "")),
		"selected_local_load_policy": String(selected_row_model.get("local_load_policy", "none")),
		"selected_load_guard_reason": String(selected_row_model.get("local_load_guard_reason", "")),
		"selected_requires_server_audit": bool(selected_row_model.get("requires_server_audit", false)),
		"selected_can_play": bool(selected_row_model.get("can_play", false)),
		"local_ready_count": local_ready,
		"missing_final_hash_count": missing_hash,
		"input_invalid_count": input_invalid,
		"server_pending_audit_count": server_pending,
		"metadata_invalid_count": metadata_invalid,
		"rejected_server_claim_count": rejected_server_claim,
		"boss_practice_count": boss_practice,
		"server_authoritative": false,
		"local_hash_authority": "local_practice_verification_only",
		"damage_authority": "server",
		"settlement_authority": "server",
		"reward_authority": "server",
		"client_result_authoritative": false,
		"section": "overview",
		"section_label_key": "ui.menu_section_overview",
		"ui_control": "status",
		"ui_action": "",
		"enabled": true,
	}

func verification_filter_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	var counts := _verification_counts()
	for filter_id in VERIFICATION_FILTERS:
		var is_all := filter_id == VERIFICATION_FILTER_ALL
		var count := entries.size() if is_all else int(counts.get(filter_id, 0))
		var active := filter_id == active_verification_filter
		var filter_card_metrics: Array[Dictionary] = [
			{"id": "entries", "label": "entries", "value": count},
			{"id": "active", "label": "active", "value": active},
			{"id": "visible", "label": "visible", "value": _filtered_indices().size() if active else count},
		]
		rows.append({
			"id": "replay_filter_%s" % filter_id,
			"label_key": _verification_filter_label_key(filter_id),
			"value": "%s %d" % ["active" if active else "show", count],
			"summary": "local replay display filter only; server audit authority unchanged",
			"verification_filter": filter_id,
			"active": active,
			"entry_count": count,
			"filter_card_kind": "replay_verification_filter",
			"filter_card_title_key": _verification_filter_label_key(filter_id),
			"filter_card_primary_metric": "entries %d" % count,
			"filter_card_secondary_metric": "active %s visible %d" % ["yes" if active else "no", _filtered_indices().size() if active else count],
			"filter_card_metrics": filter_card_metrics,
			"filter_card_authority_badges": ["local_practice_verification_only", "server_audit_required_for_online", "damage_server", "reward_server", "settlement_server"],
			"filter_card_action_hint": "apply local replay list filter only",
			"overview_card_kind": "replay_verification_filter",
			"render_slot": "filter_tabs",
			"server_authoritative": false,
			"local_hash_authority": "local_practice_verification_only",
			"damage_authority": "server",
			"settlement_authority": "server",
			"reward_authority": "server",
			"client_result_authoritative": false,
			"section": "overview",
			"section_label_key": "ui.menu_section_overview",
			"ui_control": "button",
			"ui_action": "set_replay_filter",
			"enabled": true,
		})
	return rows

func replay_authority_summary_row() -> Dictionary:
	var counts := _verification_counts()
	var playability := _playability_counts()
	var selected := selected_entry()
	var selected_source_index := _source_index_for_replay_id(str(selected.get("replay_id", "")))
	var selected_row_model := _row_from_entry(selected, selected_source_index) if not selected.is_empty() and selected_source_index >= 0 else {}
	var selected_guard := local_load_guard_for_entry(selected) if not selected.is_empty() else _replay_action_guard({})
	var rejected_claim_fields := _rejected_server_authority_claim_fields()
	return {
		"id": "replay_authority_summary",
		"label_key": "screen.results.audit",
		"value": "local %d server-audit %d blocked %d claims %d" % [
			int(playability.get("local_loadable_count", 0)),
			int(playability.get("server_audit_required_count", 0)),
			int(playability.get("blocked_local_integrity_count", 0)),
			int(counts.get("rejected_server_claim", 0)),
		],
		"summary": "Replay playback is local-practice verification only; online replay records, Boss damage, rewards, and settlement require server audit authority",
		"entry_count": entries.size(),
		"local_loadable_count": int(playability.get("local_loadable_count", 0)),
		"server_audit_required_count": int(playability.get("server_audit_required_count", 0)),
		"blocked_local_integrity_count": int(playability.get("blocked_local_integrity_count", 0)),
		"rejected_server_claim_count": int(counts.get("rejected_server_claim", 0)),
		"rejected_server_claim_field_count": rejected_claim_fields.size(),
		"rejected_server_claim_fields": rejected_claim_fields,
		"server_pending_audit_count": int(counts.get("replay_server_pending", 0)),
		"boss_practice_count": int(counts.get("replay_boss_practice", 0)),
		"selected_replay_id": str(selected.get("replay_id", "")),
		"selected_local_load_policy": String(selected_row_model.get("local_load_policy", "none")),
		"selected_server_audit_status": String(selected_row_model.get("server_audit_status", "not_required")),
		"selected_requires_server_audit": bool(selected_row_model.get("requires_server_audit", false)),
		"selected_server_authority_claim_fields": (selected_guard.get("server_authority_claim_fields", []) as Array).duplicate(),
		"selected_guard": selected_guard,
		"authority_contract_kind": "replay_local_display_server_audit_summary",
		"server_authoritative": false,
		"local_hash_authority": "local_practice_verification_only",
		"replay_verification_scope": "local_practice_hash",
		"local_playback_authority": "local_practice_hash",
		"online_replay_authority": "server_audit_required",
		"damage_authority": "server",
		"settlement_authority": "server",
		"reward_authority": "server",
		"boss_hp_authority": "server",
		"client_result_authoritative": false,
		"section": "overview",
		"section_label_key": "ui.menu_section_overview",
		"ui_control": "status",
		"ui_action": "",
		"enabled": true,
	}

func replay_playability_summary_row() -> Dictionary:
	var playability := _playability_counts()
	var selected := selected_entry()
	var selected_source_index := _source_index_for_replay_id(str(selected.get("replay_id", "")))
	var selected_row_model := _row_from_entry(selected, selected_source_index) if not selected.is_empty() and selected_source_index >= 0 else {}
	var selected_guard := local_load_guard_for_entry(selected) if not selected.is_empty() else _replay_action_guard({})
	var recommended_filter := _recommended_filter_for_guard(selected_guard)
	if String(selected_guard.get("reason", "")) == "no_replay_selected" and int(playability.get("local_loadable_count", 0)) > 0:
		recommended_filter = "replay_local_ready"
	var selected_can_play := bool(selected_guard.get("ok", false)) and not bool(selected_guard.get("requires_server_audit", false))
	return {
		"id": "replay_playability_summary",
		"label_key": "screen.replay.load",
		"value": "selected %s local %d audit %d blocked %d next %s" % [
			"playable" if selected_can_play else "blocked",
			int(playability.get("local_loadable_count", 0)),
			int(playability.get("server_audit_required_count", 0)),
			int(playability.get("blocked_local_integrity_count", 0)),
			recommended_filter,
		],
		"summary": "selected replay local playback guard; only local-practice hashes can load, online records stay server-audited",
		"entry_count": entries.size(),
		"local_loadable_count": int(playability.get("local_loadable_count", 0)),
		"server_audit_required_count": int(playability.get("server_audit_required_count", 0)),
		"blocked_local_integrity_count": int(playability.get("blocked_local_integrity_count", 0)),
		"first_loadable_replay_id": String(playability.get("first_loadable_replay_id", "")),
		"first_server_audit_replay_id": String(playability.get("first_server_audit_replay_id", "")),
		"first_blocked_integrity_replay_id": String(playability.get("first_blocked_integrity_replay_id", "")),
		"selected_replay_id": String(selected_row_model.get("replay_id", "")),
		"selected_can_play": selected_can_play,
		"selected_local_load_policy": String(selected_guard.get("local_load_policy", "none")),
		"selected_load_guard_reason": String(selected_guard.get("reason", "")),
		"selected_verification_status": String(selected_guard.get("verification_status", "none")),
		"selected_verification_section": String(selected_guard.get("verification_section", "")),
		"selected_requires_server_audit": bool(selected_guard.get("requires_server_audit", false)),
		"selected_server_audit_status": String(selected_guard.get("server_audit_status", "not_required")),
		"recommended_filter": recommended_filter,
		"recommended_filter_row_id": "replay_filter_%s" % recommended_filter if not recommended_filter.is_empty() else "",
		"replay_action_guard": selected_guard,
		"server_authoritative": false,
		"local_hash_authority": "local_practice_verification_only",
		"replay_verification_scope": "local_practice_hash",
		"local_playback_authority": String(selected_guard.get("local_playback_authority", "none")),
		"online_replay_authority": "server_audit_required",
		"damage_authority": "server",
		"settlement_authority": "server",
		"reward_authority": "server",
		"boss_hp_authority": "server",
		"client_result_authoritative": false,
		"section": "overview",
		"section_label_key": "ui.menu_section_overview",
		"ui_control": "status",
		"ui_action": "",
		"enabled": true,
	}

func boss_practice_verification_summary_row() -> Dictionary:
	var boss_rows: Array[Dictionary] = []
	for i in range(entries.size()):
		if not _is_boss_spellbook_practice_entry(entries[i]):
			continue
		boss_rows.append(_row_from_entry(entries[i], i))
	var ready_count := 0
	var invalid_count := 0
	var server_claim_count := 0
	var rejected_claim_fields: Array[String] = []
	var rejected_claim_seen := {}
	for row in boss_rows:
		if bool(row.get("can_play", false)) and String(row.get("verification_scope", "")) == "local_practice_hash":
			ready_count += 1
		if String(row.get("section", "")) == "replay_metadata_invalid":
			invalid_count += 1
		if String(row.get("verification_scope", "")) == "rejected_server_claim":
			server_claim_count += 1
			for field in row.get("server_authority_claim_fields", []):
				var field_id := String(field)
				if field_id.is_empty() or rejected_claim_seen.has(field_id):
					continue
				rejected_claim_seen[field_id] = true
				rejected_claim_fields.append(field_id)
	rejected_claim_fields.sort()
	var selected_boss_row := _selected_or_first_boss_practice_row(boss_rows)
	var boss_context: Dictionary = selected_boss_row.get("boss_practice_verification", {}) if not selected_boss_row.is_empty() else {}
	var selected_requires_server_audit := bool(selected_boss_row.get("requires_server_audit", false))
	var selected_can_play := bool(selected_boss_row.get("can_play", false))
	var selected_claim_fields: Array = selected_boss_row.get("server_authority_claim_fields", []) if not selected_boss_row.is_empty() else []
	var recommended_filter := "all"
	if server_claim_count > 0:
		recommended_filter = "rejected_server_claim"
	elif ready_count > 0:
		recommended_filter = "replay_boss_practice"
	elif invalid_count > 0:
		recommended_filter = "replay_metadata_invalid"
	var verification_card_metrics: Array[Dictionary] = [
		{"id": "ready", "label": "ready", "value": ready_count},
		{"id": "invalid", "label": "invalid", "value": invalid_count},
		{"id": "server_claims", "label": "server claims", "value": server_claim_count},
		{"id": "server_claim_fields", "label": "server claim fields", "value": rejected_claim_fields.size()},
		{"id": "digest", "label": "digest", "value": int(boss_context.get("preview_bundle_signature_digest", 0))},
	]
	var status_cards := _boss_practice_status_cards(
		ready_count,
		invalid_count,
		server_claim_count,
		rejected_claim_fields,
		selected_boss_row,
		boss_context
	)
	return {
		"id": "replay_boss_practice_verification",
		"label_key": "screen.settings.boss_spellbook",
		"value": "boss practice %d ready %d invalid %d digest %d" % [
			boss_rows.size(),
			ready_count,
			invalid_count,
			int(boss_context.get("preview_bundle_signature_digest", 0)),
		],
		"summary": "Boss spellbook practice Replay verification is local hash/golden-fixture display only; online damage, rewards, hp, and settlement stay server-authoritative",
		"boss_practice_entry_count": boss_rows.size(),
		"boss_practice_ready_count": ready_count,
		"boss_practice_invalid_count": invalid_count,
		"boss_practice_rejected_server_claim_count": server_claim_count,
		"boss_practice_rejected_server_claim_field_count": rejected_claim_fields.size(),
		"boss_practice_rejected_server_claim_fields": rejected_claim_fields,
		"selected_replay_id": String(selected_boss_row.get("replay_id", "")),
		"selected_verification_status": String(selected_boss_row.get("verification_status", "none")),
		"selected_local_load_policy": String(selected_boss_row.get("local_load_policy", "none")),
		"selected_can_play": selected_can_play,
		"selected_requires_server_audit": selected_requires_server_audit,
		"selected_server_audit_status": String(selected_boss_row.get("server_audit_status", "not_required")),
		"selected_local_playback_authority": String(selected_boss_row.get("local_playback_authority", "none")),
		"selected_replay_authority_scope": String(selected_boss_row.get("replay_authority_scope", "none")),
		"selected_load_guard_reason": String(selected_boss_row.get("local_load_guard_reason", "")),
		"selected_server_authority_claim_fields": selected_claim_fields.duplicate(),
		"boss_practice_verification": boss_context,
		"preview_bundle_id": String(boss_context.get("preview_bundle_id", "")),
		"preview_bundle_signature_digest": int(boss_context.get("preview_bundle_signature_digest", 0)),
		"preview_phase_count": int(boss_context.get("preview_phase_count", 0)),
		"preview_fixture_id": String(boss_context.get("preview_fixture_id", "")),
		"preview_seed": int(boss_context.get("preview_seed", 0)),
		"performance_budget_status": String(boss_context.get("performance_budget_status", "")),
		"server_authoritative": false,
		"local_hash_authority": "local_practice_verification_only",
		"replay_verification_scope": "local_practice_hash",
		"local_playback_authority": "local_practice_hash",
		"online_replay_authority": "server_audit_required",
		"settlement_authority": "server",
		"reward_authority": "server",
		"damage_authority": "server",
		"boss_hp_authority": "server",
		"overview_card_kind": "boss_practice_replay_verification",
		"render_slot": "overview_cards",
		"recommended_filter": recommended_filter,
		"recommended_filter_row_id": "replay_filter_%s" % recommended_filter if recommended_filter != "all" else "replay_filter_all",
		"boss_practice_status_cards": status_cards,
		"verification_card_metrics": verification_card_metrics,
		"verification_card_primary_metric": "ready %d/%d" % [ready_count, boss_rows.size()],
		"verification_card_secondary_metric": "invalid %d claims %d digest %d" % [
			invalid_count,
			server_claim_count,
			int(boss_context.get("preview_bundle_signature_digest", 0)),
		],
		"verification_card_authority_badges": [
			"local_practice_verification_only",
			"online_replay_server_audit",
			"boss_hp_server",
			"settlement_server",
		],
		"client_result_authoritative": false,
		"section": "overview",
		"section_label_key": "ui.menu_section_overview",
		"ui_control": "status",
		"ui_action": "",
		"enabled": true,
	}

func _boss_practice_status_cards(ready_count: int, invalid_count: int, server_claim_count: int, rejected_claim_fields: Array[String], selected_boss_row: Dictionary, boss_context: Dictionary) -> Array[Dictionary]:
	var selected_replay_id := String(selected_boss_row.get("replay_id", ""))
	var selected_guard_reason := String(selected_boss_row.get("local_load_guard_reason", ""))
	return [
		{
			"id": "boss_practice_status_local_ready",
			"label_key": "ui.menu_section_replay_local_ready",
			"value": "ready %d" % ready_count,
			"summary": "Boss practice Replays with local hash verification can load for practice playback only",
			"status_card_kind": "boss_practice_replay_status",
			"verification_filter": "replay_boss_practice",
			"recommended_filter_row_id": "replay_filter_replay_boss_practice",
			"entry_count": ready_count,
			"selected_replay_id": selected_replay_id,
			"selected_can_play": bool(selected_boss_row.get("can_play", false)),
			"selected_local_playback_authority": String(selected_boss_row.get("local_playback_authority", "none")),
			"preview_bundle_signature_digest": int(boss_context.get("preview_bundle_signature_digest", 0)),
			"ui_control": "card",
			"ui_action": "set_replay_filter",
			"render_slot": "overview_cards",
			"server_authoritative": false,
			"local_hash_authority": "local_practice_verification_only",
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"client_result_authoritative": false,
			"enabled": ready_count > 0,
		},
		{
			"id": "boss_practice_status_metadata_invalid",
			"label_key": "ui.menu_section_replay_metadata_invalid",
			"value": "invalid %d" % invalid_count,
			"summary": "Boss practice Replays with stale or missing preview metadata stay blocked locally",
			"status_card_kind": "boss_practice_replay_status",
			"verification_filter": "replay_metadata_invalid",
			"recommended_filter_row_id": "replay_filter_replay_metadata_invalid",
			"entry_count": invalid_count,
			"selected_replay_id": selected_replay_id,
			"selected_load_guard_reason": selected_guard_reason,
			"ui_control": "card",
			"ui_action": "set_replay_filter",
			"render_slot": "overview_cards",
			"server_authoritative": false,
			"local_hash_authority": "local_practice_verification_only",
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"client_result_authoritative": false,
			"enabled": invalid_count > 0,
		},
		{
			"id": "boss_practice_status_server_claim_rejected",
			"label_key": "ui.menu_section_replay_rejected_server_claim",
			"value": "claims %d fields %d" % [server_claim_count, rejected_claim_fields.size()],
			"summary": "Boss practice Replay entries that claim damage, hp, reward, or settlement authority require server audit and cannot load locally",
			"status_card_kind": "boss_practice_replay_status",
			"verification_filter": "rejected_server_claim",
			"recommended_filter_row_id": "replay_filter_rejected_server_claim",
			"entry_count": server_claim_count,
			"rejected_server_claim_fields": rejected_claim_fields.duplicate(),
			"selected_replay_id": selected_replay_id,
			"selected_requires_server_audit": bool(selected_boss_row.get("requires_server_audit", false)),
			"selected_server_audit_status": String(selected_boss_row.get("server_audit_status", "not_required")),
			"ui_control": "card",
			"ui_action": "set_replay_filter",
			"render_slot": "overview_cards",
			"server_authoritative": false,
			"local_hash_authority": "local_practice_verification_only",
			"damage_authority": "server",
			"reward_authority": "server",
			"settlement_authority": "server",
			"client_result_authoritative": false,
			"enabled": server_claim_count > 0,
		},
	]

func selected_action_rows() -> Array[Dictionary]:
	var entry := selected_entry()
	var replay_id := str(entry.get("replay_id", ""))
	var has_replay := not replay_id.is_empty()
	var source_index := _source_index_for_replay_id(replay_id)
	var selected_row_model := _row_from_entry(entry, source_index) if has_replay and source_index >= 0 else {}
	var action_context := _selected_action_context(selected_row_model)
	var practice_validation := _practice_validation_context(selected_row_model)
	return [
		{
			"id": "replay_action_load",
			"label_key": "screen.replay.load",
			"value": String(selected_row_model.get("local_load_policy", "none")),
			"summary": "load selected local-practice replay only; server-authoritative records require audit",
			"replay_id": replay_id,
			"path": String(selected_row_model.get("path", "")),
			"source_index": source_index,
			"verification_status": String(selected_row_model.get("verification_status", "none")),
			"verification_section": String(selected_row_model.get("section", "")),
			"local_load_policy": String(selected_row_model.get("local_load_policy", "none")),
			"local_load_guard_reason": String(selected_row_model.get("local_load_guard_reason", "")),
			"requires_server_audit": bool(selected_row_model.get("requires_server_audit", false)),
			"can_play": bool(selected_row_model.get("can_play", false)),
			"practice_validation": practice_validation,
			"server_authoritative": false,
			"local_hash_authority": "local_practice_verification_only",
			"damage_authority": "server",
			"settlement_authority": "server",
			"reward_authority": "server",
			"client_result_authoritative": false,
			"section": "overview",
			"section_label_key": "ui.menu_section_overview",
			"ui_control": "replay",
			"ui_action": "load_replay",
			"enabled": has_replay and bool(selected_row_model.get("can_play", false)),
		}.merged(action_context, true),
		{
			"id": "replay_action_favorite",
			"label_key": "screen.replay.favorite",
			"value": "on" if bool(entry.get("favorite", false)) else "off",
			"summary": "toggle local replay index favorite marker",
			"replay_id": replay_id,
			"source_index": source_index,
			"practice_validation": practice_validation,
			"server_authoritative": false,
			"local_hash_authority": "local_practice_verification_only",
			"damage_authority": "server",
			"settlement_authority": "server",
			"reward_authority": "server",
			"client_result_authoritative": false,
			"section": "overview",
			"section_label_key": "ui.menu_section_overview",
			"ui_control": "button",
			"ui_action": "toggle_replay_favorite",
			"enabled": has_replay,
		}.merged(action_context, true),
		{
			"id": "replay_action_remove",
			"label_key": "screen.replay.remove",
			"value": "index only",
			"summary": "remove selected replay from local index; replay file remains untouched",
			"replay_id": replay_id,
			"source_index": source_index,
			"practice_validation": practice_validation,
			"server_authoritative": false,
			"local_hash_authority": "local_practice_verification_only",
			"damage_authority": "server",
			"settlement_authority": "server",
			"reward_authority": "server",
			"client_result_authoritative": false,
			"section": "overview",
			"section_label_key": "ui.menu_section_overview",
			"ui_control": "button",
			"ui_action": "remove_replay_from_index",
			"enabled": has_replay,
		}.merged(action_context, true),
	]

func request_selected_local_load() -> Dictionary:
	var entry := selected_entry()
	if entry.is_empty():
		action_status = "load_blocked"
		return _local_load_request_result({}, {}, {}, false, "no_replay_selected")
	var replay_id := String(entry.get("replay_id", ""))
	var source_index := _source_index_for_replay_id(replay_id)
	var selected_row_model := _row_from_entry(entry, source_index) if source_index >= 0 else {}
	var guard := _replay_action_guard(selected_row_model)
	if not bool(guard.get("ok", false)):
		action_status = "load_blocked"
		return _local_load_request_result(entry, selected_row_model, guard, false, String(guard.get("reason", "load_rejected")))
	var path := String(selected_row_model.get("path", entry.get("path", "")))
	if path.is_empty():
		action_status = "load_blocked"
		return _local_load_request_result(entry, selected_row_model, guard, false, "missing_path")
	if not FileAccess.file_exists(path):
		action_status = "load_blocked"
		return _local_load_request_result(entry, selected_row_model, guard, false, "file_missing")
	action_status = "load_ready"
	return _local_load_request_result(entry, selected_row_model, guard, true, "load_ready")

func set_verification_filter(filter_id: String) -> bool:
	if not VERIFICATION_FILTERS.has(filter_id):
		action_status = "filter_failed"
		return false
	active_verification_filter = filter_id
	_clamp_cursor_to_filter()
	action_status = "filter"
	status = "filtered_empty" if _filtered_indices().is_empty() else "selected"
	return true

func selected_summary() -> String:
	var row := selected_row()
	if row.is_empty():
		return "-"
	var favorite_mark := "*" if bool(row.get("favorite", false)) else "-"
	return "%d/%d %s %s %s %s score %d v%s" % [
		int(row.get("index", 0)),
		entries.size(),
		favorite_mark,
		str(row.get("saved_at", "")),
		str(row.get("mode", "")),
		str(row.get("result", "")),
		int(row.get("score", 0)),
		str(row.get("version", "")),
	]

func toggle_selected_favorite() -> bool:
	if entries.is_empty():
		action_status = "empty"
		return false
	var replay_id := selected_replay_id()
	if replay_id.is_empty() or replay_store == null:
		action_status = "failed"
		return false
	var ok: bool = replay_store.toggle_favorite(replay_id)
	action_status = "favorite" if ok else "failed"
	refresh()
	return ok

func remove_selected_from_index() -> bool:
	if entries.is_empty():
		action_status = "empty"
		return false
	var replay_id := selected_replay_id()
	if replay_id.is_empty() or replay_store == null:
		action_status = "failed"
		return false
	var ok: bool = replay_store.remove_from_index(replay_id)
	action_status = "removed" if ok else "failed"
	refresh()
	return ok

func _row_from_entry(entry: Dictionary, index: int) -> Dictionary:
	var path := str(entry.get("path", ""))
	var metadata_valid := _entry_metadata_valid(entry)
	var metadata_failures := _entry_metadata_failures(entry, metadata_valid)
	var server_claim_fields := _entry_server_authority_claim_fields(entry)
	var final_result_hash := int(entry.get("final_result_hash", 0))
	var server_authoritative := bool(entry.get("server_authoritative", false))
	var input_integrity_status := _entry_input_integrity_status(entry)
	var verification_status := _entry_verification_status(entry, final_result_hash, metadata_valid)
	var load_rejection_reason := _entry_local_load_rejection_reason(entry, verification_status, metadata_valid, server_authoritative, server_claim_fields)
	var replay_authority_scope := "server_authoritative_record" if server_authoritative else "local_practice_record"
	var rejected_server_claim := not server_claim_fields.is_empty()
	var requires_server_audit := server_authoritative or rejected_server_claim or _entry_verification_section(verification_status) == "replay_server_pending"
	var local_load_policy := "blocked_server_audit" if requires_server_audit else ("blocked_local_integrity" if not load_rejection_reason.is_empty() else "loadable_local_practice")
	var filtered_indices := _filtered_indices()
	var filtered_index := filtered_indices.find(index)
	var row := {
		"index": index + 1,
		"source_index": index,
		"filtered_index": filtered_index + 1 if filtered_index >= 0 else 0,
		"filtered_count": filtered_indices.size(),
		"selected_in_filter": index == cursor and filtered_index >= 0,
		"active_verification_filter": active_verification_filter,
		"filter_navigation_label": _filter_navigation_label(filtered_index, filtered_indices.size()),
		"replay_id": str(entry.get("replay_id", "")),
		"path": path,
		"saved_at": str(entry.get("saved_at", "")),
		"opponent": str(entry.get("opponent", entry.get("pattern_id", "local"))),
		"mode": str(entry.get("mode", "local_practice")),
		"result": str(entry.get("result", "practice")),
		"score": int(entry.get("score", 0)),
		"version": str(entry.get("ruleset_version", "")),
		"game_version": str(entry.get("game_version", "")),
		"final_tick": int(entry.get("final_tick", 0)),
		"final_result_hash": final_result_hash,
		"can_verify_final_hash": final_result_hash != 0 and int(entry.get("final_tick", 0)) >= 0,
		"input_count": int(entry.get("input_count", 0)),
		"input_first_tick": int(entry.get("input_first_tick", -1)),
		"input_last_tick": int(entry.get("input_last_tick", -1)),
		"input_tick_span": int(entry.get("input_tick_span", 0)),
		"input_tick_monotonic": bool(entry.get("input_tick_monotonic", false)),
		"input_tick_contiguous": bool(entry.get("input_tick_contiguous", false)),
		"input_integrity_status": input_integrity_status,
		"verification_status": verification_status,
		"verification_scope": _entry_verification_scope(entry, server_authoritative, metadata_valid, server_claim_fields),
		"verification_summary": _entry_verification_summary(entry, verification_status, metadata_valid, server_authoritative, server_claim_fields),
		"section": _entry_verification_section(verification_status),
		"section_label_key": _entry_verification_section_label_key(verification_status),
		"replay_authority_scope": replay_authority_scope,
		"local_load_policy": local_load_policy,
		"local_load_guard_reason": load_rejection_reason,
		"requires_server_audit": requires_server_audit,
		"server_audit_status": "pending" if requires_server_audit else "not_required",
		"local_playback_authority": "server_audit_required" if requires_server_audit else "local_practice_hash",
		"local_hash_authority": "local_practice_verification_only",
		"damage_authority": "server",
		"settlement_authority": "server",
		"reward_authority": "server",
		"client_result_authoritative": false,
		"favorite": bool(entry.get("favorite", false)),
		"pattern_id": str(entry.get("pattern_id", "")),
		"catalog_id": str(entry.get("catalog_id", "")),
		"spellbook_id": str(entry.get("spellbook_id", "")),
		"phase_id": str(entry.get("phase_id", "")),
		"preview_seed": int(entry.get("preview_seed", entry.get("match_seed", 0))),
		"preview_export_schema_version": int(entry.get("preview_export_schema_version", 0)),
		"preview_bundle_id": str(entry.get("preview_bundle_id", "")),
		"preview_bundle_signature_digest": int(entry.get("preview_bundle_signature_digest", 0)),
		"preview_phase_count": int(entry.get("preview_phase_count", 0)),
		"preview_phase_ids": (entry.get("preview_phase_ids", []) as Array).duplicate(),
		"preview_phase_signature_digests": (entry.get("preview_phase_signature_digests", []) as Array).duplicate(),
		"preview_bundle_max_emit_per_tick": int(entry.get("preview_bundle_max_emit_per_tick", 0)),
		"preview_bundle_min_budget_headroom": int(entry.get("preview_bundle_min_budget_headroom", 0)),
		"preview_bundle_budget_status": str(entry.get("preview_bundle_budget_status", "")),
		"preview_export_id": str(entry.get("preview_export_id", "")),
		"preview_authority_scope": str(entry.get("preview_authority_scope", "")),
		"preview_fixture_id": str(entry.get("preview_fixture_id", "")),
		"preview_signature_digest": int(entry.get("preview_signature_digest", 0)),
		"preview_sample_ticks": (entry.get("preview_sample_ticks", []) as Array).duplicate(),
		"preview_sample_window_start_tick": int(entry.get("preview_sample_window_start_tick", 0)),
		"preview_sample_window_end_tick": int(entry.get("preview_sample_window_end_tick", 0)),
		"preview_sample_window_stride_ticks": int(entry.get("preview_sample_window_stride_ticks", 0)),
		"preview_sample_signature_digests": (entry.get("preview_sample_signature_digests", []) as Array).duplicate(),
		"preview_sample_emit_counts": (entry.get("preview_sample_emit_counts", []) as Array).duplicate(),
		"preview_sample_count": int(entry.get("preview_sample_count", 0)),
		"preview_max_emit_per_tick": int(entry.get("preview_max_emit_per_tick", 0)),
		"preview_bullet_cap_per_tick": int(entry.get("preview_bullet_cap_per_tick", 0)),
		"preview_budget_headroom": int(entry.get("preview_budget_headroom", 0)),
		"performance_budget_status": str(entry.get("performance_budget_status", "")),
		"boss_practice_verification": _boss_practice_verification_context(entry, verification_status, metadata_valid, server_authoritative, server_claim_fields, load_rejection_reason),
		"metadata_valid": metadata_valid,
		"metadata_status": _entry_metadata_status(entry, metadata_valid),
		"metadata_failures": metadata_failures,
		"metadata_failure_count": metadata_failures.size(),
		"server_authoritative": server_authoritative,
		"server_authority_claim_fields": server_claim_fields,
		"can_play": load_rejection_reason.is_empty(),
		"load_rejection_reason": load_rejection_reason,
		"can_favorite": not str(entry.get("replay_id", "")).is_empty(),
		"can_remove": not str(entry.get("replay_id", "")).is_empty(),
		"enabled": load_rejection_reason.is_empty(),
	}
	row["practice_validation"] = _practice_validation_context(row)
	return row

func _practice_validation_context(row: Dictionary) -> Dictionary:
	if row.is_empty():
		return {
			"contract_kind": "replay_practice_validation",
			"ok": false,
			"reason": "no_replay_selected",
			"replay_id": "",
			"verification_status": "none",
			"verification_scope": "none",
			"local_load_policy": "none",
			"final_hash_required": true,
			"final_hash_ready": false,
			"practice_validation_gates": [],
			"practice_validation_gate_count": 0,
			"can_play": false,
			"requires_server_audit": false,
			"local_playback_authority": "none",
			"online_replay_authority": "server_audit_required",
			"damage_authority": "server",
			"settlement_authority": "server",
			"reward_authority": "server",
			"boss_hp_authority": "server",
			"client_result_authoritative": false,
		}
	var requires_server_audit := bool(row.get("requires_server_audit", false))
	var final_hash_ready := bool(row.get("can_verify_final_hash", false)) and int(row.get("final_result_hash", 0)) != 0
	var can_play := bool(row.get("can_play", false)) and not requires_server_audit and final_hash_ready
	var gates: Array[String] = [
		"metadata_valid",
		"input_integrity_valid_or_preview",
		"final_hash_present",
		"server_audit_not_required",
	]
	return {
		"contract_kind": "replay_practice_validation",
		"ok": can_play,
		"reason": "local_practice_hash_ready" if can_play else String(row.get("local_load_guard_reason", row.get("load_rejection_reason", "blocked"))),
		"replay_id": String(row.get("replay_id", "")),
		"verification_status": String(row.get("verification_status", "")),
		"verification_scope": String(row.get("verification_scope", "")),
		"verification_section": String(row.get("section", "")),
		"final_tick": int(row.get("final_tick", 0)),
		"final_result_hash": int(row.get("final_result_hash", 0)),
		"can_verify_final_hash": bool(row.get("can_verify_final_hash", false)),
		"final_hash_required": true,
		"final_hash_ready": final_hash_ready,
		"practice_validation_gates": gates,
		"practice_validation_gate_count": gates.size(),
		"input_integrity_status": String(row.get("input_integrity_status", "")),
		"input_count": int(row.get("input_count", 0)),
		"input_tick_span": int(row.get("input_tick_span", 0)),
		"metadata_status": String(row.get("metadata_status", "")),
		"local_load_policy": String(row.get("local_load_policy", "none")),
		"can_play": can_play,
		"requires_server_audit": requires_server_audit,
		"server_audit_status": String(row.get("server_audit_status", "not_required")),
		"local_playback_authority": String(row.get("local_playback_authority", "none")),
		"local_hash_authority": "local_practice_verification_only",
		"online_replay_authority": "server_audit_required",
		"damage_authority": "server",
		"settlement_authority": "server",
		"reward_authority": "server",
		"boss_hp_authority": "server",
		"client_result_authoritative": false,
	}

func _entry_metadata_valid(entry: Dictionary) -> bool:
	if replay_store != null and replay_store.has_method("validate_index_metadata"):
		var entries_to_validate: Array[Dictionary] = [entry]
		var result: Dictionary = replay_store.validate_index_metadata(entries_to_validate)
		return bool(result.get("ok", false))
	return true

func _boss_practice_verification_context(entry: Dictionary, verification_status: String, metadata_valid: bool, server_authoritative: bool, server_claim_fields: Array[String], load_rejection_reason: String) -> Dictionary:
	if not _is_boss_spellbook_practice_entry(entry):
		return {}
	var no_server_claims := not server_authoritative and server_claim_fields.is_empty()
	var requires_server_audit := server_authoritative or not server_claim_fields.is_empty()
	var loadable := metadata_valid and no_server_claims and load_rejection_reason.is_empty()
	return {
		"contract_kind": "boss_practice_replay_index_verification",
		"ok": loadable,
		"reason": "none" if loadable else (load_rejection_reason if not load_rejection_reason.is_empty() else verification_status),
		"replay_id": String(entry.get("replay_id", "")),
		"verification_status": verification_status,
		"verification_scope": "local_practice_hash" if no_server_claims else "rejected_server_claim",
		"preview_authority_scope": String(entry.get("preview_authority_scope", "")),
		"replay_verification_scope": "local_practice_hash",
		"local_playback_authority": "local_practice_hash" if not requires_server_audit else "server_audit_required",
		"spellbook_id": String(entry.get("spellbook_id", "")),
		"phase_id": String(entry.get("phase_id", "")),
		"preview_seed": int(entry.get("preview_seed", entry.get("match_seed", 0))),
		"preview_export_id": String(entry.get("preview_export_id", "")),
		"preview_fixture_id": String(entry.get("preview_fixture_id", "")),
		"preview_signature_digest": int(entry.get("preview_signature_digest", 0)),
		"preview_sample_count": int(entry.get("preview_sample_count", 0)),
		"preview_max_emit_per_tick": int(entry.get("preview_max_emit_per_tick", 0)),
		"preview_budget_headroom": int(entry.get("preview_budget_headroom", 0)),
		"preview_bundle_id": String(entry.get("preview_bundle_id", "")),
		"preview_bundle_signature_digest": int(entry.get("preview_bundle_signature_digest", 0)),
		"preview_phase_count": int(entry.get("preview_phase_count", 0)),
		"preview_phase_ids": (entry.get("preview_phase_ids", []) as Array).duplicate(),
		"preview_phase_signature_digests": (entry.get("preview_phase_signature_digests", []) as Array).duplicate(),
		"performance_budget_status": String(entry.get("performance_budget_status", "")),
		"local_load_policy": "blocked_server_audit" if requires_server_audit else ("loadable_local_practice" if load_rejection_reason.is_empty() else "blocked_local_integrity"),
		"local_load_guard_reason": load_rejection_reason,
		"online_outcome_status": "server_required",
		"requires_server_audit": requires_server_audit,
		"server_audit_status": "pending" if requires_server_audit else "not_required",
		"server_authority_claim_fields": server_claim_fields,
		"damage_authority": "server",
		"reward_authority": "server",
		"settlement_authority": "server",
		"server_authoritative": false,
		"client_result_authoritative": false,
	}

func _selected_or_first_boss_practice_row(boss_rows: Array[Dictionary]) -> Dictionary:
	if boss_rows.is_empty():
		return {}
	var selected_id := selected_replay_id()
	for row in boss_rows:
		if String(row.get("replay_id", "")) == selected_id:
			return row
	return boss_rows[0]

func _is_boss_spellbook_practice_entry(entry: Dictionary) -> bool:
	return String(entry.get("mode", "")) == "boss_spellbook_practice" or String(entry.get("catalog_id", "")) == "boss_spellbook"

func _selected_action_context(row: Dictionary) -> Dictionary:
	if row.is_empty():
		return {
			"selected_verification_status": "none",
			"selected_verification_summary": "",
			"selected_filter_navigation_label": "0/0",
			"selected_replay_authority_scope": "none",
			"selected_server_audit_status": "not_required",
			"selected_local_playback_authority": "none",
			"selected_filtered_index": 0,
			"selected_filtered_count": 0,
			"replay_action_guard": _replay_action_guard(row),
		}
	return {
		"selected_verification_status": String(row.get("verification_status", "")),
		"selected_verification_section": String(row.get("section", "")),
		"selected_verification_summary": String(row.get("verification_summary", "")),
		"selected_filter_navigation_label": String(row.get("filter_navigation_label", "")),
		"selected_replay_authority_scope": String(row.get("replay_authority_scope", "")),
		"selected_server_audit_status": String(row.get("server_audit_status", "")),
		"selected_local_playback_authority": String(row.get("local_playback_authority", "")),
		"selected_boss_practice_verification_status": String((row.get("boss_practice_verification", {}) as Dictionary).get("verification_status", "none")) if typeof(row.get("boss_practice_verification", {})) == TYPE_DICTIONARY else "none",
		"selected_boss_practice_verification": (row.get("boss_practice_verification", {}) as Dictionary).duplicate(true) if typeof(row.get("boss_practice_verification", {})) == TYPE_DICTIONARY else {},
		"selected_practice_validation": (row.get("practice_validation", {}) as Dictionary).duplicate(true) if typeof(row.get("practice_validation", {})) == TYPE_DICTIONARY else _practice_validation_context(row),
		"selected_filtered_index": int(row.get("filtered_index", 0)),
		"selected_filtered_count": int(row.get("filtered_count", 0)),
		"replay_action_guard": _replay_action_guard(row),
	}

func _replay_action_guard(row: Dictionary) -> Dictionary:
	if row.is_empty():
		return {
			"ok": false,
			"reason": "no_replay_selected",
			"final_hash_required": true,
			"final_hash_ready": false,
			"local_load_policy": "none",
			"requires_server_audit": false,
			"server_audit_status": "not_required",
			"local_playback_authority": "none",
			"local_hash_authority": "local_practice_verification_only",
			"damage_authority": "server",
			"settlement_authority": "server",
			"reward_authority": "server",
			"client_result_authoritative": false,
		}
	var reason := String(row.get("local_load_guard_reason", row.get("load_rejection_reason", "")))
	var can_play := bool(row.get("can_play", false)) and reason.is_empty()
	return {
		"ok": can_play,
		"reason": "loadable_local_practice" if can_play else reason,
		"replay_id": String(row.get("replay_id", "")),
		"verification_status": String(row.get("verification_status", "")),
		"verification_section": String(row.get("section", "")),
		"final_hash_required": true,
		"final_hash_ready": bool(row.get("can_verify_final_hash", false)) and int(row.get("final_result_hash", 0)) != 0,
		"final_result_hash": int(row.get("final_result_hash", 0)),
		"local_load_policy": String(row.get("local_load_policy", "none")),
		"requires_server_audit": bool(row.get("requires_server_audit", false)),
		"server_audit_status": String(row.get("server_audit_status", "")),
		"local_playback_authority": String(row.get("local_playback_authority", "")),
		"local_hash_authority": "local_practice_verification_only",
		"damage_authority": "server",
		"settlement_authority": "server",
		"reward_authority": "server",
		"client_result_authoritative": false,
	}

func _local_load_request_result(entry: Dictionary, row: Dictionary, guard: Dictionary, ok: bool, reason: String) -> Dictionary:
	var safe_guard := guard.duplicate(true)
	var safe_row := row.duplicate(true)
	var replay_id := String(safe_row.get("replay_id", entry.get("replay_id", "")))
	var source_index := int(safe_row.get("source_index", _source_index_for_replay_id(replay_id)))
	var path := String(safe_row.get("path", entry.get("path", "")))
	return {
		"ok": ok,
		"reason": reason,
		"action_status": "load_ready" if ok else "load_blocked",
		"load_request_kind": "selected_local_replay_load",
		"replay_id": replay_id,
		"path": path,
		"source_index": source_index,
		"verification_status": String(safe_row.get("verification_status", safe_guard.get("verification_status", "none"))),
		"verification_section": String(safe_row.get("section", safe_guard.get("verification_section", ""))),
		"verification_scope": String(safe_row.get("verification_scope", "")),
		"local_load_policy": String(safe_guard.get("local_load_policy", safe_row.get("local_load_policy", "none"))),
		"local_load_guard_reason": String(safe_row.get("local_load_guard_reason", safe_row.get("load_rejection_reason", ""))),
		"requires_server_audit": bool(safe_guard.get("requires_server_audit", safe_row.get("requires_server_audit", false))),
		"server_audit_status": String(safe_guard.get("server_audit_status", safe_row.get("server_audit_status", "not_required"))),
		"replay_authority_scope": String(safe_row.get("replay_authority_scope", "none")),
		"local_playback_authority": String(safe_guard.get("local_playback_authority", safe_row.get("local_playback_authority", "none"))),
		"local_hash_authority": "local_practice_verification_only",
		"final_hash_required": true,
		"final_hash_ready": bool(safe_guard.get("final_hash_ready", safe_row.get("can_verify_final_hash", false))) and int(safe_row.get("final_result_hash", safe_guard.get("final_result_hash", 0))) != 0,
		"final_result_hash": int(safe_row.get("final_result_hash", safe_guard.get("final_result_hash", 0))),
		"snapshot_source": "local_file" if ok else "blocked",
		"can_play": ok,
		"practice_validation": (safe_row.get("practice_validation", {}) as Dictionary).duplicate(true) if typeof(safe_row.get("practice_validation", {})) == TYPE_DICTIONARY else _practice_validation_context(safe_row),
		"filter_navigation_label": String(safe_row.get("filter_navigation_label", "0/0")),
		"selected_filtered_index": int(safe_row.get("filtered_index", 0)),
		"selected_filtered_count": int(safe_row.get("filtered_count", 0)),
		"replay_action_guard": safe_guard,
		"boss_practice_verification": (safe_row.get("boss_practice_verification", {}) as Dictionary).duplicate(true) if typeof(safe_row.get("boss_practice_verification", {})) == TYPE_DICTIONARY else {},
		"server_authoritative": false,
		"damage_authority": "server",
		"settlement_authority": "server",
		"reward_authority": "server",
		"boss_hp_authority": "server",
		"client_result_authoritative": false,
	}

func _entry_verification_status(entry: Dictionary, final_result_hash: int, metadata_valid: bool) -> String:
	if not metadata_valid:
		return _entry_metadata_status(entry, false)
	if bool(entry.get("server_authoritative", false)):
		return "server_record_pending_audit"
	var input_status := _entry_input_integrity_status(entry)
	if input_status != "valid" and input_status != "preview_input_not_recorded":
		return input_status
	if final_result_hash == 0:
		return "missing_final_hash"
	return "local_final_hash_ready"

func _entry_verification_section(verification_status: String) -> String:
	match verification_status:
		"local_final_hash_ready":
			return "replay_local_ready"
		"missing_final_hash":
			return "replay_missing_hash"
		"input_integrity_missing", "input_tick_range_invalid", "input_tick_nonmonotonic", "input_tick_gap", "input_tick_span_mismatch", "input_final_tick_mismatch":
			return "replay_input_invalid"
		"server_record_pending_audit":
			return "replay_server_pending"
		_:
			return "replay_metadata_invalid"

func _entry_verification_section_label_key(verification_status: String) -> String:
	return "ui.menu_section_%s" % _entry_verification_section(verification_status)

func _entry_verification_scope(entry: Dictionary, server_authoritative: bool, metadata_valid: bool, server_claim_fields: Array[String]) -> String:
	if not server_claim_fields.is_empty():
		return "rejected_server_claim"
	if server_authoritative:
		return "server_audit_record"
	var input_status := _entry_input_integrity_status(entry)
	if input_status != "valid" and input_status != "preview_input_not_recorded":
		return "local_practice_input_integrity"
	return "local_practice_hash"

func _entry_verification_summary(entry: Dictionary, verification_status: String, metadata_valid: bool, server_authoritative: bool, server_claim_fields: Array[String]) -> String:
	var final_tick := int(entry.get("final_tick", 0))
	var final_hash := int(entry.get("final_result_hash", 0))
	if not server_claim_fields.is_empty():
		return "rejected server-authority claims %d fields; status %s" % [server_claim_fields.size(), verification_status]
	if server_authoritative:
		return "server replay audit pending; tick %d hash %d" % [final_tick, final_hash]
	if _entry_verification_section(verification_status) == "replay_input_invalid":
		return "local practice input integrity failed; status %s inputs %d range %d-%d" % [
			verification_status,
			int(entry.get("input_count", 0)),
			int(entry.get("input_first_tick", -1)),
			int(entry.get("input_last_tick", -1)),
		]
	if final_hash != 0:
		return "local practice final hash ready; tick %d hash %d inputs %d" % [final_tick, final_hash, int(entry.get("input_count", 0))]
	return "local practice replay missing final hash; tick %d" % final_tick

func _entry_metadata_status(entry: Dictionary, metadata_valid: bool) -> String:
	if metadata_valid:
		return "valid"
	if replay_store != null and replay_store.has_method("metadata_status_for_entry"):
		return str(replay_store.metadata_status_for_entry(entry))
	if str(entry.get("catalog_id", "")) == "boss_spellbook" or str(entry.get("mode", "")) == "boss_spellbook_practice":
		return "missing_spellbook_preview"
	return "invalid"

func _entry_metadata_failures(entry: Dictionary, metadata_valid: bool) -> Array[String]:
	if metadata_valid:
		return []
	if replay_store != null and replay_store.has_method("metadata_failures_for_entry"):
		return replay_store.metadata_failures_for_entry(entry)
	if replay_store != null and replay_store.has_method("validate_index_metadata"):
		var entries_to_validate: Array[Dictionary] = [entry]
		var result: Dictionary = replay_store.validate_index_metadata(entries_to_validate)
		var failures: Array[String] = []
		for failure in result.get("failures", []):
			failures.append(String(failure))
		return failures
	return [_entry_metadata_status(entry, metadata_valid)]

func _entry_server_authority_claim_fields(entry: Dictionary) -> Array[String]:
	if replay_store != null and replay_store.has_method("server_authority_claim_fields_for_entry"):
		return replay_store.server_authority_claim_fields_for_entry(entry)
	if typeof(entry.get("server_authority_claim_fields", [])) == TYPE_ARRAY:
		return (entry.get("server_authority_claim_fields", []) as Array).duplicate()
	return []

func _verification_counts() -> Dictionary:
	var counts := {
		"replay_boss_practice": 0,
		"replay_local_ready": 0,
		"replay_missing_hash": 0,
		"replay_input_invalid": 0,
		"replay_server_pending": 0,
		"replay_metadata_invalid": 0,
		"rejected_server_claim": 0,
	}
	for entry in entries:
		var metadata_valid := _entry_metadata_valid(entry)
		var server_claim_fields := _entry_server_authority_claim_fields(entry)
		var status_value := _entry_verification_status(entry, int(entry.get("final_result_hash", 0)), metadata_valid)
		var section_value := _entry_verification_section(status_value)
		counts[section_value] = int(counts.get(section_value, 0)) + 1
		if _is_boss_spellbook_practice_entry(entry):
			counts["replay_boss_practice"] = int(counts.get("replay_boss_practice", 0)) + 1
		if _entry_verification_scope(entry, bool(entry.get("server_authoritative", false)), metadata_valid, server_claim_fields) == "rejected_server_claim":
			counts["rejected_server_claim"] = int(counts.get("rejected_server_claim", 0)) + 1
	return counts

func _rejected_server_authority_claim_fields() -> Array[String]:
	var fields: Array[String] = []
	var seen := {}
	for entry in entries:
		var claim_fields := _entry_server_authority_claim_fields(entry)
		if claim_fields.is_empty():
			continue
		for field in claim_fields:
			var field_id := String(field)
			if field_id.is_empty() or seen.has(field_id):
				continue
			seen[field_id] = true
			fields.append(field_id)
	fields.sort()
	return fields

func _playability_counts() -> Dictionary:
	var local_loadable_count := 0
	var server_audit_required_count := 0
	var blocked_local_integrity_count := 0
	var first_loadable_replay_id := ""
	var first_server_audit_replay_id := ""
	var first_blocked_integrity_replay_id := ""
	for entry in entries:
		var metadata_valid := _entry_metadata_valid(entry)
		var server_authoritative := bool(entry.get("server_authoritative", false))
		var server_claim_fields := _entry_server_authority_claim_fields(entry)
		var verification_status := _entry_verification_status(entry, int(entry.get("final_result_hash", 0)), metadata_valid)
		var load_rejection_reason := _entry_local_load_rejection_reason(entry, verification_status, metadata_valid, server_authoritative, server_claim_fields)
		var requires_server_audit := server_authoritative or not server_claim_fields.is_empty() or _entry_verification_section(verification_status) == "replay_server_pending"
		var replay_id := String(entry.get("replay_id", ""))
		if requires_server_audit:
			server_audit_required_count += 1
			if first_server_audit_replay_id.is_empty():
				first_server_audit_replay_id = replay_id
		elif load_rejection_reason.is_empty():
			local_loadable_count += 1
			if first_loadable_replay_id.is_empty():
				first_loadable_replay_id = replay_id
		else:
			blocked_local_integrity_count += 1
			if first_blocked_integrity_replay_id.is_empty():
				first_blocked_integrity_replay_id = replay_id
	return {
		"local_loadable_count": local_loadable_count,
		"server_audit_required_count": server_audit_required_count,
		"blocked_local_integrity_count": blocked_local_integrity_count,
		"first_loadable_replay_id": first_loadable_replay_id,
		"first_server_audit_replay_id": first_server_audit_replay_id,
		"first_blocked_integrity_replay_id": first_blocked_integrity_replay_id,
	}

func _recommended_filter_for_guard(guard: Dictionary) -> String:
	if guard.is_empty():
		return "all"
	if bool(guard.get("ok", false)) and not bool(guard.get("requires_server_audit", false)):
		return "replay_local_ready"
	var reason := String(guard.get("reason", ""))
	if reason == "server_authority_claim_rejected":
		return "rejected_server_claim"
	if bool(guard.get("requires_server_audit", false)):
		return "replay_server_pending"
	var section := String(guard.get("verification_section", ""))
	if not section.is_empty():
		return section
	return "all"

func local_load_guard_for_entry(entry: Dictionary) -> Dictionary:
	var metadata_valid := _entry_metadata_valid(entry)
	var server_authoritative := bool(entry.get("server_authoritative", false))
	var verification_status := _entry_verification_status(entry, int(entry.get("final_result_hash", 0)), metadata_valid)
	var server_claim_fields := _entry_server_authority_claim_fields(entry)
	var rejection_reason := _entry_local_load_rejection_reason(entry, verification_status, metadata_valid, server_authoritative, server_claim_fields)
	var requires_server_audit := server_authoritative or not server_claim_fields.is_empty() or _entry_verification_section(verification_status) == "replay_server_pending"
	var local_load_policy := "blocked_server_audit" if requires_server_audit else ("blocked_local_integrity" if not rejection_reason.is_empty() else "loadable_local_practice")
	var guard := {
		"ok": rejection_reason.is_empty(),
		"reason": "loadable" if rejection_reason.is_empty() else rejection_reason,
		"verification_status": verification_status,
		"verification_section": _entry_verification_section(verification_status),
		"input_integrity_status": _entry_input_integrity_status(entry),
		"metadata_valid": metadata_valid,
		"server_authoritative": server_authoritative,
		"server_authority_claim_fields": server_claim_fields,
		"local_load_policy": local_load_policy,
		"requires_server_audit": requires_server_audit,
		"server_audit_status": "pending" if requires_server_audit else "not_required",
		"local_playback_authority": "server_audit_required" if requires_server_audit else "local_practice_hash",
		"local_hash_authority": "local_practice_verification_only",
		"damage_authority": "server",
		"settlement_authority": "server",
		"reward_authority": "server",
		"client_result_authoritative": false,
	}
	guard["practice_validation"] = _practice_validation_context({
		"replay_id": String(entry.get("replay_id", "")),
		"verification_status": verification_status,
		"verification_scope": _entry_verification_scope(entry, server_authoritative, metadata_valid, server_claim_fields),
		"section": _entry_verification_section(verification_status),
		"final_tick": int(entry.get("final_tick", 0)),
		"final_result_hash": int(entry.get("final_result_hash", 0)),
		"can_verify_final_hash": int(entry.get("final_result_hash", 0)) != 0 and int(entry.get("final_tick", 0)) >= 0,
		"input_integrity_status": _entry_input_integrity_status(entry),
		"input_count": int(entry.get("input_count", 0)),
		"input_tick_span": int(entry.get("input_tick_span", 0)),
		"metadata_status": _entry_metadata_status(entry, metadata_valid),
		"local_load_policy": local_load_policy,
		"can_play": rejection_reason.is_empty(),
		"requires_server_audit": requires_server_audit,
		"server_audit_status": "pending" if requires_server_audit else "not_required",
		"local_playback_authority": "server_audit_required" if requires_server_audit else "local_practice_hash",
	})
	return guard

func _entry_matches_active_filter(entry: Dictionary) -> bool:
	if active_verification_filter == VERIFICATION_FILTER_ALL:
		return true
	if active_verification_filter == "replay_boss_practice":
		return _is_boss_spellbook_practice_entry(entry)
	var metadata_valid := _entry_metadata_valid(entry)
	var server_claim_fields := _entry_server_authority_claim_fields(entry)
	if active_verification_filter == "rejected_server_claim":
		return _entry_verification_scope(entry, bool(entry.get("server_authoritative", false)), metadata_valid, server_claim_fields) == "rejected_server_claim"
	var status_value := _entry_verification_status(entry, int(entry.get("final_result_hash", 0)), metadata_valid)
	return _entry_verification_section(status_value) == active_verification_filter

func _entry_local_load_rejection_reason(entry: Dictionary, verification_status: String, metadata_valid: bool, server_authoritative: bool, server_claim_fields: Array[String] = []) -> String:
	var path := str(entry.get("path", ""))
	if path.is_empty():
		return "missing_path"
	if not FileAccess.file_exists(path):
		return "file_missing"
	if server_authoritative:
		return "server_record_pending_audit"
	if not server_claim_fields.is_empty():
		return "server_authority_claim_rejected"
	if not metadata_valid:
		return verification_status
	if _entry_verification_section(verification_status) == "replay_missing_hash":
		return verification_status
	if _entry_verification_section(verification_status) == "replay_input_invalid":
		return verification_status
	return ""

func _filtered_indices() -> Array[int]:
	var indices: Array[int] = []
	for i in range(entries.size()):
		if _entry_matches_active_filter(entries[i]):
			indices.append(i)
	return indices

func _clamp_cursor_to_filter() -> void:
	if entries.is_empty():
		cursor = 0
		return
	cursor = clampi(cursor, 0, entries.size() - 1)
	if _entry_matches_active_filter(entries[cursor]):
		return
	var indices := _filtered_indices()
	if not indices.is_empty():
		cursor = indices[0]

func _verification_filter_label_key(filter_id: String) -> String:
	if filter_id == VERIFICATION_FILTER_ALL:
		return "ui.menu_section_replay_all"
	if filter_id == "rejected_server_claim":
		return "ui.menu_section_replay_rejected_server_claim"
	return "ui.menu_section_%s" % filter_id

func _filter_navigation_label(filtered_index: int, filtered_count: int) -> String:
	if filtered_count <= 0 or filtered_index < 0:
		return "0/%d" % max(0, filtered_count)
	return "%d/%d" % [filtered_index + 1, filtered_count]

func _entry_input_integrity_status(entry: Dictionary) -> String:
	if bool(entry.get("server_authoritative", false)):
		return "server_audit_not_local_checked"
	var status := String(entry.get("input_integrity_status", ""))
	if status.is_empty():
		return "input_integrity_missing"
	if status == "preview_input_not_recorded" and (String(entry.get("mode", "")) == "boss_spellbook_practice" or String(entry.get("catalog_id", "")) == "boss_spellbook"):
		return status
	if int(entry.get("input_count", 0)) <= 0:
		return "input_integrity_missing"
	var first_tick := int(entry.get("input_first_tick", -1))
	var last_tick := int(entry.get("input_last_tick", -1))
	if first_tick < 0 or last_tick < first_tick:
		return "input_tick_range_invalid"
	if not bool(entry.get("input_tick_monotonic", false)):
		return "input_tick_nonmonotonic"
	if not bool(entry.get("input_tick_contiguous", false)):
		return "input_tick_gap"
	if int(entry.get("input_tick_span", 0)) != last_tick - first_tick + 1:
		return "input_tick_span_mismatch"
	if int(entry.get("final_tick", last_tick)) != last_tick:
		return "input_final_tick_mismatch"
	return status

func _source_index_for_replay_id(replay_id: String) -> int:
	if replay_id.is_empty():
		return -1
	for i in range(entries.size()):
		if str(entries[i].get("replay_id", "")) == replay_id:
			return i
	return -1
