class_name ChestSystem
extends RefCounted

const STORE_DIR := "user://chests"
const STORE_PATH := "user://chests/local_chests.json"
const RARITY_ORDER := {
	"common": 0,
	"uncommon": 1,
	"rare": 2,
	"epic": 3,
	"legendary": 4,
}

var deck_builder: RefCounted = null
var wallet := {
	"points": 3000,
	"card_dust": 0,
	"chest_keys": 3,
}
var owned_chests := {
	"local_basic": 3,
}
var pools: Array[Dictionary] = []
var pity_counters := {}
var opening_log: Array[Dictionary] = []
var last_results: Array[Dictionary] = []
var last_open_status := "none"
var open_counter := 0

func configure(builder: RefCounted) -> void:
	deck_builder = builder
	pools = _build_pools()
	load_state()

func reset_local_state() -> void:
	wallet = {
		"points": 3000,
		"card_dust": 0,
		"chest_keys": 3,
	}
	owned_chests = {
		"local_basic": 3,
	}
	pity_counters.clear()
	opening_log.clear()
	last_results.clear()
	last_open_status = "none"
	open_counter = 0

func load_state() -> bool:
	if not FileAccess.file_exists(STORE_PATH):
		return false
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(STORE_PATH))
	if typeof(parsed) != TYPE_DICTIONARY:
		last_open_status = "load_failed"
		return false
	wallet = parsed.get("wallet", wallet)
	owned_chests = parsed.get("owned_chests", owned_chests)
	pity_counters = parsed.get("pity_counters", pity_counters)
	var log_entries = parsed.get("opening_log", [])
	opening_log.clear()
	if typeof(log_entries) == TYPE_ARRAY:
		for entry in log_entries:
			if typeof(entry) == TYPE_DICTIONARY:
				opening_log.append(entry)
	open_counter = int(parsed.get("open_counter", opening_log.size()))
	return true

func apply_server_chests(snapshot: Dictionary) -> Dictionary:
	if not bool(snapshot.get("server_authoritative", false)):
		return {"ok": false, "reason": "not_authoritative"}
	if typeof(snapshot.get("wallet", {})) == TYPE_DICTIONARY:
		wallet = (snapshot.get("wallet", {}) as Dictionary).duplicate(true)
	if typeof(snapshot.get("owned_chests", {})) == TYPE_DICTIONARY:
		owned_chests = (snapshot.get("owned_chests", {}) as Dictionary).duplicate(true)
	if typeof(snapshot.get("pools", [])) == TYPE_ARRAY:
		_apply_server_pools(snapshot.get("pools", []))
	if typeof(snapshot.get("pity_counters", {})) == TYPE_DICTIONARY:
		pity_counters = _server_pity_counters(snapshot.get("pity_counters", {}))
	if typeof(snapshot.get("opening_log", [])) == TYPE_ARRAY:
		opening_log = _dictionary_array(snapshot.get("opening_log", []))
	if typeof(snapshot.get("last_results", [])) == TYPE_ARRAY:
		last_results = _dictionary_array(snapshot.get("last_results", []))
	last_open_status = "server_synced"
	open_counter = max(open_counter, opening_log.size())
	return {"ok": true, "pool_count": pools.size(), "owned_chests": owned_chests.duplicate(true), "server_authoritative": true}

