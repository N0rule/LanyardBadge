#!/usr/bin/env python3
"""Exercise native screens and verify manual selection survives a restart."""
import argparse
import json
import time
import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", default="/dev/ttyUSB0")
parser.add_argument("--switches", type=int, default=100)
args = parser.parse_args()
device = serial.Serial(None, 115200, timeout=0.1)
device.dtr = False
device.rts = False
device.port = args.port

def command(text):
    device.write((text + "\n").encode())

def status():
    device.reset_input_buffer()
    command("status")
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        text = device.readline().decode(errors="replace").strip()
        if text.startswith('{"firmware":'):
            return json.loads(text)
        if text:
            print(text, flush=True)
    raise RuntimeError("No status response; inspect the serial monitor")

with device:
    time.sleep(1.5)
    command("close")
    command("badge")
    time.sleep(0.3)
    before = status()
    if before["autoplay"]:
        raise RuntimeError("Disable slideshow before running this deterministic switch test")
    timings=[]
    for i in range(args.switches):
        start=time.monotonic()
        command("next")
        current=status()  # Acknowledge each draw instead of overflowing the UART queue.
        assert current["selected"] == (before["selected"]+i+1)%before["cards"]
        timings.append(time.monotonic()-start)
    time.sleep(2)
    after = status()
    expected = (before["selected"] + args.switches) % before["cards"]
    assert after["selected"] == expected, (after["selected"], expected)
    for page in ["menu", "diag", "badge"]:
        command(page)
        time.sleep(0.3)
    screens = status()
    command("restart")
    time.sleep(2)
    rebooted = status()
    assert rebooted["selected"] == expected, "Manual selection did not persist"
    assert rebooted["revision"] == before["revision"], "Card database changed during screen switching"
    assert rebooted["cards"] == before["cards"]
    assert rebooted["rotation"] == before["rotation"]
    assert rebooted["brightness"] == before["brightness"]
    print(json.dumps({"switches": args.switches, "meanRoundTripMs": round(sum(timings)*1000/len(timings),1),
                      "maxRoundTripMs": round(max(timings)*1000,1), "before": before, "after": after,
                      "screens": screens, "rebooted": rebooted}, indent=2))
    print("PASS: repeated native rendering and reboot persistence")
