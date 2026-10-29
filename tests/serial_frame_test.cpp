#include "../src/core/SerialFrame.h"
#include <cassert>
#include <cstring>
#include <iostream>
using badge::SerialFrame;
int main() {
    assert(SerialFrame::crc(reinterpret_cast<const uint8_t *>("123456789"), 9) == 0xcbf43926);
    uint8_t payload[512], encoded[1044];
    for (size_t n = 1; n <= 512; ++n) {
        for (size_t i = 0; i < n; ++i)
            payload[i] = (i + n) & 255;
        auto size = SerialFrame::encode(payload, n, encoded);
        SerialFrame parser;
        for (size_t i = 0; i < size; ++i) {
            auto result = parser.push(encoded[i]);
            assert(result == (i + 1 == size ? n : 0));
        }
        assert(!memcmp(parser.bytes + 5, payload, n));
        // Every single-bit corruption in a frame must be rejected.
        for (size_t byte = 1; byte + 1 < size; ++byte) {
            SerialFrame corrupt;
            for (size_t i = 0; i < size; ++i)
                assert(corrupt.push(encoded[i] ^ (i == byte ? 1 : 0)) == 0);
        }
        // Truncation followed by diagnostics/oversized junk must resynchronize.
        for (size_t i = 0; i < size / 2; ++i)
            parser.push(encoded[i]);
        for (unsigned i = 0; i < 2000; ++i)
            assert(!parser.push('x'));
        size_t delivered = 0;
        for (size_t i = 0; i < size; ++i)
            delivered += parser.push(encoded[i]);
        assert(delivered == n);
    }
    std::cout << "Serial frames: bounded decoding, CRC, escaping and recovery passed\n";
}
