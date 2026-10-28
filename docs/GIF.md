# GIF artwork

The editor accepts animated GIFs on badges reporting `animationFormat: 1`.
Choose a GIF, adjust crop/fit/zoom/rotation like a still image, then upload the
card. The preview animates and has Pause/Play/Replay controls. Reduced-motion
preferences start the preview paused; hidden tabs, disconnected editors, uploads
and inactive workspaces pause decoding. The badge plays the saved animation,
including finite loops, and holds its last frame when finished. Menus, pairing,
sleep and uploads retain ownership of the display; returning to the card restarts
from its complete first frame.

Existing badges need the new USB firmware before accepting GIF uploads. The site
checks the advertised capability and retains the previous source if GIF selection
fails. Old BMP cards, card IDs, metadata version 2, GATT wire versions 1/2 and the
flash layout remain compatible. An older website cannot preview LBA1 artwork;
refresh after saving edits to use the updated, revisioned editor assets.

## Limits and memory

GIF input is limited to 30 MB, 16 million source pixels, 300 frames and 30 seconds
per cycle. Source dimensions times frame count must not exceed 64 million decoded
pixels to bound decoder caching. Native WebCodecs GIF support is feature-detected;
unsupported browsers receive an explicit error without a first-frame fallback.
Frame delays have a 20 ms floor and a 100 ms fallback for missing durations.
Native decoding handles transparency and GIF disposal before applying the common
artwork transform and RGB565 quantization.

Prepared assets must fit 1 MiB and the badge's available storage, with 32 KiB
reserved for metadata and recovery. Shorter/simpler GIFs fit better. This is not a
promise that every 30 MB GIF will fit on a 4 MB/no-PSRAM device. Compression uses
raw pixels or run-length encoding per changed rectangle, whichever is smaller.
The browser retains the original GIF Blob throughout an unsaved editing session;
it does not replace it with its first frame or close it during re-pairing.
Committed artwork may be reopened from a validated, credential-scoped cache as
an editable animation, with further adjustments applied to every frame.

The ESP32 uses the existing 15,360-byte display stripe buffer plus a 512-byte
reader cache. It never allocates a 153,600-byte framebuffer or keeps all frames
in RAM. Playback schedules from the start of each frame, does not skip dependent
delta frames, and slows when decoding/SPI work exceeds the source delay. Actual
frame time is available as `animationMaxFrameUs`; source timing is not a guarantee
of a fixed hardware frame rate.

## LBA1 storage format

This is a versioned display-ready asset, not a GIF file or a cryptographic protocol.
All numeric values are little-endian. RGB565 pixels are top-down, row-major.
The first frame covers 240 × 320; later frames replace only their changed rectangle.
Unchanged frames use x=y=width=height=payload length=encoding=0 and retain their delay.

| Header offset | Value |
| --- | --- |
| 0 | `LBA1` magic, 4 bytes |
| 4, 6 | width=240, height=320, uint16 |
| 8 | frame count, uint16 (1–300) |
| 10 | total plays, uint16; 0 means infinite |
| 12 | complete file size, uint32 (at most 1 MiB) |
| 16 | sum of frame delays in milliseconds, uint32 (at most 30,000) |
| 20 | CRC-32/IEEE of bytes 32 through EOF, uint32 |
| 24 | CRC-32/IEEE of header bytes 0–23, uint32 |
| 28 | reserved uint32, must be zero |

Each frame has a 16-byte record: x/y/width/height/delay/encoding (six uint16 values),
then payload size (uint32). Delay is 20–30,000 ms. Encoding 0 contains exactly
width×height little-endian uint16 pixels. Encoding 1 contains `(run length, color)`
uint16 pairs, with nonzero lengths totaling exactly width×height. Runs may cross
rows/stripes. The decoder rejects zero runs, excess/short output, unknown encodings,
invalid rectangles, trailing bytes, inconsistent duration, and CRC failures.
CRC detects corruption; confidentiality and authentication remain provided by the
existing authenticated encrypted BLE link and application ownership check.

Authenticated `POST /api/animations` stages variable-size uploads. Only a complete,
validated file is atomically renamed from `/upload.tmp` to `/img-<id>.lba`. A failed
upload never changes committed metadata. Metadata commit still checks revision,
asset existence and artwork mode. Garbage collection preserves current and backup
manifest assets for both `.bmp` and `.lba` files. `GET /api/image` returns the original
asset bytes; status supplies `artworkSizes` for bounded range reads. Cached assets
validate format and digest before use. Asset IDs and metadata remain unchanged.

## Validation

Host C++ ASan/UBSan tests reconstruct raw/RLE/delta/unchanged frames through a
three-row buffer, test loop reset, every truncated/corrupted byte in a fixture,
malformed structural fields and variable-size range bounds. Node tests independently
check CRC, parser bounds, corruption and exact RGB565/rectangle behavior.
Chromium tests use its real ImageDecoder against the local GIF disposal oracle.
Mock-GATT tests cover animated preview, transforms, upload, finite loops/delays,
cache reconnect and page refresh, re-export of cached animations, ownership-key
revocation, unsupported decoding, and avoiding artwork reupload for title-only saves.
Mocks do not establish radio performance. Hardware and deployment results are
recorded in [the UI/GIF release record](UI-GIF.md).

Sources: [WebCodecs image decoding](https://www.w3.org/TR/webcodecs/#image-decoding)
and [GIF89a](https://giflib.sourceforge.net/gifstandard/GIF89a.html).
