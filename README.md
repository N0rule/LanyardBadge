# LanyardBadge 2.0

A portrait digital badge for the classic ESP32 Cheap Yellow Display. Create a
profile, carry a favorite illustration, or arrange your own text and graphics
from an offline browser editor. No account, cloud, phone app, SD card, or PSRAM.

## Hardware and stack

The default `cyd2usb` build targets a 240 × 320 ST7789 display, XPT2046
resistive touch, and 4 MB flash. USB connectors face **down**. Portrait rotation
0 was confirmed by the owner. An observed red/blue swap was corrected in the new
LovyanGFX configuration; the corrected colors still need a visual recheck.

PlatformIO espressif32 8.0.0 / Arduino-ESP32 3.3.12, LovyanGFX 1.2.7, LVGL
9.2.2, XPT2046 v1.4, ArduinoJson 7.4.2. Pins live in
[include/Board.h](include/Board.h). The original sketch is retained in Git and
in the root directory; PlatformIO now builds only `src/`.

See [architecture](docs/ARCHITECTURE.md), [API](docs/API.md),
[hardware checklist](docs/HARDWARE_CHECKLIST.md), and
[verification results](docs/VERIFICATION.md).

## Build and flash on Linux

Install PlatformIO Core and ensure your user can access `/dev/ttyUSB0`. The
first build downloads the pinned libraries. No Node, VS Code, or web build step
is required: Python's standard library embeds deterministic gzip assets.

```sh
pio run
pio run -t upload --upload-port /dev/ttyUSB0
pio device monitor -p /dev/ttyUSB0 -b 115200
pio run -t clean
```

`pio run -e cyd` also builds the older ILI9341 variant. It has not been tested
on physical hardware. Do not select it for the confirmed ST7789 device.

**Before migrating an existing device, back up its flash.** This rewrite uses a
new partition table and can overwrite the old application and filesystem layout.

```sh
mkdir -p backups
python3 -m esptool --chip esp32 --port /dev/ttyUSB0 --baud 921600 \
  read-flash 0 0x400000 backups/original-4mb.bin
sha256sum backups/original-4mb.bin
```

A full backup of the connected device was made before this migration. `backups/`
is ignored by Git because full flash can contain credentials. To restore that
entire previous device state, stop all serial monitors and run:

```sh
python3 -m esptool --chip esp32 --port /dev/ttyUSB0 --baud 921600 \
  write-flash 0 backups/original-4mb.bin
```

Restoring the backup replaces **all** new cards, settings, credentials and
firmware. Do not use `erase-flash` or `uploadfs` for a normal firmware update.

## First use

1. The badge boots into its last manually selected card. Two built-in cards work
   even if the filesystem is unavailable.
2. Calibrate touch first. On a fresh badge, hold the screen for 750 ms to start
   the four-corner wizard. Lift your finger between targets. You can also start
   calibration over serial or from Device settings in the browser.
3. Initialize the new filesystem once, after backing up the old flash. On the
   badge, open Device information and choose storage initialization.
   Alternatively, run `python3 scripts/device.py storage-init`. Initialization
   is refused for an existing mounted collection. An empty mounted filesystem
   can resume interrupted provisioning without formatting. It erases an
   unmounted asset partition, installs the built-in gallery and the supplied
   sample illustration, and saves the card database. Mount failures never
   trigger automatic formatting.
4. Hold **BOOT for two seconds** to open configuration. This works without touch
   calibration. Join `LanyardBadge-Setup` using the generated password shown on
   the screen. Open **http://192.168.4.1** and enter the same password to pair.
5. Choose or create a card. Add artwork, crop it, edit the text and colors, then
   select **Save to badge**. Saving also displays the edited card immediately.

The hotspot and editor close after 15 minutes. Reopen configuration from the
badge menu or BOOT. The normal badge screen does not show setup credentials. The
AP name is defined in the persisted settings defaults in
`src/storage/Settings.h`; change that default before first provisioning when
building several badges. Each device generates its own random password.

## Touch and navigation

- Tap the left or right half of a badge to switch cards.
- Swipe left/right after calibration to switch cards.
- Hold the screen for 750 ms to open the menu.
- The menu provides gallery selection, brightness, slideshow interval, default
  card, editor connection, device information, calibration, diagnostics and
  restart.
- BOOT held for two seconds opens the editor connection screen independently of
  touch.

For calibration, run `python3 scripts/device.py calibrate`, or select Calibrate
touch in Device information. Touch and hold each crosshair, then lift your
finger before moving to the next one. Three points fit an affine mapping; the
fourth must be within 18 pixels before the mapping is saved. An uncalibrated
badge starts this wizard on its first long press. It can also be started from
Device settings in the browser, without a USB command. A 60-second timeout keeps
the previous mapping. Mapping is stored independently of portrait rotation.

Brightness is kept above 5% so the screen cannot accidentally become invisible.
Manual settings and selections are coalesced over 1.5 seconds before NVS writes.
Wait two seconds before removing power. Slideshow advances are intentionally not
written to NVS every interval; reboot returns to the last manual selection. The
default card is used if that selection is removed or unavailable.

## Making cards

- **Profile:** editable name, description, cropped circular photo/avatar, three
  colors, and a high-contrast QR link. Keep names short enough for one line.
- **Artwork:** full-screen photo or illustration, with fill/crop, fit, zoom and
  position controls. Transparent images use the chosen background color.
- **Custom:** background artwork, up to four text blocks and four rounded
  rectangles/circles. Set positions numerically or drag them in the preview. An
  optional QR code sits in the lower-right corner above the other content.
