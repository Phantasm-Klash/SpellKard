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

# 独立背景贴图（非图集），战斗场景用作弹幕背景。LayaAir 只打包 `assets/resources/`
# 资源目录下的资源，所以 tna 树必须落在 resources/ 下才能在 exe 里被加载到。
BACKGROUND_IMAGES = ["bg_01_01.png"]


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

    # 独立背景贴图
    backgrounds = [b for b in BACKGROUND_IMAGES if b in man["standalone_images"]]
    for b in backgrounds:
        if not args.dry:
            shutil.copy2(os.path.join(args.assets, "standalone", b),
                         os.path.join(args.out, b))

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
            "clamped_count": clamped_count,
        },
        "atlases": index_atlases,
        "frames": index_frames,
        "kinds": index_kinds,
        "players": [f"player/{p}" for p in players],
        "backgrounds": list(backgrounds),
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
