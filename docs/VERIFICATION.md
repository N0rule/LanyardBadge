# Verification record — 2026-10-27

Target: the connected `/dev/ttyUSB0` ESP32-D0WD-V3 rev 3.1, 4 MB flash,
zero PSRAM, ST7789 portrait 240 × 320. Source inspected after fetching origin;
starting commit `042c684`, branch `rewrite/lanyardbadge-2`. The live device ran
2.1.0 while source already contained an incomplete 2.2.0 BLE rewrite.

## Data preservation

Original backup `backups/original-4mb.bin` remains untouched. Its recorded SHA-256
is `956a9c43930050d855d5ebbd9b26c6c5f7d8d5c48cdcb8e93be99d98e832a3c4`.

A new full 4,194,304-byte snapshot was taken before this work:
`backups/before-2.0-spec-4mb.bin`, SHA-256
`24de5de01f381841d0f054dc64458d340f5cd9452a3ec6ce15ee330022b53061`.
Backups and private test credentials remain Git-ignored.

The live partition table was read from that snapshot: factory 0x10000/0x200000,
assets 0x210000/0x1f0000. Source initially specified factory 0x280000 and assets
0x290000, which would have overwritten user artwork. The original live layout
was restored in source before any upload. Removing HTTP/Wi-Fi and embedded web
assets reduced firmware enough to fit safely. No filesystem image, NVS image,
full-flash erase or partition relocation was performed.

The first rewritten boot retained both cards, revision 12, selected card
`ee53bab5`, brightness 5%, slideshow enabled/60 seconds, rotation 0 and the saved
four-corner calibration. Settings migrated to schema 3 while the v2 blob stayed
intact. Repeated normal reboots retained those values.

## Measured performance

Baseline live 2.1.0 serial screen/card commands took 493–889 ms including UART
command parsing and a full status JSON response. These numbers are not touch
latency or a frame rate.

A controlled on-device benchmark then rendered the same two saved artwork cards
through both paths in the same instrumented binary, ten draws per path:

| Path | Mean complete redraw | Maximum | Heap before/after |
| --- | ---: | ---: | ---: |
| LVGL BMP decoder + synchronous SPI | 747.734 ms | 804.889 ms | 109684 / 109684 |
| Direct validated BMP stripe stream | 188.515 ms | 192.260 ms | 109684 / 109684 |

The streaming path was approximately 4.0× faster in the final run (3.5× in the earlier run). Normal single-card loads outside
the alternating benchmark measured around 159–161 ms. LVGL's ten benchmark draws
spent 526.443 ms total in SPI flush callbacks; most of its remaining time was
outside SPI transfer, supporting bypassing row-decoder/filesystem overhead.
The streaming benchmark includes filesystem reads, row reversal, SPI and object
cleanup, not merely transfer time.

A 50-switch hardware run kept free heap at 108592 bytes and largest free block
at 61428 before/after. Minimum heap reached 99472; loop stack low-water mark was
2032 bytes after rendering tests. A two-second idle check observed no additional
LVGL flushes for unchanged artwork. Serial sleep/wake tests reported physical PWM
sleep state without altering the saved brightness. Restart retained settings and
selection. These checks establish software state; backlight darkness and touch
consumption need physical observation.

A full Display menu construction/redraw measured 202.675 ms. Ten in-place
brightness label updates averaged 36.038 ms (maximum 36.079 ms). These are
software draw measurements, not physical touch latency. Full-page entry remains
slower than the approximate 100 ms goal; ordinary setting changes are within it.

No TE signal is present in the verified pin mapping. The implementation does not
claim tear-free output. Static redraws are eliminated, menus avoid transitions,
and artwork scanout is substantially shorter. Physical tearing and actual touch
response remain observer checks.

## Build and automated checks

- CYD2USB firmware compiles and has been flashed repeatedly; esptool verified
  written hashes. The final padded size and SHA-256 are recorded below.
- Portable C++ tests pass under ASan/UBSan: calibration, clamping, gestures,
  strict BMP validation, ID/CRC checks, reverse-row caching, timeout choices,
  busy protection, wraparound and complete wake-press consumption.
- Node codec/transform tests pass: RGB565 channel error, row order, malformed
  image handling, fit/fill, four-rotation identity and crop bounds across rotation,
  zoom and position extremes.
- Eight Chromium tests pass using a **simulated GATT peripheral**: secure-origin
  subpath assets, themes and artwork color preservation, theme persistence/system
  changes, rotation/reset/precision, mouse drag, trusted CDP touch drag without
  page scrolling, keyboard controls, symmetric frame, upload/export pixel bounds,
  metadata failure retry without reupload, settings, reconnect, unsupported
  browser guidance and deleting the final saved card.
- Installer packaging checks validate app/partition bounds, manifest part offsets,
  published files and SHA-256 hashes. ESP Web Tools is pinned and vendored; update
  manifests contain only the application. A full browser USB flash has not yet
  been exercised.

## Real Bluetooth evidence

The host Bluetooth service was initially stopped. The owner enabled it. BlueZ
5.87 and the actual host adapter discovered the badge at approximately −39 dBm.
This found and fixed an advertising bug: the 128-bit service UUID and device name
did not fit a single advertising packet; the name now uses a scan response.

