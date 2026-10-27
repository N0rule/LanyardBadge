# Verification record

Date: 2026-10-27, Linux / PlatformIO CLI, `/dev/ttyUSB0`.

This record distinguishes observed hardware behavior from compilation and
simulated browser behavior. It is updated with final device measurements before
handoff.

## Preserved original

- Branch: `rewrite/lanyardbadge-2`; original commits retained.
- Full flash backup: `backups/original-4mb.bin`, exactly 4194304 bytes.
- SHA-256: `956a9c43930050d855d5ebbd9b26c6c5f7d8d5c48cdcb8e93be99d98e832a3c4`.
- The supplied `ExampleImage.png` is untouched. A compressed, quantized RGB565
  derivative is bundled as optional sample content.

## Evidence obtained

- esptool read the connected ESP32-D0WD-V3, silicon 3.1, 40 MHz crystal and full
  4 MB flash. Arduino runtime independently reports 4 MB and zero PSRAM.
- Foundation display initialization succeeded at 240 × 320.
- Owner confirmed portrait rotation 0 is upright with USB down.
- Owner observed swapped red/blue and a brown instead of blue foundation
  background. LovyanGFX `rgb_order=false` corrects the controller flag;
  inversion remains off. A visual recheck of that correction is pending.
- The integrated firmware boots, creates the LVGL profile and responds to serial
  diagnostics. The final 48 KiB LVGL pool leaves approximately 176 KB free heap
  before Wi-Fi; LVGL profile usage is approximately 6.5 KB.
- The unmounted new asset partition was detected without auto-formatting.
- Explicit provisioning installed three cards, including the supplied
  illustration. An inflater stack overflow found during bring-up was fixed by
  keeping decoder state and the 32 KiB dictionary on heap, not Arduino's loop
  stack.
- 32 real HTTP checks passed through the ESP32's localhost TCP stack: pairing,
  authentication, complete image upload/download with byte comparison, invalid
  files/settings/IDs, stale revision rejection, transactional saves, interrupted
  upload recovery, cleanup and static editor serving.
- A 100-switch native render test kept free heap at 173932 bytes before and
  after; largest free block remained 61428 bytes. Menu and diagnostic screens
  rendered, and selection, card count/revision, rotation and brightness survived
  restart. The test acknowledges each serial command rather than flooding the
  UART buffer.
- The owner inserted a 2 GB SD card, reportedly FAT32. The firmware continues
  without mounting or using it. Initial bring-up also worked without a card.

## Host checks

`scripts/test-host.sh` passes under AddressSanitizer and
UndefinedBehaviorSanitizer: three-point affine solution, independent fourth
point, 180-degree mapping, degenerate calibration rejection, safe image IDs,
malformed/truncated RGB565 BMPs, CRC vector, tap/swipe/hold/debounce decisions,
and aligned cache reads across reverse BMP rows, block boundaries, random seeks
and end-of-file.

Browser codec tests verify per-channel RGB565 error bounds, bottom-up row order,
header validation, aspect-ratio/crop math, URL/text validation, and fixed output
size.

Eight Chromium editor tests pass against an intercepted local API:
authentication, profile save, gallery creation/reorder/delete, image
preparation, failed-save retry, custom-element dragging, display/Wi-Fi settings,
mobile sizing, browser-triggered calibration and offline assets. These tests
establish browser behavior, not physical display correctness or radio
connectivity between a phone and the board.

## Build issue caught during validation

PlatformIO's ELF section-size report initially passed a build whose padded
binary was 1600 bytes over the 2 MiB factory partition. The bootloader rejected
it. The bundled sample and web font were reduced; actual binary size is now
separately checked after generation and immediately before upload. No live card
collection had been provisioned during that failed bring-up; the original full
backup predates all firmware writes.

## Final build and runtime results

Both `pio run` (ST7789) and `pio run -e cyd` (ILI9341) pass. The ST7789 firmware
was uploaded and its written hash verified. The ILI9341 target is
compile-verified only. Application static RAM: 85908 / 327680 bytes (26.2%). The
48 KiB LVGL allocator and networking are additional runtime allocations.

| Target  | Actual binary bytes | Factory partition bytes |
| ------- | ------------------: | ----------------------: |
| cyd2usb |             2087056 |                 2097152 |
| cyd     |             2087264 |                 2097152 |

Actual image size, including padding, is checked before upload. There is little
application flash headroom; changes must continue to pass that check.

`cyd2usb` SHA-256:
`2fee78e8b30a6f98dbd44ed371e3d8e7309b5363bbd6a07a594f06ad7acae26e`

`cyd` SHA-256:
`420672db667b189df2a387305236570cf24599352b9e3ee155ad0029e9752006`

After the aligned image-cache change, all 32 device HTTP checks passed again.
Another 100-switch run kept heap at 173932 bytes and largest free block at 61428
bytes before/after and after restarting. Serial command plus status round trip:
mean 529.7 ms, maximum 842.2 ms. This includes UART command/JSON overhead and is
not a measured TFT frame rate. Card transitions use in-place partial redraws;
full-screen fades/slide layers are not allocated.

The final on-device HTTP run reported a minimum free heap of 70804 bytes and
1920 bytes of loop-task stack remaining at its low-water mark. After closing
configuration and restarting, the selected profile, three-card gallery and
settings were retained; free heap returned to 173932 bytes.

These short checks detect obvious regressions; they do not replace a long soak,
physical touch/brightness/QR tests, RF tests from a separate client, or
deliberate power-loss/corruption experiments. Local logs and browser screenshots
are in the Git-ignored `test-results/` directory.

## Remaining physical acceptance

See [the checklist](HARDWARE_CHECKLIST.md). Touch calibration, all-corner
accuracy, PWM brightness appearance, corrected RGB colors, physical QR scanning,
phone-to-AP uploads, external station reconnect and extended soak/power-cut
testing require physical observation or an external test network. They are not
claimed verified.

No SD, OTA, NFC, battery, Bluetooth or alternate-panel support has been hardware
validated. The `cyd` build is a compile target for the older ILI9341 only.
