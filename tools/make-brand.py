"""Derive every shipped brand asset from the one piece of artwork.

    python3 tools/make-brand.py

assets/brand/fishtank-title.png is the painting exactly as delivered, 2000 x
819, background and all. It is the source of truth and nothing here edits it;
this script only cuts and scales what the game needs:

    client/assets/brand/fishtank-title.webp     the menu's title, whole lockup
    client/assets/brand/fishtank-wordmark.webp  the in-game corner logo
    client/assets/icons/icon-192.png            the app icon
    client/assets/icons/icon-512.png
    client/assets/icons/icon-maskable-512.png   the same, inside a safe circle
    client/assets/icons/apple-touch-icon.png
    client/assets/icons/favicon-32.png

Three problems worth knowing about, because each one drove a decision:

Keying. The menu sits over the live aquarium, so the flat #003E4E the piece was
painted on has to go, and no threshold on colour can do it: the letters are
outlined in a dark teal close enough to that background that any threshold wide
enough to clear the background eats the outlines too. The background is the
only region of that colour touching the border, so the fill runs inward from
the edge instead and every enclosed dark pixel survives - the outlines, the
fish's eye, the counters in the a and the o. Alpha then ramps across a band
rather than switching, or the letters pick up the one-pixel dark fringe that
gives away a badly cut-out logo.

Splitting the wordmark from the tagline. They interlock: the tagline's
ascenders reach up into the wordmark's band, and its glow touches them, so
neither a straight cut nor connected components separate them. What does is a
per-column rule - in the strip where they overlap, keep only the run of ink
that is still connected to the top of the strip. Everything else in that strip
belongs to whatever is below it, which is the tagline. Without this the corner
logo carries a dotted line under the word, which is what the tagline's
ascender tips look like at 40 pixels.

The icon. A fragment of a letter cannot be an app icon - the letters run into
each other, so any square crop of them is visibly clipped - and the whole
wordmark in a square is a thin strip that is unreadable by 32 pixels. The
little fish and its bubbles are the one self-contained motif in the piece, they
are what the game is about, and they still read as a fish at 32. It is a 3.3x
upscale for the 512s, which is soft but acceptable on smooth glossy shapes, and
no upscale at all at the sizes a launcher actually draws.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/brand/fishtank-title.png"
BRAND = ROOT / "client/assets/brand"
ICONS = ROOT / "client/assets/icons"
DOCS = ROOT / "docs"
for path in (BRAND, ICONS, DOCS):
    path.mkdir(parents=True, exist_ok=True)
# Colour distance either side of which a background pixel is certain: below LO
# it is background, above HI it is artwork, between them it is the antialiased
# edge and gets partial alpha.
LO, HI = 14, 46
# The row where the wordmark's descenders and the tagline's ascenders are least
# tangled, and the top of the strip in which they overlap at all. Both are in
# the coordinates of the trimmed art, which is 1817 x 610.
SPLIT, TANGLE = 529, 470
# A box around the fish and its bubbles, then trimmed to whatever ink is
# actually inside it, because a box measured by eye leaves the motif swimming
# in dead space once it is centred in a square.
#
# Both edges are load-bearing. The k's bitten edge reaches right to x 1675,
# but only below y 300, so stopping at 285 clears it without having to cut
# between them; and the tagline runs on underneath, so a box any taller picks
# up a speck of it, which is the sort of thing nobody notices until it is on a
# home screen.
FISH = (1640, 150, 1818, 285)
# The panel background, so an icon reads as part of the game and not as a
# cut-out floating on whatever the launcher puts behind it.
BACKDROP = (7, 44, 50)


def keyed():
    """The artwork with its background removed and its margin trimmed."""
    im = Image.open(SOURCE).convert("RGBA")
    rgb = np.array(im)[:, :, :3].astype(np.int16)
    h, w, _ = rgb.shape
    edges = np.concatenate(
        [
            rgb[0:3].reshape(-1, 3),
            rgb[-3:].reshape(-1, 3),
            rgb[:, 0:3].reshape(-1, 3),
            rgb[:, -3:].reshape(-1, 3),
        ]
    )
    background = np.median(edges, axis=0)
    distance = np.sqrt(((rgb - background) ** 2).sum(axis=2))
    # Flood inward from the border through everything within reach of the
    # background colour. Anything enclosed is never touched.
    reachable = Image.fromarray(((distance < HI) * 255).astype(np.uint8))
    filled = reachable.copy()
    seeds = [(x, y) for x in range(0, w, 40) for y in (0, h - 1)]
    seeds += [(x, y) for y in range(0, h, 40) for x in (0, w - 1)]
    for seed in seeds:
        if filled.getpixel(seed) == 255:
            ImageDraw.floodfill(filled, seed, 128, thresh=0)
    outside = np.array(filled) == 128
    ramp = np.clip((distance - LO) / (HI - LO), 0, 1)
    alpha = np.where(outside, ramp, 1.0)
    # A little blur on the edge only, to take the stair-stepping off the ramp
    # without softening the artwork itself.
    alpha = np.array(
        Image.fromarray((alpha * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(0.6)
        )
    )
    art = Image.fromarray(np.dstack([np.array(im)[:, :, :3], alpha]))
    return art.crop(art.getbbox())


def wordmark(art):
    """The word on its own, with the tagline's ascender tips removed."""
    alpha = np.array(art)[:, :, 3].copy()
    ink = alpha > 60
    for x in range(art.size[0]):
        column = ink[TANGLE:SPLIT, x]
        if not column.any() or not column[0]:
            # Nothing at the top of the strip means nothing here is joined to
            # the word: whatever it is, it belongs to the tagline.
            alpha[TANGLE:SPLIT, x] = 0
            continue
        gap = np.argmax(~column) if (~column).any() else len(column)
        alpha[TANGLE + gap : SPLIT, x] = 0
    out = Image.fromarray(np.dstack([np.array(art)[:, :, :3], alpha]))
    out = out.crop((0, 0, art.size[0], SPLIT))
    return out.crop(out.getbbox())


