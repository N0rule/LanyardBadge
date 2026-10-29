#pragma once
#include "../core/Core.h"
#include "../core/DeviceName.h"
#include <Arduino.h>
#include <Preferences.h>
namespace badge {
struct SettingsV2 {
    uint32_t version = 2;
    uint32_t interval = 15;
    uint8_t brightness = 65, rotation = 0;
    bool autoplay = false;
    char selected[9]{"00000001"};
    char defaultCard[9]{"00000001"};
    char ssid[33]{}, wifiPassword[65]{};
    char apName[33]{"LanyardBadge-Setup"};
    char apPassword[17]{};
    Calibration calibration{};
    uint32_t crc = 0;
};
struct SettingsV3 : SettingsV2 {
    uint32_t screenTimeout = 120;
    bool provisioned = false;
    char pairingKey[17]{};
};
struct SettingsV4 : SettingsV3 {
    uint32_t darkMode = 1;
};
struct Settings {
    uint32_t version = 5, interval = 15, screenTimeout = 120, darkMode = 1;
    uint8_t brightness = 65, rotation = 0;
    bool autoplay = false, provisioned = false;
    char selected[9]{"00000001"}, defaultCard[9]{"00000001"};
    Calibration calibration{};
    uint32_t crc = 0;
};
class SettingsStore {
    Preferences prefs_;

  public:
    Settings value;
    char cacheEpoch[17]{};
    String deviceName = "LanyardBadge";
    bool rename(const String &name);
    bool begin();
    bool save();
};
} // namespace badge
