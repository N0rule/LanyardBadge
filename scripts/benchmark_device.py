#!/usr/bin/env python3
"""Measure on-device render paths, idle stability, sleep state, and retained settings."""

import argparse, json, time
import serial

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--port", default="/dev/ttyUSB0")
p.add_argument("--switches", type=int, default=50)
args = p.parse_args()
s = serial.Serial(None, 115200, timeout=0.1)
s.dtr = False
s.rts = False
s.port = args.port
with s:
    time.sleep(1.5)

    def command(cmd):
        s.write((cmd + "\n").encode())

    def status():
        command("status")
        end = time.monotonic() + 10
        while time.monotonic() < end:
            line = s.readline().decode(errors="replace").strip()
            if line.startswith('{"firmware"'):
                return json.loads(line)
        raise RuntimeError("Status timed out")

    before = status()
    measurements = []
    for mode in ("lvgl", "stream", "menu"):
        command("bench-" + mode)
        end = time.monotonic() + 30
        while time.monotonic() < end:
            line = s.readline().decode(errors="replace").strip()
            if line.startswith("BENCH "):
                measurements.append(line)
                break
        else:
            raise RuntimeError("Benchmark timed out")
    command("badge")
    time.sleep(0.5)
    idle = status()
    time.sleep(2)
    idle_after = status()
    assert idle["flushCount"] == idle_after["flushCount"], "Unchanged artwork redrawn"
    for i in range(args.switches):
        command("next")
        current = status()
    command("badge")
    time.sleep(0.3)
    after = status()
    command("sleep")
    time.sleep(0.1)
    sleeping = status()
    assert sleeping["screenAsleep"]
    assert sleeping["brightness"] == before["brightness"]
    command("wake")
    time.sleep(0.1)
    awake = status()
    assert not awake["screenAsleep"]
    time.sleep(2)
    command("restart")
    time.sleep(2)
    reboot = status()
    for key in (
        "brightness",
        "interval",
        "autoplay",
        "rotation",
        "cards",
        "revision",
        "screenTimeout",
    ):
        assert reboot[key] == before[key], (key, before[key], reboot[key])
    assert reboot["activeCard"] == after["activeCard"]
    print(
        json.dumps(
            dict(
                before=before,
                measurements=measurements,
                idle=idle,
                idleAfter=idle_after,
                switches=args.switches,
                after=after,
                sleeping=sleeping,
                awake=awake,
                reboot=reboot,
            ),
            indent=2,
        )
    )
