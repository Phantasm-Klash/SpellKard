class_name InputCodec
extends RefCounted

const DIR_LEFT := 1
const DIR_RIGHT := 2
const DIR_UP := 4
const DIR_DOWN := 8

static func read_local(card_slot: int = 0) -> Dictionary:
	var direction_bits := 0
	if Input.is_action_pressed("move_left"):
		direction_bits |= DIR_LEFT
	if Input.is_action_pressed("move_right"):
		direction_bits |= DIR_RIGHT
	if Input.is_action_pressed("move_up"):
		direction_bits |= DIR_UP
	if Input.is_action_pressed("move_down"):
		direction_bits |= DIR_DOWN
	var requested_slot := card_slot
	for slot in range(4):
		if Input.is_action_just_pressed("card_%d" % [slot + 1]):
			requested_slot = slot + 1
	return {
		"direction_bits": direction_bits,
		"slow_pressed": Input.is_action_pressed("focus"),
		"shoot_pressed": Input.is_action_pressed("shoot"),
		"bomb_pressed": Input.is_action_just_pressed("bomb"),
		"card_slot": requested_slot,
	}

static func direction_from_bits(direction_bits: int) -> Vector2:
	var direction := Vector2.ZERO
	if direction_bits & DIR_LEFT:
		direction.x -= 1.0
	if direction_bits & DIR_RIGHT:
		direction.x += 1.0
	if direction_bits & DIR_UP:
		direction.y -= 1.0
	if direction_bits & DIR_DOWN:
		direction.y += 1.0
	return direction.normalized() if direction.length_squared() > 1.0 else direction

static func empty_state() -> Dictionary:
	return {
		"direction_bits": 0,
		"slow_pressed": false,
		"shoot_pressed": false,
		"bomb_pressed": false,
		"card_slot": 0,
	}
