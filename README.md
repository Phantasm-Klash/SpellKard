# SpellKard

SpellKard is the open-source Godot client project for Phantasm Klash.

The current prototype starts the local STG client loop and a player-facing shell: fixed tick movement, focus speed, visible focus hitbox, deterministic bullet pattern spawning, graze counting, hit counting, a simplified home screen with a large character-portrait area, second-level menu pages, optional gameplay/debug HUD surfaces, and keyboard-driven menu rows with reusable section/control/value metadata.

## Run

Open `godot/project.godot` with Godot 4.x and run the main scene.

Controls:

- Arrow keys or WASD: move.
- Shift: focus speed and show hitbox.
- Z: shoot.
- X: bomb.
- R: restart local practice.
- 1-4: play cards from the current hand.
- Up / Down: move the visible UI row cursor.
- Left / Right: cycle UI screens, including the player-facing play hub, certification hub, community/friends/promotions pages, player settings, and advanced debug pages.
- Enter: apply the selected UI row, including screen navigation, deck card editing/saving, stage/stage-pattern/character selection, stage-run toggling, player setting changes, mode actions, activity claim requests, queue flow, chest opening, replay loading, and result actions.
- F1-F6: switch the current stage's first six bullet patterns.
- Tab: cycle bullet patterns inside the selected stage.
- M: hold a debug pattern modifier that changes speed, density, and angle offset.
- P: build a replay snapshot from the current practice run and play it back.
- End: save the current local replay snapshot to `user://replays/latest_local_replay.json`.
- B / N: select an entry from the local replay index.
- C: toggle favorite on the selected replay index entry.
- V: remove the selected replay from the local index without deleting the replay file.
- Insert: load the selected local replay snapshot and play it back.
- J / K: adjust replay seek target backward or forward by 300 ticks.
- Delete: seek the loaded replay to the target tick and pause there.
- Space: pause or resume replay/practice ticking.
- - / =: change replay/practice simulation speed.
- Home: restart replay playback from the snapshot.
- H: toggle bullet hitbox debug draw.
- L: toggle recent event log.
- O: toggle debug overlay guides.
- I: toggle the full debug HUD and performance stats.
- [ / ]: decrease or increase practice start tick by 600 ticks.
- ; / ': change the locked practice seed.
- , / .: decrease or increase starting power.
- /: cycle starting Bomb count.
- F7: toggle low-flash mode.
- F8: toggle simplified background.
- F9: toggle always-show hitbox.
- F10: toggle practice graze ring.
- F11: cycle bullet color palette.
- F12: cycle local text locale.
- PageUp / PageDown: adjust bullet opacity.
- \: cycle local input profile and apply its key bindings.
- Escape: quit.

## Validation

From `godot/`, run:

```powershell
..\..\Godot_v4.7-stable_win64_console.exe --headless --path . --script ..\tools\client_smoke_test.gd
..\..\Godot_v4.7-stable_win64_console.exe --headless --path . --script ..\tools\client_ui_smoke_test.gd
..\..\Godot_v4.7-stable_win64_console.exe --headless --path . --script ..\tools\balance_simulation_check.gd
..\..\Godot_v4.7-stable_win64_console.exe --headless --path . --script ..\tools\latency_matrix_check.gd
..\..\Godot_v4.7-stable_win64_console.exe --headless --path . --script ..\tools\asset_manifest_check.gd
```

## Current State

This is still primarily a local client prototype. It now includes a Gensoulkyo HTTP contract adapter plus a Godot `HTTPRequest` transport wrapper for the first open-source server MVP. A live local HTTP check can log in, bootstrap server-owned inventory/decks/chests, sync inventory, save the active deck to the server, sync server deck lists, sync server chest pools, open a server-authoritative chest with returned audit/result projection, request a server-authoritative card upgrade from the returned dust/card state, send heartbeat presence for queue/match/disconnected states, form a match with two sessions through matchmaking, create and cancel a pre-match room ticket, form another match through a room code, ready, submit input, receive server bullet and active-card snapshots, poll cursor-based server events, submit a server-validated Boss mode action, disconnect/reconnect with full snapshot restore, settle, read the server-generated replay audit record, request a post-settlement rematch from both participants, ready the fresh rematch match, and claim activity against Gensoulkyo. WSS match streaming and polished online play screens are still pending.

