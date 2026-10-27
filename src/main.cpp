#include "Board.h"
#include "hardware/Display.h"
#include "hardware/Touch.h"
#include "net/Bluetooth.h"
#include "net/Network.h"
#include "storage/Assets.h"
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
uint32_t switchedAt = 0, saveAt = 0, restartAt = 0;
bool pendingSave = false, pendingClose = false;
String serialLine;
uint32_t loopMaxUs = 0;
void scheduleSave() {
    pendingSave = true;
    saveAt = millis();
}
void show(unsigned index, bool persist = true) {
    if (!assets.deck.count) {
        ui.page(Page::Pairing);
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
    case Command::Setup:
        ui.page(Page::Pairing);
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
        if (settings.revokePairing()) {
            bluetooth.revoke(true);
            ui.page(Page::Pairing);
        }
        return;
    case Command::CloseSetup:
        pendingClose = true;
        return;
    case Command::Rotate:
        s.rotation = s.rotation == 0 ? 2 : 0;
        ui.orientation();
        break;
    case Command::Restart:
        restartAt = millis() + 300;
        return;
    case Command::Storage:
        if (assets.provision()) {
            Serial.println("Blank LittleFS initialized; no existing files overwritten");
            ui.invalidate();
        } else
            Serial.println("Storage setup failed or filesystem already mounted");
        return;
    }
    scheduleSave();
    ui.invalidate();
}
void printStatus() {
    auto d = network.statusDocument();
    serializeJson(d, Serial);
    Serial.println();
}
void serialCommand(const String &s) {
    if (s == "status")
        printStatus();
    else if (s == "next")
        act(Command::Next, 0);
    else if (s == "prev")
        act(Command::Previous, 0);
    else if (s == "menu")
        ui.page(Page::Menu);
    else if (s == "badge")
        ui.page(Page::Badge);
    else if (s == "diag")
        ui.page(Page::Diagnostics);
    else if (s == "rotate")
        act(Command::Rotate, 0);
    else if (s == "calibrate")
        ui.page(Page::Calibration);
    else if (s == "sleep")
        ui.sleep();
    else if (s == "wake")
        ui.wake();
    else if (s == "bench-menu")
        ui.benchmarkMenu();
    else if (s == "bench-lvgl")
        ui.benchmark(false);
    else if (s == "bench-stream")
        ui.benchmark(true);
    else if (s == "render-lvgl")
        ui.benchmarkMode(false);
    else if (s == "render-stream")
        ui.benchmarkMode(true);
    else if (s == "onboarding")
        ui.page(Page::Pairing);
    else if (s == "setup")
        act(Command::Setup, 0);
    else if (s == "close")
        act(Command::CloseSetup, 0);
    else if (s == "storage-init")
        act(Command::Storage, 0);
    else if (s == "restart")
        act(Command::Restart, 0);
    else if (s == "brightness")
        act(Command::Brightness, 0);
    else
        Serial.println("Commands: status next prev menu badge diag rotate calibrate setup close "
                       "storage-init brightness restart sleep wake bench-lvgl bench-stream");
}
} // namespace
void setup() {
    Serial.begin(115200);
    delay(100);
    serialLine.reserve(96);
    pinMode(board::boot, INPUT_PULLUP);
    Serial.printf("\nLanyardBadge 2.3.0 | chip=%s rev=%u flash=%u PSRAM=%u reset=%d\n",
                  ESP.getChipModel(), ESP.getChipRevision(), unsigned(ESP.getFlashChipSize()),
                  unsigned(ESP.getPsramSize()), int(esp_reset_reason()));
    if (!settings.begin())
        Serial.println("WARNING: NVS settings unavailable");
    if (!display.begin(settings.value.rotation, settings.value.brightness))
        Serial.println("ERROR: Display or backlight initialization failed");
    Serial.printf("Display: %dx%d, portrait=%u\n", int(display.width()), int(display.height()),
                  settings.value.rotation);
    if (!touch.begin())
        Serial.println("WARNING: Touch initialization failed");
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
    ui.info = [] { return network.summary(); };

    ui.pairingUrl = [] { return bluetooth.pairingUrl(); };
    ui.bluetoothName = [] { return bluetooth.name(); };
    if (!bluetooth.begin())
        Serial.println("ERROR: Bluetooth initialization failed");
    if (!ui.begin()) {
        Serial.println("FATAL: LVGL initialization failed");
        while (true)
            delay(1000);
    }
    network.progress = [](int p) { ui.uploadProgress(p); };
    network.selected = [] { return ui.selected(); };
    network.select = [](unsigned i) {
        show(i);
        ui.page(Page::Badge);
    };
    network.showBadge = [] { ui.page(Page::Badge); };
    network.paired = [] {
        if (settings.value.provisioned && ui.currentPage() == Page::Pairing)
            ui.page(Page::Badge);
    };
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
            Serial.println(
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
    network.calibrateTouch = [] { ui.page(Page::Calibration); };
    network.settingsChanged = [] {
        ui.wake();
        ui.orientation();
        switchedAt = millis();
    };

    switchedAt = millis();
    Serial.println("Ready. Hold screen for menu. Hold BOOT 2s for editor, 6s for touch recovery.");
    printStatus();
}
void loop() {
    uint32_t loopStart = micros();
    ui.pump();
    bluetooth.tick();

    if (Serial.available()) {
        char c = Serial.read();
        if (c == '\n' || c == '\r') {
            if (serialLine.length())
                serialCommand(serialLine);
            serialLine = "";
        } else if (serialLine.length() < 96)
            serialLine += c;
    }
    // BOOT is input-only here: no peripheral is driven on an unverified expansion pin.
    static uint32_t pressedAt = 0;
    static bool latched = false;
    if (digitalRead(board::boot) == LOW) {
        if (!pressedAt)
            pressedAt = millis();
        if (latched && millis() - pressedAt >= 6000 && ui.currentPage() != Page::Calibration) {
            settings.value.calibration = Calibration{};
            ui.orientation();
            ui.page(Page::Calibration);
        }
        if (!latched && millis() - pressedAt >= 2000) {
            latched = true;
            act(Command::Setup, 0);
        }
    } else {
        pressedAt = 0;
        latched = false;
    }
    if (pendingClose) {
        pendingClose = false;
        bluetooth.revoke();
        ui.page(Page::Badge);
    }
    if (pendingSave && millis() - saveAt >= 1500) {
        if (!settings.save())
            Serial.println("WARNING: Could not persist settings");
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
    if (restartAt && int32_t(millis() - restartAt) >= 0) {
        if (pendingSave)
            settings.save();
        ESP.restart();
    }
    uint32_t elapsed = micros() - loopStart;
    if (elapsed > loopMaxUs)
        loopMaxUs = elapsed;
    delay(1);
}
