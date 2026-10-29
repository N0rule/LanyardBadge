// Byte-stream adapter simulation. Does not claim hardware or browser permission verification.
module.exports = function installSerialMock(config = {}) {
  let controller, parser, listener;
  const mock = (globalThis.serialMock = {
    opens: 0,
    closes: 0,
    choosers: 0,
    signals: [],
    writes: 0,
  });
  const port = {
    getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
    async open(options) {
      if (this.readable || this.writable) throw Error('Port is already open');
      mock.opens++;
      mock.options = options;
      this.readable = new ReadableStream({
        start(c) {
          controller = c;
        },
      });
      const emit = (bytes) => {
        if (mock.dropResponses) return;
        const wire = BadgeTransport.SerialFrame.encode(bytes);
        // Arbitrary byte boundaries, including escaped bytes and partial headers.
        for (let at = 0; at < wire.length; at += 17) controller.enqueue(wire.slice(at, at + 17));
      };
      parser = new BadgeTransport.SerialFrame((v) => {
        const payload = new Uint8Array(v.buffer),
          op = v.getUint8(0);
        if (op === 0x70) {
          if (config.silent) return;
          const body = new TextEncoder().encode(
            JSON.stringify({
              product: 'LanyardBadge',
              protocol: 1,
              id: '0123456789abcdef',
              packetBytes: 512,
            }),
          );
          const response = new Uint8Array(7 + body.length);
          response.set(payload.subarray(0, 7));
          response[0] = 0x71;
          response.set(body, 7);
          emit(response);
        } else if (op === 0x72) mock.goodbye = true;
        else if (op !== 0x73) mock.pendingWrite = bleMock.wire.rx.writeValueWithResponse(payload);
      });
      listener = () => emit(new Uint8Array(bleMock.wire.tx.value.buffer));
      bleMock.wire.tx.addEventListener('characteristicvaluechanged', listener);
      this.writable = new WritableStream({
        async write(bytes) {
          mock.writes++;
          parser.push(bytes);
          await mock.pendingWrite;
          mock.pendingWrite = null;
        },
      });
    },
    async setSignals(signals) {
      mock.signals.push(signals);
    },
    async close() {
      if (this.readable?.locked || this.writable?.locked)
        throw Error('Port streams are still locked');
      this.readable = this.writable = null;
      mock.closes++;
      bleMock.wire.tx.removeEventListener('characteristicvaluechanged', listener);
    },
  };
  mock.unplug = () => controller.error(new Error('Cable unplugged'));
  mock.port = port;
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      async getPorts() {
        return config.authorized ? [port] : [];
      },
      async requestPort() {
        mock.choosers++;
        return port;
      },
    },
  });
};
