#!/usr/bin/env python3
"""Run bounded serial diagnostics without printing setup credentials."""
import argparse
import time
import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("command", nargs="*", default=["status"])
parser.add_argument("--port", default="/dev/ttyUSB0")
parser.add_argument("--seconds", type=float, default=4)
parser.add_argument("--reset", action="store_true")
args = parser.parse_args()
device = serial.Serial(port=None, baudrate=115200, timeout=0.1)
device.dtr = False
device.rts = False
device.port = args.port
with device:
    if args.reset:
        device.rts = True
        time.sleep(0.1)
        device.rts = False
    time.sleep(1.5)
    for command in args.command:
        device.write((command + "\n").encode())
    deadline = time.monotonic() + args.seconds
    while time.monotonic() < deadline:
        data = device.read(4096)
        if data:
            text = data.decode(errors="replace")
            print(text, end="", flush=True)
            if "selftest" in args.command and ("SELFTEST DONE:" in text or "Open setup and initialize" in text):
                break