func apply_server_chest_open(response: Dictionary) -> Dictionary:
	if not bool(response.get("server_authoritative", false)) or bool(response.get("client_result_authoritative", true)):
		return {"ok": false, "reason": "not_authoritative"}
	if typeof(response.get("wallet", {})) == TYPE_DICTIONARY:
		wallet = (response.get("wallet", {}) as Dictionary).duplicate(true)
	if typeof(response.get("owned_chests", {})) == TYPE_DICTIONARY:
		owned_chests = (response.get("owned_chests", {}) as Dictionary).duplicate(true)
	if typeof(response.get("pity_counters", {})) == TYPE_DICTIONARY:
		pity_counters = _server_pity_counters(response.get("pity_counters", {}))
	last_results = _dictionary_array(response.get("results", []))
	if typeof(response.get("audit", {})) == TYPE_DICTIONARY:
		opening_log.append((response.get("audit", {}) as Dictionary).duplicate(true))
	if opening_log.size() > 64:
		opening_log = opening_log.slice(opening_log.size() - 64, opening_log.size())
	open_counter += int(response.get("count", max(1, last_results.size())))
	last_open_status = "server_opened"
	return {
		"ok": true,
		"pool_id": String(response.get("pool_id", "")),
		"count": int(response.get("count", last_results.size())),
		"result_count": last_results.size(),
		"server_authoritative": true,
	}

func save_state() -> bool:
	var error := DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(STORE_DIR))
	if error != OK:
		last_open_status = "save_failed"
		return false
	var file := FileAccess.open(STORE_PATH, FileAccess.WRITE)
	if file == null:
		last_open_status = "save_failed"
		return false
	file.store_string(JSON.stringify({
		"schema_version": 1,
		"wallet": wallet,
		"owned_chests": owned_chests,
		"pity_counters": pity_counters,
		"opening_log": opening_log,
		"open_counter": open_counter,
	}, "\t"))
	return true

func pool_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for pool in pools:
		var pool_id := str(pool.get("pool_id", ""))
		rows.append({
			"id": pool_id,
			"label_key": str(pool.get("name_key", "screen.chest.local_basic")),
			"season_id": str(pool.get("season_id", "local")),
			"enabled": bool(pool.get("enabled", false)),
			"owned": int(owned_chests.get(pool_id, 0)),
			"cost": pool.get("cost", {}),
			"pity": pity_summary(pool_id),
			"can_open_one": can_open(pool_id, 1),
			"can_open_ten": can_open(pool_id, 10),
		})
	return rows

func probability_rows(pool_id: String) -> Array[Dictionary]:
	var pool := pool_by_id(pool_id)
	if pool.is_empty():
		return []
	var weights: Dictionary = pool.get("weights", {})
	var total := 0
	for value in weights.values():
		total += int(value)
	var rows: Array[Dictionary] = []
	for rarity in weights.keys():
		rows.append({
			"id": "prob_%s" % str(rarity),
			"label_key": "rarity.%s" % str(rarity),
			"rarity": str(rarity),
			"weight": int(weights[rarity]),
			"percent": float(weights[rarity]) * 100.0 / float(max(1, total)),
		})
	return rows

func result_rows() -> Array[Dictionary]:
	return last_results.duplicate(true)

func audit_rows(limit: int = 5) -> Array[Dictionary]:
	var start_index: int = max(0, opening_log.size() - limit)
	return opening_log.slice(start_index, opening_log.size())

func can_open(pool_id: String, count: int = 1) -> bool:
	var pool := pool_by_id(pool_id)
	if pool.is_empty() or not bool(pool.get("enabled", false)) or count <= 0:
		return false
	if int(owned_chests.get(pool_id, 0)) < count:
		return false
	var cost: Dictionary = pool.get("cost", {})
	for key in cost.keys():
		if int(wallet.get(str(key), 0)) < int(cost[key]) * count:
			return false
	return true

func open_chest(pool_id: String, count: int = 1) -> Dictionary:
	var pool := pool_by_id(pool_id)
	last_results.clear()
	if pool.is_empty() or count <= 0:
		last_open_status = "invalid"
		return {"ok": false, "reason": "invalid"}
	if not can_open(pool_id, count):
		last_open_status = "insufficient"
		return {"ok": false, "reason": "insufficient"}
	_pay_cost(pool, count)
	owned_chests[pool_id] = int(owned_chests.get(pool_id, 0)) - count
	var seed := _opening_seed(pool_id, count)
	var results: Array[Dictionary] = []
	for i in range(count):
		results.append(_roll_one(pool, seed, i))
	last_results = results
	var audit := {
		"pool_id": pool_id,
		"count": count,
		"cost": pool.get("cost", {}).duplicate(true),
		"seed": seed,
		"results": results,
		"opened_at": Time.get_datetime_string_from_system(true, true),
	}
	opening_log.append(audit)
	open_counter += count
	last_open_status = "opened"
	save_state()
	return {"ok": true, "results": results, "audit": audit}

