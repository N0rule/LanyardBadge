#pragma once
#include "Network.h"
#include <NimBLEDevice.h>
#include <atomic>
namespace badge {
inline constexpr char bleService[] = "f40d1000-6f15-4d56-b6d4-17c92e648a10";
inline constexpr char bleReceive[] = "f40d1001-6f15-4d56-b6d4-17c92e648a10";
inline constexpr char bleTransmit[] = "f40d1002-6f15-4d56-b6d4-17c92e648a10";
class Bluetooth : public NimBLEServerCallbacks, public NimBLECharacteristicCallbacks {
    struct Packet {
        uint32_t generation;
        uint16_t size;
        uint8_t data[512];
    };
    Network &api_;
    Assets &assets_;
    SettingsStore &settings_;
    QueueHandle_t queue_ = nullptr;
    NimBLEServer *server_ = nullptr;
    NimBLECharacteristic *tx_ = nullptr;
    std::atomic<bool> connected_{false}, overflow_{false};
    std::atomic<uint32_t> generation_{0};
    uint32_t seenGeneration_ = 0, lastActivity_ = 0, received_ = 0, length_ = 0, sent_ = 0;
    uint16_t sequence_ = 0;
    std::atomic<uint16_t> mtu_{23}, handle_{0}, initialInterval_{0};
    std::atomic<int> disconnectReason_{0}, securityStatus_{0};
    std::atomic<uint32_t> securityEvents_{0};
    bool receiving_ = false, uploading_ = false, responding_ = false, responseHeader_ = false;
    bool authenticated_ = false, waitingAck_ = false;
    String header_;
    int responseCode_ = 200;
    String request_, method_, path_, token_, response_, name_;
    File responseFile_;
    uint32_t fileOffset_ = 0, fileLength_ = 0;
    void reset();
    void packet(const uint8_t *, size_t);
    bool notify(uint8_t operation, uint32_t value, const uint8_t *data = nullptr, size_t size = 0);
    void answer(int code, const String &body);
    void fail(int code, const char *message);
    void transmit();
    void onConnect(NimBLEServer *, NimBLEConnInfo &) override;
    void onDisconnect(NimBLEServer *, NimBLEConnInfo &, int) override;
    void onMTUChange(uint16_t, NimBLEConnInfo &) override;
    void onAuthenticationComplete(NimBLEConnInfo &) override;
    void onWrite(NimBLECharacteristic *, NimBLEConnInfo &) override;
    void onRead(NimBLECharacteristic *, NimBLEConnInfo &) override;

  public:
    Bluetooth(Network &api, Assets &assets, SettingsStore &settings)
        : api_(api), assets_(assets), settings_(settings) {}
    bool begin();
    void tick();
    void revoke();
    bool connected() const { return connected_; }
    int disconnectReason() const { return disconnectReason_; }
    int securityStatus() const { return securityStatus_; }
    uint32_t securityEvents() const { return securityEvents_; }
    bool encrypted() const {
        return connected_ && server_->getPeerInfoByHandle(handle_).isEncrypted();
    }
    int bonds() const { return server_ ? NimBLEDevice::getNumBonds() : 0; }
    bool advertising() const { return server_ && NimBLEDevice::getAdvertising()->isAdvertising(); }
    float initialIntervalMs() const { return initialInterval_ * 1.25f; }
    float intervalMs() const;
    String name() const { return name_; }
    String pairingUrl() const;
};
} // namespace badge
