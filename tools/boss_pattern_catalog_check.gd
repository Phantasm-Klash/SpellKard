extends SceneTree

const StageSelectModel := preload("res://scripts/stage_select_model.gd")
const BossPatternCatalog := preload("res://scripts/boss_pattern_catalog.gd")
const BossSpellbookModel := preload("res://scripts/boss_spellbook_model.gd")
const PatternLabModel := preload("res://scripts/pattern_lab_model.gd")

func _initialize() -> void:
	var stage_model: RefCounted = StageSelectModel.new()
	var coverage: Dictionary = BossPatternCatalog.validate_stage_patterns(stage_model)
	if not bool(coverage.get("ok", false)):
		push_error("Boss pattern catalog failed: missing=%s seen=%s" % [
			coverage.get("missing_types", []),
			coverage.get("seen_types", []),
		])
		quit(1)
		return
	var recipes: Dictionary = BossPatternCatalog.validate_open_source_recipes()
	if not bool(recipes.get("ok", false)):
		push_error("Boss pattern recipes failed: %s" % [recipes])
		quit(1)
		return
	var spellbook_model: RefCounted = BossSpellbookModel.new()
	var pattern_lab_model: RefCounted = PatternLabModel.new()
	pattern_lab_model.configure(stage_model, spellbook_model)
	var spellbooks: Dictionary = spellbook_model.validate_spellbooks()
	if not bool(spellbooks.get("ok", false)):
		push_error("Boss spellbooks failed: %s" % [spellbooks])
		quit(1)
		return
	var preview_exports: Dictionary = BossPatternCatalog.validate_spellbook_preview_exports(spellbook_model, pattern_lab_model, 20260625)
	if not bool(preview_exports.get("ok", false)):
		push_error("Boss spellbook preview exports failed: %s" % [preview_exports])
		quit(1)
		return
	var requirements: Dictionary = BossPatternCatalog.validate_boss_type_requirements(stage_model, spellbook_model)
	if not bool(requirements.get("ok", false)):
		push_error("Boss type requirements failed: %s" % [requirements])
		quit(1)
		return
	var official_types: Dictionary = BossPatternCatalog.validate_official_boss_type_coverage(stage_model, spellbook_model)
	if not bool(official_types.get("ok", false)):
		push_error("Official Boss type coverage failed: %s" % [official_types])
		quit(1)
		return
	var emitters: Dictionary = BossPatternCatalog.validate_pattern_emitters(stage_model, 20260625)
	if not bool(emitters.get("ok", false)):
		push_error("Boss pattern emitters failed: %s" % [emitters])
		quit(1)
		return
	var budgets: Dictionary = BossPatternCatalog.validate_performance_budgets(stage_model, spellbook_model, 20260625)
	if not bool(budgets.get("ok", false)):
		push_error("Boss pattern performance budgets failed: %s" % [budgets])
		quit(1)
		return
	print("boss_pattern_catalog_check ok: families=%d recipes=%d adapters=%d requirements=%d official_types=%d types=%d emitted=%d behavior_spawns=%d spellbooks=%d phases=%d previews=%d max_emit=%d max_behavior_spawn=%d max_spellbook_emit=%d" % [
		BossPatternCatalog.family_rows().size(),
		int(recipes.get("recipe_count", 0)),
		int(recipes.get("adapter_count", 0)),
		int(requirements.get("requirement_count", 0)),
		int(official_types.get("requirement_count", 0)),
		BossPatternCatalog.all_catalog_pattern_types().size(),
		int(emitters.get("emitted_type_count", 0)),
		(emitters.get("behavior_spawn_types", []) as Array).size(),
		int(spellbooks.get("spellbook_count", 0)),
		int(spellbooks.get("phase_count", 0)),
		int(preview_exports.get("preview_count", 0)),
		int(budgets.get("max_initial_emit", 0)),
		int(budgets.get("max_behavior_spawned_per_tick", 0)),
		int(budgets.get("max_spellbook_emit_per_tick", 0)),
	])
	quit(0)
