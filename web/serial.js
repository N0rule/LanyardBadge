(() => {
  'use strict';
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) {
      c ^= byte;
      for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  class SerialFrame {
    constructor(deliver) {
      this.deliver = deliver;
      this.bytes = new Uint8Array(521);
      this.clear();
    }
    clear() {
      this.used = 0;
      this.escaped = this.invalid = false;
    }
    push(bytes) {
      for (let b of bytes) {
        if (b === 0xc0) {
          const raw = this.bytes,
            n = raw[3] | (raw[4] << 8);
          if (
            !this.invalid &&
            !this.escaped &&
            this.used >= 9 &&
            raw[0] === 76 &&
            raw[1] === 66 &&
            raw[2] === 1 &&
            n <= 512 &&
            this.used === n + 9 &&
            crc(raw.subarray(0, n + 5)) === new DataView(raw.buffer).getUint32(n + 5, true)
          ) {
            const payload = raw.slice(5, n + 5);
            this.clear();
            this.deliver(new DataView(payload.buffer));
          } else this.clear();
          continue;
        }
        if (this.invalid) continue;
        if (this.escaped) {
          if (b === 0xdc) b = 0xc0;
          else if (b === 0xdd) b = 0xdb;
          else {
            this.invalid = true;
            continue;
          }
          this.escaped = false;
        } else if (b === 0xdb) {
          this.escaped = true;
          continue;
        }
        if (this.used === 521) this.invalid = true;
        else this.bytes[this.used++] = b;
      }
    }
    static encode(payload) {
      if (!payload.length || payload.length > 512) throw Error('Invalid serial frame size.');
      const raw = new Uint8Array(payload.length + 9),
        view = new DataView(raw.buffer);
      raw.set([76, 66, 1]);
      view.setUint16(3, payload.length, true);
      raw.set(payload, 5);
      view.setUint32(raw.length - 4, crc(raw.subarray(0, raw.length - 4)), true);
      const out = [0xc0];
      for (const b of raw)
        out.push(...(b === 0xc0 ? [0xdb, 0xdc] : b === 0xdb ? [0xdb, 0xdd] : [b]));
      out.push(0xc0);
      return new Uint8Array(out);
    }
  }
  class SerialTransport extends BadgeTransport.PacketTransport {
    constructor() {
      super();
      this.kind = 'usb';
      this.session = 0;
      this.sequence = 0;
      this.sessionAbort = new AbortController();
      this.packetBytes = 512;
      this.tail = this.writeTail = Promise.resolve();
    }
    static supported() {
      return !!globalThis.isSecureContext && !!navigator.serial;
    }
    static async authorized() {
      if (!this.supported()) return [];
      return (await navigator.serial.getPorts()).filter((p) => {
        const info = p.getInfo();
        return info.usbVendorId === 0x1a86 && info.usbProductId === 0x7523;
      });
    }
    isOpen() {
      return !!this.writer && !this.sessionAbort.signal.aborted;
    }
    assertSession(session, controller) {
      if (session !== this.session || controller?.signal.aborted)
        throw Object.assign(
          new DOMException('Previous USB session closed. Your edits are kept.', 'AbortError'),
          { staleSession: true },
        );
    }
    async connect(port) {
      if (!SerialTransport.supported())
        throw Error('USB editing requires Chrome or Edge on a supported desktop.');
      this.port =
        port ||
        (await navigator.serial.requestPort({
          filters: [{ usbVendorId: 0x1a86, usbProductId: 0x7523 }],
        }));
      await this.open();
    }
    async reconnect() {
      await this.open();
    }
    async open() {
      await this.disconnect();
      this.change('connecting');
      this.sessionAbort = new AbortController();
      const session = ++this.session,
        controller = this.sessionAbort;
      this.tail = this.writeTail = Promise.resolve();
      try {
        await this.port.open({ baudRate: 115200, bufferSize: 4096, flowControl: 'none' });
        // CH340 DTR/RTS can drive reset/BOOT. Deassert both; startup retries cover a reset on open.
        await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
        this.assertSession(session, controller);
        this.writer = this.port.writable.getWriter();
        this.reader = this.port.readable.getReader();
        const reader = this.reader,
          parser = new SerialFrame((v) => {
            if (session !== this.session) return;
            if (
              v.byteLength >= 7 &&
              v.getUint8(0) === 0x71 &&
              v.getUint16(1, true) === this.sequence
            ) {
              try {
                const hello = JSON.parse(new TextDecoder().decode(new Uint8Array(v.buffer, 7)));
                if (
                  hello.product !== 'LanyardBadge' ||
                  hello.protocol !== 1 ||
                  hello.packetBytes !== 512 ||
                  !/^[a-f0-9]{16}$/.test(hello.id)
                )
                  throw Error('Update this badge to compatible USB firmware.');
                this.hello?.resolve(hello);
              } catch (e) {
                this.hello?.reject(e);
              }
            } else this.receive(v);
          });
        this.readTask = (async () => {
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              parser.push(value);
            }
          } catch (e) {
            if (session === this.session) this.lost(e);
          } finally {
            reader.releaseLock();
            if (session === this.session)
              this.lost(Error('USB disconnected. Your edits are kept.'));
          }
        })();
        this.sequence = crypto.getRandomValues(new Uint16Array(1))[0];
        let hello;
        for (let attempt = 0; attempt < 6; attempt++) {
          this.assertSession(session, controller);
          try {
            hello = await new Promise((resolve, reject) => {
              const timer = setTimeout(
                () =>
                  reject(
                    Error(
                      'No compatible USB firmware answered. Update firmware, or disconnect the other editor and retry.',
                    ),
                  ),
                1200,
              );
              this.hello = {
                resolve: (h) => {
                  clearTimeout(timer);
                  resolve(h);
                },
                reject: (e) => {
                  clearTimeout(timer);
                  reject(e);
                },
              };
              this.write(0x70, 0).catch(this.hello.reject);
            });
            break;
          } catch (e) {
            if (attempt === 5) throw e;
          }
        }
        this.hello = null;
        this.assertSession(session, controller);
        this.device = { id: hello.id, name: 'LanyardBadge' };
        this.heartbeat = setInterval(() => this.write(0x73, 0).catch((e) => this.lost(e)), 10000);
        this.change('pairing');
      } catch (e) {
        await this.disconnect();
        throw e;
      }
    }
    pair() {
      return super.pair('');
    }
    write(op, offset, data) {
      const packet = SerialFrame.encode(this.frame(op, this.sequence, offset, data));
      const session = this.session,
        controller = this.sessionAbort,
        writer = this.writer;
      const operation = this.writeTail
        .catch(() => {})
        .then(() => {
          this.assertSession(session, controller);
          if (!writer) throw Error('USB disconnected. Reconnect your badge.');
          return new Promise((resolve, reject) => {
            const signal = controller.signal;
            const finish = (callback, value) => {
              signal.removeEventListener('abort', abort);
              callback(value);
            };
            const abort = () => finish(reject, signal.reason);
            if (signal.aborted) return abort();
            signal.addEventListener('abort', abort, { once: true });
            Promise.resolve()
              .then(() => {
                signal.throwIfAborted();
                return writer.write(packet);
              })
              .then(
                (value) => finish(resolve, value),
                (error) => finish(reject, error),
              );
          });
        });
      this.writeTail = operation;
      return operation;
    }
    lost(error = Error('USB disconnected. Your edits are kept.')) {
      clearInterval(this.heartbeat);
      if (!this.sessionAbort.signal.aborted) {
        this.sessionAbort.abort(error);
        ++this.session;
        this.pending?.reject(error);
        this.hello?.reject(error);
        this.token = '';
        this.change('disconnected');
      }
      // Release locks after unplug or stream failure as well as an explicit disconnect.
      void this.disconnect();
    }
    async disconnect() {
      if (this.closing) return this.closing;
      this.closing = (async () => {
        clearInterval(this.heartbeat);
        if (this.writer && !this.sessionAbort.signal.aborted) {
          let timer;
          try {
            await Promise.race([
              this.write(0x72, 0),
              new Promise((resolve) => {
                timer = setTimeout(resolve, 300);
              }),
            ]);
          } catch {
          } finally {
            clearTimeout(timer);
          }
        }
        this.sessionAbort.abort(Error('USB connection closed. Your edits are kept.'));
        ++this.session;
        this.pending?.reject(this.sessionAbort.signal.reason);
        this.hello?.reject(this.sessionAbort.signal.reason);
        try {
          await this.reader?.cancel();
        } catch {}
        await this.readTask;
        this.reader = this.readTask = null;
        try {
          await this.writeTail;
        } catch {}
        try {
          this.writer?.releaseLock();
        } catch {}
        this.writer = null;
        try {
          if (this.port?.readable || this.port?.writable) await this.port.close();
        } catch {}
        this.token = '';
        this.change('disconnected');
      })();
      try {
        await this.closing;
      } finally {
        this.closing = null;
      }
    }
  }
  Object.assign(BadgeTransport, { SerialFrame, SerialTransport });
})();
