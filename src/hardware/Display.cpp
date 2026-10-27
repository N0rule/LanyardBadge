#include "Display.h"
#include "Board.h"
#include <Arduino.h>
namespace badge {
Display::Display() {
    auto b = bus_.config();
    b.spi_host = SPI2_HOST;
    b.spi_mode = 0;
    b.freq_write = board::displayFrequency;
    b.freq_read = 16000000;
    b.spi_3wire = false;
    b.use_lock = true;
    b.dma_channel = SPI_DMA_CH_AUTO;
    b.pin_sclk = board::displayClock;
    b.pin_mosi = board::displayMosi;
    b.pin_miso = board::displayMiso;
    b.pin_dc = board::displayDc;
    bus_.config(b);
    panel_.setBus(&bus_);
    auto p = panel_.config();
    p.pin_cs = board::displayCs;
    p.pin_rst = board::displayReset;
    p.pin_busy = -1;
    p.panel_width = board::width;
    p.panel_height = board::height;
    p.memory_width = board::width;
    p.memory_height = board::height;
    p.offset_x = 0;
    p.offset_y = 0;
    p.offset_rotation = 0;
    p.readable = false;
    p.invert = false;    // Preserve the working TFT_INVERSION_OFF setting.
    p.rgb_order = false; // Physical test: true swapped red/blue on this panel.
    p.bus_shared = false;
    panel_.config(p);
    setPanel(&panel_);
}
bool Display::begin(uint8_t rotation, uint8_t percent) {
    pinMode(board::backlight, OUTPUT);
    digitalWrite(board::backlight, LOW);
    bool ok = init();
    setColorDepth(16);
    orientation(rotation);
    fillScreen(TFT_BLACK);
    pwm_ = ledcAttach(board::backlight, board::backlightFrequency, board::backlightResolution);
    brightness(percent);
    return ok && pwm_;
}
void Display::brightness(uint8_t percent) {
    percent = percent == 0 ? 0 : constrain(percent, 5, 100);
    if (pwm_)
        ledcWrite(board::backlight, (percent * 255U) / 100U);
}
void Display::orientation(uint8_t rotation) {
    setRotation(rotation == 2 ? 2 : 0);
}
void Display::flushArea(const lv_area_t *a, uint8_t *pixels) {
    startWrite();
    setAddrWindow(a->x1, a->y1, lv_area_get_width(a), lv_area_get_height(a));
    // LVGL RGB565 is host endian; LovyanGFX swaps for the SPI wire.
    writePixels(reinterpret_cast<uint16_t *>(pixels), lv_area_get_size(a), true);
    endWrite();
}
} // namespace badge
