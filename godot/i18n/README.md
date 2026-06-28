# i18n

Godot-visible text lives in JSON packages and is addressed by stable keys from gameplay code.

Current prototype load order:

1. `base.en.json`
2. Optional `base.<locale>.json`
3. Optional `themes/<theme_id>.<locale>.json`
4. Optional `themes/<theme_id>.en.json` fallback for non-English locales

Current built-in locales:

- `en`
- `zh-CN`

Future layers should append locale patches, theme text packages, and Workshop packages in that order. Replay and gameplay data should keep codes and keys, not rendered strings.
