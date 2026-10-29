# USB editing protocol, version 1

This is a framed UART protocol for classic ESP32 + CH340/CH341 (1A86:7523),
not native USB CDC. Use Web Serial over HTTPS and 115200 baud, 8N1, no flow
control. Deassert DTR and RTS. A board reset on port opening is tolerated by
six handshake attempts with a 1.2-second deadline each.

## Envelope

Each frame begins and ends with `C0`. Within the frame escape `C0` as `DB DC`
and `DB` as `DB DD` (SLIP). The decoded bytes are:

| Field | Bytes |
| --- | --- |
| Magic | ASCII `LB` |
| Version | `01` |
| Payload length | uint16 little endian, 1–512 |
| Payload | Exactly the declared length |
| CRC | IEEE CRC32, little endian, covering magic through payload |

CRC test vector: ASCII `123456789` gives `CBF43926`. CRC detects corruption;
it is not authentication. Parsers use a fixed 521-byte buffer, discard overflow,
malformed escapes, unknown versions and CRC failures, and resynchronize at the
next delimiter. There is no arbitrary input allocation or diagnostic command
execution. Release diagnostics are suppressed while USB owns the editing lease.

## Identification and lease

Payloads share the existing transfer packet shape: operation byte, uint16
request sequence, uint32 offset/value, optional data. All integers are LE.

- `70`: handshake, exactly seven bytes. Firmware answers `71`, same sequence,
  value 1, JSON `{product:"LanyardBadge",protocol:1,id:"<16 hex>",packetBytes:512}`.
- `72`: close/cancel, exactly seven bytes. Invalidates session and staged upload.
- `73`: heartbeat, exactly seven bytes, no response. Keeps the lease alive.

Only one adapter owns the device API. A handshake cannot take a live BLE lease.
Without valid frames for 30 seconds USB releases ownership. An incomplete
request/response or header times out at 15 seconds. The browser heartbeats every
10 seconds and reconnects through a fresh handshake after failure. Heartbeats
keep the lease alive but do not extend an incomplete transaction's deadline.

## Shared transactions

Operations 1–6 reuse `Transfer` / `PacketTransport`:

- `4`: request header fragment, offset is the accumulated byte position. Header
  JSON contains method, path, token, length; maximum header size is 512 bytes.
- `1`: start request. Body lengths are bounded to 24 KiB for JSON, exact BMP size
  for still artwork and 1 MiB for animation. Pair request is limited to 256 bytes.
- `2`: body fragment at the exact next offset, at most 505 bytes.
- `3`: finish request at exact declared length. Commit only after full validation.
- `0`: firmware ACK with accepted offset; browser waits before the next chunk.
- Responses use `1` (length plus uint16 status), `2` (offset plus data), `3` (end).
  Browser sends `5` with accepted offset after each response data chunk.
- `6`: abandon previous transaction/session; requires a fresh API session.

Request IDs reject delayed responses; offsets reject reordered chunks. CRC
failures cause an inactivity timeout rather than replaying potentially committed
mutations. Reconnect and read current metadata before deciding to retry a commit.

`POST /api/pair` on USB creates a short-lived random API token and returns a
status/deck snapshot without requesting or disclosing the BLE ownership key.
All subsequent operations require that token. USB authority comes from physical
access and browser permission. It is not a remote authorization mechanism.

The status contains `deviceId` (stable chip identity), `cacheEpoch` (public,
persistent random cache namespace, not a credential) and `serialProtocol:1`.
USB and BLE workspaces use that identity, independent of browser transport IDs
or device names. A future factory reset must clear the `badge-v2` cache epoch
along with other application data.

## Installer and recovery

The editor closes readers/writers and the port before presenting the installer.
No upload may be running during handoff. Closing the installer rechecks authorized
ports and reidentifies firmware. First-install/upgrade and OS permission prompts
still require user actions. Drafts stay in their device workspace on connection
failure; page reload does not promise preservation of uncommitted original files.

## Verification boundary

Host tests exercise bounded parsing, escaping, single-bit corruption, truncation
and resynchronization. Browser tests simulate byte-stream fragmentation, still
and animation transfers, settings, handshake failure, cancellation, timeout and
unplug/reconnect. These do not validate real CH340 signals, OS permission UI,
flash handoff or sustained hardware performance.

Hardware acceptance must include Windows Chrome/Edge and Linux Chromium,
readback of exact uploaded BMP/LBA bytes, settings persistence across reboot,
cable removal at each transfer stage, alternative baud-rate measurements, and
installer ownership handoff. Back up and verify the owner's flash before flashing;
factory-reset tests additionally require explicit owner approval.
