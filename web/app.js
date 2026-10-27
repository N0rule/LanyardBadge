(() => {
  'use strict';
  const assetVersion = new URL(document.currentScript.src).searchParams.get('v') || '';
  const $ = (id) => document.getElementById(id),
    { BluetoothTransport } = BadgeTransport;
  const transport = (globalThis.badgeDevice = new BluetoothTransport());
  const states = new Map(),
    canvas = $('preview'),
    context = canvas.getContext('2d');
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const blank = () => ({
    id: crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, '0'),
    title: 'My artwork',
    mode: 'artwork',
    image: '',
    name: '',
    description: '',
    url: '',
    background: 0,
    foreground: 0xffffff,
    accent: 0x2151dc,
    texts: [],
    shapes: [],
  });
  let deck = { version: 2, revision: 0, cards: [blank()] },
    selected = 0,
    status = {},
    connected = false,
    busy = false,
    changed = false,
    toastTimer,
    frame = 0,
    drag = null;
  let key = '',
    intendedName = '',
    connectionPending = false,
    remembered = null;
  const rememberedKey = 'lanyardbadge.connection';
  try {
    const saved = JSON.parse(localStorage.getItem(rememberedKey));
    if (
      saved &&
      typeof saved.id === 'string' &&
      typeof saved.name === 'string' &&
      /^[a-z2-9]{16}$/.test(saved.credential)
    )
      remembered = saved;
  } catch {}
  const fragment = new URLSearchParams(location.hash.slice(1));
  key = fragment.get('key') || fragment.get('code') || '';
  intendedName = fragment.get('badge') || '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const card = () => deck.cards[selected];
  function connectionMessage(error) {
    if (error.name === 'NetworkError')
      return 'Bluetooth could not establish a connection. Keep the badge nearby, close other connected tabs, and try again. On Linux, also check that the Bluetooth service is running.';
    if (error.name === 'NotFoundError')
      return 'No badge selected. Keep its connection screen open and scan again.';
    return error.message;
  }
  function showRemembered() {
    $('remembered-badge').hidden = !remembered;
    $('remembered-label').textContent = remembered
      ? `This browser remembers ${remembered.name}.`
      : '';
  }
  function forgetRemembered() {
    remembered = null;
    try {
      localStorage.removeItem(rememberedKey);
    } catch {}
    showRemembered();
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => ($('toast').hidden = true), 7000);
  }
  function dirty(image = false) {
    changed = true;
    $('save-state').textContent = 'Unsaved changes';
    $('save-state').classList.add('unsaved');
    const s = states.get(card().id);
    if (image && s) {
      s.dirty = true;
      s.uploadedId = null;
    }
    schedule();
  }
  function progress(label, percent) {
    $('upload-state').hidden = false;
    $('upload-label').textContent = label;
    if (percent === undefined) $('upload-progress').removeAttribute('value');
    else $('upload-progress').value = percent;
  }
  function lock(value) {
    busy = value;
    $('card-form').inert = value;
    for (const id of [
      'save-card',
      'show-card',
      'new-card',
      'delete-card',
      'move-up',
      'move-down',
      'reload',
      'connect',
      'device-open',
    ])
      $(id).disabled = value;
    $('device-open').disabled = value || !connected;
    $('show-card').disabled = value || !connected;
  }
  function sync() {
    const s = states.get(card().id);
    $('crop-controls').disabled = !s;
    if (!s) return;
    $('fit').value = s.fit;
    $('zoom').value = Math.round(s.zoom * 100);
    $('zoom-value').value = Math.round(s.zoom * 100);
    $('crop-x').value = Math.round(s.x);
    $('crop-y').value = Math.round(s.y);
    for (const [id, value] of [
      ['crop-x-output', s.x],
      ['crop-y-output', s.y],
    ])
      $(id).textContent = (Math.round(value) > 0 ? '+' : '') + Math.round(value) + '%';
  }
  function schedule() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
  }
  function draw() {
    const c = card(),
      s = states.get(c.id);
    context.fillStyle = hex(c.background);
    context.fillRect(0, 0, 240, 320);
    if (s) BadgeArtwork.draw(context, s.image, s, hex(c.background));
    else if (!c.image) {
      context.fillStyle = '#2457df';
      context.beginPath();
      context.arc(66, 90, 72, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#ed765c';
      context.fillRect(82, 142, 160, 180);
      context.fillStyle = '#c5d8f8';
      context.beginPath();
      context.arc(56, 273, 65, 0, Math.PI * 2);
      context.fill();
    }
    if (c.mode !== 'artwork') {
      // Legacy layouts remain untouched in storage and on device; preview says so explicitly.
      context.fillStyle = '#000c';
      context.fillRect(0, 240, 240, 80);
      context.fillStyle = '#fff';
      context.font = '14px system-ui';
      context.fillText('Legacy card', 16, 269);
      context.fillText('Original layout on your badge', 16, 292);
    }
  }
  async function imageFor(c) {
    if (!c.image || states.has(c.id) || !connected) return;
    const response = await transport.request('/api/image?id=' + c.image);
    const bytes = await response.arrayBuffer(),
      off = document.createElement('canvas');
    off.width = 240;
    off.height = 320;
    off.getContext('2d').putImageData(new ImageData(BadgeCodec.decodeBMP(bytes), 240, 320), 0, 0);
    if (!states.has(c.id))
      states.set(c.id, {
        image: off,
        zoom: 1,
        x: 0,
        y: 0,
        rotation: 0,
        fit: 'cover',
        dirty: false,
      });
    if (c.id === card().id) {
      sync();
      schedule();
    }
  }
  function gallery() {
    $('card-list').replaceChildren();
    $('card-count').textContent = deck.cards.length + ' / 10';
    deck.cards.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gallery-card';
      b.setAttribute('aria-pressed', String(i === selected));
      const name = document.createElement('span');
      name.textContent = c.title;
      b.append(name);
      if (c.id === status.activeCard) {
        const small = document.createElement('small');
        small.textContent = 'On your badge';
        b.append(small);
      }
      b.onclick = () => {
        if (busy) return;
        selected = i;
        edit();
      };
      $('card-list').append(b);
    });
    $('new-card').disabled = busy || deck.cards.length >= 10;
  }
  function edit() {
    const c = card();
    $('title').value = c.title;
    $('background').value = hex(c.background);
    $('editing-title').textContent = c.title;
    $('legacy-note').hidden = c.mode === 'artwork';
    $('save-state').textContent = changed
      ? 'Unsaved changes'
      : c.image
        ? 'Saved on badge'
        : 'Choose artwork to begin';
    $('save-state').classList.toggle('unsaved', changed);
    if (!busy) $('upload-state').hidden = true;
    sync();
    gallery();
    schedule();
    imageFor(c).catch((e) => toast(e.message));
  }
  function updateStatus(s) {
    status = s;
    $('storage-label').textContent =
      `${Math.round(s.storageUsed / 1024)} KB of ${Math.round(s.storageTotal / 1024)} KB used`;
    $('storage-meter').value = s.storageTotal ? (s.storageUsed / s.storageTotal) * 100 : 0;
    gallery();
  }
  async function load({ preserve = false } = {}) {
    const serverDeck = await transport.getCards(),
      s = await transport.getStatus();
    if (preserve && changed) {
      // Keep all edits. Matching IDs overlay the freshly read collection; new drafts append.
      const edited = deck.cards,
        active = card().id;
      serverDeck.cards = serverDeck.cards.map((c) => edited.find((v) => v.id === c.id) || c);
      for (const c of edited)
        if (!serverDeck.cards.some((v) => v.id === c.id) && serverDeck.cards.length < 10)
          serverDeck.cards.push(c);
      deck = serverDeck;
      selected = Math.max(
        0,
        deck.cards.findIndex((c) => c.id === active),
      );
    } else {
      deck = serverDeck;
      selected = Math.min(s.selected || 0, deck.cards.length - 1);
      for (const state of states.values()) state.image?.close?.();
      states.clear();
      changed = false;
    }
    if (!deck.cards.length) {
      deck.cards.push(blank());
      selected = 0;
    }
    updateStatus(s);
    edit();
  }
  const labels = {
    searching: 'Searching…',
    connecting: 'Connecting…',
    pairing: 'Pairing…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected',
    unsupported: 'Unsupported browser',
  };
  transport.addEventListener('connectionchange', () => {
    $('connection').textContent = labels[transport.state] || transport.state;
    if (transport.state === 'disconnected') {
      connected = false;
      $('connect').textContent = 'Reconnect badge';
      $('device-open').disabled = true;
      $('show-card').disabled = true;
      $('welcome').hidden = false;
    }
  });
  async function finishPair(password) {
    const paired = await transport.pair(password);
    key = paired.credential || password;
    // Set connected only after real pairing and successful reads.
    connected = true;
    try {
      await load({ preserve: changed });
    } catch (e) {
      connected = false;
      throw e;
    }
    transport.change('connected');
    if ($('remember-badge').checked && transport.device?.id && /^[a-z2-9]{16}$/.test(key)) {
      remembered = {
        id: transport.device.id,
        name: transport.device.name || 'your badge',
        credential: key,
      };
      try {
        localStorage.setItem(rememberedKey, JSON.stringify(remembered));
      } catch {}
      showRemembered();
    } else if (remembered?.id === transport.device?.id) forgetRemembered();
    $('connect').textContent = 'Disconnect';
    $('welcome').hidden = true;
    $('device-open').disabled = false;
    $('show-card').disabled = false;
    $('gallery-hint').textContent = 'Your collection stays on the badge.';
    $('pair-dialog').close();
  }
  async function connectBadge(automatic = false) {
    if (connectionPending) return;
    if (connected) {
      transport.disconnect();
      return;
    }
    connectionPending = true;
    $('connect').disabled = true;
    try {
      if (transport.device) await transport.reconnect();
      else if (!automatic) await transport.connect(intendedName);
      else return;
      if (!key && remembered?.id === transport.device?.id) key = remembered.credential;
      if (key) await finishPair(key);
      else $('pair-dialog').showModal();
    } catch (e) {
      if (e.deviceResponse && transport.state === 'pairing') {
        key = '';
        if (remembered?.id === transport.device?.id) forgetRemembered();
        $('pair-error').textContent = connectionMessage(e);
        if (!$('pair-dialog').open) $('pair-dialog').showModal();
      } else toast(connectionMessage(e));
    } finally {
      connectionPending = false;
      $('connect').disabled = false;
    }
  }
  $('connect').onclick = () => connectBadge();
  $('forget-badge').onclick = () => {
    transport.disconnect();
    transport.device = null;
    key = intendedName = '';
    forgetRemembered();
    $('connect').textContent = 'Connect your badge';
    toast('Badge forgotten in this browser. Your artwork edits are kept.');
  };
  $('pair-form').onsubmit = async (e) => {
    e.preventDefault();
    $('pair-error').textContent = '';
    try {
      if (!transport.device?.gatt.connected) await transport.reconnect();
      await finishPair($('pair-password').value.trim().toUpperCase());
      $('pair-password').value = '';
    } catch (e) {
      $('pair-error').textContent = connectionMessage(e);
    }
  };
  $('pair-cancel').onclick = () => {
    $('pair-dialog').close();
    transport.disconnect();
    transport.device = null;
  };
  $('pair-dialog').addEventListener('cancel', () => {
    transport.disconnect();
    transport.device = null;
  });
  $('theme').value = BadgeTheme.mode;
  $('theme').onchange = (e) => BadgeTheme.set(e.target.value);
  if (!BluetoothTransport.supported()) {
    $('connection').textContent = 'Unsupported browser';
    $('compatibility').textContent =
      'This browser cannot connect over Bluetooth. Open this site in Chrome or Edge on a supported desktop or Android device. iOS Safari is unsupported. You can still prepare artwork here.';
  }
  $('card-form').onsubmit = (e) => e.preventDefault();
  $('title').oninput = (e) => {
    card().title = e.target.value;
    $('editing-title').textContent = e.target.value;
    dirty();
    gallery();
  };
  $('background').oninput = (e) => {
    card().background = parseInt(e.target.value.slice(1), 16);
    dirty(true);
  };
  $('image-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 30 * 1024 * 1024) throw Error('Choose artwork smaller than 30 MB.');
      // Decode once; every edit redraws from the original, with no cumulative resampling.
      const image = await createImageBitmap(file);
      if (image.width * image.height > 50_000_000) {
        image.close();
        throw Error('Choose artwork below 50 megapixels.');
      }
      states.get(card().id)?.image?.close?.();
      states.set(card().id, { image, zoom: 1, x: 0, y: 0, rotation: 0, fit: 'cover', dirty: true });
      card().mode = 'artwork';
      card().texts = [];
      card().shapes = [];
      card().url = '';
      card().name = '';
      card().description = '';
      $('legacy-note').hidden = true;
      sync();
      dirty(true);
    } catch (err) {
      toast('Could not open artwork. ' + err.message);
    } finally {
      e.target.value = '';
    }
  };
  function transform() {
    const s = states.get(card().id);
    if (!s) return;
    s.fit = $('fit').value;
    s.zoom = Number($('zoom').value) / 100;
    s.x = Number($('crop-x').value);
    s.y = Number($('crop-y').value);
    sync();
    dirty(true);
  }
  for (const id of ['fit', 'zoom', 'crop-x', 'crop-y']) $(id).addEventListener('input', transform);
  $('zoom-value').oninput = (e) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value) || value < 100 || value > 300) return;
    $('zoom').value = value;
    transform();
  };
  for (const [id, angle] of [
    ['rotate-left', -90],
    ['rotate-right', 90],
  ])
    $(id).onclick = () => {
      const s = states.get(card().id);
      if (!s) return;
      s.rotation = (s.rotation + angle + 360) % 360;
      sync();
      dirty(true);
    };
  $('reset-transform').onclick = () => {
    const s = states.get(card().id);
    if (!s) return;
    Object.assign(s, { rotation: 0, zoom: 1, x: 0, y: 0 });
    sync();
    dirty(true);
  };
  canvas.onpointerdown = (e) => {
    const s = states.get(card().id);
    if (!s || busy || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, originalX: s.x, originalY: s.y };
    e.preventDefault();
  };
  canvas.onpointermove = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const s = states.get(card().id),
      rect = canvas.getBoundingClientRect();
    const g = BadgeArtwork.geometry(s.image.width, s.image.height, s);
    BadgeArtwork.move(
      s,
      g,
      ((e.clientX - drag.x) * 240) / rect.width,
      ((e.clientY - drag.y) * 320) / rect.height,
    );
    drag.x = e.clientX;
    drag.y = e.clientY;
    sync();
    dirty(true);
    e.preventDefault();
  };
  function stopDrag(e) {
    if (!drag || drag.id !== e.pointerId) return;
    if (e.type === 'pointercancel') {
      const s = states.get(card().id);
      s.x = drag.originalX;
      s.y = drag.originalY;
      sync();
      schedule();
    }
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }
  canvas.onpointerup = stopDrag;
  canvas.onpointercancel = stopDrag;
  canvas.onlostpointercapture = () => {
    drag = null;
  };
  canvas.onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const s = states.get(card().id);
    if (!s) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') s.x -= step;
    if (e.key === 'ArrowRight') s.x += step;
    if (e.key === 'ArrowUp') s.y -= step;
    if (e.key === 'ArrowDown') s.y += step;
    s.x = BadgeArtwork.clamp(s.x, -100, 100);
    s.y = BadgeArtwork.clamp(s.y, -100, 100);
    sync();
    dirty(true);
  };
  $('new-card').onclick = () => {
    if (deck.cards.length >= 10) return;
    deck.cards.push(blank());
    selected = deck.cards.length - 1;
    dirty();
    edit();
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
      dirty();
      edit();
    };
  $('delete-card').onclick = async () => {
    const id = card().id;
    if (!confirm(`Delete “${card().title}”? Its unsaved edits will be removed.`)) return;
    try {
      lock(true);
      if (connected) {
        const saved = await transport.getCards();
        if (saved.cards.some((c) => c.id === id)) {
          saved.cards = saved.cards.filter((c) => c.id !== id);
          const result = await transport.updateCards(saved);
          deck.revision = result.revision;
        }
      }
      states.get(id)?.image?.close?.();
      states.delete(id);
      deck.cards.splice(selected, 1);
      if (!deck.cards.length) {
        deck.cards.push(blank());
        changed = false;
      }
      selected = Math.min(selected, deck.cards.length - 1);
      if (connected) updateStatus(await transport.getStatus());
      edit();
      toast('Card deleted.');
    } catch (e) {
      toast(e.message);
    } finally {
      lock(false);
    }
  };
  $('reload').onclick = async () => {
    if (!connected) {
      toast('Connect your badge to reload its collection.');
      return;
    }
    if (changed && !confirm('Reloading discards unsaved edits in this tab. Continue?')) return;
    try {
      await load();
      toast('Collection loaded.');
    } catch (e) {
      toast(e.message);
    }
  };
  $('save-card').onclick = async () => {
    if (!connected) {
      toast('Connect your badge first. Your edits will stay here.');
      return;
    }
    try {
      const c = card(),
        s = states.get(c.id);
      BadgeCodec.validateCard(c);
      if (c.mode !== 'artwork')
        throw Error(
          'Choose artwork for this card before uploading. Your original card stays on the badge.',
        );
      if (!s && !c.image) throw Error('Choose artwork for your card.');
      lock(true);
      progress('Preparing card');
      let imageId = c.image;
      if (s && (s.dirty || !imageId)) {
        if (s.uploadedId) imageId = s.uploadedId;
        else {
          const output = document.createElement('canvas');
          output.width = 240;
          output.height = 320;
          const out = output.getContext('2d');
          BadgeArtwork.draw(out, s.image, s, hex(c.background));
          const bytes = BadgeCodec.encodeBMP(out.getImageData(0, 0, 240, 320).data);
          progress('Uploading card…', 0);
          const result = await transport.uploadCard(bytes, (p) =>
            progress(`Uploading card… ${p}%`, p),
          );
          imageId = result.id;
          s.uploadedId = imageId;
        }
      }
      progress('Saving card');
      const candidate = structuredClone(deck);
      candidate.cards[selected].image = imageId;
      // Keep pending image/transform until the atomic manifest transaction succeeds.
      const saved = await transport.updateCards(candidate);
      deck = saved;
      if (s) {
        s.dirty = false;
        s.uploadedId = null;
      }
      changed = false;
      updateStatus(await transport.selectCard(c.id));
      $('save-state').textContent = 'Card uploaded';
      $('save-state').classList.remove('unsaved');
      progress('Card uploaded', 100);
      toast('Card uploaded.');
      gallery();
    } catch (e) {
      toast(e.message);
      progress('Upload stopped. Your edits are kept.');
    } finally {
      lock(false);
    }
  };
  $('show-card').onclick = async () => {
    if (changed) {
      toast('Upload your changes before showing this card.');
      return;
    }
    try {
      updateStatus(await transport.selectCard(card().id));
      toast('Showing this card.');
    } catch (e) {
      toast(e.message);
    }
  };
  $('device-open').onclick = async () => {
    try {
      updateStatus(await transport.getStatus());
      $('brightness').value = status.brightness;
      $('brightness-output').value = status.brightness + '%';
      $('screen-timeout').value = status.screenTimeout ?? 120;
      $('autoplay').checked = status.autoplay;
      $('interval').value = status.interval;
      $('system-info').textContent = JSON.stringify(status, null, 2);
      $('device-dialog').showModal();
    } catch (e) {
      toast(e.message);
    }
  };
  $('device-close').onclick = () => $('device-dialog').close();
  $('brightness').oninput = (e) => ($('brightness-output').value = e.target.value + '%');
  $('settings-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      updateStatus(
        await transport.updateSettings({
          brightness: Number($('brightness').value),
          screenTimeout: Number($('screen-timeout').value),
          autoplay: $('autoplay').checked,
          interval: Number($('interval').value),
          rotation: status.rotation,
          defaultCard: status.defaultCard,
        }),
      );
      toast('Device settings saved.');
    } catch (e) {
      toast(e.message);
    }
  };
  $('calibrate-touch').onclick = async () => {
    try {
      await transport.json('/api/calibrate', {});
      toast('Touch each crosshair on your badge.');
    } catch (e) {
      toast(e.message);
    }
  };
  $('collect-garbage').onclick = async () => {
    try {
      await transport.json('/api/gc', {});
      updateStatus(await transport.getStatus());
      toast('Unused artwork cleaned.');
    } catch (e) {
      toast(e.message);
    }
  };
  $('disconnect').onclick = () => {
    transport.disconnect();
    $('device-dialog').close();
  };
  // Load the pinned USB installer only when requested. No pairing fragment reaches a CDN.
  let installerLoaded = false;
  async function installer() {
    $('installer').replaceChildren();
    if (!navigator.serial) {
      $('install-status').textContent =
        'This browser has no Web Serial. Use desktop Chrome or Edge with a USB data cable.';
      return;
    }
    try {
      const mode = $('install-mode').value;
      $('install-warning').textContent =
        mode === 'fresh'
          ? 'For blank boards only. Installation writes a bootloader and partition table. Back up any existing firmware/data first. Erase device is optional in the installer and destroys all cards/settings.'
          : 'Updates write only the application. Existing 2.x layout required: app at 0x10000, storage at 0x210000. Leave “Erase device” unchecked to preserve cards/settings.';
      const manifest =
        `./firmware/${mode}.json` + (assetVersion ? '?v=' + encodeURIComponent(assetVersion) : '');
      const response = await fetch(manifest, { cache: 'no-store' });
      if (!response.ok) throw Error('Firmware has not been published here yet.');
      await response.json();
      if (!installerLoaded) {
        await import('./vendor/esp-web-tools/install-button.js');
        installerLoaded = true;
      }
      const button = document.createElement('esp-web-install-button');
      button.setAttribute('manifest', manifest);
      const action = document.createElement('button');
      action.slot = 'activate';
      action.className = 'primary full';
      action.textContent = mode === 'fresh' ? 'Connect USB & install' : 'Connect USB & update';
      button.append(action);
      $('installer').append(button);
      $('install-status').textContent =
        'Close other serial tools. Select the CH340/CH341 USB port when prompted.';
    } catch (e) {
      $('install-status').textContent = e.message;
    }
  }
  $('install-open').onclick = () => {
    $('install-dialog').showModal();
    installer();
  };
  $('install-close').onclick = () => $('install-dialog').close();
  $('install-mode').onchange = installer;
  window.addEventListener('beforeunload', (e) => {
    if (changed) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  // Testable public rendering uses exactly the export pipeline, without fake device state.
  globalThis.BadgeEditor = {
    get deck() {
      return deck;
    },
    get state() {
      return states.get(card().id);
    },
    get changed() {
      return changed;
    },
    draw,
    sync,
    transport,
  };
  edit();
  lock(false);
  showRemembered();
  async function restoreConnection() {
    if (!remembered || (intendedName && intendedName !== remembered.name)) return;
    try {
      if (await transport.restore(remembered.id)) {
        if (!key) key = remembered.credential;
        $('connect').textContent = 'Reconnect badge';
        await connectBadge(true);
      } else if (!key) {
        // getDevices is unavailable or browser permission was removed. Keep
        // the remembered credential for the next explicitly selected badge.
        $('connect').textContent = 'Reconnect badge';
      }
    } catch {
      $('connect').textContent = 'Reconnect badge';
    }
  }
  restoreConnection();
})();
