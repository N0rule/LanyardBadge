# 2.3.4 connection and draft recovery

Current result: browser-first PIN pairing and bonded reconnect were verified on
Windows with Helium and Badge-287E, with the unsaved edit retained. The final
security design and remaining checks are at the end of this chronological record.

## Investigation and scope

Remote main was checked before edits: 6ee8edfc59093f3fe9b1ee80581736a50d43f0cf.
The reported Actions run has a real title-preservation assertion failure. The
unchanged test passed 73 focused repetitions locally (3 serial, 70 concurrent),
and also passed in the initial full-suite run. Its exact intermittent cause is
**not established**; these results must not be described as a deterministic
reproduction or a verified fix for that particular CI execution.

Inspection established separate data-loss defects: reconnect overlaid all local
cards when any field was dirty, discarded additional local drafts once ten remote
slots were filled, and adopted a remote revision without conflict review. A save
also cleared the collection dirty flag while other cards could still hold dirty
source artwork. These paths are now covered by explicit reconciliation and tests.

## State ownership

Workspaces belong to browser-granted Bluetooth device IDs, independently of the
credential-derived artwork-cache namespace. Drafts remain in this tab's memory;
closing or refreshing a tab does not persist unsaved source images. Committed
metadata is cloned separately from the editable deck. Reconnect overlays only
cards whose metadata differs from that baseline or whose source artwork is dirty.
New and remotely deleted edited cards survive, even if that temporarily exceeds
the ten-card device capacity. Reduce the collection before saving in that case.
Local ordering is retained. Unedited cards refresh from authoritative metadata.

A changed remote revision raises a conflict notice. Saving asks explicitly before
replacing that revision with the reviewed collection. A subsequent remote write
still fails the firmware's revision check. Reload collection asks before discarding
local changes. Canceled reload and failed authentication retain sources, selection,
transforms, dirty state, and pending uploaded asset IDs. Successful saves retain
other cards' dirty artwork and reuse pending assets after a failed metadata commit.

Metadata requests check load generation, transport session and badge identity.
Artwork responses additionally check abort signal, asset ID, cache scope and
whether a newer source already exists. Old service-discovery continuations and
notification listeners cannot replace or disconnect a newer transport session.
Workspace switching does not close images still owned by another workspace.

## Initial BLE security decision (superseded by the passkey profile below)

Protocol versions 1 and 2 and firmware storage layout are unchanged. The TX HELLO
read requires encryption; RX writes do too. GATT connection and service discovery
are not themselves configured to require pairing. In this client's sequence,
`tx.readValue()` triggers security before notification subscription and before
`POST /api/pair`. Removing that read simply defers security until an encrypted
write, rather than removing the requirement safely. Subscription failure is now
reported separately. Generic read errors are not proof of rejected pairing.

The pinned NimBLE-Arduino 2.5.1 configuration requests bonding, no MITM, and Secure
Connections with NoInputNoOutput. Just Works avoids numeric entry, but does not
promise absence of host consent. Windows supports ConfirmOnly ceremonies and
Chromium can initiate pairing on protected characteristic access. An existing
Windows bond with missing peripheral keys can fail without a new pairing attempt;
Chromium's on-demand path tests whether the host already considers it paired.
NimBLE's repeat-pairing handler deletes the peer's old bond and retries, but that
cannot remove a stale bond from Windows. No automatic credential or bond erasure
has been introduced. Remove an old OS pairing once only after a repeated security
failure on a previously paired badge; it is not a normal reconnect step.

Retain native BLE encryption for this patch. It uses the existing stack and adds
no crypto buffers or flash overhead. It protects credentials against passive
radio capture when Secure Connections is negotiated. **Just Works does not
authenticate the peripheral against an active MITM**, and enabling SC support is
not equivalent to enforcing SC-only mode. QR/API ownership authorization does not
repair that limitation. This patch must not be advertised as MITM-resistant.
Short-code enrollment still requires the physical connection screen and existing
five-failure/30-second throttling; API sessions expire after 20 minutes of inactivity.
Revocation and interrupted-transfer cleanup retain their firmware behavior.

Eliminating native pairing safely would require a versioned application protocol
using an independently reviewed authenticated key exchange (e.g. a standard
PSK-authenticated handshake for high-entropy QR credentials, plus an appropriate
PAKE/physical enrollment design for short codes), authenticated device identity,
HKDF-derived directional AEAD keys, unique nonces, counters, transcript binding,
expiration and revocation. Web Crypto and ESP32 cryptographic libraries supply
primitives, not this complete interoperable enrollment protocol. This would add
handshake state, keys, buffering, firmware size and migration/test costs on a
non-PSRAM board. It is not implemented here; exposing the current pairing API on
unencrypted GATT would disclose its long-lived credential.

