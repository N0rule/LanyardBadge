(() => {
  'use strict';
  const SERVICE = 'f40d1000-6f15-4d56-b6d4-17c92e648a10';
  const RX = SERVICE.replace('1000-', '1001-'),
    TX = SERVICE.replace('1000-', '1002-');
  const encoder = new TextEncoder();
  class DeviceTransport extends EventTarget {
    constructor() {
      super();
      this.token = '';
      this.state = 'disconnected';
    }
    change(state) {
      this.state = state;
      this.dispatchEvent(new Event('connectionchange'));
    }
    async pair(password) {
      const r = await this.json('/api/pair', { password, includeSnapshot: true });
      this.token = r.token;
      return r;
    }
    async json(path, body) {
      return (
        await this.request(path, { method: body === undefined ? 'GET' : 'POST', body })
      ).json();
    }
    getStatus() {
      return this.json('/api/status');
    }
    getCards() {
      return this.json('/api/cards');
    }
    uploadCard(body, progress) {
      return this.request('/api/assets', { method: 'POST', body, raw: true, progress }).then((r) =>
        r.json(),
      );
    }
    async getArtwork(id, { rangeBytes = 0, signal, onProgress } = {}) {
      const total = 153666;
      signal?.throwIfAborted();
      if (!rangeBytes) {
        const response = await this.request('/api/image?id=' + id);
        const bytes = await response.arrayBuffer();
        signal?.throwIfAborted();
        if (bytes.byteLength !== total)
          throw Error('Incomplete card preview. Try reloading the collection.');
        onProgress?.(100);
        return bytes;
      }
      // Bound each response to a few connection events. Foreground API operations
      // queued during a range get their turn before the next range is requested.
      const chunk = Math.min(rangeBytes, 4096, Math.max(256, (this.packetBytes - 7) * 8));
      const output = new Uint8Array(total);
      for (let offset = 0; offset < total; offset += chunk) {
        signal?.throwIfAborted();
        const length = Math.min(chunk, total - offset);
        const response = await this.request(
          `/api/image?id=${id}&offset=${offset}&length=${length}`,
        );
        const bytes = new Uint8Array(await response.arrayBuffer());
        signal?.throwIfAborted();
        if (bytes.length !== length)
          throw Error('Incomplete card preview. Try reloading the collection.');
        output.set(bytes, offset);
        onProgress?.(Math.floor(((offset + length) * 100) / total));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return output.buffer;
    }
    selectCard(id) {
      return this.json('/api/select', { id });
    }
    updateSettings(s) {
      return this.json('/api/settings', s);
    }
    updateCards(deck) {
      return this.json('/api/cards', deck);
    }
  }
  class BluetoothTransport extends DeviceTransport {
    constructor() {
      super();
      this.sequence = 0;
      this.tail = Promise.resolve();
      this.pending = null;
      this.packetBytes = 20;
      this.session = 0;
      this.sessionAbort = new AbortController();
    }
    static supported() {
      return !!globalThis.isSecureContext && !!globalThis.navigator?.bluetooth;
    }
    useDevice(device) {
      if (this.device === device) return;
      if (this.device && this.disconnectListener)
        this.device.removeEventListener('gattserverdisconnected', this.disconnectListener);
      this.device = device;
      this.disconnectListener = (event) => {
        if (event.target === this.device) this.lost();
      };
      device.addEventListener('gattserverdisconnected', this.disconnectListener);
    }
    async restore(id) {
      if (!BluetoothTransport.supported() || !navigator.bluetooth.getDevices) return false;
      const device = (await navigator.bluetooth.getDevices()).find((d) => d.id === id);
      if (!device) return false;
      this.useDevice(device);
      return true;
    }
    async connect(name) {
      if (!BluetoothTransport.supported()) {
        this.change('unsupported');
        throw Error(
          'Use a browser with Web Bluetooth, such as Chrome or Edge on a supported desktop or Android device. iOS Safari is unsupported.',
        );
      }
      try {
        this.change('searching');
        const device = await navigator.bluetooth.requestDevice({
          // Match either field. Name and service may arrive in separate radio
          // packets, and a QR's old name must not hide a freshly flashed badge.
          filters: [{ services: [SERVICE] }, name ? { name } : { namePrefix: 'Badge-' }],
          optionalServices: [SERVICE],
        });
        this.useDevice(device);
        await this.open();
      } catch (e) {
        this.disconnect();
        throw e;
      }
    }
    async open() {
      this.sessionAbort.abort(Error('Previous Bluetooth session closed.'));
      this.pending?.reject(Error('Previous Bluetooth session closed.'));
      this.sessionAbort = new AbortController();
      ++this.session;
      this.tail = Promise.resolve();
      this.writeTail = Promise.resolve();
      this.change('connecting');
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE);
      this.rx = await service.getCharacteristic(RX);
      this.tx = await service.getCharacteristic(TX);
      const resubscribing = !!this.notifySource;
      if (this.notifySource && this.notifyListener)
        this.notifySource.removeEventListener('characteristicvaluechanged', this.notifyListener);
      this.notifySource = this.tx;
      this.notifyListener = (e) => this.receive(e.target.value);
      this.tx.addEventListener('characteristicvaluechanged', this.notifyListener);
      // The encrypted read completes link security before writing the
      // notification subscription. Fast reconnects can otherwise race bonding.
      this.change('pairing');
      const deadline = Date.now() + 45000;
      let hello;
      for (;;) {
        try {
          hello = await this.tx.readValue();
          break;
        } catch (error) {
          const securityPending =
            ['NetworkError', 'UnknownError'].includes(error.name) ||
            /GATT.*(unknown|authenticat|encrypt|authoriz)/i.test(error.message);
          if (!securityPending || !this.device.gatt.connected || Date.now() >= deadline) {
            error.bluetoothStage = 'pairing';
            throw error;
          }
          // BlueZ can reject an encrypted read while its desktop confirmation
          // is still open. Keep the connection and allow time to approve it.
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (hello.byteLength !== 3 || ![1, 2].includes(hello.getUint8(0)))
        throw Error('This badge needs a compatible firmware update.');
      this.packetBytes = Math.min(512, Math.max(20, hello.getUint16(1, true) - 3));
      if (resubscribing) {
        // BlueZ/Chromium can retain a "notifying" flag after a peripheral
        // disconnect even though its CCC subscription was lost. Toggle it off
        // before starting the replacement subscription.
        try {
          await this.tx.stopNotifications();
        } catch {}
      }
      await this.tx.startNotifications();
      if (hello.getUint8(0) >= 2) {
        this.sequence = crypto.getRandomValues(new Uint16Array(1))[0];
        this.response = null;
        for (let attempt = 0; ; attempt++) {
          try {
            await this.acknowledged(6, 0, undefined, 0);
            break;
          } catch (error) {
            if (attempt >= 3 || !/operation.*in progress/i.test(error.message)) throw error;
            await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
          }
        }
      }
      this.change('pairing');
    }
    async reconnect() {
      if (!this.device) throw Error('Connect your badge first.');
      this.token = '';
      this.change('reconnecting');
      try {
        await this.open();
      } catch (e) {
        this.disconnect();
        throw e;
      }
    }
    lost() {
      this.sessionAbort.abort(Error('Bluetooth disconnected. Your edits are kept.'));
      ++this.session;
      this.change('disconnected');
      this.token = '';
      this.pending?.reject(
        Error('Bluetooth disconnected. Your edits are kept. Reconnect and retry.'),
      );
    }
    disconnect() {
      this.device?.gatt.disconnect();
      this.lost();
    }
    frame(op, seq, offset, data = new Uint8Array()) {
      const b = new Uint8Array(7 + data.length),
        v = new DataView(b.buffer);
      b[0] = op;
      v.setUint16(1, seq, true);
      v.setUint32(3, offset, true);
      b.set(data, 7);
      return b;
    }
    write(op, offset, data) {
      const packet = this.frame(op, this.sequence, offset, data),
        rx = this.rx,
        session = this.session,
        signal = this.sessionAbort.signal;
      // Notifications can complete a response before the ACK write promise resolves.
      // Serialize ALL writes, including response ACKs, independently of requests.
      const operation = (this.writeTail || Promise.resolve())
        .catch(() => {})
        .then(() => {
          if (session !== this.session) throw Error('Previous Bluetooth session closed.');
          return new Promise((resolve, reject) => {
            const finish = (callback, value) => {
              signal.removeEventListener('abort', abort);
              callback(value);
            };
            const abort = () => finish(reject, signal.reason);
            if (signal.aborted) return abort();
            signal.addEventListener('abort', abort, { once: true });
            Promise.resolve()
              .then(() => rx.writeValueWithResponse(packet))
              .then(
                (value) => finish(resolve, value),
                (error) => finish(reject, error),
              );
          });
        });
      this.writeTail = operation;
      return operation;
    }
    wait(op, offset) {
      return new Promise((resolve, reject) => {
        let timer;
        const pending = {
          op,
          offset,
          touch: () => {
            clearTimeout(timer);
            timer = setTimeout(
              () =>
                pending.reject(
                  Error('The badge timed out. Reconnect and retry; your edits are kept.'),
                ),
              15000,
            );
          },
          resolve: (value) => {
            clearTimeout(timer);
            if (this.pending === pending) this.pending = null;
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            if (this.pending === pending) this.pending = null;
            reject(error);
          },
        };
        this.pending = pending;
        pending.touch();
      });
    }
    async acknowledged(op, offset, data, expected) {
      const ack = this.wait(0, expected);
      const pending = this.pending;
      try {
        await Promise.all([this.write(op, offset, data), ack]);
      } catch (error) {
        pending.reject(error);
        throw error;
      }
    }
    receive(v) {
      if (v.byteLength < 7 || v.getUint16(1, true) !== this.sequence) return;
      const op = v.getUint8(0),
        at = v.getUint32(3, true),
        p = this.pending;
      p?.touch();
      if (op === 0) {
        if (p?.op === 0 && at === p.offset) p.resolve();
        return;
      }
      if (op === 1) {
        if (at > 256000 || v.byteLength !== 9) {
          p?.reject(Error('Invalid badge response'));
          return;
        }
        // Some BlueZ clients deliver the same value-change event twice.
        if (this.response && this.response.length === at && this.code === v.getUint16(7, true))
          return;
        this.response = new Uint8Array(at);
        this.received = 0;
        this.code = v.getUint16(7, true);
        return;
      }
      if (op === 2) {
        const bytes = new Uint8Array(v.buffer, v.byteOffset + 7, v.byteLength - 7);
        if (this.response && at < this.received && at + bytes.length <= this.received) {
          // Accept only a byte-identical replay; conflicting/overlapping chunks fail below.
          if (bytes.every((byte, i) => this.response[at + i] === byte)) return;
        }
        if (!this.response || at !== this.received || at + bytes.length > this.response.length) {
          p?.reject(Error('Incomplete badge response'));
          return;
        }
        this.response.set(bytes, at);
        this.received += bytes.length;
        this.write(5, this.received).catch((e) => p?.reject(e));
        return;
      }
      if (op === 3 && p) {
        if (!this.response || at !== this.received || at !== this.response.length)
          p.reject(Error('Incomplete badge response'));
        else if (this.code >= 400) {
          let message = 'Badge request failed';
          try {
            message = JSON.parse(new TextDecoder().decode(this.response)).error || message;
          } catch {}
          const error = Error(message);
          error.deviceResponse = true;
          error.status = this.code;
          p.reject(error);
        } else if (p.op === 3)
          p.resolve(
            new Response(this.response, {
              status: this.code,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        else p.reject(Error('Unexpected badge response'));
      }
    }
    request(path, options = {}) {
      const session = this.session;
      const operation = this.tail.then(() => {
        if (session !== this.session) throw Error('Previous Bluetooth session closed.');
        return this.transfer(path, options);
      });
      this.tail = operation.catch(() => {});
      return operation;
    }
    async transfer(path, { method = 'GET', body, raw = false, progress } = {}) {
      const session = this.session;
      if (!this.device?.gatt.connected) throw Error('Connect your badge to continue.');
      this.sequence = (this.sequence + 1) & 65535;
      this.response = null;
      const bytes =
        body === undefined
          ? new Uint8Array()
          : raw
            ? new Uint8Array(body)
            : encoder.encode(JSON.stringify(body));
      const header = encoder.encode(
        JSON.stringify({ method, path, token: this.token, length: bytes.length }),
      );
      const size = this.packetBytes - 7;
      try {
        for (let at = 0; at < header.length; at += size) {
          const part = header.subarray(at, at + size);
          await this.acknowledged(4, at, part, at + part.length);
        }
        await this.acknowledged(1, 0, undefined, 0);
        for (let at = 0; at < bytes.length; at += size) {
          const part = bytes.subarray(at, at + size);
          await this.acknowledged(2, at, part, at + part.length);
          progress?.(Math.floor(((at + part.length) / bytes.length) * 100));
        }
        const response = this.wait(3, bytes.length);
        const [, r] = await Promise.all([this.write(3, bytes.length), response]);
        if (!r.ok) {
          let message = 'Badge request failed';
          try {
            message = (await r.json()).error || message;
          } catch {}
          throw Error(message);
        }
        return r;
      } catch (e) {
        if (
          session === this.session &&
          (!e.deviceResponse || (e.status === 401 && path !== '/api/pair'))
        )
          this.disconnect();
        throw e;
      }
    }
  }
  globalThis.BadgeTransport = { DeviceTransport, BluetoothTransport, SERVICE, RX, TX };
})();
