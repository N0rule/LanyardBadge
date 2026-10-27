"""Guard actual deployable image size; web assets live on GitHub Pages."""

from pathlib import Path
import sys

Import("env")
root = Path(env.subst("$PROJECT_DIR"))
sys.path.insert(0, str(root / "scripts"))
from flash_layout import validate_write, validate_partition_table


# The standard PlatformIO check sums ELF sections; ESP32 image padding can make
# the actual .bin larger. Check the deployable file before permitting upload.
def check_binary(source, target, env):
    import csv

    # Arduino adds an OTA selector even for factory-only layouts. Its 0xe000
    # write overlaps this board's NVS and PHY partitions. Remove it at execution
    # time, after framework flags have been constructed, before any flash write.
    flags = list(env.get("UPLOADERFLAGS", []))
    removed = set()
    for i, flag in enumerate(flags):
        if Path(env.subst(str(flag))).name == "boot_app0.bin":
            if i == 0 or int(str(flags[i - 1]), 0) != 0xE000:
                raise RuntimeError("Unexpected OTA stub address; upload refused")
            removed.update((i - 1, i))
    flags = [flag for i, flag in enumerate(flags) if i not in removed]
    env.Replace(UPLOADERFLAGS=flags)
    for i, flag in enumerate(flags):
        name = Path(env.subst(str(flag)))
        if name.suffix == ".bin" and name.exists():
            validate_write(int(str(flags[i - 1]), 0), name.stat().st_size)
    extras = [
        (at, file)
        for at, file in env.get("FLASH_EXTRA_IMAGES", [])
        if Path(env.subst(str(file))).name != "boot_app0.bin"
    ]
    env.Replace(FLASH_EXTRA_IMAGES=extras)
    binary = Path(env.subst("$BUILD_DIR/${PROGNAME}.bin"))
    if not binary.exists():
        return
    with (root / "partitions.csv").open() as table:
        for row in csv.reader(table):
            if len(row) >= 5 and row[0].strip() == "factory":
                limit = int(row[4].strip(), 0)
                if binary.stat().st_size > limit:
                    raise RuntimeError(
                        f"Firmware binary is {binary.stat().st_size} bytes; partition is {limit}"
                    )
                validate_write(0x10000, binary.stat().st_size)
                print(
                    f"Verified actual firmware image: {binary.stat().st_size} / {limit} bytes; NVS/PHY/LittleFS writes excluded"
                )
                return
    raise RuntimeError("Factory application partition not found")


env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", check_binary)


def check_upload(source, target, env):
    check_binary(source, target, env)
    table = Path(env.subst("$BUILD_DIR/partitions.bin"))
    validate_partition_table(table.read_bytes())
    print(
        "Verified compiled partition table: existing NVS and artwork locations preserved"
    )


env.AddPreAction("upload", check_upload)
