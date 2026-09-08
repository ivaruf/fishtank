"""Derive the shipped title art from the delivered artwork.

    python3 tools/make-title.py

The source is a painted piece, not something generated - assets/brand/ holds it
exactly as delivered - so this script is only the web derivation: key out the
flat background, trim the margin, resize, and write client/assets/brand/.

Keying is a flood fill inward from the border rather than a threshold on
colour, and that is the whole trick. The background is a flat #003E4E and the
letters are outlined in a dark teal close enough to it that any global
threshold eats the outlines. The background is also the only such region
touching the border, so filling from the edge takes it and leaves every
enclosed dark pixel - the outlines, the fish's eye, the gaps inside the a and
the o - alone.

The fill leaves a hard edge where the artwork was antialiased against its
background, so alpha ramps across a band either side of the threshold instead
of switching. Without that the letters get a one-pixel dark fringe, which is
exactly what you see on badly cut-out logos.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/brand/fishtank-title.png"
OUT = ROOT / "client/assets/brand"
OUT.mkdir(parents=True, exist_ok=True)
# The menu panel is 530 px wide, so this is comfortably past 2x for it without
# carrying a 2000 px painting into the page.
WIDTH = 1200
# Colour distance either side of which a background pixel is certain: below
# LO it is background, above HI it is artwork, and between the two it is the
# antialiased edge and gets partial alpha.
LO, HI = 14, 46

im = Image.open(SOURCE).convert("RGBA")
rgb = np.array(im)[:, :, :3].astype(np.int16)
h, w, _ = rgb.shape
# The background colour, taken from the border rather than assumed.
edges = np.concatenate(
    [
        rgb[0:3].reshape(-1, 3),
        rgb[-3:].reshape(-1, 3),
        rgb[:, 0:3].reshape(-1, 3),
        rgb[:, -3:].reshape(-1, 3),
    ]
)
bg = np.median(edges, axis=0)
distance = np.sqrt(((rgb - bg) ** 2).sum(axis=2))

# Flood fill from every border pixel that is background, using PIL's fill on a
# mask: white where a pixel is within reach of the background colour, and the
# fill spreads only through that. Anything enclosed is never touched.
reachable = Image.fromarray(((distance < HI) * 255).astype(np.uint8), "L")
filled = reachable.copy()
seeds = [(x, y) for x in range(0, w, 40) for y in (0, h - 1)]
seeds += [(x, y) for y in range(0, h, 40) for x in (0, w - 1)]
for seed in seeds:
    if filled.getpixel(seed) == 255:
        ImageDraw.floodfill(filled, seed, 128, thresh=0)
outside = np.array(filled) == 128
print(f"background: {tuple(int(c) for c in bg)}, {outside.mean() * 100:.1f}% of the image")

# Alpha: transparent through the filled region, ramped across the edge band,
# and fully opaque everywhere the fill never reached.
ramp = np.clip((distance - LO) / (HI - LO), 0, 1)
alpha = np.where(outside, ramp, 1.0)
# One pixel of blur on the edge only, to take the stair-stepping off the ramp
# without softening the artwork itself.
alpha = np.array(
    Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(0.6)
    )
)
out = np.dstack([np.array(im)[:, :, :3], alpha])
art = Image.fromarray(out, "RGBA")

# Trim the margin the painting came with, then scale to the shipped width.
box = art.getbbox()
art = art.crop(box)
print(f"trimmed to {art.size[0]} x {art.size[1]}")
art = art.resize((WIDTH, round(art.size[1] * WIDTH / art.size[0])), Image.LANCZOS)
# WebP, not PNG: 147 KB against 564 KB for the same pixels, and this is on the
# critical path for the first screen the player sees. No PNG fallback, because
# a browser without WebP - which has been universal since 2020 - is not going
# to manage the WebGL, the ES modules or the data channels either.
art.save(OUT / "fishtank-title.webp", quality=90, method=6)
size = (OUT / "fishtank-title.webp").stat().st_size
print(f"wrote {OUT / 'fishtank-title.webp'} at {art.size[0]} x {art.size[1]}, {size / 1024:.0f} KB")

# A proof sheet, over the colour the menu actually sits on, because a cut-out
# only looks right against the background it will be seen on.
sheet = Image.new("RGB", (art.size[0] + 80, art.size[1] + 80), (4, 23, 28))
sheet.paste(art, (40, 40), art)
sheet.save(ROOT / "docs/title-on-water.png")
print(f"wrote {ROOT / 'docs/title-on-water.png'}")
