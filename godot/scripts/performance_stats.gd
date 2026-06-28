class_name PerformanceStats
extends RefCounted

var frame_time_ms := 0.0
var logic_tick_ms := 0.0
var max_logic_tick_ms := 0.0
var bullet_count := 0
var player_shot_count := 0
var peak_bullet_count := 0
var collision_check_count := 0
var dropped_frame_count := 0
var correction_count := 0
var spawn_limit_event_count := 0
var last_tick_started_usec := 0

func begin_tick() -> void:
	last_tick_started_usec = Time.get_ticks_usec()
	collision_check_count = 0

func end_tick(current_bullets: int, current_player_shots: int) -> void:
	var elapsed_usec := Time.get_ticks_usec() - last_tick_started_usec
	logic_tick_ms = float(elapsed_usec) / 1000.0
	max_logic_tick_ms = max(max_logic_tick_ms, logic_tick_ms)
	bullet_count = current_bullets
	player_shot_count = current_player_shots
	peak_bullet_count = max(peak_bullet_count, current_bullets)

func record_frame(delta: float, expected_delta: float, frame_ticks: int, max_frame_ticks: int) -> void:
	frame_time_ms = delta * 1000.0
	if frame_ticks >= max_frame_ticks and delta > expected_delta * float(max_frame_ticks):
		dropped_frame_count += 1

func record_collision_checks(count: int = 1) -> void:
	collision_check_count += count

func record_spawn_limit_event() -> void:
	spawn_limit_event_count += 1

func summary() -> String:
	return "frame %.2fms tick %.3fms max %.3fms bullets %d/%d shots %d checks %d drops %d limits %d corrections %d" % [
		frame_time_ms,
		logic_tick_ms,
		max_logic_tick_ms,
		bullet_count,
		peak_bullet_count,
		player_shot_count,
		collision_check_count,
		dropped_frame_count,
		spawn_limit_event_count,
		correction_count,
	]
