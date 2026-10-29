# Product release engineering record

Baseline verified against GitHub main: `29f98787d51e4ae52b0e9466da49a93903634a2f`.
This document records engineering decisions and verification boundaries; it is not a release announcement.

## Architecture audit

- `Network` is the loop-thread device API. `Assets` owns validated BMP/LBA upload,
  immutable asset IDs, revision checks and transactional deck commits. Preserve it.
- BLE previously owned packet framing and file streaming. Extract those into
  `Transfer`, shared by BLE and serial, with exclusive API ownership.
- Browser `DeviceTransport` is the application API. `PacketTransport` shares
  request correlation, bounded chunks and response validation. Separate BLE and
  USB subclasses own discovery, streams and connection teardown.
- Display, touch mapping, direct BMP rendering and bounded GIF decoding remain
  unchanged. Existing calibration data must survive schema migration.
- Current BLE uses authenticated Secure Connections plus a separate application
  code. Its removal must include physical enrollment gating, bond revocation,
  credential migration and reconnection tests together, not just removal of UI.
- Legacy profile/shape manifests now require an acknowledged reset; their files
  remain intact until confirmation. Calibration recovery must remain available internally.

## USB boundary and lifecycle

Physical access plus the browser's serial permission authorizes local editing.
USB does not request or reveal the existing ownership credential. A random,
short-lived API session is created after a versioned device handshake. Remote
factory reset still needs a physical confirmation .

Only one transfer engine can own the shared API. A competing BLE request fails
closed. Serial ownership expires after 30 seconds without validated traffic;
the browser sends a heartbeat every 10 seconds. Incomplete transfers expire
at 15 seconds. Disconnect aborts staged uploads, releases the lease and token.
Malformed data is never passed to the old line-command interpreter. Release
logging is suppressed while a serial editing session owns the port.

115200 baud is the conservative initial rate. No baud-rate performance or
CH340 reset behavior is claimed verified without hardware. Browser stream
permission and opening behavior follow the Web Serial API:
https://developer.chrome.com/docs/capabilities/serial

## Visual direction

Keep the physical 3:4 artwork screen as the focal point, with restrained controls.
Use the existing locally hosted Montserrat variable font: 14px controls, 20px
preview title, larger landing headline. Use tabular numerals for transfer status.
Light palette: white #FFFFFF, panel #F5F7FA, ink #202936, muted #627083,
blue #3659D9, destructive rose #A82B46. Dark mode retains slate surfaces and
readable pale-blue actions. Artwork supplies the visual variety.

Desktop: collection | centered physical badge and status | adjustment controls.
Mobile: collection, centered badge/status/actions, adjustments. Align the status
text itself with the badge, independent of the global paragraph measure.

Brief review: preserve the symmetric badge enclosure, avoid phone chrome,
decorative gradients, new frameworks, and generic dashboard statistic cards.
Connection choices appear only when a transport needs to be chosen.

## Completion record

USB framing and shared transfer engine, native BLE authorization, persistent
naming, recoverable physical-confirmation reset, artwork-only model, UI polish,
version centralization and packaging are implemented. No extra owner backups
were made after the request to proceed without them. Existing files were preserved
while unreferenced storage was cleaned through the device API.

See [3.0.0 release verification](RELEASE-3.0.0.md) for measured hardware results,
automated coverage and the explicit limits of physical acceptance. Historical
2.x investigation documents are marked as historical.
