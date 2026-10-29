#include "Bluetooth.h"
#include "../core/Console.h"
#include <algorithm>
namespace badge {
static_assert(MYNEWT_VAL(BLE_SM_SC_ONLY) == 1, "BLE must require Secure Connections");
namespace {
void put32(uint8_t *p, uint32_t v) {
    for (int i = 0; i < 4; ++i)
        p[i] = v >> (8 * i);
}
} // namespace
bool Bluetooth::begin() {
    trusted = true;
    queue_ = xQueueCreate(4, sizeof(Packet));
    if (!queue_)
        return false;
    char suffix[5];
    snprintf(suffix, sizeof(suffix), "%04X", unsigned(ESP.getEfuseMac() >> 32) & 0xffff);
    name_ =
        settings_.deviceName == "LanyardBadge" ? String("Badge-") + suffix : settings_.deviceName;
    NimBLEDevice::init(name_.c_str());
    NimBLEDevice::setMTU(517);
    // Authenticated LE Secure Connections; physical passkey entry establishes the link.
    // Native authenticated bonds authorize editors; new enrollment requires the badge-displayed
    // native PIN.
    NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY);
    NimBLEDevice::setSecurityAuth(true, true, true);
    // Keep the host's actual security failure code after disconnection. The
    // server authentication callback exposes encryption state but not status.
    // This passive listener must never change GAP handling or expose key data.
    if (!NimBLEDevice::setCustomGapHandler(
            [](ble_gap_event *event, void *arg) -> int {
                auto *self = static_cast<Bluetooth *>(arg);
                if (event->type == BLE_GAP_EVENT_ENC_CHANGE) {
                    self->securityStatus_ = event->enc_change.status;
                    ++self->securityEvents_;
                }
                return 0;
            },
            this))
        return false;
    server_ = NimBLEDevice::createServer();
    server_->setCallbacks(this, false);
    server_->advertiseOnDisconnect(true);
    auto *service = server_->createService(bleService);
    auto *rx = service->createCharacteristic(
        bleReceive,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC | NIMBLE_PROPERTY::WRITE_AUTHEN, 512);
    tx_ = service->createCharacteristic(bleTransmit,
                                        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::READ_ENC |
                                            NIMBLE_PROPERTY::READ_AUTHEN | NIMBLE_PROPERTY::NOTIFY,
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
void Bluetooth::refreshName() {
    if (!server_)
        return;
    char suffix[5];
    snprintf(suffix, sizeof(suffix), "%04X", unsigned(ESP.getEfuseMac() >> 32) & 0xffff);
    String next =
        settings_.deviceName == "LanyardBadge" ? String("Badge-") + suffix : settings_.deviceName;
    if (next == name_)
        return;
    name_ = next;
    NimBLEDevice::setDeviceName(name_.c_str());
    auto *adv = NimBLEDevice::getAdvertising();
    adv->stop();
    NimBLEAdvertisementData primary, scan;
    primary.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
    primary.setName(name_.c_str());
    scan.setCompleteServices(NimBLEUUID(bleService));
    adv->setAdvertisementData(primary);
    adv->setScanResponseData(scan);
    if (!connected_)
        adv->start();
}
String Bluetooth::pairingUrl() const {
    return "https://n0rule.is-a.dev/LanyardBadge/";
}
bool Bluetooth::forgetEditors() {
    revoke();
    bool removed = NimBLEDevice::deleteAllBonds();
    return removed;
}
void Bluetooth::revoke() {
    api_.revokeSession();
    if (connected_ && server_)
        server_->disconnect(handle_);
    reset();
}
void Bluetooth::onConnect(NimBLEServer *, NimBLEConnInfo &info) {
    // PC-initiated connections are allowed at any time. Protected GATT still
    // requires authenticated Secure Connections and the badge-displayed PIN.
    handle_ = info.getConnHandle();
    mtu_ = info.getMTU();
    initialInterval_ = info.getConnInterval();
    nativePasskey_ = UINT32_MAX;
    upgradeNeeded_ = upgradeAttempted_ = false;
    connected_ = true;
    ++generation_;
    // Let the central establish security when it accesses encrypted GATT.
    // Starting SMP here races BlueZ's connection/service discovery on reconnect.
}
void Bluetooth::onDisconnect(NimBLEServer *, NimBLEConnInfo &, int reason) {
    disconnectReason_ = reason;
    nativePasskey_ = UINT32_MAX;
    connected_ = false;
    ++generation_;
}
float Bluetooth::intervalMs() const {
    return connected_ ? server_->getPeerInfoByHandle(handle_).getConnInterval() * 1.25f : 0;
}
void Bluetooth::onAuthenticationComplete(NimBLEConnInfo &info) {
    nativePasskey_ = UINT32_MAX;
    if (!info.isEncrypted()) {
        server_->disconnect(info.getConnHandle());
        return;
    }
    if (!info.isAuthenticated() || info.getSecKeySize() != 16) {
        // An old Just Works bond may encrypt successfully but cannot access the
        // authenticated characteristics. Request a standard security upgrade
        // once, outside this callback; never serve application data at that level.
        if (upgradeAttempted_)
            server_->disconnect(info.getConnHandle());
        else
            upgradeNeeded_ = true;
        return;
    }
    // USB powered, no Wi-Fi coexistence: request 7.5–15 ms events for artwork.
    // The central can reject this request; transfer framing remains unchanged.
    server_->updateConnParams(info.getConnHandle(), 6, 12, 0, 400);
}
uint32_t Bluetooth::onPassKeyDisplay() {
    // Rejection sampling avoids bias; Bluetooth is active, enabling the ESP32's
    // hardware entropy source. Never persist or print this temporary passkey.
    uint32_t value;
    constexpr uint32_t limit = UINT32_MAX - (UINT32_MAX % 1000000U);
    do {
        value = esp_random();
    } while (value >= limit);
    const uint32_t passkey = value % 1000000U;
    nativeStarted_ = millis();
    nativePasskey_ = passkey;
    return passkey;
}
void Bluetooth::cancelNativePairing() {
    nativePasskey_ = UINT32_MAX;
    if (connected_ && server_)
        server_->disconnect(handle_);
}
void Bluetooth::onMTUChange(uint16_t mtu, NimBLEConnInfo &) {
    mtu_ = mtu;
}
void Bluetooth::onRead(NimBLECharacteristic *c, NimBLEConnInfo &info) {
    uint8_t hello[3] = {3, uint8_t(info.getMTU()), uint8_t(info.getMTU() >> 8)};
    c->setValue(hello, sizeof(hello));
}
void Bluetooth::onWrite(NimBLECharacteristic *c, NimBLEConnInfo &info) {
    if (!connected_ || info.getConnHandle() != handle_ || !info.isEncrypted() ||
        !info.isAuthenticated() || info.getSecKeySize() != 16)
        return;
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
void Bluetooth::tick() {
    if (!queue_)
        return;
    if (nativePasskey_ < 1000000U && millis() - nativeStarted_ > 60000U)
        cancelNativePairing();
    if (connected_ && upgradeNeeded_.exchange(false)) {
        upgradeAttempted_ = true;
        if (!NimBLEDevice::startSecurity(handle_))
            server_->disconnect(handle_);
    }
    uint32_t gen = generation_;
    if (gen != seenGeneration_) {
        reset();
        seenGeneration_ = gen;
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
                Console::println("BLE: advertising retry failed");
        }
        return;
    }
    Packet p;
    if (xQueueReceive(queue_, &p, 0) == pdTRUE && p.generation == gen)
        packet(p.data, p.size);
    packetBytes = std::min<uint16_t>(512, mtu_ - 3);
    if (responding_)
        transmit();
    if (failed_) {
        failed_ = false;
        server_->disconnect(handle_);
        reset();
    }
    if ((receiving_ || responding_ || header_.length()) && millis() - lastActivity_ > 15000) {
        server_->disconnect(handle_);
        reset();
    }
}
} // namespace badge
