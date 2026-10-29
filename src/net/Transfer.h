#pragma once
#include "Network.h"
namespace badge {
// Runs only on the Arduino loop. Both adapters share validation and transactions.
class Transfer {
  protected:
    Network &api_;
    Assets &assets_;
    uint32_t lastActivity_ = 0, received_ = 0, length_ = 0, sent_ = 0;
    uint16_t sequence_ = 0;
    bool receiving_ = false, uploading_ = false, responding_ = false, responseHeader_ = false;
    bool authenticated_ = false, waitingAck_ = false, failed_ = false;
    String header_, request_, method_, path_, token_, response_;
    int responseCode_ = 200;
    File responseFile_;
    uint32_t fileOffset_ = 0, fileLength_ = 0;
    uint16_t packetBytes = 20;
    bool trusted = false;
    virtual bool notify(uint8_t, uint32_t, const uint8_t * = nullptr, size_t = 0) = 0;
    virtual int pairSession(const String &, String &out) {
        return trusted ? api_.trustedSession(out) : 403;
    }
    virtual void sessionStarted() {}
    void reset();
    void packet(const uint8_t *, size_t);
    void answer(int, const String &);
    void fail(int, const char *);
    void transmit();
    bool timedOut() const {
        return (receiving_ || responding_ || header_.length()) && millis() - lastActivity_ > 15000;
    }

  public:
    Transfer(Network &api, Assets &assets) : api_(api), assets_(assets) {}
};
} // namespace badge
