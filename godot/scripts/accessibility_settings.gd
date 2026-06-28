class_name AccessibilitySettings
extends RefCounted

const PALETTE_NAMES: Array[String] = ["standard", "colorblind"]
const DEFAULT_LOW_FLASH := true
const DEFAULT_SIMPLIFIED_BACKGROUND := true
const DEFAULT_ALWAYS_SHOW_HITBOX := false
const DEFAULT_PRACTICE_GRAZE_RING := true
const DEFAULT_BULLET_ALPHA := 0.95
const DEFAULT_PALETTE_INDEX := 0

var low_flash := DEFAULT_LOW_FLASH
var simplified_background := DEFAULT_SIMPLIFIED_BACKGROUND
var always_show_hitbox := DEFAULT_ALWAYS_SHOW_HITBOX
var practice_graze_ring := DEFAULT_PRACTICE_GRAZE_RING
var bullet_alpha := DEFAULT_BULLET_ALPHA
var palette_index := DEFAULT_PALETTE_INDEX

var standard_palette := {
	"red": Color(0.95, 0.23, 0.28),
	"gold": Color(0.95, 0.72, 0.25),
	"cyan": Color(0.25, 0.80, 1.00),
	"violet": Color(0.76, 0.50, 1.00),
	"green": Color(0.40, 0.92, 0.55),
	"white": Color(0.95, 0.96, 1.00),
}

var colorblind_palette := {
	"red": Color(0.86, 0.49, 0.00),
	"gold": Color(0.94, 0.78, 0.18),
	"cyan": Color(0.00, 0.62, 0.78),
	"violet": Color(0.80, 0.47, 0.74),
	"green": Color(0.34, 0.70, 0.38),
	"white": Color(0.95, 0.96, 1.00),
}

func palette_name() -> String:
	return PALETTE_NAMES[palette_index]

func palette_options() -> Array[String]:
	return PALETTE_NAMES.duplicate()

func cycle_palette() -> void:
	palette_index = (palette_index + 1) % PALETTE_NAMES.size()

func adjust_bullet_alpha(delta: float) -> void:
	bullet_alpha = clampf(bullet_alpha + delta, 0.35, 1.0)

func reset_low_flash() -> bool:
	low_flash = DEFAULT_LOW_FLASH
	return low_flash

func reset_simplified_background() -> bool:
	simplified_background = DEFAULT_SIMPLIFIED_BACKGROUND
	return simplified_background

func reset_always_show_hitbox() -> bool:
	always_show_hitbox = DEFAULT_ALWAYS_SHOW_HITBOX
	return always_show_hitbox

func reset_practice_graze_ring() -> bool:
	practice_graze_ring = DEFAULT_PRACTICE_GRAZE_RING
	return practice_graze_ring

func reset_bullet_alpha() -> float:
	bullet_alpha = DEFAULT_BULLET_ALPHA
	return bullet_alpha

func reset_palette() -> String:
	palette_index = DEFAULT_PALETTE_INDEX
	return palette_name()

func reset_all() -> Dictionary:
	return {
		"low_flash": reset_low_flash(),
		"simplified_background": reset_simplified_background(),
		"always_show_hitbox": reset_always_show_hitbox(),
		"practice_graze_ring": reset_practice_graze_ring(),
		"bullet_alpha": reset_bullet_alpha(),
		"palette": reset_palette(),
	}

func color_for(color_name: String, fallback: Color) -> Color:
	var palette := colorblind_palette if palette_name() == "colorblind" else standard_palette
	var color: Color = palette.get(color_name, fallback)
	color.a *= bullet_alpha
	return color

func apply_alpha(color: Color) -> Color:
	color.a *= bullet_alpha
	return color

func background_fill() -> Color:
	return Color(0.055, 0.065, 0.075) if simplified_background else Color(0.08, 0.10, 0.12)

func border_color() -> Color:
	return Color(0.50, 0.56, 0.62) if simplified_background else Color(0.42, 0.48, 0.54)

func summary() -> String:
	return "low_flash %s bg %s hitbox %s graze %s alpha %.2f palette %s" % [
		"on" if low_flash else "off",
		"simple" if simplified_background else "normal",
		"always" if always_show_hitbox else "focus",
		"on" if practice_graze_ring else "off",
		bullet_alpha,
		palette_name(),
	]
