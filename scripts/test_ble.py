#!/usr/bin/env python3
"""Real BLE protocol validation using unpaired Bluetooth with a badge-displayed code."""

import argparse, asyncio, json, struct, time, copy
from pathlib import Path
from bleak import BleakScanner, BleakClient

SERVICE = "f40d1000-6f15-4d56-b6d4-17c92e648a10"
RX = SERVICE.replace("1000-", "1001-")
TX = SERVICE.replace("1000-", "1002-")
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--output", type=Path, default=Path("test-results/ble-hardware.json"))
p.add_argument("--read-only", action="store_true", help="Read status and artwork without uploading or changing cards")
args = p.parse_args()


class Protocol:
    def __init__(self, client):
        self.client = client
        self.queue = asyncio.Queue()
        self.seq = 0
        self.token = ""
        self.initialized = False
        self.last_notification = None

    def notified(self, _, data):
        packet = bytes(data)
        # BlueZ may report an identical characteristic value change twice.
        # Reads also emit short HELLO values on some hosts. Neither is a packet.
        if len(packet) < 7 or packet == self.last_notification:
            return
        self.last_notification = packet
        self.queue.put_nowait(packet)

    async def frame(self, op, offset, data=b""):
        await self.client.write_gatt_char(
            RX, struct.pack("<BHI", op, self.seq, offset) + data, response=True
        )

    async def receive(self):
        while True:
            data = await asyncio.wait_for(self.queue.get(), 15)
            if len(data) < 7:
                continue
            op, seq, offset = struct.unpack_from("<BHI", data)
            if seq == self.seq:
                return op, offset, data[7:]

    async def ack(self, op, offset, data=b"", expected=0):
        await self.frame(op, offset, data)
        result = await self.receive()
        assert result[:2] == (0, expected), result[:2]

    async def request(self, path, body=None, raw=False):
        print("BLE request", path, flush=True)
        if not self.initialized:
            hello = await self.client.read_gatt_char(TX)
            assert hello[0] == 4, "Update badge firmware to protocol 4"
            if hello[0] == 4:
                await self.ack(6, 0)
            self.initialized = True
        self.seq = (self.seq + 1) & 65535
        payload = (
            body if raw else json.dumps(body).encode() if body is not None else b""
        )
        header = json.dumps(
            dict(
                method="POST" if body is not None else "GET",
                path=path,
                token=self.token,
                length=len(payload),
            )
        ).encode()
        hello = await self.client.read_gatt_char(TX)
        mtu = int.from_bytes(hello[1:3], "little")
        size = min(512, mtu - 3) - 7
        print("Negotiated MTU", mtu, flush=True)
        for at in range(0, len(header), size):
            chunk = header[at : at + size]
            await self.ack(4, at, chunk, at + len(chunk))
        await self.ack(1, 0)
        for at in range(0, len(payload), size):
            chunk = payload[at : at + size]
            await self.ack(2, at, chunk, at + len(chunk))
        await self.frame(3, len(payload))
        op, total, code = await self.receive()
        assert op == 1
        code = int.from_bytes(code, "little")
        received = bytearray()
        while True:
            op, at, data = await self.receive()
            if op == 3:
                assert at == total == len(received)
                break
            assert op == 2 and at == len(received)
            received.extend(data)
            await self.frame(5, len(received))
        if path.startswith("/api/image"):
            return bytes(received)
        result = json.loads(received)
        assert code < 400, (code, result)
        return result


