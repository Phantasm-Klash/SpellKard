extends Node2D

const PLAYFIELD := Rect2(Vector2(160, 48), Vector2(640, 624))
const PLAYER_SPEED := 330.0
const FOCUS_SPEED := 145.0
const HIT_RADIUS := 4.0
const GRAZE_RADIUS := 22.0
const BULLET_RADIUS := 5.0
const BULLET_SPEED := 125.0
const SPAWN_INTERVAL := 0.42

var player_pos := Vector2(480, 600)
var bullets: Array[Dictionary] = []
var spawn_timer := 0.0
var pattern_time := 0.0
var graze_count := 0
var hit_count := 0

@onready var hud := Label.new()

func _ready() -> void:
	add_child(hud)
	hud.position = Vector2(18, 14)
	hud.add_theme_font_size_override("font_size", 16)
	queue_redraw()

func _process(delta: float) -> void:
	if Input.is_action_just_pressed("ui_cancel"):
		get_tree().quit()

	_update_player(delta)
	_update_pattern(delta)
	_update_bullets(delta)
	_update_hud()
	queue_redraw()

func _update_player(delta: float) -> void:
	var direction := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	var speed := FOCUS_SPEED if Input.is_action_pressed("focus") else PLAYER_SPEED
	player_pos += direction * speed * delta
	player_pos = player_pos.clamp(PLAYFIELD.position, PLAYFIELD.position + PLAYFIELD.size)

func _update_pattern(delta: float) -> void:
	pattern_time += delta
	spawn_timer += delta
	if spawn_timer < SPAWN_INTERVAL:
		return

	spawn_timer = 0.0
	var center := Vector2(480, 110)
	var count := 18
	var offset := pattern_time * 0.85
	for i in range(count):
		var angle := offset + TAU * float(i) / float(count)
		bullets.append({
			"pos": center,
			"vel": Vector2.RIGHT.rotated(angle) * BULLET_SPEED,
			"grazed": false
		})

func _update_bullets(delta: float) -> void:
	for bullet in bullets:
		bullet["pos"] += bullet["vel"] * delta
		var distance := player_pos.distance_to(bullet["pos"])
		if not bullet["grazed"] and distance <= GRAZE_RADIUS:
			bullet["grazed"] = true
			graze_count += 1
		if distance <= HIT_RADIUS + BULLET_RADIUS:
			hit_count += 1
			bullet["pos"] = Vector2(-999, -999)

	bullets = bullets.filter(func(bullet: Dictionary) -> bool:
		var pos: Vector2 = bullet["pos"]
		return pos.x >= -32 and pos.x <= 992 and pos.y >= -32 and pos.y <= 752
	)

func _update_hud() -> void:
	hud.text = "SpellKard prototype\nGraze: %d\nHits: %d\nBullets: %d\nFocus: %s" % [
		graze_count,
		hit_count,
		bullets.size(),
		"on" if Input.is_action_pressed("focus") else "off"
	]

func _draw() -> void:
	draw_rect(PLAYFIELD, Color(0.10, 0.12, 0.14), true)
	draw_rect(PLAYFIELD, Color(0.45, 0.50, 0.55), false, 2.0)

	for bullet in bullets:
		var color := Color(0.95, 0.72, 0.25) if bullet["grazed"] else Color(0.95, 0.23, 0.28)
		draw_circle(bullet["pos"], BULLET_RADIUS, color)

	draw_circle(player_pos, 9.0, Color(0.35, 0.85, 1.00))
	if Input.is_action_pressed("focus"):
		draw_circle(player_pos, GRAZE_RADIUS, Color(0.35, 0.85, 1.00, 0.16))
		draw_circle(player_pos, HIT_RADIUS, Color(1.00, 1.00, 1.00))
