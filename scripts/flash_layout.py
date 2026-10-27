"""Flash erase-range policy for the fixed CYD2USB factory layout."""


def validate_write(offset, size):
    if offset < 0 or size <= 0 or offset % 4096:
        raise ValueError(
            "Flash write must have positive size and a sector-aligned address"
        )
    end = (offset + size + 4095) // 4096 * 4096
    # Protect NVS/PHY [0x9000,0x10000) and all artwork [0x210000,0x400000).
    if not (
        (0x1000 <= offset and end <= 0x9000) or (0x10000 <= offset and end <= 0x210000)
    ):
        raise ValueError(
            f"Refusing flash write 0x{offset:x}..0x{end:x}: overlaps protected data"
        )


def validate_partition_table(data):
    import struct

    entries = {}
    for at in range(0, len(data), 32):
        if data[at : at + 2] != b"\xaaP":
            break
        _, kind, subtype, offset, size, label, _ = struct.unpack(
            "<HBBII16sI", data[at : at + 32]
        )
        entries[label.rstrip(b"\0").decode()] = (kind, subtype, offset, size)
    expected = {
        "nvs": (1, 2, 0x9000, 0x6000),
        "phy_init": (1, 1, 0xF000, 0x1000),
        "factory": (0, 0, 0x10000, 0x200000),
        "assets": (1, 0x82, 0x210000, 0x1F0000),
    }
    if entries != expected:
        raise ValueError(
            "Partition layout differs from preserved 4 MB factory layout; explicit migration required"
        )
