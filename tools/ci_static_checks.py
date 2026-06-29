#!/usr/bin/env python3
"""Static CI checks for client protocol, i18n, and asset metadata."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLIENT_MENU_PAGE_MODEL = ROOT / "godot" / "scripts" / "client_menu_page_model.gd"
CLIENT_SHELL_MODEL = ROOT / "godot" / "scripts" / "client_shell_model.gd"


def load_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def check_json_files() -> list[str]:
    errors: list[str] = []
    for path in sorted(ROOT.glob("godot/**/*.json")):
        try:
            load_json(path)
        except json.JSONDecodeError as exc:
            errors.append(f"{path.relative_to(ROOT)}: invalid JSON: {exc}")
    return errors


def check_text_encoding_and_line_endings() -> list[str]:
    errors: list[str] = []
    roots = [ROOT / "godot" / "scripts", ROOT / "tools", ROOT / "tests"]
    suffixes = {".gd", ".py", ".md"}
    for root in roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix not in suffixes:
                continue
            rel = path.relative_to(ROOT).as_posix()
            try:
                raw = path.read_bytes()
                raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                errors.append(f"{rel}: must be valid UTF-8: {exc}")
                continue
            if b"\r\n" in raw or b"\r" in raw:
                errors.append(f"{rel}: must use LF line endings")
    return errors


def check_i18n_keys() -> list[str]:
    errors: list[str] = []
    locales = {
        path.name: load_json(path)
        for path in sorted((ROOT / "godot" / "i18n").glob("*.json"))
    }
    if len(locales) < 2:
        return errors

    key_sets = {name: set(data.keys()) for name, data in locales.items() if isinstance(data, dict)}
    all_keys = set().union(*key_sets.values())
    for name, keys in key_sets.items():
        missing = sorted(all_keys - keys)
        if missing:
            errors.append(f"godot/i18n/{name}: missing keys: {', '.join(missing[:20])}")
    return errors


def check_boss_pattern_catalog_contract() -> list[str]:
    errors: list[str] = []
    catalog = ROOT / "godot" / "scripts" / "boss_pattern_catalog.gd"
    spellbook = ROOT / "godot" / "scripts" / "boss_spellbook_model.gd"
    pattern_lab = ROOT / "godot" / "scripts" / "pattern_lab_model.gd"
    replay_store = ROOT / "godot" / "scripts" / "replay_store.gd"
    replay_list = ROOT / "godot" / "scripts" / "replay_list_model.gd"
    catalog_check = ROOT / "tools" / "boss_pattern_catalog_check.gd"
    for path in [catalog, spellbook, pattern_lab, replay_store, replay_list, catalog_check]:
        if not path.exists():
            errors.append(f"{path.relative_to(ROOT)}: missing")
            return errors

    catalog_text = catalog.read_text(encoding="utf-8")
    required_type_tokens = [
        '"n_way"',
        '"aimed"',
        '"rotating_rings"',
        '"spiral"',
        '"curtain_wall"',
        '"laser_warning_fire"',
        '"split_branching"',
        '"delayed_blossom"',
        '"homing"',
        '"orbital_lattice"',
        '"stream_weave"',
        '"random_seeded"',
        '"phase_script"',
        '"spellcard_timeout_enrage"',
    ]
    for token in required_type_tokens:
        if token not in catalog_text:
            errors.append(f"godot/scripts/boss_pattern_catalog.gd: missing Boss type token {token}")
    for token in [
        "OPEN_SOURCE_ADAPTERS",
        '"license"',
        '"provenance"',
        '"mechanic_syntax_only"',
        '"engine_concept_only"',
        '"design_reference_only"',
        '"direct_copy"',
        "MAX_INITIAL_EMIT_BULLETS_PER_PATTERN",
        "validate_performance_budgets",
        "validate_official_boss_type_coverage",
        "validate_spellbook_preview_exports",
        "_spellbook_phase_bullet_cap",
        "spellbook_phase_emit_budget",
    ]:
        if token not in catalog_text:
            errors.append(f"godot/scripts/boss_pattern_catalog.gd: missing catalog contract token {token}")

    spellbook_text = spellbook.read_text(encoding="utf-8")
    for token in [
        "EXPORT_SCHEMA_VERSION",
        "DEFAULT_PREVIEW_SEED",
        "PREVIEW_SAMPLE_TICKS",
        "GOLDEN_PREVIEW_FIXTURES",
        "deterministic_phase_preview",
        "golden_preview_fixtures",
        "phase_script_config",
        "phase_export_data",
        "validate_phase_preview_exports",
        "signature_digest",
        "phase_script",
        "bullet_cap_per_tick",
        "seed_policy",
        "preview_export_id",
        '"license"',
        '"provenance"',
        "timeout_ticks",
        "enrage_after_ticks",
        '"enrage"',
        "missing_timeout",
        "missing_enrage",
        "preview_not_reproducible",
        "golden_preview_digest",
        "missing_golden_preview",
        "golden_preview_headroom",
        "golden_preview_sample_ticks",
        "preview_bullet_cap",
        "budget_headroom",
        "performance_budget_status",
    ]:
        if token not in spellbook_text:
            errors.append(f"godot/scripts/boss_spellbook_model.gd: missing timeout/enrage token {token}")

    pattern_lab_text = pattern_lab.read_text(encoding="utf-8")
    for token in [
        "rows_for_spellbook_phase",
        "rows_for_spellbook",
        '"catalog_id"',
        '"phase_id"',
        '"deterministic_preview_signature"',
        '"deterministic_preview_digest"',
        '"bullet_cap_per_tick"',
        '"performance_budget_status"',
        '"preview_export_id"',
        '"preview_sample_ticks"',
        '"preview_sample_count"',
    ]:
        if token not in pattern_lab_text:
            errors.append(f"godot/scripts/pattern_lab_model.gd: missing spellbook Pattern Lab token {token}")

    for replay_path in [replay_store, replay_list]:
        replay_text = replay_path.read_text(encoding="utf-8")
        for token in ['"catalog_id"', '"spellbook_id"', '"phase_id"', '"preview_export_id"', '"preview_signature_digest"', '"preview_sample_ticks"', '"preview_sample_count"', '"preview_budget_headroom"', '"performance_budget_status"', '"metadata_valid"', '"metadata_status"', '"server_authoritative"']:
            if token not in replay_text:
                errors.append(f"{replay_path.relative_to(ROOT)}: missing spellbook replay metadata token {token}")
    if "validate_spellbook_preview_metadata" not in replay_store.read_text(encoding="utf-8"):
        errors.append("godot/scripts/replay_store.gd: missing exact spellbook preview metadata validator")

    check_text = catalog_check.read_text(encoding="utf-8")
    for token in [
        "validate_official_boss_type_coverage",
        "validate_performance_budgets",
        "validate_spellbook_preview_exports",
        "_validate_replay_metadata",
        "PatternLabModel",
        "ReplayStore",
        "preview_count",
        "golden_preview_count",
        "replay_metadata",
        "max_spellbook_emit",
        "fixture_authoritative_spellbook_preview",
        "fixture_over_budget_spellbook_preview",
        "fixture_stale_digest_spellbook_preview",
        "fixture_stale_samples_spellbook_preview",
        "fixture_bad_sample_count_spellbook_preview",
        "fixture_missing_samples_spellbook_preview",
        "bad_sample_count_replay_accepted",
        "missing_sample_window_replay_accepted",
        "TightSpellbookBudgetModel",
        "_validate_phase_budget_regression",
        "tight_phase_budget_accepted",
        "tight_phase_budget_failure_missing",
        "tight_phase_budget_row_missing",
        "spellbook_phase_emit_budget:nonspell_radial_entry",
        "validate_spellbook_preview_metadata",
        "preview_sample_ticks",
        "preview_sample_count",
        "preview_budget_headroom",
        "performance_budget_status",
    ]:
        if token not in check_text:
            errors.append(f"tools/boss_pattern_catalog_check.gd: missing catalog check token {token}")
    return errors


def check_assets_manifest() -> list[str]:
    errors: list[str] = []
    manifest_path = ROOT / "godot" / "assets" / "asset_manifest.json"
    manifest = load_json(manifest_path)
    if not isinstance(manifest, dict):
        return ["godot/assets/asset_manifest.json: expected object"]

    entries = manifest.get("records", [])
    if not isinstance(entries, list):
        return ["godot/assets/asset_manifest.json: records must be an array"]

    registered = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"asset_manifest records[{index}]: expected object")
            continue
        path = entry.get("path")
        license_name = entry.get("license")
        source = entry.get("source_url")
        provenance = entry.get("provenance")
        if not isinstance(path, str) or not path:
            errors.append(f"asset_manifest records[{index}]: missing path")
            continue
        registered.add(path)
        repo_path = "godot/" + path.removeprefix("res://") if path.startswith("res://") else path
        if not isinstance(license_name, str) or not license_name:
            errors.append(f"asset_manifest {path}: missing license")
        if not isinstance(source, str) or not source:
            errors.append(f"asset_manifest {path}: missing source_url")
        if not isinstance(provenance, str) or not provenance:
            errors.append(f"asset_manifest {path}: missing provenance")
        if not (ROOT / repo_path).exists():
            errors.append(f"asset_manifest {path}: file does not exist")

    asset_roots = [ROOT / "godot" / "themes", ROOT / "godot" / "assets"]
    for root in asset_roots:
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix in {".md", ".json", ".import"}:
                continue
            rel = path.relative_to(ROOT).as_posix()
            godot_rel = "res://" + rel.removeprefix("godot/")
            if rel not in registered and godot_rel not in registered:
                errors.append(f"{rel}: asset file is not registered in asset_manifest.json")
    return errors


def _extract_const_dict(text: str, const_name: str) -> str | None:
    marker = f"const {const_name} :="
    start = text.find(marker)
    if start < 0:
        return None
    brace_start = text.find("{", start)
    if brace_start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(brace_start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[brace_start : index + 1]
    return None


def _extract_top_level_keys(dict_text: str) -> set[str]:
    keys: set[str] = set()
    index = 0
    depth = 0
    in_string = False
    escaped = False
    while index < len(dict_text):
        char = dict_text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            if depth == 1:
                end = index + 1
                while end < len(dict_text):
                    if dict_text[end] == '"' and dict_text[end - 1] != "\\":
                        break
                    end += 1
                after = end + 1
                while after < len(dict_text) and dict_text[after].isspace():
                    after += 1
                if after < len(dict_text) and dict_text[after] == ":":
                    keys.add(dict_text[index + 1 : end])
                index = end + 1
                continue
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        index += 1
    return keys


def _extract_page_blocks(page_specs_text: str) -> dict[str, str]:
    pages: dict[str, str] = {}
    index = 0
    depth = 0
    in_string = False
    escaped = False
    while index < len(page_specs_text):
        char = page_specs_text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            if depth == 1:
                end = index + 1
                while end < len(page_specs_text):
                    if page_specs_text[end] == '"' and page_specs_text[end - 1] != "\\":
                        break
                    end += 1
                key = page_specs_text[index + 1 : end]
                after = end + 1
                while after < len(page_specs_text) and page_specs_text[after].isspace():
                    after += 1
                if after < len(page_specs_text) and page_specs_text[after] == ":":
                    block_start = page_specs_text.find("{", after)
                    if block_start >= 0:
                        block_depth = 0
                        block_in_string = False
                        block_escaped = False
                        for block_end in range(block_start, len(page_specs_text)):
                            block_char = page_specs_text[block_end]
                            if block_in_string:
                                if block_escaped:
                                    block_escaped = False
                                elif block_char == "\\":
                                    block_escaped = True
                                elif block_char == '"':
                                    block_in_string = False
                                continue
                            if block_char == '"':
                                block_in_string = True
                            elif block_char == "{":
                                block_depth += 1
                            elif block_char == "}":
                                block_depth -= 1
                                if block_depth == 0:
                                    pages[key] = page_specs_text[block_start : block_end + 1]
                                    index = block_end + 1
                                    break
                        continue
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        index += 1
    return pages


def _extract_string_value(block: str, field: str) -> str:
    marker = f'"{field}":'
    index = block.find(marker)
    if index < 0:
        return ""
    quote = block.find('"', index + len(marker))
    if quote < 0:
        return ""
    end = block.find('"', quote + 1)
    if end < 0:
        return ""
    return block[quote + 1 : end]


def _extract_array_values(block: str, field: str) -> list[str]:
    marker = f'"{field}":'
    index = block.find(marker)
    if index < 0:
        return []
    open_bracket = block.find("[", index)
    close_bracket = block.find("]", open_bracket)
    if open_bracket < 0 or close_bracket < 0:
        return []
    raw = block[open_bracket + 1 : close_bracket]
    return [item.strip().strip('"') for item in raw.split(",") if item.strip()]


def _asset_paths_from_usage(items: list[str]) -> list[str]:
    paths: list[str] = []
    for item in items:
        marker = "res://"
        index = item.find(marker)
        if index >= 0:
            paths.append(item[index:])
    return paths


def check_ui_page_contracts() -> list[str]:
    errors: list[str] = []
    text = CLIENT_MENU_PAGE_MODEL.read_text(encoding="utf-8")
    page_specs_text = _extract_const_dict(text, "PAGE_SPECS")
    scene_contracts_text = _extract_const_dict(text, "SCENE_CONTRACTS")
    page_scene_ids_text = _extract_const_dict(text, "PAGE_SCENE_IDS")
    if page_specs_text is None or scene_contracts_text is None or page_scene_ids_text is None:
        return ["godot/scripts/client_menu_page_model.gd: missing page contract constants"]

    pages = _extract_page_blocks(page_specs_text)
    scene_map_keys = _extract_top_level_keys(page_scene_ids_text)
    if not pages:
        return ["godot/scripts/client_menu_page_model.gd: PAGE_SPECS did not parse"]

    required_pages = {"main_menu", "play", "collection", "community", "player_settings", "match", "network_match"}
    missing_required = sorted(required_pages - set(pages))
    if missing_required:
        errors.append(f"godot/scripts/client_menu_page_model.gd: missing required pages: {', '.join(missing_required)}")

    manifest = load_json(ROOT / "godot" / "assets" / "asset_manifest.json")
    manifest_paths = {
        str(entry.get("path", ""))
        for entry in manifest.get("records", [])
        if isinstance(entry, dict)
    } if isinstance(manifest, dict) else set()

    for page_id, block in pages.items():
        primary = _extract_array_values(block, "primary_row_ids")
        state_regions = _extract_array_values(block, "state_regions")
        layout_slots = _extract_array_values(block, "layout_slots")
        status_regions = _extract_array_values(block, "status_region_ids")
        controller_actions = _extract_array_values(block, "controller_actions")
        focus_actions = _extract_array_values(block, "focus_action_ids")
        asset_usage = _extract_array_values(block, "asset_usage")
        input_methods = _extract_array_values(block, "input_methods")
        focus_sections = _extract_array_values(block, "focus_sections")
        text_fit_policy = _extract_array_values(block, "text_fit_policy")
        visual_asset = _extract_string_value(block, "visual_asset")
        treatment = _extract_string_value(block, "visual_treatment")
        if not primary:
            errors.append(f"PAGE_SPECS[{page_id}]: missing primary_row_ids")
        if not state_regions:
            errors.append(f"PAGE_SPECS[{page_id}]: missing state_regions")
        if not treatment:
            errors.append(f"PAGE_SPECS[{page_id}]: missing visual_treatment")
        if not layout_slots and '"layout_slots"' not in text:
            errors.append(f"PAGE_SPECS[{page_id}]: missing layout_slots/default")
        if not status_regions and '"status_region_ids"' not in text:
            errors.append(f"PAGE_SPECS[{page_id}]: missing status_region_ids/default")
        if not controller_actions and "func _controller_actions_for_spec" not in text:
            errors.append(f"PAGE_SPECS[{page_id}]: missing controller_actions/default")
        effective_controller_actions = controller_actions
        if not effective_controller_actions and "func _controller_actions_for_spec" in text:
            effective_controller_actions = ["ui_up", "ui_down", "ui_accept"]
        if "ui_up" not in effective_controller_actions or "ui_down" not in effective_controller_actions or "ui_accept" not in effective_controller_actions:
            errors.append(f"PAGE_SPECS[{page_id}]: controller_actions missing base navigation")
        if not focus_actions and "func _default_focus_action_ids" not in text:
            errors.append(f"PAGE_SPECS[{page_id}]: missing focus_action_ids/default")
        if not asset_usage and '"asset_usage"' not in text:
            errors.append(f"PAGE_SPECS[{page_id}]: missing asset_usage/default")
        if not input_methods and "DEFAULT_INPUT_METHODS" not in text:
            errors.append(f"PAGE_SPECS[{page_id}]: missing input_methods/default")
        effective_input_methods = input_methods or ["keyboard", "gamepad", "mouse"]
        for method in ["keyboard", "gamepad", "mouse"]:
            if method not in effective_input_methods:
                errors.append(f"PAGE_SPECS[{page_id}]: input_methods missing {method}")
        if not focus_sections and "func _focus_sections_for_spec" not in text:
            errors.append(f"PAGE_SPECS[{page_id}]: missing focus_sections/default")
        effective_focus_sections = focus_sections
        if not effective_focus_sections and "func _focus_sections_for_spec" in text:
            effective_focus_sections = ["navigation_rail", "focus_panel", "row_window"]
        if page_id in {"play", "collection", "community", "player_settings"}:
            for section in ["category_tabs", "focus_panel", "row_window"]:
                if section not in effective_focus_sections:
                    errors.append(f"PAGE_SPECS[{page_id}]: focus_sections missing {section}")
        if not text_fit_policy and "DEFAULT_TEXT_FIT_POLICY" not in text:
            errors.append(f"PAGE_SPECS[{page_id}]: missing text_fit_policy/default")
        effective_text_fit = text_fit_policy or ["clip_button_text", "ellipsis_overrun", "wrap_labels", "minimum_44x22_targets"]
        for policy in ["clip_button_text", "ellipsis_overrun", "wrap_labels", "minimum_44x22_targets"]:
            if policy not in effective_text_fit:
                errors.append(f"PAGE_SPECS[{page_id}]: text_fit_policy missing {policy}")
        if visual_asset:
            if visual_asset not in manifest_paths:
                errors.append(f"PAGE_SPECS[{page_id}]: visual_asset not registered: {visual_asset}")
            repo_path = ROOT / ("godot/" + visual_asset.removeprefix("res://"))
            if not repo_path.exists():
                errors.append(f"PAGE_SPECS[{page_id}]: visual_asset missing: {visual_asset}")
            for usage_path in _asset_paths_from_usage(asset_usage):
                if usage_path not in manifest_paths:
                    errors.append(f"PAGE_SPECS[{page_id}]: asset_usage path not registered: {usage_path}")
                if usage_path != visual_asset and usage_path not in manifest_paths:
                    errors.append(f"PAGE_SPECS[{page_id}]: asset_usage path missing manifest record: {usage_path}")
        elif page_id in required_pages:
            errors.append(f"PAGE_SPECS[{page_id}]: missing visual_asset")
        if page_id not in scene_map_keys:
            errors.append(f"PAGE_SCENE_IDS: missing page {page_id}")

    shell_text = CLIENT_SHELL_MODEL.read_text(encoding="utf-8")
    main_rows_start = shell_text.find("func main_menu_rows()")
    main_rows_end = shell_text.find("func home_dashboard_cards()", main_rows_start)
    main_rows_text = shell_text[main_rows_start:main_rows_end]
    for expected in ['"id": "play"', '"id": "collection"', '"id": "community"', '"id": "player_settings"']:
        if expected not in main_rows_text:
            errors.append(f"client_shell_model.gd main_menu_rows missing {expected}")
    for forbidden in ['"id": "certification"', '"id": "deck"', '"id": "replay"', '"id": "settings"']:
        if forbidden in main_rows_text:
            errors.append(f"client_shell_model.gd main_menu_rows should not expose {forbidden}")

    main_text = (ROOT / "godot" / "scripts" / "main.gd").read_text(encoding="utf-8")
    for token in [
        "func _ui_visible_mouse_health_check()",
        "func _ui_focus_section_runtime_check(page_layout: Dictionary)",
        '"page_focus_sections_missing_visible"',
        '"visible_mouse_blocked_count"',
    ]:
        if token not in main_text:
            errors.append(f"godot/scripts/main.gd: missing UI runtime interaction health token {token}")
    ui_smoke_text = (ROOT / "tools" / "client_ui_smoke_test.gd").read_text(encoding="utf-8")
    for token in [
        '"visible_mouse_blocked_count"',
        '"page_focus_section_missing_visible_count"',
    ]:
        if token not in ui_smoke_text:
            errors.append(f"tools/client_ui_smoke_test.gd: missing UI interaction smoke token {token}")
    return errors


def check_protocol_client_scripts() -> list[str]:
    errors: list[str] = []
    required = (
        "godot/scripts/gensoulkyo_http_client.gd",
        "godot/scripts/battle_network_client_model.gd",
        "godot/scripts/network_security_model.gd",
        "godot/scripts/protocol_descriptor_model.gd",
    )
    for rel in required:
        path = ROOT / rel
        if not path.exists():
            errors.append(f"{rel}: missing required network/protocol client script")
        elif path.read_text(encoding="utf-8").count("\r\n"):
            errors.append(f"{rel}: must use LF line endings")
    battle_model = ROOT / "godot" / "scripts" / "battle_network_client_model.gd"
    if battle_model.exists():
        text = battle_model.read_text(encoding="utf-8")
        for token in [
            "func build_mode_action(",
            "build_packet_header(\"mode_action\"",
            "\"match_id\": match_id",
            "\"player_id\": player_id",
            "\"action_id\": normalized_action_id",
            "\"action_type\": normalized_action_type",
            "\"payload_json\": JSON.stringify",
            "\"tick\": tick",
            "\"seq\": action_seq",
            "\"client_result_authoritative\": false",
        ]:
            if token not in text:
                errors.append(f"godot/scripts/battle_network_client_model.gd: missing BattleModeAction builder token {token}")
    smoke_test = ROOT / "tools" / "client_smoke_test.gd"
    if smoke_test.exists():
        text = smoke_test.read_text(encoding="utf-8")
        for token in [
            "_battle_network_build_mode_action",
            "JSON.parse_string(String(battle_mode_action_payload.get(\"payload_json\", \"\")))",
            "\"action-smoke-transport\"",
            "\"client_result_authoritative\"",
        ]:
            if token not in text:
                errors.append(f"tools/client_smoke_test.gd: missing BattleModeAction smoke token {token}")
    return errors


def main() -> int:
    errors: list[str] = []
    errors.extend(check_text_encoding_and_line_endings())
    errors.extend(check_json_files())
    errors.extend(check_i18n_keys())
    errors.extend(check_assets_manifest())
    errors.extend(check_ui_page_contracts())
    errors.extend(check_protocol_client_scripts())
    errors.extend(check_boss_pattern_catalog_contract())
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("ci_static_checks ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
