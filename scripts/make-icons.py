"""Draws Tonewell's menu-bar template icons and the app icon source.

Usage: python3 scripts/make-icons.py   (needs Pillow)
Then:  npx tauri icon src-tauri/icons/app-icon.png
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
TRAY = ROOT / "src-tauri" / "icons" / "tray"
TRAY.mkdir(parents=True, exist_ok=True)

SS = 8  # supersampling factor


def tray_icon(state: str, size: int = 36) -> Image.Image:
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = big / 2
    r = big * 0.36
    w = big * 0.085
    box = [c - r, c - r, c + r, c + r]
    d.ellipse(box, outline=(0, 0, 0, 255), width=int(w))
    if state == "playing":
        rr = big * 0.11
        d.ellipse([c - rr, c - rr, c + rr, c + rr], fill=(0, 0, 0, 255))
    elif state == "resting":
        inner = r - w * 0.5
        d.chord([c - inner, c - inner, c + inner, c + inner], 0, 180, fill=(0, 0, 0, 255))
    return img.resize((size, size), Image.LANCZOS)


for state in ("ready", "playing", "resting"):
    tray_icon(state, 36).save(TRAY / f"{state}.png")
    tray_icon(state, 18).save(TRAY / f"{state}-1x.png")


def app_icon(size: int = 1024) -> Image.Image:
    big = size * 2
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # macOS icon grid: a rounded square inset from the canvas edge.
    inset = big * 0.098
    radius = big * 0.18
    d.rounded_rectangle([inset, inset, big - inset, big - inset], radius=radius, fill=(30, 17, 36, 255))
    # A faint top highlight, like light on lacquer.
    hl = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.rounded_rectangle([inset, inset, big - inset, big - inset], radius=radius, outline=(255, 236, 200, 40), width=int(big * 0.004))
    img = Image.alpha_composite(img, hl)
    d = ImageDraw.Draw(img)

    c = big / 2
    # The well's mouth.
    mouth = big * 0.25
    glow = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([c - mouth, c - mouth, c + mouth, c + mouth], fill=(59, 35, 64, 255))
    glow = glow.filter(ImageFilter.GaussianBlur(big * 0.01))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)

    # Engraved minute ticks.
    r_out = big * 0.315
    for i in range(60):
        a = -math.pi / 2 + i * math.tau / 60
        long = i % 5 == 0
        r_in = r_out - big * (0.03 if long else 0.016)
        width = int(big * (0.0045 if long else 0.003))
        d.line(
            [(c + r_in * math.cos(a), c + r_in * math.sin(a)), (c + r_out * math.cos(a), c + r_out * math.sin(a))],
            fill=(122, 102, 128, 255), width=width,
        )

    # The brass arc: twenty minutes wound.
    r_arc = big * 0.27
    w_arc = big * 0.03
    start = -90
    end = -90 + 360 * 20 / 60
    d.arc([c - r_arc, c - r_arc, c + r_arc, c + r_arc], start, end, fill=(210, 168, 94, 255), width=int(w_arc))
    for ang in (start, end):
        a = math.radians(ang)
        x, y = c + (r_arc - w_arc / 2) * math.cos(a), c + (r_arc - w_arc / 2) * math.sin(a)
        d.ellipse([x - w_arc / 2, y - w_arc / 2, x + w_arc / 2, y + w_arc / 2], fill=(210, 168, 94, 255))
    # The key pin at the arc's head.
    a = math.radians(end)
    x, y = c + (r_arc - w_arc / 2) * math.cos(a), c + (r_arc - w_arc / 2) * math.sin(a)
    pin = big * 0.028
    d.ellipse([x - pin, y - pin, x + pin, y + pin], fill=(239, 230, 216, 255), outline=(30, 17, 36, 255), width=int(big * 0.006))

    return img.resize((size, size), Image.LANCZOS)


app_icon().save(ROOT / "src-tauri" / "icons" / "app-icon.png")
print("icons written")
