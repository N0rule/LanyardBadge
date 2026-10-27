#!/usr/bin/env python3
"""Check Pages subpaths, installer part offsets, image lengths and release hashes."""

from pathlib import Path
from html.parser import HTMLParser
import hashlib, json, sys
from urllib.parse import urlsplit

root = Path(sys.argv[1])


class Links(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if (
                key in ("src", "href")
                and value
                and not value.startswith(("https:", "#"))
            ):
                assert not value.startswith("/"), f"Root-relative URL: {value}"
                assert (root / urlsplit(value).path).exists(), f"Missing asset: {value}"


Links().feed((root / "index.html").read_text())
for mode in ("fresh", "update"):
    manifest = json.loads((root / "firmware" / f"{mode}.json").read_text())
    assert manifest["new_install_prompt_erase"] is True
    assert manifest["new_install_skip_erase"] is True
    (build,) = manifest["builds"]
    assert build["chipFamily"] == "ESP32"
    assert [p["offset"] for p in build["parts"]] == (
        [4096, 32768, 65536] if mode == "fresh" else [65536]
    )
    for part in build["parts"]:
        file = root / "firmware" / part["path"]
        assert file.exists()
        assert part["offset"] + file.stat().st_size <= (
            0x8000
            if part["offset"] == 4096
            else 0x9000 if part["offset"] == 32768 else 0x210000
        )
    folder = (root / "firmware" / build["parts"][-1]["path"]).parent
    for line in (folder / "SHA256SUMS").read_text().splitlines():
        digest, name = line.split()
        assert hashlib.sha256((folder / name).read_bytes()).hexdigest() == digest
print("PASS: Pages assets, firmware manifests, flash bounds and SHA-256 hashes")