func pity_summary(pool_id: String) -> Dictionary:
	var counters: Dictionary = pity_counters.get(pool_id, {})
	var pool := pool_by_id(pool_id)
	var pity: Dictionary = pool.get("pity", {})
	return {
		"rare_counter": int(counters.get("rare", 0)),
		"epic_counter": int(counters.get("epic", 0)),
		"rare_threshold": int(pity.get("rare_every", 10)),
		"epic_threshold": int(pity.get("epic_every", 60)),
		"inherit": bool(pity.get("inherit", false)),
	}

func wallet_summary() -> String:
	return "points %d dust %d keys %d chests %d" % [
		int(wallet.get("points", 0)),
		int(wallet.get("card_dust", 0)),
		int(wallet.get("chest_keys", 0)),
		int(owned_chests.get("local_basic", 0)),
	]

func pool_by_id(pool_id: String) -> Dictionary:
	for pool in pools:
		if str(pool.get("pool_id", "")) == pool_id:
			return pool
	return {}

func _pay_cost(pool: Dictionary, count: int) -> void:
	var cost: Dictionary = pool.get("cost", {})
	for key in cost.keys():
		var wallet_key := str(key)
		wallet[wallet_key] = int(wallet.get(wallet_key, 0)) - int(cost[key]) * count

func _opening_seed(pool_id: String, count: int) -> int:
	var value := hash("%s:%d:%d:%d" % [pool_id, count, open_counter, int(wallet.get("points", 0))])
	return int(value) & 0x7fffffff

func _roll_one(pool: Dictionary, seed: int, index: int) -> Dictionary:
	var pool_id := str(pool.get("pool_id", ""))
	var rarity := _roll_rarity(pool, seed + index * 7919)
	rarity = _apply_pity(pool, rarity)
	var card_id := _pick_card_for_rarity(rarity, seed + index * 3571)
	var grant: Dictionary = deck_builder.grant_card(card_id, 1, "chest:%s" % pool_id) if deck_builder != null else {}
	var dust: int = int(grant.get("dust", 0))
	if dust > 0:
		wallet["card_dust"] = int(wallet.get("card_dust", 0)) + dust
	return {
		"id": "result_%d" % (open_counter + index),
		"card_id": card_id,
		"name_key": str(deck_builder.card_by_id(card_id).get("name_key", card_id)) if deck_builder != null else card_id,
		"rarity": rarity,
		"dust": dust,
		"accepted": int(grant.get("accepted", 0)),
		"overflow": int(grant.get("overflow", 0)),
	}

func _roll_rarity(pool: Dictionary, seed: int) -> String:
	var weights: Dictionary = pool.get("weights", {})
	var total := 0
	for value in weights.values():
		total += int(value)
	var roll: int = seed % max(1, total)
	var cursor := 0
	for rarity in weights.keys():
		cursor += int(weights[rarity])
		if roll < cursor:
			return str(rarity)
	return "common"

