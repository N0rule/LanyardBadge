# LanyardBadge 3.2.0

The website now losslessly compresses repeated RGB565 pixel patterns in addition
to the existing raw/RLE encoding and GIF changed-frame rectangles. It picks the
smallest representation per frame. Still images can use the same compressed
container; photographs or random pixels fall back when compression would grow.
Compression is exact for the display-ready pixels. The existing 240×320 resize
and RGB565 color conversion are still required by the badge; source-resolution
and full-color preservation are not claimed.

GIF limits increase from 300 to 2,000 stored frames, 30 seconds to three minutes,
and 1 MiB to 1.5 MiB per prepared asset. Source artwork can be up to 100 MB, with
128 million source-pixels×frames as a decoder memory/work guard. No frames or
colors are discarded by the new compressor. Long static frame delays are split
into hold records to preserve timing. Old BMP and raw/RLE LBA files remain readable.
New encodings are gated by the firmware's artworkCompression capability.

Empty badges retain their website-connection screen after connecting. An empty
website collection shows a centered Create first card button that opens the file
picker. Canceling keeps the collection empty; selecting artwork opens its editor.

The physical flash is 4 MB. Its preserved artwork partition is 1.94 MiB. Moving
that filesystem to reclaim firmware space requires a separate storage migration;
this release increases effective capacity through compression without relocating
or erasing stored artwork. Asset size and available free space still bound uploads.