Implemented bullet pattern bases:

- Ring / spiral ring, safe-gap ring, alternating ring, spiral stack, morph ring, stop-release ring, boomerang return ring, orbit-hold release ring, two-phase velocity-shift ring, and radius pulse/growing-orb ring.
- Aimed n-way fan, aimed burst, curved fan, wall-bounce lanes, and speed-gradient shots.
- Seeded random arc, staggered grid rain, edge-spawn lanes, converging cloud, vortex force field, curtain wall, sine stream, snake stream, and moving gate lanes.
- Split chain, delayed blossom, exploding star, telegraphed burst, charge-convert burst, delayed one-shot aim, limited-turn homing, flower/petal weave, orbital lattice, summoner orbit, path emitters, path-following bullets, Bezier path-following bullets, and moving trail emitters.
- Laser-warning curtain, sweep laser, capsule beam sweep, rotating persistent laser, cross warning laser, extending capsule laser, polyline curved laser, reflected polyline laser, and dynamic wave polyline laser with continuous graze support.

Pattern parameters are config dictionaries and can be rewritten through card-style modifiers such as speed multiplier, density multiplier, angle offset, curve strength, and aim bias. `stage_select_model.gd` groups the current patterns into four local practice stages with difficulty, tempo, recommended character, localized names, UI-ready stage/pattern rows, and a stage briefing that summarizes the selected stage's math-route, density/danger peaks, readability hints, and recommended self mode. The local Stage Run action turns a selected stage into an automatic phase sequence, advancing through that stage's pattern list on a fixed timer while manual pattern selection remains available for focused drills. `pattern_lab_model.gd` analyzes those configs into practice/settings rows with math basis, family, parameter summary, spawn-rate, density, danger, and readability hints so the player can understand the bullet grammar before switching into a pattern.

Implemented local card systems:

- Practice deck, four-card hand, draw interval, energy cost, and per-card cooldowns.
- Self cards for focus control, hitbox shrink, Bomb amplification, and one-hit guard.
- Pattern cards for density/speed pressure and tempo reduction.
- Card play events recorded in the replay event stream.
- Local deck-builder model with card catalog rows, rarity/type filtering, server inventory level projection, upgrade-cost preview metadata, UI row add/remove editing, 20-card deck validation, ownership/copy/rarity/interference/ranked-ban checks, invalid-save rejection, active deck save/load, and replay `deck_snapshot` export.
- Local open-source chest system with wallet/chest ownership, weighted pool rows, probability rows, 10/60 pity counters, duplicate-to-dust conversion, inventory grants, and audit records for each opening.

Implemented local client systems:

