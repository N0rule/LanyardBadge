#pragma once
#include "../core/Core.h"
#include "Board.h"
#include <Arduino.h>
#include <SPI.h>
#include <XPT2046_Touchscreen.h>
namespace badge {
class Touch {
    SPIClass bus_{VSPI};
    // Poll the controller directly: a missed IRQ edge must never disable input.
    XPT2046_Touchscreen touch_{board::touchCs};
    Point raw_{}, mapped_{};
    bool down_ = false;
    TouchContact contact_;
    uint32_t last_ = 0;
    uint32_t presses_ = 0;
    int16_t pressure_ = 0;

  public:
    Calibration calibration;
    uint8_t rotation = 0;
    bool begin();
    void poll();
    bool down() const { return down_; }
    Point raw() const { return raw_; }
    Point point() const { return mapped_; }
    uint32_t presses() const { return presses_; }
    int16_t pressure() const { return pressure_; }
};
} // namespace badge
