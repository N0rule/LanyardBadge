#include "Settings.h"
#include <bootloader_random.h>
#include <esp_random.h>
#include <stddef.h>
namespace badge {
bool SettingsStore::begin() {
    if (!prefs_.begin("badge-v2", false))
        return false;
    if (prefs_.getBytesLength("settings") == sizeof(Settings)) {
        Settings saved;
        prefs_.getBytes("settings", &saved, sizeof(saved));
        if (saved.version == 2 && saved.crc == checksum(&saved, offsetof(Settings, crc)) &&
            saved.brightness >= 5 && saved.brightness <= 100 &&
            (saved.rotation == 0 || saved.rotation == 2) && saved.interval >= 5 &&
            saved.interval <= 3600 && saved.ssid[32] == 0 && saved.wifiPassword[64] == 0 &&
            saved.apName[32] == 0 && saved.apPassword[16] == 0 && strlen(saved.apPassword) == 16 &&
            validId(saved.selected) && validId(saved.defaultCard) && saved.calibration.sane()) {
            value = saved;
            return true;
        }
        Serial.println("Settings checksum/schema invalid; using safe defaults");
    }
    static const char alphabet[] = "abcdefghjkmnpqrstuvwxyz23456789";
    bootloader_random_enable();
    for (unsigned i = 0; i < 16; ++i)
        value.apPassword[i] = alphabet[esp_random() % (sizeof(alphabet) - 1)];
    bootloader_random_disable();
    return save();
}
bool SettingsStore::save() {
    value.crc = checksum(&value, offsetof(Settings, crc));
    return prefs_.putBytes("settings", &value, sizeof(value)) == sizeof(value);
}
} // namespace badge
