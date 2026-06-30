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
	"replay_local_ready",
	"replay_missing_hash",
	"replay_input_invalid",
	"replay_server_pending",
	"replay_metadata_invalid",
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
	return {
		"id": "replay_verification_summary",
		"label_key": "screen.main.replay",
		"value": "filter %s local %d missing %d input %d server %d invalid %d" % [active_verification_filter, local_ready, missing_hash, input_invalid, server_pending, metadata_invalid],
		"summary": "verification filter=%s local_ready=%d missing_hash=%d input_invalid=%d server_pending=%d metadata_invalid=%d rejected_server_claim=%d visible=%d" % [active_verification_filter, local_ready, missing_hash, input_invalid, server_pending, metadata_invalid, rejected_server_claim, _filtered_indices().size()],
		"entry_count": entries.size(),
		"visible_entry_count": _filtered_indices().size(),
		"active_verification_filter": active_verification_filter,
		"local_ready_count": local_ready,
		"missing_final_hash_count": missing_hash,
		"input_invalid_count": input_invalid,
		"server_pending_audit_count": server_pending,
		"metadata_invalid_count": metadata_invalid,
		"rejected_server_claim_count": rejected_server_claim,
		"server_authoritative": false,
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
		rows.append({
			"id": "replay_filter_%s" % filter_id,
			"label_key": _verification_filter_label_key(filter_id),
			"value": "%s %d" % ["active" if filter_id == active_verification_filter else "show", count],
			"summary": "local replay display filter only; server audit authority unchanged",
			"verification_filter": filter_id,
			"active": filter_id == active_verification_filter,
			"entry_count": count,
			"server_authoritative": false,
			"client_result_authoritative": false,
			"section": "overview",
			"section_label_key": "ui.menu_section_overview",
			"ui_control": "button",
			"ui_action": "set_replay_filter",
			"enabled": true,
		})
	return rows

func selected_action_rows() -> Array[Dictionary]:
	var entry := selected_entry()
	var replay_id := str(entry.get("replay_id", ""))
	var has_replay := not replay_id.is_empty()
	var source_index := _source_index_for_replay_id(replay_id)
	return [
		{
			"id": "replay_action_favorite",
			"label_key": "screen.replay.favorite",
			"value": "on" if bool(entry.get("favorite", false)) else "off",
			"summary": "toggle local replay index favorite marker",
			"replay_id": replay_id,
			"source_index": source_index,
			"server_authoritative": false,
			"client_result_authoritative": false,
			"section": "overview",
			"section_label_key": "ui.menu_section_overview",
			"ui_control": "button",
			"ui_action": "toggle_replay_favorite",
			"enabled": has_replay,
		},
		{
			"id": "replay_action_remove",
			"label_key": "screen.replay.remove",
			"value": "index only",
			"summary": "remove selected replay from local index; replay file remains untouched",
			"replay_id": replay_id,
			"source_index": source_index,
			"server_authoritative": false,
			"client_result_authoritative": false,
			"section": "overview",
			"section_label_key": "ui.menu_section_overview",
			"ui_control": "button",
			"ui_action": "remove_replay_from_index",
			"enabled": has_replay,
		},
	]

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
	var load_rejection_reason := _entry_local_load_rejection_reason(entry, verification_status, metadata_valid, server_authoritative)
	var replay_authority_scope := "server_authoritative_record" if server_authoritative else "local_practice_record"
	return {
		"index": index + 1,
		"source_index": index,
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

func _entry_metadata_valid(entry: Dictionary) -> bool:
	if replay_store != null and replay_store.has_method("validate_index_metadata"):
		var entries_to_validate: Array[Dictionary] = [entry]
		var result: Dictionary = replay_store.validate_index_metadata(entries_to_validate)
		return bool(result.get("ok", false))
	return true

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
	if not metadata_valid and not server_claim_fields.is_empty():
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
	if not metadata_valid and not server_claim_fields.is_empty():
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
		if _entry_verification_scope(entry, bool(entry.get("server_authoritative", false)), metadata_valid, server_claim_fields) == "rejected_server_claim":
			counts["rejected_server_claim"] = int(counts.get("rejected_server_claim", 0)) + 1
	return counts

func local_load_guard_for_entry(entry: Dictionary) -> Dictionary:
	var metadata_valid := _entry_metadata_valid(entry)
	var server_authoritative := bool(entry.get("server_authoritative", false))
	var verification_status := _entry_verification_status(entry, int(entry.get("final_result_hash", 0)), metadata_valid)
	var rejection_reason := _entry_local_load_rejection_reason(entry, verification_status, metadata_valid, server_authoritative)
	return {
		"ok": rejection_reason.is_empty(),
		"reason": "loadable" if rejection_reason.is_empty() else rejection_reason,
		"verification_status": verification_status,
		"verification_section": _entry_verification_section(verification_status),
		"input_integrity_status": _entry_input_integrity_status(entry),
		"metadata_valid": metadata_valid,
		"server_authoritative": server_authoritative,
	}

func _entry_matches_active_filter(entry: Dictionary) -> bool:
	if active_verification_filter == VERIFICATION_FILTER_ALL:
		return true
	var metadata_valid := _entry_metadata_valid(entry)
	var status_value := _entry_verification_status(entry, int(entry.get("final_result_hash", 0)), metadata_valid)
	return _entry_verification_section(status_value) == active_verification_filter

func _entry_local_load_rejection_reason(entry: Dictionary, verification_status: String, metadata_valid: bool, server_authoritative: bool) -> String:
	var path := str(entry.get("path", ""))
	if path.is_empty():
		return "missing_path"
	if not FileAccess.file_exists(path):
		return "file_missing"
	if server_authoritative:
		return "server_record_pending_audit"
	if not metadata_valid:
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
	return "ui.menu_section_%s" % filter_id

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