func _apply_pity(pool: Dictionary, rolled_rarity: String) -> String:
	var pool_id := str(pool.get("pool_id", ""))
	var pity: Dictionary = pool.get("pity", {})
	var counters: Dictionary = pity_counters.get(pool_id, {"rare": 0, "epic": 0})
	counters["rare"] = int(counters.get("rare", 0)) + 1
	counters["epic"] = int(counters.get("epic", 0)) + 1
	var result := rolled_rarity
	if int(counters["epic"]) >= int(pity.get("epic_every", 60)) and _rarity_rank(result) < _rarity_rank("epic"):
		result = "epic"
	if int(counters["rare"]) >= int(pity.get("rare_every", 10)) and _rarity_rank(result) < _rarity_rank("rare"):
		result = "rare"
	if _rarity_rank(result) >= _rarity_rank("rare"):
		counters["rare"] = 0
	if _rarity_rank(result) >= _rarity_rank("epic"):
		counters["epic"] = 0
	pity_counters[pool_id] = counters
	return result

func _pick_card_for_rarity(rarity: String, seed: int) -> String:
	if deck_builder == null:
		return ""
	var candidates: Array[String] = []
	for card in deck_builder.catalog:
		if str(card.get("rarity", "common")) == rarity:
			candidates.append(str(card.get("id", "")))
	if candidates.is_empty():
		for card in deck_builder.catalog:
			candidates.append(str(card.get("id", "")))
	if candidates.is_empty():
		return ""
	return candidates[seed % candidates.size()]

func _rarity_rank(rarity: String) -> int:
	return int(RARITY_ORDER.get(rarity, 0))

func _build_pools() -> Array[Dictionary]:
	return [
		{
			"pool_id": "local_basic",
			"season_id": "local",
			"name_key": "screen.chest.local_basic",
			"cost": {"chest_keys": 1},
			"weights": {"common": 70, "uncommon": 20, "rare": 8, "epic": 2},
			"pity": {"rare_every": 10, "epic_every": 60, "inherit": false},
			"starts_at": "2026-01-01T00:00:00Z",
			"ends_at": "",
			"enabled": true,
		},
	]

func _apply_server_pools(source: Array) -> void:
	var loaded: Array[Dictionary] = []
	for pool_value in source:
		if typeof(pool_value) != TYPE_DICTIONARY:
			continue
		var pool: Dictionary = pool_value
		var pity_value: Variant = pool.get("pity", {})
		var pity: Dictionary = {}
		if typeof(pity_value) == TYPE_DICTIONARY:
			pity = {
				"rare_every": int((pity_value as Dictionary).get("rare_every", 10)),
				"epic_every": int((pity_value as Dictionary).get("epic_every", 60)),
				"inherit": bool((pity_value as Dictionary).get("inherit", false)),
			}
		loaded.append({
			"pool_id": String(pool.get("pool_id", "")),
			"season_id": String(pool.get("season_id", "local")),
			"name_key": String(pool.get("name_key", pool.get("name", "screen.chest.local_basic"))),
			"cost": _int_dictionary(pool.get("cost", {})),
			"weights": _int_dictionary(pool.get("weights", {})),
			"pity": pity,
			"starts_at": String(pool.get("starts_at", "")),
			"ends_at": String(pool.get("ends_at", "")),
			"enabled": bool(pool.get("enabled", false)),
		})
	if not loaded.is_empty():
		pools = loaded

func _server_pity_counters(source: Dictionary) -> Dictionary:
	var out := {}
	for key in source.keys():
		var value: Variant = source[key]
		if typeof(value) == TYPE_DICTIONARY:
			var entry := value as Dictionary
			out[String(key)] = {
				"rare": int(entry.get("rare_counter", entry.get("rare", 0))),
				"epic": int(entry.get("epic_counter", entry.get("epic", 0))),
			}
	return out

func _int_dictionary(source: Variant) -> Dictionary:
	var out := {}
	if typeof(source) != TYPE_DICTIONARY:
		return out
	for key in (source as Dictionary).keys():
		out[String(key)] = int((source as Dictionary)[key])
	return out

func _dictionary_array(source: Variant) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if typeof(source) != TYPE_ARRAY:
		return out
	for item in source as Array:
		if typeof(item) == TYPE_DICTIONARY:
			out.append((item as Dictionary).duplicate(true))
	return out
