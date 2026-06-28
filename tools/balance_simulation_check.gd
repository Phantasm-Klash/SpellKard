extends SceneTree

const MAIN_SCENE := "res://scenes/main.tscn"

var main_node: Node = null
var frame_count := 0
var started := false

func _initialize() -> void:
	var packed_scene := load(MAIN_SCENE)
	if packed_scene == null:
		push_error("Balance simulation failed: missing main scene")
		quit(1)
		return
	main_node = packed_scene.instantiate()
	root.add_child(main_node)

func _process(_delta: float) -> bool:
	if started:
		return false
	frame_count += 1
	if frame_count < 2:
		return false
	started = true
	var report: Dictionary = main_node.call("_run_balance_simulation", {
		"duration_ticks": 540,
		"seeds": [20260625, 20260626],
	})
	var warnings: Array = report.get("warnings", [])
	var blocking_warnings: Array[String] = []
	for warning in warnings:
		if ["visual_readability", "performance_bullet_cap", "hit_rate_high", "card_usage_low"].has(str(warning)):
			blocking_warnings.append(str(warning))
	if not blocking_warnings.is_empty():
		push_error("Balance simulation failed: %s %s" % [report.get("reason", ""), blocking_warnings])
		quit(1)
		return true
	var aggregate: Dictionary = report.get("aggregate", {})
	if int(report.get("run_count", 0)) <= 0 or float(aggregate.get("average_score", 0.0)) <= 0.0:
		push_error("Balance simulation failed: invalid aggregate")
		quit(1)
		return true
	if int(aggregate.get("visual_unsafe_count", 0)) != 0:
		push_error("Balance simulation failed: visual readability regression")
		quit(1)
		return true
	print("balance_simulation_check ok: %s" % str(report.get("summary", "")))
	quit(0)
	return true
