(() => {
  'use strict';
  const W = 240,
    H = 320,
    BMP_SIZE = 153666;
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const color = (s) => parseInt(s.slice(1), 16);
  function cropRect(iw, ih, w, h, fit = 'cover', zoom = 1, x = 0, y = 0) {
    const scale = (fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)) * zoom;
    const dw = iw * scale,
      dh = ih * scale;
    return { x: ((w - dw) * (x + 100)) / 200, y: ((h - dh) * (y + 100)) / 200, w: dw, h: dh };
  }
  function encodeBMP(rgba) {
    if (rgba.length !== W * H * 4) throw Error('A 240 × 320 image is required');
    const buffer = new ArrayBuffer(BMP_SIZE),
      v = new DataView(buffer);
    v.setUint8(0, 66);
    v.setUint8(1, 77);
    v.setUint32(2, BMP_SIZE, true);
    v.setUint32(10, 66, true);
    v.setUint32(14, 40, true);
    v.setUint32(18, W, true);
    v.setUint32(22, H, true);
    v.setUint16(26, 1, true);
    v.setUint16(28, 16, true);
    v.setUint32(30, 3, true);
    v.setUint32(34, W * H * 2, true);
    v.setUint32(54, 0xf800, true);
    v.setUint32(58, 0x07e0, true);
    v.setUint32(62, 0x001f, true);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4,
          px = ((rgba[i] >> 3) << 11) | ((rgba[i + 1] >> 2) << 5) | (rgba[i + 2] >> 3);
        v.setUint16(66 + ((H - 1 - y) * W + x) * 2, px, true);
      }
    return buffer;
  }
  function decodeBMP(buffer) {
    const v = new DataView(buffer);
    if (
      buffer.byteLength !== BMP_SIZE ||
      v.getUint16(0, true) !== 0x4d42 ||
      v.getUint32(18, true) !== W ||
      v.getUint32(22, true) !== H ||
      v.getUint16(28, true) !== 16 ||
      v.getUint32(10, true) !== 66 ||
      v.getUint32(54, true) !== 0xf800 ||
      v.getUint32(58, true) !== 0x07e0 ||
      v.getUint32(62, true) !== 31
    )
      throw Error('Invalid badge background');
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = v.getUint16(66 + ((H - 1 - y) * W + x) * 2, true),
          i = (y * W + x) * 4;
        out[i] = Math.round((((p >> 11) & 31) * 255) / 31);
        out[i + 1] = Math.round((((p >> 5) & 63) * 255) / 63);
        out[i + 2] = Math.round(((p & 31) * 255) / 31);
        out[i + 3] = 255;
      }
    return out;
  }
  function validateCard(c) {
    for (const [key, max] of Object.entries({ title: 48, name: 48, description: 96, url: 100 })) {
      if (typeof c[key] !== 'string' || c[key].length > max || /[^\x20-\x7e\n]/.test(c[key]))
        throw Error(key + ': use English letters, numbers and punctuation');
    }
    if (!c.title.trim()) throw Error('Give your card a title');
    if (c.url && !/^https?:\/\/[^\s]+$/.test(c.url))
      throw Error('QR link must begin with https:// or http:// and contain no spaces');
    if (c.texts.length > 4 || c.shapes.length > 4)
      throw Error('Use up to four text and four graphic elements');
    for (const t of c.texts)
      if (!t.text || t.text.length > 96 || /[^\x20-\x7e\n]/.test(t.text))
        throw Error('Text elements need 1–96 supported characters');
  }
  globalThis.BadgeCodec = { cropRect, encodeBMP, decodeBMP, validateCard };
  if (typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id),
    canvas = $('preview'),
    ctx = canvas.getContext('2d');
  let token = sessionStorage.getItem('badge-token') || '',
    deck = { version: 2, revision: 0, cards: [] },
    selected = 0,
    status = {},
    dirty = false,
    busy = false,
    toastTimer,
    pollTimer;
  const imageStates = new Map(),
    imageLoads = new Map();
  let drag = null;
  const card = () => deck.cards[selected];
  function toast(message, error = false) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    $('toast').classList.toggle('error-toast', error);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('toast').hidden = true), error ? 7000 : 3500);
  }
  function setBusy(value, label = 'Saving…') {
    busy = value;
    for (const id of [
      'save-card',
      'show-card',
      'new-card',
      'delete-card',
      'move-up',
      'move-down',
      'reload',
    ])
      $(id).disabled = value;
    $('save-card').textContent = value ? label : 'Save to badge';
    $('card-form').inert = value;
  }
  function markDirty(background = false) {
    dirty = true;
    $('save-state').textContent = 'Unsaved changes';
    if (background && imageStates.has(card()?.id)) imageStates.get(card().id).dirty = true;
    renderPreview();
  }
  async function api(path, { method = 'GET', body, raw = false } = {}) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = raw ? 'image/bmp' : 'application/json';
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (e) {
      throw Error(
        e.name === 'AbortError'
          ? 'The badge did not respond. Check its connection and retry.'
          : 'Could not reach the badge. Reconnect to its Wi-Fi and open configuration.',
      );
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401 && path !== '/api/pair') {
      token = '';
      sessionStorage.removeItem('badge-token');
      showPair();
    }
    if (!response.ok) {
      let message = 'Request failed (' + response.status + ')';
      try {
        message = (await response.json()).error || message;
      } catch {}
      throw Error(message);
    }
    return response;
  }
  async function json(path, options) {
    return (await api(path, options)).json();
  }
  function showPair() {
    clearInterval(pollTimer);
    $('studio').inert = true;
    $('connection').textContent = 'Pairing needed';
    if ($('device-dialog').open) $('device-dialog').close();
    if (!$('pair-dialog').open) $('pair-dialog').showModal();
  }
  function currentState() {
    return imageStates.get(card()?.id);
  }
  function drawBackground(c, context) {
    context.fillStyle = hex(c.background);
    context.fillRect(0, 0, W, H);
    const state = imageStates.get(c.id);
    if (!state) return false;
    const profile = c.mode === 'profile',
      h = profile ? 72 : H,
      w = profile ? 72 : W,
      tx = profile ? 20 : 0,
      ty = profile ? 20 : 0;
    if (profile) {
      rounded(context, 0, 0, W, 112, 0, hex(c.accent));
      rounded(context, 20, 20, 72, 72, 36, hex(c.background));
    }
    context.save();
    context.beginPath();
    if (profile) context.arc(56, 56, 36, 0, Math.PI * 2);
    else context.rect(0, 0, W, H);
    context.clip();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (state.normalized) {
      const sw = profile ? 72 : W,
        sh = profile ? 72 : H;
      const r = cropRect(sw, sh, w, h, state.fit, state.zoom, state.x, state.y);
      context.drawImage(
        state.image,
        profile ? 20 : 0,
        profile ? 20 : 0,
        sw,
        sh,
        tx + r.x,
        ty + r.y,
        r.w,
        r.h,
      );
    } else {
      const r = cropRect(
        state.image.width,
        state.image.height,
        w,
        h,
        state.fit,
        state.zoom,
        state.x,
        state.y,
      );
      context.drawImage(state.image, tx + r.x, ty + r.y, r.w, r.h);
    }
    context.restore();
    return true;
  }
  function rounded(context, x, y, w, h, r, fill) {
    context.fillStyle = fill;
    context.beginPath();
    context.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    context.fill();
  }
  function drawText(text, x, y, width, height, size, fill) {
    ctx.fillStyle = fill;
    ctx.font = '500 ' + size + 'px BadgeMontserrat';
    ctx.textBaseline = 'top';
    const lineHeight = size === 14 ? 16 : size === 20 ? 22 : 30,
      maxLines = Math.max(1, Math.floor(height / lineHeight));
    const lines = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        if (ctx.measureText(line + (line ? ' ' : '') + word).width > width && line) {
          lines.push(line);
          line = word;
        } else line += (line ? ' ' : '') + word;
      }
      lines.push(line);
    }
    const visible = lines.slice(0, maxLines);
    for (let i = 0; i < visible.length; i++) {
      let s = visible[i],
        clip = ctx.measureText(s).width > width || (i === maxLines - 1 && lines.length > maxLines);
      if (clip) {
        while (s.length && ctx.measureText(s + '…').width > width) s = s.slice(0, -1);
        s += '…';
      }
      ctx.fillText(s, x, y + i * lineHeight + 1);
    }
  }
  function drawQR(url, x, y, boxHeight = 106) {
    if (!url || !globalThis.qrcodegen) return;
    rounded(ctx, x, y, 106, boxHeight, 0, '#fff');
    try {
      const Q = qrcodegen.QrCode,
        S = qrcodegen.QrSegment,
        segments = [S.makeBytes([...new TextEncoder().encode(url)])];
      let q = Q.encodeSegments(segments, Q.Ecc.MEDIUM),
        scale = Math.floor(86 / q.size),
        version = q.version;
      while (version < 40 && (4 * (version + 1) + 17) * scale <= 86) version++;
      q = Q.encodeSegments(segments, Q.Ecc.MEDIUM, version, version, -1, true);
      scale = Math.floor(86 / q.size);
      const margin = Math.floor((86 - q.size * scale) / 2);
      ctx.fillStyle = '#000';
      for (let j = 0; j < q.size; j++)
        for (let i = 0; i < q.size; i++)
          if (q.getModule(i, j))
            ctx.fillRect(
              x + 10 + margin + i * scale,
              y + (boxHeight === 102 ? 8 : 10) + margin + j * scale,
              scale,
              scale,
            );
    } catch {
      drawText('Invalid QR link', x + 8, y + 16, 90, 70, 14, '#a52b49');
    }
  }
  function renderPreview() {
    const c = card();
    if (!c) return;
    const image = drawBackground(c, ctx);
    if (c.mode === 'profile') {
      if (!image) {
        rounded(ctx, 0, 0, W, 112, 0, hex(c.accent));
        rounded(ctx, 20, 20, 72, 72, 36, hex(c.background));
        ctx.font = '500 28px BadgeMontserrat';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillStyle = hex(c.foreground);
        ctx.fillText(c.name[0] || '?', 56, 56);
        ctx.textAlign = 'left';
      }
      drawText('Say hello.', 110, 44, 118, 32, 20, '#fff');
      rounded(ctx, 0, 112, W, 208, 0, hex(c.background));
      drawText(c.name, 20, 128, 200, 38, 28, hex(c.foreground));
      drawText(c.description, 20, 174, 200, 40, 14, hex(c.foreground));
      if (c.url) {
        drawQR(c.url, 20, 218, 102);
        drawText("Let's\nconnect", 140, 238, 86, 54, 20, hex(c.foreground));
      } else drawText('Made to be\ncarried with you.', 20, 244, 200, 54, 20, hex(c.foreground));
    }
    if (c.mode === 'custom') {
      for (const s of c.shapes) rounded(ctx, s.x, s.y, s.w, s.h, s.radius, hex(s.color));
      for (const t of c.texts) drawText(t.text, t.x, t.y, W - t.x, H - t.y, t.size, hex(t.color));
      if (c.url) drawQR(c.url, 126, 214);
    }
  }
  async function ensureImage(c) {
    if (!c.image || imageStates.has(c.id)) return;
    if (imageLoads.has(c.id)) return imageLoads.get(c.id);
    const imageId = c.image;
    const promise = (async () => {
      const bytes = await (await api('/api/image?id=' + encodeURIComponent(imageId))).arrayBuffer();
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      off.getContext('2d').putImageData(new ImageData(decodeBMP(bytes), W, H), 0, 0);
      if (deck.cards.some((v) => v.id === c.id && v.image === imageId) && !imageStates.has(c.id))
        imageStates.set(c.id, {
          image: off,
          normalized: true,
          dirty: false,
          fit: 'cover',
          zoom: 1,
          x: 0,
          y: 0,
        });
      if (card()?.id === c.id) {
        syncCrop();
        renderPreview();
      }
    })();
    imageLoads.set(c.id, promise);
    try {
      await promise;
    } finally {
      imageLoads.delete(c.id);
    }
  }
  function syncCrop() {
    const s = currentState();
    $('crop-controls').hidden = !s;
    if (s) {
      $('fit').value = s.fit;
      $('zoom').value = s.zoom * 100;
      $('crop-x').value = s.x;
      $('crop-y').value = s.y;
    }
  }
  function renderGallery() {
    const list = $('card-list');
    list.replaceChildren();
    $('card-count').textContent = deck.cards.length + ' / 10';
    deck.cards.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gallery-card' + (i === selected ? ' selected' : '');
      b.setAttribute('aria-pressed', String(i === selected));
      const swatch = document.createElement('span');
      swatch.className = 'card-swatch';
      swatch.style.background = hex(c.background);
      const desc = document.createElement('span');
      desc.className = 'card-description';
      const name = document.createElement('strong');
      name.textContent = c.title;
      const detail = document.createElement('small');
      detail.textContent =
        c.mode +
        ((status.activeCard ? status.activeCard === c.id : status.selected === i)
          ? ' · On badge'
          : '');
      desc.append(name, detail);
      b.append(swatch, desc);
      b.onclick = () => {
        if (!busy) {
          selected = i;
          renderForm();
        }
      };
      list.append(b);
    });
    $('new-card').disabled = busy || deck.cards.length >= 10;
    $('delete-card').disabled = busy || deck.cards.length <= 1;
    $('move-up').disabled = busy || selected === 0;
    $('move-down').disabled = busy || selected === deck.cards.length - 1;
    $('default-card').replaceChildren(
      ...deck.cards.map((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.title;
        return o;
      }),
    );
    if (status.defaultCard) $('default-card').value = status.defaultCard;
  }
  function field(labelText, value, type, change, options) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const el = document.createElement(
      type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input',
    );
    if (el.tagName === 'INPUT') el.type = type;
    if (type === 'textarea') {
      el.rows = 2;
      el.maxLength = 96;
    }
    if (options) {
      if (type === 'select')
        for (const n of options) {
          const o = document.createElement('option');
          o.value = n;
          o.textContent = n;
          el.append(o);
        }
      else {
        el.min = options[0];
        el.max = options[1];
        el.step = 1;
      }
    }
    el.value = value;
    el.addEventListener('input', () => {
      change(el.type === 'number' ? Math.round(Number(el.value)) : el.value);
      markDirty();
    });
    label.append(el);
    return label;
  }
  function renderElements() {
    const c = card();
    $('texts').replaceChildren();
    $('shapes').replaceChildren();
    for (const [kind, array] of [
      ['texts', c.texts],
      ['shapes', c.shapes],
    ])
      array.forEach((e, i) => {
        const group = document.createElement('div');
        group.className = 'element';
        const head = document.createElement('div');
        head.className = 'element-head';
        head.textContent = (kind === 'texts' ? 'Text ' : 'Graphic ') + (i + 1);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'danger';
        remove.textContent = 'Remove';
        remove.onclick = () => {
          array.splice(i, 1);
          markDirty();
          renderElements();
        };
        head.append(remove);
        group.append(head);
        if (kind === 'texts') group.append(field('Text', e.text, 'textarea', (v) => (e.text = v)));
        const coords = document.createElement('div');
        coords.className = 'coords';
        coords.append(
          field(
            'X',
            e.x,
            'number',
            (v) => (e.x = Math.max(0, Math.min(kind === 'texts' ? 220 : W - e.w, v))),
            [0, kind === 'texts' ? 220 : W - e.w],
          ),
          field(
            'Y',
            e.y,
            'number',
            (v) => (e.y = Math.max(0, Math.min(kind === 'texts' ? 300 : H - e.h, v))),
            [0, kind === 'texts' ? 300 : H - e.h],
          ),
        );
        if (kind === 'texts')
          coords.append(field('Size', e.size, 'select', (v) => (e.size = Number(v)), [14, 20, 28]));
        else
          coords.append(
            field('Width', e.w, 'number', (v) => (e.w = Math.max(1, Math.min(W - e.x, v))), [
              1,
              W - e.x,
            ]),
            field('Height', e.h, 'number', (v) => (e.h = Math.max(1, Math.min(H - e.y, v))), [
              1,
              H - e.y,
            ]),
            field(
              'Roundness',
              e.radius,
              'number',
              (v) => (e.radius = Math.max(0, Math.min(120, v))),
              [0, 120],
            ),
          );
        coords.append(field('Color', hex(e.color), 'color', (v) => (e.color = color(v))));
        group.append(coords);
        $(kind).append(group);
      });
    $('add-text').disabled = c.texts.length >= 4;
    $('add-shape').disabled = c.shapes.length >= 4;
  }
  function renderForm() {
    const c = card();
    if (!c) return;
    for (const id of ['title', 'mode', 'name', 'description', 'url']) $(id).value = c[id];
    for (const id of ['background', 'foreground', 'accent']) $(id).value = hex(c[id]);
    $('profile-fields').hidden = c.mode !== 'profile';
    $('custom-fields').hidden = c.mode !== 'custom';
    $('link-field').hidden = c.mode === 'artwork';
    $('editing-title').textContent = selected + 1 + ' of ' + deck.cards.length;
    renderGallery();
    renderElements();
    syncCrop();
    renderPreview();
    ensureImage(c).catch((e) => toast(e.message, true));
  }
  function updateStatus(s) {
    status = s;
    $('connection').textContent = s.stationConnected ? 'On your network' : 'Connected to badge';
    const onBadgeHotspot = location.hostname === (s.apIp || '192.168.4.1');
    $('connection-guide').hidden = s.stationConnected && !onBadgeHotspot;
    $('connection-title').textContent = s.stationConnected
      ? 'Your badge is on your network'
      : 'Keep your phone online';
    $('connection-help').textContent = s.stationConnected
      ? `Switch your phone back to ${s.stationSsid}, then open the address below. Save any card edits before switching.`
      : 'Connect the badge to your Wi-Fi or phone hotspot once. Then edit without leaving your internet connection.';
    $('network-link').hidden = !s.stationConnected;
    if (s.stationConnected && /^\d{1,3}(\.\d{1,3}){3}$/.test(s.stationIp)) {
      $('network-link').href = 'http://' + s.stationIp;
      $('network-link').textContent = 'Open http://' + s.stationIp;
    } else $('network-link').removeAttribute('href');
    $('network-status').textContent = s.stationConnected
      ? `Connected to ${s.stationSsid}. Editor: http://${s.stationIp}. Bookmark it for next time.`
      : s.stationSsid
        ? `Waiting for ${s.stationSsid}. If it does not connect, check the password and use 2.4 GHz. For a phone hotspot, leave badge Wi-Fi and turn your hotspot on now.`
        : 'No network saved yet.';
    $('storage-label').textContent = s.storageReady
      ? Math.round(s.storageUsed / 1024) + ' / ' + Math.round(s.storageTotal / 1024) + ' KB used'
      : 'Initialize storage in the badge menu';
    $('storage-meter').value = s.storageTotal ? (100 * s.storageUsed) / s.storageTotal : 0;
    $('system-info').textContent =
      `Firmware ${s.firmware}\nFree heap: ${Math.round(s.heap / 1024)} KB\nLowest heap: ${Math.round(s.minHeap / 1024)} KB\nLargest block: ${Math.round(s.largestBlock / 1024)} KB\nPSRAM: ${s.psram}\nTouch calibrated: ${s.calibrated ? 'yes' : 'no'}\nTouch presses: ${s.touchPresses || 0}\nScreen: ${s.screen || 'badge'}\nNetwork: ${s.stationConnected ? s.stationIp : 'not connected'}\n${s.setupActive ? 'Badge hotspot: closes after 15 idle minutes' : 'Editor available on saved Wi-Fi'}`;
  }
  async function refreshStatus() {
    if (busy || $('pair-dialog').open) return;
    try {
      updateStatus(await json('/api/status'));
    } catch (e) {
      $('connection').textContent = 'Connection lost';
      if (!$('pair-dialog').open) toast(e.message, true);
    }
  }
  async function load() {
    const s = await json('/api/status'),
      d = await json('/api/cards');
    updateStatus(s);
    deck = d;
    selected = Math.min(s.selected, d.cards.length - 1);
    imageStates.clear();
    imageLoads.clear();
    dirty = false;
    $('save-state').textContent = 'All changes saved';
    renderForm();
    $('studio').inert = false;
    if ($('pair-dialog').open) $('pair-dialog').close();
    clearInterval(pollTimer);
    pollTimer = setInterval(refreshStatus, 10000);
    await document.fonts.ready;
    renderPreview();
  }
  async function save() {
    if (busy) return false;
    try {
      for (const c of deck.cards) validateCard(c);
      setBusy(true);
      const uploadedStates = [];
      await json('/api/gc', { method: 'POST', body: {} });
      for (const c of deck.cards) {
        const s = imageStates.get(c.id);
        if (!s?.dirty) continue;
        const off = document.createElement('canvas');
        off.width = W;
        off.height = H;
        drawBackground(c, off.getContext('2d'));
        const encoded = encodeBMP(off.getContext('2d').getImageData(0, 0, W, H).data);
        const result = await json('/api/assets', { method: 'POST', body: encoded, raw: true });
        c.image = result.id;
        uploadedStates.push(s);
      }
      deck = await json('/api/cards', { method: 'POST', body: deck });
      for (const s of uploadedStates) s.dirty = false;
      dirty = false;
      $('save-state').textContent = 'All changes saved';
      const s = await json('/api/select', { method: 'POST', body: { id: card().id } });
      updateStatus(s);
      renderGallery();
      toast('Saved. Your card is on the badge.');
      return true;
    } catch (e) {
      toast(e.message, true);
      return false;
    } finally {
      setBusy(false);
      renderGallery();
    }
  }
  $('pair-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    $('pair-error').textContent = '';
    try {
      const result = await json('/api/pair', {
        method: 'POST',
        body: { password: $('pair-password').value },
      });
      token = result.token;
      sessionStorage.setItem('badge-token', token);
      $('pair-password').value = '';
      if (dirty && deck.cards.length) {
        updateStatus(await json('/api/status'));
        $('pair-dialog').close();
        $('studio').inert = false;
        clearInterval(pollTimer);
        pollTimer = setInterval(refreshStatus, 10000);
        toast('Reconnected. Your unsaved changes are still here.');
      } else await load();
    } catch (err) {
      $('pair-error').textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
  $('pair-dialog').addEventListener('cancel', (e) => e.preventDefault());
  $('card-form').addEventListener('submit', (e) => e.preventDefault());
  for (const id of [
    'title',
    'mode',
    'name',
    'description',
    'url',
    'background',
    'foreground',
    'accent',
  ])
    $(id).addEventListener('input', () => {
      const c = card();
      c[id] = ['background', 'foreground', 'accent'].includes(id)
        ? color($(id).value)
        : $(id).value;
      markDirty(id === 'background' || id === 'accent' || id === 'mode');
      if (id === 'mode') renderForm();
      if (id === 'title') renderGallery();
    });
  for (const id of ['fit', 'zoom', 'crop-x', 'crop-y'])
    $(id).addEventListener('input', () => {
      const s = currentState();
      if (s) {
        s.fit = $('fit').value;
        s.zoom = Number($('zoom').value) / 100;
        s.x = Number($('crop-x').value);
        s.y = Number($('crop-y').value);
        markDirty(true);
      }
    });
  $('image-file').addEventListener('change', async () => {
    const file = $('image-file').files[0],
      c = card();
    if (!file || !c) return;
    try {
      if (file.size > 24 * 1024 * 1024) throw Error('Choose an image smaller than 24 MB');
      if (!/^image\/(jpeg|png|webp|bmp)$/.test(file.type))
        throw Error('Choose a JPEG, PNG, WebP or BMP image');
      const image = await createImageBitmap(file);
      if (image.width * image.height > 50000000) {
        image.close();
        throw Error('Choose an image under 50 megapixels');
      }
      const old = imageStates.get(c.id);
      if (old?.image?.close) old.image.close();
      imageStates.set(c.id, {
        image,
        normalized: false,
        dirty: true,
        fit: 'cover',
        zoom: 1,
        x: 0,
        y: 0,
      });
      markDirty();
      syncCrop();
    } catch (e) {
      toast(e.message, true);
    } finally {
      $('image-file').value = '';
    }
  });
  $('remove-image').onclick = () => {
    const old = currentState();
    if (old?.image?.close) old.image.close();
    imageStates.delete(card().id);
    card().image = '';
    markDirty();
    syncCrop();
  };
  $('new-card').onclick = () => {
    if (deck.cards.length >= 10) return;
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const id = [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
    deck.cards.push({
      id,
      title: 'New card',
      mode: 'profile',
      image: '',
      name: 'Your name',
      description: 'A little about you.',
      url: '',
      background: 0xd9ceff,
      foreground: 0x23324d,
      accent: 0x3659d9,
      texts: [],
      shapes: [],
    });
    selected = deck.cards.length - 1;
    markDirty();
    renderForm();
  };
  $('delete-card').onclick = () => {
    if (deck.cards.length <= 1) return;
    if (!confirm('Delete “' + card().title + '”? Save to badge to apply.')) return;
    imageStates.delete(card().id);
    deck.cards.splice(selected, 1);
    selected = Math.max(0, selected - 1);
    markDirty();
    renderForm();
  };
  for (const [id, delta] of [
    ['move-up', -1],
    ['move-down', 1],
  ])
    $(id).onclick = () => {
      const to = selected + delta;
      if (to < 0 || to >= deck.cards.length) return;
      [deck.cards[selected], deck.cards[to]] = [deck.cards[to], deck.cards[selected]];
      selected = to;
      markDirty();
      renderForm();
    };
  $('add-text').onclick = () => {
    if (card().texts.length < 4) {
      card().texts.push({ text: 'Your words', x: 20, y: 40, size: 20, color: card().foreground });
      markDirty();
      renderElements();
    }
  };
  $('add-shape').onclick = () => {
    if (card().shapes.length < 4) {
      card().shapes.push({ x: 20, y: 20, w: 80, h: 60, radius: 12, color: card().accent });
      markDirty();
      renderElements();
    }
  };
  $('save-card').onclick = save;
  $('show-card').onclick = async () => {
    if (dirty) {
      await save();
      return;
    }
    try {
      updateStatus(await json('/api/select', { method: 'POST', body: { id: card().id } }));
      renderGallery();
      toast('Showing “' + card().title + '”');
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('reload').onclick = async () => {
    if (dirty && !confirm('Discard unsaved changes and reload from your badge?')) return;
    try {
      await load();
      toast('Reloaded from badge');
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('device-open').onclick = () => {
    if (!token) {
      showPair();
      return;
    }
    for (const id of ['brightness', 'interval', 'rotation']) $(id).value = status[id];
    $('brightness-output').value = status.brightness + '%';
    $('autoplay').checked = status.autoplay;
    $('wifi-ssid').value = status.stationSsid || '';
    $('default-card').value = status.defaultCard;
    $('device-dialog').showModal();
  };
  $('calibrate-touch').onclick = async () => {
    try {
      await json('/api/calibrate', { method: 'POST', body: {} });
      $('device-dialog').close();
      toast('Touch each crosshair on your badge, lifting between targets.');
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('device-close').onclick = () => $('device-dialog').close();
  $('connect-network').onclick = () => {
    $('device-open').click();
    $('network-details').open = true;
    $('wifi-ssid').focus();
  };
  $('show-badge').onclick = async () => {
    if (!token) return showPair();
    try {
      await json('/api/display', { method: 'POST', body: {} });
      toast('Your badge is showing. You can keep editing here.');
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('brightness').oninput = () => ($('brightness-output').value = $('brightness').value + '%');
  $('settings-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      updateStatus(
        await json('/api/settings', {
          method: 'POST',
          body: {
            brightness: Number($('brightness').value),
            interval: Number($('interval').value),
            rotation: Number($('rotation').value),
            autoplay: $('autoplay').checked,
            defaultCard: $('default-card').value,
          },
        }),
      );
      toast('Device settings saved');
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('network-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      updateStatus(
        await json('/api/network', {
          method: 'POST',
          body: { ssid: $('wifi-ssid').value, password: $('wifi-password').value },
        }),
      );
      $('wifi-password').value = '';
      toast('Network saved. For a phone hotspot, leave badge Wi-Fi and turn your hotspot on now.');
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('collect-garbage').onclick = async () => {
    try {
      const result = await json('/api/gc', { method: 'POST', body: {} });
      toast('Removed ' + result.removed + ' unused backgrounds');
      await refreshStatus();
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('end-session').onclick = async () => {
    if (dirty && !confirm('Sign out and leave unsaved changes in this browser?')) return;
    try {
      await json('/api/close', { method: 'POST', body: {} });
      $('device-dialog').close();
      token = '';
      sessionStorage.removeItem('badge-token');
      clearInterval(pollTimer);
      $('connection').textContent = 'Signed out';
      $('studio').inert = true;
      toast('Signed out. Saved Wi-Fi stays connected. Use Device settings to sign in again.');
    } catch (e) {
      toast(e.message, true);
    }
  };
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (busy || card()?.mode !== 'custom') return;
    const p = point(e),
      c = card();
    let item;
    for (const t of [...c.texts].reverse())
      if (p.x >= t.x && p.y >= t.y && p.y < t.y + t.size + 8) {
        item = t;
        break;
      }
    if (!item)
      for (const s of [...c.shapes].reverse())
        if (p.x >= s.x && p.y >= s.y && p.x < s.x + s.w && p.y < s.y + s.h) {
          item = s;
          break;
        }
    if (item) {
      drag = { item, dx: p.x - item.x, dy: p.y - item.y };
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = point(e),
      t = drag.item;
    const maxX = 'w' in t ? W - t.w : 220,
      maxY = 'h' in t ? H - t.h : 300;
    t.x = Math.round(Math.max(0, Math.min(maxX, p.x - drag.dx)));
    t.y = Math.round(Math.max(0, Math.min(maxY, p.y - drag.dy)));
    markDirty();
  });
  for (const ev of ['pointerup', 'pointercancel'])
    canvas.addEventListener(ev, () => {
      if (drag) {
        drag = null;
        renderElements();
      }
    });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  if (token)
    load().catch((e) => {
      showPair();
      $('pair-error').textContent = e.message;
    });
  else showPair();
})();
