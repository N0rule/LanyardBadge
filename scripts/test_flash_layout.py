#!/usr/bin/env python3
"""Exercise safe writes and real erase-sector boundaries without touching a device."""

from flash_layout import validate_write

for offset, size in [
    (0x1000, 25040),
    (0x8000, 3072),
    (0x10000, 1662848),
    (0x10000, 0x200000),
]:
    validate_write(offset, size)
for offset, size in [
    (0xE000, 8192),
    (0x9000, 4096),
    (0xF000, 4096),
    (0x210000, 4096),
    (0x8000, 4097),
    (0x10000, 0x200001),
    (0x10001, 10),
    (0, 0x400000),
]:
    try:
        validate_write(offset, size)
    except ValueError:
        pass
    else:
        raise AssertionError(f"Unsafe flash range accepted: {offset:x}, {size:x}")
print("PASS: NVS/PHY/artwork flash protection, OTA-stub rejection and erase alignment")
from flash_layout import validate_partition_table
import struct

entries = [
    (1, 2, 0x9000, 0x6000, "nvs"),
    (1, 1, 0xF000, 0x1000, "phy_init"),
    (0, 0, 0x10000, 0x200000, "factory"),
    (1, 0x82, 0x210000, 0x1F0000, "assets"),
]


def table(values):
    return b"".join(
        struct.pack("<HBBII16sI", 0x50AA, kind, subtype, offset, size, name.encode(), 0)
        for kind, subtype, offset, size, name in values
    )


validate_partition_table(table(entries))
changed = entries.copy()
changed[-1] = (1, 0x82, 0x290000, 0x170000, "assets")
try:
    validate_partition_table(table(changed))
except ValueError:
    pass
else:
    raise AssertionError("Filesystem relocation accepted without migration")
print("PASS: compiled partition table matches preserved layout; relocation rejected")
