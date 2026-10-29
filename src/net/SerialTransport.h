#pragma once
#include "../core/SerialFrame.h"
#include "Transfer.h"
namespace badge {
class SerialTransport : public Transfer {
    SerialFrame parser_;
    uint8_t output_[SerialFrame::maxRaw * 2 + 2]{};
    size_t outputSize_ = 0, outputAt_ = 0;
    bool active_ = false;
    uint32_t seen_ = 0;
    bool notify(uint8_t, uint32_t, const uint8_t * = nullptr, size_t = 0) override;
    void close();

  public:
    SerialTransport(Network &api, Assets &assets) : Transfer(api, assets) {
        packetBytes = 512;
        trusted = true; // Physical USB access plus browser permission is the local boundary.
    }
    void tick();
};
} // namespace badge
