# GIF support: preparation foundation

Status: frame preparation is implemented and tested. The release editor still
accepts still artwork only. Animation storage, BLE ingestion, firmware playback
and animated editing are not enabled. No GIF is silently uploaded as a still card.

## Implemented

`web/gif.js` exposes `BadgeGIF.prepare(blob, onFrame, options)` for the next
animation integration. It is intentionally not loaded by `index.html` yet.

- Feature-detects native WebCodecs GIF decoding. Unsupported browsers get an
  explicit error; no first-frame-only fallback impersonates animation support.
- Validates the GIF signature and logical dimensions before decoding. Initial
  preparation limits are 30 MB input, 16 million source pixels, 300 frames and
  30 seconds per cycle. These are browser preparation limits, not a promise that
  the badge has room for the resulting animation.
- Uses native GIF compositing, including transparency and restore-to-previous /
  restore-to-background disposal, before applying the same `BadgeArtwork.draw`
  crop, fit, zoom, rotation and position pipeline as still images.
- Shares RGB565 quantization with the existing BMP exporter. Each output rectangle
  contains top-down row-major `Uint16Array` color values, not a wire format.
- Emits a full first frame, then the bounding rectangle of changed pixels.
  Unchanged frames have a zero-area rectangle and retain their duration. This
  lets a future player leave unchanged display pixels alone.
- Awaits each sink callback before decoding another frame. The application closes
  each native frame/bitmap and holds one previous prepared frame for differencing.
  Browser decoder internal caching remains implementation-dependent.
- Preserves per-frame delays with a 20 ms floor and a 100 ms fallback when the
  decoder supplies no duration. Repetition metadata is retained (`Infinity`
  denotes indefinite repetition). Actual ESP32 pacing still needs measurement.
- Snapshots the transform for a complete preparation operation. Supports
  cancellation and closes the decoder on success, abort or callback failure.

A sink receives `{index, frameCount, durationMs, x, y, width, height, pixels}`.
It must stage its output and commit **only after `prepare` resolves**. A later
frame may exceed the duration limit or fail to decode; partial output must then
be discarded. The sink owns the emitted rectangle array and may retain it.

## Next integration boundary

A raw 240 × 320 RGB565 frame is 153,600 bytes. The live board has no PSRAM and
reported a 61,428-byte largest free heap block during upload verification. Full
framebuffers and an unexamined GIF decoder are therefore unsuitable defaults.

The proposed next step is a versioned animation file with bounded frame records,
validated rectangles/durations, integrity checks and compression that can decode
into the existing 32-row stripe buffer. The format is deliberately not frozen by
this preparation module. It must be checked for worst-case size and per-frame SPI
cost before exposing GIF selection. Storage validation, metadata migration,
variable-size BLE transfer bounds, loop/reset semantics, sleep/menu ownership and
interruption recovery all need end-to-end testing on the badge.

## Evidence and sources

`tests/fixtures/disposal.gif` is a local four-frame test with disposal methods
1, 3, 2 and 1, transparency, finite repetition and unequal delays. Its exact decoded
RGBA oracle is retained in `disposal.json`; regenerate both with
`scripts/generate_gif_fixture.py` and Pillow 13.0.0. CI uses the checked-in files
without adding a Pillow dependency. Chromium's real ImageDecoder output is
transformed and compared pixel-for-pixel with that oracle, then reconstructed
from the emitted delta rectangles. No decoder API is mocked for that test.
Node tests check dimension limits, first/unchanged frames, rectangle reconstruction
and exact quantization parity with still BMPs. The normal editor also rejects GIF
files, including renamed files, while retaining current edits.

The implementation was checked against the primary
[WebCodecs image-decoding specification](https://www.w3.org/TR/webcodecs/#image-decoding)
and the [GIF89a format specification](https://giflib.sourceforge.net/gifstandard/GIF89a.html).
This is browser preparation evidence; GIF playback has not been tested on the
ESP32 because no firmware player is enabled yet.
