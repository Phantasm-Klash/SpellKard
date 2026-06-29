extends SceneTree

const ASSET_MANIFEST := "res://assets/asset_manifest.json"
const THEME_MANIFESTS: Array[String] = [
	"res://themes/base/theme_manifest.json",
]
const ALLOWED_LICENSES: Array[String] = [
	"CC0",
	"Public Domain",
	"MIT",
	"Apache-2.0",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"CC-BY-4.0",
	"Commissioned",
	"Original",
	"Authorized",
]
const ALLOWED_REPLACEMENTS: Array[String] = ["text", "sprites", "audio", "ui", "backgrounds"]
const FORBIDDEN_REPLACEMENTS: Array[String] = ["rules", "hit_radius", "card_values", "drop_rates", "server_authority", "anti_cheat"]
const IGNORED_SUFFIXES: Array[String] = [
	"README.md",
	"asset_manifest.json",
	"theme_manifest.json",
]

var failed := false
var manifest_records: Array = []

func _initialize() -> void:
	_check_asset_manifest()
	_check_theme_manifests()
	_check_untracked_asset_files("res://assets")
	_check_untracked_asset_files("res://themes")
	if failed:
		quit(1)
		return
	print("asset_manifest_check ok: records=%d themes=%d" % [manifest_records.size(), THEME_MANIFESTS.size()])
	quit(0)

func _check_asset_manifest() -> void:
	var manifest := _read_json_object(ASSET_MANIFEST)
	if manifest.is_empty():
		return
	if int(manifest.get("schema_version", 0)) <= 0:
		_fail("asset manifest schema_version missing")
	var records = manifest.get("records", [])
	if typeof(records) != TYPE_ARRAY:
		_fail("asset manifest records must be an array")
		return
	manifest_records = records
	for record in records:
		if typeof(record) != TYPE_DICTIONARY:
			_fail("asset manifest record must be an object")
			continue
		_check_asset_record(record)

func _check_asset_record(record: Dictionary) -> void:
	var required_fields: Array[String] = ["path", "source_url", "provenance", "author", "license", "modified", "imported_at"]
	for field in required_fields:
		if not record.has(field):
			_fail("asset record missing %s" % field)
		elif field == "modified" and typeof(record.get(field)) != TYPE_BOOL:
			_fail("asset record modified must be bool: %s" % String(record.get("path", "")))
		elif field != "modified" and String(record.get(field, "")).is_empty():
			_fail("asset record missing %s" % field)
	var path := String(record.get("path", ""))
	if not path.is_empty() and not FileAccess.file_exists(path):
		_fail("asset record path missing: %s" % path)
	var license := String(record.get("license", ""))
	if not ALLOWED_LICENSES.has(license):
		_fail("asset record license not allowed: %s" % license)
	if bool(record.get("modified", false)) and String(record.get("modification_notes", "")).is_empty():
		_fail("modified asset missing modification_notes: %s" % path)

func _check_theme_manifests() -> void:
	for path in THEME_MANIFESTS:
		var manifest := _read_json_object(path)
		if manifest.is_empty():
			continue
		for field in ["theme_id", "display_name_key", "version", "asset_license", "replaces"]:
			if field == "replaces":
				if typeof(manifest.get(field, null)) != TYPE_ARRAY:
					_fail("%s replaces must be an array" % path)
			elif String(manifest.get(field, "")).is_empty():
				_fail("%s missing %s" % [path, field])
		for item in manifest.get("replaces", []):
			var replacement := String(item)
			if FORBIDDEN_REPLACEMENTS.has(replacement):
				_fail("%s replacement is forbidden: %s" % [path, replacement])
			if not ALLOWED_REPLACEMENTS.has(replacement):
				_fail("%s replacement is not allowed: %s" % [path, replacement])

func _check_untracked_asset_files(root: String) -> void:
	var files := _list_files(root)
	for path in files:
		if _is_ignored_path(path):
			continue
		if not _manifest_has_path(path):
			_fail("asset file missing manifest record: %s" % path)

func _read_json_object(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		_fail("missing JSON file: %s" % path)
		return {}
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(parsed) != TYPE_DICTIONARY:
		_fail("JSON file is not an object: %s" % path)
		return {}
	return parsed

func _list_files(root: String) -> Array[String]:
	var result: Array[String] = []
	var dir := DirAccess.open(root)
	if dir == null:
		return result
	dir.list_dir_begin()
	var entry := dir.get_next()
	while not entry.is_empty():
		var path := "%s/%s" % [root, entry]
		if dir.current_is_dir():
			if entry != "." and entry != "..":
				result.append_array(_list_files(path))
		else:
			result.append(path)
		entry = dir.get_next()
	dir.list_dir_end()
	return result

func _is_ignored_path(path: String) -> bool:
	for suffix in IGNORED_SUFFIXES:
		if path.ends_with(suffix):
			return true
	return false

func _manifest_has_path(path: String) -> bool:
	for record in manifest_records:
		if typeof(record) == TYPE_DICTIONARY and String(record.get("path", "")) == path:
			return true
	return false

func _fail(message: String) -> void:
	failed = true
	push_error("asset_manifest_check failed: %s" % message)
