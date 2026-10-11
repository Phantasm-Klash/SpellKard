#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compose_login_art.py -- offline regeneration of the SpellKard login-screen art.

WHY THIS EXISTS
---------------
The login screen originally shipped the *raw* 千夜追忆 (Thousand Night
Anamnesis) 1.40 APK art at its native size -- a 320x480 title backdrop and a
190x279 Reimu portrait -- and let the LayaAir runtime scale it up roughly 2.8x
to fill the 900x1200 web stage.  Upscaling at draw time cannot invent detail, so
the result was visibly soft.  The fix has to happen *offline*: resample /
recompose the art into a higher pixel density while keeping the aspect ratio
untouched.

Aspect ratio is a hard constraint: `src/core/game/login_assets.ts` hard-codes
LOGIN_BACKGROUND_SIZE = 320x480 and LOGIN_PORTRAIT_SIZE = 190x279, and the scene
uses coverFit(320,480,...) / containFit(190,279,...) to derive scale + offset.
Keeping the ratios (1200x1800 = 2:3 exactly; 570x837 keeps 190:279) means the TS
side needs *zero* changes.

Crucially the backdrop is NOT a naive upscale: a 320x480 image blown up 3.75x is
still a 320x480 image, only bigger.  Instead we REBUILD it from smooth,
resolution-independent layers -- vertical gradient, radial glow, a seamlessly
tileable star field, procedural stars -- and use the original art only as a
heavily blurred "atmosphere" layer, where its low resolution is invisible.

The reusable drawing primitives (palette, gradients, masks, tiling, stars,
grain, PNG writing) live in `artlib.py`, shared with `compose_lobby_art.py`.

DETERMINISM
-----------
Every random choice (star position / size / brightness / colour) is driven by a
fixed seed, so re-running reproduces identical output.  The Laya asset uuid for
the sigil is pinned as a constant as well, so re-running does not make the IDE
treat the sigil as a brand-new asset every time.

