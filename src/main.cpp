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
void scheduleSave() {
    pendingSave = true;
    saveAt = millis();
}
void show(unsigned index, bool persist = true) {
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
        show((ui.selected() + 1) % assets.deck.count);
        return;
    case Command::Previous:
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
    case Command::WifiSetup:
        if (network.open())
            ui.page(Page::Setup);
        else
            Serial.println("Could not open setup Wi-Fi");
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
            Serial.println("LittleFS initialized; built-in cards saved");
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
    else if (s == "selftest")
        network.selfTest();
    else if (s == "setup")
        act(Command::Setup, 0);
    else if (s == "wifi")
        act(Command::WifiSetup, 0);
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
                       "storage-init brightness restart selftest");
}
} // namespace
void setup() {
    Serial.begin(115200);
    delay(100);
    serialLine.reserve(96);
    pinMode(board::boot, INPUT_PULLUP);
    Serial.printf("\nLanyardBadge 2.2.0 | chip=%s rev=%u flash=%u PSRAM=%u reset=%d\n",
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
    assets.begin();
    ui.command = act;
    ui.info = [] { return network.summary(); };
    ui.editorUrl = [] { return network.editorUrl(); };
    ui.connectionHint = [] { return network.connectionHint(); };
    ui.pairingUrl = [] { return bluetooth.pairingUrl(); };
    ui.bluetoothName = [] { return bluetooth.name(); };
    if (!ui.begin()) {
        Serial.println("FATAL: LVGL initialization failed");
        while (true)
            delay(1000);
    }
    network.pump = [] { ui.pump(); };
    network.progress = [](int p) { ui.uploadProgress(p); };
    network.selected = [] { return ui.selected(); };
    network.select = [](unsigned i) {
        show(i);
        ui.page(Page::Badge);
    };
    network.showBadge = [] { ui.page(Page::Badge); };
    network.paired = [] {
        if (ui.currentPage() == Page::Setup || ui.currentPage() == Page::Pairing)
            ui.page(Page::Badge);
    };
    network.connectionChanged = [] {
        if (ui.currentPage() == Page::Setup || ui.currentPage() == Page::Info)
            ui.invalidate();
    };
    network.deviceStatus = [](JsonDocument &d) {
        d["screen"] = ui.currentPage() == Page::Badge         ? "badge"
                      : ui.currentPage() == Page::Calibration ? "calibration"
                      : ui.currentPage() == Page::Setup       ? "connection"
                                                              : "menu";
        d["touchPressed"] = touch.down();
        d["touchPressure"] = touch.pressure();
        d["touchPresses"] = touch.presses();
        d["touchRawX"] = touch.raw().x;
        d["touchRawY"] = touch.raw().y;
        d["bluetoothConnected"] = bluetooth.connected();
        d["bluetoothName"] = bluetooth.name();
    };
    network.cardsChanged = [] {
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
        display.brightness(settings.value.brightness);
        ui.orientation();
        switchedAt = millis();
    };
    network.requestClose = [] { pendingClose = true; };
    network.begin();
    if (!bluetooth.begin())
        Serial.println("ERROR: Bluetooth initialization failed");
    switchedAt = millis();
    Serial.println(
        "Ready. Set up touch once, then hold the screen for the menu. BOOT is recovery only.");
    printStatus();
}
void loop() {
    ui.pump();
    bluetooth.tick();
    if (!bluetooth.connected())
        network.tick();
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
        network.close();
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
    if (settings.value.autoplay && visible &&
        millis() - switchedAt >= settings.value.interval * 1000U)
        show((ui.selected() + 1) % assets.deck.count, false);
    if (restartAt && int32_t(millis() - restartAt) >= 0) {
        if (pendingSave)
            settings.save();
        ESP.restart();
    }
    delay(3);
}
