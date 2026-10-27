#pragma once
#include "../core/Core.h"
#include <Arduino.h>
#include <Preferences.h>
namespace badge {
struct Settings {
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
class SettingsStore {
    Preferences prefs_;

  public:
    Settings value;
    bool begin();
    bool save();
};
} // namespace badge
