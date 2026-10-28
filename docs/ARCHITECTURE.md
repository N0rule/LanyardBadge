# LanyardBadge artwork architecture

## Hardware and display ownership

Classic ESP32-D0WD-V3, 4 MB flash, no PSRAM. Portrait 240 × 320, rotation 0,
USB down. Libraries remain pinned in `platformio.ini`; no new firmware library.
LovyanGFX owns SPI2, XPT2046 owns SPI3 on the original pins. The ST7789 bus stays
at the proven 40 MHz. There is no TE input in the verified board wiring. Software
buffering cannot guarantee tear-free output without controller synchronization.
No unverified GPIO is driven to obtain TE; physical tearing assessment remains
necessary.

One aligned 15,360-byte stripe buffer serves both rendering paths. Full-screen
artwork streams ten 32-row stripes from validated RGB565 BMPs, reversing each
bottom-up stripe in place. It avoids LVGL's repeated per-row decoder work and
filesystem allocations. No full-screen framebuffer or extra sprite is allocated.
The loop polls touch between stripes. A whole artwork transition remains a
bounded synchronous operation; BLE acknowledgements and menu input wait until
that transition finishes. Full-screen transitions therefore still have a visible
scanout possibility, documented rather than described as tear-free.

LVGL draws menus, calibration, onboarding and upload overlays using its existing
48 KiB allocator. The direct artwork path disables LVGL invalidation and skips
its handler until ownership returns to LVGL. Menu entry rebuilds once, invalidates
the screen, and resumes LVGL. Display/slideshow settings update existing button
labels in place, retaining scroll position and reducing partial redraws. Upload
percentages update only when their integer value changes. Static artwork has no
continuous redraw or animation. SPI transfers remain synchronous: measurements
support removing decoder overhead before adding DMA buffer ownership complexity.

## Inactivity and touch

`ScreenActivity` is a portable, tested state machine with wrap-safe millisecond
arithmetic. Timeout values are 0/15/30/60/120/300/600 seconds (0 means Never), with
120 seconds as the new default. Sleep writes physical PWM zero without changing
saved brightness. LVGL stops rendering; raw resistive pressure polling continues.
The first stable waking press is consumed until release, independently of whether
calibration is saved. Slideshow timing restarts when artwork becomes eligible
again. Uploads and calibration keep the screen awake.

Factory mapping uses the coefficients retained from the supplied board's prior
four-corner calibration. It is usable even with `valid=false`; that flag describes
user calibration, not permission to use touch. Calibration is optional under
Settings → Advanced. BOOT held two seconds opens the QR, six seconds opens touch
recovery; no power-loss reset or flash erase is involved.

## Storage and migration

| Region | Offset | Size |
| --- | --- | --- |
| NVS | 0x9000 | 24 KiB |
| PHY | 0xf000 | 4 KiB |
| Application | 0x10000 | 2 MiB |
| LittleFS | 0x210000 | 1,984 KiB |

This preserves the live 2.1.0 layout. The starting source's larger application
partition would have overwritten stored artwork. Removing Wi-Fi, HTTP, embedded
web assets and bundled sample inflation lets BLE firmware fit the existing slot.
The upload guard also removes Arduino’s unused `boot_app0.bin` at 0xe000,
which would overlap NVS/PHY with this factory layout, and validates sector-rounded
write ranges and compiled partition addresses. Saved Wi-Fi credentials remain in the original settings for recovery; no API
exposes them. Wi-Fi editing is no longer offered. Older single-sketch or 2.5 MiB
layouts need a backup and explicit offline migration, not this update manifest.

Schema 4 uses a separate CRC-checked NVS key `settings4`, preserves and migrates
validated `settings3` and original `settings` blobs, and adds the device's saved
dark/light theme. Schema 3 introduced timeout, provisioning and a device-specific
pairing key. Normal selection/setting changes coalesce for
1.5 seconds; restart flushes pending writes. Provisioning also derives from a
valid manifest and an available image at boot, so interrupted NVS writes cannot
strand a successfully saved first card. Corrupt settings fall back to retained
v2 or safe defaults.

LittleFS is never formatted on an ordinary mount failure. Initialization first
checks **every byte** of the asset partition is erased (0xff). Nonblank damaged
storage is left intact. Images upload to a temporary file and are checked for
exact dimensions, byte count and RGB565 masks before rename. Card metadata uses
CRC validation, verified temporary writes, current/backup generations and revision
conflict detection. Garbage collection preserves images used by either generation.
An interrupted asset upload never replaces the current manifest. Zero through ten
cards are supported; an empty collection returns to QR onboarding. Legacy profile
and custom cards still parse/render on the badge; only artwork creation appears
in the editor.

