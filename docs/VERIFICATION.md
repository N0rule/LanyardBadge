# Verification record — 2026-10-27

## 2.3.2 release UX and revocation recovery

Implemented on `main`; CYD2USB firmware compiled and flashed through the guarded
uploader. Local application image: 1,668,128 bytes; static RAM: 73,720 bytes.

- Disconnected website: landing page with Connect and Install firmware. Editor
  hidden before paint; disconnect retains drafts for reconnect. Fresh/empty
  previews use neutral gray instead of generated sample artwork. Light surfaces
  are white, with independent device and website themes.
- Empty firmware collections start empty, without a built-in card. Existing
  saved artwork is preserved. A first successful editor connection can show a
  neutral empty screen until the first artwork upload.
- Submenu arrows return to their parent; only the main menu closes to artwork.
  Icon labels use content sizing and centered alignment. **The owner physically
  confirmed parent navigation, centered X and readable dark theme.**
- Device theme is saved in CRC-checked settings schema 4. Validated schema 3 and
  schema 2 records are migrated and retained. Both light and dark survived real
  restart tests; the original theme, artwork, calibration, other settings and BLE
  bond were restored and checked afterward.
- Release menus omit developer diagnostics. Benchmark commands are excluded
  unless `BADGE_DIAGNOSTICS=1`; serial status is retained for support/testing.
- Device Forget editors rotates application credentials and disconnects the
  editor while retaining the OS encryption bond. Revoked credentials were
  rejected over real BLE; the new four-letter code paired and three subsequent
  refreshes reconnected without another chooser/code or manually forgetting the
  OS device. No temporary test pairing agent was used for this check.
- **Twenty-three simulated-GATT Chromium tests pass**, including the landing state,
  neutral preview, white light mode, device theme control, bounded reconnect
  retries, interrupted-session isolation and legacy protocol compatibility.
  Host ASan/UBSan, codec, flash-policy and site-packaging checks pass.
- The exact same-page Forget editors flow passed on real BLE. Its reconnect
  initially stalled despite a successful encrypted write: the acknowledgement
  notification never arrived. Explicitly stopping/restarting notifications on
  same-page reconnect fixed the stale native subscription. The trace then showed
  the reset acknowledgement and old-credential rejection, with the OS bond,
  collection revision and settings unchanged. Browser session cancellation also
  rejects old in-flight/queued operations and replaces their queues; simulated
  native writes that never settle cannot block or disconnect the new session.

The first desktop reproduction exposed `No agent available` in BlueZ: a running
daemon alone was insufficient. Earlier headless tests used a temporary agent and
therefore missed this desktop failure. With the owner's approval, Noctalia was
restarted, its native agent registered, and an initial persistent OS bond was
established through that agent. Linux Chromium's first-time pairing support is
limited; the landing page now explains initial system pairing. This is distinct
from the badge's four-letter application code.

Another real reproduction paired successfully, then timed out after refreshing
during a saved-artwork download. Linux retained the physical BLE connection and
the badge retained the abandoned response. Protocol 2 adds an explicit encrypted
session reset and a fresh sequence before authentication. It aborts only temporary
uploads/old responses; committed artwork remains intact. Old asynchronous browser
operations cannot disconnect a newer session. The real saved-artwork case then
passed three consecutive refreshes.

Pre-update full snapshot: `backups/before-release-ux-4mb.bin`, 4,194,304 bytes,
SHA-256 `40e80e751efda4e12dbe62a3054a86f3fafee32c476a6d6c08cc3c18e2e1adaf`.
The authorized Noctalia restart also has a local configuration snapshot under
ignored `backups/noctalia-before-restart/`. No partition changes or erases occurred.

Local evidence is under ignored `test-results/`: `release-ux-host.log`,
`release-ux-browser.log`, `release-ux-upload.log`, `release-ux-theme-reboot.json`,
`release-ux-native-browser.log`, `release-ux-after-revoke.log` and
`short-code-browser.json`. The final linked-revocation evidence is in
`release-ux-revoke-trace.log` and `release-ux-revoke-linked.json`.
Physical touch latency, tearing, phone acceptance and
browser USB flashing retain the limitations listed in earlier records below.

## 2.3.1 connection and onboarding correction

