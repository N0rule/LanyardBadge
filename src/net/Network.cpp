#include "Network.h"
#include "web_assets.h"
#include <esp_arduino_version.h>
#include <esp_heap_caps.h>
#include <esp_random.h>
#include <lvgl.h>
#include <uri/UriGlob.h>
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
void Network::headers() {
    server_.sendHeader("Cache-Control", "no-store");
    server_.sendHeader("X-Content-Type-Options", "nosniff");
    server_.sendHeader("Referrer-Policy", "no-referrer");
    server_.sendHeader("Content-Security-Policy",
                       "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; "
                       "script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; "
                       "frame-ancestors 'none'; base-uri 'none'");
}
void Network::json(int code, JsonDocument &doc) {
    if (local_) {
        localBody_ = "";
        serializeJson(doc, localBody_);
        localCode_ = code;
        return;
    }
    String out;
    serializeJson(doc, out);
    headers();
    server_.send(code, "application/json", out);
}
void Network::error(int code, const String &text) {
    JsonDocument doc;
    doc["error"] = text;
    json(code, doc);
}
bool Network::authorize(bool sendError) {
    bool ok = local_ ? validToken(localToken_)
                     : active_ && token_[0] && millis() - tokenUsed_ < 1200000 &&
                           equalSecret(server_.header("Authorization"),
                                       (String("Bearer ") + token_).c_str());
    if (ok) {
        tokenUsed_ = millis();
        opened_ = millis();
    } else if (sendError)
        error(401, "Pair with the password shown on your badge");
    return ok;
}
void Network::begin() {
    WiFi.persistent(false);
    WiFi.setAutoReconnect(true);
    WiFi.setHostname("lanyardbadge");
    const char *keys[] = {"Authorization", "Content-Type", "Content-Length", "Origin"};
    server_.collectHeaders(keys, 4);
    auto page = [this](const char *type, const unsigned char *data, size_t size) {
        headers();
        server_.sendHeader("Content-Encoding", "gzip");
        server_.send_P(200, type, reinterpret_cast<const char *>(data), size);
    };
    server_.on("/", HTTP_GET,
               [page] { page("text/html; charset=utf-8", index_html, sizeof(index_html)); });
    server_.on("/style.css", HTTP_GET,
               [page] { page("text/css; charset=utf-8", style_css, sizeof(style_css)); });
    server_.on("/app.js", HTTP_GET,
               [page] { page("text/javascript; charset=utf-8", app_js, sizeof(app_js)); });
    server_.on("/qrcode.js", HTTP_GET,
               [page] { page("text/javascript; charset=utf-8", qrcode_js, sizeof(qrcode_js)); });
    server_.on("/font.woff2", HTTP_GET,
               [page] { page("font/woff2", font_woff2, sizeof(font_woff2)); });
    server_.on("/api/status", HTTP_GET, [this] {
        if (authorize())
            status();
    });
    server_.on("/api/cards", HTTP_GET, [this] {
        if (authorize()) {
            JsonDocument d;
            deckToJson(assets_.deck, d);
            json(200, d);
        }
    });
    server_.on("/api/image", HTTP_GET, [this] {
        if (!authorize())
            return;
        String id = server_.arg("id");
        if (!assets_.bitmapExists(id.c_str())) {
            error(404, "Background not found");
            return;
        }
        auto f = LittleFS.open(assets_.imagePath(id.c_str()), "r");
        headers();
        server_.streamFile(f, "image/bmp");
        f.close();
    });
    const char *posts[] = {"/api/pair",      "/api/cards",   "/api/assets", "/api/select",
                           "/api/settings",  "/api/network", "/api/close",  "/api/gc",
                           "/api/calibrate", "/api/display"};
    for (auto *path : posts)
        server_.on(path, HTTP_POST, [this] { routeBody(); }, [this] { raw(); });
    server_.on(
        UriGlob("/*"), HTTP_ANY, [this] { error(404, "Page not found"); },
        [this] {
            error(404, "Page not found");
            server_.client().stop();
        });
    server_.onNotFound([this] { error(404, "Page not found"); });
    // Bluetooth is the everyday transport. Wi-Fi is an explicit fallback.
    WiFi.mode(WIFI_OFF);
}
void Network::suspend() {
    server_.stop();
    active_ = hotspot_ = false;
    assets_.abortUpload();
    WiFi.mode(WIFI_OFF);
}
bool Network::validToken(const String &token) const {
    return token_[0] && millis() - tokenUsed_ < 1200000 && equalSecret(token, token_);
}
int Network::localRequest(const String &method, const String &path, const String &body,
                          const String &token, String &response) {
    local_ = true;
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
    local_ = false;
    return localCode_;
}
bool Network::listen() {
    if (server_.listening())
        return active_ = true;
    server_.begin();
    if (!server_.listening()) {
        Serial.printf("HTTP listener failed to start: errno=%d\n", errno);
        return false;
    }
    active_ = true;
    return true;
}
bool Network::open() {
    // The normal route is the owner's LAN/hotspot; no network switch on their phone.
    if (WiFi.status() == WL_CONNECTED)
        return listen();
    WiFi.mode(settings_.value.ssid[0] ? WIFI_AP_STA : WIFI_AP);
    if (!hotspot_ && !WiFi.softAP(settings_.value.apName, settings_.value.apPassword, 6, false, 2))
        return false;
    hotspot_ = true;
    opened_ = millis();
    if (!listen()) {
        stopHotspot();
        return false;
    }
    if (settings_.value.ssid[0] && WiFi.status() != WL_CONNECTED)
        reconnect();
    Serial.println("Fallback hotspot open; touch menu shows connection details");
    return true;
}
void Network::stopHotspot() {
    if (hotspot_)
        WiFi.softAPdisconnect(false);
    hotspot_ = false;
    WiFi.mode(settings_.value.ssid[0] ? WIFI_STA : WIFI_OFF);
    if (!settings_.value.ssid[0]) {
        server_.stop();
        active_ = false;
        token_[0] = 0;
    }
}
void Network::close() {
    assets_.abortUpload();
    if (progress)
        progress(-1);
    stopHotspot();
    token_[0] = 0;
    Serial.println("Signed out; saved Wi-Fi stays available for the owner");
}
void Network::reconnect() {
    WiFi.begin(settings_.value.ssid, settings_.value.wifiPassword);
    retryAt_ = millis();
}
void Network::tick() {
    if (active_) {
        server_.handleClient();
        // Keep an in-use setup connection alive. Idle hotspots expire, LAN does not.
        if (hotspot_ && millis() - opened_ >= 900000) {
            stopHotspot();
            if (showBadge)
                showBadge();
        }
    }
    bool connected = WiFi.status() == WL_CONNECTED;
    if (connected != connected_) {
        connected_ = connected;
        if (connectionChanged)
            connectionChanged();
    }
    if (active_ && settings_.value.ssid[0] && WiFi.status() != WL_CONNECTED &&
        millis() - retryAt_ >= 30000)
        reconnect();
}
void Network::raw() {
    if (!server_.hasRaw()) {
        // Multipart isn't part of this protocol. Abort before accepting file data.
        error(415, "Send JSON or an RGB565 BMP body");
        server_.client().stop();
        return;
    }
    auto &r = server_.raw();
    if (r.status == RAW_START) {
        body_ = "";
        uploadedId_ = "";
        rawOk_ = false;
        rawStarted_ = millis();
        imageUpload_ = server_.uri() == "/api/assets";
        uploadPercent_ = -1;
        server_.client().setTimeout(250);
        server_.client().setConnectionTimeout(250);
        bool pairing = server_.uri() == "/api/pair";
        if (!pairing && !authorize()) {
            server_.client().stop();
            return;
        }
        int n = server_.clientContentLength();
        const char *type = imageUpload_ ? "image/bmp" : "application/json";
        if (!server_.header("Content-Type").startsWith(type)) {
            error(415, "Send JSON or an RGB565 BMP body");
            server_.client().stop();
            return;
        }
        if (n <= 0 || n > (imageUpload_ ? int(bitmapBytes) : 24576) ||
            (imageUpload_ && n != int(bitmapBytes))) {
            error(413, "Invalid content type or body length");
            server_.client().stop();
            return;
        }
        if (pairing && failures_ >= 5 && millis() - blockedAt_ < 30000) {
            error(429, "Wait 30 seconds before pairing again");
            server_.client().stop();
            return;
        }
        if (imageUpload_) {
            String err;
            if (!assets_.beginUpload(err)) {
                error(507, err);
                server_.client().stop();
                return;
            }
        } else if (!body_.reserve(n)) {
            error(503, "Not enough free memory; restart configuration");
            server_.client().stop();
            return;
        }
        rawOk_ = true;
        return;
    }
    if (r.status == RAW_ABORTED) {
        assets_.abortUpload();
        rawOk_ = false;
        if (progress)
            progress(-1);
        body_ = "";
        return;
    }
    if (!rawOk_)
        return;
    if (millis() - rawStarted_ > 30000) {
        rawOk_ = false;
        assets_.abortUpload();
        error(408, "Upload timed out; previous content preserved");
        server_.client().stop();
        if (progress)
            progress(-1);
        return;
    }
    if (r.status == RAW_WRITE) {
        if (imageUpload_) {
            if (!assets_.append(r.buf, r.currentSize)) {
                rawOk_ = false;
                assets_.abortUpload();
                error(507, "Upload failed; previous content preserved");
                server_.client().stop();
                if (progress)
                    progress(-1);
                return;
            }
            int pc = (r.totalSize * 100) / bitmapBytes;
            if (pc != uploadPercent_) {
                uploadPercent_ = pc;
                if (progress)
                    progress(pc);
            }
        } else if (!body_.concat(reinterpret_cast<const char *>(r.buf), r.currentSize)) {
            rawOk_ = false;
            error(503, "Request exceeds available memory");
            server_.client().stop();
            return;
        }
        if (pump)
            pump();
    }
    if (r.status == RAW_END && imageUpload_) {
        String err;
        rawOk_ = assets_.finishUpload(uploadedId_, err);
        if (progress)
            progress(-1);
        if (!rawOk_)
            error(422, err);
    }
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
    if (!equalSecret(d["password"].as<String>(), settings_.value.apPassword)) {
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
    bool found = false;
    for (unsigned i = 0; i < assets_.deck.count; ++i)
        if (def == assets_.deck.cards[i].id)
            found = true;
    if (!found) {
        error(422, "Select an existing default card");
        return;
    }
    auto before = settings_.value;
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
void Network::routeBody() {
    if (!server_.hasRaw()) {
        rawOk_ = false;
        body_ = "";
        error(415, "Send JSON or an RGB565 BMP body");
        return;
    }
    if (!rawOk_)
        return;
    rawOk_ = false; // Consume validity once; unsupported requests cannot reuse prior body state.
    dispatch(server_.uri());
}
void Network::dispatch(const String &path) {
    if (path == "/api/pair")
        pair();
    else if (!authorize())
        return;
    else if (path == "/api/assets") {
        JsonDocument out;
        out["id"] = uploadedId_;
        json(201, out);
    } else if (path == "/api/cards")
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
    } else if (path == "/api/network") {
        JsonDocument d;
        if (deserializeJson(d, body_) || !d["ssid"].is<const char *>() ||
            !d["password"].is<const char *>()) {
            error(400, "Enter a network name and password");
            return;
        }
        String ssid = d["ssid"].as<String>(), pw = d["password"].as<String>();
        if (ssid.length() > 32 || pw.length() > 63 || (!pw.isEmpty() && pw.length() < 8)) {
            error(422, "SSID must fit 32 bytes; WPA password must be 8-63 characters or empty");
            return;
        }
        auto before = settings_.value;
        strlcpy(settings_.value.ssid, ssid.c_str(), 33);
        strlcpy(settings_.value.wifiPassword, pw.c_str(), 65);
        if (!settings_.save()) {
            settings_.value = before;
            error(500, "Could not persist network");
            return;
        }
        if (!local_) {
            WiFi.disconnect(false, false);
            if (ssid.length()) {
                WiFi.mode(hotspot_ ? WIFI_AP_STA : WIFI_STA);
                reconnect();
            } else {
                // Keep a recovery route when the owner forgets the saved network.
                open();
            }
        }
        status();
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
    d["firmware"] = "2.2.0";
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
    d["activeCard"] = assets_.deck.cards[current].id;
    d["loopStackFree"] = uxTaskGetStackHighWaterMark(nullptr);
    d["brightness"] = settings_.value.brightness;
    d["autoplay"] = settings_.value.autoplay;
    d["interval"] = settings_.value.interval;
    d["rotation"] = settings_.value.rotation;
    d["defaultCard"] = settings_.value.defaultCard;
    d["calibrated"] = settings_.value.calibration.valid;
    d["stationConnected"] = WiFi.status() == WL_CONNECTED;
    d["stationSsid"] = settings_.value.ssid;
    d["stationIp"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("");
    d["apIp"] = hotspot_ ? WiFi.softAPIP().toString() : String("");
    d["httpListening"] = const_cast<HttpServer &>(server_).listening();
    d["setupActive"] = hotspot_;
    d["setupSeconds"] = remaining();
    d["apName"] = settings_.value.apName;
    d["editorUrl"] = editorUrl();
    d["networkState"] = WiFi.status() == WL_CONNECTED ? "connected"
                        : settings_.value.ssid[0]     ? "connecting"
                                                      : "not configured";
    if (deviceStatus)
        deviceStatus(d);
    return d;
}
String Network::editorUrl() const {
    if (WiFi.status() == WL_CONNECTED)
        return String("http://") + WiFi.localIP().toString();
    return hotspot_ ? String("http://192.168.4.1") : String("");
}
String Network::connectionHint() const {
    if (WiFi.status() == WL_CONNECTED)
        return String("Use your Wi-Fi / hotspot:\n") + settings_.value.ssid;
    return String("Join Wi-Fi for first setup:\n") + settings_.value.apName;
}
void Network::status() {
    auto d = statusDocument();
    json(200, d);
}
String Network::summary() const {
    char text[512];
    snprintf(
        text, sizeof(text),
        "LanyardBadge 2.0\n240 x 320 / %u MHz\nFlash: %u KiB\nPSRAM: %u\nFree heap: %u\nLowest "
        "heap: %u\nStorage: %u / %u KiB\nCards: %u / 10\nTouch: %s\nWi-Fi: %s\nSetup: %s\n%s",
        unsigned(ESP.getCpuFreqMHz()), unsigned(ESP.getFlashChipSize() / 1024),
        unsigned(ESP.getPsramSize()), unsigned(ESP.getFreeHeap()), unsigned(ESP.getMinFreeHeap()),
        unsigned(assets_.used() / 1024), unsigned(assets_.total() / 1024), assets_.deck.count,
        settings_.value.calibration.valid ? "calibrated" : "needs calibration",
        WiFi.status() == WL_CONNECTED ? "connected" : "offline", active_ ? "open" : "closed",
        WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str()
                                      : "USB power / no SD needed");
    return String(text);
}
} // namespace badge
