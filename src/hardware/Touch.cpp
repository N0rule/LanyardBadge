#include "Touch.h"
namespace badge {
bool Touch::begin() {
    bus_.begin(board::touchClock, board::touchMiso, board::touchMosi, board::touchCs);
    bool ok = touch_.begin(bus_);
    touch_.setRotation(0);
    return ok;
}
void Touch::poll() {
    uint32_t now = millis();
    if (now - last_ < 8)
        return;
    last_ = now;
    auto p = touch_.getPoint();
    pressure_ = p.z;
    bool pressed = p.z >= 200 && p.x > 0 && p.x < 4095 && p.y > 0 && p.y < 4095;
    if (pressed) {
        raw_ = {p.x, p.y};
        mapped_ = calibration.map(p.x, p.y, rotation);
    }
    bool wasDown = down_;
    down_ = contact_.update(pressed, now);
    if (down_ && !wasDown)
        ++presses_;
}
} // namespace badge
