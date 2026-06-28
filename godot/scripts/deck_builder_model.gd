class_name DeckBuilderModel
extends RefCounted

const DECK_DIR := "user://decks"
const DECK_STORE_PATH := "user://decks/local_decks.json"
const RULESET_VERSION := "ruleset-local-s0"
const DEFAULT_FORMAT := "local_practice"
const DECK_SIZE := 20
const MAX_COPIES_PER_CARD := 2
const MAX_CARD_LEVEL := 5
const MAX_HIGH_RARE_CARDS := 6
const MAX_STRONG_INTERFERENCE_CARDS := 4
const HIGH_RARITIES: Array[String] = ["rare", "epic", "legendary"]

var catalog: Array[Dictionary] = []
var catalog_by_id := {}
var inventory := {}
var card_levels := {}
var first_obtained_at := {}
var saved_decks: Array[Dictionary] = []
var working_deck_id := "local_default"
var working_name := "Local Practice"
var working_format := DEFAULT_FORMAT
var working_card_ids: Array[String] = []
var active_deck_id := "local_default"
var last_validation: Dictionary = {}
var last_save_status := "none"
var last_edit_status := "none"

func _init() -> void:
	configure_local_defaults()
	load_saved_decks()

func configure_local_defaults() -> void:
	catalog = _build_catalog()
	_rebuild_catalog_index()
	inventory.clear()
	card_levels.clear()
	first_obtained_at.clear()
	for card in catalog:
		var card_id := str(card.get("id", ""))
		inventory[card_id] = 2
		card_levels[card_id] = 1
		first_obtained_at[card_id] = Time.get_datetime_string_from_system(true, true)
	working_deck_id = "local_default"
	working_name = "Local Practice"
	working_format = DEFAULT_FORMAT
	working_card_ids = _default_card_ids()
	active_deck_id = working_deck_id
	saved_decks = [_build_deck_record(working_deck_id, working_name, working_format, working_card_ids, true)]
	last_validation = validate_working_deck()
	last_save_status = "none"
	last_edit_status = "none"

func apply_server_inventory(snapshot: Dictionary) -> Dictionary:
	if not bool(snapshot.get("server_authoritative", false)):
		return {"ok": false, "reason": "not_authoritative"}
	var items_value: Variant = snapshot.get("items", [])
	if typeof(items_value) != TYPE_ARRAY:
		return {"ok": false, "reason": "items_invalid"}
	inventory.clear()
	card_levels.clear()
	first_obtained_at.clear()
	for item_value in items_value as Array:
		if typeof(item_value) != TYPE_DICTIONARY:
			continue
		var item: Dictionary = item_value
		var card_id := String(item.get("card_id", ""))
		if card_id.is_empty() or not catalog_by_id.has(card_id):
			continue
		inventory[card_id] = int(item.get("copies", 0))
		card_levels[card_id] = int(item.get("level", 1))
		first_obtained_at[card_id] = String(item.get("first_obtained_at", ""))
	last_validation = validate_working_deck()
	return {"ok": true, "item_count": inventory.size(), "server_authoritative": true}

func apply_server_decks(snapshot: Dictionary) -> Dictionary:
	if not bool(snapshot.get("server_authoritative", false)):
		return {"ok": false, "reason": "not_authoritative"}
	var decks_value: Variant = snapshot.get("decks", [])
	if typeof(decks_value) != TYPE_ARRAY:
		return {"ok": false, "reason": "decks_invalid"}
	var loaded: Array[Dictionary] = []
	for deck_value in decks_value as Array:
		if typeof(deck_value) != TYPE_DICTIONARY:
			continue
		var deck: Dictionary = deck_value
		loaded.append({
			"deck_id": String(deck.get("deck_id", "")),
			"name": String(deck.get("name", "")),
			"format": String(deck.get("format", DEFAULT_FORMAT)),
			"ruleset_version": String(deck.get("ruleset_version", RULESET_VERSION)),
			"card_ids": _copy_ids(deck.get("card_ids", [])),
			"active": bool(deck.get("active", false)),
			"updated_at": String(deck.get("updated_at", "")),
		})
	if loaded.is_empty():
		return {"ok": false, "reason": "empty"}
	saved_decks = loaded
	var server_active_id := String(snapshot.get("active_deck_id", ""))
	var active_found := false
	for deck in saved_decks:
		if String(deck.get("deck_id", "")) == server_active_id or bool(deck.get("active", false)):
			deck["active"] = true
			_load_working_from_record(deck)
			active_deck_id = String(deck.get("deck_id", working_deck_id))
			active_found = true
		else:
			deck["active"] = false
	if not active_found:
		_load_working_from_record(saved_decks[0])
		active_deck_id = String(saved_decks[0].get("deck_id", working_deck_id))
		saved_decks[0]["active"] = true
	last_validation = validate_working_deck()
	last_save_status = "server_synced"
	return {"ok": true, "deck_count": saved_decks.size(), "active_deck_id": active_deck_id, "server_authoritative": true}

