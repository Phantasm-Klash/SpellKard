extends SceneTree

const MAIN_SCENE := "res://scenes/main.tscn"

var main_node: Node = null
var frame_count := 0
var started := false

func _initialize() -> void:
	var packed_scene := load(MAIN_SCENE)
	if packed_scene == null:
		push_error("Latency matrix failed: missing main scene")
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
	var report: Dictionary = main_node.call("_run_latency_tests")
	if not bool(report.get("ok", false)):
		push_error("Latency matrix failed: %s" % [report.get("warnings", [])])
		quit(1)
		return true
	var aggregate: Dictionary = report.get("aggregate", {})
	if int(report.get("scenario_count", 0)) < 6 or int(aggregate.get("max_input_delay_ticks", 0)) > 4:
		push_error("Latency matrix failed: invalid aggregate")
		quit(1)
		return true
	if float(aggregate.get("reconnect_success_rate", 0.0)) < 1.0 or int(aggregate.get("mode_count", 0)) < 4 or int(aggregate.get("mode_ok_count", 0)) != int(aggregate.get("mode_count", -1)):
		push_error("Latency matrix failed: reconnect/mode acceptance invalid")
		quit(1)
		return true
	print("latency_matrix_check ok: %s" % str(report.get("summary", "")))
	quit(0)
	return true
