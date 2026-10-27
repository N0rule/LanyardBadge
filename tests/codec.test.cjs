const assert = require('node:assert/strict');
require('../web/app.js');
const { encodeBMP, decodeBMP, cropRect, validateCard } = global.BadgeCodec;
const rgba = new Uint8ClampedArray(240 * 320 * 4);
for (let y = 0; y < 320; y++)
  for (let x = 0; x < 240; x++) {
    const i = (y * 240 + x) * 4;
    rgba[i] = x;
    rgba[i + 1] = y % 256;
    rgba[i + 2] = (x + y) % 256;
    rgba[i + 3] = 255;
  }
const encoded = encodeBMP(rgba),
  decoded = decodeBMP(encoded);
assert.equal(encoded.byteLength, 153666);
for (let i = 0; i < rgba.length; i += 4) {
  assert.ok(Math.abs(rgba[i] - decoded[i]) <= 7);
  assert.ok(Math.abs(rgba[i + 1] - decoded[i + 1]) <= 3);
  assert.ok(Math.abs(rgba[i + 2] - decoded[i + 2]) <= 7);
  assert.equal(decoded[i + 3], 255);
}
assert.throws(() => decodeBMP(new ArrayBuffer(20)));
const corrupt = encoded.slice(0);
new DataView(corrupt).setUint32(54, 0, true);
assert.throws(() => decodeBMP(corrupt));
assert.deepEqual(cropRect(640, 480, 240, 320), {
  x: -93.33333333333331,
  y: 0,
  w: 426.66666666666663,
  h: 320,
});
const fit = cropRect(640, 480, 240, 320, 'contain');
assert.equal(fit.w, 240);
assert.equal(fit.h, 180);
assert.equal(fit.y, 70);
const c = {
  title: 'Test',
  name: 'Hi',
  description: 'two\nlines',
  url: 'https://example.com',
  texts: [],
  shapes: [],
};
validateCard(c);
assert.throws(() => validateCard({ ...c, url: 'javascript:alert(1)' }));
assert.throws(() => validateCard({ ...c, name: '中文' }));
console.log(
  'Browser codec: RGB565 precision, row order, BMP validation, crop math and text validation passed',
);
