# SpellKard

SpellKard is the open-source Godot client project for Phantasm Klash.

The current prototype starts the local STG client loop: movement, focus speed, visible focus hitbox, simple bullet spawning, graze counting, hit counting, and a debug HUD.

## Run

Open `godot/project.godot` with Godot 4.x and run the main scene.

Controls:

- Arrow keys or WASD: move.
- Shift: focus speed and show hitbox.
- Escape: quit.

## Current State

This is a minimal client prototype. It does not connect to Gensoulkyo yet.

## Directory Plan

- `godot/`: Godot project.
- `godot/scenes/`: scene files.
- `godot/scripts/`: gameplay scripts.
- `godot/assets/`: client assets and license records.
- `godot/themes/`: theme packages.
- `docs/`: client implementation notes.
- `dev/`: client development progress.
- `tools/`: asset, replay, and validation utilities.
- `tests/`: client-side tests and replay fixtures.

## Licensing

Code is licensed under MIT. Documentation and original non-code text are licensed under CC BY 4.0 unless a file states otherwise. Assets require per-file license metadata.

