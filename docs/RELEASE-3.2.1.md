# LanyardBadge 3.2.1

Fix compressed artwork rendering white on the badge. Arduino's word() macro
intercepted a dictionary decoder helper call, causing immediate playback failure.
The helper is renamed readWord; a regression test compiles the decoder with an
Arduino-style word macro defined. Already uploaded assets remain valid and do
not need re-uploading. Playback diagnostics include failure line and input position.

New artwork drafts show a theme-aware dotted placeholder with a Choose artwork
action instead of a white screen. Choosing artwork replaces the placeholder.
