#include "Bluetooth.h"
#include <algorithm>
namespace badge {
namespace {
uint32_t get32(const uint8_t *p) {
    return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
void put32(uint8_t *p, uint32_t v) {
    for (int i = 0; i < 4; ++i)
        p[i] = v >> (8 * i);
}
} // namespace
bool Bluetooth::begin() {
    if (strlen(settings_.value.pairingKey) != 16)
        return false;
    queue_ = xQueueCreate(4, sizeof(Packet));
    if (!queue_)
        return false;
    char suffix[5];
    snprintf(suffix, sizeof(suffix), "%04X", unsigned(ESP.getEfuseMac() >> 32) & 0xffff);
    name_ = String("Badge-") + suffix;
    NimBLEDevice::init(name_.c_str());
    NimBLEDevice::setMTU(517);
    // Encrypted GATT link, with the QR secret providing application-level ownership.
    NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
    NimBLEDevice::setSecurityAuth(true, false, true);
    server_ = NimBLEDevice::createServer();
    server_->setCallbacks(this, false);
    server_->advertiseOnDisconnect(true);
    auto *service = server_->createService(bleService);
    auto *rx = service->createCharacteristic(
        bleReceive, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC, 512);
    tx_ = service->createCharacteristic(
        bleTransmit, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::NOTIFY,
        512);
    rx->setCallbacks(this);
    tx_->setCallbacks(this);
    server_->start();
    auto *advertising = NimBLEDevice::getAdvertising();
    advertising->enableScanResponse(true);
    // Put the full readable name in the primary packet. Some browser/adapter
    // combinations miss names supplied only in a scan response.
    NimBLEAdvertisementData primary, scan;
    if (!primary.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP) ||
        !primary.setName(name_.c_str()) || !scan.setCompleteServices(service->getUUID()) ||
        !advertising->setAdvertisementData(primary) || !advertising->setScanResponseData(scan))
        return false;
    return advertising->start();
}
String Bluetooth::pairingUrl() const {
    return String("https://n0rule.github.io/LanyardBadge/#badge=") + name_ +
           "&code=" + settings_.pairingCode();
}
void Bluetooth::revoke() {
    api_.revokeSession();
    if (connected_ && server_)
        server_->disconnect(handle_);
    reset();
}
void Bluetooth::onConnect(NimBLEServer *, NimBLEConnInfo &info) {
    handle_ = info.getConnHandle();
    mtu_ = info.getMTU();
    initialInterval_ = info.getConnInterval();
    connected_ = true;
    ++generation_;
    // Let the central establish security when it accesses encrypted GATT.
    // Starting SMP here races BlueZ's connection/service discovery on reconnect.
}
void Bluetooth::onDisconnect(NimBLEServer *, NimBLEConnInfo &, int reason) {
    disconnectReason_ = reason;
    connected_ = false;
    ++generation_;
}
float Bluetooth::intervalMs() const {
    return connected_ ? server_->getPeerInfoByHandle(handle_).getConnInterval() * 1.25f : 0;
}
void Bluetooth::onAuthenticationComplete(NimBLEConnInfo &info) {
    if (!info.isEncrypted()) {
        server_->disconnect(info.getConnHandle());
        return;
    }
    // USB powered, no Wi-Fi coexistence: request 7.5–15 ms events for artwork.
    // The central can reject this request; transfer framing remains unchanged.
    server_->updateConnParams(info.getConnHandle(), 6, 12, 0, 400);
}
void Bluetooth::onMTUChange(uint16_t mtu, NimBLEConnInfo &) {
    mtu_ = mtu;
}
void Bluetooth::onRead(NimBLECharacteristic *c, NimBLEConnInfo &info) {
    uint8_t hello[3] = {2, uint8_t(info.getMTU()), uint8_t(info.getMTU() >> 8)};
    c->setValue(hello, sizeof(hello));
}
void Bluetooth::onWrite(NimBLECharacteristic *c, NimBLEConnInfo &) {
    const auto value = c->getValue();
    if (value.size() < 7 || value.size() > 512) {
        overflow_ = true;
        return;
    }
    Packet p{};
    p.generation = generation_;
    p.size = value.size();
    memcpy(p.data, value.data(), p.size);
    if (xQueueSend(queue_, &p, 0) != pdTRUE)
        overflow_ = true;
}
void Bluetooth::reset() {
    if (uploading_)
        assets_.abortUpload();
    if (api_.progress)
        api_.progress(-1);
    receiving_ = uploading_ = responding_ = responseHeader_ = authenticated_ = false;
    request_ = response_ = token_ = "";
    responseFile_.close();
    header_ = "";
    waitingAck_ = false;
    lastActivity_ = millis();
}
bool Bluetooth::notify(uint8_t op, uint32_t value, const uint8_t *data, size_t n) {
    uint8_t frame[512];
    frame[0] = op;
    frame[1] = sequence_;
    frame[2] = sequence_ >> 8;
    put32(frame + 3, value);
    if (n)
        memcpy(frame + 7, data, n);
    return tx_->notify(frame, n + 7, handle_);
}
void Bluetooth::answer(int code, const String &body) {
    receiving_ = false;
    responseCode_ = code;
    response_ = body;
    responding_ = true;
    responseHeader_ = false;
    sent_ = 0;
    waitingAck_ = false;
    request_ = "";
}
void Bluetooth::fail(int code, const char *message) {
    if (uploading_)
        assets_.abortUpload();
    uploading_ = false;
    if (api_.progress)
        api_.progress(-1);
    JsonDocument d;
    d["error"] = message;
    String out;
    serializeJson(d, out);
    answer(code, out);
}
void Bluetooth::packet(const uint8_t *p, size_t n) {
    uint16_t seq = uint16_t(p[1]) | uint16_t(p[2]) << 8;
    uint32_t offset = get32(p + 3);
    uint8_t op = p[0];
    lastActivity_ = millis();
    if (op == 6 && n == 7 && offset == 0) {
        // A new browser page can inherit the same physical BLE connection.
        // Abandon old transfers before authenticating a new editor session.
        reset();
        api_.revokeSession();
        sequence_ = seq;
        if (!notify(0, 0))
            overflow_ = true;
        return;
    }
    if (op == 5) {
        if (responding_ && seq == sequence_ && offset == sent_)
            waitingAck_ = false;
        // Late acknowledgements from an abandoned page are harmless.
        return;
    }
    // Request headers are fragmented as well: works at ATT MTU 23 (13 payload bytes).
    if (op == 4) {
        if (receiving_ || responding_ || offset != header_.length() ||
            header_.length() + n - 7 > 512 || n == 7) {
            fail(409, "Invalid request header fragments");
            header_ = "";
            return;
        }
        if (!header_.length())
            sequence_ = seq;
        if (seq != sequence_ || !header_.concat(reinterpret_cast<const char *>(p + 7), n - 7)) {
            fail(507, "Invalid header or insufficient memory");
            header_ = "";
            return;
        }
        receiving_ = false;
        if (!notify(0, header_.length()))
            overflow_ = true;
        return;
    }
    if (op == 1) {
        if (receiving_ || responding_) {
            overflow_ = true;
            return;
        }
        sequence_ = seq;
        JsonDocument d;
        auto err =
            header_.length() ? deserializeJson(d, header_) : deserializeJson(d, p + 7, n - 7);
        header_ = "";
        if (err || !d["length"].is<uint32_t>()) {
            fail(400, "Invalid transfer header");
            return;
        }
        method_ = d["method"] | "";
        path_ = d["path"] | "";
        token_ = d["token"] | "";
        length_ = d["length"];
        bool pairing = path_ == "/api/pair" && method_ == "POST";
        if (!pairing && (!authenticated_ || !api_.validToken(token_))) {
            fail(401, "Scan your badge QR to pair again");
            return;
        }
        uploading_ = path_ == "/api/assets" && method_ == "POST";
        if ((pairing && length_ > 256) || (!uploading_ && length_ > 24576) ||
            (uploading_ && length_ != bitmapBytes)) {
            uploading_ = false;
            fail(413, "Transfer length is invalid");
            return;
        }
        if (uploading_) {
            String error;
            if (!assets_.beginUpload(error)) {
                uploading_ = false;
                fail(507, error.c_str());
                return;
            }
            if (api_.progress)
                api_.progress(0);
        }
        received_ = 0;
        request_ = "";
        receiving_ = true;
        if (!notify(0, 0))
            overflow_ = true;
        return;
    }
    if (!receiving_ || seq != sequence_ || offset != received_) {
        fail(409, "Transfer order mismatch");
        return;
    }
    if (op == 2) {
        if (n == 7 || received_ + n - 7 > length_) {
            fail(413, "Too many transfer bytes");
            return;
        }
        if (uploading_) {
            if (!assets_.append(p + 7, n - 7)) {
                fail(422, "Invalid image or storage full");
                return;
            }
        } else if (!request_.concat(reinterpret_cast<const char *>(p + 7), n - 7)) {
            fail(507, "Not enough memory");
            return;
        }
        received_ += n - 7;
        if (uploading_ && api_.progress)
            api_.progress(received_ * 100U / length_);
        if (!notify(0, received_))
            overflow_ = true;
    } else if (op == 3) {
        if (received_ != length_) {
            fail(422, "Transfer incomplete");
            return;
        }
        if (uploading_) {
            String id, error;
            bool ok = assets_.finishUpload(id, error);
            uploading_ = false;
            if (api_.progress)
                api_.progress(-1);
            if (!ok) {
                fail(422, error.c_str());
                return;
            }
            answer(201, String("{\"id\":\"") + id + "\"}");
        } else if (method_ == "GET" && path_.startsWith("/api/image?id=")) {
            String id = path_.substring(14);
            if (!assets_.bitmapExists(id.c_str())) {
                fail(404, "Image not found");
                return;
            }
            responseFile_ = LittleFS.open(assets_.imagePath(id.c_str()), "r");
            if (!responseFile_) {
                fail(404, "Image unavailable");
                return;
            }
            answer(200, "");
        } else {
            String out;
            int code = api_.localRequest(method_, path_, request_, token_, out);
            if (path_ == "/api/pair")
                authenticated_ = code == 200;
            answer(code, out);
        }
    } else
        fail(400, "Unknown transfer operation");
}
void Bluetooth::transmit() {
    uint32_t total = responseFile_ ? responseFile_.size() : response_.length();
    if (!responseHeader_) {
        uint8_t code[2] = {uint8_t(responseCode_), uint8_t(responseCode_ >> 8)};
        if (notify(1, total, code, sizeof(code)))
            responseHeader_ = true;
        return;
    }
    if (waitingAck_)
        return;
    if (sent_ < total) {
        uint8_t chunk[500];
        size_t count =
            std::min<size_t>(std::min<size_t>(mtu_ > 10 ? mtu_ - 10 : 13, 500), total - sent_);
        if (responseFile_) {
            responseFile_.seek(sent_);
            if (responseFile_.read(chunk, count) != count) {
                overflow_ = true;
                return;
            }
        } else
            memcpy(chunk, response_.c_str() + sent_, count);
        if (notify(2, sent_, chunk, count)) {
            sent_ += count;
            waitingAck_ = true;
            lastActivity_ = millis();
        }
    } else if (notify(3, total)) {
        response_ = "";
        responseFile_.close();
        responding_ = false;
    }
}
void Bluetooth::tick() {
    if (!queue_)
        return;
    uint32_t gen = generation_;
    if (gen != seenGeneration_) {
        reset();
        seenGeneration_ = gen;
        if (connected_)
            api_.revokeSession();
    }
    if (overflow_.exchange(false)) {
        server_->disconnect(handle_);
        reset();
        return;
    }
    if (!connected_) {
        // Recover advertising after controller/host resets as well as ordinary
        // disconnects. Bounded retries avoid a hot loop on initialization errors.
        static uint32_t checked = 0;
        if (millis() - checked >= 2000) {
            checked = millis();
            if (!advertising() && !NimBLEDevice::getAdvertising()->start())
                Serial.println("BLE: advertising retry failed");
        }
        return;
    }
    Packet p;
    if (xQueueReceive(queue_, &p, 0) == pdTRUE && p.generation == gen)
        packet(p.data, p.size);
    if (responding_)
        transmit();
    if ((receiving_ || responding_ || header_.length()) && millis() - lastActivity_ > 15000) {
        server_->disconnect(handle_);
        reset();
    }
}
} // namespace badge
