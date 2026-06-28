class_name AudioSettings
extends RefCounted

const GROUPS: Array[String] = ["master", "music", "sfx", "ui", "voice"]
const DEFAULT_VOLUMES := {
	"master": 1.0,
	"music": 0.8,
	"sfx": 0.8,
	"ui": 0.8,
	"voice": 0.8,
}
const DEFAULT_EVENT_VISUAL_CUES := true
const DEFAULT_HIGH_FREQUENCY_GRAZE_AUDIO := false
const DEFAULT_VOICE_LOCALE := "zh-CN"
const VOICE_LOCALES: Array[String] = ["zh-CN", "en"]
const VOICE_LOCALE_LABELS := {
	"zh-CN": "中文语音",
	"en": "English Voice",
}

var volumes := DEFAULT_VOLUMES.duplicate(true)
var event_visual_cues := DEFAULT_EVENT_VISUAL_CUES
var high_frequency_graze_audio := DEFAULT_HIGH_FREQUENCY_GRAZE_AUDIO
var voice_locale := DEFAULT_VOICE_LOCALE
var last_validation_errors: Array[String] = []

func set_volume(group: String, value: float) -> bool:
	if not volumes.has(group):
		last_validation_errors = ["unknown group %s" % group]
		return false
	volumes[group] = clampf(value, 0.0, 1.0)
	last_validation_errors.clear()
	return true

func adjust_volume(group: String, delta: float) -> bool:
	return set_volume(group, volume_for(group) + delta)

func reset_volume(group: String) -> bool:
	if not DEFAULT_VOLUMES.has(group):
		last_validation_errors = ["unknown group %s" % group]
		return false
	return set_volume(group, float(DEFAULT_VOLUMES.get(group, 0.0)))

func reset_all() -> void:
	volumes = DEFAULT_VOLUMES.duplicate(true)
	event_visual_cues = DEFAULT_EVENT_VISUAL_CUES
	high_frequency_graze_audio = DEFAULT_HIGH_FREQUENCY_GRAZE_AUDIO
	voice_locale = DEFAULT_VOICE_LOCALE
	last_validation_errors.clear()

func reset_all_snapshot() -> Dictionary:
	reset_all()
	return {
		"volumes": volumes.duplicate(true),
		"event_visual_cues": event_visual_cues,
		"high_frequency_graze_audio": high_frequency_graze_audio,
		"voice_locale": voice_locale,
	}

func volume_for(group: String) -> float:
	return float(volumes.get(group, 0.0))

func effective_volume(group: String) -> float:
	return volume_for("master") * volume_for(group)

func toggle_event_visual_cues() -> void:
	event_visual_cues = not event_visual_cues

func toggle_high_frequency_graze_audio() -> void:
	high_frequency_graze_audio = not high_frequency_graze_audio

func cycle_voice_locale(direction: int = 1) -> String:
	var index := VOICE_LOCALES.find(voice_locale)
	if index < 0:
		index = 0
	var step := -1 if direction < 0 else 1
	voice_locale = VOICE_LOCALES[wrapi(index + step, 0, VOICE_LOCALES.size())]
	return voice_locale

func set_voice_locale(locale_id: String) -> bool:
	if not VOICE_LOCALES.has(locale_id):
		return false
	voice_locale = locale_id
	return true

func voice_locale_label(locale_id: String = "") -> String:
	var source_locale := locale_id
	if source_locale.is_empty():
		source_locale = voice_locale
	return String(VOICE_LOCALE_LABELS.get(source_locale, source_locale))

func voice_locale_options() -> Array[String]:
	var options: Array[String] = []
	for locale_id in VOICE_LOCALES:
		options.append(voice_locale_label(locale_id))
	return options

func voice_locale_index() -> int:
	return max(0, VOICE_LOCALES.find(voice_locale))

func validate() -> bool:
	last_validation_errors.clear()
	for group in GROUPS:
		if not volumes.has(group):
			last_validation_errors.append("missing %s" % group)
			continue
		var value := volume_for(group)
		if value < 0.0 or value > 1.0:
			last_validation_errors.append("invalid %s %.2f" % [group, value])
	if not VOICE_LOCALES.has(voice_locale):
		last_validation_errors.append("invalid voice locale %s" % voice_locale)
	return last_validation_errors.is_empty()

func group_rows() -> Array[Dictionary]:
	var rows: Array[Dictionary] = []
	for group in GROUPS:
		rows.append({
			"group": group,
			"volume": volume_for(group),
			"effective": effective_volume(group),
			"control_value": volume_for(group),
			"control_min": 0.0,
			"control_max": 1.0,
			"control_step": 0.1,
			"control_unit": "percent",
		})
	return rows

func summary() -> String:
	return "master %.0f music %.0f sfx %.0f ui %.0f voice %.0f voice_lang %s cues %s graze_audio %s" % [
		volume_for("master") * 100.0,
		volume_for("music") * 100.0,
		volume_for("sfx") * 100.0,
		volume_for("ui") * 100.0,
		volume_for("voice") * 100.0,
		voice_locale_label(),
		"on" if event_visual_cues else "off",
		"on" if high_frequency_graze_audio else "off",
	]
