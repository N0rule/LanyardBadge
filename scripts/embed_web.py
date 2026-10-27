"""Embed deterministic gzip assets in application flash; no uploadfs required."""
import gzip
from pathlib import Path
Import("env")
root = Path(env.subst("$PROJECT_DIR"))
assets = []
for name, symbol in [("index.html", "index_html"), ("style.css", "style_css"), ("app.js", "app_js"), ("qrcode.js", "qrcode_js"), ("Montserrat.woff2", "font_woff2")]:
    path = root / "web" / name
    if path.exists():
        data = gzip.compress(path.read_bytes(), compresslevel=9, mtime=0)
        assets.append(f"static const unsigned char {symbol}[] PROGMEM = {{" + ",".join(map(str, data)) + "};\n")
output = "#pragma once\n#include <Arduino.h>\n" + "".join(assets)
target = root / "include" / "web_assets.h"
if not target.exists() or target.read_text() != output:
    target.write_text(output)

# The standard PlatformIO check sums ELF sections; ESP32 image padding can make
# the actual .bin larger. Check the deployable file before permitting upload.
def check_binary(source, target, env):
    import csv
    binary = Path(env.subst("$BUILD_DIR/${PROGNAME}.bin"))
    if not binary.exists():
        return
    with (root / "partitions.csv").open() as table:
        for row in csv.reader(table):
            if len(row) >= 5 and row[0].strip() == "factory":
                limit = int(row[4].strip(), 0)
                if binary.stat().st_size > limit:
                    raise RuntimeError(f"Firmware binary is {binary.stat().st_size} bytes; partition is {limit}")
                print(f"Verified actual firmware image: {binary.stat().st_size} / {limit} bytes")
                return
    raise RuntimeError("Factory application partition not found")

env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", check_binary)
env.AddPreAction("upload", check_binary)
