import unittest
from serial_protocol import Decoder, encode


class Framing(unittest.TestCase):
    def test_all_payload_sizes_and_stream_boundaries(self):
        for n in range(1, 513):
            payload = bytes((i + n) % 256 for i in range(n))
            decoder = Decoder()
            frames = []
            for b in encode(payload):
                frames.extend(decoder.feed(bytes([b])))
            self.assertEqual(frames, [payload])

    def test_bad_crc_truncation_and_overflow(self):
        payload = bytes(range(256))
        wire = bytearray(encode(payload))
        wire[-3] ^= 1
        decoder = Decoder()
        self.assertEqual(decoder.feed(wire), [])
        self.assertEqual(decoder.feed(encode(payload)[:30] + b"x" * 10000), [])
        self.assertLessEqual(len(decoder.raw), 521)
        self.assertEqual(decoder.feed(encode(payload)), [payload])

    def test_bounds(self):
        for n in (0, 513):
            with self.assertRaises(ValueError):
                encode(bytes(n))


if __name__ == "__main__":
    unittest.main()