Released source: `f6b5742cddc1` on `main`.
[Build, tests and Pages deployment passed](https://github.com/N0rule/LanyardBadge/actions/runs/40515826978).
The public firmware artifact is 1,667,792 bytes, SHA-256
`e562669a7bbfa7c8e0d29e26955a8fcd6c2f6e19a3b63c33ad2cfb6fd5d509e0`.
Its packaged hashes, compiled partition layout and fresh/update offsets were checked.

The owner reflashed from stock to test onboarding; this follow-up started with
an unprovisioned device, revision 0, default settings and no saved artwork.
The older artwork remains in the pre-work/release snapshots below. Before this
update, another full 4 MB snapshot was read successfully after USB was reseated:
`backups/before-short-code-4mb.bin`, SHA-256
`7287d07b2f8884eee93ea3b2292280dbe28075659192a0a6655478cb0f577f6a`.

- Firmware 2.3.1 compiled and flashed through the guarded PlatformIO uploader;
  final application image 1,667,792 bytes in the unchanged 2 MiB slot.
- Serial boot confirmed advertising, unprovisioned onboarding and optional
  calibration. Settings and revision 0 were retained.
- **Fourteen simulated-GATT Chromium tests passed**, including short-code entry,
  refresh reconnect without another chooser, optional remembering, forgetting
  without losing edits, revoked credentials and unavailable-device recovery.
- A real Chromium/BlueZ/ESP32 test with local frontend assets discovered the badge,
  accepted its four-letter code, remembered its strong credential and reconnected
  automatically after page refresh. Exactly one chooser was used; no second code
  or pairing dialog appeared. Forget badge cleared saved browser access.
- **The deployed public website passed the same real-radio test**, including
  three consecutive page refreshes with automatic reconnect, exactly one chooser
  and no second code entry. Forget badge also passed; revision 0 was unchanged.
- Real Bleak checks rejected short-code entry outside the connection screen (403),
  rejected five wrong guesses (401), enforced a 30-second cooldown (429) across
  disconnects, and accepted the lowercase correct code after cooldown. The strong
  credential was returned privately; no collection/settings mutation was needed.
- An immediate low-level notification subscription hit a GATT error before the
  encrypted read. Completing that read first allowed the test to pass; browser
  connection setup now follows that order and mocked GATT enforces it.
- The complete BLE name is now in the primary advertisement. Discovery accepts
  name or service independently and then validates GATT. A bounded watchdog
  restarts missing advertising while disconnected.
- The overflowing onboarding hint is explicitly split into two centered lines;
  a larger four-letter code replaces the long footer key. New physical fit/scan
  confirmation was requested. **The owner confirmed both the hint and code fit
  correctly.** QR scanning remains unconfirmed. The owner then requested the
  single-line centered heading “Lanyard Badge”, replacing “Welcome to LanyardBadge”.

Refreshing a page still closes its old GATT connection. The new page restores a
previously permitted device using `getDevices()` and authenticates with the saved
strong credential. Browsers without that capability offer explicit reconnect and
reuse the credential after device selection. Permission revocation, a changed
origin, or a stopped/crashing host Bluetooth service can still prevent connection.
Earlier host logs contain BlueZ 5.87 SIGSEGV crashes; a later real BLE scan saw the
badge at RSSI -44. These changes do not claim to fix the host daemon itself.

Local evidence: `short-code-status.log`, `short-code-upload.log`,
`short-code-heading-upload.log`, `short-code-browser.json`,
`short-code-browser-public.json`, `short-code-security.json`,
`reconnect-host-tests.log` and `reconnect-browser-tests.log` under ignored
`test-results/`.

## 2.3.0 baseline release

Implementation release: `6e94619e959a` on `rewrite/lanyardbadge-2`.
[CI build, tests and Pages deployment passed](https://github.com/N0rule/LanyardBadge/actions/runs/40491527790).

The requested [GitHub Pages URL](https://n0rule.github.io/LanyardBadge/) redirects
to the account's existing [HTTPS custom domain](https://n0rule.is-a.dev/LanyardBadge/).
Both the live application and published firmware manifests were checked. Script,
stylesheet and installer-manifest URLs include the release revision to avoid
mixing cached transport code with a fresh page.

| Item | Verified result |
| --- | --- |
| Hardware | ESP32-D0WD-V3 rev 3.1, 4 MB flash, zero PSRAM |
| Display configuration | ST7789, portrait 240 × 320, rotation 0, 40 MHz SPI |
| Firmware | 2.3.0, CYD2USB environment |
| Published application | 1,661,168 / 2,097,152 bytes; 435,984 bytes headroom |
| Static RAM | 73,688 / 327,680 bytes (22.5%) |
| Published SHA-256 | `c7195b3916cde9a56e290e4443b7858211da6a9ba0515cb512e17f57872f2fb1` |
| Final collection | Two original cards; selected `ee53bab5`; revision 21 |
| Current saved settings | Brightness 5%, timeout 600s, slideshow on / 60s, rotation 0, saved calibration |

That **exact published application** was downloaded, checked against published
SHA256SUMS, flashed at 0x10000 with esptool, hash-verified and booted on the device.
The local build differs in embedded source paths, build time and associated
ELF/image hashes; cross-host byte-identical builds are not claimed.

The released firmware then passed a real public-site browser test: an intentionally
stale QR key was rejected, manual pairing succeeded, the real collection was read,
and the fragment was removed from browser history. The collection's rollback
generation was normalized to the original two cards and two unreferenced test
artwork files were collected. Current and backup manifests contain no test cards.

## Measured firmware performance

The live baseline was 2.1.0; the starting source at `042c684` already contained an
unfinished 2.2.0 BLE rewrite. Origin was fetched before inspection.

A controlled instrumented build rendered the same two saved artwork cards through
both paths, ten alternating draws per path:

| Path | Mean complete redraw | Maximum | Heap before / after |
| --- | ---: | ---: | ---: |
| LVGL BMP decoder + SPI | 747.734 ms | 804.889 ms | 109684 / 109684 |
| Validated BMP stripe streaming | 188.515 ms | 192.260 ms | 109684 / 109684 |

Streaming was approximately **4× faster** in this run (3.5× in an earlier run).
These timings include filesystem reads, row reversal, drawing and object cleanup,
not just SPI transfer. Ordinary single-card loads measured about 159–161 ms;
the released image's startup load measured 160.754 ms.

- Full Display menu construction/redraw: **202.675 ms**.
- Ten in-place brightness label updates: mean **36.038 ms**, maximum 36.079 ms.
- Fifty card switches: free heap stayed at 108592 bytes and largest block at
  61428 bytes. Minimum heap reached 99472; loop stack low-water mark was 2032 bytes.
- A two-second static-artwork check observed no additional LVGL flushes.
- The published image booted with 108632 bytes free heap, 61428-byte largest block,
  104300-byte minimum heap and 5060 bytes of loop stack remaining at that point.

These are software timings, **not measured physical touch latency**. Full-page
menu entry remains above the approximate 100 ms goal; ordinary setting updates
are below it. Original serial command/status round trips took 493–889 ms and
included UART/JSON overhead, so they are not frame-rate measurements.

There is no TE signal in the verified pin mapping. Synchronous writes and a
single 15,360-byte stripe buffer keep ownership explicit, without a full-screen
framebuffer or animations. Software double buffering is not described as a
tear-free guarantee. Physical tearing remains an observer check.

## Real Bluetooth and public browser tests

The owner enabled the initially stopped host Bluetooth service. Real tests used
the host adapter, BlueZ and the connected ESP32; this was not a simulated radio.

| Test | Observed result |
| --- | --- |
| Bleak client, initial complete asset upload | 38.562 seconds, MTU 517, upload/download byte comparison passed |
| Bleak end-to-end card transaction before interval optimization | 43.388 seconds; metadata commit, selection and restoration passed |
| Bleak after requesting 7.5–15 ms events | Negotiated 15 ms; complete upload 17.730 seconds |
| Public Chromium editor before interval optimization | Upload/commit/select 44.924 seconds |
| Public Chromium editor with faster firmware | Upload/commit/select 24.248 seconds; original collection restored |
| Latest released image + public Chromium | Stale-key rejection, manual re-pair, real collection reads and cleanup passed |

Complete artwork transfers contained 153666 bytes. Real-client tests compared
uploaded and downloaded bytes, intentionally interrupted another upload,
reconnected, re-paired and confirmed the committed collection survived. Temporary
card commits/restores advanced metadata from revision 12 to 20; final cleanup
advanced it to 21 without changing original card content. Timing depends on the
central, RF environment and negotiated interval; these are not universal rates.

Real testing found and fixed:

- A missing advertising name: enable scan response before adding the device name.
- Overlapping browser GATT write promises: serialize response ACKs separately from
  application requests, and attach rejection handlers immediately.
- A 15-second total download timeout: refresh it on received chunks so it measures
  inactivity rather than total card-transfer duration.
- Re-pairing and expired-session UX: keep original artwork/edits and expose a
  readable device key; API 401 failures disconnect clearly before retry.

Earlier host `bluetoothd` SIGSEGV crashes were recorded by systemd-coredump during
pairing experiments. Clearing this badge's stale host pairing record, retaining
BLE bonds and starting security on connect were followed by successful tests.
Linux configurations still need working Web Bluetooth support, a Bluetooth daemon
and a pairing agent; success is not claimed for every Linux or phone browser.

## Automated checks

- Portable C++ tests pass under ASan/UBSan: affine calibration, rotation/clamping,
  gestures, strict BMP validation, IDs, CRC, reverse-row caching, timeout choices,
  busy protection, wraparound and complete wake-press consumption.
- Node codec/transform tests pass: RGB565 channel error bounds, row order, malformed
  image handling, fit/fill, four-rotation identity and movement bounds.
- **Ten Chromium tests with simulated GATT** pass: themes and persistence/system
  changes, artwork color preservation, responsive sizing, symmetric frame,
  rotation/reset/precision, mouse and trusted CDP touch dragging, keyboard controls,
  export/preview consistency, delayed write completion, long response inactivity,
  failed-commit retry, settings/reconnect, final-card deletion, stale-key re-pair
  and expired-session recovery without losing edits. These do not establish RF.
- Flash-policy tests reject OTA-stub, NVS/PHY/filesystem and boundary-crossing
  writes, unaligned addresses and filesystem relocation.
- Packaging checks validate published files, SHA-256 sums, compiled partition
  layout and fresh/update manifest offsets. CI runs these checks before deployment.

## Data preservation and uploader correction

The two pre-work snapshots remain Git-ignored and unchanged. A third snapshot
captures the released firmware and restored collection:

| Backup | Bytes | SHA-256 |
| --- | ---: | --- |
| `backups/original-4mb.bin` | 4194304 | `956a9c43930050d855d5ebbd9b26c6c5f7d8d5c48cdcb8e93be99d98e832a3c4` |
| `backups/before-2.0-spec-4mb.bin` | 4194304 | `24de5de01f381841d0f054dc64458d340f5cd9452a3ec6ce15ee330022b53061` |
| `backups/release-6e94619-4mb.bin` | 4194304 | `128b76ba3db7790b58d008885fcdd105b82528af99e5c27621d612defa6e83f2` |

The additional snapshot initially could not start because the CH341 USB link
stopped enumerating (`-71` control errors and `-110` descriptor timeouts). After
the owner reseated the cable, `/dev/ttyUSB0` returned and a complete read succeeded.
Its application bytes exactly match the published binary. The new snapshot has
mode 0600 and remains local because it contains device credentials and user data.
Afterward, serial diagnostics confirmed a normal 2.3.0 boot with two cards,
revision 21 and the same saved brightness, timeout, slideshow and calibration.

The pre-work flash table showed factory 0x10000/0x200000 and assets
0x210000/0x1f0000. Starting source instead placed assets at 0x290000; uploading it
would overwrite artwork. Removing HTTP/Wi-Fi and embedded web/sample data let
firmware fit the existing 2 MiB application slot. No filesystem image, full-flash
erase or partition relocation was performed. Version-2 settings remain in NVS;
schema 3 uses a separate key. Original active artwork and calibration were retained.

A later audit found Arduino's stock PlatformIO uploader also included
`boot_app0.bin` at 0xe000 for 8192 bytes, overlapping the last NVS sector and PHY
partition in this factory-only layout. The extra image should have been checked
before the first upload. Earlier uploads retained that stock recipe; no validated
card/settings loss was observed and full backups exist, but it was unsafe.

`scripts/check_firmware.py` now strips that stub before upload, validates
sector-rounded write ranges and checks the compiled table. Guarded hardware
uploads contain only bootloader at 0x1000, partitions at 0x8000 and application at
0x10000. USB update manifests contain only the application. They never included
the OTA stub. Garbage collection preserves current and backup manifest references;
full pre-work snapshots also retain the older filesystem history.

## Limits and remaining physical acceptance

- **Browser USB flashing is unverified.** The pinned, vendored ESP Web Tools loaded
  and displayed real port-selection handling, but this headless runner could not
  select the physical Web Serial port. Firmware was flashed using PlatformIO and
  esptool instead. Manifest/image validation passed.
- No new physical visual confirmation was supplied. Earlier development recorded
  owner-confirmed upright rotation 0; this session does not claim visual rechecks
  of colors, QR scanning, default all-corner touch accuracy, gestures, brightness,
  true backlight-off, wake-touch consumption or tearing.
- Serial sleep/wake and restart state checks passed; they cannot observe the
  physical backlight or a finger touching the screen.
- Fresh boot on a completely blank device, NVS-failure injection, deliberate power
  cuts/corrupt-storage recovery, extended soak and real phone acceptance remain
  unverified. Populated storage was preserved rather than erased for these tests.
- NVS-open failure generates RAM-only recovery credentials, and missing pairing
  keys fail closed. This path was reviewed/compiled, not fault-injected.
- ILI9341 compatibility remains a separate build target; only CYD2USB/ST7789 was
  connected in this session.

Use [the physical checklist](HARDWARE_CHECKLIST.md). Detailed local evidence is
in the ignored `test-results/` directory, including `final-hardware-benchmarks.json`,
`ble-end-to-end.json`, `ble-fast-link.json`, `browser-upload-real-final.log`,
`browser-repair-real.json`, `release-cleanup.json`, `released-6e94619-upload.log`
and `released-6e94619-status.log`. The final backup and subsequent boot are recorded
in `released-6e94619-backup.log` and `released-6e94619-after-backup-status.log`.
Credentials are not printed in these reports.
