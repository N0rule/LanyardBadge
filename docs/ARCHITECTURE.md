# LanyardBadge 2.0 architecture

## Decisions

Classic ESP32, 4 MB flash, no PSRAM assumed. Arduino-ESP32 3.3.12 on PlatformIO
espressif32 8.0.0; LovyanGFX 1.2.7; LVGL 9.2.2; XPT2046 v1.4; ArduinoJson 7.4.2.
Dependencies are pinned. Original code remains in Git and is excluded from the
standard src/ build. Migration branch: rewrite/lanyardbadge-2.

LovyanGFX owns SPI2 (HSPI) for the ST7789. The XPT2046 library owns SPI3 (VSPI),
using the original non-default touch pins. There is no SD support: standard CYD
SD wiring would compete for SPI3 with different pins. The LVGL pool is reserved
once from internal heap at startup to avoid the ESP32 static DRAM linker limit.
Unused LVGL widgets and themes are disabled; a small component style set covers
the badge and menu. LVGL uses one 240 x 32 x 2 byte partial buffer (15,360
bytes), a fixed 48 KiB internal allocator, RGB565 software drawing, and
synchronous SPI flushes. Synchronous completion makes buffer ownership explicit;
DMA is configured on the bus but overlapping flush/render operations are
deliberately unnecessary. No full-screen framebuffer, GPU, Bluetooth or
additional application tasks in normal operation. The explicitly requested
serial selftest starts one temporary TCP client task; it does not access UI or
storage directly. LV_KCONFIG_IGNORE keeps the Arduino build independent of
ESP-IDF's LVGL Kconfig and avoids ARM-only assembly pulling ESP-IDF headers into
an Xtensa build.

LVGL's BMP decoder reads a row at a time. A 4 KiB aligned read cache per open
image reduces the backwards seeks required by bottom-up BMP storage. Browsers
decode JPEG/PNG/WebP, resize/crop to 240 x 320 and encode a 16-bit RGB565 BMP
with explicit bit masks. This costs 153,666 bytes per background but bounds
decoder RAM and latency. JPEG offers more capacity but requires an additional
streaming decoder; PNG requires more work memory. Neither is needed on-device
for the first release. Text, QR codes and shapes remain editable card data,
separate from backgrounds.

## Flash

| Region              | Offset   | Size      |
| ------------------- | -------- | --------- |
| NVS                 | 0x9000   | 24 KiB    |
| PHY                 | 0xf000   | 4 KiB     |
| Factory application | 0x10000  | 2 MiB     |
| LittleFS            | 0x210000 | 1,984 KiB |

Bootloader and partition table occupy the preceding reserved space. No OTA
partition. Web assets are gzip-compressed in application flash, so uploading
firmware also updates the editor without overwriting the card filesystem. Ten
card slots leave room for an uploaded replacement and filesystem metadata. NVS
stores versioned configuration and generated local setup credentials. LittleFS
stores two generations of card metadata and immutable image files. Uploads
become visible only after full length/header validation and rename. No automatic
format on a mount failure; first setup explicitly provisions storage.

## Boundaries

- hardware/: display, backlight, raw touch and portrait coordinate mapping.
- model/: bounded card data and portable validation/math.
- storage/: NVS, manifest transactions, immutable image upload and recovery.
- ui/: LVGL screens, calibration, gestures, gallery and diagnostics.
- net/: time-limited WPA2 setup AP, station reconnect and authenticated HTTP
  API.
- web/: self-contained responsive card editor; no CDN or runtime network
  dependency.
- scripts/: reproducible asset embedding and host/device validation utilities.

## Visual direction

The badge is the focal object, presented at its physical 3:4 proportions. Editor
palette: frost #F3F6FC, white #FFFFFF, slate #23324D, blue #3659D9, lilac
#D9CEFF, muted slate #64728B. Native badge uses lilac, blue and slate. System
sans for editor controls; local Montserrat for canvas and badge text. Type scale
14 / 20 / 28, with a strong name and quiet supporting copy.

Desktop layout: gallery | portrait preview | editing controls. Left-aligned
controls; the portrait alone is centered. On a phone these become a single
column with the preview before its controls. Storage and Wi-Fi are in device
settings, never on the badge's main screen. Repeated dashboard stat cards and
unnecessary hero copy were rejected: this is an instrument for making a small
physical badge, and the canvas should receive the space.

## Primary references

- https://github.com/lovyan03/LovyanGFX/tree/1.2.7
- https://docs.lvgl.io/9.2/porting/display.html
- https://github.com/lvgl/lvgl/blob/v9.2.2/src/libs/bmp/lv_bmp.c
- https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ledc.html
- https://github.com/witnessmenow/ESP32-Cheap-Yellow-Display
- https://github.com/ralsina/esposito/blob/main/CYD2USB.md
- https://www.eniacelec.com/pages/tickey (interaction inspiration only)

The dual-USB reference contains hardware/rotation assumptions that do not all
match the supplied working firmware. Original pins are authoritative for this
migration; controller identity and calibration need physical observation. The
owner confirmed upright rotation 0 and observed a red/blue swap; this panel
requires LovyanGFX rgb_order=false. Successful initialization is not visual
verification.
