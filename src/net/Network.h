#pragma once
#include "../storage/Assets.h"
#include "../storage/Settings.h"
#include <functional>
namespace badge {
// Transport-neutral device API; all storage/UI mutations run on the Arduino loop.
class Network {
    SettingsStore &settings_;
    Assets &assets_;
    uint32_t tokenUsed_ = 0, blockedAt_ = 0, opened_ = 0;
    unsigned failures_ = 0;
    char token_[65]{};
    String body_, localToken_, localBody_;
    int localCode_ = 500;
    bool pendingCardUpload_ = false;
    uint32_t cardUploadAt_ = 0;
    bool authorize(bool sendError = true);
    void json(int, JsonDocument &);
    void error(int, const String &);
    void dispatch(const String &);
    void pair();
    void settings();
    void cards();
    void status();

  public:
    std::function<void()> cardsChanged, settingsChanged, calibrateTouch, paired, showBadge;
    std::function<unsigned()> selected;
    std::function<void(unsigned)> select;
    std::function<void(UploadPhase, int)> progress;
    std::function<void(JsonDocument &)> deviceStatus;
    std::function<bool()> pairingCodeAllowed;
    Network(SettingsStore &s, Assets &a) : settings_(s), assets_(a) {}
    bool validToken(const String &) const;
    bool touchSession(const String &token) {
        if (!validToken(token))
            return false;
        tokenUsed_ = millis();
        return true;
    }
    void revokeSession();
    bool pendingCardUpload() const {
        return pendingCardUpload_ && millis() - cardUploadAt_ < 45000;
    }
    void cardAssetReady() {
        pendingCardUpload_ = true;
        cardUploadAt_ = millis();
        if (progress)
            progress(UploadPhase::Saving, 100);
    }
    void cancelCardUpload(bool failed = false) {
        pendingCardUpload_ = false;
        if (progress)
            progress(failed ? UploadPhase::Failed : UploadPhase::Idle, 0);
    }
    int localRequest(const String &, const String &, const String &, const String &, String &);
    String summary() const;
    JsonDocument statusDocument() const;
};
} // namespace badge
