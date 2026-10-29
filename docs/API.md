# Device operations over BLE

Service `f40d1000-6f15-4d56-b6d4-17c92e648a10`.
Receive/write `f40d1001-6f15-4d56-b6d4-17c92e648a10`.
Transmit/read/notify `f40d1002-6f15-4d56-b6d4-17c92e648a10`.
BLE protocol 3 requires authenticated LE Secure Connections with a 16-byte key.
The protected read returns protocol byte 3 and a little-endian uint16 MTU.
Subscribe after the protected read, then send operation 6 to start a clean session.
Unbonded peers may connect only during the two-minute enrollment window opened
by the physical connection screen (also opened on an unconfigured boot).
A fresh six-digit PIN appears on the badge for the native OS/browser pairing
prompt. Existing authenticated bonds authorize later sessions. There is no
four-letter application password, ownership key, or secret QR URL.
Forget paired editors on the badge removes bonds; remove the stale host pairing
before enrolling again. Firmware 2.x requires an update for the current editor.

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
| POST `/api/pair`             | `{}` → `{token,snapshot}`                       |
| GET `/api/status`            | Diagnostics, storage, settings, current selection, sleep/BLE state                                   |
| GET `/api/cards`             | `{version:2,revision,cards:[...]}`                                                                   |
| POST `/api/cards`            | Complete deck with matching revision → committed deck                                                |
| POST `/api/animations`      | Validated LBA1 bytes (48–1,048,576); requires advertised `animationFormat:1` → `{id}` |
| POST `/api/assets`           | Exactly 153666 RGB565 BMP bytes → `{id}`                                                             |
| GET `/api/image?id=xxxxxxxx` | Validated image ID → BMP bytes                                                                       |
| POST `/api/select`           | `{id}` → device status                                                                               |
| POST `/api/settings`         | brightness, interval, autoplay, rotation, defaultCard, optional screenTimeout and darkMode (boolean) |
| POST `/api/name` | `{name}` → status; 1–24 printable ASCII characters, no edge spaces |
| POST `/api/reset` | `{}` → 202; requires release then hold BOOT for 3 seconds on badge |
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

### Link-security diagnostics

Status responses additionally expose `bluetoothSecurityStatus` (the last NimBLE
GAP encryption-change result) and `bluetoothSecurityEvents` (its count since boot).
They survive a disconnect in RAM, not a reboot. Status 0 with count 0 means no
security result has been observed. With an observed event, status 0 indicates
successful security state change; also inspect `bluetoothEncrypted` and
`bluetoothAuthenticated` for the live link. `bluetoothProtocol` is 3 and
`bluetoothSecurityProfile` is `sc-passkey-v1` on current firmware. Native error bases follow the pinned NimBLE host: HCI 0x200, local SMP 0x400,
peer SMP 0x500. For example, 0x50C is a peer SMP Numeric Comparison Failed rejection.
These diagnostic values contain no keys, tokens, PINs, or peer addresses. Older
firmware can omit both fields; older clients may ignore them.


### Animated artwork capability

Current status includes `animationFormat:1`, `maxAnimationBytes:1048576` and an
`artworkSizes` object mapping committed asset IDs to byte sizes. Old firmware omits
these fields; clients must gate GIF upload on the explicit capability. Card image
IDs and metadata version 2 are unchanged. `/api/image` can return BMP or LBA1 data;
range validation uses the actual immutable file size. See [LBA1](GIF.md) for the
validated file format, timing semantics and bounds. Animation uploads retain the
same encrypted/authenticated characteristic and application-token requirements.
