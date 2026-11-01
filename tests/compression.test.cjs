const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../web/gif.js');
const { dictionary, unpackDictionary, still, parse, pack } = BadgeGIF;
let seed = 123;
for (const length of [0, 1, 3, 4, 4095, 4096, 4097, 76800]) {
  for (const pattern of ['random', 'repeat', 'solid']) {
    const pixels = Uint16Array.from({ length }, (_, i) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return pattern === 'solid' ? 123 : pattern === 'repeat' ? (i % 131) * 503 : seed >>> 16;
    });
    assert.deepEqual(unpackDictionary(dictionary(pixels), length), pixels);
  }
}
assert.throws(() => unpackDictionary(Uint8Array.of(0, 128, 0, 0), 3));
assert.throws(() => unpackDictionary(Uint8Array.of(0, 0), 1));
assert.throws(() => unpackDictionary(Uint8Array.of(0, 0, 1, 0), 0));
const pixels = Uint16Array.from({ length: 76800 }, (_, i) => (i % 131) * 503);
assert.equal(pack(pixels).encoding, 2);
const bytes = still(pixels);
assert.equal(parse(bytes).frames.length, 1);
assert(bytes.byteLength < 153666 / 10);
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync('test-results/dictionary.lba', Buffer.from(bytes));
fs.writeFileSync('test-results/dictionary.raw', Buffer.from(pixels.buffer));
console.log(
  `Lossless dictionary round trips pass; repeated-pattern still ${bytes.byteLength} bytes vs 153666-byte BMP`,
);
const long = new Uint8Array(bytes.byteLength + 1999 * 16);
long.set(new Uint8Array(bytes));
const v = new DataView(long.buffer);
v.setUint16(8, 2000, true);
v.setUint32(12, long.length, true);
v.setUint32(16, 160020, true);
for (let at = bytes.byteLength; at < long.length; at += 16) v.setUint16(at + 8, 80, true);
v.setUint32(20, BadgeGIF.crc(long.subarray(32)), true);
v.setUint32(24, BadgeGIF.crc(long.subarray(0, 24)), true);
assert.equal(parse(long.buffer).frames.length, 2000);
fs.writeFileSync('test-results/dictionary-long.lba', long);
