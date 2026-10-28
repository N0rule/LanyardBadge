#include "../src/core/CachedReader.h"
#include "../src/core/Core.h"
#include <assert.h>
#include <stdio.h>
#include <vector>
using namespace badge;
static void put32(std::vector<uint8_t> &h, size_t at, uint32_t n) {
    for (int i = 0; i < 4; ++i)
        h[at + i] = (n >> (i * 8)) & 255;
}
struct MemoryFile {
    std::vector<uint8_t> data;
    size_t at = 0, reads = 0;
    explicit MemoryFile(size_t n) : data(n) {
        for (size_t i = 0; i < n; ++i)
            data[i] = uint8_t(i * 31 + i / 97);
    }
    uint32_t size() const { return data.size(); }
    bool seek(uint32_t n) {
        if (n > data.size())
            return false;
        at = n;
        return true;
    }
    size_t read(uint8_t *out, size_t n) {
        ++reads;
        if (n > data.size() - at)
            n = data.size() - at;
        memcpy(out, data.data() + at, n);
        at += n;
        return n;
    }
};
void testCache() {
    MemoryFile source(bitmapBytes);
    CachedReader<4096> cache;
    uint8_t row[480];
    for (int y = 319; y >= 0; --y) {
        uint32_t at = 66 + y * 480;
        assert(cache.seek(at, source.size()));
        assert(cache.read(source, row, sizeof(row)) == sizeof(row));
        assert(!memcmp(row, source.data.data() + at, sizeof(row)));
    }
    assert(source.reads < 160); // Bounds the expensive backwards-row filesystem reads.
    for (unsigned i = 0; i < 1000; ++i) {
        uint32_t at = (i * 7919U) % source.size();
        size_t count = (i * 43) % sizeof(row);
        if (count > source.size() - at)
            count = source.size() - at;
        assert(cache.seek(at, source.size()));
        assert(cache.read(source, row, count) == count);
        assert(!memcmp(row, source.data.data() + at, count));
    }
    assert(!cache.seek(source.size() + 1, source.size()));
    assert(cache.seek(source.size(), source.size()));
    assert(cache.read(source, row, 1) == 0);
}
int main() {
    ImageRead read;
    assert(imageRead("abcdef01", read) && read.length == bitmapBytes && !read.ranged);
    assert(imageRead("abcdef01&offset=153600&length=66", read) && read.ranged &&
           read.offset == 153600 && read.length == 66);
    for (const char *query :
         {"", "../a.bmp", "ABCDEF01", "abcdef01&offset=-1&length=1",
          "abcdef01&offset=0&length=4097", "abcdef01&offset=0&length=0",
          "abcdef01&offset=153666&length=1", "abcdef01&offset=153665&length=2",
          "abcdef01&offset=99999999999999999999999&length=1", "abcdef01&offset=0&length=1&extra=2"})
        assert(!imageRead(query, read));
    testCache();
    char code[5], sameCode[5], otherCode[5];
    shortPairingCode("abcdefghijklmnop", code);
    shortPairingCode("abcdefghijklmnop", sameCode);
    shortPairingCode("qrstuvwxyz234567", otherCode);
    assert(strlen(code) == 4 && !strcmp(code, sameCode) && strcmp(code, otherCode));
    for (unsigned i = 0; i < 4; ++i)
        assert(strchr("ABCDEFGHJKLMNPQRSTUVWXYZ", code[i]));
    ScreenActivity screen;
    screen.wake(1000);
    screen.update(15999, 15, false, false);
    assert(!screen.asleep());
    screen.update(16000, 15, false, false);
    assert(screen.asleep());
    screen.update(16008, 15, true, false);
    assert(!screen.asleep() && screen.consumed());
    screen.update(17000, 15, true, false);
    assert(screen.consumed());
    screen.update(17010, 15, false, false);
    assert(!screen.consumed());
    screen.update(60000, 0, false, false);
    assert(!screen.asleep());
    screen.update(70000, 15, false, true);
    assert(!screen.asleep());
    screen.wake(0xfffffff0);
    screen.update(14983, 15, false, false);
    assert(!screen.asleep());
    screen.update(14984, 15, false, false);
    assert(screen.asleep());
    for (unsigned seconds : {0, 15, 30, 60, 120, 300, 600})
        assert(validScreenTimeout(seconds));
    assert(!validScreenTimeout(1) && !validScreenTimeout(3600));
    Calibration c;
    Point raw[] = {{3800, 300}, {3800, 3700}, {250, 300}},
          dest[] = {{24, 24}, {215, 24}, {24, 295}};
    assert(calibrate(raw, dest, c));
    assert(c.sane());
    for (int i = 0; i < 3; ++i) {
        Point p = c.map(raw[i].x, raw[i].y, 0);
        assert(abs(p.x - dest[i].x) <= 1 && abs(p.y - dest[i].y) <= 1);
    }
    Point fourth = c.map(250, 3700, 0);
    assert(abs(fourth.x - 215) <= 1 && abs(fourth.y - 295) <= 1);
    Point flipped = c.map(250, 3700, 2);
    assert(abs(flipped.x - 24) <= 1 && abs(flipped.y - 24) <= 1);
    Point bad[] = {{1, 1}, {1, 1}, {1, 1}};
    assert(!calibrate(bad, dest, c));
    assert(validId("0012abef"));
    assert(!validId("../foo00"));
    assert(!validId("ABCDEF12"));
    assert(!validId("abc"));
    std::vector<uint8_t> h(66, 0);
    h[0] = 'B';
    h[1] = 'M';
    put32(h, 2, bitmapBytes);
    put32(h, 10, 66);
    put32(h, 14, 40);
    put32(h, 18, 240);
    put32(h, 22, 320);
    h[26] = 1;
    h[28] = 16;
    put32(h, 30, 3);
    put32(h, 34, 153600);
    put32(h, 54, 0xf800);
    put32(h, 58, 0x07e0);
    put32(h, 62, 31);
    assert(validBitmap(h.data(), h.size(), bitmapBytes));
    assert(!validBitmap(h.data(), h.size(), bitmapBytes - 1));
    for (int pos : {0, 10, 18, 22, 26, 28, 30, 54, 58, 62}) {
        auto invalid = h;
        invalid[pos] ^= 1;
        assert(!validBitmap(invalid.data(), invalid.size(), bitmapBytes));
    }
    Gestures g;
    assert(g.update(true, {100, 100}, 0) == Gesture::None);
    assert(g.update(false, {101, 101}, 90) == Gesture::Tap);
    assert(g.update(true, {180, 100}, 200) == Gesture::None);
    assert(g.update(false, {60, 100}, 600) == Gesture::Left);
    g.update(true, {60, 100}, 700);
    assert(g.update(false, {180, 103}, 1000) == Gesture::Right);
    g.update(true, {100, 100}, 1100);
    assert(g.update(true, {103, 102}, 1900) == Gesture::Hold);
    assert(g.update(false, {103, 102}, 2000) == Gesture::None);
    g.update(true, {100, 100}, 2100);
    assert(g.update(false, {100, 100}, 2120) == Gesture::None);
    g.update(true, {100, 100}, 2200);
    assert(g.update(false, {103, 210}, 2500) == Gesture::None);
    assert(checksum("123456789", 9) == 0xcbf43926);
    puts("Core: affine calibration, rotation, clamping, invalid BMPs, IDs, gestures, CRC, "
         "reverse-row cache passed");
}
