#include "FactoryReset.h"
#include <LittleFS.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
namespace badge {
bool requestFactoryReset() {
    Preferences journal;
    if (!journal.begin("badge-reset", false))
        return false;
    return journal.putBool("pending", true) == 1;
}
void resumeFactoryReset() {
    Preferences journal;
    if (!journal.begin("badge-reset", false)) {
        // Fail closed if the reset journal cannot be read.
        delay(1000);
        ESP.restart();
        return;
    }
    if (!journal.getBool("pending", false))
        return;
    // No UI or transfer engine is running here. Repeat every step after power loss.
    NimBLEDevice::init("LanyardBadge");
    bool bonds = NimBLEDevice::deleteAllBonds();
    LittleFS.begin(false, "/littlefs", 10, "assets");
    bool files = LittleFS.format();
    Preferences application;
    bool settings = application.begin("badge-v2", false) && application.clear();
    application.end();
    if (bonds && files && settings)
        journal.remove("pending");
    // Keep the marker on any failure; subsequent boots safely retry the reset.
    delay(1000);
    ESP.restart();
}
} // namespace badge