async def main():
    device = await BleakScanner.find_device_by_filter(
        lambda d, a: SERVICE in a.service_uuids, timeout=10
    )
    assert device, "Badge advertising not found"
    print("Discovered", device.name, flush=True)
    report = {
        "client": "Bleak on BlueZ, real BLE radio",
        "deviceName": device.name,
        "checks": [],
    }
    async with BleakClient(device, timeout=15, pair=False) as client:
        print("GATT connected", flush=True)
        proto = Protocol(client)
        hello = await client.read_gatt_char(TX)
        assert hello[0] == 4
        await client.start_notify(TX, proto.notified)
        pair = await proto.request(
            "/api/pair", {"password": __import__("getpass").getpass("Four-letter badge code: ")}
        )
        proto.token = pair["token"]
        report["checks"].append("Native authenticated bond authorized session")
        before = await proto.request("/api/status")
        deck = await proto.request("/api/cards")
        report["before"] = before
        read_started = time.monotonic()
        original = await proto.request("/api/image?id=" + deck["cards"][0]["image"])
        assert len(original) == before["artworkSizes"][deck["cards"][0]["image"]]
        report["readSeconds"] = round(time.monotonic() - read_started, 3)
        if args.read_only:
            import hashlib
            report["artworkSHA256"] = hashlib.sha256(original).hexdigest()
            report["checks"].append("Full existing artwork readback; no writes")
            args.output.write_text(json.dumps(report, indent=2) + "\n")
            print("PASS: native BLE session and complete artwork readback")
            return
        start = time.monotonic()
        uploaded = await proto.request("/api/animations" if original[:4] == b"LBA1" else "/api/assets", original, raw=True)
        report["uploadSeconds"] = round(time.monotonic() - start, 3)
        downloaded = await proto.request("/api/image?id=" + uploaded["id"])
        assert downloaded == original
        report["checks"].append(
            "Full artwork upload and download with byte comparison"
        )
        original_deck = copy.deepcopy(deck)
        test_card = copy.deepcopy(deck["cards"][0])
        test_card["id"] = "beef0001"
        test_card["title"] = "BLE verification"
        test_card["image"] = uploaded["id"]
        assert (
            len(deck["cards"]) < 10
        ), "Free one card slot before running the end-to-end test"
        deck["cards"].append(test_card)
        committed = await proto.request("/api/cards", deck)
        try:
            shown = await proto.request("/api/select", {"id": test_card["id"]})
            assert shown["activeCard"] == test_card["id"]
            report["checks"].append(
                "Atomic card metadata commit and real card selection"
            )
        finally:
            original_deck["revision"] = committed["revision"]
            await proto.request("/api/cards", original_deck)
            await proto.request("/api/select", {"id": before["activeCard"]})
        report["after"] = await proto.request("/api/status")
        assert report["after"]["revision"] == before["revision"] + 2
        assert report["after"]["cards"] == before["cards"]
        report["checks"].append(
            "Original card content and selection restored after end-to-end test"
        )
        # Collect the unreferenced test image only; both manifest generations are preserved.
        await proto.request("/api/gc", {})
        # Start another upload, accept a prefix, then drop the link before commit.
        proto.seq = (proto.seq + 1) & 65535
        header = json.dumps(
            dict(
                method="POST",
                path="/api/animations" if original[:4] == b"LBA1" else "/api/assets",
                token=proto.token,
                length=len(original),
            )
        ).encode()
        await proto.ack(4, 0, header, len(header))
        await proto.ack(1, 0)
        await proto.ack(2, 0, original[:128], 128)
        await client.disconnect()
    async with BleakClient(device, timeout=15, pair=False) as client:
        proto = Protocol(client)
        hello = await client.read_gatt_char(TX)
        assert hello[0] == 4
        await client.start_notify(TX, proto.notified)
        pair = await proto.request(
            "/api/pair", {"password": __import__("getpass").getpass("Four-letter badge code: ")}
        )
        proto.token = pair["token"]
        recovered = await proto.request("/api/status")
        assert (
            recovered["revision"] == report["after"]["revision"]
            and recovered["cards"] == before["cards"]
        )
        report["checks"].append(
            "Interrupted upload discarded; reconnect and re-pair preserve committed collection"
        )
    report["checks"].append("Clean disconnect")
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(
        "PASS: real BLE pairing, status, cards, full asset transfer, cleanup and disconnect"
    )


asyncio.run(asyncio.wait_for(main(), 240))
