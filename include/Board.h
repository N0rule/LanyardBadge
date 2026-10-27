#pragma once
#include <stdint.h>
namespace badge::board {
constexpr uint16_t width = 240, height = 320;
constexpr int displayMosi = 13, displayMiso = 12, displayClock = 14;
constexpr int displayCs = 15, displayDc = 2, displayReset = -1;
constexpr int backlight = 21;
constexpr int touchMosi = 32, touchMiso = 39, touchClock = 25;
constexpr int touchCs = 33, touchIrq = 36, boot = 0;
constexpr uint32_t displayFrequency = 40000000;
constexpr uint32_t backlightFrequency = 20000;
constexpr uint8_t backlightResolution = 8;
} // namespace badge::board
