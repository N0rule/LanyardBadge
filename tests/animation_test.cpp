#include "../src/core/Animation.h"
#include <assert.h>
#include <fstream>
#include <iterator>
#include <stdio.h>
#include <vector>
using namespace badge;
struct Source {
    std::vector<uint8_t> bytes;
    size_t at = 0;
    size_t size() const { return bytes.size(); }
    bool seek(size_t n) {
        if (n > size())
            return false;
        at = n;
        return true;
    }
    size_t read(uint8_t *out, size_t n) {
        if (n > size() - at)
            n = size() - at;
        memcpy(out, bytes.data() + at, n);
        at += n;
        return n;
    }
};
static void put32(std::vector<uint8_t> &b, unsigned at, uint32_t n) {
    for (unsigned i = 0; i < 4; ++i)
        b[at + i] = uint8_t(n >> (8 * i));
}
static void seal(std::vector<uint8_t> &b) {
    put32(b, 20, checksum(b.data() + 32, b.size() - 32));
    put32(b, 24, checksum(b.data(), 24));
}
static bool valid(std::vector<uint8_t> bytes) {
    Source source{bytes};
    AnimationDecoder decoder;
    AnimationFrame frame;
    uint16_t row[240];
    if (!decoder.begin(source))
        return false;
    while (!decoder.finished())
        if (!decoder.next(source, row, 240, frame,
                          [](unsigned, unsigned, unsigned, unsigned, uint16_t *) { return true; }))
            return false;
    return true;
}
int main() {
    std::ifstream file("tests/fixtures/animation.lba", std::ios::binary);
    std::vector<uint8_t> bytes{std::istreambuf_iterator<char>(file), {}};
    assert(bytes.size() == 96 && valid(bytes));
    Source source{bytes};
    AnimationDecoder decoder;
    AnimationFrame frame;
    assert(decoder.begin(source));
    assert(decoder.header().plays == 2 && decoder.header().duration == 360);
    uint16_t scratch[240 * 3];
    std::vector<uint16_t> screen(240 * 320, 0);
    auto paint = [&](unsigned x, unsigned y, unsigned w, unsigned h, uint16_t *pixels) {
        assert(h <= 3 && x + w <= 240 && y + h <= 320);
        for (unsigned row = 0; row < h; ++row)
            memcpy(screen.data() + (y + row) * 240 + x, pixels + row * w, w * 2);
        return true;
    };
    assert(decoder.next(source, scratch, 240 * 3, frame, paint) && frame.delay == 80);
    for (auto pixel : screen)
        assert(pixel == 0xf800);
    assert(decoder.next(source, scratch, 240 * 3, frame, paint) && frame.delay == 120);
    assert(screen[3 * 240 + 2] == 0x07e0 && screen[3 * 240 + 3] == 0x001f);
    assert(screen[4 * 240 + 2] == 0x07e0 && screen[4 * 240 + 3] == 0xffff);
    auto previous = screen;
    assert(decoder.next(source, scratch, 240 * 3, frame, paint) && frame.delay == 160 &&
           screen == previous);
    assert(decoder.finished());
    assert(decoder.begin(source)); // loop/reset must restore a complete first frame
    assert(decoder.next(source, scratch, 240 * 3, frame, paint));
    for (auto pixel : screen)
        assert(pixel == 0xf800);
    for (size_t n = 0; n < bytes.size(); ++n) {
        auto truncated = bytes;
        truncated.resize(n);
        assert(!valid(truncated));
        auto corrupt = bytes;
        corrupt[n] ^= 1;
        assert(!valid(corrupt));
    }
    for (unsigned at : {32U, 36U, 40U, 42U, 52U, 56U, 60U, 64U}) {
        auto corrupt = bytes;
        corrupt[at] = 0xff;
        corrupt[at + 1] = 0xff;
        seal(corrupt);
        assert(!valid(corrupt));
    }
    auto zeroRun = bytes;
    zeroRun[48] = zeroRun[49] = 0;
    seal(zeroRun);
    assert(!valid(zeroRun));
    ImageRead range;
    assert(imageRead("abcdef01&offset=90&length=6", range, 96));
    assert(!imageRead("abcdef01&offset=90&length=7", range, 96));
    puts("Animation: bounded stripes, raw/RLE/delta/unchanged frames, loops, CRC, corruption and "
         "range bounds passed");
}
