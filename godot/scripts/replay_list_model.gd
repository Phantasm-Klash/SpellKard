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
		"can_play": not path.is_empty() and FileAccess.file_exists(path),
		"can_favorite": not str(entry.get("replay_id", "")).is_empty(),
		"can_remove": not str(entry.get("replay_id", "")).is_empty(),
	}
