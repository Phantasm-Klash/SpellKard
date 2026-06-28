class_name Localization
extends RefCounted

const DEFAULT_LOCALE := "zh-CN"
const BASE_TEXT_PACK := "res://i18n/base.en.json"
const SUPPORTED_LOCALES: Array[String] = ["en", "zh-CN"]
const LOCALE_LABELS := {
	"en": "English",
	"zh-CN": "简体中文",
}

var locale := DEFAULT_LOCALE
var theme_id := "base"
var missing_keys: Array[String] = []
var loaded_packs: Array[String] = []
var load_errors: Array[String] = []

var fallback_text := {
	"ui.title": "SpellKard local client",
	"card.none": "none",
}
var text := {}

func _init() -> void:
	load_defaults(locale, theme_id)

func load_defaults(locale_id: String = DEFAULT_LOCALE, selected_theme_id: String = "base") -> void:
	locale = _normalized_locale(locale_id)
	theme_id = selected_theme_id
	text = fallback_text.duplicate(true)
	missing_keys.clear()
	loaded_packs.clear()
	load_errors.clear()
	load_pack(BASE_TEXT_PACK, true)
	if locale != "en":
		load_pack("res://i18n/base.%s.json" % locale, false)
	if not theme_id.is_empty() and theme_id != "base":
		load_pack("res://i18n/themes/%s.%s.json" % [theme_id, locale], false)
		if locale != "en":
			load_pack("res://i18n/themes/%s.en.json" % theme_id, false)

func load_pack(path: String, required: bool = false) -> bool:
	if not FileAccess.file_exists(path):
		if required:
			_record_load_error("%s missing" % path)
		return false
	var raw := FileAccess.get_file_as_string(path)
	var parsed = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		_record_load_error("%s is not a JSON object" % path)
		return false
	var parsed_text: Dictionary = parsed
	for key in parsed_text.keys():
		text[String(key)] = String(parsed_text[key])
	if not loaded_packs.has(path):
		loaded_packs.append(path)
	return true

func has_text(key: String) -> bool:
	return text.has(key)

func cycle_locale(direction: int = 1) -> void:
	var index := SUPPORTED_LOCALES.find(locale)
	if index < 0:
		index = 0
	var step := -1 if direction < 0 else 1
	var next_index := wrapi(index + step, 0, SUPPORTED_LOCALES.size())
	load_defaults(SUPPORTED_LOCALES[next_index], theme_id)

func set_locale(locale_id: String) -> bool:
	var normalized := _normalized_locale(locale_id)
	if not SUPPORTED_LOCALES.has(normalized):
		return false
	load_defaults(normalized, theme_id)
	return true

func locale_label(locale_id: String = "") -> String:
	var source_locale := locale_id
	if source_locale.is_empty():
		source_locale = locale
	return String(LOCALE_LABELS.get(source_locale, source_locale))

func locale_options() -> Array[String]:
	var options: Array[String] = []
	for locale_id in SUPPORTED_LOCALES:
		options.append(locale_label(locale_id))
	return options

func locale_index() -> int:
	return max(0, SUPPORTED_LOCALES.find(locale))

func _normalized_locale(locale_id: String) -> String:
	if SUPPORTED_LOCALES.has(locale_id):
		return locale_id
	return DEFAULT_LOCALE

func _record_load_error(message: String) -> void:
	if not load_errors.has(message):
		load_errors.append(message)

func text_for(key: String, values: Dictionary = {}) -> String:
	if key.is_empty():
		return ""
	var value := ""
	if text.has(key):
		value = String(text[key])
	else:
		if not missing_keys.has(key):
			missing_keys.append(key)
		value = key
	for placeholder in values.keys():
		value = value.replace("{%s}" % str(placeholder), str(values[placeholder]))
	return value

func format_lines(keys_and_values: Array) -> String:
	var lines: Array[String] = []
	for entry in keys_and_values:
		var key := String(entry.get("key", ""))
		if key.is_empty():
			continue
		lines.append(text_for(key, entry.get("values", {})))
	return "\n".join(lines)
