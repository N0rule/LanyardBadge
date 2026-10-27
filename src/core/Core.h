#pragma once
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
namespace badge {
constexpr uint32_t bitmapBytes = 153666;
constexpr size_t maxCards = 10, maxElements = 4;
enum class UploadPhase { Idle, Receiving, Saving, Complete, Failed };
inline const char *uploadPhaseName(UploadPhase phase) {
    switch (phase) {
    case UploadPhase::Receiving:
        return "receiving";
    case UploadPhase::Saving:
        return "saving";
    case UploadPhase::Complete:
        return "complete";
    case UploadPhase::Failed:
        return "failed";
    default:
        return "idle";
    }
}
struct Point {
    int16_t x, y;
};
struct Calibration {
    // Factory mapping based on the supplied board's retained four-corner calibration.
    float a = 0.065888f, b = 0.000906f, c = -12.43359f;
    float d = 0.004983f, e = 0.09326f, f = -32.71304f;
    bool valid = false;
    Point map(int x, int y, uint8_t rotation) const {
        int px = lroundf(a * x + b * y + c), py = lroundf(d * x + e * y + f);
        if (rotation == 2) {
            px = 239 - px;
            py = 319 - py;
        }
        return {int16_t(px < 0     ? 0
                        : px > 239 ? 239
                                   : px),
                int16_t(py < 0     ? 0
                        : py > 319 ? 319
                                   : py)};
    }
    bool sane() const {
        return isfinite(a) && isfinite(b) && isfinite(c) && isfinite(d) && isfinite(e) &&
               isfinite(f) && fabsf(a) < 1 && fabsf(b) < 1 && fabsf(d) < 1 && fabsf(e) < 1 &&
               fabsf(c) < 5000 && fabsf(f) < 5000 && fabsf(a * e - b * d) > 0.00001f;
    }
};
inline bool calibrate(const Point raw[3], const Point target[3], Calibration &out) {
    const float x0 = raw[0].x, y0 = raw[0].y, x1 = raw[1].x, y1 = raw[1].y, x2 = raw[2].x,
                y2 = raw[2].y;
    const float det = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
    if (fabsf(det) < 10000)
        return false;
    auto solve = [&](float z0, float z1, float z2, float &a, float &b, float &c) {
        a = (z0 * (y1 - y2) + z1 * (y2 - y0) + z2 * (y0 - y1)) / det;
        b = (z0 * (x2 - x1) + z1 * (x0 - x2) + z2 * (x1 - x0)) / det;
        c = (z0 * (x1 * y2 - x2 * y1) + z1 * (x2 * y0 - x0 * y2) + z2 * (x0 * y1 - x1 * y0)) / det;
    };
    solve(target[0].x, target[1].x, target[2].x, out.a, out.b, out.c);
    solve(target[0].y, target[1].y, target[2].y, out.d, out.e, out.f);
    out.valid = out.sane();
    return out.valid;
}
inline bool validId(const char *id) {
    if (!id || strlen(id) != 8)
        return false;
    for (int i = 0; i < 8; ++i)
        if (!((id[i] >= '0' && id[i] <= '9') || (id[i] >= 'a' && id[i] <= 'f')))
            return false;
    return true;
}
inline uint32_t read32(const uint8_t *p) {
    return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
inline bool validBitmap(const uint8_t *h, size_t n, size_t size) {
    return n >= 66 && size == bitmapBytes && h[0] == 'B' && h[1] == 'M' &&
           read32(h + 2) == bitmapBytes && read32(h + 10) == 66 && read32(h + 14) == 40 &&
           read32(h + 18) == 240 && read32(h + 22) == 320 && h[26] == 1 && h[27] == 0 &&
           h[28] == 16 && h[29] == 0 && read32(h + 30) == 3 && read32(h + 34) == 153600 &&
           read32(h + 54) == 0xf800 && read32(h + 58) == 0x07e0 && read32(h + 62) == 0x001f;
}
inline uint32_t checksum(const void *data, size_t n) {
    uint32_t crc = 0xffffffff;
    auto *p = static_cast<const uint8_t *>(data);
    while (n--) {
        crc ^= *p++;
        for (int k = 0; k < 8; ++k)
            crc = (crc >> 1) ^ (0xedb88320U & (0U - (crc & 1U)));
    }
    return ~crc;
}
// A readable code derived from the per-device credential. The credential itself
// remains high entropy; code entry is physically gated and rate limited.
inline void shortPairingCode(const char *credential, char out[5]) {
    static constexpr char letters[] = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    uint32_t value = checksum(credential, strlen(credential));
    for (unsigned i = 0; i < 4; ++i) {
        out[i] = letters[value % (sizeof(letters) - 1)];
        value /= sizeof(letters) - 1;
    }
    out[4] = 0;
}
inline bool validScreenTimeout(uint32_t seconds) {
    return seconds == 0 || seconds == 15 || seconds == 30 || seconds == 60 || seconds == 120 ||
           seconds == 300 || seconds == 600;
}
// Portable inactivity state machine. A waking press stays consumed until release.
class ScreenActivity {
    uint32_t activity_ = 0;
    bool asleep_ = false, consume_ = false;

  public:
    void wake(uint32_t now, bool consume = false) {
        asleep_ = false;
        activity_ = now;
        consume_ |= consume;
    }
    void sleep() { asleep_ = true; }
    bool asleep() const { return asleep_; }
    bool consumed() const { return consume_; }
    void update(uint32_t now, uint32_t timeout, bool down, bool busy) {
        if (asleep_ && down)
            wake(now, true);
        if (!down)
            consume_ = false;
        if (down || busy)
            activity_ = now;
        if (!asleep_ && timeout && !busy && !down && uint32_t(now - activity_) >= timeout * 1000U)
            asleep_ = true;
    }
};
enum class Gesture { None, Tap, Left, Right, Hold };
class Gestures {
    bool active_ = false, held_ = false;
    Point start_{};
    uint32_t began_ = 0;

  public:
    void reset() {
        active_ = false;
        held_ = false;
    }
    Gesture update(bool down, Point p, uint32_t now) {
        if (down && !active_) {
            start_ = p;
            began_ = now;
            active_ = true;
            held_ = false;
            return Gesture::None;
        }
        int dx = p.x - start_.x, dy = p.y - start_.y;
        if (down && !held_ && now - began_ >= 750 && abs(dx) < 14 && abs(dy) < 14) {
            held_ = true;
            return Gesture::Hold;
        }
        if (!down && active_) {
            active_ = false;
            if (held_ || now - began_ < 35)
                return Gesture::None;
            if (abs(dx) >= 45 && abs(dx) > abs(dy) * 2 && now - began_ < 1200)
                return dx < 0 ? Gesture::Left : Gesture::Right;
            if (abs(dx) < 14 && abs(dy) < 14 && now - began_ < 750)
                return Gesture::Tap;
        }
        return Gesture::None;
    }
};
} // namespace badge