func apply_server_deck_save(response: Dictionary) -> Dictionary:
	if not bool(response.get("server_authoritative", false)):
		return {"ok": false, "reason": "not_authoritative"}
	var deck_value: Variant = response.get("deck", {})
	if typeof(deck_value) != TYPE_DICTIONARY:
		return {"ok": false, "reason": "deck_invalid"}
	var deck: Dictionary = deck_value
	var record := {
		"deck_id": String(deck.get("deck_id", "")),
		"name": String(deck.get("name", "")),
		"format": String(deck.get("format", DEFAULT_FORMAT)),
		"ruleset_version": String(deck.get("ruleset_version", RULESET_VERSION)),
		"card_ids": _copy_ids(deck.get("card_ids", [])),
		"active": bool(deck.get("active", false)),
		"updated_at": String(deck.get("updated_at", "")),
	}
	var updated: Array[Dictionary] = []
	for existing in saved_decks:
		if String(existing.get("deck_id", "")) == String(record.get("deck_id", "")):
			continue
		if bool(record.get("active", false)):
			existing["active"] = false
		updated.append(existing)
	updated.push_front(record)
	saved_decks = updated
	if bool(record.get("active", false)):
		active_deck_id = String(record.get("deck_id", active_deck_id))
		_load_working_from_record(record)
	last_validation = validate_working_deck()
	last_save_status = "server_saved"
	return {"ok": true, "active_deck_id": active_deck_id, "deck_id": String(record.get("deck_id", "")), "server_authoritative": true}

func apply_server_card_upgrade(response: Dictionary) -> Dictionary:
	if not bool(response.get("server_authoritative", false)) or bool(response.get("client_result_authoritative", true)):
		return {"ok": false, "reason": "not_authoritative"}
	var card_id := String(response.get("card_id", ""))
	if card_id.is_empty() or not catalog_by_id.has(card_id):
		return {"ok": false, "reason": "card_invalid"}
	var inventory_value: Variant = response.get("inventory", {})
	var inventory_result: Dictionary = {}
	if typeof(inventory_value) == TYPE_DICTIONARY:
		var inventory_snapshot: Dictionary = inventory_value
		inventory_result = apply_server_inventory(inventory_snapshot)
		if not bool(inventory_result.get("ok", false)):
			return inventory_result
	else:
		card_levels[card_id] = int(response.get("new_level", int(card_levels.get(card_id, 1))))
	var cost_value := 0
	var cost_source: Variant = response.get("cost", {})
	if typeof(cost_source) == TYPE_DICTIONARY:
		var cost_map: Dictionary = cost_source
		cost_value = int(cost_map.get("card_dust", 0))
	last_edit_status = "server_upgraded"
	last_validation = validate_working_deck()
	return {
		"ok": true,
		"card_id": card_id,
		"old_level": int(response.get("old_level", 1)),
		"new_level": int(response.get("new_level", int(card_levels.get(card_id, 1)))),
		"cost": cost_value,
		"inventory": inventory_result,
		"server_authoritative": true,
	}

func load_saved_decks() -> bool:
	if not FileAccess.file_exists(DECK_STORE_PATH):
		return false
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(DECK_STORE_PATH))
	if typeof(parsed) != TYPE_DICTIONARY:
		last_save_status = "load_failed"
		return false
	var entries = parsed.get("decks", [])
	if typeof(entries) != TYPE_ARRAY:
		last_save_status = "load_failed"
		return false
	var loaded: Array[Dictionary] = []
	for entry in entries:
		if typeof(entry) == TYPE_DICTIONARY:
			loaded.append(entry)
	if loaded.is_empty():
		return false
	saved_decks = loaded
	var active_found := false
	for deck in saved_decks:
		if bool(deck.get("active", false)):
			_load_working_from_record(deck)
			active_deck_id = str(deck.get("deck_id", working_deck_id))
			active_found = true
			break
	if not active_found:
		_load_working_from_record(saved_decks[0])
		active_deck_id = str(saved_decks[0].get("deck_id", working_deck_id))
	last_validation = validate_working_deck()
	return true

