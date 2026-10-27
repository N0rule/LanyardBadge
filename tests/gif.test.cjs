const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../web/codec.js');
require('../web/gif.js');
const { header, difference } = BadgeGIF;
assert.deepEqual(header(new Uint8Array(fs.readFileSync('tests/fixtures/disposal.gif'))), {
  width: 8,
  height: 8,
});
assert.throws(() => header(new Uint8Array(12)), /incomplete/);
assert.throws(() => header(new Uint8Array(13)), /valid GIF/);
const bad = new Uint8Array(fs.readFileSync('tests/fixtures/disposal.gif'));
bad[6] = 255;
bad[7] = 255;
bad[8] = 255;
bad[9] = 255;
assert.throws(() => header(bad), /megapixels/);
const rgba = new Uint8ClampedArray(240 * 320 * 4);
for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) % 256;
const pixels = BadgeCodec.encodePixels(rgba),
  bmp = new DataView(BadgeCodec.encodeBMP(rgba));
for (let y = 0; y < 320; y++)
  for (let x = 0; x < 240; x++)
    assert.equal(pixels[y * 240 + x], bmp.getUint16(66 + ((319 - y) * 240 + x) * 2, true));
const original = new Uint16Array(8 * 8),
  current = original.slice();
current[1 * 8 + 2] = 0xf800;
current[4 * 8 + 6] = 0x07e0;
const region = difference(original, current, 8, 8);
assert.deepEqual([region.x, region.y, region.width, region.height], [2, 1, 5, 4]);
const reconstructed = original.slice();
for (let y = 0; y < region.height; y++)
  reconstructed.set(
    region.pixels.subarray(y * region.width, (y + 1) * region.width),
    (y + region.y) * 8 + region.x,
  );
assert.deepEqual(reconstructed, current);
assert.equal(difference(current, current, 8, 8).pixels.length, 0);
assert.equal(difference(null, current, 8, 8).pixels.length, 64);
assert.throws(() => difference(null, current, 0, 8), /dimensions/);
assert.throws(() => difference(new Uint16Array(3), current, 8, 8), /dimensions/);
console.log(
  'GIF foundation: header bounds, RGB565/BMP parity, exact changed rectangles and unchanged frames passed',
);
