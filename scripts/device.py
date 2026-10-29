#!/usr/bin/env python3
"""Read device status or cards through the framed USB support API."""
import argparse
import json
import time
import serial
from serial_protocol import Client

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("command", nargs="?", choices=["status", "cards"], default="status")
parser.add_argument("--port", default="/dev/ttyUSB0")
parser.add_argument("--seconds", type=float, default=15)
parser.add_argument("--reset", action="store_true", help="Explicitly pulse RTS to restart the device")
args = parser.parse_args()
device = serial.Serial(port=None, baudrate=115200, timeout=0.1, write_timeout=2)
device.dtr = device.rts = False
device.port = args.port
with device:
    if args.reset:
        device.rts = True
        time.sleep(0.1)
        device.rts = False
    time.sleep(1.5)
    client = Client(device, timeout=max(1, min(args.seconds, 60)))
    try:
        client.connect()
        print(json.dumps(client.request("/api/" + args.command), indent=2))
    finally:
        try:
            client.close()
        except (serial.SerialException, OSError):
            pass