func save_working_deck(name: String = "", make_active: bool = true) -> bool:
	last_validation = validate_working_deck()
	if not bool(last_validation.get("valid", false)):
		last_save_status = "invalid"
		return false
	if not name.is_empty():
		working_name = name
	var record := _build_deck_record(working_deck_id, working_name, working_format, working_card_ids, make_active)
	var updated: Array[Dictionary] = []
	for deck in saved_decks:
		if str(deck.get("deck_id", "")) == working_deck_id:
			continue
		if make_active:
			deck["active"] = false
		updated.append(deck)
	updated.push_front(record)
	saved_decks = updated
	if make_active:
		active_deck_id = working_deck_id
	return _save_deck_store()

func set_active_deck(deck_id: String) -> bool:
	for i in range(saved_decks.size()):
		if str(saved_decks[i].get("deck_id", "")) != deck_id:
			continue
		var validation := validate_card_ids(_card_ids_from_record(saved_decks[i]), str(saved_decks[i].get("format", DEFAULT_FORMAT)))
		if not bool(validation.get("valid", false)):
			last_validation = validation
			last_save_status = "invalid"
			return false
		for j in range(saved_decks.size()):
			saved_decks[j]["active"] = j == i
		_load_working_from_record(saved_decks[i])
		active_deck_id = deck_id
		return _save_deck_store()
	last_save_status = "missing"
	return false

func set_filters(rarity: String = "all", card_type: String = "all", limit: int = 64) -> Array[Dictionary]:
	return card_rows(rarity, card_type, limit)

func card_rows(rarity: String = "all", card_type: String = "all", limit: int = 64) -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for card in catalog:
		if rarity != "all" and rarity != str(card.get("rarity", "")):
			continue
		if card_type != "all" and card_type != str(card.get("type", "")):
			continue
		var card_id := str(card.get("id", ""))
		var preview: Dictionary = upgrade_preview(card_id)
		rows.append({
			"card_id": card_id,
			"id": "deck_card_%s" % card_id,
			"name_key": str(card.get("name_key", card_id)),
			"rarity": str(card.get("rarity", "common")),
			"type": str(card.get("type", "self")),
			"cost": float(card.get("cost", 0.0)),
			"owned": int(inventory.get(card_id, 0)),
			"level": int(preview.get("level", 1)),
			"max_level": int(preview.get("max_level", MAX_CARD_LEVEL)),
			"upgrade_cost": int(preview.get("cost", 0)),
			"can_upgrade": bool(preview.get("can_upgrade", false)),
			"in_deck": _count_card(working_card_ids, card_id),
			"deck_count": _count_card(working_card_ids, card_id),
			"deck_size": working_card_ids.size(),
			"can_add": can_add_card(card_id),
			"can_remove": can_remove_card(card_id),
			"high_rare": _is_high_rare(card),
			"strong_interference": bool(card.get("strong_interference", false)),
			"banned_ranked": bool(card.get("banned_ranked", false)),
		})
		if rows.size() >= limit:
			break
	return rows

func deck_stats(card_ids: Array = []) -> Dictionary:
	var ids := _copy_ids(working_card_ids if card_ids.is_empty() else card_ids)
	var rarity_counts := {}
	var type_counts := {}
	var total_cost := 0.0
	var high_rare_count := 0
	var strong_interference_count := 0
	for card_id in ids:
		var card := card_by_id(card_id)
		if card.is_empty():
			continue
		var rarity := str(card.get("rarity", "common"))
		var card_type := str(card.get("type", "self"))
		rarity_counts[rarity] = int(rarity_counts.get(rarity, 0)) + 1
		type_counts[card_type] = int(type_counts.get(card_type, 0)) + 1
		total_cost += float(card.get("cost", 0.0))
		if _is_high_rare(card):
			high_rare_count += 1
		if bool(card.get("strong_interference", false)):
			strong_interference_count += 1
	return {
		"count": ids.size(),
		"total_cost": total_cost,
		"average_cost": total_cost / float(max(1, ids.size())),
		"rarity_counts": rarity_counts,
		"type_counts": type_counts,
		"high_rare_count": high_rare_count,
		"strong_interference_count": strong_interference_count,
	}

