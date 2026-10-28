# Preview alignment, GIF artwork and fresh-board artwork

## Changes

The screenshot's preview was already horizontally centered. Headless Chromium
measured the preview group high in a 916 px column: title near y=140, badge center
y=373, actions near y=634, while the column center was y=539. The preview now uses
a centered flex group with symmetric padding. Heading, enclosure, save state,
animation controls, upload actions and progress share one center line. Geometry
checks cover 1360, 780 and 390 px viewport widths and visible upload progress.
The existing Montserrat, light/dark/system tokens and three-column desktop layout
are retained. Browser screenshots were reviewed after the change.

GIFs are now editable, previewed, uploaded, cached and played as animations, rather
than rejected or flattened to one frame. Browser-native compositing preserves
GIF disposal, frame delays and finite/infinite repetition. LBA1 preparation applies
the same crop/zoom/rotation/fit/background transform to every frame. Firmware
validates complete uploads and streams raw/RLE changed rectangles through the
existing stripe buffer. [GIF format, limits and compatibility](GIF.md).

Original source Blobs and unsaved transforms survive same-tab disconnect and
credential revocation. Old requests remain generation/identity guarded. Committed
LBA1 assets can be cached, refreshed, reopened, adjusted and re-exported. Changing
only a saved card's title does not upload its animation again. Legacy firmware
shows an update message and keeps the previous source. Unsupported native GIF
decoding fails explicitly. Preview motion has Pause/Play/Replay controls, honors
reduced-motion preferences and pauses for hidden tabs, uploads and inactive devices.

Only a freshly formatted filesystem whose entire prior partition was verified
0xff receives the original **First light** geometric artwork. Its RGB565 image is
generated row by row with no embedded full-size image or framebuffer. It is stored
as a normal BMP card and can be replaced/deleted normally. Existing filesystems,
backups, saved cards and intentionally emptied collections are never reseeded.
Hold BOOT for two seconds to open the QR from the fresh-board artwork screen.
The empty editor preview remains neutral, as requested.

## Validation before publication

- All 60 browser tests passed (31.6 seconds), including the unchanged revoked-key
  regression, GIF source preservation, upload, cached editing and refresh,
  unsupported-decoder recovery and desktop/tablet/mobile geometry.
- Nine focused GIF/alignment tests passed. Real Chromium ImageDecoder output is
  checked against the local GIF disposal oracle; GATT operations in these browser
  tests are mocked and do not establish radio performance.
- Host C++ ASan/UBSan, animation parser/CRC/structural bounds, codec/GIF, syntax and
  flash-layout checks passed. The parser reconstructs raw/RLE/delta/unchanged
  frames with a three-row scratch buffer, checks loop reset and rejects every
  single-byte corruption and truncated prefix in the fixture.
- CYD2USB build passed: static RAM 74,392 / 327,680 bytes, ELF sections
  1,656,951 / 2,097,152, actual image 1,704,528 / 2,097,152.
- Vendored installer, Pages assets, compiled partition table, manifests, flash
  bounds and release SHA-256 validation passed.

## Actual hardware update

The tester saved and disconnected Badge-287E before the update. A new private
4,194,304-byte full-flash backup was completed and its on-device partition table
validated against the preserved layout. Esptool wrote only the application at
0x10000, then verified its hash. NVS/PHY/LittleFS were not written or migrated.

Post-update status retained the same two cards, revision 5, storage usage
475,136 bytes, and one OS bond. It reports `animationFormat:1`, `sc-passkey-v1`,
107,672 bytes free heap, 61,428-byte largest block and 4,940 bytes loop stack free.
There is no PSRAM. A bounded serial observer collects only whitelisted diagnostics,
never PINs or credentials. The board has not been erased to test first-install
seeding; its existing artwork is preserved. Actual animated playback timing and
final deployment checks are recorded below when available.