Dependencies: Python stdlib + Pillow only.  No network, no third-party packages.
"""

import argparse
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from artlib import (
    C_BOT,
    C_GLOW,
    C_GOLD,
    C_MID,
    C_STAR_COOL,
    C_STAR_WARM,
    C_TOP,
    add_grain,
    atomic_save_png,
    atomic_write_text,
    composite_solid,
    composite_stars,
    contain_fit,
    cover_fit,
    draw_placeholder_card,
    feathered_rect_mask,
    load_apk_png,
    load_font,
    nebula_layer,
    nebula_rgb,
    radial_glow_mask,
    sigil_meta_json,
    star_layer,
    vertical_gradient,
    vignette_mask,
)

# --- fixed seeds / pinned asset id ------------------------------------------

SEED = 20261010                 # stars
NOISE_SEED = SEED ^ 0x9E3779B9  # de-banding grain (independent of star order)

# Pinned so repeated runs do not churn the IDE asset database.  Regenerating a
# fresh uuid4 would also be valid, but a constant is friendlier to the IDE.
SIGIL_UUID = "b3f1c2a4-7d5e-4a91-9c6b-2f8e10d43a77"

# --- output sizes (aspect ratios MUST match login_assets.ts) ----------------

BG_SIZE = (1200, 1800)          # 2:3   == 320x480
PORTRAIT_SIZE = (570, 837)      # 190:279
SIGIL_SIZE = (512, 512)

# layer strengths (tuned against the offline previews)
GLOW_PEAK = 0.22
# The nebula tile is screen-blended twice at two *stretched* tile periods (2x and
# 3x, i.e. 512 px and 768 px).  Stretching does two things at once: it drops the
# repetition count on a 1200x1800 canvas to ~2 tiles, so no visible grid, and it
# smooths the tile so its per-pixel entropy (which is what makes the PNG large)
# falls sharply.  A light blur on top removes the last of the sharp single-pixel
# speckle -- the *sharp* stars are the procedural ones drawn later, so nothing of
# value is lost.  Alphas stay low: the tile is only here for fine star density.
NEBULA_SCALE_A = 2
NEBULA_SCALE_B = 3
NEBULA_BLUR = 1
NEBULA_ALPHA_A = 0.16
NEBULA_ALPHA_B = 0.08
ATMO_ALPHA = 0.30
VIGNETTE_PEAK = 0.55
CARD_DARK = 0.35
STAR_COUNT = 900
BRIGHT_STAR_COUNT = 25
NOISE_AMPLITUDE = 2              # +-2; lowered to +-1 if the PNG gets too big
NOISE_BLOCK = 4                  # grain is generated at 1/4 res, 4x4 blocks

DEFAULTS = {
    "apk": r"D:/gotouhou-work/Touhou+ThousandNightAnamnesis_1.40_APKPure.apk",
    "nebula": r"D:/gotouhou-work/SpellKard/laya/layaide/assets/resources/tna/bg_01_01.png",
    "out": r"D:/gotouhou-work/SpellKard/laya/layaide/assets/resources/login",
    "preview": r"D:/gotouhou-work/SpellKard/laya/dev/shots-login",
}


# --- deliverable 2: backdrop ------------------------------------------------

def build_background(apk_path, nebula_path):
    W, H = BG_SIZE

    # 1) vertical gradient base
    base = vertical_gradient(BG_SIZE, [(0.0, C_TOP), (0.5, C_MID), (1.0, C_BOT)])

    # 1b) magenta radial glow, centre ~62% / 26%, radius ~45% of height
    glow = radial_glow_mask(BG_SIZE, W * 0.62, H * 0.26, H * 0.45, GLOW_PEAK)
    base = composite_solid(base, C_GLOW, glow)

    # 2) seamless nebula tile, screen-blended at two stretched periods (512 and
    #    768 px).  This supplies fine star density at native resolution -- the
    #    key to "sharp" without any upscale.
    tile_rgb = nebula_rgb(nebula_path)
    base = Image.blend(base, ImageChops.screen(
        base, nebula_layer(tile_rgb, BG_SIZE, NEBULA_SCALE_A, NEBULA_BLUR)), NEBULA_ALPHA_A)
    base = Image.blend(base, ImageChops.screen(
        base, nebula_layer(tile_rgb, BG_SIZE, NEBULA_SCALE_B, NEBULA_BLUR)), NEBULA_ALPHA_B)

    # 4) original title art as a heavily blurred atmosphere layer.  Blur radius
    #    14 destroys the 320x480 pixel grid, so only the shrine silhouette and
    #    the colour mood survive; drawn before the stars so the stars stay crisp.
    art = load_apk_png(apk_path, "assets/bg_title.png").convert("RGB")
    scale = max(W / art.width, H / art.height)
    big = art.resize((int(round(art.width * scale)), int(round(art.height * scale))),
                     Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(14))
    ox, oy = (big.width - W) // 2, (big.height - H) // 2
    big = big.crop((ox, oy, ox + W, oy + H))
    ramp = Image.new("L", (1, H), 0)
    rp = ramp.load()
    for y in range(H):
        t = y / (H - 1)
        a = ATMO_ALPHA if t < 0.55 else (ATMO_ALPHA * (1.0 - (t - 0.55) / 0.15) if t < 0.70 else 0.0)
        rp[0, y] = int(max(0.0, a) * 255)
    ramp = ramp.resize((W, H), Image.Resampling.NEAREST)
    base = Image.composite(big, base, ramp)

    # 3) procedural stars on top of the atmosphere layer so they read as crisp
    base = composite_stars(base, star_layer(BG_SIZE, SEED, STAR_COUNT, BRIGHT_STAR_COUNT))

    # 5) readability darkening
    #    - global vignette
    base = composite_solid(base, (0, 0, 0), vignette_mask(BG_SIZE, VIGNETTE_PEAK))
    #    - card region: union of a bottom band and a left strip, both feathered.
    #      Covers the tall stage (card sits low-centre) and the wide stage (card
    #      sits upper-left) without stamping two hard rectangles.  max() avoids
    #      double-darkening the overlap.
    bottom = feathered_rect_mask(BG_SIZE, (0, int(H * 0.55), W, H), 60).point(lambda v: int(v * CARD_DARK))
    left = feathered_rect_mask(BG_SIZE, (0, 0, int(W * 0.40), H), 60).point(lambda v: int(v * CARD_DARK))
    base = composite_solid(base, (0, 0, 0), ImageChops.lighter(bottom, left))

    # 6) de-banding grain
    base = add_grain(base, NOISE_SEED, NOISE_AMPLITUDE, NOISE_BLOCK)

    return base.convert("RGBA")


# --- deliverable 3: portrait ------------------------------------------------

def build_portrait(apk_path):
    """Upscale Reimu with an alpha-correct (premultiplied) resample.

    A naive RGBA LANCZOS treats RGB and A independently: fully transparent
    source pixels are (0,0,0,0), so their black RGB bleeds into the edge ramp
    and produces a dark halo.  Premultiplying first (colour * alpha) makes the
    transparent pixels contribute zero colour, which is the mathematically
    correct linear filter of the *composited* signal; we then divide the alpha
    back out.  Result: a clean edge with no black or white fringe.
    """
    src = load_apk_png(apk_path, "assets/player_01.png")
    W, H = PORTRAIT_SIZE

    r, g, b, a = src.split()
    rgb = Image.merge("RGB", (r, g, b))
    alpha_rgb = Image.merge("RGB", (a, a, a))
    premul = ImageChops.multiply(rgb, alpha_rgb)            # colour * alpha / 255

    premul = premul.resize((W, H), Image.Resampling.LANCZOS)
    a_big = a.resize((W, H), Image.Resampling.LANCZOS)

    # light sharpen on the premultiplied colour only -- never on alpha, so the
    # silhouette cannot gain ringing.  UnsharpMask on the composited colour is
    # safe because transparent areas carry zero colour.
    premul = premul.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=3))

    pr, pg, pb = premul.split()
    ap = a_big.load()
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    op = out.load()
    sr, sg, sb = pr.load(), pg.load(), pb.load()
    for y in range(H):
        for x in range(W):
            av = ap[x, y]
            if av == 0:
                continue
            # unpremultiply, clamped to the valid 0..alpha range
            rr = min(av, int(sr[x, y] * 255 / av + 0.5))
            gg = min(av, int(sg[x, y] * 255 / av + 0.5))
            bb = min(av, int(sb[x, y] * 255 / av + 0.5))
            op[x, y] = (rr, gg, bb, av)
    return out


# --- deliverable 4: sigil ---------------------------------------------------

def build_sigil():
    """A soft gold-on-magenta spell-sigil disc on transparent black."""
    S = SIGIL_SIZE[0]
    SS = 4                                   # supersample factor for the line art
    N = S * SS
    cx = cy = N / 2.0

    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # inner magenta底光 -- kept faint so Reimu's portrait reads on top of it
    core = radial_glow_mask((S, S), S / 2.0, S / 2.0, 150.0, 0.18)
    core_layer = Image.new("RGBA", (S, S), C_GLOW + (0,))
    core_layer.putalpha(core)
    out = Image.alpha_composite(out, core_layer)

    # crisp line art drawn supersampled, then downscaled for anti-aliasing
    line = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ld = ImageDraw.Draw(line)

    def gold(a):
        return (C_GOLD[0], C_GOLD[1], C_GOLD[2], int(a * 255))

    def ring(radius, width, alpha):
        r = radius * SS
        w = max(1, int(round(width * SS)))
        ld.ellipse([cx - r, cy - r, cx + r, cy + r], outline=gold(alpha), width=w)

    def octagon(radius, width, alpha):
        r = radius * SS
        pts = [(cx + r * math.cos(math.radians(22.5 + 45 * k)),
                cy + r * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]
        pts.append(pts[0])
        ld.line(pts, fill=gold(alpha), width=max(1, int(round(width * SS))))

    def dashed(radius, count, alpha, width=1.5, dash_deg=5.0, gap_deg=5.0):
        r = radius * SS
        w = max(1, int(round(width * SS)))
        for k in range(count):
            a0 = k * (360.0 / count)
            ld.arc([cx - r, cy - r, cx + r, cy + r], a0, a0 + dash_deg,
                   fill=gold(alpha), width=w)

    ring(170, 3.0, 0.50)          # main ring
    ring(200, 1.5, 0.35)          # outer hairline ring
    octagon(185, 1.5, 0.25)       # subtle octagon
    for k in range(8):            # 8 radial ticks, r 175..205
        ang = math.radians(45 * k)
        x0, y0 = cx + 175 * SS * math.cos(ang), cy + 175 * SS * math.sin(ang)
        x1, y1 = cx + 205 * SS * math.cos(ang), cy + 205 * SS * math.sin(ang)
        ld.line([(x0, y0), (x1, y1)], fill=gold(0.45), width=max(1, int(round(3 * SS))))
    dashed(214, 40, 0.22)
    dashed(232, 56, 0.18)
    dashed(246, 72, 0.15)

    line = line.resize((S, S), Image.Resampling.LANCZOS)
    out = Image.alpha_composite(out, line)

    # soften every edge; never leave a hard aliased rim
    out = out.filter(ImageFilter.GaussianBlur(2.5))
    return out


# --- deliverable 5: offline composite previews ------------------------------

def render_preview(bg, portrait, sigil, stage, card_rect, portrait_rect, path):
    sw, sh = stage
    canvas = Image.new("RGB", stage, (0, 0, 0))

    # backdrop, cover-fit (matches coverFit(320,480,...) in the scene)
    s, x, y = cover_fit(320, 480, sw, sh)
    bgr = bg.resize((int(round(320 * s)), int(round(480 * s))), Image.Resampling.LANCZOS)
    canvas.paste(bgr, (x, y))

    px, py, pw, ph = portrait_rect
    # sigil: side = portrait height * 1.35, centred on the chest (~32% height)
    side = int(round(ph * 1.35))
    scx = px + pw / 2.0
    scy = py + ph * 0.32
    sig = sigil.resize((side, side), Image.Resampling.LANCZOS)
    canvas.paste(sig, (int(round(scx - side / 2.0)), int(round(scy - side / 2.0))), sig)

    # portrait, contain-fit into its rect (matches containFit(190,279,...))
    s2, ox, oy = contain_fit(190, 279, pw, ph)
    pr = portrait.resize((int(round(190 * s2)), int(round(279 * s2))), Image.Resampling.LANCZOS)
    canvas.paste(pr, (px + ox, py + oy), pr)

    # form card placeholder
    ov = Image.new("RGBA", stage, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    draw_placeholder_card(
        d, card_rect, "Sign in", ("Username", "Password"), "status: ready",
        ("Sign in", "Create account", "Back"),
        load_font(26), load_font(18), load_font(15),
    )

    canvas = Image.alpha_composite(canvas.convert("RGBA"), ov).convert("RGB")
    atomic_save_png(canvas, path, optimize=True)


# --- main -------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apk", default=DEFAULTS["apk"])
    ap.add_argument("--nebula", default=DEFAULTS["nebula"])
    ap.add_argument("--out", default=DEFAULTS["out"])
    ap.add_argument("--preview-dir", default=DEFAULTS["preview"])
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.preview_dir, exist_ok=True)

    print("building background ...")
    bg = build_background(args.apk, args.nebula)
    print("building portrait ...")
    portrait = build_portrait(args.apk)
    print("building sigil ...")
    sigil = build_sigil()

    bg_path = os.path.join(args.out, "login_bg.png")
    pr_path = os.path.join(args.out, "login_reimu.png")
    sg_path = os.path.join(args.out, "login_sigil.png")
    atomic_save_png(bg, bg_path, optimize=True)
    atomic_save_png(portrait, pr_path, optimize=True)
    atomic_save_png(sigil, sg_path, optimize=True)

    atomic_write_text(sigil_meta_json(SIGIL_UUID), sg_path + ".meta")

    render_preview(bg, portrait, sigil, (900, 1200),
                   (240, 612, 420, 426), (279, 96, 343, 504),
                   os.path.join(args.preview_dir, "art-preview-900x1200.png"))
    render_preview(bg, portrait, sigil, (1333, 750),
                   (24, 96, 420, 426), (992, 143, 317, 465),
                   os.path.join(args.preview_dir, "art-preview-1333x750.png"))

    for p in (bg_path, pr_path, sg_path, sg_path + ".meta",
              os.path.join(args.preview_dir, "art-preview-900x1200.png"),
              os.path.join(args.preview_dir, "art-preview-1333x750.png")):
        print("wrote %-70s %9d bytes" % (p, os.path.getsize(p)))


if __name__ == "__main__":
    main()
