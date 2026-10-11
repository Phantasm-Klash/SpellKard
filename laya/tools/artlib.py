#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
artlib.py -- shared, offline art-composition helpers for the SpellKard client.

WHY THIS EXISTS
---------------
The login backdrop and the lobby backdrop are built from the same visual
language (the same dark violet/magenta palette, the same tileable nebula and
procedural star field, the same de-banding grain), so the drawing primitives
live here once instead of being copy-pasted per screen.  Both
`compose_login_art.py` and `compose_lobby_art.py` import this module; nothing
here is login- or lobby-specific.

Everything is resolution-independent on purpose: gradients, glows, tiles and
stars all scale to any output size, which is how a screen gets native-resolution
detail without ever upscaling the low-res source art.

Determinism: callers pass explicit seeds; every helper that draws randomness
takes a seed argument and uses a private `random.Random(seed)`, so two runs of
the same script are byte-identical.

Dependencies: Python stdlib + Pillow only.
"""

import io
import json
import math
import os
import random
import zipfile

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# --- shared palette (dark "spell card" night sky, violet + gold) ------------

C_TOP = (0x07, 0x05, 0x0E)        # #07050e near-black purple
C_MID = (0x16, 0x0A, 0x24)        # #160a24
C_BOT = (0x2A, 0x0D, 0x2E)        # #2a0d2e dark magenta
C_GLOW = (0xFF, 0x54, 0x70)       # #ff5470 magenta
C_GOLD = (0xFF, 0xE3, 0x6E)       # #ffe36e
C_STAR_COOL = (0xDF, 0xE8, 0xFF)  # #dfe8ff
C_STAR_WARM = (0xFF, 0xE9, 0xC8)  # #ffe9c8


# --- colour / sampling helpers ----------------------------------------------

def lerp3(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def load_apk_png(apk_path, entry):
    """Read a PNG entry out of the APK zip and return an RGBA PIL image."""
    with zipfile.ZipFile(apk_path) as z:
        data = z.read(entry)
    return Image.open(io.BytesIO(data)).convert("RGBA")


def vertical_gradient(size, stops):
    """stops: list of (pos 0..1, (r,g,b)); linear interpolation between them."""
    w, h = size
    col = Image.new("RGB", (1, h))
    px = col.load()
    for y in range(h):
        t = y / max(1, h - 1)
        lo = stops[0]
        hi = stops[-1]
        for i in range(len(stops) - 1):
            if stops[i][0] <= t <= stops[i + 1][0]:
                lo, hi = stops[i], stops[i + 1]
                break
        span = max(1e-6, hi[0] - lo[0])
        f = (t - lo[0]) / span
        px[0, y] = lerp3(lo[1], hi[1], f)
    return col.resize((w, h), Image.Resampling.NEAREST)


# --- masks ------------------------------------------------------------------

def radial_glow_mask(size, cx, cy, radius, peak):
    """Smooth cosine-falloff radial alpha mask, computed at 1/4 res for speed."""
    w, h = size
    sw, sh = max(1, w // 4), max(1, h // 4)
    m = Image.new("L", (sw, sh), 0)
    px = m.load()
    for y in range(sh):
        fy = (y + 0.5) * h / sh
        for x in range(sw):
            fx = (x + 0.5) * w / sw
            t = min(1.0, math.hypot(fx - cx, fy - cy) / radius)
            a = peak * (0.5 + 0.5 * math.cos(math.pi * t))
            px[x, y] = int(max(0.0, min(1.0, a)) * 255)
    return m.resize((w, h), Image.Resampling.BILINEAR)


def vignette_mask(size, peak, inner=0.75):
    """Darken the outer ring: 0 inside `inner`, ramping to `peak` at the corner."""
    w, h = size
    sw, sh = max(1, w // 4), max(1, h // 4)
    cx, cy = w / 2.0, h / 2.0
    maxd = math.hypot(cx, cy)
    m = Image.new("L", (sw, sh), 0)
    px = m.load()
    for y in range(sh):
        fy = (y + 0.5) * h / sh
        for x in range(sw):
            fx = (x + 0.5) * w / sw
            rn = math.hypot(fx - cx, fy - cy) / maxd
            t = min(1.0, max(0.0, (rn - inner) / (1.0 - inner)))
            a = peak * (t * t * (3 - 2 * t))       # smoothstep
            px[x, y] = int(a * 255)
    return m.resize((w, h), Image.Resampling.BILINEAR)


def feathered_rect_mask(size, rect, blur):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rectangle(rect, fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur))


def composite_solid(base, color, mask):
    """base*(1-mask) + color*mask, in RGB."""
    return Image.composite(Image.new("RGB", base.size, color), base, mask)


# --- tiling / nebula --------------------------------------------------------

def tiled(rgb_tile, size):
    w, h = size
    tw, th = rgb_tile.size
    out = Image.new("RGB", size)
    for y in range(0, h, th):
        for x in range(0, w, tw):
            out.paste(rgb_tile, (x, y))
    return out


def nebula_rgb(nebula_path):
    """Load the tileable nebula and flatten it to opaque RGB (over black)."""
    tile = Image.open(nebula_path).convert("RGBA")
    tile = Image.alpha_composite(Image.new("RGBA", tile.size, (0, 0, 0, 255)), tile)
    return tile.convert("RGB")


def nebula_layer(rgb_tile, size, scale=1, blur=0):
    """Tile the nebula, optionally stretched by `scale` and softened by `blur`."""
    t = rgb_tile if scale == 1 else rgb_tile.resize(
        (rgb_tile.width * scale, rgb_tile.height * scale), Image.Resampling.LANCZOS)
    if blur:
        t = t.filter(ImageFilter.GaussianBlur(blur))
    return tiled(t, size)


# --- stars ------------------------------------------------------------------

def radial_glow_patch(radius, color, peak_alpha):
    """A small RGBA sprite: a soft circular glow, for bright stars."""
    r = max(1, int(math.ceil(radius)))
    d = 2 * r + 1
    m = Image.new("L", (d, d), 0)
    px = m.load()
    for y in range(d):
        for x in range(d):
            dist = math.hypot(x - r, y - r)
            if dist <= radius:
                px[x, y] = int((peak_alpha * (1.0 - dist / radius) ** 2) * 255)
    patch = Image.new("RGBA", (d, d), (color[0], color[1], color[2], 0))
    patch.putalpha(m)
    return patch


def star_layer(size, seed, count, bright_count, cool=C_STAR_COOL, warm=C_STAR_WARM):
    """A transparent RGBA layer of `count` small stars plus `bright_count` glow
    stars.  Deterministic for a given `seed`."""
    w, h = size
    stars = Image.new("RGBA", size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(stars)
    rng = random.Random(seed)
    for _ in range(count):
        x = rng.uniform(0, w - 1)
        y = rng.uniform(0, h - 1)
        d = rng.choice([1, 1, 2, 2, 3])
        col = lerp3(cool, warm, rng.random())
        a = int(round(rng.uniform(0.2, 0.9) * 255))
        if d == 1:
            sd.point((x, y), fill=(col[0], col[1], col[2], a))
        else:
            r = d / 2.0
            sd.ellipse([x - r, y - r, x + r, y + r], fill=(col[0], col[1], col[2], a))
    for _ in range(bright_count):
        x = rng.uniform(0, w - 1)
        y = rng.uniform(0, h - 1)
        glow_r = rng.uniform(2.5, 4.5)              # 5-9 px halo diameter
        col = lerp3(cool, warm, rng.random())
        patch = radial_glow_patch(glow_r, col, rng.uniform(0.30, 0.55))
        stars.paste(patch, (int(x) - patch.width // 2, int(y) - patch.height // 2), patch)
        sd.ellipse([x - 1, y - 1, x + 1, y + 1], fill=(255, 255, 255, 235))
    return stars


def composite_stars(base_rgb, stars_rgba):
    """Composite a `star_layer` result over an opaque RGB base."""
    return Image.composite(stars_rgba.convert("RGB"), base_rgb, stars_rgba.getchannel("A"))


# --- grain ------------------------------------------------------------------

def add_grain(rgb, seed, amplitude, block):
    """Add +-`amplitude` uniform grain to break gradient banding.

    randbytes + bytes.translate keeps it fast and deterministic; centred on 128
    so ImageChops.add(offset=-128) adds a symmetric +-amplitude.  Generated at
    1/block resolution and NEAREST-upscaled to blocks: the grain still breaks
    banding, but the per-pixel entropy (which is what makes PNG blow up) drops.
    """
    w, h = rgb.size
    hw, hh = max(1, w // block), max(1, h // block)
    raw = random.Random(seed).randbytes(hw * hh)
    table = bytes((128 + (b % (2 * amplitude + 1)) - amplitude) for b in range(256))
    grain = Image.frombytes("L", (hw, hh), raw.translate(table))
    grain = grain.resize((w, h), Image.Resampling.NEAREST)
    grain = Image.merge("RGB", (grain, grain, grain))
    return ImageChops.add(rgb, grain, scale=1.0, offset=-128)


# --- IO ---------------------------------------------------------------------

def atomic_save_png(img, path, **save_kwargs):
    """Write to <path>.tmp then os.replace, so a concurrent reader never sees a
    half-written file."""
    tmp = path + ".tmp"
    img.save(tmp, "PNG", **save_kwargs)
    os.replace(tmp, path)


def atomic_write_text(text, path):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    os.replace(tmp, path)


def sigil_meta_json(uuid_value):
    """The `.png.meta` sidecar the Laya IDE expects for an image asset."""
    return json.dumps({"uuid": uuid_value, "importer": {"textureType": 2}}, indent=2)


# --- preview helpers (offline composite for human review) -------------------

def cover_fit(sw, sh, tw, th):
    s = max(tw / sw, th / sh)
    return s, int(round((tw - sw * s) / 2)), int(round((th - sh * s) / 2))


def contain_fit(sw, sh, tw, th):
    s = min(tw / sw, th / sh)
    return s, int(round((tw - sw * s) / 2)), int(round((th - sh * s) / 2))


def load_font(size):
    for path in (r"C:/Windows/Fonts/arial.ttf", r"C:/Windows/Fonts/segoeui.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_placeholder_card(d, rect, title, fields, status, buttons, font_title, font_label, font_small):
    """Draw a translucent placeholder menu card (visual only, no real UI)."""
    cx, cy, cw, ch = rect
    d.rounded_rectangle([cx, cy, cx + cw, cy + ch], radius=18,
                        fill=(16, 10, 26, 205), outline=(255, 227, 110, 120), width=2)
    pad = 20
    yy = cy + pad
    d.text((cx + pad, yy), title, font=font_title, fill=(255, 235, 190))
    yy += 28 + 12
    for label in fields:
        d.rounded_rectangle([cx + pad, yy, cx + cw - pad, yy + 44], radius=8,
                            fill=(30, 20, 48, 225), outline=(120, 100, 160, 170), width=1)
        d.text((cx + pad + 12, yy + 13), label, font=font_label, fill=(190, 180, 210))
        yy += 44 + 12
    yy += 4
    if status:
        d.text((cx + pad, yy), status, font=font_small, fill=(150, 140, 170))
    yy += 20 + 12
    for label in buttons:
        d.rounded_rectangle([cx + pad, yy, cx + cw - pad, yy + 42], radius=8,
                            fill=(62, 30, 82, 225), outline=(255, 227, 110, 150), width=1)
        tw = d.textlength(label, font=font_label)
        d.text((cx + cw / 2 - tw / 2, yy + 13), label, font=font_label, fill=(255, 235, 190))
        yy += 42 + 10