func validate_working_deck() -> Dictionary:
	return validate_card_ids(working_card_ids, working_format)

func can_add_card(card_id: String) -> bool:
	if not catalog_by_id.has(card_id):
		return false
	if working_card_ids.size() >= DECK_SIZE:
		return false
	if _count_card(working_card_ids, card_id) >= max_copies_for_card(card_id):
		return false
	if _count_card(working_card_ids, card_id) >= int(inventory.get(card_id, 0)):
		return false
	return true

func can_remove_card(card_id: String) -> bool:
	return _count_card(working_card_ids, card_id) > 0

func add_card_to_working(card_id: String) -> Dictionary:
	if not catalog_by_id.has(card_id):
		last_edit_status = "missing"
		last_validation = validate_working_deck()
		return _edit_result(false, card_id, "add")
	if not can_add_card(card_id):
		last_edit_status = "add_blocked"
		last_validation = validate_working_deck()
		return _edit_result(false, card_id, "add")
	working_card_ids.append(card_id)
	last_edit_status = "added"
	last_save_status = "dirty"
	last_validation = validate_working_deck()
	return _edit_result(true, card_id, "add")

func remove_card_from_working(card_id: String) -> Dictionary:
	var index := working_card_ids.find(card_id)
	if index < 0:
		last_edit_status = "remove_blocked"
		last_validation = validate_working_deck()
		return _edit_result(false, card_id, "remove")
	working_card_ids.remove_at(index)
	last_edit_status = "removed"
	last_save_status = "dirty"
	last_validation = validate_working_deck()
	return _edit_result(true, card_id, "remove")

func toggle_card_in_working(card_id: String) -> Dictionary:
	if working_card_ids.size() < DECK_SIZE and can_add_card(card_id):
		return add_card_to_working(card_id)
	if can_remove_card(card_id):
		return remove_card_from_working(card_id)
	return add_card_to_working(card_id)

func validate_card_ids(card_ids: Array, deck_format: String = DEFAULT_FORMAT) -> Dictionary:
	var ids := _copy_ids(card_ids)
	var reasons: Array[String] = []
	var counts := {}
	if ids.size() != DECK_SIZE:
		reasons.append("deck.reason.size")
	for card_id in ids:
		counts[card_id] = int(counts.get(card_id, 0)) + 1
		if not catalog_by_id.has(card_id):
			_append_unique(reasons, "deck.reason.unknown_card")
			continue
		if int(counts[card_id]) > MAX_COPIES_PER_CARD:
			_append_unique(reasons, "deck.reason.duplicate")
		if int(counts[card_id]) > int(inventory.get(card_id, 0)):
			_append_unique(reasons, "deck.reason.ownership")
		var card := card_by_id(card_id)
		if deck_format == "ranked":
			if bool(card.get("banned_ranked", false)):
				_append_unique(reasons, "deck.reason.banned")
			if str(card.get("ruleset_version", RULESET_VERSION)) != RULESET_VERSION:
				_append_unique(reasons, "deck.reason.ruleset")
	var stats := deck_stats(ids)
	if int(stats.get("high_rare_count", 0)) > MAX_HIGH_RARE_CARDS:
		_append_unique(reasons, "deck.reason.high_rare")
	if int(stats.get("strong_interference_count", 0)) > MAX_STRONG_INTERFERENCE_CARDS:
		_append_unique(reasons, "deck.reason.strong_interference")
	return {
		"valid": reasons.is_empty(),
		"reasons": reasons,
		"stats": stats,
		"format": deck_format,
		"ruleset_version": RULESET_VERSION,
	}

func card_by_id(card_id: String) -> Dictionary:
	if not catalog_by_id.has(card_id):
		return {}
	return (catalog_by_id[card_id] as Dictionary).duplicate(true)

func max_copies_for_card(_card_id: String) -> int:
	return MAX_COPIES_PER_CARD

