# Local editor API

The HTTP server runs on port 80 only while a configuration window is open.
Static editor assets require no authentication. Other routes use
`Authorization: Bearer <token>`. There is no CORS allowance. Responses are JSON
except for static assets and image downloads. All requests use `Content-Length`;
chunked and multipart uploads are not supported.

| Method / path              | Request                                               | Result                                        |
| -------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| POST /api/pair             | `{"password":"<on-screen password>"}`                 | New session token                             |
| GET /api/status            | —                                                     | Memory, storage, Wi-Fi and persisted settings |
| GET /api/cards             | —                                                     | Versioned deck and revision                   |
| POST /api/cards            | Complete deck with matching revision                  | Committed deck, next revision                 |
| POST /api/assets           | `image/bmp`, exactly 153666 bytes                     | Immutable image ID                            |
| GET /api/image?id=xxxxxxxx | Valid image ID                                        | RGB565 BMP                                    |
| POST /api/select           | `{"id":"xxxxxxxx"}`                                   | Updated status                                |
| POST /api/settings         | Brightness, autoplay, interval, rotation, defaultCard | Updated status                                |
| POST /api/network          | `{"ssid":"...","password":"..."}`                     | Updated status, asynchronous connection       |
| POST /api/gc               | `{}`                                                  | Number of orphan backgrounds removed          |
| POST /api/calibrate        | `{}`                                                  | Starts four-corner calibration on the badge   |
| POST /api/close            | `{}`                                                  | Success, then server/AP close                 |

JSON bodies have a 24576-byte limit and a maximum nesting depth of eight for
card data. Standard editor requests are `application/json`; assets use
`image/bmp`. Bodies are streamed through WebServer's raw callback, including
JSON, rather than allowing the framework to allocate arbitrarily large POST
strings. Unknown routes have a catch-all handler that closes body uploads
without buffering them.

Pairing attempts are limited after five failures for 30 seconds. Tokens expire
on device restart, setup closure, a new successful pairing, or 20 minutes idle.
The AP itself has a 15-minute window. The owner must reopen it physically or by
USB serial. Authentication precedes image file creation.

## Card schema

```json
{
  "version": 2,
  "revision": 1,
  "cards": [
    {
      "id": "00000001",
      "title": "Hello",
      "mode": "profile",
      "image": "",
      "name": "Ada",
      "description": "Making small things.",
      "url": "https://example.com",
      "background": 14274303,
      "foreground": 2306637,
      "accent": 3561945,
      "texts": [],
      "shapes": []
    }
  ]
}
```

There must be 1–10 cards with unique eight-character lowercase hexadecimal IDs.
`image` is empty or an uploaded image ID. Modes: `profile`, `artwork`, `custom`.
Colors are unsigned RGB888 integers, 0–16777215. Title/name limits: 48 bytes;
description/text: 96 bytes; HTTP(S) URL: 100 bytes. Printable ASCII and line
breaks are supported, but URLs cannot contain whitespace. Titles cannot be
empty.

Custom `texts` (up to four) contain text, x (0–220), y (0–300), size (14/20/28),
and color. Custom `shapes` (up to four) contain x, y, w, h, radius (0–120), and
color. Shapes must fit entirely within the logical 240 × 320 display. A circle
is a square with radius at least half its side. Text wraps within the remaining
screen width; content beyond the available height is ellipsized.

To replace a background: clean old orphans, upload the new file, then commit a
deck referencing its returned ID. Clear a card's image field to remove artwork.
The old deck remains authoritative until the manifest commit succeeds. Reload a
fresh revision after HTTP 409; retrying a stale manifest is intentionally
rejected.

## Accepted bitmap

Windows BMP, 66-byte header, BITMAPINFOHEADER size 40, positive width 240 and
height 320, one plane, 16 bits per pixel, BI_BITFIELDS (3), pixel offset 66, RGB
masks F800 / 07E0 / 001F, 153600 bytes of pixels. Pixels are RGB565 little
endian, rows bottom first. The browser does all decoding, scaling and cropping.
The image header and byte count are checked before atomic installation. The
format needs one row of decoder memory, not 153600 bytes of application heap.

Typical failures: 401 pairing required, 409 revision conflict, 413 body length,
415 content type, 422 invalid data, 429 pairing rate limit, 507 storage failure.
A stalled raw body times out after 250 ms without data; uploads have an
additional 30-second limit. These limits favor a direct local connection. During
successful uploads the UI is serviced between chunks. Header parsing or a
stalled socket can still cause a bounded pause; it is not a hard real-time
interface.
