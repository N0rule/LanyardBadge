# Hardware acceptance checklist

Compilation, serial logs, browser mocks and physical observations are different
forms of evidence. Mark a physical check only after observing the actual board.
The owner has now inserted a 2 GB SD card; firmware does not mount it. Repeat
final acceptance without the card as well. Keep the USB connectors at the
bottom.

## Bring-up

- [x] Read full flash before migration and record SHA-256.
- [x] Serial tool identified ESP32-D0WD-V3 revision 3.1 and 4 MB flash.
- [x] First LVGL foundation initialized the display at 240 × 320; runtime
      PSRAM=0.
- [x] Owner observed upright text with USB down, confirming rotation 0.
- [x] Owner observed blue/green/red/white instead of red/green/blue/white. The
      brown background also matched a red/blue swap. Corrected LovyanGFX
      `rgb_order` from true to false; inversion remains off.
- [ ] On the corrected firmware, open `diag`. Swatches must be red, green, blue,
      white. The test background is light, text dark. White must not become
      black.
- [ ] Unplug/replug USB: boot into the selected card, no random pixels or reset
      loop.

## Touch and controls

- [ ] Run `calibrate`; hold each crosshair, lift between all four targets.
- [ ] The fourth target is accepted; serial reports calibration validated/saved.
- [ ] In `diag`, touch near all four corners and center. Blue dot follows within
      roughly 10–15 pixels. Test again after flipping portrait twice.
- [ ] Tap each half of the badge to switch; fast noise does not create extra
      taps.
- [ ] Swipes left/right switch once; vertical motions do not change cards.
- [ ] Hold 750 ms to open menu. Releasing does not activate an unintended
      button.
- [ ] Menu scrolls; all controls fit the case opening and respond to a firm
      touch.
- [ ] Brightness steps are visible, stay readable at 5%, and persist after two
      seconds.
- [ ] Hold BOOT two seconds: setup opens even with no touch calibration.

## Browser to physical badge

- [ ] Join the WPA2 AP with the screen password. Open 192.168.4.1, pair, then
      disconnect internet access. Editor, fonts and QR generation still work.
- [ ] Upload a small PNG, a large ordinary JPEG, a transparent PNG, and a wide
      image in fit and fill modes. Compare portrait crop with the physical TFT.
- [ ] Profile avatar is circular; name, description and URL persist after
      restart.
- [ ] Scan a short URL and a 100-byte URL with a phone at multiple brightness
      levels.
- [ ] Custom text/shape coordinates and QR layering match the preview sensibly.
- [ ] Reorder/delete cards and save. Touch and slideshow follow the new order.
- [ ] Set a five-second slideshow; watch 100 switches with `status`
      before/after.
- [ ] Reopen setup after closing it; saved content and pairing credentials
      remain.
- [ ] Leave setup idle for 15 minutes: AP and HTTP server stop, badge keeps
      rendering.

## Recovery and stress

Back up the current device before deliberate power-cut or corruption
experiments. The firmware's optional selftest already exercises non-destructive
API failures.

- [ ] Use invalid MIME/type, truncated BMP, wrong dimensions and an oversized
      body. Existing cards remain selected and unchanged; no partial file is
      selectable.
- [ ] Disconnect the browser/AP halfway through an image upload. Reconnect and
      retry. Existing content survives; cleanup removes the abandoned temporary
      file.
- [ ] Fill ten slots with different backgrounds. Replace a single background.
      Continue until the free-space guard returns 507. Delete an unused card and
      save, then save again/clean orphans as the previous manifest generation
      retires.
- [ ] Pull power during upload: old deck loads. Pull power during metadata
      commit: either the old or fully committed new deck loads, not a partial
      collection.
- [ ] With a backup, damage `/cards.json`; verify `/cards.bak` is recovered.
      With both invalid, built-in cards must load without auto-formatting the
      filesystem.
- [ ] Save station credentials, interrupt that Wi-Fi network, then restore it.
      Reconnection should occur within 30 seconds without freezing normal touch
      input.
- [ ] Inspect heap, minimum heap, largest block and LVGL used/max-used counters
      during repeated screen changes and uploads. After warming caches, no
      continuous decline or reset should appear. Include at least a one-hour
      real-use soak.
- [ ] Repeat a USB firmware upload with the same partition layout. Cards,
      network credentials, calibration and manual selection survive.

No assertion is made about untested ILI9341 hardware, SD coexistence, battery,
NFC, Bluetooth, deep sleep, native USB, TLS, OTA, or operation without power.
