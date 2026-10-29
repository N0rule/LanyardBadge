# LanyardBadge 3.0.0

USB editing now works alongside Bluetooth. Connect with USB to upload still images
or GIFs, edit the collection and device settings, and return to the installer.
USB and Bluetooth share validation and transactional storage; switching connections
keeps drafts attached to the same badge.

Bluetooth uses native authenticated pairing. The badge shows the six-digit PIN
for the operating-system prompt; the separate four-letter code is removed. Open
Connect on the badge to enroll a new editor. Existing authenticated bonds survive
updates. Forget paired editors revokes bonds. The editor requires BLE protocol 3;
update older firmware over USB before connecting wirelessly.

Device names persist across restarts and update Bluetooth advertising. Factory
reset is available on the badge and website, with physical BOOT confirmation.
It removes artwork, settings and bonds while preserving firmware. A persistent
journal completes interrupted resets on subsequent boots.

The editor has centered preview status, visible loading progress and transfer
cancellation. Obsolete sketches, icons, serial commands, calibration controls,
profile/custom renderers and application ownership credentials have been removed
from active use. Existing touch mapping and image/GIF collections migrate intact.
Legacy profile/custom collections remain on disk until an acknowledged reset.
Fresh installs start empty instead of treating a sample image as onboarding.

## Verification — 2026-10-29

- Host C++ checks, including bounded serial framing, name validation, animation
  decoding and reset failure/retry orchestration, pass. Python serial and flash
  layout tests and JavaScript codec checks pass.
- All 64 browser tests pass: USB/BLE sessions, native pairing guidance, migration,
  naming, reset confirmation, uploads, cancellation, reconnects, drafts, installer
  lifecycle, cache identity, GIF handling and responsive preview alignment.
- CYD2USB build succeeds: application image 1,166,256 bytes within the unchanged
  2 MiB slot. Static RAM is 68,872 bytes. Site assets, manifests and hashes validate.
- Connected ESP32 application-only flash succeeds with on-device hash verification.
  No filesystem image, bootloader or NVS replacement was flashed.
- Real USB migration preserves artwork, brightness, timeout, rotation, interval,
  slideshow, theme and the existing Bluetooth bond. Naming accepts valid input,
  rejects invalid input, and restores the original name after testing.
- A 153,666-byte BMP uploads in 19.792 seconds and reads back byte-for-byte.
  Metadata commit and reconnect pass. The temporary image is removed afterwards.
- The owner's existing 834,980-byte animation reads back with unchanged SHA-256
  `42d078f6eb37084c8a8c8f6e7c8b1308784f3f66bbbbde08cc35c9617a84a574`.
  Collection remains one card; the verification commit advances revision 8 to 9.
- Reboot verification preserves the custom name, display preferences, cache epoch
  and touch calibration. The original name is restored after testing. A 67,120-byte
  LBA animation uploads and reads back exactly in a 19.164-second round trip.
- Earlier USB tests cover full-storage rejection and interrupted-header recovery.
  The owner confirmed correct artwork display and hold-to-menu after that update.

## Verification limits

Native BLE enrollment/revocation on Windows and Linux, real browser permission
prompts and USB installer handoff need physical browser acceptance. This session's
Bluetooth adapter was off and had no local bond available for automatic testing.
Mock browser tests do not constitute radio or browser-to-board verification.

Factory reset and power interruption were tested through the production reset
orchestrator with simulated storage/bond failures. No destructive factory reset
or deliberate power-cut test was performed on the owner's artwork collection.
Display tearing, touch feel and phone QR scanning require physical observation.
USB speed above is a measured BMP upload at 115200 baud, not a claim that USB is
faster than BLE. See [hardware checklist](HARDWARE_CHECKLIST.md).

## Installation

Use the website's Update path for an existing CYD2USB badge, with erase disabled.
The application belongs at `0x10000`; fresh installation also includes bootloader
at `0x1000` and partition table at `0x8000`. Never flash a filesystem image over
an existing collection. Release assets include fresh/update manifests and SHA256SUMS.
