#include "Settings.h"
#include "../core/Console.h"
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
    if (!prefs_.begin("badge-v2", false)) {
        randomKey(cacheEpoch);
        return false;
    }
    String savedName = prefs_.getString("deviceName", "LanyardBadge");
    if (validDeviceName(savedName.c_str()))
        deviceName = savedName;
    String epoch = prefs_.getString("cacheEpoch", "");
    if (epoch.length() == 16)
        strlcpy(cacheEpoch, epoch.c_str(), sizeof(cacheEpoch));
    else {
        randomKey(cacheEpoch);
        prefs_.putString("cacheEpoch", cacheEpoch);
    }
    if (prefs_.getBytesLength("settings5") == sizeof(Settings)) {
        Settings saved;
        prefs_.getBytes("settings5", &saved, sizeof(saved));
        uint32_t crc = saved.crc;
        saved.crc = 0;
        if (saved.version == 5 && crc == checksum(&saved, sizeof(saved)) && saved.brightness >= 5 &&
            saved.brightness <= 100 && (saved.rotation == 0 || saved.rotation == 2) &&
            saved.interval >= 5 && saved.interval <= 3600 &&
            validScreenTimeout(saved.screenTimeout) && saved.darkMode <= 1 &&
            validId(saved.selected) && validId(saved.defaultCard) && saved.calibration.sane()) {
            saved.crc = crc;
            value = saved;
            return true;
        }
    }
    auto migrate = [&](const SettingsV2 &saved) {
        value.interval = saved.interval;
        value.brightness = saved.brightness;
        value.rotation = saved.rotation;
        value.autoplay = saved.autoplay;
        memcpy(value.selected, saved.selected, 9);
        memcpy(value.defaultCard, saved.defaultCard, 9);
        value.calibration = saved.calibration;
    };
    if (prefs_.getBytesLength("settings4") == sizeof(SettingsV4)) {
        SettingsV4 saved;
        prefs_.getBytes("settings4", &saved, sizeof(saved));
        uint32_t crc = saved.crc;
        saved.crc = 0;
        if (saved.version == 4 && crc == checksum(&saved, sizeof(saved)) && validBase(saved) &&
            validScreenTimeout(saved.screenTimeout) && saved.darkMode <= 1) {
            migrate(saved);
            value.screenTimeout = saved.screenTimeout;
            value.provisioned = saved.provisioned;
            value.darkMode = saved.darkMode;
            return save();
        }
    }
    if (prefs_.getBytesLength("settings3") == sizeof(SettingsV3)) {
        SettingsV3 saved;
        prefs_.getBytes("settings3", &saved, sizeof(saved));
        uint32_t crc = saved.crc;
        saved.crc = 0;
        if (saved.version == 3 && crc == checksum(&saved, sizeof(saved)) && validBase(saved) &&
            validScreenTimeout(saved.screenTimeout)) {
            migrate(saved);
            value.screenTimeout = saved.screenTimeout;
            value.provisioned = saved.provisioned;
            return save();
        }
    }
    if (prefs_.getBytesLength("settings") == sizeof(SettingsV2)) {
        SettingsV2 saved;
        prefs_.getBytes("settings", &saved, sizeof(saved));
        if (saved.version == 2 && saved.crc == checksum(&saved, offsetof(SettingsV2, crc)) &&
            validBase(saved))
            migrate(saved);
    }
    return save();
}
bool SettingsStore::rename(const String &name) {
    if (!validDeviceName(name.c_str()) || prefs_.putString("deviceName", name) != name.length())
        return false;
    deviceName = name;
    return true;
}
bool SettingsStore::save() {
    value.version = 5;
    value.crc = 0;
    value.crc = checksum(&value, sizeof(value));
    return prefs_.putBytes("settings5", &value, sizeof(value)) == sizeof(value);
}
} // namespace badge
