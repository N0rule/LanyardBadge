# LanyardBadge 3.0.1

Device navigation is touch-only. Factory reset now presents Cancel and Erase
everything on the touchscreen, for both local and website-initiated requests.
Opening that screen does not erase data; confirmation expires after 60 seconds.
No application workflow reads BOOT or another hardware button. Existing touch
mapping and artwork remain unchanged during updates.

Connect from the website on the PC. USB opens its session directly; Bluetooth
shows the native pairing PIN automatically when a new computer initiates pairing.
The former enrollment-window gate and Connect to editor menu action are removed.
Encrypted, authenticated Secure Connections and the displayed six-digit PIN are
still required for new Bluetooth bonds. Previously bonded editors reconnect normally.

The main menu contains Display and Settings, with Gallery and Slideshow shown
only when multiple artworks exist. Settings shows the device name directly,
theme, Forget paired editors and Factory reset. Separate name, information,
advanced, restart and storage-setup pages are removed.

Validation: firmware build, host validation and the 64-test browser suite.
The browser reset test checks touch-confirmation guidance and that a request
alone preserves the collection. Destructive reset and real new-PC BLE pairing
still require physical acceptance; they are not inferred from mock tests.