def wide(image, width, path, quality=90):
    """Scale to a width and write WebP, which is four times lighter than PNG
    for these gradients and is on the critical path for the first screen."""
    scaled = image.resize(
        (width, round(image.size[1] * width / image.size[0])), Image.LANCZOS
    )
    scaled.save(path, quality=quality, method=6)
    print(f"  {path.name}: {scaled.size[0]} x {scaled.size[1]}, {path.stat().st_size / 1024:.0f} KB")
    return scaled


def icon(motif, size, path, inset):
    """The motif centred on the game's own background. `inset` is the fraction
    of the square it may fill: a maskable icon has to survive being cropped to
    a circle, so it gets a good deal less."""
    canvas = Image.new("RGBA", (size, size), (*BACKDROP, 255))
    room = size * inset
    # resize, not thumbnail: thumbnail only ever shrinks, so the motif - which
    # is 178 px wide in the painting - sat at its original size in the middle
    # of a 512 square, filling a third of it instead of three quarters.
    scale = min(room / motif.size[0], room / motif.size[1])
    art = motif.resize(
        (max(1, round(motif.size[0] * scale)), max(1, round(motif.size[1] * scale))),
        Image.LANCZOS,
    )
    canvas.paste(art, ((size - art.size[0]) // 2, (size - art.size[1]) // 2), art)
    canvas.save(path, optimize=True)
    print(f"  {path.name}: {size} x {size}, {path.stat().st_size / 1024:.0f} KB")
    return canvas


art = keyed()
print(f"keyed and trimmed to {art.size[0]} x {art.size[1]}")
print("brand:")
title = wide(art, 1200, BRAND / "fishtank-title.webp")
word = wordmark(art)
# The corner logo is about 190 px wide on a desktop header, so this is past 2x
# for it without carrying a painting into the page.
mark = wide(word, 480, BRAND / "fishtank-wordmark.webp", quality=92)
print("icons:")
fish = art.crop(FISH)
fish = fish.crop(fish.getbbox())
print(f"  the fish motif is {fish.size[0]} x {fish.size[1]} of the painting")
icon(fish, 192, ICONS / "icon-192.png", 0.74)
icon(fish, 512, ICONS / "icon-512.png", 0.74)
# Android crops a maskable icon to whatever shape it likes, guaranteeing only
# the inner 80% of the width. Staying inside a circle of that diameter means
# filling appreciably less than the square.
icon(fish, 512, ICONS / "icon-maskable-512.png", 0.54)
# iOS rounds the corners itself and never crops to a circle.
icon(fish, 180, ICONS / "apple-touch-icon.png", 0.78)
icon(fish, 32, ICONS / "favicon-32.png", 0.88)

# Proof sheets, over the colours these are actually seen against.
sheet = Image.new("RGB", (title.size[0] + 80, title.size[1] + mark.size[1] + 140), (4, 23, 28))
sheet.paste(title, (40, 40), title)
sheet.paste(mark, (40, title.size[1] + 100), mark)
sheet.save(DOCS / "title-on-water.png")
print(f"  {DOCS / 'title-on-water.png'}")
row = Image.new("RGB", (192 + 512 + 180 + 32 + 100, 552), (20, 22, 24))
at = 20
for name, size in [
    ("icon-512.png", 512),
    ("icon-maskable-512.png", 512),
    ("icon-192.png", 192),
    ("apple-touch-icon.png", 180),
    ("favicon-32.png", 32),
]:
    one = Image.open(ICONS / name)
    row.paste(one, (at, 20))
    at += one.size[0] + 20
    if at > row.size[0] - 200:
        break
row.save(DOCS / "icons.png")
print(f"  {DOCS / 'icons.png'}")
