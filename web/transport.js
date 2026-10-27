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
      const r = await this.json('/api/pair', { password });
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
    }
    static supported() {
      return !!globalThis.isSecureContext && !!globalThis.navigator?.bluetooth;
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
        this.device = await navigator.bluetooth.requestDevice({
          filters: [name ? { name, services: [SERVICE] } : { services: [SERVICE] }],
        });
        this.device.addEventListener('gattserverdisconnected', () => this.lost());
        await this.open();
      } catch (e) {
        this.disconnect();
        throw e;
      }
    }
    async open() {
      this.change('connecting');
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE);
      this.rx = await service.getCharacteristic(RX);
      this.tx = await service.getCharacteristic(TX);
      if (this.notifySource && this.notifyListener)
        this.notifySource.removeEventListener('characteristicvaluechanged', this.notifyListener);
      this.notifySource = this.tx;
      this.notifyListener = (e) => this.receive(e.target.value);
      this.tx.addEventListener('characteristicvaluechanged', this.notifyListener);
      await this.tx.startNotifications();
      const hello = await this.tx.readValue();
      if (hello.byteLength !== 3 || hello.getUint8(0) !== 1)
        throw Error('This badge needs a compatible firmware update.');
      this.packetBytes = Math.min(512, Math.max(20, hello.getUint16(1, true) - 3));
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
        rx = this.rx;
      // Notifications can complete a response before the ACK write promise resolves.
      // Serialize ALL writes, including response ACKs, independently of requests.
      const operation = (this.writeTail || Promise.resolve())
        .catch(() => {})
        .then(() => rx.writeValueWithResponse(packet));
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
      await Promise.all([this.write(op, offset, data), ack]);
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
        this.response = new Uint8Array(at);
        this.received = 0;
        this.code = v.getUint16(7, true);
        return;
      }
      if (op === 2) {
        const bytes = new Uint8Array(v.buffer, v.byteOffset + 7, v.byteLength - 7);
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
      const operation = this.tail.then(() => this.transfer(path, options));
      this.tail = operation.catch(() => {});
      return operation;
    }
    async transfer(path, { method = 'GET', body, raw = false, progress } = {}) {
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
        if (!e.deviceResponse) this.disconnect();
        throw e;
      }
    }
  }
  globalThis.BadgeTransport = { DeviceTransport, BluetoothTransport, SERVICE, RX, TX };
})();
