#include "Network.h"
#include <esp_arduino_version.h>
#include <esp_heap_caps.h>
#include <esp_random.h>
#include <lvgl.h>
namespace badge {
namespace {
bool equalSecret(const String &a, const char *b) {
    size_t n = strlen(b);
    uint8_t diff = a.length() != n;
    for (size_t i = 0; i < n; ++i)
        diff |= uint8_t((i < a.length() ? a[i] : 0) ^ b[i]);
    return diff == 0;
}
} // namespace
void Network::json(int code, JsonDocument &doc) {
    localBody_ = "";
    serializeJson(doc, localBody_);
    localCode_ = code;
}
void Network::error(int code, const String &text) {
    JsonDocument doc;
    doc["error"] = text;
    json(code, doc);
}
bool Network::validToken(const String &token) const {
    return token_[0] && millis() - tokenUsed_ < 1200000 && equalSecret(token, token_);
}
void Network::revokeSession() {
    token_[0] = 0;
}
bool Network::authorize(bool sendError) {
    bool ok = validToken(localToken_);
    if (ok)
        tokenUsed_ = millis();
    else if (sendError)
        error(401, "Scan the badge to pair again");
    return ok;
}
int Network::localRequest(const String &method, const String &path, const String &body,
                          const String &token, String &response) {

    localToken_ = token;
    body_ = body;
    localBody_ = "{\"error\":\"Unknown request\"}";
    localCode_ = 404;
    if (method == "GET") {
        if (authorize()) {
            if (path == "/api/status")
                status();
            else if (path == "/api/cards") {
                JsonDocument d;
                deckToJson(assets_.deck, d);
                json(200, d);
            }
        }
    } else if (method == "POST")
        dispatch(path);
    response = std::move(localBody_);
    body_ = "";
    localToken_ = "";

    return localCode_;
}
void Network::pair() {
    if (failures_ >= 5 && millis() - blockedAt_ < 30000) {
        error(429, "Wait 30 seconds before pairing again");
        return;
    }
    JsonDocument d;
    if (deserializeJson(d, body_) || !d["password"].is<const char *>()) {
        error(400, "Enter the badge pairing password");
        return;
    }
    if (!equalSecret(d["password"].as<String>(), settings_.value.pairingKey)) {
        ++failures_;
        blockedAt_ = millis();
        error(401, "Password does not match the badge");
        return;
    }
    failures_ = 0;
    for (unsigned i = 0; i < 32; ++i)
        snprintf(token_ + i * 2, 3, "%02x", unsigned(esp_random() & 255));
    tokenUsed_ = millis();
    opened_ = millis();
    JsonDocument out;
    out["token"] = token_;
    json(200, out);
    if (paired)
        paired();
}
void Network::cards() {
    JsonDocument d;
    String err;
    if (deserializeJson(d, body_, DeserializationOption::NestingLimit(8)) ||
        !deckFromJson(d.as<JsonVariantConst>(), assets_.staging, err)) {
        error(422, err.length() ? err : "Invalid card data");
        return;
    }
    if (assets_.staging.revision != assets_.deck.revision) {
        error(409, "Cards changed on the badge. Reload before saving.");
        return;
    }
    if (!assets_.commit(err)) {
        error(507, err);
        return;
    }
    if (cardsChanged)
        cardsChanged();
    JsonDocument out;
    deckToJson(assets_.deck, out);
    json(200, out);
}
void Network::settings() {
    JsonDocument d;
    if (deserializeJson(d, body_)) {
        error(400, "Invalid settings");
        return;
    }
    if (!d["brightness"].is<int>() || d["brightness"].as<int>() < 5 ||
        d["brightness"].as<int>() > 100 || !d["interval"].is<int>() ||
        d["interval"].as<int>() < 5 || d["interval"].as<int>() > 3600 ||
        !d["autoplay"].is<bool>() || !d["rotation"].is<int>() ||
        (d["rotation"] != 0 && d["rotation"] != 2)) {
        error(422, "Brightness 5-100, interval 5-3600 seconds, portrait rotation 0 or 2 required");
        return;
    }
    String def = d["defaultCard"] | "";
    bool found = assets_.deck.count == 0;
    for (unsigned i = 0; i < assets_.deck.count; ++i)
        if (def == assets_.deck.cards[i].id)
            found = true;
    if (!found) {
        error(422, "Select an existing default card");
        return;
    }
    if (d["screenTimeout"].is<uint32_t>() && !validScreenTimeout(d["screenTimeout"])) {
        error(422, "Invalid screen timeout");
        return;
    }
    if (!d["screenTimeout"].isNull() && !d["screenTimeout"].is<uint32_t>()) {
        error(422, "Invalid screen timeout");
        return;
    }
    auto before = settings_.value;
    settings_.value.screenTimeout = d["screenTimeout"] | before.screenTimeout;
    settings_.value.brightness = d["brightness"];
    settings_.value.interval = d["interval"];
    settings_.value.autoplay = d["autoplay"];
    settings_.value.rotation = d["rotation"];
    strlcpy(settings_.value.defaultCard, def.c_str(), 9);
    if (!settings_.save()) {
        settings_.value = before;
        error(500, "Could not persist settings");
        return;
    }
    if (settingsChanged)
        settingsChanged();
    status();
}
void Network::dispatch(const String &path) {
    if (path == "/api/pair")
        pair();
    else if (!authorize())
        return;
    else if (path == "/api/cards")
        cards();
    else if (path == "/api/settings")
        settings();
    else if (path == "/api/select") {
        JsonDocument d;
        if (deserializeJson(d, body_)) {
            error(400, "Invalid selection");
            return;
        }
        String id = d["id"] | "";
        bool found = false;
        for (unsigned i = 0; i < assets_.deck.count; ++i)
            if (id == assets_.deck.cards[i].id) {
                if (select)
                    select(i);
                found = true;
                break;
            }
        if (found)
            status();
        else
            error(404, "Card not found");
    } else if (path == "/api/display") {
        if (showBadge)
            showBadge();
        JsonDocument out;
        out["ok"] = true;
        json(200, out);
    } else if (path == "/api/calibrate") {
        if (calibrateTouch)
            calibrateTouch();
        JsonDocument out;
        out["ok"] = true;
        json(200, out);
    } else if (path == "/api/gc") {
        JsonDocument out;
        out["removed"] = assets_.collectGarbage();
        json(200, out);
    } else if (path == "/api/close") {
        JsonDocument out;
        out["ok"] = true;
        json(200, out);
        if (requestClose)
            requestClose();
    }
    body_ = ""; // Keep capacity bounded; release request content containing passwords.
}
JsonDocument Network::statusDocument() const {
    JsonDocument d;
    d["firmware"] = "2.3.0";
    d["arduino"] = ESP_ARDUINO_VERSION_STR;
    d["heap"] = ESP.getFreeHeap();
    d["minHeap"] = ESP.getMinFreeHeap();
    d["largestBlock"] = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    lv_mem_monitor_t graphics{};
    lv_mem_monitor(&graphics);
    d["graphicsUsed"] = LV_MEM_SIZE - graphics.free_size;
    d["graphicsMaxUsed"] = graphics.max_used;
    d["psram"] = ESP.getPsramSize();
    d["flash"] = ESP.getFlashChipSize();
    d["uptime"] = millis() / 1000;
    d["storageReady"] = assets_.ready();
    d["storageUsed"] = assets_.used();
    d["storageTotal"] = assets_.total();
    d["revision"] = assets_.deck.revision;
    d["cards"] = assets_.deck.count;
    unsigned current = selected ? selected() : 0;
    if (current >= assets_.deck.count)
        current = 0;
    d["selected"] = current;
    d["activeCard"] = assets_.deck.count ? assets_.deck.cards[current].id : "";
    d["loopStackFree"] = uxTaskGetStackHighWaterMark(nullptr);
    d["brightness"] = settings_.value.brightness;
    d["autoplay"] = settings_.value.autoplay;
    d["interval"] = settings_.value.interval;
    d["rotation"] = settings_.value.rotation;
    d["defaultCard"] = settings_.value.defaultCard;
    d["calibrated"] = settings_.value.calibration.valid;
    d["screenTimeout"] = settings_.value.screenTimeout;
    d["provisioned"] = settings_.value.provisioned;
    if (deviceStatus)
        deviceStatus(d);
    return d;
}

void Network::status() {
    auto d = statusDocument();
    json(200, d);
}
String Network::summary() const {
    return String("LanyardBadge 2.3.0\n240 x 320 / USB power\nFree heap: ") + ESP.getFreeHeap() +
           "\nStorage: " + assets_.used() / 1024 + " / " + assets_.total() / 1024 +
           " KiB\nCards: " + assets_.deck.count;
}
} // namespace badge
