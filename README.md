# LanyardBadge

Artwork you can wear. Turn a USB-powered ESP32 touchscreen into a personal artwork badge.

Open the [editor](https://n0rule.is-a.dev/LanyardBadge/) to install firmware, connect,
and upload still images or animated GIF cards.

## Hardware

The primary target is CYD2USB: classic ESP32, 4 MB flash, no PSRAM, a 240 × 320
ST7789 display and XPT2046 resistive touchscreen. USB connectors are at the bottom.
The CH340/CH341 adapter provides USB serial communication. The badge needs USB
power; it has no battery. Wiring and display orientation are defined in
[Board.h](include/Board.h).

## Install and connect

Use Chrome or Edge on a desktop computer and a USB data cable. Open the editor,
choose **Install firmware**, then choose a new installation or an application-only
update. Close serial monitors and other badge tabs first. Updates preserve cards,
settings and the board's touch mapping when using the supported flash layout.

For USB editing, choose **Connect badge → Connect via USB** and grant the browser
permission to use the USB serial port. Previously authorized ports can reconnect
automatically. The badge identifies itself before the editor opens.

For Bluetooth, open the website on your computer and choose Bluetooth. Four
letters appear automatically on the badge. Enter them on the website; do not
pair through Windows Settings. The code lasts two minutes and authorizes only
that connection. Five incorrect attempts cause a 30-second lockout. USB needs no code.

The editor requires firmware 3.1.0 / Bluetooth protocol 4. Update over USB first.
During this upgrade the badge adopts a new radio identity to avoid stale Windows
bonds. Choose it from the website once; old Windows entries can be left alone.
Future resets retain this public identity and create no OS bonds. Browser permission
to access a device is separate from OS pairing. No access code is saved by the site.

This is basic access control, not encrypted transport. Artwork and codes can be
observed by a nearby active Bluetooth monitor. This is an intentional product tradeoff.

## Make a card

Choose artwork, then drag, rotate, zoom or use fit/fill to position it inside the
physical badge preview. **Upload card** saves it; **Show this card** selects it on
the badge. Add, rename, reorder or delete cards from the collection. The badge
supports up to ten cards.

GIF files are prepared in the browser for bounded-memory animation playback.
Use the animation controls to preview motion. The device supports animations up
to 1 MiB; large source GIFs may need fewer frames or a smaller crop. Transfers show
actual progress. Canceling or losing a connection keeps the original draft in the
current tab. Keep that tab open until your work is uploaded.

## Settings

**Device settings** controls brightness, screen timeout, slideshow and display
theme. Website light/dark/system theme is independent of the device theme.
Device names accept 1–24 printable ASCII characters, without leading or trailing
spaces. Names persist across firmware updates. The badge's settings menu shows
the name directly; change it from the website.

Use **Settings → Disconnect editor** to end a Bluetooth editing session.
Reconnecting requires a new code. Artwork and settings stay saved.

**Factory reset** is available in the badge settings and in the website's
**Device settings → Advanced** section. It deletes artwork, settings, names and
Bluetooth bonds. The website first asks for confirmation; the badge then requires
you to tap **Erase everything** on its touchscreen. Tap **Cancel** to cancel,
or allow the confirmation screen to expire. Firmware and the bootloader remain.
An interrupted reset resumes at the next boot.

## Compatibility and troubleshooting

- Desktop Chrome/Edge with Web Serial: USB editing and installation.
- Supported desktop/Android Chromium browsers with Web Bluetooth: wireless editing.
- iOS Safari does not provide the required Web Bluetooth or Web Serial APIs.
- Browser permissions require HTTPS (or localhost for development). USB permission
  is never granted automatically on a first visit.
- Linux: check serial-device access and close programs using `/dev/ttyUSB0`.
- Windows: use a data cable and ensure the CH340 driver is installed.
- Connection lost: reconnect from the same tab; drafts stay associated with the
  stable badge identity, even when switching USB/Bluetooth or changing its name.
- Storage full: clean unused artwork from Advanced settings, or delete a card you
  no longer need. The cleanup preserves assets referenced by the recovery manifest.
- The existing touch mapping is preserved. No device workflow requires a physical button.

## Development

```sh
pio run -e cyd2usb
bash scripts/test-host.sh
cd tests
npm ci
npx playwright install chromium
npm test
```

The firmware version is centralized in [Version.h](include/Version.h). Build and
package with `python3 scripts/package_site.py`, then validate with
`python3 scripts/validate_site.py test-results/site`. Packaging checks the actual
partition layout and firmware hashes. No filesystem image is flashed by updates.

`scripts/device.py status` and `scripts/device.py cards` provide bounded USB
support diagnostics without the old arbitrary serial-command interpreter.
See [3.0.0 release verification](docs/RELEASE-3.0.0.md), [USB protocol](docs/USB-PROTOCOL.md), [release work record](docs/RELEASE-PLAN.md)
and [hardware checklist](docs/HARDWARE_CHECKLIST.md) for implementation and
verification boundaries. A successful mock test is not evidence of a hardware test.

Dependency licenses remain with the vendored installer and font assets.
