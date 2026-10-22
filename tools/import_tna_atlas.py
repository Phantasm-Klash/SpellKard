# -*- coding: utf-8 -*-
"""
把逆向提取的 cocos2d 图集转换为 LayaAir 3 可用的 .atlas + 贴图，并生成运行期索引。

输入：
  rev/assets/manifest.json + rev/assets/raw/*.png        （切分清单 + 原始图集纹理）
  rev/assets/standalone/player_*.png                     （自机立绘）
  PhK-Protocol/data/tna_contract.json                    （216 个 kEnemyBullet → 帧名）

输出（默认 SpellKard/laya/layaide/assets/tna/）：
  <atlas>.png + <atlas>.atlas      (LayaAir atlas 格式)
  player/player_NN.png             (自机立绘，独立贴图)
  index.json                       (帧名 → 图集 → 坐标；弹种 → 帧；立绘清单)

用法：
  python import_tna_atlas.py [--out <dir>] [--contract <json>] [--dry]

LayaAir atlas 结构（v3）：
{
  "meta":   { "image": "ebullet_1.png", "size": {"w":256,"h":256}, "scale":1, "prefix": "" },
  "frames": { "heart_01.png": { "frame": {"x":32,"y":96,"w":32,"h":32},
                                "sourceSize": {"w":32,"h":32},
                                "offset": {"x":0,"y":0},
                                "rotated": false } },
  "animations": []
}
"""
import argparse, json, os, re, shutil, sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WORK = os.path.dirname(os.path.dirname(_HERE))  # gotouhou-work/
DEFAULT_ASSETS = os.path.join(_WORK, "rev", "assets")
DEFAULT_CONTRACT = os.path.join(_WORK, "PhK-Protocol", "data", "tna_contract.json")
DEFAULT_OUT = os.path.join(_HERE, "..", "laya", "layaide", "assets", "resources", "tna")
DEFAULT_OUT = os.path.abspath(DEFAULT_OUT)

PLAYER_RE = re.compile(r"^player_\d+(_\d+)?\.png$")
BACKGROUND_RE = re.compile(r"^bg_\d+_\d+\.png$")

# 独立背景贴图（非图集），战斗场景用作弹幕背景。LayaAir 只打包 `assets/resources/`
# 资源目录下的资源，所以 tna 树必须落在 resources/ 下才能在 exe 里被加载到。
# 全部 `bg_NN_NN.png`（每关两层）+ 菜单背景；顺序按名字排序，保证可重放。
EXTRA_BACKGROUNDS = ["bg_menu.png"]

