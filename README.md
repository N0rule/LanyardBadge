# LanyardBadge 2.0

Artwork you can wear. Choose an image, position it in a portrait badge preview,
and upload it over Bluetooth. No account, native app, Wi-Fi setup, SD card or PSRAM.

**[Open the companion editor](https://n0rule.is-a.dev/LanyardBadge/)**

The current firmware is 2.3.4. It targets the 4 MB ESP32 CYD2USB with ST7789 and
XPT2046 resistive touch. USB faces **down**, 240 × 320, portrait rotation 0.

## Use your badge

1. New blank boards start with the geometric **First light** artwork. Hold BOOT
   for two seconds to show the editor QR, then scan it or open the website manually.
   Calibration is optional. Existing collections are never replaced by the default.
2. Choose **Connect your badge** in a supported secure Web Bluetooth browser.
   On first connection, enter the fresh six-digit number displayed on the badge
   into the browser’s native Bluetooth prompt. Reconnect reuses the saved OS bond.
   A scanned QR supplies the separate editor access code and is immediately cleared
   from the URL. Otherwise, enter the four-letter code below the badge’s QR.
   The editor appears after authentication; empty cards start with a neutral gray preview.
3. Choose artwork, rotate, fit/crop, zoom and drag it into position. The preview
   and final upload share the same transformation. Upload the card, then wear it.
4. Swipe the physical artwork screen to change cards; hold it for about half a
   second to open the menu. A hold can continue directly after waking the screen.
   Settings include brightness, slideshow and display timeout. Touch wakes a dark
   screen, consuming the first press. Default timeout is two minutes; Never is
   available.

Chrome/Edge on supported desktop or Android configurations can use Web Bluetooth.
iOS Safari is unsupported. Linux needs a running Bluetooth daemon and a pairing
agent. Device discovery and pairing are real browser/OS prompts, not simulated
connection states. USB firmware installation needs desktop Web Serial.
Current firmware uses authenticated LE Secure Connections with a physical PIN;
Windows pairing can complete directly from the browser, without Windows Settings
or experimental flags. Helium on Windows was tested with the actual badge;
Chrome/Edge and Android still need validation of this new security profile.
Linux requires a working desktop pairing agent for its native prompt. Revoking
editor access rotates the application code while retaining the OS bond.
Older firmware uses Just Works pairing and remains supported by the editor,
but upgrading through USB is recommended for reliable browser-first Windows pairing.

Calibration is optional under **Settings → Advanced**. Hold the physical BOOT
button two seconds to reopen the editor QR, or six seconds for touch recovery.
Revoke editor access under Advanced to replace a photographed/lost pairing key.
Settings also offers a device dark/light theme, retained across restarts. Submenu
arrows go back one level; the main menu's centered X returns to artwork. Release
menus omit developer diagnostics and benchmark commands are compiled out unless
`BADGE_DIAGNOSTICS=1` is explicitly enabled.
Pair manually with the four-letter code on the connection screen. Remember badge
is enabled by default; this browser then saves device access and tries to reconnect
after refresh without another code. Disable it on a shared computer, or use
**Forget badge** to remove saved browser access. Browser permission, the same site
origin and a working Bluetooth service are required for automatic reconnect.
Older profile/custom cards remain readable and displayable; new creation is
artwork-only. The editor labels legacy cards and replaces their layout only when
you explicitly choose artwork and upload.

## Build, preserve data, and flash

Use PlatformIO CLI. Dependencies are pinned in `platformio.ini`.

```sh
pio run -e cyd2usb
pio run -e cyd2usb -t upload --upload-port /dev/ttyUSB0
python scripts/device.py status
```

Close all serial monitors and BLE test clients before uploading. Opening the
CH340 port can reset the board even when a diagnostic tool does not request reset;
keep one serial connection open when collecting concurrent BLE diagnostics.

The partition layout preserves the connected 2.1.0 device: a 2 MiB application at
`0x10000`, LittleFS at `0x210000` for `0x1f0000` bytes. Actual padded firmware size
is checked after build and before upload. The guard also removes Arduino’s unused
OTA stub, rejects writes into NVS/PHY/artwork, and validates the compiled partition
table. Ordinary updates write no filesystem
image. Settings migrate to a separate versioned NVS key without deleting v2.

**Back up existing devices before migration.** Other firmware/layouts, including
the intermediate 2.5 MiB app layout, need an explicit offline migration. Do not
use a data-preserving update manifest on an incompatible partition table.

```sh
mkdir -p backups
esptool --port /dev/ttyUSB0 --baud 921600 read-flash 0 0x400000 backups/device-4mb.bin
sha256sum backups/device-4mb.bin
```

Backups and `.secrets/` are ignored: flash can contain credentials. Never use
`erase-flash` or `uploadfs` for ordinary updates. A mount failure preserves data;
only a verified entirely erased asset partition is initialized automatically.

## Editor and USB installation

`web/` is a static app. All URLs work under `/LanyardBadge/`. Light, dark and System
themes initialize before paint and preserve editing state. The enclosure has equal
opposite bezels; theme changes never alter artwork colors. Position percentages
represent allowed travel (positive right/down), not percentages of image pixels.

The USB installer uses locally vendored **ESP Web Tools 10.4.0**, loaded on demand.
Choose the ST7789 CYD2USB target. Fresh manifests include bootloader, partition
table and application; update manifests include **only** the application. Erasure
requires an explicit installer choice and destroys stored cards/settings. There
is no OTA or BLE firmware installer.

The GitHub Pages workflow runs host/browser tests, builds firmware and publishes
per-commit binaries, manifests and SHA-256 sums. To package it locally:

```sh
npm ci --prefix tests
python scripts/vendor_installer.py
pio run -e cyd2usb
python scripts/package_site.py
python scripts/validate_site.py test-results/site
```

## Validation

```sh
bash scripts/test-host.sh
npm ci --prefix tests
npx --prefix tests playwright install chromium
npm test --prefix tests
python scripts/benchmark_device.py --switches 50
```

The benchmark renders both old LVGL and optimized streaming paths on the same
hardware; it changes selection temporarily and restores the initial selection.
It also exercises sleep/wake state and restart persistence. Physical tap-to-wake,
colors and touch accuracy still need an observer.

A real radio test is available with Bleak installed in a virtual environment:

```sh
python scripts/test_ble.py --key-file .secrets/pairing-key
```

Supply the device-specific key through a private file, never a command argument,
public log or commit. Browser tests simulate GATT peripherals and separately
verify transform/export pixel error bounds; they do not establish a radio link.
See [verification](docs/VERIFICATION.md) for actual results and remaining physical
checks, [architecture](docs/ARCHITECTURE.md) for memory/storage tradeoffs, and
[BLE protocol](docs/API.md) for transport details.

The older `cyd`/ILI9341 environment is retained as a compatibility build target.
Only CYD2USB/ST7789 has been connected and measured in this development session.

The card editor keeps artwork at the center: choose a file, adjust it directly on
the badge preview, then upload. Rotation and precise crop controls appear after
choosing artwork. Uploads use a dedicated progress screen in the badge's saved
light or dark theme, and only report completion after the card is safely saved.

Animated GIFs are supported with current firmware: choose the GIF, adjust it like
still artwork, then upload. The browser previews every frame and the badge plays
compressed frame updates without a framebuffer. Input limits are 30 MB, 300 frames,
30 seconds and a prepared asset size of 1 MiB; available storage can limit this
further. Older badges need a data-preserving USB firmware update. See
[GIF support and limits](docs/GIF.md).

The editor caches validated artwork in the browser, so refreshes and reconnects
reuse unchanged cards. It still authenticates and reads current card metadata.
Images you upload are prepared and cached on the client. Firmware 2.3.4 also lets
uncached previews yield to other Bluetooth controls; an initial uncached preview
still requires a transfer. Clearing site data removes this disposable cache.
