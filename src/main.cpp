#include "Board.h"
#include "Version.h"
#include "core/Console.h"
#include "hardware/Display.h"
#include "hardware/Touch.h"
#include "net/Bluetooth.h"
#include "net/Network.h"
#include "net/SerialTransport.h"
#include "storage/Assets.h"
#include "storage/FactoryReset.h"
#include "storage/Settings.h"
#include "ui/Ui.h"
#include <Arduino.h>
#include <esp_heap_caps.h>
using namespace badge;
namespace {
Display display;
Touch touch;
SettingsStore settings;
Assets assets;
Ui ui(display, touch, assets, settings);
badge::Network network(settings, assets);
Bluetooth bluetooth(network, assets, settings);
SerialTransport usb(network, assets);
uint32_t switchedAt = 0, saveAt = 0;
bool pendingSave = false;
uint32_t loopMaxUs = 0;
void scheduleSave() {
    pendingSave = true;
    saveAt = millis();
}
void show(unsigned index, bool persist = true) {
    if (!assets.deck.count) {
        ui.page(assets.legacyCollection() ? Page::Badge : Page::Pairing);
        return;
    }
    ui.select(index);
    switchedAt = millis();
    if (persist) {
        strlcpy(settings.value.selected, assets.deck.cards[ui.selected()].id, 9);
        scheduleSave();
    }
}
void act(Command c, int value) {
    auto &s = settings.value;
    switch (c) {
    case Command::Next:
        if (assets.deck.count <= 1)
            return;
        show((ui.selected() + 1) % assets.deck.count);
        return;
    case Command::Previous:
        if (assets.deck.count <= 1)
            return;
        show((ui.selected() + assets.deck.count - 1) % assets.deck.count);
        return;
    case Command::Select:
        show(value);
        return;
    case Command::Brightness:
        s.brightness = s.brightness >= 100 ? 5
                       : s.brightness < 25 ? 25
                       : s.brightness < 50 ? 50
                       : s.brightness < 75 ? 75
                                           : 100;
        display.brightness(s.brightness);
        break;
    case Command::Autoplay:
        s.autoplay = !s.autoplay;
        switchedAt = millis();
        break;
    case Command::Interval:
        s.interval = s.interval < 15    ? 15
                     : s.interval < 30  ? 30
                     : s.interval < 60  ? 60
                     : s.interval < 300 ? 300
                                        : 5;
        switchedAt = millis();
        break;
    case Command::DefaultCard:
        strlcpy(s.defaultCard, assets.deck.cards[ui.selected()].id, 9);
        strlcpy(s.selected, s.defaultCard, 9);
        break;
    case Command::CancelBluetoothPairing:
        bluetooth.cancelNativePairing();
        ui.nativePairing(UINT32_MAX);
        return;
    case Command::Timeout: {
        const uint32_t options[] = {0, 15, 30, 60, 120, 300, 600};
        for (unsigned i = 0; i < 7; ++i)
            if (s.screenTimeout == options[i]) {
                s.screenTimeout = options[(i + 1) % 7];
                break;
            }
        break;
    }
    case Command::RevokePairing:
        if (bluetooth.forgetEditors())
            ui.page(Page::Settings);
        return;
    case Command::Theme:
        s.darkMode = !s.darkMode;
        break;
    case Command::Back:
        ui.goBack();
        return;
    case Command::Rotate:
        s.rotation = s.rotation == 0 ? 2 : 0;
        ui.orientation();
        break;
    case Command::ConfirmReset:
        if (ui.currentPage() != Page::FactoryReset)
            return;
        if (requestFactoryReset())
            ESP.restart();
        else
            ui.resetFailed();
        return;
    }
    scheduleSave();
    ui.invalidate();
}
void printStatus() {
    auto d = network.statusDocument();
    serializeJson(d, Serial);
    Console::println();
}

} // namespace
void setup() {
    Serial.begin(115200);
    resumeFactoryReset();
    delay(100);
    Console::printf("\nLanyardBadge " BADGE_VERSION
                    " | chip=%s rev=%u flash=%u PSRAM=%u reset=%d\n",
                    ESP.getChipModel(), ESP.getChipRevision(), unsigned(ESP.getFlashChipSize()),
                    unsigned(ESP.getPsramSize()), int(esp_reset_reason()));
    if (!settings.begin())
        Console::println("WARNING: NVS settings unavailable");
    if (!display.begin(settings.value.rotation, settings.value.brightness))
        Console::println("ERROR: Display or backlight initialization failed");
    Console::printf("Display: %dx%d, portrait=%u\n", int(display.width()), int(display.height()),
                    settings.value.rotation);
    if (!touch.begin())
        Console::println("WARNING: Touch initialization failed");
    if (!assets.begin())
        assets.provision();
    bool hasArtwork = false;
    for (unsigned i = 0; i < assets.deck.count; ++i)
        if (assets.bitmapExists(assets.deck.cards[i].image))
            hasArtwork = true;
    if (settings.value.provisioned != hasArtwork) {
        settings.value.provisioned = hasArtwork;
        settings.save();
    }
    ui.command = act;

    ui.pairingUrl = [] { return bluetooth.pairingUrl(); };
    if (!bluetooth.begin())
        Console::println("ERROR: Bluetooth initialization failed");
    if (!ui.begin()) {
        Console::println("FATAL: LVGL initialization failed");
        while (true)
            delay(1000);
    }
    network.progress = [](UploadPhase phase, int percent) { ui.uploadProgress(phase, percent); };
    network.selected = [] { return ui.selected(); };
    network.select = [](unsigned i) {
        show(i);
        ui.page(Page::Badge);
    };
    network.showBadge = [] { ui.page(Page::Badge); };
    network.paired = [] { ui.paired(); };
    network.deviceStatus = [](JsonDocument &d) {
        d["screen"] = ui.currentPage() == Page::Badge         ? "badge"
                      : ui.currentPage() == Page::Calibration ? "calibration"
                      : ui.currentPage() == Page::Pairing     ? "connection"
                                                              : "menu";
        d["touchPressed"] = touch.down();
        d["touchPressure"] = touch.pressure();
        d["touchPresses"] = touch.presses();
        d["touchRawX"] = touch.raw().x;
        d["touchRawY"] = touch.raw().y;
        d["bluetoothConnected"] = bluetooth.connected();
        d["bluetoothDisconnectReason"] = bluetooth.disconnectReason();
        d["bluetoothSecurityStatus"] = bluetooth.securityStatus();
        d["bluetoothSecurityEvents"] = bluetooth.securityEvents();
        d["bluetoothEncrypted"] = bluetooth.encrypted();
        d["bluetoothAuthenticated"] = bluetooth.authenticatedLink();
        d["bluetoothProtocol"] = 3;
        d["bluetoothSecurityProfile"] = "sc-passkey-v1";
        d["bluetoothBonds"] = bluetooth.bonds();
        d["bluetoothAdvertising"] = bluetooth.advertising();
        d["bluetoothName"] = bluetooth.name();
        d["bluetoothInitialIntervalMs"] = bluetooth.initialIntervalMs();
        d["bluetoothIntervalMs"] = bluetooth.intervalMs();
        ui.diagnostics(d);
        d["loopMaxUs"] = loopMaxUs;
    };
    network.cardsChanged = [] {
        if (!assets.deck.count) {
            settings.value.provisioned = false;
            strlcpy(settings.value.selected, "00000001", 9);
            strlcpy(settings.value.defaultCard, "00000001", 9);
            settings.save();
            ui.page(Page::Pairing);
            return;
        }
        bool provisioned = false;
        for (unsigned i = 0; i < assets.deck.count; ++i)
            if (assets.bitmapExists(assets.deck.cards[i].image))
                provisioned = true;
        settings.value.provisioned = provisioned;
        if (!settings.save())
            Console::println(
                "WARNING: Provisioning state save failed; recovered from manifest at boot");
        bool defaultExists = false;
        for (unsigned i = 0; i < assets.deck.count; ++i)
            if (!strcmp(assets.deck.cards[i].id, settings.value.defaultCard))
                defaultExists = true;
        if (!defaultExists)
            strlcpy(settings.value.defaultCard, assets.deck.cards[0].id, 9);
        unsigned next = 0;
        bool found = false;
        for (unsigned i = 0; i < assets.deck.count; ++i)
            if (!strcmp(assets.deck.cards[i].id, settings.value.selected)) {
                next = i;
                found = true;
                break;
            }
        if (!found)
            for (unsigned i = 0; i < assets.deck.count; ++i)
                if (!strcmp(assets.deck.cards[i].id, settings.value.defaultCard))
                    next = i;
        show(next);
        ui.invalidate();
    };
    network.requestReset = [] {
        ui.wake();
        ui.page(Page::FactoryReset);
    };
    network.settingsChanged = [] {
        bluetooth.refreshName();
        ui.wake();
        ui.orientation();
        switchedAt = millis();
    };

    switchedAt = millis();
    Console::println("Ready. Hold screen for menu. Connect from the editor on your computer.");
    printStatus();
}
void loop() {
    uint32_t loopStart = micros();
    // BLE callbacks publish state only; all LVGL work stays on the main thread.
    ui.nativePairing(bluetooth.nativePasskey());
    ui.pump();
    bluetooth.tick();

    usb.tick();
    static uint32_t resetOpened = 0;
    if (ui.currentPage() == Page::FactoryReset) {
        if (!resetOpened)
            resetOpened = millis();
        if (millis() - resetOpened > 60000)
            ui.page(Page::Settings);
    } else
        resetOpened = 0;
    if (pendingSave && millis() - saveAt >= 1500) {
        if (!settings.save())
            Console::println("WARNING: Could not persist settings");
        pendingSave = false;
    }
    static bool wasVisible = true;
    bool visible = ui.badgeVisible();
    if (visible && !wasVisible)
        switchedAt = millis();
    wasVisible = visible;
    if (assets.deck.count > 1 && settings.value.autoplay && visible &&
        millis() - switchedAt >= settings.value.interval * 1000U)
        show((ui.selected() + 1) % assets.deck.count, false);

    uint32_t elapsed = micros() - loopStart;
    if (elapsed > loopMaxUs)
        loopMaxUs = elapsed;
    delay(1);
}
