#pragma once
#include <stddef.h>
#include <stdint.h>
namespace badge {
// SLIP envelope: LB, version 1, uint16 LE payload length, payload, CRC32 LE.
// CRC covers everything preceding it. Diagnostics outside delimiters are ignored.
struct SerialFrame {
    static constexpr size_t maxPayload = 512, maxRaw = maxPayload + 9;
    uint8_t bytes[maxRaw]{};
    size_t used = 0;
    bool escaped = false, invalid = false;
    static uint32_t crc(const uint8_t *p, size_t n) {
        uint32_t c = 0xffffffff;
        while (n--) {
            c ^= *p++;
            for (unsigned bit = 0; bit < 8; ++bit)
                c = (c >> 1) ^ (0xedb88320U & (0U - (c & 1)));
        }
        return ~c;
    }
    void clear() {
        used = 0;
        escaped = invalid = false;
    }
    // Returns a verified payload length only on the closing delimiter.
    size_t push(uint8_t b) {
        if (b == 0xc0) {
            size_t n = 0;
            if (!invalid && !escaped && used >= 9 && bytes[0] == 'L' && bytes[1] == 'B' &&
                bytes[2] == 1) {
                size_t length = size_t(bytes[3]) | size_t(bytes[4]) << 8;
                if (length <= maxPayload && used == length + 9) {
                    uint32_t sum = 0;
                    for (unsigned i = 0; i < 4; ++i)
                        sum |= uint32_t(bytes[used - 4 + i]) << (8 * i);
                    if (sum == crc(bytes, used - 4))
                        n = length;
                }
            }
            clear();
            return n;
        }
        if (invalid)
            return 0;
        if (escaped) {
            if (b == 0xdc)
                b = 0xc0;
            else if (b == 0xdd)
                b = 0xdb;
            else {
                invalid = true;
                return 0;
            }
            escaped = false;
        } else if (b == 0xdb) {
            escaped = true;
            return 0;
        }
        if (used == maxRaw) {
            invalid = true;
            return 0;
        }
        bytes[used++] = b;
        return 0;
    }
    static size_t encode(const uint8_t *payload, size_t n, uint8_t *out) {
        if (!n || n > maxPayload)
            return 0;
        uint8_t raw[maxRaw] = {'L', 'B', 1, uint8_t(n), uint8_t(n >> 8)};
        for (size_t i = 0; i < n; ++i)
            raw[5 + i] = payload[i];
        uint32_t sum = crc(raw, n + 5);
        for (unsigned i = 0; i < 4; ++i)
            raw[n + 5 + i] = sum >> (8 * i);
        size_t at = 0;
        out[at++] = 0xc0;
        for (size_t i = 0; i < n + 9; ++i) {
            if (raw[i] == 0xc0 || raw[i] == 0xdb) {
                out[at++] = 0xdb;
                out[at++] = raw[i] == 0xc0 ? 0xdc : 0xdd;
            } else
                out[at++] = raw[i];
        }
        out[at++] = 0xc0;
        return at;
    }
};
} // namespace badge