func grant_card(card_id: String, copies: int = 1, source: String = "local") -> Dictionary:
	if not catalog_by_id.has(card_id) or copies <= 0:
		return {
			"card_id": card_id,
			"accepted": 0,
			"overflow": max(0, copies),
			"dust": 0,
			"source": source,
			"valid": false,
		}
	var owned: int = int(inventory.get(card_id, 0))
	var accepted: int = min(copies, max(0, max_copies_for_card(card_id) - owned))
	var overflow: int = copies - accepted
	if accepted > 0:
		inventory[card_id] = owned + accepted
		if not first_obtained_at.has(card_id):
			first_obtained_at[card_id] = Time.get_datetime_string_from_system(true, true)
		if not card_levels.has(card_id):
			card_levels[card_id] = 1
	var dust: int = overflow * dust_value_for_card(card_id)
	return {
		"card_id": card_id,
		"accepted": accepted,
		"overflow": overflow,
		"dust": dust,
		"source": source,
		"valid": true,
	}

func dust_value_for_card(card_id: String) -> int:
	var rarity := str(card_by_id(card_id).get("rarity", "common"))
	match rarity:
		"legendary":
			return 100
		"epic":
			return 60
		"rare":
			return 25
		"uncommon":
			return 10
		_:
			return 5

func upgrade_cost_for_card(card_id: String, target_level: int = 0) -> int:
	var current_level: int = int(card_levels.get(card_id, 1))
	var level: int = target_level
	if level <= 0:
		level = current_level + 1
	var step: int = int(max(1, level - 1))
	return dust_value_for_card(card_id) * step

func upgrade_preview(card_id: String, wallet: Dictionary = {}) -> Dictionary:
	var level: int = int(card_levels.get(card_id, 1))
	var owned: int = int(inventory.get(card_id, 0))
	var target_level: int = int(min(MAX_CARD_LEVEL, level + 1))
	var cost: int = upgrade_cost_for_card(card_id, target_level)
	var has_wallet: bool = typeof(wallet) == TYPE_DICTIONARY and wallet.has("card_dust")
	var enough_dust: bool = true
	if has_wallet:
		enough_dust = int(wallet.get("card_dust", 0)) >= cost
	return {
		"card_id": card_id,
		"level": level,
		"target_level": target_level,
		"max_level": MAX_CARD_LEVEL,
		"cost": cost,
		"owned": owned,
		"can_upgrade": catalog_by_id.has(card_id) and owned > 0 and level < MAX_CARD_LEVEL and enough_dust,
	}

func cards_for_ids(card_ids: Array) -> Array[Dictionary]:
	var cards: Array[Dictionary] = []
	for card_id in _copy_ids(card_ids):
		var card := card_by_id(card_id)
		if not card.is_empty():
			cards.append(card)
	return cards

func active_card_ids() -> Array[String]:
	for deck in saved_decks:
		if str(deck.get("deck_id", "")) == active_deck_id:
			return _card_ids_from_record(deck)
	return _copy_ids(working_card_ids)

func active_card_definitions() -> Array[Dictionary]:
	return cards_for_ids(active_card_ids())

func active_deck_snapshot() -> Dictionary:
	var active_record := _active_record()
	return {
		"deck_id": str(active_record.get("deck_id", active_deck_id)),
		"name": str(active_record.get("name", working_name)),
		"format": str(active_record.get("format", working_format)),
		"ruleset_version": RULESET_VERSION,
		"card_ids": _card_ids_from_record(active_record),
		"updated_at": str(active_record.get("updated_at", "")),
	}

func cards_for_snapshot(snapshot: Dictionary) -> Array[Dictionary]:
	return cards_for_ids(snapshot.get("card_ids", []))

func summary(_localization: RefCounted = null) -> String:
	last_validation = validate_working_deck()
	var stats: Dictionary = last_validation.get("stats", {})
	var validity := "ok" if bool(last_validation.get("valid", false)) else "invalid"
	var reasons: Array = last_validation.get("reasons", [])
	var reason_text := "-" if reasons.is_empty() else ",".join(reasons)
	return "%s %s %d/%d cost %.1f high %d disrupt %d edit %s save %s %s" % [
		working_name,
		validity,
		int(stats.get("count", 0)),
		DECK_SIZE,
		float(stats.get("average_cost", 0.0)),
		int(stats.get("high_rare_count", 0)),
		int(stats.get("strong_interference_count", 0)),
		last_edit_status,
		last_save_status,
		reason_text,
	]