Linux/BlueZ can require a desktop pairing agent and can retain native notification
state after disconnect. Android uses its own system pairing UI and Chromium's
Android backend; desktop retries do not establish Android or Windows behavior.
Encrypted-read retries are bounded to three reads for transient stack errors,
rather than repeatedly issuing reads for 45 seconds. These retries are not a
solution for stale bonds or denied consent. The application reports service,
characteristic, subscription, security-read and explicit security rejection
separately where the browser exposes enough information. Opaque UnknownError
cannot reliably distinguish a bond mismatch from a radio/driver failure.

Sources:

- [Espressif NimBLE security levels and SC-only configuration](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32/api-reference/kconfig-reference.html)
- [NimBLE security configuration](https://h2zero.github.io/NimBLE-Arduino/class_nim_b_l_e_device.html)
- [Chromium protected-characteristic and notification pairing paths](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/bluetooth/web_bluetooth_service_impl.cc)
- [Windows pairing ceremonies](https://learn.microsoft.com/en-us/uwp/api/windows.devices.enumeration.devicepairingkinds)
- [Bluetooth Core LE security and association models](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core-54/out/en/architecture%2C-mixing%2C-and-conventions/architecture.html)

## Validation and Windows release gate

The expanded 48-test browser suite passed, as did ten serial repetitions of the
original title-preservation regression after changes. The title assertion remains
unchanged. CI now retains failure traces/screenshots for intermittent diagnosis.
Host C++ ASan/UBSan, codec/GIF/layout checks and cyd2usb compilation passed.
Static RAM: 73,760 / 327,680 bytes. ELF flash sections: 1,640,159 / 2,097,152.
Actual binary: 1,686,832 / 2,097,152 bytes. NVS remains 0x9000, LittleFS
0x210000; neither partition nor firmware source was changed or flashed.
Installer/site packaging, SHA-256 and manifest/flash-bound validation passed.

An actual ESP32-D0WD-V3 rev 3.1, 4 MB, no PSRAM board at /dev/ttyUSB0 was queried.
Read-only Linux BLE validation passed at MTU 517: encrypted authentication,
snapshot and separate metadata, full 153666-byte BMP, ranged equivalence and
invalid range rejection, unchanged two-card collection, revision and settings.
This is separate from mocked browser tests. Initial validation did not include a Windows radio test; the later user-assisted captures below supersede that limitation.

Before claiming Windows reliability, test current Edge and Chrome on Windows 11:

1. Clean host pairing: chooser, system consent if requested, then QR/code auth;
   verify no Connected label before authorization and metadata completion.
2. Reconnect five times and refresh during a preview transfer; no routine trip to
   Bluetooth settings should be needed. Confirm title/source/transform retention
   for same-tab reconnect (refresh intentionally ends an in-memory draft).
3. Interrupt an upload, reconnect, and retry; verify source and pending asset reuse.
4. Revoke the ownership key physically; old key must fail, repeated wrong codes
   must throttle, correct physically authorized code must recover the same draft.
5. Update firmware without erase; verify NVS/LittleFS/card content and selection.
6. Exercise a stale bond deliberately on test hardware. Check the security-stage
   diagnosis and one-time Windows removal recovery, without erasing user storage.
7. Disable Bluetooth, cancel chooser, deny consent, disconnect during discovery,
   and fail subscription; verify each recovery message and preservation of edits.

Remaining gates: exact CI title-reset cause and Windows/Android radio validation.
Do not infer those from Linux tests.

Deployment verification: code commit `61e5b21b82255f4c3c7feb067590b3dcf35e7333`
passed [Actions build and Pages deployment](https://github.com/N0rule/LanyardBadge/actions/runs/40676476821).
The canonical site served revisioned script URLs `61e5b21b8225`; downloaded app.js
and transport.js matched the committed files byte for byte. The public update
manifest identified `2.3.4-61e5b21b8225`, with only firmware.bin at 0x10000.
The existing installer erase choice remains: leave Erase device unchecked.
A Windows tester is available; their results are pending.

## Follow-up: “Previous Bluetooth session closed” during initial Windows connection

A Windows tester reported this message before the editor opened. Mocked native
GATT tests reproduced the identical message when discovery returned successfully
as a disconnection invalidated the session. The existing guard treated both a
lost link and a deliberately superseded session as a generic Error. Consequently,
the bounded connection retry loop, which accepts NetworkError/UnknownError, did
not retry this transient disconnect.

Session guards now retain the originating AbortController. A disconnect of that
same session is a NetworkError at the GATT stage; an operation from an independently
replaced session remains an AbortError and cannot disconnect the replacement.
Duplicate loss callbacks are idempotent, and a delayed disconnect event does not
invalidate a replacement whose GATT connection is already established. Pairing
and metadata guards use the same distinction.

A second deterministic test reproduced the identical toast when an aborted
artwork-cache promise rejected after a replacement session had connected. Canceled
preview promises now finish silently, while failures in a current preview still
propagate. This prevents an old request from changing the replacement preview's
help text or reporting a false connection failure.

All three new regressions failed before their fixes. These are mocked timing
reproductions, not evidence that either sequence caused the tester's Windows
radio failure. Native Windows pairing, encryption, firmware and credentials are
unchanged. Windows retesting of the follow-up remains necessary.

Follow-up release `58a7d52e3f63680edba071321602dca6742b0aa1` passed all 51
browser tests, 12 focused repeated regressions, host checks and package validation.
[CI build and deployment passed](https://github.com/N0rule/LanyardBadge/actions/runs/40678468319).
The canonical index references `58a7d52e3f63`; served app.js and transport.js
matched the committed files byte for byte.

The Windows tester confirmed accepting the system prompt, seeing the error before
the editor opened, and seeing the same error after clearing website data on the
previous release. They also previously used the badge from Linux. A subsequent
read-only BlueZ check on this development host showed Paired=true, Connected=false,
ServicesResolved=false: its stored bond was not occupying the active connection.
The configured limit is one simultaneous connection; the pinned NimBLE default
allows three stored bonds. A stored Linux bond is distinct from an active GATT
connection. Windows retesting on the follow-up release remains pending.

## Windows radio capture: link security rejected by the central

The tester confirmed Badge-287E is the development board attached through CH340.
On the deployed follow-up website, the sequence remained Connecting, Pairing,
Disconnected. Clearing site data did not help. Windows Settings did not list a
badge bond to remove. Its screenshot showed a CSR8510 A10 entry with incomplete
setup on a metered network; this is a setup clue, not proof of adapter failure.

The first bounded serial capture observed real Windows connections at a 60 ms
initial interval, no active encryption, no additional stored bond, and disconnect
codes 531 (0x200 + HCI 0x13, remote termination) and 534 (0x200 + HCI 0x16, local
termination). The existing authentication callback disconnects an unencrypted
connection after a failed security procedure. Opening this board's serial port
restarted it and cleared historical diagnostics, so capture used a single open
port rather than repeatedly opening it.

A passive GAP listener now retains `bluetoothSecurityStatus` and
`bluetoothSecurityEvents` in status diagnostics. It does not change security
configuration, accept pairing, remove bonds, or record keys/PINs. Status is the
last NimBLE encryption-change event result; events is its count since boot.
Status zero with zero events means no result yet, not successful authentication.

A fresh private full-flash backup of 4,194,304 bytes was preserved before flashing.
The on-device partition table matched the expected layout. Only the application
at 0x10000 was written and esptool verified its hash. The diagnostic binary is
1,687,904 / 2,097,152 bytes; static RAM is 73,776 / 327,680. Host checks, all 51
mocked browser tests, compilation and site/manifest validation passed. Actual
post-update captures retained the same two cards and revision 4.

On the next user-assisted Windows attempt, all three security events reported
**1292 / 0x50C**: `BLE_HS_SM_PEER_ERR(BLE_SM_ERR_NUMCMP)`. The pinned NimBLE source
constructs the 0x500 peer-error base from a received SMP Pairing Failed reason;
0x0C is Numeric Comparison Failed. Encryption never became active. This proves a
peer-side SMP rejection before application authentication, not its ultimate UI
or driver cause. It does not prove the user rejected a prompt or that numeric
comparison was the negotiated association model; the badge advertises NoInputNoOutput.

Relevant primary sources:

- [Bluetooth SMP failure codes](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core-62/out/en/host/security-manager-specification.html)
- [Chromium WinRT pairing handling](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/device/bluetooth/bluetooth_pairing_winrt.cc)
- [Chromium default feature settings](https://raw.githubusercontent.com/chromium/chromium/main/device/base/features.cc)

Chromium's ConfirmOnly/ConfirmPinMatch paths require
`kWebBluetoothConfirmPairingSupport`, disabled by default in current upstream
source. ProvidePin uses a separate supported path. This is a concrete browser
compatibility concern for the current Just Works setup, but the tester's browser
configuration/version and a direct Windows Add device test remain unverified.
A browser flag is not the production fix. Direct Windows pairing was requested
as a diagnostic comparison; its outcome is pending. Native security must not be
removed or changed to an insecure transport just to hide this rejection.

## Diagnostic Windows Settings workaround (superseded)

Windows Add device initially hid Badge-287E. A passive Linux scan confirmed that
it was advertising its custom GATT service, without opening a connection. After
selecting Show all devices in Windows, the tester supplied a screenshot showing
“Your device is ready to go!” and Badge-287E Connected. They then reopened the
canonical website and confirmed that the editor connected successfully. No
adapter driver change, device erase, bond deletion, or reduction in BLE security
was needed. The pre-existing Linux bond was not an obstacle.

This verifies a working one-time native Windows pairing path on the actual board
and PC. It does not verify that browser-initiated first-time pairing is reliable.
The browser path emitted peer SMP rejection 0x50C; the native Windows path succeeded
with the same firmware/security configuration. Upstream Chromium's disabled
ConfirmOnly support is consistent with that difference, but the tester's exact
browser version/feature configuration was not captured. The source flag alone
must not be presented as proof of their exact browser configuration.

At this diagnostic stage, the workaround was:

1. Pair once using Windows Settings → Bluetooth & devices → Add device → Bluetooth.
2. Choose Show all devices if the badge is hidden. On older builds, select Advanced
   under Bluetooth devices discovery instead.
3. Select the badge, finish Windows pairing, then connect from the website.
4. If the website requests its separate access code, open the badge connection
   screen with BOOT held about two seconds, then enter the displayed code.

Keep the Windows bond for subsequent connections; ordinary reconnects should not
need Windows Settings. Clearing website data does not establish or remove an OS
bond. Do not remove unrelated devices when the badge is absent from Settings.

[Microsoft's discovery-filter guidance](https://support.microsoft.com/en-us/windows/hardware/bluetooth/fix-bluetooth-problems-in-windows)
and [the Show all devices workflow](https://blogs.windows.com/windows-insider/2024/02/08/announcing-windows-11-insider-preview-build-26052-canary-and-dev-channels/)
explain why the badge can appear in the browser chooser but initially be hidden
in Windows Settings.

The browser now retains a security-operation marker across connection loss, so
an encrypted-read failure can offer this verified Windows recovery instead of a
generic connection error with Linux advice. The guidance stays visible on the
landing screen and clears after successful authentication. Failures before the
security read remain classified as GATT connection failures and do not suggest
pairing. No browser flags are required or recommended.

In response to the Windows same-tab unsaved-edit disconnect/reconnect check, the
tester reported that Helium works fine. Brave also connected, but failed after F5;
they reported enabling Bluetooth support with browser flags and explicitly chose
Helium for future testing. Treat Brave refresh behavior as a remaining limitation,
not as a proven flags-related cause. Helium page-refresh reconnection was not
separately confirmed. Do not claim stable Chrome/Edge testing from these results.
Unsaved original artwork lives in tab memory and does not survive an F5 refresh;
this is separate from reconnect preservation and cached committed artwork. The protocol-2 GATT framing, ownership mechanism, partition
layout, NVS credentials and stored artwork remain compatible.


## Final connection design: browser-initiated authenticated PIN pairing

The tester removed the Windows bond and reproduced the browser failure again.
They correctly rejected requiring Windows Settings as the normal connection flow.
The final firmware therefore replaces NoInputNoOutput with DisplayOnly and requires
bonding, MITM authentication, LE Secure Connections only and 128-bit link keys.
RX WRITE_AUTHEN and TX READ_AUTHEN retain encryption and reject unauthenticated
access. The new explicit link-security profile is `sc-passkey-v1`; wire protocol 2,
UUIDs and framing stay unchanged to allow existing open tabs to reconnect and save
in-memory edits before refreshing. Old protocol-1/2 firmware remains supported with
its original policy, without claiming the new security properties for it.

A fresh uniform six-digit PIN appears only on the physical badge. The browser's
native ProvidePin path accepts it directly; Windows Settings and experimental flags
are not required. PIN state crosses BLE/main-loop tasks atomically, is never logged,
persisted or exported, and clears on authentication/disconnection. A 60-second
expiration and physical Cancel stop the link. The existing ownership credential,
physical four-letter enrollment requirement, five-failure/30-second application
throttle, API session expiry and revocation remain in force. Credentials are never
sent over an unencrypted application transport. This is a standard BLE security
association, not a new custom cipher or an application-layer crypto protocol.

Compared with the old Just Works flow, physical PIN entry adds MITM protection and
uses Chromium's supported ProvidePin ceremony. Compared with application-layer AEAD,
it avoids implementing a new authenticated handshake, PAKE enrollment, nonce/counter
management and migration on the no-PSRAM board. It retains native OS BLE pairing,
but lets users complete it from the browser. A legacy unauthenticated bond gets one
standard security-upgrade attempt; failure closes the link. Old-bond upgrade across
Windows/Linux/Android is not yet radio-verified and may require removing that badge's
stale OS bond once. Neither code path erases ownership settings or artwork.

Connected transient protected-read errors have a 45-second retry deadline to allow
native PIN entry. A pending native GATT read itself is governed by the host stack;
the deadline does not impose a browser-level timeout on that read. Explicit rejection,
cancellation, lost connection and superseded sessions stop retrying. Retrying alone
is not the pairing fix: the supported association model is. Service, characteristic,
subscription, credential, disconnect and timeout classifications remain separate;
opaque stack errors cannot prove a stale bond. Windows guidance now describes the
six-digit PIN and recommends a USB update if old firmware never displays one.

### Actual final-profile hardware and Windows results

Before flashing, a second private 4 MB backup and the existing partition table were
preserved and validated. Only the application at 0x10000 was written; esptool verified
its hash. NVS and LittleFS were not erased or migrated. The board retained two cards
and revision 4 immediately after the update. The later observed revision 5 came during
the user's editing session; the two-card collection remained present.

The user connected directly from the website on Windows using Helium and confirmed:
“Entered the PIN and the editor opened.” After making an unsaved title/artwork edit,
disconnecting through the website and reconnecting without refreshing, they confirmed:
“Reconnected without a PIN and the edit survived.” Recorded badge diagnostics show
three successful security events, an encrypted and authenticated link, one retained
bond and 15 ms initial connection intervals. The observed minimum heap during this
session was 95,828 bytes. No PIN or ownership secret was captured. These are actual
radio/user tests, separately from browser mocks. The development board is left running;
no further flash/reset is needed for the user's current editing session.

The published source additionally corrects newly generated QR links to the canonical
`https://n0rule.is-a.dev/LanyardBadge/` origin. This URL-only firmware change follows
the physically tested security binary; the final build is compiled but not reflashed
onto the active board. Do not describe the two binaries as byte-identical.

All 55 browser tests passed before documentation completion, including native PIN
wait/rejection, bond reuse, original title-preservation regression, legacy pairing,
snapshots, draft/image/transform preservation, conflicts, cache scopes and stale
sessions. Host ASan/UBSan, codec/GIF and flash-layout checks passed. Final release
build/package and deployment results are recorded below after publication.

Remaining manual checks: Chrome/Edge on Windows; Helium refresh after saving;
Brave refresh failure diagnosis; new-profile Linux/Android pairing; legacy bond
security upgrade; interrupted transfer and data-preserving final firmware upgrade.
Keep the earlier seven-step Windows plan, substituting the badge's browser PIN for
first-time Settings pairing. Refresh ends in-memory drafts, so save before F5.
The exact cause of the original CI-only title reset remains unestablished; its
assertion is retained and the independently established state-loss paths are fixed.


### Release validation and changed files

Final local validation passed: 55 browser tests (36.7 seconds), host C++ ASan/UBSan,
codec/GIF and compiled flash-layout protections, cyd2usb build, pinned installer
packaging, manifest bounds and SHA-256 checks. Static RAM: 73,792 / 327,680 bytes;
ELF flash sections: 1,644,703 / 2,097,152; deployable binary: 1,691,856 / 2,097,152.
The serial capture is bounded and finished without reopening/resetting the board.

- `src/net/Bluetooth.*`, `platformio.ini`: enforced authenticated SC passkey profile,
  temporary physical PIN and legacy-security upgrade; canonical QR origin.
- `src/ui/Ui.*`, `src/main.cpp`: themed physical PIN/cancel screen on the UI thread,
  and secret-free security diagnostics.
- `web/transport.js`, `web/app.js`: wait for native PIN completion, retain precise
  connection stages and show browser-first recovery while preserving editor drafts.
- `tests/ble-mock.cjs`, `tests/editor.spec.cjs`: realistic pending/rejected native
  security operations, bond reuse and source/title retention. Mocks do not establish
  radio interoperability.
- `README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, this record: current flow,
  compatibility, security tradeoffs, actual hardware evidence and remaining checks.

Earlier commits in this task contain the committed/draft/cache separation, workspace
reconciliation, stale-session protection and broader regression coverage described
above. No existing regression assertion was weakened, skipped or deleted.
