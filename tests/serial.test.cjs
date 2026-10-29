const assert = require('node:assert/strict');
require('../web/transport.js');
require('../web/serial.js');
const { SerialFrame } = BadgeTransport;
for (let n = 1; n <= 512; n++) {
  const payload = Uint8Array.from({ length: n }, (_, i) => (i + n) & 255);
  const wire = SerialFrame.encode(payload);
  const received = [];
  const parser = new SerialFrame((v) => received.push(new Uint8Array(v.buffer)));
  for (const b of wire) parser.push([b]);
  assert.deepEqual(received, [payload]);
  for (let i = 1; i < wire.length - 1; i++) {
    const bad = wire.slice();
    bad[i] ^= 1;
    parser.push(bad);
  }
  assert.equal(received.length, 1);
  parser.push(wire.subarray(0, wire.length / 2));
  parser.push(new Uint8Array(2000).fill(42));
  parser.push(wire);
  assert.deepEqual(received, [payload, payload]);
}
assert.throws(() => SerialFrame.encode(new Uint8Array(513)));
console.log('Serial codec: corruption, partial frames, bounds and recovery passed');
