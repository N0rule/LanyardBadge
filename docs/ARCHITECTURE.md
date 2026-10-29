# LanyardBadge 3 architecture

## Hardware and display

Classic ESP32-D0WD-V3, 4 MB flash, no PSRAM; CYD2USB ST7789 in portrait
240 × 320 with USB down. LovyanGFX owns SPI2 and XPT2046 owns SPI3 on the
established pins. Display SPI remains 40 MHz. There is no verified TE input;
software buffering alone does not guarantee tear-free transitions.

One 15,360-byte stripe buffer serves still and animated artwork. BMPs stream
bottom-up RGB565 rows; LBA animation decodes into alternating halves while DMA
transmits the previous half. No full-screen framebuffer is allocated. Static
artwork is not continuously redrawn. LVGL owns menus, onboarding, progress and
internal touch recovery; direct artwork rendering suspends LVGL invalidation.

Touch gestures use the preserved calibration or established factory mapping.
No hardware buttons are polled. Ordinary settings expose no calibration wizard. Sleep sets backlight
PWM to zero without changing saved brightness, suspends rendering, and consumes
the first waking press. Slideshow restarts its interval after wake.

## Storage and migration

| Region | Offset | Size |
| --- | --- | --- |
| NVS | 0x9000 | 24 KiB |
| PHY | 0xf000 | 4 KiB |
| Application | 0x10000 | 2 MiB |
| LittleFS assets | 0x210000 | 1,984 KiB |

Normal updates write the application only. Flash guards validate the compiled
partition table and sector-rounded writes, excluding the unused Arduino
boot_app0 image that would overlap this board's NVS/PHY layout.

Settings versions 2/3/4 migrate to version 5 with brightness, rotation, timeout,
theme, slideshow, selection and touch mapping retained. Retired Wi-Fi and
ownership fields exist only in migration structs and old NVS blobs; the active
settings and API do not use them. Device names are independent NVS strings.
The public random cache epoch changes after factory reset.

Artwork uploads are validated before becoming immutable files. Deck commits
check revisions and references, write a CRC-protected temporary manifest, then
rotate current/backup generations. Garbage collection preserves both generations.
An interrupted upload never becomes a committed card. Fresh blank partitions
start empty; existing unrecognized storage is never automatically formatted.

Only image/GIF artwork cards are supported. Profile/custom manifests are detected
before loading and kept intact. A reset-required message replaces their obsolete
renderer. Upload, commit and garbage collection are blocked until an acknowledged
factory reset. Empty version-2 compatibility fields let current artwork browser
workspaces survive the upgrade.

## Connections

`Transfer` implements bounded, stop-and-wait operation packets. BLE and serial
share this engine and the transport-neutral `Network` API. Exclusive ownership
prevents simultaneous transports from corrupting a transaction. Disconnect aborts
temporary writes and releases the session. Partial transfers expire after 15 seconds.

BLE protocol 4 uses unpaired characteristics with a temporary four-letter
application code. Codes expire after two minutes, authorize one connection only,
and are rate-limited across reconnects. No native pairing or encryption is requested.
The one-time migration to a persisted random-static address avoids older Windows
bonds. The public address lives in badge-radio and survives factory reset; it is
not an authorization credential. Stable chip IDs still identify browser workspaces.

USB uses 115200-baud CH340 UART, CRC-protected bounded SLIP frames, a versioned
handshake and short API sessions. Physical access plus browser serial permission
authorizes editing. A 30-second lease, refreshed by ten-second browser heartbeats,
releases abandoned USB sessions. Serial logging is suppressed during editing.
See [API](API.md) and [USB framing](USB-PROTOCOL.md).

Browser transports share request serialization, validation, upload and cancellation.
Workspaces are keyed by stable chip identity; renaming or switching transports
preserves drafts. IndexedDB snapshots use the public cache epoch to reject stale
post-reset content. Old remembered ownership secrets are discarded during browser
migration. Installer handoff closes editing first and restores the connection on
return. USB and BLE permission dialogs remain browser/OS controlled.

## Factory reset

A remote reset request opens physical confirmation; it does not erase data.
The badge requires an explicit Erase everything tap on its confirmation screen. A journal in
`badge-reset` is written before reboot. Before starting UI/transports, reset
removes BLE bonds, formats only the assets partition, and clears `badge-v2`.
The journal is removed only after all steps succeed. Interrupted/failed resets
retry at boot; unreadable journal state fails closed. Firmware and bootloader
survive. Browser reset UI warns about drafts and invalidates remembered state.

## Delivery

Version is centralized in `include/Version.h`. Packaging adds the source commit,
versioned JS/CSS URLs, fresh/update manifests, firmware files and SHA256SUMS.
CI runs host and browser checks, builds, validates packaging and deploys Pages.
See [release verification](RELEASE-3.0.0.md) for measured results and limits.
