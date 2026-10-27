#include "Settings.h"
#include <bootloader_random.h>
#include <esp_random.h>
#include <stddef.h>
namespace badge {
namespace {
void randomKey(char *out, bool radioActive = false) {
    static const char alphabet[] = "abcdefghjkmnpqrstuvwxyz23456789";
    // The boot entropy source shares ADC/RF resources. BLE already supplies
    // entropy when revoking a key at runtime.
    if (!radioActive)
        bootloader_random_enable();
    for (unsigned i = 0; i < 16; ++i)
        out[i] = alphabet[esp_random() % (sizeof(alphabet) - 1)];
    out[16] = 0;
    if (!radioActive)
        bootloader_random_disable();
}
bool validBase(const SettingsV2 &s) {
    return s.brightness >= 5 && s.brightness <= 100 && (s.rotation == 0 || s.rotation == 2) &&
           s.interval >= 5 && s.interval <= 3600 && s.ssid[32] == 0 && s.wifiPassword[64] == 0 &&
           s.apName[32] == 0 && s.apPassword[16] == 0 && validId(s.selected) &&
           validId(s.defaultCard) && s.calibration.sane();
}
} // namespace
bool SettingsStore::begin() {
    if (!prefs_.begin("badge-v2", false))
        return false;
    // Independent schema-3 key preserves the original blob for recovery.
    if (prefs_.getBytesLength("settings3") == sizeof(Settings)) {
        Settings saved;
        prefs_.getBytes("settings3", &saved, sizeof(saved));
        uint32_t crc = saved.crc;
        saved.crc = 0;
        if (saved.version == 3 && crc == checksum(&saved, sizeof(saved)) && validBase(saved) &&
            validScreenTimeout(saved.screenTimeout) && saved.pairingKey[16] == 0 &&
            strlen(saved.pairingKey) == 16) {
            saved.crc = crc;
            value = saved;
            return true;
        }
        Serial.println("Settings v3 invalid; trying preserved v2");
    }
    if (prefs_.getBytesLength("settings") == sizeof(SettingsV2)) {
        SettingsV2 saved;
        prefs_.getBytes("settings", &saved, sizeof(saved));
        if (saved.version == 2 && saved.crc == checksum(&saved, offsetof(SettingsV2, crc)) &&
            validBase(saved)) {
            static_cast<SettingsV2 &>(value) = saved;
            Serial.println("Migrated settings v2; original retained");
        }
    }
    if (!value.apPassword[0])
        randomKey(value.apPassword);
    randomKey(value.pairingKey);
    return save();
}
bool SettingsStore::save() {
    value.version = 3;
    value.crc = 0;
    value.crc = checksum(&value, sizeof(value));
    return prefs_.putBytes("settings3", &value, sizeof(value)) == sizeof(value);
}
bool SettingsStore::revokePairing() {
    Settings before = value;
    randomKey(value.pairingKey, true);
    if (save())
        return true;
    value = before;
    return false;
}
} // namespace badge
