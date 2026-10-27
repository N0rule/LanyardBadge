#!/usr/bin/env python3
"""Copy the locked ESP Web Tools browser distribution and dependency licenses."""

from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
modules = root / "tests/node_modules"
package = modules / "esp-web-tools"
target = root / "web/vendor/esp-web-tools"
target.mkdir(parents=True, exist_ok=True)
for file in (package / "dist/web").glob("*.js"):
    shutil.copyfile(file, target / file.name)
shutil.copyfile(package / "LICENSE", target / "LICENSE")
texts = []
for name in [
    "esp-web-tools",
    "esptool-js",
    "improv-wifi-serial-sdk",
    "lit",
    "lit-html",
    "lit-element",
    "@lit/reactive-element",
    "tslib",
]:
    folder = modules / name
    for license in folder.glob("*LICENSE*"):
        if license.is_file():
            texts.append(f"{name}\n" + license.read_text(errors="replace"))
(target / "THIRD_PARTY_LICENSES.txt").write_text("\n\n".join(texts))
print("Vendored pinned ESP Web Tools; no CDN needed at runtime")
