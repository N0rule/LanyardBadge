(() => {
  'use strict';
  const assetVersion = new URL(document.currentScript.src).searchParams.get('v') || '';
  const $ = (id) => document.getElementById(id),
    { BluetoothTransport, SerialTransport } = BadgeTransport;
  let transport = (globalThis.badgeDevice = new BluetoothTransport());
  let states = new Map();
  const artworkCache = new BadgeArtworkCache.ArtworkCache(),
    imageLoads = new Map(),
    workspaces = new Map(),
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
    background: 0xf1f3f5,
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
    committed = null,
    conflict = false,
    loadGeneration = 0,
    toastTimer,
    frame = 0,
    drag = null;
  let activePlayer = null,
    animationEnabled = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  function syncAnimation() {
    const player = states.get(card().id)?.player;
    if (activePlayer && activePlayer !== player) activePlayer.pause();
    activePlayer = player;
    $('animation-toggle').hidden = !player;
    const controls = () => {
      $('animation-toggle').textContent = player?.finished
        ? 'Replay animation'
        : animationEnabled
          ? 'Pause animation'
          : 'Play animation';
      $('animation-toggle').setAttribute(
        'aria-pressed',
        String(animationEnabled && !player?.finished),
      );
    };
    controls();
    if (player) {
      if (animationEnabled && connected && !busy && !document.hidden)
        player.play(schedule, controls);
      else player.pause();
    }
  }
  $('animation-toggle').onclick = () => {
    if (activePlayer?.finished) {
      activePlayer.restart();
      animationEnabled = true;
    } else animationEnabled = !animationEnabled;
    syncAnimation();
  };
  document.addEventListener('visibilitychange', syncAnimation);
  let cacheScope = null,
    activeBadgeId = null,
    wantedArtwork = '',
    artworkAbort = new AbortController();
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
      (saved.native === true || /^[a-z2-9]{16}$/.test(saved.credential))
    )
      remembered = { id: saved.id, name: saved.name, native: true };
    if (remembered) localStorage.setItem(rememberedKey, JSON.stringify(remembered));
  } catch {}
  const fragment = new URLSearchParams(location.hash.slice(1));
  key = ''; // Discard obsolete application credentials from old QR links.
  intendedName = fragment.get('badge') || '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const card = () => deck.cards[selected];
  const windows = /Windows/.test(navigator.userAgent);
  let windowsPairingHelp = false;
  function connectionMessage(error) {
    if (windows && (error.securityOperation || error.bluetoothStage === 'pairing'))
      return 'Encrypted Bluetooth pairing did not complete. With current firmware, enter the six-digit number shown on the badge into the browser’s Bluetooth prompt. If the badge shows no number, update its firmware using USB. Your edits are kept.';
    if (error.bluetoothStage === 'pairing')
      return 'Bluetooth security was rejected. Start pairing again and enter the fresh six-digit number shown on the badge. Your edits are kept.';
    if (error.bluetoothStage === 'security-read')
      return 'The encrypted Bluetooth read failed. Keep the badge nearby and retry. If a system pairing request is open, complete it first. Your edits are kept.';
    if (['service', 'characteristic', 'protocol'].includes(error.bluetoothStage))
      return 'The badge Bluetooth service is incompatible or unavailable. Check its firmware version and reconnect. Your edits are kept.';
    if (error.bluetoothStage === 'subscription')
      return 'Bluetooth notifications could not start. Close other badge tabs and reconnect. Your edits are kept.';
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      return 'Bluetooth permission is unavailable. Check browser permissions and that Bluetooth is turned on.';
    if (error.name === 'NetworkError')
      return (
        'Bluetooth could not establish a connection. Keep the badge nearby, close other connected tabs, and try again.' +
        (/Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)
          ? ' On Linux, also check that the Bluetooth service is running.'
          : '')
      );
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
    actions();
    draw();
  }
  function actions() {
    $('save-card').disabled = busy || !connected || (!states.has(card().id) && !card().image);
    $('show-card').disabled = busy || !connected || !card().image || changed;
    $('new-card').disabled = busy || deck.cards.length >= 10;
    $('move-up').disabled = busy || selected === 0;
    $('move-down').disabled = busy || selected === deck.cards.length - 1;
  }
  function progress(label, percent) {
    $('upload-state').hidden = false;
    $('upload-label').textContent = label;
    if (percent === undefined) $('upload-progress').removeAttribute('value');
    else $('upload-progress').value = percent;
  }
  function lock(value) {
    busy = value;
    $('cancel-transfer').hidden = !value || !connected;
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
    actions();
    syncAnimation();
  }
  function sync() {
    const s = states.get(card().id);
    $('crop-controls').disabled = !s;
    $('crop-controls').hidden = !s;
    $('letterbox-control').hidden = !s || s.fit !== 'contain';
    $('artwork-action').textContent = s || card().image ? 'Replace artwork' : 'Choose artwork';
    $('artwork-status').textContent = s?.animationSource
      ? `GIF animation · ${s.frames} frames`
      : s
        ? 'Choose a different file'
        : 'PNG, JPEG, WebP, BMP or GIF';
    $('preview-help').textContent = s
      ? 'Drag artwork to position it.'
      : card().image
        ? 'Loading card preview…'
        : 'Choose artwork to begin.';
    $('preview-placeholder').hidden = !!s || !card().image;
    $('preview-placeholder-label').textContent = 'Loading artwork';
    $('preview-progress').hidden = false;
    $('preview-progress').removeAttribute('value');
    canvas.classList.toggle('has-artwork', !!s);
    syncAnimation();
    actions();
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
    context.fillStyle = s ? hex(c.background) : '#f1f3f5';
    context.fillRect(0, 0, 240, 320);
    if (s) BadgeArtwork.draw(context, s.image, s, hex(c.background));
    const thumb = $('card-list').querySelector(`[data-card-id="${c.id}"] .card-thumbnail`);
    if (thumb) thumb.src = thumbnail(c);
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
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 36;
  thumbCanvas.height = 48;
  function thumbnail(c) {
    const ctx = thumbCanvas.getContext('2d'),
      state = states.get(c.id);
    ctx.save();
    ctx.scale(36 / 240, 48 / 320);
    ctx.fillStyle = '#f1f3f5';
    ctx.fillRect(0, 0, 240, 320);
    if (state) BadgeArtwork.draw(ctx, state.image, state, hex(c.background));
    ctx.restore();
    return thumbCanvas.toDataURL();
  }
  function wantArtwork(c) {
    const wanted = c?.image && cacheScope ? cacheScope.key + '/' + c.image : '';
    if (wanted !== wantedArtwork) {
      artworkAbort.abort();
      artworkAbort = new AbortController();
      wantedArtwork = wanted;
      imageLoads.clear();
    }
  }
  function stopArtwork() {
    artworkAbort.abort();
    artworkAbort = new AbortController();
    wantedArtwork = '';
    imageLoads.clear();
  }
  async function imageFor(c, cachedOnly = false) {
    if (!c.image || states.has(c.id) || !connected || !cacheScope) return;
    const scope = cacheScope,
      asset = c.image;
    if (!cachedOnly) wantArtwork(c);
    const signal = artworkAbort.signal,
      loadKey = scope.key + '/' + c.id + '/' + asset + '/' + cachedOnly;
    if (imageLoads.has(loadKey)) return imageLoads.get(loadKey);
    const load = (async () => {
      let bytes = await artworkCache.get(scope, asset);
      if (!bytes && cachedOnly) return;
      if (signal.aborted || !connected) return;
      if (!bytes) {
        bytes = await transport.getArtwork(asset, {
          rangeBytes: Number(status.imageReadMax) || 0,
          total: Number(status.artworkSizes?.[asset]) || 153666,
          signal,
          onProgress: (percent) => {
            if (!signal.aborted && c.id === card().id) {
              $('preview-help').textContent = `Loading card… ${percent}%`;
              $('preview-progress').value = percent;
            }
          },
        });
        await artworkCache.put(scope, asset, bytes);
      }
      if (
        signal.aborted ||
        !connected ||
        cacheScope?.key !== scope.key ||
        !deck.cards.some((card) => card.id === c.id && card.image === asset) ||
        states.has(c.id)
      )
        return;
      let source;
      if (new DataView(bytes).getUint32(0, false) === 0x4c424131)
        source = await BadgeGIF.open(bytes);
      else {
        const image = document.createElement('canvas');
        image.width = 240;
        image.height = 320;
        image
          .getContext('2d')
          .putImageData(new ImageData(BadgeCodec.decodeBMP(bytes), 240, 320), 0, 0);
        source = { image };
      }
      if (
        signal.aborted ||
        !connected ||
        cacheScope?.key !== scope.key ||
        states.has(c.id) ||
        !deck.cards.some((card) => card.id === c.id && card.image === asset)
      ) {
        source.image.close?.();
        return;
      }
      states.set(c.id, {
        ...source,
        assetId: asset,
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
      } else gallery();
    })();
    imageLoads.set(loadKey, load);
    try {
      await load;
    } catch (error) {
      // A canceled load belongs to the old selection/session. Its native promise
      // may reject after a new editor is connected; do not report it there.
      if (!signal.aborted) throw error;
    } finally {
      if (imageLoads.get(loadKey) === load) imageLoads.delete(loadKey);
    }
  }
  function loadPreview(c, cachedOnly = false) {
    imageFor(c, cachedOnly).catch((error) => {
      if (error.name !== 'AbortError' && connected && c.id === card().id) {
        $('preview-help').textContent = 'Preview unavailable. Choose artwork to replace it.';
        $('preview-placeholder-label').textContent = 'Preview unavailable';
        $('preview-progress').hidden = true;
        toast(error.message);
      }
    });
  }
  function useBadge(deviceId) {
    if (activeBadgeId === deviceId) return;
    stopArtwork();
    activePlayer?.pause();
    if (activeBadgeId)
      workspaces.set(activeBadgeId, { deck, selected, states, changed, committed, conflict });
    const saved = workspaces.get(deviceId);
    if (saved) ({ deck, selected, states, changed, committed, conflict } = saved);
    else {
      states = new Map();
      committed = null;
      conflict = false;
      changed = false;
      selected = 0;
      deck = { version: 2, revision: 0, cards: [blank()] };
    }
    activeBadgeId = deviceId;
  }
  function gallery() {
    $('card-list').replaceChildren();
    $('card-count').textContent = deck.cards.length + ' / 10';
    deck.cards.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gallery-card';
      b.dataset.cardId = c.id;
      b.setAttribute('aria-pressed', String(i === selected));
      const name = document.createElement('span');
      name.textContent = c.title;
      const thumb = document.createElement('img'),
        text = document.createElement('span');
      thumb.className = 'card-thumbnail';
      thumb.alt = '';
      thumb.width = 36;
      thumb.height = 48;
      thumb.src = thumbnail(c);
      text.className = 'card-description';
      text.append(name);
      const small = document.createElement('small');
      small.textContent =
        c.id === status.activeCard ? 'On your badge' : c.image ? 'Saved card' : 'Draft';
      text.append(small);
      b.append(thumb, text);
      b.onclick = () => {
        if (busy) return;
        selected = i;
        edit();
      };
      $('card-list').append(b);
    });
    actions();
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
    wantArtwork(c);
    sync();
    gallery();
    schedule();
    loadPreview(c);
  }
  function updateStatus(s) {
    status = s;
    if (s.legacyCollection)
      toast(
        'Legacy collection preserved. Use Device settings → Factory reset to start an artwork collection; confirm on the badge.',
      );
    $('storage-label').textContent =
      `${Math.round(s.storageUsed / 1024)} KB of ${Math.round(s.storageTotal / 1024)} KB used`;
    $('storage-meter').value = s.storageTotal ? (s.storageUsed / s.storageTotal) * 100 : 0;
    gallery();
  }
  async function load({ preserve = true, snapshot } = {}) {
    const generation = ++loadGeneration,
      session = transport.session,
      controller = transport.sessionAbort,
      deviceId = activeBadgeId;
    const serverDeck = structuredClone(snapshot?.deck || (await transport.getCards())),
      s = snapshot?.status || (await transport.getStatus());
    transport.assertSession(session, controller);
    if (generation !== loadGeneration || deviceId !== activeBadgeId)
      throw new DOMException(
        'A newer collection load replaced this request. Your edits are kept.',
        'AbortError',
      );
    stopArtwork();
    const nextCommitted = structuredClone(serverDeck);
    if (preserve && changed) {
      const active = card().id,
        baseline = new Map((committed?.cards || []).map((c) => [c.id, c])),
        edited = deck.cards.filter(
          (c) =>
            !baseline.has(c.id) ||
            JSON.stringify(c) !== JSON.stringify(baseline.get(c.id)) ||
            states.get(c.id)?.dirty,
        ),
        dirtyIds = new Set(edited.map((c) => c.id));
      conflict = conflict || (!!committed && committed.revision !== serverDeck.revision);
      serverDeck.cards = serverDeck.cards.map((c) =>
        dirtyIds.has(c.id) ? edited.find((v) => v.id === c.id) : c,
      );
      // Retain drafts even when remote additions fill all ten device slots.
      // Saving remains subject to the device limit; reconnect must never discard.
      for (const c of edited)
        if (!serverDeck.cards.some((v) => v.id === c.id)) serverDeck.cards.push(c);
      const localOrder = deck.cards.map((c) => c.id),
        baselineOrder = (committed?.cards || []).map((c) => c.id);
      if (JSON.stringify(localOrder) !== JSON.stringify(baselineOrder)) {
        const byId = new Map(serverDeck.cards.map((c) => [c.id, c]));
        serverDeck.cards = [
          ...localOrder.filter((id) => byId.has(id)).map((id) => byId.get(id)),
          ...serverDeck.cards.filter((c) => !localOrder.includes(c.id)),
        ];
      }
      for (const [id, state] of states) {
        const remote = serverDeck.cards.find((c) => c.id === id);
        if (!dirtyIds.has(id) && (!remote || (state.assetId && remote.image !== state.assetId))) {
          state.image?.close?.();
          states.delete(id);
        }
      }
      deck = serverDeck;
      selected = Math.max(
        0,
        deck.cards.findIndex((c) => c.id === active),
      );
    } else {
      deck = serverDeck;
      selected = Math.max(0, Math.min(s.selected || 0, deck.cards.length - 1));
      for (const state of states.values()) state.image?.close?.();
      states.clear();
      changed = false;
      conflict = false;
    }
    committed = nextCommitted;
    if (!deck.cards.length) {
      deck.cards.push(blank());
      selected = 0;
    }
    updateStatus(s);
    edit();
    if (conflict)
      toast(
        'The badge collection changed elsewhere. Your drafts are kept. Review them before saving.',
      );
    for (const c of deck.cards) if (c.id !== card().id) loadPreview(c, true);
  }
  const labels = {
    searching: 'Searching…',
    connecting: 'Connecting…',
    pairing: 'Pairing…',
    connected: 'Connected via Bluetooth',
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected',
    unsupported: 'Unsupported browser',
  };
  function connectionChanged() {
    $('connection').textContent =
      transport.state === 'connected' && transport.kind === 'usb'
        ? 'Connected via USB'
        : labels[transport.state] || transport.state;
    if (transport.state === 'disconnected') {
      stopArtwork();
      connected = false;
      $('connect').textContent = 'Reconnect badge';
      $('device-open').disabled = true;
      $('show-card').disabled = true;
      $('welcome').hidden = false;
      $('studio').hidden = true;
      $('device-open').hidden = true;
      $('disconnect-top').hidden = true;
      $('draft-kept').hidden = !changed;
      $('device-dialog').close();
      syncAnimation();
    }
  }
  transport.addEventListener('connectionchange', connectionChanged);
  async function useTransport(next) {
    await transport.disconnect();
    transport.removeEventListener('connectionchange', connectionChanged);
    transport = globalThis.badgeDevice = next;
    transport.addEventListener('connectionchange', connectionChanged);
  }
  async function finishPair() {
    const session = transport.session,
      controller = transport.sessionAbort,
      deviceId = transport.device.id;
    const paired = await transport.pair();
    key = transport.kind === 'usb' ? 'usb' : '';
    const identity = paired.snapshot?.status?.deviceId || deviceId;
    // A firmware update can add stable identity to a previously browser-keyed
    // workspace. Keep that live draft while adopting the stronger identity.
    if (activeBadgeId === deviceId && identity !== deviceId && !workspaces.has(identity))
      activeBadgeId = identity;
    useBadge(identity);
    const scope = await artworkCache.scope(identity, paired.snapshot?.status?.cacheEpoch || key);
    transport.assertSession(session, controller);
    if (deviceId !== transport.device?.id)
      throw new DOMException(
        'A different badge replaced this connection. Your edits are kept.',
        'AbortError',
      );
    cacheScope = scope;
    // Set connected only after real pairing and successful metadata reads.
    connected = true;
    try {
      await load({ snapshot: paired.snapshot });
    } catch (e) {
      connected = false;
      throw e;
    }
    transport.change('connected');
    if (windowsPairingHelp) {
      $('compatibility').textContent = defaultCompatibility;
      windowsPairingHelp = false;
    }
    if ($('remember-badge').checked && transport.kind === 'bluetooth' && transport.device?.id) {
      remembered = {
        id: transport.device.id,
        name: transport.device.name || 'your badge',
        native: true,
      };
      try {
        localStorage.setItem(rememberedKey, JSON.stringify(remembered));
      } catch {}
      showRemembered();
    } else if (remembered?.id === transport.device?.id) forgetRemembered();
    $('choose-connection').hidden = false;
    $('connect').textContent = 'Disconnect';
    $('welcome').hidden = true;
    $('studio').hidden = false;
    $('device-open').hidden = false;
    $('disconnect-top').hidden = false;
    $('device-open').disabled = false;
    actions();
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
      if (automatic) await new Promise((resolve) => setTimeout(resolve, 250));
      for (let attempt = 0; ; attempt++) {
        try {
          if (transport.device) await transport.reconnect();
          else if (!automatic) await transport.connect(intendedName);
          else return;
          break;
        } catch (error) {
          // Reload can outrun the previous page's GATT teardown, especially
          // while a saved artwork download is active. Reuse its granted device.
          if (
            !transport.device ||
            ['pairing', 'security-read', 'superseded'].includes(error.bluetoothStage) ||
            attempt >= 2 ||
            !['NetworkError', 'UnknownError'].includes(error.name)
          )
            throw error;
          transport.change('reconnecting');
          await new Promise((resolve) => setTimeout(resolve, attempt ? 900 : 350));
        }
      }
      if (!key && remembered?.id === transport.device?.id) key = '';
      await finishPair();
    } catch (e) {
      const message = connectionMessage(e);
      if (windows && (e.securityOperation || e.bluetoothStage === 'pairing')) {
        $('compatibility').textContent = message;
        windowsPairingHelp = true;
      }
      toast(message);
    } finally {
      connectionPending = false;
      $('connect').disabled = false;
    }
  }
  async function connectUSB(port) {
    if (connectionPending || busy) return;
    // Request permission immediately within the click gesture.
    const requested = port
      ? Promise.resolve(port)
      : navigator.serial.requestPort({ filters: [{ usbVendorId: 0x1a86, usbProductId: 0x7523 }] });
    connectionPending = true;
    try {
      const selectedPort = await requested;
      await useTransport(new SerialTransport());
      await transport.connect(selectedPort);
      await finishPair('');
    } catch (e) {
      toast(e.message);
    } finally {
      connectionPending = false;
    }
  }
  $('connect').onclick = async () => {
    if (connected || transport.device) return connectBadge();
    const ports = await SerialTransport.authorized().catch(() => []);
    if (ports.length === 1) return connectUSB(ports[0]);
    if (SerialTransport.supported()) $('connection-dialog').showModal();
    else connectBadge();
  };
  $('connect-usb').disabled = !SerialTransport.supported();
  $('connect-bluetooth').disabled = !BluetoothTransport.supported();
  $('connect-usb').onclick = () => {
    $('connection-dialog').close();
    void connectUSB();
  };
  $('connect-bluetooth').onclick = async () => {
    if (connectionPending || busy) return;
    $('connection-dialog').close();
    if (transport.kind !== 'bluetooth') {
      key = '';
      await useTransport(new BluetoothTransport());
    }
    await connectBadge();
  };
  $('choose-connection').onclick = () => $('connection-dialog').showModal();
  $('connection-cancel').onclick = () => $('connection-dialog').close();
  $('disconnect-top').onclick = () => transport.disconnect();
  $('cancel-transfer').onclick = async () => {
    await transport.disconnect();
    toast('Transfer canceled. Your artwork draft is kept. Reconnect to try again.');
  };
  $('forget-badge').onclick = () => {
    if (activeBadgeId) void artworkCache.clearDevice(activeBadgeId);
    transport.disconnect();
    transport.device = null;
    key = intendedName = '';
    forgetRemembered();
    $('connect').textContent = 'Connect your badge';
    toast('Badge forgotten in this browser. Your artwork edits are kept.');
  };
  $('theme').value = BadgeTheme.mode;
  $('theme').onchange = (e) => BadgeTheme.set(e.target.value);
  if (!BluetoothTransport.supported() && !SerialTransport.supported()) {
    $('connection').textContent = 'Unsupported browser';
    $('compatibility').textContent =
      'This browser cannot connect over Bluetooth. Open this site in Chrome or Edge on a supported desktop or Android device. iOS Safari is unsupported. USB installation requires desktop Web Serial.';
  }
  if (
    BluetoothTransport.supported() &&
    /Linux/.test(navigator.userAgent) &&
    !/Android/.test(navigator.userAgent)
  ) {
    $('compatibility').textContent =
      'For first-time Bluetooth pairing, enter the six-digit number shown on the badge into your browser’s Bluetooth prompt. Open Connect to editor on the badge to allow a new editor.';
  }
  if (windows)
    $('compatibility').textContent =
      'Connect here. For first-time Bluetooth pairing, enter the six-digit number shown on the badge into the browser’s Bluetooth prompt.';
  const defaultCompatibility = $('compatibility').textContent;
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
    stopArtwork();
    lock(true);
    try {
      if (file.size > 30 * 1024 * 1024) throw Error('Choose artwork smaller than 30 MB.');
      const signature = new Uint8Array(await file.slice(0, 6).arrayBuffer());
      const gif =
        file.type === 'image/gif' || /^GIF8[79]a$/.test(String.fromCharCode(...signature));
      if (gif && status.animationFormat !== 1)
        throw Error(
          'Update your badge firmware using USB to upload animated GIFs. Your current artwork is kept.',
        );
      // Decode once; every edit redraws from the original, with no cumulative resampling.
      const source = gif ? await BadgeGIF.open(file) : { image: await createImageBitmap(file) },
        image = source.image;
      if (image.width * image.height > 50_000_000) {
        image.close();
        throw Error('Choose artwork below 50 megapixels.');
      }
      states.get(card().id)?.image?.close?.();
      states.set(card().id, {
        ...source,
        zoom: 1,
        x: 0,
        y: 0,
        rotation: 0,
        fit: 'cover',
        dirty: true,
      });
      card().mode = 'artwork';
      card().texts = [];
      card().shapes = [];
      card().url = '';
      card().name = '';
      card().description = '';
      if (card().title === 'My artwork') {
        const title = file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[^\x20-\x7e]/g, '')
          .trim()
          .slice(0, 48);
        if (title) card().title = title;
      }
      $('title').value = card().title;
      $('editing-title').textContent = card().title;
      $('legacy-note').hidden = true;
      gallery();
      sync();
      dirty(true);
    } catch (err) {
      toast('Could not open artwork. ' + err.message);
    } finally {
      e.target.value = '';
      lock(false);
      loadPreview(card());
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
      await load({ preserve: false });
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
      if (
        conflict &&
        !confirm(
          'The badge changed elsewhere. Save your reviewed collection over its latest version? Your local edits are kept if you cancel.',
        )
      )
        return;
      if (deck.cards.length > 10)
        throw Error(
          'Your drafts are safe. Remove cards until the collection has at most ten before saving.',
        );
      const c = card(),
        s = states.get(c.id);
      BadgeCodec.validateCard(c);
      if (c.mode !== 'artwork')
        throw Error(
          'Choose artwork for this card before uploading. Your original card stays on the badge.',
        );
      if (!s && !c.image) throw Error('Choose artwork for your card.');
      stopArtwork();
      lock(true);
      progress('Preparing card');
      let imageId = c.image;
      if (s && (s.dirty || !imageId)) {
        if (s.uploadedId) imageId = s.uploadedId;
        else {
          let bytes;
          if (s.animationSource) {
            if (status.animationFormat !== 1)
              throw Error('Update your badge firmware using USB to upload animated GIFs.');
            progress('Preparing animation…', 0);
            bytes = await BadgeGIF.encode(s.animationSource, {
              transform: { ...s },
              background: hex(c.background),
              signal: transport.sessionAbort.signal,
              onProgress: (p) => progress(`Preparing animation… ${p}%`, p),
            });
            if (bytes.byteLength > (status.maxAnimationBytes || BadgeGIF.maxBytes))
              throw Error(
                'This animation is too large for the badge. Choose a shorter or simpler GIF.',
              );
          } else {
            const output = document.createElement('canvas');
            output.width = 240;
            output.height = 320;
            const out = output.getContext('2d');
            BadgeArtwork.draw(out, s.image, s, hex(c.background));
            bytes = BadgeCodec.encodeBMP(out.getImageData(0, 0, 240, 320).data);
          }
          progress('Uploading card…', 0);
          const result = await transport.uploadCard(
            bytes,
            (p) => progress(`Uploading card… ${p}%`, p),
            !!s.animationSource,
          );
          imageId = result.id;
          s.uploadedId = imageId;
          await artworkCache.put(cacheScope, imageId, bytes);
        }
      }
      progress('Saving card');
      const candidate = structuredClone(deck);
      candidate.cards[selected].image = imageId;
      // Keep pending image/transform until the atomic manifest transaction succeeds.
      const saved = await transport.updateCards(candidate);
      deck = saved;
      committed = structuredClone(saved);
      conflict = false;
      if (s) {
        s.dirty = false;
        s.uploadedId = null;
      }
      changed = Array.from(states.values()).some((state) => state.dirty);
      updateStatus(await transport.selectCard(c.id));
      $('save-state').textContent = changed ? 'Unsaved changes' : 'Card uploaded';
      $('save-state').classList.toggle('unsaved', changed);
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
      $('factory-reset').hidden = !status.factoryReset;
      $('device-name').value = status.deviceName || status.bluetoothName || 'LanyardBadge';
      $('name-form').hidden = !status.deviceName;
      $('brightness').value = status.brightness;
      $('brightness-output').value = status.brightness + '%';
      $('screen-timeout').value = status.screenTimeout ?? 120;
      $('autoplay').checked = status.autoplay;
      $('interval').value = status.interval;
      $('badge-theme').value = status.darkMode === false ? 'light' : 'dark';
      $('system-info').textContent =
        `${status.bluetoothName || 'Lanyard Badge'} · Firmware ${status.firmware || 'unknown'}`;
      $('device-dialog').showModal();
    } catch (e) {
      toast(e.message);
    }
  };
  $('name-form').onsubmit = async (event) => {
    event.preventDefault();
    try {
      updateStatus(await transport.json('/api/name', { name: $('device-name').value }));
      $('name-status').textContent = 'Device name saved.';
    } catch (e) {
      $('name-status').textContent = e.message;
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
          darkMode: $('badge-theme').value === 'dark',
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
  $('factory-reset').onclick = async () => {
    const warning =
      'Delete all artwork, settings and trusted editors from this badge? ' +
      (changed ? 'You have unsaved browser edits; they will remain in this tab. ' : '') +
      'You must also confirm physically on the badge.';
    if (!confirm(warning)) return;
    try {
      await transport.json('/api/reset', {});
      $('reset-status').textContent =
        'Release BOOT, then hold it on the badge for 3 seconds. Go back on the badge to cancel.';
      if (activeBadgeId) await artworkCache.clearDevice(activeBadgeId);
      forgetRemembered();
    } catch (e) {
      $('reset-status').textContent = e.message;
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
  $('install-open').onclick = async () => {
    if (busy || connectionPending) {
      toast('Wait for the current operation to finish before installing firmware.');
      return;
    }
    await transport.disconnect();
    $('install-dialog').showModal();
    installer();
  };
  $('install-close').onclick = () => {
    $('install-dialog').close();
    void restoreConnection();
  };
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
    get conflict() {
      return conflict;
    },
    draw,
    sync,
    get transport() {
      return transport;
    },
  };
  edit();
  lock(false);
  showRemembered();
  async function restoreConnection() {
    const ports = await SerialTransport.authorized().catch(() => []);
    if (connectionPending || connected || busy) return;
    if (ports.length === 1) {
      await connectUSB(ports[0]);
      if (connected) return;
      await useTransport(new BluetoothTransport());
    }
    if (!remembered || (intendedName && intendedName !== remembered.name)) return;
    if (transport.kind !== 'bluetooth') await useTransport(new BluetoothTransport());
    if (key === 'usb') key = '';
    try {
      if (await transport.restore(remembered.id)) {
        if (!key) key = '';
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
