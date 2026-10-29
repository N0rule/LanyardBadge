// GATT peripheral simulation, not evidence of a radio connection.
function installMock(config = {}) {
  Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined });
  const base = {
    id: '00000001',
    title: 'First card',
    mode: 'artwork',
    image: config.image || '',
    name: '',
    description: '',
    url: '',
    background: 0,
    foreground: 0xffffff,
    accent: 0x2151dc,
    texts: [],
    shapes: [],
  };
  const mock = (globalThis.bleMock = {
    deck: { version: 2, revision: 1, cards: [base] },
    status: {
      selected: 0,
      activeCard: base.id,
      storageReady: true,
      storageUsed: 0,
      storageTotal: 2031616,
      brightness: 65,
      darkMode: true,
      screenTimeout: 120,
      interval: 15,
      autoplay: false,
      rotation: 0,
      defaultCard: base.id,
      animationFormat: config.animationFormat ?? 1,
      maxAnimationBytes: 1024 * 1024,
      artworkSizes: Object.fromEntries(
        Object.entries(config.images || {}).map(([id, bytes]) => [id, bytes.length]),
      ),
    },
    images: config.images || {},
    requests: [],
    uploads: [],
    failCommit: false,
    password: 'abcdefghijklmnop',
    shortCode: 'ABCD',
    abandonedResponse: !!localStorage.getItem('ble.mock.abandoned'),
    dropDiscovery: config.dropDiscovery || 0,
    protocol: config.protocol || 3,
    mtu: 23,
    header: [],
    data: [],
    maxPacket: 0,
  });
  if (config.ranges) mock.status.imageReadMax = 4096;
  if (config.mtu) mock.mtu = config.mtu;
  let seq = 0,
    request,
    reply,
    replyAt = 0,
    replyGeneration = 0;
  const tx = new EventTarget();
  let encryptedRead = false;
  tx.startNotifications = async () => {
    if (!encryptedRead) throw Error('Complete encrypted read before subscribing');
    return tx;
  };
  tx.stopNotifications = async () => {
    mock.subscriptionStale = false;
    mock.stoppedSubscriptions = (mock.stoppedSubscriptions || 0) + 1;
    return tx;
  };
  tx.readValue = async () => {
    if (mock.disconnectedReads > 0) {
      mock.disconnectedReads--;
      device.gatt.disconnect();
      throw new DOMException('GATT Server is disconnected.', 'NetworkError');
    }
    if (mock.securityFailures > 0) {
      mock.securityFailures--;
      throw new DOMException('GATT Error Unknown.', 'UnknownError');
    }
    if (config.passkey && !mock.nativeBonded) {
      mock.passkeyRequested = true;
      mock.nativePairingCount = (mock.nativePairingCount || 0) + 1;
      await new Promise((resolve, reject) => {
        mock.completeNativePairing = (accepted) => {
          mock.passkeyRequested = false;
          if (!accepted)
            return reject(new DOMException('Bluetooth authentication rejected', 'SecurityError'));
          mock.nativeBonded = true;
          mock.passkeyRequested = false;
          resolve();
        };
      });
    }
    encryptedRead = true;
    return new DataView(Uint8Array.of(mock.protocol || 2, mock.mtu & 255, mock.mtu >> 8).buffer);
  };
  const emit = (op, at, data = []) => {
    if (mock.subscriptionStale) return;
    const b = new Uint8Array(7 + data.length),
      v = new DataView(b.buffer);
    b[0] = op;
    v.setUint16(1, seq, true);
    v.setUint32(3, at, true);
    b.set(data, 7);
    tx.value = v;
    const e = new Event('characteristicvaluechanged');
    tx.dispatchEvent(e);
    if (mock.duplicateNotifications) tx.dispatchEvent(new Event('characteristicvaluechanged'));
  };
  function send() {
    if (mock.replyDelay) {
      const generation = replyGeneration;
      setTimeout(() => {
        if (generation === replyGeneration) deliver();
      }, mock.replyDelay);
      return;
    }
    deliver();
  }
  function deliver() {
    if (replyAt < reply.length) {
      const n = Math.min(Math.max(13, Math.min(500, mock.mtu - 10)), reply.length - replyAt);
      const at = replyAt;
      replyAt += n;
      emit(2, at, reply.subarray(at, replyAt));
    } else emit(3, reply.length);
  }
  function answer(code, body) {
    ++replyGeneration;
    reply = body instanceof Uint8Array ? body : new TextEncoder().encode(JSON.stringify(body));
    replyAt = 0;
    emit(1, reply.length, [code & 255, code >> 8]);
    send();
  }
  function finish() {
    const body = request.length
      ? JSON.parse(new TextDecoder().decode(new Uint8Array(mock.data)))
      : {};
    mock.requests.push(request.path);
    if (request.path.startsWith('/api/image?id=')) {
      const query = new URL('https://badge.test' + request.path).searchParams;
      const bytes = mock.images[query.get('id')];
      if (!bytes) return answer(404, { error: 'Missing image' });
      const at = Number(query.get('offset') || 0),
        n = Number(query.get('length') || bytes.length);
      return answer(query.has('offset') ? 206 : 200, new Uint8Array(bytes.slice(at, at + n)));
    }
    if (request.path === '/api/pair') {
      const matches =
        mock.protocol === 3 ||
        config.serial ||
        body.password === mock.password ||
        body.password === mock.shortCode;
      return answer(
        matches ? 200 : 401,
        matches
          ? {
              token: 'a'.repeat(64),
              ...(mock.protocol === 3 ? {} : { credential: mock.password }),
              ...(config.snapshot ? { snapshot: { deck: mock.deck, status: mock.status } } : {}),
            }
          : { error: 'Wrong pairing key' },
      );
    }
    if (request.path === '/api/cards' && request.method === 'GET') return answer(200, mock.deck);
    if (request.path === '/api/status') return answer(200, mock.status);
    if (request.path === '/api/cards') {
      if (mock.failCommit) {
        mock.failCommit = false;
        return answer(507, { error: 'Metadata commit failed' });
      }
      mock.deck = body;
      mock.deck.revision++;
      return answer(200, mock.deck);
    }
    if (request.path === '/api/name') {
      if (!/^[!-~](?:[ -~]{0,22}[!-~])?$/.test(body.name))
        return answer(422, { error: 'Invalid device name' });
      mock.status.deviceName = body.name;
      return answer(200, mock.status);
    }
    if (request.path === '/api/reset') {
      mock.resetRequested = true;
      return answer(202, { confirmation: 'Tap Erase everything on the badge' });
    }
    if (request.path === '/api/settings') {
      Object.assign(mock.status, body);
      return answer(200, mock.status);
    }
    if (request.path === '/api/select') {
      mock.status.selected = mock.deck.cards.findIndex((c) => c.id === body.id);
      mock.status.activeCard = body.id;
      return answer(200, mock.status);
    }
    return answer(200, { ok: true });
  }
  let gattWriteBusy = false;
  const rx = {
    async writeValueWithResponse(bytes) {
      if (gattWriteBusy) throw Error('GATT operation already in progress');
      gattWriteBusy = true;
      let completedOp = 0;
      try {
        mock.maxPacket = Math.max(mock.maxPacket, bytes.length);
        if (bytes.length > mock.mtu - 3) throw Error('ATT packet too big');
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          op = v.getUint8(0),
          at = v.getUint32(3, true);
        seq = v.getUint16(1, true);
        completedOp = op;
        const data = Array.from(bytes.subarray(7));
        if (op === 6) {
          ++replyGeneration;
          mock.abandonedResponse = false;
          localStorage.removeItem('ble.mock.abandoned');
          mock.header = [];
          mock.data = [];
          reply = new Uint8Array();
          replyAt = 0;
          mock.sessionStarts = (mock.sessionStarts || 0) + 1;
          emit(0, 0);
        } else if (op === 4) {
          if (mock.abandonedResponse)
            return answer(409, { error: 'Previous response still active' });
          if (at === 0) mock.header = [];
          mock.header.push(...data);
          emit(0, mock.header.length);
        } else if (op === 1) {
          request = JSON.parse(new TextDecoder().decode(new Uint8Array(mock.header)));
          mock.data = [];
          if (mock.expireNext && request.path !== '/api/pair') {
            mock.expireNext = false;
            return answer(401, { error: 'Session expired. Reconnect your badge.' });
          }
          emit(0, 0);
        } else if (op === 2) {
          if (at !== mock.data.length) throw Error('Offset mismatch');
          mock.data.push(...data);
          emit(0, mock.data.length);
        } else if (op === 3) {
          if (request.path === '/api/assets' || request.path === '/api/animations') {
            mock.uploads.push(new Uint8Array(mock.data));
            mock.images.abcdef01 = mock.data.slice();
            mock.status.artworkSizes.abcdef01 = mock.data.length;
            mock.lastUploadPath = request.path;
            return answer(201, { id: 'abcdef01' });
          }
          finish();
        } else if (op === 5) send();
      } finally {
        // Deliver notifications before Chrome's write promise settles.
        await new Promise((resolve) => setTimeout(resolve, 1));
        gattWriteBusy = false;
        if (completedOp === 3 && mock.stallNextCompletion) {
          mock.stallNextCompletion = false;
          await new Promise(() => {});
        }
      }
    },
  };
  const device = new EventTarget();
  device.id = 'mock-badge-id';
  device.name = 'Badge-Test';
  device.gatt = {
    connected: false,
    async connect() {
      if (mock.busyConnects > 0) {
        mock.busyConnects--;
        throw new DOMException('Previous GATT connection is closing', 'NetworkError');
      }
      if (localStorage.getItem('ble.mock.failConnect'))
        throw new DOMException('Adapter unavailable', 'NetworkError');
      this.connected = true;
      encryptedRead = false;
      return {
        getPrimaryService: async () => {
          if (mock.dropDiscovery > 0) {
            mock.dropDiscovery--;
            device.gatt.disconnect();
          }
          return { getCharacteristic: async (uuid) => (uuid.includes('1001-') ? rx : tx) };
        },
      };
    },
    disconnect() {
      if (this.connected) {
        this.connected = false;
        device.dispatchEvent(new Event('gattserverdisconnected'));
      }
    },
  };
  if (config.serial) mock.wire = { rx, tx };
  Object.defineProperty(navigator, 'bluetooth', {
    value: {
      requestDevice: async (options) => {
        mock.discoveryOptions = options;
        localStorage.setItem('ble.mock.granted', 'yes');
        localStorage.setItem(
          'ble.mock.choosers',
          Number(localStorage.getItem('ble.mock.choosers') || 0) + 1,
        );
        return device;
      },
      getDevices: async () => (localStorage.getItem('ble.mock.granted') ? [device] : []),
    },
    configurable: true,
  });
}
module.exports = installMock;