- **Gallery:** ten card slots. Reorder, delete, select and configure timed
  switching. Deletions and ordering take effect when you save.

The editor accepts JPEG, PNG, WebP and BMP supported by the browser, up to 24 MB
and 50 megapixels. It prepares a 240 × 320 RGB565 bitmap locally; the ESP32
never allocates a full decoded image. A background uses 153,666 bytes,
regardless of source size. Browser decoding of very large files can still
consume substantial phone memory; smaller source files are preferable.

Prepared crops are stored; original full-resolution photos stay on your
computer. After reloading, further cropping starts from the prepared image.
Choose the original file again to recover cropped-out areas or reuse a profile
avatar as full-screen artwork. Browser font metrics and device anti-aliasing can
differ slightly; text and shape placement use the same coordinates and font
sizes.

The bundled device fonts support printable ASCII text and line breaks.
Unsupported characters are rejected with a useful error. QR links accept
HTTP(S), up to 100 ASCII bytes. QR modules are integer scaled, black on white,
with a quiet zone; verify scanning on the physical TFT, especially for long URLs
and low brightness.

All editor assets, including Montserrat and Nayuki's QR encoder, are local.
Third-party licenses remain in `web/FONT-LICENSE.txt` and `web/qrcode.js`. The
sample BMP is a zlib-compressed copy of the supplied `ExampleImage.png`; it is
inflated in 32 KiB chunks only when provisioning storage. The bundled sample is
quantized to 256 colors to fit flash; uploads retain full RGB565 color
precision.

## Storage and updates

The 4 MB layout reserves 2 MiB for firmware and 1,984 KiB for LittleFS, plus
NVS, PHY data, bootloader and partition table. There is no OTA slot. See
[partitions.csv](partitions.csv) for exact offsets.

Content writes use immutable image names, a temporary upload, length/header
checks, and atomic rename. Card metadata has a CRC and a previous generation.
Interrupted uploads do not replace existing images. An invalid current database
falls back to its backup, then built-in cards. Missing backgrounds show a small
warning.

The previous generation's backgrounds are kept for recovery. Cleaning unused
backgrounds preserves both generations. If storage is full, delete an unused
card and save; a later save lets the old generation retire before cleanup.
Replace backgrounds one at a time when close to capacity. Multiple unsaved
background replacements need temporary space for every new image before the
manifest commits.

USB firmware updates with this same partition layout preserve cards and
settings. There is no automatic filesystem reset. No SD, Bluetooth, NFC, battery
features or OTA are implied by the interface. TFT content disappears when USB
power is lost.

## Security and network behavior

Configuration is a physical-access, time-limited session. The AP uses WPA2 with
a random 16-character password stored in NVS, never in source. Pairing returns a
random bearer token kept in browser session storage and device RAM. Pairing is
rate-limited. Image and JSON requests authenticate before raw body ingestion;
body size, transfer duration, request target and header lengths are bounded.

A saved 2.4 GHz network reconnects without blocking the UI. The HTTP editor
still only runs while configuration is open. It uses local HTTP, so use a
trusted LAN or the WPA2 setup AP; there is no TLS, internet account or remote
access. NVS and flash backups are not encrypted. Treat access to USB and full
flash as privileged. Wi-Fi credentials are neither logged nor returned by the
API.

## Diagnostics and tests

```sh
python3 scripts/device.py --reset --seconds 5 status
python3 scripts/device.py diag
python3 scripts/device.py setup
python3 scripts/device.py --seconds 50 selftest
python3 scripts/device.py close badge
python3 scripts/soak_device.py --switches 100
scripts/test-host.sh
```

Type `help` in a serial monitor to list commands. `selftest` requires mounted
storage and an open setup session. It uses a temporary TCP client task on the
ESP32 itself, exercises real HTTP routes, tests image transfers and failure
recovery, saves the unchanged card deck, and removes its temporary background.
Pairing invalidates any existing editor token, so run it outside an editing
session. It does not require changing your computer's Wi-Fi connection.

Optional browser tests are development-only:

```sh
npm ci --prefix tests
npm exec --prefix tests -- playwright install chromium
npm test --prefix tests
```

Browser tests use intercepted local API responses and need no running server or
external service. They cover editing, image preparation, failed-save retry,
gallery changes, drag positioning, mobile layout and device settings. Hardware
tests and their limits are recorded separately from compilation.

## Troubleshooting

- **Red and blue exchanged:** check `p.rgb_order` in Display.cpp; this board
  needs `false` in LovyanGFX. Its boolean does not directly match TFT_eSPI's
  color macros.
- **Upside down:** run `rotate`, use the on-device diagnostic button, or change
  portrait orientation in editor settings. Both candidates retain 240 × 320.
- **Touch inaccurate/unreachable:** run `calibrate` over serial. Keep the USB
  connectors downward and lift between targets. BOOT always opens setup.
- **No setup network:** hold BOOT again; the 15-minute session may have expired.
  An unrelated Wi-Fi network may prevent a phone from staying on an AP without
  internet; choose to stay connected and use the numeric address.
- **Storage unavailable:** back up the flash before explicit initialization. Do
  not automatically format a device containing wanted cards.
- **Upload failed:** retain the browser tab, reconnect, and retry. Existing
  content remains usable. A revision conflict requires reloading before applying
  edits.
- **Core-dump partition warning at boot:** the upstream Arduino build enables
  flash core dumps, but this layout allocates no core-dump partition. The
  warning is harmless; serial crash output remains available.
