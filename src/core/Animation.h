#pragma once
#include "CachedReader.h"
#include "Core.h"
#include <algorithm>
#include <array>
namespace badge {
// LBA1 is a display-ready asset, not a GIF decoder. No full framebuffer is needed.
constexpr uint32_t maxAnimationBytes = 1024 * 1024;
inline constexpr auto animationCrcTable = [] {
    std::array<uint32_t, 256> table{};
    for (unsigned i = 0; i < table.size(); ++i) {
        uint32_t value = i;
        for (unsigned bit = 0; bit < 8; ++bit)
            value = (value >> 1) ^ (0xedb88320U & (0U - (value & 1U)));
        table[i] = value;
    }
    return table;
}();
inline uint16_t read16(const uint8_t *p) {
    return uint16_t(p[0]) | uint16_t(p[1]) << 8;
}
struct AnimationHeader {
    uint16_t frames = 0, plays = 0;
    uint32_t bytes = 0, duration = 0, crc = 0;
};
inline bool animationHeader(const uint8_t *p, size_t n, size_t size, AnimationHeader &h) {
    if (n < 32 || memcmp(p, "LBA1", 4) || read16(p + 4) != 240 || read16(p + 6) != 320 ||
        !read16(p + 8) || read16(p + 8) > 300 || read32(p + 12) != size || size < 48 ||
        size > maxAnimationBytes || !read32(p + 16) || read32(p + 16) > 30000 ||
        read32(p + 24) != checksum(p, 24) || read32(p + 28))
        return false;
    h = {read16(p + 8), read16(p + 10), read32(p + 12), read32(p + 16), read32(p + 20)};
    return true;
}
struct AnimationFrame {
    uint16_t x = 0, y = 0, width = 0, height = 0, delay = 0;
};
class AnimationDecoder {
    CachedReader<8192> reader_;
    uint8_t runs_[1024];
    AnimationHeader header_;
    uint16_t frame_ = 0;
    uint32_t crc_ = 0xffffffff, duration_ = 0;
    template <class Source> bool read(Source &source, uint8_t *out, size_t n) {
        if (reader_.read(source, out, n) != n)
            return false;
        for (size_t i = 0; i < n; ++i)
            crc_ = (crc_ >> 8) ^ animationCrcTable[(crc_ ^ out[i]) & 255];
        return true;
    }

  public:
    const AnimationHeader &header() const { return header_; }
    bool finished() const { return frame_ == header_.frames; }
    template <class Source> bool begin(Source &source) {
        // Reset indices, without constructing a large temporary on the loop stack.
        reader_.reset();
        frame_ = 0;
        duration_ = 0;
        crc_ = 0xffffffff;
        uint8_t h[32];
        return reader_.read(source, h, sizeof(h)) == sizeof(h) &&
               animationHeader(h, sizeof(h), source.size(), header_);
    }
    // The sink gets top-down rows in host-endian RGB565, with bounded scratch space.
    template <class Source, class Sink>
    bool next(Source &source, uint16_t *scratch, size_t words, AnimationFrame &f, Sink sink,
              uint16_t *alternate = nullptr) {
        if (finished())
            return false;
        uint8_t h[16];
        if (!read(source, h, sizeof(h)))
            return false;
        f = {read16(h), read16(h + 2), read16(h + 4), read16(h + 6), read16(h + 8)};
        uint16_t encoding = read16(h + 10);
        uint32_t bytes = read32(h + 12), pixels = uint32_t(f.width) * f.height;
        if (f.x + f.width > 240 || f.y + f.height > 320 || f.delay < 20 || f.delay > 30000 ||
            (!f.width != !f.height) || (!pixels && (f.x || f.y || bytes || encoding)) ||
            encoding > 1 || bytes > source.size() - reader_.position() ||
            (!encoding && bytes != pixels * 2) || (encoding && (!bytes || bytes % 4)) ||
            (!frame_ && (f.x || f.y || f.width != 240 || f.height != 320)) ||
            (pixels && words < f.width))
            return false;
        uint32_t end = reader_.position() + bytes, remaining = 0;
        size_t runAt = 0, runValid = 0;
        uint16_t color = 0;
        unsigned rows = f.width ? unsigned(words / f.width) : 1;
        for (unsigned y = 0; y < f.height; y += rows) {
            unsigned countRows = f.height - y < rows ? f.height - y : rows;
            size_t count = size_t(countRows) * f.width;
            if (!encoding) {
                auto *bytes = reinterpret_cast<uint8_t *>(scratch);
                if (reader_.position() + count * 2 > end || !read(source, bytes, count * 2))
                    return false;
                for (size_t i = 0; i < count; ++i)
                    scratch[i] = read16(bytes + i * 2);
            } else {
                size_t i = 0;
                while (i < count) {
                    if (!remaining) {
                        // Read many runs at once. A per-run cached read/CRC call costs
                        // far more than filling a typical short color run on ESP32.
                        if (runAt == runValid) {
                            runValid = std::min<size_t>(sizeof(runs_), end - reader_.position());
                            runAt = 0;
                            if (!runValid || !read(source, runs_, runValid))
                                return false;
                        }
                        remaining = read16(runs_ + runAt);
                        color = read16(runs_ + runAt + 2);
                        runAt += 4;
                        if (!remaining)
                            return false;
                    }
                    size_t run = std::min<size_t>(remaining, count - i);
                    std::fill_n(scratch + i, run, color);
                    i += run;
                    remaining -= run;
                }
            }
            if (!sink(f.x, f.y + y, f.width, countRows, scratch))
                return false;
            if (alternate)
                std::swap(scratch, alternate);
        }
        if (remaining || reader_.position() != end || runAt != runValid)
            return false;
        duration_ += f.delay;
        ++frame_;
        return duration_ <= 30000 &&
               (!finished() || (reader_.position() == source.size() && ~crc_ == header_.crc &&
                                duration_ == header_.duration));
    }
};
} // namespace badge
