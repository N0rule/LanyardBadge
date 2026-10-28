# Device operations over BLE

Service `f40d1000-6f15-4d56-b6d4-17c92e648a10`.
Receive/write `f40d1001-6f15-4d56-b6d4-17c92e648a10`.
Transmit/read/notify `f40d1002-6f15-4d56-b6d4-17c92e648a10`.
Encrypted writes/reads; complete an encrypted read before subscribing, then
subscribe before sending requests. This avoids racing security setup during a
fast reconnect. A read returns three
bytes: protocol version 2, then little-endian negotiated MTU (uint16). The current
browser also accepts legacy version 1.

After subscribing, a protocol-2 client sends operation 6 with a fresh sequence,
offset 0 and no payload, then waits for operation-0 acknowledgement at offset 0.
This abandons a previous editor's response/temporary upload and API token even
when the OS retains the physical BLE connection across page reloads. It never
deletes committed artwork, changes pairing credentials or resets retry limits.

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

| Operation                    | Body / response                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| POST `/api/pair`             | `{password: four-letter-code-or-remembered-credential}` → `{token,credential}`                       |
| GET `/api/status`            | Diagnostics, storage, settings, current selection, sleep/BLE state                                   |
| GET `/api/cards`             | `{version:2,revision,cards:[...]}`                                                                   |
| POST `/api/cards`            | Complete deck with matching revision → committed deck                                                |
| POST `/api/assets`           | Exactly 153666 RGB565 BMP bytes → `{id}`                                                             |
| GET `/api/image?id=xxxxxxxx` | Validated image ID → BMP bytes                                                                       |
| POST `/api/select`           | `{id}` → device status                                                                               |
| POST `/api/settings`         | brightness, interval, autoplay, rotation, defaultCard, optional screenTimeout and darkMode (boolean) |
| POST `/api/calibrate`        | `{}` → starts optional physical calibration                                                          |
| POST `/api/gc`               | `{}` → number of unreferenced images removed                                                         |
| POST `/api/display`          | `{}` → returns to artwork                                                                            |

Except pairing, operations require the session token in the request header. Asset
uploads additionally require the authenticated connection. UUIDs and API paths
are protocol identifiers, not HTTP requests against GitHub Pages.

Short codes are case-insensitive letters and require the device's connection
screen to be open. Strong remembered credentials and legacy QR keys can reconnect
from the artwork screen. Five incorrect attempts trigger a 30-second delay;
429 reports throttling and 403 requests opening the physical connection screen.
The returned credential is secret: clients may remember it with explicit UI
disclosure, but must not log it or include it in query strings.

Cards retain the version-2 compatibility schema: id, title, mode, image, background,
foreground, accent, name, description, url, texts and shapes. New editor cards use
`mode:"artwork"` and empty legacy fields. Zero through ten cards; unique eight-digit
lowercase hex IDs; bounded ASCII titles and legacy text. Failed metadata commits
leave both the edited source in the browser and the previous valid manifest on the
device. An asset uploaded before a failed commit can be reused in the same tab.

BLE firmware updates are not implemented. Firmware installation uses USB manifests,
not this service.

### Link-security diagnostics

Status responses additionally expose `bluetoothSecurityStatus` (the last NimBLE
GAP encryption-change result) and `bluetoothSecurityEvents` (its count since boot).
They survive a disconnect in RAM, not a reboot. Status 0 with count 0 means no
security result has been observed. With an observed event, status 0 indicates
successful security state change; also inspect `bluetoothEncrypted` for the live
link. Native error bases follow the pinned NimBLE host: HCI 0x200, local SMP 0x400,
peer SMP 0x500. For example, 0x50C is a peer SMP Numeric Comparison Failed rejection.
These diagnostic values contain no keys, tokens, PINs, or peer addresses. Older
firmware can omit both fields; older clients may ignore them.
