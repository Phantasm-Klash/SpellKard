class_name ReplayListModel
extends RefCounted

var replay_store: RefCounted = null
var entries: Array[Dictionary] = []
var cursor := 0
var status := "empty"
var action_status := "none"

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
	status = "ready"

func select(delta: int) -> bool:
	refresh()
	if entries.is_empty():
		return false
	cursor = wrapi(cursor + delta, 0, entries.size())
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
	return entries[clampi(cursor, 0, entries.size() - 1)]

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
	var count: int = min(max(0, limit), entries.size())
	for i in range(count):
		rows.append(_row_from_entry(entries[i], i))
	return rows

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
	return {
		"index": index + 1,
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
		"favorite": bool(entry.get("favorite", false)),
		"pattern_id": str(entry.get("pattern_id", "")),
		"catalog_id": str(entry.get("catalog_id", "")),
		"spellbook_id": str(entry.get("spellbook_id", "")),
		"phase_id": str(entry.get("phase_id", "")),
		"preview_seed": int(entry.get("preview_seed", entry.get("match_seed", 0))),
		"preview_export_schema_version": int(entry.get("preview_export_schema_version", 0)),
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
		"server_authoritative": bool(entry.get("server_authoritative", false)),
		"server_authority_claim_fields": server_claim_fields,
		"can_play": not path.is_empty() and FileAccess.file_exists(path),
		"can_favorite": not str(entry.get("replay_id", "")).is_empty(),
		"can_remove": not str(entry.get("replay_id", "")).is_empty(),
	}

func _entry_metadata_valid(entry: Dictionary) -> bool:
	if replay_store != null and replay_store.has_method("validate_index_metadata"):
		var entries_to_validate: Array[Dictionary] = [entry]
		var result: Dictionary = replay_store.validate_index_metadata(entries_to_validate)
		return bool(result.get("ok", false))
	return true

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
