#pragma once
#include <LovyanGFX.hpp>
#include <lvgl.h>
namespace badge {
class Display : public lgfx::LGFX_Device {
    lgfx::Bus_SPI bus_;
#if BADGE_ST7789
    lgfx::Panel_ST7789 panel_;
#else
    lgfx::Panel_ILI9341 panel_;
#endif
    bool pwm_ = false;

  public:
    Display();
    bool begin(uint8_t rotation, uint8_t brightness);
    void brightness(uint8_t percent);
    void orientation(uint8_t rotation);
    void flushArea(const lv_area_t *area, uint8_t *pixels);
    void beginArea(int x, int y, int width, int height);
    void writeAreaPixels(uint16_t *pixels, size_t count, bool wait = true);
    void endArea();
};
} // namespace badge
