"""Guard actual deployable image size; web assets live on GitHub Pages."""
from pathlib import Path
Import("env")
root = Path(env.subst("$PROJECT_DIR"))
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
