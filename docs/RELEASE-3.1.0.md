# LanyardBadge 3.1.0

Bluetooth editing no longer requires Windows pairing. Connect on the website,
then enter the four letters shown automatically on the badge. Codes are
case-insensitive, expire after two minutes, and authorize only that connection.
Five wrong attempts trigger a 30-second lockout across reconnects. Codes are
never persisted by the browser or returned in device status.

USB remains code-free. Factory reset remains touch-confirmed. The device now
has Disconnect editor instead of a menu for removing stored Bluetooth bonds.

Update firmware over USB and refresh the website. This release adopts a new,
persisted Bluetooth identity once so old Windows pairing records cannot block
it. Select the newly advertised badge in the website's chooser. Old Windows
entries can remain; subsequent factory resets preserve the public radio identity
and do not create or require operating-system bonds.

The four-letter code provides basic access control, not encrypted transfers.
Nearby interception remains possible, as explicitly accepted for this product.
Windows end-to-end behavior must be confirmed on the user's Windows PC; host
and mock-browser tests cannot establish platform compatibility.

Validation: firmware build, host checks including expiry/lockout/single-use code
policy, and all 59 browser tests pass. USB, cache, image/GIF and draft coverage
remain; obsolete native-PIN tests are replaced with code-dialog coverage.
