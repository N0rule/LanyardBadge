#!/usr/bin/env python3
"""Optional developer tool: prepare the bundled portrait illustration (requires Pillow)."""
import argparse
import struct
import zlib
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("image", type=Path)
parser.add_argument("--output", type=Path, default=Path("assets/sample.bmp.z"))
args = parser.parse_args()
image = Image.open(args.image).convert("RGB")
if image.size != (240, 320):
    parser.error("Prepare a 240 x 320 portrait source first")
image = image.quantize(colors=64).convert("RGB")
result = bytearray(66)
result[:2] = b"BM"
for offset, value in [(2, 153666), (10, 66), (14, 40), (18, 240), (22, 320),
                      (30, 3), (34, 153600), (54, 0xF800), (58, 0x07E0), (62, 0x001F)]:
    struct.pack_into("<I", result, offset, value)
struct.pack_into("<HH", result, 26, 1, 16)
for y in range(319, -1, -1):
    for x in range(240):
        red, green, blue = image.getpixel((x, y))
        result.extend(struct.pack("<H", ((red >> 3) << 11) | ((green >> 2) << 5) | (blue >> 3)))
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_bytes(zlib.compress(result, 9))
print(f"Prepared {args.output}: {args.output.stat().st_size} compressed bytes")