# UI 美术（独立贴图，非图集）——千夜追忆自带的界面件，导入到 `tna/ui/`。
# 原则见 laya/docs/ART_POLICY.md：界面美术同样只来自该 APK，客户端不自绘。
UI_IMAGES = [
    # 菜单标题条（原版把标题文字烘焙在图里，按语义逐张使用）
    "bar_boss_practice.png",
    "bar_boss_practice_rs.png",
    "bar_boss_rush.png",
    "bar_boss_rush_rs.png",
    "bar_chara_select.png",
    "bar_chara_select_rs.png",
    "bar_config.png",
    "bar_config_rs.png",
    "bar_game_over.png",
    "bar_game_over_rs.png",
    "bar_how_to_play.png",
    "bar_how_to_play_rs.png",
    "bar_level_select.png",
    "bar_level_select_rs.png",
    "bar_music_room.png",
    "bar_music_room_rs.png",
    "bar_option.png",
    "bar_option_rs.png",
    "bar_pause_menu.png",
    "bar_pause_menu_rs.png",
    "bar_player_data.png",
    "bar_player_data_rs.png",
    "bar_retry_menu.png",
    "bar_retry_menu_rs.png",
    "bar_spell_practice.png",
    "bar_spell_practice_rs.png",
    "bar_stage_clear.png",
    "bar_stage_clear_rs.png",
    "bar_stage_select.png",
    "bar_stage_select_rs.png",
    # 按钮 / 图标
    "btn_bomb.png",
    "btn_pause.png",
    "CloseNormal.png",
    "CloseSelected.png",
    "img_menu_arrow_01.png",
    "img_menu_arrow_02.png",
    # 滑杆（设置面板）
    "sliderTrack.png",
    "sliderThumb.png",
    "sliderProgress.png",
    # Boss 血环
    "e_life_bar_1.png",
    "e_life_bar_2.png",
    # 标题 logo（中/英/日/简繁变体）
    "title_logo.png",
    "title_logo_ch.png",
    "title_logo_en.png",
    "title_logo_rs.png",
    "title_logo_rs_2.png",
    "title_logo_en_2.png",
    # 符卡演出线 / 警戒线
    "spell_effect_line_1.png",
    "spell_effect_line_2.png",
    "spell_effect_caution_1.png",
    "spell_effect_caution_2.png",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", default=DEFAULT_ASSETS)
    ap.add_argument("--contract", default=DEFAULT_CONTRACT)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    with open(os.path.join(args.assets, "manifest.json"), encoding="utf-8") as f:
        man = json.load(f)

    kinds = []
    if os.path.exists(args.contract):
        with open(args.contract, encoding="utf-8") as f:
            contract = json.load(f)
        kinds = contract.get("bullet_kinds", [])
    else:
        # 回退：没有契约文件时沿用现有 index.json 的弹种表，避免在缺契约的
        # 机器上重新导入把 216 条弹种映射清空（图集/背景/UI 仍可正常重建）。
        existing = os.path.join(args.out, "index.json")
        if os.path.exists(existing):
            with open(existing, encoding="utf-8") as f:
                prev = json.load(f).get("kinds", {})
            kinds = [{"type": int(t), **v} for t, v in prev.items()]
            print(f"!! 缺少契约 {args.contract}，沿用现有 index.json 的 {len(kinds)} 条弹种", file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)
    os.makedirs(os.path.join(args.out, "player"), exist_ok=True)

    # 按图集聚合帧
    by_atlas = {}
    for fr in man["frames"]:
        by_atlas.setdefault(fr["atlas"], []).append(fr)

    written = []
    index_atlases = {}
    index_frames = {}
    clamped_count = 0
    for a in man["atlases"]:
        name, tex = a["name"], a["texture"]
        frames = by_atlas.get(name, [])
        if not frames:
            continue
        # 复制贴图
        src_tex = os.path.join(args.assets, "raw", tex)
        dst_tex = os.path.join(args.out, tex)
        if not os.path.exists(src_tex):
            print(f"!! 缺少原始贴图 {src_tex}", file=sys.stderr)
            sys.exit(2)
        if not args.dry:
            shutil.copy2(src_tex, dst_tex)

        w, h = [int(x) for x in a["actual_texture"].split("x")]
        atlas = {
            "meta": {"image": tex, "size": {"w": w, "h": h}, "scale": 1, "prefix": ""},
            "frames": {},
            "animations": [],
        }
        for fr in frames:
            # 少量原版图集陈旧，plist 里的帧矩形越界（见 rev/docs/porting_plan.md §7）。
            # 裁剪到贴图边界，保持图集可用；这些帧不在 216 个弹种里。
            fw, fh = fr["w"], fr["h"]
            clamped = False
            if fr["x"] + fw > w:
                fw = max(0, w - fr["x"])
                clamped = True
            if fr["y"] + fh > h:
                fh = max(0, h - fr["y"])
                clamped = True
            if clamped:
                clamped_count += 1
            atlas["frames"][fr["name"]] = {
                "frame": {"x": fr["x"], "y": fr["y"], "w": fw, "h": fh},
                "sourceSize": {"w": fw, "h": fh},
                "offset": {"x": 0, "y": 0},
                "rotated": bool(fr["rotated"]),
            }
            index_frames[f'{name}/{fr["name"]}'] = {
                "atlas": name,
                "frame": fr["name"],
                "x": fr["x"],
                "y": fr["y"],
                "w": fw,
                "h": fh,
                "sourceW": fw,
                "sourceH": fh,
                "offsetX": 0,
                "offsetY": 0,
                "rotated": bool(fr["rotated"]),
                "clamped": clamped,
            }
        dst_atlas = os.path.join(args.out, name + ".atlas")
        if not args.dry:
            with open(dst_atlas, "w", encoding="utf-8", newline="\n") as f:
                json.dump(atlas, f, ensure_ascii=False, indent=1)
        index_atlases[name] = {
            "texture": tex,
            "size": {"w": w, "h": h},
            "frames": len(frames),
        }
        written.append((name, len(frames), tex))

    # 自机立绘
    players = sorted(p for p in man["standalone_images"] if PLAYER_RE.match(p))
    for p in players:
        if not args.dry:
            shutil.copy2(os.path.join(args.assets, "standalone", p),
                         os.path.join(args.out, "player", p))

    # 独立背景贴图：全部 `bg_NN_NN.png`（每关两层）+ 菜单背景
    standalone = set(man["standalone_images"])
    backgrounds = sorted(b for b in standalone if BACKGROUND_RE.match(b))
    for extra in EXTRA_BACKGROUNDS:
        if extra in standalone and extra not in backgrounds:
            backgrounds.append(extra)
    for b in backgrounds:
        if not args.dry:
            shutil.copy2(os.path.join(args.assets, "standalone", b),
                         os.path.join(args.out, b))

    # UI 美术（独立贴图）→ tna/ui/
    ui_dir = os.path.join(args.out, "ui")
    if not args.dry:
        os.makedirs(ui_dir, exist_ok=True)
    ui_images = [u for u in UI_IMAGES if u in standalone]
    for u in ui_images:
        if not args.dry:
            shutil.copy2(os.path.join(args.assets, "standalone", u),
                         os.path.join(ui_dir, u))

    # 弹种 → 帧 索引 + 完整性校验
    index_kinds = {}
    missing = []
    for k in kinds:
        key = f'{k["atlas"]}/{k["frame"]}'
        index_kinds[str(k["type"])] = {"atlas": k["atlas"], "frame": k["frame"]}
        if key not in index_frames:
            missing.append((k["type"], key))

    index = {
        "meta": {
            "source": man.get("source_apk", "千夜追忆"),
            "generated_by": "SpellKard/tools/import_tna_atlas.py",
            "frame_count": len(index_frames),
            "atlas_count": len(index_atlases),
            "kind_count": len(index_kinds),
            "player_count": len(players),
            "background_count": len(backgrounds),
            "ui_count": len(ui_images),
            "clamped_count": clamped_count,
        },
        "atlases": index_atlases,
        "frames": index_frames,
        "kinds": index_kinds,
        "players": [f"player/{p}" for p in players],
        "backgrounds": list(backgrounds),
        "ui": [f"ui/{u}" for u in ui_images],
    }
    if not args.dry:
        with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(index, f, ensure_ascii=False, indent=1)

    print(f"输出目录: {os.path.abspath(args.out)}")
    print(f"图集 {len(written)} 个：")
    for n, c, t in written:
        print(f"  {n:16s} {c:4d} 帧  ->  {n}.atlas + {t}")
    print(f"自机立绘 {len(players)} 张 -> player/")
    print(f"背景贴图 {len(backgrounds)} 张 -> {', '.join(backgrounds) if backgrounds else '(无)'}")
    print(f"UI 美术 {len(ui_images)} 张 -> ui/")
    print(f"索引帧 {len(index_frames)} 条；弹种 {len(index_kinds)} 条")
    if clamped_count:
        print(f"  已裁剪越界帧 {clamped_count} 条（原版图集陈旧，见 rev/docs/porting_plan.md §7）")
    if missing:
        print(f"!! {len(missing)} 个弹种的帧名不在图集中：")
        for t, key in missing[:20]:
            print(f"   type={t} {key}")
        sys.exit(3)
    if args.dry:
        print("(dry-run，未写文件)")


if __name__ == "__main__":
    main()
