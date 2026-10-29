#include "SerialTransport.h"
#include "../core/Console.h"
#include <algorithm>
namespace badge {
bool SerialTransport::notify(uint8_t op, uint32_t value, const uint8_t *data, size_t n) {
    if (outputAt_ != outputSize_ || n > 505)
        return false;
    uint8_t frame[512] = {op, uint8_t(sequence_), uint8_t(sequence_ >> 8)};
    for (unsigned i = 0; i < 4; ++i)
        frame[3 + i] = value >> (8 * i);
    if (n)
        memcpy(frame + 7, data, n);
    outputAt_ = 0;
    outputSize_ = SerialFrame::encode(frame, n + 7, output_);
    return outputSize_ != 0;
}
void SerialTransport::close() {
    reset();
    active_ = serialEditing = false;
    failed_ = false;
    parser_.clear();
    outputAt_ = outputSize_ = 0;
}
void SerialTransport::tick() {
    // Bound work per loop to keep touch and animation responsive at 115200 baud.
    for (unsigned budget = 0; budget < 128 && Serial.available(); ++budget) {
        size_t n = parser_.push(Serial.read());
        if (!n)
            continue;
        const uint8_t *p = parser_.bytes + 5;
        if (n == 7 && p[0] == 0x70) {
            if (!api_.claim(this))
                continue; // Never steal a live BLE editing session.
            close();
            api_.claim(this);
            active_ = serialEditing = true;
            seen_ = millis();
            sequence_ = uint16_t(p[1]) | uint16_t(p[2]) << 8;
            char identity[17];
            snprintf(identity, sizeof(identity), "%016llx", (unsigned long long)ESP.getEfuseMac());
            String hello = String("{\"product\":\"LanyardBadge\",\"protocol\":1,\"id\":\"") +
                           identity + "\",\"packetBytes\":512}";
            notify(0x71, 1, reinterpret_cast<const uint8_t *>(hello.c_str()), hello.length());
        } else if (active_) {
            seen_ = millis();
            if (n == 7 && p[0] == 0x72)
                close();
            else if (n == 7 && p[0] == 0x73) {
            } // Lease heartbeat; never alters a transaction.
            else
                packet(p, n);
        }
    }
    if (active_ && (failed_ || timedOut() || millis() - seen_ > 30000))
        close();
    if (active_ && responding_)
        transmit();
    if (outputAt_ < outputSize_) {
        size_t n = std::min<size_t>(Serial.availableForWrite(), outputSize_ - outputAt_);
        if (n)
            outputAt_ += Serial.write(output_ + outputAt_, n);
    }
}
} // namespace badge