func _save_deck_store() -> bool:
	var error := DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(DECK_DIR))
	if error != OK:
		last_save_status = "save_failed"
		return false
	var file := FileAccess.open(DECK_STORE_PATH, FileAccess.WRITE)
	if file == null:
		last_save_status = "save_failed"
		return false
	file.store_string(JSON.stringify({
		"schema_version": 1,
		"ruleset_version": RULESET_VERSION,
		"active_deck_id": active_deck_id,
		"decks": saved_decks,
	}, "\t"))
	last_save_status = "saved"
	return true

func _active_record() -> Dictionary:
	for deck in saved_decks:
		if str(deck.get("deck_id", "")) == active_deck_id:
			return deck
	return _build_deck_record(working_deck_id, working_name, working_format, working_card_ids, true)

func _build_deck_record(deck_id: String, deck_name: String, deck_format: String, card_ids: Array, is_active: bool) -> Dictionary:
	return {
		"deck_id": deck_id,
		"name": deck_name,
		"format": deck_format,
		"ruleset_version": RULESET_VERSION,
		"card_ids": _copy_ids(card_ids),
		"active": is_active,
		"updated_at": Time.get_datetime_string_from_system(true, true),
	}

func _load_working_from_record(record: Dictionary) -> void:
	working_deck_id = str(record.get("deck_id", working_deck_id))
	working_name = str(record.get("name", working_name))
	working_format = str(record.get("format", DEFAULT_FORMAT))
	working_card_ids = _card_ids_from_record(record)

func _card_ids_from_record(record: Dictionary) -> Array[String]:
	return _copy_ids(record.get("card_ids", []))

func _copy_ids(source: Array) -> Array[String]:
	var ids: Array[String] = []
	for item in source:
		ids.append(str(item))
	return ids

func _default_card_ids() -> Array[String]:
	return [
		"focus_lens",
		"hitbox_charm",
		"density_surge",
		"tempo_break",
		"bomb_amplifier",
		"guard_seal",
		"graze_engine",
		"draw_sigil",
		"aim_baffle",
		"purge_charm",
		"focus_lens",
		"hitbox_charm",
		"density_surge",
		"tempo_break",
		"bomb_amplifier",
		"guard_seal",
		"graze_engine",
		"draw_sigil",
		"aim_baffle",
		"purge_charm",
	]

func _rebuild_catalog_index() -> void:
	catalog_by_id.clear()
	for card in catalog:
		catalog_by_id[str(card.get("id", ""))] = card

func _count_card(ids: Array[String], card_id: String) -> int:
	var count := 0
	for item in ids:
		if item == card_id:
			count += 1
	return count

func _append_unique(reasons: Array[String], reason: String) -> void:
	if not reasons.has(reason):
		reasons.append(reason)

func _is_high_rare(card: Dictionary) -> bool:
	return HIGH_RARITIES.has(str(card.get("rarity", "common")))

func _edit_result(ok: bool, card_id: String, edit_action: String) -> Dictionary:
	var validation: Dictionary = last_validation.duplicate(true)
	var stats: Dictionary = validation.get("stats", {})
	return {
		"ok": ok,
		"action": edit_action,
		"card_id": card_id,
		"count": _count_card(working_card_ids, card_id),
		"deck_size": working_card_ids.size(),
		"valid": bool(validation.get("valid", false)),
		"reasons": validation.get("reasons", []),
		"average_cost": float(stats.get("average_cost", 0.0)),
		"status": last_edit_status,
	}