A real Bleak/BlueZ client established encrypted GATT, authenticated using the
per-device key, read status/cards, downloaded a saved artwork, uploaded all
153666 bytes, downloaded the new asset, and compared every byte successfully.
Upload time: **38.562 seconds**, MTU 517. Existing card metadata stayed at revision
12 and the two-card collection remained intact. The unreferenced test image was
collected and the connection closed. Heap was 107804 before and 106076 immediately
after the transfer; these snapshots include active BLE response allocations and
are not a leak test. Log: ignored `test-results/ble-hardware.json`.

Real Chromium's device chooser also discovered `Badge-287E`. Further real browser
and reconnect testing exposed host `bluetoothd` SIGSEGV crashes (recorded by
systemd-coredump); simulated browser success does not establish real browser
connection success. A subsequent firmware adjustment retains BLE bonding keys
and starts link security on connect to improve reconnect behavior. Its final
validation is recorded below; this host limitation must not be hidden.

## Remaining acceptance

No new physical visual confirmation has been received in this session. Upright
orientation was confirmed by the owner in earlier development, not re-observed
here. Colors, QR scanning, all-corner default touch accuracy, perceived menu
latency, physical backlight-off, waking-touch consumption and tearing remain in
[the physical checklist](HARDWARE_CHECKLIST.md). Actual first boot on a completely
blank device, deliberate power cuts, corrupt-storage recovery and an extended
radio/heap soak remain unverified. Existing data was preserved rather than erased
to manufacture a fresh-install test.

## Final firmware and end-to-end radio run

Final local CYD2USB binary: **1662848 bytes** of 2097152 (434304 bytes headroom).
SHA-256: `df8bb9b3db88483c2ce80888a539815f8533713072481d25e9658246b7d889f9`.
Static RAM remains 73760 bytes (22.5%). Final firmware was flashed and hash-verified.

After retaining BLE bonds and clearing this badge's stale host pairing record,
a fresh real Bleak run passed pairing, full upload/download comparison, an atomic
temporary-card metadata commit, selection, restoration of the original collection
and selection, an intentionally disconnected partial upload, reconnect, re-pair
and confirmation that the committed collection survived. The complete upload took
43.388 seconds. Metadata revision advanced from 12 to 14 during the test/restore;
the original two cards were retained. Minimum heap during this test reached 92028
bytes. See ignored `test-results/ble-end-to-end.json`.

Real Chromium then connected successfully through the actual editor's chooser,
GATT discovery, encrypted pairing, authentication and collection reads, reporting
two cards at revision 14. This was a real radio connection, not the GATT simulation.
Earlier BlueZ daemon crashes remain relevant: Linux configurations may need their
stale badge pairing removed and a functioning desktop pairing agent.

GitHub Actions build and Pages deploy passed for commit `856b38a`. The requested
`https://n0rule.github.io/LanyardBadge/` returns a 301 to this account's existing
custom domain `https://n0rule.is-a.dev/LanyardBadge/`, which returns HTTP 200.
HTTPS enforcement is enabled. Published `firmware/update.json` contains only the
application at offset 65536 and the per-commit firmware path.

## Real Chromium upload and final transport fixes

The real editor test discovered two browser-specific failures that the original
simulation did not model: overlapping GATT ACK/write promises, and a 15-second
total-response timeout that interrupted a progressing full-card download. All
GATT writes now have their own serialized queue, and the response timeout resets
on received chunks. Promise handlers are attached immediately so stalled writes
cannot leave unhandled timeout rejections. The simulated peripheral now delivers
notifications before delayed write completion and rejects overlapping writes;
an accelerated-clock test exercises a response lasting over 15 seconds.

The corrected transport was served into the already published editor for the
hardware test. Real Chromium then loaded the collection, uploaded the supplied
`ExampleImage.png` through the editor, committed its metadata, selected the new
card, and restored the original two cards and selection. Upload/commit/select
completed in **44.924 seconds**. Revision advanced from 14 to 16 through the test
and restoration. The corrected transport is published by the subsequent workflow;
its served bytes are checked against the tested source. Screenshot and report:
ignored `test-results/editor-desktop-real.png` and `browser-upload-real.json`.

The QR now has a separate white parent with a guaranteed 16-pixel quiet margin
around a 164-pixel code, rather than a border that could overlap its modules.
Physical scanning remains pending. Runtime key revocation uses RF-provided
entropy rather than enabling the boot-only entropy source while BLE is active,
following the ESP-IDF header's ADC/RF exclusion requirement.

The USB installer loaded and displayed real browser compatibility/port-selection
handling. This headless Chromium runner could not select the real Web Serial
port (it returned No port selected), so **browser USB flashing is not claimed**.
The final firmware was instead uploaded and hash-verified with PlatformIO/esptool.
Fresh-install/update manifest offsets and bounds passed automated validation.

Final reboot after the last PlatformIO upload reports both original cards at
revision 16, selected `ee53bab5`, brightness 5%, slideshow on/60 seconds, timeout
120 seconds, rotation 0, saved calibration and provisioned state. Heap is 108592
bytes, largest block 61428, zero PSRAM. The last changes add an isolated QR quiet
zone, avoid boot entropy configuration during BLE key revocation, and keep editor
connection/save labels aligned with actual state. USB installer dialog colors
inherit the chosen theme. Packaged script/style URLs include the deployed commit
so a cached older transport cannot be mixed with a fresh page.
