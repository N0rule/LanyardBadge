#pragma once
#include "../storage/Assets.h"
#include "../storage/Settings.h"
#include <Arduino.h>
#include <WebServer.h>
#include <WiFi.h>
#include <functional>
namespace badge {
class HttpServer : public WebServer {
  public:
    using WebServer::WebServer;
    bool listening() { return static_cast<bool>(_server); }
};
class Network {
    SettingsStore &settings_;
    Assets &assets_;
    HttpServer server_{80};
    bool active_ = false, hotspot_ = false, rawOk_ = false, imageUpload_ = false;
    bool connected_ = false;
    uint32_t opened_ = 0, retryAt_ = 0, rawStarted_ = 0, tokenUsed_ = 0, blockedAt_ = 0;
    unsigned failures_ = 0;
    char token_[65]{};
    String body_, uploadedId_;
    bool local_ = false;
    String localToken_, localBody_;
    int localCode_ = 500;
    int uploadPercent_ = -1;
    bool authorize(bool sendError = true);
    void headers();
    void json(int code, JsonDocument &);
    void error(int, const String &);
    void routeBody();
    void dispatch(const String &path);
    void raw();
    void pair();
    void settings();
    void cards();
    void status();
    void reconnect();
    bool listen();
    void stopHotspot();

  public:
    std::function<void()> pump;
    std::function<void()> cardsChanged;
    std::function<void()> settingsChanged;
    std::function<void()> calibrateTouch;
    std::function<unsigned()> selected;
    std::function<void(unsigned)> select;
    std::function<void(int)> progress;
    std::function<void()> requestClose;
    std::function<void()> paired;
    std::function<void()> showBadge;
    std::function<void()> connectionChanged;
    std::function<void(JsonDocument &)> deviceStatus;
    Network(SettingsStore &s, Assets &a) : settings_(s), assets_(a) {}
    void begin();
    bool open();
    void close();
    void tick();
    bool selfTest();
    bool active() const { return active_; }
    uint32_t remaining() const {
        return hotspot_ && millis() - opened_ < 900000 ? (900000 - (millis() - opened_)) / 1000 : 0;
    }
    String editorUrl() const;
    String connectionHint() const;
    void suspend();
    bool validToken(const String &token) const;
    int localRequest(const String &method, const String &path, const String &body,
                     const String &token, String &response);
    String summary() const;
    JsonDocument statusDocument() const;
};
} // namespace badge