## BLE and browser

`Network` is now a transport-neutral device API despite its historical name.
NimBLE callbacks copy bounded packets to a four-entry queue; the Arduino loop
alone mutates files, settings and LVGL. Overflow or timeout aborts a transfer and
disconnects; no callback performs filesystem I/O or draws a screen.

See [the protocol](API.md). Both request headers and body are chunked down to MTU
23. Writes have explicit offset acknowledgements. Response chunks also require
acknowledgements, bounding notification pressure. Browser GATT writes have an
independent queue because a notification may arrive before its ACK write promise
settles; download timeouts refresh on incoming chunks. Each packet carries a request
sequence and each queued firmware packet a connection generation. On disconnect,
partial upload and session credentials are discarded. A 15-second inactivity
timeout applies per active transfer; the whole card may take longer.

The link uses encrypted GATT with NoInputNoOutput pairing and retained bonding
keys. The central establishes security through encrypted GATT access rather than
racing service discovery with a peripheral-initiated SMP request. Physical editor
revocation retains the OS bond and rotates application credentials. This avoids
one-sided bond deletion breaking Linux reconnection. This is combined with application-level
ownership through a random per-device credential. A four-letter code is derived
from it without changing the settings schema. Manual code and QR-code pairing are
accepted only while the physical connection screen is open. Five failed attempts
block pairing for 30 seconds, including across disconnects (until reboot).
The QR carries the short code in its fragment, which is removed immediately.
Successful encrypted pairing returns the strong credential as well as a temporary
session token. With Remember enabled, the browser saves its device ID and strong
credential in localStorage; subsequent visits use `getDevices()` and reauthenticate
without showing a chooser or requiring code entry where supported. Unavailable
devices remain disconnected. Forget badge clears browser access data while
preserving editor changes; physical Settings → Advanced → Revoke editor access
rotates the credential/code and disconnects editors. Legacy strong
QR keys remain accepted for compatibility. A photographed short code remains
usable while the connection screen is open until revoked. BLE encryption without
MITM protection is not a substitute for the ownership check. Browser
support depends on OS, Bluetooth daemon/agent and secure Web Bluetooth support.
Linux Chromium may need one initial pairing in system Bluetooth settings; an
active desktop pairing agent is required. A running daemon alone is insufficient.

Protocol 2 adds an encrypted operation-6 session reset, acknowledged before
authentication. Page reloads can leave the physical BLE connection alive while
abandoning an artwork response. The reset closes that response, aborts temporary
uploads, revokes the previous API session and accepts a new random sequence.
Committed artwork is untouched. Late response acknowledgements are ignored.
The browser also supports protocol 1 and briefly retries GATT teardown races.
Each browser session owns cancellable writes and API queues. Disconnect rejects
those operations; queued requests from the previous session cannot enter the new
queue or change its sequence. Same-page reconnect explicitly stops/restarts the
notification subscription, since native BlueZ/Chromium state can otherwise retain
"notifying" while the peripheral's subscription has been lost.

Advertising carries the complete device name in its primary packet and the
service UUID in its scan response. Browser filters accept either identity field,
then verify the real GATT service. A bounded firmware watchdog restarts missing
advertising while disconnected; it does not reset an active connection.

`web/transport.js` separates operations from GATT packets. `artwork.js` supplies
one original-image transform for preview and RGB565 export: rotate, fit/fill
scale × zoom, then screen-space translation. Movement percentages describe the
allowed travel range, positive right/down, and clamp to prevent holes in Fill.
Pointer capture, cancellation and requestAnimationFrame keep dragging bounded.
Loaded originals are retained during editing; saves do not resample the source.
Transforms persist when selecting other cards in the tab; after reconnect/reload,
previously saved cards start from their flattened on-device artwork.

## Design and deployment

Disconnected visitors see a landing page with Connect and Install firmware only;
the editor is hidden before first paint. Connection exposes the gallery/editor.
Empty previews use theme-independent neutral gray, without sample artwork. Saved
cards remain intact. Disconnect hides the editor while retaining unsaved state
for reconnect. Light mode uses white surfaces; device theme is independent.
Device submenu arrows return to their parent, and only the main menu closes to
artwork. Release menus omit diagnostics; benchmark commands require an explicit
`BADGE_DIAGNOSTICS=1` build. Serial status remains available for support/testing.

