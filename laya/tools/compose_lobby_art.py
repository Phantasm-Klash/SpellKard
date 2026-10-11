#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compose_lobby_art.py -- offline generation of the SpellKard lobby backdrop.

WHY THIS EXISTS
---------------
The lobby main menu used to be a purely vector screen with no art, so it read as
a plain card next to the now high-resolution login starfield.  This script gives
it a backdrop built from the *same* visual language as `login_bg.png` -- same
palette, same tileable nebula, same procedural stars -- so the two screens look
like one game.

It differs from the login backdrop in exactly the three ways the menu needs:
  1. no shrine silhouette (the login page uses that as its hero element; on a
     centred menu it would fight the card for attention);
  2. the readability darkening is a CENTRED vertical band, not the login page's
     asymmetric "bottom 55% + left 40%" -- the menu content is centred;
  3. it is darker and calmer overall, so the menu text and buttons are the hero.

Resolution independence: like the login backdrop, this is REBUILT from smooth
procedural layers (gradient, glow, tile, stars), never an upscale of a small
image, so 1200x1800 carries real native-resolution detail.  Output is 2:3
(1200x1800 == the 320x480 aspect the cover-fit code assumes), so nothing in the
TS layer needs to change beyond wiring the sprite.

Determinism: fixed seeds, and a pinned sigil-style uuid for the `.png.meta`, so
re-running is byte-stable.

