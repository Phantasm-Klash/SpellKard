#!/usr/bin/env python3
"""Static CI checks for client protocol, i18n, and asset metadata."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


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
        if not isinstance(path, str) or not path:
            errors.append(f"asset_manifest records[{index}]: missing path")
            continue
        registered.add(path)
        repo_path = "godot/" + path.removeprefix("res://") if path.startswith("res://") else path
        if not isinstance(license_name, str) or not license_name:
            errors.append(f"asset_manifest {path}: missing license")
        if not isinstance(source, str) or not source:
            errors.append(f"asset_manifest {path}: missing source_url")
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
    return errors


def main() -> int:
    errors: list[str] = []
    errors.extend(check_json_files())
    errors.extend(check_i18n_keys())
    errors.extend(check_assets_manifest())
    errors.extend(check_protocol_client_scripts())
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("ci_static_checks ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