- Tick-indexed input encoding for movement, focus, shoot, bomb, and card slot.
- Prototype player shots with high-speed spread and focus concentration.
- Bomb, short invulnerability, and deathbomb window.
- Score, graze combo, multiplier, survival score, power growth, and pickup-line risk reward.
- Replay recorder skeleton for input stream, event stream, and state hash checkpoints.
- Local replay snapshot playback with pause/resume, speed steps, restart, guarded target tick seek, state hash checkpoints, final result hash validation, JSON save/load for the latest local replay, deck snapshot persistence, local replay index metadata, and a reusable replay-list model for selection/loading/favorite/remove rows.
- Practice/debug toggles for bullet hitboxes, playfield guides, and recent event logs.
- Runtime performance stats for frame time, logic tick time, bullet counts, collision checks, dropped frames, spawn limit events, and correction count placeholder.
- Rule-level balance simulation model that batch-runs current pattern configs, active deck cards, character configs, and bullet visual readability checks across seeds, then reports average score, graze, hits, card plays, peak bullets, character/pattern score rows, and blocking/non-blocking warnings.
- Latency matrix test model and standalone headless gate for the multiplayer test docs. It exercises 30/80/150/250ms profiles, packet loss, jitter, short reconnect, input-delay bounds, snapshot correction metrics, mode action gates, battle royale deadline stability, Boss card-transfer idempotency, and certification server-result display using isolated model instances so the main client state is not mutated by the test run.
- Practice controls for locked seed, start tick prewarm, starting power, starting Bomb count, quick restart, Stage Run phase sequencing across a selected stage's pattern list, and Boss Spellbook practice that runs an authored multi-phase Boss script through the shared bullet engine.
- Local character/shot-type model with balanced, precision, wide-range, and spell-power bodies. Character config now drives practice movement speed, focus speed, normal/focus shot lanes, shot cadence, Bomb strength, graze value, spell-power gain, hitbox visual scale, settings rows, and localized names.
- Bullet visual-language model that classifies bullets as small orbs, large orbs, stars, homing bullets, or laser warnings; assigns speed/danger presentation hints; keeps presentation radius at least as large as collision radius; lowers decorative alpha during high-density phases; and marks card-modified bullets with outlines without changing hit rules.
- Accessibility toggles for low flash, simplified background, bullet opacity, always-visible hitbox, practice graze ring, colorblind-friendly bullet palette, default restore helpers for each visual option, and local settings persistence.
- Audio settings model for master/music/SFX/UI/voice volume groups, key-event visual cues, high-frequency graze-audio suppression, runtime bus application, per-group/default restore helpers, and local settings persistence.
- Input profile validation for required gameplay actions, with local left-hand/right-hand keyboard presets, single-action rebinding, capture-style key binding from the temporary settings shell, binding row export, restore-to-profile behavior that rewrites Godot `InputMap`, default reset helpers for profiles/key bindings/gamepad values, local settings persistence, and gamepad left-stick deadzone/sensitivity/curve handling for local movement.
- Local JSON i18n text packs for HUD and card names, runtime locale cycling, with smoke coverage for missing keys, base pack loading, and zh-CN overlay loading.
- Asset and theme manifest gates for license/provenance tracking before production media import.
- Runtime theme registry that loads the base manifest, discovers and activates local Workshop-style theme manifests, applies theme text overlays, rejects gameplay-rule replacements, and exposes presentation-only replacement scope.
- UI screen state model for main menu, play hub, certification hub, practice/stage selection, matching, modes, deck builder, chest, activity, community, friends, social links, promotions, Workshop, replay list, player settings, input/audio/display subpages, advanced settings, and results screens, with row data sourced from the deck/chest/replay/input/audio/accessibility/theme/stage models.
- Programmatic Godot `Control` shell with a simplified home surface and richer second-level pages. The home screen hides the gameplay playfield/HUD, reserves a large character standee/portrait region, shows compact play/friends/deck status, and exposes only four primary buttons: Play, Collection, Community, and Player Settings. `UIScreenModel.page_layout()` now exposes a stable page contract for final scenes: home lobby, hub, settings, community, matchmaking, network room, playfield, battle room, collection, and mode-select pages declare panel policy, primary rows, parent route, and gameplay draw/tick behavior. Second-level pages render the reusable row model into a scrolling panel with a focusable/clickable left navigation rail, top-level Play/Collection/Community/Settings category tabs, localized navigation path, compact client status summary, four primary status cards for Play/Collection/Community/Settings state, a page focus panel with one-click primary action, section summary bar, focusable section tabs, two-column overview/action cards, parent/Home quick-action toolbar, localized section headers, control preview, selected-row section/control/state/details, simple slider bars, selector positions, contextual selector/slider/toggle/capture/reset buttons, and focusable/clickable row buttons while the final screen layouts are still pending. The play hub now exposes player-facing Practice, Matchmaking, PvP Duel, and World Boss cards first, with room/deck and PvP/Boss mode rows still available in the row list. Matchmaking and network-room pages are now menu surfaces rather than background bullet demos; the matchmaking page prioritizes Quick Match, Ranked, PvP Duel, and Boss Party cards; practice is the local playfield; running network battle pages can draw server-projected bullets without advancing the local practice tick. Selected settings expose previous/next, decrease/increase, toggle, capture, and reset controls for gamepad curves, key bindings, audio volume, resolution/window/FPS, VSync, accessibility, and related sliders.
- Local matchmaking/network state model for anonymous dev session bootstrap, config-version status, profile/wallet/deck/activity pull placeholders, config-driven certification/PvP-duel/battle-royale/world-boss/instance-boss rows, active deck validation before queueing, ranked network-quality gating, queue/found/ready/cancel states, and 30-second reconnect status. This is a client intent/status surface only; authoritative match creation, snapshots, results, rank, damage, and rewards remain server-owned.
- Gensoulkyo HTTP contract model for `/v1/auth/anonymous`, `/v1/bootstrap`, inventory/card-upgrade/deck sync/save, chest sync/open, `/v1/presence/heartbeat`, matchmaking join/ticket/cancel, room create/join, match ready/input/snapshot/events/mode-action/disconnect/reconnect/settle/rematch, replay read, and activity claim payloads. It sends the current stage/character selection as non-authoritative `mode_params`, then applies server-confirmed inventory/card-upgrade/decks/chests and loadouts from bootstrap, explicit sync, server card upgrade, server chest opening, queue, heartbeat, match-start, snapshot, settlement, rematch, and replay responses into the deck, chest, matchmaking, and network-match surfaces. It can apply server-shaped login/bootstrap/inventory/card-upgrade/decks/deck-save/chests/chest-open/heartbeat/queue/cancel/room/ready/input/snapshot/event-stream/mode-action/reconnect/match-end/rematch/replay/activity-claim responses into the existing matchmaking, network-match, mode, chest, deck, and results models while rejecting client-authored reward/chest-result/upgrade-result authority. A Godot `HTTPRequest` client can drive the current MVP endpoints in order; WSS streaming and final online UX are still pending.
- Local server-authoritative network match surface for loading/ready/running/end states, tick-indexed input packet encoding with monotonic tick/seq checks, adaptive 2-4 tick input delay, server-confirmed loadout display, server snapshot intake, server bullet spawn/sync/move/despawn projection, server active-card projection, cursor-based server event intake, recent server event logs, smooth/interpolate/resimulate/hard-snap correction classification, full-snapshot request rows, mode-state summaries, anti-cheat forbidden client-result guards, latency metrics, authoritative online replay metadata, server replay audit-record intake, and match-end settlement handoff into the results service when server reward fields are present. The temporary draw path can render server-owned bullets during a running online match while keeping local practice simulation separate.
- Local game-mode state model for certification rank/top-30% qualification display, battle royale 5-10 player gate, shared pool validation, 30-second round candidate selection, zero-round order/effect trigger display, world Boss 4-8 player party positions, one-time card transfer requests, persistent HP/result notice display, and instance Boss clear/star-condition display. Mode actions remain requests only; rank, candidates, damage, Boss HP, clear state, and rewards stay server-owned.
- Local results/rewards surface for server-provided match settlements, reward ledger rows, wallet display, task progress, event points, leaderboard rows, compensation claims, activity claim-request rows, server-confirmed activity claim settlements, and result/activity-screen data. Match settlements are idempotent by `match_id:user_id`, activity claim settlements are idempotent by `claim_kind:claim_id:user_id`, pending activity claims are non-authoritative requests, and client-authored rewards are rejected.

## Directory Plan

- `godot/`: Godot project.
- `godot/scenes/`: scene files.
- `godot/scripts/`: gameplay scripts.
- `godot/i18n/`: local text packages.
- `godot/assets/`: client assets, machine-readable asset manifest, and license records.
- `godot/themes/`: theme packages.
- `docs/`: client implementation notes.
- `dev/`: client development progress.
- `tools/`: asset, replay, and validation utilities.
- `tests/`: client-side tests and replay fixtures.

## Asset Policy

Production media must be listed in `godot/assets/asset_manifest.json` before it enters `godot/assets/` or `godot/themes/`. The base repository must not include unlicensed fan assets or official Touhou media; replaceable themes belong in theme packages or Workshop distribution.

## Licensing

Code is licensed under MIT. Documentation and original non-code text are licensed under CC BY 4.0 unless a file states otherwise. Assets require per-file license metadata.
