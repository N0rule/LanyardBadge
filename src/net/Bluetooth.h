#pragma once
#include "Transfer.h"
#include <NimBLEDevice.h>
#include <atomic>
namespace badge {
inline constexpr char bleService[] = "f40d1000-6f15-4d56-b6d4-17c92e648a10";
inline constexpr char bleReceive[] = "f40d1001-6f15-4d56-b6d4-17c92e648a10";
inline constexpr char bleTransmit[] = "f40d1002-6f15-4d56-b6d4-17c92e648a10";
class Bluetooth : public Transfer,
                  public NimBLEServerCallbacks,
                  public NimBLECharacteristicCallbacks {
    struct Packet {
        uint32_t generation;
        uint16_t size;
        uint8_t data[512];
    };
    SettingsStore &settings_;
    QueueHandle_t queue_ = nullptr;
    NimBLEServer *server_ = nullptr;
    NimBLECharacteristic *tx_ = nullptr;
    std::atomic<bool> connected_{false}, overflow_{false};
    std::atomic<bool> upgradeNeeded_{false}, upgradeAttempted_{false};
    std::atomic<uint32_t> generation_{0};
    uint32_t seenGeneration_ = 0;
    std::atomic<uint32_t> enrollmentUntil_{0};
    std::atomic<uint16_t> mtu_{23}, handle_{0}, initialInterval_{0};
    std::atomic<int> disconnectReason_{0}, securityStatus_{0};
    std::atomic<uint32_t> securityEvents_{0}, nativePasskey_{UINT32_MAX}, nativeStarted_{0};
    String name_;
    bool notify(uint8_t operation, uint32_t value, const uint8_t *data = nullptr,
                size_t size = 0) override;
    void onConnect(NimBLEServer *, NimBLEConnInfo &) override;
    void onDisconnect(NimBLEServer *, NimBLEConnInfo &, int) override;
    void onMTUChange(uint16_t, NimBLEConnInfo &) override;
    void onAuthenticationComplete(NimBLEConnInfo &) override;
    uint32_t onPassKeyDisplay() override;
    void onWrite(NimBLECharacteristic *, NimBLEConnInfo &) override;
    void onRead(NimBLECharacteristic *, NimBLEConnInfo &) override;

  public:
    Bluetooth(Network &api, Assets &assets, SettingsStore &settings)
        : Transfer(api, assets), settings_(settings) {}
    bool begin();
    void tick();
    void revoke();
    void refreshName();
    void openEnrollment() { enrollmentUntil_ = millis() + 120000; }
    bool enrollmentOpen() const { return int32_t(enrollmentUntil_.load() - millis()) > 0; }
    bool forgetEditors();
    bool connected() const { return connected_; }
    int disconnectReason() const { return disconnectReason_; }
    int securityStatus() const { return securityStatus_; }
    uint32_t securityEvents() const { return securityEvents_; }
    uint32_t nativePasskey() const { return nativePasskey_; }
    void cancelNativePairing();
    bool authenticatedLink() const {
        return connected_ && server_->getPeerInfoByHandle(handle_).isAuthenticated();
    }
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
