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


Independent interoperability check: Chromium's real ImageDecoder prepared the
four-frame disposal GIF using fit/zoom/translation/rotation. The resulting 67,120-byte
LBA1 file was then decoded by the firmware's C++ AnimationDecoder under ASan/UBSan
with a 720-pixel scratch buffer. All four complete composited frame CRCs matched
the browser's output exactly (80/120/160/200 ms, three total plays). This is a
cross-language serialization check, separately from ESP32 radio/SPI timing.


## Device refresh follow-up

The user confirmed both old-card deletions were intentional. They then uploaded
one GIF successfully (one card, revision 8) and reported correct browser animation,
but a visible top-to-bottom device refresh. Actual badge captures measured a
426,455 us worst frame, which is a visible progressive draw, not merely a theoretical
tearing risk. A fresh private 4 MB backup preserves this new GIF and current settings.

The first decoder/cache/DMA change measured 295,125 us worst and was insufficient.
Additional instrumentation separated first-frame file I/O (34,818 us), display calls
(53,429 us) and substantial per-run CPU overhead. Cached file length reduced the
instrumented worst to 246,271 us; individual short run reads still dominated.
The follow-up batches runs, uses table CRC and sequential read-ahead, and pipelines
two half-stripes through one display transaction. No SPI overclock, backlight blanking,
quality reduction, full framebuffer or unverified TE GPIO is used. A host test models
pending DMA ownership and verifies it is not overwritten by the next decode.

The upload validator's bounded workspace moved to checked heap allocation after
live transfer diagnostics reached only 1,276 bytes loop-stack low-water margin.
Larger decoder caches are reset by indices, avoiding a large temporary on the loop
stack. Active valid upload bytes and matching response ACKs refresh the existing API
idle lease; idle expiry and revocation still apply. This supports larger GIF transfers
without expiring a session that is actively transferring data.


### Confirmed build defect and final hardware result

The actual PlatformIO compile database showed **no `-O` switch** for Ui.cpp, despite
`BUILD_TYPE=release`. Thus project/library sources were compiling at GCC's default
unoptimized level. `platformio.ini` now sets `-O2` explicitly, and Ui.cpp fails the
build if `__OPTIMIZE__` is absent. A regenerated compile database verified `['-O2']`.
Host sanitizer checks now also use `-O2`. This explains expensive ordinary screen
updates as well as the animation decoder's unexpectedly high CPU cost.

On the same saved 834,980-byte, nine-frame GIF, measured worst frame progression was
426,455 us originally; 295,125 us after the first batching/cache change; 246,271 us
with cached file length/profiling; 171,811 us with batched runs and overlapped DMA;
and approximately 65 ms after enabling compiler optimization. The final value is
about 6.5 times faster than the original capture. These are measured software
frame times on the physical board, not a claim of TE synchronization or tear-free
scanout. Final visual assessment was requested from the Windows tester.

The final locally built and flashed application is 1,171,504 bytes, versus 1,710,192
for the otherwise equivalent unoptimized pipeline. Static RAM is 82,272 / 327,680;
ELF sections 1,154,731 / 2,097,152. Post-update diagnostics retained the user's one
card, revision 8 and OS bond, reported no animation error, 96,684 bytes free
heap, a 61,428-byte largest block and 5,384 bytes loop-stack margin during playback.
The serial observer wakes the screen temporarily for the bounded measurement;
it does not alter the saved timeout or artwork. Upload validation's checked heap
workspace and 15-second transfer inactivity policy remain in force.

All host sanitizer/parser/codec/flash checks passed with optimization, and the
actual browser-encoded fixture still reconstructed every frame pixel for pixel.
The frontend is unchanged from the 60-test passing GIF release. The original GIF
release `4002d491f59d3ced5066fa12a9ce18d3ad16a066` passed
[build and Pages deployment](https://github.com/N0rule/LanyardBadge/actions/runs/40737072606).
Its bare public index and manifest served `2.3.4-4002d491f59d`; app.js, transport.js,
cache.js, gif.js and style.css matched the source byte for byte, and firmware
release hashes verified. The optimized follow-up's publication is recorded below.


The tester then inspected the optimized animation on the physical Badge-287E and
confirmed **“Looks good now”** when asked whether the top-to-bottom wipe remained
distracting. The same GIF had played over 1,800 frames without a decoder error;
worst frame time remained 65,030 us, free heap 96,684 bytes, minimum heap 95,396,
and loop-stack margin 5,384 bytes. The user's one card/revision 8 and bond were
retained. No further firmware change or flash follows this visual acceptance.


## Menu access follow-up

After accepting animation playback, the user reported that opening the menu needed
a very long press and confirmed they wanted it sooner. The previous gesture
required 750 ms, lost contact immediately on a pressure dropout, and consumed a
hold begun during wake. The new hold is 450 ms with 22 px stationary tolerance;
actual swipe movement latches hold cancellation. Touch release has a 32 ms dropout
grace after the existing two-sample contact validation. A deliberate wake-and-hold
can open the menu directly; ordinary wake taps remain consumed and never switch
cards on release. The held pointer cannot click a menu item before release.

Host sanitizer tests cover the exact 450 ms threshold, one-shot hold, contact
bounce/real release, return-after-swipe cancellation, existing taps/swipes and wake
consumption. CYD2USB compilation and flash bounds passed. Final menu firmware:
1,171,904 / 2,097,152 bytes; static RAM 82,280 / 327,680; ELF sections 1,155,143.
The user chose the faster behavior before it was installed.


The tester then confirmed **“Opens promptly now”** after testing the installed
half-second hold. The exact continuous wake-and-hold sequence was not separately
reported. The saved GIF remains one card/revision 8, with no decoder error and approximately 65 ms worst frame.


## Final publication

Code release `8ab5f53a73346ea88770c9afea0e6bb4b737cc37` passed
[CI build and Pages deployment](https://github.com/N0rule/LanyardBadge/actions/runs/40745525420).
The bare canonical index and update manifest serve `2.3.4-8ab5f53a7334`. Downloaded
app.js, transport.js, cache.js, gif.js and style.css match the committed source byte
for byte. All published firmware files match their release SHA256SUMS. The final
published application is 1,171,904 bytes, SHA-256
`fbdc2470a9f8207bb09a97ca35b527b72736a1550542bcd838ac3de1a81605a3`.
The update manifest contains only the application at 0x10000 with skip-erase enabled.

The installed local build is the same final source; its separately verified local
binary hash is `afd951bf36f1898692027ba76744893ce8568276c4cacd477c0efce5f77a6400`.
The user confirmed animation appearance and prompt menu entry on the actual board.
The saved GIF and current settings remain intact; intentional old-card deletions
were not undone. Private backups remain excluded from Git. Diagnostic observers
were stopped and the USB serial port released without another flash.

Remaining checks: erased-board first-install artwork seeding, other display
variants and browsers beyond the tested Helium configuration, extreme 300-frame/
1 MiB radio workloads, and separate continuous wake-and-hold observation. There
is no TE pin in the verified wiring, so the measured/accepted improvement is not
advertised as synchronized or universally tear-free scanout.