Dependencies: Python stdlib + Pillow only, via the shared `artlib`.
"""

import argparse
import os

from PIL import Image, ImageChops, ImageDraw

from artlib import (
    C_GLOW,
    C_STAR_COOL,
    C_STAR_WARM,
    add_grain,
    atomic_save_png,
    atomic_write_text,
    composite_solid,
    composite_stars,
    cover_fit,
    draw_placeholder_card,
    feathered_rect_mask,
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

SEED = 20261011                 # stars (a different pattern from the login page)
NOISE_SEED = SEED ^ 0x9E3779B9  # de-banding grain

# Pinned so repeated runs do not churn the IDE asset database.
LOBBY_UUID = "c7a4d1e8-3b26-4f5a-8e07-1d9b62f0c4aa"

# --- output size (2:3, matches the 320x480 aspect the cover-fit uses) -------

BG_SIZE = (1200, 1800)

# Darker, calmer palette than the login page: the menu should not glow.
L_TOP = (0x05, 0x04, 0x09)
L_MID = (0x10, 0x07, 0x1E)
L_BOT = (0x1C, 0x0A, 0x22)

GLOW_PEAK = 0.15                 # weaker than login's 0.22
NEBULA_SCALE_A = 2
NEBULA_SCALE_B = 3
NEBULA_BLUR = 1
NEBULA_ALPHA_A = 0.14            # dimmer than login's 0.16/0.08
NEBULA_ALPHA_B = 0.07
GLOBAL_DIM = 0.16                # extra overall darkening ("quieter")
VIGNETTE_PEAK = 0.50
BAND_DARK = 0.34                 # centred vertical band over the content column
BAND_X0 = 0.18
BAND_X1 = 0.82
BAND_FEATHER = 100
STAR_COUNT = 900
BRIGHT_STAR_COUNT = 25
NOISE_AMPLITUDE = 2
NOISE_BLOCK = 4

DEFAULTS = {
    "nebula": r"D:/gotouhou-work/SpellKard/laya/layaide/assets/resources/tna/bg_01_01.png",
    "out": r"D:/gotouhou-work/SpellKard/laya/layaide/assets/resources/lobby",
    "preview": r"D:/gotouhou-work/SpellKard/laya/dev/shots-lobby",
}


def build_background(nebula_path):
    W, H = BG_SIZE

    # 1) vertical gradient base (darker than the login page)
    base = vertical_gradient(BG_SIZE, [(0.0, L_TOP), (0.5, L_MID), (1.0, L_BOT)])

    # 2) soft magenta glow, centred horizontally (the menu is centred too)
    glow = radial_glow_mask(BG_SIZE, W * 0.5, H * 0.30, H * 0.42, GLOW_PEAK)
    base = composite_solid(base, C_GLOW, glow)

    # 3) seamless nebula tile at two stretched periods, screen-blended, same
    #    trick as the login backdrop (breaks the grid, keeps PNG small)
    tile_rgb = nebula_rgb(nebula_path)
    base = Image.blend(base, ImageChops.screen(
        base, nebula_layer(tile_rgb, BG_SIZE, NEBULA_SCALE_A, NEBULA_BLUR)), NEBULA_ALPHA_A)
    base = Image.blend(base, ImageChops.screen(
        base, nebula_layer(tile_rgb, BG_SIZE, NEBULA_SCALE_B, NEBULA_BLUR)), NEBULA_ALPHA_B)

    # 4) procedural stars (same look as login, different seed)
    base = composite_stars(base, star_layer(BG_SIZE, SEED, STAR_COUNT, BRIGHT_STAR_COUNT))

    # 5) readability darkening -- global dim, then vignette, then a CENTRED
    #    vertical band (feathered) so the middle column stays calm for the menu.
    base = composite_solid(base, (0, 0, 0), Image.new("L", BG_SIZE, int(GLOBAL_DIM * 255)))
    base = composite_solid(base, (0, 0, 0), vignette_mask(BG_SIZE, VIGNETTE_PEAK))
    band = feathered_rect_mask(
        BG_SIZE, (int(W * BAND_X0), 0, int(W * BAND_X1), H), BAND_FEATHER
    ).point(lambda v: int(v * BAND_DARK))
    base = composite_solid(base, (0, 0, 0), band)

    # 6) de-banding grain
    base = add_grain(base, NOISE_SEED, NOISE_AMPLITUDE, NOISE_BLOCK)

    return base.convert("RGBA")


def render_preview(bg, stage, card_rect, path):
    sw, sh = stage
    canvas = Image.new("RGB", stage, (0, 0, 0))

    # backdrop, cover-fit (matches coverFit(320,480,...) in the scene)
    s, x, y = cover_fit(320, 480, sw, sh)
    bgr = bg.resize((int(round(320 * s)), int(round(480 * s))), Image.Resampling.LANCZOS)
    canvas.paste(bgr, (x, y))

    # centred menu-card placeholder (visual only)
    ov = Image.new("RGBA", stage, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    draw_placeholder_card(
        d, card_rect, "Main menu", (), "Not signed in",
        ("Sign in", "Play", "Check-in", "Shop", "Inventory"),
        load_font(26), load_font(18), load_font(15),
    )
    canvas = Image.alpha_composite(canvas.convert("RGBA"), ov).convert("RGB")
    atomic_save_png(canvas, path, optimize=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--nebula", default=DEFAULTS["nebula"])
    ap.add_argument("--out", default=DEFAULTS["out"])
    ap.add_argument("--preview-dir", default=DEFAULTS["preview"])
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.preview_dir, exist_ok=True)

    print("building lobby background ...")
    bg = build_background(args.nebula)

    bg_path = os.path.join(args.out, "lobby_bg.png")
    atomic_save_png(bg, bg_path, optimize=True)
    atomic_write_text(sigil_meta_json(LOBBY_UUID), bg_path + ".meta")

    # A centred card ~440 wide, vertically centred on each stage.
    render_preview(bg, (900, 1200), (230, 390, 440, 420),
                   os.path.join(args.preview_dir, "art-preview-900x1200.png"))
    render_preview(bg, (1333, 750), (446, 165, 440, 420),
                   os.path.join(args.preview_dir, "art-preview-1333x750.png"))

    for p in (bg_path, bg_path + ".meta",
              os.path.join(args.preview_dir, "art-preview-900x1200.png"),
              os.path.join(args.preview_dir, "art-preview-1333x750.png")):
        print("wrote %-70s %9d bytes" % (p, os.path.getsize(p)))


if __name__ == "__main__":
    main()
