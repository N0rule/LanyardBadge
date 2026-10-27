#pragma once
#include "../model/Model.h"
#include <Arduino.h>
#include <LittleFS.h>
namespace badge {
class Assets {
    bool ready_ = false;
    File upload_;
    uint32_t received_ = 0;
    char pending_[9]{};
    bool failed_ = false;
    bool loadFile(const char *, Deck &);
    bool imageUsed(const char *, const Deck &) const;

  public:
    Deck deck, staging;
    bool begin();
    bool provision();
    bool ready() const { return ready_; }
    bool canProvision() const {
        return !ready_ || (!deck.revision && !LittleFS.exists("/cards.json") &&
                           !LittleFS.exists("/cards.bak"));
    }
    bool commit(String &error);
    bool bitmapExists(const char *id) const;
    String imagePath(const char *id) const { return String("/img-") + id + ".bmp"; }
    bool beginUpload(String &error);
    bool append(const uint8_t *, size_t);
    bool finishUpload(String &id, String &error);
    void abortUpload();
    unsigned collectGarbage();
    uint32_t used() const { return ready_ ? LittleFS.usedBytes() : 0; }
    uint32_t total() const { return ready_ ? LittleFS.totalBytes() : 0; }
};
} // namespace badge