The frontend-design skill guided a symmetrical charcoal enclosure as the focal
object, local Montserrat headings, quiet mist surfaces, cobalt controls and coral
unsaved feedback. Themes use semantic tokens and initialize before CSS. On mobile,
the preview and controls precede the collection. No fake hardware chrome or theme
filter is applied to artwork.

GitHub Actions tests the editor and portable firmware core, builds pinned firmware,
and publishes static `web/` plus a firmware directory named for the deployed commit.
Script/style URLs include the commit to prevent old cached transport code being
loaded by a new page. Older packages remain in workflow artifacts for GitHub’s
configured retention period; Pages serves the current deployment. USB uses locally
vendored ESP Web Tools 10.4.0, loaded only when requested. Fresh and update manifests
are separate; updates contain only the application at 0x10000. Neither includes a
filesystem or NVS image. The installer prompts explicitly about erasure and leaves
it unchecked. No OTA support is advertised. No backend or user account is required.

Primary implementation references: [LVGL 9.2 display ownership](https://docs.lvgl.io/9.2/porting/display.html),
[Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth),
[ESP Web Tools](https://esphome.github.io/esp-web-tools/), and pinned library sources
under PlatformIO's dependency directory.

## Upload presentation

The release upload screen is an opaque LVGL top layer using the saved device
palette. Its objects are allocated once per transfer; integer percentages only
update the existing label and progress fill. Underlying menu/artwork redraws and
touch actions pause while this layer owns the display. Inactivity and slideshow
remain paused until it is dismissed. No framebuffer or animation layer is added.

The API reports Receiving → Saving → Complete. Accepting an asset file is not
completion: Saving stays visible until the atomic card manifest commit succeeds.
A failed transfer/commit shows Upload stopped; existing card metadata stays valid.
A disconnect aborts the temporary asset and shows the failure state. Successful
and failed results remain for 1.2 seconds before normal rendering resumes. A
45-second abandoned metadata stage also releases the UI; the BLE packet timeout
continues to handle interrupted byte transfers separately. Serial status exposes
`uploadStage` and `uploadPercent` for validation without adding release controls.

The website keeps gallery / badge / editor columns. A fresh draft begins with a
neutral preview and a file chooser; rotation/crop controls appear once a source
image exists. The filename supplies a default ASCII title without replacing a
custom title. Local thumbnails use the same artwork transform as export. Source
images remain unresampled between edits. File decoding and upload lock navigation
to keep operations attached to the intended card; failures retain the edit state.

## Browser artwork cache and loading (2.3.4)

The badge remains authoritative for card metadata. An opt-in pairing snapshot
returns fresh metadata and status in the authenticated response; older firmware
falls back to the existing reads. The editor does not display a connected state
based on cached metadata or open a saved collection without real authentication.

Immutable artwork bytes are cached in IndexedDB by browser-granted badge ID,
SHA-256 credential fingerprint and artwork ID. Credential rotation changes the
namespace, including after a fresh installation. Records include a byte digest
and BMP validation; corrupt records become misses. The disk cache retains at most
64 assets; its memory front retains 20. Storage denial/quota/blocked operations
fall back to memory or a normal device read. Forget badge clears its artwork
cache. These disposable copies never replace the badge's files or store additional
copies of pairing credentials. Unsaved in-memory workspaces stay bound to badge
identity when switching devices.

The selected card loads lazily; other gallery thumbnails hydrate from local cache
only. Concurrent requests for the same preview are coalesced. Uploads seed the
cache with the BMP already prepared on the client, including before metadata
retry; no image read-back is needed. Cropping, rotation, resizing, RGB565 encoding,
preview decoding and thumbnails run on the client. The badge receives final
validated display-ready pixels and commits its own files/metadata.

Uncached reads on 2.3.4 use authenticated bounded ranges (up to 4096 bytes), with
relative response offsets and strict range validation. Between ranges, queued
foreground requests can run. Changing cards, choosing artwork or disconnecting
cancels remaining reads without resetting the BLE session. Older firmware retains
its full-file path. First uncached previews still need one complete image transfer;
range framing adds overhead in exchange for responsiveness. Partial images are
never installed or cached. Current client transforms/generation checks prevent a
late download from overwriting newer edits.
