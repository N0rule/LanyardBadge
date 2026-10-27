#!/usr/bin/env python3
"""Regenerate the GIF/decoded oracle using Pillow 13.0.0 (test data only).

Run from the repository root. CI consumes checked-in fixtures, not Pillow.
"""

import json
from pathlib import Path
from PIL import Image, ImageSequence

# Transparent, red, green, blue, yellow. Small patches exercise GIF disposal.
palette = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0] + [0] * 753
frames = []
for color, box in [
    (1, (0, 0, 8, 8)),
    (2, (0, 0, 4, 4)),
    (3, (4, 4, 8, 8)),
    (4, (0, 4, 4, 8)),
]:
    image = Image.new("P", (8, 8), 0)
    image.putpalette(palette)
    image.paste(color, box)
    frames.append(image)

frames[0].save(
    "tests/fixtures/disposal.gif",
    save_all=True,
    append_images=frames[1:],
    duration=[80, 120, 160, 200],
    loop=2,
    disposal=[1, 3, 2, 1],
    transparency=0,
    optimize=False,
)
# Retain a tiny exact oracle; the browser test does not run a second GIF decoder.
with Image.open("tests/fixtures/disposal.gif") as source:
    rgba = [list(frame.convert("RGBA").tobytes()) for frame in ImageSequence.Iterator(source)]
Path("tests/fixtures/disposal.json").write_text(
    json.dumps(
        {"width": 8, "height": 8, "delays": [80, 120, 160, 200], "rgba": rgba},
        separators=(",", ":"),
    )
    + "\n"
)
