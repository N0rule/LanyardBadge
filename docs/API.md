# Device operations over BLE

Service `f40d1000-6f15-4d56-b6d4-17c92e648a10`.
Receive/write `f40d1001-6f15-4d56-b6d4-17c92e648a10`.
Transmit/read/notify `f40d1002-6f15-4d56-b6d4-17c92e648a10`.
BLE protocol 4 exposes unpaired READ/WRITE/NOTIFY characteristics. The read
returns version byte 4 and the little-endian MTU. Subscribe, then send operation 6.
A fresh four-letter code appears on the badge for each connection. POST /api/pair
with `{password:"ABCD"}` creates a session only if the case-insensitive code is
valid. Codes expire after two minutes and are single-use. Five wrong attempts
cause a 30-second lockout that survives reconnecting. Codes are not returned in
any API response. Disconnect releases authorization. No OS pairing or bonding
is required; application payloads are not encrypted.

USB uses the same operations inside [serial framing](USB-PROTOCOL.md).
Physical access and browser serial permission authorize USB sessions. Only one
transport owns the API at a time.

Every framed packet starts with operation (u8), request sequence (u16 LE), offset
or length (u32 LE). Remaining bytes are payload. Total packet length ≤ min(512,
MTU−3). At MTU 23, 13 payload bytes remain. Requests are serialized per connection.

1. Client sends operation 4 fragments containing a UTF-8 JSON header:
   `{method:"POST",path:"/api/pair",token:"",length:2}`. Offset is header bytes
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
| POST `/api/pair`             | `{password: four-letter-code}` → `{token,snapshot}` (USB needs no password)                       |
| GET `/api/status`            | Diagnostics, storage, settings, current selection, sleep/BLE state                                   |
| GET `/api/cards`             | `{version:2,revision,cards:[...]}`                                                                   |
| POST `/api/cards`            | Complete deck with matching revision → committed deck                                                |
| POST `/api/animations`      | Validated LBA1 bytes (48–1,048,576); requires advertised `animationFormat:1` → `{id}` |
| POST `/api/assets`           | Exactly 153666 RGB565 BMP bytes → `{id}`                                                             |
| GET `/api/image?id=xxxxxxxx` | Validated image ID → BMP bytes                                                                       |
| POST `/api/select`           | `{id}` → device status                                                                               |
| POST `/api/settings`         | brightness, interval, autoplay, rotation, defaultCard, optional screenTimeout and darkMode (boolean) |
| POST `/api/name` | `{name}` → status; 1–24 printable ASCII characters, no edge spaces |
| POST `/api/reset` | `{}` → 202; requires tapping Erase everything on the badge touchscreen |
| POST `/api/gc`               | `{}` → number of unreferenced images removed                                                         |
| POST `/api/display`          | `{}` → returns to artwork                                                                            |

Except pairing, operations require the session token in the request header. Asset
uploads additionally require the authenticated connection. UUIDs and API paths
are protocol identifiers, not HTTP requests against GitHub Pages.

Cards use the version-2 envelope with artwork-only modes: id, title, mode, image,
and background. Empty compatibility fields remain in responses so existing
artwork workspaces survive updates. Profile/custom manifests are detected before
loading and kept on disk. Upload, commit and garbage collection remain blocked
until the owner acknowledges a factory reset; old metadata is never silently
converted into a blank collection. Current BMP/LBA assets are unchanged.

Status includes stable `deviceId`, public `cacheEpoch`, `deviceName`,
`factoryReset:true`, and `legacyCollection`. Reset changes cacheEpoch and removes
settings, artwork and bonds. A reset request alone does not erase anything.

BLE firmware updates are not implemented. Firmware installation uses USB manifests,
not this service.

### Link diagnostics

`bluetoothProtocol` is 4 and `bluetoothSecurityProfile` is `session-code-v1`.
`bluetoothEncrypted` and `bluetoothAuthenticated` describe native link security,
not the application session; both are normally false in this release.
`bluetoothIdentity` exposes only the public radio address. Codes and tokens are
never included in status. `bluetoothBonds` is zero after migration.

### Animated artwork capability

Current status includes `animationFormat:1`, `maxAnimationBytes:1048576` and an
`artworkSizes` object mapping committed asset IDs to byte sizes. Old firmware omits
these fields; clients must gate GIF upload on the explicit capability. Card image
IDs and metadata version 2 are unchanged. `/api/image` can return BMP or LBA1 data;
range validation uses the actual immutable file size. See [LBA1](GIF.md) for the
validated file format, timing semantics and bounds. Animation uploads retain the
same application-token requirements.
