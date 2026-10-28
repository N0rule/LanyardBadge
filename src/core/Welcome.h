#pragma once
#include <stdint.h>
namespace badge {
// A small, original geometric print for verified blank boards. No image heap or flash blob.
inline uint16_t welcomePixel(int x, int y) {
    auto circle = [&](int cx, int cy, int r) {
        return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
    };
    uint32_t color = 0xf5efdf;
    if (x > 16 && x < 224 && y > 16 && y < 304)
        color = 0xe5eadf;
    if (circle(79, 177, 111) && !circle(79, 177, 70))
        color = 0x3458d4;
    if (circle(185, 99, 70))
        color = 0xee7559;
    if (y > 97 && y < 150 && x > 150)
        color = 0xf4b267;
    if (circle(79, 177, 70))
        color = 0xf5efdf;
    if (x + y / 2 > 161 && x + y / 2 < 188 && y > 164)
        color = 0x3458d4;
    if (circle(49, 263, 23))
        color = 0x87a998;
    if (y >= 37 && y <= 47 && x >= 34 && x <= 86 && (x - 34) % 16 < 5)
        color = 0x263952;
    if (y >= 283 && y <= 286 && x >= 151 && x <= 202)
        color = 0x263952;
    return uint16_t(((color >> 19) & 31) << 11 | ((color >> 10) & 63) << 5 | ((color >> 3) & 31));
}
} // namespace badge
