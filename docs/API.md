# Device operations over BLE

Service `f40d1000-6f15-4d56-b6d4-17c92e648a10`.
Receive/write `f40d1001-6f15-4d56-b6d4-17c92e648a10`.
Transmit/read/notify `f40d1002-6f15-4d56-b6d4-17c92e648a10`.
Encrypted writes/reads; subscribe before sending requests. A read returns three
bytes: protocol version 1, then little-endian negotiated MTU (uint16).

Every framed packet starts with operation (u8), request sequence (u16 LE), offset
or length (u32 LE). Remaining bytes are payload. Total packet length ≤ min(512,
MTU−3). At MTU 23, 13 payload bytes remain. Requests are serialized per connection.

1. Client sends operation 4 fragments containing a UTF-8 JSON header:
   `{method:"POST",path:"/api/pair",token:"",length:31}`. Offset is header bytes
   already sent; device acknowledges with operation 0 and cumulative header bytes.
2. Client sends operation 1 with no payload to start the parsed request; device
   acknowledges operation 0, offset 0. Older inline headers remain accepted.
3. Client sends operation 2 body fragments, offset equal to acknowledged body
   bytes. Device acknowledges operation 0 and cumulative accepted bytes. Wait for
   every acknowledgement. Empty requests skip body chunks.
4. Client sends operation 3 with final body length.
5. Device replies operation 1: total response length in offset field, HTTP-style
   status (u16 LE) in payload. Body is JSON except image reads.
6. Device sends operation 2 response fragments with byte offsets. Client sends
   operation 5 acknowledgements with cumulative response bytes. Device waits for
   each acknowledgement before sending another chunk.
7. Device sends operation 3 with final response length.

Errors can produce a response before the request body completes. Clients must
accept and report those responses while waiting for an acknowledgement. Sequence,
offset, size and final response length are validated. Disconnect on transport
failure and reauthenticate before retrying; do not blindly replay metadata writes.
Check the current revision after an uncertain commit. All browser GATT writes,
including response acknowledgements, are serialized independently of API requests;
response inactivity timers refresh for each received chunk. Firmware discards queued
packets from old connection generations. There is a 15-second transfer inactivity
timeout and a 20-minute API session lifetime refreshed by authenticated operations.

| Operation | Body / response |
| --- | --- |
| POST `/api/pair` | `{password: QR-key}` → `{token}` |
| GET `/api/status` | Diagnostics, storage, settings, current selection, sleep/BLE state |
| GET `/api/cards` | `{version:2,revision,cards:[...]}` |
| POST `/api/cards` | Complete deck with matching revision → committed deck |
| POST `/api/assets` | Exactly 153666 RGB565 BMP bytes → `{id}` |
| GET `/api/image?id=xxxxxxxx` | Validated image ID → BMP bytes |
| POST `/api/select` | `{id}` → device status |
| POST `/api/settings` | brightness, interval, autoplay, rotation, defaultCard, optional screenTimeout |
| POST `/api/calibrate` | `{}` → starts optional physical calibration |
| POST `/api/gc` | `{}` → number of unreferenced images removed |
| POST `/api/display` | `{}` → returns to artwork |
| POST `/api/close` | `{}` → closes the session |

Except pairing, operations require the session token in the request header. Asset
uploads additionally require the authenticated connection. UUIDs and API paths
are protocol identifiers, not HTTP requests against GitHub Pages.

Cards retain the version-2 compatibility schema: id, title, mode, image, background,
foreground, accent, name, description, url, texts and shapes. New editor cards use
`mode:"artwork"` and empty legacy fields. Zero through ten cards; unique eight-digit
lowercase hex IDs; bounded ASCII titles and legacy text. Failed metadata commits
leave both the edited source in the browser and the previous valid manifest on the
device. An asset uploaded before a failed commit can be reused in the same tab.

BLE firmware updates are not implemented. Firmware installation uses USB manifests,
not this service.
