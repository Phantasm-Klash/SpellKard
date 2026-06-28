class_name ThemeRegistry
extends RefCounted

const BASE_THEME_MANIFEST := "res://themes/base/theme_manifest.json"
const WORKSHOP_THEME_ROOT := "user://workshop/themes"
const THEME_MANIFEST_FILE := "theme_manifest.json"
const ALLOWED_REPLACEMENTS: Array[String] = ["text", "sprites", "audio", "ui", "backgrounds"]
const FORBIDDEN_REPLACEMENTS: Array[String] = ["rules", "hit_radius", "card_values", "drop_rates", "server_authority", "anti_cheat"]

var active_theme_id := "base"
var active_manifest := {}
var loaded_manifests: Array[Dictionary] = []
var discovered_theme_ids: Array[String] = []
var rejected_theme_paths: Array[String] = []
var load_errors: Array[String] = []

func _init() -> void:
	load_base_theme()

func load_base_theme() -> bool:
	loaded_manifests.clear()
	discovered_theme_ids.clear()
	rejected_theme_paths.clear()
	load_errors.clear()
	return load_theme_manifest(BASE_THEME_MANIFEST, true)

func load_theme_manifest(path: String, required: bool = false, make_active: bool = true) -> bool:
	if not FileAccess.file_exists(path):
		if required:
			_record_error("%s missing" % path)
		else:
			rejected_theme_paths.append(path)
		return false
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(parsed) != TYPE_DICTIONARY:
		_record_error("%s is not a JSON object" % path)
		rejected_theme_paths.append(path)
		return false
	var manifest: Dictionary = parsed
	if not _validate_manifest(manifest, path):
		rejected_theme_paths.append(path)
		return false
	var theme_id := String(manifest.get("theme_id", "base"))
	if make_active:
		active_manifest = manifest
		active_theme_id = theme_id
	if not _has_loaded_theme(theme_id):
		loaded_manifests.append(manifest)
	if not discovered_theme_ids.has(theme_id):
		discovered_theme_ids.append(theme_id)
	return true

func activate_theme(theme_id: String) -> bool:
	for manifest in loaded_manifests:
		if String(manifest.get("theme_id", "")) == theme_id:
			active_manifest = manifest
			active_theme_id = theme_id
			return true
	_record_error("theme not discovered: %s" % theme_id)
	return false

func text_pack_paths(locale: String) -> Array[String]:
	var paths: Array[String] = []
	if active_manifest.is_empty():
		return paths
	var text_packs = active_manifest.get("text_packs", {})
	if typeof(text_packs) != TYPE_DICTIONARY:
		return paths
	var packs: Dictionary = text_packs
	var locale_path := String(packs.get(locale, ""))
	if not locale_path.is_empty():
		paths.append(locale_path)
	if locale != "en":
		var fallback_path := String(packs.get("en", ""))
		if not fallback_path.is_empty() and not paths.has(fallback_path):
			paths.append(fallback_path)
	return paths

func discover_workshop_themes(root: String = WORKSHOP_THEME_ROOT) -> int:
	var before_count := discovered_theme_ids.size()
	var dir := DirAccess.open(root)
	if dir == null:
		return 0
	dir.list_dir_begin()
	var entry := dir.get_next()
	while not entry.is_empty():
		var manifest_path := "%s/%s/%s" % [root, entry, THEME_MANIFEST_FILE]
		if dir.current_is_dir() and entry != "." and entry != "..":
			load_theme_manifest(manifest_path, false, false)
		entry = dir.get_next()
	dir.list_dir_end()
	return discovered_theme_ids.size() - before_count

func display_name_key() -> String:
	return String(active_manifest.get("display_name_key", "theme.base.name"))

func version() -> String:
	return String(active_manifest.get("version", "0.0.0"))

func replacement_summary() -> String:
	var replacements: Array[String] = []
	for item in active_manifest.get("replaces", []):
		replacements.append(String(item))
	return ",".join(replacements)

func is_valid() -> bool:
	return load_errors.is_empty() and not active_manifest.is_empty()

func _validate_manifest(manifest: Dictionary, path: String) -> bool:
	for field in ["theme_id", "display_name_key", "version", "asset_license", "replaces"]:
		if field == "replaces":
			if typeof(manifest.get(field, null)) != TYPE_ARRAY:
				_record_error("%s replaces must be an array" % path)
				return false
		elif String(manifest.get(field, "")).is_empty():
			_record_error("%s missing %s" % [path, field])
			return false
	for item in manifest.get("replaces", []):
		var replacement := String(item)
		if FORBIDDEN_REPLACEMENTS.has(replacement):
			_record_error("%s replacement is forbidden: %s" % [path, replacement])
			return false
		if not ALLOWED_REPLACEMENTS.has(replacement):
			_record_error("%s replacement is not allowed: %s" % [path, replacement])
			return false
	if manifest.has("text_packs") and typeof(manifest.get("text_packs")) != TYPE_DICTIONARY:
		_record_error("%s text_packs must be an object" % path)
		return false
	return true

func _has_loaded_theme(theme_id: String) -> bool:
	for manifest in loaded_manifests:
		if String(manifest.get("theme_id", "")) == theme_id:
			return true
	return false

func _record_error(message: String) -> void:
	if not load_errors.has(message):
		load_errors.append(message)
