"""Bounded USB protocol client for support tools; no line-command fallback."""
import json
import struct
import time
import zlib

MAX_PAYLOAD = 512


def encode(payload):
    if not 1 <= len(payload) <= MAX_PAYLOAD:
        raise ValueError("Invalid payload size")
    raw = b"LB\x01" + struct.pack("<H", len(payload)) + payload
    raw += struct.pack("<I", zlib.crc32(raw))
    return b"\xc0" + raw.replace(b"\xdb", b"\xdb\xdd").replace(b"\xc0", b"\xdb\xdc") + b"\xc0"


class Decoder:
    def __init__(self):
        self.clear()

    def clear(self):
        self.raw = bytearray()
        self.escaped = self.invalid = False

    def feed(self, data):
        frames = []
        for b in data:
            if b == 0xC0:
                raw = self.raw
                if not self.invalid and not self.escaped and len(raw) >= 9 and raw[:3] == b"LB\x01":
                    length = struct.unpack_from("<H", raw, 3)[0]
                    if 0 < length <= MAX_PAYLOAD and len(raw) == length + 9 and zlib.crc32(raw[:-4]) == struct.unpack_from("<I", raw, len(raw) - 4)[0]:
                        frames.append(bytes(raw[5:-4]))
                self.clear()
            elif not self.invalid:
                if self.escaped:
                    if b not in (0xDC, 0xDD):
                        self.invalid = True
                        continue
                    b = 0xC0 if b == 0xDC else 0xDB
                    self.escaped = False
                elif b == 0xDB:
                    self.escaped = True
                    continue
                if len(self.raw) == 521:
                    self.invalid = True
                else:
                    self.raw.append(b)
        return frames


class Client:
    def __init__(self, port, timeout=15):
        self.port = port
        self.timeout = timeout
        self.sequence = 0
        self.token = ""
        self.decoder = Decoder()
        self.frames = []

    def send(self, op, value=0, data=b""):
        self.port.write(encode(struct.pack("<BHI", op, self.sequence, value) + data))

    def receive(self):
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            if not self.frames:
                self.frames.extend(self.decoder.feed(self.port.read(max(1, min(self.port.in_waiting, 1024)))))
            while self.frames:
                frame = self.frames.pop(0)
                if len(frame) < 7:
                    continue
                op, seq, value = struct.unpack_from("<BHI", frame)
                if seq == self.sequence:
                    return op, value, frame[7:]
        raise TimeoutError("Badge timed out. Close other editors and check compatible USB firmware.")

    def acknowledged(self, op, value=0, data=b"", expected=0):
        self.send(op, value, data)
        response = self.receive()
        if response[0] == 1:
            _, length, status = response
            if len(status) != 2 or length > 24576:
                raise RuntimeError("Invalid error response")
            result = bytearray()
            while True:
                kind, offset, part = self.receive()
                if kind == 3 and offset == length == len(result):
                    break
                if kind != 2 or offset != len(result) or len(result) + len(part) > length:
                    raise RuntimeError("Invalid error response offset")
                result.extend(part)
                self.send(5, len(result))
            raise RuntimeError(json.loads(result).get("error", "Request rejected"))
        if response != (0, expected, b""):
            raise RuntimeError("Unexpected transfer acknowledgement")

    def connect(self):
        self.sequence += 1
        self.send(0x70)
        op, version, body = self.receive()
        hello = json.loads(body)
        if op != 0x71 or version != 1 or hello.get("product") != "LanyardBadge" or hello.get("protocol") != 1:
            raise RuntimeError("Incompatible USB firmware")
        session = self.request("/api/pair", {})
        self.token = session["token"]
        return hello

    def request(self, path, body=None, *, raw=False, binary=False):
        self.sequence = (self.sequence + 1) & 65535
        payload = b"" if body is None else bytes(body) if raw else json.dumps(body).encode()
        header = json.dumps(dict(method="GET" if body is None else "POST", path=path, token=self.token, length=len(payload))).encode()
        if len(header) > 512 or len(payload) > (1024 * 1024 if raw else 24576):
            raise ValueError("Request too large")
        for at in range(0, len(header), 505):
            part = header[at:at + 505]
            self.acknowledged(4, at, part, at + len(part))
        self.acknowledged(1)
        for at in range(0, len(payload), 505):
            part = payload[at:at + 505]
            self.acknowledged(2, at, part, at + len(part))
        self.send(3, len(payload))
        op, length, data = self.receive()
        if op != 1 or length > 1024 * 1024 or len(data) != 2:
            raise RuntimeError("Invalid response header")
        code = struct.unpack("<H", data)[0]
        result = bytearray()
        while True:
            op, at, data = self.receive()
            if op == 3 and at == length == len(result) and not data:
                break
            if op != 2 or at != len(result) or len(result) + len(data) > length:
                raise RuntimeError("Invalid response offset")
            result.extend(data)
            self.send(5, len(result))
        if binary and code < 400:
            return bytes(result)
        decoded = json.loads(result)
        if code >= 400:
            raise RuntimeError(decoded.get("error", "Badge request failed"))
        return decoded

    def close(self):
        self.send(0x72)
        self.port.flush()
        self.token = ""