func _build_catalog() -> Array[Dictionary]:
	return [
		{
			"id": "focus_lens",
			"name_key": "card.focus_lens.name",
			"rarity": "common",
			"type": "self",
			"cost": 2.0,
			"cooldown_ticks": 240,
			"duration_ticks": 360,
			"ruleset_version": RULESET_VERSION,
			"effect": {"kind": "self", "graze_score_multiplier": 1.45, "focus_speed_multiplier": 0.82},
		},
		{
			"id": "hitbox_charm",
			"name_key": "card.hitbox_charm.name",
			"rarity": "uncommon",
			"type": "self",
			"cost": 3.0,
			"cooldown_ticks": 420,
			"duration_ticks": 300,
			"ruleset_version": RULESET_VERSION,
			"effect": {"kind": "self", "hit_radius_multiplier": 0.65},
		},
		{
			"id": "density_surge",
			"name_key": "card.density_surge.name",
			"rarity": "rare",
			"type": "pattern",
			"cost": 4.0,
			"cooldown_ticks": 540,
			"duration_ticks": 420,
			"ruleset_version": RULESET_VERSION,
			"strong_interference": true,
			"effect": {"kind": "pattern", "density_multiplier": 1.35, "speed_multiplier": 1.08, "graze_score_multiplier": 1.2},
		},
		{
			"id": "tempo_break",
			"name_key": "card.tempo_break.name",
			"rarity": "uncommon",
			"type": "shared",
			"cost": 3.0,
			"cooldown_ticks": 480,
			"duration_ticks": 300,
			"ruleset_version": RULESET_VERSION,
			"effect": {"kind": "pattern", "speed_multiplier": 0.72, "density_multiplier": 0.85, "score_multiplier_penalty": 0.92},
		},
		{
			"id": "bomb_amplifier",
			"name_key": "card.bomb_amplifier.name",
			"rarity": "common",
			"type": "self",
			"cost": 2.0,
			"cooldown_ticks": 360,
			"duration_ticks": 480,
			"ruleset_version": RULESET_VERSION,
			"effect": {"kind": "self", "bomb_radius_multiplier": 1.28, "bomb_invuln_bonus_ticks": 24},
		},
		{
			"id": "guard_seal",
			"name_key": "card.guard_seal.name",
			"rarity": "rare",
			"type": "counter",
			"cost": 5.0,
			"cooldown_ticks": 720,
			"duration_ticks": 900,
			"ruleset_version": RULESET_VERSION,
			"effect": {"kind": "self", "shield_charges": 1},
		},
		{
			"id": "graze_engine",
			"name_key": "card.graze_engine.name",
			"rarity": "common",
			"type": "economy",
			"cost": 2.0,
			"cooldown_ticks": 300,
			"duration_ticks": 360,
			"ruleset_version": RULESET_VERSION,
			"effect": {"kind": "self", "graze_score_multiplier": 1.18},
		},
		{
			"id": "draw_sigil",
			"name_key": "card.draw_sigil.name",
			"rarity": "common",
			"type": "economy",
			"cost": 1.0,
			"cooldown_ticks": 420,
			"duration_ticks": 1,
			"ruleset_version": RULESET_VERSION,
			"effect": {"kind": "self", "energy_gain": 0.75, "draw_cards": 1},
		},
		{
			"id": "aim_baffle",
			"name_key": "card.aim_baffle.name",
			"rarity": "rare",
			"type": "pattern",
			"cost": 4.0,
			"cooldown_ticks": 600,
			"duration_ticks": 360,
			"ruleset_version": RULESET_VERSION,
			"strong_interference": true,
			"effect": {"kind": "pattern", "aim_bias": 0.18, "angle_offset": 0.12, "speed_multiplier": 1.04},
		},
		{
			"id": "purge_charm",
			"name_key": "card.purge_charm.name",
			"rarity": "uncommon",
			"type": "counter",
			"cost": 3.0,
			"cooldown_ticks": 540,
			"duration_ticks": 480,
			"ruleset_version": RULESET_VERSION,
			"effect": {"kind": "self", "hit_radius_multiplier": 0.82, "graze_score_multiplier": 1.05},
		},
		{
			"id": "curve_prism",
			"name_key": "card.curve_prism.name",
			"rarity": "uncommon",
			"type": "pattern",
			"cost": 3.0,
			"cooldown_ticks": 500,
			"duration_ticks": 360,
			"ruleset_version": RULESET_VERSION,
			"effect": {"kind": "pattern", "curve_strength": 0.15, "density_multiplier": 1.08},
		},
		{
			"id": "last_arc",
			"name_key": "card.last_arc.name",
			"rarity": "epic",
			"type": "finisher",
			"cost": 6.0,
			"cooldown_ticks": 900,
			"duration_ticks": 420,
			"ruleset_version": RULESET_VERSION,
			"banned_ranked": true,
			"effect": {"kind": "pattern", "density_multiplier": 1.45, "speed_multiplier": 1.12, "score_multiplier_penalty": 0.88},
		},
	]
